/**
 * Every language the product knows, in one table: its names, whether the tutor can teach it,
 * the code the realtime provider's speech recogniser wants, the BCP-47 tag for the browser's
 * own speech (the stub transport) and the lines the stub tutor speaks.
 *
 * Adding a language is one row here. Nothing else keeps a list of codes.
 */
import type { LanguageOption } from "@open-language/types";

export interface LanguageInfo extends LanguageOption {
  /** ISO-639-1 hint for the provider's input transcription. */
  transcription: string;
  /** BCP-47 tag for the browser's speech recogniser and synthesis voice. */
  speechLocale: string;
}

/**
 * `teachable: false` marks the languages the realtime models speak least well. They remain
 * available as a native language (the tutor's translations go there) but are not offered as
 * a target until a deployment has tried them with its own voice model.
 */
const L = (code: string, name: string, nativeName: string, speechLocale: string, teachable = true): LanguageInfo => ({ code, name, nativeName, teachable, transcription: code, speechLocale });

export const LANGUAGES: readonly LanguageInfo[] = [
  L("en", "English", "English", "en-US"),
  L("es", "Spanish", "Español", "es-ES"),
  L("fr", "French", "Français", "fr-FR"),
  L("de", "German", "Deutsch", "de-DE"),
  L("it", "Italian", "Italiano", "it-IT"),
  L("pt", "Portuguese", "Português", "pt-BR"),
  L("ja", "Japanese", "日本語", "ja-JP"),
  L("ko", "Korean", "한국어", "ko-KR"),
  L("zh", "Chinese", "中文", "zh-CN"),
  L("ar", "Arabic", "العربية", "ar-SA"),
  L("ru", "Russian", "Русский", "ru-RU"),
  L("hi", "Hindi", "हिन्दी", "hi-IN"),
  L("ta", "Tamil", "தமிழ்", "ta-IN"),
  L("te", "Telugu", "తెలుగు", "te-IN"),
  L("bn", "Bengali", "বাংলা", "bn-IN"),
  L("mr", "Marathi", "मराठी", "mr-IN"),
  L("ur", "Urdu", "اردو", "ur-PK"),
  L("kn", "Kannada", "ಕನ್ನಡ", "kn-IN", false),
  L("ml", "Malayalam", "മലയാളം", "ml-IN", false),
  L("gu", "Gujarati", "ગુજરાતી", "gu-IN", false),
  L("pa", "Punjabi", "ਪੰਜਾਬੀ", "pa-IN", false),
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function languageInfo(code: string): LanguageInfo | null {
  return BY_CODE.get(code.toLowerCase()) ?? null;
}

export function isKnownLanguage(code: string): boolean {
  return BY_CODE.has(code);
}

export function isTeachable(code: string): boolean {
  return BY_CODE.get(code)?.teachable ?? false;
}

/** English name for prompts ("Spanish"); the code itself for anything unknown. */
export function languageName(code: string): string {
  return BY_CODE.get(code)?.name ?? code;
}

/** The transcription hint for a target language ("es"), or "auto" when it is not in the table. */
export function transcriptionCode(code: string): string {
  return BY_CODE.get(code)?.transcription ?? "auto";
}

export function speechLocale(code: string): string {
  return BY_CODE.get(code)?.speechLocale ?? "en-US";
}

export function languageOptions(): LanguageOption[] {
  return LANGUAGES.map(({ code, name, nativeName, teachable }) => ({ code, name, nativeName, teachable }));
}

// ─── The stub tutor ─────────────────────────────────────────────────────────

/**
 * What the offline demo tutor says: a handful of lines in the target language, each with a
 * parenthetical translation, exactly the format the real tutor is told to use. The
 * translations are English, whatever the learner's native language is: the stub is a
 * stand-in for a voice model, not a translator.
 */
const STUB_LINES: Record<string, string[]> = {
  es: ["Hola, ¿cómo estás? (Hello, how are you?)", "Me llamo Lingua. ¿Cómo te llamas? (My name is Lingua. What is your name?)", "¿Qué hiciste hoy? (What did you do today?)", "¡Muy bien! Hasta luego. (Very good! See you later.)"],
  fr: ["Bonjour, comment allez-vous ? (Hello, how are you?)", "Je m'appelle Lingua. Comment vous appelez-vous ? (My name is Lingua. What is your name?)", "Qu'avez-vous fait aujourd'hui ? (What did you do today?)", "Très bien ! À bientôt. (Very good! See you soon.)"],
  de: ["Hallo, wie geht es dir? (Hello, how are you?)", "Ich heiße Lingua. Wie heißt du? (My name is Lingua. What is your name?)", "Was hast du heute gemacht? (What did you do today?)", "Sehr gut! Bis bald. (Very good! See you soon.)"],
  hi: ["नमस्ते, आप कैसे हैं? (Hello, how are you?)", "मेरा नाम लिंगुआ है। आपका नाम क्या है? (My name is Lingua. What is your name?)", "आज आपने क्या किया? (What did you do today?)", "बहुत अच्छा! फिर मिलेंगे। (Very good! See you again.)"],
  en: ["Hello, how are you today? (A greeting: answer in a full sentence.)", "My name is Lingua. What is your name? (Tell me your name.)", "What did you do today? (Use the past tense.)", "Very good! See you soon. (A friendly goodbye.)"],
};

const STUB_FALLBACK = ["Hello! (Hello!)", "How are you? (How are you?)", "What is your name? (What is your name?)", "Very good! Goodbye. (Very good! Goodbye.)"];

/** The lines the stub tutor speaks for a target language, in order. */
export function stubScript(targetLanguage: string): string[] {
  return [...(STUB_LINES[targetLanguage] ?? STUB_FALLBACK)];
}
