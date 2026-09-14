import { Capacitor, registerPlugin } from '@capacitor/core';

export type ArchiveScope = 'library' | 'project' | 'character';

export interface ExportArchiveRequest {
  scope: ArchiveScope;
  id?: string;
}

export interface ExportArchiveNativeResult {
  transferId: string;
  /** Present on web adapters that buffer the zip; native may stream to a URI. */
  bytes?: Uint8Array;
  fileName?: string;
  /**
   * Device archive round-trips remain UNVERIFIED until Android Room/files
   * streaming is wired and validated on hardware.
   */
  status: 'ready' | 'cancelled' | 'unverified';
  detail?: string;
}

export interface InspectArchiveNativeResult {
  schemaVersion: number | null;
  fileCount: number;
  expandedBytes: number;
  ok: boolean;
  status: 'ready' | 'unverified';
  detail?: string;
}

export interface ImportArchiveNativeResult {
  idMap: Record<string, string>;
  status: 'imported' | 'cancelled' | 'unverified';
  detail?: string;
}

interface Char2vidArchivePlugin {
  exportArchive(
    options: ExportArchiveRequest,
  ): Promise<ExportArchiveNativeResult>;
  inspectArchive(options: {
    uri?: string;
  }): Promise<InspectArchiveNativeResult>;
  importArchive(options: {
    uri?: string;
    conflict: 'remap';
  }): Promise<ImportArchiveNativeResult>;
}

const Char2vidArchive =
  registerPlugin<Char2vidArchivePlugin>('Char2vidArchive');

/**
 * Native archive bridge (G4). On Android this hits ArchivePlugin (skeleton).
 * Web callers should use `@char2vid/storage-web/archive` directly.
 *
 * UNVERIFIED on device: Android↔Android restore, browser↔Android restore,
 * and 1 GiB streaming without whole-archive memory allocation.
 */
export async function exportArchiveNative(
  request: ExportArchiveRequest,
): Promise<ExportArchiveNativeResult> {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    return Char2vidArchive.exportArchive(request);
  }
  return {
    // Do not mint a looking-real UUID — this stub never performed a transfer.
    transferId: 'UNVERIFIED-native-export-stub',
    status: 'unverified',
    detail:
      'UNVERIFIED: use @char2vid/storage-web/archive on web; native plugin not active',
  };
}

export async function inspectArchiveNative(options: {
  uri?: string;
}): Promise<InspectArchiveNativeResult> {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    return Char2vidArchive.inspectArchive(options);
  }
  return {
    schemaVersion: null,
    fileCount: 0,
    expandedBytes: 0,
    ok: false,
    status: 'unverified',
    detail: 'UNVERIFIED: native inspectArchive requires Android',
  };
}

export async function importArchiveNative(options: {
  uri?: string;
  conflict: 'remap';
}): Promise<ImportArchiveNativeResult> {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    return Char2vidArchive.importArchive(options);
  }
  return {
    idMap: {},
    status: 'unverified',
    detail: 'UNVERIFIED: native importArchive requires Android',
  };
}
