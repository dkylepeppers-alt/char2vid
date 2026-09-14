package com.char2vid.studio.library

/**
 * Archive v1 record shapes. Field names and nullability mirror
 * `archive-schema.ts` (`ArchiveManifestV1`, `archiveRecordsV1Schema`).
 */
data class ArchiveManifestFile(
    val path: String,
    val sha256: String,
    val bytes: Long,
    val mime: String,
)

data class ArchiveRecordCounts(
    val assets: Int,
    val revisions: Int,
    val collectionMembers: Int,
    val assetTags: Int,
)

data class ArchiveManifest(
    val schemaVersion: Int,
    val createdAt: String,
    val scope: String,
    val scopeId: String?,
    val files: List<ArchiveManifestFile>,
    val recordCounts: ArchiveRecordCounts,
)

/** Allowlisted durable asset fields — the only asset data that leaves the device. */
data class ArchiveAsset(
    val id: String,
    val revisionId: String,
    val kind: String,
    val name: String,
    val mime: String,
    val sha256: String,
    val bytes: Long,
    val state: String,
    val createdAt: String,
    val favorite: Boolean,
    val rating: Int?,
    val folderId: String?,
    val trashedAt: String?,
)

data class ArchiveRevision(
    val id: String,
    val assetId: String,
    val sha256: String,
    val createdAt: String,
)

data class ArchiveCollectionMember(
    val collectionId: String,
    val assetId: String,
)

data class ArchiveAssetTag(
    val assetId: String,
    val tag: String,
)

data class ArchiveRecords(
    val assets: List<ArchiveAsset>,
    val revisions: List<ArchiveRevision>,
    val collectionMembers: List<ArchiveCollectionMember>,
    val assetTags: List<ArchiveAssetTag>,
)

/** Same fields as the web `ArchiveReport`. */
data class ArchiveReport(
    var schemaVersion: Int? = null,
    var fileCount: Int = 0,
    var expandedBytes: Long = 0L,
    val missingFiles: MutableList<String> = mutableListOf(),
    val invalidPaths: MutableList<String> = mutableListOf(),
    var unsupportedVersion: Boolean = false,
    var ok: Boolean = false,
    val errors: MutableList<String> = mutableListOf(),
)
