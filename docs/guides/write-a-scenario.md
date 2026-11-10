# Write a scenario

A scenario is a role-play the learner can pick: "Airport immigration", "Ordering food", "Client
meeting". It is one row in the `scenarios` table. Admins manage them in **Admin, Scenarios**;
a fresh install starts with twelve. This page covers what the fields mean, how to write a
prompt that works, and how to seed scenarios in code.

## What a scenario holds

| Field | Who sees it | Notes |
| --- | --- | --- |
| Title | Learners and the report | 1 to 80 characters. Kept on past sessions even if the scenario is later deleted |
| Description | Learners | Up to 300 characters; one or two sentences for the card |
| Lowest and highest level | Learners (it decides who is offered it) | `A1` to `C2`. The lowest cannot be above the highest (`400 LEVEL_RANGE_INVALID`) |
| Goals | Learners (filter) | Any of `TRAVEL`, `INTERVIEW`, `BUSINESS`, `DAILY`, `ACADEMIC`. **None** means it suits every goal |
| Prompt | Staff only | 1 to 4,000 characters. The tutor reads it; no learner endpoint returns it |
| Order | Learners | Lower comes first; empty puts it last |
| Active | Learners | Off hides it from learners and refuses new sessions with it (`400 SCENARIO_NOT_FOUND`); existing sessions are unaffected |

The practice picker (`GET /api/scenarios?forProfile=true`) shows a scenario to a learner when
their level is inside its range **and** they share at least one goal with it (or the scenario
has no goals). Learners with an odd combination see fewer cards; "Talk about anything" is
always there while the `freeConversation` setting is on.

## Write the prompt

The prompt is added to the tutor's instructions after the base tutor behaviour, the language
pair and the level guide
([lesson-engine.md](../architecture/lesson-engine.md#1-the-tutors-instructions)). The base
already makes the tutor speak mostly the target language, translate every sentence in
parentheses, correct only real mistakes and ask one question per turn. So the prompt only
needs to say **who the tutor is in this scene and what happens**.

A good prompt:

- names the tutor's role and the learner's role ("You are a waiter. The learner is a
  customer.");
- sets up the first beat ("They sit down and order food and drinks.");
- lists two or three things to bring up so the conversation has shape (allergies, size, how
  they want something cooked);
- says how hard to be ("Keep sentences simple." for A1);
- stays short. The built-in ones are two to four sentences.

Example, the starter "Ordering food":

```text
You are a waiter at a casual restaurant. The learner is a customer. Role-play: they sit down
and order food and drinks. Ask about preferences (allergies, size, how they want something
cooked). Keep sentences simple. Correct gently.
```

Things to avoid:

- **Language names.** Write the scene, not the language: the same scenario serves a learner
  of any target language. The server adds "TARGET LANGUAGE: Spanish" and the native language.
- **Scoring.** The tutor is told not to give a score or grade. Scores come from the lesson
  engine afterwards, so asking the tutor to rate the learner will be ignored or contradict
  the report.
- **Overriding the rules.** The base prompt and the "Staying on task" block come after your
  text. Instructions to ignore them do not belong here, and the prompt is trusted staff
  content, so write it like code you would review.
- **Personal data.** The prompt is stored in the database and sent to the voice provider with
  every session that uses it.

Each change is audited (`scenario.create`, `scenario.update`, `scenario.delete`) and the
audit trail shows the title and what changed, not the prompt text.

## In the admin UI

1. Open **Admin, Scenarios** and choose **Add scenario**.
2. Fill in the title, description, level range, goals, order and prompt, and leave **Active**
   on. The prompt is a plain textarea.
3. Save. Learners whose level and goals fit see it on **Practice**, after their
   practice list reloads.
4. To try it, sign in as a test learner at a level inside the range and start it.
5. **Hide from learners** keeps the row but removes it from the picker; **Delete** removes it
   and sets `scenario_id` to null on past sessions, which keep their title.

## Seed scenarios in code

The twelve starters live in [`apps/api/src/demo/scenarios.ts`](../../apps/api/src/demo/scenarios.ts)
as the `STARTER_SCENARIOS` array. `ensureStarterScenarios` inserts them **once**, when the
database has no scenarios at all, and records a `starter_scenarios` marker in `settings`, so an
admin who deletes every scenario does not get them back. It runs on the API's first boot and
in `demo:seed`.

To change what a new install starts with, edit the array:

```ts
{
  title: "Renting a flat",
  description: "Ask a landlord about the rent, the deposit and when you can move in.",
  levelMin: "B1",
  levelMax: "B2",
  goals: ["DAILY"],
  promptTemplate: `You are a landlord showing a flat. The learner wants to rent it. Cover the rent, the deposit, the notice period and the move-in date. Keep the pace natural. Correct gently.`,
},
```

Order follows the array (10, 20, 30, ...). This changes new installs only; an existing
deployment adds the scenario in the admin UI. There is no seed file to run by hand and no
migration: scenarios are data.

## Testing a scenario

The stub tutor does not read the prompt (it speaks a fixed script), so the stub proves the
picker, the filtering and the report, not the role-play. To judge a prompt you need a real
voice model: start the scenario, talk for a minute, and read the report. During development,
`GET http://localhost:5209/__/realtime` shows the exact instructions the server locked into a
credential minted through the stubs' OpenAI endpoint, prompt included, which is how the
integration test asserts that the scenario text reaches the model.
