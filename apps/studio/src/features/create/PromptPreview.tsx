import { useMemo } from 'react';

import {
  compileAcceptChecklist,
  promptModuleChecklist,
} from '@char2vid/domain/debug-log';
import {
  compileModules,
  compilePrompt,
  type PromptModule,
} from '@char2vid/domain/generation/prompt-compiler';
import type { ReferenceBinding } from '@char2vid/domain';

import { studioDebugLog, useChecklistLog } from '../../app/debug-session';

export function PromptPreview({
  modules,
  acceptedText,
  applyProposal,
  bindings,
  identityNotes,
  outfitNotes,
  onAcceptedText,
  onModules,
  onApplyProposal,
}: {
  modules: PromptModule[];
  acceptedText: string;
  applyProposal: boolean;
  bindings: ReferenceBinding[];
  identityNotes?: string;
  outfitNotes?: string;
  onAcceptedText: (value: string) => void;
  onModules: (modules: PromptModule[]) => void;
  onApplyProposal: (value: boolean) => void;
}) {
  const compiled = compileModules(modules);
  const preview = compilePrompt({
    acceptedText,
    bindings,
    identityNotes,
    outfitNotes,
  });
  const moduleChecklist = useMemo(
    () => promptModuleChecklist(modules),
    [modules],
  );
  const acceptChecklist = useMemo(
    () =>
      compileAcceptChecklist({
        compiledChars: compiled.length,
        acceptedChars: acceptedText.trim().length,
        applyProposal,
      }),
    [acceptedText, applyProposal, compiled.length],
  );
  useChecklistLog('create-prompt-modules', moduleChecklist, 'create');
  useChecklistLog('create-compile-accept', acceptChecklist, 'create');

  return (
    <section className="prompt-preview" aria-labelledby="prompt-preview-title">
      <h2 id="prompt-preview-title">Generation text</h2>
      <p>
        Edit or remove modules, then accept the compiled text. Generate uses the
        accepted prompt, not a silent assistant rewrite. Identity and outfit
        notes stay off the wire unless you type them yourself.
      </p>
      <ul className="prompt-module-list">
        {modules.map((module, index) => (
          <li key={module.id}>
            <label>
              <input
                type="checkbox"
                checked={module.enabled}
                aria-label={`Include ${module.kind} module`}
                onChange={(event) => {
                  const next = modules.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, enabled: event.target.checked }
                      : item,
                  );
                  onModules(next);
                }}
              />
              {module.kind} v{module.version}
            </label>
            <textarea
              aria-label={`${module.kind} module text`}
              value={module.text}
              onChange={(event) => {
                const next = modules.map((item, itemIndex) =>
                  itemIndex === index
                    ? {
                        ...item,
                        text: event.target.value,
                        version: item.version + 1,
                      }
                    : item,
                );
                onModules(next);
              }}
            />
            <button
              type="button"
              className="secondary-action"
              onClick={() =>
                onModules(modules.filter((item) => item.id !== module.id))
              }
            >
              Remove {module.kind}
            </button>
          </li>
        ))}
      </ul>
      <p className="library-card-meta">
        Compiled proposal: {compiled || '(empty)'}
      </p>
      <label htmlFor="prompt">Prompt</label>
      <textarea
        id="prompt"
        value={acceptedText}
        placeholder="Describe the image or scene you want to make…"
        onChange={(event) => onAcceptedText(event.target.value)}
      />
      <p className="library-card-meta">Generate text: {preview.finalText}</p>
      <label>
        <input
          type="checkbox"
          checked={applyProposal}
          onChange={(event) => onApplyProposal(event.target.checked)}
        />
        Use compiled proposal at Generate
      </label>
      <button
        type="button"
        className="secondary-action"
        disabled={compiled.length === 0}
        onClick={() => {
          studioDebugLog().info(
            'create.prompt.accept-compiled',
            {
              compiledChars: compiled.length,
              acceptedChars: acceptedText.trim().length,
            },
            { screen: 'create', route: '/create' },
          );
          onAcceptedText(compiled);
        }}
      >
        Accept compiled prompt
      </button>
    </section>
  );
}
