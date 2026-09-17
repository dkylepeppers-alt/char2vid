import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildApp, signMediaAccess } from '../../apps/service/src/app';
import {
  isBlockedAddress,
  safeDownload,
} from '../../apps/service/src/network/safe-download';
import {
  CHUNK_BYTES,
  PENDING_TRANSFER_TTL_MS,
} from '../../apps/service/src/constants';
import { sha256Hex } from '../../apps/service/src/transfers/signed-inputs';
import {
  closeTestService,
  loginNative,
  openTestService,
  setupOwner,
  type TestService,
} from '../helpers/open-test-service';

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function createPending(
  service: TestService,
  token: string,
  bytes: Uint8Array,
  mime = 'image/png',
) {
  const created = await service.app.inject({
    method: 'POST',
    url: '/studio-api/transfers',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      sha256: digest(bytes),
      bytes: bytes.byteLength,
      mime,
      purpose: 'reference',
    },
  });
  expect(created.statusCode).toBe(200);
  return created.json() as { transferId: string; chunkBytes: number };
}

describe('transfers (P2)', () => {
  it('accepts an identical part rewrite and rejects a changed payload', async () => {
    const service = await openTestService();
    try {
      await setupOwner(service);
      const { token } = await loginNative(service);
      const payload = new Uint8Array([1, 2, 3, 4]);
      const { transferId } = await createPending(service, token, payload);
      const headers = {
        authorization: `Bearer ${token}`,
        'content-type': 'application/octet-stream',
      };
      const first = await service.app.inject({
        method: 'PUT',
        url: `/studio-api/transfers/${transferId}/parts/0`,
        headers,
        payload: Buffer.from(payload),
      });
      const again = await service.app.inject({
        method: 'PUT',
        url: `/studio-api/transfers/${transferId}/parts/0`,
        headers,
        payload: Buffer.from(payload),
      });
      const conflict = await service.app.inject({
        method: 'PUT',
        url: `/studio-api/transfers/${transferId}/parts/0`,
        headers,
        payload: Buffer.from([9, 9, 9, 9]),
      });
      expect(first.statusCode).toBe(200);
      expect(again.statusCode).toBe(200);
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toEqual({ error: 'part_conflict' });
    } finally {
      await closeTestService(service);
    }
  });

  it('rejects finalize when the upload is truncated', async () => {
    const service = await openTestService();
    try {
      await setupOwner(service);
      const { token } = await loginNative(service);
      const payload = new Uint8Array(16).fill(7);
      const { transferId } = await createPending(service, token, payload);
      await service.app.inject({
        method: 'PUT',
        url: `/studio-api/transfers/${transferId}/parts/0`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/octet-stream',
        },
        payload: Buffer.from(payload.subarray(0, 8)),
      });
      const finalize = await service.app.inject({
        method: 'POST',
        url: `/studio-api/transfers/${transferId}/finalize`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(finalize.statusCode).toBe(409);
      expect(finalize.json()).toEqual({ error: 'truncated_upload' });
    } finally {
      await closeTestService(service);
    }
  });

  it('rejects finalize when the checksum does not match', async () => {
    const service = await openTestService();
    try {
      await setupOwner(service);
      const { token } = await loginNative(service);
      const declared = new Uint8Array([1, 1, 1, 1]);
      const uploaded = new Uint8Array([2, 2, 2, 2]);
      const created = await service.app.inject({
        method: 'POST',
        url: '/studio-api/transfers',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          sha256: digest(declared),
          bytes: 4,
          mime: 'image/png',
          purpose: 'reference',
        },
      });
      const transferId = (created.json() as { transferId: string }).transferId;
      await service.app.inject({
        method: 'PUT',
        url: `/studio-api/transfers/${transferId}/parts/0`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/octet-stream',
        },
        payload: Buffer.from(uploaded),
      });
      const finalize = await service.app.inject({
        method: 'POST',
        url: `/studio-api/transfers/${transferId}/finalize`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(finalize.statusCode).toBe(409);
      expect(finalize.json()).toEqual({ error: 'checksum_mismatch' });
    } finally {
      await closeTestService(service);
    }
  });

  it('survives a service restart mid-upload', async () => {
    // Keep the same frozen clock across restart so pending TTL is not
    // evaluated against wall time (openTestService defaults to 2026-09-15).
    const frozenNow = () => new Date('2026-09-15T12:00:00.000Z');
    const first = await openTestService({ now: frozenNow });
    await setupOwner(first);
    const { token } = await loginNative(first);
    const payload = new Uint8Array([3, 4, 5, 6]);
    const { transferId } = await createPending(first, token, payload);
    await first.app.inject({
      method: 'PUT',
      url: `/studio-api/transfers/${transferId}/parts/0`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/octet-stream',
      },
      payload: Buffer.from(payload),
    });
    await first.app.close();
    first.db.close();

    const restarted = await buildApp({
      dbPath: join(first.dir, 'service.sqlite'),
      stagingDir: join(first.dir, 'staging'),
      setupToken: 'setup-secret-token',
      masterKey: first.masterKey,
      publicOrigin: first.origin,
      quotaBytes: 1024 * 1024,
      cookieSecure: false,
      validateProviderKey: async () => ({ ok: true }),
      now: frozenNow,
    });
    try {
      const finalize = await restarted.app.inject({
        method: 'POST',
        url: `/studio-api/transfers/${transferId}/finalize`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(finalize.statusCode).toBe(200);
      expect(finalize.json()).toMatchObject({
        transferId,
        state: 'finalized',
        sha256: digest(payload),
      });
    } finally {
      await restarted.close();
      await rm(first.dir, { recursive: true, force: true });
    }
  });

  it('rejects a non-hex transfer id before touching staging files', async () => {
    const service = await openTestService();
    try {
      await setupOwner(service);
      const { token } = await loginNative(service);
      const response = await service.app.inject({
        method: 'PUT',
        url: `/studio-api/transfers/${encodeURIComponent('../objects/evil')}/parts/0`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/octet-stream',
        },
        payload: Buffer.from([1, 2, 3, 4]),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_transfer_id' });
    } finally {
      await closeTestService(service);
    }
  });

  it('finalizes sequential parts and streams the signed object', async () => {
    const service = await openTestService();
    try {
      await setupOwner(service);
      const { token } = await loginNative(service);
      const first = new Uint8Array([1, 2, 3, 4]);
      const second = new Uint8Array([5, 6, 7, 8]);
      const payload = new Uint8Array([...first, ...second]);
      const { transferId } = await createPending(service, token, payload);
      const headers = {
        authorization: `Bearer ${token}`,
        'content-type': 'application/octet-stream',
      };
      expect(
        (
          await service.app.inject({
            method: 'PUT',
            url: `/studio-api/transfers/${transferId}/parts/0`,
            headers,
            payload: Buffer.from(first),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await service.app.inject({
            method: 'PUT',
            url: `/studio-api/transfers/${transferId}/parts/1`,
            headers,
            payload: Buffer.from(second),
          })
        ).statusCode,
      ).toBe(200);
      const finalize = await service.app.inject({
        method: 'POST',
        url: `/studio-api/transfers/${transferId}/finalize`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(finalize.statusCode).toBe(200);
      expect(finalize.json()).toMatchObject({
        transferId,
        state: 'finalized',
        sha256: digest(payload),
        bytes: payload.byteLength,
      });
      const exp = Math.floor(Date.now() / 1000) + 60;
      const signature = signMediaAccess(service.masterKey, transferId, exp);
      const downloaded = await service.app.inject({
        method: 'GET',
        url: `/studio-media/${transferId}?signature=${signature}&exp=${exp}`,
      });
      expect(downloaded.statusCode).toBe(200);
      expect(Buffer.from(downloaded.rawPayload)).toEqual(Buffer.from(payload));
    } finally {
      await closeTestService(service);
    }
  });

  it('rejects transfers that would exceed the staging quota', async () => {
    const service = await openTestService({ quotaBytes: 10 });
    try {
      await setupOwner(service);
      const { token } = await loginNative(service);
      const response = await service.app.inject({
        method: 'POST',
        url: '/studio-api/transfers',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          sha256: digest(new Uint8Array(16)),
          bytes: 16,
          mime: 'image/png',
          purpose: 'reference',
        },
      });
      expect(response.statusCode).toBe(413);
      expect(response.json()).toEqual({ error: 'quota_exhausted' });
    } finally {
      await closeTestService(service);
    }
  });

  it('serves a signed object and rejects a stale signature', async () => {
    const nowMs = Date.UTC(2026, 8, 14, 12, 0, 0);
    let now = nowMs;
    const service = await openTestService({
      now: () => new Date(now),
    });
    try {
      await setupOwner(service);
      const { token } = await loginNative(service);
      const payload = new Uint8Array([9, 8, 7, 6]);
      const { transferId } = await createPending(service, token, payload);
      await service.app.inject({
        method: 'PUT',
        url: `/studio-api/transfers/${transferId}/parts/0`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/octet-stream',
        },
        payload: Buffer.from(payload),
      });
      const finalize = await service.app.inject({
        method: 'POST',
        url: `/studio-api/transfers/${transferId}/finalize`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(finalize.statusCode).toBe(200);
      const exp = Math.floor(now / 1000) + 60;
      const signature = signMediaAccess(service.masterKey, transferId, exp);
      const listing = await service.app.inject({
        method: 'GET',
        url: '/studio-media',
      });
      expect(listing.statusCode).toBe(404);
      const fresh = await service.app.inject({
        method: 'GET',
        url: `/studio-media/${transferId}?signature=${signature}&exp=${exp}`,
      });
      expect(fresh.statusCode).toBe(200);
      expect(Buffer.from(fresh.rawPayload)).toEqual(Buffer.from(payload));
      now = nowMs + 120_000;
      const stale = await service.app.inject({
        method: 'GET',
        url: `/studio-media/${transferId}?signature=${signature}&exp=${exp}`,
      });
      expect(stale.statusCode).toBe(401);
      expect(stale.json()).toEqual({ error: 'stale_signature' });
    } finally {
      await closeTestService(service);
    }
  });

  it('refuses a redirect onto a private network and never forwards inference headers', async () => {
    const seen: Array<{
      url: string;
      authorization?: string;
      pinnedAddresses?: string[];
    }> = [];
    const dir = await mkdtemp(join(tmpdir(), 'char2vid-dl-'));
    const destination = join(dir, 'out.bin');
    await expect(
      safeDownload(
        'https://cdn.example/file.png',
        destination,
        { maxBytes: 1024, timeoutMs: 1000 },
        {
          lookup: async (hostname) => {
            if (hostname === 'cdn.example') return ['203.0.113.10'];
            return ['127.0.0.1'];
          },
          fetchImpl: async (url, init) => {
            const headers = new Headers(init?.headers);
            seen.push({
              url: String(url),
              authorization: headers.get('authorization') ?? undefined,
              pinnedAddresses: init?.pinnedAddresses,
            });
            return new Response(null, {
              status: 302,
              headers: { location: 'https://127.0.0.1/secret' },
            });
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'private_destination' });
    expect(seen).toEqual([
      {
        url: 'https://cdn.example/file.png',
        authorization: undefined,
        pinnedAddresses: ['203.0.113.10'],
      },
    ]);
    await expect(readFile(destination)).rejects.toThrow();
    await writeFile(join(dir, 'ok.bin'), '');
    expect(sha256Hex(new Uint8Array([1]))).toHaveLength(64);
  });

  it('blocks RFC1918 and link-local IPv4 destinations whose high bit is set', () => {
    expect(isBlockedAddress('10.1.2.3')).toBe(true);
    expect(isBlockedAddress('172.16.0.1')).toBe(true);
    expect(isBlockedAddress('192.168.1.1')).toBe(true);
    expect(isBlockedAddress('169.254.1.1')).toBe(true);
    expect(isBlockedAddress('203.0.113.10')).toBe(false);
  });

  it('streams a download to disk instead of concatenating the whole object', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'char2vid-dl-'));
    const destination = join(dir, 'out.bin');
    const payload = Buffer.alloc(64 * 1024 + 17, 7);
    const result = await safeDownload(
      'https://cdn.example/file.bin',
      destination,
      { maxBytes: payload.byteLength, timeoutMs: 1000 },
      {
        lookup: async () => ['203.0.113.10'],
        fetchImpl: async () =>
          new Response(payload, {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
          }),
      },
    );
    expect(result.bytes).toBe(payload.byteLength);
    expect(await readFile(destination)).toEqual(payload);
  });

  it('rejects uploads and finalize after the pending TTL elapses', async () => {
    let nowMs = Date.parse('2026-09-15T00:00:00.000Z');
    const service = await openTestService({
      now: () => new Date(nowMs),
    });
    try {
      await setupOwner(service);
      const { token } = await loginNative(service);
      const payload = new Uint8Array([1, 2, 3, 4]);
      const { transferId } = await createPending(service, token, payload);
      nowMs += PENDING_TRANSFER_TTL_MS + 1;
      const latePart = await service.app.inject({
        method: 'PUT',
        url: `/studio-api/transfers/${transferId}/parts/0`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/octet-stream',
        },
        payload: Buffer.from(payload),
      });
      expect(latePart.statusCode).toBe(410);
      expect(latePart.json()).toEqual({ error: 'transfer_expired' });
      const lateFinalize = await service.app.inject({
        method: 'POST',
        url: `/studio-api/transfers/${transferId}/finalize`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(lateFinalize.statusCode).toBe(410);
      expect(lateFinalize.json()).toEqual({ error: 'transfer_expired' });
    } finally {
      await closeTestService(service);
    }
  });

  it('accepts a part larger than Fastify’s default 1 MiB body limit', async () => {
    const service = await openTestService({ quotaBytes: 2_000_000 });
    try {
      await setupOwner(service);
      const { token } = await loginNative(service);
      const payload = Buffer.alloc(1_500_000, 3);
      const { transferId, chunkBytes } = await createPending(
        service,
        token,
        payload,
      );
      expect(chunkBytes).toBe(CHUNK_BYTES);
      const uploaded = await service.app.inject({
        method: 'PUT',
        url: `/studio-api/transfers/${transferId}/parts/0`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/octet-stream',
        },
        payload,
      });
      expect(uploaded.statusCode).toBe(200);
    } finally {
      await closeTestService(service);
    }
  });
});
