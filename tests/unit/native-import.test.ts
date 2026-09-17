import { describe, expect, it } from 'vitest';

import { resolveNativeImportRequest } from '../../packages/native-bridge/src/import-bytes';

describe('native import routing', () => {
  it('keeps native-uri imports on the existing plugin path', async () => {
    const request = await resolveNativeImportRequest({
      kind: 'native-uri',
      handle: 'file:///data/cache/job-output.png',
      name: 'job-output.png',
      mime: 'image/png',
    });
    expect(request).toEqual({
      method: 'importFromNativeUri',
      uri: 'file:///data/cache/job-output.png',
      name: 'job-output.png',
      mime: 'image/png',
    });
  });

  it('routes downloaded stream bytes through importFromBytes instead of rejecting', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const request = await resolveNativeImportRequest({
      kind: 'stream',
      handle: bytes,
      name: 'job-abcd-0',
      mime: 'image/png',
    });
    expect(request.method).toBe('importFromBytes');
    if (request.method !== 'importFromBytes') {
      throw new Error('expected importFromBytes');
    }
    expect(request.name).toBe('job-abcd-0');
    expect(request.mime).toBe('image/png');
    expect(Buffer.from(request.data, 'base64')).toEqual(Buffer.from(bytes));
  });
});
