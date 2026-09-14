import { describe, expect, it } from 'vitest';

import { modalFocusTarget } from '../../apps/studio/src/app/modal-focus';

describe('modal focus containment', () => {
  const first = { id: 'first' };
  const middle = { id: 'middle' };
  const last = { id: 'last' };
  const elements = [first, middle, last];

  it('wraps forward navigation from the last control', () => {
    expect(modalFocusTarget(elements, last, false)).toBe(first);
  });

  it('wraps backward navigation from the first control', () => {
    expect(modalFocusTarget(elements, first, true)).toBe(last);
  });

  it('moves outside focus to the first modal control', () => {
    expect(modalFocusTarget(elements, { id: 'outside' }, false)).toBe(first);
  });

  it('leaves focus alone between the modal boundaries', () => {
    expect(modalFocusTarget(elements, middle, false)).toBeNull();
  });
});
