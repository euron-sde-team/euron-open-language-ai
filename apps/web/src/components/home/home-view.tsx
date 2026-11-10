"use client";

/**
 * Home: one greeting, today's goal and streak as type, the next thing to do (review what
 * is due, then practise) as plain rows, this month's allowance when a limit is set, and
 * the most recent sessions.
 */
import Link from "next/link";
import { ArrowRight, Layers, Mic } from "lucide-react";
import { PageBar } from "@/components/app/app-shell";
import { StatLine } from "@/components/admin/shell/stat-line";
import { PracticeRows } from "@/components/practice/practice-rows";
import { useAuth } from "@/lib/auth";
import { dueSummary } from "@/lib/language/srs";
import { languageName, levelLabel } from "@/lib/language/languages";
import { goalProgress } from "@/lib/language/progress";
import { useMemo } from "react";
import { useAppMeta } from "@/lib/meta";
import { useDashboard, useLanguages, usePracticeList, useUsage } from "@/lib/practice/queries";

export function HomeView() {
  const { user } = useAuth();
  const { data: meta } = useAppMeta();
  const usage = useUsage();
  const dash = useDashboard();
  const languages = useLanguages();
  const list = usePracticeList({}, 8);
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const first = user?.displayName?.split(" ")[0];
  const tutor = meta?.tutorName ?? "Lingua";
  const d = dash.data;
  const goal = d ? Math.round(goalProgress(d.minutesToday, d.profile.dailyMinutesTarget) * 100) : 0;

  const starts = [
    { href: "/practice", icon: Mic, title: "Practise speaking", text: `${tutor} plays the other person in a real situation and corrects you afterwards.`, testId: "start-practice" },
    d && d.reviewDue > 0 ? { href: "/review", icon: Layers, title: `Review ${dueSummary(d.reviewDue).toLowerCase()}`, text: "A few minutes with the words and phrases you saved.", testId: "start-review" } : null,
  ].filter(Boolean) as { href: string; icon: typeof Mic; title: string; text: string; testId: string }[];

  return (
    <div>
      <PageBar />
      <div className="mx-auto max-w-[780px] px-4 pb-16 pt-6 sm:px-6 sm:pt-12">
        <h1 className="font-display text-[30px] font-semibold leading-tight tracking-[-0.02em] sm:text-[36px]">{first ? `Ready when you are, ${first}.` : "Ready when you are."}</h1>
        <p className="mt-2 max-w-[560px] text-[15.5px] leading-relaxed text-muted-foreground">
          {d ? `${languageName(d.profile.targetLanguage, languages.data)} at ${levelLabel(d.profile.level)}. ` : ""}
          Talk it out loud with {tutor}, then see what to fix.
        </p>

        <StatLine
          className="mt-8"
          loading={dash.isLoading}
          testId="home-stats"
          items={[
            { label: "Day streak", value: d?.streakDays ?? 0 },
            { label: "Today", value: d ? `${d.minutesToday} min` : "0 min", hint: d ? `${goal}% of ${d.profile.dailyMinutesTarget}` : undefined },
            { label: "This week", value: d ? `${d.minutesThisWeek} min` : "0 min" },
          ]}
        />

        <div className="mt-8 divide-y divide-border border-y border-border">
          {starts.map((s) => (
            <Link key={s.href} href={s.href} data-testid={s.testId} className="group flex items-center gap-4 py-4 hover:bg-muted/40 sm:px-2">
              <s.icon className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] font-semibold">{s.title}</span>
                <span className="block text-[13.5px] text-muted-foreground">{s.text}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          ))}
        </div>
        {usage.data && (usage.data.sessions.limit !== null || usage.data.voiceMinutes.limit !== null) ? (
          <p className="mt-3 text-[13px] text-subtle-foreground">
            This month you have used {usage.data.sessions.used}
            {usage.data.sessions.limit !== null ? ` of ${usage.data.sessions.limit}` : ""} practice sessions and {usage.data.voiceMinutes.used}
            {usage.data.voiceMinutes.limit !== null ? ` of ${usage.data.voiceMinutes.limit}` : ""} minutes of live voice.
          </p>
        ) : null}

        <h2 className="mt-12 font-display text-[19px] font-semibold tracking-[-0.01em]">Recent sessions</h2>
        <PracticeRows items={items} languages={languages.data} loading={list.isLoading} empty="Nothing yet. Your first conversation takes about ten minutes." />
      </div>
    </div>
  );
}
