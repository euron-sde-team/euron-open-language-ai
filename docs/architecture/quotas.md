# Quotas

Each user has two monthly allowances: **practice sessions started** and **minutes of live
voice**. There is no billing and no payments; admins decide who gets how much
([ADR 0006](adr/0006-monthly-quotas-counts-only-usage.md)). Code:
[`apps/api/src/services/quota.service.ts`](../../apps/api/src/services/quota.service.ts).

## Limits

A user's limits come from, in order:

1. their override (`user_quota_overrides`), field by field: a non-null field wins;
2. their tier (`users.quota_tier_id`);
3. the default tier (`quota_tiers.is_default`).

`NULL` on the winning source means unlimited. The seeded default tier allows 30 practice
sessions and 300 voice minutes a month, with live sessions of at most 15 minutes.

| Limit | Column | Applies to |
| --- | --- | --- |
| Practice sessions per month | `monthly_sessions` | `POST /api/practice` |
| Voice minutes per month | `monthly_voice_minutes` | minting a live session |
| Longest live session | `max_session_minutes` (1 to 120) | each live session; set on the tier only |

Months are calendar months in UTC. `GET /api/me/usage` returns the month, `sessions` and
`voiceMinutes` (each `{ used, limit }`), `maxSessionMinutes` and `resetsAt` (the first of next
month, UTC).

Admins manage tiers in Admin, Quotas (`/api/admin/tiers`), move a user to a tier
(`PUT /api/admin/users/:id/tier`) and set or remove an override
(`PUT` / `DELETE /api/admin/users/:id/quota`).

## Counting

`usage_daily` is the durable record (one row per user, UTC day and model). The month's
usage is a `SUM` over this month's rows.

| Counter | Booked when |
| --- | --- |
| `sessions` | `+1` in the same transaction that inserts the practice session |
| `voice_seconds` | when a live session is closed |

Counting from `usage_daily` instead of the `practice_sessions` table means **deleting a
session does not give quota back**. Otherwise a learner could practise, delete and practise
again without limit.

There is no refund. A session is booked when it starts, and a failed lesson report is
retried from the stored transcript (`POST /api/practice/:id/retry`) instead of starting
another session. Unlike a plan that fails to generate, a report that fails costs the learner
nothing: the conversation already happened.

## The advisory lock

Every check-and-book runs in a transaction that first takes
`pg_advisory_xact_lock(hashtext('quota:' || userId))`. Parallel requests from one user
queue on that lock, so they cannot each see "one left" and all succeed. The integration
test "parallel starts cannot draw past the limit" fires 5 requests with 2 left and expects
exactly 2 to succeed.

The lock is held for the database work only. Minting a realtime credential happens after
commit, so a slow provider never blocks the user's other requests.

## Voice time

Voice seconds are measured by the server, never reported by the browser:

- A live session's time is `min(max_seconds, closed_at - created_at)`, from minting the
  credential to the close.
- A session expired by the sweeper (the browser never ended it) books its full
  `max_seconds`.
- A session that failed to mint is closed at zero seconds.
- A practice session's `duration_sec` is the sum of its live sessions' seconds.

When minting, the server computes `max_seconds` as the smaller of
`max_session_minutes * 60` and the seconds left this month. With under 30 seconds left the
request fails with `429 QUOTA_EXCEEDED`. The room counts down from the grant's
`maxSeconds` and ends the session at zero. Minutes are shown rounded up
(`ceil(seconds / 60)`).

Only one live session per user can be open (a partial unique index). Opening a new one closes
the previous one first and books it.

## Text model usage

Every lesson-engine call to a text model books `calls`, `input_tokens` and `output_tokens`
against that model, whether it succeeded or not. The offline engine makes no model call and
books nothing. Tokens are not limited per user; they feed the admin overview and cost
estimate.

## Cost estimate

Admin, Overview shows an estimated cost per model:
`input_tokens * input_usd_per_mtok / 1e6 + output_tokens * output_usd_per_mtok / 1e6 +
voice_seconds * usd_per_minute / 60`, with missing prices counted as zero. Prices are
whatever the admin typed on the model; nothing is billed
([providers guide](../guides/providers.md)).

## Errors

| Code | When |
| --- | --- |
| `429 QUOTA_EXCEEDED` | Starting a session with none left; minting with under 30 seconds of voice left |
| `429 RATE_LIMITED` | A rate limit, which is separate from quotas ([LLD.md](LLD.md#5-rate-limits)) |
