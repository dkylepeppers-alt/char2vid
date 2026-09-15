export async function validateNanoGptKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const response = await fetchImpl('https://nano-gpt.com/api/check-balance', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: 'provider_key_rejected' };
  }
  if (!response.ok) {
    return { ok: false, reason: 'provider_key_validation_failed' };
  }
  return { ok: true };
}
