# Add a language

A language is one row in one table: [`apps/api/src/domain/languages.ts`](../../apps/api/src/domain/languages.ts).
Nothing else keeps a list of codes. The web app reads the list from `GET /api/meta/languages`,
so it needs no change, and the database accepts any lowercase two-letter code
(`^[a-z]{2}$`), so there is no migration.

This guide adds Swahili (`sw`) as an example.

## 1. The row

```ts
// apps/api/src/domain/languages.ts
export const LANGUAGES: readonly LanguageInfo[] = [
  // ...
  L("sw", "Swahili", "Kiswahili", "sw-KE"),
];
```

`L(code, name, nativeName, speechLocale, teachable = true)` builds the row:

| Argument | Meaning |
| --- | --- |
| `code` | ISO 639-1, two lowercase letters. Also the transcription hint (see below) |
| `name` | The English name. It goes into the tutor's instructions and the lesson prompt ("TARGET LANGUAGE: Swahili") |
| `nativeName` | The name in the language itself, shown in the pickers |
| `speechLocale` | A BCP-47 tag. The stub transport uses it to pick the browser's speech recogniser and voice. Real providers ignore it |
| `teachable` | `true` offers it as a **target** language. `false` keeps it available as a **native** language only (the tutor's translations go there) until you have tried it with your own voice model. Four Indian languages ship as `false` |

What the row drives, all from this one place:

- `GET /api/meta/languages` (the onboarding and settings pickers);
- profile validation (`LANGUAGE_UNKNOWN`, `LANGUAGE_NOT_TEACHABLE`);
- the tutor's instructions (the language names);
- the provider's input transcription hint: the row's `transcription` field, which `L()` sets
  to the code. OpenAI takes it as the transcription `language`, Gemini as `languageCode`. A
  language not in the table gets `auto`;
- the grant's `speechLocale` for the stub tutor.

If a provider wants a code other than the ISO one for your language (a region or a script),
write the row out by hand instead of calling `L()` and set `transcription` yourself:

```ts
{ code: "zh", name: "Chinese", nativeName: "中文", teachable: true, transcription: "zh", speechLocale: "zh-CN" },
```

## 2. The stub tutor's lines (optional, for the offline demo)

The stub voice provider speaks scripted lines so the product teaches something with no key.
`STUB_LINES` in the same file holds them per target language; a language without an entry gets
a short generic English script.

```ts
const STUB_LINES: Record<string, string[]> = {
  // ...
  sw: [
    "Habari, uko aje? (Hello, how are you?)",
    "Jina langu ni Lingua. Jina lako nani? (My name is Lingua. What is your name?)",
    "Ulifanya nini leo? (What did you do today?)",
    "Vizuri sana! Tutaonana. (Very good! See you later.)",
  ],
};
```

Rules for the lines:

- Each line is the target language, then the translation in parentheses. The offline lesson
  engine builds vocabulary from exactly that shape (`Hola (Hello)`), and the web room shows
  the part in parentheses dimmed.
- The translations are **English** for every learner. The stub is a stand-in for a voice
  model, not a translator; a learner whose native language is not English still sees English
  there. Do not add per-native-language variants.
- "Lingua" in a line is replaced by the deployment's `tutorName` setting when the grant is
  built.
- Four to six short lines is plenty; the tutor speaks one after each thing the learner says.

## 3. Offline engine hints (optional)

The offline engine ([`lesson/offline.ts`](../../apps/api/src/services/practice/lesson/offline.ts))
works for any language, but three tables make it a little sharper for yours:

| Table | What it does | Add your language when |
| --- | --- | --- |
| `FILLERS` | Hesitation words ("um", "euh", "えーと") that lower the fluency and confidence scores | You know the common ones |
| `STOPWORDS` | Function words used to notice native-language words inside a target-language answer, for Latin-script languages | Learners of your language often speak English words in their answers |
| the `scripts` map in `leaksNative` | A script test (for example Devanagari) for native languages written in another script | Your language has its own script and is likely to be someone's native language |
| `LATIN_SENTENCE_LANGUAGES` | Languages for which "a sentence starts with a capital letter" is a correction | Your language is Latin-script and capitalises sentence starts |

None of this is required. A language with no entries still gets word counts, variety and
repeated-word corrections. Remember what the offline engine is and is not
([lesson-engine.md](../architecture/lesson-engine.md#honesty-about-the-offline-engine)).

## 4. Check it

```bash
make test                # unit tests
make test-integration    # starts Postgres and Redis if needed ([testing.md](testing.md))
```

Then, in the running app: onboarding lists the language (as a native and, if `teachable`, a
target), a learner with that target gets stub lines in it, and a real voice model speaks it. The integration test that lists languages checks a named set, so your new
code does not break it.

## 5. Real voice models

Whether a realtime model speaks and understands the language well is a property of the model,
not of this table. Keep `teachable: false` until you have held a real conversation in it with
the voice model you will deploy, and read the provider's language list. Try both OpenAI and
Gemini if you have keys ([providers.md](providers.md#which-languages-work-well)).
