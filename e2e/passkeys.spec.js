// Passkeys with a real WebAuthn ceremony: Chromium's virtual authenticator creates and uses the
// credential; @simplewebauthn/browser drives navigator.credentials; the router relays to Voult.
import { expect, test } from '@playwright/test';
import { resetFake, serverSession, settle, signOut, signUp } from './helpers.js';

test.beforeEach(async ({ request, page }) => {
  await resetFake(request);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
});

test('add a passkey, sign out, sign back in with it; rename and remove it', async ({ page }) => {
  const email = await signUp(page);
  const passkeys = page.getByTestId('passkeys');

  await passkeys.getByLabel('Passkey name').fill('Laptop');
  await passkeys.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByText('Passkey added.')).toBeVisible();
  await expect(page.getByTestId('passkey')).toHaveCount(1);
  await expect(page.getByTestId('passkey')).toContainText('Laptop');

  await signOut(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(serverSession(page)).toHaveText(`server: ${email} · verified true`);
  await settle(page);

  await page.getByTestId('passkey').getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByTestId('passkey')).toContainText('Laptop (renamed)');
  await page.getByTestId('passkey').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('passkey')).toHaveCount(0);
});
