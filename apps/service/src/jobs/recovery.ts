import type { DatabaseSync } from 'node:sqlite';

import { recoverExpiredLeases as recoverExpiredSubmittingLeases } from './repository.ts';

/**
 * Restart reconciliation. Expired `submitting` leases become
 * `submission-unknown` and are never automatically requeued.
 */
export function recoverExpiredLeases(db: DatabaseSync, now: Date): void {
  recoverExpiredSubmittingLeases(db, now);
}
