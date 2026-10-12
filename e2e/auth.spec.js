// Route handlers (C3), requireSession + the proxy guard (C4, C5), and @voult/react in client components (C6).
import { expect, test } from '@playwright/test';
import { PASSWORD, appError, resetFake, serverSession, signInWithPassword, signOut, signUp } from './helpers.js';

test.beforeEach(({ request }) => resetFake(request));

test('the proxy sends signed-out visitors to /login, remembering where they were going', async ({ page }) => {
  await page.goto('/account');
  await expect(page).toHaveURL('/login?returnTo=%2Faccount');
  await expect(page.getByTestId('return-to')).toContainText('/account');
  await expect(serverSession(page)).toHaveText('server: signed out');
});

test('sign up → signed in everywhere: server layout, protected page, httpOnly signed cookies', async ({ page, context }) => {
  const email = await signUp(page);
  await expect(serverSession(page)).toHaveText(`server: ${email} · verified true`);
  await expect(page.getByTestId('account-user')).toContainText('verified true');

  const cookies = Object.fromEntries((await context.cookies()).map((c) => [c.name, c]));
  for (const name of ['voult_access', 'voult_refresh', 'voult_user']) {
    expect(cookies[name], name).toBeTruthy();
    expect(cookies[name].httpOnly, `${name} httpOnly`).toBe(true);
    expect(cookies[name].sameSite).toBe('Lax');
    expect(decodeURIComponent(cookies[name].value).startsWith('s:'), `${name} signed`).toBe(true);
  }
});

test('password sign-in returns to the page the proxy remembered', async ({ page }) => {
  const email = await signUp(page);
  await signOut(page);
  await page.goto('/account');
  await signInWithPassword(page, email, { from: null });
  await expect(page).toHaveURL(/\/account$/);
  await expect(serverSession(page)).toHaveText(`server: ${email} · verified true`);
});

test('wrong password shows the router error, and stays signed out', async ({ page }) => {
  const email = await signUp(page);
  await signOut(page);
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Wrong-Pass1!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // The router returns the SDK's error code (AUTHENTICATION_ERROR), not the API's INVALID_CREDENTIALS: see README findings.
  await expect(appError(page)).toContainText('Invalid email or password');
  await expect(serverSession(page)).toHaveText('server: signed out');
});

test('sign out clears the session: the protected page redirects again', async ({ page, context }) => {
  await signUp(page);
  await signOut(page);
  expect((await context.cookies()).map((c) => c.name)).not.toContain('voult_access');
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test('a tampered session cookie is not a session (proxy and getSession both refuse it)', async ({ page, context }) => {
  await signUp(page);
  const cookies = await context.cookies();
  await context.clearCookies();
  await context.addCookies(cookies.map((c) => (c.name.startsWith('voult_') ? { ...c, value: c.value.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')) } : c)));
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await expect(serverSession(page)).toHaveText('server: signed out');
});

test('the catch-all route serves the router API directly', async ({ request }) => {
  expect(await (await request.get('/api/auth/session')).json()).toEqual({ authenticated: false, user: null });
  expect((await (await request.get('/api/auth/oauth/providers')).json()).providers).toMatchObject({ google: true, github: true, facebook: false });
  expect((await request.get('/api/auth/sessions')).status()).toBe(401);
  expect((await request.get('/api/auth/no-such-route')).status()).toBe(404);
});

test('creating an account with a taken email shows USER_EXISTS', async ({ page, browser }) => {
  const email = await signUp(page);
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto('/signup');
  await other.getByLabel('Full name').fill('Dup');
  await other.getByLabel('Email').fill(email);
  await other.getByLabel('Password').fill(PASSWORD);
  await other.getByRole('button', { name: 'Create account' }).click();
  await expect(appError(other)).toContainText('already exists');
  await context.close();
});
