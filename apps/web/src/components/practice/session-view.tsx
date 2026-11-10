"use client";

/**
 * One practice session. In progress: a way back into the room. Analyzing: the lesson is
 * being written (polled every 1.5 s). Failed: retry. Completed: the lesson report.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Skeleton, toast } from "@open-language/ui";
import { PageBar } from "@/components/app/app-shell";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/states";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { statusWord } from "@/lib/language/format";
import { usePractice } from "@/lib/practice/queries";
import { qk } from "@/lib/query-keys";
import { LessonReport } from "./lesson-report";

export function SessionView({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: s, error, refetch } = usePractice(id);
  const [deleting, setDeleting] = useState(false);

  const retry = useMutation({
    mutationFn: () => api().practice.retry(id),
    meta: { silent: true },
    onSuccess: (next) => {
      qc.setQueryData(qk.practice(id), next);
      void qc.invalidateQueries({ queryKey: qk.practiceAll });
    },
    onError: (e) => toast.error({ title: errorMessage(e) }),
  });

  const remove = async () => {
    try {
      await api().practice.remove(id);
      qc.removeQueries({ queryKey: qk.practice(id) });
      void qc.invalidateQueries({ queryKey: qk.practiceAll });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      toast.success({ title: "Session deleted" });
      router.push("/practice");
    } catch (e) {
      toast.error({ title: errorMessage(e) });
    }
  };

  return (
    <div>
      <PageBar title={s?.title} />
      <div className="mx-auto max-w-[780px] px-4 pb-20 pt-4 sm:px-6 sm:pt-8">
        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !s ? (
          <div className="space-y-4" aria-busy>
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-6 h-24 w-full" />
          </div>
        ) : (
          <>
            {s.status === "COMPLETED" ? (
              <LessonReport session={s} />
            ) : (
              <div data-testid={`session-${s.status.toLowerCase()}`}>
                <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">{s.title}</h1>
                <p className="mt-1.5 text-[15px] text-muted-foreground" role="status" aria-live="polite">
                  {statusWord(s.status)}
                </p>
                {s.status === "ANALYZING" ? (
                  <div className="mt-6 space-y-3" aria-busy>
                    <p className="text-[15px] text-muted-foreground">Your tutor is reading the conversation and writing your lesson. This usually takes a few seconds.</p>
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-2/3" />
                    {s.endedAt && Date.now() - new Date(s.endedAt).getTime() > 5 * 60_000 ? (
                      <div className="pt-2">
                        <p className="text-[15px] text-muted-foreground">This is taking longer than it should.</p>
                        <Button className="mt-3" loading={retry.isPending} onClick={() => retry.mutate()} data-testid="retry-lesson">
                          Try again
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {s.status === "IN_PROGRESS" ? (
                  <div className="mt-6">
                    <p className="text-[15px] text-muted-foreground">This conversation is still open. Pick it up where you left off, or end it from inside the room to get your lesson.</p>
                    <Button asChild size="lg" className="mt-5" data-testid="continue-session">
                      <Link href={`/room/${s.id}`}>Continue</Link>
                    </Button>
                  </div>
                ) : null}
                {s.status === "FAILED" ? (
                  <div className="mt-6 border-l-2 border-danger pl-3" role="alert">
                    <p className="text-[15px]">{s.error ?? "The lesson could not be written."}</p>
                    <Button className="mt-3" loading={retry.isPending} onClick={() => retry.mutate()} data-testid="retry-lesson">
                      Try again
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
            {s.status !== "ANALYZING" ? (
              <div className="mt-12 border-t border-border pt-5">
                <Button variant="danger-ghost" size="sm" onClick={() => setDeleting(true)} data-testid="delete-session">
                  Delete this session
                </Button>
              </div>
            ) : null}
            <ConfirmDialog
              open={deleting}
              onOpenChange={setDeleting}
              title="Delete this session?"
              description="The conversation, the lesson and its corrections are erased. Words you saved to your deck stay. The session still counts against this month's allowance."
              confirmLabel="Delete"
              destructive
              onConfirm={remove}
            />
          </>
        )}
      </div>
    </div>
  );
}
