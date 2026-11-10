/**
 * The LLM lesson engine: the configured text model writes the report, a schema checks it.
 * generateJson makes two attempts and repairs the usual damage (fences, prose, a cut-off
 * tail); a reply that still fails the schema is a ModelOutputError, which the caller turns
 * into the offline engine.
 */
import { z } from "zod";
import type { ResolvedModel } from "../../models.service";
import { generateJson } from "../ai";
import { lessonPrompt } from "../prompts";
import { clampScore, DRILL_COUNT, MAX_VOCAB, type LessonInput, type LessonResult } from "./types";

const str = (max: number) => z.string().trim().min(1).max(max);
const text = (max: number) => z.string().trim().max(max);
const rating = z.coerce.number().min(0).max(10);

/** The shape the model must return. Lengths are generous, then cut to what the database keeps. */
export const lessonEngineSchema = z.object({
  summary: text(4000).default(""),
  corrections: z
    .array(z.object({ type: z.enum(["grammar", "pronunciation", "word_choice", "other"]), original: str(2000), corrected: str(2000), explanation: text(2000).nullish() }))
    .max(40)
    .default([]),
  vocab: z.array(z.object({ phrase: str(400), meaningNative: str(600), examples: z.array(str(500)).max(5).default([]) })).max(40).default([]),
  drills: z.array(z.object({ type: z.enum(["fill_blank", "translation", "speak_this"]), question: str(1000), answer: str(1000), hints: z.array(str(300)).max(5).default([]) })).min(DRILL_COUNT).max(40),
  score: z.object({ fluency: rating, accuracy: rating, vocabRange: rating, confidence: rating }),
});

/** Only the last stretch of a very long conversation goes to the model. */
const MAX_PROMPT_CHARS = 24_000;

export async function analyzeWithModel(model: ResolvedModel, userId: string, input: LessonInput): Promise<LessonResult> {
  let used = 0;
  const kept = [];
  for (let i = input.transcript.length - 1; i >= 0; i--) {
    used += input.transcript[i]!.text.length + 10;
    if (used > MAX_PROMPT_CHARS) break;
    kept.unshift(input.transcript[i]!);
  }
  const prompt = lessonPrompt({ ...input, transcript: kept });
  const out = await generateJson({ model, userId, system: prompt.system, user: prompt.user, schema: lessonEngineSchema, maxOutputTokens: 6000, temperature: 0.3 });
  return {
    summary: out.summary.slice(0, 2000),
    corrections: out.corrections.slice(0, 20).map((c) => ({ type: c.type, original: c.original.slice(0, 500), corrected: c.corrected.slice(0, 500), explanation: c.explanation ? c.explanation.slice(0, 800) : null })),
    vocab: out.vocab.slice(0, MAX_VOCAB).map((v) => ({ phrase: v.phrase.slice(0, 200), meaningNative: v.meaningNative.slice(0, 300), examples: v.examples.map((e) => e.slice(0, 500)) })),
    drills: out.drills.slice(0, DRILL_COUNT).map((d) => ({ type: d.type, question: d.question.slice(0, 500), answer: d.answer.slice(0, 500), hints: d.hints.map((h) => h.slice(0, 300)) })),
    scores: { fluency: clampScore(out.score.fluency), accuracy: clampScore(out.score.accuracy), vocabRange: clampScore(out.score.vocabRange), confidence: clampScore(out.score.confidence) },
  };
}
