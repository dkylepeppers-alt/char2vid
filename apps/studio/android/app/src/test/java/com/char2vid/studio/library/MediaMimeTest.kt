package com.char2vid.studio.library

import org.junit.Assert.assertEquals
import org.junit.Test

class MediaMimeTest {
    @Test
    fun prefersNamedResolverType() {
        assertEquals(
            "image/png",
            MediaMime.resolve("clip.m4a", "image/png"),
        )
    }

    @Test
    fun mapsPhoneExtensionsWhenResolverIsOctetStream() {
        assertEquals("audio/mp4", MediaMime.resolve("voice.m4a", "application/octet-stream"))
        assertEquals("video/quicktime", MediaMime.resolve("clip.MOV", null))
        assertEquals("image/heic", MediaMime.resolve("photo.heic", ""))
        assertEquals("audio/aac", MediaMime.resolve("take.aac", "application/octet-stream"))
    }

    @Test
    fun usesMimeTypeMapWhenExtensionIsUnknown() {
        assertEquals(
            "chemical/x-pdb",
            MediaMime.resolve("model.pdb", null) { ext ->
                if (ext == "pdb") "chemical/x-pdb" else null
            },
        )
    }

    @Test
    fun fallsBackToOctetStream() {
        assertEquals(
            "application/octet-stream",
            MediaMime.resolve("notes.txt", null),
        )
        assertEquals(
            "application/octet-stream",
            MediaMime.resolve("notes.txt", "application/octet-stream"),
        )
    }
}
