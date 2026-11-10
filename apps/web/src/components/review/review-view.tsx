"use client";

/**
 * Flashcards for the saved vocabulary. The front is the phrase in the language being
 * learned; the back is its meaning and examples; the learner grades the recall with
 * Again, Hard, Good or Easy (keys 1 to 4), and the server schedules the next review.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Volume2 } from "lucide-react";
import type { ReviewGrade, VocabItem } from "@open-language/types";
import { Button, IconButton, Skeleton, toast } from "@open-language/ui";
import { PageBar } from "@/components/app/app-shell";
import { ErrorState } from "@/components/common/states";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { isRtl } from "@/lib/language/languages";
import { REVIEW_GRADES, dueSummary, gradeForKey } from "@/lib/language/srs";
import { useReviewToday } from "@/lib/practice/queries";
import { qk } from "@/lib/query-keys";

export function ReviewView() {
  const today = useReviewToday();
  return (
    <div>
      <PageBar title="Review" />
      <div className="mx-auto max-w-[640px] px-4 pb-16 pt-4 sm:px-6 sm:pt-8">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Review</h1>
        {today.isError ? (
          <ErrorState error={today.error} onRetry={() => void today.refetch()} />
        ) : !today.data ? (
          <div className="mt-6 space-y-3" aria-busy>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <Deck key={today.dataUpdatedAt} initial={today.data.due} totalDue={today.data.totalDue} doneToday={today.data.doneToday} />
        )}
      </div>
    </div>
  );
}

function speak(text: string, lang: string) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    window.speechSynthesis?.cancel();
    window.speechSynthesis?.speak(u);
  } catch {
    /* no speech synthesis in this browser */
  }
}

function Deck({ initial, totalDue, doneToday }: { initial: VocabItem[]; totalDue: number; doneToday: number }) {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<VocabItem[]>(initial);
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState(0);
  const backRef = useRef<HTMLDivElement>(null);
  const card = queue[0];

  const grade = useMutation({
    mutationFn: (v: { item: VocabItem; grade: ReviewGrade }) => api().review.grade({ vocabId: v.item.id, grade: v.grade }),
    meta: { silent: true },
    onError: (e, v) => {
      // Put the card back at the end so nothing is lost.
      setQueue((q) => [...q, v.item]);
      setGraded((n) => Math.max(0, n - 1));
      toast.error({ title: "That grade was not saved", description: errorMessage(e) });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      void qc.invalidateQueries({ queryKey: qk.vocabAll });
    },
  });

  const answer = useCallback(
    (g: ReviewGrade) => {
      if (!card || !revealed) return;
      // Instant: the next card shows now; a failed save puts this one back.
      setQueue((q) => q.slice(1));
      setRevealed(false);
      setGraded((n) => n + 1);
      grade.mutate({ item: card, grade: g });
    },
    [card, revealed, grade],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === " " && !revealed && card && t?.tagName !== "BUTTON") {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      const g = gradeForKey(e.key);
      if (g) answer(g);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, revealed, card]);

  useEffect(() => {
    if (revealed) backRef.current?.focus();
  }, [revealed]);

  const reviewedNow = doneToday + graded;

  if (!card) {
    return (
      <div className="mt-6" data-testid="review-done">
        <p className="text-[17px] font-medium">{graded > 0 || initial.length > 0 ? "That is everything due for now." : "Nothing is due."}</p>
        <p className="mt-1 text-[14.5px] text-muted-foreground">
          {reviewedNow > 0 ? `You have reviewed ${reviewedNow} ${reviewedNow === 1 ? "card" : "cards"} today.` : "Save words and phrases from a lesson to build your deck."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/practice">Practise speaking</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/vocab">See your deck</Link>
          </Button>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, totalDue - graded);
  return (
    <div className="mt-2">
      <p className="text-[13.5px] text-subtle-foreground" aria-live="polite" data-testid="review-count">
        {dueSummary(remaining)} · {reviewedNow} reviewed today
      </p>
      <div className="mt-5 border-y border-border py-10 text-center" data-testid="review-card">
        <p className="text-balance font-display text-[34px] font-semibold leading-tight tracking-[-0.02em]" lang={card.targetLanguage} dir={isRtl(card.targetLanguage) ? "rtl" : "ltr"} data-testid="review-front">
          {card.phrase}
        </p>
        <div className="mt-2 flex justify-center">
          <IconButton label={`Hear ${card.phrase}`} onClick={() => speak(card.phrase, card.targetLanguage)}>
            <Volume2 />
          </IconButton>
        </div>
        {revealed ? (
          <div ref={backRef} tabIndex={-1} className="mt-6 outline-none" data-testid="review-back">
            <p className="text-[20px] font-medium">{card.meaningNative}</p>
            {card.examples.slice(0, 2).map((e) => (
              <p key={e} className="mt-2 text-[14.5px] text-muted-foreground" lang={card.targetLanguage}>
                {e}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {revealed ? (
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="How well did you remember it?">
          {REVIEW_GRADES.map((g) => (
            <Button key={g.grade} variant={g.grade === "good" ? "primary" : "outline"} size="lg" onClick={() => answer(g.grade)} data-testid={`grade-${g.grade}`} title={g.hint} aria-keyshortcuts={g.key}>
              {g.label}
              <span className="text-[12px] font-normal opacity-70" aria-hidden>
                {g.key}
              </span>
            </Button>
          ))}
        </div>
      ) : (
        <div className="mt-6 flex justify-center">
          <Button size="lg" onClick={() => setRevealed(true)} data-testid="show-answer" aria-keyshortcuts="Space">
            Show answer
          </Button>
        </div>
      )}
      <p className="mt-4 text-center text-[12.5px] text-subtle-foreground">Press Space to show the answer, then 1 to 4 to grade it.</p>
    </div>
  );
}
