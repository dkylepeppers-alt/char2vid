import { z } from 'zod';

import type { AssetRecord, ImportSource } from './storage';

export const mediaKindSchema = z.enum(['image', 'video', 'audio', 'embedding']);

export const assetStateSchema = z.enum(['pending', 'available', 'missing']);

export const assetRecordSchema: z.ZodType<AssetRecord> = z.object({
  id: z.string().uuid(),
  revisionId: z.string().uuid(),
  kind: mediaKindSchema,
  name: z.string().min(1),
  mime: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
  state: assetStateSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export const importSourceKindSchema = z.enum([
  'native-uri',
  'browser-file',
  'stream',
]);

export const importSourceSchema: z.ZodType<ImportSource> = z.object({
  kind: importSourceKindSchema,
  handle: z.unknown(),
  name: z.string().min(1),
  mime: z.string().min(1),
});

export const importJournalStageSchema = z.enum([
  'pending',
  'written',
  'promoted',
]);

export const physicalObjectSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  relativePath: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
});

export function parseAssetRecord(value: unknown): AssetRecord {
  return assetRecordSchema.parse(value);
}

export function parseImportSource(value: unknown): ImportSource {
  return importSourceSchema.parse(value);
}
