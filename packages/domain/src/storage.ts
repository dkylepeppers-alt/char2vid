import type { CharacterPort } from './characters/port';
import type { LibraryActionsPort } from './library-actions';
import type { LibraryQueryPort } from './library-query';

export interface AssetRecord {
  id: string;
  revisionId: string;
  kind: 'image' | 'video' | 'audio' | 'embedding';
  name: string;
  mime: string;
  sha256: string;
  bytes: number;
  state: 'pending' | 'available' | 'missing';
  createdAt: string;
  favorite: boolean;
  /** Integer 0–5, or null when unset. */
  rating: number | null;
  /** Primary folder placement; null means library root. */
  folderId: string | null;
  /** Soft-delete timestamp; null when not in trash. */
  trashedAt: string | null;
}

export interface ImportSource {
  kind: 'native-uri' | 'browser-file' | 'stream';
  /** Validated only inside the owning platform adapter. */
  handle: unknown;
  name: string;
  mime: string;
}

export interface LibraryPort
  extends LibraryQueryPort, LibraryActionsPort, CharacterPort {
  importMedia(source: ImportSource): Promise<AssetRecord>;
  getAsset(id: string): Promise<AssetRecord | undefined>;
  readRevision(revisionId: string): Promise<ReadableStream<Uint8Array>>;
  reconcileImports(): Promise<{ repaired: number; missing: string[] }>;
  storageUsage(): Promise<{
    originals: number;
    cache: number;
    available?: number;
  }>;
}
