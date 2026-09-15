import type { GenerationDraft } from '@char2vid/domain';

export type CostState =
  'estimate' | 'reservation' | 'final' | 'refund' | 'unknown';

export interface CostRecord {
  state: CostState;
  amount?: number;
  currency?: string;
  durationSeconds?: number;
  source?: string;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function durationFromDraft(draft: GenerationDraft): number | undefined {
  return asFiniteNumber(draft.parameters.duration);
}

/** Queue-time cost: duration becomes an estimate; otherwise unknown. */
export function estimateJobCost(draft: GenerationDraft): CostRecord {
  const durationSeconds = durationFromDraft(draft);
  if (durationSeconds === undefined) {
    return { state: 'unknown' };
  }
  return { state: 'estimate', durationSeconds };
}

export function initialJobCost(draft: GenerationDraft): CostRecord {
  return estimateJobCost(draft);
}

/** Spend-limit hold once a worker claims the job. */
export function reserveJobCost(current: CostRecord): CostRecord {
  if (current.durationSeconds === undefined) {
    return current;
  }
  if (current.state === 'estimate' || current.state === 'unknown') {
    return { ...current, state: 'reservation' };
  }
  return current;
}

export function applyProviderCost(
  current: CostRecord,
  cost: unknown,
  refund = false,
): CostRecord {
  const amount = asFiniteNumber(cost);
  if (refund) {
    return {
      ...current,
      state: 'refund',
      ...(amount !== undefined ? { amount } : {}),
      source: 'provider',
    };
  }
  if (amount === undefined) {
    return current;
  }
  return {
    ...current,
    state: 'final',
    amount,
    source: 'provider',
  };
}

export function parseCostJson(raw: string): CostRecord {
  try {
    const parsed = JSON.parse(raw) as CostRecord;
    if (
      parsed &&
      (parsed.state === 'estimate' ||
        parsed.state === 'reservation' ||
        parsed.state === 'final' ||
        parsed.state === 'refund' ||
        parsed.state === 'unknown')
    ) {
      return parsed;
    }
  } catch {
    // Fall through to unknown.
  }
  return { state: 'unknown' };
}
