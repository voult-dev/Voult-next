import { expect } from '@playwright/test';

export const FAKE = 'http://127.0.0.1:4100';
export const PASSWORD = 'StrongPass123!';
export const MFA_CODE = '123456';

let n = 0;
export const uniqueEmail = (tag = 'user') => `${tag}-${Date.now()}-${n++}@example.com`;

export async function resetFake(request) {
  await request.post(`${FAKE}/__test/reset`);
}
export const fakeState = async (request) => (await request.get(`${FAKE}/__test/state`)).json();
export const expireAccessTokens = (request) => request.post(`${FAKE}/__test/expire-access`);
export const lastMagicLink = async (request) => (await (await request.get(`${FAKE}/__test/last-magic-link`)).json()).url;

/** The layout's server-rendered line: what getSession() saw in a Server Component. */
export const serverSession = (page) => page.getByTestId('server-session');

export async function signUp(page, email = uniqueEmail()) {
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('E2E User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByTestId('account-user')).toContainText(email);
  await settle(page);
  return email;
}

/**
 * Wait until the page's own auth calls are done. The router re-sends the session cookies on
 * every authenticated response, so a test that edits cookies or expires tokens must not race them.
 */
export async function settle(page) {
  await page.waitForLoadState('networkidle');
}

/** The app's own error line (Next also renders an empty role=alert route announcer). */
export const appError = (page) => page.locator('p.err');

export async function signInWithPassword(page, email, { from = '/login' } = {}) {
  if (from) await page.goto(from);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

export async function signOut(page) {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(serverSession(page)).toHaveText('server: signed out');
}
