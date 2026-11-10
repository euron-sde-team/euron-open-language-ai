import { describe, expect, it } from "vitest";
import { cleanTranscript, hasLearnerSpeech, mergeLine, splitTutorLine, type ShownLine } from "@/lib/language/transcript";

describe("splitTutorLine", () => {
  it("separates the target language from the native gloss", () => {
    expect(splitTutorLine("Hola, ¿cómo estás? (Hello, how are you?)")).toEqual({ main: "Hola, ¿cómo estás?", translation: "Hello, how are you?" });
    expect(splitTutorLine("  Bonjour ! (Hello!)  ")).toEqual({ main: "Bonjour !", translation: "Hello!" });
  });
  it("keeps lines without a trailing parenthetical whole", () => {
    expect(splitTutorLine("Me llamo Ana (y tú?) gracias")).toEqual({ main: "Me llamo Ana (y tú?) gracias", translation: null });
    expect(splitTutorLine("(Hello)")).toEqual({ main: "(Hello)", translation: null });
    expect(splitTutorLine("Hola")).toEqual({ main: "Hola", translation: null });
  });
  it("handles multi-line replies and non-latin scripts", () => {
    expect(splitTutorLine("नमस्ते!\nआप कैसे हैं? (Hello! How are you?)")).toEqual({ main: "नमस्ते!\nआप कैसे हैं?", translation: "Hello! How are you?" });
  });
});

describe("cleanTranscript", () => {
  it("collapses whitespace and drops empty lines and immediate repeats", () => {
    const out = cleanTranscript([
      { role: "tutor", text: "  Hola   amigo " },
      { role: "learner", text: "   " },
      { role: "learner", text: "Hola\n\nhola" },
      { role: "learner", text: "Hola hola" },
      { role: "tutor", text: "Hola amigo" },
    ]);
    expect(out).toEqual([
      { role: "tutor", text: "Hola amigo" },
      { role: "learner", text: "Hola hola" },
      { role: "tutor", text: "Hola amigo" },
    ]);
  });
  it("cuts long lines and keeps the last lines when there are too many", () => {
    expect(cleanTranscript([{ role: "learner", text: "a".repeat(30) }], { maxChars: 10 })[0]!.text).toHaveLength(10);
    const many = Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 ? "tutor" : "learner") as "tutor" | "learner", text: `line ${i}` }));
    const out = cleanTranscript(many, { maxLines: 3 });
    expect(out.map((l) => l.text)).toEqual(["line 7", "line 8", "line 9"]);
  });
  it("uses the API's limits by default", () => {
    const out = cleanTranscript(Array.from({ length: 500 }, (_, i) => ({ role: "learner" as const, text: `n${i}` })));
    expect(out).toHaveLength(400);
    expect(out[0]!.text).toBe("n100");
  });
  it("tells whether the learner said anything", () => {
    expect(hasLearnerSpeech([{ role: "tutor", text: "Hola" }])).toBe(false);
    expect(hasLearnerSpeech([{ role: "tutor", text: "Hola" }, { role: "learner", text: "Hola" }])).toBe(true);
  });
});

describe("mergeLine", () => {
  it("replaces a partial line of the same speaker and appends otherwise", () => {
    let lines: ShownLine[] = [];
    lines = mergeLine(lines, { role: "tutor", text: "Hol", partial: true });
    lines = mergeLine(lines, { role: "tutor", text: "Hola, ¿cómo", partial: true });
    expect(lines).toHaveLength(1);
    lines = mergeLine(lines, { role: "tutor", text: "Hola, ¿cómo estás? (Hello, how are you?)" });
    expect(lines).toEqual([{ role: "tutor", text: "Hola, ¿cómo estás? (Hello, how are you?)", partial: undefined }]);
    lines = mergeLine(lines, { role: "learner", text: "Bien" });
    expect(lines).toHaveLength(2);
  });
  it("does not overwrite a finished line", () => {
    const lines = mergeLine([{ role: "tutor", text: "Done" }], { role: "tutor", text: "Next", partial: true });
    expect(lines).toHaveLength(2);
  });
});
