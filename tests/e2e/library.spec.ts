import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/tiny.png',
);

test.use({ viewport: { width: 390, height: 844 } });

test('library import, selection, trash, and restore', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Library', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Import' }).click();
  await page
    .locator('input[aria-label="Import media files"]')
    .setInputFiles(fixture);

  const card = page.locator('[data-asset-id]').first();
  await expect(card).toBeVisible();
  await expect(card.getByText('tiny.png')).toBeVisible();

  await card.getByRole('checkbox', { name: /Select tiny\.png/i }).check();
  await expect(page.getByText('1 selected')).toBeVisible();

  await page
    .getByRole('button', { name: 'Move to trash', exact: true })
    .click();
  await expect(page.getByText('Your media stays on this device')).toBeVisible();

  await page.getByRole('button', { name: 'Show trash', exact: true }).click();
  await expect(page.locator('[data-asset-id]').first()).toBeVisible();
  await page.locator('[data-asset-id]').first().getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();

  await page.getByRole('button', { name: 'Show library', exact: true }).click();
  await expect(page.locator('[data-asset-id]').first()).toBeVisible();
  await expect(page.getByText('tiny.png')).toBeVisible();
});

test('library search filters imported assets', async ({ page }) => {
  await page.goto('/library');
  await page.locator('input[aria-label="Import media files"]').setInputFiles({
    name: 'portrait-alpha.png',
    mimeType: 'image/png',
    buffer: await import('node:fs/promises').then((fs) => fs.readFile(fixture)),
  });
  await expect(page.getByText('portrait-alpha.png')).toBeVisible();

  await page.getByLabel('Search library').fill('portrait');
  await expect(page.getByText('portrait-alpha.png')).toBeVisible();
  await page.getByLabel('Search library').fill('no-such-asset-zzz');
  await expect(page.getByText('Your media stays on this device')).toBeVisible();
});
