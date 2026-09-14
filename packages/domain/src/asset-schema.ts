import { z } from 'zod';

import type { AssetRecord, ImportSource } from './storage';

export const mediaKindSchema = z.enum(['image', 'video', 'audio', 'embedding']);

export const assetStateSchema = z.enum(['pending', 'available', 'missing']);

const sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const assetRecordSchema: z.ZodType<AssetRecord> = z
  .object({
    id: z.string().uuid(),
    revisionId: z.string().uuid(),
    kind: mediaKindSchema,
    name: z.string().min(1),
    mime: z.string().min(1),
    /** Empty only while `state` is `pending` (hash unknown until write). */
    sha256: z.union([z.literal(''), sha256DigestSchema]),
    bytes: z.number().int().nonnegative(),
    state: assetStateSchema,
    createdAt: z.string().datetime({ offset: true }),
    favorite: z.boolean(),
    rating: z.union([z.number().int().min(0).max(5), z.null()]),
    folderId: z.union([z.string().min(1), z.null()]),
    trashedAt: z.union([z.string().datetime({ offset: true }), z.null()]),
  })
  .superRefine((asset, ctx) => {
    if (asset.state === 'pending') {
      if (asset.sha256 !== '' && !/^[a-f0-9]{64}$/.test(asset.sha256)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sha256'],
          message: 'pending assets use empty sha256 until bytes are written',
        });
      }
      return;
    }
    if (asset.sha256 === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['sha256'],
        message: 'non-pending assets require a sha256 digest',
      });
    }
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

/** Fill organization defaults for records persisted before G3. */
export function normalizeAssetRecord(
  value: Partial<AssetRecord> &
    Pick<
      AssetRecord,
      | 'id'
      | 'revisionId'
      | 'kind'
      | 'name'
      | 'mime'
      | 'sha256'
      | 'bytes'
      | 'state'
      | 'createdAt'
    >,
): AssetRecord {
  return parseAssetRecord({
    favorite: false,
    rating: null,
    folderId: null,
    trashedAt: null,
    ...value,
  });
}
