import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/en.js';
import { th } from '../src/i18n/th.js';
import { extraEn, extraTh } from '../src/i18n/extra.js';
import { BASE, mockApi, setLang, shot, trackRequests } from './support.js';

/**
 * S10 web smoke tests. Every /v1 call is mocked (see support.ts), so the only
 * thing under test is the app: its copy, its requests (all same-origin) and
 * its fonts. Each test runs for both languages.
 */

type Lang = 'en' | 'th';
const LANGS: Lang[] = ['en', 'th'];

// The app's dictionaries are pure data modules, so the test can read the
// exact visible copy from them instead of re-typing it.
const DICTS: Record<Lang, Record<string, string>> = {
  en: { ...en, ...extraEn },
  th: { ...th, ...extraTh },
};

const EMAIL = 'owner@cane.test';
const PASSWORD = 'cane';
const CODE = '123456';

// Settings sub-nav, in order. `id` names the screenshot, `key` the i18n label.
const TABS: { id: string; key: string }[] = [
  { id: 'keys', key: 'exKeys' },
  { id: 'notif', key: 'notif' },
  { id: 'trading', key: 'trading' },
  { id: 'security', key: 'security' },
];

/** Fill credentials, advance to the TOTP step and submit the code. Returns the login request. */
async function completeLogin(page: Page, dict: Record<string, string>) {
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-password').fill(PASSWORD);
  await page.getByRole('button', { name: dict.continue ?? '' }).click();

  const codeInput = page.getByLabel(dict.totpTitle ?? '');
  await codeInput.waitFor({ state: 'visible' });
  await codeInput.fill(CODE);

  const loginReq = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/v1/auth/login'));
  await page.getByRole('button', { name: dict.verify ?? '' }).click();
  return loginReq;
}

/** Click through the Settings sub-nav in order, screenshotting each tab. */
async function visitSettingsTabs(page: Page, dict: Record<string, string>, lang: Lang) {
  for (const tab of TABS) {
    if (tab.id !== 'keys') {
      await page.locator('nav.settings-subnav').getByRole('button', { name: dict[tab.key] }).click();
    }
    await shot(page, `settings-${tab.id}-${lang}`);
  }
}

function assertSameOriginOnly(origins: string[]) {
  for (const origin of origins) {
    expect(origin, `request to non-localhost origin: ${origin}`).toBe(BASE);
  }
}

for (const lang of LANGS) {
  const dict = DICTS[lang];

  test(`login flow (${lang})`, async ({ page }) => {
    const getOrigins = trackRequests(page);
    await setLang(page, lang);
    await mockApi(page, { signedIn: false });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: dict.loginTitle })).toBeVisible();
    await shot(page, `login-${lang}`);

    const req = await completeLogin(page, dict);
    const body = (await req).postDataJSON();
    expect(body.email).toBe(EMAIL);
    expect(body.password).toBe(PASSWORD);
    expect(body.code).toBe(CODE);

    assertSameOriginOnly(getOrigins());
  });

  test(`settings tabs (${lang})`, async ({ page }) => {
    await setLang(page, lang);
    await mockApi(page, { signedIn: true });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: dict.settings, level: 1 })).toBeVisible();

    // Exchange keys is the default tab: the masked hint is shown, the secret is not.
    await expect(page.getByText('•••• 4F2A', { exact: true })).toBeVisible();
    expect(await page.content()).not.toContain('9Z9Z');

    await visitSettingsTabs(page, dict, lang);
  });

  test(`network: same origin only, self-hosted fonts (${lang})`, async ({ page }) => {
    const getOrigins = trackRequests(page);
    await setLang(page, lang);
    await mockApi(page, { signedIn: false });
    await page.goto('/');

    // (a) the login flow
    await expect(page.getByRole('heading', { name: dict.loginTitle })).toBeVisible();
    await (await completeLogin(page, dict));

    // (b) the settings flow, exercising every tab so all fonts are requested
    await expect(page.getByRole('heading', { name: dict.settings, level: 1 })).toBeVisible();
    await visitSettingsTabs(page, dict, lang);

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

  test(`theme toggle (${lang})`, async ({ page }) => {
    await setLang(page, lang);
    await mockApi(page, { signedIn: true });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: dict.settings, level: 1 })).toBeVisible();

    const toggle = page.getByRole('button', { name: dict.theme });
    const hasLight = () => page.evaluate(() => document.documentElement.classList.contains('light'));

    expect(await hasLight()).toBe(false);
    await toggle.click();
    expect(await hasLight()).toBe(true);
    await toggle.click();
    expect(await hasLight()).toBe(false);
  });
}
