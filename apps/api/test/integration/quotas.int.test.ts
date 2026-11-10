/**
 * Monthly allowances: tier limits, per-user overrides, a practice session refused when the
 * month's sessions are used, parallel starts that cannot overshoot, voice minutes capping
 * the next live session, and deletion never giving quota back.
 */
import type { Usage } from "@open-language/types";
import { sql } from "kysely";
import { describe, expect, test } from "vitest";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { as, createUser, onboard, scenarioId, startLive, startPractice, stubModels, type TestUser } from "./harness";

async function usage(user: TestUser): Promise<Usage> {
  return (await as(user).get("/api/me/usage").expect(200)).body as Usage;
}

async function override(user: TestUser, values: { monthly_sessions?: number | null; monthly_voice_minutes?: number | null }) {
  await db
    .insertInto("user_quota_overrides")
    .values({ user_id: user.id, monthly_sessions: values.monthly_sessions ?? null, monthly_voice_minutes: values.monthly_voice_minutes ?? null })
    .onConflict((oc) => oc.column("user_id").doUpdateSet({ monthly_sessions: values.monthly_sessions ?? null, monthly_voice_minutes: values.monthly_voice_minutes ?? null }))
    .execute();
}

const start = async (user: TestUser) => as(user).post("/api/practice").send({ scenarioId: await scenarioId("Ordering food") });

describe("usage and limits", () => {
  test("a new user is on the default tier; starting a practice session books one", async () => {
    const ada = await createUser();
    const before = await usage(ada);
    const now = new Date();
    expect(before).toMatchObject({ month: now.toISOString().slice(0, 7), sessions: { used: 0, limit: 30 }, voiceMinutes: { used: 0, limit: 300 }, maxSessionMinutes: 15 });
    expect(before.resetsAt).toBe(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString());
    await startPractice(ada);
    expect((await usage(ada)).sessions.used).toBe(1);
  });

  test("a tier sets the limits; an override wins field by field; a null override field falls back to the tier", async () => {
    const ada = await createUser();
    const tierId = newId();
    await db.insertInto("quota_tiers").values({ id: tierId, name: `Cohort ${tierId}`, monthly_sessions: 60, monthly_voice_minutes: 600, max_session_minutes: 20 }).execute();
    await db.updateTable("users").set({ quota_tier_id: tierId }).where("id", "=", ada.id).execute();
    expect(await usage(ada)).toMatchObject({ sessions: { limit: 60 }, voiceMinutes: { limit: 600 }, maxSessionMinutes: 20 });
    await override(ada, { monthly_sessions: 2, monthly_voice_minutes: null });
    expect(await usage(ada)).toMatchObject({ sessions: { limit: 2 }, voiceMinutes: { limit: 600 } });
  });

  test("the month's last session is the last one: the next is 429 QUOTA_EXCEEDED", async () => {
    const ada = await createUser();
    await onboard(ada);
    await override(ada, { monthly_sessions: 1 });
    expect((await start(ada)).status).toBe(201);
    const refused = await start(ada);
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe("QUOTA_EXCEEDED");
  });

  test("a null limit is unlimited", async () => {
    const ada = await createUser();
    await onboard(ada);
    const tierId = newId();
    await db.insertInto("quota_tiers").values({ id: tierId, name: `Unlimited ${tierId}`, monthly_sessions: null, monthly_voice_minutes: null, max_session_minutes: 30 }).execute();
    await db.updateTable("users").set({ quota_tier_id: tierId }).where("id", "=", ada.id).execute();
    expect(await usage(ada)).toMatchObject({ sessions: { limit: null }, voiceMinutes: { limit: null } });
    for (let i = 0; i < 3; i++) expect((await start(ada)).status).toBe(201);
  });

  test("parallel starts cannot draw past the limit: of 5 requests with 2 left, exactly 2 succeed", async () => {
    const ada = await createUser();
    await onboard(ada);
    await override(ada, { monthly_sessions: 2 });
    const id = await scenarioId("Ordering food");
    const results = await Promise.all(Array.from({ length: 5 }, () => as(ada).post("/api/practice").send({ scenarioId: id })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 429)).toHaveLength(3);
  });

  test("deleting a practice session does not give its quota back", async () => {
    const ada = await createUser();
    const p = await startPractice(ada);
    expect((await as(ada).delete(`/api/practice/${p.id}`)).status).toBe(204);
    expect((await usage(ada)).sessions.used).toBe(1);
  });

  test("voice minutes cap the next live session's length, and none left is 429", async () => {
    const ada = await createUser();
    await override(ada, { monthly_voice_minutes: 10 });
    const p = await startPractice(ada);
    const { voice } = await stubModels();
    await db.insertInto("usage_daily").values({ user_id: ada.id, day: sql<Date>`current_date`, model_id: voice, voice_seconds: 9 * 60 }).onConflict((oc) => oc.doNothing()).execute();
    await db.updateTable("usage_daily").set({ voice_seconds: 9 * 60 }).where("user_id", "=", ada.id).where("model_id", "=", voice).execute();
    const grant = await startLive(ada, p.id);
    expect(grant.maxSeconds).toBe(60);
    await as(ada).post(`/api/practice/${p.id}/live/${grant.id}/end`).send();
    await db.updateTable("usage_daily").set({ voice_seconds: 10 * 60 }).where("user_id", "=", ada.id).where("model_id", "=", voice).execute();
    const refused = await as(ada).post(`/api/practice/${p.id}/live`).send({});
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe("QUOTA_EXCEEDED");
  });

  test("usage rows hold counts and seconds only, never text", async () => {
    const ada = await createUser();
    const p = await startPractice(ada);
    await as(ada).post(`/api/practice/${p.id}/end`).send({ transcript: [{ role: "learner", text: "SECRET_PHRASE_SPOKEN aloud here today" }] }).expect(202);
    const rows = await db.selectFrom("usage_daily").selectAll().where("user_id", "=", ada.id).execute();
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("SECRET_PHRASE_SPOKEN");
  });
});
