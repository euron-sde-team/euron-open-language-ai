# ADR 0007: The browser reports the transcript; the server writes the scores

## Status

Accepted.

## Context

Live audio flows between the browser and the realtime provider, so the API does not hear the
conversation. Something has to tell the server what was said, and something has to assess it.
If the browser (or the realtime model through a tool argument the browser relays) supplied
the scores, a learner could post any number. The assessor also has to work with no model
configured at all ([ADR 0010](0010-offline-lesson-engine-by-default.md)).

## Decision

- The realtime model has one tool, `end_session`, with no arguments. It only signals that the
  learner is done.
- The browser assembles the transcript from the provider's transcription events (or the
  learner's typing) and posts it to `POST /api/practice/:id/end`. The schema is strict and has
  no score fields.
- The server cleans the transcript, measures the duration from its own live-session clocks,
  and queues `practice.analyze`. The lesson engine writes the summary, the four scores, the
  corrections, the vocabulary suggestions and the drills. A learner who said nothing gets 1
  on every score whatever a model returns.
- The job is idempotent by version (`practice_sessions.updated_at`) and replaces its rows
  instead of appending.

## Consequences

Positive:

- Scores always come from the server's engine and rubric; posting a score is impossible.
- The report can be re-run (retry) from the stored transcript, with a different engine if the
  configuration changed.

Trade-offs:

- The learner can fake their own transcript. For self-practice the only person misled is the
  learner, so this is accepted and stated in the [threat model](../threat-model.md).
- The report arrives a few seconds after the session ends, not instantly; the web app polls.

## Alternatives considered

- **Scores as `end_session` arguments.** The browser relays tool calls, so it could change
  them; this was a flaw of the system this project grew out of.
- **A server sideband to the provider** to receive the provider's own transcript. Would close
  the fake-transcript gap for OpenAI; possible follow-up, not built.
