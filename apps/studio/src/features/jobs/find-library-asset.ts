import type { AssetRecord, LibraryPort } from '@char2vid/domain/storage';

/** Resolve an available library asset by revision ID across query pages. */
export async function findLibraryAssetByRevisionId(
  library: LibraryPort,
  revisionId: string,
): Promise<AssetRecord | undefined> {
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const result = await library.queryAssets({
      sort: 'createdAt-desc',
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    const asset = result.assets.find((item) => item.revisionId === revisionId);
    if (asset) {
      return asset;
    }
    if (!result.nextCursor) {
      break;
    }
    cursor = result.nextCursor;
  }
  return undefined;
}
