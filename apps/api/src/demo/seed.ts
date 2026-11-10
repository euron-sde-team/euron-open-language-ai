/**
 * Demo data so a fresh install has something to look at. Run with `make demo` (or
 * `node dist/cli.js demo:seed`).
 *
 *   - the starter model catalogue plus the local stub provider (the tutor's voice and the
 *     lesson report both work through it without any key), and the twelve scenarios
 *   - an admin and four learners; the main one, Lee (English speaker learning Spanish, B1,
 *     onboarding done), has six finished sessions over the last three weeks with scores
 *     that climb, corrections, drills and suggested vocabulary, a three-day streak, and a
 *     deck of about 25 cards with several due today
 *   - a few finished sessions for the others and usage for the admin overview
 *
 * Refuses to run with NODE_ENV=production. If the demo admin exists it prints the logins
 * and exits.
 */
import crypto from "node:crypto";
import { sql } from "kysely";
import type { LessonScores } from "@open-language/types";
import { config } from "../core/config";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { closeRedis } from "../integrations/redis";
import { closeQueues } from "../jobs/registry";
import { hashPassword } from "../security/passwords";
import { drillsFor, overallOf } from "../services/practice/lesson";
import { ensureStarterCatalog } from "./catalog";
import { EXTRA_VOCAB, LEE_SESSIONS, OTHER_SESSIONS, type DemoSession } from "./content";
import { ensureStarterScenarios } from "./scenarios";

const ADMIN_EMAIL = "admin@example.com";
const LEARNER_EMAIL = "lee@example.com";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const PEOPLE = [
  { email: LEARNER_EMAIL, username: "lee", name: "Lee Marsh", main: true },
  { email: "sam.rivera@example.com", username: "sam-rivera", name: "Sam Rivera" },
  { email: "amara.okafor@example.com", username: "amara-okafor", name: "Amara Okafor" },
  { email: "jun.park@example.com", username: "jun-park", name: "Jun Park" },
];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261110);

interface Models {
  text: string;
  voice: string;
}

interface SessionSeed extends Omit<DemoSession, "transcript" | "corrections" | "vocab"> {
  transcript?: DemoSession["transcript"];
  corrections?: DemoSession["corrections"];
  vocab?: DemoSession["vocab"];
}

export async function seedDemo(): Promise<void> {
  if (config.NODE_ENV === "production") throw new Error("demo:seed refuses to run in production");
  const password = config.DEMO_PASSWORD ?? crypto.randomBytes(9).toString("base64url");
  const existing = await db.selectFrom("users").select("id").where("email", "=", ADMIN_EMAIL).executeTakeFirst();
  if (existing) {
    printLogins(config.DEMO_PASSWORD ? password : null);
    return;
  }
  const models = await ensureStarterCatalog(db, { includeStub: true });
  if (!models) throw new Error("the stub provider was not created");
  await ensureStarterScenarios(db);
  const hash = await hashPassword(password);
  const now = Date.now();

  await db
    .insertInto("users")
    .values({ id: newId(), email: ADMIN_EMAIL, username: "admin", display_name: "Morgan Ellis", password_hash: hash, role: "ADMIN", status: "ACTIVE", email_verified_at: new Date(now - 40 * DAY), created_at: new Date(now - 40 * DAY) })
    .execute();
  const coachingTier = newId();
  await db.insertInto("quota_tiers").values({ id: coachingTier, name: "Coaching cohort", monthly_sessions: 60, monthly_voice_minutes: 600, max_session_minutes: 20 }).execute();

  const ids: Record<string, string> = {};
  for (const [i, p] of PEOPLE.entries()) {
    const id = newId();
    ids[p.username] = id;
    await db
      .insertInto("users")
      .values({
        id,
        email: p.email,
        username: p.username,
        display_name: p.name,
        password_hash: hash,
        role: "USER",
        status: "ACTIVE",
        email_verified_at: new Date(now - (30 - i) * DAY),
        created_at: new Date(now - (30 - i) * DAY),
        quota_tier_id: i === 0 ? coachingTier : null,
        last_seen_at: new Date(now - i * HOUR),
      })
      .execute();
  }

  // Lee: the learner the demo is about.
  const lee = ids["lee"]!;
  await db.insertInto("user_preferences").values({ user_id: lee, voice: "default", default_realtime_model_id: models.voice }).execute();
  await db.insertInto("learner_profiles").values({ user_id: lee, native_language: "en", target_language: "es", level: "B1", goals: ["TRAVEL", "BUSINESS"], daily_minutes_target: 10, onboarding_complete: true, created_at: new Date(now - 22 * DAY) }).execute();
  const leeSessionIds: string[] = [];
  for (const s of LEE_SESSIONS) leeSessionIds.push(await seedSession(lee, { language: "es", native: "en", level: "B1" }, s, models, now));
  await seedDeck(lee, leeSessionIds, now);

  // The others: a couple of finished sessions each.
  const others = [
    { username: "sam-rivera", ...OTHER_SESSIONS[0]! },
    { username: "amara-okafor", ...OTHER_SESSIONS[1]! },
    { username: "jun-park", ...OTHER_SESSIONS[2]! },
  ];
  for (const o of others) {
    const userId = ids[o.username]!;
    await db.insertInto("learner_profiles").values({ user_id: userId, native_language: o.native, target_language: o.language, level: o.level, goals: ["DAILY"], onboarding_complete: true }).execute();
    for (const s of o.sessions) await seedSession(userId, { language: o.language, native: o.native, level: o.level }, s, models, now);
  }

  // Older usage for the admin overview (the sessions above booked their own).
  for (const userId of Object.values(ids)) {
    for (let d = 22; d < 30; d++) {
      if (rand() < 0.5) continue;
      const day = new Date(now - d * DAY).toISOString().slice(0, 10);
      await db
        .insertInto("usage_daily")
        .values({ user_id: userId, day: sql<Date>`${day}::date`, model_id: models.voice, sessions: rand() < 0.6 ? 1 : 0, voice_seconds: Math.floor(240 + rand() * 900) })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  }
  printLogins(password);
  await closeQueues();
  await closeRedis();
}

/** One finished practice session with its live session, report rows and usage. Returns its id. */
async function seedSession(userId: string, who: { language: string; native: string; level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2" }, s: SessionSeed, models: Models, now: number): Promise<string> {
  const scenario = s.scenario ? await db.selectFrom("scenarios").select("id").where("title", "=", s.scenario).executeTakeFirst() : undefined;
  // Midday UTC of that day, so consecutive days stay consecutive whatever time the seed runs.
  const midnight = Math.floor(now / DAY) * DAY;
  const started = new Date(midnight - s.daysAgo * DAY + 10 * HOUR);
  const seconds = Math.round(s.minutes * 60 * (0.9 + rand() * 0.2));
  const ended = new Date(started.getTime() + seconds * 1000);
  const id = newId();
  const vocab = (s.vocab ?? []).map((v) => ({ phrase: v.phrase, meaningNative: v.meaning, examples: v.example ? [v.example] : [] }));
  const corrections = s.corrections ?? [];
  const drills = drillsFor(
    [...vocab.map((v) => ({ phrase: v.phrase, meaning: v.meaningNative })), ...corrections.map((c) => ({ phrase: c.corrected, meaning: null }))],
    who.language === "es" ? "Spanish" : who.language === "fr" ? "French" : "German",
  );
  const scores: LessonScores = s.scores;
  await db
    .insertInto("practice_sessions")
    .values({
      id,
      user_id: userId,
      scenario_id: scenario?.id ?? null,
      title: s.scenario ?? "Free conversation",
      status: "COMPLETED",
      target_language: who.language,
      native_language: who.native,
      level: who.level,
      transcript: JSON.stringify(s.transcript ?? []),
      summary: s.summary,
      vocab_suggestions: JSON.stringify(vocab),
      scores: JSON.stringify(scores),
      overall_score: overallOf(scores),
      engine: "llm",
      text_model_id: models.text,
      realtime_model_id: models.voice,
      started_at: started,
      ended_at: ended,
      duration_sec: seconds,
      created_at: started,
      updated_at: ended,
    })
    .execute();
  if (corrections.length) {
    await db
      .insertInto("corrections")
      .values(corrections.map((c, i) => ({ id: newId(), practice_session_id: id, position: i, type: c.type, original: c.original, corrected: c.corrected, explanation: c.explanation })))
      .execute();
  }
  if (drills.length) {
    await db
      .insertInto("drills")
      .values(drills.map((d, i) => ({ id: newId(), practice_session_id: id, position: i, type: d.type, question: d.question, answer: d.answer, hints: JSON.stringify(d.hints) })))
      .execute();
  }
  await db
    .insertInto("live_sessions")
    .values({ id: newId(), practice_session_id: id, user_id: userId, model_id: models.voice, provider_kind: "STUB", status: "ENDED", max_seconds: 900, seconds, created_at: started, expires_at: new Date(started.getTime() + 1_100_000), ended_at: ended })
    .execute();
  const day = started.toISOString().slice(0, 10);
  await db
    .insertInto("usage_daily")
    .values({ user_id: userId, day: sql<Date>`${day}::date`, model_id: models.voice, sessions: 1, voice_seconds: seconds })
    .onConflict((oc) => oc.columns(["user_id", "day", "model_id"]).doUpdateSet((eb) => ({ sessions: eb("usage_daily.sessions", "+", 1), voice_seconds: eb("usage_daily.voice_seconds", "+", seconds) })))
    .execute();
  await db
    .insertInto("usage_daily")
    .values({ user_id: userId, day: sql<Date>`${day}::date`, model_id: models.text, calls: 1, input_tokens: 2400 + Math.floor(rand() * 800), output_tokens: 900 + Math.floor(rand() * 300) })
    .onConflict((oc) => oc.columns(["user_id", "day", "model_id"]).doUpdateSet((eb) => ({ calls: eb("usage_daily.calls", "+", 1), input_tokens: eb("usage_daily.input_tokens", "+", eb.ref("excluded.input_tokens")), output_tokens: eb("usage_daily.output_tokens", "+", eb.ref("excluded.output_tokens")) })))
    .execute();
  return id;
}

/** About 25 cards: every phrase the lessons suggested plus the extras, some due today, a few mastered. */
async function seedDeck(userId: string, sessionIds: string[], now: number): Promise<void> {
  const cards: { phrase: string; meaning: string; sessionId: string | null; days: number; due: boolean }[] = [];
  for (const [i, s] of LEE_SESSIONS.entries()) {
    // Most of what the lessons suggested was saved by the learner; the newest two are still only suggestions.
    if (i >= LEE_SESSIONS.length - 2) continue;
    for (const v of s.vocab) cards.push({ phrase: v.phrase, meaning: v.meaning, sessionId: sessionIds[i] ?? null, days: LEE_SESSIONS[i]!.daysAgo, due: i >= 2 && rand() < 0.5 });
  }
  for (const v of EXTRA_VOCAB) cards.push({ phrase: v.phrase, meaning: v.meaning, sessionId: null, days: v.days, due: v.due });
  for (const [i, c] of cards.entries()) {
    const age = Math.max(1, c.days);
    // Older cards have been reviewed more: longer intervals, a few mastered at 21 days or more.
    const repetitions = c.due ? Math.min(3, Math.floor(age / 6)) : Math.min(6, 1 + Math.floor(age / 5));
    const interval = repetitions === 0 ? 0 : repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(6 * 2.4 ** (repetitions - 2));
    const created = new Date(now - age * DAY);
    const dueAt = c.due ? new Date(now - (1 + (i % 3)) * HOUR) : new Date(now + Math.max(1, interval - (i % 4)) * DAY);
    await db
      .insertInto("vocab_items")
      .values({
        id: newId(),
        user_id: userId,
        target_language: "es",
        phrase: c.phrase,
        meaning_native: c.meaning,
        examples: JSON.stringify([]),
        source_session_id: c.sessionId,
        ease: 2.3 + (i % 5) * 0.1,
        interval_days: interval,
        repetitions,
        next_review_at: dueAt,
        created_at: created,
        updated_at: created,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
}

function printLogins(password: string | null): void {
  const lines = [
    "",
    "  Demo accounts (all share one password):",
    `    admin     ${ADMIN_EMAIL}`,
    ...PEOPLE.map((p) => `    ${p.main ? "learner  " : "learner  "} ${p.email}${p.main ? "   (Spanish, B1, six finished lessons, cards due today)" : ""}`),
    password ? "" : "  The password was printed when the demo was first seeded (DEMO_PASSWORD in deploy/compose/.env).",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
