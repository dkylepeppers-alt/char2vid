import { join } from 'node:path';

import type {
  AssetRecord,
  ImportSource,
  LibraryPort,
} from '@char2vid/domain/storage';
import type { LibraryActionRequest } from '@char2vid/domain/library-actions';
import type { AssetQuery } from '@char2vid/domain/library-query';

import { JsonMetaStore } from './json-meta';
import { createJsonFilePersister, createNodeFileStore } from './node-files';
import { ImportFaultError, LibraryEngine, type FaultPoint } from './protocol';

export interface NodeLibraryOptions {
  location: string;
  fault?: FaultPoint;
}

/** Node/test library: includes hard purge for shared-file contract tests. */
export interface NodeLibraryHandle extends LibraryPort {
  close(): Promise<void>;
  physicalObjectCount(): Promise<number>;
  purgeLogicalAsset(id: string): Promise<void>;
  forceCreatedAt(assetId: string, createdAt: string): Promise<void>;
  listJournal(): Promise<unknown[]>;
  readonly engine: LibraryEngine;
  getArchiveHost(): ReturnType<LibraryEngine['getArchiveHost']>;
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
    queryAssets(query: AssetQuery) {
      return engine.queryAssets(query);
    },
    applyLibraryAction(request: LibraryActionRequest) {
      return engine.applyLibraryAction(request);
    },
    createCharacter(input) {
      return engine.createCharacter(input);
    },
    listCharacters() {
      return engine.listCharacters();
    },
    getCharacter(id) {
      return engine.getCharacter(id);
    },
    listCharacterRevisions(characterId) {
      return engine.listCharacterRevisions(characterId);
    },
    getCharacterRevision(id) {
      return engine.getCharacterRevision(id);
    },
    saveCharacterRevision(revision) {
      return engine.saveCharacterRevision(revision);
    },
    saveLook(look) {
      return engine.saveLook(look);
    },
    listLooks(characterId) {
      return engine.listLooks(characterId);
    },
    getLook(id) {
      return engine.getLook(id);
    },
    setCover(characterId, assetRevisionId) {
      return engine.setCover(characterId, assetRevisionId);
    },
    renameCharacter(id, name) {
      return engine.renameCharacter(id, name);
    },
    referenceAvailability(assetRevisionId) {
      return engine.referenceAvailability(assetRevisionId);
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
    forceCreatedAt(assetId: string, createdAt: string) {
      return engine.forceCreatedAt(assetId, createdAt);
    },
    listJournal() {
      return engine.listJournal();
    },
    getArchiveHost() {
      return engine.getArchiveHost();
    },
  };

  return Promise.resolve(library);
}

export { ImportFaultError };
export type { FaultPoint };
