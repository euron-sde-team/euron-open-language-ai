/**
 * Practice sessions: start one, read it, list yours, end it, retry its report, delete it.
 * Every read and write is scoped by owner: another learner's session is a 404, never a
 * 403 (it does not exist for them).
 *
 * Starting books one session against the monthly quota inside a transaction holding the
 * user's quota lock. Ending queues the lesson engine (job practice.analyze) and the client
 * polls GET /api/practice/:id until the status leaves ANALYZING. Deleting a session never
 * gives its quota back.
 */
import type { Page, PracticeEnd, PracticeSession, PracticeStart, PracticeSummary } from "@open-language/types";
import { sql } from "kysely";
import { type Actor, requireActive, requireActor } from "../../core/context";
import { type Effects, withTransaction } from "../../core/effects";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../../core/errors";
import { newId } from "../../core/ids";
import { db, type Executor } from "../../db/kysely";
import { toSession, toSummary, type PracticeRow } from "../../presenters/practice.presenter";
import { atKey, decodeTime, olderThan, timePage } from "../../repositories/keyset";
import { resolveRealtimeModel, resolveTextModel } from "../models.service";
import { preferencesOf } from "../preferences.service";
import { profileRow } from "../profile.service";
import { assertSessionLeft, lockUserQuota, recordUsage } from "../quota.service";
import { activeScenario } from "../scenario.service";
import { getSettings } from "../settings.service";
import { closeOpenSessions } from "./sessions";
import { cleanTranscript } from "./transcript";

export const FREE_CONVERSATION_TITLE = "Free conversation";

/** The session if `userId` owns it, else a 404. */
export async function ownedPractice(userId: string, id: string, exec: Executor = db, lock = false): Promise<PracticeRow> {
  let q = exec.selectFrom("practice_sessions").selectAll().where("id", "=", id).where("user_id", "=", userId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw notFound("Practice session not found", "PRACTICE_NOT_FOUND");
  return row;
}

async function present(row: PracticeRow, exec: Executor = db): Promise<PracticeSession> {
  const [corrections, drills, deck] = await Promise.all([
    exec.selectFrom("corrections").selectAll().where("practice_session_id", "=", row.id).orderBy("position").orderBy("id").execute(),
    exec.selectFrom("drills").selectAll().where("practice_session_id", "=", row.id).orderBy("position").orderBy("id").execute(),
    exec.selectFrom("vocab_items").select(sql<string>`lower(phrase)`.as("key")).where("user_id", "=", row.user_id).where("target_language", "=", row.target_language).execute(),
  ]);
  return toSession(row, corrections, drills, new Set(deck.map((d) => d.key)));
}

export async function getPractice(actor: Actor, id: string): Promise<PracticeSession> {
  return present(await ownedPractice(requireActor(actor).id, id));
}

export async function listPractice(actor: Actor, q: { cursor?: string; limit?: number; status?: string }): Promise<Page<PracticeSummary>> {
  const a = requireActor(actor);
  const limit = q.limit ?? 20;
  let query = db
    .selectFrom("practice_sessions")
    .selectAll()
    .select(atKey("created_at"))
    .where("user_id", "=", a.id)
    .where(olderThan("created_at", "id", decodeTime(q.cursor)) as never)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(limit + 1);
  if (q.status) query = query.where("status", "=", q.status as PracticeRow["status"]);
  const page = timePage(await query.execute(), limit);
  return { items: page.items.map(toSummary), nextCursor: page.nextCursor };
}

// ─── Starting ───────────────────────────────────────────────────────────────

export async function startPractice(actor: Actor, input: PracticeStart): Promise<PracticeSession> {
  const a = requireActive(actor);
  const [settings, profile, prefs] = await Promise.all([getSettings(), profileRow(a.id), preferencesOf(a.id)]);
  if (!profile.onboarding_complete) throw conflict("Finish setting up your profile before you practise", "PROFILE_INCOMPLETE");
  let title = FREE_CONVERSATION_TITLE;
  let scenarioId: string | null = null;
  if (input.scenarioId) {
    const scenario = await activeScenario(input.scenarioId);
    if (!scenario) throw badRequest("That scenario is not available", "SCENARIO_NOT_FOUND");
    title = scenario.title;
    scenarioId = scenario.id;
  } else if (!settings.features.freeConversation) {
    throw forbidden("Free conversation is turned off on this server. Pick a scenario.", "FEATURE_DISABLED");
  }
  const voice = await resolveRealtimeModel(null, prefs.defaultRealtimeModelId);
  if (!voice) throw new HttpError(503, "No voice model is set up yet. Ask an admin to add one.", "NO_REALTIME_MODEL");
  const text = await resolveTextModel();

  const row = await withTransaction(async (trx) => {
    await lockUserQuota(a.id, trx);
    await assertSessionLeft(a.id, trx);
    const created = await trx
      .insertInto("practice_sessions")
      .values({
        id: newId(),
        user_id: a.id,
        scenario_id: scenarioId,
        title,
        target_language: profile.target_language,
        native_language: profile.native_language,
        level: profile.level,
        realtime_model_id: voice.model.id,
        text_model_id: text?.model.id ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordUsage({ userId: a.id, modelId: voice.model.id, sessions: 1 }, trx);
    return created;
  });
  return present(row);
}

// ─── Ending ─────────────────────────────────────────────────────────────────

/** Mark the session ANALYZING and queue the lesson engine for exactly this version of the row. */
function queueAnalysis(fx: Effects, id: string, version: Date): void {
  fx.job("practice.analyze", { practiceId: id, version: version.toISOString() });
}

/**
 * Finish the conversation: close its live session (booking the minutes), keep the cleaned
 * transcript, measure the duration from the server's own live-session clocks, and queue the
 * report. Calling it again while the report is being written or done changes nothing.
 */
export async function endPractice(actor: Actor, id: string, input: PracticeEnd): Promise<PracticeSession> {
  const a = requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const row = await ownedPractice(a.id, id, trx, true);
    if (row.status === "ANALYZING" || row.status === "COMPLETED") return row;
    if (row.status === "FAILED") throw conflict("The report failed. Retry it instead.", "PRACTICE_FAILED");
    await closeOpenSessions(trx, a.id, fx, row.id);
    const seconds = await trx.selectFrom("live_sessions").select(sql<number>`coalesce(sum(seconds), 0)::int`.as("s")).where("practice_session_id", "=", row.id).executeTakeFirst();
    const now = new Date();
    const updated = await trx
      .updateTable("practice_sessions")
      .set({ status: "ANALYZING", transcript: JSON.stringify(cleanTranscript(input.transcript)), duration_sec: Number(seconds?.s ?? 0), ended_at: now, error: null, updated_at: now })
      .where("id", "=", row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    queueAnalysis(fx, row.id, updated.updated_at);
    return updated;
  });
  return present((await db.selectFrom("practice_sessions").selectAll().where("id", "=", row.id).executeTakeFirst()) ?? row);
}

/** A report still ANALYZING after this long lost its job (a crash or a flushed queue) and may be retried. */
const STUCK_ANALYZING_MS = 5 * 60_000;

/** FAILED, or ANALYZING for more than five minutes: write the report again from the stored transcript. */
export async function retryPractice(actor: Actor, id: string): Promise<PracticeSession> {
  const a = requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const row = await ownedPractice(a.id, id, trx, true);
    const now = new Date();
    const stuck = row.status === "ANALYZING" && now.getTime() - new Date(row.updated_at).getTime() > STUCK_ANALYZING_MS;
    if (row.status !== "FAILED" && !stuck) throw conflict("Only a failed or stuck report can be retried", "PRACTICE_NOT_FAILED");
    const updated = await trx.updateTable("practice_sessions").set({ status: "ANALYZING", error: null, updated_at: now }).where("id", "=", row.id).returningAll().executeTakeFirstOrThrow();
    queueAnalysis(fx, row.id, updated.updated_at);
    return updated;
  });
  return present((await db.selectFrom("practice_sessions").selectAll().where("id", "=", row.id).executeTakeFirst()) ?? row);
}

/** Delete the session with its transcript, corrections and drills. Its quota is not given back. */
export async function deletePractice(actor: Actor, id: string): Promise<void> {
  const a = requireActor(actor);
  await withTransaction(async (trx, fx) => {
    const row = await ownedPractice(a.id, id, trx, true);
    // Voice time already spent still counts: close its live session before the rows go.
    await closeOpenSessions(trx, a.id, fx, row.id);
    await trx.deleteFrom("practice_sessions").where("id", "=", row.id).execute();
  });
}
