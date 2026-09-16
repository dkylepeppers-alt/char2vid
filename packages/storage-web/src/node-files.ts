import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { finalRelativePath, tempRelativePath, type FileStore } from './files';

async function ensureDirFor(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export function createNodeFileStore(rootDir: string): FileStore {
  const resolve = (relative: string) => join(rootDir, relative);

  return {
    mode: 'node-fs',
    async writeTemp(importId, bytes) {
      const relative = tempRelativePath(importId);
      const absolute = resolve(relative);
      await ensureDirFor(absolute);
      await writeFile(absolute, bytes);
      return relative;
    },
    async readBytes(path) {
      return new Uint8Array(await readFile(resolve(path)));
    },
    async pathExists(path) {
      try {
        await stat(resolve(path));
        return true;
      } catch {
        return false;
      }
    },
    async promote(tempPath, sha256) {
      const finalRelative = finalRelativePath(sha256);
      const finalAbsolute = resolve(finalRelative);
      const tempAbsolute = resolve(tempPath);
      if (await this.pathExists(finalRelative)) {
        await rm(tempAbsolute, { force: true });
        return finalRelative;
      }
      await ensureDirFor(finalAbsolute);
      try {
        await rename(tempAbsolute, finalAbsolute);
      } catch {
        // Cross-device fallback
        const bytes = await readFile(tempAbsolute);
        await writeFile(finalAbsolute, bytes);
        await rm(tempAbsolute, { force: true });
      }
      return finalRelative;
    },
    async remove(path) {
      await rm(resolve(path), { force: true });
    },
    originalsByteLength() {
      return Promise.resolve(0);
    },
  };
}

export function createJsonFilePersister(metaPath: string) {
  const empty = () => ({
    journal: {},
    assets: {},
    revisions: {},
    physical: {},
    collectionMembers: {},
    assetTags: {},
    characters: {},
    characterRevisions: {},
    looks: {},
  });

  return {
    async load() {
      try {
        const raw = await readFile(metaPath, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return {
          ...empty(),
          ...parsed,
        };
      } catch {
        return empty();
      }
    },
    async save(snapshot: unknown) {
      await ensureDirFor(metaPath);
      const temp = `${metaPath}.tmp`;
      await writeFile(temp, JSON.stringify(snapshot, null, 2), 'utf8');
      await rename(temp, metaPath);
    },
  };
}
