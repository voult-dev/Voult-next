// Hosted OAuth through the catch-all route: start → (fake) provider → callback → exchange,
// the browser-bound state nonce, and linking/unlinking a provider.
import { expect, test } from '@playwright/test';
import { resetFake, serverSession, settle, signUp } from './helpers.js';

test.beforeEach(({ request }) => resetFake(request));

test('Continue with google signs in and lands on returnTo', async ({ page }) => {
  await page.goto('/login?returnTo=/account');
  await page.getByRole('link', { name: 'Continue with google' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(serverSession(page)).toHaveText('server: google-user@example.com · verified true');
});

test('a callback this browser did not start is rejected (login CSRF)', async ({ page }) => {
  await page.goto('/api/auth/oauth/callback?voult_code=otc_forged&state=attacker');
  await expect(page).toHaveURL(/\/login\?voult_error=INVALID_OAUTH_STATE/);
  await expect(serverSession(page)).toHaveText('server: signed out');
});

test('a provider cancel comes back as voult_error=access_denied', async ({ page }) => {
  // Start the flow, then take the provider's "cancel" path.
  const start = await page.request.get('/api/auth/oauth/github/start', { maxRedirects: 0 });
  const providerUrl = new URL(start.headers().location);
  providerUrl.searchParams.set('deny', '1');
  await page.goto(providerUrl.toString());
  await expect(page).toHaveURL(/\/login\?voult_error=access_denied/);
});

test('link github from the account page, then unlink it', async ({ page }) => {
  await signUp(page);
  await page.getByTestId('linked').getByRole('link', { name: 'Link github' }).click();
  await expect(page).toHaveURL(/\/account\?voult_linked=github$/);
  await settle(page);
  await expect(page.getByTestId('linked-provider')).toHaveText(/github/);

  await page.getByTestId('linked-provider').getByRole('button', { name: 'Unlink' }).click();
  await expect(page.getByText('Unlinked github.')).toBeVisible();
  await expect(page.getByTestId('linked-provider')).toHaveCount(0);
});
