import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/tiny.png',
);

type Box = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

async function clientBox(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    };
  });
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

async function stubVisualViewport(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let height = window.innerHeight;
    let offsetTop = 0;
    const listeners: Record<string, Array<() => void>> = {};
    const visualViewport = {
      get height() {
        return height;
      },
      get offsetTop() {
        return offsetTop;
      },
      get width() {
        return window.innerWidth;
      },
      addEventListener(type: string, listener: () => void) {
        (listeners[type] ??= []).push(listener);
      },
      removeEventListener(type: string, listener: () => void) {
        listeners[type] = (listeners[type] ?? []).filter(
          (callback) => callback !== listener,
        );
      },
    };
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      get() {
        return visualViewport;
      },
    });
    Object.defineProperty(window, '__setChar2vidVisualViewport', {
      value(next: { height: number; offsetTop?: number }) {
        height = next.height;
        offsetTop = next.offsetTop ?? 0;
        for (const callback of listeners.resize ?? []) {
          callback();
        }
      },
    });
  });
}

async function shrinkVisualViewportToKeyboard(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as Window & {
        __setChar2vidVisualViewport?: (next: {
          height: number;
          offsetTop?: number;
        }) => void;
      }
    ).__setChar2vidVisualViewport?.({ height: 480 });
  });
}

async function assertFieldClearsBottomNav(
  page: Page,
  field: Locator,
): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Studio destinations' });
  await expect(field).toBeVisible();
  await field.scrollIntoViewIfNeeded();
  await field.focus();

  const fieldBox = await clientBox(field);
  const navBox = await clientBox(nav);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  expect(
    overlaps(fieldBox, navBox),
    `expected field ${JSON.stringify(fieldBox)} to stay above nav ${JSON.stringify(navBox)}`,
  ).toBe(false);
  expect(fieldBox.top).toBeGreaterThanOrEqual(-1);
  expect(fieldBox.bottom).toBeLessThanOrEqual((viewport?.height ?? 0) + 2);
}

test.describe('phone keyboard-sized viewport', () => {
  test.use({ viewport: { width: 390, height: 480 } });

  test('create prompt stays above the bottom nav', async ({ page }) => {
    await page.goto('/create');
    await assertFieldClearsBottomNav(page, page.getByLabel('Prompt'));
  });

  test('library search stays above the bottom nav', async ({ page }) => {
    await page.goto('/library');
    await assertFieldClearsBottomNav(page, page.getByLabel('Search library'));
  });

  test('make character name field stays above the bottom nav', async ({
    page,
  }) => {
    await page.goto('/library');
    await page
      .locator('input[aria-label="Import media files"]')
      .setInputFiles(fixture);
    await page.locator('[data-asset-id]').first().getByRole('button').click();
    await assertFieldClearsBottomNav(
      page,
      page.getByLabel('New character name'),
    );
  });

  test('settings inputs stay above the bottom nav', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await assertFieldClearsBottomNav(page, page.getByLabel('Service origin'));
    await assertFieldClearsBottomNav(page, page.getByLabel('Nano-GPT API key'));
  });
});

test.describe('phone full-height viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('create prompt stays above the bottom nav at 844px', async ({
    page,
  }) => {
    await page.goto('/create');
    await assertFieldClearsBottomNav(page, page.getByLabel('Prompt'));
  });

  test('lifts the bottom nav when the visual viewport shrinks to keyboard height', async ({
    page,
  }) => {
    await stubVisualViewport(page);
    await page.goto('/create');
    await shrinkVisualViewportToKeyboard(page);

    await expect
      .poll(async () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--keyboard-inset')
            .trim(),
        ),
      )
      .toBe('364px');

    const nav = page.getByRole('navigation', { name: 'Studio destinations' });
    await expect(nav).toHaveCSS('bottom', '364px');

    const prompt = page.getByLabel('Prompt');
    await assertFieldClearsBottomNav(page, prompt);
    const fieldBox = await clientBox(prompt);
    expect(fieldBox.bottom).toBeLessThanOrEqual(480 + 2);
  });
});

test.describe('desktop side navigation', () => {
  test.use({ viewport: { width: 900, height: 800 } });

  test('keeps a column side nav rather than a fixed bottom bar', async ({
    page,
  }) => {
    await page.goto('/create');
    const nav = page.getByRole('navigation', { name: 'Studio destinations' });
    await expect(nav).toHaveCSS('position', 'static');

    const prompt = page.getByLabel('Prompt');
    await prompt.scrollIntoViewIfNeeded();
    const promptBox = await clientBox(prompt);
    const navBox = await clientBox(nav);
    expect(navBox.bottom).toBeGreaterThan(navBox.top + 100);
    expect(promptBox.left).toBeGreaterThan(navBox.right - 1);
  });
});
