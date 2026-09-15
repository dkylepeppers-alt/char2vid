import type { GenerationDraft } from '@char2vid/domain';

export const CLIENT_REQUEST_ID_KEY = 'char2vid.create-client-request-id';
export const CLIENT_REQUEST_FINGERPRINT_KEY =
  'char2vid.create-client-request-fingerprint';

export function draftFingerprint(
  draft: Omit<GenerationDraft, 'clientRequestId'>,
): string {
  return JSON.stringify({
    operation: draft.operation,
    modelId: draft.modelId,
    prompt: draft.prompt,
    references: draft.references,
    parameters: draft.parameters,
    projectId: draft.projectId ?? null,
    shotRevisionId: draft.shotRevisionId ?? null,
  });
}

export function resolveDraftClientRequestId(options: {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  fingerprint: string;
  mint: () => string;
}): string {
  const storedId = options.storage.getItem(CLIENT_REQUEST_ID_KEY);
  const storedFingerprint = options.storage.getItem(
    CLIENT_REQUEST_FINGERPRINT_KEY,
  );
  if (storedId && storedFingerprint === options.fingerprint) {
    return storedId;
  }
  const id = options.mint();
  options.storage.setItem(CLIENT_REQUEST_ID_KEY, id);
  options.storage.setItem(CLIENT_REQUEST_FINGERPRINT_KEY, options.fingerprint);
  return id;
}

export function clearDraftClientRequestId(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): void {
  storage.removeItem(CLIENT_REQUEST_ID_KEY);
  storage.removeItem(CLIENT_REQUEST_FINGERPRINT_KEY);
}

export function createSubmitGate(): {
  tryEnter: () => boolean;
  leave: () => void;
} {
  let inFlight = false;
  return {
    tryEnter() {
      if (inFlight) {
        return false;
      }
      inFlight = true;
      return true;
    },
    leave() {
      inFlight = false;
    },
  };
}
