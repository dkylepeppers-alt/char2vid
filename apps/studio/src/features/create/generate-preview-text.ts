import {
  compileModules,
  textForGenerate,
  type PromptModule,
} from '@char2vid/domain/generation/prompt-compiler';

export function generatePreviewText(input: {
  acceptedText: string;
  modules: readonly PromptModule[];
  applyProposal: boolean;
}): string {
  return textForGenerate({
    acceptedText: input.acceptedText,
    proposalText: compileModules(input.modules),
    applyProposal: input.applyProposal,
  });
}
