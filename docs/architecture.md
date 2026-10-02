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
  events, reads, items, repair, stages, delegations, gates, personas,
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

Every durable value has one writer. The Drizzle schema declares every table with its classification (plan §2.6) and the kernel module that owns it. The schema is split by domain: `packages/db/schema.ts` holds the harness tables and re-exports `packages/db/schema-platform.ts`, which holds the platform tables (`people`, `role_grants`, `grant_audit`, `pages`, `page_versions`, `webhook_deliveries`, `queue_watermarks`, `tasks`, `service_tokens`). Everything imports `schema.ts`, and drizzle-kit reads it; a new table goes in the file for its domain.

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
| `tasks` | `apps/uw-app/tasks/store.ts` (`create_task`) | created `suggested` with `created_by` the agent identity; statuses `suggested`, `open`, `done`, `dismissed` |
| `service_tokens` | `apps/uw-app/agents/service-tokens.ts` (`bind_service_token`, `revoke_service_token`), org admin only | binds an Access service token's client id to one person's device; each binding has its own id; one live binding per device and one per client id, so a revoked client id can be bound again; revoke sets `revoked_at` and records no revoker |
| `gh_*` | the GitHub read-model module in `uw-app`, called by both the webhook consumer and the nightly sweep | one writer, two entry points; GitHub is the source of truth |
| `push_subscriptions`, `push_cooldowns` | the notifier | per person |

## Transactions and locks

A kernel command opens one transaction (`ports.store.transaction`) and passes the transaction object as-is to everything it calls; transactions never nest. A second transaction opens only after the first has settled: to record a refusal after Postgres aborted the first (`stage_edit_refused`), or to record a connector's outcome after the decision committed. The lease sweep lists lapsed leases in one transaction and expires each item in its own.

Locks are taken in one order, and none after the first event append:

1. **The stage lock.** The stage command and activation take `harness-stages:<harnessId>` before anything else and read the stage rows after it, so two edits of one harness serialise and neither writes back a row the other changed. Claim, take over and the gate decision take `harness-stage-claims:<stageId>` and re-read the stage after it, so the WIP count and the claim are one serial step. No command takes both.
2. **The item row.** `harnessItems.read.lock` (`SELECT ... FOR UPDATE`), and `recordItemEvents` folds the locked row.
3. **Grants.** `grants.lockAndReread` (`FOR SHARE` on the person's `role_grants`) where a revoke must wait for the command (the stage and gate commands); `grants.resolveIn`, a plain read in the same transaction, for the write-level checks of the item commands.
4. **Appends.** The `harness_events` insert trigger takes `harness_events:<harnessId>` and holds it to commit, so positions become visible in order. Taking any lock after it would hold the harness's append lock while waiting.

Persona activation has no stage to lock, so it takes `persona-activation:<pageId>` first; a second activation of the same page waits there and then finds the item the first opened through the `persona_activation_failed` evidence (page and verb), so a missing verb opens one open item per persona page and verb however many attempts race and whatever the persona is renamed to. It then re-reads the activator's grants (`FOR SHARE`), reads what it needs, and takes `harness_events:<harnessId>` for the persona's harness and then for the software harness before the first append; its appends go in that order, the `persona_activation_failed` event first and the software item after it.

A page update (`apps/uw-app/pages/store.ts`) takes `pages-reparenting` first only when it moves the page to a parent other than the stored one (a plain read decides), then the page row (`SELECT ... FOR UPDATE`), in that order, and checks the stored version, parent and status under that row lock; a save that skipped the lock and finds the parent moved under the row lock is `stale_version`. No page transaction takes a kernel lock, and no kernel transaction locks a page row.

A delegation lapse is an `UPDATE` of the delegations row (`delegations.write.markLapsed`, from `recordLapse`) inside claim, submit, step, release and the beat. It comes after the item row and the grants and before the appends, so it sits between steps 3 and 4 above.

Binding a service token (`apps/uw-app/agents/service-tokens.ts`) takes `acl-grant-commands`, then the acting admin's `role_grants` `FOR SHARE`, then the bound person's `people` row (`lockPerson`, `FOR UPDATE`), then that person's `role_grants` `FOR SHARE`, in that order; revoking takes the first two and then updates the `service_tokens` row. Neither takes a kernel lock.

The GitHub read model (`apps/uw-app/github/facts/upsert.ts`) writes one batch of facts in one transaction and takes no kernel lock, and no kernel transaction locks a `gh_*` row. Before any write it locks, `FOR UPDATE ... ORDER BY github_id`, the batch's stored issues and then every pull request the batch touches: those it carries, and those named only by its reviews or its file lists. It then writes the tables in one order (repositories, milestones, issues, pull requests, check runs, reviews, files), with each table's rows sorted by GitHub id, so `INSERT ... ON CONFLICT` locks them in id order too. A batch therefore never holds a repository row while it waits for a pull request row, and two batches naming the same rows in any order wait on each other instead of deadlocking (tested with a reviews-only batch beside a batch carrying their pull request). Every writer of GitHub facts goes through this function.

Where there is no row to lock, a unique constraint is the guard: `delegations_supersedes_once` lets one renewal of a dead delegation insert and the command maps the other's violation to `stale_version`.

**Isolation is READ COMMITTED**, Postgres's default; nothing sets another level. The WIP count after the stage-claims lock and the stage re-read after the harness-stages lock rely on each statement seeing what committed before it began. Under REPEATABLE READ the snapshot is fixed at the transaction's first statement, so a count or re-read after a lock wait would miss the commit it waited for, and both the WIP limit and the lost-update guard would silently fail.

**One key space.** Every advisory lock is `pg_advisory_xact_lock(hashtextextended(key, 0))` over a string key, built by `advisoryLock(key)` in `packages/db/advisory-locks.ts` (the Drizzle store's `tx.lock` and the platform's grant commands and page re-parent use it; the event trigger writes the same expression in SQL). That file is the registry: the platform keys `acl-grant-commands` and `pages-reparenting`, and the prefixes `harness-stage-claims:`, `harness-stages:`, `harness_events:` and `persona-activation:`. Its tests fail if one key is a prefix of another, if a kernel lock key's prefix is not registered, or if a numeric advisory lock appears anywhere in the repository. Two distinct strings can still hash alike (64 bits); the cost is two unrelated commands waiting on each other, never a missed lock.

## Events are the spine

Every kernel operation returns events; the kernel appends them and wakes the hub. Modules never call each other's internals; where one reacts to another, it reacts to an event. Item state is a fold; the play-by-play, the board, the dashboard feed and the audit trail are all reads over the same rows.

The vocabulary is a closed enum in `packages/contracts`, listed in PRD section 8.6. Adding an event is a contract change.

## The agent boundary

The MCP surface serves exactly the served verbs of the verb registry and nothing else. There is no verb for approving, merging, deploying, publishing or advancing past a human gate, on any host. A persona is configuration over the verb registry and the run-shape registry; a new verb, a new run shape or a new engine is reviewed code. The code is `apps/uw-app/mcp/`.

**Access.** `/mcp` is its own Access application with its own audience (`infra/access/uw-app.json`, `mcp`), and the rest of the host is the app application. The edge (`apps/uw-app/auth/principal-middleware.ts`) picks the expected audience by path: `/mcp` accepts only `ACCESS_MCP_AUD`, every other path only `ACCESS_AUD`, and a token for the other audience is `401 unauthenticated` (R34). Service tokens are admitted only by the `mcp` application, and the edge refuses a service-token identity on any other path `401`, so a credential an agent holds for `/mcp` never reaches `/api/*` as its owner. Both audiences are configuration (`infra/uw-app/wrangler.go-live.toml`), not secrets. A person can still hand an agent their browser session on purpose; that is outside what the edge can tell apart.

**The endpoint.** `POST /mcp` is behind its Access application (`apps/uw-app/mcp/routes.ts`, mounted in `app.tsx`). It is the SDK's web-standard Streamable HTTP transport, stateless (no session id) with JSON responses; `GET` and `DELETE` answer `405` with `Allow: POST`. A request carries one JSON-RPC message of at most 256 KiB; a batch is refused. One SDK `Server` is built per request and closed after it.

**Minting** (`apps/uw-app/mcp/mint.ts`). The edge turns an Access credential into an agent identity for the request. On `/mcp` a person's login is always minted as an agent, never `human:<id>`: it must send `x-uw-device` (`^[a-z0-9][a-z0-9-]{0,31}$`, `400 malformed_command` without it) and is minted `agent:<personId>/<device>`, interactive; a device the person's live service token is bound to is `403 not_permitted`, so a login and a runner never share an identity. A service token is looked up by its client id in `service_tokens`; with no live binding it is `401 unauthenticated`, and with one it is minted `agent:<personId>/<device>` for the bound person and device, not interactive. `x-uw-persona` and `x-uw-delegation` come together or not at all; with both, the identity is the delegated form `agent:<personId>/<device> as <persona> via delegation:<id>`. Minting does not check the delegation; the dispatcher does, on every call (below). Minting needs a live `editor` or `admin` grant at any scope (`403 not_permitted` otherwise), and the minted grants are exactly the owner's grants resolved for this request, so a revoked grant is gone on the next request. Each verb then checks the harness's area. A bare `agent:<persona>` is never minted at the edge: it is the beat principal of a delegation, which only the in-process host is given.

**Two hosts, one server.** `createVerbServer(context)` (`apps/uw-app/mcp/server.ts`) builds the server for a principal, an instant and a host. The `external` host is the HTTP route above. The `workflow` host is `connectInProcess` (`apps/uw-app/mcp/in-process.ts`), the same server over the SDK's in-memory transport; until the Workflow step lands (HE-1) only test files may import it (dependency-cruiser `in-process-host-only-in-tests`). The host forces the cost basis: `record_run_step` must say `subscription` from the external host and `metered` from the Workflow host, and anything else is `not_permitted` `{ why: 'cost_basis_is_the_hosts', expected }`.

**The tool list and the dispatcher.** `tools/list` is `toolsFor(principal, at)` (`apps/uw-app/mcp/tools.ts`): every registry verb served in v1 whose name holds no forbidden verb and, for a fixed-area verb, whose grant the principal holds, with input and output JSON Schema from the verb's own Zod schemas. `tools/call` is `callVerb` (`apps/uw-app/mcp/dispatch.ts`). A name that is not a served verb for this principal (a forbidden verb, an alias of one, an unserved verb, anything else) is the JSON-RPC error `-32602` with `Unknown tool: <name>`. For an identity that names a delegation, `callVerb` runs `kernel.delegations.beat` once per call before anything else, and its refusal (`delegation_not_found`, `not_permitted`, or `delegation_lapsed`, which records the lapse once) answers every verb, page and task verbs included (R35); the item verbs do not beat again. Arguments are parsed with the verb's input schema (`malformed_command` on failure). Every kernel read a verb makes is judged at the request instant (`{ at: context.at }`), the same instant the dispatcher's `can()` uses. Every handler is built by `gatedHandler` or `rowFilteredHandler` (`apps/uw-app/mcp/handler.ts`), and `createVerbServer` refuses at startup a handler no builder made, or a rows handler for a verb with a registry grant. A gated handler names the resource it touches, and the dispatcher runs the one central `can()` on it before the handler acts; when the caller may not read it, the reply is the handler's own not-found refusal, byte-identical to a missing id. A rows handler maps each row to its resource and the builder drops every row `can()` refuses. A refusal is an MCP result with `isError: true` and text `{"status":"error","reason":<closed set>,"detail":{…}}`; every call is logged with its outcome.

**The verbs.** Harness verbs (`poll_queue`, `claim_item`, `submit_to_gate`, `record_run_step`, `get_health`) call `kernel.reads` and the kernel's item commands. A delegated identity, a bare persona and a non-interactive device without a delegation see only what they may act on: the harnesses their live delegations with a capability other than `none` name, and nothing without one. Page verbs (`search_pages`, `read_page`, `write_page`) read through `apps/uw-app/pages/` and save through its `createPage` and `updatePage`; an agent's save of a `learning`, `skill` or `persona` page is only ever `suggested`, and it may not save a page any stage names as its instructions. Which page types are gated is one table (`apps/uw-app/pages/gating.ts`); the person page API never creates a gated page `active` nor moves one to `active` (`not_permitted` `{ why: 'activation_required' }`, R38), so a gated page reaches `active` only through its activation command. `resolve_context`, `query_entities` (`open_tasks`, `stage_items`) and `create_task` read pages and stages and write `tasks`. Persona activation's tool check (AB-8) is the kernel command `kernel.personas.activate`, which takes the page version the person read (`expectedVersion`) and answers `stale_version` when the stored page has moved on; with no software harness, or one with no stages, the failure is still recorded and the refusal says `why: 'software_harness_missing'`.

**The three AB-7 checks.**

| Check | Where | What fails it |
|---|---|---|
| Static | `tools/architecture/agent-boundary.ts`, run by `tools/architecture/agent-boundary.test.ts` | From `apps/uw-app/app.tsx` (every route any principal can reach; since R34 a service token reaches only `/mcp`, and the closure still covers `/api/*`) the import closure must not touch `gate_decisions` or `harness_stages`, or call `kernel.gates`, `kernel.stages`, `kernel.repair`, `kernel.delegations.grant` or `kernel.delegations.revoke`, or reach a connector; every MCP handler goes through a builder and `can()`. Planted handlers and routes fail it. These are token-level backstops; the builders' runtime refusal is the enforcement |
| Runtime | `sim/kernel/agent-boundary-runtime.test.ts`, scenario `sim/scenarios/AB-7.no-agent-identity-writes-a-gate-decision.ts` | Every agent identity form, in every grant combination, attempting every gate decision: each attempt records `gate_refused_to_agent` and writes no decision; a planted gate command that lets an agent decide fails it |
| Conformance | `apps/uw-app/mcp/conformance.pg.test.ts`, `apps/uw-app/testing/conformance.test.ts` | The Workflow host and an external runner are served the same tools with the same schemas; on an arranged scene each served verb's outcome is pinned per host (all `accepted` today), and `internal_error`, `not_wired` and `malformed_command` always fail; unserved names get the same unknown-tool error; a planted host-specific tool and a planted handler that throws on one host fail it |

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
| No agent route or tool writes gate decisions | `tools/architecture/agent-boundary.test.ts` over the closure from the app entry, plus `sim/kernel/agent-boundary-runtime.test.ts` over every identity form and grant combination |
| Both hosts see the same verbs | `apps/uw-app/mcp/conformance.pg.test.ts`: the tool list served in process equals the list served over HTTP, and both equal the served registry |
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
