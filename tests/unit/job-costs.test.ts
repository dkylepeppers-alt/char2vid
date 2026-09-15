import { describe, expect, it } from 'vitest';

import {
  applyProviderCost,
  estimateJobCost,
  initialJobCost,
  reserveJobCost,
} from '../../apps/service/src/jobs/costs';
import type { GenerationDraft } from '../../packages/domain/src/contracts';

function draft(overrides: Partial<GenerationDraft> = {}): GenerationDraft {
  return {
    clientRequestId: 'cost-1',
    operation: 'video-generate',
    modelId: 'fixture/video',
    prompt: 'A walk',
    references: [],
    parameters: {},
    ...overrides,
  };
}

describe('job cost producers (P4 residual / P5)', () => {
  it('produces estimate from input duration and unknown without it', () => {
    expect(estimateJobCost(draft({ parameters: { duration: 8 } }))).toEqual({
      state: 'estimate',
      durationSeconds: 8,
    });
    expect(estimateJobCost(draft())).toEqual({ state: 'unknown' });
    expect(initialJobCost(draft({ parameters: { duration: 8 } })).state).toBe(
      'estimate',
    );
  });

  it('promotes estimate to reservation when the worker claims the job', () => {
    const estimated = estimateJobCost(draft({ parameters: { duration: 5 } }));
    expect(reserveJobCost(estimated)).toEqual({
      state: 'reservation',
      durationSeconds: 5,
    });
    expect(reserveJobCost({ state: 'unknown' }).state).toBe('unknown');
  });

  it('records provider final cost and an explicit refund', () => {
    const reserved = reserveJobCost(
      estimateJobCost(draft({ parameters: { duration: 5 } })),
    );
    const final = applyProviderCost(reserved, 0.12);
    expect(final).toMatchObject({
      state: 'final',
      amount: 0.12,
      source: 'provider',
    });
    const refunded = applyProviderCost(final, 0.12, true);
    expect(refunded.state).toBe('refund');
    expect(refunded.amount).toBe(0.12);
  });
});
