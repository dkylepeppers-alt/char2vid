import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('Settings debug logs show checklist completion without prompt text', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Generation text' }),
  ).toBeVisible();
  await page.getByLabel('change module text').fill('wave from the doorway');
  await page.getByRole('button', { name: 'Accept compiled prompt' }).click();
  await expect(page.getByLabel('Prompt')).toHaveValue('wave from the doorway');

  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.getByRole('heading', { name: 'Debug logs' })).toBeVisible();
  await expect(
    page.getByRole('checkbox', {
      name: 'Write debug logs to console / logcat',
    }),
  ).toBeChecked();
  const logs = page.getByLabel('Recent debug logs');
  await expect(logs).toContainText('checklist.item');
  await expect(logs).toContainText('module:change');
  await expect(logs).toContainText('accepted-prompt');
  await expect(logs).not.toContainText('wave from the doorway');
});
