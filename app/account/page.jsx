import { requireSession } from '@voult/next';
import AccountPanel from './panel';

export const dynamic = 'force-dynamic';

// C4: requireSession(). Signed out → /login?returnTo=/account. Access token expired in this
// Server Component → /api/auth/session/renew?returnTo=/account, which renews and comes back.
export default async function Account() {
  const { user, verified } = await requireSession();
  return (
    <main>
      <h1>Account</h1>
      <p data-testid="account-user">Server-rendered for <b>{user.email}</b> (verified {String(verified)})</p>
      <AccountPanel />
    </main>
  );
}
