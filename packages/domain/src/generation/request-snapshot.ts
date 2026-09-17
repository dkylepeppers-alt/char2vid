import type { GenerationDraft, ReferenceBinding } from '../contracts';

function isProviderUrl(value: string): boolean {
  return /^(https?:\/\/|data:)/i.test(value.trim());
}

export interface ModelSnapshot {
  id: string;
  fetchedAt?: string;
}

export interface FrozenRequest {
  canonicalJson: string;
  requestHash: string;
}

export interface StagingIdentity {
  binding: ReferenceBinding;
  sha256: string;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x192a4e28, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f,
  0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Bytes(message: Uint8Array): Uint8Array {
  const bitLength = message.byteLength * 8;
  const paddedLength = ((message.byteLength + 9 + 63) & ~63) >>> 0;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 =
        rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  out.setUint32(0, h0, false);
  out.setUint32(4, h1, false);
  out.setUint32(8, h2, false);
  out.setUint32(12, h3, false);
  out.setUint32(16, h4, false);
  out.setUint32(20, h5, false);
  out.setUint32(24, h6, false);
  out.setUint32(28, h7, false);
  return digest;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function sha256Utf8(text: string): string {
  return bytesToHex(sha256Bytes(new TextEncoder().encode(text)));
}

function stripUrls(value: unknown): unknown {
  if (typeof value === 'string') {
    return isProviderUrl(value) ? undefined : value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUrls(item))
      .filter((item) => item !== undefined);
  }
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const stripped = stripUrls(record[key]);
    if (stripped !== undefined) {
      next[key] = stripped;
    }
  }
  return next;
}

export function freezeRequest(
  draft: GenerationDraft,
  modelSnapshot: ModelSnapshot,
  bindings: ReadonlyArray<ReferenceBinding & { sha256?: string }>,
): FrozenRequest {
  const canonical = {
    modelId: modelSnapshot.id,
    modelFetchedAt: modelSnapshot.fetchedAt ?? null,
    operation: draft.operation,
    prompt: draft.prompt,
    bindings: [...bindings]
      .map((binding) => ({
        assetRevisionId: binding.assetRevisionId,
        role: binding.role,
        characterRevisionId: binding.characterRevisionId ?? null,
        ordinal: binding.ordinal,
        sha256: binding.sha256 ?? null,
      }))
      .sort(
        (a, b) =>
          a.ordinal - b.ordinal ||
          a.assetRevisionId.localeCompare(b.assetRevisionId),
      ),
    parameters: stripUrls(draft.parameters) ?? {},
    projectId: draft.projectId ?? null,
    shotRevisionId: draft.shotRevisionId ?? null,
    characterSlot: draft.characterSlot ?? null,
  };
  const canonicalJson = JSON.stringify(canonical);
  return { canonicalJson, requestHash: sha256Utf8(canonicalJson) };
}

export function identitiesForStaging(
  selected: readonly ReferenceBinding[],
  sha256ByRevisionId: Readonly<Record<string, string>>,
): StagingIdentity[] {
  return selected.map((binding) => {
    if (isProviderUrl(binding.assetRevisionId)) {
      throw new Error('provider url cannot be staged as a library identity');
    }
    const sha256 = sha256ByRevisionId[binding.assetRevisionId];
    if (!sha256) {
      throw new Error(`missing revision hash for ${binding.assetRevisionId}`);
    }
    return {
      binding: { ...binding },
      sha256,
    };
  });
}
