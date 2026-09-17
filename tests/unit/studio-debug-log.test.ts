import { describe, expect, it } from 'vitest';

import {
  DEBUG_LOG_STORAGE_KEY,
  createMemoryLogRing,
  formatStudioDebugLine,
  isStudioDebugLogEnabled,
} from '../../apps/studio/src/app/debug-log';

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

describe('isStudioDebugLogEnabled', () => {
  it('defaults on for local web debug and Android, off for production web', () => {
    const storage = memoryStorage();
    expect(isStudioDebugLogEnabled(storage, { dev: true, native: false })).toBe(
      true,
    );
    expect(isStudioDebugLogEnabled(storage, { dev: false, native: true })).toBe(
      true,
    );
    expect(
      isStudioDebugLogEnabled(storage, { dev: false, native: false }),
    ).toBe(false);
  });

  it('lets Settings force logs on or off', () => {
    expect(
      isStudioDebugLogEnabled(memoryStorage({ [DEBUG_LOG_STORAGE_KEY]: '0' }), {
        dev: true,
        native: true,
      }),
    ).toBe(false);
    expect(
      isStudioDebugLogEnabled(memoryStorage({ [DEBUG_LOG_STORAGE_KEY]: '1' }), {
        dev: false,
        native: false,
      }),
    ).toBe(true);
  });
});

describe('studio debug ring', () => {
  it('keeps a phone-sized ring of formatted lines without prompt text', () => {
    const ring = createMemoryLogRing(2);
    ring.write({
      ts: '2026-09-17T10:00:00.000Z',
      level: 'info',
      event: 'checklist.item',
      screen: 'create',
      route: '/create',
      fields: {
        itemId: 'accepted-text',
        previous: 'blocked',
        next: 'complete',
        prompt: 'must not appear',
      },
    });
    ring.write({
      ts: '2026-09-17T10:00:01.000Z',
      level: 'info',
      event: 'create.submit.start',
      fields: { modelId: 'vendor/one-ref', promptChars: 12 },
    });
    ring.write({
      ts: '2026-09-17T10:00:02.000Z',
      level: 'warn',
      event: 'job.save.error',
      fields: { code: 'output_hash_mismatch' },
    });
    expect(ring.snapshot()).toHaveLength(2);
    const lines = ring.snapshot().map(formatStudioDebugLine);
    expect(lines[0]).toContain('create.submit.start');
    expect(lines[1]).toContain('job.save.error');
    expect(lines.join('\n')).not.toMatch(/must not appear/);
  });
});
