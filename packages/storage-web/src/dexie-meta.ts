import type { AssetRecord } from '@char2vid/domain/storage';
import { normalizeAssetRecord } from '@char2vid/domain/asset-schema';
import {
  parseCharacterRecord,
  parseCharacterRevision,
  parseLookRevision,
  type CharacterRecord,
  type CharacterRevision,
  type LookRevision,
} from '@char2vid/domain/characters/schema';
import Dexie, { type EntityTable } from 'dexie';

import type {
  AssetTagRow,
  CollectionMember,
  JournalEntry,
  MetaStore,
  PhysicalObject,
  RevisionRecord,
} from './protocol';

type Char2vidDb = Dexie & {
  journal: EntityTable<JournalEntry, 'importId'>;
  assets: EntityTable<AssetRecord, 'id'>;
  revisions: EntityTable<RevisionRecord, 'id'>;
  physical: EntityTable<PhysicalObject, 'sha256'>;
  collectionMembers: EntityTable<CollectionMember & { id: string }, 'id'>;
  assetTags: EntityTable<AssetTagRow & { id: string }, 'id'>;
  characters: EntityTable<CharacterRecord, 'id'>;
  characterRevisions: EntityTable<CharacterRevision, 'id'>;
  looks: EntityTable<LookRevision, 'id'>;
};

function memberKey(collectionId: string, assetId: string): string {
  return `${collectionId}\0${assetId}`;
}

function tagKey(assetId: string, tag: string): string {
  return `${assetId}\0${tag}`;
}

export function openChar2vidDb(dbName: string): Char2vidDb {
  const db = new Dexie(dbName) as Char2vidDb;
  db.version(1).stores({
    journal: 'importId, assetId, stage',
    assets: 'id, revisionId, sha256, state',
    revisions: 'id, assetId, sha256',
    physical: 'sha256, relativePath',
  });
  db.version(2)
    .stores({
      journal: 'importId, assetId, stage',
      assets:
        'id, revisionId, sha256, state, folderId, trashedAt, favorite, createdAt, name',
      revisions: 'id, assetId, sha256',
      physical: 'sha256, relativePath',
      collectionMembers: 'id, collectionId, assetId, [collectionId+assetId]',
      assetTags: 'id, assetId, tag, [assetId+tag]',
    })
    .upgrade(async (tx) => {
      const table = tx.table('assets');
      await table.toCollection().modify((row: Record<string, unknown>) => {
        if (row.favorite === undefined) {
          row.favorite = false;
        }
        if (row.rating === undefined) {
          row.rating = null;
        }
        if (row.folderId === undefined) {
          row.folderId = null;
        }
        if (row.trashedAt === undefined) {
          row.trashedAt = null;
        }
      });
    });
  db.version(3).stores({
    journal: 'importId, assetId, stage',
    assets:
      'id, revisionId, sha256, state, folderId, trashedAt, favorite, createdAt, name',
    revisions: 'id, assetId, sha256',
    physical: 'sha256, relativePath',
    collectionMembers: 'id, collectionId, assetId, [collectionId+assetId]',
    assetTags: 'id, assetId, tag, [assetId+tag]',
    characters: 'id, name, createdAt, currentRevisionId',
    characterRevisions: 'id, characterId, parentRevisionId',
    looks: 'id, characterId',
  });
  return db;
}

export class DexieMetaStore implements MetaStore {
  constructor(private readonly db: Char2vidDb) {}

  putJournal(entry: JournalEntry): Promise<void> {
    return this.db.journal.put(entry).then(() => undefined);
  }

  getJournal(importId: string): Promise<JournalEntry | undefined> {
    return this.db.journal.get(importId);
  }

  listJournal(): Promise<JournalEntry[]> {
    return this.db.journal.toArray();
  }

  deleteJournal(importId: string): Promise<void> {
    return this.db.journal.delete(importId);
  }

  putAsset(asset: AssetRecord): Promise<void> {
    return this.db.assets
      .put(normalizeAssetRecord(asset))
      .then(() => undefined);
  }

  async getAsset(id: string): Promise<AssetRecord | undefined> {
    const row = await this.db.assets.get(id);
    return row ? normalizeAssetRecord(row) : undefined;
  }

  deleteAsset(id: string): Promise<void> {
    return this.db.assets.delete(id);
  }

  async listAssets(): Promise<AssetRecord[]> {
    const rows = await this.db.assets.toArray();
    return rows.map((row) => normalizeAssetRecord(row));
  }

  putRevision(revision: RevisionRecord): Promise<void> {
    return this.db.revisions.put(revision).then(() => undefined);
  }

  getRevision(id: string): Promise<RevisionRecord | undefined> {
    return this.db.revisions.get(id);
  }

  deleteRevision(id: string): Promise<void> {
    return this.db.revisions.delete(id);
  }

  listRevisions(): Promise<RevisionRecord[]> {
    return this.db.revisions.toArray();
  }

  putPhysical(object: PhysicalObject): Promise<void> {
    return this.db.physical.put(object).then(() => undefined);
  }

  getPhysical(sha256: string): Promise<PhysicalObject | undefined> {
    return this.db.physical.get(sha256);
  }

  deletePhysical(sha256: string): Promise<void> {
    return this.db.physical.delete(sha256);
  }

  async countPhysical(): Promise<number> {
    return this.db.physical.count();
  }

  async listCollectionMembers(
    collectionId?: string,
  ): Promise<CollectionMember[]> {
    const rows = collectionId
      ? await this.db.collectionMembers
          .where('collectionId')
          .equals(collectionId)
          .toArray()
      : await this.db.collectionMembers.toArray();
    return rows.map(({ collectionId: c, assetId }) => ({
      collectionId: c,
      assetId,
    }));
  }

  putCollectionMember(member: CollectionMember): Promise<void> {
    return this.db.collectionMembers
      .put({
        id: memberKey(member.collectionId, member.assetId),
        ...member,
      })
      .then(() => undefined);
  }

  deleteCollectionMember(collectionId: string, assetId: string): Promise<void> {
    return this.db.collectionMembers.delete(memberKey(collectionId, assetId));
  }

  async deleteCollectionMembersForAsset(assetId: string): Promise<void> {
    await this.db.collectionMembers.where('assetId').equals(assetId).delete();
  }

  async listAssetTags(assetId?: string): Promise<AssetTagRow[]> {
    const rows = assetId
      ? await this.db.assetTags.where('assetId').equals(assetId).toArray()
      : await this.db.assetTags.toArray();
    return rows.map(({ assetId: a, tag }) => ({ assetId: a, tag }));
  }

  putAssetTag(row: AssetTagRow): Promise<void> {
    return this.db.assetTags
      .put({ id: tagKey(row.assetId, row.tag), ...row })
      .then(() => undefined);
  }

  deleteAssetTag(assetId: string, tag: string): Promise<void> {
    return this.db.assetTags.delete(tagKey(assetId, tag));
  }

  async deleteAssetTagsForAsset(assetId: string): Promise<void> {
    await this.db.assetTags.where('assetId').equals(assetId).delete();
  }

  async commitAvailable(args: {
    asset: AssetRecord;
    revision: RevisionRecord;
    physical: PhysicalObject;
    importId: string;
  }): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.assets,
      this.db.revisions,
      this.db.physical,
      this.db.journal,
      async () => {
        await this.db.assets.put(normalizeAssetRecord(args.asset));
        await this.db.revisions.put(args.revision);
        await this.db.physical.put(args.physical);
        await this.db.journal.delete(args.importId);
      },
    );
  }

  async commitArchiveImport(args: {
    assets: AssetRecord[];
    revisions: RevisionRecord[];
    collectionMembers: CollectionMember[];
    assetTags: AssetTagRow[];
    characters?: CharacterRecord[];
    characterRevisions?: CharacterRevision[];
    looks?: LookRevision[];
  }): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.assets,
        this.db.revisions,
        this.db.collectionMembers,
        this.db.assetTags,
        this.db.characters,
        this.db.characterRevisions,
        this.db.looks,
      ],
      async () => {
        for (const asset of args.assets) {
          await this.db.assets.put(normalizeAssetRecord(asset));
        }
        for (const revision of args.revisions) {
          await this.db.revisions.put(revision);
        }
        for (const member of args.collectionMembers) {
          await this.db.collectionMembers.put({
            id: memberKey(member.collectionId, member.assetId),
            ...member,
          });
        }
        for (const row of args.assetTags) {
          await this.db.assetTags.put({
            id: tagKey(row.assetId, row.tag),
            ...row,
          });
        }
        for (const character of args.characters ?? []) {
          await this.db.characters.put(parseCharacterRecord(character));
        }
        for (const revision of args.characterRevisions ?? []) {
          await this.db.characterRevisions.put(
            parseCharacterRevision(revision),
          );
        }
        for (const look of args.looks ?? []) {
          await this.db.looks.put(parseLookRevision(look));
        }
      },
    );
  }

  putCharacter(character: CharacterRecord): Promise<void> {
    return this.db.characters
      .put(parseCharacterRecord(character))
      .then(() => undefined);
  }

  async getCharacter(id: string): Promise<CharacterRecord | undefined> {
    const row = await this.db.characters.get(id);
    return row ? parseCharacterRecord(row) : undefined;
  }

  async listCharacters(): Promise<CharacterRecord[]> {
    const rows = await this.db.characters.toArray();
    return rows.map((row) => parseCharacterRecord(row));
  }

  putCharacterRevision(revision: CharacterRevision): Promise<void> {
    return this.db.characterRevisions
      .put(parseCharacterRevision(revision))
      .then(() => undefined);
  }

  async getCharacterRevision(
    id: string,
  ): Promise<CharacterRevision | undefined> {
    const row = await this.db.characterRevisions.get(id);
    return row ? parseCharacterRevision(row) : undefined;
  }

  async listCharacterRevisions(
    characterId?: string,
  ): Promise<CharacterRevision[]> {
    const rows = characterId
      ? await this.db.characterRevisions
          .where('characterId')
          .equals(characterId)
          .toArray()
      : await this.db.characterRevisions.toArray();
    return rows.map((row) => parseCharacterRevision(row));
  }

  putLook(look: LookRevision): Promise<void> {
    return this.db.looks.put(parseLookRevision(look)).then(() => undefined);
  }

  async getLook(id: string): Promise<LookRevision | undefined> {
    const row = await this.db.looks.get(id);
    return row ? parseLookRevision(row) : undefined;
  }

  async listLooks(characterId?: string): Promise<LookRevision[]> {
    const rows = characterId
      ? await this.db.looks.where('characterId').equals(characterId).toArray()
      : await this.db.looks.toArray();
    return rows.map((row) => parseLookRevision(row));
  }

  async deleteDatabase(): Promise<void> {
    this.db.close();
    await Dexie.delete(this.db.name);
  }
}
