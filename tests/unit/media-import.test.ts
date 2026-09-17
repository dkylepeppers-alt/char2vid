import { describe, expect, it } from 'vitest';

import {
  collapseOptionalRemoteService,
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
  it('hides the optional remote service until the user opens it', () => {
    expect(collapseOptionalRemoteService('android')).toBe(true);
    expect(collapseOptionalRemoteService('web')).toBe(false);
  });
});
