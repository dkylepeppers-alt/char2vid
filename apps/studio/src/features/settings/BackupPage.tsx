import { useCallback, useState } from 'react';

import {
  exportArchive,
  importArchive,
  inspectArchive,
} from '@char2vid/storage-web/archive';

import { resolvePlatform } from '../../app/platform';
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
 * Library backup / restore. Web uses IndexedDB/OPFS through the archive host.
 * Android uses the native streaming plugin (SAF / FileProvider) so the ZIP
 * never passes through JavaScript. Physical Android↔Android and browser↔Android
 * restores remain UNVERIFIED until hardware evidence.
 */
export function BackupPage() {
  const [status, setStatus] = useState<BackupStatus>({ kind: 'idle' });
  const native = resolvePlatform() === 'android';

  const onExport = useCallback(async () => {
    setStatus({ kind: 'working', message: 'Exporting library archive…' });
    try {
      if (native) {
        const { exportArchiveNative } =
          await import('@char2vid/native-bridge/archive');
        const result = await exportArchiveNative({
          scope: 'library',
          destination: 'files',
        });
        if (result.status === 'cancelled') {
          setStatus({ kind: 'ok', message: 'Export cancelled.' });
          return;
        }
        if (result.status !== 'ready') {
          setStatus({
            kind: 'error',
            message: result.detail ?? 'Native archive export did not complete',
          });
          return;
        }
        setStatus({
          kind: 'ok',
          message: `Exported ${result.fileName ?? 'library archive'} (native SAF). Physical Android↔Android restore is UNVERIFIED.`,
        });
        return;
      }
      const library = await getStudioLibrary();
      if (!library.getArchiveHost) {
        setStatus({
          kind: 'error',
          message:
            'UNVERIFIED: portable archive export requires the web library host',
        });
        return;
      }
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
  }, [native]);

  const onNativeImport = useCallback(async () => {
    setStatus({ kind: 'working', message: 'Opening archive…' });
    try {
      const { importArchiveNative } =
        await import('@char2vid/native-bridge/archive');
      const result = await importArchiveNative({ conflict: 'remap' });
      if (result.status === 'cancelled') {
        setStatus({ kind: 'ok', message: 'Import cancelled.' });
        return;
      }
      if (result.status !== 'imported') {
        setStatus({
          kind: 'error',
          message: result.detail ?? 'Native archive import did not complete',
        });
        return;
      }
      const count = result.importedAssets ?? Object.keys(result.idMap).length;
      setStatus({
        kind: 'ok',
        message: `Imported ${count} asset(s) with ID remap (native). Physical Android↔Android restore is UNVERIFIED.`,
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Import failed unexpectedly',
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
      if (!library.getArchiveHost) {
        setStatus({
          kind: 'error',
          message:
            'UNVERIFIED: portable archive import requires the web library host',
        });
        return;
      }
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
          {native
            ? 'Export or restore a versioned library ZIP through the system document picker. The archive is streamed natively and is never buffered in JavaScript. Physical Android ↔ Android and browser ↔ Android restores are UNVERIFIED.'
            : 'Export or restore a versioned library ZIP on this browser. Physical Android ↔ Android and browser ↔ Android restores are UNVERIFIED.'}
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
        {native ? (
          <button
            type="button"
            className="secondary-action"
            onClick={() => void onNativeImport()}
            disabled={status.kind === 'working'}
          >
            Import library
          </button>
        ) : (
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
        )}
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
