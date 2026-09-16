import { describe, expect, it } from 'vitest';

import type {
  GenerationDraft,
  ReferenceBinding,
} from '../../packages/domain/src/contracts';
import {
  freezeRequest,
  identitiesForStaging,
} from '../../packages/domain/src/generation/request-snapshot';

function draft(overrides: Partial<GenerationDraft> = {}): GenerationDraft {
  return {
    clientRequestId: 'client-1',
    operation: 'image-generate',
    modelId: 'fixture/image',
    prompt: 'wave from the doorway',
    references: [],
    parameters: { n: 1 },
    ...overrides,
  };
}

const bindings: Array<ReferenceBinding & { sha256: string }> = [
  {
    assetRevisionId: 'rev-a',
    role: 'identity',
    characterRevisionId: 'cr-1',
    ordinal: 0,
    sha256: 'abc123',
  },
];

describe('request snapshot', () => {
  it('excludes expiring transfer URLs from semantic identity', () => {
    const model = {
      id: 'fixture/image',
      fetchedAt: '2026-09-16T00:00:00.000Z',
    };
    const first = freezeRequest(
      draft({
        parameters: {
          n: 1,
          imageUrl: 'https://cdn.example/tmp/a.png?sig=one&expires=1',
        },
      }),
      model,
      bindings,
    );
    const second = freezeRequest(
      draft({
        parameters: {
          n: 1,
          imageUrl: 'https://cdn.example/tmp/a.png?sig=two&expires=99',
        },
      }),
      model,
      bindings,
    );
    expect(first.canonicalJson).not.toMatch(/https:\/\//);
    expect(first.canonicalJson).not.toMatch(/sig=/);
    expect(first.requestHash).toBe(second.requestHash);
    expect(first.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps revision hash and ordinal on prepared identities without provider URLs', () => {
    const prepared = identitiesForStaging(
      [
        {
          assetRevisionId: 'rev-a',
          role: 'identity',
          characterRevisionId: 'cr-1',
          ordinal: 2,
        },
      ],
      { 'rev-a': 'deadbeef' },
    );
    expect(prepared).toEqual([
      {
        binding: {
          assetRevisionId: 'rev-a',
          role: 'identity',
          characterRevisionId: 'cr-1',
          ordinal: 2,
        },
        sha256: 'deadbeef',
      },
    ]);
    expect(JSON.stringify(prepared)).not.toMatch(/https:\/\//);
  });

  it('includes character slot intent so sheet attach jobs stay distinct', () => {
    const model = {
      id: 'fixture/image',
      fetchedAt: '2026-09-16T00:00:00.000Z',
    };
    const plain = freezeRequest(draft(), model, bindings);
    const slotted = freezeRequest(
      draft({
        characterSlot: {
          characterId: 'c1',
          role: 'identity',
          view: 'left',
        },
      }),
      model,
      bindings,
    );
    expect(slotted.requestHash).not.toBe(plain.requestHash);
    expect(slotted.canonicalJson).toContain('left');
  });

  it('rejects staging a provider URL as a library identity', () => {
    expect(() =>
      identitiesForStaging(
        [
          {
            assetRevisionId: 'https://expired.example/ref.png',
            role: 'identity',
            ordinal: 0,
          },
        ],
        { 'https://expired.example/ref.png': 'abc' },
      ),
    ).toThrow(/provider url/i);
  });
});
