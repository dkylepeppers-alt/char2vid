package com.char2vid.studio.library

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.StatFs
import android.provider.DocumentsContract
import android.provider.MediaStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * App-owned media library repository (Room metadata + private files).
 *
 * Named per the G2 plan file list. Imports copy Photo Picker / SAF
 * `content://` (or `file://`) URIs into app-private storage — temporary
 * picker grants are never the only copy. Android MediaStore *export* remains
 * in [ExportPlugin] and is out of scope here.
 *
 * Journal stages: pending → written → promoted → commitAvailable (clears journal).
 */
class MediaStoreRepository(
    private val context: Context,
    private val db: LibraryDatabase = LibraryDatabase.getInstance(context),
) {
    private val dao = db.libraryDao()

    /** App-owned library root (`filesDir/library`). Only `share/` is exposed through FileProvider. */
    val rootDir: File =
        File(context.filesDir, "library").also { it.mkdirs() }

    private val openReads = ConcurrentHashMap<String, OpenRead>()

    data class OpenRead(
        val input: InputStream,
        val byteLength: Long,
        val mime: String,
    )

    data class AssetRecordDto(
        val id: String,
        val revisionId: String,
        val kind: String,
        val name: String,
        val mime: String,
        val sha256: String,
        val bytes: Long,
        val state: String,
        val createdAt: String,
        val favorite: Boolean,
        val rating: Int?,
        val folderId: String?,
        val trashedAt: String?,
    ) {
        fun toJson(): JSONObject {
            val o = JSONObject()
            o.put("id", id)
            o.put("revisionId", revisionId)
            o.put("kind", kind)
            o.put("name", name)
            o.put("mime", mime)
            o.put("sha256", sha256)
            o.put("bytes", bytes)
            o.put("state", state)
            o.put("createdAt", createdAt)
            o.put("favorite", favorite)
            if (rating == null) {
                o.put("rating", JSONObject.NULL)
            } else {
                o.put("rating", rating)
            }
            if (folderId == null) {
                o.put("folderId", JSONObject.NULL)
            } else {
                o.put("folderId", folderId)
            }
            if (trashedAt == null) {
                o.put("trashedAt", JSONObject.NULL)
            } else {
                o.put("trashedAt", trashedAt)
            }
            return o
        }
    }

    init {
        File(rootDir, "tmp").mkdirs()
        File(rootDir, "objects").mkdirs()
    }

    fun resolveFile(relativePath: String): File {
        val normalized = relativePath.replace('\\', '/').trimStart('/')
        require(!normalized.contains("..")) { "path traversal rejected" }
        return File(rootDir, normalized)
    }

    fun reconcileOnStart(): ReconcileResult {
        val result = reconcileImports()
        reconcileArchiveScratch()
        reconcilePendingPublications()
        return result
    }

    data class ReconcileResult(val repaired: Int, val missing: List<String>)

    fun importFromNativeUri(uriString: String, name: String, mime: String): AssetRecordDto {
        require(uriString.isNotBlank()) { "uri required" }
        require(name.isNotBlank()) { "name required" }
        require(mime.isNotBlank()) { "mime required" }

        val importId = UUID.randomUUID().toString()
        val assetId = UUID.randomUUID().toString()
        val revisionId = UUID.randomUUID().toString()
        val createdAt = Instant.now().toString()
        val kind = kindFromMime(mime)
        val tempPath = LibraryPaths.tempRelativePath(importId)

        val pendingAsset =
            AssetEntity(
                id = assetId,
                revisionId = revisionId,
                kind = kind,
                name = name,
                mime = mime,
                sha256 = "",
                bytes = 0L,
                state = "pending",
                createdAt = createdAt,
            )
        val journal =
            ImportJournalEntity(
                importId = importId,
                assetId = assetId,
                revisionId = revisionId,
                stage = "pending",
                tempPath = tempPath,
                finalHash = null,
                name = name,
                mime = mime,
                kind = kind,
                createdAt = createdAt,
            )

        dao.upsertJournal(journal)
        dao.upsertAsset(pendingAsset)

        try {
            val tempFile = resolveFile(tempPath)
            tempFile.parentFile?.mkdirs()

            val uri = Uri.parse(uriString)
            openUriInput(uri).use { raw ->
                BufferedInputStream(raw).use { input ->
                    FileOutputStream(tempFile).use { output ->
                        val hashed = MediaValidator.hashCopy(input, output)
                        MediaValidator.validateMediaBytes(
                            hashed.byteLength,
                            mime,
                            hashed.prefix,
                        )
                        dao.upsertJournal(
                            journal.copy(stage = "written", finalHash = hashed.sha256),
                        )

                        val relativePath = promoteTemp(tempPath, hashed.sha256)
                        dao.upsertJournal(
                            journal.copy(stage = "promoted", finalHash = hashed.sha256),
                        )

                        val available =
                            pendingAsset.copy(
                                sha256 = hashed.sha256,
                                bytes = hashed.byteLength,
                                state = "available",
                            )
                        dao.commitAvailable(
                            asset = available,
                            revision =
                                RevisionEntity(
                                    id = revisionId,
                                    assetId = assetId,
                                    sha256 = hashed.sha256,
                                    createdAt = createdAt,
                                ),
                            physical =
                                PhysicalObjectEntity(
                                    sha256 = hashed.sha256,
                                    relativePath = relativePath,
                                    byteLength = hashed.byteLength,
                                ),
                            importId = importId,
                        )
                        return toDto(available)
                    }
                }
            }
        } catch (error: Exception) {
            abandonImport(dao.getJournal(importId) ?: journal)
            throw error
        }
    }

    fun getAsset(id: String): AssetRecordDto? {
        val asset = dao.getAsset(id) ?: return null
        return toDto(asset)
    }

    /** Immutable revision resolved to its content-addressed file; used by export/archive. */
    data class RevisionSource(
        val revisionId: String,
        val assetId: String,
        val file: File,
        val byteLength: Long,
        val sha256: String,
        val mime: String,
        val name: String,
        val kind: String,
    )

    fun resolveRevisionSource(revisionId: String): RevisionSource {
        val revision =
            dao.getRevision(revisionId)
                ?: throw LibraryException(LibraryException.UNKNOWN_REVISION, "unknown revision")
        val physical =
            dao.getPhysical(revision.sha256)
                ?: throw LibraryException(LibraryException.MISSING_FILE, "missing physical object for revision")
        val file = resolveFile(physical.relativePath)
        if (!file.isFile) {
            throw LibraryException(LibraryException.MISSING_FILE, "missing file for revision")
        }
        val asset = dao.getAsset(revision.assetId)
        return RevisionSource(
            revisionId = revision.id,
            assetId = revision.assetId,
            file = file,
            byteLength = physical.byteLength,
            sha256 = revision.sha256,
            mime = asset?.mime ?: "application/octet-stream",
            name = asset?.name ?: revision.id,
            kind = asset?.kind ?: kindFromMime(asset?.mime ?: ""),
        )
    }

    fun physicalObjectCount(): Int = dao.countPhysical()

    fun createCharacter(name: String, referenceRevisionId: String): JSONObject {
        val trimmed = name.trim()
        require(trimmed.isNotEmpty()) { "createCharacter requires a name" }
        if (referenceAvailability(referenceRevisionId) != "available") {
            throw IllegalArgumentException("createCharacter requires an available image revision")
        }
        val revision =
            dao.getRevision(referenceRevisionId)
                ?: throw IllegalArgumentException("createCharacter requires an available image revision")
        val asset =
            dao.getAsset(revision.assetId)
                ?: throw IllegalArgumentException("createCharacter requires an available image revision")
        require(asset.kind == "image" && asset.state == "available") {
            "createCharacter requires an available image revision"
        }
        val characterId = UUID.randomUUID().toString()
        val revisionId = UUID.randomUUID().toString()
        val createdAt = Instant.now().toString()
        val references =
            listOf(
                ArchiveCharacterReference(
                    assetRevisionId = referenceRevisionId,
                    role = "identity",
                    view = "front",
                    approval = "approved",
                ),
            )
        db.runInTransaction {
            dao.upsertCharacter(
                CharacterEntity(
                    id = characterId,
                    name = trimmed,
                    currentRevisionId = revisionId,
                    coverAssetRevisionId = referenceRevisionId,
                    createdAt = createdAt,
                ),
            )
            dao.upsertCharacterRevision(
                CharacterRevisionEntity(
                    id = revisionId,
                    characterId = characterId,
                    parentRevisionId = null,
                    identityNotes = "",
                    referencesJson = CharacterJson.encodeReferences(references),
                ),
            )
        }
        val o = JSONObject()
        o.put("characterId", characterId)
        o.put("revisionId", revisionId)
        return o
    }

    fun listCharacters(): JSONObject {
        val arr = JSONArray()
        for (character in dao.listCharacters().sortedBy { it.createdAt }) {
            arr.put(CharacterJson.characterToBridgeJson(character))
        }
        val o = JSONObject()
        o.put("characters", arr)
        return o
    }

    fun getCharacter(id: String): JSONObject {
        val o = JSONObject()
        val character = dao.getCharacter(id)
        if (character == null) {
            o.put("character", JSONObject.NULL)
        } else {
            o.put("character", CharacterJson.characterToBridgeJson(character))
        }
        return o
    }

    fun listCharacterRevisions(characterId: String): JSONObject {
        val arr = JSONArray()
        for (revision in dao.listCharacterRevisions(characterId)) {
            arr.put(revisionToJson(revision))
        }
        val o = JSONObject()
        o.put("revisions", arr)
        return o
    }

    fun getCharacterRevision(id: String): JSONObject {
        val o = JSONObject()
        val revision = dao.getCharacterRevision(id)
        if (revision == null) {
            o.put("revision", JSONObject.NULL)
        } else {
            o.put("revision", revisionToJson(revision))
        }
        return o
    }

    fun saveCharacterRevision(raw: JSONObject) {
        val parsed = CharacterJson.parseRevision(raw, "characterRevision")
        require(dao.getCharacterRevision(parsed.id) == null) { "character revisions are immutable" }
        val character =
            dao.getCharacter(parsed.characterId)
                ?: throw IllegalArgumentException("unknown character: ${parsed.characterId}")
        if (parsed.parentRevisionId != null) {
            require(dao.getCharacterRevision(parsed.parentRevisionId) != null) {
                "unknown parent revision: ${parsed.parentRevisionId}"
            }
        }
        db.runInTransaction {
            dao.upsertCharacterRevision(
                CharacterRevisionEntity(
                    id = parsed.id,
                    characterId = parsed.characterId,
                    parentRevisionId = parsed.parentRevisionId,
                    identityNotes = parsed.identityNotes,
                    referencesJson = CharacterJson.encodeReferences(parsed.references),
                ),
            )
            dao.upsertCharacter(character.copy(currentRevisionId = parsed.id))
        }
    }

    fun saveLook(raw: JSONObject) {
        val parsed = CharacterJson.parseLook(raw, "look")
        require(dao.getCharacter(parsed.characterId) != null) { "unknown character: ${parsed.characterId}" }
        dao.upsertLook(
            LookEntity(
                id = parsed.id,
                characterId = parsed.characterId,
                label = parsed.label,
                notes = parsed.notes,
                referenceRevisionIdsJson = CharacterJson.encodeRevisionIds(parsed.referenceRevisionIds),
            ),
        )
    }

    fun listLooks(characterId: String): JSONObject {
        val arr = JSONArray()
        for (look in dao.listLooks(characterId)) {
            arr.put(CharacterJson.lookToBridgeJson(look))
        }
        val o = JSONObject()
        o.put("looks", arr)
        return o
    }

    fun getLook(id: String): JSONObject {
        val o = JSONObject()
        val look = dao.getLook(id)
        if (look == null) {
            o.put("look", JSONObject.NULL)
        } else {
            o.put("look", CharacterJson.lookToBridgeJson(look))
        }
        return o
    }

    fun setCover(characterId: String, assetRevisionId: String) {
        val character =
            dao.getCharacter(characterId)
                ?: throw IllegalArgumentException("unknown character: $characterId")
        val revision =
            dao.getCharacterRevision(character.currentRevisionId)
                ?: throw IllegalArgumentException("unknown character revision: ${character.currentRevisionId}")
        val references = CharacterJson.parseReferences(revision.referencesJson)
        val match = references.find { it.assetRevisionId == assetRevisionId }
        require(match != null && match.approval == "approved") {
            "cover must be an approved character reference"
        }
        dao.upsertCharacter(character.copy(coverAssetRevisionId = assetRevisionId))
    }

    fun renameCharacter(id: String, name: String) {
        val trimmed = name.trim()
        require(trimmed.isNotEmpty()) { "character name is required" }
        val character =
            dao.getCharacter(id) ?: throw IllegalArgumentException("unknown character: $id")
        dao.upsertCharacter(character.copy(name = trimmed))
    }

    fun referenceAvailability(assetRevisionId: String): String {
        val revision = dao.getRevision(assetRevisionId) ?: return "missing"
        val asset = dao.getAsset(revision.assetId) ?: return "missing"
        if (asset.kind != "image" || asset.state != "available") {
            return "missing"
        }
        val physical = dao.getPhysical(revision.sha256) ?: return "missing"
        val file = resolveFile(physical.relativePath)
        if (!file.isFile) {
            return "missing"
        }
        return "available"
    }

    private fun revisionToJson(revision: CharacterRevisionEntity): JSONObject {
        val parsed =
            ArchiveCharacterRevision(
                id = revision.id,
                characterId = revision.characterId,
                parentRevisionId = revision.parentRevisionId,
                identityNotes = revision.identityNotes,
                references = CharacterJson.parseReferences(revision.referencesJson),
            )
        return CharacterJson.encodeRevision(parsed)
    }

    // ---- portable archive support -------------------------------------------

    /** Live (`trashedAt == null`), available assets plus their closure, per the backup trash policy. */
    data class ArchiveSnapshot(
        val assets: List<AssetEntity>,
        val revisions: List<RevisionEntity>,
        val collectionMembers: List<CollectionMemberEntity>,
        val assetTags: List<AssetTagEntity>,
        val physicalBySha: Map<String, PhysicalObjectEntity>,
        val characters: List<ArchiveCharacter> = emptyList(),
        val looks: List<ArchiveLook> = emptyList(),
    )

    fun archiveSnapshot(characterId: String? = null): ArchiveSnapshot {
        val packedCharacters = packArchiveCharacters(characterId)
        val assets =
            if (characterId == null) {
                dao.listAssets().filter { it.state == "available" && it.trashedAt == null && it.sha256.isNotEmpty() }
            } else {
                // Match web character packages: include referenced originals even when they
                // would be omitted from a full-library live set (trashed), as long as they
                // are still available. Missing and pending files are omitted.
                val wanted = packedCharacters.referencedAssetRevisionIds
                val wantedAssetIds =
                    dao.listRevisions().filter { wanted.contains(it.id) }.map { it.assetId }.toHashSet()
                dao.listAssets().filter { wantedAssetIds.contains(it.id) && CharacterJson.includeInCharacterPackage(it.state) }
            }
        val assetIds = assets.map { it.id }.toHashSet()
        val revisions = dao.listRevisions().filter { assetIds.contains(it.assetId) }
        val members = dao.listAllCollectionMembers().filter { assetIds.contains(it.assetId) }
        val tags = dao.listAllAssetTags().filter { assetIds.contains(it.assetId) }
        val physical = HashMap<String, PhysicalObjectEntity>()
        for (asset in assets) {
            if (!physical.containsKey(asset.sha256)) {
                val obj = dao.getPhysical(asset.sha256)
                if (obj != null) {
                    physical[asset.sha256] = obj
                }
            }
        }
        for (revision in revisions) {
            if (!physical.containsKey(revision.sha256)) {
                val obj = dao.getPhysical(revision.sha256)
                if (obj != null) {
                    physical[revision.sha256] = obj
                }
            }
        }
        return ArchiveSnapshot(
            assets,
            revisions,
            if (characterId == null) members else emptyList(),
            if (characterId == null) tags else emptyList(),
            physical,
            packedCharacters.characters,
            packedCharacters.looks,
        )
    }

    private data class PackedCharacters(
        val characters: List<ArchiveCharacter>,
        val looks: List<ArchiveLook>,
        val referencedAssetRevisionIds: Set<String>,
    )

    private fun packArchiveCharacters(characterId: String?): PackedCharacters {
        val entities =
            if (characterId == null) {
                dao.listCharacters()
            } else {
                listOf(dao.getCharacter(characterId) ?: throw IllegalArgumentException("unknown character: $characterId"))
            }
        val referenced = HashSet<String>()
        val characters = ArrayList<ArchiveCharacter>(entities.size)
        for (entity in entities) {
            val revisions =
                dao.listCharacterRevisions(entity.id).map { row ->
                    ArchiveCharacterRevision(
                        id = row.id,
                        characterId = row.characterId,
                        parentRevisionId = row.parentRevisionId,
                        identityNotes = row.identityNotes,
                        references = CharacterJson.parseReferences(row.referencesJson),
                    )
                }
            if (!entity.coverAssetRevisionId.isNullOrEmpty()) {
                referenced.add(entity.coverAssetRevisionId)
            }
            for (revision in revisions) {
                for (reference in revision.references) {
                    referenced.add(reference.assetRevisionId)
                }
            }
            characters.add(
                ArchiveCharacter(
                    id = entity.id,
                    name = entity.name,
                    currentRevisionId = entity.currentRevisionId,
                    coverAssetRevisionId = entity.coverAssetRevisionId,
                    createdAt = entity.createdAt,
                    revisions = revisions,
                ),
            )
        }
        val lookEntities =
            if (characterId == null) dao.listAllLooks() else dao.listLooks(characterId)
        val looks =
            lookEntities.map { look ->
                val ids = CharacterJson.parseRevisionIds(look.referenceRevisionIdsJson)
                referenced.addAll(ids)
                ArchiveLook(
                    id = look.id,
                    characterId = look.characterId,
                    label = look.label,
                    notes = look.notes,
                    referenceRevisionIds = ids,
                )
            }
        return PackedCharacters(characters, looks, referenced)
    }

    /** Same ID universe as the web importer's `existingLogicalIds`. */
    fun existingLogicalIds(): Set<String> {
        val ids = HashSet<String>()
        for (asset in dao.listAssets()) {
            ids.add(asset.id)
            ids.add(asset.revisionId)
            val folder = asset.folderId
            if (!folder.isNullOrEmpty()) {
                ids.add(folder)
            }
        }
        for (revision in dao.listRevisions()) {
            ids.add(revision.id)
            ids.add(revision.assetId)
        }
        for (member in dao.listAllCollectionMembers()) {
            ids.add(member.collectionId)
            ids.add(member.assetId)
        }
        for (character in dao.listCharacters()) {
            ids.add(character.id)
            ids.add(character.currentRevisionId)
            val cover = character.coverAssetRevisionId
            if (!cover.isNullOrEmpty()) {
                ids.add(cover)
            }
        }
        for (revision in dao.listAllCharacterRevisions()) {
            ids.add(revision.id)
            ids.add(revision.characterId)
            val parent = revision.parentRevisionId
            if (!parent.isNullOrEmpty()) {
                ids.add(parent)
            }
            for (reference in CharacterJson.parseReferences(revision.referencesJson)) {
                ids.add(reference.assetRevisionId)
            }
        }
        for (look in dao.listAllLooks()) {
            ids.add(look.id)
            ids.add(look.characterId)
            ids.addAll(CharacterJson.parseRevisionIds(look.referenceRevisionIdsJson))
        }
        return ids
    }

    /** Physical row present, file exists, and length + SHA-256 still match. */
    fun hasIntactPhysical(sha256: String): Boolean {
        val physical = dao.getPhysical(sha256) ?: return false
        return MediaValidator.objectMatches(resolveFile(physical.relativePath), sha256, physical.byteLength)
    }

    /** Bytes we will copy from a user URI before refusing, leaving headroom on the volume. */
    fun copyBudgetBytes(): Long {
        val reserve = 64L * 1024L * 1024L
        val available = availableBytes() ?: return ArchivePaths.MAX_ARCHIVE_EXPANDED_BYTES
        val usable = if (available <= reserve) available.coerceAtLeast(1L) else available - reserve
        return minOf(ArchivePaths.MAX_ARCHIVE_EXPANDED_BYTES, usable)
    }

    /** Private scratch directory under `library/tmp`; callers delete it when done. */
    fun createScratchDir(prefix: String): File {
        val dir = File(File(rootDir, "tmp"), "$prefix-${UUID.randomUUID()}")
        if (!dir.mkdirs() && !dir.isDirectory) {
            throw IllegalStateException("unable to create scratch directory")
        }
        return dir
    }

    fun writeArchiveImportJournal(promotedSha256: List<String>, scratchDirNames: List<String>) {
        val o = JSONObject()
        o.put("promoted", JSONArray(promotedSha256))
        o.put("scratch", JSONArray(scratchDirNames))
        archiveImportJournalFile().writeText(o.toString())
    }

    fun clearArchiveImportJournal() {
        archiveImportJournalFile().delete()
    }

    fun journalPendingPublication(uri: String, deleteIfIncomplete: Boolean) {
        val o = JSONObject()
        o.put("uri", uri)
        o.put("deleteIfIncomplete", deleteIfIncomplete)
        pendingPublicationFile().writeText(o.toString())
    }

    fun clearPendingPublication() {
        pendingPublicationFile().delete()
    }

    fun reconcileArchiveScratch() {
        val journal = archiveImportJournalFile()
        if (journal.isFile) {
            try {
                val o = JSONObject(journal.readText())
                val promoted = o.optJSONArray("promoted")
                if (promoted != null) {
                    for (i in 0 until promoted.length()) {
                        purgeUnreferencedPhysical(promoted.getString(i))
                    }
                }
                val scratch = o.optJSONArray("scratch")
                if (scratch != null) {
                    for (i in 0 until scratch.length()) {
                        File(File(rootDir, "tmp"), scratch.getString(i)).deleteRecursively()
                    }
                }
            } catch (_: Exception) {
                // journal is best-effort recovery; leftover dirs are swept below
            }
            journal.delete()
        }
        File(rootDir, "tmp").listFiles()?.forEach { child ->
            if (child.isDirectory && child.name.startsWith("archive-")) {
                child.deleteRecursively()
            }
        }
    }

    fun reconcilePendingPublications() {
        val file = pendingPublicationFile()
        if (file.isFile) {
            try {
                val o = JSONObject(file.readText())
                if (o.optBoolean("deleteIfIncomplete", true)) {
                    deletePublishedQuietly(Uri.parse(o.getString("uri")))
                }
            } catch (_: Exception) {
                // best effort
            }
            file.delete()
        }
        reconcilePendingMediaStoreRows()
    }

    fun deletePublishedQuietly(uri: Uri) {
        try {
            if (uri.scheme == "file") {
                uri.path?.let { File(it).delete() }
            } else if (DocumentsContract.isDocumentUri(context, uri)) {
                DocumentsContract.deleteDocument(context.contentResolver, uri)
            } else {
                context.contentResolver.delete(uri, null, null)
            }
        } catch (_: Exception) {
            // best effort
        }
    }

    private fun archiveImportJournalFile(): File = File(File(rootDir, "tmp"), "archive-import-journal.json")

    private fun pendingPublicationFile(): File = File(File(rootDir, "tmp"), "pending-publication.json")

    private fun reconcilePendingMediaStoreRows() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return
        }
        val resolver = context.contentResolver
        val collections =
            listOf(
                MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
            )
        val projection =
            arrayOf(
                MediaStore.MediaColumns._ID,
                MediaStore.MediaColumns.RELATIVE_PATH,
            )
        for (collection in collections) {
            try {
                resolver
                    .query(
                        collection,
                        projection,
                        "${MediaStore.MediaColumns.IS_PENDING}=1",
                        null,
                        null,
                    )?.use { cursor ->
                        val idCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                        val pathCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.RELATIVE_PATH)
                        while (cursor.moveToNext()) {
                            val path = cursor.getString(pathCol) ?: continue
                            if (!path.contains(MediaExporter.APP_FOLDER)) {
                                continue
                            }
                            val uri = ContentUris.withAppendedId(collection, cursor.getLong(idCol))
                            try {
                                resolver.delete(uri, null, null)
                            } catch (_: Exception) {
                                // best effort
                            }
                        }
                    }
            } catch (_: Exception) {
                // collection may be unavailable on this emulator image
            }
        }
    }

    /**
     * Promote a verified staged file into `objects/`. Idempotent when the
     * object already exists and matches. Returns the relative path for the physical row.
     */
    fun promoteStagedFile(staged: File, sha256: String): String {
        val relative = LibraryPaths.finalRelativePath(sha256)
        val dest = resolveFile(relative)
        dest.parentFile?.mkdirs()
        if (dest.isFile) {
            if (MediaValidator.objectMatches(dest, sha256, dest.length())) {
                staged.delete()
                return relative
            }
            dest.delete()
        }
        if (!staged.isFile) {
            throw IllegalStateException("staged file missing for promote")
        }
        if (!staged.renameTo(dest)) {
            FileInputStream(staged).use { input ->
                FileOutputStream(dest).use { output -> input.copyTo(output) }
            }
            staged.delete()
        }
        return relative
    }

    /** One Room transaction: physical rows, assets, revisions, memberships, tags. */
    fun commitArchiveImport(
        physicals: List<PhysicalObjectEntity>,
        assets: List<AssetEntity>,
        revisions: List<RevisionEntity>,
        collectionMembers: List<CollectionMemberEntity>,
        assetTags: List<AssetTagEntity>,
        characters: List<CharacterEntity> = emptyList(),
        characterRevisions: List<CharacterRevisionEntity> = emptyList(),
        looks: List<LookEntity> = emptyList(),
    ) {
        db.runInTransaction {
            for (physical in physicals) {
                require(physical.byteLength >= 0L) { "byte_length must be >= 0" }
                dao.upsertPhysical(physical)
            }
            for (asset in assets) {
                require(asset.state == "available") { "archive assets must be available" }
                require(asset.sha256.isNotEmpty()) { "archive assets require sha256" }
                dao.upsertAsset(asset)
            }
            for (revision in revisions) {
                dao.upsertRevision(revision)
            }
            for (member in collectionMembers) {
                dao.insertCollectionMember(member)
            }
            for (tag in assetTags) {
                dao.insertAssetTag(tag)
            }
            for (character in characters) {
                dao.upsertCharacter(character)
            }
            for (revision in characterRevisions) {
                dao.upsertCharacterRevision(revision)
            }
            for (look in looks) {
                dao.upsertLook(look)
            }
        }
    }

    /** Drop a promoted object that gained no revision references (import rollback). */
    fun purgeUnreferencedPhysical(sha256: String) {
        if (dao.countRevisionsWithHash(sha256) != 0) {
            return
        }
        resolveFile(LibraryPaths.finalRelativePath(sha256)).delete()
        if (dao.getPhysical(sha256) != null) {
            dao.deletePhysical(sha256)
        }
    }

    fun openRevisionRead(revisionId: String): JSONObject {
        val revision =
            dao.getRevision(revisionId)
                ?: throw IllegalArgumentException("unknown revision: $revisionId")
        val physical =
            dao.getPhysical(revision.sha256)
                ?: throw IllegalArgumentException("missing physical object for ${revision.sha256}")
        val file = resolveFile(physical.relativePath)
        if (!file.isFile) {
            throw IllegalStateException("missing file for revision $revisionId")
        }
        val asset = dao.getAsset(revision.assetId)
        val mime = asset?.mime ?: "application/octet-stream"
        val readId = UUID.randomUUID().toString()
        val input = BufferedInputStream(FileInputStream(file))
        openReads[readId] = OpenRead(input, physical.byteLength, mime)
        val o = JSONObject()
        o.put("readId", readId)
        o.put("byteLength", physical.byteLength)
        o.put("mime", mime)
        return o
    }

    fun readRevisionChunk(readId: String, maxBytes: Int): JSONObject {
        val session =
            openReads[readId]
                ?: throw IllegalArgumentException("unknown readId")
        val limit = maxBytes.coerceIn(1, 1024 * 1024)
        val buffer = ByteArray(limit)
        val read = session.input.read(buffer)
        val o = JSONObject()
        if (read < 0) {
            o.put("done", true)
            o.put("data", JSONObject.NULL)
            closeRevisionRead(readId)
            return o
        }
        val slice = buffer.copyOf(read)
        o.put("done", false)
        o.put("data", android.util.Base64.encodeToString(slice, android.util.Base64.NO_WRAP))
        return o
    }

    fun closeRevisionRead(readId: String) {
        val session = openReads.remove(readId) ?: return
        try {
            session.input.close()
        } catch (_: Exception) {
            // ignore
        }
    }

    fun reconcileImports(): ReconcileResult {
        var repaired = 0
        val missing = mutableListOf<String>()
        for (entry in dao.listJournal()) {
            try {
                if (reconcileOne(entry)) {
                    repaired += 1
                }
            } catch (_: Exception) {
                missing.add(entry.assetId)
                abandonImport(entry)
            }
        }
        return ReconcileResult(repaired, missing)
    }

    fun storageUsage(): JSONObject {
        val hashes = linkedSetOf<String>()
        for (asset in dao.listAssets()) {
            if (asset.state == "available" && asset.sha256.isNotEmpty()) {
                hashes.add(asset.sha256)
            }
        }
        var originals = 0L
        for (hash in hashes) {
            val obj = dao.getPhysical(hash)
            if (obj != null) {
                originals += obj.byteLength
            }
        }
        val o = JSONObject()
        o.put("originals", originals)
        o.put("cache", 0)
        val available = availableBytes()
        if (available != null) {
            o.put("available", available)
        } else {
            o.put("available", JSONObject.NULL)
        }
        return o
    }

    fun queryAssets(query: JSONObject): JSONObject {
        val sort = query.optString("sort", "createdAt-desc")
        val limit = query.optInt("limit", 50).coerceIn(1, 500)
        val wantTrashed = query.optBoolean("trashed", false)
        val text = query.optString("text", "").ifBlank { null }
        val kind = if (query.has("kind") && !query.isNull("kind")) query.getString("kind") else null
        val favorite =
            if (query.has("favorite") && !query.isNull("favorite")) {
                query.getBoolean("favorite")
            } else {
                null
            }
        val folderFilterActive = query.has("folderId")
        val folderId: String? =
            if (!folderFilterActive || query.isNull("folderId")) {
                null
            } else {
                query.getString("folderId")
            }
        val collectionId =
            if (query.has("collectionId") && !query.isNull("collectionId")) {
                query.getString("collectionId")
            } else {
                null
            }
        val tags = mutableListOf<String>()
        if (query.has("tags") && !query.isNull("tags")) {
            val arr = query.getJSONArray("tags")
            for (i in 0 until arr.length()) {
                tags.add(arr.getString(i))
            }
        }
        val cursor = query.optString("cursor", "").ifBlank { null }

        var assets = dao.listAssets().map { toDto(it) }
        assets = assets.filter { it.state == "available" }
        assets =
            assets.filter {
                if (wantTrashed) it.trashedAt != null else it.trashedAt == null
            }
        if (kind != null) {
            assets = assets.filter { it.kind == kind }
        }
        if (favorite != null) {
            assets = assets.filter { it.favorite == favorite }
        }
        if (folderFilterActive) {
            assets = assets.filter { it.folderId == folderId }
        }
        if (text != null) {
            val needle = text.lowercase()
            assets = assets.filter { it.name.lowercase().contains(needle) }
        }
        if (collectionId != null) {
            val ids =
                dao.listCollectionMembers(collectionId).map { it.assetId }.toSet()
            assets = assets.filter { ids.contains(it.id) }
        }
        if (tags.isNotEmpty()) {
            val allTags = dao.listAllAssetTags()
            val byAsset = HashMap<String, HashSet<String>>()
            for (row in allTags) {
                byAsset.getOrPut(row.assetId) { HashSet() }.add(row.tag)
            }
            assets =
                assets.filter { asset ->
                    val set = byAsset[asset.id] ?: return@filter false
                    tags.all { set.contains(it) }
                }
        }

        assets = assets.sortedWith(assetComparator(sort))

        if (cursor != null) {
            val decoded = decodeCursor(cursor)
            assets = assets.filter { afterCursor(it, sort, decoded) }
        }

        val page = assets.take(limit)
        val result = JSONObject()
        val arr = JSONArray()
        for (a in page) {
            arr.put(a.toJson())
        }
        result.put("assets", arr)
        if (assets.size > limit) {
            val last = page.last()
            result.put(
                "nextCursor",
                encodeCursor(sortValueFor(last, sort), last.id),
            )
        } else {
            result.put("nextCursor", JSONObject.NULL)
        }
        return result
    }

    fun applyLibraryAction(request: JSONObject) {
        val action = request.getString("action")
        val idsArr = request.getJSONArray("assetIds")
        val assetIds = mutableListOf<String>()
        for (i in 0 until idsArr.length()) {
            assetIds.add(idsArr.getString(i))
        }
        require(assetIds.isNotEmpty()) { "assetIds required" }

        when (action) {
            "tag" -> {
                val tag = request.getString("value")
                require(tag.isNotBlank()) { "tag value required" }
                for (id in assetIds) {
                    dao.insertAssetTag(AssetTagEntity(id, tag))
                }
            }
            "untag" -> {
                val tag = request.getString("value")
                for (id in assetIds) {
                    dao.deleteAssetTag(id, tag)
                }
            }
            "favorite" -> {
                val value = request.getBoolean("value")
                for (id in assetIds) {
                    val asset = dao.getAsset(id) ?: continue
                    dao.updateAsset(asset.copy(favorite = value))
                }
            }
            "rating" -> {
                val rating =
                    if (request.isNull("value")) {
                        null
                    } else {
                        request.getInt("value").also {
                            require(it in 0..5) { "rating must be 0–5" }
                        }
                    }
                for (id in assetIds) {
                    val asset = dao.getAsset(id) ?: continue
                    dao.updateAsset(asset.copy(rating = rating))
                }
            }
            "collection" -> {
                val collectionId = request.getString("value")
                for (id in assetIds) {
                    dao.insertCollectionMember(CollectionMemberEntity(collectionId, id))
                }
            }
            "remove-from-collection" -> {
                val collectionId = request.getString("value")
                for (id in assetIds) {
                    dao.deleteCollectionMember(collectionId, id)
                }
            }
            "folder" -> {
                val folderId =
                    if (request.isNull("value")) null else request.getString("value")
                for (id in assetIds) {
                    val asset = dao.getAsset(id) ?: continue
                    dao.updateAsset(asset.copy(folderId = folderId))
                }
            }
            "trash" -> {
                val now = Instant.now().toString()
                for (id in assetIds) {
                    val asset = dao.getAsset(id) ?: continue
                    if (asset.trashedAt == null) {
                        dao.updateAsset(asset.copy(trashedAt = now))
                    }
                }
            }
            "restore" -> {
                for (id in assetIds) {
                    val asset = dao.getAsset(id) ?: continue
                    dao.updateAsset(asset.copy(trashedAt = null))
                }
            }
            "permanent-delete" -> {
                for (id in assetIds) {
                    permanentDelete(id)
                }
            }
            else -> throw IllegalArgumentException("unsupported action: $action")
        }
    }

    private fun permanentDelete(assetId: String) {
        val asset =
            dao.getAsset(assetId)
                ?: return
        require(asset.trashedAt != null) {
            "permanent-delete requires prior soft trash"
        }
        val revision = dao.getRevision(asset.revisionId)
        val sha = revision?.sha256 ?: asset.sha256
        dao.deleteCollectionMembersForAsset(assetId)
        dao.deleteAssetTagsForAsset(assetId)
        dao.deleteRevisionsForAsset(assetId)
        dao.deleteAsset(assetId)
        if (sha.isNotEmpty() && dao.countRevisionsWithHash(sha) == 0) {
            val physical = dao.getPhysical(sha)
            if (physical != null) {
                resolveFile(physical.relativePath).delete()
                dao.deletePhysical(sha)
            }
        }
    }

    private fun reconcileOne(entry: ImportJournalEntity): Boolean {
        when (entry.stage) {
            "pending" -> {
                abandonImport(entry)
                return true
            }
            "written" -> {
                val hash = entry.finalHash
                if (hash.isNullOrBlank()) {
                    abandonImport(entry)
                    return true
                }
                val finalPath = LibraryPaths.finalRelativePath(hash)
                if (resolveFile(finalPath).isFile) {
                    finishFromHash(entry, hash)
                    return true
                }
                if (!resolveFile(entry.tempPath).isFile) {
                    abandonImport(entry)
                    return true
                }
                // Re-hash temp and promote.
                val tempFile = resolveFile(entry.tempPath)
                val digest =
                    FileInputStream(tempFile).use { input ->
                        val md = java.security.MessageDigest.getInstance("SHA-256")
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) {
                                break
                            }
                            if (n > 0) {
                                md.update(buf, 0, n)
                            }
                        }
                        md.digest().joinToString("") { b -> "%02x".format(b) }
                    }
                if (digest != hash) {
                    abandonImport(entry)
                    return true
                }
                promoteTemp(entry.tempPath, hash)
                finishFromHash(entry, hash)
                return true
            }
            "promoted" -> {
                val hash = entry.finalHash
                if (hash.isNullOrBlank()) {
                    abandonImport(entry)
                    return true
                }
                val finalPath = LibraryPaths.finalRelativePath(hash)
                if (!resolveFile(finalPath).isFile) {
                    if (resolveFile(entry.tempPath).isFile) {
                        promoteTemp(entry.tempPath, hash)
                    } else {
                        abandonImport(entry)
                        return true
                    }
                }
                finishFromHash(entry, hash)
                return true
            }
            else -> {
                abandonImport(entry)
                return true
            }
        }
    }

    private fun finishFromHash(entry: ImportJournalEntity, sha256: String) {
        val finalPath = LibraryPaths.finalRelativePath(sha256)
        val file = resolveFile(finalPath)
        require(file.isFile) { "final object missing for $sha256" }
        val byteLength = file.length()
        val existing = dao.getAsset(entry.assetId)
        val available =
            AssetEntity(
                id = entry.assetId,
                revisionId = entry.revisionId,
                kind = entry.kind,
                name = entry.name,
                mime = entry.mime,
                sha256 = sha256,
                bytes = byteLength,
                state = "available",
                createdAt = entry.createdAt,
                favorite = existing?.favorite ?: false,
                rating = existing?.rating,
                folderId = existing?.folderId,
                trashedAt = existing?.trashedAt,
            )
        dao.commitAvailable(
            asset = available,
            revision =
                RevisionEntity(
                    id = entry.revisionId,
                    assetId = entry.assetId,
                    sha256 = sha256,
                    createdAt = entry.createdAt,
                ),
            physical =
                PhysicalObjectEntity(
                    sha256 = sha256,
                    relativePath = finalPath,
                    byteLength = byteLength,
                ),
            importId = entry.importId,
        )
        // Temp may still exist after promote if promote short-circuited.
        resolveFile(entry.tempPath).delete()
    }

    private fun abandonImport(entry: ImportJournalEntity) {
        resolveFile(entry.tempPath).delete()
        val hash = entry.finalHash
        if (!hash.isNullOrBlank()) {
            if (dao.countRevisionsWithHash(hash) == 0) {
                val finalPath = LibraryPaths.finalRelativePath(hash)
                resolveFile(finalPath).delete()
                if (dao.getPhysical(hash) != null) {
                    dao.deletePhysical(hash)
                }
            }
        }
        val asset = dao.getAsset(entry.assetId)
        if (asset != null && asset.state != "available") {
            dao.deleteAsset(entry.assetId)
        }
        dao.deleteJournal(entry.importId)
    }

    /**
     * Promote temp → content-addressed final path. Idempotent when the final
     * object already exists (shared-hash dedupe).
     */
    private fun promoteTemp(tempPath: String, sha256: String): String {
        val relative = LibraryPaths.finalRelativePath(sha256)
        val dest = resolveFile(relative)
        dest.parentFile?.mkdirs()
        val temp = resolveFile(tempPath)
        if (dest.isFile) {
            if (MediaValidator.objectMatches(dest, sha256, dest.length())) {
                temp.delete()
                return relative
            }
            dest.delete()
        }
        if (!temp.isFile) {
            throw IllegalStateException("temp missing for promote: $tempPath")
        }
        // Prefer atomic rename within the same filesystem.
        if (!temp.renameTo(dest)) {
            FileInputStream(temp).use { input ->
                FileOutputStream(dest).use { output ->
                    input.copyTo(output)
                }
            }
            temp.delete()
        }
        return relative
    }


    private fun openUriInput(uri: Uri): InputStream {
        return when (uri.scheme) {
            "file" -> {
                val path = uri.path ?: throw IllegalArgumentException("file uri missing path")
                FileInputStream(File(path))
            }
            else ->
                context.contentResolver.openInputStream(uri)
                    ?: throw IllegalArgumentException("unable to open uri: $uri")
        }
    }

    private fun availableBytes(): Long? {
        return try {
            val stat = StatFs(rootDir.absolutePath)
            stat.availableBlocksLong * stat.blockSizeLong
        } catch (_: Exception) {
            null
        }
    }

    private fun toDto(asset: AssetEntity) =
        AssetRecordDto(
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

    private fun kindFromMime(mime: String): String =
        when {
            mime.startsWith("image/") -> "image"
            mime.startsWith("video/") -> "video"
            mime.startsWith("audio/") -> "audio"
            else -> "embedding"
        }

    private data class CursorPayload(val sortValue: String, val id: String)

    private fun encodeCursor(sortValue: String, id: String): String {
        val json = JSONObject()
        json.put("sortValue", sortValue)
        json.put("id", id)
        return android.util.Base64.encodeToString(
            json.toString().toByteArray(Charsets.UTF_8),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP,
        )
    }

    private fun decodeCursor(cursor: String): CursorPayload {
        val raw =
            String(
                android.util.Base64.decode(
                    cursor,
                    android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP,
                ),
                Charsets.UTF_8,
            )
        val json = JSONObject(raw)
        return CursorPayload(json.getString("sortValue"), json.getString("id"))
    }

    private fun sortValueFor(asset: AssetRecordDto, sort: String): String =
        when (sort) {
            "createdAt-asc", "createdAt-desc" -> asset.createdAt
            "name-asc", "name-desc" -> asset.name
            else -> asset.createdAt
        }

    private fun assetComparator(sort: String): Comparator<AssetRecordDto> =
        Comparator { a, b ->
            val primary =
                when (sort) {
                    "createdAt-asc" -> a.createdAt.compareTo(b.createdAt)
                    "createdAt-desc" -> b.createdAt.compareTo(a.createdAt)
                    "name-asc" -> a.name.compareTo(b.name, ignoreCase = true)
                    "name-desc" -> b.name.compareTo(a.name, ignoreCase = true)
                    else -> b.createdAt.compareTo(a.createdAt)
                }
            if (primary != 0) primary else a.id.compareTo(b.id)
        }

    private fun afterCursor(
        asset: AssetRecordDto,
        sort: String,
        cursor: CursorPayload,
    ): Boolean {
        val value = sortValueFor(asset, sort)
        val cmp =
            when (sort) {
                "createdAt-asc", "name-asc" -> value.compareTo(cursor.sortValue)
                else -> cursor.sortValue.compareTo(value)
            }
        return when {
            cmp > 0 -> true
            cmp < 0 -> false
            else -> asset.id > cursor.id
        }
    }
}
