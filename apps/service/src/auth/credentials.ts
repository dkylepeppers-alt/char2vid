import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { HttpError } from '../http-error';

const ALGO = 'aes-256-gcm';

export interface MaskedProviderKey {
  last4: string;
  fingerprint: string;
}

export function maskProviderKey(apiKey: string): MaskedProviderKey {
  const trimmed = apiKey.trim();
  if (trimmed.length < 8) {
    throw new HttpError(400, 'provider_key_too_short');
  }
  const last4 = trimmed.slice(-4);
  const fingerprint = createHash('sha256')
    .update(trimmed, 'utf8')
    .digest('hex')
    .slice(0, 12);
  return { last4, fingerprint };
}

export function encryptProviderKey(
  masterKey: Buffer,
  ownerId: string,
  apiKey: string,
): { ciphertext: Buffer; nonce: Buffer } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGO, masterKey, nonce);
  cipher.setAAD(Buffer.from(ownerId, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(apiKey, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { ciphertext, nonce };
}

export function decryptProviderKey(
  masterKey: Buffer,
  ownerId: string,
  ciphertext: Buffer,
  nonce: Buffer,
): string {
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const body = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv(ALGO, masterKey, nonce);
  decipher.setAAD(Buffer.from(ownerId, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString(
    'utf8',
  );
}

export function storeProviderKey(
  db: DatabaseSync,
  masterKey: Buffer,
  ownerId: string,
  apiKey: string,
  nowIso: string,
): MaskedProviderKey {
  const masked = maskProviderKey(apiKey);
  const { ciphertext, nonce } = encryptProviderKey(masterKey, ownerId, apiKey);
  db.prepare(
    `INSERT INTO provider_keys (owner_id, ciphertext, nonce, last4, fingerprint, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id) DO UPDATE SET
       ciphertext = excluded.ciphertext,
       nonce = excluded.nonce,
       last4 = excluded.last4,
       fingerprint = excluded.fingerprint,
       updated_at = excluded.updated_at`,
  ).run(ownerId, ciphertext, nonce, masked.last4, masked.fingerprint, nowIso);
  return masked;
}

export function readMaskedProviderKey(
  db: DatabaseSync,
  ownerId: string,
): MaskedProviderKey | undefined {
  const row = db
    .prepare(`SELECT last4, fingerprint FROM provider_keys WHERE owner_id = ?`)
    .get(ownerId) as MaskedProviderKey | undefined;
  return row;
}
