# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.x (latest minor) | Yes |
| Older minors | No |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository ("Security" tab, "Report a vulnerability"):
https://github.com/euron-sde-team/euron-open-language-ai/security/advisories/new

Please include:

- the affected component (`apps/api`, `apps/web`, `packages/api-client`,
  `infra/terraform/...`) and version or commit,
- a description of the issue and its impact,
- steps to reproduce, or a proof of concept (against your own deployment or the local
  stack, never someone else's),
- any suggested mitigation.

What to expect:

| Stage | Target |
| ----- | ------ |
| Acknowledgement | within 3 business days |
| Initial assessment and severity | within 7 business days |
| Fix or mitigation for critical / high issues | within 30 days |
| Coordinated public disclosure | after a fix is released, credited to you unless you prefer otherwise |

## Scope

In scope: the code in this repository and the infrastructure it provisions with its
default settings. We are most interested in:

- **Authentication and sessions.** Account takeover, access or refresh token theft or
  reuse, bypassing email verification, two-factor or the invite-only domain allowlist,
  session fixation, password reset flaws, sign-in rate limits that can be sidestepped,
  native token mode weaknesses.
- **Learner privacy.** Reading another account's practice sessions, transcripts, lesson
  reports, scores, vocabulary deck, review history, profile or live sessions; an admin
  endpoint that reveals transcripts or reports; a scenario's staff-only role-play prompt
  reaching a learner.
- **Provider keys.** Any way to make the API return, log or store a model provider key, or
  to surface raw provider error text to a user.
- **Realtime sessions.** Changing the tutor's instructions through anything the
  server accepts (a request body, a query parameter, the Gemini token's constraints); using
  a minted credential for something other than its practice session; getting the SDP
  relay (`/api/realtime/openai/calls`) to forward a credential the server did not mint, to
  accept one twice, or outside its connection window; holding more than one live session at
  a time; voice time that is not booked. Tampering with an OpenAI session from your own
  browser's developer tools is a known residual risk, bounded by the server-side hang-up
  ([docs/architecture/threat-model.md](docs/architecture/threat-model.md)).
- **Scores and review state.** Getting a score that the server's lesson job did not write
  (for example by posting scores), another account's session or report replaced, or a
  vocabulary card's schedule set by a client instead of by the server's grading.
- **Prompt injection with a concrete impact** beyond changing the text or scores of the
  attacker's own lesson report: instructions in a transcript that escape the fenced block to
  reach another user, leak configuration, or change what is stored outside the schema.
- **Transcripts.** Transcript text reaching Redis, a log line or a usage row; a transcript
  stored beyond its session, account erasure or the retention period; recording or storing
  audio.
- **Quotas and rate limits.** Starting more practice sessions or using more voice minutes
  than the monthly allowance, getting quota back by deleting sessions, or bypassing a rate
  limit.
- **Admin control plane.** Reaching `/api/admin` without the role, changing roles, tiers,
  providers or settings without permission, or tampering with the audit log.

Out of scope:

- **What admins can already do.** Admins manage accounts, quotas, providers (including
  their base URLs), scenarios (including their role-play prompts) and the tutor's house
  rules (`tutorAddendum`). Reports that rely on that access are out of scope; reports that let someone gain it are very much in scope.
- **Content sent to configured providers.** Transcripts go to the text model
  provider the operator configures (when one is), and live audio goes to the realtime
  provider, by design.
- **Model behaviour.** A model saying something false or unwanted, an unfair score, or the
  tutor being talked off topic, without one of the concrete impacts listed above.
- **A learner faking their own transcript.** The transcript comes from the learner's own
  browser and only affects their own lesson report; this is documented and accepted
  ([docs/architecture/threat-model.md](docs/architecture/threat-model.md)).
- **The offline lesson engine's limits.** It counts and applies a few spelling rules; it is a
  documented stand-in, not a grader, and its scores are not a security property.
- **Stub translations being English.** The stub tutor is a development stand-in.
- **The demo seed.** `make demo` creates well-known demo accounts on purpose and refuses to
  run with `NODE_ENV=production`.
- **The stubs** (`apps/stubs`), test doubles that never run in production.
- Findings that require a compromised host, compromised AWS account, or leaked deployment
  secrets.
- Denial of service through resource exhaustion of a deployment you operate yourself, or
  spending your own provider budget.

## Hardening checklist for operators

- Deploy with the Terraform in `infra/terraform` (or match it): private subnets, TLS
  everywhere, encryption at rest with a customer-managed key, Redis with TLS and an AUTH
  token, secrets only in Secrets Manager.
- Keep `NODE_ENV=production`: the API refuses to boot with development secrets, the mail
  outbox, inline jobs, a localhost web URL or missing CORS origins, and refuses stub
  providers.
- Put provider keys in the `<prefix>/provider-keys` secret by hand rather than in
  `terraform.tfvars`, so they stay out of Terraform state.
- Serve the web app and the API on one HTTPS host so the refresh cookie stays first-party
  and `Secure`.
- Choose a registration mode: `INVITE_ONLY` with your own email domains, or `CLOSED`, for a
  private deployment.
- Set quota tiers that match your budget (monthly practice sessions, voice minutes,
  session length), and spending limits in each provider's console.
- For sensitive use, set a retention period in `/admin/settings`, and consider a local text
  model (Ollama or vLLM) for the lesson report, or no text model at all (the offline lesson
  engine keeps the transcript inside your deployment). Live voice always goes to the
  realtime provider you configure.
- Enable CloudFront and WAF (`enable_cdn`, on in `aws-prod`) for public deployments.
- Subscribe someone to the alarm topic (`alarm_email`).
