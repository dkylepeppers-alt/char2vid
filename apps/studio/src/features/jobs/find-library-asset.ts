import type { AssetRecord, LibraryPort } from '@char2vid/domain/storage';

/** Resolve an available library asset by revision ID across query pages. */
export async function findLibraryAssetByRevisionId(
  library: LibraryPort,
  revisionId: string,
): Promise<AssetRecord | undefined> {
  return findLibraryAsset(library, (asset) => asset.revisionId === revisionId);
}

/** Resolve an available library asset by content hash across query pages. */
export async function findLibraryAssetBySha256(
  library: LibraryPort,
  sha256: string,
): Promise<AssetRecord | undefined> {
  return findLibraryAsset(
    library,
    (asset) => asset.sha256 === sha256 && asset.state === 'available',
  );
}

async function findLibraryAsset(
  library: LibraryPort,
  match: (asset: AssetRecord) => boolean,
): Promise<AssetRecord | undefined> {
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const result = await library.queryAssets({
      sort: 'createdAt-desc',
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    const asset = result.assets.find(match);
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
