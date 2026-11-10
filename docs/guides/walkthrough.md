# Walkthrough: one lesson, end to end

A reading order for a new contributor: what lives where, then one language lesson followed
from the sign-up screen to the review queue, naming every file and function on the way. Start
the stack ([quickstart-local.md](quickstart-local.md)) so you can try each step as you read.
The design behind each step is in [lesson-engine.md](../architecture/lesson-engine.md) and
[realtime-and-providers.md](../architecture/realtime-and-providers.md).

## 0. The map

```
apps/
  api/         Express 5 API and BullMQ worker (one image, entry points: index, worker, cli, migrate)
  web/         Next.js web app: home, onboarding, practice, the room, lesson reports, review, progress, settings, /admin
  stubs/       deterministic text model and realtime credential stand-ins
packages/
  types/       DTOs and enums shared by api, web and any native client
  api-client/  the typed, DOM-free HTTP client (refresh, native token mode)
  ui/          components and design tokens
db/            migrate.ts and migrations/0001_init.sql
deploy/        docker compose for local development
infra/         Dockerfiles and Terraform (AWS, and the local AWS emulator)
e2e/           Playwright tests
```

Inside the API the layers are always the same: `routes/` (paths, guards, rate limits) ->
`controllers/` (strict zod parsing) -> `services/` (rules, take an `Actor`) -> Kysely ->
`presenters/` (DTOs field by field). Background work is a job in `jobs/`, enqueued through
`Effects` so nothing is queued for a transaction that rolled back
([`core/effects.ts`](../../apps/api/src/core/effects.ts)).

## 1. Sign up and onboarding

The learner signs up ([`components/auth/signup-form.tsx`](../../apps/web/src/components/auth/signup-form.tsx)),
confirms the emailed link, and signs in. The app shell
([`components/app/app-shell.tsx`](../../apps/web/src/components/app/app-shell.tsx)) sees that
the profile is not complete and sends them to `/onboarding`
([`components/onboarding/onboarding-wizard.tsx`](../../apps/web/src/components/onboarding/onboarding-wizard.tsx)).

- The wizard reads the language list from `GET /api/meta/languages`
  ([`routes/meta.routes.ts`](../../apps/api/src/routes/meta.routes.ts), built by
  `languageOptions()` in [`domain/languages.ts`](../../apps/api/src/domain/languages.ts)).
- Its four steps end with `api().profile.update({ ..., onboardingComplete: true })`, which is
  `PUT /api/me/profile` ([`routes/me.routes.ts`](../../apps/api/src/routes/me.routes.ts),
  `putProfile` in [`controllers/learn.controller.ts`](../../apps/api/src/controllers/learn.controller.ts)).
- `updateProfile` in [`services/profile.service.ts`](../../apps/api/src/services/profile.service.ts)
  checks the codes against the table (`LANGUAGE_UNKNOWN`, `LANGUAGE_NOT_TEACHABLE`,
  `LANGUAGE_SAME`) and at least one goal.

## 2. Picking a scenario

`/practice` ([`components/practice/practice-picker.tsx`](../../apps/web/src/components/practice/practice-picker.tsx))
loads `GET /api/scenarios?forProfile=true` (`listScenarios` in
[`services/scenario.service.ts`](../../apps/api/src/services/scenario.service.ts)): active
scenarios whose level range contains the learner's level and that share a goal. The role-play
text is not in the response. Picking a row, or "Talk about anything", calls
`POST /api/practice`.

`startPractice` in [`services/practice/practice.service.ts`](../../apps/api/src/services/practice/practice.service.ts)
checks onboarding, resolves a voice model, and in one transaction takes the user's quota lock
(`lockUserQuota`, a Postgres advisory lock), checks the month (`assertSessionLeft`), inserts
the `practice_sessions` row in `IN_PROGRESS` with the profile's languages and level, and books
one session in `usage_daily`. The browser navigates to `/room/<id>`.

## 3. Opening a live session

The room ([`components/room/room-view.tsx`](../../apps/web/src/components/room/room-view.tsx))
shows a preflight (microphone with echo cancellation, or "Continue by typing"). **Start
talking** calls `POST /api/practice/:id/live`.

`startLive` in [`services/practice/live.service.ts`](../../apps/api/src/services/practice/live.service.ts):

1. Loads the session by owner (`ownedPractice`: another learner's session is a 404).
2. Resolves the voice model and voice, and builds the instructions with `tutorInstructions`
   from the **stored** session, the scenario and the settings. Nothing from the request goes
   into them ([ADR 0003](../architecture/adr/0003-server-built-locked-realtime-instructions.md)).
3. In one transaction under the quota lock: closes any other open live session of the user,
   computes `max_seconds` (`voiceSecondsAllowed`: the tier's session length, capped by the
   minutes left this month), inserts a `live_sessions` row.
4. After commit, asks the realtime adapter to mint a short-lived credential
   ([`integrations/realtime/`](../../apps/api/src/integrations/realtime/index.ts)) with the
   instructions, the `end_session` tool, the voice and the transcription language of the
   target language inside it, and stores the credential's hash.

The answer is a `LiveSessionGrant`: provider, credential, model, voice, `connectUrl`,
`expiresAt`, `maxSeconds`, the scenario, the two languages, `speechLocale` and (stub only)
`script`.

## 4. Talking to the tutor

The room loads one transport for the grant's provider (`transportFor` in
[`lib/realtime/index.ts`](../../apps/web/src/lib/realtime/index.ts)):

| Provider | Transport | How it connects |
| --- | --- | --- |
| `openai` | [`lib/realtime/openai.ts`](../../apps/web/src/lib/realtime/openai.ts) | Plain WebRTC. The SDP offer goes to the API relay (`relayOpenAiSdp`), which checks the credential was minted for an open session (`claimRelay`), forwards it to OpenAI, remembers the call id for a later hang-up, and returns the answer. The client never sends `session.update` |
| `gemini` | [`lib/realtime/gemini.ts`](../../apps/web/src/lib/realtime/gemini.ts) | `@google/genai` Live over a WebSocket with the one-use ephemeral token, whose constraints fix the model, instructions, voice and tool |
| `stub` | [`lib/realtime/stub.ts`](../../apps/web/src/lib/realtime/stub.ts) | No network. Speaks the grant's `script` with the browser's speech synthesis in the grant's `speechLocale`; the learner types or dictates |

Each transport emits the same events (`stage`, `line`, `speaking`, `error`), and the room
collects the finished lines into a transcript, splitting each tutor line into the target
language and its parenthetical translation
([`lib/language/transcript.ts`](../../apps/web/src/lib/language/transcript.ts)). The
translation shows dimmed under the line and can be switched off. The session clock counts
down from `maxSeconds`.

## 5. Ending the session

The learner presses **End session** (or the clock runs out). The room then:

1. closes the transport and calls `POST /api/practice/:id/live/:sid/end` (`endLive`), which
   books the seconds measured on the server (`measuredSeconds` in
   [`services/practice/sessions.ts`](../../apps/api/src/services/practice/sessions.ts): mint
   to close, capped at `max_seconds`) and queues `practice.hangup` for an OpenAI call;
2. posts the transcript to `POST /api/practice/:id/end` (`endPractice`). The body schema is
   strict, so a client that tries to send scores gets a 400. The server cleans the transcript
   (`cleanTranscript`), sets `duration_sec` from its own live-session clocks, marks the row
   `ANALYZING` and queues `practice.analyze` with the row's `updated_at` as its version;
3. navigates to `/practice/<id>`, which polls `GET /api/practice/:id` every 1.5 seconds while
   the status is `ANALYZING` ([`lib/practice/queries.ts`](../../apps/web/src/lib/practice/queries.ts)).

## 6. The lesson report

The worker ([`worker.ts`](../../apps/api/src/worker.ts)) runs `analyzePractice` in
[`jobs/practice.jobs.ts`](../../apps/api/src/jobs/practice.jobs.ts):

1. It acts only on an `ANALYZING` row whose `updated_at` matches the job's version.
2. `runLesson` ([`services/practice/lesson/index.ts`](../../apps/api/src/services/practice/lesson/index.ts))
   picks the engine: the text model through `generateJson` ([`ai.ts`](../../apps/api/src/services/practice/ai.ts))
   and the schema in [`lesson/llm.ts`](../../apps/api/src/services/practice/lesson/llm.ts), or the
   deterministic [`lesson/offline.ts`](../../apps/api/src/services/practice/lesson/offline.ts)
   when no model is usable, the model fails twice, or the learner said nothing.
3. One transaction re-checks the row under a lock, replaces the `corrections` and `drills`
   rows, and sets the summary, the four scores, the overall score, the vocabulary
   suggestions, `engine` and `COMPLETED`.
4. If anything throws, the row becomes `FAILED` with a fixed safe message and the report
   screen offers **Try again** (`POST /api/practice/:id/retry`).

The report ([`components/practice/lesson-report.tsx`](../../apps/web/src/components/practice/lesson-report.tsx))
shows the summary, scores, corrections, the vocabulary with a **Save to deck** button for each
phrase, the drills and the transcript.

## 7. Vocabulary and review

**Save to deck** calls `POST /api/vocab` (`saveVocab` in
[`services/vocab.service.ts`](../../apps/api/src/services/vocab.service.ts)); the unique index
on `(user_id, target_language, lower(phrase))` makes saving twice a no-op.
`/review` ([`components/review/review-view.tsx`](../../apps/web/src/components/review/review-view.tsx))
loads `GET /api/review/today` and posts each grade to `POST /api/review/grade`, where
`gradeCard` in [`services/practice/srs.ts`](../../apps/api/src/services/practice/srs.ts) computes
the next state ([ADR 0008](../architecture/adr/0008-spaced-repetition-on-the-server.md)).

## 8. Progress

`/progress` ([`components/progress/progress-view.tsx`](../../apps/web/src/components/progress/progress-view.tsx))
reads `GET /api/me/dashboard`, computed in SQL by
[`services/dashboard.service.ts`](../../apps/api/src/services/dashboard.service.ts): the
streak (`streakOf`), minutes today and this week, 28 days of activity, the last 20 score
points and the most frequent correction types.

## 9. The admin side

`/admin` ([`components/admin/pages/`](../../apps/web/src/components/admin/pages)) offers:

- **Scenarios**: create, edit, reorder, switch off, delete (`/api/admin/scenarios`, audited).
- **Quotas**: tiers with monthly sessions, monthly voice minutes and the longest session,
  and per-user overrides.
- **Models**: providers and models, the **Test** button.
- **Practice**: every session's metadata and which lesson engine wrote its report. Never a
  transcript.
- Overview, users, settings (the tutor's name and house rules) and the audit trail.

## 10. Behind the scenes

The worker runs `practice.sweep` every minute: an `OPEN` live session past its `expires_at`
(connect window plus `max_seconds` plus grace) becomes `EXPIRED`, books its full length and,
for OpenAI, is hung up. The admin overview at `/admin` sums `usage_daily` into counts,
minutes and an estimated cost.

## Where to go next

- The tables: [data-model.md](../architecture/data-model.md).
- The endpoints: [rest-contract.md](../api/rest-contract.md) and [realtime.md](../api/realtime.md).
- The tests that pin all of this down: [testing.md](testing.md).
- Make it teach another language: [add-a-language.md](add-a-language.md).
