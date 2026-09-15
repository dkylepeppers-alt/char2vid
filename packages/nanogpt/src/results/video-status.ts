import type { ProviderState } from '@char2vid/domain';

export const VIDEO_STATUS_ADAPTER_VERSION = 'video-status.v1';

export interface NormalizedVideoStatus {
  state: ProviderState;
  outputUrl?: string;
  cost?: unknown;
  error?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function mapStatus(raw: string): ProviderState | undefined {
  const status = raw.trim().toLowerCase().replace(/_/g, '-');
  if (
    status === 'completed' ||
    status === 'success' ||
    status === 'succeeded'
  ) {
    return 'completed';
  }
  if (status === 'failed' || status === 'error') {
    return 'failed';
  }
  if (status === 'cancelled' || status === 'canceled') {
    return 'cancelled';
  }
  if (
    status === 'pending' ||
    status === 'queued' ||
    status === 'running' ||
    status === 'processing' ||
    status === 'in-progress' ||
    status === 'submitted' ||
    status === 'not-start' ||
    status === 'in-queue' ||
    status === 'unknown'
  ) {
    return 'running';
  }
  return undefined;
}

function nestedVideoUrl(data: Record<string, unknown>): string | undefined {
  const output = asRecord(data.output);
  const video = asRecord(output?.video);
  return readString(video?.url) ?? readString(output?.url);
}

function flatVideoUrl(body: Record<string, unknown>): string | undefined {
  return readString(body.videoUrl) ?? readString(body.outputUrl);
}

/**
 * Normalize documented nested (`data.status` COMPLETED) and flat
 * (`status` + `videoUrl`) video status envelopes. Empty completions do not
 * invent an output URL.
 */
export function normalizeVideoStatus(body: unknown): NormalizedVideoStatus {
  const root = asRecord(body);
  if (!root) {
    throw new Error('unsupported_video_envelope');
  }
  const nested = asRecord(root.data);
  const statusRaw = nested
    ? readString(nested.status)
    : readString(root.status);
  if (!statusRaw) {
    throw new Error('unsupported_video_envelope');
  }
  const state = mapStatus(statusRaw);
  if (!state) {
    throw new Error('unsupported_video_envelope');
  }
  const outputUrl = nested ? nestedVideoUrl(nested) : flatVideoUrl(root);
  const cost = nested?.cost ?? root.cost;
  const error =
    readString(nested?.error) ??
    readString(root.error) ??
    readString(nested?.message) ??
    readString(root.message);
  if (state === 'completed' && !outputUrl) {
    throw new Error('missing_video_output');
  }
  return {
    state,
    ...(outputUrl ? { outputUrl } : {}),
    ...(cost !== undefined ? { cost } : {}),
    ...(error ? { error } : {}),
  };
}
