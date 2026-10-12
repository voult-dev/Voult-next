// Magic links: POST /magic-link answers the same for unknown emails; the emailed link opens
// /api/auth/magic-link/verify on this app (same origin as the allowlisted callback), which
// signs in and redirects to returnTo, or to /mfa for MFA users.
import { expect, test } from '@playwright/test';
import { MFA_CODE, lastMagicLink, resetFake, serverSession, settle, signOut, signUp, uniqueEmail } from './helpers.js';

test.beforeEach(({ request }) => resetFake(request));

async function requestLink(page, email) {
  await page.goto('/login?returnTo=/account');
  await page.getByLabel('Magic link email').fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByText('Check your email for a sign-in link.')).toBeVisible();
}

test('the link signs in and returns to returnTo', async ({ page, request }) => {
  const email = await signUp(page);
  await signOut(page);
  await requestLink(page, email);

  const link = new URL(await lastMagicLink(request));
  expect(link.origin).toBe('http://localhost:3100');
  expect(link.pathname).toBe('/api/auth/magic-link/verify');
  expect(link.searchParams.get('returnTo')).toBe('/account');

  await page.goto(link.toString());
  await expect(page).toHaveURL(/\/account$/);
  await expect(serverSession(page)).toHaveText(`server: ${email} · verified true`);
});

test('an unknown email gets the same answer (no account probing)', async ({ page }) => {
  await requestLink(page, uniqueEmail('nobody'));
});

test('a used link goes to the error page', async ({ page, request }) => {
  const email = await signUp(page);
  await signOut(page);
  await requestLink(page, email);
  const link = await lastMagicLink(request);
  await page.goto(link);
  await signOut(page);
  await page.goto(link);
  await expect(page).toHaveURL(/\/login\?voult_error=/);
});

test('an MFA user is sent to /mfa and finishes with the code', async ({ page, request }) => {
  const email = await signUp(page);
  await page.getByTestId('mfa').getByRole('button', { name: 'Set up MFA' }).click();
  await page.getByLabel('Code to enable MFA').fill(MFA_CODE);
  await page.getByRole('button', { name: 'Enable MFA' }).click();
  await expect(page.getByTestId('mfa-state')).toHaveText('on');
  await signOut(page);

  await requestLink(page, email);
  await page.goto(await lastMagicLink(request));
  await expect(page).toHaveURL(/\/mfa$/);
  await expect(serverSession(page)).toHaveText('server: signed out');
  await page.getByLabel('MFA code').fill(MFA_CODE);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await settle(page);
  await expect(serverSession(page)).toHaveText(`server: ${email} · verified true`);
});
