/**
 * Language practice contract: the learner profile, scenarios, practice sessions (a live
 * voice conversation with the tutor), the lesson report that follows it, the vocabulary
 * deck and its spaced-repetition review, and the progress dashboard.
 *
 * Timestamps are ISO-8601 strings, ids are ULIDs. Languages are ISO-639-1 codes ("es").
 * Scores are 1 to 10. The browser never sends ratings or instructions; the server builds
 * the tutor's instructions and measures time and scores itself.
 */

// ─── Enums ──────────────────────────────────────────────────────────────────

export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Level = (typeof LEVELS)[number];

export const GOALS = ["TRAVEL", "INTERVIEW", "BUSINESS", "DAILY", "ACADEMIC"] as const;
export type Goal = (typeof GOALS)[number];

export type RealtimeProvider = "openai" | "gemini" | "stub";

/**
 * IN_PROGRESS: the learner is (or was) talking. ANALYZING: the lesson engine is writing the
 * report. COMPLETED: the report is ready. FAILED: the engine could not run; retry is allowed.
 */
export type PracticeStatus = "IN_PROGRESS" | "ANALYZING" | "COMPLETED" | "FAILED";

export type CorrectionType = "grammar" | "pronunciation" | "word_choice" | "other";
export type DrillType = "fill_blank" | "translation" | "speak_this";

// ─── Languages ──────────────────────────────────────────────────────────────

/** One language the tutor can teach or the learner can speak natively. */
export interface LanguageOption {
  code: string;
  /** English name ("Spanish"). */
  name: string;
  /** Name in the language itself ("Español"). */
  nativeName: string;
  /** True when the tutor can be asked to teach it (the target list). */
  teachable: boolean;
}

// ─── Profile ────────────────────────────────────────────────────────────────

export interface LearnerProfile {
  nativeLanguage: string;
  targetLanguage: string;
  level: Level;
  goals: Goal[];
  dailyMinutesTarget: number;
  onboardingComplete: boolean;
}

/** PUT /api/me/profile: every field optional; `onboardingComplete: true` finishes onboarding. */
export type LearnerProfilePatch = Partial<LearnerProfile>;

// ─── Scenarios ──────────────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  title: string;
  /** One or two sentences the learner sees on the card. */
  description: string;
  levelMin: Level;
  levelMax: Level;
  goals: Goal[];
  /** Lower comes first on the practice screen. */
  sortOrder: number;
  isActive: boolean;
}

/** The role-play prompt is staff-only: admins read it, learners never do. */
export interface AdminScenario extends Scenario {
  promptTemplate: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioInput {
  title: string;
  description: string;
  levelMin: Level;
  levelMax: Level;
  goals: Goal[];
  promptTemplate: string;
  sortOrder?: number;
  isActive?: boolean;
}

// ─── Live voice ─────────────────────────────────────────────────────────────

/** POST /api/practice/:id/live: what the browser needs to open one realtime session. */
export interface LiveSessionGrant {
  id: string;
  provider: RealtimeProvider;
  /**
   * A short-lived credential with the tutor's instructions locked inside it by the server.
   * OpenAI: a client secret (`ek_...`). Gemini: an ephemeral token name. Stub: a signed
   * token. Never your provider API key.
   */
  credential: string;
  model: string;
  voice: string;
  /** Where the browser connects (the API's SDP relay for OpenAI). */
  connectUrl: string | null;
  /** ISO: the credential stops working for new connections after this. */
  expiresAt: string;
  /** The server ends the session and books the minutes after this many seconds. */
  maxSeconds: number;
  /** Shown in the room: what the tutor is doing. */
  scenario: { id: string | null; title: string; description: string };
  targetLanguage: string;
  nativeLanguage: string;
  /** BCP-47 tag for the browser's speech recogniser and voice (stub transport only). */
  speechLocale: string;
  /**
   * Stub only: the lines the local tutor speaks, in order. Real providers never get this;
   * their instructions stay on the server.
   */
  script?: string[];
}

/** POST /api/practice/:id/live/:sid/end. */
export interface LiveSessionEnd {
  seconds: number;
  /** Minutes left this month after this session; null means unlimited. */
  voiceMinutesLeft: number | null;
}

// ─── Practice sessions ──────────────────────────────────────────────────────

export interface TranscriptLine {
  role: "tutor" | "learner";
  text: string;
}

export interface LessonScores {
  fluency: number;
  accuracy: number;
  vocabRange: number;
  confidence: number;
}

export interface PracticeSummary {
  id: string;
  /** Null for free conversation ("Talk about anything"). */
  scenarioId: string | null;
  title: string;
  status: PracticeStatus;
  targetLanguage: string;
  nativeLanguage: string;
  level: Level;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  /** Mean of the four scores, one decimal; null until COMPLETED. */
  overallScore: number | null;
}

export interface Correction {
  id: string;
  type: CorrectionType;
  original: string;
  corrected: string;
  /** In the learner's native language. */
  explanation: string | null;
}

export interface Drill {
  id: string;
  type: DrillType;
  question: string;
  answer: string;
  hints: string[];
}

/** A phrase worth keeping from the session, offered for the deck. */
export interface VocabSuggestion {
  phrase: string;
  meaningNative: string;
  examples: string[];
  /** True when it is already in the learner's deck. */
  saved: boolean;
}

/** GET /api/practice/:id: the session and, once COMPLETED, its lesson report. */
export interface PracticeSession extends PracticeSummary {
  transcript: TranscriptLine[];
  summary: string | null;
  scores: LessonScores | null;
  corrections: Correction[];
  drills: Drill[];
  vocab: VocabSuggestion[];
  /** Why the engine failed (short, safe to show); null otherwise. */
  error: string | null;
}

/** POST /api/practice: `scenarioId` omitted means free conversation. Books one session of quota. */
export interface PracticeStart {
  scenarioId?: string | null;
}

/** POST /api/practice/:id/end: the browser's transcript. The server measures the time. 202. */
export interface PracticeEnd {
  transcript: TranscriptLine[];
}

// ─── Vocabulary and review ──────────────────────────────────────────────────

export interface VocabItem {
  id: string;
  phrase: string;
  meaningNative: string;
  examples: string[];
  targetLanguage: string;
  /** Review stage: 0 is new, grows with each correct review. */
  repetitions: number;
  nextReviewAt: string;
  mastered: boolean;
  createdAt: string;
}

export interface VocabSaveInput {
  phrase: string;
  meaningNative: string;
  examples?: string[];
  /** The session it came from, if any. */
  sessionId?: string;
}

/** SM-2 style grade: how well the learner recalled it. */
export type ReviewGrade = "again" | "hard" | "good" | "easy";

export interface ReviewGradeInput {
  vocabId: string;
  grade: ReviewGrade;
}

/** GET /api/review/today: cards due now, oldest first (max 50), and how many remain. */
export interface ReviewToday {
  due: VocabItem[];
  totalDue: number;
  /** Reviews already done today (UTC). */
  doneToday: number;
}

// ─── Progress ───────────────────────────────────────────────────────────────

export interface DayActivity {
  /** YYYY-MM-DD, UTC. */
  date: string;
  minutes: number;
  sessions: number;
}

export interface ScorePoint {
  sessionId: string;
  at: string;
  scores: LessonScores;
  overall: number;
}

/** GET /api/me/dashboard. */
export interface Dashboard {
  profile: LearnerProfile;
  /** Consecutive UTC days with at least one finished session, ending today or yesterday. */
  streakDays: number;
  minutesToday: number;
  minutesThisWeek: number;
  totalSessions: number;
  totalMinutes: number;
  vocabTotal: number;
  vocabMastered: number;
  reviewDue: number;
  /** The last 28 days, oldest first. */
  activity: DayActivity[];
  /** The last 20 completed sessions, oldest first. */
  scoreTrend: ScorePoint[];
  recent: PracticeSummary[];
  /** The most frequent correction types in the last 30 days. */
  weakSpots: { type: CorrectionType; count: number }[];
}

// ─── Usage and preferences ──────────────────────────────────────────────────

/** GET /api/me/usage: this calendar month (UTC). Null limits mean unlimited. */
export interface Usage {
  month: string;
  sessions: { used: number; limit: number | null };
  voiceMinutes: { used: number; limit: number | null };
  maxSessionMinutes: number;
  /** ISO: when the counters reset. */
  resetsAt: string;
}

/** What the start screen offers. */
export interface RealtimeModelOption {
  id: string;
  displayName: string;
  description: string;
  provider: RealtimeProvider;
  voices: string[];
  isDefault: boolean;
}

export interface Preferences {
  voice: string;
  defaultRealtimeModelId: string | null;
}
