import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import type { ChecklistItem, DebugLogger } from '@char2vid/domain/debug-log';
import { sanitizeErrorMessage } from '@char2vid/domain/debug-log';

import { createStudioDebugLog, type StudioDebugLog } from './debug-log';
import { resolvePlatform } from './platform';

let session: StudioDebugLog | undefined;

export function getStudioDebugSession(): StudioDebugLog {
  if (!session) {
    session = createStudioDebugLog({
      storage: window.localStorage,
      env: {
        dev: import.meta.env.DEV,
        native: resolvePlatform() === 'android',
      },
    });
  }
  return session;
}

export function studioDebugLog(): DebugLogger {
  return getStudioDebugSession().logger;
}

export function studioRouteContext(pathname: string): {
  screen: string;
  route: string;
} {
  const segment = pathname.replace(/^\//, '').split('/')[0] || 'library';
  return { screen: segment, route: pathname || `/${segment}` };
}

export function logStudioError(
  event: string,
  error: unknown,
  fields: Record<string, unknown> = {},
  context?: { screen?: string; route?: string },
): void {
  const message =
    error instanceof Error
      ? sanitizeErrorMessage(error.message)
      : 'unknown_error';
  studioDebugLog().error(
    event,
    {
      ...fields,
      message,
    },
    context,
  );
}

export function useChecklistLog(
  checklistId: string,
  items: readonly ChecklistItem[],
  screen: string,
): void {
  const location = useLocation();
  const previous = useRef<ChecklistItem[] | null>(null);
  const route = location.pathname;

  useEffect(() => {
    const logger = studioDebugLog();
    const context = { screen, route };
    if (previous.current === null) {
      logger.checklistInit(checklistId, items, context);
    } else {
      logger.checklistDiff(checklistId, previous.current, items, context);
    }
    previous.current = items.map((item) => ({ ...item }));
  }, [checklistId, items, route, screen]);
}
