import { z } from 'zod';

export const characterReferenceRoleSchema = z.enum([
  'identity',
  'body',
  'look',
  'pose',
  'style',
]);

export const characterViewSchema = z.enum([
  'front',
  'left',
  'right',
  'back',
  'three-quarter',
]);

export const characterApprovalSchema = z.enum(['candidate', 'approved']);

export const characterReferenceSchema = z.object({
  assetRevisionId: z.string().min(1),
  role: characterReferenceRoleSchema,
  view: characterViewSchema.optional(),
  approval: characterApprovalSchema,
});

export const characterRevisionSchema = z.object({
  id: z.string().min(1),
  characterId: z.string().min(1),
  parentRevisionId: z.string().min(1).optional(),
  references: z.array(characterReferenceSchema),
  identityNotes: z.string(),
});

export const lookRevisionSchema = z.object({
  id: z.string().min(1),
  characterId: z.string().min(1),
  label: z.string().min(1),
  notes: z.string(),
  referenceRevisionIds: z.array(z.string().min(1)),
});

export const characterRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  currentRevisionId: z.string().uuid(),
  coverAssetRevisionId: z.union([z.string().min(1), z.null()]),
  createdAt: z.string().datetime({ offset: true }),
});

export type CharacterReferenceRole = z.infer<
  typeof characterReferenceRoleSchema
>;
export type CharacterView = z.infer<typeof characterViewSchema>;
export type CharacterApproval = z.infer<typeof characterApprovalSchema>;
export type CharacterReference = z.infer<typeof characterReferenceSchema>;
export type CharacterRevision = z.infer<typeof characterRevisionSchema>;
export type LookRevision = z.infer<typeof lookRevisionSchema>;
export type CharacterRecord = z.infer<typeof characterRecordSchema>;

export function parseCharacterReference(value: unknown): CharacterReference {
  return characterReferenceSchema.parse(value);
}

export function parseCharacterRevision(value: unknown): CharacterRevision {
  return characterRevisionSchema.parse(value);
}

export function parseLookRevision(value: unknown): LookRevision {
  return lookRevisionSchema.parse(value);
}

export function parseCharacterRecord(value: unknown): CharacterRecord {
  return characterRecordSchema.parse(value);
}

export function cloneCharacterReferences(
  references: readonly CharacterReference[],
): CharacterReference[] {
  return references.map((reference) => ({ ...reference }));
}
