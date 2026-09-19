package com.char2vid.studio.library

/**
 * Resolves a stored MIME type for SAF / picker imports.
 *
 * SAF providers often return null or `application/octet-stream` for common
 * phone files (`.m4a`, `.mov`, `.heic`). Prefer the resolver only when it
 * already named a real type; otherwise map the filename extension, then an
 * optional [MimeTypeMap] lookup.
 */
object MediaMime {
    private val EXTENSIONS =
        mapOf(
            "png" to "image/png",
            "jpg" to "image/jpeg",
            "jpeg" to "image/jpeg",
            "webp" to "image/webp",
            "gif" to "image/gif",
            "heic" to "image/heic",
            "heif" to "image/heif",
            "avif" to "image/avif",
            "bmp" to "image/bmp",
            "tif" to "image/tiff",
            "tiff" to "image/tiff",
            "mp4" to "video/mp4",
            "m4v" to "video/mp4",
            "webm" to "video/webm",
            "mov" to "video/quicktime",
            "mkv" to "video/x-matroska",
            "3gp" to "video/3gpp",
            "3gpp" to "video/3gpp",
            "mp3" to "audio/mpeg",
            "wav" to "audio/wav",
            "wave" to "audio/wav",
            "m4a" to "audio/mp4",
            "aac" to "audio/aac",
            "ogg" to "audio/ogg",
            "oga" to "audio/ogg",
            "opus" to "audio/opus",
            "flac" to "audio/flac",
        )

    fun resolve(
        fileName: String,
        resolverType: String?,
        extensionMime: (String) -> String? = { null },
    ): String {
        if (!resolverType.isNullOrBlank() && resolverType != "application/octet-stream") {
            return resolverType
        }
        val ext = fileName.substringAfterLast('.', missingDelimiterValue = "").lowercase()
        if (ext.isNotEmpty()) {
            EXTENSIONS[ext]?.let {
                return it
            }
            extensionMime(ext)?.takeIf { it.isNotBlank() }?.let {
                return it
            }
        }
        return resolverType ?: "application/octet-stream"
    }
}
