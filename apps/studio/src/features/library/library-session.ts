import { Capacitor } from '@capacitor/core';

import type { LibraryPort } from '@char2vid/domain/storage';
import {
  openWebLibrary,
  type WebLibraryHandle,
} from '@char2vid/storage-web/library';

let sharedWeb: Promise<WebLibraryHandle> | null = null;
let sharedNative: LibraryPort | null = null;
const libraryInvalidationListeners = new Set<() => void>();

function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/**
 * Studio library surface. Web libraries also expose `getArchiveHost` for G4
 * portable archives. Native Room archives use `Char2vidArchive` via
 * `@char2vid/native-bridge/archive` instead of a JS archive host, so the ZIP
 * is never buffered in the WebView.
 */
export type StudioLibrary = LibraryPort & {
  getArchiveHost?: WebLibraryHandle['getArchiveHost'];
};

/**
 * Studio library singleton. On Android WebView uses the Room/files plugin via
 * `@char2vid/native-bridge`; on web uses IndexedDB/OPFS.
 */
export async function getStudioLibrary(): Promise<StudioLibrary> {
  if (isAndroidNative()) {
    if (sharedNative === null) {
      const { getNativeLibrary } =
        await import('@char2vid/native-bridge/library');
      sharedNative = getNativeLibrary();
    }
    return sharedNative;
  }
  if (sharedWeb === null) {
    sharedWeb = openWebLibrary({ dbName: 'char2vid-studio-library' });
  }
  return sharedWeb;
}

/**
 * Notify mounted library views that durable records changed outside their
 * query dependencies (native/web archive restore from Settings).
 */
export function subscribeLibraryInvalidation(listener: () => void): () => void {
  libraryInvalidationListeners.add(listener);
  return () => {
    libraryInvalidationListeners.delete(listener);
  };
}

export function invalidateStudioLibrary(): void {
  for (const listener of [...libraryInvalidationListeners]) {
    listener();
  }
}

export async function streamToUint8Array(
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

function toBlobPart(bytes: Uint8Array): BlobPart {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export async function revisionObjectUrl(
  library: LibraryPort,
  revisionId: string,
  mime: string,
): Promise<string> {
  const bytes = await streamToUint8Array(
    await library.readRevision(revisionId),
  );
  const blob = new Blob([toBlobPart(bytes)], { type: mime });
  return URL.createObjectURL(blob);
}
