package com.char2vid.studio.library

import android.content.Context
import android.os.Build
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * G4 portable library archive on Android: ZIP with `manifest.json`,
 * `records.json`, `media/<sha256>.<ext>`.
 *
 * Schema v1 is library-only. Schema v2 is written when character/look records
 * are included. Inspect/import accept both so legacy v1 character packages
 * still restore; unknown versions are rejected.
 *
 * Semantics track `packages/storage-web/src/archive.ts` so archives produced
 * here import in the browser and browser archives import here:
 * - export only live (`trashedAt == null`), `available` assets and their closure;
 * - inspect validates paths, count/size limits, manifest/records schemas, and
 *   cross-checks asset/revision/manifest/file digests without mutating anything;
 * - import copies the source URI once into a scratch ZIP, then inspects, stages,
 *   and commits from that snapshot (never re-opens the user URI); staging
 *   re-verifies SHA-256, remaps colliding IDs, promotes objects, then commits
 *   records in one Room transaction; any failure rolls back staged temps and
 *   promoted orphans.
 *
 * Everything streams: `ZipOutputStream` / `ZipInputStream`, 64 KiB buffers,
 * and only the two JSON members are ever buffered in memory.
 */
class LibraryArchiver(
    @Suppress("unused") private val context: Context,
    private val repo: MediaStoreRepository,
) {
    data class ExportSummary(
        val transferId: String,
        val fileName: String,
        val assetCount: Int,
        val fileCount: Int,
    )

    data class ImportResult(
        val idMap: Map<String, String>,
        val importedAssets: Int,
    )

    fun fileNameFor(transferId: String, characterId: String? = null): String =
        if (characterId == null) {
            fileNameForTransfer(transferId)
        } else {
            "char2vid-character-${transferId.take(8)}.zip"
        }

    // ---- export ---------------------------------------------------------------

    /**
     * Stream the library archive into [output] (closed on return). Throws on any
     * checksum mismatch, leaving the caller to discard the partial output.
     */
    fun exportLibraryTo(
        output: OutputStream,
        transferId: String = UUID.randomUUID().toString(),
        characterId: String? = null,
    ): ExportSummary {
        val snapshot = repo.archiveSnapshot(characterId)
        val assetsById = snapshot.assets.associateBy { it.id }
        val files = ArrayList<ArchiveManifestFile>()
        val sources = ArrayList<File>()
        val seen = HashSet<String>()
        for (asset in snapshot.assets) {
            if (snapshot.revisions.none { it.id == asset.revisionId }) {
                throw LibraryException(LibraryException.EXPORT_FAILED, "asset ${asset.id} missing revision ${asset.revisionId}")
            }
        }
        for (revision in snapshot.revisions) {
            if (!seen.add(revision.sha256)) {
                continue
            }
            val asset =
                assetsById[revision.assetId]
                    ?: throw LibraryException(LibraryException.EXPORT_FAILED, "revision ${revision.id} missing asset")
            val physical =
                snapshot.physicalBySha[revision.sha256]
                    ?: throw LibraryException(LibraryException.MISSING_FILE, "missing physical object for revision ${revision.id}")
            val file = repo.resolveFile(physical.relativePath)
            if (!file.isFile) {
                throw LibraryException(LibraryException.MISSING_FILE, "missing file for revision ${revision.id}")
            }
            val path = ArchivePaths.mediaArchivePath(revision.sha256, asset.mime)
            if (!ArchivePaths.validateArchivePath(path)) {
                throw LibraryException(LibraryException.EXPORT_FAILED, "refusing unsafe media path")
            }
            files.add(ArchiveManifestFile(path, revision.sha256, physical.byteLength, asset.mime))
            sources.add(file)
        }

        val records =
            ArchiveRecords(
                assets = snapshot.assets.map { toArchiveAsset(it) },
                revisions = snapshot.revisions.map { ArchiveRevision(it.id, it.assetId, it.sha256, it.createdAt) },
                collectionMembers = snapshot.collectionMembers.map { ArchiveCollectionMember(it.collectionId, it.assetId) },
                assetTags = snapshot.assetTags.map { ArchiveAssetTag(it.assetId, it.tag) },
                characters = snapshot.characters,
                looks = snapshot.looks,
            )
        val includeCharacters = snapshot.characters.isNotEmpty() || snapshot.looks.isNotEmpty()
        val manifest =
            ArchiveManifest(
                schemaVersion = ArchivePaths.schemaVersionFor(includeCharacters),
                createdAt = Instant.now().toString(),
                scope = if (characterId == null) "library" else "character",
                scopeId = characterId,
                files = files,
                recordCounts =
                    ArchiveRecordCounts(
                        assets = records.assets.size,
                        revisions = records.revisions.size,
                        collectionMembers = records.collectionMembers.size,
                        assetTags = records.assetTags.size,
                    ),
            )

        ZipOutputStream(BufferedOutputStream(output)).use { zip ->
            zip.setLevel(6)
            putBytes(zip, ArchivePaths.MANIFEST_PATH, ArchiveJson.encodeManifest(manifest).toByteArray(Charsets.UTF_8))
            putBytes(zip, ArchivePaths.RECORDS_PATH, ArchiveJson.encodeRecords(records).toByteArray(Charsets.UTF_8))
            for (i in files.indices) {
                val file = files[i]
                zip.putNextEntry(ZipEntry(file.path))
                val hashed =
                    BufferedInputStream(FileInputStream(sources[i])).use { input ->
                        MediaValidator.hashCopy(input, zip)
                    }
                zip.closeEntry()
                if (hashed.sha256 != file.sha256 || hashed.byteLength != file.bytes) {
                    throw LibraryException(LibraryException.VERIFICATION_FAILED, "checksum mismatch exporting ${file.path}")
                }
            }
            zip.finish()
        }
        return ExportSummary(transferId, fileNameFor(transferId, characterId), records.assets.size, files.size + 2)
    }

    /**
     * Export into a private scratch file. Only returned on success; on failure the
     * scratch directory is removed so no apparently complete archive remains.
     */
    fun exportLibraryToScratch(
        transferId: String = UUID.randomUUID().toString(),
        characterId: String? = null,
    ): Pair<File, ExportSummary> {
        val dir = repo.createScratchDir("archive-export")
        val target = File(dir, fileNameFor(transferId, characterId))
        try {
            val summary = exportLibraryTo(FileOutputStream(target), transferId, characterId)
            return target to summary
        } catch (error: Exception) {
            dir.deleteRecursively()
            throw error
        }
    }

    private fun putBytes(zip: ZipOutputStream, name: String, bytes: ByteArray) {
        zip.putNextEntry(ZipEntry(name))
        zip.write(bytes)
        zip.closeEntry()
    }

    private fun toArchiveAsset(asset: AssetEntity): ArchiveAsset =
        ArchiveAsset(
            id = asset.id,
            revisionId = asset.revisionId,
            kind = asset.kind,
            name = asset.name,
            mime = asset.mime,
            sha256 = asset.sha256,
            bytes = asset.bytes,
            state = asset.state,
            createdAt = asset.createdAt,
            favorite = asset.favorite,
            rating = asset.rating,
            folderId = asset.folderId,
            trashedAt = asset.trashedAt,
        )

    // ---- inspect ----------------------------------------------------------------

    private class Scan {
        val names = ArrayList<String>()
        val sizes = HashMap<String, Long>()
        val digests = HashMap<String, String>()
        val duplicates = ArrayList<String>()
        var manifestJson: String? = null
        var recordsJson: String? = null
        var expanded = 0L
        var limitExceeded = false
        var entryLimitExceeded = false
        var rawEntries = 0
        var jsonTooLarge: String? = null
        var zipError: String? = null
    }

    /** One sequential pass: names, actual expanded sizes, SHA-256 per member, buffered JSON. */
    private fun scan(open: () -> InputStream): Scan {
        val scan = Scan()
        try {
            withZipEntryNamesVisible {
                ZipInputStream(BufferedInputStream(open())).use { zin ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val entry = zin.nextEntry ?: break
                        scan.rawEntries += 1
                        if (scan.rawEntries > ArchivePaths.MAX_ARCHIVE_FILE_COUNT) {
                            scan.entryLimitExceeded = true
                            break
                        }
                        if (entry.isDirectory) {
                            zin.closeEntry()
                            continue
                        }
                        val name = entry.name
                        if (scan.sizes.containsKey(name)) {
                            scan.duplicates.add(name)
                        } else {
                            scan.names.add(name)
                        }
                        val digest = MessageDigest.getInstance("SHA-256")
                        val json =
                            if (name == ArchivePaths.MANIFEST_PATH || name == ArchivePaths.RECORDS_PATH) {
                                ByteArrayOutputStream()
                            } else {
                                null
                            }
                        var size = 0L
                        while (true) {
                            val read = zin.read(buffer)
                            if (read < 0) {
                                break
                            }
                            if (read == 0) {
                                continue
                            }
                            size += read
                            scan.expanded += read
                            if (scan.expanded > ArchivePaths.MAX_ARCHIVE_EXPANDED_BYTES) {
                                scan.limitExceeded = true
                                break
                            }
                            digest.update(buffer, 0, read)
                            if (json != null) {
                                if (size > MAX_JSON_MEMBER_BYTES) {
                                    scan.jsonTooLarge = name
                                } else {
                                    json.write(buffer, 0, read)
                                }
                            }
                        }
                        if (scan.limitExceeded) {
                            break
                        }
                        scan.sizes[name] = size
                        scan.digests[name] = digest.digest().joinToString("") { "%02x".format(it) }
                        if (json != null && scan.jsonTooLarge != name) {
                            val text = json.toString("UTF-8")
                            if (name == ArchivePaths.MANIFEST_PATH) {
                                scan.manifestJson = text
                            } else {
                                scan.recordsJson = text
                            }
                        }
                        zin.closeEntry()
                    }
                }
            }
        } catch (error: IOException) {
            scan.zipError = error.message ?: error.javaClass.simpleName
            ArchivePaths.invalidPathFromZipGuardMessage(scan.zipError)?.let { path ->
                if (!scan.sizes.containsKey(path)) {
                    scan.names.add(path)
                }
            }
        } catch (error: IllegalArgumentException) {
            // Malformed entry names (e.g. bad UTF-8 flags) surface as IAE from ZipInputStream.
            scan.zipError = error.message ?: error.javaClass.simpleName
        }
        return scan
    }

    /** Validate without mutating. Mirrors the web `inspectArchive` checks and messages. */
    fun inspect(open: () -> InputStream): ArchiveReport {
        val report = ArchiveReport()
        val scan = scan(open)
        for (name in scan.names) {
            if (!ArchivePaths.validateArchivePath(name) || !ArchivePaths.isAllowedArchiveMemberPath(name)) {
                report.invalidPaths.add(name)
            }
        }
        if (scan.zipError != null) {
            report.errors.add("invalid archive zip: ${scan.zipError}")
            if (report.invalidPaths.isNotEmpty()) {
                report.errors.add("unsafe or disallowed member paths: ${report.invalidPaths.joinToString(", ")}")
            }
            return report
        }
        if (scan.entryLimitExceeded) {
            report.fileCount = scan.rawEntries
            report.errors.add(
                "archive file count ${scan.rawEntries} exceeds limit ${ArchivePaths.MAX_ARCHIVE_FILE_COUNT}",
            )
            return report
        }
        if (scan.names.isEmpty()) {
            report.errors.add("invalid archive zip: no members")
            return report
        }

        report.fileCount = scan.names.size
        report.expandedBytes = scan.expanded
        if (scan.duplicates.isNotEmpty()) {
            report.errors.add("duplicate archive members: ${scan.duplicates.joinToString(", ")}")
        }
        if (scan.limitExceeded || scan.expanded > ArchivePaths.MAX_ARCHIVE_EXPANDED_BYTES) {
            report.errors.add("expanded size ${scan.expanded} exceeds limit ${ArchivePaths.MAX_ARCHIVE_EXPANDED_BYTES}")
            return report
        }
        if (scan.jsonTooLarge != null) {
            report.errors.add("${scan.jsonTooLarge} exceeds ${MAX_JSON_MEMBER_BYTES} bytes")
        }
        if (report.invalidPaths.isNotEmpty()) {
            report.errors.add("unsafe or disallowed member paths: ${report.invalidPaths.joinToString(", ")}")
        }

        val manifestJson = scan.manifestJson
        val recordsJson = scan.recordsJson
        if (manifestJson == null) {
            report.missingFiles.add(ArchivePaths.MANIFEST_PATH)
            report.errors.add("missing manifest.json")
        }
        if (recordsJson == null) {
            report.missingFiles.add(ArchivePaths.RECORDS_PATH)
            report.errors.add("missing records.json")
        }
        if (manifestJson == null || recordsJson == null) {
            return report
        }

        val manifest: ArchiveManifest
        try {
            val peeked = ArchiveJson.peekSchemaVersion(manifestJson)
            if (peeked != null && !ArchivePaths.isSupportedSchemaVersion(peeked)) {
                report.schemaVersion = peeked
                report.unsupportedVersion = true
                report.errors.add("unsupported archive schemaVersion $peeked")
                return report
            }
            manifest = ArchiveJson.parseManifest(manifestJson)
            report.schemaVersion = manifest.schemaVersion
        } catch (error: IllegalArgumentException) {
            report.errors.add("invalid manifest.json: ${error.message}")
            return report
        }

        val records: ArchiveRecords
        try {
            records = ArchiveJson.parseRecords(recordsJson)
        } catch (error: IllegalArgumentException) {
            report.errors.add("invalid records.json: ${error.message}")
            return report
        }

        val idErrors = ArchiveValidation.logicalIdErrors(records)
        report.errors.addAll(idErrors)
        report.errors.addAll(ArchiveValidation.referenceErrors(records))
        if (idErrors.isNotEmpty()) {
            report.ok = false
            return report
        }

        val hashedByPath = HashMap<String, String>()
        for (file in manifest.files) {
            if (!ArchivePaths.validateArchivePath(file.path) || !ArchivePaths.isAllowedArchiveMemberPath(file.path)) {
                report.invalidPaths.add(file.path)
                report.errors.add("manifest lists unsafe path: ${file.path}")
                continue
            }
            val size = scan.sizes[file.path]
            if (size == null) {
                report.missingFiles.add(file.path)
                continue
            }
            if (size != file.bytes) {
                report.errors.add("byte length mismatch for ${file.path}: expected ${file.bytes}, got $size")
            }
            val digest = scan.digests[file.path]!!
            hashedByPath[file.path] = digest
            if (digest != file.sha256) {
                report.errors.add("checksum mismatch for ${file.path}")
            }
            val expectedName = ArchivePaths.mediaArchivePath(file.sha256, file.mime)
            if (file.path != expectedName) {
                report.errors.add("media path ${file.path} does not match sha256/mime ($expectedName)")
            }
        }

        val manifestPaths = manifest.files.map { it.path }.toHashSet()
        var anyMedia = false
        for (name in scan.names) {
            if (!name.startsWith("media/")) {
                continue
            }
            anyMedia = true
            if (!manifestPaths.contains(name)) {
                report.errors.add("media member $name not listed in manifest.files")
            }
        }
        if (anyMedia && manifest.files.isEmpty()) {
            report.errors.add("manifest.files is empty while media members exist in the archive")
        }

        val revisionById = records.revisions.associateBy { it.id }
        val fileBySha = manifest.files.associateBy { it.sha256 }

        for (asset in records.assets) {
            if (asset.state != "available") {
                report.errors.add("archive asset ${asset.id} is not available")
                continue
            }
            val path = ArchivePaths.mediaArchivePath(asset.sha256, asset.mime)
            val listed = manifest.files.firstOrNull { it.path == path }
            if (listed == null) {
                report.missingFiles.add(path)
                report.errors.add("asset ${asset.id} media path $path not listed in manifest.files")
                continue
            }
            if (!scan.sizes.containsKey(path)) {
                report.missingFiles.add(path)
                report.errors.add("asset ${asset.id} media member $path missing from zip")
                continue
            }
            val fileDigest = hashedByPath[path]
            if (fileDigest == null) {
                report.errors.add("asset ${asset.id} media path $path was not hashed during inspect")
            } else if (fileDigest != asset.sha256 || listed.sha256 != asset.sha256 || fileDigest != listed.sha256) {
                report.errors.add("digest cross-check failed for asset ${asset.id}: asset/manifest/file sha256 disagree")
            }
            if (listed.mime != asset.mime) {
                report.errors.add("asset ${asset.id} mime ${asset.mime} does not match manifest ${listed.mime}")
            }
            if (listed.bytes != asset.bytes) {
                report.errors.add("asset ${asset.id} bytes ${asset.bytes} does not match manifest ${listed.bytes}")
            }
            val revision = revisionById[asset.revisionId]
            if (revision == null) {
                report.errors.add("asset ${asset.id} revision ${asset.revisionId} missing from records")
                continue
            }
            if (revision.assetId != asset.id) {
                report.errors.add("revision ${revision.id} assetId ${revision.assetId} does not match asset ${asset.id}")
            }
            if (revision.sha256 != asset.sha256) {
                report.errors.add("digest cross-check failed for asset ${asset.id}: revision sha256 disagrees")
            }
            if (fileDigest != null && revision.sha256 != fileDigest) {
                report.errors.add("digest cross-check failed for asset ${asset.id}: revision/file sha256 disagree")
            }
        }

        for (revision in records.revisions) {
            val listed = fileBySha[revision.sha256]
            if (listed == null) {
                report.errors.add("revision ${revision.id} sha256 not listed in manifest.files")
                continue
            }
            val fileDigest = hashedByPath[listed.path]
            if (fileDigest == null) {
                report.errors.add("revision ${revision.id} media path ${listed.path} was not hashed during inspect")
            } else if (fileDigest != revision.sha256) {
                report.errors.add("digest cross-check failed for revision ${revision.id}: file sha256 disagrees")
            }
        }

        report.ok =
            report.errors.isEmpty() &&
            report.invalidPaths.isEmpty() &&
            report.missingFiles.isEmpty() &&
            !report.unsupportedVersion
        return report
    }

    // ---- import -----------------------------------------------------------------

    /**
     * Inspect, stage, verify, remap, promote, commit. The existing library is
     * untouched unless the final Room transaction succeeds.
     *
     * The source is copied once into a private scratch ZIP. Inspect, scan, and
     * staging all read that snapshot so a SAF/`content:`/`file:` URI that
     * changes between opens cannot be validated as ZIP A and committed as ZIP B.
     * The user URI is never re-opened after the snapshot exists.
     */
    fun importArchive(open: () -> InputStream, conflict: String): ImportResult {
        if (conflict != "remap") {
            throw LibraryException(LibraryException.INVALID_ARGUMENT, "unsupported conflict mode: $conflict")
        }
        val snapshotDir = repo.createScratchDir("archive-import-source")
        val snapshot = File(snapshotDir, "source.zip")
        try {
            BufferedInputStream(open()).use { input ->
                BufferedOutputStream(FileOutputStream(snapshot)).use { output ->
                    val budget = repo.copyBudgetBytes()
                    try {
                        StreamLimits.copyBounded(input, output, budget)
                    } catch (error: StreamLimits.LimitExceededException) {
                        throw LibraryException(
                            LibraryException.ARCHIVE_REJECTED,
                            "archive source exceeds copy budget",
                            error,
                        )
                    }
                    output.flush()
                }
            }
            return importSnapshot(snapshot)
        } finally {
            snapshotDir.deleteRecursively()
        }
    }

    private fun importSnapshot(snapshot: File): ImportResult {
        val open: () -> InputStream = { FileInputStream(snapshot) }
        val report = inspect(open)
        if (!report.ok) {
            throw LibraryException(
                LibraryException.ARCHIVE_REJECTED,
                "archive rejected: ${report.errors.joinToString("; ").ifEmpty { "validation failed" }}",
            )
        }
        val scan = scan(open)
        val manifest = ArchiveJson.parseManifest(scan.manifestJson ?: throw inconsistent())
        if (manifest.scope != "library" && manifest.scope != "character") {
            throw LibraryException(LibraryException.UNSUPPORTED_SCOPE, "archive scope \"${manifest.scope}\" is not supported")
        }
        val rawRecords = ArchiveJson.parseRecords(scan.recordsJson ?: throw inconsistent())

        val existing = repo.existingLogicalIds()
        val incoming = ArchiveRemap.collectLibraryIncomingIds(rawRecords)
        val idMap = ArchiveRemap.createCollisionMap(existing, incoming)
        val remapped = ArchiveRemap.remapRecords(rawRecords, idMap)

        val needed = HashMap<String, ArchiveManifestFile>()
        for (file in manifest.files) {
            if (!repo.hasIntactPhysical(file.sha256)) {
                needed[file.path] = file
            }
        }

        val scratch = repo.createScratchDir("archive-import")
        val staged = HashMap<String, File>()
        val promoted = ArrayList<String>()
        repo.writeArchiveImportJournal(needed.values.map { it.sha256 }, listOf(scratch.name, snapshot.parentFile!!.name))
        try {
            if (needed.isNotEmpty()) {
                ZipInputStream(BufferedInputStream(open())).use { zin ->
                    while (true) {
                        val entry = zin.nextEntry ?: break
                        if (entry.isDirectory) {
                            zin.closeEntry()
                            continue
                        }
                        val file = needed[entry.name]
                        if (file == null || staged.containsKey(entry.name)) {
                            zin.closeEntry()
                            continue
                        }
                        val target = File(scratch, file.sha256)
                        val hashed =
                            BufferedOutputStream(FileOutputStream(target)).use { out ->
                                MediaValidator.hashCopy(zin, out)
                            }
                        if (hashed.sha256 != file.sha256 || hashed.byteLength != file.bytes) {
                            throw LibraryException(
                                LibraryException.ARCHIVE_REJECTED,
                                "archive rejected: checksum mismatch staging ${file.path}",
                            )
                        }
                        staged[entry.name] = target
                        zin.closeEntry()
                    }
                }
            }
            for ((path, _) in needed) {
                if (!staged.containsKey(path)) {
                    throw LibraryException(LibraryException.ARCHIVE_REJECTED, "archive rejected: $path missing during staging")
                }
            }

            val physicals = ArrayList<PhysicalObjectEntity>()
            for ((path, file) in needed) {
                val relative = repo.promoteStagedFile(staged[path]!!, file.sha256)
                promoted.add(file.sha256)
                physicals.add(PhysicalObjectEntity(file.sha256, relative, file.bytes))
            }

            val assets =
                remapped.assets.map { a ->
                    AssetEntity(
                        id = a.id,
                        revisionId = a.revisionId,
                        kind = a.kind,
                        name = a.name,
                        mime = a.mime,
                        sha256 = a.sha256,
                        bytes = a.bytes,
                        state = a.state,
                        createdAt = a.createdAt,
                        favorite = a.favorite,
                        rating = a.rating,
                        folderId = a.folderId,
                        trashedAt = a.trashedAt,
                    )
                }
            val revisions = remapped.revisions.map { RevisionEntity(it.id, it.assetId, it.sha256, it.createdAt) }
            val members = remapped.collectionMembers.map { CollectionMemberEntity(it.collectionId, it.assetId) }
            val tags = remapped.assetTags.map { AssetTagEntity(it.assetId, it.tag) }
            val characters =
                remapped.characters.map { character ->
                    CharacterEntity(
                        id = character.id,
                        name = character.name,
                        currentRevisionId = character.currentRevisionId,
                        coverAssetRevisionId = character.coverAssetRevisionId,
                        createdAt = character.createdAt,
                    )
                }
            val characterRevisions =
                remapped.characters.flatMap { character ->
                    character.revisions.map { revision ->
                        CharacterRevisionEntity(
                            id = revision.id,
                            characterId = revision.characterId,
                            parentRevisionId = revision.parentRevisionId,
                            identityNotes = revision.identityNotes,
                            referencesJson = CharacterJson.encodeReferences(revision.references),
                        )
                    }
                }
            val looks =
                remapped.looks.map { look ->
                    LookEntity(
                        id = look.id,
                        characterId = look.characterId,
                        label = look.label,
                        notes = look.notes,
                        referenceRevisionIdsJson = CharacterJson.encodeRevisionIds(look.referenceRevisionIds),
                    )
                }

            repo.commitArchiveImport(physicals, assets, revisions, members, tags, characters, characterRevisions, looks)
            repo.clearArchiveImportJournal()
            scratch.deleteRecursively()
            return ImportResult(idMap, assets.size)
        } catch (error: Exception) {
            for (sha in promoted) {
                try {
                    repo.purgeUnreferencedPhysical(sha)
                } catch (_: Exception) {
                    // rollback is best effort per object; the transaction itself already rolled back
                }
            }
            repo.clearArchiveImportJournal()
            scratch.deleteRecursively()
            throw when (error) {
                is LibraryException -> error
                else -> LibraryException(LibraryException.ARCHIVE_REJECTED, "archive import failed: ${error.message}", error)
            }
        }
    }

    private fun inconsistent(): LibraryException =
        LibraryException(LibraryException.ARCHIVE_REJECTED, "archive changed between inspect and import")

    /**
     * Android 14 [dalvik.system.ZipPathValidator] throws before ZipInputStream
     * yields `..` names. Allow listing for inspect so `invalidPaths` can match
     * the web importer; we never write those names to user-controlled paths.
     */
    @Suppress("NewApi")
    private inline fun <T> withZipEntryNamesVisible(block: () -> T): T {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return block()
        }
        dalvik.system.ZipPathValidator.setCallback(
            object : dalvik.system.ZipPathValidator.Callback {
                override fun onZipEntryAccess(path: String) {
                    // Allow listing; ArchivePaths.validateArchivePath records invalidPaths.
                }
            },
        )
        try {
            return block()
        } finally {
            dalvik.system.ZipPathValidator.clearCallback()
        }
    }

    companion object {
        /** manifest.json / records.json are the only buffered members. */
        const val MAX_JSON_MEMBER_BYTES: Long = 64L * 1024L * 1024L

        fun fileNameForTransfer(transferId: String): String = "char2vid-library-${transferId.take(8)}.zip"
    }
}
