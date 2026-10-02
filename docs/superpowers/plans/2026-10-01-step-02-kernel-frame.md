# Step 2, Stand Up the Kernel's Frame: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the frame every later step plugs into: the ten ports, `createKernel(ports)`, a platform adapter and a test adapter for every port with one shared contract suite run against each, a Store test adapter that is the same Drizzle code over an embedded Postgres (PGlite) running the real migrations, the sim (`pnpm sim -- <scenario>`, `pnpm sim -- all`), `pnpm walk -- <template>` and `pnpm trace`, all joined to `pnpm verify` and CI.

**Architecture:** `packages/harness` holds the port types (`ports.ts`, a shared root), the kernel (`createKernel`), the pure walker, and one contract suite per port under `port-contracts/`. `packages/db/store/` holds the one Drizzle implementation of the Store and Grants ports; `apps/uw-app/ports/` (platform) and `sim/adapters/` (test) each bind it, so the two run the same queries and a drift fails the typecheck. Ports whose service arrives in a later step get a platform adapter that is explicitly *not wired*: every call rejects with `PortNotWiredError`, and its contract suite proves exactly that. `sim/` is a workspace package: test adapters, a `World` (one embedded Postgres clone, the ten test adapters, the kernel), scenarios named for requirement IDs, and the two CLIs. `tools/trace/` reads the PRD, the tracker, the scenario file names and the test titles.

**Tech Stack:** TypeScript 6 strict, Node 22.18+ running `.ts` directly (type stripping), Vitest 4 (Workers pool and node project), Drizzle ORM 0.45 over `postgres` 3.4 and over `@electric-sql/pglite` 0.5.8 (`drizzle-orm/pglite`, `drizzle-orm/pglite/migrator`), dependency-cruiser, knip, GitHub Actions.

**Spec:** `docs/PRD.md` (approved). Design source: PRD sections 7.10, 9 and 13; `docs/architecture.md` ("The kernel over ports", "The sim", "Every rule is a check"); ADR 0001 (amended 2026-10-01).

**Requirements covered:** DX-1, DX-2, DX-3, DX-4, DX-5, DX-6 (the frame; the KN-5 and KN-14 races land with their tables in step 3), DX-8. KN-9 (`walk(stages)`) is built here, pulled forward from step 3, because `pnpm walk` cannot print a path without it.

**Not in this step:** any harness table (`harness_*`, `gate_decisions`, `delegations`, `measurements`, `personas`), the event vocabulary, `replay`, the ship rule, the two templates (KN-1 to KN-18 are step 3). The frame is shaped so step 3 adds members to `StoreTransaction`, modules to `Kernel` and entries to `templates` without reshaping anything here.

**What this step hands to later steps (keep these names exactly):**

| Interface | Where | Consumed by |
|---|---|---|
| `Ports`, `PortName`, `portNames`, the ten port types and their value types | `packages/harness/ports.ts` | every kernel module; every adapter |
| `StoreTransaction` (`lock(key)`) and `Store` (`transaction`, `appliedMigrations`) | `packages/harness/ports.ts` | step 3 adds gateways as new members of `StoreTransaction` (for example `events`, `items`) |
| `createKernel(ports): Kernel`, `Kernel` (`walk`, `health`), `KernelHealth` | `packages/harness/kernel.ts` | step 3 adds modules as new members of `Kernel` |
| `PortNotWiredError`, `RunTransitionError`, `ToolOutsideToolsetError`, `notWiredCall(port, method)` | `packages/harness/port-errors.ts` | the kernel maps `PortNotWiredError` to the refusal `not_wired` |
| `walk(stages)`, `effectPaths(paths)`, `WalkStage`, `WalkStep`, `WalkPath`, `EffectPath`, `WalkError` | `packages/harness/walk.ts` | KN-10 (property test), KN-18 (activation) |
| `templates`, `Template` | `packages/harness/templates.ts` | KN-15 registers `software` and `bml` here |
| `describe<Port>Contract`, `describe<Port>NotWired` | `packages/harness/port-contracts/<port-kebab>.ts` | every new adapter's contract test |
| `createDrizzleStore`, `createDrizzleGrants`, `executorOf`, `resolveGrants`, `liveGrant`, `toGrant` | `packages/db/store/` (`@uw/db/store`) | step 3 adds its table gateways here |
| `createEmbeddedDatabase`, `closeEmbeddedTemplate`, `EmbeddedDatabase` | `packages/db/embedded.ts` (`@uw/db/embedded`) | the sim; any test that needs embedded Postgres |
| `databaseTargets`, `DatabaseTarget`, `OpenedDatabase` | `packages/db/test-targets.ts` (`@uw/db/test-targets`) | KN-2, KN-3 tests run on both databases (DX-6) |
| `pgErrorCode`, `pgConstraint` | `packages/db/errors.ts` (`@uw/db/errors`) | KN-18 `stage_edit_refused` with the database's reason, on both drivers |
| `seedPerson`, `seedGrant`, `revokeSeededGrant` | `packages/db/test-seed.ts` (`@uw/db/test-seed`) | sim fixtures and tests |
| `createWorld`, `World`, `SimAdapters`, `worldStart`, `defineScenario`, `Scenario`, `ScenarioReport` | `sim/world.ts`, `sim/scenario.ts` | every scenario |
| `platformPorts(database)`, `platformKernel(database)` | `apps/uw-app/kernel.ts` | the command API (WB-1), MCP surface (AB-1), Workflows (HE-1) |

---

## Global Constraints

Every task obeys every line here. The controller passes this section to each implementer.

**Where and how**

- Work only in the worktree `/home/ianjl/projects/uw-platform-v1` on branch `build/v1`. Never commit to `main`, never force-push, never `--no-verify`.
- Read `AGENTS.md` sections 1, 4, 6 and 10 before the first edit. When this plan and `AGENTS.md` disagree, `AGENTS.md` wins; record the conflict in `docs/progress_tracker.md` and build the version that keeps the rule.
- Words come from `CONTEXT.md`: "kernel" (never "engine" for the core), "port", "adapter", "platform adapter", "test adapter", "not wired", "port contract", "sim", "world", "scenario", "walk", "trace", "principal", "grant", "verb", "wake". Never "mock", "fake" or "memory adapter" for the Store test adapter: it is real Postgres.

**Code rules (mechanically enforced by `pnpm verify`)**

- TypeScript `strict`, no `any`, no `@ts-ignore`, no `as unknown as`.
- No code comments of any kind: no line comments, block comments, JSDoc, directive comments or commented-out code. Meaning goes into names, types, tests and `docs/`.
- Files under 500 lines; functions under 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters. These apply to test files: a Vitest `describe` callback counts as a function; hoist assertion logic into top-level helpers and split long `describe` blocks rather than nesting.
- Node runs `sim/**` and `tools/**` `.ts` files directly, and they import `packages/harness`, `packages/contracts` and `packages/db`. So every file in `packages/harness`, `packages/db`, `sim` and `tools` uses erasable syntax only: no `enum`, no `namespace`, no constructor parameter properties (declare class fields and assign them in the constructor). Every relative import names its `.ts` file. JSON is imported with `with { type: 'json' }`.
- Dates: only `formatDate`/`parseDate` and `isoDateSchema` from `packages/core/dates.ts` for calendar dates. Instants are `Date` objects or whole `toISOString()` strings, never sliced. No `toLocale*`, no `Intl.DateTimeFormat`.
- Lookups by a variable key use `Map` or `Object.hasOwn`, so `security/detect-object-injection` stays quiet outside tests.
- Discovery by registry or by directory convention, never a switch on a port, engine, persona or template name.

**Layering (dependency-cruiser and ESLint)**

- `packages/contracts` imports only `zod`. `packages/core` imports `packages/contracts` and `zod`. `packages/db` imports `packages/contracts`, `packages/core`, `drizzle-orm`, `postgres`, `@electric-sql/pglite` and Node built-ins.
- `packages/harness` imports `packages/contracts` (and `packages/core` types) and nothing else: no Drizzle, Workers, network, `process`, `fetch`. The one exception: files under `packages/harness/port-contracts/` may also import `vitest` (Task 3 adds the rule). Harness `package.json` dependencies stay `@uw/*` only (its wiring test enforces this); never add `vitest` there.
- `sim/` imports `packages/harness`, `packages/contracts`, `packages/db`, its own files and the Node built-ins `node:fs`, `node:path`, `node:url`, `node:process`, `node:assert`, `node:assert/strict`, and in tests `node:os` and `node:child_process` and nothing else; its test files may also import `vitest`. Never `drizzle-orm` or `@electric-sql/pglite` directly from `sim/`: go through `@uw/db`.
- `apps/uw-app` is a composition root and may import `packages/harness`. No non-test file in `apps/` imports anything from `packages/harness/port-contracts/` (Vitest must never enter the Worker bundle).
- No vendor SDK anywhere in this step.

**Ports and adapters**

- The ten ports, in this order and with these keys: `clock`, `ids`, `store`, `grants`, `githubFacts`, `connectors`, `modelEngine`, `hub`, `notifier`, `runs`. A port key's file name is its kebab form: `clock`, `ids`, `store`, `grants`, `github-facts`, `connectors`, `model-engine`, `hub`, `notifier`, `runs`.
- Contract suites: `packages/harness/port-contracts/<kebab>.ts`, each exporting `describe<Pascal>Contract` (`describeClockContract`, `describeIdsContract`, `describeStoreContract`, `describeGrantsContract`, `describeGithubFactsContract`, `describeConnectorsContract`, `describeModelEngineContract`, `describeHubContract`, `describeNotifierContract`, `describeRunsContract`) and, for every port except `clock` and `ids`, `describe<Pascal>NotWired`.
- Adapter roots: `apps/uw-app/ports/` (platform adapters) and `sim/adapters/` (test adapters). An adapter file sits directly in its root and is named `<kebab>.ts` or `<kebab>.<variant>.ts` (for example `store.not-wired.ts`). Every adapter file is imported (as `'./<file>.ts'`) by a contract test in the same directory named `*.contract.test.ts` or `*.contract.pg.test.ts`, which also imports `'@uw/harness/port-contracts/<kebab>'`. Nothing but adapters and their tests lives directly in an adapter root.
- A not-wired platform adapter's every method returns `notWiredCall('<port>', '<method>')`.

**Shared roots**

- These are shared roots: `packages/db/schema.ts` (and its migrations), `packages/contracts/`, `packages/harness/ports.ts`, `packages/core/acl.ts`, `infra/`, `.github/workflows/`, `AGENTS.md`, `CONTEXT.md`, `docs/adr/`. A change to one goes in its own commit with no feature code in it, and the commit message names the shared root and why it changed. This step changes `packages/harness/ports.ts` (Task 2), `CONTEXT.md` (Task 2), `AGENTS.md` (Tasks 3 and 13) and `.github/workflows/ci.yml` (Task 12). It changes no schema, migration or contract, so `CONTRACT_VERSION` stays `2.2.0`.

**Dependencies**

- The only new third-party package is `@electric-sql/pglite@^0.5.8` (Apache-2.0, no dependencies, runs in plain Node), in `packages/db` `dependencies` (Task 4). Workspace links added: `@uw/contracts` in `packages/harness` (Task 1); `@uw/harness` in `apps/uw-app` (Task 3); `@uw/harness` (Task 3), `@uw/db` (Task 5) and `@uw/contracts` (Task 11) in `sim`. Add a link in the task that first imports it, never earlier (knip fails on an unused dependency). After any `package.json` change run `pnpm install` and commit `pnpm-lock.yaml` with it.
- Do not export what has no consumer yet; export in the task that consumes it. Exports listed in a package's `package.json` `exports` are entries and count as consumed.

**Tests**

- Write the failing test first, run it, see it fail for the expected reason, then implement.
- Name each `describe` with the requirement IDs it proves first, for example `describe('DX-3 every port has a contract run against every adapter', ...)`. `pnpm trace` (Task 12) counts a requirement as proven by a scenario file `sim/scenarios/<ID>.<slug>.ts` or by a string literal in a `*.test.ts` file that begins with the ID followed by a space. In test fixtures that need requirement-shaped IDs, use the prefix `ZZ-` (never a real prefix), so a fixture cannot prove a real requirement.
- Real Postgres: tests that need a server use `TEST_DATABASE_URL`. Locally it is `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test` (a private local server, Postgres 16, already running). In CI it is the `postgres:16` service container. Server tests are wrapped in `describe.skipIf(!testServer)(...)` with `testServer` from `@uw/db/test-database`; a CI test (FD-6) already fails if they skip in CI. Database-backed tests under `apps/` are named `*.pg.test.ts` (node project); everything else under `apps/` runs in the Workers pool.
- The embedded Postgres is PGlite: Postgres 18.3 compiled to WASM, one connection. An open PGlite instance keeps the Node process alive, so every test file or CLI that opens one closes it: `afterAll(closeEmbeddedTemplate)` in every test file that calls `createEmbeddedDatabase` (directly or through `createWorld`), and `close()` on every database or world it opens.
- No test needs a live account or a secret (PRD DX-8). Never add a binding, a job or a test that fails when a secret is absent. The only environment variables test code, test helpers and the sim may read are `TEST_DATABASE_URL`, `CI` and `PATH` (Task 13 makes this a check).

**Verify and commit**

- At the end of every task run, from the worktree root: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. It must be green, and the database tests must have run, not skipped.
- `pnpm sim -- <x>` may receive a literal `--` from pnpm; every CLI in this step drops every `--` argument before reading its arguments.
- Commits are Conventional Commits. The body names the requirement IDs on its own line, for example `DX-3`. No `Co-Authored-By` line, no attribution footer of any kind. Hooks always run.

---

## Review Focus

Inputs the PRD implies but does not spell out, most likely to bite first. Each has its test in the owning task.

1. **An embedded Postgres left open.** A PGlite instance that is never closed keeps Node alive, so `pnpm sim -- all` would hang CI instead of failing. Expected: every CLI exits on its own and a failing scenario still closes its world. Tests: Task 11 spawns each CLI with a 60-second timeout and asserts its exit code, and asserts `runScenario` closes the world when the scenario throws.
2. **A grant that expires between the database's clock and the kernel's clock.** The sim's clock is not the wall clock, so a liveness check using `now()` in SQL would judge a sim grant by the real date. Expected: the Grants port judges expiry at the instant it is given. Test: Task 6's Grants contract uses `at = 2030-01-01` and a grant expiring `2029-12-31`, which is live by the wall clock and must be absent.
3. **A Postgres refusal reported differently by the two drivers.** postgres.js puts the constraint name on `constraint_name`, PGlite on `constraint`. Expected: `pgConstraint` names `role_grants_area_matches_scope` on both databases, so KN-18's `stage_edit_refused` carries the database's reason in the sim and in production. Test: Task 4 runs the same refusal on both targets.
4. **Stage graphs the walker meets in practice.** A stage that feeds itself, a feeds edge to the next stage, a feeds edge to a key that does not exist, two stages with one key or one position, no stages. Expected: the self-feed path ends at the revisited stage, the duplicate edge yields one path, the dangling and duplicate cases throw `WalkError` naming the stage, no stages yields no paths. Tests: Task 1.
5. **Requirements trace cannot place.** CT-3 is a Must requirement that PRD section 13 lists in no step, and `DX-1 to DX-6 and DX-8` must not include DX-7. Expected: an unplaced Must requirement is always due; ranges expand inclusively and nothing else. Tests: Task 12, on fixtures and on the real PRD.

---

## File map

```
packages/harness/package.json, tsconfig.json, index.ts         Task 1, 2, 11
packages/harness/walk.ts, walk.test.ts                         Task 1 (KN-9)
packages/harness/ports.ts                                      Task 2 (shared root, own commit)
packages/harness/port-errors.ts, kernel.ts (+ tests)           Task 2
CONTEXT.md                                                     Task 2 (shared root, own commit)
packages/harness/port-contracts/not-wired-cases.ts             Task 5
packages/harness/port-contracts/{clock,ids}.ts                 Task 3
packages/harness/port-contracts/store.ts                       Task 5
packages/harness/port-contracts/grants.ts                      Task 6
packages/harness/port-contracts/{github-facts,connectors,model-engine}.ts   Task 7
packages/harness/port-contracts/{hub,notifier,runs}.ts         Task 8
packages/harness/templates.ts                                  Task 11
pnpm-workspace.yaml, knip.json, sim/package.json, sim/tsconfig.json   Task 3
.dependency-cruiser.mjs, tools/architecture/rules.test.ts      Task 3
AGENTS.md                                                      Task 3 (rule 2), Task 13 (cockpit)
apps/uw-app/package.json                                       Task 3
apps/uw-app/ports/*                                            Task 3, 5, 6, 7, 8
sim/adapters/*                                                 Task 3, 5, 6, 7, 8
packages/db/package.json, journal.ts, embedded.ts, any-database.ts, migration-ledger.ts, errors.ts, test-targets.ts, both-targets.test.ts   Task 4
apps/uw-app/http/pg-errors.ts (deleted), acl/grant-commands.ts, pages/store.ts   Task 4, 6
packages/db/store/{index,store}.ts, store.test.ts, store-lock.test.ts   Task 5
packages/db/store/grants.ts, packages/db/test-seed.ts          Task 6
apps/uw-app/acl/grant-store.ts (deleted), auth/principal-middleware.ts   Task 6
docs/exceptions.md                                             Task 6
apps/uw-app/kernel.ts, kernel.test.ts, kernel.pg.test.ts       Task 9
tools/architecture/port-contracts.ts, port-contracts.test.ts   Task 10 (DX-3)
sim/world.ts, sim/scenario.ts, sim/runner/*, sim/cli/*, sim/scenarios/*   Task 11
eslint.config.ts                                               Task 11
tools/trace/*                                                  Task 12
package.json (scripts, verify)                                 Task 11, 12
.github/workflows/ci.yml                                       Task 12 (shared root, own commit)
tools/architecture/no-live-account.test.ts                     Task 13 (DX-8)
docs/architecture.md, docs/progress_tracker.md                 Task 13
```

---

### Task 1: `walk(stages)`, the pure walker

**Proves:** KN-9 (pulled forward from step 3; recorded in Task 13). Prepares DX-5's `pnpm walk`.

**Files:**
- Create: `packages/harness/walk.ts`, `packages/harness/walk.test.ts`, `packages/harness/index.ts`
- Modify: `packages/harness/package.json`, `packages/harness/tsconfig.json`

**Interfaces:**
- Consumes: `Connector`, `ExitGate` types from `@uw/contracts`.
- Produces (exported from `@uw/harness`): `walk(stages: readonly WalkStage[]): WalkPath[]`, `effectPaths(paths: readonly WalkPath[]): EffectPath[]`, `WalkStage`, `WalkStep`, `WalkPath`, `EffectPath`, `WalkError` (fields `stage: string`, `message`).

- [ ] **Step 1: Package wiring**

`packages/harness/package.json` becomes:

```json
{
  "name": "@uw/harness",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.ts"
  },
  "scripts": {
    "check": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@uw/contracts": "workspace:*"
  }
}
```

`packages/harness/tsconfig.json` `compilerOptions` becomes `{ "types": [], "erasableSyntaxOnly": true }`. Run `pnpm install`.

- [ ] **Step 2: Write the failing test** `packages/harness/walk.test.ts`

Write these cases, each a separate `it` inside `describe('KN-9 walk(stages) ...')` blocks of at most 50 lines (split into `describe('KN-9 walk over position order and feeds edges')`, `describe('KN-9 walk refuses a graph it cannot walk')`, `describe('KN-9 effectPaths')`). Use this helper and fixture:

```ts
import { describe, expect, it } from 'vitest';
import { effectPaths, walk, WalkError, type WalkStage } from './index.ts';

function stage(key: string, position: number, extra: Partial<WalkStage> = {}): WalkStage {
  return { key, position, exitGate: 'none', connector: 'none', feeds: [], ...extra };
}

const eightStages: readonly WalkStage[] = Object.freeze([
  stage('package', 10),
  stage('scope', 20),
  stage('plan', 30, { exitGate: 'checks' }),
  stage('build', 40, { exitGate: 'checks' }),
  stage('check', 50, { exitGate: 'checks' }),
  stage('ship', 60, { exitGate: 'human_approval', connector: 'merge' }),
  stage('validate', 70, { feeds: ['package'] }),
  stage('close', 80, { exitGate: 'checks', feeds: ['scope'] }),
]);

function keys(path: readonly { key: string; revisited: boolean }[]): string[] {
  return path.map((step) => (step.revisited ? `${step.key}*` : step.key));
}
```

Cases and exact expectations:

1. Three stages `a`(10), `b`(20, `checks`), `c`(30, `human_approval`, `merge`), no feeds: `walk` returns exactly one path, `[{ key: 'a', exitGate: 'none', connector: 'none', revisited: false }, { key: 'b', exitGate: 'checks', connector: 'none', revisited: false }, { key: 'c', exitGate: 'human_approval', connector: 'merge', revisited: false }]`.
2. The same three stages passed as `[c, a, b]`: same single path (order is by position, not input order).
3. `eightStages`: `walk(eightStages).map(keys)` equals `[['package','scope','plan','build','check','ship','validate','close','scope*'], ['package','scope','plan','build','check','ship','validate','package*']]`. (From `validate` the next stage comes first, then its feeds.)
4. A stage that feeds itself, `[stage('a', 10, { feeds: ['a'] })]`: one path, keys `['a', 'a*']`.
5. A feeds edge to the next stage, `[stage('a', 10, { feeds: ['b'] }), stage('b', 20)]`: one path, keys `['a', 'b']`.
6. `[stage('a', 10, { feeds: ['ghost'] })]` throws a `WalkError` with `stage: 'a'` and message `stage a feeds unknown stage ghost`.
7. `[stage('a', 10), stage('a', 20)]` throws `WalkError` with message `stage a appears twice`; `[stage('a', 10), stage('b', 10)]` throws `WalkError` with message `stages a and b share position 10` (the first argument is the lower key).
8. `walk([])` returns `[]`.
9. `walk(eightStages)` does not throw on the frozen array and `eightStages` is unchanged afterwards (deep-equal to a copy taken before).
10. `effectPaths(walk(eightStages))` returns exactly one `EffectPath` whose `steps.map(keys...)` is `['package','scope','plan','build','check','ship']` (the two walked paths share that prefix and it is deduplicated).
11. `effectPaths` keeps a revisited effect stage: for `[stage('a', 10, { connector: 'post', exitGate: 'human_approval', feeds: ['a'] })]` it returns two effect paths with keys `['a']` and `['a', 'a*']`.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm exec vitest run --project node packages/harness/walk.test.ts`
Expected: FAIL, cannot resolve `./index.ts`.

- [ ] **Step 4: Implement** `packages/harness/walk.ts`

```ts
import type { Connector, ExitGate } from '@uw/contracts';

export type WalkStage = {
  readonly key: string;
  readonly position: number;
  readonly exitGate: ExitGate;
  readonly connector: Connector;
  readonly feeds: readonly string[];
};

export type WalkStep = {
  readonly key: string;
  readonly exitGate: ExitGate;
  readonly connector: Connector;
  readonly revisited: boolean;
};

export type WalkPath = readonly WalkStep[];

export type EffectPath = { readonly steps: readonly WalkStep[] };

export class WalkError extends Error {
  readonly stage: string;

  constructor(stage: string, message: string) {
    super(message);
    this.name = 'WalkError';
    this.stage = stage;
  }
}

function byPosition(a: WalkStage, b: WalkStage): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.key < b.key ? -1 : 1;
}

function assertDistinctPositions(sequence: readonly WalkStage[]): void {
  sequence.forEach((stage, index) => {
    const previous = sequence[index - 1];
    if (previous && previous.position === stage.position) {
      throw new WalkError(
        previous.key,
        `stages ${previous.key} and ${stage.key} share position ${stage.position}`,
      );
    }
  });
}

function indexStages(sequence: readonly WalkStage[]): ReadonlyMap<string, WalkStage> {
  const byKey = new Map<string, WalkStage>();
  for (const stage of sequence) {
    if (byKey.has(stage.key)) throw new WalkError(stage.key, `stage ${stage.key} appears twice`);
    byKey.set(stage.key, stage);
  }
  for (const stage of sequence) {
    const dangling = stage.feeds.find((target) => !byKey.has(target));
    if (dangling !== undefined) {
      throw new WalkError(stage.key, `stage ${stage.key} feeds unknown stage ${dangling}`);
    }
  }
  return byKey;
}

function step(stage: WalkStage, revisited: boolean): WalkStep {
  return { key: stage.key, exitGate: stage.exitGate, connector: stage.connector, revisited };
}

type Graph = {
  readonly sequence: readonly WalkStage[];
  readonly byKey: ReadonlyMap<string, WalkStage>;
};

function successors(graph: Graph, stage: WalkStage): WalkStage[] {
  const next = graph.sequence[graph.sequence.indexOf(stage) + 1];
  const targets = new Set([...(next ? [next.key] : []), ...stage.feeds]);
  return [...targets].flatMap((key) => {
    const found = graph.byKey.get(key);
    return found ? [found] : [];
  });
}

function visit(graph: Graph, stage: WalkStage, trail: WalkPath, found: WalkPath[]): void {
  const here = [...trail, step(stage, false)];
  const next = successors(graph, stage);
  if (next.length === 0) {
    found.push(here);
    return;
  }
  for (const target of next) {
    if (here.some((visited) => visited.key === target.key)) found.push([...here, step(target, true)]);
    else visit(graph, target, here, found);
  }
}

export function walk(stages: readonly WalkStage[]): WalkPath[] {
  const sequence = [...stages].sort(byPosition);
  assertDistinctPositions(sequence);
  const graph: Graph = { sequence, byKey: indexStages(sequence) };
  const first = sequence[0];
  if (!first) return [];
  const found: WalkPath[] = [];
  visit(graph, first, [], found);
  return found;
}

function signature(steps: readonly WalkStep[]): string {
  return steps.map((entry) => `${entry.key}${entry.revisited ? '*' : ''}`).join('>');
}

export function effectPaths(paths: readonly WalkPath[]): EffectPath[] {
  const seen = new Set<string>();
  const found: EffectPath[] = [];
  for (const path of paths) {
    path.forEach((entry, index) => {
      if (entry.connector === 'none') return;
      const steps = path.slice(0, index + 1);
      if (seen.has(signature(steps))) return;
      seen.add(signature(steps));
      found.push({ steps });
    });
  }
  return found;
}
```

`packages/harness/index.ts`:

```ts
export { effectPaths, walk, WalkError } from './walk.ts';
export type { EffectPath, WalkPath, WalkStage, WalkStep } from './walk.ts';
```

Note the duplicate-key check runs after sorting, so `[stage('a', 10), stage('a', 20)]` reaches `indexStages` (distinct positions) and throws `stage a appears twice`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run --project node packages/harness/walk.test.ts packages/harness/wiring.test.ts tools/architecture/harness-tsconfig.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add packages/harness pnpm-lock.yaml
git commit -m "feat(harness): walk(stages) enumerates every path and cuts a cycle at the first revisit" -m "KN-9
DX-5"
```

---

### Task 2: The ten ports and `createKernel(ports)`

**Proves:** DX-1 (the kernel half: one `createKernel(ports)` in `packages/harness`, reaching the world only through ports).

**Files:**
- Modify: `CONTEXT.md` (own commit, shared root)
- Create: `packages/harness/ports.ts` (own commit, shared root)
- Create: `packages/harness/port-errors.ts`, `packages/harness/kernel.ts`, `packages/harness/ports.test.ts`, `packages/harness/port-errors.test.ts`, `packages/harness/kernel.test.ts`
- Modify: `packages/harness/index.ts`

**Interfaces:**
- Consumes: `walk`, `WalkStage`, `WalkPath` (Task 1); from `@uw/contracts` the types `Connector`, `CostBasis`, `Engine`, `Grant`, `RunShape`, `VerbName`.
- Produces: everything in `ports.ts` below; `PortNotWiredError(port, method)`, `RunTransitionError(runId, from, action)`, `ToolOutsideToolsetError(verb)`, `notWiredCall(port, method): Promise<never>`; `createKernel(ports: Ports): Kernel`, `Kernel = { walk, health }`, `KernelHealth = { now: Date; appliedMigrations: readonly number[] }`.

- [ ] **Step 1: The words, in their own commit**

Append to `CONTEXT.md`, in the section "How work runs", directly after the **Port** entry:

```markdown
**Adapter**:
One implementation of a port. A **platform adapter** lives in `apps/uw-app/ports/` and reaches the real service; a **test adapter** lives in `sim/adapters/` and is scripted or records what it was asked. The Store and Grants adapters bind the one Drizzle implementation in `packages/db/store/`, so both run the same queries. An adapter whose service is built in a later step is **not wired**: every call rejects with `PortNotWiredError`, which the kernel reports as the refusal `not_wired`.
_Avoid_: driver, implementation, mock, fake, stub (say "not wired")

**Port contract**:
The one shared test suite for a port, in `packages/harness/port-contracts/`, run against every adapter of that port, so a platform adapter and a test adapter cannot drift.
_Avoid_: interface test, integration test

**Sim**:
The kernel on test adapters, run in Node: `sim/`. `pnpm sim -- <scenario>` runs one scenario and prints its event log and folded state.
_Avoid_: simulator, harness (that is the pipeline), test bed

**World**:
What a scenario runs in: one embedded Postgres with the real migrations, the ten test adapters, one clock, and the kernel built over them. Built by `createWorld()`.
_Avoid_: fixture (that is data), context, environment

**Scenario**:
A file in `sim/scenarios/` named `<requirement ID>.<slug>.ts` that drives a world and asserts on the event log and the folded state.
_Avoid_: test (tests sit at module interfaces), story, script

**Walk**:
Every path through a template's stages from Package along position order and every feeds edge, cut at the first revisited stage. `pnpm walk -- <template>` prints every path to an external effect and the gate each crosses.
_Avoid_: traversal, crawl

**Trace**:
The check that every Must requirement not marked Built has a scenario or a test named for it. `pnpm trace` lists every unproven one; `pnpm trace:built` fails only on those whose build-order step the progress tracker marks Built.
_Avoid_: coverage (that is lines of code), audit
```

```bash
git add CONTEXT.md
git commit -m "docs(context): words for adapter, not wired, port contract, sim, world, scenario, walk and trace" -m "Shared root: CONTEXT.md. Step 2 introduces these names in code; AGENTS.md rule 1 puts a new word here first.

DX-1 DX-3 DX-4 DX-5"
```

- [ ] **Step 2: Write the failing tests**

`packages/harness/ports.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { portNames } from './index.ts';

describe('DX-1 the ports are the ten PRD section 9 names', () => {
  it('lists them in order', () => {
    expect(portNames).toEqual([
      'clock',
      'ids',
      'store',
      'grants',
      'githubFacts',
      'connectors',
      'modelEngine',
      'hub',
      'notifier',
      'runs',
    ]);
  });
});
```

`packages/harness/port-errors.test.ts` (`describe('DX-1 port errors')`): `notWiredCall('hub', 'wake')` rejects with an error that `toBeInstanceOf(PortNotWiredError)` and `toMatchObject({ name: 'PortNotWiredError', port: 'hub', method: 'wake', message: 'hub.wake is not wired' })`; `new RunTransitionError('r1', 'stopped', 'resume')` has `message` `cannot resume run r1 from stopped`, and with `from` `null` and action `hibernate` the message is `cannot hibernate run r1 from nothing`; `new ToolOutsideToolsetError('write_page')` has `verb: 'write_page'` and message `the turn called write_page, which is outside the offered toolset`.

`packages/harness/kernel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createKernel, notWiredCall, type Ports } from './index.ts';

const now = new Date('2026-10-01T09:00:00.000Z');

function notWiredPorts(): Ports {
  return {
    clock: { now: () => new Date(now) },
    ids: { next: () => 'c1000000-0000-4000-8000-000000000001' },
    store: {
      transaction: () => notWiredCall('store', 'transaction'),
      appliedMigrations: () => notWiredCall('store', 'appliedMigrations'),
    },
    grants: {
      resolve: () => notWiredCall('grants', 'resolve'),
      lockAndReread: () => notWiredCall('grants', 'lockAndReread'),
    },
    githubFacts: { pullRequest: () => notWiredCall('githubFacts', 'pullRequest') },
    connectors: { run: () => notWiredCall('connectors', 'run') },
    modelEngine: { turn: () => notWiredCall('modelEngine', 'turn') },
    hub: { wake: () => notWiredCall('hub', 'wake') },
    notifier: { notify: () => notWiredCall('notifier', 'notify') },
    runs: {
      start: () => notWiredCall('runs', 'start'),
      hibernate: () => notWiredCall('runs', 'hibernate'),
      resume: () => notWiredCall('runs', 'resume'),
      stop: () => notWiredCall('runs', 'stop'),
      status: () => notWiredCall('runs', 'status'),
    },
  };
}

describe('DX-1 createKernel(ports)', () => {
  it('builds over ten ports without calling one, and walks as the pure walker does', () => {
    expect(createKernel(notWiredPorts()).walk([])).toEqual([]);
  });

  it('reads health from the clock and the store', async () => {
    const ports = { ...notWiredPorts(), store: { ...notWiredPorts().store, appliedMigrations: async () => [1, 2] } };
    expect(await createKernel(ports).health()).toEqual({ now, appliedMigrations: [1, 2] });
  });

  it('reports a store that is not wired as PortNotWiredError', async () => {
    await expect(createKernel(notWiredPorts()).health()).rejects.toMatchObject({
      name: 'PortNotWiredError',
      port: 'store',
      method: 'appliedMigrations',
    });
  });
});
```

Run: `pnpm exec vitest run --project node packages/harness` → FAIL (`portNames`, `createKernel` not exported).

- [ ] **Step 3: The ports, in their own commit** `packages/harness/ports.ts`

```ts
import type { Connector, CostBasis, Engine, Grant, RunShape, VerbName } from '@uw/contracts';

export type Clock = { now(): Date };

export type Ids = { next(): string };

export type StoreTransaction = { lock(key: string): Promise<void> };

export type Store = {
  transaction<T>(work: (tx: StoreTransaction) => Promise<T>): Promise<T>;
  appliedMigrations(): Promise<readonly number[]>;
};

export type Grants = {
  resolve(personId: string, at: Date): Promise<readonly Grant[]>;
  lockAndReread(tx: StoreTransaction, personId: string, at: Date): Promise<readonly Grant[]>;
};

export type PullRequestRef = { readonly repo: string; readonly number: number };
export type PullRequestState = 'open' | 'closed' | 'merged';
export type CheckConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'stale';
export type CheckFact = {
  readonly name: string;
  readonly headSha: string;
  readonly conclusion: CheckConclusion | null;
};
export type ReviewState = 'approved' | 'changes_requested' | 'commented' | 'dismissed';
export type ReviewFact = {
  readonly reviewer: string;
  readonly commit: string;
  readonly state: ReviewState;
  readonly provider: string | null;
};
export type PullRequestFacts = {
  readonly ref: PullRequestRef;
  readonly state: PullRequestState;
  readonly draft: boolean;
  readonly head: string;
  readonly checks: readonly CheckFact[];
  readonly reviews: readonly ReviewFact[];
  readonly freshAt: Date;
};
export type GitHubFacts = { pullRequest(ref: PullRequestRef): Promise<PullRequestFacts | null> };

export type EffectConnector = Exclude<Connector, 'none'>;
export type ConnectorRequest = {
  readonly connector: EffectConnector;
  readonly harnessId: string;
  readonly itemId: string;
  readonly traceId: string;
  readonly pullRequest: PullRequestRef | null;
  readonly expectedHead: string | null;
  readonly message: string;
};
export type ConnectorOutcome =
  | { readonly outcome: 'succeeded'; readonly detail: Readonly<Record<string, string>> }
  | { readonly outcome: 'refused'; readonly reason: string };
export type Connectors = { run(request: ConnectorRequest): Promise<ConnectorOutcome> };

export type ToolCall = { readonly callId: string; readonly verb: VerbName; readonly input: unknown };
export type TurnMessage =
  | { readonly role: 'user' | 'assistant'; readonly text: string }
  | {
      readonly role: 'tool';
      readonly callId: string;
      readonly verb: VerbName;
      readonly output: unknown;
    };
export type TurnUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMinor: number | null;
  readonly costBasis: CostBasis;
};
export type TurnRequest = {
  readonly engine: Engine;
  readonly model: string;
  readonly persona: string;
  readonly instructions: string;
  readonly tools: readonly VerbName[];
  readonly messages: readonly TurnMessage[];
  readonly traceId: string;
};
export type TurnResult = {
  readonly toolCalls: readonly ToolCall[];
  readonly text: string | null;
  readonly usage: TurnUsage;
  readonly resolvedProvider: string | null;
  readonly resolvedModel: string;
};
export type ModelEngine = { turn(request: TurnRequest): Promise<TurnResult> };

export type Hub = { wake(harnessId: string): Promise<void> };

export type WakeReason = 'gate_waiting' | 'delegation_lapsed' | 'run_failed' | 'stage_advanced';
export type Wake = {
  readonly personId: string;
  readonly harnessId: string;
  readonly itemId: string | null;
  readonly reason: WakeReason;
  readonly link: string;
  readonly traceId: string;
};
export type NotifyOutcome = 'sent' | 'dropped';
export type Notifier = { notify(wake: Wake): Promise<NotifyOutcome> };

export type RunState = 'running' | 'hibernated' | 'stopped';
export type RunAction = 'start' | 'hibernate' | 'resume' | 'stop';
export type RunStart = {
  readonly runId: string;
  readonly harnessId: string;
  readonly itemId: string;
  readonly persona: string;
  readonly runShape: RunShape;
  readonly engine: Engine;
  readonly traceId: string;
};
export type Runs = {
  start(run: RunStart): Promise<void>;
  hibernate(runId: string): Promise<void>;
  resume(runId: string): Promise<void>;
  stop(runId: string): Promise<void>;
  status(runId: string): Promise<RunState | null>;
};

export type Ports = {
  readonly clock: Clock;
  readonly ids: Ids;
  readonly store: Store;
  readonly grants: Grants;
  readonly githubFacts: GitHubFacts;
  readonly connectors: Connectors;
  readonly modelEngine: ModelEngine;
  readonly hub: Hub;
  readonly notifier: Notifier;
  readonly runs: Runs;
};

export type PortName = keyof Ports;

const portKeys: Readonly<Record<PortName, true>> = {
  clock: true,
  ids: true,
  store: true,
  grants: true,
  githubFacts: true,
  connectors: true,
  modelEngine: true,
  hub: true,
  notifier: true,
  runs: true,
};

export const portNames = Object.keys(portKeys) as readonly PortName[];
```

The `Record<PortName, true>` makes adding a port to `Ports` without listing it here a type error.

Add to `packages/harness/index.ts`: `export { portNames } from './ports.ts';` and `export type * from './ports.ts';`.

```bash
git add packages/harness/ports.ts packages/harness/index.ts
git commit -m "feat(harness): the ten ports, as types, in packages/harness/ports.ts" -m "Shared root: packages/harness/ports.ts. PRD section 9 names the ports; this is the one place their shapes live. Store carries only a transaction with an advisory lock and the applied migrations: step 3 adds a gateway per kernel table as a new member of StoreTransaction. Grants judges expiry at an instant the kernel passes, never by the database clock. WakeReason lives here until NT-2 publishes the wake payload as a contract.

DX-1"
```

- [ ] **Step 4: Implement the errors and the kernel**

`packages/harness/port-errors.ts`:

```ts
import type { PortName, RunAction, RunState } from './ports.ts';

export class PortNotWiredError extends Error {
  readonly port: PortName;
  readonly method: string;

  constructor(port: PortName, method: string) {
    super(`${port}.${method} is not wired`);
    this.name = 'PortNotWiredError';
    this.port = port;
    this.method = method;
  }
}

export class RunTransitionError extends Error {
  readonly runId: string;
  readonly from: RunState | null;
  readonly action: RunAction;

  constructor(runId: string, from: RunState | null, action: RunAction) {
    super(`cannot ${action} run ${runId} from ${from ?? 'nothing'}`);
    this.name = 'RunTransitionError';
    this.runId = runId;
    this.from = from;
    this.action = action;
  }
}

export class ToolOutsideToolsetError extends Error {
  readonly verb: string;

  constructor(verb: string) {
    super(`the turn called ${verb}, which is outside the offered toolset`);
    this.name = 'ToolOutsideToolsetError';
    this.verb = verb;
  }
}

export function notWiredCall(port: PortName, method: string): Promise<never> {
  return Promise.reject(new PortNotWiredError(port, method));
}
```

`packages/harness/kernel.ts`:

```ts
import type { Ports } from './ports.ts';
import { walk, type WalkPath, type WalkStage } from './walk.ts';

export type KernelHealth = { readonly now: Date; readonly appliedMigrations: readonly number[] };

export type Kernel = {
  readonly walk: (stages: readonly WalkStage[]) => WalkPath[];
  readonly health: () => Promise<KernelHealth>;
};

export function createKernel(ports: Ports): Kernel {
  return {
    walk,
    health: async () => ({
      now: ports.clock.now(),
      appliedMigrations: await ports.store.appliedMigrations(),
    }),
  };
}
```

Add to `index.ts`: `export { createKernel } from './kernel.ts'; export type { Kernel, KernelHealth } from './kernel.ts'; export { notWiredCall, PortNotWiredError, RunTransitionError, ToolOutsideToolsetError } from './port-errors.ts';`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run --project node packages/harness tools/architecture`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add packages/harness
git commit -m "feat(harness): createKernel(ports) with health over the clock and the store, and the port errors" -m "DX-1"
```

---

### Task 3: The sim workspace, the layering rules, and the Clock and Ids ports end to end

**Proves:** DX-3 for `clock` and `ids` (a contract suite run against the platform adapter and the test adapter of each); the layering half of DX-2 and DX-4 (`sim/` imports only what it may).

**Files:**
- Modify: `AGENTS.md` (own commit, shared root)
- Modify: `pnpm-workspace.yaml`, `knip.json`, `.dependency-cruiser.mjs`, `tools/architecture/rules.test.ts`, `apps/uw-app/package.json`, `packages/harness/package.json`
- Create: `sim/package.json`, `sim/tsconfig.json`
- Create: `packages/harness/port-contracts/clock.ts`, `packages/harness/port-contracts/ids.ts`
- Create: `apps/uw-app/ports/clock.ts`, `apps/uw-app/ports/ids.ts`, `apps/uw-app/ports/clock.contract.test.ts`, `apps/uw-app/ports/ids.contract.test.ts`
- Create: `sim/adapters/clock.ts`, `sim/adapters/ids.ts`, `sim/adapters/clock.contract.test.ts`, `sim/adapters/ids.contract.test.ts`, `sim/adapters/clock-and-ids.test.ts`

**Interfaces:**
- Consumes: `Clock`, `Ids` (Task 2).
- Produces: `describeClockContract(adapter: string, make: () => Clock): void`, `describeIdsContract(adapter: string, make: () => Ids): void`; `systemClock: Clock`, `randomIds: Ids` (`apps/uw-app/ports/`); `createSimClock(start: Date): SimClock` with `SimClock = Clock & { set(at: Date): void; advance(milliseconds: number): void }`; `createSimIds(): SimIds` with `SimIds = Ids & { issued(): number }`.

- [ ] **Step 1: The rule text, in its own commit**

In `AGENTS.md` section 4, Rule 1, replace the "New port" line with:

```markdown
- New port: `packages/harness/ports.ts`, then the platform adapter in `apps/uw-app/ports/`, the test adapter in `sim/adapters/` and the port's contract suite in `packages/harness/port-contracts/` with a contract test beside each adapter, together, never one without the others. A port whose service is built in a later step gets a platform adapter that is not wired, and its contract test proves that.
```

In Rule 2, replace the bullet that ends "nothing outside `apps/uw-app` and `sim/adapters` implements one." with:

```markdown
- Application code reaches Postgres, GitHub, a model, the hub or a notifier only through a port; nothing outside `apps/uw-app`, `sim/adapters` and `packages/db/store` implements one. `packages/db/store` holds the one Drizzle implementation of the Store and Grants ports, which the platform adapter and the sim's test adapter both bind, because both must run the same queries (PRD DX-2).
```

and replace the bullet that begins "`sim/*` imports" with:

```markdown
- `sim/*` imports `packages/harness`, `packages/contracts`, `packages/db` and Node built-ins, its tests also Vitest, and nothing else. It imports `packages/db` because the Store test adapter runs the real migrations on an embedded Postgres (PRD DX-2), and never imports Drizzle or PGlite itself.
- A port's contract suite lives in `packages/harness/port-contracts/`; those files are the only non-test harness code that imports Vitest, and no non-test file in `apps/` imports them.
```

```bash
git add AGENTS.md
git commit -m "docs(agents): where adapters and port contracts live, and the one Drizzle Store shared by both adapters" -m "Shared root: AGENTS.md. PRD DX-2 requires the sim's Store to be the same Drizzle adapter as the platform's, and sim may not import apps nor apps sim, so the one implementation lives in packages/db/store. Rejected: a permanent exceptions.md entry for a rule the design requires.

DX-2 DX-3"
```

- [ ] **Step 2: Write the failing layering tests** in `tools/architecture/rules.test.ts`

Add to the `refusals` table:

```ts
  [
    'sim into an npm package',
    'sim/a.ts',
    "import 'zod';",
    'sim-imports-harness-contracts-db-and-node-only',
  ],
  [
    'sim into Drizzle',
    'sim/a.ts',
    "import 'drizzle-orm';",
    'sim-imports-harness-contracts-db-and-node-only',
  ],
  [
    'a port contract into a root dependency',
    'packages/harness/port-contracts/a.ts',
    "import 'eslint';",
    'harness-port-contracts-import-the-harness-and-vitest-only',
  ],
  [
    'a non-test app file into a port contract',
    'apps/uw-app/a.ts',
    "import '../../packages/harness/port-contracts/b.ts';",
    'port-contracts-only-in-tests',
  ],
```

and to `describe('the dependency rules allow', ...)`:

```ts
  it('a port contract on Vitest and the ports', async () => {
    expect(
      await violations({
        'packages/harness/index.ts': leaf,
        'packages/harness/port-contracts/a.ts': "import 'vitest'; import '../index.ts';",
      }),
    ).toEqual([]);
  });

  it('the sim on Node built-ins, and a sim test on Vitest', async () => {
    expect(
      await violations({
        'sim/a.ts': "import 'node:fs'; import 'node:path'; import 'node:url'; import 'node:assert/strict';",
        'sim/a.test.ts': "import 'vitest'; import './a.ts';",
      }),
    ).toEqual([]);
  });
```

Add `'packages/harness/port-contracts/b.ts': leaf` to the files every refusal case is planted with. Run `pnpm exec vitest run --project node tools/architecture/rules.test.ts` → the new cases FAIL (no such rules).

- [ ] **Step 3: The rules** in `.dependency-cruiser.mjs`

Add near the top: `const simMayImport = ['^sim/', '^packages/(harness|contracts|db)/', '^(node:)?(fs|path|url|process|os|assert|assert/strict|child_process)$'];` and `const portContracts = '^packages/harness/port-contracts/';`.

Change `harness-imports-contracts-and-core-only` so its `from` is `{ path: '^packages/harness/', pathNot: [testFile, portContracts] }`, and add:

```js
    {
      name: 'harness-port-contracts-import-the-harness-and-vitest-only',
      comment: 'A port contract suite imports what the harness may, plus Vitest.',
      severity: 'error',
      from: { path: portContracts },
      to: { pathNot: [harnessMayImport, npm('vitest')] },
    },
    {
      name: 'port-contracts-only-in-tests',
      comment: 'Only test files import a port contract suite, so Vitest never enters a Worker bundle.',
      severity: 'error',
      from: { path: '^(apps|sim)/', pathNot: testFile },
      to: { path: portContracts },
    },
    {
      name: 'sim-imports-harness-contracts-db-and-node-only',
      comment: 'sim imports packages/harness, packages/contracts, packages/db, its own files and Node built-ins; its tests also Vitest.',
      severity: 'error',
      from: { path: '^sim/' },
      to: { pathNot: [...simMayImport, npm('vitest')] },
    },
```

and a matching non-test restriction: in the same rule set add

```js
    {
      name: 'sim-non-test-files-never-import-vitest',
      comment: 'Only sim tests import Vitest.',
      severity: 'error',
      from: { path: '^sim/', pathNot: testFile },
      to: { path: npm('vitest') },
    },
```

Keep the existing `sim-imports-harness-contracts-and-db-only` rule (it still refuses `apps` and `packages/core|ui`). Run the rules test → PASS.

- [ ] **Step 4: The sim workspace**

`pnpm-workspace.yaml` `packages:` gains `- sim`. `sim/package.json`:

```json
{
  "name": "@uw/sim",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "check": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@uw/harness": "workspace:*"
  }
}
```

`sim/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node"], "erasableSyntaxOnly": true },
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

`knip.json` `workspaces` gains `"sim": { "entry": ["cli/*.ts", "scenarios/*.ts", "**/*.test.ts"], "project": ["**/*.ts"] }`. `packages/harness/package.json` `exports` gains `"./port-contracts/*": "./port-contracts/*.ts"`. `apps/uw-app/package.json` `dependencies` gains `"@uw/harness": "workspace:*"`. Run `pnpm install`.

If knip reports `vitest` as an unlisted dependency of `packages/harness` (the port contracts import it), add `"ignoreDependencies": ["vitest"]` to the `packages/*` workspace in `knip.json`; never add `vitest` to the harness `package.json` (its wiring test allows `@uw/*` only).

- [ ] **Step 5: Write the failing tests**

`packages/harness/port-contracts/clock.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Clock } from '../ports.ts';

export function describeClockContract(adapter: string, make: () => Clock): void {
  describe(`clock port contract on ${adapter}`, () => {
    it('reads a valid instant', () => {
      expect(Number.isNaN(make().now().getTime())).toBe(false);
    });

    it('never goes backwards between two reads', () => {
      const clock = make();
      const first = clock.now().getTime();
      expect(clock.now().getTime()).toBeGreaterThanOrEqual(first);
    });

    it('hands out a fresh Date each read, so a caller cannot move it', () => {
      const clock = make();
      const read = clock.now();
      const before = read.getTime();
      read.setTime(0);
      expect(clock.now().getTime()).toBeGreaterThanOrEqual(before);
    });
  });
}
```

`packages/harness/port-contracts/ids.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Ids } from '../ports.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function describeIdsContract(adapter: string, make: () => Ids): void {
  describe(`ids port contract on ${adapter}`, () => {
    it('issues UUIDs', () => {
      expect(make().next()).toMatch(uuid);
    });

    it('never issues the same id twice', () => {
      const ids = make();
      const issued = Array.from({ length: 1000 }, () => ids.next());
      expect(new Set(issued).size).toBe(1000);
    });
  });
}
```

Contract tests (one line of wiring each):

- `apps/uw-app/ports/clock.contract.test.ts`: `import { describeClockContract } from '@uw/harness/port-contracts/clock'; import { systemClock } from './clock.ts'; describeClockContract('the system clock', () => systemClock);`
- `apps/uw-app/ports/ids.contract.test.ts`: the same with `describeIdsContract('crypto.randomUUID', () => randomIds)` importing `./ids.ts`.
- `sim/adapters/clock.contract.test.ts`: `describeClockContract('the sim clock', () => createSimClock(new Date('2026-10-01T09:00:00.000Z')));` importing `./clock.ts`.
- `sim/adapters/ids.contract.test.ts`: `describeIdsContract('the sequential sim ids', () => createSimIds());` importing `./ids.ts`.

`sim/adapters/clock-and-ids.test.ts` (`describe('DX-4 the sim clock and ids')`):
- `createSimClock(new Date('2026-10-01T09:00:00.000Z'))`: `now()` is that instant; after `advance(900000)` it is `2026-10-01T09:15:00.000Z`; `set(new Date('2026-10-02T00:00:00.000Z'))` moves it there; `set` to an earlier instant throws `RangeError` with message `the sim clock never goes backwards`; `advance(-1)` and `advance(Number.NaN)` throw `RangeError` with message `advance by a non-negative number of milliseconds`.
- `createSimIds()`: the first two ids are `00000000-0000-4000-a000-000000000001` and `00000000-0000-4000-a000-000000000002`; a second `createSimIds()` starts again at `...0001`; `issued()` counts. (The `a000` group keeps sim ids clear of the bootstrap migration's `...-8000-...` ids.)

Run: `pnpm exec vitest run --project node sim` → FAIL (adapters missing).

- [ ] **Step 6: Implement the adapters**

`apps/uw-app/ports/clock.ts`: `import type { Clock } from '@uw/harness'; export const systemClock: Clock = { now: () => new Date() };`

`apps/uw-app/ports/ids.ts`: `import type { Ids } from '@uw/harness'; export const randomIds: Ids = { next: () => crypto.randomUUID() };`

`sim/adapters/clock.ts`:

```ts
import type { Clock } from '@uw/harness';

export type SimClock = Clock & { set(at: Date): void; advance(milliseconds: number): void };

export function createSimClock(start: Date): SimClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    set: (at) => {
      if (at.getTime() < current) throw new RangeError('the sim clock never goes backwards');
      current = at.getTime();
    },
    advance: (milliseconds) => {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) {
        throw new RangeError('advance by a non-negative number of milliseconds');
      }
      current += milliseconds;
    },
  };
}
```

`sim/adapters/ids.ts`:

```ts
import type { Ids } from '@uw/harness';

export type SimIds = Ids & { issued(): number };

export function createSimIds(): SimIds {
  let count = 0;
  return {
    next: () => {
      count += 1;
      return `00000000-0000-4000-a000-${count.toString(16).padStart(12, '0')}`;
    },
    issued: () => count,
  };
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm exec vitest run --project node sim tools/architecture && pnpm exec vitest run --project workers apps/uw-app/ports`
Expected: PASS. Then `pnpm architecture` → no violations (the real repo obeys the new rules).

- [ ] **Step 8: Verify and commit**

Run `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml knip.json .dependency-cruiser.mjs tools/architecture/rules.test.ts sim apps/uw-app/package.json apps/uw-app/ports packages/harness
git commit -m "feat(sim): the sim workspace, and the clock and ids ports with a contract run against both adapters" -m "dependency-cruiser now holds sim to the harness, contracts, db and Node built-ins, lets only port contracts import Vitest outside tests, and keeps port contracts out of non-test app code.

DX-3 DX-4"
```

---

### Task 4: The embedded Postgres and the two database targets

**Proves:** DX-2 (an embedded Postgres in plain Node running the real migrations from `packages/db`), DX-6 (the constraint and trigger checks run on the embedded Postgres and on the server, with one helper later tests reuse).

**Files:**
- Modify: `packages/db/package.json`
- Create: `packages/db/journal.ts`, `packages/db/embedded.ts`, `packages/db/any-database.ts`, `packages/db/migration-ledger.ts`, `packages/db/errors.ts`, `packages/db/test-targets.ts`, `packages/db/both-targets.test.ts`
- Delete: `apps/uw-app/http/pg-errors.ts` (moved to `packages/db/errors.ts`; grep shows its only importers are `apps/uw-app/acl/grant-commands.ts` and `apps/uw-app/pages/store.ts`)
- Modify: `apps/uw-app/acl/grant-commands.ts`, `apps/uw-app/pages/store.ts` (import path only)

**Interfaces:**
- Consumes: `schema.ts`, `migrationsFolder` (`packages/db/migrate.ts`), `createClient`, `createMigratedDatabase`, `testServer`.
- Produces: `migrationTimestamps: readonly number[]` (`@uw/db/journal`); `createEmbeddedDatabase(): Promise<EmbeddedDatabase>`, `closeEmbeddedTemplate(): Promise<void>`, `EmbeddedDatabase = { db: PgliteDatabase<typeof schema>; close(): Promise<void> }` (`@uw/db/embedded`); `AnyDatabase`, `AnyTransaction`, `AnyExecutor` (`packages/db/any-database.ts`); `appliedMigrations(db: AnyDatabase): Promise<number[]>`; `pgErrorCode(error)`, `pgConstraint(error)` (`@uw/db/errors`); `databaseTargets`, `DatabaseTarget`, `OpenedDatabase` (`@uw/db/test-targets`).

- [ ] **Step 1: Dependency and exports**

In `packages/db/package.json` add `"@electric-sql/pglite": "^0.5.8"` to `dependencies`, and to `exports`: `"./embedded": "./embedded.ts"`, `"./errors": "./errors.ts"`, `"./journal": "./journal.ts"`, `"./test-targets": "./test-targets.ts"`. Run `pnpm install`.

- [ ] **Step 2: Write the failing test** `packages/db/both-targets.test.ts`

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate, createEmbeddedDatabase } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { migrationTimestamps } from './journal.ts';
import { appliedMigrations } from './migration-ledger.ts';
import { grantAudit, people, roleGrants } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

const bootstrapPerson = '00000000-0000-4000-8000-000000000001';

afterAll(closeEmbeddedTemplate);

async function refusal(work: PromiseLike<unknown>): Promise<{ code: string | null; constraint: string | null }> {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

function badArea(opened: OpenedDatabase) {
  return opened.db.insert(roleGrants).values({
    personId: bootstrapPerson,
    role: 'admin',
    scopeKind: 'jd_area',
    scopeArea: '80-99',
  });
}

function describeTarget(target: DatabaseTarget): void {
  let opened: OpenedDatabase;
  beforeAll(async () => {
    opened = await target.open();
  });
  afterAll(() => opened.close());

  it('applied every migration in the journal, in order', async () => {
    expect(await appliedMigrations(opened.db)).toEqual(migrationTimestamps);
  });

  it('refuses an UPDATE of grant_audit through its append-only trigger', async () => {
    const refused = await refusal(opened.db.update(grantAudit).set({ actor: 'human:x' }));
    expect(refused.code).toBe('P0001');
  });

  it('refuses a grant whose area is not NN-NN, naming the constraint', async () => {
    expect(await refusal(badArea(opened))).toEqual({
      code: '23514',
      constraint: 'role_grants_area_matches_scope',
    });
  });
}

describe.each(databaseTargets)('DX-6 DX-2 the real migrations and constraints on the $name database', describeTarget);

describe('DX-2 each embedded database is its own', () => {
  it('does not show one clone a row written in another', async () => {
    const [first, second] = [await createEmbeddedDatabase(), await createEmbeddedDatabase()];
    try {
      await first.db.insert(people).values({ email: 'clone@fixture.unfoldingword.org', displayName: 'Clone', status: 'active' });
      expect(await second.db.select().from(people)).toHaveLength(1);
      expect(await first.db.select().from(people)).toHaveLength(2);
    } finally {
      await first.close();
      await second.close();
    }
  });
});

describe.skipIf(process.env['CI'] !== 'true')('DX-6 both databases run in CI', () => {
  it('includes the server target', () => {
    expect(databaseTargets.map((target) => target.name)).toEqual(['embedded', 'server']);
  });
});
```

(The bootstrap migration seeds one person, so a fresh database holds one `people` row.) Run `pnpm exec vitest run --project node packages/db/both-targets.test.ts` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`packages/db/journal.ts`:

```ts
import journal from './migrations/meta/_journal.json' with { type: 'json' };

export const migrationTimestamps: readonly number[] = journal.entries.map((entry) => entry.when);
```

`packages/db/any-database.ts`:

```ts
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema.ts';

export type AnyDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
export type AnyTransaction = Parameters<Parameters<AnyDatabase['transaction']>[0]>[0];
export type AnyExecutor = AnyDatabase | AnyTransaction;
```

Both `createClient(...)` (postgres.js) and `drizzle(pglite, { schema })` are assignable to `AnyDatabase`; this was checked with `tsc` against drizzle-orm 0.45.3 and pglite 0.5.8.

`packages/db/migration-ledger.ts` (drizzle's own ledger table, read through the query builder because `execute` returns different shapes on the two drivers; it is not in `schema.ts`, so drizzle-kit never generates it and the declaration test never sees it):

```ts
import { asc } from 'drizzle-orm';
import { bigint, integer, pgSchema, text } from 'drizzle-orm/pg-core';
import type { AnyDatabase } from './any-database.ts';

const migrationLedger = pgSchema('drizzle').table('__drizzle_migrations', {
  id: integer('id').notNull(),
  hash: text('hash').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export async function appliedMigrations(db: AnyDatabase): Promise<number[]> {
  const rows = await db
    .select({ when: migrationLedger.createdAt })
    .from(migrationLedger)
    .orderBy(asc(migrationLedger.id));
  return rows.map((row) => row.when);
}
```

`packages/db/embedded.ts`:

```ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { migrationsFolder } from './migrate.ts';
import * as schema from './schema.ts';

export type EmbeddedDatabase = {
  readonly db: PgliteDatabase<typeof schema>;
  close(): Promise<void>;
};

let template: Promise<PGlite> | null = null;

async function migratedTemplate(): Promise<PGlite> {
  const client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder });
  return client;
}

export async function createEmbeddedDatabase(): Promise<EmbeddedDatabase> {
  template ??= migratedTemplate();
  const client = await (await template).clone();
  return { db: drizzle(client, { schema }), close: () => client.close() };
}

export async function closeEmbeddedTemplate(): Promise<void> {
  const pending = template;
  template = null;
  if (pending) await (await pending).close();
}
```

One migrated template per process, cloned per database: migrating takes about 2 s, a clone about 0.4 s (measured). `packages/db/migrate.ts` imports `postgres`; that is harmless here (nothing connects) — if knip or the Worker build ever objects, move `migrationsFolder` to its own file.

`packages/db/errors.ts` (the old `apps/uw-app/http/pg-errors.ts`, made driver-neutral):

```ts
function field(error: unknown, key: string): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const value: unknown = Reflect.get(error, key);
  return typeof value === 'string' ? value : null;
}

function fromErrorOrCause(error: unknown, key: string): string | null {
  const direct = field(error, key);
  if (direct !== null) return direct;
  if (typeof error !== 'object' || error === null) return null;
  return field(Reflect.get(error, 'cause'), key);
}

export function pgErrorCode(error: unknown): string | null {
  return fromErrorOrCause(error, 'code');
}

export function pgConstraint(error: unknown): string | null {
  return fromErrorOrCause(error, 'constraint_name') ?? fromErrorOrCause(error, 'constraint');
}
```

postgres.js reports `constraint_name`; PGlite reports `constraint` (both measured, wrapped by drizzle's `DrizzleQueryError` as `cause`). Delete `apps/uw-app/http/pg-errors.ts`; in `apps/uw-app/acl/grant-commands.ts` and `apps/uw-app/pages/store.ts` replace `from '../http/pg-errors.ts'` with `from '@uw/db/errors'`. Grep `pg-errors` afterwards: zero references outside `dist/`.

`packages/db/test-targets.ts`:

```ts
import type { AnyDatabase } from './any-database.ts';
import { createClient } from './client.ts';
import { createEmbeddedDatabase } from './embedded.ts';
import { createMigratedDatabase, testServer } from './test-database.ts';

export type OpenedDatabase = { readonly db: AnyDatabase; close(): Promise<void> };
export type DatabaseTarget = { readonly name: 'embedded' | 'server'; open(): Promise<OpenedDatabase> };

const embedded: DatabaseTarget = { name: 'embedded', open: createEmbeddedDatabase };

function serverTarget(server: string): DatabaseTarget {
  return {
    name: 'server',
    open: async () => {
      const database = await createMigratedDatabase(server);
      const db = createClient(database.connectionString);
      return {
        db,
        close: async () => {
          await db.$client.end();
          await database.drop();
        },
      };
    },
  };
}

export const databaseTargets: readonly DatabaseTarget[] = testServer
  ? [embedded, serverTarget(testServer)]
  : [embedded];
```

- [ ] **Step 4: Run the tests**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm exec vitest run --project node packages/db apps/uw-app/acl apps/uw-app/pages`
Expected: PASS, with `both-targets.test.ts` reporting both `embedded` and `server` cases.

- [ ] **Step 5: Verify and commit**

Run `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green. Check that the Worker build (`pnpm build`) does not bundle PGlite: `grep -c pglite apps/uw-app/dist/index.js` prints `0`.

```bash
git add packages/db apps/uw-app/http apps/uw-app/acl/grant-commands.ts apps/uw-app/pages/store.ts pnpm-lock.yaml
git commit -m "feat(db): an embedded Postgres running the real migrations, and one helper to run a test on both databases" -m "PGlite is cloned from one migrated template per process. Postgres error fields are read the same way on both drivers.

DX-2 DX-6"
```

---

### Task 5: The Drizzle Store, its contract, and both adapters

**Proves:** DX-2 (the sim's Store is the same Drizzle adapter as the platform's, over the embedded Postgres), DX-3 for `store`, DX-6 (two connections serialise on a Store lock, on the server).

**Files:**
- Create: `packages/db/store/store.ts`, `packages/db/store/index.ts`, `packages/db/store/store.test.ts`, `packages/db/store/store-lock.test.ts`
- Modify: `packages/db/package.json` (export `"./store": "./store/index.ts"`), `sim/package.json` (add `"@uw/db": "workspace:*"`)
- Create: `packages/harness/port-contracts/not-wired-cases.ts`, `packages/harness/port-contracts/store.ts`
- Create: `apps/uw-app/ports/store.ts`, `apps/uw-app/ports/store.not-wired.ts`, `apps/uw-app/ports/store.contract.pg.test.ts`, `apps/uw-app/ports/not-wired.contract.test.ts`
- Create: `sim/adapters/store.ts`, `sim/adapters/store.contract.test.ts`

**Interfaces:**
- Consumes: `AnyDatabase`, `AnyExecutor`, `appliedMigrations` (Task 4); `Store`, `StoreTransaction`, `notWiredCall`, `PortName` (Task 2).
- Produces: `createDrizzleStore(db: AnyDatabase): DrizzleStore`, `DrizzleStore`, `DrizzleTransaction`, `executorOf(tx: DrizzleTransaction): AnyExecutor` (`@uw/db/store`); `describeNotWired(port: PortName, adapter: string, target: object, methods: Readonly<Record<string, true>>): void`; `describeStoreContract(adapter: string, open: () => Promise<StoreSubject>): void`, `describeStoreNotWired(adapter: string, store: Store): void`, `StoreSubject = { store: Store; expectedMigrations: readonly number[]; close(): Promise<void> }`; `platformStore(db: Database): Store`, `storeNotWired: Store` (`apps/uw-app/ports/`); `createSimStore(database: EmbeddedDatabase): Store` (`sim/adapters/store.ts`).

- [ ] **Step 1: Write the failing tests**

`packages/harness/port-contracts/not-wired-cases.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PortName } from '../ports.ts';

function callWithoutArguments(target: object, method: string): Promise<unknown> {
  return new Promise((resolve) => {
    const member: unknown = Reflect.get(target, method);
    if (typeof member !== 'function') throw new TypeError(`${method} is not a method`);
    resolve(Reflect.apply(member, target, []));
  });
}

export function describeNotWired(
  port: PortName,
  adapter: string,
  target: object,
  methods: Readonly<Record<string, true>>,
): void {
  describe(`${port} port contract on ${adapter}, not wired`, () => {
    it.each(Object.keys(methods))('%s rejects with PortNotWiredError', async (method) => {
      await expect(callWithoutArguments(target, method)).rejects.toMatchObject({
        name: 'PortNotWiredError',
        port,
        method,
      });
    });
  });
}
```

`packages/harness/port-contracts/store.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Store, StoreTransaction } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type StoreSubject = {
  readonly store: Store;
  readonly expectedMigrations: readonly number[];
  close(): Promise<void>;
};

async function takeTwice(tx: StoreTransaction): Promise<void> {
  await tx.lock('store-contract');
  await tx.lock('store-contract');
}

export function describeStoreContract(adapter: string, open: () => Promise<StoreSubject>): void {
  describe(`store port contract on ${adapter}`, () => {
    let subject: StoreSubject;
    beforeAll(async () => {
      subject = await open();
    });
    afterAll(() => subject.close());

    it('reports every migration in the journal as applied, in order', async () => {
      expect(await subject.store.appliedMigrations()).toEqual(subject.expectedMigrations);
    });

    it('returns what the work returns', async () => {
      expect(await subject.store.transaction(async () => 42)).toBe(42);
    });

    it('rejects with the very error the work threw', async () => {
      const failure = new Error('work failed');
      await expect(subject.store.transaction(() => Promise.reject(failure))).rejects.toBe(failure);
    });

    it('lets one transaction take a lock twice and a later one take it again', async () => {
      await subject.store.transaction(takeTwice);
      await expect(subject.store.transaction(takeTwice)).resolves.toBeUndefined();
    });
  });
}

export function describeStoreNotWired(adapter: string, store: Store): void {
  describeNotWired('store', adapter, store, {
    transaction: true,
    appliedMigrations: true,
  } satisfies Record<keyof Store, true>);
}
```

Contract tests:

`sim/adapters/store.contract.test.ts`:

```ts
import { afterAll } from 'vitest';
import { describeStoreContract } from '@uw/harness/port-contracts/store';
import { closeEmbeddedTemplate, createEmbeddedDatabase } from '@uw/db/embedded';
import { migrationTimestamps } from '@uw/db/journal';
import { createSimStore } from './store.ts';

afterAll(closeEmbeddedTemplate);

describeStoreContract('the embedded Postgres store', async () => {
  const database = await createEmbeddedDatabase();
  return {
    store: createSimStore(database),
    expectedMigrations: migrationTimestamps,
    close: () => database.close(),
  };
});
```

`apps/uw-app/ports/store.contract.pg.test.ts`:

```ts
import { describe } from 'vitest';
import { createClient } from '@uw/db/client';
import { migrationTimestamps } from '@uw/db/journal';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { describeStoreContract } from '@uw/harness/port-contracts/store';
import { platformStore } from './store.ts';

describe.skipIf(!testServer)('DX-3 the platform store on Postgres', () => {
  describeStoreContract('the Drizzle store over postgres.js', async () => {
    const database = await createMigratedDatabase(testServer ?? '');
    const db = createClient(database.connectionString);
    return {
      store: platformStore(db),
      expectedMigrations: migrationTimestamps,
      close: async () => {
        await db.$client.end();
        await database.drop();
      },
    };
  });
});
```

`apps/uw-app/ports/not-wired.contract.test.ts` (Workers pool; later tasks add one line per not-wired adapter):

```ts
import { describeStoreNotWired } from '@uw/harness/port-contracts/store';
import { storeNotWired } from './store.not-wired.ts';

describeStoreNotWired('uw-app with no database', storeNotWired);
```

`packages/db/store/store.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from '../embedded.ts';
import { people } from '../schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from '../test-targets.ts';
import { createDrizzleStore, executorOf } from './store.ts';

afterAll(closeEmbeddedTemplate);

const email = 'rollback@fixture.unfoldingword.org';

async function writeThenFail(opened: OpenedDatabase): Promise<void> {
  await createDrizzleStore(opened.db).transaction(async (tx) => {
    await executorOf(tx).insert(people).values({ email, displayName: 'Rollback', status: 'active' });
    throw new Error('after the write');
  });
}

async function countByEmail(opened: OpenedDatabase, address: string): Promise<number> {
  return (await opened.db.select().from(people).where(eq(people.email, address))).length;
}

function describeTarget(target: DatabaseTarget): void {
  let opened: OpenedDatabase;
  beforeAll(async () => {
    opened = await target.open();
  });
  afterAll(() => opened.close());

  it('rolls back a write when the work throws', async () => {
    await expect(writeThenFail(opened)).rejects.toThrow('after the write');
    expect(await countByEmail(opened, email)).toBe(0);
  });

  it('commits a write when the work returns', async () => {
    const committed = 'commit@fixture.unfoldingword.org';
    await createDrizzleStore(opened.db).transaction(async (tx) => {
      await executorOf(tx).insert(people).values({ email: committed, displayName: 'Commit', status: 'active' });
    });
    expect(await countByEmail(opened, committed)).toBe(1);
  });
}

describe.each(databaseTargets)('DX-2 DX-6 the Drizzle store on the $name database', describeTarget);

describe('DX-2 executorOf', () => {
  it('refuses a transaction the Drizzle store did not open', () => {
    expect(() => executorOf({ lock: async () => undefined })).toThrow(
      'not a transaction of the Drizzle store',
    );
  });
});
```

`packages/db/store/store-lock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createClient } from '../client.ts';
import { createMigratedDatabase, testServer } from '../test-database.ts';
import { createDrizzleStore, type DrizzleStore } from './store.ts';

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function race(first: DrizzleStore, second: DrizzleStore): Promise<string[]> {
  const order: string[] = [];
  let signal: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const firstRun = first.transaction(async (tx) => {
    await tx.lock('race');
    signal();
    await pause(150);
    order.push('first finished');
  });
  await held;
  const secondRun = second.transaction(async (tx) => {
    await tx.lock('race');
    order.push('second locked');
  });
  await Promise.all([firstRun, secondRun]);
  return order;
}

describe.skipIf(!testServer)('DX-6 two connections serialise on one store lock', () => {
  it('holds the second transaction until the first commits', async () => {
    const database = await createMigratedDatabase(testServer ?? '');
    const one = createClient(database.connectionString);
    const two = createClient(database.connectionString);
    try {
      expect(await race(createDrizzleStore(one), createDrizzleStore(two))).toEqual([
        'first finished',
        'second locked',
      ]);
    } finally {
      await one.$client.end();
      await two.$client.end();
      await database.drop();
    }
  });
});
```

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm exec vitest run --project node packages/db/store sim/adapters/store.contract.test.ts` → FAIL (`./store.ts` missing).

- [ ] **Step 2: Implement** `packages/db/store/store.ts`

```ts
import { sql } from 'drizzle-orm';
import type { AnyDatabase, AnyExecutor } from '../any-database.ts';
import { appliedMigrations } from '../migration-ledger.ts';

export type DrizzleTransaction = { lock(key: string): Promise<void> };

export type DrizzleStore = {
  transaction<T>(work: (tx: DrizzleTransaction) => Promise<T>): Promise<T>;
  appliedMigrations(): Promise<readonly number[]>;
};

const executors = new WeakMap<DrizzleTransaction, AnyExecutor>();

export function executorOf(tx: DrizzleTransaction): AnyExecutor {
  const executor = executors.get(tx);
  if (!executor) throw new TypeError('not a transaction of the Drizzle store');
  return executor;
}

function bind(executor: AnyExecutor): DrizzleTransaction {
  const tx: DrizzleTransaction = {
    lock: async (key) => {
      await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    },
  };
  executors.set(tx, executor);
  return tx;
}

async function inTransaction<T>(
  db: AnyDatabase,
  work: (tx: DrizzleTransaction) => Promise<T>,
): Promise<T> {
  const thrown: { failed: boolean; error: unknown } = { failed: false, error: undefined };
  try {
    return await db.transaction(async (executor) => {
      try {
        return await work(bind(executor));
      } catch (error) {
        thrown.failed = true;
        thrown.error = error;
        throw error;
      }
    });
  } catch (error) {
    throw thrown.failed ? thrown.error : error;
  }
}

export function createDrizzleStore(db: AnyDatabase): DrizzleStore {
  return {
    transaction: (work) => inTransaction(db, work),
    appliedMigrations: () => appliedMigrations(db),
  };
}
```

The re-throw guarantees the contract's "the very error the work threw" whatever the driver does on rollback. Step 3 adds each kernel table's gateway as a member that `bind` builds over the same `executor`.

`packages/db/store/index.ts`:

```ts
export { createDrizzleStore, executorOf } from './store.ts';
export type { DrizzleStore, DrizzleTransaction } from './store.ts';
```

Export `"./store": "./store/index.ts"` from `packages/db/package.json`. The barrel never imports `embedded.ts`, so the Worker never bundles PGlite.

`apps/uw-app/ports/store.ts`:

```ts
import type { Database } from '@uw/db/client';
import { createDrizzleStore } from '@uw/db/store';
import type { Store } from '@uw/harness';

export function platformStore(db: Database): Store {
  return createDrizzleStore(db);
}
```

`apps/uw-app/ports/store.not-wired.ts`:

```ts
import { notWiredCall, type Store } from '@uw/harness';

export const storeNotWired: Store = {
  transaction: () => notWiredCall('store', 'transaction'),
  appliedMigrations: () => notWiredCall('store', 'appliedMigrations'),
};
```

`sim/adapters/store.ts`:

```ts
import type { EmbeddedDatabase } from '@uw/db/embedded';
import { createDrizzleStore } from '@uw/db/store';
import type { Store } from '@uw/harness';

export function createSimStore(database: EmbeddedDatabase): Store {
  return createDrizzleStore(database.db);
}
```

The `Store` return annotation on both adapters is where a drift between `DrizzleStore` and the port fails the typecheck. Add `"@uw/db": "workspace:*"` to `sim/package.json` and run `pnpm install`.

- [ ] **Step 3: Run the tests**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm exec vitest run --project node packages/db sim apps/uw-app/ports/store.contract.pg.test.ts && pnpm exec vitest run --project workers apps/uw-app/ports`
Expected: PASS; the lock race and the platform store contract ran (not skipped).

- [ ] **Step 4: Verify and commit**

Run `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add packages/db packages/harness/port-contracts apps/uw-app/ports sim pnpm-lock.yaml
git commit -m "feat(db): one Drizzle store for both adapters, with its port contract on the embedded Postgres and the server" -m "DX-2 DX-3 DX-6"
```

---

### Task 6: The Grants port: the same queries on both databases

**Proves:** DX-3 for `grants`; DX-2 (the sim's Grants adapter runs the platform's queries on the embedded Postgres); Review Focus 2 (expiry judged at the instant given).

**Files:**
- Create: `packages/db/store/grants.ts`, `packages/db/test-seed.ts`
- Modify: `packages/db/store/index.ts`, `packages/db/package.json` (export `"./test-seed": "./test-seed.ts"`)
- Delete: `apps/uw-app/acl/grant-store.ts` (its three functions move to `packages/db/store/grants.ts`; grep shows its only importers are `apps/uw-app/acl/grant-commands.ts` and `apps/uw-app/auth/principal-middleware.ts`)
- Modify: `apps/uw-app/acl/grant-commands.ts`, `apps/uw-app/auth/principal-middleware.ts` (import from `@uw/db/store`)
- Create: `packages/harness/port-contracts/grants.ts`
- Create: `apps/uw-app/ports/grants.ts`, `apps/uw-app/ports/grants.not-wired.ts`, `apps/uw-app/ports/grants.contract.pg.test.ts`; modify `apps/uw-app/ports/not-wired.contract.test.ts`
- Create: `sim/adapters/grants.ts`, `sim/adapters/grants.contract.test.ts`
- Modify: `docs/exceptions.md`

**Interfaces:**
- Consumes: `executorOf`, `DrizzleTransaction` (Task 5); `roleGrants`, `people`; `grantSchema`, `Grant`, `JdArea`, `Role`, `Scope` from `@uw/contracts`.
- Produces: `toGrant(row)`, `liveGrant(at?: Date)`, `resolveGrants(db: AnyExecutor, personId: string, options?: { at?: Date; lock?: 'none' | 'share' }): Promise<Grant[]>`, `createDrizzleGrants(db: AnyDatabase): DrizzleGrants` (`@uw/db/store`); `seedPerson(db, { id, email, status? })`, `seedGrant(db, SeedGrant)`, `revokeSeededGrant(db, grantId, at)` (`@uw/db/test-seed`); `describeGrantsContract(adapter, open: () => Promise<GrantsSubject>)`, `describeGrantsNotWired(adapter, grants)`, `GrantsSubject`, `SeedGrantInput`; `platformGrants(db: Database): Grants`, `grantsNotWired: Grants`; `createSimGrants(database: EmbeddedDatabase): Grants`.

- [ ] **Step 1: The exception, first**

In `docs/exceptions.md` add a row:

`| 2026-10-01 | Rule 3: each table is written by exactly one module | packages/db/test-seed.ts | Tests and the sim need people and grants in a database before the code under test runs, and the owning commands (people directory, grants command) need a principal and a request to run. The helpers write only fixture rows, are imported only by test files and sim/, and never run against a platform database. | Revisit if a non-test, non-sim file imports @uw/db/test-seed. |`

In the same file, change the **Review** cell of the six step-1 rows that say "Revisit when the Store port lands in step 2" to: `Revisited 2026-10-01 (step 2): kept. The Store port carries what the kernel reaches; this is a platform module, not kernel code. Revisit when a kernel module needs this table.` For the `apps/uw-app/acl/grant-store.ts` row, change the **File** cell to `packages/db/store/grants.ts (was apps/uw-app/acl/grant-store.ts)` and the **Review** cell to `Superseded 2026-10-01 (step 2): the read is now the shared Drizzle implementation of the Grants port (AGENTS.md rule 2).`

- [ ] **Step 2: Write the failing tests**

`packages/harness/port-contracts/grants.ts`:

```ts
import { grantSchema, type Grant, type JdArea, type Role, type Scope } from '@uw/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Grants, Store } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type SeedGrantInput = {
  readonly id: string;
  readonly personId: string;
  readonly role: Role;
  readonly scopeKind: Scope;
  readonly scopeArea: JdArea | null;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
};

export type GrantsSubject = {
  readonly grants: Grants;
  readonly store: Store;
  seedPerson(id: string): Promise<void>;
  seedGrant(grant: SeedGrantInput): Promise<void>;
  revoke(grantId: string, at: Date): Promise<void>;
  close(): Promise<void>;
};

const at = new Date('2030-01-01T00:00:00.000Z');
const person = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const grantId = (n: number) => `a2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function orgAdmin(n: number, personId: string): SeedGrantInput {
  return {
    id: grantId(n),
    personId,
    role: 'admin',
    scopeKind: 'org',
    scopeArea: null,
    grantedAt: new Date('2029-01-01T00:00:00.000Z'),
    expiresAt: null,
  };
}

function areaEditor(n: number, personId: string, expiresAt: Date | null): SeedGrantInput {
  return {
    id: grantId(n),
    personId,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2029-02-01T00:00:00.000Z'),
    expiresAt,
  };
}

async function given(subject: GrantsSubject, personId: string, grants: SeedGrantInput[]) {
  await subject.seedPerson(personId);
  for (const grant of grants) await subject.seedGrant(grant);
}

function ids(grants: readonly Grant[]): string[] {
  return grants.map((grant) => grantSchema.parse(grant).grantId);
}
```

Then two `describe` blocks inside `export function describeGrantsContract(adapter: string, open: () => Promise<GrantsSubject>): void`, sharing one subject opened in a `beforeAll` and closed in `afterAll` at the function's top level (hoist the open/close into a helper `withSubject()` that registers the hooks and returns a getter, so each describe stays under 50 lines). Cases, each with its own person so they are independent:

1. `returns the live grants in grant order, as contract grants`: person 1 with `orgAdmin(1, p1)` and `areaEditor(2, p1, 2030-06-01)` → `resolve(p1, at)` `toEqual` `[{ grantId: grantId(1), role: 'admin', scopeKind: 'org', scopeArea: null, expiresAt: null }, { grantId: grantId(2), role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89', expiresAt: '2030-06-01T00:00:00.000Z' }]`.
2. `judges expiry at the instant it is given, not by the database clock`: person 2 with `areaEditor(3, p2, 2029-12-31T00:00:00.000Z)` → `ids(await resolve(p2, at))` is `[]` (the grant is live by the wall clock in 2026, so a `now()` check would wrongly keep it) and `ids(await resolve(p2, new Date('2029-06-01T00:00:00.000Z')))` is `[grantId(3)]`.
3. `leaves out a revoked grant`: person 3 with `orgAdmin(4, p3)`, then `revoke(grantId(4), new Date('2029-03-01T00:00:00.000Z'))` → `[]`.
4. `returns nothing for a person with no grants`: `resolve(person(9), at)` is `[]` (no person row needed).
5. `rereads under lock inside a transaction, and sees a revoke made before it`: person 4 with `orgAdmin(5, p4)`; `ids(await store.transaction((tx) => grants.lockAndReread(tx, p4, at)))` is `[grantId(5)]`; then `revoke(grantId(5), at)`; the same reread is `[]`.
6. `never returns another person's grants`: person 5 with `orgAdmin(6, p5)` and person 6 with `orgAdmin(7, p6)` → `ids(await resolve(p5, at))` is `[grantId(6)]`.

Title the blocks `grants port contract on ${adapter}: what resolves` and `grants port contract on ${adapter}: under lock`. End the file with:

```ts
export function describeGrantsNotWired(adapter: string, grants: Grants): void {
  describeNotWired('grants', adapter, grants, {
    resolve: true,
    lockAndReread: true,
  } satisfies Record<keyof Grants, true>);
}
```

`sim/adapters/grants.contract.test.ts`:

```ts
import { afterAll } from 'vitest';
import { closeEmbeddedTemplate, createEmbeddedDatabase } from '@uw/db/embedded';
import { revokeSeededGrant, seedGrant, seedPerson } from '@uw/db/test-seed';
import { describeGrantsContract } from '@uw/harness/port-contracts/grants';
import { createSimGrants } from './grants.ts';
import { createSimStore } from './store.ts';

afterAll(closeEmbeddedTemplate);

describeGrantsContract('the embedded Postgres grants', async () => {
  const database = await createEmbeddedDatabase();
  return {
    grants: createSimGrants(database),
    store: createSimStore(database),
    seedPerson: (id) => seedPerson(database.db, { id, email: `${id}@fixture.unfoldingword.org` }),
    seedGrant: (grant) => seedGrant(database.db, grant),
    revoke: (id, at) => revokeSeededGrant(database.db, id, at),
    close: () => database.close(),
  };
});
```

`apps/uw-app/ports/grants.contract.pg.test.ts`: the same shape as `store.contract.pg.test.ts` (Task 5): inside `describe.skipIf(!testServer)('DX-3 the platform grants on Postgres', ...)`, call `describeGrantsContract('the Drizzle grants over postgres.js', ...)` with `grants: platformGrants(db)`, `store: platformStore(db)` (import `./store.ts`), the seed functions over `db`, and a `close` that ends the client and drops the database.

`apps/uw-app/ports/not-wired.contract.test.ts` gains `describeGrantsNotWired('uw-app with no database', grantsNotWired);` importing `./grants.not-wired.ts`.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm exec vitest run --project node sim/adapters/grants.contract.test.ts apps/uw-app/ports` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`packages/db/store/grants.ts`:

```ts
import { and, asc, eq, gt, isNull, or, sql, type SQL } from 'drizzle-orm';
import { grantSchema, type Grant } from '@uw/contracts';
import type { AnyDatabase, AnyExecutor } from '../any-database.ts';
import { roleGrants } from '../schema.ts';
import { executorOf, type DrizzleTransaction } from './store.ts';

export function toGrant(row: typeof roleGrants.$inferSelect): Grant {
  return grantSchema.parse({
    grantId: row.id,
    role: row.role,
    scopeKind: row.scopeKind,
    scopeArea: row.scopeArea,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  });
}

export function liveGrant(at?: Date): SQL | undefined {
  return and(
    isNull(roleGrants.revokedAt),
    or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, at ?? sql`now()`)),
  );
}

export type GrantReadOptions = { readonly at?: Date; readonly lock?: 'none' | 'share' };

export async function resolveGrants(
  db: AnyExecutor,
  personId: string,
  options: GrantReadOptions = {},
): Promise<Grant[]> {
  const query = db
    .select()
    .from(roleGrants)
    .where(and(eq(roleGrants.personId, personId), liveGrant(options.at)))
    .orderBy(asc(roleGrants.grantedAt), asc(roleGrants.id));
  const rows = options.lock === 'share' ? await query.for('share') : await query;
  return rows.map(toGrant);
}

export type DrizzleGrants = {
  resolve(personId: string, at: Date): Promise<readonly Grant[]>;
  lockAndReread(tx: DrizzleTransaction, personId: string, at: Date): Promise<readonly Grant[]>;
};

export function createDrizzleGrants(db: AnyDatabase): DrizzleGrants {
  return {
    resolve: (personId, at) => resolveGrants(db, personId, { at }),
    lockAndReread: (tx, personId, at) =>
      resolveGrants(executorOf(tx), personId, { at, lock: 'share' }),
  };
}
```

Called with no `at`, `liveGrant` keeps the database clock, so the step-1 callers (`grant-commands.ts`, `principal-middleware.ts`) behave exactly as before. If `.for('share')` after `.orderBy` does not typecheck on the union `AnyExecutor`, build the query on `db.select().from(roleGrants)` in two branches instead; do not cast.

`packages/db/store/index.ts` gains `export { createDrizzleGrants, liveGrant, resolveGrants, toGrant } from './grants.ts'; export type { DrizzleGrants, GrantReadOptions } from './grants.ts';`.

Delete `apps/uw-app/acl/grant-store.ts`. In `apps/uw-app/acl/grant-commands.ts` replace `import { liveGrant, toGrant } from './grant-store.ts';` with `import { liveGrant, toGrant } from '@uw/db/store';`; in `apps/uw-app/auth/principal-middleware.ts` replace `import { resolveGrants } from '../acl/grant-store.ts';` with `import { resolveGrants } from '@uw/db/store';`. Grep `grant-store` afterwards: no reference outside `dist/` and `docs/` history rows.

`packages/db/test-seed.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Role, Scope } from '@uw/contracts';
import type { AnyExecutor } from './any-database.ts';
import { people, roleGrants } from './schema.ts';

export type SeedPerson = {
  readonly id: string;
  readonly email: string;
  readonly status?: 'active' | 'pending';
};

export type SeedGrant = {
  readonly id: string;
  readonly personId: string;
  readonly role: Role;
  readonly scopeKind: Scope;
  readonly scopeArea: string | null;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
};

export async function seedPerson(db: AnyExecutor, person: SeedPerson): Promise<void> {
  await db.insert(people).values({
    id: person.id,
    email: person.email,
    displayName: person.email,
    status: person.status ?? 'active',
  });
}

export async function seedGrant(db: AnyExecutor, grant: SeedGrant): Promise<void> {
  await db.insert(roleGrants).values({ ...grant });
}

export async function revokeSeededGrant(db: AnyExecutor, grantId: string, at: Date): Promise<void> {
  await db.update(roleGrants).set({ revokedAt: at }).where(eq(roleGrants.id, grantId));
}
```

`apps/uw-app/ports/grants.ts`: `export function platformGrants(db: Database): Grants { return createDrizzleGrants(db); }`. `apps/uw-app/ports/grants.not-wired.ts`: `export const grantsNotWired: Grants = { resolve: () => notWiredCall('grants', 'resolve'), lockAndReread: () => notWiredCall('grants', 'lockAndReread') };`. `sim/adapters/grants.ts`: `export function createSimGrants(database: EmbeddedDatabase): Grants { return createDrizzleGrants(database.db); }`.

- [ ] **Step 4: Run the tests**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm exec vitest run --project node sim packages/db apps/uw-app && pnpm exec vitest run --project workers apps/uw-app`
Expected: PASS, including every step-1 `acl` and `auth` pg test (behaviour unchanged) and `tools/architecture/owners.test.ts`.

- [ ] **Step 5: Verify and commit**

Run `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add docs/exceptions.md packages/db packages/harness/port-contracts apps/uw-app sim pnpm-lock.yaml
git commit -m "feat(db): the grants port runs the platform's queries on both databases and judges expiry at the kernel's instant" -m "The three grant reads move from apps/uw-app/acl/grant-store.ts to packages/db/store/grants.ts so the sim runs the same SQL. Fixture seeding is recorded in docs/exceptions.md.

DX-2 DX-3"
```

---

### Task 7: GitHubFacts, Connectors and ModelEngine: contracts, test adapters, platform adapters not wired

**Proves:** DX-3 for `githubFacts`, `connectors`, `modelEngine`; DX-8 (each is proven against a test adapter; its platform adapter waits on a later step).

**Files:**
- Create: `packages/harness/port-contracts/github-facts.ts`, `connectors.ts`, `model-engine.ts`
- Create: `sim/adapters/github-facts.ts`, `connectors.ts`, `model-engine.ts`, and `sim/adapters/github-facts.contract.test.ts`, `connectors.contract.test.ts`, `model-engine.contract.test.ts`
- Create: `apps/uw-app/ports/github-facts.not-wired.ts`, `connectors.not-wired.ts`, `model-engine.not-wired.ts`; modify `apps/uw-app/ports/not-wired.contract.test.ts`

**Interfaces:**
- Consumes: `GitHubFacts`, `PullRequestFacts`, `PullRequestRef`, `Connectors`, `ConnectorRequest`, `ConnectorOutcome`, `EffectConnector`, `ModelEngine`, `TurnRequest`, `TurnResult`, `ToolOutsideToolsetError`, `notWiredCall` (Task 2); `describeNotWired` (Task 5); `connectorSchema` from `@uw/contracts`.
- Produces:
  - `describeGithubFactsContract(adapter, open: () => Promise<GithubFactsSubject>)`, `GithubFactsSubject = { facts: GitHubFacts; given(facts: PullRequestFacts): Promise<void> }`, `describeGithubFactsNotWired(adapter, facts)`.
  - `describeConnectorsContract(adapter, open: () => Promise<ConnectorsSubject>)`, `ConnectorsSubject = { connectors: Connectors; refuseNext(connector: EffectConnector, reason: string): Promise<void> }`, `describeConnectorsNotWired(adapter, connectors)`.
  - `describeModelEngineContract(adapter, open: () => Promise<ModelEngineSubject>)`, `ModelEngineSubject = { engine: ModelEngine; respondNextWith(result: TurnResult): Promise<void> }`, `describeModelEngineNotWired(adapter, engine)`.
  - `createSimGitHubFacts(): SimGitHubFacts` (`GitHubFacts & { given(facts: PullRequestFacts): void }`); `createSimConnectors(): SimConnectors` (`Connectors & { calls(): readonly ConnectorRequest[]; refuseNext(connector: EffectConnector, reason: string): void }`); `createSimModelEngine(): SimModelEngine` (`ModelEngine & { respondNextWith(result: TurnResult): void; pending(): number }`).
  - `githubFactsNotWired`, `connectorsNotWired`, `modelEngineNotWired` (`apps/uw-app/ports/`).

- [ ] **Step 1: Write the contract suites (the failing tests)**

`packages/harness/port-contracts/github-facts.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { GitHubFacts, PullRequestFacts } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type GithubFactsSubject = {
  readonly facts: GitHubFacts;
  given(facts: PullRequestFacts): Promise<void>;
};

function factsFor(repo: string, number: number, head: string): PullRequestFacts {
  return {
    ref: { repo, number },
    state: 'open',
    draft: false,
    head,
    checks: [{ name: 'test', headSha: head, conclusion: 'success' }],
    reviews: [{ reviewer: 'uw-reviewer', commit: head, state: 'approved', provider: 'fixture-provider' }],
    freshAt: new Date('2026-10-01T09:00:00.000Z'),
  };
}

export function describeGithubFactsContract(
  adapter: string,
  open: () => Promise<GithubFactsSubject>,
): void {
  describe(`githubFacts port contract on ${adapter}`, () => {
    it('answers null for a pull request it has no facts for', async () => {
      const subject = await open();
      expect(await subject.facts.pullRequest({ repo: 'unfoldingWord/uw-platform', number: 404 })).toBeNull();
    });

    it('answers the facts it holds for a pull request', async () => {
      const subject = await open();
      const known = factsFor('unfoldingWord/uw-platform', 7, 'a'.repeat(40));
      await subject.given(known);
      expect(await subject.facts.pullRequest(known.ref)).toEqual(known);
    });

    it('keeps two repositories apart', async () => {
      const subject = await open();
      await subject.given(factsFor('unfoldingWord/uw-platform', 7, 'a'.repeat(40)));
      await subject.given(factsFor('unfoldingWord/other', 7, 'b'.repeat(40)));
      const answer = await subject.facts.pullRequest({ repo: 'unfoldingWord/uw-platform', number: 7 });
      expect(answer?.head).toBe('a'.repeat(40));
    });

    it('answers the latest facts after the head moves', async () => {
      const subject = await open();
      await subject.given(factsFor('unfoldingWord/uw-platform', 8, 'a'.repeat(40)));
      await subject.given(factsFor('unfoldingWord/uw-platform', 8, 'c'.repeat(40)));
      const answer = await subject.facts.pullRequest({ repo: 'unfoldingWord/uw-platform', number: 8 });
      expect(answer?.head).toBe('c'.repeat(40));
    });
  });
}

export function describeGithubFactsNotWired(adapter: string, facts: GitHubFacts): void {
  describeNotWired('githubFacts', adapter, facts, { pullRequest: true } satisfies Record<keyof GitHubFacts, true>);
}
```

`packages/harness/port-contracts/connectors.ts`:

```ts
import { connectorSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { ConnectorRequest, Connectors, EffectConnector } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type ConnectorsSubject = {
  readonly connectors: Connectors;
  refuseNext(connector: EffectConnector, reason: string): Promise<void>;
};

const effectConnectors = connectorSchema.options.filter(
  (connector): connector is EffectConnector => connector !== 'none',
);

function request(connector: EffectConnector): ConnectorRequest {
  return {
    connector,
    harnessId: 'b1000000-0000-4000-8000-000000000001',
    itemId: 'b1000000-0000-4000-8000-000000000002',
    traceId: 'b1000000-0000-4000-8000-000000000003',
    pullRequest: { repo: 'unfoldingWord/uw-platform', number: 7 },
    expectedHead: 'f'.repeat(40),
    message: 'connector contract fixture',
  };
}

export function describeConnectorsContract(adapter: string, open: () => Promise<ConnectorsSubject>): void {
  describe(`connectors port contract on ${adapter}`, () => {
    it.each(effectConnectors)('%s resolves to an outcome and never rejects', async (connector) => {
      const subject = await open();
      expect(await subject.connectors.run(request(connector))).toMatchObject({ outcome: 'succeeded' });
    });

    it('returns a refusal as an outcome carrying its reason, not as an exception', async () => {
      const subject = await open();
      await subject.refuseNext('merge', 'head_mismatch');
      expect(await subject.connectors.run(request('merge'))).toEqual({
        outcome: 'refused',
        reason: 'head_mismatch',
      });
    });
  });
}

export function describeConnectorsNotWired(adapter: string, connectors: Connectors): void {
  describeNotWired('connectors', adapter, connectors, { run: true } satisfies Record<keyof Connectors, true>);
}
```

`packages/harness/port-contracts/model-engine.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ModelEngine, TurnRequest, TurnResult } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type ModelEngineSubject = {
  readonly engine: ModelEngine;
  respondNextWith(result: TurnResult): Promise<void>;
};

const turnRequest: TurnRequest = {
  engine: 'openrouter-messages',
  model: 'fixture-model',
  persona: 'builder',
  instructions: 'model engine contract fixture',
  tools: ['read_page', 'claim_item'],
  messages: [{ role: 'user', text: 'begin' }],
  traceId: 'b2000000-0000-4000-8000-000000000001',
};

function turnCalling(verb: TurnResult['toolCalls'][number]['verb']): TurnResult {
  return {
    toolCalls: [{ callId: 'call-1', verb, input: {} }],
    text: null,
    usage: { inputTokens: 120, outputTokens: 30, costMinor: 1, costBasis: 'metered' },
    resolvedProvider: 'fixture-provider',
    resolvedModel: 'fixture-model',
  };
}

export function describeModelEngineContract(adapter: string, open: () => Promise<ModelEngineSubject>): void {
  describe(`modelEngine port contract on ${adapter}`, () => {
    it('returns the tool calls of a turn that stays inside the offered toolset', async () => {
      const subject = await open();
      await subject.respondNextWith(turnCalling('claim_item'));
      expect((await subject.engine.turn(turnRequest)).toolCalls.map((call) => call.verb)).toEqual(['claim_item']);
    });

    it('rejects a turn that calls a verb outside the toolset, naming the verb', async () => {
      const subject = await open();
      await subject.respondNextWith(turnCalling('write_page'));
      await expect(subject.engine.turn(turnRequest)).rejects.toMatchObject({
        name: 'ToolOutsideToolsetError',
        verb: 'write_page',
      });
    });

    it('reports usage as non-negative whole numbers with a cost basis', async () => {
      const subject = await open();
      await subject.respondNextWith(turnCalling('read_page'));
      const { usage } = await subject.engine.turn(turnRequest);
      expect(Number.isInteger(usage.inputTokens) && usage.inputTokens >= 0).toBe(true);
      expect(Number.isInteger(usage.outputTokens) && usage.outputTokens >= 0).toBe(true);
      expect(['metered', 'subscription']).toContain(usage.costBasis);
    });
  });
}

export function describeModelEngineNotWired(adapter: string, engine: ModelEngine): void {
  describeNotWired('modelEngine', adapter, engine, { turn: true } satisfies Record<keyof ModelEngine, true>);
}
```

Sim contract tests, one per port, for example `sim/adapters/connectors.contract.test.ts`:

```ts
import { describeConnectorsContract } from '@uw/harness/port-contracts/connectors';
import { createSimConnectors } from './connectors.ts';

describeConnectorsContract('the recording sim connectors', async () => {
  const connectors = createSimConnectors();
  return { connectors, refuseNext: async (connector, reason) => connectors.refuseNext(connector, reason) };
});
```

and likewise `github-facts.contract.test.ts` (`facts`, `given: async (f) => facts.given(f)`) and `model-engine.contract.test.ts` (`engine`, `respondNextWith: async (r) => engine.respondNextWith(r)`). Add to `sim/adapters/` a unit test `sim/adapters/recording-adapters.test.ts` (`describe('DX-4 the recording sim adapters')`): `calls()` returns every request in order and a caller mutating the returned array or a returned request does not change the next `calls()`; a `refuseNext` refusal applies once, then the connector succeeds again; `createSimGitHubFacts().pullRequest` returns a copy (mutating the answer does not change the next answer); `createSimModelEngine()` with nothing scripted returns `{ toolCalls: [], text: null, usage: { inputTokens: 0, outputTokens: 0, costMinor: 0, costBasis: 'metered' }, resolvedProvider: null, resolvedModel: <request.model> }`, and `pending()` counts scripted turns.

`apps/uw-app/ports/not-wired.contract.test.ts` gains:

```ts
describeGithubFactsNotWired('uw-app until GH-2', githubFactsNotWired);
describeConnectorsNotWired('uw-app until GH-6', connectorsNotWired);
describeModelEngineNotWired('uw-app until HE-2', modelEngineNotWired);
```

with the imports from `@uw/harness/port-contracts/<kebab>` and `./<kebab>.not-wired.ts`.

Run: `pnpm exec vitest run --project node sim/adapters` → FAIL (adapters missing).

- [ ] **Step 2: Implement the test adapters**

`sim/adapters/github-facts.ts`:

```ts
import type { GitHubFacts, PullRequestFacts, PullRequestRef } from '@uw/harness';

export type SimGitHubFacts = GitHubFacts & { given(facts: PullRequestFacts): void };

const keyOf = (ref: PullRequestRef): string => `${ref.repo}#${ref.number}`;

export function createSimGitHubFacts(): SimGitHubFacts {
  const known = new Map<string, PullRequestFacts>();
  return {
    pullRequest: async (ref) => {
      const found = known.get(keyOf(ref));
      return found ? structuredClone(found) : null;
    },
    given: (facts) => {
      known.set(keyOf(facts.ref), structuredClone(facts));
    },
  };
}
```

`sim/adapters/connectors.ts`:

```ts
import type { ConnectorRequest, Connectors, EffectConnector } from '@uw/harness';

export type SimConnectors = Connectors & {
  calls(): readonly ConnectorRequest[];
  refuseNext(connector: EffectConnector, reason: string): void;
};

export function createSimConnectors(): SimConnectors {
  const calls: ConnectorRequest[] = [];
  const refusals = new Map<EffectConnector, string>();
  return {
    run: async (request) => {
      calls.push(structuredClone(request));
      const reason = refusals.get(request.connector);
      if (reason === undefined) return { outcome: 'succeeded', detail: {} };
      refusals.delete(request.connector);
      return { outcome: 'refused', reason };
    },
    calls: () => calls.map((call) => structuredClone(call)),
    refuseNext: (connector, reason) => {
      refusals.set(connector, reason);
    },
  };
}
```

`sim/adapters/model-engine.ts`:

```ts
import { ToolOutsideToolsetError, type ModelEngine, type TurnResult } from '@uw/harness';

export type SimModelEngine = ModelEngine & {
  respondNextWith(result: TurnResult): void;
  pending(): number;
};

function idle(model: string): TurnResult {
  return {
    toolCalls: [],
    text: null,
    usage: { inputTokens: 0, outputTokens: 0, costMinor: 0, costBasis: 'metered' },
    resolvedProvider: null,
    resolvedModel: model,
  };
}

export function createSimModelEngine(): SimModelEngine {
  const script: TurnResult[] = [];
  return {
    turn: async (request) => {
      const result = script.shift() ?? idle(request.model);
      const outside = result.toolCalls.find((call) => !request.tools.includes(call.verb));
      if (outside) throw new ToolOutsideToolsetError(outside.verb);
      return result;
    },
    respondNextWith: (result) => {
      script.push(result);
    },
    pending: () => script.length,
  };
}
```

- [ ] **Step 3: Implement the platform adapters, not wired**

`apps/uw-app/ports/github-facts.not-wired.ts`: `export const githubFactsNotWired: GitHubFacts = { pullRequest: () => notWiredCall('githubFacts', 'pullRequest') };`
`apps/uw-app/ports/connectors.not-wired.ts`: `export const connectorsNotWired: Connectors = { run: () => notWiredCall('connectors', 'run') };`
`apps/uw-app/ports/model-engine.not-wired.ts`: `export const modelEngineNotWired: ModelEngine = { turn: () => notWiredCall('modelEngine', 'turn') };`
(each imports `notWiredCall` and the port type from `@uw/harness`).

- [ ] **Step 4: Run, verify, commit**

Run: `pnpm exec vitest run --project node sim && pnpm exec vitest run --project workers apps/uw-app/ports` → PASS. Then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add packages/harness/port-contracts sim/adapters apps/uw-app/ports
git commit -m "feat(sim): GitHub facts, connectors and the model engine ports, with contracts run against test and not-wired platform adapters" -m "DX-3 DX-8"
```

---

### Task 8: Hub, Notifier and Runs: contracts, test adapters, platform adapters not wired

**Proves:** DX-3 for `hub`, `notifier`, `runs`; DX-8.

**Files:**
- Create: `packages/harness/port-contracts/hub.ts`, `notifier.ts`, `runs.ts`
- Create: `sim/adapters/hub.ts`, `notifier.ts`, `runs.ts`, and `sim/adapters/hub.contract.test.ts`, `notifier.contract.test.ts`, `runs.contract.test.ts`
- Create: `apps/uw-app/ports/hub.not-wired.ts`, `notifier.not-wired.ts`, `runs.not-wired.ts`; modify `apps/uw-app/ports/not-wired.contract.test.ts`

**Interfaces:**
- Consumes: `Hub`, `Notifier`, `Wake`, `Runs`, `RunAction`, `RunState`, `RunStart`, `RunTransitionError`, `notWiredCall` (Task 2); `describeNotWired` (Task 5).
- Produces:
  - `describeHubContract(adapter, open: () => Promise<HubSubject>)`, `HubSubject = { hub: Hub; wakes(): Promise<readonly string[]> }`, `describeHubNotWired(adapter, hub)`.
  - `describeNotifierContract(adapter, open: () => Promise<NotifierSubject>)`, `NotifierSubject = { notifier: Notifier; delivered(): Promise<readonly Wake[]>; failNext(): Promise<void> }`, `describeNotifierNotWired(adapter, notifier)`.
  - `describeRunsContract(adapter, open: () => Promise<Runs>)`, `describeRunsNotWired(adapter, runs)`.
  - `createSimHub(): SimHub` (`Hub & { wakes(): readonly string[] }`), `createSimNotifier(): SimNotifier` (`Notifier & { delivered(): readonly Wake[]; failNext(): void }`), `createSimRuns(): Runs`.
  - `hubNotWired`, `notifierNotWired`, `runsNotWired`.

- [ ] **Step 1: Write the contract suites (the failing tests)**

`packages/harness/port-contracts/hub.ts` — `describe(\`hub port contract on ${adapter}\`)` with:
1. `observes a wake for the harness it names and no other`: `await hub.wake(h1)`; `wakes()` contains `h1` and not `h2` (`h1 = 'b3000000-0000-4000-8000-000000000001'`, `h2 = '...0002'`).
2. `takes two wakes in a row for one harness`: two `wake(h1)` calls both resolve to `undefined` and `wakes()` contains `h1` (wakes in one tick may coalesce, P23, so the count is not asserted).
Plus `describeHubNotWired(adapter, hub)` with methods `{ wake: true }`.

`packages/harness/port-contracts/notifier.ts` — fixture:

```ts
const wake: Wake = {
  personId: 'b4000000-0000-4000-8000-000000000001',
  harnessId: 'b4000000-0000-4000-8000-000000000002',
  itemId: 'b4000000-0000-4000-8000-000000000003',
  reason: 'gate_waiting',
  link: '/harness/b4000000-0000-4000-8000-000000000002/gates/b4000000-0000-4000-8000-000000000003',
  traceId: 'b4000000-0000-4000-8000-000000000004',
};
```

Cases:
1. `reports a delivered wake as sent, carrying exactly what it was given`: `notify(wake)` → `'sent'`; `delivered()` `toEqual([wake])`.
2. `reports a failed send as dropped and does not retry it`: `failNext()`; `notify(wake)` → `'dropped'`; `delivered()` is `[]`; a second `notify(wake)` → `'sent'` and `delivered()` has length 1.
3. `carries the person, harness, item, reason, link and trace id and nothing more`: after `notify(wake)`, `Object.keys(delivered()[0]).sort()` equals `['harnessId', 'itemId', 'link', 'personId', 'reason', 'traceId']`.
Plus `describeNotifierNotWired` with `{ notify: true }`.

`packages/harness/port-contracts/runs.ts` — fixture `run(id: string): RunStart` with `harnessId`, `itemId`, `persona: 'builder'`, `runShape: 'workflow-run'`, `engine: 'openrouter-messages'`, `traceId`. Cases (each a fresh `open()` and its own run id):
1. `moves a run through start, hibernate, resume and stop`: `status` after each is `'running'`, `'hibernated'`, `'running'`, `'stopped'`.
2. `answers null for a run it never started`.
3. `refuses to resume a stopped run`: rejects `toMatchObject({ name: 'RunTransitionError', from: 'stopped', action: 'resume' })`.
4. `refuses to start a run id twice`: second `start` rejects with `{ name: 'RunTransitionError', from: 'running', action: 'start' }`.
5. `refuses to hibernate a run it never started`: rejects with `{ name: 'RunTransitionError', from: null, action: 'hibernate' }`.
Plus `describeRunsNotWired` with `{ start: true, hibernate: true, resume: true, stop: true, status: true }`.

Every suite follows the Task 7 shape: `describe` titled `<port> port contract on ${adapter}`, cases calling `await open()`, helpers hoisted, the `satisfies Record<keyof Port, true>` record in the not-wired function.

Sim contract tests: `sim/adapters/hub.contract.test.ts` (`describeHubContract('the recording sim hub', async () => { const hub = createSimHub(); return { hub, wakes: async () => hub.wakes() }; })`), `notifier.contract.test.ts` (likewise with `delivered` and `failNext` wrapped async), `runs.contract.test.ts` (`describeRunsContract('the in-process sim runs', async () => createSimRuns())`). `apps/uw-app/ports/not-wired.contract.test.ts` gains `describeHubNotWired('uw-app until WB-3', hubNotWired)`, `describeNotifierNotWired('uw-app until NT-1', notifierNotWired)`, `describeRunsNotWired('uw-app until HE-1', runsNotWired)`.

Run: `pnpm exec vitest run --project node sim/adapters` → FAIL.

- [ ] **Step 2: Implement the test adapters**

`sim/adapters/hub.ts`:

```ts
import type { Hub } from '@uw/harness';

export type SimHub = Hub & { wakes(): readonly string[] };

export function createSimHub(): SimHub {
  const wakes: string[] = [];
  return {
    wake: async (harnessId) => {
      wakes.push(harnessId);
    },
    wakes: () => [...wakes],
  };
}
```

`sim/adapters/notifier.ts`:

```ts
import type { Notifier, Wake } from '@uw/harness';

export type SimNotifier = Notifier & { delivered(): readonly Wake[]; failNext(): void };

export function createSimNotifier(): SimNotifier {
  const delivered: Wake[] = [];
  let failing = false;
  return {
    notify: async (wake) => {
      if (failing) {
        failing = false;
        return 'dropped';
      }
      delivered.push({ ...wake });
      return 'sent';
    },
    delivered: () => delivered.map((wake) => ({ ...wake })),
    failNext: () => {
      failing = true;
    },
  };
}
```

`sim/adapters/runs.ts`:

```ts
import { RunTransitionError, type RunAction, type Runs, type RunState } from '@uw/harness';

type Transition = { readonly from: readonly (RunState | null)[]; readonly to: RunState };

const transitions: ReadonlyMap<RunAction, Transition> = new Map<RunAction, Transition>([
  ['start', { from: [null], to: 'running' }],
  ['hibernate', { from: ['running'], to: 'hibernated' }],
  ['resume', { from: ['hibernated'], to: 'running' }],
  ['stop', { from: ['running', 'hibernated'], to: 'stopped' }],
]);

export function createSimRuns(): Runs {
  const states = new Map<string, RunState>();
  const move = async (runId: string, action: RunAction): Promise<void> => {
    const from = states.get(runId) ?? null;
    const transition = transitions.get(action);
    if (!transition || !transition.from.includes(from)) {
      throw new RunTransitionError(runId, from, action);
    }
    states.set(runId, transition.to);
  };
  return {
    start: (run) => move(run.runId, 'start'),
    hibernate: (runId) => move(runId, 'hibernate'),
    resume: (runId) => move(runId, 'resume'),
    stop: (runId) => move(runId, 'stop'),
    status: async (runId) => states.get(runId) ?? null,
  };
}
```

- [ ] **Step 3: Implement the platform adapters, not wired**

`apps/uw-app/ports/hub.not-wired.ts`: `export const hubNotWired: Hub = { wake: () => notWiredCall('hub', 'wake') };`
`apps/uw-app/ports/notifier.not-wired.ts`: `export const notifierNotWired: Notifier = { notify: () => notWiredCall('notifier', 'notify') };`
`apps/uw-app/ports/runs.not-wired.ts`: `export const runsNotWired: Runs = { start: () => notWiredCall('runs', 'start'), hibernate: () => notWiredCall('runs', 'hibernate'), resume: () => notWiredCall('runs', 'resume'), stop: () => notWiredCall('runs', 'stop'), status: () => notWiredCall('runs', 'status') };`

- [ ] **Step 4: Run, verify, commit**

Run: `pnpm exec vitest run --project node sim && pnpm exec vitest run --project workers apps/uw-app/ports` → PASS. Then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add packages/harness/port-contracts sim/adapters apps/uw-app/ports
git commit -m "feat(sim): the hub, notifier and runs ports, with contracts run against test and not-wired platform adapters" -m "DX-3 DX-8"
```

---

### Task 9: The Worker composes the kernel over platform adapters

**Proves:** DX-1 (the composition half: `apps/uw-app` constructs the kernel with platform adapters).

**Files:**
- Create: `apps/uw-app/kernel.ts`, `apps/uw-app/kernel.test.ts`, `apps/uw-app/kernel.pg.test.ts`

**Interfaces:**
- Consumes: every adapter in `apps/uw-app/ports/` (Tasks 3, 5 to 8); `DatabaseHandle` (`apps/uw-app/database.ts`); `createKernel`, `Ports`, `Kernel`.
- Produces: `platformPorts(database: DatabaseHandle | null): Ports`, `platformKernel(database: DatabaseHandle | null): Kernel`.

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/kernel.test.ts` (Workers pool):

```ts
import { describe, expect, it } from 'vitest';
import { platformKernel, platformPorts } from './kernel.ts';
import { systemClock } from './ports/clock.ts';
import { connectorsNotWired } from './ports/connectors.not-wired.ts';
import { githubFactsNotWired } from './ports/github-facts.not-wired.ts';
import { grantsNotWired } from './ports/grants.not-wired.ts';
import { hubNotWired } from './ports/hub.not-wired.ts';
import { randomIds } from './ports/ids.ts';
import { modelEngineNotWired } from './ports/model-engine.not-wired.ts';
import { notifierNotWired } from './ports/notifier.not-wired.ts';
import { runsNotWired } from './ports/runs.not-wired.ts';
import { storeNotWired } from './ports/store.not-wired.ts';

const expected = {
  clock: systemClock,
  ids: randomIds,
  store: storeNotWired,
  grants: grantsNotWired,
  githubFacts: githubFactsNotWired,
  connectors: connectorsNotWired,
  modelEngine: modelEngineNotWired,
  hub: hubNotWired,
  notifier: notifierNotWired,
  runs: runsNotWired,
};

function mismatched(): string[] {
  const ports = platformPorts(null);
  return Object.entries(expected)
    .filter(([name, adapter]) => Reflect.get(ports, name) !== adapter)
    .map(([name]) => name);
}

describe('DX-1 the Worker builds the kernel over platform adapters', () => {
  it('uses the platform clock and ids, and not-wired adapters for the services later steps build', () => {
    expect(Object.keys(platformPorts(null))).toEqual(Object.keys(expected));
    expect(mismatched()).toEqual([]);
  });

  it('reports a Worker with no database as a store that is not wired', async () => {
    await expect(platformKernel(null).health()).rejects.toMatchObject({
      name: 'PortNotWiredError',
      port: 'store',
    });
  });
});
```

The comparison is by identity, so a different object with the same shape fails.

`apps/uw-app/kernel.pg.test.ts` (node project):

```ts
import { describe, expect, it } from 'vitest';
import { createClient } from '@uw/db/client';
import { migrationTimestamps } from '@uw/db/journal';
import { testServer, withMigratedDatabase } from '@uw/db/test-database';
import { platformKernel } from './kernel.ts';

describe.skipIf(!testServer)('DX-1 the platform kernel on Postgres', () => {
  it('reads health from the platform clock and the Drizzle store', () =>
    withMigratedDatabase(testServer ?? '', async (target) => {
      const db = createClient(target);
      try {
        const handle = { db, ping: async () => undefined, release: async () => undefined };
        const health = await platformKernel(handle).health();
        expect(health.appliedMigrations).toEqual(migrationTimestamps);
        expect(Math.abs(health.now.getTime() - Date.now())).toBeLessThan(5000);
      } finally {
        await db.$client.end();
      }
    }));
});
```

Run: `pnpm exec vitest run --project workers apps/uw-app/kernel.test.ts` → FAIL (`./kernel.ts` missing).

- [ ] **Step 2: Implement** `apps/uw-app/kernel.ts`

```ts
import { createKernel, type Kernel, type Ports } from '@uw/harness';
import type { DatabaseHandle } from './database.ts';
import { systemClock } from './ports/clock.ts';
import { connectorsNotWired } from './ports/connectors.not-wired.ts';
import { githubFactsNotWired } from './ports/github-facts.not-wired.ts';
import { platformGrants } from './ports/grants.ts';
import { grantsNotWired } from './ports/grants.not-wired.ts';
import { hubNotWired } from './ports/hub.not-wired.ts';
import { randomIds } from './ports/ids.ts';
import { modelEngineNotWired } from './ports/model-engine.not-wired.ts';
import { notifierNotWired } from './ports/notifier.not-wired.ts';
import { runsNotWired } from './ports/runs.not-wired.ts';
import { platformStore } from './ports/store.ts';
import { storeNotWired } from './ports/store.not-wired.ts';

export function platformPorts(database: DatabaseHandle | null): Ports {
  return {
    clock: systemClock,
    ids: randomIds,
    store: database ? platformStore(database.db) : storeNotWired,
    grants: database ? platformGrants(database.db) : grantsNotWired,
    githubFacts: githubFactsNotWired,
    connectors: connectorsNotWired,
    modelEngine: modelEngineNotWired,
    hub: hubNotWired,
    notifier: notifierNotWired,
    runs: runsNotWired,
  };
}

export function platformKernel(database: DatabaseHandle | null): Kernel {
  return createKernel(platformPorts(database));
}
```

No route calls it yet; WB-1, AB-1 and HE-1 build their kernel with `platformKernel(c.var.database)`.

- [ ] **Step 3: Run, verify, commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm exec vitest run apps/uw-app/kernel` → PASS. Then `pnpm verify` (with `TEST_DATABASE_URL`) → green, and `pnpm build` still bundles no Vitest and no PGlite (`grep -cE 'vitest|pglite' apps/uw-app/dist/index.js` prints `0`).

```bash
git add apps/uw-app/kernel.ts apps/uw-app/kernel.test.ts apps/uw-app/kernel.pg.test.ts
git commit -m "feat(uw-app): build the kernel over platform adapters, with not-wired adapters until their step" -m "DX-1"
```

---

### Task 10: The check that every port has a contract run against every adapter

**Proves:** DX-3 (a check fails on a port without a contract test, or an adapter its contract test does not run).

**Files:**
- Create: `tools/architecture/port-contracts.ts`, `tools/architecture/port-contracts.test.ts`

**Interfaces:**
- Consumes: `portNames` from `packages/harness/ports.ts` (imported by relative path, as `owners.test.ts` imports `packages/db`); the conventions in Global Constraints "Ports and adapters".
- Produces: `portContractViolations(ports: readonly string[], tree: SourceTree): string[]`, `SourceTree = { paths: readonly string[]; read(path: string): string }`, `adapterRoots`, `kebab(port)`, `suiteName(port)`.

- [ ] **Step 1: Write the failing test** `tools/architecture/port-contracts.test.ts`

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { portNames } from '../../packages/harness/ports.ts';
import { portContractViolations, type SourceTree } from './port-contracts.ts';

function repoTree(): SourceTree {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  });
  const paths = listed.split('\n').filter((path) => path !== '' && existsSync(path));
  return { paths, read: (path) => readFileSync(path, 'utf8') };
}

function tree(files: Record<string, string>): SourceTree {
  return { paths: Object.keys(files), read: (path) => files[path] ?? '' };
}

const suite = { 'packages/harness/port-contracts/hub.ts': 'export function describeHubContract(' };
const runner = "import { describeHubContract } from '@uw/harness/port-contracts/hub';";

const wired = {
  ...suite,
  'apps/uw-app/ports/hub.not-wired.ts': '',
  'apps/uw-app/ports/hub.contract.test.ts': `${runner} import { hubNotWired } from './hub.not-wired.ts';`,
  'sim/adapters/hub.ts': '',
  'sim/adapters/hub.contract.test.ts': `${runner} import { createSimHub } from './hub.ts';`,
};

describe('DX-3 every port has a contract run against every adapter', () => {
  it('holds for the repository', () => {
    expect(portContractViolations(portNames, repoTree())).toEqual([]);
  });

  it('accepts a port with a suite and a contract test beside each adapter', () => {
    expect(portContractViolations(['hub'], tree(wired))).toEqual([]);
  });

  it('fails on a port with no contract suite', () => {
    expect(portContractViolations(['hub', 'clock'], tree(wired))).toContain(
      'clock: no contract suite at packages/harness/port-contracts/clock.ts',
    );
  });

  it('fails on an adapter no contract test runs', () => {
    const files = { ...wired, 'sim/adapters/hub.recording.ts': '' };
    expect(portContractViolations(['hub'], tree(files))).toContain(
      'sim/adapters/hub.recording.ts: no contract test in sim/adapters/ runs it against the hub contract',
    );
  });

  it('fails on a port with no test adapter', () => {
    const { ['sim/adapters/hub.ts']: _adapter, ...files } = wired;
    expect(portContractViolations(['hub'], tree(files))).toContain('hub: no adapter in sim/adapters/');
  });
});
```

Add two more cases in a second `describe('DX-3 the check refuses a misplaced file')`: an adapter root file `apps/uw-app/ports/helpers.ts` yields `apps/uw-app/ports/helpers.ts: an adapter file must be named for its port`; a contract test that imports `./hub.ts` but not `@uw/harness/port-contracts/hub` leaves `sim/adapters/hub.ts` reported as not run. If the destructuring `_adapter` trips `@typescript-eslint/no-unused-vars`, build `files` with `Object.fromEntries(Object.entries(wired).filter(([path]) => path !== 'sim/adapters/hub.ts'))` instead.

Run: `pnpm exec vitest run --project node tools/architecture/port-contracts.test.ts` → FAIL (`./port-contracts.ts` missing).

- [ ] **Step 2: Implement** `tools/architecture/port-contracts.ts`

```ts
export type SourceTree = { readonly paths: readonly string[]; read(path: string): string };

export const adapterRoots = ['apps/uw-app/ports/', 'sim/adapters/'] as const;
const contractRoot = 'packages/harness/port-contracts/';
const contractTest = /\.contract(\.pg)?\.test\.ts$/;

export function kebab(port: string): string {
  return port.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

export function suiteName(port: string): string {
  return `describe${port.charAt(0).toUpperCase()}${port.slice(1)}Contract`;
}

function directlyIn(tree: SourceTree, root: string): string[] {
  return tree.paths.filter((path) => path.startsWith(root) && !path.slice(root.length).includes('/'));
}

function portOf(file: string, root: string, ports: readonly string[]): string | undefined {
  const base = file.slice(root.length).split('.')[0];
  return ports.find((port) => kebab(port) === base);
}

function suiteViolations(ports: readonly string[], tree: SourceTree): string[] {
  return ports.flatMap((port) => {
    const path = `${contractRoot}${kebab(port)}.ts`;
    if (!tree.paths.includes(path)) return [`${port}: no contract suite at ${path}`];
    const exported = tree.read(path).includes(`export function ${suiteName(port)}(`);
    return exported ? [] : [`${port}: ${path} does not export ${suiteName(port)}`];
  });
}

function runsAdapter(source: string, file: string, port: string): boolean {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return (
    source.includes(`from './${base}'`) &&
    source.includes(`from '@uw/harness/port-contracts/${kebab(port)}'`)
  );
}

function rootViolations(ports: readonly string[], tree: SourceTree, root: string): string[] {
  const files = directlyIn(tree, root);
  const adapters = files.filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'));
  const tests = files.filter((path) => contractTest.test(path));
  const unnamed = adapters
    .filter((file) => portOf(file, root, ports) === undefined)
    .map((file) => `${file}: an adapter file must be named for its port`);
  const missing = ports
    .filter((port) => !adapters.some((file) => portOf(file, root, ports) === port))
    .map((port) => `${port}: no adapter in ${root}`);
  const unrun = adapters.flatMap((file) => {
    const port = portOf(file, root, ports);
    if (port === undefined || tests.some((test) => runsAdapter(tree.read(test), file, port))) return [];
    return [`${file}: no contract test in ${root} runs it against the ${port} contract`];
  });
  return [...unnamed, ...missing, ...unrun];
}

export function portContractViolations(ports: readonly string[], tree: SourceTree): string[] {
  return [
    ...suiteViolations(ports, tree),
    ...adapterRoots.flatMap((root) => rootViolations(ports, tree, root)),
  ];
}
```

Non-contract tests directly in an adapter root (for example `sim/adapters/clock-and-ids.test.ts`) are neither adapters nor contract tests and are ignored.

- [ ] **Step 3: Run, observe it red once, verify, commit**

Run the test → PASS. Prove the repository case can fail: temporarily move `sim/adapters/hub.contract.test.ts` aside (`mv` to the scratch directory), rerun, see `sim/adapters/hub.ts: no contract test in sim/adapters/ runs it against the hub contract`, then move it back. Then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add tools/architecture/port-contracts.ts tools/architecture/port-contracts.test.ts
git commit -m "test(architecture): fail on a port without a contract suite or an adapter its contract does not run" -m "DX-3"
```

---

### Task 11: The world, the scenarios, `pnpm sim` and `pnpm walk`

**Proves:** DX-4 (`pnpm sim -- <scenario>` and `pnpm sim -- all`, scenarios named for requirement IDs, printing the event log and the folded state); DX-5 (`pnpm walk -- <template>`); DX-1 and DX-2 as scenarios (the kernel on the ten test adapters; the Store is Drizzle on an embedded Postgres with the real migrations and constraints).

**Files:**
- Create: `packages/harness/templates.ts`; modify `packages/harness/index.ts`
- Create: `sim/world.ts`, `sim/scenario.ts`
- Create: `sim/runner/discover.ts`, `sim/runner/run.ts`, `sim/runner/report.ts`, `sim/runner/walk-report.ts`
- Create: `sim/runner/discover.test.ts`, `sim/runner/run.test.ts`, `sim/runner/report.test.ts`, `sim/runner/walk-report.test.ts`
- Create: `sim/cli/sim.ts`, `sim/cli/walk.ts`, `sim/cli/cli.test.ts`
- Create: `sim/scenarios/DX-1.kernel-over-test-adapters.ts`, `sim/scenarios/DX-2.store-is-embedded-postgres.ts`
- Modify: `sim/package.json` (add `"@uw/contracts": "workspace:*"`), `package.json` (scripts), `eslint.config.ts`

**Interfaces:**
- Consumes: every sim adapter (Tasks 3, 5 to 8); `createKernel`, `Kernel`, `walk`, `effectPaths`, `WalkStage`, `WalkStep`; `createEmbeddedDatabase`, `closeEmbeddedTemplate`, `EmbeddedDatabase`, `migrationTimestamps`, `pgErrorCode`, `pgConstraint`, `seedGrant`; `HarnessEvent` from `@uw/contracts`.
- Produces: `templates: ReadonlyMap<string, Template>`, `Template = { key: string; title: string; stages: readonly WalkStage[] }` (`@uw/harness`); `worldStart`, `SimAdapters`, `World`, `createWorld(start?: Date): Promise<World>`; `ScenarioReport`, `Scenario`, `defineScenario(scenario)`; `scenarioFilePattern`, `discoverScenarios(directory): Promise<LoadedScenario[]>`; `LoadedScenario`, `ScenarioResult`, `selectScenarios(all, selector)`, `runScenario(loaded, openWorld)`; `formatResult(result): string`; `formatTemplateWalk(template): string`. Root scripts `sim`, `sim:all`, `walk`, `walk:all`.

- [ ] **Step 1: The template registry** `packages/harness/templates.ts`

```ts
import type { WalkStage } from './walk.ts';

export type Template = {
  readonly key: string;
  readonly title: string;
  readonly stages: readonly WalkStage[];
};

export const templates: ReadonlyMap<string, Template> = new Map<string, Template>();
```

Export `templates` and `Template` from `packages/harness/index.ts`. KN-15 (step 3) registers `software` and `bml` here; until then the registry is empty and `pnpm walk -- all` says so.

- [ ] **Step 2: Write the failing tests**

`sim/runner/report.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eventSchema, type HarnessEvent } from '@uw/contracts';
import { formatResult } from './report.ts';

function event(name: HarnessEvent['name'], at: string): HarnessEvent {
  return eventSchema.parse({
    eventId: 'c2000000-0000-4000-8000-000000000001',
    harnessId: 'c2000000-0000-4000-8000-000000000002',
    name,
    at,
    actor: 'human:c2000000-0000-4000-8000-000000000003',
    payload: { stage: 'ship' },
  });
}
```

`eventSchema.parse` brands the actor identity, so no cast is needed. Cases in `describe('DX-4 the sim prints the event log and the folded state')`:

1. A passing result `{ name: 'ZZ-1.fixture', title: 'a fixture', report: { events: [lease_expired at 2026-10-01T09:15:00.000Z, gate_approved at 2026-10-01T09:20:00.000Z], state: { stage: 'ship', holder: null } }, failure: null }` formats exactly as:

```
scenario ZZ-1.fixture: a fixture
events (2):
  1. 2026-10-01T09:15:00.000Z lease_expired human:c2000000-0000-4000-8000-000000000003 {"stage":"ship"}
  2. 2026-10-01T09:20:00.000Z gate_approved human:c2000000-0000-4000-8000-000000000003 {"stage":"ship"}
state:
  {
    "stage": "ship",
    "holder": null
  }
result: pass
```

2. A result with `events: []` prints `events (0):` and no event lines.
3. A failed result `{ name: 'ZZ-2.fixture', title: 'broken', report: null, failure: 'expected 1 to equal 2' }` formats as `scenario ZZ-2.fixture: broken` then `result: fail: expected 1 to equal 2` (two lines, nothing else).
4. A `Date` in the state prints as its whole ISO string.

`sim/runner/discover.test.ts` (`describe('DX-4 scenarios are files named for a requirement ID')`):

1. `discoverScenarios(<repo>/sim/scenarios)` finds `DX-1.kernel-over-test-adapters` and `DX-2.store-is-embedded-postgres`, each `scenario.id` equal to its file's ID prefix.
2. In a temporary directory (`mkdtempSync(join(tmpdir(), 'uw-scenarios-'))`), a file `notes.ts` makes `discoverScenarios` reject with `sim/scenarios holds notes.ts, which is not named <requirement ID>.<slug>.ts` (the message names the file; use the base name only).
3. A file `ZZ-9.mismatch.ts` containing `export const scenario = { id: 'ZZ-1', title: 't', run: async () => ({ events: [], state: {} }) };` rejects with `ZZ-9.mismatch.ts declares scenario ZZ-1; its file name says ZZ-9`.
4. A file `ZZ-8.empty.ts` containing `export const other = 1;` rejects with `ZZ-8.empty.ts exports no scenario`.
5. `*.test.ts` files in the directory are ignored.

`sim/runner/run.test.ts` (`describe('DX-4 running a scenario')`), with in-memory `LoadedScenario` values and the real `createWorld`, and `afterAll(closeEmbeddedTemplate)`:

1. `selectScenarios(all, 'all')` returns all; `selectScenarios(all, 'ZZ-1')` returns every scenario whose `id` is `ZZ-1`; `selectScenarios(all, 'ZZ-1.one')` returns that one; `selectScenarios(all, 'ZZ-7')` returns `[]`.
2. `runScenario` returns the scenario's report and `failure: null` when `run` resolves.
3. When `run` throws `new Error('boom')`, `runScenario` resolves (does not reject) with `report: null`, `failure: 'boom'`, and the world was closed: wrap `createWorld` in an `openWorld` that records `close()` being called and assert the flag (Review Focus 1).

`sim/runner/walk-report.test.ts` (`describe('DX-5 KN-9 walk prints every path to an external effect and the gate each crosses')`): with an inline eight-stage template (the same stages as Task 1's `eightStages`: `package` 10 `none`; `scope` 20 `none`; `plan` 30 `checks`; `build` 40 `checks`; `check` 50 `checks`; `ship` 60 `human_approval` `merge`; `validate` 70 `none` feeds `package`; `close` 80 `checks` feeds `scope`), keyed `fixture` and titled `A fixture template`, `formatTemplateWalk` returns exactly:

```
template fixture (A fixture template): 1 path to an external effect
  1. package [none] > scope [none] > plan [checks] > build [checks] > check [checks] > ship [human_approval, merge]
```

and for a template whose only stage is `stage('post', 10, { exitGate: 'human_approval', connector: 'post', feeds: ['post'] })` it prints `2 paths` with the second line `  2. post [human_approval, post] > post again [human_approval, post]`. A template with no effect stage prints `template <key> (<title>): no path reaches an external effect`.

`sim/cli/cli.test.ts` (`describe('DX-4 DX-5 the sim and walk commands')`), spawning with `spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 60000 })` from the repo root, each asserting `status` (a `null` status means the process hung: fail with the stderr):

1. `sim/cli/sim.ts DX-1` → status 0; stdout contains `scenario DX-1.kernel-over-test-adapters:`, `events (0):`, `state:`, `result: pass` and `1 of 1 scenarios passed`.
2. `sim/cli/sim.ts -- DX-1` → the same (a literal `--` is dropped).
3. `sim/cli/sim.ts all` → status 0; stdout contains `2 of 2 scenarios passed`.
4. `sim/cli/sim.ts ZZ-1` → status 1; stderr contains `no scenario matches ZZ-1; known: DX-1.kernel-over-test-adapters, DX-2.store-is-embedded-postgres`.
5. `sim/cli/sim.ts` with no argument → status 1; stderr contains `usage: pnpm sim -- <scenario | requirement ID | all>`.
6. `sim/cli/walk.ts all` → status 0; stdout is `no templates registered yet\n`.
7. `sim/cli/walk.ts software` → status 1; stderr contains `unknown template software; registered: none`.
8. `sim/cli/walk.ts` → status 1; stderr contains `usage: pnpm walk -- <template | all>`.

Run: `pnpm exec vitest run --project node sim/runner sim/cli` → FAIL (modules missing).

- [ ] **Step 3: Implement the world and the scenario type**

`sim/world.ts`:

```ts
import { createEmbeddedDatabase, type EmbeddedDatabase } from '@uw/db/embedded';
import { createKernel, type Grants, type Kernel, type Runs, type Store } from '@uw/harness';
import { createSimClock, type SimClock } from './adapters/clock.ts';
import { createSimConnectors, type SimConnectors } from './adapters/connectors.ts';
import { createSimGitHubFacts, type SimGitHubFacts } from './adapters/github-facts.ts';
import { createSimGrants } from './adapters/grants.ts';
import { createSimHub, type SimHub } from './adapters/hub.ts';
import { createSimIds, type SimIds } from './adapters/ids.ts';
import { createSimModelEngine, type SimModelEngine } from './adapters/model-engine.ts';
import { createSimNotifier, type SimNotifier } from './adapters/notifier.ts';
import { createSimRuns } from './adapters/runs.ts';
import { createSimStore } from './adapters/store.ts';

export const worldStart = new Date('2026-10-01T09:00:00.000Z');

export type SimAdapters = {
  readonly clock: SimClock;
  readonly ids: SimIds;
  readonly store: Store;
  readonly grants: Grants;
  readonly githubFacts: SimGitHubFacts;
  readonly connectors: SimConnectors;
  readonly modelEngine: SimModelEngine;
  readonly hub: SimHub;
  readonly notifier: SimNotifier;
  readonly runs: Runs;
};

export type World = {
  readonly adapters: SimAdapters;
  readonly database: EmbeddedDatabase;
  readonly kernel: Kernel;
  close(): Promise<void>;
};

function simAdapters(database: EmbeddedDatabase, start: Date): SimAdapters {
  return {
    clock: createSimClock(start),
    ids: createSimIds(),
    store: createSimStore(database),
    grants: createSimGrants(database),
    githubFacts: createSimGitHubFacts(),
    connectors: createSimConnectors(),
    modelEngine: createSimModelEngine(),
    hub: createSimHub(),
    notifier: createSimNotifier(),
    runs: createSimRuns(),
  };
}

export async function createWorld(start: Date = worldStart): Promise<World> {
  const database = await createEmbeddedDatabase();
  const adapters = simAdapters(database, start);
  return { adapters, database, kernel: createKernel(adapters), close: () => database.close() };
}
```

`createKernel(adapters)` is the compile-time proof that the sim adapters satisfy `Ports`. Note: `sim/world.ts` and `sim/scenario.ts` sit directly in `sim/`, not in `sim/adapters/`, so the DX-3 check does not treat them as adapters.

`sim/scenario.ts`:

```ts
import type { HarnessEvent } from '@uw/contracts';
import type { World } from './world.ts';

export type ScenarioReport = {
  readonly events: readonly HarnessEvent[];
  readonly state: Readonly<Record<string, unknown>>;
};

export type Scenario = {
  readonly id: string;
  readonly title: string;
  run(world: World): Promise<ScenarioReport>;
};

export function defineScenario(scenario: Scenario): Scenario {
  return scenario;
}
```

Until KN-3 and KN-4 land, the events a scenario reports come from nowhere but the scenario, and the two step-2 scenarios report none; step 3 makes `events` the item's log read through the one event read path and `state` its `replay`.

- [ ] **Step 4: Implement the runner**

`sim/runner/discover.ts`:

```ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Scenario } from '../scenario.ts';
import type { LoadedScenario } from './run.ts';

export const scenarioFilePattern = /^([A-Z]{2}-\d+)\.([a-z0-9]+(?:-[a-z0-9]+)*)\.ts$/;

function isScenario(value: unknown): value is Scenario {
  if (typeof value !== 'object' || value === null) return false;
  return (
    typeof Reflect.get(value, 'id') === 'string' &&
    typeof Reflect.get(value, 'title') === 'string' &&
    typeof Reflect.get(value, 'run') === 'function'
  );
}

async function load(directory: string, file: string): Promise<LoadedScenario> {
  const match = scenarioFilePattern.exec(file);
  if (!match) {
    throw new Error(`sim/scenarios holds ${file}, which is not named <requirement ID>.<slug>.ts`);
  }
  const module: unknown = await import(pathToFileURL(join(directory, file)).href);
  const scenario: unknown = typeof module === 'object' && module !== null ? Reflect.get(module, 'scenario') : undefined;
  if (!isScenario(scenario)) throw new Error(`${file} exports no scenario`);
  if (scenario.id !== match[1]) {
    throw new Error(`${file} declares scenario ${scenario.id}; its file name says ${match[1]}`);
  }
  return { name: file.slice(0, -'.ts'.length), scenario };
}

export async function discoverScenarios(directory: string): Promise<LoadedScenario[]> {
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .sort();
  const loaded: LoadedScenario[] = [];
  for (const file of files) loaded.push(await load(directory, file));
  return loaded;
}
```

`sim/runner/run.ts`:

```ts
import type { Scenario, ScenarioReport } from '../scenario.ts';
import type { World } from '../world.ts';

export type LoadedScenario = { readonly name: string; readonly scenario: Scenario };

export type ScenarioResult = {
  readonly name: string;
  readonly title: string;
  readonly report: ScenarioReport | null;
  readonly failure: string | null;
};

export function selectScenarios(all: readonly LoadedScenario[], selector: string): LoadedScenario[] {
  if (selector === 'all') return [...all];
  return all.filter((loaded) => loaded.name === selector || loaded.scenario.id === selector);
}

export async function runScenario(
  loaded: LoadedScenario,
  openWorld: () => Promise<World>,
): Promise<ScenarioResult> {
  const { name, scenario } = loaded;
  const world = await openWorld();
  try {
    return { name, title: scenario.title, report: await scenario.run(world), failure: null };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    return { name, title: scenario.title, report: null, failure };
  } finally {
    await world.close();
  }
}
```

`sim/runner/report.ts`:

```ts
import type { HarnessEvent } from '@uw/contracts';
import type { ScenarioResult } from './run.ts';

function eventLine(event: HarnessEvent, index: number): string {
  return `  ${index + 1}. ${event.at} ${event.name} ${event.actor} ${JSON.stringify(event.payload)}`;
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

export function formatResult(result: ScenarioResult): string {
  const head = `scenario ${result.name}: ${result.title}`;
  if (result.report === null) return `${head}\nresult: fail: ${result.failure ?? 'unknown'}`;
  const { events, state } = result.report;
  return [
    head,
    `events (${events.length}):`,
    ...events.map(eventLine),
    'state:',
    indent(JSON.stringify(state, null, 2)),
    'result: pass',
  ].join('\n');
}
```

`sim/runner/walk-report.ts`:

```ts
import { effectPaths, walk, type Template, type WalkStep } from '@uw/harness';

function describeStep(step: WalkStep): string {
  const name = step.revisited ? `${step.key} again` : step.key;
  const exit = step.connector === 'none' ? step.exitGate : `${step.exitGate}, ${step.connector}`;
  return `${name} [${exit}]`;
}

export function formatTemplateWalk(template: Template): string {
  const paths = effectPaths(walk(template.stages));
  const head = `template ${template.key} (${template.title})`;
  if (paths.length === 0) return `${head}: no path reaches an external effect`;
  const noun = paths.length === 1 ? 'path' : 'paths';
  return [
    `${head}: ${paths.length} ${noun} to an external effect`,
    ...paths.map((path, index) => `  ${index + 1}. ${path.steps.map(describeStep).join(' > ')}`),
  ].join('\n');
}
```

- [ ] **Step 5: Implement the CLIs and the scripts**

`sim/cli/sim.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { discoverScenarios } from '../runner/discover.ts';
import { formatResult } from '../runner/report.ts';
import { runScenario, selectScenarios } from '../runner/run.ts';
import { createWorld } from '../world.ts';

const directory = fileURLToPath(new URL('../scenarios/', import.meta.url));

async function main(args: readonly string[]): Promise<number> {
  const selector = args.find((arg) => arg !== '--');
  if (selector === undefined) {
    process.stderr.write('usage: pnpm sim -- <scenario | requirement ID | all>\n');
    return 1;
  }
  const all = await discoverScenarios(directory);
  const chosen = selectScenarios(all, selector);
  if (chosen.length === 0) {
    const known = all.map((loaded) => loaded.name).join(', ');
    process.stderr.write(`no scenario matches ${selector}; known: ${known}\n`);
    return 1;
  }
  let passed = 0;
  for (const loaded of chosen) {
    const result = await runScenario(loaded, () => createWorld());
    process.stdout.write(`${formatResult(result)}\n\n`);
    if (result.failure === null) passed += 1;
  }
  process.stdout.write(`${passed} of ${chosen.length} scenarios passed\n`);
  return passed === chosen.length ? 0 : 1;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} finally {
  await closeEmbeddedTemplate();
}
```

`sim/cli/walk.ts`:

```ts
import { templates, type Template } from '@uw/harness';
import { formatTemplateWalk } from '../runner/walk-report.ts';

function print(chosen: readonly Template[]): void {
  for (const template of chosen) process.stdout.write(`${formatTemplateWalk(template)}\n`);
}

function main(args: readonly string[]): number {
  const selector = args.find((arg) => arg !== '--');
  if (selector === undefined) {
    process.stderr.write('usage: pnpm walk -- <template | all>\n');
    return 1;
  }
  if (selector === 'all') {
    if (templates.size === 0) process.stdout.write('no templates registered yet\n');
    print([...templates.values()]);
    return 0;
  }
  const template = templates.get(selector);
  if (!template) {
    const registered = [...templates.keys()].join(', ') || 'none';
    process.stderr.write(`unknown template ${selector}; registered: ${registered}\n`);
    return 1;
  }
  print([template]);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
```

Root `package.json` `scripts` gain `"sim": "node sim/cli/sim.ts"`, `"sim:all": "node sim/cli/sim.ts all"`, `"walk": "node sim/cli/walk.ts"`, `"walk:all": "node sim/cli/walk.ts all"` (Task 12 joins them to `verify`). `sim/package.json` gains `"@uw/contracts": "workspace:*"`; run `pnpm install`.

In `eslint.config.ts`, add `'sim/runner/**'` and `'sim/cli/**'` to the `files` of the block that turns off `security/detect-non-literal-fs-filename` and `security/detect-object-injection` (it already lists `'tools/**'` and `'**/*.test.ts'`). Never use a directive comment instead.

- [ ] **Step 6: The two scenarios**

`sim/scenarios/DX-1.kernel-over-test-adapters.ts`:

```ts
import assert from 'node:assert/strict';
import { migrationTimestamps } from '@uw/db/journal';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'DX-1',
  title: 'the kernel runs over the ten test adapters, and reads the sim clock and the embedded store',
  run: async (world) => {
    const before = await world.kernel.health();
    world.adapters.clock.advance(15 * 60 * 1000);
    const after = await world.kernel.health();
    assert.equal(before.now.toISOString(), '2026-10-01T09:00:00.000Z');
    assert.equal(after.now.getTime() - before.now.getTime(), 15 * 60 * 1000);
    assert.deepEqual(after.appliedMigrations, migrationTimestamps);
    return {
      events: [],
      state: {
        now: after.now,
        appliedMigrations: after.appliedMigrations.length,
        ports: Object.keys(world.adapters),
      },
    };
  },
});
```

`sim/scenarios/DX-2.store-is-embedded-postgres.ts`: `id: 'DX-2'`, title `the Store is the Drizzle adapter over an embedded Postgres running the real migrations and constraints`. In `run`:
1. `assert.deepEqual(await world.adapters.store.appliedMigrations(), migrationTimestamps)`.
2. Attempt `seedGrant(world.database.db, { id: 'd1000000-0000-4000-8000-000000000001', personId: '00000000-0000-4000-8000-000000000001', role: 'admin', scopeKind: 'jd_area', scopeArea: '80-99', grantedAt: world.adapters.clock.now(), expiresAt: null })`; catch the error and assert `pgErrorCode(error) === '23514'` and `pgConstraint(error) === 'role_grants_area_matches_scope'`; if it does not throw, throw `new Error('the embedded Postgres accepted a grant the CHECK refuses')`.
3. Attempt `world.database.db.update(grantAudit).set({ actor: 'human:sim' })` (import `grantAudit` from `@uw/db/schema`); assert `pgErrorCode(error) === 'P0001'`.
4. Return `{ events: [], state: { appliedMigrations: n, refused: { role_grants_area_matches_scope: '23514', grant_audit_append_only: 'P0001' } } }`.
Hoist each attempt into a top-level `async function refusalOf(work: () => PromiseLike<unknown>): Promise<{ code: string | null; constraint: string | null }>` so `run` stays under the limits.

- [ ] **Step 7: Run the tests and the commands**

Run: `pnpm exec vitest run --project node sim` → PASS. Then `pnpm sim -- DX-1`, `pnpm sim -- all`, `pnpm walk -- all` by hand: each prints as specified and exits on its own (no hang).

- [ ] **Step 8: Verify and commit**

Run `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add packages/harness sim package.json eslint.config.ts pnpm-lock.yaml
git commit -m "feat(sim): the world, scenarios named for requirements, pnpm sim and pnpm walk" -m "Each scenario runs in its own clone of the embedded Postgres and prints its event log and folded state; walk prints every path to an external effect for each registered template (none until KN-15).

DX-1 DX-2 DX-4 DX-5"
```

---

### Task 12: `pnpm trace`, and joining walk, trace and the sim to verify and CI

**Proves:** DX-5 (`pnpm trace` fails on a Must requirement ID not marked Built with neither a scenario nor a test; `walk` and `trace` join `pnpm verify`); DX-4 (`pnpm sim -- all` joins `pnpm verify`).

**Files:**
- Create: `tools/trace/prd.ts`, `tools/trace/tracker.ts`, `tools/trace/proofs.ts`, `tools/trace/trace.ts`, `tools/trace/repository.ts`, `tools/trace/check-trace.ts`, `tools/trace/trace.test.ts`
- Modify: `package.json` (scripts `trace`, `trace:built`; `verify`)
- Modify: `.github/workflows/ci.yml` (own commit, shared root)

**Interfaces:**
- Consumes: `docs/PRD.md` (section 7 tables, section 13), `docs/progress_tracker.md` (the "Status by build-order step" table), the file list from `git ls-files --cached --others --exclude-standard`.
- Produces: `parseRequirements(prd): Requirement[]` (`Requirement = { id: string; priority: 'Must' | 'Later' | 'Built' }`), `parseBuildOrder(prd): BuildStep[]` (`BuildStep = { step: number; ids: readonly string[] }`), `completedSteps(tracker): Set<number>`, `scenarioProofs(paths): string[]`, `testProofs(source): string[]`, `trace(input): TraceReport`, `formatTrace(report): string`, `traceExitCode(report, mode: 'all' | 'built'): 0 | 1`.

**Decision (record in Task 13):** a requirement is *proven* when `sim/scenarios/<ID>.<slug>.ts` exists or a `*.test.ts` file under `apps/`, `packages/`, `tools/` or `sim/` contains a string literal that begins with the ID followed by a space (how every `describe` here is titled; several IDs may lead one title, `'DX-6 DX-2 ...'`). A Must requirement is *due* when the tracker marks its section-13 step `Built` or `Done`, or when section 13 places it in no step (CT-3 today). `pnpm trace` lists every unproven Must requirement and exits 1 if there is any; `pnpm trace:built`, the one `verify` runs, prints the same list and exits 1 only if an unproven requirement is due. When the last step is marked Built the two modes agree, so at the end of the build `verify` fails on any unproven Must requirement.

- [ ] **Step 1: Write the failing test** `tools/trace/trace.test.ts`

Fixtures use the `ZZ-` prefix only. Cases:

`describe('DX-5 trace reads the PRD')`:
1. `parseRequirements` over

```ts
const prd = [
  '## 7. Requirements',
  '| ID | Requirement | Priority | Source |',
  '|---|---|---|---|',
  '| ZZ-1 | Built already. | Built | #1 |',
  '| ZZ-2 | Must one, with `a`, `b` inside. | Must | #2, D4 |',
  '| ZZ-3 | Later. | Later | #3 |',
  '| ZZ-4 | Must two. | Must | architecture.md |',
  '| ZZ-5 | Must three. | Must | #5 |',
  '| ZZ-6 | Must, unplaced. | Must | #6 |',
  '## 13. Build order',
  '',
  '1. **First.** ZZ-1, ZZ-2.',
  '2. **Second.** ZZ-4 to ZZ-5 and ZZ-3: words.',
  '## 14. Release criteria',
  '3. **Not a step.** ZZ-6.',
].join('\n');
```

returns `[{ id: 'ZZ-1', priority: 'Built' }, { id: 'ZZ-2', priority: 'Must' }, { id: 'ZZ-3', priority: 'Later' }, { id: 'ZZ-4', priority: 'Must' }, { id: 'ZZ-5', priority: 'Must' }, { id: 'ZZ-6', priority: 'Must' }]`.
2. `parseBuildOrder(prd)` returns `[{ step: 1, ids: ['ZZ-1', 'ZZ-2'] }, { step: 2, ids: ['ZZ-4', 'ZZ-5', 'ZZ-3'] }]` (ranges expand inclusively, single IDs follow in text order, nothing after the section's end counts).
3. On the real `docs/PRD.md`: step 2's ids are `['DX-1', 'DX-2', 'DX-3', 'DX-4', 'DX-5', 'DX-6', 'DX-8']`; step 11's are `['DX-7']`; `CT-3` is in no step and is `Must`; every ID `parseRequirements` finds is unique.

`describe('DX-5 trace reads the tracker and the proofs')`:
4. `completedSteps` over a fixture table with rows `| 1. First | ZZ-1 | Built | x |`, `| 2. Second | ZZ-4 | done | |`, `| 3. Third | ZZ-9 | Not started | |` and a decisions row `| 2026-10-01 | ZZ-1 | Built | why | cost |` returns `new Set([1, 2])`.
5. `scenarioProofs(['sim/scenarios/ZZ-4.something-real.ts', 'sim/scenarios/notes.ts', 'sim/runner/ZZ-5.x.ts'])` returns `['ZZ-4']`.
6. `testProofs` over the source of three lines `describe('ZZ-2 ZZ-5 two at once', () => {`, `` it(`ZZ-6 in a template ${x}`, ...) ``, and `expect(code).toBe('ZZ-7')` returns `['ZZ-2', 'ZZ-5', 'ZZ-6']` (a bare ID with no following word proves nothing).

`describe('DX-5 trace decides what is due')`:
7. With the fixture PRD, `completed = new Set([1])` and `proven = new Set(['ZZ-2', 'ZZ-4'])`, `trace(...)` returns `{ must: 4, proven: 2, unproven: [{ id: 'ZZ-5', step: 2, due: false }, { id: 'ZZ-6', step: null, due: true }] }` (Built and Later are never counted).
8. `traceExitCode(report, 'built')` is `1` (ZZ-6 is unplaced, so due); with `ZZ-6` proven it is `0` while `traceExitCode(report, 'all')` is still `1` (ZZ-5).
9. `formatTrace` of the report in case 7 is exactly:

```
trace: 4 Must requirements not marked Built; 2 proven, 2 unproven
unproven and due:
  ZZ-6  (in no build-order step)
unproven, step not yet built:
  ZZ-5  (step 2)
```

and a report with nothing unproven prints only the first line.

`describe('DX-5 the repository passes trace in built mode')`:
10. `traceExitCode(repositoryTrace(), 'built')` is `0` (import `repositoryTrace` from `./repository.ts`).

Run: `pnpm exec vitest run --project node tools/trace` → FAIL.

- [ ] **Step 2: Implement**

`tools/trace/prd.ts`:

```ts
export type Priority = 'Must' | 'Later' | 'Built';
export type Requirement = { readonly id: string; readonly priority: Priority };
export type BuildStep = { readonly step: number; readonly ids: readonly string[] };

const requirementRow = /^\| ([A-Z]{2}-\d+) \|.*\| (Must|Later|Built) \| [^|]* \|$/;
const stepLine = /^(\d+)\. \*\*[^*]+\*\*\s*(.*)$/;
const range = /\b([A-Z]{2})-(\d+) to \1-(\d+)\b/g;
const single = /\b[A-Z]{2}-\d+\b/g;
const priorities: ReadonlyMap<string, Priority> = new Map<string, Priority>([
  ['Must', 'Must'],
  ['Later', 'Later'],
  ['Built', 'Built'],
]);

export function parseRequirements(prd: string): Requirement[] {
  return prd.split('\n').flatMap((line) => {
    const match = requirementRow.exec(line);
    const priority = priorities.get(match?.[2] ?? '');
    return match?.[1] && priority ? [{ id: match[1], priority }] : [];
  });
}

function section(text: string, heading: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return end === -1 ? rest : rest.slice(0, end);
}

function idsIn(text: string): string[] {
  const expanded = [...text.matchAll(range)].flatMap(([, prefix, from, to]) =>
    Array.from({ length: Number(to) - Number(from) + 1 }, (_, offset) => `${prefix}-${Number(from) + offset}`),
  );
  const singles = text.replace(range, ' ').match(single) ?? [];
  return [...expanded, ...singles];
}

export function parseBuildOrder(prd: string): BuildStep[] {
  return section(prd, '## 13. Build order').flatMap((line) => {
    const match = stepLine.exec(line);
    return match?.[1] ? [{ step: Number(match[1]), ids: idsIn(match[2] ?? '') }] : [];
  });
}
```

`tools/trace/tracker.ts`:

```ts
const stepRow = /^\| (\d+)\. [^|]*\| [^|]*\| ([^|]*?) \|/;
const doneStates: ReadonlySet<string> = new Set(['built', 'done']);

export function completedSteps(tracker: string): Set<number> {
  const done = tracker.split('\n').flatMap((line) => {
    const match = stepRow.exec(line);
    return match?.[1] && doneStates.has((match[2] ?? '').trim().toLowerCase()) ? [Number(match[1])] : [];
  });
  return new Set(done);
}
```

`tools/trace/proofs.ts`:

```ts
const scenarioFile = /^sim\/scenarios\/([A-Z]{2}-\d+)\.[a-z0-9]+(?:-[a-z0-9]+)*\.ts$/;
const titled = /['"`]((?:[A-Z]{2}-\d+ )+)/g;

export const provingTestFile = /^(?:apps|packages|tools|sim)\/.*\.test\.ts$/;

export function scenarioProofs(paths: readonly string[]): string[] {
  return paths.flatMap((path) => {
    const match = scenarioFile.exec(path);
    return match?.[1] ? [match[1]] : [];
  });
}

export function testProofs(source: string): string[] {
  return [...source.matchAll(titled)].flatMap(([, ids]) => (ids ?? '').trim().split(' '));
}
```

`tools/trace/trace.ts`:

```ts
import type { BuildStep, Requirement } from './prd.ts';

export type Unproven = { readonly id: string; readonly step: number | null; readonly due: boolean };
export type TraceReport = {
  readonly must: number;
  readonly proven: number;
  readonly unproven: readonly Unproven[];
};
export type TraceInput = {
  readonly requirements: readonly Requirement[];
  readonly steps: readonly BuildStep[];
  readonly completed: ReadonlySet<number>;
  readonly proven: ReadonlySet<string>;
};

export function trace(input: TraceInput): TraceReport {
  const stepOf = new Map(input.steps.flatMap((step) => step.ids.map((id) => [id, step.step] as const)));
  const must = input.requirements.filter((requirement) => requirement.priority === 'Must');
  const unproven = must
    .filter((requirement) => !input.proven.has(requirement.id))
    .map((requirement) => {
      const step = stepOf.get(requirement.id) ?? null;
      return { id: requirement.id, step, due: step === null || input.completed.has(step) };
    });
  return { must: must.length, proven: must.length - unproven.length, unproven };
}

function line(entry: Unproven): string {
  return `  ${entry.id}  (${entry.step === null ? 'in no build-order step' : `step ${entry.step}`})`;
}

export function formatTrace(report: TraceReport): string {
  const head = `trace: ${report.must} Must requirements not marked Built; ${report.proven} proven, ${report.unproven.length} unproven`;
  const due = report.unproven.filter((entry) => entry.due);
  const later = report.unproven.filter((entry) => !entry.due);
  return [
    head,
    ...(due.length > 0 ? ['unproven and due:', ...due.map(line)] : []),
    ...(later.length > 0 ? ['unproven, step not yet built:', ...later.map(line)] : []),
  ].join('\n');
}

export function traceExitCode(report: TraceReport, mode: 'all' | 'built'): 0 | 1 {
  const failing = mode === 'all' ? report.unproven : report.unproven.filter((entry) => entry.due);
  return failing.length === 0 ? 0 : 1;
}
```

`tools/trace/repository.ts` (the real inputs, shared by the entry script and test case 10):

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseBuildOrder, parseRequirements } from './prd.ts';
import { provingTestFile, scenarioProofs, testProofs } from './proofs.ts';
import { completedSteps } from './tracker.ts';
import { trace, type TraceReport } from './trace.ts';

export function repositoryTrace(): TraceReport {
  const prd = readFileSync('docs/PRD.md', 'utf8');
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  });
  const paths = listed.split('\n').filter((path) => path !== '' && existsSync(path));
  const fromTests = paths
    .filter((path) => provingTestFile.test(path))
    .flatMap((path) => testProofs(readFileSync(path, 'utf8')));
  return trace({
    requirements: parseRequirements(prd),
    steps: parseBuildOrder(prd),
    completed: completedSteps(readFileSync('docs/progress_tracker.md', 'utf8')),
    proven: new Set([...scenarioProofs(paths), ...fromTests]),
  });
}

```

`tools/trace/check-trace.ts` (the entry script; the root `knip.json` entry `tools/*/check-*.ts` already covers it):

```ts
import { repositoryTrace } from './repository.ts';
import { formatTrace, traceExitCode } from './trace.ts';

const report = repositoryTrace();
process.stdout.write(`${formatTrace(report)}\n`);
process.exitCode = traceExitCode(report, process.argv.includes('--built') ? 'built' : 'all');
```

Root `package.json` `scripts` gain `"trace": "node tools/trace/check-trace.ts"` and `"trace:built": "node tools/trace/check-trace.ts --built"`, and `verify` becomes:

```
pnpm check && pnpm lint && pnpm lint:dates && pnpm lint:vendor && pnpm format:check && pnpm knip && pnpm architecture && pnpm walk:all && pnpm trace:built && pnpm test && pnpm sim:all && pnpm build
```

- [ ] **Step 3: CI, in its own commit**

`tools/ci/ci-workflow.test.ts` already asserts every step of `verify` is a `- run: pnpm <step>` line in `ci.yml`; run it now → FAIL naming `walk:all`, `trace:built`, `sim:all`. In `.github/workflows/ci.yml`, the `architecture` job's steps become `- run: pnpm architecture`, `- run: pnpm walk:all`, `- run: pnpm trace:built`; the `test` job gains `- run: pnpm sim:all` after `- run: pnpm test`. Job names do not change (they are the check-run contract).

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run walk and trace in the architecture job and every scenario in the test job" -m "Shared root: .github/workflows/ci.yml. PRD DX-4 and DX-5 put sim -- all, walk and trace in pnpm verify, and CI runs every step of verify. No job is added or renamed; none needs a secret.

DX-4 DX-5"
```

- [ ] **Step 4: Run, verify, commit**

Run: `pnpm exec vitest run --project node tools` → PASS. `pnpm trace` prints the list and exits 1 (the KN, AB, GH, WB, HE, NT and PE requirements and DX-7 are unproven and not yet due); `pnpm trace:built` exits 0. Then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add tools/trace package.json
git commit -m "feat(tools): pnpm trace lists every unproven Must requirement, and verify fails on one whose step is built" -m "verify now also runs walk:all and sim:all.

DX-4 DX-5"
```

---

### Task 13: Nothing needs a live account; the cockpit; the tracker

**Proves:** DX-8 (no test, helper or scenario reads an environment variable but `TEST_DATABASE_URL`, `CI` and `PATH`; every platform adapter that talks to a live service is listed as awaiting live verification). Records step 2 in `docs/progress_tracker.md` and so moves `pnpm trace:built` to enforce DX-1 to DX-6 and DX-8.

**Files:**
- Create: `tools/architecture/no-live-account.test.ts`
- Modify: `AGENTS.md` (own commit, shared root), `docs/architecture.md`, `docs/progress_tracker.md`

**Interfaces:**
- Consumes: the file list from `git ls-files`; `adapterRoots` (Task 10); `docs/progress_tracker.md`.

- [ ] **Step 1: Write the failing test** `tools/architecture/no-live-account.test.ts`

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const allowed = new Set(['TEST_DATABASE_URL', 'CI', 'PATH']);
const envRead = /process\.env(?:\[['"]([A-Z0-9_]+)['"]\]|\.([A-Z0-9_]+))/g;
const testCode = /(?:\.test\.ts$|^sim\/|^packages\/db\/test-[a-z-]+\.ts$|^apps\/[^/]+\/testing\/)/;

function listed(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  });
  return out.split('\n').filter((path) => path !== '' && existsSync(path));
}

function forbiddenEnvReads(path: string, source: string): string[] {
  return [...source.matchAll(envRead)]
    .map((match) => match[1] ?? match[2] ?? '')
    .filter((name) => !allowed.has(name))
    .map((name) => `${path} reads ${name}`);
}

function waitingSection(): string {
  const tracker = readFileSync('docs/progress_tracker.md', 'utf8');
  return tracker.slice(tracker.indexOf('## Waiting on a person'));
}

const platformAdapters = () =>
  listed().filter((path) => /^apps\/uw-app\/ports\/[^/]+\.ts$/.test(path) && !path.endsWith('.test.ts'));

describe('DX-8 no test, helper or scenario needs a live account or a secret', () => {
  it('reads no environment variable but TEST_DATABASE_URL, CI and PATH', () => {
    const found = listed()
      .filter((path) => testCode.test(path) && path.endsWith('.ts'))
      .flatMap((path) => forbiddenEnvReads(path, readFileSync(path, 'utf8')));
    expect(found).toEqual([]);
  });

  it('fails on a planted read of a secret', () => {
    expect(forbiddenEnvReads('x.test.ts', "const key = process.env['NEON_API_KEY'];")).toEqual([
      'x.test.ts reads NEON_API_KEY',
    ]);
  });
});

describe('DX-8 every platform adapter is accounted for in the tracker', () => {
  it('lists each wired adapter that reaches a live service under Waiting on a person', () => {
    const live = platformAdapters().filter(
      (path) => !path.endsWith('.not-wired.ts') && !/\/(clock|ids)\.ts$/.test(path),
    );
    expect(live.filter((path) => !waitingSection().includes(path))).toEqual([]);
  });

  it('names each not-wired adapter in the tracker with the step that wires it', () => {
    const tracker = readFileSync('docs/progress_tracker.md', 'utf8');
    const missing = platformAdapters().filter(
      (path) => path.endsWith('.not-wired.ts') && !tracker.includes(path),
    );
    expect(missing).toEqual([]);
  });
});
```

Run `pnpm exec vitest run --project node tools/architecture/no-live-account.test.ts` → the two tracker cases FAIL (the adapters are not listed yet); the environment cases PASS.

- [ ] **Step 2: The cockpit text, in its own commit**

In `AGENTS.md` section 2, replace the sentence "`sim`, `walk` and `trace` do not exist yet; building them is PRD DX-4 and DX-5, and until then they are the contract for what must be provided." with "`pnpm verify` runs `pnpm walk:all`, `pnpm trace:built` and `pnpm sim:all`; `trace:built` fails only on an unproven Must requirement whose build-order step the progress tracker marks Built, and `pnpm trace` lists every unproven one." and add to the command block, after the `pnpm trace` line:

```
pnpm trace:built           the same list; fails only on requirements whose step is marked Built
```

```bash
git add AGENTS.md
git commit -m "docs(agents): the cockpit commands exist, and how trace gates verify while the build is in progress" -m "Shared root: AGENTS.md. Section 2 said sim, walk and trace did not exist; step 2 built them.

DX-4 DX-5"
```

- [ ] **Step 3: `docs/architecture.md`**

In "The layout" add the lines `apps/uw-app/ports/      platform adapters, one file per port (or port.variant), each beside its contract test`, `packages/db/store/      the one Drizzle implementation of Store and Grants that both adapters bind`, `sim/adapters/           test adapters, one file per port, each beside its contract test`. In "The sim", replace `createSimHarness(template, fixture)` and `createWorld()` description with: "`createWorld()` gives a scenario one clone of an embedded Postgres migrated once per process, the ten test adapters, one settable clock starting `2026-10-01T09:00:00.000Z`, and `createKernel` over them; `createSimHarness(template, fixture)` arrives with the templates in step 3." Under "Every rule is a check", the port-contract row's check becomes "`tools/architecture/port-contracts.test.ts`: each port has a suite in `packages/harness/port-contracts/`, an adapter in `apps/uw-app/ports/` and in `sim/adapters/`, and a contract test beside each adapter that runs it", and add a row "Nothing needs a live account | `tools/architecture/no-live-account.test.ts`".

- [ ] **Step 4: `docs/progress_tracker.md`**

Status row for step 2: state `Built`; evidence `docs/superpowers/plans/2026-10-01-step-02-kernel-frame.md`; tests named DX-1 to DX-6 and DX-8 (`packages/harness/kernel.test.ts`, `apps/uw-app/kernel.test.ts`, `apps/uw-app/kernel.pg.test.ts`, `packages/db/both-targets.test.ts`, `packages/db/store/store.test.ts`, `packages/db/store/store-lock.test.ts`, every `*.contract*.test.ts`, `tools/architecture/port-contracts.test.ts`, `sim/runner/*.test.ts`, `sim/cli/cli.test.ts`, `tools/trace/trace.test.ts`, `tools/architecture/no-live-account.test.ts`); scenarios `DX-1`, `DX-2`; `pnpm verify` green with `TEST_DATABASE_URL` set. KN-9 also built. Add a "Step 2 evidence by requirement" table in the step-1 table's form (requirement, commits, tests), filled from `git log`.

"Decisions made during the build", one row each, dated 2026-10-01, with requirement, decision, why and cost if wrong:

| Requirement | Decision | Why | Cost if wrong |
|---|---|---|---|
| KN-9 DX-5 | `walk(stages)` is built in step 2, not step 3; the walker includes the revisited stage as the last step of a path (`revisited: true`) and refuses duplicate keys, duplicate positions and dangling feeds with `WalkError` | `pnpm walk` cannot print a path without the walker; keeping the revisit makes each loop edge visible and every path distinct | KN-10 may want the cut stage left out; a one-line change in `visit` |
| DX-5 | `pnpm trace` is strict; `pnpm trace:built`, the one in `verify`, fails only on unproven Must requirements whose section-13 step the tracker marks Built or Done, or that section 13 places in no step | The build in progress must be honest without being red; the final step makes the two modes equal | A step marked Built too early makes verify red, which is the intent |
| DX-5 | A requirement is proven by a scenario file `sim/scenarios/<ID>.<slug>.ts` or a test-file string literal that begins with the ID and a space; fixtures use the `ZZ-` prefix | Matches how every test is titled; mechanical | Presence, not adequacy: a test titled with an ID that does not test it passes trace; review catches that |
| DX-1 | In step 2 the kernel is `{ walk, health }`; `health()` reads the clock and the Store's applied migrations; modules arrive as new `Kernel` members from step 3 | The frame needs one call that crosses ports, and DX-1 must be observable in the sim and the Worker | None known |
| DX-2 | The one Drizzle implementation of Store and Grants lives in `packages/db/store/`; `apps/uw-app/ports/` and `sim/adapters/` bind it with the port type; AGENTS.md rule 2 amended | DX-2 requires the same adapter; sim and apps may not import each other | A port shape change needs edits in `packages/db/store` and both bindings; the typecheck finds them |
| DX-2 | The sim migrates one PGlite template per process and clones it per world (about 2 s, then 0.4 s each); `closeEmbeddedTemplate` must be called or Node stays alive | Speed; one migration run per process | If `clone()` regresses in a PGlite release, fall back to migrating per world (slower) |
| DX-2 DX-6 | `@electric-sql/pglite` 0.5.8 (Postgres 18.3) is used with drizzle-orm 0.45.3, whose dev pin is pglite 0.2.12; migrate, select, transactions, triggers, CHECKs, advisory locks, `FOR SHARE`, `CREATE ROLE` and `clone()` were tried before choosing it | The current release; the drizzle pglite driver uses only its stable API | A drizzle or pglite release that breaks the pair; pin exact versions then |
| DX-3 | A port whose service arrives later has a platform adapter that is not wired (every method returns `notWiredCall`) and a contract test that proves exactly that; the kernel will report `PortNotWiredError` as `not_wired` | AGENTS.md rule 1 asks for platform adapter, test adapter and contract together | Each later step must swap the not-wired adapter and run the full contract against the real one |
| DX-3 | Adapter roots are `apps/uw-app/ports/` and `sim/adapters/`; files are named for the port's kebab key; the DX-3 check reads imports as text | Discovery by convention; no registry to keep in sync | HE-2 puts engines in `apps/uw-app/engines/<key>/`; that step adds the directory as an adapter root for `modelEngine` |
| DX-3 | Contract suites live in `packages/harness/port-contracts/` and import Vitest; a dependency-cruiser rule allows only that and forbids any non-test app or sim file importing them | Both apps and sim must import the suites, and only harness is reachable from both | None known |
| DX-1 DX-3 | The Grants port takes the instant (`resolve(personId, at)`, `lockAndReread(tx, personId, at)`); the step-1 grant commands and Access middleware keep the database clock | The sim's clock is not the wall clock; expiry must be judged on the kernel's clock | A grant expiring between the two clocks is judged differently by the edge and the kernel for that instant |
| DX-1 | The step-1 read functions in `apps/uw-app/acl/grant-store.ts` moved to `packages/db/store/grants.ts` (the step-1 decision said the Grants adapter would wrap the old file) | The sim must run the same queries | None |
| DX-1 | Port value shapes for GitHubFacts, Connectors, ModelEngine, Hub, Notifier and Runs are fixed in `ports.ts` now; `WakeReason` lives there until NT-2 publishes the wake payload as a contract | The frame must exist before the services | Steps 5 to 9 may reshape a port: a shared-root commit and its two adapters |
| DX-4 | A scenario returns `{ events, state }`; step-2 scenarios report no events, since the event log arrives with KN-3; the printer is proven on contract-valid fixture events | Honest until the log exists | None |
| DX-4 | `sim/` imports only harness, contracts, db and Node built-ins (tests also Vitest), enforced by dependency-cruiser | AGENTS.md rule 2 | None |
| DX-4 | Sim ids are `00000000-0000-4000-a000-<n>` | Clear of the bootstrap migration's `...-8000-...` ids | None |
| DX-6 | `databaseTargets` runs one test on the embedded Postgres and on the server; `pgConstraint` reads `constraint_name` (postgres.js) or `constraint` (PGlite) | DX-6 runs KN-2 and KN-3 on both; KN-18 must report the database's reason in the sim | None known |
| DX-6 | The KN-5 and KN-14 two-connection races land with their tables in step 3; step 2 proves the Store lock serialises two connections | The tables are step 3 | None |
| DX-1 | The step-1 platform modules (people, acl, pages, deliveries, watermarks) keep their Drizzle handle; their exceptions rows are marked revisited | They are platform modules; the Store port carries what the kernel reaches | A kernel module needing those tables reads through the owner's functions |
| DX-8 | `packages/db/test-seed.ts` writes `people` and `role_grants` fixture rows, recorded in `docs/exceptions.md` | Tests and the sim need people before the code under test runs | Misuse outside tests and the sim; the exception's review line names the check |

"New dependencies": `| 2026-10-01 | @electric-sql/pglite (packages/db) | A hand-written in-memory Store for the sim: the sim's Store is real Postgres 18 compiled to WASM, running the real migrations |`.

"Not verified":

| Requirement | What was not verified | Why |
|---|---|---|
| DX-2 DX-6 | PGlite is Postgres 18.3, the CI service container is Postgres 16, Neon is whatever the project runs; a behaviour difference between versions would show on only one | No version-matched embedded build exists |
| DX-2 | `appliedMigrations` reads `drizzle.__drizzle_migrations`; the Neon application role's SELECT on the `drizzle` schema is untested | No Neon project |
| DX-3 | The six not-wired platform adapters (`apps/uw-app/ports/github-facts.not-wired.ts` until GH-2, `connectors.not-wired.ts` until GH-6, `model-engine.not-wired.ts` until HE-2, `hub.not-wired.ts` until WB-3, `notifier.not-wired.ts` until NT-1, `runs.not-wired.ts` until HE-1) and `store.not-wired.ts`, `grants.not-wired.ts` (used while uw-app has no database, FD-12) are proven only to be not wired | Their services are built in later steps |

(Write each not-wired adapter's full path in that row, so the DX-8 test finds it.)

"Waiting on a person":

| Requirement | What is written | What is needed to verify it live | From whom |
|---|---|---|---|
| DX-2 DX-3 | `apps/uw-app/ports/store.ts` and `apps/uw-app/ports/grants.ts`, the platform Store and Grants over Hyperdrive, proven on the CI Postgres service container | Hyperdrive configs and the Neon database (FD-12's switch-on) | Ian |

- [ ] **Step 5: Run, verify, commit**

Run: `pnpm exec vitest run --project node tools/architecture` → PASS. `pnpm trace:built` → exits 0 with step 2 now due (every one of DX-1 to DX-6 and DX-8 is proven). Then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add tools/architecture/no-live-account.test.ts docs/architecture.md docs/progress_tracker.md
git commit -m "test(architecture): nothing needs a live account; record step 2, the kernel's frame, as built" -m "DX-1 DX-2 DX-3 DX-4 DX-5 DX-6 DX-8 KN-9"
```

- [ ] **Step 6: Observe the trace gate red once**

After the commit, change the step 3 row's state in `docs/progress_tracker.md` to `Built`, run `pnpm trace:built`, and see it exit 1 with the KN requirements under `unproven and due:`. Restore the committed file with `git checkout docs/progress_tracker.md` and confirm `git status` is clean and `pnpm trace:built` exits 0 again. This is the end of step 2.
