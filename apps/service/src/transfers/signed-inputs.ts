import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function signMediaAccess(
  masterKey: Buffer,
  transferId: string,
  expiresAtUnix: number,
): string {
  return createHmac('sha256', masterKey)
    .update(`${transferId}:${expiresAtUnix}`)
    .digest('hex');
}

export function verifyMediaAccess(
  masterKey: Buffer,
  transferId: string,
  expiresAtUnix: number,
  signature: string,
  nowUnix: number,
): 'ok' | 'stale' | 'invalid' {
  if (expiresAtUnix <= nowUnix) {
    return 'stale';
  }
  const expectedHex = signMediaAccess(masterKey, transferId, expiresAtUnix);
  const expected = Buffer.from(expectedHex, 'hex');
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'hex');
  } catch {
    return 'invalid';
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return 'invalid';
  }
  return 'ok';
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
