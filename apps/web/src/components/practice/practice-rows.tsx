"use client";

import Link from "next/link";
import type { LanguageOption, PracticeSummary } from "@open-language/types";
import { cn } from "@open-language/ui";
import { minutesText, scoreText, scoreTone, statusWord } from "@/lib/language/format";
import { languageName } from "@/lib/language/languages";
import { relativeTime } from "@/lib/time";

/** Practice sessions as hairline rows: title, language and level, when, how long, and the score as a number. */
export function PracticeRows({ items, languages, loading, empty }: { items: PracticeSummary[]; languages?: readonly LanguageOption[]; loading?: boolean; empty: string }) {
  if (loading)
    return (
      <div className="mt-3 divide-y divide-border">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 py-4">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="ml-auto h-4 w-10 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  if (!items.length) return <p className="mt-3 text-[14px] text-subtle-foreground">{empty}</p>;
  return (
    <ul className="mt-3 divide-y divide-border" data-testid="practice-rows">
      {items.map((s) => (
        <li key={s.id}>
          <Link href={`/practice/${s.id}`} className="flex items-center gap-4 py-3.5 hover:bg-muted/40 sm:px-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{s.title}</span>
              <span className="block truncate text-[13px] text-subtle-foreground">
                {[languageName(s.targetLanguage, languages), s.level, relativeTime(s.startedAt), s.durationSec ? minutesText(s.durationSec) : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="shrink-0 text-right">
              {s.overallScore !== null ? (
                <span className={cn("font-display text-[22px] font-semibold tabular-nums", scoreTone(s.overallScore))}>
                  {scoreText(s.overallScore)}
                  <span className="sr-only"> out of 10</span>
                </span>
              ) : (
                <span className="text-[13px] text-subtle-foreground">{statusWord(s.status, true)}</span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
