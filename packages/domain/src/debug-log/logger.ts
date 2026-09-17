import { diffChecklist } from './checklist';
import { sanitizeDebugFields } from './sanitize';
import type {
  ChecklistItem,
  DebugLogContext,
  DebugLogEvent,
  DebugLogger,
  DebugLoggerOptions,
  DebugLogLevel,
} from './types';

function mergeContext(
  options: DebugLoggerOptions,
  context?: DebugLogContext,
): DebugLogContext {
  return {
    screen: context?.screen ?? options.screen,
    route: context?.route ?? options.route,
  };
}

export function createDebugLogger(options: DebugLoggerOptions): DebugLogger {
  const write = (
    level: DebugLogLevel,
    event: string,
    fields: Record<string, unknown> = {},
    context?: DebugLogContext,
  ): void => {
    if (!options.isEnabled()) {
      return;
    }
    const merged = mergeContext(options, context);
    const payload: DebugLogEvent = {
      ts: options.now(),
      level,
      event,
      fields: sanitizeDebugFields(fields),
    };
    if (merged.screen) {
      payload.screen = merged.screen;
    }
    if (merged.route) {
      payload.route = merged.route;
    }
    options.sink.write(payload);
  };

  return {
    enabled: () => options.isEnabled(),
    log: write,
    debug: (event, fields, context) => write('debug', event, fields, context),
    info: (event, fields, context) => write('info', event, fields, context),
    warn: (event, fields, context) => write('warn', event, fields, context),
    error: (event, fields, context) => write('error', event, fields, context),
    checklistInit(checklistId, items, context) {
      const completeCount = items.filter(
        (item) => item.state === 'complete',
      ).length;
      const blockedCount = items.filter(
        (item) => item.state === 'blocked',
      ).length;
      const skippedCount = items.filter(
        (item) => item.state === 'skipped',
      ).length;
      write(
        'info',
        'checklist.init',
        {
          checklistId,
          itemCount: items.length,
          completeCount,
          blockedCount,
          skippedCount,
          items: items.map((item) => ({
            id: item.id,
            label: item.label,
            state: item.state,
          })),
        },
        context,
      );
    },
    checklistDiff(checklistId, previous, next, context) {
      const transitions = diffChecklist(previous, next);
      if (transitions.length === 0) {
        return;
      }
      for (const transition of transitions) {
        write(
          'info',
          'checklist.item',
          {
            checklistId,
            itemId: transition.id,
            label: transition.label,
            previous: transition.previous,
            next: transition.next,
            kind: transition.kind,
          },
          context,
        );
      }
      write(
        'info',
        'checklist.render',
        {
          checklistId,
          itemCount: next.length,
          completeCount: next.filter((item) => item.state === 'complete')
            .length,
          blockedCount: next.filter((item) => item.state === 'blocked').length,
          skippedCount: next.filter((item) => item.state === 'skipped').length,
          changeCount: transitions.length,
        },
        context,
      );
    },
  };
}

export function checklistSnapshot(
  items: readonly ChecklistItem[],
): ChecklistItem[] {
  return items.map((item) => ({ ...item }));
}
