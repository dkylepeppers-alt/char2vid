import type { CharacterSlotIntent } from '@char2vid/domain';
import { CHARACTER_REVISION_CONFLICT } from '@char2vid/domain/characters/port';
import type { LibraryPort } from '@char2vid/domain/storage';
import { attachGeneratedOutputs } from '@char2vid/domain/generation/slot-attach';

function isRevisionConflict(error: unknown): boolean {
  const code = CHARACTER_REVISION_CONFLICT || 'character_revision_conflict';
  return error instanceof Error && error.message.includes(code);
}

export async function attachImportedCharacterSlots(
  library: LibraryPort,
  intent: CharacterSlotIntent,
  outputRevisionIds: readonly string[],
  mintId: () => string = () => crypto.randomUUID(),
): Promise<boolean> {
  if (outputRevisionIds.length === 0) {
    return false;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const character = await library.getCharacter(intent.characterId);
    if (!character) {
      return false;
    }
    const current = await library.getCharacterRevision(
      character.currentRevisionId,
    );
    if (!current) {
      return false;
    }
    const next = attachGeneratedOutputs(
      current,
      mintId(),
      outputRevisionIds,
      intent,
    );
    if (next.id === current.id) {
      return false;
    }
    try {
      await library.saveCharacterRevision(next);
      return true;
    } catch (error) {
      if (!isRevisionConflict(error) || attempt === 4) {
        throw error;
      }
    }
  }
  return false;
}
