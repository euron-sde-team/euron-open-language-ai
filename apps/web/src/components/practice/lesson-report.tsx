"use client";

/**
 * The lesson report: a summary, four scores, corrections, five drills to self-check,
 * vocabulary worth keeping (Save to deck) and the transcript. Feedback is prose and rows
 * on the page ground, not cards.
 */
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Volume2 } from "lucide-react";
import type { Correction, Drill, LessonScores, PracticeSession, VocabSuggestion } from "@open-language/types";
import { Button, cn, toast } from "@open-language/ui";
import { StatLine } from "@/components/admin/shell/stat-line";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { CORRECTION_LABEL, DRILL_LABEL, SCORE_LABEL, minutesText, scoreText, scoreTone, scoreWord } from "@/lib/language/format";
import { isRtl, languageName } from "@/lib/language/languages";
import { splitTutorLine } from "@/lib/language/transcript";
import { useLanguages } from "@/lib/practice/queries";
import { qk } from "@/lib/query-keys";
import { fullTimestamp } from "@/lib/time";

export function LessonReport({ session: s }: { session: PracticeSession }) {
  const languages = useLanguages();
  const target = languageName(s.targetLanguage, languages.data);
  const meta = [target, s.level, s.durationSec ? minutesText(s.durationSec) : null, fullTimestamp(s.startedAt)].filter(Boolean).join(" · ");
  return (
    <article data-testid="lesson-report">
      <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">{s.title}</h1>
      <p className="mt-1.5 text-[13.5px] text-subtle-foreground">{meta}</p>

      <div className="mt-8 flex flex-wrap items-end gap-x-8 gap-y-2">
        <div>
          <p className={cn("font-display text-[56px] font-semibold leading-none tracking-[-0.03em] tabular-nums", scoreTone(s.overallScore))} data-testid="overall-score">
            {scoreText(s.overallScore)}
            <span className="sr-only"> out of 10</span>
          </p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">Overall, {scoreWord(s.overallScore).toLowerCase()}</p>
        </div>
        {s.scores ? <Scores scores={s.scores} /> : null}
      </div>

      {s.summary ? (
        <section className="mt-10" aria-labelledby="sum">
          <h2 id="sum" className="font-display text-[19px] font-semibold tracking-[-0.01em]">How it went</h2>
          <p className="mt-2 whitespace-pre-line text-[15.5px] leading-[1.7]" data-testid="lesson-summary">
            {s.summary}
          </p>
        </section>
      ) : null}

      <Corrections items={s.corrections} target={s.targetLanguage} />
      <Drills items={s.drills} target={s.targetLanguage} />
      <Vocabulary items={s.vocab} sessionId={s.id} target={s.targetLanguage} />
      <Transcript session={s} />

      <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <Button asChild size="lg">
          <Link href="/practice">
            Practise again <ArrowRight />
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/review">Review your deck</Link>
        </Button>
      </div>
    </article>
  );
}

function Scores({ scores }: { scores: LessonScores }) {
  return (
    <StatLine
      testId="lesson-scores"
      items={(Object.keys(SCORE_LABEL) as (keyof LessonScores)[]).map((k) => ({
        label: SCORE_LABEL[k],
        value: (
          <span className={scoreTone(scores[k])}>
            {scoreText(scores[k])}
            <span className="sr-only"> out of 10</span>
          </span>
        ),
        testId: `score-${k}`,
      }))}
    />
  );
}

function Corrections({ items, target }: { items: Correction[]; target: string }) {
  return (
    <section className="mt-12" aria-labelledby="corr">
      <h2 id="corr" className="font-display text-[19px] font-semibold tracking-[-0.01em]">Corrections</h2>
      {!items.length ? (
        <p className="mt-2 text-[14.5px] text-muted-foreground">No clear mistakes were found in this conversation.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border border-y border-border" data-testid="corrections">
          {items.map((c) => (
            <li key={c.id} className="py-3.5">
              <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">{CORRECTION_LABEL[c.type]}</p>
              <p className="mt-1 text-[15.5px] leading-snug" lang={target} dir={isRtl(target) ? "rtl" : "ltr"}>
                <span className="text-muted-foreground line-through decoration-danger/60">{c.original}</span>
                <span className="sr-only"> should be </span>
                <span aria-hidden className="px-2 text-subtle-foreground">to</span>
                <span className="font-semibold">{c.corrected}</span>
              </p>
              {c.explanation ? <p className="mt-1 text-[14px] text-muted-foreground">{c.explanation}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Drills({ items, target }: { items: Drill[]; target: string }) {
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [hinted, setHinted] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<Record<string, boolean>>({});
  const toggle = (set: Set<string>, id: string) => new Set(set.has(id) ? [...set].filter((x) => x !== id) : [...set, id]);
  const right = Object.values(result).filter(Boolean).length;
  if (!items.length) return null;
  return (
    <section className="mt-12" aria-labelledby="drills">
      <h2 id="drills" className="font-display text-[19px] font-semibold tracking-[-0.01em]">Drills</h2>
      <p className="mt-1 text-[14px] text-muted-foreground" aria-live="polite" data-testid="drill-tally">
        Try each one before you reveal the answer. {Object.keys(result).length ? `${right} of ${items.length} right so far.` : ""}
      </p>
      <ol className="mt-2 divide-y divide-border border-y border-border" data-testid="drills">
        {items.map((d, i) => {
          const open = shown.has(d.id);
          const done = result[d.id];
          return (
            <li key={d.id} className="py-4" data-testid={`drill-${i}`}>
              <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">
                {i + 1}. {DRILL_LABEL[d.type]}
              </p>
              <p className="mt-1 text-[15.5px] leading-snug" lang={d.type === "translation" ? undefined : target}>
                {d.question}
              </p>
              {hinted.has(d.id) && d.hints.length ? (
                <ul className="mt-1.5 list-disc pl-5 text-[14px] text-muted-foreground">
                  {d.hints.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              ) : null}
              {open ? (
                <p className="mt-2 border-l-2 border-primary pl-3 text-[15.5px] font-semibold" lang={d.type === "translation" ? target : undefined} data-testid={`drill-answer-${i}`}>
                  {d.answer}
                </p>
              ) : null}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {d.hints.length ? (
                  <Button variant="ghost" size="sm" aria-expanded={hinted.has(d.id)} onClick={() => setHinted((h) => toggle(h, d.id))}>
                    {hinted.has(d.id) ? "Hide hint" : "Hint"}
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setShown((x) => toggle(x, d.id))} data-testid={`drill-reveal-${i}`}>
                  {open ? "Hide answer" : "Show answer"}
                </Button>
                {open ? (
                  <>
                    <Button variant={done === true ? "soft" : "ghost"} size="sm" aria-pressed={done === true} onClick={() => setResult((r) => ({ ...r, [d.id]: true }))} data-testid={`drill-right-${i}`}>
                      {done === true ? <Check aria-hidden /> : null} I got it
                    </Button>
                    <Button variant={done === false ? "soft" : "ghost"} size="sm" aria-pressed={done === false} onClick={() => setResult((r) => ({ ...r, [d.id]: false }))}>
                      Not yet
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
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

function Vocabulary({ items, sessionId, target }: { items: VocabSuggestion[]; sessionId: string; target: string }) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState<Set<string>>(new Set(items.filter((v) => v.saved).map((v) => v.phrase)));
  const save = useMutation({
    mutationFn: (v: VocabSuggestion) => api().vocab.save({ phrase: v.phrase, meaningNative: v.meaningNative, examples: v.examples, sessionId }),
    meta: { silent: true },
    onSuccess: (_item, v) => {
      setSaved((s) => new Set(s).add(v.phrase));
      void qc.invalidateQueries({ queryKey: qk.vocabAll });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      void qc.invalidateQueries({ queryKey: qk.review });
      void qc.invalidateQueries({ queryKey: qk.practice(sessionId) });
    },
    onError: (e) => toast.error({ title: errorMessage(e) }),
  });
  if (!items.length) return null;
  return (
    <section className="mt-12" aria-labelledby="vocab">
      <h2 id="vocab" className="font-display text-[19px] font-semibold tracking-[-0.01em]">Words and phrases to keep</h2>
      <ul className="mt-2 divide-y divide-border border-y border-border" data-testid="vocab-suggestions">
        {items.map((v) => {
          const isSaved = saved.has(v.phrase);
          return (
            <li key={v.phrase} className="flex items-start gap-3 py-3.5" data-testid="vocab-suggestion">
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-semibold" lang={target} dir={isRtl(target) ? "rtl" : "ltr"}>
                  {v.phrase}
                </p>
                <p className="text-[14px] text-muted-foreground">{v.meaningNative}</p>
                {v.examples.slice(0, 2).map((e) => (
                  <p key={e} className="mt-0.5 text-[13.5px] text-subtle-foreground" lang={target}>
                    {e}
                  </p>
                ))}
              </div>
              <Button variant="ghost" size="sm" aria-label={`Hear ${v.phrase}`} onClick={() => speak(v.phrase, target)}>
                <Volume2 aria-hidden />
              </Button>
              <Button
                variant={isSaved ? "ghost" : "outline"}
                size="sm"
                disabled={isSaved}
                loading={save.isPending && save.variables?.phrase === v.phrase}
                onClick={() => save.mutate(v)}
                aria-label={isSaved ? `${v.phrase} is in your deck` : `Save ${v.phrase} to your deck`}
                data-testid="save-vocab"
              >
                {isSaved ? (
                  <>
                    <Check aria-hidden /> Saved
                  </>
                ) : (
                  "Save to deck"
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Transcript({ session: s }: { session: PracticeSession }) {
  if (!s.transcript.length) return null;
  return (
    <section className="mt-12">
      <details>
        <summary className="cursor-pointer rounded-sm font-display text-[19px] font-semibold tracking-[-0.01em]">Transcript</summary>
        <div className="mt-3 space-y-3" data-testid="session-transcript">
          {s.transcript.map((l, i) => {
            const tutor = l.role === "tutor";
            const parts = tutor ? splitTutorLine(l.text) : { main: l.text, translation: null };
            return (
              <div key={i}>
                <p className={cn("text-[12px] font-semibold", tutor ? "text-primary" : "text-foreground")}>{tutor ? "Tutor" : "You"}</p>
                <p className="text-[14.5px] leading-relaxed" lang={s.targetLanguage} dir={isRtl(s.targetLanguage) ? "rtl" : "ltr"}>
                  {parts.main}
                </p>
                {parts.translation ? <p className="text-[13px] text-subtle-foreground">{parts.translation}</p> : null}
              </div>
            );
          })}
        </div>
      </details>
    </section>
  );
}
