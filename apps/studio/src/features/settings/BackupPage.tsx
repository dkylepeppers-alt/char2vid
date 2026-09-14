import { useCallback, useState } from 'react';

import {
  exportArchive,
  importArchive,
  inspectArchive,
} from '@char2vid/storage-web/archive';

import { getStudioLibrary } from '../library/library-session';

type BackupStatus =
  | { kind: 'idle' }
  | { kind: 'working'; message: string }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

function downloadZip(bytes: Uint8Array, fileName: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Web library backup / restore. Native device round-trips remain UNVERIFIED.
 */
export function BackupPage() {
  const [status, setStatus] = useState<BackupStatus>({ kind: 'idle' });

  const onExport = useCallback(async () => {
    setStatus({ kind: 'working', message: 'Exporting library archive…' });
    try {
      const library = await getStudioLibrary();
      const result = await exportArchive(library.getArchiveHost(), {
        scope: 'library',
      });
      downloadZip(result.bytes, result.fileName);
      setStatus({
        kind: 'ok',
        message: `Exported ${result.fileName} (web). Android device round-trips are UNVERIFIED.`,
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Export failed unexpectedly',
      });
    }
  }, []);

  const onImportFile = useCallback(async (file: File | undefined) => {
    if (!file) {
      return;
    }
    setStatus({ kind: 'working', message: 'Inspecting archive…' });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const report = await inspectArchive({ bytes });
      if (!report.ok) {
        setStatus({
          kind: 'error',
          message: `Archive rejected: ${report.errors.join('; ') || 'invalid'}`,
        });
        return;
      }
      setStatus({ kind: 'working', message: 'Importing archive (remap)…' });
      const library = await getStudioLibrary();
      const result = await importArchive(
        library.getArchiveHost(),
        { bytes },
        { conflict: 'remap' },
      );
      setStatus({
        kind: 'ok',
        message: `Imported ${result.importedAssets} asset(s) with ID remap. Native restore UNVERIFIED.`,
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Import failed unexpectedly',
      });
    }
  }, []);

  return (
    <section className="backup-panel" aria-labelledby="backup-title">
      <div>
        <p className="section-kicker">Portable archives</p>
        <h3 id="backup-title">Library backup</h3>
        <p>
          Export or restore a versioned library ZIP on this browser. Physical
          Android ↔ Android and browser ↔ Android restores are UNVERIFIED.
        </p>
      </div>

      <div className="backup-actions">
        <button
          type="button"
          className="primary-action"
          onClick={() => void onExport()}
          disabled={status.kind === 'working'}
        >
          Export library
        </button>
        <label className="secondary-action file-action">
          Import library
          <input
            type="file"
            accept="application/zip,.zip"
            hidden
            disabled={status.kind === 'working'}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void onImportFile(file);
            }}
          />
        </label>
      </div>

      {status.kind !== 'idle' && (
        <p
          className={
            status.kind === 'error'
              ? 'backup-status backup-status-error'
              : 'backup-status'
          }
          role="status"
        >
          {status.message}
        </p>
      )}
    </section>
  );
}
