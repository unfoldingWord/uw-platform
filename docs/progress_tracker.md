# Progress tracker

Where the build of [`PRD.md`](PRD.md) stands. Updated in the same commit as the work it records (`AGENTS.md` section 7, step 7). Requirement IDs are the PRD's.

## Status by build-order step

The steps are PRD section 13.

| Step | Requirements | State | Evidence |
|---|---|---|---|
| 0. Already on `main` | FD-1, FD-2, FD-3, FD-4, FD-5, CT-1 | Built | PRD section 12 |
| 1. Finish the foundation | FD-6 to FD-12, CT-2, CT-3 | Built | `docs/superpowers/plans/2026-10-01-step-01-foundation.md`; tests named FD-6 to FD-12, CT-2, CT-3 (per requirement below); `pnpm verify` green with `TEST_DATABASE_URL` set. FD-12 is written, not switched on |
| 2. The kernel's frame | DX-1 to DX-6, DX-8 | Not started | |
| 3. Kernel and data | KN-1 to KN-18 | Not started | |
| 4. Agent boundary | AB-1 to AB-8 | Not started | |
| 5. GitHub facts | GH-1 to GH-7 | Not started | |
| 6. Command API and live hub | WB-1 to WB-3, WB-11 | Not started | |
| 7. Hosts and engines | HE-1 to HE-10 | Not started | |
| 8. Views | WB-4 to WB-10, WB-12 | Not started | |
| 9. Reaching a person | NT-1 to NT-4 | Not started | |
| 10. Personas | PE-1 to PE-8 | Not started | |
| 11. The end-to-end scenario | DX-7 | Not started | |

## Step 1 evidence by requirement

Commits are on `build/v1`. Tests are the files whose `describe` names carry the requirement ID or that prove it directly.

| Requirement | Commits | Tests |
|---|---|---|
| FD-6 | `eed5a54`, `6d440eb`, `3b6d7f3` | `tools/ci/test-database.test.ts`, `packages/db/foundation.test.ts`, every `apps/**/*.pg.test.ts` |
| FD-7 | `01fa127`, `6cbcb2d`, `e4b1862`, `8deef46`, `5548ab1`, `349ede8`, `6a4aa8a`, `0e78ba7`, `b5c04ae`, `3908200` | `apps/uw-app/auth/access.test.ts`, `apps/uw-app/auth/principal.pg.test.ts`, `apps/uw-app/auth/dev-principal.test.ts`, `apps/uw-app/auth/dev-principal.pg.test.ts`, `packages/core/principal.test.ts`, `tools/infra/access.test.ts`, `packages/db/foundation.test.ts` |
| FD-8 | `c436aa1`, `c6cb72b`, `349ede8`, `5548ab1`, `40ee0b8`, `3811d85`, `1255892`, `31f9672`, `e4c62b9` | `packages/core/acl.test.ts`, `packages/db/advisory-locks.test.ts`, `apps/uw-app/acl/grant-commands.pg.test.ts`, `apps/uw-app/acl/concurrent-commands.pg.test.ts`, `apps/uw-app/acl/last-org-admin.pg.test.ts`, `apps/uw-app/acl/stale-actor.pg.test.ts`, `packages/db/foundation.test.ts` |
| FD-9 | `926a13a`, `021828d`, `a5e75e5`, `d197b6c` | `packages/contracts/page-types.test.ts`, `apps/uw-app/pages/validate.test.ts`, `apps/uw-app/pages/pages.pg.test.ts`, `packages/db/foundation.test.ts` |
| FD-10 | `ec5d8cc`, `07901f4`, `c6ad57a`, `46b574d`, `1b4445a`, `05f0069`, `9098998` | `apps/uw-ingest/app.test.ts`, `apps/uw-ingest/deliveries/ledger.pg.test.ts`, `apps/uw-app/queue/consumer.test.ts`, `packages/contracts/ingest.test.ts`, `tools/ci/ingest-deploy-gate.test.ts` |
| FD-11 | `73ebc07`, `0ffcd16`, `86695d5`, `071e31c`, `30f09ed`, `aa8e79b`, `2411a6b`, `0a7d868` | `packages/core/log.test.ts`, `apps/uw-app/observe.test.ts`, `apps/uw-app/app.test.ts`, `apps/uw-ingest/app.test.ts`, `apps/uw-app/health/health.test.ts`, `apps/uw-app/health/health.pg.test.ts`, `apps/uw-app/health/backlog.pg.test.ts`, `apps/uw-ingest/deliveries/backlog.pg.test.ts`, `apps/uw-app/queue/watermarks.pg.test.ts`, `tools/infra/logs.test.ts` |
| FD-12 (written, not switched on) | `1b4445a`, `4a07103`, `5e9a635`, `03390d3`, `0e78ba7`, `a17119c` | `tools/infra/go-live.test.ts`, `tools/ci/go-live.test.ts` |
| CT-2 | `211fc89`, `cb45ad7`, `31f9672` | `packages/contracts/verbs.test.ts`, `packages/core/acl.test.ts` |
| CT-3 | `8286b8d`, `2ea7053`, `29262fe`, `5255752`, `cf4cec2`, `05f0069` | `packages/contracts/contract-lock.test.ts`, `packages/contracts/contracts.test.ts` |
| AGENTS.md rule 3 | `tableEntries` export, then this task's commit, `9c781bf` | `tools/architecture/owners.test.ts` (five owning modules; scans apps, every package but `packages/db`, and `sim/`; a planted double claim, a planted outside writer and planted namespaced writes in an app, a package and the sim all fail) |

## Decisions made during the build

Choices the PRD, the spec and `AGENTS.md` left open. One row each.

| Date | Requirement | Decision | Why | Cost if wrong |
|---|---|---|---|---|
| 2026-10-01 | FD-7 FD-8 FD-9 FD-10 | Step-1 platform modules (people, acl, pages, deliveries, watermarks) take a Drizzle handle directly and each has an exceptions row; ports arrive in step 2, where the Grants port's platform adapter wraps `acl/grant-store.ts` (P10) | `packages/harness/ports.ts` does not exist yet and these are platform modules, not kernel modules | Step 2 refactors the call sites onto the Grants and Store ports |
| 2026-10-01 | FD-6 | Database-backed app tests are `*.pg.test.ts` in the Vitest node project; Workers-pool tests cover every path without a database | postgres.js over TCP inside the Workers pool is unproven; real Postgres semantics matter more than the runtime here | A defect only `postgres` under workerd shows surfaces at go-live |
| 2026-10-01 | FD-10 | Route tests in uw-ingest use a recording queue and an in-memory delivery ledger; `postgresLedger` is proven separately on real Postgres | The queue binding has no local stand-in without an account | A mismatch between the double and the table semantics; mitigated by the end-to-end pg test |
| 2026-10-01 | CT-3 | `contract-lock.json` records every closed set per version; removing a value needs a major bump; the lock test asserts add-only is minor and remove or rename is major (P24) | Makes "enum, fixtures and version change together" mechanical | An edit in place to an old entry is caught only by review (lock history is not frozen) |
| 2026-10-01 | CT-3 | The four inline enums (principal kind, `submit_to_gate` result, `record_run_step` step, data-sources kind) are named and registered in the task that defines them so the lock covers them (P24) | An unregistered enum escapes the lock | None known |
| 2026-10-01 | CT-3 | `command_not_wired` renamed `not_wired` (PRD 8.5); contract 2.0.0 | The PRD names the reason `not_wired` | None in use yet |
| 2026-10-01 | CT-2 | Verb grants: reads `viewer` on the resource's area, writes `editor`, `list_gifts` `editor(40-49)`, `create_draft_journal_entry` `editor(20-29)`, and `search_pages`, `query_entities`, `poll_queue` gated row by row | PRD 11 and plan section 4 | A wrong grant on one verb is a contract change in step 4 |
| 2026-10-01 | CT-2 | Every verb's input and output schema is defined now; `verbManifest()` is the JSON-serialisable contract data CT-2 means, and a test asserts the registry minus schemas serialises (P25) | CT-2 requires them in the registry | Step 4 may reshape some; each is a contract bump |
| 2026-10-01 | CT-2 | `slugSchema`'s regex is split into four checks and `verbIo` is looked up through a `Map` | The unsafe-regex lint rule and the object-injection rule | None known |
| 2026-10-01 | CT-2 FD-8 | The JD-area regex is `^([0-9])0-\1[9]$` everywhere, exported once from contracts and reused by the database CHECK (P1, P22); `identityPattern` and the identity schema are exported from contracts for the database to reuse | The plan's regex rejects areas 80-89; one source avoids drift | Worker-level copies of a few patterns remain: minor duplication |
| 2026-10-01 | FD-9 | Frontmatter fields for the seven page types (Task 5); persona `status` lives in `pages.status`, not frontmatter; `requires_tools` accepts unregistered verb names | AB-8 must name a missing verb; one status column avoids two sources of truth | PE-1 or KN-15 may add fields (persona `status` for PE-1, a contradiction flag on `learning` for PE-8): the schemas are strict, so each is a minor contract bump |
| 2026-10-01 | FD-9 | Clients supply `pageId` on create; type and area never change on update; a page the principal cannot read is `page_not_found` | Keeps the outcome envelope to `accepted` or `error`; avoids confirming a hidden page exists | Moving a page between areas needs a later command |
| 2026-10-01 | FD-9 | The parent-cycle check runs inside the update transaction with a row lock on the ancestor chain, with a two-connection test (P26) | A cycle can be created by two concurrent re-parents | Slightly more locking |
| 2026-10-01 | FD-8 | `can(actor, action, resource)` takes `read`, `write` or `admin`; editor reads every area as FD-8 states, without the plan's finance and CRM read exclusions | Avoids colliding with the word Verb; the exclusions belong to the ledger and CRM modules, not in v1 | When ledger or CRM tables land, `can()` gains the exclusion for 20-29 and 40-49 |
| 2026-10-01 | FD-8 | `can()` trusts the grants resolved on the principal, except that it ignores an expired one; `resolveGrants` filters `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())` with a test over a revoked and an expired grant. No queue handler, Workflow step or MCP handler calls `can()` yet (the step-1 ingest handler only logs). Obligation on step 2 onward: every such consumer re-resolves the principal's grants from `role_grants` before calling `can()` and never trusts a deserialised principal's grants | `can()` is pure over what the resolver gives it | A resolver bug is an authorization bug; a later consumer that skips the re-resolve honours a revoked grant until it expires |
| 2026-10-01 | FD-8 KN-11 | `can(actor, action, resource, at)`: a grant whose `expiresAt` is at or before `at` counts as absent, and `at` is required. Page and grant commands take the instant their caller captured (the route handler's `new Date()`); `tools/architecture/no-clock-reads.test.ts` fails on `new Date()` or `Date.now()` in `packages/core` or `packages/harness` | A principal serialised into a queue message, Workflow step or MCP call can outlive its grant's expiry; an optional instant fails open when forgotten, and the ship rule needs a clock-free `can()` | A caller can pass a stale instant; commands judge expiry at the instant their request began, not at lock time |
| 2026-10-01 | CT-2 FD-8 | `actionForVerbRole` in `packages/core/acl.ts` maps a verb grant's role to its `can()` action: viewer `read`, editor `write`, admin `admin` (the inverse of `minimumRole`) | `editor(40-49)` checked as `can(read, 40-49)` would pass for any area editor, since editors read every area | A verb whose grant means something other than its role's action needs its own mapping |
| 2026-10-01 | FD-11 | The queue indicator also rates the wait of the oldest delivery received more than 30 s after the watermark's `last_enqueued_at`, as read by `oldestDeliveryReceivedAfter` in `apps/uw-ingest/deliveries/backlog.ts`, the owner of `webhook_deliveries`, which `uw-app` imports through the `@uw/uw-ingest/deliveries/backlog` export (a new workspace link). Chosen over a read in `packages/db` because rule 3 has other modules read through the owner's exports; the oldest unconsumed delivery is used instead of the newest because comparing the newest would flash red the moment a delivery follows a quiet spell | A dead consumer kept the old indicator green | `uw-app` now depends on a module of the `uw-ingest` package; the 30 s grace hides a stopped consumer until a delivery arrives over 30 s after the last one consumed; the read scans `webhook_deliveries` with no index on `received_at`, which needs one as the table grows |
| 2026-10-01 | FD-11 | Failure log lines carry `error_name` and the first 200 characters of `error_message` with every URL replaced by `<url>` (`errorFields` in `packages/core/log.ts`); responses never do. An error whose cause chain (four levels) holds a five-character SQLSTATE `code` logs `error_name`, `error_code` and, when present, `constraint_name` and `table_name` (PGlite's `constraint` is read too) and no message text | A 500 with no cause is undiagnosable; a connection error can quote its connection string; drizzle's `DrizzleQueryError` message quotes the SQL and its params, which carry emails and page bodies | A non-database error message can still quote row values, so a log line may hold up to 200 characters of them; `pgErrorCode` and `pgConstraint` in `apps/uw-app/http/pg-errors.ts` duplicate the unwrap until a later task moves them to `packages/db/errors.ts` |
| 2026-10-01 | FD-8 | Granting a role to a pending person needs org admin and activates them; the people module exports `activatePerson` so it stays the only writer | One writer per table | None known |
| 2026-10-01 | FD-8 | Revoking the last live org-admin grant is refused `last_org_admin`, serialised by locking every live org-admin row | The org must never lose its last admin | None known |
| 2026-10-01 | FD-8 | The caller's authority is re-read under lock inside grant and revoke, so a stale actor is refused; the race loser is refused `not_permitted` (its own authority was revoked first) instead of `last_org_admin`; the last_org_admin refusal is still covered sequentially. Elevated from reviewer Minors to Important because this is the authorization path | KN-13's `FOR SHARE` re-read is the house pattern | Refusal reason wording only |
| 2026-10-01 | FD-8 | All grant and revoke commands are serialised with one `pg_advisory_xact_lock` (key 7301001) | Rare commands; one lock removes every lock-order cycle after a deadlock appeared between grant and revoke | Grant commands queue behind each other (negligible volume); a future writer that row-locks `role_grants` or `people` must adopt the same key, which lives with the page re-parent key (7301002) in `advisoryLocks` in `packages/db/advisory-locks.ts`, with a test that keys are distinct |
| 2026-10-01 | FD-8 | Re-granting a grant that expired but was never revoked first revokes the expired row, with its own audit record | The one-live-grant index would otherwise refuse it | None known |
| 2026-10-01 | FD-8 | `grant_audit` is append-only by trigger | It is an audit trail kept 7 years (PRD 9) | None known |
| 2026-10-01 | FD-8 | PRD FD-8 DEVIATION (P12): the bootstrap migration grants org admin to `ian.lindsley@unfoldingword.org` only, not to Ian and Jesse; Jesse's org-admin grant is made through the grants command at go-live | The PRD says Ian and Jesse, but Jesse's address is unverified: the only address in the repository was the plan's guess, and a wrong address would create a separate person without the grant | One grant command at go-live; until then Jesse cannot administer grants |
| 2026-10-01 | FD-7 | A service token's identity is `agent:svc-<client id>` with no grants; `serviceTokenPrincipal` throws `RangeError` on an empty segment (P2) | AB-2 maps tokens to owners in step 4 | AB-2 replaces it |
| 2026-10-01 | FD-7 | The Access JWT must carry `exp` (required claim); only token failures are 401, other errors are not swallowed; an empty `email` claim counts as absent; the service-token `common_name` form is accepted. Plan-mandated behaviour that left `exp` optional and swallowed JWKS failures was not built | FD-7 requires expiry verification and AGENTS section 10 requires failures to be logged, not swallowed | Stricter than the plan: a legitimate token without `exp` would be refused |
| 2026-10-01 | FD-7 | The local development principal is guarded three ways: no `vars` in any wrangler env (a test reads every env block), the dev path runs only when Access is unconfigured, and only for a `localhost` or `127.0.0.1` host | A secret named `DEV_PRINCIPAL_EMAIL` set on a deployed Worker is neutralised by the host and Access guards | A dev identity on a deployed Worker only if Access is unconfigured and the host is localhost, which a deployed Worker never is |
| 2026-10-01 | FD-7 | `/health` is outside Access and has no `can()` (exceptions.md); `GET /api/me` reads only the caller's own principal and is recorded in `docs/exceptions.md` instead of carrying a vacuous `can()` (P9) | The deploy probe needs the commit without a credential; the route reads nothing beyond the caller | WB-10's drill-through must live behind Access |
| 2026-10-01 | FD-7 | People are classified `internal`, `cache_readonly` | Plan section 2.6 puts the directory there | None known |
| 2026-10-01 | FD-7 | The database handle gains `ping()`; the health indicator fakes that (P5) | The indicator needs a bounded reachability check without a real database in Workers-pool tests | Small API surface |
| 2026-10-01 | FD-11 | Each Worker mints its own trace id and ignores an inbound `x-trace-id`; queue consumers use the envelope's | A caller cannot forge log correlation | A future cross-Worker call must pass the id in its body or envelope |
| 2026-10-01 | FD-11 | A small JSON logger in `packages/core` rather than a package | Workers Logs ingests `console.log` JSON; pino and similar assume Node streams | Low; about 50 lines |
| 2026-10-01 | FD-11 | Queue depth on `/health` is consumer lag from `queue_watermarks`; thresholds 60 s amber, 300 s red; database 500 ms amber, 2 s timeout red; the watermark read is bounded so a stalled database cannot hang `/health` | Queue backlog needs the Cloudflare API and a token | Thresholds tuned at go-live |
| 2026-10-01 | FD-11 | The request-logger lives in `request-logger.ts` and uses a structural `DatabaseEnv` type | Avoids a circular import between the database middleware and the logger | None known |
| 2026-10-01 | FD-11 | 30-day retention is Logpush into R2 `uw-logs` with a lifecycle rule, declared as API bodies in `infra/logs/` | Workers Logs keeps days, not 30 | Needs Workers Paid for Logpush |
| 2026-10-01 | FD-7 FD-11 | Access and Logpush are declared as Cloudflare API JSON applied by a person, not Terraform | No new tool for two declarations | A drift detector (plan section 19) must read these files later |
| 2026-10-01 | FD-10 | Malformed messages are sent to the DLQ producer explicitly and acked; with no DLQ bound they retry into the queue's own `dead_letter_queue` | Fails fast without losing the message | None known |
| 2026-10-01 | FD-10 | Payloads over 120 000 bytes are enqueued with `payload: null`, `payloadTruncated: true` | Cloudflare Queues messages are limited to 128 KB | GH-2 must re-read a truncated delivery from the GitHub API |
| 2026-10-01 | FD-10 | The delivery id is claimed before the send and released if the send fails; if the send and the release both fail the id stays claimed | A failed send must not turn GitHub's redelivery into a replay | A crash between claim and send, or a double failure, loses that delivery until the nightly sweep (GH-2) repairs it |
| 2026-10-01 | FD-10 | Duplicates are acked within a batch; across batches every ingest handler must be idempotent on `(source, deliveryId)` | Cloudflare Queues delivers at least once | GH-2 must upsert |
| 2026-10-01 | FD-10 | The webhook HMAC is computed over the decoded text of the body, not the raw bytes (plan-mandated); the header parse is lenient about `sha256=`; a body whose `Content-Length` exceeds GitHub's 25 MB cap is refused `payload_too_large` (413) before it is read (contract 2.3.0), and the queue send pins `contentType: 'json'` | Fails closed on any mismatch | A non-UTF-8 body would never verify; a chunked body with no `Content-Length` is still read in full |
| 2026-10-01 | FD-10 | `uw-ingest` deploy jobs and the new Neon jobs are gated by `secret-gate.sh`, created in Task 13 and reused by Task 16 (P14); the go-live wrangler declares queue consumers only under staging and production, with `dead_letter_queue` and `max_retries` and the `INGEST_DLQ` producer, and a `preview` env with no consumer for PR Workers, asserted by a test (P13) | AGENTS section 8: never add a job that fails when a secret is absent; a PR Worker must not consume the staging queue | Small workflow change |
| 2026-10-01 | FD-12 | Bindings whose resources do not exist live in `wrangler.go-live.toml`, kept equal to the live config plus those bindings by a test; switching on is copying it over; the preview environment shares staging's Hyperdrive | A binding to a missing resource fails the deploy | One reviewed PR at go-live |
| 2026-10-01 | FD-12 | The Neon PR job runs main's migrator over the PR's SQL files, checked out as data, in a `workflow_run` job; it checks the PR is open at the run's head, forks the branch from staging, and refuses symlinks | PR code never runs with the Neon key | A PR's SQL can still damage its own Neon branch, which is disposable; a reused branch drifts if a PR edits an already-applied migration |
| 2026-10-01 | FD-12 | `drop-neon-branch` continues on error | A PR that never went green has no branch | A real deletion failure leaves a branch to delete by hand |
| 2026-10-01 | FD-12 | `bin/migrate.ts` takes no folder argument and uses the `applyMigrations` default (P23) | A redundant argument is a second source of the folder | None known |
| 2026-10-01 | CT-3 | The event vocabulary is left as on `main` until KN-3 (step 3) | KN-3 owns the event log | None |
| 2026-10-01 | FD-6 FD-8 | Tests restructure the plan's specified tests into top-level helpers and split describes to meet the lint limits, keeping every assertion; the constant-echo test is deleted, the arity test is a type-level `expectTypeOf` test, and the unread-body route test moved to the task whose route reads it (P15, P21) | The ESLint fitness functions apply to test files | None |
| 2026-10-01 | FD-9 FD-10 | Do not export what has no consumer yet; export in the task that consumes (P18, P19); a pending page is a `.tsx` file and every HTML screen carries viewport and color-scheme meta (P16, P17) | knip must pass; the UI rules | None |
| 2026-10-01 | FD-6 FD-10 | `apps/uw-ingest/index.ts` is a knip entry and `infra/uw-ingest/wrangler.toml` exists before `build` runs (P6, P7); the knip ignore for `smol-toml` was dropped in the task that first imports it (P3) | knip and the dry-run build need them | None |
| 2026-10-01 | FD-7 FD-8 FD-9 FD-10 FD-11 | The `owns` check reads the table list from what `@uw/db` exports (`tableEntries`) instead of importing `drizzle-orm` from the repo root, which has no such dependency (P4); `tools/architecture/owners.test.ts` finds every module exporting `owns`, fails on a table claimed twice or by no one, and fails on a write outside the owner, proved by planted fixtures | AGENTS.md rule 3 must be mechanical | The writer check is a text match on `.insert(<table>` and SQL verbs, so a write built dynamically would evade it |
| 2026-10-01 | FD-8 FD-9 FD-10 FD-11 | PRD 8.1 gains `webhook_deliveries` and `queue_watermarks` with their writers, and PRD 8.5 gains the nineteen step-1 refusal reasons, in their own `docs(prd):` commit (P11) | The PRD is the spec and must name what the contract holds | None |

## New dependencies

| Date | Package | What it replaces |
|---|---|---|
| 2026-10-01 | `jose` | Hand-written JWT and JWKS verification of the Access token (`apps/uw-app`) |
| 2026-10-01 | `@octokit/webhooks-methods` | A hand-written HMAC-SHA256 constant-time compare for webhook signatures (`apps/uw-ingest`) |
| 2026-10-01 | `smol-toml` | Hand-parsing wrangler TOML in tests (root devDependency) |
| 2026-10-01 | `hono` in `apps/uw-ingest` | Not a replacement: the second Worker uses the same router as `uw-app` |
| 2026-10-01 | `@uw/uw-ingest` workspace link in `uw-app` | Not a replacement: the `/health` queue indicator reads `webhook_deliveries` through its owner's export |
| 2026-10-01 | `drizzle-orm`, `@uw/db`, `@uw/contracts` workspace links; `wrangler`, `@cloudflare/workers-types` per Worker; `@types/node`; `zod` in `uw-app` | Not replacements: each package newly needs what it already imported in the root or by hand; `@cloudflare/workers-types` moved from the root to `apps/uw-ingest` |

## Not verified

Work that is built and whose verification did not run, with the reason.

| Date | Requirement | What was not verified | Why |
|---|---|---|---|
| 2026-10-01 | FD-7 | The Access JWT from a real Access application, and a real service-token JWT payload (whether `email` is absent or empty); tests use a key pair generated in the test | No Access application exists yet |
| 2026-10-01 | FD-6 FD-10 | `postgres` under workerd against Hyperdrive; pg tests run in Node | Hyperdrive configs do not exist and the Workers pool has no TCP database |
| 2026-10-01 | FD-10 | Cloudflare Queues delivery, retries and the dead-letter queue; doubles and fixtures only | No queue exists without an account |
| 2026-10-01 | FD-10 | The uw-ingest deploy jobs and the staging health probe at `https://uw-ingest-staging.unfoldingword.workers.dev` (the `INGEST_URL` subdomain is a guess from the Worker name and the account subdomain) | No deploy ran |
| 2026-10-01 | FD-10 | The GitHub webhook signature against a real GitHub delivery | The GitHub App and its webhook secret do not exist (GH-1) |
| 2026-10-01 | FD-11 | Workers Logs output, and the Logpush and R2 lifecycle bodies against the Cloudflare API | No Logpush job or `uw-logs` bucket exists |
| 2026-10-01 | FD-11 | The run-step leg of the trace id; the request, webhook, queue message and database-write legs are tested | Nothing to follow until HE-1 adds Workflow steps |
| 2026-10-01 | FD-12 | Every go-live job's configured path: only the skip path ran in CI (`neon-pr.yml`, `drop-neon-branch`, `migrate-staging`, `migrate-production`, the Neon `staging` branch the PR job forks from, and a `workflow_run` stale-head run exits red rather than as a notice) | No Neon key or project |
| 2026-10-01 | FD-8 | Jesse's sign-in address and his org-admin grant | The bootstrap migration grants Ian only (P12); Jesse's address is unverified |
| 2026-10-01 | FD-12 | The Neon `staging` branch must exist before the PR job can fork from it | Neon is not set up |
| 2026-10-01 | CT-3 | The lock history is not frozen: an edit in place to an old lock entry is caught only by review | No test pins old entries |

## Waiting on a person

Platform adapters and go-live wiring that are written and await their first run against the real service (PRD DX-8, FD-12), with the account or secret from PRD section 15 each one needs.

| Date | Requirement | What is written | What is needed to verify it live | From whom |
|---|---|---|---|---|
| 2026-10-01 | FD-7 | Access JWT verification, `infra/access/uw-app.json` | The Access application with Google as IdP, its AUD tag and team domain, a service token; confirm a real Cloudflare service-token JWT payload (email absent versus empty) | Ian, Jesse |
| 2026-10-01 | FD-8 | Bootstrap migration (org admin to Ian only, PRD FD-8 deviation P12) | Confirm Jesse's sign-in address, then make his org-admin grant through the grants command | Jesse (address); Ian (runs the command) |
| 2026-10-01 | FD-10 | uw-ingest Worker, deploy jobs, queue bindings and `INGEST_DLQ` in `wrangler.go-live.toml` | The four queues (including the dead-letter queue); confirm the `INGEST_URL` subdomain; `GITHUB_WEBHOOK_SECRET` as a Worker secret (with GH-1's App) | Ian; an org owner (GitHub App) |
| 2026-10-01 | FD-10 | The Queues consumer and dead-letter wiring in `uw-app` | Switch-on PR copying `wrangler.go-live.toml` over `wrangler.toml` once the queues exist | Ian |
| 2026-10-01 | FD-11 | Workers Logs, `infra/logs/*.json` | Workers Paid for Logpush; the `uw-logs` bucket; R2 credentials; apply the two API bodies | Ian |
| 2026-10-01 | FD-12 | `neon-pr.yml`, `drop-neon-branch`, `migrate-staging`, `migrate-production`, Hyperdrive bindings in `wrangler.go-live.toml` | `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_DIRECT_URL_STAGING`, `NEON_DIRECT_URL_PRODUCTION`; a Neon `staging` branch; Hyperdrive configs for staging and production; then the switch-on PR | Ian |
