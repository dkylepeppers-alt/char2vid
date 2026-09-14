import { z } from 'zod';

import { assetRecordSchema } from './asset-schema';
import type { AssetRecord } from './storage';

/** Archive format version for portable library/project/character packages. */
export const ARCHIVE_SCHEMA_VERSION = 1 as const;

/** Soft limits to reject zip bombs before mutating the library. */
export const MAX_ARCHIVE_FILE_COUNT = 50_000;
export const MAX_ARCHIVE_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

export type ArchiveScope = 'library' | 'project' | 'character';

export interface ArchiveReport {
  schemaVersion: number | null;
  fileCount: number;
  expandedBytes: number;
  missingFiles: string[];
  invalidPaths: string[];
  unsupportedVersion: boolean;
  /** True when the archive looks importable for the requested scope. */
  ok: boolean;
  errors: string[];
}

export interface ArchiveManifestFileV1 {
  path: string;
  sha256: string;
  bytes: number;
  mime: string;
}

export interface ArchiveManifestV1 {
  schemaVersion: typeof ARCHIVE_SCHEMA_VERSION;
  createdAt: string;
  scope: ArchiveScope;
  scopeId: string | null;
  files: ArchiveManifestFileV1[];
  recordCounts: {
    assets: number;
    revisions: number;
    collectionMembers: number;
    assetTags: number;
  };
}

/**
 * Durable asset fields allowed in portable exports. Secrets, signed URLs, and
 * transient UI state must never appear here.
 */
export const ALLOWLISTED_ASSET_FIELDS = [
  'id',
  'revisionId',
  'kind',
  'name',
  'mime',
  'sha256',
  'bytes',
  'state',
  'createdAt',
  'favorite',
  'rating',
  'folderId',
  'trashedAt',
] as const satisfies readonly (keyof AssetRecord)[];

const SECRET_KEY_PATTERN =
  /^(.*(?:credential|password|secret|token|authorization|cookie|api[_-]?key|signed[_-]?url|presigned).*)$/i;

export const archiveManifestFileSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
  mime: z.string().min(1),
});

export const archiveManifestV1Schema: z.ZodType<ArchiveManifestV1> = z.object({
  schemaVersion: z.literal(ARCHIVE_SCHEMA_VERSION),
  createdAt: z.string().datetime({ offset: true }),
  scope: z.enum(['library', 'project', 'character']),
  scopeId: z.union([z.string().min(1), z.null()]),
  files: z.array(archiveManifestFileSchema),
  recordCounts: z.object({
    assets: z.number().int().nonnegative(),
    revisions: z.number().int().nonnegative(),
    collectionMembers: z.number().int().nonnegative(),
    assetTags: z.number().int().nonnegative(),
  }),
});

export const archiveRevisionSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime({ offset: true }),
});

export const archiveCollectionMemberSchema = z.object({
  collectionId: z.string().min(1),
  assetId: z.string().uuid(),
});

export const archiveAssetTagSchema = z.object({
  assetId: z.string().uuid(),
  tag: z.string().min(1),
});

export const archiveRecordsV1Schema = z.object({
  assets: z.array(assetRecordSchema),
  revisions: z.array(archiveRevisionSchema),
  collectionMembers: z.array(archiveCollectionMemberSchema),
  assetTags: z.array(archiveAssetTagSchema),
  /** Stub hooks — future record types remap through schema-owned traversal. */
  characters: z.array(z.record(z.string(), z.unknown())).default([]),
  looks: z.array(z.record(z.string(), z.unknown())).default([]),
  shots: z.array(z.record(z.string(), z.unknown())).default([]),
  graphEdges: z.array(z.record(z.string(), z.unknown())).default([]),
  timeline: z.array(z.record(z.string(), z.unknown())).default([]),
});

export type ArchiveRecordsV1 = z.infer<typeof archiveRecordsV1Schema>;

/**
 * Reject absolute paths, drive letters, empty segments, and `..` traversal.
 * Does not yet enforce the archive member allowlist (manifest/records/media).
 */
export function validateArchivePath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) {
    return false;
  }
  if (path.includes('\0')) {
    return false;
  }
  // Windows drive / UNC before slash normalization.
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\')) {
    return false;
  }
  if (path.startsWith('/') || path.startsWith('\\')) {
    return false;
  }

  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    return false;
  }

  const parts = normalized.split('/');
  if (parts.length === 0) {
    return false;
  }
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') {
      return false;
    }
  }
  return true;
}

/** True when a zip member is one of the v1 allowlisted relative paths. */
export function isAllowedArchiveMemberPath(path: string): boolean {
  if (!validateArchivePath(path)) {
    return false;
  }
  if (path === 'manifest.json' || path === 'records.json') {
    return true;
  }
  const media = /^media\/([a-f0-9]{64})\.([a-z0-9]+)$/i.exec(path);
  return media !== null;
}

export function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
    case 'audio/wave':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
    default:
      return 'bin';
  }
}

export function mediaArchivePath(sha256: string, mime: string): string {
  return `media/${sha256}.${extensionForMime(mime)}`;
}

/** Project an asset onto allowlisted durable fields only. */
export function allowlistAssetRecord(asset: AssetRecord): AssetRecord {
  const out = {} as AssetRecord;
  for (const key of ALLOWLISTED_ASSET_FIELDS) {
    out[key] = asset[key] as never;
  }
  return out;
}

/**
 * Drop credential-like keys from an arbitrary record before serialization.
 * Known durable shapes should prefer `allowlistAssetRecord`.
 */
export function stripSecretFields<T extends Record<string, unknown>>(
  record: T,
): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = stripSecretFields(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      out[key] = value.map((item: unknown) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? stripSecretFields(item as Record<string, unknown>)
          : item,
      );
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export function parseArchiveManifestV1(value: unknown): ArchiveManifestV1 {
  return archiveManifestV1Schema.parse(value);
}

export function parseArchiveRecordsV1(value: unknown): ArchiveRecordsV1 {
  return archiveRecordsV1Schema.parse(value);
}

export function emptyArchiveReport(
  partial: Partial<ArchiveReport> = {},
): ArchiveReport {
  return {
    schemaVersion: null,
    fileCount: 0,
    expandedBytes: 0,
    missingFiles: [],
    invalidPaths: [],
    unsupportedVersion: false,
    ok: false,
    errors: [],
    ...partial,
  };
}
