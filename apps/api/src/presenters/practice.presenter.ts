/** Rows to DTOs for practice sessions, scenarios, profiles and the deck. Callers load by owner. */
import type { AdminScenario, Correction, Drill, Goal, LearnerProfile, LessonScores, Level, PracticeSession, PracticeSummary, Scenario, TranscriptLine, VocabItem, VocabSuggestion } from "@open-language/types";
import type { Selectable } from "kysely";
import type { Corrections, Drills, LearnerProfiles, PracticeSessions, Scenarios, VocabItems } from "../db/types";
import { isMastered } from "../services/practice/srs";

export type PracticeRow = Selectable<PracticeSessions>;
export type CorrectionRow = Selectable<Corrections>;
export type DrillRow = Selectable<Drills>;
export type ScenarioRow = Selectable<Scenarios>;
export type ProfileRow = Selectable<LearnerProfiles>;
export type VocabRow = Selectable<VocabItems>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function toSummary(r: PracticeRow): PracticeSummary {
  return {
    id: r.id,
    scenarioId: r.scenario_id,
    title: r.title,
    status: r.status,
    targetLanguage: r.target_language,
    nativeLanguage: r.native_language,
    level: r.level as Level,
    startedAt: r.started_at.toISOString(),
    endedAt: iso(r.ended_at),
    durationSec: r.duration_sec,
    overallScore: r.overall_score === null ? null : Number(r.overall_score),
  };
}

export function toSession(r: PracticeRow, corrections: CorrectionRow[], drills: DrillRow[], saved: Set<string>): PracticeSession {
  const suggestions = Array.isArray(r.vocab_suggestions) ? (r.vocab_suggestions as unknown as { phrase: string; meaningNative: string; examples?: string[] }[]) : [];
  const vocab: VocabSuggestion[] = suggestions.map((v) => ({ phrase: v.phrase, meaningNative: v.meaningNative, examples: strings(v.examples), saved: saved.has(v.phrase.toLowerCase()) }));
  return {
    ...toSummary(r),
    transcript: Array.isArray(r.transcript) ? (r.transcript as unknown as TranscriptLine[]) : [],
    summary: r.summary,
    scores: (r.scores as unknown as LessonScores | null) ?? null,
    corrections: corrections.map((c): Correction => ({ id: c.id, type: c.type, original: c.original, corrected: c.corrected, explanation: c.explanation })),
    drills: drills.map((d): Drill => ({ id: d.id, type: d.type, question: d.question, answer: d.answer, hints: strings(d.hints) })),
    vocab,
    error: r.error,
  };
}

export function toProfile(r: ProfileRow): LearnerProfile {
  return { nativeLanguage: r.native_language, targetLanguage: r.target_language, level: r.level as Level, goals: r.goals as Goal[], dailyMinutesTarget: r.daily_minutes_target, onboardingComplete: r.onboarding_complete };
}

export function toScenario(r: ScenarioRow): Scenario {
  return { id: r.id, title: r.title, description: r.description, levelMin: r.level_min as Level, levelMax: r.level_max as Level, goals: r.goals as Goal[], sortOrder: r.sort_order, isActive: r.is_active };
}

export function toAdminScenario(r: ScenarioRow): AdminScenario {
  return { ...toScenario(r), promptTemplate: r.prompt_template, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() };
}

export function toVocabItem(r: VocabRow): VocabItem {
  return {
    id: r.id,
    phrase: r.phrase,
    meaningNative: r.meaning_native,
    examples: strings(r.examples),
    targetLanguage: r.target_language,
    repetitions: r.repetitions,
    nextReviewAt: r.next_review_at.toISOString(),
    mastered: isMastered(r.interval_days),
    createdAt: r.created_at.toISOString(),
  };
}
