import { describe, expect, it } from 'vitest';

import type { ReferenceBinding } from '../../packages/domain/src/contracts';
import {
  nextReferenceOrdinal,
  omitReferenceBinding,
} from '../../apps/studio/src/features/create/reference-bindings';

const bindings: ReferenceBinding[] = [
  { assetRevisionId: 'a', role: 'identity', ordinal: 0 },
  { assetRevisionId: 'b', role: 'identity', ordinal: 1 },
  { assetRevisionId: 'c', role: 'look', ordinal: 2 },
];

describe('reference bindings', () => {
  it('removes only the omitted binding and keeps remaining ordinals', () => {
    const next = omitReferenceBinding(bindings, 'b');
    expect(next.map((item) => item.assetRevisionId)).toEqual(['a', 'c']);
    expect(next.map((item) => item.ordinal)).toEqual([0, 2]);
  });

  it('assigns the next attach ordinal after a gap rather than reusing length', () => {
    const remaining = omitReferenceBinding(bindings, 'a');
    expect(nextReferenceOrdinal(remaining)).toBe(3);
  });
});
