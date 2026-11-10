## What and why

<!-- One paragraph: the problem, and how this change solves it. Link the issue. -->

## How it was verified

- [ ] `pnpm lint && pnpm typecheck && pnpm test`
- [ ] `make test-integration` (if API, database, queue, provider, realtime or mail code changed)
- [ ] `make test-matrix` (if mail backends changed)
- [ ] `make e2e` (if a user flow or the infrastructure changed)
- [ ] `make tf-validate tf-lint tf-security` (if Terraform changed)

## Checklist

- [ ] Docs updated (`docs/`, the configuration reference) for any behavior or config change
- [ ] `pnpm openapi` re-run if a route changed
- [ ] New migration instead of editing an applied one
- [ ] A new language is one row in `apps/api/src/domain/languages.ts`; the offline lesson engine is not described as a grader
- [ ] Access stays scoped: practice sessions, transcripts, lesson reports and vocabulary are visible only to their owner (admins see metadata only), covered by a test
- [ ] Provider keys never reach the database, a log line or an API response
- [ ] Transcript text stays on its session row (never in a job payload, a log line or a usage row) and audio is never stored
- [ ] No secrets, account ids, real emails or hostnames (`make sanitize` is clean)
- [ ] Security-relevant change? Described the threat and mitigation above
