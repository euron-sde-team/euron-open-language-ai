/**
 * The vocabulary deck: list, save, delete. Saving is idempotent on the phrase (compared in
 * lower case) per target language, so a double tap, a retry or saving the same suggestion
 * from two lessons never makes a duplicate.
 */
import type { Page, VocabItem, VocabSaveInput } from "@open-language/types";
import { sql } from "kysely";
import { type Actor, requireActive, requireActor } from "../core/context";
import { conflict, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { toVocabItem } from "../presenters/practice.presenter";
import { atKey, decodeTime, olderThan, timePage } from "../repositories/keyset";
import { profileRow } from "./profile.service";

const MAX_DECK = 5000;

const likePattern = (q: string) => `%${q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export async function listVocab(actor: Actor, q: { cursor?: string; limit?: number; q?: string }): Promise<Page<VocabItem>> {
  const a = requireActor(actor);
  const limit = q.limit ?? 30;
  let query = db
    .selectFrom("vocab_items")
    .selectAll()
    .select(atKey("created_at"))
    .where("user_id", "=", a.id)
    .where(olderThan("created_at", "id", decodeTime(q.cursor)) as never)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(limit + 1);
  if (q.q?.trim()) {
    const like = likePattern(q.q);
    query = query.where((eb) => eb.or([eb("phrase", "ilike", like), eb("meaning_native", "ilike", like)]));
  }
  const page = timePage(await query.execute(), limit);
  return { items: page.items.map(toVocabItem), nextCursor: page.nextCursor };
}

/** Save a phrase to the deck, due now. Returns the existing item when the phrase is already there. */
export async function saveVocab(actor: Actor, input: VocabSaveInput): Promise<VocabItem> {
  const a = requireActive(actor);
  let target = (await profileRow(a.id)).target_language;
  if (input.sessionId) {
    const s = await db.selectFrom("practice_sessions").select(["target_language", "id"]).where("id", "=", input.sessionId).where("user_id", "=", a.id).executeTakeFirst();
    if (!s) throw notFound("Practice session not found", "PRACTICE_NOT_FOUND");
    target = s.target_language;
  }
  const phrase = input.phrase.trim();
  const existing = () => db.selectFrom("vocab_items").selectAll().where("user_id", "=", a.id).where("target_language", "=", target).where(sql<boolean>`lower(phrase) = lower(${phrase})`).executeTakeFirst();
  const found = await existing();
  if (found) return toVocabItem(found);
  const count = await db.selectFrom("vocab_items").select((eb) => eb.fn.countAll<number>().as("n")).where("user_id", "=", a.id).executeTakeFirst();
  if (Number(count?.n ?? 0) >= MAX_DECK) throw conflict("Your deck is full. Delete some cards first.", "DECK_FULL");
  // The unique index decides a race between two saves of one phrase; the loser reads the winner.
  await db
    .insertInto("vocab_items")
    .values({
      id: newId(),
      user_id: a.id,
      target_language: target,
      phrase,
      meaning_native: input.meaningNative.trim(),
      examples: JSON.stringify((input.examples ?? []).map((e) => e.trim()).filter(Boolean).slice(0, 5)),
      source_session_id: input.sessionId ?? null,
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
  return toVocabItem((await existing())!);
}

export async function deleteVocab(actor: Actor, id: string): Promise<void> {
  const a = requireActor(actor);
  const res = await db.deleteFrom("vocab_items").where("id", "=", id).where("user_id", "=", a.id).executeTakeFirst();
  if (!Number(res.numDeletedRows)) throw notFound("Card not found", "VOCAB_NOT_FOUND");
}
