export function visualViewportBottomInset(
  layoutHeight: number,
  visual: { height: number; offsetTop: number } | null | undefined,
): number {
  if (visual == null) return 0;
  return Math.max(0, layoutHeight - visual.height - visual.offsetTop);
}

export function subscribeVisualViewportInset(
  root: HTMLElement,
  view: Window,
  onInset?: (inset: number) => void,
): () => void {
  const sync = () => {
    const inset = visualViewportBottomInset(
      view.innerHeight,
      view.visualViewport,
    );
    root.style.setProperty('--keyboard-inset', `${inset}px`);
    onInset?.(inset);
  };
  sync();
  const viewport = view.visualViewport;
  viewport?.addEventListener('resize', sync);
  viewport?.addEventListener('scroll', sync);
  view.addEventListener('resize', sync);
  return () => {
    viewport?.removeEventListener('resize', sync);
    viewport?.removeEventListener('scroll', sync);
    view.removeEventListener('resize', sync);
  };
}
