import { isIP } from 'node:net';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { once } from 'node:events';
import https from 'node:https';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

import { HttpError } from '../http-error.ts';

export interface SafeDownloadLimits {
  maxBytes: number;
  timeoutMs: number;
  allowedMime?: string;
}

export type SafeFetchInit = RequestInit & { pinnedAddresses?: string[] };

export type SafeFetch = (
  url: string,
  init?: SafeFetchInit,
) => Promise<Response>;

export interface SafeDownloadDeps {
  fetchImpl?: SafeFetch;
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
    return BLOCKED_V4.some((range) => (value & range.mask) >>> 0 === range.net);
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    const mapped = normalized.startsWith('::ffff:')
      ? normalized.slice('::ffff:'.length)
      : undefined;
    if (mapped && isIP(mapped) === 4) {
      return isBlockedAddress(mapped);
    }
    return (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
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

async function publicAddresses(
  hostname: string,
  lookup: SafeDownloadDeps['lookup'],
): Promise<string[]> {
  assertPublicHostname(hostname);
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new HttpError(400, 'private_destination');
    }
    return [hostname];
  }
  const addresses = await lookup(hostname);
  const allowed = addresses.filter((address) => !isBlockedAddress(address));
  if (addresses.length === 0 || allowed.length !== addresses.length) {
    throw new HttpError(400, 'private_destination');
  }
  return allowed;
}

export async function pinnedFetch(
  url: string,
  init: SafeFetchInit = {},
): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new HttpError(400, 'insecure_url');
  }
  const address = init.pinnedAddresses?.[0];
  if (!address || isIP(address) === 0 || isBlockedAddress(address)) {
    throw new HttpError(400, 'private_destination');
  }
  const family = isIP(address) === 6 ? 6 : 4;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname: address,
        servername: parsed.hostname,
        port: parsed.port === '' ? 443 : Number(parsed.port),
        path: `${parsed.pathname}${parsed.search}`,
        method: init.method ?? 'GET',
        headers: { host: parsed.host },
        lookup: (_host, _options, callback) => {
          callback(null, address, family);
        },
      },
      (incoming) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value === undefined) {
            continue;
          }
          if (Array.isArray(value)) {
            for (const item of value) {
              headers.append(key, item);
            }
          } else {
            headers.set(key, value);
          }
        }
        const status = incoming.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          incoming.resume();
          resolve(new Response(null, { status, headers }));
          return;
        }
        resolve(
          new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
            status,
            headers,
          }),
        );
      },
    );
    const signal = init.signal;
    if (signal) {
      const abort = () => {
        req.destroy();
        reject(
          signal.reason instanceof Error ? signal.reason : new Error('aborted'),
        );
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
    }
    req.on('error', reject);
    req.end();
  });
}

async function writeLimitedStream(
  body: ReadableStream<Uint8Array>,
  destination: string,
  maxBytes: number,
): Promise<number> {
  await mkdir(dirname(destination), { recursive: true });
  const temp = `${destination}.part`;
  const out = createWriteStream(temp);
  out.on('error', () => undefined);
  let total = 0;
  try {
    for await (const chunk of body) {
      const piece = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
      total += piece.byteLength;
      if (total > maxBytes) {
        throw new HttpError(413, 'download_too_large');
      }
      if (!out.write(piece)) {
        await once(out, 'drain');
      }
    }
    out.end();
    await finished(out);
    await rename(temp, destination);
    return total;
  } catch (error) {
    out.destroy();
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function safeDownload(
  url: string,
  destination: string,
  limits: SafeDownloadLimits,
  deps: SafeDownloadDeps,
): Promise<{ bytes: number; mime: string }> {
  const fetchImpl = deps.fetchImpl ?? pinnedFetch;
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
    const pinnedAddresses = await publicAddresses(parsed.hostname, deps.lookup);
    const response = await fetchImpl(parsed.href, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(limits.timeoutMs),
      pinnedAddresses,
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
    const bytes = await writeLimitedStream(
      response.body,
      destination,
      limits.maxBytes,
    );
    return { bytes, mime: mime ?? 'application/octet-stream' };
  }
  throw new HttpError(400, 'too_many_redirects');
}
