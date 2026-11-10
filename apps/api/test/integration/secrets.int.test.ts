/**
 * Provider keys never leave the server. OPENAI_API_KEY is set to a canary value for the
 * whole suite (env.ts); this file walks every kind of response a user and an admin can
 * fetch (live session grants minted with that key included) and the database, and
 * asserts the canary is nowhere.
 */
import type request from "supertest";
import { describe, expect, test } from "vitest";
import { sql } from "kysely";
import { db } from "../../src/db/kysely";
import { CANARY_KEY } from "./env";
import { clearModelCache } from "../../src/services/models.service";
import { as, createUser, startLive, startPractice, stubModels } from "./harness";

/** Buffer any response (JSON, PDF, an attachment) as text. */
const asText = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    let data = "";
    res.setEncoding("latin1");
    res.on("data", (c: string) => (data += c));
    res.on("end", () => cb(null, data));
  });

describe("the provider key canary", () => {
  test("appears in no response a user or an admin can fetch", async () => {
    expect(process.env.OPENAI_API_KEY).toBe(CANARY_KEY);
    const user = await createUser();
    const admin = await createUser({ role: "ADMIN" });
    const { text, voice } = await stubModels();
    const openAiVoice = await db.selectFrom("models").select("id").where("provider_id", "=", "openai").where("model_ref", "=", "gpt-realtime").executeTakeFirstOrThrow();

    const bodies: string[] = [];
    // A live session through the OpenAI adapter: the key mints the client secret, the grant carries only the secret.
    bodies.push((await as(user).patch("/api/me/preferences").send({ defaultRealtimeModelId: openAiVoice.id }).expect(200)).text);
    const p = await startPractice(user);
    const grant = await startLive(user, p.id);
    expect(grant.provider).toBe("openai");
    bodies.push(JSON.stringify(grant));
    bodies.push((await as(user).post(`/api/practice/${p.id}/live/${grant.id}/end`).send().expect(200)).text);
    bodies.push((await as(user).post(`/api/practice/${p.id}/end`).send({ transcript: [{ role: "learner", text: "Una respuesta canario con detalle." }] }).expect(202)).text);
    const card = (await as(user).post("/api/vocab").send({ phrase: "canario", meaningNative: "canary" }).expect(201)).body;
    bodies.push((await as(user).post("/api/review/grade").send({ vocabId: card.id, grade: "easy" }).expect(200)).text);
    // A report the model could not write falls back to the offline engine and still carries no key.
    await db.updateTable("models").set({ enabled: false }).where("kind", "=", "TEXT").execute();
    clearModelCache();
    try {
      const offline = await startPractice(user);
      bodies.push((await as(user).post(`/api/practice/${offline.id}/end`).send({ transcript: [{ role: "learner", text: "hola" }] }).expect(202)).text);
    } finally {
      await db.updateTable("models").set({ enabled: true }).where("kind", "=", "TEXT").execute();
      clearModelCache();
    }

    const userGets = ["/api/meta", "/api/meta/languages", "/api/me/usage", "/api/me/profile", "/api/me/dashboard", "/api/me/preferences", "/api/me/realtime-models", "/api/users/me", "/api/scenarios", "/api/practice", `/api/practice/${p.id}`, "/api/vocab", "/api/review/today", "/api/users/me/sessions"];
    for (const url of userGets) bodies.push((await as(user).get(url).expect(200)).text);
    bodies.push((await asText(as(user).get("/api/users/me/export")).expect(200)).body as string);

    const adminGets = ["/api/admin/me", "/api/admin/stats", "/api/admin/users", `/api/admin/users/${user.id}`, "/api/admin/tiers", "/api/admin/providers", "/api/admin/models", "/api/admin/settings", "/api/admin/integrations", "/api/admin/practice", "/api/admin/scenarios", "/api/admin/audit?limit=100"];
    for (const url of adminGets) bodies.push((await as(admin).get(url).expect(200)).text);
    for (const id of [text, voice, openAiVoice.id]) bodies.push((await as(admin).post(`/api/admin/models/${id}/test`).send({}).expect(200)).text);
    // Error envelopes too.
    bodies.push((await as(user).get("/api/admin/providers").expect(403)).text);
    bodies.push((await as(user).post("/api/vocab").send({ phrase: "" }).expect(400)).text);

    for (const b of bodies) {
      expect(b).not.toContain(CANARY_KEY);
      expect(b).not.toContain("canary-value");
    }
    // The providers list still says a key is configured, without the key.
    expect((await as(admin).get("/api/admin/providers").expect(200)).body.find((p: { id: string }) => p.id === "openai").keyConfigured).toBe(true);
  });

  test("is stored nowhere in the database", async () => {
    const like = `%${CANARY_KEY}%`;
    const hits = await sql<{ n: number }>`
      SELECT (SELECT count(*) FROM settings WHERE value::text LIKE ${like})
           + (SELECT count(*) FROM providers WHERE coalesce(base_url, '') LIKE ${like})
           + (SELECT count(*) FROM audit_log WHERE data::text LIKE ${like})
           + (SELECT count(*) FROM practice_sessions WHERE coalesce(summary, '') LIKE ${like} OR transcript::text LIKE ${like} OR vocab_suggestions::text LIKE ${like} OR coalesce(error, '') LIKE ${like})
           + (SELECT count(*) FROM scenarios WHERE prompt_template LIKE ${like})
           + (SELECT count(*) FROM live_sessions WHERE coalesce(credential_hash, '') LIKE ${like} OR coalesce(provider_call_id, '') LIKE ${like}) AS n`.execute(db);
    expect(Number(hits.rows[0]!.n)).toBe(0);
  });
});
