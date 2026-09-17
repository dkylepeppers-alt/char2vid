import type {
  CapabilityIssue,
  Operation,
  ReferenceBinding,
  ReferenceRole,
} from '../contracts';

function isProviderUrl(value: string): boolean {
  return /^(https?:\/\/|data:)/i.test(value.trim());
}

export interface PlanReferencesInput {
  requested: readonly ReferenceBinding[];
  maxItems?: number;
  supportedRoles: readonly ReferenceRole[];
  operation?: Operation;
  maxOutputImages?: number;
  requestedOutputCount?: number;
  inputFormats?: readonly string[];
  mimeByRevisionId?: Readonly<Record<string, string>>;
}

export interface ReferencePlan {
  selected: ReferenceBinding[];
  omitted: ReferenceBinding[];
  issues: CapabilityIssue[];
}

function cloneBinding(binding: ReferenceBinding): ReferenceBinding {
  return { ...binding };
}

function byStableOrder(a: ReferenceBinding, b: ReferenceBinding): number {
  if (a.ordinal !== b.ordinal) {
    return a.ordinal - b.ordinal;
  }
  const character = (a.characterRevisionId ?? '').localeCompare(
    b.characterRevisionId ?? '',
  );
  if (character !== 0) {
    return character;
  }
  return a.assetRevisionId.localeCompare(b.assetRevisionId);
}

function isVideoOperation(operation: Operation | undefined): boolean {
  return (
    operation === 'video-generate' ||
    operation === 'video-edit' ||
    operation === 'video-extend' ||
    operation === 'video-utility'
  );
}

function selectionRank(
  binding: ReferenceBinding,
  operation: Operation | undefined,
): number {
  if (isVideoOperation(operation) && binding.role === 'start-frame') {
    return 0;
  }
  if (isVideoOperation(operation) && binding.role === 'end-frame') {
    return 1;
  }
  return 10 + binding.ordinal;
}

function issue(
  code: string,
  severity: CapabilityIssue['severity'],
  message: string,
  field = 'references',
): CapabilityIssue {
  return { code, field, message, severity };
}

export function planReferences(input: PlanReferencesInput): ReferencePlan {
  const supported = new Set(input.supportedRoles);
  const formats = input.inputFormats
    ? new Set(input.inputFormats.map((value) => value.toLowerCase()))
    : undefined;
  const issues: CapabilityIssue[] = [];
  const omitted: ReferenceBinding[] = [];
  const eligible: ReferenceBinding[] = [];

  const requested = [...input.requested].sort(byStableOrder);
  for (const original of requested) {
    const binding = cloneBinding(original);
    if (isProviderUrl(binding.assetRevisionId)) {
      omitted.push(binding);
      issues.push(
        issue(
          'provider_url_identity',
          'blocking',
          'Resolve this reference from a local library revision; provider URLs are not identity anchors.',
        ),
      );
      continue;
    }
    if (!supported.has(binding.role)) {
      omitted.push(binding);
      issues.push(
        issue(
          'unsupported_role',
          'advisory',
          `${binding.assetRevisionId} (${binding.role}) cannot be passed on this route.`,
        ),
      );
      continue;
    }
    const mime = input.mimeByRevisionId?.[binding.assetRevisionId];
    if (formats && mime && !formats.has(mime.toLowerCase())) {
      omitted.push(binding);
      issues.push(
        issue(
          'reference_format',
          'blocking',
          `${binding.assetRevisionId} uses ${mime}, which this route does not accept.`,
        ),
      );
      continue;
    }
    eligible.push(binding);
  }

  if (input.maxItems === undefined) {
    issues.push(
      issue(
        'reference_limit_unknown',
        'advisory',
        'This route has no verified input reference limit, so the planner does not treat capacity as unlimited.',
      ),
    );
  }

  let selected: ReferenceBinding[];
  if (input.maxItems === undefined || eligible.length <= input.maxItems) {
    selected = eligible;
  } else {
    const ranked = [...eligible].sort(
      (a, b) =>
        selectionRank(a, input.operation) - selectionRank(b, input.operation) ||
        byStableOrder(a, b),
    );
    const keep = new Set(
      ranked.slice(0, input.maxItems).map((item) => item.assetRevisionId),
    );
    selected = eligible.filter((item) => keep.has(item.assetRevisionId));
    const overflow = eligible.filter((item) => !keep.has(item.assetRevisionId));
    omitted.push(...overflow);
    const dropped = overflow.map((item) => item.assetRevisionId).join(', ');
    issues.push(
      issue(
        'reference_capacity',
        'blocking',
        `This route accepts at most ${input.maxItems} reference(s). Extra identities remain unsent until you omit them: ${dropped}.`,
      ),
    );
  }

  if (
    input.maxOutputImages !== undefined &&
    input.requestedOutputCount !== undefined &&
    input.requestedOutputCount > input.maxOutputImages
  ) {
    issues.push(
      issue(
        'output_count',
        'blocking',
        `This route accepts at most ${input.maxOutputImages} output image(s).`,
        'parameters',
      ),
    );
  }

  return { selected, omitted, issues };
}

export function supportedRolesForOperation(
  operation: Operation,
): ReferenceRole[] {
  if (
    operation === 'video-generate' ||
    operation === 'video-edit' ||
    operation === 'video-extend' ||
    operation === 'video-utility'
  ) {
    return [
      'start-frame',
      'end-frame',
      'identity',
      'body',
      'look',
      'pose',
      'style',
      'motion',
      'composition',
      'continuity',
    ];
  }
  if (
    operation === 'image-generate' ||
    operation === 'image-edit' ||
    operation === 'image-utility'
  ) {
    return ['identity', 'body', 'look', 'pose', 'style', 'composition'];
  }
  if (operation === 'speech' || operation === 'voice-clone') {
    return ['voice'];
  }
  return [];
}
