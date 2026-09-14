package com.char2vid.studio.library

import java.io.InputStream
import java.security.MessageDigest

object MediaValidator {
    private val PNG_SIGNATURE =
        byteArrayOf(
            0x89.toByte(),
            0x50,
            0x4e,
            0x47,
            0x0d,
            0x0a,
            0x1a,
            0x0a,
        )

    fun looksLikePng(prefix: ByteArray): Boolean {
        if (prefix.size < PNG_SIGNATURE.size) {
            return false
        }
        for (i in PNG_SIGNATURE.indices) {
            if (prefix[i] != PNG_SIGNATURE[i]) {
                return false
            }
        }
        return true
    }

    fun validateMediaBytes(byteLength: Long, mime: String, prefix: ByteArray) {
        if (byteLength <= 0L) {
            throw IllegalArgumentException("empty media payload")
        }
        if (mime == "image/png" && !looksLikePng(prefix)) {
            throw IllegalArgumentException("PNG signature mismatch")
        }
    }

    data class HashResult(val sha256: String, val byteLength: Long, val prefix: ByteArray)

    /**
     * Stream [input] into [output], computing SHA-256 and capturing a short
     * signature prefix. Caller owns closing streams.
     */
    fun hashCopy(input: InputStream, output: java.io.OutputStream): HashResult {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(64 * 1024)
        val prefix = ByteArray(PNG_SIGNATURE.size)
        var prefixFilled = 0
        var total = 0L
        while (true) {
            val read = input.read(buffer)
            if (read < 0) {
                break
            }
            if (read == 0) {
                continue
            }
            if (prefixFilled < prefix.size) {
                val need = prefix.size - prefixFilled
                val take = minOf(need, read)
                System.arraycopy(buffer, 0, prefix, prefixFilled, take)
                prefixFilled += take
            }
            digest.update(buffer, 0, read)
            output.write(buffer, 0, read)
            total += read.toLong()
        }
        val hex =
            digest.digest().joinToString("") { b ->
                "%02x".format(b)
            }
        return HashResult(hex, total, prefix.copyOf(prefixFilled))
    }
}
