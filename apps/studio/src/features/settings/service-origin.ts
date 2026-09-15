export const SERVICE_ORIGIN_KEY = 'char2vid.service-origin';

export class ServiceOriginError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ServiceOriginError';
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export function normalizeServiceOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/$/, '');
  if (!trimmed) {
    throw new ServiceOriginError('service_origin_required');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ServiceOriginError('invalid_service_origin');
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol === 'https:') {
    return `${parsed.protocol}//${parsed.host}`;
  }
  if (parsed.protocol === 'http:' && LOOPBACK.has(host)) {
    return `${parsed.protocol}//${parsed.host}`;
  }
  throw new ServiceOriginError('insecure_service_origin');
}

export function nativeTokenForOrigin(
  token: string | undefined,
  tokenOrigin: string | undefined,
  origin: string,
): string | undefined {
  if (!token || !tokenOrigin) {
    return undefined;
  }
  try {
    return tokenOrigin === normalizeServiceOrigin(origin) ? token : undefined;
  } catch {
    return undefined;
  }
}

export function serviceOriginMessage(error: unknown, fallback: string): string {
  if (error instanceof ServiceOriginError) {
    if (error.code === 'insecure_service_origin') {
      return 'Service origin must be HTTPS (loopback HTTP is allowed for local development).';
    }
    return 'Enter a valid service origin.';
  }
  return error instanceof Error ? error.message : fallback;
}
