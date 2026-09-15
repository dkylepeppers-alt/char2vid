import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildApp } from './app.ts';
import { validateNanoGptKey } from './auth/validate-key.ts';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function masterKeyFromEnv(): Buffer {
  const hex = required('CHAR2VID_MASTER_KEY');
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error('CHAR2VID_MASTER_KEY must be 32 bytes hex-encoded');
  }
  return key;
}

const stagingDir = resolve(
  process.env.CHAR2VID_STAGING_DIR ?? './data/staging',
);
const dbPath = resolve(process.env.CHAR2VID_DB_PATH ?? './data/service.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
mkdirSync(stagingDir, { recursive: true });

const built = await buildApp({
  dbPath,
  stagingDir,
  setupToken: required('CHAR2VID_SETUP_TOKEN'),
  masterKey: masterKeyFromEnv(),
  publicOrigin: required('CHAR2VID_PUBLIC_ORIGIN'),
  quotaBytes: Number(process.env.CHAR2VID_STAGING_QUOTA_BYTES ?? 2 * 1024 ** 3),
  cookieSecure: process.env.CHAR2VID_COOKIE_SECURE !== '0',
  validateProviderKey: (apiKey) => validateNanoGptKey(apiKey),
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
await built.app.listen({ port, host });
