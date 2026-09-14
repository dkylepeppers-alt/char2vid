import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';

import { SESSION_COOKIE } from './constants';
import { openServiceDb } from './db/open';
import { HttpError } from './http-error';
import {
  completeSetup,
  authenticateOwner,
  isSetupComplete,
} from './auth/enrollment';
import { readMaskedProviderKey, storeProviderKey } from './auth/credentials';
import {
  assertMutationCsrf,
  createSession,
  encodeCredential,
  requireSession,
  revokeSession,
} from './auth/sessions';
import { registerTransferRoutes } from './transfers/routes';
import { readFinalizedObject } from './transfers/store';
import { verifyMediaAccess } from './transfers/signed-inputs';

export interface ServiceEnv {
  dbPath: string;
  stagingDir: string;
  setupToken: string;
  masterKey: Buffer;
  publicOrigin: string;
  quotaBytes: number;
  cookieSecure: boolean;
  now?: () => Date;
  validateProviderKey?: (
    apiKey: string,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

export interface BuiltService {
  app: FastifyInstance;
  db: DatabaseSync;
  close: () => Promise<void>;
}

function jsonError(error: unknown): { statusCode: number; error: string } {
  if (error instanceof HttpError) {
    return { statusCode: error.statusCode, error: error.code };
  }
  return { statusCode: 500, error: 'internal_error' };
}

export async function buildApp(env: ServiceEnv): Promise<BuiltService> {
  const db = openServiceDb(env.dbPath);
  const now = env.now ?? (() => new Date());
  const app = Fastify({ logger: false });

  await app.register(cookie);

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.setErrorHandler((error, _request, reply) => {
    const mapped = jsonError(error);
    void reply.status(mapped.statusCode).send({ error: mapped.error });
  });

  app.get('/health', () => ({ ok: true }));
  app.get('/ready', () => {
    db.prepare('SELECT 1 AS ok').get();
    return { ok: true };
  });

  app.post('/studio-api/setup', (request, reply) => {
    const body = request.body as {
      setupToken?: unknown;
      login?: unknown;
      password?: unknown;
    };
    const result = completeSetup(
      db,
      env.setupToken,
      typeof body.setupToken === 'string' ? body.setupToken : '',
      typeof body.login === 'string' ? body.login : '',
      typeof body.password === 'string' ? body.password : '',
      now().toISOString(),
    );
    void reply.status(201);
    return { ownerId: result.ownerId, setup: 'completed' };
  });

  app.post('/studio-api/session', (request, reply) => {
    const body = request.body as {
      login?: unknown;
      password?: unknown;
      client?: unknown;
    };
    const owner = authenticateOwner(
      db,
      typeof body.login === 'string' ? body.login : '',
      typeof body.password === 'string' ? body.password : '',
      now().getTime(),
    );
    const session = createSession(db, owner.ownerId, now().toISOString());
    const credential = encodeCredential(session.sessionId, session.rawToken);
    const client = body.client === 'native' ? 'native' : 'browser';
    if (client === 'browser') {
      void reply.setCookie(SESSION_COOKIE, credential, {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: env.cookieSecure,
      });
      return { deviceId: session.deviceId, ownerId: owner.ownerId };
    }
    return {
      deviceId: session.deviceId,
      ownerId: owner.ownerId,
      deviceToken: credential,
    };
  });

  app.delete('/studio-api/session', (request, reply) => {
    const actor = requireSession(db, request);
    assertMutationCsrf(actor, request, env.publicOrigin);
    revokeSession(db, actor.sessionId, now().toISOString());
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { revoked: true };
  });

  app.get('/studio-api/session', (request) => {
    const actor = requireSession(db, request);
    return {
      ownerId: actor.ownerId,
      deviceId: actor.deviceId,
      setupComplete: isSetupComplete(db),
      providerKey: readMaskedProviderKey(db, actor.ownerId) ?? null,
    };
  });

  app.put('/studio-api/provider-key', async (request) => {
    const actor = requireSession(db, request);
    assertMutationCsrf(actor, request, env.publicOrigin);
    const body = request.body as { apiKey?: unknown };
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!apiKey) {
      throw new HttpError(400, 'provider_key_required');
    }
    const validator =
      env.validateProviderKey ??
      (() =>
        Promise.resolve({
          ok: false as const,
          reason: 'provider_key_validation_unverified',
        }));
    const result = await validator(apiKey);
    if (!result.ok) {
      throw new HttpError(400, result.reason);
    }
    return storeProviderKey(
      db,
      env.masterKey,
      actor.ownerId,
      apiKey,
      now().toISOString(),
    );
  });

  registerTransferRoutes(app, {
    db,
    stagingDir: env.stagingDir,
    quotaBytes: env.quotaBytes,
    publicOrigin: env.publicOrigin,
    now,
  });

  app.get('/studio-media/:id', (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { signature?: string; exp?: string };
    if (typeof query.signature !== 'string' || typeof query.exp !== 'string') {
      throw new HttpError(401, 'signature_required');
    }
    const exp = Number(query.exp);
    if (!Number.isFinite(exp)) {
      throw new HttpError(401, 'signature_required');
    }
    const check = verifyMediaAccess(
      env.masterKey,
      params.id,
      exp,
      query.signature,
      Math.floor(now().getTime() / 1000),
    );
    if (check === 'stale') {
      throw new HttpError(401, 'stale_signature');
    }
    if (check !== 'ok') {
      throw new HttpError(401, 'invalid_signature');
    }
    const object = readFinalizedObject(db, env.stagingDir, params.id);
    void reply
      .header('content-type', object.mime)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff');
    return reply.send(object.bytes);
  });

  app.get('/studio-media', () => {
    throw new HttpError(404, 'not_found');
  });

  const close = async () => {
    await app.close();
    db.close();
  };

  return { app, db, close };
}

export { safeDownload } from './network/safe-download';
export { signMediaAccess } from './transfers/signed-inputs';
export { insertOwnerForTests } from './auth/enrollment';
export { decryptProviderKey } from './auth/credentials';
