/** Helpers over the languages list (GET /api/meta/languages) and the learner profile. */
import { GOALS, LEVELS, type Goal, type LanguageOption, type Level } from "@open-language/types";

export const LEVEL_INFO: Record<Level, { label: string; description: string }> = {
  A1: { label: "A1 Beginner", description: "Basic words and phrases" },
  A2: { label: "A2 Elementary", description: "Simple sentences about everyday things" },
  B1: { label: "B1 Intermediate", description: "Most everyday conversations" },
  B2: { label: "B2 Upper intermediate", description: "Fluent on familiar topics" },
  C1: { label: "C1 Advanced", description: "Complex topics and nuance" },
  C2: { label: "C2 Proficient", description: "Close to a native speaker" },
};

export const GOAL_LABEL: Record<Goal, string> = {
  TRAVEL: "Travel",
  INTERVIEW: "Job interviews",
  BUSINESS: "Business",
  DAILY: "Daily conversation",
  ACADEMIC: "Academic",
};

export const GOAL_HINT: Record<Goal, string> = {
  TRAVEL: "Airports, hotels, directions and food",
  INTERVIEW: "Answering questions about yourself and your work",
  BUSINESS: "Meetings, calls and clients",
  DAILY: "Small talk and getting things done",
  ACADEMIC: "Studying and discussing ideas",
};

export const DAILY_MINUTE_CHOICES = [5, 10, 15, 20, 30, 45] as const;

export function levelLabel(level: Level): string {
  return LEVEL_INFO[level].label;
}

export const isLevel = (v: unknown): v is Level => typeof v === "string" && (LEVELS as readonly string[]).includes(v);
export const isGoal = (v: unknown): v is Goal => typeof v === "string" && (GOALS as readonly string[]).includes(v);

/** The language's English name; the code upper-cased while the list is still loading. */
export function languageName(code: string, list: readonly LanguageOption[] | undefined): string {
  return list?.find((l) => l.code === code)?.name ?? code.toUpperCase();
}

/** "Spanish (Español)", or just "English" when both names agree. */
export function languageLabel(l: LanguageOption): string {
  return l.nativeName && l.nativeName !== l.name ? `${l.name} (${l.nativeName})` : l.name;
}

/** Alphabetical by English name, English first only when `pinEnglish` is set. */
export function sortLanguages(list: readonly LanguageOption[], pinEnglish = false): LanguageOption[] {
  return [...list].sort((a, b) => {
    if (pinEnglish && (a.code === "en") !== (b.code === "en")) return a.code === "en" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Languages that can be picked as the one to learn: teachable, and not the learner's own. */
export function targetChoices(list: readonly LanguageOption[], native: string): LanguageOption[] {
  return sortLanguages(list.filter((l) => l.teachable && l.code !== native));
}

/** Whether a step of the onboarding wizard has what it needs. */
export function stepReady(step: 1 | 2 | 3 | 4, form: { nativeLanguage: string; targetLanguage: string; goals: readonly Goal[] }): boolean {
  if (step === 1) return !!form.nativeLanguage;
  if (step === 2) return !!form.targetLanguage && form.targetLanguage !== form.nativeLanguage;
  if (step === 3) return form.goals.length > 0;
  return true;
}

/** Right-to-left scripts, so a line of the target language is laid out correctly. */
const RTL = new Set(["ar", "ur", "he", "fa"]);
export const isRtl = (code: string): boolean => RTL.has(code);
