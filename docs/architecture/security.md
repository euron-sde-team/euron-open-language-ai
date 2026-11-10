# Security architecture

The controls Euron Open Language AI relies on, where each lives in the code, and what it
does not cover. The STRIDE analysis is [threat-model.md](threat-model.md). How to report a
vulnerability: [SECURITY.md](../../SECURITY.md). Paths are relative to the repository root.

## 1. Authentication

| Control | Where | Detail |
| --- | --- | --- |
| Password hashing | [`apps/api/src/security/passwords.ts`](../../apps/api/src/security/passwords.ts) | bcrypt, cost `BCRYPT_ROUNDS` (12; below 12 refused in production) |
| Password policy | same | 10 to 128 characters, not one repeated character, not containing the email local part or the username (`WEAK_PASSWORD` otherwise) |
| Sign-in throttling | [`apps/api/src/services/auth.service.ts`](../../apps/api/src/services/auth.service.ts) | 5 failures per account and IP per 15 minutes, 50 per account per hour; once spent, every attempt is `429` whether the password is right or not |
| Generic answers | same | `INVALID_CREDENTIALS` for an unknown login and a wrong password alike; resend verification and forgot password always answer the same |
| Email verification | same | On by default (`REQUIRE_EMAIL_VERIFICATION`); single-use links valid 24 hours, stored as hashes |
| Password reset | same | Single-use links valid 1 hour, stored as hashes; a reset revokes every session |
| Two-factor | [`apps/api/src/security/totp.ts`](../../apps/api/src/security/totp.ts) | TOTP secret AES-256-GCM encrypted under `TOTP_ENCRYPTION_KEY`; each code works once; ten single-use recovery codes stored as HMACs |
| Registration control | [`apps/api/src/services/settings.service.ts`](../../apps/api/src/services/settings.service.ts) | `OPEN`, `INVITE_ONLY` (allowed email domains), `CLOSED` |
| Bootstrap admin | [`apps/api/src/cli.ts`](../../apps/api/src/cli.ts) | `admin:create` emails a set-password link and prints a password only with `--print-password` |

## 2. Sessions, cookies and CSRF

- **Access token**: HS256 JWT signed with `JWT_SECRET`, 15 minutes
  (`ACCESS_TOKEN_TTL_SECONDS`), with audience and issuer checked. The web app keeps it in
  memory only ([`apps/web/src/lib/session.ts`](../../apps/web/src/lib/session.ts)).
- **Refresh token**: random, 30 days (`REFRESH_TOKEN_TTL_DAYS`), in the `lang_refresh`
  cookie (`httpOnly`, `SameSite=Lax`, `Path=/api/auth`, `Secure` on https). Only its
  SHA-256 is stored.
- **Rotation and reuse detection**: every refresh rotates within a family; a rotated
  token presented 10 seconds or more after its rotation revokes the family.
- **Every request reloads the user**: a `token_version` mismatch (sign out everywhere,
  password change, ban, erase) invalidates outstanding access tokens at once.
- **Native token mode**: with `X-Client: native` the refresh token travels in the body
  instead of a cookie, through the same rotation code ([ADR 0009](adr/0009-native-token-mode.md)).
- **CSRF**: only `/api/auth/refresh` and `/api/auth/logout` use the cookie. They are covered
  by `SameSite=Lax`, the path scope, CORS (credentials only for allowed origins) and a
  check that refuses any non-GET request with a foreign `Origin`
  (`403 CORS_ORIGIN_DENIED`, [`apps/api/src/app.ts`](../../apps/api/src/app.ts)). Every
  other endpoint needs the bearer token.

## 3. Authorisation

### Roles

`USER` and `ADMIN`. Every admin service function starts with `requireAdmin`
(`403 FORBIDDEN_ADMIN`; a suspended admin has no powers)
([`apps/api/src/core/context.ts`](../../apps/api/src/core/context.ts)). Accounts that are
not `ACTIVE` can read but not write (`403 ACCOUNT_RESTRICTED`).

### Ownership is a 404

Every practice route loads the row with `WHERE id = ? AND user_id = ?` (`ownedPractice`).
Vocabulary and review are scoped by `user_id` the same way. Another learner's practice
session, lesson report, live session, vocabulary card or review answers `404`, indistinguishable
from a missing id. The integration test "another learner gets 404 on every practice,
vocabulary and review route" walks all of them.

### Admins cannot read transcripts

No admin endpoint returns a transcript, a lesson report, a correction, a drill or a deck.
`GET /api/admin/practice` returns metadata only: title, owner, status, target language,
level, the engine that wrote the report, overall score and voice minutes
([`apps/api/src/services/admin.service.ts`](../../apps/api/src/services/admin.service.ts)).
Erasing an account deletes its practice sessions and deck without reading them. The one piece
of learner-facing content an admin does read is the scenario's role-play text, which admins
wrote.

### Strict bodies

Every body schema is `.strict()`: an unknown key is `400 VALIDATION_FAILED`. In
particular the end endpoint takes only a transcript, so a client cannot send a score, and
`POST /api/practice/:id/live` ignores its body, so a client cannot send instructions, a
model, a voice or a language. A scenario's role-play text is staff-only and is not in any
learner-facing response.

## 4. Live voice

| Control | Detail |
| --- | --- |
| Server-built instructions | Built from the stored session, the scenario and the deployment's tutor settings, and locked into the provider credential at mint ([ADR 0003](adr/0003-server-built-locked-realtime-instructions.md)) |
| No provider key in the browser | The browser gets a short-lived credential: OpenAI `ek_...` (connection window `REALTIME_CONNECT_TTL_SECONDS`, default 120 s), a one-use Gemini token, or a signed stub token |
| One open session per user | Partial unique index; a new session closes the old one |
| Server-measured time | Minutes are booked from mint to close, never from a browser report ([quotas.md](quotas.md)) |
| Server hang-up | OpenAI calls are hung up when their session is closed, including by the sweeper ([realtime-and-providers.md](realtime-and-providers.md#5-session-length-and-hang-up)) |
| Bound SDP relay | Accepts only a credential whose hash matches an open OpenAI session minted here, inside its window, once; 64 KB body; 30 a minute per IP |
| Server scoring | The browser reports the transcript; only the lesson job writes scores ([ADR 0007](adr/0007-browser-transcript-server-scoring.md)) |

## 5. Untrusted model input

The transcript is fenced in an `<untrusted>` block that its own text cannot close, and the
lesson prompt tells the model to treat it as data, to ignore any instructions in it and that
a learner cannot award themselves a score. Every model output is validated by a zod schema,
scores are clamped to 1 to 10, and text is cut to what the database keeps before anything is
stored. A learner who said nothing gets the floor score whatever a model returns
([lesson-engine.md](lesson-engine.md)). The model's output reaches only the learner who owns
the session; it is not fed to another prompt.

## 6. Learner speech and personal data

- **The transcript is the only raw learner speech kept**
  ([ADR 0005](adr/0005-transcript-is-the-only-learner-content-kept.md)). It lives on the
  `practice_sessions` row, is clamped by `cleanTranscript` (400 lines, 2,000 characters each,
  80,000 in all) and goes when the session is deleted, the account is erased or retention
  runs. Audio is never recorded by this system: it flows between the browser and the voice
  provider.
- **Job payloads carry ids only.** `practice.analyze` is `{ practiceId, version }`; the
  worker reads the transcript from the row, so no transcript text sits in Redis.
- **What leaves your infrastructure.** The voice provider hears the learner (that is how
  voice works). When a text model is configured, the learner's and tutor's lines (the last
  24,000 characters) go to that provider to write the report. With no text model, the offline
  engine keeps the transcript inside your deployment. Choose providers accordingly.
- **No transcript text in usage rows or logs.** `usage_daily` holds counts and seconds.
  Request logs carry method, path and request id; job failures log the job name and ids.
  pino redacts passwords, tokens, codes, cookies, API keys and fields named `content`,
  `prompt`, `messages` and `input` at any depth up to three levels
  ([`apps/api/src/core/logger.ts`](../../apps/api/src/core/logger.ts)).
- **Users control their data**: JSON export (`GET /api/users/me/export`, 3 a day), deleting a
  practice session (cascades to its corrections and drills; saved cards stay), and account
  deletion (erased after 14 days unless they sign in). Admins can set a retention period.

## 7. Model providers and keys

- Keys come only from `PROVIDER_KEYS` and the single-key shortcuts (`OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`); on AWS from
  the `<prefix>/provider-keys` secret. No table has a key column; admins see
  `keyConfigured` only ([ADR 0004](adr/0004-text-model-adapters.md)).
- Provider error bodies are logged truncated with key-shaped strings masked
  ([`apps/api/src/integrations/http.ts`](../../apps/api/src/integrations/http.ts)); users and
  admins see fixed messages.
- A canary key in the integration suite (`secrets.int.test.ts`) proves no response
  contains it.
- An admin cannot create a `STUB` provider in production (`400 STUB_IN_PRODUCTION`).

## 8. No public surface for learner content

There are no share links, no public reports and no PDF export. Every endpoint that returns a
transcript, a report or a card needs the owner's access token. The only unauthenticated
endpoints are sign-up and sign-in, `GET /api/meta`, `GET /api/meta/languages` and the health
checks.

## 9. Headers and CSP

The API answers JSON only with Helmet defaults and `default-src 'none'`,
`frame-ancestors 'none'`.

The web app sets a per-request CSP with a nonce in
[`apps/web/src/middleware.ts`](../../apps/web/src/middleware.ts):

| Directive | Value | Why |
| --- | --- | --- |
| `script-src` | `'self' 'nonce-...' 'strict-dynamic'` (plus `'unsafe-eval'` in development) | |
| `connect-src` | `'self'` plus `REALTIME_ORIGINS` (default `wss://generativelanguage.googleapis.com`) | Gemini Live's WebSocket. OpenAI's handshake goes to this origin's `/api` relay and WebRTC media is not governed by `connect-src` |
| `style-src` | `'self' 'unsafe-inline'` | Radix positions popovers with inline styles |
| `img-src`, `media-src` | `'self' data: blob:` / `'self' blob:` | |
| `worker-src` | `'self' blob:` | |
| `frame-src`, `frame-ancestors`, `object-src` | `'none'` | |
| `base-uri`, `form-action` | `'self'` | |

Static headers from [`apps/web/next.config.ts`](../../apps/web/next.config.ts): `nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
`Cross-Origin-Opener-Policy: same-origin`, and
`Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=(), fullscreen=(self)`: the app asks for the microphone and never the camera.

## 10. Rate limits and quotas

Redis-backed limits on every expensive or abusable route, keyed by user or IP, with an
in-memory fallback during a Redis outage ([LLD.md](LLD.md#5-rate-limits)). Monthly
practice sessions and voice minutes per user, checked under an advisory lock
([quotas.md](quotas.md)). JSON bodies are capped at 2 MB.

## 11. The production guard

`assertProductionConfig` ([`apps/api/src/core/config.ts`](../../apps/api/src/core/config.ts))
refuses to boot with `NODE_ENV=production` when:

- `JWT_SECRET` or `REFRESH_SECRET` is the committed development default, shorter than 32
  characters, or the two are equal;
- `TOTP_ENCRYPTION_KEY` is the development default;
- `CORS_ORIGINS` is empty, or `APP_WEB_URL` points at localhost;
- `MAIL_MODE=outbox`, or another mail mode without `MAIL_FROM`;
- `JOBS_MODE=inline`;
- `BCRYPT_ROUNDS` is below 12.

`productionWarnings` logs, without refusing, a deployment with no provider key. On AWS the
JWT, refresh and TOTP secrets are generated by Terraform and provider keys start as
`set-me` placeholders that count as unset
([`infra/terraform/modules/secrets/main.tf`](../../infra/terraform/modules/secrets/main.tf)).

## 12. Infrastructure

| Control | Where |
| --- | --- |
| Private subnets for every task; one ALB with TLS | [`modules/network`](../../infra/terraform/modules/network/main.tf), [`modules/edge`](../../infra/terraform/modules/edge/main.tf) |
| Optional CloudFront with WAF and a secret origin header the ALB requires | [`modules/cdn`](../../infra/terraform/modules/cdn/main.tf), [`modules/deployment`](../../infra/terraform/modules/deployment/main.tf) |
| RDS encrypted with the deployment's KMS key, master password managed in Secrets Manager | [`modules/database`](../../infra/terraform/modules/database/main.tf) |
| ElastiCache with encryption in transit and at rest | [`modules/cache`](../../infra/terraform/modules/cache/main.tf) |
| Secrets in Secrets Manager, injected by ECS | [`modules/secrets`](../../infra/terraform/modules/secrets/main.tf) |
| Read-only root filesystem for containers | [`modules/service`](../../infra/terraform/modules/service/main.tf) |
| Alarms and encrypted logs | [`modules/observability`](../../infra/terraform/modules/observability/main.tf) |

No voice media crosses this infrastructure.

## 13. Supply chain and CI

- `pnpm install --frozen-lockfile`.
- The `checks` workflow runs lint, typecheck, unit tests, the OpenAPI check, the
  sanitization scan and `terraform validate` ([`.github/workflows/checks.yml`](../../.github/workflows/checks.yml)).
  Further opt-in workflows live in [`.github/workflows-full/`](../../.github/workflows-full).
- [`scripts/check-sanitization.sh`](../../scripts/check-sanitization.sh) refuses credentials,
  account ids, real emails and public IPs in committable files.

## 14. Limitations

Stated plainly, so a deployer can decide what to rely on.

- **The offline lesson engine is not a grader.** It counts length, variety, hesitations and a
  few spelling rules; it cannot tell whether a sentence is grammatical or how it sounded.
  Its scores reflect how much and how varied the learner spoke, not how correct it was.
  Configure a text model for feedback a learner should rely on
  ([lesson-engine.md](lesson-engine.md#honesty-about-the-offline-engine)).
- **Stub translations are always English.** The stub tutor's parenthetical translations are
  English whatever the learner's native language is; the stub is a stand-in for a voice
  model, not a translator.
- **The transcript comes from the learner's browser.** A learner can post any text as their
  own side of the conversation, and the lesson engine will assess it. They can only mislead
  themselves: scores are not shown to anyone else and nothing is certified. See
  [threat-model.md](threat-model.md#a-learner-can-fake-their-own-transcript).
- **OpenAI sessions are not locked by the provider.** A client secret does not stop a client
  with developer tools from sending `session.update`. Bounded by the session length, the
  monthly minutes and the server hang-up; covered in [threat-model.md](threat-model.md).
- **The tutor's `end_session` tool is declared but the web transports do not act on it.**
  The learner presses End session, or the countdown does.
- **Gemini ephemeral tokens are a v1alpha API.**
- **Admins are trusted with configuration**: an admin can point a provider's `base_url` at any
  host and change the tutor's house rules and every scenario's role-play text.
- **A model can still be swayed** within the valid output shape (for example a generous
  score) by a transcript written to persuade it; the schema and clamps bound the damage to
  that learner's own report.
- **No SSO** (OIDC or SAML); passwords and TOTP only.
