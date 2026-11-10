# ADR 0005: The transcript is the only raw learner speech kept

## Status

Accepted.

## Context

A language learner says personal things to a tutor: where they live, what they do, what they
are afraid of. The product needs some of it afterwards, to write the lesson report and to
let the learner re-read the conversation. It does not need audio, and it does not need to
mine the text for anything else. Every extra copy of learner speech is something to protect,
delete on request and explain to a regulator.

## Decision

- **Audio is never recorded.** It flows between the browser and the voice provider. There is
  no object storage and no upload endpoint.
- **The transcript is kept once**, on its `practice_sessions` row, cleaned by the server
  (`cleanTranscript`: the last 400 lines, 2,000 characters each, 80,000 in all, NUL bytes and
  other roles removed). It is shown to the owner on the lesson report.
- **Everything else is derived and small**: the summary, scores, corrections and drills of
  the report, and the vocabulary cards the learner chooses to save. Corrections and drills
  go with the session; saved cards stay, with their source session set to null if it is
  deleted.
- **The transcript goes where the session goes.** Deleting a session, erasing an account and
  the retention job all delete it. Admins read practice metadata only.
- **It never travels through Redis.** Job payloads are ids and a version stamp; the worker
  reads the transcript from the row.
- **It appears in no usage row and no log line.** `usage_daily` holds counts, seconds and
  model ids; the logger redacts content-like fields.
- **It leaves the deployment only if the operator configures a text model**, in which case
  the last 24,000 characters of a conversation go to that provider to write the report.
  Without one, the offline engine keeps everything in-house
  ([ADR 0010](0010-offline-lesson-engine-by-default.md)).

## Consequences

Positive:

- One place to protect, export, delete and retain. Account erasure and retention have a
  short list.
- No file storage in the request path and no audio archive.
- Operators can promise "the transcript is the only thing we keep" and mean it.

Trade-offs:

- A learner cannot replay their own voice, only read the transcript. Pronunciation cannot be
  reviewed afterwards.
- A failed report is retried from the stored transcript, so the transcript has to be stored
  before the report exists.
- The transcript is stored as text in Postgres, readable by anyone with database access.

## Alternatives considered

- **Store audio in a private bucket.** Enables replay and re-transcription, at the cost of
  holding the most sensitive form of the data indefinitely.
- **Discard the transcript after the report.** Smaller footprint, but the learner could not
  re-read the conversation and a failed report could not be retried.
