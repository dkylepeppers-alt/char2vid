package com.char2vid.studio.library

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class CharacterJsonTest {
    @Test
    fun characterRoundTripOmitsNullParentAndStripsSecrets() {
        val character =
            ArchiveCharacter(
                id = "6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7",
                name = "Mira",
                currentRevisionId = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f",
                coverAssetRevisionId = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f",
                createdAt = "2026-09-15T00:00:00.000Z",
                revisions =
                    listOf(
                        ArchiveCharacterRevision(
                            id = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f",
                            characterId = "6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7",
                            parentRevisionId = null,
                            identityNotes = "",
                            references =
                                listOf(
                                    ArchiveCharacterReference(
                                        assetRevisionId = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f",
                                        role = "identity",
                                        view = "front",
                                        approval = "approved",
                                    ),
                                ),
                        ),
                    ),
            )
        val encoded = CharacterJson.encodeCharacter(character)
        encoded.put("apiKey", "must-not-survive")
        val parsed = CharacterJson.parseCharacter(encoded, "character")
        assertEquals(character, parsed)
        assertFalse(CharacterJson.encodeRevision(character.revisions[0]).has("parentRevisionId"))
        val look =
            ArchiveLook(
                id = "1c2d3e4f-5061-4728-9293-a4b5c6d7e8f0",
                characterId = character.id,
                label = "Red jacket",
                notes = "",
                referenceRevisionIds = listOf(character.currentRevisionId),
            )
        assertEquals(look, CharacterJson.parseLook(CharacterJson.encodeLook(look), "look"))
    }

    @Test
    fun parseCharacterRejectsDomainConstraintViolations() {
        val valid = validCharacterJson()
        expectFailure(valid) { it.put("id", "not-a-uuid") }
        expectFailure(valid) { it.put("currentRevisionId", "also-bad") }
        expectFailure(valid) { it.put("name", "") }
        expectFailure(valid) { it.put("createdAt", "yesterday") }
        expectFailure(valid) { it.put("coverAssetRevisionId", "") }
    }

    @Test
    fun parseRevisionAndLookRejectEmptyIds() {
        val revision =
            JSONObject()
                .put("id", "")
                .put("characterId", "char-1")
                .put("identityNotes", "")
                .put("references", org.json.JSONArray())
        try {
            CharacterJson.parseRevision(revision, "revision")
            fail("expected empty revision id to fail")
        } catch (_: IllegalArgumentException) {
        }
        val look =
            JSONObject()
                .put("id", "look-1")
                .put("characterId", "char-1")
                .put("label", "")
                .put("notes", "")
                .put("referenceRevisionIds", org.json.JSONArray())
        try {
            CharacterJson.parseLook(look, "look")
            fail("expected empty look label to fail")
        } catch (_: IllegalArgumentException) {
        }
    }

    @Test
    fun characterPackageAssetFilterMatchesWebPendingRule() {
        assertTrue(CharacterJson.includeInCharacterPackage("available"))
        assertTrue(CharacterJson.includeInCharacterPackage("missing"))
        assertFalse(CharacterJson.includeInCharacterPackage("pending"))
    }

    private fun validCharacterJson(): JSONObject =
        CharacterJson.encodeCharacter(
            ArchiveCharacter(
                id = "6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7",
                name = "Mira",
                currentRevisionId = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f",
                coverAssetRevisionId = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f",
                createdAt = "2026-09-15T00:00:00.000Z",
                revisions = emptyList(),
            ),
        )

    private fun expectFailure(base: JSONObject, mutate: (JSONObject) -> Unit) {
        val copy = JSONObject(base.toString())
        mutate(copy)
        try {
            CharacterJson.parseCharacter(copy, "character")
            fail("expected parseCharacter to reject $copy")
        } catch (_: IllegalArgumentException) {
        }
    }
}
