import { join } from 'node:path';

import type {
  AssetRecord,
  ImportSource,
  LibraryPort,
} from '@char2vid/domain/storage';

import { JsonMetaStore } from './json-meta';
import { createJsonFilePersister, createNodeFileStore } from './node-files';
import { ImportFaultError, LibraryEngine, type FaultPoint } from './protocol';

export interface NodeLibraryOptions {
  location: string;
  fault?: FaultPoint;
}

export interface NodeLibraryHandle extends LibraryPort {
  close(): Promise<void>;
  physicalObjectCount(): Promise<number>;
  purgeLogicalAsset(id: string): Promise<void>;
  readonly engine: LibraryEngine;
}

export function openNodeLibrary(
  options: NodeLibraryOptions,
): Promise<NodeLibraryHandle> {
  const files = createNodeFileStore(join(options.location, 'media'));
  const meta = new JsonMetaStore(
    createJsonFilePersister(join(options.location, 'meta.json')),
  );
  const engine = new LibraryEngine({
    files,
    meta,
    fault: options.fault,
  });

  const library: NodeLibraryHandle = {
    engine,
    importMedia(source: ImportSource): Promise<AssetRecord> {
      return engine.importMedia(source);
    },
    getAsset(id: string) {
      return engine.getAsset(id);
    },
    readRevision(revisionId: string) {
      return engine.readRevision(revisionId);
    },
    reconcileImports() {
      return engine.reconcileImports();
    },
    storageUsage() {
      return engine.storageUsage();
    },
    close() {
      // Durable state already flushed per mutation.
      return Promise.resolve();
    },
    physicalObjectCount() {
      return engine.physicalObjectCount();
    },
    purgeLogicalAsset(id: string) {
      return engine.purgeLogicalAsset(id);
    },
  };

  return Promise.resolve(library);
}

export { ImportFaultError };
export type { FaultPoint };
