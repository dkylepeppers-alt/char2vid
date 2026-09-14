export type LibraryActionKind =
  | 'tag'
  | 'untag'
  | 'favorite'
  | 'rating'
  | 'collection'
  | 'remove-from-collection'
  | 'folder'
  | 'trash'
  | 'restore'
  | 'permanent-delete';

/**
 * Batch organization mutation. `value` meaning depends on `action`:
 * - tag / untag: tag string
 * - favorite: boolean
 * - rating: integer 0–5, or null to clear
 * - collection / remove-from-collection: collection id
 * - folder: folder id string, or null for root
 * - trash / restore / permanent-delete: unused
 */
export interface LibraryActionRequest {
  assetIds: string[];
  action: LibraryActionKind;
  value?: string | number | boolean | null;
}

export interface LibraryActionsPort {
  applyLibraryAction(request: LibraryActionRequest): Promise<void>;
}
