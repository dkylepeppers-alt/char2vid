import {
  GENERATION_CATALOGS,
  PUBLIC_CATALOG_URLS,
  type CatalogRefreshState,
  type GenerationCatalog,
  type NormalizedCatalog,
} from './catalog-schema';
import { normalizeCatalog } from './normalize';

export interface CatalogFetchResponse {
  status: number;
  /** Parsed JSON body (or whatever the transport produced). */
  body: unknown;
}

/**
 * Injected transport for public, unauthenticated catalog GETs. Tests pass a
 * fake; the app passes a thin wrapper over its HTTP client. Nothing in this
 * module touches the network itself.
 */
export type CatalogFetcher = (url: string) => Promise<CatalogFetchResponse>;

export interface CatalogRefreshResult {
  state: CatalogRefreshState;
  /** Records in the snapshot being shown (fresh or retained), 0 if none. */
  count: number;
  /** When the shown snapshot was fetched; absent when unavailable. */
  fetchedAt?: string;
  /** The fresh snapshot, or the retained previous one when stale. */
  snapshot?: NormalizedCatalog;
  /** Why the refresh failed, when it did. Never contains credentials. */
  error?: string;
}

export interface RefreshCatalogsOptions {
  /** Injected clock returning an ISO-8601 timestamp. */
  now: () => string;
  /** Per-catalog URL overrides (defaults to `PUBLIC_CATALOG_URLS`). */
  urls?: Partial<Record<GenerationCatalog, string>>;
  /** Last successful snapshots, retained as `stale` when a refresh fails. */
  previous?: Partial<Record<GenerationCatalog, NormalizedCatalog>>;
}

function redactSecrets(text: string): string {
  const redacted = '[redacted]';
  return text
    .replace(/Authorization:\s*\S+(?:\s+\S+)?/gi, `Authorization: ${redacted}`)
    .replace(/\bBearer\s+\S+/gi, `Bearer ${redacted}`)
    .replace(/\bCookie:\s*\S+/gi, `Cookie: ${redacted}`)
    .replace(/\bSet-Cookie:\s*\S+/gi, `Set-Cookie: ${redacted}`)
    .replace(
      /(["']?(?:x-api-key|api[_-]?key)["']?\s*[:=]\s*["']?)[^"'&\s,}]+/gi,
      `$1${redacted}`,
    )
    .replace(/\bheaders=\{[^}]*\}/gi, `headers=${redacted}`)
    .replace(
      /([?&](?:signature|token|key|expires|X-Amz-Signature)=)[^&\s]+/gi,
      `$1${redacted}`,
    );
}

function describeError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
  return redactSecrets(raw);
}

async function refreshOne(
  catalog: GenerationCatalog,
  url: string,
  fetcher: CatalogFetcher,
  now: () => string,
): Promise<NormalizedCatalog> {
  const response = await fetcher(url);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  const fetchedAt = now();
  const normalized = normalizeCatalog(catalog, response.body, fetchedAt);
  const blockingEnvelope = normalized.issues.find(
    (issue) => issue.modelId === undefined && issue.severity === 'blocking',
  );
  if (blockingEnvelope) {
    throw new Error(`${blockingEnvelope.code}: ${blockingEnvelope.message}`);
  }
  return { catalog, fetchedAt, url, ...normalized };
}

function retained(
  previous: NormalizedCatalog | undefined,
  error: string,
): CatalogRefreshResult {
  if (previous) {
    return {
      state: 'stale',
      count: previous.models.length,
      fetchedAt: previous.fetchedAt,
      snapshot: previous,
      error,
    };
  }
  return { state: 'unavailable', count: 0, error };
}

/**
 * Refreshes the four generation catalogs independently. A failure in one
 * modality never affects the others: the failed catalog is `stale` when a
 * previous snapshot exists (and that snapshot is returned unchanged) or
 * `unavailable` otherwise. Success is `fresh` with the new snapshot.
 */
export async function refreshCatalogs(
  fetcher: CatalogFetcher,
  options: RefreshCatalogsOptions,
): Promise<Record<GenerationCatalog, CatalogRefreshResult>> {
  const settled = await Promise.allSettled(
    GENERATION_CATALOGS.map((catalog) =>
      refreshOne(
        catalog,
        options.urls?.[catalog] ?? PUBLIC_CATALOG_URLS[catalog],
        fetcher,
        options.now,
      ),
    ),
  );

  const results = {} as Record<GenerationCatalog, CatalogRefreshResult>;
  GENERATION_CATALOGS.forEach((catalog, index) => {
    const outcome = settled[index];
    if (outcome?.status === 'fulfilled') {
      const snapshot = outcome.value;
      results[catalog] = {
        state: 'fresh',
        count: snapshot.models.length,
        fetchedAt: snapshot.fetchedAt,
        snapshot,
      };
    } else {
      results[catalog] = retained(
        options.previous?.[catalog],
        describeError(outcome?.reason),
      );
    }
  });
  return results;
}
