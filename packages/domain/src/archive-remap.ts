import type { AssetRecord } from './storage';

export type IdMap = Record<string, string>;

export interface ArchiveRevisionRecord {
  id: string;
  assetId: string;
  sha256: string;
  createdAt: string;
}

export interface ArchiveCollectionMember {
  collectionId: string;
  assetId: string;
}

export interface ArchiveAssetTag {
  assetId: string;
  tag: string;
}

/**
 * Build a collision map: incoming IDs that already exist (or collide within the
 * batch after remapping) are assigned fresh UUIDs. Unconflicted IDs map to themselves.
 */
export function createCollisionMap(
  existingIds: Iterable<string>,
  incomingIds: Iterable<string>,
  allocateId: () => string = () => crypto.randomUUID(),
): IdMap {
  const existing = new Set(existingIds);
  const map: IdMap = {};
  const claimed = new Set<string>(existing);

  for (const id of incomingIds) {
    if (!id) {
      continue;
    }
    if (map[id] !== undefined) {
      continue;
    }
    if (!claimed.has(id)) {
      map[id] = id;
      claimed.add(id);
      continue;
    }
    let next = allocateId();
    while (claimed.has(next)) {
      next = allocateId();
    }
    map[id] = next;
    claimed.add(next);
  }
  return map;
}

export function mergeIdMaps(...maps: IdMap[]): IdMap {
  const out: IdMap = {};
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      out[key] = value;
    }
  }
  return out;
}

export function remapId(id: string, idMap: IdMap): string {
  return idMap[id] ?? id;
}

export function remapOptionalId(
  id: string | null | undefined,
  idMap: IdMap,
): string | null | undefined {
  if (id === null || id === undefined) {
    return id;
  }
  return remapId(id, idMap);
}

export function remapAssetRecord(
  asset: AssetRecord,
  idMap: IdMap,
): AssetRecord {
  return {
    ...asset,
    id: remapId(asset.id, idMap),
    revisionId: remapId(asset.revisionId, idMap),
    folderId:
      asset.folderId === null
        ? null
        : (remapOptionalId(asset.folderId, idMap) as string),
  };
}

export function remapRevisionRecord(
  revision: ArchiveRevisionRecord,
  idMap: IdMap,
): ArchiveRevisionRecord {
  return {
    ...revision,
    id: remapId(revision.id, idMap),
    assetId: remapId(revision.assetId, idMap),
  };
}

export function remapCollectionMember(
  member: ArchiveCollectionMember,
  idMap: IdMap,
): ArchiveCollectionMember {
  return {
    collectionId: remapId(member.collectionId, idMap),
    assetId: remapId(member.assetId, idMap),
  };
}

export function remapAssetTag(
  row: ArchiveAssetTag,
  idMap: IdMap,
): ArchiveAssetTag {
  return {
    assetId: remapId(row.assetId, idMap),
    tag: row.tag,
  };
}

const ID_LIKE_KEYS = new Set([
  'id',
  'assetId',
  'revisionId',
  'characterId',
  'characterRevisionId',
  'lookId',
  'shotId',
  'shotRevisionId',
  'projectId',
  'folderId',
  'collectionId',
  'fromNodeId',
  'toNodeId',
  'nodeId',
  'edgeId',
  'timelineId',
  'clipId',
  'bindingId',
  'assetRevisionId',
]);

/**
 * Generic deep remap for future record types (characters/looks/shots/graph/
 * timeline). Known ID-like keys are rewritten; nested objects/arrays traversed.
 * Schema-owned so new types do not silently drop links when they start exporting.
 */
export function remapGenericRecord(
  record: Record<string, unknown>,
  idMap: IdMap,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && ID_LIKE_KEYS.has(key)) {
      out[key] = remapId(value, idMap);
    } else if (Array.isArray(value)) {
      out[key] = value.map((item: unknown) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          return remapGenericRecord(item as Record<string, unknown>, idMap);
        }
        if (typeof item === 'string' && key.endsWith('Ids')) {
          return remapId(item, idMap);
        }
        return item;
      });
    } else if (value && typeof value === 'object') {
      out[key] = remapGenericRecord(value as Record<string, unknown>, idMap);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function remapCharacterRecord(
  record: Record<string, unknown>,
  idMap: IdMap,
): Record<string, unknown> {
  return remapGenericRecord(record, idMap);
}

export function remapLookRecord(
  record: Record<string, unknown>,
  idMap: IdMap,
): Record<string, unknown> {
  return remapGenericRecord(record, idMap);
}

export function remapShotRecord(
  record: Record<string, unknown>,
  idMap: IdMap,
): Record<string, unknown> {
  return remapGenericRecord(record, idMap);
}

export function remapGraphEdgeRecord(
  record: Record<string, unknown>,
  idMap: IdMap,
): Record<string, unknown> {
  return remapGenericRecord(record, idMap);
}

export function remapTimelineRecord(
  record: Record<string, unknown>,
  idMap: IdMap,
): Record<string, unknown> {
  return remapGenericRecord(record, idMap);
}

export interface RemappableArchiveRecords {
  assets: AssetRecord[];
  revisions: ArchiveRevisionRecord[];
  collectionMembers: ArchiveCollectionMember[];
  assetTags: ArchiveAssetTag[];
  characters: Record<string, unknown>[];
  looks: Record<string, unknown>[];
  shots: Record<string, unknown>[];
  graphEdges: Record<string, unknown>[];
  timeline: Record<string, unknown>[];
}

/** Schema-owned traversal: remap every known record type consistently. */
export function remapArchiveRecords(
  records: RemappableArchiveRecords,
  idMap: IdMap,
): RemappableArchiveRecords {
  return {
    assets: records.assets.map((a) => remapAssetRecord(a, idMap)),
    revisions: records.revisions.map((r) => remapRevisionRecord(r, idMap)),
    collectionMembers: records.collectionMembers.map((m) =>
      remapCollectionMember(m, idMap),
    ),
    assetTags: records.assetTags.map((t) => remapAssetTag(t, idMap)),
    characters: records.characters.map((r) => remapCharacterRecord(r, idMap)),
    looks: records.looks.map((r) => remapLookRecord(r, idMap)),
    shots: records.shots.map((r) => remapShotRecord(r, idMap)),
    graphEdges: records.graphEdges.map((r) => remapGraphEdgeRecord(r, idMap)),
    timeline: records.timeline.map((r) => remapTimelineRecord(r, idMap)),
  };
}

/** Collect logical IDs that participate in collision detection for library scope. */
export function collectLibraryIncomingIds(
  records: Pick<
    RemappableArchiveRecords,
    'assets' | 'revisions' | 'collectionMembers'
  >,
): string[] {
  const ids: string[] = [];
  for (const asset of records.assets) {
    ids.push(asset.id, asset.revisionId);
    if (asset.folderId) {
      ids.push(asset.folderId);
    }
  }
  for (const revision of records.revisions) {
    ids.push(revision.id, revision.assetId);
  }
  for (const member of records.collectionMembers) {
    ids.push(member.collectionId, member.assetId);
  }
  return ids;
}
