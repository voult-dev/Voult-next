import { defineConfig, devices } from '@playwright/test';

// The fake Voult and the production build of the app, started for the run. The VOULT_* values
// are passed as real env vars, which beat .env files, so a .env.local pointing at staging can
// never leak into the suite.
const fake = {
  VOULT_BASE_URL: 'http://127.0.0.1:4100',
  VOULT_CLIENT_ID: 'e2e-client',
  VOULT_CLIENT_SECRET: 'e2e-secret',
  VOULT_SESSION_SECRET: 'e2e-session-secret-0123456789abcdef0123456789',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // one fake Voult, reset before each test
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node fake-voult/server.mjs',
      url: 'http://127.0.0.1:4100/api/meta',
      env: { ...fake, FAKE_VOULT_PORT: '4100', FAKE_VOULT_CALLBACK: 'http://localhost:3100/api/auth/oauth/callback' },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npx next build && npx next start -p 3100',
      url: 'http://localhost:3100/',
      env: { ...fake, NEXT_TELEMETRY_DISABLED: '1' },
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
