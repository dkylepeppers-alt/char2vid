package com.char2vid.studio.library

import android.content.Context
import android.net.Uri
import android.os.StatFs
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
    private val rootDir: File =
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

    fun reconcileOnStart(): ReconcileResult = reconcileImports()

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
            temp.delete()
            return relative
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
