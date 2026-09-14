package com.char2vid.studio.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Mirrors `tests/contract/archive.test.ts` path cases so the Kotlin importer
 * rejects exactly what the web importer rejects.
 */
class ArchivePathsTest {
    @Test
    fun rejectsUnsafeMemberPaths() {
        for (path in listOf(
            "../secret",
            "/absolute",
            "media/../../secret",
            "C:\\secret",
            "\\\\server\\share",
            "\\leading-backslash",
            "media//double",
            "media/./dot",
            "",
            "media/a\u0000b",
        )) {
            assertFalse("expected rejection: $path", ArchivePaths.validateArchivePath(path))
        }
    }

    @Test
    fun acceptsRelativeMediaMember() {
        assertTrue(ArchivePaths.validateArchivePath("media/abc123.png"))
        assertTrue(ArchivePaths.validateArchivePath("manifest.json"))
    }

    @Test
    fun allowlistOnlyAcceptsV1Members() {
        val sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        assertTrue(ArchivePaths.isAllowedArchiveMemberPath("manifest.json"))
        assertTrue(ArchivePaths.isAllowedArchiveMemberPath("records.json"))
        assertTrue(ArchivePaths.isAllowedArchiveMemberPath("media/$sha.png"))
        assertFalse(ArchivePaths.isAllowedArchiveMemberPath("media/not-a-hash.png"))
        assertFalse(ArchivePaths.isAllowedArchiveMemberPath("other.json"))
        assertFalse(ArchivePaths.isAllowedArchiveMemberPath("media/$sha"))
        assertFalse(ArchivePaths.isAllowedArchiveMemberPath("media/"))
    }

    @Test
    fun mediaPathsUseWebExtensionTable() {
        val sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        assertEquals("media/$sha.png", ArchivePaths.mediaArchivePath(sha, "image/png"))
        assertEquals("media/$sha.jpg", ArchivePaths.mediaArchivePath(sha, "image/jpeg"))
        assertEquals("media/$sha.mp4", ArchivePaths.mediaArchivePath(sha, "video/mp4"))
        assertEquals("media/$sha.wav", ArchivePaths.mediaArchivePath(sha, "audio/wave"))
        assertEquals("media/$sha.bin", ArchivePaths.mediaArchivePath(sha, "application/x-unknown"))
    }

    @Test
    fun zipGuardMessageYieldsTraversalPath() {
        assertEquals(
            "../evil",
            ArchivePaths.invalidPathFromZipGuardMessage("Invalid zip entry path: ../evil"),
        )
        assertEquals(
            "../evil",
            ArchivePaths.invalidPathFromZipGuardMessage("java.util.zip.ZipException: Invalid zip entry path: ../evil"),
        )
        assertEquals(
            "../secret",
            ArchivePaths.invalidPathFromZipGuardMessage("Entry is unsafe: ../secret is not allowed"),
        )
        assertNull(ArchivePaths.invalidPathFromZipGuardMessage("plain IO error"))
    }
}
