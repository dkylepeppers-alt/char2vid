import { type CharacterPort } from '@char2vid/domain/characters/port';
import {
  parseCharacterRecord,
  parseCharacterRevision,
  parseLookRevision,
  type CharacterRecord,
  type CharacterRevision,
  type LookRevision,
} from '@char2vid/domain/characters/schema';
import {
  createInitialRevision,
  selectCover,
} from '@char2vid/domain/characters/revisions';
import type { LibraryActionRequest } from '@char2vid/domain/library-actions';
import type {
  AssetQuery,
  AssetQueryResult,
  AssetSort,
} from '@char2vid/domain/library-query';
import type { AssetRecord } from '@char2vid/domain/storage';
import {
  normalizeAssetRecord,
  parseAssetRecord,
  parseImportSource,
} from '@char2vid/domain/asset-schema';

import {
  bytesToStream,
  finalRelativePath,
  hashAndValidate,
  readImportHandle,
  type FileStore,
} from './files';
import type { ImportSource } from '@char2vid/domain/storage';

export type ImportStage = 'pending' | 'written' | 'promoted';

export type FaultPoint = 'after-write' | 'after-promote';

export interface JournalEntry {
  importId: string;
  assetId: string;
  revisionId: string;
  stage: ImportStage;
  tempPath: string;
  finalHash: string | null;
  name: string;
  mime: string;
  kind: AssetRecord['kind'];
  createdAt: string;
}

export interface PhysicalObject {
  sha256: string;
  relativePath: string;
  byteLength: number;
}

export interface RevisionRecord {
  id: string;
  assetId: string;
  sha256: string;
  createdAt: string;
}

export interface CollectionMember {
  collectionId: string;
  assetId: string;
}

export interface AssetTagRow {
  assetId: string;
  tag: string;
}

export interface MetaStore {
  putJournal(entry: JournalEntry): Promise<void>;
  getJournal(importId: string): Promise<JournalEntry | undefined>;
  listJournal(): Promise<JournalEntry[]>;
  deleteJournal(importId: string): Promise<void>;

  putAsset(asset: AssetRecord): Promise<void>;
  getAsset(id: string): Promise<AssetRecord | undefined>;
  deleteAsset(id: string): Promise<void>;
  listAssets(): Promise<AssetRecord[]>;

  putRevision(revision: RevisionRecord): Promise<void>;
  getRevision(id: string): Promise<RevisionRecord | undefined>;
  deleteRevision(id: string): Promise<void>;
  listRevisions(): Promise<RevisionRecord[]>;

  putPhysical(object: PhysicalObject): Promise<void>;
  getPhysical(sha256: string): Promise<PhysicalObject | undefined>;
  deletePhysical(sha256: string): Promise<void>;
  countPhysical(): Promise<number>;

  listCollectionMembers(collectionId?: string): Promise<CollectionMember[]>;
  putCollectionMember(member: CollectionMember): Promise<void>;
  deleteCollectionMember(collectionId: string, assetId: string): Promise<void>;
  deleteCollectionMembersForAsset(assetId: string): Promise<void>;

  listAssetTags(assetId?: string): Promise<AssetTagRow[]>;
  putAssetTag(row: AssetTagRow): Promise<void>;
  deleteAssetTag(assetId: string, tag: string): Promise<void>;
  deleteAssetTagsForAsset(assetId: string): Promise<void>;

  /**
   * Atomically mark asset available, upsert physical object, ensure revision,
   * and clear the journal entry.
   */
  commitAvailable(args: {
    asset: AssetRecord;
    revision: RevisionRecord;
    physical: PhysicalObject;
    importId: string;
  }): Promise<void>;

  /**
   * Atomically commit durable archive metadata after media objects are staged.
   * Physical objects are written separately (content-addressed) before this call.
   */
  commitArchiveImport(args: {
    assets: AssetRecord[];
    revisions: RevisionRecord[];
    collectionMembers: CollectionMember[];
    assetTags: AssetTagRow[];
    characters?: CharacterRecord[];
    characterRevisions?: CharacterRevision[];
    looks?: LookRevision[];
  }): Promise<void>;

  /**
   * Atomically write a character pointer and its revision (create or advance).
   * When `expectedCurrentRevisionId` is set, the live current-revision
   * predicate runs inside this same write so a lost update is a conflict.
   */
  commitCharacterRevision(args: {
    character?: CharacterRecord;
    revision: CharacterRevision;
    expectedCurrentRevisionId?: string | null;
  }): Promise<void>;

  putCharacter(character: CharacterRecord): Promise<void>;
  getCharacter(id: string): Promise<CharacterRecord | undefined>;
  listCharacters(): Promise<CharacterRecord[]>;

  putCharacterRevision(revision: CharacterRevision): Promise<void>;
  getCharacterRevision(id: string): Promise<CharacterRevision | undefined>;
  listCharacterRevisions(characterId?: string): Promise<CharacterRevision[]>;

  putLook(look: LookRevision): Promise<void>;
  getLook(id: string): Promise<LookRevision | undefined>;
  listLooks(characterId?: string): Promise<LookRevision[]>;
}

export class ImportFaultError extends Error {
  readonly fault: FaultPoint;

  constructor(fault: FaultPoint) {
    super(`injected fault: ${fault}`);
    this.name = 'ImportFaultError';
    this.fault = fault;
  }
}

function kindFromMime(mime: string): AssetRecord['kind'] {
  if (mime.startsWith('image/')) {
    return 'image';
  }
  if (mime.startsWith('video/')) {
    return 'video';
  }
  if (mime.startsWith('audio/')) {
    return 'audio';
  }
  return 'embedding';
}

function newId(): string {
  return crypto.randomUUID();
}

function orgDefaults(): Pick<
  AssetRecord,
  'favorite' | 'rating' | 'folderId' | 'trashedAt'
> {
  return {
    favorite: false,
    rating: null,
    folderId: null,
    trashedAt: null,
  };
}

export interface LibraryEngineOptions {
  files: FileStore;
  meta: MetaStore;
  fault?: FaultPoint;
}

interface CursorPayload {
  sortValue: string;
  id: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(cursor: string): Uint8Array {
  const padded = cursor.replace(/-/g, '+').replace(/_/g, '/');
  const pad =
    padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const b64 = padded + pad;
  if (typeof atob === 'function') {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function encodeCursor(payload: CursorPayload): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

function decodeCursor(cursor: string): CursorPayload {
  try {
    const raw = new TextDecoder().decode(base64UrlToBytes(cursor));
    const parsed = JSON.parse(raw) as CursorPayload;
    if (
      typeof parsed?.sortValue !== 'string' ||
      typeof parsed?.id !== 'string'
    ) {
      throw new Error('invalid cursor shape');
    }
    return parsed;
  } catch {
    throw new Error(`invalid query cursor: ${cursor}`);
  }
}

function sortValueFor(asset: AssetRecord, sort: AssetSort): string {
  switch (sort) {
    case 'createdAt-desc':
    case 'createdAt-asc':
      return asset.createdAt;
    case 'name-asc':
    case 'name-desc':
      return asset.name;
    default: {
      const _exhaustive: never = sort;
      return _exhaustive;
    }
  }
}

function compareAssets(
  a: AssetRecord,
  b: AssetRecord,
  sort: AssetSort,
): number {
  const av = sortValueFor(a, sort);
  const bv = sortValueFor(b, sort);
  const descending = sort.endsWith('-desc');
  if (av !== bv) {
    if (av < bv) {
      return descending ? 1 : -1;
    }
    return descending ? -1 : 1;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

function afterCursor(
  asset: AssetRecord,
  sort: AssetSort,
  cursor: CursorPayload,
): boolean {
  const value = sortValueFor(asset, sort);
  const descending = sort.endsWith('-desc');
  if (value === cursor.sortValue) {
    return asset.id > cursor.id;
  }
  if (descending) {
    return value < cursor.sortValue;
  }
  return value > cursor.sortValue;
}

/**
 * Shared crash-safe import journal protocol used by web and Node test backends.
 *
 * Stages: pending → written (temp hashed) → promoted (final path) → commit + clear.
 */
export class LibraryEngine implements CharacterPort {
  private readonly files: FileStore;
  private readonly meta: MetaStore;
  private readonly fault: FaultPoint | undefined;

  constructor(options: LibraryEngineOptions) {
    this.files = options.files;
    this.meta = options.meta;
    this.fault = options.fault;
  }

  async importMedia(source: ImportSource): Promise<AssetRecord> {
    parseImportSource(source);
    if (source.kind === 'native-uri') {
      throw new Error('native-uri imports require the Android adapter');
    }

    const importId = newId();
    const assetId = newId();
    const revisionId = newId();
    const createdAt = new Date().toISOString();
    const kind = kindFromMime(source.mime);
    const tempPath = `tmp/${importId}`;

    const pendingAsset = normalizeAssetRecord({
      id: assetId,
      revisionId,
      kind,
      name: source.name,
      mime: source.mime,
      sha256: '',
      bytes: 0,
      state: 'pending',
      createdAt,
      ...orgDefaults(),
    });

    const journal: JournalEntry = {
      importId,
      assetId,
      revisionId,
      stage: 'pending',
      tempPath,
      finalHash: null,
      name: source.name,
      mime: source.mime,
      kind,
      createdAt,
    };

    await this.meta.putJournal(journal);
    await this.meta.putAsset(pendingAsset);

    try {
      const bytes = await readImportHandle(source.handle);
      await this.files.writeTemp(importId, bytes);
      const { sha256, bytes: byteLength } = await hashAndValidate(
        bytes,
        source.mime,
      );

      await this.meta.putJournal({
        ...journal,
        stage: 'written',
        finalHash: sha256,
      });

      if (this.fault === 'after-write') {
        throw new ImportFaultError('after-write');
      }

      const relativePath = await this.files.promote(tempPath, sha256);

      await this.meta.putJournal({
        ...journal,
        stage: 'promoted',
        finalHash: sha256,
      });

      if (this.fault === 'after-promote') {
        throw new ImportFaultError('after-promote');
      }

      const available = normalizeAssetRecord({
        ...pendingAsset,
        sha256,
        bytes: byteLength,
        state: 'available',
      });
      parseAssetRecord(available);

      await this.meta.commitAvailable({
        asset: available,
        revision: {
          id: revisionId,
          assetId,
          sha256,
          createdAt,
        },
        physical: {
          sha256,
          relativePath: relativePath || finalRelativePath(sha256),
          byteLength,
        },
        importId,
      });

      return available;
    } catch (error) {
      // Fault injection leaves journal for reconcileImports().
      if (error instanceof ImportFaultError) {
        throw error;
      }
      // Validation / IO reject: abandon pending so callers need not reconcile.
      await this.abandonImport(journal);
      throw error;
    }
  }

  async getAsset(id: string): Promise<AssetRecord | undefined> {
    const asset = await this.meta.getAsset(id);
    return asset ? normalizeAssetRecord(asset) : undefined;
  }

  async readRevision(revisionId: string): Promise<ReadableStream<Uint8Array>> {
    const revision = await this.meta.getRevision(revisionId);
    if (!revision) {
      throw new Error(`unknown revision: ${revisionId}`);
    }
    const physical = await this.meta.getPhysical(revision.sha256);
    if (!physical) {
      throw new Error(`missing physical object for ${revision.sha256}`);
    }
    const bytes = await this.files.readBytes(physical.relativePath);
    return bytesToStream(bytes);
  }

  async reconcileImports(): Promise<{ repaired: number; missing: string[] }> {
    const journal = await this.meta.listJournal();
    let repaired = 0;
    const missing: string[] = [];

    for (const entry of journal) {
      try {
        const did = await this.reconcileOne(entry);
        if (did) {
          repaired += 1;
        }
      } catch {
        missing.push(entry.assetId);
        await this.abandonImport(entry);
      }
    }

    return { repaired, missing };
  }

  private async reconcileOne(entry: JournalEntry): Promise<boolean> {
    if (entry.stage === 'pending') {
      await this.abandonImport(entry);
      return true;
    }

    if (entry.stage === 'written') {
      const hash = entry.finalHash;
      if (!hash) {
        await this.abandonImport(entry);
        return true;
      }
      const finalPath = finalRelativePath(hash);
      if (await this.files.pathExists(finalPath)) {
        // Promote already happened; finish commit.
        await this.finishFromHash(entry, hash);
        return true;
      }
      if (!(await this.files.pathExists(entry.tempPath))) {
        await this.abandonImport(entry);
        return true;
      }
      const bytes = await this.files.readBytes(entry.tempPath);
      const validated = await hashAndValidate(bytes, entry.mime);
      if (validated.sha256 !== hash) {
        await this.abandonImport(entry);
        return true;
      }
      await this.files.promote(entry.tempPath, hash);
      await this.finishFromHash(entry, hash);
      return true;
    }

    // promoted
    const hash = entry.finalHash;
    if (!hash) {
      await this.abandonImport(entry);
      return true;
    }
    const finalPath = finalRelativePath(hash);
    if (!(await this.files.pathExists(finalPath))) {
      // Try temp as last resort
      if (await this.files.pathExists(entry.tempPath)) {
        await this.files.promote(entry.tempPath, hash);
      } else {
        await this.abandonImport(entry);
        return true;
      }
    }
    await this.finishFromHash(entry, hash);
    return true;
  }

  private async finishFromHash(
    entry: JournalEntry,
    sha256: string,
  ): Promise<void> {
    const finalPath = finalRelativePath(sha256);
    const bytes = await this.files.readBytes(finalPath);
    const existing = await this.meta.getAsset(entry.assetId);
    const available = normalizeAssetRecord({
      id: entry.assetId,
      revisionId: entry.revisionId,
      kind: entry.kind,
      name: entry.name,
      mime: entry.mime,
      sha256,
      bytes: bytes.byteLength,
      state: 'available',
      createdAt: entry.createdAt,
      favorite: existing?.favorite ?? false,
      rating: existing?.rating ?? null,
      folderId: existing?.folderId ?? null,
      trashedAt: existing?.trashedAt ?? null,
    });
    parseAssetRecord(available);
    await this.meta.commitAvailable({
      asset: available,
      revision: {
        id: entry.revisionId,
        assetId: entry.assetId,
        sha256,
        createdAt: entry.createdAt,
      },
      physical: {
        sha256,
        relativePath: finalPath,
        byteLength: bytes.byteLength,
      },
      importId: entry.importId,
    });
  }

  private async abandonImport(entry: JournalEntry): Promise<void> {
    await this.files.remove(entry.tempPath).catch(() => undefined);
    // If promote already placed a final object but commit never ran, and no
    // other revision references the hash, drop the orphaned final bytes.
    if (entry.finalHash) {
      const remaining = (await this.meta.listRevisions()).filter(
        (r) => r.sha256 === entry.finalHash,
      );
      if (remaining.length === 0) {
        const finalPath = finalRelativePath(entry.finalHash);
        await this.files.remove(finalPath).catch(() => undefined);
        const physical = await this.meta.getPhysical(entry.finalHash);
        if (physical) {
          await this.meta.deletePhysical(entry.finalHash);
        }
      }
    }
    const asset = await this.meta.getAsset(entry.assetId);
    if (asset && asset.state !== 'available') {
      await this.meta.deleteAsset(entry.assetId);
    }
    await this.meta.deleteJournal(entry.importId);
  }

  async storageUsage(): Promise<{
    originals: number;
    cache: number;
    available?: number;
  }> {
    const hashes = new Set<string>();
    for (const asset of await this.meta.listAssets()) {
      if (asset.state === 'available' && asset.sha256) {
        hashes.add(asset.sha256);
      }
    }
    let originals = 0;
    for (const hash of hashes) {
      const obj = await this.meta.getPhysical(hash);
      if (obj) {
        originals += obj.byteLength;
      }
    }

    const available = this.files.availableBytes
      ? await this.files.availableBytes()
      : undefined;
    return { originals, cache: 0, available };
  }

  async queryAssets(query: AssetQuery): Promise<AssetQueryResult> {
    const limit = Math.max(1, Math.min(query.limit ?? 50, 500));
    const wantTrashed = query.trashed === true;
    let assets = (await this.meta.listAssets()).map((a) =>
      normalizeAssetRecord(a),
    );

    assets = assets.filter((a) => a.state === 'available');
    assets = assets.filter((a) =>
      wantTrashed ? a.trashedAt !== null : a.trashedAt === null,
    );

    if (query.kind !== undefined) {
      assets = assets.filter((a) => a.kind === query.kind);
    }
    if (query.favorite !== undefined) {
      assets = assets.filter((a) => a.favorite === query.favorite);
    }
    if (query.folderId !== undefined) {
      assets = assets.filter((a) => a.folderId === query.folderId);
    }
    if (query.text) {
      const needle = query.text.toLowerCase();
      assets = assets.filter((a) => a.name.toLowerCase().includes(needle));
    }
    if (query.collectionId) {
      const members = await this.meta.listCollectionMembers(query.collectionId);
      const ids = new Set(members.map((m) => m.assetId));
      assets = assets.filter((a) => ids.has(a.id));
    }
    if (query.tags && query.tags.length > 0) {
      const allTags = await this.meta.listAssetTags();
      const byAsset = new Map<string, Set<string>>();
      for (const row of allTags) {
        let set = byAsset.get(row.assetId);
        if (!set) {
          set = new Set();
          byAsset.set(row.assetId, set);
        }
        set.add(row.tag);
      }
      assets = assets.filter((a) => {
        const set = byAsset.get(a.id);
        if (!set) {
          return false;
        }
        return query.tags!.every((t) => set.has(t));
      });
    }

    assets.sort((a, b) => compareAssets(a, b, query.sort));

    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      assets = assets.filter((a) => afterCursor(a, query.sort, cursor));
    }

    const page = assets.slice(0, limit);
    const next =
      assets.length > limit
        ? encodeCursor({
            sortValue: sortValueFor(page[page.length - 1]!, query.sort),
            id: page[page.length - 1]!.id,
          })
        : undefined;

    return { assets: page, nextCursor: next };
  }

  async applyLibraryAction(request: LibraryActionRequest): Promise<void> {
    const { assetIds, action, value } = request;
    if (assetIds.length === 0) {
      return;
    }

    for (const id of assetIds) {
      const asset = await this.meta.getAsset(id);
      if (!asset) {
        continue;
      }
      const current = normalizeAssetRecord(asset);

      switch (action) {
        case 'tag': {
          if (typeof value !== 'string' || value.length === 0) {
            throw new Error('tag action requires a non-empty string value');
          }
          await this.meta.putAssetTag({ assetId: id, tag: value });
          break;
        }
        case 'untag': {
          if (typeof value !== 'string' || value.length === 0) {
            throw new Error('untag action requires a non-empty string value');
          }
          await this.meta.deleteAssetTag(id, value);
          break;
        }
        case 'favorite': {
          if (typeof value !== 'boolean') {
            throw new Error('favorite action requires a boolean value');
          }
          await this.meta.putAsset({ ...current, favorite: value });
          break;
        }
        case 'rating': {
          const rating =
            value === null
              ? null
              : typeof value === 'number' &&
                  Number.isInteger(value) &&
                  value >= 0 &&
                  value <= 5
                ? value
                : undefined;
          if (rating === undefined) {
            throw new Error('rating action requires integer 0–5 or null');
          }
          await this.meta.putAsset({
            ...current,
            rating,
          });
          break;
        }
        case 'collection': {
          if (typeof value !== 'string' || value.length === 0) {
            throw new Error('collection action requires a collection id');
          }
          await this.meta.putCollectionMember({
            collectionId: value,
            assetId: id,
          });
          break;
        }
        case 'remove-from-collection': {
          if (typeof value !== 'string' || value.length === 0) {
            throw new Error(
              'remove-from-collection action requires a collection id',
            );
          }
          await this.meta.deleteCollectionMember(value, id);
          break;
        }
        case 'folder': {
          const folderId =
            value === null
              ? null
              : typeof value === 'string' && value.length > 0
                ? value
                : undefined;
          if (folderId === undefined) {
            throw new Error('folder action requires a folder id or null');
          }
          await this.meta.putAsset({
            ...current,
            folderId,
          });
          break;
        }
        case 'trash': {
          if (current.trashedAt === null) {
            await this.meta.putAsset({
              ...current,
              trashedAt: new Date().toISOString(),
            });
          }
          break;
        }
        case 'restore': {
          if (current.trashedAt !== null) {
            await this.meta.putAsset({ ...current, trashedAt: null });
          }
          break;
        }
        case 'permanent-delete': {
          if (current.trashedAt === null) {
            throw new Error(
              `permanent-delete requires a soft-trashed asset (missing trashedAt): ${id}`,
            );
          }
          await this.purgeLogicalAsset(id);
          break;
        }
        default: {
          const _exhaustive: never = action;
          void _exhaustive;
          throw new Error('unsupported library action');
        }
      }
    }
  }

  /**
   * Hard-delete a logical asset and GC the physical object only when no
   * remaining revision references its sha256. Test helpers call this directly;
   * `applyLibraryAction({ action: 'permanent-delete' })` gates on `trashedAt`
   * before invoking it. Production `openWebLibrary` does not expose this helper.
   */
  async purgeLogicalAsset(id: string): Promise<void> {
    const asset = await this.meta.getAsset(id);
    if (!asset) {
      return;
    }
    const sha256 = asset.sha256;
    await this.meta.deleteRevision(asset.revisionId);
    await this.meta.deleteCollectionMembersForAsset(id);
    await this.meta.deleteAssetTagsForAsset(id);
    await this.meta.deleteAsset(id);

    if (!sha256) {
      return;
    }
    const remaining = (await this.meta.listRevisions()).filter(
      (r) => r.sha256 === sha256,
    );
    if (remaining.length === 0) {
      const physical = await this.meta.getPhysical(sha256);
      if (physical) {
        await this.files.remove(physical.relativePath);
        await this.meta.deletePhysical(sha256);
      }
    }
  }

  physicalObjectCount(): Promise<number> {
    return this.meta.countPhysical();
  }

  /** Test helper: rewrite createdAt for stable pagination fixtures. */
  async forceCreatedAt(assetId: string, createdAt: string): Promise<void> {
    const asset = await this.meta.getAsset(assetId);
    if (!asset) {
      throw new Error(`unknown asset: ${assetId}`);
    }
    await this.meta.putAsset(
      normalizeAssetRecord({ ...normalizeAssetRecord(asset), createdAt }),
    );
  }

  async listJournal(): Promise<JournalEntry[]> {
    return this.meta.listJournal();
  }

  /** Host surface for G4 portable archives. */
  getArchiveHost(): {
    meta: MetaStore;
    files: FileStore;
    purgeLogicalAsset(id: string): Promise<void>;
  } {
    return {
      meta: this.meta,
      files: this.files,
      purgeLogicalAsset: (id: string) => this.purgeLogicalAsset(id),
    };
  }

  async createCharacter(input: {
    name: string;
    referenceRevisionId: string;
  }): Promise<{ characterId: string; revisionId: string }> {
    const name = input.name.trim();
    if (!name) {
      throw new Error('createCharacter requires a name');
    }
    const availability = await this.referenceAvailability(
      input.referenceRevisionId,
    );
    if (availability !== 'available') {
      throw new Error('createCharacter requires an available image revision');
    }
    const revision = await this.meta.getRevision(input.referenceRevisionId);
    if (!revision) {
      throw new Error('createCharacter requires an available image revision');
    }
    const asset = await this.meta.getAsset(revision.assetId);
    if (!asset || asset.kind !== 'image' || asset.state !== 'available') {
      throw new Error('createCharacter requires an available image revision');
    }
    const characterId = newId();
    const revisionId = newId();
    const createdAt = new Date().toISOString();
    const characterRevision = createInitialRevision({
      id: revisionId,
      characterId,
      referenceRevisionId: input.referenceRevisionId,
    });
    const character = parseCharacterRecord({
      id: characterId,
      name,
      currentRevisionId: revisionId,
      coverAssetRevisionId: input.referenceRevisionId,
      createdAt,
    });
    await this.meta.commitCharacterRevision({
      character,
      revision: characterRevision,
    });
    return { characterId, revisionId };
  }

  listCharacters(): Promise<CharacterRecord[]> {
    return this.meta.listCharacters();
  }

  getCharacter(id: string): Promise<CharacterRecord | undefined> {
    return this.meta.getCharacter(id);
  }

  listCharacterRevisions(characterId: string): Promise<CharacterRevision[]> {
    return this.meta.listCharacterRevisions(characterId);
  }

  getCharacterRevision(id: string): Promise<CharacterRevision | undefined> {
    return this.meta.getCharacterRevision(id);
  }

  async saveCharacterRevision(revision: CharacterRevision): Promise<void> {
    const next = parseCharacterRevision(revision);
    await this.meta.commitCharacterRevision({
      revision: next,
      expectedCurrentRevisionId: next.parentRevisionId ?? null,
    });
  }

  async saveLook(look: LookRevision): Promise<void> {
    const next = parseLookRevision(look);
    const character = await this.meta.getCharacter(next.characterId);
    if (!character) {
      throw new Error(`unknown character: ${next.characterId}`);
    }
    await this.meta.putLook(next);
  }

  listLooks(characterId: string): Promise<LookRevision[]> {
    return this.meta.listLooks(characterId);
  }

  getLook(id: string): Promise<LookRevision | undefined> {
    return this.meta.getLook(id);
  }

  async setCover(characterId: string, assetRevisionId: string): Promise<void> {
    const character = await this.meta.getCharacter(characterId);
    if (!character) {
      throw new Error(`unknown character: ${characterId}`);
    }
    const revision = await this.meta.getCharacterRevision(
      character.currentRevisionId,
    );
    if (!revision) {
      throw new Error(
        `unknown character revision: ${character.currentRevisionId}`,
      );
    }
    const cover = selectCover(revision, assetRevisionId);
    await this.meta.putCharacter({
      ...character,
      coverAssetRevisionId: cover,
    });
  }

  async renameCharacter(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('character name is required');
    }
    const character = await this.meta.getCharacter(id);
    if (!character) {
      throw new Error(`unknown character: ${id}`);
    }
    await this.meta.putCharacter({ ...character, name: trimmed });
  }

  async referenceAvailability(
    assetRevisionId: string,
  ): Promise<'available' | 'missing'> {
    const revision = await this.meta.getRevision(assetRevisionId);
    if (!revision) {
      return 'missing';
    }
    const asset = await this.meta.getAsset(revision.assetId);
    if (!asset || asset.kind !== 'image' || asset.state !== 'available') {
      return 'missing';
    }
    const physical = await this.meta.getPhysical(revision.sha256);
    if (!physical) {
      return 'missing';
    }
    if (!(await this.files.pathExists(physical.relativePath))) {
      return 'missing';
    }
    return 'available';
  }

  /** Test helper: drop the local original and mark the asset missing. */
  async markAssetMissing(assetId: string): Promise<void> {
    const asset = await this.meta.getAsset(assetId);
    if (!asset) {
      throw new Error(`unknown asset: ${assetId}`);
    }
    const revision = await this.meta.getRevision(asset.revisionId);
    if (revision) {
      const physical = await this.meta.getPhysical(revision.sha256);
      if (physical) {
        const remaining = (await this.meta.listRevisions()).filter(
          (item) => item.sha256 === revision.sha256 && item.id !== revision.id,
        );
        // Only drop shared bytes when no other logical revision still needs them.
        if (remaining.length === 0) {
          await this.files.remove(physical.relativePath).catch(() => undefined);
          await this.meta.deletePhysical(revision.sha256);
        }
      }
    }
    await this.meta.putAsset(
      normalizeAssetRecord({
        ...normalizeAssetRecord(asset),
        state: 'missing',
      }),
    );
  }
}
