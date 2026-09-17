const SECRET_KEY =
  /api[-_]?key|token|password|secret|cookie|authorization|keystore|bearer|signed.?url|setupToken|deviceToken/i;

const PROMPT_KEY = /^(prompt|acceptedText|proposalText)$/i;

const SIGNED_QUERY =
  /(?:[?&](?:X-Amz-[^=]+|signature|token|key|expires)=[^&\s]*)/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stripSignedQuery(value: string): string {
  if (!/^https?:\/\//i.test(value)) {
    return value.replace(SIGNED_QUERY, '');
  }
  try {
    const url = new URL(value);
    const drop = [...url.searchParams.keys()].filter((key) =>
      /^(x-amz-|signature|token|key|expires)/i.test(key),
    );
    if (drop.length === 0 && url.search.length === 0) {
      return value;
    }
    for (const key of drop) {
      url.searchParams.delete(key);
    }
    url.hash = '';
    const stripped = url.toString();
    return stripped.endsWith('?') ? stripped.slice(0, -1) : stripped;
  } catch {
    const cut = value.split('?')[0] ?? value;
    return cut;
  }
}

function redactString(key: string, value: string): unknown {
  if (PROMPT_KEY.test(key)) {
    return { redacted: true, chars: value.length };
  }
  if (SECRET_KEY.test(key)) {
    return { redacted: true };
  }
  if (
    /^(https?:\/\/|data:)/i.test(value) ||
    /[?&](X-Amz-|signature=)/i.test(value)
  ) {
    return stripSignedQuery(value);
  }
  return value;
}

function sanitizeUnknown(key: string, value: unknown): unknown {
  if (PROMPT_KEY.test(key)) {
    return typeof value === 'string'
      ? { redacted: true, chars: value.length }
      : { redacted: true };
  }
  if (SECRET_KEY.test(key)) {
    return { redacted: true };
  }
  if (typeof value === 'string') {
    return redactString(key, value);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeUnknown(String(index), item));
  }
  if (isRecord(value)) {
    return sanitizeDebugFields(value);
  }
  return value;
}

export function sanitizeDebugFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    next[key] = sanitizeUnknown(key, value);
  }
  return next;
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(SIGNED_QUERY, '')
    .replace(/[?&]$/, '');
}
