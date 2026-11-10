/**
 * The stub transport: no network and no provider key. The tutor's lines (sent by the
 * server with a stub grant as `script`) are spoken with the browser's speech synthesis
 * when it has one, in the target language's locale, and shown in the transcript with the
 * native-language gloss. The tutor says the first line when the room opens and the next
 * one after each thing the learner says; the learner types, or dictates where the browser
 * offers speech recognition. Used for local development, the demo and the end-to-end
 * tests; a server in production never hands out stub grants.
 */
import { splitTutorLine } from "../language/transcript";
import type { ConnectOptions, RealtimeTransport, TransportEvent } from "./types";

type Recognition = { continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>; resultIndex: number }) => void) | null; onend: (() => void) | null; start(): void; stop(): void };

const CLOSING = "That is the end of this practice script. Press End session to get your lesson.";

export function stubTransport(): RealtimeTransport {
  let emit: (e: TransportEvent) => void = () => undefined;
  let closed = false;
  let recognition: Recognition | null = null;
  let muted = false;
  let script: string[] = [];
  let next = 0;
  let locale = "en-US";
  let chain: Promise<void> = Promise.resolve();

  const speak = (line: string) =>
    new Promise<void>((resolve) => {
      if (closed) return resolve();
      emit({ type: "line", role: "tutor", text: line });
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      if (!synth || navigator.webdriver) {
        // Automated browsers: no audio, keep the pace quick.
        emit({ type: "speaking", who: "tutor", on: true });
        setTimeout(() => (emit({ type: "speaking", who: "tutor", on: false }), resolve()), 300);
        return;
      }
      // Only the target language is spoken; the gloss in brackets is for the eyes.
      const u = new SpeechSynthesisUtterance(splitTutorLine(line).main.slice(0, 600));
      u.lang = locale;
      u.onstart = () => emit({ type: "speaking", who: "tutor", on: true });
      u.onend = u.onerror = () => (emit({ type: "speaking", who: "tutor", on: false }), resolve());
      synth.speak(u);
    });

  /** Queue the tutor's next scripted line, so two quick learner turns never talk over each other. */
  const replyNext = () => {
    const line = next < script.length ? script[next++]! : next++ === script.length ? CLOSING : null;
    if (line) chain = chain.then(() => speak(line));
  };

  return {
    async connect({ grant, onEvent }: ConnectOptions) {
      emit = onEvent;
      emit({ type: "stage", stage: "connecting" });
      if (!grant.credential.startsWith("stub_")) throw new Error("Not a stub credential");
      script = grant.script ?? [];
      locale = grant.speechLocale || "en-US";
      emit({ type: "stage", stage: "live" });
      replyNext();
      const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
      const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
      if (Ctor && !navigator.webdriver && !closed) {
        recognition = new Ctor();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = locale;
        recognition.onresult = (e) => {
          if (muted) return;
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i]!;
            if (r.isFinal && r[0].transcript.trim()) {
              emit({ type: "line", role: "learner", text: r[0].transcript.trim() });
              replyNext();
            }
          }
        };
        recognition.onend = () => {
          if (!closed) {
            try {
              recognition?.start();
            } catch {
              /* already running */
            }
          }
        };
        try {
          recognition.start();
        } catch {
          recognition = null;
        }
      }
    },
    sendText(text) {
      emit({ type: "line", role: "learner", text });
      setTimeout(replyNext, 200);
    },
    setMuted(m) {
      muted = m;
    },
    close() {
      closed = true;
      try {
        recognition?.stop();
        window.speechSynthesis?.cancel();
      } catch {
        /* nothing to stop */
      }
      emit({ type: "stage", stage: "closed" });
    },
  };
}
