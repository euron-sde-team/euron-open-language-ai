/**
 * The progress dashboard, computed in SQL from the learner's own rows. Days are UTC days.
 * A session counts toward a day from the moment it ends (ended_at), whether or not its
 * report succeeded; deleting a session removes it from the history.
 */
import type { Dashboard, DayActivity, PracticeSummary, ScorePoint } from "@open-language/types";
import { sql } from "kysely";
import { type Actor, requireActor } from "../core/context";
import { db } from "../db/kysely";
import { toProfile, toSummary } from "../presenters/practice.presenter";
import { profileRow } from "./profile.service";
import { MASTERED_DAYS } from "./practice/srs";

const DAY_MS = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const minutes = (sec: number) => Math.round(sec / 60);

/** Consecutive days ending today or yesterday, from distinct days (any order). */
export function streakOf(days: Iterable<string>, today: Date): number {
  const set = new Set(days);
  let cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (!set.has(day(cursor))) cursor = new Date(cursor.getTime() - DAY_MS);
  let n = 0;
  while (set.has(day(cursor))) {
    n++;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }
  return n;
}

export async function dashboardOf(actor: Actor, now = new Date()): Promise<Dashboard> {
  const a = requireActor(actor);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from28 = new Date(today.getTime() - 27 * DAY_MS);
  const from7 = new Date(today.getTime() - 6 * DAY_MS);
  const from30 = new Date(now.getTime() - 30 * DAY_MS);
  const utcDay = sql<string>`to_char(ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

  const [profile, byDay, totals, deck, due, trend, recent, weak] = await Promise.all([
    profileRow(a.id),
    db
      .selectFrom("practice_sessions")
      .select([utcDay.as("d"), sql<number>`count(*)::int`.as("sessions"), sql<number>`coalesce(sum(duration_sec), 0)::int`.as("seconds")])
      .where("user_id", "=", a.id)
      .where("ended_at", "is not", null)
      .groupBy(utcDay)
      .orderBy(sql`1`, "desc")
      .limit(400)
      .execute(),
    db
      .selectFrom("practice_sessions")
      .select([sql<number>`count(*)::int`.as("sessions"), sql<number>`coalesce(sum(duration_sec), 0)::int`.as("seconds")])
      .where("user_id", "=", a.id)
      .where("ended_at", "is not", null)
      .executeTakeFirst(),
    db
      .selectFrom("vocab_items")
      .select([sql<number>`count(*)::int`.as("total"), sql<number>`count(*) FILTER (WHERE interval_days >= ${MASTERED_DAYS})::int`.as("mastered")])
      .where("user_id", "=", a.id)
      .executeTakeFirst(),
    db.selectFrom("vocab_items").select(sql<number>`count(*)::int`.as("n")).where("user_id", "=", a.id).where("next_review_at", "<=", now).executeTakeFirst(),
    db.selectFrom("practice_sessions").selectAll().where("user_id", "=", a.id).where("status", "=", "COMPLETED").where("scores", "is not", null).orderBy("ended_at", "desc").orderBy("id", "desc").limit(20).execute(),
    db.selectFrom("practice_sessions").selectAll().where("user_id", "=", a.id).orderBy("created_at", "desc").orderBy("id", "desc").limit(5).execute(),
    db
      .selectFrom("corrections as c")
      .innerJoin("practice_sessions as p", "p.id", "c.practice_session_id")
      .select(["c.type", sql<number>`count(*)::int`.as("n")])
      .where("p.user_id", "=", a.id)
      .where("p.created_at", ">=", from30)
      .groupBy("c.type")
      .orderBy(sql`2`, "desc")
      .orderBy("c.type")
      .limit(4)
      .execute(),
  ]);

  const perDay = new Map(byDay.map((r) => [r.d, r]));
  const activity: DayActivity[] = [];
  for (let t = from28.getTime(); t <= today.getTime(); t += DAY_MS) {
    const r = perDay.get(day(new Date(t)));
    activity.push({ date: day(new Date(t)), minutes: minutes(Number(r?.seconds ?? 0)), sessions: Number(r?.sessions ?? 0) });
  }
  const sumSince = (from: Date) => byDay.filter((r) => r.d >= day(from)).reduce((s, r) => s + Number(r.seconds), 0);
  const scoreTrend: ScorePoint[] = trend
    .reverse()
    .map((r) => ({ sessionId: r.id, at: (r.ended_at ?? r.created_at).toISOString(), scores: r.scores as unknown as ScorePoint["scores"], overall: Number(r.overall_score ?? 0) }));
  const recentItems: PracticeSummary[] = recent.map(toSummary);

  return {
    profile: toProfile(profile),
    streakDays: streakOf(byDay.map((r) => r.d), now),
    minutesToday: minutes(Number(perDay.get(day(today))?.seconds ?? 0)),
    minutesThisWeek: minutes(sumSince(from7)),
    totalSessions: Number(totals?.sessions ?? 0),
    totalMinutes: minutes(Number(totals?.seconds ?? 0)),
    vocabTotal: Number(deck?.total ?? 0),
    vocabMastered: Number(deck?.mastered ?? 0),
    reviewDue: Number(due?.n ?? 0),
    activity,
    scoreTrend,
    recent: recentItems,
    weakSpots: weak.map((w) => ({ type: w.type, count: Number(w.n) })),
  };
}
