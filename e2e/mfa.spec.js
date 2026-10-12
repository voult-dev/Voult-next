// MFA through the router + @voult/react helpers: setup, enable, the sign-in challenge, cancel,
// backup codes, disable.
import { expect, test } from '@playwright/test';
import { MFA_CODE, appError, resetFake, serverSession, settle, signInWithPassword, signOut, signUp } from './helpers.js';

test.beforeEach(({ request }) => resetFake(request));

async function enableMfa(page) {
  const section = page.getByTestId('mfa');
  await section.getByRole('button', { name: 'Set up MFA' }).click();
  await expect(page.getByTestId('mfa-secret')).toHaveText('JBSWY3DPEHPK3PXP');
  await expect(page.getByAltText('MFA QR code')).toBeVisible();
  const backupCodes = (await page.getByTestId('setup-backup-codes').textContent()).split('\n');
  await page.getByLabel('Code to enable MFA').fill(MFA_CODE);
  await section.getByRole('button', { name: 'Enable MFA' }).click();
  await expect(page.getByTestId('mfa-state')).toHaveText('on');
  return backupCodes;
}

test('enable MFA → the next sign-in asks for the code → verified and back on /account', async ({ page }) => {
  const email = await signUp(page);
  await enableMfa(page);
  await signOut(page);

  await signInWithPassword(page, email);
  await expect(page.getByRole('heading', { name: 'Two-factor code' })).toBeVisible();
  await expect(serverSession(page)).toHaveText('server: signed out'); // nothing issued before the code
  await page.getByLabel('MFA code').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(appError(page)).toBeVisible();
  await page.getByLabel('MFA code').fill(MFA_CODE);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(serverSession(page)).toHaveText(`server: ${email} · verified true`);
});

test('cancel at the code prompt drops the pending sign-in', async ({ page }) => {
  const email = await signUp(page);
  await enableMfa(page);
  await signOut(page);
  await signInWithPassword(page, email);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Sign-in cancelled.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Password' })).toBeVisible(); // not the code prompt
  expect((await (await page.request.get('/api/auth/session')).json()).mfaPending).toBeUndefined();
});

test('a backup code signs in once; new codes replace the old ones; then disable', async ({ page }) => {
  const email = await signUp(page);
  const [firstBackup] = await enableMfa(page);
  await signOut(page);

  await signInWithPassword(page, email);
  await page.getByLabel('MFA code').fill(firstBackup);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await settle(page);

  await page.getByLabel('Code for backup codes').fill(MFA_CODE);
  await page.getByRole('button', { name: 'New backup codes' }).click();
  await expect(page.getByTestId('backup-codes')).toBeVisible();

  await page.getByLabel('Password for MFA').fill('StrongPass123!');
  await page.getByLabel('Code to disable MFA').fill(MFA_CODE);
  await page.getByRole('button', { name: 'Disable MFA' }).click();
  await expect(page.getByTestId('mfa-state')).toHaveText('off');
});
