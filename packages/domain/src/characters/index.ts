export type {
  CharacterApproval,
  CharacterRecord,
  CharacterReference,
  CharacterReferenceRole,
  CharacterRevision,
  CharacterView,
  LookRevision,
} from './schema';
export {
  characterApprovalSchema,
  characterRecordSchema,
  characterReferenceRoleSchema,
  characterReferenceSchema,
  characterRevisionSchema,
  characterViewSchema,
  cloneCharacterReferences,
  lookRevisionSchema,
  parseCharacterRecord,
  parseCharacterReference,
  parseCharacterRevision,
  parseLookRevision,
} from './schema';
export type { CharacterPort, ReferenceAvailability } from './port';
export {
  acceptReference,
  addCandidateReference,
  createInitialRevision,
  rejectReference,
  reviseCharacter,
  selectCover,
} from './revisions';
export { createLookRevision, lookLeavesCharacterRevisionIntact } from './looks';
