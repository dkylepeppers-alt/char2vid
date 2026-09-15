import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  buildApp,
  type BuiltService,
  type ServiceEnv,
} from '../../apps/service/src/app';

export interface TestService extends BuiltService {
  dir: string;
  origin: string;
  masterKey: Buffer;
  advanceNow: (ms: number) => void;
}

export async function openTestService(
  overrides: Partial<ServiceEnv> = {},
): Promise<TestService> {
  const dir = await mkdtemp(join(tmpdir(), 'char2vid-service-'));
  const masterKey = overrides.masterKey ?? randomBytes(32);
  const origin = overrides.publicOrigin ?? 'https://studio.example';
  let nowMs = Date.parse('2026-09-15T12:00:00.000Z');
  const { now: nowOverride, autoProcessJobs, ...rest } = overrides;
  const now = nowOverride ?? (() => new Date(nowMs));
  const built = await buildApp({
    dbPath: join(dir, 'service.sqlite'),
    stagingDir: join(dir, 'staging'),
    setupToken: 'setup-secret-token',
    masterKey,
    publicOrigin: origin,
    quotaBytes: 1024 * 1024,
    cookieSecure: false,
    validateProviderKey: async (apiKey) =>
      apiKey.startsWith('sk-test-')
        ? { ok: true }
        : { ok: false, reason: 'provider_key_rejected' },
    now,
    autoProcessJobs: autoProcessJobs ?? false,
    ...rest,
  });
  return {
    ...built,
    dir,
    origin,
    masterKey,
    advanceNow(ms: number) {
      nowMs += ms;
    },
  };
}

export async function closeTestService(service: TestService): Promise<void> {
  await service.close();
  await rm(service.dir, { recursive: true, force: true });
}

export async function setupOwner(
  service: TestService,
  login = 'owner',
  password = 'correct-horse-battery',
) {
  const response = await service.app.inject({
    method: 'POST',
    url: '/studio-api/setup',
    payload: {
      setupToken: 'setup-secret-token',
      login,
      password,
    },
  });
  return response;
}

export async function loginBrowser(
  service: TestService,
  login = 'owner',
  password = 'correct-horse-battery',
) {
  const response = await service.app.inject({
    method: 'POST',
    url: '/studio-api/session',
    payload: { login, password, client: 'browser' },
  });
  const setCookie = response.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = String(cookieHeader ?? '')
    .split(';')[0]
    ?.trim();
  return { response, cookie: cookie ?? '' };
}

export async function loginNative(
  service: TestService,
  login = 'owner',
  password = 'correct-horse-battery',
) {
  const response = await service.app.inject({
    method: 'POST',
    url: '/studio-api/session',
    payload: { login, password, client: 'native' },
  });
  return {
    response,
    token: (response.json() as { deviceToken?: string }).deviceToken ?? '',
  };
}
