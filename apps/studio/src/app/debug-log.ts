import {
  createDebugLogger,
  sanitizeDebugFields,
  type DebugLogEvent,
  type DebugLogger,
  type DebugLogSink,
} from '@char2vid/domain/debug-log';

export const DEBUG_LOG_STORAGE_KEY = 'char2vid.debug-logs';

export function isStudioDebugLogEnabled(
  storage: Pick<Storage, 'getItem'>,
  env: { dev: boolean; native: boolean },
): boolean {
  const flag = storage.getItem(DEBUG_LOG_STORAGE_KEY);
  if (flag === '0') {
    return false;
  }
  if (flag === '1') {
    return true;
  }
  return env.dev || env.native;
}

export function createMemoryLogRing(limit = 80): DebugLogSink & {
  snapshot(): DebugLogEvent[];
} {
  const events: DebugLogEvent[] = [];
  return {
    write(event) {
      events.push(event);
      if (events.length > limit) {
        events.shift();
      }
    },
    snapshot() {
      return events.map((event) => ({
        ...event,
        fields: { ...event.fields },
      }));
    },
  };
}

export function formatStudioDebugLine(event: DebugLogEvent): string {
  const fields = sanitizeDebugFields(event.fields);
  const where = [event.screen, event.route].filter(Boolean).join(' ');
  return `${event.ts} ${event.level} ${event.event}${where ? ` ${where}` : ''} ${JSON.stringify(fields)}`;
}

export function createConsoleDebugSink(
  consoleLike: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> = console,
): DebugLogSink {
  return {
    write(event) {
      const line = `[char2vid] ${formatStudioDebugLine(event)}`;
      if (event.level === 'error') {
        consoleLike.error(line);
        return;
      }
      if (event.level === 'warn') {
        consoleLike.warn(line);
        return;
      }
      if (event.level === 'debug') {
        consoleLike.debug(line);
        return;
      }
      consoleLike.info(line);
    },
  };
}

export function createFanoutSink(sinks: readonly DebugLogSink[]): DebugLogSink {
  return {
    write(event) {
      for (const sink of sinks) {
        sink.write(event);
      }
    },
  };
}

export interface StudioDebugLog {
  logger: DebugLogger;
  ring: ReturnType<typeof createMemoryLogRing>;
  enabled(): boolean;
  setEnabled(on: boolean): void;
}

export function createStudioDebugLog(options: {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  env: { dev: boolean; native: boolean };
  now?: () => string;
  consoleLike?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  ringLimit?: number;
}): StudioDebugLog {
  const ring = createMemoryLogRing(options.ringLimit ?? 80);
  const logger = createDebugLogger({
    now: options.now ?? (() => new Date().toISOString()),
    isEnabled: () => isStudioDebugLogEnabled(options.storage, options.env),
    sink: createFanoutSink([ring, createConsoleDebugSink(options.consoleLike)]),
  });
  return {
    logger,
    ring,
    enabled: () => isStudioDebugLogEnabled(options.storage, options.env),
    setEnabled(on) {
      options.storage.setItem(DEBUG_LOG_STORAGE_KEY, on ? '1' : '0');
    },
  };
}
