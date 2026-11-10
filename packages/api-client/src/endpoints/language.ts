/** Language practice: the learner profile, scenarios, practice sessions, vocabulary, review and progress. */
import type {
  Dashboard,
  LanguageOption,
  LearnerProfile,
  LearnerProfilePatch,
  LiveSessionEnd,
  LiveSessionGrant,
  Page,
  PracticeEnd,
  PracticeSession,
  PracticeStart,
  PracticeSummary,
  Preferences,
  RealtimeModelOption,
  ReviewGradeInput,
  ReviewToday,
  Scenario,
  Usage,
  VocabItem,
  VocabSaveInput,
} from "@open-language/types";
import { enc, type Helpers, type PageQuery } from "./helpers";

export function languageEndpoints(h: Helpers) {
  const { http, get, post, put, patch, del, pq } = h;

  const languages = {
    /** Public: every language the tutor knows, with `teachable` marking the ones it can teach. */
    list: (signal?: AbortSignal) => http.request<LanguageOption[]>("GET", "/meta/languages", { signal, noRefresh: true }),
  };

  const profile = {
    get: (signal?: AbortSignal) => get<LearnerProfile>("/me/profile", undefined, signal),
    /** Every field optional; `onboardingComplete: true` finishes onboarding. */
    update: (body: LearnerProfilePatch) => put<LearnerProfile>("/me/profile", body),
  };

  const me = {
    usage: () => get<Usage>("/me/usage"),
    dashboard: (signal?: AbortSignal) => get<Dashboard>("/me/dashboard", undefined, signal),
    realtimeModels: () => get<RealtimeModelOption[]>("/me/realtime-models"),
    preferences: () => get<Preferences>("/me/preferences"),
    updatePreferences: (body: Partial<Preferences>) => patch<Preferences>("/me/preferences", body),
  };

  const scenarios = {
    /** Active scenarios, in order. `forProfile` keeps the ones that fit the learner's level and goals. */
    list: (q: { forProfile?: boolean } = {}) => get<Scenario[]>("/scenarios", pq(q)),
    get: (id: string) => get<Scenario>(`/scenarios/${enc(id)}`),
  };

  const practice = {
    list: (q: PageQuery & { status?: string } = {}) => get<Page<PracticeSummary>>("/practice", pq(q)),
    get: (id: string, signal?: AbortSignal) => get<PracticeSession>(`/practice/${enc(id)}`, undefined, signal),
    /** Books one session of quota. 429 QUOTA_EXCEEDED, 400 SCENARIO_NOT_FOUND, 409 PROFILE_INCOMPLETE. */
    start: (body: PracticeStart = {}) => post<PracticeSession>("/practice", body),
    /** Mint a locked realtime credential (the tutor's instructions live inside it). 409 PRACTICE_ENDED, 429, 502 REALTIME_UNAVAILABLE, 503 NO_REALTIME_MODEL. */
    startLive: (id: string) => post<LiveSessionGrant>(`/practice/${enc(id)}/live`),
    endLive: (id: string, sessionId: string) => post<LiveSessionEnd>(`/practice/${enc(id)}/live/${enc(sessionId)}/end`),
    /** Hand in the transcript; the lesson report is written in the background (poll `get` until it leaves ANALYZING). */
    end: (id: string, body: PracticeEnd) => post<PracticeSession>(`/practice/${enc(id)}/end`, body),
    /** Run the lesson engine again for a FAILED session. */
    retry: (id: string) => post<PracticeSession>(`/practice/${enc(id)}/retry`),
    /** Deleting does not refund the booked session. */
    remove: (id: string) => del(`/practice/${enc(id)}`),
  };

  const vocab = {
    list: (q: PageQuery & { q?: string } = {}) => get<Page<VocabItem>>("/vocab", pq(q)),
    /** Idempotent on the phrase and language. */
    save: (body: VocabSaveInput) => post<VocabItem>("/vocab", body),
    remove: (id: string) => del(`/vocab/${enc(id)}`),
  };

  const review = {
    today: (signal?: AbortSignal) => get<ReviewToday>("/review/today", undefined, signal),
    grade: (body: ReviewGradeInput) => post<VocabItem>("/review/grade", body),
  };

  return { languages, profile, me, scenarios, practice, vocab, review };
}
