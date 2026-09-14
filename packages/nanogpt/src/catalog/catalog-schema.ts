import type { CapabilityIssue, ModelDescriptor } from '@char2vid/domain';
import { z } from 'zod';

/**
 * The four generation catalogs from design §8 (`ModelDescriptor.catalog`).
 * Embedding and moderation catalogs exist upstream but are not generation
 * catalogs and are out of scope for `normalizeCatalog`.
 */
export const GENERATION_CATALOGS = ['text', 'image', 'video', 'audio'] as const;
export type GenerationCatalog = (typeof GENERATION_CATALOGS)[number];
export const generationCatalogSchema = z.enum(GENERATION_CATALOGS);

/**
 * Public, unauthenticated catalog URLs observed in
 * `docs/research/discovery-snapshot.json` (2026-09-13) and re-observed
 * 2026-09-14. The legacy `/api/v1/image-models` list is intentionally absent:
 * it overlaps the normalized image catalog and must not be added to it.
 */
export const PUBLIC_CATALOG_URLS: Readonly<Record<GenerationCatalog, string>> =
  {
    text: 'https://nano-gpt.com/api/v1/models?detailed=true',
    image: 'https://nano-gpt.com/api/v1/images/models',
    video: 'https://nano-gpt.com/api/v1/video-models?detailed=true',
    audio: 'https://nano-gpt.com/api/v1/audio-models',
  };

export type ControlKind =
  'select' | 'boolean' | 'number' | 'text' | 'unsupported';

/** One selectable value. `value` keeps its wire type (`"5"` is not `5`). */
export interface ControlOption {
  value: unknown;
  label?: string;
}

export interface ParameterControl {
  key: string;
  kind: ControlKind;
  options?: ControlOption[];
  min?: number;
  max?: number;
  default?: unknown;
  /** The untouched wire descriptor (or scalar) this control was derived from. */
  raw: unknown;
}

/**
 * Limits derived from flat count/constraint fields. Every field is optional:
 * an absent value means "unknown", never "unlimited". `raw` keeps the exact
 * wire fields the limits were read from.
 */
export interface ModelLimits {
  maxOutputImages?: number;
  /**
   * Maximum input references. Set only from `max_input_images` and/or
   * `input_image_constraints.max_items` when they agree. `max_images` alone
   * never defines this value.
   */
  maxInputReferences?: number;
  fixedImageCount?: number;
  inputFormats?: string[];
  inputMaxBytes?: { route?: number; provider?: number };
  inputPixels?: {
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
  };
  durationSeconds?: { min?: number; max?: number };
  maxChars?: number;
  maxFileSizeMb?: number;
  maxRequestBodyMb?: number;
  raw: Record<string, unknown>;
}

/** A catalog-level issue; `modelId` is absent for envelope-level problems. */
export interface CatalogIssue extends CapabilityIssue {
  catalog: GenerationCatalog;
  modelId?: string;
}

/**
 * A `ModelDescriptor` (design §8) enriched with the normalized Nano-GPT
 * metadata the picker and serializers need. `raw` is the untouched record.
 */
export interface NanoGptModelDescriptor extends ModelDescriptor {
  catalog: GenerationCatalog;
  displayName?: string;
  capabilities: Record<string, unknown>;
  controls: ParameterControl[];
  limits: ModelLimits;
  /** Relative endpoint-metadata path as returned by the image catalog. */
  endpointsPath?: string;
  /** Raw endpoint metadata merged by exact ID, when it has been fetched. */
  endpointMetadata?: Record<string, unknown>;
  issues: CatalogIssue[];
}

export interface NormalizedCatalog {
  catalog: GenerationCatalog;
  fetchedAt: string;
  url?: string;
  models: NanoGptModelDescriptor[];
  issues: CatalogIssue[];
}

export const CATALOG_REFRESH_STATES = [
  'fresh',
  'stale',
  'unavailable',
] as const;
export type CatalogRefreshState = (typeof CATALOG_REFRESH_STATES)[number];
export const catalogRefreshStateSchema = z.enum(CATALOG_REFRESH_STATES);

/** Any JSON object; records are kept loose so unknown fields survive. */
export const jsonObjectSchema = z.record(z.string(), z.unknown());
export type JsonObject = z.infer<typeof jsonObjectSchema>;

/** The only thing a catalog record must have is a non-empty string `id`. */
export const catalogRecordSchema = z.looseObject({ id: z.string().min(1) });
export type CatalogRecord = z.infer<typeof catalogRecordSchema>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
