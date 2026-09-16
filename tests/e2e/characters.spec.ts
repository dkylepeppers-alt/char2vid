import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const fixtures = path.dirname(fileURLToPath(import.meta.url));
const portrait = path.join(fixtures, '../fixtures/tiny.png');
const jacket = path.join(fixtures, '../fixtures/tiny-red.png');

test.use({ viewport: { width: 390, height: 844 } });

test('creates a character with independent looks, rejected views, and package restore', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .locator('input[aria-label="Import media files"]')
    .setInputFiles(portrait);
  const card = page.locator('[data-asset-id]').first();
  await expect(card).toBeVisible();
  await card.getByRole('button').click();

  await page.getByLabel('New character name').fill('Mira');
  await page.getByRole('button', { name: 'Quick character' }).click();

  await expect(page.getByRole('heading', { name: 'Mira' })).toBeVisible();
  await expect(page.getByText('identity · front')).toBeVisible();
  await expect(
    page.getByText('approved', { exact: false }).first(),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Close character editor' }).click();
  await expect(page.getByRole('list', { name: 'Characters' })).toBeVisible();
  await expect(
    page.locator('[data-character-id]').getByText('Mira'),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page
    .locator('input[aria-label="Import media files"]')
    .setInputFiles(jacket);
  const jacketCard = page
    .locator('[data-asset-id]')
    .filter({ hasText: 'tiny-red.png' });
  await expect(jacketCard).toBeVisible();
  await jacketCard.getByRole('button').click();
  const revisionId = (
    await page
      .locator('dt', { hasText: 'Revision' })
      .locator('xpath=..')
      .locator('dd')
      .textContent()
  )?.trim();
  expect(revisionId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  await page.getByRole('button', { name: 'Close asset detail' }).click();

  await page.getByRole('link', { name: 'Characters', exact: true }).click();
  await page.locator('[data-character-id]').getByRole('button').click();
  await page.getByLabel('Look label').fill('Red jacket');
  await page.getByLabel('Look notes').fill('Wardrobe only.');
  await page
    .getByLabel('Look reference image')
    .selectOption({ label: 'tiny-red.png' });
  await page.getByRole('button', { name: 'Save look' }).click();
  await expect(page.getByText('Red jacket')).toBeVisible();

  await page.getByLabel('Slot asset revision ID').fill(revisionId!);
  await page.getByLabel('Slot role').selectOption('identity');
  await page.getByLabel('Slot view').selectOption('left');
  await page.getByRole('button', { name: 'Add candidate slot' }).click();
  await expect(
    page.getByText('candidate', { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reject view' }).click();
  await expect(page.getByRole('button', { name: 'Reject view' })).toHaveCount(
    0,
  );

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export character' }).click(),
  ]);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  await expect(page.getByText(/Exported char2vid-character-/)).toBeVisible();

  await page.getByRole('button', { name: 'Close character editor' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page
    .locator('input[aria-label="Import library archive"]')
    .setInputFiles(downloadPath!);
  await expect(page.getByText(/Imported 2 asset\(s\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('link', { name: 'Characters', exact: true }).click();
  await expect(page.locator('[data-character-id]')).toHaveCount(2);
  await expect(page.getByText('Mira').first()).toBeVisible();
});

test('characters empty state stays local and does not mention training', async ({
  page,
}) => {
  await page.goto('/characters');
  await expect(
    page.getByRole('heading', { name: 'No characters yet' }),
  ).toBeVisible();
  const html = await page.content();
  expect(html).not.toMatch(/iModel/i);
  expect(html).not.toMatch(/LoRA/i);
  expect(html).not.toMatch(/VITE_[A-Z0-9_]*KEY/);
});
