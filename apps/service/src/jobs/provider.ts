import type { Operation } from '@char2vid/domain';

export interface ProviderSubmitResult {
  status: number;
  contentType: string;
  json?: unknown;
  bytes?: Uint8Array;
}

export interface GenerationProvider {
  submit(input: {
    url: string;
    method: 'POST';
    body: unknown;
    apiKey: string;
    operation: Operation;
  }): Promise<ProviderSubmitResult>;
  status(input: {
    runId: string;
    apiKey: string;
    operation: Operation;
  }): Promise<unknown>;
  fetchOutput(url: string): Promise<{ bytes: Uint8Array; mime: string }>;
}
