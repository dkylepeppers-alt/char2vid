import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  GenerationDraft,
  JobReceipt,
  Operation,
  ProviderState,
  SaveState,
} from '@char2vid/domain';
import { freezeRequest } from '@char2vid/domain/generation/request-snapshot';

import { HttpError } from '../http-error.ts';
import { sha256Hex } from '../transfers/signed-inputs.ts';
import { getTransfer } from '../transfers/store.ts';
import {
  applyProviderCost,
  initialJobCost,
  parseCostJson,
  reserveJobCost,
  type CostRecord,
} from './costs.ts';
import { readOutputFile } from './staging.ts';

export const DEFAULT_JOB_LEASE_MS = 30_000;
export const DEFAULT_OWNER_CONCURRENCY = 2;
export const TERMINAL_INPUT_TTL_MS = 24 * 60 * 60 * 1000;

export interface JobRecord {
  id: string;
  ownerId: string;
  clientRequestId: string;
  requestHash: string;
  operation: Operation;
  modelId: string;
  prompt: string;
  draft: GenerationDraft;
  providerState: ProviderState;
  saveState: SaveState;
  providerRunId?: string;
  errorCode?: string;
  leaseOwner?: string;
  leaseUntil?: string;
  nextAttemptAt?: string;
  pollCount: number;
  cost: CostRecord;
  originalJobId?: string;
  providerTicket?: unknown;
  statusAdapterVersion?: string;
  createdAt: string;
  updatedAt: string;
  transferIds: string[];
}

interface JobRow {
  id: string;
  owner_id: string;
  client_request_id: string;
  request_hash: string;
  operation: string;
  model_id: string;
  prompt: string;
  draft_json: string;
  provider_state: ProviderState;
  save_state: SaveState;
  provider_run_id: string | null;
  error_code: string | null;
  lease_owner: string | null;
  lease_until: string | null;
  next_attempt_at: string | null;
  poll_count: number;
  cost_json: string;
  original_job_id: string | null;
  provider_ticket_json: string | null;
  status_adapter_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobOutputRecord {
  ordinal: number;
  sha256: string;
  mime: string;
  bytes: number;
  acknowledgedAt?: string;
}

function canonicalRequestHash(draft: GenerationDraft): string {
  return freezeRequest(draft, { id: draft.modelId }, draft.references)
    .requestHash;
}

function parseDraft(raw: string): GenerationDraft {
  return JSON.parse(raw) as GenerationDraft;
}

function asRecord(row: JobRow, db: DatabaseSync): JobRecord {
  const transferIds = db
    .prepare(
      `SELECT transfer_id FROM job_input_leases WHERE job_id = ? ORDER BY transfer_id`,
    )
    .all(row.id) as { transfer_id: string }[];
  return {
    id: row.id,
    ownerId: row.owner_id,
    clientRequestId: row.client_request_id,
    requestHash: row.request_hash,
    operation: row.operation as Operation,
    modelId: row.model_id,
    prompt: row.prompt,
    draft: parseDraft(row.draft_json),
    providerState: row.provider_state,
    saveState: row.save_state,
    providerRunId: row.provider_run_id ?? undefined,
    errorCode: row.error_code ?? undefined,
    leaseOwner: row.lease_owner ?? undefined,
    leaseUntil: row.lease_until ?? undefined,
    nextAttemptAt: row.next_attempt_at ?? undefined,
    pollCount: Number(row.poll_count),
    cost: parseCostJson(row.cost_json),
    originalJobId: row.original_job_id ?? undefined,
    providerTicket: row.provider_ticket_json
      ? (JSON.parse(row.provider_ticket_json) as unknown)
      : undefined,
    statusAdapterVersion: row.status_adapter_version ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    transferIds: transferIds.map((item) => item.transfer_id),
  };
}

function getRow(db: DatabaseSync, id: string): JobRow | undefined {
  return db
    .prepare(
      `SELECT id, owner_id, client_request_id, request_hash, operation, model_id,
              prompt, draft_json, provider_state, save_state, provider_run_id,
              error_code, lease_owner, lease_until, next_attempt_at, poll_count,
              cost_json, original_job_id, provider_ticket_json,
              status_adapter_version, created_at, updated_at
       FROM jobs WHERE id = ?`,
    )
    .get(id) as JobRow | undefined;
}

export function getJob(db: DatabaseSync, id: string): JobRecord | undefined {
  const row = getRow(db, id);
  return row ? asRecord(row, db) : undefined;
}

export function getJobForOwner(
  db: DatabaseSync,
  ownerId: string,
  id: string,
): JobRecord {
  const job = getJob(db, id);
  if (!job || job.ownerId !== ownerId) {
    throw new HttpError(404, 'job_not_found');
  }
  return job;
}

export function listOutputs(
  db: DatabaseSync,
  jobId: string,
): JobOutputRecord[] {
  return (
    db
      .prepare(
        `SELECT ordinal, sha256, mime, bytes, acknowledged_at
         FROM job_outputs WHERE job_id = ? ORDER BY ordinal`,
      )
      .all(jobId) as {
      ordinal: number;
      sha256: string;
      mime: string;
      bytes: number;
      acknowledged_at: string | null;
    }[]
  ).map((row) => ({
    ordinal: Number(row.ordinal),
    sha256: row.sha256,
    mime: row.mime,
    bytes: Number(row.bytes),
    acknowledgedAt: row.acknowledged_at ?? undefined,
  }));
}

export function toReceipt(
  db: DatabaseSync,
  job: JobRecord,
): JobReceipt & {
  cost: CostRecord;
  originalJobId?: string;
  outputs: JobOutputRecord[];
  updatedAt: string;
} {
  const outputs = listOutputs(db, job.id);
  return {
    id: job.id,
    clientRequestId: job.clientRequestId,
    providerRunId: job.providerRunId,
    providerState: job.providerState,
    saveState: job.saveState,
    outputRevisionIds: outputs.map(
      (item) => `${job.id}:${item.ordinal}:${item.sha256}`,
    ),
    errorCode: job.errorCode,
    characterSlot: job.draft.characterSlot,
    cost: job.cost,
    originalJobId: job.originalJobId,
    outputs,
    updatedAt: job.updatedAt,
  };
}

function bindTransfers(
  db: DatabaseSync,
  ownerId: string,
  jobId: string,
  transferIds: string[],
  nowIso: string,
): void {
  for (const transferId of transferIds) {
    const transfer = getTransfer(db, ownerId, transferId);
    if (transfer.state !== 'finalized') {
      throw new HttpError(409, 'transfer_not_finalized');
    }
    db.prepare(
      `INSERT INTO job_input_leases (job_id, transfer_id, bound_at)
       VALUES (?, ?, ?)`,
    ).run(jobId, transferId, nowIso);
  }
}

export function protectedTransferIds(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare(
      `SELECT l.transfer_id AS id
       FROM job_input_leases l
       INNER JOIN jobs j ON j.id = l.job_id
       WHERE j.provider_state NOT IN ('completed', 'failed', 'cancelled')`,
    )
    .all() as { id: string }[];
  return new Set(rows.map((row) => row.id));
}

function touchTerminalInputs(db: DatabaseSync, jobId: string, now: Date): void {
  const expires = new Date(now.getTime() + TERMINAL_INPUT_TTL_MS).toISOString();
  const rows = db
    .prepare(`SELECT transfer_id FROM job_input_leases WHERE job_id = ?`)
    .all(jobId) as { transfer_id: string }[];
  for (const row of rows) {
    db.prepare(
      `UPDATE transfers SET expires_at = ? WHERE id = ? AND state = 'finalized'`,
    ).run(expires, row.transfer_id);
  }
}

export function submitJob(
  db: DatabaseSync,
  ownerId: string,
  draft: GenerationDraft,
  transferIds: string[],
  now: Date,
  retryOfJobId?: string,
): { receipt: ReturnType<typeof toReceipt>; created: boolean } {
  if (!draft.clientRequestId?.trim()) {
    throw new HttpError(400, 'client_request_id_required');
  }
  if (!draft.modelId?.trim() || !draft.operation) {
    throw new HttpError(400, 'invalid_draft');
  }
  if (!Array.isArray(draft.references)) {
    throw new HttpError(400, 'invalid_draft');
  }
  if (transferIds.length !== draft.references.length) {
    throw new HttpError(400, 'transfer_reference_mismatch');
  }
  const hash = canonicalRequestHash(draft);
  const existing = db
    .prepare(`SELECT id FROM jobs WHERE owner_id = ? AND client_request_id = ?`)
    .get(ownerId, draft.clientRequestId) as { id: string } | undefined;
  if (existing) {
    const job = getJob(db, existing.id);
    if (!job) {
      throw new HttpError(500, 'job_missing');
    }
    if (job.requestHash !== hash) {
      throw new HttpError(409, 'client_request_conflict');
    }
    return { receipt: toReceipt(db, job), created: false };
  }
  if (retryOfJobId) {
    const original = getJobForOwner(db, ownerId, retryOfJobId);
    if (
      original.providerState !== 'submission-unknown' &&
      original.providerState !== 'recovery-required'
    ) {
      throw new HttpError(409, 'retry_not_allowed');
    }
    if (original.clientRequestId === draft.clientRequestId) {
      throw new HttpError(409, 'retry_requires_new_client_request_id');
    }
  }
  const id = randomBytes(16).toString('hex');
  const nowIso = now.toISOString();
  const cost = initialJobCost(draft);
  try {
    db.exec('BEGIN IMMEDIATE');
    db.prepare(
      `INSERT INTO jobs (
         id, owner_id, client_request_id, request_hash, operation, model_id,
         prompt, draft_json, provider_state, save_state, provider_run_id,
         error_code, lease_owner, lease_until, next_attempt_at, poll_count,
         cost_json, original_job_id, provider_ticket_json,
         status_adapter_version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'absent', NULL, NULL, NULL,
                 NULL, ?, 0, ?, ?, NULL, NULL, ?, ?)`,
    ).run(
      id,
      ownerId,
      draft.clientRequestId,
      hash,
      draft.operation,
      draft.modelId,
      draft.prompt,
      JSON.stringify(draft),
      nowIso,
      JSON.stringify(cost),
      retryOfJobId ?? null,
      nowIso,
      nowIso,
    );
    bindTransfers(db, ownerId, id, transferIds, nowIso);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // already rolled back
    }
    const raced = db
      .prepare(
        `SELECT id FROM jobs WHERE owner_id = ? AND client_request_id = ?`,
      )
      .get(ownerId, draft.clientRequestId) as { id: string } | undefined;
    if (raced) {
      const job = getJob(db, raced.id);
      if (job && job.requestHash === hash) {
        return { receipt: toReceipt(db, job), created: false };
      }
      throw new HttpError(409, 'client_request_conflict');
    }
    if (error instanceof HttpError) {
      throw error;
    }
    throw error;
  }
  const job = getJob(db, id);
  if (!job) {
    throw new HttpError(500, 'job_missing');
  }
  return { receipt: toReceipt(db, job), created: true };
}

export function claimQueuedJob(
  db: DatabaseSync,
  workerId: string,
  now: Date,
  leaseMs: number,
  concurrency = DEFAULT_OWNER_CONCURRENCY,
): JobRecord | undefined {
  const nowIso = now.toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db
      .prepare(
        `SELECT id FROM jobs
         WHERE provider_state = 'queued'
           AND (lease_until IS NULL OR lease_until <= ?)
           AND (
             SELECT COUNT(*) FROM jobs active
             WHERE active.owner_id = jobs.owner_id
               AND active.provider_state IN ('submitting', 'running')
           ) < ?
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
      )
      .get(nowIso, concurrency) as { id: string } | undefined;
    if (!row) {
      db.exec('COMMIT');
      return undefined;
    }
    const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
    const result = db
      .prepare(
        `UPDATE jobs
         SET lease_owner = ?, lease_until = ?, updated_at = ?
         WHERE id = ?
           AND provider_state = 'queued'
           AND (lease_until IS NULL OR lease_until <= ?)`,
      )
      .run(workerId, leaseUntil, nowIso, row.id, nowIso);
    db.exec('COMMIT');
    if (Number(result.changes) !== 1) {
      return undefined;
    }
    return getJob(db, row.id);
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  }
}

export function markSubmitting(
  db: DatabaseSync,
  jobId: string,
  workerId: string,
  now: Date,
  leaseMs: number,
): JobRecord | undefined {
  const job = getJob(db, jobId);
  if (!job) {
    return undefined;
  }
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
  const result = db
    .prepare(
      `UPDATE jobs
       SET provider_state = 'submitting',
           lease_owner = ?,
           lease_until = ?,
           cost_json = ?,
           updated_at = ?
       WHERE id = ?
         AND provider_state = 'queued'
         AND lease_owner = ?`,
    )
    .run(
      workerId,
      leaseUntil,
      JSON.stringify(reserveJobCost(job.cost)),
      nowIso,
      jobId,
      workerId,
    );
  if (Number(result.changes) !== 1) {
    return undefined;
  }
  return getJob(db, jobId);
}

export function markRunning(
  db: DatabaseSync,
  jobId: string,
  ticket: {
    runId: string;
    raw: unknown;
    adapterVersion: string;
    cost?: unknown;
  },
  now: Date,
): JobRecord {
  const job = getJob(db, jobId);
  if (!job) {
    throw new HttpError(404, 'job_not_found');
  }
  const cost = applyProviderCost(job.cost, ticket.cost);
  const nowIso = now.toISOString();
  db.prepare(
    `UPDATE jobs
     SET provider_state = 'running',
         provider_run_id = ?,
         provider_ticket_json = ?,
         status_adapter_version = ?,
         cost_json = ?,
         next_attempt_at = ?,
         poll_count = 0,
         lease_owner = NULL,
         lease_until = NULL,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    ticket.runId,
    JSON.stringify(ticket.raw),
    ticket.adapterVersion,
    JSON.stringify(cost),
    nowIso,
    nowIso,
    jobId,
  );
  const updated = getJob(db, jobId);
  if (!updated) {
    throw new HttpError(500, 'job_missing');
  }
  return updated;
}

export function saveOutputs(
  db: DatabaseSync,
  jobId: string,
  outputs: Array<{
    ordinal: number;
    sha256: string;
    mime: string;
    bytes: number;
  }>,
  nowIso: string,
  cost?: CostRecord,
  adapterVersion?: string,
): void {
  db.prepare(`DELETE FROM job_outputs WHERE job_id = ?`).run(jobId);
  for (const output of outputs) {
    db.prepare(
      `INSERT INTO job_outputs (job_id, ordinal, sha256, mime, bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      jobId,
      output.ordinal,
      output.sha256,
      output.mime,
      output.bytes,
      nowIso,
    );
  }
  db.prepare(
    `UPDATE jobs
     SET provider_state = 'completed',
         save_state = 'absent',
         cost_json = COALESCE(?, cost_json),
         status_adapter_version = COALESCE(?, status_adapter_version),
         lease_owner = NULL,
         lease_until = NULL,
         next_attempt_at = NULL,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    cost ? JSON.stringify(cost) : null,
    adapterVersion ?? null,
    nowIso,
    jobId,
  );
  touchTerminalInputs(db, jobId, new Date(nowIso));
}

export function failJob(
  db: DatabaseSync,
  jobId: string,
  errorCode: string,
  now: Date,
  saveFailed = false,
): void {
  const job = getJob(db, jobId);
  const nowIso = now.toISOString();
  const cost =
    job && (job.cost.state === 'reservation' || job.cost.state === 'final')
      ? applyProviderCost(job.cost, job.cost.amount, true)
      : job?.cost;
  db.prepare(
    `UPDATE jobs
     SET provider_state = 'failed',
         save_state = ?,
         error_code = ?,
         cost_json = COALESCE(?, cost_json),
         lease_owner = NULL,
         lease_until = NULL,
         next_attempt_at = NULL,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    saveFailed ? 'failed' : 'absent',
    errorCode,
    cost ? JSON.stringify(cost) : null,
    nowIso,
    jobId,
  );
  touchTerminalInputs(db, jobId, now);
}

export function requireJobRecovery(
  db: DatabaseSync,
  jobId: string,
  errorCode: string,
  now: Date,
): void {
  markJobState(db, jobId, 'recovery-required', now, errorCode);
}

export function markSaveProgress(
  db: DatabaseSync,
  ownerId: string,
  jobId: string,
  saveState: Extract<SaveState, 'downloading' | 'verifying' | 'failed'>,
  now: Date,
): JobRecord {
  const job = getJobForOwner(db, ownerId, jobId);
  if (job.providerState !== 'completed' || job.saveState === 'saved') {
    throw new HttpError(409, 'save_progress_not_allowed');
  }
  const nowIso = now.toISOString();
  db.prepare(`UPDATE jobs SET save_state = ?, updated_at = ? WHERE id = ?`).run(
    saveState,
    nowIso,
    jobId,
  );
  const updated = getJob(db, jobId);
  if (!updated) {
    throw new HttpError(500, 'job_missing');
  }
  return updated;
}

export function claimDueRunning(
  db: DatabaseSync,
  workerId: string,
  now: Date,
  leaseMs: number,
): JobRecord | undefined {
  const nowIso = now.toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db
      .prepare(
        `SELECT id FROM jobs
         WHERE provider_state = 'running'
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           AND (lease_until IS NULL OR lease_until <= ?)
         ORDER BY next_attempt_at ASC, id ASC
         LIMIT 1`,
      )
      .get(nowIso, nowIso) as { id: string } | undefined;
    if (!row) {
      db.exec('COMMIT');
      return undefined;
    }
    const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
    const result = db
      .prepare(
        `UPDATE jobs
         SET lease_owner = ?, lease_until = ?, updated_at = ?
         WHERE id = ?
           AND provider_state = 'running'
           AND (lease_until IS NULL OR lease_until <= ?)`,
      )
      .run(workerId, leaseUntil, nowIso, row.id, nowIso);
    db.exec('COMMIT');
    if (Number(result.changes) !== 1) {
      return undefined;
    }
    return getJob(db, row.id);
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  }
}

export function markJobState(
  db: DatabaseSync,
  jobId: string,
  providerState: ProviderState,
  now: Date,
  errorCode?: string,
): void {
  const nowIso = now.toISOString();
  db.prepare(
    `UPDATE jobs
     SET provider_state = ?,
         error_code = COALESCE(?, error_code),
         lease_owner = NULL,
         lease_until = NULL,
         updated_at = ?
     WHERE id = ?`,
  ).run(providerState, errorCode ?? null, nowIso, jobId);
  if (
    providerState === 'cancelled' ||
    providerState === 'failed' ||
    providerState === 'completed'
  ) {
    touchTerminalInputs(db, jobId, now);
  }
}

export function releaseJobLease(
  db: DatabaseSync,
  jobId: string,
  nowIso: string,
): void {
  db.prepare(
    `UPDATE jobs
     SET lease_owner = NULL, lease_until = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(nowIso, jobId);
}

export function schedulePoll(
  db: DatabaseSync,
  jobId: string,
  nextAttemptAt: string,
  pollCount: number,
  nowIso: string,
): void {
  db.prepare(
    `UPDATE jobs SET next_attempt_at = ?, poll_count = ?, updated_at = ? WHERE id = ?`,
  ).run(nextAttemptAt, pollCount, nowIso, jobId);
}

export function listDueRunning(db: DatabaseSync, nowIso: string): JobRecord[] {
  const rows = db
    .prepare(
      `SELECT id FROM jobs
       WHERE provider_state = 'running'
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY next_attempt_at ASC, id ASC`,
    )
    .all(nowIso) as { id: string }[];
  return rows
    .map((row) => getJob(db, row.id))
    .filter((job): job is JobRecord => job !== undefined);
}

export function listJobsPage(
  db: DatabaseSync,
  ownerId: string,
  cursor: string | undefined,
  limit = 50,
): { jobs: JobRecord[]; nextCursor?: string } {
  let rows: JobRow[];
  if (!cursor) {
    rows = db
      .prepare(
        `SELECT id, owner_id, client_request_id, request_hash, operation, model_id,
                prompt, draft_json, provider_state, save_state, provider_run_id,
                error_code, lease_owner, lease_until, next_attempt_at, poll_count,
                cost_json, original_job_id, provider_ticket_json,
                status_adapter_version, created_at, updated_at
         FROM jobs
         WHERE owner_id = ?
         ORDER BY updated_at ASC, id ASC
         LIMIT ?`,
      )
      .all(ownerId, limit + 1) as unknown as JobRow[];
  } else {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const split = decoded.indexOf('|');
    const updatedAt = decoded.slice(0, split);
    const id = decoded.slice(split + 1);
    rows = db
      .prepare(
        `SELECT id, owner_id, client_request_id, request_hash, operation, model_id,
                prompt, draft_json, provider_state, save_state, provider_run_id,
                error_code, lease_owner, lease_until, next_attempt_at, poll_count,
                cost_json, original_job_id, provider_ticket_json,
                status_adapter_version, created_at, updated_at
         FROM jobs
         WHERE owner_id = ?
           AND (updated_at > ? OR (updated_at = ? AND id > ?))
         ORDER BY updated_at ASC, id ASC
         LIMIT ?`,
      )
      .all(ownerId, updatedAt, updatedAt, id, limit + 1) as unknown as JobRow[];
  }
  const extra = rows.length > limit;
  const page = extra ? rows.slice(0, limit) : rows;
  const jobs = page.map((row) => asRecord(row, db));
  const last = page[page.length - 1];
  return {
    jobs,
    nextCursor:
      extra && last
        ? Buffer.from(`${last.updated_at}|${last.id}`).toString('base64url')
        : undefined,
  };
}

export function cancelJob(
  db: DatabaseSync,
  ownerId: string,
  jobId: string,
  now: Date,
): JobRecord {
  const job = getJobForOwner(db, ownerId, jobId);
  if (job.providerState !== 'queued' || job.providerRunId) {
    throw new HttpError(409, 'cancel_not_allowed');
  }
  markJobState(db, job.id, 'cancelled', now);
  const updated = getJob(db, job.id);
  if (!updated) {
    throw new HttpError(500, 'job_missing');
  }
  return updated;
}

export function acknowledgeJob(
  db: DatabaseSync,
  ownerId: string,
  jobId: string,
  hashes: string[],
  stagingDir: string,
  now: Date,
): JobRecord {
  const job = getJobForOwner(db, ownerId, jobId);
  const outputs = listOutputs(db, job.id);
  if (job.providerState !== 'completed' || outputs.length === 0) {
    throw new HttpError(409, 'acknowledge_not_allowed');
  }
  const expected = outputs.map((item) => item.sha256).sort();
  const provided = [...hashes].sort();
  if (
    expected.length !== provided.length ||
    expected.some((value, index) => value !== provided[index])
  ) {
    throw new HttpError(409, 'output_hash_mismatch');
  }
  for (const output of outputs) {
    try {
      const bytes = readOutputFile(stagingDir, job.id, output.ordinal);
      if (sha256Hex(bytes) !== output.sha256) {
        throw new HttpError(409, 'output_hash_mismatch');
      }
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(409, 'unrecoverable_bytes');
    }
  }
  const nowIso = now.toISOString();
  db.prepare(
    `UPDATE job_outputs SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE job_id = ?`,
  ).run(nowIso, job.id);
  db.prepare(
    `UPDATE jobs SET save_state = 'saved', updated_at = ? WHERE id = ?`,
  ).run(nowIso, job.id);
  const updated = getJob(db, job.id);
  if (!updated) {
    throw new HttpError(500, 'job_missing');
  }
  return updated;
}

export function recoverExpiredLeases(db: DatabaseSync, now: Date): void {
  const nowIso = now.toISOString();
  db.prepare(
    `UPDATE jobs
     SET provider_state = 'submission-unknown',
         error_code = 'submission_lease_expired',
         lease_owner = NULL,
         lease_until = NULL,
         updated_at = ?
     WHERE provider_state = 'submitting'
       AND lease_until IS NOT NULL
       AND lease_until <= ?`,
  ).run(nowIso, nowIso);
  db.prepare(
    `UPDATE jobs
     SET lease_owner = NULL,
         lease_until = NULL,
         updated_at = ?
     WHERE provider_state = 'queued'
       AND lease_until IS NOT NULL
       AND lease_until <= ?`,
  ).run(nowIso, nowIso);
}
