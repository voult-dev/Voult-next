// DELETE /user/me: Voult disables the account and this browser is signed out.
import { expect, test } from '@playwright/test';
import { appError, resetFake, serverSession, signInWithPassword, signUp } from './helpers.js';

test.beforeEach(({ request }) => resetFake(request));

test('delete account signs out, and the account can no longer sign in', async ({ page }) => {
  const email = await signUp(page);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL('http://localhost:3100/');
  await expect(serverSession(page)).toHaveText('server: signed out');

  await signInWithPassword(page, email);
  await expect(appError(page)).toContainText('disabled');
});
