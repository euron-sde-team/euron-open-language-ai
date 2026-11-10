# ADR 0008: Spaced repetition is scheduled on the server

## Status

Accepted.

## Context

Saved phrases are only useful if they come back at the right time. The app is used on the web
today and may be used from a native client later, on several devices. The schedule has to
agree everywhere, survive a cleared browser, and not be something a client can edit to hide
or fake progress (the streak and the mastered count are shown on the dashboard).

## Decision

- Each card stores its scheduling state in Postgres: `ease`, `interval_days`, `repetitions`
  and `next_review_at` ([`vocab_items`](../data-model.md)).
- The client sends only a grade (`again`, `hard`, `good`, `easy`) for a card id. The server
  applies an SM-2 style function ([`srs.ts`](../../../apps/api/src/services/practice/srs.ts))
  and writes the next state and a `review_log` row. The clock is an argument, so the function
  is pure and tested to the day.
- "Mastered" means an interval of 21 days or more.
- "Done today" counts `review_log` rows rather than cards, so it survives a deck that
  reschedules everything.
- The list of due cards is oldest first and capped at 50 per request; `totalDue` says how
  many are waiting.

## Consequences

Positive:

- One schedule on every device and client; nothing to sync.
- Progress numbers cannot be edited from the browser.

Trade-offs:

- Grading needs the network. The review screen does not queue grades offline.
- The algorithm is a simplified SM-2, not a tuned scheduler. It is simple enough to replace:
  one pure function and its tests.

## Alternatives considered

- **Compute the schedule in the client and store the result.** Cheaper to build, but a
  client could write any date and different clients could disagree.
- **A fixed set of intervals (1, 3, 7, 14 days).** Easier to explain, but it ignores how well
  each card was recalled.
