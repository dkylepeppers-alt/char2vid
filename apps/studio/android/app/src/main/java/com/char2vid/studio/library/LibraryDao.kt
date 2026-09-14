package com.char2vid.studio.library

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update

@Dao
interface LibraryDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertJournal(entry: ImportJournalEntity)

    @Query("SELECT * FROM import_journal WHERE import_id = :importId")
    fun getJournal(importId: String): ImportJournalEntity?

    @Query("SELECT * FROM import_journal")
    fun listJournal(): List<ImportJournalEntity>

    @Query("DELETE FROM import_journal WHERE import_id = :importId")
    fun deleteJournal(importId: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertAsset(asset: AssetEntity)

    @Update
    fun updateAsset(asset: AssetEntity)

    @Query("SELECT * FROM assets WHERE id = :id")
    fun getAsset(id: String): AssetEntity?

    @Query("SELECT * FROM assets")
    fun listAssets(): List<AssetEntity>

    @Query("DELETE FROM assets WHERE id = :id")
    fun deleteAsset(id: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertRevision(revision: RevisionEntity)

    @Query("SELECT * FROM revisions WHERE id = :id")
    fun getRevision(id: String): RevisionEntity?

    @Query("SELECT * FROM revisions")
    fun listRevisions(): List<RevisionEntity>

    @Query("SELECT COUNT(*) FROM revisions WHERE sha256 = :sha256")
    fun countRevisionsWithHash(sha256: String): Int

    @Query("DELETE FROM revisions WHERE id = :id")
    fun deleteRevision(id: String)

    @Query("DELETE FROM revisions WHERE asset_id = :assetId")
    fun deleteRevisionsForAsset(assetId: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertPhysical(obj: PhysicalObjectEntity)

    @Query("SELECT * FROM physical_objects WHERE sha256 = :sha256")
    fun getPhysical(sha256: String): PhysicalObjectEntity?

    @Query("SELECT COUNT(*) FROM physical_objects")
    fun countPhysical(): Int

    @Query("DELETE FROM physical_objects WHERE sha256 = :sha256")
    fun deletePhysical(sha256: String)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    fun insertCollectionMember(member: CollectionMemberEntity)

    @Query(
        "DELETE FROM collection_members WHERE collection_id = :collectionId AND asset_id = :assetId",
    )
    fun deleteCollectionMember(collectionId: String, assetId: String)

    @Query("DELETE FROM collection_members WHERE asset_id = :assetId")
    fun deleteCollectionMembersForAsset(assetId: String)

    @Query("SELECT * FROM collection_members WHERE collection_id = :collectionId")
    fun listCollectionMembers(collectionId: String): List<CollectionMemberEntity>

    @Query("SELECT * FROM collection_members")
    fun listAllCollectionMembers(): List<CollectionMemberEntity>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    fun insertAssetTag(tag: AssetTagEntity)

    @Query("DELETE FROM asset_tags WHERE asset_id = :assetId AND tag = :tag")
    fun deleteAssetTag(assetId: String, tag: String)

    @Query("DELETE FROM asset_tags WHERE asset_id = :assetId")
    fun deleteAssetTagsForAsset(assetId: String)

    @Query("SELECT * FROM asset_tags")
    fun listAllAssetTags(): List<AssetTagEntity>

    @Query("SELECT * FROM asset_tags WHERE asset_id = :assetId")
    fun listAssetTags(assetId: String): List<AssetTagEntity>

    /**
     * Atomically mark asset available, upsert physical + revision, clear journal.
     */
    @Transaction
    fun commitAvailable(
        asset: AssetEntity,
        revision: RevisionEntity,
        physical: PhysicalObjectEntity,
        importId: String,
    ) {
        require(asset.state == "available") { "commitAvailable requires available state" }
        require(asset.sha256.isNotEmpty()) { "commitAvailable requires sha256" }
        require(physical.byteLength >= 0L) { "byte_length must be >= 0" }
        // Asset first so revision foreign key is satisfied.
        upsertAsset(asset)
        upsertPhysical(physical)
        upsertRevision(revision)
        deleteJournal(importId)
    }
}
