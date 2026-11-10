/** Every React Query key in one place, so cache surgery (optimistic updates, invalidation) finds them. */
type F = Record<string, unknown>;

export const qk = {
  me: ["me"] as const,
  meta: ["meta"] as const,
  sessions: ["sessions"] as const,

  usage: ["usage"] as const,
  preferences: ["preferences"] as const,
  realtimeModels: ["realtime-models"] as const,
  languages: ["languages"] as const,
  profile: ["profile"] as const,
  dashboard: ["dashboard"] as const,
  scenarios: (f: F = {}) => ["scenarios", f] as const,
  practiceList: (f: F = {}) => ["practice", "list", f] as const,
  practiceAll: ["practice"] as const,
  practice: (id: string) => ["practice", "one", id] as const,
  vocab: (f: F = {}) => ["vocab", f] as const,
  vocabAll: ["vocab"] as const,
  review: ["review"] as const,

  // Admin
  admin: {
    session: ["admin", "session"] as const,
    all: ["admin"] as const,
    list: (area: string, f?: F) => ["admin", area, "list", f ?? {}] as const,
    detail: (area: string, id: string) => ["admin", area, "detail", id] as const,
    area: (area: string) => ["admin", area] as const,
  },
};
