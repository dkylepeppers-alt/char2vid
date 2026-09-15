export function isAllowedStudioOrigin(
  origin: string,
  publicOrigin: string,
): boolean {
  if (origin === publicOrigin) {
    return true;
  }
  if (
    origin === 'https://localhost' ||
    origin === 'http://localhost' ||
    origin === 'capacitor://localhost'
  ) {
    return true;
  }
  try {
    const parsed = new URL(origin);
    const loopback =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    return (
      loopback && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    );
  } catch {
    return false;
  }
}
