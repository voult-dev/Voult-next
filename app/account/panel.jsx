'use client';
import { useCallback, useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { OAuthButton, getOAuthRedirectResult, useVoult } from '@voult/react';
import { whoAmI } from '../actions';

function useAction() {
  const [message, setMessage] = useState(null);
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
  return [run, note];
}

function Mfa() {
  const { mfa } = useVoult();
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [run, note] = useAction();
  const load = useCallback(() => mfa.status().then(setStatus), [mfa]);
  useEffect(() => { load(); }, [load]);
  if (!status) return null;

  return (
    <section data-testid="mfa">
      <h2>Two-factor authentication: <span data-testid="mfa-state">{status.mfaEnabled ? 'on' : 'off'}</span></h2>
      {status.mfaEnabled ? (
        <>
          <form onSubmit={run(async ({ code, password }) => { await mfa.disable({ code, password }); await load(); return 'MFA disabled.'; })}>
            <input name="password" type="password" aria-label="Password for MFA" placeholder="Password (if any)" />
            <input name="code" aria-label="Code to disable MFA" placeholder="Current code" required />
            <button>Disable MFA</button>
          </form>
          <form onSubmit={run(async ({ code }) => { setCodes((await mfa.regenerateBackupCodes(code)).backupCodes); return 'New backup codes.'; })}>
            <input name="code" aria-label="Code for backup codes" placeholder="Current code" required />
            <button>New backup codes</button>
          </form>
          {codes && <pre data-testid="backup-codes">{codes.join('\n')}</pre>}
        </>
      ) : setup ? (
        <>
          <p>Secret: <code data-testid="mfa-secret">{setup.secret}</code></p>
          <img src={setup.qrCode} alt="MFA QR code" width="160" height="160" />
          <pre data-testid="setup-backup-codes">{setup.backupCodes.join('\n')}</pre>
          <form onSubmit={run(async ({ code }) => { await mfa.enable(code); setSetup(null); await load(); return 'MFA enabled.'; })}>
            <input name="code" aria-label="Code to enable MFA" placeholder="6-digit code" required />
            <button>Enable MFA</button>
          </form>
        </>
      ) : (
        <button onClick={run(async () => { setSetup(await mfa.setup()); })}>Set up MFA</button>
      )}
      {note}
    </section>
  );
}

function Passkeys() {
  const { passkeys } = useVoult();
  const [list, setList] = useState([]);
  const [run, note] = useAction();
  const load = useCallback(() => passkeys.list().then((d) => setList(d.credentials ?? [])), [passkeys]);
  useEffect(() => { load(); }, [load]);

  return (
    <section data-testid="passkeys">
      <h2>Passkeys</h2>
      <form onSubmit={run(async ({ deviceName }) => {
        const { options } = await passkeys.registrationOptions(deviceName);
        const credential = await startRegistration({ optionsJSON: options });
        await passkeys.register(credential, deviceName);
        await load();
        return 'Passkey added.';
      })}>
        <input name="deviceName" aria-label="Passkey name" placeholder="Name, e.g. MacBook" defaultValue="Test device" />
        <button>Add a passkey</button>
      </form>
      <ul>
        {list.map((p) => (
          <li key={p.id} data-testid="passkey">
            <span>{p.deviceName}</span>{' '}
            <button onClick={run(async () => { await passkeys.rename(p.id, `${p.deviceName} (renamed)`); await load(); return 'Renamed.'; })}>Rename</button>{' '}
            <button onClick={run(async () => { await passkeys.remove(p.id); await load(); return 'Removed.'; })}>Remove</button>
          </li>
        ))}
      </ul>
      {note}
    </section>
  );
}

function Sessions() {
  const { sessions } = useVoult();
  const [list, setList] = useState([]);
  const [run, note] = useAction();
  const load = useCallback(() => sessions.list().then((d) => setList(d.sessions)), [sessions]);
  useEffect(() => { load(); }, [load]);

  return (
    <section data-testid="sessions">
      <h2>Sessions</h2>
      <ul>
        {list.map((s) => (
          <li key={s.id} data-testid="session" data-current={String(Boolean(s.isCurrent))}>
            {s.isCurrent ? 'This browser' : 'Another browser'}{' '}
            <button onClick={run(async () => {
              const { current } = await sessions.revoke(s.id);
              if (current) { window.location.assign('/login'); return null; }
              await load();
              return 'Session revoked.';
            })}>Revoke</button>
          </li>
        ))}
      </ul>
      {note}
    </section>
  );
}

function LinkedAccounts() {
  const { linkedAccounts } = useVoult();
  const [linked, setLinked] = useState([]);
  const [run, note] = useAction();
  const load = useCallback(() => linkedAccounts.list().then((d) => setLinked(d.providers.map((p) => (typeof p === 'string' ? p : p.provider)))), [linkedAccounts]);
  useEffect(() => { load(); }, [load]);
  const redirect = getOAuthRedirectResult();

  return (
    <section data-testid="linked">
      <h2>Linked accounts</h2>
      {redirect.linked && <p className="ok">Linked {redirect.linked}.</p>}
      <ul>
        {linked.map((p) => (
          <li key={p} data-testid="linked-provider">
            {p} <button onClick={run(async () => { await linkedAccounts.unlink(p); await load(); return `Unlinked ${p}.`; })}>Unlink</button>
          </li>
        ))}
      </ul>
      {['google', 'github'].filter((p) => !linked.includes(p)).map((p) => (
        <OAuthButton key={p} provider={p} intent="link" returnTo="/account" style={{ marginRight: 16 }}>Link {p}</OAuthButton>
      ))}
      {note}
    </section>
  );
}

function ServerChecks() {
  const [result, setResult] = useState(null);
  return (
    <section data-testid="server-checks">
      <h2>getSession() outside Server Components</h2>
      <button onClick={async () => setResult({ via: 'server action', ...(await whoAmI()) })}>Ask a server action</button>{' '}
      <button onClick={async () => setResult({ via: 'route handler', ...(await (await fetch('/api/whoami')).json()) })}>Ask a route handler</button>
      {result && <p data-testid="server-check-result">{result.via}: {result.email ?? 'signed out'} · verified {String(result.verified)}</p>}
    </section>
  );
}

function Danger() {
  const { signOut, deleteAccount } = useVoult();
  const leave = () => window.location.assign('/');
  return (
    <section>
      <h2>Session</h2>
      <button onClick={async () => { await signOut(); leave(); }}>Sign out</button>{' '}
      <button onClick={async () => { if (window.confirm('Disable your account?')) { await deleteAccount(); leave(); } }}>Delete account</button>
    </section>
  );
}

export default function AccountPanel() {
  return (<><Mfa /><Passkeys /><Sessions /><LinkedAccounts /><ServerChecks /><Danger /></>);
}
