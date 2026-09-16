import { useCallback, useEffect, useRef, useState } from 'react';

import {
  acceptReference,
  addCandidateReference,
  rejectReference,
  reviseCharacter,
  selectCover,
} from '@char2vid/domain/characters/revisions';
import type {
  CharacterRecord,
  CharacterRevision,
  LookRevision,
} from '@char2vid/domain/characters/schema';
import type { ReferenceAvailability } from '@char2vid/domain/characters/port';
import { exportArchive, importArchive } from '@char2vid/storage-web/archive';

import { resolvePlatform } from '../../app/platform';
import {
  invalidateStudioLibrary,
  type StudioLibrary,
} from '../library/library-session';
import { CharacterSheetGenerate } from './CharacterSheetGenerate';
import { LookEditor } from './LookEditor';
import { ReferenceSlots } from './ReferenceSlots';

export function CharacterEditor({
  library,
  characterId,
  initialDetailed = true,
  onClose,
  onChanged,
}: {
  library: StudioLibrary;
  characterId: string;
  initialDetailed?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [character, setCharacter] = useState<CharacterRecord | null>(null);
  const [revision, setRevision] = useState<CharacterRevision | null>(null);
  const [looks, setLooks] = useState<LookRevision[]>([]);
  const [availability, setAvailability] = useState<
    Record<string, ReferenceAvailability>
  >({});
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [detailed, setDetailed] = useState(initialDetailed);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const revisionSaveChain = useRef(Promise.resolve());
  const revisionSavePending = useRef(0);
  const native = resolvePlatform() === 'android';

  const reload = useCallback(async () => {
    const next = await library.getCharacter(characterId);
    if (!next) {
      setError('Character not found');
      setCharacter(null);
      return;
    }
    const current = await library.getCharacterRevision(next.currentRevisionId);
    const storedLooks = await library.listLooks(characterId);
    const nextAvailability: Record<string, ReferenceAvailability> = {};
    for (const reference of current?.references ?? []) {
      nextAvailability[reference.assetRevisionId] =
        await library.referenceAvailability(reference.assetRevisionId);
    }
    setCharacter(next);
    setRevision(current ?? null);
    setLooks(storedLooks);
    setAvailability(nextAvailability);
    setName(next.name);
    setNotes(current?.identityNotes ?? '');
  }, [characterId, library]);

  useEffect(() => {
    void reload().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load character');
    });
  }, [reload]);

  useEffect(() => {
    setDetailed(initialDetailed);
  }, [characterId, initialDetailed]);

  function enqueueRevisionMutation(
    mutate: (current: CharacterRevision) => CharacterRevision,
  ): void {
    revisionSavePending.current += 1;
    setRevisionBusy(true);
    const run = revisionSaveChain.current
      .catch(() => undefined)
      .then(async () => {
        const nextCharacter = await library.getCharacter(characterId);
        if (!nextCharacter) {
          throw new Error('Character not found');
        }
        const current = await library.getCharacterRevision(
          nextCharacter.currentRevisionId,
        );
        if (!current) {
          throw new Error('Character revision not found');
        }
        const next = mutate(current);
        await library.saveCharacterRevision(next);
        await reload();
        onChanged();
      })
      .catch((err: unknown) => {
        setStatus(err instanceof Error ? err.message : 'Save failed');
      })
      .finally(() => {
        revisionSavePending.current = Math.max(
          0,
          revisionSavePending.current - 1,
        );
        if (revisionSavePending.current === 0) {
          setRevisionBusy(false);
        }
      });
    revisionSaveChain.current = run.then(() => undefined);
  }

  async function onExport() {
    setStatus('Exporting character package…');
    try {
      if (native) {
        const { exportArchiveNative } =
          await import('@char2vid/native-bridge/archive');
        const result = await exportArchiveNative({
          scope: 'character',
          id: characterId,
          destination: 'files',
        });
        setStatus(
          result.status === 'ready'
            ? `Exported ${result.fileName ?? 'character package'} (native).`
            : result.status === 'cancelled'
              ? 'Export cancelled.'
              : (result.detail ?? 'Export did not complete'),
        );
        return;
      }
      if (!library.getArchiveHost) {
        setStatus('Character export requires the web library host');
        return;
      }
      const result = await exportArchive(library.getArchiveHost(), {
        scope: 'character',
        id: characterId,
      });
      const copy = new Uint8Array(result.bytes.byteLength);
      copy.set(result.bytes);
      const blob = new Blob([copy], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = result.fileName;
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      setStatus(`Exported ${result.fileName}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Export failed');
    }
  }

  async function onImportFile(file: File | undefined) {
    if (!file) return;
    setStatus('Importing character package…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!library.getArchiveHost) {
        setStatus('Character import requires the web library host');
        return;
      }
      const result = await importArchive(
        library.getArchiveHost(),
        { bytes },
        { conflict: 'remap' },
      );
      invalidateStudioLibrary();
      setStatus(`Imported ${result.importedAssets} asset(s) with ID remap`);
      onChanged();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Import failed');
    }
  }

  if (error && !character) {
    return (
      <div className="asset-detail-scrim" onPointerDown={onClose}>
        <section className="asset-detail" role="dialog" aria-modal="true">
          <p role="alert">{error}</p>
          <button type="button" className="icon-button" onClick={onClose}>
            ×
          </button>
        </section>
      </div>
    );
  }

  if (!character || !revision) {
    return null;
  }

  return (
    <div className="asset-detail-scrim" onPointerDown={onClose}>
      <section
        className="asset-detail character-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="character-editor-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="asset-detail-heading">
          <div>
            <p className="section-kicker">Character</p>
            <h2 id="character-editor-title">{character.name}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close character editor"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <label>
          Name
          <input
            aria-label="Character name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (name.trim() && name.trim() !== character.name) {
                void library
                  .renameCharacter(character.id, name)
                  .then(onChanged);
              }
            }}
          />
        </label>
        <label>
          Identity notes
          <textarea
            aria-label="Identity notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => {
              if (notes === revision.identityNotes || revisionBusy) {
                return;
              }
              enqueueRevisionMutation((current) =>
                reviseCharacter(current, {
                  id: crypto.randomUUID(),
                  identityNotes: notes,
                }),
              );
            }}
          />
        </label>
        <label className="mode-toggle">
          <input
            type="checkbox"
            checked={detailed}
            onChange={(event) => setDetailed(event.target.checked)}
          />
          Detailed role and view slots
        </label>

        <label>
          Cover
          <select
            aria-label="Character cover"
            value={character.coverAssetRevisionId ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              if (!value) return;
              try {
                selectCover(revision, value);
              } catch (err) {
                setStatus(
                  err instanceof Error ? err.message : 'Cover not approved',
                );
                return;
              }
              void library.setCover(character.id, value).then(() => {
                void reload();
                onChanged();
              });
            }}
          >
            {revision.references
              .filter((reference) => reference.approval === 'approved')
              .map((reference) => (
                <option
                  key={reference.assetRevisionId}
                  value={reference.assetRevisionId}
                >
                  {reference.role}
                  {reference.view ? ` · ${reference.view}` : ''}
                </option>
              ))}
          </select>
        </label>

        <ReferenceSlots
          revision={revision}
          availability={availability}
          detailed={detailed}
          busy={revisionBusy}
          onAccept={(assetRevisionId) => {
            enqueueRevisionMutation((current) =>
              acceptReference(current, crypto.randomUUID(), assetRevisionId),
            );
          }}
          onReject={(assetRevisionId) => {
            enqueueRevisionMutation((current) =>
              rejectReference(current, crypto.randomUUID(), assetRevisionId),
            );
          }}
          onAdd={(slot) => {
            void (async () => {
              const state = await library.referenceAvailability(
                slot.assetRevisionId,
              );
              if (state !== 'available') {
                setStatus(
                  'Slot requires an available image revision in the library',
                );
                return;
              }
              enqueueRevisionMutation((current) =>
                addCandidateReference(current, crypto.randomUUID(), slot),
              );
            })();
          }}
        />

        <LookEditor
          library={library}
          characterId={character.id}
          looks={looks}
          onSave={async (look) => {
            await library.saveLook(look);
            await reload();
            onChanged();
          }}
        />

        <CharacterSheetGenerate revision={revision} />

        <div className="asset-detail-actions">
          <button
            type="button"
            className="status-chip"
            onClick={() => void onExport()}
          >
            Export character
          </button>
          {native ? null : (
            <label className="status-chip file-action">
              Import character
              <input
                type="file"
                accept="application/zip,.zip"
                hidden
                aria-label="Import character package"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = '';
                  void onImportFile(file);
                }}
              />
            </label>
          )}
        </div>
        {status !== null ? (
          <p className="export-note" role="status">
            {status}
          </p>
        ) : null}
      </section>
    </div>
  );
}
