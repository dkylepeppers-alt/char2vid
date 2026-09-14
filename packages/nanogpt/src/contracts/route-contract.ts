import type { Operation, ReferenceRole } from '@char2vid/domain';

/** Public Nano-GPT origin used for relative catalog `endpoints` paths. */
export const NANOGPT_ORIGIN = 'https://nano-gpt.com';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ENDPOINT_METADATA_PATH = /^\/api\/v1\/images\/models\/.+\/endpoints$/;

export type RouteVerification = 'metadata-only' | 'fixture' | 'observed';
export type RouteAuth = 'none-public' | 'bearer' | 'bearer-or-x-api-key';
export type RequestEncoding =
  'none' | 'json' | 'multipart' | 'json-or-multipart';
export type ResultDelivery = 'catalog' | 'inline' | 'job' | 'inline-or-job';
export type ContractKind = 'generic' | 'family-specific';
export type HttpMethod = 'GET' | 'POST';
export type RouteOperation = Operation | 'discover' | 'status' | 'recover';

export interface RouteEvidence {
  url: string;
  observedDateUtc: string;
}

export interface RouteOverride {
  reason: string;
  expiresOnUtc: string;
  sourceUrl: string;
}

export interface ResponseVariant {
  kind: string;
  description: string;
}

export interface RouteLimits {
  maxItems?: number;
  maxBytes?: number;
  encodedSize?: string;
  formats?: string[];
  durationSeconds?: { min?: number; max?: number };
  notes?: string[];
}

/**
 * Transport contract for one Nano-GPT route family. Fields are only those
 * the 2026-09-13 research snapshot (and 2026-09-14 catalog re-observation)
 * actually documents. Family-specific extras stay in `unresolved`.
 */
export interface RouteContract {
  id: string;
  family: string;
  baseUrl: string;
  path: string;
  method: HttpMethod;
  operation: RouteOperation;
  auth: RouteAuth;
  requestEncoding: RequestEncoding;
  allowedFields: string[];
  roleMapping: Partial<Record<ReferenceRole, string>>;
  limits: RouteLimits;
  responseVariants: ResponseVariant[];
  resultDelivery: ResultDelivery;
  contractKind: ContractKind;
  unresolved: string[];
  verification: RouteVerification;
  fixturePath?: string;
  evidence: RouteEvidence[];
  override?: RouteOverride;
}

const DOCS = 'https://docs.nano-gpt.com';
const SNAPSHOT = '2026-09-13';
const REOBSERVED = '2026-09-14';

function docs(path: string, date = SNAPSHOT): RouteEvidence {
  return { url: `${DOCS}${path}`, observedDateUtc: date };
}

function live(path: string, date = REOBSERVED): RouteEvidence {
  return { url: `${NANOGPT_ORIGIN}${path}`, observedDateUtc: date };
}

export function validateRouteRegistry(
  contracts: readonly RouteContract[],
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const contract of contracts) {
    if (seen.has(contract.id)) {
      problems.push(`duplicate id ${contract.id}`);
    }
    seen.add(contract.id);
    if (contract.evidence.length === 0) {
      problems.push(`${contract.id} missing evidence`);
    }
    for (const item of contract.evidence) {
      if (!ISO_DATE.test(item.observedDateUtc)) {
        problems.push(`${contract.id} malformed observedDateUtc`);
      }
    }
    if (contract.verification === 'observed' && !contract.fixturePath) {
      problems.push(`${contract.id} claims observed without fixturePath`);
    }
    if (
      contract.verification === 'metadata-only' &&
      contract.unresolved.length === 0
    ) {
      problems.push(`${contract.id} metadata-only must state unresolved items`);
    }
    if (
      contract.override !== undefined &&
      !ISO_DATE.test(contract.override.expiresOnUtc)
    ) {
      problems.push(`${contract.id} override expiresOnUtc`);
    }
  }
  return problems;
}

/** Join `baseUrl` + `path` without inventing a `/v1` prefix. */
export function routeUrl(
  contract: RouteContract,
  query?: Record<string, string>,
): string {
  const url = new URL(contract.path, `${contract.baseUrl.replace(/\/$/, '')}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function getRouteContract(id: string): RouteContract {
  const found = ROUTE_CONTRACTS.find((contract) => contract.id === id);
  if (!found) {
    throw new Error(`unknown route contract ${id}`);
  }
  return found;
}

/**
 * Resolve an image catalog `endpoints` path against Nano-GPT only.
 * Other origins, http, protocol-relative URLs, and non-endpoint paths
 * are rejected before credentials may be attached (design §9).
 */
export function resolveEndpointMetadataUrl(
  pathOrUrl: string,
): string | undefined {
  if (pathOrUrl.startsWith('//')) {
    return undefined;
  }
  try {
    const url = pathOrUrl.startsWith('/')
      ? new URL(pathOrUrl, NANOGPT_ORIGIN)
      : new URL(pathOrUrl);
    if (url.protocol !== 'https:' || url.origin !== NANOGPT_ORIGIN) {
      return undefined;
    }
    if (!ENDPOINT_METADATA_PATH.test(url.pathname)) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

const IMAGE_ROLES: Partial<Record<ReferenceRole, string>> = {
  identity: 'input_references',
  body: 'input_references',
  look: 'input_references',
  pose: 'input_references',
  composition: 'input_references',
  style: 'input_references',
};

/**
 * Registry populated only from research-snapshot evidence. No generation
 * response was captured, so no entry is `observed`. Catalog/endpoint
 * rows that have a sanitized or authored fixture are `fixture`; paid
 * routes are `metadata-only` with explicit unresolved items.
 */
export const ROUTE_CONTRACTS: readonly RouteContract[] = [
  {
    id: 'catalog.text',
    family: 'catalog',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/v1/models',
    method: 'GET',
    operation: 'discover',
    auth: 'none-public',
    requestEncoding: 'none',
    allowedFields: ['detailed'],
    roleMapping: {},
    limits: {},
    responseVariants: [
      {
        kind: 'list',
        description: 'object/data envelope of text-model records',
      },
    ],
    resultDelivery: 'catalog',
    contractKind: 'generic',
    unresolved: [],
    verification: 'fixture',
    fixturePath: 'tests/fixtures/nanogpt/catalogs.json#fixtures.textMinimal',
    evidence: [
      live('/api/v1/models?detailed=true'),
      docs('/api-reference/endpoint/models.md'),
    ],
  },
  {
    id: 'catalog.image',
    family: 'catalog',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/v1/images/models',
    method: 'GET',
    operation: 'discover',
    auth: 'none-public',
    requestEncoding: 'none',
    allowedFields: [],
    roleMapping: {},
    limits: {},
    responseVariants: [
      {
        kind: 'list',
        description:
          'object/data/meta envelope; per-record endpoints path for metadata',
      },
    ],
    resultDelivery: 'catalog',
    contractKind: 'generic',
    unresolved: [],
    verification: 'fixture',
    fixturePath:
      'tests/fixtures/nanogpt/catalogs.json#fixtures.imageCatalogGptImage2',
    evidence: [
      live('/api/v1/images/models'),
      docs('/api-reference/endpoint/image-api-models.md'),
    ],
  },
  {
    id: 'catalog.image.legacy',
    family: 'catalog',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/v1/image-models',
    method: 'GET',
    operation: 'discover',
    auth: 'none-public',
    requestEncoding: 'none',
    allowedFields: ['detailed'],
    roleMapping: {},
    limits: {
      notes: [
        'Overlaps the normalized image catalog by exact ID; do not add its records into the image generation catalog.',
      ],
    },
    responseVariants: [
      { kind: 'list', description: 'legacy compatibility image catalog' },
    ],
    resultDelivery: 'catalog',
    contractKind: 'generic',
    unresolved: [
      'Whether detailed=true changes control shapes versus the normalized catalog.',
    ],
    verification: 'metadata-only',
    evidence: [
      live('/api/v1/image-models'),
      docs('/api-reference/endpoint/image-models.md'),
    ],
  },
  {
    id: 'catalog.video',
    family: 'catalog',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/v1/video-models',
    method: 'GET',
    operation: 'discover',
    auth: 'none-public',
    requestEncoding: 'none',
    allowedFields: ['detailed'],
    roleMapping: {},
    limits: {},
    responseVariants: [
      {
        kind: 'list',
        description:
          'object/data/meta with nested supported_parameters.parameters/defaults',
      },
    ],
    resultDelivery: 'catalog',
    contractKind: 'generic',
    unresolved: [],
    verification: 'fixture',
    fixturePath: 'tests/fixtures/nanogpt/catalogs.json#fixtures.videoNested',
    evidence: [
      live('/api/v1/video-models?detailed=true'),
      docs('/api-reference/endpoint/video-models.md'),
    ],
  },
  {
    id: 'catalog.audio',
    family: 'catalog',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/v1/audio-models',
    method: 'GET',
    operation: 'discover',
    auth: 'none-public',
    requestEncoding: 'none',
    allowedFields: [],
    roleMapping: {},
    limits: {},
    responseVariants: [
      { kind: 'list', description: 'object/data/meta audio-model records' },
    ],
    resultDelivery: 'catalog',
    contractKind: 'generic',
    unresolved: [],
    verification: 'fixture',
    fixturePath: 'tests/fixtures/nanogpt/catalogs.json#fixtures.audioMixed',
    evidence: [
      live('/api/v1/audio-models'),
      docs('/api-reference/endpoint/audio-models.md'),
    ],
  },
  {
    id: 'image.endpoint-metadata',
    family: 'image-normalized',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/v1/images/models/{modelId}/endpoints',
    method: 'GET',
    operation: 'discover',
    auth: 'none-public',
    requestEncoding: 'none',
    allowedFields: [],
    roleMapping: {},
    limits: {},
    responseVariants: [
      {
        kind: 'endpoints',
        description:
          'id plus endpoints[] of supported_parameters, constraints, capabilities',
      },
    ],
    resultDelivery: 'catalog',
    contractKind: 'generic',
    unresolved: [],
    verification: 'fixture',
    fixturePath:
      'tests/fixtures/nanogpt/catalogs.json#fixtures.imageEndpointMetadataGptImage2',
    evidence: [
      live('/api/v1/images/models/gpt-image-2/endpoints'),
      docs('/api-reference/endpoint/image-api-model-endpoints.md'),
    ],
  },
  {
    id: 'image.normalized.generate',
    family: 'image-normalized',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/v1/images',
    method: 'POST',
    operation: 'image-generate',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'json',
    allowedFields: [
      'model',
      'prompt',
      'n',
      'nImages',
      'resolution',
      'aspect_ratio',
      'quality',
      'output_format',
      'seed',
      'input_references',
    ],
    roleMapping: IMAGE_ROLES,
    limits: {
      formats: ['png', 'jpeg', 'webp'],
      maxBytes: 31457280,
      encodedSize:
        'Route preflight max_bytes 31457280 applies to decoded image bytes; encoded data-URL size is UNVERIFIED.',
      notes: [
        'Per-model max_input_images / input_image_constraints.max_items override the global item cap.',
        'Seedream 5.0 Pro provider max_bytes is 10485760, tighter than the route 31457280.',
        'Do not mix input_references with imageDataUrl(s)/image_url/images.',
        'stream:true and provider passthrough are documented as unsupported.',
      ],
    },
    responseVariants: [
      {
        kind: 'inline-json',
        description:
          'Documented JSON success; exact output envelope (url vs b64) is not captured.',
      },
    ],
    resultDelivery: 'inline',
    contractKind: 'generic',
    unresolved: [
      'Exact success envelope (url, b64_json, or other) has no captured generation response.',
      'n versus nImages precedence is documented but not generation-tested.',
      'Whether encoded data-URL size counts against route max_bytes.',
      'Seedream 1k/2k resolution labels are not pixel dimensions.',
    ],
    verification: 'metadata-only',
    evidence: [
      docs('/api-reference/endpoint/image-api-generate.md'),
      docs('/api-reference/image-generation.md'),
      live('/api/v1/images/models/bytedance/seedream-v5.0-pro/endpoints'),
    ],
  },
  {
    id: 'image.compat.generations',
    family: 'image-compat',
    baseUrl: NANOGPT_ORIGIN,
    path: '/v1/images/generations',
    method: 'POST',
    operation: 'image-generate',
    auth: 'bearer',
    requestEncoding: 'json',
    allowedFields: [
      'model',
      'prompt',
      'n',
      'size',
      'response_format',
      'user',
      'imageDataUrl',
      'imageDataUrls',
      'maskDataUrl',
      'strength',
      'guidance_scale',
      'num_inference_steps',
      'seed',
      'kontext_max_mode',
    ],
    roleMapping: {
      identity: 'imageDataUrl',
      look: 'imageDataUrls',
      composition: 'imageDataUrls',
    },
    limits: {
      encodedSize:
        'Docs say uploads should be 4 MB or smaller after encoding. Direct URL input is not supported.',
      notes: [
        'OpenAPI overrides the default /api server to https://nano-gpt.com for this path.',
        'The research summary table listed /api/v1/images/generations; the endpoint page and OpenAPI use /v1/images/generations. The page+OpenAPI path is recorded here.',
        'Auth on this path is Bearer only (page Auth line and OpenAPI bearerAuth); x-api-key is not documented here.',
      ],
    },
    responseVariants: [
      {
        kind: 'b64_json',
        description: 'data[i].b64_json default; never both url and b64_json',
      },
      {
        kind: 'url',
        description:
          'data[i].url when response_format=url; signed URL ~1 hour; may fall back to b64_json',
      },
    ],
    resultDelivery: 'inline',
    contractKind: 'generic',
    unresolved: [
      'No captured generation response; url versus b64 fallback not observed.',
      'Mask/inpainting support is model-specific and untested.',
    ],
    verification: 'metadata-only',
    evidence: [docs('/api-reference/endpoint/image-generation-openai.md')],
    override: {
      reason:
        'OpenAPI path /v1/images/generations uses server url https://nano-gpt.com instead of the default https://nano-gpt.com/api.',
      expiresOnUtc: '2026-12-13',
      sourceUrl: `${DOCS}/api-reference/endpoint/image-generation-openai.md`,
    },
  },
  {
    id: 'image.compat.edits',
    family: 'image-compat',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/v1/images/edits',
    method: 'POST',
    operation: 'image-edit',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'json-or-multipart',
    allowedFields: [
      'prompt',
      'image',
      'image[]',
      'mask',
      'model',
      'size',
      'n',
      'imageDataUrl',
      'imageDataUrls',
      'maskDataUrl',
    ],
    roleMapping: {
      identity: 'image',
      look: 'image[]',
      composition: 'image[]',
    },
    limits: {
      notes: [
        'Multipart uploads have undocumented strict size limits.',
        'Generated URLs are temporary.',
      ],
    },
    responseVariants: [
      {
        kind: 'url-or-b64',
        description: 'Same conventions as compat generations: url or b64_json',
      },
    ],
    resultDelivery: 'inline',
    contractKind: 'generic',
    unresolved: [
      'Multipart size limit not quantified in docs.',
      'Which models accept mask for inpainting is metadata-only.',
      'No captured edit response.',
    ],
    verification: 'metadata-only',
    evidence: [docs('/api-reference/endpoint/image-edits.md')],
  },
  {
    id: 'image.compat.edit',
    family: 'image-compat',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/v1/images/edit',
    method: 'POST',
    operation: 'image-edit',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'json-or-multipart',
    allowedFields: [
      'prompt',
      'image',
      'image[]',
      'mask',
      'model',
      'size',
      'n',
      'imageDataUrl',
      'imageDataUrls',
      'maskDataUrl',
    ],
    roleMapping: {
      identity: 'image',
      look: 'image[]',
      composition: 'image[]',
    },
    limits: {
      notes: ['Documented alias of /api/v1/images/edits.'],
    },
    responseVariants: [
      {
        kind: 'url-or-b64',
        description: 'Same conventions as image.compat.edits',
      },
    ],
    resultDelivery: 'inline',
    contractKind: 'generic',
    unresolved: ['Whether the alias is byte-identical to /edits is untested.'],
    verification: 'metadata-only',
    evidence: [docs('/api-reference/endpoint/image-edits.md')],
  },
  {
    id: 'image.midjourney.status',
    family: 'image-async',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/check-midjourney-status',
    method: 'POST',
    operation: 'status',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'json',
    allowedFields: ['task_id'],
    roleMapping: {},
    limits: {},
    responseVariants: [
      {
        kind: 'status-json',
        description:
          'status enum SUCCESS/FAILED/PENDING/RUNNING/IN_PROGRESS/submitted/NOT_START/unknown plus optional imageUrl',
      },
    ],
    resultDelivery: 'job',
    contractKind: 'family-specific',
    unresolved: [
      'Which image submit responses return a Midjourney task_id is unobserved.',
      'Output URL expiry not documented on this page.',
    ],
    verification: 'metadata-only',
    evidence: [docs('/api-reference/endpoint/check-midjourney-status.md')],
  },
  {
    id: 'video.generate',
    family: 'video',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/generate-video',
    method: 'POST',
    operation: 'video-generate',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'json',
    allowedFields: [
      'model',
      'prompt',
      'negative_prompt',
      'duration',
      'seconds',
      'aspect_ratio',
      'orientation',
      'resolution',
      'size',
      'mode',
      'generateAudio',
      'seed',
      'imageDataUrl',
      'imageUrl',
      'imageAttachmentId',
      'referenceImages',
      'audioUrl',
      'audioDataUrl',
      'videoUrl',
      'videoDataUrl',
      'videoAttachmentId',
    ],
    roleMapping: {
      'start-frame': 'imageUrl',
      continuity: 'videoUrl',
      motion: 'videoUrl',
      voice: 'audioUrl',
    },
    limits: {
      encodedSize:
        'Guide caps inline uploads at 4 MB; endpoint prose recommends base64 for larger/private assets. Conflict recorded, not resolved.',
      durationSeconds: { max: 120 },
      notes: [
        '120s max applies to documented source-video extend models, not all generate models.',
        'Seedance 2.5 advertises audio_generation false while generate_audio defaults true — do not enable from flags alone.',
      ],
    },
    responseVariants: [
      {
        kind: 'ticket',
        description:
          '202 { runId, id, model, status: pending, cost?, paymentSource?, remainingBalance? }',
      },
    ],
    resultDelivery: 'job',
    contractKind: 'generic',
    unresolved: [
      'Inline 4 MB versus base64-for-larger conflict is unresolved.',
      'Family-specific fields (LongStories storyConfig, Kling lipsync, Pixverse effects, camera_fix aliases) are not in allowedFields.',
      'generateAudio versus catalog generate_audio switch type/default conflict.',
      'imageDataUrl versus imageUrl precedence when both are sent.',
    ],
    verification: 'metadata-only',
    evidence: [
      docs('/api-reference/endpoint/video-generation.md'),
      docs('/api-reference/video-generation.md'),
      live('/api/v1/video-models?detailed=true'),
    ],
  },
  {
    id: 'video.status',
    family: 'video',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/video/status',
    method: 'GET',
    operation: 'status',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'none',
    allowedFields: ['requestId', 'runId'],
    roleMapping: {},
    limits: {},
    responseVariants: [
      {
        kind: 'nested-uppercase',
        description:
          'Prose examples: data.status IN_QUEUE/IN_PROGRESS/COMPLETED/FAILED/CANCELED and data.output.video.url',
      },
      {
        kind: 'flat-lowercase',
        description:
          'Embedded OpenAPI schema: status queued/processing/completed/failed/cancelled/unknown and videoUrl',
      },
    ],
    resultDelivery: 'job',
    contractKind: 'generic',
    unresolved: [
      'Which status envelope a live job returns is unobserved; both variants must be accepted later, neither chosen now.',
      'Output URL expiry not documented on the unified status page.',
    ],
    verification: 'metadata-only',
    evidence: [docs('/api-reference/endpoint/video-status-unified.md')],
  },
  {
    id: 'video.recover',
    family: 'video',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/generate-video/recover',
    method: 'GET',
    operation: 'recover',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'none',
    allowedFields: ['model', 'limit', 'conversationUUID'],
    roleMapping: {},
    limits: {
      maxItems: 50,
      notes: ['Default limit 10, max 50; 20 requests/minute per IP.'],
    },
    responseVariants: [
      {
        kind: 'list',
        description:
          'data[] of recent runs with runId/id/model/status/createdAt',
      },
    ],
    resultDelivery: 'job',
    contractKind: 'generic',
    unresolved: [
      'Recovery is bounded recent-runs, not complete history; matching policy is untested.',
    ],
    verification: 'metadata-only',
    evidence: [docs('/api-reference/endpoint/video-recover.md')],
  },
  {
    id: 'video.extend',
    family: 'video',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/generate-video/extend',
    method: 'POST',
    operation: 'video-extend',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'json',
    allowedFields: ['runId', 'taskId', 'index'],
    roleMapping: {},
    limits: {
      notes: [
        'Midjourney task-based extend only. Other extend models use video.generate with a source video.',
        'Does not accept video/videoUrl/videoDataUrl/videoAttachmentId.',
      ],
    },
    responseVariants: [
      {
        kind: 'ticket',
        description: '202 runId/id/status/model matching generate-video',
      },
    ],
    resultDelivery: 'job',
    contractKind: 'family-specific',
    unresolved: [
      'OpenAPI required taskId; prose prefers runId with taskId as legacy alias.',
      'Only midjourney-video is documented for this path.',
    ],
    verification: 'metadata-only',
    evidence: [docs('/api-reference/endpoint/video-extend.md')],
  },
  {
    id: 'video.content',
    family: 'video',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/generate-video/content',
    method: 'GET',
    operation: 'video-utility',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'none',
    allowedFields: ['runId', 'model', 'variant'],
    roleMapping: {},
    limits: {
      notes: ['model must be sora-2; variant video|thumbnail|spritesheet.'],
    },
    responseVariants: [
      {
        kind: 'content-json',
        description: 'Underspecified JSON content proxy for Sora 2',
      },
    ],
    resultDelivery: 'inline',
    contractKind: 'family-specific',
    unresolved: [
      'Response body schema is additionalProperties: true in OpenAPI.',
      'Whether bytes are inline or URL is unobserved.',
    ],
    verification: 'metadata-only',
    evidence: [docs('/api-reference/endpoint/video-content.md')],
  },
  {
    id: 'audio.speech',
    family: 'audio-speech',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/v1/audio/speech',
    method: 'POST',
    operation: 'speech',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'json',
    allowedFields: [
      'model',
      'input',
      'voice',
      'response_format',
      'speed',
      'instructions',
      'stream',
    ],
    roleMapping: { voice: 'voice' },
    limits: {
      encodedSize:
        'Billed by input characters for TTS, not output bytes. Max input length is model-dependent.',
      notes: [
        'Music models treat input as a creative prompt and ignore voice.',
        'stream:true is ignored by models not listed as streaming-capable.',
      ],
    },
    responseVariants: [
      {
        kind: 'inline-bytes',
        description:
          '200 raw audio body; Content-Type depends on format/provider',
      },
      {
        kind: 'chunked-bytes',
        description: 'stream:true chunked audio; no Content-Length',
      },
    ],
    resultDelivery: 'inline',
    contractKind: 'generic',
    unresolved: [
      'No captured audio bytes. Music duration defaults (~10-30s in the music guide) are not a contract.',
      'Which audio catalog records are TTS versus music versus transformation is metadata-only.',
    ],
    verification: 'metadata-only',
    evidence: [
      docs('/api-reference/endpoint/speech.md'),
      docs('/api-reference/music-generation.md'),
    ],
  },
  {
    id: 'audio.tts',
    family: 'audio-tts',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/tts',
    method: 'POST',
    operation: 'speech',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'json',
    allowedFields: [
      'text',
      'model',
      'voice',
      'speed',
      'speaker_voice_embedding_file_url',
      'reference_text',
      'language',
    ],
    roleMapping: { voice: 'voice' },
    limits: {
      notes: [
        'Inline bytes, JSON audioUrl, and 202 pending tickets are all documented.',
        'Retain ticket cost/paymentSource for status polling/refunds.',
      ],
    },
    responseVariants: [
      { kind: 'inline-bytes', description: '200 binary audio (OpenAI models)' },
      {
        kind: 'inline-json-url',
        description: '200 JSON with audioUrl to download',
      },
      {
        kind: 'ticket',
        description: '202 status pending with runId/model/cost/paymentSource',
      },
    ],
    resultDelivery: 'inline-or-job',
    contractKind: 'generic',
    unresolved: [
      'Which models return bytes versus URL versus ticket is not captured.',
      'Qwen embedding URL retention is provider-hosted (~7 days) and untested here.',
    ],
    verification: 'metadata-only',
    evidence: [
      docs('/api-reference/endpoint/tts.md'),
      docs('/api-reference/text-to-speech.md'),
    ],
  },
  {
    id: 'audio.tts.status',
    family: 'audio-tts',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/tts/status',
    method: 'GET',
    operation: 'status',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'none',
    allowedFields: ['runId', 'model', 'cost', 'paymentSource', 'isApiRequest'],
    roleMapping: {},
    limits: {},
    responseVariants: [
      {
        kind: 'pending',
        description: 'status pending with optional queuePosition',
      },
      {
        kind: 'completed-url',
        description: 'status completed with audioUrl and contentType',
      },
      { kind: 'error', description: 'status error with error/code' },
    ],
    resultDelivery: 'job',
    contractKind: 'generic',
    unresolved: ['audioUrl expiry is not documented on the status page.'],
    verification: 'metadata-only',
    evidence: [docs('/api-reference/endpoint/tts-status.md')],
  },
  {
    id: 'audio.transcriptions',
    family: 'audio-stt',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/v1/audio/transcriptions',
    method: 'POST',
    operation: 'transcribe',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'json-or-multipart',
    allowedFields: [
      'file',
      'model',
      'language',
      'file_url',
      'audio_url',
      'response_format',
      'timestamp_granularities',
    ],
    roleMapping: { voice: 'file' },
    limits: {
      formats: ['MP3', 'OGG', 'WAV', 'M4A', 'AAC'],
      notes: [
        'Video formats MP4/MOV/AVI/MKV/WEBM are model-dependent.',
        'Whisper-Large-V3 catalog advertises word_timestamps and timestamp_granularities; whether the compat route returns them is unobserved.',
      ],
    },
    responseVariants: [
      {
        kind: 'text-json',
        description:
          'Documented { text, language, duration }; timestamps unconfirmed',
      },
    ],
    resultDelivery: 'inline',
    contractKind: 'generic',
    unresolved: [
      'Word/segment timestamps on this OpenAI-compat route are not in the documented example envelope.',
      'qwen-voice-clone / minimax-voice-clone via this path are a different operation.',
    ],
    verification: 'metadata-only',
    evidence: [
      docs('/api-reference/endpoint/audio-transcriptions.md'),
      docs('/api-reference/speech-to-text.md'),
      live('/api/v1/audio-models'),
    ],
  },
  {
    id: 'audio.transcribe',
    family: 'audio-stt',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/transcribe',
    method: 'POST',
    operation: 'transcribe',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'json-or-multipart',
    allowedFields: [
      'audio',
      'audioUrl',
      'model',
      'language',
      'actualDuration',
      'diarize',
      'tagAudioEvents',
    ],
    roleMapping: { voice: 'audioUrl' },
    limits: {
      formats: ['MP3', 'WAV', 'M4A', 'OGG', 'AAC'],
      maxBytes: 3145728,
      notes: [
        'Direct upload ≤3MB; URL upload ≤500MB (Whisper catalog also lists max_file_size_mb 500 and max_request_body_mb 4).',
      ],
    },
    responseVariants: [
      {
        kind: 'sync-json',
        description: '200 { transcription, metadata } for most models',
      },
      {
        kind: 'ticket',
        description:
          '202 { runId, status pending } for Elevenlabs-STT and clone models',
      },
    ],
    resultDelivery: 'inline-or-job',
    contractKind: 'generic',
    unresolved: [
      'Word timestamps are documented for Elevenlabs-STT completion, not for Whisper sync responses.',
      '3MB multipart versus 4MB catalog max_request_body_mb disagreement is unresolved.',
    ],
    verification: 'metadata-only',
    evidence: [
      docs('/api-reference/endpoint/transcribe.md'),
      docs('/api-reference/speech-to-text.md'),
    ],
  },
  {
    id: 'audio.transcribe.status',
    family: 'audio-stt',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/transcribe/status',
    method: 'POST',
    operation: 'status',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'json',
    allowedFields: [
      'runId',
      'cost',
      'paymentSource',
      'isApiRequest',
      'fileName',
      'fileSize',
      'chargedDuration',
      'diarize',
    ],
    roleMapping: {},
    limits: {},
    responseVariants: [
      { kind: 'pending', description: 'status pending|processing' },
      {
        kind: 'completed',
        description:
          'status completed with transcription, optional words[] and diarization',
      },
      { kind: 'failed', description: 'status failed with error' },
    ],
    resultDelivery: 'job',
    contractKind: 'generic',
    unresolved: [
      'Whether Whisper word_timestamps ever appear on this async status route is unobserved (route is documented for Elevenlabs-STT).',
    ],
    verification: 'metadata-only',
    evidence: [docs('/api-reference/endpoint/transcribe-status.md')],
  },
  {
    id: 'audio.voice-clone.minimax',
    family: 'audio-voice-clone',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/voice-clone/minimax',
    method: 'POST',
    operation: 'voice-clone',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'json-or-multipart',
    allowedFields: [
      'audio',
      'audioUrl',
      'customVoiceId',
      'custom_voice_id',
      'voiceCloneModel',
      'model',
      'needNoiseReduction',
      'needVolumeNormalization',
      'accuracy',
      'text',
      'previewText',
    ],
    roleMapping: { voice: 'audioUrl' },
    limits: {
      formats: ['MP3', 'M4A', 'WAV'],
      notes: [
        'customVoiceId must match ^[A-Za-z][A-Za-z0-9]{7,}$.',
        'Retention last verified by provider docs 2026-02-21: unused IDs deleted after 7 days.',
      ],
    },
    responseVariants: [
      {
        kind: 'ticket',
        description: '202 pending runId/model/cost/paymentSource',
      },
    ],
    resultDelivery: 'job',
    contractKind: 'family-specific',
    unresolved: [
      'Retention policy is provider documentation from 2026-02-21, not re-verified.',
      'No clone job was submitted.',
    ],
    verification: 'metadata-only',
    evidence: [docs('/api-reference/endpoint/voice-cloning.md')],
  },
  {
    id: 'audio.voice-clone.minimax.status',
    family: 'audio-voice-clone',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/voice-clone/minimax/status',
    method: 'POST',
    operation: 'status',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'json',
    allowedFields: ['runId', 'cost', 'paymentSource', 'isApiRequest'],
    roleMapping: {},
    limits: {},
    responseVariants: [
      { kind: 'processing', description: 'status processing' },
      {
        kind: 'completed',
        description:
          'status completed with audioUrls[] preview; customVoiceId location unstated in the completed example',
      },
    ],
    resultDelivery: 'job',
    contractKind: 'family-specific',
    unresolved: [
      'Completed example returns audioUrls, not the customVoiceId to persist.',
    ],
    verification: 'metadata-only',
    evidence: [docs('/api-reference/endpoint/voice-cloning.md')],
  },
  {
    id: 'audio.voice-clone.qwen',
    family: 'audio-voice-clone',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/voice-clone/qwen',
    method: 'POST',
    operation: 'voice-clone',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'json-or-multipart',
    allowedFields: [
      'audio',
      'audioUrl',
      'audio_url',
      'referenceText',
      'reference_text',
    ],
    roleMapping: { voice: 'audioUrl' },
    limits: {
      formats: ['MP3', 'OGG', 'WAV', 'M4A', 'AAC'],
      notes: [
        'Returned speaker embedding URL is fal-hosted; download immediately. Retention last verified 2026-02-21.',
      ],
    },
    responseVariants: [
      { kind: 'ticket', description: '202 pending runId/model/cost' },
    ],
    resultDelivery: 'job',
    contractKind: 'family-specific',
    unresolved: [
      'No clone job was submitted; embedding URL lifetime unobserved.',
    ],
    verification: 'metadata-only',
    evidence: [docs('/api-reference/endpoint/voice-cloning.md')],
  },
  {
    id: 'audio.voice-clone.qwen.status',
    family: 'audio-voice-clone',
    baseUrl: NANOGPT_ORIGIN,
    path: '/api/voice-clone/qwen/status',
    method: 'POST',
    operation: 'status',
    auth: 'bearer-or-x-api-key',
    requestEncoding: 'json',
    allowedFields: ['runId', 'cost', 'paymentSource', 'isApiRequest'],
    roleMapping: {},
    limits: {
      notes: ['Processing responses may include X-Poll-After seconds.'],
    },
    responseVariants: [
      {
        kind: 'completed',
        description: 'status completed with speakerEmbeddingUrl',
      },
    ],
    resultDelivery: 'job',
    contractKind: 'family-specific',
    unresolved: ['X-Poll-After behavior unobserved.'],
    verification: 'metadata-only',
    evidence: [docs('/api-reference/endpoint/voice-cloning.md')],
  },
];
