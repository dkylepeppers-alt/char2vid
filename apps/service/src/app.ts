import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import { SESSION_COOKIE } from './constants.ts';
import { isAllowedStudioOrigin } from './cors.ts';
import { openServiceDb } from './db/open.ts';
import { HttpError } from './http-error.ts';
import {
  completeSetup,
  authenticateOwner,
  isSetupComplete,
} from './auth/enrollment.ts';
import { readMaskedProviderKey, storeProviderKey } from './auth/credentials.ts';
import {
  assertMutationCsrf,
  createSession,
  encodeCredential,
  requireSession,
  revokeSession,
} from './auth/sessions.ts';
import { registerTransferRoutes } from './transfers/routes.ts';
import { assertTransferId, openFinalizedObject } from './transfers/store.ts';
import { verifyMediaAccess } from './transfers/signed-inputs.ts';
import { registerJobRoutes } from './jobs/routes.ts';
import { processJobs, type WorkerEnv } from './jobs/worker.ts';
import { createHttpGenerationProvider } from './jobs/http-provider.ts';
import type { GenerationProvider } from './jobs/provider.ts';
import {
  DEFAULT_JOB_LEASE_MS,
  DEFAULT_OWNER_CONCURRENCY,
} from './jobs/repository.ts';
import { randomBytes } from 'node:crypto';

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
  provider?: GenerationProvider;
  autoProcessJobs?: boolean;
  jobLeaseMs?: number;
  maxOwnerConcurrency?: number;
}

export interface BuiltService {
  app: FastifyInstance;
  db: DatabaseSync;
  processJobs: () => Promise<void>;
  close: () => Promise<void>;
}

function jsonError(error: unknown): { statusCode: number; error: string } {
  if (error instanceof HttpError) {
    return { statusCode: error.statusCode, error: error.code };
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    Number(error.statusCode) === 429
  ) {
    return { statusCode: 429, error: 'rate_limited' };
  }
  return { statusCode: 500, error: 'internal_error' };
}

export async function buildApp(env: ServiceEnv): Promise<BuiltService> {
  const db = openServiceDb(env.dbPath);
  const now = env.now ?? (() => new Date());
  const app = Fastify({ logger: false });

  await app.register(cookie);
  await app.register(cors, {
    hook: 'onRequest',
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, isAllowedStudioOrigin(origin, env.publicOrigin));
    },
  });
  await app.register(rateLimit, {
    global: false,
    hook: 'preHandler',
  });

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

  app.post(
    '/studio-api/setup',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    (request, reply) => {
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
    },
  );

  app.post(
    '/studio-api/session',
    {
      config: {
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
    },
    (request, reply) => {
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
    },
  );

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

  registerJobRoutes(app, {
    db,
    stagingDir: env.stagingDir,
    publicOrigin: env.publicOrigin,
    now,
  });

  app.get(
    '/studio-media/:id',
    {
      config: {
        rateLimit: { max: 60, timeWindow: '1 minute' },
      },
    },
    (request, reply) => {
      const params = request.params as { id: string };
      assertTransferId(params.id);
      const query = request.query as { signature?: string; exp?: string };
      if (
        typeof query.signature !== 'string' ||
        typeof query.exp !== 'string'
      ) {
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
      const object = openFinalizedObject(db, env.stagingDir, params.id);
      void reply
        .header('content-type', object.mime)
        .header('content-length', String(object.bytes))
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff');
      return reply.send(createReadStream(object.absolutePath));
    },
  );

  app.get('/studio-media', () => {
    throw new HttpError(404, 'not_found');
  });

  const workerEnv: WorkerEnv = {
    db,
    stagingDir: env.stagingDir,
    masterKey: env.masterKey,
    publicOrigin: env.publicOrigin,
    provider: env.provider ?? createHttpGenerationProvider(),
    now,
    jobLeaseMs: env.jobLeaseMs ?? DEFAULT_JOB_LEASE_MS,
    workerId: randomBytes(8).toString('hex'),
    maxOwnerConcurrency: env.maxOwnerConcurrency ?? DEFAULT_OWNER_CONCURRENCY,
  };
  const runJobs = () => processJobs(workerEnv);
  let timer: ReturnType<typeof setInterval> | undefined;
  if (env.autoProcessJobs) {
    timer = setInterval(() => {
      void runJobs();
    }, 250);
  }

  const close = async () => {
    if (timer) {
      clearInterval(timer);
    }
    await app.close();
    db.close();
  };

  return { app, db, processJobs: runJobs, close };
}

export { safeDownload } from './network/safe-download.ts';
export { signMediaAccess } from './transfers/signed-inputs.ts';
export { insertOwnerForTests } from './auth/enrollment.ts';
export { decryptProviderKey } from './auth/credentials.ts';
export { claimQueuedJob } from './jobs/repository.ts';
