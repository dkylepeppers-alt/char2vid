import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const fixtures = path.dirname(fileURLToPath(import.meta.url));
const portrait = path.join(fixtures, '../fixtures/tiny.png');
const jacket = path.join(fixtures, '../fixtures/tiny-red.png');

test.use({ viewport: { width: 390, height: 844 } });

const imageCatalog = {
  data: [
    {
      id: 'vendor/one-ref',
      name: 'One Ref 2026',
      capabilities: { image_generation: true, image_to_image: true },
      supported_parameters: {
        n: { type: 'number', min: 1, max: 4, default: 1 },
        max_input_images: 1,
        input_image_constraints: { max_items: 1 },
      },
    },
  ],
};

test('create preserves accepted prompt text and blocks silent reference drops', async ({
  page,
}) => {
  await page.route('https://nano-gpt.com/api/v1/**', (route) => {
    if (route.request().url().includes('/api/v1/images/models')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(imageCatalog),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.goto('/');
  await page
    .locator('input[aria-label="Import media files"]')
    .setInputFiles([portrait, jacket]);
  await expect(page.locator('[data-asset-id]')).toHaveCount(2);

  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Generation text' }),
  ).toBeVisible();
  await page.getByLabel('change module text').fill('wave from the doorway');
  await page.getByRole('button', { name: 'Accept compiled prompt' }).click();
  await expect(page.getByLabel('Prompt')).toHaveValue('wave from the doorway');

  await page.getByRole('button', { name: /One Ref 2026/ }).click();
  await page
    .getByRole('button', { name: 'Attach as identity' })
    .first()
    .click();
  await page.getByRole('button', { name: 'Attach as identity' }).click();
  await expect(
    page.getByRole('heading', { name: 'Reference assignment' }),
  ).toBeVisible();
  await expect(page.getByLabel('Blocking reference issues')).toContainText(
    /at most 1 reference/i,
  );
  await expect(
    page.getByRole('button', {
      name: 'Resolve reference issues to generate',
    }),
  ).toBeDisabled();

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await expect(page.getByLabel('Prompt')).toHaveValue('wave from the doorway');
});
