import { Capacitor, registerPlugin } from '@capacitor/core';

export type ArchiveScope = 'library' | 'project' | 'character';

export interface ExportArchiveRequest {
  scope: ArchiveScope;
  id?: string;
  /** Native only. Defaults to the SAF document picker. */
  destination?: 'files' | 'share';
}

export interface ExportArchiveNativeResult {
  transferId: string;
  /** Present on web adapters that buffer the zip; native streams to a URI. */
  bytes?: Uint8Array;
  fileName?: string;
  /**
   * Physical Android↔Android and browser↔Android restores remain UNVERIFIED
   * until run on hardware. `ready` means the native plugin finished a
   * SAF save or share hand-off — not a device round-trip proof.
   */
  status: 'ready' | 'cancelled' | 'unverified';
  detail?: string;
}

export interface InspectArchiveNativeResult {
  schemaVersion: number | null;
  fileCount: number;
  expandedBytes: number;
  missingFiles: string[];
  invalidPaths: string[];
  unsupportedVersion: boolean;
  ok: boolean;
  errors: string[];
  status: 'ready' | 'cancelled' | 'unverified';
  detail?: string;
  /** SAF document URI selected during inspect; pass to importArchive. */
  uri?: string;
}

export interface ImportArchiveNativeResult {
  idMap: Record<string, string>;
  status: 'imported' | 'cancelled' | 'unverified';
  detail?: string;
  importedAssets?: number;
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

function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/**
 * Native archive bridge (G4). On Android this hits ArchivePlugin, which
 * streams Room/files into a ZIP via SAF or FileProvider. Web callers should
 * use `@char2vid/storage-web/archive` directly.
 *
 * UNVERIFIED on device: Android↔Android restore, browser↔Android restore,
 * and 1 GiB streaming without whole-archive memory allocation.
 */
export async function exportArchiveNative(
  request: ExportArchiveRequest,
): Promise<ExportArchiveNativeResult> {
  if (isAndroidNative()) {
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
  if (isAndroidNative()) {
    return Char2vidArchive.inspectArchive(options);
  }
  return {
    schemaVersion: null,
    fileCount: 0,
    expandedBytes: 0,
    missingFiles: [],
    invalidPaths: [],
    unsupportedVersion: false,
    ok: false,
    errors: [],
    status: 'unverified',
    detail: 'UNVERIFIED: native inspectArchive requires Android',
  };
}

export async function importArchiveNative(options: {
  uri?: string;
  conflict: 'remap';
}): Promise<ImportArchiveNativeResult> {
  if (isAndroidNative()) {
    return Char2vidArchive.importArchive(options);
  }
  return {
    idMap: {},
    status: 'unverified',
    detail: 'UNVERIFIED: native importArchive requires Android',
  };
}
