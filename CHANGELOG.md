# Changelog

All notable changes to Euron Open Language AI are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (0.x: the HTTP contract may still change between
minor versions; fields are added rather than renamed).

## [0.1.0] - 2026-11-10

First release: a self-hosted AI language tutor over live voice, for one organisation or
community per deployment.

### Added

- **Learner experience.** Sign-up with email verification, optional two-factor sign-in; a
  four-step onboarding (native language, target language, CEFR level A1 to C2, goals, daily
  minutes); a practice picker with twelve starter scenarios and free conversation; a live
  voice room with a tutor orb, a live transcript and the tutor's translations shown dimmed;
  a lesson report after every session (summary, four scores, corrections, vocabulary to
  keep, five drills); a vocabulary deck with an SM-2 style daily review; a progress page
  (streak, minutes, a 28 day activity chart, score trend, most frequent mistakes).
- **Voice.** OpenAI Realtime over WebRTC (through an SDP relay that also lets the server hang
  calls up), Gemini Live over a WebSocket, and a stub transport that speaks scripted
  target-language lines with the browser's speech synthesis, so the whole product runs with
  no key. The tutor's instructions are built on the server and locked into a short-lived
  credential.
- **Lesson engine.** Two implementations behind one interface: an LLM engine using the
  configured text model (OpenAI, Anthropic, Gemini or any OpenAI-compatible server), and a
  deterministic offline engine used when no text model is configured, when the model fails
  twice, or when the learner said nothing. Each session records which engine wrote its
  report.
- **Languages.** Twenty-one languages in one table (`apps/api/src/domain/languages.ts`);
  seventeen are offered as a target.
- **Admin console.** Users, quota tiers and per-user overrides (monthly practice sessions,
  monthly voice minutes, longest session), providers and models with a Test button,
  practice-session metadata (never transcripts), scenario create, edit, reorder, hide and
  delete, deployment settings (tutor name and house rules, registration mode, retention),
  and an audit trail.
- **Platform.** Express 5 API and BullMQ worker, Next.js 15 web app, PostgreSQL with one SQL
  migration, Redis, native token mode for future mobile clients, an OpenAPI reference
  generated from the route files, Terraform for AWS (RDS, ElastiCache, ECS Fargate, SES,
  optional CloudFront and WAF) that also provisions a local AWS emulator, Docker Compose for
  local development, unit, integration and Playwright tests, a CI workflow and a
  sanitization scan.

### Limitations

- The offline lesson engine is a stand-in, not a grader: it counts and applies three spelling
  rules, and cannot judge grammar or pronunciation.
- The stub tutor's translations are always English, whatever the learner's native language.
- The transcript comes from the learner's browser, so a learner can fake their own side of a
  conversation; only their own report is affected.
- OpenAI Realtime sessions are not locked by the provider; a client with developer tools can
  send `session.update`. The session length, monthly minutes and server-side hang-up bound
  the abuse.
- The tutor's `end_session` tool is declared, but the web transports do not act on it: the
  learner presses End session.
- A `practice.analyze` job lost with Redis leaves its session in `ANALYZING`; after five minutes
  the learner can retry it, but nothing requeues it automatically.
- No SSO; passwords and TOTP only. No native app ships in this repository.

[0.1.0]: https://github.com/euron-sde-team/euron-open-language-ai/releases/tag/v0.1.0
