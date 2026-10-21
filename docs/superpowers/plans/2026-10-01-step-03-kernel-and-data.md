# Step 3, Kernel and Data: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the kernel its data and its rules: the nine harness tables with the Ship invariant and the append-only event log (KN-1 to KN-3), then replay and the one read path, claims with leases and WIP, exit gates and validators, loop edges, the template property and the two templates, the ship rule and risk tiers, the gate decision command with its locked grant re-read, delegations, and the stage command (KN-4 to KN-18), every one proven in the sim on the embedded Postgres and, where only separate connections can prove it, on a Postgres server (DX-6).

**Architecture:** The kernel in `packages/harness` stays pure and reaches every table through new members of `StoreTransaction` ("gateways", one per table, each with a `read` and a `write` half); the one Drizzle implementation of those gateways lives in `packages/db/store/` and is bound by both the sim and the Worker, so they run the same SQL. Every state change is a list of events appended through one owner module (`packages/harness/items/`), which folds the same events onto the `harness_items` projection in the same transaction, so replay equals record by construction and a property test checks it. Pure rules (replay, the template property, the ship rule, risk derivation, validators) are plain functions with unit tests in `packages/harness` and property tests in `tools/properties/`; behaviour over the database is proven by scenarios in `sim/scenarios/` and by `*.pg.test.ts` races on real connections.

**Tech Stack:** TypeScript 6 strict on Node 22.18+ (type stripping), Zod 4 in `packages/contracts`, Drizzle ORM 0.45 over `postgres` 3.4 and `@electric-sql/pglite` 0.5.8, Vitest 4, `fast-check` 4 (new, root devDependency, property tests only), dependency-cruiser, knip.

**Spec:** `docs/PRD.md` (approved): section 7.3 (KN-1 to KN-18), 7.10 (DX-6), 8.1 to 8.6, 11, and 18 (P4, P5, P7 to P17, P22, P31, P35). Design: `prd/Harness v1 - Architecture.md` ("A stage is a row, not code", "Close produces memory, mechanically", "The gate is a constraint, not a column value", "Risk tier in the ship rule", "When the laptop dies", "Who may act", "Unattended loops run on a delegation", "Controls on the pipeline"); `docs/architecture.md`; ADRs 0003, 0004, 0005.

**Requirements covered:** KN-1, KN-2, KN-3, KN-4, KN-5, KN-6, KN-7, KN-8, KN-10, KN-11, KN-12, KN-13, KN-14, KN-15, KN-16, KN-17, KN-18, and the step-3 half of DX-6 (N concurrent claims, two claims racing one WIP slot, the KN-14 race; KN-2 and KN-3 on both databases). KN-9 (`walk`) was built in step 2 (`packages/harness/walk.ts`) and is reused, not rebuilt; KN-10 builds on it. CT-3 is kept: every contract change moves the enum, its fixtures, `CONTRACT_VERSION`, the lock and the consumer pins together.

**Not in this step:** HTTP routes (the command API is WB-1, step 6), MCP handlers (step 4), the `gh_*` read model and the PR-declaration parser (step 5; this step's ship-rule assembler reads the GitHubFacts port), Workflows and `harness_runs` writes (step 7), the hub wake on append (step 6), notifications (step 9), persona pages and the `personas` projection writer (step 10). The tables `harness_runs`, `measurements` and `personas` are created here (KN-1) with their owner modules declared and no writer yet.

**Decisions this plan makes for the open questions handed forward:**

1. **The sim runner reads the event log itself** (Task 10). `Scenario.run` returns `{ state }` only; the runner pages every harness's events through the one read function, and checks, for every item, that `replay(events)` equals the `harness_items` projection, so every scenario also proves KN-4.
2. **`executorOf` leaves the `@uw/db/store` barrel** (Task 5). It had no consumer outside `packages/db/store/` (grep: `packages/db/store/store.ts`, `grants.ts`, `store.test.ts` only). A dependency-cruiser rule `store-executor-stays-in-the-store` forbids importing `packages/db/store/store.ts` from outside `packages/db/store/`, so only the Store and Grants gateways (and their tests) unwrap a transaction.
3. **StoreTransaction grows additively, one gateway per table** (Tasks 5, 6, 13, 22). KN-5's count-plus-update atomicity is `tx.lock(lockKeys.stageClaims(stageId))` then `harnessItems.read.heldInStage` then `harnessItems.write.claim` (one conditional UPDATE) in one transaction; KN-13's `FOR SHARE` re-read is the existing `grants.lockAndReread(tx, …)` on the same transaction. Nothing nests a transaction.

**What this step hands to later steps (keep these names exactly):**

| Interface | Where | Consumed by |
|---|---|---|
| `harnessSchema`, `stageSchema`, `itemStateSchema`, `stageKeySchema`, the new closed sets and refusal reasons | `packages/contracts/harness.ts`, `closed-sets.ts`, `outcomes.ts` | WB-1 command bodies, WB-5 board, AB-4 verbs |
| `eventNameSchema` (PRD 8.6), `eventSchema`, `newEventSchema`, `eventEvidenceSchemas`, `EventEvidence` | `packages/contracts/events.ts`, `event-evidence.ts` | WB-3 hub, WB-8 play-by-play, every later event |
| `shipRuleInputSchema`, `shipRuleOutcomeSchema`, `shipRefusalSchema`, `ciJobSchema`, `riskDeclarationSchema` | `packages/contracts/ship-rule.ts` | GH-5 assembler, WB-6 Gates view |
| `StoreTransaction` gateways `harnesses`, `harnessStages`, `harnessItems`, `harnessEvents`, `gateDecisions`, `delegations`, `pages`; `StoreRefusedError` | `packages/harness/ports.ts`, `port-errors.ts` | every kernel module; GH-2 adds `gh*` gateways the same way |
| `createKernel(ports)` with `events`, `stages`, `items`, `delegations`, `gates`, `repair`, `replay`, `templateProperty`, `shipRule`, `walk`, `health` | `packages/harness/kernel.ts` | WB-1, AB-4, HE-1 |
| `Caller`, `KernelOutcome<T>` | `packages/harness/caller.ts`, `outcome.ts` | every adapter that calls the kernel |
| `validatorRegistry`, `connectorRegistry`, `templates` (`software`, `bml`) | `packages/harness/validators/registry.ts`, `connectors/registry.ts`, `templates.ts` | PE-5 (`premise_verified`), GH-6/GH-7 (connectors) |
| `floorFromPaths`, `applyDeclaration`, `protectedDirectories`, `domainGrants` | `packages/harness/risk/` | GH-5, PE-5 |
| `createSimHarness`, `simPerson`, `simAgent`, `simCaller`, `readWorldLog` | `sim/fixtures.ts`, `sim/runner/log.ts` | every later scenario, DX-7 |

---

## Global Constraints

Every task obeys every line here. The controller passes this section to each implementer.

**Where and how**

- Work only in the worktree `/home/ianjl/projects/uw-platform-v1` on branch `build/v1`. Never commit to `main`, never force-push, never `--no-verify`.
- Read `AGENTS.md` sections 1, 4, 6 and 10 before the first edit. When this plan and `AGENTS.md` disagree, `AGENTS.md` wins; record the conflict in `docs/progress_tracker.md` and build the version that keeps the rule.
- Words come from `CONTEXT.md`: kernel (never "engine" for the core), harness, template, stage, item, gate, connector, validator, feeds, regular tweak, occasional tweak, ship rule, risk tier, risk domains, principal, grant, delegation, beat, lease, WIP limit, event, gate decision, learning, port, adapter, platform adapter, test adapter, not wired, port contract, sim, world, scenario, walk, trace, projection (Task 7 adds it). Never "mock", "fake" or "memory adapter" for the Store test adapter: it is real Postgres. Never "ticket", "card" (outside the board) or "task" for an item.

**Code rules (mechanically enforced by `pnpm verify`)**

- TypeScript `strict`, no `any`, no `@ts-ignore`, no `as unknown as`, no non-null `!` on values that can be null at runtime.
- No code comments of any kind: no line comments, block comments, JSDoc, directive comments or commented-out code.
- Files under 500 lines; functions under 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters. These apply to test files too: a Vitest `describe` callback counts as a function; hoist logic into top-level helpers and split long `describe` blocks.
- Every file in `packages/harness`, `packages/db`, `packages/contracts`, `sim` and `tools` uses erasable syntax only: no `enum`, no `namespace`, no constructor parameter properties (declare fields and assign them in the constructor). Every relative import names its `.ts` file. JSON is imported `with { type: 'json' }`.
- No clock reads in `packages/core` or `packages/harness`: never `new Date()` or `Date.now()` there (`tools/architecture/no-clock-reads.test.ts`). The kernel reads time only through `ports.clock.now()`, once at the start of each command, and passes that instant (`at`) to every check (`can`, grants, lease, delegation liveness). `new Date(iso)` and `new Date(at.getTime() + ms)` are fine.
- Dates: calendar dates only through `packages/core/dates.ts` (`formatDate`, `parseDate`, `isoDateSchema`); instants are `Date` objects or whole `toISOString()` strings.
- Lookups by a variable key use `Map` or `Object.hasOwn`. Discovery by registry (`Map`), never a `switch` or `if` chain on a template, validator, connector, engine or persona name.

**Layering (dependency-cruiser and ESLint)**

- `packages/contracts` imports only `zod`. `packages/core` imports `packages/contracts` and `zod`. `packages/db` imports `packages/contracts`, `packages/core`, `drizzle-orm`, `postgres`, `@electric-sql/pglite` and Node built-ins, and nothing from `packages/harness`, `apps` or `sim` (tests included).
- `packages/harness` imports `packages/contracts` and `@uw/core/acl` and nothing else: no Drizzle, Workers, network, `process`, `fetch`, `zod` directly (use the schemas `@uw/contracts` exports). Its `package.json` lists only `@uw/*` packages (its wiring test enforces this); add `@uw/core` in Task 7, the task that first imports it.
- `sim/` imports `packages/harness`, `packages/contracts`, `packages/db`, its own files and the Node built-ins listed in `AGENTS.md` rule 2; its tests also Vitest. Never `drizzle-orm`, `@electric-sql/pglite`, `@uw/core` or `fast-check` from `sim/`. Sim fixtures build principals with `principalSchema.parse` from `@uw/contracts`.
- Property tests live in `tools/properties/*.test.ts` (root workspace, node project) and import `fast-check`, `vitest`, and repository code by relative path (`../../packages/harness/index.ts`, `../../sim/world.ts`).
- `apps/uw-app` is a composition root. No non-test file in `apps/` imports `packages/harness/port-contracts/`. No route, MCP handler or Workflow is added in this step.

**Ports, gateways and transactions**

- The ten ports and their keys are unchanged: `clock`, `ids`, `store`, `grants`, `githubFacts`, `connectors`, `modelEngine`, `hub`, `notifier`, `runs`.
- The Store port grows only by new members of `StoreTransaction`, one gateway per table, named exactly after the Drizzle export in `packages/db/schema.ts`: `harnesses`, `harnessStages`, `harnessItems`, `harnessEvents`, `gateDecisions`, `delegations`, plus the read-only `pages`. Each gateway is `{ read: {…}, write: {…} }` (`pages` has only `read`). A `write` member is called only from the table's owner module (Task 3 makes this a check).
- Pass the transaction object as-is: never spread, wrap, copy or proxy `tx` (the Drizzle gateways find their executor by the object's identity). While a transaction is open, never call a Store or Grants method outside it (`store.transaction`, `store.appliedMigrations`, `grants.resolve`): since step 2 those reject at once with a named error. Inside a transaction read grants only with `grants.resolveIn(tx, …)` (Task 13) or `grants.lockAndReread(tx, …)`.
- Never nest transactions. A kernel command opens one `ports.store.transaction(async (tx) => …)` and passes `tx` to every function it calls, including `ports.grants.lockAndReread(tx, personId, at)`. A second transaction is opened only after the first has settled (to record a refusal after Postgres aborted the first, or to record a connector's outcome).
- Lock order inside a transaction: stage claim lock (`tx.lock(lockKeys.stageClaims(stageId))`), then item row lock (`harnessItems.read.lock`), then grants (`grants.lockAndReread`), then event appends. Take no lock after the first append: the append's trigger takes a per-harness advisory lock held to commit.
- String lock keys go through `tx.lock(key)` (hashed with `hashtextextended(key, 0)`); numeric keys live in `packages/db/advisory-locks.ts`. Never lock one resource in both spaces. The string prefixes in use: `harness-stage-claims:` (kernel, `packages/harness/lock-keys.ts`) and `harness_events:` (the position trigger, Task 4).
- A gateway write that Postgres refuses with a constraint or trigger error (SQLSTATE class `23`, or `P0001`) rejects with `StoreRefusedError` carrying `code`, `constraint` and `table`; anything else rejects unchanged.

**Contracts**

- The live version moves `2.3.0` → `2.4.0` (Task 1, additive) → `3.0.0` (Task 2, the event vocabulary replaces the four placeholders). Each move changes, together and in one commit: the enum or schema, its fixtures under `packages/contracts/fixtures/<registry key>/{valid,invalid}/`, the `schemaRegistry` entry, `CONTRACT_VERSION` in `packages/contracts/version.ts`, a new last entry in `packages/contracts/contract-lock.json` recording every closed set, and `"contractVersion"` in `apps/uw-app/package.json` and `apps/uw-ingest/package.json`. No later task changes a contract; if one finds it must, it bumps the minor version the same way and records why in the tracker.

**Shared roots**

- Shared roots: `packages/db/schema.ts` (with its migrations), `packages/contracts/`, `packages/harness/ports.ts`, `packages/core/acl.ts`, `infra/`, `.github/workflows/`, `AGENTS.md`, `CONTEXT.md`, `docs/adr/`. A change to one goes in its own commit with no feature code, and the message names the shared root and why it changed. This step changes `packages/contracts/` (Tasks 1, 2), `packages/db/schema.ts` and migrations (Tasks 3, 4), `packages/harness/ports.ts` (Tasks 5, 6, 13, 22), `AGENTS.md` (Task 3) and `CONTEXT.md` (Task 7).

**Dependencies**

- One new third-party package: `fast-check@^4.10.2` (MIT, no dependencies, plain Node), root `devDependencies`, used only by `tools/properties/` (Task 7). Workspace link added: `@uw/core` in `packages/harness` (Task 7). Run `pnpm install` after any `package.json` change and commit `pnpm-lock.yaml` with it.
- Do not export what has no consumer yet; export in the task that consumes it. Package `exports` entries and imports from test files count as consumers for knip.

**Tests**

- Write the failing test or scenario first, run it, see it fail for the expected reason, then implement.
- Name each `describe` (or scenario file) with the requirement ID first: `describe('KN-5 a claim takes a lease', …)`, `sim/scenarios/KN-5.claim-takes-a-lease.ts`. `pnpm trace` counts a requirement proven by a scenario file `sim/scenarios/<ID>.<slug>.ts` or by a string literal in a `*.test.ts` file that starts with the ID and a space. Fixture IDs use the prefix `ZZ-`.
- A scenario is `defineScenario({ id, title, run })` in `sim/scenarios/<ID>.<slug>.ts`; until Task 10, `run` returns `{ events, state }`; from Task 10 on it returns `{ state }` and the runner supplies the events. Scenarios assert with `node:assert/strict`.
- Database behaviour that is not a scenario goes in `sim/kernel/*.test.ts` (kernel over the world) or `packages/db/*.test.ts` (schema, on `databaseTargets` from `@uw/db/test-targets`, which is the embedded Postgres and, when `TEST_DATABASE_URL` is set, the server too).
- Real connections: `apps/uw-app/harness/*.pg.test.ts`, wrapped in `describe.skipIf(!testServer)`, each connection its own `createClient(connectionString)` from `@uw/db/client`. Locally `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test` (a private local server, Postgres 16, already running); CI uses the `postgres:16` service container. No test may need a live account or a secret (PRD DX-8); the only environment variables test code reads are `TEST_DATABASE_URL`, `CI` and `PATH`.
- Every test file that opens an embedded Postgres (directly or through `createWorld`) has `afterAll(closeEmbeddedTemplate)` and closes every world or database it opens.
- Kernel tables (`harnesses`, `harness_stages`, `harness_items`, `harness_events`, `harness_runs`, `gate_decisions`, `delegations`, `measurements`, `personas`) take every instant from the command's `at` (the Clock port) and every id from the Ids port. No `defaultNow()`, `defaultRandom()`, `$defaultFn` or SQL default on any of their `uuid`, `timestamp` or `date` columns; `packages/db/kernel-defaults.test.ts` (Task 3) fails on one. Defaults on other columns (`connector` `'none'`, `wip_limit` `3`, booleans, empty arrays) are fine.
- Fixed ids in tests are UUIDs; use the patterns already in the repo (`00000000-0000-4000-8000-00000000000N`). The bootstrap migration seeds person `00000000-0000-4000-8000-000000000001` (`ian.lindsley@unfoldingword.org`) with org admin grant `00000000-0000-4000-8000-000000000101` in every migrated database.

**Verify and commit**

- At the end of every task, from the worktree root: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. It must be green, and the server tests must have run, not skipped.
- Commits are Conventional Commits. The body names the requirement IDs on its own line, for example `KN-5 DX-6`. No `Co-Authored-By` line and no attribution footer of any kind. Hooks always run.

---

## Review Focus

Inputs the PRD implies but no requirement spells out, most likely to bite first. Each has its test in the owning task.

1. **Two appends to one harness committing out of order.** A reader resuming from position 7 must never miss an event 6 that commits after 7 is visible. Expected: positions are assigned under a per-harness lock held to commit, so they become visible in order. Test: Task 4 runs two transactions on two server connections, the first holding its append open, and asserts the second's position is the first's plus one and is invisible until both commit.
2. **A lease that lapses between a claim's read and its update.** Expected: the lapsed lease is released and `lease_expired` written exactly once, whether the next claim or the sweep sees it first, and a claim on a lapsed lease succeeds. Tests: Task 15 (sweep twice, then claim; claim, then sweep) asserts one `lease_expired` per lapse.
3. **An agent principal that holds admin grants.** Agents' grants mirror their owner's, so an agent can carry `admin`. Expected: the gate command and the stage command refuse every agent principal regardless of grants; the gate command writes `gate_refused_to_agent`. Tests: Task 11 (stage command) and Task 22 (every decision, every role and scope, and a beat principal).
4. **A write Postgres refuses inside a transaction.** Postgres aborts the transaction, so the refusal cannot be recorded in it. Expected: the stage command records `stage_edit_refused` with the constraint name in a second transaction and returns the refusal; nothing else changed. Test: Task 11 lowers Ship's gate to `checks` and asserts the stage row unchanged, one `stage_edit_refused` event naming `harness_stages_effect_needs_human_gate`.
5. **A connector that fails after the decision commits.** Expected: the `gate_decisions` row and `gate_approved` stay, the outcome is `connector_refused` with the reason (`not_wired` when the platform adapter is not wired), the item stays parked at Ship, and nothing throws. Tests: Task 23 with `refuseNext('merge', …)` and with a connectors port that rejects with `PortNotWiredError`.

---

## File map

```
packages/contracts/closed-sets.ts, outcomes.ts, harness.ts, ship-rule.ts, registry.ts,
  version.ts, contract-lock.json, fixtures/**                                   Task 1
packages/contracts/events.ts, event-evidence.ts, fixtures/event*/**             Task 2
packages/db/schema.ts, checks.ts, migrations/0004_*, 0005_*                     Task 3
packages/db/schema.ts, migrations/0006_*, 0007_*                                Task 4
packages/harness/{stages,items,gates,delegations,runs,measurements,personas}/owns.ts  Task 3, 4
tools/architecture/owners.test.ts                                              Task 3
packages/harness/ports.ts, port-errors.ts                                      Task 5, 6, 13, 22
packages/db/store/{refusal,harnesses,stages,items,pages,events,gate-decisions,delegations}.ts  Task 5, 6, 13, 22
packages/harness/port-contracts/store*.ts                                      Task 5, 6, 13, 22
tools/architecture/event-read-path.test.ts                                     Task 6
packages/harness/{caller,outcome,lock-keys}.ts, items/{fold,record,events}.ts  Task 7
packages/harness/validators/*, connectors/registry.ts                          Task 8
packages/harness/template-property.ts, templates.ts, templates/*               Task 9
sim/scenario.ts, sim/runner/{log,run,report}.ts, sim/fixtures.ts               Task 10
packages/harness/stages/*                                                      Task 11
packages/harness/items/{enqueue,repair}.ts, tools/properties/projection.test.ts  Task 12
packages/harness/delegations/*                                                 Task 13
packages/harness/items/{claim,leases}.ts                                       Task 14, 15
apps/uw-app/harness/claims.pg.test.ts                                          Task 16
packages/harness/items/{submit,transitions}.ts                                 Task 17, 18
packages/harness/items/learning.ts                                             Task 19
packages/harness/risk/*                                                        Task 20
packages/harness/ship-rule.ts, tools/properties/ship-rule.test.ts              Task 21
packages/harness/gates/*                                                       Task 22, 23
apps/uw-app/harness/grant-race.pg.test.ts                                      Task 24
docs/progress_tracker.md, docs/PRD.md, docs/exceptions.md                      Task 1, 3, 5, 25
```

---

### Task 1: Contracts for the harness rows, the new closed sets, refusal reasons and the ship rule (2.4.0)

**Requirements:** CT-3 (the contract change rule), and the contract halves of KN-1 (row shapes), KN-11 (ship-rule input and output types published from the contracts), KN-12 (the refusal set), KN-17 (the declaration), KN-16 (the lapse reasons).

**Files:**
- Modify: `packages/contracts/closed-sets.ts`, `packages/contracts/outcomes.ts`, `packages/contracts/registry.ts`, `packages/contracts/index.ts`, `packages/contracts/version.ts`, `packages/contracts/contract-lock.json`, `packages/contracts/contracts.test.ts`, `packages/contracts/fixtures/error-reason/valid/last.json`
- Create: `packages/contracts/harness.ts`, `packages/contracts/ship-rule.ts`, `packages/contracts/harness.test.ts`
- Create fixtures (each `valid/*.json` and `invalid/*.json` under `packages/contracts/fixtures/<key>/`): `stage-bracket`, `gate-status`, `branch-state`, `run-outcome`, `delegation-lapse`, `check-conclusion`, `ci-job`, `ship-refusal`, `stage-key`, `persona-identity`, `pull-request-ref`, `harness`, `stage`, `item-state`, `risk-declaration`, `ship-rule-input`, `ship-rule-outcome`
- Modify: `apps/uw-app/package.json`, `apps/uw-ingest/package.json` (`contractVersion` `2.4.0`)
- Modify (separate `docs(prd):` commit): `docs/PRD.md` sections 8.3 and 8.5

**Interfaces:**
- Produces (exact names, all exported from `@uw/contracts`): `stageBracketSchema`, `gateStatusSchema`, `branchStateSchema`, `runOutcomeSchema`, `delegationLapseSchema` and their types `StageBracket`, `GateStatus`, `BranchState`, `RunOutcome`, `DelegationLapse`; `stageKeyPattern`, `stageKeySchema`, `personaIdentityPattern`, `personaIdentitySchema`, `pullRequestRefSchema`, `harnessSchema`, `stageSchema`, `itemStateSchema` and types `Harness`, `Stage`, `ItemState`; `ciJobSchema`, `checkConclusionSchema`, `shipRefusalSchema`, `riskDeclarationSchema`, `shipRuleInputSchema`, `shipRuleOutcomeSchema` and types `CiJob`, `ShipRefusal`, `RiskDeclaration`, `ShipRuleInput`, `ShipRuleOutcome`; fourteen new `ErrorReason` values.

- [ ] **Step 1: Write the failing tests**

`packages/contracts/harness.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { errorReasonSchema } from './outcomes.ts';
import {
  branchStateSchema,
  delegationLapseSchema,
  gateStatusSchema,
  runOutcomeSchema,
  stageBracketSchema,
} from './closed-sets.ts';
import { stageKeySchema } from './harness.ts';
import { ciJobSchema, shipRefusalSchema, shipRuleInputSchema } from './ship-rule.ts';

const stepThreeReasons = [
  'harness_not_found',
  'harness_exists',
  'stage_not_found',
  'item_not_found',
  'delegation_not_found',
  'delegation_lapsed',
  'not_holder',
  'transition_not_allowed',
  'unknown_feed_target',
  'connector_not_registered',
  'template_bypasses_gate',
  'stage_edit_refused',
  'item_not_at_gate',
  'reason_not_one_line',
];

describe('KN-1 the harness closed sets', () => {
  it('holds the stage brackets, gate states, branch states, run outcomes and lapse reasons', () => {
    expect(stageBracketSchema.options).toEqual([
      'product_package',
      'build_package',
      'deploy_package',
      'iterate',
    ]);
    expect(gateStatusSchema.options).toEqual(['working', 'parked', 'checks_failed', 'done']);
    expect(branchStateSchema.options).toEqual(['none', 'active', 'abandoned']);
    expect(runOutcomeSchema.options).toEqual([
      'running',
      'hibernated',
      'stopped',
      'completed',
      'failed',
    ]);
    expect(delegationLapseSchema.options).toEqual(['expired', 'revoked', 'grant_lost']);
  });

  it('keys stages in lowercase snake case', () => {
    expect(stageKeySchema.safeParse('package').success).toBe(true);
    expect(stageKeySchema.safeParse('human_review').success).toBe(true);
    expect(stageKeySchema.safeParse('Package').success).toBe(false);
    expect(stageKeySchema.safeParse('1st').success).toBe(false);
  });
});

describe('KN-12 the ship rule refusal set is section 8.5, in its order', () => {
  it('lists the nine ship-rule reasons, each an error reason', () => {
    expect(shipRefusalSchema.options).toEqual([
      'pr_not_open',
      'pr_is_draft',
      'head_mismatch',
      'checks_not_green',
      'no_reviewer_approval',
      'risk_tier_undeclared',
      'reviewer_count_below_tier',
      'reviewer_providers_not_distinct',
      'approver_lacks_domain_grant',
    ]);
    for (const reason of shipRefusalSchema.options) {
      expect(errorReasonSchema.safeParse(reason).success).toBe(true);
    }
  });

  it('names the six CI jobs of FD-4', () => {
    expect(ciJobSchema.options).toEqual([
      'security-audit',
      'lint',
      'typecheck',
      'architecture',
      'test',
      'build',
    ]);
  });

  it('adds the step 3 refusal reasons', () => {
    for (const reason of stepThreeReasons) {
      expect(errorReasonSchema.safeParse(reason).success).toBe(true);
    }
  });
});

describe('KN-11 the ship rule input has no field for the narrative', () => {
  it('lists exactly the inputs the rule reads', () => {
    expect(Object.keys(shipRuleInputSchema.shape).sort()).toEqual(
      [
        'approvals',
        'approver',
        'area',
        'at',
        'checks',
        'expectedHead',
        'override',
        'pullRequest',
        'riskDomains',
        'riskTier',
      ].sort(),
    );
  });
});

```

Run: `pnpm vitest run packages/contracts/harness.test.ts`
Expected: FAIL — `harness.ts` and `ship-rule.ts` do not exist.

- [ ] **Step 2: Add the closed sets and reasons**

Append to `packages/contracts/closed-sets.ts` (keep every existing line):

```ts
export const stageBracketSchema = z.enum([
  'product_package',
  'build_package',
  'deploy_package',
  'iterate',
]);
export const gateStatusSchema = z.enum(['working', 'parked', 'checks_failed', 'done']);
export const branchStateSchema = z.enum(['none', 'active', 'abandoned']);
export const runOutcomeSchema = z.enum(['running', 'hibernated', 'stopped', 'completed', 'failed']);
export const delegationLapseSchema = z.enum(['expired', 'revoked', 'grant_lost']);

export type StageBracket = z.infer<typeof stageBracketSchema>;
export type GateStatus = z.infer<typeof gateStatusSchema>;
export type BranchState = z.infer<typeof branchStateSchema>;
export type RunOutcome = z.infer<typeof runOutcomeSchema>;
export type DelegationLapse = z.infer<typeof delegationLapseSchema>;
```

Append the fourteen `stepThreeReasons` above, in that order, to the end of the `errorReasonSchema` list in `packages/contracts/outcomes.ts`. Change `fixtures/error-reason/valid/last.json` to `"reason_not_one_line"`.

- [ ] **Step 3: Create `packages/contracts/harness.ts`**

```ts
import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import {
  agentPickupSchema,
  branchStateSchema,
  connectorSchema,
  exitGateSchema,
  gateStatusSchema,
  principalKindSchema,
  riskDomainsSchema,
  riskTierSchema,
  stageBracketSchema,
} from './closed-sets.ts';
import { identitySchema } from './identity.ts';
import { slugSchema } from './pages.ts';

const distinct = (values: readonly string[]) => new Set(values).size === values.length;

export const stageKeyPattern = '^[a-z][a-z0-9_]{0,63}$';
export const stageKeySchema = z
  .string()
  .regex(new RegExp(stageKeyPattern), 'a stage key is lowercase snake_case');

export const personaIdentityPattern = '^agent:[A-Za-z0-9][A-Za-z0-9_-]*$';
export const personaIdentitySchema = identitySchema.refine(
  (value) => new RegExp(personaIdentityPattern).test(value),
  'a persona identity is agent:<persona>',
);

export const pullRequestRefSchema = z.strictObject({
  repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'a repository is owner/name'),
  number: z.number().int().min(1),
});

export const harnessSchema = z.strictObject({
  id: z.uuid(),
  key: slugSchema,
  template: slugSchema,
  jdArea: jdAreaSchema,
  hostedBuilderEnabled: z.boolean(),
  paused: z.boolean(),
});

export const stageSchema = z.strictObject({
  id: z.uuid(),
  harnessId: z.uuid(),
  key: stageKeySchema,
  title: z.string().min(1).max(120),
  position: z.number().int().min(1),
  bracket: stageBracketSchema,
  agentPickup: agentPickupSchema,
  exitGate: exitGateSchema,
  connector: connectorSchema,
  wipLimit: z.number().int().min(1),
  instructionsPageId: z.uuid().nullable(),
  validators: z
    .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
    .refine(distinct, 'a stage names each validator once'),
  feeds: z.array(stageKeySchema).refine(distinct, 'a stage names each feeds target once'),
  paused: z.boolean(),
});

export const itemStateSchema = z.strictObject({
  itemId: z.uuid(),
  harnessId: z.uuid(),
  stageKey: stageKeySchema,
  title: z.string().min(1).max(200),
  pageId: z.uuid().nullable(),
  priority: z.number().int(),
  due: z.iso.date().nullable(),
  holder: identitySchema.nullable(),
  claimantKind: principalKindSchema.nullable(),
  delegationId: z.uuid().nullable(),
  leaseExpiresAt: z.iso.datetime().nullable(),
  gateStatus: gateStatusSchema,
  gateTarget: stageKeySchema.nullable(),
  branchState: branchStateSchema,
  expectedHead: z.string().min(1).nullable(),
  riskTier: riskTierSchema.nullable(),
  riskDomains: riskDomainsSchema,
  pullRequest: pullRequestRefSchema.nullable(),
  zulipTopic: z.string().min(1).nullable(),
});

export type Harness = z.infer<typeof harnessSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type ItemState = z.infer<typeof itemStateSchema>;
```

- [ ] **Step 4: Create `packages/contracts/ship-rule.ts`**

```ts
import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { riskDomainsSchema, riskTierSchema } from './closed-sets.ts';
import { principalSchema } from './principal.ts';

export const ciJobSchema = z.enum([
  'security-audit',
  'lint',
  'typecheck',
  'architecture',
  'test',
  'build',
]);

export const checkConclusionSchema = z.enum([
  'success',
  'failure',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'stale',
]);

export const shipRefusalSchema = z.enum([
  'pr_not_open',
  'pr_is_draft',
  'head_mismatch',
  'checks_not_green',
  'no_reviewer_approval',
  'risk_tier_undeclared',
  'reviewer_count_below_tier',
  'reviewer_providers_not_distinct',
  'approver_lacks_domain_grant',
]);

export const riskDeclarationSchema = z.strictObject({
  riskTier: riskTierSchema,
  riskDomains: riskDomainsSchema,
});

const sha = z.string().min(1).max(64);

export const shipRuleInputSchema = z.strictObject({
  pullRequest: z.strictObject({ open: z.boolean(), draft: z.boolean(), head: sha }).nullable(),
  expectedHead: sha.nullable(),
  checks: z.array(
    z.strictObject({
      name: z.string().min(1),
      headSha: sha,
      conclusion: checkConclusionSchema.nullable(),
    }),
  ),
  approvals: z.array(
    z.strictObject({
      reviewer: z.string().min(1),
      commit: sha,
      provider: z.string().min(1).nullable(),
    }),
  ),
  riskTier: riskTierSchema.nullable(),
  riskDomains: riskDomainsSchema,
  area: jdAreaSchema,
  approver: principalSchema,
  at: z.iso.datetime(),
  override: z.boolean(),
});

export const shipRuleOutcomeSchema = z.discriminatedUnion('verdict', [
  z.strictObject({ verdict: z.literal('advance') }),
  z.strictObject({ verdict: z.literal('refuse'), reasons: z.array(shipRefusalSchema).min(1) }),
]);

export type CiJob = z.infer<typeof ciJobSchema>;
export type ShipRefusal = z.infer<typeof shipRefusalSchema>;
export type RiskDeclaration = z.infer<typeof riskDeclarationSchema>;
export type ShipRuleInput = z.infer<typeof shipRuleInputSchema>;
export type ShipRuleOutcome = z.infer<typeof shipRuleOutcomeSchema>;
```

Export both new files from `packages/contracts/index.ts` (`export * from './harness.ts';`, `export * from './ship-rule.ts';`).

- [ ] **Step 5: Register, fixture, version, lock, pins**

Add to `schemaRegistry` in `packages/contracts/registry.ts`: `'stage-bracket'`, `'gate-status'`, `'branch-state'`, `'run-outcome'`, `'delegation-lapse'` (closed-sets), `'stage-key'`, `'persona-identity'`, `'pull-request-ref'`, `harness`, `stage`, `'item-state'` (harness.ts), `'ci-job'`, `'check-conclusion'`, `'ship-refusal'`, `'risk-declaration'`, `'ship-rule-input'`, `'ship-rule-outcome'` (ship-rule.ts).

Fixtures (every `valid` file must round-trip unchanged through parse and `JSON.stringify`, so write instants as `2026-10-01T09:00:00.000Z` and omit nothing):
- each of the eight enums: `valid/first.json`, `valid/last.json` (the first and last option as a JSON string), `invalid/unknown.json` (`"nope"`).
- `stage-key`: valid `package.json` (`"package"`), `human-review.json` (`"human_review"`); invalid `capital.json` (`"Package"`), `digit-first.json` (`"1st"`).
- `persona-identity`: valid `builder.json` (`"agent:builder"`); invalid `device.json` (`"agent:avery/laptop"`), `human.json` (`"human:ian"`).
- `pull-request-ref`: valid `{"repo":"unfoldingWord/uw-platform","number":12}`; invalid `no-owner.json` (`{"repo":"uw-platform","number":12}`).
- `harness`: valid `software.json` (`{"id":"00000000-0000-4000-8000-0000000000a1","key":"software","template":"software","jdArea":"80-89","hostedBuilderEnabled":false,"paused":false}`); invalid `bad-area.json` (same with `"jdArea":"80-99"`).
- `stage`: valid `ship.json` (key `ship`, title `Ship`, position 60, bracket `deploy_package`, agentPickup `none`, exitGate `human_approval`, connector `merge`, wipLimit 3, instructionsPageId null, validators `[]`, feeds `[]`, paused false, with uuid `id` and `harnessId`); invalid `duplicate-validator.json` (validators `["learning_attached","learning_attached"]`).
- `item-state`: valid `claimed-by-agent.json` (stageKey `build`, holder `agent:builder`, claimantKind `agent`, leaseExpiresAt `2026-10-01T09:15:00.000Z`, gateStatus `working`, branchState `none`, riskDomains `[]`, every other nullable field null, priority 0); invalid `unknown-gate-status.json` (gateStatus `merged`).
- `risk-declaration`: valid `high-acl.json` (`{"riskTier":"high","riskDomains":["acl"]}`); invalid `unknown-domain.json` (`["ui"]`).
- `ship-rule-input`: valid `high-two-reviewers.json` (open, not draft, head `abc123`, expectedHead `abc123`, the six jobs `success` on `abc123`, two approvals on `abc123` with providers `anthropic` and `openai`, riskTier `high`, riskDomains `["acl"]`, area `80-89`, approver a person principal for `00000000-0000-4000-8000-000000000001` / `ian.lindsley@unfoldingword.org` with an org-scope admin grant `00000000-0000-4000-8000-000000000101`, `interactive` true, at `2026-10-01T09:00:00.000Z`, override false); invalid `narrative.json` (the same plus `"narrative":"trust me"`), `no-approver.json` (without `approver`).
- `ship-rule-outcome`: valid `advance.json` (`{"verdict":"advance"}`), `refuse.json` (`{"verdict":"refuse","reasons":["head_mismatch","checks_not_green"]}`); invalid `refuse-without-reasons.json` (`{"verdict":"refuse","reasons":[]}`).

Set `CONTRACT_VERSION = '2.4.0'`. Append a `2.4.0` entry to `contract-lock.json`: a copy of the `2.3.0` entry's `sets` with the fourteen reasons appended to `error-reason` and these sets added: `branch-state`, `check-conclusion`, `ci-job`, `delegation-lapse`, `gate-status`, `run-outcome`, `ship-refusal`, `stage-bracket`, each listing its options in schema order. `contract-lock.test.ts` (`records every closed set exactly as it is now`) names any mismatch. Set `"contractVersion": "2.4.0"` in `apps/uw-app/package.json` and `apps/uw-ingest/package.json`.

- [ ] **Step 6: Run the contract tests**

Run: `pnpm vitest run packages/contracts apps/uw-app/contract-conformance.test.ts`
Expected: PASS, including `golden fixtures`, `CT-3 the contract lock` and the new `KN-` describes.

- [ ] **Step 7: Commit the contract (shared root)**

```bash
git add packages/contracts apps/uw-app/package.json apps/uw-ingest/package.json
git commit -m "feat(contracts): harness, stage and item shapes, ship-rule input and outcome, step 3 refusal reasons; contract 2.4.0" -m "Shared root packages/contracts: the kernel tables, the ship rule and the gate command need these shapes, sets and reasons published before any table or kernel module uses them. Additive, so a minor version." -m "CT-3 KN-1 KN-11 KN-12 KN-16 KN-17"
```

- [ ] **Step 8: Record the new sets and reasons in the PRD**

In `docs/PRD.md` section 8.3 add rows: `stage bracket` (`product_package`, `build_package`, `deploy_package`, `iterate`), `gate status` (`working`, `parked`, `checks_failed`, `done`), `branch state` (`none`, `active`, `abandoned`), `run outcome` (`running`, `hibernated`, `stopped`, `completed`, `failed`), `delegation lapse` (`expired`, `revoked`, `grant_lost`), `CI job` (the six FD-4 names), `check conclusion` (the eight). In 8.5 add a paragraph `Added in step 3:` listing the fourteen reasons in order.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add docs/PRD.md
git commit -m "docs(prd): add the step 3 closed sets to 8.3 and the step 3 refusal reasons to 8.5" -m "CT-3"
```

### Task 2: The event vocabulary, the event envelope and typed evidence (3.0.0)

**Requirements:** KN-3 (name from the closed vocabulary; each row carries harness, item, name, actor, evidence, trace id and position), CT-3.

**Files:**
- Modify: `packages/contracts/events.ts`, `packages/contracts/registry.ts`, `packages/contracts/index.ts`, `packages/contracts/version.ts`, `packages/contracts/contract-lock.json`, `packages/contracts/contracts.test.ts`
- Create: `packages/contracts/event-evidence.ts`, `packages/contracts/events.test.ts`
- Replace fixtures: `packages/contracts/fixtures/event/**`, `packages/contracts/fixtures/event-name/**`; create `packages/contracts/fixtures/new-event/**`
- Modify: `apps/uw-app/package.json`, `apps/uw-ingest/package.json` (`3.0.0`)
- Modify (second commit): `sim/runner/report.ts`, `sim/runner/report.test.ts`

**Interfaces:**
- Consumes: Task 1's `stageKeySchema`, `personaIdentitySchema`, `pullRequestRefSchema`, `shipRefusalSchema`, `riskDeclarationSchema`, `delegationLapseSchema`.
- Produces: `eventNames`, `eventNameSchema`, `EventName`; `newEventSchema` / `NewHarnessEvent` (no `position`); `eventSchema` / `HarnessEvent` (with `position`); `eventEvidenceSchemas` (an object keyed by event name; `eventSchema` checks `evidence` against the entry for its name, and names without an entry take any JSON object); `EvidenceName`, `EventEvidence` (`{ [N in EvidenceName]: z.infer<…> }`).

- [ ] **Step 1: Write the failing test**

`packages/contracts/events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { eventNameSchema, eventSchema, newEventSchema } from './events.ts';

const base = {
  eventId: '00000000-0000-4000-8000-0000000000e1',
  harnessId: '00000000-0000-4000-8000-0000000000a1',
  itemId: '00000000-0000-4000-8000-0000000000b1',
  position: 1,
  at: '2026-10-01T09:00:00.000Z',
  actor: 'agent:builder',
  traceId: '00000000-0000-4000-8000-0000000000c1',
};

const claimed = {
  ...base,
  name: 'item_claimed',
  evidence: {
    holder: 'agent:builder',
    claimantKind: 'agent',
    delegationId: null,
    leaseExpiresAt: '2026-10-01T09:15:00.000Z',
  },
};

describe('KN-3 the event vocabulary is PRD section 8.6', () => {
  it('has the forty-five names and none of the placeholders it replaces', () => {
    expect(eventNameSchema.options).toHaveLength(45);
    expect(eventNameSchema.options[0]).toBe('item_created');
    expect(eventNameSchema.options.at(-1)).toBe('persona_activated');
    expect(eventNameSchema.safeParse('abandoned').success).toBe(false);
    expect(eventNameSchema.safeParse('branch_abandoned').success).toBe(true);
  });

  it('types evidence only for names in the vocabulary', () => {
    for (const name of Object.keys(eventEvidenceSchemas)) {
      expect(eventNameSchema.safeParse(name).success).toBe(true);
    }
  });
});

describe('KN-3 every event row carries harness, item, name, actor, evidence, trace id and position', () => {
  it('accepts a well-formed claim', () => {
    expect(eventSchema.safeParse(claimed).success).toBe(true);
  });

  it('refuses evidence that does not fit its name', () => {
    const wrong = { ...claimed, evidence: { claimantKind: 'agent' } };
    expect(eventSchema.safeParse(wrong).success).toBe(false);
  });

  it('refuses a position below one and an unknown name', () => {
    expect(eventSchema.safeParse({ ...claimed, position: 0 }).success).toBe(false);
    expect(eventSchema.safeParse({ ...claimed, name: 'merged' }).success).toBe(false);
  });

  it('has no position before the store assigns one', () => {
    const { position, ...unpositioned } = claimed;
    expect(position).toBe(1);
    expect(newEventSchema.safeParse(unpositioned).success).toBe(true);
    expect(newEventSchema.safeParse(claimed).success).toBe(false);
  });
});
```

Run: `pnpm vitest run packages/contracts/events.test.ts`
Expected: FAIL — `event-evidence.ts` does not exist.

- [ ] **Step 2: Create `packages/contracts/event-evidence.ts`**

```ts
import { z } from 'zod';
import {
  capabilityWordSchema,
  connectorSchema,
  costBasisSchema,
  delegationLapseSchema,
  gateDecisionSchema,
  principalKindSchema,
  riskDomainsSchema,
  riskTierSchema,
} from './closed-sets.ts';
import { personaIdentitySchema, pullRequestRefSchema, stageKeySchema } from './harness.ts';
import { identitySchema } from './identity.ts';
import { errorReasonSchema } from './outcomes.ts';
import { slugSchema } from './pages.ts';
import { riskDeclarationSchema, shipRefusalSchema } from './ship-rule.ts';
import { runStepSchema, submitToGateResultSchema } from './verb-io.ts';

const id = z.uuid();
const instant = z.iso.datetime();
const stage = stageKeySchema;
const text = z.string().min(1).max(500);
const head = z.string().min(1).max(64);
const effect = connectorSchema.exclude(['none']);
const tokens = z.number().int().min(0);
const nonBlank = z
  .string()
  .max(2000)
  .refine((value) => value.trim().length > 0, 'a reason is not blank');
const oneLine = z
  .string()
  .max(200)
  .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value), 'one line of reason');

const itemEvidence = {
  item_created: z.strictObject({
    stage,
    title: z.string().min(1).max(200),
    pageId: id.nullable(),
    priority: z.number().int(),
    due: z.iso.date().nullable(),
  }),
  item_claimed: z.strictObject({
    holder: identitySchema,
    claimantKind: principalKindSchema,
    delegationId: id.nullable(),
    leaseExpiresAt: instant.nullable(),
  }),
  item_released: z.strictObject({ holder: identitySchema }),
  lease_renewed: z.strictObject({ leaseExpiresAt: instant }),
  lease_expired: z.strictObject({ holder: identitySchema, leaseExpiresAt: instant }),
  branch_abandoned: z.strictObject({ head: head.nullable() }),
  branch_adopted: z.strictObject({ head: head.nullable() }),
  stage_advanced: z.strictObject({ from: stage, to: stage.nullable() }),
  loop_edge_taken: z.strictObject({ from: stage, to: stage }),
  risk_derived: z.strictObject({
    paths: z.array(z.string().min(1)),
    declaration: riskDeclarationSchema.nullable(),
    floorDomains: riskDomainsSchema,
    riskTier: riskTierSchema.nullable(),
    riskDomains: riskDomainsSchema,
    refusal: z.literal('risk_tier_undeclared').nullable(),
  }),
  run_step_recorded: z.strictObject({
    runId: id,
    step: runStepSchema,
    tokensIn: tokens,
    tokensOut: tokens,
    costBasis: costBasisSchema,
    leaseExpiresAt: instant,
  }),
  learning_attached: z.strictObject({ pageId: id }),
  nothing_learned: z.strictObject({ reason: oneLine }),
};

const gateEvidence = {
  submitted_to_gate: z.strictObject({
    stage,
    result: submitToGateResultSchema,
    to: stage.nullable(),
    expectedHead: head.nullable(),
    pullRequest: pullRequestRefSchema.nullable(),
    evidence: z.record(z.string(), z.json()),
  }),
  checks_passed: z.strictObject({ stage, validators: z.array(z.string().min(1)) }),
  checks_failed: z.strictObject({ stage, failures: z.array(text).min(1) }),
  gate_approved: z.strictObject({ decisionId: id, stage }),
  gate_rejected: z.strictObject({ decisionId: id, stage, findings: z.array(text) }),
  gate_taken_over: z.strictObject({ decisionId: id, stage, holder: identitySchema }),
  gate_overridden: z.strictObject({ decisionId: id, stage, reason: nonBlank }),
  gate_refused_to_agent: z.strictObject({ decision: gateDecisionSchema, stage }),
  ship_refused: z.strictObject({ stage, reasons: z.array(shipRefusalSchema).min(1) }),
  connector_succeeded: z.strictObject({
    connector: effect,
    detail: z.record(z.string(), z.string()),
  }),
  connector_refused: z.strictObject({ connector: effect, reason: text }),
};

const harnessEvidence = {
  delegation_granted: z.strictObject({
    delegationId: id,
    personId: id,
    persona: personaIdentitySchema,
    capability: capabilityWordSchema,
    expiresAt: instant,
    supersedes: id.nullable(),
  }),
  delegation_revoked: z.strictObject({ delegationId: id }),
  delegation_lapsed: z.strictObject({ delegationId: id, why: delegationLapseSchema }),
  delegation_required: z.strictObject({ stage }),
  stage_edit_refused: z.strictObject({
    stage: stage.nullable(),
    reason: errorReasonSchema,
    code: z.string().nullable(),
    constraint: z.string().nullable(),
  }),
  template_activated: z.strictObject({ template: slugSchema, stages: z.array(stage).min(1) }),
};

export const eventEvidenceSchemas = { ...itemEvidence, ...gateEvidence, ...harnessEvidence };

export type EvidenceName = keyof typeof eventEvidenceSchemas;
export type EventEvidence = {
  [Name in EvidenceName]: z.infer<(typeof eventEvidenceSchemas)[Name]>;
};
```

- [ ] **Step 3: Replace `packages/contracts/events.ts`**

```ts
import { z } from 'zod';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { identitySchema } from './identity.ts';

export const eventNames = [
  'item_created',
  'item_claimed',
  'item_released',
  'lease_renewed',
  'lease_expired',
  'branch_abandoned',
  'branch_adopted',
  'stage_advanced',
  'loop_edge_taken',
  'premise_held',
  'risk_derived',
  'label_removed',
  'run_started',
  'run_step_recorded',
  'run_failed',
  'run_hibernated',
  'run_resumed',
  'run_stopped',
  'submitted_to_gate',
  'checks_passed',
  'checks_failed',
  'gate_approved',
  'gate_rejected',
  'gate_taken_over',
  'gate_overridden',
  'gate_refused_to_agent',
  'ship_refused',
  'connector_succeeded',
  'connector_refused',
  'delegation_granted',
  'delegation_revoked',
  'delegation_lapsed',
  'delegation_required',
  'stage_edit_refused',
  'template_activated',
  'harness_paused',
  'harness_resumed',
  'learning_attached',
  'nothing_learned',
  'comment_recorded',
  'breaker_holding',
  'breaker_pausing',
  'breaker_open',
  'persona_activation_failed',
  'persona_activated',
] as const;

export const eventNameSchema = z.enum(eventNames);

const evidenceByName: ReadonlyMap<string, z.ZodType> = new Map(
  Object.entries(eventEvidenceSchemas),
);

function checkEvidence(
  event: { readonly name: string; readonly evidence: unknown },
  context: z.RefinementCtx,
): void {
  const schema = evidenceByName.get(event.name);
  if (!schema) return;
  const result = schema.safeParse(event.evidence);
  if (result.success) return;
  context.addIssue({
    code: 'custom',
    path: ['evidence'],
    message: `evidence does not fit ${event.name}: ${result.error.issues.map((issue) => issue.message).join('; ')}`,
  });
}

const fields = {
  eventId: z.uuid(),
  harnessId: z.uuid(),
  itemId: z.uuid().nullable(),
  name: eventNameSchema,
  at: z.iso.datetime(),
  actor: identitySchema,
  evidence: z.record(z.string(), z.json()),
  traceId: z.uuid(),
};

export const newEventSchema = z.strictObject(fields).superRefine(checkEvidence);
export const eventSchema = z
  .strictObject({ ...fields, position: z.number().int().min(1) })
  .superRefine(checkEvidence);

export type EventName = z.infer<typeof eventNameSchema>;
export type NewHarnessEvent = z.infer<typeof newEventSchema>;
export type HarnessEvent = z.infer<typeof eventSchema>;
```

Export `event-evidence.ts` from `index.ts`. Register `'new-event': newEventSchema` in `schemaRegistry` (keep `event` and `event-name`).

- [ ] **Step 4: Fixtures, the old test, version, lock, pins**

- `fixtures/event-name/valid/first.json` `"item_created"`, `last.json` `"persona_activated"`; `invalid/unknown.json` `"merged"`; add `invalid/abandoned.json` `"abandoned"`.
- `fixtures/event/valid/`: `item-claimed.json` (the `claimed` object above), `item-created.json` (evidence `{"stage":"package","title":"Wire the board","pageId":null,"priority":0,"due":null}`), `template-activated.json` (`itemId` null, evidence `{"template":"software","stages":["package","scope"]}`), `gate-approved.json` (rewrite: evidence `{"decisionId":"00000000-0000-4000-8000-0000000000d1","stage":"ship"}`, actor `human:00000000-0000-4000-8000-000000000001`). Delete the old `gate-approved.json` content entirely.
- `fixtures/event/invalid/`: `unknown-name.json`, `bad-instant.json` (keep, rewritten to the new envelope), `position-zero.json`, `claimed-without-holder.json`.
- `fixtures/new-event/valid/item-created.json` (as above without `position`); `invalid/with-position.json`.
- In `contracts.test.ts`, replace the loop over `['gate_approved', 'lease_expired', 'delegation_lapsed', 'abandoned']` with one over `['gate_approved', 'lease_expired', 'delegation_lapsed', 'branch_abandoned']` and add `expect(eventNameSchema.safeParse('abandoned').success).toBe(false);`.
- `CONTRACT_VERSION = '3.0.0'` (removing `abandoned` is breaking). Append a `3.0.0` lock entry: the `2.4.0` sets with `event-name` replaced by the forty-five names. Set both apps' `contractVersion` to `3.0.0`.

Run: `pnpm vitest run packages/contracts apps/uw-app/contract-conformance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the contract (shared root)**

```bash
git add packages/contracts apps/uw-app/package.json apps/uw-ingest/package.json
git commit -m "feat(contracts): the PRD 8.6 event vocabulary, an envelope with item, position and trace id, typed evidence; contract 3.0.0" -m "Shared root packages/contracts: KN-3 needs the closed vocabulary and the row shape before the event log exists. The four placeholders are replaced (abandoned becomes branch_abandoned), so a major version. Rejected: per-name event schemas as a discriminated union, which would make every new event a breaking change to the union." -m "KN-3 CT-3"
```

- [ ] **Step 6: Fix the sim report for the new envelope**

In `sim/runner/report.ts`, `eventLine` prints `#${event.position}` after the index and `JSON.stringify(event.evidence)` instead of `event.payload`. In `sim/runner/report.test.ts`, build events with the new fields (`itemId`, `position`, `evidence`, `traceId`) and use an event name from the new vocabulary (`item_created` with item-created evidence). Update the expected line text accordingly.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add sim/runner/report.ts sim/runner/report.test.ts
git commit -m "fix(sim): print each event's position and evidence" -m "KN-3"
```

### Task 3: The harness tables and the Ship invariant

**Requirements:** KN-1 (every table but `harness_events`, which is Task 4), KN-2, DX-6 (KN-2 on both databases), AGENTS.md rule 3 (one writer per table, extended to gateways).

**Files:**
- Modify: `packages/db/schema.ts`, `packages/db/checks.ts`
- Create (generated, then reviewed): `packages/db/migrations/0004_harness_tables.sql`, `packages/db/migrations/0005_gate_decisions_append_only.sql` (custom), their `meta/` snapshots and `_journal.json` entries
- Create: `packages/db/harness-tables.test.ts`, `packages/db/ship-invariant.test.ts`, `packages/db/kernel-defaults.test.ts`
- Create: `packages/harness/stages/owns.ts`, `packages/harness/items/owns.ts`, `packages/harness/gates/owns.ts`, `packages/harness/delegations/owns.ts`, `packages/harness/runs/owns.ts`, `packages/harness/measurements/owns.ts`, `packages/harness/personas/owns.ts`
- Modify: `tools/architecture/owners.test.ts`
- Modify (own commit): `AGENTS.md` rule 3
- Modify (own commit): `docs/PRD.md` section 8.1

**Interfaces:**
- Consumes: Task 1's closed sets and `stageKeyPattern`, `personaIdentityPattern`.
- Produces: Drizzle exports `harnesses`, `harnessStages`, `harnessItems`, `harnessRuns`, `gateDecisions`, `delegations`, `measurements`, `personas`; constraint names below (later tests assert them); `owns` in each owner module; the owners check's gateway pattern `<exportName>.write`.

- [ ] **Step 1: Write the failing tests**

`packages/db/ship-invariant.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const at = new Date('2026-10-01T09:00:00.000Z');

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

function insertStage(db: OpenedDatabase['db'], id: string, connector: string, exitGate: string | null) {
  return db.execute(sql`INSERT INTO harness_stages
    (id, harness_id, key, title, position, bracket, agent_pickup, exit_gate, connector)
    VALUES (${id}, ${harnessId}, ${`s${id.slice(-4)}`}, 'Stage', ${Number.parseInt(id.slice(-4), 16)},
      'deploy_package', 'none', ${exitGate}, ${connector})`);
}

function stageId(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

async function columnFacts(db: OpenedDatabase['db']) {
  return db.execute<{ column_name: string; is_nullable: string; column_default: string | null }>(
    sql`SELECT column_name, is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'harness_stages' AND column_name IN ('connector', 'exit_gate')
        ORDER BY column_name`,
  );
}

function describeTarget(target: DatabaseTarget): void {
  let opened: OpenedDatabase | undefined;
  const db = () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
  beforeAll(async () => {
    opened = await target.open();
    await db().execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
      VALUES (${harnessId}, 'software', 'software', '80-89', ${at})`);
  }, 60_000);
  afterAll(() => opened?.close());

  it('declares connector and exit_gate NOT NULL, connector defaulting to none', async () => {
    const rows = [...(await columnFacts(db()))];
    expect(rows.map((row) => [row.column_name, row.is_nullable])).toEqual([
      ['connector', 'NO'],
      ['exit_gate', 'NO'],
    ]);
    expect(rows[0]?.column_default).toMatch(/^'none'/);
  });

  it('holds the constraint connector = none OR exit_gate = human_approval', async () => {
    const rows = await db().execute<{ definition: string }>(
      sql`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
          WHERE conname = 'harness_stages_effect_needs_human_gate'`,
    );
    expect(rows[0]?.definition).toMatch(/connector.*'none'.*OR.*exit_gate.*'human_approval'/);
  });

  it('refuses an insert of (merge, checks) and of (merge, NULL)', async () => {
    expect(await refusal(insertStage(db(), stageId(0x10), 'merge', 'checks'))).toEqual({
      code: '23514',
      constraint: 'harness_stages_effect_needs_human_gate',
    });
    expect((await refusal(insertStage(db(), stageId(0x11), 'merge', null))).code).toBe('23502');
  });

  it('refuses an update to (merge, checks) and accepts (merge, human_approval)', async () => {
    await insertStage(db(), stageId(0x20), 'merge', 'human_approval');
    const lowered = db().execute(
      sql`UPDATE harness_stages SET exit_gate = 'checks' WHERE id = ${stageId(0x20)}`,
    );
    expect(await refusal(lowered)).toEqual({
      code: '23514',
      constraint: 'harness_stages_effect_needs_human_gate',
    });
  });
}

describe('KN-2 DX-6 the Ship invariant holds in Postgres', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => describeTarget(target),
  );
});
```

`packages/db/harness-tables.test.ts` (KN-1), on every `databaseTargets` entry:
- `it('KN-1 declares classification and offline eligibility on every harness table')`: `declarationOf(table)` for each of the eight exports equals: `harnesses`, `harness_stages`, `harness_items` `internal`/`sync`; `harness_runs` `internal`/`never`; `gate_decisions` `restricted`/`never`; `delegations` `restricted`/`never`; `measurements` `internal`/`cache_readonly`; `personas` `internal`/`sync`.
- the eight tables exist with the columns of PRD 8.1 (query `information_schema.columns` and assert each table's column list equals the list in Step 3, in order of `ordinal_position`).
- `harnesses.jd_area` is NOT NULL and an insert with `jd_area` `'80-99'` is refused `23514` `harnesses_area_form`.
- `gate_decisions`: an insert with actor `agent:builder` is refused `gate_decisions_actor_is_human`; an `override` with a blank reason is refused `gate_decisions_override_has_reason`; an UPDATE and a DELETE of an inserted row are refused with SQLSTATE `P0001` (`gate_decisions_no_update_or_delete`). Name this `describe('KN-13 gate_decisions takes only a human actor and is append-only', …)`.
- `harness_items`: a person claim with a lease is refused `harness_items_person_has_no_lease`; `risk_domains` `{ui}` is refused `harness_items_risk_domains_known`; a stage id of another harness is refused by `harness_items_stage_fk` (`23503`).

Seed rows with `db.execute(sql\`INSERT …\`)` and explicit ids and instants (no column has a default to lean on).

`packages/db/kernel-defaults.test.ts`:

```ts
import { getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema.ts';

const kernelTables: readonly PgTable[] = [
  schema.harnesses,
  schema.harnessStages,
  schema.harnessItems,
  schema.harnessRuns,
  schema.gateDecisions,
  schema.delegations,
  schema.measurements,
  schema.personas,
];

const stampedTypes = new Set(['PgUUID', 'PgTimestamp', 'PgTimestampString', 'PgDate', 'PgDateString']);

function defaulted(table: PgTable): string[] {
  return Object.entries(getTableColumns(table))
    .filter(([, column]) => stampedTypes.has(column.columnType) && column.hasDefault)
    .map(([name]) => name);
}

describe('kernel tables take every instant and id from the command, so the sim is deterministic', () => {
  it.each(kernelTables.map((table) => [table] as const))('%s has no default on an id or instant', (table) => {
    expect(defaulted(table)).toEqual([]);
  });

  it('flags a default it is shown', () => {
    expect(defaulted(schema.people)).toContain('id');
  });
});
```

Task 4 adds `schema.harnessEvents` to `kernelTables`.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run packages/db/ship-invariant.test.ts packages/db/harness-tables.test.ts packages/db/kernel-defaults.test.ts`
Expected: FAIL — the tables do not exist.

- [ ] **Step 2: Add check helpers**

Append to `packages/db/checks.ts`:

```ts
import { personaIdentityPattern, stageKeyPattern } from '@uw/contracts';

export function subsetOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const unsafe = values.filter((value) => !plainWord.test(value));
  if (unsafe.length > 0) {
    throw new TypeError(`closed-set values must be plain words: ${unsafe.join(', ')}`);
  }
  return sql`${column} <@ ARRAY[${sql.raw(values.map((value) => `'${value}'`).join(', '))}]::text[]`;
}

export const STAGE_KEY_PATTERN = stageKeyPattern;
export const PERSONA_IDENTITY_PATTERN = personaIdentityPattern;
export const HUMAN_IDENTITY_PATTERN = '^human:[A-Za-z0-9][A-Za-z0-9_-]*$';
```

(Merge the import into the file's existing `@uw/contracts` import.)

- [ ] **Step 3: Declare the eight tables in `packages/db/schema.ts`**

Add `bigint`, `boolean`, `date`, `doublePrecision`, `unique` to the `drizzle-orm/pg-core` import and the closed-set schemas to the `@uw/contracts` import. Append:

```ts
const internalSync = { classification: 'internal', offlineEligibility: 'sync' } as const;
const restrictedNever = { classification: 'restricted', offlineEligibility: 'never' } as const;
const emptyText = sql`'{}'::text[]`;

export const harnesses = declareTable(
  'harnesses',
  {
    id: uuid('id').primaryKey(),
    key: text('key').notNull().unique(),
    template: text('template').notNull(),
    jdArea: text('jd_area').notNull(),
    hostedBuilderEnabled: boolean('hosted_builder_enabled').notNull().default(false),
    paused: boolean('paused').notNull().default(false),
    createdAt: instant('created_at').notNull(),
  },
  internalSync,
  (t) => [
    check('harnesses_area_form', matches(t.jdArea, JD_AREA_PATTERN)),
    check('harnesses_key_form', matches(t.key, SLUG_PATTERN)),
    check('harnesses_template_form', matches(t.template, SLUG_PATTERN)),
  ],
);

export const harnessStages = declareTable(
  'harness_stages',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    key: text('key').notNull(),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    bracket: text('bracket').notNull(),
    agentPickup: text('agent_pickup').notNull(),
    exitGate: text('exit_gate').notNull(),
    connector: text('connector').notNull().default('none'),
    wipLimit: integer('wip_limit').notNull().default(3),
    instructionsPageId: uuid('instructions_page_id').references(() => pages.id),
    validators: text('validators').array().notNull().default(emptyText),
    feeds: text('feeds').array().notNull().default(emptyText),
    paused: boolean('paused').notNull().default(false),
  },
  internalSync,
  (t) => [
    check(
      'harness_stages_effect_needs_human_gate',
      sql`${t.connector} = 'none' OR ${t.exitGate} = 'human_approval'`,
    ),
    check('harness_stages_connector_known', oneOf(t.connector, connectorSchema.options)),
    check('harness_stages_exit_gate_known', oneOf(t.exitGate, exitGateSchema.options)),
    check('harness_stages_agent_pickup_known', oneOf(t.agentPickup, agentPickupSchema.options)),
    check('harness_stages_bracket_known', oneOf(t.bracket, stageBracketSchema.options)),
    check('harness_stages_key_form', matches(t.key, STAGE_KEY_PATTERN)),
    check('harness_stages_position_positive', sql`${t.position} > 0`),
    check('harness_stages_wip_limit_positive', sql`${t.wipLimit} >= 1`),
    uniqueIndex('harness_stages_key_per_harness').on(t.harnessId, t.key),
    uniqueIndex('harness_stages_position_per_harness').on(t.harnessId, t.position),
    unique('harness_stages_harness_and_id').on(t.harnessId, t.id),
  ],
);

export const delegations = declareTable(
  'delegations',
  {
    id: uuid('id').primaryKey(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    persona: text('persona').notNull(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    capability: text('capability').notNull(),
    grantedAt: instant('granted_at').notNull(),
    expiresAt: instant('expires_at').notNull(),
    revokedAt: instant('revoked_at'),
    lapsedAt: instant('lapsed_at'),
    supersedes: uuid('supersedes'),
    traceId: uuid('trace_id').notNull(),
  },
  restrictedNever,
  (t) => [
    foreignKey({ name: 'delegations_supersedes_fk', columns: [t.supersedes], foreignColumns: [t.id] }),
    check('delegations_capability_known', oneOf(t.capability, capabilityWordSchema.options)),
    check('delegations_persona_form', matches(t.persona, PERSONA_IDENTITY_PATTERN)),
    check('delegations_expires_after_grant', sql`${t.expiresAt} > ${t.grantedAt}`),
    index('delegations_person').on(t.personId),
    index('delegations_harness').on(t.harnessId),
  ],
);

export const harnessItems = declareTable(
  'harness_items',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    stageId: uuid('stage_id').notNull(),
    title: text('title').notNull(),
    pageId: uuid('page_id').references(() => pages.id),
    priority: integer('priority').notNull().default(0),
    due: date('due', { mode: 'string' }),
    claimedBy: text('claimed_by'),
    claimantKind: text('claimant_kind'),
    delegationId: uuid('delegation_id').references(() => delegations.id),
    leaseExpires: instant('lease_expires'),
    gateStatus: text('gate_status').notNull().default('working'),
    gateTarget: text('gate_target'),
    riskTier: text('risk_tier'),
    riskDomains: text('risk_domains').array().notNull().default(emptyText),
    expectedHead: text('expected_head'),
    branchState: text('branch_state').notNull().default('none'),
    prRepo: text('pr_repo'),
    prNumber: integer('pr_number'),
    zulipTopic: text('zulip_topic'),
    createdAt: instant('created_at').notNull(),
  },
  internalSync,
  (t) => [
    foreignKey({
      name: 'harness_items_stage_fk',
      columns: [t.harnessId, t.stageId],
      foreignColumns: [harnessStages.harnessId, harnessStages.id],
    }),
    unique('harness_items_harness_and_id').on(t.harnessId, t.id),
    check('harness_items_claimant_kind_known', oneOf(t.claimantKind, principalKindSchema.options)),
    check('harness_items_holder_has_kind', sql`(${t.claimedBy} IS NULL) = (${t.claimantKind} IS NULL)`),
    check('harness_items_claimed_by_is_identity', matches(t.claimedBy, IDENTITY_PATTERN)),
    check('harness_items_lease_only_when_held', sql`${t.leaseExpires} IS NULL OR ${t.claimedBy} IS NOT NULL`),
    check(
      'harness_items_person_has_no_lease',
      sql`${t.claimantKind} IS DISTINCT FROM 'person' OR ${t.leaseExpires} IS NULL`,
    ),
    check('harness_items_gate_status_known', oneOf(t.gateStatus, gateStatusSchema.options)),
    check('harness_items_gate_target_form', matches(t.gateTarget, STAGE_KEY_PATTERN)),
    check('harness_items_branch_state_known', oneOf(t.branchState, branchStateSchema.options)),
    check('harness_items_risk_tier_known', oneOf(t.riskTier, riskTierSchema.options)),
    check('harness_items_risk_domains_known', subsetOf(t.riskDomains, riskDomainSchema.options)),
    check('harness_items_pr_whole', sql`(${t.prRepo} IS NULL) = (${t.prNumber} IS NULL)`),
    index('harness_items_stage').on(t.harnessId, t.stageId),
    index('harness_items_lease').on(t.leaseExpires),
  ],
);

export const harnessRuns = declareTable(
  'harness_runs',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id').notNull(),
    itemId: uuid('item_id').notNull(),
    persona: text('persona').notNull(),
    runShape: text('run_shape').notNull(),
    engine: text('engine').notNull(),
    model: text('model').notNull(),
    resolvedProvider: text('resolved_provider'),
    steps: jsonb('steps').notNull().default(sql`'[]'::jsonb`),
    costMinor: bigint('cost_minor', { mode: 'number' }),
    costBasis: text('cost_basis').notNull(),
    traceId: uuid('trace_id').notNull(),
    outcome: text('outcome').notNull(),
    startedAt: instant('started_at').notNull(),
    endedAt: instant('ended_at'),
  },
  { classification: 'internal', offlineEligibility: 'never' },
  (t) => [
    foreignKey({
      name: 'harness_runs_item_fk',
      columns: [t.harnessId, t.itemId],
      foreignColumns: [harnessItems.harnessId, harnessItems.id],
    }),
    check('harness_runs_persona_form', matches(t.persona, IDENTITY_PATTERN)),
    check('harness_runs_run_shape_known', oneOf(t.runShape, runShapeSchema.options)),
    check('harness_runs_engine_known', oneOf(t.engine, engineSchema.options)),
    check('harness_runs_cost_basis_known', oneOf(t.costBasis, costBasisSchema.options)),
    check('harness_runs_outcome_known', oneOf(t.outcome, runOutcomeSchema.options)),
    index('harness_runs_item').on(t.itemId),
  ],
);

export const gateDecisions = declareTable(
  'gate_decisions',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id').notNull(),
    itemId: uuid('item_id').notNull(),
    stageId: uuid('stage_id').notNull(),
    actor: text('actor').notNull(),
    decision: text('decision').notNull(),
    reason: text('reason'),
    evidence: jsonb('evidence').notNull(),
    traceId: uuid('trace_id').notNull(),
    decidedAt: instant('decided_at').notNull(),
  },
  restrictedNever,
  (t) => [
    foreignKey({
      name: 'gate_decisions_item_fk',
      columns: [t.harnessId, t.itemId],
      foreignColumns: [harnessItems.harnessId, harnessItems.id],
    }),
    foreignKey({
      name: 'gate_decisions_stage_fk',
      columns: [t.harnessId, t.stageId],
      foreignColumns: [harnessStages.harnessId, harnessStages.id],
    }),
    check('gate_decisions_decision_known', oneOf(t.decision, gateDecisionSchema.options)),
    check('gate_decisions_actor_is_human', matches(t.actor, HUMAN_IDENTITY_PATTERN)),
    check(
      'gate_decisions_override_has_reason',
      sql`${t.decision} <> 'override' OR length(btrim(coalesce(${t.reason}, ''))) > 0`,
    ),
    index('gate_decisions_item').on(t.itemId),
  ],
);

export const measurements = declareTable(
  'measurements',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    itemId: uuid('item_id'),
    source: text('source').notNull(),
    name: text('name').notNull(),
    value: doublePrecision('value').notNull(),
    asOf: date('as_of', { mode: 'string' }).notNull(),
    recordedAt: instant('recorded_at').notNull(),
  },
  { classification: 'internal', offlineEligibility: 'cache_readonly' },
  (t) => [
    foreignKey({
      name: 'measurements_item_fk',
      columns: [t.harnessId, t.itemId],
      foreignColumns: [harnessItems.harnessId, harnessItems.id],
    }),
    check('measurements_source_known', oneOf(t.source, dataSourceKindSchema.options)),
    index('measurements_item').on(t.itemId),
  ],
);

export const personas = declareTable(
  'personas',
  {
    identity: text('identity').primaryKey(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    pageId: uuid('page_id')
      .notNull()
      .unique()
      .references(() => pages.id),
  },
  internalSync,
  (t) => [check('personas_identity_form', matches(t.identity, PERSONA_IDENTITY_PATTERN))],
);
```

The KN-1 column lists the test asserts are exactly the columns above, in declaration order. `matches(column, …)` and `oneOf(column, …)` evaluate to NULL on a NULL column, so a CHECK passes for NULL; that is intended for the nullable columns.

- [ ] **Step 4: Generate the migrations**

```bash
pnpm --filter @uw/db exec drizzle-kit generate --name harness_tables
pnpm --filter @uw/db exec drizzle-kit generate --custom --name gate_decisions_append_only
```

Read `0004_harness_tables.sql`: every CHECK above, both unique constraints used as composite foreign-key targets, and every foreign key must be present; `connector` must read `DEFAULT 'none' NOT NULL`; no `DEFAULT now()` and no `gen_random_uuid()` anywhere in it. Fill `0005_gate_decisions_append_only.sql`:

```sql
CREATE FUNCTION gate_decisions_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'gate_decisions is append-only' USING ERRCODE = 'P0001';
END
$$;
--> statement-breakpoint
CREATE TRIGGER gate_decisions_no_update_or_delete BEFORE UPDATE OR DELETE ON gate_decisions FOR EACH ROW EXECUTE FUNCTION gate_decisions_refuse_change();
--> statement-breakpoint
CREATE TRIGGER gate_decisions_no_truncate BEFORE TRUNCATE ON gate_decisions FOR EACH STATEMENT EXECUTE FUNCTION gate_decisions_refuse_change();
```

- [ ] **Step 5: Declare the owners**

Each file exports only its `owns` constant:

| File | `owns` |
|---|---|
| `packages/harness/stages/owns.ts` | `['harnesses', 'harness_stages'] as const` |
| `packages/harness/items/owns.ts` | `['harness_items'] as const` (Task 4 adds `'harness_events'`) |
| `packages/harness/gates/owns.ts` | `['gate_decisions'] as const` |
| `packages/harness/delegations/owns.ts` | `['delegations'] as const` |
| `packages/harness/runs/owns.ts` | `['harness_runs'] as const` |
| `packages/harness/measurements/owns.ts` | `['measurements'] as const` |
| `packages/harness/personas/owns.ts` | `['personas'] as const` |

In `tools/architecture/owners.test.ts`: import the seven, add them to `owners` with their directories (`packages/harness/stages/`, …), and extend `writes()` with a third pattern so a gateway write counts as a write:

```ts
new RegExp(`\\b${entry.exportName}\\.write\\b`),
```

Add a planted case to the planted-tree tests: a file `packages/harness/items/stray.ts` containing `await tx.harnessStages.write.insert(row);` is reported as writing `harness_stages` outside its owner, and `packages/harness/stages/ok.ts` with the same line is not. Name the describe `AGENTS.md rule 3: a gateway write is a write`.

- [ ] **Step 6: Run the tests**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run packages/db tools/architecture/owners.test.ts`
Expected: PASS on the embedded and the server targets.

- [ ] **Step 7: Commit the schema (shared root)**

```bash
git add packages/db/schema.ts packages/db/checks.ts packages/db/migrations
git commit -m "feat(db): harness tables with the Ship invariant as a null-safe check, and an append-only gate_decisions" -m "Shared root packages/db/schema.ts: KN-1's tables. connector and exit_gate are NOT NULL and CHECK (connector = 'none' OR exit_gate = 'human_approval') holds on insert and update (KN-2). Every id and instant comes from the command, so no column default stamps the wall clock in the sim. Rejected: Postgres enums (P4), a trigger for the invariant (a check applies to both insert and update)." -m "KN-1 KN-2"
```

- [ ] **Step 8: Commit the tests and the owners**

```bash
git add packages/db/*.test.ts packages/harness/*/owns.ts tools/architecture/owners.test.ts
git commit -m "test(db): the Ship invariant on both databases, the harness tables and their owners" -m "KN-1 KN-2 KN-13 DX-6"
```

- [ ] **Step 9: AGENTS.md rule 3 (shared root, own commit)**

Add one bullet to rule 3: "- A kernel table is written through its Store gateway's `write` half (`tx.<table>.write.*`), named after the table's Drizzle export; only the table's owner module calls it, and `tools/architecture/owners.test.ts` treats that call as a write."

```bash
git add AGENTS.md
git commit -m "docs(agents): a kernel table's gateway write counts as a write under rule 3" -m "Shared root AGENTS.md: the kernel reaches Postgres through Store gateways, so the one-writer check needs the gateway form spelled out." -m "KN-1"
```

- [ ] **Step 10: PRD 8.1 columns**

In `docs/PRD.md` section 8.1 add the columns this step settles: `harnesses` created at; `harness_stages` title, bracket (P31); `harness_items` delegation, gate status, gate target, pull request repository, created at (with `pr_number`); `delegations` lapsed at, supersedes (P14), trace id; `gate_decisions` harness and trace id; `harness_runs` has no separate host column (the run shape names the host). Run verify and commit `docs(prd): the step 3 harness columns in 8.1` with `KN-1` in the body.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

### Task 4: The append-only event log with a resumable position

**Requirements:** KN-3, DX-6 (the trigger tests on both databases), Review Focus 1.

**Files:**
- Modify: `packages/db/schema.ts`, `packages/db/kernel-defaults.test.ts`, `packages/harness/items/owns.ts`
- Create: `packages/db/migrations/0006_harness_events.sql` (generated), `packages/db/migrations/0007_harness_events_append_only.sql` (custom), snapshots and journal entries
- Create: `packages/db/event-log.test.ts`, `packages/db/event-log-order.test.ts`

**Interfaces:**
- Produces: Drizzle export `harnessEvents`; the role `uw_app`; trigger names `harness_events_no_update_or_delete`, `harness_events_no_truncate`, `harness_events_position`; the advisory key text `'harness_events:' || harness_id`; constraint names `harness_events_name_known`, `harness_events_position_per_harness`, `harness_events_item_fk`.

- [ ] **Step 1: Write the failing tests**

`packages/db/event-log.test.ts`, on every `databaseTargets` entry, `describe('KN-3 DX-6 harness_events is append-only and positioned per harness', …)`. Seed two harnesses with raw SQL, then:
- inserting three events for harness A and two for B (one multi-row INSERT for A's first two) gives A positions `[1, 2, 3]` and B `[1, 2]` (`SELECT position … ORDER BY position`);
- an insert that supplies `position = 99` is stored at the next position, not 99;
- an UPDATE, a DELETE and a TRUNCATE of `harness_events` each fail with SQLSTATE `P0001`;
- an insert with `name = 'merged'` fails `23514` `harness_events_name_known`, and with `name = 'abandoned'` too;
- an event whose `item_id` belongs to the other harness fails `23503` `harness_events_item_fk`;
- `has_table_privilege('uw_app', 'harness_events', p)` is `false` for `UPDATE`, `DELETE`, `TRUNCATE` and `true` for `SELECT`, `INSERT`;
- inside one `db.transaction`, `SET LOCAL ROLE uw_app` then an UPDATE fails `42501` (permission); inside a second, separate transaction (the first is aborted by its error), `SET LOCAL ROLE uw_app` then an INSERT succeeds.

Insert helper (raw SQL, explicit id, `at` and trace id):

```ts
function insertEvent(db: AnyDatabase, harnessId: string, n: number, name = 'item_created') {
  return db.execute(sql`INSERT INTO harness_events (id, harness_id, item_id, name, actor, evidence, trace_id, at)
    VALUES (${eventId(harnessId, n)}, ${harnessId}, NULL, ${name}, 'human:00000000-0000-4000-8000-000000000001',
      '{}'::jsonb, ${traceId}, ${at})`);
}
```

`packages/db/event-log-order.test.ts`, `describe.skipIf(!testServer)('KN-3 DX-6 positions become visible in order on two connections', …)`:

```ts
it('holds a second append behind the first until it commits, and never skips a position', async () => {
  const database = await createMigratedDatabase(testServer ?? '');
  const first = createClient(database.connectionString);
  const second = createClient(database.connectionString);
  try {
    await seedHarness(first, harnessA);
    let releaseFirst: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstDone = first.transaction(async (tx) => {
      await insertEvent(tx, harnessA, 1);
      await held;
    });
    await waitUntilLocked(second, harnessA);
    const secondDone = second.transaction((tx) => insertEvent(tx, harnessA, 2));
    await pause(150);
    expect(await positions(second, harnessA)).toEqual([]);
    releaseFirst();
    await Promise.all([firstDone, secondDone]);
    expect(await positions(second, harnessA)).toEqual([1, 2]);
  } finally {
    await first.$client.end();
    await second.$client.end();
    await database.drop();
  }
});
```

`waitUntilLocked` polls `pg_locks` (`locktype = 'advisory' AND granted`) on the second connection every 20 ms for up to 2 s; `positions` selects `position` ordered. Hoist all helpers to top level.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run packages/db/event-log.test.ts packages/db/event-log-order.test.ts`
Expected: FAIL — `harness_events` does not exist.

- [ ] **Step 2: Declare the table**

Append to `packages/db/schema.ts` (import `eventNameSchema`):

```ts
export const harnessEvents = declareTable(
  'harness_events',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    itemId: uuid('item_id'),
    position: bigint('position', { mode: 'number' }).notNull().default(0),
    name: text('name').notNull(),
    actor: text('actor').notNull(),
    evidence: jsonb('evidence').notNull(),
    traceId: uuid('trace_id').notNull(),
    at: instant('at').notNull(),
  },
  internalSync,
  (t) => [
    foreignKey({
      name: 'harness_events_item_fk',
      columns: [t.harnessId, t.itemId],
      foreignColumns: [harnessItems.harnessId, harnessItems.id],
    }),
    check('harness_events_name_known', oneOf(t.name, eventNameSchema.options)),
    check('harness_events_actor_is_identity', matches(t.actor, IDENTITY_PATTERN)),
    check('harness_events_position_positive', sql`${t.position} >= 1`),
    uniqueIndex('harness_events_position_per_harness').on(t.harnessId, t.position),
    index('harness_events_item').on(t.itemId, t.position),
  ],
);
```

The `0` default exists only so Drizzle's insert type does not demand a position; the trigger always replaces it, and the CHECK refuses a row that kept it. Add `schema.harnessEvents` to `kernelTables` in `kernel-defaults.test.ts`, and `'harness_events'` to `packages/harness/items/owns.ts`.

- [ ] **Step 3: Generate and fill the migrations**

```bash
pnpm --filter @uw/db exec drizzle-kit generate --name harness_events
pnpm --filter @uw/db exec drizzle-kit generate --custom --name harness_events_append_only
```

`0007_harness_events_append_only.sql`:

```sql
CREATE FUNCTION harness_events_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'harness_events is append-only' USING ERRCODE = 'P0001';
END
$$;
--> statement-breakpoint
CREATE TRIGGER harness_events_no_update_or_delete BEFORE UPDATE OR DELETE ON harness_events FOR EACH ROW EXECUTE FUNCTION harness_events_refuse_change();
--> statement-breakpoint
CREATE TRIGGER harness_events_no_truncate BEFORE TRUNCATE ON harness_events FOR EACH STATEMENT EXECUTE FUNCTION harness_events_refuse_change();
--> statement-breakpoint
CREATE FUNCTION harness_events_assign_position() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('harness_events:' || NEW.harness_id::text, 0));
  NEW.position := coalesce((SELECT max(position) FROM harness_events WHERE harness_id = NEW.harness_id), 0) + 1;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER harness_events_position BEFORE INSERT ON harness_events FOR EACH ROW EXECUTE FUNCTION harness_events_assign_position();
--> statement-breakpoint
DO $$ BEGIN CREATE ROLE uw_app NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uw_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO uw_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON harness_events, gate_decisions, grant_audit FROM PUBLIC, uw_app;
```

Why it is cursor-safe: the advisory lock is held until the inserting transaction ends, and under read committed the `max(position)` in the next transaction's trigger runs after it acquires the lock, so it sees the committed row. Positions therefore commit in increasing order per harness and a reader that resumes after position *n* never misses a later-committed *n − 1*. The cost: appends to one harness serialize until commit (recorded in the tracker).

- [ ] **Step 4: Run, then commit the schema and the tests separately**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run packages/db`
Expected: PASS on both targets; the order test ran.

```bash
git add packages/db/schema.ts packages/db/migrations
git commit -m "feat(db): harness_events, append-only by trigger and grant, positioned per harness under a lock held to commit" -m "Shared root packages/db/schema.ts: KN-3's event log. The application role uw_app holds SELECT and INSERT only, a trigger refuses UPDATE, DELETE and TRUNCATE for every role, the name is CHECKed against the 8.6 vocabulary (P4), and a BEFORE INSERT trigger assigns the next per-harness position (P7) under an advisory lock, so a cursor never skips. Rejected: a sequence (gaps and out-of-order commits), a counter column on harnesses (a second writer of that table)." -m "KN-3"
git add packages/db/*.test.ts packages/harness/items/owns.ts
git commit -m "test(db): the event log refuses change, names, and out-of-order positions on both databases" -m "KN-3 DX-6"
```

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

### Task 5: Store gateways for harnesses, stages, items and pages; the store refusal

**Requirements:** KN-1 (the kernel reaches its tables through the Store port), DX-2 (one Drizzle implementation bound by both adapters), DX-3 (the Store contract covers every gateway). Decides open question 2 (`executorOf`) and part of 3.

**Files:**
- Modify (own commit): `packages/harness/ports.ts`
- Modify: `packages/harness/port-errors.ts`, `packages/harness/index.ts`, `packages/harness/port-contracts/store.ts`
- Create: `packages/harness/port-contracts/store-gateways.ts`, `packages/harness/port-errors.test.ts` (extend if it exists)
- Create: `packages/db/store/refusal.ts`, `packages/db/store/types.ts`, `packages/db/store/rows.ts`, `packages/db/store/harnesses.ts`, `packages/db/store/stages.ts`, `packages/db/store/items.ts`, `packages/db/store/pages.ts`
- Modify: `packages/db/store/store.ts`, `packages/db/store/index.ts`, `packages/db/test-seed.ts`
- Modify: `sim/adapters/store.contract.test.ts`, `apps/uw-app/ports/store.contract.pg.test.ts` (provide `seedPage`)
- Modify: `.dependency-cruiser.mjs`, `tools/architecture/rules.test.ts`
- Modify: `docs/exceptions.md` (the `packages/db/test-seed.ts` row now also seeds `pages`)

**Interfaces:**
- Consumes: Task 1's `Harness`, `Stage`, `ItemState`; Task 3's tables.
- Produces, in `packages/harness/ports.ts`:

```ts
export type ItemClaim = {
  readonly itemId: string;
  readonly holder: Identity;
  readonly claimantKind: PrincipalKind;
  readonly delegationId: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly at: Date;
};
export type PageFacts = {
  readonly id: string;
  readonly type: PageType;
  readonly status: PageStatus;
  readonly jdArea: string;
  readonly bodyMd: string;
};
export type StagePosition = { readonly id: string; readonly position: number };

export type HarnessesGateway = {
  readonly read: {
    byId(harnessId: string): Promise<Harness | null>;
    byKey(key: string): Promise<Harness | null>;
    list(): Promise<readonly Harness[]>;
  };
  readonly write: { insert(harness: Harness, at: Date): Promise<void> };
};
export type HarnessStagesGateway = {
  readonly read: { forHarness(harnessId: string): Promise<readonly Stage[]> };
  readonly write: {
    insert(stage: Stage): Promise<void>;
    update(stage: Stage): Promise<void>;
    reposition(harnessId: string, positions: readonly StagePosition[]): Promise<void>;
  };
};
export type HarnessItemsGateway = {
  readonly read: {
    byId(itemId: string): Promise<ItemState | null>;
    lock(itemId: string): Promise<ItemState | null>;
    forHarness(harnessId: string): Promise<readonly ItemState[]>;
    heldInStage(harnessId: string, stageKey: string, at: Date): Promise<number>;
    lapsedLeases(at: Date, limit: number): Promise<readonly string[]>;
  };
  readonly write: {
    insert(item: ItemState, at: Date): Promise<void>;
    claim(claim: ItemClaim): Promise<boolean>;
    project(item: ItemState): Promise<void>;
  };
};
export type PagesGateway = {
  readonly read: { facts(pageIds: readonly string[]): Promise<readonly PageFacts[]> };
};

export type StoreTransaction = {
  lock(key: string): Promise<void>;
  readonly harnesses: HarnessesGateway;
  readonly harnessStages: HarnessStagesGateway;
  readonly harnessItems: HarnessItemsGateway;
  readonly pages: PagesGateway;
};
```

- Produces, in `packages/harness/port-errors.ts`: `StoreRefusal` (`{ code: string; constraint: string | null; table: string | null }`) and `storeRefusalOf(error: unknown): StoreRefusal | null` (non-null exactly when `error instanceof Error`, `error.name === 'StoreRefusedError'` and `code` is a string). In `packages/db/store/refusal.ts`: `class StoreRefusedError extends Error` with those three fields and `refusing<T>(work: () => Promise<T>): Promise<T>`, which rethrows a database error whose SQLSTATE starts with `23` or equals `P0001` as `StoreRefusedError` (with the original as `cause`) and anything else unchanged, using `databaseErrorFacts` from `@uw/core/database-error`.

Gateway semantics (the contract suite pins each):

| Member | Behaviour |
|---|---|
| `harnesses.read.list` | every harness ordered by `key` |
| `harnessStages.read.forHarness` | the harness's stages ordered by `position` |
| `harnessStages.write.reposition` | sets each listed stage's position; first adds 1 000 000 to every listed stage's position, then writes the final ones, so the per-harness unique index never sees two equal positions |
| `harnessItems.read.lock` | `SELECT … FOR UPDATE OF harness_items` |
| `harnessItems.read.forHarness` | ordered by `priority`, then `created_at`, then `id` |
| `harnessItems.read.heldInStage` | items of that stage with `claimed_by IS NOT NULL AND (lease_expires IS NULL OR lease_expires > at)` |
| `harnessItems.read.lapsedLeases` | ids with `lease_expires <= at`, ordered by `lease_expires`, `id`, at most `limit` |
| `harnessItems.write.claim` | one `UPDATE harness_items SET claimed_by, claimant_kind, delegation_id, lease_expires WHERE id = $id AND (claimed_by IS NULL OR (lease_expires IS NOT NULL AND lease_expires <= $at)) RETURNING id`; `true` when a row came back |
| `harnessItems.write.insert`, `project` | write every `ItemState` field; `stage_id` is `(SELECT id FROM harness_stages WHERE harness_id = $harness AND key = $stageKey)`; `project` throws `Error('no item <id> to project')` when no row matched |
| every `write` member | wrapped in `refusing`, so a constraint or trigger refusal rejects with `StoreRefusedError` |
| row reads | parsed with `harnessSchema`, `stageSchema`, `itemStateSchema` (instants as `toISOString()`, `due` as the `YYYY-MM-DD` string) |

- [ ] **Step 1: Write the failing contract cases**

`packages/harness/port-contracts/store-gateways.ts` exports `describeStoreGateways(adapter: string, subject: () => StoreSubject): void`, called from `describeStoreContract` after the existing cases. `StoreSubject` gains `seedPage(page: PageFacts & { readonly slug: string; readonly title: string }): Promise<void>`. Cases, each with its own ids (the suite shares one database):

```ts
it('DX-3 KN-1 inserts and reads a harness by id, by key and in the list', …);
it('DX-3 refuses a second harness with the same key as a StoreRefusedError 23505', …);
it('DX-3 KN-2 refuses a stage update to (merge, checks), naming the constraint', async () => {
  const outcome = await subject().store
    .transaction((tx) => tx.harnessStages.write.update({ ...ship, exitGate: 'checks' }))
    .then(() => null, storeRefusalOf);
  expect(outcome).toMatchObject({ code: '23514', constraint: 'harness_stages_effect_needs_human_gate' });
});
it('DX-3 returns stages in position order and repositions without a unique clash', …);
it('DX-3 KN-4 projects every item field and reads it back unchanged', …);
it('DX-3 KN-5 claims an unheld item once, refuses a held one, and takes a lapsed lease', …);
it('DX-3 KN-5 counts only live holders in a stage', …);
it('DX-3 KN-5 lists lapsed leases in expiry order', …);
it('DX-3 reads page facts for the ids it is given', …);
```

The "projects every field" case uses an `ItemState` whose every nullable field is set (holder `agent:builder`, lease, gate target, expected head, risk tier `high`, domains `['acl', 'infra']`, pull request, zulip topic, due `2026-10-15`), projects it, and expects `read.byId` to deep-equal it. Update the existing case `DX-3 does not nest transactions…` to expect `Object.keys(tx).sort()` to equal `['harnessItems', 'harnessStages', 'harnesses', 'lock', 'pages']`.

Add to `packages/db/test-seed.ts`:

```ts
export type SeedPage = {
  readonly id: string;
  readonly type: PageType;
  readonly status: PageStatus;
  readonly jdArea: string;
  readonly bodyMd: string;
  readonly slug: string;
  readonly title: string;
};

export async function seedPage(db: AnyExecutor, page: SeedPage): Promise<void> {
  await db.insert(pages).values({ ...page, parentId: null, frontmatter: {}, version: 1 });
}
```

and pass `seedPage: (page) => seedPage(database.db, page)` (sim) and `seedPage: (page) => seedPage(db, page)` (platform) in the two contract tests.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run sim/adapters/store.contract.test.ts apps/uw-app/ports/store.contract.pg.test.ts`
Expected: FAIL — `tx.harnesses` is undefined (and a type error until Step 2).

- [ ] **Step 2: Extend the port (shared root, own commit)**

Add the types above to `packages/harness/ports.ts` (import `Harness`, `Identity`, `ItemState`, `PageStatus`, `PageType`, `PrincipalKind`, `Stage` from `@uw/contracts`). Run `pnpm check` (it fails in `packages/db/store` and the adapters until Step 4; that is expected) and commit `ports.ts` alone:

```bash
git add packages/harness/ports.ts
git commit -m "feat(harness): Store transactions carry gateways for harnesses, stages, items and pages" -m "Shared root packages/harness/ports.ts: the kernel reaches its tables only through the Store port (DX-1), so each table gets a gateway with a read half and a write half on the transaction it already passes along. Additive: lock(key) is unchanged. Rejected: methods on Store itself, which would invite reads outside the transaction." -m "KN-1 DX-3"
```

- [ ] **Step 3: The refusal guard in the harness**

```ts
export type StoreRefusal = {
  readonly code: string;
  readonly constraint: string | null;
  readonly table: string | null;
};

function textOrNull(error: Error, key: string): string | null {
  const value: unknown = Reflect.get(error, key);
  return typeof value === 'string' ? value : null;
}

export function storeRefusalOf(error: unknown): StoreRefusal | null {
  if (!(error instanceof Error) || error.name !== 'StoreRefusedError') return null;
  const code = textOrNull(error, 'code');
  if (code === null) return null;
  return { code, constraint: textOrNull(error, 'constraint'), table: textOrNull(error, 'table') };
}
```

Export `storeRefusalOf` and `StoreRefusal` from `packages/harness/index.ts`. Unit-test it in `packages/harness/port-errors.test.ts` (`DX-3 a store refusal is recognised by name and code`): an `Error` named `StoreRefusedError` with `code: '23514'` maps; a plain `Error` and a non-error map to `null`.

- [ ] **Step 4: Implement the gateways in `packages/db/store/`**

`types.ts` mirrors the four gateway types and `ItemClaim`, `PageFacts`, `StagePosition` exactly (packages/db may not import the harness; the adapters' `Store` typing makes a drift a type error). `DrizzleTransaction` becomes `{ lock(key: string): Promise<void>; harnesses: …; harnessStages: …; harnessItems: …; pages: … }`.

`store.ts`'s `bind(executor)` builds the transaction object once, registers it in the `executors` WeakMap and returns it; every gateway closes over `executor`:

```ts
function bind(executor: AnyExecutor): DrizzleTransaction {
  const tx: DrizzleTransaction = {
    lock: async (key) => {
      await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    },
    harnesses: bindHarnesses(executor),
    harnessStages: bindStages(executor),
    harnessItems: bindItems(executor),
    pages: bindPages(executor),
  };
  executors.set(tx, executor);
  return tx;
}
```

Keep whatever the step-2 fix wave added to `store.ts` (the open-transaction guard); add the gateway members to the object it already builds rather than replacing it.

`items.ts` (the non-obvious one):

```ts
const stageOf = (harnessId: string, stageKey: string) =>
  sql`(SELECT id FROM harness_stages WHERE harness_id = ${harnessId} AND key = ${stageKey})`;

function columnsOf(item: ItemState) {
  return {
    stageId: stageOf(item.harnessId, item.stageKey),
    title: item.title,
    pageId: item.pageId,
    priority: item.priority,
    due: item.due,
    claimedBy: item.holder,
    claimantKind: item.claimantKind,
    delegationId: item.delegationId,
    leaseExpires: item.leaseExpiresAt === null ? null : new Date(item.leaseExpiresAt),
    gateStatus: item.gateStatus,
    gateTarget: item.gateTarget,
    riskTier: item.riskTier,
    riskDomains: [...item.riskDomains],
    expectedHead: item.expectedHead,
    branchState: item.branchState,
    prRepo: item.pullRequest?.repo ?? null,
    prNumber: item.pullRequest?.number ?? null,
    zulipTopic: item.zulipTopic,
  };
}

function selectItems(executor: AnyExecutor) {
  return executor
    .select({ item: harnessItems, stageKey: harnessStages.key })
    .from(harnessItems)
    .innerJoin(harnessStages, eq(harnessStages.id, harnessItems.stageId));
}

function claimable(at: Date): SQL | undefined {
  return or(
    isNull(harnessItems.claimedBy),
    and(isNotNull(harnessItems.leaseExpires), lte(harnessItems.leaseExpires, at)),
  );
}

async function claim(executor: AnyExecutor, request: ItemClaim): Promise<boolean> {
  const rows = await executor
    .update(harnessItems)
    .set({
      claimedBy: request.holder,
      claimantKind: request.claimantKind,
      delegationId: request.delegationId,
      leaseExpires: request.leaseExpiresAt,
    })
    .where(and(eq(harnessItems.id, request.itemId), claimable(request.at)))
    .returning({ id: harnessItems.id });
  return rows.length === 1;
}
```

`rows.ts` holds `toHarness`, `toStage` and `toItemState(row, stageKey)`, each ending in the contract schema's `parse`. `lock` uses `selectItems(executor).where(eq(harnessItems.id, itemId)).for('update', { of: harnessItems })`. `pages.ts` returns `[]` for an empty id list and otherwise selects `id, type, status, jd_area, body_md` with `inArray`.

Export from `packages/db/store/index.ts`: `createDrizzleStore`, `createDrizzleGrants` and the types; **remove `executorOf` from the barrel** (grep first: its only users are `packages/db/store/store.ts`, `grants.ts` and `store.test.ts`, which import `./store.ts` directly).

- [ ] **Step 5: Keep the executor inside the store (open question 2)**

Add to `.dependency-cruiser.mjs` `forbidden`:

```js
{
  name: 'store-executor-stays-in-the-store',
  comment:
    'Only the Store and Grants gateways in packages/db/store unwrap a transaction to its Drizzle executor.',
  severity: 'error',
  from: { pathNot: '^packages/db/store/' },
  to: { path: '^packages/db/store/store\\.ts$' },
},
```

Add a case to `tools/architecture/rules.test.ts` in the style of its neighbours: a planted `apps/uw-app/x.ts` importing `../../packages/db/store/store.ts` reports `store-executor-stays-in-the-store`; a planted `packages/db/store/y.ts` importing `./store.ts` does not.

- [ ] **Step 6: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS; both Store contract tests ran every new case.

Update the `packages/db/test-seed.ts` row of `docs/exceptions.md`: the helpers also seed `pages` for the Store contract.

```bash
git add packages/harness packages/db/store packages/db/test-seed.ts sim/adapters apps/uw-app/ports .dependency-cruiser.mjs tools/architecture/rules.test.ts docs/exceptions.md
git commit -m "feat(db): the Drizzle gateways for harnesses, stages, items and pages, with store refusals by name" -m "KN-1 KN-2 KN-4 KN-5 DX-2 DX-3"
```

### Task 6: The events gateway and the one read path

**Requirements:** KN-3 (the store appends; an unknown name is refused), KN-4 (one read function returns events for an item or a harness in cursor order with paging, and it is the only event read path), DX-3.

**Files:**
- Modify (own commit): `packages/harness/ports.ts`
- Modify: `packages/harness/port-contracts/store-gateways.ts`, `packages/harness/port-contracts/store.ts`
- Create: `packages/db/store/events.ts`; modify `packages/db/store/store.ts`, `types.ts`, `rows.ts`
- Create: `tools/architecture/event-read-path.test.ts`

**Interfaces:**
- Produces:

```ts
export type EventQuery = {
  readonly harnessId: string;
  readonly itemId: string | null;
  readonly after: number;
  readonly limit: number;
};
export type EventPage = { readonly events: readonly HarnessEvent[]; readonly next: number | null };
export type HarnessEventsGateway = {
  readonly read: { page(query: EventQuery): Promise<EventPage> };
  readonly write: { append(events: readonly NewHarnessEvent[]): Promise<readonly HarnessEvent[]> };
};
```

and `StoreTransaction.harnessEvents: HarnessEventsGateway`.

Semantics: `append` inserts the events one row at a time, in the order given, inside `refusing`, and returns each stored row (with its position) parsed by `eventSchema`; `page` throws `RangeError` unless `1 <= limit <= 100` and `after >= 0`, selects `position > after` (and `item_id = itemId` when not null) ordered by `position`, at most `limit` rows, and returns `next` = the last row's position when exactly `limit` rows came back, else `null`. The cursor is always the harness position, for an item read too.

- [ ] **Step 1: Write the failing tests**

Add to `store-gateways.ts`:

```ts
it('DX-3 KN-3 appends events with positions per harness, in the order given', …);
it('DX-3 KN-4 pages a harness and an item in cursor order and resumes after a cursor', …);
it('DX-3 KN-3 refuses an unknown event name as a StoreRefusedError naming harness_events_name_known', async () => {
  const forged: NewHarnessEvent = JSON.parse(JSON.stringify({ ...created, name: 'merged' }));
  const refusal = await subject().store
    .transaction((tx) => tx.harnessEvents.write.append([forged]))
    .then(() => null, storeRefusalOf);
  expect(refusal).toMatchObject({ code: '23514', constraint: 'harness_events_name_known' });
});
it('DX-3 KN-3 offers no way to change or remove an event', async () => {
  const members = await subject().store.transaction(async (tx) => Object.keys(tx.harnessEvents.write));
  expect(members).toEqual(['append']);
});
```

The paging case appends 5 events for one harness (items X, Y, X, X, harness-level), then expects: `page({after: 0, limit: 2})` positions `[1, 2]`, next `2`; `page({after: 2, limit: 2})` `[3, 4]`; `page({after: 4, limit: 2})` `[5]`, next `null`; `page({itemId: X, after: 0, limit: 100})` `[1, 3, 4]`; `page({itemId: X, after: 1, limit: 100})` `[3, 4]`.

`tools/architecture/event-read-path.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const theReadPath = 'packages/db/store/events.ts';
const readsEvents = /\.from\(\s*(?:\w+\.)?harnessEvents\b|\bFROM\s+"?harness_events"?/i;

function isScanned(file: string): boolean {
  return /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && file !== theReadPath;
}

function readers(files: readonly string[], read: (file: string) => string): string[] {
  return files.filter(isScanned).filter((file) => readsEvents.test(read(file)));
}

describe('KN-4 one read function is the only event read path', () => {
  it('finds no other file that selects from harness_events', () => {
    expect(readers(repoFiles(), (file) => readFileSync(file, 'utf8'))).toEqual([]);
  });

  it.each([
    'db.select().from(harnessEvents)',
    'tx.select().from(schema.harnessEvents)',
    'sql`SELECT * FROM harness_events`',
  ])('flags %j', (source) => {
    expect(readers(['apps/uw-app/x.ts'], () => source)).toEqual(['apps/uw-app/x.ts']);
  });
});
```

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run sim/adapters/store.contract.test.ts tools/architecture/event-read-path.test.ts`
Expected: FAIL — `tx.harnessEvents` is undefined.

- [ ] **Step 2: Extend the port (shared root, own commit)**

Add the types (import `HarnessEvent`, `NewHarnessEvent`) and the `harnessEvents` member. Commit alone: `feat(harness): Store transactions carry the append-only events gateway and the one paged read` with the shared-root explanation ("the event log is written and read only through this gateway; it has no update or delete") and `KN-3 KN-4 DX-3` in the body.

- [ ] **Step 3: Implement `packages/db/store/events.ts`**

```ts
export function bindEvents(executor: AnyExecutor): DrizzleEventsGateway {
  return {
    read: { page: (query) => page(executor, query) },
    write: { append: (events) => refusing(() => appendAll(executor, events)) },
  };
}

async function appendAll(executor: AnyExecutor, events: readonly NewHarnessEvent[]) {
  const stored: HarnessEvent[] = [];
  for (const event of events) {
    const [row] = await executor
      .insert(harnessEvents)
      .values({
        id: event.eventId,
        harnessId: event.harnessId,
        itemId: event.itemId,
        name: event.name,
        actor: event.actor,
        evidence: event.evidence,
        traceId: event.traceId,
        at: new Date(event.at),
      })
      .returning();
    if (!row) throw new Error(`the store returned no row for event ${event.eventId}`);
    stored.push(toEvent(row));
  }
  return stored;
}
```

`toEvent` (in `rows.ts`) maps the row to the envelope and parses it with `eventSchema`. Add `harnessEvents: bindEvents(executor)` to `bind`, and update the members test to `['harnessEvents', 'harnessItems', 'harnessStages', 'harnesses', 'lock', 'pages']`.

- [ ] **Step 4: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness/port-contracts packages/db/store tools/architecture/event-read-path.test.ts
git commit -m "feat(db): append events through one gateway and read them through one paged cursor" -m "KN-3 KN-4 DX-3"
```

### Task 7: The fold, replay, and the one module that records events

**Requirements:** KN-4 (`replay(events)` is a pure, deterministic reducer yielding stage, holder, lease, gate status and branch state; the projection is written from the same fold), KN-3 (the kernel refuses to record an unknown name).

**Files:**
- Create: `packages/harness/caller.ts`, `packages/harness/outcome.ts`, `packages/harness/lock-keys.ts`, `packages/harness/access.ts`
- Create: `packages/harness/items/fold.ts`, `packages/harness/items/fold.test.ts`, `packages/harness/items/record.ts`, `packages/harness/items/events.ts`
- Modify: `packages/harness/kernel.ts`, `packages/harness/index.ts`, `packages/harness/package.json` (add `"@uw/core": "workspace:*"`), `pnpm-lock.yaml`
- Create: `tools/properties/item-events.ts`, `tools/properties/replay.test.ts`; modify root `package.json` (`fast-check` devDependency)
- Create: `sim/kernel/events.test.ts`
- Modify (own commit): `CONTEXT.md`

**Interfaces:**
- Consumes: `eventEvidenceSchemas`, `newEventSchema`, `ItemState`, `Principal`; `StoreTransaction`; `can` from `@uw/core/acl`.
- Produces:

```ts
export type Caller = { readonly actor: Principal; readonly traceId: string };

export type Detail = Readonly<Record<string, string | number | boolean | null | readonly string[]>>;
export type Accepted<T> = { readonly status: 'accepted'; readonly value: T };
export type Refused = { readonly status: 'error'; readonly reason: ErrorReason; readonly detail: Detail };
export type KernelOutcome<T> = Accepted<T> | Refused;
export function accepted<T>(value: T): Accepted<T>;
export function refused(reason: ErrorReason, detail?: Detail): Refused;

export const lockKeys = { stageClaims: (stageId: string) => `harness-stage-claims:${stageId}` };

export function allowed(actor: Principal, action: AclAction, harness: Harness, at: Date): boolean;

export type FoldableEvent = NewHarnessEvent | HarnessEvent;
export class ReplayError extends Error { readonly eventId: string }
export function foldItem(state: ItemState | null, event: FoldableEvent): ItemState;
export function replay(events: readonly FoldableEvent[]): ItemState | null;

export type RecordContext = {
  readonly actor: Identity;
  readonly at: Date;
  readonly traceId: string;
  readonly ids: Ids;
};
export type EventDraft = { readonly name: EventName; readonly evidence: HarnessEvent['evidence'] };
export function draft<N extends EvidenceName>(name: N, evidence: EventEvidence[N]): EventDraft;
export function recordContext(ports: Ports, caller: Caller, at: Date): RecordContext;
export function recordHarnessEvents(tx: StoreTransaction, context: RecordContext, harnessId: string, drafts: readonly EventDraft[]): Promise<readonly HarnessEvent[]>;
export function recordItemEvents(tx: StoreTransaction, context: RecordContext, item: ItemState, drafts: readonly EventDraft[]): Promise<{ readonly events: readonly HarnessEvent[]; readonly item: ItemState }>;
export function createItem(tx: StoreTransaction, context: RecordContext, initial: NewItem): Promise<{ readonly events: readonly HarnessEvent[]; readonly item: ItemState }>;
export type NewItem = { readonly itemId: string; readonly harnessId: string; readonly stageKey: string; readonly title: string; readonly pageId: string | null; readonly priority: number; readonly due: string | null };
export function readAllEvents(tx: StoreTransaction, harnessId: string, itemId: string | null): Promise<readonly HarnessEvent[]>;

Kernel gains: replay, events: { read(caller: Caller, query: EventQuery): Promise<KernelOutcome<EventPage>> }
```

`allowed` is `can(actor, action, { kind: 'area', area: harness.jdArea }, at)`.

The fold (each name not listed leaves the state unchanged; "released" means `holder`, `claimantKind`, `delegationId`, `leaseExpiresAt` all null):

| Event | Effect on `ItemState` |
|---|---|
| `item_created` | the initial state: stage, title, page, priority, due from evidence; released; `gateStatus` `working`, `gateTarget` null, `branchState` `none`, `expectedHead` null, `riskTier` null, `riskDomains` `[]`, `pullRequest` null, `zulipTopic` null. On a non-null state it throws `ReplayError` (created twice) |
| `item_claimed` | holder, claimant kind, delegation id, lease from evidence |
| `item_released`, `lease_expired` | released |
| `lease_renewed`, `run_step_recorded` | `leaseExpiresAt` from evidence |
| `branch_abandoned` / `branch_adopted` | `branchState` `abandoned` / `active` |
| `submitted_to_gate` | when `expectedHead` is not null: it, and `branchState` `active`; when `pullRequest` is not null: it; when `result` is `parked`: released, `gateStatus` `parked`, `gateTarget` = evidence `to` |
| `checks_failed` | `gateStatus` `checks_failed` |
| `stage_advanced` | released, `gateTarget` null; `to` null → `gateStatus` `done`; else `stageKey` = `to`, `gateStatus` `working` |
| `loop_edge_taken` | released, `stageKey` = `to`, `gateStatus` `working`, `gateTarget` null |
| `gate_rejected` | `gateStatus` `working`, `gateTarget` null |
| `gate_taken_over` | holder from evidence, claimant kind `person`, delegation and lease null, `gateStatus` `working`, `gateTarget` null |
| `risk_derived` | `riskTier`, `riskDomains` from evidence |

Any event other than `item_created` on a null state throws `ReplayError` (an item event before its creation). Every evidence read uses the literal member, for example `eventEvidenceSchemas.item_claimed.parse(event.evidence)`, never a computed key.

- [ ] **Step 1: Write the failing unit tests**

`packages/harness/items/fold.test.ts`, `describe('KN-4 replay is a pure reducer over an item\'s events', …)`, with top-level event builders (`created(stage)`, `claimed(holder, kind, lease)`, `advanced(from, to)`, …) producing `NewHarnessEvent` values with fixed ids and instants:
- created then claimed by `agent:builder` with a lease gives that holder, kind and lease;
- claimed then `item_released` clears all four holder fields;
- `submitted_to_gate` parked with `to: 'package'` clears the holder and sets `parked` / `package`;
- `stage_advanced` to `null` gives `done`;
- `gate_taken_over` gives a person holder with no lease;
- `replay([])` is `null`; replaying the same list twice gives deep-equal states; `replay(all)` equals `foldItem(replay(all.slice(0, -1)), all.at(-1))`;
- an event before `item_created` and a second `item_created` both throw `ReplayError`.

Run: `pnpm vitest run packages/harness/items/fold.test.ts`
Expected: FAIL — `fold.ts` does not exist.

- [ ] **Step 2: Implement `outcome.ts`, `caller.ts`, `lock-keys.ts`, `access.ts`, `items/fold.ts`**

Write the fold as a `Map<EventName, Step>` from the table (no `switch`), plus `created(event)` for `item_created`. `foldItem` returns `ItemState` (never null) and throws `ReplayError` for the two misuses; `replay` reduces from `null`, returning `null` for an empty list.

Add `@uw/core` to `packages/harness/package.json` and run `pnpm install`.

Run: `pnpm vitest run packages/harness`
Expected: PASS.

- [ ] **Step 3: The record module**

```ts
function stamp(context: RecordContext, harnessId: string, itemId: string | null, event: EventDraft): NewHarnessEvent {
  return newEventSchema.parse({
    eventId: context.ids.next(),
    harnessId,
    itemId,
    name: event.name,
    at: context.at.toISOString(),
    actor: context.actor,
    evidence: event.evidence,
    traceId: context.traceId,
  });
}

export async function recordItemEvents(tx: StoreTransaction, context: RecordContext, item: ItemState, drafts: readonly EventDraft[]) {
  const stamped = drafts.map((entry) => stamp(context, item.harnessId, item.itemId, entry));
  const next = stamped.reduce<ItemState>((state, event) => foldItem(state, event), item);
  await tx.harnessItems.write.project(next);
  const events = await tx.harnessEvents.write.append(stamped);
  return { events, item: next };
}

export async function createItem(tx: StoreTransaction, context: RecordContext, initial: NewItem) {
  const event = stamp(context, initial.harnessId, initial.itemId, draft('item_created', {
    stage: initial.stageKey,
    title: initial.title,
    pageId: initial.pageId,
    priority: initial.priority,
    due: initial.due,
  }));
  const item = foldItem(null, event);
  await tx.harnessItems.write.insert(item, context.at);
  const events = await tx.harnessEvents.write.append([event]);
  return { events, item };
}
```

The projection is written before the append so the append is the last statement that can take a lock (Global Constraints). `stamp` parsing with `newEventSchema` is what refuses an unknown name or ill-fitting evidence in the kernel, before the database's CHECK. `readAllEvents` pages with `limit: 100` from `after: 0` until `next` is `null`. `recordContext(ports, caller, at)` is `{ actor: caller.actor.identity, at, traceId: caller.traceId, ids: ports.ids }`.

`items/events.ts` exports `createEventReads(ports)`: `read(caller, query)` reads `at = ports.clock.now()`, then in one transaction refuses `harness_not_found` for an unknown harness and `not_permitted` unless `allowed(caller.actor, 'read', harness, at)`, and otherwise returns `accepted(await tx.harnessEvents.read.page(query))`. Add `replay` and `events: createEventReads(ports)` to the `Kernel`. Export from `index.ts`: `Caller`, `KernelOutcome`, `Accepted`, `Refused`, `Detail`, `replay`, `foldItem`, `ReplayError`, `FoldableEvent`.

- [ ] **Step 4: The kernel read path over the world**

`sim/kernel/events.test.ts`, `describe('KN-4 the kernel reads a harness log through the one read path, checking can()', …)`: in the test, insert a harness and three events through `world.adapters.store.transaction` and the gateways (test files may write; the owners check scans only non-test sources), then: Ian (seeded org admin; build the principal with `principalSchema.parse` and `world.adapters.grants.resolve`) reads them in order; a principal with no grants is refused `not_permitted`; an unknown harness id is `harness_not_found`.

- [ ] **Step 5: The replay property**

Add `fast-check@^4.10.2` to the root `devDependencies` and run `pnpm install`.

`tools/properties/item-events.ts` exports `itemEventSequence(): fc.Arbitrary<NewHarnessEvent[]>`: an `item_created` in a random stage of the software template's keys, followed by up to 40 operations drawn from `claim`, `release`, `renew`, `expire`, `submitParked`, `submitAdvanced`, `checksFailed`, `reject`, `takeOver`, `loopEdge`, `riskDerived`; a builder walks them with a small model of the state and skips an operation that is not valid there (for example `release` with no holder, `reject` when not parked), so every sequence is one the kernel could record. Ids and instants come from counters, never the clock.

`tools/properties/replay.test.ts`:

```ts
describe('KN-4 replay is deterministic over random valid sequences', () => {
  it('gives the same state twice and equals the incremental fold', () => {
    fc.assert(
      fc.property(itemEventSequence(), (events) => {
        const once = replay(events);
        expect(replay(structuredClone(events))).toEqual(once);
        const incremental = events.reduce<ItemState | null>((state, event) => foldItem(state, event), null);
        expect(incremental).toEqual(once);
      }),
      { numRuns: 200 },
    );
  });
});
```

Import `replay` and `foldItem` from `../../packages/harness/index.ts`. If knip reports `fast-check` as unlisted for a workspace other than the root, the test is in the wrong directory: it belongs under `tools/`.

- [ ] **Step 6: CONTEXT.md (shared root, own commit)**

Add two entries near **Event**: **Projection** ("The `harness_items` row: the fold of an item's events, written in the same transaction as the events it folds. Replaying the log must give exactly the projection. _Avoid_: cache, snapshot.") and **Gateway** ("One table's member of a Store transaction, `tx.<table>`, with a `read` half and a `write` half; only the table's owner calls the write half. _Avoid_: repository, DAO."). Commit alone: `docs(context): projection and gateway` with `KN-4` in the body.

- [ ] **Step 7: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness sim/kernel/events.test.ts tools/properties package.json pnpm-lock.yaml
git commit -m "feat(harness): replay as a pure fold, one module recording events and their projection, and the kernel's event read" -m "KN-3 KN-4"
```

### Task 8: The validator and connector registries, and `learning_attached`

**Requirements:** KN-6 (validators are a registry keyed by name; an unknown key fails closed with the key in the failure), KN-7 (the `learning_attached` rule and evidence labels), KN-18 (the connector registry a stage write is checked against).

**Files:**
- Create: `packages/harness/validators/registry.ts`, `packages/harness/validators/claims.ts`, `packages/harness/validators/learning-attached.ts`, `packages/harness/validators/validators.test.ts`
- Create: `packages/harness/connectors/registry.ts`, `packages/harness/connectors/registry.test.ts`

**Interfaces:**
- Produces:

```ts
export type ValidationContext = {
  readonly item: ItemState;
  readonly events: readonly HarnessEvent[];
  readonly pages: ReadonlyMap<string, PageFacts>;
};
export type Validator = (context: ValidationContext) => readonly string[];
export const validatorRegistry: ReadonlyMap<string, Validator>;
export function runValidators(keys: readonly string[], context: ValidationContext): readonly string[];
export function attachedPageIds(events: readonly HarnessEvent[]): readonly string[];
export function checkClaims(bodyMd: string): { readonly claims: number; readonly unlabelled: readonly string[] };
export const claimLabel: RegExp;

export const connectorRegistry: ReadonlySet<EffectConnector>;
export function connectorRegistered(connector: Connector): boolean;
```

`validatorRegistry` holds exactly `learning_attached` in v1. `runValidators` returns the concatenated failures of every key, and for a key not in the registry the failure `unknown_validator: <key>`; an empty list means every validator passed. `connectorRegistry` holds `merge` and `publish` (the connectors the two templates use; GH-7 adds `deploy`, `send`, `post`); `connectorRegistered('none')` is `true`.

`learning_attached` (decisions recorded in Task 25):
- the attached pages are the `pageId`s of the item's `learning_attached` events, first occurrence order, without duplicates;
- it passes the memory rule when an attached page of type `learning` or `skill` has status `suggested` or `active`, or when a `nothing_learned` event exists whose actor starts with `human:`;
- every attached page that is not a `skill` must state at least one claim, and every claim must carry a label: a claim is a markdown list line (`^\s*[-*]\s+(.+)$`) and is labelled when its text matches `claimLabel` = `/^\[(observed|confirmed|inferred|assumed)\]\s+\S/`;
- failures (each at most 500 characters; quote a claim's first 80 characters): `learning_attached: the item carries no suggested learning or skill page and no nothing_learned marker`, `learning_attached: page <id> does not exist`, `learning_attached: page <id> states no claim`, `learning_attached: page <id> has a claim without an evidence label: <claim>`.

- [ ] **Step 1: Write the failing tests**

`validators.test.ts`:
- `describe('KN-6 validators are a registry and an unknown key fails closed', …)`: `runValidators(['nope'], context)` is `['unknown_validator: nope']`; `runValidators([], context)` is `[]`; `[...validatorRegistry.keys()]` is `['learning_attached']`.
- `describe('KN-7 learning_attached passes on a suggested learning, a skill, or a signed nothing-learned marker', …)`: no attachment and no marker fails with the first message; an attached `suggested` learning whose body is `- [observed] the board loads in 300 ms` passes; an `active` skill with no list lines passes; a `draft` learning fails; a `nothing_learned` by `human:…` passes; one by `agent:builder` does not count.
- `describe('KN-7 every claim carries an evidence label', …)`: a learning with `- the board is faster` fails naming the claim; a learning with no list line fails "states no claim"; `claimLabel`'s alternatives equal `evidenceLabelSchema.options` (build the expected source string from the options and compare it to `claimLabel.source`).

`connectors/registry.test.ts`, `describe('KN-18 a connector is written only when its handler is registered', …)`: `merge` and `publish` registered, `deploy`, `send`, `post` not, `none` always.

Run: `pnpm vitest run packages/harness/validators packages/harness/connectors`
Expected: FAIL — the modules do not exist.

- [ ] **Step 2: Implement**

Write the three validator files and the connector registry as specified. `learning-attached.ts` keeps each rule in its own function (`memoryFailures`, `missingPages`, `labelFailures`) to stay inside the complexity limits. Use literal regexes only (`security/detect-non-literal-regexp`).

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness/validators packages/harness/connectors
git commit -m "feat(harness): validators and connectors by registry, and learning_attached with evidence labels" -m "KN-6 KN-7 KN-18"
```

### Task 9: The template property and the two templates

**Requirements:** KN-10, KN-15 (the fixtures and the validator-key test; activation is Task 11), KN-9 reused (`walk` from step 2 is not changed).

**Files:**
- Create: `packages/harness/template-property.ts`, `packages/harness/template-property.test.ts`
- Create: `packages/harness/templates/eight-stages.ts`, `packages/harness/templates/software.ts`, `packages/harness/templates/bml.ts`, `packages/harness/templates/fixtures/bypasses-ship.ts`, `packages/harness/templates/templates.test.ts`
- Modify: `packages/harness/templates.ts`, `packages/harness/index.ts`
- Create: `tools/properties/template.test.ts`
- Modify: `sim/cli/cli.test.ts`, `sim/runner/walk-report.test.ts` (templates are now registered)

**Interfaces:**
- Consumes: `walk`, `WalkStage` (step 2); `validatorRegistry`, `connectorRegistered` (Task 8).
- Produces:

```ts
export type TemplateStage = WalkStage & {
  readonly title: string;
  readonly bracket: StageBracket;
  readonly agentPickup: AgentPickup;
  readonly wipLimit: number;
  readonly validators: readonly string[];
};
export type Template = {
  readonly key: string;
  readonly title: string;
  readonly stages: readonly TemplateStage[];
};
export const templates: ReadonlyMap<string, Template>;

export type TemplateViolation = { readonly path: readonly string[]; readonly effectStage: string };
export function templateProperty(stages: readonly WalkStage[]): readonly TemplateViolation[];
export function describeViolation(violation: TemplateViolation): string;
```

`templateProperty` walks every path; along each path it marks "approved" as soon as a step's `exitGate` is `human_approval` (P10: the effect stage's own exit counts), and the first step whose `connector` is not `none` while not yet approved is a violation `{ path: keys up to and including it, effectStage: its key }`, one per distinct path prefix. `describeViolation` returns `` `path ${path.join(' > ')} reaches ${effectStage}, which has an external effect, without a human_approval exit` ``. `Kernel` gains `templateProperty`.

The two templates (keys and positions identical; `eight-stages.ts` builds both from a titles list and the Ship connector):

| Key | Position | Bracket | Pickup (P17) | Exit | Connector | Validators | Feeds | Software title | BML title |
|---|---|---|---|---|---|---|---|---|---|
| `package` | 10 | `product_package` | `none` | `none` | `none` | | | Backlog issue | Goal, strategy, data |
| `scope` | 20 | `build_package` | `allowed` | `checks` | `none` | | | Premise verified | Niche identification |
| `plan` | 30 | `build_package` | `allowed` | `checks` | `none` | | | Plan approved | Product tuning |
| `build` | 40 | `build_package` | `allowed` | `checks` | `none` | | | Commits to PR | Asset package |
| `check` | 50 | `build_package` | `allowed` | `checks` | `none` | | | CI and review verdict | Brand and policy checks |
| `ship` | 60 | `deploy_package` | `none` | `human_approval` | `merge` / `publish` | | | Merge, tag, deploy | Deploy to channels |
| `validate` | 70 | `iterate` | `allowed` | `checks` | `none` | | `package` | Deploy watched | Collect feedback |
| `close` | 80 | `iterate` | `allowed` | `checks` | `none` | `learning_attached` | `scope` | Issue closed and learning | Analyze, compare |

Every stage has `wipLimit` 3. Template keys and titles: `software` "Software delivery", `bml` "BML product flywheel". The negative fixture `bypassesShip` (key `bypasses-ship`) is the software stages plus `hotfix` (title "Hotfix", position 65, bracket `deploy_package`, pickup `allowed`, exit `checks`, connector `merge`, no validators, no feeds), with `build`'s feeds set to `['hotfix']`. It is never registered.

- [ ] **Step 1: Write the failing tests**

`template-property.test.ts`:

```ts
describe('KN-10 every registered template reaches an effect only after a human_approval exit', () => {
  it.each([...templates.values()].map((template) => [template.key, template] as const))(
    '%s passes on every walked path',
    (_key, template) => {
      expect(templateProperty(template.stages)).toEqual([]);
    },
  );
});

describe('KN-10 the negative fixture with a feeds edge around Ship fails, naming the path and the effect stage', () => {
  it('reports the bypass', () => {
    expect(templateProperty(bypassesShip.stages)).toEqual([
      { path: ['package', 'scope', 'plan', 'build', 'hotfix'], effectStage: 'hotfix' },
    ]);
  });

  it('says so in words', () => {
    const [violation] = templateProperty(bypassesShip.stages);
    expect(violation && describeViolation(violation)).toBe(
      'path package > scope > plan > build > hotfix reaches hotfix, which has an external effect, without a human_approval exit',
    );
  });
});
```

`templates/templates.test.ts`: `KN-15 software and BML ship as eight stages each` (the key list, Ship's exit and connector per template, Close's validators and feeds, Validate's feeds, brackets and pickups per the table); `KN-15 every validator key a template names exists` (`validatorRegistry.has` for every key on every stage); `KN-18 every connector a template names is registered`.

`tools/properties/template.test.ts`, `describe('KN-10 the property holds on random stage graphs the database accepts, and every reported path is real', …)`: an arbitrary of 2 to 8 stages with distinct keys and positions, random exits and connectors, and random feeds among the keys. (a) When every stage with a connector has a `human_approval` exit (what the Ship check guarantees), `templateProperty` is `[]`. (b) For any graph, every violation's path is a prefix of some path `walk` returns, ends at a stage with a connector, and contains no `human_approval` exit. 300 runs.

Run: `pnpm vitest run packages/harness tools/properties/template.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement** the property, the builder, both templates, the fixture, and register `software` and `bml` in `templates.ts`. Export `templateProperty`, `describeViolation`, `TemplateViolation`, `TemplateStage` from the index.

- [ ] **Step 3: The walk CLI now has templates**

`pnpm walk -- software` prints one path to an external effect per walked route that reaches Ship. Update `sim/cli/cli.test.ts` and `sim/runner/walk-report.test.ts`: replace the "no templates registered yet" expectation with one that `pnpm walk -- all` exits 0 and its output contains `template software (Software delivery):` and `ship [human_approval, merge]`, and `template bml (BML product flywheel):` and `ship [human_approval, publish]`.

- [ ] **Step 4: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS; `pnpm walk:all` in the chain prints both templates.

```bash
git add packages/harness sim/cli sim/runner tools/properties/template.test.ts
git commit -m "feat(harness): the template property over every walked path, and the software and BML templates" -m "KN-10 KN-15 KN-9"
```

### Task 10: The sim runner reads the log and checks replay against the projection

**Requirements:** DX-4 (scenarios assert on the event log and folded state; `pnpm sim` prints both), KN-4 (replay equals record, checked after every scenario). Decides open question 1.

**Files:**
- Modify: `sim/scenario.ts`, `sim/runner/run.ts`, `sim/runner/run.test.ts`, `sim/runner/report.ts`, `sim/cli/cli.test.ts`, `sim/scenarios/DX-1.kernel-over-test-adapters.ts`, `sim/scenarios/DX-2.store-is-embedded-postgres.ts`
- Create: `sim/runner/log.ts`, `sim/runner/log.test.ts`, `sim/fixtures.ts`, `sim/fixtures.test.ts`

**Interfaces:**
- Produces:

```ts
export type ScenarioOutcome = { readonly state: Readonly<Record<string, unknown>> };
export type ScenarioReport = {
  readonly events: readonly HarnessEvent[];
  readonly state: Readonly<Record<string, unknown>>;
};
export type Scenario = {
  readonly id: string;
  readonly title: string;
  run(world: World): Promise<ScenarioOutcome>;
};

export type WorldLog = { readonly events: readonly HarnessEvent[]; readonly drift: readonly string[] };
export function readWorldLog(store: Store): Promise<WorldLog>;

export type SimGrant = {
  readonly role: Role;
  readonly scopeKind: Scope;
  readonly scopeArea: JdArea | null;
  readonly expiresAt?: Date | null;
};
export function simPersonId(n: number): string;
export function simPerson(world: World, n: number, grants: readonly SimGrant[]): Promise<Principal>;
export function simIan(world: World): Promise<Principal>;
export function simAgent(owner: Principal, persona: string, options: { readonly interactive: boolean }): Principal;
export function simCaller(world: World, actor: Principal): Caller;
```

`readWorldLog` opens one transaction, lists every harness (`tx.harnesses.read.list()`), pages each harness's whole log through `tx.harnessEvents.read.page` (limit 100 until `next` is null), and for every item of the harness (`tx.harnessItems.read.forHarness`) compares `replay(events of that item)` with the projected row field by field (`JSON.stringify` of each field), adding `item <id>: the projection differs from the replay in <fields>` to `drift` for every mismatch. The events are the harnesses in key order, each in position order.

`runScenario` calls `scenario.run(world)`, then `readWorldLog(world.adapters.store)`; a non-empty `drift` makes the result a failure `projection drift: <first entry>`; otherwise the report is `{ events: log.events, state: outcome.state }`. Keep the per-scenario timeout the step-2 fix wave added around both calls.

`simPersonId(n)` is `00000000-0000-4000-8000-0000000001` followed by `n` as two decimal digits; grant ids are `00000000-0000-4000-8000-0000000002` + `n` (two digits) + the grant's index (two digits). `simPerson` seeds the person (`person<n>@unfoldingword.org`) and each grant with `seedPerson`/`seedGrant` from `@uw/db/test-seed` (`grantedAt` = the sim clock's now), resolves the grants through `world.adapters.grants.resolve(personId, now)` and returns `principalSchema.parse({ identity: 'human:<id>', kind: 'person', personId, email, grants, interactive: true })`. `simIan` does the same for the bootstrap person without seeding. `simAgent` returns an agent principal `agent:<persona>` carrying the owner's `personId` and grants and the given `interactive` flag. `simCaller` is `{ actor, traceId: world.adapters.ids.next() }`.

- [ ] **Step 1: Write the failing tests**

`sim/runner/log.test.ts`, `describe('KN-4 DX-4 the runner reads the log and fails a scenario whose projection drifts', …)`:
- a fixture scenario that, inside the test, inserts a harness, a stage and an item through the gateways, records two events with `recordItemEvents` (imported from `../../packages/harness/items/record.ts` — test files only) and returns `{ state: {} }` passes, and the report holds those two events in position order;
- the same scenario plus a `tx.harnessItems.write.project({ ...item, title: 'drifted' })` fails with a message containing `projection drift` and `title`;
- a harness with 230 events is read whole (three pages).

`sim/fixtures.test.ts`: `simPerson(world, 3, [{ role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' }])` is a person principal whose one grant is that editor grant; `simAgent` of it is `agent:builder`, kind `agent`, non-interactive when asked.

Run: `pnpm vitest run sim/runner sim/fixtures.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement** `log.ts`, the runner change, `fixtures.ts`; change `DX-1` and `DX-2` to return `{ state }` only; update `run.test.ts` (`emptyReport` becomes an outcome `{ state: { done: true } }`).

- [ ] **Step 3: Make the CLI test survive new scenarios**

In `sim/cli/cli.test.ts`, replace the literal `'2 of 2 scenarios passed'` with a check that the output matches `/(\d+) of \1 scenarios passed/`, and the literal list of known scenarios with `toContain('no scenario matches ZZ-1; known: DX-1.kernel-over-test-adapters')`. Every later task adds scenarios without touching this file.

- [ ] **Step 4: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS; `pnpm sim -- all` still passes DX-1 and DX-2.

```bash
git add sim
git commit -m "feat(sim): the runner reads every harness log through the one read path and fails on projection drift" -m "Scenarios now return their folded state only; the event log in every report is the one the store holds, and every item's replay is compared with its projection after every scenario." -m "DX-4 KN-4"
```

### Task 11: The stage command and template activation

**Requirements:** KN-18, KN-15 (both templates activate), KN-10 (activation runs the property and refuses, naming the path), KN-8 (a dangling feeds target is refused at write time), Review Focus 3 and 4.

**Files:**
- Create: `packages/harness/stages/rules.ts`, `packages/harness/stages/activate.ts`, `packages/harness/stages/edit.ts`, `packages/harness/stages/commands.ts`
- Modify: `packages/harness/kernel.ts`, `packages/harness/index.ts`, `sim/fixtures.ts`
- Create: `sim/scenarios/KN-18.activate-a-template.ts`, `sim/scenarios/KN-15.both-templates-activate.ts`, `sim/scenarios/KN-18.lowering-ship-is-refused-by-postgres.ts`, `sim/scenarios/KN-10.activation-refuses-a-bypass.ts`, `sim/kernel/stage-command.test.ts`

**Interfaces:**
- Consumes: `templateProperty`, `describeViolation`, `validatorRegistry`, `connectorRegistered`, `recordHarnessEvents`, `draft`, `storeRefusalOf`, `allowed`.
- Produces:

```ts
export type StageInput = Omit<Stage, 'id' | 'harnessId' | 'paused'>;
export type StageChange = Partial<Omit<Stage, 'id' | 'harnessId' | 'key'>>;
export type ActivateInput = {
  readonly harnessId: string;
  readonly harnessKey: string;
  readonly jdArea: JdArea;
  readonly template: Template;
};
export type Activated = { readonly harness: Harness; readonly stages: readonly Stage[] };
export type StageCommands = {
  activate(caller: Caller, input: ActivateInput): Promise<KernelOutcome<Activated>>;
  createStage(caller: Caller, input: { readonly harnessId: string; readonly stage: StageInput }): Promise<KernelOutcome<Stage>>;
  updateStage(caller: Caller, input: { readonly harnessId: string; readonly stageKey: string; readonly change: StageChange }): Promise<KernelOutcome<Stage>>;
  reorderStages(caller: Caller, input: { readonly harnessId: string; readonly order: readonly string[] }): Promise<KernelOutcome<readonly Stage[]>>;
};
export function createSimHarness(world: World, template: Template, options?: { readonly key?: string; readonly jdArea?: JdArea }): Promise<{ readonly harness: Harness; readonly stages: readonly Stage[]; readonly admin: Principal }>;
```

Rules, in this order, for every command:
1. `at = ports.clock.now()` once.
2. An agent principal (`actor.kind === 'agent'`) is refused `not_permitted`, whatever its grants (AGENTS.md rule 2: nothing an agent reaches writes `harness_stages`). No event.
3. Activation needs `allowed(actor, 'admin', { jdArea }, at)`; the edits need it on the harness's area. Otherwise `not_permitted`, no event. An unknown harness is `harness_not_found`.
4. The resulting stage set is checked by `stageProblems(stages)` in `rules.ts`, returning the first of: `unknown_validator` (detail `{ stage, validator }`), `connector_not_registered` (`{ stage, connector }`), `unknown_feed_target` (`{ stage, target }`). Activation additionally runs `templateProperty` and refuses `template_bypasses_gate` with detail `{ path: violation.path, effectStage, message: describeViolation(violation) }` for the first violation. **The edits do not run the template property or pre-check the Ship invariant**: lowering Ship's gate must reach Postgres, whose check is the invariant (KN-2), so the refusal comes from the database.
5. For the edits, a kernel refusal from step 4 records `stage_edit_refused` `{ stage, reason, code: null, constraint: null }` on the harness in the same transaction and returns the refusal.
6. The write runs in one transaction. When it rejects with a store refusal (`storeRefusalOf(error) !== null`), the transaction is gone; the command opens a second one to record `stage_edit_refused` `{ stage, reason: 'stage_edit_refused', code, constraint }` and returns `refused('stage_edit_refused', { code, constraint })`. Any other error propagates.
7. Activation: refuses `harness_exists` when `harnesses.read.byId(harnessId)` or `byKey(harnessKey)` finds one; inserts the harness (`template` = the template's key, `hostedBuilderEnabled` false, `paused` false), then each template stage as a `Stage` with an id from `ports.ids`, `instructionsPageId` null and `paused` false, then records `template_activated` `{ template, stages: keys in position order }`. A store refusal during activation is returned as `stage_edit_refused` with no event (there is no harness row to hang it on).
8. `reorderStages` refuses `stage_not_found` (detail `{ stage }`) for a key that is not a stage and `malformed_command` unless `order` is a permutation of every stage key; it repositions to 10, 20, 30, … in the given order.

`createSimHarness` activates the template as `simIan(world)` with key `options.key ?? template.key`, area `options.jdArea ?? '80-89'`, and a harness id from the world's ids; it throws if the outcome is not accepted.

- [ ] **Step 1: Write the failing scenarios and tests**

`sim/scenarios/KN-18.activate-a-template.ts`:

```ts
export const scenario = defineScenario({
  id: 'KN-18',
  title: 'an org admin activates the software template: eight stage rows, one template_activated event',
  run: async (world) => {
    const { harness, stages } = await createSimHarness(world, software);
    assert.deepEqual(
      stages.map((stage) => [stage.key, stage.position, stage.exitGate, stage.connector]),
      software.stages.map((stage) => [stage.key, stage.position, stage.exitGate, stage.connector]),
    );
    const read = await world.kernel.events.read(simCaller(world, await simIan(world)), {
      harnessId: harness.id,
      itemId: null,
      after: 0,
      limit: 100,
    });
    assert.equal(read.status, 'accepted');
    assert.deepEqual(read.status === 'accepted' && read.value.events.map((event) => event.name), [
      'template_activated',
    ]);
    return { state: { harness: harness.key, stages: stages.map((stage) => stage.key) } };
  },
});
```

`KN-15.both-templates-activate.ts`: activates `software` (`80-89`) and `bml` (`30-39`, key `bml`) and asserts both have eight stages, Ship carries `merge` and `publish` respectively, and the stored rows of each pass `templateProperty`.

`KN-18.lowering-ship-is-refused-by-postgres.ts`: activates software, then `updateStage(ship, { exitGate: 'checks' })` as Ian; asserts the outcome is `{ status: 'error', reason: 'stage_edit_refused', detail: { code: '23514', constraint: 'harness_stages_effect_needs_human_gate' } }`, Ship's stored exit is still `human_approval`, and the harness log ends with one `stage_edit_refused` whose evidence names the constraint (the runner's log holds it; read it through `world.kernel.events.read` to assert).

`KN-10.activation-refuses-a-bypass.ts`: activating `bypassesShip` is refused `template_bypasses_gate` with `detail.path` `['package', 'scope', 'plan', 'build', 'hotfix']` and `detail.effectStage` `hotfix`, and `tx.harnesses.read.list()` is empty afterwards.

`sim/kernel/stage-command.test.ts` (`describe('KN-18 the stage command …')`, split into several describes):
- an agent principal carrying org admin is refused `not_permitted` on activate and on update, and no event is written (Review Focus 3);
- an area editor is refused `not_permitted`;
- `createStage` with validator `nope` is refused `unknown_validator` and the log gains `stage_edit_refused` with `reason: 'unknown_validator'`;
- `createStage` with connector `deploy` (exit `human_approval`) is refused `connector_not_registered`;
- `describe('KN-8 a dangling feeds target is refused at write time', …)`: `updateStage(close, { feeds: ['nowhere'] })` is refused `unknown_feed_target` with detail `{ stage: 'close', target: 'nowhere' }`;
- `createStage` with key `scope` (taken) is refused `stage_edit_refused` with constraint `harness_stages_key_per_harness`, recorded on the harness;
- `reorderStages` with the eight keys reversed gives positions 10…80 in that order; with a missing key is `malformed_command`; with an unknown key is `stage_not_found`;
- activating a second harness with key `software` is `harness_exists`.

Run: `pnpm vitest run sim/kernel/stage-command.test.ts && pnpm sim -- KN-18`
Expected: FAIL — `world.kernel.stages` does not exist.

- [ ] **Step 2: Implement** `rules.ts` (`stageProblems`, `stageFromTemplate`), `activate.ts`, `edit.ts` (one helper `editInTransaction(ports, caller, harnessId, stageKey, work)` that holds rules 5 and 6 so the three edits share them), `commands.ts` (`createStageCommands(ports): StageCommands`), add `stages` to the `Kernel`, add `createSimHarness` to `sim/fixtures.ts`. Each function stays under 50 lines: put the permission prelude (rules 1 to 3) in one `authorize` helper that returns the harness or a `Refused`.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness sim
git commit -m "feat(harness): the stage command activates templates and edits stages, recording what Postgres refuses" -m "KN-18 KN-15 KN-10 KN-8"
```

### Task 12: Enqueue, the projection property, and the repair routine

**Requirements:** KN-4 (the projection equals the replay over random valid sequences; the repair routine of P7), and enqueue (the command that creates an item, used by every later task).

**Files:**
- Create: `packages/harness/items/enqueue.ts`, `packages/harness/items/repair.ts`, `packages/harness/items/commands.ts`
- Modify: `packages/harness/kernel.ts`, `packages/harness/index.ts`
- Create: `tools/properties/projection.test.ts`, `sim/kernel/repair.test.ts`, `sim/scenarios/KN-4.an-item-is-the-fold-of-its-events.ts`

**Interfaces:**
- Consumes: `createItem`, `recordItemEvents`, `readAllEvents`, `replay`, `itemEventSequence` (Task 7).
- Produces:

```ts
export type EnqueueInput = {
  readonly harnessId: string;
  readonly title: string;
  readonly pageId: string | null;
  readonly priority: number;
  readonly due: string | null;
};
export type ItemCommands = {
  enqueue(caller: Caller, input: EnqueueInput): Promise<KernelOutcome<ItemState>>;
};
export type RepairCommands = {
  rebuildItem(caller: Caller, input: { readonly itemId: string }): Promise<KernelOutcome<{ readonly item: ItemState; readonly repaired: readonly string[] }>>;
};
```

`enqueue` refuses `harness_not_found`, then `not_permitted` unless `allowed(actor, 'write', harness, at)`; the item id comes from `ports.ids`; it lands in the stage with the lowest position (Package) through `createItem`. `rebuildItem` needs `allowed(actor, 'admin', harness, at)`; in one transaction it locks the item (`item_not_found` when absent), reads its whole log with `readAllEvents`, replays it, and when the replay differs from the row writes it with `harnessItems.write.project`; `repaired` lists the fields that differed (empty when none). It records no event: the log is unchanged, only its projection. `Kernel` gains `items` (Tasks 14, 15, 17, 18, 19 add members) and `repair`.

- [ ] **Step 1: Write the failing tests**

`sim/scenarios/KN-4.an-item-is-the-fold-of-its-events.ts`: activate software, enqueue "Wire the board" as an area editor (`simPerson(world, 2, [{ role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' }])`), and assert the outcome's item is in `package`, `working`, unheld, and equals `world.kernel.replay` of the item's events read through `world.kernel.events.read` with `itemId`. A viewer's enqueue is refused `not_permitted`. Return `{ state: { item } }` (the runner also checks the projection).

`tools/properties/projection.test.ts`, `describe('KN-4 the projection equals the replay over random valid sequences recorded through the store', …)`: one world for the file (`beforeAll` creates it and activates software through `createSimHarness`; `afterAll` closes it and the template), and `fc.asyncProperty(itemEventSequence(), fc.integer({ min: 1, max: 5 }), …)`: give each run a fresh item id; record the sequence's `item_created` with `createItem` and the rest with `recordItemEvents` in batches of the drawn size, each batch its own transaction (lock the row first with `harnessItems.read.lock`); then in one transaction expect `harnessItems.read.byId(id)` to equal `replay(readAllEvents(tx, harnessId, id))`. 40 runs, `timeout` 120 s. The events' `harnessId` and `itemId` are overwritten with the world's ids and their `eventId`s with fresh ids from `world.adapters.ids` before recording.

`sim/kernel/repair.test.ts`, `describe('KN-4 the repair routine rebuilds a projection from the log', …)`: enqueue an item; in the test, overwrite its projection with `title: 'drifted'` through the gateway; `rebuildItem` as Ian returns `repaired: ['title']` and the row's title is the original again; a second call returns `repaired: []`; an editor is refused `not_permitted`. The test leaves no drift behind (it runs in a test file, not a scenario).

Run: `pnpm vitest run tools/properties/projection.test.ts sim/kernel/repair.test.ts && pnpm sim -- KN-4`
Expected: FAIL.

- [ ] **Step 2: Implement** enqueue, repair and the commands module; wire `items` and `repair` into the kernel.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness sim tools/properties/projection.test.ts
git commit -m "feat(harness): enqueue an item into Package, prove projection equals replay, and repair a projection from the log" -m "KN-4"
```

### Task 13: Delegations

**Requirements:** KN-16.

**Files:**
- Modify (own commit): `packages/harness/ports.ts` (the `delegations` gateway and `Grants.resolveIn`)
- Modify: `packages/harness/port-contracts/store-gateways.ts`, `packages/harness/port-contracts/grants.ts`, `packages/db/store/grants.ts`, `packages/db/store/store.ts`, `types.ts`, `rows.ts`; create `packages/db/store/delegations.ts`
- Modify: `apps/uw-app/ports/grants.not-wired.ts`, `apps/uw-app/ports/grants.ts`
- Create: `packages/harness/delegations/live.ts`, `packages/harness/delegations/beat.ts`, `packages/harness/delegations/commands.ts`, `packages/harness/delegations/beat.test.ts`
- Modify: `packages/harness/kernel.ts`, `packages/harness/index.ts`
- Create: `sim/scenarios/KN-16.delegation-lapses-when-grant-revoked.ts`, `sim/kernel/delegations.test.ts`

**Interfaces:**
- Produces, in `ports.ts`:

```ts
export type Delegation = {
  readonly id: string;
  readonly personId: string;
  readonly persona: Identity;
  readonly harnessId: string;
  readonly capability: CapabilityWord;
  readonly grantedAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly lapsedAt: Date | null;
  readonly supersedes: string | null;
};
export type DelegationFilter = {
  readonly personId: string | null;
  readonly persona: string | null;
  readonly harnessId: string | null;
};
export type DelegationsGateway = {
  readonly read: {
    byId(delegationId: string): Promise<Delegation | null>;
    live(filter: DelegationFilter, at: Date): Promise<readonly Delegation[]>;
  };
  readonly write: {
    insert(delegation: Delegation, traceId: string): Promise<void>;
    revoke(delegationId: string, at: Date): Promise<boolean>;
    markLapsed(delegationId: string, at: Date): Promise<boolean>;
  };
};

export type Grants = {
  resolve(personId: string, at: Date): Promise<readonly Grant[]>;
  resolveIn(tx: StoreTransaction, personId: string, at: Date): Promise<readonly Grant[]>;
  lockAndReread(tx: StoreTransaction, personId: string, at: Date): Promise<readonly Grant[]>;
};
```

`StoreTransaction.delegations: DelegationsGateway`. `live` returns rows with `revoked_at IS NULL AND lapsed_at IS NULL AND expires_at > at` matching every non-null filter field, ordered by `granted_at`, `id`. `revoke` and `markLapsed` are conditional (`WHERE … IS NULL`) and return whether they changed the row. `resolveIn` is `resolveGrants(executorOf(tx), personId, { at })`: the same query as `resolve`, on the transaction, with no lock (P14: the beat check takes no row lock).

- Produces, in the kernel:

```ts
export type Liveness =
  | { readonly live: true; readonly delegation: Delegation; readonly grants: readonly Grant[] }
  | { readonly live: false; readonly delegation: Delegation | null; readonly why: DelegationLapse | null };
export function assertDelegationLive(tx: StoreTransaction, ports: Ports, delegationId: string, at: Date): Promise<Liveness>;
export function recordLapse(tx: StoreTransaction, context: RecordContext, delegation: Delegation, why: DelegationLapse): Promise<void>;
export function beatPrincipal(delegation: Delegation, grants: readonly Grant[], area: JdArea): Principal;
export function personaMatches(identity: Identity, delegation: Delegation): boolean;
export const DELEGATION_DEFAULT_MS = 90 * 24 * 60 * 60 * 1000;

export type DelegationCommands = {
  grant(caller: Caller, input: { readonly harnessId: string; readonly persona: string; readonly capability: CapabilityWord; readonly expiresAt: Date | null; readonly supersedes: string | null }): Promise<KernelOutcome<Delegation>>;
  revoke(caller: Caller, input: { readonly delegationId: string }): Promise<KernelOutcome<Delegation>>;
  live(caller: Caller, filter: DelegationFilter): Promise<KernelOutcome<readonly Delegation[]>>;
  beat(caller: Caller, input: { readonly delegationId: string }): Promise<KernelOutcome<{ readonly delegation: Delegation; readonly principal: Principal }>>;
};
```

Semantics:
- `assertDelegationLive`: not found → `{ live: false, delegation: null, why: null }`. Otherwise, in this order: `revokedAt` set → `revoked`; `expiresAt <= at` → `expired`; the person's grants read with `ports.grants.resolveIn(tx, personId, at)` do not give `admin` on the harness's area (build a principal-shaped value for `can`) → `grant_lost`; `lapsedAt` set → `grant_lost` (a lapse is final: a delegation never revives; renewal writes a new row); else live.
- `recordLapse`: `markLapsed(id, at)`; only when it returns `true`, record `delegation_lapsed` `{ delegationId, why }` on the harness. So the event is written exactly once per delegation.
- `beatPrincipal`: identity = `delegation.persona`, kind `agent`, `personId` = the delegating person, `email` null, `interactive` false. Grants: `capability === 'none'` → none (P14: `none` opens nothing). Otherwise one grant: `{ grantId: <id of the person's grant that gives admin on the area>, role: 'editor', scopeKind: 'jd_area', scopeArea: area, expiresAt: the earlier of that grant's expiry and the delegation's }`. The ceiling is `editor`, so a beat never holds `admin` and no gate is reachable from it.
- `personaMatches(identity, delegation)`: true when `identity === delegation.persona`, or identity is `agent:<person>/<device> as <slug> via delegation:<id>` with `agent:<slug> === delegation.persona` and `<id> === delegation.id`.
- `grant`: an agent is `not_permitted`; `harness_not_found`; `not_permitted` unless `admin` on the area; `persona` must parse with `personaIdentitySchema`, else `malformed_command`; `expiresAt` defaults to `at + DELEGATION_DEFAULT_MS`, and one at or before `at` is `expiry_in_past`; with `supersedes`: `delegation_not_found` unless it exists, `not_permitted` unless it is the same person, harness and persona; the superseded row is revoked (recording `delegation_revoked`) before the new row is inserted; records `delegation_granted`. Ids from `ports.ids`.
- `revoke`: an agent is `not_permitted`; `delegation_not_found`; allowed to the delegating person or an `admin` on the area; records `delegation_revoked` only when `revoke` changed the row; returns the row as it now is.
- `live`: returns live delegations matching the filter on harnesses the caller may `read` (the access review is the call with every filter field null).
- `beat`: the check every beat runs. Live → `{ delegation, principal: beatPrincipal(…) }`. Not live → `recordLapse` when there is a delegation, then `refused('delegation_lapsed', { why })`; not found → `delegation_not_found`.

- [ ] **Step 1: Write the failing tests**

`sim/scenarios/KN-16.delegation-lapses-when-grant-revoked.ts`: activate software; seed Kim as `admin` on `80-89` (`simPerson(world, 4, …)`); Kim grants `agent:iterate` capability `iterate` with no expiry → expires 90 days after the world's start; `beat` is accepted with a principal `agent:iterate` whose only grant is `editor` on `80-89` and which `can` not `admin`; revoke Kim's grant with `revokeSeededGrant`; `beat` is refused `delegation_lapsed` with `why: 'grant_lost'`; `beat` again is refused the same way; the log holds exactly one `delegation_lapsed`.

`sim/kernel/delegations.test.ts` (`KN-16 …` describes): an agent and an area editor cannot grant; `expiresAt` in the past is `expiry_in_past`; an expired delegation's `beat` lapses `expired` once; a revoked one lapses `revoked`; another area admin may revoke Kim's delegation, an editor may not; renewal with `supersedes` revokes the old row and the new one names it; `live` filters by person, by persona and by harness, and the all-null filter lists every live one; capability `none` gives a principal with no grants.

`packages/harness/delegations/beat.test.ts`: `personaMatches` for `agent:iterate`, for `agent:avery/laptop as iterate via delegation:<id>` (true), and with another id or persona (false).

Add a grants contract case `DX-3 reads grants inside a transaction without a lock` (`resolveIn` sees a grant and, after a revoke, does not) and `resolveIn` to `describeGrantsNotWired`'s list; a Store contract case for the delegations gateway (insert, `live` filters and expiry at an instant, conditional `revoke` and `markLapsed` return `true` once then `false`).

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run sim/kernel/delegations.test.ts packages/harness/delegations sim/adapters apps/uw-app/ports && pnpm sim -- KN-16`
Expected: FAIL.

- [ ] **Step 2: Extend the port (shared root, own commit)** with the types above and commit alone: `feat(harness): a delegations gateway, and Grants.resolveIn for the beat check inside a transaction` (body: "P14's beat check reads the person's grants inside the claim's transaction without a row lock; resolve outside the transaction would be refused while it is open." and `KN-16 DX-3`).

- [ ] **Step 3: Implement** the gateway, `resolveIn` (Drizzle grants and the not-wired platform adapter's `resolveIn: () => notWiredCall('grants', 'resolveIn')`), and the three delegation modules; add `delegations` to the `Kernel`.

- [ ] **Step 4: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness packages/db/store apps/uw-app/ports sim
git commit -m "feat(harness): delegations with a required expiry, checked at every beat, lapsing once" -m "KN-16"
```

### Task 14: Claim and release

**Requirements:** KN-5 (claim: `can`, pickup, WIP for people and agents in one transaction, one conditional UPDATE, a 15-minute agent lease, no lease for a person, claimant and delegation recorded), KN-16 (a claim under a delegation checks it), KN-8 groundwork (a non-interactive principal needs a delegation).

**Files:**
- Create: `packages/harness/items/claim.ts`, `packages/harness/items/leases.ts` (the constants and `expireLapsedLease`; Task 15 adds the rest)
- Modify: `packages/harness/items/commands.ts`, `packages/harness/index.ts`
- Create: `sim/scenarios/KN-5.claim-takes-a-lease.ts`, `sim/scenarios/KN-5.wip-limit-for-people-and-agents.ts`, `sim/scenarios/KN-5.agent-cannot-claim-in-a-none-stage.ts`, `sim/kernel/claim.test.ts`

**Interfaces:**
- Produces:

```ts
export const LEASE_MS = 15 * 60 * 1000;
export const LEASE_WARNING_MS = 3 * 60 * 1000;
export function expireLapsedLease(tx: StoreTransaction, context: RecordContext, item: ItemState): Promise<ItemState>;

export type Claimed = { readonly item: ItemState; readonly leaseExpiresAt: string | null; readonly leaseWarning: boolean };
ItemCommands gains:
  claim(caller: Caller, input: { readonly itemId: string; readonly delegationId: string | null }): Promise<KernelOutcome<Claimed>>;
  release(caller: Caller, input: { readonly itemId: string }): Promise<KernelOutcome<ItemState>>;
```

`expireLapsedLease`: when the item has a holder and a lease at or before `context.at`, records `lease_expired` `{ holder, leaseExpiresAt }`, and when `branchState` is `active` also `branch_abandoned` `{ head: expectedHead }`, and returns the folded item; otherwise returns the item unchanged and records nothing. It runs on a locked row, so the lapse is recorded once.

`claim`, in one transaction and in this order (the order is the lock order):
1. `pre = harnessItems.read.byId` → `item_not_found`; its harness and stages.
2. `not_permitted` unless `allowed(actor, 'write', harness, at)` (editor on the area; KN-5, PRD 11).
3. `not_permitted` with detail `{ why: 'parked' }` or `{ why: 'done' }` when the item's gate status is `parked` or `done` (a parked item waits on a person's gate decision; a done item has left the harness).
4. An agent in a stage whose `agentPickup` is `none` → `pickup_not_allowed`.
5. A non-interactive principal without `delegationId` → record `delegation_required` `{ stage }` on the item and refuse `delegation_required`.
6. With `delegationId`: `assertDelegationLive`; not live → `recordLapse` (when there is a delegation), refuse `delegation_lapsed` (or `delegation_not_found`); a live delegation for another harness, or whose persona does not match the principal (`personaMatches`), is `not_permitted`. Steps 5 and 6 return right after their one append, so no lock follows an append.
7. `tx.lock(lockKeys.stageClaims(stage.id))`, then `item = harnessItems.read.lock(itemId)`; if its stage changed since step 1, `not_permitted` `{ why: 'moved' }`.
8. A holder with no lease (a person) or a lease after `at` → `lease_held` (also when the holder is the caller).
9. `item = expireLapsedLease(tx, context, item)`.
10. `harnessItems.read.heldInStage(harness.id, stage.key, at) >= stage.wipLimit` → `wip_limit_reached`.
11. `leaseExpiresAt` = `at + LEASE_MS` for an agent, `null` for a person. `harnessItems.write.claim({ itemId, holder: actor.identity, claimantKind: actor.kind, delegationId, leaseExpiresAt, at })`; `false` → `lease_held`.
12. Record `item_claimed` `{ holder, claimantKind, delegationId, leaseExpiresAt }`; return `{ item, leaseExpiresAt, leaseWarning: false }`.

`release`: `item_not_found`; the holder may release, and so may an `admin` on the area; anyone else, or an unheld item, is `not_holder`; records `item_released` `{ holder }`.

- [ ] **Step 1: Write the failing scenarios and tests**

Every scenario activates software with `createSimHarness`, makes the Package stage agent-claimable where it needs to with `updateStage(package, { agentPickup: 'allowed' })` (and `wipLimit` 1 for the WIP scenario), and enqueues as an editor.

`KN-5.claim-takes-a-lease.ts`: `agent:builder` (owner an area editor, interactive) claims; the outcome's `leaseExpiresAt` is the world start plus 15 minutes; the item holds `agent:builder`, kind `agent`, `delegationId` null; a second agent's claim is `lease_held`; the editor's own claim is `lease_held`; after `release` by the agent, the editor claims and the item has no lease.

`KN-5.wip-limit-for-people-and-agents.ts`: with `wipLimit` 1, the editor claims item 1; `agent:builder` claiming item 2 is `wip_limit_reached`; after the editor releases, the agent's claim of item 2 is accepted.

`KN-5.agent-cannot-claim-in-a-none-stage.ts`: on the unchanged template (Package pickup `none`) the agent's claim is `pickup_not_allowed` and the editor's is accepted.

`sim/kernel/claim.test.ts`:
- a viewer is `not_permitted`;
- a non-interactive agent with no delegation is `delegation_required` and the item's log gains `delegation_required`;
- under a live delegation (granted by an area admin to `agent:builder`, claimed by `simAgent(owner, 'builder', { interactive: false })`) the item and its `item_claimed` carry the delegation id;
- a lapsed delegation is `delegation_lapsed` and writes one `delegation_lapsed`; a delegation for another harness is `not_permitted`;
- an agent whose lease lapsed (advance the sim clock 16 minutes) is replaced by another agent's claim, and the log reads `item_claimed, lease_expired, item_claimed` with one `lease_expired`;
- `release` by a non-holder editor is `not_holder`; by an org admin is accepted.

Run: `pnpm vitest run sim/kernel/claim.test.ts && pnpm sim -- KN-5`
Expected: FAIL.

- [ ] **Step 2: Implement** `claim.ts` as a sequence of small guard functions (`claimGuards`, `delegationGuard`, `takeClaim`) so each stays within the limits, and `release`.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness sim
git commit -m "feat(harness): claim under can(), pickup and WIP in one transaction, one conditional update, a lease for agents only" -m "KN-5 KN-16"
```

### Task 15: Lease renewal, run steps, the warning, and the expiry sweep

**Requirements:** KN-5 (`record_run_step` renews the lease; expiry releases the item and writes `lease_expired` exactly once), P8 (15 minutes; lazy detection plus a sweep; the warning 3 minutes before expiry), Review Focus 2.

**Files:**
- Modify: `packages/harness/items/leases.ts`, `packages/harness/items/commands.ts`
- Create: `sim/scenarios/KN-5.lease-expiry-releases-once.ts`, `sim/scenarios/KN-5.record-run-step-renews-the-lease.ts`, `sim/kernel/leases.test.ts`

**Interfaces:**
- Produces (on `ItemCommands`):

```ts
export type LeaseOutcome = { readonly leaseExpiresAt: string; readonly leaseWarning: boolean };
renewLease(caller: Caller, input: { readonly itemId: string }): Promise<KernelOutcome<LeaseOutcome>>;
recordRunStep(caller: Caller, input: { readonly itemId: string; readonly runId: string; readonly step: RunStep; readonly tokensIn: number; readonly tokensOut: number; readonly costBasis: CostBasis }): Promise<KernelOutcome<LeaseOutcome>>;
expireLeases(caller: Caller, input: { readonly limit: number }): Promise<KernelOutcome<{ readonly expired: readonly string[] }>>;
```

`renewLease` and `recordRunStep` share one function: lock the item (`item_not_found`); the caller must be the holder and an agent (a person's claim has no lease), else `not_holder`; when the item carries a delegation id, `assertDelegationLive` must pass, else `recordLapse` and `delegation_lapsed`; a lease at or before `at` → `expireLapsedLease`, then `refused('lease_expired')` (the step on an expired lease is refused, AB-4); else the new lease is `at + LEASE_MS`, recorded as `lease_renewed` `{ leaseExpiresAt }` or `run_step_recorded` `{ runId, step, tokensIn, tokensOut, costBasis, leaseExpiresAt }`. `leaseWarning` is `true` when the lease the step arrived on had `LEASE_WARNING_MS` or less left (decision: the warning tells the runner it nearly lost the lease, so its skill pushes a `wip:` commit; measured before renewal, since after renewal 15 minutes always remain). `expireLeases` (the one-minute cron's body, P8) needs no grant (it is platform maintenance; its actor is the caller): it reads `lapsedLeases(at, limit)` in one transaction, then expires each in its own transaction (`lock`, then `expireLapsedLease`), and returns the ids whose lease it expired.

- [ ] **Step 1: Write the failing scenarios and tests**

`KN-5.lease-expiry-releases-once.ts`: an agent claims; the clock advances 16 minutes; `expireLeases` returns the item; again returns `[]`; another agent claims; the item's log is `item_created, item_claimed, lease_expired, item_claimed` (one `lease_expired`). Then the reverse order on a second item: let its lease lapse, claim (lazy expiry writes `lease_expired`), then `expireLeases` returns `[]`.

`KN-5.record-run-step-renews-the-lease.ts`: an agent claims at T; at T+13 min a `recordRunStep` (`step: 'work'`, tokens 1200/300, `costBasis: 'subscription'`) returns `leaseExpiresAt` T+28 and `leaseWarning: true`; at T+18 another step returns T+33 and `leaseWarning: false`; at T+50 a step is `lease_expired` and the log gains one `lease_expired`.

`sim/kernel/leases.test.ts`: a non-holder's renew is `not_holder`; a person holder's renew is `not_holder`; a step under a delegation whose grant was revoked is `delegation_lapsed` and writes one `delegation_lapsed`.

Run: `pnpm vitest run sim/kernel/leases.test.ts && pnpm sim -- KN-5`
Expected: FAIL.

- [ ] **Step 2: Implement** and wire into `ItemCommands`.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness sim
git commit -m "feat(harness): run steps renew the lease and warn near expiry; a lapsed lease is released once by claim or sweep" -m "KN-5"
```

### Task 16: Claims race on real connections

**Requirements:** DX-6 (N concurrent claims on one item; two claims racing one WIP slot), KN-5 (exactly one caller succeeds).

**Files:**
- Create: `apps/uw-app/testing/kernel.ts`, `apps/uw-app/harness/claims.pg.test.ts`

**Interfaces:**
- Produces (test helpers, imported only by `*.pg.test.ts`):

```ts
export function kernelOn(db: Database, clock: Clock): Kernel;
export function personOn(db: Database, personId: string, email: string, at: Date): Promise<Principal>;
export function agentOf(owner: Principal, persona: string): Principal;
```

`kernelOn` builds `createKernel` over `platformStore(db)`, `platformGrants(db)`, the given clock, `randomIds`, and the not-wired adapters for the other seven ports.

- [ ] **Step 1: Write the tests**

```ts
describe.skipIf(!testServer)('DX-6 KN-5 claims race on separate connections', () => {
  it('lets exactly one of eight concurrent claims on one item succeed', () =>
    withSharedDatabase(async (connections) => {
      const { item, owner } = await setUp(connections[0], { wipLimit: 3 });
      const outcomes = await Promise.all(
        connections.map((db, n) => kernelOn(db, clock).items.claim(caller(agentOf(owner, `builder-${n}`)), {
          itemId: item.itemId,
          delegationId: null,
        })),
      );
      expect(outcomes.filter((outcome) => outcome.status === 'accepted')).toHaveLength(1);
      expect(reasons(outcomes)).toEqual(Array(7).fill('lease_held'));
      expect(await claimedEvents(connections[0], item)).toHaveLength(1);
    }));

  it('lets one of two claims racing one WIP slot succeed', () =>
    withSharedDatabase(async (connections) => {
      const { items, owner } = await setUpTwo(connections[0], { wipLimit: 1 });
      const outcomes = await Promise.all(
        items.map((item, n) => kernelOn(connections[n + 1], clock).items.claim(caller(agentOf(owner, `builder-${n}`)), {
          itemId: item.itemId,
          delegationId: null,
        })),
      );
      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['accepted', 'error']);
      expect(reasons(outcomes)).toEqual(['wip_limit_reached']);
    }));
});
```

`withSharedDatabase(work)` creates one migrated database (`createMigratedDatabase(testServer)`), opens eight `createClient` connections to it, runs `work`, and always ends every client and drops the database. `setUp` activates software as Ian through `kernelOn(connections[0], …)`, sets Package's `agentPickup` to `allowed` and its `wipLimit`, seeds an area editor as the owner, and enqueues. Repeat each race five times inside its `it` (fresh items each round) so an ordering accident cannot pass it once.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-app/harness/claims.pg.test.ts`
Expected: PASS once Tasks 14 and 15 are in (this task adds tests only; if it fails, the claim's lock order or conditional update is wrong — fix it in `packages/harness/items/claim.ts` in this task).

- [ ] **Step 2: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS, and the two races ran (not skipped).

```bash
git add apps/uw-app/testing/kernel.ts apps/uw-app/harness/claims.pg.test.ts
git commit -m "test(uw-app): eight claims on one item and two claims on one WIP slot, on separate connections" -m "DX-6 KN-5"
```

### Task 17: Submit and the exit gates

**Requirements:** KN-6 (exit gates enforced server-side on submit: `none` advances, `checks` runs every validator and advances only if all pass, otherwise returns the failures and writes them as an event; `human_approval` parks and never advances from submit), GH-4 groundwork (the submit records the expected head).

**Files:**
- Create: `packages/harness/items/transitions.ts`, `packages/harness/items/submit.ts`
- Modify: `packages/harness/items/commands.ts`, `packages/harness/index.ts`, `sim/fixtures.ts`
- Create: `sim/scenarios/KN-6.exit-gates-are-enforced-on-submit.ts`, `sim/scenarios/KN-6.a-failing-validator-holds-the-item.ts`, `sim/kernel/submit.test.ts`

**Interfaces:**
- Consumes: `runValidators`, `attachedPageIds`, `readAllEvents`, `recordItemEvents`, `assertDelegationLive`, `recordLapse`.
- Produces:

```ts
export type SubmitChange = {
  readonly pullRequest: PullRequestRef;
  readonly head: string;
  readonly paths: readonly string[];
  readonly declaration: RiskDeclaration | null;
};
export type SubmitInput = {
  readonly itemId: string;
  readonly to: string | null;
  readonly evidence: HarnessEvent['evidence'];
  readonly change: SubmitChange | null;
};
export type Submitted = {
  readonly item: ItemState;
  readonly result: SubmitToGateResult;
  readonly failures: readonly string[];
};
ItemCommands gains: submit(caller: Caller, input: SubmitInput): Promise<KernelOutcome<Submitted>>;

export type Exit =
  | { readonly kind: 'forward'; readonly from: Stage; readonly to: Stage | null }
  | { readonly kind: 'loop'; readonly from: Stage; readonly to: Stage };
export function resolveExit(stages: readonly Stage[], from: Stage, to: string | null): Exit | null;
export function exitDrafts(exit: Exit): readonly EventDraft[];

export function simAdvance(world: World, input: { readonly harnessId: string; readonly itemId: string; readonly worker: Principal; readonly through: readonly string[] }): Promise<ItemState>;
```

`resolveExit` (Task 18 adds the loop case): `to` null → forward to the next stage by position, or to `null` from the last stage; `to` equal to the next stage's key → forward; anything else → `null` (refused `transition_not_allowed` with detail `{ from, to }`). `exitDrafts` of a forward exit is `stage_advanced` `{ from, to: to?.key ?? null }`.

`submit`, in one transaction:
1. `item = harnessItems.read.lock` → `item_not_found`; harness; stages.
2. `not_permitted` unless `allowed(actor, 'write', harness, at)`; `not_holder` unless `item.holder === actor.identity` (a parked or done item has no holder, so it cannot be resubmitted).
3. When the item carries a delegation id: `assertDelegationLive`; not live → `recordLapse`, refuse `delegation_lapsed` (KN-16: the check runs at every beat).
4. `exit = resolveExit(…)` or `transition_not_allowed`.
5. The `submitted_to_gate` evidence is `{ stage, result, to: input.to, expectedHead: change?.head ?? null, pullRequest: change?.pullRequest ?? null, evidence: input.evidence }`.
6. By the stage's `exitGate`, through a `Map<ExitGate, handler>`:
   - `none`: `[submitted_to_gate(advanced), …exitDrafts(exit)]`.
   - `checks`: read the item's events (`readAllEvents`) and the facts of its attached pages (`tx.pages.read.facts(attachedPageIds(events))`), `failures = runValidators(stage.validators, { item, events, pages })`. Failures → `[submitted_to_gate(checks_failed), checks_failed { stage, failures }]`, the item stays in the stage, held. None → `[submitted_to_gate(advanced), checks_passed { stage, validators }, …exitDrafts(exit)]`.
   - `human_approval`: `[submitted_to_gate(parked)]`. Nothing on the submit path advances past it.
7. Record and return `{ item, result, failures }`. A `checks_failed` result is an accepted outcome (the `submit_to_gate` verb's output carries `result` and `failures`).

`simAdvance` claims and submits (`to: null`, `evidence: {}`, `change: null`) once per stage key in `through`, as `worker`, throwing with the refusal reason if any outcome is not accepted.

- [ ] **Step 1: Write the failing scenarios and tests**

`KN-6.exit-gates-are-enforced-on-submit.ts`: activate software; an editor enqueues, claims and submits at Package (`none`) → `advanced`, item in `scope`, unheld; `agent:builder` claims and submits at Scope (`checks`, no validators) → `advanced` to `plan` and the log holds `checks_passed`; advance to `ship` with `simAdvance`; the editor claims Ship and submits → `parked`, the item stays in `ship` with `gateStatus` `parked` and no holder; submitting again is `not_holder`; the item is still in `ship`.

`KN-6.a-failing-validator-holds-the-item.ts`: give Scope `validators: ['learning_attached']` through `updateStage`; an agent's submit at Scope returns `checks_failed` with the `learning_attached` failure, the log holds `checks_failed` with those failures, and the item stays in `scope`, held by the agent, with `gateStatus` `checks_failed`.

`sim/kernel/submit.test.ts`:
- a non-holder editor is `not_holder`; a viewer is `not_permitted`;
- `to: 'close'` from Scope is `transition_not_allowed` with detail `{ from: 'scope', to: 'close' }`;
- `describe('KN-6 an unknown validator key fails closed with the key in the failure', …)`: in the test, write a stage row whose validators are `['retired_check']` through the gateway (the stage command would refuse it; this is a key that was valid when written and is no longer registered); submit returns `checks_failed` with `['unknown_validator: retired_check']`;
- a submit with a `change` records `expectedHead` and `pullRequest` on the item and sets `branchState` `active`;
- `describe('KN-6 the last stage closes the item', …)`: an item submitted at Close with a passing validator ends `done`.

Run: `pnpm vitest run sim/kernel/submit.test.ts && pnpm sim -- KN-6`
Expected: FAIL.

- [ ] **Step 2: Implement** `transitions.ts`, `submit.ts` (one handler per exit gate in a `Map`), `simAdvance`.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness sim
git commit -m "feat(harness): submit enforces each exit gate: none advances, checks runs every validator, human approval parks" -m "KN-6"
```

### Task 18: Feeds, loop edges, and the occasional tweak

**Requirements:** KN-8 (a transition to a stage that is neither next nor in `feeds` is refused; the occasional tweak to Package requires a recorded human gate decision; an unattended traversal of a loop edge is refused without a delegation id), P9 (the same item re-enters, with `loop_edge_taken`).

**Files:**
- Modify: `packages/harness/items/transitions.ts`, `packages/harness/items/submit.ts`
- Create: `sim/scenarios/KN-8.feeds-edges-and-refused-transitions.ts`, `sim/kernel/loop-edges.test.ts`

**Interfaces:**
- `resolveExit` gains: `to` in `from.feeds` (and not the next stage) → `{ kind: 'loop', from, to }`. `exitDrafts` of a loop is `loop_edge_taken` `{ from, to }`.
- `submit` gains, after step 4:
  - a loop exit by a non-interactive principal on an item with no delegation id → record `delegation_required` `{ stage }`, refuse `delegation_required`;
  - **the occasional tweak**: a loop exit whose target is the harness's first stage (lowest position) never moves the item on submit. Where the exit would otherwise advance (`none`, or `checks` with every validator passing), the drafts are `submitted_to_gate(parked)` with `to` = the first stage's key (plus `checks_passed` for a `checks` exit), so the item parks with `gateTarget` set and only a person's gate decision (Task 22) takes the edge. A `human_approval` stage parks with `to` as usual.

- [ ] **Step 1: Write the failing scenario and tests**

`KN-8.feeds-edges-and-refused-transitions.ts`: activate software; give Plan `feeds: ['scope']` and Scope `feeds: ['package']`; move an item to Plan; the agent's submit at Plan with `to: 'scope'` → `advanced`, the log holds `loop_edge_taken` `{ from: 'plan', to: 'scope' }`, the item is the same item, in `scope`, unheld, `working`; at Scope, `to: 'close'` is `transition_not_allowed`; `to: 'package'` (the occasional tweak) → `parked` with `gateTarget` `package` and the item still in `scope`. Return the parked item in the state.

`sim/kernel/loop-edges.test.ts`:
- `describe('KN-8 an unattended traversal of a loop edge is refused without a delegation id', …)`: in the test, project the item as held by a non-interactive `agent:iterate` with no delegation (through the gateway; claim would already have refused such a principal, so this is the only way to reach the submit check); submit `to: 'scope'` is `delegation_required` and writes `delegation_required`;
- the same submit by a non-interactive agent that claimed under a live delegation is accepted;
- a feeds target that is also the next stage is a forward exit (`stage_advanced`, not `loop_edge_taken`).

Run: `pnpm vitest run sim/kernel/loop-edges.test.ts && pnpm sim -- KN-8`
Expected: FAIL.

- [ ] **Step 2: Implement**, keeping `submit.ts` under 500 lines and each function under 50 (move the loop-specific rules into `transitions.ts`).

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness sim
git commit -m "feat(harness): feeds edges re-enter an earlier stage; the tweak to Package parks for a person; unattended loops need a delegation" -m "KN-8"
```

### Task 19: Attaching a learning and signing "nothing learned"

**Requirements:** KN-7 (the item carries a suggested learning or skill page, or a `nothing_learned` marker with a one-line reason set by a person, with who, when and why recorded as an event).

**Files:**
- Create: `packages/harness/items/learning.ts`
- Modify: `packages/harness/items/commands.ts`
- Create: `sim/scenarios/KN-7.close-needs-a-learning-or-a-signed-nothing-learned.ts`, `sim/kernel/learning.test.ts`

**Interfaces:**
- `ItemCommands` gains:

```ts
attachLearning(caller: Caller, input: { readonly itemId: string; readonly pageId: string }): Promise<KernelOutcome<ItemState>>;
markNothingLearned(caller: Caller, input: { readonly itemId: string; readonly reason: string }): Promise<KernelOutcome<ItemState>>;
```

`attachLearning`: `item_not_found`; `not_permitted` unless `write` on the area; `page_not_found` unless `tx.pages.read.facts([pageId])` finds it; records `learning_attached` `{ pageId }`. Whether the page counts is the validator's judgement at Close, not this command's. `markNothingLearned`: `item_not_found`; an agent is `not_permitted` (the marker is a claim a person signs); `not_permitted` unless `write` on the area; the trimmed reason must be non-empty (`reason_required`) and one line of at most 200 characters (`reason_not_one_line`); records `nothing_learned` `{ reason }` with the person as actor and the command's instant (who, when and why).

- [ ] **Step 1: Write the failing scenario and tests**

`KN-7.close-needs-a-learning-or-a-signed-nothing-learned.ts` (Close is reached through Ship only after Task 23, so this scenario gives Scope Close's validator with `updateStage(scope, { validators: ['learning_attached'] })`; Task 23's end-to-end scenario repeats the rule at the real Close):
- item A at Scope: submit → `checks_failed` (no learning);
- seed a `suggested` learning page with body `- [observed] the board loads in 300 ms` (`seedPage` from `@uw/db/test-seed`); `attachLearning`; submit → `advanced`;
- item B: seed a `suggested` learning with `- the board is faster`; attach; submit → `checks_failed` naming the unlabelled claim;
- item C: `markNothingLearned` by the editor with "Routine dependency bump"; submit → `advanced`; the `nothing_learned` event's actor is the editor and its `at` is the sim instant.

`sim/kernel/learning.test.ts`: an agent's `markNothingLearned` is `not_permitted`; a blank reason is `reason_required`; a two-line reason is `reason_not_one_line`; attaching an unknown page is `page_not_found`; a viewer is `not_permitted`.

Run: `pnpm vitest run sim/kernel/learning.test.ts && pnpm sim -- KN-7`
Expected: FAIL.

- [ ] **Step 2: Implement and wire.**

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness sim
git commit -m "feat(harness): attach a learning to an item, or have a person sign nothing learned with a one-line reason" -m "KN-7"
```

### Task 20: Risk tier and domains

**Requirements:** KN-17, P15.

**Files:**
- Create: `packages/harness/risk/protected-directories.ts`, `packages/harness/risk/derive.ts`, `packages/harness/risk/domain-grants.ts`, `packages/harness/risk/risk.test.ts`
- Modify: `packages/harness/items/submit.ts`, `packages/harness/index.ts`
- Create: `sim/scenarios/KN-17.risk-is-floored-by-paths-and-raised-by-declaration.ts`

**Interfaces:**
- Produces:

```ts
export type ProtectedDirectory = { readonly path: string; readonly domain: RiskDomain };
export const protectedDirectories: readonly ProtectedDirectory[];
export function domainOf(path: string): RiskDomain | null;
export type RiskFloor = { readonly tier: RiskTier | null; readonly domains: readonly RiskDomain[] };
export function floorFromPaths(paths: readonly string[]): RiskFloor;
export type RiskResult =
  | { readonly ok: true; readonly tier: RiskTier; readonly domains: readonly RiskDomain[] }
  | { readonly ok: false; readonly reason: 'risk_tier_undeclared'; readonly domains: readonly RiskDomain[] };
export function applyDeclaration(floor: RiskFloor, declaration: RiskDeclaration | null): RiskResult;
export const domainGrants: ReadonlyMap<RiskDomain, AclResource>;
export function requiredResources(area: JdArea, domains: readonly RiskDomain[]): readonly AclResource[];
export function approverCovers(approver: Principal, area: JdArea, domains: readonly RiskDomain[], at: Date): boolean;
```

The protected-directory map (P15; reviewed data, one file):

```ts
export const protectedDirectories: readonly ProtectedDirectory[] = [
  { path: 'packages/db/migrations/', domain: 'migration' },
  { path: 'packages/core/acl.ts', domain: 'acl' },
  { path: 'apps/uw-app/acl/', domain: 'acl' },
  { path: 'infra/', domain: 'infra' },
  { path: '.github/workflows/', domain: 'infra' },
  { path: 'packages/ledger/', domain: 'ledger' },
];
```

An entry ending in `/` matches every path under it; any other entry matches that file only. A path is normalised by dropping a leading `./`. `floorFromPaths` returns the touched domains in `riskDomainSchema.options` order without duplicates, and tier `high` when there is at least one, else `null`. `applyDeclaration`: no declaration → `{ ok: false, reason: 'risk_tier_undeclared', domains: floor.domains }`; otherwise the tier is the higher of the floor's and the declaration's (order `low` < `standard` < `high`) and the domains the union in schema order; it never lowers or removes. `domainGrants` (the one place the ship rule reads): `ledger` → `{ kind: 'area', area: '20-29' }`; `acl`, `infra`, `migration` → `{ kind: 'org' }`. `requiredResources` is the harness's area followed by each domain's resource; `approverCovers` is true when `can(approver, 'admin', resource, at)` holds for every one of them.

`submit` gains, when `input.change` is not null: `floor = floorFromPaths(change.paths)`, `result = applyDeclaration(floor, change.declaration)`, and a `risk_derived` draft first: `{ paths, declaration, floorDomains: floor.domains, riskTier: result.ok ? result.tier : null, riskDomains: result.domains, refusal: result.ok ? null : 'risk_tier_undeclared' }`. An undeclared tier does not stop the submit; the ship rule refuses it at Ship.

- [ ] **Step 1: Write the failing tests**

`risk/risk.test.ts`, describes `KN-17 …`:
- every protected path appears once, and no entry is a prefix of another, so each path maps to at most one domain;
- `floorFromPaths(['apps/uw-app/board.tsx'])` is `{ tier: null, domains: [] }`; `['packages/db/migrations/0009_x.sql', 'infra/uw-app/wrangler.toml', './infra/x.json']` is `{ tier: 'high', domains: ['infra', 'migration'] }`; `['packages/core/acl.ts']` is `acl`; `['packages/core/acl.test.ts']` is none;
- `applyDeclaration` with `{ riskTier: 'low', riskDomains: [] }` over a `high` floor stays `high` with the floor's domains; a declaration may add `ledger`; with `null` is `risk_tier_undeclared`;
- `approverCovers`: an area admin covers `[]` but not `['acl']`; an org admin covers `['acl', 'infra']`; `['ledger']` needs `admin` on `20-29` as well as the area (an org admin has both); one approver must hold every grant; an expired grant at `at` does not count.

`KN-17.risk-is-floored-by-paths-and-raised-by-declaration.ts`: an item submitted at Build with a change touching `packages/db/migrations/0009_x.sql` declared `standard` with no domains carries `riskTier` `high` and `riskDomains` `['migration']`, and its `risk_derived` evidence holds the paths and the declaration; a second submit with no declaration records `refusal: 'risk_tier_undeclared'` and leaves `riskTier` null.

Run: `pnpm vitest run packages/harness/risk && pnpm sim -- KN-17`
Expected: FAIL.

- [ ] **Step 2: Implement and wire into `submit`.**

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness sim
git commit -m "feat(harness): risk tier floored by protected paths, raised and never lowered by the declaration, recorded at submit" -m "KN-17"
```

### Task 21: The ship rule

**Requirements:** KN-11, KN-12, P11, P12.

**Files:**
- Create: `packages/harness/ship-rule.ts`, `packages/harness/ship-rule.test.ts`, `tools/properties/ship-rule.test.ts`, `tools/ci/ci-jobs.test.ts`
- Modify: `packages/harness/kernel.ts`, `packages/harness/index.ts`

**Interfaces:**
- Produces: `shipRule(input: ShipRuleInput): ShipRuleOutcome`, pure, no clock (it reads `input.at`), no ports; `Kernel.shipRule`.

The rule is a `Map<ShipRefusal, (input) => boolean>` of failing predicates; the reasons are `shipRefusalSchema.options.filter(fails)`, so every failing reason is reported in the order of section 8.5 (P11). With `head` the pull request's head and *reviewers* the distinct `reviewer` values of approvals whose `commit === head`:

| Reason | Fails when |
|---|---|
| `pr_not_open` | `pullRequest` is null or not open |
| `pr_is_draft` | `pullRequest` is a draft |
| `head_mismatch` | `pullRequest` or `expectedHead` is null, or `head !== expectedHead` |
| `checks_not_green` | there is no pull request, or for some job in `ciJobSchema.options` the checks with that `name` and `headSha === head` are none, or any of them is not `success` |
| `no_reviewer_approval` | no reviewer approved the head, unless `override` (P12: override bypasses only this) |
| `risk_tier_undeclared` | `riskTier` is null |
| `reviewer_count_below_tier` | `riskTier` is `high` and fewer than two reviewers approved the head |
| `reviewer_providers_not_distinct` | `riskTier` is `high`, at least two reviewers approved the head, and fewer than two distinct non-null providers are recorded on those approvals |
| `approver_lacks_domain_grant` | `approverCovers(approver, area, riskDomains, new Date(at))` is false |

The verdict is `advance` when no reason fails, else `{ verdict: 'refuse', reasons }`. The approver's kind is not the rule's concern (the gate command refuses agents before it runs).

- [ ] **Step 1: Write the failing tests**

`ship-rule.test.ts`, from a top-level `green()` input (open, not draft, head `abc123` = expected, the six jobs `success` on `abc123`, one approval by `reviewer-openrouter` with provider `anthropic` on `abc123`, tier `standard`, no domains, area `80-89`, an area-admin approver, `at` `2026-10-01T09:00:00.000Z`, override false), describes:
- `KN-11 the ship rule advances on green facts`;
- `KN-11 each fact refuses with its reason`: one case per row, changing one field of `green()`; an approval on `old999` does not count; a seventh unrelated check does not matter; a `failure` re-run beside a `success` of the same job refuses;
- `KN-12 low and standard need one reviewer; high needs two on distinct providers`: `high` with one reviewer → `reviewer_count_below_tier`; two reviewers both `anthropic` → `reviewer_providers_not_distinct`; `anthropic` and `openai` → advance (with an org-admin approver if domains are set);
- `KN-12 the approver holds admin on the area plus each domain's grant`: `acl` with an area admin → `approver_lacks_domain_grant`; with an org admin → advance; `ledger` with admin on `80-89` and on `20-29` → advance;
- `KN-11 P11 every failing reason is reported, in section 8.5 order`: a draft, mismatched, red, unreviewed, undeclared input returns exactly `['pr_is_draft', 'head_mismatch', 'checks_not_green', 'no_reviewer_approval', 'risk_tier_undeclared', 'approver_lacks_domain_grant']` (with an approver lacking the area grant);
- `KN-12 P12 override bypasses no_reviewer_approval and nothing else`.

`tools/properties/ship-rule.test.ts`, `describe('KN-12 the ship rule is deterministic over random inputs', …)`: an arbitrary over every input field from small pools (heads `a`/`b`, jobs from the six plus `extra`, conclusions from the schema, reviewers `r1`..`r3`, providers `anthropic`/`openai`/null, tiers incl. null, domain subsets, approver grants from a pool of org/area admin/editor grants with and without expiry): the outcome equals the outcome for `structuredClone(input)`; it parses with `shipRuleOutcomeSchema`; the reasons are distinct and in schema order; and the override outcome's reasons equal the plain outcome's minus `no_reviewer_approval`. 1000 runs.

`tools/ci/ci-jobs.test.ts`, `describe('KN-11 the six jobs the ship rule reads are the CI job names', …)`: parse `.github/workflows/ci.yml` with `yaml` and expect its job keys, in order, to equal `ciJobSchema.options` (import the schema by relative path from `packages/contracts/ship-rule.ts`).

Run: `pnpm vitest run packages/harness/ship-rule.test.ts tools/properties/ship-rule.test.ts tools/ci/ci-jobs.test.ts`
Expected: FAIL — `ship-rule.ts` does not exist (`ci-jobs.test.ts` may already pass; it guards the contract).

- [ ] **Step 2: Implement** with each predicate a named top-level function; add `shipRule` to the kernel and the index.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS; `no-clock-reads.test.ts` still finds no clock read in `packages/harness`.

```bash
git add packages/harness tools/properties/ship-rule.test.ts tools/ci/ci-jobs.test.ts
git commit -m "feat(harness): the ship rule, pure over GitHub facts, the risk tier and the approver, reporting every reason in order" -m "KN-11 KN-12"
```

### Task 22: The gate decision command: who may decide, the locked re-read, reject, take over, and approve without a connector

**Requirements:** KN-13 (human principals only, an agent's call writes `gate_refused_to_agent` and changes nothing; `admin` on the area; the `FOR SHARE` re-read and the `gate_decisions` insert in one transaction; reject returns the item with findings; take over reassigns it to a person), KN-8 (the occasional tweak's recorded human decision), P13, Review Focus 3.

**Files:**
- Modify (own commit): `packages/harness/ports.ts` (the `gateDecisions` gateway)
- Create: `packages/db/store/gate-decisions.ts`; modify `packages/db/store/store.ts`, `types.ts`, `rows.ts`, `packages/harness/port-contracts/store-gateways.ts`
- Create: `packages/harness/gates/decide.ts`, `packages/harness/gates/commands.ts`
- Modify: `packages/harness/kernel.ts`, `packages/harness/index.ts`
- Create: `sim/scenarios/KN-13.agent-cannot-write-decision.ts`, `sim/scenarios/KN-13.reject-and-take-over.ts`, `sim/scenarios/KN-8.occasional-tweak-needs-a-person.ts`, `sim/kernel/gate-command.test.ts`

**Interfaces:**
- Produces, in `ports.ts`:

```ts
export type GateDecisionRow = {
  readonly id: string;
  readonly harnessId: string;
  readonly itemId: string;
  readonly stageId: string;
  readonly actor: Identity;
  readonly decision: GateDecision;
  readonly reason: string | null;
  readonly evidence: HarnessEvent['evidence'];
  readonly traceId: string;
  readonly decidedAt: Date;
};
export type GateDecisionsGateway = {
  readonly read: { forItem(itemId: string): Promise<readonly GateDecisionRow[]> };
  readonly write: { insert(decision: GateDecisionRow): Promise<void> };
};
```

`StoreTransaction.gateDecisions: GateDecisionsGateway`; `forItem` orders by `decided_at`, `id`; `insert` is wrapped in `refusing`.

- Produces, in the kernel:

```ts
export type DecideInput = {
  readonly itemId: string;
  readonly decision: GateDecision;
  readonly reason: string | null;
  readonly findings: readonly string[];
};
export type Decided = { readonly decisionId: string; readonly item: ItemState; readonly advanced: boolean };
export type GateCommands = { decide(caller: Caller, input: DecideInput): Promise<KernelOutcome<Decided>> };
```

`decide`, part one (Task 23 adds the ship rule and the connector):
1. `at = ports.clock.now()`.
2. **An agent principal** (`kind === 'agent'`, whatever its grants, delegated or not): in one transaction, `item_not_found` if the item is absent, else record `gate_refused_to_agent` `{ decision, stage }` on the item and return `refused('gate_refused_to_agent')`. Nothing else is written; no `gate_decisions` row.
3. `override` with a reason that is null or blank → `reason_required`.
4. One transaction: lock the item (`item_not_found`); harness; stages; `not_permitted` unless `allowed(actor, 'admin', harness, at)`; `item_not_at_gate` unless `gateStatus === 'parked'`; a person principal with a null `personId` → `not_permitted`.
5. `grants = ports.grants.lockAndReread(tx, actor.personId, at)` (`SELECT … FOR SHARE` on that person's `role_grants` rows, the same `tx` passed as-is); `locked = { ...actor, grants }`.
6. Approve and override need `approverCovers(locked, harness.jdArea, item.riskDomains, at)`; otherwise record `ship_refused` `{ stage, reasons: ['approver_lacks_domain_grant'] }` and refuse `approver_lacks_domain_grant` (P13). Reject and take over need `allowed(locked, 'admin', harness, at)`; otherwise `not_permitted`.
7. Insert the `gate_decisions` row: id from `ports.ids`, the current stage's id, actor = the person's identity, `decision`, `reason` (null unless override, or a reject's optional reason), evidence `{ findings, gateTarget: item.gateTarget }`, the trace id, `decidedAt: at`.
8. Drafts: approve → `gate_approved` `{ decisionId, stage }`; override → `gate_overridden` `{ decisionId, stage, reason }`; reject → `gate_rejected` `{ decisionId, stage, findings }` (the item returns to `working` in the same stage, unheld, for anyone to claim); take over → `gate_taken_over` `{ decisionId, stage, holder: actor.identity }` (P13: any lease released, the person holds it, no lease).
9. For approve and override when the stage's connector is `none` or the item has a `gateTarget`: append the exit drafts in the same transaction — with a `gateTarget`, `loop_edge_taken` `{ from, to: gateTarget }` (the occasional tweak, now with its recorded human decision); else the forward exit (`stage_advanced` to the next stage, or to `null` from the last). `advanced` is `true`.
10. Approve or override at a stage whose connector is not `none` and with no `gateTarget` is Task 23's path; until then return `refused('not_wired')`.

- [ ] **Step 1: Write the failing scenarios and tests**

`KN-13.agent-cannot-write-decision.ts`: activate software; give Check `exitGate: 'human_approval'` (connector `none`); park an item at Check; for each of these agent principals — owner grants `admin` org, `admin` on `80-89`, `editor` on `80-89`, `viewer` on `80-89`, and the beat principal of a live delegation — `decide` approve is `gate_refused_to_agent`; afterwards `tx.gateDecisions.read.forItem` is empty, the item is still parked at Check, and the item's log holds five `gate_refused_to_agent` events and nothing else after `submitted_to_gate`.

`KN-13.reject-and-take-over.ts`: Ian rejects with findings `['the migration has no down path']`: one `gate_decisions` row (`reject`), `gate_rejected` with the findings, the item `working` in Check with no holder; an agent claims and submits again (parks); Ian takes over: the item is held by Ian, kind `person`, no lease, `working`, and a second row (`take_over`) exists; Ian submits: parked again; Ian approves: `gate_approved`, `stage_advanced` to `ship`, and three rows in all.

`KN-8.occasional-tweak-needs-a-person.ts`: as in Task 18, park an item at Scope with `gateTarget` `package`; an editor's approve is `not_permitted`; Ian's approve records a `gate_decisions` row and `loop_edge_taken` `{ from: 'scope', to: 'package' }`; the item is in `package`, `working`.

`sim/kernel/gate-command.test.ts`:
- deciding on an item that is not parked is `item_not_at_gate`;
- `override` with reason `'  '` is `reason_required` and writes nothing;
- a stale principal: build Kim's principal (area admin), revoke the grant with `revokeSeededGrant`, then Kim's approve (with the stale principal still carrying the grant) is `approver_lacks_domain_grant`, writes `ship_refused` with that reason, and writes no `gate_decisions` row (the sequential half of KN-14);
- a Store contract case: `gateDecisions.write.insert` with an `agent:` actor rejects with a store refusal naming `gate_decisions_actor_is_human`.

Run: `pnpm vitest run sim/kernel/gate-command.test.ts && pnpm sim -- KN-13 && pnpm sim -- KN-8`
Expected: FAIL.

- [ ] **Step 2: Extend the port (shared root, own commit)**: `feat(harness): a gate decisions gateway, insert-only` (body: "gate_decisions is append-only in Postgres; the gateway offers only insert and a read per item." and `KN-13 DX-3`).

- [ ] **Step 3: Implement** the gateway and `gates/decide.ts` with step 2, steps 4 to 6 and steps 7 to 9 each in its own function; add `gates` to the `Kernel`.

- [ ] **Step 4: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness packages/db/store sim
git commit -m "feat(harness): the gate decision command for people only, re-reading the approver's grants under share lock" -m "KN-13 KN-8"
```

### Task 23: Approve at Ship: the ship rule, override, and the connector exit path

**Requirements:** KN-13 (approve at a stage with a connector evaluates the ship rule; override advances despite open review findings, requires a non-empty reason and records it), KN-11 (the rule's inputs assembled from GitHub facts at decision time), GH-6 groundwork (the connector runs only from the stage-exit path after a decision row exists), Review Focus 5.

**Files:**
- Create: `packages/harness/gates/ship-input.ts`, `packages/harness/gates/exit.ts`
- Modify: `packages/harness/gates/decide.ts`
- Create: `sim/scenarios/KN-13.approve-merges-and-advances.ts`, `sim/scenarios/KN-11.ship-rule-refuses-on-facts.ts`, `sim/scenarios/KN-12.high-tier-needs-two-providers-and-domain-grants.ts`, `sim/scenarios/KN-13.override-needs-a-reason.ts`, `sim/kernel/connector-exit.test.ts`

**Interfaces:**
- Produces:

```ts
export function assembleShipInput(input: {
  readonly facts: PullRequestFacts | null;
  readonly item: ItemState;
  readonly area: JdArea;
  readonly approver: Principal;
  readonly at: Date;
  readonly override: boolean;
}): ShipRuleInput;
export function exitThroughConnector(ports: Ports, context: RecordContext, input: {
  readonly item: ItemState;
  readonly stage: Stage;
  readonly next: Stage | null;
  readonly overrideReason: string | null;
}): Promise<boolean>;
```

`assembleShipInput`: `pullRequest` = `{ open: facts.state === 'open', draft: facts.draft, head: facts.head }` or null; `checks` = the facts' checks on `facts.head`; `approvals` = the facts' reviews with state `approved` on `facts.head`, as `{ reviewer, commit, provider }`; `expectedHead`, `riskTier`, `riskDomains` from the item; `at` as `toISOString()`. It is the rule's only caller outside tests (GH-5 later narrows reviewers to Reviewer identities).

`exitThroughConnector` is the only caller of `ports.connectors.run` in the repository. It sends `{ connector: stage.connector, harnessId, itemId, traceId, pullRequest: item.pullRequest, expectedHead: item.expectedHead, message }`, where `message` is the item title, followed by a blank line and `Override: <reason>` when there is an override reason (it travels into the merge commit, GH-6). A rejection with `PortNotWiredError` becomes `{ outcome: 'refused', reason: 'not_wired' }`; any other thrown `Error` becomes `{ outcome: 'refused', reason: 'connector_error: <error.name>' }`; nothing is rethrown. Then, in a new transaction: lock the item; if it is no longer parked in that stage, record nothing and return `false`; on `succeeded` record `connector_succeeded` `{ connector, detail }` and the forward exit (`stage_advanced` to `next`), return `true`; on `refused` record `connector_refused` `{ connector, reason }` and return `false` (the item stays parked; the decision stands).

`decide` gains, for approve or override at a connector stage with no `gateTarget` (replacing step 10 of Task 22):
- before the transaction: read the item in a short transaction; when it has a pull request, `facts = await ports.githubFacts.pullRequest(item.pullRequest)` (a `PortNotWiredError` → `refused('not_wired')`), else `facts = null`. No network call happens inside a Store transaction.
- inside the step-4 transaction, after the gate checks: if the locked item's `pullRequest` or `expectedHead` differ from the pre-read, record `ship_refused` `{ stage, reasons: ['head_mismatch'] }` and refuse `head_mismatch`; otherwise `outcome = shipRule(assembleShipInput({ facts, item, area, approver: caller.actor, at, override: decision === 'override' }))`; a refusal records `ship_refused` `{ stage, reasons }` and returns `refused(reasons[0], { reasons })`.
- then steps 5 to 8 as before (the locked re-read, the row, `gate_approved` or `gate_overridden`), and the transaction commits;
- then `exitThroughConnector`; the outcome is `accepted({ decisionId, item: <as now projected>, advanced })`.

- [ ] **Step 1: Write the failing scenarios and tests**

`KN-13.approve-merges-and-advances.ts` (the software path end to end): enqueue; advance to Build with `simAdvance`; the agent submits at Build and Check with `change` `{ pullRequest: { repo: 'unfoldingWord/uw-platform', number: 42 }, head: 'abc123', paths: ['apps/uw-app/board.tsx'], declaration: { riskTier: 'standard', riskDomains: [] } }`; the editor claims Ship and submits → parked; `world.adapters.githubFacts.given({ ref, state: 'open', draft: false, head: 'abc123', checks: <the six jobs success on abc123>, reviews: [{ reviewer: 'uw-reviewer', commit: 'abc123', state: 'approved', provider: 'anthropic' }], freshAt })`; Ian approves → accepted, `advanced: true`; one `gate_decisions` row; the log has `gate_approved`, `connector_succeeded`, `stage_advanced { from: 'ship', to: 'validate' }`; `world.adapters.connectors.calls()` holds one `merge` call with `expectedHead` `abc123`; then Validate and Close (attach a `suggested` labelled learning first) take the item to `done`.

`KN-11.ship-rule-refuses-on-facts.ts`: the same item parked at Ship with facts whose head is `def456` → `head_mismatch` with `ship_refused` `{ reasons: ['head_mismatch'] }`, no decision row, no connector call, still parked; facts with a draft PR and a failing `test` job → `pr_is_draft` first and `detail.reasons` `['pr_is_draft', 'checks_not_green']`.

`KN-12.high-tier-needs-two-providers-and-domain-grants.ts`: a change touching `packages/db/migrations/0009_x.sql` declared `standard` → tier `high`, domains `['migration']`; with one review → `reviewer_count_below_tier`; with two reviews both `anthropic` → `reviewer_providers_not_distinct`; with `anthropic` and `openai` but approved by Kim (area admin) → `approver_lacks_domain_grant`; by Ian (org admin) → advanced.

`KN-13.override-needs-a-reason.ts`: facts with no review → Ian's approve is `no_reviewer_approval`; override with reason `'Hotfix for the outage on 2026-10-01'` → advanced, `gate_overridden` carries the reason, the decision row carries it, and the connector call's `message` ends with `Override: Hotfix for the outage on 2026-10-01`; override of a `high` item with one reviewer is still `reviewer_count_below_tier` (P12).

`sim/kernel/connector-exit.test.ts`, `describe('KN-13 a connector that refuses or is not wired leaves the decision and the item parked', …)`: with `connectors.refuseNext('merge', 'merge conflict')`, approve is accepted with `advanced: false`, the decision row and `gate_approved` exist, `connector_refused { reason: 'merge conflict' }` is recorded, the item is still parked at Ship; a kernel built with `createKernel({ ...world.adapters, connectors: { run: () => notWiredCall('connectors', 'run') } })` records `connector_refused { reason: 'not_wired' }` the same way and nothing throws.

Run: `pnpm vitest run sim/kernel/connector-exit.test.ts && pnpm sim -- KN-13 && pnpm sim -- KN-11 && pnpm sim -- KN-12`
Expected: FAIL.

- [ ] **Step 2: Implement**; keep `decide.ts` under 500 lines by putting the Ship-only path in its own function in `gates/ship-input.ts` or a new `gates/approve-at-ship.ts`.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness sim
git commit -m "feat(harness): approve at Ship runs the ship rule over GitHub facts, then the connector from the stage-exit path only" -m "KN-13 KN-11 KN-12"
```

### Task 24: The grant re-read race in both orders

**Requirements:** KN-14, DX-6.

**Files:**
- Create: `apps/uw-app/harness/grant-race.pg.test.ts`
- Modify: `apps/uw-app/testing/kernel.ts` (`fixedFacts(facts)`, `pausingGrants(grants, onLocked, pauseMs)`)

**Interfaces:**
- Produces (test helpers):

```ts
export function fixedFacts(facts: PullRequestFacts): GitHubFacts;
export function pausingGrants(grants: Grants, onLocked: () => void, pauseMs: number): Grants;
```

`pausingGrants` delegates `resolve` and `resolveIn` unchanged; its `lockAndReread(tx, personId, at)` awaits the real one with the same `tx` object, then calls `onLocked()`, then waits `pauseMs` before returning, so the share locks are held while the test acts.

- [ ] **Step 1: Write the tests**

```ts
describe.skipIf(!testServer)('KN-14 DX-6 the grant re-read race, in both orders, on two connections', () => {
  it('refuses the decision when the revoke commits first', () =>
    withRace(async ({ decider, revoker, kim, item }) => {
      await revokeGrant(revoker, kim.grantId);
      const outcome = await decider.gates.decide(caller(kim.principal), approve(item));
      expect(outcome).toMatchObject({ status: 'error', reason: 'approver_lacks_domain_grant' });
      expect(await decisionRows(revoker, item)).toHaveLength(0);
    }));

  it('records the decision when it holds the share lock first, and the revoke waits for it', () =>
    withRace(async ({ connections, revoker, kim, item }) => {
      const order: string[] = [];
      let revoking: Promise<void> = Promise.resolve();
      const decider = kernelOn(connections.decider, clock, {
        grants: pausingGrants(platformGrants(connections.decider), () => {
          revoking = revokeGrant(revoker, kim.grantId).then(() => {
            order.push('revoke committed');
          });
        }, 400),
        githubFacts: fixedFacts(greenFacts),
      });
      const outcome = await decider.gates.decide(caller(kim.principal), approve(item));
      order.push('decision returned');
      await revoking;
      expect(outcome.status).toBe('accepted');
      expect(await decisionRows(revoker, item)).toHaveLength(1);
      expect(order).toEqual(['decision returned', 'revoke committed']);
      expect(await grantRevoked(revoker, kim.grantId)).toBe(true);
    }));
});
```

`kernelOn` gains an optional third argument of port overrides. `withRace` creates one migrated database, opens the decider's and the revoker's connections, activates software, parks an item at Ship with `expectedHead` `abc123` and tier `standard` (through the kernel, as in Task 23), seeds Kim as `admin` on `80-89`, mints her principal before anything is revoked, and always closes both connections and drops the database. `revokeGrant` runs `UPDATE role_grants SET revoked_at = $at WHERE id = $id` on the revoker's connection; under the decider's `FOR SHARE` lock it blocks until the decision commits. Add a third assertion inside the second test that the revoke was waiting: poll `pg_stat_activity` on a third connection until a backend with `wait_event_type = 'Lock'` running the `UPDATE role_grants` appears, before the pause ends (fail after 2 s). The connectors port is not wired in this kernel, so the approved item stays parked with `connector_refused { reason: 'not_wired' }`; the decision row is what this test proves.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-app/harness/grant-race.pg.test.ts`
Expected: PASS (tests only; a failure means the share lock or the transaction boundary in `gates/decide.ts` is wrong — fix it there in this task).

- [ ] **Step 2: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS, and both races ran (not skipped).

```bash
git add apps/uw-app/harness/grant-race.pg.test.ts apps/uw-app/testing/kernel.ts
git commit -m "test(uw-app): revoke then decide refuses, decide then revoke records, on two real connections" -m "KN-14 DX-6"
```

### Task 25: The tracker, and step 3 marked built

**Requirements:** DX-5 (`pnpm trace:built` passes with step 3 built), AGENTS.md section 7 step 7.

**Files:**
- Modify: `docs/progress_tracker.md`, `docs/architecture.md` (only where this step changed a fact it states)

- [ ] **Step 1: Check every requirement has its proof**

Run: `pnpm trace` and confirm none of KN-1 to KN-18 is listed as unproven. Grep `sim/scenarios/` and the test titles for each ID; every one of KN-1 to KN-18 has a scenario file or a test title starting with it (KN-9 from step 2's `packages/harness/walk.test.ts`).

- [ ] **Step 2: Update `docs/progress_tracker.md`**

- Status table: step 3 `Built`, evidence `docs/superpowers/plans/2026-10-01-step-03-kernel-and-data.md`; scenarios `sim/scenarios/KN-*.ts`; tests named KN-1 to KN-18; server races `apps/uw-app/harness/*.pg.test.ts`, `packages/db/event-log-order.test.ts`; `pnpm verify` green with `TEST_DATABASE_URL` set.
- A `## Step 3 evidence by requirement` table: each of KN-1 to KN-18 and DX-6, its commits (`git log --oneline` for this step) and its scenario and test files.
- Decisions made during the build (one row each, with why and cost if wrong):

| Requirement | Decision | Cost if wrong |
|---|---|---|
| KN-1 | Kernel tables take every instant and id from the command; no column default on an id or instant, checked by `packages/db/kernel-defaults.test.ts` | A row written outside the kernel must supply them |
| KN-1 | `harness_runs` has no host column: the run shape names the host (`workflow-run` platform, `external-run` external) | A host that is not one-to-one with a run shape needs a migration |
| KN-1 | `harness_items` adds `gate_status` (`working`, `parked`, `checks_failed`, `done`), `gate_target`, `delegation_id`, `pr_repo` beside `pr_number`; `delegations` adds `lapsed_at`, `supersedes`, `trace_id` | Each is a column more than 8.1 listed; recorded in 8.1 |
| KN-1 | Table classifications: harnesses, stages, items, events, personas `internal`/`sync`; runs `internal`/`never`; gate decisions and delegations `restricted`/`never`; measurements `internal`/`cache_readonly` | A device syncing a table it should not |
| KN-3 | Positions are assigned by a BEFORE INSERT trigger under `pg_advisory_xact_lock(hashtextextended('harness_events:' \|\| harness_id, 0))`, so appends to one harness serialize until commit | Throughput on one busy harness; a long transaction delays other appends to it |
| KN-3 | The application role is `uw_app` (NOLOGIN): SELECT and INSERT on `harness_events`; no UPDATE, DELETE or TRUNCATE on `harness_events`, `gate_decisions`, `grant_audit`; full DML elsewhere, by default privileges | The Hyperdrive login must be a member of `uw_app` and must not own the tables, or the grant half of KN-3 is moot (the trigger half still holds) |
| KN-3 | Event evidence is typed per name in `eventEvidenceSchemas`; names with no entry take any JSON object | A later event without a schema is unchecked until one is added |
| KN-4 | Every write of an item goes through `recordItemEvents`, which folds the same events onto the projection in the same transaction; the sim runner compares replay with the projection after every scenario (open question 1) | A writer that bypasses the record module drifts until the runner or the repair routine sees it |
| KN-4 | The repair routine records no event: the log is unchanged, only its projection | An audit of repairs needs the trace log |
| KN-5 | WIP counts items in the stage with a live holder; the count and the claim are serialized by `tx.lock('harness-stage-claims:<stage id>')` | Kanban WIP over every item in a column would need another count |
| KN-5 | A claim on a parked or done item is `not_permitted` with `why`; a stage change between the read and the lock is `not_permitted` `{ why: 'moved' }` | Clients see a generic reason |
| KN-5 | `leaseWarning` is true when the lease the step arrived on had 3 minutes or less left, measured before renewal | A runner that wants the warning after renewal never sees it |
| KN-5 | Advancing or parking an item releases its holder; the next stage is claimed afresh | An agent working several stages in a row claims each |
| KN-5 KN-8 | A non-interactive principal cannot claim without a delegation (`delegation_required`), ahead of AB-6 | None known |
| KN-6 | A `checks_failed` submit is an accepted outcome carrying the failures, as the `submit_to_gate` verb's output defines | Clients must read `result`, not `status` |
| KN-7 | Evidence labels are checked on every attached page that is not a skill, whoever wrote it; a claim is a markdown list line; a labelled claim starts `[observed]`, `[confirmed]`, `[inferred]` or `[assumed]`; a suggested or active learning or skill counts | Stricter than "pages an agent drafts"; a person's unlabelled learning fails Close |
| KN-8 | The occasional tweak parks the item at its stage with `gate_target` set; only a person's gate decision takes the edge | Validate's checks still run first |
| KN-11 | A CI job is green only when every check of that name on the head succeeded | A failed run beside a successful re-run refuses until GH-2's read model keeps the latest |
| KN-5 | `expireLeases` calls no `can()`: it is platform maintenance for the one-minute cron (P8), it only releases leases that have lapsed, and its actor is the platform principal that calls it | A caller could release lapsed leases early only by moving the clock, which the kernel does not let it do |
| KN-13 | Every gate decision (approve, reject, take over, override) re-reads the approver's grants under `FOR SHARE`; approve and override refusals are `ship_refused` events with `approver_lacks_domain_grant` (P13), reject and take over refusals are `not_permitted` with no event | Reject and take-over refusals are absent from the 7-day gate-refusal indicator |
| KN-13 | GitHub facts are read before the decision's transaction and re-checked against the locked item; the connector runs after the decision commits, and its outcome is recorded in a second transaction | A crash between the commit and the connector leaves an approved item parked until retried |
| KN-13 | An item whose connector refused stays parked; approving again writes a second decision row | Two rows for one effective approval |
| KN-16 | A lapse is final; renewal writes a new row naming the old one and revokes the old one | A restored grant does not revive a delegation |
| KN-16 | The beat principal is `agent:<persona>` with at most `editor` on the harness's area, expiring with the earlier of the grant and the delegation; capability `none` gives no grants | Capability words do not yet narrow verbs (AB-6 and PE steps) |
| KN-16 | `Grants.resolveIn(tx, …)` added for the in-transaction, unlocked beat check (P14) | One more port method |
| KN-17 | The PR declaration's contract shape here is `{ riskTier, riskDomains }`; GH parses the full P16 block into it | GH-5 may need more fields: a minor contract bump |
| KN-18 | Stage edits do not run the template property: the Ship invariant is left to Postgres so its refusal is the database's; activation runs it | An edit that bypasses Ship without a connector change is impossible by P10 |
| KN-18 | The stage command and the gate command refuse every agent principal, whatever its grants | An admin's agent cannot edit stages even when asked |
| KN-18 | The connector registry holds `merge` and `publish` in v1; `deploy`, `send`, `post` are refused at write time until GH-7 | A BML harness wanting `send` waits for GH-7 |
| DX-2 | `executorOf` left the `@uw/db/store` barrel; dependency-cruiser rule `store-executor-stays-in-the-store` (open question 2) | None known |
| KN-1 to KN-18 | Property tests live in `tools/properties/` (fast-check), not `sim/`, to keep `sim/` to the imports DX-2 lists | Two places hold kernel tests |

- New dependencies: `2026-10-01 | fast-check | hand-written random generators for the replay, projection, template and ship-rule property tests (root devDependency, tools/properties only)`; `@uw/core` workspace link in `packages/harness` (not a replacement: `can()` for the kernel's checks).
- Not verified: the `uw_app` role and its grants on Neon (only PGlite and the local Postgres 16 ran them); `CREATE ROLE` permission for the migration role on Neon; the event-position lock under production concurrency.
- Waiting on a person: `| 2026-10-01 | KN-3 | migration 0007 creates uw_app and its grants | the Hyperdrive connection's login role made a member of uw_app and not an owner of the tables; confirm the Neon migration role may CREATE ROLE | Ian |`.

- [ ] **Step 3: Verify and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS, including `pnpm trace:built` with step 3 marked Built.

```bash
git add docs/progress_tracker.md docs/architecture.md
git commit -m "docs(tracker): step 3, kernel and data, built: evidence, decisions, what was not verified and what waits on a person" -m "KN-1 KN-2 KN-3 KN-4 KN-5 KN-6 KN-7 KN-8 KN-10 KN-11 KN-12 KN-13 KN-14 KN-15 KN-16 KN-17 KN-18 DX-6"
```
