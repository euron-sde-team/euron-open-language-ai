/**
 * The browser sends the transcript it heard; the server decides what is kept. Lines are
 * trimmed, stripped of NUL bytes, clipped to 2000 characters, the last 400 are kept, and
 * the stored total is capped so one session cannot grow without bound.
 */
import type { TranscriptLine } from "@open-language/types";

export const MAX_TRANSCRIPT_LINES = 400;
export const MAX_TRANSCRIPT_CHARS_PER_LINE = 2000;
const MAX_TRANSCRIPT_TOTAL_CHARS = 80_000;

export function cleanTranscript(lines: readonly { role: string; text: string }[] | undefined): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  let total = 0;
  for (const l of (lines ?? []).slice(-MAX_TRANSCRIPT_LINES)) {
    if (l.role !== "tutor" && l.role !== "learner") continue;
    const text = l.text.replaceAll("\u0000", "").trim().slice(0, MAX_TRANSCRIPT_CHARS_PER_LINE);
    if (!text) continue;
    total += text.length;
    if (total > MAX_TRANSCRIPT_TOTAL_CHARS) break;
    out.push({ role: l.role, text });
  }
  return out;
}
