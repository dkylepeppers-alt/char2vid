export const AUDIO_OUTPUT_ADAPTER_VERSION = 'audio-output.v1';

export type NormalizedAudioOutput =
  | { kind: 'binary'; mime: string; bytes: Uint8Array }
  | { kind: 'url'; url: string; cost?: unknown }
  | {
      kind: 'ticket';
      runId: string;
      cost?: unknown;
      rawTicket: unknown;
    };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isAudioMime(contentType: string): boolean {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return mime.startsWith('audio/') || mime === 'application/octet-stream';
}

function runIdFrom(record: Record<string, unknown>): string | undefined {
  return (
    readString(record.runId) ??
    readString(record.id) ??
    readString(record.task_id)
  );
}

/**
 * Normalize speech/TTS results: raw audio bytes, JSON `audioUrl`, or a 202
 * ticket. Binary responses are never parsed as JSON.
 */
export function normalizeAudioOutput(
  status: number,
  body: unknown,
  contentType: string,
  rawBytes?: Uint8Array,
): NormalizedAudioOutput {
  if (rawBytes && rawBytes.byteLength > 0 && isAudioMime(contentType)) {
    const mime =
      contentType.split(';')[0]?.trim().toLowerCase() ||
      'application/octet-stream';
    return { kind: 'binary', mime, bytes: rawBytes };
  }
  const record = asRecord(body);
  if (!record) {
    throw new Error('missing_audio_output');
  }
  if (status === 202) {
    const runId = runIdFrom(record);
    if (!runId) {
      throw new Error('missing_audio_ticket');
    }
    return {
      kind: 'ticket',
      runId,
      ...(record.cost !== undefined ? { cost: record.cost } : {}),
      rawTicket: record,
    };
  }
  const url =
    readString(record.audioUrl) ??
    readString(record.url) ??
    readString(asRecord(record.audio)?.url);
  if (!url) {
    throw new Error('missing_audio_output');
  }
  return {
    kind: 'url',
    url,
    ...(record.cost !== undefined ? { cost: record.cost } : {}),
  };
}
