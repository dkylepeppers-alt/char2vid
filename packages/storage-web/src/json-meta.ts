import type { AssetRecord } from '@char2vid/domain/storage';

import type {
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
}

export type MetaPersister = {
  load(): Promise<MetaSnapshot>;
  save(snapshot: MetaSnapshot): Promise<void>;
};

function emptySnapshot(): MetaSnapshot {
  return { journal: {}, assets: {}, revisions: {}, physical: {} };
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
      this.snapshot = await this.persister.load();
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
    this.snapshot.assets[asset.id] = asset;
    await this.persist();
  }

  async getAsset(id: string): Promise<AssetRecord | undefined> {
    await this.ensureLoaded();
    return this.snapshot.assets[id];
  }

  async deleteAsset(id: string): Promise<void> {
    await this.ensureLoaded();
    delete this.snapshot.assets[id];
    await this.persist();
  }

  async listAssets(): Promise<AssetRecord[]> {
    await this.ensureLoaded();
    return Object.values(this.snapshot.assets);
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

  async commitAvailable(args: {
    asset: AssetRecord;
    revision: RevisionRecord;
    physical: PhysicalObject;
    importId: string;
  }): Promise<void> {
    await this.ensureLoaded();
    this.snapshot.assets[args.asset.id] = args.asset;
    this.snapshot.revisions[args.revision.id] = args.revision;
    this.snapshot.physical[args.physical.sha256] = args.physical;
    delete this.snapshot.journal[args.importId];
    await this.persist();
  }
}
