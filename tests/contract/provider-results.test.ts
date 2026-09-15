import { describe, expect, it } from 'vitest';

import { normalizeAudioOutput } from '../../packages/nanogpt/src/results/audio-output';
import { normalizeImageOutput } from '../../packages/nanogpt/src/results/image-output';
import { normalizeVideoStatus } from '../../packages/nanogpt/src/results/video-status';

describe('normalizeVideoStatus (P4)', () => {
  it('reads the documented nested completion envelope', () => {
    expect(
      normalizeVideoStatus({
        data: {
          status: 'COMPLETED',
          output: { video: { url: 'https://media.example/clip.mp4' } },
        },
      }),
    ).toMatchObject({
      state: 'completed',
      outputUrl: 'https://media.example/clip.mp4',
    });
  });

  it('does not invent output for an empty completion', () => {
    expect(() =>
      normalizeVideoStatus({ data: { status: 'COMPLETED' } }),
    ).toThrow('missing_video_output');
  });

  it('reads the documented flat lowercase status variant', () => {
    expect(
      normalizeVideoStatus({
        status: 'completed',
        videoUrl: 'https://media.example/flat.mp4',
        cost: 0.42,
      }),
    ).toMatchObject({
      state: 'completed',
      outputUrl: 'https://media.example/flat.mp4',
      cost: 0.42,
    });
  });

  it('maps nested pending and failed envelopes without inventing URLs', () => {
    expect(normalizeVideoStatus({ data: { status: 'PENDING' } })).toMatchObject(
      { state: 'running' },
    );
    expect(
      normalizeVideoStatus({
        data: { status: 'FAILED', error: 'provider_denied' },
      }),
    ).toMatchObject({ state: 'failed', error: 'provider_denied' });
  });

  it('rejects an unsupported video envelope', () => {
    expect(() => normalizeVideoStatus({ weird: true })).toThrow(
      'unsupported_video_envelope',
    );
  });
});

describe('normalizeImageOutput (P4)', () => {
  it('preserves every output item with stable ordinals', () => {
    const result = normalizeImageOutput({
      data: [
        { url: 'https://media.example/a.png' },
        { b64_json: 'aaa' },
        { url: 'https://media.example/c.png', b64_json: 'ignored-when-url' },
      ],
    });
    expect(result.items).toEqual([
      { ordinal: 0, url: 'https://media.example/a.png' },
      { ordinal: 1, base64: 'aaa' },
      { ordinal: 2, url: 'https://media.example/c.png' },
    ]);
  });

  it('falls back from url to b64_json on a single item', () => {
    expect(
      normalizeImageOutput({ data: [{ b64_json: 'only-base64' }] }).items,
    ).toEqual([{ ordinal: 0, base64: 'only-base64' }]);
  });

  it('does not invent output for an empty successful envelope', () => {
    expect(() => normalizeImageOutput({ data: [] })).toThrow(
      'missing_image_output',
    );
    expect(() => normalizeImageOutput({ data: [{}] })).toThrow(
      'missing_image_output',
    );
  });
});

describe('normalizeAudioOutput (P4)', () => {
  it('treats a 200 audio body as binary output', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(normalizeAudioOutput(200, bytes, 'audio/mpeg', bytes)).toEqual({
      kind: 'binary',
      mime: 'audio/mpeg',
      bytes,
    });
  });

  it('reads a JSON audio URL envelope', () => {
    expect(
      normalizeAudioOutput(
        200,
        { audioUrl: 'https://media.example/voice.mp3' },
        'application/json',
      ),
    ).toEqual({
      kind: 'url',
      url: 'https://media.example/voice.mp3',
    });
  });

  it('reads a 202 audio ticket without treating it as complete audio', () => {
    expect(
      normalizeAudioOutput(
        202,
        { runId: 'tts-1', cost: 0.01 },
        'application/json',
      ),
    ).toEqual({
      kind: 'ticket',
      runId: 'tts-1',
      cost: 0.01,
      rawTicket: { runId: 'tts-1', cost: 0.01 },
    });
  });
});
