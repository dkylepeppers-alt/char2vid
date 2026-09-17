import type {
  GenerationDraft,
  JobReceipt,
  ReferenceBinding,
} from '@char2vid/domain';
import type { AssetRecord, LibraryPort } from '@char2vid/domain/storage';

import { attachImportedCharacterSlots } from './attach-generated-slot';

import {
  getStudioLibrary,
  invalidateStudioLibrary,
  streamToUint8Array,
} from '../library/library-session';
import {
  nativeTokenForOrigin,
  normalizeServiceOrigin,
  SERVICE_ORIGIN_KEY,
} from '../settings/service-origin';
import { resolvePlatform } from '../../app/platform';
import { findLibraryAssetByRevisionId } from './find-library-asset';
import { hasOnDeviceProviderKey, listOnDeviceJobs } from './on-device-jobs';

export interface JobView extends JobReceipt {
  cost?: {
    state: string;
    amount?: number;
    durationSeconds?: number;
  };
  originalJobId?: string;
  outputs?: Array<{
    ordinal: number;
    sha256: string;
    mime: string;
    bytes: number;
  }>;
  updatedAt?: string;
}

export interface StudioSession {
  origin: string;
  nativeToken?: string;
}

export async function studioApiFetch(
  session: StudioSession,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (session.nativeToken) {
    headers.set('Authorization', `Bearer ${session.nativeToken}`);
  }
  return fetch(`${session.origin}${path}`, {
    ...init,
    headers,
    credentials: session.nativeToken ? 'omit' : 'include',
  });
}

export async function resolveStudioSession(): Promise<StudioSession | null> {
  const stored = window.localStorage.getItem(SERVICE_ORIGIN_KEY) ?? '';
  if (!stored.trim()) {
    return null;
  }
  let origin: string;
  try {
    origin = normalizeServiceOrigin(stored);
  } catch {
    return null;
  }
  let nativeToken: string | undefined;
  if (resolvePlatform() === 'android') {
    const { loadNativeServiceSession } =
      await import('@char2vid/native-bridge/credentials');
    const saved = await loadNativeServiceSession();
    nativeToken = nativeTokenForOrigin(
      saved?.deviceToken,
      saved?.serviceOrigin,
      origin,
    );
  }
  const session: StudioSession = { origin, nativeToken };
  const probe = await studioApiFetch(session, '/studio-api/session');
  if (!probe.ok) {
    return null;
  }
  return session;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function bytesBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy]);
}

export async function stageLibraryReferences(
  session: StudioSession,
  library: LibraryPort,
  references: ReferenceBinding[],
): Promise<string[]> {
  const transferIds: string[] = [];
  for (const binding of references) {
    const asset = await findLibraryAssetByRevisionId(
      library,
      binding.assetRevisionId,
    );
    if (!asset) {
      throw new Error('reference_asset_missing');
    }
    const bytes = await streamToUint8Array(
      await library.readRevision(asset.revisionId),
    );
    const created = await studioApiFetch(session, '/studio-api/transfers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sha256: asset.sha256,
        bytes: bytes.byteLength,
        mime: asset.mime,
        purpose: 'reference',
      }),
    });
    if (!created.ok) {
      throw new Error('transfer_create_failed');
    }
    const { transferId } = (await created.json()) as { transferId: string };
    const part = await studioApiFetch(
      session,
      `/studio-api/transfers/${transferId}/parts/0`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: bytesBlob(bytes),
      },
    );
    if (!part.ok) {
      throw new Error('transfer_part_failed');
    }
    const finalized = await studioApiFetch(
      session,
      `/studio-api/transfers/${transferId}/finalize`,
      { method: 'POST' },
    );
    if (!finalized.ok) {
      throw new Error('transfer_finalize_failed');
    }
    transferIds.push(transferId);
  }
  return transferIds;
}

export async function submitGenerationJob(
  session: StudioSession,
  draft: GenerationDraft,
  transferIds: string[],
  retryOfJobId?: string,
): Promise<JobView> {
  const response = await studioApiFetch(session, '/studio-api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      draft,
      transferIds,
      ...(retryOfJobId ? { retryOfJobId } : {}),
    }),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: string };
    throw new Error(body.error ?? 'job_submit_failed');
  }
  return (await response.json()) as JobView;
}

export async function listStudioJobs(
  session: StudioSession,
  cursor?: string,
): Promise<{ jobs: JobView[]; nextCursor?: string }> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await studioApiFetch(session, `/studio-api/jobs${query}`);
  if (!response.ok) {
    throw new Error('job_list_failed');
  }
  return (await response.json()) as { jobs: JobView[]; nextCursor?: string };
}

export async function cancelStudioJob(
  session: StudioSession,
  jobId: string,
): Promise<JobView> {
  const response = await studioApiFetch(
    session,
    `/studio-api/jobs/${jobId}/cancel`,
    { method: 'POST' },
  );
  if (!response.ok) {
    const body = (await response.json()) as { error?: string };
    throw new Error(body.error ?? 'cancel_not_allowed');
  }
  return (await response.json()) as JobView;
}

async function importOutput(
  session: StudioSession,
  library: LibraryPort,
  job: JobView,
  output: NonNullable<JobView['outputs']>[number],
): Promise<AssetRecord> {
  const response = await studioApiFetch(
    session,
    `/studio-api/jobs/${job.id}/outputs/${output.ordinal}`,
  );
  if (!response.ok) {
    throw new Error('output_download_failed');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = await sha256Hex(bytes);
  if (hash !== output.sha256) {
    throw new Error('output_hash_mismatch');
  }
  return library.importMedia({
    kind: 'stream',
    handle: bytes,
    name: `job-${job.id.slice(0, 8)}-${output.ordinal}`,
    mime: output.mime,
  });
}

async function reportSaveProgress(
  session: StudioSession,
  jobId: string,
  saveState: 'downloading' | 'verifying' | 'failed',
): Promise<void> {
  const response = await studioApiFetch(
    session,
    `/studio-api/jobs/${jobId}/save-progress`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ saveState }),
    },
  );
  if (!response.ok) {
    throw new Error('save_progress_failed');
  }
}

export async function reconcileJobOutputs(
  session: StudioSession,
  library: LibraryPort,
  job: JobView,
): Promise<JobView> {
  if (job.providerState !== 'completed' || job.saveState === 'saved') {
    return job;
  }
  await reportSaveProgress(session, job.id, 'downloading');
  const hashes: string[] = [];
  const importedRevisionIds: string[] = [];
  try {
    for (const output of job.outputs ?? []) {
      const imported = await importOutput(session, library, job, output);
      hashes.push(imported.sha256);
      importedRevisionIds.push(imported.revisionId);
    }
    await reportSaveProgress(session, job.id, 'verifying');
  } catch (error) {
    await reportSaveProgress(session, job.id, 'failed').catch(() => undefined);
    throw error;
  }
  if (job.characterSlot) {
    await attachImportedCharacterSlots(
      library,
      job.characterSlot,
      importedRevisionIds,
    );
  }
  const ack = await studioApiFetch(
    session,
    `/studio-api/jobs/${job.id}/acknowledge`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hashes }),
    },
  );
  if (!ack.ok) {
    throw new Error('acknowledge_failed');
  }
  invalidateStudioLibrary();
  return (await ack.json()) as JobView;
}

export async function syncStudioJobs(): Promise<JobView[]> {
  if (await hasOnDeviceProviderKey()) {
    const jobs = await listOnDeviceJobs();
    const library = await getStudioLibrary();
    for (const job of jobs) {
      if (
        job.providerState === 'completed' &&
        job.characterSlot &&
        job.outputRevisionIds.length > 0
      ) {
        await attachImportedCharacterSlots(
          library,
          job.characterSlot,
          job.outputRevisionIds,
        );
      }
    }
    return jobs;
  }
  const session = await resolveStudioSession();
  if (!session) {
    return [];
  }
  const collected: JobView[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i += 1) {
    const page = await listStudioJobs(session, cursor);
    collected.push(...page.jobs);
    if (!page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }
  const library = await getStudioLibrary();
  const reconciled: JobView[] = [];
  for (const job of collected) {
    try {
      reconciled.push(await reconcileJobOutputs(session, library, job));
    } catch {
      reconciled.push(job);
    }
  }
  return reconciled;
}
