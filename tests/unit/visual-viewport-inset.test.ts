import { describe, expect, it } from 'vitest';

import {
  subscribeVisualViewportInset,
  visualViewportBottomInset,
} from '../../apps/studio/src/app/visual-viewport-inset';

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

describe('subscribeVisualViewportInset', () => {
  function fakeRoot(): {
    root: HTMLElement;
    properties: Record<string, string>;
  } {
    const properties: Record<string, string> = {};
    const root = {
      style: {
        setProperty(name: string, value: string) {
          properties[name] = value;
        },
      },
    } as unknown as HTMLElement;
    return { root, properties };
  }

  function fakeWindow(initialHeight: number): {
    view: Window;
    visual: { height: number; offsetTop: number };
    fire(target: 'visual-resize' | 'visual-scroll' | 'window-resize'): void;
  } {
    const visualListeners: Record<string, Array<() => void>> = {};
    const windowListeners: Record<string, Array<() => void>> = {};
    const visual = { height: initialHeight, offsetTop: 0 };
    const view = {
      innerHeight: initialHeight,
      visualViewport: {
        get height() {
          return visual.height;
        },
        get offsetTop() {
          return visual.offsetTop;
        },
        addEventListener(type: string, fn: () => void) {
          (visualListeners[type] ??= []).push(fn);
        },
        removeEventListener(type: string, fn: () => void) {
          visualListeners[type] = (visualListeners[type] ?? []).filter(
            (callback) => callback !== fn,
          );
        },
      },
      addEventListener(type: string, fn: () => void) {
        (windowListeners[type] ??= []).push(fn);
      },
      removeEventListener(type: string, fn: () => void) {
        windowListeners[type] = (windowListeners[type] ?? []).filter(
          (callback) => callback !== fn,
        );
      },
    } as unknown as Window;
    return {
      view,
      visual,
      fire(target) {
        const map =
          target === 'window-resize' ? windowListeners : visualListeners;
        const type = target === 'visual-scroll' ? 'scroll' : 'resize';
        for (const callback of map[type] ?? []) {
          callback();
        }
      },
    };
  }

  it('sets --keyboard-inset when an 844px layout shrinks to a 480px visual viewport', () => {
    const { root, properties } = fakeRoot();
    const { view, visual, fire } = fakeWindow(844);
    const unsubscribe = subscribeVisualViewportInset(root, view);
    expect(properties['--keyboard-inset']).toBe('0px');

    visual.height = 480;
    fire('visual-resize');
    expect(properties['--keyboard-inset']).toBe('364px');

    visual.offsetTop = 40;
    fire('visual-scroll');
    expect(properties['--keyboard-inset']).toBe('324px');

    unsubscribe();
    visual.height = 200;
    fire('visual-resize');
    expect(properties['--keyboard-inset']).toBe('324px');
  });
});
