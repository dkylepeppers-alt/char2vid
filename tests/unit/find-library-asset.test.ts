import { describe, expect, it, vi } from 'vitest';

import type {
  AssetRecord,
  LibraryPort,
} from '../../packages/domain/src/storage';
import { findLibraryAssetByRevisionId } from '../../apps/studio/src/features/jobs/find-library-asset';

function asset(revisionId: string, id = revisionId): AssetRecord {
  return {
    id,
    revisionId,
    kind: 'image',
    name: revisionId,
    mime: 'image/png',
    sha256: 'a'.repeat(64),
    bytes: 1,
    state: 'available',
    createdAt: '2026-01-01T00:00:00.000Z',
    favorite: false,
    rating: null,
    folderId: null,
    trashedAt: null,
  };
}

describe('findLibraryAssetByRevisionId', () => {
  it('walks query pages until the revision is found', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) =>
      asset(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
    );
    const target = asset('11111111-1111-4111-8111-111111111111');
    const queryAssets = vi
      .fn()
      .mockResolvedValueOnce({ assets: page1, nextCursor: 'page-2' })
      .mockResolvedValueOnce({ assets: [target] });

    const library = { queryAssets } as unknown as LibraryPort;
    const found = await findLibraryAssetByRevisionId(
      library,
      target.revisionId,
    );
    expect(found?.revisionId).toBe(target.revisionId);
    expect(queryAssets).toHaveBeenCalledTimes(2);
    expect(queryAssets.mock.calls[1][0]).toMatchObject({ cursor: 'page-2' });
  });

  it('returns undefined when pages are exhausted', async () => {
    const queryAssets = vi.fn().mockResolvedValue({ assets: [asset('a')] });
    const library = { queryAssets } as unknown as LibraryPort;
    await expect(
      findLibraryAssetByRevisionId(library, 'missing-revision'),
    ).resolves.toBeUndefined();
  });
});
