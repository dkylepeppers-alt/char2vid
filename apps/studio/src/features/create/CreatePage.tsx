import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Operation, ReferenceBinding } from '@char2vid/domain';
import type { AssetRecord } from '@char2vid/domain/storage';
import {
  buildRequest,
  refreshCatalogs,
  type NanoGptModelDescriptor,
} from '@char2vid/nanogpt';

import { getStudioLibrary } from '../library/library-session';
import {
  resolveStudioSession,
  stageLibraryReferences,
  submitGenerationJob,
} from '../jobs/job-sync';
import {
  clearDraftClientRequestId,
  createSubmitGate,
  draftFingerprint,
  resolveDraftClientRequestId,
} from './create-submit';
import { ModelControls } from './ModelControls';
import { MODEL_PAGE_SIZE, ModelPicker, type ModelFilter } from './ModelPicker';
import { ReferenceTray } from './ReferenceTray';

const DRAFT_KEY = 'char2vid.create-draft';
const FAVORITE_KEY = 'char2vid.favorite-models';
const RECENT_KEY = 'char2vid.recent-models';
const MODEL_KEY = 'char2vid.create-model';
const PARAMS_KEY = 'char2vid.create-params';
const REFS_KEY = 'char2vid.create-references';

const OPERATION: Operation = 'image-generate';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function catalogFetcher(url: string) {
  const response = await fetch(url);
  try {
    return {
      status: response.status,
      body: (await response.json()) as unknown,
    };
  } catch {
    return { status: response.status, body: null };
  }
}

export function CreatePage() {
  const [prompt, setPrompt] = useState(
    () => window.localStorage.getItem(DRAFT_KEY) ?? '',
  );
  const [models, setModels] = useState<NanoGptModelDescriptor[]>([]);
  const [staleLabel, setStaleLabel] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ModelFilter>('compatible');
  const [visibleCount, setVisibleCount] = useState(MODEL_PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    window.localStorage.getItem(MODEL_KEY),
  );
  const [parameters, setParameters] = useState<Record<string, unknown>>(() =>
    readJson(PARAMS_KEY, {}),
  );
  const [invalidated, setInvalidated] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>(() =>
    readJson(FAVORITE_KEY, []),
  );
  const [recent, setRecent] = useState<string[]>(() =>
    readJson(RECENT_KEY, []),
  );
  const [references, setReferences] = useState<ReferenceBinding[]>(() =>
    readJson(REFS_KEY, []),
  );
  const [libraryAssets, setLibraryAssets] = useState<AssetRecord[]>([]);
  const [serviceReady, setServiceReady] = useState(false);
  const [submitState, setSubmitState] = useState<string | null>(null);
  const submitGate = useRef(createSubmitGate());

  useEffect(() => {
    let cancelled = false;
    void refreshCatalogs(catalogFetcher, {
      now: () => new Date().toISOString(),
    }).then((result) => {
      if (cancelled) return;
      const next = Object.values(result).flatMap(
        (item) => item.snapshot?.models ?? [],
      );
      setModels(next);
      const image = result.image;
      if (image.state === 'stale' && image.fetchedAt) {
        setStaleLabel(`Showing catalog from ${image.fetchedAt}`);
      } else if (image.state === 'unavailable') {
        setStaleLabel('Catalog unavailable. Retry when online.');
      } else if (image.fetchedAt) {
        setStaleLabel(`Catalog fetched ${image.fetchedAt}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getStudioLibrary()
      .then(async (library) => {
        const page = await library.queryAssets({
          kind: 'image',
          sort: 'createdAt-desc',
          limit: 48,
        });
        if (!cancelled) {
          setLibraryAssets(page.assets);
        }
      })
      .catch(() => undefined);
    void resolveStudioSession()
      .then((session) => {
        if (!cancelled) {
          setServiceReady(session !== null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = models.find((model) => model.id === selectedId) ?? null;

  const preview = useMemo(() => {
    if (!selected) return null;
    return buildRequest(
      {
        clientRequestId: 'preview',
        operation: OPERATION,
        modelId: selected.id,
        prompt,
        references,
        parameters,
      },
      selected,
      [],
    );
  }, [parameters, prompt, references, selected]);

  const persistReferences = useCallback((next: ReferenceBinding[]) => {
    setReferences(next);
    window.localStorage.setItem(REFS_KEY, JSON.stringify(next));
  }, []);

  const selectModel = useCallback(
    (model: NanoGptModelDescriptor) => {
      const allowed = new Set(model.controls.map((control) => control.key));
      const dropped = Object.keys(parameters).filter(
        (key) => !allowed.has(key),
      );
      const nextParams = Object.fromEntries(
        Object.entries(parameters).filter(([key]) => allowed.has(key)),
      );
      setSelectedId(model.id);
      setParameters(nextParams);
      setInvalidated(dropped);
      window.localStorage.setItem(MODEL_KEY, model.id);
      window.localStorage.setItem(PARAMS_KEY, JSON.stringify(nextParams));
      const nextRecent = [
        model.id,
        ...recent.filter((id) => id !== model.id),
      ].slice(0, 24);
      setRecent(nextRecent);
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(nextRecent));
    },
    [parameters, recent],
  );

  const canGenerate =
    serviceReady && selected !== null && prompt.trim().length > 0;

  return (
    <section className="draft-card create-page" aria-labelledby="draft-title">
      <div>
        <p className="section-kicker">Draft</p>
        <h2 id="draft-title">Shape your next shot</h2>
        <p>
          Image-first create: pick a catalog model, attach library references,
          and submit a durable job. This UI never calls Nano-GPT directly.
        </p>
      </div>
      <label htmlFor="prompt">Prompt</label>
      <textarea
        id="prompt"
        value={prompt}
        placeholder="Describe the image or scene you want to make…"
        onChange={(event) => {
          const value = event.target.value;
          setPrompt(value);
          window.localStorage.setItem(DRAFT_KEY, value);
        }}
      />
      <ReferenceTray
        references={references}
        libraryAssets={libraryAssets}
        onAttach={(asset) => {
          persistReferences([
            ...references,
            {
              assetRevisionId: asset.revisionId,
              role: 'identity',
              ordinal: references.length,
            },
          ]);
        }}
        onRemove={(assetRevisionId) => {
          persistReferences(
            references
              .filter((item) => item.assetRevisionId !== assetRevisionId)
              .map((item, ordinal) => ({ ...item, ordinal })),
          );
        }}
      />
      <ModelPicker
        models={models}
        operation={OPERATION}
        references={references}
        selectedId={selectedId}
        filter={filter}
        query={query}
        favorites={favorites}
        recent={recent}
        staleLabel={staleLabel}
        visibleCount={visibleCount}
        onFilter={(next) => {
          setFilter(next);
          setVisibleCount(MODEL_PAGE_SIZE);
        }}
        onQuery={(next) => {
          setQuery(next);
          setVisibleCount(MODEL_PAGE_SIZE);
        }}
        onSelect={selectModel}
        onLoadMore={() => setVisibleCount((count) => count + MODEL_PAGE_SIZE)}
      />
      {selected ? (
        <>
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              const next = favorites.includes(selected.id)
                ? favorites.filter((id) => id !== selected.id)
                : [...favorites, selected.id];
              setFavorites(next);
              window.localStorage.setItem(FAVORITE_KEY, JSON.stringify(next));
            }}
          >
            {favorites.includes(selected.id) ? 'Unfavorite' : 'Favorite'}
          </button>
          <ModelControls
            controls={selected.controls}
            values={parameters}
            invalidated={invalidated}
            onChange={(key, value) => {
              const next = { ...parameters, [key]: value };
              if (value === undefined) delete next[key];
              setParameters(next);
              window.localStorage.setItem(PARAMS_KEY, JSON.stringify(next));
            }}
          />
          <section aria-labelledby="request-preview-title">
            <h2 id="request-preview-title">Request preview</h2>
            <pre className="request-preview">
              {JSON.stringify(
                {
                  model: selected.id,
                  issues: preview?.issues ?? [],
                  request: preview?.request ?? null,
                },
                null,
                2,
              )}
            </pre>
          </section>
        </>
      ) : null}
      <button
        className="primary-action"
        disabled={!canGenerate || submitState === 'working'}
        aria-busy={submitState === 'working'}
        onClick={() => {
          if (!selected) return;
          if (!submitGate.current.tryEnter()) return;
          setSubmitState('working');
          const draft = {
            operation: OPERATION,
            modelId: selected.id,
            prompt,
            references,
            parameters,
          };
          const clientRequestId = resolveDraftClientRequestId({
            storage: window.localStorage,
            fingerprint: draftFingerprint(draft),
            mint: () => crypto.randomUUID(),
          });
          void (async () => {
            const session = await resolveStudioSession();
            if (!session) {
              setServiceReady(false);
              setSubmitState('Connect the generation service to submit');
              return;
            }
            const library = await getStudioLibrary();
            const transferIds = await stageLibraryReferences(
              session,
              library,
              references,
            );
            const receipt = await submitGenerationJob(
              session,
              {
                clientRequestId,
                ...draft,
              },
              transferIds,
            );
            clearDraftClientRequestId(window.localStorage);
            setSubmitState(
              `Queued ${receipt.clientRequestId} (${receipt.providerState})`,
            );
          })()
            .catch((error: unknown) => {
              setSubmitState(
                error instanceof Error ? error.message : 'job_submit_failed',
              );
            })
            .finally(() => {
              submitGate.current.leave();
            });
        }}
      >
        {canGenerate ? 'Generate' : 'Connect the generation service to submit'}
      </button>
      {submitState && submitState !== 'working' ? (
        <p className="backup-status" role="status">
          {submitState}
        </p>
      ) : null}
    </section>
  );
}
