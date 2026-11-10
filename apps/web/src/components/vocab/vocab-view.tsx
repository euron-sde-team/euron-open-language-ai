"use client";

/** The saved vocabulary: search, the stage and next review of each card, and delete. */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { VocabItem } from "@open-language/types";
import { Button, IconButton, Input, Skeleton, toast } from "@open-language/ui";
import { PageBar } from "@/components/app/app-shell";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/states";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { isRtl } from "@/lib/language/languages";
import { STAGE_LABEL, dueLabel, stageOf } from "@/lib/language/srs";
import { useVocab } from "@/lib/practice/queries";
import { qk } from "@/lib/query-keys";

export function VocabView() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 250);
  const list = useVocab(debounced.trim());
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const [removing, setRemoving] = useState<VocabItem | null>(null);

  const remove = useMutation({
    mutationFn: (v: VocabItem) => api().vocab.remove(v.id),
    meta: { silent: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.vocabAll });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      void qc.invalidateQueries({ queryKey: qk.review });
      toast.success({ title: "Removed from your deck" });
    },
    onError: (e) => toast.error({ title: errorMessage(e) }),
  });

  return (
    <div>
      <PageBar title="Vocabulary" />
      <div className="mx-auto max-w-[780px] px-4 pb-20 pt-4 sm:px-6 sm:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Vocabulary</h1>
          <Button asChild variant="outline" size="sm">
            <Link href="/review">Review now</Link>
          </Button>
        </div>
        <div className="mt-5">
          <label htmlFor="vocab-search" className="sr-only">
            Search your words
          </label>
          <Input id="vocab-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your words" className="max-w-sm" autoComplete="off" />
        </div>

        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} compact className="mt-4" />
        ) : list.isLoading ? (
          <div className="mt-4 space-y-3" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : !items.length ? (
          <p className="mt-6 text-[14.5px] text-muted-foreground" data-testid="vocab-empty">
            {debounced.trim() ? "No saved words match that." : "Your deck is empty. Finish a practice session and save words from the lesson."}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border border-y border-border" data-testid="vocab-list">
            {items.map((v) => (
              <li key={v.id} className="flex items-start gap-3 py-3.5" data-testid="vocab-row">
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-semibold" lang={v.targetLanguage} dir={isRtl(v.targetLanguage) ? "rtl" : "ltr"}>
                    {v.phrase}
                  </p>
                  <p className="text-[14px] text-muted-foreground">{v.meaningNative}</p>
                  {v.examples[0] ? (
                    <p className="mt-0.5 text-[13.5px] text-subtle-foreground" lang={v.targetLanguage}>
                      {v.examples[0]}
                    </p>
                  ) : null}
                </div>
                <p className="shrink-0 pt-0.5 text-right text-[12.5px] text-subtle-foreground">
                  {STAGE_LABEL[stageOf(v)]}
                  <br />
                  {v.mastered ? "" : dueLabel(v.nextReviewAt)}
                </p>
                <IconButton label={`Remove ${v.phrase}`} size="sm" onClick={() => setRemoving(v)}>
                  <Trash2 />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage ? (
          <div className="mt-4">
            <Button variant="ghost" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
              Load more
            </Button>
          </div>
        ) : null}
        <ConfirmDialog
          open={!!removing}
          onOpenChange={(o) => !o && setRemoving(null)}
          title="Remove this word?"
          description={removing ? `"${removing.phrase}" leaves your deck and its review schedule is erased.` : undefined}
          confirmLabel="Remove"
          destructive
          onConfirm={() => {
            const v = removing!;
            setRemoving(null);
            remove.mutate(v);
          }}
        />
      </div>
    </div>
  );
}
