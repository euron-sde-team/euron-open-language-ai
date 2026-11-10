/** Words for statuses, scores and durations, shared by lists, the report and the dashboard. */
import type { CorrectionType, DrillType, PracticeStatus } from "@open-language/types";

export function statusWord(s: PracticeStatus, short = false): string {
  switch (s) {
    case "IN_PROGRESS":
      return short ? "Open" : "In progress";
    case "ANALYZING":
      return short ? "Writing" : "Writing your lesson";
    case "FAILED":
      return short ? "Failed" : "Lesson failed";
    case "COMPLETED":
      return "Finished";
  }
}

/** A score band in words, so colour is never the only signal. Scores run 1 to 10. */
export function scoreWord(n: number | null): string {
  if (n === null) return "Not scored";
  if (n >= 9) return "Excellent";
  if (n >= 7.5) return "Strong";
  if (n >= 6) return "Solid";
  if (n >= 4) return "Getting there";
  return "Needs practice";
}

export function scoreTone(n: number | null): string {
  if (n === null) return "text-subtle-foreground";
  if (n >= 7.5) return "text-success";
  if (n >= 6) return "text-foreground";
  if (n >= 4) return "text-warning";
  return "text-danger";
}

export function scoreText(n: number | null): string {
  return n === null ? "n/a" : Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function minutesText(seconds: number | null): string {
  if (seconds === null) return "";
  const m = Math.round(seconds / 60);
  return m < 1 ? "under a minute" : m === 1 ? "1 minute" : `${m} minutes`;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const CORRECTION_LABEL: Record<CorrectionType, string> = {
  grammar: "Grammar",
  pronunciation: "Pronunciation",
  word_choice: "Word choice",
  other: "Other",
};

export const DRILL_LABEL: Record<DrillType, string> = {
  fill_blank: "Fill in the blank",
  translation: "Translate",
  speak_this: "Say it out loud",
};

export const SCORE_LABEL = { fluency: "Fluency", accuracy: "Accuracy", vocabRange: "Vocabulary range", confidence: "Confidence" } as const;
