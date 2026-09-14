import { isIP } from 'node:net';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

import { HttpError } from '../http-error';

export interface SafeDownloadLimits {
  maxBytes: number;
  timeoutMs: number;
  allowedMime?: string;
}

export interface SafeDownloadDeps {
  fetchImpl: typeof fetch;
  lookup: (hostname: string) => Promise<string[]>;
}

const BLOCKED_V4 = [
  { net: 0x00000000, mask: 0xff000000 }, // 0.0.0.0/8
  { net: 0x0a000000, mask: 0xff000000 }, // 10.0.0.0/8
  { net: 0x7f000000, mask: 0xff000000 }, // 127.0.0.0/8
  { net: 0xac100000, mask: 0xfff00000 }, // 172.16.0.0/12
  { net: 0xc0a80000, mask: 0xffff0000 }, // 192.168.0.0/16
  { net: 0xa9fe0000, mask: 0xffff0000 }, // 169.254.0.0/16
  { net: 0x64400000, mask: 0xffc00000 }, // 100.64.0.0/10
];

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return undefined;
  }
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      return undefined;
    }
    value = (value << 8) + n;
  }
  return value >>> 0;
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const value = ipv4ToInt(address);
    if (value === undefined) {
      return true;
    }
    return BLOCKED_V4.some((range) => (value & range.mask) === range.net);
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.')
    );
  }
  return true;
}

function assertPublicHostname(hostname: string): void {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower === 'metadata.google.internal'
  ) {
    throw new HttpError(400, 'private_destination');
  }
}

async function assertPublicHost(
  hostname: string,
  lookup: SafeDownloadDeps['lookup'],
): Promise<void> {
  assertPublicHostname(hostname);
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new HttpError(400, 'private_destination');
    }
    return;
  }
  const addresses = await lookup(hostname);
  if (
    addresses.length === 0 ||
    addresses.some((address) => isBlockedAddress(address))
  ) {
    throw new HttpError(400, 'private_destination');
  }
}

export async function safeDownload(
  url: string,
  destination: string,
  limits: SafeDownloadLimits,
  deps: SafeDownloadDeps,
): Promise<{ bytes: number; mime: string }> {
  let current = url;
  for (let hop = 0; hop < 5; hop += 1) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new HttpError(400, 'invalid_url');
    }
    if (parsed.protocol !== 'https:') {
      throw new HttpError(400, 'insecure_url');
    }
    await assertPublicHost(parsed.hostname, deps.lookup);
    const response = await deps.fetchImpl(parsed.href, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(limits.timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new HttpError(502, 'redirect_without_location');
      }
      current = new URL(location, parsed).toString();
      continue;
    }
    if (!response.ok || !response.body) {
      throw new HttpError(502, 'download_failed');
    }
    const mime = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      ?.trim()
      .toLowerCase();
    if (limits.allowedMime && mime !== limits.allowedMime) {
      throw new HttpError(415, 'unexpected_mime');
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of response.body) {
      const piece = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
      total += piece.byteLength;
      if (total > limits.maxBytes) {
        throw new HttpError(413, 'download_too_large');
      }
      chunks.push(piece);
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.concat(chunks));
    return { bytes: total, mime: mime ?? 'application/octet-stream' };
  }
  throw new HttpError(400, 'too_many_redirects');
}
