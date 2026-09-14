export function modalFocusTarget<T>(
  elements: readonly T[],
  activeElement: T | null,
  shiftKey: boolean,
): T | null {
  const first = elements[0];
  const last = elements.at(-1);
  if (first === undefined || last === undefined) return null;
  if (!elements.includes(activeElement as T)) return first;
  if (shiftKey && activeElement === first) return last;
  if (!shiftKey && activeElement === last) return first;
  return null;
}
