import type { ReferenceBinding } from '@char2vid/domain';

export function omitReferenceBinding(
  bindings: readonly ReferenceBinding[],
  identity: Pick<ReferenceBinding, 'assetRevisionId' | 'ordinal'> &
    Partial<Pick<ReferenceBinding, 'characterRevisionId'>>,
): ReferenceBinding[] {
  return bindings.filter(
    (item) =>
      item.ordinal !== identity.ordinal ||
      item.assetRevisionId !== identity.assetRevisionId ||
      item.characterRevisionId !== identity.characterRevisionId,
  );
}

export function nextReferenceOrdinal(
  bindings: readonly ReferenceBinding[],
): number {
  if (bindings.length === 0) {
    return 0;
  }
  return Math.max(...bindings.map((item) => item.ordinal)) + 1;
}
