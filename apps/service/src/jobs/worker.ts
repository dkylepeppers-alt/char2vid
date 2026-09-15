import type { DatabaseSync } from 'node:sqlite';
import type {
  GenerationDraft,
  Operation,
  PreparedInput,
} from '@char2vid/domain';
import {
  AUDIO_OUTPUT_ADAPTER_VERSION,
  buildRequest,
  IMAGE_OUTPUT_ADAPTER_VERSION,
  normalizeAudioOutput,
  normalizeImageOutput,
  normalizeVideoStatus,
  VIDEO_STATUS_ADAPTER_VERSION,
  type NanoGptModelDescriptor,
} from '@char2vid/nanogpt';

import { decryptProviderKey } from '../auth/credentials.ts';
import { HttpError } from '../http-error.ts';
import { signMediaAccess } from '../transfers/signed-inputs.ts';
import { getTransfer } from '../transfers/store.ts';
import { applyProviderCost } from './costs.ts';
import type { GenerationProvider, ProviderSubmitResult } from './provider.ts';
import {
  claimQueuedJob,
  failJob,
  getJob,
  listDueRunning,
  markRunning,
  markSubmitting,
  recoverExpiredLeases,
  saveOutputs,
  schedulePoll,
  type JobRecord,
} from './repository.ts';
import {
  decodeBase64,
  sha256Hex,
  validateOutputBytes,
  writeOutputFile,
} from './staging.ts';

const MAX_POLLS = 40;
const SIGN_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface WorkerEnv {
  db: DatabaseSync;
  stagingDir: string;
  masterKey: Buffer;
  publicOrigin: string;
  provider: GenerationProvider;
  now: () => Date;
  jobLeaseMs: number;
  workerId: string;
  maxOwnerConcurrency: number;
}

function catalogFor(operation: Operation): NanoGptModelDescriptor['catalog'] {
  if (operation.startsWith('video')) return 'video';
  if (
    operation === 'speech' ||
    operation === 'music' ||
    operation === 'sound-effect' ||
    operation === 'transcribe' ||
    operation === 'voice-clone'
  ) {
    return 'audio';
  }
  if (operation === 'text') return 'text';
  return 'image';
}

function stubModel(draft: GenerationDraft): NanoGptModelDescriptor {
  return {
    id: draft.modelId,
    catalog: catalogFor(draft.operation),
    fetchedAt: '1970-01-01T00:00:00.000Z',
    raw: { id: draft.modelId },
    operations: [draft.operation],
    verification: 'metadata',
    displayName: draft.modelId,
    capabilities: {},
    controls: [],
    limits: { raw: {} },
    issues: [],
  };
}

function loadApiKey(
  db: DatabaseSync,
  masterKey: Buffer,
  ownerId: string,
): string | undefined {
  const row = db
    .prepare(`SELECT ciphertext, nonce FROM provider_keys WHERE owner_id = ?`)
    .get(ownerId) as { ciphertext: Buffer; nonce: Buffer } | undefined;
  if (!row) {
    return undefined;
  }
  return decryptProviderKey(masterKey, ownerId, row.ciphertext, row.nonce);
}

function preparedInputs(env: WorkerEnv, job: JobRecord): PreparedInput[] {
  const nowUnix = Math.floor(env.now().getTime() / 1000);
  return job.draft.references.map((binding, index) => {
    const transferId = job.transferIds[index];
    if (!transferId) {
      throw new HttpError(400, 'missing_input_lease');
    }
    const transfer = getTransfer(env.db, job.ownerId, transferId);
    const exp = nowUnix + SIGN_TTL_SECONDS;
    const signature = signMediaAccess(env.masterKey, transferId, exp);
    const url = `${env.publicOrigin}/studio-media/${transferId}?signature=${signature}&exp=${exp}`;
    return {
      binding,
      sha256: transfer.sha256,
      mime: transfer.mime,
      bytes: transfer.bytes,
      source: { type: 'https', url },
    };
  });
}

function mimeForOperation(operation: Operation, fallback: string): string {
  if (operation.startsWith('video')) return 'video/mp4';
  if (
    operation === 'speech' ||
    operation === 'music' ||
    operation === 'sound-effect'
  ) {
    return fallback.startsWith('audio/') ? fallback : 'audio/mpeg';
  }
  return fallback.startsWith('image/') ? fallback : 'image/png';
}

function persistBytes(
  env: WorkerEnv,
  jobId: string,
  ordinal: number,
  bytes: Uint8Array,
  mime: string,
): { ordinal: number; sha256: string; mime: string; bytes: number } {
  validateOutputBytes(bytes, mime);
  writeOutputFile(env.stagingDir, jobId, ordinal, bytes);
  return {
    ordinal,
    sha256: sha256Hex(bytes),
    mime,
    bytes: bytes.byteLength,
  };
}

async function captureImage(
  env: WorkerEnv,
  job: JobRecord,
  body: unknown,
): Promise<void> {
  const normalized = normalizeImageOutput(body);
  const stored = [];
  for (const item of normalized.items) {
    let bytes: Uint8Array;
    let mime = 'image/png';
    if (item.url) {
      const downloaded = await env.provider.fetchOutput(item.url);
      bytes = downloaded.bytes;
      mime = downloaded.mime || mime;
    } else if (item.base64) {
      bytes = decodeBase64(item.base64);
    } else {
      throw new Error('missing_image_output');
    }
    stored.push(
      persistBytes(
        env,
        job.id,
        item.ordinal,
        bytes,
        mimeForOperation(job.operation, mime),
      ),
    );
  }
  saveOutputs(
    env.db,
    job.id,
    stored,
    env.now().toISOString(),
    applyProviderCost(job.cost, normalized.cost),
    IMAGE_OUTPUT_ADAPTER_VERSION,
  );
}

async function captureAudio(
  env: WorkerEnv,
  job: JobRecord,
  result: {
    status: number;
    contentType: string;
    json?: unknown;
    bytes?: Uint8Array;
  },
): Promise<void> {
  const normalized = normalizeAudioOutput(
    result.status,
    result.json ?? result.bytes,
    result.contentType,
    result.bytes,
  );
  if (normalized.kind === 'ticket') {
    markRunning(
      env.db,
      job.id,
      {
        runId: normalized.runId,
        raw: normalized.rawTicket,
        adapterVersion: AUDIO_OUTPUT_ADAPTER_VERSION,
        cost: normalized.cost,
      },
      env.now(),
    );
    return;
  }
  let bytes: Uint8Array;
  let mime = 'audio/mpeg';
  if (normalized.kind === 'binary') {
    bytes = normalized.bytes;
    mime = normalized.mime;
  } else {
    const downloaded = await env.provider.fetchOutput(normalized.url);
    bytes = downloaded.bytes;
    mime = downloaded.mime || mime;
  }
  const stored = [
    persistBytes(
      env,
      job.id,
      0,
      bytes,
      mimeForOperation(job.operation, mime),
    ),
  ];
  saveOutputs(
    env.db,
    job.id,
    stored,
    env.now().toISOString(),
    applyProviderCost(
      job.cost,
      normalized.kind === 'url' ? normalized.cost : undefined,
    ),
    AUDIO_OUTPUT_ADAPTER_VERSION,
  );
}

async function captureVideo(
  env: WorkerEnv,
  job: JobRecord,
  body: unknown,
): Promise<void> {
  const normalized = normalizeVideoStatus(body);
  if (normalized.state === 'running' || normalized.state === 'queued') {
    const delay = Math.min(30_000, 500 * 2 ** job.pollCount);
    schedulePoll(
      env.db,
      job.id,
      new Date(env.now().getTime() + delay).toISOString(),
      job.pollCount + 1,
      env.now().toISOString(),
    );
    return;
  }
  if (normalized.state === 'failed' || normalized.state === 'cancelled') {
    failJob(env.db, job.id, normalized.error ?? normalized.state, env.now());
    return;
  }
  if (normalized.state !== 'completed' || !normalized.outputUrl) {
    throw new Error('missing_video_output');
  }
  const downloaded = await env.provider.fetchOutput(normalized.outputUrl);
  const stored = [
    persistBytes(
      env,
      job.id,
      0,
      downloaded.bytes,
      mimeForOperation(job.operation, downloaded.mime || 'video/mp4'),
    ),
  ];
  saveOutputs(
    env.db,
    job.id,
    stored,
    env.now().toISOString(),
    applyProviderCost(job.cost, normalized.cost),
    VIDEO_STATUS_ADAPTER_VERSION,
  );
}

async function dispatchJob(env: WorkerEnv, claimed: JobRecord): Promise<void> {
  const submitting = markSubmitting(
    env.db,
    claimed.id,
    env.workerId,
    env.now(),
    env.jobLeaseMs,
  );
  if (!submitting) {
    return;
  }
  const apiKey = loadApiKey(env.db, env.masterKey, submitting.ownerId);
  if (!apiKey) {
    failJob(env.db, submitting.id, 'provider_key_missing', env.now());
    return;
  }
  const inputs = preparedInputs(env, submitting);
  const built = buildRequest(
    submitting.draft,
    stubModel(submitting.draft),
    inputs,
  );
  if (
    !built.request ||
    built.issues.some((issue) => issue.severity === 'blocking')
  ) {
    failJob(
      env.db,
      submitting.id,
      built.issues[0]?.code ?? 'invalid_request',
      env.now(),
    );
    return;
  }
  let result: ProviderSubmitResult;
  try {
    result = await env.provider.submit({
      url: built.request.url,
      method: built.request.method,
      body: built.request.body,
      apiKey,
      operation: submitting.operation,
    });
  } catch {
    return;
  }
  try {
    if (result.status >= 400 && result.status !== 429) {
      failJob(env.db, submitting.id, `provider_${result.status}`, env.now());
      return;
    }
    if (result.status === 429) {
      failJob(env.db, submitting.id, 'provider_rate_limited', env.now());
      return;
    }
    if (
      submitting.operation === 'image-generate' ||
      submitting.operation === 'image-edit' ||
      submitting.operation === 'image-utility'
    ) {
      await captureImage(env, submitting, result.json ?? {});
      return;
    }
    if (submitting.operation === 'speech' || submitting.operation === 'music') {
      await captureAudio(env, submitting, result);
      return;
    }
    if (submitting.operation.startsWith('video')) {
      const ticket = (result.json ?? {}) as Record<string, unknown>;
      const runId =
        typeof ticket.runId === 'string'
          ? ticket.runId
          : typeof ticket.id === 'string'
            ? ticket.id
            : undefined;
      if (!runId) {
        failJob(env.db, submitting.id, 'missing_provider_run_id', env.now());
        return;
      }
      markRunning(
        env.db,
        submitting.id,
        {
          runId,
          raw: ticket,
          adapterVersion: VIDEO_STATUS_ADAPTER_VERSION,
          cost: ticket.cost,
        },
        env.now(),
      );
      return;
    }
    failJob(env.db, submitting.id, 'unsupported_operation', env.now());
  } catch (error) {
    const code =
      error instanceof HttpError
        ? error.code
        : error instanceof Error
          ? error.message
          : 'capture_failed';
    failJob(env.db, submitting.id, code, env.now());
  }
}

async function pollJob(env: WorkerEnv, job: JobRecord): Promise<void> {
  if (job.pollCount >= MAX_POLLS) {
    failJob(env.db, job.id, 'poll_exhausted', env.now());
    return;
  }
  const apiKey = loadApiKey(env.db, env.masterKey, job.ownerId);
  if (!apiKey || !job.providerRunId) {
    failJob(env.db, job.id, 'recovery_required', env.now());
    return;
  }
  const body = await env.provider.status({
    runId: job.providerRunId,
    apiKey,
    operation: job.operation,
  });
  await captureVideo(env, job, body);
}

export async function processJobs(env: WorkerEnv): Promise<void> {
  recoverExpiredLeases(env.db, env.now());
  const due = listDueRunning(env.db, env.now().toISOString());
  for (const job of due) {
    try {
      await pollJob(env, job);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'poll_failed';
      if (
        code === 'missing_video_output' ||
        code === 'unsupported_video_envelope'
      ) {
        failJob(env.db, job.id, code, env.now());
      }
    }
  }
  for (;;) {
    const claimed = claimQueuedJob(
      env.db,
      env.workerId,
      env.now(),
      env.jobLeaseMs,
      env.maxOwnerConcurrency,
    );
    if (!claimed) {
      break;
    }
    try {
      await dispatchJob(env, claimed);
    } catch {
      const current = getJob(env.db, claimed.id);
      if (current?.providerState === 'submitting') {
        // Leave submitting so lease expiry becomes submission-unknown.
        continue;
      }
    }
  }
}
