export type MediaKind = 'image' | 'video' | 'audio' | 'embedding';

export type Operation =
  | 'text'
  | 'image-generate'
  | 'image-edit'
  | 'image-utility'
  | 'video-generate'
  | 'video-edit'
  | 'video-extend'
  | 'video-utility'
  | 'speech'
  | 'music'
  | 'sound-effect'
  | 'transcribe'
  | 'voice-clone';

export type ReferenceRole =
  | 'identity'
  | 'body'
  | 'look'
  | 'pose'
  | 'composition'
  | 'style'
  | 'start-frame'
  | 'end-frame'
  | 'motion'
  | 'voice'
  | 'continuity';

export interface ReferenceBinding {
  assetRevisionId: string;
  role: ReferenceRole;
  characterRevisionId?: string;
  ordinal: number;
}

export interface GenerationDraft {
  clientRequestId: string;
  operation: Operation;
  modelId: string;
  prompt: string;
  references: ReferenceBinding[];
  parameters: Record<string, unknown>;
  projectId?: string;
  shotRevisionId?: string;
}

export interface CapabilityIssue {
  code: string;
  field?: string;
  message: string;
  severity: 'blocking' | 'advisory';
}

export interface ModelDescriptor {
  id: string;
  catalog: 'text' | 'image' | 'video' | 'audio';
  fetchedAt: string;
  raw: Record<string, unknown>;
  operations: Operation[];
  verification: 'metadata' | 'contract-tested' | 'conflict';
}

export type SaveState =
  'absent' | 'downloading' | 'verifying' | 'saved' | 'failed';

export type ProviderState =
  | 'queued'
  | 'submitting'
  | 'submission-unknown'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'recovery-required';

export interface JobReceipt {
  id: string;
  clientRequestId: string;
  providerRunId?: string;
  providerState: ProviderState;
  saveState: SaveState;
  outputRevisionIds: string[];
  errorCode?: string;
}

export interface PreparedInput {
  binding: ReferenceBinding;
  sha256: string;
  mime: string;
  bytes: number;
  source: { type: 'https'; url: string } | { type: 'data'; dataUrl: string };
}

export interface ProviderAdapter {
  validate(draft: GenerationDraft, model: ModelDescriptor): CapabilityIssue[];
  serialize(
    draft: GenerationDraft,
    inputs: PreparedInput[],
  ): { url: string; method: 'POST'; body: unknown };
  normalizeSubmission(
    status: number,
    body: unknown,
    contentType: string,
  ):
    | { kind: 'ticket'; runId: string; rawTicket: unknown }
    | { kind: 'inline'; rawOutput: unknown };
}
