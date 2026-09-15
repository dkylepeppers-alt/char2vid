import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { buildApp } from '../../apps/service/src/app';
import { claimQueuedJob } from '../../apps/service/src/jobs/repository';
import type {
  GenerationDraft,
  JobReceipt,
} from '../../packages/domain/src/contracts';
import {
  closeTestService,
  loginNative,
  openTestService,
  setupOwner,
  type TestService,
} from '../helpers/open-test-service';
import {
  FakeGenerationProvider,
  FIXTURE_AUDIO,
  FIXTURE_PNG,
} from '../helpers/fake-nanogpt';
import { openTestLibrary } from '../helpers/open-test-library';

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function imageDraft(overrides: Partial<GenerationDraft> = {}): GenerationDraft {
  return {
    clientRequestId: 'client-req-1',
    operation: 'image-generate',
    modelId: 'fixture/image',
    prompt: 'A quiet portrait',
    references: [],
    parameters: { n: 2 },
    ...overrides,
  };
}

async function authService(provider: FakeGenerationProvider): Promise<{
  service: TestService;
  token: string;
  provider: FakeGenerationProvider;
}> {
  const service = await openTestService({
    provider,
    autoProcessJobs: false,
    jobLeaseMs: 30_000,
  });
  await setupOwner(service);
  const { token } = await loginNative(service);
  await service.app.inject({
    method: 'PUT',
    url: '/studio-api/provider-key',
    headers: { authorization: `Bearer ${token}` },
    payload: { apiKey: 'sk-test-jobs-key-1234' },
  });
  return { service, token, provider };
}

async function postJob(
  service: TestService,
  token: string,
  payload: Record<string, unknown>,
) {
  return service.app.inject({
    method: 'POST',
    url: '/studio-api/jobs',
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
}

async function getJob(service: TestService, token: string, id: string) {
  const response = await service.app.inject({
    method: 'GET',
    url: `/studio-api/jobs/${id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  return {
    status: response.statusCode,
    body: response.json() as JobReceipt & {
      cost?: { state: string; amount?: number; durationSeconds?: number };
      originalJobId?: string;
      outputs?: Array<{
        ordinal: number;
        sha256: string;
        mime: string;
        bytes: number;
      }>;
      error?: string;
    },
  };
}

async function runUntilTerminal(
  service: TestService,
  token: string,
  id: string,
  ticks = 8,
) {
  let last = await getJob(service, token, id);
  for (let i = 0; i < ticks; i += 1) {
    await service.processJobs();
    last = await getJob(service, token, id);
    if (
      last.body.providerState === 'completed' ||
      last.body.providerState === 'failed' ||
      last.body.providerState === 'cancelled' ||
      last.body.providerState === 'recovery-required' ||
      last.body.providerState === 'submission-unknown'
    ) {
      return last.body;
    }
  }
  return last.body;
}

describe('jobs (P4)', () => {
  it('returns the existing receipt for a duplicate client_request_id', async () => {
    const { service, token } = await authService(new FakeGenerationProvider());
    try {
      const first = await postJob(service, token, { draft: imageDraft() });
      const again = await postJob(service, token, { draft: imageDraft() });
      expect(first.statusCode).toBe(201);
      expect(again.statusCode).toBe(200);
      const a = first.json() as JobReceipt;
      const b = again.json() as JobReceipt;
      expect(b.id).toBe(a.id);
      expect(b.clientRequestId).toBe('client-req-1');
    } finally {
      await closeTestService(service);
    }
  });

  it('rejects the same client_request_id with a changed payload', async () => {
    const { service, token } = await authService(new FakeGenerationProvider());
    try {
      await postJob(service, token, { draft: imageDraft() });
      const conflict = await postJob(service, token, {
        draft: imageDraft({ prompt: 'A different prompt' }),
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toEqual({ error: 'client_request_conflict' });
    } finally {
      await closeTestService(service);
    }
  });

  it('lets only one worker claim a queued job', async () => {
    const { service, token } = await authService(new FakeGenerationProvider());
    try {
      const created = await postJob(service, token, { draft: imageDraft() });
      const receipt = created.json() as JobReceipt;
      const now = new Date('2026-09-15T00:00:00Z');
      const first = claimQueuedJob(service.db, 'worker-a', now, 30_000);
      const second = claimQueuedJob(service.db, 'worker-b', now, 30_000);
      expect(first?.id).toBe(receipt.id);
      expect(second).toBeUndefined();
    } finally {
      await closeTestService(service);
    }
  });

  it('does not auto-requeue a submitting lease after process death', async () => {
    const provider = new FakeGenerationProvider();
    provider.crashAfterSubmit = true;
    const { service, token } = await authService(provider);
    try {
      const created = await postJob(service, token, { draft: imageDraft() });
      const id = (created.json() as JobReceipt).id;
      await service.processJobs();
      const mid = await getJob(service, token, id);
      expect(mid.body.providerState).toBe('submitting');
      expect(provider.submits).toBe(1);

      service.advanceNow?.(31_000);
      await service.processJobs();
      const recovered = await getJob(service, token, id);
      expect(recovered.body.providerState).toBe('submission-unknown');
      expect(provider.submits).toBe(1);
    } finally {
      await closeTestService(service);
    }
  });

  it('captures every image output from url and base64 fallbacks', async () => {
    const { service, token, provider } = await authService(
      new FakeGenerationProvider(),
    );
    try {
      const created = await postJob(service, token, { draft: imageDraft() });
      const id = (created.json() as JobReceipt).id;
      const done = await runUntilTerminal(service, token, id);
      expect(done.providerState).toBe('completed');
      expect(done.saveState).toBe('absent');
      expect(done.outputs).toHaveLength(2);
      expect(done.outputs?.map((item) => item.sha256)).toEqual([
        digest(FIXTURE_PNG),
        digest(FIXTURE_PNG),
      ]);
      expect(provider.submits).toBe(1);
    } finally {
      await closeTestService(service);
    }
  });

  it('fails an empty successful image envelope without saving media', async () => {
    const provider = new FakeGenerationProvider();
    provider.imageBody = { data: [] };
    const { service, token } = await authService(provider);
    try {
      const created = await postJob(service, token, { draft: imageDraft() });
      const id = (created.json() as JobReceipt).id;
      const done = await runUntilTerminal(service, token, id);
      expect(done.providerState).toBe('failed');
      expect(done.errorCode).toBe('missing_image_output');
      expect(done.outputs ?? []).toEqual([]);
    } finally {
      await closeTestService(service);
    }
  });

  it('stores binary audio output without a second paid submit', async () => {
    const { service, token, provider } = await authService(
      new FakeGenerationProvider(),
    );
    try {
      const created = await postJob(service, token, {
        draft: imageDraft({
          clientRequestId: 'audio-1',
          operation: 'speech',
          modelId: 'fixture/speech',
          parameters: {},
        }),
      });
      const id = (created.json() as JobReceipt).id;
      const done = await runUntilTerminal(service, token, id);
      expect(done.providerState).toBe('completed');
      expect(done.outputs?.[0]?.sha256).toBe(digest(FIXTURE_AUDIO));
      expect(provider.submits).toBe(1);
    } finally {
      await closeTestService(service);
    }
  });

  it('keeps input leases while a job is active and records duration estimates', async () => {
    const { service, token } = await authService(new FakeGenerationProvider());
    try {
      const bytes = FIXTURE_PNG;
      const createdTransfer = await service.app.inject({
        method: 'POST',
        url: '/studio-api/transfers',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          sha256: digest(bytes),
          bytes: bytes.byteLength,
          mime: 'image/png',
          purpose: 'reference',
        },
      });
      const transferId = (createdTransfer.json() as { transferId: string })
        .transferId;
      await service.app.inject({
        method: 'PUT',
        url: `/studio-api/transfers/${transferId}/parts/0`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/octet-stream',
        },
        payload: Buffer.from(bytes),
      });
      await service.app.inject({
        method: 'POST',
        url: `/studio-api/transfers/${transferId}/finalize`,
        headers: { authorization: `Bearer ${token}` },
      });
      const created = await postJob(service, token, {
        draft: imageDraft({
          parameters: { n: 1, duration: 5 },
          references: [
            {
              assetRevisionId: 'rev-1',
              role: 'identity',
              ordinal: 0,
            },
          ],
        }),
        transferIds: [transferId],
      });
      expect(created.statusCode).toBe(201);
      const receipt = created.json() as JobReceipt & {
        cost?: { state: string; durationSeconds?: number };
      };
      expect(receipt.cost?.state).toBe('reservation');
      expect(receipt.cost?.durationSeconds).toBe(5);

      service.advanceNow?.(8 * 24 * 60 * 60 * 1000);
      const stillThere = await service.app.inject({
        method: 'GET',
        url: `/studio-api/transfers/${transferId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(stillThere.statusCode).toBe(200);
      expect((stillThere.json() as { state: string }).state).toBe('finalized');
    } finally {
      await closeTestService(service);
    }
  });

  it('cancels queued work and forbids cancel after dispatch', async () => {
    const { service, token, provider } = await authService(
      new FakeGenerationProvider(),
    );
    try {
      const created = await postJob(service, token, { draft: imageDraft() });
      const id = (created.json() as JobReceipt).id;
      const cancelled = await service.app.inject({
        method: 'POST',
        url: `/studio-api/jobs/${id}/cancel`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(cancelled.statusCode).toBe(200);
      expect((cancelled.json() as JobReceipt).providerState).toBe('cancelled');
      expect(provider.submits).toBe(0);

      const running = await postJob(service, token, {
        draft: imageDraft({ clientRequestId: 'client-req-2' }),
      });
      const runningId = (running.json() as JobReceipt).id;
      await service.processJobs();
      const late = await service.app.inject({
        method: 'POST',
        url: `/studio-api/jobs/${runningId}/cancel`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(late.statusCode).toBe(409);
      expect(late.json()).toEqual({ error: 'cancel_not_allowed' });
    } finally {
      await closeTestService(service);
    }
  });

  it('links an approved retry of an ambiguous job and records final cost', async () => {
    const provider = new FakeGenerationProvider();
    provider.crashAfterSubmit = true;
    const { service, token } = await authService(provider);
    try {
      const created = await postJob(service, token, {
        draft: imageDraft({
          operation: 'video-generate',
          modelId: 'fixture/video',
          parameters: { duration: 5 },
        }),
      });
      const originalId = (created.json() as JobReceipt).id;
      await service.processJobs();
      service.advanceNow?.(31_000);
      await service.processJobs();
      const unknown = await getJob(service, token, originalId);
      expect(unknown.body.providerState).toBe('submission-unknown');

      provider.crashAfterSubmit = false;
      const retry = await postJob(service, token, {
        draft: imageDraft({
          clientRequestId: 'client-req-retry',
          operation: 'video-generate',
          modelId: 'fixture/video',
          parameters: { duration: 5 },
        }),
        retryOfJobId: originalId,
      });
      expect(retry.statusCode).toBe(201);
      const retryReceipt = retry.json() as JobReceipt & {
        originalJobId?: string;
      };
      expect(retryReceipt.originalJobId).toBe(originalId);
      expect(retryReceipt.clientRequestId).toBe('client-req-retry');
      const done = await runUntilTerminal(service, token, retryReceipt.id);
      expect(done.providerState).toBe('completed');
      expect(done.cost?.state).toBe('final');
      expect(done.cost?.amount).toBe(0.12);
    } finally {
      await closeTestService(service);
    }
  });

  it('reconciles verified local hashes without a new paid generation', async () => {
    const { service, token, provider } = await authService(
      new FakeGenerationProvider(),
    );
    const library = await openTestLibrary();
    try {
      const created = await postJob(service, token, { draft: imageDraft() });
      const id = (created.json() as JobReceipt).id;
      const done = await runUntilTerminal(service, token, id);
      const hashes = (done.outputs ?? []).map((item) => item.sha256);
      expect(hashes).toHaveLength(2);

      for (const output of done.outputs ?? []) {
        const download = await service.app.inject({
          method: 'GET',
          url: `/studio-api/jobs/${id}/outputs/${output.ordinal}`,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(download.statusCode).toBe(200);
        const bytes = download.rawPayload;
        const imported = await library.library.importMedia({
          kind: 'stream',
          handle: bytes,
          name: `job-${output.ordinal}.png`,
          mime: 'image/png',
        });
        expect(imported.sha256).toBe(output.sha256);
      }

      const ack = await service.app.inject({
        method: 'POST',
        url: `/studio-api/jobs/${id}/acknowledge`,
        headers: { authorization: `Bearer ${token}` },
        payload: { hashes },
      });
      expect(ack.statusCode).toBe(200);
      expect((ack.json() as JobReceipt).saveState).toBe('saved');

      const ackAgain = await service.app.inject({
        method: 'POST',
        url: `/studio-api/jobs/${id}/acknowledge`,
        headers: { authorization: `Bearer ${token}` },
        payload: { hashes },
      });
      expect(ackAgain.statusCode).toBe(200);
      expect(provider.submits).toBe(1);
    } finally {
      await library.close();
      await closeTestService(service);
    }
  });

  it('resumes a running fake-provider job across service restart with stable hashes', async () => {
    const provider = new FakeGenerationProvider();
    const first = await openTestService({
      provider,
      autoProcessJobs: false,
      jobLeaseMs: 30_000,
    });
    await setupOwner(first);
    const { token } = await loginNative(first);
    await first.app.inject({
      method: 'PUT',
      url: '/studio-api/provider-key',
      headers: { authorization: `Bearer ${token}` },
      payload: { apiKey: 'sk-test-jobs-key-1234' },
    });
    const created = await first.app.inject({
      method: 'POST',
      url: '/studio-api/jobs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        draft: imageDraft({
          operation: 'video-generate',
          modelId: 'fixture/video',
          parameters: { duration: 5 },
        }),
      },
    });
    const id = (created.json() as JobReceipt).id;
    await first.processJobs();
    const mid = await first.app.inject({
      method: 'GET',
      url: `/studio-api/jobs/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect((mid.json() as JobReceipt).providerState).toBe('running');
    expect((mid.json() as JobReceipt).providerRunId).toBe('video-run-1');
    await first.app.close();
    first.db.close();

    const restarted = await buildApp({
      dbPath: join(first.dir, 'service.sqlite'),
      stagingDir: join(first.dir, 'staging'),
      setupToken: 'setup-secret-token',
      masterKey: first.masterKey,
      publicOrigin: first.origin,
      quotaBytes: 1024 * 1024,
      cookieSecure: false,
      validateProviderKey: async () => ({ ok: true }),
      provider,
      autoProcessJobs: false,
      jobLeaseMs: 30_000,
    });
    try {
      await restarted.processJobs();
      const done = await restarted.app.inject({
        method: 'GET',
        url: `/studio-api/jobs/${id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      const body = done.json() as JobReceipt & {
        outputs?: Array<{ sha256: string }>;
      };
      expect(body.providerState).toBe('completed');
      expect(body.providerRunId).toBe('video-run-1');
      expect(body.outputs?.[0]?.sha256).toBe(digest(FIXTURE_PNG));
      expect(provider.submits).toBe(1);

      const listed = await restarted.app.inject({
        method: 'GET',
        url: '/studio-api/jobs',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(listed.statusCode).toBe(200);
      const page = listed.json() as { jobs: JobReceipt[] };
      expect(page.jobs.some((job) => job.id === id)).toBe(true);
    } finally {
      await restarted.close();
      await rm(first.dir, { recursive: true, force: true });
    }
  });
});
