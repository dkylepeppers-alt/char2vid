import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } from '../constants';
import { HttpError } from '../http-error';

const SCRYPT_KEYLEN = 32;

export function hashPassword(
  password: string,
  salt: Buffer = randomBytes(16),
): { salt: Buffer; hash: Buffer } {
  return { salt, hash: scryptSync(password, salt, SCRYPT_KEYLEN) };
}

export function verifyPassword(
  password: string,
  salt: Buffer,
  expected: Buffer,
): boolean {
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isSetupComplete(db: DatabaseSync): boolean {
  const row = db
    .prepare(`SELECT completed FROM setup_state WHERE id = 1`)
    .get() as { completed: number } | undefined;
  return row?.completed === 1;
}

export function completeSetup(
  db: DatabaseSync,
  setupToken: string,
  providedToken: string,
  login: string,
  password: string,
  nowIso: string,
): { ownerId: string } {
  if (isSetupComplete(db)) {
    throw new HttpError(409, 'setup_already_completed');
  }
  const expected = Buffer.from(setupToken, 'utf8');
  const actual = Buffer.from(providedToken, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new HttpError(401, 'invalid_setup_token');
  }
  const normalized = login.trim().toLowerCase();
  if (normalized.length < 3) {
    throw new HttpError(400, 'login_too_short');
  }
  if (password.length < 10) {
    throw new HttpError(400, 'password_too_short');
  }
  const ownerId = randomBytes(16).toString('hex');
  const { salt, hash } = hashPassword(password);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (isSetupComplete(db)) {
      throw new HttpError(409, 'setup_already_completed');
    }
    db.prepare(
      `INSERT INTO owners (id, login, password_salt, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(ownerId, normalized, salt, hash, nowIso);
    db.prepare(`UPDATE setup_state SET completed = 1 WHERE id = 1`).run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { ownerId };
}

export function recordLoginFailure(
  db: DatabaseSync,
  attemptKey: string,
  nowMs: number,
): void {
  db.prepare(
    `INSERT INTO login_attempts (attempt_key, attempted_at) VALUES (?, ?)`,
  ).run(attemptKey, nowMs);
}

export function assertLoginNotThrottled(
  db: DatabaseSync,
  attemptKey: string,
  nowMs: number,
): void {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM login_attempts
       WHERE attempt_key = ? AND attempted_at >= ?`,
    )
    .get(attemptKey, nowMs - LOGIN_WINDOW_MS) as { n: number };
  if (row.n >= LOGIN_MAX_FAILURES) {
    throw new HttpError(429, 'login_throttled');
  }
}

export function authenticateOwner(
  db: DatabaseSync,
  login: string,
  password: string,
  nowMs: number,
): { ownerId: string } {
  const attemptKey = login.trim().toLowerCase();
  assertLoginNotThrottled(db, attemptKey, nowMs);
  const row = db
    .prepare(
      `SELECT id, password_salt, password_hash FROM owners WHERE login = ?`,
    )
    .get(attemptKey) as
    { id: string; password_salt: Buffer; password_hash: Buffer } | undefined;
  if (
    !row ||
    !verifyPassword(
      password,
      Buffer.from(row.password_salt),
      Buffer.from(row.password_hash),
    )
  ) {
    recordLoginFailure(db, attemptKey, nowMs);
    throw new HttpError(401, 'invalid_credentials');
  }
  return { ownerId: row.id };
}

export function insertOwnerForTests(
  db: DatabaseSync,
  login: string,
  password: string,
  nowIso: string,
): { ownerId: string } {
  const ownerId = randomBytes(16).toString('hex');
  const { salt, hash } = hashPassword(password);
  db.prepare(
    `INSERT INTO owners (id, login, password_salt, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(ownerId, login.trim().toLowerCase(), salt, hash, nowIso);
  return { ownerId };
}
