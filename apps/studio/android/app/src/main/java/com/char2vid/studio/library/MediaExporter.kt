package com.char2vid.studio.library

import android.Manifest
import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.annotation.RequiresApi
import androidx.core.content.FileProvider
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.OutputStream
import java.util.UUID

/**
 * G3 native save transaction, independent of the Capacitor plugin surface so
 * instrumentation can drive it directly:
 *
 * ```
 * resolve immutable revision -> open source stream
 * create pending MediaStore destination (gallery) or user-selected SAF document (files)
 * copy natively stream-to-stream, verify byte count + SHA-256 -> publish -> Saved
 * picker cancelled -> Cancelled
 * copy/verify failure -> remove incomplete destination -> preserve source -> throw
 * share -> stage under library/share -> FileProvider URI with temporary read grant -> Shared
 * ```
 *
 * Whole files never pass through JavaScript.
 */
class MediaExporter(
    private val context: Context,
    private val repo: MediaStoreRepository,
) {
    sealed class Outcome {
        data class Saved(val uri: Uri, val displayName: String) : Outcome()

        object Cancelled : Outcome()

        data class Shared(
            val uri: Uri,
            val displayName: String,
            val mime: String,
            val stagedFile: File,
        ) : Outcome()
    }

    private val resolver = context.contentResolver

    /** Resolve a revision (throws `unknown_revision` / `missing_file`). */
    fun resolveSource(revisionId: String): MediaStoreRepository.RevisionSource = repo.resolveRevisionSource(revisionId)

    /**
     * True when `gallery` can be honoured through MediaStore. API 29+ always can
     * (scoped storage, `IS_PENDING`). API 26–28 only when the legacy
     * WRITE_EXTERNAL_STORAGE grant is present; otherwise callers fall back to
     * SAF. Non-media kinds (embeddings) never belong in system media collections.
     */
    fun galleryUsesMediaStore(kind: String): Boolean {
        if (kind != "image" && kind != "video" && kind != "audio") {
            return false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return true
        }
        return context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
            PackageManager.PERMISSION_GRANTED
    }

    fun exportToGallery(revisionId: String): Outcome.Saved {
        val source = repo.resolveRevisionSource(revisionId)
        if (!galleryUsesMediaStore(source.kind)) {
            throw LibraryException(
                LibraryException.UNSUPPORTED_DESTINATION,
                "gallery destination unavailable for kind ${source.kind} on API ${Build.VERSION.SDK_INT}",
            )
        }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            exportToMediaStorePending(source)
        } else {
            exportToLegacyExternalStorage(source)
        }
    }

    fun createDocumentIntent(revisionId: String): Intent {
        val source = repo.resolveRevisionSource(revisionId)
        return Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = source.mime
            putExtra(Intent.EXTRA_TITLE, safeFileName(source.name, source.mime))
        }
    }

    /**
     * Second half of the SAF flow. `uri == null` means the user dismissed the
     * picker. Failures delete the partially written document so no truncated
     * file remains where the user chose to save.
     */
    fun completeSafExport(revisionId: String, uri: Uri?): Outcome {
        val source = repo.resolveRevisionSource(revisionId)
        if (uri == null) {
            return Outcome.Cancelled
        }
        try {
            copyAndVerify(source, openDestination(uri))
        } catch (error: Exception) {
            deleteDocumentQuietly(uri)
            throw asLibraryException(error)
        }
        return Outcome.Saved(uri, queryDisplayName(uri) ?: safeFileName(source.name, source.mime))
    }

    /**
     * Stage a verified copy under `library/share/<transferId>/` (the only
     * FileProvider-exposed directory) and mint a content URI. The chooser grant
     * is temporary; the original object is never exposed directly.
     */
    fun prepareShare(revisionId: String): Outcome.Shared {
        val source = repo.resolveRevisionSource(revisionId)
        pruneStaleShares()
        val dir = File(shareRoot(), UUID.randomUUID().toString())
        if (!dir.mkdirs() && !dir.isDirectory) {
            throw LibraryException(LibraryException.DESTINATION_UNAVAILABLE, "unable to create share staging directory")
        }
        val displayName = safeFileName(source.name, source.mime)
        val target = File(dir, displayName)
        try {
            copyAndVerify(source, FileOutputStream(target))
        } catch (error: Exception) {
            dir.deleteRecursively()
            throw asLibraryException(error)
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", target)
        return Outcome.Shared(uri, displayName, source.mime, target)
    }

    fun buildShareChooser(shared: Outcome.Shared): Intent {
        val send =
            Intent(Intent.ACTION_SEND).apply {
                type = shared.mime
                putExtra(Intent.EXTRA_STREAM, shared.uri)
                clipData = ClipData.newUri(resolver, shared.displayName, shared.uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        return Intent.createChooser(send, null).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    // ---- gallery: API 29+ -----------------------------------------------------

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun exportToMediaStorePending(source: MediaStoreRepository.RevisionSource): Outcome.Saved {
        val collection =
            when (source.kind) {
                "image" -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                "video" -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                "audio" -> MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                else -> throw LibraryException(LibraryException.UNSUPPORTED_DESTINATION, "not a media kind")
            }
        val values =
            ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, safeFileName(source.name, source.mime))
                put(MediaStore.MediaColumns.MIME_TYPE, source.mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, "${publicDirectoryFor(source.kind)}/$APP_FOLDER")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
        val uri =
            resolver.insert(collection, values)
                ?: throw LibraryException(LibraryException.DESTINATION_UNAVAILABLE, "MediaStore refused a pending row")
        try {
            val output =
                resolver.openOutputStream(uri, "w")
                    ?: throw LibraryException(LibraryException.DESTINATION_UNAVAILABLE, "unable to open pending row")
            copyAndVerify(source, output)
            val publish = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
            if (resolver.update(uri, publish, null, null) != 1) {
                throw LibraryException(LibraryException.COPY_FAILED, "unable to publish MediaStore row")
            }
        } catch (error: Exception) {
            try {
                resolver.delete(uri, null, null)
            } catch (_: Exception) {
                // incomplete row removal is best effort; source is untouched
            }
            throw asLibraryException(error)
        }
        return Outcome.Saved(uri, queryDisplayName(uri) ?: safeFileName(source.name, source.mime))
    }

    // ---- gallery: API 26–28 with WRITE_EXTERNAL_STORAGE --------------------------

    @Suppress("DEPRECATION")
    private fun exportToLegacyExternalStorage(source: MediaStoreRepository.RevisionSource): Outcome.Saved {
        val dir = File(Environment.getExternalStoragePublicDirectory(publicDirectoryFor(source.kind)), APP_FOLDER)
        if (!dir.mkdirs() && !dir.isDirectory) {
            throw LibraryException(LibraryException.DESTINATION_UNAVAILABLE, "unable to create public media folder")
        }
        val target = uniqueFile(dir, safeFileName(source.name, source.mime))
        val partial = File(dir, "${target.name}.part")
        try {
            copyAndVerify(source, FileOutputStream(partial))
            if (!partial.renameTo(target)) {
                throw LibraryException(LibraryException.COPY_FAILED, "unable to finalize public media file")
            }
        } catch (error: Exception) {
            partial.delete()
            throw asLibraryException(error)
        }
        val collection =
            when (source.kind) {
                "image" -> MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                "video" -> MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                "audio" -> MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
                else -> throw LibraryException(LibraryException.UNSUPPORTED_DESTINATION, "not a media kind")
            }
        val values =
            ContentValues().apply {
                put(MediaStore.MediaColumns.DATA, target.absolutePath)
                put(MediaStore.MediaColumns.DISPLAY_NAME, target.name)
                put(MediaStore.MediaColumns.MIME_TYPE, source.mime)
                put(MediaStore.MediaColumns.SIZE, source.byteLength)
            }
        val uri =
            try {
                resolver.insert(collection, values)
            } catch (error: Exception) {
                target.delete()
                throw asLibraryException(error)
            }
        if (uri == null) {
            target.delete()
            throw LibraryException(LibraryException.DESTINATION_UNAVAILABLE, "MediaStore refused the legacy row")
        }
        return Outcome.Saved(uri, target.name)
    }

    // ---- helpers ------------------------------------------------------------------

    private fun openDestination(uri: Uri): OutputStream {
        if (uri.scheme == "file") {
            val path =
                uri.path
                    ?: throw LibraryException(LibraryException.DESTINATION_UNAVAILABLE, "file uri missing path")
            return FileOutputStream(File(path))
        }
        return resolver.openOutputStream(uri, "wt")
            ?: throw LibraryException(LibraryException.DESTINATION_UNAVAILABLE, "unable to open destination")
    }

    /** Stream copy with SHA-256; closes [output]. Throws on byte-count or digest mismatch. */
    private fun copyAndVerify(source: MediaStoreRepository.RevisionSource, output: OutputStream) {
        val hashed =
            BufferedInputStream(FileInputStream(source.file)).use { input ->
                BufferedOutputStream(output).use { out ->
                    val result = MediaValidator.hashCopy(input, out)
                    out.flush()
                    result
                }
            }
        if (hashed.byteLength != source.byteLength) {
            throw LibraryException(
                LibraryException.VERIFICATION_FAILED,
                "byte count mismatch: expected ${source.byteLength}, wrote ${hashed.byteLength}",
            )
        }
        if (hashed.sha256 != source.sha256) {
            throw LibraryException(LibraryException.VERIFICATION_FAILED, "SHA-256 mismatch while exporting revision")
        }
    }

    private fun asLibraryException(error: Exception): LibraryException =
        error as? LibraryException
            ?: LibraryException(LibraryException.COPY_FAILED, error.message ?: "export copy failed", error)

    private fun deleteDocumentQuietly(uri: Uri) {
        try {
            if (uri.scheme == "file") {
                uri.path?.let { File(it).delete() }
            } else if (DocumentsContract.isDocumentUri(context, uri)) {
                DocumentsContract.deleteDocument(resolver, uri)
            }
        } catch (_: Exception) {
            // best effort; the caller surfaces the original failure
        }
    }

    private fun queryDisplayName(uri: Uri): String? {
        if (uri.scheme == "file") {
            return uri.lastPathSegment
        }
        return try {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (index >= 0) cursor.getString(index) else null
                } else {
                    null
                }
            }
        } catch (_: Exception) {
            null
        }
    }

    fun shareRoot(): File = File(repo.rootDir, SHARE_DIR).also { it.mkdirs() }

    /** Share staging is transient; drop directories older than [SHARE_TTL_MS]. */
    fun pruneStaleShares() {
        val cutoff = System.currentTimeMillis() - SHARE_TTL_MS
        shareRoot().listFiles()?.forEach { dir ->
            if (dir.lastModified() < cutoff) {
                dir.deleteRecursively()
            }
        }
    }

    private fun uniqueFile(dir: File, name: String): File {
        var candidate = File(dir, name)
        if (!candidate.exists()) {
            return candidate
        }
        val dot = name.lastIndexOf('.')
        val stem = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        var n = 1
        while (candidate.exists()) {
            candidate = File(dir, "$stem ($n)$ext")
            n += 1
        }
        return candidate
    }

    companion object {
        const val APP_FOLDER = "char2vid"
        const val SHARE_DIR = "share"
        private const val SHARE_TTL_MS = 24L * 60L * 60L * 1000L

        fun publicDirectoryFor(kind: String): String =
            when (kind) {
                "video" -> Environment.DIRECTORY_MOVIES
                "audio" -> Environment.DIRECTORY_MUSIC
                else -> Environment.DIRECTORY_PICTURES
            }

        fun extensionForMime(mime: String): String =
            when (mime) {
                "image/png" -> "png"
                "image/jpeg" -> "jpg"
                "image/webp" -> "webp"
                "image/gif" -> "gif"
                "video/mp4" -> "mp4"
                "video/webm" -> "webm"
                "audio/mpeg" -> "mp3"
                "audio/wav", "audio/wave" -> "wav"
                "audio/ogg" -> "ogg"
                else -> "bin"
            }

        /** Strip separators/control characters; guarantee an extension matching the MIME. */
        fun safeFileName(name: String, mime: String): String {
            val cleaned =
                name.replace('\\', '_')
                    .replace('/', '_')
                    .replace(Regex("[\\u0000-\\u001f\\u007f]"), "")
                    .trim()
                    .trimStart('.')
            val base = if (cleaned.isEmpty()) "revision" else cleaned.take(120)
            val ext = extensionForMime(mime)
            val hasExtension = Regex("\\.[A-Za-z0-9]{1,5}$").containsMatchIn(base)
            if (ext == "bin" || hasExtension) {
                return base
            }
            return "$base.$ext"
        }
    }
}
