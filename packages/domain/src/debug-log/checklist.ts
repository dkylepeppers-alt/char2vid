import type {
  ChecklistItem,
  ChecklistItemState,
  ChecklistTransition,
} from './types';

function item(
  id: string,
  label: string,
  complete: boolean,
  skipped = false,
): ChecklistItem {
  let state: ChecklistItemState = 'blocked';
  if (skipped) {
    state = 'skipped';
  } else if (complete) {
    state = 'complete';
  }
  return { id, label, state };
}

export function createGenerateChecklist(input: {
  serviceReady: boolean;
  modelSelected: boolean;
  acceptedTextChars: number;
  blockingIssueCount: number;
}): ChecklistItem[] {
  return [
    item('service-ready', 'Generation service connected', input.serviceReady),
    item('model-selected', 'Catalog model selected', input.modelSelected),
    item(
      'accepted-text',
      'Accepted generate text',
      input.acceptedTextChars > 0,
    ),
    item(
      'references-unblocked',
      'Reference assignment unblocked',
      input.blockingIssueCount === 0,
    ),
  ];
}

export function characterSheetGenerateChecklist(input: {
  serviceReady: boolean;
  modelSelected: boolean;
  selectedReferenceCount: number;
  blockingIssueCount: number;
}): ChecklistItem[] {
  return [
    item('service-ready', 'Generation service connected', input.serviceReady),
    item('model-selected', 'Catalog model selected', input.modelSelected),
    item(
      'identity-reference',
      'Approved identity reference attached',
      input.selectedReferenceCount > 0,
    ),
    item(
      'references-unblocked',
      'Reference assignment unblocked',
      input.blockingIssueCount === 0,
    ),
  ];
}

export function promptModuleChecklist(
  modules: readonly {
    id: string;
    kind: string;
    text: string;
    enabled: boolean;
  }[],
): ChecklistItem[] {
  return modules.map((module) =>
    item(
      `module:${module.id}`,
      `${module.kind} module`,
      module.text.trim().length > 0,
      !module.enabled,
    ),
  );
}

export function compileAcceptChecklist(input: {
  compiledChars: number;
  acceptedChars: number;
  applyProposal: boolean;
}): ChecklistItem[] {
  return [
    item('compiled-proposal', 'Compiled proposal', input.compiledChars > 0),
    item('accepted-prompt', 'Accepted prompt text', input.acceptedChars > 0),
    item(
      'apply-proposal',
      'Use compiled proposal at Generate',
      input.applyProposal,
      !input.applyProposal,
    ),
  ];
}

export function serviceOnboardingChecklist(input: {
  originSet: boolean;
  sessionReady: boolean;
  providerKeyStored: boolean;
}): ChecklistItem[] {
  return [
    item('service-origin', 'Service origin set', input.originSet),
    item('service-session', 'Service session ready', input.sessionReady),
    item(
      'provider-key',
      'Provider key stored on service',
      input.providerKeyStored,
    ),
  ];
}

export function referenceIssueChecklist(
  issues: readonly {
    code: string;
    severity: string;
    message?: string;
  }[],
): ChecklistItem[] {
  const blocking = issues.filter((issue) => issue.severity === 'blocking');
  const items: ChecklistItem[] = [
    item(
      'blocking-references',
      'No blocking reference issues',
      blocking.length === 0,
    ),
  ];
  for (const issue of blocking) {
    items.push(item(`issue:${issue.code}`, issue.code, false));
  }
  return items;
}

function transitionKind(
  previous: ChecklistItemState,
  next: ChecklistItemState,
): ChecklistTransition['kind'] | null {
  if (previous === next) {
    return null;
  }
  if (next === 'complete') {
    return 'complete';
  }
  if (next === 'skipped') {
    return 'skip';
  }
  if (previous === 'blocked' && next !== 'blocked') {
    return 'unblock';
  }
  if (next === 'blocked') {
    return 'block';
  }
  return 'unblock';
}

export function diffChecklist(
  previous: readonly ChecklistItem[],
  next: readonly ChecklistItem[],
): ChecklistTransition[] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const nextById = new Map(next.map((item) => [item.id, item]));
  const transitions: ChecklistTransition[] = [];

  for (const item of next) {
    const prior = previousById.get(item.id);
    const previousState = prior?.state ?? 'blocked';
    if (prior && previousState === item.state) {
      continue;
    }
    const kind = transitionKind(previousState, item.state);
    if (!kind) {
      continue;
    }
    if (!prior && item.state === 'blocked') {
      continue;
    }
    transitions.push({
      id: item.id,
      label: item.label,
      previous: previousState,
      next: item.state,
      kind,
    });
  }

  for (const item of previous) {
    if (nextById.has(item.id)) {
      continue;
    }
    if (item.state === 'blocked') {
      transitions.push({
        id: item.id,
        label: item.label,
        previous: 'blocked',
        next: 'complete',
        kind: 'complete',
      });
    } else if (item.state !== 'skipped') {
      transitions.push({
        id: item.id,
        label: item.label,
        previous: item.state,
        next: 'skipped',
        kind: 'skip',
      });
    }
  }

  return transitions;
}
