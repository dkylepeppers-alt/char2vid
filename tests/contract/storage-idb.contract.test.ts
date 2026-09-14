import 'fake-indexeddb/auto';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createIdbBlobFileStore,
  openWebLibrary,
} from '../../packages/storage-web/src/index.ts';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/tiny.png',
);

async function loadPng(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fixturePath));
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function streamToBytes(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const openedDbNames: string[] = [];

afterEach(async () => {
  while (openedDbNames.length > 0) {
    const name = openedDbNames.pop()!;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  }
});

describe('storage contract (IndexedDB blob fallback)', () => {
  it('rejects oversized IDB fallback allocations', async () => {
    const dbName = `char2vid-idb-limit-${crypto.randomUUID()}`;
    openedDbNames.push(dbName);
    const limitBytes = 64;
    const store = await createIdbBlobFileStore(limitBytes, dbName);
    try {
      const oversized = new Uint8Array(limitBytes + 1);
      await expect(
        store.writeTemp(crypto.randomUUID(), oversized),
      ).rejects.toThrow(
        /IDB blob fallback rejects payloads larger than 64 bytes/,
      );
      expect(await store.pathExists(`tmp/unused`)).toBe(false);
    } finally {
      await store.close?.();
    }
  });

  it('persists IDB blobs across library close/reopen', async () => {
    const png = await loadPng();
    const expectedHash = sha256(png);
    const dbName = `char2vid-idb-lib-${crypto.randomUUID()}`;
    const blobDbName = `${dbName}-blobs`;
    openedDbNames.push(dbName, blobDbName);

    const firstFiles = await createIdbBlobFileStore(
      32 * 1024 * 1024,
      blobDbName,
    );
    const first = await openWebLibrary({
      dbName,
      files: firstFiles,
    });
    expect(first.mode).toBe('idb-blob');

    const asset = await first.importMedia({
      kind: 'browser-file',
      handle: png,
      name: 'tiny.png',
      mime: 'image/png',
    });
    expect(asset.state).toBe('available');
    expect(asset.sha256).toBe(expectedHash);
    expect(await first.physicalObjectCount()).toBe(1);
    await first.close();

    const secondFiles = await createIdbBlobFileStore(
      32 * 1024 * 1024,
      blobDbName,
    );
    const second = await openWebLibrary({
      dbName,
      files: secondFiles,
    });
    try {
      expect(second.mode).toBe('idb-blob');
      const again = await second.getAsset(asset.id);
      expect(again).toEqual(asset);
      const bytes = await streamToBytes(
        await second.readRevision(asset.revisionId),
      );
      expect(sha256(bytes)).toBe(expectedHash);
      expect(bytes.byteLength).toBe(png.byteLength);
      expect((await second.storageUsage()).originals).toBe(png.byteLength);
    } finally {
      await second.close();
    }
  });
});
