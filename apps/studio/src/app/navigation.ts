export const destinations = [
  'library',
  'characters',
  'create',
  'projects',
] as const;

export type Destination = (typeof destinations)[number];
export type Sheet = 'jobs' | 'settings';
export type BackAction = 'close-sheet' | 'navigate-back' | 'exit-app';

export function isDestination(value: string): value is Destination {
  return destinations.some((destination) => destination === value);
}

export function resolveBack(
  sheet: Sheet | null,
  canGoBack: boolean,
): BackAction {
  if (sheet !== null) {
    return 'close-sheet';
  }

  return canGoBack ? 'navigate-back' : 'exit-app';
}

export function resolveInitialPath(
  pathname: string,
  saved: string | null,
): string {
  if (pathname !== '/') {
    return destinationFromPath(pathname) === undefined ? '/library' : pathname;
  }

  return saved !== null && isDestination(saved) ? `/${saved}` : '/library';
}

export function destinationFromPath(pathname: string): Destination | undefined {
  const segment = pathname.replace(/^\//, '').split('/')[0] ?? '';
  return isDestination(segment) ? segment : undefined;
}
