import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { openTestLibrary } from '../helpers/open-test-library';

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

describe('library actions and query (G3)', () => {
  it('keeps file hash across collection membership, trash, and restore', async () => {
    const png = await loadPng();
    const expectedHash = sha256(png);
    const opened = await openTestLibrary();

    try {
      const asset = await opened.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'membership.png',
        mime: 'image/png',
      });
      expect(asset.sha256).toBe(expectedHash);
      expect(asset.trashedAt).toBeNull();
      expect(await opened.physicalObjectCount()).toBe(1);

      const collectionA = crypto.randomUUID();
      const collectionB = crypto.randomUUID();

      await opened.library.applyLibraryAction({
        assetIds: [asset.id],
        action: 'collection',
        value: collectionA,
      });
      await opened.library.applyLibraryAction({
        assetIds: [asset.id],
        action: 'collection',
        value: collectionB,
      });

      let inA = await opened.library.queryAssets({
        collectionId: collectionA,
        sort: 'createdAt-desc',
      });
      let inB = await opened.library.queryAssets({
        collectionId: collectionB,
        sort: 'createdAt-desc',
      });
      expect(inA.assets.map((a) => a.id)).toEqual([asset.id]);
      expect(inB.assets.map((a) => a.id)).toEqual([asset.id]);

      await opened.library.applyLibraryAction({
        assetIds: [asset.id],
        action: 'remove-from-collection',
        value: collectionA,
      });

      inA = await opened.library.queryAssets({
        collectionId: collectionA,
        sort: 'createdAt-desc',
      });
      inB = await opened.library.queryAssets({
        collectionId: collectionB,
        sort: 'createdAt-desc',
      });
      expect(inA.assets).toEqual([]);
      expect(inB.assets.map((a) => a.id)).toEqual([asset.id]);

      await opened.library.applyLibraryAction({
        assetIds: [asset.id],
        action: 'trash',
      });
      const trashed = await opened.library.getAsset(asset.id);
      expect(trashed?.trashedAt).toEqual(expect.any(String));
      expect(
        (
          await opened.library.queryAssets({
            sort: 'createdAt-desc',
          })
        ).assets,
      ).toEqual([]);
      expect(
        (
          await opened.library.queryAssets({
            trashed: true,
            sort: 'createdAt-desc',
          })
        ).assets.map((a) => a.id),
      ).toEqual([asset.id]);

      await opened.library.applyLibraryAction({
        assetIds: [asset.id],
        action: 'restore',
      });
      const restored = await opened.library.getAsset(asset.id);
      expect(restored?.trashedAt).toBeNull();
      expect(restored?.sha256).toBe(expectedHash);
      expect(await opened.physicalObjectCount()).toBe(1);

      const bytes = await streamToBytes(
        await opened.library.readRevision(asset.revisionId),
      );
      expect(sha256(bytes)).toBe(expectedHash);

      // Still in collection B after trash/restore.
      inB = await opened.library.queryAssets({
        collectionId: collectionB,
        sort: 'createdAt-desc',
      });
      expect(inB.assets.map((a) => a.id)).toEqual([asset.id]);
    } finally {
      await opened.close();
    }
  });

  it('paginates stably when createdAt timestamps are identical', async () => {
    const png = await loadPng();
    const opened = await openTestLibrary();

    try {
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const asset = await opened.library.importMedia({
          kind: 'browser-file',
          handle: png,
          name: `page-${i}.png`,
          mime: 'image/png',
        });
        ids.push(asset.id);
      }

      const sameInstant = '2026-09-13T12:00:00.000Z';
      for (const id of ids) {
        await opened.forceCreatedAt(id, sameInstant);
      }

      const pageSize = 2;
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 3; page += 1) {
        const result = await opened.library.queryAssets({
          sort: 'createdAt-desc',
          limit: pageSize,
          cursor,
        });
        expect(result.assets).toHaveLength(page < 2 ? 2 : 1);
        for (const asset of result.assets) {
          expect(asset.createdAt).toBe(sameInstant);
          expect(seen).not.toContain(asset.id);
          seen.push(asset.id);
        }
        cursor = result.nextCursor;
        if (page < 2) {
          expect(cursor).toEqual(expect.any(String));
        } else {
          expect(cursor).toBeUndefined();
        }
      }

      expect(seen.sort()).toEqual([...ids].sort());
      // Stable (sortValue, id) order: identical timestamps → id ascending.
      expect(seen).toEqual(
        [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    } finally {
      await opened.close();
    }
  });

  it('abandons pending journal/temp when import validation rejects', async () => {
    const opened = await openTestLibrary();
    try {
      await expect(
        opened.library.importMedia({
          kind: 'browser-file',
          handle: new TextEncoder().encode('not-a-png'),
          name: 'bad.png',
          mime: 'image/png',
        }),
      ).rejects.toThrow(/PNG signature mismatch/);

      expect(await opened.listJournal()).toEqual([]);
      expect(
        (
          await opened.library.queryAssets({
            sort: 'createdAt-desc',
            trashed: true,
          })
        ).assets,
      ).toEqual([]);
      expect(
        (
          await opened.library.queryAssets({
            sort: 'createdAt-desc',
          })
        ).assets,
      ).toEqual([]);
      expect(await opened.physicalObjectCount()).toBe(0);

      // A later import must not require reconcile to recover from the reject.
      const png = await loadPng();
      const asset = await opened.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'ok.png',
        mime: 'image/png',
      });
      expect(asset.state).toBe('available');
      expect(await opened.listJournal()).toEqual([]);
    } finally {
      await opened.close();
    }
  });

  it('keeps shared physical object until both assets are trash then permanently deleted', async () => {
    const png = await loadPng();
    const expectedHash = sha256(png);
    const opened = await openTestLibrary();

    try {
      const a = await opened.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'shared-a.png',
        mime: 'image/png',
      });
      const b = await opened.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'shared-b.png',
        mime: 'image/png',
      });

      expect(a.id).not.toBe(b.id);
      expect(a.sha256).toBe(expectedHash);
      expect(b.sha256).toBe(expectedHash);
      expect(await opened.physicalObjectCount()).toBe(1);

      await opened.library.applyLibraryAction({
        assetIds: [a.id],
        action: 'trash',
      });
      await opened.library.applyLibraryAction({
        assetIds: [a.id],
        action: 'permanent-delete',
      });
      expect(await opened.library.getAsset(a.id)).toBeUndefined();
      expect(await opened.library.getAsset(b.id)).toMatchObject({
        id: b.id,
        sha256: expectedHash,
        trashedAt: null,
      });
      expect(await opened.physicalObjectCount()).toBe(1);

      const bytes = await streamToBytes(
        await opened.library.readRevision(b.revisionId),
      );
      expect(sha256(bytes)).toBe(expectedHash);

      await opened.library.applyLibraryAction({
        assetIds: [b.id],
        action: 'trash',
      });
      await opened.library.applyLibraryAction({
        assetIds: [b.id],
        action: 'permanent-delete',
      });
      expect(await opened.library.getAsset(b.id)).toBeUndefined();
      expect(await opened.physicalObjectCount()).toBe(0);
    } finally {
      await opened.close();
    }
  });

  it('rejects permanent-delete on a live (non-trashed) asset and leaves bytes intact', async () => {
    const png = await loadPng();
    const expectedHash = sha256(png);
    const opened = await openTestLibrary();

    try {
      const asset = await opened.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'live-gate.png',
        mime: 'image/png',
      });
      expect(asset.trashedAt).toBeNull();
      expect(await opened.physicalObjectCount()).toBe(1);

      await expect(
        opened.library.applyLibraryAction({
          assetIds: [asset.id],
          action: 'permanent-delete',
        }),
      ).rejects.toThrow(/permanent-delete requires a soft-trashed asset/);

      const still = await opened.library.getAsset(asset.id);
      expect(still).toMatchObject({
        id: asset.id,
        sha256: expectedHash,
        trashedAt: null,
        state: 'available',
      });
      expect(await opened.physicalObjectCount()).toBe(1);

      const bytes = await streamToBytes(
        await opened.library.readRevision(asset.revisionId),
      );
      expect(sha256(bytes)).toBe(expectedHash);
    } finally {
      await opened.close();
    }
  });

  it('keeps hard purge on test helpers only, not openWebLibrary', async () => {
    await import('fake-indexeddb/auto');
    const { createIdbBlobFileStore, openWebLibrary } =
      await import('../../packages/storage-web/src/index.ts');

    const opened = await openTestLibrary();
    expect(typeof opened.purgeLogicalAsset).toBe('function');

    const dbName = `char2vid-purge-surface-${crypto.randomUUID()}`;
    const blobDbName = `${dbName}-blobs`;
    const files = await createIdbBlobFileStore(1024 * 1024, blobDbName);
    const web = await openWebLibrary({ dbName, files });
    try {
      expect('purgeLogicalAsset' in web).toBe(false);
      expect(typeof web.queryAssets).toBe('function');
      expect(typeof web.applyLibraryAction).toBe('function');
    } finally {
      await web.close();
      await opened.close();
      for (const name of [dbName, blobDbName]) {
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          req.onblocked = () => resolve();
        });
      }
    }
  });
});
