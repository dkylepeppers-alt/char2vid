import { describe, expect, it } from 'vitest';

import {
  nativeTokenForOrigin,
  normalizeServiceOrigin,
  ServiceOriginError,
} from '../../apps/studio/src/features/settings/service-origin';

describe('service origin (P2)', () => {
  it('accepts HTTPS and loopback HTTP only', () => {
    expect(normalizeServiceOrigin('https://studio.example/')).toBe(
      'https://studio.example',
    );
    expect(normalizeServiceOrigin('http://127.0.0.1:8787')).toBe(
      'http://127.0.0.1:8787',
    );
    expect(() => normalizeServiceOrigin('http://studio.example')).toThrow(
      ServiceOriginError,
    );
    expect(() => normalizeServiceOrigin('http://192.168.1.10')).toThrow(
      ServiceOriginError,
    );
  });

  it('does not reuse a native token against a different origin', () => {
    expect(
      nativeTokenForOrigin(
        'device-token',
        'https://studio.example',
        'https://studio.example',
      ),
    ).toBe('device-token');
    expect(
      nativeTokenForOrigin(
        'device-token',
        'https://studio.example',
        'https://other.example',
      ),
    ).toBeUndefined();
  });
});
