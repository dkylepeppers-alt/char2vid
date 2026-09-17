import { Capacitor, registerPlugin } from '@capacitor/core';

import type { JobReceipt } from '@char2vid/domain';

export interface NativeJobView extends JobReceipt {
  outputs?: Array<{
    ordinal: number;
    sha256: string;
    mime: string;
    bytes: number;
    revisionId?: string;
  }>;
  updatedAt?: string;
}

export interface NativeFrozenRequest {
  url: string;
  method: string;
  body: unknown;
}

interface Char2vidJobsPlugin {
  enqueue(options: {
    clientRequestId: string;
    operation: string;
    request: NativeFrozenRequest;
    characterSlot?: JobReceipt['characterSlot'];
  }): Promise<NativeJobView>;
  listJobs(): Promise<{ jobs: NativeJobView[] }>;
  cancelJob(options: { jobId: string }): Promise<NativeJobView>;
}

const Char2vidJobs = registerPlugin<Char2vidJobsPlugin>('Char2vidJobs');

function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function enqueueNativeJob(input: {
  clientRequestId: string;
  operation: string;
  request: NativeFrozenRequest;
  characterSlot?: JobReceipt['characterSlot'];
}): Promise<NativeJobView> {
  if (!isAndroidNative()) {
    throw new Error('On-device jobs require Android');
  }
  return Char2vidJobs.enqueue(input);
}

export async function listNativeJobs(): Promise<{ jobs: NativeJobView[] }> {
  if (!isAndroidNative()) {
    return { jobs: [] };
  }
  return Char2vidJobs.listJobs();
}

export async function cancelNativeJob(jobId: string): Promise<JobReceipt> {
  if (!isAndroidNative()) {
    throw new Error('On-device jobs require Android');
  }
  return Char2vidJobs.cancelJob({ jobId });
}
