// The heart of @voult/next: access tokens expire (15 min in Voult) and every refresh ROTATES the
// refresh token, with reuse detection. Server Components can't write cookies, so they must never
// refresh; route handlers and server actions must refresh AND save. The fake counts refreshes and
// reuse detections, so each test proves both "renewed" and "never tripped reuse detection".
import { expect, test } from '@playwright/test';
import { expireAccessTokens, fakeState, resetFake, serverSession, signUp } from './helpers.js';

test.beforeEach(({ request }) => resetFake(request));

test('Server Component with an expired access token: verified false, and it does NOT refresh', async ({ page, request }) => {
  const email = await signUp(page);
  await expireAccessTokens(request);

  await page.goto('/');
  await expect(serverSession(page)).toHaveText(`server: ${email} · verified false`);
  const { events } = await fakeState(request);
  expect(events.refreshes).toBe(0);
  expect(events.reuseDetected).toBe(0);
});

test('requireSession() on an expired token bounces through /session/renew and comes back verified', async ({ page, request }) => {
  const email = await signUp(page);
  await expireAccessTokens(request);

  const hops = [];
  page.on('response', (res) => { if (res.request().isNavigationRequest()) hops.push(new URL(res.url()).pathname); });
  await page.goto('/account');

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByTestId('account-user')).toContainText(`${email}`);
  await expect(page.getByTestId('account-user')).toContainText('verified true');
  expect(hops).toContain('/api/auth/session/renew');

  let { events } = await fakeState(request);
  expect(events.refreshes).toBe(1);
  expect(events.reuseDetected).toBe(0);

  // The rotated cookies were saved: the next render is verified with no further refresh.
  await page.reload();
  await expect(serverSession(page)).toHaveText(`server: ${email} · verified true`);
  ({ events } = await fakeState(request));
  expect(events.refreshes).toBe(1);
  expect(events.reuseDetected).toBe(0);
});

test('a route handler renews and saves the rotated cookies (getSession in app/api/whoami)', async ({ page, request }) => {
  const email = await signUp(page);
  await expireAccessTokens(request);

  const res = await page.request.get('/api/whoami'); // shares the browser's cookies, both ways
  expect(await res.json()).toEqual({ email, verified: true });

  await page.goto('/');
  await expect(serverSession(page)).toHaveText(`server: ${email} · verified true`);
  const { events } = await fakeState(request);
  expect(events.refreshes).toBe(1);
  expect(events.reuseDetected).toBe(0);
});

test('a server action renews and saves the rotated cookies', async ({ page, request }) => {
  const email = await signUp(page);
  await expireAccessTokens(request);

  await page.getByRole('button', { name: 'Ask a server action' }).click();
  await expect(page.getByTestId('server-check-result')).toHaveText(`server action: ${email} · verified true`);

  await page.goto('/');
  await expect(serverSession(page)).toHaveText(`server: ${email} · verified true`);
  const { events } = await fakeState(request);
  expect(events.refreshes).toBe(1);
  expect(events.reuseDetected).toBe(0);
});

test('client components keep working after expiry (the router refreshes through the SDK, safely)', async ({ page, request }) => {
  await signUp(page);
  await expireAccessTokens(request);
  await page.getByRole('button', { name: 'Ask a route handler' }).click();
  await expect(page.getByTestId('server-check-result')).toContainText('verified true');
  await page.reload(); // the panel's sessions/MFA/passkeys calls run against the renewed session
  await expect(page.getByTestId('mfa-state')).toHaveText('off');
  await expect(page.getByTestId('session')).toHaveCount(1);
  expect((await fakeState(request)).events.reuseDetected).toBe(0);
});

test('a dead refresh token: requireSession ends at the sign-in page with SESSION_EXPIRED, cookies cleared', async ({ page, request, context }) => {
  await signUp(page);
  await resetFake(request); // Voult forgets every session

  await page.goto('/account');
  await expect(page).toHaveURL(/\/login\?voult_error=SESSION_EXPIRED/);
  await expect(page.locator('p.err')).toContainText('SESSION_EXPIRED');
  await expect(serverSession(page)).toHaveText('server: signed out');
  expect((await context.cookies()).map((c) => c.name)).not.toContain('voult_refresh');
});

// Was a Voult API bug until 1.3.0 (README "Findings" #4): parallel refreshes with one token
// counted as reuse and revoked the session. Now they share the same successor.
test('parallel requests after expiry keep the user signed in', async ({ page, request }) => {
  await signUp(page);
  await expireAccessTokens(request);
  const statuses = await page.evaluate(() => Promise.all(
    ['/api/auth/sessions', '/api/auth/mfa/status', '/api/auth/passkeys'].map((p) => fetch(p).then((r) => r.status))
  ));
  expect(statuses).toEqual([200, 200, 200]);
  expect((await fakeState(request)).events.reuseDetected).toBe(0);
});
