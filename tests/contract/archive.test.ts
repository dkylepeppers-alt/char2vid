import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it, describe } from 'vitest';
import { zipSync, strToU8 } from 'fflate';

import { validateArchivePath } from '../../packages/domain/src/archive-schema';
import {
  exportArchive,
  inspectArchive,
  importArchive,
} from '../../packages/storage-web/src/archive';
import { openTestLibrary } from '../helpers/open-test-library';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/tiny.png',
);

async function loadPng(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fixturePath));
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

describe('archive path validation', () => {
  it.each(['../secret', '/absolute', 'media/../../secret', 'C:\\secret'])(
    'rejects an unsafe member path: %s',
    (path) => {
      expect(validateArchivePath(path)).toBe(false);
    },
  );

  it('accepts a relative media member', () => {
    expect(validateArchivePath('media/abc123.png')).toBe(true);
  });
});

describe('portable library archives', () => {
  it('round-trips export → inspect → import with media', async () => {
    const png = await loadPng();
    const source = await openTestLibrary();
    try {
      const asset = await source.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'tiny.png',
        mime: 'image/png',
      });
      await source.library.applyLibraryAction({
        assetIds: [asset.id],
        action: 'tag',
        value: 'portrait',
      });

      const exported = await exportArchive(source.getArchiveHost(), {
        scope: 'library',
      });
      expect(exported.bytes.byteLength).toBeGreaterThan(100);

      const report = await inspectArchive({ bytes: exported.bytes });
      expect(report.ok).toBe(true);
      expect(report.unsupportedVersion).toBe(false);
      expect(report.invalidPaths).toEqual([]);
      expect(report.missingFiles).toEqual([]);
      expect(report.fileCount).toBeGreaterThanOrEqual(3);
      expect(report.schemaVersion).toBe(1);
    } finally {
      await source.close();
    }

    const target = await openTestLibrary();
    try {
      const sourceLib = await openTestLibrary();
      let zipBytes: Uint8Array;
      try {
        const asset = await sourceLib.library.importMedia({
          kind: 'browser-file',
          handle: png,
          name: 'tiny.png',
          mime: 'image/png',
        });
        expect(asset.state).toBe('available');
        const exported = await exportArchive(sourceLib.getArchiveHost(), {
          scope: 'library',
        });
        zipBytes = exported.bytes;
      } finally {
        await sourceLib.close();
      }

      const result = await importArchive(
        target.getArchiveHost(),
        { bytes: zipBytes },
        { conflict: 'remap' },
      );
      expect(result.importedAssets).toBe(1);

      const listed = await target.library.queryAssets({
        sort: 'createdAt-desc',
        limit: 10,
      });
      expect(listed.assets).toHaveLength(1);
      const imported = listed.assets[0]!;
      expect(imported.name).toBe('tiny.png');
      expect(imported.mime).toBe('image/png');
      const bytes = await streamToBytes(
        await target.library.readRevision(imported.revisionId),
      );
      expect(bytes.byteLength).toBe(png.byteLength);
    } finally {
      await target.close();
    }
  });

  it('rejects unsafe member paths during inspect', async () => {
    const evil = zipSync({
      'manifest.json': strToU8('{}'),
      '../secret': strToU8('nope'),
    });
    const report = await inspectArchive({ bytes: evil });
    expect(report.ok).toBe(false);
    expect(report.invalidPaths.length).toBeGreaterThan(0);
  });

  it('remaps colliding asset ids on import', async () => {
    const png = await loadPng();
    const first = await openTestLibrary();
    try {
      const original = await first.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'keep.png',
        mime: 'image/png',
      });

      // Export from the same library and import back so IDs collide.
      const exported = await exportArchive(first.getArchiveHost(), {
        scope: 'library',
      });

      const before = await first.library.queryAssets({
        sort: 'createdAt-desc',
        limit: 20,
      });
      expect(before.assets).toHaveLength(1);

      const result = await importArchive(
        first.getArchiveHost(),
        { bytes: exported.bytes },
        { conflict: 'remap' },
      );
      expect(result.importedAssets).toBe(1);
      expect(result.idMap[original.id]).toBeDefined();
      expect(result.idMap[original.id]).not.toBe(original.id);

      const after = await first.library.queryAssets({
        sort: 'createdAt-desc',
        limit: 20,
      });
      expect(after.assets).toHaveLength(2);
      const ids = new Set(after.assets.map((a) => a.id));
      expect(ids.has(original.id)).toBe(true);
      expect(ids.size).toBe(2);

      const originalBytes = await streamToBytes(
        await first.library.readRevision(original.revisionId),
      );
      expect(originalBytes.byteLength).toBe(png.byteLength);
    } finally {
      await first.close();
    }
  });

  it('leaves the existing library intact when import validation fails', async () => {
    const png = await loadPng();
    const lib = await openTestLibrary();
    try {
      const asset = await lib.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'safe.png',
        mime: 'image/png',
      });
      const bad = zipSync({
        'media/../../secret': strToU8('x'),
      });
      await expect(
        importArchive(
          lib.getArchiveHost(),
          { bytes: bad },
          { conflict: 'remap' },
        ),
      ).rejects.toThrow(/archive rejected|unsafe|invalid/i);

      const still = await lib.library.getAsset(asset.id);
      expect(still).toEqual(asset);
      expect(await lib.physicalObjectCount()).toBe(1);
    } finally {
      await lib.close();
    }
  });
});
