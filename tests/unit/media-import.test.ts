import { describe, expect, it } from 'vitest';

import {
  collapseSecondaryServiceSetup,
  selectMediaImportMode,
} from '../../apps/studio/src/features/library/media-import';

describe('phone media import', () => {
  it('uses the Android document picker instead of a browser File', () => {
    expect(selectMediaImportMode('android')).toBe('native-picker');
  });

  it('keeps the hidden file input on web', () => {
    expect(selectMediaImportMode('web')).toBe('file-input');
  });
});

describe('phone settings', () => {
  it('collapses one-time service setup on Android so sign-in and key stay on screen', () => {
    expect(collapseSecondaryServiceSetup('android')).toBe(true);
    expect(collapseSecondaryServiceSetup('web')).toBe(false);
  });
});
