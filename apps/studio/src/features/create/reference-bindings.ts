import type { ReferenceBinding } from '@char2vid/domain';

export function omitReferenceBinding(
  bindings: readonly ReferenceBinding[],
  assetRevisionId: string,
): ReferenceBinding[] {
  return bindings.filter((item) => item.assetRevisionId !== assetRevisionId);
}

export function nextReferenceOrdinal(
  bindings: readonly ReferenceBinding[],
): number {
  if (bindings.length === 0) {
    return 0;
  }
  return Math.max(...bindings.map((item) => item.ordinal)) + 1;
}
