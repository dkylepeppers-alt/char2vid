import { describe, expect, it } from 'vitest';

import {
  insertOwnerForTests,
  decryptProviderKey,
} from '../../apps/service/src/app';
import { LOGIN_MAX_FAILURES } from '../../apps/service/src/constants';
import {
  closeTestService,
  loginBrowser,
  loginNative,
  openTestService,
  setupOwner,
} from '../helpers/open-test-service';

describe('service security (P2)', () => {
  it('rejects unauthenticated writes', async () => {
    const service = await openTestService();
    try {
      const response = await service.app.inject({
        method: 'POST',
        url: '/studio-api/transfers',
        payload: {
          sha256: 'a'.repeat(64),
          bytes: 4,
          mime: 'image/png',
          purpose: 'reference',
        },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthenticated' });
    } finally {
      await closeTestService(service);
    }
  });

  it('cannot reuse setup after the owner login exists', async () => {
    const service = await openTestService();
    try {
      const first = await setupOwner(service);
      expect(first.statusCode).toBe(201);
      const second = await setupOwner(service, 'other', 'different-password');
      expect(second.statusCode).toBe(409);
      expect(second.json()).toEqual({ error: 'setup_already_completed' });
    } finally {
      await closeTestService(service);
    }
  });

  it('keeps another owner from reading a transfer', async () => {
    const service = await openTestService();
    try {
      await setupOwner(service);
      const native = await loginNative(service);
      const created = await service.app.inject({
        method: 'POST',
        url: '/studio-api/transfers',
        headers: { authorization: `Bearer ${native.token}` },
        payload: {
          sha256: 'a'.repeat(64),
          bytes: 4,
          mime: 'image/png',
          purpose: 'reference',
        },
      });
      expect(created.statusCode).toBe(200);
      const transferId = (created.json() as { transferId: string }).transferId;

      insertOwnerForTests(
        service.db,
        'intruder',
        'intruder-password-long',
        new Date().toISOString(),
      );
      const other = await loginNative(
        service,
        'intruder',
        'intruder-password-long',
      );
      const peek = await service.app.inject({
        method: 'GET',
        url: `/studio-api/transfers/${transferId}`,
        headers: { authorization: `Bearer ${other.token}` },
      });
      expect(peek.statusCode).toBe(404);
      expect(peek.json()).toEqual({ error: 'transfer_not_found' });
    } finally {
      await closeTestService(service);
    }
  });

  it('requires a matching Origin for cookie mutations', async () => {
    const service = await openTestService();
    try {
      await setupOwner(service);
      const { cookie } = await loginBrowser(service);
      const missing = await service.app.inject({
        method: 'PUT',
        url: '/studio-api/provider-key',
        headers: { cookie },
        payload: { apiKey: 'sk-test-csrf-aaaa' },
      });
      expect(missing.statusCode).toBe(403);
      const wrong = await service.app.inject({
        method: 'PUT',
        url: '/studio-api/provider-key',
        headers: { cookie, origin: 'https://evil.example' },
        payload: { apiKey: 'sk-test-csrf-aaaa' },
      });
      expect(wrong.statusCode).toBe(403);
      const ok = await service.app.inject({
        method: 'PUT',
        url: '/studio-api/provider-key',
        headers: { cookie, origin: service.origin },
        payload: { apiKey: 'sk-test-csrf-aaaa' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ last4: 'aaaa' });
      expect(JSON.stringify(ok.json())).not.toContain('sk-test-csrf-aaaa');
    } finally {
      await closeTestService(service);
    }
  });

  it('throttles repeated failed logins', async () => {
    const service = await openTestService();
    try {
      await setupOwner(service);
      for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
        const failed = await service.app.inject({
          method: 'POST',
          url: '/studio-api/session',
          payload: {
            login: 'owner',
            password: 'wrong-password',
            client: 'native',
          },
        });
        expect(failed.statusCode).toBe(401);
      }
      const throttled = await service.app.inject({
        method: 'POST',
        url: '/studio-api/session',
        payload: {
          login: 'owner',
          password: 'wrong-password',
          client: 'native',
        },
      });
      expect(throttled.statusCode).toBe(429);
      expect(throttled.json()).toEqual({ error: 'login_throttled' });
    } finally {
      await closeTestService(service);
    }
  });

  it('encrypts the provider key with a unique nonce and returns only a mask', async () => {
    const service = await openTestService();
    try {
      await setupOwner(service);
      const native = await loginNative(service);
      const headers = { authorization: `Bearer ${native.token}` };
      const first = await service.app.inject({
        method: 'PUT',
        url: '/studio-api/provider-key',
        headers,
        payload: { apiKey: 'sk-test-unique-key-1' },
      });
      const nonceAfterFirst = Buffer.from(
        (
          service.db.prepare(`SELECT nonce FROM provider_keys`).get() as {
            nonce: Buffer;
          }
        ).nonce,
      );
      const second = await service.app.inject({
        method: 'PUT',
        url: '/studio-api/provider-key',
        headers,
        payload: { apiKey: 'sk-test-unique-key-1' },
      });
      const stored = service.db
        .prepare(`SELECT nonce, ciphertext FROM provider_keys`)
        .get() as { nonce: Buffer; ciphertext: Buffer };
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(first.json()).toEqual(second.json());
      expect(first.json()).toMatchObject({ last4: 'ey-1' });
      expect(nonceAfterFirst.equals(Buffer.from(stored.nonce))).toBe(false);
      const session = await service.app.inject({
        method: 'GET',
        url: '/studio-api/session',
        headers,
      });
      const plaintext = decryptProviderKey(
        service.masterKey,
        (session.json() as { ownerId: string }).ownerId,
        Buffer.from(stored.ciphertext),
        Buffer.from(stored.nonce),
      );
      expect(plaintext).toBe('sk-test-unique-key-1');
    } finally {
      await closeTestService(service);
    }
  });

  it('revokes a native session so later writes fail', async () => {
    const service = await openTestService();
    try {
      await setupOwner(service);
      const native = await loginNative(service);
      const revoked = await service.app.inject({
        method: 'DELETE',
        url: '/studio-api/session',
        headers: { authorization: `Bearer ${native.token}` },
      });
      expect(revoked.statusCode).toBe(200);
      const later = await service.app.inject({
        method: 'PUT',
        url: '/studio-api/provider-key',
        headers: { authorization: `Bearer ${native.token}` },
        payload: { apiKey: 'sk-test-after-revoke' },
      });
      expect(later.statusCode).toBe(401);
    } finally {
      await closeTestService(service);
    }
  });

  it('rate-limits setup-token guesses before an owner exists', async () => {
    const service = await openTestService();
    try {
      const statuses: number[] = [];
      let last = await service.app.inject({
        method: 'POST',
        url: '/studio-api/setup',
        payload: {
          setupToken: 'wrong-token',
          login: 'owner',
          password: 'correct-horse-battery',
        },
      });
      statuses.push(last.statusCode);
      for (let i = 1; i < 11; i += 1) {
        last = await service.app.inject({
          method: 'POST',
          url: '/studio-api/setup',
          payload: {
            setupToken: 'wrong-token',
            login: 'owner',
            password: 'correct-horse-battery',
          },
        });
        statuses.push(last.statusCode);
      }
      expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(
        true,
      );
      expect(last.statusCode).toBe(429);
      expect(last.json()).toEqual({ error: 'rate_limited' });
    } finally {
      await closeTestService(service);
    }
  });

  it('allows Capacitor WebView CORS preflight and rejects other sites', async () => {
    const service = await openTestService();
    try {
      const preflight = await service.app.inject({
        method: 'OPTIONS',
        url: '/studio-api/session',
        headers: {
          origin: 'https://localhost',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,authorization',
        },
      });
      expect(preflight.statusCode).toBeGreaterThanOrEqual(200);
      expect(preflight.statusCode).toBeLessThan(300);
      expect(preflight.headers['access-control-allow-origin']).toBe(
        'https://localhost',
      );
      expect(preflight.headers['access-control-allow-credentials']).toBe(
        'true',
      );
      const blocked = await service.app.inject({
        method: 'OPTIONS',
        url: '/studio-api/session',
        headers: {
          origin: 'https://evil.example',
          'access-control-request-method': 'POST',
        },
      });
      expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await closeTestService(service);
    }
  });
});
