import { describe, expect, it } from "vitest";
import type { LanguageOption, ScorePoint } from "@open-language/types";
import { isRtl, languageLabel, languageName, sortLanguages, stepReady, targetChoices } from "@/lib/language/languages";
import { scenarioErrors, toScenarioInput, type ScenarioDraft } from "@/lib/language/scenarios";
import { scoreText, scoreTone, scoreWord, clock, minutesText } from "@/lib/language/format";
import { activityLevel, goalProgress, streakText, trendDelta, trendGeometry } from "@/lib/language/progress";

const langs: LanguageOption[] = [
  { code: "es", name: "Spanish", nativeName: "Español", teachable: true },
  { code: "en", name: "English", nativeName: "English", teachable: true },
  { code: "ur", name: "Urdu", nativeName: "اردو", teachable: false },
  { code: "fr", name: "French", nativeName: "Français", teachable: true },
];

describe("language helpers", () => {
  it("names and labels languages", () => {
    expect(languageName("es", langs)).toBe("Spanish");
    expect(languageName("zz", langs)).toBe("ZZ");
    expect(languageName("es", undefined)).toBe("ES");
    expect(languageLabel(langs[0]!)).toBe("Spanish (Español)");
    expect(languageLabel(langs[1]!)).toBe("English");
  });
  it("sorts alphabetically, optionally pinning English", () => {
    expect(sortLanguages(langs).map((l) => l.code)).toEqual(["en", "fr", "es", "ur"]);
    expect(sortLanguages(langs, true)[0]!.code).toBe("en");
  });
  it("offers only teachable languages other than the native one as targets", () => {
    expect(targetChoices(langs, "en").map((l) => l.code)).toEqual(["fr", "es"]);
    expect(targetChoices(langs, "es").map((l) => l.code)).toEqual(["en", "fr"]);
  });
  it("knows which steps of the wizard are ready", () => {
    expect(stepReady(1, { nativeLanguage: "en", targetLanguage: "en", goals: [] })).toBe(true);
    expect(stepReady(2, { nativeLanguage: "en", targetLanguage: "en", goals: [] })).toBe(false);
    expect(stepReady(2, { nativeLanguage: "en", targetLanguage: "es", goals: [] })).toBe(true);
    expect(stepReady(3, { nativeLanguage: "en", targetLanguage: "es", goals: [] })).toBe(false);
    expect(stepReady(3, { nativeLanguage: "en", targetLanguage: "es", goals: ["TRAVEL"] })).toBe(true);
    expect(stepReady(4, { nativeLanguage: "en", targetLanguage: "es", goals: [] })).toBe(true);
  });
  it("flags right-to-left scripts", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("ur")).toBe(true);
    expect(isRtl("es")).toBe(false);
  });
});

describe("score words", () => {
  it("bands scores out of 10 in words and tone", () => {
    expect(scoreWord(null)).toBe("Not scored");
    expect(scoreWord(9.2)).toBe("Excellent");
    expect(scoreWord(7.5)).toBe("Strong");
    expect(scoreWord(6)).toBe("Solid");
    expect(scoreWord(4)).toBe("Getting there");
    expect(scoreWord(2)).toBe("Needs practice");
    expect(scoreTone(8)).toBe("text-success");
    expect(scoreTone(3)).toBe("text-danger");
    expect(scoreTone(null)).toBe("text-subtle-foreground");
  });
  it("formats numbers, clocks and durations", () => {
    expect(scoreText(7)).toBe("7");
    expect(scoreText(7.25)).toBe("7.3");
    expect(scoreText(null)).toBe("n/a");
    expect(clock(65)).toBe("1:05");
    expect(clock(-3)).toBe("0:00");
    expect(minutesText(20)).toBe("under a minute");
    expect(minutesText(60)).toBe("1 minute");
    expect(minutesText(600)).toBe("10 minutes");
  });
});

describe("progress charts", () => {
  const pt = (overall: number, i: number): ScorePoint => ({ sessionId: String(i), at: `2026-11-0${i + 1}T10:00:00Z`, overall, scores: { fluency: overall, accuracy: overall, vocabRange: overall, confidence: overall } });
  it("grades activity into five levels", () => {
    expect([0, 3, 10, 20, 45].map(activityLevel)).toEqual([0, 1, 2, 3, 4]);
  });
  it("lays the trend out inside the box, higher scores higher up", () => {
    const g = trendGeometry([pt(2, 0), pt(10, 1), pt(6, 2)], 300, 100, 10);
    expect(g.dots).toHaveLength(3);
    expect(g.dots[0]!.x).toBe(10);
    expect(g.dots[2]!.x).toBe(290);
    expect(g.dots[1]!.y).toBeLessThan(g.dots[0]!.y);
    expect(g.dots[1]!.y).toBe(10);
    expect(g.line.split(" ")).toHaveLength(3);
    expect(g.grid.map((l) => l.label)).toEqual(["2", "4", "6", "8", "10"]);
  });
  it("draws no line for one point and clamps wild scores", () => {
    const g = trendGeometry([pt(99, 0)], 200, 100, 10);
    expect(g.line).toBe("");
    expect(g.dots[0]!.y).toBe(10);
    expect(trendGeometry([], 200, 100).dots).toEqual([]);
  });
  it("measures the change from the first to the last third", () => {
    expect(trendDelta([pt(5, 0), pt(6, 1), pt(7, 2)])).toBeNull();
    expect(trendDelta([4, 4, 6, 6, 8, 8].map(pt))).toBe(4);
    expect(trendDelta([8, 8, 6, 6, 4, 4].map(pt))).toBe(-4);
  });
  it("words the streak and the daily goal", () => {
    expect(streakText(0)).toBe("No streak yet");
    expect(streakText(1)).toBe("1 day streak");
    expect(streakText(12)).toBe("12 day streak");
    expect(goalProgress(5, 10)).toBe(0.5);
    expect(goalProgress(30, 10)).toBe(1);
    expect(goalProgress(5, 0)).toBe(0);
  });
});

describe("scenario form", () => {
  const draft: ScenarioDraft = { title: " Airport ", description: "Pass through immigration.", levelMin: "A2", levelMax: "B2", goals: ["TRAVEL"], promptTemplate: "You are a border officer at an airport.", sortOrder: "", isActive: true };
  it("accepts a good draft and builds the request body, leaving the order to the server when empty", () => {
    expect(scenarioErrors(draft)).toEqual({});
    expect(toScenarioInput(draft)).toEqual({ title: "Airport", description: "Pass through immigration.", levelMin: "A2", levelMax: "B2", goals: ["TRAVEL"], promptTemplate: "You are a border officer at an airport.", isActive: true });
    expect(toScenarioInput({ ...draft, sortOrder: " 4 " }).sortOrder).toBe(4);
  });
  it("names every problem", () => {
    const e = scenarioErrors({ ...draft, title: " ", description: "", levelMin: "C1", levelMax: "A1", goals: [], promptTemplate: "short", sortOrder: "x" });
    expect(Object.keys(e).sort()).toEqual(["description", "goals", "levelMax", "promptTemplate", "sortOrder", "title"]);
  });
});
