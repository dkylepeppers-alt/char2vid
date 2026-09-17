package com.char2vid.studio.library

/**
 * Archive member-path rules. Must stay byte-for-byte equivalent in
 * semantics to `validateArchivePath` / `isAllowedArchiveMemberPath` /
 * `mediaArchivePath` in `packages/domain/src/archive-schema.ts`.
 *
 * Schema v1 is library-only. Schema v2 is advertised when character/look
 * records are included so older v1 importers reject instead of dropping them.
 * Current importers accept both versions.
 */
object ArchivePaths {
    const val ARCHIVE_SCHEMA_VERSION = 1
    const val ARCHIVE_SCHEMA_VERSION_WITH_CHARACTERS = 2
    const val MAX_ARCHIVE_FILE_COUNT = 50_000
    const val MAX_ARCHIVE_EXPANDED_BYTES: Long = 2L * 1024L * 1024L * 1024L

    const val MANIFEST_PATH = "manifest.json"
    const val RECORDS_PATH = "records.json"

    fun schemaVersionFor(includeCharacters: Boolean): Int =
        if (includeCharacters) ARCHIVE_SCHEMA_VERSION_WITH_CHARACTERS else ARCHIVE_SCHEMA_VERSION

    fun isSupportedSchemaVersion(version: Int?): Boolean =
        version == ARCHIVE_SCHEMA_VERSION || version == ARCHIVE_SCHEMA_VERSION_WITH_CHARACTERS

    private val DRIVE_PREFIX = Regex("^[a-zA-Z]:[\\\\/]")
    private val NORMALIZED_DRIVE_PREFIX = Regex("^[a-zA-Z]:/")
    private val MEDIA_MEMBER = Regex("^media/([a-f0-9]{64})\\.([a-z0-9]+)$", RegexOption.IGNORE_CASE)

    fun validateArchivePath(path: String): Boolean {
        if (path.isEmpty()) {
            return false
        }
        if (path.contains('\u0000')) {
            return false
        }
        if (DRIVE_PREFIX.containsMatchIn(path) || path.startsWith("\\\\")) {
            return false
        }
        if (path.startsWith("/") || path.startsWith("\\")) {
            return false
        }
        val normalized = path.replace('\\', '/')
        if (normalized.startsWith("/") || NORMALIZED_DRIVE_PREFIX.containsMatchIn(normalized)) {
            return false
        }
        val parts = normalized.split('/')
        if (parts.isEmpty()) {
            return false
        }
        for (part in parts) {
            if (part.isEmpty() || part == "." || part == "..") {
                return false
            }
        }
        return true
    }

    fun isAllowedArchiveMemberPath(path: String): Boolean {
        if (!validateArchivePath(path)) {
            return false
        }
        if (path == MANIFEST_PATH || path == RECORDS_PATH) {
            return true
        }
        return MEDIA_MEMBER.matches(path)
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

    fun mediaArchivePath(sha256: String, mime: String): String = "media/$sha256.${extensionForMime(mime)}"

    /**
     * Android 14+ [dalvik.system.ZipPathValidator] throws ZipException before
     * ZipInputStream yields a `../` entry. Recover the rejected path so inspect
     * can still fill `invalidPaths`.
     */
    fun invalidPathFromZipGuardMessage(message: String?): String? {
        if (message.isNullOrBlank()) {
            return null
        }
        val marker = "Invalid zip entry path: "
        val idx = message.indexOf(marker)
        if (idx >= 0) {
            val path = message.substring(idx + marker.length).trim()
            if (path.isNotEmpty()) {
                return path
            }
        }
        val match = Regex("(\\.\\./[^\\s:]+)").find(message)
        return match?.groupValues?.get(1)
    }
}
