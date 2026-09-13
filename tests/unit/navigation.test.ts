import { describe, expect, it } from 'vitest';

import {
  resolveBack,
  resolveInitialPath,
} from '../../apps/studio/src/app/navigation';

describe('back navigation', () => {
  it('closes a sheet before navigating away', () => {
    expect(resolveBack('jobs', true)).toBe('close-sheet');
  });

  it('returns through router history after sheets are closed', () => {
    expect(resolveBack(null, true)).toBe('navigate-back');
  });

  it('hands back to Android when router history is empty', () => {
    expect(resolveBack(null, false)).toBe('exit-app');
  });
});

describe('route restoration', () => {
  it('restores a saved destination when the shell opens at root', () => {
    expect(resolveInitialPath('/', 'characters')).toBe('/characters');
  });

  it('keeps an explicit deep link', () => {
    expect(resolveInitialPath('/projects', 'characters')).toBe('/projects');
  });

  it('falls back to the library for an invalid saved destination', () => {
    expect(resolveInitialPath('/', 'unknown')).toBe('/library');
  });

  it('canonicalizes an unknown explicit route to the library', () => {
    expect(resolveInitialPath('/unknown', 'characters')).toBe('/library');
  });
});
