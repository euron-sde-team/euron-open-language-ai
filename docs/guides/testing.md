# Testing

Four layers, from fast to slow:

| Layer | Command | Needs |
| --- | --- | --- |
| Unit tests (every package) | `make test` (`pnpm test`) | Node only |
| API integration tests | `make test-integration` | Postgres and Redis (started from compose if needed) |
| Integration under each mail backend | `make test-matrix` | The local stack (`make up`) |
| Browser end-to-end | `make e2e` | The local stack plus the demo |

Every layer runs against the deterministic stubs in [`apps/stubs`](../../apps/stubs/README.md),
so no test calls a real model provider and no test needs a key.

## Unit tests

```bash
make test                                    # every package, through turbo
pnpm --filter @open-language/api test    # one package
```

Vitest, no database, no network. What they cover:

| Package | Files | Covers |
| --- | --- | --- |
| `apps/api` | [`test/unit`](../../apps/api/test/unit) | The offline lesson engine: determinism, the three correction rules, vocabulary from translated phrases, scores, drills (`lesson-offline.test.ts`); the tutor prompt and prompt fencing (`prompts.test.ts`); SM-2 grading (`srs.test.ts`); the text model adapters' wire formats (`llm-adapters.test.ts`); logger redaction, display name and username rules, HTTP helpers, production config guards (`hardening.test.ts`) |
| `apps/web` | [`test`](../../apps/web/test) | The CSP builder and `REALTIME_ORIGINS` parsing (`lib/csp.test.ts`), the transcript and language helpers (`transcript.test.ts`, `language.test.ts`), the client-side deck helpers (`srs.test.ts`), error code mapping, session handling, auth forms, admin helpers and charts |
| `packages/api-client` | [`test`](../../packages/api-client/test) | The HTTP client: refresh and retry, native token mode, errors, pagination |
| `packages/ui` | [`test`](../../packages/ui/test) | Shared components |
| `apps/stubs` | [`test`](../../apps/stubs/test) | The stubs' wire formats and decisions |

## Integration tests

```bash
make test-integration
```

This runs [`scripts/test-db.sh`](../../scripts/test-db.sh) (starts the compose Postgres and
Redis when nothing listens on 5562 and 6499), then:

```bash
TEST_DATABASE_URL=postgres://lang:lang@localhost:5562/lang_test \
TEST_REDIS_URL=redis://localhost:6499/1 pnpm test:integration
```

The suite mounts the real Express app in-process with supertest against a real Postgres and
Redis ([`vitest.integration.config.mts`](../../vitest.integration.config.mts)):

- **Safety.** `TEST_DATABASE_URL` is required and must name a database ending in `_test`
  ([`guard.ts`](../../apps/api/test/integration/guard.ts)). The global setup drops,
  recreates and migrates it once per run, and flushes only a numbered, non-zero Redis
  database.
- **Hermetic providers.** The stubs start in-process on an ephemeral port. `STUBS_URL`,
  `OPENAI_REALTIME_URL` and `GEMINI_LIVE_URL` point at them, so minting a realtime
  credential, the SDP relay and the hang-up all hit the stubs
  ([`env.ts`](../../apps/api/test/integration/env.ts)).
- **Deterministic jobs.** `JOBS_MODE=inline` runs the lesson job right after commit,
  so a test can assert the result of the request it just made (the lesson report included). Rate limits are off unless a
  test turns them on.
- **Shared database.** Files run one at a time. Every test creates its own users, and a
  test that changes shared state (settings, the default tier, the model catalogue) restores
  it.

What the suite proves, among other things:

| File | Proves |
| --- | --- |
| `practice.int.test.ts` | Starting needs a finished profile; the session copies the profile; free conversation versus a scenario; one session of quota booked; the stub grant carries the target-language script; instructions locked into an OpenAI client secret come from the stored session, whatever the request carries; one open live session per user; seconds measured on the server and capped; the sweeper books abandoned sessions; the transcript is cleaned (400 lines, 2,000 characters) and fenced as untrusted; a model that answers badly twice falls back to the offline engine and the row says so; no text model means the offline engine; a silent learner completes with the floor score; a failed report is retryable; stale and repeated analysis jobs change nothing; deleting keeps the quota used; another learner gets 404 on every practice, vocabulary and review route |
| `learn.int.test.ts` | Scenarios in order without the role-play text and filtered by level and goal; the deck (saving is idempotent, parallel saves make one card, validation, search, paging); review (due cards oldest first, at most 50, SM-2 good/good/good = 1, 6, 15 days, again resets); the dashboard (streak, minutes, activity, trend, weak spots, own data only) |
| `quotas.int.test.ts` | The default tier, tiers and field-by-field overrides, 429 `QUOTA_EXCEEDED` at the limit, of 5 parallel starts with 2 left exactly 2 succeed, deleting a session does not give quota back, voice minutes cap the next live session, usage rows hold counts only |
| `admin.int.test.ts` | 403 `FORBIDDEN_ADMIN` for users, role changes and `LAST_ADMIN`, suspend, ban, erase, tiers, providers report `keyConfigured` never a key, model tests with key-free messages, settings audited, scenario CRUD audited, the practice list is metadata only |
| `me.int.test.ts` | `GET /api/meta` and `/api/meta/languages`, voice models, preferences, the profile, usage |
| `demo.int.test.ts` | `demo:seed` refuses production and produces the demo learner with six lessons, a streak and a deck |
| `secrets.int.test.ts` | The provider key canary (below) |
| `auth.int.test.ts`, `native-auth.int.test.ts`, `account.int.test.ts`, `hardening.int.test.ts` | Sign-up, sign-in, two-factor, sessions and rotation, native token mode, export and deletion, headers and limits |

### The provider key canary

`env.ts` sets `OPENAI_API_KEY` to a known canary value. `secrets.int.test.ts` fails if the
canary appears in any response a user or an admin can fetch, or anywhere in the database.

## The stubs

[`apps/stubs/server.mjs`](../../apps/stubs/server.mjs) is one dependency-free Node script
that speaks the OpenAI-compatible, Anthropic and Gemini text wire formats and the realtime
credential endpoints (OpenAI client secrets, the WebRTC call handshake and hang-up, Gemini
ephemeral tokens). The text model reads the `Output format:` line of the system prompt:

| Output format | Answer |
| --- | --- |
| `lesson_report` | A lesson report for the fenced `conversation`: scores that grow with how many words the learner said, vocabulary from the phrases the tutor translated in parentheses, a capital-letter correction when a learner line starts in lower case, and exactly five drills |
| anything else | A short plain answer (`ok` for the admin model test) |

Trigger words in the user text: `STUB_FAIL` (HTTP 500), `STUB_RATELIMIT` (429),
`STUB_GARBAGE` (not JSON). Tests read what the API sent through `state` (or
`GET /__/requests` and `GET /__/realtime` over HTTP), which is how they assert the exact
instructions the server locked into a credential.

The web app has a matching **stub transport**: the tutor's lines arrive in the grant's
`script` (target-language lines with a parenthetical translation), are spoken with the
browser's speech synthesis in the grant's `speechLocale` (skipped in automated browsers) and
the learner types. That is what the e2e tests drive. `STUB_GARBAGE` in a transcript line makes
the stub text model return text that is not JSON, which exercises the fallback to the offline
engine.

## Backend matrix

```bash
make up
make test-matrix                 # MAIL_MODE outbox, smtp (Mailpit) and ses (Floci)
ONLY=ses make test-matrix        # one row
FILTER=auth make test-matrix     # only matching test files
```

[`scripts/test-matrix.sh`](../../scripts/test-matrix.sh) runs the whole integration suite
once per mail backend, each on a fresh `_test` database and its own Redis logical database,
and prints a table.

## End-to-end tests

```bash
make e2e
```

Playwright against the local stack and the demo ([`e2e/playwright.config.ts`](../../e2e/playwright.config.ts)).
The specs live in [`e2e/tests`](../../e2e/tests): sign-up and sign-in; the learner flow (sign
up, onboard, practise a scenario on the stub voice, read the lesson, save a word, review it);
the practice API's ownership and `PROFILE_INCOMPLETE` rules and idempotent saving; the admin
console (practice list, quota tiers, creating a scenario, hiding it, the audit log, the
forbidden page for a normal account); and axe accessibility checks of the learner pages,
the onboarding wizard, the room and the admin pages in light and dark. Each test creates its
own users. Useful variables: `E2E_BASE_URL`,
`E2E_API_URL`, `E2E_DEMO_PASSWORD` (defaults to `LANG_DEMO_PASSWORD`), `E2E_HEADED=1`.

## Static gates

| Gate | Command |
| --- | --- |
| Lint, typecheck | `pnpm lint`, `pnpm typecheck` |
| OpenAPI reference matches the routes | `pnpm openapi --check` (`pnpm openapi` regenerates [`docs/api/openapi.yaml`](../api/openapi.yaml)) |
| Sanitization (credentials, account ids, real emails, IPs) | `make sanitize` |
| Terraform | `make tf-validate`, `make tf-lint`, `make tf-security` |

## CI

[`.github/workflows/checks.yml`](../../.github/workflows/checks.yml) runs on every push and
pull request: lint, typecheck, unit tests, the OpenAPI check, the sanitization scan, and
Terraform format and validate. The full pipeline (integration tests on Postgres and Redis,
image builds, Terraform security, gitleaks, e2e) is in
[`.github/workflows-full/`](../../.github/workflows-full/README.md); enable it in your fork.
