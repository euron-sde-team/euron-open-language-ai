/**
 * The learner's side beyond a single lesson: scenarios, the vocabulary deck, spaced-repetition
 * review, and the progress dashboard.
 */
import type { Dashboard, Page, ReviewToday, Scenario, VocabItem } from "@open-language/types";
import { describe, expect, test } from "vitest";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { as, completedPractice, createUser, onboard, type TestUser } from "./harness";

const DAY = 86_400_000;

async function save(user: TestUser, phrase: string, meaning = "meaning", extra: object = {}): Promise<VocabItem> {
  return (await as(user).post("/api/vocab").send({ phrase, meaningNative: meaning, ...extra }).expect(201)).body as VocabItem;
}

describe("scenarios", () => {
  test("active ones in display order, without the role-play text; one by id", async () => {
    const ada = await createUser();
    const list = (await as(ada).get("/api/scenarios").expect(200)).body as Scenario[];
    expect(list.length).toBeGreaterThanOrEqual(12);
    expect(list[0]!.title).toBe("Airport immigration");
    expect(list.map((s) => s.sortOrder)).toEqual([...list.map((s) => s.sortOrder)].sort((a, b) => a - b));
    expect(Object.keys(list[0]!).sort()).toEqual(["description", "goals", "id", "isActive", "levelMax", "levelMin", "sortOrder", "title"]);
    expect(list.every((s) => s.description.length > 10)).toBe(true);
    expect(JSON.stringify(list)).not.toMatch(/role-play|Correct gently|promptTemplate/i);
    const one = (await as(ada).get(`/api/scenarios/${list[2]!.id}`).expect(200)).body as Scenario;
    expect(one).toEqual(list[2]);
    expect((await as(ada).get(`/api/scenarios/${newId()}`).expect(404)).body.code).toBe("SCENARIO_NOT_FOUND");
  });

  test("forProfile keeps scenarios that fit the level and at least one goal", async () => {
    const ada = await createUser();
    await onboard(ada, { level: "A1", goals: ["TRAVEL"] });
    const titles = async () => ((await as(ada).get("/api/scenarios?forProfile=true").expect(200)).body as Scenario[]).map((s) => s.title);
    const a1 = await titles();
    expect(a1).toEqual(expect.arrayContaining(["Airport immigration", "Ordering food", "Asking directions"]));
    expect(a1).not.toContain("Job interview");
    expect(a1).not.toContain("Hotel check-in");
    await onboard(ada, { level: "B2", goals: ["BUSINESS"] });
    const b2 = await titles();
    expect(b2).toEqual(expect.arrayContaining(["Job interview", "Client meeting", "Presentation practice"]));
    expect(b2).not.toContain("Ordering food");
    const all = ((await as(ada).get("/api/scenarios?forProfile=false").expect(200)).body as Scenario[]).map((s) => s.title);
    expect(all).toContain("Ordering food");
    await as(ada).get("/api/scenarios?forProfile=maybe").expect(400);
  });

  test("a scenario without goals suits everyone", async () => {
    const ada = await createUser();
    await onboard(ada, { level: "C2", goals: ["ACADEMIC"] });
    const id = newId();
    await db.insertInto("scenarios").values({ id, title: `Open ${id}`, description: "For all.", level_min: "A1", level_max: "C2", goals: [], prompt_template: "Chat." }).execute();
    try {
      expect(((await as(ada).get("/api/scenarios?forProfile=true").expect(200)).body as Scenario[]).some((s) => s.id === id)).toBe(true);
    } finally {
      await db.deleteFrom("scenarios").where("id", "=", id).execute();
    }
  });
});

describe("the deck", () => {
  test("saving is idempotent on the phrase, ignoring case, per target language", async () => {
    const ada = await createUser();
    const first = await save(ada, "Buenos días", "good morning", { examples: ["Buenos días, señora."] });
    expect(first).toMatchObject({ phrase: "Buenos días", meaningNative: "good morning", examples: ["Buenos días, señora."], targetLanguage: "es", repetitions: 0, mastered: false });
    expect(Date.parse(first.nextReviewAt)).toBeLessThanOrEqual(Date.now() + 1000);
    const again = await save(ada, "buenos DÍAS", "something else");
    expect(again.id).toBe(first.id);
    expect(again.meaningNative).toBe("good morning");
    // Another language is another card.
    await onboard(ada, { targetLanguage: "fr" });
    const fr = await save(ada, "buenos días", "x");
    expect(fr.id).not.toBe(first.id);
    expect(fr.targetLanguage).toBe("fr");
    expect(((await as(ada).get("/api/vocab").expect(200)).body as Page<VocabItem>).items).toHaveLength(2);
  });

  test("parallel saves of one phrase make one card", async () => {
    const ada = await createUser();
    const results = await Promise.all(Array.from({ length: 6 }, () => as(ada).post("/api/vocab").send({ phrase: "gracias", meaningNative: "thanks" })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect((await db.selectFrom("vocab_items").select("id").where("user_id", "=", ada.id).execute()).length).toBe(1);
  });

  test("from a session: takes that session's language and must be yours", async () => {
    const ada = await createUser();
    const p = await completedPractice(ada);
    const item = await save(ada, p.vocab[0]!.phrase, p.vocab[0]!.meaningNative, { sessionId: p.id });
    expect(item.targetLanguage).toBe("es");
    expect((await db.selectFrom("vocab_items").select("source_session_id").where("id", "=", item.id).executeTakeFirstOrThrow()).source_session_id).toBe(p.id);
    const bad = await as(ada).post("/api/vocab").send({ phrase: "x", meaningNative: "y", sessionId: newId() });
    expect(bad.status).toBe(404);
    // Deleting the session keeps the card.
    await as(ada).delete(`/api/practice/${p.id}`).expect(204);
    expect((await db.selectFrom("vocab_items").select("source_session_id").where("id", "=", item.id).executeTakeFirstOrThrow()).source_session_id).toBeNull();
  });

  test("validation, search, paging and delete", async () => {
    const ada = await createUser();
    for (const body of [{ phrase: "", meaningNative: "x" }, { phrase: "x", meaningNative: "" }, { phrase: "x".repeat(201), meaningNative: "y" }, { phrase: "x", meaningNative: "y", examples: Array(6).fill("e") }, { phrase: "x", meaningNative: "y", easeFactor: 9 }]) {
      expect((await as(ada).post("/api/vocab").send(body)).body.code, JSON.stringify(body).slice(0, 40)).toBe("VALIDATION_FAILED");
    }
    for (const [p, m] of [["manzana", "apple"], ["naranja", "orange"], ["plátano", "banana"], ["100%", "percent"]] as const) await save(ada, p, m);
    const q = async (s: string) => ((await as(ada).get(`/api/vocab?q=${encodeURIComponent(s)}`).expect(200)).body as Page<VocabItem>).items.map((i) => i.phrase);
    expect(await q("man")).toEqual(["manzana"]);
    expect(await q("BANANA")).toEqual(["plátano"]);
    expect(await q("%")).toEqual(["100%"]);
    expect(await q("_")).toEqual([]);
    const page1 = (await as(ada).get("/api/vocab?limit=3").expect(200)).body as Page<VocabItem>;
    expect(page1.items.map((i) => i.phrase)).toEqual(["100%", "plátano", "naranja"]);
    const page2 = (await as(ada).get(`/api/vocab?limit=3&cursor=${encodeURIComponent(page1.nextCursor!)}`).expect(200)).body as Page<VocabItem>;
    expect(page2.items.map((i) => i.phrase)).toEqual(["manzana"]);
    expect(page2.nextCursor).toBeNull();
    await as(ada).delete(`/api/vocab/${page2.items[0]!.id}`).expect(204);
    expect((await as(ada).delete(`/api/vocab/${page2.items[0]!.id}`).expect(404)).body.code).toBe("VOCAB_NOT_FOUND");
  });
});

describe("review", () => {
  test("today lists the due cards oldest first, counts all of them and what was done today", async () => {
    const ada = await createUser();
    const a = await save(ada, "uno", "one");
    const b = await save(ada, "dos", "two");
    const c = await save(ada, "tres", "three");
    await db.updateTable("vocab_items").set({ next_review_at: new Date(Date.now() - 3 * DAY) }).where("id", "=", b.id).execute();
    await db.updateTable("vocab_items").set({ next_review_at: new Date(Date.now() - 2 * DAY) }).where("id", "=", a.id).execute();
    await db.updateTable("vocab_items").set({ next_review_at: new Date(Date.now() + 2 * DAY) }).where("id", "=", c.id).execute();
    const today = (await as(ada).get("/api/review/today").expect(200)).body as ReviewToday;
    expect(today.due.map((d) => d.phrase)).toEqual(["dos", "uno"]);
    expect(today).toMatchObject({ totalDue: 2, doneToday: 0 });
  });

  test("at most 50 are returned while totalDue counts them all", async () => {
    const ada = await createUser();
    await db.insertInto("vocab_items").values(Array.from({ length: 55 }, (_, i) => ({ id: newId(), user_id: ada.id, target_language: "es", phrase: `p${i}`, meaning_native: "m", next_review_at: new Date(Date.now() - i * 60_000) }))).execute();
    const today = (await as(ada).get("/api/review/today").expect(200)).body as ReviewToday;
    expect(today.due).toHaveLength(50);
    expect(today.totalDue).toBe(55);
  });

  test("grading follows SM-2: good, good, good = 1, 6, 15 days; again brings it back in ten minutes and resets", async () => {
    const ada = await createUser();
    const card = await save(ada, "hola", "hello");
    const grade = async (g: string) => (await as(ada).post("/api/review/grade").send({ vocabId: card.id, grade: g }).expect(200)).body as VocabItem;
    const row = () => db.selectFrom("vocab_items").selectAll().where("id", "=", card.id).executeTakeFirstOrThrow();
    const daysAhead = async () => Math.round((((await row()).next_review_at.getTime() - Date.now()) / DAY));
    expect(await grade("good")).toMatchObject({ repetitions: 1, mastered: false });
    expect([(await row()).interval_days, await daysAhead()]).toEqual([1, 1]);
    await grade("good");
    expect([(await row()).interval_days, await daysAhead()]).toEqual([6, 6]);
    await grade("good");
    expect((await row()).interval_days).toBe(15);
    const easy = await grade("easy");
    expect((await row()).interval_days).toBe(Math.round(15 * 2.5 * 1.3));
    expect(easy.mastered).toBe(true);
    expect(Number((await row()).ease)).toBe(2.65);
    const again = await grade("again");
    expect(again).toMatchObject({ repetitions: 0, mastered: false });
    const r = await row();
    expect([r.interval_days, Number(r.ease)]).toEqual([0, 2.45]);
    const minutes = (r.next_review_at.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(8);
    expect(minutes).toBeLessThan(11);
    const today = (await as(ada).get("/api/review/today").expect(200)).body as ReviewToday;
    expect(today.due.some((d) => d.id === card.id)).toBe(false);
    expect(today.doneToday).toBe(5);
    expect((await db.selectFrom("review_log").select("grade").where("user_id", "=", ada.id).orderBy("reviewed_at").execute()).map((g) => g.grade)).toEqual(["good", "good", "good", "easy", "again"]);
  });

  test("validation, and two taps on one card grade it twice in order", async () => {
    const ada = await createUser();
    const card = await save(ada, "adiós", "goodbye");
    await as(ada).post("/api/review/grade").send({ vocabId: card.id, grade: "perfect" }).expect(400);
    await as(ada).post("/api/review/grade").send({ vocabId: "nope", grade: "good" }).expect(400);
    await as(ada).post("/api/review/grade").send({ vocabId: card.id }).expect(400);
    expect((await as(ada).post("/api/review/grade").send({ vocabId: newId(), grade: "good" }).expect(404)).body.code).toBe("VOCAB_NOT_FOUND");
    await Promise.all([as(ada).post("/api/review/grade").send({ vocabId: card.id, grade: "good" }), as(ada).post("/api/review/grade").send({ vocabId: card.id, grade: "good" })]);
    expect((await db.selectFrom("vocab_items").select(["repetitions", "interval_days"]).where("id", "=", card.id).executeTakeFirstOrThrow())).toEqual({ repetitions: 2, interval_days: 6 });
  });
});

describe("the dashboard", () => {
  async function session(user: TestUser, over: { daysAgo: number; seconds?: number; status?: "COMPLETED" | "FAILED" | "IN_PROGRESS"; score?: number; hour?: number }) {
    const now = new Date();
    const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - over.daysAgo * DAY + (over.hour ?? 10) * 3_600_000;
    const ended = new Date(Math.min(day, Date.now() - 1000));
    const id = newId();
    const scores = { fluency: over.score ?? 6, accuracy: over.score ?? 6, vocabRange: over.score ?? 6, confidence: over.score ?? 6 };
    const status = over.status ?? "COMPLETED";
    await db
      .insertInto("practice_sessions")
      .values({
        id,
        user_id: user.id,
        title: "Seeded",
        status,
        target_language: "es",
        native_language: "en",
        level: "B1",
        scores: status === "COMPLETED" ? JSON.stringify(scores) : null,
        overall_score: status === "COMPLETED" ? (over.score ?? 6) : null,
        started_at: new Date(ended.getTime() - (over.seconds ?? 600) * 1000),
        ended_at: status === "IN_PROGRESS" ? null : ended,
        duration_sec: status === "IN_PROGRESS" ? null : (over.seconds ?? 600),
        created_at: new Date(ended.getTime() - (over.seconds ?? 600) * 1000),
      })
      .execute();
    return id;
  }

  test("a new learner: zeros, 28 empty days, no trend", async () => {
    const ada = await createUser();
    const d = (await as(ada).get("/api/me/dashboard").expect(200)).body as Dashboard;
    expect(d).toMatchObject({ streakDays: 0, minutesToday: 0, minutesThisWeek: 0, totalSessions: 0, totalMinutes: 0, vocabTotal: 0, vocabMastered: 0, reviewDue: 0, scoreTrend: [], recent: [], weakSpots: [] });
    expect(d.profile).toMatchObject({ onboardingComplete: false });
    expect(d.activity).toHaveLength(28);
    expect(d.activity.at(-1)!.date).toBe(new Date().toISOString().slice(0, 10));
    expect(d.activity.every((a) => a.minutes === 0 && a.sessions === 0)).toBe(true);
  });

  test("streak: consecutive UTC days ending today or yesterday; a gap breaks it; unfinished sessions do not count", async () => {
    const run = async (days: number[], extra: Parameters<typeof session>[1][] = []) => {
      const u = await createUser();
      for (const daysAgo of days) await session(u, { daysAgo });
      for (const e of extra) await session(u, e);
      return ((await as(u).get("/api/me/dashboard").expect(200)).body as Dashboard).streakDays;
    };
    expect(await run([0, 1, 2])).toBe(3);
    expect(await run([1, 2, 3, 4])).toBe(4);
    expect(await run([2, 3])).toBe(0);
    expect(await run([0, 1, 3, 4, 5])).toBe(2);
    expect(await run([0, 0, 0])).toBe(1);
    expect(await run([], [{ daysAgo: 0, status: "IN_PROGRESS" }])).toBe(0);
    // A session whose report failed still counts as practice that day.
    expect(await run([], [{ daysAgo: 0, status: "FAILED" }])).toBe(1);
  });

  test("minutes today, this week (7 days) and in total; the activity chart; the score trend oldest first", async () => {
    const ada = await createUser();
    await session(ada, { daysAgo: 0, seconds: 600, score: 8 });
    await session(ada, { daysAgo: 0, seconds: 300, score: 7, hour: 1 });
    await session(ada, { daysAgo: 3, seconds: 1200, score: 6 });
    await session(ada, { daysAgo: 10, seconds: 900, score: 5 });
    const d = (await as(ada).get("/api/me/dashboard").expect(200)).body as Dashboard;
    expect(d.minutesToday).toBe(15);
    expect(d.minutesThisWeek).toBe(35);
    expect(d.totalMinutes).toBe(50);
    expect(d.totalSessions).toBe(4);
    const byDate = new Map(d.activity.map((a) => [a.date, a]));
    const iso = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
    expect(byDate.get(iso(0))).toEqual({ date: iso(0), minutes: 15, sessions: 2 });
    expect(byDate.get(iso(3))).toEqual({ date: iso(3), minutes: 20, sessions: 1 });
    expect(byDate.get(iso(10))).toEqual({ date: iso(10), minutes: 15, sessions: 1 });
    expect(d.scoreTrend.map((p) => p.overall)).toEqual([5, 6, 7, 8]);
    expect(d.scoreTrend[0]).toMatchObject({ scores: { fluency: 5, accuracy: 5, vocabRange: 5, confidence: 5 }, sessionId: expect.any(String), at: expect.any(String) });
    expect(d.recent).toHaveLength(4);
  });

  test("at most 20 trend points and 5 recent sessions; deck counts; due count; weak spots from the last 30 days", async () => {
    const ada = await createUser();
    await onboard(ada);
    for (let i = 0; i < 22; i++) await session(ada, { daysAgo: 1, score: 5, seconds: 60 });
    const old = await session(ada, { daysAgo: 1, seconds: 60 });
    await db.insertInto("corrections").values([
      { id: newId(), practice_session_id: old, type: "grammar", original: "a", corrected: "b" },
      { id: newId(), practice_session_id: old, type: "grammar", original: "c", corrected: "d" },
      { id: newId(), practice_session_id: old, type: "word_choice", original: "e", corrected: "f" },
    ]).execute();
    // Corrections older than 30 days do not count.
    const ancient = await session(ada, { daysAgo: 1, seconds: 60 });
    await db.updateTable("practice_sessions").set({ created_at: new Date(Date.now() - 45 * DAY) }).where("id", "=", ancient).execute();
    await db.insertInto("corrections").values({ id: newId(), practice_session_id: ancient, type: "pronunciation", original: "g", corrected: "h" }).execute();
    await db.insertInto("vocab_items").values([
      { id: newId(), user_id: ada.id, target_language: "es", phrase: "a", meaning_native: "m", interval_days: 30, repetitions: 4, next_review_at: new Date(Date.now() + 10 * DAY) },
      { id: newId(), user_id: ada.id, target_language: "es", phrase: "b", meaning_native: "m", interval_days: 20, repetitions: 3, next_review_at: new Date(Date.now() + DAY) },
      { id: newId(), user_id: ada.id, target_language: "es", phrase: "c", meaning_native: "m" },
    ]).execute();
    const d = (await as(ada).get("/api/me/dashboard").expect(200)).body as Dashboard;
    expect(d.scoreTrend).toHaveLength(20);
    expect(d.recent).toHaveLength(5);
    expect(d.totalSessions).toBe(24);
    expect(d).toMatchObject({ vocabTotal: 3, vocabMastered: 1, reviewDue: 1 });
    expect(d.weakSpots).toEqual([{ type: "grammar", count: 2 }, { type: "word_choice", count: 1 }]);
    expect(d.profile.onboardingComplete).toBe(true);
  });

  test("only your own data", async () => {
    const ada = await createUser();
    const eve = await createUser();
    await session(ada, { daysAgo: 0 });
    await save(ada, "secreto", "secret");
    const d = (await as(eve).get("/api/me/dashboard").expect(200)).body as Dashboard;
    expect(d).toMatchObject({ totalSessions: 0, vocabTotal: 0, streakDays: 0 });
  });

  test("a finished lesson shows up end to end", async () => {
    const ada = await createUser();
    const p = await completedPractice(ada);
    const d = (await as(ada).get("/api/me/dashboard").expect(200)).body as Dashboard;
    expect(d.totalSessions).toBe(1);
    expect(d.streakDays).toBe(1);
    expect(d.scoreTrend.map((s) => s.sessionId)).toEqual([p.id]);
    expect(d.recent[0]).toMatchObject({ id: p.id, status: "COMPLETED" });
  });
});
