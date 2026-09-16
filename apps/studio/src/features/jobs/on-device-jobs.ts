import type {
  GenerationDraft,
  JobReceipt,
  PreparedInput,
  ReferenceBinding,
} from '@char2vid/domain';
import type { LibraryPort } from '@char2vid/domain/storage';
import { buildRequest, type NanoGptModelDescriptor } from '@char2vid/nanogpt';

import { resolvePlatform } from '../../app/platform';
import {
  getStudioLibrary,
  streamToUint8Array,
} from '../library/library-session';
import { findLibraryAssetByRevisionId } from './find-library-asset';
import type { JobView } from './job-sync';

export type GenerationBackend = 'on-device' | 'service' | 'none';

export function selectGenerationBackend(input: {
  platform: 'android' | 'web';
  hasProviderKey: boolean;
  hasServiceSession: boolean;
}): GenerationBackend {
  if (input.platform === 'android' && input.hasProviderKey) {
    return 'on-device';
  }
  if (input.hasServiceSession) {
    return 'service';
  }
  return 'none';
}

export function bytesToDataUrl(mime: string, bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function hasOnDeviceProviderKey(): Promise<boolean> {
  if (resolvePlatform() !== 'android') {
    return false;
  }
  const { hasNativeProviderKey } =
    await import('@char2vid/native-bridge/credentials');
  return hasNativeProviderKey();
}

export async function resolveGenerationBackend(
  hasServiceSession: boolean,
): Promise<GenerationBackend> {
  return selectGenerationBackend({
    platform: resolvePlatform(),
    hasProviderKey: await hasOnDeviceProviderKey(),
    hasServiceSession,
  });
}

export async function preparedInputsFromLibrary(
  library: LibraryPort,
  references: ReferenceBinding[],
): Promise<PreparedInput[]> {
  const inputs: PreparedInput[] = [];
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
    inputs.push({
      binding,
      sha256: asset.sha256,
      mime: asset.mime,
      bytes: bytes.byteLength,
      source: { type: 'data', dataUrl: bytesToDataUrl(asset.mime, bytes) },
    });
  }
  return inputs;
}

export async function enqueueOnDeviceJob(
  draft: GenerationDraft,
  model: NanoGptModelDescriptor,
): Promise<JobView> {
  const library = await getStudioLibrary();
  const inputs = await preparedInputsFromLibrary(library, draft.references);
  const built = buildRequest(draft, model, inputs);
  const blocking = built.issues.find((issue) => issue.severity === 'blocking');
  if (!built.request || blocking) {
    throw new Error(blocking?.code ?? 'invalid_request');
  }
  const { enqueueNativeJob } = await import('@char2vid/native-bridge/jobs');
  return enqueueNativeJob({
    clientRequestId: draft.clientRequestId,
    operation: draft.operation,
    request: built.request,
  });
}

export async function listOnDeviceJobs(): Promise<JobView[]> {
  const { listNativeJobs } = await import('@char2vid/native-bridge/jobs');
  const page = await listNativeJobs();
  return page.jobs;
}

export async function cancelOnDeviceJob(jobId: string): Promise<JobReceipt> {
  const { cancelNativeJob } = await import('@char2vid/native-bridge/jobs');
  return cancelNativeJob(jobId);
}

export async function submitDraftJob(input: {
  draft: GenerationDraft;
  model: NanoGptModelDescriptor;
}): Promise<JobView> {
  const { resolveStudioSession, stageLibraryReferences, submitGenerationJob } =
    await import('./job-sync');
  const session = await resolveStudioSession();
  const backend = await resolveGenerationBackend(session !== null);
  if (backend === 'on-device') {
    return enqueueOnDeviceJob(input.draft, input.model);
  }
  if (backend === 'service' && session) {
    const library = await getStudioLibrary();
    const transferIds = await stageLibraryReferences(
      session,
      library,
      input.draft.references,
    );
    return submitGenerationJob(session, input.draft, transferIds);
  }
  throw new Error('Connect a Nano-GPT key in Settings to submit');
}
