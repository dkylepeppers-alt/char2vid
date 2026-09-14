package com.char2vid.studio.library

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Wire-shape parity with `packages/domain/src/archive-schema.ts`: what the
 * Kotlin exporter writes must satisfy the zod schemas, and what the web
 * exporter writes must parse here.
 */
class ArchiveJsonTest {
    private val sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    private val assetId = "6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7"
    private val revisionId = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f"

    private fun asset() =
        ArchiveAsset(
            id = assetId,
            revisionId = revisionId,
            kind = "image",
            name = "tiny.png",
            mime = "image/png",
            sha256 = sha,
            bytes = 70,
            state = "available",
            createdAt = "2026-09-14T18:00:00.000Z",
            favorite = true,
            rating = 4,
            folderId = null,
            trashedAt = null,
        )

    @Test
    fun recordsRoundTripThroughJsonWithAllowlistedFieldsOnly() {
        val records =
            ArchiveRecords(
                assets = listOf(asset()),
                revisions = listOf(ArchiveRevision(revisionId, assetId, sha, "2026-09-14T18:00:00.000Z")),
                collectionMembers = listOf(ArchiveCollectionMember("shoot-1", assetId)),
                assetTags = listOf(ArchiveAssetTag(assetId, "portrait")),
            )
        val json = JSONObject(ArchiveJson.encodeRecords(records))
        val assetJson = json.getJSONArray("assets").getJSONObject(0)
        assertEquals(
            ArchiveJson.ALLOWLISTED_ASSET_FIELDS.toSet(),
            assetJson.keys().asSequence().toSet(),
        )
        assertTrue(assetJson.isNull("folderId"))
        assertTrue(assetJson.isNull("trashedAt"))
        assertEquals(4, assetJson.getInt("rating"))
        for (stub in listOf("characters", "looks", "shots", "graphEdges", "timeline")) {
            assertEquals(0, json.getJSONArray(stub).length())
        }

        val parsed = ArchiveJson.parseRecords(json.toString())
        assertEquals(records, parsed)
    }

    @Test
    fun manifestRoundTrip() {
        val manifest =
            ArchiveManifest(
                schemaVersion = 1,
                createdAt = "2026-09-14T18:00:00Z",
                scope = "library",
                scopeId = null,
                files = listOf(ArchiveManifestFile("media/$sha.png", sha, 70, "image/png")),
                recordCounts = ArchiveRecordCounts(1, 1, 0, 0),
            )
        val encoded = ArchiveJson.encodeManifest(manifest)
        val parsed = ArchiveJson.parseManifest(encoded)
        assertEquals(manifest, parsed)
        assertEquals(1, ArchiveJson.peekSchemaVersion(encoded))
        assertNull(ArchiveJson.peekSchemaVersion("{}"))
        assertEquals(7, ArchiveJson.peekSchemaVersion("""{"schemaVersion":7}"""))
    }

    @Test
    fun parsingRejectsShapesZodWouldReject() {
        val good = JSONObject(ArchiveJson.encodeRecords(ArchiveRecords(listOf(asset()), emptyList(), emptyList(), emptyList())))

        fun expectFailure(mutate: (JSONObject) -> Unit, label: String) {
            val copy = JSONObject(good.toString())
            mutate(copy)
            try {
                ArchiveJson.parseRecords(copy.toString())
                fail("expected rejection: $label")
            } catch (_: IllegalArgumentException) {
                // expected
            }
        }

        expectFailure({ it.getJSONArray("assets").getJSONObject(0).put("id", "not-a-uuid") }, "id uuid")
        expectFailure({ it.getJSONArray("assets").getJSONObject(0).put("sha256", "XYZ") }, "sha hex")
        expectFailure({ it.getJSONArray("assets").getJSONObject(0).remove("favorite") }, "favorite required")
        expectFailure({ it.getJSONArray("assets").getJSONObject(0).put("rating", 9) }, "rating range")
        expectFailure({ it.getJSONArray("assets").getJSONObject(0).put("kind", "hologram") }, "kind enum")
        expectFailure({ it.getJSONArray("assets").getJSONObject(0).put("createdAt", "yesterday") }, "datetime")
        expectFailure({ it.getJSONArray("assets").getJSONObject(0).put("bytes", -1) }, "bytes nonneg")
        expectFailure({ it.remove("revisions") }, "revisions required")
    }

    @Test
    fun parsingToleratesUnknownKeysAndMissingStubArrays() {
        val json = JSONObject(ArchiveJson.encodeRecords(ArchiveRecords(listOf(asset()), emptyList(), emptyList(), emptyList())))
        json.remove("characters")
        json.put("futureField", "ignored")
        json.getJSONArray("assets").getJSONObject(0).put("apiKey", "must-not-crash-parse")
        val parsed = ArchiveJson.parseRecords(json.toString())
        assertEquals(1, parsed.assets.size)
    }

    @Test
    fun schemaVersionOutsideIntRangeIsNotTruncatedToSupportedVersion() {
        // 2^32 + 1 would become 1 if parsed with Long.toInt().
        assertNull(ArchiveJson.peekSchemaVersion("""{"schemaVersion":4294967297}"""))
        try {
            ArchiveJson.parseManifest(
                """
                {
                  "schemaVersion": 4294967297,
                  "createdAt": "2026-09-14T18:00:00Z",
                  "scope": "library",
                  "scopeId": null,
                  "files": [],
                  "recordCounts": {"assets":0,"revisions":0,"collectionMembers":0,"assetTags":0}
                }
                """.trimIndent(),
            )
            fail("expected overflow schemaVersion to be rejected")
        } catch (_: IllegalArgumentException) {
            // expected
        }
    }

    @Test
    fun recordCountsOutsideIntRangeAreRejected() {
        val manifest =
            """
            {
              "schemaVersion": 1,
              "createdAt": "2026-09-14T18:00:00Z",
              "scope": "library",
              "scopeId": null,
              "files": [],
              "recordCounts": {"assets":2147483648,"revisions":0,"collectionMembers":0,"assetTags":0}
            }
            """.trimIndent()
        try {
            ArchiveJson.parseManifest(manifest)
            fail("expected overflow recordCounts.assets to be rejected")
        } catch (_: IllegalArgumentException) {
            // expected
        }
    }

    @Test
    fun secretLikeKeysAreStrippedFromStubRecords() {
        val stub = JSONObject("""{"id":"x","apiKey":"k","nested":{"signedUrl":"u","ok":1},"list":[{"token":"t","keep":2}]}""")
        val cleaned = ArchiveJson.stripSecretFields(stub)
        assertEquals(setOf("id", "nested", "list"), cleaned.keys().asSequence().toSet())
        assertEquals(setOf("ok"), cleaned.getJSONObject("nested").keys().asSequence().toSet())
        assertEquals(setOf("keep"), cleaned.getJSONArray("list").getJSONObject(0).keys().asSequence().toSet())
    }
}
