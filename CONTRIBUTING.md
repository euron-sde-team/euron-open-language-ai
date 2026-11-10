# Contributing

Thanks for helping improve Euron Open Language AI. This guide covers the workflow, the bar a
change has to clear, and the conventions the codebase follows.

## Ground rules

- **Open an issue first** for anything larger than a bug fix or a docs tweak, so we can
  agree on the approach before you invest time.
- **One concern per pull request.** A refactor and a feature are two PRs.
- **Security issues go through private reporting**, never a public issue. See
  [SECURITY.md](SECURITY.md).
- By contributing you agree your work is released under the [MIT License](LICENSE).

## Development setup

Requirements: Docker, Node 22+, pnpm 9 (`corepack enable`).

```bash
pnpm install
make up          # Postgres, Redis, the AWS emulator (provisioned by Terraform), Mailpit,
                 # the stubs (text models and realtime credentials),
                 # then migrate, api, worker and web
make demo        # an admin, four learners, sample lessons, a vocabulary deck and
                 # scenarios on the Stub provider (prints the logins and the demo password)
make test        # unit tests across every package
```

The app is at http://localhost:3640 and every mail it sends is readable at
http://localhost:8116. No provider key is needed: the Stub provider writes lesson reports
deterministically, and the stub voice speaks with the browser's own speech synthesis while
you type. [docs/guides/quickstart-local.md](docs/guides/quickstart-local.md)
lists every port and how to add a real key.

## Before you open a pull request

Each of these must pass:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
make test-integration            # API (HTTP) against a real Postgres and Redis, stubs in-process
make test-matrix                 # when you touched the mail backends
make e2e                         # when you touched a user flow or infrastructure
make tf-validate tf-lint tf-security   # when you touched infra/terraform
pnpm openapi --check             # when you touched a route (pnpm openapi regenerates)
make sanitize                    # no credentials, account ids, real emails or IPs
```

[docs/guides/testing.md](docs/guides/testing.md) explains each layer and the stub trigger
words that steer the fake text model.

## Conventions

**Layers (api).** Routes declare endpoints and guards; controllers parse the request with
strict zod schemas and write the response; services hold the business rules and take an
`Actor`, never a request; repositories hold the Kysely queries; presenters build DTOs field
by field. Background work (lesson reports, hang-ups, the live session sweeper,
maintenance) is a BullMQ job enqueued after the transaction commits. Pure rules (the offline lesson engine, SM-2 grading,
the tutor prompt, the language table, display names) live next to their service or in
`apps/api/src/domain` and have unit tests ([LLD.md](docs/architecture/LLD.md)).

**Every query is scoped to its owner.** A practice session, live session, vocabulary card
or review answer is read with the actor's id in the query, and another account's id is a 404.
A new endpoint that returns user content gets an integration test proving a second account
cannot read it. Admin endpoints never return transcripts or lesson reports.

**The transcript is the only raw learner speech kept.** Never record or store audio, never
put transcript text in a job payload, a log line or a usage row, and keep it on its practice
session's row so deleting the session, erasing the account and the retention job remove it
([ADR 0005](docs/architecture/adr/0005-transcript-is-the-only-learner-content-kept.md)).

**Provider keys stay in the environment.** Never add a key column, a key field to a DTO, or
a log line that could carry one. Provider failures reach users only as a stable code, never as
provider text ([ADR 0004](docs/architecture/adr/0004-text-model-adapters.md)).

**Outside content is data.** Transcripts go to a model only inside `fence()` (an
`<untrusted>` block the prompt says to read as material), and every model output is checked
by a schema before it is stored
([lesson-engine.md](docs/architecture/lesson-engine.md)).

**The offline engine stays honest.** Keep it deterministic, and do not describe it as a
grader in code, copy or docs: it counts and applies a few rules
([ADR 0010](docs/architecture/adr/0010-offline-lesson-engine-by-default.md)).

**The server writes the tutor's instructions.** Realtime instructions are built from the
stored session and scenario and locked into the minted credential. Never let a request body,
a query parameter or the browser contribute to them, and never let a client send scores
([ADR 0003](docs/architecture/adr/0003-server-built-locked-realtime-instructions.md),
[ADR 0007](docs/architecture/adr/0007-browser-transcript-server-scoring.md)).

**No transcript text in logs or usage rows.** Log ids, counts and statuses; never
transcripts or instructions. The logger redacts some field names, but do not rely on
it ([ADR 0006](docs/architecture/adr/0006-monthly-quotas-counts-only-usage.md)).

**The DTOs are a contract.** `packages/types` is read by the web app and by native clients
that vendor it. Add fields, do not rename or remove them, and update
[docs/api/rest-contract.md](docs/api/rest-contract.md) (and
[docs/api/realtime.md](docs/api/realtime.md) for live sessions) in the same PR.

**Routes stay declarative.** One `router.<method>("<path>", ...guards, ctrl.fn);` per
endpoint with a `/** doc comment */` above: `scripts/gen-openapi.ts` builds
docs/api/openapi.yaml from exactly that shape.

**Configuration is validated.** Every environment variable is declared in
`apps/api/src/core/config.ts` and nowhere else; a new one is documented in
[docs/guides/configuration.md](docs/guides/configuration.md) in the same PR, and
security-relevant ones are enforced at boot by `assertProductionConfig`.

**Database changes are new migrations.** Add `db/migrations/NNNN_description.sql` and update
`apps/api/src/db/types.ts`. Never edit an applied migration: the runner refuses to start
when a checksum changes.

**Languages and scenarios are data.** A language is one row in
`apps/api/src/domain/languages.ts` ([add-a-language.md](docs/guides/add-a-language.md)); a
scenario is a row edited in the admin UI or the starter list
([write-a-scenario.md](docs/guides/write-a-scenario.md)). Do not scatter language codes
through the code.

**New providers get stubs.** Teach `apps/stubs/server.mjs` to speak the new wire format or
realtime credential endpoint, so the integration suite stays hermetic
([realtime-and-providers.md](docs/architecture/realtime-and-providers.md)).

**Comments explain why.** The code says what it does. Comments are for the constraint, the
incident, or the trade-off that made it this way.

**Style.** Prettier and ESLint settle formatting. TypeScript strict mode everywhere.

## Commit messages

Imperative mood with an optional scope: `practice: keep the transcript when the live session drops`, `web: keep the transcript when the connection drops`. Explain the *why* in the body when it is not
obvious.

## Architecture decisions

A change that alters a documented decision (the stack, single tenant, server-built locked
realtime instructions, text model adapters and keys, the transcript as the only learner
content kept, monthly quotas and counts-only usage, server-side scoring, server-side
spaced repetition, the offline lesson engine, native token mode, deployment topology) needs a new or updated ADR in
[docs/architecture/adr/](docs/architecture/adr/README.md) explaining the trade-off, linked
from the pull request.
