import type { ReferenceBinding } from '../contracts';

export const PROMPT_MODULE_SCHEMA_VERSION = 1;

export const PROMPT_MODULE_KINDS = [
  'subject',
  'change',
  'scene',
  'camera',
  'lighting',
  'style',
  'output',
] as const;

export type PromptModuleKind = (typeof PROMPT_MODULE_KINDS)[number];

export interface PromptModule {
  id: string;
  kind: PromptModuleKind;
  text: string;
  version: number;
  enabled: boolean;
}

export interface AdapterSyntax {
  kind: 'ordinal-mention';
}

export interface CompilePromptInput {
  acceptedText: string;
  bindings: readonly ReferenceBinding[];
  adapterSyntax?: AdapterSyntax;
  identityNotes?: string;
  outfitNotes?: string;
}

export function createEmptyPromptModules(): PromptModule[] {
  return PROMPT_MODULE_KINDS.map((kind) => ({
    id: kind,
    kind,
    text: '',
    version: PROMPT_MODULE_SCHEMA_VERSION,
    enabled: true,
  }));
}

export function upsertPromptModule(
  modules: readonly PromptModule[],
  next: PromptModule,
): PromptModule[] {
  return modules.map((module) =>
    module.id === next.id ? { ...next } : { ...module },
  );
}

export function removePromptModule(
  modules: readonly PromptModule[],
  id: string,
): PromptModule[] {
  return modules.filter((module) => module.id !== id && module.kind !== id);
}

export function compileModules(modules: readonly PromptModule[]): string {
  const order = new Map(
    PROMPT_MODULE_KINDS.map((kind, index) => [kind, index]),
  );
  return [...modules]
    .filter((module) => module.enabled && module.text.trim().length > 0)
    .sort((a, b) => (order.get(a.kind) ?? 99) - (order.get(b.kind) ?? 99))
    .map((module) => module.text.trim())
    .join('. ');
}

function hasOrdinalTag(text: string, tag: string): boolean {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`).test(text);
}

export function compilePrompt(input: CompilePromptInput): {
  finalText: string;
  bindings: ReferenceBinding[];
} {
  void input.identityNotes;
  void input.outfitNotes;
  const bindings = input.bindings.map((binding) => ({ ...binding }));
  let finalText = input.acceptedText;
  if (input.adapterSyntax?.kind === 'ordinal-mention' && bindings.length > 0) {
    const missing = bindings
      .map((binding) => `@${binding.ordinal}`)
      .filter((tag) => !hasOrdinalTag(input.acceptedText, tag));
    if (missing.length > 0) {
      finalText = `${input.acceptedText}\n${missing.join(' ')}`;
    }
  }
  return { finalText, bindings };
}

export function textForGenerate(input: {
  acceptedText: string;
  proposalText: string;
  applyProposal: boolean;
}): string {
  return input.applyProposal ? input.proposalText : input.acceptedText;
}
