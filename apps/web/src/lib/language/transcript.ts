/**
 * Transcript handling for the room: the tutor's native-language parenthetical, line
 * merging while a line streams in, and the cleanup applied before a transcript is sent.
 * The server clamps and cleans again; this keeps the request small and the report honest.
 */
import type { TranscriptLine } from "@open-language/types";

export interface SplitLine {
  /** What the tutor said in the language being learned. */
  main: string;
  /** The native-language gloss in the trailing parentheses, if the line ends with one. */
  translation: string | null;
}

/**
 * "Hola, ¿cómo estás? (Hello, how are you?)" splits into the Spanish and the English.
 * Only a parenthetical at the very end counts, and only when something precedes it, so
 * "Me llamo Ana (y tú?) gracias" and a bare "(Hello)" stay whole.
 */
export function splitTutorLine(text: string): SplitLine {
  const t = text.trim();
  const m = /^(.*\S)\s*\(([^()]{2,400})\)\s*$/s.exec(t);
  if (!m) return { main: t, translation: null };
  return { main: m[1]!.trim(), translation: m[2]!.trim() };
}

/** A line as the room shows it: `partial` is still being spoken. */
export type ShownLine = { role: "tutor" | "learner"; text: string; partial?: boolean };

/** Add an event's line: a partial line replaces the previous partial of the same speaker. */
export function mergeLine(lines: readonly ShownLine[], next: ShownLine): ShownLine[] {
  const last = lines[lines.length - 1];
  if (last && last.partial && last.role === next.role) return [...lines.slice(0, -1), next];
  return [...lines, next];
}

export interface CleanOptions {
  maxLines?: number;
  maxChars?: number;
}

/**
 * The transcript to hand in: whitespace collapsed, empty lines and immediate repeats
 * dropped, each line cut to `maxChars` and the whole to the last `maxLines`.
 * Defaults mirror AppMeta.limits (400 lines of 2000 characters).
 */
export function cleanTranscript(lines: readonly TranscriptLine[], opts: CleanOptions = {}): TranscriptLine[] {
  const maxLines = opts.maxLines ?? 400;
  const maxChars = opts.maxChars ?? 2000;
  const out: TranscriptLine[] = [];
  for (const l of lines) {
    const text = l.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === l.role && prev.text === text.slice(0, maxChars)) continue;
    out.push({ role: l.role, text: text.length > maxChars ? text.slice(0, maxChars) : text });
  }
  return out.length > maxLines ? out.slice(out.length - maxLines) : out;
}

/** True when the learner said anything, so an empty session can skip the lesson report. */
export function hasLearnerSpeech(lines: readonly TranscriptLine[]): boolean {
  return lines.some((l) => l.role === "learner" && l.text.trim().length > 0);
}
