package com.char2vid.studio.jobs

import org.junit.Assert.assertEquals
import org.junit.Test

class OutputMimeTest {
    @Test
    fun infersJpegInsteadOfHardCodedPng() {
        val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte())
        assertEquals("image/jpeg", OutputMime.infer("image-generate", "image/png", jpeg))
        assertEquals("jpg", OutputMime.extensionFor("image/jpeg"))
    }

    @Test
    fun keepsPngWhenBytesMatch() {
        val png =
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
        assertEquals("image/png", OutputMime.infer("image-generate", "application/octet-stream", png))
    }

    @Test
    fun coercesSpeechOctetStreamToAudioMpeg() {
        assertEquals(
            "audio/mpeg",
            OutputMime.infer("speech", "application/octet-stream", byteArrayOf(1, 2, 3)),
        )
    }
}
