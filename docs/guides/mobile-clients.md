# Building a mobile client

There is no mobile app in this repository yet. The API is ready for one: the web app and a
native app call the same routes, sessions have a native token mode, and the contract
packages run in React Native. This page is what a future iOS or Android app needs to know.
Every route is in [rest-contract.md](../api/rest-contract.md); the realtime side is in
[realtime.md](../api/realtime.md).

Two things differ for a native client: how the refresh token travels, and how the realtime
voice transport is built (the web transports use browser APIs). Nothing is uploaded, so there
is no file handling.

## Sessions: native token mode

The web app keeps the refresh token in an httpOnly cookie scoped to `/api/auth`. A native app
sends `X-Client: native` (any case) instead
([ADR 0009](../architecture/adr/0009-native-token-mode.md),
[`controllers/auth.controller.ts`](../../apps/api/src/controllers/auth.controller.ts)):

| Call | Native behaviour |
| --- | --- |
| `POST /api/auth/login`, `/signup` (without verification), `/verify-email` | Answer `IssuedNativeSession`: `AuthResult` (`accessToken`, `expiresIn`, `user`) plus `refreshToken` and `refreshExpiresAt`. No `Set-Cookie` header, ever |
| `POST /api/auth/refresh` with body `{ refreshToken }` | A new `IssuedNativeSession`: the refresh token rotates on every use. A rotated token replayed later revokes the whole session family (`session.reuse_detected` in the audit log) |
| `POST /api/auth/logout` with body `{ refreshToken }` | 204; revokes that session family |
| `POST /api/auth/logout-all` | 204; every session and access token of the account |

Rules for the app:

- Keep the refresh token only in the platform keystore (iOS Keychain, Android Keystore).
  Never in plain storage, never in a log or crash report.
- Keep the access token in memory. It lives `ACCESS_TOKEN_TTL_SECONDS` (15 minutes by
  default); refresh before `expiresIn` runs out, and on a `401` with code `TOKEN_INVALID`,
  `TOKEN_EXPIRED` or `SESSION_EXPIRED`.
- Refresh single-flight: two concurrent refreshes with the same token look like a replay.
- A `401 SESSION_EXPIRED` from refresh means the session is over: clear the keystore and show
  sign-in. `403 ACCOUNT_BANNED` and `ACCOUNT_DEACTIVATED` likewise.
- `403 ACCOUNT_RESTRICTED` on a write means a suspended account: it can read its lesson
  reports and deck but not start a session or grade a card.

Two-factor sign-in works as on the web: `login` answers `{ totpRequired: true }`; send the
code as `totp`, or an unused `recoveryCode`.

## The contract packages

Two workspace packages have no DOM or Node dependency and run in React Native as well as the
browser:

| Package | Holds |
| --- | --- |
| [`packages/types`](../../packages/types/src/index.ts) | Every DTO and enum: the learner profile, scenarios, practice sessions and lesson reports, live session grants, vocabulary, review, the dashboard, usage, admin. Types only |
| [`packages/api-client`](../../packages/api-client/src/index.ts) | `createApiClient`: typed endpoint groups (`auth`, `meta`, `users`, `languages`, `profile`, `me`, `scenarios`, `practice`, `vocab`, `review`, `admin`), `ApiError` with the stable `code`, single-flight refresh, native token mode. Depends only on `@open-language/types` |

They are private and not published to npm. Copy them into the app repository at a pinned
commit, for example under `vendor/open-language/`, and point your bundler's aliases (or
a `file:` dependency) at the copy. They ship TypeScript source; Metro and Babel compile it
like your own code. Keep the copy honest with a drift check in CI that compares the vendored
`src` folders with the pinned commit, and read the `docs/api/openapi.yaml` diff when you
upgrade.

### Wiring the client in native mode

Pass a `native` token store to `createApiClient`. The client then sends `X-Client: native`
on every request, never relies on cookies, saves the refresh token that `signup`,
`verifyEmail` and `login` return, refreshes with `{ refreshToken }` in the body, keeps the
rotated token, and sends then forgets it on `logout`. When the server ends the session it
clears the store and calls `onSignedOut`.

```ts
import { createApiClient } from "@open-language/api-client";
import * as Keychain from "react-native-keychain";

let accessToken: string | null = null;

export const api = createApiClient({
  baseUrl: "https://language.example.com/api",
  getAccessToken: () => accessToken,
  onRefresh: (r) => (accessToken = r.accessToken),
  onSignedOut: () => (accessToken = null),
  crossTabLock: (fn) => fn(), // one JS runtime: the built-in single-flight is enough
  native: {
    getRefreshToken: async () => (await Keychain.getGenericPassword({ service: "lang-refresh" }))?.password ?? null,
    setRefreshToken: async (token) => {
      if (token) await Keychain.setGenericPassword("refresh", token, { service: "lang-refresh" });
      else await Keychain.resetGenericPassword({ service: "lang-refresh" });
    },
  },
});
```

After a cold start, call `api.auth.refresh()` once: it trades the stored refresh token for an
access token, or returns `null` when there is no session and the app should show sign-in.

## A lesson, step by step

1. **Profile.** `api.profile.get()` creates the learner profile on first read. A first-run
   screen sets the languages, level, goals and daily target with `api.profile.update({ ...,
   onboardingComplete: true })`. `api.languages.list()` supplies the pickers (`teachable`
   marks valid targets).
2. **Pick.** `api.scenarios.list({ forProfile: true })`, or none for free conversation.
3. **Start.** `api.practice.start({ scenarioId })` books one session of quota and returns the
   `PracticeSession` in `IN_PROGRESS`. `409 PROFILE_INCOMPLETE` means onboarding is not done.
4. **Talk.** `api.practice.startLive(id)` returns a `LiveSessionGrant` with a short-lived
   credential whose instructions were locked in by the server. The app never sends
   instructions and never holds a provider key.
5. **End.** `api.practice.endLive(id, grant.id)` books the server-measured time, then
   `api.practice.end(id, { transcript })` (lines `{ role: "tutor" | "learner", text }`; the
   server keeps the last 400 lines of 2,000 characters, see `limits` in `GET /api/meta`).
6. **Report.** Poll `api.practice.get(id)` (the web app polls every 1.5 s) until the status
   leaves `ANALYZING`. `COMPLETED` carries the scores, corrections, drills and vocabulary
   suggestions; `FAILED` can be retried with `api.practice.retry(id)`.
7. **Deck and review.** `api.vocab.save({ phrase, meaningNative, examples, sessionId })`,
   `api.review.today()` and `api.review.grade({ vocabId, grade })`. Scheduling is the
   server's; the app only sends the grade.
8. **Progress.** `api.me.dashboard()`.

What a native app has to build is the realtime transport:

| Provider | What to build |
| --- | --- |
| `openai` | A WebRTC peer connection (for example `react-native-webrtc`) with the microphone track and a data channel named `oai-events`. Post the SDP offer to `grant.connectUrl` with `Authorization: Bearer <credential>` and `Content-Type: application/sdp`, apply the answer, then send `response.create` so the tutor speaks first. Never send `session.update`. Collect the transcription events into transcript lines |
| `gemini` | The Live API over a WebSocket with the ephemeral token (`grant.credential`). The model, instructions, voice and tool are fixed by the token; stream 16 kHz PCM16 in and play 24 kHz PCM16 out |
| `stub` | Development only: speak `grant.script` with the platform's text-to-speech in `grant.speechLocale` and let the user type. Each line is the target language followed by a parenthetical translation |

The web transports in [`apps/web/src/lib/realtime/`](../../apps/web/src/lib/realtime/types.ts)
are the reference for event names and audio formats. The tutor line format ("Hola (Hello)")
is split for display by [`apps/web/src/lib/language/transcript.ts`](../../apps/web/src/lib/language/transcript.ts).

The end of a conversation is a button or `grant.maxSeconds` elapsing; the tutor's
`end_session` tool call carries no arguments and the web app does not act on it either.

A session the app never ends (killed in the background) is closed by the server's sweeper
after its maximum length plus a grace period, and the full length is booked.

## Feature flags and forced updates

Call `GET /api/meta` (public, cached 30 s) at launch and on foreground:

| Field | Use |
| --- | --- |
| `appName`, `tagline`, `tutorName`, `support.email` | Branding and the help screen |
| `registration` | `OPEN`, `INVITE_ONLY` or `CLOSED`: hide or explain sign-up |
| `features.freeConversation` | Show or hide "Talk about anything" |
| `limits.maxTranscriptLines`, `maxTranscriptLineChars` | Trim the transcript before posting it |
| `minSupportedVersion` | `x.y.z` or null. When the app's version is lower, show a blocking "Update the app" screen before anything else |

`GET /api/me/usage` gives this month's allowance (`sessions` and `voiceMinutes`); `GET /api/me/realtime-models` the voice
models the user can pick.

## Errors

Every non-2xx body is `{ error, code, details?, requestId }`. Switch on `code`, show `error`
when you have nothing better, and include `requestId` in bug reports. `429 RATE_LIMITED`
carries `Retry-After`; `429 QUOTA_EXCEEDED` means the monthly allowance is spent.

## A checklist

- `X-Client: native` through the client's `native` store; refresh token in the keystore only.
- Vendored `packages/types` and `packages/api-client` at a pinned commit, with a drift check.
- A WebRTC transport for OpenAI and a WebSocket transport for Gemini, with no
  `session.update` and no client-side instructions.
- `endLive` then `end` at the end of every conversation, including when the app goes to the
  background mid-session.
- `GET /api/meta` at launch: features, limits, `minSupportedVersion`.
- Never log transcripts, tokens or credentials.
