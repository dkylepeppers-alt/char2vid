import { Capacitor, registerPlugin } from '@capacitor/core';

import type { LibraryActionRequest } from '@char2vid/domain/library-actions';
import type {
  AssetQuery,
  AssetQueryResult,
} from '@char2vid/domain/library-query';
import type {
  AssetRecord,
  ImportSource,
  LibraryPort,
} from '@char2vid/domain/storage';
import { parseAssetRecord } from '@char2vid/domain/asset-schema';

interface Char2vidLibraryPlugin {
  importFromNativeUri(options: {
    uri: string;
    name: string;
    mime: string;
  }): Promise<AssetRecord>;
  getAsset(options: { id: string }): Promise<{ asset: AssetRecord | null }>;
  openRevisionRead(options: {
    revisionId: string;
  }): Promise<{ readId: string; byteLength: number; mime: string }>;
  readRevisionChunk(options: {
    readId: string;
    maxBytes?: number;
  }): Promise<{ done: boolean; data: string | null }>;
  closeRevisionRead(options: { readId: string }): Promise<void>;
  reconcileImports(): Promise<{ repaired: number; missing: string[] }>;
  storageUsage(): Promise<{
    originals: number;
    cache: number;
    available?: number | null;
  }>;
  queryAssets(options: AssetQuery): Promise<{
    assets: AssetRecord[];
    nextCursor?: string | null;
  }>;
  applyLibraryAction(options: LibraryActionRequest): Promise<void>;
}

const Char2vidLibrary =
  registerPlugin<Char2vidLibraryPlugin>('Char2vidLibrary');

function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary =
    typeof atob === 'function'
      ? atob(b64)
      : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Native Room/files library adapter (G2). Talks to Char2vidLibrary plugin.
 * Throws if invoked off Android — web callers should use `@char2vid/storage-web`.
 */
export class NativeLibraryPort implements LibraryPort {
  async importMedia(source: ImportSource): Promise<AssetRecord> {
    if (!isAndroidNative()) {
      throw new Error('NativeLibraryPort requires Android');
    }
    if (source.kind !== 'native-uri') {
      throw new Error(
        `NativeLibraryPort only accepts native-uri imports (got ${source.kind})`,
      );
    }
    if (typeof source.handle !== 'string' || source.handle.length === 0) {
      throw new Error('native-uri import requires a uri handle string');
    }
    const uri = source.handle;
    const record = await Char2vidLibrary.importFromNativeUri({
      uri,
      name: source.name,
      mime: source.mime,
    });
    return parseAssetRecord(record);
  }

  async getAsset(id: string): Promise<AssetRecord | undefined> {
    if (!isAndroidNative()) {
      throw new Error('NativeLibraryPort requires Android');
    }
    const { asset } = await Char2vidLibrary.getAsset({ id });
    if (asset == null) {
      return undefined;
    }
    return parseAssetRecord(asset);
  }

  async readRevision(revisionId: string): Promise<ReadableStream<Uint8Array>> {
    if (!isAndroidNative()) {
      throw new Error('NativeLibraryPort requires Android');
    }
    const opened = await Char2vidLibrary.openRevisionRead({ revisionId });
    let closed = false;
    const close = async () => {
      if (closed) {
        return;
      }
      closed = true;
      await Char2vidLibrary.closeRevisionRead({ readId: opened.readId });
    };
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const chunk = await Char2vidLibrary.readRevisionChunk({
          readId: opened.readId,
          maxBytes: 256 * 1024,
        });
        if (chunk.done || chunk.data == null) {
          await close();
          controller.close();
          return;
        }
        controller.enqueue(base64ToUint8Array(chunk.data));
      },
      async cancel() {
        await close();
      },
    });
  }

  async reconcileImports(): Promise<{ repaired: number; missing: string[] }> {
    if (!isAndroidNative()) {
      throw new Error('NativeLibraryPort requires Android');
    }
    return Char2vidLibrary.reconcileImports();
  }

  async storageUsage(): Promise<{
    originals: number;
    cache: number;
    available?: number;
  }> {
    if (!isAndroidNative()) {
      throw new Error('NativeLibraryPort requires Android');
    }
    const usage = await Char2vidLibrary.storageUsage();
    return {
      originals: usage.originals,
      cache: usage.cache,
      available:
        usage.available === null || usage.available === undefined
          ? undefined
          : usage.available,
    };
  }

  async queryAssets(query: AssetQuery): Promise<AssetQueryResult> {
    if (!isAndroidNative()) {
      throw new Error('NativeLibraryPort requires Android');
    }
    const result = await Char2vidLibrary.queryAssets(query);
    const assets = result.assets.map((a) => parseAssetRecord(a));
    return {
      assets,
      nextCursor:
        result.nextCursor === null || result.nextCursor === undefined
          ? undefined
          : result.nextCursor,
    };
  }

  async applyLibraryAction(request: LibraryActionRequest): Promise<void> {
    if (!isAndroidNative()) {
      throw new Error('NativeLibraryPort requires Android');
    }
    await Char2vidLibrary.applyLibraryAction(request);
  }
}

let sharedNative: NativeLibraryPort | null = null;

/** Singleton native library port for the Android WebView session. */
export function getNativeLibrary(): LibraryPort {
  if (!isAndroidNative()) {
    throw new Error('getNativeLibrary requires Android');
  }
  if (sharedNative === null) {
    sharedNative = new NativeLibraryPort();
  }
  return sharedNative;
}

export function isNativeLibraryAvailable(): boolean {
  return isAndroidNative();
}
