# Architecture: the harness in the platform

How the harness code is shaped so that an agent can hold the whole of it, prove it works without a deployed Worker, and change one place to change one thing. Words are defined in [`CONTEXT.md`](../CONTEXT.md); what to build is in [`PRD.md`](PRD.md); the design and why is in [the spec](../prd/Harness%20v1%20-%20Architecture.md); why the shape is this way is in [`adr/`](adr/). The platform the harness sits in is designed in [the plan](../prd/An%20App%20For%20Everything%20-%20Platform%20Architecture%20Plan.md).

## The layout

```
apps/uw-app/            Hono on Cloudflare Workers: SSR pages and islands, command API,
                        MCP surface, live hub (Durable Object), Workflows, crons
apps/uw-app/ports/      platform adapters, one file per port (or port.variant), each beside its contract test
apps/uw-ingest/         webhook verification and enqueue; nothing else
packages/harness/       the kernel: pure TypeScript over ports; no Worker, vendor or
                        database import; the stage machine, ship rule, replay, walker
packages/contracts/     commands, events, outcomes and the verb registry as Zod; one
                        live version, golden fixtures, conformance test
packages/db/            Drizzle schema (the source of truth), migrations, constraints
packages/db/store/      the one Drizzle implementation of Store and Grants that both adapters bind
packages/core/          acl (can, principal), dates, modules registry, shared Zod schemas
packages/ui/            design tokens as CSS and the Tailwind theme built from them
sim/                    test adapters for every port, fixture harnesses, scenarios, CLI
sim/adapters/           test adapters, one file per port, each beside its contract test
infra/                  wrangler configs, Access policies, environments; declared, never clicked
```

The listing is by role, not by import direction. Dependencies form this DAG, and dependency-cruiser and ESLint enforce exactly it:

```
packages/contracts  → nothing
packages/core       → contracts
packages/db         → contracts, core
packages/ui         → nothing
packages/harness    → contracts, core            (types only; no side effects)
apps/uw-app         → harness, db, contracts, core, ui      composition root
apps/uw-ingest      → contracts, core, db                   composition root
sim/                → harness, contracts, db                composition root
```

`apps/uw-app` and `sim/` are the composition roots that construct the kernel with adapters. `apps/uw-ingest` is a root too, but it never touches the kernel: it verifies webhooks and enqueues, and the queue consumer inside `uw-app` is what hands the event to the kernel. `packages/harness` is the pure layer: it may import `packages/contracts` and `packages/core` types and nothing with side effects. Everything durable is in Postgres through the Store port; nothing in the kernel knows it is Postgres. `sim/` imports `packages/db` because its Store adapter runs the real schema and migrations.

## The kernel over ports

```ts
createKernel(ports: Ports): Kernel

Kernel = {
  walk(stages): WalkPath[],
  templateProperty, shipRule, replay,
  events, items, repair, stages, delegations, gates,
  health(),
}
```

"Kernel" is the pure core. "Engine" means only the code behind the model-vendor seam (`claude-messages` and the rest).

One composition root per process. The Worker calls `createKernel` once with platform adapters. A test or the sim calls it many times with test adapters. Nothing else constructs a module. The kernel reaches everything outside itself through a port, the database included:

| Port | Provides | Platform adapter | Test adapter |
|---|---|---|---|
| Clock | now | `Date.now` | settable, advanceable |
| Ids | next id | `crypto.randomUUID` | sequential |
| Store | rows of every harness table, in transactions | Drizzle over Hyperdrive to Neon | the same Drizzle adapter over an embedded Postgres (PGlite) running the real migrations from `packages/db` |
| Grants | resolve a principal's grants; lock and re-read them | `role_grants` with `SELECT ... FOR SHARE` | the same queries on the embedded Postgres, with a scripted revoke |
| GitHubFacts | PR state, head, checks, reviews for a head commit | the `gh_*` read model | fixture facts per commit |
| Connectors | merge, deploy, publish, send, post | GitHub App and deploy tokens in the host step | records calls |
| ModelEngine | one persona turn: tool calls over the verb registry | the six engines, each in its own directory | scripted tool calls |
| Hub | wake a harness's clients | the Durable Object | records wakes |
| Notifier | web push and the Zulip thread | push service and Zulip REST | records wakes |
| Runs | start, resume, hibernate a run | Cloudflare Workflows | an in-process loop |

Every port has a platform adapter and a test adapter, and may have more than one platform adapter: ModelEngine has six. Validators are a registry inside the kernel, picked by key from a stage row; they are kernel code, not a port.

**One contract test per port.** Each port has one shared test suite that runs against every adapter of that port, so a test adapter and a platform adapter cannot drift. A port without a contract test fails a check.

**No hand-written database.** The Store test adapter is real Postgres semantics: the real schema, the real migrations, the real constraints and triggers. Nothing in the sim imitates a table.

**What only real Postgres can prove, and where each runs:**

| Guarantee | Embedded Postgres, in the sim and unit tests | Postgres service container in CI |
|---|---|---|
| The null-safe stage check: `('merge','checks')` and `('merge', NULL)` refused on insert and update | yes | yes |
| `harness_events` refuses UPDATE and DELETE; positions are assigned in order under a per-harness lock held to commit | yes | yes, with two connections for the position order; the `uw_app` role's missing UPDATE, DELETE and TRUNCATE grants |
| Claim is one conditional UPDATE: a second claim on a held item is refused | yes, sequentially | yes, with N concurrent connections |
| WIP limit: the count and the claim are one transaction | yes, sequentially | yes, with two claims racing one slot |
| The gate decision's locked grant re-read: revoke then decide, and decide then revoke | no; it needs two connections | yes |

PGlite is a single connection, so every test that races two connections runs against a Postgres server: the service container in CI, or any server `TEST_DATABASE_URL` points at locally. Neither needs an account or a secret; the Neon branch per pull request is go-live wiring (PRD FD-12).

## What is durable, and who writes it

Every durable value has one writer. The Drizzle schema declares every table with its classification (plan §2.6) and the kernel module that owns it.

| Table | Written by | Notes |
|---|---|---|
| `harnesses`, `harness_stages` | the stage command | `admin(area)` only; never through `write_page`; the Ship invariant is a check constraint |
| `harness_items` | the kernel | stage, holder, lease, risk tier and domains, expected head |
| `harness_events` | the kernel, append-only | closed vocabulary from `packages/contracts`; the source of truth |
| `harness_runs` | the run shape | host, engine, steps, tokens, cost basis |
| `gate_decisions` | the gate command, human principals only | seven-year retention; grants locked in the same transaction |
| `delegations` | the delegation command, `admin(area)` only | checked at every beat |
| `personas` | the persona page type | a page; the table is its projection |
| `measurements` | the Validate stage | public-side sources only in v1 |
| `pages`, `page_versions` | the page API and `write_page` | plan §2; harness stage rows are not pages |
| `role_grants` | the grants command | plan §4; audit-logged |
| `gh_*` | the GitHub read-model module in `uw-app`, called by both the webhook consumer and the nightly sweep | one writer, two entry points; GitHub is the source of truth |
| `push_subscriptions`, `push_cooldowns` | the notifier | per person |

## Transactions and locks

A kernel command opens one transaction (`ports.store.transaction`) and passes the transaction object as-is to everything it calls; transactions never nest. A second transaction opens only after the first has settled: to record a refusal after Postgres aborted the first (`stage_edit_refused`), or to record a connector's outcome after the decision committed. The lease sweep lists lapsed leases in one transaction and expires each item in its own.

Locks are taken in one order, and none after the first event append:

1. **The stage lock.** The stage command and activation take `harness-stages:<harnessId>` before anything else and read the stage rows after it, so two edits of one harness serialise and neither writes back a row the other changed. Claim, take over and the gate decision take `harness-stage-claims:<stageId>` and re-read the stage after it, so the WIP count and the claim are one serial step. No command takes both.
2. **The item row.** `harnessItems.read.lock` (`SELECT ... FOR UPDATE`), and `recordItemEvents` folds the locked row.
3. **Grants.** `grants.lockAndReread` (`FOR SHARE` on the person's `role_grants`) where a revoke must wait for the command (the stage and gate commands); `grants.resolveIn`, a plain read in the same transaction, for the write-level checks of the item commands.
4. **Appends.** The `harness_events` insert trigger takes `harness_events:<harnessId>` and holds it to commit, so positions become visible in order. Taking any lock after it would hold the harness's append lock while waiting.

Persona activation has no stage to lock, so it takes `persona-activation:<pageId>` first; a second activation of the same page waits there and then reads the item the first opened, so a missing verb opens one open item per persona page and verb however many attempts race. It then re-reads the activator's grants (`FOR SHARE`), reads what it needs, and takes `harness_events:<harnessId>` for the persona's harness and then for the software harness before the first append; its appends go in that order, the `persona_activation_failed` event first and the software item after it.

Where there is no row to lock, a unique constraint is the guard: `delegations_supersedes_once` lets one renewal of a dead delegation insert and the command maps the other's violation to `stale_version`.

**Isolation is READ COMMITTED**, Postgres's default; nothing sets another level. The WIP count after the stage-claims lock and the stage re-read after the harness-stages lock rely on each statement seeing what committed before it began. Under REPEATABLE READ the snapshot is fixed at the transaction's first statement, so a count or re-read after a lock wait would miss the commit it waited for, and both the WIP limit and the lost-update guard would silently fail.

**One key space.** Every advisory lock is `pg_advisory_xact_lock(hashtextextended(key, 0))` over a string key, built by `advisoryLock(key)` in `packages/db/advisory-locks.ts` (the Drizzle store's `tx.lock` and the platform's grant commands and page re-parent use it; the event trigger writes the same expression in SQL). That file is the registry: the platform keys `acl-grant-commands` and `pages-reparenting`, and the prefixes `harness-stage-claims:`, `harness-stages:`, `harness_events:` and `persona-activation:`. Its tests fail if one key is a prefix of another, if a kernel lock key's prefix is not registered, or if a numeric advisory lock appears anywhere in the repository. Two distinct strings can still hash alike (64 bits); the cost is two unrelated commands waiting on each other, never a missed lock.

## Events are the spine

Every kernel operation returns events; the kernel appends them and wakes the hub. Modules never call each other's internals; where one reacts to another, it reacts to an event. Item state is a fold; the play-by-play, the board, the dashboard feed and the audit trail are all reads over the same rows.

The vocabulary is a closed enum in `packages/contracts`, listed in PRD section 8.6. Adding an event is a contract change.

## The agent boundary

The MCP surface serves exactly the verb registry and nothing else. There is no verb for approving, merging, deploying, publishing or advancing past a human gate, on any host. A persona is configuration over the verb registry and the run-shape registry; a new verb, a new run shape or a new engine is reviewed code. The two hosts, a Cloudflare Workflow and a person's own Claude Code over remote MCP, see identical tool lists, and a CI test asserts it.

## The sim

`sim/` is the kernel on test adapters. `createWorld()` gives a scenario one clone of an embedded Postgres migrated once per process, the ten test adapters, one settable clock starting `2026-10-01T09:00:00.000Z`, and `createKernel` over them; `createSimHarness(template, fixture)` builds a harness from a template. Scenarios in `sim/scenarios/` are named for the PRD requirement they prove: `KN-10.activation-refuses-a-bypass.ts`, `KN-13.agent-cannot-write-decision.ts`, `KN-16.delegation-lapses-when-grant-revoked.ts`, `DX-7.software-template-end-to-end.ts`. Assertions are on the event log and the folded item state.

The cockpit (PRD DX-4, DX-5):

```
pnpm sim -- <scenario>      run one scenario; print the event log and the folded state
pnpm sim -- all             every scenario
pnpm walk -- <template>     every path from Package to an external effect, and the gate each crosses
pnpm trace                  PRD requirement IDs with neither a scenario nor a test
pnpm trace:built            the same list; fails only on requirements whose step is marked Built
pnpm check                  lint, format, typecheck
pnpm verify                 the whole chain, the same one CI runs, including walk:all, trace:built and sim:all
```

A deployed Worker is touched for three things: platform adapters, rendering, and the tests only real infrastructure can prove. Everything else is proven in the sim first.

## Every rule is a check

A rule that lives only in prose drifts. Each has a check in `verify` and in CI, and each is observed red once before it is trusted.

| Rule | Check |
|---|---|
| Imports follow the dependency DAG above | dependency-cruiser and ESLint `no-restricted-imports` |
| `packages/harness` is pure | `no-restricted-globals` and `no-restricted-imports` in `packages/harness/**`; its tsconfig has no Workers types |
| Every port has a contract test run against every adapter | `tools/architecture/port-contracts.test.ts`: each port has a suite in `packages/harness/port-contracts/`, an adapter in `apps/uw-app/ports/` and in `sim/adapters/`, and a contract test beside each adapter that runs it |
| A vendor SDK is named in one directory | a text gate refuses `@anthropic-ai`, `openai`, `openrouter` imports outside `apps/uw-app/engines/<engine>/` |
| No agent route or tool writes gate decisions | a static test over the route table and tool handlers, plus a runtime test per identity kind |
| Both hosts see the same verbs | the tool list served to a Workflow equals the list served to an external runner, and both equal the registry |
| Ship exits only on human approval | the stage check constraint, its migration test, and the template walk in CI and at activation |
| Replay equals record | a property test over random event sequences |
| One writer per durable table | a test walks every module's `owns` export |
| Dates are `YYYY-MM-DD` | the lint rule and CI grep from plan §0 |
| Every table declares its classification | a schema test (plan §2.6) |
| The schema and the migrations agree | the drift check in `tools/db` |
| Tokens agree | the Tailwind theme is compared to `packages/ui/tokens/*.css` by name and value |
| Nothing unused | knip over files, dependencies, exports and types |
| Every requirement is proven | `trace` fails on a PRD Must requirement with neither a scenario nor a test |
| Nothing needs a live account | `tools/architecture/no-live-account.test.ts` |

## Where a change goes

| Change | Place |
|---|---|
| A new event | the enum in `packages/contracts`, its fixtures, and the folds that should count it |
| A new verb | `packages/contracts` registry, the MCP handler, the persona toolsets that may hold it |
| A new engine | a directory under `apps/uw-app/engines/`, never a branch in another |
| A new validator or connector | its registry entry and handler; a stage row picks it by key |
| A new table or column | `packages/db/schema.ts` and a migration |
| A new thing the world must provide | a port with its platform adapter, its test adapter and its contract test, never a direct import |
| A new screen | one island, one route, one scenario |
| A new word | `CONTEXT.md` first |
| A reason the next reader will not guess | `docs/adr/` |
| A design change | the spec's Decisions table and PRD section 18 |
