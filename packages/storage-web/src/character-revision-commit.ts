import type {
  CharacterRecord,
  CharacterRevision,
} from '@char2vid/domain/characters/schema';

/** Same code as `CHARACTER_REVISION_CONFLICT`; inlined so Vite cannot elide it. */
const CHARACTER_REVISION_CONFLICT = 'character_revision_conflict';

/** Live-row checks that belong inside `commitCharacterRevision`. */
export function assertCharacterRevisionAdvance(args: {
  live: CharacterRecord | undefined;
  existingRevision: CharacterRevision | undefined;
  parentRevision: CharacterRevision | undefined;
  revision: CharacterRevision;
  expectedCurrentRevisionId: string | null;
}): CharacterRecord {
  if (!args.live) {
    throw new Error(`unknown character: ${args.revision.characterId}`);
  }
  if (args.existingRevision) {
    throw new Error('character revisions are immutable');
  }
  if (args.revision.parentRevisionId && !args.parentRevision) {
    throw new Error(
      `unknown parent revision: ${args.revision.parentRevisionId}`,
    );
  }
  if (args.live.currentRevisionId !== args.expectedCurrentRevisionId) {
    throw new Error(CHARACTER_REVISION_CONFLICT);
  }
  return args.live;
}
