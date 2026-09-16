package com.char2vid.studio.library

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

@RunWith(AndroidJUnit4::class)
class CharacterArchiveInstrumentedTest {
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

    @Test
    fun characterPackageRoundTripKeepsLookAndIdentity() {
        val portrait = InstrumentedFixtures.importFixture(context, repo, "tiny.png", "portrait.png")
        val jacket = InstrumentedFixtures.importFixture(context, repo, "tiny-red.png", "jacket.png")
        val created = repo.createCharacter("Mira", portrait.revisionId)
        val characterId = created.getString("characterId")
        repo.saveLook(
            JSONObject()
                .put("id", "11111111-1111-4111-8111-111111111111")
                .put("characterId", characterId)
                .put("label", "Red jacket")
                .put("notes", "Wardrobe only")
                .put("referenceRevisionIds", org.json.JSONArray(listOf(jacket.revisionId))),
        )

        val zip = File(context.cacheDir, "character-${System.nanoTime()}.zip").also { scratch.add(it) }
        FileOutputStream(zip).use { out -> archiver.exportLibraryTo(out, characterId = characterId) }

        repo = InstrumentedFixtures.resetLibrary(context)
        archiver = LibraryArchiver(context, repo)
        val imported = archiver.importArchive({ FileInputStream(zip) }, conflict = "remap")
        assertEquals(2, imported.importedAssets)

        val characters = repo.listCharacters().getJSONArray("characters")
        assertEquals(1, characters.length())
        assertEquals("Mira", characters.getJSONObject(0).getString("name"))
        val restoredId = characters.getJSONObject(0).getString("id")
        val looks = repo.listLooks(restoredId).getJSONArray("looks")
        assertEquals(1, looks.length())
        assertEquals("Red jacket", looks.getJSONObject(0).getString("label"))
        val revision =
            repo.getCharacterRevision(characters.getJSONObject(0).getString("currentRevisionId"))
                .getJSONObject("revision")
        val refs = revision.getJSONArray("references")
        assertEquals(1, refs.length())
        assertEquals("identity", refs.getJSONObject(0).getString("role"))
        assertEquals("approved", refs.getJSONObject(0).getString("approval"))
        assertTrue(repo.referenceAvailability(refs.getJSONObject(0).getString("assetRevisionId")) == "available")
    }
}
