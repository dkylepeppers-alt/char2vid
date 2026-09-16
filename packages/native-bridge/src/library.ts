import { Capacitor, registerPlugin } from '@capacitor/core';

import type { LibraryActionRequest } from '@char2vid/domain/library-actions';
import type {
  AssetQuery,
  AssetQueryResult,
} from '@char2vid/domain/library-query';
import type {
  AssetRecord,
  ImportSource,
  LibraryPort,
} from '@char2vid/domain/storage';
import { parseAssetRecord } from '@char2vid/domain/asset-schema';
import {
  parseCharacterRecord,
  parseCharacterRevision,
  parseLookRevision,
  type CharacterRecord,
  type CharacterRevision,
  type LookRevision,
} from '@char2vid/domain/characters/schema';

interface Char2vidLibraryPlugin {
  importFromNativeUri(options: {
    uri: string;
    name: string;
    mime: string;
  }): Promise<AssetRecord>;
  getAsset(options: { id: string }): Promise<{ asset: AssetRecord | null }>;
  openRevisionRead(options: {
    revisionId: string;
  }): Promise<{ readId: string; byteLength: number; mime: string }>;
  readRevisionChunk(options: {
    readId: string;
    maxBytes?: number;
  }): Promise<{ done: boolean; data: string | null }>;
  closeRevisionRead(options: { readId: string }): Promise<void>;
  reconcileImports(): Promise<{ repaired: number; missing: string[] }>;
  storageUsage(): Promise<{
    originals: number;
    cache: number;
    available?: number | null;
  }>;
  queryAssets(options: AssetQuery): Promise<{
    assets: AssetRecord[];
    nextCursor?: string | null;
  }>;
  applyLibraryAction(options: LibraryActionRequest): Promise<void>;
  createCharacter(options: {
    name: string;
    referenceRevisionId: string;
  }): Promise<{ characterId: string; revisionId: string }>;
  listCharacters(): Promise<{ characters: CharacterRecord[] }>;
  getCharacter(options: {
    id: string;
  }): Promise<{ character: CharacterRecord | null }>;
  listCharacterRevisions(options: {
    characterId: string;
  }): Promise<{ revisions: CharacterRevision[] }>;
  getCharacterRevision(options: {
    id: string;
  }): Promise<{ revision: CharacterRevision | null }>;
  saveCharacterRevision(options: CharacterRevision): Promise<void>;
  saveLook(options: LookRevision): Promise<void>;
  listLooks(options: {
    characterId: string;
  }): Promise<{ looks: LookRevision[] }>;
  getLook(options: { id: string }): Promise<{ look: LookRevision | null }>;
  setCover(options: {
    characterId: string;
    assetRevisionId: string;
  }): Promise<void>;
  renameCharacter(options: { id: string; name: string }): Promise<void>;
  referenceAvailability(options: {
    assetRevisionId: string;
  }): Promise<{ availability: 'available' | 'missing' }>;
}

const Char2vidLibrary =
  registerPlugin<Char2vidLibraryPlugin>('Char2vidLibrary');

function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary =
    typeof atob === 'function'
      ? atob(b64)
      : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Native Room/files library adapter (G2). Talks to Char2vidLibrary plugin.
 * Throws if invoked off Android — web callers should use `@char2vid/storage-web`.
 */
export class NativeLibraryPort implements LibraryPort {
  async importMedia(source: ImportSource): Promise<AssetRecord> {
    if (!isAndroidNative()) {
      throw new Error('NativeLibraryPort requires Android');
    }
    if (source.kind !== 'native-uri') {
      throw new Error(
        `NativeLibraryPort only accepts native-uri imports (got ${source.kind})`,
      );
    }
    if (typeof source.handle !== 'string' || source.handle.length === 0) {
      throw new Error('native-uri import requires a uri handle string');
    }
    const uri = source.handle;
    const record = await Char2vidLibrary.importFromNativeUri({
      uri,
      name: source.name,
      mime: source.mime,
    });
    return parseAssetRecord(record);
  }

  async getAsset(id: string): Promise<AssetRecord | undefined> {
    if (!isAndroidNative()) {
      throw new Error('NativeLibraryPort requires Android');
    }
    const { asset } = await Char2vidLibrary.getAsset({ id });
    if (asset == null) {
      return undefined;
    }
    return parseAssetRecord(asset);
  }

  async readRevision(revisionId: string): Promise<ReadableStream<Uint8Array>> {
    if (!isAndroidNative()) {
      throw new Error('NativeLibraryPort requires Android');
    }
    const opened = await Char2vidLibrary.openRevisionRead({ revisionId });
    let closed = false;
    const close = async () => {
      if (closed) {
        return;
      }
      closed = true;
      await Char2vidLibrary.closeRevisionRead({ readId: opened.readId });
    };
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const chunk = await Char2vidLibrary.readRevisionChunk({
          readId: opened.readId,
          maxBytes: 256 * 1024,
        });
        if (chunk.done || chunk.data == null) {
          await close();
          controller.close();
          return;
        }
        controller.enqueue(base64ToUint8Array(chunk.data));
      },
      async cancel() {
        await close();
      },
    });
  }

  async reconcileImports(): Promise<{ repaired: number; missing: string[] }> {
    if (!isAndroidNative()) {
      throw new Error('NativeLibraryPort requires Android');
    }
    return Char2vidLibrary.reconcileImports();
  }

  async storageUsage(): Promise<{
    originals: number;
    cache: number;
    available?: number;
  }> {
    if (!isAndroidNative()) {
      throw new Error('NativeLibraryPort requires Android');
    }
    const usage = await Char2vidLibrary.storageUsage();
    return {
      originals: usage.originals,
      cache: usage.cache,
      available:
        usage.available === null || usage.available === undefined
          ? undefined
          : usage.available,
    };
  }

  async queryAssets(query: AssetQuery): Promise<AssetQueryResult> {
    if (!isAndroidNative()) {
      throw new Error('NativeLibraryPort requires Android');
    }
    const result = await Char2vidLibrary.queryAssets(query);
    const assets = result.assets.map((a) => parseAssetRecord(a));
    return {
      assets,
      nextCursor:
        result.nextCursor === null || result.nextCursor === undefined
          ? undefined
          : result.nextCursor,
    };
  }

  async applyLibraryAction(request: LibraryActionRequest): Promise<void> {
    if (!isAndroidNative()) {
      throw new Error('NativeLibraryPort requires Android');
    }
    await Char2vidLibrary.applyLibraryAction(request);
  }

  async createCharacter(input: {
    name: string;
    referenceRevisionId: string;
  }): Promise<{ characterId: string; revisionId: string }> {
    this.requireAndroid();
    return Char2vidLibrary.createCharacter(input);
  }

  async listCharacters(): Promise<CharacterRecord[]> {
    this.requireAndroid();
    const { characters } = await Char2vidLibrary.listCharacters();
    return characters.map((row) => parseCharacterRecord(row));
  }

  async getCharacter(id: string): Promise<CharacterRecord | undefined> {
    this.requireAndroid();
    const { character } = await Char2vidLibrary.getCharacter({ id });
    return character == null ? undefined : parseCharacterRecord(character);
  }

  async listCharacterRevisions(
    characterId: string,
  ): Promise<CharacterRevision[]> {
    this.requireAndroid();
    const { revisions } = await Char2vidLibrary.listCharacterRevisions({
      characterId,
    });
    return revisions.map((row) => parseCharacterRevision(row));
  }

  async getCharacterRevision(
    id: string,
  ): Promise<CharacterRevision | undefined> {
    this.requireAndroid();
    const { revision } = await Char2vidLibrary.getCharacterRevision({ id });
    return revision == null ? undefined : parseCharacterRevision(revision);
  }

  async saveCharacterRevision(revision: CharacterRevision): Promise<void> {
    this.requireAndroid();
    await Char2vidLibrary.saveCharacterRevision(revision);
  }

  async saveLook(look: LookRevision): Promise<void> {
    this.requireAndroid();
    await Char2vidLibrary.saveLook(look);
  }

  async listLooks(characterId: string): Promise<LookRevision[]> {
    this.requireAndroid();
    const { looks } = await Char2vidLibrary.listLooks({ characterId });
    return looks.map((row) => parseLookRevision(row));
  }

  async getLook(id: string): Promise<LookRevision | undefined> {
    this.requireAndroid();
    const { look } = await Char2vidLibrary.getLook({ id });
    return look == null ? undefined : parseLookRevision(look);
  }

  async setCover(characterId: string, assetRevisionId: string): Promise<void> {
    this.requireAndroid();
    await Char2vidLibrary.setCover({ characterId, assetRevisionId });
  }

  async renameCharacter(id: string, name: string): Promise<void> {
    this.requireAndroid();
    await Char2vidLibrary.renameCharacter({ id, name });
  }

  async referenceAvailability(
    assetRevisionId: string,
  ): Promise<'available' | 'missing'> {
    this.requireAndroid();
    const { availability } = await Char2vidLibrary.referenceAvailability({
      assetRevisionId,
    });
    return availability;
  }

  private requireAndroid(): void {
    if (!isAndroidNative()) {
      throw new Error('NativeLibraryPort requires Android');
    }
  }
}

let sharedNative: NativeLibraryPort | null = null;

/** Singleton native library port for the Android WebView session. */
export function getNativeLibrary(): LibraryPort {
  if (!isAndroidNative()) {
    throw new Error('getNativeLibrary requires Android');
  }
  if (sharedNative === null) {
    sharedNative = new NativeLibraryPort();
  }
  return sharedNative;
}

export function isNativeLibraryAvailable(): boolean {
  return isAndroidNative();
}
