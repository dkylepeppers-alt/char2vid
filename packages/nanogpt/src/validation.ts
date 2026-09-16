import type {
  CapabilityIssue,
  GenerationDraft,
  Operation,
  PreparedInput,
  ReferenceBinding,
} from '@char2vid/domain';

import { serializeSpeechRequest } from './adapters/audio.ts';
import { serializeImageRequest } from './adapters/image.ts';
import { serializeTextRequest } from './adapters/text.ts';
import { serializeVideoRequest } from './adapters/video.ts';
import type { NanoGptModelDescriptor } from './catalog/catalog-schema.ts';
import { resolveEndpointMetadataUrl } from './contracts/route-contract.ts';

export interface CompatibilityRow {
  model: NanoGptModelDescriptor;
  eligible: boolean;
  reasons: string[];
}

export function getCompatibleModels(
  operation: Operation,
  references: ReferenceBinding[],
  catalog: NanoGptModelDescriptor[],
): CompatibilityRow[] {
  return catalog.map((model) => {
    const reasons: string[] = [];
    if (!model.operations.includes(operation)) {
      reasons.push('incompatible_operation');
    }
    const maxRefs = model.limits.maxInputReferences;
    if (maxRefs !== undefined && references.length > maxRefs) {
      reasons.push('reference_count_exceeded');
    }
    return {
      model,
      eligible: reasons.length === 0,
      reasons,
    };
  });
}

function referenceUrl(input: PreparedInput): string | undefined {
  if (input.source.type === 'https') {
    return input.source.url;
  }
  if (input.source.type === 'data') {
    return input.source.dataUrl;
  }
  return undefined;
}

export function validateDraft(
  draft: GenerationDraft,
  model: NanoGptModelDescriptor,
  inputs: PreparedInput[],
): CapabilityIssue[] {
  const issues: CapabilityIssue[] = [];
  if (draft.modelId !== model.id) {
    issues.push({
      code: 'model_mismatch',
      field: 'modelId',
      severity: 'blocking',
      message: 'Draft model id does not match the selected record.',
    });
  }
  if (!model.operations.includes(draft.operation)) {
    issues.push({
      code: 'incompatible_operation',
      field: 'operation',
      severity: 'blocking',
      message: `${model.id} does not advertise ${draft.operation}.`,
    });
  }
  const maxRefs = model.limits.maxInputReferences;
  if (maxRefs !== undefined && inputs.length > maxRefs) {
    issues.push({
      code: 'reference_count_exceeded',
      field: 'references',
      severity: 'blocking',
      message: `This model accepts at most ${maxRefs} references.`,
    });
  }
  const maxBytes =
    model.limits.inputMaxBytes?.provider ?? model.limits.inputMaxBytes?.route;
  for (const input of inputs) {
    if (maxBytes !== undefined && input.bytes > maxBytes) {
      issues.push({
        code: 'reference_bytes_exceeded',
        field: 'references',
        severity: 'blocking',
        message: `${input.binding.assetRevisionId} exceeds the verified byte limit.`,
      });
    }
  }
  if (typeof draft.parameters.duration === 'string') {
    issues.push({
      code: 'string_duration',
      field: 'duration',
      severity: 'blocking',
      message:
        'Duration must keep its numeric wire type; the string "5" is not 5.',
    });
  }
  if (draft.parameters.stream === true) {
    issues.push({
      code: 'unsupported_stream',
      field: 'stream',
      severity: 'blocking',
      message:
        'Streaming flags are not sent; listed models ignore or reject stream:true.',
    });
  }
  if (model.endpointsPath) {
    const resolved = resolveEndpointMetadataUrl(model.endpointsPath);
    if (!resolved) {
      issues.push({
        code: 'endpoint_origin_rejected',
        field: 'endpoints',
        severity: 'blocking',
        message: 'Endpoint metadata URL is not on nano-gpt.com.',
      });
    }
  }
  if (draft.operation === 'text') {
    issues.push(...serializeTextRequest().issues);
  }
  return issues;
}

export function buildRequest(
  draft: GenerationDraft,
  model: NanoGptModelDescriptor,
  preparedInputs: PreparedInput[],
): {
  request?: { url: string; method: 'POST'; body: unknown };
  issues: CapabilityIssue[];
} {
  const issues = validateDraft(draft, model, preparedInputs);
  if (issues.some((issue) => issue.severity === 'blocking')) {
    return { issues };
  }
  const urls = preparedInputs
    .map(referenceUrl)
    .filter((url): url is string => url !== undefined);
  if (
    draft.operation === 'image-generate' ||
    draft.operation === 'image-edit'
  ) {
    return {
      issues,
      request: serializeImageRequest(
        draft.modelId,
        draft.prompt,
        urls,
        draft.parameters,
      ),
    };
  }
  if (draft.operation === 'video-generate') {
    return {
      issues,
      request: serializeVideoRequest(
        draft.modelId,
        draft.prompt,
        draft.parameters,
        preparedInputs,
      ),
    };
  }
  if (draft.operation === 'speech' || draft.operation === 'music') {
    return {
      issues,
      request: serializeSpeechRequest(
        draft.modelId,
        draft.prompt,
        draft.parameters,
      ),
    };
  }
  return {
    issues: [
      ...issues,
      {
        code: 'unsupported_operation',
        field: 'operation',
        severity: 'blocking',
        message: `${draft.operation} has no serializer in P3.`,
      },
    ],
  };
}
