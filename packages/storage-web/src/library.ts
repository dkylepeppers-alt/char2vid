import type {
  AssetRecord,
  ImportSource,
  LibraryPort,
} from '@char2vid/domain/storage';

import { DexieMetaStore, openChar2vidDb } from './dexie-meta';
import {
  openBrowserFileStore,
  type FileStore,
  type OpfsFileStoreOptions,
} from './files';
import { ImportFaultError, LibraryEngine, type FaultPoint } from './protocol';

export interface WebLibraryOptions extends OpfsFileStoreOptions {
  /** IndexedDB database name. */
  dbName?: string;
  fault?: FaultPoint;
  /** Injected file store (tests). */
  files?: FileStore;
}

export interface WebLibraryHandle extends LibraryPort {
  readonly mode: FileStore['mode'];
  close(): Promise<void>;
  physicalObjectCount(): Promise<number>;
  purgeLogicalAsset(id: string): Promise<void>;
  readonly engine: LibraryEngine;
}

export async function openWebLibrary(
  options: WebLibraryOptions = {},
): Promise<WebLibraryHandle> {
  const dbName = options.dbName ?? 'char2vid-library';
  const db = openChar2vidDb(dbName);
  const meta = new DexieMetaStore(db);
  const files =
    options.files ??
    (await openBrowserFileStore({
      rootName: options.rootName,
      idbFallbackLimitBytes: options.idbFallbackLimitBytes,
    }));
  const engine = new LibraryEngine({
    files,
    meta,
    fault: options.fault,
  });

  return {
    engine,
    mode: files.mode,
    importMedia(source: ImportSource): Promise<AssetRecord> {
      return engine.importMedia(source);
    },
    getAsset(id) {
      return engine.getAsset(id);
    },
    readRevision(revisionId) {
      return engine.readRevision(revisionId);
    },
    reconcileImports() {
      return engine.reconcileImports();
    },
    storageUsage() {
      return engine.storageUsage();
    },
    close() {
      db.close();
      return Promise.resolve();
    },
    physicalObjectCount() {
      return engine.physicalObjectCount();
    },
    purgeLogicalAsset(id) {
      return engine.purgeLogicalAsset(id);
    },
  };
}

export { ImportFaultError };
export type { FaultPoint };
