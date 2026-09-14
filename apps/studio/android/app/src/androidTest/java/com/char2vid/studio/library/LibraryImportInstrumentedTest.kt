package com.char2vid.studio.library

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest

/**
 * Native import close/reopen hash round-trip.
 *
 * Authored for the `android.yml` `instrumented` emulator job
 * (`connectedDebugAndroidTest` on API 26 + 34). Physical-device import remains
 * UNVERIFIED until run on hardware.
 */
@RunWith(AndroidJUnit4::class)
class LibraryImportInstrumentedTest {
    private lateinit var context: Context
    private lateinit var repo: MediaStoreRepository

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        LibraryDatabase.clearInstanceForTests()
        // Wipe library files between runs.
        File(context.filesDir, "library").deleteRecursively()
        context.deleteDatabase("char2vid-library.db")
        repo = MediaStoreRepository(context)
    }

    @After
    fun tearDown() {
        LibraryDatabase.clearInstanceForTests()
    }

    @Test
    fun importCloseReopenPreservesSha256() {
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
                0x10,
                0x20,
                0x30,
            )
        val expectedSha =
            MessageDigest.getInstance("SHA-256")
                .digest(png)
                .joinToString("") { "%02x".format(it) }

        val source = File(context.cacheDir, "instrumented-import.png")
        source.writeBytes(png)

        val imported =
            repo.importFromNativeUri(
                source.toURI().toString(),
                "instrumented-import.png",
                "image/png",
            )
        assertEquals("available", imported.state)
        assertEquals(expectedSha, imported.sha256)

        // Simulate process death: new repository / DB handle, same files.
        LibraryDatabase.clearInstanceForTests()
        val reopened = MediaStoreRepository(context)
        reopened.reconcileOnStart()
        val again = reopened.getAsset(imported.id)
        assertNotNull(again)
        assertEquals(expectedSha, again!!.sha256)

        val opened = reopened.openRevisionRead(imported.revisionId)
        val readId = opened.getString("readId")
        val chunk = reopened.readRevisionChunk(readId, 1024)
        assertEquals(false, chunk.getBoolean("done"))
        val data = android.util.Base64.decode(chunk.getString("data"), android.util.Base64.NO_WRAP)
        assertTrue(data.isNotEmpty())
        reopened.closeRevisionRead(readId)
    }
}
