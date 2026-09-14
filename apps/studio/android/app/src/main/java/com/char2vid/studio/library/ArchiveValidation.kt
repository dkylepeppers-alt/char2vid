package com.char2vid.studio.library

/**
 * Inspect-time record checks that must pass before remapping or committing.
 * Duplicate logical IDs collapse through `associateBy` / Room upserts, and
 * tag/membership rows have no asset foreign key, so both are rejected here.
 */
object ArchiveValidation {
    fun logicalIdErrors(records: ArchiveRecords): List<String> {
        val errors = ArrayList<String>()
        val assetIds = HashSet<String>()
        for (asset in records.assets) {
            if (!assetIds.add(asset.id)) {
                errors.add("duplicate asset id ${asset.id}")
            }
        }
        val revisionIds = HashSet<String>()
        for (revision in records.revisions) {
            if (!revisionIds.add(revision.id)) {
                errors.add("duplicate revision id ${revision.id}")
            }
        }
        return errors
    }

    fun referenceErrors(records: ArchiveRecords): List<String> {
        val assetIds = records.assets.map { it.id }.toHashSet()
        val errors = ArrayList<String>()
        for (member in records.collectionMembers) {
            if (!assetIds.contains(member.assetId)) {
                errors.add("collectionMembers references missing asset ${member.assetId}")
            }
        }
        for (tag in records.assetTags) {
            if (!assetIds.contains(tag.assetId)) {
                errors.add("assetTags references missing asset ${tag.assetId}")
            }
        }
        return errors
    }
}
