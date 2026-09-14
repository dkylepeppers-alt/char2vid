import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ImportFaultError,
  openTestLibrary,
  reopenTestLibrary,
} from '../helpers/open-test-library';

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

describe('storage contract (crash-safe import journal)', () => {
  it('imports a PNG, survives close/reopen, and re-reads matching bytes', async () => {
    const png = await loadPng();
    const expectedHash = sha256(png);
    const location = await mkdtemp(join(tmpdir(), 'char2vid-durable-'));

    const first = await openTestLibrary({ location });
    const asset = await first.library.importMedia({
      kind: 'browser-file',
      handle: png,
      name: 'tiny.png',
      mime: 'image/png',
    });
    expect(asset.state).toBe('available');
    expect(asset.kind).toBe('image');
    expect(asset.sha256).toBe(expectedHash);
    expect(asset.bytes).toBe(png.byteLength);
    expect(await first.physicalObjectCount()).toBe(1);
    await first.close();

    const second = await reopenTestLibrary(location);
    try {
      const again = await second.library.getAsset(asset.id);
      expect(again).toEqual(asset);
      const bytes = await streamToBytes(
        await second.library.readRevision(asset.revisionId),
      );
      expect(sha256(bytes)).toBe(expectedHash);
      expect(bytes.byteLength).toBe(png.byteLength);
    } finally {
      await second.close();
      await rm(location, { recursive: true, force: true });
    }
  });

  it('reconciles after-write fault without corrupt available assets', async () => {
    const png = await loadPng();
    const expectedHash = sha256(png);
    const location = await mkdtemp(join(tmpdir(), 'char2vid-fault-write-'));

    const faulted = await openTestLibrary({ location, fault: 'after-write' });
    await expect(
      faulted.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'tiny.png',
        mime: 'image/png',
      }),
    ).rejects.toBeInstanceOf(ImportFaultError);
    await faulted.close();

    const recovered = await reopenTestLibrary(location);
    try {
      const result = await recovered.library.reconcileImports();
      expect(result.repaired).toBeGreaterThanOrEqual(1);
      expect(result.missing).toEqual([]);
      expect(await recovered.physicalObjectCount()).toBe(1);
      expect((await recovered.library.storageUsage()).originals).toBe(
        png.byteLength,
      );

      // Import again under a new logical asset; physical stays deduped.
      const asset = await recovered.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'tiny-again.png',
        mime: 'image/png',
      });
      expect(asset.sha256).toBe(expectedHash);
      expect(asset.state).toBe('available');
      expect(await recovered.physicalObjectCount()).toBe(1);
    } finally {
      await recovered.close();
      await rm(location, { recursive: true, force: true });
    }
  });

  it('reconciles after-promote fault without losing promoted files', async () => {
    const png = await loadPng();
    const expectedHash = sha256(png);
    const location = await mkdtemp(join(tmpdir(), 'char2vid-fault-promote-'));

    const faulted = await openTestLibrary({
      location,
      fault: 'after-promote',
    });
    await expect(
      faulted.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'tiny.png',
        mime: 'image/png',
      }),
    ).rejects.toBeInstanceOf(ImportFaultError);
    await faulted.close();

    const recovered = await reopenTestLibrary(location);
    try {
      const result = await recovered.library.reconcileImports();
      expect(result.repaired).toBeGreaterThanOrEqual(1);
      expect(result.missing).toEqual([]);
      expect(await recovered.physicalObjectCount()).toBe(1);
      expect((await recovered.library.storageUsage()).originals).toBe(
        png.byteLength,
      );

      const second = await recovered.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'tiny-copy.png',
        mime: 'image/png',
      });
      expect(second.sha256).toBe(expectedHash);
      expect(await recovered.physicalObjectCount()).toBe(1);

      const bytes = await streamToBytes(
        await recovered.library.readRevision(second.revisionId),
      );
      expect(sha256(bytes)).toBe(expectedHash);
    } finally {
      await recovered.close();
      await rm(location, { recursive: true, force: true });
    }
  });

  it('keeps shared physical objects when one logical asset is purged', async () => {
    const png = await loadPng();
    const expectedHash = sha256(png);
    const opened = await openTestLibrary();

    try {
      const a = await opened.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'a.png',
        mime: 'image/png',
      });
      const b = await opened.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'b.png',
        mime: 'image/png',
      });

      expect(a.id).not.toBe(b.id);
      expect(a.sha256).toBe(expectedHash);
      expect(b.sha256).toBe(expectedHash);
      expect(await opened.physicalObjectCount()).toBe(1);

      await opened.purgeLogicalAsset(a.id);
      expect(await opened.library.getAsset(a.id)).toBeUndefined();
      expect(await opened.library.getAsset(b.id)).toEqual(b);
      expect(await opened.physicalObjectCount()).toBe(1);

      const bytes = await streamToBytes(
        await opened.library.readRevision(b.revisionId),
      );
      expect(sha256(bytes)).toBe(expectedHash);

      await opened.purgeLogicalAsset(b.id);
      expect(await opened.physicalObjectCount()).toBe(0);
    } finally {
      await opened.close();
    }
  });
});
