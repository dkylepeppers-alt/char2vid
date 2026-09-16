import { useEffect, useState } from 'react';

import { createLookRevision } from '@char2vid/domain/characters/looks';
import type { LookRevision } from '@char2vid/domain/characters/schema';
import type { AssetRecord, LibraryPort } from '@char2vid/domain/storage';

export function LookEditor({
  library,
  characterId,
  looks,
  onSave,
}: {
  library: LibraryPort;
  characterId: string;
  looks: LookRevision[];
  onSave: (look: LookRevision) => Promise<void>;
}) {
  const [images, setImages] = useState<AssetRecord[]>([]);
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [referenceRevisionId, setReferenceRevisionId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void library
      .queryAssets({ kind: 'image', sort: 'createdAt-desc', limit: 48 })
      .then((page) => {
        if (!cancelled) {
          setImages(page.assets);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [library]);

  return (
    <section className="look-editor" aria-labelledby="look-editor-title">
      <h3 id="look-editor-title">Looks</h3>
      <p>
        Outfit and style looks are independent. Saving a look does not rewrite
        base identity references.
      </p>
      <ul className="slot-list">
        {looks.map((look) => (
          <li key={look.id} className="slot-row" data-look-id={look.id}>
            <div>
              <p className="slot-role">{look.label}</p>
              <p className="library-card-meta">
                {look.notes || 'No notes'} · {look.referenceRevisionIds.length}{' '}
                reference
                {look.referenceRevisionIds.length === 1 ? '' : 's'}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="slot-add"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = label.trim();
          if (!trimmed || !referenceRevisionId) {
            setError('A look needs a label and one outfit image.');
            return;
          }
          setError(null);
          void onSave(
            createLookRevision({
              id: crypto.randomUUID(),
              characterId,
              label: trimmed,
              notes,
              referenceRevisionIds: [referenceRevisionId],
            }),
          ).then(() => {
            setLabel('');
            setNotes('');
            setReferenceRevisionId('');
          });
        }}
      >
        <h4>New look</h4>
        <label>
          Label
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            aria-label="Look label"
            required
          />
        </label>
        <label>
          Notes
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            aria-label="Look notes"
          />
        </label>
        <label>
          Outfit image
          <select
            aria-label="Look reference image"
            value={referenceRevisionId}
            onChange={(event) => setReferenceRevisionId(event.target.value)}
            required
          >
            <option value="">Select an image revision</option>
            {images.map((asset) => (
              <option key={asset.revisionId} value={asset.revisionId}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="status-chip">
          Save look
        </button>
        {error !== null ? <p role="alert">{error}</p> : null}
      </form>
    </section>
  );
}
