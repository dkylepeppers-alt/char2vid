import type { AssetRecord } from './storage';

/** Stable gallery sorts; tie-break is always asset id ascending. */
export type AssetSort =
  'createdAt-desc' | 'createdAt-asc' | 'name-asc' | 'name-desc';

export interface AssetQuery {
  text?: string;
  kind?: AssetRecord['kind'];
  /** Restrict to assets whose folderId equals this value. */
  folderId?: string | null;
  collectionId?: string;
  /** Assets must include every listed tag. */
  tags?: string[];
  favorite?: boolean;
  /**
   * When true, return only trashed assets. When false/omitted, exclude trash.
   */
  trashed?: boolean;
  sort: AssetSort;
  /** Opaque cursor from a previous page (`sortValue` + `id`). */
  cursor?: string;
  limit?: number;
}

export interface AssetQueryResult {
  assets: AssetRecord[];
  nextCursor?: string;
}

export interface LibraryQueryPort {
  queryAssets(query: AssetQuery): Promise<AssetQueryResult>;
}
