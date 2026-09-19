import type { AssetRecord, ImportSource } from '@char2vid/domain/storage';

/** Max binary bytes encoded per Capacitor plugin call. */
export const NATIVE_IMPORT_CHUNK_BYTES = 256 * 1024;

export type NativeByteImportSink = {
  beginByteImport(): Promise<{ writeId: string; uri: string }>;
  appendByteImportChunk(options: {
    writeId: string;
    data: string;
  }): Promise<void>;
  abandonByteImport(options: { writeId: string }): Promise<void>;
  importFromNativeUri(options: {
    uri: string;
    name: string;
    mime: string;
  }): Promise<AssetRecord>;
};

function bytesToBase64(bytes: Uint8Array): string {
  let raw = '';
  for (const value of bytes) {
    raw += String.fromCharCode(value);
  }
  return btoa(raw);
}

function* sliceBytes(bytes: Uint8Array): Generator<Uint8Array> {
  if (bytes.byteLength === 0) {
    return;
  }
  for (
    let offset = 0;
    offset < bytes.byteLength;
    offset += NATIVE_IMPORT_CHUNK_BYTES
  ) {
    yield bytes.subarray(
      offset,
      Math.min(offset + NATIVE_IMPORT_CHUNK_BYTES, bytes.byteLength),
    );
  }
}

async function* iterateImportByteChunks(
  handle: unknown,
): AsyncGenerator<Uint8Array> {
  if (handle instanceof Uint8Array) {
    yield* sliceBytes(handle);
    return;
  }
  if (handle instanceof ArrayBuffer) {
    yield* sliceBytes(new Uint8Array(handle));
    return;
  }
  if (typeof Blob !== 'undefined' && handle instanceof Blob) {
    yield* iterateImportByteChunks(handle.stream());
    return;
  }
  if (
    typeof ReadableStream !== 'undefined' &&
    handle instanceof ReadableStream
  ) {
    const reader = (handle as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          yield* sliceBytes(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  throw new Error('unsupported import handle');
}

/**
 * Copy job/library bytes into a native temp file in bounded chunks, then
 * import through `importFromNativeUri`. Never builds one base64 string of the
 * whole payload.
 */
export async function importSourceViaNative(
  source: ImportSource,
  sink: NativeByteImportSink,
): Promise<AssetRecord> {
  if (source.kind === 'native-uri') {
    if (typeof source.handle !== 'string' || source.handle.length === 0) {
      throw new Error('native-uri import requires a uri handle string');
    }
    return sink.importFromNativeUri({
      uri: source.handle,
      name: source.name,
      mime: source.mime,
    });
  }
  const opened = await sink.beginByteImport();
  try {
    for await (const chunk of iterateImportByteChunks(source.handle)) {
      await sink.appendByteImportChunk({
        writeId: opened.writeId,
        data: bytesToBase64(chunk),
      });
    }
    return await sink.importFromNativeUri({
      uri: opened.uri,
      name: source.name,
      mime: source.mime,
    });
  } finally {
    try {
      await sink.abandonByteImport({ writeId: opened.writeId });
    } catch {
      // Temp cleanup is best-effort; import may already have copied the file.
    }
  }
}
