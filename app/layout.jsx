import Link from 'next/link';
import { getSession } from '@voult/next';
import Providers from './providers';
import './globals.css';

export const metadata = { title: 'Voult Next E2E' };
export const dynamic = 'force-dynamic';

// C4: getSession() in a Server Component. It never renews here (it couldn't save the rotated
// refresh token); after the access token expires it reports verified: false.
export default async function RootLayout({ children }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/">Home</Link>
          <Link href="/account">Account</Link>
          {!session && <Link href="/login">Sign in</Link>}
          {!session && <Link href="/signup">Sign up</Link>}
          <span className="who" data-testid="server-session">
            {session ? `server: ${session.user.email} · verified ${session.verified}` : 'server: signed out'}
          </span>
        </nav>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
