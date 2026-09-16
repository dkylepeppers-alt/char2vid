import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import type { AssetRecord, LibraryPort } from '@char2vid/domain/storage';
import { exportRevision } from '@char2vid/native-bridge/media-export';

import { resolvePlatform } from '../../app/platform';
import {
  invalidateStudioLibrary,
  revisionObjectUrl,
  streamToUint8Array,
} from './library-session';

export interface AssetDetailProps {
  library: LibraryPort;
  asset: AssetRecord;
  onClose: () => void;
}

export function AssetDetail({ library, asset, onClose }: AssetDetailProps) {
  const navigate = useNavigate();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [characterName, setCharacterName] = useState('');
  const [characterBusy, setCharacterBusy] = useState(false);

  useEffect(() => {
    let revoked = false;
    let url: string | null = null;
    setObjectUrl(null);
    setError(null);
    void revisionObjectUrl(library, asset.revisionId, asset.mime)
      .then((next) => {
        if (revoked) {
          URL.revokeObjectURL(next);
          return;
        }
        url = next;
        setObjectUrl(next);
      })
      .catch((err: unknown) => {
        if (!revoked) {
          setError(err instanceof Error ? err.message : 'Failed to load media');
        }
      });
    return () => {
      revoked = true;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [library, asset.revisionId, asset.mime]);

  async function handleMakeCharacter(mode: 'quick' | 'detailed') {
    const name = characterName.trim();
    if (!name) {
      setExportNote('Name the character before creating it.');
      return;
    }
    setCharacterBusy(true);
    try {
      const created = await library.createCharacter({
        name,
        referenceRevisionId: asset.revisionId,
      });
      invalidateStudioLibrary();
      onClose();
      void navigate(
        mode === 'detailed'
          ? `/characters?character=${created.characterId}`
          : `/characters?character=${created.characterId}`,
      );
    } catch (err) {
      setExportNote(
        err instanceof Error ? err.message : 'Could not make character',
      );
    } finally {
      setCharacterBusy(false);
    }
  }

  async function handleExport(destination: 'gallery' | 'files' | 'share') {
    setExportNote(null);
    try {
      const native = resolvePlatform() === 'android';
      // Native export resolves the revision inside the plugin so export does
      // not pull whole-file bytes through JavaScript. Detail preview still
      // uses revisionObjectUrl (chunked native reads assembled in JS).
      const payload = native
        ? {
            revisionId: asset.revisionId,
            destination,
          }
        : {
            revisionId: asset.revisionId,
            destination,
            bytes: await streamToUint8Array(
              await library.readRevision(asset.revisionId),
            ),
            mime: asset.mime,
            fileName: asset.name,
          };
      const result = await exportRevision(payload);
      setExportNote(
        result.status === 'saved'
          ? `Saved${result.displayName ? `: ${result.displayName}` : ''}`
          : result.status === 'shared'
            ? `Shared${result.displayName ? `: ${result.displayName}` : ''} (handed off)`
            : `Cancelled${result.displayName ? ` (${result.displayName})` : ''}`,
      );
    } catch (err) {
      setExportNote(err instanceof Error ? err.message : 'Export failed');
    }
  }

  return (
    <div className="asset-detail-scrim" onPointerDown={onClose}>
      <section
        className="asset-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-detail-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="asset-detail-heading">
          <div>
            <p className="section-kicker">Asset</p>
            <h2 id="asset-detail-title">{asset.name}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close asset detail"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="asset-preview fit-to-screen">
          {error !== null && <p role="alert">{error}</p>}
          {objectUrl !== null && asset.kind === 'image' && (
            <img src={objectUrl} alt={asset.name} />
          )}
          {objectUrl !== null && asset.kind === 'video' && (
            <video src={objectUrl} controls playsInline />
          )}
          {objectUrl !== null && asset.kind === 'audio' && (
            <audio src={objectUrl} controls />
          )}
          {objectUrl !== null && asset.kind === 'embedding' && (
            <p>Embedding revision (no inline preview).</p>
          )}
        </div>

        <dl className="provenance">
          <div>
            <dt>Kind</dt>
            <dd>{asset.kind}</dd>
          </div>
          <div>
            <dt>MIME</dt>
            <dd>{asset.mime}</dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd className="mono">{asset.sha256}</dd>
          </div>
          <div>
            <dt>Bytes</dt>
            <dd>{asset.bytes}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{asset.createdAt}</dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd className="mono">{asset.revisionId}</dd>
          </div>
          <div>
            <dt>Favorite</dt>
            <dd>{asset.favorite ? 'yes' : 'no'}</dd>
          </div>
          <div>
            <dt>Rating</dt>
            <dd>{asset.rating ?? '—'}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{asset.state}</dd>
          </div>
        </dl>

        {asset.kind === 'image' && asset.state === 'available' ? (
          <div className="make-character">
            <h3>Make character</h3>
            <p>
              Quick mode creates a usable character from this approved image.
              Detailed mode opens role and view slots next.
            </p>
            <label>
              Character name
              <input
                aria-label="New character name"
                value={characterName}
                onChange={(event) => setCharacterName(event.target.value)}
              />
            </label>
            <div className="asset-detail-actions">
              <button
                type="button"
                className="primary-action"
                disabled={characterBusy}
                onClick={() => void handleMakeCharacter('quick')}
              >
                Quick character
              </button>
              <button
                type="button"
                className="status-chip"
                disabled={characterBusy}
                onClick={() => void handleMakeCharacter('detailed')}
              >
                Detailed character
              </button>
            </div>
          </div>
        ) : null}

        <div className="asset-detail-actions">
          <button
            type="button"
            className="status-chip"
            onClick={() => void handleExport('files')}
          >
            Export files
          </button>
          <button
            type="button"
            className="status-chip"
            onClick={() => void handleExport('gallery')}
          >
            Export gallery
          </button>
          <button
            type="button"
            className="status-chip"
            onClick={() => void handleExport('share')}
          >
            Share
          </button>
        </div>
        {exportNote !== null && <p className="export-note">{exportNote}</p>}
      </section>
    </div>
  );
}
