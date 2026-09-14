import { describe, expect, it } from 'vitest';

import { validateNanoGptKey } from '../../apps/service/src/auth/validate-key';

describe('validateNanoGptKey', () => {
  it('uses the documented check-balance path and never a generation route', async () => {
    const seen: string[] = [];
    const result = await validateNanoGptKey(
      'sk-test-fake',
      async (url, init) => {
        seen.push(`${init?.method ?? 'GET'} ${String(url)}`);
        return new Response('{"balance":0}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    );
    expect(result).toEqual({ ok: true });
    expect(seen).toEqual(['POST https://nano-gpt.com/api/check-balance']);
  });
});
