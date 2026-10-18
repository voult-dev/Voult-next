// A stateful stand-in for the Voult API, so the E2E suite is deterministic and offline.
// It behaves like the real API (1.3.0) where @voult/next's correctness depends on it:
//   - refresh tokens ROTATE on every refresh. A rotated token presented again within the grace
//     period returns the same successor (parallel refreshes); later it counts as reuse and revokes
//     every session of the user (REFRESH_TOKEN_REUSE_DETECTED). A token revoked by sign-out or
//     session revocation is simply refused. The suite asserts reuse detection never fires,
//     which is what proves Server Components don't renew.
//   - sessions, MFA (code 123456 or a backup code), magic links (allowlist by origin + MFA),
//     hosted OAuth with a fake provider page, account linking, passkeys, account disabling.
// Test-only hooks live under /__test (reset, expire every access token, read the last magic link).
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.FAKE_VOULT_PORT ?? 4100);
const SELF = `http://127.0.0.1:${PORT}`;
const CLIENT_ID = process.env.VOULT_CLIENT_ID ?? 'e2e-client';
const CLIENT_SECRET = process.env.VOULT_CLIENT_SECRET ?? 'e2e-secret';
// The app's callback URL (allowlist). Magic links may point anywhere on its origin.
const ALLOWED_CALLBACK = process.env.FAKE_VOULT_CALLBACK ?? 'http://localhost:3100/api/auth/oauth/callback';
const MFA_CODE = '123456';
const REUSE_GRACE_MS = Number(process.env.FAKE_VOULT_REUSE_GRACE_SECONDS ?? 30) * 1000;

const id = () => crypto.randomBytes(12).toString('hex');
const token = (prefix) => `${prefix}_${crypto.randomBytes(18).toString('base64url')}`;
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

let db;
function reset() {
  db = {
    users: new Map(), // id → user
    sessions: new Map(), // id → { id, userId, userAgent, createdAt, revoked }
    access: new Map(), // token → { sessionId, expired }
    refresh: new Map(), // token → { sessionId, used, rotatedAt, successor }
    mfaPending: new Map(), // token → userId
    mfaSetup: new Map(), // userId → secret (until enabled)
    magicLinks: new Map(), // token → email
    oauthCodes: new Map(), // code → { email, redirectUri }
    passkeys: new Map(), // credentialId → { id, userId, deviceName, createdAt }
    linked: new Map(), // userId → Set(provider)
    lastMagicLink: null,
    events: { refreshes: 0, reuseDetected: 0, logins: 0 },
  };
}
reset();

const publicUser = (u) => ({ id: u.id, email: u.email, fullName: u.fullName, mfaEnabled: u.mfaEnabled, isEmailVerified: true });
const findByEmail = (email) => [...db.users.values()].find((u) => u.email === String(email).toLowerCase());

function createUser({ email, password = null, fullName = 'E2E User' }) {
  const user = { id: id(), email: String(email).toLowerCase(), password, fullName, mfaEnabled: false, backupCodes: [], disabled: false };
  db.users.set(user.id, user);
  return user;
}

/** A new session: access + refresh token. */
function issue(user, req, sessionId = null) {
  let session = sessionId && db.sessions.get(sessionId);
  if (!session) {
    session = { id: id(), userId: user.id, userAgent: req.headers['user-agent'] ?? 'unknown', createdAt: new Date().toISOString(), revoked: false };
    db.sessions.set(session.id, session);
    db.events.logins += 1;
  }
  const accessToken = token('acc');
  const refreshToken = token('ref');
  db.access.set(accessToken, { sessionId: session.id, expired: false });
  db.refresh.set(refreshToken, { sessionId: session.id, used: false });
  return { accessToken, refreshToken, user: publicUser(user) };
}

function signInOrChallenge(user, req) {
  if (user.mfaEnabled) {
    const pending = token('mfa');
    db.mfaPending.set(pending, user.id);
    return { mfaRequired: true, mfaPendingToken: pending, message: 'MFA verification required' };
  }
  return issue(user, req);
}

function revokeAllFor(userId) {
  for (const s of db.sessions.values()) if (s.userId === userId) s.revoked = true;
}

/** The signed-in user behind `Authorization: Bearer`, or null. */
function authed(req) {
  const header = req.headers.authorization ?? '';
  const entry = header.startsWith('Bearer ') && db.access.get(header.slice(7));
  if (!entry || entry.expired) return null;
  const session = db.sessions.get(entry.sessionId);
  const user = session && !session.revoked && db.users.get(session.userId);
  return user && !user.disabled ? { user, session } : null;
}

function validCode(user, code) {
  const value = String(code ?? '').trim();
  if (value === MFA_CODE) return true;
  const i = user.backupCodes.indexOf(value);
  if (i >= 0) user.backupCodes.splice(i, 1);
  return i >= 0;
}

const newBackupCodes = () => Array.from({ length: 6 }, () => crypto.randomInt(10_000_000, 99_999_999).toString());

function providerPage(provider, params) {
  return `${SELF}/__provider/${provider}?${new URLSearchParams(params)}`;
}

// Like Voult API 1.4: the passkey domain is the page's (the origin @voult/core sends, else the
// app's one allowlisted callback), never Voult's own host. A fake that hard-coded 'localhost'
// is how the real API's RP ID bug went unnoticed.
const rpIdFor = (body) => new URL(body.origin ?? ALLOWED_CALLBACK).hostname;

const sameOrigin = (a, b) => {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
};

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, SELF);
  const path = url.pathname;
  const method = req.method;
  const body = await readBody(req);

  const send = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'X-Voult-API-Version': '1.2.0' });
    res.end(JSON.stringify(payload));
  };
  const fail = (status, code, message) => send(status, { error: { code, message, status } });
  const redirect = (location) => { res.writeHead(302, { Location: location }); res.end(); };
  const route = (m, p) => method === m && (typeof p === 'string' ? path === p : p.exec(path));
  const requireUser = () => {
    const who = authed(req);
    if (!who) fail(401, 'AUTHENTICATION_ERROR', 'Authentication required');
    return who;
  };

  // ── test hooks ──────────────────────────────────────────────────────────────
  if (route('POST', '/__test/reset')) { reset(); return send(200, { ok: true }); }
  if (route('POST', '/__test/expire-access')) {
    for (const entry of db.access.values()) entry.expired = true;
    return send(200, { ok: true });
  }
  if (route('GET', '/__test/state')) {
    return send(200, { events: db.events, sessions: [...db.sessions.values()], users: [...db.users.values()].map(publicUser) });
  }
  if (route('GET', '/__test/last-magic-link')) return send(200, { url: db.lastMagicLink });

  // The fake OAuth provider: "signs in" instantly and sends the browser back to Voult's caller.
  let m;
  if ((m = route('GET', /^\/__provider\/([^/]+)$/))) {
    const provider = m[1];
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    const back = new URL(redirectUri);
    if (url.searchParams.get('deny')) {
      back.searchParams.set('error', 'access_denied');
      back.searchParams.set('error_description', 'User cancelled');
    } else if (url.searchParams.get('link_user')) {
      db.linked.set(url.searchParams.get('link_user'), new Set([...(db.linked.get(url.searchParams.get('link_user')) ?? []), provider]));
      back.searchParams.set('linked', '1');
    } else {
      const code = token('otc');
      db.oauthCodes.set(code, { email: `${provider}-user@example.com`, redirectUri, provider });
      back.searchParams.set('voult_code', code);
    }
    back.searchParams.set('state', state);
    return redirect(back.toString());
  }

  // Every real API call carries the client ID.
  if (req.headers['x-client-id'] !== CLIENT_ID) return fail(401, 'INVALID_CLIENT', 'Invalid or inactive app');

  if (route('GET', '/api/meta')) return send(200, { version: '1.2.0', minSdkVersion: '0.1.3', features: [] });
  if (route('GET', '/api/apps/me')) {
    if (req.headers['x-client-secret'] !== CLIENT_SECRET) return fail(401, 'INVALID_CLIENT_SECRET', 'Invalid client secret');
    return send(200, {
      name: 'E2E App', clientId: CLIENT_ID, allowedCallbackUrls: [ALLOWED_CALLBACK],
      providers: { google: { enabled: true, configured: true }, github: { enabled: true, configured: true }, facebook: { enabled: false, configured: false } },
    });
  }

  // ── password ────────────────────────────────────────────────────────────────
  if (route('POST', '/api/auth/register')) {
    if (!body.email || !body.password) return fail(400, 'VALIDATION_ERROR', 'Email and password are required');
    if (findByEmail(body.email)) return fail(409, 'USER_EXISTS', 'An account with this email already exists');
    const user = createUser(body);
    return send(201, { success: true, ...issue(user, req) });
  }
  if (route('POST', '/api/auth/email-login')) {
    const user = findByEmail(body.email ?? '');
    if (!user || user.password !== body.password) return fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    if (user.disabled) return fail(403, 'ACCOUNT_DISABLED', 'Account is disabled');
    return send(200, signInOrChallenge(user, req));
  }
  if (route('POST', '/api/auth/mfa/verify')) {
    const userId = db.mfaPending.get(body.mfaPendingToken);
    const user = userId && db.users.get(userId);
    if (!user) return fail(401, 'INVALID_MFA_SESSION', 'MFA session expired. Please log in again.');
    if (!validCode(user, body.mfaToken)) return fail(401, 'INVALID_MFA_TOKEN', 'Invalid MFA token');
    db.mfaPending.delete(body.mfaPendingToken);
    return send(200, issue(user, req));
  }
  if (route('POST', '/api/auth/logout')) {
    const who = requireUser(); if (!who) return;
    who.session.revoked = true;
    return send(200, { message: 'Logged out successfully' });
  }

  // ── tokens and sessions ─────────────────────────────────────────────────────
  if (route('POST', '/api/sessions/refresh')) {
    const entry = db.refresh.get(body.refreshToken);
    const session = entry && db.sessions.get(entry.sessionId);
    if (!entry || !session) return fail(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
    if (session.revoked) return fail(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token'); // signed out / revoked
    if (entry.used) {
      if (Date.now() - entry.rotatedAt <= REUSE_GRACE_MS) {
        // A parallel refresh: the same successor, a fresh access token.
        const accessToken = token('acc');
        db.access.set(accessToken, { sessionId: session.id, expired: false });
        db.events.graceRefreshes = (db.events.graceRefreshes ?? 0) + 1;
        return send(200, { accessToken, refreshToken: entry.successor });
      }
      // A rotated token replayed later: the whole session family is compromised.
      db.events.reuseDetected += 1;
      revokeAllFor(session.userId);
      return fail(401, 'REFRESH_TOKEN_REUSE_DETECTED', 'Session compromised. Please log in again.');
    }
    db.events.refreshes += 1;
    const { accessToken, refreshToken } = issue(db.users.get(session.userId), req, session.id);
    Object.assign(entry, { used: true, rotatedAt: Date.now(), successor: refreshToken });
    return send(200, { accessToken, refreshToken });
  }
  if (route('GET', '/api/sessions')) {
    const who = requireUser(); if (!who) return;
    const presented = db.refresh.get(req.headers['x-refresh-token'] ?? '');
    const sessions = [...db.sessions.values()]
      .filter((s) => s.userId === who.user.id && !s.revoked)
      .map((s) => ({ id: s.id, userAgent: s.userAgent, createdAt: s.createdAt, isCurrent: Boolean(presented && presented.sessionId === s.id) }));
    return send(200, { sessions });
  }
  if ((m = route('GET', /^\/api\/sessions\/revoke\/([^/]+)$/))) {
    const who = requireUser(); if (!who) return;
    const session = db.sessions.get(m[1]);
    if (!session || session.userId !== who.user.id || session.revoked) return fail(404, 'SESSION_NOT_FOUND', 'Session not found');
    session.revoked = true;
    return send(200, { message: 'Session revoked successfully' });
  }

  // ── user ────────────────────────────────────────────────────────────────────
  if (route('GET', '/api/user/me')) {
    const who = requireUser(); if (!who) return;
    return send(200, publicUser(who.user));
  }
  if (route('POST', '/api/user/disable')) {
    const who = requireUser(); if (!who) return;
    who.user.disabled = true;
    revokeAllFor(who.user.id);
    return send(200, { success: true, message: 'Account disabled successfully' });
  }
  if (route('POST', '/api/user/forgot-password')) return send(200, { success: true, message: 'If that email exists, a reset link was sent' });

  // ── MFA ─────────────────────────────────────────────────────────────────────
  if (route('GET', '/api/auth/mfa/status')) {
    const who = requireUser(); if (!who) return;
    return send(200, { mfaEnabled: who.user.mfaEnabled, backupCodesRemaining: who.user.backupCodes.length });
  }
  if (route('POST', '/api/auth/mfa/setup')) {
    const who = requireUser(); if (!who) return;
    if (who.user.mfaEnabled) return fail(400, 'MFA_ALREADY_ENABLED', 'MFA is already enabled for this account');
    const secret = 'JBSWY3DPEHPK3PXP';
    db.mfaSetup.set(who.user.id, secret);
    who.user.backupCodes = newBackupCodes();
    const qr = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#eee"/><text x="12" y="85" font-size="14">fake QR</text></svg>')}`;
    return send(200, { message: 'Scan QR code', secret, qrCode: qr, backupCodes: who.user.backupCodes });
  }
  if (route('POST', '/api/auth/mfa/enable')) {
    const who = requireUser(); if (!who) return;
    if (!db.mfaSetup.has(who.user.id)) return fail(400, 'MFA_SETUP_EXPIRED', 'MFA setup session expired. Start setup again.');
    if (String(body.token) !== MFA_CODE) return fail(400, 'INVALID_MFA_TOKEN', 'Invalid MFA token. Try again.');
    who.user.mfaEnabled = true;
    db.mfaSetup.delete(who.user.id);
    return send(200, { message: 'MFA enabled successfully', mfaEnabled: true });
  }
  if (route('POST', '/api/auth/mfa/disable')) {
    const who = requireUser(); if (!who) return;
    if (!who.user.mfaEnabled) return fail(400, 'MFA_NOT_ENABLED', 'MFA is not enabled for this account');
    if (who.user.password && body.password !== who.user.password) return fail(401, 'INVALID_CREDENTIALS', 'Invalid password or MFA token');
    if (!validCode(who.user, body.mfaToken)) return fail(401, 'INVALID_CREDENTIALS', 'Invalid password or MFA token');
    who.user.mfaEnabled = false;
    who.user.backupCodes = [];
    return send(200, { message: 'MFA disabled successfully', mfaEnabled: false });
  }
  if (route('POST', '/api/auth/mfa/backup-codes/regenerate')) {
    const who = requireUser(); if (!who) return;
    if (!validCode(who.user, body.token)) return fail(400, 'INVALID_MFA_TOKEN', 'Invalid MFA token. Try again.');
    who.user.backupCodes = newBackupCodes();
    return send(200, { message: 'Backup codes regenerated', backupCodes: who.user.backupCodes });
  }

  // ── magic links (API 1.2 rules) ─────────────────────────────────────────────
  if (route('POST', '/api/send-magic-link')) {
    if (!body.redirectUri) return fail(400, 'VALIDATION_ERROR', 'redirectUri is required');
    if (!sameOrigin(body.redirectUri, ALLOWED_CALLBACK)) {
      return fail(400, 'INVALID_CALLBACK_URL', 'redirectUri must be an allowlisted callback URL or on the same origin as one');
    }
    const raw = crypto.randomBytes(32).toString('hex');
    db.magicLinks.set(raw, String(body.email).toLowerCase());
    const link = new URL(body.redirectUri);
    link.searchParams.set('token', raw);
    db.lastMagicLink = link.toString(); // "the email"
    return send(200, { success: true, message: 'Magic link sent successfully. Please check your email.' });
  }
  if (route('POST', '/api/validate-magic-link')) {
    const email = db.magicLinks.get(body.token);
    if (!email) return fail(400, 'INVALID_OR_EXPIRED_TOKEN', 'Invalid or expired token');
    db.magicLinks.delete(body.token);
    const user = findByEmail(email);
    if (!user) return fail(404, 'USER_NOT_FOUND', 'No account found with this email. Please register first.');
    const result = signInOrChallenge(user, req);
    return send(200, result.mfaRequired ? result : { success: true, data: result });
  }

  // ── hosted OAuth ────────────────────────────────────────────────────────────
  if ((m = route('POST', /^\/api\/oauth\/([^/]+)\/authorize$/))) {
    if (body.redirectUri !== ALLOWED_CALLBACK) return fail(400, 'INVALID_CALLBACK_URL', 'Callback URL is not allowlisted for this app');
    return send(200, { authUrl: providerPage(m[1], { redirect_uri: body.redirectUri, state: body.state }), provider: m[1], intent: body.intent });
  }
  if ((m = route('POST', /^\/api\/oauth\/([^/]+)\/link$/))) {
    const who = requireUser(); if (!who) return;
    return send(200, { authUrl: providerPage(m[1], { redirect_uri: body.redirectUri, state: body.state, link_user: who.user.id }), intent: 'link' });
  }
  if (route('POST', '/api/oauth/exchange')) {
    const entry = db.oauthCodes.get(body.code);
    if (!entry || entry.redirectUri !== body.redirectUri) return fail(400, 'INVALID_OAUTH_CODE', 'OAuth exchange code is invalid or expired');
    db.oauthCodes.delete(body.code);
    const user = findByEmail(entry.email) ?? createUser({ email: entry.email, fullName: `${entry.provider} user` });
    return send(200, signInOrChallenge(user, req));
  }
  if (route('GET', '/api/me/oauth-accounts')) {
    const who = requireUser(); if (!who) return;
    return send(200, { providers: [...(db.linked.get(who.user.id) ?? [])].map((provider) => ({ provider })) });
  }
  if ((m = route('DELETE', /^\/api\/me\/oauth-accounts\/([^/]+)$/))) {
    const who = requireUser(); if (!who) return;
    db.linked.get(who.user.id)?.delete(m[1]);
    return send(200, { success: true });
  }

  // ── passkeys (options shaped for @simplewebauthn/browser; signatures not verified) ──
  if (route('POST', '/api/auth/webauthn/register/options')) {
    const who = requireUser(); if (!who) return;
    return send(200, {
      message: 'Complete registration',
      deviceName: body.deviceName,
      options: {
        challenge: b64url(crypto.randomBytes(32)),
        rp: { name: 'Voult E2E', id: rpIdFor(body) },
        user: { id: b64url(Buffer.from(who.user.id)), name: who.user.email, displayName: who.user.fullName },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        timeout: 60_000,
        attestation: 'none',
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
        excludeCredentials: [],
      },
    });
  }
  if (route('POST', '/api/auth/webauthn/register/verify')) {
    const who = requireUser(); if (!who) return;
    if (!body.credential?.id) return fail(400, 'WEBAUTHN_REGISTRATION_FAILED', 'Passkey registration could not be verified');
    const passkey = { id: body.credential.id, userId: who.user.id, deviceName: body.deviceName || 'Passkey', createdAt: new Date().toISOString() };
    db.passkeys.set(passkey.id, passkey);
    return send(201, { message: 'Passkey registered', credential: { id: passkey.id, deviceName: passkey.deviceName } });
  }
  if (route('GET', '/api/auth/webauthn/credentials')) {
    const who = requireUser(); if (!who) return;
    return send(200, { credentials: [...db.passkeys.values()].filter((p) => p.userId === who.user.id).map(({ id: cid, deviceName, createdAt }) => ({ id: cid, deviceName, createdAt })) });
  }
  if ((m = path.match(/^\/api\/auth\/webauthn\/credentials\/([^/]+)$/))) {
    const who = requireUser(); if (!who) return;
    const passkey = db.passkeys.get(decodeURIComponent(m[1]));
    if (!passkey || passkey.userId !== who.user.id) return fail(404, 'WEBAUTHN_CREDENTIAL_NOT_FOUND', 'Passkey not found');
    if (method === 'PATCH') { passkey.deviceName = body.deviceName; return send(200, { message: 'Passkey updated', credential: { id: passkey.id, deviceName: passkey.deviceName } }); }
    if (method === 'DELETE') { db.passkeys.delete(passkey.id); return send(200, { message: 'Passkey deleted' }); }
  }
  if (route('POST', '/api/auth/webauthn/login/options')) {
    return send(200, { message: 'Complete login', options: { challenge: b64url(crypto.randomBytes(32)), rpId: rpIdFor(body), allowCredentials: [], userVerification: 'preferred', timeout: 60_000 } });
  }
  if (route('POST', '/api/auth/webauthn/login/verify')) {
    const passkey = db.passkeys.get(body.credential?.id);
    const user = passkey && db.users.get(passkey.userId);
    if (!user || user.disabled) return fail(401, 'WEBAUTHN_CREDENTIAL_UNKNOWN', 'Unknown passkey');
    return send(200, issue(user, req)); // like the real API: a passkey is enough, no MFA step
  }

  return fail(404, 'NOT_FOUND', `${method} ${path}`);
});

server.listen(PORT, '127.0.0.1', () => console.log(`fake Voult on ${SELF}`));
