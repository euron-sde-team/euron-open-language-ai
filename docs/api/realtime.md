# Realtime API

How a client holds one live voice conversation with the tutor. The design and its limits are
in [realtime-and-providers.md](../architecture/realtime-and-providers.md); this page is the
wire contract for a client (the web room today, a native app later).

## Lifecycle of one practice session

```text
POST /api/practice                        -> PracticeSession (IN_PROGRESS), books one session of quota
POST /api/practice/:id/live               -> LiveSessionGrant
connect to the provider with the grant    (openai | gemini | stub)
... the tutor speaks, the learner answers ...
the tutor calls end_session, or the learner presses End, or maxSeconds runs out
close the provider connection
POST /api/practice/:id/live/:sid/end      -> LiveSessionEnd
POST /api/practice/:id/end                -> 202 PracticeSession (ANALYZING)
GET  /api/practice/:id                    -> poll until COMPLETED (or FAILED)
```

A practice session is one conversation. Reconnecting after a dropped connection is a new
`POST .../live` on the same practice session (minutes add up). Only one live session per
user can be open: minting a new one closes the previous one and books its time.

## 1. Mint: `POST /api/practice/:id/live`

No body is read. Everything the tutor is told (its name, the languages and level copied from
your profile when the session started, the scenario's role-play text, the house rules) is
built on the server and locked in the credential. A client cannot add to it.

Response **201** `LiveSessionGrant` (`Cache-Control: no-store`):

```json
{
  "id": "01JE2Q7H3XK4M5N6P7R8S9T0VW",
  "provider": "openai",
  "credential": "ek_...",
  "model": "gpt-realtime",
  "voice": "marin",
  "connectUrl": "https://app.example.com/api/realtime/openai/calls",
  "expiresAt": "2026-11-10T10:02:00.000Z",
  "maxSeconds": 900,
  "scenario": { "id": "01JE...", "title": "Ordering food", "description": "Sit down at a restaurant, order a meal and a drink, and mention what you cannot eat." },
  "targetLanguage": "es",
  "nativeLanguage": "en",
  "speechLocale": "es-ES"
}
```

| Field | Meaning |
| --- | --- |
| `id` | The live session id, for `.../live/:sid/end` |
| `provider` | Which transport to open: `openai`, `gemini` or `stub` |
| `credential` | Short-lived, never a provider API key. OpenAI: a client secret (`ek_...`). Gemini: an ephemeral token name. Stub: a signed `stub_...` token |
| `model`, `voice` | What the credential is bound to (for display). A voice the model does not offer falls back to its first voice |
| `connectUrl` | OpenAI: the API's SDP relay. Others: `null` |
| `expiresAt` | After this the credential cannot open a new connection |
| `maxSeconds` | End the session by then. The server books at most this many seconds. It is the smaller of the tier's session length and the voice minutes left this month |
| `scenario` | What the tutor is doing, for the screen. Free conversation is `{ "id": null, "title": "Free conversation", ... }`. A scenario deleted since the session began keeps its title with `id: null` |
| `targetLanguage`, `nativeLanguage` | ISO-639-1 codes copied from the profile at the start |
| `speechLocale` | BCP-47 tag for the browser's speech recogniser and voice (stub transport) |
| `script` | Stub only: the tutor's lines in the target language, each followed by a translation in parentheses |

Errors: `409 PRACTICE_ENDED` (the session was ended), `404 PRACTICE_NOT_FOUND` (not yours),
`429 QUOTA_EXCEEDED` (under 30 seconds of voice left this month), `502 REALTIME_UNAVAILABLE`
(the provider refused; nothing is booked), `503 NO_REALTIME_MODEL` (an admin has not set up
a voice model). Rate limit: 60 an hour per user.

## 2. Connect

### OpenAI (`provider: "openai"`)

WebRTC, no SDK required:

1. Create an `RTCPeerConnection`. Add the microphone track (or a receive-only audio
   transceiver when typing). Create a data channel named `oai-events`.
2. Create an offer and set it as the local description.
3. `POST {connectUrl}` with `Content-Type: application/sdp`,
   `Authorization: Bearer {credential}`, body = the offer SDP (max 64 KB). Send no cookies.
4. Set the response body as the remote answer.
5. When the data channel opens, send `{ "type": "response.create" }` so the tutor speaks
   first.

Relay responses: the SDP answer with a `Location` header (exposed to the browser);
`401 REALTIME_SESSION_INVALID` when the credential is unknown, already used, outside its
connection window or not an OpenAI session; `400 SDP_REQUIRED` when the body is not an SDP
offer; `502` when OpenAI refused or could not be reached. Rate limit: 30 a minute per IP.

The input transcription language hint is the target language, so a beginner who answers in
their native language may be transcribed poorly. The tutor's instructions tell it to
translate in parentheses and to correct only real mistakes.

Events to read on the data channel:

| Event | Use |
| --- | --- |
| `input_audio_buffer.speech_started` / `speech_stopped` | Learner speaking indicator |
| `conversation.item.input_audio_transcription.completed` | A finished learner line (`transcript`) |
| `response.output_audio_transcript.delta` / `.done` (older: `response.audio_transcript.*`) | The tutor's line as it is spoken, then final. The native translation is the part in parentheses |
| `output_audio_buffer.stopped`, `response.done` | The tutor stopped speaking |
| `response.function_call_arguments.done` with `name: "end_session"` | The learner is done. Reply with a `function_call_output` item (`{"ok":true}`), do not request another response, and finish the session |
| `error` | Show the message |

To send a typed line: a `conversation.item.create` with a user `input_text` message, then
`response.create`.

Do **not** send `session.update`. The session was configured at mint.

### Gemini Live (`provider: "gemini"`)

Open a live session with `@google/genai` using the credential as the API key and
`apiVersion: "v1alpha"`, model = `grant.model`. The token's constraints fix the model,
instructions, tool, voice and transcription; any config the client passes is ignored.

- Stream microphone audio as 16 kHz PCM16.
- Play the model's 24 kHz PCM16; stop playback at once on `interrupted`.
- Read input and output transcriptions for the transcript.
- On a `toolCall` for `end_session`, send a tool response (`{ ok: true }`) and finish.
- To make the tutor speak first, send a short user turn such as "(The learner has joined and is ready.)".

The token works once and only until `expiresAt` for a new connection; the provider ends
the session at the end of its allowed length.

### Stub (`provider: "stub"`)

No network. Speak each line of `script` with the browser's speech synthesis in
`speechLocale` (or just show it), then let the learner type or dictate. The stub never
calls `end_session`: the learner ends the session. The translations in the script are
English whatever the learner's native language is. The stub provider is only available
where an admin configured it, which is refused in production.

## 3. End the live session: `POST /api/practice/:id/live/:sid/end`

No body. Response `LiveSessionEnd`:

```json
{ "seconds": 214, "voiceMinutesLeft": 96 }
```

`seconds` is measured on the server from minting to now, capped at `maxSeconds`.
`voiceMinutesLeft` is `null` when unlimited. Calling it again returns the same seconds. A
session that is never ended is expired by the server about
`REALTIME_CONNECT_TTL_SECONDS + maxSeconds + REALTIME_GRACE_SECONDS` after minting and
charged its full `maxSeconds`, so always end sessions, including when the user leaves.

## 4. End the practice session: `POST /api/practice/:id/end`

```json
{
  "transcript": [
    { "role": "tutor", "text": "Hola, ¿cómo estás? (Hello, how are you?)" },
    { "role": "learner", "text": "Hola, estoy bien, gracias." }
  ]
}
```

Only `role` (`tutor` or `learner`) and `text` are accepted per line. The server cleans the
transcript (the last 400 lines, 2,000 characters each, NUL bytes and empty lines removed),
closes any open live session of this practice session, sets the duration from its own
live-session clocks, and queues the lesson report. Response **202** `PracticeSession` with
`status: "ANALYZING"`. Calling it again while the report is being written, or after it is
done, returns the current state and queues nothing. `409 PRACTICE_FAILED` if the report
failed (use retry).

## 5. Poll the report: `GET /api/practice/:id`

The session moves `ANALYZING` to `COMPLETED`, or to `FAILED`.

- Poll every 1 to 2 seconds, backing off to 5. A report normally takes a few seconds with a
  text model and well under one second with the offline engine; stop and show a message
  after about 60 seconds (the report may still arrive: leave and come back).
- `COMPLETED`: `summary`, `scores` (four numbers from 1 to 10), `overallScore` (their mean,
  one decimal), `corrections`, `drills` (five, or none when the learner said nothing),
  `vocab` (up to ten suggestions, each with `saved`) are filled in.
- `FAILED`: `error` is a short, safe sentence. `POST /api/practice/:id/retry` (202) writes
  the report again from the stored transcript. Retry is for FAILED, or for a session
  still ANALYZING after five minutes (its job was lost); `409 PRACTICE_NOT_FAILED` otherwise.
- A learner who said nothing still gets `COMPLETED`, with every score at 1.
- Which engine wrote the report (the configured text model, or the deterministic offline
  stand-in used when none is set up or the model failed twice) is visible to admins in
  `GET /api/admin/practice` as `engine`; the learner's report has the same shape either way.
