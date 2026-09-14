import type { Operation } from '@char2vid/domain';

import {
  catalogRecordSchema,
  isJsonObject,
  type CatalogIssue,
  type ControlKind,
  type ControlOption,
  type GenerationCatalog,
  type JsonObject,
  type ModelLimits,
  type NanoGptModelDescriptor,
  type ParameterControl,
} from './catalog-schema';

/** An issue before it is stamped with the owning catalog and model id. */
interface LocalIssue {
  code: string;
  field?: string;
  message: string;
  severity: 'blocking' | 'advisory';
}

/**
 * Flat `supported_parameters` keys that describe limits rather than user
 * controls. Observed across the image and audio catalogs (2026-09-13/14).
 */
const LIMIT_KEYS = [
  'max_images',
  'max_output_images',
  'max_input_images',
  'fixed_image_count',
  'input_image_constraints',
  'min_duration',
  'max_duration',
  'max_chars',
  'max_file_size_mb',
  'max_request_body_mb',
  'supported_formats',
] as const;
const LIMIT_KEY_SET: ReadonlySet<string> = new Set(LIMIT_KEYS);

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return (
      keysA.length === keysB.length &&
      keysA.every((k) => k in b && deepEqual(a[k], b[k]))
    );
  }
  return false;
}

function stringSetEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
    ? value
    : undefined;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function toOptions(items: unknown[]): ControlOption[] {
  return items.map((item) => {
    if (isJsonObject(item) && 'value' in item) {
      const option: ControlOption = { value: item['value'] };
      if (typeof item['label'] === 'string') {
        option.label = item['label'];
      }
      return option;
    }
    return { value: item };
  });
}

function descriptorOptions(desc: JsonObject): ControlOption[] | undefined {
  for (const key of ['options', 'values', 'enum'] as const) {
    const candidate = desc[key];
    if (Array.isArray(candidate)) {
      return toOptions(candidate);
    }
  }
  return undefined;
}

/**
 * Maps the wire `type` to a control kind. Only types observed in the live
 * catalogs or the documentation examples are recognized; anything else is
 * `undefined` so the caller can mark it unsupported instead of guessing.
 */
function classifyDescriptor(desc: JsonObject): ControlKind | undefined {
  const type =
    typeof desc['type'] === 'string' ? desc['type'].toLowerCase() : undefined;
  switch (type) {
    case 'select':
    case 'enum':
      return 'select';
    case 'switch':
    case 'boolean':
      return 'boolean';
    case 'number':
    case 'integer':
    case 'range':
      return 'number';
    case 'text':
    case 'string':
      return 'text';
    case undefined:
      if (descriptorOptions(desc)) {
        return 'select';
      }
      if (
        asNumber(desc['min'] ?? desc['minimum']) !== undefined ||
        asNumber(desc['max'] ?? desc['maximum']) !== undefined
      ) {
        return 'number';
      }
      return undefined;
    default:
      return undefined;
  }
}

function buildControl(
  key: string,
  raw: unknown,
  defaults: JsonObject | undefined,
  issues: LocalIssue[],
): ParameterControl {
  if (Array.isArray(raw)) {
    return { key, kind: 'select', options: toOptions(raw), raw };
  }
  if (!isJsonObject(raw)) {
    return { key, kind: 'unsupported', raw };
  }

  const kind = classifyDescriptor(raw);
  if (kind === undefined) {
    issues.push({
      code: 'unsupported_control',
      field: key,
      severity: 'advisory',
      message: `Control "${key}" uses an unrecognized descriptor type; it is kept for inspection but cannot be edited.`,
    });
    return { key, kind: 'unsupported', raw };
  }

  const control: ParameterControl = { key, kind, raw };
  const options = descriptorOptions(raw);
  if (options) {
    control.options = options;
  }
  const min = asNumber(raw['min'] ?? raw['minimum']);
  const max = asNumber(raw['max'] ?? raw['maximum']);
  if (min !== undefined) {
    control.min = min;
  }
  if (max !== undefined) {
    control.max = max;
  }

  const hasOwnDefault = 'default' in raw;
  const hasMapDefault = defaults !== undefined && key in defaults;
  if (
    hasOwnDefault &&
    hasMapDefault &&
    !deepEqual(raw['default'], defaults[key])
  ) {
    issues.push({
      code: 'default_conflict',
      field: key,
      severity: 'advisory',
      message: `Control "${key}" declares default ${JSON.stringify(raw['default'])} but the defaults map says ${JSON.stringify(defaults[key])}.`,
    });
  } else if (hasOwnDefault) {
    control.default = raw['default'];
  } else if (hasMapDefault) {
    control.default = defaults[key];
  }
  return control;
}

function normalizeControlsDetailed(raw: unknown): {
  controls: ParameterControl[];
  issues: LocalIssue[];
} {
  const controls: ParameterControl[] = [];
  const issues: LocalIssue[] = [];
  if (!isJsonObject(raw)) {
    return { controls, issues };
  }

  const nested = isJsonObject(raw['parameters'])
    ? raw['parameters']
    : undefined;
  const defaults = isJsonObject(raw['defaults']) ? raw['defaults'] : undefined;

  if (nested) {
    for (const [key, value] of Object.entries(nested)) {
      controls.push(buildControl(key, value, defaults, issues));
    }
  }
  for (const [key, value] of Object.entries(raw)) {
    if (nested && (key === 'parameters' || key === 'defaults')) {
      continue;
    }
    controls.push(buildControl(key, value, undefined, issues));
  }
  return { controls, issues };
}

/**
 * Normalizes a `supported_parameters` value (flat arrays, nested
 * `parameters`/`defaults`, enum/range descriptors) into controls. Wire types
 * are preserved: option values and defaults are never coerced. Bare scalars
 * are kept as `unsupported` so nothing is dropped.
 */
export function normalizeControls(raw: unknown): ParameterControl[] {
  return normalizeControlsDetailed(raw).controls;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

function extractLimits(sp: JsonObject): {
  limits: ModelLimits;
  issues: LocalIssue[];
  remaining: JsonObject;
} {
  const issues: LocalIssue[] = [];
  const raw: JsonObject = {};
  const remaining: JsonObject = {};
  for (const [key, value] of Object.entries(sp)) {
    if (LIMIT_KEY_SET.has(key)) {
      raw[key] = value;
    } else {
      remaining[key] = value;
    }
  }
  const limits: ModelLimits = { raw };

  const maxOutputImages = asNumber(sp['max_output_images']);
  const maxImages = asNumber(sp['max_images']);
  if (maxOutputImages !== undefined && maxImages !== undefined) {
    if (maxOutputImages === maxImages) {
      limits.maxOutputImages = maxOutputImages;
    } else {
      issues.push({
        code: 'output_image_limit_conflict',
        field: 'max_images',
        severity: 'blocking',
        message: `max_images (${maxImages}) disagrees with max_output_images (${maxOutputImages}); the output count stays unknown.`,
      });
    }
  } else if (maxOutputImages !== undefined) {
    limits.maxOutputImages = maxOutputImages;
  } else if (maxImages !== undefined) {
    limits.maxOutputImages = maxImages;
  }
  const fixedImageCount = asNumber(sp['fixed_image_count']);
  if (fixedImageCount !== undefined) {
    limits.fixedImageCount = fixedImageCount;
  }

  const constraints = isJsonObject(sp['input_image_constraints'])
    ? sp['input_image_constraints']
    : undefined;
  const maxInputImages = asNumber(sp['max_input_images']);
  const maxItems = constraints ? asNumber(constraints['max_items']) : undefined;
  if (maxInputImages !== undefined && maxItems !== undefined) {
    if (maxInputImages === maxItems) {
      limits.maxInputReferences = maxItems;
    } else {
      issues.push({
        code: 'input_reference_limit_conflict',
        field: 'max_input_images',
        severity: 'blocking',
        message: `max_input_images (${maxInputImages}) disagrees with input_image_constraints.max_items (${maxItems}); the input reference limit stays unknown.`,
      });
    }
  } else if (maxInputImages !== undefined) {
    limits.maxInputReferences = maxInputImages;
  } else if (maxItems !== undefined) {
    limits.maxInputReferences = maxItems;
  } else if (asNumber(sp['max_images']) !== undefined) {
    issues.push({
      code: 'input_reference_limit_unknown',
      field: 'max_images',
      severity: 'advisory',
      message:
        'Only max_images is present; it is not an input reference limit, so the maximum number of input references is unknown.',
    });
  }

  const route =
    constraints && isJsonObject(constraints['route'])
      ? constraints['route']
      : undefined;
  const provider =
    constraints && isJsonObject(constraints['provider'])
      ? constraints['provider']
      : undefined;
  const routeFormats = route ? asStringArray(route['formats']) : undefined;
  const supportedFormats = asStringArray(sp['supported_formats']);
  if (routeFormats !== undefined && supportedFormats !== undefined) {
    if (stringSetEqual(routeFormats, supportedFormats)) {
      limits.inputFormats = routeFormats;
    } else {
      issues.push({
        code: 'input_format_conflict',
        field: 'formats',
        severity: 'blocking',
        message: `route.formats (${JSON.stringify(routeFormats)}) disagrees with supported_formats (${JSON.stringify(supportedFormats)}); input formats stay unknown.`,
      });
    }
  } else if (routeFormats !== undefined) {
    limits.inputFormats = routeFormats;
  } else if (supportedFormats !== undefined) {
    limits.inputFormats = supportedFormats;
  }
  const routeBytes = route ? asNumber(route['max_bytes']) : undefined;
  const providerBytes = provider ? asNumber(provider['max_bytes']) : undefined;
  if (routeBytes !== undefined || providerBytes !== undefined) {
    limits.inputMaxBytes = {};
    if (routeBytes !== undefined) {
      limits.inputMaxBytes.route = routeBytes;
    }
    if (providerBytes !== undefined) {
      limits.inputMaxBytes.provider = providerBytes;
    }
  }
  if (route) {
    const pixels: NonNullable<ModelLimits['inputPixels']> = {};
    const minWidth = asNumber(route['min_width']);
    const minHeight = asNumber(route['min_height']);
    const maxWidth = asNumber(route['max_width']);
    const maxHeight = asNumber(route['max_height']);
    if (minWidth !== undefined) pixels.minWidth = minWidth;
    if (minHeight !== undefined) pixels.minHeight = minHeight;
    if (maxWidth !== undefined) pixels.maxWidth = maxWidth;
    if (maxHeight !== undefined) pixels.maxHeight = maxHeight;
    if (Object.keys(pixels).length > 0) {
      limits.inputPixels = pixels;
    }
  }

  const minDuration = asNumber(sp['min_duration']);
  const maxDuration = asNumber(sp['max_duration']);
  if (minDuration !== undefined || maxDuration !== undefined) {
    limits.durationSeconds = {};
    if (minDuration !== undefined) limits.durationSeconds.min = minDuration;
    if (maxDuration !== undefined) limits.durationSeconds.max = maxDuration;
  }
  const maxChars = asNumber(sp['max_chars']);
  if (maxChars !== undefined) limits.maxChars = maxChars;
  const maxFileSizeMb = asNumber(sp['max_file_size_mb']);
  if (maxFileSizeMb !== undefined) limits.maxFileSizeMb = maxFileSizeMb;
  const maxRequestBodyMb = asNumber(sp['max_request_body_mb']);
  if (maxRequestBodyMb !== undefined)
    limits.maxRequestBodyMb = maxRequestBodyMb;

  return { limits, issues, remaining };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function flag(caps: JsonObject, key: string): boolean {
  return caps[key] === true;
}

/**
 * Conservative mapping from advertised capability flags (and, for audio,
 * the observed `category` values) to app operations. Broad flags do not
 * prove a usable route; P3/P5 verify contracts per route family.
 */
function inferOperations(
  catalog: GenerationCatalog,
  caps: JsonObject,
  category: unknown,
): Operation[] {
  const ops: Operation[] = [];
  switch (catalog) {
    case 'text':
      ops.push('text');
      break;
    case 'image':
      if (flag(caps, 'image_generation')) ops.push('image-generate');
      if (flag(caps, 'image_to_image') || flag(caps, 'inpainting')) {
        ops.push('image-edit');
      }
      break;
    case 'video':
      if (
        flag(caps, 'video_generation') ||
        flag(caps, 'text_to_video') ||
        flag(caps, 'image_to_video')
      ) {
        ops.push('video-generate');
      }
      if (flag(caps, 'video_to_video')) ops.push('video-edit');
      break;
    case 'audio': {
      const musicFlag = Object.keys(caps).some(
        (key) => caps[key] === true && /(^|_)music($|_)/.test(key),
      );
      if (flag(caps, 'text_to_speech')) ops.push('speech');
      if (musicFlag) ops.push('music');
      if (flag(caps, 'text_to_audio')) ops.push('sound-effect');
      if (flag(caps, 'speech_to_text') || flag(caps, 'audio_to_text')) {
        ops.push('transcribe');
      }
      if (flag(caps, 'voice_clone')) ops.push('voice-clone');
      if (ops.length === 0 && typeof category === 'string') {
        const byCategory: Record<string, Operation> = {
          audio_tts: 'speech',
          audio_music: 'music',
          audio_stt: 'transcribe',
          voice_clone: 'voice-clone',
        };
        const op = byCategory[category];
        if (op) ops.push(op);
      }
      break;
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Conflicts between capability flags and controls
// ---------------------------------------------------------------------------

function capabilityControlConflicts(
  caps: JsonObject,
  controls: ParameterControl[],
): LocalIssue[] {
  const issues: LocalIssue[] = [];
  for (const control of controls) {
    if (control.kind !== 'boolean' || control.default !== true) {
      continue;
    }
    const candidates = [control.key];
    const generated = /^generate_(.+)$/.exec(control.key);
    if (generated?.[1]) {
      candidates.push(`${generated[1]}_generation`);
    }
    const contradicted = candidates.find((key) => caps[key] === false);
    if (contradicted) {
      issues.push({
        code: 'capability_control_conflict',
        field: control.key,
        severity: 'advisory',
        message: `capabilities.${contradicted} is false but control "${control.key}" defaults to true; verify the route before enabling this option.`,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

interface RecordEntry {
  key?: string;
  value: unknown;
}

function extractEntries(raw: unknown):
  | {
      entries: RecordEntry[];
      declaredCount?: number;
    }
  | undefined {
  if (Array.isArray(raw)) {
    return { entries: (raw as unknown[]).map((value) => ({ value })) };
  }
  if (!isJsonObject(raw)) {
    return undefined;
  }
  const collection = raw['data'] ?? raw['models'];
  const declared =
    asNumber(isJsonObject(raw['meta']) ? raw['meta']['count'] : undefined) ??
    asNumber(raw['count']);
  const result = (entries: RecordEntry[]) =>
    declared === undefined ? { entries } : { entries, declaredCount: declared };

  if (Array.isArray(collection)) {
    return result((collection as unknown[]).map((value) => ({ value })));
  }
  if (isJsonObject(collection)) {
    return result(
      Object.entries(collection).map(([key, value]) => ({ key, value })),
    );
  }
  if (collection === undefined) {
    const values = Object.values(raw);
    // Bare object maps are catalogs only when at least one value already
    // carries a string id. Key-as-id is reserved for data/models envelopes
    // so `{ error: { message } }` cannot become a model named "error".
    if (
      values.length > 0 &&
      values.every(isJsonObject) &&
      values.some((value) => typeof value['id'] === 'string')
    ) {
      return {
        entries: Object.entries(raw).map(([key, value]) => ({ key, value })),
      };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

function stamp(
  catalog: GenerationCatalog,
  modelId: string | undefined,
  issues: LocalIssue[],
): CatalogIssue[] {
  return issues.map((issue) =>
    modelId === undefined
      ? { ...issue, catalog }
      : { ...issue, catalog, modelId },
  );
}

function verificationFor(
  issues: readonly CatalogIssue[],
): NanoGptModelDescriptor['verification'] {
  return issues.some((issue) => issue.code.endsWith('_conflict'))
    ? 'conflict'
    : 'metadata';
}

function buildModel(
  catalog: GenerationCatalog,
  id: string,
  record: JsonObject,
  fetchedAt: string,
  extraIssues: LocalIssue[],
): NanoGptModelDescriptor {
  const capabilities = isJsonObject(record['capabilities'])
    ? record['capabilities']
    : {};
  const supported = isJsonObject(record['supported_parameters'])
    ? record['supported_parameters']
    : {};

  const { limits, issues: limitIssues, remaining } = extractLimits(supported);
  const { controls, issues: controlIssues } =
    normalizeControlsDetailed(remaining);
  const operations = inferOperations(catalog, capabilities, record['category']);

  const local: LocalIssue[] = [
    ...extraIssues,
    ...limitIssues,
    ...controlIssues,
    ...capabilityControlConflicts(capabilities, controls),
  ];
  if (operations.length === 0) {
    local.push({
      code: 'operations_unknown',
      severity: 'advisory',
      message:
        'No known capability flag maps to an app operation; the model stays visible but needs a verified contract before use.',
    });
  }
  const issues = stamp(catalog, id, local);

  const model: NanoGptModelDescriptor = {
    id,
    catalog,
    fetchedAt,
    raw: record,
    operations,
    verification: verificationFor(issues),
    capabilities,
    controls,
    limits,
    issues,
  };
  if (typeof record['name'] === 'string') {
    model.displayName = record['name'];
  }
  if (typeof record['endpoints'] === 'string') {
    model.endpointsPath = record['endpoints'];
  }
  return model;
}

/**
 * Normalizes one public catalog response. Every record with an exact string
 * id is kept in input order; nothing is merged by display name and nothing
 * is dropped for having unknown fields. Problems become issues.
 */
export function normalizeCatalog(
  catalog: GenerationCatalog,
  raw: unknown,
  fetchedAt: string,
): { models: NanoGptModelDescriptor[]; issues: CatalogIssue[] } {
  const extracted = extractEntries(raw);
  if (!extracted) {
    return {
      models: [],
      issues: stamp(catalog, undefined, [
        {
          code: 'unrecognized_envelope',
          severity: 'blocking',
          message:
            'The catalog response is neither an array nor an object with a data/models collection.',
        },
      ]),
    };
  }

  const envelopeIssues: LocalIssue[] = [];
  const models: NanoGptModelDescriptor[] = [];
  const seen = new Set<string>();

  extracted.entries.forEach(({ key, value }, index) => {
    if (!isJsonObject(value)) {
      envelopeIssues.push({
        code: 'invalid_record',
        field: `[${index}]`,
        severity: 'blocking',
        message: `Record at index ${index} is not an object and was not kept.`,
      });
      return;
    }
    const parsed = catalogRecordSchema.safeParse(value);
    const recordIssues: LocalIssue[] = [];
    let id: string;
    if (parsed.success) {
      id = parsed.data.id;
      if (key !== undefined && key !== id) {
        recordIssues.push({
          code: 'id_key_mismatch',
          field: 'id',
          severity: 'advisory',
          message: `Record is keyed "${key}" but declares id "${id}"; the declared id is used.`,
        });
      }
    } else if (key !== undefined && key.length > 0) {
      id = key;
    } else {
      envelopeIssues.push({
        code: 'record_missing_id',
        field: `[${index}]`,
        severity: 'blocking',
        message: `Record at index ${index} has no string id and was not kept; raw: ${JSON.stringify(value).slice(0, 200)}`,
      });
      return;
    }
    if (seen.has(id)) {
      recordIssues.push({
        code: 'duplicate_id',
        field: 'id',
        severity: 'advisory',
        message: `Exact id "${id}" appears more than once in the ${catalog} catalog; both records are kept.`,
      });
    }
    seen.add(id);
    models.push(buildModel(catalog, id, value, fetchedAt, recordIssues));
  });

  if (
    extracted.declaredCount !== undefined &&
    extracted.declaredCount !== extracted.entries.length
  ) {
    envelopeIssues.push({
      code: 'count_mismatch',
      field: 'meta.count',
      severity: 'advisory',
      message: `Envelope declares ${extracted.declaredCount} records but delivered ${extracted.entries.length}.`,
    });
  }

  return {
    models,
    issues: [
      ...stamp(catalog, undefined, envelopeIssues),
      ...models.flatMap((model) => model.issues),
    ],
  };
}

// ---------------------------------------------------------------------------
// Endpoint metadata merge (image catalog `endpoints` path)
// ---------------------------------------------------------------------------

/** Which normalized limits become unknown when a wire field conflicts. */
const LIMIT_FIELDS_TO_CLEAR: Record<string, (keyof ModelLimits)[]> = {
  max_input_images: ['maxInputReferences'],
  max_items: ['maxInputReferences'],
  input_image_constraints: [
    'maxInputReferences',
    'inputMaxBytes',
    'inputPixels',
    'inputFormats',
  ],
  max_output_images: ['maxOutputImages'],
  max_images: ['maxOutputImages'],
  fixed_image_count: ['fixedImageCount'],
  max_bytes: ['inputMaxBytes'],
  formats: ['inputFormats'],
  supported_formats: ['inputFormats'],
  min_width: ['inputPixels'],
  min_height: ['inputPixels'],
  max_width: ['inputPixels'],
  max_height: ['inputPixels'],
};

function compareSections(
  prefix: string,
  catalogSide: JsonObject | undefined,
  endpointSide: JsonObject | undefined,
  severityFor: (leafKey: string) => 'blocking' | 'advisory',
  issues: LocalIssue[],
  clear: Set<keyof ModelLimits>,
  depth = 0,
): void {
  if (!catalogSide || !endpointSide) {
    return;
  }
  for (const [key, catalogValue] of Object.entries(catalogSide)) {
    if (!(key in endpointSide)) {
      continue;
    }
    const endpointValue = endpointSide[key];
    if (deepEqual(catalogValue, endpointValue)) {
      continue;
    }
    if (
      depth < 2 &&
      isJsonObject(catalogValue) &&
      isJsonObject(endpointValue)
    ) {
      compareSections(
        `${prefix}.${key}`,
        catalogValue,
        endpointValue,
        severityFor,
        issues,
        clear,
        depth + 1,
      );
      continue;
    }
    issues.push({
      code: 'endpoint_metadata_conflict',
      field: `${prefix}.${key}`,
      severity: severityFor(key),
      message: `Catalog says ${JSON.stringify(catalogValue)} but endpoint metadata says ${JSON.stringify(endpointValue)} for ${prefix}.${key}; neither value is chosen.`,
    });
    for (const limitKey of LIMIT_FIELDS_TO_CLEAR[key] ?? []) {
      clear.add(limitKey);
    }
  }
}

/**
 * Merges `GET /api/v1/images/models/{id}/endpoints` metadata into a model by
 * exact id. Disagreements are recorded as issues and the affected normalized
 * limits become unknown; the catalog `raw` record is never rewritten.
 */
export function mergeEndpointMetadata(
  model: NanoGptModelDescriptor,
  endpointMetadata: unknown,
): { model: NanoGptModelDescriptor; issues: CatalogIssue[] } {
  if (!isJsonObject(endpointMetadata) || endpointMetadata['id'] !== model.id) {
    const issues = stamp(model.catalog, model.id, [
      {
        code: 'endpoint_metadata_id_mismatch',
        field: 'id',
        severity: 'blocking',
        message: `Endpoint metadata is for ${JSON.stringify(
          isJsonObject(endpointMetadata)
            ? endpointMetadata['id']
            : endpointMetadata,
        )}, not "${model.id}"; it was not attached.`,
      },
    ]);
    return { model, issues };
  }

  const local: LocalIssue[] = [];
  const clear = new Set<keyof ModelLimits>();
  const catalogSupported = isJsonObject(model.raw['supported_parameters'])
    ? model.raw['supported_parameters']
    : undefined;
  const catalogConstraints =
    catalogSupported &&
    isJsonObject(catalogSupported['input_image_constraints'])
      ? catalogSupported['input_image_constraints']
      : undefined;
  const severityFor = (leafKey: string) =>
    leafKey in LIMIT_FIELDS_TO_CLEAR ? 'blocking' : 'advisory';

  const endpoints = Array.isArray(endpointMetadata['endpoints'])
    ? endpointMetadata['endpoints']
    : [];
  for (const endpoint of endpoints) {
    if (!isJsonObject(endpoint)) {
      continue;
    }
    compareSections(
      'supported_parameters',
      catalogSupported,
      isJsonObject(endpoint['supported_parameters'])
        ? endpoint['supported_parameters']
        : undefined,
      severityFor,
      local,
      clear,
    );
    compareSections(
      'capabilities',
      model.capabilities,
      isJsonObject(endpoint['capabilities'])
        ? endpoint['capabilities']
        : undefined,
      () => 'advisory',
      local,
      clear,
    );
    compareSections(
      'input_reference_constraints',
      catalogConstraints,
      isJsonObject(endpoint['input_reference_constraints'])
        ? endpoint['input_reference_constraints']
        : undefined,
      severityFor,
      local,
      clear,
    );
  }

  const limits: ModelLimits = { ...model.limits };
  for (const key of clear) {
    delete limits[key];
  }
  const issues = stamp(model.catalog, model.id, local);
  const allIssues = [...model.issues, ...issues];
  return {
    model: {
      ...model,
      limits,
      endpointMetadata,
      issues: allIssues,
      verification: verificationFor(allIssues),
    },
    issues,
  };
}
