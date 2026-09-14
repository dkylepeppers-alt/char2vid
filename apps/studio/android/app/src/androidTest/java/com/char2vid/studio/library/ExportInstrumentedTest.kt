package com.char2vid.studio.library

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileInputStream

/**
 * G3 native export transaction on an emulator: MediaStore publish, SAF
 * completion, cancel, share staging, and structured errors.
 *
 * Runs in CI via `android.yml` `instrumented` job (API 26 + 34). Physical-device
 * behaviour (real picker UI, other-app reopen, TalkBack) stays UNVERIFIED.
 */
@RunWith(AndroidJUnit4::class)
class ExportInstrumentedTest {
    private lateinit var context: Context
    private lateinit var repo: MediaStoreRepository
    private lateinit var exporter: MediaExporter
    private val createdMediaUris = mutableListOf<Uri>()

    @Before
    fun setUp() {
        context = InstrumentedFixtures.targetContext()
        repo = InstrumentedFixtures.resetLibrary(context)
        exporter = MediaExporter(context, repo)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            grantLegacyWritePermission()
        }
    }

    @After
    fun tearDown() {
        for (uri in createdMediaUris) {
            try {
                context.contentResolver.delete(uri, null, null)
            } catch (_: Exception) {
                // best effort cleanup of emulator MediaStore rows
            }
        }
        createdMediaUris.clear()
        LibraryDatabase.clearInstanceForTests()
    }

    @Test
    fun galleryExportPublishesVerifiedMediaStoreRow() {
        val fixture = InstrumentedFixtures.fixtureBytes("tiny.png")
        val asset = InstrumentedFixtures.importFixture(context, repo, "tiny.png", "export-me.png")
        assertTrue(exporter.galleryUsesMediaStore(asset.kind))

        val saved = exporter.exportToGallery(asset.revisionId)
        createdMediaUris.add(saved.uri)
        assertTrue(saved.displayName.isNotBlank())
        assertTrue(saved.displayName.endsWith(".png"))

        val projection =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                arrayOf(MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.IS_PENDING)
            } else {
                arrayOf(MediaStore.MediaColumns.DISPLAY_NAME)
            }
        context.contentResolver.query(saved.uri, projection, null, null, null).use { cursor ->
            assertNotNull("MediaStore row must exist after publish", cursor)
            assertTrue("row missing", cursor!!.moveToFirst())
            val name = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME))
            assertEquals(saved.displayName, name)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val pending = cursor.getInt(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.IS_PENDING))
                assertEquals("IS_PENDING must be cleared after verification", 0, pending)
            }
        }

        val published = InstrumentedFixtures.readAll(context.contentResolver.openInputStream(saved.uri)!!)
        assertEquals(asset.bytes, published.size.toLong())
        assertEquals(fixture.size, published.size)
        assertEquals(asset.sha256, InstrumentedFixtures.sha256Hex(published))

        // Source revision is untouched by export.
        val stillThere = repo.getAsset(asset.id)
        assertNotNull(stillThere)
        assertEquals(asset.sha256, stillThere!!.sha256)
    }

    @Test
    fun cancelledPickerReturnsCancelledWithoutWriting() {
        val asset = InstrumentedFixtures.importFixture(context, repo, "tiny.png")
        val outcome = exporter.completeSafExport(asset.revisionId, null)
        assertTrue(outcome is MediaExporter.Outcome.Cancelled)
        assertEquals(emptyList<String>(), InstrumentedFixtures.tempEntries(context))
    }

    @Test
    fun safExportCopiesAndVerifiesIntoChosenDocument() {
        val fixture = InstrumentedFixtures.fixtureBytes("tiny-red.png")
        val asset = InstrumentedFixtures.importFixture(context, repo, "tiny-red.png", "red.png")
        val target = File(context.cacheDir, "saf-target-${System.nanoTime()}.png")
        try {
            val outcome = exporter.completeSafExport(asset.revisionId, Uri.fromFile(target))
            assertTrue(outcome is MediaExporter.Outcome.Saved)
            val written = target.readBytes()
            assertEquals(fixture.size, written.size)
            assertEquals(asset.sha256, InstrumentedFixtures.sha256Hex(written))
        } finally {
            target.delete()
        }
    }

    @Test
    fun unknownRevisionIsAStructuredError() {
        try {
            exporter.exportToGallery("00000000-0000-4000-8000-000000000000")
            fail("expected LibraryException")
        } catch (error: LibraryException) {
            assertEquals(LibraryException.UNKNOWN_REVISION, error.code)
        }
        try {
            exporter.completeSafExport("00000000-0000-4000-8000-000000000000", Uri.fromFile(File(context.cacheDir, "never.png")))
            fail("expected LibraryException")
        } catch (error: LibraryException) {
            assertEquals(LibraryException.UNKNOWN_REVISION, error.code)
        }
    }

    @Test
    fun shareStagesUnderScopedFileProviderOnly() {
        val fixture = InstrumentedFixtures.fixtureBytes("tiny.png")
        val asset = InstrumentedFixtures.importFixture(context, repo, "tiny.png", "share me.png")
        val shared = exporter.prepareShare(asset.revisionId)
        assertEquals("${context.packageName}.fileprovider", shared.uri.authority)
        assertEquals("image/png", shared.mime)
        assertEquals("image/png", context.contentResolver.getType(shared.uri))

        context.contentResolver.query(shared.uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null).use { cursor ->
            assertTrue(cursor!!.moveToFirst())
            assertEquals("share me.png", cursor.getString(0))
        }
        val bytes = InstrumentedFixtures.readAll(context.contentResolver.openInputStream(shared.uri)!!)
        assertEquals(asset.sha256, InstrumentedFixtures.sha256Hex(bytes))
        assertEquals(fixture.size, bytes.size)

        val shareRoot = File(File(context.filesDir, "library"), "share")
        assertTrue(shared.stagedFile.canonicalPath.startsWith(shareRoot.canonicalPath))
        // The content-addressed original must not be the shared file.
        val original = repo.resolveRevisionSource(asset.revisionId).file
        assertTrue(shared.stagedFile.canonicalPath != original.canonicalPath)
        FileInputStream(original).use { assertEquals(fixture.size, it.readBytes().size) }
    }

    @Test
    fun galleryDestinationForNonMediaKindRoutesToSaf() {
        assertTrue(!exporter.galleryUsesMediaStore("embedding"))
    }

    private fun grantLegacyWritePermission() {
        val permission = Manifest.permission.WRITE_EXTERNAL_STORAGE
        if (context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
            return
        }
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val pfd = automation.executeShellCommand("pm grant ${context.packageName} $permission")
        android.os.ParcelFileDescriptor.AutoCloseInputStream(pfd).use { it.readBytes() }
        val deadline = System.currentTimeMillis() + 5_000
        while (context.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
            if (System.currentTimeMillis() > deadline) {
                fail("WRITE_EXTERNAL_STORAGE grant did not take effect on API ${Build.VERSION.SDK_INT}")
            }
            Thread.sleep(100)
        }
    }
}
