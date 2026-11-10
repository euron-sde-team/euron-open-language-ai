# ADR 0003: Server-built, locked realtime instructions

## Status

Accepted.

## Context

The live tutor is a realtime voice model that the browser connects to directly, so
audio does not flow through our servers. That browser needs a credential. If the browser
also chose the instructions, anyone could rewrite them (prompt injection by design) and
use the operator's voice model as a free general assistant. A long-lived provider key in
the browser would be worse.

## Decision

- The browser asks `POST /api/practice/:id/live` for a live session. The body is ignored.
- The server builds the instructions from the stored session (language codes and level), the
  scenario's role-play text, the tutor name and house rules
  ([`prompts.ts`](../../../apps/api/src/services/practice/prompts.ts)), and
  asks the provider for a short-lived credential with them inside:
  - **OpenAI**: `POST /v1/realtime/client_secrets` with the full session (instructions,
    `end_session` tool, voice, transcription language, server VAD), valid for
    `REALTIME_CONNECT_TTL_SECONDS`.
  - **Gemini**: a one-use v1alpha ephemeral token whose `liveConnectConstraints` carry the
    model and config, expiring at the end of the session's allowed length.
  - **Stub**: a signed token and the tutor's lines as a script.
- The OpenAI browser transport is plain WebRTC and never sends `session.update`. Its SDP
  handshake goes through an API relay bound to the minted session, which also gives the
  server the call id so it can hang up.
- Time is measured on the server and each session is capped by the tier and the month's
  remaining minutes.

## Consequences

Positive:

- The instructions, tool, model and voice are decided by the server. Integration tests
  assert what was minted, using the stubs' record.
- The provider key never reaches the browser.
- No voice media crosses our infrastructure.

Trade-offs:

- OpenAI client secrets do not lock the session: a client with developer tools can still
  send `session.update`. This is bounded by the session cap and the server hang-up, and
  recorded in the [threat model](../threat-model.md).
- A dropped connection needs a new credential; the practice session can open several live
  sessions, and the transcript so far is kept by the browser.
- Gemini's mechanism is v1alpha.

## Alternatives considered

- **Proxy all audio through the API.** Full control, but every minute of audio would cross
  our servers, adding latency, bandwidth cost and a media server to operate.
- **An OpenAI server sideband** (a server WebSocket attached to the browser's call) could
  watch and correct the session. A possible follow-up; not built.
