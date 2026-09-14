import { afterEach, describe, expect, it } from 'vitest';

import {
  invalidateStudioLibrary,
  subscribeLibraryInvalidation,
} from '../../apps/studio/src/features/library/library-session';

describe('studio library invalidation', () => {
  let unsubscribe: (() => void) | undefined;

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
  });

  it('notifies mounted subscribers so a settings restore can refresh the gallery', () => {
    let calls = 0;
    unsubscribe = subscribeLibraryInvalidation(() => {
      calls += 1;
    });
    invalidateStudioLibrary();
    expect(calls).toBe(1);
    unsubscribe();
    unsubscribe = undefined;
    invalidateStudioLibrary();
    expect(calls).toBe(1);
  });
});
