import { expect, test } from '@playwright/test';
import { en } from '../src/i18n/en';
import { en as securityEn } from '../src/i18n/extra-security';
import { mockApi, setLang, shot } from './support';

const URI = 'otpauth://totp/Cane:owner%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Cane';

test('TOTP re-setup shows a scannable QR code', async ({ page }) => {
  await setLang(page, 'en');
  await mockApi(page, { signedIn: true });
  // Registered after mockApi, so it takes precedence for this one path.
  await page.route('**/v1/auth/totp/setup', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ secret: 'JBSWY3DPEHPK3PXP', uri: URI }) }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: en.settings ?? '' }).click();
  await page.locator('nav.settings-subnav').getByRole('button', { name: en.security ?? '' }).click();
  await page.getByRole('button', { name: securityEn.setupAuthenticator ?? '' }).click();
  await page.getByLabel(en.totpTitle ?? '').fill('123456');
  await page.getByRole('dialog').getByRole('button', { name: en.save ?? '' }).click();

  const qr = page.getByRole('img', { name: securityEn.totpQrLabel ?? '' });
  await expect(qr).toBeVisible();
  const box = await qr.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(150);
  await shot(page, 'security-totp-qr-en');
});
