/** The lesson engine's contract: a transcript in, a lesson report out. Two implementations sit behind it. */
import type { CorrectionType, DrillType, Level, LessonScores, TranscriptLine } from "@open-language/types";

export interface LessonInput {
  transcript: TranscriptLine[];
  targetLanguage: string;
  nativeLanguage: string;
  level: Level;
  /** The scenario's title; null for free conversation. */
  scenarioTitle: string | null;
}

export interface LessonCorrection {
  type: CorrectionType;
  original: string;
  corrected: string;
  explanation: string | null;
}

export interface LessonVocab {
  phrase: string;
  meaningNative: string;
  examples: string[];
}

export interface LessonDrill {
  type: DrillType;
  question: string;
  answer: string;
  hints: string[];
}

/** What the report is made of. `vocab` has at most 10 entries, `drills` exactly 5 (none when nothing was said). */
export interface LessonResult {
  summary: string;
  corrections: LessonCorrection[];
  vocab: LessonVocab[];
  drills: LessonDrill[];
  scores: LessonScores;
}

export type EngineName = "llm" | "offline";

export const MAX_VOCAB = 10;
export const DRILL_COUNT = 5;
export const MAX_CORRECTIONS = 8;

export const clampScore = (n: number): number => Math.min(10, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));

/** Mean of the four scores, one decimal. */
export function overallOf(s: LessonScores): number {
  return Math.round(((s.fluency + s.accuracy + s.vocabRange + s.confidence) / 4) * 10) / 10;
}

export const hasLearnerSpeech = (t: TranscriptLine[]): boolean => t.some((l) => l.role === "learner" && l.text.trim().length > 0);
