/**
 * Test harness: the app in-process, fast user creation, the starter model catalogue
 * (with the stub provider) and scenarios, and helpers to practise and walk through a lesson.
 *
 *   const ada = await createUser();                     // ACTIVE, verified USER
 *   const p = await startPractice(ada);                 // onboards, books a session
 *   const grant = await startLive(ada, p.id);           // a stub realtime credential
 *   const done = await finish(ada, p.id);               // COMPLETED, with the lesson report
 *
 * Jobs run inline after commit (JOBS_MODE=inline), so the report is written by the time
 * the end request returns.
 */
import type { AppSettings, LearnerProfile, LiveSessionGrant, PracticeSession } from "@open-language/types";
import { beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { newId } from "../../src/core/ids";
import { db, initDbTypes } from "../../src/db/kysely";
import { ensureStarterCatalog } from "../../src/demo/catalog";
import { ensureStarterScenarios } from "../../src/demo/scenarios";
import { registerAllJobs } from "../../src/jobs";
import { hashPassword } from "../../src/security/passwords";
import { signAccessToken } from "../../src/security/tokens";
import { clearModelCache } from "../../src/services/models.service";
import { clearSettingsCache, saveSettings } from "../../src/services/settings.service";

registerAllJobs();
export const app = createApp();


// enum[] and citext[] columns parse as arrays only after this lookup, as at boot.
beforeAll(async () => {
  await initDbTypes();
  await ensureStarterCatalog(db, { includeStub: true });
  await ensureStarterScenarios(db);
  clearModelCache();
});


export const PASSWORD = "correct-horse-battery-staple";
let passwordHash: string | null = null;

export interface TestUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  token: string;
}

let counter = 0;
export function unique(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${process.pid.toString(36)}${counter}`.slice(0, 38);
}

export type Role = "USER" | "ADMIN";

/** Insert an ACTIVE, verified user directly, and mint an access token for them. */
export async function createUser(over: { role?: Role; status?: "ACTIVE" | "SUSPENDED" | "BANNED"; displayName?: string; username?: string } = {}): Promise<TestUser> {
  passwordHash ??= await hashPassword(PASSWORD);
  const username = over.username ?? unique("u");
  const email = `${username}@example.com`;
  const row = await db
    .insertInto("users")
    .values({
      id: newId(),
      email,
      username,
      display_name: over.displayName ?? `User ${username}`,
      password_hash: passwordHash,
      role: over.role ?? "USER",
      status: over.status ?? "ACTIVE",
      email_verified_at: new Date(),
      ...(over.status === "SUSPENDED" ? { suspended_until: new Date(Date.now() + 86_400_000) } : {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { id: row.id, email, username, displayName: row.display_name, token: signAccessToken(row.id, row.token_version) };
}

/** A supertest agent that sends the user's bearer token on every request. */
export function as(user: TestUser | null) {
  const agent = request(app);
  const auth = (r: request.Test) => (user ? r.set("Authorization", `Bearer ${user.token}`) : r);
  return {
    get: (url: string) => auth(agent.get(url)),
    post: (url: string) => auth(agent.post(url)),
    put: (url: string) => auth(agent.put(url)),
    patch: (url: string) => auth(agent.patch(url)),
    delete: (url: string) => auth(agent.delete(url)),
  };
}

export const anon = () => as(null);

// ─── Models ─────────────────────────────────────────────────────────────────

export interface StubModels {
  text: string;
  voice: string;
}

/** The ids of the stub provider's models (ensureStarterCatalog inserted them). */
export async function stubModels(): Promise<StubModels> {
  const rows = await db.selectFrom("models").select(["id", "model_ref"]).where("provider_id", "=", "stub").execute();
  const by = (ref: string) => rows.find((r) => r.model_ref === ref)!.id;
  return { text: by("stub-text"), voice: by("stub-voice") };
}

// ─── Settings ───────────────────────────────────────────────────────────────

/** Merge a patch into the deployment settings (in-process cache cleared). */
export async function setSettings(patch: Partial<AppSettings>): Promise<void> {
  clearSettingsCache();
  await saveSettings(patch, null);
  clearSettingsCache();
}

/** Back to the defaults. */
export async function resetSettings(): Promise<void> {
  await db.deleteFrom("settings").where("key", "=", "app").execute();
  clearSettingsCache();
}

// ─── Stubs ──────────────────────────────────────────────────────────────────

export function stubsUrl(): string {
  return process.env.STUBS_URL!;
}

export interface StubRequest {
  method: string;
  path: string;
  at: string;
  body: any;
}

/** What the stub providers received, newest first. */
export async function stubRequests(): Promise<StubRequest[]> {
  const res = await fetch(`${stubsUrl()}/__/requests`);
  return (await res.json()) as StubRequest[];
}

/** Chat completion requests whose messages mention `marker` anywhere, newest first. */
export async function chatRequestsMentioning(marker: string): Promise<StubRequest[]> {
  return (await stubRequests()).filter((r) => r.path === "/v1/chat/completions" && JSON.stringify(r.body?.messages ?? []).includes(marker));
}

/** The realtime client secrets the stub minted (newest first) with the session config each carried. */
export async function stubRealtime(): Promise<{ secrets: { value: string; session: any }[]; hangups: string[] }> {
  return (await (await fetch(`${stubsUrl()}/__/realtime`)).json()) as { secrets: { value: string; session: any }[]; hangups: string[] };
}

// ─── Practice ───────────────────────────────────────────────────────────────

/** Finish onboarding with a profile (English speaker learning Spanish at B1 unless told otherwise). */
export async function onboard(user: TestUser, over: Partial<LearnerProfile> = {}): Promise<LearnerProfile> {
  const res = await as(user).put("/api/me/profile").send({ nativeLanguage: "en", targetLanguage: "es", level: "B1", goals: ["TRAVEL"], onboardingComplete: true, ...over });
  if (res.status !== 200) throw new Error(`onboard: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as LearnerProfile;
}

/** The id of a starter scenario by title ("Ordering food"). */
export async function scenarioId(title: string): Promise<string> {
  const row = await db.selectFrom("scenarios").select("id").where("title", "=", title).executeTakeFirstOrThrow();
  return row.id;
}

/** Start a practice session (onboards the user first if they have not been). */
export async function startPractice(user: TestUser, scenario: string | null = "Ordering food"): Promise<PracticeSession> {
  const res = await as(user).post("/api/practice").send(scenario ? { scenarioId: await scenarioId(scenario) } : {});
  if (res.status === 409 && res.body.code === "PROFILE_INCOMPLETE") {
    await onboard(user);
    return startPractice(user, scenario);
  }
  if (res.status !== 201) throw new Error(`start practice: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as PracticeSession;
}

/** Open a live session for the practice session. */
export async function startLive(user: TestUser, practiceId: string): Promise<LiveSessionGrant> {
  const res = await as(user).post(`/api/practice/${practiceId}/live`).send();
  if (res.status !== 201) throw new Error(`start live: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as LiveSessionGrant;
}

export const TRANSCRIPT = [
  { role: "tutor", text: "Hola, ¿cómo estás? (Hello, how are you?)" },
  { role: "learner", text: "Hola, estoy muy bien, gracias. Quiero practicar mi español hoy." },
  { role: "tutor", text: "¡Perfecto! (Perfect!) ¿Qué hiciste ayer? (What did you do yesterday?)" },
  { role: "learner", text: "ayer fui al mercado y compré frutas para la cena." },
] as const;

/** End a practice session with a transcript; the inline analyze job has written the report when this returns. */
export async function finish(user: TestUser, practiceId: string, transcript: readonly { role: string; text: string }[] = TRANSCRIPT): Promise<PracticeSession> {
  const res = await as(user).post(`/api/practice/${practiceId}/end`).send({ transcript });
  if (res.status !== 202) throw new Error(`end practice: ${res.status} ${JSON.stringify(res.body)}`);
  return (await as(user).get(`/api/practice/${practiceId}`).expect(200)).body as PracticeSession;
}

/** Start, talk (live session) and finish: a COMPLETED practice session. */
export async function completedPractice(user: TestUser, scenario: string | null = "Ordering food"): Promise<PracticeSession> {
  const p = await startPractice(user, scenario);
  const grant = await startLive(user, p.id);
  await as(user).post(`/api/practice/${p.id}/live/${grant.id}/end`).send().expect(200);
  return finish(user, p.id);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until fn returns something truthy. */
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 10_000, everyMs = 50): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error("waitFor timed out");
    await sleep(everyMs);
  }
}
