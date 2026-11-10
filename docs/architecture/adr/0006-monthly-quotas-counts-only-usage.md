# ADR 0006: Monthly quotas from admin tiers; usage rows hold counts only

## Status

Accepted.

## Context

Every practice session costs the operator realtime voice minutes and, when a text model is
configured, a few text-model tokens. There is no billing and no payment in the product.
Operators need a simple way to give a cohort more and the public less, and to see what is
being spent, without the usage records themselves becoming a store of personal content.

## Decision

- Two monthly allowances per user (UTC calendar months): practice sessions started and voice
  minutes, plus a per-tier maximum live session length. Limits come from the user's
  override, else their tier, else the default tier; `NULL` means unlimited
  ([`services/quota.service.ts`](../../../apps/api/src/services/quota.service.ts)).
- Usage is booked in `usage_daily` (user, UTC day, model): `sessions`, `voice_seconds`,
  `calls`, `input_tokens`, `output_tokens`. Never text.
- A session is booked when it starts and is never given back, not when the report fails and
  not when the session is deleted.
- Voice seconds are measured by the server from mint to close and capped per live session.
- Every check-and-book runs under `pg_advisory_xact_lock` keyed by user.
- Optional per-model prices feed an admin cost estimate; nothing is billed.

## Consequences

Positive:

- Parallel requests cannot overdraw. Deleting cannot launder quota.
- The usage table can be shared with finance or analytics without exposing anything a
  learner said.
- Admins can manage cohorts with tiers and individuals with overrides.

Trade-offs:

- Text-model tokens are counted but not limited per user; voice minutes are the real
  control.
- A live session the browser abandons is charged its full length.
- A learner whose report fails has still used a session; they retry the report, not the
  session.

## Alternatives considered

- **Count from the `practice_sessions` table.** Simple, but deleting would refund quota.
- **Daily allowances.** Practice is better as a steady habit, but a monthly pool lets a
  learner spend more on a day they have time; admins who want daily pacing can set a smaller
  tier.
