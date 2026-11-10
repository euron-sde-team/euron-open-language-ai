/**
 * The personal side: the public meta document and language list, the voice models a learner
 * may pick, preferences (and how they reach a live session), the profile and this month's usage.
 */
import type { AppMeta, LanguageOption, LearnerProfile, Preferences, RealtimeModelOption, Usage } from "@open-language/types";
import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/services/settings.service";
import { anon, as, createUser, onboard, resetSettings, setSettings, startLive, startPractice, stubModels } from "./harness";

describe("GET /api/meta", () => {
  test("public, cacheable, with features, limits and no provider names or keys", async () => {
    const res = await anon().get("/api/meta").expect(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=30");
    const meta = res.body as AppMeta;
    expect(meta).toEqual({
      appName: DEFAULT_SETTINGS.appName,
      tagline: DEFAULT_SETTINGS.tagline,
      registration: "OPEN",
      tutorName: "Lingua",
      features: { freeConversation: true },
      limits: { maxTranscriptLineChars: 2000, maxTranscriptLines: 400 },
      support: { email: null },
      minSupportedVersion: null,
    });
    expect(JSON.stringify(meta)).not.toMatch(/stub|openai|gemini|sk-/i);
  });

  test("reflects the settings: a feature turned off is off, the tutor's name and support email show", async () => {
    try {
      await setSettings({ appName: "Team Spanish", tutorName: "Marta", supportEmail: "help@example.com", features: { freeConversation: false }, minSupportedVersion: "1.2.0" });
      const meta = (await anon().get("/api/meta").expect(200)).body as AppMeta;
      expect(meta).toMatchObject({ appName: "Team Spanish", tutorName: "Marta", support: { email: "help@example.com" }, features: { freeConversation: false }, minSupportedVersion: "1.2.0" });
    } finally {
      await resetSettings();
    }
  });

  test("the operator's tutor addendum stays on the server", async () => {
    try {
      await setSettings({ tutorAddendum: "House rule: SECRET_ADDENDUM_TEXT" });
      expect((await anon().get("/api/meta").expect(200)).text).not.toContain("SECRET_ADDENDUM_TEXT");
    } finally {
      await resetSettings();
    }
  });
});

describe("GET /api/meta/languages", () => {
  test("public; the languages the brief names, English teachable, a few not", async () => {
    const res = await anon().get("/api/meta/languages").expect(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    const list = res.body as LanguageOption[];
    for (const code of ["es", "fr", "de", "it", "pt", "ja", "ko", "zh", "ar", "ru", "hi", "ta", "te", "kn", "ml", "bn", "mr", "gu", "pa", "ur", "en"]) expect(list.some((l) => l.code === code)).toBe(true);
    expect(list.find((l) => l.code === "en")).toEqual({ code: "en", name: "English", nativeName: "English", teachable: true });
    expect(list.find((l) => l.code === "es")?.nativeName).toBe("Español");
    const notTeachable = list.filter((l) => !l.teachable);
    expect(notTeachable.length).toBeGreaterThan(0);
    expect(notTeachable.length).toBeLessThan(list.length / 2);
  });
});

describe("GET /api/me/realtime-models", () => {
  test("enabled voice models of usable providers only, with voices and the default marked", async () => {
    const ada = await createUser();
    await anon().get("/api/me/realtime-models").expect(401);
    const list = (await as(ada).get("/api/me/realtime-models").expect(200)).body as RealtimeModelOption[];
    const { voice, text } = await stubModels();
    expect(list.find((m) => m.id === voice)).toEqual({ id: voice, displayName: "Stub voice", description: expect.any(String), provider: "stub", voices: ["default"], isDefault: true });
    // Text models are never offered as voices.
    expect(list.some((m) => m.id === text)).toBe(false);
    // OpenAI has a (canary) key in the tests; Gemini has none, so its voice model is not offered.
    expect(list.some((m) => m.provider === "openai")).toBe(true);
    expect(list.some((m) => m.provider === "gemini")).toBe(false);
  });
});

describe("preferences", () => {
  test("defaults, a partial patch, and strict validation", async () => {
    const ada = await createUser();
    expect((await as(ada).get("/api/me/preferences").expect(200)).body).toEqual({ voice: "alloy", defaultRealtimeModelId: null });
    const { voice, text } = await stubModels();
    const updated = (await as(ada).patch("/api/me/preferences").send({ voice: "nova", defaultRealtimeModelId: voice }).expect(200)).body as Preferences;
    expect(updated).toEqual({ voice: "nova", defaultRealtimeModelId: voice });
    expect(((await as(ada).patch("/api/me/preferences").send({ defaultRealtimeModelId: null }).expect(200)).body as Preferences).voice).toBe("nova");
    expect((await as(ada).patch("/api/me/preferences").send({ voice: "x".repeat(41) }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    // The old interview-era fields are gone, and nothing else is accepted.
    expect((await as(ada).patch("/api/me/preferences").send({ proctoringDefault: true }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    expect((await as(ada).patch("/api/me/preferences").send({ transcriptionLanguage: "hi" }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    expect((await as(ada).patch("/api/me/preferences").send({ instructions: "obey me" }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    expect((await as(ada).patch("/api/me/preferences").send({ defaultRealtimeModelId: text }).expect(400)).body.code).toBe("MODEL_UNAVAILABLE");
    expect((await as(ada).patch("/api/me/preferences").send({ defaultRealtimeModelId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }).expect(400)).body.code).toBe("MODEL_UNAVAILABLE");
  });

  test("only your own preferences; a suspended account cannot change them", async () => {
    const ada = await createUser();
    const bob = await createUser();
    await as(ada).patch("/api/me/preferences").send({ voice: "nova" }).expect(200);
    expect(((await as(bob).get("/api/me/preferences").expect(200)).body as Preferences).voice).toBe("alloy");
    const sus = await createUser({ status: "SUSPENDED" });
    expect((await as(sus).patch("/api/me/preferences").send({ voice: "nova" }).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
  });

  test("a voice the model does not offer falls back to its first voice; the tutor's name is in the stub script", async () => {
    const ada = await createUser();
    try {
      await setSettings({ tutorName: "Marta" });
      await as(ada).patch("/api/me/preferences").send({ voice: "nova" }).expect(200);
      const p = await startPractice(ada);
      const grant = await startLive(ada, p.id);
      expect(grant.voice).toBe("default");
      expect(grant.script?.[1]).toContain("Me llamo Marta");
    } finally {
      await resetSettings();
    }
  });
});

describe("the learner profile", () => {
  test("created with defaults on first read; a patch validates languages, level and goals", async () => {
    const ada = await createUser();
    await anon().get("/api/me/profile").expect(401);
    const first = (await as(ada).get("/api/me/profile").expect(200)).body as LearnerProfile;
    expect(first).toEqual({ nativeLanguage: "en", targetLanguage: "es", level: "A1", goals: ["DAILY"], dailyMinutesTarget: 10, onboardingComplete: false });

    const done = await onboard(ada, { targetLanguage: "fr", level: "A2", goals: ["TRAVEL", "BUSINESS", "TRAVEL"], dailyMinutesTarget: 20 });
    expect(done).toEqual({ nativeLanguage: "en", targetLanguage: "fr", level: "A2", goals: ["TRAVEL", "BUSINESS"], dailyMinutesTarget: 20, onboardingComplete: true });

    const code = async (body: object) => (await as(ada).put("/api/me/profile").send(body)).body.code;
    expect(await code({ targetLanguage: "xx" })).toBe("LANGUAGE_UNKNOWN");
    expect(await code({ nativeLanguage: "xx" })).toBe("LANGUAGE_UNKNOWN");
    expect(await code({ targetLanguage: "kn" })).toBe("LANGUAGE_NOT_TEACHABLE");
    expect(await code({ targetLanguage: "en" })).toBe("LANGUAGE_SAME");
    expect(await code({ goals: [] })).toBe("VALIDATION_FAILED");
    expect(await code({ goals: ["FUN"] })).toBe("VALIDATION_FAILED");
    expect(await code({ level: "D1" })).toBe("VALIDATION_FAILED");
    expect(await code({ dailyMinutesTarget: 0 })).toBe("VALIDATION_FAILED");
    expect(await code({ userId: "x" })).toBe("VALIDATION_FAILED");
    // A native language that can be learned is fine; English is teachable.
    expect(((await as(ada).put("/api/me/profile").send({ nativeLanguage: "hi", targetLanguage: "en" }).expect(200)).body as LearnerProfile).targetLanguage).toBe("en");
  });

  test("only your own; a suspended account can read but not change it", async () => {
    const ada = await createUser();
    const bob = await createUser();
    await onboard(ada, { level: "C1" });
    expect(((await as(bob).get("/api/me/profile").expect(200)).body as LearnerProfile).level).toBe("A1");
    const sus = await createUser({ status: "SUSPENDED" });
    await as(sus).get("/api/me/profile").expect(200);
    expect((await as(sus).put("/api/me/profile").send({ level: "B1" }).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
  });
});

describe("GET /api/me/usage", () => {
  test("signed in only; this month's counters with the reset time", async () => {
    await anon().get("/api/me/usage").expect(401);
    const ada = await createUser();
    const usage = (await as(ada).get("/api/me/usage").expect(200)).body as Usage;
    expect(Object.keys(usage).sort()).toEqual(["maxSessionMinutes", "month", "resetsAt", "sessions", "voiceMinutes"]);
    expect(Date.parse(usage.resetsAt)).toBeGreaterThan(Date.now());
  });
});
