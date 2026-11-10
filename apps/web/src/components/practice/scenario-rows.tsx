"use client";

import { ArrowRight, MessagesSquare } from "lucide-react";
import type { Scenario } from "@open-language/types";
import { Skeleton } from "@open-language/ui";
import { GOAL_LABEL } from "@/lib/language/languages";

/** "A2 to B2" or just "B1" when the scenario fits one level. */
export function levelRange(s: Pick<Scenario, "levelMin" | "levelMax">): string {
  return s.levelMin === s.levelMax ? s.levelMin : `${s.levelMin} to ${s.levelMax}`;
}

/** Scenarios as hairline rows: title, one-line description, then level and goals as meta text. The whole row starts the conversation. */
export function ScenarioRows({ items, loading, starting, onStart, freeConversation }: { items: Scenario[]; loading?: boolean; starting: string | null; onStart: (scenarioId: string | null) => void; freeConversation: boolean }) {
  if (loading)
    return (
      <div className="divide-y divide-border border-y border-border" aria-busy>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="space-y-2 py-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        ))}
      </div>
    );
  return (
    <ul className="divide-y divide-border border-y border-border" data-testid="scenario-list">
      {freeConversation ? (
        <li>
          <button
            type="button"
            data-testid="scenario-free"
            disabled={starting !== null}
            onClick={() => onStart(null)}
            className="group flex w-full items-center gap-4 py-4 text-left hover:bg-muted/40 focus-visible:rounded-sm disabled:opacity-60 sm:px-2"
          >
            <MessagesSquare className="size-5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-[15.5px] font-semibold">{starting === "free" ? "Starting" : "Talk about anything"}</span>
              <span className="block text-[13.5px] text-muted-foreground">No script. Your tutor asks what you would like to practise and follows you.</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
        </li>
      ) : null}
      {items.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            data-testid="scenario-row"
            disabled={starting !== null}
            onClick={() => onStart(s.id)}
            className="group flex w-full items-center gap-4 py-4 text-left hover:bg-muted/40 focus-visible:rounded-sm disabled:opacity-60 sm:px-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[15.5px] font-semibold">{s.title}</span>
              <span className="block text-[13.5px] text-muted-foreground">{s.description}</span>
              <span className="mt-0.5 block text-[12.5px] text-subtle-foreground">{[levelRange(s), s.goals.map((g) => GOAL_LABEL[g]).join(", ")].filter(Boolean).join(" · ")}</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
