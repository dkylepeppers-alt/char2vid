package com.char2vid.studio.library

/**
 * Display names for gallery, SAF, and FileProvider exports. An existing
 * extension is kept only when it matches the resolved MIME; otherwise it is
 * replaced so share intents and gallery rows do not advertise the wrong type.
 */
object ExportNames {
    fun safeFileName(name: String, mime: String): String {
        val cleaned =
            name.replace('\\', '_')
                .replace('/', '_')
                .replace(Regex("[\\u0000-\\u001f\\u007f]"), "")
                .trim()
                .trimStart('.')
        val base = if (cleaned.isEmpty()) "revision" else cleaned.take(120)
        val ext = ArchivePaths.extensionForMime(mime)
        val match = Regex("\\.([A-Za-z0-9]{1,5})$").find(base)
        if (match == null) {
            return if (ext == "bin") base else "$base.$ext"
        }
        if (ext == "bin") {
            return base
        }
        val existing = match.groupValues[1].lowercase()
        if (extensionMatchesMime(existing, mime, ext)) {
            return base
        }
        val stem = base.substring(0, match.range.first).ifEmpty { "revision" }
        return "$stem.$ext"
    }

    private fun extensionMatchesMime(existing: String, mime: String, canonical: String): Boolean {
        if (existing == canonical) {
            return true
        }
        return when (mime) {
            "image/jpeg" -> existing == "jpeg" || existing == "jpg"
            "audio/wav", "audio/wave" -> existing == "wav" || existing == "wave"
            else -> false
        }
    }
}
