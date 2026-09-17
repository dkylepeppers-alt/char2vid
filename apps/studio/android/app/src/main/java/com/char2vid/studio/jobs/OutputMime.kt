package com.char2vid.studio.jobs

import com.char2vid.studio.library.MediaValidator

object OutputMime {
    fun infer(operation: String, claimed: String, bytes: ByteArray): String {
        val sniffed = sniff(bytes)
        val cleanClaimed = claimed.substringBefore(';').trim().lowercase()
        if (operation.startsWith("video")) {
            return sniffed ?: cleanClaimed.takeIf { it.startsWith("video/") } ?: "video/mp4"
        }
        if (operation == "speech" || operation == "music") {
            if (cleanClaimed.startsWith("audio/")) {
                return cleanClaimed
            }
            return sniffed ?: "audio/mpeg"
        }
        if (sniffed != null) {
            return sniffed
        }
        if (cleanClaimed.startsWith("image/")) {
            return cleanClaimed
        }
        return "image/png"
    }

    fun extensionFor(mime: String): String =
        when (mime.substringBefore(';').trim().lowercase()) {
            "image/jpeg", "image/jpg" -> "jpg"
            "image/webp" -> "webp"
            "image/png" -> "png"
            "video/mp4", "video/quicktime" -> "mp4"
            "audio/mpeg", "audio/mp3" -> "mp3"
            "audio/wav", "audio/x-wav" -> "wav"
            "audio/ogg" -> "ogg"
            else ->
                when {
                    mime.startsWith("video/") -> "mp4"
                    mime.startsWith("audio/") -> "mp3"
                    else -> "png"
                }
        }

    fun sniff(bytes: ByteArray): String? {
        if (MediaValidator.looksLikePng(bytes)) {
            return "image/png"
        }
        if (bytes.size >= 3 &&
            bytes[0] == 0xFF.toByte() &&
            bytes[1] == 0xD8.toByte() &&
            bytes[2] == 0xFF.toByte()
        ) {
            return "image/jpeg"
        }
        if (
            bytes.size >= 12 &&
            bytes.copyOfRange(0, 4).contentEquals("RIFF".toByteArray()) &&
            bytes.copyOfRange(8, 12).contentEquals("WEBP".toByteArray())
        ) {
            return "image/webp"
        }
        if (bytes.size >= 12 &&
            bytes.copyOfRange(4, 8).contentEquals("ftyp".toByteArray())
        ) {
            return "video/mp4"
        }
        if (bytes.size >= 3 && bytes.copyOfRange(0, 3).contentEquals("ID3".toByteArray())) {
            return "audio/mpeg"
        }
        return null
    }
}
