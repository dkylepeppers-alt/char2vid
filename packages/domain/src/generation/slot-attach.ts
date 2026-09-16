import {
  type CharacterReference,
  type CharacterRevision,
} from '../characters/schema';
import { reviseCharacter } from '../characters/revisions';

export interface CharacterSlotIntent {
  characterId: string;
  role: CharacterReference['role'];
  view?: CharacterReference['view'];
}

export function attachGeneratedOutputs(
  previous: CharacterRevision,
  nextId: string,
  outputRevisionIds: readonly string[],
  intent: CharacterSlotIntent,
): CharacterRevision {
  const existing = new Set(
    previous.references.map((reference) => reference.assetRevisionId),
  );
  const added: CharacterReference[] = [];
  for (const assetRevisionId of outputRevisionIds) {
    if (existing.has(assetRevisionId)) {
      continue;
    }
    existing.add(assetRevisionId);
    added.push({
      assetRevisionId,
      role: intent.role,
      view: intent.view,
      approval: 'candidate',
    });
  }
  if (added.length === 0) {
    return previous;
  }
  return reviseCharacter(previous, {
    id: nextId,
    references: [...previous.references, ...added],
  });
}
