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
  /** Release underlying resources (IndexedDB connection, etc.). */
  close?(): Promise<void>;
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
  /** IndexedDB database name used by the blob fallback store. */
  idbBlobDbName?: string;
}

/**
 * Prefer OPFS for originals; fall back to a durable IndexedDB blob object
 * store when OPFS is unavailable (crash-safe without OPFS, size-capped).
 */
export async function openBrowserFileStore(
  options: OpfsFileStoreOptions = {},
): Promise<FileStore> {
  const limit = options.idbFallbackLimitBytes ?? 32 * 1024 * 1024;
  const rootName = options.rootName ?? 'char2vid-media';
  const idbBlobDbName = options.idbBlobDbName ?? 'char2vid-blobs';

  if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(rootName, { create: true });
      return createOpfsFileStore(dir);
    } catch {
      // fall through to IndexedDB blob store
    }
  }

  return createIdbBlobFileStore(limit, idbBlobDbName);
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

type BlobRecord = { path: string; data: ArrayBuffer };

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IDB request failed'));
  });
}

function idbTransactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
  });
}

async function openBlobDatabase(dbName: string): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is unavailable for blob fallback');
  }
  const request = indexedDB.open(dbName, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('blobs')) {
      db.createObjectStore('blobs', { keyPath: 'path' });
    }
  };
  return idbRequest(request);
}

/**
 * Durable IndexedDB object-store for media blobs keyed by relative path.
 * Survives close/reopen of the library (and page reload) under the same dbName.
 */
export async function createIdbBlobFileStore(
  limitBytes: number,
  dbName = 'char2vid-blobs',
): Promise<FileStore> {
  const db = await openBlobDatabase(dbName);

  async function putBlob(path: string, bytes: Uint8Array): Promise<void> {
    const tx = db.transaction('blobs', 'readwrite');
    const store = tx.objectStore('blobs');
    const record: BlobRecord = {
      path,
      data: bytes.slice().buffer,
    };
    store.put(record);
    await idbTransactionDone(tx);
  }

  async function getBlob(path: string): Promise<Uint8Array | undefined> {
    const tx = db.transaction('blobs', 'readonly');
    const store = tx.objectStore('blobs');
    const record = await idbRequest(
      store.get(path) as IDBRequest<BlobRecord | undefined>,
    );
    await idbTransactionDone(tx);
    if (!record) {
      return undefined;
    }
    return new Uint8Array(record.data.slice(0));
  }

  async function deleteBlob(path: string): Promise<void> {
    const tx = db.transaction('blobs', 'readwrite');
    tx.objectStore('blobs').delete(path);
    await idbTransactionDone(tx);
  }

  async function hasBlob(path: string): Promise<boolean> {
    const tx = db.transaction('blobs', 'readonly');
    const key = await idbRequest(tx.objectStore('blobs').getKey(path));
    await idbTransactionDone(tx);
    return key !== undefined;
  }

  function rejectOversize(bytes: Uint8Array): void {
    if (bytes.byteLength > limitBytes) {
      throw new Error(
        `IDB blob fallback rejects payloads larger than ${limitBytes} bytes`,
      );
    }
  }

  return {
    mode: 'idb-blob',
    async writeTemp(importId, bytes) {
      rejectOversize(bytes);
      const path = tempRelativePath(importId);
      await putBlob(path, bytes);
      return path;
    },
    async readBytes(path) {
      const value = await getBlob(path);
      if (!value) {
        throw new Error(`missing blob path: ${path}`);
      }
      return value;
    },
    pathExists(path) {
      return hasBlob(path);
    },
    async promote(tempPath, sha256) {
      const finalPath = finalRelativePath(sha256);
      if (await hasBlob(finalPath)) {
        await deleteBlob(tempPath);
        return finalPath;
      }
      const bytes = await getBlob(tempPath);
      if (!bytes) {
        throw new Error(`missing temp path: ${tempPath}`);
      }
      rejectOversize(bytes);
      await putBlob(finalPath, bytes);
      await deleteBlob(tempPath);
      return finalPath;
    },
    async remove(path) {
      await deleteBlob(path);
    },
    async originalsByteLength() {
      const tx = db.transaction('blobs', 'readonly');
      const store = tx.objectStore('blobs');
      const records = await idbRequest(
        store.getAll() as IDBRequest<BlobRecord[]>,
      );
      await idbTransactionDone(tx);
      let total = 0;
      for (const record of records) {
        if (record.path.startsWith('objects/')) {
          total += record.data.byteLength;
        }
      }
      return total;
    },
    close() {
      db.close();
      return Promise.resolve();
    },
  };
}

export { createOpfsFileStore };
