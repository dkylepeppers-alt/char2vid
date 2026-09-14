import type {
  AssetRecord,
  ImportSource,
  LibraryPort,
} from '@char2vid/domain/storage';
import type { LibraryActionRequest } from '@char2vid/domain/library-actions';
import type { AssetQuery } from '@char2vid/domain/library-query';

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

/**
 * Production web library surface. Hard purge stays on the engine / Node test
 * helpers only — not part of this API.
 */
export interface WebLibraryHandle extends LibraryPort {
  readonly mode: FileStore['mode'];
  close(): Promise<void>;
  physicalObjectCount(): Promise<number>;
  getArchiveHost(): ReturnType<LibraryEngine['getArchiveHost']>;
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
      idbBlobDbName: options.idbBlobDbName ?? `${dbName}-blobs`,
    }));
  const engine = new LibraryEngine({
    files,
    meta,
    fault: options.fault,
  });

  return {
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
    queryAssets(query: AssetQuery) {
      return engine.queryAssets(query);
    },
    applyLibraryAction(request: LibraryActionRequest) {
      return engine.applyLibraryAction(request);
    },
    async close() {
      await files.close?.();
      db.close();
    },
    physicalObjectCount() {
      return engine.physicalObjectCount();
    },
    getArchiveHost() {
      return engine.getArchiveHost();
    },
  };
}

export { ImportFaultError };
export type { FaultPoint };
