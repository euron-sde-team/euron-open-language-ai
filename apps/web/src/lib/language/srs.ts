/** Words for the spaced-repetition deck: when a card is due, which stage it is in, how a grade reads. */
import type { ReviewGrade, VocabItem } from "@open-language/types";

export const REVIEW_GRADES: { grade: ReviewGrade; label: string; hint: string; key: string }[] = [
  { grade: "again", label: "Again", hint: "I did not remember it", key: "1" },
  { grade: "hard", label: "Hard", hint: "I remembered it with effort", key: "2" },
  { grade: "good", label: "Good", hint: "I remembered it", key: "3" },
  { grade: "easy", label: "Easy", hint: "No effort at all", key: "4" },
];

const DAY = 86_400_000;

/** "Due now", "Due today", "Tomorrow", "In 5 days", "In 3 weeks", "In 2 months". */
export function dueLabel(nextReviewAt: string, now: number = Date.now()): string {
  const t = new Date(nextReviewAt).getTime();
  if (Number.isNaN(t)) return "";
  const diff = t - now;
  if (diff <= 0) return "Due now";
  const days = Math.ceil(diff / DAY);
  if (days <= 1) return diff < DAY / 2 ? "Due today" : "Tomorrow";
  if (days < 14) return `In ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return `In ${Math.round(days / 30)} months`;
}

export type Stage = "new" | "learning" | "mastered";

export function stageOf(item: Pick<VocabItem, "repetitions" | "mastered">): Stage {
  if (item.mastered) return "mastered";
  return item.repetitions === 0 ? "new" : "learning";
}

export const STAGE_LABEL: Record<Stage, string> = { new: "New", learning: "Learning", mastered: "Mastered" };

/** "12 cards due" / "Nothing due". */
export function dueSummary(count: number): string {
  if (count <= 0) return "Nothing due";
  return count === 1 ? "1 card due" : `${count} cards due`;
}

/** The deck's progress as a whole percentage of mastered cards (0 when empty). */
export function masteredPercent(total: number, mastered: number): number {
  if (total <= 0) return 0;
  return Math.round((Math.min(mastered, total) / total) * 100);
}

/** The grade a key press means ("1" to "4"), or null. */
export function gradeForKey(key: string): ReviewGrade | null {
  return REVIEW_GRADES.find((g) => g.key === key)?.grade ?? null;
}
