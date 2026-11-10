# Quickstart: run Euron Open Language AI locally

Start the whole stack on your machine with emulated AWS, seed demo accounts and practice
sessions, and hold a language lesson against a local stand-in tutor. No cloud account and no
model API key are needed; adding a real key later is one line.

What runs ([`deploy/compose/compose.yaml`](../../deploy/compose/compose.yaml) plus
[`compose.floci.yaml`](../../deploy/compose/compose.floci.yaml)): Postgres 16, Redis 7,
Mailpit, the Floci AWS emulator provisioned by the production Terraform modules, the stubs
(text model and realtime credential stand-ins, [`apps/stubs`](../../apps/stubs/README.md)),
then a one-shot `migrate`, the `api`, the `worker` and the `web` app.

## Prerequisites

- Docker with Compose v2 (Docker Desktop, OrbStack, Colima or plain Docker Engine).
- `make`, `bash` and `openssl` (for `make env`).
- A browser with a microphone for a voice lesson. Without one you can still answer by
  typing.
- For the tests and for running apps outside Docker: Node 22 (`.nvmrc`) and pnpm 9
  (`corepack enable`), then `pnpm install`.

## Start the stack

```bash
make up
```

`make up` runs `make env` first: it writes `deploy/compose/.env` with random, local-only
secrets (JWT and refresh secrets, the TOTP key, the demo password) and never overwrites a
value ([`scripts/gen-local-env.sh`](../../scripts/gen-local-env.sh)). Then it builds the
images, waits for the `terraform` one-shot to provision Floci, runs the migration and waits
until every service is healthy. The first build takes a few minutes. When it is done it
prints the URLs:

```
  app      http://localhost:3640
  api      http://localhost:5116/api/ready
  mail     http://localhost:8116
  ses      http://localhost:4667  (Floci)
  stubs    http://localhost:5209  (model and realtime stand-ins)
```

Check the API: `curl -s localhost:5116/api/ready` answers `{"ok":true}` when Postgres and
Redis respond.

On first boot the API creates the starter model catalogue
([`apps/api/src/demo/catalog.ts`](../../apps/api/src/demo/catalog.ts)): OpenAI, Gemini and
Anthropic models (hidden until their key is set) and, outside production, the **Local stub**
provider with `Stub lesson writer` (TEXT, writes the lesson report) and `Stub voice` (REALTIME,
the tutor), both defaults. So the app
works before you seed anything.

## Ports

Every host port binds to `127.0.0.1` and can be moved in `deploy/compose/.env` (or your
shell) if it clashes with something else:

| Service | Host port | Variable |
| --- | --- | --- |
| Web app (and the `/api` proxy) | 3640 | `LANG_WEB_PORT` |
| API | 5116 | `LANG_API_PORT` |
| Postgres | 5562 | `LANG_PG_PORT` |
| Redis | 6499 | `LANG_REDIS_PORT` |
| Mailpit web UI / SMTP | 8116 / 1116 | `LANG_MAILPIT_PORT` / `LANG_SMTP_PORT` |
| Floci (SES, KMS, Secrets Manager) | 4667 | `LANG_FLOCI_PORT` |
| Stubs | 5209 | `LANG_STUB_PORT` |

The browser only ever talks to the web app: Next proxies `/api/*` to the API
(`API_INTERNAL_URL`), including the OpenAI WebRTC handshake relay, so the refresh cookie is
first-party exactly as behind the load balancer on AWS. The API port is published for curl
and the integration tools.

## Seed the demo

```bash
make demo
```

This runs `node dist/cli.js demo:seed` inside the API container
([`apps/api/src/demo/seed.ts`](../../apps/api/src/demo/seed.ts)) with `DEMO_PASSWORD` set
to `LANG_DEMO_PASSWORD` from `deploy/compose/.env`. It creates:

- the starter catalogue with the stub provider (if it is not there yet) and the twelve
  starter scenarios;
- an admin and four learners, a `Coaching cohort` quota tier (60 sessions, 600 voice minutes,
  20 minute sessions) that Lee is on, and some older usage for the admin overview;
- for Lee (a native English speaker learning Spanish at B1, onboarding done): six finished
  practice sessions over the last three weeks with scores that climb, corrections, drills
  and suggested vocabulary, a streak, and a deck of about 25 cards with several due today;
- a few finished sessions for the other learners.

It refuses to run with `NODE_ENV=production`. If the demo admin already exists it only
prints the logins.

| Account | Email | Role |
| --- | --- | --- |
| Morgan Ellis | `admin@example.com` | ADMIN: `/admin` |
| Lee Marsh | `lee@example.com` | USER, the full demo history, `Coaching cohort` tier |
| Sam Rivera | `sam.rivera@example.com` | USER |
| Amara Okafor | `amara.okafor@example.com` | USER |
| Jun Park | `jun.park@example.com` | USER |

Every demo account signs in with the password printed by `make demo`
(`LANG_DEMO_PASSWORD` in `deploy/compose/.env`).

## A first lesson

Sign in at http://localhost:3640 as Lee, or create your own account (the verification mail is
in Mailpit at http://localhost:8116) and go through the four-step onboarding: the language
you speak, the language to learn, your level and goals, and a daily minutes target.

1. Open **Practice** and pick a scenario ("Ordering food", say), or choose **Talk about
   anything**. Picking one books a session and opens the room.
2. Press **Start talking**. The room asks for the microphone, or lets you **Continue by
   typing**.
3. With the stub voice, the tutor's lines are spoken with your browser's own speech
   synthesis in the target language, and shown in the transcript with a dimmed translation
   underneath. Answer by speaking (where the browser offers speech recognition) or by typing.
   The tutor says the next scripted line after each answer.
4. Press **End session**. The lesson report appears after a second or two: a summary, four
   scores (fluency, accuracy, vocabulary range, confidence), corrections, vocabulary to keep,
   and five drills.
5. Save a few phrases to your deck. They are due for review straight away: open **Review**,
   flip a card, grade it Again, Hard, Good or Easy (keys 1 to 4).
6. Open **Progress** for the streak, minutes and score trend, and **Vocabulary** for the deck.

The stub text model is deterministic ([`apps/stubs/README.md`](../../apps/stubs/README.md)):
scores grow with how many words you said, vocabulary comes from the phrases the tutor
translated in parentheses, and a lowercase sentence start earns a capital-letter correction.
Both the stub tutor and the stub text model are stand-ins for real models. The offline lesson
engine, which needs no text model at all, is described in
[lesson-engine.md](../architecture/lesson-engine.md); to see it, disable the Stub lesson writer in
Admin, Models and end another session.

The stub tutor's lines are in the learner's target language with English translations, whatever
the learner's native language is. Spanish, French, German, Hindi and English have their own
lines; every other language gets a short generic English script.

Every mail the stack sends (verification, password reset, the admin set-password link) is at
http://localhost:8116. `GET http://localhost:5209/__/requests` lists every request the API
sent to the stubs, and `GET http://localhost:5209/__/realtime` shows each minted realtime
credential with the instructions the server locked into it.

## The admin control plane

Sign in as `admin@example.com` and open `/admin`: the overview (usage and estimated cost),
users (roles, suspend, ban, erase, tier and per-user limits), quotas (monthly practice sessions,
monthly voice minutes and the longest session), models (providers, models, the **Test**
button), practice (metadata only, including which lesson engine wrote each report), scenarios
(create, edit, reorder, switch off, delete), settings and the audit trail. Admins never see
anyone's transcripts or reports. To write your own role-play see
[write-a-scenario.md](write-a-scenario.md).

## Use a real voice model

Add a key to `deploy/compose/.env`, either as one JSON object keyed by provider slug or with
a single-key shortcut (placeholders shown):

```bash
PROVIDER_KEYS={"openai":"<openai-key>","gemini":"<gemini-key>"}
# or
OPENAI_API_KEY=<openai-key>
```

then `make up` again (compose recreates the API and worker with the new environment). The
starter OpenAI and Gemini models appear: pick the voice model in Settings, Voice, and make a
real TEXT model the default in `/admin/models` if you want a lesson report written by a model
rather than by the stub or the offline engine. Model ids change often: check one with **Test** and edit it there
([providers.md](providers.md)).

A real voice lesson needs a microphone and a network that allows WebRTC (OpenAI) or a
WebSocket to Google (Gemini). See [troubleshooting.md](troubleshooting.md) when it does not
connect.

## Stop and reset

```bash
make down                 # stop everything and delete the volumes (database, emulator state)
make logs SERVICE=api     # tail one service: api, worker, web, stubs, migrate, floci, terraform
make ps                   # status
```

`deploy/compose/.env` survives `make down`; delete it to generate new secrets.

## Next

- Run the tests: [testing.md](testing.md).
- Follow one lesson through the code: [walkthrough.md](walkthrough.md).
- Add a language or a scenario: [add-a-language.md](add-a-language.md), [write-a-scenario.md](write-a-scenario.md).
- Every setting: [configuration.md](configuration.md).
- Deploy it: [deploy-aws.md](deploy-aws.md).
