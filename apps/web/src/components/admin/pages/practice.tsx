"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { flattenPages, nextCursor } from "@open-language/api-client";
import { Button } from "@open-language/ui";
import type { AdminPracticeRow, PracticeStatus } from "@open-language/types";
import { api } from "@/lib/api";
import { ENGINE_LABEL, PRACTICE_STATUS_LABEL, PRACTICE_STATUS_TONE, formatMinutes, scoreLabel, shortDate } from "@/lib/admin";
import { useLanguages } from "@/lib/practice/queries";
import { languageName } from "@/lib/language/languages";
import { AdminPage, DataTable, FilterBar, StatusText, useUrlState, type Column } from "../shell";
import { ak, PersonAvatar } from "./common";

const STATUS_TABS: { value: "all" | PracticeStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "COMPLETED", label: "Completed" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "ANALYZING", label: "Analyzing" },
  { value: "FAILED", label: "Failed" },
];

const isStatus = (v: string): v is PracticeStatus => STATUS_TABS.some((t) => t.value === v && v !== "all");

/** Every practice session on the deployment, as metadata only. Transcripts and lessons stay with their owner. */
export function AdminPractice() {
  const url = useUrlState();
  const q = url.get("q");
  const statusParam = url.get("status");
  const status = isStatus(statusParam) ? statusParam : undefined;
  const userId = url.get("user") || undefined;
  const setUrl = url.set;
  const f = { q, status, userId };
  const languages = useLanguages();

  const list = useInfiniteQuery({
    queryKey: ak.practice(f),
    queryFn: ({ pageParam }) => api().admin.practice({ q: q || undefined, status, userId, cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    placeholderData: (p) => p,
  });
  const rows = flattenPages(list.data?.pages);

  const columns = useMemo<Column<AdminPracticeRow>[]>(
    () => [
      {
        key: "title",
        header: "Session",
        cell: (r) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{r.title || "Untitled"}</p>
            <p className="truncate text-[12.5px] text-muted-foreground">
              {languageName(r.targetLanguage, languages.data)} · {r.level}
            </p>
          </div>
        ),
        className: "max-w-[220px] sm:max-w-[320px]",
      },
      {
        key: "owner",
        header: "Owner",
        cell: (r) => (
          <button
            type="button"
            onClick={() => setUrl({ user: r.owner.id })}
            className="flex min-w-0 items-center gap-2 rounded-md text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={`Show only ${r.owner.displayName}'s sessions`}
          >
            <PersonAvatar user={r.owner} size="xs" />
            <span className="truncate text-muted-foreground">{r.owner.displayName}</span>
          </button>
        ),
        hideBelow: "md",
      },
      { key: "status", header: "Status", cell: (r) => <StatusText tone={PRACTICE_STATUS_TONE[r.status]}>{PRACTICE_STATUS_LABEL[r.status]}</StatusText> },
      { key: "engine", header: "Lesson by", cell: (r) => <span className="text-muted-foreground">{r.engine ? ENGINE_LABEL[r.engine] : ""}</span>, hideBelow: "lg" },
      {
        key: "score",
        header: "Score",
        align: "right",
        cell: (r) => (r.overallScore === null ? <span className="text-subtle-foreground">{scoreLabel(null)}</span> : <span className="font-medium text-foreground">{scoreLabel(r.overallScore)}</span>),
        sortValue: (r) => r.overallScore,
      },
      { key: "voice", header: "Voice", align: "right", cell: (r) => formatMinutes(r.voiceMinutes), sortValue: (r) => r.voiceMinutes, hideBelow: "md" },
      { key: "created", header: "Started", align: "right", cell: (r) => <span className="text-muted-foreground">{shortDate(r.createdAt)}</span>, sortValue: (r) => r.createdAt, hideBelow: "lg" },
    ],
    [setUrl, languages.data],
  );

  const ownerName = userId ? rows.find((r) => r.owner.id === userId)?.owner.displayName : undefined;
  const filtered = !!(q || status || userId);

  return (
    <AdminPage
      title="Practice"
      description="Every practice session on this deployment. Titles, status and scores only: transcripts and lessons stay private to their owner."
      filters={
        <>
          <FilterBar
            tabs={STATUS_TABS}
            tab={status ?? "all"}
            onTabChange={(v) => url.set({ status: v === "all" ? null : v })}
            tabsLabel="Status"
            search={q}
            onSearchChange={(v) => url.set({ q: v.trim() })}
            searchPlaceholder="Search titles"
            testId="practice-filter"
          />
          {userId ? (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[13.5px] text-muted-foreground" data-testid="practice-owner-filter">
              Showing sessions by {ownerName ?? "one account"}.
              <Button variant="link" size="sm" className="h-auto p-0 text-[13.5px]" onClick={() => url.set({ user: null })}>
                Show everyone
              </Button>
            </p>
          ) : null}
        </>
      }
      testId="admin-practice"
    >
      <DataTable
        caption="Practice sessions"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        hasMore={!!list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => void list.fetchNextPage()}
        empty={{ title: filtered ? "No sessions match these filters." : "No practice sessions yet." }}
        rowTestId={(r) => `practice-row-${r.id}`}
        testId="practice-table"
      />
    </AdminPage>
  );
}
