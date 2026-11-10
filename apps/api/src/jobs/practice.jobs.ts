/**
 * Job handlers of the practice module:
 *
 *   practice.analyze   write the lesson report of an ended session (corrections, vocabulary,
 *                      drills, scores) with the lesson engine
 *   practice.hangup    end an OpenAI call whose live session was closed
 *   practice.sweep     expire live sessions the browser never ended (every minute)
 *
 * The payload is ids and a version stamp only: the transcript is read from the row, never
 * carried through the queue. Analysis is safe to run twice: it only acts on an ANALYZING
 * session whose updated_at is the version it was queued for, and writes the report in one
 * transaction.
 */
import type { TranscriptLine } from "@open-language/types";
import { withTransaction } from "../core/effects";
import { captureError, logger } from "../core/logger";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { hangup, sweepLiveSessions } from "../services/practice/live.service";
import { overallOf, runLesson } from "../services/practice/lesson";
import { registerJob } from "./registry";

export async function analyzePractice(practiceId: string, version: string): Promise<void> {
  const row = await db.selectFrom("practice_sessions").selectAll().where("id", "=", practiceId).executeTakeFirst();
  if (!row || row.status !== "ANALYZING" || row.updated_at.toISOString() !== version) return;
  try {
    const scenario = row.scenario_id ? await db.selectFrom("scenarios").select("title").where("id", "=", row.scenario_id).executeTakeFirst() : undefined;
    const { engine, result } = await runLesson(
      {
        transcript: (Array.isArray(row.transcript) ? row.transcript : []) as unknown as TranscriptLine[],
        targetLanguage: row.target_language,
        nativeLanguage: row.native_language,
        level: row.level,
        scenarioTitle: scenario?.title ?? (row.scenario_id ? row.title : null),
      },
      { userId: row.user_id, textModelId: row.text_model_id },
    );
    await withTransaction(async (trx) => {
      // Re-check under the lock: a retry or a delete may have happened while the model was thinking.
      const live = await trx.selectFrom("practice_sessions").select(["status", "updated_at"]).where("id", "=", row.id).forUpdate().executeTakeFirst();
      if (!live || live.status !== "ANALYZING" || live.updated_at.toISOString() !== version) return;
      await trx.deleteFrom("corrections").where("practice_session_id", "=", row.id).execute();
      await trx.deleteFrom("drills").where("practice_session_id", "=", row.id).execute();
      if (result.corrections.length) {
        await trx
          .insertInto("corrections")
          .values(result.corrections.map((c, i) => ({ id: newId(), practice_session_id: row.id, position: i, type: c.type, original: c.original, corrected: c.corrected, explanation: c.explanation })))
          .execute();
      }
      if (result.drills.length) {
        await trx
          .insertInto("drills")
          .values(result.drills.map((d, i) => ({ id: newId(), practice_session_id: row.id, position: i, type: d.type, question: d.question, answer: d.answer, hints: JSON.stringify(d.hints) })))
          .execute();
      }
      await trx
        .updateTable("practice_sessions")
        .set({
          status: "COMPLETED",
          summary: result.summary,
          scores: JSON.stringify(result.scores),
          overall_score: overallOf(result.scores),
          vocab_suggestions: JSON.stringify(result.vocab),
          engine,
          error: null,
          updated_at: new Date(),
        })
        .where("id", "=", row.id)
        .execute();
    });
  } catch (err) {
    captureError(err, { where: "practice.analyze", practiceId });
    await db
      .updateTable("practice_sessions")
      .set({ status: "FAILED", error: "The lesson report could not be written this time. Try again.", updated_at: new Date() })
      .where("id", "=", row.id)
      .where("status", "=", "ANALYZING")
      .where("updated_at", "=", row.updated_at)
      .execute();
  }
}

export function registerPracticeJobs(): void {
  registerJob("practice.analyze", (d) => analyzePractice(d.practiceId, d.version));
  registerJob("practice.hangup", (d) => hangup(d.sessionId));
  registerJob("practice.sweep", async () => {
    const n = await sweepLiveSessions();
    if (n) logger.info({ expired: n }, "expired abandoned live sessions");
  });
}
