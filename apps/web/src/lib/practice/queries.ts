"use client";

/** Reads for the learner profile, scenarios, practice sessions, vocabulary, review and progress. */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { PracticeSession } from "@open-language/types";
import { api } from "../api";
import { qk } from "../query-keys";

export function useUsage() {
  return useQuery({ queryKey: qk.usage, queryFn: () => api().me.usage(), staleTime: 15_000, meta: { silent: true } });
}

export function usePreferences() {
  return useQuery({ queryKey: qk.preferences, queryFn: () => api().me.preferences(), staleTime: 60_000 });
}

export function useRealtimeModels() {
  return useQuery({ queryKey: qk.realtimeModels, queryFn: () => api().me.realtimeModels(), staleTime: 60_000 });
}

/** Every language the tutor knows; public and effectively static. */
export function useLanguages() {
  return useQuery({ queryKey: qk.languages, queryFn: ({ signal }) => api().languages.list(signal), staleTime: Infinity, meta: { silent: true } });
}

export function useProfile() {
  return useQuery({ queryKey: qk.profile, queryFn: ({ signal }) => api().profile.get(signal), staleTime: 30_000 });
}

export function useDashboard() {
  return useQuery({ queryKey: qk.dashboard, queryFn: ({ signal }) => api().me.dashboard(signal), staleTime: 15_000 });
}

export function useScenarios(forProfile = true) {
  return useQuery({ queryKey: qk.scenarios({ forProfile }), queryFn: () => api().scenarios.list({ forProfile }), staleTime: 60_000 });
}

/** Your practice sessions, newest first, paged by cursor. */
export function usePracticeList(filter: { status?: string } = {}, limit = 30) {
  return useInfiniteQuery({
    queryKey: qk.practiceList({ ...filter, limit }),
    queryFn: ({ pageParam }) => api().practice.list({ ...filter, cursor: pageParam, limit }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 10_000,
  });
}

/** True while the lesson engine is still writing the report. */
export function analyzing(s: PracticeSession | undefined): boolean {
  return !!s && s.status === "ANALYZING";
}

/** One session. Polls every 1.5 s while the lesson is being written. */
export function usePractice(id: string) {
  return useQuery({
    queryKey: qk.practice(id),
    queryFn: ({ signal }) => api().practice.get(id, signal),
    refetchInterval: (q) => (analyzing(q.state.data) ? 1500 : false),
    staleTime: 5_000,
  });
}

export function useVocab(q = "") {
  return useInfiniteQuery({
    queryKey: qk.vocab({ q }),
    queryFn: ({ pageParam }) => api().vocab.list({ q: q || undefined, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 10_000,
    placeholderData: (p) => p,
  });
}

export function useReviewToday() {
  return useQuery({ queryKey: qk.review, queryFn: ({ signal }) => api().review.today(signal), staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false });
}

/** Group sessions under Today, Yesterday, Previous 7 days, Previous 30 days, then months. */
export function groupByDate<T extends { startedAt: string }>(items: T[], now = new Date()): { label: string; items: T[] }[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const groups = new Map<string, T[]>();
  for (const c of items) {
    const t = new Date(c.startedAt).getTime();
    let label: string;
    if (t >= startOfToday) label = "Today";
    else if (t >= startOfToday - day) label = "Yesterday";
    else if (t >= startOfToday - 7 * day) label = "Previous 7 days";
    else if (t >= startOfToday - 30 * day) label = "Previous 30 days";
    else label = new Date(t).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    groups.set(label, [...(groups.get(label) ?? []), c]);
  }
  return [...groups.entries()].map(([label, list]) => ({ label, items: list }));
}
