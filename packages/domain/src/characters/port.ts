import type {
  CharacterRecord,
  CharacterRevision,
  LookRevision,
} from './schema';

export type ReferenceAvailability = 'available' | 'missing';

export interface CharacterPort {
  createCharacter(input: {
    name: string;
    referenceRevisionId: string;
  }): Promise<{ characterId: string; revisionId: string }>;
  listCharacters(): Promise<CharacterRecord[]>;
  getCharacter(id: string): Promise<CharacterRecord | undefined>;
  listCharacterRevisions(characterId: string): Promise<CharacterRevision[]>;
  getCharacterRevision(id: string): Promise<CharacterRevision | undefined>;
  saveCharacterRevision(revision: CharacterRevision): Promise<void>;
  saveLook(look: LookRevision): Promise<void>;
  listLooks(characterId: string): Promise<LookRevision[]>;
  getLook(id: string): Promise<LookRevision | undefined>;
  setCover(characterId: string, assetRevisionId: string): Promise<void>;
  renameCharacter(id: string, name: string): Promise<void>;
  referenceAvailability(
    assetRevisionId: string,
  ): Promise<ReferenceAvailability>;
}
