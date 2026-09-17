import { useEffect, useMemo, useRef, useState } from 'react';

import type { Operation, ReferenceBinding } from '@char2vid/domain';
import type { CharacterRevision } from '@char2vid/domain/characters/schema';
import { freezeRequest } from '@char2vid/domain/generation/request-snapshot';
import { characterSheetGenerateChecklist } from '@char2vid/domain/debug-log';
import {
  buildRequest,
  refreshCatalogs,
  type NanoGptModelDescriptor,
} from '@char2vid/nanogpt';

import {
  logStudioError,
  studioDebugLog,
  useChecklistLog,
} from '../../app/debug-session';

import {
  resolveStudioSession,
  stageLibraryReferences,
  submitGenerationJob,
  syncStudioJobs,
} from '../jobs/job-sync';
import { getStudioLibrary } from '../library/library-session';
import {
  clearDraftClientRequestId,
  createSubmitGate,
  draftFingerprint,
  resolveDraftClientRequestId,
} from '../create/create-submit';
import { ModelControls } from '../create/ModelControls';
import {
  MODEL_PAGE_SIZE,
  ModelPicker,
  type ModelFilter,
} from '../create/ModelPicker';
import { planStudioReferences } from '../create/plan-create-references';
import { ReferenceAssignmentSheet } from '../create/ReferenceAssignmentSheet';

const OPERATION: Operation = 'image-generate';

export function CharacterSheetGenerate({
  revision,
  onAttached,
}: {
  revision: CharacterRevision;
  onAttached?: () => void;
}) {
  const identity = revision.references.find(
    (reference) =>
      reference.role === 'identity' && reference.approval === 'approved',
  );
  const [models, setModels] = useState<NanoGptModelDescriptor[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ModelFilter>('compatible');
  const [visibleCount, setVisibleCount] = useState(MODEL_PAGE_SIZE);
  const [parameters, setParameters] = useState<Record<string, unknown>>({});
  const [mode, setMode] = useState<'one-slot' | 'sheet'>('one-slot');
  const [view, setView] = useState('front');
  const [submitState, setSubmitState] = useState<string | null>(null);
  const [serviceReady, setServiceReady] = useState(false);
  const submitGate = useRef(createSubmitGate());

  useEffect(() => {
    let cancelled = false;
    void refreshCatalogs(
      async (url) => {
        const response = await fetch(url);
        try {
          return {
            status: response.status,
            body: (await response.json()) as unknown,
          };
        } catch {
          return { status: response.status, body: null };
        }
      },
      { now: () => new Date().toISOString() },
    ).then((result) => {
      if (!cancelled) {
        setModels(
          Object.values(result).flatMap((item) => item.snapshot?.models ?? []),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void resolveStudioSession()
      .then((session) => {
        if (!cancelled) {
          setServiceReady(session !== null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setServiceReady(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = models.find((model) => model.id === selectedId) ?? null;
  const prompt =
    mode === 'sheet'
      ? 'Character sheet: front, left, right, back, and three-quarter views. Preserve identity. Not a training request.'
      : `Additional ${view} view of the same character. Preserve identity. Not a training request.`;
  const characterSlot = useMemo(
    () => ({
      characterId: revision.characterId,
      role: 'identity' as const,
      ...(mode === 'one-slot'
        ? {
            view: view as 'front' | 'left' | 'right' | 'back' | 'three-quarter',
          }
        : {}),
    }),
    [mode, revision.characterId, view],
  );
  const references: ReferenceBinding[] = useMemo(
    () =>
      identity
        ? [
            {
              assetRevisionId: identity.assetRevisionId,
              role: 'identity',
              characterRevisionId: revision.id,
              ordinal: 0,
            },
          ]
        : [],
    [identity, revision.id],
  );
  const plan = useMemo(
    () =>
      planStudioReferences({
        requested: references,
        operation: OPERATION,
        model: selected,
        parameters,
      }),
    [parameters, references, selected],
  );
  const preview = useMemo(() => {
    if (!selected) return null;
    return buildRequest(
      {
        clientRequestId: 'preview',
        operation: OPERATION,
        modelId: selected.id,
        prompt,
        references: plan.selected,
        parameters,
        characterSlot,
      },
      selected,
      [],
    );
  }, [characterSlot, parameters, plan.selected, prompt, selected]);
  const frozen = useMemo(() => {
    if (!selected) return null;
    return freezeRequest(
      {
        clientRequestId: 'preview',
        operation: OPERATION,
        modelId: selected.id,
        prompt,
        references: plan.selected,
        parameters,
        characterSlot,
      },
      { id: selected.id, fetchedAt: selected.fetchedAt },
      plan.selected,
    );
  }, [characterSlot, parameters, plan.selected, prompt, selected]);

  const estimate =
    'Cost is estimated by the generation service when the job is queued; this screen does not invent a price.';
  const generateChecklist = useMemo(
    () =>
      characterSheetGenerateChecklist({
        serviceReady,
        modelSelected: selected !== null,
        selectedReferenceCount: plan.selected.length,
        blockingIssueCount: plan.issues.filter(
          (issue) => issue.severity === 'blocking',
        ).length,
      }),
    [plan.issues, plan.selected.length, selected, serviceReady],
  );
  useChecklistLog('character-sheet-generate', generateChecklist, 'characters');

  const canGenerateView =
    serviceReady &&
    selected !== null &&
    plan.selected.length > 0 &&
    !plan.issues.some((issue) => issue.severity === 'blocking');
  const blockedGateIds = generateChecklist
    .filter((item) => item.state === 'blocked')
    .map((item) => item.id)
    .join(',');

  useEffect(() => {
    studioDebugLog().info(
      canGenerateView
        ? 'character.generate-gate.open'
        : 'character.generate-gate.blocked',
      {
        canGenerate: canGenerateView,
        blocked: blockedGateIds.length > 0 ? blockedGateIds.split(',') : [],
        modelId: selectedId,
        mode,
        view,
        referenceCount: plan.selected.length,
      },
      { screen: 'characters', route: '/characters' },
    );
  }, [
    blockedGateIds,
    canGenerateView,
    mode,
    plan.selected.length,
    selectedId,
    view,
  ]);

  return (
    <section
      className="character-generate"
      aria-labelledby="character-generate-title"
    >
      <h3 id="character-generate-title">Generate a view</h3>
      <p>
        Optional character-sheet or single-view generation uses the shared
        composer and jobs. Saved results attach as candidate slots on this
        character; accept them separately. This does not train a model and is
        not compatible with proprietary iModel files.
      </p>
      <label>
        Requested outputs
        <select
          aria-label="Requested outputs"
          value={mode}
          onChange={(event) =>
            setMode(event.target.value as 'one-slot' | 'sheet')
          }
        >
          <option value="one-slot">Generate one view</option>
          <option value="sheet">Generate multi-view sheet</option>
        </select>
      </label>
      {mode === 'one-slot' ? (
        <label>
          View
          <select
            aria-label="Generated view"
            value={view}
            onChange={(event) => setView(event.target.value)}
          >
            <option value="front">front</option>
            <option value="left">left</option>
            <option value="right">right</option>
            <option value="back">back</option>
            <option value="three-quarter">three-quarter</option>
          </select>
        </label>
      ) : null}
      <p className="library-card-meta">
        Model: {selected?.id ?? 'none'} · References: {plan.selected.length} ·
        Cost: {estimate}
      </p>
      <ReferenceAssignmentSheet
        selected={plan.selected}
        omitted={plan.omitted}
        issues={plan.issues}
        screen="characters"
      />
      <ModelPicker
        models={models}
        operation={OPERATION}
        references={references}
        selectedId={selectedId}
        filter={filter}
        query={query}
        favorites={[]}
        recent={[]}
        visibleCount={visibleCount}
        onFilter={(next) => {
          setFilter(next);
          setVisibleCount(MODEL_PAGE_SIZE);
        }}
        onQuery={setQuery}
        onSelect={(model) => setSelectedId(model.id)}
        onLoadMore={() => setVisibleCount((count) => count + MODEL_PAGE_SIZE)}
      />
      {selected ? (
        <ModelControls
          controls={selected.controls}
          values={parameters}
          invalidated={[]}
          onChange={(key, value) => {
            const next = { ...parameters, [key]: value };
            if (value === undefined) delete next[key];
            setParameters(next);
          }}
        />
      ) : null}
      <pre className="request-preview">
        {JSON.stringify(
          {
            model: selected?.id ?? null,
            references: plan.selected,
            characterSlot,
            requestedOutputs: mode,
            requestHash: frozen?.requestHash ?? null,
            issues: [...plan.issues, ...(preview?.issues ?? [])],
            request: preview?.request ?? null,
          },
          null,
          2,
        )}
      </pre>
      <button
        type="button"
        className="primary-action"
        disabled={!canGenerateView || submitState === 'working'}
        aria-busy={submitState === 'working'}
        onClick={() => {
          if (!selected) return;
          if (!submitGate.current.tryEnter()) {
            studioDebugLog().warn(
              'character.submit.busy',
              { modelId: selected.id, mode },
              { screen: 'characters', route: '/characters' },
            );
            return;
          }
          setSubmitState('working');
          const draft = {
            operation: OPERATION,
            modelId: selected.id,
            prompt,
            references: plan.selected,
            parameters,
            characterSlot,
          };
          const clientRequestId = resolveDraftClientRequestId({
            storage: window.localStorage,
            fingerprint: draftFingerprint(draft),
            mint: () => crypto.randomUUID(),
          });
          studioDebugLog().info(
            'character.submit.start',
            {
              clientRequestId,
              modelId: selected.id,
              operation: OPERATION,
              referenceCount: plan.selected.length,
              promptChars: prompt.trim().length,
              mode,
              view: mode === 'one-slot' ? view : 'sheet',
            },
            { screen: 'characters', route: '/characters' },
          );
          void (async () => {
            const session = await resolveStudioSession();
            if (!session) {
              setServiceReady(false);
              setSubmitState('Connect the generation service to submit');
              studioDebugLog().warn(
                'character.submit.blocked',
                { reason: 'service-not-ready', clientRequestId },
                { screen: 'characters', route: '/characters' },
              );
              return;
            }
            const library = await getStudioLibrary();
            const transferIds = await stageLibraryReferences(
              session,
              library,
              plan.selected,
            );
            const receipt = await submitGenerationJob(
              session,
              { clientRequestId, ...draft },
              transferIds,
            );
            clearDraftClientRequestId(window.localStorage);
            const cost = receipt.cost;
            const costLabel =
              cost?.state === 'final' && cost.amount !== undefined
                ? `final ${cost.amount}`
                : (cost?.state ?? 'unknown');
            setSubmitState(
              `Queued ${receipt.clientRequestId} (${receipt.providerState}). Cost ${costLabel}. Candidate slot attach waits for the local save.`,
            );
            studioDebugLog().info(
              'character.submit.ok',
              {
                clientRequestId: receipt.clientRequestId,
                jobId: receipt.id,
                providerState: receipt.providerState,
                transferCount: transferIds.length,
                costState: cost?.state ?? null,
              },
              { screen: 'characters', route: '/characters' },
            );
            for (let attempt = 0; attempt < 8; attempt += 1) {
              const jobs = await syncStudioJobs();
              const current = jobs.find(
                (job) => job.clientRequestId === clientRequestId,
              );
              if (current?.saveState === 'saved') {
                onAttached?.();
                setSubmitState(
                  `Saved ${receipt.clientRequestId} and attached a candidate slot.`,
                );
                studioDebugLog().info(
                  'character.slot.attached',
                  {
                    clientRequestId,
                    jobId: current.id,
                    saveState: current.saveState,
                  },
                  { screen: 'characters', route: '/characters' },
                );
                break;
              }
              await new Promise((resolve) => {
                window.setTimeout(resolve, 500);
              });
            }
          })()
            .catch((error: unknown) => {
              logStudioError(
                'character.submit.error',
                error,
                { clientRequestId },
                { screen: 'characters', route: '/characters' },
              );
              setSubmitState(
                error instanceof Error ? error.message : 'job_submit_failed',
              );
            })
            .finally(() => {
              submitGate.current.leave();
            });
        }}
      >
        {canGenerateView
          ? 'Generate view'
          : 'Connect the generation service to submit'}
      </button>
      {submitState && submitState !== 'working' ? (
        <p className="backup-status" role="status">
          {submitState}
        </p>
      ) : null}
    </section>
  );
}
