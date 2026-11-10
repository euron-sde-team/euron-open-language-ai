"use client";

/**
 * Choose what to practise: a free conversation, or a role-play scenario that fits the
 * learner's level and goals (or every scenario). Starting books one session of this
 * month's allowance and opens the room.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@open-language/ui";
import { PageBar } from "@/components/app/app-shell";
import { ErrorState } from "@/components/common/states";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { languageName, levelLabel } from "@/lib/language/languages";
import { useAppMeta } from "@/lib/meta";
import { useLanguages, useProfile, useScenarios, useUsage } from "@/lib/practice/queries";
import { qk } from "@/lib/query-keys";
import { ScenarioRows } from "./scenario-rows";

type Filter = "fit" | "all";

export function PracticePicker() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: meta } = useAppMeta();
  const profile = useProfile();
  const languages = useLanguages();
  const usage = useUsage();
  const [filter, setFilter] = useState<Filter>("fit");
  const scenarios = useScenarios(filter === "fit");
  const [starting, setStarting] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: (scenarioId: string | null) => api().practice.start(scenarioId ? { scenarioId } : {}),
    meta: { silent: true },
    onSuccess: (s) => {
      qc.setQueryData(qk.practice(s.id), s);
      void qc.invalidateQueries({ queryKey: qk.practiceAll });
      void qc.invalidateQueries({ queryKey: qk.usage });
      router.push(`/room/${s.id}`);
    },
    onError: (e) => {
      setStarting(null);
      toast.error({ title: "Could not start", description: errorMessage(e) });
    },
  });

  const p = profile.data;
  const u = usage.data;
  const left = u && u.sessions.limit !== null ? Math.max(0, u.sessions.limit - u.sessions.used) : null;

  return (
    <div>
      <PageBar title="Practice" />
      <div className="mx-auto max-w-[780px] px-4 pb-16 pt-4 sm:px-6 sm:pt-8">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">What do you want to practise?</h1>
        {p ? (
          <p className="mt-1.5 text-[15px] text-muted-foreground">
            {languageName(p.targetLanguage, languages.data)} at {levelLabel(p.level)}, from {languageName(p.nativeLanguage, languages.data)}.{" "}
            <Link href="/settings" className="text-link underline underline-offset-4">
              Change
            </Link>
          </p>
        ) : null}
        {left !== null ? (
          <p className="mt-1 text-[13px] text-subtle-foreground" data-testid="sessions-left">
            {left === 0 ? "You have used all of this month's practice sessions." : `${left} ${left === 1 ? "session" : "sessions"} left this month.`}
          </p>
        ) : null}

        <UnderlineTabs
          className="mt-6"
          label="Which scenarios"
          tabs={[
            { value: "fit" as const, label: "Fit for you" },
            { value: "all" as const, label: "All scenarios" },
          ]}
          value={filter}
          onChange={setFilter}
        />

        <div className="mt-4">
          {scenarios.isError ? (
            <ErrorState error={scenarios.error} onRetry={() => void scenarios.refetch()} compact />
          ) : (
            <ScenarioRows
              items={scenarios.data ?? []}
              loading={scenarios.isLoading}
              starting={starting}
              freeConversation={meta?.features.freeConversation !== false}
              onStart={(id) => {
                setStarting(id ?? "free");
                start.mutate(id);
              }}
            />
          )}
          {!scenarios.isLoading && !scenarios.isError && !(scenarios.data ?? []).length && filter === "fit" ? (
            <p className="mt-3 text-[14px] text-subtle-foreground">
              Nothing matches your level and goals right now.{" "}
              <button type="button" className="text-link underline underline-offset-4" onClick={() => setFilter("all")}>
                Show all scenarios
              </button>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
