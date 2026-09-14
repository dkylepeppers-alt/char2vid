import type { LibraryPort } from '@char2vid/domain/storage';
import {
  openWebLibrary,
  type WebLibraryHandle,
} from '@char2vid/storage-web/library';

let shared: Promise<WebLibraryHandle> | null = null;

/** Singleton web library for the studio session (IndexedDB / OPFS). */
export function getStudioLibrary(): Promise<LibraryPort & WebLibraryHandle> {
  if (shared === null) {
    shared = openWebLibrary({ dbName: 'char2vid-studio-library' });
  }
  return shared;
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
