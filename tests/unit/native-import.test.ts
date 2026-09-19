import { describe, expect, it } from 'vitest';

import type { AssetRecord } from '../../packages/domain/src/storage';
import {
  NATIVE_IMPORT_CHUNK_BYTES,
  importSourceViaNative,
  type NativeByteImportSink,
} from '../../packages/native-bridge/src/import-bytes';

function fakeAsset(name: string, mime: string): AssetRecord {
  return {
    id: 'asset-1',
    revisionId: 'rev-1',
    kind: 'image',
    name,
    mime,
    sha256: 'abc',
    bytes: 4,
    state: 'available',
    createdAt: '2026-09-15T00:00:00.000Z',
    favorite: false,
    rating: null,
    folderId: null,
    trashedAt: null,
  };
}

function decodeBase64(data: string): Uint8Array {
  return Uint8Array.from(Buffer.from(data, 'base64'));
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function recordingSink(asset: AssetRecord): {
  sink: NativeByteImportSink;
  calls: string[];
  chunkData: string[];
} {
  const calls: string[] = [];
  const chunkData: string[] = [];
  const sink: NativeByteImportSink = {
    async beginByteImport() {
      calls.push('beginByteImport');
      return { writeId: 'write-1', uri: 'file:///cache/write-1' };
    },
    async appendByteImportChunk(options) {
      calls.push('appendByteImportChunk');
      chunkData.push(options.data);
    },
    async abandonByteImport() {
      calls.push('abandonByteImport');
    },
    async importFromNativeUri(options) {
      calls.push(`importFromNativeUri:${options.uri}`);
      return asset;
    },
  };
  return { sink, calls, chunkData };
}

describe('native import routing', () => {
  it('keeps native-uri imports on the existing plugin path', async () => {
    const asset = fakeAsset('job-output.png', 'image/png');
    const { sink, calls, chunkData } = recordingSink(asset);
    const imported = await importSourceViaNative(
      {
        kind: 'native-uri',
        handle: 'file:///data/cache/job-output.png',
        name: 'job-output.png',
        mime: 'image/png',
      },
      sink,
    );
    expect(imported).toEqual(asset);
    expect(calls).toEqual([
      'importFromNativeUri:file:///data/cache/job-output.png',
    ]);
    expect(chunkData).toEqual([]);
  });

  it('streams JS job bytes into a native temp file without one full-payload base64 string', async () => {
    const bytes = new Uint8Array(NATIVE_IMPORT_CHUNK_BYTES * 2 + 11);
    bytes[0] = 0x89;
    bytes[NATIVE_IMPORT_CHUNK_BYTES] = 0x50;
    bytes[bytes.length - 1] = 0x47;
    const asset = fakeAsset('job-abcd-0', 'video/mp4');
    const { sink, calls, chunkData } = recordingSink(asset);
    const imported = await importSourceViaNative(
      {
        kind: 'stream',
        handle: bytes,
        name: 'job-abcd-0',
        mime: 'video/mp4',
      },
      sink,
    );
    expect(imported).toEqual(asset);
    expect(calls[0]).toBe('beginByteImport');
    expect(
      calls.filter((name) => name === 'appendByteImportChunk'),
    ).toHaveLength(3);
    expect(calls).toContain('importFromNativeUri:file:///cache/write-1');
    expect(calls.at(-1)).toBe('abandonByteImport');
    expect(chunkData.every((data) => !data.includes(','))).toBe(true);
    const decoded = chunkData.map(decodeBase64);
    expect(
      decoded.every((chunk) => chunk.byteLength <= NATIVE_IMPORT_CHUNK_BYTES),
    ).toBe(true);
    expect(decoded.some((chunk) => chunk.byteLength === bytes.byteLength)).toBe(
      false,
    );
    expect(concat(decoded)).toEqual(bytes);
    const fullBase64 = Buffer.from(bytes).toString('base64');
    expect(chunkData.some((data) => data === fullBase64)).toBe(false);
    expect(Math.max(...chunkData.map((data) => data.length))).toBeLessThan(
      fullBase64.length,
    );
  });

  it('writes ReadableStream handles to the temp file without concatenating first', async () => {
    const first = new Uint8Array([0x89, 0x50]);
    const second = new Uint8Array([0x4e, 0x47]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
        controller.enqueue(second);
        controller.close();
      },
    });
    const asset = fakeAsset('job-stream-0', 'image/png');
    const { sink, chunkData } = recordingSink(asset);
    await importSourceViaNative(
      {
        kind: 'stream',
        handle: stream,
        name: 'job-stream-0',
        mime: 'image/png',
      },
      sink,
    );
    expect(concat(chunkData.map(decodeBase64))).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it('abandons the native temp file when a chunk write fails', async () => {
    const { sink, calls } = recordingSink(fakeAsset('x', 'image/png'));
    sink.appendByteImportChunk = async () => {
      calls.push('appendByteImportChunk');
      throw new Error('disk full');
    };
    await expect(
      importSourceViaNative(
        {
          kind: 'stream',
          handle: new Uint8Array([1, 2, 3]),
          name: 'job-fail-0',
          mime: 'image/png',
        },
        sink,
      ),
    ).rejects.toThrow(/disk full/);
    expect(calls[0]).toBe('beginByteImport');
    expect(calls.at(-1)).toBe('abandonByteImport');
  });
});
