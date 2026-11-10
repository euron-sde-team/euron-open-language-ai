# The lesson engine

Three pieces of logic turn a voice conversation into learning: the **tutor's instructions**
(what the realtime model is told), the **lesson engine** (what writes the report after the
conversation) and the **deck's schedule** (when a saved phrase comes back). All of it runs on
the server. Code: [`apps/api/src/services/practice/`](../../apps/api/src/services/practice/lesson/index.ts).

Trust boundaries first: the tutor's instructions are built on the server and locked into the
realtime credential ([ADR 0003](adr/0003-server-built-locked-realtime-instructions.md)); the
transcript is reported by the browser and is untrusted; scores are written only by the
lesson engine ([ADR 0007](adr/0007-browser-transcript-server-scoring.md)).

## 1. The tutor's instructions

[`prompts.ts`](../../apps/api/src/services/practice/prompts.ts), `tutorInstructions`. The
inputs are the stored session (target language, native language, level), the scenario's
role-play text, the tutor's name and the house rules from the deployment settings. Nothing
comes from the request. They are assembled in this order:

1. `Your name is <tutorName>.` (the `tutorName` setting, default "Lingua").
2. The base tutor prompt: patient, encouraging and interactive; speak mostly the target
   language and add the native-language translation in parentheses after every sentence
   ("Hola, ¿cómo estás? (Hello, how are you?)"); translate every sentence for A1 and A2;
   ask exactly one follow-up question per turn; correct only real mistakes, after
   acknowledging what was right ("Small note:" or "Quick tip:") with a short explanation in
   the native language; never condescending.
3. `TARGET LANGUAGE: <name>. NATIVE LANGUAGE (for the translations in parentheses): <name>.`
   Names come from the language table below.
4. `LEVEL: <A1..C2>` with a one-sentence guide (A1 very simple words and short sentences, A2
   simple sentences, B1 and B2 natural pace with intermediate vocabulary, C1 and C2 nuanced
   language and deeper conversations).
5. With a scenario: a teaching-style block (set the scene, break the conversation into
   steps, give two or three examples for each new phrase, acknowledge correct use, reinforce
   after a correction), then `SCENARIO / ROLE-PLAY ("<title>")` followed by the scenario's
   `prompt_template`, then an instruction to greet in one short sentence and set the scene.
   For free conversation: "Greet the learner warmly and ask what they would like to practice
   today."
6. A "Staying on task" block: stay in the role of a language tutor, decline unrelated
   requests, give no score or grade, and when the learner is done say a short goodbye with its
   translation and call `end_session`.
7. `House rules from the organisers:` plus the `tutorAddendum` setting, when set.

The only tool the model gets is `end_session`, with no arguments
([`END_SESSION_TOOL`](../../apps/api/src/services/practice/prompts.ts)). There is nowhere to
put a rating, so the model cannot report a score.

### The language table

[`domain/languages.ts`](../../apps/api/src/domain/languages.ts) is the only place that lists
languages. One row per language carries its code, English name, native name, `teachable`
flag, the transcription code handed to the provider's speech recogniser, and the BCP-47
locale used by the browser's own speech (the stub transport). `GET /api/meta/languages`,
profile validation, the tutor prompt, the transcription setting and the stub tutor all read
it ([add-a-language.md](../guides/add-a-language.md)).

The table has 21 languages; the Indian-language rows `kn`, `ml`, `gu` and `pa` are
`teachable: false` (available as a native language, not offered as a target) until a
deployment has tried them with its own voice model.

## 2. Two lesson engines behind one interface

`runLesson` ([`lesson/index.ts`](../../apps/api/src/services/practice/lesson/index.ts)) takes a
`LessonInput` (cleaned transcript, target and native language, level, scenario title) and
returns a `LessonResult`:

| Field | Shape |
| --- | --- |
| `summary` | A short paragraph about the session |
| `corrections` | Up to 8 offline (20 from a model): `{ type, original, corrected, explanation }` |
| `vocab` | At most 10: `{ phrase, meaningNative, examples }` |
| `drills` | Exactly 5 (none when the learner said nothing): `{ type, question, answer, hints }` |
| `scores` | `fluency`, `accuracy`, `vocabRange`, `confidence`, integers 1 to 10 |

The overall score is the mean of the four, to one decimal.

### The fallback rule

1. If the learner said nothing (no non-empty `learner` line), the **offline** engine runs and
   no model is called: there is nothing for a model to judge and no reason to spend tokens.
2. Otherwise the text model is resolved: the one remembered on the session when it started,
   else the deployment's default TEXT model, else none.
3. With a model, the **LLM** engine runs. If it fails (the provider is down, the key is
   wrong, or both attempts return something that does not fit the schema) the **offline**
   engine runs instead. The learner always gets a report.
4. With no usable text model, the **offline** engine runs.

Whichever ran is stored in `practice_sessions.engine` (`llm` or `offline`) and shown to the
admin in Admin, Practice. The learner's report does not name the engine, but the offline
engine says so in its own summary text.

Locally, the starter catalogue includes a **Stub lesson writer** TEXT model as the default, so
under `make up` and the demo the "LLM" engine is the stub's deterministic answer
([`apps/stubs`](../../apps/stubs/README.md)). To see the offline engine, disable that model in
Admin, Models. In production the stub is never added, so a deployment with no text model key
runs the offline engine.

### The LLM engine

[`lesson/llm.ts`](../../apps/api/src/services/practice/lesson/llm.ts) sends the learner and
tutor lines to the configured text model with the lesson prompt and validates the reply:

- The transcript is **fenced** in an `<untrusted>` block that its own text cannot close, and
  the prompt says to ignore any instructions inside it and that a learner cannot award
  themselves a score. Only the last 24,000 characters of a very long conversation are sent.
- The reply goes through `generateJson` ([`ai.ts`](../../apps/api/src/services/practice/ai.ts)):
  JSON mode where the provider has one, a parser that tolerates code fences, leading prose
  and a cut-off tail, a zod schema, and **two attempts** in all. Output is limited to 6,000
  tokens at temperature 0.3.
- The schema requires at least five drills and the four scores; lengths are generous and then
  cut to what the database keeps. Scores are rounded and clamped to 1 to 10.
- Tokens and calls are booked in `usage_daily` for every attempt, successful or not.
- A model asked to judge a learner who barely spoke is told to score 1 to 3.

The model's feedback is a judgement. It can be wrong and it varies between runs and models.

### The offline engine

[`lesson/offline.ts`](../../apps/api/src/services/practice/lesson/offline.ts) needs no key, no
network and no model. It is **deterministic**: the same input always gives the same report
(the unit test `lesson-offline.test.ts` checks it). What it does:

- **Counts what the learner said.** Words (each Han, Hiragana or Katakana character counts as
  one, since those scripts have no spaces), distinct words, the longest answer, hesitation
  markers ("um", "uh", "euh", "えーと" and similar, plus "..."), one- and two-word answers,
  and lines that carry words of the learner's own language (a different script, or two or
  more function words of the native language for English, Spanish, French, German, Italian
  and Portuguese).
- **Turns the counts into scores.** Fluency grows with the average answer length and total
  words and drops with hesitations. Accuracy falls with the number of corrections and
  native-language lines, and is capped low when the learner said fewer than five words.
  Vocabulary range uses distinct words against total words (a type-token measure) and the
  count of distinct words. Confidence falls with short answers, native-language lines and
  hesitations. A learner who said nothing scores 1 on all four.
- **Applies three cheap correction rules**, at most one correction per learner line and eight
  per session: a word said twice in a row; a lowercase pronoun "i" when the target language is
  English; and a sentence that starts in lowercase in English, Spanish, French, German,
  Italian or Portuguese. The explanations are in English.
- **Builds vocabulary from the tutor's own lines.** Wherever the tutor wrote a phrase followed
  by a parenthetical translation ("Hola, ¿cómo estás? (Hello, how are you?)"), the pair
  becomes a suggestion. Short phrases come first, duplicates are dropped, and at most ten are
  kept. This is why the tutor is told to translate every sentence.
- **Builds five drills** from those phrases, the corrected sentences and the learner's longer
  lines, rotating translation, fill-in-the-blank and "say this out loud", padded with generic
  speaking prompts when the transcript is thin.
- **Writes a summary from a template**: how many lines and words, how many distinct, the
  longest answer, pauses and native-language lines. The summary and the drill questions are in
  English whatever the learner's native language is.

#### Honesty about the offline engine

It is a **stand-in, not a grader**. It cannot judge whether a sentence is grammatical, whether
a word was well chosen or how anything sounded; it never produces `pronunciation` or
`word_choice` corrections. A learner who writes a long, fluent, wrong sentence gets a good
fluency score and no correction. The scores say how much and how varied the learner spoke,
not how well. Its summary says so ("connect a text model for feedback on your grammar") and
so does the admin's `engine` column. Use it to try the product, to keep sessions flowing
during a provider outage, or in a setting where no transcript may leave your infrastructure.
Configure a text model for feedback a learner should rely on.

## 3. Quality limits that apply to both engines

- The transcript comes from the learner's browser, so the learner can send anything. See
  [threat-model.md](threat-model.md#a-learner-can-fake-their-own-transcript).
- The stub voice provider's translations are English whatever the learner's native language
  is, so offline vocabulary built from a stub session has English meanings.
- Transcription quality depends on the provider and the language; the report can only be as
  good as the lines it is given.

## The deck and its schedule

[`srs.ts`](../../apps/api/src/services/practice/srs.ts) schedules vocabulary cards in the
manner of SM-2 (pure functions; the clock is an argument so tests are exact). A card has an
`ease` (2.5 to start, never below 1.3), an `interval_days` and `repetitions`, the number of
correct reviews in a row.

| Grade | Next review | Ease | Repetitions |
| --- | --- | --- | --- |
| `again` | in 10 minutes (interval 0) | minus 0.2 | reset to 0 |
| `hard` | 1 day the first time, then the interval times 1.2 (at least one day more) | minus 0.15 | plus 1 |
| `good` | 1 day, then 6 days, then the interval times the ease (at least one day more) | unchanged | plus 1 |
| `easy` | 4 days the first time, then the interval times the ease times 1.3 | plus 0.15 | plus 1 |

Good, good, good gives 1, 6 and 15 days. A card whose interval reaches 21 days is
**mastered**. `GET /api/review/today` serves the cards whose `next_review_at` has passed,
oldest first, at most 50; the server decides the next date from the grade and the card's
stored state, so a client cannot choose its own schedule ([ADR 0008](adr/0008-spaced-repetition-on-the-server.md)).
