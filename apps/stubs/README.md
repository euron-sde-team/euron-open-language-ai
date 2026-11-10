# @open-language/stubs

Deterministic stand-ins for every third party the language tutor talks to: the text model
providers (OpenAI-compatible chat completions, Anthropic, Gemini) and the realtime credential
endpoints (OpenAI Realtime client secrets, the WebRTC call handshake and hang-up, Gemini Live
ephemeral tokens). One dependency-free Node script (`node:http`, `node:crypto`), state in
memory, port 5209.

The API runs its real provider adapters against it; only the base URL differs from
production. The starter catalogue only adds the stub provider outside production, and an
admin cannot create a stub provider in production.

```bash
PORT=5209 node apps/stubs/server.mjs                 # or: pnpm --filter @open-language/stubs start
pnpm --filter @open-language/stubs test          # wire-format and decision tests
```

Point the API at it:

```bash
STUBS_URL=http://localhost:5209                          # providers of kind STUB call this base URL
OPENAI_REALTIME_URL=http://localhost:5209/v1             # OpenAI client secrets, calls and hang-up
GEMINI_LIVE_URL=http://localhost:5209/gemini/v1alpha     # Gemini Live ephemeral tokens
```

`make up` and the integration tests set these for you. Providers of kind OPENAI, ANTHROPIC or
GEMINI can also be pointed here by setting their base URL in Admin, Models to
`http://localhost:5209/v1`, `http://localhost:5209/anthropic` or `http://localhost:5209/gemini`,
which is how the adapter tests exercise each wire format.

## How the text model answers

It reads the `Output format:` line of the system prompt
(`apps/api/src/services/practice/prompts.ts`):

| Output format | Answer |
| --- | --- |
| `lesson_report` | A lesson report for the fenced `conversation`: scores that grow with how many words the learner said, vocabulary from the phrases the tutor translated in parentheses ("Hola (Hello)"), a capital-letter correction when a learner line starts in lower case, and exactly five drills. |
| anything else | A short plain answer (`ok` for the admin model test). |

`STUB_FAIL` in the user text answers 500, `STUB_RATELIMIT` 429, and `STUB_GARBAGE` returns text
that is not JSON (to test the lesson engine's fall back to the offline engine).

The stub realtime provider needs no server at all: the API signs the stub credential itself,
and the grant carries the lines the browser's speech synthesis speaks (`script`).

## Configuration

| Variable | Default | Used for |
| --- | --- | --- |
| `PORT` | `5209` | listen port |

Tests import `startStubs({ port: 0 })` from `server.mjs`. It returns the base `url`, a
`close()` function, and `state` with the recorded `requests`, the minted `realtime` secrets
(with the session config each carried, so a test can assert what instructions the server
locked in) and the `hangups`. Over HTTP: `GET /__/requests`, `GET /__/realtime`,
`POST /__/reset`.
