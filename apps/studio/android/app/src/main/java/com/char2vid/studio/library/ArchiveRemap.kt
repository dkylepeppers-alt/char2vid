package com.char2vid.studio.library

import java.util.UUID

/**
 * Port of `packages/domain/src/archive-remap.ts` for library scope. Incoming
 * IDs that already exist in the target library (or collide within the batch)
 * receive fresh UUIDs; everything else maps to itself.
 */
object ArchiveRemap {
    fun createCollisionMap(
        existingIds: Set<String>,
        incomingIds: Iterable<String>,
        allocateId: () -> String = { UUID.randomUUID().toString() },
    ): Map<String, String> {
        val map = LinkedHashMap<String, String>()
        val claimed = HashSet(existingIds)
        for (id in incomingIds) {
            if (id.isEmpty()) {
                continue
            }
            if (map.containsKey(id)) {
                continue
            }
            if (!claimed.contains(id)) {
                map[id] = id
                claimed.add(id)
                continue
            }
            var next = allocateId()
            while (claimed.contains(next)) {
                next = allocateId()
            }
            map[id] = next
            claimed.add(next)
        }
        return map
    }

    /** Same visitation order as `collectLibraryIncomingIds`. */
    fun collectLibraryIncomingIds(records: ArchiveRecords): List<String> {
        val ids = ArrayList<String>()
        for (asset in records.assets) {
            ids.add(asset.id)
            ids.add(asset.revisionId)
            val folder = asset.folderId
            if (!folder.isNullOrEmpty()) {
                ids.add(folder)
            }
        }
        for (revision in records.revisions) {
            ids.add(revision.id)
            ids.add(revision.assetId)
        }
        for (member in records.collectionMembers) {
            ids.add(member.collectionId)
            ids.add(member.assetId)
        }
        for (character in records.characters) {
            ids.addAll(characterIds(character))
        }
        for (look in records.looks) {
            ids.add(look.id)
            ids.add(look.characterId)
            ids.addAll(look.referenceRevisionIds)
        }
        return ids
    }

    private fun characterIds(character: ArchiveCharacter): List<String> {
        val ids = ArrayList<String>()
        ids.add(character.id)
        ids.add(character.currentRevisionId)
        val cover = character.coverAssetRevisionId
        if (!cover.isNullOrEmpty()) {
            ids.add(cover)
        }
        for (revision in character.revisions) {
            ids.add(revision.id)
            ids.add(revision.characterId)
            val parent = revision.parentRevisionId
            if (!parent.isNullOrEmpty()) {
                ids.add(parent)
            }
            for (reference in revision.references) {
                ids.add(reference.assetRevisionId)
            }
        }
        return ids
    }

    fun remapId(id: String, idMap: Map<String, String>): String = idMap[id] ?: id

    fun remapRecords(records: ArchiveRecords, idMap: Map<String, String>): ArchiveRecords =
        ArchiveRecords(
            assets =
                records.assets.map { a ->
                    a.copy(
                        id = remapId(a.id, idMap),
                        revisionId = remapId(a.revisionId, idMap),
                        folderId = a.folderId?.let { remapId(it, idMap) },
                    )
                },
            revisions =
                records.revisions.map { r ->
                    r.copy(id = remapId(r.id, idMap), assetId = remapId(r.assetId, idMap))
                },
            collectionMembers =
                records.collectionMembers.map { m ->
                    ArchiveCollectionMember(
                        collectionId = remapId(m.collectionId, idMap),
                        assetId = remapId(m.assetId, idMap),
                    )
                },
            assetTags =
                records.assetTags.map { t ->
                    ArchiveAssetTag(assetId = remapId(t.assetId, idMap), tag = t.tag)
                },
            characters =
                records.characters.map { character ->
                    character.copy(
                        id = remapId(character.id, idMap),
                        currentRevisionId = remapId(character.currentRevisionId, idMap),
                        coverAssetRevisionId = character.coverAssetRevisionId?.let { remapId(it, idMap) },
                        revisions =
                            character.revisions.map { revision ->
                                revision.copy(
                                    id = remapId(revision.id, idMap),
                                    characterId = remapId(revision.characterId, idMap),
                                    parentRevisionId = revision.parentRevisionId?.let { remapId(it, idMap) },
                                    references =
                                        revision.references.map { reference ->
                                            reference.copy(assetRevisionId = remapId(reference.assetRevisionId, idMap))
                                        },
                                )
                            },
                    )
                },
            looks =
                records.looks.map { look ->
                    look.copy(
                        id = remapId(look.id, idMap),
                        characterId = remapId(look.characterId, idMap),
                        referenceRevisionIds = look.referenceRevisionIds.map { remapId(it, idMap) },
                    )
                },
        )
}
