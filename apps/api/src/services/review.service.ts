/**
 * Review: the cards due now (oldest first) and grading one. Grading is SM-2 style
 * (practice/srs.ts), applied under a row lock so two taps on one card grade it once each
 * in order, and logged so "done today" is exact.
 */
import type { ReviewGradeInput, ReviewToday, VocabItem } from "@open-language/types";
import { sql } from "kysely";
import { type Actor, requireActive, requireActor } from "../core/context";
import { withTransaction } from "../core/effects";
import { notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { toVocabItem } from "../presenters/practice.presenter";
import { gradeCard } from "./practice/srs";

const DUE_PAGE = 50;

export async function reviewToday(actor: Actor, now = new Date()): Promise<ReviewToday> {
  const a = requireActor(actor);
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [due, total, done] = await Promise.all([
    db.selectFrom("vocab_items").selectAll().where("user_id", "=", a.id).where("next_review_at", "<=", now).orderBy("next_review_at").orderBy("id").limit(DUE_PAGE).execute(),
    db.selectFrom("vocab_items").select(sql<number>`count(*)::int`.as("n")).where("user_id", "=", a.id).where("next_review_at", "<=", now).executeTakeFirst(),
    db.selectFrom("review_log").select(sql<number>`count(*)::int`.as("n")).where("user_id", "=", a.id).where("reviewed_at", ">=", midnight).executeTakeFirst(),
  ]);
  return { due: due.map(toVocabItem), totalDue: Number(total?.n ?? 0), doneToday: Number(done?.n ?? 0) };
}

export async function gradeReview(actor: Actor, input: ReviewGradeInput, now = new Date()): Promise<VocabItem> {
  const a = requireActive(actor);
  return withTransaction(async (trx) => {
    const item = await trx.selectFrom("vocab_items").selectAll().where("id", "=", input.vocabId).where("user_id", "=", a.id).forUpdate().executeTakeFirst();
    if (!item) throw notFound("Card not found", "VOCAB_NOT_FOUND");
    const next = gradeCard({ ease: Number(item.ease), intervalDays: item.interval_days, repetitions: item.repetitions }, input.grade, now);
    const updated = await trx
      .updateTable("vocab_items")
      .set({ ease: next.ease, interval_days: next.intervalDays, repetitions: next.repetitions, next_review_at: next.nextReviewAt, updated_at: now })
      .where("id", "=", item.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx.insertInto("review_log").values({ id: newId(), user_id: a.id, vocab_id: item.id, grade: input.grade, reviewed_at: now }).execute();
    return toVocabItem(updated);
  });
}
