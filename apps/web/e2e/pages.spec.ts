import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/en.js';
import { th } from '../src/i18n/th.js';
import { extraEn, extraTh } from '../src/i18n/extra.js';
import * as extraDashboard from '../src/i18n/extra-dashboard.js';
import { BASE, mockApi, setLang, shot, trackRequests } from './support.js';

/**
 * S10b page tests: Dashboard, Strategies and the Kill switch, in both
 * languages. Every /v1 call is mocked (see support.ts).
 */

type Lang = 'en' | 'th';
const LANGS: Lang[] = ['en', 'th'];

const DICTS: Record<Lang, Record<string, string>> = {
  en: { ...en, ...extraEn, ...extraDashboard.en },
  th: { ...th, ...extraTh, ...extraDashboard.th },
};

// `noUncheckedIndexedAccess` makes dictionary lookups `string | undefined`; a missing key is a test bug, not a runtime case.
const s = (dict: Record<string, string>, key: string): string => dict[key] ?? key;

async function openDashboard(page: Page, dict: Record<string, string>) {
  await expect(page.getByRole('heading', { name: s(dict, 'dashboard') })).toBeVisible();
}

// A horizontal scroll bar shows when the content is wider than its box, even by 1 px (ClickUp z8p29877dh).
// The box and every scroll container inside it are checked, so a nested scroll bar counts too.
async function expectNoHorizontalOverflow(page: Page, selector: string) {
  const wide = await page
    .locator(selector)
    .first()
    .evaluate((root) =>
      [root, ...root.querySelectorAll('*')]
        .filter((e) => e === root || ['auto', 'scroll'].includes(getComputedStyle(e).overflowX))
        .filter((e) => e.scrollWidth > e.clientWidth)
        .map((e) => `${e.className} ${e.scrollWidth}>${e.clientWidth}`),
    );
  expect(wide, `${selector} overflows horizontally`).toEqual([]);
}

function assertSameOriginOnly(origins: string[]) {
  for (const origin of origins) {
    expect(origin, `request to non-localhost origin: ${origin}`).toBe(BASE);
  }
}

for (const lang of LANGS) {
  const dict = DICTS[lang];

  test(`dashboard (${lang})`, async ({ page }) => {
    await setLang(page, lang);
    await mockApi(page, { signedIn: true });
    await page.goto('/');

    await openDashboard(page, dict);
    await expect(page.getByText(s(dict, 'spotEq'), { exact: true })).toBeVisible();
    await expect(page.getByText('BTCUSDT', { exact: true })).toBeVisible();
    await expect(page.getByText(s(dict, 'alAttT').replace('{pair}', 'SOLUSDT'))).toBeVisible();
    await shot(page, `dashboard-${lang}`);

    // Trade history: open the first trade, the drawer shows, Escape closes it.
    await page.getByRole('tab', { name: new RegExp(s(dict, 'history')) }).click();
    await page.locator('.trades-row').first().click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('T-3', { exact: true })).toBeVisible();
    await shot(page, `trade-drawer-${lang}`);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    // Audit log.
    await page.getByRole('tab', { name: s(dict, 'audit') }).click();
    await expect(page.getByText(s(dict, 'auditNote'))).toBeVisible();

    // Heatmap.
    await expect(page.locator('.heatmap').getByText(s(dict, 'hmTitle'))).toBeVisible();
    await expectNoHorizontalOverflow(page, '.heatmap-scroll');
  });

  test(`strategies (${lang})`, async ({ page }) => {
    await setLang(page, lang);
    await mockApi(page, { signedIn: true });
    await page.goto('/');

    await openDashboard(page, dict);
    await page.getByRole('button', { name: s(dict, 'strategies') }).click();
    await expect(page.getByRole('heading', { name: s(dict, 'strategies') })).toBeVisible();
    for (const id of ['S-01', 'S-02', 'S-03', 'S-04']) {
      await expect(page.getByText(id, { exact: true })).toBeVisible();
    }
    await expectNoHorizontalOverflow(page, 'section:has(.strat-row)');
    await shot(page, `strategies-${lang}`);

    // The create form, with its live sizing preview.
    await page.getByRole('button', { name: s(dict, 'newStrategy') }).click();
    await expect(page.getByRole('heading', { name: s(dict, 'newTitle') })).toBeVisible();
    await expect(page.getByText(s(dict, 'preview'))).toBeVisible();
    await shot(page, `strategy-form-${lang}`);

    // Back to the list. The header nav has a button with the same name, so scope to the page.
    await page.locator('main').getByRole('button', { name: s(dict, 'strategies') }).click();
    await expect(page.getByRole('heading', { name: s(dict, 'strategies') })).toBeVisible();
  });

  test(`kill switch (${lang})`, async ({ page }) => {
    await setLang(page, lang);
    await mockApi(page, { signedIn: true });
    await page.goto('/');

    await openDashboard(page, dict);
    await page.getByRole('button', { name: s(dict, 'killSwitch') }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: s(dict, 'mKillT') })).toBeVisible();
    await dialog.getByRole('button', { name: s(dict, 'mKillOk') }).click();

    await expect(page.getByRole('heading', { name: s(dict, 'tradingStopped') })).toBeVisible();
    await expect(page.getByRole('alert')).toBeVisible();
    await shot(page, `kill-result-${lang}`);
  });

  test(`authenticated pages make no third-party request (${lang})`, async ({ page }) => {
    const getOrigins = trackRequests(page);
    await setLang(page, lang);
    await mockApi(page, { signedIn: true });
    await page.goto('/');

    // Dashboard, all three tabs.
    await openDashboard(page, dict);
    await page.getByRole('tab', { name: new RegExp(s(dict, 'history')) }).click();
    await page.getByRole('tab', { name: s(dict, 'audit') }).click();
    await page.getByRole('tab', { name: s(dict, 'positions') }).click();

    // Strategies, and the create form.
    await page.getByRole('button', { name: s(dict, 'strategies') }).click();
    await expect(page.getByRole('heading', { name: s(dict, 'strategies') })).toBeVisible();
    await page.getByRole('button', { name: s(dict, 'newStrategy') }).click();
    await expect(page.getByRole('heading', { name: s(dict, 'newTitle') })).toBeVisible();
    await page.getByRole('button', { name: s(dict, 'cancel') }).click();

    // Settings.
    await page.getByRole('button', { name: s(dict, 'settings') }).click();
    await expect(page.getByRole('heading', { name: s(dict, 'settings'), level: 1 })).toBeVisible();

    // Kill switch result.
    await page.getByRole('button', { name: s(dict, 'killSwitch') }).click();
    await page.getByRole('dialog').getByRole('button', { name: s(dict, 'mKillOk') }).click();
    await expect(page.getByRole('heading', { name: s(dict, 'tradingStopped') })).toBeVisible();

    await page.evaluate(() => document.fonts.ready);
    const families = await page.evaluate(() =>
      Array.from(document.fonts)
        .filter((f) => f.status === 'loaded')
        .map((f) => f.family),
    );
    expect(families).toContain('Poppins');
    expect(families).toContain('JetBrains Mono');
    if (lang === 'th') expect(families).toContain('Noto Sans Thai');

    assertSameOriginOnly(getOrigins());
  });
}

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const lang of LANGS) {
    const dict = DICTS[lang];

    test(`dashboard (${lang})`, async ({ page }) => {
      await setLang(page, lang);
      await mockApi(page, { signedIn: true });
      await page.goto('/');

      await openDashboard(page, dict);

      // Desktop-only nav is gone; the kill bar takes its place.
      await expect(page.getByRole('button', { name: s(dict, 'strategies') })).toHaveCount(0);
      await expect(page.getByRole('button', { name: s(dict, 'settings') })).toHaveCount(0);
      await expect(page.locator('.kill-bar-button')).toBeVisible();

      // No horizontal page scroll, and the status pill is fully visible.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const pill = page.getByRole('status', { name: s(dict, 'statusPillLabel') });
      await expect(pill).toBeVisible();
      const box = await pill.boundingBox();
      if (box === null) throw new Error('status pill has no bounding box');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);

      await shot(page, `dashboard-mobile-${lang}`);
    });
  }
});
