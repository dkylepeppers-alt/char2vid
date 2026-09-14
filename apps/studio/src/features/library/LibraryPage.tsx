import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AssetRecord, LibraryPort } from '@char2vid/domain/storage';
import type { AssetSort } from '@char2vid/domain/library-query';

import { AssetDetail } from './AssetDetail';
import { getStudioLibrary } from './library-session';
import { SelectionBar } from './SelectionBar';

const PAGE_SIZE = 48;

type KindFilter = AssetRecord['kind'] | 'all';

export function LibraryPage() {
  const [library, setLibrary] = useState<LibraryPort | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [text, setText] = useState('');
  const [debouncedText, setDebouncedText] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [trashedView, setTrashedView] = useState(false);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [sort, setSort] = useState<AssetSort>('createdAt-desc');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getStudioLibrary()
      .then((handle) => {
        if (!cancelled) {
          setLibrary(handle);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Failed to open library',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedText(text.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [text]);

  const loadPage = useCallback(
    async (options: { append: boolean; cursor?: string }) => {
      if (!library) {
        return;
      }
      setBusy(true);
      try {
        const result = await library.queryAssets({
          text: debouncedText || undefined,
          kind: kind === 'all' ? undefined : kind,
          favorite: favoriteOnly ? true : undefined,
          trashed: trashedView ? true : undefined,
          sort,
          limit: PAGE_SIZE,
          cursor: options.append ? options.cursor : undefined,
        });
        setAssets((prev) =>
          options.append ? [...prev, ...result.assets] : result.assets,
        );
        setNextCursor(result.nextCursor);
        if (!options.append) {
          setSelected(new Set());
        }
      } finally {
        setBusy(false);
      }
    },
    [library, debouncedText, kind, favoriteOnly, trashedView, sort],
  );

  useEffect(() => {
    void loadPage({ append: false });
  }, [loadPage]);

  const detailAsset = useMemo(
    () => assets.find((asset) => asset.id === detailId) ?? null,
    [assets, detailId],
  );

  async function handleImport(files: FileList | null) {
    if (!library || !files || files.length === 0) {
      return;
    }
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await library.importMedia({
          kind: 'browser-file',
          handle: file,
          name: file.name || 'import.bin',
          mime: file.type || 'application/octet-stream',
        });
      }
      await loadPage({ append: false });
    } finally {
      setBusy(false);
      if (importInput.current) {
        importInput.current.value = '';
      }
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function applyToSelection(
    action: 'trash' | 'restore' | 'permanent-delete' | 'favorite',
    value?: boolean,
  ) {
    if (!library || selected.size === 0) {
      return;
    }
    setBusy(true);
    try {
      await library.applyLibraryAction({
        assetIds: [...selected],
        action,
        value: action === 'favorite' ? value : undefined,
      });
      await loadPage({ append: false });
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <section className="empty-card" aria-labelledby="library-error">
        <div>
          <p className="section-kicker">Library</p>
          <h2 id="library-error">Could not open library</h2>
          <p>{loadError}</p>
        </div>
      </section>
    );
  }

  if (!library) {
    return (
      <section className="empty-card" aria-labelledby="library-loading">
        <div>
          <p className="section-kicker">Library</p>
          <h2 id="library-loading">Opening local library…</h2>
          <p>IndexedDB / OPFS storage is initializing on this device.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="library-page" aria-labelledby="library-gallery-title">
      <div className="library-toolbar">
        <div className="library-toolbar-main">
          <h2 id="library-gallery-title" className="visually-hidden">
            Gallery
          </h2>
          <label className="library-search">
            <span className="visually-hidden">Search library</span>
            <input
              type="search"
              placeholder="Search by name…"
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-label="Search library"
            />
          </label>
          <label>
            <span className="visually-hidden">Kind</span>
            <select
              aria-label="Filter by kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as KindFilter)}
            >
              <option value="all">All kinds</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
              <option value="audio">Audio</option>
              <option value="embedding">Embeddings</option>
            </select>
          </label>
          <label>
            <span className="visually-hidden">Sort</span>
            <select
              aria-label="Sort library"
              value={sort}
              onChange={(event) => setSort(event.target.value as AssetSort)}
            >
              <option value="createdAt-desc">Newest</option>
              <option value="createdAt-asc">Oldest</option>
              <option value="name-asc">Name A–Z</option>
              <option value="name-desc">Name Z–A</option>
            </select>
          </label>
        </div>
        <div className="library-toolbar-actions">
          <button
            type="button"
            className="status-chip"
            aria-pressed={favoriteOnly}
            onClick={() => setFavoriteOnly((v) => !v)}
          >
            Favorites
          </button>
          <button
            type="button"
            className="status-chip"
            aria-pressed={trashedView}
            aria-label={trashedView ? 'Show library' : 'Show trash'}
            onClick={() => setTrashedView((v) => !v)}
          >
            {trashedView ? 'Show library' : 'Show trash'}
          </button>
          <button
            type="button"
            className="primary-action library-import"
            onClick={() => importInput.current?.click()}
            disabled={busy || trashedView}
          >
            Import
          </button>
          <input
            ref={importInput}
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            hidden
            aria-label="Import media files"
            onChange={(event) => void handleImport(event.target.files)}
          />
        </div>
      </div>

      <SelectionBar
        selectedCount={selected.size}
        trashedView={trashedView}
        onClear={() => setSelected(new Set())}
        onTrash={() => void applyToSelection('trash')}
        onRestore={() => void applyToSelection('restore')}
        onPermanentDelete={() => void applyToSelection('permanent-delete')}
        onFavorite={(value) => void applyToSelection('favorite', value)}
      />

      {assets.length === 0 ? (
        <div className="empty-card library-empty">
          <div className="empty-art" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <p className="section-kicker">
              {trashedView ? 'Trash' : 'Library'}
            </p>
            <h2>
              {trashedView
                ? 'Trash is empty'
                : 'Your media stays on this device'}
            </h2>
            <p>
              {trashedView
                ? 'Trashed items appear here until restored or permanently deleted.'
                : 'Import images, video, or audio to build an offline gallery with soft trash and exports.'}
            </p>
          </div>
        </div>
      ) : (
        <div
          ref={listRef}
          className="library-grid"
          role="list"
          aria-label="Library assets"
        >
          {assets.map((asset) => {
            const isSelected = selected.has(asset.id);
            return (
              <article
                key={asset.id}
                role="listitem"
                className={
                  isSelected ? 'library-card is-selected' : 'library-card'
                }
                data-asset-id={asset.id}
              >
                <label className="library-card-select">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelected(asset.id)}
                    aria-label={`Select ${asset.name}`}
                  />
                </label>
                <button
                  type="button"
                  className="library-card-open"
                  onClick={() => setDetailId(asset.id)}
                >
                  <span className="library-card-kind">{asset.kind}</span>
                  <span className="library-card-name">{asset.name}</span>
                  <span className="library-card-meta">
                    {asset.favorite ? '★ ' : ''}
                    {(asset.bytes / 1024).toFixed(1)} KB
                  </span>
                </button>
              </article>
            );
          })}
        </div>
      )}

      {nextCursor !== undefined && (
        <button
          type="button"
          className="status-chip library-load-more"
          disabled={busy}
          onClick={() => void loadPage({ append: true, cursor: nextCursor })}
        >
          Load more
        </button>
      )}

      {detailAsset !== null && (
        <AssetDetail
          library={library}
          asset={detailAsset}
          onClose={() => setDetailId(null)}
        />
      )}
    </section>
  );
}
