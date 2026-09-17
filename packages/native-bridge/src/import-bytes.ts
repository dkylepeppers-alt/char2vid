import type { ImportSource } from '@char2vid/domain/storage';

export type NativeImportRequest =
  | {
      method: 'importFromNativeUri';
      uri: string;
      name: string;
      mime: string;
    }
  | {
      method: 'importFromBytes';
      data: string;
      name: string;
      mime: string;
    };

function bytesToBase64(bytes: Uint8Array): string {
  let raw = '';
  for (const value of bytes) {
    raw += String.fromCharCode(value);
  }
  return btoa(raw);
}

async function readImportHandle(handle: unknown): Promise<Uint8Array> {
  if (handle instanceof Uint8Array) {
    return handle;
  }
  if (typeof Blob !== 'undefined' && handle instanceof Blob) {
    return new Uint8Array(await handle.arrayBuffer());
  }
  if (handle instanceof ArrayBuffer) {
    return new Uint8Array(handle);
  }
  throw new Error('unsupported import handle');
}

/**
 * Map a domain ImportSource onto a native plugin call. Downloaded job bytes
 * arrive as `stream` handles; Android still copies them through the cache-file
 * import used by instrumented job-output tests.
 */
export async function resolveNativeImportRequest(
  source: ImportSource,
): Promise<NativeImportRequest> {
  if (source.kind === 'native-uri') {
    if (typeof source.handle !== 'string' || source.handle.length === 0) {
      throw new Error('native-uri import requires a uri handle string');
    }
    return {
      method: 'importFromNativeUri',
      uri: source.handle,
      name: source.name,
      mime: source.mime,
    };
  }
  const bytes = await readImportHandle(source.handle);
  return {
    method: 'importFromBytes',
    data: bytesToBase64(bytes),
    name: source.name,
    mime: source.mime,
  };
}
