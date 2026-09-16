import { getRouteContract, routeUrl } from '../contracts/route-contract.ts';
import type { PreparedInput } from '@char2vid/domain';

export function serializeVideoBody(
  modelId: string,
  prompt: string,
  parameters: Record<string, unknown>,
  inputs: PreparedInput[],
): Record<string, unknown> {
  const allowed = new Set(getRouteContract('video.generate').allowedFields);
  const body: Record<string, unknown> = {
    model: modelId,
    prompt,
  };
  for (const [key, value] of Object.entries(parameters)) {
    if (
      key === 'model' ||
      key === 'prompt' ||
      key === 'imageUrl' ||
      key === 'imageDataUrl' ||
      !allowed.has(key)
    ) {
      continue;
    }
    body[key] = value;
  }
  const start = inputs.find((input) => input.binding.role === 'start-frame');
  if (start?.source.type === 'https') {
    body.imageUrl = start.source.url;
  } else if (start?.source.type === 'data') {
    body.imageDataUrl = start.source.dataUrl;
  }
  return body;
}

export function serializeVideoRequest(
  modelId: string,
  prompt: string,
  parameters: Record<string, unknown>,
  inputs: PreparedInput[],
): { url: string; method: 'POST'; body: Record<string, unknown> } {
  return {
    url: routeUrl(getRouteContract('video.generate')),
    method: 'POST',
    body: serializeVideoBody(modelId, prompt, parameters, inputs),
  };
}
