import { defineConfig } from '@playwright/test';

// The bundled Chromium cannot be downloaded in this environment, so tests run
// against the installed Microsoft Edge via `channel: 'msedge'`, selected with
// the PW_CHANNEL env var. Unset (CI) = Playwright's own Chromium.
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/results',
  fullyParallel: true,
  webServer: {
    command: 'pnpm exec vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://localhost:5199',
    channel: process.env.PW_CHANNEL || undefined,
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: 'desktop' }],
});
