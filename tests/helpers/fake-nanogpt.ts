import type { Operation } from '@char2vid/domain';

import type {
  GenerationProvider,
  ProviderSubmitResult,
} from '../../apps/service/src/jobs/provider.ts';

export const FIXTURE_PNG = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0x01,
  0x02,
  0x03,
  0x04,
);

export const FIXTURE_AUDIO = Uint8Array.of(0xff, 0xfb, 0x90, 0x00, 0x01, 0x02);

export class FakeGenerationProvider implements GenerationProvider {
  submits = 0;
  statusPolls = 0;
  crashAfterSubmit = false;
  imageBody: unknown = {
    data: [
      { b64_json: Buffer.from(FIXTURE_PNG).toString('base64') },
      { url: 'https://media.example/second.png' },
    ],
  };
  videoCost: unknown = 0.12;
  outputs = new Map<string, { bytes: Uint8Array; mime: string }>([
    [
      'https://media.example/second.png',
      { bytes: FIXTURE_PNG, mime: 'image/png' },
    ],
    [
      'https://media.example/clip.mp4',
      { bytes: FIXTURE_PNG, mime: 'video/mp4' },
    ],
    [
      'https://media.example/voice.mp3',
      { bytes: FIXTURE_AUDIO, mime: 'audio/mpeg' },
    ],
  ]);

  async submit(input: {
    url: string;
    method: 'POST';
    body: unknown;
    apiKey: string;
    operation: Operation;
  }): Promise<ProviderSubmitResult> {
    this.submits += 1;
    if (this.crashAfterSubmit) {
      throw new Error('simulated_crash_after_dispatch');
    }
    if (input.operation === 'video-generate') {
      return {
        status: 202,
        contentType: 'application/json',
        json: {
          runId: 'video-run-1',
          id: 'video-run-1',
          model: 'fixture/video',
          status: 'pending',
          cost: this.videoCost,
        },
      };
    }
    if (input.operation === 'speech' || input.operation === 'music') {
      return {
        status: 200,
        contentType: 'audio/mpeg',
        bytes: FIXTURE_AUDIO,
      };
    }
    return {
      status: 200,
      contentType: 'application/json',
      json: this.imageBody,
    };
  }

  async status(): Promise<unknown> {
    this.statusPolls += 1;
    return {
      data: {
        status: 'COMPLETED',
        output: { video: { url: 'https://media.example/clip.mp4' } },
        cost: this.videoCost,
      },
    };
  }

  async fetchOutput(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const found = this.outputs.get(url);
    if (!found) {
      throw new Error(`unknown_fake_output:${url}`);
    }
    return found;
  }
}
