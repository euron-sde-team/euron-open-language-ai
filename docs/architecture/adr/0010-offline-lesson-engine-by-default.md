# ADR 0010: A deterministic offline lesson engine behind the same interface

## Status

Accepted.

## Context

The lesson report is the product's feedback loop, and the best reports come from a text
model. But a text model needs a key, costs money, sends the transcript to a third party, and
can be down. A new install should produce a complete lesson report on its first run with no
key, a deployment that must keep transcripts in-house should be able to run without any
model, and a provider outage should not leave a learner with a spinner.

## Decision

- Two implementations sit behind one `runLesson` interface
  ([`services/practice/lesson/`](../../../apps/api/src/services/practice/lesson/index.ts)):
  the **LLM engine** and a deterministic **offline engine**.
- The offline engine runs when no text model is usable, when the model fails twice, and when
  the learner said nothing (there is nothing to judge). Otherwise the LLM engine runs.
- Both return the same `LessonResult`: a summary, up to ten vocabulary suggestions, exactly
  five drills and four scores from 1 to 10. The row records which one wrote it in `engine`
  (`llm` or `offline`) and the admin sees it.
- The offline engine uses only counts and a few spelling rules, plus the tutor's own
  parenthetical translations as vocabulary. It is deterministic: same input, same output.
- It is documented as a **stand-in, not a grader**: it cannot judge grammar or pronunciation,
  and its summary says so ([lesson-engine.md](../lesson-engine.md#honesty-about-the-offline-engine)).

## Consequences

Positive:

- A complete, working product with no key: sign up, talk to the stub tutor, get a report,
  save vocabulary, review, see progress.
- A provider outage degrades the report's depth instead of failing the session.
- A deployment with strict data rules can keep every transcript inside its own
  infrastructure.
- Tests are exact for the offline path and use the stub model for the LLM path.

Trade-offs:

- A learner can mistake an offline report for real feedback. The summary text, the docs and
  the admin's `engine` column are the mitigation; a product decision to hide scores when the
  engine is offline is left to the operator.
- Two engines are two things to keep in step when the report shape changes.
- The offline summary and explanations are English whatever the learner's native language is.

## Alternatives considered

- **Require a text model.** Simpler code, but a first run that cannot finish a lesson and a
  hard dependency on a third party.
- **Fail the report when the model fails.** Honest, but the learner loses their lesson and an
  admin gets a support request for a provider outage.
- **A local small language model as the default.** Heavy to ship, and still not a grader at
  a size that fits a small container.
