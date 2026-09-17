import type { CharacterSlotIntent } from '@char2vid/domain';
import type { LibraryPort } from '@char2vid/domain/storage';
import { attachGeneratedOutputs } from '@char2vid/domain/generation/slot-attach';

export async function attachImportedCharacterSlots(
  library: LibraryPort,
  intent: CharacterSlotIntent,
  outputRevisionIds: readonly string[],
  mintId: () => string = () => crypto.randomUUID(),
): Promise<boolean> {
  if (outputRevisionIds.length === 0) {
    return false;
  }
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
  await library.saveCharacterRevision(next);
  return true;
}
