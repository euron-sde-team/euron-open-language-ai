# Troubleshooting

Symptoms, causes and fixes, grouped by where they show up. Every API error body carries a
stable `code` and a `requestId`; the same id is on the API's log line
([operations.md](operations.md#logs)).

## In the practice room

| Symptom | Cause | Fix |
| --- | --- | --- |
| "The microphone is blocked. Allow it in the browser's address bar, then try again." | The browser or the operating system denied microphone access, or the page is not on `https` or `localhost` (browsers only offer the microphone on secure origins) | Allow the microphone for the site (and for the browser in the OS privacy settings), then press **Start talking** again. Or choose **Continue by typing**: the lesson works with typed answers |
| "The voice connection could not be opened. This is usually a VPN, firewall or network that blocks real-time audio..." | OpenAI: the WebRTC peer connection failed or its data channel did not open within 15 s. Gemini: the WebSocket to Google could not be opened | Try another network (a phone hotspot works well) and retry. For OpenAI the handshake already goes through the API relay (`/api/realtime/openai/calls`), so blocking `api.openai.com` alone is not the problem; what is blocked is the WebRTC media (UDP). For Gemini the browser must reach `wss://generativelanguage.googleapis.com` |
| "The voice session expired." (`401 REALTIME_SESSION_INVALID`) | The relay accepts a credential once, inside its connection window (`REALTIME_CONNECT_TTL_SECONDS`, 120 s by default), and only while its live session is open | Press **Start talking** again: the room mints a new credential. If it happens every time, check the server clock and that nothing replays requests |
| "The voice service could not start a session. Try again in a moment." (`502 REALTIME_UNAVAILABLE`) | The provider refused to mint a credential: a wrong or unfunded key, a renamed model, or an outage | Press **Test** on the voice model in `/admin/models`; the API log has `live.mint` with the provider's HTTP status |
| "No voice model is set up yet. Ask an administrator to add one." (`503 NO_REALTIME_MODEL`) | No enabled REALTIME model with a usable provider. A production install has no stub, and the OpenAI and Gemini models stay hidden until their key is set | Put an `openai` or `gemini` key in `PROVIDER_KEYS` (or `OPENAI_API_KEY` / `GEMINI_API_KEY`), roll the API and worker, and check the model in `/admin/models` ([providers.md](providers.md)) |
| Gemini connects in development but not in production, and the browser console shows a CSP `connect-src` violation | `REALTIME_ORIGINS` on the web service does not include the Gemini WebSocket origin (the dev server allows any `wss:`) | Leave `REALTIME_ORIGINS` unset (the default allows Gemini) or include `wss://generativelanguage.googleapis.com` ([configuration.md](configuration.md#web-environment)) |
| The tutor cannot be heard | Autoplay was blocked, the output device is wrong, or the tab is muted | Click in the page once (**Start talking** is a click, which usually unlocks audio), check the output device and the tab's mute state |
| The tutor hears itself and keeps talking | Speakers feeding back into the microphone | Use headphones. The room asks for echo cancellation, but laptop speakers at high volume still leak |
| The tutor never says goodbye or ends the session | The model is told to call `end_session` but the web transports do not act on it (by design for now) | Press **End session** |
| The session ends by itself | The live session reached its maximum length (the tier's `max_session_minutes`, or less when few voice minutes are left this month) | Normal. The conversation so far is kept and the report is written. An admin can raise the tier's limits |
| "You have used this month's allowance. It resets on the 1st (UTC)." (`429 QUOTA_EXCEEDED`) | No practice sessions, or fewer than 30 seconds of voice, left this month | Wait for the reset, or ask an admin for a tier change or a per-user override ([quotas.md](../architecture/quotas.md)) |
| `409 PROFILE_INCOMPLETE` when starting | Onboarding is not finished | Finish the wizard at `/onboarding` |
| Starting "Talk about anything" is refused (`403 FEATURE_DISABLED`) | The free-conversation switch is off in `/admin/settings` | Pick a scenario, or turn the switch on |
| The stub tutor speaks English translations for every language, or only a short generic script | The stub's translations are always English, and only Spanish, French, German, Hindi and English have their own lines | Expected for the stub. Use OpenAI or Gemini for a real conversation; [add-a-language.md](add-a-language.md) shows how to give the stub more lines |
| The tutor answers in the wrong language, or transcribes badly | The language is not in the table, so transcription is `auto`, or the voice model is weak in that language | Check the row in `domain/languages.ts`; try the other realtime provider ([providers.md](providers.md#which-languages-work-well)) |

## After the session

| Symptom | Cause | Fix |
| --- | --- | --- |
| The report page keeps saying "Your tutor is reading the conversation and writing your lesson" (`ANALYZING`) | The worker is not running, so the `practice.analyze` job waits in Redis | Start the worker (`make logs SERVICE=worker` locally; the worker service on AWS). Jobs run when it returns |
| The report says it was "written by the offline engine" | No text model is set up, or the model failed twice | Expected without a text model. Set a TEXT model with a key and a default in `/admin/models` for model-written feedback ([lesson-engine.md](../architecture/lesson-engine.md)). Locally, the Stub lesson writer is the default text model; Admin, Practice shows the engine per session |
| The scores look generous, or there are no corrections for obvious mistakes | The offline engine counts and applies three spelling rules; it does not grade grammar | Use a text model |
| "The lesson report could not be written this time. Try again." (`FAILED`) | The job threw an unexpected error (the database, say) after the queue's retries | **Try again** (`POST /api/practice/:id/retry`), which writes it from the stored transcript. Retrying does not cost another session |
| Everything shows low scores and no drills | The learner said nothing: nothing was transcribed (microphone muted, or speech recognition unavailable) | Check the microphone and try again; typing works in the room |
| Vocabulary suggestions are empty | The offline engine only suggests phrases the tutor translated in parentheses; a stub or model that did not translate gives none | Use a model-written report, or a tutor that translates every sentence (the default prompt asks it to) |
| `409 DECK_FULL` | A deck holds at most 5,000 cards | Delete cards you no longer need |

## Local stack

| Symptom | Cause | Fix |
| --- | --- | --- |
| `port is already allocated` on `make up` | Another process uses 3640, 5116, 5562, 6499, 8116, 1116, 4667 or 5209 | Move it in `deploy/compose/.env`: `LANG_WEB_PORT`, `LANG_API_PORT`, `LANG_PG_PORT`, `LANG_REDIS_PORT`, `LANG_MAILPIT_PORT`, `LANG_SMTP_PORT`, `LANG_FLOCI_PORT`, `LANG_STUB_PORT` ([quickstart-local.md](quickstart-local.md#ports)) |
| `run make env first` | Compose started without the generated secrets | `make env` (or `make up`, which runs it) |
| The `terraform` or `migrate` one-shot fails | Emulator state and its Terraform state out of step, or a stale `.terraform` from running Terraform on the host | `make logs SERVICE=terraform` (or `migrate`); `make down && make up`; delete `infra/terraform/envs/local-floci/.terraform` |
| No email arrives | Locally every mail goes to Mailpit | http://localhost:8116 |
| Sign-in says `EMAIL_NOT_VERIFIED` | `REQUIRE_EMAIL_VERIFICATION=true` (the default) | Open the link in Mailpit, or set `REQUIRE_EMAIL_VERIFICATION=false` in `.env` for local work |
| A change to `.env` has no effect | Compose reads `.env` when it creates containers | `make up` again |
| A local Ollama cannot be reached from the API | `localhost` inside the API container is the container | Base URL `http://host.docker.internal:11434/v1` |
| `400 STUB_IN_PRODUCTION` | Creating a `STUB` provider with `NODE_ENV=production` | Use a real provider |

## Deployment

| Symptom | Cause | Fix |
| --- | --- | --- |
| The API exits at boot with "Refusing to start with an insecure configuration" | A production guard failed (development secrets, `CORS_ORIGINS` unset, `MAIL_MODE=outbox`, inline jobs, low bcrypt cost) | Fix each listed item ([configuration.md](configuration.md#production-guards)) |
| The boot log warns `no model provider key is configured` | `PROVIDER_KEYS` still holds `set-me` placeholders (no voice conversation can be held) | Put real keys in `<name_prefix>/provider-keys` and roll the api and worker ([deploy-aws.md](deploy-aws.md#provider-keys)) |
| Tasks die at start with `exec format error` | Images built for the wrong CPU architecture | Build with the `PLATFORM` that matches `cpu_architecture` |
| `make aws-admin` exits non-zero | The set-password mail could not be sent (unverified SES identity, or a sandboxed account and an unverified recipient) | Verify the identity, or the recipient while in the SES sandbox |
| Signed out on every reload | The refresh cookie is not first-party or not `Secure` over https | Serve the web app and `/api` on one https host; `COOKIE_SECURE=auto` follows `APP_WEB_URL` |
