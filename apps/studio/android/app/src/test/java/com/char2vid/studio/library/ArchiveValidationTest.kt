package com.char2vid.studio.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ArchiveValidationTest {
    private val sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    private val assetId = "6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7"
    private val revisionId = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f"
    private val otherAsset = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    private val otherRevision = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

    private fun asset(id: String = assetId, revisionId: String = this.revisionId) =
        ArchiveAsset(
            id = id,
            revisionId = revisionId,
            kind = "image",
            name = "tiny.png",
            mime = "image/png",
            sha256 = sha,
            bytes = 70,
            state = "available",
            createdAt = "2026-09-14T18:00:00.000Z",
            favorite = false,
            rating = null,
            folderId = null,
            trashedAt = null,
        )

    @Test
    fun duplicateAssetIdsAreReported() {
        val records =
            ArchiveRecords(
                assets = listOf(asset(), asset().copy(revisionId = otherRevision)),
                revisions =
                    listOf(
                        ArchiveRevision(revisionId, assetId, sha, "2026-09-14T18:00:00.000Z"),
                        ArchiveRevision(otherRevision, assetId, sha, "2026-09-14T18:00:00.000Z"),
                    ),
                collectionMembers = emptyList(),
                assetTags = emptyList(),
            )
        val errors = ArchiveValidation.logicalIdErrors(records)
        assertTrue(errors.any { it.contains("duplicate asset id") })
    }

    @Test
    fun duplicateRevisionIdsAreReported() {
        val records =
            ArchiveRecords(
                assets = listOf(asset(), asset(otherAsset, otherRevision)),
                revisions =
                    listOf(
                        ArchiveRevision(revisionId, assetId, sha, "2026-09-14T18:00:00.000Z"),
                        ArchiveRevision(revisionId, otherAsset, sha, "2026-09-14T18:00:00.000Z"),
                    ),
                collectionMembers = emptyList(),
                assetTags = emptyList(),
            )
        val errors = ArchiveValidation.logicalIdErrors(records)
        assertTrue(errors.any { it.contains("duplicate revision id") })
    }

    @Test
    fun danglingTagAndMembershipAssetIdsAreReported() {
        val records =
            ArchiveRecords(
                assets = listOf(asset()),
                revisions = listOf(ArchiveRevision(revisionId, assetId, sha, "2026-09-14T18:00:00.000Z")),
                collectionMembers = listOf(ArchiveCollectionMember("shoot-1", otherAsset)),
                assetTags = listOf(ArchiveAssetTag(otherAsset, "stale")),
            )
        val errors = ArchiveValidation.referenceErrors(records)
        assertTrue(errors.any { it.contains("collectionMembers") && it.contains(otherAsset) })
        assertTrue(errors.any { it.contains("assetTags") && it.contains(otherAsset) })
    }

    @Test
    fun matchingReferencesProduceNoErrors() {
        val records =
            ArchiveRecords(
                assets = listOf(asset()),
                revisions = listOf(ArchiveRevision(revisionId, assetId, sha, "2026-09-14T18:00:00.000Z")),
                collectionMembers = listOf(ArchiveCollectionMember("shoot-1", assetId)),
                assetTags = listOf(ArchiveAssetTag(assetId, "portrait")),
            )
        assertEquals(emptyList<String>(), ArchiveValidation.logicalIdErrors(records))
        assertEquals(emptyList<String>(), ArchiveValidation.referenceErrors(records))
    }
}
