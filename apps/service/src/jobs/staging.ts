import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { HttpError } from '../http-error.ts';

const PNG_SIGNATURE = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
);

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function validateOutputBytes(bytes: Uint8Array, mime: string): void {
  if (bytes.byteLength === 0) {
    throw new HttpError(422, 'empty_output');
  }
  if (mime === 'image/png') {
    if (
      bytes.byteLength < PNG_SIGNATURE.length ||
      PNG_SIGNATURE.some((value, index) => bytes[index] !== value)
    ) {
      throw new HttpError(422, 'invalid_png');
    }
  }
}

export function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

export function outputPath(
  stagingDir: string,
  jobId: string,
  ordinal: number,
): string {
  return join(stagingDir, 'outputs', jobId, String(ordinal));
}

export function writeOutputFile(
  stagingDir: string,
  jobId: string,
  ordinal: number,
  bytes: Uint8Array,
): void {
  const directory = join(stagingDir, 'outputs', jobId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(outputPath(stagingDir, jobId, ordinal), bytes);
}

export function readOutputFile(
  stagingDir: string,
  jobId: string,
  ordinal: number,
): Uint8Array {
  return new Uint8Array(readFileSync(outputPath(stagingDir, jobId, ordinal)));
}
