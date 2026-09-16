import { describe, expect, it } from 'vitest';

import type { NanoGptModelDescriptor } from '../../packages/nanogpt/src/catalog/catalog-schema';
import { serializeImageBody } from '../../packages/nanogpt/src/adapters/image';
import {
  buildRequest,
  getCompatibleModels,
} from '../../packages/nanogpt/src/validation';
import type {
  GenerationDraft,
  Operation,
} from '../../packages/domain/src/contracts';

const FETCHED_AT = '2026-09-15T00:00:00Z';

function imageModel(
  id: string,
  extras: Partial<NanoGptModelDescriptor> = {},
): NanoGptModelDescriptor {
  return {
    id,
    catalog: 'image',
    fetchedAt: FETCHED_AT,
    raw: { id },
    operations: ['image-generate'],
    verification: 'metadata',
    displayName: id,
    capabilities: { image_generation: true },
    controls: [],
    limits: { raw: {} },
    issues: [],
    ...extras,
  };
}

function draft(overrides: Partial<GenerationDraft> = {}): GenerationDraft {
  return {
    clientRequestId: 'req-1',
    operation: 'image-generate',
    modelId: 'fixture/image',
    prompt: 'Change the lighting.',
    references: [],
    parameters: { n: 1 },
    ...overrides,
  };
}

describe('serializeImageBody (P3)', () => {
  it('uses one normalized image input family', () => {
    const body = serializeImageBody({
      modelId: 'fixture/image',
      prompt: 'Change the lighting.',
      urls: ['https://studio.example/input/1'],
      parameters: { n: 1 },
    });
    expect(body).toEqual({
      model: 'fixture/image',
      prompt: 'Change the lighting.',
      n: 1,
      input_references: [
        {
          type: 'image_url',
          image_url: { url: 'https://studio.example/input/1' },
        },
      ],
    });
    expect(body).not.toHaveProperty('imageDataUrls');
  });

  it('does not let parameters overwrite model, prompt, or inputs', () => {
    const body = serializeImageBody({
      modelId: 'fixture/image',
      prompt: 'Keep this prompt.',
      urls: ['https://studio.example/input/1'],
      parameters: {
        model: 'attacker/other',
        prompt: 'replaced',
        input_references: [],
        n: 2,
        stream: true,
        imageDataUrls: ['data:image/png;base64,xx'],
      },
    });
    expect(body.model).toBe('fixture/image');
    expect(body.prompt).toBe('Keep this prompt.');
    expect(body.n).toBe(2);
    expect(body).not.toHaveProperty('stream');
    expect(body).not.toHaveProperty('imageDataUrls');
    expect(body.input_references).toEqual([
      {
        type: 'image_url',
        image_url: { url: 'https://studio.example/input/1' },
      },
    ]);
  });
});

describe('getCompatibleModels (P3)', () => {
  it('keeps a newly observed model without app code changes', () => {
    const fresh = imageModel('vendor/brand-new-2026');
    const rows = getCompatibleModels('image-generate', [], [fresh]);
    expect(rows.map((row) => row.model.id)).toEqual(['vendor/brand-new-2026']);
    expect(rows[0]?.eligible).toBe(true);
  });

  it('never drops a text-only model from an image workflow', () => {
    const textOnly = imageModel('vendor/text-only', {
      catalog: 'text',
      operations: ['text'],
      capabilities: { chat: true },
    });
    const rows = getCompatibleModels('image-generate', [], [textOnly]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eligible).toBe(false);
    expect(rows[0]?.reasons).toContain('incompatible_operation');
  });

  it('reports reference count overflow without deleting the model', () => {
    const limited = imageModel('vendor/one-ref', {
      limits: { maxInputReferences: 1, raw: { max_input_images: 1 } },
    });
    const rows = getCompatibleModels(
      'image-generate',
      [
        {
          assetRevisionId: 'a',
          role: 'identity',
          ordinal: 0,
        },
        {
          assetRevisionId: 'b',
          role: 'style',
          ordinal: 1,
        },
      ],
      [limited],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eligible).toBe(false);
    expect(rows[0]?.reasons).toContain('reference_count_exceeded');
  });
});

describe('buildRequest (P3)', () => {
  it('returns no request when a blocking issue exists', () => {
    const model = imageModel('fixture/image', {
      limits: { inputMaxBytes: { route: 4 }, raw: {} },
    });
    const result = buildRequest(draft(), model, [
      {
        binding: { assetRevisionId: 'a', role: 'identity', ordinal: 0 },
        sha256: 'ab'.repeat(32),
        mime: 'image/png',
        bytes: 16,
        source: { type: 'https', url: 'https://studio.example/input/1' },
      },
    ]);
    expect(result.request).toBeUndefined();
    expect(result.issues.some((issue) => issue.severity === 'blocking')).toBe(
      true,
    );
  });

  it('rejects string-valued video durations instead of coercing them', () => {
    const video = imageModel('fixture/video', {
      catalog: 'video',
      operations: ['video-generate'],
      capabilities: { video_generation: true },
    });
    const result = buildRequest(
      draft({
        operation: 'video-generate',
        modelId: 'fixture/video',
        parameters: { duration: '5' },
      }),
      video,
      [],
    );
    expect(result.request).toBeUndefined();
    expect(result.issues.map((issue) => issue.code)).toContain(
      'string_duration',
    );
  });

  it('rejects contradictory audio stream flags', () => {
    const audio = imageModel('fixture/speech', {
      catalog: 'audio',
      operations: ['speech'],
      capabilities: { tts: true },
    });
    const result = buildRequest(
      draft({
        operation: 'speech',
        modelId: 'fixture/speech',
        parameters: { stream: true, voice: 'alloy' },
      }),
      audio,
      [],
    );
    expect(result.request).toBeUndefined();
    expect(result.issues.map((issue) => issue.code)).toContain(
      'unsupported_stream',
    );
  });

  it('serializes a valid image request onto the normalized route', () => {
    const model = imageModel('fixture/image');
    const result = buildRequest(draft(), model, [
      {
        binding: { assetRevisionId: 'a', role: 'identity', ordinal: 0 },
        sha256: 'ab'.repeat(32),
        mime: 'image/png',
        bytes: 4,
        source: { type: 'https', url: 'https://studio.example/input/1' },
      },
    ]);
    expect(
      result.issues.filter((issue) => issue.severity === 'blocking'),
    ).toEqual([]);
    expect(result.request).toEqual({
      url: 'https://nano-gpt.com/api/v1/images',
      method: 'POST',
      body: {
        model: 'fixture/image',
        prompt: 'Change the lighting.',
        n: 1,
        input_references: [
          {
            type: 'image_url',
            image_url: { url: 'https://studio.example/input/1' },
          },
        ],
      },
    });
  });

  it('serializes on-device data URLs into the same image input family', () => {
    const model = imageModel('fixture/image');
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const result = buildRequest(draft(), model, [
      {
        binding: { assetRevisionId: 'a', role: 'identity', ordinal: 0 },
        sha256: 'ab'.repeat(32),
        mime: 'image/png',
        bytes: 4,
        source: { type: 'data', dataUrl },
      },
    ]);
    expect(
      result.issues.filter((issue) => issue.severity === 'blocking'),
    ).toEqual([]);
    expect(result.request?.body).toMatchObject({
      input_references: [{ type: 'image_url', image_url: { url: dataUrl } }],
    });
  });

  it('rejects endpoint metadata URLs that are not on nano-gpt.com', () => {
    const model = imageModel('fixture/image', {
      endpointsPath: 'https://evil.example/api/v1/images/models/x/endpoints',
    });
    const result = buildRequest(draft(), model, []);
    expect(result.request).toBeUndefined();
    expect(result.issues.map((issue) => issue.code)).toContain(
      'endpoint_origin_rejected',
    );
  });

  it('blocks text serialization instead of inventing chat fields', () => {
    const text = imageModel('fixture/text', {
      catalog: 'text',
      operations: ['text'],
      capabilities: { chat: true },
    });
    const result = buildRequest(
      draft({
        operation: 'text',
        modelId: 'fixture/text',
        parameters: {},
      }),
      text,
      [],
    );
    expect(result.request).toBeUndefined();
    expect(result.issues.map((issue) => issue.code)).toContain(
      'unresolved_text_contract',
    );
  });
});

describe('video and audio transports (P3)', () => {
  it('submits video as a ticket route without appending /v1', () => {
    const video = imageModel('fixture/video', {
      catalog: 'video',
      operations: ['video-generate'],
      capabilities: { video_generation: true },
    });
    const result = buildRequest(
      draft({
        operation: 'video-generate' satisfies Operation,
        modelId: 'fixture/video',
        parameters: { duration: 5 },
      }),
      video,
      [
        {
          binding: {
            assetRevisionId: 'frame',
            role: 'start-frame',
            ordinal: 0,
          },
          sha256: 'cd'.repeat(32),
          mime: 'image/png',
          bytes: 8,
          source: { type: 'https', url: 'https://studio.example/start.png' },
        },
      ],
    );
    expect(result.request?.url).toBe('https://nano-gpt.com/api/generate-video');
    expect(result.request?.body).toMatchObject({
      model: 'fixture/video',
      prompt: 'Change the lighting.',
      duration: 5,
      imageUrl: 'https://studio.example/start.png',
    });
    expect(String(result.request?.url)).not.toContain('/v1/generate-video');
  });

  it('serializes speech without a stream flag', () => {
    const audio = imageModel('fixture/speech', {
      catalog: 'audio',
      operations: ['speech'],
      capabilities: { tts: true },
    });
    const result = buildRequest(
      draft({
        operation: 'speech',
        modelId: 'fixture/speech',
        parameters: { voice: 'alloy' },
      }),
      audio,
      [],
    );
    expect(result.request?.url).toBe(
      'https://nano-gpt.com/api/v1/audio/speech',
    );
    expect(result.request?.body).toEqual({
      model: 'fixture/speech',
      input: 'Change the lighting.',
      voice: 'alloy',
    });
    expect(result.request?.body).not.toHaveProperty('stream');
  });
});
