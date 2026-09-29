# Architecture: the harness in the platform

How the harness code is shaped so that an agent can hold the whole of it, prove it works without a deployed Worker, and change one place to change one thing. Words are defined in [`CONTEXT.md`](../CONTEXT.md); what to build and why is in [the spec](../prd/Harness%20v1%20-%20Architecture.md); why the shape is this way is in [`adr/`](adr/). The platform the harness sits in is designed in [the plan](../prd/An%20App%20For%20Everything%20-%20Platform%20Architecture%20Plan.md).

## The tower, top to bottom

```
apps/uw-app/            Hono on Cloudflare Workers: SSR pages and islands, command API,
                        MCP surface, live hub (Durable Object), Workflows, crons
apps/uw-ingest/         webhook verification and enqueue; nothing else
packages/harness/       the engine: pure TypeScript over ports; no Worker, vendor or
                        database import; the stage machine, ship rule, replay, walker
packages/contracts/     commands, events, outcomes and the verb registry as Zod; one
                        live version, golden fixtures, conformance test
packages/db/            Drizzle schema (the source of truth), migrations, constraints
packages/core/          acl (can, principal), dates, modules registry, shared Zod schemas
packages/ui/            design tokens as CSS and the Tailwind theme built from them
sim/                    memory adapters for every port, fixture harnesses, scenarios, CLI
infra/                  wrangler configs, Access policies, environments; declared, never clicked
```

Imports go down only, and dependency-cruiser and ESLint enforce it. `packages/harness` is the pure layer: it may import `packages/contracts` and `packages/core` types and nothing with side effects. Everything durable is in Postgres through an adapter; nothing in the engine knows it is Postgres.

## The engine over ports

```ts
createEngine(ports: Ports): Engine

Engine = {
  harnesses, stages, items, runs, gates, delegations, personas,
  replay(events): ItemState,
  shipRule(inputs): Advance | Refuse,
  walk(template): Path[],
}
```

One composition root. The Worker calls it once with platform adapters. A test or the sim calls it many times with memory adapters. Nothing else constructs a module. Every seam the spec names is a port:

| Port | Provides | Platform adapter | Memory adapter |
|---|---|---|---|
| Clock | now | `Date.now` | settable, advanceable |
| Ids | next id | `crypto.randomUUID` | sequential |
| Store | rows of every harness table, in transactions | Drizzle over Hyperdrive to Neon | in-memory tables with the same constraints |
| Grants | resolve a principal's grants; lock and re-read them | `role_grants` with `SELECT ... FOR SHARE` | map with a scripted revoke |
| GitHubFacts | PR state, head, checks, reviews for a head commit | the `gh_*` read model | fixture facts per commit |
| Connectors | merge, deploy, publish, send, post | GitHub App and deploy tokens in the host step | records calls |
| Validators | run a validator by key against an item | the registry in `packages/harness` | the same registry |
| ModelEngine | one persona turn: tool calls over the verb registry | the six engines, each in its own directory | scripted tool calls |
| Hub | wake a harness's clients | the Durable Object | records wakes |
| Notifier | web push and the Zulip thread | push service and Zulip REST | records wakes |
| Runs | start, resume, hibernate a run | Cloudflare Workflows | an in-process loop |

Every port has exactly two adapters. A port with one adapter is a defect: it means a seam nothing varies across.

Two things the pure layer cannot prove, and the tests that cover them on real Postgres: the null-safe stage check (a migration test inserts `('merge', 'checks')` and is refused) and the gate decision's locked grant re-read (a race test runs revoke-then-decide and decide-then-revoke on real connections).

## What is durable, and who writes it

Every durable value has one writer. The Drizzle schema declares every table with its classification (plan §2.6) and the engine module that owns it.

| Table | Written by | Notes |
|---|---|---|
| `harnesses`, `harness_stages` | the stage command | `admin(area)` only; never through `write_page`; the Ship invariant is a check constraint |
| `harness_items` | the engine | stage, holder, lease, risk tier and domains, expected head |
| `harness_events` | the engine, append-only | closed vocabulary from `packages/contracts`; the source of truth |
| `harness_runs` | the run shape | host, engine, steps, tokens, cost basis |
| `gate_decisions` | the gate command, human principals only | seven-year retention; grants locked in the same transaction |
| `delegations` | the delegation command, `admin(area)` only | checked at every beat |
| `personas` | the persona page type | a page; the table is its projection |
| `measurements` | the Validate stage | public-side sources only in v1 |
| `pages`, `page_versions` | the page API and `write_page` | plan §2; harness stage rows are not pages |
| `role_grants` | the grants command | plan §4; audit-logged |
| `gh_*` | `uw-ingest` and the nightly sweep | read model; GitHub is the source of truth |
| `push_subscriptions`, `push_cooldowns` | the notifier | per person |

## Events are the spine

Every engine operation returns events; the engine appends them and wakes the hub. Modules never call each other's internals; where one reacts to another, it reacts to an event. Item state is a fold; the play-by-play, the board, the dashboard feed and the audit trail are all reads over the same rows.

```
item_created  item_claimed  lease_renewed  lease_expired  branch_abandoned
run_started  run_step_recorded  run_failed  run_hibernated  run_resumed
submitted_to_gate  checks_passed  checks_failed  gate_approved  gate_rejected
gate_taken_over  gate_overridden  gate_refused_to_agent  ship_refused
delegation_granted  delegation_revoked  delegation_lapsed  delegation_required
stage_edit_refused  learning_attached  nothing_learned
```

The vocabulary is a closed enum in `packages/contracts`; adding an event is a contract change and its own PR.

## The agent boundary

The MCP surface serves exactly the verb registry and nothing else. There is no verb for approving, merging, deploying, publishing or advancing past a human gate, on any host. A persona is configuration over the verb registry and the run-shape registry; a new verb, a new run shape or a new engine is reviewed code. The two hosts, a Cloudflare Workflow and a person's own Claude Code over remote MCP, see identical tool lists, and a CI test asserts it.

## The sim

`sim/` is the engine on memory adapters. `createSimHarness(template, fixture)` returns an engine plus the command handlers; `createWorld()` holds any number of harnesses, a fixture GitHub with scripted facts per commit, scripted personas, and one shared clock. Scenarios in `sim/scenarios/` are named for the spec section or issue they prove: `figure-2.software-template-end-to-end.ts`, `gate.agent-cannot-write-decision.ts`, `delegation.lapses-when-grant-revoked.ts`. Assertions are on the event log and the folded item state.

The cockpit, once scaffolded:

```
pnpm sim -- <scenario>      run one scenario; print the event log and the folded state
pnpm sim -- all             every scenario
pnpm walk -- <template>     every path from Package to an external effect, and the gate each crosses
pnpm trace                  spec sections and issues with neither a scenario nor a test
pnpm check                  lint, format, typecheck
pnpm verify                 the whole chain, the same one CI runs
```

A deployed Worker is touched for three things: platform adapters, rendering, and the two Postgres-only tests. Everything else is proven in the sim first.

## Every rule is a check

A rule that lives only in prose drifts. Each has a check in `verify` and in CI, and the scaffold PR is accepted only when each has been observed red once.

| Rule | Check |
|---|---|
| Imports go down the tower only | dependency-cruiser and ESLint `no-restricted-imports` |
| `packages/harness` is pure | `no-restricted-globals` and `no-restricted-imports` in `packages/harness/**`; its tsconfig has no Workers types |
| A vendor SDK is named in one directory | a text gate refuses `@anthropic-ai`, `openai`, `openrouter` imports outside `apps/uw-app/engines/<engine>/` |
| No agent route or tool writes gate decisions | a static test over the route table and tool handlers, plus a runtime test per identity kind |
| Both hosts see the same verbs | the tool list served to a Workflow equals the list served to an external runner, and both equal the registry |
| Ship exits only on human approval | the stage check constraint, its migration test, and the template walk in CI and at activation |
| Replay equals record | a property test over random event sequences |
| One writer per durable table | a test walks every module's `owns` export |
| Dates are `YYYY-MM-DD` | the lint rule and CI grep from plan §0 |
| Every table declares its classification | a schema test (plan §2.6) |
| Tokens agree | the Tailwind theme is compared to `packages/ui/tokens/*.css` by name and value |
| Nothing unused | knip over files, dependencies, exports and types |
| Every spec section is proven | `trace` fails on a spec section or Must issue with neither a scenario nor a test |

## Where a change goes

| Change | Place |
|---|---|
| A new event | the enum in `packages/contracts`; the folds that should count it; its own PR |
| A new verb | `packages/contracts` registry, the MCP handler, the persona toolsets that may hold it; its own PR through the software harness |
| A new engine | a directory under `apps/uw-app/engines/`, never a branch in another |
| A new validator or connector | its registry entry and handler; a stage row picks it by key |
| A new table or column | `packages/db/schema.ts` and a migration; its own PR |
| A new thing the world must provide | a port with both adapters, never a direct import |
| A new screen | one island, one route, one scenario |
| A new word | `CONTEXT.md` first |
| A reason the next reader will not guess | `docs/adr/` |
| A design change | the spec's Decisions table, then the issues that cite it |
