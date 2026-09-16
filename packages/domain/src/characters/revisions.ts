import {
  cloneCharacterReferences,
  parseCharacterRevision,
  type CharacterReference,
  type CharacterRevision,
} from './schema';

export interface ReviseCharacterPatch {
  id: string;
  references?: CharacterReference[];
  identityNotes?: string;
}

/**
 * Pure revision writer. Copies `previous` into a new object and never mutates
 * the source identity notes or reference slots.
 */
export function reviseCharacter(
  previous: CharacterRevision,
  patch: ReviseCharacterPatch,
): CharacterRevision {
  return parseCharacterRevision({
    id: patch.id,
    characterId: previous.characterId,
    parentRevisionId: previous.id,
    references: cloneCharacterReferences(
      patch.references ?? previous.references,
    ),
    identityNotes: patch.identityNotes ?? previous.identityNotes,
  });
}

export function createInitialRevision(input: {
  id: string;
  characterId: string;
  referenceRevisionId: string;
}): CharacterRevision {
  return parseCharacterRevision({
    id: input.id,
    characterId: input.characterId,
    references: [
      {
        assetRevisionId: input.referenceRevisionId,
        role: 'identity',
        view: 'front',
        approval: 'approved',
      },
    ],
    identityNotes: '',
  });
}

export function addCandidateReference(
  previous: CharacterRevision,
  nextId: string,
  input: {
    assetRevisionId: string;
    role: CharacterReference['role'];
    view?: CharacterReference['view'];
  },
): CharacterRevision {
  return reviseCharacter(previous, {
    id: nextId,
    references: [
      ...previous.references,
      {
        assetRevisionId: input.assetRevisionId,
        role: input.role,
        view: input.view,
        approval: 'candidate',
      },
    ],
  });
}

export function acceptReference(
  previous: CharacterRevision,
  nextId: string,
  assetRevisionId: string,
): CharacterRevision {
  return reviseCharacter(previous, {
    id: nextId,
    references: previous.references.map((reference) =>
      reference.assetRevisionId === assetRevisionId
        ? { ...reference, approval: 'approved' as const }
        : reference,
    ),
  });
}

export function rejectReference(
  previous: CharacterRevision,
  nextId: string,
  assetRevisionId: string,
): CharacterRevision {
  return reviseCharacter(previous, {
    id: nextId,
    references: previous.references.filter(
      (reference) => reference.assetRevisionId !== assetRevisionId,
    ),
  });
}

export function selectCover(
  revision: CharacterRevision,
  assetRevisionId: string,
): string {
  const reference = revision.references.find(
    (item) => item.assetRevisionId === assetRevisionId,
  );
  if (!reference || reference.approval !== 'approved') {
    throw new Error('cover must be an approved character reference');
  }
  return assetRevisionId;
}
