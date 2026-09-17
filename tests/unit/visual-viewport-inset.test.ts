import { describe, expect, it } from 'vitest';

import { visualViewportBottomInset } from '../../apps/studio/src/app/visual-viewport-inset';

describe('visual viewport bottom inset', () => {
  it('is zero when the visual viewport matches the layout viewport', () => {
    expect(visualViewportBottomInset(480, { height: 480, offsetTop: 0 })).toBe(
      0,
    );
  });

  it('is zero when visualViewport is unavailable', () => {
    expect(visualViewportBottomInset(844, null)).toBe(0);
  });

  it('reports the occluded strip when the visual viewport shrinks', () => {
    expect(visualViewportBottomInset(844, { height: 480, offsetTop: 0 })).toBe(
      364,
    );
  });

  it('includes visualViewport offset when the layout is panned', () => {
    expect(visualViewportBottomInset(844, { height: 480, offsetTop: 40 })).toBe(
      324,
    );
  });
});
