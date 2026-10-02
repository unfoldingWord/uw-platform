# Step 5, GitHub Facts: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GitHub the only source of the facts the Ship gate reads: a least-privilege GitHub App declared in `infra/`, a `gh_*` read model in Postgres fed by the existing webhook ingest and repaired by a nightly sweep, labelled issues imported as items, the `harness/<item>` branch convention with abandon and adopt, risk derived from the PR's changed files and fenced `harness` declaration at the head, approvals counted only from Reviewer identities on the head, a squash-merge connector that re-checks the head and is idempotent per item and head, a recovery sweep for a decision whose connector result was lost, and the four other connectors registered as not wired (GH-1 to GH-7).

**Architecture:** The kernel stays pure. Its GitHubFacts port gains the facts the assembler needs (head ref, changed files at a head, the parsed declaration, check-run app and id, review id and time); the assembler in `packages/harness/gates/ship-input.ts` is the ship rule's only caller and builds every input from those facts; `submit` reads the same port for risk paths and the declaration. In `apps/uw-app`, one read-model module (`apps/uw-app/github/facts/`) owns the six `gh_*` tables and has one upsert path, called by the queue consumer's GitHub handler and by the nightly sweep; the platform GitHubFacts adapter reads it. A GitHub client (`apps/uw-app/github/client.ts`) mints the App JWT with `jose` and an installation token per call, and is reachable only from the GitHub module and the platform Connectors adapter; the merge connector is a handler in that adapter. Everything is proven against fixture payloads, a fixture `fetch` and a fixture key pair (DX-8); the live App waits on a person.

**Tech Stack:** TypeScript 6 strict on Node 22.18+, Zod 4, Hono 4, Drizzle ORM 0.45 over `postgres` 3.4 and `@electric-sql/pglite` 0.5.8, `jose` 6 (already a dependency), `@octokit/core` 7.0.8 (new), Vitest 4 (Workers pool and node project), `fast-check` 4, dependency-cruiser, knip.

**Spec:** `docs/PRD.md` (approved): section 7.5 (GH-1 to GH-7), 7.3 (KN-11, KN-12, KN-13, KN-17 as GH-5 and GH-6 feed them), 8.1 to 8.6, 11, 13 step 5, 15, and 18 (D1, D8, D12, D19; P2, P15, P16, P19, P22). Design: `prd/Harness v1 - Architecture.md` (Figure 3, "The ship rule stays a pure function", "Reviewer's default engine", D1, D8, D12, D19); `docs/architecture.md` ("The kernel over ports", "What is durable, and who writes it", "Transactions and locks"); ADRs 0001, 0003, 0004.

**Requirements covered:** GH-1, GH-2, GH-3, GH-4, GH-5, GH-6, GH-7 (Later; built here as the PRD lists it in step 5). Also every `docs/progress_tracker.md` "Carried to later steps" row naming step 5: the `webhook_deliveries.received_at` index (Task 1); the six tables in `packages/db/schema-github.ts` (Task 1); P16's declaration as a contract schema feeding the risk declaration from GitHub facts (Tasks 3 and 5); changed-file paths from GitHub facts at the head, renames included (Tasks 5 and 8); approvals only by Reviewer identities on the head (Task 4); reviewer and provider ids normalised or counted as zero, SHAs lowercased, abbreviated heads rejected (Tasks 3, 4 and 5); a repository on every harness, and the ship path and merge connector refusing another repository's PR (Tasks 2, 4, 5 and 14); the merge connector idempotent per item and head, a recovery that records a lost connector result, and the admin-triggered `connector_lost` sweep (Tasks 14 and 15).

**Not in this step:** the command routes that will expose manual import and the recovery sweep to a person (WB-1, step 6; Task 16 records the carry); the Reviewer personas that post the reviews (PE-6, HE-9) and the provider marker they write (HE-4) — this step fixes the marker's format and reads it; Workflow hosting of any of this (HE-1); the board and Gates views that show these facts (WB-5, WB-6).

**Decisions this plan makes (the PRD, the spec and `AGENTS.md` leave them open; Task 16 records each with its cost if wrong):**

1. **The read model lives in `apps/uw-app/github/facts/`**, a platform module that uses Drizzle directly (as `pages/store.ts` does), with `docs/exceptions.md` rows. The architecture document already names "the GitHub read-model module in `uw-app`". The sim keeps its scripted GitHubFacts adapter; the platform adapter is proven by the shared port contract on the Postgres server.
2. **The GitHub client is `@octokit/core` with an App JWT signed by `jose` and an installation token minted per call.** `@octokit/auth-app` was rejected because it caches installation tokens in memory across calls, and GH-1 says per call. The private key secret must be PKCS#8 (`openssl pkcs8 -topk8 -nocrypt`); a PKCS#1 key is refused `key_not_pkcs8`. Configuration is three Worker secrets, `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`; any one absent means GitHub is not configured: the merge connector answers `not_wired`, the sweep logs `github_not_configured` and does nothing, PR files are not fetched (so the gate fails closed `risk_tier_undeclared`).
3. **Write-back is three operations: a cross-reference comment, the squash merge, and the merge tag.** The client's write surface is exactly `comment`, `merge` and `tag`. GH-1's "link labels" are not written in v1: the `harness` label is set by a person. The App's permissions are `metadata: read`, `issues: write`, `pull_requests: write` (reviews are under it; GitHub has no separate reviews permission), `checks: read`, `contents: write` (the merge and the tag).
4. **The harness label is `harness`.** An issue carrying it is imported onto the harness whose `repository` equals the issue's repository, case-insensitively; with no such harness the import logs `no_harness_for_repository` and does nothing.
5. **A harness names its repository** (`owner/name` or null), set at activation, unique case-insensitively. A submit, a ship decision and a merge on a PR whose repository is not the harness's are refused: submit `not_permitted` `{ why: 'repository_mismatch' }`, the ship rule through absent facts (`pr_not_open`, `head_mismatch`, `checks_not_green`), the connector `repository_mismatch`.
6. **Heads are full SHAs.** A head is 40 or 64 lowercase hex after trimming and lowercasing; anything else (an abbreviated head) is `malformed_command` at submit and makes the facts unusable at Ship. The read model's CHECKs refuse any other form.
7. **The PR declaration** is the fenced block that opens the PR body: its first line is exactly `` ```harness `` (S5-R39 makes the head position and form an allowlist; see `docs/progress_tracker.md`), closed by a line `` ``` ``, holding `key: value` lines for exactly `closes`, `risks`, `touches`, `risk_tier`, `risk_domains`. `closes` is `none` or a comma list of `#N` or `owner/name#N`; `risk_domains` is `none` or a comma list of risk domains; blank lines are ignored; CRLF is accepted. A second `harness` block, an unclosed block, an unknown or repeated key, a missing key or an invalid value makes the declaration absent (fail closed), with the problem recorded on the read model. It is parsed when the PR is upserted; the body itself is not stored.
8. **Reviewer identities are a reviewed list in `packages/harness/github/reviewers.ts`**: GitHub login `uw-reviewer[bot]` is reviewer `uw-reviewer`, `uw-reviewer-codex[bot]` is `uw-reviewer-codex`. Only a review by a listed login counts; the ship rule sees the listed reviewer id, never the login. `packages/harness/github/` and `apps/uw-app/github/` become protected paths (domain `acl`), so changing who counts as a reviewer needs org-scope admin. The real logins are confirmed by a person (Waiting on a person).
9. **The resolved provider is read from the review body**: a fenced block `` ```harness-review `` with a `provider: <id>` line (and `model: <id>`, read and ignored). No block, or a provider that fails `[a-z0-9._-]` after NFKC and lowercase, is a null provider.
10. **What counts on the head.** A check counts only if its app is `github-actions`, its name is one of the six CI jobs, and it is the latest run (highest GitHub id) of that name on the head. A review counts only if it is by a Reviewer identity, on the head, and is that reviewer's latest review on the head among `approved`, `changes_requested` and `dismissed` (by submission time, then id); `commented` reviews are ignored; only an `approved` latest counts.
11. **Risk at Ship is re-derived from the facts at the head**: the floor from the changed paths (each file and each rename's previous name), carried over the item's ratcheted tier and domains, raised by the declaration. If the files at the head are unknown, or the declaration is absent, the tier is null and the rule refuses `risk_tier_undeclared`. `submit` derives and records `risk_derived` from the same facts when they are known at the submitted head, and records nothing new when they are not (R26 semantics).
12. **The branch convention is checked at Ship**: facts whose head ref is not `harness/<itemId>` are unusable. A claim of an item whose branch is `abandoned` starts from the expected head unless the claim sets `adoptBranch`, which records `branch_adopted`; `adoptBranch` on an item without an abandoned branch is `malformed_command` `{ why: 'no_abandoned_branch' }`. The claim reply names the branch, the commit to start from and whether it was adopted.
13. **Idempotency and order in the read model.** Every row is keyed on its GitHub id. Issues, PRs and milestones overwrite only with an equal or newer GitHub `updated_at` and only when a value differs; a completed check run never returns to a non-completed status; a dismissed review is terminal. Changed files land only for the PR's current head. A truncated delivery (`payloadTruncated`) is logged `payload_truncated` and left to the sweep. A payload that fails its schema is logged `malformed_payload` and acknowledged.
14. **The nightly sweep** runs at `17 3 * * *` UTC as a cron in `apps/uw-app/cron/`. Per repository the App is installed on, it lists issues and PRs updated since the watermark less 10 minutes (all of them on the first run, at most 30 pages of 100 per run), re-reads every open PR's checks, reviews and files, retries pending cross-reference comments, and records on `gh_repos` the watermark and what it repaired (row counts per table). A GitHub failure on one repository leaves its watermark unchanged.
15. **An imported issue wraps a page of a new type `issue`** (frontmatter `repo`, `number`, `github_id`, `url`), created by the read model's import path in the harness's area with slug `issue-<github id>`, status `active`, classified gated (no agent may save it). Imported and manual items share one path and one event: `item_created` carries `issue` (null for a manual enqueue). The item records the issue on `harness_items` (unique on the GitHub id).
16. **Exactly one cross-reference comment** per issue: the import claims the comment on `gh_issues` (`xref_claimed_at`, a claim older than 10 minutes may be retaken), looks for the marker `<!-- uw-harness-item:<itemId> -->` among the issue's comments, posts only if absent, then records the comment id; a failed post releases the claim. The comment reads `This issue is tracked by the unfoldingWord harness as item <itemId>.` followed by the marker.
17. **Label removal** is recorded by `kernel.items.labelRemoved` only when an upsert shows the issue's labels going from holding `harness` to not, and the kernel dedupes on the GitHub `updated_at` of the change. Re-adding the label to an issue whose item exists records nothing.
18. **The merge connector** compares the PR's repository with the harness's, reads the live PR, and refuses `head_mismatch` unless its head equals the expected head; if the PR is already merged at that head it answers succeeded with the existing merge (idempotent per item and head); otherwise it squash-merges with GitHub's `sha` guard (409 is `head_mismatch`, 405 `not_mergeable`), title = the first line of the kernel's message plus ` (#<number>)`, body = the rest of the message (the override reason) and the trailer `Harness-Item: <itemId>`, then creates the lightweight tag `harness/<itemId>` at the merge commit (an existing tag at that commit is fine). A tag failure after a merge still answers succeeded with `tag: 'failed'`, because the effect happened.
19. **Connectors gain `outcomeOf(request)`**, which reports an effect that already happened without causing one. `kernel.gates.recoverConnectors(caller, { harnessId })` (a person with `admin` on the area, grants re-read under lock) finds every parking whose approval has waited more than 15 minutes for a connector result, asks `outcomeOf`, and records `connector_succeeded` (and the stage exit, if the parking is still the approved one) when the effect happened, or `connector_refused` with reason `connector_lost` otherwise.
20. **`deploy`, `send` and `post` join `merge` and `publish` in the connector registry** (GH-7); the platform adapter answers each of `deploy`, `publish`, `send`, `post` `refused` `not_wired`, which the stage exit writes as `connector_refused`.
21. **The kernel's `shipRule` member is removed**; the rule is called only by `approve-at-ship.ts` (GH-5's "only caller outside its tests"). `shipRule` stays exported from the `@uw/harness` index for tests.
22. **Contract versions:** `6.0.0` → `7.0.0` (Task 2: `harnessSchema.repository`, a required field) → `7.1.0` (Task 3: the declaration schema, additive) → `8.0.0` (Task 5: full-SHA heads, tightening) → `8.1.0` (Task 6: claim's `adoptBranch` and `branch`, additive) → `9.0.0` (Task 11: the item's issue, a required field).

---

## Global Constraints

Every task obeys every line here. The controller passes this section to each implementer.

**Where and how**

- Work only in the worktree `/home/ianjl/projects/uw-platform-v1` on branch `build/v1`. Never commit to `main`, never push, never force-push, never `--no-verify`, never rewrite history.
- Read `AGENTS.md` sections 1, 4, 6 and 10 before the first edit. When this plan and `AGENTS.md` disagree, `AGENTS.md` wins: build the version that keeps the rule and record the conflict in `docs/progress_tracker.md`.
- Words come from `CONTEXT.md` (Task 1 adds GitHub facts, read model, sweep, PR declaration, Reviewer identity, cross-reference comment): kernel (never "engine" for the core), harness, stage, item, gate, principal, grant, agent identity, persona, delegation, lease, connector, event, gateway, projection, port, adapter, platform adapter, test adapter, sim, world, scenario. Never "mock", "fake" or "memory adapter" for the Store test adapter.
- **Never run two test suites at once** (tracker R37: concurrent Vitest suites exhausted the 16 GB machine and the OOM killer took the session). Run one `pnpm vitest run …`, one `pnpm sim …` or one `pnpm verify` at a time, never in the background beside another, and never two implementers' suites in parallel.

**Code rules (mechanically enforced by `pnpm verify`)**

- TypeScript `strict`, no `any`, no `@ts-ignore`, no `as unknown as`, no non-null `!` on values that can be null at runtime.
- No code comments of any kind: no line comments, block comments, JSDoc, directive comments or commented-out code.
- Files under 500 lines (non-blank); functions under 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters. These apply to test files: hoist logic out of `describe` callbacks into top-level helpers and split long `describe` blocks.
- Erasable syntax only: no `enum`, no `namespace`, no constructor parameter properties. Every relative import names its `.ts` file. JSON is imported `with { type: 'json' }`.
- No clock reads in `packages/core` or `packages/harness` (`tools/architecture/no-clock-reads.test.ts`). The kernel reads time once per command through `ports.clock.now()`. App code takes a `now: () => Date` or `Clock` dependency; `new Date(iso)` and `new Date(at.getTime() + ms)` are fine.
- Calendar dates only through `packages/core/dates.ts`; instants are `Date` objects or whole `toISOString()` strings.
- Lookups by a variable key use `Map` or `Object.hasOwn`. Discovery by registry (a `Map` built from an array), never a `switch` or `if` chain on an event name, connector, cron or page type.
- Regexes avoid nested quantified groups (`security/detect-unsafe-regex`); write alternations such as `^(?:[0-9a-f]{40}|[0-9a-f]{64})$`.
- Every refusal is a closed-set reason from `errorReasonSchema` (`packages/contracts/outcomes.ts`); never raw exception text in a reply or an event. Unexpected errors are logged with `errorFields` from `@uw/core/log` and answered `internal_error`. Connector refusal reasons are short lowercase words (`head_mismatch`, `not_mergeable`, `repository_mismatch`, `not_wired`, `connector_lost`, `github_<failure>`).
- Do not export what has no consumer yet; export in the task that consumes it (test files count as consumers for knip).

**Layering (dependency-cruiser and ESLint)**

- `packages/contracts` imports only `zod`. `packages/core` imports `packages/contracts` and `zod`. `packages/db` imports `packages/contracts`, `packages/core`, `drizzle-orm`, `postgres`, `@electric-sql/pglite` and Node built-ins. `packages/harness` imports `@uw/contracts` and `@uw/core/acl` and nothing else.
- `sim/` imports `packages/harness`, `packages/contracts`, `packages/db`, its own files and the Node built-ins in `AGENTS.md` rule 2; its tests also Vitest.
- `@octokit/core` and the GitHub client (`apps/uw-app/github/client.ts`, `apps/uw-app/github/token.ts`) are imported only by files under `apps/uw-app/github/` and by `apps/uw-app/ports/connectors.ts`; never by `apps/uw-app/mcp/**` or `apps/uw-app/engines/**` (Task 7 adds the dependency-cruiser rule). No function returns an installation token or the App JWT to its caller; no log line carries either.
- Rule 2 exceptions: an `apps/uw-app` platform module that uses Drizzle directly needs its own row in `docs/exceptions.md`, written in the same commit as the code and before it.
- One writer per table (rule 3): the six `gh_*` tables are written only under `apps/uw-app/github/facts/` (`owns` in `apps/uw-app/github/facts/upsert.ts`); `pages` and `page_versions` only under `apps/uw-app/pages/`; `harness_items` and `harness_events` only by the kernel through its gateways; `harnesses` only by the stage command.
- No route, tool handler or Workflow step reachable by an agent identity writes `gate_decisions` or `harness_stages`, calls `kernel.gates`, `kernel.stages` or `kernel.repair`, or names the connectors port (`tools/architecture/agent-boundary.ts`). The GitHub queue handler and the cron are reached from `apps/uw-app/index.ts`, which that check scans: they may call `kernel.items` and `kernel.reads` only.

**Ports, gateways and transactions**

- The ten ports and their keys are unchanged. This step changes `packages/harness/ports.ts` in Tasks 2 (`HarnessesGateway.read.byRepository`), 4 (the facts shape), 11 (`HarnessItemsGateway.read.byIssue`) and 14 (`ConnectorRequest.repository`, `Connectors.outcomeOf`). Each change lands with the Drizzle gateway in `packages/db/store/`, the sim adapter, the port contract suite and every adapter that binds it.
- Pass `tx` as-is; never nest transactions; lock order is advisory locks, stage lock, item row, grants, appends, with no lock after the first append. No call to a port other than Store and Grants inside a Store transaction: read GitHub facts, and run connectors, before or after it.
- Kernel tables take every instant from the command's `at` and every id from the Ids port. The `gh_*` tables take `fresh_at` from the caller's `now()` (no `defaultNow()`).
- New advisory lock keys are added to `lockKeys` in `packages/harness/lock-keys.ts` and their prefixes to `lockKeyPrefixes` in `packages/db/advisory-locks.ts` (Task 12: `github-issue:<githubId>`).

**Contracts**

- The live version moves `6.0.0` → `7.0.0` (Task 2) → `7.1.0` (Task 3) → `8.0.0` (Task 5) → `8.1.0` (Task 6) → `9.0.0` (Task 11). Each move changes, together and in one commit: the schemas, their fixtures under `packages/contracts/fixtures/<registry key>/{valid,invalid}/` (and `packages/contracts/verb-fixtures/<verb>/{input,output}/{valid,invalid}/` for verb I/O), the `schemaRegistry` entries in `packages/contracts/registry.ts`, `CONTRACT_VERSION` in `packages/contracts/version.ts`, a new last entry in `packages/contracts/contract-lock.json` recording every closed set, and `"contractVersion"` in `apps/uw-app/package.json` and `apps/uw-ingest/package.json`. No other task changes a contract; if one finds it must, it bumps the minor version the same way and records why in the tracker.

**Shared roots**

- `packages/db/schema.ts`, `packages/db/schema-*.ts` and the migrations, `packages/contracts/`, `packages/harness/ports.ts`, `packages/core/acl.ts`, `infra/`, `.github/workflows/`, `AGENTS.md`, `CONTEXT.md`, `docs/adr/`. A change to one goes in its own commit with no feature code, and the message names the shared root and why it changed. This step changes `CONTEXT.md`, `packages/db/schema-github.ts`, `schema.ts`, `schema-platform.ts` and migration 0013 (Task 1); `packages/contracts/`, `schema.ts`, migration 0014 and `ports.ts` (Task 2); `packages/contracts/` (Tasks 3, 5, 6, 11); `ports.ts` (Tasks 4, 11, 14); `infra/` (Tasks 7, 10); `schema.ts` and migration 0015 (Task 11).
- Migrations are generated: `pnpm db:generate --name <name>` from the worktree root (it forwards to `drizzle-kit generate`), producing `packages/db/migrations/<NNNN>_<name>.sql` and its snapshot; commit both. Never hand-edit a generated migration; a constraint drizzle cannot express goes in a separate hand-written migration file, as earlier steps did.

**Dependencies**

- One new third-party package: `@octokit/core@^7.0.8` (MIT; fetch-based, runs on Workers and Node 22) in `apps/uw-app/package.json` `dependencies`, added in Task 7. Run `pnpm install` after any `package.json` change and commit `pnpm-lock.yaml` with it. If `pnpm audit:prod` reports a high advisory in its tree, pin the patched version through `pnpm.overrides` in the root `package.json` and record it.

**Tests**

- Write the failing test or scenario first, run it, see it fail for the expected reason, then implement. Where a task proves behaviour the code already has, mutate the code under test by hand once, see the test go red, and restore it before committing.
- Name each `describe` (or scenario file) with the requirement ID first and a space: `describe('GH-5 only Reviewer identities on the head count', …)`, `sim/scenarios/GH-3.a-labelled-issue-becomes-one-item.ts`. A title may lead with an ID only if it proves that requirement's clauses (tracker R36). Fixture IDs use the prefix `ZZ-`.
- A scenario is `defineScenario({ id, title, run })` returning `{ state }`; the runner supplies the events and checks replay against the projection. Scenarios assert with `node:assert/strict`.
- Kernel behaviour over the world that is not a scenario goes in `sim/kernel/*.test.ts`; schema behaviour in `packages/db/*.test.ts` on `databaseTargets` from `@uw/db/test-targets`; property tests in `tools/properties/*.test.ts`.
- `apps/uw-app` tests: pure and Workers-runtime tests are `*.test.ts` (the `workers` Vitest project, no database); anything with a database is `*.pg.test.ts` (the `node` project) on `withAppDatabase` (`apps/uw-app/testing/postgres.ts`), wrapped in `describe.skipIf(!testServer)`.
- GitHub is never called. Webhook and REST payloads are JSON fixtures under `apps/uw-app/github/fixtures/`, trimmed from GitHub's documented example payloads (docs.github.com, "Webhook events and payloads" and the REST reference) with their ids and names changed to fixture values; the GitHub API is `fixtureGitHub()` from `apps/uw-app/github/testing/fixture-github.ts` (Task 7), a `fetch` that routes method and path to programmed responses and records every request; the App key is a pair generated in the test with `jose`'s `generateKeyPair('RS256', { extractable: true })`.
- Fixture heads are full SHAs. In the sim use `simSha(seed)` from `sim/ship-fixtures.ts` (Task 4): `seed.padEnd(40, '0')`, with `seed` lowercase hex.
- Locally `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test` (a private local Postgres 16 server, already running); CI uses the `postgres:16` service container. No test may need a live account or a secret (PRD DX-8); the only environment variables test code reads are `TEST_DATABASE_URL`, `CI` and `PATH`.
- Every test file that opens an embedded Postgres (directly or through `createWorld`) has `afterAll(closeEmbeddedTemplate)` and closes every world or database it opens.
- Fixed ids are UUIDs in the repo's patterns (`00000000-0000-4000-8000-00000000000N`; sim people `simPersonId(n)`). GitHub ids in fixtures are integers from `9100000001` upward.
- Single-file runs: `pnpm vitest run <file>` (add `--project workers` or `--project node` when the file is ambiguous; prefix `TEST_DATABASE_URL=…` for `*.pg.test.ts`); one scenario: `pnpm sim -- <ID>`.

**Verify and commit**

- At the end of every task, from the worktree root: `pnpm format`, then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. It must be green and the server tests must have run, not skipped.
- Commits are Conventional Commits. The body names the requirement IDs on its own line, for example `GH-5 KN-17`. No `Co-Authored-By` line and no attribution footer of any kind. Hooks always run.

---

## Review Focus

Inputs the PRD implies but no requirement spells out, most likely to bite a person first. Each has its test in the owning task.

1. **A late redelivery that would undo a newer fact.** A `pull_request_review` "submitted" delivery processed after the "dismissed" one for the same review, or an older `pull_request` delivery after a `synchronize`. Expected: the review stays dismissed and does not count; the head stays the newer one. Test: Task 8 (`upsert.pg.test.ts`).
2. **The head moving between the gate's read and the merge.** A push lands after the approve read the facts. Expected: GitHub's `sha` guard answers 409, the connector refuses `head_mismatch`, no tag is created, the item stays parked with `connector_refused`. Test: Task 14 (`merge.test.ts`).
3. **A check that looks like CI but is not.** A check run named `test` from another app, or a failed `test` run beside a later green re-run. Expected: the foreign one is ignored; the latest run of the name on the head decides. Test: Task 4 (`ship-input.test.ts`).
4. **Case and form variants of repositories and SHAs.** `UnfoldingWord/UW-Platform` against `unfoldingWord/uw-platform`, an uppercase head, an abbreviated head. Expected: repositories match case-insensitively; SHAs are lowercased; an abbreviated head is `malformed_command` at submit and unusable at Ship. Tests: Task 2 (`harness-repository.test.ts`), Task 4, Task 5 (`submit-facts.test.ts`), Task 8.
5. **A PR body that almost declares.** Two `harness` blocks, CRLF line endings, `risk_tier: low` over a migration path, or a missing closing fence. Expected: two blocks and an unclosed block are absent declarations (undeclared); CRLF parses; a declaration never lowers the floor (`high` with `migration`). Tests: Task 3 (`declaration.test.ts`), Task 4.

---

## File map

```
CONTEXT.md; packages/db/{schema-github,schema,schema-platform,checks}.ts, migrations/0013_github_read_model.*;
  packages/db/github-tables.test.ts                                                                         Task 1
packages/contracts/{harness,event-evidence,registry,version}.ts, contract-lock.json, fixtures/**;
  packages/db/{schema.ts,store/harnesses.ts,store/rows.ts}, migrations/0014_harness_repository.*;
  packages/harness/{ports.ts,stages/activate.ts,port-contracts/store-gateways.ts}; sim/fixtures.ts;
  packages/db/harness-repository.test.ts; sim/kernel/harness-repository.test.ts; apps/*/package.json        Task 2
packages/contracts/{github,index,registry,version}.ts, fixtures/**; packages/harness/github/{identifiers,
  declaration,reviewers}.ts + tests; packages/harness/{ship-rule.ts,risk/protected-directories.ts,index.ts} Task 3
packages/harness/{ports.ts,gates/ship-input.ts,gates/approve-at-ship.ts,kernel.ts,port-contracts/github-facts.ts};
  sim/{adapters/github-facts.ts,ship-fixtures.ts}; scenarios and tests that build facts; sim/scenarios/GH-5.* Task 4
packages/contracts/{ship-rule,harness,verb-io,event-evidence,version}.ts, fixtures/**;
  packages/db/checks.ts; packages/harness/{items/submit.ts,items/commands.ts,gates/facts-failure.ts};
  apps/uw-app/mcp/verbs/submit-to-gate.ts; sim/ship-fixtures.ts; sim/kernel/submit-facts.test.ts           Task 5
packages/contracts/{verb-io,version}.ts, verb-fixtures/**; packages/harness/items/claim.ts;
  apps/uw-app/mcp/verbs/claim-item.ts; sim/scenarios/GH-4.*                                                 Task 6
infra/github/app-manifest.json, infra/README.md; apps/uw-app/{env.ts,package.json};
  apps/uw-app/github/{app-config,token,client,failures}.ts, testing/fixture-github.ts; tests;
  .dependency-cruiser.mjs; tools/infra/github-app.test.ts                                                    Task 7
apps/uw-app/github/{payloads.ts,fixtures/*.json,facts/records.ts,facts/normalise.ts,facts/upsert.ts,
  facts/queries.ts}; tests; tools/architecture/owners.test.ts; docs/exceptions.md                           Task 8
apps/uw-app/ports/github-facts.ts, github-facts.contract.pg.test.ts; apps/uw-app/kernel.ts;
  apps/uw-app/github/{ingest,follow-up}.ts; apps/uw-app/queue/{consumer,worker}.ts; tests                   Task 9
apps/uw-app/cron/{registry,scheduled}.ts; apps/uw-app/github/sweep.ts; apps/uw-app/index.ts;
  infra/uw-app/wrangler{,.go-live}.toml; tools/infra/crons.test.ts; tests                                   Task 10
packages/contracts/{identity,harness,event-evidence,page-types,pages,registry,version}.ts, fixtures/**;
  packages/db/schema.ts, migrations/0015_item_issue.*; packages/harness/ports.ts;
  packages/db/store/{items,rows}.ts; packages/harness/{items/fold.ts,items/record.ts,port-contracts/*};
  packages/core/principal.ts; apps/uw-app/pages/gating.ts                                                   Task 11
packages/harness/{access.ts,lock-keys.ts,items/enqueue.ts,items/import.ts,items/commands.ts,
  reads/index.ts,reads/repository.ts}; packages/db/advisory-locks.ts; tools/architecture/system-principal.test.ts;
  sim/scenarios/GH-3.*; sim/kernel/import.test.ts; apps/uw-app/harness/import-race.pg.test.ts              Task 12
apps/uw-app/pages/issue-pages.ts; apps/uw-app/github/{import,follow-up,sweep}.ts;
  apps/uw-app/github/facts/{upsert,queries}.ts; docs/exceptions.md; tests                                    Task 13
packages/harness/{ports.ts,connectors/registry.ts,gates/exit.ts,gates/approve-at-ship.ts,
  port-contracts/connectors.ts}; sim/adapters/connectors.ts; apps/uw-app/github/merge.ts;
  apps/uw-app/ports/connectors.ts (+contract test); apps/uw-app/kernel.ts; delete connectors.not-wired.ts;
  tools/architecture/connector-callers.test.ts; .dependency-cruiser.mjs; tests                              Task 14
packages/harness/gates/{recover.ts,commands.ts,exit.ts}; sim/lost-exit.ts; sim/scenarios/GH-6.*; sim/kernel/recover.test.ts;
  tools/architecture/connector-callers.test.ts                                                               Task 15
docs/progress_tracker.md, docs/architecture.md, docs/PRD.md                                                 Task 16
```

---

### Task 1: The words and the read-model tables

**Requirements:** GH-2 (the six tables keyed on the GitHub id, each with a classification and a freshness timestamp); the step-2 carry (index `webhook_deliveries.received_at`); the step-4 carry (`packages/db/schema-github.ts`).

**Files:**
- Modify: `CONTEXT.md`
- Create: `packages/db/schema-github.ts`
- Modify: `packages/db/schema.ts` (re-export), `packages/db/schema-platform.ts` (the index), `packages/db/checks.ts` (two patterns)
- Create: `packages/db/migrations/0013_github_read_model.sql` and its snapshot (generated)
- Test: `packages/db/github-tables.test.ts`

**Interfaces:**
- Produces: Drizzle tables `ghRepos`, `ghIssues`, `ghMilestones`, `ghPrs`, `ghCheckRuns`, `ghReviews` (exported from `@uw/db/schema`); constants `githubIssueStates`, `githubPullRequestStates`, `githubCheckStatuses`, `githubReviewStates` (exported from `packages/db/schema-github.ts`); `REPOSITORY_PATTERN` and `FULL_SHA_PATTERN` in `packages/db/checks.ts`.

- [ ] **Step 1: Add the words to `CONTEXT.md`** (its own commit, before any code)

Add, in the file's existing entry format, under the harness words: **GitHub facts** (what GitHub says about a PR, its head, its checks and reviews, read from the read model, never from an agent; _Avoid_: PR status, CI result), **Read model** (the six `gh_*` tables, one row per GitHub id, written by one module from webhooks and the sweep; _Avoid_: cache, mirror), **Sweep** (the nightly repair that re-reads GitHub from a watermark through the same upsert path), **PR declaration** (the fenced `harness` block in a PR body: `closes`, `risks`, `touches`, `risk_tier`, `risk_domains`), **Reviewer identity** (a GitHub login listed as a Reviewer; only its reviews on the head count), **Cross-reference comment** (the one comment the harness leaves on an imported issue).

```bash
git add CONTEXT.md
git commit -m "docs(context): the words for GitHub facts, the read model, the sweep, the PR declaration, Reviewer identities and the cross-reference comment" -m "Shared root CONTEXT.md: rule 1, new words first." -m "GH-2 GH-3 GH-5"
```

- [ ] **Step 2: Write the failing test** `packages/db/github-tables.test.ts`

On `databaseTargets` (both the embedded Postgres and the server), in `describe('GH-2 the read-model tables', …)`:
- each of the six tables is declared with classification `internal` and offline eligibility `cache_readonly` (read through `tableEntries(schema)` as `packages/db/declarations.test.ts` does);
- inserting the same `gh_prs` row twice with `onConflictDoUpdate` on `github_id` leaves one row with the second values (keyed on the GitHub id);
- `gh_prs.head_sha` refuses `abc123` and `ABC…` (uppercase 40) and accepts 40 and 64 lowercase hex; `gh_check_runs.conclusion` refuses `green`; `gh_reviews.state` refuses `pending`; `gh_repos.full_name` refuses `no-slash`;
- `gh_repos` refuses a second row whose `full_name` differs only in case (`gh_repos_full_name_once`);
- `gh_prs` refuses two rows with the same `(repo_id, number)`;
- `gh_prs` refuses a row with both `declaration` and `declaration_problem` set;
- `pg_indexes` lists `webhook_deliveries_received_at` on `webhook_deliveries(received_at)`.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run packages/db/github-tables.test.ts`
Expected: FAIL (the tables do not exist).

- [ ] **Step 3: Add the patterns to `packages/db/checks.ts`**

```ts
export const REPOSITORY_PATTERN = '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$';
export const FULL_SHA_PATTERN = '^([0-9a-f]{40}|[0-9a-f]{64})$';
```

- [ ] **Step 4: Write `packages/db/schema-github.ts`**

```ts
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, text, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { checkConclusionSchema } from '@uw/contracts';
import { FULL_SHA_PATTERN, REPOSITORY_PATTERN, matches, oneOf } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';

export const githubIssueStates = ['open', 'closed'] as const;
export const githubPullRequestStates = ['open', 'closed', 'merged'] as const;
export const githubCheckStatuses = ['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'] as const;
export const githubReviewStates = ['approved', 'changes_requested', 'commented', 'dismissed'] as const;

const readModel = { classification: 'internal', offlineEligibility: 'cache_readonly' } as const;
const githubId = (name: string) => bigint(name, { mode: 'number' });

export const ghRepos = declareTable(
  'gh_repos',
  {
    githubId: githubId('github_id').primaryKey(),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch').notNull(),
    private: boolean('private').notNull(),
    sweptThrough: instant('swept_through'),
    lastSweep: jsonb('last_sweep'),
    freshAt: instant('fresh_at').notNull(),
  },
  readModel,
  (t) => [
    check('gh_repos_full_name_form', matches(t.fullName, REPOSITORY_PATTERN)),
    uniqueIndex('gh_repos_full_name_once').on(sql`lower(${t.fullName})`),
  ],
);

export const ghMilestones = declareTable(
  'gh_milestones',
  {
    githubId: githubId('github_id').primaryKey(),
    repoId: githubId('repo_id').notNull().references(() => ghRepos.githubId),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    state: text('state').notNull(),
    dueOn: instant('due_on'),
    githubUpdatedAt: instant('github_updated_at').notNull(),
    freshAt: instant('fresh_at').notNull(),
  },
  readModel,
  (t) => [
    unique('gh_milestones_repo_number').on(t.repoId, t.number),
    check('gh_milestones_state_known', oneOf(t.state, githubIssueStates)),
  ],
);
```

Write `ghIssues` (`github_id` PK, `repo_id` FK, `number`, `title`, `state` in `githubIssueStates`, `labels text[] NOT NULL DEFAULT '{}'`, `milestone_id bigint` with no FK so a milestone may arrive later, `github_updated_at`, `xref_claimed_at` instant null, `xref_comment_id bigint` null, `fresh_at`; unique `(repo_id, number)` as `gh_issues_repo_number`), `ghPrs` (`github_id` PK, `repo_id` FK, `number`, `title`, `state` in `githubPullRequestStates`, `draft boolean`, `head_sha` matching `FULL_SHA_PATTERN`, `head_ref text`, `base_ref text`, `milestone_id bigint` null, `declaration jsonb` null, `declaration_problem text` null, `files jsonb` null, `files_head text` null matching `FULL_SHA_PATTERN`, `files_problem text` null, `github_updated_at`, `fresh_at`; unique `(repo_id, number)` as `gh_prs_repo_number`; CHECK `gh_prs_one_declaration_outcome`: `declaration IS NULL OR declaration_problem IS NULL`), `ghCheckRuns` (`github_id` PK, `repo_id` FK, `head_sha` matching `FULL_SHA_PATTERN`, `name text`, `app_slug text` null, `status` in `githubCheckStatuses`, `conclusion` null or in `checkConclusionSchema.options`, `started_at` and `completed_at` instants null, `fresh_at`; index `gh_check_runs_head` on `(repo_id, head_sha)`), `ghReviews` (`github_id` PK, `repo_id` FK, `pr_id bigint NOT NULL REFERENCES gh_prs(github_id)`, `reviewer_login text`, `commit_id` matching `FULL_SHA_PATTERN`, `state` in `githubReviewStates`, `provider text` null, `submitted_at` instant null, `fresh_at`; index `gh_reviews_pr` on `pr_id`). `oneOf` takes a nullable column the way `harness_items_claimant_kind_known` does (NULL passes a CHECK).

In `packages/db/schema.ts` add `export * from './schema-github.ts';` beside the platform re-export. In `schema-platform.ts` add `index('webhook_deliveries_received_at').on(t.receivedAt)` to `webhookDeliveries`'s extras.

- [ ] **Step 5: Generate the migration**

Run: `pnpm db:generate --name github_read_model`
Expected: `packages/db/migrations/0013_github_read_model.sql` and `meta/0013_snapshot.json`; `tools/db/drift.test.ts` passes.

- [ ] **Step 6: Run the test**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run packages/db/github-tables.test.ts`
Expected: PASS on both targets.

- [ ] **Step 7: Verify and commit** (schema and migration in their own commit, then the test)

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/db/schema-github.ts packages/db/schema.ts packages/db/schema-platform.ts packages/db/checks.ts packages/db/migrations
git commit -m "feat(db): the six gh_* read-model tables in schema-github.ts and an index on webhook_deliveries.received_at" -m "Shared root packages/db/schema*.ts and migration 0013: GH-2 needs its tables keyed on the GitHub id; the step-2 carry indexes received_at before GH-2 traffic." -m "GH-2"
git add packages/db/github-tables.test.ts
git commit -m "test(db): the read-model tables are keyed on the GitHub id, classified, and refuse malformed facts" -m "GH-2"
```

---

### Task 2: A harness names its repository

**Requirements:** GH-6 (SECURITY carry: harnesses gain a repository field), GH-5 (the facts' repository must be the harness's).

**Files:**
- Modify: `packages/contracts/harness.ts`, `packages/contracts/event-evidence.ts`, `packages/contracts/registry.ts`, `packages/contracts/version.ts`, `packages/contracts/contract-lock.json`, `packages/contracts/fixtures/**` (harness and `template_activated` fixtures), `apps/uw-app/package.json`, `apps/uw-ingest/package.json`
- Modify: `packages/db/schema.ts`; Create: `packages/db/migrations/0014_harness_repository.sql` (generated)
- Modify: `packages/harness/ports.ts`, `packages/db/store/harnesses.ts`, `packages/db/store/rows.ts`, `packages/db/store/types.ts` (if it re-declares the gateway), `packages/harness/port-contracts/store-gateways.ts`, `packages/harness/port-contracts/store-gateway-fixtures.ts`
- Modify: `packages/harness/stages/activate.ts`, `sim/fixtures.ts`, every caller of `kernel.stages.activate` (grep `stages.activate(`)
- Test: `packages/db/harness-repository.test.ts`, `sim/kernel/harness-repository.test.ts`

**Interfaces:**
- Consumes: `REPOSITORY_PATTERN` (Task 1).
- Produces: `repositorySchema` (exported from `@uw/contracts`); `Harness.repository: string | null`; `ActivateInput.repository: string | null`; `HarnessesGateway.read.byRepository(repository: string): Promise<Harness | null>` (case-insensitive); `template_activated` evidence `{ template, stages, repository }`; `createSimHarness(world, template, { key?, jdArea?, repository? })` defaulting `repository` to `'unfoldingWord/uw-platform'` for `software` and `null` for `bml`.

- [ ] **Step 1: Write the failing tests**

`sim/kernel/harness-repository.test.ts`, `describe('GH-6 a harness names its repository', …)`: activating `software` with `repository: 'unfoldingWord/uw-platform'` stores it and records it on `template_activated`; `tx.harnesses.read.byRepository('UnfoldingWord/UW-Platform')` finds it; `byRepository('unfoldingWord/other')` is null; activating a second harness with `repository: 'UNFOLDINGWORD/uw-platform'` is refused `harness_exists` with detail `{ repository }`; `bml` activates with `repository: null`; an `ActivateInput` repository of `no-slash` is refused `malformed_command`.

`packages/db/harness-repository.test.ts` on `databaseTargets`, `describe('GH-6 the harnesses repository column', …)`: a malformed repository is refused by `harnesses_repository_form`; two harnesses whose repositories differ only in case are refused by `harnesses_repository_once`; two harnesses with null repositories are both accepted.

Run each: `pnpm vitest run sim/kernel/harness-repository.test.ts` then `TEST_DATABASE_URL=… pnpm vitest run packages/db/harness-repository.test.ts`
Expected: FAIL.

- [ ] **Step 2: Contracts (7.0.0, its own commit)**

In `packages/contracts/harness.ts`:

```ts
export const repositorySchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'a repository is owner/name');

export const pullRequestRefSchema = z.strictObject({
  repo: repositorySchema,
  number: z.number().int().min(1),
});
```

and add `repository: repositorySchema.nullable()` to `harnessSchema`. In `event-evidence.ts` `template_activated` gains `repository: repositorySchema.nullable()`. Update the fixtures (every valid harness and `template_activated` fixture gains `repository`; add an invalid one with `repository: 'no-slash'`), `CONTRACT_VERSION = '7.0.0'`, the lock entry and both apps' `contractVersion`.

```bash
git add packages/contracts apps/uw-app/package.json apps/uw-ingest/package.json
git commit -m "feat(contracts)!: a harness names its repository (7.0.0)" -m "Shared root packages/contracts: harnessSchema gains a required repository and template_activated records it, so the ship path and the merge connector can refuse another repository's PR." -m "GH-6 GH-5 CT-3"
```

- [ ] **Step 3: Schema and migration (its own commit)**

`harnesses` gains `repository: text('repository')` with `check('harnesses_repository_form', matches(t.repository, REPOSITORY_PATTERN))` (a NULL passes a CHECK) and a unique index `harnesses_repository_once` on the expression `lower(repository)` where `repository IS NOT NULL`, written the way `delegations_supersedes_once` writes its partial index, with `sql` for the expression. Run `pnpm db:generate --name harness_repository`.

```bash
git add packages/db/schema.ts packages/db/migrations
git commit -m "feat(db): harnesses carry a repository, unique case-insensitively" -m "Shared root packages/db/schema.ts and migration 0014." -m "GH-6"
```

- [ ] **Step 4: The port (its own commit)**

`HarnessesGateway.read` gains `byRepository(repository: string): Promise<Harness | null>`.

```bash
git add packages/harness/ports.ts
git commit -m "feat(harness): the harnesses gateway finds a harness by its repository" -m "Shared root packages/harness/ports.ts: the import and the ship path resolve a harness from a GitHub repository." -m "GH-6 GH-3"
```

- [ ] **Step 5: Implement**

- `packages/db/store/rows.ts` `toHarness` maps `repository`; `harnesses.ts` `byRepository` selects `WHERE lower(repository) = lower($1)`; `insert` writes it.
- `port-contracts/store-gateways.ts`: a DX-3 case that `byRepository` is case-insensitive and null for an unknown repository; the gateway fixtures' harness gains `repository`.
- `stages/activate.ts`: `ActivateInput` gains `repository: string | null`; refuse `malformed_command` `{ repository }` when it fails `repositorySchema`; inside `insertAll`, after the existing `taken` check, `if (input.repository !== null && (await tx.harnesses.read.byRepository(input.repository)) !== null) return refused('harness_exists', { repository: input.repository })`; the harness row and `template_activated` carry it.
- `sim/fixtures.ts` `createSimHarness` passes the default above. Update every other `stages.activate(` caller (grep) to pass `repository`.

- [ ] **Step 6: Run the tests**

Run the two test files from Step 1 (one at a time). Expected: PASS.

- [ ] **Step 7: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/db/store packages/harness/stages packages/harness/port-contracts sim apps packages/db/harness-repository.test.ts
git commit -m "feat(harness): template activation records the harness's repository and refuses a repository another harness holds" -m "GH-6 GH-5"
```

---

### Task 3: The PR declaration, Reviewer identities and the identifiers GitHub hands us

**Requirements:** GH-5 (P16: the fenced `harness` block parsed into a contract schema; reviewer and provider ids normalised or counted as zero; SHAs lowercased, abbreviated heads rejected).

**Files:**
- Create: `packages/contracts/github.ts`; Modify: `packages/contracts/index.ts`, `registry.ts`, `version.ts`, `contract-lock.json`, `fixtures/pull_request_declaration/{valid,invalid}/*.json`, both apps' `package.json`
- Create: `packages/harness/github/identifiers.ts`, `packages/harness/github/declaration.ts`, `packages/harness/github/reviewers.ts`
- Modify: `packages/harness/ship-rule.ts` (use `normalisedIdentifier`), `packages/harness/risk/protected-directories.ts`
- Test: `packages/harness/github/identifiers.test.ts`, `packages/harness/github/declaration.test.ts`, `packages/harness/github/reviewers.test.ts`, `packages/harness/risk/risk.test.ts` (two new protected paths)

**Interfaces:**
- Produces:
  - `pullRequestDeclarationSchema`, `type PullRequestDeclaration = { closes: string[]; risks: string; touches: string; riskTier: RiskTier; riskDomains: RiskDomain[] }` from `@uw/contracts`.
  - `normalisedIdentifier(value: string): string | null`, `fullSha(value: string): string | null`, `sameRepository(a: string, b: string | null): boolean`, `branchFor(itemId: string): string` from `packages/harness/github/identifiers.ts`.
  - `parseDeclaration(body: string | null): DeclarationParse`, `type DeclarationParse = { readonly ok: true; readonly declaration: PullRequestDeclaration } | { readonly ok: false; readonly problem: DeclarationProblem }`, `type DeclarationProblem = 'missing' | 'duplicate_block' | 'unclosed_block' | 'unknown_key' | 'duplicate_key' | 'missing_key' | 'invalid_value'`, `riskDeclarationOf(declaration: PullRequestDeclaration | null): RiskDeclaration | null`, `parseReviewProvider(body: string | null): string | null` from `packages/harness/github/declaration.ts`.
  - `reviewerIdentities: readonly ReviewerIdentity[]`, `type ReviewerIdentity = { readonly login: string; readonly reviewer: string }`, `reviewerOf(login: string): string | null` from `packages/harness/github/reviewers.ts`.
  - Nothing new is exported from the `@uw/harness` index in this task (knip: no consumer yet). Task 8 exports `parseDeclaration`, `parseReviewProvider`, `fullSha` and `sameRepository` from it when its normaliser and the merge connector consume them.

- [ ] **Step 1: Write the failing tests**

`declaration.test.ts`, `describe('GH-5 the PR declaration is parsed from the fenced harness block', …)`, one `it` per case, each asserting the exact `DeclarationParse`:

````ts
const body = [
  '```harness',
  'closes: #12, unfoldingWord/uw-platform#14',
  'risks: the board renders slower on phones',
  'touches: apps/uw-app/board',
  'risk_tier: standard',
  'risk_domains: none',
  '```',
  '',
  'Adds the board.',
].join('\n');
````

- that body parses to `{ closes: ['#12', 'unfoldingWord/uw-platform#14'], risks: 'the board renders slower on phones', touches: 'apps/uw-app/board', riskTier: 'standard', riskDomains: [] }`;
- the same body with `\r\n` line endings parses the same;
- `risk_domains: acl, migration` parses to `['acl', 'migration']` in schema order whatever the written order; `risk_domains: acl, acl` is `invalid_value`;
- `closes: none` parses to `[]`; `closes: 12` is `invalid_value`;
- no block (`null`, `''`, a body without the fence) is `missing`; a `` ```harnessx `` fence is not a block (`missing`);
- two `harness` blocks is `duplicate_block`; no closing fence is `unclosed_block`;
- an unknown key (`owner: me`) is `unknown_key`; `risk_tier` twice is `duplicate_key`; no `touches` line is `missing_key`; `risk_tier: medium` is `invalid_value`; a line without `: ` is `invalid_value`.

`parseReviewProvider`: a body holding the lines `` ```harness-review ``, `provider: Anthropic`, `model: claude`, `` ``` `` gives `anthropic`; with `provider: Google Vertex` it gives null; a body with no such block gives null.

`identifiers.test.ts`, `describe('GH-5 identifiers from GitHub are normalised or count as nothing', …)`: `normalisedIdentifier('  UW-Reviewer ')` is `uw-reviewer`; `'ｕｗ-reviewer'` (fullwidth) is `uw-reviewer` after NFKC; `'uw reviewer'`, `''` and `'uw-reviewer[bot]'` are null; `fullSha('ABC…40')` lowercases; `fullSha('abc123')` and a 41-character value are null; a 64-character value is accepted; `sameRepository('UnfoldingWord/UW-Platform', 'unfoldingWord/uw-platform')` is true, against `null` is false; `branchFor(id)` is `harness/<id>`.

`reviewers.test.ts`, `describe('GH-5 only listed Reviewer identities are reviewers', …)`: `reviewerOf('uw-reviewer[bot]')` is `uw-reviewer`, `reviewerOf('UW-Reviewer[bot]')` is `uw-reviewer`, `reviewerOf('uw-reviewer-codex[bot]')` is `uw-reviewer-codex`, `reviewerOf('uw-reviewer')` (a user, not the bot) and `reviewerOf('octocat')` are null; every listed `reviewer` passes `normalisedIdentifier` unchanged and the logins are distinct.

`risk.test.ts`: `domainOf('packages/harness/github/reviewers.ts')` and `domainOf('apps/uw-app/github/merge.ts')` are `acl`.

Run each with `pnpm vitest run <file>`. Expected: FAIL (modules missing).

- [ ] **Step 2: The contract (7.1.0, its own commit)**

`packages/contracts/github.ts`:

```ts
import { z } from 'zod';
import { riskDomainsSchema, riskTierSchema } from './closed-sets.ts';

export const issueReferenceSchema = z
  .string()
  .regex(/^(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#[1-9][0-9]{0,9}$/, 'an issue reference is #N or owner/name#N');

export const pullRequestDeclarationSchema = z.strictObject({
  closes: z.array(issueReferenceSchema),
  risks: z.string().min(1).max(500),
  touches: z.string().min(1).max(500),
  riskTier: riskTierSchema,
  riskDomains: riskDomainsSchema,
});

export type PullRequestDeclaration = z.infer<typeof pullRequestDeclarationSchema>;
```

Export from `index.ts`, register `pull_request_declaration` in `schemaRegistry`, add valid fixtures (the parsed body above; one with `closes: []` and `riskDomains: ['acl','migration']`) and invalid ones (`riskTier: 'medium'`, `closes: ['12']`, an extra key). `CONTRACT_VERSION = '7.1.0'`, lock entry, both apps.

```bash
git add packages/contracts apps/uw-app/package.json apps/uw-ingest/package.json
git commit -m "feat(contracts): the PR declaration's parsed shape (7.1.0)" -m "Shared root packages/contracts: P16 makes the fenced harness block a contract schema." -m "GH-5 CT-3"
```

- [ ] **Step 3: Implement the three modules**

`identifiers.ts`:

```ts
const identifier = /^[a-z0-9._-]+$/u;
const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export function normalisedIdentifier(value: string): string | null {
  const folded = value.normalize('NFKC').trim().toLowerCase();
  return identifier.test(folded) ? folded : null;
}

export function fullSha(value: string): string | null {
  const folded = value.trim().toLowerCase();
  return sha.test(folded) ? folded : null;
}

export function sameRepository(a: string, b: string | null): boolean {
  return b !== null && a.toLowerCase() === b.toLowerCase();
}

export function branchFor(itemId: string): string {
  return `harness/${itemId}`;
}
```

`ship-rule.ts` replaces its private `normalised` with `normalisedIdentifier` (one definition).

`reviewers.ts`:

```ts
export type ReviewerIdentity = { readonly login: string; readonly reviewer: string };

export const reviewerIdentities: readonly ReviewerIdentity[] = [
  { login: 'uw-reviewer[bot]', reviewer: 'uw-reviewer' },
  { login: 'uw-reviewer-codex[bot]', reviewer: 'uw-reviewer-codex' },
];

const byLogin: ReadonlyMap<string, string> = new Map(
  reviewerIdentities.map((entry) => [entry.login.toLowerCase(), entry.reviewer]),
);

export function reviewerOf(login: string): string | null {
  return byLogin.get(login.normalize('NFKC').trim().toLowerCase()) ?? null;
}
```

`declaration.ts`: split the body on `/\r?\n/`; find every index whose line is exactly `` ```harness `` (after trimming trailing whitespace); zero is `missing`, more than one is `duplicate_block`; collect lines until a line that is exactly `` ``` ``, none is `unclosed_block`; skip blank lines; each line must match `^([a-z_]+): (.*)$` (else `invalid_value`); keys must be in the `Map` of five key readers (else `unknown_key`), each seen once (else `duplicate_key`), all five present (else `missing_key`); `closes` and `risk_domains` read `none` as `[]`, else split on `,` and trim; `risk_domains` values must be distinct; build the object and `pullRequestDeclarationSchema.safeParse` it (failure is `invalid_value`), sorting `riskDomains` into `riskDomainSchema.options` order. `riskDeclarationOf` maps to `{ riskTier, riskDomains }` or null. `parseReviewProvider` finds the single `` ```harness-review `` block the same way and returns `normalisedIdentifier` of its `provider` value, or null on any problem. Keep each function under the lint limits by splitting block-finding, line-reading and assembling into separate functions.

Add `{ path: 'packages/harness/github/', domain: 'acl' }` and `{ path: 'apps/uw-app/github/', domain: 'acl' }` to `protectedDirectories`.

- [ ] **Step 4: Run the tests**

Run each Step 1 file, then `pnpm vitest run packages/harness/ship-rule.test.ts`. Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness
git commit -m "feat(harness): parse the PR declaration and the review provider, list the Reviewer identities, and normalise GitHub identifiers" -m "GH-5"
```

---

### Task 4: The facts the gate reads, and the assembler that is the rule's only caller

**Requirements:** GH-5 (an assembler builds the ship rule's inputs from GitHub facts at evaluation time and is the rule's only caller outside its tests; approval is a review by a Reviewer identity on the head; a review on an older commit, by another identity, or a value planted on the item does not count; paths from the facts at the head), GH-4 (Builder work lands on `harness/<item>`), GH-6 (another repository's PR is refused at Ship).

**Files:**
- Modify: `packages/harness/ports.ts` (its own commit)
- Modify: `packages/harness/gates/ship-input.ts`, `packages/harness/gates/approve-at-ship.ts`, `packages/harness/kernel.ts`, `packages/harness/port-contracts/github-facts.ts`, `tools/architecture/connector-callers.test.ts`
- Modify: `sim/adapters/github-facts.ts`, `sim/ship-fixtures.ts`, `apps/uw-app/testing/kernel.ts` (`fixedFacts`), and every test and scenario that builds `PullRequestFacts`, `CheckFact` or `ReviewFact` or uses a short head (grep `greenFacts(`, `approvedBy(`, `headSha:`, `'abc123'`, `'def456'`): `sim/scenarios/KN-11.*`, `KN-12.*`, `KN-13.*`, `KN-17.*`, `sim/kernel/{submit,connector-exit,gate-command,exit-guard}.test.ts`, `sim/adapters/recording-adapters.test.ts`, `packages/harness/{gates/ship-input,ship-rule,items/fold}.test.ts`, `packages/harness/port-contracts/store-gateways.ts`, `tools/properties/submit-human-gate.test.ts`, `apps/uw-app/mcp/{harness-verbs,submit-human-gate}.pg.test.ts`, `apps/uw-app/harness/grant-race.pg.test.ts`
- Create: `sim/scenarios/GH-5.only-reviewer-identities-on-the-head-count.ts`
- Test: `packages/harness/gates/ship-input.test.ts` (rewritten)

**Interfaces:**
- Consumes: `reviewerOf`, `normalisedIdentifier`, `fullSha`, `sameRepository`, `branchFor`, `riskDeclarationOf` (Task 3); `Harness.repository` (Task 2).
- Produces (in `ports.ts`):

```ts
export type CheckFact = {
  readonly checkId: number;
  readonly name: string;
  readonly headSha: string;
  readonly app: string | null;
  readonly conclusion: CheckConclusion | null;
};
export type ReviewFact = {
  readonly reviewId: number;
  readonly reviewer: string;
  readonly commit: string;
  readonly state: ReviewState;
  readonly provider: string | null;
  readonly submittedAt: Date | null;
};
export type ChangedFiles = { readonly head: string; readonly paths: readonly string[] };
export type PullRequestFacts = {
  readonly ref: PullRequestRef;
  readonly state: PullRequestState;
  readonly draft: boolean;
  readonly head: string;
  readonly headRef: string;
  readonly checks: readonly CheckFact[];
  readonly reviews: readonly ReviewFact[];
  readonly files: ChangedFiles | null;
  readonly declaration: PullRequestDeclaration | null;
  readonly freshAt: Date;
};
```

  `ReviewFact.reviewer` is the GitHub login as GitHub sent it. `PullRequestDeclaration` is imported from `@uw/contracts`.
- Produces: `assembleShipInput(source: ShipInputSource): ShipRuleInput` with `ShipInputSource = { facts: PullRequestFacts | null; item: ItemState; harness: Pick<Harness, 'jdArea' | 'repository'>; approver: Principal; at: Date; override: boolean }`; `GITHUB_ACTIONS_APP = 'github-actions'` (exported, consumed by the test). `riskAtHead(facts, item, head)` is module-private.
- Produces (sim): `simSha(seed: string): string`; `greenFacts(world, input: { itemId: string; head: string; reviews: readonly ReviewFact[]; ref?: PullRequestRef; paths?: readonly string[]; declaration?: PullRequestDeclaration | null }): PullRequestFacts` (checks are the six CI jobs from `github-actions`, `headRef: harness/<itemId>`, `files: { head, paths }` with `paths` defaulting to `['apps/uw-app/board.tsx']`, `declaration` defaulting to a `standard` declaration); `approvedBy(login: string, provider: string | null, commit: string, reviewId: number, submittedAt?: Date): ReviewFact`; the reviewer logins used in fixtures are `uw-reviewer[bot]` and `uw-reviewer-codex[bot]`.

- [ ] **Step 1: Write the failing tests**

Rewrite `ship-input.test.ts` with `describe('GH-5 the assembler builds the ship rule input from GitHub facts', …)` cases over a fixture item (`expectedHead` and `pullRequest` set, `riskTier: 'standard'`) and harness (`repository: 'unfoldingWord/uw-platform'`):
- facts for the item's PR at the expected head, six green `github-actions` checks, one approval by `uw-reviewer[bot]` on the head with provider `Anthropic`: the input has `pullRequest: { open: true, draft: false, head }`, six checks, approvals `[{ reviewer: 'uw-reviewer', commit: head, provider: 'anthropic' }]`, `riskTier: 'standard'`, `riskDomains: []`;
- an approval by `octocat` on the head, an approval by `uw-reviewer[bot]` on an older commit, and an item whose title or evidence names an approval: approvals `[]`;
- `uw-reviewer[bot]` approved then `changes_requested` on the head (later `submittedAt`): approvals `[]`; `changes_requested` then `approved`: one approval; `approved` then `commented`: one approval; `approved` then `dismissed`: approvals `[]`;
- a `test` check from app `some-other-app` and no `github-actions` `test`: the checks hold five names; a `failure` `test` (id 1) then a `success` `test` (id 2) on the head: one `test` check, `success`; the reverse order: `failure`;
- uppercase `head` and `headSha` in the facts: everything lowercased;
- facts for another repository (`unfoldingWord/other`), facts whose `headRef` is `feature/x`, facts whose head is `abc123`, and a harness with `repository: null`: `pullRequest: null`, `checks: []`, `approvals: []`, `riskTier: null`;
- files at the head touching `packages/db/migrations/0013.sql` with a `low` declaration: `riskTier: 'high'`, `riskDomains: ['migration']`; a rename whose previous name is `infra/x.toml` (the read model puts both names in `paths`): domains include `infra`;
- files known for an older head only, or `files: null`, or `declaration: null`: `riskTier: null`;
- an item already ratcheted to `high` with `['acl']` and facts declaring `standard` over harmless paths: `riskTier: 'high'`, `riskDomains: ['acl']`.

Run: `pnpm vitest run packages/harness/gates/ship-input.test.ts`
Expected: FAIL (type errors and wrong values).

In `tools/architecture/connector-callers.test.ts` add `describe('GH-5 the assembler is the ship rule's only caller', …)`: `assembleShipInput(` appears in non-test sources only in `packages/harness/gates/approve-at-ship.ts` and `ship-input.ts`, and `shipRule(` only in `approve-at-ship.ts` and `ship-rule.ts` (the existing check, retitled under this describe); a planted `kernel.shipRule(` or `shipRule(` call in `apps/uw-app/x.ts` is flagged.

Write `sim/scenarios/GH-5.only-reviewer-identities-on-the-head-count.ts`: park an item at Ship (`simParkedAtShip`), give facts whose only approval is by `octocat`, approve: refused `no_reviewer_approval`, `ship_refused` recorded, no connector call; give facts with `uw-reviewer[bot]` on an older commit: refused again; give facts with `uw-reviewer[bot]` on the head: approve accepted, one connector call, one `gate_decisions` row. `state` reports the decisions and the connector call count.

- [ ] **Step 2: Change the port (its own commit)**

Edit `ports.ts` to the shapes in Interfaces.

```bash
git add packages/harness/ports.ts
git commit -m "feat(harness)!: GitHub facts carry the head ref, the changed files at a head, the parsed declaration, and each check's app and each review's id and time" -m "Shared root packages/harness/ports.ts: GH-5's assembler needs them to count only Reviewer identities and CI checks on the head and to derive risk from GitHub, not from the agent." -m "GH-5 GH-4"
```

- [ ] **Step 3: Implement the assembler**

`ship-input.ts` (keep each function under the limits):

```ts
export const GITHUB_ACTIONS_APP = 'github-actions';

const decisive: ReadonlySet<ReviewState> = new Set<ReviewState>(['approved', 'changes_requested', 'dismissed']);
const ciJobs: ReadonlySet<string> = new Set(ciJobSchema.options);

function usableHead(facts: PullRequestFacts | null, item: ItemState, harness: ShipHarness): string | null {
  if (facts === null || item.pullRequest === null) return null;
  if (!sameRepository(facts.ref.repo, harness.repository)) return null;
  if (!sameRepository(facts.ref.repo, item.pullRequest.repo) || facts.ref.number !== item.pullRequest.number) return null;
  if (facts.headRef !== branchFor(item.itemId)) return null;
  return fullSha(facts.head);
}

function latestChecks(facts: PullRequestFacts, head: string): ShipRuleInput['checks'] {
  const latest = new Map<string, CheckFact>();
  for (const check of facts.checks) {
    if (fullSha(check.headSha) !== head || check.app !== GITHUB_ACTIONS_APP || !ciJobs.has(check.name)) continue;
    const seen = latest.get(check.name);
    if (seen === undefined || check.checkId > seen.checkId) latest.set(check.name, check);
  }
  return [...latest.values()].map((check) => ({ name: check.name, headSha: head, conclusion: check.conclusion }));
}

function later(a: ReviewFact, b: ReviewFact): boolean {
  const at = (review: ReviewFact) => review.submittedAt?.getTime() ?? 0;
  return at(a) === at(b) ? a.reviewId > b.reviewId : at(a) > at(b);
}

function approvalsOn(facts: PullRequestFacts, head: string): ShipRuleInput['approvals'] {
  const latest = new Map<string, ReviewFact>();
  for (const review of facts.reviews) {
    const reviewer = reviewerOf(review.reviewer);
    if (reviewer === null || fullSha(review.commit) !== head || !decisive.has(review.state)) continue;
    const seen = latest.get(reviewer);
    if (seen === undefined || later(review, seen)) latest.set(reviewer, review);
  }
  return [...latest.entries()]
    .filter(([, review]) => review.state === 'approved')
    .map(([reviewer, review]) => ({
      reviewer,
      commit: head,
      provider: review.provider === null ? null : normalisedIdentifier(review.provider),
    }));
}

function riskAtHead(facts: PullRequestFacts, item: ItemState, head: string): Pick<ShipRuleInput, 'riskTier' | 'riskDomains'> {
  const held = { tier: item.riskTier, domains: item.riskDomains };
  if (facts.files === null || fullSha(facts.files.head) !== head) return { riskTier: null, riskDomains: [...item.riskDomains] };
  const floor = carryForward(floorFromPaths(facts.files.paths), held);
  const result = applyDeclaration(floor, riskDeclarationOf(facts.declaration));
  return { riskTier: result.ok ? result.tier : null, riskDomains: [...result.domains] };
}
```

`assembleShipInput` puts these together: with no usable head, `pullRequest: null`, `checks: []`, `approvals: []`, `riskTier: null`, `riskDomains: [...item.riskDomains]`; otherwise `pullRequest: { open: facts.state === 'open', draft: facts.draft, head }`. `expectedHead` is `fullSha(item.expectedHead)` or null; `area` is `harness.jdArea`. 

`approve-at-ship.ts` passes `harness: gate.harness` instead of `area`. `kernel.ts` drops the `shipRule` member and its import. (`riskAtHead` takes the head as its third argument and stays private to the module.)

- [ ] **Step 4: Update the adapters, fixtures and every caller**

- `sim/adapters/github-facts.ts`: `keyOf` lowercases the repository; the stored facts are the new shape.
- `port-contracts/github-facts.ts`: `factsFor` builds the new shape (a `github-actions` check with `checkId`, a review with `reviewId` and `submittedAt`, `headRef: 'harness/b1000000-0000-4000-8000-000000000002'`, `files: { head, paths: ['apps/uw-app/board.tsx'] }`, a declaration); add DX-3 cases: the facts round-trip `files`, `declaration`, `headRef`, `checkId`, `app`, `reviewId` and `submittedAt` exactly; a repository asked in another case (`UnfoldingWord/UW-Platform`) answers the same facts.
- `sim/ship-fixtures.ts`: add `simSha`, change `greenFacts` and `approvedBy` to the Interfaces signatures; `shipPullRequest` stays; `standardChange.head` becomes `simSha('abc123')`.
- Update every listed test and scenario to the new shapes and full SHAs (`simSha('abc123')`, `simSha('def456')`, or `'a'.repeat(40)` in package tests), the registered reviewer logins, and `headRef: harness/<itemId>`. Keep every existing assertion's meaning; where a test asserted that a planted approval counts, it now asserts the registered login counts.

- [ ] **Step 5: Run the tests**

Run `pnpm vitest run packages/harness/gates/ship-input.test.ts`, then `pnpm sim -- GH-5`, then `pnpm sim -- all`. Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS, including `tools/architecture/connector-callers.test.ts` (the ship rule called only from `approve-at-ship.ts`).

```bash
git add packages/harness sim apps tools
git commit -m "feat(harness): the assembler counts only Reviewer identities and CI checks on the head, on the harness's repository and the item's branch, and re-derives risk from the files at the head" -m "GH-5 GH-4 GH-6 KN-11 KN-17"
```

---

### Task 5: Submit takes its paths and declaration from GitHub, never from the agent

**Requirements:** GH-5 (SECURITY carry: changed-file paths for risk derivation come from GitHub facts at the head, renames included, never from the submitting agent; the declaration from the PR body; abbreviated heads rejected), GH-6 (submit refuses another repository's PR), GH-4 (the item records the expected head at `submit_to_gate`; a later submit replaces it).

**Files:**
- Modify: `packages/contracts/ship-rule.ts` (`fullShaPattern`, `fullShaSchema`), `packages/contracts/harness.ts` (`expectedHead`), `packages/contracts/verb-io.ts` (`submit_to_gate.input.head`), `packages/contracts/event-evidence.ts` (`submitted_to_gate.expectedHead`, `branch_abandoned.head`, `branch_adopted.head`), fixtures, `version.ts`, `contract-lock.json`, both apps' `package.json`
- Modify: `packages/db/checks.ts` (`FULL_SHA_PATTERN` reuses `fullShaPattern`)
- Create: `packages/harness/gates/facts-failure.ts` (moves `factsFailure` out of `approve-at-ship.ts`)
- Modify: `packages/harness/items/submit.ts`, `packages/harness/items/commands.ts` (ports gain `githubFacts`), `packages/harness/gates/approve-at-ship.ts`
- Modify: `apps/uw-app/mcp/verbs/submit-to-gate.ts`, `sim/ship-fixtures.ts`, `sim/scenarios/KN-17.*`, `sim/kernel/submit.test.ts`, `tools/properties/submit-human-gate.test.ts`, `apps/uw-app/mcp/{harness-verbs,submit-human-gate}.pg.test.ts`
- Test: `sim/kernel/submit-facts.test.ts`, `apps/uw-app/mcp/submit-facts.pg.test.ts`

**Interfaces:**
- Consumes: `floorFromPaths`, `carryForward`, `applyDeclaration` (`packages/harness/risk/derive.ts`), `riskDeclarationOf`, `fullSha`, `sameRepository` (Task 3), imported by module path inside the harness.
- Produces: `SubmitChange = { readonly pullRequest: PullRequestRef; readonly head: string }` (the `paths` and `declaration` fields are gone); `fullShaPattern = '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'` and `fullShaSchema` from `@uw/contracts`; `factsFailure(error: unknown): Refused` from `packages/harness/gates/facts-failure.ts`; `ShipChange` in `sim/ship-fixtures.ts` keeps `paths` and `declaration` as fixture data and `submitWithChange` seeds them as facts (`world.adapters.githubFacts.given(greenFacts(world, { itemId, head, reviews: [], paths, declaration }))`) before submitting `{ pullRequest, head }`.

- [ ] **Step 1: Write the failing tests**

`sim/kernel/submit-facts.test.ts`, `describe('GH-5 submit derives risk from GitHub facts at the submitted head', …)`:
- facts at the head with files `['packages/db/migrations/0001.sql']`, previous name `infra/old.toml` included in `paths`, and a `standard` declaration: the submit records `risk_derived` with those `paths`, `riskTier: 'high'`, `riskDomains: ['infra', 'migration']`;
- the same submit when the facts' head is another commit, when `files` is null, or when there are no facts: no `risk_derived`, and the submit still records `submitted_to_gate` with the expected head;
- a submit whose head is `abc123` is `malformed_command` and records nothing; an uppercase full head is stored lowercased;
- a submit whose PR is in `unfoldingWord/other` on a `unfoldingWord/uw-platform` harness is `not_permitted` `{ why: 'repository_mismatch' }`, and on a harness with `repository: null` the same;
- a second submit with a new head replaces `expectedHead` (GH-4);
- a facts port that throws `PortNotWiredError` makes the submit `not_wired` and records nothing.

`apps/uw-app/mcp/submit-facts.pg.test.ts`, `describe('GH-5 submit_to_gate takes no paths or declaration from the agent', …)`: the verb's input schema rejects `paths` and `declaration` as unknown keys (or strips them; assert whichever the schema does and that the kernel never sees them by checking the recorded `risk_derived` is absent with no facts); an abbreviated head is `malformed_command` at the schema.

Run each (the pg one with `TEST_DATABASE_URL`). Expected: FAIL.

- [ ] **Step 2: Contracts (8.0.0, its own commit)**

In `ship-rule.ts`:

```ts
export const fullShaPattern = '^(?:[0-9a-f]{40}|[0-9a-f]{64})$';
export const fullShaSchema = z.string().regex(new RegExp(fullShaPattern), 'a head is a full lowercase commit SHA');
```

`itemStateSchema.expectedHead`, `submitted_to_gate.expectedHead`, `branch_abandoned.head` and `branch_adopted.head` become `fullShaSchema.nullable()`; `submit_to_gate.input.head` becomes `z.string().regex(/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/).nullable()` (the kernel lowercases). Update fixtures (valid ones use full SHAs; add invalid ones with `abc123`), `CONTRACT_VERSION = '8.0.0'`, lock, both apps. `packages/db/checks.ts` sets `FULL_SHA_PATTERN = fullShaPattern` imported from `@uw/contracts` and its `(…|…)` form is replaced by the contract's.

```bash
git add packages/contracts packages/db/checks.ts apps/uw-app/package.json apps/uw-ingest/package.json
git commit -m "feat(contracts)!: heads are full commit SHAs (8.0.0)" -m "Shared root packages/contracts: GH-5 rejects abbreviated heads at the verb, on the item and in the events." -m "GH-5 GH-4 CT-3"
```

- [ ] **Step 3: Implement**

`submit.ts`:
- `SubmitChange` loses `paths` and `declaration`; `SubmitPorts` adds `'githubFacts'`.
- `withNormalisedHead` uses `fullSha` (null is `malformed_command` `{ head }`).
- `submit()` reads the facts before the transaction: `const facts = normalised.change === null ? null : await readFacts(ports, normalised.change.pullRequest)` where `readFacts` catches and returns `factsFailure(error)`; a refusal is returned as is.
- Inside `submitIn`, after the harness is read and before the standing checks: when `input.change !== null && !sameRepository(input.change.pullRequest.repo, harness.repository)`, return `refused('not_permitted', { why: 'repository_mismatch', repository: harness.repository })`.
- `riskDraft(change, item, facts)` returns null unless `facts` matches the change's PR (repository case-insensitive and number), `fullSha(facts.head) === change.head`, and `facts.files` is at that head; otherwise it derives exactly as today with `paths = facts.files.paths` and `declaration = riskDeclarationOf(facts.declaration)`, and records them in the evidence.
- `items/commands.ts` `ItemPorts` adds `'githubFacts'`.

`apps/uw-app/mcp/verbs/submit-to-gate.ts` `changeOf` returns `{ pullRequest, head }`.

Update `sim/ship-fixtures.ts`, `KN-17` and the listed tests to seed facts instead of passing paths and declarations.

- [ ] **Step 4: Run the tests**

Run the two Step 1 files, `pnpm sim -- KN-17`, then `pnpm vitest run tools/properties/submit-human-gate.test.ts`. Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness sim apps tools
git commit -m "feat(harness): submit derives risk from the changed files and declaration GitHub holds at the submitted head and refuses another repository's PR" -m "GH-5 GH-6 GH-4 KN-17"
```

---

### Task 6: The branch an item's work lands on, abandoned and adopted

**Requirements:** GH-4 (on `lease_expired` the kernel records `branch_abandoned`; the next claim starts from the expected head unless it explicitly adopts the abandoned branch, and that choice is an event; work lands on `harness/<item>`).

**Files:**
- Modify: `packages/contracts/verb-io.ts` (`claim_item`), `packages/contracts/verb-fixtures/claim_item/**`, `version.ts`, `contract-lock.json`, both apps' `package.json`
- Modify: `packages/harness/items/claim.ts`, `apps/uw-app/mcp/verbs/claim-item.ts`, every `items.claim(` caller (grep; add `adoptBranch: false`)
- Create: `sim/scenarios/GH-4.an-abandoned-branch-is-adopted-only-by-choice.ts`
- Test: `apps/uw-app/mcp/harness-verbs.pg.test.ts` (one new case)

**Interfaces:**
- Consumes: `branchFor` (Task 3).
- Produces: `ClaimInput = { itemId; delegationId; adoptBranch: boolean }`; `Claimed` gains `branch: ClaimedBranch`, `type ClaimedBranch = { readonly name: string; readonly startFrom: string | null; readonly adopted: boolean }`; `claim_item` input `adoptBranch: z.boolean().default(false)`, output `branch: z.strictObject({ name: z.string().regex(/^harness\/[0-9a-f-]{36}$/), startFrom: fullShaSchema.nullable(), adopted: z.boolean() })`.

- [ ] **Step 1: Write the failing scenario and test**

`GH-4` scenario: arrange as `sim/scenarios/KN-6.a-failing-validator-holds-the-item.ts` does (the software harness with `validators: ['learning_attached']` set on `scope` by the admin through `stages.updateStage`, the item enqueued by an editor and advanced through `package`), so that a submit at `scope` fails its checks and the holder keeps the item; an interactive agent claims it and submits `{ pullRequest: shipPullRequest, head: simSha('a1') }` (result `checks_failed`, `expectedHead` `simSha('a1')`, branch `active`); the clock passes the lease; a second interactive agent of the same person claims with `adoptBranch: false`: the log holds `lease_expired`, `branch_abandoned { head: simSha('a1') }`, `item_claimed`, and the reply's `branch` is `{ name: 'harness/<itemId>', startFrom: simSha('a1'), adopted: false }`; the lease expires again and a third claim with `adoptBranch: true` records `branch_adopted { head: simSha('a1') }` and replies `adopted: true`, `branchState` `active`; a claim with `adoptBranch: true` on an item whose branch is not abandoned is `malformed_command` `{ why: 'no_abandoned_branch' }` and records nothing; a submit with `simSha('b2')` replaces `expectedHead`.

`harness-verbs.pg.test.ts`: `describe('GH-4 claim_item names the branch and the commit to start from', …)` asserting the verb output carries `branch`.

Run: `pnpm sim -- GH-4`. Expected: FAIL.

- [ ] **Step 2: Contract (8.1.0, its own commit)**

```bash
git add packages/contracts apps/uw-app/package.json apps/uw-ingest/package.json
git commit -m "feat(contracts): claim_item may adopt an abandoned branch and names the branch to work on (8.1.0)" -m "Shared root packages/contracts: GH-4's adoption is the claimant's explicit choice." -m "GH-4 CT-3"
```

- [ ] **Step 3: Implement**

In `claim.ts` `takeClaim`: compute `abandoned = item.branchState === 'abandoned' || lapseDrafts(item, at).some((entry) => entry.name === 'branch_abandoned')`; when `input.adoptBranch && !abandoned` return `refused('malformed_command', { adoptBranch: true, why: 'no_abandoned_branch' })` before the WIP read; append `draft('branch_adopted', { head: item.expectedHead })` after `item_claimed` when adopting; the reply's `branch` is `{ name: branchFor(item.itemId), startFrom: item.expectedHead, adopted }`. Thread `adoptBranch` from `ClaimInput` through to `takeClaim` (it already takes the delegation id the same way). The MCP handler passes `adoptBranch: input.adoptBranch` and returns `branch`.

- [ ] **Step 4: Run, verify and commit**

Run `pnpm sim -- GH-4`, then the pg file, then `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. Expected: PASS.

```bash
git add packages/harness apps sim
git commit -m "feat(harness): a claim starts from the expected head unless it adopts the abandoned branch, which is an event" -m "GH-4"
```

---

### Task 7: The GitHub App, declared, and a client that mints its token per call

**Requirements:** GH-1 (least-privilege permissions and subscribed events recorded in `infra/`; the webhook points at `uw-ingest`; the private key, installation id and webhook secret live only in Worker secrets; installation tokens minted in the host step per call and never reaching a model process or an MCP response; write-back limited).

**Files:**
- Create: `infra/github/app-manifest.json`; Modify: `infra/README.md` (a "GitHub App (GH-1)" section) — its own commit
- Modify: `apps/uw-app/env.ts` (three optional secrets), `apps/uw-app/package.json` (`@octokit/core`), `pnpm-lock.yaml`
- Create: `apps/uw-app/github/app-config.ts`, `apps/uw-app/github/token.ts`, `apps/uw-app/github/failures.ts`, `apps/uw-app/github/client.ts`, `apps/uw-app/github/testing/fixture-github.ts`
- Modify: `.dependency-cruiser.mjs`
- Test: `tools/infra/github-app.test.ts`, `apps/uw-app/github/client.test.ts`, `apps/uw-app/github/token.test.ts`

**Interfaces:**
- Produces:

```ts
export type GitHubAppConfig = {
  readonly appId: string;
  readonly installationId: string;
  readonly privateKey: string;
};
export function githubAppOf(env: Bindings): GitHubAppConfig | null;

export type GitHubFailure =
  | 'unreachable' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict'
  | 'not_mergeable' | 'unprocessable' | 'rate_limited' | 'server_error'
  | 'malformed_response' | 'key_not_pkcs8';
export type GitHubResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: GitHubFailure; readonly status: number | null };

export type GitHubTransport = { readonly fetch: typeof fetch; readonly now: () => Date };

export type GitHubReads = {
  installationRepositories(): Promise<GitHubResult<readonly unknown[]>>;
  pullRequest(repo: string, number: number): Promise<GitHubResult<unknown>>;
  pullRequestFiles(repo: string, number: number): Promise<GitHubResult<readonly unknown[] | 'too_many_files'>>;
  pullRequestReviews(repo: string, number: number): Promise<GitHubResult<readonly unknown[]>>;
  checkRuns(repo: string, sha: string): Promise<GitHubResult<readonly unknown[]>>;
  issuesSince(repo: string, since: Date | null, maxPages: number): Promise<GitHubResult<{ readonly issues: readonly unknown[]; readonly capped: boolean }>>;
  issueComments(repo: string, number: number): Promise<GitHubResult<readonly unknown[]>>;
};
export type GitHubWrites = {
  comment(repo: string, number: number, body: string): Promise<GitHubResult<{ readonly id: number }>>;
  merge(repo: string, number: number, merge: { readonly sha: string; readonly title: string; readonly message: string }): Promise<GitHubResult<{ readonly sha: string }>>;
  tag(repo: string, name: string, sha: string): Promise<GitHubResult<{ readonly created: boolean }>>;
};
export type GitHubClient = { readonly reads: GitHubReads; readonly writes: GitHubWrites };
export function createGitHubClient(config: GitHubAppConfig, transport: GitHubTransport): GitHubClient;
```

  Reads return `unknown` payloads; Task 8's Zod schemas parse them (Zod at every boundary). `fixtureGitHub()` returns `{ fetch: typeof fetch; on(method: string, path: string, reply: FixtureReply | FixtureReply[]): void; requests(): readonly RecordedRequest[] }` with `FixtureReply = { status: number; body?: unknown; headers?: Record<string, string> }` and `RecordedRequest = { method: string; path: string; search: string; authorization: string | null; body: unknown }`; an unprogrammed route answers 404; the token route `POST /app/installations/<id>/access_tokens` answers `{ token: 'ghs_fixture_<n>', expires_at }` with a counter, unless programmed otherwise.

- [ ] **Step 1: Write the failing tests**

`tools/infra/github-app.test.ts`, `describe('GH-1 the GitHub App is declared with least privilege', …)`: the manifest's `default_permissions` equal exactly `{ metadata: 'read', issues: 'write', pull_requests: 'write', checks: 'read', contents: 'write' }`; `default_events` equal exactly `['issues', 'pull_request', 'pull_request_review', 'check_run', 'push']` (as a set); `hook_attributes.url` is `https://uw-ingest-staging.unfoldingword.workers.dev/webhooks/github` (the route `apps/uw-ingest/app.ts` serves); `public` is false; the manifest holds no key, secret or token text; no wrangler file under `infra/` declares `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY` or `GITHUB_WEBHOOK_SECRET` in any `vars` block; `infra/README.md` names the four `wrangler secret put` commands.

`apps/uw-app/github/token.test.ts` (workers project), `describe('GH-1 an installation token is minted per call', …)`: with a generated RS256 key exported as PKCS#8, two reads make two `POST /app/installations/77/access_tokens` requests, each with `Authorization: Bearer <jwt>` whose header is `RS256`, `iss` is the app id, `iat` is now less 60 s and `exp` now plus 9 minutes (decode with `jose.decodeJwt` and `decodeProtectedHeader`, verify with the public key); the read itself carries `Authorization: token ghs_fixture_1` then `ghs_fixture_2`; a PKCS#1 key (`-----BEGIN RSA PRIVATE KEY-----`) gives `{ ok: false, failure: 'key_not_pkcs8' }` and sends nothing; a token route answering 401 gives `unauthorized`.

`apps/uw-app/github/client.test.ts`, `describe('GH-1 write-back is a comment, the merge and the merge tag, and no token leaves the client', …)`: `Object.keys(client.writes).sort()` is `['comment', 'merge', 'tag']`; across every read and write, the recorded requests other than the token route are `GET`s plus exactly `POST /repos/o/r/issues/1/comments`, `PUT /repos/o/r/pulls/2/merge` (body `{ merge_method: 'squash', sha, commit_title, commit_message }`) and `POST /repos/o/r/git/refs` (body `{ ref: 'refs/tags/harness/x', sha }`); `JSON.stringify` of every returned value contains no `ghs_` and no `eyJ`; status mapping: 401 `unauthorized`, 403 with `x-ratelimit-remaining: 0` `rate_limited`, 403 otherwise `forbidden`, 404 `not_found`, 405 `not_mergeable`, 409 `conflict`, 422 `unprocessable`, 5xx `server_error`, a thrown fetch `unreachable`, a 200 with a non-JSON body `malformed_response`; `tag` on a 422 whose existing ref (`GET /repos/o/r/git/ref/tags/harness/x`) points at the same sha answers `{ ok: true, value: { created: false } }`, at another sha `conflict`; `pullRequestFiles` reads pages of 100 until a short page and answers `'too_many_files'` after 30 full pages; `issuesSince` passes `since` as ISO, `state=all`, `sort=updated`, `direction=asc`, `per_page=100`, and reports `capped: true` when `maxPages` full pages were read.

Run each (`pnpm vitest run tools/infra/github-app.test.ts`, then `pnpm vitest run --project workers apps/uw-app/github/token.test.ts`, then the client test). Expected: FAIL.

- [ ] **Step 2: Declare the App (its own commit)**

`infra/github/app-manifest.json`:

```json
{
  "name": "uw-harness-staging",
  "url": "https://github.com/unfoldingWord/uw-platform",
  "hook_attributes": {
    "url": "https://uw-ingest-staging.unfoldingword.workers.dev/webhooks/github",
    "active": true
  },
  "public": false,
  "default_permissions": {
    "metadata": "read",
    "issues": "write",
    "pull_requests": "write",
    "checks": "read",
    "contents": "write"
  },
  "default_events": ["issues", "pull_request", "pull_request_review", "check_run", "push"]
}
```

`infra/README.md` gains "GitHub App (GH-1)": how an org owner registers it from the manifest (GitHub's "Register a GitHub App from a manifest" flow), installs it on `unfoldingWord/uw-platform`, converts the key with `openssl pkcs8 -topk8 -nocrypt -in key.pem -out key.pkcs8.pem`, and sets `wrangler secret put GITHUB_APP_ID|GITHUB_APP_INSTALLATION_ID|GITHUB_APP_PRIVATE_KEY --env <name>` for `uw-app` and `wrangler secret put GITHUB_WEBHOOK_SECRET --env <name>` for `uw-ingest`; the production App is a second registration with production's ingest URL once that Worker has a route.

```bash
git add infra/github infra/README.md
git commit -m "chore(infra): declare the GitHub App with least-privilege permissions and its five events" -m "Shared root infra/: GH-1 records the App's permissions and events and where its secrets go." -m "GH-1"
```

- [ ] **Step 3: Implement the client**

- `env.ts` `Bindings` gains `GITHUB_APP_ID?: string; GITHUB_APP_INSTALLATION_ID?: string; GITHUB_APP_PRIVATE_KEY?: string`.
- `app-config.ts` `githubAppOf` returns null unless all three are non-empty.
- `token.ts` (module-private helpers, one export `installationToken(config, transport): Promise<GitHubResult<string>>` used only by `client.ts`): refuse a key that does not start with `-----BEGIN PRIVATE KEY-----` with `key_not_pkcs8`; `importPKCS8(key, 'RS256')`; `new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer(appId).setIssuedAt(seconds(now) - 60).setExpirationTime(seconds(now) + 540).sign(key)`; `POST https://api.github.com/app/installations/<id>/access_tokens` with `Authorization: Bearer <jwt>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: uw-platform`; parse `{ token: string }` with Zod. A dependency-cruiser rule `github-token-only-in-the-client` allows only `apps/uw-app/github/client.ts` to import `token.ts`.
- `failures.ts`: `failureOf(status: number, headers: Headers): GitHubFailure` as tested.
- `client.ts`: every method mints a token, then builds `new Octokit({ auth: token, userAgent: 'uw-platform', request: { fetch: transport.fetch } })` and calls `octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', …)` and so on; a `RequestError` maps through `failureOf`; any other thrown error is `unreachable`. Pagination is a loop over `page`, bounded as tested. The token string never appears in a returned value or a thrown error.
- `testing/fixture-github.ts` as in Interfaces (a test helper; knip sees the tests importing it).
- `.dependency-cruiser.mjs` adds `github-client-only-in-github-and-connectors` (from `pathNot: '^apps/uw-app/(github/|ports/connectors\\.ts$)'`, to `path: '^(apps/uw-app/github/(client|token)\\.ts|node_modules/@octokit/)'`, test files exempt) and `github-never-in-mcp-or-engines` (from `^apps/uw-app/(mcp|engines)/`, to `^apps/uw-app/github/`).

`pnpm --filter @uw/uw-app add @octokit/core@^7.0.8`.

- [ ] **Step 4: Run, verify and commit**

Run the three Step 1 files (one at a time), then `pnpm build` (the Workers bundle must build with `@octokit/core`), then `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. Expected: PASS.

```bash
git add apps/uw-app .dependency-cruiser.mjs pnpm-lock.yaml tools/infra/github-app.test.ts
git commit -m "feat(uw-app): a GitHub client that mints the App JWT and an installation token per call and writes only a comment, the merge and the tag" -m "GH-1"
```

---

### Task 8: The read model: one upsert path keyed on the GitHub id

**Requirements:** GH-2 (redelivery is an idempotent upsert; one upsert path; each row with a freshness timestamp; the model answers is it open, the head, the checks on that head, who approved that head), GH-5 (the changed files at the head with renames' previous names; the declaration parsed from the body).

**Files:**
- Create: `apps/uw-app/github/payloads.ts`, `apps/uw-app/github/fixtures/*.json` (webhook: `issues-labeled`, `issues-unlabeled`, `pull-request-opened`, `pull-request-synchronize`, `pull-request-edited`, `pull-request-review-submitted`, `pull-request-review-dismissed`, `check-run-completed`, `push`; REST: `rest-pull`, `rest-files`, `rest-reviews`, `rest-check-runs`, `rest-issues`, `rest-installation-repositories`, `rest-issue-comments`)
- Create: `apps/uw-app/github/facts/records.ts`, `apps/uw-app/github/facts/normalise.ts`, `apps/uw-app/github/facts/upsert.ts`, `apps/uw-app/github/facts/queries.ts`
- Modify: `packages/harness/index.ts` (export `parseDeclaration`, `parseReviewProvider`, `fullSha`, `sameRepository`), `tools/architecture/owners.test.ts` (the owner `apps/uw-app/github/facts/`), `docs/exceptions.md` (rows for `upsert.ts` and `queries.ts`, in the same commit as the code)
- Test: `apps/uw-app/github/facts/normalise.test.ts`, `apps/uw-app/github/facts/upsert.pg.test.ts`, `apps/uw-app/github/facts/queries.pg.test.ts`

**Interfaces:**
- Consumes: the tables (Task 1); `parseDeclaration`, `parseReviewProvider`, `fullSha` from `@uw/harness` (Task 3); `PullRequestFacts` (Task 4).
- Produces (`records.ts`):

```ts
export type RepoRecord = { readonly githubId: number; readonly fullName: string; readonly defaultBranch: string; readonly private: boolean };
export type MilestoneRecord = { readonly githubId: number; readonly repoId: number; readonly number: number; readonly title: string; readonly state: 'open' | 'closed'; readonly dueOn: Date | null; readonly githubUpdatedAt: Date };
export type IssueRecord = { readonly githubId: number; readonly repoId: number; readonly number: number; readonly title: string; readonly state: 'open' | 'closed'; readonly labels: readonly string[]; readonly milestoneId: number | null; readonly githubUpdatedAt: Date };
export type PullRequestRecord = { readonly githubId: number; readonly repoId: number; readonly number: number; readonly title: string; readonly state: 'open' | 'closed' | 'merged'; readonly draft: boolean; readonly headSha: string; readonly headRef: string; readonly baseRef: string; readonly milestoneId: number | null; readonly declaration: PullRequestDeclaration | null; readonly declarationProblem: string | null; readonly githubUpdatedAt: Date };
export type FilesRecord = { readonly pullRequestId: number; readonly head: string; readonly paths: readonly string[] | null; readonly problem: string | null };
export type CheckRunRecord = { readonly githubId: number; readonly repoId: number; readonly headSha: string; readonly name: string; readonly appSlug: string | null; readonly status: GithubCheckStatus; readonly conclusion: CheckConclusion | null; readonly startedAt: Date | null; readonly completedAt: Date | null };
export type ReviewRecord = { readonly githubId: number; readonly repoId: number; readonly pullRequestId: number; readonly reviewerLogin: string; readonly commitId: string; readonly state: ReviewState; readonly provider: string | null; readonly submittedAt: Date | null };
export type FactBatch = { readonly repos: readonly RepoRecord[]; readonly milestones: readonly MilestoneRecord[]; readonly issues: readonly IssueRecord[]; readonly pullRequests: readonly PullRequestRecord[]; readonly files: readonly FilesRecord[]; readonly checkRuns: readonly CheckRunRecord[]; readonly reviews: readonly ReviewRecord[] };
export const emptyBatch: FactBatch;
```

- Produces (`normalise.ts`): `factsFromWebhook(event: string, payload: unknown): NormalisedDelivery` with `NormalisedDelivery = { readonly kind: 'facts'; readonly batch: FactBatch } | { readonly kind: 'ignored'; readonly event: string } | { readonly kind: 'malformed'; readonly event: string }`; `factsFromPull(repo: RepoRecord, pull: unknown): FactBatch | null`, `filesFromRest(pullRequestId: number, head: string, files: readonly unknown[] | 'too_many_files'): FilesRecord`, `reviewsFromRest(repo, pullRequestId, reviews: readonly unknown[]): readonly ReviewRecord[]`, `checkRunsFromRest(repoId, runs: readonly unknown[]): readonly CheckRunRecord[]`, `issuesFromRest(repo, issues: readonly unknown[]): { readonly issues: readonly IssueRecord[]; readonly milestones: readonly MilestoneRecord[]; readonly pullRequestNumbers: readonly number[] }`, `repoFromRest(repo: unknown): RepoRecord | null`. Review states are lowercased (REST sends `APPROVED`); `pending` reviews are dropped; SHAs go through `fullSha` and a record with an unusable SHA is dropped; a PR with `merged: true` (or `merged_at` set) is `merged`; the declaration comes from `parseDeclaration(pull.body)` (`ok` → `declaration`, otherwise `declarationProblem` is the problem, except `missing` is also stored as the problem); a review's provider from `parseReviewProvider(review.body)`; files' `paths` are every `filename` plus every `previous_filename`, de-duplicated, in order of first appearance; `'too_many_files'` gives `paths: null, problem: 'too_many_files'`.
- Produces (`upsert.ts`): `export const owns = ['gh_repos', 'gh_issues', 'gh_milestones', 'gh_prs', 'gh_check_runs', 'gh_reviews'] as const;` `upsertFacts(db: Database, batch: FactBatch, freshAt: Date): Promise<UpsertReport>`; `recordFiles(db: Database, files: FilesRecord, freshAt: Date): Promise<boolean>` (true when it landed on the current head);

```ts
export type RepairCounts = { readonly repos: number; readonly milestones: number; readonly issues: number; readonly pullRequests: number; readonly checkRuns: number; readonly reviews: number; readonly files: number };
export type IssueChange = { readonly repo: string; readonly githubId: number; readonly number: number; readonly title: string; readonly labels: readonly string[]; readonly hadLabels: readonly string[] | null; readonly githubUpdatedAt: Date };
export type PullRequestChange = { readonly repo: string; readonly githubId: number; readonly number: number; readonly head: string; readonly filesKnown: boolean };
export type UpsertReport = { readonly repaired: RepairCounts; readonly issues: readonly IssueChange[]; readonly pullRequests: readonly PullRequestChange[] };
```

  `issues` and `pullRequests` list every issue and PR in the batch as stored after the upsert (`hadLabels` is null for a new row); `filesKnown` is whether `files_head` equals `head_sha` after the upsert.
- Produces (`queries.ts`): `pullRequestFacts(db: Executor, ref: PullRequestRef): Promise<PullRequestFacts | null>`; `openPullRequests(db: Executor, repoId: number): Promise<readonly PullRequestChange[]>`; `repoByName(db: Executor, fullName: string): Promise<{ readonly githubId: number; readonly sweptThrough: Date | null } | null>`.

- [ ] **Step 1: Write the failing tests**

`normalise.test.ts`, `describe('GH-2 GitHub payloads become fact records', …)`: each webhook fixture gives the expected batch (assert whole records); `issues-labeled` carries the repo, the issue and its milestone; `pull-request-review-submitted` carries the repo, the PR and the review with provider `anthropic` from the fixture body's `harness-review` block; REST `rest-reviews` with `APPROVED` gives `approved`; a review with `commit_id: 'abc123'` is dropped; `rest-files` with a renamed file gives both names; `ping` is `ignored`; `issues` with a payload missing `issue` is `malformed`; a PR body with the Task 3 declaration gives `declaration`, one with two blocks gives `declarationProblem: 'duplicate_block'`.

`upsert.pg.test.ts`, `describe('GH-2 the upsert is idempotent and never lets an older fact undo a newer one', …)`:
- upserting the `pull-request-opened` batch twice leaves one PR row and the second report counts `pullRequests: 0` repaired;
- `pull-request-synchronize` (newer `updated_at`, new head) then `pull-request-opened` (older): the head stays the synchronize head; `repaired.pullRequests` is 1 then 0;
- review submitted then dismissed then the submitted delivery again: the review stays `dismissed`;
- a check run `completed` then an older `in_progress` delivery of the same id: it stays `completed`;
- `recordFiles` for the current head lands (true) and for an older head does not (false);
- an `issues-labeled` upsert reports `hadLabels: null`, `labels: ['harness']`; the `issues-unlabeled` upsert reports `hadLabels: ['harness']`, `labels: []`;
- every written row has `fresh_at` equal to the `freshAt` given, and an unchanged re-upsert moves `fresh_at` to the later instant without counting a repair;
- a batch whose repository is new inserts `gh_repos` first, so the foreign keys hold.

`queries.pg.test.ts`, `describe('GH-2 the read model answers for a PR from its own tables', …)`: after the opened, review-submitted (on the head) and check-run-completed batches plus `recordFiles`, `pullRequestFacts({ repo: 'UnfoldingWord/UW-Platform', number })` answers `state: 'open'`, `head`, `headRef`, the check on that head with its `app` and `checkId`, the review on that head with its login, provider, `reviewId` and `submittedAt`, `files: { head, paths }` and the declaration; a check run on an older head is not in `checks`; after a synchronize, `files` is null until new files are recorded; an unknown PR is null.

Run each with `TEST_DATABASE_URL` (normalise in the workers project). Expected: FAIL.

- [ ] **Step 2: Implement**

- `payloads.ts`: Zod `z.object` (not strict: GitHub sends many more fields) schemas for exactly the fields read: `repositorySchema` (`id`, `full_name`, `default_branch`, `private`), `milestoneSchema`, `labelSchema` (`name`), `issueSchema` (`id`, `number`, `title`, `state`, `labels`, `milestone` nullable, `updated_at`, `pull_request` optional), `pullSchema` (`id`, `number`, `title`, `state`, `draft`, `merged` optional, `merged_at` nullable optional, `head: { sha, ref }`, `base: { ref }`, `body` nullable, `milestone` nullable, `updated_at`), `reviewSchema` (`id`, `user: { login }` nullable, `commit_id` nullable, `state`, `body` nullable, `submitted_at` nullable), `checkRunSchema` (`id`, `head_sha`, `name`, `status`, `conclusion` nullable, `started_at` nullable, `completed_at` nullable, `app: { slug }` nullable), `fileSchema` (`filename`, `previous_filename` optional), and one envelope schema per webhook event (`issues`, `pull_request`, `pull_request_review`, `check_run`, `push`) combining them with `action`.
- `normalise.ts`: a `Map<string, (payload: unknown) => NormalisedDelivery>` keyed by event name; each entry parses with its schema (`malformed` on failure) and builds records. Fixture JSON is imported `with { type: 'json' }` in tests only.
- `upsert.ts`: one `db.transaction` per batch, in order repos, milestones, issues, pull requests, check runs, reviews, files. Before writing issues and pull requests, read their stored labels and heads `FOR UPDATE` by GitHub id. Each table is one `insert(...).values(rows).onConflictDoUpdate({ target: <table>.githubId, set: { …every value column from excluded… }, setWhere: <guard> }).returning({ githubId })`, where `<guard>` is: for issues, PRs and milestones `excluded.github_updated_at >= t.github_updated_at AND (t.<value columns>) IS DISTINCT FROM (excluded.<value columns>)`; for check runs `NOT (t.status = 'completed' AND excluded.status <> 'completed') AND (…) IS DISTINCT FROM (…)`; for reviews `t.state <> 'dismissed' AND (…) IS DISTINCT FROM (…)`; for repos `(…) IS DISTINCT FROM (…)`. The returned rows count as repaired. Then one `UPDATE <table> SET fresh_at = $freshAt WHERE github_id IN (…)` per table for the batch's ids whose stored `github_updated_at` is not newer than the record's (all ids for check runs, reviews and repos). A PR whose head changed sets `files`, `files_head` and `files_problem` to null in the same upsert. `recordFiles` is `UPDATE gh_prs SET files = $paths, files_head = $head, files_problem = $problem, fresh_at = $freshAt WHERE github_id = $id AND head_sha = $head RETURNING github_id`.
- `queries.ts`: `pullRequestFacts` joins `gh_repos` by `lower(full_name) = lower($repo)`, selects the PR by `(repo_id, number)`, its check runs `WHERE repo_id = $repo AND head_sha = pr.head_sha`, and every review of the PR; `files` is set only when `files_head = head_sha` and `files` is not null; `declaration` is parsed with `pullRequestDeclarationSchema` (a stored value that fails is null); `freshAt` is the PR's `fresh_at`; the facts' `ref.repo` is the stored `full_name`.
- `docs/exceptions.md`: two rows (rule 2) for `apps/uw-app/github/facts/upsert.ts` (owns the six tables, writes them with Drizzle, one transaction per batch) and `apps/uw-app/github/facts/queries.ts` (reads them; the GitHubFacts platform adapter and the sweep call it), worded as the `pages/store.ts` and `pages/reads.ts` rows are.
- `owners.test.ts`: import `owns as githubFacts` from `apps/uw-app/github/facts/upsert.ts` and add `{ dir: 'apps/uw-app/github/facts/', tables: githubFacts }`.

- [ ] **Step 3: Run, verify and commit**

Run the three Step 1 files, then `pnpm vitest run tools/architecture/owners.test.ts`, then `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. Expected: PASS.

```bash
git add apps/uw-app/github tools/architecture/owners.test.ts docs/exceptions.md
git commit -m "feat(uw-app): the GitHub read model: payloads to fact records, one guarded upsert keyed on the GitHub id, and the facts for a PR" -m "GH-2 GH-5"
```

---

### Task 9: GitHub facts reach the kernel, and webhooks reach the read model

**Requirements:** GH-2 (the queue consumer uses the one upsert path; for a PR the model answers from its own tables), GH-5 (the platform GitHubFacts adapter; changed files fetched at the head).

**Files:**
- Create: `apps/uw-app/ports/github-facts.ts`, `apps/uw-app/ports/github-facts.contract.pg.test.ts`
- Modify: `apps/uw-app/kernel.ts` (`githubFacts: database ? platformGitHubFacts(database.db) : githubFactsNotWired`), `apps/uw-app/ports/not-wired.contract.test.ts` (the label `uw-app with no database`)
- Create: `apps/uw-app/github/ingest.ts`, `apps/uw-app/github/follow-up.ts`
- Modify: `apps/uw-app/queue/consumer.ts` (the constant `ingestHandlers` becomes `notWiredHandlers`, used only when there is no database), `apps/uw-app/queue/worker.ts`, `apps/uw-app/queue/consumer.test.ts`
- Test: `apps/uw-app/github/ingest.pg.test.ts`

**Interfaces:**
- Consumes: `upsertFacts`, `recordFiles`, `pullRequestFacts` (Task 8); `factsFromWebhook`, `filesFromRest` (Task 8); `GitHubClient`, `githubAppOf`, `createGitHubClient` (Task 7).
- Produces: `platformGitHubFacts(db: Database): GitHubFacts`; `type GitHubDeps = { readonly db: Database; readonly kernel: Kernel; readonly client: GitHubClient | null; readonly now: () => Date }`; `githubIngestHandler(deps: GitHubDeps): IngestHandler`; `followUpserts(deps: GitHubDeps, report: UpsertReport, logger: Logger): Promise<void>` (this task: fetch files for every PR change with `filesKnown: false` when `client` is not null, through `filesFromRest` and `recordFiles`; Task 13 adds the issue follow-ups); `consumeIngestBatch(batch, env)` builds `handlers` per batch: with a database, `new Map([['github', githubIngestHandler({ db, kernel: platformKernel(database), client, now })]])` where `client = githubAppOf(env) ? createGitHubClient(config, { fetch, now }) : null`; without, `notWiredHandlers`.

- [ ] **Step 1: Write the failing tests**

`github-facts.contract.pg.test.ts`: `describeGithubFactsContract('the platform GitHub facts over the read model', open)` where `open` creates a migrated database and `given(facts)` converts `PullRequestFacts` to a `FactBatch` (repo id from a counter, `githubUpdatedAt` increasing per call so a later `given` wins) and upserts it plus `recordFiles`.

`ingest.pg.test.ts`, `describe('GH-2 webhook deliveries feed the read model through the one upsert path', …)`: running the handler over envelopes built from the fixtures (opened, review submitted, check run completed) leaves `platformGitHubFacts(db).pullRequest(ref)` answering open, the head, the check on the head and the approval on the head; a redelivered envelope changes nothing; with a `fixtureGitHub()` client programmed for `GET /repos/unfoldingWord/uw-platform/pulls/<n>/files`, the opened delivery records the files at the head and a synchronize clears them until refetched; with `client: null` the files stay null and the handler logs `github_not_configured`; a `payloadTruncated` envelope logs `payload_truncated` and writes nothing; a `ping` logs `ignored`; a malformed `issues` payload logs `malformed_payload`; none of these throws (so the consumer acks); a database failure throws (so the consumer retries).

`consumer.test.ts`: the existing GitHub-handler case moves to `notWiredHandlers`.

Run each. Expected: FAIL.

- [ ] **Step 2: Implement**

`apps/uw-app/ports/github-facts.ts`:

```ts
export function platformGitHubFacts(db: Database): GitHubFacts {
  return { pullRequest: (ref) => pullRequestFacts(db, ref) };
}
```

`ingest.ts`: `githubIngestHandler(deps)` returns `async (envelope, logger) => …`: a truncated envelope logs `payload_truncated` with the event and delivery id; otherwise `factsFromWebhook(envelope.event, envelope.payload)`; `ignored` and `malformed` log `ignored` and `malformed_payload`; `facts` upserts with `freshAt = deps.now()`, logs `outcome: 'upserted'` with the repaired counts, then `followUpserts`. `follow-up.ts` as in Interfaces; a GitHub failure on a files fetch is logged `files_not_fetched` with the failure and does not throw.

`worker.ts` builds the handlers as in Interfaces.

- [ ] **Step 3: Run, verify and commit**

Run the Step 1 files, then `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. Expected: PASS (the agent-boundary check still passes: `ingest.ts` and `follow-up.ts` name no gate, stage or connector).

```bash
git add apps/uw-app
git commit -m "feat(uw-app): the queue consumer feeds GitHub deliveries through the one upsert path, and the kernel reads GitHub facts from the read model" -m "GH-2 GH-5"
```

---

### Task 10: The nightly sweep repairs missed webhooks from a watermark

**Requirements:** GH-2 (a nightly sweep repairs missed webhooks from a watermark through the same upsert path and records what it repaired).

**Files:**
- Create: `apps/uw-app/cron/registry.ts`, `apps/uw-app/cron/scheduled.ts`, `apps/uw-app/github/sweep.ts`
- Modify: `apps/uw-app/index.ts` (`scheduled: runScheduled`), `apps/uw-app/github/facts/upsert.ts` (`recordSweep`), `apps/uw-app/github/facts/queries.ts` (as needed)
- Modify: `infra/uw-app/wrangler.toml`, `infra/uw-app/wrangler.go-live.toml` (its own commit)
- Test: `apps/uw-app/github/sweep.pg.test.ts`, `apps/uw-app/cron/registry.test.ts`, `tools/infra/crons.test.ts`

**Interfaces:**
- Consumes: Tasks 7 to 9.
- Produces: `GITHUB_SWEEP_CRON = '17 3 * * *'`; `cronJobs: ReadonlyMap<string, CronJob>` with `type CronJob = (env: Bindings, deps: CronDeps) => Promise<void>` and `type CronDeps = { readonly now: () => Date; readonly fetch: typeof fetch; readonly sink: LogSink; readonly newId: () => string; readonly commit: string }`; `runScheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void>` (an unknown `controller.cron` logs `unknown_cron`); `sweepGitHub(deps: GitHubDeps & { readonly client: GitHubClient }, logger: Logger, options?: { readonly maxPages?: number }): Promise<SweepReport>` with `type SweepReport = { readonly repositories: readonly RepositorySweep[] }`, `type RepositorySweep = { readonly repo: string; readonly outcome: 'swept' | 'failed'; readonly repaired: RepairCounts; readonly sweptThrough: Date | null; readonly failure: GitHubFailure | null }`; `recordSweep(db, repoId: number, sweep: { readonly sweptThrough: Date; readonly at: Date; readonly repaired: RepairCounts }): Promise<void>` writing `swept_through` and `last_sweep` (`{ at, repaired }`).

- [ ] **Step 1: Write the failing tests**

`sweep.pg.test.ts`, `describe('GH-2 the nightly sweep repairs what the webhooks missed, from a watermark, through the same upsert', …)` with a `fixtureGitHub()` programmed for `GET /installation/repositories`, `GET /repos/unfoldingWord/uw-platform/issues`, `GET …/pulls/<n>`, `…/pulls/<n>/files`, `…/pulls/<n>/reviews`, `…/commits/<sha>/check-runs`:
- on an empty read model the first sweep lists issues without `since`, upserts the issue, the PR, its files, reviews and checks, and `gh_repos.last_sweep.repaired` records the counts; `swept_through` is the sweep's start instant;
- a second sweep sends `since` equal to the watermark less 10 minutes, repairs nothing new (`repaired` all zero) and moves the watermark;
- a review the webhooks missed on an open PR not in the issues listing is repaired (open PRs are re-read every night);
- with `maxPages: 1` and a full first page, the watermark is the last listed issue's `updated_at` and the report says it was capped;
- `GET /repos/…/issues` answering 500 leaves that repository's watermark unchanged and reports `failed` with `server_error`; another repository is still swept;
- the sweep's upserts go through `upsertFacts` (spy on nothing: assert through the rows and the report).

`cron/registry.test.ts`: `describe('GH-2 the sweep is registered as a nightly cron', …)`: `cronJobs` has exactly `GITHUB_SWEEP_CRON`; `runScheduled` with that cron and no database logs `database_not_configured`; with a database and no GitHub secrets logs `github_not_configured` and makes no request.

`tools/infra/crons.test.ts`: `describe('GH-2 the deployed crons are the registered ones', …)`: `env.staging.triggers.crons` and `env.production.triggers.crons` in both `infra/uw-app/wrangler.toml` and `wrangler.go-live.toml` equal `[GITHUB_SWEEP_CRON]` (read the registry key from `apps/uw-app/cron/registry.ts` as text or import it); `env.preview` declares none.

Run each. Expected: FAIL.

- [ ] **Step 2: Declare the cron (its own commit)**

Add `[env.staging.triggers]\ncrons = ["17 3 * * *"]` and the same for `env.production` in both wrangler files (the go-live test keeps them equal apart from the go-live bindings).

```bash
git add infra/uw-app
git commit -m "chore(infra): a nightly cron for the GitHub sweep in staging and production" -m "Shared root infra/: GH-2's sweep runs at 03:17 UTC." -m "GH-2"
```

- [ ] **Step 3: Implement**

`sweep.ts`: for each repository from `installationRepositories` (parsed with `repoFromRest`): upsert the repo; read its watermark (`repoByName`); `issuesSince(repo, since, maxPages ?? 30)`; for each listed issue upsert it (with its milestone); for each listed PR number and each `openPullRequests` row: `pullRequest`, `pullRequestReviews`, `checkRuns` at the head, upsert, then `pullRequestFiles` when the files are not known at the head and `recordFiles`; run `followUpserts` on every report (one path with the webhook handler); sum the repaired counts; `recordSweep` with `sweptThrough` = the start instant, or the last listed `updated_at` when capped. A GitHub failure on the listing fails that repository; a failure on one PR is logged `pull_request_not_swept` and the sweep continues. Log `github sweep repaired` per repository with `repaired` and `outcome`.

`cron/scheduled.ts`: builds a logger with a fresh trace id, opens the database (`hyperdriveDatabase(env)`), builds `GitHubDeps` like `worker.ts`, calls the job from `cronJobs`, releases the database in `finally`. `index.ts` adds `scheduled: runScheduled`.

- [ ] **Step 4: Run, verify and commit**

Run the Step 1 files, then `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. Expected: PASS.

```bash
git add apps/uw-app tools/infra/crons.test.ts
git commit -m "feat(uw-app): the nightly GitHub sweep re-reads from a watermark through the one upsert path and records what it repaired" -m "GH-2"
```

---

### Task 11: The item remembers its issue, and issues get a page type

**Requirements:** GH-3 (an imported issue is one `harness_items` row wrapping a page that links to the issue, idempotent on the issue id; manual enqueue and import share one event shape; removing the label records an event).

**Files:**
- Modify: `packages/contracts/identity.ts` (`ingestIdentity`), `packages/contracts/harness.ts` (`issueRefSchema`, `itemStateSchema.issue`), `packages/contracts/event-evidence.ts` (`item_created.issue`, `label_removed`), `packages/contracts/pages.ts` (`issue` in the page type set), `packages/contracts/page-types.ts` (`issueFrontmatterSchema`), `registry.ts`, `version.ts`, `contract-lock.json`, fixtures, both apps' `package.json`
- Modify: `packages/core/principal.ts` (`INGEST_IDENTITY` re-exports `ingestIdentity`)
- Modify: `packages/db/schema.ts`; Create: `packages/db/migrations/0015_item_issue.sql` (generated)
- Modify: `packages/harness/ports.ts` (`HarnessItemsGateway.read.byIssue`)
- Modify: `packages/db/store/items.ts`, `packages/db/store/rows.ts`, `packages/harness/items/fold.ts`, `packages/harness/items/record.ts` (`NewItem.issue`, `item_created` evidence), `packages/harness/items/enqueue.ts` (passes `issue: null`), `packages/harness/port-contracts/{store-gateways,store-gateway-fixtures}.ts`, `packages/db/test-seed.ts` (`seedItem` issue columns), `apps/uw-app/pages/gating.ts` (`issue: 'gated'`), every fixture or test that builds an `ItemState` or `item_created` evidence (grep `zulipTopic:` and `item_created`)
- Test: `packages/db/item-issue.test.ts`, `packages/harness/items/fold.test.ts` (new case), `packages/contracts/page-types.test.ts` (new case)

**Interfaces:**
- Produces: `ingestIdentity = 'agent:ingest'` from `@uw/contracts`; `issueRefSchema = z.strictObject({ repo: repositorySchema, number: z.number().int().min(1), githubId: z.number().int().min(1) })`, `type IssueRef`; `ItemState.issue: IssueRef | null`; `item_created` evidence gains `issue: issueRefSchema.nullable()`; `label_removed` evidence `z.strictObject({ issue: issueRefSchema, label: z.string().min(1).max(50), githubUpdatedAt: z.iso.datetime() })`; page type `issue` with `issueFrontmatterSchema = z.strictObject({ repo: repositorySchema, number: z.number().int().min(1), github_id: z.number().int().min(1), url: z.url() })`, `internal`/`sync`; `NewItem.issue: IssueRef | null`; `HarnessItemsGateway.read.byIssue(githubId: number): Promise<ItemState | null>`.

- [ ] **Step 1: Write the failing tests**

`packages/db/item-issue.test.ts` on `databaseTargets`, `describe('GH-3 an issue becomes at most one item', …)`: two items with the same `issue_github_id` are refused by `harness_items_issue_once`; an item with `issue_repo` but no `issue_number` is refused by `harness_items_issue_whole`; two items with no issue are fine.

`fold.test.ts`: `item_created` with an `issue` folds to `item.issue`; without (`issue: null`) folds to null; `label_removed` changes nothing.

`page-types.test.ts`: an `issue` page's frontmatter validates; one missing `url` does not.

Run each. Expected: FAIL.

- [ ] **Step 2: Contracts (9.0.0, its own commit)**

As in Interfaces; fixtures for `item_state`, `item_created`, `label_removed` and the `issue` page type (valid and invalid); `CONTRACT_VERSION = '9.0.0'`; lock; both apps. (`packages/core/principal.ts` switching `INGEST_IDENTITY` to `ingestIdentity` is feature code and lands in Step 5's commit, not this one.)

```bash
git add packages/contracts apps/uw-app/package.json apps/uw-ingest/package.json
git commit -m "feat(contracts)!: an item remembers the issue it wraps, label removal has evidence, and issues get a page type (9.0.0)" -m "Shared root packages/contracts: GH-3's import and manual enqueue share item_created, now carrying the issue or null." -m "GH-3 CT-3"
```

- [ ] **Step 3: Schema and migration (its own commit)**

`harness_items` gains `issueRepo: text('issue_repo')`, `issueNumber: integer('issue_number')`, `issueGithubId: bigint('issue_github_id', { mode: 'number' })`, with `check('harness_items_issue_whole', sql\`(${t.issueRepo} IS NULL) = (${t.issueNumber} IS NULL) AND (${t.issueNumber} IS NULL) = (${t.issueGithubId} IS NULL)\`)` and `uniqueIndex('harness_items_issue_once').on(t.issueGithubId).where(sql\`${t.issueGithubId} IS NOT NULL\`)`. `pnpm db:generate --name item_issue`.

```bash
git add packages/db/schema.ts packages/db/migrations
git commit -m "feat(db): harness_items records the issue it wraps, once per issue" -m "Shared root packages/db/schema.ts and migration 0015." -m "GH-3"
```

- [ ] **Step 4: The port (its own commit)**

```bash
git add packages/harness/ports.ts
git commit -m "feat(harness): the items gateway finds the item wrapping an issue" -m "Shared root packages/harness/ports.ts: GH-3's import is idempotent on the issue id." -m "GH-3"
```

- [ ] **Step 5: Implement**

`packages/core/principal.ts` sets `export const INGEST_IDENTITY = ingestIdentity;` (imported from `@uw/contracts`). `store/items.ts` `columnsOf` writes the three columns from `item.issue`; `byIssue` selects by `issue_github_id`; `rows.ts` `toItemState` maps them back. `fold.ts` `created` sets `issue: evidence.issue`. `record.ts` `NewItem` gains `issue` and `createItem` writes it into `item_created`. `enqueue.ts` passes `issue: null`. The port contract gains a DX-3 case for `byIssue`. `gating.ts` classifies `issue` as `gated` (its classification table is `Record<PageType, …>`, so this is required to typecheck). Update every `ItemState` literal and `item_created` evidence in fixtures and tests.

- [ ] **Step 6: Run, verify and commit**

Run the Step 1 files, then `pnpm sim -- all`, then `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. Expected: PASS.

```bash
git add packages apps sim tools
git commit -m "feat(harness): items carry the issue they wrap through item_created, and the store finds an item by its issue" -m "GH-3"
```

---

### Task 12: The kernel imports an issue once and records a removed label

**Requirements:** GH-3 (an issue carrying the label becomes one item in Package of its harness, idempotent on the issue id; removing the label records an event and does not delete the item; manual enqueue and import share one code path and one event shape).

**Files:**
- Modify: `packages/harness/access.ts` (`isIngestPrincipal`), `packages/harness/lock-keys.ts` (`githubIssue`), `packages/db/advisory-locks.ts` (prefix `github-issue:`)
- Modify: `packages/harness/items/enqueue.ts` (extract `enqueueIn`)
- Create: `packages/harness/items/import.ts`, `packages/harness/reads/repository.ts`
- Modify: `packages/harness/items/commands.ts`, `packages/harness/reads/index.ts`, `packages/harness/index.ts`
- Modify: `tools/architecture/system-principal.test.ts` (a second `describe` for the ingest principal)
- Create: `sim/scenarios/GH-3.a-labelled-issue-becomes-one-item.ts`
- Test: `sim/kernel/import.test.ts`, `apps/uw-app/harness/import-race.pg.test.ts`

**Interfaces:**
- Consumes: `IssueRef`, `ingestIdentity`, `byIssue`, `byRepository` (Tasks 2, 11).
- Produces:

```ts
export type ImportIssueInput = {
  readonly harnessId: string;
  readonly issue: IssueRef;
  readonly title: string;
  readonly pageId: string | null;
};
export type Imported = { readonly item: ItemState; readonly created: boolean };
export type LabelRemovedInput = {
  readonly githubId: number;
  readonly label: string;
  readonly githubUpdatedAt: string;
};
export type LabelRemoved = { readonly item: ItemState; readonly recorded: boolean };
export type ImportTarget = { readonly harnessId: string; readonly jdArea: JdArea };
```

  `kernel.items.importIssue(caller, input: ImportIssueInput): Promise<KernelOutcome<Imported>>`; `kernel.items.labelRemoved(caller, input: LabelRemovedInput): Promise<KernelOutcome<LabelRemoved>>`; `kernel.reads.importTarget(caller, input: { readonly repository: string }): Promise<KernelOutcome<ImportTarget>>`; `isIngestPrincipal(actor: Principal): boolean` (identity `ingestIdentity`, kind `agent`, no person, no grants, not interactive); `lockKeys.githubIssue(githubId: number) => \`github-issue:${githubId}\``; `enqueueIn(tx, context, harness, input: { title; pageId; priority; due; issue: IssueRef | null }, ids): Promise<Recorded>` (internal to `items/`).
- Authorization: `importIssue` and `importTarget` accept the ingest principal, or a person with `write` (`read` for `importTarget`) on the harness's area; any other agent principal is `not_permitted`. `labelRemoved` accepts only the ingest principal.

- [ ] **Step 1: Write the failing scenario and tests**

`GH-3` scenario: on the software harness (`repository: 'unfoldingWord/uw-platform'`), the ingest principal (`principalSchema.parse` of the ingest form, as sim fixtures build principals) imports issue `{ repo: 'unfoldingWord/uw-platform', number: 12, githubId: 9100000012 }` with a page: one item in `package` with `issue` set and `item_created` evidence carrying it; importing again (as a sweep would) answers `created: false` with the same item and appends nothing; a person with `editor` on 80-89 importing the same issue gets the same item; `labelRemoved` with `githubUpdatedAt` T1 records `label_removed` and the item stays in `package`; the same call again records nothing (`recorded: false`); a person's manual enqueue records `item_created` with `issue: null` (the same evidence shape). `state` reports the item count and the label events.

`sim/kernel/import.test.ts`, `describe('GH-3 only the ingest principal or a writer on the area imports, onto the harness of the issue's repository', …)`: an agent device principal with `editor` is `not_permitted`; a viewer person is `not_permitted`; an issue whose repository is not the harness's is `not_permitted` `{ why: 'repository_mismatch' }`; `importTarget` for `UnfoldingWord/UW-Platform` answers the software harness and its area, for `unfoldingWord/other` `harness_not_found`, and for an agent `harness_not_found`; `labelRemoved` for an unknown issue is `item_not_found`, and from a person is `not_permitted`.

`apps/uw-app/harness/import-race.pg.test.ts`, `describe.skipIf(!testServer)('GH-3 two imports of one issue on two connections make one item', …)`: two kernels over two `postgres` connections to one migrated database import the same issue at once (`Promise.all`); one answers `created: true`, the other `created: false` with the same item id; `harness_items` holds one row for the issue (the `github-issue:` lock serialises them; the unique index is the backstop). Use `kernelOn` from `apps/uw-app/testing/kernel.ts` and seed the harness as `apps/uw-app/harness/claims.pg.test.ts` does.

`system-principal.test.ts` gains `describe('GH-3 only the ingest edge, the GitHub module, the cron and the sim construct the ingest principal', …)`: `ingestPrincipal(` and `'agent:ingest'` appear only in `packages/contracts/identity.ts`, `packages/core/principal.ts` and its test, `packages/harness/access.ts`, `apps/uw-ingest/`, `apps/uw-app/github/`, `apps/uw-app/cron/`, `sim/`, and app tests; planted mentions elsewhere are flagged.

Run `pnpm sim -- GH-3`, then the test files. Expected: FAIL.

- [ ] **Step 2: Implement**

- `enqueue.ts`: after its own authorization, `enqueue` calls `enqueueIn`, which finds the first stage by position and calls `createItem` with `issue`.
- `import.ts`: `importIssue` opens one transaction: `tx.lock(lockKeys.githubIssue(input.issue.githubId))`; `byIssue` → existing answers `accepted({ item, created: false })`; read the harness (`harness_not_found`), check `sameRepository(input.issue.repo, harness.repository)`, authorize (ingest principal, or `allowed(actor, 'write', harness, at)` for a person; any other agent is refused before any read with `not_permitted`), then `enqueueIn` with `priority: 0`, `due: null`. `labelRemoved`: ingest only; `byIssue` (else `item_not_found`); `tx.harnessItems.read.lock`; read the item's events; if a `label_removed` with the same `githubUpdatedAt` exists answer `recorded: false`; else `recordItemEvents` with `draft('label_removed', { issue: item.issue, label, githubUpdatedAt })`.
- `reads/repository.ts` `importTarget`: `byRepository` in a read transaction; an agent other than ingest gets `harness_not_found`; a person needs `read` on the area (else `harness_not_found`, hidden equals missing).
- Register the lock key and its prefix; `commands.ts` and `reads/index.ts` gain the members; export the input and output types from the index.

- [ ] **Step 3: Run, verify and commit**

Run `pnpm sim -- GH-3`, the test files, then `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. Expected: PASS.

```bash
git add packages sim tools
git commit -m "feat(harness): import an issue once onto its repository's harness through the enqueue path, and record a removed label without deleting the item" -m "GH-3"
```

---

### Task 13: Labelled issues arrive as items with a page and one cross-reference comment

**Requirements:** GH-3 (whether a webhook or the sweep finds it first; wrapping a page that links to the issue; exactly one cross-reference comment lands on the issue; removing the label records an event).

**Files:**
- Create: `apps/uw-app/pages/issue-pages.ts`, `apps/uw-app/github/import.ts`
- Modify: `apps/uw-app/github/follow-up.ts` (issue follow-ups), `apps/uw-app/github/sweep.ts` (retry pending cross-references), `apps/uw-app/github/facts/upsert.ts` (`claimCrossReference`, `recordCrossReference`, `releaseCrossReference`), `apps/uw-app/github/facts/queries.ts` (`issuesAwaitingCrossReference`)
- Modify: `docs/exceptions.md` (rows for `issue-pages.ts`, in the same commit)
- Test: `apps/uw-app/github/import.pg.test.ts`, `apps/uw-app/pages/issue-pages.pg.test.ts`

**Interfaces:**
- Consumes: `kernel.reads.importTarget`, `kernel.items.importIssue`, `kernel.items.labelRemoved` (Task 12); `client.reads.issueComments`, `client.writes.comment` (Task 7); `IssueChange` (Task 8).
- Produces: `HARNESS_LABEL = 'harness'`; `ensureIssuePage(db: Database, input: { readonly jdArea: JdArea; readonly issue: IssueRef; readonly title: string; readonly url: string }, ids: { next(): string }, traceId: string): Promise<string>` (the page id; idempotent on slug `issue-<githubId>` in the area; `edit_source` `agent:ingest`; the new page's id from `ids.next()`; production passes `randomIds` from `apps/uw-app/ports/ids.ts`); `followIssue(deps: GitHubDeps, change: IssueChange, logger: Logger): Promise<void>`; `crossReferenceBody(itemId: string): string`; `claimCrossReference(db, githubId: number, at: Date): Promise<boolean>`, `recordCrossReference(db, githubId: number, commentId: number): Promise<void>`, `releaseCrossReference(db, githubId: number): Promise<void>`; `issuesAwaitingCrossReference(db, repoId: number): Promise<readonly IssueChange[]>`.

- [ ] **Step 1: Write the failing tests**

`import.pg.test.ts`, `describe('GH-3 a labelled issue becomes one item with one cross-reference comment, whoever finds it first', …)`, on a migrated database with the software harness activated with `repository: 'unfoldingWord/uw-platform'` and a `fixtureGitHub()` client:
- the `issues-labeled` delivery creates one `issue` page (area 80-89, frontmatter linking to the issue's URL, status `active`) and one item in `package` wrapping it, and posts one comment whose body is `crossReferenceBody(itemId)`;
- redelivering it, then running the sweep over a listing holding the same issue, creates no second page or item and posts no second comment (the fixture records exactly one `POST …/comments`);
- the sweep finding the issue first, then the webhook: the same single page, item and comment;
- a comment post answering 500 releases the claim; the next sweep posts once;
- a claim taken and the process lost after posting (simulate: post through the fixture, then leave `xref_comment_id` null with a claim older than 10 minutes): the next attempt finds the marker in `GET …/issues/<n>/comments`, records that comment id and posts nothing;
- `issues-unlabeled` records `label_removed` and the item still exists; redelivering it records nothing more;
- an issue in a repository no harness names logs `no_harness_for_repository` and creates nothing;
- with `client: null` the item is created and the comment waits (`xref_comment_id` null) until a sweep with a client posts it.

`issue-pages.pg.test.ts`, `describe('GH-3 the issue page links to the issue and is written once', …)`: `ensureIssuePage` twice returns one page id; the page has one version with `edit_source` `agent:ingest`; an agent's `write_page` save of it is refused (gated).

Run each. Expected: FAIL.

- [ ] **Step 2: Implement**

- `issue-pages.ts`: in one transaction, select the page by `(jd_area, slug)`; if present return its id; else insert the page (type `issue`, title the issue title truncated to the page title limit, body `Tracks [<repo>#<number>](<url>).`, status `active`, version 1) and its `page_versions` snapshot with `edit_source: 'agent:ingest'`; a unique violation on the slug re-selects and returns the existing id. `docs/exceptions.md` row (rule 2 and section 10): the ingest path writes this page type without `can()`, since the ingest principal has no grants; it writes only `issue` pages in the area of the harness the issue's repository names, and the kernel import that follows checks the repository again.
- `import.ts` `followIssue`: when `change.labels` includes `HARNESS_LABEL`: `importTarget` (refusal → log `no_harness_for_repository`), `ensureIssuePage`, `importIssue`, then `ensureCrossReference`; when `change.hadLabels` includes it and `change.labels` does not: `labelRemoved` (log the outcome). `ensureCrossReference(deps, change, itemId)`: no client → log `github_not_configured`; `claimCrossReference` false → return; read comments, a body containing the marker → `recordCrossReference` with its id; else `comment(…)`: ok → `recordCrossReference`, failure → `releaseCrossReference` and log. The ingest principal is `ingestPrincipal()` from `@uw/core/principal`, built here.
- `upsert.ts`: `claimCrossReference` is `UPDATE gh_issues SET xref_claimed_at = $at WHERE github_id = $id AND xref_comment_id IS NULL AND (xref_claimed_at IS NULL OR xref_claimed_at < $at - interval '10 minutes') RETURNING github_id`; the other two set or clear the columns.
- `follow-up.ts` calls `followIssue` for every `IssueChange` in the report; `sweep.ts` also calls it for every `issuesAwaitingCrossReference` row of the repository.

- [ ] **Step 3: Run, verify and commit**

Run the Step 1 files, then `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. Expected: PASS.

```bash
git add apps/uw-app docs/exceptions.md
git commit -m "feat(uw-app): a labelled issue becomes one item wrapping an issue page, with exactly one cross-reference comment, from the webhook or the sweep" -m "GH-3"
```

---

### Task 14: The merge connector, and the four connectors that are not wired

**Requirements:** GH-6 (the merge connector runs only from the kernel's stage-exit path after a `gate_decisions` row exists, proven by a static check; it re-checks the head and refuses if it moved; it squash-merges, tags the merge with the item and writes the outcome as an event; an override's reason travels into the merge commit message; a GitHub refusal is an event, not an exception; SECURITY carries: refuse another repository's PR, idempotent per item and head), GH-7 (`deploy`, `publish`, `send`, `post` registered with handlers that return not wired and write an event).

**Files:**
- Modify: `packages/harness/ports.ts` (its own commit)
- Modify: `packages/harness/connectors/registry.ts`, `packages/harness/gates/exit.ts` (`requestOf` passes the repository), `packages/harness/gates/approve-at-ship.ts` (`PendingExit.repository`), `packages/harness/gates/decide.ts` (fill it from the harness), `packages/harness/port-contracts/connectors.ts`, `sim/adapters/connectors.ts`
- Create: `apps/uw-app/github/merge.ts`, `apps/uw-app/ports/connectors.ts`, `apps/uw-app/ports/connectors.contract.test.ts`
- Delete: `apps/uw-app/ports/connectors.not-wired.ts` (grep confirms its only references are `apps/uw-app/kernel.ts`, `not-wired.contract.test.ts` and `tools/architecture/connector-callers.test.ts`, all updated here)
- Modify: `apps/uw-app/kernel.ts` (`platformPorts(database, clock, github: GitHubClient | null = null)`; `connectors: platformConnectors(github)`), `apps/uw-app/queue/worker.ts` and `apps/uw-app/cron/scheduled.ts` (pass the client), `apps/uw-app/ports/not-wired.contract.test.ts`, `tools/architecture/connector-callers.test.ts`, `.dependency-cruiser.mjs`
- Modify: the KN-18 tests that expect `deploy`, `send` or `post` to be refused at write time (grep `connector_not_registered`)
- Test: `apps/uw-app/github/merge.test.ts`, `sim/kernel/connectors-not-wired.test.ts`

**Interfaces:**
- Produces (`ports.ts`): `ConnectorRequest` gains `readonly repository: string | null` (the harness's); `Connectors = { run(request: ConnectorRequest): Promise<ConnectorOutcome>; outcomeOf(request: ConnectorRequest): Promise<ConnectorOutcome | null> }`.
- Produces: `connectorRegistry` holds `merge`, `deploy`, `publish`, `send`, `post`; `mergeHandler(client: GitHubClient): ConnectorHandler` with `type ConnectorHandler = { run(request): Promise<ConnectorOutcome>; outcomeOf(request): Promise<ConnectorOutcome | null> }`; `notWiredConnector: ConnectorHandler` (run → `{ outcome: 'refused', reason: 'not_wired' }`, outcomeOf → null); `platformConnectors(client: GitHubClient | null): Connectors` dispatching by `request.connector` through a `Map<EffectConnector, ConnectorHandler>` (merge is `mergeHandler(client)` or `notWiredConnector` when `client` is null); merge `succeeded` detail is `{ mergeSha, tag, already }` with `tag` `harness/<itemId>` or `failed` and `already` `'true'` or `'false'`.
- Sim: `SimConnectors` gains `outcomeOf` (answers the `succeeded` outcome of an earlier `run` for the same connector, item and expected head, else null).

- [ ] **Step 1: Write the failing tests**

`merge.test.ts` (workers project), `describe('GH-6 the merge connector re-checks the head, squash-merges once per item and head, tags the merge, and answers refusals as outcomes', …)`, with a `fixtureGitHub()` client and a request for `unfoldingWord/uw-platform#42` at head H, item I, message `Show the board\n\nOverride: reviewer is away`, repository `unfoldingWord/uw-platform`:
- an open PR at H: `PUT …/pulls/42/merge` with `{ merge_method: 'squash', sha: H, commit_title: 'Show the board (#42)', commit_message: 'Override: reviewer is away\n\nHarness-Item: I' }`, then `POST …/git/refs` with `refs/tags/harness/I` at the merge sha; outcome `succeeded` with `{ mergeSha, tag: 'harness/I', already: 'false' }`;
- the live PR at another head: `refused` `head_mismatch`, no merge request;
- GitHub answering the merge 409 (the head moved after the read): `refused` `head_mismatch`, no tag request (Review Focus 2); 405: `not_mergeable`; 403: `github_forbidden`; a thrown fetch: `github_unreachable`;
- the request's PR in `unfoldingWord/other`, or `repository: null`: `refused` `repository_mismatch`, no request at all;
- the PR already merged at H (`merged: true`, `head.sha: H`, `merge_commit_sha: M`): no merge request, the tag ensured, `succeeded` with `already: 'true'`; merged at another head: `head_mismatch`; closed unmerged: `pr_not_open`;
- the tag answering 500 after a merge: `succeeded` with `tag: 'failed'`;
- `outcomeOf`: merged at H answers the `succeeded` outcome without any write; open or merged elsewhere answers null;
- no outcome or detail contains `ghs_`.

`apps/uw-app/ports/connectors.contract.test.ts`: `describeConnectorsContract('the platform connectors over a fixture GitHub', open)` where `open` programs the fixture for an open PR at the contract request's head and `refuseNext('merge', 'head_mismatch')` programs the next merge to 409.

Change `port-contracts/connectors.ts`: the first case asserts every effect connector resolves (never rejects) to an outcome whose `outcome` is `succeeded` or `refused`; the merge connector succeeds; the refusal case stays on `merge`; the third case becomes "merge succeeds again after a refusal"; add `outcomeOf` cases: null before any merge, the succeeded outcome after one, and never rejects.

`sim/kernel/connectors-not-wired.test.ts`, `describe('GH-7 deploy, publish, send and post are registered and answer not wired as an event', …)`: a stage with connector `deploy` (and each of the others) is accepted by the stage command; on the platform adapter (`platformConnectors(null)`) each answers `refused` `not_wired`; in the sim, a parked item at a `send` stage approved by a person with the sim connectors refusing `not_wired` records `connector_refused { connector: 'send', reason: 'not_wired' }` and stays parked.

`connector-callers.test.ts` gains `describe('GH-6 the merge connector runs only from the kernel stage-exit path', …)`: `writes.merge(` and `mergeHandler(` appear only in `apps/uw-app/github/merge.ts` and `apps/uw-app/ports/connectors.ts`; a call matching `/connectors\s*\??\.\s*outcomeOf\b/` appears in no non-test source (Task 15 changes this to exactly `packages/harness/gates/recover.ts`); the wiring list is updated (`apps/uw-app/ports/connectors.ts` replaces `connectors.not-wired.ts`).

Run each. Expected: FAIL.

- [ ] **Step 2: The port (its own commit)**

```bash
git add packages/harness/ports.ts
git commit -m "feat(harness): a connector request names the harness's repository, and connectors report an effect that already happened" -m "Shared root packages/harness/ports.ts: GH-6's merge refuses another repository's PR, and recovery must learn whether a merge happened without causing one." -m "GH-6"
```

- [ ] **Step 3: Implement**

- Kernel: `PendingExit` and `ExitInput` gain `repository: string | null`, filled from `gate.harness.repository` in `decide.ts`; `requestOf` passes it. The registry gains `deploy`, `send`, `post`.
- `merge.ts`: `run(request)`: `repository` and the PR's repo must match (`sameRepository`), else `repository_mismatch`; `pullRequest`/`expectedHead` null → `head_mismatch`; read the live PR (Zod `pullSchema` from `payloads.ts`, failure → `github_malformed_response`); merged → at the expected head → `ensureTag` and answer `already: 'true'`, else `head_mismatch`; closed → `pr_not_open`; head ≠ expected → `head_mismatch`; merge with the sha guard; map `conflict` → `head_mismatch`, `not_mergeable` → `not_mergeable`, other failures → `github_<failure>`; then `ensureTag` (`tag` result failure → `tag: 'failed'`). `outcomeOf` reads the PR only. Title is the message's first line plus ` (#<n>)`; body is the remaining lines trimmed, then a blank line and `Harness-Item: <itemId>`.
- `apps/uw-app/ports/connectors.ts` as in Interfaces. `kernel.ts` and the two composition sites pass the client built from `githubAppOf(env)`; `platformKernel` gains the same optional parameter.
- `.dependency-cruiser.mjs`: `merge-handler-only-in-the-connectors-adapter` (only `apps/uw-app/ports/connectors.ts` and tests import `apps/uw-app/github/merge.ts`).
- Delete `connectors.not-wired.ts`, its `describeConnectorsNotWired` call in `not-wired.contract.test.ts`, and `describeConnectorsNotWired` itself from `port-contracts/connectors.ts` (no not-wired connectors adapter remains, so `tools/architecture/port-contracts.ts` no longer requires it).

- [ ] **Step 4: Run, verify and commit**

Run the Step 1 files and `pnpm sim -- all`, then `pnpm build`, then `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. Expected: PASS.

```bash
git add packages apps sim tools .dependency-cruiser.mjs
git commit -m "feat(uw-app): the merge connector re-checks the head, squash-merges once per item and head, tags the merge, and the other four connectors answer not wired" -m "GH-6 GH-7"
```

---

### Task 15: A person recovers a connector result that was lost

**Requirements:** GH-6 (SECURITY carries: a recovery path records a connector result if the exit transaction failed after a successful connector run; an admin-triggered sweep records `connector_refused` with `connector_lost` after a timeout for a parking stuck in `decision_in_flight`).

**Files:**
- Modify: `packages/harness/gates/exit.ts` (split `recordExitOutcome` out of `exitThroughConnector`)
- Create: `packages/harness/gates/recover.ts`
- Modify: `packages/harness/gates/commands.ts`, `packages/harness/index.ts` (types)
- Modify: `tools/architecture/connector-callers.test.ts` (a `connectors.outcomeOf` call only in `recover.ts`; `recordExitOutcome(` only in `exit.ts` and `recover.ts`; `recover.ts` joins the files allowed to reference the connectors port)
- Create: `sim/lost-exit.ts`, `sim/scenarios/GH-6.a-lost-connector-result-is-recovered.ts`
- Test: `sim/kernel/recover.test.ts`

**Interfaces:**
- Consumes: `decisionInFlight`, `parkingChangedSince`, `sameChange` (`gates/parking.ts`); `Connectors.outcomeOf` (Task 14).
- Produces: `CONNECTOR_TIMEOUT_MS = 15 * 60_000`; `recordExitOutcome(ports: ExitPorts, context: RecordContext, input: ExitInput, outcome: ConnectorOutcome): Promise<boolean>` (the second transaction of today's `exitThroughConnector`, unchanged in behaviour); `kernel.gates.recoverConnectors(caller: Caller, input: { readonly harnessId: string }): Promise<KernelOutcome<Recovered>>` with `type Recovered = { readonly items: readonly RecoveredItem[] }`, `type RecoveredItem = { readonly itemId: string; readonly outcome: 'succeeded' | 'lost' }`.
- Authorization: a person (not an agent, refused `not_permitted` `{ actor }`) with `admin` on the harness's area, grants re-read with `grants.lockAndReread` in the scan transaction (a revoked admin is `not_permitted`).

- [ ] **Step 1: Write the failing scenario and tests**

Create `sim/lost-exit.ts` with `kernelThatLosesTheExit(world: World, options: { readonly effectHappened: boolean }): Kernel`. It builds `createKernel` over the world's adapters with two substitutes: a connectors adapter whose `run` calls `world.adapters.connectors.run(request)` when `effectHappened` (so the sim adapter remembers the merge and its `outcomeOf` answers it) or returns `{ outcome: 'succeeded', detail: {} }` without calling it when not, and in both cases sets an `armed` flag; and a store wrapper whose `transaction` rejects with an `Error` named `ExitLost` once while `armed` is set (clearing the flag), and otherwise delegates to `world.adapters.store`. That is the crash GH-6 names: the decision committed, the connector ran, the exit's recording transaction failed.

`GH-6` scenario: (1) park item A at Ship with green facts and approve it through `kernelThatLosesTheExit(world, { effectHappened: true })`: the call rejects `ExitLost`; the log ends at `gate_approved`; an ordinary approve through `world.kernel` is refused `decision_in_flight`; (2) `world.kernel.gates.recoverConnectors` by the admin at once answers `items: []` (inside the 15-minute timeout); (3) after `world.adapters.clock` advances 16 minutes, it records `connector_succeeded` and `stage_advanced` to `validate` for A and answers `[{ itemId: A, outcome: 'succeeded' }]`; (4) item B parked and approved through `kernelThatLosesTheExit(world, { effectHappened: false })`, then recovered after 16 minutes, records `connector_refused { connector: 'merge', reason: 'connector_lost' }`, stays parked at `ship`, and a fresh approve through `world.kernel` is accepted. `state` reports both outcomes and each item's decision rows.

`recover.test.ts`, `describe('GH-6 only a person with admin recovers a stuck parking, and only after the timeout', …)`: an agent principal with admin grants is `not_permitted`; an editor is `not_permitted`; a harness with no stuck parking answers `items: []`; a parking whose approval has a connector result is not touched; an `outcomeOf` that throws records `connector_lost`; a parking that changed since the approval (a resubmit) records the succeeded outcome but no stage exit.

Run `pnpm sim -- GH-6`, then the test. Expected: FAIL.

- [ ] **Step 2: Implement**

`exit.ts`: `exitThroughConnector` becomes `runConnector` then `recordExitOutcome`. `recover.ts`: one transaction lists the harness's items (`tx.harnessItems.read.forHarness`), keeps those parked at a stage whose connector is not `none` with `decisionInFlight(events)` true and the in-flight approval's `at` at least `CONNECTOR_TIMEOUT_MS` before `at`, and builds each one's `ExitInput` (the decision id and override reason from the approval event; `next` from `resolveExit` forward); after that transaction, for each, call `ports.connectors.outcomeOf(requestOf(…))` (a throw counts as null), then `recordExitOutcome` with the outcome, or with `{ outcome: 'refused', reason: 'connector_lost' }` when null. `commands.ts` adds `recoverConnectors`. The agent-boundary check already forbids `.gates.` in agent-reachable code; no route calls it in this step.

- [ ] **Step 3: Run, verify and commit**

Run `pnpm sim -- GH-6`, the test, then `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. Expected: PASS.

```bash
git add packages sim tools
git commit -m "feat(harness): a person with admin recovers a parking whose connector result was lost: the effect that happened is recorded, otherwise connector_lost" -m "GH-6 KN-13"
```

---

### Task 16: The tracker, the architecture and the PRD, and step 5 marked built

**Requirements:** DX-5 (`pnpm trace:built` passes with step 5 built), `AGENTS.md` section 7 step 7.

**Files:**
- Modify: `docs/progress_tracker.md`, `docs/architecture.md`, `docs/PRD.md`

- [ ] **Step 1: Check every requirement has its proof**

Run `pnpm trace` and confirm none of GH-1 to GH-6 is listed. Grep the titles: GH-1 (`tools/infra/github-app.test.ts`, `apps/uw-app/github/token.test.ts`, `client.test.ts`), GH-2 (`packages/db/github-tables.test.ts`, `apps/uw-app/github/facts/*.test.ts`, `ingest.pg.test.ts`, `sweep.pg.test.ts`, `cron/registry.test.ts`, `tools/infra/crons.test.ts`), GH-3 (`sim/scenarios/GH-3.*`, `sim/kernel/import.test.ts`, `packages/db/item-issue.test.ts`, `apps/uw-app/github/import.pg.test.ts`, `apps/uw-app/pages/issue-pages.pg.test.ts`), GH-4 (`sim/scenarios/GH-4.*`, `harness-verbs.pg.test.ts`), GH-5 (`sim/scenarios/GH-5.*`, `packages/harness/gates/ship-input.test.ts`, `packages/harness/github/*.test.ts`, `sim/kernel/submit-facts.test.ts`, `apps/uw-app/mcp/submit-facts.pg.test.ts`), GH-6 (`sim/scenarios/GH-6.*`, `sim/kernel/harness-repository.test.ts`, `packages/db/harness-repository.test.ts`, `apps/uw-app/github/merge.test.ts`, `sim/kernel/recover.test.ts`, `tools/architecture/connector-callers.test.ts`), GH-7 (`sim/kernel/connectors-not-wired.test.ts`).

- [ ] **Step 2: Update `docs/PRD.md`** (a `docs(prd):` commit of its own)

FD-9's registered page types gain `issue` (GH-3); section 8.1 `harnesses` gains `repository` and `harness_items` gains the issue columns; the `gh_*` row lists the six tables' columns that matter (GitHub id, the facts, freshness, and on `gh_issues` the cross-reference claim) and its writer `apps/uw-app/github/facts/`; section 18.2 is unchanged (the decisions go to the tracker).

```bash
git add docs/PRD.md
git commit -m "docs(prd): the issue page type, the harness repository, the item's issue and the read model's columns" -m "GH-2 GH-3 GH-6"
```

- [ ] **Step 3: Update `docs/architecture.md`**

Add "GitHub facts" describing what is built: the App and its secrets; the client (per-call token, the three writes, the dependency rules); the read model (six tables, the guarded upsert, the two entry points, the facts query); the platform GitHubFacts adapter; the sweep and its watermark; the assembler as the ship rule's only caller and what counts on the head; risk from the files at the head; the branch convention; issue import and the cross-reference comment; the merge connector and `outcomeOf`; the recovery sweep. Update the `Kernel` listing (no `shipRule` member; `items.importIssue`, `items.labelRemoved`, `reads.importTarget`, `gates.recoverConnectors`), the ports table rows for GitHubFacts and Connectors, and "What is durable, and who writes it" (the `gh_*` row's writer is `apps/uw-app/github/facts/`).

- [ ] **Step 4: Update `docs/progress_tracker.md`**

- Status table: step 5 `Built`, evidence `docs/superpowers/plans/2026-10-02-step-05-github-facts.md`; scenarios `sim/scenarios/GH-3.*`, `GH-4.*`, `GH-5.*`, `GH-6.*`; GH-1, GH-2 and GH-7 proven by tests only; tests named GH-1 to GH-7 (Step 1's files); `pnpm verify` green with `TEST_DATABASE_URL` set. Note that the merge connector and the sweep have not run against GitHub.
- A `## Step 5 evidence by requirement` table: each of GH-1 to GH-7, its commits (`git log --oneline` for this step, leaving out the plan) and its scenario and test files.
- Decisions made during the build: one row for each of this plan's decisions 1 to 22 (date 2026-10-02, the requirement, the decision, why, and cost if wrong), with these costs if wrong: (1) a sim scenario cannot exercise the read model's SQL, only the scripted facts; (2) a cached token would save a request per call; a PKCS#1 key must be converted by the person; (3) labels a person would want the harness to set are not set; (4) a repository with two harnesses cannot import; (5) a PR opened against a fork or a monorepo sibling cannot ship; (6) none known; (7) a declaration typed slightly off is undeclared and the gate refuses; (8) until the real logins are confirmed no review counts and nothing ships; (9) a provider written as a display name does not count toward diversity; (10) a reviewer who comments after approving still counts; a check from a non-Actions CI does not count; (11) a PR whose files GitHub cannot list (over 3000) cannot ship; (12) a person's PR on another branch cannot ship until pushed to `harness/<item>`; (13) a delivery over 120 000 bytes waits for the nightly sweep; (14) a missed webhook stays missed for up to a day; (15) a new page type to classify and render; (16) a comment can be posted twice if two attempts race past the 10-minute claim; (17) a label removal lost between the upsert and the kernel call is not recorded; (18) a merge made by a person on GitHub at the expected head is recorded as the harness's merge; (19) a person must run the recovery; nothing runs it on a timer; (20) none: each still refuses; (21) a caller wanting a dry evaluation of the rule must go through the gate; (22) none: no external consumer yet.
- Close the step-5 carries in "Carried to later steps" by marking each closed with the task that closed it (as step 4 marked its closed rows).
- New dependencies: `2026-10-02 | @octokit/core ^7.0.8 (MIT, apps/uw-app) | a hand-written GitHub REST request layer (URL templates, headers, error statuses)`; `2026-10-02 | Contract versions 7.0.0, 7.1.0, 8.0.0, 8.1.0, 9.0.0 | Not a dependency: contractVersion in both apps moved with each`. Add any `pnpm.overrides` Task 7 needed.
- Not verified: the GitHub webhook payloads, REST responses and installation-token exchange against real GitHub (fixtures trimmed from GitHub's documentation only); the App manifest registered through GitHub's manifest flow; `@octokit/core` in a deployed Worker (only `pnpm build` and the Workers Vitest pool ran it); the merge's `sha` guard and the tag creation against a real repository; Cron Triggers firing on Cloudflare; the sweep's pagination on a repository with more than 100 updated issues; GitHub's review-state casing in webhooks versus REST beyond the documented examples.
- Waiting on a person: `| 2026-10-02 | GH-1 | infra/github/app-manifest.json, apps/uw-app/github/{token,client}.ts | An org owner registers the App from the manifest, installs it on unfoldingWord/uw-platform, and sets GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID and GITHUB_APP_PRIVATE_KEY (PKCS#8) on uw-app and GITHUB_WEBHOOK_SECRET on uw-ingest, per environment | an org owner; Ian |`; `| 2026-10-02 | GH-2 | the read model, the queue handler and the nightly sweep | The first real deliveries and the first sweep on staging, after FD-12's switch-on | Ian |`; `| 2026-10-02 | GH-5 | packages/harness/github/reviewers.ts | Confirm the Reviewer identities' GitHub logins (uw-reviewer[bot], uw-reviewer-codex[bot] are placeholders) once PE-6 and HE-9 create them | an org owner |`; `| 2026-10-02 | GH-6 | apps/uw-app/github/merge.ts, apps/uw-app/ports/connectors.ts | A test repository for the merge connector's first live run (PRD 15) | Ian |`. Remove `connectors.not-wired.ts` and `github-facts.not-wired.ts` (now used only without a database) from the not-wired rows as appropriate: `github-facts.not-wired.ts` stays listed under the no-database adapters with `store.not-wired.ts`.
- Carried to later steps: `| 2026-10-02 | Step 5 | Step 6 | WB-1: the import command (a person imports an issue by ref through kernel.reads.importTarget, ensureIssuePage and kernel.items.importIssue) and the connector recovery command (kernel.gates.recoverConnectors) become command routes with can() |`; `| 2026-10-02 | Step 5 | Step 6 | WB-1: the gate command route builds its kernel with `platformKernel(database, clock, client)` so an approve at Ship reaches the merge connector; the MCP routes keep building it without a client |`; `| 2026-10-02 | Step 5 | Step 7 | HE-4: the Reviewer's review body carries the harness-review block with provider and model (packages/harness/github/declaration.ts parseReviewProvider) |`; `| 2026-10-02 | Step 5 | Step 8 | WB-6: the Gates view shows the assembled ship-rule input (assembleShipInput over platformGitHubFacts) |`; `| 2026-10-02 | Step 5 | Step 10 | PE-6, HE-9: the Reviewer personas' GitHub logins replace the placeholders in reviewers.ts (an acl-domain change) |`.

- [ ] **Step 5: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS, including `pnpm trace:built` with step 5 marked Built.

```bash
git add docs/progress_tracker.md docs/architecture.md
git commit -m "docs(tracker): step 5, GitHub facts, built: evidence, decisions, what was not verified and what waits on a person" -m "GH-1 GH-2 GH-3 GH-4 GH-5 GH-6 GH-7"
```
