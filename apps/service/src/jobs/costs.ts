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

/** Queue-time cost: reserve recorded duration, otherwise unknown. */
export function initialJobCost(draft: GenerationDraft): CostRecord {
  const durationSeconds = durationFromDraft(draft);
  if (durationSeconds === undefined) {
    return { state: 'unknown' };
  }
  return { state: 'reservation', durationSeconds };
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
