export const IMAGE_OUTPUT_ADAPTER_VERSION = 'image-output.v1';

export interface NormalizedImageItem {
  ordinal: number;
  url?: string;
  base64?: string;
}

export interface NormalizedImageOutput {
  items: NormalizedImageItem[];
  cost?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function itemFromUnknown(
  value: unknown,
  ordinal: number,
): NormalizedImageItem | undefined {
  if (typeof value === 'string' && value.length > 0) {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return { ordinal, url: value };
    }
    return { ordinal, base64: value };
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const url =
    readString(record.url) ??
    readString(asRecord(record.image)?.url) ??
    readString(record.imageUrl);
  const base64 =
    readString(record.b64_json) ??
    readString(record.b64Json) ??
    readString(record.base64);
  if (url) {
    return { ordinal, url };
  }
  if (base64) {
    return { ordinal, base64 };
  }
  return undefined;
}

function unknownArray(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items: unknown[] = [];
  for (const item of value) {
    items.push(item);
  }
  return items;
}

function itemsFromBody(body: Record<string, unknown>): unknown[] | undefined {
  const data = unknownArray(body.data);
  if (data) {
    return data;
  }
  const output = asRecord(body.output);
  const nested = unknownArray(output?.images);
  if (nested) {
    return nested;
  }
  return unknownArray(body.images);
}

/**
 * Normalize documented url / b64_json image envelopes. Empty successful
 * payloads throw rather than collapsing to a fake first item.
 */
export function normalizeImageOutput(body: unknown): NormalizedImageOutput {
  const root = asRecord(body);
  if (!root) {
    throw new Error('missing_image_output');
  }
  const rawItems = itemsFromBody(root);
  if (!rawItems) {
    const single = itemFromUnknown(root, 0);
    if (!single) {
      throw new Error('missing_image_output');
    }
    return {
      items: [single],
      ...(root.cost !== undefined ? { cost: root.cost } : {}),
    };
  }
  const items: NormalizedImageItem[] = [];
  for (const [index, value] of rawItems.entries()) {
    const item = itemFromUnknown(value, index);
    if (!item) {
      throw new Error('missing_image_output');
    }
    items.push(item);
  }
  if (items.length === 0) {
    throw new Error('missing_image_output');
  }
  return {
    items,
    ...(root.cost !== undefined ? { cost: root.cost } : {}),
  };
}
