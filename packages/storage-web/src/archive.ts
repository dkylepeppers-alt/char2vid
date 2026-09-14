import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

import {
  ARCHIVE_SCHEMA_VERSION,
  MAX_ARCHIVE_EXPANDED_BYTES,
  MAX_ARCHIVE_FILE_COUNT,
  allowlistAssetRecord,
  emptyArchiveReport,
  isAllowedArchiveMemberPath,
  mediaArchivePath,
  parseArchiveManifestV1,
  parseArchiveRecordsV1,
  stripSecretFields,
  validateArchivePath,
  type ArchiveManifestV1,
  type ArchiveRecordsV1,
  type ArchiveReport,
  type ArchiveScope,
} from '@char2vid/domain/archive-schema';
import {
  collectLibraryIncomingIds,
  createCollisionMap,
  remapArchiveRecords,
  type IdMap,
} from '@char2vid/domain/archive-remap';
import { normalizeAssetRecord } from '@char2vid/domain/asset-schema';
import type { AssetRecord } from '@char2vid/domain/storage';

import { finalRelativePath, type FileStore } from './files';
import { sha256HexAsync } from './hash';
import type {
  AssetTagRow,
  CollectionMember,
  MetaStore,
  PhysicalObject,
  RevisionRecord,
} from './protocol';

export interface ArchiveSource {
  /** Raw zip bytes. */
  bytes: Uint8Array;
}

export interface ExportArchiveRequest {
  scope: ArchiveScope;
  id?: string;
}

export interface ExportArchiveResult {
  transferId: string;
  /** Complete zip bytes for web/Node adapters in this slice. */
  bytes: Uint8Array;
  fileName: string;
}

/** Test-only fault points for archive import rollback proofs. */
export type ArchiveImportFaultPoint = 'after-putPhysical';

export class ArchiveImportFaultError extends Error {
  readonly fault: ArchiveImportFaultPoint;

  constructor(fault: ArchiveImportFaultPoint) {
    super(`injected archive import fault: ${fault}`);
    this.name = 'ArchiveImportFaultError';
    this.fault = fault;
  }
}

export interface ImportArchiveOptions {
  conflict: 'remap';
  /**
   * Test-only: inject a fault after staging (writeTemp/promote/putPhysical)
   * and before `commitArchiveImport`, mirroring media-import journal faults.
   */
  fault?: ArchiveImportFaultPoint;
}

export interface ImportArchiveResult {
  idMap: IdMap;
  importedAssets: number;
}

/**
 * Host surface for portable archives. Built from LibraryEngine internals so
 * web and Node adapters share one implementation.
 */
export interface ArchiveHost {
  meta: MetaStore;
  files: FileStore;
  /** Roll back assets created during a failed import (ref-counted GC). */
  purgeLogicalAsset(id: string): Promise<void>;
}

function encodeJson(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

function decodeJson(bytes: Uint8Array): unknown {
  return JSON.parse(strFromU8(bytes)) as unknown;
}

async function readRevisionBytes(
  host: ArchiveHost,
  revision: RevisionRecord,
): Promise<Uint8Array> {
  const physical = await host.meta.getPhysical(revision.sha256);
  if (!physical) {
    throw new Error(`missing physical object for revision ${revision.id}`);
  }
  return host.files.readBytes(physical.relativePath);
}

function assertLibraryScope(request: ExportArchiveRequest): void {
  if (request.scope !== 'library') {
    throw new Error(
      `archive scope "${request.scope}" is not implemented in this web slice`,
    );
  }
  if (request.id) {
    throw new Error('library-scope export does not accept an id');
  }
}

/**
 * Stream-friendly export for library scope. This web slice builds the zip in
 * memory; 1 GiB whole-archive streaming remains UNVERIFIED on device.
 */
export async function exportArchive(
  host: ArchiveHost,
  request: ExportArchiveRequest,
): Promise<ExportArchiveResult> {
  assertLibraryScope(request);

  const transferId = crypto.randomUUID();
  // Portable library backups export live (non-trashed) available assets only.
  const assets = (await host.meta.listAssets())
    .map((a) => normalizeAssetRecord(a))
    .filter((a) => a.state === 'available' && a.trashedAt === null)
    .map((a) => allowlistAssetRecord(a));

  const assetIds = new Set(assets.map((a) => a.id));
  const revisions = (await host.meta.listRevisions()).filter((r) =>
    assetIds.has(r.assetId),
  );
  const collectionMembers = (await host.meta.listCollectionMembers()).filter(
    (m) => assetIds.has(m.assetId),
  );
  const assetTags = (await host.meta.listAssetTags()).filter((t) =>
    assetIds.has(t.assetId),
  );

  const mediaEntries: Record<string, Uint8Array> = {};
  const manifestFiles: ArchiveManifestV1['files'] = [];
  const seenHash = new Set<string>();

  for (const asset of assets) {
    if (seenHash.has(asset.sha256)) {
      continue;
    }
    seenHash.add(asset.sha256);
    const revision = revisions.find((r) => r.id === asset.revisionId);
    if (!revision) {
      throw new Error(`asset ${asset.id} missing revision ${asset.revisionId}`);
    }
    const bytes = await readRevisionBytes(host, revision);
    const digest = await sha256HexAsync(bytes);
    if (digest !== asset.sha256) {
      throw new Error(`checksum mismatch exporting asset ${asset.id}`);
    }
    const path = mediaArchivePath(asset.sha256, asset.mime);
    if (!validateArchivePath(path)) {
      throw new Error(`refusing unsafe media path: ${path}`);
    }
    mediaEntries[path] = bytes;
    manifestFiles.push({
      path,
      sha256: asset.sha256,
      bytes: bytes.byteLength,
      mime: asset.mime,
    });
  }

  const records: ArchiveRecordsV1 = {
    assets,
    revisions,
    collectionMembers,
    assetTags,
    characters: [],
    looks: [],
    shots: [],
    graphEdges: [],
    timeline: [],
  };

  const manifest: ArchiveManifestV1 = {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    scope: 'library',
    scopeId: null,
    files: manifestFiles,
    recordCounts: {
      assets: assets.length,
      revisions: revisions.length,
      collectionMembers: collectionMembers.length,
      assetTags: assetTags.length,
    },
  };

  // Build zip only after all members are ready so an interrupted export never
  // yields an apparently complete archive file.
  const zipEntries: Record<string, Uint8Array> = {
    'manifest.json': encodeJson(manifest),
    'records.json': encodeJson(stripSecretFields(records as never)),
    ...mediaEntries,
  };

  const bytes = zipSync(zipEntries, { level: 6 });
  return {
    transferId,
    bytes,
    fileName: `char2vid-library-${transferId.slice(0, 8)}.zip`,
  };
}

function unzipArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes);
  } catch (error) {
    throw new Error(
      `invalid archive zip: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Validate archive structure, paths, limits, and checksums without mutating
 * the library.
 */
export async function inspectArchive(
  source: ArchiveSource,
): Promise<ArchiveReport> {
  const report = emptyArchiveReport();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipArchive(source.bytes);
  } catch (error) {
    report.errors.push(
      error instanceof Error ? error.message : 'invalid archive zip',
    );
    return report;
  }

  const names = Object.keys(entries);
  report.fileCount = names.length;
  let expanded = 0;
  for (const name of names) {
    const data = entries[name]!;
    expanded += data.byteLength;
    if (!validateArchivePath(name) || !isAllowedArchiveMemberPath(name)) {
      report.invalidPaths.push(name);
    }
  }
  report.expandedBytes = expanded;

  if (names.length > MAX_ARCHIVE_FILE_COUNT) {
    report.errors.push(
      `archive file count ${names.length} exceeds limit ${MAX_ARCHIVE_FILE_COUNT}`,
    );
  }
  if (expanded > MAX_ARCHIVE_EXPANDED_BYTES) {
    report.errors.push(
      `expanded size ${expanded} exceeds limit ${MAX_ARCHIVE_EXPANDED_BYTES}`,
    );
  }
  if (report.invalidPaths.length > 0) {
    report.errors.push(
      `unsafe or disallowed member paths: ${report.invalidPaths.join(', ')}`,
    );
  }

  const manifestBytes = entries['manifest.json'];
  const recordsBytes = entries['records.json'];
  if (!manifestBytes) {
    report.missingFiles.push('manifest.json');
    report.errors.push('missing manifest.json');
  }
  if (!recordsBytes) {
    report.missingFiles.push('records.json');
    report.errors.push('missing records.json');
  }

  if (!manifestBytes || !recordsBytes) {
    return report;
  }

  let manifest: ArchiveManifestV1;
  try {
    const raw = decodeJson(manifestBytes) as { schemaVersion?: unknown };
    if (
      typeof raw?.schemaVersion === 'number' &&
      raw.schemaVersion !== ARCHIVE_SCHEMA_VERSION
    ) {
      report.schemaVersion = raw.schemaVersion;
      report.unsupportedVersion = true;
      report.errors.push(
        `unsupported archive schemaVersion ${raw.schemaVersion}`,
      );
      return report;
    }
    manifest = parseArchiveManifestV1(raw);
    report.schemaVersion = manifest.schemaVersion;
  } catch (error) {
    report.errors.push(
      `invalid manifest.json: ${error instanceof Error ? error.message : String(error)}`,
    );
    return report;
  }

  let records: ArchiveRecordsV1;
  try {
    records = parseArchiveRecordsV1(decodeJson(recordsBytes));
  } catch (error) {
    report.errors.push(
      `invalid records.json: ${error instanceof Error ? error.message : String(error)}`,
    );
    return report;
  }

  for (const file of manifest.files) {
    if (
      !validateArchivePath(file.path) ||
      !isAllowedArchiveMemberPath(file.path)
    ) {
      report.invalidPaths.push(file.path);
      report.errors.push(`manifest lists unsafe path: ${file.path}`);
      continue;
    }
    const data = entries[file.path];
    if (!data) {
      report.missingFiles.push(file.path);
      continue;
    }
    if (data.byteLength !== file.bytes) {
      report.errors.push(
        `byte length mismatch for ${file.path}: expected ${file.bytes}, got ${data.byteLength}`,
      );
    }
    const digest = await sha256HexAsync(data);
    if (digest !== file.sha256) {
      report.errors.push(`checksum mismatch for ${file.path}`);
    }
    const expectedName = mediaArchivePath(file.sha256, file.mime);
    if (file.path !== expectedName) {
      report.errors.push(
        `media path ${file.path} does not match sha256/mime (${expectedName})`,
      );
    }
  }

  for (const asset of records.assets) {
    if (asset.state !== 'available') {
      report.errors.push(`archive asset ${asset.id} is not available`);
      continue;
    }
    const path = mediaArchivePath(asset.sha256, asset.mime);
    if (!entries[path] && !manifest.files.some((f) => f.path === path)) {
      report.missingFiles.push(path);
    }
  }

  report.ok =
    report.errors.length === 0 &&
    report.invalidPaths.length === 0 &&
    report.missingFiles.length === 0 &&
    !report.unsupportedVersion;
  return report;
}

async function existingLogicalIds(meta: MetaStore): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const asset of await meta.listAssets()) {
    ids.add(asset.id);
    ids.add(asset.revisionId);
    if (asset.folderId) {
      ids.add(asset.folderId);
    }
  }
  for (const revision of await meta.listRevisions()) {
    ids.add(revision.id);
    ids.add(revision.assetId);
  }
  for (const member of await meta.listCollectionMembers()) {
    ids.add(member.collectionId);
    ids.add(member.assetId);
  }
  return ids;
}

/**
 * Import a verified library archive. Mutates the library only after inspect
 * succeeds; on failure, rolls back assets created in this call so the prior
 * library remains intact.
 */
export async function importArchive(
  host: ArchiveHost,
  source: ArchiveSource,
  options: ImportArchiveOptions,
): Promise<ImportArchiveResult> {
  if (options.conflict !== 'remap') {
    throw new Error(`unsupported conflict mode: ${String(options.conflict)}`);
  }

  const report = await inspectArchive(source);
  if (!report.ok) {
    throw new Error(
      `archive rejected: ${report.errors.join('; ') || 'validation failed'}`,
    );
  }

  const entries = unzipArchive(source.bytes);
  const manifest = parseArchiveManifestV1(
    decodeJson(entries['manifest.json']!),
  );
  if (manifest.scope !== 'library') {
    throw new Error(
      `archive scope "${manifest.scope}" is not implemented in this web slice`,
    );
  }
  const rawRecords = parseArchiveRecordsV1(
    decodeJson(entries['records.json']!),
  );

  const existing = await existingLogicalIds(host.meta);
  const incoming = collectLibraryIncomingIds(rawRecords);
  const idMap = createCollisionMap(existing, incoming);
  const remapped = remapArchiveRecords(rawRecords, idMap);

  const stagedTemps: string[] = [];
  const createdAssetIds: string[] = [];
  const promotedHashes: string[] = [];

  try {
    // Stage media to temps and promote content-addressed objects first. Orphan
    // physicals without metadata are harmless; metadata commit is last.
    for (const file of manifest.files) {
      const data = entries[file.path]!;
      const existingPhysical = await host.meta.getPhysical(file.sha256);
      if (existingPhysical) {
        continue;
      }
      const importId = crypto.randomUUID();
      const tempPath = await host.files.writeTemp(importId, data);
      stagedTemps.push(tempPath);
      const relativePath = await host.files.promote(tempPath, file.sha256);
      promotedHashes.push(file.sha256);
      const physical: PhysicalObject = {
        sha256: file.sha256,
        relativePath,
        byteLength: data.byteLength,
      };
      await host.meta.putPhysical(physical);
    }

    if (options.fault === 'after-putPhysical') {
      throw new ArchiveImportFaultError('after-putPhysical');
    }

    const assets: AssetRecord[] = remapped.assets.map((a) =>
      normalizeAssetRecord(allowlistAssetRecord(a)),
    );
    const revisions: RevisionRecord[] = remapped.revisions.map((r) => ({
      id: r.id,
      assetId: r.assetId,
      sha256: r.sha256,
      createdAt: r.createdAt,
    }));
    const collectionMembers: CollectionMember[] =
      remapped.collectionMembers.map((m) => ({
        collectionId: m.collectionId,
        assetId: m.assetId,
      }));
    const assetTags: AssetTagRow[] = remapped.assetTags.map((t) => ({
      assetId: t.assetId,
      tag: t.tag,
    }));

    // Track ids before commit for rollback.
    for (const asset of assets) {
      createdAssetIds.push(asset.id);
    }

    await host.meta.commitArchiveImport({
      assets,
      revisions,
      collectionMembers,
      assetTags,
    });

    return {
      idMap,
      importedAssets: assets.length,
    };
  } catch (error) {
    for (const assetId of createdAssetIds) {
      await host.purgeLogicalAsset(assetId).catch(() => undefined);
    }
    for (const tempPath of stagedTemps) {
      await host.files.remove(tempPath).catch(() => undefined);
    }
    // Drop physicals we promoted that no longer have revision refs.
    for (const sha of promotedHashes) {
      const remaining = (await host.meta.listRevisions()).filter(
        (r) => r.sha256 === sha,
      );
      if (remaining.length === 0) {
        await host.files.remove(finalRelativePath(sha)).catch(() => undefined);
        await host.meta.deletePhysical(sha).catch(() => undefined);
      }
    }
    throw error;
  }
}

export { validateArchivePath };
