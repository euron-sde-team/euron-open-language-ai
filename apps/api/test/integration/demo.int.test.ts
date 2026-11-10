/** The demo seed: runs once on an empty database, makes a believable learner, and is safe to run again. */
import type { Dashboard, Page, PracticeSession, PracticeSummary, ReviewToday } from "@open-language/types";
import { describe, expect, test } from "vitest";
import { config } from "../../src/core/config";
import { db } from "../../src/db/kysely";
import { seedDemo } from "../../src/demo/seed";
import { signAccessToken } from "../../src/security/tokens";
import { as, PASSWORD } from "./harness";

describe("demo:seed", () => {
  test("refuses production", async () => {
    const was = config.NODE_ENV;
    (config as { NODE_ENV: string }).NODE_ENV = "production";
    try {
      await expect(seedDemo()).rejects.toThrow(/refuses to run in production/);
    } finally {
      (config as { NODE_ENV: string }).NODE_ENV = was;
    }
  });

  test("an admin, four learners, and Lee with six finished lessons, a streak, a deck and cards due", async () => {
    (config as { DEMO_PASSWORD?: string }).DEMO_PASSWORD = PASSWORD;
    await seedDemo();
    // A second run prints the logins and changes nothing.
    const users = await db.selectFrom("users").select(({ fn }) => fn.countAll<number>().as("n")).where("email", "like", "%@example.com").executeTakeFirstOrThrow();
    await seedDemo();
    expect((await db.selectFrom("users").select(({ fn }) => fn.countAll<number>().as("n")).where("email", "like", "%@example.com").executeTakeFirstOrThrow()).n).toBe(users.n);

    const lee = await db.selectFrom("users").select(["id", "token_version", "role"]).where("email", "=", "lee@example.com").executeTakeFirstOrThrow();
    const admin = await db.selectFrom("users").select(["id", "token_version", "role"]).where("email", "=", "admin@example.com").executeTakeFirstOrThrow();
    expect(admin.role).toBe("ADMIN");
    const leeUser = { id: lee.id, email: "lee@example.com", username: "lee", displayName: "Lee Marsh", token: signAccessToken(lee.id, lee.token_version) };
    const adminUser = { id: admin.id, email: "admin@example.com", username: "admin", displayName: "Morgan Ellis", token: signAccessToken(admin.id, admin.token_version) };

    expect((await as(leeUser).get("/api/me/profile").expect(200)).body).toEqual({ nativeLanguage: "en", targetLanguage: "es", level: "B1", goals: ["TRAVEL", "BUSINESS"], dailyMinutesTarget: 10, onboardingComplete: true });
    const sessions = (await as(leeUser).get("/api/practice?limit=50").expect(200)).body as Page<PracticeSummary>;
    expect(sessions.items).toHaveLength(6);
    expect(sessions.items.every((s) => s.status === "COMPLETED" && s.overallScore !== null)).toBe(true);
    const scores = sessions.items.map((s) => s.overallScore!).reverse();
    expect(scores[5]!).toBeGreaterThan(scores[0]!);
    expect(new Set(scores).size).toBeGreaterThan(3);

    const one = (await as(leeUser).get(`/api/practice/${sessions.items[0]!.id}`).expect(200)).body as PracticeSession;
    expect(one.transcript.length).toBeGreaterThan(4);
    expect(one.drills).toHaveLength(5);
    expect(one.vocab.length).toBeGreaterThan(2);
    expect(one.summary).toEqual(expect.any(String));

    const dash = (await as(leeUser).get("/api/me/dashboard").expect(200)).body as Dashboard;
    expect(dash.streakDays).toBe(3);
    expect(dash.totalSessions).toBe(6);
    expect(dash.vocabTotal).toBeGreaterThanOrEqual(22);
    expect(dash.vocabTotal).toBeLessThanOrEqual(28);
    expect(dash.vocabMastered).toBeGreaterThan(0);
    expect(dash.reviewDue).toBeGreaterThan(3);
    expect(dash.scoreTrend).toHaveLength(6);
    expect(dash.weakSpots.length).toBeGreaterThan(0);
    const today = (await as(leeUser).get("/api/review/today").expect(200)).body as ReviewToday;
    expect(today.totalDue).toBe(dash.reviewDue);

    // The admin sees metadata for everyone, nothing of what was said.
    const rows = (await as(adminUser).get(`/api/admin/practice?userId=${lee.id}&limit=100`).expect(200)).body as Page<{ title: string }>;
    expect(rows.items.length).toBe(6);
    expect(await db.selectFrom("scenarios").select("id").execute()).toHaveLength(12);
    const stats = (await as(adminUser).get("/api/admin/stats?from=2000-01-01&to=2000-06-01").expect(200)).body;
    expect(stats.totals.sessions).toBe(0);
  });
});
