import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('phone navigation survives reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Characters', exact: true }).click();

  // Wait until the destination is both rendered and persisted before reloading,
  // otherwise the reload can race the route-persistence effect and restore the
  // previous destination instead of Characters.
  await expect(page).toHaveURL(/\/characters$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Characters', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('char2vid.selected-route'),
      ),
    )
    .toBe('characters');

  await page.goto('/');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Characters', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open jobs' })).toBeVisible();
});

test('create draft survives navigation and reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await page.getByLabel('Prompt').fill('A quiet portrait in window light');
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await page.reload();

  await expect(page.getByLabel('Prompt')).toHaveValue(
    'A quiet portrait in window light',
  );
});

test('back closes an open sheet before changing destination', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Open jobs' }).click();
  await expect(page.getByRole('dialog', { name: 'Jobs' })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog', { name: 'Jobs' })).toBeHidden();
  await expect(
    page.getByRole('heading', { name: 'Create', exact: true }),
  ).toBeVisible();
});

test('modal sheet contains focus and restores its trigger', async ({
  page,
}) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Open jobs' });
  await trigger.focus();
  await trigger.click();

  const close = page.getByRole('button', { name: 'Close' });
  await expect(close).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();

  await close.click();
  await expect(trigger).toBeFocused();
});

test('settings exposes service connection without bundling provider secrets', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open settings' }).click();

  await expect(
    page.getByRole('heading', { name: 'Service connection' }),
  ).toBeVisible();
  await expect(page.getByLabel('Nano-GPT API key')).toBeVisible();
  await expect(page.getByLabel('Service origin')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save key on this phone' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Store key on service' }),
  ).toBeVisible();

  const html = await page.content();
  expect(html).not.toMatch(/VITE_[A-Z0-9_]*KEY/);
  expect(html).not.toMatch(/sk-live-/);
});
