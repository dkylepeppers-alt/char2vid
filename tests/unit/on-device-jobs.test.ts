import { describe, expect, it } from 'vitest';

import {
  bytesToDataUrl,
  selectGenerationBackend,
} from '../../apps/studio/src/features/jobs/on-device-jobs';

describe('on-device generation backend', () => {
  it('uses the Android worker when a Keystore provider key is present', () => {
    expect(
      selectGenerationBackend({
        platform: 'android',
        hasProviderKey: true,
        hasServiceSession: false,
      }),
    ).toBe('on-device');
  });

  it('keeps the remote service on web sessions', () => {
    expect(
      selectGenerationBackend({
        platform: 'web',
        hasProviderKey: false,
        hasServiceSession: true,
      }),
    ).toBe('service');
  });

  it('prefers the phone worker over a stale service origin on Android', () => {
    expect(
      selectGenerationBackend({
        platform: 'android',
        hasProviderKey: true,
        hasServiceSession: true,
      }),
    ).toBe('on-device');
  });

  it('cannot submit without a key or service session', () => {
    expect(
      selectGenerationBackend({
        platform: 'android',
        hasProviderKey: false,
        hasServiceSession: false,
      }),
    ).toBe('none');
  });

  it('encodes library bytes as a data URL for frozen provider requests', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    expect(bytesToDataUrl('image/png', png)).toBe(
      'data:image/png;base64,iVBORw==',
    );
  });
});
