import { Capacitor, registerPlugin } from '@capacitor/core';

export type ExportDestination = 'gallery' | 'files' | 'share';

export interface ExportRevisionRequest {
  revisionId: string;
  destination: ExportDestination;
}

/**
 * `saved` — gallery/files download completed.
 * `shared` — share sheet handed off (not proof a recipient received the file).
 * `cancelled` — user dismissed/aborted.
 */
export interface ExportRevisionResult {
  status: 'saved' | 'shared' | 'cancelled';
  displayName?: string;
}

/**
 * Optional bytes for web adapters that already resolved the immutable revision.
 * Native Android resolves the revision inside the plugin / library stack.
 */
export interface ExportRevisionOptions extends ExportRevisionRequest {
  bytes?: Uint8Array;
  mime?: string;
  fileName?: string;
}

interface Char2vidExportPlugin {
  exportRevision(options: {
    revisionId: string;
    destination: ExportDestination;
  }): Promise<ExportRevisionResult>;
}

const Char2vidExport = registerPlugin<Char2vidExportPlugin>('Char2vidExport');

function toBlobPart(bytes: Uint8Array): BlobPart {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function downloadBytes(
  bytes: Uint8Array,
  fileName: string,
  mime: string,
): ExportRevisionResult {
  const blob = new Blob([toBlobPart(bytes)], { type: mime });
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
  return { status: 'saved', displayName: fileName };
}

async function shareBytes(
  bytes: Uint8Array,
  fileName: string,
  mime: string,
): Promise<ExportRevisionResult> {
  const file = new File([toBlobPart(bytes)], fileName, { type: mime });
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data?: ShareData) => Promise<void>;
  };
  if (typeof nav.share !== 'function') {
    return downloadBytes(bytes, fileName, mime);
  }
  const data: ShareData = { files: [file], title: fileName };
  if (typeof nav.canShare === 'function' && !nav.canShare(data)) {
    return downloadBytes(bytes, fileName, mime);
  }
  try {
    await nav.share(data);
    // Resolve means the share sheet handed off — not that a recipient received the file.
    return { status: 'shared', displayName: fileName };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { status: 'cancelled' };
    }
    throw error;
  }
}

/**
 * Platform-owned export. On Android, Cap bridge → ExportPlugin (MediaStore /
 * SAF / share). On web, download or Web Share using caller-supplied bytes.
 *
 * Physical Android MediaStore save/cancel/deny remains UNVERIFIED until the
 * native plugin completes the documented save transaction on device.
 */
export async function exportRevision(
  options: ExportRevisionOptions,
): Promise<ExportRevisionResult> {
  const { revisionId, destination, bytes, mime, fileName } = options;
  if (!revisionId) {
    throw new Error('exportRevision requires revisionId');
  }

  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    return Char2vidExport.exportRevision({ revisionId, destination });
  }

  if (!bytes || bytes.byteLength === 0) {
    throw new Error('web exportRevision requires non-empty bytes');
  }
  const resolvedMime = mime ?? 'application/octet-stream';
  const resolvedName = fileName ?? `${revisionId}`;

  if (destination === 'share') {
    return shareBytes(bytes, resolvedName, resolvedMime);
  }
  // gallery | files — browser has no system gallery; both save via download.
  return downloadBytes(bytes, resolvedName, resolvedMime);
}
