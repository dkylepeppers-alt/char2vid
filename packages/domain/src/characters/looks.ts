import {
  parseLookRevision,
  type CharacterRevision,
  type LookRevision,
} from './schema';

/**
 * Factory for an independent look revision. Looks bind outfit/style media by
 * asset revision ID and have no write path onto a character's identity slots.
 */
export function createLookRevision(input: {
  id: string;
  characterId: string;
  label: string;
  notes?: string;
  referenceRevisionIds: readonly string[];
}): LookRevision {
  return parseLookRevision({
    id: input.id,
    characterId: input.characterId,
    label: input.label,
    notes: input.notes ?? '',
    referenceRevisionIds: [...input.referenceRevisionIds],
  });
}

/**
 * Runtime assertion used by persistence tests: saving a look must leave the
 * supplied character revision byte-identical.
 */
export function lookLeavesCharacterRevisionIntact(
  before: CharacterRevision,
  after: CharacterRevision,
): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}
