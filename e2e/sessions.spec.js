// Sessions: the list marks this browser (isCurrent, via the refresh token the server holds),
// revoking another browser signs it out, revoking your own signs you out.
import { expect, test } from '@playwright/test';
import { fakeState, resetFake, serverSession, settle, signInWithPassword, signUp } from './helpers.js';

let otherContext;
test.beforeEach(({ request }) => resetFake(request));
test.afterEach(async () => { await otherContext?.close(); otherContext = undefined; });

async function twoBrowsers(browser, page) {
  const email = await signUp(page);
  otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signInWithPassword(other, email);
  await expect(other).toHaveURL(/\/account$/);
  await settle(other);
  await page.reload();
  await settle(page);
  return { email, other };
}

test('the list shows both browsers, this one marked current', async ({ browser, page }) => {
  await twoBrowsers(browser, page);
  await expect(page.getByTestId('session')).toHaveCount(2);
  await expect(page.locator('[data-testid="session"][data-current="true"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="session"][data-current="true"]')).toContainText('This browser');
});

test('revoking my own session signs this browser out', async ({ browser, page }) => {
  await twoBrowsers(browser, page);
  await page.locator('[data-testid="session"][data-current="true"]').getByRole('button', { name: 'Revoke' }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(serverSession(page)).toHaveText('server: signed out');
});

test('revoking the other browser signs it out', async ({ browser, page }) => {
  const { other } = await twoBrowsers(browser, page);
  await page.locator('[data-testid="session"][data-current="false"]').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Session revoked.')).toBeVisible();
  await expect(page.getByTestId('session')).toHaveCount(1);

  await other.goto('/account');
  await expect(other).toHaveURL(/\/login/);
});

// Was a Voult API bug until 1.3.0 (README "Findings" #5): a revoked (not rotated) refresh token
// triggered reuse detection, so the revoking browser was signed out too.
test('after revoking another browser, that browser coming back does not sign me out', async ({ browser, page, request }) => {
  const { email, other } = await twoBrowsers(browser, page);
  await page.locator('[data-testid="session"][data-current="false"]').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByTestId('session')).toHaveCount(1);

  await request.post('http://127.0.0.1:4100/__test/expire-access'); // both browsers must refresh now
  await other.request.get('/api/whoami'); // the revoked browser tries (and is refused)
  expect((await fakeState(request)).events.reuseDetected).toBe(0);
  expect(await (await page.request.get('/api/whoami')).json()).toEqual({ email, verified: true });
});
