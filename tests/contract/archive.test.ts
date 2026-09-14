import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it, describe } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

import { validateArchivePath } from '../../packages/domain/src/archive-schema';
import {
  exportArchive,
  inspectArchive,
  importArchive,
  ArchiveImportFaultError,
} from '../../packages/storage-web/src/archive';
import { finalRelativePath } from '../../packages/storage-web/src/files';
import { openTestLibrary } from '../helpers/open-test-library';

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures',
);
const fixturePath = join(fixturesDir, 'tiny.png');
const redFixturePath = join(fixturesDir, 'tiny-red.png');

async function loadPng(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fixturePath));
}

async function loadRedPng(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(redFixturePath));
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

async function listTempEntries(location: string): Promise<string[]> {
  const tmpDir = join(location, 'media', 'tmp');
  try {
    return await readdir(tmpDir);
  } catch {
    return [];
  }
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
  it('round-trips export → inspect → import with media, tag, and collection', async () => {
    const png = await loadPng();
    const collectionId = crypto.randomUUID();

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
        await sourceLib.library.applyLibraryAction({
          assetIds: [asset.id],
          action: 'tag',
          value: 'portrait',
        });
        await sourceLib.library.applyLibraryAction({
          assetIds: [asset.id],
          action: 'collection',
          value: collectionId,
        });

        const exported = await exportArchive(sourceLib.getArchiveHost(), {
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

      const tagged = await target.library.queryAssets({
        sort: 'createdAt-desc',
        tags: ['portrait'],
        limit: 10,
      });
      expect(tagged.assets).toHaveLength(1);
      expect(tagged.assets[0]!.id).toBe(imported.id);

      const inCollection = await target.library.queryAssets({
        sort: 'createdAt-desc',
        collectionId,
        limit: 10,
      });
      expect(inCollection.assets).toHaveLength(1);
      expect(inCollection.assets[0]!.id).toBe(imported.id);
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

  it('rejects checksum-mismatched media without mutating the library', async () => {
    const png = await loadPng();
    const lib = await openTestLibrary();
    try {
      const prior = await lib.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'prior.png',
        mime: 'image/png',
      });
      const priorCount = await lib.physicalObjectCount();

      const source = await openTestLibrary();
      let zipBytes: Uint8Array;
      try {
        await source.library.importMedia({
          kind: 'browser-file',
          handle: await loadRedPng(),
          name: 'other.png',
          mime: 'image/png',
        });
        zipBytes = (
          await exportArchive(source.getArchiveHost(), {
            scope: 'library',
          })
        ).bytes;
      } finally {
        await source.close();
      }

      const entries = unzipSync(zipBytes);
      const mediaPath = Object.keys(entries).find((k) =>
        k.startsWith('media/'),
      );
      expect(mediaPath).toBeDefined();
      const original = entries[mediaPath!]!;
      const mutated = new Uint8Array(original);
      mutated[mutated.byteLength - 1] ^= 0xff;
      entries[mediaPath!] = mutated;
      const badZip = zipSync(entries);

      const report = await inspectArchive({ bytes: badZip });
      expect(report.ok).toBe(false);
      expect(report.errors.some((e) => /checksum mismatch/i.test(e))).toBe(
        true,
      );

      await expect(
        importArchive(
          lib.getArchiveHost(),
          { bytes: badZip },
          { conflict: 'remap' },
        ),
      ).rejects.toThrow(/archive rejected|checksum/i);

      const still = await lib.library.getAsset(prior.id);
      expect(still).toEqual(prior);
      expect(await lib.physicalObjectCount()).toBe(priorCount);
      const listed = await lib.library.queryAssets({
        sort: 'createdAt-desc',
        limit: 20,
      });
      expect(listed.assets).toHaveLength(1);
      expect(listed.assets[0]!.id).toBe(prior.id);
      expect(listed.assets[0]!.sha256).toBe(prior.sha256);
    } finally {
      await lib.close();
    }
  });

  it('rolls back mid-import fault after staging without half-imported assets', async () => {
    const png = await loadPng();
    const red = await loadRedPng();
    const target = await openTestLibrary();
    try {
      const prior = await target.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'keep.png',
        mime: 'image/png',
      });
      const priorPhysical = await target.physicalObjectCount();
      const priorBytes = await streamToBytes(
        await target.library.readRevision(prior.revisionId),
      );

      const source = await openTestLibrary();
      let zipBytes: Uint8Array;
      let incomingSha: string;
      try {
        const asset = await source.library.importMedia({
          kind: 'browser-file',
          handle: red,
          name: 'incoming.png',
          mime: 'image/png',
        });
        incomingSha = asset.sha256;
        expect(incomingSha).not.toBe(prior.sha256);
        zipBytes = (
          await exportArchive(source.getArchiveHost(), {
            scope: 'library',
          })
        ).bytes;
      } finally {
        await source.close();
      }

      const host = target.getArchiveHost();
      await expect(
        importArchive(
          host,
          { bytes: zipBytes },
          {
            conflict: 'remap',
            fault: 'after-putPhysical',
          },
        ),
      ).rejects.toBeInstanceOf(ArchiveImportFaultError);

      const listed = await target.library.queryAssets({
        sort: 'createdAt-desc',
        limit: 20,
      });
      expect(listed.assets).toHaveLength(1);
      expect(listed.assets[0]!.id).toBe(prior.id);
      expect(listed.assets[0]!.sha256).toBe(prior.sha256);

      const stillPrior = await target.library.getAsset(prior.id);
      expect(stillPrior).toEqual(prior);
      const afterBytes = await streamToBytes(
        await target.library.readRevision(prior.revisionId),
      );
      expect(Array.from(afterBytes)).toEqual(Array.from(priorBytes));

      expect(await target.physicalObjectCount()).toBe(priorPhysical);
      expect(await host.files.pathExists(finalRelativePath(incomingSha!))).toBe(
        false,
      );
      expect(await host.meta.getPhysical(incomingSha!)).toBeUndefined();
      expect(await listTempEntries(target.location)).toEqual([]);

      const availableOnly = listed.assets.filter(
        (a) => a.state === 'available',
      );
      expect(availableOnly).toHaveLength(1);
    } finally {
      await target.close();
    }
  });

  it('excludes soft-trashed assets from portable library export', async () => {
    const png = await loadPng();
    const red = await loadRedPng();
    const source = await openTestLibrary();
    try {
      const live = await source.library.importMedia({
        kind: 'browser-file',
        handle: png,
        name: 'live.png',
        mime: 'image/png',
      });
      const doomed = await source.library.importMedia({
        kind: 'browser-file',
        handle: red,
        name: 'trashed.png',
        mime: 'image/png',
      });
      await source.library.applyLibraryAction({
        assetIds: [doomed.id],
        action: 'trash',
      });

      const exported = await exportArchive(source.getArchiveHost(), {
        scope: 'library',
      });
      const entries = unzipSync(exported.bytes);
      const records = JSON.parse(strFromU8(entries['records.json']!)) as {
        assets: Array<{ id: string; name: string; trashedAt: string | null }>;
      };
      expect(records.assets).toHaveLength(1);
      expect(records.assets[0]!.id).toBe(live.id);
      expect(records.assets[0]!.trashedAt).toBeNull();

      const target = await openTestLibrary();
      try {
        const result = await importArchive(
          target.getArchiveHost(),
          { bytes: exported.bytes },
          { conflict: 'remap' },
        );
        expect(result.importedAssets).toBe(1);
        const listed = await target.library.queryAssets({
          sort: 'createdAt-desc',
          limit: 20,
        });
        expect(listed.assets).toHaveLength(1);
        expect(listed.assets[0]!.name).toBe('live.png');
        const trashed = await target.library.queryAssets({
          sort: 'createdAt-desc',
          trashed: true,
          limit: 20,
        });
        expect(trashed.assets).toHaveLength(0);
      } finally {
        await target.close();
      }
    } finally {
      await source.close();
    }
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
