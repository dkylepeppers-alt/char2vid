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
}

export interface ImportSource {
  kind: 'native-uri' | 'browser-file' | 'stream';
  /** Validated only inside the owning platform adapter. */
  handle: unknown;
  name: string;
  mime: string;
}

export interface LibraryPort {
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
