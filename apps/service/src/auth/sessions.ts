import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyRequest } from 'fastify';
import '@fastify/cookie';

import { SESSION_COOKIE } from '../constants';
import { HttpError } from '../http-error';

export interface SessionActor {
  sessionId: string;
  ownerId: string;
  deviceId: string;
  via: 'cookie' | 'bearer';
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createSession(
  db: DatabaseSync,
  ownerId: string,
  nowIso: string,
): { sessionId: string; deviceId: string; rawToken: string } {
  const sessionId = randomBytes(16).toString('hex');
  const deviceId = randomBytes(16).toString('hex');
  const rawToken = randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO sessions (id, owner_id, device_id, token_hash, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(sessionId, ownerId, deviceId, hashToken(rawToken), nowIso);
  return { sessionId, deviceId, rawToken };
}

export function encodeCredential(sessionId: string, rawToken: string): string {
  return `${sessionId}.${rawToken}`;
}

function parseCredential(value: string): {
  sessionId: string;
  rawToken: string;
} {
  const split = value.indexOf('.');
  if (split <= 0 || split === value.length - 1) {
    throw new HttpError(401, 'invalid_session');
  }
  return {
    sessionId: value.slice(0, split),
    rawToken: value.slice(split + 1),
  };
}

function loadSession(
  db: DatabaseSync,
  credential: string,
): { sessionId: string; ownerId: string; deviceId: string } {
  const { sessionId, rawToken } = parseCredential(credential);
  const row = db
    .prepare(
      `SELECT id, owner_id, device_id, token_hash, revoked_at
       FROM sessions WHERE id = ?`,
    )
    .get(sessionId) as
    | {
        id: string;
        owner_id: string;
        device_id: string;
        token_hash: string;
        revoked_at: string | null;
      }
    | undefined;
  if (!row || row.revoked_at) {
    throw new HttpError(401, 'invalid_session');
  }
  const expected = Buffer.from(row.token_hash, 'hex');
  const actual = Buffer.from(hashToken(rawToken), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new HttpError(401, 'invalid_session');
  }
  return {
    sessionId: row.id,
    ownerId: row.owner_id,
    deviceId: row.device_id,
  };
}

export function readCredentialFromRequest(request: FastifyRequest):
  | {
      credential: string;
      via: 'cookie' | 'bearer';
    }
  | undefined {
  const header = request.headers.authorization;
  if (
    typeof header === 'string' &&
    header.toLowerCase().startsWith('bearer ')
  ) {
    return { credential: header.slice(7).trim(), via: 'bearer' };
  }
  const cookie = request.cookies[SESSION_COOKIE];
  if (cookie) {
    return { credential: cookie, via: 'cookie' };
  }
  return undefined;
}

export function requireSession(
  db: DatabaseSync,
  request: FastifyRequest,
): SessionActor {
  const found = readCredentialFromRequest(request);
  if (!found) {
    throw new HttpError(401, 'unauthenticated');
  }
  const session = loadSession(db, found.credential);
  return { ...session, via: found.via };
}

export function assertMutationCsrf(
  actor: SessionActor,
  request: FastifyRequest,
  publicOrigin: string,
): void {
  if (actor.via !== 'cookie') {
    return;
  }
  const origin = request.headers.origin;
  if (origin !== publicOrigin) {
    throw new HttpError(403, 'csrf_origin');
  }
}

export function revokeSession(
  db: DatabaseSync,
  sessionId: string,
  nowIso: string,
): void {
  db.prepare(
    `UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
  ).run(nowIso, sessionId);
}
