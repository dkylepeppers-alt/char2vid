export type DebugLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ChecklistItemState = 'blocked' | 'ready' | 'complete' | 'skipped';

export type ChecklistTransitionKind = 'complete' | 'skip' | 'unblock' | 'block';

export interface ChecklistItem {
  id: string;
  label: string;
  state: ChecklistItemState;
}

export interface ChecklistTransition {
  id: string;
  label: string;
  previous: ChecklistItemState;
  next: ChecklistItemState;
  kind: ChecklistTransitionKind;
}

export interface DebugLogEvent {
  ts: string;
  level: DebugLogLevel;
  event: string;
  screen?: string;
  route?: string;
  fields: Record<string, unknown>;
}

export interface DebugLogSink {
  write(event: DebugLogEvent): void;
}

export interface DebugLogContext {
  screen?: string;
  route?: string;
}

export interface DebugLoggerOptions {
  now: () => string;
  sink: DebugLogSink;
  isEnabled: () => boolean;
  screen?: string;
  route?: string;
}

export interface DebugLogger {
  enabled(): boolean;
  log(
    level: DebugLogLevel,
    event: string,
    fields?: Record<string, unknown>,
    context?: DebugLogContext,
  ): void;
  debug(
    event: string,
    fields?: Record<string, unknown>,
    context?: DebugLogContext,
  ): void;
  info(
    event: string,
    fields?: Record<string, unknown>,
    context?: DebugLogContext,
  ): void;
  warn(
    event: string,
    fields?: Record<string, unknown>,
    context?: DebugLogContext,
  ): void;
  error(
    event: string,
    fields?: Record<string, unknown>,
    context?: DebugLogContext,
  ): void;
  checklistInit(
    checklistId: string,
    items: readonly ChecklistItem[],
    context?: DebugLogContext,
  ): void;
  checklistDiff(
    checklistId: string,
    previous: readonly ChecklistItem[],
    next: readonly ChecklistItem[],
    context?: DebugLogContext,
  ): void;
}
