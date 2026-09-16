import type { Operation, ReferenceBinding } from '@char2vid/domain';
import {
  planReferences,
  supportedRolesForOperation,
  type ReferencePlan,
} from '@char2vid/domain/generation/reference-plan';
import type { NanoGptModelDescriptor } from '@char2vid/nanogpt';

export function planStudioReferences(input: {
  requested: readonly ReferenceBinding[];
  operation: Operation;
  model: NanoGptModelDescriptor | null;
  parameters: Record<string, unknown>;
  mimeByRevisionId?: Readonly<Record<string, string>>;
}): ReferencePlan {
  const outputCount = input.parameters.n;
  return planReferences({
    requested: [...input.requested],
    maxItems: input.model?.limits.maxInputReferences,
    supportedRoles: supportedRolesForOperation(input.operation),
    operation: input.operation,
    maxOutputImages: input.model?.limits.maxOutputImages,
    requestedOutputCount:
      typeof outputCount === 'number' ? outputCount : undefined,
    inputFormats: input.model?.limits.inputFormats,
    mimeByRevisionId: input.mimeByRevisionId,
  });
}
