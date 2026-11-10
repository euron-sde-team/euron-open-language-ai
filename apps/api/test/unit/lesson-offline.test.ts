/** The offline lesson engine: deterministic, honest, and cheap rules only. */
import type { TranscriptLine } from "@open-language/types";
import { describe, expect, test } from "vitest";
import { analyzeOffline, correctionsFor, drillsFor, scoreFrom, tokens, translatedPhrases } from "../../src/services/practice/lesson/offline";
import type { LessonInput } from "../../src/services/practice/lesson/types";

const t = (text: string): TranscriptLine => ({ role: "tutor", text });
const l = (text: string): TranscriptLine => ({ role: "learner", text });

const base: LessonInput = {
  transcript: [
    t("Hola, ¿cómo estás? (Hello, how are you?)"),
    l("Hola, estoy muy bien, gracias. Quiero practicar mi español hoy con ustedes."),
    t("¡Perfecto! (Perfect!) ¿Qué hiciste ayer? (What did you do yesterday?)"),
    l("ayer fui al mercado y compré frutas para la cena."),
  ],
  targetLanguage: "es",
  nativeLanguage: "en",
  level: "B1",
  scenarioTitle: "Small talk with a coworker",
};

describe("determinism", () => {
  test("the same input gives the same report, byte for byte", () => {
    expect(JSON.stringify(analyzeOffline(base))).toBe(JSON.stringify(analyzeOffline(structuredClone(base))));
  });

  test("a report has a summary, four scores in 1..10, at most ten vocabulary items and exactly five drills", () => {
    const r = analyzeOffline(base);
    expect(r.summary).toContain("Spanish");
    expect(r.summary).toContain("Small talk with a coworker");
    expect(r.summary).toContain("offline engine");
    for (const v of Object.values(r.scores)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(10);
    }
    expect(r.vocab.length).toBeLessThanOrEqual(10);
    expect(r.drills).toHaveLength(5);
    expect(new Set(r.drills.map((d) => d.question)).size).toBe(5);
  });
});

describe("vocabulary", () => {
  test("comes from the tutor's lines that carry a native-language parenthetical", () => {
    expect(translatedPhrases(["Hola, ¿cómo estás? (Hello, how are you?)", "¡Perfecto! (Perfect!) ¿Qué hiciste ayer? (What did you do yesterday?)", "Sin traducción aquí."])).toEqual([
      { phrase: "Hola, ¿cómo estás?", meaningNative: "Hello, how are you?" },
      { phrase: "¡Perfecto!", meaningNative: "Perfect!" },
      { phrase: "¿Qué hiciste ayer?", meaningNative: "What did you do yesterday?" },
    ]);
  });

  test("skips repeats, identical pairs and parentheses with nothing to translate", () => {
    const got = translatedPhrases(["Hola (Hello)", "hola (Hello again)", "OK (OK)", "(sin frase)", "Gracias (x)"]);
    expect(got.map((g) => g.phrase)).toEqual(["Hola"]);
  });

  test("the learner's own lines are never vocabulary", () => {
    const r = analyzeOffline({ ...base, transcript: [l("Gracias (Thanks)"), t("Nada.")] });
    expect(r.vocab).toEqual([]);
  });
});

describe("corrections", () => {
  test("a repeated word is found once per line and removed", () => {
    expect(correctionsFor(["Yo quiero quiero un café"], "es")).toEqual([
      { type: "other", original: "Yo quiero quiero un café", corrected: "Yo quiero un café", explanation: "A word was said twice in a row." },
    ]);
  });

  test("a lower-case start is fixed for Latin-script languages only", () => {
    expect(correctionsFor(["ayer fui al mercado."], "es")[0]).toMatchObject({ corrected: "Ayer fui al mercado." });
    expect(correctionsFor(["यह एक वाक्य है"], "hi")).toEqual([]);
    expect(correctionsFor(["私は学生です"], "ja")).toEqual([]);
  });

  test('English: a lower-case "i" becomes "I", with its contractions', () => {
    expect(correctionsFor(["Yesterday i went home and i'm tired"], "en")[0]).toMatchObject({ type: "grammar", corrected: "Yesterday I went home and I'm tired" });
    expect(correctionsFor(["Yesterday I went home in a taxi"], "en")).toEqual([]);
    // The same line in another language is left alone.
    expect(correctionsFor(["Yesterday i went home"], "fr")).toEqual([]);
  });

  test("a correct line gets none, and the number is capped", () => {
    expect(correctionsFor(["Estoy muy bien, gracias."], "es")).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `línea número ${i} sin mayúscula`);
    expect(correctionsFor(many, "es")).toHaveLength(8);
  });

  test("never invents grammar mistakes", () => {
    const r = analyzeOffline({ ...base, transcript: [t("Hola (Hello)"), l("Yo es de Inglaterra y yo tiene un gato.")] });
    expect(r.corrections).toEqual([]);
  });
});

describe("scores", () => {
  test("a learner who said nothing scores the floor on everything", () => {
    const r = analyzeOffline({ ...base, transcript: [t("Hola (Hello)")] });
    expect(r.scores).toEqual({ fluency: 1, accuracy: 1, vocabRange: 1, confidence: 1 });
    expect(r.summary).toContain("No speech");
  });

  test("longer, more varied answers score higher than one-word answers", () => {
    const short = analyzeOffline({ ...base, transcript: [t("Hola (Hello)"), l("sí"), t("¿Y ayer? (And yesterday?)"), l("no")] }).scores;
    const long = analyzeOffline(base).scores;
    expect(long.fluency).toBeGreaterThan(short.fluency);
    expect(long.confidence).toBeGreaterThan(short.confidence);
    expect(long.vocabRange).toBeGreaterThanOrEqual(short.vocabRange);
  });

  test("hesitation markers lower fluency and confidence", () => {
    const clean = ["Quiero un café con leche por favor"];
    const hesitant = ["um... quiero uh un café... eh con leche... hmm por favor"];
    const stats = (lines: string[]) => scoreFrom({ lines: lines.length, words: lines.join(" ").split(" ").length, unique: 8, hesitations: lines === clean ? 0 : 6, shortLines: 0, leakLines: 0, longest: 8 }, 0);
    expect(stats(hesitant).fluency).toBeLessThan(stats(clean).fluency);
    expect(stats(hesitant).confidence).toBeLessThan(stats(clean).confidence);
  });

  test("words from the learner's own language lower accuracy and confidence", () => {
    const own = analyzeOffline({ ...base, transcript: [t("Hola (Hello)"), l("Yo quiero the coffee and the milk with my friends")] }).scores;
    const target = analyzeOffline({ ...base, transcript: [t("Hola (Hello)"), l("Yo quiero el café y la leche con mis amigos")] }).scores;
    expect(own.accuracy).toBeLessThan(target.accuracy);
    expect(own.confidence).toBeLessThanOrEqual(target.confidence);
    // A different script is leakage too.
    const hi = analyzeOffline({ ...base, nativeLanguage: "hi", transcript: [t("Hola (नमस्ते)"), l("Yo quiero un café और दूध")] }).scores;
    expect(hi.accuracy).toBeLessThan(target.accuracy);
  });

  test("scripts without spaces count characters, not one giant word", () => {
    expect(tokens("私は学生です")).toHaveLength(6);
    expect(tokens("Hola, ¿cómo estás?")).toEqual(["hola", "cómo", "estás"]);
  });
});

describe("drills", () => {
  test("five drills of the three types, built from the tutor's phrases", () => {
    const r = analyzeOffline(base);
    expect(new Set(r.drills.map((d) => d.type)).size).toBeGreaterThanOrEqual(2);
    expect(r.drills.some((d) => d.type === "translation" && d.answer === "Hola, ¿cómo estás?")).toBe(true);
    const blank = r.drills.find((d) => d.type === "fill_blank")!;
    expect(blank.question).toContain("____");
    expect(blank.answer.length).toBeGreaterThan(0);
  });

  test("with only the learner's lines to go on, drills are speak-this and fill-blank, still five", () => {
    const r = analyzeOffline({ ...base, transcript: [l("Quiero practicar mi español hoy.")] });
    expect(r.drills).toHaveLength(5);
    expect(r.drills.some((d) => d.type === "translation")).toBe(false);
  });

  test("nothing to build from means no drills", () => {
    expect(drillsFor([], "Spanish")).toEqual([]);
    expect(analyzeOffline({ ...base, transcript: [t("Hola (Hello)")] }).drills).toHaveLength(5);
    expect(analyzeOffline({ ...base, transcript: [t("Sin traducción.")] }).drills).toEqual([]);
  });
});
