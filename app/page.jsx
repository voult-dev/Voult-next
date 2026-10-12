import Link from 'next/link';

export default function Home() {
  return (
    <main>
      <h1>@voult/next end-to-end</h1>
      <p>Every Voult feature in a real Next.js App Router app: password, OAuth, magic links, passkeys, MFA, sessions, linked accounts, account deletion, and <code>getSession()</code> in a layout, a route handler and a server action.</p>
      <p><Link href="/login">Sign in</Link> · <Link href="/signup">Create an account</Link> · <Link href="/account">Account (protected)</Link></p>
    </main>
  );
}
