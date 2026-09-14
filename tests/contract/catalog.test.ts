import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  PUBLIC_CATALOG_URLS,
  type GenerationCatalog,
  type NormalizedCatalog,
} from '../../packages/nanogpt/src/catalog/catalog-schema';
import {
  mergeEndpointMetadata,
  normalizeCatalog,
  normalizeControls,
} from '../../packages/nanogpt/src/catalog/normalize';
import {
  refreshCatalogs,
  type CatalogFetcher,
} from '../../packages/nanogpt/src/catalog/refresh';
import {
  ROUTE_CONTRACTS,
  getRouteContract,
  resolveEndpointMetadataUrl,
  routeUrl,
  validateRouteRegistry,
  type RouteContract,
} from '../../packages/nanogpt/src/contracts/route-contract';

interface Fixture {
  label: 'authored' | 'sanitized-observed';
  source: string;
  observedDateUtc: string;
  body: unknown;
}

const fixtureFile = JSON.parse(
  readFileSync(
    new URL('../fixtures/nanogpt/catalogs.json', import.meta.url),
    'utf8',
  ),
) as { fixtures: Record<string, Fixture> };

function fixture(name: string): Fixture {
  const found = fixtureFile.fixtures[name];
  if (!found) {
    throw new Error(`missing fixture ${name}`);
  }
  return found;
}

const FETCHED_AT = '2026-09-13T00:00:00Z';

describe('normalizeCatalog (P1)', () => {
  it('keeps distinct IDs sharing a display name', () => {
    const raw = {
      data: [
        {
          id: 'vendor/example',
          name: 'Example',
          capabilities: { image_generation: true },
        },
        {
          id: 'vendor/example/edit',
          name: 'Example',
          capabilities: { image_to_image: true },
        },
      ],
    };
    const result = normalizeCatalog('image', raw, '2026-09-13T00:00:00Z');
    expect(result.models.map((m) => m.id)).toEqual([
      'vendor/example',
      'vendor/example/edit',
    ]);
    expect(result.models.map((m) => m.displayName)).toEqual([
      'Example',
      'Example',
    ]);
  });

  it('surfaces a never-seen model with unknown capabilities without app changes', () => {
    const record = {
      id: 'newvendor/never-seen',
      name: 'Never Seen',
      capabilities: { holographic_generation: true },
      supported_parameters: {
        hologram_depth: { type: 'depth_slider', min: 0, max: 9 },
      },
      brand_new_field: { nested: true },
    };
    const result = normalizeCatalog('image', { data: [record] }, FETCHED_AT);

    expect(result.models).toHaveLength(1);
    const model = result.models[0]!;
    expect(model.id).toBe('newvendor/never-seen');
    expect(model.catalog).toBe('image');
    expect(model.fetchedAt).toBe(FETCHED_AT);
    expect(model.raw).toEqual(record);
    expect(model.capabilities).toEqual({ holographic_generation: true });
    expect(model.operations).toEqual([]);
    expect(model.verification).toBe('metadata');
    expect(model.controls).toEqual([
      expect.objectContaining({
        key: 'hologram_depth',
        kind: 'unsupported',
        raw: { type: 'depth_slider', min: 0, max: 9 },
      }),
    ]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        modelId: 'newvendor/never-seen',
        code: 'operations_unknown',
        severity: 'advisory',
      }),
    );
  });

  it('accepts flat arrays and id-keyed objects as catalog envelopes', () => {
    const flat = normalizeCatalog(
      'text',
      [{ id: 'a' }, { id: 'b' }],
      FETCHED_AT,
    );
    expect(flat.models.map((m) => m.id)).toEqual(['a', 'b']);

    const keyed = normalizeCatalog(
      'text',
      { count: 2, models: { a: { name: 'A' }, b: { id: 'b', name: 'B' } } },
      FETCHED_AT,
    );
    expect(keyed.models.map((m) => m.id)).toEqual(['a', 'b']);
    expect(keyed.issues).toEqual([]);
  });

  it('does not treat an object-shaped error body as a catalog map', () => {
    const result = normalizeCatalog(
      'video',
      { error: { message: 'down' } },
      FETCHED_AT,
    );
    expect(result.models).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'unrecognized_envelope',
        catalog: 'video',
      }),
    );
    expect(result.models.some((model) => model.id === 'error')).toBe(false);
  });

  it('rejects an error envelope even when the nested error object has a string id', () => {
    const result = normalizeCatalog(
      'image',
      { error: { id: 'req_123', message: 'unavailable' } },
      FETCHED_AT,
    );
    expect(result.models).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'unrecognized_envelope',
        catalog: 'image',
        severity: 'blocking',
      }),
    );
    expect(result.models.some((model) => model.id === 'error')).toBe(false);
    expect(result.models.some((model) => model.id === 'req_123')).toBe(false);
  });

  it('reports a record without an id instead of inventing one', () => {
    const result = normalizeCatalog(
      'audio',
      { data: [{ name: 'nameless' }, { id: 'ok' }] },
      FETCHED_AT,
    );
    expect(result.models.map((m) => m.id)).toEqual(['ok']);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'record_missing_id',
        severity: 'blocking',
        catalog: 'audio',
      }),
    );
  });

  it('keeps both records when one exact id repeats and records the duplicate', () => {
    const result = normalizeCatalog(
      'video',
      {
        data: [
          { id: 'dup', name: 'One' },
          { id: 'dup', name: 'Two' },
        ],
      },
      FETCHED_AT,
    );
    expect(result.models.map((m) => m.displayName)).toEqual(['One', 'Two']);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'duplicate_id', modelId: 'dup' }),
    );
  });

  it('records a meta.count that disagrees with the delivered records', () => {
    const result = normalizeCatalog(
      'image',
      { data: [{ id: 'only' }], meta: { count: 3 } },
      FETCHED_AT,
    );
    expect(result.models).toHaveLength(1);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'count_mismatch', severity: 'advisory' }),
    );
  });

  it('maps capability flags to operations conservatively', () => {
    const image = normalizeCatalog(
      'image',
      fixture('imageMixed').body,
      FETCHED_AT,
    );
    const audio = normalizeCatalog(
      'audio',
      fixture('audioMixed').body,
      FETCHED_AT,
    );
    const video = normalizeCatalog(
      'video',
      fixture('videoNested').body,
      FETCHED_AT,
    );
    const text = normalizeCatalog(
      'text',
      fixture('textMinimal').body,
      FETCHED_AT,
    );
    const ops = (models: { id: string; operations: string[] }[], id: string) =>
      models.find((m) => m.id === id)?.operations;

    expect(ops(image.models, 'birefnet/v2')).toEqual([
      'image-generate',
      'image-edit',
    ]);
    expect(ops(image.models, 'fixture/unknown-control')).toEqual([
      'image-generate',
    ]);
    expect(ops(audio.models, 'elevenlabs/music')).toEqual(['music']);
    expect(ops(audio.models, 'xai-tts')).toEqual(['speech']);
    expect(ops(audio.models, 'Whisper-Large-V3')).toEqual(['transcribe']);
    expect(ops(video.models, 'bytedance/seedance-2.5')).toEqual([
      'video-generate',
      'video-edit',
    ]);
    expect(ops(text.models, 'fixture/text-a')).toEqual(['text']);
  });

  it('normalizes flat array descriptors and nested parameters without coercing wire types', () => {
    const image = normalizeCatalog(
      'image',
      fixture('imageMixed').body,
      FETCHED_AT,
    );
    const seedream = image.models.find(
      (m) => m.id === 'bytedance/seedream-v5.0-pro',
    )!;
    expect(seedream.controls).toContainEqual(
      expect.objectContaining({
        key: 'resolutions',
        kind: 'select',
        options: ['1:1', '16:9', '9:16', '1k', '2k'].map((value) => ({
          value,
        })),
      }),
    );
    // Counts are limits, not controls.
    expect(seedream.controls.map((c) => c.key)).not.toContain('max_images');

    const video = normalizeCatalog(
      'video',
      fixture('videoNested').body,
      FETCHED_AT,
    );
    const seedance = video.models.find(
      (m) => m.id === 'bytedance/seedance-2.5',
    )!;
    const duration = seedance.controls.find((c) => c.key === 'duration')!;
    expect(duration.kind).toBe('select');
    expect(duration.default).toBe('5');
    expect(duration.options?.map((o) => o.value)).toEqual(['4', '5', '30']);
    expect(duration.options?.[0]).toEqual({ value: '4', label: '4 seconds' });
    expect(seedance.controls.find((c) => c.key === 'generate_audio')).toEqual(
      expect.objectContaining({ kind: 'boolean', default: true }),
    );
    expect(seedance.controls.find((c) => c.key === 'mode')).toEqual(
      expect.objectContaining({ kind: 'select', default: 'auto' }),
    );
    expect(seedance.controls.map((c) => c.key)).not.toContain('defaults');
  });

  it('normalizes enum and range descriptors', () => {
    const image = normalizeCatalog(
      'image',
      fixture('imageMixed').body,
      FETCHED_AT,
    );
    const model = image.models.find((m) => m.id === 'fixture/enum-range')!;
    expect(model.controls).toEqual([
      expect.objectContaining({
        key: 'resolution',
        kind: 'select',
        options: [{ value: '1024x1024' }, { value: '1024x768' }],
        default: '1024x1024',
      }),
      expect.objectContaining({
        key: 'n',
        kind: 'number',
        min: 1,
        max: 4,
        default: 1,
      }),
      expect.objectContaining({
        key: 'input_references',
        kind: 'number',
        min: 0,
        max: 4,
      }),
    ]);
  });

  it('normalizes integer/enum, number/min-max, string and boolean descriptors', () => {
    const video = normalizeCatalog(
      'video',
      fixture('videoNested').body,
      FETCHED_AT,
    );
    const zoo = video.models.find((m) => m.id === 'fixture/video-control-zoo')!;
    const byKey = Object.fromEntries(zoo.controls.map((c) => [c.key, c]));

    expect(byKey['duration']).toEqual(
      expect.objectContaining({
        kind: 'number',
        default: 5,
        options: [
          { value: 5, label: '5 seconds' },
          { value: 10, label: '10 seconds' },
        ],
      }),
    );
    expect(byKey['seed']).toEqual(
      expect.objectContaining({
        kind: 'number',
        min: -1,
        max: 2147483647,
        default: -1,
      }),
    );
    expect(byKey['camera_trajectory']).toEqual(
      expect.objectContaining({ kind: 'text', default: '' }),
    );
    expect(byKey['draft']).toEqual(
      expect.objectContaining({ kind: 'boolean', default: false }),
    );
  });

  it('marks an unknown control type unsupported and preserves its raw descriptor', () => {
    const image = normalizeCatalog(
      'image',
      fixture('imageMixed').body,
      FETCHED_AT,
    );
    const model = image.models.find((m) => m.id === 'fixture/unknown-control')!;
    const palette = model.controls.find((c) => c.key === 'palette');
    expect(palette).toEqual({
      key: 'palette',
      kind: 'unsupported',
      raw: {
        type: 'color_picker',
        default: '#ffffff',
        swatches: ['#ffffff', '#000000'],
      },
    });
    expect(image.issues).toContainEqual(
      expect.objectContaining({
        modelId: 'fixture/unknown-control',
        code: 'unsupported_control',
        field: 'palette',
        severity: 'advisory',
      }),
    );
  });

  it('does not treat max_images alone as the input reference limit', () => {
    const image = normalizeCatalog(
      'image',
      fixture('imageMixed').body,
      FETCHED_AT,
    );
    const birefnet = image.models.find((m) => m.id === 'birefnet/v2')!;
    expect(birefnet.limits.maxOutputImages).toBe(1);
    expect(birefnet.limits.maxInputReferences).toBeUndefined();
    expect(birefnet.limits.raw).toEqual({
      max_images: 1,
      max_output_images: 1,
    });
    expect(image.issues).toContainEqual(
      expect.objectContaining({
        modelId: 'birefnet/v2',
        code: 'input_reference_limit_unknown',
        field: 'max_images',
        severity: 'advisory',
      }),
    );
  });

  it('uses max_images as the output count when max_output_images is absent', () => {
    const result = normalizeCatalog(
      'image',
      {
        data: [
          {
            id: 'fixture/max-images-only',
            capabilities: { image_generation: true },
            supported_parameters: { max_images: 3 },
          },
        ],
      },
      FETCHED_AT,
    );
    const model = result.models[0]!;
    expect(model.limits.maxOutputImages).toBe(3);
    expect(model.limits.maxInputReferences).toBeUndefined();
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        modelId: 'fixture/max-images-only',
        code: 'input_reference_limit_unknown',
        field: 'max_images',
        severity: 'advisory',
      }),
    );
  });

  it('records disagreement between max_images and max_output_images instead of choosing', () => {
    const result = normalizeCatalog(
      'image',
      {
        data: [
          {
            id: 'fixture/output-disagree',
            capabilities: { image_generation: true },
            supported_parameters: {
              max_images: 1,
              max_output_images: 4,
            },
          },
        ],
      },
      FETCHED_AT,
    );
    const model = result.models[0]!;
    expect(model.limits.maxOutputImages).toBeUndefined();
    expect(model.verification).toBe('conflict');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        modelId: 'fixture/output-disagree',
        code: 'output_image_limit_conflict',
        field: 'max_images',
        severity: 'blocking',
      }),
    );
  });

  it('derives the input reference limit and byte limits when the sources agree', () => {
    const image = normalizeCatalog(
      'image',
      fixture('imageMixed').body,
      FETCHED_AT,
    );
    const seedream = image.models.find(
      (m) => m.id === 'bytedance/seedream-v5.0-pro',
    )!;
    expect(seedream.limits).toEqual(
      expect.objectContaining({
        maxOutputImages: 4,
        maxInputReferences: 10,
        inputFormats: ['png', 'jpeg', 'webp'],
        inputMaxBytes: { route: 31457280, provider: 10485760 },
        inputPixels: {
          minWidth: 8,
          minHeight: 8,
          maxWidth: 16384,
          maxHeight: 16384,
        },
      }),
    );
    expect(
      image.issues.filter((i) => i.modelId === 'bytedance/seedream-v5.0-pro'),
    ).toEqual([]);
  });

  it('records disagreement between max_input_images and max_items instead of choosing', () => {
    const result = normalizeCatalog(
      'image',
      {
        data: [
          {
            id: 'fixture/disagree',
            capabilities: { image_generation: true, image_to_image: true },
            supported_parameters: {
              max_images: 4,
              max_output_images: 4,
              max_input_images: 4,
              input_image_constraints: { max_items: 10 },
            },
          },
        ],
      },
      FETCHED_AT,
    );
    const model = result.models[0]!;
    expect(model.limits.maxInputReferences).toBeUndefined();
    expect(model.verification).toBe('conflict');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        modelId: 'fixture/disagree',
        code: 'input_reference_limit_conflict',
        severity: 'blocking',
      }),
    );
  });

  it('records disagreement between route formats and supported_formats instead of preferring the route list', () => {
    const result = normalizeCatalog(
      'image',
      {
        data: [
          {
            id: 'fixture/format-disagree',
            capabilities: { image_generation: true },
            supported_parameters: {
              supported_formats: ['png', 'jpeg'],
              input_image_constraints: {
                route: { formats: ['png', 'webp'] },
              },
            },
          },
        ],
      },
      FETCHED_AT,
    );
    const model = result.models[0]!;
    expect(model.limits.inputFormats).toBeUndefined();
    expect(model.verification).toBe('conflict');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        modelId: 'fixture/format-disagree',
        code: 'input_format_conflict',
        severity: 'blocking',
      }),
    );
  });

  it('records a capability flag that contradicts a control default', () => {
    const video = normalizeCatalog(
      'video',
      fixture('videoNested').body,
      FETCHED_AT,
    );
    const seedance = video.models.find(
      (m) => m.id === 'bytedance/seedance-2.5',
    )!;
    expect(seedance.capabilities['audio_generation']).toBe(false);
    expect(
      seedance.controls.find((c) => c.key === 'generate_audio')?.default,
    ).toBe(true);
    expect(seedance.verification).toBe('conflict');
    expect(video.issues).toContainEqual(
      expect.objectContaining({
        modelId: 'bytedance/seedance-2.5',
        code: 'capability_control_conflict',
        field: 'generate_audio',
        severity: 'advisory',
      }),
    );
  });

  it('records a descriptor default that disagrees with the defaults map', () => {
    const video = normalizeCatalog(
      'video',
      fixture('videoNested').body,
      FETCHED_AT,
    );
    const zoo = video.models.find((m) => m.id === 'fixture/video-control-zoo')!;
    const resolution = zoo.controls.find((c) => c.key === 'resolution')!;
    expect(resolution.default).toBeUndefined();
    expect(video.issues).toContainEqual(
      expect.objectContaining({
        modelId: 'fixture/video-control-zoo',
        code: 'default_conflict',
        field: 'resolution',
      }),
    );
    // Agreeing defaults are not conflicts.
    expect(
      video.issues.filter(
        (i) =>
          i.code === 'default_conflict' &&
          i.modelId === 'fixture/video-control-zoo',
      ),
    ).toHaveLength(1);
  });
});

describe('mergeEndpointMetadata (P1)', () => {
  it('merges agreeing endpoint metadata by exact id without conflicts', () => {
    const catalog = normalizeCatalog(
      'image',
      fixture('imageCatalogGptImage2').body,
      FETCHED_AT,
    );
    const model = catalog.models[0]!;
    const merged = mergeEndpointMetadata(
      model,
      fixture('imageEndpointMetadataGptImage2').body,
    );
    expect(merged.issues).toEqual([]);
    expect(merged.model.verification).toBe('metadata');
    expect(merged.model.limits.maxInputReferences).toBe(4);
    expect(merged.model.endpointMetadata).toEqual(
      fixture('imageEndpointMetadataGptImage2').body,
    );
    expect(merged.model.raw).toEqual(model.raw);
  });

  it('records conflicts between catalog and endpoint metadata instead of choosing', () => {
    const catalog = normalizeCatalog(
      'image',
      fixture('imageMixed').body,
      FETCHED_AT,
    );
    const seedream = catalog.models.find(
      (m) => m.id === 'bytedance/seedream-v5.0-pro',
    )!;
    const merged = mergeEndpointMetadata(
      seedream,
      fixture('imageEndpointMetadataConflict').body,
    );

    expect(merged.issues).toContainEqual(
      expect.objectContaining({
        code: 'endpoint_metadata_conflict',
        field: 'supported_parameters.max_input_images',
        severity: 'blocking',
      }),
    );
    expect(merged.issues).toContainEqual(
      expect.objectContaining({
        code: 'endpoint_metadata_conflict',
        field: 'input_reference_constraints.max_items',
        severity: 'blocking',
      }),
    );
    expect(merged.issues).toContainEqual(
      expect.objectContaining({
        code: 'endpoint_metadata_conflict',
        field: 'capabilities.inpainting',
        severity: 'advisory',
      }),
    );
    expect(merged.model.limits.maxInputReferences).toBeUndefined();
    expect(merged.model.verification).toBe('conflict');
    expect(merged.model.raw).toEqual(seedream.raw);
    expect(merged.model.capabilities).toEqual(seedream.capabilities);
    expect(merged.model.endpointMetadata).toEqual(
      fixture('imageEndpointMetadataConflict').body,
    );
  });

  it('refuses endpoint metadata addressed to a different model id', () => {
    const catalog = normalizeCatalog(
      'image',
      fixture('imageMixed').body,
      FETCHED_AT,
    );
    const birefnet = catalog.models.find((m) => m.id === 'birefnet/v2')!;
    const merged = mergeEndpointMetadata(
      birefnet,
      fixture('imageEndpointMetadataGptImage2').body,
    );
    expect(merged.issues).toEqual([
      expect.objectContaining({
        code: 'endpoint_metadata_id_mismatch',
        modelId: 'birefnet/v2',
        severity: 'blocking',
      }),
    ]);
    expect(merged.model.endpointMetadata).toBeUndefined();
    expect(merged.model.limits).toEqual(birefnet.limits);
  });
});

describe('normalizeControls (P1)', () => {
  it('normalizes audio object descriptors that use values/minimum/maximum', () => {
    const audio = normalizeCatalog(
      'audio',
      fixture('audioMixed').body,
      FETCHED_AT,
    );
    const yue = audio.models.find((m) => m.id === 'yue2-3b/text-to-music')!;
    const byKey = Object.fromEntries(yue.controls.map((c) => [c.key, c]));
    expect(byKey['seed']).toEqual(
      expect.objectContaining({
        kind: 'number',
        min: -1,
        max: 2147483647,
        default: -1,
      }),
    );
    expect(byKey['output_format']).toEqual(
      expect.objectContaining({
        kind: 'select',
        options: [{ value: 'mp3' }, { value: 'wav' }, { value: 'flac' }],
        default: 'mp3',
      }),
    );
    expect(byKey['lyrics']).toEqual(expect.objectContaining({ kind: 'text' }));
  });

  it('extracts audio duration, character and file limits without inventing controls', () => {
    const audio = normalizeCatalog(
      'audio',
      fixture('audioMixed').body,
      FETCHED_AT,
    );
    const music = audio.models.find((m) => m.id === 'elevenlabs/music')!;
    expect(music.limits.durationSeconds).toEqual({ min: 5, max: 300 });
    expect(music.controls).toEqual([]);

    const tts = audio.models.find((m) => m.id === 'xai-tts')!;
    expect(tts.limits.maxChars).toBe(5000);
    expect(tts.controls).toEqual([
      expect.objectContaining({ key: 'voices', kind: 'select' }),
    ]);

    const stt = audio.models.find((m) => m.id === 'Whisper-Large-V3')!;
    expect(stt.limits).toEqual(
      expect.objectContaining({
        maxFileSizeMb: 500,
        maxRequestBodyMb: 4,
        inputFormats: ['MP3', 'OGG', 'WAV', 'M4A', 'AAC'],
      }),
    );
    expect(stt.controls.find((c) => c.key === 'supports_remote_url')).toEqual({
      key: 'supports_remote_url',
      kind: 'unsupported',
      raw: true,
    });
  });

  it('keeps bare scalars inspectable as unsupported and ignores non-objects', () => {
    expect(normalizeControls({ supports_remote_url: true, note: 'x' })).toEqual(
      [
        { key: 'supports_remote_url', kind: 'unsupported', raw: true },
        { key: 'note', kind: 'unsupported', raw: 'x' },
      ],
    );
    expect(normalizeControls(null)).toEqual([]);
    expect(normalizeControls('resolutions')).toEqual([]);
    expect(normalizeControls(['1k'])).toEqual([]);
  });

  it('falls back to the defaults map when a nested descriptor has no default', () => {
    const controls = normalizeControls({
      parameters: {
        fps: { type: 'select', options: [{ value: 24 }, { value: 30 }] },
      },
      defaults: { fps: 24 },
    });
    expect(controls).toEqual([
      expect.objectContaining({ key: 'fps', kind: 'select', default: 24 }),
    ]);
  });
});

describe('refreshCatalogs (P1)', () => {
  const NOW = '2026-09-14T12:00:00.000Z';
  const EARLIER = '2026-09-13T06:00:00.000Z';
  const clock = () => NOW;

  function urlToCatalog(url: string): GenerationCatalog {
    const found = (
      Object.keys(PUBLIC_CATALOG_URLS) as GenerationCatalog[]
    ).find((catalog) => PUBLIC_CATALOG_URLS[catalog] === url);
    if (!found) {
      throw new Error(`unexpected URL ${url}`);
    }
    return found;
  }

  function previousVideo(): NormalizedCatalog {
    return {
      catalog: 'video',
      fetchedAt: EARLIER,
      url: PUBLIC_CATALOG_URLS.video,
      ...normalizeCatalog(
        'video',
        { data: [{ id: 'v/1' }, { id: 'v/2' }, { id: 'v/3' }] },
        EARLIER,
      ),
    };
  }

  it('leaves other modalities fresh when one fetch throws, marking it stale from the previous snapshot', async () => {
    const calls: string[] = [];
    const fetcher: CatalogFetcher = (url) => {
      calls.push(url);
      const catalog = urlToCatalog(url);
      if (catalog === 'video') {
        return Promise.reject(new Error('ECONNRESET'));
      }
      const count = { text: 3, image: 2, audio: 1, video: 0 }[catalog];
      return Promise.resolve({
        status: 200,
        body: {
          data: Array.from({ length: count }, (_, i) => ({
            id: `${catalog}/${i}`,
          })),
        },
      });
    };
    const previous = previousVideo();

    const result = await refreshCatalogs(fetcher, {
      now: clock,
      previous: { video: previous },
    });

    expect(calls.sort()).toEqual(Object.values(PUBLIC_CATALOG_URLS).sort());
    expect(result.text).toMatchObject({
      state: 'fresh',
      count: 3,
      fetchedAt: NOW,
    });
    expect(result.image).toMatchObject({
      state: 'fresh',
      count: 2,
      fetchedAt: NOW,
    });
    expect(result.audio).toMatchObject({
      state: 'fresh',
      count: 1,
      fetchedAt: NOW,
    });
    expect(result.video).toMatchObject({
      state: 'stale',
      count: 3,
      fetchedAt: EARLIER,
    });
    expect(result.video.error).toContain('ECONNRESET');
    expect(result.video.snapshot?.models.map((m) => m.id)).toEqual([
      'v/1',
      'v/2',
      'v/3',
    ]);
    expect(result.image.snapshot?.url).toBe(PUBLIC_CATALOG_URLS.image);
    expect(result.image.snapshot?.models.map((m) => m.id)).toEqual([
      'image/0',
      'image/1',
    ]);
  });

  it('reports unavailable with count 0 when a catalog fails and nothing was cached', async () => {
    const fetcher: CatalogFetcher = (url) =>
      Promise.resolve(
        urlToCatalog(url) === 'audio'
          ? { status: 503, body: { error: 'maintenance' } }
          : { status: 200, body: { data: [{ id: 'x' }] } },
      );

    const result = await refreshCatalogs(fetcher, { now: clock });

    expect(result.audio.state).toBe('unavailable');
    expect(result.audio.count).toBe(0);
    expect(result.audio.fetchedAt).toBeUndefined();
    expect(result.audio.snapshot).toBeUndefined();
    expect(result.audio.error).toContain('503');
    for (const catalog of ['text', 'image', 'video'] as const) {
      expect(result[catalog]).toMatchObject({ state: 'fresh', count: 1 });
    }
  });

  it('treats an unrecognized 200 body as a failure instead of an empty fresh catalog', async () => {
    const fetcher: CatalogFetcher = (url) =>
      Promise.resolve(
        urlToCatalog(url) === 'video'
          ? { status: 200, body: { message: 'temporarily unavailable' } }
          : { status: 200, body: [] },
      );
    const previous = previousVideo();

    const result = await refreshCatalogs(fetcher, {
      now: clock,
      previous: { video: previous },
    });

    expect(result.video).toMatchObject({
      state: 'stale',
      count: 3,
      fetchedAt: EARLIER,
    });
    expect(result.video.error).toContain('unrecognized_envelope');
    expect(result.image).toMatchObject({ state: 'fresh', count: 0 });
  });

  it('keeps a previous snapshot stale when a 200 error object body arrives', async () => {
    const fetcher: CatalogFetcher = (url) =>
      Promise.resolve(
        urlToCatalog(url) === 'video'
          ? { status: 200, body: { error: { message: 'down' } } }
          : { status: 200, body: [] },
      );
    const previous = previousVideo();

    const result = await refreshCatalogs(fetcher, {
      now: clock,
      previous: { video: previous },
    });

    expect(result.video).toMatchObject({
      state: 'stale',
      count: 3,
      fetchedAt: EARLIER,
    });
    expect(result.video.error).toContain('unrecognized_envelope');
    expect(result.video.snapshot?.models.map((m) => m.id)).toEqual([
      'v/1',
      'v/2',
      'v/3',
    ]);
    expect(result.image).toMatchObject({ state: 'fresh', count: 0 });
  });

  it('reports unavailable when a 200 error object body has no previous snapshot', async () => {
    const fetcher: CatalogFetcher = (url) =>
      Promise.resolve(
        urlToCatalog(url) === 'audio'
          ? { status: 200, body: { error: { message: 'down' } } }
          : { status: 200, body: { data: [{ id: 'x' }] } },
      );

    const result = await refreshCatalogs(fetcher, { now: clock });

    expect(result.audio.state).toBe('unavailable');
    expect(result.audio.count).toBe(0);
    expect(result.audio.fetchedAt).toBeUndefined();
    expect(result.audio.snapshot).toBeUndefined();
    expect(result.audio.error).toContain('unrecognized_envelope');
    for (const catalog of ['text', 'image', 'video'] as const) {
      expect(result[catalog]).toMatchObject({ state: 'fresh', count: 1 });
    }
  });

  it('uses the overridden URLs and the injected clock only', async () => {
    const calls: string[] = [];
    const fetcher: CatalogFetcher = (url) => {
      calls.push(url);
      return Promise.resolve({ status: 200, body: { data: [{ id: 'm' }] } });
    };
    const result = await refreshCatalogs(fetcher, {
      now: () => '2030-01-01T00:00:00.000Z',
      urls: { image: 'https://proxy.example/images' },
    });
    expect(calls).toContain('https://proxy.example/images');
    expect(calls).not.toContain(PUBLIC_CATALOG_URLS.image);
    expect(result.image.fetchedAt).toBe('2030-01-01T00:00:00.000Z');
    expect(result.image.snapshot?.url).toBe('https://proxy.example/images');
    expect(result.image.snapshot?.models[0]?.fetchedAt).toBe(
      '2030-01-01T00:00:00.000Z',
    );
  });
});

describe('route contract registry (P1)', () => {
  function baseContract(overrides: Partial<RouteContract>): RouteContract {
    return {
      id: 'test.route',
      family: 'test',
      baseUrl: 'https://nano-gpt.com',
      path: '/api/test',
      method: 'POST',
      operation: 'image-generate',
      auth: 'bearer-or-x-api-key',
      requestEncoding: 'json',
      allowedFields: ['model'],
      roleMapping: {},
      limits: {},
      responseVariants: [{ kind: 'inline-json', description: 'x' }],
      resultDelivery: 'inline',
      contractKind: 'generic',
      unresolved: [],
      verification: 'fixture',
      fixturePath: 'tests/fixtures/nanogpt/catalogs.json#fixtures.imageMixed',
      evidence: [
        {
          url: 'https://docs.nano-gpt.com/x.md',
          observedDateUtc: '2026-09-13',
        },
      ],
      ...overrides,
    };
  }

  it('accepts the shipped registry: every entry has dated evidence and a verification state', () => {
    expect(validateRouteRegistry(ROUTE_CONTRACTS)).toEqual([]);
    expect(ROUTE_CONTRACTS.length).toBeGreaterThan(0);
    for (const contract of ROUTE_CONTRACTS) {
      expect(contract.evidence.length).toBeGreaterThan(0);
      for (const evidence of contract.evidence) {
        expect(evidence.url).toMatch(/^https:\/\/(docs\.)?nano-gpt\.com\//);
        expect(evidence.observedDateUtc).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      expect(['metadata-only', 'fixture', 'observed']).toContain(
        contract.verification,
      );
      if (contract.verification === 'observed') {
        expect(contract.fixturePath).toEqual(expect.any(String));
      }
    }
  });

  it('rejects an entry that claims observed without a fixture path', () => {
    const problems = validateRouteRegistry([
      baseContract({ verification: 'observed', fixturePath: undefined }),
    ]);
    expect(problems).toEqual([
      expect.stringMatching(/test\.route.*observed.*fixturePath/),
    ]);
  });

  it('rejects entries without evidence, with malformed dates, or duplicate ids', () => {
    expect(validateRouteRegistry([baseContract({ evidence: [] })])).toEqual([
      expect.stringMatching(/test\.route.*evidence/),
    ]);
    expect(
      validateRouteRegistry([
        baseContract({
          evidence: [
            {
              url: 'https://docs.nano-gpt.com/x.md',
              observedDateUtc: 'yesterday',
            },
          ],
        }),
      ]),
    ).toEqual([expect.stringMatching(/test\.route.*observedDateUtc/)]);
    expect(validateRouteRegistry([baseContract({}), baseContract({})])).toEqual(
      [expect.stringMatching(/duplicate.*test\.route/)],
    );
  });

  it('requires metadata-only entries to state what is unresolved and overrides to expire', () => {
    expect(
      validateRouteRegistry([
        baseContract({
          verification: 'metadata-only',
          fixturePath: undefined,
          unresolved: [],
        }),
      ]),
    ).toEqual([
      expect.stringMatching(/test\.route.*metadata-only.*unresolved/),
    ]);
    expect(
      validateRouteRegistry([
        baseContract({
          override: {
            reason: 'x',
            expiresOnUtc: 'soon',
            sourceUrl: 'https://docs.nano-gpt.com/x.md',
          },
        }),
      ]),
    ).toEqual([expect.stringMatching(/test\.route.*override.*expiresOnUtc/)]);
  });

  it('builds URLs from each contract base so video routes never gain a /v1 prefix', () => {
    expect(routeUrl(getRouteContract('video.generate'))).toBe(
      'https://nano-gpt.com/api/generate-video',
    );
    expect(
      routeUrl(getRouteContract('video.status'), { requestId: 'vid_abc' }),
    ).toBe('https://nano-gpt.com/api/video/status?requestId=vid_abc');
    expect(routeUrl(getRouteContract('image.compat.generations'))).toBe(
      'https://nano-gpt.com/v1/images/generations',
    );
    expect(routeUrl(getRouteContract('image.normalized.generate'))).toBe(
      'https://nano-gpt.com/api/v1/images',
    );
    expect(() => getRouteContract('does.not.exist')).toThrow(
      /does\.not\.exist/,
    );
  });

  it('substitutes path template params on endpoint-metadata contracts', () => {
    expect(
      routeUrl(getRouteContract('image.endpoint-metadata'), {
        modelId: 'gpt-image-2',
      }),
    ).toBe('https://nano-gpt.com/api/v1/images/models/gpt-image-2/endpoints');
    expect(
      routeUrl(getRouteContract('image.endpoint-metadata'), {
        modelId: 'bytedance/seedream-v5.0-pro',
      }),
    ).toBe(
      'https://nano-gpt.com/api/v1/images/models/bytedance/seedream-v5.0-pro/endpoints',
    );
    expect(() => routeUrl(getRouteContract('image.endpoint-metadata'))).toThrow(
      /modelId/,
    );
    expect(
      routeUrl(getRouteContract('video.status'), {
        modelId: 'unused',
        requestId: 'vid_abc',
      }),
    ).toBe(
      'https://nano-gpt.com/api/video/status?modelId=unused&requestId=vid_abc',
    );
  });

  it('resolves endpoint metadata paths only against the Nano-GPT origin', () => {
    expect(
      resolveEndpointMetadataUrl(
        '/api/v1/images/models/bytedance/seedream-v5.0-pro/endpoints',
      ),
    ).toBe(
      'https://nano-gpt.com/api/v1/images/models/bytedance/seedream-v5.0-pro/endpoints',
    );
    expect(
      resolveEndpointMetadataUrl(
        'https://nano-gpt.com/api/v1/images/models/gpt-image-2/endpoints',
      ),
    ).toBe('https://nano-gpt.com/api/v1/images/models/gpt-image-2/endpoints');
    expect(
      resolveEndpointMetadataUrl(
        'https://evil.example/api/v1/images/models/x/endpoints',
      ),
    ).toBeUndefined();
    expect(
      resolveEndpointMetadataUrl(
        '//evil.example/api/v1/images/models/x/endpoints',
      ),
    ).toBeUndefined();
    expect(
      resolveEndpointMetadataUrl(
        'http://nano-gpt.com/api/v1/images/models/x/endpoints',
      ),
    ).toBeUndefined();
    expect(resolveEndpointMetadataUrl('/api/v1/other')).toBeUndefined();
  });
});
