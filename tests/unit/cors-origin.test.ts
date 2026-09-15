import { describe, expect, it } from 'vitest';

import { isAllowedStudioOrigin } from '../../apps/service/src/cors';

describe('studio CORS origins (P2)', () => {
  it('allows the public origin, Capacitor, and loopback only', () => {
    expect(
      isAllowedStudioOrigin('https://studio.example', 'https://studio.example'),
    ).toBe(true);
    expect(
      isAllowedStudioOrigin('https://localhost', 'https://studio.example'),
    ).toBe(true);
    expect(
      isAllowedStudioOrigin('http://127.0.0.1:5173', 'https://studio.example'),
    ).toBe(true);
    expect(
      isAllowedStudioOrigin('https://evil.example', 'https://studio.example'),
    ).toBe(false);
  });
});
