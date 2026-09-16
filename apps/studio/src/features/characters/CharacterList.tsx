import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import type { CharacterRecord } from '@char2vid/domain/characters/schema';

import {
  getStudioLibrary,
  subscribeLibraryInvalidation,
  type StudioLibrary,
} from '../library/library-session';
import { CharacterEditor } from './CharacterEditor';

export function CharacterList() {
  const [library, setLibrary] = useState<StudioLibrary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [query, setQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('character');

  const load = useCallback(async (handle: StudioLibrary) => {
    const rows = await handle.listCharacters();
    setCharacters(
      [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getStudioLibrary()
      .then(async (handle) => {
        if (cancelled) return;
        setLibrary(handle);
        await load(handle);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Failed to open characters',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    return subscribeLibraryInvalidation(() => {
      if (library) {
        void load(library);
      }
    });
  }, [library, load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return characters;
    }
    return characters.filter((character) =>
      character.name.toLowerCase().includes(needle),
    );
  }, [characters, query]);

  if (loadError) {
    return (
      <section className="empty-card" aria-labelledby="characters-error">
        <div>
          <p className="section-kicker">Characters</p>
          <h2 id="characters-error">Could not open characters</h2>
          <p>{loadError}</p>
        </div>
      </section>
    );
  }

  if (!library) {
    return (
      <section className="empty-card" aria-labelledby="characters-loading">
        <div>
          <p className="section-kicker">Characters</p>
          <h2 id="characters-loading">Opening local characters…</h2>
        </div>
      </section>
    );
  }

  return (
    <section className="character-page" aria-labelledby="character-list-title">
      <div className="library-toolbar">
        <div className="library-toolbar-main">
          <h2 id="character-list-title" className="visually-hidden">
            Characters
          </h2>
          <label className="library-search">
            <span className="visually-hidden">Search characters</span>
            <input
              type="search"
              placeholder="Search characters…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search characters"
            />
          </label>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="empty-card library-empty">
          <div className="empty-art" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <p className="section-kicker">Characters</p>
            <h2>No characters yet</h2>
            <p>
              Open an image in the library and choose Make character. Quick mode
              uses one approved portrait; detailed mode adds role and view
              slots. Looks stay independent of identity.
            </p>
          </div>
        </div>
      ) : (
        <div className="library-grid" role="list" aria-label="Characters">
          {visible.map((character) => (
            <article
              key={character.id}
              role="listitem"
              className="library-card"
              data-character-id={character.id}
            >
              <button
                type="button"
                className="library-card-open"
                onClick={() =>
                  setSearchParams(
                    { character: character.id },
                    { replace: true },
                  )
                }
              >
                <span className="library-card-kind">Character</span>
                <span className="library-card-name">{character.name}</span>
                <span className="library-card-meta">
                  {character.coverAssetRevisionId
                    ? 'Cover selected'
                    : 'No cover'}
                </span>
              </button>
            </article>
          ))}
        </div>
      )}

      {selectedId !== null && (
        <CharacterEditor
          library={library}
          characterId={selectedId}
          onClose={() => {
            setSearchParams({}, { replace: true });
            void load(library);
          }}
          onChanged={() => void load(library)}
        />
      )}
    </section>
  );
}
