package com.char2vid.studio.library

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest

/**
 * Native local-save side of job recovery: verified output bytes survive
 * process death. Authored for `android.yml` `emulator-androidTest`.
 *
 * Fake provider / no Nano-GPT. Physical-device force-stop remains UNVERIFIED.
 */
@RunWith(AndroidJUnit4::class)
class JobOutputReconcileInstrumentedTest {
    private lateinit var context: Context
    private lateinit var repo: MediaStoreRepository

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        LibraryDatabase.clearInstanceForTests()
        File(context.filesDir, "library").deleteRecursively()
        context.deleteDatabase("char2vid-library.db")
        repo = MediaStoreRepository(context)
    }

    @After
    fun tearDown() {
        LibraryDatabase.clearInstanceForTests()
    }

    @Test
    fun verifiedJobOutputSurvivesProcessDeath() {
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
                0x21,
                0x22,
                0x23,
            )
        val expectedSha =
            MessageDigest.getInstance("SHA-256")
                .digest(png)
                .joinToString("") { "%02x".format(it) }

        val source = File(context.cacheDir, "job-output.png")
        source.writeBytes(png)
        val imported =
            repo.importFromNativeUri(
                source.toURI().toString(),
                "job-output.png",
                "image/png",
            )
        assertEquals("available", imported.state)
        assertEquals(expectedSha, imported.sha256)

        LibraryDatabase.clearInstanceForTests()
        val reopened = MediaStoreRepository(context)
        reopened.reconcileOnStart()
        val again = reopened.getAsset(imported.id)
        assertNotNull(again)
        assertEquals(expectedSha, again!!.sha256)
    }
}
