import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  mergeEndpointMetadata,
  normalizeCatalog,
  normalizeControls,
} from '../../packages/nanogpt/src/catalog/normalize';

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
