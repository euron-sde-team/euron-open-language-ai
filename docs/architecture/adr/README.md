# Architecture decision records

Short records of the decisions that shape Euron Open Language AI: the context, what was
decided, and what it costs. The system as built is described in [HLD.md](../HLD.md) and
[LLD.md](../LLD.md).

| ADR | Decision |
| --- | --- |
| [0001](0001-monorepo-stack.md) | One pnpm and Turborepo monorepo: Express API and worker, Next.js web app, shared DOM-free types and client, SQL migrations |
| [0002](0002-single-tenant.md) | One organisation or community per deployment; no tenants |
| [0003](0003-server-built-locked-realtime-instructions.md) | The server builds the tutor's instructions and locks them into a short-lived realtime credential |
| [0004](0004-text-model-adapters.md) | Text models behind one adapter interface; keys only in the environment; a text model is optional |
| [0005](0005-transcript-is-the-only-learner-content-kept.md) | The transcript is the only raw learner speech kept; no audio, no uploads |
| [0006](0006-monthly-quotas-counts-only-usage.md) | Monthly practice-session and voice-minute quotas from admin tiers; usage rows hold counts only |
| [0007](0007-browser-transcript-server-scoring.md) | The browser reports the transcript; the server writes the scores |
| [0008](0008-spaced-repetition-on-the-server.md) | The vocabulary deck is scheduled on the server, SM-2 style |
| [0009](0009-native-token-mode.md) | Native token mode for future mobile clients (`X-Client: native`) |
| [0010](0010-offline-lesson-engine-by-default.md) | A deterministic offline lesson engine behind the same interface as the LLM engine |
