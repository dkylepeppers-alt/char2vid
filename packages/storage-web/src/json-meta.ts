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

import type {
  AssetTagRow,
  CollectionMember,
  JournalEntry,
  MetaStore,
  PhysicalObject,
  RevisionRecord,
} from './protocol';

interface MetaSnapshot {
  journal: Record<string, JournalEntry>;
  assets: Record<string, AssetRecord>;
  revisions: Record<string, RevisionRecord>;
  physical: Record<string, PhysicalObject>;
  collectionMembers: Record<string, CollectionMember>;
  assetTags: Record<string, AssetTagRow>;
  characters: Record<string, CharacterRecord>;
  characterRevisions: Record<string, CharacterRevision>;
  looks: Record<string, LookRevision>;
}

export type MetaPersister = {
  load(): Promise<MetaSnapshot>;
  save(snapshot: MetaSnapshot): Promise<void>;
};

function emptySnapshot(): MetaSnapshot {
  return {
    journal: {},
    assets: {},
    revisions: {},
    physical: {},
    collectionMembers: {},
    assetTags: {},
    characters: {},
    characterRevisions: {},
    looks: {},
  };
}

function memberKey(collectionId: string, assetId: string): string {
  return `${collectionId}\0${assetId}`;
}

function tagKey(assetId: string, tag: string): string {
  return `${assetId}\0${tag}`;
}

function coerceSnapshot(
  raw: Partial<MetaSnapshot> | MetaSnapshot,
): MetaSnapshot {
  const base = emptySnapshot();
  return {
    journal: raw.journal ?? base.journal,
    assets: Object.fromEntries(
      Object.entries(raw.assets ?? {}).map(([id, asset]) => [
        id,
        normalizeAssetRecord(asset),
      ]),
    ),
    revisions: raw.revisions ?? base.revisions,
    physical: raw.physical ?? base.physical,
    collectionMembers: raw.collectionMembers ?? base.collectionMembers,
    assetTags: raw.assetTags ?? base.assetTags,
    characters: Object.fromEntries(
      Object.entries(raw.characters ?? {}).map(([id, character]) => [
        id,
        parseCharacterRecord(character),
      ]),
    ),
    characterRevisions: Object.fromEntries(
      Object.entries(raw.characterRevisions ?? {}).map(([id, revision]) => [
        id,
        parseCharacterRevision(revision),
      ]),
    ),
    looks: Object.fromEntries(
      Object.entries(raw.looks ?? {}).map(([id, look]) => [
        id,
        parseLookRevision(look),
      ]),
    ),
  };
}

/** In-memory meta with optional durable persister (atomic JSON file, etc.). */
export class JsonMetaStore implements MetaStore {
  private snapshot: MetaSnapshot = emptySnapshot();
  private readonly persister: MetaPersister | undefined;
  private loaded = false;

  constructor(persister?: MetaPersister) {
    this.persister = persister;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    if (this.persister) {
      this.snapshot = coerceSnapshot(await this.persister.load());
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    if (this.persister) {
      await this.persister.save(this.snapshot);
    }
  }

  async putJournal(entry: JournalEntry): Promise<void> {
    await this.ensureLoaded();
    this.snapshot.journal[entry.importId] = entry;
    await this.persist();
  }

  async getJournal(importId: string): Promise<JournalEntry | undefined> {
    await this.ensureLoaded();
    return this.snapshot.journal[importId];
  }

  async listJournal(): Promise<JournalEntry[]> {
    await this.ensureLoaded();
    return Object.values(this.snapshot.journal);
  }

  async deleteJournal(importId: string): Promise<void> {
    await this.ensureLoaded();
    delete this.snapshot.journal[importId];
    await this.persist();
  }

  async putAsset(asset: AssetRecord): Promise<void> {
    await this.ensureLoaded();
    this.snapshot.assets[asset.id] = normalizeAssetRecord(asset);
    await this.persist();
  }

  async getAsset(id: string): Promise<AssetRecord | undefined> {
    await this.ensureLoaded();
    const asset = this.snapshot.assets[id];
    return asset ? normalizeAssetRecord(asset) : undefined;
  }

  async deleteAsset(id: string): Promise<void> {
    await this.ensureLoaded();
    delete this.snapshot.assets[id];
    await this.persist();
  }

  async listAssets(): Promise<AssetRecord[]> {
    await this.ensureLoaded();
    return Object.values(this.snapshot.assets).map((a) =>
      normalizeAssetRecord(a),
    );
  }

  async putRevision(revision: RevisionRecord): Promise<void> {
    await this.ensureLoaded();
    this.snapshot.revisions[revision.id] = revision;
    await this.persist();
  }

  async getRevision(id: string): Promise<RevisionRecord | undefined> {
    await this.ensureLoaded();
    return this.snapshot.revisions[id];
  }

  async deleteRevision(id: string): Promise<void> {
    await this.ensureLoaded();
    delete this.snapshot.revisions[id];
    await this.persist();
  }

  async listRevisions(): Promise<RevisionRecord[]> {
    await this.ensureLoaded();
    return Object.values(this.snapshot.revisions);
  }

  async putPhysical(object: PhysicalObject): Promise<void> {
    await this.ensureLoaded();
    this.snapshot.physical[object.sha256] = object;
    await this.persist();
  }

  async getPhysical(sha256: string): Promise<PhysicalObject | undefined> {
    await this.ensureLoaded();
    return this.snapshot.physical[sha256];
  }

  async deletePhysical(sha256: string): Promise<void> {
    await this.ensureLoaded();
    delete this.snapshot.physical[sha256];
    await this.persist();
  }

  async countPhysical(): Promise<number> {
    await this.ensureLoaded();
    return Object.keys(this.snapshot.physical).length;
  }

  async listCollectionMembers(
    collectionId?: string,
  ): Promise<CollectionMember[]> {
    await this.ensureLoaded();
    const all = Object.values(this.snapshot.collectionMembers);
    return collectionId
      ? all.filter((m) => m.collectionId === collectionId)
      : all;
  }

  async putCollectionMember(member: CollectionMember): Promise<void> {
    await this.ensureLoaded();
    this.snapshot.collectionMembers[
      memberKey(member.collectionId, member.assetId)
    ] = member;
    await this.persist();
  }

  async deleteCollectionMember(
    collectionId: string,
    assetId: string,
  ): Promise<void> {
    await this.ensureLoaded();
    delete this.snapshot.collectionMembers[memberKey(collectionId, assetId)];
    await this.persist();
  }

  async deleteCollectionMembersForAsset(assetId: string): Promise<void> {
    await this.ensureLoaded();
    for (const [key, member] of Object.entries(
      this.snapshot.collectionMembers,
    )) {
      if (member.assetId === assetId) {
        delete this.snapshot.collectionMembers[key];
      }
    }
    await this.persist();
  }

  async listAssetTags(assetId?: string): Promise<AssetTagRow[]> {
    await this.ensureLoaded();
    const all = Object.values(this.snapshot.assetTags);
    return assetId ? all.filter((t) => t.assetId === assetId) : all;
  }

  async putAssetTag(row: AssetTagRow): Promise<void> {
    await this.ensureLoaded();
    this.snapshot.assetTags[tagKey(row.assetId, row.tag)] = row;
    await this.persist();
  }

  async deleteAssetTag(assetId: string, tag: string): Promise<void> {
    await this.ensureLoaded();
    delete this.snapshot.assetTags[tagKey(assetId, tag)];
    await this.persist();
  }

  async deleteAssetTagsForAsset(assetId: string): Promise<void> {
    await this.ensureLoaded();
    for (const [key, row] of Object.entries(this.snapshot.assetTags)) {
      if (row.assetId === assetId) {
        delete this.snapshot.assetTags[key];
      }
    }
    await this.persist();
  }

  async commitAvailable(args: {
    asset: AssetRecord;
    revision: RevisionRecord;
    physical: PhysicalObject;
    importId: string;
  }): Promise<void> {
    await this.ensureLoaded();
    this.snapshot.assets[args.asset.id] = normalizeAssetRecord(args.asset);
    this.snapshot.revisions[args.revision.id] = args.revision;
    this.snapshot.physical[args.physical.sha256] = args.physical;
    delete this.snapshot.journal[args.importId];
    await this.persist();
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
    await this.ensureLoaded();
    for (const asset of args.assets) {
      this.snapshot.assets[asset.id] = normalizeAssetRecord(asset);
    }
    for (const revision of args.revisions) {
      this.snapshot.revisions[revision.id] = revision;
    }
    for (const member of args.collectionMembers) {
      this.snapshot.collectionMembers[
        memberKey(member.collectionId, member.assetId)
      ] = member;
    }
    for (const row of args.assetTags) {
      this.snapshot.assetTags[tagKey(row.assetId, row.tag)] = row;
    }
    for (const character of args.characters ?? []) {
      this.snapshot.characters[character.id] = parseCharacterRecord(character);
    }
    for (const revision of args.characterRevisions ?? []) {
      this.snapshot.characterRevisions[revision.id] =
        parseCharacterRevision(revision);
    }
    for (const look of args.looks ?? []) {
      this.snapshot.looks[look.id] = parseLookRevision(look);
    }
    await this.persist();
  }

  async putCharacter(character: CharacterRecord): Promise<void> {
    await this.ensureLoaded();
    this.snapshot.characters[character.id] = parseCharacterRecord(character);
    await this.persist();
  }

  async getCharacter(id: string): Promise<CharacterRecord | undefined> {
    await this.ensureLoaded();
    const row = this.snapshot.characters[id];
    return row ? parseCharacterRecord(row) : undefined;
  }

  async listCharacters(): Promise<CharacterRecord[]> {
    await this.ensureLoaded();
    return Object.values(this.snapshot.characters).map((row) =>
      parseCharacterRecord(row),
    );
  }

  async putCharacterRevision(revision: CharacterRevision): Promise<void> {
    await this.ensureLoaded();
    this.snapshot.characterRevisions[revision.id] =
      parseCharacterRevision(revision);
    await this.persist();
  }

  async getCharacterRevision(
    id: string,
  ): Promise<CharacterRevision | undefined> {
    await this.ensureLoaded();
    const row = this.snapshot.characterRevisions[id];
    return row ? parseCharacterRevision(row) : undefined;
  }

  async listCharacterRevisions(
    characterId?: string,
  ): Promise<CharacterRevision[]> {
    await this.ensureLoaded();
    return Object.values(this.snapshot.characterRevisions)
      .map((row) => parseCharacterRevision(row))
      .filter((row) =>
        characterId === undefined ? true : row.characterId === characterId,
      );
  }

  async putLook(look: LookRevision): Promise<void> {
    await this.ensureLoaded();
    this.snapshot.looks[look.id] = parseLookRevision(look);
    await this.persist();
  }

  async getLook(id: string): Promise<LookRevision | undefined> {
    await this.ensureLoaded();
    const row = this.snapshot.looks[id];
    return row ? parseLookRevision(row) : undefined;
  }

  async listLooks(characterId?: string): Promise<LookRevision[]> {
    await this.ensureLoaded();
    return Object.values(this.snapshot.looks)
      .map((row) => parseLookRevision(row))
      .filter((row) =>
        characterId === undefined ? true : row.characterId === characterId,
      );
  }
}
