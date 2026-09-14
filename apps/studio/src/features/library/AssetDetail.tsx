import { useEffect, useState } from 'react';

import type { AssetRecord, LibraryPort } from '@char2vid/domain/storage';
import { exportRevision } from '@char2vid/native-bridge/media-export';

import { revisionObjectUrl, streamToUint8Array } from './library-session';

export interface AssetDetailProps {
  library: LibraryPort;
  asset: AssetRecord;
  onClose: () => void;
}

export function AssetDetail({ library, asset, onClose }: AssetDetailProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

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

  async function handleExport(destination: 'gallery' | 'files' | 'share') {
    setExportNote(null);
    try {
      const bytes = await streamToUint8Array(
        await library.readRevision(asset.revisionId),
      );
      const result = await exportRevision({
        revisionId: asset.revisionId,
        destination,
        bytes,
        mime: asset.mime,
        fileName: asset.name,
      });
      setExportNote(
        result.status === 'saved'
          ? `Saved${result.displayName ? `: ${result.displayName}` : ''}`
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
