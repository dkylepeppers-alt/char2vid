import { describe, expect, it } from 'vitest';

import {
  characterSheetGenerateChecklist,
  compileAcceptChecklist,
  createDebugLogger,
  createGenerateChecklist,
  diffChecklist,
  promptModuleChecklist,
  referenceIssueChecklist,
  sanitizeDebugFields,
  sanitizeErrorMessage,
  serviceOnboardingChecklist,
  type ChecklistItem,
  type DebugLogEvent,
} from '../../packages/domain/src/debug-log/index';

function captureLogger(enabled = true) {
  const events: DebugLogEvent[] = [];
  const logger = createDebugLogger({
    now: () => '2026-09-17T10:00:00.000Z',
    isEnabled: () => enabled,
    sink: { write: (event) => events.push(event) },
    screen: 'create',
    route: '/create',
  });
  return { events, logger };
}

describe('sanitizeDebugFields', () => {
  it('redacts secrets, prompt text, cookies, and signed URLs', () => {
    const sanitized = sanitizeDebugFields({
      modelId: 'vendor/one-ref',
      apiKey: 'sk-live-secret',
      authorization: 'Bearer abc.def',
      password: 'hunter2',
      cookie: 'session=abc',
      setupToken: 'one-time',
      deviceToken: 'keystore-material',
      prompt: 'A quiet portrait with the family key',
      acceptedText: 'wave from the doorway',
      outputUrl:
        'https://cdn.example/out.png?X-Amz-Signature=deadbeef&token=abc',
      nested: {
        bearer: 'xyz',
        referenceCount: 2,
      },
    });

    expect(sanitized.modelId).toBe('vendor/one-ref');
    expect(sanitized.apiKey).toEqual({ redacted: true });
    expect(sanitized.authorization).toEqual({ redacted: true });
    expect(sanitized.password).toEqual({ redacted: true });
    expect(sanitized.cookie).toEqual({ redacted: true });
    expect(sanitized.setupToken).toEqual({ redacted: true });
    expect(sanitized.deviceToken).toEqual({ redacted: true });
    expect(sanitized.prompt).toEqual({ redacted: true, chars: 36 });
    expect(sanitized.acceptedText).toEqual({ redacted: true, chars: 21 });
    expect(sanitized.outputUrl).toBe('https://cdn.example/out.png');
    expect(sanitized.nested).toEqual({
      bearer: { redacted: true },
      referenceCount: 2,
    });
  });

  it('keeps operator fields used on a phone', () => {
    const sanitized = sanitizeDebugFields({
      itemId: 'service-ready',
      previous: 'blocked',
      next: 'complete',
      insetPx: 364,
      route: '/create',
      clientRequestId: 'req-1',
      promptChars: 22,
    });
    expect(sanitized).toEqual({
      itemId: 'service-ready',
      previous: 'blocked',
      next: 'complete',
      insetPx: 364,
      route: '/create',
      clientRequestId: 'req-1',
      promptChars: 22,
    });
  });
});

describe('sanitizeErrorMessage', () => {
  it('strips bearer tokens and signed query strings from error text', () => {
    expect(
      sanitizeErrorMessage(
        'POST failed Authorization: Bearer secret.token url=https://x.test/a?X-Amz-Signature=ffff',
      ),
    ).toBe('POST failed Authorization: Bearer [redacted] url=https://x.test/a');
  });
});

describe('diffChecklist', () => {
  const blocked: ChecklistItem = {
    id: 'accepted-text',
    label: 'Accepted generate text',
    state: 'blocked',
  };
  const complete: ChecklistItem = {
    ...blocked,
    state: 'complete',
  };

  it('emits complete when a blocked item becomes complete', () => {
    expect(diffChecklist([blocked], [complete])).toEqual([
      {
        id: 'accepted-text',
        label: 'Accepted generate text',
        previous: 'blocked',
        next: 'complete',
        kind: 'complete',
      },
    ]);
  });

  it('emits skip when an enabled module is turned off', () => {
    expect(
      diffChecklist(
        [{ id: 'module:scene', label: 'scene module', state: 'blocked' }],
        [{ id: 'module:scene', label: 'scene module', state: 'skipped' }],
      ),
    ).toEqual([
      {
        id: 'module:scene',
        label: 'scene module',
        previous: 'blocked',
        next: 'skipped',
        kind: 'skip',
      },
    ]);
  });

  it('emits unblock when a blocking issue disappears', () => {
    expect(
      diffChecklist(
        [
          {
            id: 'issue:max-references',
            label: 'max-references',
            state: 'blocked',
          },
          {
            id: 'blocking-references',
            label: 'No blocking reference issues',
            state: 'blocked',
          },
        ],
        [
          {
            id: 'blocking-references',
            label: 'No blocking reference issues',
            state: 'complete',
          },
        ],
      ),
    ).toEqual([
      {
        id: 'blocking-references',
        label: 'No blocking reference issues',
        previous: 'blocked',
        next: 'complete',
        kind: 'complete',
      },
      {
        id: 'issue:max-references',
        label: 'max-references',
        previous: 'blocked',
        next: 'complete',
        kind: 'complete',
      },
    ]);
  });

  it('emits nothing when the snapshot is unchanged', () => {
    expect(diffChecklist([complete], [complete])).toEqual([]);
  });
});

describe('product checklists', () => {
  it('maps Create generate gates to checklist items', () => {
    expect(
      createGenerateChecklist({
        serviceReady: false,
        modelSelected: true,
        acceptedTextChars: 8,
        blockingIssueCount: 1,
      }).map((item) => [item.id, item.state]),
    ).toEqual([
      ['service-ready', 'blocked'],
      ['model-selected', 'complete'],
      ['accepted-text', 'complete'],
      ['references-unblocked', 'blocked'],
    ]);
  });

  it('maps character-sheet generate prerequisites', () => {
    expect(
      characterSheetGenerateChecklist({
        serviceReady: true,
        modelSelected: false,
        selectedReferenceCount: 0,
        blockingIssueCount: 0,
      }).map((item) => [item.id, item.state]),
    ).toEqual([
      ['service-ready', 'complete'],
      ['model-selected', 'blocked'],
      ['identity-reference', 'blocked'],
      ['references-unblocked', 'complete'],
    ]);
  });

  it('treats filled enabled prompt modules as complete and unchecked as skipped', () => {
    expect(
      promptModuleChecklist([
        { id: 'subject', kind: 'subject', text: '', enabled: true },
        { id: 'change', kind: 'change', text: 'wave', enabled: true },
        { id: 'scene', kind: 'scene', text: 'hallway', enabled: false },
      ]).map((item) => [item.id, item.state]),
    ).toEqual([
      ['module:subject', 'blocked'],
      ['module:change', 'complete'],
      ['module:scene', 'skipped'],
    ]);
  });

  it('tracks compiled proposal acceptance without storing prompt text', () => {
    expect(
      compileAcceptChecklist({
        compiledChars: 4,
        acceptedChars: 0,
        applyProposal: false,
      }).map((item) => [item.id, item.state]),
    ).toEqual([
      ['compiled-proposal', 'complete'],
      ['accepted-prompt', 'blocked'],
      ['apply-proposal', 'skipped'],
    ]);
  });

  it('tracks service onboarding gates', () => {
    expect(
      serviceOnboardingChecklist({
        originSet: true,
        sessionReady: true,
        providerKeyStored: false,
      }).map((item) => [item.id, item.state]),
    ).toEqual([
      ['service-origin', 'complete'],
      ['service-session', 'complete'],
      ['provider-key', 'blocked'],
    ]);
  });

  it('exposes blocking reference codes without issue messages', () => {
    const items = referenceIssueChecklist([
      {
        code: 'max-references',
        severity: 'blocking',
        message: 'at most 1 reference; omit extras',
      },
      { code: 'unknown-limit', severity: 'advisory', message: 'limit unknown' },
    ]);
    expect(items.map((item) => [item.id, item.state, item.label])).toEqual([
      ['blocking-references', 'blocked', 'No blocking reference issues'],
      ['issue:max-references', 'blocked', 'max-references'],
    ]);
  });
});

describe('createDebugLogger', () => {
  it('writes sanitized checklist completion events with clock, screen, and route', () => {
    const { events, logger } = captureLogger();
    logger.checklistDiff(
      'create-generate',
      createGenerateChecklist({
        serviceReady: false,
        modelSelected: true,
        acceptedTextChars: 0,
        blockingIssueCount: 0,
      }),
      createGenerateChecklist({
        serviceReady: true,
        modelSelected: true,
        acceptedTextChars: 12,
        blockingIssueCount: 0,
      }),
    );

    expect(events.map((event) => event.event)).toEqual([
      'checklist.item',
      'checklist.item',
      'checklist.render',
    ]);
    expect(events[0]).toMatchObject({
      ts: '2026-09-17T10:00:00.000Z',
      level: 'info',
      event: 'checklist.item',
      screen: 'create',
      route: '/create',
      fields: {
        checklistId: 'create-generate',
        itemId: 'service-ready',
        label: 'Generation service connected',
        previous: 'blocked',
        next: 'complete',
        kind: 'complete',
      },
    });
    expect(JSON.stringify(events)).not.toMatch(/wave|sk-live|Bearer /);
  });

  it('records init without treating the first snapshot as completions', () => {
    const { events, logger } = captureLogger();
    logger.checklistInit(
      'create-generate',
      createGenerateChecklist({
        serviceReady: true,
        modelSelected: true,
        acceptedTextChars: 3,
        blockingIssueCount: 0,
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('checklist.init');
    expect(events[0]?.fields.completeCount).toBe(4);
  });

  it('does not write when disabled', () => {
    const { events, logger } = captureLogger(false);
    logger.info('create.submit.start', { prompt: 'secret prompt text' });
    logger.checklistInit('create-generate', []);
    expect(events).toEqual([]);
  });
});
