/** The /admin control plane. Re-exported from index.ts. */
import type { UserRole, UserStatus, UserSummary } from "./index";
import type { Goal, Level, PracticeStatus, RealtimeProvider } from "./language";

export type ProviderKind = "OPENAI" | "ANTHROPIC" | "GEMINI" | "OPENAI_COMPATIBLE" | "STUB";
export type ModelKind = "TEXT" | "REALTIME";

/** GET /api/admin/me. */
export interface AdminSession {
  role: UserRole;
}

// ─── Overview ───────────────────────────────────────────────────────────────

/** GET /api/admin/stats?from=&to=: the overview, UTC days. */
export interface AdminStats {
  from: string;
  to: string;
  totals: { users: number; newUsers: number; activeUsers: number; sessions: number; completedSessions: number; voiceMinutes: number; estimatedCostUsd: number };
  daily: { date: string; activeUsers: number; sessions: number; voiceMinutes: number }[];
  byModel: { modelId: string; displayName: string; kind: ModelKind; calls: number; inputTokens: number; outputTokens: number; voiceMinutes: number; estimatedCostUsd: number }[];
  /** Mean overall lesson score of sessions completed in the range; null when none. */
  averageScore: number | null;
}

// ─── Users ──────────────────────────────────────────────────────────────────

export interface AdminUserRow extends UserSummary {
  email: string;
  status: UserStatus;
  quotaTier: { id: string; name: string } | null;
  createdAt: string;
  lastSeenAt: string | null;
  suspendedUntil: string | null;
  /** This calendar month (UTC). */
  sessionsThisMonth: number;
  voiceMinutesThisMonth: number;
}

export interface AdminUserDetail extends AdminUserRow {
  override: QuotaOverride | null;
  totals: { sessions: number; completedSessions: number; voiceMinutes: number };
  /** The last 30 UTC days. */
  usage: { date: string; sessions: number; voiceMinutes: number }[];
}

export interface QuotaOverride {
  monthlySessions: number | null;
  monthlyVoiceMinutes: number | null;
  note: string | null;
  updatedAt: string;
}

export interface QuotaTier {
  id: string;
  name: string;
  /** Null means unlimited. */
  monthlySessions: number | null;
  monthlyVoiceMinutes: number | null;
  maxSessionMinutes: number;
  isDefault: boolean;
  userCount: number;
}

// ─── Providers and models ───────────────────────────────────────────────────

export interface AdminProvider {
  id: string;
  kind: ProviderKind;
  displayName: string;
  baseUrl: string | null;
  enabled: boolean;
  /** Whether a key for this provider is configured on the server. Never the key itself. */
  keyConfigured: boolean;
  modelCount: number;
}

export interface AdminModel {
  id: string;
  providerId: string;
  kind: ModelKind;
  modelRef: string;
  displayName: string;
  description: string;
  maxOutputTokens: number;
  /** REALTIME only: voices offered, the first being the default. */
  voices: string[];
  inputUsdPerMtok: number | null;
  outputUsdPerMtok: number | null;
  /** REALTIME only: price of one minute of live voice, for the cost estimate. */
  usdPerMinute: number | null;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
}

/** POST /api/admin/models/:id/test: one tiny call through the real provider. */
export interface ModelTestResult {
  ok: boolean;
  latencyMs: number;
  /** A short, key-free description of what happened. */
  message: string;
}

// ─── Settings ───────────────────────────────────────────────────────────────

export interface AppSettings {
  appName: string;
  tagline: string;
  registration: "OPEN" | "INVITE_ONLY" | "CLOSED";
  /** Email domains allowed to sign up when registration is INVITE_ONLY (["example.com"]). */
  allowedEmailDomains: string[];
  supportEmail: string | null;
  /** The tutor's name in the room and in its instructions. */
  tutorName: string;
  /** House rules added to every tutor instruction (tone, language, things to avoid). */
  tutorAddendum: string;
  features: { freeConversation: boolean };
  /** Delete practice sessions older than this many days; null keeps them forever. */
  retentionDays: number | null;
  minSupportedVersion: string | null;
}

/** What this deployment has configured. Never a key. */
export interface IntegrationStatus {
  mail: { mode: "outbox" | "smtp" | "ses" };
  /** Which realtime providers have a key and at least one enabled model. */
  realtime: Record<RealtimeProvider, { keyConfigured: boolean; models: number }>;
  textModels: number;
}

/** GET /api/admin/practice: metadata only. Transcripts stay private. */
export interface AdminPracticeRow {
  id: string;
  title: string;
  status: PracticeStatus;
  owner: UserSummary;
  targetLanguage: string;
  level: Level;
  /** "llm" or "offline": which lesson engine wrote the report; null before COMPLETED. */
  engine: "llm" | "offline" | null;
  overallScore: number | null;
  voiceMinutes: number;
  createdAt: string;
}

export type { Goal };

// ─── Audit ──────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  actor: UserSummary | null;
  action: string;
  entityType: string;
  entityId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}
