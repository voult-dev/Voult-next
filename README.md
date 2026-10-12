# voult-next-e2e

End-to-end tests for [`@voult/next`](https://github.com/voult-dev/voult-sdk/tree/main/packages/next): a real Next.js 16 App Router app that uses every Voult feature, driven by Playwright in Chromium against a stateful fake Voult API (or against real staging, by hand).

```bash
npm install
npx playwright install chromium   # once
npm run e2e                        # builds the app, starts the fake Voult + next start, runs 32 tests
npm run e2e:report                 # the HTML report (traces for failures)
```

## What's in it

| Path | What |
|---|---|
| `app/api/auth/[...voult]/route.js` | The whole Voult router, one file (`createVoultRouteHandlers`) |
| `proxy.js` | `voultMiddleware` from `@voult/next/middleware`: signed-out visitors → `/login?returnTo=` |
| `app/layout.jsx` | `getSession()` in a Server Component (shows `verified true/false`) |
| `app/account/page.jsx` | `requireSession()` |
| `app/api/whoami/route.js`, `app/actions.js` | `getSession()` in a route handler and a server action (they may renew) |
| `app/sign-in.jsx`, `app/signup/`, `app/mfa/` | Password, Google/GitHub (hosted OAuth), magic link, passkey sign-in; MFA prompt with cancel |
| `app/account/panel.jsx` | MFA, passkeys (real WebAuthn via `@simplewebauthn/browser`), sessions, linked accounts, server checks, sign out, delete account, all through `@voult/react` helpers |
| `fake-voult/server.mjs` | Stand-in for the Voult API, with real refresh-token **rotation and reuse detection** and test hooks under `/__test` |
| `e2e/*.spec.js` | The Playwright suite |

## The tests

| Spec | Covers |
|---|---|
| `auth` | proxy redirect + `returnTo`, sign-up, signed httpOnly cookies, password sign-in, wrong password, sign-out, tampered cookies, the catch-all route, duplicate email |
| `renewal` | Expired access token: Server Components report `verified false` **without refreshing**; `requireSession()` bounces through `/api/auth/session/renew` and comes back verified (one refresh, no reuse detection); route handler and server action renew and save; client calls keep working; dead refresh token → `SESSION_EXPIRED` |
| `mfa` | setup → enable → sign-in challenge (wrong code, right code), cancel, backup code, regenerate, disable |
| `sessions` | `isCurrent`, revoke the other browser, revoke your own |
| `oauth` | Google sign-in, login-CSRF rejection, provider cancel (`access_denied`), link + unlink GitHub |
| `magic-link` | link opens `/api/auth/magic-link/verify` on this origin, sign-in + `returnTo`, unknown email answers the same, used link fails, MFA user → `/mfa` |
| `passkeys` | Chromium virtual authenticator: register, sign in with the passkey, rename, remove |
| `account` | delete account → signed out, can't sign in again |

The fake counts refreshes and reuse detections (`GET /__test/state`), which is how the renewal tests prove both "renewed" and "never presented a used refresh token".

## Against real staging (manual)

```bash
cp .env.local.example .env.local   # fill in an app's credentials; .env.local overrides .env
npm run dev                         # http://localhost:3100
```

Add `http://localhost:3100/api/auth/oauth/callback` under **Callback URLs** for that app. To see the renewal path without waiting 15 minutes, delete the `voult_access` cookie in devtools and reload: the nav shows `verified false`; opening **Account** goes through `/api/auth/session/renew` and back.

`npm run e2e` always uses the fake: Playwright passes the fake's values as env vars, which beat `.env.local`.

## Findings

Bugs this suite found, each now covered by a test (here, and in `voult-sdk` / `voult` where the fix lives). The fake models the API as of 1.3.0.

| | Where | What | Status |
|---|---|---|---|
| 1 | `@voult/sdk` | Recognised its client by class name; `next build` minifies class names, so **every SDK call failed in production Next builds** ("Voult client instance is required") | Fixed in `@voult/sdk` 0.2.1 (symbol brand) |
| 2 | `@voult/next` | `getSession()` read the raw `Cookie` header; after a server action renewed, the same-request re-render saw the expired token and `requireSession()` redirected away | Fixed in `@voult/next` 0.1.1 (reads `cookies()`) |
| 3 | Next.js usage | Client-side `router.push()` after sign-in replayed a prefetched redirect to `/login` | Use a full navigation after sign-in/out; documented in the `@voult/next` README |
| 4 | Voult API | **Concurrent refreshes revoke the session**: several requests after the access token expires each refresh with the same token; the first rotates, the rest count as reuse, and every session is revoked. Any page making parallel auth calls after 15 idle minutes signs the user out (`@voult/express` too) | **Fixed in Voult API 1.3.0**: a 30 s reuse grace period returns the same successor; rotation is an atomic claim (`voult/tests/sessionRevocation.test.js`; here `renewal.spec.js` › parallel requests) |
| 5 | Voult API | **A revoked refresh token counts as reuse**: after you revoke another browser's session, that browser's next refresh revokes all of your sessions | **Fixed in Voult API 1.3.0**: revoked tokens get `INVALID_REFRESH_TOKEN`; only a rotated token replayed after the grace period is reuse (`sessions.spec.js` › after revoking) |
| 6 | `@voult/core` | The router returns the SDK's generic error codes (`AUTHENTICATION_ERROR`, `CONFLICT_ERROR`) instead of the API's (`INVALID_CREDENTIALS`, `USER_EXISTS`) that `ERRORS.md` documents | Open (design decision: `normalizeVoultError` could prefer `err.apiCode`) |

## Package versions

Until `@voult/sdk` 0.2.1 and `@voult/next` 0.1.1 are published, they're installed from `vendor/*.tgz` (built with `npm pack` from `voult-sdk`). Afterwards:

```bash
npm i @voult/sdk@^0.2.1 @voult/next@^0.1.1 && rm -rf vendor
```
