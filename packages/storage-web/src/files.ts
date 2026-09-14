import { sha256HexAsync } from './hash';

export type StorageMode = 'opfs' | 'idb-blob' | 'node-fs';

export interface FileStore {
  readonly mode: StorageMode;
  writeTemp(importId: string, bytes: Uint8Array): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  pathExists(path: string): Promise<boolean>;
  /**
   * Atomically promote a temp object to its content-addressed final path.
   * Returns the relative path. Idempotent if the final object already exists
   * with the same bytes.
   */
  promote(tempPath: string, sha256: string): Promise<string>;
  remove(path: string): Promise<void>;
  originalsByteLength(): Promise<number>;
  availableBytes?(): Promise<number | undefined>;
}

export function finalRelativePath(sha256: string): string {
  return `objects/${sha256.slice(0, 2)}/${sha256}`;
}

export function tempRelativePath(importId: string): string {
  return `tmp/${importId}`;
}

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export function looksLikePng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) {
    return false;
  }
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

export function validateMediaBytes(bytes: Uint8Array, mime: string): void {
  if (bytes.byteLength === 0) {
    throw new Error('empty media payload');
  }
  if (mime === 'image/png' && !looksLikePng(bytes)) {
    throw new Error('PNG signature mismatch');
  }
}

export async function hashAndValidate(
  bytes: Uint8Array,
  mime: string,
): Promise<{ sha256: string; bytes: number }> {
  validateMediaBytes(bytes, mime);
  const sha256 = await sha256HexAsync(bytes);
  return { sha256, bytes: bytes.byteLength };
}

/** Read ImportSource handle into bytes (browser-file / stream). */
export async function readImportHandle(handle: unknown): Promise<Uint8Array> {
  if (handle instanceof Uint8Array) {
    return handle;
  }
  if (typeof Blob !== 'undefined' && handle instanceof Blob) {
    return new Uint8Array(await handle.arrayBuffer());
  }
  if (handle instanceof ArrayBuffer) {
    return new Uint8Array(handle);
  }
  if (
    typeof ReadableStream !== 'undefined' &&
    handle instanceof ReadableStream
  ) {
    const reader = (handle as ReadableStream<Uint8Array>).getReader();
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
  throw new Error('unsupported import handle');
}

export function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export interface OpfsFileStoreOptions {
  /** Root OPFS directory name. */
  rootName?: string;
  /** When OPFS is unavailable, reject IDB blob writes larger than this. */
  idbFallbackLimitBytes?: number;
}

/**
 * Prefer OPFS for originals; fall back to an in-memory/IDB-friendly Map of
 * blobs when OPFS is unavailable (still usable in browsers without OPFS).
 */
export async function openBrowserFileStore(
  options: OpfsFileStoreOptions = {},
): Promise<FileStore> {
  const limit = options.idbFallbackLimitBytes ?? 32 * 1024 * 1024;
  const rootName = options.rootName ?? 'char2vid-media';

  if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(rootName, { create: true });
      return createOpfsFileStore(dir);
    } catch {
      // fall through to IDB blob map
    }
  }

  return createIdbBlobFileStore(limit);
}

function createOpfsFileStore(root: FileSystemDirectoryHandle): FileStore {
  async function ensureParent(
    relative: string,
  ): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
    const parts = relative.split('/');
    const name = parts.pop();
    if (!name) {
      throw new Error(`invalid path: ${relative}`);
    }
    let dir = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    return { dir, name };
  }

  async function writeFile(relative: string, bytes: Uint8Array): Promise<void> {
    const { dir, name } = await ensureParent(relative);
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Blob([bytes.slice()]));
    await writable.close();
  }

  async function readFile(relative: string): Promise<Uint8Array> {
    const { dir, name } = await ensureParent(relative);
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async function removeFile(relative: string): Promise<void> {
    try {
      const parts = relative.split('/');
      const name = parts.pop();
      if (!name) {
        return;
      }
      let dir = root;
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part);
      }
      await dir.removeEntry(name);
    } catch {
      // already gone
    }
  }

  async function exists(relative: string): Promise<boolean> {
    try {
      await readFile(relative);
      return true;
    } catch {
      return false;
    }
  }

  return {
    mode: 'opfs',
    async writeTemp(importId, bytes) {
      const path = tempRelativePath(importId);
      await writeFile(path, bytes);
      return path;
    },
    readBytes: readFile,
    pathExists: exists,
    async promote(tempPath, sha256) {
      const finalPath = finalRelativePath(sha256);
      if (await exists(finalPath)) {
        await removeFile(tempPath);
        return finalPath;
      }
      const bytes = await readFile(tempPath);
      await writeFile(finalPath, bytes);
      await removeFile(tempPath);
      return finalPath;
    },
    remove: removeFile,
    originalsByteLength() {
      // Best-effort walk is expensive; callers use meta for byte totals.
      return Promise.resolve(0);
    },
  };
}

function createIdbBlobFileStore(limitBytes: number): FileStore {
  const blobs = new Map<string, Uint8Array>();

  return {
    mode: 'idb-blob',
    writeTemp(importId, bytes) {
      if (bytes.byteLength > limitBytes) {
        return Promise.reject(
          new Error(
            `IDB blob fallback rejects payloads larger than ${limitBytes} bytes`,
          ),
        );
      }
      const path = tempRelativePath(importId);
      blobs.set(path, bytes.slice());
      return Promise.resolve(path);
    },
    readBytes(path) {
      const value = blobs.get(path);
      if (!value) {
        return Promise.reject(new Error(`missing blob path: ${path}`));
      }
      return Promise.resolve(value.slice());
    },
    pathExists(path) {
      return Promise.resolve(blobs.has(path));
    },
    promote(tempPath, sha256) {
      const finalPath = finalRelativePath(sha256);
      if (blobs.has(finalPath)) {
        blobs.delete(tempPath);
        return Promise.resolve(finalPath);
      }
      const bytes = blobs.get(tempPath);
      if (!bytes) {
        return Promise.reject(new Error(`missing temp path: ${tempPath}`));
      }
      if (bytes.byteLength > limitBytes) {
        return Promise.reject(
          new Error(
            `IDB blob fallback rejects payloads larger than ${limitBytes} bytes`,
          ),
        );
      }
      blobs.set(finalPath, bytes);
      blobs.delete(tempPath);
      return Promise.resolve(finalPath);
    },
    remove(path) {
      blobs.delete(path);
      return Promise.resolve();
    },
    originalsByteLength() {
      let total = 0;
      for (const [path, bytes] of blobs) {
        if (path.startsWith('objects/')) {
          total += bytes.byteLength;
        }
      }
      return Promise.resolve(total);
    },
  };
}

export { createIdbBlobFileStore, createOpfsFileStore };
