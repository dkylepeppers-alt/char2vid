import { describe, expect, it } from 'vitest';

import { generatePreviewText } from '../../apps/studio/src/features/create/generate-preview-text';
import type { PromptModule } from '../../packages/domain/src/generation/prompt-compiler';

const modules: PromptModule[] = [
  {
    id: 'change',
    kind: 'change',
    text: 'wave from the doorway',
    version: 1,
    enabled: true,
  },
];

describe('generate preview text', () => {
  it('shows accepted text until the user applies the compiled proposal', () => {
    expect(
      generatePreviewText({
        acceptedText: 'user accepted this',
        modules,
        applyProposal: false,
      }),
    ).toBe('user accepted this');
  });

  it('shows the compiled proposal when Generate will submit it', () => {
    expect(
      generatePreviewText({
        acceptedText: 'user accepted this',
        modules,
        applyProposal: true,
      }),
    ).toBe('wave from the doorway');
  });
});
