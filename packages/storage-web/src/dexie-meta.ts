import type { AssetRecord } from '@char2vid/domain/storage';
import Dexie, { type EntityTable } from 'dexie';

import type {
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
};

export function openChar2vidDb(dbName: string): Char2vidDb {
  const db = new Dexie(dbName) as Char2vidDb;
  db.version(1).stores({
    journal: 'importId, assetId, stage',
    assets: 'id, revisionId, sha256, state',
    revisions: 'id, assetId, sha256',
    physical: 'sha256, relativePath',
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
    return this.db.assets.put(asset).then(() => undefined);
  }

  getAsset(id: string): Promise<AssetRecord | undefined> {
    return this.db.assets.get(id);
  }

  deleteAsset(id: string): Promise<void> {
    return this.db.assets.delete(id);
  }

  listAssets(): Promise<AssetRecord[]> {
    return this.db.assets.toArray();
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
        await this.db.assets.put(args.asset);
        await this.db.revisions.put(args.revision);
        await this.db.physical.put(args.physical);
        await this.db.journal.delete(args.importId);
      },
    );
  }

  async deleteDatabase(): Promise<void> {
    this.db.close();
    await Dexie.delete(this.db.name);
  }
}
