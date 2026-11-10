# ADR 0004: Text models behind one adapter interface, keys only in the environment

## Status

Accepted.

## Context

The lesson report can be written by a text model that returns JSON. Operators want to choose:
OpenAI, Anthropic, Gemini, or a cheaper or local OpenAI-compatible server (Groq,
OpenRouter, Together, Ollama, vLLM). Keys are the most sensitive secret the deployment
holds.

## Decision

- One `LlmAdapter` interface ([`integrations/llm/types.ts`](../../../apps/api/src/integrations/llm/types.ts)):
  a request in, a stream of `text`, `usage` and `finish` events out. Adapters exist for the
  OpenAI Chat Completions format (used for `OPENAI`, `OPENAI_COMPATIBLE` and `STUB`),
  Anthropic and Gemini, over plain `fetch`.
- The lesson engine calls models only through `generateJson`
  ([`services/practice/ai.ts`](../../../apps/api/src/services/practice/ai.ts)): JSON mode
  where the provider has one, tolerant parsing, zod validation, a second attempt.
- A text model is optional: with none configured, or when it fails, the offline lesson engine
  writes the report ([ADR 0010](0010-offline-lesson-engine-by-default.md)).
- Providers and models are rows edited in Admin, Models. A provider's slug names its key.
- Keys come only from `PROVIDER_KEYS` (a JSON object by slug) or the shortcuts
  `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`,
  `GROQ_API_KEY`, read on every call ([`core/config.ts`](../../../apps/api/src/core/config.ts)).
  On AWS they come from the `provider-keys` secret. No table stores a key and no endpoint
  returns one; admins see `keyConfigured`.

## Consequences

Positive:

- Switching the report-writing model is a settings change, and so is turning it off.
- The stub provider uses the same adapter and wire format as production, so tests
  exercise real code.
- A database dump or an admin account does not reveal keys.

Trade-offs:

- Adding or rotating a key needs an environment or secret change and a restart, not a
  click in Admin.
- Providers without native JSON mode rely on the prompt and the repair parser.

## Alternatives considered

- **A vendor SDK per provider.** More dependencies and more surface for the same calls.
- **Encrypted keys in the database.** Puts the key and the decryption key one breach
  apart, and lets an admin account change where spend goes without infrastructure access.
