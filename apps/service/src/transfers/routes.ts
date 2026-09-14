import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';

import { HttpError } from '../http-error';
import { assertMutationCsrf, requireSession } from '../auth/sessions';
import {
  createTransfer,
  expireDueTransfers,
  finalizeTransfer,
  getTransfer,
  writePart,
} from './store';

export function registerTransferRoutes(
  app: FastifyInstance,
  deps: {
    db: DatabaseSync;
    stagingDir: string;
    quotaBytes: number;
    publicOrigin: string;
    now: () => Date;
  },
): void {
  app.post('/studio-api/transfers', (request) => {
    const actor = requireSession(deps.db, request);
    assertMutationCsrf(actor, request, deps.publicOrigin);
    const body = request.body as {
      sha256?: unknown;
      bytes?: unknown;
      mime?: unknown;
      purpose?: unknown;
    };
    expireDueTransfers(deps.db, deps.stagingDir, deps.now().toISOString());
    return createTransfer(
      deps.db,
      deps.stagingDir,
      deps.quotaBytes,
      actor.ownerId,
      {
        sha256: typeof body.sha256 === 'string' ? body.sha256 : '',
        bytes: typeof body.bytes === 'number' ? body.bytes : Number.NaN,
        mime: typeof body.mime === 'string' ? body.mime : '',
        purpose: typeof body.purpose === 'string' ? body.purpose : '',
      },
      deps.now(),
    );
  });

  app.put('/studio-api/transfers/:id/parts/:index', (request) => {
    const actor = requireSession(deps.db, request);
    assertMutationCsrf(actor, request, deps.publicOrigin);
    const params = request.params as { id: string; index: string };
    const index = Number(params.index);
    const payload = request.body;
    if (!(payload instanceof Buffer)) {
      throw new HttpError(400, 'binary_part_required');
    }
    writePart(
      deps.db,
      deps.stagingDir,
      actor.ownerId,
      params.id,
      index,
      payload,
    );
    return { ok: true };
  });

  app.post('/studio-api/transfers/:id/finalize', (request) => {
    const actor = requireSession(deps.db, request);
    assertMutationCsrf(actor, request, deps.publicOrigin);
    const params = request.params as { id: string };
    const record = finalizeTransfer(
      deps.db,
      deps.stagingDir,
      actor.ownerId,
      params.id,
      deps.now(),
    );
    return {
      transferId: record.id,
      sha256: record.sha256,
      bytes: record.bytes,
      mime: record.mime,
      state: record.state,
      expiresAt: record.expiresAt,
    };
  });

  app.get('/studio-api/transfers/:id', (request) => {
    const actor = requireSession(deps.db, request);
    const params = request.params as { id: string };
    expireDueTransfers(deps.db, deps.stagingDir, deps.now().toISOString());
    const record = getTransfer(deps.db, actor.ownerId, params.id);
    return {
      transferId: record.id,
      sha256: record.sha256,
      bytes: record.bytes,
      mime: record.mime,
      purpose: record.purpose,
      state: record.state,
      receivedBytes: record.receivedBytes,
      parts: record.parts,
      expiresAt: record.expiresAt,
    };
  });
}
