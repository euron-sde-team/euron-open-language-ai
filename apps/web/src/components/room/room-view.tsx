"use client";

/**
 * The live practice room. One realtime session per practice session:
 *
 *   preflight   microphone checked, one tap to join (or type instead)
 *   connecting  POST /practice/:id/live, then the transport connects with the grant
 *   live        the tutor speaks first and keeps the conversation going; the learner
 *               speaks or types; the tutor's native-language gloss shows dimmed
 *   saving      the transcript goes to the API, which writes the lesson in the background
 *
 * A session ends when the learner presses End session or when the session's time runs out.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Keyboard, MessageSquareText, Mic, MicOff } from "lucide-react";
import type { LiveSessionGrant, TranscriptLine } from "@open-language/types";
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, IconButton, Sheet, SheetContent, Spinner, Switch, toast } from "@open-language/ui";
import { RequireAuth } from "@/components/common/require-auth";
import { ErrorState } from "@/components/common/states";
import { LogoMark } from "@/components/common/wordmark";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { clock } from "@/lib/language/format";
import { languageName, levelLabel, isRtl } from "@/lib/language/languages";
import { cleanTranscript, hasLearnerSpeech, mergeLine, splitTutorLine, type ShownLine } from "@/lib/language/transcript";
import { useAppMeta } from "@/lib/meta";
import { usePractice, useLanguages } from "@/lib/practice/queries";
import { qk } from "@/lib/query-keys";
import { transportFor, type RealtimeTransport, type TransportEvent } from "@/lib/realtime";
import { TranscriptPanel } from "./transcript-panel";
import { TutorOrb } from "./tutor-orb";

type Phase = "preflight" | "connecting" | "live" | "saving" | "save-failed";

export function RoomView({ id }: { id: string }) {
  return (
    <RequireAuth>
      <Room id={id} />
    </RequireAuth>
  );
}

function Room({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: meta } = useAppMeta();
  const { data: session, error, refetch } = usePractice(id);
  const languages = useLanguages();
  const tutorName = meta?.tutorName ?? "Lingua";

  const [phase, setPhase] = useState<Phase>("preflight");
  const [grant, setGrant] = useState<LiveSessionGrant | null>(null);
  const [lines, setLines] = useState<ShownLine[]>([]);
  const [speaking, setSpeaking] = useState({ tutor: false, learner: false });
  const [muted, setMuted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [typing, setTyping] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showTranslations, setShowTranslations] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [mic, setMic] = useState<MediaStream | null>(null);

  const transport = useRef<RealtimeTransport | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const finalLines = useRef<TranscriptLine[]>([]);
  const finishing = useRef(false);
  const micRef = useRef<MediaStream | null>(null);
  micRef.current = mic;

  // Release the microphone and the session when leaving the page.
  useEffect(
    () => () => {
      transport.current?.close();
      micRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const onEvent = useCallback((e: TransportEvent) => {
    if (e.type === "line") {
      setLines((all) => mergeLine(all, { role: e.role, text: e.text, partial: e.partial }));
      if (!e.partial) finalLines.current.push({ role: e.role, text: e.text });
    } else if (e.type === "speaking") setSpeaking((s) => ({ ...s, [e.who]: e.on }));
    else if (e.type === "error") setProblem(e.message);
  }, []);

  const connect = useCallback(
    async (stream: MediaStream | null) => {
      setPhase("connecting");
      setProblem(null);
      try {
        const g = await api().practice.startLive(id);
        setGrant(g);
        setRemaining(g.maxSeconds);
        const t = await transportFor(g.provider);
        transport.current = t;
        await t.connect({ grant: g, mic: stream, audio: audio.current!, onEvent });
        t.setMuted(false);
        setPhase("live");
      } catch (e) {
        transport.current?.close();
        transport.current = null;
        setPhase("live");
        setProblem(e instanceof Error && !("code" in e) ? e.message : errorMessage(e));
      }
    },
    [id, onEvent],
  );

  const submit = useCallback(
    async (transcript: TranscriptLine[]) => {
      setPhase("saving");
      try {
        await api().practice.end(id, { transcript });
        void qc.invalidateQueries({ queryKey: qk.practiceAll });
        void qc.invalidateQueries({ queryKey: qk.usage });
        void qc.invalidateQueries({ queryKey: qk.dashboard });
        router.push(`/practice/${id}`);
      } catch (e) {
        finishing.current = false;
        setPhase("save-failed");
        toast.error({ title: "Your session was not saved", description: errorMessage(e) });
      }
    },
    [id, qc, router],
  );

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    setLeaving(false);
    transport.current?.close();
    transport.current = null;
    setSpeaking({ tutor: false, learner: false });
    if (grant) await api().practice.endLive(id, grant.id).catch(() => undefined);
    await submit(cleanTranscript(finalLines.current, { maxLines: meta?.limits.maxTranscriptLines, maxChars: meta?.limits.maxTranscriptLineChars }));
  }, [grant, id, meta, submit]);
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // The session clock.
  useEffect(() => {
    if (phase !== "live" || remaining === null) return;
    if (remaining <= 0) {
      void finishRef.current();
      return;
    }
    const t = setTimeout(() => setRemaining((r) => (r === null ? r : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [phase, remaining]);

  const join = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      setMic(stream);
      setMicError(null);
      void connect(stream);
    } catch {
      setMicError("The microphone is blocked. Allow it in the browser's address bar, then try again. You can also continue by typing.");
    }
  };
  const joinTyping = () => {
    setTyping(true);
    setMicError(null);
    void connect(null);
  };

  const leaveForNow = async () => {
    transport.current?.close();
    transport.current = null;
    if (grant) await api().practice.endLive(id, grant.id).catch(() => undefined);
    router.push(`/practice/${id}`);
  };

  const sendTyped = () => {
    const text = typed.trim();
    if (!text || !transport.current) return;
    transport.current.sendText(text);
    setTyped("");
  };

  const lastTutor = useMemo(() => [...lines].reverse().find((l) => l.role === "tutor"), [lines]);
  const caption = lastTutor ? splitTutorLine(lastTutor.text) : null;
  const targetCode = grant?.targetLanguage ?? session?.targetLanguage ?? "en";
  const targetName = languageName(targetCode, languages.data);

  const status = useMemo(() => {
    if (phase === "connecting") return "Connecting";
    if (phase === "saving") return "Saving your session";
    if (phase === "save-failed") return "Your session is not saved yet";
    if (speaking.tutor) return `${tutorName} is speaking`;
    if (speaking.learner) return "Listening";
    return "Your turn";
  }, [phase, speaking, tutorName]);

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} className="mt-24" />;
  if (!session)
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  if (session.status !== "IN_PROGRESS" && phase === "preflight")
    return (
      <div className="mx-auto max-w-md px-6 pt-24 text-center">
        <h1 className="font-display text-[24px] font-semibold">This session has ended</h1>
        <Button asChild className="mt-6">
          <Link href={`/practice/${id}`}>See the lesson</Link>
        </Button>
      </div>
    );

  const live = phase === "live" || phase === "connecting";

  return (
    <div className="flex h-dvh flex-col bg-background">
      <audio ref={audio} autoPlay className="hidden" />
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
        <LogoMark className="size-7" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14px] font-semibold">{session.title}</h1>
          <p className="truncate text-[12.5px] text-subtle-foreground">
            {targetName} · {levelLabel(session.level)}
          </p>
        </div>
        {remaining !== null && phase === "live" ? (
          <span className={cn("text-[13px] tabular-nums", remaining <= 30 ? "font-semibold text-warning" : "text-subtle-foreground")} role="timer" aria-label="Time left" aria-live="off">
            {clock(remaining)}
          </span>
        ) : null}
        <IconButton label="Transcript" className="lg:hidden" onClick={() => setShowTranscript(true)}>
          <MessageSquareText />
        </IconButton>
        <Button variant="outline" size="sm" data-testid="end-session" disabled={phase === "saving"} onClick={() => (phase === "preflight" ? router.push("/practice") : setLeaving(true))}>
          {phase === "preflight" ? "Back" : "End session"}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <main id="main" className="flex min-w-0 flex-1 flex-col">
          {phase === "preflight" ? (
            <Preflight tutorName={tutorName} targetName={targetName} error={micError} onJoin={join} onTyping={joinTyping} resumed={!!session.transcript.length} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-4 py-6 sm:px-8">
              <TutorOrb speaking={speaking.tutor} listening={speaking.learner} busy={phase === "connecting" || phase === "saving"} size="lg" />
              <p className="font-display text-[22px] font-semibold tracking-[-0.01em]">{tutorName}</p>
              <p className="-mt-3 text-[14px] text-muted-foreground" role="status" aria-live="polite" data-testid="room-status">
                {status}
              </p>
              {caption ? (
                <div className="w-full max-w-[640px] text-center" data-testid="caption" lang={targetCode} dir={isRtl(targetCode) ? "rtl" : "ltr"}>
                  <p className="text-balance font-display text-[22px] font-medium leading-snug tracking-[-0.01em] sm:text-[26px]">{caption.main}</p>
                  {caption.translation && showTranslations ? <p className="mt-2 text-[15px] text-subtle-foreground">{caption.translation}</p> : null}
                </div>
              ) : null}
              {problem ? (
                <div className="w-full max-w-[640px] border-l-2 border-danger pl-3 text-left" role="alert">
                  <p className="text-[14px] text-foreground">{problem}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void connect(mic)}>
                      Reconnect
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => (setProblem(null), setTyping(true))}>
                      Continue by typing
                    </Button>
                  </div>
                </div>
              ) : null}
              {phase === "save-failed" ? (
                <div className="w-full max-w-[640px] border-l-2 border-danger pl-3 text-left" role="alert">
                  <p className="text-[14px]">Your conversation is kept on this page. Try saving it again to get your lesson.</p>
                  <Button className="mt-2" size="sm" onClick={() => void submit(cleanTranscript(finalLines.current))}>
                    Save and get my lesson
                  </Button>
                </div>
              ) : null}
            </div>
          )}

          {live ? (
            <div className="shrink-0 border-t border-border px-4 py-3 sm:px-6">
              <div className="mx-auto flex max-w-[1100px] items-center gap-2">
                {mic ? (
                  <IconButton
                    label={muted ? "Unmute microphone" : "Mute microphone"}
                    variant={muted ? "muted" : "outline"}
                    onClick={() => {
                      transport.current?.setMuted(!muted);
                      setMuted(!muted);
                    }}
                  >
                    {muted ? <MicOff /> : <Mic className={speaking.learner ? "text-primary" : undefined} />}
                  </IconButton>
                ) : null}
                {typing || !mic ? (
                  <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(e) => (e.preventDefault(), sendTyped())}>
                    <input
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      placeholder={`Type in ${targetName} and press Enter`}
                      aria-label="Type your reply"
                      lang={targetCode}
                      dir={isRtl(targetCode) ? "rtl" : "ltr"}
                      className="h-10 min-w-0 flex-1 rounded-[10px] border border-input bg-card px-3 text-[14px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                      disabled={phase !== "live"}
                      autoComplete="off"
                    />
                    <Button type="submit" variant="outline" disabled={phase !== "live" || !typed.trim()}>
                      Send
                    </Button>
                  </form>
                ) : (
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => setTyping(true)} className="inline-flex items-center gap-1.5 rounded-sm text-[13px] text-subtle-foreground hover:text-foreground">
                      <Keyboard className="size-4" aria-hidden /> Type instead
                    </button>
                  </div>
                )}
                <label className="hidden shrink-0 items-center gap-2 text-[13px] text-muted-foreground sm:flex">
                  <Switch checked={showTranslations} onCheckedChange={setShowTranslations} aria-label="Show translations" data-testid="toggle-translations" />
                  Translations
                </label>
              </div>
            </div>
          ) : null}
        </main>

        <aside className="hidden w-[340px] shrink-0 border-l border-border lg:flex" aria-label="Transcript">
          <TranscriptPanel lines={lines} tutorName={tutorName} targetLanguage={targetCode} showTranslations={showTranslations} />
        </aside>
      </div>

      <Sheet open={showTranscript} onOpenChange={setShowTranscript}>
        <SheetContent side="right" width="max-w-[380px]" className="w-[90vw] p-0" aria-label="Transcript">
          <TranscriptPanel lines={lines} tutorName={tutorName} targetLanguage={targetCode} showTranslations={showTranslations} />
        </SheetContent>
      </Sheet>

      <Dialog open={leaving} onOpenChange={setLeaving}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>End this session?</DialogTitle>
            <DialogDescription>
              {hasLearnerSpeech(finalLines.current)
                ? "End now to get your lesson: scores, corrections, drills and vocabulary. Or leave and come back to this conversation later."
                : "You have not said anything yet, so the lesson would be nearly empty. Keep practising, or leave and come back later."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLeaving(false)}>
              Keep practising
            </Button>
            <Button variant="outline" onClick={() => void leaveForNow()}>
              Leave for now
            </Button>
            <Button data-testid="confirm-end" onClick={() => void finish()}>
              End and get my lesson
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Preflight({ tutorName, targetName, error, onJoin, onTyping, resumed }: { tutorName: string; targetName: string; error: string | null; onJoin: () => Promise<void>; onTyping: () => void; resumed: boolean }) {
  const [joining, setJoining] = useState(false);
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-6 py-10">
      <TutorOrb speaking={false} listening={false} busy={false} size="md" />
      <h2 className="mt-8 font-display text-[28px] font-semibold tracking-[-0.02em]">{resumed ? "Pick up where you left off" : `${tutorName} is ready for you`}</h2>
      <ul className="mt-4 space-y-2 text-[15px] text-muted-foreground">
        <li>Speak {targetName} out loud. {tutorName} answers, corrects you gently and keeps the conversation going.</li>
        <li>The tutor&apos;s lines show a short gloss in your own language underneath, dimmed. You can switch it off.</li>
        <li>Press End session when you are done to get your lesson.</li>
      </ul>
      {error ? (
        <p className="mt-5 border-l-2 border-danger pl-3 text-[14px]" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button size="lg" data-testid="join-session" loading={joining} onClick={() => {
            setJoining(true);
            void onJoin().finally(() => setJoining(false));
          }}>
          {resumed ? "Continue" : "Start talking"}
        </Button>
        <Button variant="ghost" data-testid="join-typing" onClick={onTyping}>
          Type instead of speaking
        </Button>
      </div>
      <p className="mt-4 text-[12.5px] text-subtle-foreground">Your browser will ask for the microphone. Use headphones if you can.</p>
    </div>
  );
}
