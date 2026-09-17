import { describe, expect, it } from 'vitest';

import type { GenerationDraft } from '../../packages/domain/src/contracts';
import {
  CLIENT_REQUEST_FINGERPRINT_KEY,
  CLIENT_REQUEST_ID_KEY,
  clearDraftClientRequestId,
  createSubmitGate,
  draftFingerprint,
  resolveDraftClientRequestId,
} from '../../apps/studio/src/features/create/create-submit';

function memoryStorage(
  initial: Record<string, string> = {},
): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const data = { ...initial };
  return {
    getItem(key) {
      return data[key] ?? null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

function draft(
  overrides: Partial<GenerationDraft> = {},
): Omit<GenerationDraft, 'clientRequestId'> {
  return {
    operation: 'image-generate',
    modelId: 'fixture/image',
    prompt: 'A quiet portrait',
    references: [],
    parameters: { n: 1 },
    ...overrides,
  };
}

describe('create submit idempotency (P4 residual / P5)', () => {
  it('reuses one client_request_id for two submits of the same draft', () => {
    const storage = memoryStorage();
    let minted = 0;
    const mint = () => {
      minted += 1;
      return `id-${minted}`;
    };
    const fingerprint = draftFingerprint(draft());
    const first = resolveDraftClientRequestId({ storage, fingerprint, mint });
    const second = resolveDraftClientRequestId({ storage, fingerprint, mint });
    expect(first).toBe('id-1');
    expect(second).toBe('id-1');
    expect(minted).toBe(1);
    expect(storage.getItem(CLIENT_REQUEST_ID_KEY)).toBe('id-1');
    expect(storage.getItem(CLIENT_REQUEST_FINGERPRINT_KEY)).toBe(fingerprint);
  });

  it('mints a new id when the draft changes before a receipt', () => {
    const storage = memoryStorage();
    let minted = 0;
    const mint = () => {
      minted += 1;
      return `id-${minted}`;
    };
    const first = resolveDraftClientRequestId({
      storage,
      fingerprint: draftFingerprint(draft()),
      mint,
    });
    const second = resolveDraftClientRequestId({
      storage,
      fingerprint: draftFingerprint(draft({ prompt: 'A different prompt' })),
      mint,
    });
    expect(first).toBe('id-1');
    expect(second).toBe('id-2');
    expect(minted).toBe(2);
  });

  it('keeps the pre-C2 fingerprint for an unslotted draft so a lost paid response can retry', () => {
    const legacy = JSON.stringify({
      operation: 'image-generate',
      modelId: 'fixture/image',
      prompt: 'A quiet portrait',
      references: [],
      parameters: { n: 1 },
      projectId: null,
      shotRevisionId: null,
    });
    expect(draftFingerprint(draft())).toBe(legacy);
    const storage = memoryStorage({
      [CLIENT_REQUEST_ID_KEY]: 'id-legacy',
      [CLIENT_REQUEST_FINGERPRINT_KEY]: legacy,
    });
    const reused = resolveDraftClientRequestId({
      storage,
      fingerprint: draftFingerprint(draft()),
      mint: () => 'id-new',
    });
    expect(reused).toBe('id-legacy');
  });

  it('treats a character slot intent as a distinct create fingerprint', () => {
    const storage = memoryStorage();
    let minted = 0;
    const mint = () => {
      minted += 1;
      return `id-${minted}`;
    };
    const first = resolveDraftClientRequestId({
      storage,
      fingerprint: draftFingerprint(draft()),
      mint,
    });
    const second = resolveDraftClientRequestId({
      storage,
      fingerprint: draftFingerprint(
        draft({
          characterSlot: {
            characterId: 'c1',
            role: 'identity',
            view: 'left',
          },
        }),
      ),
      mint,
    });
    expect(first).toBe('id-1');
    expect(second).toBe('id-2');
  });

  it('clears the stored id after a successful receipt so the next intent is new', () => {
    const storage = memoryStorage();
    let minted = 0;
    const mint = () => {
      minted += 1;
      return `id-${minted}`;
    };
    const fingerprint = draftFingerprint(draft());
    resolveDraftClientRequestId({ storage, fingerprint, mint });
    clearDraftClientRequestId(storage);
    const next = resolveDraftClientRequestId({ storage, fingerprint, mint });
    expect(next).toBe('id-2');
  });

  it('rejects a second enter while a submit is in flight (double-click)', () => {
    const gate = createSubmitGate();
    expect(gate.tryEnter()).toBe(true);
    expect(gate.tryEnter()).toBe(false);
    gate.leave();
    expect(gate.tryEnter()).toBe(true);
  });
});
