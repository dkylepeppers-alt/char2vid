import type { AssetRecord } from '@char2vid/domain/storage';
import { parseAssetRecord } from '@char2vid/domain/asset-schema';

import {
  bytesToStream,
  finalRelativePath,
  hashAndValidate,
  readImportHandle,
  type FileStore,
} from './files';
import type { ImportSource } from '@char2vid/domain/storage';

export type ImportStage = 'pending' | 'written' | 'promoted';

export type FaultPoint = 'after-write' | 'after-promote';

export interface JournalEntry {
  importId: string;
  assetId: string;
  revisionId: string;
  stage: ImportStage;
  tempPath: string;
  finalHash: string | null;
  name: string;
  mime: string;
  kind: AssetRecord['kind'];
  createdAt: string;
}

export interface PhysicalObject {
  sha256: string;
  relativePath: string;
  byteLength: number;
}

export interface RevisionRecord {
  id: string;
  assetId: string;
  sha256: string;
  createdAt: string;
}

export interface MetaStore {
  putJournal(entry: JournalEntry): Promise<void>;
  getJournal(importId: string): Promise<JournalEntry | undefined>;
  listJournal(): Promise<JournalEntry[]>;
  deleteJournal(importId: string): Promise<void>;

  putAsset(asset: AssetRecord): Promise<void>;
  getAsset(id: string): Promise<AssetRecord | undefined>;
  deleteAsset(id: string): Promise<void>;
  listAssets(): Promise<AssetRecord[]>;

  putRevision(revision: RevisionRecord): Promise<void>;
  getRevision(id: string): Promise<RevisionRecord | undefined>;
  deleteRevision(id: string): Promise<void>;
  listRevisions(): Promise<RevisionRecord[]>;

  putPhysical(object: PhysicalObject): Promise<void>;
  getPhysical(sha256: string): Promise<PhysicalObject | undefined>;
  deletePhysical(sha256: string): Promise<void>;
  countPhysical(): Promise<number>;

  /**
   * Atomically mark asset available, upsert physical object, ensure revision,
   * and clear the journal entry.
   */
  commitAvailable(args: {
    asset: AssetRecord;
    revision: RevisionRecord;
    physical: PhysicalObject;
    importId: string;
  }): Promise<void>;
}

export class ImportFaultError extends Error {
  readonly fault: FaultPoint;

  constructor(fault: FaultPoint) {
    super(`injected fault: ${fault}`);
    this.name = 'ImportFaultError';
    this.fault = fault;
  }
}

function kindFromMime(mime: string): AssetRecord['kind'] {
  if (mime.startsWith('image/')) {
    return 'image';
  }
  if (mime.startsWith('video/')) {
    return 'video';
  }
  if (mime.startsWith('audio/')) {
    return 'audio';
  }
  return 'embedding';
}

function newId(): string {
  return crypto.randomUUID();
}

export interface LibraryEngineOptions {
  files: FileStore;
  meta: MetaStore;
  fault?: FaultPoint;
}

/**
 * Shared crash-safe import journal protocol used by web and Node test backends.
 *
 * Stages: pending → written (temp hashed) → promoted (final path) → commit + clear.
 */
export class LibraryEngine {
  private readonly files: FileStore;
  private readonly meta: MetaStore;
  private readonly fault: FaultPoint | undefined;

  constructor(options: LibraryEngineOptions) {
    this.files = options.files;
    this.meta = options.meta;
    this.fault = options.fault;
  }

  async importMedia(source: ImportSource): Promise<AssetRecord> {
    if (source.kind === 'native-uri') {
      throw new Error('native-uri imports require the Android adapter');
    }

    const importId = newId();
    const assetId = newId();
    const revisionId = newId();
    const createdAt = new Date().toISOString();
    const kind = kindFromMime(source.mime);
    const tempPath = `tmp/${importId}`;

    const pendingAsset: AssetRecord = {
      id: assetId,
      revisionId,
      kind,
      name: source.name,
      mime: source.mime,
      sha256: '',
      bytes: 0,
      state: 'pending',
      createdAt,
    };

    await this.meta.putJournal({
      importId,
      assetId,
      revisionId,
      stage: 'pending',
      tempPath,
      finalHash: null,
      name: source.name,
      mime: source.mime,
      kind,
      createdAt,
    });
    await this.meta.putAsset(pendingAsset);

    const bytes = await readImportHandle(source.handle);
    await this.files.writeTemp(importId, bytes);
    const { sha256, bytes: byteLength } = await hashAndValidate(
      bytes,
      source.mime,
    );

    await this.meta.putJournal({
      importId,
      assetId,
      revisionId,
      stage: 'written',
      tempPath,
      finalHash: sha256,
      name: source.name,
      mime: source.mime,
      kind,
      createdAt,
    });

    if (this.fault === 'after-write') {
      throw new ImportFaultError('after-write');
    }

    const relativePath = await this.files.promote(tempPath, sha256);

    await this.meta.putJournal({
      importId,
      assetId,
      revisionId,
      stage: 'promoted',
      tempPath,
      finalHash: sha256,
      name: source.name,
      mime: source.mime,
      kind,
      createdAt,
    });

    if (this.fault === 'after-promote') {
      throw new ImportFaultError('after-promote');
    }

    const available: AssetRecord = {
      ...pendingAsset,
      sha256,
      bytes: byteLength,
      state: 'available',
    };
    parseAssetRecord(available);

    await this.meta.commitAvailable({
      asset: available,
      revision: {
        id: revisionId,
        assetId,
        sha256,
        createdAt,
      },
      physical: {
        sha256,
        relativePath: relativePath || finalRelativePath(sha256),
        byteLength,
      },
      importId,
    });

    return available;
  }

  async getAsset(id: string): Promise<AssetRecord | undefined> {
    return this.meta.getAsset(id);
  }

  async readRevision(revisionId: string): Promise<ReadableStream<Uint8Array>> {
    const revision = await this.meta.getRevision(revisionId);
    if (!revision) {
      throw new Error(`unknown revision: ${revisionId}`);
    }
    const physical = await this.meta.getPhysical(revision.sha256);
    if (!physical) {
      throw new Error(`missing physical object for ${revision.sha256}`);
    }
    const bytes = await this.files.readBytes(physical.relativePath);
    return bytesToStream(bytes);
  }

  async reconcileImports(): Promise<{ repaired: number; missing: string[] }> {
    const journal = await this.meta.listJournal();
    let repaired = 0;
    const missing: string[] = [];

    for (const entry of journal) {
      try {
        const did = await this.reconcileOne(entry);
        if (did) {
          repaired += 1;
        }
      } catch {
        missing.push(entry.assetId);
        await this.abandonImport(entry);
      }
    }

    return { repaired, missing };
  }

  private async reconcileOne(entry: JournalEntry): Promise<boolean> {
    if (entry.stage === 'pending') {
      await this.abandonImport(entry);
      return true;
    }

    if (entry.stage === 'written') {
      const hash = entry.finalHash;
      if (!hash) {
        await this.abandonImport(entry);
        return true;
      }
      const finalPath = finalRelativePath(hash);
      if (await this.files.pathExists(finalPath)) {
        // Promote already happened; finish commit.
        await this.finishFromHash(entry, hash);
        return true;
      }
      if (!(await this.files.pathExists(entry.tempPath))) {
        await this.abandonImport(entry);
        return true;
      }
      const bytes = await this.files.readBytes(entry.tempPath);
      const validated = await hashAndValidate(bytes, entry.mime);
      if (validated.sha256 !== hash) {
        await this.abandonImport(entry);
        return true;
      }
      await this.files.promote(entry.tempPath, hash);
      await this.finishFromHash(entry, hash);
      return true;
    }

    // promoted
    const hash = entry.finalHash;
    if (!hash) {
      await this.abandonImport(entry);
      return true;
    }
    const finalPath = finalRelativePath(hash);
    if (!(await this.files.pathExists(finalPath))) {
      // Try temp as last resort
      if (await this.files.pathExists(entry.tempPath)) {
        await this.files.promote(entry.tempPath, hash);
      } else {
        await this.abandonImport(entry);
        return true;
      }
    }
    await this.finishFromHash(entry, hash);
    return true;
  }

  private async finishFromHash(
    entry: JournalEntry,
    sha256: string,
  ): Promise<void> {
    const finalPath = finalRelativePath(sha256);
    const bytes = await this.files.readBytes(finalPath);
    const available: AssetRecord = {
      id: entry.assetId,
      revisionId: entry.revisionId,
      kind: entry.kind,
      name: entry.name,
      mime: entry.mime,
      sha256,
      bytes: bytes.byteLength,
      state: 'available',
      createdAt: entry.createdAt,
    };
    parseAssetRecord(available);
    await this.meta.commitAvailable({
      asset: available,
      revision: {
        id: entry.revisionId,
        assetId: entry.assetId,
        sha256,
        createdAt: entry.createdAt,
      },
      physical: {
        sha256,
        relativePath: finalPath,
        byteLength: bytes.byteLength,
      },
      importId: entry.importId,
    });
  }

  private async abandonImport(entry: JournalEntry): Promise<void> {
    await this.files.remove(entry.tempPath).catch(() => undefined);
    const asset = await this.meta.getAsset(entry.assetId);
    if (asset && asset.state !== 'available') {
      await this.meta.deleteAsset(entry.assetId);
    }
    await this.meta.deleteJournal(entry.importId);
  }

  async storageUsage(): Promise<{
    originals: number;
    cache: number;
    available?: number;
  }> {
    const hashes = new Set<string>();
    for (const asset of await this.meta.listAssets()) {
      if (asset.state === 'available' && asset.sha256) {
        hashes.add(asset.sha256);
      }
    }
    let originals = 0;
    for (const hash of hashes) {
      const obj = await this.meta.getPhysical(hash);
      if (obj) {
        originals += obj.byteLength;
      }
    }

    const available = this.files.availableBytes
      ? await this.files.availableBytes()
      : undefined;
    return { originals, cache: 0, available };
  }

  /**
   * Remove a logical asset. Physical object is GC'd only when no remaining
   * revision references its sha256. Used by G2 shared-file contract tests;
   * G3 will add trash semantics on LibraryPort.
   */
  async purgeLogicalAsset(id: string): Promise<void> {
    const asset = await this.meta.getAsset(id);
    if (!asset) {
      return;
    }
    const sha256 = asset.sha256;
    await this.meta.deleteRevision(asset.revisionId);
    await this.meta.deleteAsset(id);

    if (!sha256) {
      return;
    }
    const remaining = (await this.meta.listRevisions()).filter(
      (r) => r.sha256 === sha256,
    );
    if (remaining.length === 0) {
      const physical = await this.meta.getPhysical(sha256);
      if (physical) {
        await this.files.remove(physical.relativePath);
        await this.meta.deletePhysical(sha256);
      }
    }
  }

  physicalObjectCount(): Promise<number> {
    return this.meta.countPhysical();
  }
}
