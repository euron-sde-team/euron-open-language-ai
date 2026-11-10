# REST contract

Every route the API serves, the DTO it returns (from `packages/types`), and the router file
that owns it (`apps/api/src/routes`). The generated OpenAPI document
([`openapi.yaml`](openapi.yaml), `pnpm openapi`) is built from the route files' doc
comments; this page is the human map. Live voice has its own page: [realtime.md](realtime.md).

## Conventions

- **Base path** `/api`. JSON in and out, except the SDP relay (`application/sdp`).
- **Errors**: every non-2xx body is `ApiError`:
  `{ "error": "Human message", "code": "STABLE_CODE", "details": { ... }, "requestId": "..." }`.
  Switch on `code`; `error` may change. `requestId` matches the `X-Request-Id` header and the
  server's log line.
- **Status codes**: creates answer **201** with the resource; deletes answer **204**;
  ending a practice session and retrying its report answer **202** (the report is queued).
- **Strict bodies**: every body schema is `.strict()`; an unknown key is
  `400 VALIDATION_FAILED` with `details.fields: [{ path, message }]`.
- **Ids** in paths are ULIDs, except provider slugs. A malformed ULID is
  `400 VALIDATION_FAILED`.
- **Ownership**: another account's practice session, vocabulary card or live session is
  **404**, never 403.
- **Writes need an ACTIVE account**: a suspended account can read but gets
  `403 ACCOUNT_RESTRICTED` on writes.
- **Auth column**: `auth` = bearer token required, `public` = none, `admin` = bearer token
  of an ACTIVE `ADMIN` (`403 FORBIDDEN_ADMIN` otherwise), `cookie` / `body token` = the
  refresh token, `ek` = a realtime credential from a live session grant.
- **Rate limits** answer `429 RATE_LIMITED` with `Retry-After` ([LLD.md](../architecture/LLD.md#5-rate-limits)).

## Auth modes

| Mode | Access token | Refresh token |
| --- | --- | --- |
| Web (default) | `Authorization: Bearer <token>`, from the body of every session response; keep it in memory | `lang_refresh` cookie: httpOnly, `SameSite=Lax`, `Path=/api/auth`, `Secure` on https |
| Native (`X-Client: native`) | Same | In the body as `refreshToken` with `refreshExpiresAt`; sent back as `{ refreshToken }` to `/auth/refresh` and `/auth/logout`; no cookie ([ADR 0009](../architecture/adr/0009-native-token-mode.md)) |

Access tokens last `ACCESS_TOKEN_TTL_SECONDS` (900); refresh tokens
`REFRESH_TOKEN_TTL_DAYS` (30) and rotate on every use. A 401 `TOKEN_INVALID` means
"refresh and retry"; a 401 `SESSION_EXPIRED` from `/auth/refresh` means "sign in again".

## Pagination

Lists are keyset pages: `Page<T>` is `{ items: T[], nextCursor: string | null }` with
`?cursor=&limit=`. Cursors are opaque (a tampered one is `400 INVALID_CURSOR`); pass
`nextCursor` back unchanged until it is null. No totals, no `OFFSET`.

| List | Default and max `limit` |
| --- | --- |
| `GET /practice`, `GET /vocab` | 20 and 30, 50 |
| `GET /admin/users`, `/admin/practice`, `/admin/audit` | 30, 100 |

Small, bounded lists are plain arrays: realtime models, sessions, tiers, providers, models.

## Account: `auth.routes.ts`, `users.routes.ts`

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| POST | /auth/signup `{ email, username, displayName, password }` | public | **201** `AuthResult` (with cookie, or `IssuedNativeSession`), or **202** `{ verificationRequired: true, email }`; 403 `REGISTRATION_CLOSED`, `REGISTRATION_DOMAIN_NOT_ALLOWED`; 409 `EMAIL_TAKEN`, `USERNAME_TAKEN`, `USERNAME_RESERVED`; 400 `WEAK_PASSWORD`, `DISPLAY_NAME_INVALID` |
| POST | /auth/verify-email `{ token }` | public | `AuthResult`; 400 `TOKEN_INVALID` |
| POST | /auth/resend-verification `{ email }`, /auth/forgot-password `{ email }` | public | **202** `{ ok: true }` whether or not the account exists |
| POST | /auth/login `{ login, password, totp? \| recoveryCode? }` | public | `AuthResult`, or `{ totpRequired: true }`; 401 `INVALID_CREDENTIALS`, `INVALID_TOTP`, `INVALID_RECOVERY_CODE`; 403 `EMAIL_NOT_VERIFIED`, `ACCOUNT_BANNED`; 429 once a failure budget is spent |
| POST | /auth/refresh | cookie | `AuthResult` with a rotated cookie; **204** without a cookie; 401 `SESSION_EXPIRED` |
| POST | /auth/refresh `{ refreshToken }` with `X-Client: native` | body token | `IssuedNativeSession`; 401 `SESSION_EXPIRED` |
| POST | /auth/logout | cookie, or `{ refreshToken }` native | 204 |
| POST | /auth/logout-all | auth | 204 (every session revoked) |
| POST | /auth/reset-password `{ token, password }` | public | 204 (sessions revoked) |
| POST | /auth/change-password `{ currentPassword, newPassword }` | auth | 204 (every session revoked; sign in again) |
| GET | /auth/me, /users/me | auth | `Me` |
| POST | /auth/totp/setup | auth | `{ secret, otpauthUrl }` |
| POST | /auth/totp/enable `{ code }` | auth | `{ recoveryCodes }` (ten, shown once) |
| POST | /auth/totp/disable `{ password, code \| recoveryCode }` | auth | 204 |
| POST | /auth/totp/recovery-codes `{ password, code }` | auth | `{ recoveryCodes }` |
| PATCH | /users/me `{ displayName? }` | auth | `Me` |
| DELETE | /users/me `{ password, totp? \| recoveryCode? }` | auth | `{ purgeAfter }` (14 days); 409 `LAST_ADMIN` |
| GET | /users/me/export | auth | JSON download: account, profile, preferences, practice sessions with transcripts, corrections, drills, vocabulary, voice sessions (3 a day) |
| GET | /users/me/sessions | auth | `SessionInfo[]` |
| DELETE | /users/me/sessions/:id | auth | 204 |

## Public facts and your learning setup: `meta.routes.ts`, `me.routes.ts`

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| GET | /meta | public | `AppMeta`: name, tagline, registration, `tutorName`, feature switches (`freeConversation`), limits (`maxTranscriptLineChars` 2000, `maxTranscriptLines` 400), support email, `minSupportedVersion`; cached 30 s |
| GET | /meta/languages | public | `LanguageOption[]`: `code`, `name`, `nativeName`, `teachable` (false for a few languages the voice models speak least well; they can still be a native language); cached 5 min |
| GET | /me/profile | auth | `LearnerProfile`; created with defaults (native `en`, target `es`, level `A1`, goal `DAILY`, 10 minutes) on first read |
| PUT | /me/profile (any of `nativeLanguage`, `targetLanguage`, `level`, `goals`, `dailyMinutesTarget`, `onboardingComplete`) | auth | `LearnerProfile`. `onboardingComplete: true` finishes onboarding. 400 `LANGUAGE_UNKNOWN`, `LANGUAGE_NOT_TEACHABLE`, `LANGUAGE_SAME`, `GOALS_REQUIRED`; unknown keys are `VALIDATION_FAILED` |
| GET | /me/usage | auth | `Usage`: this month's practice sessions and voice minutes against the limits (`null` = unlimited), `maxSessionMinutes`, `resetsAt` |
| GET | /me/dashboard | auth | `Dashboard`: streak, minutes today and over 7 days, totals, deck counts, 28 days of activity, the last 20 scores, recent sessions, most frequent mistakes of the last 30 days (`no-store`) |
| GET | /me/realtime-models | auth | `RealtimeModelOption[]`: usable voice models with provider and voices |
| GET, PATCH | /me/preferences | auth | `Preferences` (`voice`, `defaultRealtimeModelId`) |

## Scenarios: `scenarios.routes.ts`

| Method | Path | Returns |
| --- | --- | --- |
| GET | /scenarios?forProfile=true | `Scenario[]`: active ones in display order (`sortOrder`, then creation). With `forProfile=true` only those whose level range holds your level and that share a goal with you (a scenario with no goals suits everyone). The role-play text is never returned |
| GET | /scenarios/:id | `Scenario`. 404 `SCENARIO_NOT_FOUND` for unknown and switched-off ones |

## Practice: `practice.routes.ts`

All routes need `auth` and are owner-scoped (404 `PRACTICE_NOT_FOUND` for others).

| Method | Path | Returns |
| --- | --- | --- |
| GET | /practice?status&cursor&limit | `Page<PracticeSummary>`, newest first |
| POST | /practice `{ scenarioId? }` | **201** `PracticeSession` in `IN_PROGRESS`; books one session of quota. No `scenarioId` (or `null`) is free conversation. 400 `SCENARIO_NOT_FOUND`; 403 `FEATURE_DISABLED` (free conversation off); 409 `PROFILE_INCOMPLETE`; 429 `QUOTA_EXCEEDED`; 503 `NO_REALTIME_MODEL`. The profile's languages and level are copied onto the session |
| GET | /practice/:id | `PracticeSession`: transcript, and once `COMPLETED` the report. Poll while `ANALYZING` ([realtime.md](realtime.md#5-poll-the-report-get-apipracticeid)). `no-store` |
| POST | /practice/:id/live | **201** `LiveSessionGrant` ([realtime.md](realtime.md)). 409 `PRACTICE_ENDED`; 429 `QUOTA_EXCEEDED`; 502 `REALTIME_UNAVAILABLE`; 503 `NO_REALTIME_MODEL`. The body is ignored |
| POST | /practice/:id/live/:sid/end | `LiveSessionEnd` `{ seconds, voiceMinutesLeft }`. Idempotent. 404 `LIVE_SESSION_NOT_FOUND` |
| POST | /practice/:id/end `{ transcript }` | **202** `PracticeSession` in `ANALYZING`. Lines are `{ role: "tutor" \| "learner", text }` only; scores, corrections and anything else are refused with 400 `VALIDATION_FAILED`. Idempotent while `ANALYZING` or `COMPLETED`. 409 `PRACTICE_FAILED` |
| POST | /practice/:id/retry | **202** `PracticeSession` back in `ANALYZING`. 409 `PRACTICE_NOT_FAILED` |
| DELETE | /practice/:id | 204. Transcript, corrections, drills and live sessions go with it; vocabulary cards you saved stay. Quota is not given back; voice time of an open live session is still booked |

Report fields: `scores` is `{ fluency, accuracy, vocabRange, confidence }`, integers from 1
to 10, `overallScore` their mean to one decimal. `corrections` have `type` (`grammar`,
`pronunciation`, `word_choice`, `other`), `original`, `corrected` and an `explanation` in
the learner's native language. `drills` are five of `fill_blank`, `translation`,
`speak_this`. `vocab` has at most ten suggestions (`phrase`, `meaningNative`, `examples`)
and `saved` says whether the phrase is already in the deck.

## Vocabulary and review: `vocab.routes.ts`, `review.routes.ts`

| Method | Path | Returns |
| --- | --- | --- |
| GET | /vocab?q&cursor&limit | `Page<VocabItem>`, newest first; `q` matches the phrase or its meaning, wildcards literally |
| POST | /vocab `{ phrase, meaningNative, examples?, sessionId? }` | **201** `VocabItem`, due now. Saving the same phrase again (any letter case) for the same target language returns the existing card, so a double tap or a retry is harmless. `sessionId` must be yours (404 `PRACTICE_NOT_FOUND`) and sets the card's language. 409 `DECK_FULL` at 5,000 cards |
| DELETE | /vocab/:id | 204. 404 `VOCAB_NOT_FOUND` |
| GET | /review/today | `ReviewToday`: up to 50 due cards oldest first, `totalDue`, and `doneToday` (reviews since UTC midnight). `no-store` |
| POST | /review/grade `{ vocabId, grade }` | `VocabItem` rescheduled. `grade` is `again`, `hard`, `good` or `easy`. 404 `VOCAB_NOT_FOUND` |

SM-2 style scheduling, intervals in days: `again` resets the count and lowers the ease by
0.2, and the card is due again in 10 minutes; `hard` multiplies the interval by 1.2
(always at least a day more) and lowers the ease by 0.15; `good` is 1 day, then 6, then the
interval times the ease; `easy` is 4 days for a new card, then the interval times the ease
times 1.3, and raises the ease by 0.15. The ease starts at 2.5 and never goes below 1.3. A
card whose interval has reached 21 days is `mastered`. Only the server schedules: the
client sends the grade, never dates or intervals.

## Realtime: `realtime.routes.ts`

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| POST | /realtime/openai/calls (`application/sdp`, max 64 KB) | ek | The SDP answer with the call `Location`. 401 `REALTIME_SESSION_INVALID`; 400 `SDP_REQUIRED`; 502 `REALTIME_UNAVAILABLE` |

Details in [realtime.md](realtime.md).

## Admin: `admin.routes.ts`

Every route is `admin`. Admins never receive transcripts, corrections, drills, summaries or
anyone's vocabulary.

| Method | Path | Returns |
| --- | --- | --- |
| GET | /admin/me | `AdminSession` |
| GET | /admin/stats?from&to | `AdminStats` (UTC dates, default the last 30 days, at most a year; 400 `RANGE_INVALID`, `RANGE_TOO_LONG`). `averageScore` is the mean overall lesson score (1 to 10, one decimal) of sessions completed in the range |
| GET | /admin/users?q&status&role&tierId&cursor&limit | `Page<AdminUserRow>` (`sessionsThisMonth`, `voiceMinutesThisMonth`) |
| GET | /admin/users/:id | `AdminUserDetail` |
| PATCH | /admin/users/:id/role `{ role }` | 403 `SELF_ACTION`; 409 `LAST_ADMIN` |
| POST | /admin/users/:id/suspend `{ days, reason? }` (1 to 365), /unsuspend | 403 `TARGET_PROTECTED` for admins |
| POST | /admin/users/:id/ban `{ reason? }`, /unban | Ban signs out everywhere |
| POST | /admin/users/:id/erase `{ reason }` | 204. Identity anonymised; practice sessions, deck, profile and review history deleted |
| PUT | /admin/users/:id/tier `{ tierId }` | `null` = default tier |
| PUT | /admin/users/:id/quota `{ monthlySessions, monthlyVoiceMinutes, note }` | Override; null fields fall back to the tier |
| DELETE | /admin/users/:id/quota | `AdminUserDetail` without the override |
| GET | /admin/tiers | `QuotaTier[]` |
| POST, PUT | /admin/tiers, /admin/tiers/:id `{ name, monthlySessions, monthlyVoiceMinutes, maxSessionMinutes, isDefault? }` | Every tier. 409 `TIER_NAME_TAKEN` |
| DELETE | /admin/tiers/:id | 409 `TIER_IS_DEFAULT` |
| GET | /admin/providers | `AdminProvider[]` with `keyConfigured` |
| POST, PUT, DELETE | /admin/providers, /admin/providers/:id `{ id, kind, displayName, baseUrl, enabled }` | 409 `PROVIDER_SLUG_TAKEN`; 400 `STUB_IN_PRODUCTION`, `BASE_URL_REQUIRED`, `BASE_URL_INVALID` |
| GET | /admin/models | `AdminModel[]` |
| POST, PUT, DELETE | /admin/models, /admin/models/:id | 409 `MODEL_DUPLICATE`; 400 `VOICES_REQUIRED` for realtime models without voices, `REALTIME_PROVIDER_UNSUPPORTED` for a realtime model on a provider without voice |
| POST | /admin/models/:id/test | `ModelTestResult` `{ ok, latencyMs, message }` (20 a minute) |
| GET, PATCH | /admin/settings | `AppSettings` (`tutorName`, `tutorAddendum`, `features.freeConversation`, ...); PATCH merges groups key by key and is audited with before and after. 400 `SETTINGS_INVALID` |
| GET | /admin/integrations | `IntegrationStatus`: mail mode, realtime providers with key and model count, text model count |
| GET | /admin/practice?q&status&userId&cursor&limit | `Page<AdminPracticeRow>`, metadata only: owner, title, status, target language, level, `engine` (`llm` or `offline`, null until `COMPLETED`), overall score, voice minutes |
| GET | /admin/scenarios | `AdminScenario[]`, inactive ones included, with `promptTemplate` |
| POST | /admin/scenarios `{ title, description, levelMin, levelMax, goals, promptTemplate, sortOrder?, isActive? }` | **201** `AdminScenario`; audited as `scenario.create`. 400 `LEVEL_RANGE_INVALID` |
| PUT | /admin/scenarios/:id (same body) | `AdminScenario`; audited as `scenario.update` (the entry lists the changed fields, never the role-play text). 404 `SCENARIO_NOT_FOUND` |
| DELETE | /admin/scenarios/:id | 204; audited as `scenario.delete`. Sessions that used it keep their title |
| GET | /admin/audit?action&actorId&entityType&entityId&cursor&limit | `Page<AuditEntry>`, newest first; `action` matches a prefix |

## Health

| Method | Path | Returns |
| --- | --- | --- |
| GET | /up | `{ ok: true }` when the process is up |
| GET | /api/ready | `{ ok: true }` when Postgres and Redis answer, else 503 (the load balancer check) |

## Error codes by family

| Status | Codes |
| --- | --- |
| 400 | `VALIDATION_FAILED`, `BAD_REQUEST`, `INVALID_CURSOR`, `SCENARIO_NOT_FOUND`, `LANGUAGE_UNKNOWN`, `LANGUAGE_NOT_TEACHABLE`, `LANGUAGE_SAME`, `GOALS_REQUIRED`, `LEVEL_RANGE_INVALID`, `MODEL_UNAVAILABLE`, `SDP_REQUIRED`, `WEAK_PASSWORD`, `DISPLAY_NAME_INVALID`, `TOKEN_INVALID` (email links), `STUB_IN_PRODUCTION`, `SETTINGS_INVALID`, `RANGE_INVALID`, `RANGE_TOO_LONG`, `DAYS_INVALID`, `BASE_URL_REQUIRED`, `BASE_URL_INVALID`, `VOICES_REQUIRED`, `REALTIME_PROVIDER_UNSUPPORTED`, `TIER_DEFAULT_REQUIRED`, `TOTP_REQUIRED`, `TOTP_NOT_STARTED`, `TOTP_NOT_ENABLED` |
| 401 | `UNAUTHENTICATED`, `TOKEN_INVALID`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS`, `INVALID_TOTP`, `INVALID_RECOVERY_CODE`, `REALTIME_SESSION_INVALID` |
| 403 | `ACCOUNT_RESTRICTED`, `ACCOUNT_BANNED`, `ACCOUNT_DEACTIVATED`, `EMAIL_NOT_VERIFIED`, `FORBIDDEN_ADMIN`, `FEATURE_DISABLED`, `REGISTRATION_CLOSED`, `REGISTRATION_DOMAIN_NOT_ALLOWED`, `SELF_ACTION`, `TARGET_PROTECTED`, `CORS_ORIGIN_DENIED` |
| 404 | `NOT_FOUND`, `PRACTICE_NOT_FOUND`, `LIVE_SESSION_NOT_FOUND`, `VOCAB_NOT_FOUND`, `SCENARIO_NOT_FOUND`, `USER_NOT_FOUND`, `MODEL_NOT_FOUND`, `PROVIDER_NOT_FOUND`, `TIER_NOT_FOUND` |
| 409 | `PROFILE_INCOMPLETE`, `PRACTICE_ENDED`, `PRACTICE_FAILED`, `PRACTICE_NOT_FAILED`, `DECK_FULL`, `EMAIL_TAKEN`, `USERNAME_TAKEN`, `USERNAME_RESERVED`, `LAST_ADMIN`, `TIER_IS_DEFAULT`, `TIER_NAME_TAKEN`, `PROVIDER_SLUG_TAKEN`, `MODEL_DUPLICATE`, `TOTP_ALREADY_ENABLED`, `INVALID_STATUS`, `USER_ERASED`, `ALREADY_ERASED` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 429 | `RATE_LIMITED`, `QUOTA_EXCEEDED` |
| 500 | `INTERNAL` |
| 502 | `REALTIME_UNAVAILABLE` |
| 503 | `NO_REALTIME_MODEL` |

The exact field names of every body are in the zod schemas in
[`apps/api/src/controllers/`](../../apps/api/src/controllers/practice.controller.ts) and the
DTOs in [`packages/types`](../../packages/types/src/language.ts).
