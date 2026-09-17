import type { AssetRecord, LibraryPort } from '@char2vid/domain/storage';

import {
  findLibraryAssetByRevisionId,
  findLibraryAssetBySha256,
} from './find-library-asset';

export const JOB_OUTPUT_IMPORT_MAP_KEY = 'char2vid.job-output-imports';

export interface JobOutputImportRecord {
  revisionId: string;
  sha256: string;
}

type JobOutputImportMap = Record<string, JobOutputImportRecord>;

export function jobOutputImportKey(jobId: string, ordinal: number): string {
  return `${jobId}:${ordinal}`;
}

export function readJobOutputImportMap(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
): JobOutputImportMap {
  if (!storage) {
    return {};
  }
  const raw = storage.getItem(JOB_OUTPUT_IMPORT_MAP_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as JobOutputImportMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function lookupJobOutputImport(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
  jobId: string,
  ordinal: number,
  sha256: string,
): JobOutputImportRecord | undefined {
  const record =
    readJobOutputImportMap(storage)[jobOutputImportKey(jobId, ordinal)];
  if (record?.sha256 === sha256 && record.revisionId) {
    return record;
  }
  return undefined;
}

export function rememberJobOutputImport(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
  jobId: string,
  ordinal: number,
  record: JobOutputImportRecord,
): void {
  if (!storage) {
    return;
  }
  const next = {
    ...readJobOutputImportMap(storage),
    [jobOutputImportKey(jobId, ordinal)]: record,
  };
  storage.setItem(JOB_OUTPUT_IMPORT_MAP_KEY, JSON.stringify(next));
}

export async function resolveImportedOutput(
  library: LibraryPort,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
  jobId: string,
  ordinal: number,
  sha256: string,
): Promise<AssetRecord | undefined> {
  const mapped = lookupJobOutputImport(storage, jobId, ordinal, sha256);
  if (mapped) {
    const byRevision = await findLibraryAssetByRevisionId(
      library,
      mapped.revisionId,
    );
    if (byRevision?.sha256 === sha256 && byRevision.state === 'available') {
      return byRevision;
    }
  }
  return findLibraryAssetBySha256(library, sha256);
}
