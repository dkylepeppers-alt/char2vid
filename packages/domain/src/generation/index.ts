export {
  planReferences,
  supportedRolesForOperation,
  type PlanReferencesInput,
  type ReferencePlan,
} from './reference-plan';
export {
  PROMPT_MODULE_KINDS,
  PROMPT_MODULE_SCHEMA_VERSION,
  compileModules,
  compilePrompt,
  createEmptyPromptModules,
  removePromptModule,
  textForGenerate,
  upsertPromptModule,
  type AdapterSyntax,
  type CompilePromptInput,
  type PromptModule,
  type PromptModuleKind,
} from './prompt-compiler';
export {
  freezeRequest,
  identitiesForStaging,
  sha256Utf8,
  type FrozenRequest,
  type ModelSnapshot,
  type StagingIdentity,
} from './request-snapshot';
export {
  attachGeneratedOutputs,
  type CharacterSlotIntent,
} from './slot-attach';
