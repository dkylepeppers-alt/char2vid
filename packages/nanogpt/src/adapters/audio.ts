import { getRouteContract, routeUrl } from '../contracts/route-contract';

export function serializeSpeechBody(
  modelId: string,
  prompt: string,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set(getRouteContract('audio.speech').allowedFields);
  const body: Record<string, unknown> = {
    model: modelId,
    input: prompt,
  };
  for (const [key, value] of Object.entries(parameters)) {
    if (
      key === 'model' ||
      key === 'input' ||
      key === 'stream' ||
      !allowed.has(key)
    ) {
      continue;
    }
    body[key] = value;
  }
  return body;
}

export function serializeSpeechRequest(
  modelId: string,
  prompt: string,
  parameters: Record<string, unknown>,
): { url: string; method: 'POST'; body: Record<string, unknown> } {
  return {
    url: routeUrl(getRouteContract('audio.speech')),
    method: 'POST',
    body: serializeSpeechBody(modelId, prompt, parameters),
  };
}
