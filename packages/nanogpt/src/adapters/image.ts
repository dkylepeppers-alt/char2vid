import { getRouteContract, routeUrl } from '../contracts/route-contract';

const IMAGE_ALLOWED = new Set(
  getRouteContract('image.normalized.generate').allowedFields,
);

export interface SerializeImageBodyInput {
  modelId: string;
  prompt: string;
  urls: string[];
  parameters: Record<string, unknown>;
}

export function serializeImageBody(
  input: SerializeImageBodyInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.modelId,
    prompt: input.prompt,
  };
  for (const [key, value] of Object.entries(input.parameters)) {
    if (
      key === 'model' ||
      key === 'prompt' ||
      key === 'input_references' ||
      key === 'imageDataUrl' ||
      key === 'imageDataUrls' ||
      key === 'image_url' ||
      key === 'images' ||
      key === 'stream'
    ) {
      continue;
    }
    if (!IMAGE_ALLOWED.has(key) || value === undefined) {
      continue;
    }
    body[key] = value;
  }
  if (input.urls.length > 0) {
    body.input_references = input.urls.map((url) => ({
      type: 'image_url',
      image_url: { url },
    }));
  }
  return body;
}

export function serializeImageRequest(
  modelId: string,
  prompt: string,
  urls: string[],
  parameters: Record<string, unknown>,
): { url: string; method: 'POST'; body: Record<string, unknown> } {
  const contract = getRouteContract('image.normalized.generate');
  return {
    url: routeUrl(contract),
    method: 'POST',
    body: serializeImageBody({ modelId, prompt, urls, parameters }),
  };
}
