import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import type { GenerationDraft } from '@char2vid/domain';

import { HttpError } from '../http-error.ts';
import { assertMutationCsrf, requireSession } from '../auth/sessions.ts';
import {
  acknowledgeJob,
  cancelJob,
  getJobForOwner,
  listJobsPage,
  listOutputs,
  markSaveProgress,
  submitJob,
  toReceipt,
} from './repository.ts';
import { outputPath } from './staging.ts';

function asDraft(value: unknown): GenerationDraft {
  if (typeof value !== 'object' || value === null) {
    throw new HttpError(400, 'invalid_draft');
  }
  const draft = value as GenerationDraft;
  if (
    typeof draft.clientRequestId !== 'string' ||
    typeof draft.prompt !== 'string'
  ) {
    throw new HttpError(400, 'invalid_draft');
  }
  return draft;
}

function asTransferIds(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'invalid_transfer_ids');
  }
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new HttpError(400, 'invalid_transfer_ids');
    }
    ids.push(item);
  }
  return ids;
}

export function registerJobRoutes(
  app: FastifyInstance,
  deps: {
    db: DatabaseSync;
    stagingDir: string;
    publicOrigin: string;
    now: () => Date;
  },
): void {
  app.post('/studio-api/jobs', (request, reply) => {
    const actor = requireSession(deps.db, request);
    assertMutationCsrf(actor, request, deps.publicOrigin);
    const body = request.body as {
      draft?: unknown;
      transferIds?: unknown;
      retryOfJobId?: unknown;
    };
    const result = submitJob(
      deps.db,
      actor.ownerId,
      asDraft(body.draft),
      asTransferIds(body.transferIds),
      deps.now(),
      typeof body.retryOfJobId === 'string' ? body.retryOfJobId : undefined,
    );
    if (result.created) {
      void reply.status(201);
    }
    return result.receipt;
  });

  app.get('/studio-api/jobs', (request) => {
    const actor = requireSession(deps.db, request);
    const query = request.query as { cursor?: string };
    const page = listJobsPage(
      deps.db,
      actor.ownerId,
      typeof query.cursor === 'string' ? query.cursor : undefined,
    );
    return {
      jobs: page.jobs.map((job) => toReceipt(deps.db, job)),
      nextCursor: page.nextCursor,
    };
  });

  app.get('/studio-api/jobs/:id', (request) => {
    const actor = requireSession(deps.db, request);
    const params = request.params as { id: string };
    return toReceipt(
      deps.db,
      getJobForOwner(deps.db, actor.ownerId, params.id),
    );
  });

  app.post('/studio-api/jobs/:id/cancel', (request) => {
    const actor = requireSession(deps.db, request);
    assertMutationCsrf(actor, request, deps.publicOrigin);
    const params = request.params as { id: string };
    return toReceipt(
      deps.db,
      cancelJob(deps.db, actor.ownerId, params.id, deps.now()),
    );
  });

  app.post('/studio-api/jobs/:id/save-progress', (request) => {
    const actor = requireSession(deps.db, request);
    assertMutationCsrf(actor, request, deps.publicOrigin);
    const params = request.params as { id: string };
    const body = request.body as { saveState?: unknown };
    if (
      body.saveState !== 'downloading' &&
      body.saveState !== 'verifying' &&
      body.saveState !== 'failed'
    ) {
      throw new HttpError(400, 'invalid_save_state');
    }
    return toReceipt(
      deps.db,
      markSaveProgress(
        deps.db,
        actor.ownerId,
        params.id,
        body.saveState,
        deps.now(),
      ),
    );
  });

  app.post('/studio-api/jobs/:id/acknowledge', (request) => {
    const actor = requireSession(deps.db, request);
    assertMutationCsrf(actor, request, deps.publicOrigin);
    const params = request.params as { id: string };
    const body = request.body as { hashes?: unknown };
    if (!Array.isArray(body.hashes)) {
      throw new HttpError(400, 'hashes_required');
    }
    const hashes: string[] = [];
    for (const item of body.hashes) {
      if (typeof item !== 'string') {
        throw new HttpError(400, 'hashes_required');
      }
      hashes.push(item);
    }
    return toReceipt(
      deps.db,
      acknowledgeJob(
        deps.db,
        actor.ownerId,
        params.id,
        hashes,
        deps.stagingDir,
        deps.now(),
      ),
    );
  });

  app.get('/studio-api/jobs/:id/outputs/:ordinal', (request, reply) => {
    const actor = requireSession(deps.db, request);
    const params = request.params as { id: string; ordinal: string };
    const job = getJobForOwner(deps.db, actor.ownerId, params.id);
    const ordinal = Number(params.ordinal);
    const output = listOutputs(deps.db, job.id).find(
      (item) => item.ordinal === ordinal,
    );
    if (!output) {
      throw new HttpError(404, 'output_not_found');
    }
    void reply
      .header('content-type', output.mime)
      .header('content-length', String(output.bytes))
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff');
    return reply.send(
      createReadStream(outputPath(deps.stagingDir, job.id, ordinal)),
    );
  });
}
