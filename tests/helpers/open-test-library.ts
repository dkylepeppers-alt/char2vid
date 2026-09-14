import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LibraryPort } from '@char2vid/domain/storage';
import {
  ImportFaultError,
  openNodeLibrary,
  type FaultPoint,
  type NodeLibraryHandle,
} from '../../packages/storage-web/src/node-library';

export type { FaultPoint };
export { ImportFaultError };

export interface OpenTestLibraryOptions {
  /** Existing directory for durable reopen tests; otherwise a temp dir is created. */
  location?: string;
  fault?: FaultPoint;
}

export interface TestLibraryHandle {
  library: LibraryPort;
  close(): Promise<void>;
  physicalObjectCount(): Promise<number>;
  /**
   * Test-only hard purge with reference-counted physical GC. Not on
   * production `openWebLibrary`.
   */
  purgeLogicalAsset(id: string): Promise<void>;
  /** Test-only: rewrite createdAt for pagination stability fixtures. */
  forceCreatedAt(assetId: string, createdAt: string): Promise<void>;
  listJournal(): Promise<unknown[]>;
  /** Absolute path used for this library (for close/reopen). */
  location: string;
}

/**
 * Opens a service-side filesystem library that uses the same journal protocol
 * as the browser adapter (pending → written → promoted → commit).
 */
export async function openTestLibrary(
  options: OpenTestLibraryOptions = {},
): Promise<TestLibraryHandle> {
  const created =
    options.location === undefined
      ? await mkdtemp(join(tmpdir(), 'char2vid-library-'))
      : undefined;
  const location = options.location ?? created!;

  const handle: NodeLibraryHandle = await openNodeLibrary({
    location,
    fault: options.fault,
  });

  return {
    library: handle,
    location,
    async close() {
      await handle.close();
      if (created) {
        await rm(created, { recursive: true, force: true });
      }
    },
    physicalObjectCount() {
      return handle.physicalObjectCount();
    },
    purgeLogicalAsset(id: string) {
      return handle.purgeLogicalAsset(id);
    },
    forceCreatedAt(assetId: string, createdAt: string) {
      return handle.forceCreatedAt(assetId, createdAt);
    },
    listJournal() {
      return handle.listJournal();
    },
  };
}

/** Reopen an existing on-disk library without deleting it on close. */
export async function reopenTestLibrary(
  location: string,
  options: { fault?: FaultPoint } = {},
): Promise<TestLibraryHandle> {
  return openTestLibrary({ location, fault: options.fault });
}
