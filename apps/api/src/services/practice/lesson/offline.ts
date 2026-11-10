/**
 * The offline lesson engine: deterministic heuristics over the transcript, no model, no
 * key, no network. The same input always gives the same report.
 *
 * It is a stand-in, not a grader. It counts what the learner said (length, how many
 * different words, hesitation markers, repeated words, words from their own language,
 * one-word answers), applies three cheap spelling rules, and builds vocabulary and drills
 * from the phrases the tutor translated in parentheses ("Hola (Hello)"). It cannot judge
 * whether a sentence is grammatical or how a word sounded. Configure a text model
 * (Admin, Models) for a report that can.
 *
 * Its summary and the explanations are in English whatever the learner's native language.
 */
import type { LessonScores, TranscriptLine } from "@open-language/types";
import { languageName } from "../../../domain/languages";
import { clampScore, DRILL_COUNT, MAX_CORRECTIONS, MAX_VOCAB, type LessonCorrection, type LessonDrill, type LessonInput, type LessonResult, type LessonVocab } from "./types";

// ─── Words ──────────────────────────────────────────────────────────────────

const WORD = /[\p{L}\p{M}\p{N}'’]+/gu;
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LATIN_START = /^\p{Script=Latin}/u;

/** Lowercased word tokens; each Han, Hiragana or Katakana character counts as one (those scripts have no spaces). */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(WORD) ?? []) {
    if (NO_SPACE_SCRIPT.test(raw)) out.push(...Array.from(raw));
    else out.push(raw.replace(/^['’]+|['’]+$/g, ""));
  }
  return out.filter(Boolean);
}

const FILLERS = new Set(["um", "uh", "uhm", "umm", "er", "erm", "eh", "ehm", "hmm", "hm", "mm", "mmm", "ah", "euh", "äh", "ähm", "ee", "えーと", "えっと", "あの", "음", "어", "嗯", "那个", "हम्म", "अं"]);

/** Function words of the larger Latin-script languages, to spot native-language words inside a target-language answer. */
const STOPWORDS: Record<string, Set<string>> = {
  en: new Set(["the", "and", "is", "are", "was", "with", "have", "this", "that", "what", "where", "my", "your", "you", "not", "but", "for", "of", "to", "it", "in", "on", "do", "does", "i'm", "don't"]),
  es: new Set(["el", "la", "los", "las", "y", "es", "son", "con", "que", "mi", "tu", "no", "pero", "para", "de", "un", "una", "en", "por", "yo", "muy"]),
  fr: new Set(["le", "la", "les", "et", "est", "sont", "avec", "que", "mon", "ton", "ne", "pas", "mais", "pour", "de", "un", "une", "dans", "je", "très", "vous"]),
  de: new Set(["der", "die", "das", "und", "ist", "sind", "mit", "dass", "mein", "dein", "nicht", "aber", "für", "ein", "eine", "ich", "sehr", "du", "wir"]),
  it: new Set(["il", "lo", "gli", "e", "è", "sono", "con", "che", "mio", "tuo", "non", "ma", "per", "di", "un", "una", "io", "molto", "ho"]),
  pt: new Set(["o", "os", "as", "e", "é", "são", "com", "que", "meu", "teu", "não", "mas", "para", "de", "um", "uma", "eu", "muito", "você"]),
};

/** True when a line holds words of the learner's own language: its script differs from the target's, or its function words do. */
function leaksNative(line: string, native: string, target: string): boolean {
  const scripts: Record<string, RegExp> = {
    hi: /\p{Script=Devanagari}/u, mr: /\p{Script=Devanagari}/u, ta: /\p{Script=Tamil}/u, te: /\p{Script=Telugu}/u, bn: /\p{Script=Bengali}/u,
    kn: /\p{Script=Kannada}/u, ml: /\p{Script=Malayalam}/u, gu: /\p{Script=Gujarati}/u, pa: /\p{Script=Gurmukhi}/u, ar: /\p{Script=Arabic}/u,
    ur: /\p{Script=Arabic}/u, ru: /\p{Script=Cyrillic}/u, ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u, zh: /\p{Script=Han}/u, ko: /\p{Script=Hangul}/u,
  };
  const nativeScript = scripts[native];
  const targetScript = scripts[target];
  if (nativeScript && nativeScript.source !== targetScript?.source) return nativeScript.test(line);
  const mine = STOPWORDS[native];
  const theirs = STOPWORDS[target];
  if (!mine || nativeScript) return false;
  let hits = 0;
  for (const t of tokens(line)) if (mine.has(t) && !theirs?.has(t)) hits++;
  return hits >= 2;
}

// ─── The numbers ────────────────────────────────────────────────────────────

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

interface Stats {
  lines: number;
  words: number;
  unique: number;
  hesitations: number;
  shortLines: number;
  leakLines: number;
  longest: number;
}

function statsOf(learner: string[], native: string, target: string): Stats {
  const seen = new Set<string>();
  let words = 0;
  let hesitations = 0;
  let shortLines = 0;
  let leakLines = 0;
  let longest = 0;
  for (const line of learner) {
    const ts = tokens(line);
    words += ts.length;
    longest = Math.max(longest, ts.length);
    for (const t of ts) {
      seen.add(t);
      if (FILLERS.has(t)) hesitations++;
    }
    hesitations += (line.match(/\.{3}|…/g) ?? []).length;
    if (ts.length <= 2) shortLines++;
    if (leaksNative(line, native, target)) leakLines++;
  }
  return { lines: learner.length, words, unique: seen.size, hesitations, shortLines, leakLines, longest };
}

export function scoreFrom(s: Stats, corrections: number): LessonScores {
  if (!s.words) return { fluency: 1, accuracy: 1, vocabRange: 1, confidence: 1 };
  const lines = Math.max(1, s.lines);
  const avg = s.words / lines;
  const fluency = 1 + clamp01(avg / 8) * 6 + clamp01(s.words / 80) * 2 - clamp01(s.hesitations / lines) * 2;
  const accuracy = Math.min(s.words < 5 ? 3 : 10, 9 - Math.min(6, corrections * 1.2 + s.leakLines * 0.8));
  const guiraud = s.unique / Math.sqrt(s.words);
  const vocabRange = 1 + clamp01((guiraud - 1.5) / 3.5) * 6 + clamp01(s.unique / 50) * 3;
  const confidence = 1 + (1 - clamp01(s.shortLines / lines)) * 5 + (1 - clamp01(s.leakLines / lines)) * 2 + (1 - clamp01(s.hesitations / lines)) * 2;
  return { fluency: clampScore(fluency), accuracy: clampScore(accuracy), vocabRange: clampScore(vocabRange), confidence: clampScore(confidence) };
}

// ─── Corrections ────────────────────────────────────────────────────────────

const LATIN_SENTENCE_LANGUAGES = new Set(["en", "es", "fr", "de", "it", "pt"]);

/** At most one correction per learner line, from three cheap rules. */
export function correctionsFor(learner: string[], target: string): LessonCorrection[] {
  const out: LessonCorrection[] = [];
  const seen = new Set<string>();
  for (const raw of learner) {
    const original = raw.trim();
    if (!original || seen.has(original)) continue;
    let fixed = original;
    const notes: string[] = [];
    let type: LessonCorrection["type"] = "other";
    if (/(^|[^\p{L}\p{M}'’])([\p{L}\p{M}]{2,})\s+\2(?![\p{L}\p{M}])/iu.test(fixed)) {
      fixed = fixed.replace(/(^|[^\p{L}\p{M}'’])([\p{L}\p{M}]{2,})(\s+\2)+(?![\p{L}\p{M}])/giu, "$1$2");
      notes.push("A word was said twice in a row.");
    }
    if (target === "en" && /(^|[^\p{L}\p{M}])i(?=$|[^\p{L}\p{M}]|['’])/u.test(fixed)) {
      fixed = fixed.replace(/(^|[^\p{L}\p{M}])i(?=$|[^\p{L}\p{M}]|['’])/gu, "$1I");
      notes.push('The pronoun "I" is always a capital letter.');
      type = "grammar";
    }
    if (LATIN_SENTENCE_LANGUAGES.has(target) && LATIN_START.test(fixed) && /^\p{Ll}/u.test(fixed)) {
      fixed = fixed.charAt(0).toLocaleUpperCase() + fixed.slice(1);
      notes.push("A sentence starts with a capital letter.");
    }
    if (fixed === original) continue;
    seen.add(original);
    out.push({ type, original: original.slice(0, 500), corrected: fixed.slice(0, 500), explanation: notes.join(" ") });
    if (out.length >= MAX_CORRECTIONS) break;
  }
  return out;
}

// ─── Vocabulary ─────────────────────────────────────────────────────────────

/** "Hola, ¿cómo estás? (Hello, how are you?)" -> { phrase: "Hola, ¿cómo estás?", meaning: "Hello, how are you?" } */
export function translatedPhrases(tutorLines: string[]): { phrase: string; meaningNative: string }[] {
  const out: { phrase: string; meaningNative: string }[] = [];
  const seen = new Set<string>();
  for (const line of tutorLines) {
    for (const m of line.matchAll(/([^()]+?)\s*\(([^()]{2,})\)/g)) {
      const phrase = (m[1] ?? "").trim().replace(/^[\s,;:.-]+/, "");
      const meaning = (m[2] ?? "").trim();
      const key = phrase.toLowerCase().replace(/[\s.!?¿¡,;:]+$/g, "");
      if (phrase.length < 2 || phrase.length > 100 || meaning.length > 200 || !/\p{L}/u.test(phrase) || key === meaning.toLowerCase() || seen.has(key)) continue;
      seen.add(key);
      out.push({ phrase, meaningNative: meaning });
    }
  }
  // Short chunks make better cards than whole speeches; the order of appearance is otherwise kept.
  return out.map((p, i) => ({ p, i, long: tokens(p.phrase).length > 8 })).sort((a, b) => Number(a.long) - Number(b.long) || a.i - b.i).map((x) => x.p);
}

// ─── Drills ─────────────────────────────────────────────────────────────────

interface Source {
  phrase: string;
  meaning: string | null;
}

function maskWord(phrase: string): { masked: string; word: string } | null {
  const words = phrase.match(/[\p{L}\p{M}]+/gu) ?? [];
  if (words.length < 2) return null;
  const word = words.reduce((best, w) => (w.length > best.length ? w : best), "");
  const at = phrase.indexOf(word);
  return at < 0 ? null : { masked: phrase.slice(0, at) + "____" + phrase.slice(at + word.length), word };
}

const ROTATION = ["translation", "fill_blank", "speak_this"] as const;

function drillFor(src: Source, start: number, language: string): LessonDrill | null {
  for (let k = 0; k < ROTATION.length; k++) {
    const type = ROTATION[(start + k) % ROTATION.length]!;
    if (type === "translation" && src.meaning) {
      return { type, question: `Say this in ${language}: ${src.meaning}`, answer: src.phrase, hints: [`${tokens(src.phrase).length} words`] };
    }
    if (type === "fill_blank") {
      const m = maskWord(src.phrase);
      if (m) return { type, question: `Fill in the blank: ${m.masked}`, answer: m.word, hints: [`It starts with "${m.word.charAt(0)}"`, ...(src.meaning ? [src.meaning] : [])] };
    }
    if (type === "speak_this") return { type, question: `Say this out loud: ${src.phrase}`, answer: src.phrase, hints: src.meaning ? [src.meaning] : [] };
  }
  return null;
}

const PADDING: Source[] = [
  { phrase: "Greet someone and ask how they are.", meaning: null },
  { phrase: "Say your name and where you are from.", meaning: null },
  { phrase: "Order something to drink.", meaning: null },
  { phrase: "Ask for directions to the station.", meaning: null },
  { phrase: "Say what you did yesterday.", meaning: null },
];

export function drillsFor(sources: Source[], language: string): LessonDrill[] {
  if (!sources.length) return [];
  const out: LessonDrill[] = [];
  const seen = new Set<string>();
  const add = (d: LessonDrill | null) => {
    if (!d || seen.has(d.question) || out.length >= DRILL_COUNT) return;
    seen.add(d.question);
    out.push(d);
  };
  for (let i = 0; i < DRILL_COUNT * 2 && out.length < DRILL_COUNT; i++) add(drillFor(sources[i % sources.length]!, i + Math.floor(i / sources.length), language));
  for (const p of PADDING) {
    if (out.length >= DRILL_COUNT) break;
    add({ type: "speak_this", question: `Say it in ${language}: ${p.phrase}`, answer: `Any natural answer in ${language}.`, hints: [] });
  }
  return out;
}

// ─── The engine ─────────────────────────────────────────────────────────────

const lineOf = (t: TranscriptLine[], role: TranscriptLine["role"]) => t.filter((l) => l.role === role).map((l) => l.text.trim()).filter(Boolean);

export function analyzeOffline(input: LessonInput): LessonResult {
  const learner = lineOf(input.transcript, "learner");
  const tutor = lineOf(input.transcript, "tutor");
  const language = languageName(input.targetLanguage);
  const stats = statsOf(learner, input.nativeLanguage, input.targetLanguage);
  const corrections = correctionsFor(learner, input.targetLanguage);
  const scores = scoreFrom(stats, corrections.length);

  const phrases = translatedPhrases(tutor);
  const vocab: LessonVocab[] = phrases.slice(0, MAX_VOCAB).map((p) => ({ phrase: p.phrase, meaningNative: p.meaningNative, examples: [] }));

  const sources: Source[] = [
    ...vocab.map((v) => ({ phrase: v.phrase, meaning: v.meaningNative })),
    ...corrections.map((c) => ({ phrase: c.corrected, meaning: null })),
    ...learner.filter((l) => tokens(l).length >= 3).slice(0, 3).map((l) => ({ phrase: l, meaning: null })),
  ];
  if (!sources.length) for (const l of learner.slice(0, 2)) sources.push({ phrase: l, meaning: null });

  const topic = input.scenarioTitle ? ` about "${input.scenarioTitle}"` : "";
  const summary = stats.words
    ? `You practised ${language}${topic} with ${stats.lines} spoken ${stats.lines === 1 ? "line" : "lines"} and about ${stats.words} words (${stats.unique} different). Your longest answer was ${stats.longest} words.${stats.hesitations ? ` You paused or hesitated ${stats.hesitations} ${stats.hesitations === 1 ? "time" : "times"}.` : ""}${stats.leakLines ? ` ${stats.leakLines} ${stats.leakLines === 1 ? "line" : "lines"} used words from your own language.` : ""} This report was written by the offline engine, which counts rather than grades: connect a text model for feedback on your grammar.`
    : `No speech from you was captured in this session${topic}, so there is nothing to assess. Check your microphone and try again. This report was written by the offline engine.`;

  return { summary, corrections, vocab, drills: drillsFor(sources, language), scores };
}
