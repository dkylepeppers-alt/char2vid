package com.char2vid.studio.library

import android.Manifest
import android.content.ContentUris
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileInputStream
import java.io.FilterOutputStream
import java.io.IOException

/**
 * G3 native export transaction on an emulator: MediaStore publish (API 29+),
 * API 26–28 SAF routing without WRITE_EXTERNAL_STORAGE, optional granted-legacy
 * MediaStore path, SAF completion, cancel, share staging, copy-failure rollback,
 * and structured errors.
 *
 * Runs in CI via `android.yml` `instrumented` job (API 26 + 34). Physical-device
 * behaviour (real picker UI, other-app reopen, TalkBack) stays UNVERIFIED. The
 * API 26 cell does not prove production gallery MediaStore export.
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
        Assume.assumeTrue(
            "Production gallery MediaStore path is API 29+ IS_PENDING; API 26–28 without a grant uses SAF",
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q,
        )
        assertGalleryPublishMatchesRevision()
    }

    @Test
    fun galleryWithoutWriteExternalStorageRoutesToSaf() {
        Assume.assumeTrue(
            "Production API 26–28 never requests WRITE_EXTERNAL_STORAGE, so gallery must not use MediaStore",
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q,
        )
        revokeLegacyWritePermission()
        val asset = InstrumentedFixtures.importFixture(context, repo, "tiny.png", "saf-route.png")
        assertFalse(
            "ungranted API ${Build.VERSION.SDK_INT} gallery must fall back to SAF",
            exporter.galleryUsesMediaStore(asset.kind),
        )
        try {
            exporter.exportToGallery(asset.revisionId)
            fail("gallery without WRITE_EXTERNAL_STORAGE must not take the legacy MediaStore path")
        } catch (error: LibraryException) {
            assertEquals(LibraryException.UNSUPPORTED_DESTINATION, error.code)
        }
        val stillThere = repo.getAsset(asset.id)
        assertNotNull(stillThere)
        assertEquals(asset.sha256, stillThere!!.sha256)
    }

    @Test
    fun legacyGrantedWriteExternalStorageGalleryExportPublishesVerifiedMediaStoreRow() {
        Assume.assumeTrue(
            "Optional path only: production never requests WRITE_EXTERNAL_STORAGE on API 26–28",
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q,
        )
        grantLegacyWritePermission()
        exporter = MediaExporter(context, repo)
        assertTrue(
            "granted WRITE_EXTERNAL_STORAGE must select the legacy MediaStore writer",
            exporter.galleryUsesMediaStore("image"),
        )
        @Suppress("DEPRECATION")
        val pictures = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_PICTURES)
        pictures.mkdirs()
        val dest = File(pictures, MediaExporter.APP_FOLDER)
        dest.mkdirs()
        Assume.assumeTrue(
            "optional legacy public Pictures/char2vid is not writable on this emulator",
            dest.isDirectory && dest.canWrite(),
        )
        assertGalleryPublishMatchesRevision()
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

    @Test
    fun copyFailureRemovesIncompleteDestinationAndPreservesSource() {
        val asset = InstrumentedFixtures.importFixture(context, repo, "tiny.png", "rollback-src.png")
        val failing =
            MediaExporter(context, repo) { dest ->
                object : FilterOutputStream(dest) {
                    private var written = 0

                    override fun write(b: Int) {
                        if (written >= 8) {
                            throw IOException("injected copy failure")
                        }
                        written += 1
                        out.write(b)
                    }

                    override fun write(b: ByteArray, off: Int, len: Int) {
                        val room = 8 - written
                        if (room <= 0) {
                            throw IOException("injected copy failure")
                        }
                        val n = minOf(len, room)
                        out.write(b, off, n)
                        written += n
                        if (n < len) {
                            throw IOException("injected copy failure")
                        }
                    }
                }
            }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val displayName = MediaExporter.safeFileName(asset.name, "image/png")
            try {
                failing.exportToGallery(asset.revisionId)
                fail("expected copy failure to abort MediaStore publish")
            } catch (error: LibraryException) {
                assertEquals(LibraryException.COPY_FAILED, error.code)
            }
            assertEquals(emptyList<Uri>(), mediaStoreImageRowsNamed(displayName))
        }

        val target = File(context.cacheDir, "incomplete-export-${System.nanoTime()}.png")
        try {
            failing.completeSafExport(asset.revisionId, Uri.fromFile(target))
            fail("expected copy failure to abort SAF export")
        } catch (error: LibraryException) {
            assertEquals(LibraryException.COPY_FAILED, error.code)
        }
        assertFalse("incomplete SAF destination must be deleted", target.exists())

        val stillThere = repo.getAsset(asset.id)
        assertNotNull(stillThere)
        assertEquals(asset.sha256, stillThere!!.sha256)
        val original = repo.resolveRevisionSource(asset.revisionId).file
        assertTrue(original.isFile)
        assertEquals(asset.bytes, original.length())
        assertEquals(asset.sha256, InstrumentedFixtures.sha256Hex(original.readBytes()))
    }

    private fun assertGalleryPublishMatchesRevision() {
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

        val stillThere = repo.getAsset(asset.id)
        assertNotNull(stillThere)
        assertEquals(asset.sha256, stillThere!!.sha256)
    }

    private fun mediaStoreImageRowsNamed(displayName: String): List<Uri> {
        val collection =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            } else {
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI
            }
        val rows = mutableListOf<Uri>()
        context.contentResolver
            .query(
                collection,
                arrayOf(MediaStore.MediaColumns._ID),
                "${MediaStore.MediaColumns.DISPLAY_NAME}=?",
                arrayOf(displayName),
                null,
            )?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                while (cursor.moveToNext()) {
                    rows.add(ContentUris.withAppendedId(collection, cursor.getLong(idCol)))
                }
            }
        return rows
    }

    private fun grantLegacyWritePermission() {
        setLegacyWritePermission(grant = true)
    }

    private fun revokeLegacyWritePermission() {
        setLegacyWritePermission(grant = false)
    }

    private fun setLegacyWritePermission(grant: Boolean) {
        val permission = Manifest.permission.WRITE_EXTERNAL_STORAGE
        val wanted =
            if (grant) PackageManager.PERMISSION_GRANTED else PackageManager.PERMISSION_DENIED
        if (context.checkSelfPermission(permission) == wanted) {
            return
        }
        val verb = if (grant) "grant" else "revoke"
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        try {
            if (grant) {
                automation.grantRuntimePermission(context.packageName, permission)
            } else {
                automation.revokeRuntimePermission(context.packageName, permission)
            }
        } catch (_: Exception) {
            // Some emulators reject UiAutomation permission APIs; pm is the fallback.
        }
        val pfd = automation.executeShellCommand("pm $verb ${context.packageName} $permission")
        android.os.ParcelFileDescriptor.AutoCloseInputStream(pfd).use { it.readBytes() }
        val deadline = System.currentTimeMillis() + 5_000
        while (context.checkSelfPermission(permission) != wanted) {
            if (System.currentTimeMillis() > deadline) {
                fail("WRITE_EXTERNAL_STORAGE $verb did not take effect on API ${Build.VERSION.SDK_INT}")
            }
            Thread.sleep(100)
        }
    }
}
