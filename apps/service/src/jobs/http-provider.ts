import { promises as dns } from 'node:dns';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { getRouteContract, routeUrl } from '@char2vid/nanogpt';
import type { Operation } from '@char2vid/domain';

import { HttpError } from '../http-error.ts';
import { safeDownload } from '../network/safe-download.ts';
import type { GenerationProvider, ProviderSubmitResult } from './provider.ts';

const OUTPUT_MAX_BYTES = 50 * 1024 * 1024;

function bearerHeaders(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
}

async function readResponse(response: Response): Promise<ProviderSubmitResult> {
  const contentType =
    response.headers.get('content-type') ?? 'application/octet-stream';
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime.startsWith('audio/') || mime === 'application/octet-stream') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, contentType, bytes };
  }
  const text = await response.text();
  if (!text) {
    return { status: response.status, contentType };
  }
  try {
    return {
      status: response.status,
      contentType,
      json: JSON.parse(text) as unknown,
    };
  } catch {
    return {
      status: response.status,
      contentType,
      bytes: Buffer.from(text),
    };
  }
}

/**
 * Live Nano-GPT transport. Tests inject `FakeGenerationProvider` instead so CI
 * never spends credits.
 */
export function createHttpGenerationProvider(): GenerationProvider {
  return {
    async submit(input) {
      const response = await fetch(input.url, {
        method: input.method,
        headers: bearerHeaders(input.apiKey),
        body: JSON.stringify(input.body),
      });
      return readResponse(response);
    },
    async status(input) {
      const contract = statusContract(input.operation);
      const url = `${routeUrl(contract)}?requestId=${encodeURIComponent(input.runId)}`;
      const response = await fetch(url, {
        method: contract.method,
        headers: { authorization: `Bearer ${input.apiKey}` },
      });
      const result = await readResponse(response);
      return result.json ?? {};
    },
    async fetchOutput(url) {
      const temp = join(
        tmpdir(),
        `char2vid-out-${randomBytes(8).toString('hex')}`,
      );
      try {
        const downloaded = await safeDownload(
          url,
          temp,
          {
            maxBytes: OUTPUT_MAX_BYTES,
            timeoutMs: 60_000,
          },
          {
            lookup: async (hostname) => {
              const result = await dns.lookup(hostname, { all: true });
              return result.map((item) => item.address);
            },
          },
        );
        return {
          bytes: new Uint8Array(readFileSync(temp)),
          mime: downloaded.mime,
        };
      } finally {
        rmSync(temp, { force: true });
      }
    },
  };
}

function statusContract(operation: Operation) {
  if (operation === 'video-generate' || operation.startsWith('video-')) {
    return getRouteContract('video.status');
  }
  throw new HttpError(500, 'status_contract_unresolved');
}
