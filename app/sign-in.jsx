'use client';
import { useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { OAuthButton, useOAuthProviders, useSession, useVoult } from '@voult/react';

// @voult/react, unchanged, in App Router client components (C6).
export default function SignIn({ returnTo = '/account' }) {
  const { status } = useSession();
  const { signIn, verifyMfa, mfa, magicLink, passkeys } = useVoult();
  const { providers } = useOAuthProviders();
  const [message, setMessage] = useState(null);

  // A full navigation: Next's router cache may hold pages prefetched while signed out (the proxy's redirect).
  const done = () => window.location.assign(returnTo);
  const run = (fn) => async (event) => {
    event?.preventDefault?.();
    setMessage(null);
    try {
      const form = event?.currentTarget instanceof HTMLFormElement ? Object.fromEntries(new FormData(event.currentTarget)) : {};
      const text = await fn(form);
      if (text) setMessage({ ok: true, text });
    } catch (err) {
      setMessage({ ok: false, text: `${err.code ?? 'ERROR'}: ${err.message}` });
    }
  };
  const note = message && <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'ok' : 'err'}>{message.text}</p>;

  if (status === 'mfa_required') {
    return (
      <section>
        <h2>Two-factor code</h2>
        <form onSubmit={run(async ({ code }) => { await verifyMfa(code); done(); })}>
          <input name="code" aria-label="MFA code" inputMode="numeric" autoComplete="one-time-code" required />
          <button>Verify</button>
          <button type="button" onClick={run(async () => { await mfa.cancel(); return 'Sign-in cancelled.'; })}>Cancel</button>
        </form>
        {note}
      </section>
    );
  }

  return (
    <>
      <section>
        <h2>Password</h2>
        <form onSubmit={run(async ({ email, password }) => { const r = await signIn({ email, password }); if (!r.mfaRequired) done(); })}>
          <input name="email" type="email" aria-label="Email" placeholder="Email" autoComplete="email" required />
          <input name="password" type="password" aria-label="Password" placeholder="Password" autoComplete="current-password" required />
          <button>Sign in</button>
        </form>
      </section>
      <section>
        <h2>Google / GitHub</h2>
        {providers.map((p) => (
          <OAuthButton key={p} provider={p} returnTo={returnTo} style={{ marginRight: 16 }}>Continue with {p}</OAuthButton>
        ))}
      </section>
      <section>
        <h2>Magic link</h2>
        <form onSubmit={run(async ({ email }) => { await magicLink.send(email, { returnTo }); return 'Check your email for a sign-in link.'; })}>
          <input name="email" type="email" aria-label="Magic link email" placeholder="Email" required />
          <button>Email me a link</button>
        </form>
      </section>
      <section>
        <h2>Passkey</h2>
        <button onClick={run(async () => {
          const { options } = await passkeys.loginOptions();
          const credential = await startAuthentication({ optionsJSON: options });
          const r = await passkeys.signIn(credential);
          if (!r.mfaRequired) done();
        })}>Sign in with a passkey</button>
      </section>
      {note}
    </>
  );
}
