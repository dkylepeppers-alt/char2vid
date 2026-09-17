import { describe, expect, it } from 'vitest';

import type { ReferenceBinding } from '../../packages/domain/src/contracts';
import {
  compileModules,
  compilePrompt,
  createEmptyPromptModules,
  removePromptModule,
  textForGenerate,
  upsertPromptModule,
} from '../../packages/domain/src/generation/prompt-compiler';
import { attachGeneratedOutputs } from '../../packages/domain/src/generation/slot-attach';
import { createInitialRevision } from '../../packages/domain/src/characters/revisions';

const subject: ReferenceBinding = {
  assetRevisionId: 'portrait-1',
  role: 'identity',
  characterRevisionId: 'cr-mira',
  ordinal: 0,
};

describe('prompt compiler', () => {
  it('preserves accepted Unicode prompt text', () => {
    const acceptedText = 'café  indéfinie 日本語 🎨';
    const result = compilePrompt({ acceptedText, bindings: [subject] });
    expect(result.finalText).toBe(acceptedText);
    expect(result.bindings).toEqual([subject]);
  });

  it('does not inject identity or outfit notes as appearance restatements', () => {
    const result = compilePrompt({
      acceptedText: 'turn toward the window',
      bindings: [subject],
      identityNotes: 'silver hair, green eyes, scar on left brow',
      outfitNotes: 'red jacket with gold buttons',
    });
    expect(result.finalText).toBe('turn toward the window');
    expect(result.finalText).not.toContain('silver hair');
    expect(result.finalText).not.toContain('red jacket');
  });

  it('appends only missing ordinal tags for verified adapter syntax', () => {
    const second: ReferenceBinding = {
      assetRevisionId: 'portrait-2',
      role: 'identity',
      characterRevisionId: 'cr-mira-2',
      ordinal: 1,
    };
    const result = compilePrompt({
      acceptedText: 'wave hello @0',
      bindings: [subject, second],
      adapterSyntax: { kind: 'ordinal-mention' },
    });
    expect(result.finalText).toBe('wave hello @0\n@1');
    expect(result.finalText.match(/@0/g)).toEqual(['@0']);
  });

  it('adds only verified adapter binding syntax', () => {
    const without = compilePrompt({
      acceptedText: 'wave hello',
      bindings: [subject],
    });
    expect(without.finalText).toBe('wave hello');
    expect(without.finalText).not.toMatch(/@0/);

    const withSyntax = compilePrompt({
      acceptedText: 'wave hello',
      bindings: [subject],
      adapterSyntax: { kind: 'ordinal-mention' },
    });
    expect(withSyntax.finalText.startsWith('wave hello')).toBe(true);
    expect(withSyntax.finalText).toMatch(/@0/);
    expect(withSyntax.bindings).toEqual([subject]);
  });

  it('does not treat local character names as provider identity tokens', () => {
    const result = compilePrompt({
      acceptedText: 'Keep Mira in frame',
      bindings: [subject],
    });
    expect(result.finalText).toBe('Keep Mira in frame');
    expect(result.finalText).not.toMatch(/@Mira/);
  });

  it('does not replace accepted text with a prompt-assistant proposal at generate time', () => {
    expect(
      textForGenerate({
        acceptedText: 'user accepted this',
        proposalText: 'assistant would rather say this',
        applyProposal: false,
      }),
    ).toBe('user accepted this');
    expect(
      textForGenerate({
        acceptedText: 'user accepted this',
        proposalText: 'assistant would rather say this',
        applyProposal: true,
      }),
    ).toBe('assistant would rather say this');
  });

  it('compiles enabled prompt modules in a stable kind order', () => {
    const compiled = compileModules([
      {
        id: 'scene',
        kind: 'scene',
        text: 'rainy street',
        version: 1,
        enabled: true,
      },
      {
        id: 'change',
        kind: 'change',
        text: 'looks back',
        version: 1,
        enabled: true,
      },
      {
        id: 'subject',
        kind: 'subject',
        text: 'the traveler',
        version: 1,
        enabled: true,
      },
      {
        id: 'lighting',
        kind: 'lighting',
        text: '',
        version: 1,
        enabled: true,
      },
      {
        id: 'camera',
        kind: 'camera',
        text: 'close-up',
        version: 1,
        enabled: false,
      },
    ]);
    expect(compiled).toBe('the traveler. looks back. rainy street');
  });

  it('lets the user edit and remove modules without changing accepted text', () => {
    const empty = createEmptyPromptModules();
    expect(empty.map((module) => module.kind)).toEqual([
      'subject',
      'change',
      'scene',
      'camera',
      'lighting',
      'style',
      'output',
    ]);
    const edited = upsertPromptModule(empty, {
      ...empty[1]!,
      text: 'waves at the camera',
      version: 2,
    });
    const removed = removePromptModule(edited, 'camera');
    expect(removed.some((module) => module.kind === 'camera')).toBe(false);
    expect(compileModules(removed)).toBe('waves at the camera');
    expect(
      textForGenerate({
        acceptedText: 'leave this',
        proposalText: compileModules(removed),
        applyProposal: false,
      }),
    ).toBe('leave this');
  });
});

describe('generated slot attach', () => {
  it('adds saved outputs as candidate slots without replacing the identity', () => {
    const original = createInitialRevision({
      id: 'cr1',
      characterId: 'c1',
      referenceRevisionId: 'portrait1',
    });
    const next = attachGeneratedOutputs(original, 'cr2', ['generated-left'], {
      characterId: 'c1',
      role: 'identity',
      view: 'left',
    });
    expect(original.references).toHaveLength(1);
    expect(next.parentRevisionId).toBe('cr1');
    expect(next.references[0]?.assetRevisionId).toBe('portrait1');
    expect(next.references[0]?.approval).toBe('approved');
    expect(next.references[1]).toEqual({
      assetRevisionId: 'generated-left',
      role: 'identity',
      view: 'left',
      approval: 'candidate',
    });
  });

  it('does not write a new revision when the output is already a slot', () => {
    const original = createInitialRevision({
      id: 'cr1',
      characterId: 'c1',
      referenceRevisionId: 'portrait1',
    });
    const next = attachGeneratedOutputs(original, 'cr2', ['portrait1'], {
      characterId: 'c1',
      role: 'identity',
      view: 'front',
    });
    expect(next).toBe(original);
  });
});
