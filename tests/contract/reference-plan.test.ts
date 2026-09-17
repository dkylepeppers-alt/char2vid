import { describe, expect, it } from 'vitest';

import type { ReferenceBinding } from '../../packages/domain/src/contracts';
import { planReferences } from '../../packages/domain/src/generation/reference-plan';

function binding(
  overrides: Partial<ReferenceBinding> &
    Pick<ReferenceBinding, 'assetRevisionId'>,
): ReferenceBinding {
  return {
    role: 'identity',
    ordinal: 0,
    ...overrides,
  };
}

it('reports unresolved capacity instead of silently losing a character', () => {
  const requested = [
    {
      assetRevisionId: 'a',
      role: 'identity' as const,
      characterRevisionId: 'c1',
      ordinal: 0,
    },
    {
      assetRevisionId: 'b',
      role: 'identity' as const,
      characterRevisionId: 'c2',
      ordinal: 1,
    },
  ];
  const result = planReferences({
    requested,
    maxItems: 1,
    supportedRoles: ['identity'],
  });
  expect(
    result.issues.some(
      (i) => i.code === 'reference_capacity' && i.severity === 'blocking',
    ),
  ).toBe(true);
  expect(
    [...result.selected, ...result.omitted]
      .map((r) => r.assetRevisionId)
      .sort(),
  ).toEqual(['a', 'b']);
});

describe('reference plan', () => {
  it('keeps requested ordinal order instead of reshuffling characters', () => {
    const requested = [
      binding({
        assetRevisionId: 'second',
        characterRevisionId: 'c2',
        ordinal: 1,
      }),
      binding({
        assetRevisionId: 'first',
        characterRevisionId: 'c1',
        ordinal: 0,
      }),
      binding({
        assetRevisionId: 'third',
        characterRevisionId: 'c3',
        ordinal: 2,
      }),
    ];
    const result = planReferences({
      requested,
      maxItems: 3,
      supportedRoles: ['identity'],
    });
    expect(result.selected.map((item) => item.assetRevisionId)).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(result.omitted).toEqual([]);
  });

  it('keeps same-display-name characters distinct by revision id', () => {
    const requested = [
      binding({
        assetRevisionId: 'mira-a',
        characterRevisionId: 'rev-mira-1',
        ordinal: 0,
      }),
      binding({
        assetRevisionId: 'mira-b',
        characterRevisionId: 'rev-mira-2',
        ordinal: 1,
      }),
    ];
    const result = planReferences({
      requested,
      maxItems: 2,
      supportedRoles: ['identity'],
    });
    expect(
      result.selected.map((item) => item.characterRevisionId).sort(),
    ).toEqual(['rev-mira-1', 'rev-mira-2']);
    expect(
      result.issues.some((issue) => issue.code === 'reference_capacity'),
    ).toBe(false);
  });

  it('prefers the start frame on a one-image video route and names the extras', () => {
    const requested = [
      binding({
        assetRevisionId: 'identity-a',
        role: 'identity',
        characterRevisionId: 'c1',
        ordinal: 0,
      }),
      binding({
        assetRevisionId: 'start',
        role: 'start-frame',
        ordinal: 1,
      }),
      binding({
        assetRevisionId: 'motion',
        role: 'motion',
        ordinal: 2,
      }),
    ];
    const result = planReferences({
      requested,
      maxItems: 1,
      supportedRoles: ['start-frame', 'identity', 'motion'],
      operation: 'video-generate',
    });
    expect(result.selected.map((item) => item.assetRevisionId)).toEqual([
      'start',
    ]);
    expect(result.omitted.map((item) => item.assetRevisionId).sort()).toEqual([
      'identity-a',
      'motion',
    ]);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === 'reference_capacity' && issue.severity === 'blocking',
      ),
    ).toBe(true);
    expect(
      result.issues.some((issue) => issue.message.includes('identity-a')),
    ).toBe(true);
  });

  it('does not treat an output image count as an input reference limit', () => {
    const requested = [
      binding({ assetRevisionId: 'a', ordinal: 0 }),
      binding({ assetRevisionId: 'b', ordinal: 1 }),
    ];
    const result = planReferences({
      requested,
      supportedRoles: ['identity'],
      maxOutputImages: 1,
      requestedOutputCount: 1,
    });
    expect(result.selected).toHaveLength(2);
    expect(
      result.issues.some((issue) => issue.code === 'reference_capacity'),
    ).toBe(false);
  });

  it('blocks when the requested output count exceeds the verified output limit', () => {
    const result = planReferences({
      requested: [binding({ assetRevisionId: 'a', ordinal: 0 })],
      supportedRoles: ['identity'],
      maxOutputImages: 1,
      requestedOutputCount: 4,
    });
    expect(
      result.issues.some(
        (issue) =>
          issue.code === 'output_count' && issue.severity === 'blocking',
      ),
    ).toBe(true);
    expect(result.selected.map((item) => item.assetRevisionId)).toEqual(['a']);
  });

  it('omits references whose MIME type is outside the verified format list', () => {
    const result = planReferences({
      requested: [
        binding({ assetRevisionId: 'png', ordinal: 0 }),
        binding({ assetRevisionId: 'webp', ordinal: 1 }),
      ],
      maxItems: 2,
      supportedRoles: ['identity'],
      inputFormats: ['image/png'],
      mimeByRevisionId: {
        png: 'image/png',
        webp: 'image/webp',
      },
    });
    expect(result.selected.map((item) => item.assetRevisionId)).toEqual([
      'png',
    ]);
    expect(result.omitted.map((item) => item.assetRevisionId)).toEqual([
      'webp',
    ]);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === 'reference_format' && issue.severity === 'blocking',
      ),
    ).toBe(true);
  });

  it('treats a missing input limit as unknown rather than unlimited', () => {
    const result = planReferences({
      requested: [
        binding({ assetRevisionId: 'a', ordinal: 0 }),
        binding({ assetRevisionId: 'b', ordinal: 1 }),
      ],
      supportedRoles: ['identity'],
    });
    expect(result.selected).toHaveLength(2);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === 'reference_limit_unknown' &&
          issue.severity === 'advisory',
      ),
    ).toBe(true);
    expect(
      result.issues.some((issue) => issue.code === 'reference_capacity'),
    ).toBe(false);
  });

  it('omits unsupported roles without dropping supported identities', () => {
    const result = planReferences({
      requested: [
        binding({ assetRevisionId: 'face', role: 'identity', ordinal: 0 }),
        binding({ assetRevisionId: 'voice', role: 'voice', ordinal: 1 }),
      ],
      maxItems: 4,
      supportedRoles: ['identity', 'body', 'look'],
    });
    expect(result.selected.map((item) => item.assetRevisionId)).toEqual([
      'face',
    ]);
    expect(result.omitted.map((item) => item.assetRevisionId)).toEqual([
      'voice',
    ]);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === 'unsupported_role' && issue.severity === 'advisory',
      ),
    ).toBe(true);
  });

  it('never stores a provider URL as an identity reference', () => {
    const result = planReferences({
      requested: [
        binding({
          assetRevisionId: 'https://nano-gpt.example/tmp/face.png?sig=1',
          ordinal: 0,
        }),
        binding({ assetRevisionId: 'local-rev', ordinal: 1 }),
      ],
      maxItems: 2,
      supportedRoles: ['identity'],
    });
    expect(result.selected.map((item) => item.assetRevisionId)).toEqual([
      'local-rev',
    ]);
    expect(result.omitted[0]?.assetRevisionId).toMatch(/^https:/);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === 'provider_url_identity' &&
          issue.severity === 'blocking',
      ),
    ).toBe(true);
  });

  it('does not collapse distinct bindings that reuse one asset past maxItems', () => {
    const requested = [
      binding({
        assetRevisionId: 'shared',
        characterRevisionId: 'c1',
        role: 'identity',
        ordinal: 0,
      }),
      binding({
        assetRevisionId: 'shared',
        characterRevisionId: 'c2',
        role: 'look',
        ordinal: 1,
      }),
    ];
    const result = planReferences({
      requested,
      maxItems: 1,
      supportedRoles: ['identity', 'look'],
    });
    expect(result.selected).toHaveLength(1);
    expect(result.omitted).toHaveLength(1);
    expect(result.selected[0]?.characterRevisionId).toBe('c1');
    expect(result.omitted[0]?.characterRevisionId).toBe('c2');
    expect(
      result.issues.some(
        (issue) =>
          issue.code === 'reference_capacity' && issue.severity === 'blocking',
      ),
    ).toBe(true);
  });

  it('clears a capacity conflict after the user omits the extra identity', () => {
    const requested = [
      binding({
        assetRevisionId: 'keep',
        characterRevisionId: 'c1',
        ordinal: 0,
      }),
      binding({
        assetRevisionId: 'drop',
        characterRevisionId: 'c2',
        ordinal: 1,
      }),
    ];
    const blocked = planReferences({
      requested,
      maxItems: 1,
      supportedRoles: ['identity'],
    });
    expect(
      blocked.issues.some((issue) => issue.code === 'reference_capacity'),
    ).toBe(true);
    const resolved = planReferences({
      requested: requested.filter((item) => item.assetRevisionId === 'keep'),
      maxItems: 1,
      supportedRoles: ['identity'],
    });
    expect(resolved.selected.map((item) => item.assetRevisionId)).toEqual([
      'keep',
    ]);
    expect(resolved.omitted).toEqual([]);
    expect(
      resolved.issues.some((issue) => issue.code === 'reference_capacity'),
    ).toBe(false);
  });
});
