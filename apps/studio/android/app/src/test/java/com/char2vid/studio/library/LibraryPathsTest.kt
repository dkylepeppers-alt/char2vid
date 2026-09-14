package com.char2vid.studio.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class LibraryPathsTest {
    @Test
    fun tempAndFinalPathsMatchWebLayout() {
        assertEquals("tmp/abc", LibraryPaths.tempRelativePath("abc"))
        val hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        assertEquals("objects/01/$hash", LibraryPaths.finalRelativePath(hash))
    }

    @Test
    fun pngSignatureAndSha256() {
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
                0x00,
                0x01,
            )
        assertTrue(MediaValidator.looksLikePng(png))
        assertFalse(MediaValidator.looksLikePng(byteArrayOf(1, 2, 3)))

        val out = ByteArrayOutputStream()
        val result =
            MediaValidator.hashCopy(ByteArrayInputStream(png), out)
        assertEquals(png.size.toLong(), result.byteLength)
        assertEquals(64, result.sha256.length)
        MediaValidator.validateMediaBytes(result.byteLength, "image/png", result.prefix)

        val tmp = kotlin.io.path.createTempFile("hash-file", ".bin").toFile()
        try {
            tmp.writeBytes(png)
            val hashed = MediaValidator.hashFile(tmp)
            assertEquals(result.sha256, hashed.sha256)
            assertTrue(MediaValidator.objectMatches(tmp, hashed.sha256, hashed.byteLength))
            tmp.writeBytes(byteArrayOf(1, 2, 3))
            assertFalse(MediaValidator.objectMatches(tmp, hashed.sha256, hashed.byteLength))
        } finally {
            tmp.delete()
        }
    }
}
