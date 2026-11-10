"use client";

import Link from "next/link";
import { PageBar } from "@/components/app/app-shell";
import { StatLine } from "@/components/admin/shell/stat-line";
import { ErrorState } from "@/components/common/states";
import { PracticeRows } from "@/components/practice/practice-rows";
import { masteredPercent } from "@/lib/language/srs";
import { goalProgress, trendDelta } from "@/lib/language/progress";
import { useDashboard, useLanguages } from "@/lib/practice/queries";
import { ActivityStrip, ScoreTrend, WeakSpots } from "./charts";

export function ProgressView() {
  const dash = useDashboard();
  const languages = useLanguages();
  const d = dash.data;
  const delta = d ? trendDelta(d.scoreTrend) : null;
  return (
    <div>
      <PageBar title="Progress" />
      <div className="mx-auto max-w-[780px] px-4 pb-20 pt-4 sm:px-6 sm:pt-8">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Progress</h1>
        {dash.isError ? (
          <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />
        ) : (
          <>
            <StatLine
              className="mt-6"
              loading={!d}
              testId="progress-stats"
              items={[
                { label: "Day streak", value: d?.streakDays ?? 0, testId: "stat-streak" },
                { label: "Today", value: d ? `${d.minutesToday} min` : "0 min", hint: d ? `${Math.round(goalProgress(d.minutesToday, d.profile.dailyMinutesTarget) * 100)}% of goal` : undefined },
                { label: "This week", value: d ? `${d.minutesThisWeek} min` : "0 min" },
                { label: "Sessions", value: d?.totalSessions ?? 0 },
                { label: "Minutes", value: d?.totalMinutes ?? 0 },
                { label: "Words kept", value: d?.vocabTotal ?? 0, hint: d ? `${masteredPercent(d.vocabTotal, d.vocabMastered)}% mastered` : undefined },
              ]}
            />

            <section className="mt-12" aria-labelledby="act">
              <h2 id="act" className="font-display text-[19px] font-semibold tracking-[-0.01em]">Last 28 days</h2>
              <p className="mb-3 mt-1 text-[13.5px] text-muted-foreground">Darker means more minutes spoken that day.</p>
              {d ? <ActivityStrip days={d.activity} /> : null}
            </section>

            <section className="mt-12" aria-labelledby="trend">
              <h2 id="trend" className="font-display text-[19px] font-semibold tracking-[-0.01em]">Score trend</h2>
              <p className="mb-3 mt-1 text-[13.5px] text-muted-foreground">
                {delta === null ? "Overall lesson score, out of 10. A trend appears after four sessions." : delta >= 0 ? `Up ${delta} points since you started.` : `Down ${Math.abs(delta)} points since you started.`}
              </p>
              {d ? d.scoreTrend.length ? <ScoreTrend points={d.scoreTrend} /> : <p className="text-[14px] text-subtle-foreground">Finish a session to see your scores here.</p> : null}
            </section>

            <section className="mt-12" aria-labelledby="weak">
              <h2 id="weak" className="font-display text-[19px] font-semibold tracking-[-0.01em]">Weak spots</h2>
              <p className="mb-3 mt-1 text-[13.5px] text-muted-foreground">What your tutor corrected most in the last 30 days.</p>
              {d ? d.weakSpots.length ? <WeakSpots items={d.weakSpots} /> : <p className="text-[14px] text-subtle-foreground">No corrections yet. They show up after your first lesson.</p> : null}
            </section>

            <section className="mt-12" aria-labelledby="recent">
              <h2 id="recent" className="font-display text-[19px] font-semibold tracking-[-0.01em]">Recent sessions</h2>
              <PracticeRows items={d?.recent ?? []} languages={languages.data} loading={!d} empty="Nothing yet." />
              {d && d.reviewDue > 0 ? (
                <p className="mt-6 text-[14.5px]">
                  <Link href="/review" className="text-link underline underline-offset-4">
                    {d.reviewDue} {d.reviewDue === 1 ? "card is" : "cards are"} due for review
                  </Link>
                </p>
              ) : null}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
