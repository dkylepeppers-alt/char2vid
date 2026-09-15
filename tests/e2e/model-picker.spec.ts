import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

const imageCatalog = {
  data: [
    {
      id: 'vendor/brand-new-2026',
      name: 'Brand New 2026',
      capabilities: { image_generation: true },
      supported_parameters: {
        n: { type: 'number', min: 1, max: 4, default: 1 },
      },
    },
    {
      id: 'vendor/plain-image',
      name: 'Plain Image',
      capabilities: { image_generation: true },
    },
    {
      id: 'vendor/text-only',
      name: 'Text Only',
      capabilities: { chat: true },
    },
  ],
};

test('create picker lists a new catalog model and preserves the draft', async ({
  page,
}) => {
  await page.route('https://nano-gpt.com/api/v1/images/models', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(imageCatalog),
    }),
  );
  await page.route('https://nano-gpt.com/api/v1/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    }),
  );

  await page.goto('/');
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await page.getByLabel('Prompt').fill('A quiet portrait in window light');
  await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  await expect(page.getByText('vendor/brand-new-2026')).toBeVisible();
  await expect(page.getByText('vendor/text-only')).toHaveCount(0);

  await page.getByRole('tab', { name: 'All' }).click();
  await expect(page.getByText('vendor/text-only')).toBeVisible();
  await expect(page.getByText('incompatible_operation')).toBeVisible();

  await page.getByLabel('Search models').fill('brand-new');
  await expect(page.getByText('vendor/plain-image')).toHaveCount(0);
  await expect(page.getByText('vendor/brand-new-2026')).toBeVisible();
  await page.getByLabel('Search models').fill('');

  await page.getByRole('button', { name: /Brand New 2026/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Request preview' }),
  ).toBeVisible();
  await page.getByLabel('n').fill('2');
  await page.getByRole('button', { name: /Plain Image/ }).click();
  await expect(
    page.getByText('Settings dropped on model switch: n'),
  ).toBeVisible();
  await expect(page.getByText('Generation waits for jobs')).toBeVisible();

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await expect(page.getByLabel('Prompt')).toHaveValue(
    'A quiet portrait in window light',
  );
});
