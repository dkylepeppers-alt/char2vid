package com.char2vid.studio.library

import org.junit.Assert.assertEquals
import org.junit.Test

class ExportNamesTest {
    @Test
    fun preservesExtensionOnlyWhenItMatchesMime() {
        assertEquals("photo.png", ExportNames.safeFileName("photo.png", "image/png"))
        assertEquals("photo.jpg", ExportNames.safeFileName("photo.jpg", "image/jpeg"))
    }

    @Test
    fun replacesExtensionThatConflictsWithMime() {
        assertEquals("photo.png", ExportNames.safeFileName("photo.jpg", "image/png"))
        assertEquals("clip.mp4", ExportNames.safeFileName("clip.webm", "video/mp4"))
    }

    @Test
    fun appendsExtensionWhenMissing() {
        assertEquals("revision.png", ExportNames.safeFileName("", "image/png"))
        assertEquals("export-me.png", ExportNames.safeFileName("export-me", "image/png"))
    }

    @Test
    fun unknownMimeLeavesCleanedBaseName() {
        assertEquals("notes.bin", ExportNames.safeFileName("notes.bin", "application/x-unknown"))
        assertEquals("notes", ExportNames.safeFileName("notes", "application/x-unknown"))
    }
}
