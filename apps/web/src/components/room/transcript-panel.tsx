"use client";

/**
 * The live transcript: the tutor's and the learner's lines, kept scrolled to the end
 * while the reader is there. The tutor's line is shown in the language being learned with
 * its native-language gloss dimmed underneath (hidden when translations are switched off).
 */
import { useEffect, useRef } from "react";
import { cn } from "@open-language/ui";
import { isRtl } from "@/lib/language/languages";
import { splitTutorLine, type ShownLine } from "@/lib/language/transcript";

export function TranscriptPanel({ lines, tutorName, targetLanguage, showTranslations }: { lines: ShownLine[]; tutorName: string; targetLanguage: string; showTranslations: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [lines]);
  const dir = isRtl(targetLanguage) ? "rtl" : "ltr";
  return (
    <div className="flex h-full w-full flex-col" data-testid="transcript">
      <h2 className="shrink-0 border-b border-border px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">Transcript</h2>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 scrollbar-thin"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Transcript"
        tabIndex={0}
      >
        {!lines.length ? <p className="text-[13px] text-subtle-foreground">What you and {tutorName} say appears here.</p> : null}
        {lines.map((l, i) => {
          const tutor = l.role === "tutor";
          const parts = tutor ? splitTutorLine(l.text) : { main: l.text, translation: null };
          return (
            <div key={i} data-testid={tutor ? "line-tutor" : "line-learner"}>
              <p className={cn("text-[12px] font-semibold", tutor ? "text-primary" : "text-foreground")}>{tutor ? tutorName : "You"}</p>
              <p dir={dir} lang={targetLanguage} className={cn("whitespace-pre-line text-[14.5px] leading-relaxed", l.partial && "text-muted-foreground")}>
                {parts.main}
              </p>
              {parts.translation && showTranslations ? <p className="whitespace-pre-line text-[13px] leading-relaxed text-subtle-foreground">{parts.translation}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
