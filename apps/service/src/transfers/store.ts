import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  CHUNK_BYTES,
  FINALIZED_TRANSFER_TTL_MS,
  PENDING_TRANSFER_TTL_MS,
} from '../constants';
import { HttpError } from '../http-error';
import { sha256Hex } from './signed-inputs';

export interface TransferRecord {
  id: string;
  ownerId: string;
  sha256: string;
  bytes: number;
  mime: string;
  purpose: string;
  state: 'pending' | 'finalized' | 'expired';
  createdAt: string;
  expiresAt: string;
  receivedBytes: number;
  parts: number;
}

interface TransferRow {
  id: string;
  owner_id: string;
  sha256: string;
  bytes: number;
  mime: string;
  purpose: string;
  state: 'pending' | 'finalized' | 'expired';
  created_at: string;
  expires_at: string;
}

function partsDir(stagingDir: string, transferId: string): string {
  return join(stagingDir, 'parts', transferId);
}

function objectPath(stagingDir: string, transferId: string): string {
  return join(stagingDir, 'objects', transferId);
}

function partPath(
  stagingDir: string,
  transferId: string,
  index: number,
): string {
  return join(partsDir(stagingDir, transferId), String(index));
}

function asRecord(db: DatabaseSync, row: TransferRow): TransferRecord {
  const parts = db
    .prepare(
      `SELECT COALESCE(SUM(bytes), 0) AS received, COUNT(*) AS n
       FROM transfer_parts WHERE transfer_id = ?`,
    )
    .get(row.id) as { received: number; n: number };
  return {
    id: row.id,
    ownerId: row.owner_id,
    sha256: row.sha256,
    bytes: row.bytes,
    mime: row.mime,
    purpose: row.purpose,
    state: row.state,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    receivedBytes: Number(parts.received),
    parts: Number(parts.n),
  };
}

export function reservedBytes(db: DatabaseSync): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(bytes), 0) AS n FROM transfers
       WHERE state IN ('pending', 'finalized')`,
    )
    .get() as { n: number };
  return Number(row.n);
}

export function expireDueTransfers(
  db: DatabaseSync,
  stagingDir: string,
  nowIso: string,
): void {
  const due = db
    .prepare(
      `SELECT id, state FROM transfers
       WHERE state IN ('pending', 'finalized') AND expires_at <= ?`,
    )
    .all(nowIso) as { id: string; state: string }[];
  for (const item of due) {
    rmSync(partsDir(stagingDir, item.id), { recursive: true, force: true });
    rmSync(objectPath(stagingDir, item.id), { force: true });
    db.prepare(`DELETE FROM transfer_parts WHERE transfer_id = ?`).run(item.id);
    db.prepare(`UPDATE transfers SET state = 'expired' WHERE id = ?`).run(
      item.id,
    );
  }
}

function getRow(db: DatabaseSync, id: string): TransferRow | undefined {
  return db
    .prepare(
      `SELECT id, owner_id, sha256, bytes, mime, purpose, state, created_at, expires_at
       FROM transfers WHERE id = ?`,
    )
    .get(id) as TransferRow | undefined;
}

export function createTransfer(
  db: DatabaseSync,
  stagingDir: string,
  quotaBytes: number,
  ownerId: string,
  input: { sha256: string; bytes: number; mime: string; purpose: string },
  now: Date,
): { transferId: string; chunkBytes: number } {
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw new HttpError(400, 'invalid_sha256');
  }
  if (!Number.isInteger(input.bytes) || input.bytes <= 0) {
    throw new HttpError(400, 'invalid_bytes');
  }
  if (!input.mime.trim() || !input.purpose.trim()) {
    throw new HttpError(400, 'invalid_transfer_fields');
  }
  expireDueTransfers(db, stagingDir, now.toISOString());
  if (reservedBytes(db) + input.bytes > quotaBytes) {
    throw new HttpError(413, 'quota_exhausted');
  }
  const transferId = randomBytes(16).toString('hex');
  const expires = new Date(
    now.getTime() + PENDING_TRANSFER_TTL_MS,
  ).toISOString();
  db.prepare(
    `INSERT INTO transfers
      (id, owner_id, sha256, bytes, mime, purpose, state, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(
    transferId,
    ownerId,
    input.sha256,
    input.bytes,
    input.mime.trim(),
    input.purpose.trim(),
    now.toISOString(),
    expires,
  );
  mkdirSync(partsDir(stagingDir, transferId), { recursive: true });
  return { transferId, chunkBytes: CHUNK_BYTES };
}

export function writePart(
  db: DatabaseSync,
  stagingDir: string,
  ownerId: string,
  transferId: string,
  index: number,
  body: Uint8Array,
): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new HttpError(400, 'invalid_part_index');
  }
  if (body.byteLength === 0) {
    throw new HttpError(400, 'empty_part');
  }
  if (body.byteLength > CHUNK_BYTES) {
    throw new HttpError(413, 'part_too_large');
  }
  const row = getRow(db, transferId);
  if (!row) {
    throw new HttpError(404, 'transfer_not_found');
  }
  if (row.owner_id !== ownerId) {
    throw new HttpError(404, 'transfer_not_found');
  }
  if (row.state !== 'pending') {
    throw new HttpError(409, 'transfer_not_pending');
  }
  const existing = db
    .prepare(
      `SELECT sha256, bytes FROM transfer_parts
       WHERE transfer_id = ? AND part_index = ?`,
    )
    .get(transferId, index) as { sha256: string; bytes: number } | undefined;
  const digest = sha256Hex(body);
  if (existing) {
    if (existing.sha256 === digest && existing.bytes === body.byteLength) {
      return;
    }
    throw new HttpError(409, 'part_conflict');
  }
  const received = db
    .prepare(
      `SELECT COALESCE(SUM(bytes), 0) AS n FROM transfer_parts WHERE transfer_id = ?`,
    )
    .get(transferId) as { n: number };
  if (Number(received.n) + body.byteLength > row.bytes) {
    throw new HttpError(413, 'transfer_overflow');
  }
  mkdirSync(partsDir(stagingDir, transferId), { recursive: true });
  writeFileSync(partPath(stagingDir, transferId, index), body);
  db.prepare(
    `INSERT INTO transfer_parts (transfer_id, part_index, sha256, bytes)
     VALUES (?, ?, ?, ?)`,
  ).run(transferId, index, digest, body.byteLength);
}

export function finalizeTransfer(
  db: DatabaseSync,
  stagingDir: string,
  ownerId: string,
  transferId: string,
  now: Date,
): TransferRecord {
  const row = getRow(db, transferId);
  if (!row) {
    throw new HttpError(404, 'transfer_not_found');
  }
  if (row.owner_id !== ownerId) {
    throw new HttpError(404, 'transfer_not_found');
  }
  if (row.state === 'finalized') {
    return asRecord(db, row);
  }
  if (row.state !== 'pending') {
    throw new HttpError(409, 'transfer_not_pending');
  }
  const parts = db
    .prepare(
      `SELECT part_index, bytes FROM transfer_parts
       WHERE transfer_id = ? ORDER BY part_index ASC`,
    )
    .all(transferId) as { part_index: number; bytes: number }[];
  if (parts.length === 0) {
    throw new HttpError(409, 'truncated_upload');
  }
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i]?.part_index !== i) {
      throw new HttpError(409, 'truncated_upload');
    }
  }
  const total = parts.reduce((sum, part) => sum + part.bytes, 0);
  if (total !== row.bytes) {
    throw new HttpError(409, 'truncated_upload');
  }
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(
      readFileSync(partPath(stagingDir, transferId, part.part_index)),
    );
  }
  const combined = Buffer.concat(chunks);
  if (sha256Hex(combined) !== row.sha256) {
    throw new HttpError(409, 'checksum_mismatch');
  }
  mkdirSync(join(stagingDir, 'objects'), { recursive: true });
  const tempObject = `${objectPath(stagingDir, transferId)}.tmp`;
  writeFileSync(tempObject, combined);
  renameSync(tempObject, objectPath(stagingDir, transferId));
  const expires = new Date(
    now.getTime() + FINALIZED_TRANSFER_TTL_MS,
  ).toISOString();
  db.prepare(
    `UPDATE transfers SET state = 'finalized', expires_at = ? WHERE id = ?`,
  ).run(expires, transferId);
  rmSync(partsDir(stagingDir, transferId), { recursive: true, force: true });
  const updated = getRow(db, transferId);
  if (!updated) {
    throw new HttpError(500, 'transfer_missing_after_finalize');
  }
  return asRecord(db, updated);
}

export function getTransfer(
  db: DatabaseSync,
  ownerId: string,
  transferId: string,
): TransferRecord {
  const row = getRow(db, transferId);
  if (!row || row.owner_id !== ownerId) {
    throw new HttpError(404, 'transfer_not_found');
  }
  return asRecord(db, row);
}

export function readFinalizedObject(
  db: DatabaseSync,
  stagingDir: string,
  transferId: string,
): { mime: string; bytes: Buffer } {
  const row = getRow(db, transferId);
  if (!row || row.state !== 'finalized') {
    throw new HttpError(404, 'transfer_not_found');
  }
  return {
    mime: row.mime,
    bytes: readFileSync(objectPath(stagingDir, transferId)),
  };
}
