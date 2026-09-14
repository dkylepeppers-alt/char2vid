package com.char2vid.studio.library

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * G4 native archive: streaming export → inspect → wipe → import round trip,
 * collision remap, tamper rejection, traversal rejection, and import bound to
 * one inspected ZIP snapshot on an emulator.
 *
 * Android↔Android on physical hardware and browser↔Android restores remain
 * UNVERIFIED until run on a device with a real SAF picker.
 */
@RunWith(AndroidJUnit4::class)
class ArchiveInstrumentedTest {
    private lateinit var context: Context
    private lateinit var repo: MediaStoreRepository
    private lateinit var archiver: LibraryArchiver
    private val scratch = mutableListOf<File>()

    @Before
    fun setUp() {
        context = InstrumentedFixtures.targetContext()
        repo = InstrumentedFixtures.resetLibrary(context)
        archiver = LibraryArchiver(context, repo)
    }

    @After
    fun tearDown() {
        scratch.forEach { it.delete() }
        LibraryDatabase.clearInstanceForTests()
    }

    private fun scratchFile(name: String): File =
        File(context.cacheDir, "$name-${System.nanoTime()}.zip").also { scratch.add(it) }

    private fun exportToScratch(): File {
        val zip = scratchFile("export")
        FileOutputStream(zip).use { out -> archiver.exportLibraryTo(out) }
        assertTrue(zip.length() > 100)
        return zip
    }

    private fun zipEntries(zip: File): Map<String, ByteArray> {
        val out = LinkedHashMap<String, ByteArray>()
        ZipInputStream(FileInputStream(zip)).use { zin ->
            var entry = zin.nextEntry
            while (entry != null) {
                val buf = ByteArrayOutputStream()
                zin.copyTo(buf)
                out[entry.name] = buf.toByteArray()
                entry = zin.nextEntry
            }
        }
        return out
    }

    private fun writeZip(entries: Map<String, ByteArray>, target: File) {
        ZipOutputStream(FileOutputStream(target)).use { zout ->
            for ((name, bytes) in entries) {
                zout.putNextEntry(ZipEntry(name))
                zout.write(bytes)
                zout.closeEntry()
            }
        }
    }

    private fun shaSet(r: MediaStoreRepository): Set<String> =
        r.queryAssets(JSONObject().put("limit", 100)).getJSONArray("assets").let { arr ->
            (0 until arr.length()).map { arr.getJSONObject(it).getString("sha256") }.toSet()
        }

    private fun assetIds(r: MediaStoreRepository): List<String> =
        r.queryAssets(JSONObject().put("limit", 100)).getJSONArray("assets").let { arr ->
            (0 until arr.length()).map { arr.getJSONObject(it).getString("id") }
        }

    @Test
    fun exportInspectWipeImportPreservesMediaTagsAndCollections() {
        val a = InstrumentedFixtures.importFixture(context, repo, "tiny.png", "a.png")
        val b = InstrumentedFixtures.importFixture(context, repo, "tiny-red.png", "b.png")
        assertNotEquals(a.sha256, b.sha256)
        repo.applyLibraryAction(JSONObject().put("action", "tag").put("value", "portrait").put("assetIds", JSONArray(listOf(a.id))))
        repo.applyLibraryAction(JSONObject().put("action", "collection").put("value", "shoot-1").put("assetIds", JSONArray(listOf(a.id, b.id))))
        repo.applyLibraryAction(JSONObject().put("action", "favorite").put("value", true).put("assetIds", JSONArray(listOf(b.id))))
        val originalShas = setOf(a.sha256, b.sha256)

        val zip = exportToScratch()
        assertEquals(emptyList<String>(), InstrumentedFixtures.tempEntries(context))

        val report = archiver.inspect { FileInputStream(zip) }
        assertEquals(report.errors.joinToString("; "), true, report.ok)
        assertEquals(1, report.schemaVersion)
        assertEquals(4, report.fileCount)
        assertEquals(emptyList<String>(), report.invalidPaths)
        assertEquals(emptyList<String>(), report.missingFiles)
        assertFalse(report.unsupportedVersion)
        assertTrue(report.expandedBytes > 138)
        // Inspect never mutates the library.
        assertEquals(originalShas, shaSet(repo))

        // Wipe as if restoring onto a fresh install.
        repo = InstrumentedFixtures.resetLibrary(context)
        archiver = LibraryArchiver(context, repo)
        assertEquals(emptySet<String>(), shaSet(repo))

        val result = archiver.importArchive({ FileInputStream(zip) }, conflict = "remap")
        assertEquals(2, result.importedAssets)
        assertTrue(result.idMap.isNotEmpty())
        // No collisions on a fresh library → identity map.
        assertEquals(a.id, result.idMap[a.id])
        assertEquals(originalShas, shaSet(repo))
        assertEquals(emptyList<String>(), InstrumentedFixtures.tempEntries(context))

        val tagged = repo.queryAssets(JSONObject().put("tags", JSONArray(listOf("portrait"))).put("limit", 10)).getJSONArray("assets")
        assertEquals(1, tagged.length())
        assertEquals(a.sha256, tagged.getJSONObject(0).getString("sha256"))
        val inCollection = repo.queryAssets(JSONObject().put("collectionId", "shoot-1").put("limit", 10)).getJSONArray("assets")
        assertEquals(2, inCollection.length())
        val favorites = repo.queryAssets(JSONObject().put("favorite", true).put("limit", 10)).getJSONArray("assets")
        assertEquals(1, favorites.length())
        assertEquals(b.sha256, favorites.getJSONObject(0).getString("sha256"))

        // Bytes readable through the revision stream after restore.
        val restored = tagged.getJSONObject(0)
        val source = repo.resolveRevisionSource(restored.getString("revisionId"))
        assertEquals(a.sha256, InstrumentedFixtures.sha256Hex(source.file.readBytes()))

        // Importing the same archive again collides on every ID → non-identity map, 4 assets.
        val again = archiver.importArchive({ FileInputStream(zip) }, conflict = "remap")
        assertEquals(2, again.importedAssets)
        assertNotEquals(a.id, again.idMap[a.id])
        assertNotEquals(b.id, again.idMap[b.id])
        assertEquals(4, assetIds(repo).size)
        assertEquals(4, assetIds(repo).toSet().size)
        // Shared-hash dedupe: still only two physical objects.
        assertEquals(2, repo.physicalObjectCount())
    }

    @Test
    fun tamperedMediaByteIsRejectedAndLibraryUntouched() {
        InstrumentedFixtures.importFixture(context, repo, "tiny-red.png", "incoming.png")
        val zip = exportToScratch()

        // Target library with a different prior asset.
        repo = InstrumentedFixtures.resetLibrary(context)
        archiver = LibraryArchiver(context, repo)
        val prior = InstrumentedFixtures.importFixture(context, repo, "tiny.png", "prior.png")
        val priorIds = assetIds(repo)
        val priorPhysical = repo.physicalObjectCount()

        val entries = zipEntries(zip).toMutableMap()
        val mediaPath = entries.keys.first { it.startsWith("media/") }
        val mutated = entries[mediaPath]!!.copyOf()
        mutated[mutated.size - 1] = (mutated[mutated.size - 1].toInt() xor 0xff).toByte()
        entries[mediaPath] = mutated
        val bad = scratchFile("tampered")
        writeZip(entries, bad)

        val report = archiver.inspect { FileInputStream(bad) }
        assertFalse(report.ok)
        assertTrue(report.errors.joinToString(), report.errors.any { it.contains("checksum mismatch") })

        try {
            archiver.importArchive({ FileInputStream(bad) }, conflict = "remap")
            fail("import must reject tampered media")
        } catch (error: LibraryException) {
            assertEquals(LibraryException.ARCHIVE_REJECTED, error.code)
        }

        assertEquals(priorIds, assetIds(repo))
        assertEquals(priorPhysical, repo.physicalObjectCount())
        assertEquals(prior.sha256, repo.getAsset(prior.id)!!.sha256)
        assertEquals(emptyList<String>(), InstrumentedFixtures.tempEntries(context))
    }

    @Test
    fun traversalMemberPathIsFlaggedAndImportRefused() {
        val prior = InstrumentedFixtures.importFixture(context, repo, "tiny.png", "safe.png")
        val evil = scratchFile("evil")
        writeZip(
            linkedMapOf(
                "manifest.json" to "{}".toByteArray(),
                "../evil" to "nope".toByteArray(),
            ),
            evil,
        )

        val report = archiver.inspect { FileInputStream(evil) }
        assertFalse(report.ok)
        assertTrue(report.invalidPaths.contains("../evil"))

        try {
            archiver.importArchive({ FileInputStream(evil) }, conflict = "remap")
            fail("import must refuse unsafe paths")
        } catch (error: LibraryException) {
            assertEquals(LibraryException.ARCHIVE_REJECTED, error.code)
        }
        assertEquals(listOf(prior.id), assetIds(repo))
        assertFalse(File(context.filesDir, "evil").exists())
        assertFalse(File(File(context.filesDir, "library"), "evil").exists())
    }

    @Test
    fun unsupportedSchemaVersionIsReportedNotImported() {
        val zip = exportToScratch()
        val entries = zipEntries(zip).toMutableMap()
        val manifest = JSONObject(String(entries["manifest.json"]!!))
        manifest.put("schemaVersion", 7)
        entries["manifest.json"] = manifest.toString().toByteArray()
        val future = scratchFile("future")
        writeZip(entries, future)

        val report = archiver.inspect { FileInputStream(future) }
        assertFalse(report.ok)
        assertTrue(report.unsupportedVersion)
        assertEquals(7, report.schemaVersion)
    }

    @Test
    fun softTrashedAssetsAreExcludedFromExport() {
        val live = InstrumentedFixtures.importFixture(context, repo, "tiny.png", "live.png")
        val doomed = InstrumentedFixtures.importFixture(context, repo, "tiny-red.png", "trashed.png")
        repo.applyLibraryAction(JSONObject().put("action", "trash").put("assetIds", JSONArray(listOf(doomed.id))))

        val zip = exportToScratch()
        val entries = zipEntries(zip)
        val records = JSONObject(String(entries["records.json"]!!))
        assertEquals(1, records.getJSONArray("assets").length())
        assertEquals(live.id, records.getJSONArray("assets").getJSONObject(0).getString("id"))
        assertEquals(1, entries.keys.count { it.startsWith("media/") })
        assertEquals(1, JSONObject(String(entries["manifest.json"]!!)).getJSONArray("files").length())
    }

    @Test
    fun importBindsToFirstOpenedSnapshotNotLaterUriContent() {
        val first = InstrumentedFixtures.importFixture(context, repo, "tiny.png", "first.png")
        val zipA = exportToScratch()
        val shaA = first.sha256

        repo = InstrumentedFixtures.resetLibrary(context)
        archiver = LibraryArchiver(context, repo)
        val second = InstrumentedFixtures.importFixture(context, repo, "tiny-red.png", "second.png")
        val zipB = exportToScratch()
        val shaB = second.sha256
        assertNotEquals(shaA, shaB)

        repo = InstrumentedFixtures.resetLibrary(context)
        archiver = LibraryArchiver(context, repo)
        var opens = 0
        val result =
            archiver.importArchive(
                {
                    opens += 1
                    FileInputStream(if (opens == 1) zipA else zipB)
                },
                conflict = "remap",
            )
        assertEquals(1, opens)
        assertEquals(1, result.importedAssets)
        assertEquals(setOf(shaA), shaSet(repo))
        assertFalse(shaSet(repo).contains(shaB))
        assertEquals(emptyList<String>(), InstrumentedFixtures.tempEntries(context))
    }

    @Test
    fun importScratchIsRemovedAfterRejectedArchive() {
        val prior = InstrumentedFixtures.importFixture(context, repo, "tiny.png", "keep.png")
        val evil = scratchFile("evil-snapshot")
        writeZip(
            linkedMapOf(
                "manifest.json" to "{}".toByteArray(),
                "../evil" to "nope".toByteArray(),
            ),
            evil,
        )
        var opens = 0
        try {
            archiver.importArchive(
                {
                    opens += 1
                    FileInputStream(evil)
                },
                conflict = "remap",
            )
            fail("import must refuse unsafe paths")
        } catch (error: LibraryException) {
            assertEquals(LibraryException.ARCHIVE_REJECTED, error.code)
        }
        assertEquals(1, opens)
        assertEquals(listOf(prior.id), assetIds(repo))
        assertEquals(emptyList<String>(), InstrumentedFixtures.tempEntries(context))
    }
}
