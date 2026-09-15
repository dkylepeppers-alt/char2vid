import { expect, test, type Page } from '@playwright/test';

import {
  connectFakeService,
  e2eImageCatalog,
  startE2eFakeService,
  stopE2eFakeService,
} from '../helpers/e2e-fake-service';
import type { TestService } from '../helpers/open-test-service';

test.use({ viewport: { width: 390, height: 844 } });

test.describe.configure({ mode: 'serial' });

let service: TestService;

test.beforeAll(async () => {
  const started = await startE2eFakeService();
  service = started.service;
});

test.afterAll(async () => {
  if (service) {
    await stopE2eFakeService(service);
  }
});

async function mockCatalogs(page: Page, imageStatus = 200): Promise<void> {
  await page.route('https://nano-gpt.com/api/v1/**', (route) => {
    if (route.request().url().includes('/api/v1/images/models')) {
      return route.fulfill({
        status: imageStatus,
        contentType: 'application/json',
        body:
          imageStatus === 200
            ? JSON.stringify(e2eImageCatalog)
            : '{"error":"unavailable"}',
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
}

test('catalog partial outage stays metadata-only and does not call Nano-GPT', async ({
  page,
}) => {
  await mockCatalogs(page, 503);
  await page.goto('/create');
  await expect(
    page.getByText('Catalog unavailable. Retry when online.'),
  ).toBeVisible();
  const stats = await page.request.get('/__fake/stats');
  expect(stats.ok()).toBeTruthy();
  expect(await stats.json()).toEqual({ submits: 0, statusPolls: 0 });
});

test('double Generate and cancel stay on one fake job with no provider call', async ({
  page,
}) => {
  await mockCatalogs(page);
  await page.goto('/');
  await connectFakeService(page);
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await page.getByLabel('Prompt').fill('A quiet portrait in window light');
  await page.getByRole('button', { name: /Plain Image/ }).click();
  const generate = page.getByRole('button', { name: 'Generate' });
  await expect(generate).toBeEnabled();
  await Promise.all([generate.click(), generate.click()]);
  await expect(page.getByText(/Queued /)).toBeVisible();

  const listed = await page.request.get('/studio-api/jobs');
  expect(listed.ok()).toBeTruthy();
  const body = (await listed.json()) as { jobs: Array<{ id: string }> };
  expect(body.jobs).toHaveLength(1);

  await page.getByRole('button', { name: 'Open jobs' }).click();
  await page.getByRole('button', { name: 'Cancel queued job' }).click();
  await expect(page.getByText(/provider cancelled/)).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  const stats = await page.request.get('/__fake/stats');
  expect(await stats.json()).toMatchObject({ submits: 0 });
});

test('a later Generate plus worker tick completes one fake image job', async ({
  page,
}) => {
  await mockCatalogs(page);
  await page.goto('/');
  await connectFakeService(page);
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await page.getByLabel('Prompt').fill('A second quiet portrait');
  await page.getByRole('button', { name: /Plain Image/ }).click();
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText(/Queued /)).toBeVisible();

  const before = (await (await page.request.get('/__fake/stats')).json()) as {
    submits: number;
  };
  const tick = await page.request.post('/__fake/tick');
  expect(tick.ok()).toBeTruthy();
  expect(await tick.json()).toMatchObject({ submits: before.submits + 1 });

  await page.getByRole('button', { name: 'Open jobs' }).click();
  await expect(page.getByText(/provider completed/)).toBeVisible();
  const tickAgain = await page.request.post('/__fake/tick');
  expect(await tickAgain.json()).toMatchObject({
    submits: before.submits + 1,
  });
});
