import type { Page } from '@playwright/test';

import { FakeGenerationProvider } from './fake-nanogpt';
import {
  closeTestService,
  openTestService,
  type TestService,
} from './open-test-service';

export const E2E_SERVICE_ORIGIN = 'http://127.0.0.1:4173';
export const E2E_SERVICE_PORT = 8787;
export const E2E_SETUP_TOKEN = 'setup-secret-token';
export const E2E_OWNER = 'owner';
export const E2E_PASSWORD = 'correct-horse-battery';
export const E2E_FAKE_KEY = 'sk-test-e2e-key-1234';

export async function startE2eFakeService(): Promise<{
  service: TestService;
  provider: FakeGenerationProvider;
}> {
  const provider = new FakeGenerationProvider();
  const service = await openTestService({
    provider,
    autoProcessJobs: false,
    cookieSecure: false,
    publicOrigin: E2E_SERVICE_ORIGIN,
  });
  service.app.get('/__fake/stats', () => ({
    submits: provider.submits,
    statusPolls: provider.statusPolls,
  }));
  service.app.post('/__fake/tick', async () => {
    await service.processJobs();
    return { ok: true, submits: provider.submits };
  });
  await service.app.listen({ host: '127.0.0.1', port: E2E_SERVICE_PORT });
  return { service, provider };
}

export async function stopE2eFakeService(service: TestService): Promise<void> {
  await closeTestService(service);
}

export async function connectFakeService(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByLabel('Service origin').fill(E2E_SERVICE_ORIGIN);
  await page.getByLabel('One-time setup token').fill(E2E_SETUP_TOKEN);
  await page.getByLabel('Owner login').fill(E2E_OWNER);
  await page.getByLabel('Owner password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Complete setup' }).click();
  await page.getByText('Owner login created').waitFor();
  await page.getByLabel('Owner password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Browser session cookie set.').waitFor();
  await page.getByLabel('Nano-GPT API key').fill(E2E_FAKE_KEY);
  await page.getByRole('button', { name: 'Store key on service' }).click();
  await page.getByText(/Key stored on the service/).waitFor();
  await page.getByRole('button', { name: 'Close' }).click();
}

export const e2eImageCatalog = {
  data: [
    {
      id: 'vendor/plain-image',
      name: 'Plain Image',
      capabilities: { image_generation: true },
    },
  ],
};
