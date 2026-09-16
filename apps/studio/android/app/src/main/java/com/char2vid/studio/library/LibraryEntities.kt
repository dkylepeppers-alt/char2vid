package com.char2vid.studio.library

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room entities for the G2 native library.
 *
 * Plan SQL constraints (enforced in repository + UNIQUE indexes here):
 * - physical_objects.sha256 PRIMARY KEY
 * - physical_objects.relative_path UNIQUE NOT NULL
 * - physical_objects.byte_length >= 0
 * - import_journal.stage IN ('pending','written','promoted')
 */
@Entity(
    tableName = "physical_objects",
    indices = [Index(value = ["relative_path"], unique = true)],
)
data class PhysicalObjectEntity(
    @PrimaryKey
    @ColumnInfo(name = "sha256")
    val sha256: String,
    @ColumnInfo(name = "relative_path")
    val relativePath: String,
    @ColumnInfo(name = "byte_length")
    val byteLength: Long,
)

@Entity(tableName = "import_journal")
data class ImportJournalEntity(
    @PrimaryKey
    @ColumnInfo(name = "import_id")
    val importId: String,
    @ColumnInfo(name = "asset_id")
    val assetId: String,
    @ColumnInfo(name = "revision_id")
    val revisionId: String,
    /** pending | written | promoted */
    @ColumnInfo(name = "stage")
    val stage: String,
    @ColumnInfo(name = "temp_path")
    val tempPath: String,
    @ColumnInfo(name = "final_hash")
    val finalHash: String?,
    @ColumnInfo(name = "name")
    val name: String,
    @ColumnInfo(name = "mime")
    val mime: String,
    @ColumnInfo(name = "kind")
    val kind: String,
    @ColumnInfo(name = "created_at")
    val createdAt: String,
)

@Entity(
    tableName = "assets",
    indices = [
        Index(value = ["revision_id"], unique = true),
        Index(value = ["created_at"]),
        Index(value = ["name"]),
    ],
)
data class AssetEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,
    @ColumnInfo(name = "revision_id")
    val revisionId: String,
    @ColumnInfo(name = "kind")
    val kind: String,
    @ColumnInfo(name = "name")
    val name: String,
    @ColumnInfo(name = "mime")
    val mime: String,
    @ColumnInfo(name = "sha256")
    val sha256: String,
    @ColumnInfo(name = "bytes")
    val bytes: Long,
    /** pending | available | missing */
    @ColumnInfo(name = "state")
    val state: String,
    @ColumnInfo(name = "created_at")
    val createdAt: String,
    @ColumnInfo(name = "favorite")
    val favorite: Boolean = false,
    @ColumnInfo(name = "rating")
    val rating: Int? = null,
    @ColumnInfo(name = "folder_id")
    val folderId: String? = null,
    @ColumnInfo(name = "trashed_at")
    val trashedAt: String? = null,
)

@Entity(
    tableName = "revisions",
    foreignKeys = [
        ForeignKey(
            entity = AssetEntity::class,
            parentColumns = ["id"],
            childColumns = ["asset_id"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index(value = ["asset_id"]), Index(value = ["sha256"])],
)
data class RevisionEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,
    @ColumnInfo(name = "asset_id")
    val assetId: String,
    @ColumnInfo(name = "sha256")
    val sha256: String,
    @ColumnInfo(name = "created_at")
    val createdAt: String,
)

@Entity(
    tableName = "collection_members",
    primaryKeys = ["collection_id", "asset_id"],
    indices = [Index(value = ["asset_id"])],
)
data class CollectionMemberEntity(
    @ColumnInfo(name = "collection_id")
    val collectionId: String,
    @ColumnInfo(name = "asset_id")
    val assetId: String,
)

@Entity(
    tableName = "asset_tags",
    primaryKeys = ["asset_id", "tag"],
    indices = [Index(value = ["tag"])],
)
data class AssetTagEntity(
    @ColumnInfo(name = "asset_id")
    val assetId: String,
    @ColumnInfo(name = "tag")
    val tag: String,
)

@Entity(
    tableName = "characters",
    indices = [Index(value = ["created_at"]), Index(value = ["name"])],
)
data class CharacterEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,
    @ColumnInfo(name = "name")
    val name: String,
    @ColumnInfo(name = "current_revision_id")
    val currentRevisionId: String,
    @ColumnInfo(name = "cover_asset_revision_id")
    val coverAssetRevisionId: String?,
    @ColumnInfo(name = "created_at")
    val createdAt: String,
)

@Entity(
    tableName = "character_revisions",
    indices = [Index(value = ["character_id"])],
)
data class CharacterRevisionEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,
    @ColumnInfo(name = "character_id")
    val characterId: String,
    @ColumnInfo(name = "parent_revision_id")
    val parentRevisionId: String?,
    @ColumnInfo(name = "identity_notes")
    val identityNotes: String,
    @ColumnInfo(name = "references_json")
    val referencesJson: String,
)

@Entity(
    tableName = "looks",
    indices = [Index(value = ["character_id"])],
)
data class LookEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,
    @ColumnInfo(name = "character_id")
    val characterId: String,
    @ColumnInfo(name = "label")
    val label: String,
    @ColumnInfo(name = "notes")
    val notes: String,
    @ColumnInfo(name = "reference_revision_ids_json")
    val referenceRevisionIdsJson: String,
)
