-- Euron Open Language AI: initial schema.
--
-- Conventions
--   * Primary keys are ULIDs stored as text (sortable by creation time).
--   * Timestamps are timestamptz(3); the API runs with TZ=UTC. Millisecond precision is
--     exactly what a JS Date holds, so a keyset cursor built from a Date round-trips
--     without skipping or repeating rows.
--   * Lists page with keyset cursors, never OFFSET.
--   * One deployment serves one organisation or community: there is no tenant column.
--   * Provider API keys never live in this database. They come from the environment or
--     Secrets Manager (core/config.ts PROVIDER_KEYS), and no endpoint ever returns one.
--   * Usage rows hold counts, seconds and model ids only, never transcript text.
--   * A practice session's transcript lives on its row and goes with it (delete, account
--     erase, retention). Admins read metadata only.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Enums ──────────────────────────────────────────────────────────────────

-- USER: everyone. ADMIN: the control plane (users, models, quotas, settings, audit).
CREATE TYPE user_role AS ENUM ('USER', 'ADMIN');
CREATE TYPE user_status AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DEACTIVATED');
CREATE TYPE auth_token_type AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- OPENAI_COMPATIBLE covers Groq, OpenRouter, Together, Ollama, vLLM and anything else that
-- speaks the Chat Completions wire format (text models only).
CREATE TYPE provider_kind AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI', 'OPENAI_COMPATIBLE', 'STUB');
-- TEXT models write the lesson report (when one is configured). REALTIME models hold the live
-- voice conversation (OpenAI Realtime, Gemini Live, or the stub).
CREATE TYPE model_kind AS ENUM ('TEXT', 'REALTIME');

-- IN_PROGRESS: the learner is (or was) talking. ANALYZING: the lesson engine is writing the
-- report. COMPLETED: the report is ready. FAILED: the engine could not run; retry is allowed.
CREATE TYPE practice_status AS ENUM ('IN_PROGRESS', 'ANALYZING', 'COMPLETED', 'FAILED');
CREATE TYPE cefr_level AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');
CREATE TYPE correction_type AS ENUM ('grammar', 'pronunciation', 'word_choice', 'other');
CREATE TYPE drill_type AS ENUM ('fill_blank', 'translation', 'speak_this');
-- OPEN: a credential was minted and the session may be live. ENDED: closed by the
-- browser. EXPIRED: closed by the sweeper after the browser vanished.
CREATE TYPE live_status AS ENUM ('OPEN', 'ENDED', 'EXPIRED');

-- ─── Identity ───────────────────────────────────────────────────────────────

-- Quota tiers. Every user is on one (or the default); admins create as many as they like
-- ("Default", "Coaching cohort", "Staff") and may override one user's numbers on top.
-- NULL means unlimited. Months are calendar months in UTC.
CREATE TABLE quota_tiers (
  id                    text PRIMARY KEY,
  name                  text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 60),
  monthly_sessions      integer CHECK (monthly_sessions >= 0),
  monthly_voice_minutes integer CHECK (monthly_voice_minutes >= 0),
  -- The longest one live session may run before the server stops minting for it.
  max_session_minutes   integer NOT NULL DEFAULT 15 CHECK (max_session_minutes BETWEEN 1 AND 120),
  is_default            boolean NOT NULL DEFAULT false,
  created_at            timestamptz(3) NOT NULL DEFAULT now(),
  updated_at            timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX quota_tiers_one_default ON quota_tiers (is_default) WHERE is_default;

CREATE TABLE users (
  id                    text PRIMARY KEY,
  email                 citext NOT NULL UNIQUE,
  username              citext NOT NULL UNIQUE CHECK (username ~ '^[a-zA-Z0-9][a-zA-Z0-9-]{1,38}[a-zA-Z0-9]$'),
  -- Cleaned at write time (domain/display-name.ts): never an email address or a phone number.
  display_name          text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  password_hash         text NOT NULL,
  role                  user_role NOT NULL DEFAULT 'USER',
  status                user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  email_verified_at     timestamptz(3),
  totp_secret           text,                    -- AES-256-GCM ciphertext (security/totp.ts), never the raw secret
  totp_enabled          boolean NOT NULL DEFAULT false,
  totp_last_step        bigint,                  -- last accepted TOTP time step: a code works once
  suspended_until       timestamptz(3),
  token_version         integer NOT NULL DEFAULT 0,
  quota_tier_id         text REFERENCES quota_tiers (id) ON DELETE SET NULL,
  -- Set when the user asks to delete the account; the purge job erases it after the
  -- grace period unless they sign in and cancel.
  deletion_requested_at timestamptz(3),
  last_seen_at          timestamptz(3),
  created_at            timestamptz(3) NOT NULL DEFAULT now(),
  updated_at            timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX users_name_trgm_idx ON users USING gin ((display_name || ' ' || username::text || ' ' || email::text) gin_trgm_ops);
CREATE INDEX users_admin_idx ON users (role) WHERE role <> 'USER';

CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id    text NOT NULL,                  -- every rotation of one login shares a family
  token_hash   text NOT NULL UNIQUE,           -- sha256 of the refresh token
  user_agent   text,
  ip           inet,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  last_used_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at   timestamptz(3) NOT NULL,
  revoked_at   timestamptz(3),
  replaced_by  text
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_family_idx ON sessions (family_id);

CREATE TABLE auth_tokens (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       auth_token_type NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz(3) NOT NULL,
  used_at    timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, type);

-- Single-use two-factor recovery codes, issued ten at a time when TOTP is turned on.
-- Only an HMAC of each code is stored (keyed from TOTP_ENCRYPTION_KEY).
CREATE TABLE totp_recovery_codes (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code_hash)
);

-- How the tutor sounds for this user. Missing row = defaults
-- (services/preferences.service.ts).
CREATE TABLE user_preferences (
  user_id                text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- A realtime voice name ("alloy", "Kore", ...); the provider ignores names it lacks.
  voice                  text NOT NULL DEFAULT 'alloy' CHECK (length(voice) <= 40),
  default_realtime_model_id text,              -- FK added after models exists
  updated_at             timestamptz(3) NOT NULL DEFAULT now()
);

-- ─── Providers and models ───────────────────────────────────────────────────

-- A provider is an endpoint. Its key is looked up by slug in PROVIDER_KEYS at call time.
CREATE TABLE providers (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),   -- the slug
  kind         provider_kind NOT NULL,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  base_url     text CHECK (length(base_url) <= 300),
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  updated_at   timestamptz(3) NOT NULL DEFAULT now()
);

-- The one model catalogue the runtime reads. Prices are optional and only feed the
-- admin's cost estimate; nothing is billed.
CREATE TABLE models (
  id                    text PRIMARY KEY,
  provider_id           text NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
  kind                  model_kind NOT NULL DEFAULT 'TEXT',
  model_ref             text NOT NULL CHECK (length(model_ref) BETWEEN 1 AND 120),   -- the provider's model id
  display_name          text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  description           text NOT NULL DEFAULT '' CHECK (length(description) <= 200),
  max_output_tokens     integer NOT NULL DEFAULT 8192 CHECK (max_output_tokens > 0),
  -- REALTIME only: the voices this model offers, the first being the default.
  voices                text[] NOT NULL DEFAULT '{}',
  input_usd_per_mtok    numeric(10, 4) CHECK (input_usd_per_mtok >= 0),
  output_usd_per_mtok   numeric(10, 4) CHECK (output_usd_per_mtok >= 0),
  usd_per_minute        numeric(10, 4) CHECK (usd_per_minute >= 0),
  enabled               boolean NOT NULL DEFAULT true,
  is_default            boolean NOT NULL DEFAULT false,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz(3) NOT NULL DEFAULT now(),
  updated_at            timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (provider_id, model_ref, kind)
);
CREATE UNIQUE INDEX models_one_default_per_kind ON models (kind) WHERE is_default;

ALTER TABLE user_preferences ADD CONSTRAINT user_preferences_model_fk FOREIGN KEY (default_realtime_model_id) REFERENCES models (id) ON DELETE SET NULL;

-- ─── Language practice ──────────────────────────────────────────────────────

-- One row per learner: who they are as a speaker. Created with defaults on first read.
CREATE TABLE learner_profiles (
  user_id             text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  native_language     text NOT NULL DEFAULT 'en' CHECK (native_language ~ '^[a-z]{2}$'),
  target_language     text NOT NULL DEFAULT 'es' CHECK (target_language ~ '^[a-z]{2}$'),
  level               cefr_level NOT NULL DEFAULT 'A1',
  goals               text[] NOT NULL DEFAULT '{DAILY}' CHECK (goals <@ ARRAY['TRAVEL', 'INTERVIEW', 'BUSINESS', 'DAILY', 'ACADEMIC']),
  daily_minutes_target integer NOT NULL DEFAULT 10 CHECK (daily_minutes_target BETWEEN 1 AND 240),
  onboarding_complete boolean NOT NULL DEFAULT false,
  created_at          timestamptz(3) NOT NULL DEFAULT now(),
  updated_at          timestamptz(3) NOT NULL DEFAULT now()
);

-- Role-play situations the learner can pick. `prompt_template` is staff-only: it goes into
-- the tutor's instructions on the server and is never returned to a learner.
CREATE TABLE scenarios (
  id              text PRIMARY KEY,
  title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  description     text NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  level_min       cefr_level NOT NULL DEFAULT 'A1',
  level_max       cefr_level NOT NULL DEFAULT 'C2',
  goals           text[] NOT NULL DEFAULT '{}' CHECK (goals <@ ARRAY['TRAVEL', 'INTERVIEW', 'BUSINESS', 'DAILY', 'ACADEMIC']),
  prompt_template text NOT NULL CHECK (length(prompt_template) BETWEEN 1 AND 4000),
  sort_order      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz(3) NOT NULL DEFAULT now(),
  updated_at      timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX scenarios_order_idx ON scenarios (sort_order, created_at);

-- One conversation with the tutor. Languages and level are copied from the profile when it
-- starts, so a later change of profile does not rewrite history. `scenario_id` is NULL for
-- free conversation (and after a scenario is deleted; `title` keeps what it was called).
-- `transcript` is [{ role: "tutor" | "learner", text }], cleaned and clamped by the server.
-- `scores` is { fluency, accuracy, vocabRange, confidence } (1 to 10), written only by the
-- lesson engine job. `engine` records which engine wrote the report.
CREATE TABLE practice_sessions (
  id                text PRIMARY KEY,
  user_id           text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scenario_id       text REFERENCES scenarios (id) ON DELETE SET NULL,
  title             text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  status            practice_status NOT NULL DEFAULT 'IN_PROGRESS',
  target_language   text NOT NULL CHECK (target_language ~ '^[a-z]{2}$'),
  native_language   text NOT NULL CHECK (native_language ~ '^[a-z]{2}$'),
  level             cefr_level NOT NULL,
  transcript        jsonb NOT NULL DEFAULT '[]',
  summary           text CHECK (length(summary) <= 2000),
  -- Phrases worth keeping, offered for the deck: [{ phrase, meaningNative, examples }].
  vocab_suggestions jsonb NOT NULL DEFAULT '[]',
  scores            jsonb,
  overall_score     numeric(3, 1) CHECK (overall_score BETWEEN 1 AND 10),
  engine            text CHECK (engine IN ('llm', 'offline')),
  error             text CHECK (length(error) <= 300),
  text_model_id     text REFERENCES models (id) ON DELETE SET NULL,
  realtime_model_id text REFERENCES models (id) ON DELETE SET NULL,
  started_at        timestamptz(3) NOT NULL DEFAULT now(),
  ended_at          timestamptz(3),
  duration_sec      integer CHECK (duration_sec >= 0),
  created_at        timestamptz(3) NOT NULL DEFAULT now(),
  updated_at        timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX practice_sessions_user_idx ON practice_sessions (user_id, created_at DESC, id DESC);
CREATE INDEX practice_sessions_recent_idx ON practice_sessions (created_at DESC, id DESC);
-- The dashboard (streak, trend) reads a learner's finished sessions.
CREATE INDEX practice_sessions_user_ended_idx ON practice_sessions (user_id, ended_at) WHERE ended_at IS NOT NULL;

-- One realtime connection. The server mints a short-lived, locked credential per
-- practice session and records it here; minutes are booked when the browser ends the
-- session or the sweeper expires it.
CREATE TABLE live_sessions (
  id                  text PRIMARY KEY,
  practice_session_id text NOT NULL REFERENCES practice_sessions (id) ON DELETE CASCADE,
  user_id             text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  model_id            text REFERENCES models (id) ON DELETE SET NULL,
  provider_kind       provider_kind NOT NULL,
  status              live_status NOT NULL DEFAULT 'OPEN',
  -- The SDP relay accepts only credentials it has seen minted (hash, never the value).
  credential_hash     text,
  -- OpenAI WebRTC: the call id from the relayed SDP answer, so the server can hang up.
  provider_call_id    text,
  max_seconds         integer NOT NULL CHECK (max_seconds > 0),
  seconds             integer NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  created_at          timestamptz(3) NOT NULL DEFAULT now(),
  expires_at          timestamptz(3) NOT NULL,
  ended_at            timestamptz(3)
);
-- At most one open live session per user, enforced by the database.
CREATE UNIQUE INDEX live_sessions_one_open ON live_sessions (user_id) WHERE status = 'OPEN';
CREATE INDEX live_sessions_practice_idx ON live_sessions (practice_session_id, created_at);
CREATE INDEX live_sessions_user_month_idx ON live_sessions (user_id, created_at);
CREATE INDEX live_sessions_credential_idx ON live_sessions (credential_hash) WHERE status = 'OPEN';

-- What the lesson engine found worth fixing, in the order it found them.
CREATE TABLE corrections (
  id                  text PRIMARY KEY,
  practice_session_id text NOT NULL REFERENCES practice_sessions (id) ON DELETE CASCADE,
  position            integer NOT NULL DEFAULT 0,
  type                correction_type NOT NULL,
  original            text NOT NULL CHECK (length(original) <= 500),
  corrected           text NOT NULL CHECK (length(corrected) <= 500),
  -- In the learner's native language.
  explanation         text CHECK (length(explanation) <= 800),
  created_at          timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX corrections_practice_idx ON corrections (practice_session_id, position);

-- The five micro-drills that close a lesson.
CREATE TABLE drills (
  id                  text PRIMARY KEY,
  practice_session_id text NOT NULL REFERENCES practice_sessions (id) ON DELETE CASCADE,
  position            integer NOT NULL DEFAULT 0,
  type                drill_type NOT NULL,
  question            text NOT NULL CHECK (length(question) <= 500),
  answer              text NOT NULL CHECK (length(answer) <= 500),
  hints               jsonb NOT NULL DEFAULT '[]',
  created_at          timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX drills_practice_idx ON drills (practice_session_id, position);

-- The learner's deck. SM-2 style scheduling: `ease` starts at 2.5, `interval_days` is the
-- gap to the next review, `repetitions` counts correct reviews in a row. An item with an
-- interval of 21 days or more is mastered. The unique index makes saving the same phrase
-- twice a no-op (case-insensitive, per target language).
CREATE TABLE vocab_items (
  id                text PRIMARY KEY,
  user_id           text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_language   text NOT NULL CHECK (target_language ~ '^[a-z]{2}$'),
  phrase            text NOT NULL CHECK (length(phrase) BETWEEN 1 AND 200),
  meaning_native    text NOT NULL CHECK (length(meaning_native) BETWEEN 1 AND 300),
  examples          jsonb NOT NULL DEFAULT '[]',
  source_session_id text REFERENCES practice_sessions (id) ON DELETE SET NULL,
  ease              numeric(4, 2) NOT NULL DEFAULT 2.5 CHECK (ease >= 1.3),
  interval_days     integer NOT NULL DEFAULT 0 CHECK (interval_days >= 0),
  repetitions       integer NOT NULL DEFAULT 0 CHECK (repetitions >= 0),
  next_review_at    timestamptz(3) NOT NULL DEFAULT now(),
  created_at        timestamptz(3) NOT NULL DEFAULT now(),
  updated_at        timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vocab_items_phrase_key ON vocab_items (user_id, target_language, lower(phrase));
CREATE INDEX vocab_items_due_idx ON vocab_items (user_id, next_review_at);
CREATE INDEX vocab_items_recent_idx ON vocab_items (user_id, created_at DESC, id DESC);

-- One row per graded review, so "done today" survives a deck that reschedules everything.
CREATE TABLE review_log (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  vocab_id    text REFERENCES vocab_items (id) ON DELETE SET NULL,
  grade       text NOT NULL CHECK (grade IN ('again', 'hard', 'good', 'easy')),
  reviewed_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX review_log_user_idx ON review_log (user_id, reviewed_at);

-- ─── Quotas and usage ───────────────────────────────────────────────────────

-- One user's numbers on top of their tier. NULL columns fall back to the tier.
CREATE TABLE user_quota_overrides (
  user_id               text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  monthly_sessions      integer CHECK (monthly_sessions >= 0),
  monthly_voice_minutes integer CHECK (monthly_voice_minutes >= 0),
  note                  text CHECK (length(note) <= 300),
  updated_by            text REFERENCES users (id) ON DELETE SET NULL,
  updated_at            timestamptz(3) NOT NULL DEFAULT now()
);

-- Daily totals per user and model, in the UTC day. Counts only (ADR 0006).
CREATE TABLE usage_daily (
  user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day           date NOT NULL,
  model_id      text NOT NULL REFERENCES models (id) ON DELETE CASCADE,
  calls         integer NOT NULL DEFAULT 0,
  -- Practice sessions started (booked against the text model that will write the report,
  -- or the realtime model). Kept here, not counted from practice_sessions, so deleting a
  -- session does not give the quota back.
  sessions      integer NOT NULL DEFAULT 0,
  input_tokens  bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  voice_seconds bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, model_id)
);
CREATE INDEX usage_daily_day_idx ON usage_daily (day);

-- ─── Operations ─────────────────────────────────────────────────────────────

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by text REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          text PRIMARY KEY,
  actor_id    text REFERENCES users (id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  ip          inet,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_recent_idx ON audit_log (created_at DESC, id DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at DESC);

-- ─── Seed rows ──────────────────────────────────────────────────────────────

-- The default tier: a session a day, small enough to protect a key.
INSERT INTO quota_tiers (id, name, monthly_sessions, monthly_voice_minutes, max_session_minutes, is_default)
VALUES ('01JDK4V7Q80000000000000000', 'Default', 30, 300, 15, true);
