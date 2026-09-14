package com.char2vid.studio.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors `packages/domain/src/archive-remap.ts` collision semantics. */
class ArchiveRemapTest {
    @Test
    fun unconflictedIdsMapToThemselves() {
        val map = ArchiveRemap.createCollisionMap(setOf("x"), listOf("a", "b", "a"))
        assertEquals(mapOf("a" to "a", "b" to "b"), map)
    }

    @Test
    fun collidingIdsGetFreshUniqueIds() {
        var counter = 0
        val map =
            ArchiveRemap.createCollisionMap(
                existingIds = setOf("a", "fresh-1"),
                incomingIds = listOf("a", "b", "", "a"),
            ) { counter += 1; "fresh-$counter" }
        assertEquals(setOf("a", "b"), map.keys)
        assertEquals("b", map["b"])
        // fresh-1 is already claimed by the existing library, so allocation skips it.
        assertEquals("fresh-2", map["a"])
        assertNotEquals("a", map["a"])
    }

    @Test
    fun incomingIdsFollowWebCollectionOrder() {
        val asset =
            ArchiveAsset(
                id = "asset",
                revisionId = "rev",
                kind = "image",
                name = "n.png",
                mime = "image/png",
                sha256 = "0".repeat(64),
                bytes = 1,
                state = "available",
                createdAt = "2026-01-01T00:00:00.000Z",
                favorite = false,
                rating = null,
                folderId = "folder",
                trashedAt = null,
            )
        val records =
            ArchiveRecords(
                assets = listOf(asset),
                revisions = listOf(ArchiveRevision("rev", "asset", "0".repeat(64), asset.createdAt)),
                collectionMembers = listOf(ArchiveCollectionMember("col", "asset")),
                assetTags = listOf(ArchiveAssetTag("asset", "portrait")),
            )
        assertEquals(
            listOf("asset", "rev", "folder", "rev", "asset", "col", "asset"),
            ArchiveRemap.collectLibraryIncomingIds(records),
        )

        val idMap = mapOf("asset" to "asset2", "rev" to "rev2", "col" to "col2", "folder" to "folder2")
        val remapped = ArchiveRemap.remapRecords(records, idMap)
        assertEquals("asset2", remapped.assets[0].id)
        assertEquals("rev2", remapped.assets[0].revisionId)
        assertEquals("folder2", remapped.assets[0].folderId)
        assertEquals("rev2", remapped.revisions[0].id)
        assertEquals("asset2", remapped.revisions[0].assetId)
        assertEquals("col2", remapped.collectionMembers[0].collectionId)
        assertEquals("asset2", remapped.collectionMembers[0].assetId)
        assertEquals("asset2", remapped.assetTags[0].assetId)
        assertEquals("portrait", remapped.assetTags[0].tag)
        assertTrue(remapped.assets[0].trashedAt == null)
    }
}
