# Step 4, Agent Boundary: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agents their one way in: a Streamable HTTP MCP endpoint at `/mcp` inside `uw-app`, behind Access, whose tool list is the served verb registry and nothing else; agent identities `agent:<person>/<device>` (and the delegated form) minted at the edge from Access credentials with exactly their owner's grants; every handler gated by `can()` on the harness's area; the eleven served verbs over the kernel and the page, task and record modules; delegated non-interactive runners; the three agent-boundary checks (static, runtime, conformance) each with a planted fixture that makes it fail; and persona activation's tool check (AB-1 to AB-8).

**Architecture:** The MCP surface lives in `apps/uw-app/mcp/` (the composition root, PRD 9). One SDK `Server` is built per request by `createVerbServer(context)`: `tools/list` is `toolsFor(principal, at)` over `verbRegistry` from `@uw/contracts`; `tools/call` is `callVerb`, which refuses an unserved name with the MCP unknown-tool error, parses the input with the verb's own Zod schema, runs the one central `can()` for every gated verb, and maps the handler's reply to an MCP result whose refusals carry a closed-set reason. The HTTP route connects it to the SDK's web-standard Streamable HTTP transport (stateless, JSON responses); the Workflow host (step 7) connects the same server in process. Harness verbs call new kernel reads (`kernel.reads`) and the existing item commands; page, task and record verbs call the platform modules that own those tables. Persona activation's tool check is a kernel command (`kernel.personas.activate`), proven in the sim.

**Tech Stack:** TypeScript 6 strict on Node 22.18+, Zod 4, Hono 4, `@modelcontextprotocol/sdk` 1.31.0 (new), `@cfworker/json-schema` 4.1.1 (new, the SDK's Workers validator), Drizzle ORM 0.45 over `postgres` 3.4 and `@electric-sql/pglite` 0.5.8, Vitest 4 (Workers pool and node project), `fast-check` 4, dependency-cruiser, knip.

**Spec:** `docs/PRD.md` (approved): section 7.4 (AB-1 to AB-8), 8.1 to 8.6, 11, and 18 (D5, D13, D14, D15, D22; P8, P18, P20, P22). Design: `prd/Harness v1 - Architecture.md` (Figure 1, Figure 3, Figure 4 "Lending token aid", "A scheduled routine is an external runner on a delegation", "Who may act", "Unattended loops run on a delegation", "Jobs are config, verbs are code", "One verb registry"); `docs/architecture.md` ("The agent boundary", "Transactions and locks"); ADRs 0002, 0005, 0006.

**Requirements covered:** AB-1, AB-2, AB-3, AB-4, AB-5, AB-6, AB-7, AB-8. Also the step-3 carries that name step 4 (the AB-2 owner-segment binding, the direct `write.claim` race test, the capability-word row) and the six carries from the step-3 re-review (Task 1 and Task 3; listed in Task 20).

**Not in this step:** the command API and its static route check (WB-1, step 6); GitHub facts feeding `submit_to_gate`'s paths and declaration (GH-5, step 5); the Workflow run shape and engines that will use the in-process connection (HE-1, step 7); WB-10's indicator queries that `get_health` will switch to (step 8); persona activation's dry run, the status flip to `active`, the `personas` projection writer, the derived `requires_tools` and the toolset form (PE-1 to PE-3, step 10).

**Decisions this plan makes (the PRD, the spec and `AGENTS.md` leave them open; Task 20 records each with its cost if wrong):**

1. **The owner segment of a device identity is the person's id.** `agent:<person>/<device>` is `agent:<personId>/<device>`, the same id `human:<personId>` carries. `principalSchema` refuses an agent principal whose owner segment is not its `personId` (AB-2 SECURITY carry), and the kernel refuses such a principal again in `actingPrincipal` and `holdsClaim`, because the kernel trusts device identities to be owner-specific and does not parse principals.
2. **The device and the delegation come from request headers.** `x-uw-device` (required for a person's login; `^[a-z0-9][a-z0-9-]{0,31}$`), and, together or not at all, `x-uw-persona` (a persona slug) and `x-uw-delegation` (a delegation id). With both, the principal is `agent:<personId>/<device> as <persona> via delegation:<id>` for every call in the request, so every event it writes carries the delegated form (AB-6); the kernel checks the delegation on every call.
3. **A service token reaches an owner through a binding row.** New table `service_tokens(client_id, person_id, device, bound_by, bound_at, revoked_at, trace_id)`, written by `bind_service_token` and `revoke_service_token`, which only an org-scope `admin` may run (the person who issues Access service tokens, PRD 15). A token with no live binding gets `401 unauthenticated` at `/mcp`. Other routes keep the step-1 `agent:svc-<client id>` principal with no grants.
4. **Minting needs `editor` somewhere.** A person (or a bound token's person) may be minted an agent identity only while holding a live `editor` or `admin` grant at any scope; otherwise `403 not_permitted`. The minted grants are exactly the owner's grants resolved for this request (AB-2 "at or below"), so a revoked grant is gone on the next request. Each verb then checks the harness's area.
5. **Refusals are tool results, unknown names are protocol errors.** A served verb that refuses returns `isError: true` with text `{"status":"error","reason":<closed set>,"detail":{…}}`. A name that is not a served registry verb (a forbidden verb, an alias of one, an unserved role-gated verb, anything else) is the JSON-RPC error `-32602` with message `Unknown tool: <name>`, the MCP specification's unknown-tool error. Malformed arguments are `malformed_command`.
6. **Cost basis follows the host.** `record_run_step` from the HTTP surface (the external host) must say `subscription`; from the in-process surface (the Workflow host) `metered`; anything else is `not_permitted` with `{ why: 'cost_basis_is_the_hosts', expected }`.
7. **`submit_to_gate` carries `to`, `pullRequest` and `head`; paths and the declaration wait for GitHub facts.** The MCP handler passes `change: { pullRequest, head, paths: [], declaration: null }` when both are given and `change: null` otherwise, so risk derivation records an undeclared submit and the ship rule fails closed (`risk_tier_undeclared`) until GH-5 feeds paths and the declaration from GitHub facts (step-5 carry). No input can advance past a human gate: a property test proves it.
8. **`poll_queue`'s subscription.** A delegated identity polls its delegation's harness only (refused if the delegation is not live or not its own); a bare `agent:<persona>` polls the harnesses of the live delegations for that persona and its person; a plain device or a person polls every harness. Each is narrowed by `harnessId` and filtered by `can(write)` on the area (only what the caller could claim). Items are unheld or on a lapsed lease, `working` or `checks_failed`, in an unpaused stage whose pickup is `allowed` or `auto`, on an unpaused harness, ordered by priority descending then item id. The `personas` projection joins this at PE-3.
9. **`write_page` statuses.** Gated types are `learning`, `skill` and `persona` (`policy` is not a registered page type, so the input schema refuses it). A new gated page is created `suggested`; an existing gated page may be saved by an agent only while it is `suggested`, and stays `suggested`; any other gated save is `not_permitted` `{ why: 'gated_page' }`. A new page of another type is created `draft`; a save keeps the stored status. The input has no status field, so no agent can activate a persona through `write_page` (PE-3's refusal holds by construction).
10. **`resolve_context`.** Instructions: the stage's `instructions_page_id` page if readable. Package: the item's page and its direct children that are not `learning` or `skill`, readable only. Learnings: `active` learning pages (a person confirmed them, PE-8), in three tiers, most specific first: children of the item's page, then children of the stage's instructions page, then other learnings in the harness's area; `as_of` descending within a tier; at most 20.
11. **`query_entities` whitelist in v1:** `open_tasks` `{ jdArea }` (suggested and open tasks in an area, empty unless the caller may read it) and `stage_items` `{ harnessId, stageKey }` (the items in one stage through the kernel's read, which needs `viewer` on the area). An unknown query name is `malformed_command` `{ why: 'unknown_query' }`. `measurements_for_item` joins with PE-7, where measurements get their writer.
12. **`create_task` takes a `jdArea`** (contract change) and writes the new `tasks` table with status `suggested` and `created_by` the agent identity (P20). Task statuses: `suggested`, `open`, `done`, `dismissed`.
13. **`get_health`** returns `harness` (`ok`, or `amber` when paused), `database` (`ok`, the applied migration count) and the WB-10 indicators `spend`, `breaker`, `runs_today`, `live_delegations`, `gate_refusals_week`, `agent_writes`, `stale_learnings` as `not_wired` ("built with WB-10, step 8"); `viewer` on the area. Step 8 switches them to WB-10's exported queries.
14. **Persona activation in step 4 is the tool check only.** `kernel.personas.activate` runs the AB-8 check; a persona that passes gets `not_wired` `{ step: 'PE-3' }` (the dry run and the status flip are step 10). An unregistered or unserved verb is a missing verb and opens one item on the harness whose key is `software`, attributed to the person activating, without a write check on that harness's area; a forbidden verb and a verb the owner's grants do not reach open none. Every failure appends `persona_activation_failed` to the persona's harness.
15. **AB-7 runtime over KN-13's hiding.** Every agent attempt at a gate decision on an existing item now records `gate_refused_to_agent`, including an agent that cannot read the harness; that agent is still answered `item_not_found` (KN-13's no-probing ruling keeps its reply, AB-7 gets its event).
16. **The schema splits by domain.** `packages/db/schema.ts` reached 496 non-blank lines. The platform tables (`people`, `role_grants`, `grant_audit`, `pages`, `page_versions`, `webhook_deliveries`, `queue_watermarks`) move unchanged to `packages/db/schema-platform.ts` with the new `tasks` and `service_tokens`; `schema.ts` keeps the harness tables, imports what they reference and re-exports the platform file, so it stays the one schema everyone imports and drizzle-kit reads. `AGENTS.md` section 1 and rule 1 say so (Task 6).
17. **The persona slugs `system` and `ingest` are reserved** (step-3 re-review carry f): no persona identity, persona page, delegation or `x-uw-persona` header may name them.
18. **The contract moves `3.2.0` → `4.0.0` (Task 2: `principalSchema` tightens) → `5.0.0` (Task 4: additive).**

---

## Global Constraints

Every task obeys every line here. The controller passes this section to each implementer.

**Where and how**

- Work only in the worktree `/home/ianjl/projects/uw-platform-v1` on branch `build/v1`. Never commit to `main`, never force-push, never `--no-verify`, never rewrite history.
- Read `AGENTS.md` sections 1, 4, 6 and 10 before the first edit. When this plan and `AGENTS.md` disagree, `AGENTS.md` wins: build the version that keeps the rule and record the conflict in `docs/progress_tracker.md`.
- Words come from `CONTEXT.md`: kernel (never "engine" for the core), harness, stage, item, gate, principal, grant, agent identity, persona, delegation, beat, lease, host, external runner, verb (the agent's word; "tool" only as the MCP wire word), MCP surface, command (a person's action), event, gateway, projection, port, adapter, platform adapter, test adapter, sim, world, scenario, device and service token binding (Task 2 adds them). Never "mock", "fake" or "memory adapter" for the Store test adapter.
- **Never run two test suites at once** (tracker R37: concurrent suites exhausted the 16 GB machine and the OOM killer took the session). Run one `pnpm vitest run …`, one `pnpm sim …` or one `pnpm verify` at a time, never in the background beside another, and never two implementers' suites in parallel.

**Code rules (mechanically enforced by `pnpm verify`)**

- TypeScript `strict`, no `any`, no `@ts-ignore`, no `as unknown as`, no non-null `!` on values that can be null at runtime.
- No code comments of any kind: no line comments, block comments, JSDoc, directive comments or commented-out code.
- Files under 500 lines (non-blank); functions under 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters. These apply to test files: hoist logic out of `describe` callbacks into top-level helpers and split long `describe` blocks.
- Erasable syntax only in every package, `sim` and `tools`: no `enum`, no `namespace`, no constructor parameter properties. Every relative import names its `.ts` file. JSON is imported `with { type: 'json' }`.
- No clock reads in `packages/core` or `packages/harness` (`tools/architecture/no-clock-reads.test.ts`). The kernel reads time once per command through `ports.clock.now()`; routes use the per-request instant `c.get('now')`. `new Date(iso)` and `new Date(at.getTime() + ms)` are fine.
- Calendar dates only through `packages/core/dates.ts`; instants are `Date` objects or whole `toISOString()` strings.
- Lookups by a variable key use `Map` or `Object.hasOwn`. Discovery by registry (`Map` built from an array), never a `switch` or `if` chain on a verb, query, persona or host name.
- Every refusal is a closed-set reason from `errorReasonSchema` (`packages/contracts/outcomes.ts`); never raw exception text in a reply. Unexpected errors are logged with `errorFields` from `@uw/core/log` and answered `internal_error`.

**Layering (dependency-cruiser and ESLint)**

- `packages/contracts` imports only `zod`. `packages/core` imports `packages/contracts` and `zod`. `packages/db` imports `packages/contracts`, `packages/core`, `drizzle-orm`, `postgres`, `@electric-sql/pglite` and Node built-ins. `packages/harness` imports `@uw/contracts` and `@uw/core/acl` and nothing else (no Drizzle, Workers, network, `zod` directly).
- `sim/` imports `packages/harness`, `packages/contracts`, `packages/db`, its own files and the Node built-ins in `AGENTS.md` rule 2; its tests also Vitest. Sim fixtures build principals with `principalSchema.parse` from `@uw/contracts`.
- `apps/uw-app` is a composition root. The MCP SDK (`@modelcontextprotocol/sdk`, `@cfworker/json-schema`) is imported only under `apps/uw-app/`. The vendor-SDK rule is about model vendors (`@anthropic-ai/*`, `openai`, OpenRouter) and does not apply to the MCP SDK; do not touch `tools/lint/vendor-sdk.ts`.
- MCP code imports, from the SDK, only these entry points: `@modelcontextprotocol/sdk/server/index.js`, `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js`, `@modelcontextprotocol/sdk/types.js`, `@modelcontextprotocol/sdk/validation/cfworker`, `@modelcontextprotocol/sdk/inMemory.js`, `@modelcontextprotocol/sdk/client/index.js`; tests may also import `@modelcontextprotocol/sdk/client/streamableHttp.js`. Never `server/streamableHttp.js`, `server/sse.js`, `server/stdio.js` or `server/express.js` (Node-only). Every `Server` and `Client` this code builds passes `jsonSchemaValidator: new CfWorkerJsonSchemaValidator()`; Ajv generates code with `new Function`, which Workers forbid.
- Rule 2 exceptions: an `apps/uw-app` platform module that uses Drizzle directly (as `pages/store.ts` does) needs its own row in `docs/exceptions.md`, written in the same commit as the code and before it.
- One writer per table (rule 3): `tasks` is written only by `apps/uw-app/tasks/store.ts` (`owns = ['tasks']`); `service_tokens` only by `apps/uw-app/agents/service-tokens.ts` (`owns = ['service_tokens']`); `pages`, `page_versions` only through `apps/uw-app/pages/store.ts`'s `createPage` and `updatePage`. No file under `apps/uw-app/mcp/` writes any table directly.
- No route, tool handler or Workflow step reachable by an agent identity writes `gate_decisions` or `harness_stages`, or calls `kernel.gates`, `kernel.stages`, `kernel.repair`, `kernel.delegations.grant` or `kernel.delegations.revoke` (Task 17 makes this a check).

**Ports, gateways and transactions**

- The ten ports and their keys are unchanged. The Store grows only by gateway members; this step changes one: `PageFacts` gains `title` and `frontmatter` (Task 11). Pass `tx` as-is; never nest transactions; lock order is stage lock, item row, grants, appends, with no lock after the first append (`docs/architecture.md`, "Transactions and locks").
- Kernel tables take every instant from the command's `at` and every id from the Ids port (`packages/db/kernel-defaults.test.ts`). The new platform tables `tasks` and `service_tokens` also take their instants and ids from the caller (no `defaultNow()`, no `defaultRandom()`).

**Contracts**

- The live version moves `3.2.0` → `4.0.0` (Task 2) → `5.0.0` (Task 4). Each move changes, together and in one commit: the schemas, their fixtures under `packages/contracts/fixtures/<registry key>/{valid,invalid}/` (and `packages/contracts/verb-fixtures/<verb>/{input,output}/{valid,invalid}/` for verb I/O), the `schemaRegistry` entries, `CONTRACT_VERSION` in `packages/contracts/version.ts`, a new last entry in `packages/contracts/contract-lock.json` recording every closed set, and `"contractVersion"` in `apps/uw-app/package.json` and `apps/uw-ingest/package.json`. No other task changes a contract; if one finds it must, it bumps the minor version the same way and records why in the tracker.

**Shared roots**

- `packages/db/schema.ts` (with `schema-platform.ts` and the migrations), `packages/contracts/`, `packages/harness/ports.ts`, `packages/core/acl.ts`, `infra/`, `.github/workflows/`, `AGENTS.md`, `CONTEXT.md`, `docs/adr/`. A change to one goes in its own commit with no feature code, and the message names the shared root and why it changed. This step changes `CONTEXT.md` and `packages/contracts/` (Task 2), `packages/contracts/` (Task 4), `packages/core/acl.ts` (Task 5), `packages/db/schema.ts`, `schema-platform.ts`, a migration and `AGENTS.md` (Task 6), and `packages/harness/ports.ts` (Task 11).

**Dependencies**

- Two new third-party packages, both in `apps/uw-app/package.json` `dependencies`: `@modelcontextprotocol/sdk@^1.31.0` (MIT; the official TypeScript SDK; its `WebStandardStreamableHTTPServerTransport` takes a Web `Request` and returns a `Response`, so it runs on Workers and in Node 22) and `@cfworker/json-schema@^4.1.1` (MIT; the SDK's peer for JSON Schema validation without code generation). Both land in Task 12. If knip reports `@cfworker/json-schema` unused (it is reached through the SDK's `validation/cfworker` entry), add it to `ignoreDependencies` for `apps/uw-app` in `knip.json` and say why in the tracker. If `pnpm audit:prod` reports a high advisory in the SDK's dependency tree, pin the patched version through `pnpm.overrides` in the root `package.json` and record it.
- Run `pnpm install` after any `package.json` change and commit `pnpm-lock.yaml` with it. Do not export what has no consumer yet; export in the task that consumes it (test files count as consumers for knip).

**Tests**

- Write the failing test or scenario first, run it, see it fail for the expected reason, then implement. Where a task proves behaviour the code already has (Task 16), mutate the code under test by hand once, see the test go red, and restore it before committing.
- Name each `describe` (or scenario file) with the requirement ID first and a space: `describe('AB-4 claim_item takes a lease', …)`, `sim/scenarios/AB-8.missing-verb-opens-one-item.ts`. A title may lead with an ID only if it proves that requirement's clauses (tracker R36). Fixture IDs use the prefix `ZZ-`.
- A scenario is `defineScenario({ id, title, run })` returning `{ state }`; the runner supplies the events and checks replay against the projection. Scenarios assert with `node:assert/strict`.
- Kernel behaviour over the world that is not a scenario goes in `sim/kernel/*.test.ts`; schema behaviour in `packages/db/*.test.ts` on `databaseTargets` from `@uw/db/test-targets`; property tests in `tools/properties/*.test.ts`.
- `apps/uw-app` tests: pure and Workers-runtime tests are `*.test.ts` (the `workers` Vitest project, no database); anything with a database is `*.pg.test.ts` (the `node` project) on `withAppDatabase` or `createMigratedDatabase(testServer)`, wrapped in `describe.skipIf(!testServer)`. MCP tests drive the app with the SDK `Client` over `StreamableHTTPClientTransport` whose `fetch` is `(url, init) => app.request(url, init, fixtureAccessEnv)`, with Access JWTs from `createAccessFixture()` (`apps/uw-app/testing/access-keys.ts`).
- Locally `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test` (a private local Postgres 16 server, already running); CI uses the `postgres:16` service container. No test may need a live account or a secret (PRD DX-8); the only environment variables test code reads are `TEST_DATABASE_URL`, `CI` and `PATH`.
- Every test file that opens an embedded Postgres (directly or through `createWorld`) has `afterAll(closeEmbeddedTemplate)` and closes every world or database it opens.
- Fixed ids are UUIDs in the repo's patterns (`00000000-0000-4000-8000-00000000000N`; sim people `simPersonId(n)`). The bootstrap migration seeds person `00000000-0000-4000-8000-000000000001` (`ian.lindsley@unfoldingword.org`) with org admin.
- Single-file runs: `pnpm vitest run <file>` (add `--project workers` or `--project node` when the file is ambiguous); one scenario: `pnpm sim -- <ID>`.

**Verify and commit**

- At the end of every task, from the worktree root: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. It must be green and the server tests must have run, not skipped. Run `pnpm format` first.
- Commits are Conventional Commits. The body names the requirement IDs on its own line, for example `AB-4 AB-6`. No `Co-Authored-By` line and no attribution footer of any kind. Hooks always run.

---

## Review Focus

Inputs the PRD implies but no requirement spells out, most likely to bite a person first. Each has its test in the owning task.

1. **A device identity naming another person.** A principal built anywhere (a queue message, a test helper, a future Workflow) as `agent:<B>/laptop` with person A's `personId`. Expected: `principalSchema` refuses it; the kernel refuses it `not_permitted` on claim and treats it as not holding B's item on release. Tests: Task 2 (fixtures and `principal.test.ts`), Task 3 (`sim/kernel/owner-binding.test.ts`).
2. **A delegation id that belongs to someone else.** Expected: the same `delegation_not_found` and detail as an id that does not exist, so ids cannot be probed. Test: Task 3.
3. **Aliases and case variants of the forbidden verbs.** `approve`, `Approve`, `APPROVE`, `approve_item`, `gate_approve`, `merge_pr`, `deploy`, `publish_page`, `advance`, `advance_item`, ` approve`, and the unserved `list_gifts`. Expected: each is the unknown-tool error and changes nothing; no tool name contains a forbidden verb. Test: Task 12.
4. **An owner's grant revoked between two calls of one runner.** Expected: the next request mints with the narrowed grants; a claim on the area is `not_permitted`; losing the last `editor` grant refuses minting `not_permitted`. Test: Task 9 and Task 13.
5. **An agent saving over a confirmed page.** `write_page` with the id and version of an `active` learning or persona. Expected: `not_permitted` `{ why: 'gated_page' }`, no new version, status unchanged. Test: Task 14.

---

## File map

```
packages/harness/index.ts, testing.ts, package.json; .dependency-cruiser.mjs;
  tools/architecture/{connector-callers,system-principal,lock-keys}.test.ts; sim/kernel/exit-guard.test.ts   Task 1
CONTEXT.md; packages/contracts/{identity,principal,harness,page-types,registry,version}.ts,
  contract-lock.json, fixtures/**; packages/core/principal.test.ts; apps/*/package.json                   Task 2
packages/harness/{access.ts,delegations/acting.ts,items/release.ts,items/learning.ts};
  sim/kernel/{owner-binding,learning,delegation-guard}.test.ts; packages/db/store/claim-race.test.ts        Task 3
packages/contracts/{verbs,verb-io,event-evidence,closed-sets,agent-commands,platform-commands,
  registry,index,version}.ts, verb-fixtures/**, fixtures/**; docs/PRD.md                                  Task 4
packages/core/acl.ts, acl.test.ts; tools/properties/readable-areas.test.ts                                  Task 5
packages/db/{schema,schema-platform,columns,checks}.ts, migrations/0010_*; AGENTS.md;
  packages/db/agent-boundary-tables.test.ts; apps/uw-app/{tasks/store,agents/service-tokens}.ts (owns)     Task 6
apps/uw-app/tasks/store.ts, store.pg.test.ts; docs/exceptions.md                                            Task 7
apps/uw-app/agents/{service-tokens,routes}.ts, service-tokens.pg.test.ts; apps/uw-app/app.tsx               Task 8
apps/uw-app/{deps.ts,auth/principal-middleware.ts}, mcp/mint.ts, mint.test.ts, mint.pg.test.ts              Task 9
packages/harness/reads/{index,item,poll}.ts, kernel.ts, index.ts; sim/scenarios/AB-4.*; sim/kernel/reads.test.ts  Task 10
packages/harness/ports.ts; packages/db/store/pages.ts; packages/db/test-seed.ts;
  packages/harness/port-contracts/store-gateways.ts; packages/harness/personas/{tool-check,activate,commands}.ts;
  sim/scenarios/AB-8.*; sim/kernel/persona-activation.test.ts                                               Task 11
apps/uw-app/package.json; apps/uw-app/mcp/{context,handler,tools,dispatch,server,routes,in-process}.ts,
  mcp/verbs/{index,get-health}.ts; apps/uw-app/app.tsx; apps/uw-app/testing/mcp.ts; tests                  Task 12
apps/uw-app/mcp/verbs/{poll-queue,claim-item,submit-to-gate,record-run-step}.ts;
  apps/uw-app/mcp/harness-verbs.pg.test.ts; tools/properties/submit-human-gate.test.ts                      Task 13
apps/uw-app/pages/{reads,agent-write}.ts; apps/uw-app/mcp/verbs/{search-pages,read-page,write-page}.ts;
  apps/uw-app/mcp/page-verbs.pg.test.ts; docs/exceptions.md                                                 Task 14
apps/uw-app/pages/context.ts; apps/uw-app/records/queries.ts;
  apps/uw-app/mcp/verbs/{resolve-context,query-entities,create-task}.ts; tests; docs/exceptions.md          Task 15
sim/scenarios/AB-6.*; apps/uw-app/mcp/delegated.pg.test.ts                                                  Task 16
tools/architecture/agent-boundary.ts, agent-boundary.test.ts                                                Task 17
packages/harness/gates/decide.ts; sim/agent-boundary.ts; sim/scenarios/AB-7.*;
  sim/kernel/{agent-refusals,agent-boundary-runtime}.test.ts                                                Task 18
apps/uw-app/testing/conformance.ts; apps/uw-app/mcp/conformance.pg.test.ts                                  Task 19
docs/progress_tracker.md, docs/architecture.md                                                              Task 20
```

---

### Task 1: Harden three architecture checks and take the connector exit off the public barrel

**Requirements:** step-3 re-review carries (a), (b), (c); supports AB-7 (the boundary checks must not be evadable).

**Files:**
- Create: `packages/harness/testing.ts`
- Modify: `packages/harness/index.ts` (remove the `exitThroughConnector` line), `packages/harness/package.json` (`exports` gains `"./testing": "./testing.ts"`), `.dependency-cruiser.mjs`, `sim/kernel/exit-guard.test.ts`, `tools/architecture/connector-callers.test.ts`, `tools/architecture/system-principal.test.ts`, `tools/architecture/lock-keys.test.ts`

**Interfaces:**
- Produces: `@uw/harness/testing` exporting `exitThroughConnector` (from `./gates/exit.ts`), importable only from test files. `packages/harness/gates/approve-at-ship.ts` keeps importing it from `./exit.ts`.

- [ ] **Step 1: Write the failing checks**

`tools/architecture/connector-callers.test.ts`:
- `sources()` accepts `/\.(?:tsx?|m?js)$/` and excludes test files by `/\.test\.(?:tsx?|m?js)$/`.
- Add a planted case: a file `planted.mjs` containing `await ports.connectors.run(request);` is flagged by `filesMatching(connectorRun, …)`, and a planted `exit-caller.js` containing `exitThroughConnector(ports, context, pending)` is flagged by `connectorExitCall`.
- Add `'packages/harness/testing.ts'` to the files allowed to name `exitThroughConnector` without calling it (it only re-exports); keep every existing assertion.

`.dependency-cruiser.mjs`: a rule

```js
{
  name: 'harness-testing-only-in-tests',
  comment: 'The connector exit and other test-only kernel entry points are imported only by test files.',
  severity: 'error',
  from: { pathNot: testFile },
  to: { path: '^packages/harness/testing\\.ts$' },
},
```

where `testFile` is the pattern the file already defines for test files.

`tools/architecture/system-principal.test.ts`:
- Replace `composition = ['apps/uw-app/', 'sim/']` with an allowlist: `sim/` (every file), `apps/uw-app/cron/` (the lease-sweep wiring, P8; the directory does not exist yet), and any `apps/` test file (`/\.test\.tsx?$/`). Everything else in `apps/` that names the system principal is flagged.
- Add mention patterns for constructed strings: `/agent:\$\{\s*['"`]system['"`]\s*\}/`, `/['"`]agent:['"`]\s*\+\s*['"`]system['"`]/` and `/['"`]agent:sys['"`]\s*\+/`.
- New `it.each` flag cases: `['apps/uw-app/mcp/server.ts', 'const actor = systemPrincipal();']`, `['apps/uw-app/x.ts', 'const id = `agent:${"system"}`;']`, `['packages/harness/y.ts', "const id = 'agent:' + 'system';"]`. New allow cases: `['apps/uw-app/cron/lease-sweep.ts', 'kernel.items.expireLeases({ actor: systemPrincipal(), traceId })']`, `['apps/uw-app/harness/claims.pg.test.ts', 'systemPrincipal()']`.

`tools/architecture/lock-keys.test.ts`:
- `numericLocks` also flags any `pg_try_advisory_` call, any `_shared` variant, and a key that is an uncast template slot: the pattern becomes

```ts
const forbiddenLock =
  /pg_try_advisory_|pg_advisory_(?:xact_)?lock(?:_shared)?\(\s*(?:\d|\$\{)/;
```

  (`advisoryLock(key)` in `packages/db/advisory-locks.ts` writes `pg_advisory_xact_lock(hashtextextended(${key}, 0))`, which starts with `hashtextextended`, so it passes.)
- New flag cases: `'SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0))'`, ``'sql`SELECT pg_advisory_xact_lock(${n})`'``, `'SELECT pg_advisory_lock_shared(42)'`. Keep the two existing cases. Rename the describe to say it covers try, shared and uncast keys.

Run: `pnpm vitest run tools/architecture/connector-callers.test.ts tools/architecture/system-principal.test.ts tools/architecture/lock-keys.test.ts`
Expected: FAIL on the new cases (the `.mjs` plant is not scanned; template constructions are not caught; try and uncast locks are not flagged).

- [ ] **Step 2: Implement**

Make the three checks pass as specified. Create `packages/harness/testing.ts`:

```ts
export { exitThroughConnector } from './gates/exit.ts';
```

Remove `export { exitThroughConnector } from './gates/exit.ts';` from `packages/harness/index.ts`; change `sim/kernel/exit-guard.test.ts` to import `exitThroughConnector` from `@uw/harness/testing` (its other imports stay on `@uw/harness`). Grep the repo for `exitThroughConnector` and confirm the only importers are `approve-at-ship.ts`, `testing.ts` and the sim test.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness tools/architecture sim/kernel/exit-guard.test.ts .dependency-cruiser.mjs
git commit -m "fix(architecture): the connector exit leaves the public barrel, and the connector, system-principal and lock-key checks cover .mjs, constructed identities, try and uncast locks" -m "AB-7 KN-5 KN-13"
```

### Task 2: Device identities bound to their owner, reserved persona slugs, and the words for them (contract 4.0.0)

**Requirements:** AB-2 (SECURITY carry: an `agent:<person>/<device>` identity's owner segment is `principal.personId`), AB-6 (the delegated identity form is built in one place), step-3 re-review carry (f).

**Files:**
- Modify: `CONTEXT.md` (own commit, first)
- Modify: `packages/contracts/identity.ts`, `principal.ts`, `harness.ts`, `page-types.ts`, `registry.ts`, `version.ts`, `contract-lock.json`; fixtures under `packages/contracts/fixtures/{principal,persona-identity,persona-frontmatter,device-segment,persona-slug}/`; `packages/contracts/contracts.test.ts` if it enumerates registry keys
- Modify: `apps/uw-app/package.json`, `apps/uw-ingest/package.json` (`"contractVersion": "4.0.0"`)
- Modify: `packages/core/principal.test.ts` (new cases), and any test that parses a principal whose device segment is not its person id (grep `/laptop`, `/builder`, `kim/`: `sim/kernel/delegations.test.ts` line 235 builds `kim/laptop …`; make it `${kim.personId}/laptop …`)

**Interfaces:**
- Produces (from `@uw/contracts`):

```ts
export const reservedPersonaSlugs = ['system', 'ingest'] as const;
export const devicePattern = '^[a-z0-9][a-z0-9-]{0,31}$';
export const deviceSegmentSchema: z.ZodString;
export const personaSlugSchema: z.ZodType<string>;
export function deviceOwnerSegment(identity: string): string | null;
export function delegationIdOf(identity: string): string | null;
export function personaSlugOf(identity: string): string | null;
export function delegatedIdentity(device: string, personaSlug: string, delegationId: string): string;
export function isPersonaIdentity(value: string): boolean;
```

- [ ] **Step 1: Words first (own commit)**

Add to `CONTEXT.md`, after **Agent identity**:

```markdown
**Device**:
The second segment of `agent:<person>/<device>`: a lowercase name a person gives one of their machines or routines (`laptop`, `hourly-routine`). The first segment is the person's id, so a device identity always names its owner. A person's login names the device in the `x-uw-device` header; a service token's device comes from its binding.
_Avoid_: host (that is where a run executes), machine id, client

**Service token binding**:
A row of `service_tokens` that maps one Cloudflare Access service token (by its client id) to the person it acts for and the device it is. Only an org admin binds or revokes one. A token with no live binding cannot reach the MCP surface.
_Avoid_: API key, agent account, allow-list
```

```bash
git add CONTEXT.md
git commit -m "docs(context): device and service token binding" -m "AB-2 AB-6"
```

- [ ] **Step 2: Write the failing fixtures and tests**

Fixtures (each a JSON file):
- `fixtures/principal/invalid/device-of-another-person.json`: identity `agent:00000000-0000-4000-8000-000000000002/laptop`, kind `agent`, personId `00000000-0000-4000-8000-000000000001`, email null, grants `[]`, interactive true.
- `fixtures/principal/invalid/device-without-person.json`: identity `agent:00000000-0000-4000-8000-000000000001/laptop`, personId null.
- `fixtures/principal/invalid/delegated-of-another-person.json`: identity `agent:00000000-0000-4000-8000-000000000002/laptop as iterate via delegation:00000000-0000-4000-a000-000000000009`, personId `…0001`.
- `fixtures/principal/valid/device-of-its-person.json` and `valid/delegated-of-its-person.json`: the same with matching ids.
- `fixtures/persona-identity/invalid/system.json` (`"agent:system"`), `invalid/ingest.json` (`"agent:ingest"`).
- `fixtures/persona-frontmatter/invalid/reserved-identity.json`: a valid persona frontmatter with `identity: "agent:system"`.
- `fixtures/device-segment/{valid/laptop.json ("laptop"), valid/routine.json ("hourly-routine"), invalid/upper.json ("Laptop"), invalid/slash.json ("a/b"), invalid/long.json (33 characters)}`.
- `fixtures/persona-slug/{valid/iterate.json, invalid/system.json, invalid/ingest.json, invalid/space.json ("my persona")}`.

`packages/core/principal.test.ts`: `describe('AB-2 a device identity is owned by its principal\'s person', …)`: `parsePrincipal` refuses each invalid fixture above and accepts each valid one; `systemPrincipal()` and `ingestPrincipal()` still parse.

`packages/contracts/contracts.test.ts` (or a new `identity.test.ts`): `describe('AB-6 the delegated identity is built in one place', …)`: `delegatedIdentity('agent:p1/laptop', 'iterate', 'd1')` is `'agent:p1/laptop as iterate via delegation:d1'`; `deviceOwnerSegment` of that is `'p1'`, of `'agent:iterate'` is `null`, of `'human:p1'` is `null`; `delegationIdOf` of it is `'d1'`, of `'agent:p1/laptop'` is `null`; `personaSlugOf` of it is `'iterate'`, of `'agent:iterate'` is `'iterate'`, of `'agent:p1/laptop'` is `null`.

Run: `pnpm vitest run packages/contracts packages/core/principal.test.ts`
Expected: FAIL (the schemas accept the mismatched principals and the reserved slugs; the helpers do not exist).

- [ ] **Step 3: Implement**

`packages/contracts/identity.ts` gains:

```ts
const AGENT = 'agent:';
const ASSUMING = ' as ';
const VIA_DELEGATION = ' via delegation:';

export const reservedPersonaSlugs = ['system', 'ingest'] as const;
const reserved: ReadonlySet<string> = new Set(reservedPersonaSlugs);

export const devicePattern = '^[a-z0-9][a-z0-9-]{0,31}$';
export const deviceSegmentSchema = z
  .string()
  .regex(new RegExp(devicePattern), 'a device is lowercase kebab-case, at most 32 characters');

export const personaSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'a persona slug is lowercase')
  .refine((slug) => !reserved.has(slug), 'that persona slug is reserved for the platform');

export function deviceOwnerSegment(identity: string): string | null {
  if (!identity.startsWith(AGENT)) return null;
  const slash = identity.indexOf('/');
  return slash < 0 ? null : identity.slice(AGENT.length, slash);
}

export function delegationIdOf(identity: string): string | null {
  const at = identity.lastIndexOf(VIA_DELEGATION);
  return at < 0 ? null : identity.slice(at + VIA_DELEGATION.length);
}

export function personaSlugOf(identity: string): string | null {
  if (!identity.startsWith(AGENT)) return null;
  const asAt = identity.indexOf(ASSUMING);
  const viaAt = identity.indexOf(VIA_DELEGATION);
  if (asAt >= 0 && viaAt > asAt) return identity.slice(asAt + ASSUMING.length, viaAt);
  return identity.includes('/') ? null : identity.slice(AGENT.length);
}

export function delegatedIdentity(device: string, personaSlug: string, delegationId: string): string {
  return `${device}${ASSUMING}${personaSlug}${VIA_DELEGATION}${delegationId}`;
}

export function isPersonaIdentity(value: string): boolean {
  return (
    value.startsWith(AGENT) && !value.includes('/') && !value.includes(' ') &&
    !reserved.has(value.slice(AGENT.length))
  );
}
```

`principal.ts`: chain a second `.refine` after the existing one:

```ts
.refine((principal) => {
  const owner = deviceOwnerSegment(principal.identity);
  return owner === null || (principal.personId !== null && owner === principal.personId);
}, 'an agent:<person>/<device> identity names its principal\'s person');
```

`harness.ts`: `personaIdentitySchema = identitySchema.refine(isPersonaIdentity, 'a persona identity is agent:<persona>, not a reserved name')`. `page-types.ts`: the persona frontmatter's `agentIdentity` uses the same `isPersonaIdentity` refine. `registry.ts` gains `'device-segment': deviceSegmentSchema` and `'persona-slug': personaSlugSchema`. `CONTRACT_VERSION = '4.0.0'`; append the `4.0.0` lock entry (the closed sets are unchanged; the major marks the tightened principal and persona schemas); move both apps' `contractVersion`.

Then fix every test that the tightened schema now refuses (grep for principal parses with a device segment that is not a person id).

- [ ] **Step 4: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/contracts apps/uw-app/package.json apps/uw-ingest/package.json
git commit -m "feat(contracts): a device identity names its principal's person, the delegated form is built in one place, and system and ingest are reserved persona slugs; contract 4.0.0" -m "Shared root packages/contracts: principalSchema now refuses an agent:<person>/<device> principal whose owner segment is not its personId, because the kernel trusts device identities to be owner-specific (step-3 carry). Rejected: checking only at the minting edge, since principals are also built for queues and Workflows." -m "AB-2 AB-6"
git add packages/core sim
git commit -m "test(core): a principal naming another person's device is refused" -m "AB-2"
```

(If no file outside `packages/contracts` and the two `package.json` files changed, the second commit carries only the new core tests.)

### Task 3: The kernel refuses a device identity that is not its owner's, hides foreign delegations, and makes attach a holder's act

**Requirements:** AB-2 (the kernel binds the owner segment too), AB-6 (a delegation is usable only by its person), step-3 re-review carries (d) and (e), step-3 carry "a direct two-connection store test of `write.claim` without the locks" (KN-5).

**Files:**
- Modify: `packages/harness/access.ts`, `packages/harness/delegations/acting.ts`, `packages/harness/items/release.ts`, `packages/harness/items/learning.ts`; `packages/harness/delegations/commands.ts` only if `beatIn` answers a foreign delegation differently from an unknown one
- Create: `sim/kernel/owner-binding.test.ts`, `packages/db/store/claim-race.test.ts`
- Modify: `sim/kernel/learning.test.ts`, `sim/kernel/delegation-guard.test.ts` (expectations that change)

**Interfaces:**
- Produces: `export function ownerBound(actor: Principal): boolean` in `packages/harness/access.ts` (true when the identity has no device segment, or the segment equals `actor.personId`).

- [ ] **Step 1: Write the failing tests**

`sim/kernel/owner-binding.test.ts`, `describe('AB-2 the kernel refuses a device identity that is not its owner\'s', …)`. Principals here are object literals typed `Principal` (bypassing the schema on purpose, as a crafted queue message would):
- editor A (`simPerson(world, 4, editor 80-89)`) and editor B (`simPerson(world, 5, …)`); the Package stage made agent-claimable with `kernel.stages.updateStage(admin, { harnessId, stageKey: 'package', change: { agentPickup: 'allowed' } })` and an item enqueued there (enqueue lands in Package);
- `crafted = { identity: \`agent:${B.personId}/laptop\`, kind: 'agent', personId: A.personId, email: null, grants: A.grants, interactive: true }`: `claim` is `not_permitted` with detail `why: 'owner_mismatch'`, and the item's log gains nothing;
- B's own device `agent:${B.personId}/laptop` (personId B) claims; then `crafted` calling `release`, `recordRunStep` and `submit` on that item is refused (`not_holder` or `not_permitted`), and the item still holds B's device.

`describe('AB-6 a delegation id that belongs to someone else reads as one that does not exist', …)`: admin K grants a delegation to `agent:iterate` on the harness; admin L's bare `agent:iterate` (personId L, non-interactive) claiming with K's delegation id gets exactly `{ status: 'error', reason: 'delegation_not_found', detail: { delegationId } }`, deep-equal to the reply for a random unknown uuid; no `delegation_lapsed` or other event is written. K's own `agent:iterate` with a delegation for another persona still gets `not_permitted`.

`sim/kernel/learning.test.ts`, new `describe('KN-7 attaching a learning is the holder\'s act, or a person\'s with write', …)`: a suggested learning page seeded with `seedPage`; an agent device (editor owner) that does not hold the item is `not_holder`; the agent holding the item (claimed under its lease) attaches and `learning_attached` is recorded with the agent's identity; an editor person who does not hold the item attaches; a viewer person is `not_permitted`.

`packages/db/store/claim-race.test.ts`, `describe.skipIf(!testServer)('KN-5 write.claim is one conditional update: of two transactions racing it without the kernel\'s locks, exactly one wins', …)`: on `createMigratedDatabase(testServer)` with two `createClient` connections and `createDrizzleStore` over each, seed a harness, a stage and an unheld item (`seedHarness`, `seedItem` from `@uw/db/test-seed`); transaction 1 calls `tx.harnessItems.write.claim({ holder: 'agent:a', … })` and then waits on a promise; transaction 2 calls `write.claim({ holder: 'agent:b', … })` (it blocks on the row lock; wait until `lockWaiters` from `@uw/db/store` shows it waiting); release transaction 1 to commit; transaction 2's claim returns `false`; the row's holder is `agent:a`. Then the same with transaction 1 rolled back: transaction 2 returns `true`.

Run: `pnpm vitest run sim/kernel/owner-binding.test.ts sim/kernel/learning.test.ts packages/db/store/claim-race.test.ts`
Expected: FAIL on the owner-mismatch claim, on the foreign delegation (`not_permitted` today) and on the non-holding agent's attach (accepted today). The claim race may already pass; if it does, change `write.claim`'s `WHERE` by hand to drop its condition, see it fail, and restore it.

- [ ] **Step 2: Implement**

- `access.ts`: `ownerBound` using `deviceOwnerSegment` from `@uw/contracts`.
- `acting.ts`: `actingPrincipal` first refuses `refused('not_permitted', { why: 'owner_mismatch' })` when `!ownerBound(caller.actor)`. In `delegatedPrincipal`, right after the null check: `if (delegation.personId !== caller.actor.personId) return refused('delegation_not_found', { delegationId });` (the same object as for a missing row), then the persona and harness binding (`not_permitted`), then liveness. Apply the same rule to `beatIn` in `delegations/commands.ts` if it answers a foreign delegation differently.
- `release.ts`: `holdsClaim` returns `false` when `!ownerBound(actor)`.
- `learning.ts`: `attachLearning`'s standing: an agent caller (`isAgent`) must hold the item (`holdsClaim(tx, item, caller.actor, { itemId, delegationId: item.delegationId })`, else `not_holder`) and its acting principal is checked with the item's `delegationId`; a person needs `write` on the area as today. `markNothingLearned` is unchanged.
- Update the existing tests whose expected reasons change (the foreign-delegation cases in `delegation-guard.test.ts`), keeping their intent.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness sim packages/db/store/claim-race.test.ts
git commit -m "fix(harness): refuse a device identity that is not its owner's, answer a foreign delegation as an unknown one, and make attaching a learning a holder's act" -m "AB-2 AB-6 KN-5 KN-7 KN-16"
```

### Task 4: Contracts for the surface: verb summaries and inputs, the activation failure, task status, service-token commands (contract 5.0.0)

**Requirements:** AB-1 (each tool carries a description from the registry), AB-4 (`submit_to_gate` input), AB-5 (`create_task` input; task status), AB-2 (service-token binding commands), AB-8 (`persona_activation_failed` evidence), CT-3.

**Files:**
- Modify: `packages/contracts/verbs.ts`, `verb-io.ts`, `event-evidence.ts`, `closed-sets.ts`, `platform-commands.ts`, `registry.ts`, `index.ts`, `version.ts`, `contract-lock.json`, `verbs.test.ts`
- Create: `packages/contracts/agent-commands.ts`
- Fixtures: `verb-fixtures/submit_to_gate/input/**`, `verb-fixtures/create_task/input/**`, `fixtures/{task-status,persona-activation-refusal,bind-service-token-command,revoke-service-token-command,service-client-id,platform-command-name}/**`, the `persona_activation_failed` cases in the event fixtures
- Modify: `apps/uw-app/package.json`, `apps/uw-ingest/package.json` (`5.0.0`)
- Modify: `docs/PRD.md` (own commit)

**Interfaces:**
- Produces:

```ts
export type VerbDefinition = { …existing; readonly summary: string };
export type VerbManifestEntry = { …existing; readonly summary: string };
export const taskStatusSchema: z.ZodEnum<['suggested', 'open', 'done', 'dismissed']>;
export const personaActivationRefusalSchema: z.ZodEnum<['unknown_verb', 'forbidden_verb', 'not_permitted']>;
export const serviceClientIdSchema: z.ZodString;
export const bindServiceTokenCommandSchema; export type BindServiceTokenCommand;
export const revokeServiceTokenCommandSchema; export type RevokeServiceTokenCommand;
```

- [ ] **Step 1: Write the failing tests and fixtures**

`verbs.test.ts`: `describe('AB-1 every verb carries a summary a tool list can show', …)`: every entry's `summary` is non-empty, at most 200 characters, sentence case (first character upper case), has no `!`, and the manifest serialises it. Fixtures:
- `submit_to_gate/input/valid/with-pr.json` `{ itemId, evidence: {}, to: null, pullRequest: { repo: "unfoldingWord/uw-platform", number: 7 }, head: "abc1234" }`, `valid/plain.json` (all three null), `valid/loop.json` (`to: "scope"`, the others null); `invalid/pr-without-head.json`, `invalid/head-without-pr.json`, `invalid/missing-to.json`, `invalid/bad-stage-key.json` (`to: "Scope"`).
- `create_task/input/valid/*.json` gain `jdArea: "80-89"`; `invalid/missing-area.json`.
- `task-status` and `persona-activation-refusal`: one valid per value, one invalid each.
- `bind-service-token-command`: valid `{ command: "bind_service_token", requestId, clientId: "abc123.access", personId, device: "hourly-routine" }`; invalid with device `"Routine"`, with empty `clientId`, without `personId`. `revoke-service-token-command`: valid and invalid likewise. `platform-command-name` valid fixtures for the two new names.
- event fixtures: a valid `persona_activation_failed` event with evidence `{ pageId, persona: "agent:iterate", verb: "summarise_measurements", reason: "unknown_verb", message: "persona iterate requires verb summarise_measurements, which does not exist", itemId }`; invalid with `reason: "nope"` and with `persona: "agent:system"`.

Run: `pnpm vitest run packages/contracts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`verbs.ts`: `verb(name, group, grant, summary, servedInV1 = true)`; the registry's summaries, exactly:

| Verb | Summary |
|---|---|
| `search_pages` | Search the pages you may read by text, optionally of one page type. |
| `read_page` | Read one page you may read. |
| `write_page` | Create a page or save a new version of one; learning, skill and persona pages land as suggested for a person to confirm. |
| `resolve_context` | For an item, get its stage's instructions page, its package pages and the confirmed learnings that apply, most specific first. |
| `query_entities` | Run one named, whitelisted query with its parameters; rows you could not read directly are never returned. |
| `create_task` | Suggest a task in an area, attributed to you, for a person to confirm. |
| `list_gifts` | List gifts since a date, in areas 40 to 49. Not served in v1. |
| `create_draft_journal_entry` | Draft a journal entry, in areas 20 to 29. Not served in v1. |
| `poll_queue` | List the items you may claim now on the harnesses you work. |
| `claim_item` | Claim an item; an agent's claim takes a 15-minute lease. An unattended runner names its delegation. |
| `submit_to_gate` | Submit your work on an item to its stage's exit gate; a human gate parks the item for a person. |
| `record_run_step` | Record one step of your run with its tokens; it renews your lease and warns when the lease is near expiry. |
| `get_health` | Get the agent-plane health of one harness you may see. |

`verb-io.ts`: `submit_to_gate.input` becomes

```ts
z.object({
  itemId: z.uuid(),
  evidence: json,
  to: stageKeySchema.nullable(),
  pullRequest: pullRequestRefSchema.nullable(),
  head: z.string().min(1).max(64).nullable(),
}).refine(
  (input) => (input.pullRequest === null) === (input.head === null),
  'a pull request and its head come together',
)
```

(import `stageKeySchema` and `pullRequestRefSchema` from `./harness.ts`; confirm no import cycle with `pnpm vitest run packages/contracts`). `create_task.input` gains `jdArea: jdAreaSchema`.

`closed-sets.ts`: `taskStatusSchema`. `event-evidence.ts`: `personaActivationRefusalSchema` and

```ts
persona_activation_failed: z.strictObject({
  pageId: id,
  persona: personaIdentitySchema,
  verb: z.string().regex(/^[a-z][a-z_]*$/),
  reason: personaActivationRefusalSchema,
  message: text,
  itemId: id.nullable(),
}),
```

`agent-commands.ts`:

```ts
export const serviceClientIdSchema = z.string().trim().min(1).max(200);
export const bindServiceTokenCommandSchema = z.object({
  command: z.literal('bind_service_token'),
  requestId: z.uuid(),
  clientId: serviceClientIdSchema,
  personId: z.uuid(),
  device: deviceSegmentSchema,
});
export const revokeServiceTokenCommandSchema = z.object({
  command: z.literal('revoke_service_token'),
  requestId: z.uuid(),
  clientId: serviceClientIdSchema,
});
export type BindServiceTokenCommand = z.infer<typeof bindServiceTokenCommandSchema>;
export type RevokeServiceTokenCommand = z.infer<typeof revokeServiceTokenCommandSchema>;
```

`platform-commands.ts` adds `'bind_service_token'`, `'revoke_service_token'`. Register `task-status`, `persona-activation-refusal`, `service-client-id`, `bind-service-token-command`, `revoke-service-token-command`; export the new file from `index.ts`. `CONTRACT_VERSION = '5.0.0'`, lock entry, app pins.

- [ ] **Step 3: The PRD names what the contract now holds (own commit)**

`docs/PRD.md` 8.1 gains two rows: `| tasks | id, jd_area, title, page, due, status (task status), created_by, trace id, created at | the tasks module, through create_task |` and `| service_tokens | client id, person, device, bound by, bound at, revoked at, trace id | the service-token command, org admin only |`. 8.3 gains `| task status | suggested, open, done, dismissed |` and `| persona activation refusal | unknown_verb, forbidden_verb, not_permitted |`.

- [ ] **Step 4: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/contracts apps/uw-app/package.json apps/uw-ingest/package.json
git commit -m "feat(contracts): verb summaries, submit_to_gate's loop target and pull request, create_task's area, task status, the activation failure and the service-token commands; contract 5.0.0" -m "Shared root packages/contracts: the MCP surface needs a description per tool, the submit and task inputs the handlers pass on, and the binding commands minting needs." -m "AB-1 AB-2 AB-4 AB-5 AB-8 CT-3"
git add docs/PRD.md
git commit -m "docs(prd): the tasks and service_tokens tables, task status and the activation refusal set" -m "AB-2 AB-5 AB-8"
```

### Task 5: The areas a principal may read, from the same rule as `can()`

**Requirements:** AB-5 (`search_pages` and `query_entities` return only rows the principal may read; the filter must be in the query, not after a limit).

**Files:**
- Modify: `packages/core/acl.ts` (own commit), `packages/core/acl.test.ts`
- Create: `tools/properties/readable-areas.test.ts`

**Interfaces:**
- Produces:

```ts
export type ReadableAreas =
  | { readonly kind: 'all' }
  | { readonly kind: 'some'; readonly areas: readonly JdArea[] };
export function readableAreas(actor: Principal, at: Date): ReadableAreas;
```

- [ ] **Step 1: Write the failing tests**

`acl.test.ts`, `describe('AB-5 readableAreas names exactly the areas can() lets a principal read', …)`: org viewer → `all`; editor on 80-89 → `all` (editors read every area); viewer on 80-89 and viewer on 30-39 → `some` `['30-39', '80-89']` (sorted, distinct); an expired viewer grant (expiresAt at or before `at`) → `some` `[]`; no grants → `some` `[]`.

`tools/properties/readable-areas.test.ts`, `describe('AB-5 readableAreas agrees with can(read) for every grant set and area', …)`: fast-check over arrays of up to 5 grants (role, scope kind, area from the ten `N0-N9` areas, expiry before, at or after `at`, or null) and every one of the ten areas: `can(principal, 'read', { kind: 'area', area }, at)` holds exactly when `readableAreas` is `all` or lists the area. `numRuns: 300`.

Run: `pnpm vitest run packages/core/acl.test.ts tools/properties/readable-areas.test.ts`
Expected: FAIL (`readableAreas` does not exist).

- [ ] **Step 2: Implement** in `acl.ts` over the existing `isLive` and `grantAllows` logic: any live grant that allows `read` on the org resource, or any live `jd_area` grant whose role reaches `editor`, gives `all`; otherwise the sorted, distinct `scopeArea`s of the live `jd_area` grants.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/core/acl.ts
git commit -m "feat(core): readableAreas, the areas can() lets a principal read, for filters inside a query" -m "Shared root packages/core/acl.ts: search and records must filter in SQL, not after a limit, so the read rule is exported as data beside can()." -m "AB-5"
git add packages/core/acl.test.ts tools/properties/readable-areas.test.ts
git commit -m "test(core): readableAreas agrees with can(read) for every grant set and area" -m "AB-5"
```

### Task 6: The schema splits by domain, and gains `tasks` and `service_tokens`

**Requirements:** AB-5 (the `tasks` table, P20), AB-2 (the `service_tokens` table), FD-5 (every table classified; the drift check holds).

**Files:**
- Create: `packages/db/schema-platform.ts`, `packages/db/columns.ts`, `packages/db/migrations/0010_agent_boundary_tables.sql` (generated) and its meta, `packages/db/agent-boundary-tables.test.ts`
- Modify: `packages/db/schema.ts`, `packages/db/checks.ts` (`DEVICE_PATTERN`), `AGENTS.md` (own commit)
- Create (owner constants only): `apps/uw-app/tasks/store.ts` (`export const owns = ['tasks'] as const;`), `apps/uw-app/agents/service-tokens.ts` (`export const owns = ['service_tokens'] as const;`), following `packages/harness/measurements/owns.ts`, an owner with no writer yet, so the owners check sees every table claimed

**Interfaces:**
- Produces (through `@uw/db/schema`, which re-exports `schema-platform.ts`): `tasks`, `serviceTokens`; every existing export unchanged.

- [ ] **Step 1: Write the failing table tests**

`packages/db/agent-boundary-tables.test.ts` on `databaseTargets` (embedded and, when set, the server):
- `describe('AB-5 tasks hold a suggested task in an area, attributed to an identity', …)`: an insert with status `suggested`, `jd_area` `80-89`, `created_by` `agent:<uuid>/laptop` succeeds; status `bogus`, area `8-89`, `created_by` `someone`, a blank title, and a `page_id` naming no page are each refused with the named constraint (`tasks_status_known`, `tasks_area_form`, `tasks_created_by_is_identity`, `tasks_title_not_blank`, the page foreign key).
- `describe('AB-2 service_tokens bind one client id to one person\'s device', …)`: a binding inserts; a second row with the same `client_id` is refused (primary key); device `Laptop` is refused (`service_tokens_device_form`); `bound_by` `agent:x` is refused (`service_tokens_bound_by_is_human`); two live rows for one person and device are refused (`service_tokens_one_live_device`), and allowed once the first has `revoked_at`.

Run: `pnpm vitest run packages/db/agent-boundary-tables.test.ts`
Expected: FAIL (the tables do not exist).

- [ ] **Step 2: Split the schema without changing a table**

Create `packages/db/columns.ts` exporting the `instant` helper now private in `schema.ts`. Move `people`, `roleGrants`, `grantAudit`, `pages`, `pageVersions`, `webhookDeliveries` and `queueWatermarks`, unchanged, to `packages/db/schema-platform.ts` (with the imports they use). `schema.ts` imports `pages` and `people` from `./schema-platform.ts` for the harness tables' references and adds `export * from './schema-platform.ts';`. `schema-platform.ts` never imports `schema.ts` (dependency-cruiser `no-circular`).

Run: `pnpm vitest run tools/db/drift.test.ts packages/db/declarations.test.ts tools/architecture/owners.test.ts tools/architecture/event-read-path.test.ts`
Expected: PASS with no new migration. If the drift check reports a change, drizzle-kit is not reading the re-exported tables: set `schema: ['./schema.ts', './schema-platform.ts']` in `packages/db/drizzle.config.ts`, let `unmigratedChanges` in `tools/db/drift.ts` take `string | readonly string[]` and pass each with `--schema`, and rerun until it reports nothing.

- [ ] **Step 3: Add the two tables**

In `schema-platform.ts`:

```ts
export const tasks = declareTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    jdArea: text('jd_area').notNull(),
    title: text('title').notNull(),
    pageId: uuid('page_id').references(() => pages.id),
    due: date('due', { mode: 'string' }),
    status: text('status').notNull(),
    createdBy: text('created_by').notNull(),
    traceId: uuid('trace_id').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    check('tasks_status_known', oneOf(t.status, taskStatusSchema.options)),
    check('tasks_area_form', matches(t.jdArea, JD_AREA_PATTERN)),
    check('tasks_created_by_is_identity', matches(t.createdBy, IDENTITY_PATTERN)),
    check('tasks_title_not_blank', sql`length(btrim(${t.title})) > 0`),
    index('tasks_area_status').on(t.jdArea, t.status),
  ],
);

export const serviceTokens = declareTable(
  'service_tokens',
  {
    clientId: text('client_id').primaryKey(),
    personId: uuid('person_id').notNull().references(() => people.id),
    device: text('device').notNull(),
    boundBy: text('bound_by').notNull(),
    boundAt: instant('bound_at').notNull(),
    revokedAt: instant('revoked_at'),
    traceId: uuid('trace_id').notNull(),
  },
  { classification: 'restricted', offlineEligibility: 'never' },
  (t) => [
    check('service_tokens_device_form', matches(t.device, DEVICE_PATTERN)),
    check('service_tokens_bound_by_is_human', matches(t.boundBy, HUMAN_IDENTITY_PATTERN)),
    uniqueIndex('service_tokens_one_live_device')
      .on(t.personId, t.device)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);
```

`checks.ts` gains `export const DEVICE_PATTERN = devicePattern;` (from `@uw/contracts`). Generate: `pnpm db:generate --name agent_boundary_tables`; confirm the SQL creates exactly the two tables, their checks and indexes. Create the two owner-constant files listed above.

- [ ] **Step 4: AGENTS.md says where a table goes (own commit)**

In section 1, the Schema row becomes: "Drizzle in `packages/db/schema.ts` is the only schema; it re-exports one `packages/db/schema-<domain>.ts` file per domain (platform, and later GitHub) so no file passes 500 lines; migrations in `packages/db/migrations/`; every table declares `classification` and `offline_eligibility` (plan §2.6)". In rule 1, the table template becomes: "New table or column: the `packages/db/schema.ts` file for its domain (`schema.ts` for the harness, `schema-platform.ts` for the platform) with its classification, and a migration."

- [ ] **Step 5: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/db/schema.ts packages/db/schema-platform.ts packages/db/columns.ts packages/db/checks.ts packages/db/migrations packages/db/drizzle.config.ts tools/db
git commit -m "feat(db): the platform tables move to schema-platform.ts, re-exported by schema.ts, and gain tasks and service_tokens" -m "Shared root packages/db/schema.ts: the file reached 496 of 500 lines; splitting by domain keeps schema.ts the one schema everyone imports and drizzle-kit reads. Rejected: squeezing imports to fit two more tables, which step 5's six tables would break again." -m "AB-2 AB-5 FD-5"
git add AGENTS.md
git commit -m "docs(agents): a table goes in the schema file for its domain, which schema.ts re-exports" -m "Shared root AGENTS.md: section 1 and rule 1 follow the schema split." -m "AB-2 AB-5"
git add packages/db/agent-boundary-tables.test.ts apps/uw-app/tasks/store.ts apps/uw-app/agents/service-tokens.ts
git commit -m "test(db): tasks and service_tokens refuse what their checks name, and each has its owner" -m "AB-2 AB-5"
```

### Task 7: The tasks module

**Requirements:** AB-5 (`create_task` creates a `suggested` task attributed to the agent; `open_tasks` returns no row the principal could not read).

**Files:**
- Modify: `apps/uw-app/tasks/store.ts`, `docs/exceptions.md` (same commit, row first)
- Create: `apps/uw-app/tasks/store.pg.test.ts`

**Interfaces:**
- Produces:

```ts
export type TaskRow = {
  readonly taskId: string; readonly jdArea: JdArea; readonly title: string;
  readonly pageId: string | null; readonly due: string | null; readonly status: TaskStatus;
  readonly createdBy: string;
};
export type NewTask = {
  readonly taskId: string; readonly jdArea: JdArea; readonly title: string;
  readonly pageId: string | null; readonly due: string | null;
};
export type TaskResult =
  | { readonly ok: true; readonly task: TaskRow }
  | { readonly ok: false; readonly reason: ErrorReason };
export function createTask(db: Database, actor: Principal, task: NewTask, traceId: string, at: Date): Promise<TaskResult>;
export function openTasks(db: Executor, actor: Principal, jdArea: JdArea, at: Date): Promise<readonly TaskRow[]>;
```

- [ ] **Step 1: Write the failing test**

`describe.skipIf(!testServer)('AB-5 create_task records a suggested task attributed to its creator', …)` on `withAppDatabase`: an agent principal (`agentOf(editor, 'laptop')`) creates a task in 80-89 → `ok`, status `suggested`, `createdBy` the agent identity, `created_at` the given instant; a viewer-only agent → `not_permitted`; a `pageId` the actor cannot read → `page_not_found`; a `pageId` that does not exist → `page_not_found`. `describe(… 'AB-5 open_tasks returns no task the principal could not read', …)`: tasks in 80-89 and 30-39; a viewer on 30-39 sees only 30-39's; an editor sees both areas' when asked for each; `done` and `dismissed` tasks are left out; at most 50, ordered by `created_at` then id.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-app/tasks/store.pg.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

Add the exceptions row first: `| 2026-10-02 | Rule 2: application code reaches Postgres only through a port | apps/uw-app/tasks/store.ts | A platform module, not kernel code: it owns tasks and writes it with Drizzle directly, as pages/store.ts does for pages. | Revisit when a kernel module needs tasks. |`. Then `createTask` (can `write` on the area, `readPage` from `../pages/store.ts` for the page check, one insert) and `openTasks` (empty unless `can(actor, 'read', area, at)`).

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add apps/uw-app/tasks docs/exceptions.md
git commit -m "feat(uw-app): the tasks module creates a suggested task attributed to its creator and lists the open tasks of an area the caller may read" -m "AB-5"
```

### Task 8: Service-token bindings, bound and revoked by an org admin

**Requirements:** AB-2 (agent identities are minted from Access credentials: a service token reaches its owner through a binding).

**Files:**
- Modify: `apps/uw-app/agents/service-tokens.ts`, `apps/uw-app/app.tsx` (mount `/api/agents`), `docs/exceptions.md` (row first)
- Create: `apps/uw-app/agents/routes.ts`, `apps/uw-app/agents/service-tokens.pg.test.ts`

**Interfaces:**
- Produces:

```ts
export type ServiceTokenBinding = { readonly personId: string; readonly device: string };
export function bindServiceToken(db: Database, actor: Principal, command: BindServiceTokenCommand, traceId: string, at: Date): Promise<CommandResult>;
export function revokeServiceToken(db: Database, actor: Principal, command: RevokeServiceTokenCommand, at: Date): Promise<CommandResult>;
export function liveBinding(db: Executor, clientId: string): Promise<ServiceTokenBinding | null>;
export function agentRoutes(): Hono<AppEnv>;
```

`POST /api/agents/commands/:name` with `bind_service_token` or `revoke_service_token`, built like `apps/uw-app/pages/routes.ts` (a `Map` of handlers, `readJson`, `malformed`, `reply(toOutcome(...))`); any other name is `not_wired`.

- [ ] **Step 1: Write the failing test**

`describe.skipIf(!testServer)('AB-2 an org admin binds a service token to a person\'s device', …)` through `createApp(postgresDeps(db, fixture)).request(…)` with Ian's JWT: bind `{ clientId: 'routine-1.access', personId: <editor>, device: 'hourly-routine' }` → `accepted`, and `liveBinding(db, 'routine-1.access')` is that person and device; binding it again → `grant_exists`; an area admin (not org) → `not_permitted`; a target who holds only `viewer` → `not_permitted`; a pending target → `pending_approval`; an unknown person → `person_not_found`; a service-token caller → `not_permitted`; revoke → `accepted` and `liveBinding` is null; revoke again → `grant_not_found`; a malformed body → `malformed_command`.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-app/agents/service-tokens.pg.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

Exceptions row first (the same shape as Task 7's, for `apps/uw-app/agents/service-tokens.ts` and `service_tokens`). Both commands run in one transaction: refuse any caller whose `kind` is not `person` (`not_permitted`); re-read the caller's grants with `resolveGrants(tx, actor.personId, { at })` and require `can(fresh, 'admin', { kind: 'org' }, at)`; for bind, `lockPerson` the target (`person_not_found`, `pending_approval` when pending), require a live `editor` or `admin` grant for the target, insert with `bound_by` the caller's identity and map the primary-key or live-device unique violation (`23505`) to `grant_exists`; for revoke, set `revoked_at` where it is null (`grant_not_found` when nothing changed). Reuse `pgErrorCode` and `pgConstraint` from `@uw/db/errors`.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add apps/uw-app/agents apps/uw-app/app.tsx docs/exceptions.md
git commit -m "feat(uw-app): an org admin binds an Access service token to a person's device, and revokes it" -m "AB-2"
```

### Task 9: Agent identities minted at the edge

**Requirements:** AB-2 (minted from Access credentials, grants at or below the owner's, a lost grant is lost on the next request, `editor` may mint under themselves), AB-6 (the delegated form from the runner's headers), AB-3 (the principal minted at the edge is the one the handler receives: `c.get('principal')` is replaced by the minted one).

**Files:**
- Modify: `apps/uw-app/deps.ts` (Variables gain `access: AccessIdentity | null`), `apps/uw-app/auth/principal-middleware.ts` (sets `access`; the dev path sets `{ kind: 'person', email }`)
- Create: `apps/uw-app/mcp/mint.ts`, `apps/uw-app/mcp/mint.test.ts`, `apps/uw-app/mcp/mint.pg.test.ts`

**Interfaces:**
- Produces:

```ts
export const DEVICE_HEADER = 'x-uw-device';
export const PERSONA_HEADER = 'x-uw-persona';
export const DELEGATION_HEADER = 'x-uw-delegation';
export type AgentClaim = {
  readonly device: string | null;
  readonly delegation: { readonly personaSlug: string; readonly delegationId: string } | null;
};
export function agentClaimOf(header: (name: string) => string | undefined): AgentClaim | null;
export function mayMint(grants: readonly Grant[], at: Date): boolean;
export function mintAgent(
  owner: { readonly personId: string; readonly grants: readonly Grant[] },
  device: string,
  delegation: AgentClaim['delegation'],
  interactive: boolean,
): Principal;
export function withAgentPrincipal(): MiddlewareHandler<AppEnv>;
```

`agentClaimOf` returns `null` (malformed) when a present device fails `deviceSegmentSchema`, when exactly one of the persona and delegation headers is present, or when either fails `personaSlugSchema` or `z.uuid()`. `mintAgent` builds the identity `agent:<personId>/<device>`, or `delegatedIdentity(that, slug, id)`, and returns `principalSchema.parse({ identity, kind: 'agent', personId, email: null, grants: [...owner.grants], interactive })`.

`withAgentPrincipal`, after `withPrincipal`:
1. `access` null → `refuse(c, 'unauthenticated')`; `database` null → `database_not_configured`.
2. claim `null` → `malformed_command` (400).
3. A person (`access.kind === 'person'`): the device header is required (`malformed_command` without it); the owner is the person principal already minted (fresh grants).
4. A service token: `liveBinding(db, access.clientId)` → null → `unauthenticated` (401); the owner's person must be active (`pending_approval` otherwise, through the people directory's read); grants `resolveGrants(db, personId, { at: c.get('now') })`; a device header, when present, must equal the binding's device (`malformed_command`); `interactive: false`.
5. `!mayMint(owner.grants, now)` → `not_permitted` (403).
6. `c.set('principal', mintAgent(...))`.

`mayMint`: some grant with role `editor` or `admin` whose `expiresAt` is null or after `at`.

- [ ] **Step 1: Write the failing tests**

`mint.test.ts` (Workers pool, pure): `describe('AB-2 an agent identity is minted under its owner with exactly the owner\'s grants', …)`: `mintAgent` gives `agent:<id>/laptop`, kind `agent`, the owner's grants deep-equal, `interactive` as passed; with a delegation, `agent:<id>/laptop as iterate via delegation:<id>`; `mayMint` is true for editor and admin at any scope, false for viewer only, false for an expired editor grant. `describe('AB-6 a runner names its persona and delegation together or not at all', …)`: `agentClaimOf` cases for each malformed shape listed above, and the reserved slug `system`.

`mint.pg.test.ts`: a test-only Hono app `new Hono<AppEnv>()` using `observe(deps)`, `withDatabase(deps)`, `withPrincipal(deps)`, `withAgentPrincipal()` and a `GET /probe` returning `c.get('principal')`. `describe.skipIf(!testServer)('AB-2 the edge mints agent identities from Access credentials', …)`:
- a person JWT plus `x-uw-device: laptop` → `agent:<personId>/laptop`, interactive, the person's grants;
- no device header → 400 `malformed_command`; viewer-only person → 403 `not_permitted`; no JWT → 401;
- revoke the person's editor grant (the grants command or `revokeSeededGrant`) between two requests → the second is 403 `not_permitted`; with editor on 80-89 and admin on 30-39, revoking 80-89 → the second principal's grants no longer include 80-89;
- a service-token JWT (`fixture.sign({ common_name: 'routine-1.access' })`) bound to an editor → `agent:<personId>/hourly-routine`, `interactive: false`; unbound → 401 `unauthenticated`; revoked binding → 401; a device header that differs from the binding → 400;
- with `x-uw-persona: iterate` and `x-uw-delegation: <uuid>` → the delegated identity.

Run: `pnpm vitest run --project workers apps/uw-app/mcp/mint.test.ts`, then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-app/mcp/mint.pg.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement** as specified. Keep `withAgentPrincipal` within the function limits by splitting the person and service-token owners into two helpers that return the owner or a `Response`.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add apps/uw-app/deps.ts apps/uw-app/auth apps/uw-app/mcp
git commit -m "feat(uw-app): mint agent:<person>/<device>, and its delegated form, at the edge from an Access login or a bound service token, with exactly the owner's grants" -m "AB-2 AB-3 AB-6"
```

### Task 10: Kernel reads for the surface: one harness, one item, one stage, and the queue

**Requirements:** AB-4 (`poll_queue` returns items in stages whose pickup is `allowed` or `auto`, on harnesses the persona subscribes to, filtered by `can()`; `get_health` scoped by `can()`), AB-5 (`resolve_context` and `query_entities` read through the kernel).

**Files:**
- Create: `packages/harness/reads/index.ts`, `packages/harness/reads/scene.ts`, `packages/harness/reads/poll.ts`, `sim/scenarios/AB-4.poll-returns-what-the-caller-may-claim.ts`, `sim/kernel/reads.test.ts`
- Modify: `packages/harness/kernel.ts` (member `reads`), `packages/harness/index.ts` (export the types)

**Interfaces:**
- Produces:

```ts
export type HarnessScene = { readonly harness: Harness; readonly stages: readonly Stage[] };
export type ItemScene = { readonly item: ItemState; readonly harness: Harness; readonly stage: Stage };
export type PollItem = {
  readonly itemId: string; readonly harnessId: string; readonly stage: string;
  readonly title: string; readonly priority: number;
};
export type KernelReads = {
  harness(caller: Caller, input: { readonly harnessId: string }): Promise<KernelOutcome<HarnessScene>>;
  item(caller: Caller, input: { readonly itemId: string }): Promise<KernelOutcome<ItemScene>>;
  inStage(caller: Caller, input: { readonly harnessId: string; readonly stageKey: string }): Promise<KernelOutcome<readonly ItemState[]>>;
  poll(caller: Caller, input: { readonly harnessId: string | null; readonly limit: number }): Promise<KernelOutcome<readonly PollItem[]>>;
};
Kernel gains: readonly reads: KernelReads;
```

Rules, each in one transaction at `ports.clock.now()`:
- `harness`: missing, or `!allowed(actor, 'read', harness, at)` → `harness_not_found` (hide what the caller may not see).
- `item`: missing item, or its harness unreadable → `item_not_found`; its stage missing → `stage_not_found`.
- `inStage`: the harness rule, then `stage_not_found`, then the items of `forHarness` in that stage, ordered by priority descending then item id.
- `poll`: `!ownerBound(actor)` → `not_permitted` `{ why: 'owner_mismatch' }`. The subscribed harnesses per decision 8 of this plan: an identity with `delegationIdOf(identity)` reads that delegation; a delegation that is missing or not its person's → `delegation_not_found`, another persona's (`personaMatches`) → `not_permitted`, not live (`assertDelegationLive`) → `delegation_lapsed` with no event recorded; its harness only. A bare `agent:<persona>` (`bareAgent`): `tx.delegations.read.live({ personId: actor.personId, persona: actor.identity, harnessId: null }, at)`'s harnesses (none when `personId` is null). Otherwise `tx.harnesses.read.list()`. Narrow by `input.harnessId`. Keep harnesses that are not paused and where `allowed(fresh, 'write', harness, at)`, `fresh` being the caller with grants `ports.grants.resolveIn(tx, actor.personId, at)` (no grants when `personId` is null). Items: `forHarness`, in a stage of that harness whose `agentPickup` is `allowed` or `auto` and which is not paused, `gateStatus` `working` or `checks_failed`, `holder` null or `leaseLapsed(item, at)`; sorted by priority descending then item id; `limit`.

- [ ] **Step 1: Write the failing scenario and tests**

`AB-4.poll-returns-what-the-caller-may-claim.ts`: software activated by Ian on 80-89 and a second software harness (`key: 'software-two'`, `jdArea: '30-39'`); Package made `allowed` on the first with `updateStage`; four items enqueued there with priorities 5, 9, 1, 9; one more item enqueued on the second harness. An editor-of-80-89 device `agent:<id>/laptop` polls with `harnessId: null`, `limit: 10` and gets the 80-89 items in order priority 9, 9 (by id), 5, 1, and none from 30-39 (no write there). After another agent claims the priority-5 item it is gone from the poll; after its lease lapses (advance the clock 16 minutes) it is back. An item parked at a human gate is absent. A viewer device gets `[]`. On the second harness, whose Package is left at `none`, an editor of 30-39 polls nothing. `limit: 2` gives two. Return `{ state: { polled: n } }`.

`sim/kernel/reads.test.ts`:
- `describe('AB-4 a persona polls only the harnesses its live delegations name', …)`: Ian grants `agent:iterate` a delegation on the first harness; bare `agent:iterate` (personId Ian, non-interactive) polls that harness's items only; after revoke, `[]`. A delegated device `agent:<Ian>/laptop as iterate via delegation:<id>` polls that harness only; with the delegation revoked → `delegation_lapsed`, and no `delegation_lapsed` event is appended; a delegation of another person → `delegation_not_found`.
- `describe('AB-4 the kernel reads hide what the caller may not see', …)`: `reads.harness`, `reads.item` and `reads.inStage` for a viewer of another area → `harness_not_found` or `item_not_found`; for a viewer of the area → accepted.

Run: `pnpm vitest run sim/kernel/reads.test.ts && pnpm sim -- AB-4`
Expected: FAIL (`reads` does not exist).

- [ ] **Step 2: Implement** `scene.ts` (`harness`, `item`, `inStage`), `poll.ts` (the subscription as three small functions selected by a `Map` keyed on the identity's form, `'delegated' | 'persona' | 'other'`, then the filter), and `reads/index.ts` (`createKernelReads(ports)`).

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness sim
git commit -m "feat(harness): kernel reads for the surface: a harness, an item and a stage the caller may see, and the queue of items it may claim on the harnesses it works" -m "AB-4 AB-5"
```

### Task 11: Persona activation's tool check

**Requirements:** AB-8 (a missing verb fails with "persona X requires verb Y, which does not exist", enqueues one item on the software harness linked to the persona page, leaves the persona `suggested`, a second attempt opens no second item; a forbidden verb is refused with a distinct message and opens no item; a verb the creator's grants do not reach is refused; the failure is an event on the harness).

**Files:**
- Modify: `packages/harness/ports.ts` (own commit: `PageFacts` gains `readonly title: string` and `readonly frontmatter: Readonly<Record<string, unknown>>`), `packages/db/store/pages.ts`, `packages/harness/port-contracts/store-gateways.ts` (the pages facts case expects both), `packages/db/test-seed.ts` (`SeedPage` gains optional `frontmatter` and `parentId`)
- Create: `packages/harness/personas/tool-check.ts`, `tool-check.test.ts`, `activate.ts`, `commands.ts`; `sim/scenarios/AB-8.missing-verb-opens-one-item.ts`; `sim/kernel/persona-activation.test.ts`
- Modify: `packages/harness/kernel.ts` (member `personas`), `packages/harness/index.ts`

**Interfaces:**
- Produces:

```ts
export type ToolCheckFailure = {
  readonly verb: string;
  readonly reason: 'forbidden_verb' | 'unknown_verb' | 'not_permitted';
  readonly message: string;
};
export function toolCheck(
  input: {
    readonly personaSlug: string;
    readonly verbs: readonly string[];
    readonly owner: Principal;
    readonly area: JdArea;
    readonly at: Date;
  },
  registry?: readonly VerbDefinition[],
): ToolCheckFailure | null;
export type PersonaCommands = {
  activate(caller: Caller, input: { readonly pageId: string }): Promise<KernelOutcome<never>>;
};
Kernel gains: readonly personas: PersonaCommands;
export const SOFTWARE_HARNESS_KEY = 'software';
```

`toolCheck` takes the union of `requires_tools` and `toolset`, in order, and reports the first failure of the first kind found in this order: any forbidden verb (`FORBIDDEN_VERBS`), then any verb that is not a registered and served verb (`findVerb(name)?.servedInV1 !== true`), then any verb whose grant the owner does not reach (`resource_area`: `can(owner, actionForVerbRole(role), { kind: 'area', area }, at)`; `fixed_area`: the same on `grant.area`; `null`: always reached). Messages, exactly:
- `unknown_verb`: `persona ${slug} requires verb ${verb}, which does not exist`
- `forbidden_verb`: `persona ${slug} names ${verb}, which no agent may hold`
- `not_permitted`: `persona ${slug} requires verb ${verb}, which its owner's grants do not reach`

`activate`, in one transaction:
1. `isAgent(caller.actor)` → `not_permitted` (no event).
2. Page facts: missing or not type `persona` → `page_not_found`; frontmatter fails `personaFrontmatterSchema` → `invalid_frontmatter`.
3. The persona's harness (`frontmatter.harness`) → `harness_not_found`.
4. `ports.grants.lockAndReread(tx, personId, at)`; not `admin` on the harness's area → `not_permitted` (no event).
5. Page status not `suggested` → `not_permitted` `{ why: 'not_suggested' }`.
6. The owner (`frontmatter.owner`, `human:<id>`): `resolveIn(tx, ownerId, at)`; `toolCheck`.
7. A failure: when `unknown_verb`, the harness with key `software` (`tx.harnesses.read.byKey`) and, in it, an item with `pageId` equal to the persona page whose `gateStatus` is not `done` (`forHarness`); none → `createItem` in its lowest-position stage with title the message, `pageId` the persona page, priority 0, due null, actor the caller (decision 14). Append `persona_activation_failed` on the persona's harness with `{ pageId, persona: frontmatter.identity, verb, reason, message, itemId }` (`itemId` null when no item, or when there is no software harness). Return `refused(reason, { verb, message, itemId })`.
8. No failure → `refused('not_wired', { step: 'PE-3' })`.

The page is never written: its status stays `suggested`.

- [ ] **Step 1: The port change (own commit)**

Change `PageFacts`, the Drizzle pages gateway (select `title` and `frontmatter`), the store-gateways contract case and `seedPage`. Run `pnpm vitest run sim/adapters/store.contract.test.ts packages/harness` and commit:

```bash
git add packages/harness/ports.ts packages/db/store/pages.ts packages/harness/port-contracts/store-gateways.ts packages/db/test-seed.ts
git commit -m "feat(harness): page facts carry the title and frontmatter" -m "Shared root packages/harness/ports.ts: persona activation reads the persona page's frontmatter through the Store." -m "AB-8"
```

- [ ] **Step 2: Write the failing tests and scenario**

`tool-check.test.ts`, `describe('AB-8 the tool check names the first verb a persona cannot have', …)`: an all-served toolset an editor reaches → `null`; `['search_pages', 'summarise_measurements']` → `unknown_verb` with the exact message; `['list_gifts']` → `unknown_verb` (unserved); `['approve', 'nope']` → `forbidden_verb` (forbidden is reported first) with its exact message; `['claim_item']` for an owner with `viewer` only → `not_permitted`; a fixture registry with a served `fixed_area` verb `editor(40-49)` and an owner without it → `not_permitted`.

`AB-8.missing-verb-opens-one-item.ts`: software on 80-89 and BML on 30-39 activated by Ian; a persona page seeded on 30-39 with status `suggested` and frontmatter `{ identity: 'agent:iterate', owner: 'human:<editor 30-39>', harness: <bml id>, toolset: ['search_pages'], run_shape: 'workflow-run', engine: 'openrouter-messages', model: 'glm-5.3-flash', budget: { monthly_minor: 0, currency: 'USD' }, capability: 'iterate', requires_tools: ['search_pages', 'summarise_measurements'] }`. Ian activates → `unknown_verb`, detail `message` exactly `persona iterate requires verb summarise_measurements, which does not exist`; the BML harness's log ends with `persona_activation_failed` carrying that message and the item id; the software harness has one new item in Package titled the message with `pageId` the persona page; the page is still `suggested`. A second attempt → the same refusal, a second `persona_activation_failed` naming the same item id, still one item. Return `{ state: { items: 1, failures: 2 } }`.

`sim/kernel/persona-activation.test.ts`, `describe('AB-8 activation refuses a forbidden verb, an unreachable verb, and a caller who may not activate', …)`: `requires_tools: ['approve']` → `forbidden_verb` with its message, one `persona_activation_failed`, no new item; an owner with `viewer` on 30-39 and `claim_item` → `not_permitted` with its message and an event, no item; an editor (not admin) calling activate → `not_permitted`, no event; an agent caller → `not_permitted`, no event; an all-served toolset → `not_wired` `{ step: 'PE-3' }`, no event, status still `suggested`; a non-persona page → `page_not_found`.

Run: `pnpm vitest run packages/harness/personas sim/kernel/persona-activation.test.ts && pnpm sim -- AB-8`
Expected: FAIL.

- [ ] **Step 3: Implement** as specified.

- [ ] **Step 4: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness sim
git commit -m "feat(harness): persona activation runs the tool check: a missing verb opens one item on the software harness, a forbidden or unreachable verb opens none, and every failure is an event" -m "AB-8"
```

### Task 12: The MCP surface: the endpoint, the tool list from the registry, and the one dispatcher

**Requirements:** AB-1 (a Streamable HTTP MCP endpoint in `uw-app` behind Access; the tool list is the registry and nothing else; forbidden verbs absent under any name; calling one is the unknown-tool error), AB-2 (role-gated verbs offered only to a principal whose owner holds the area grant), AB-3 (every handler goes through `can()` with the area; the principal minted at the edge is the one the handler receives).

**Files:**
- Modify: `apps/uw-app/package.json` (the two dependencies), `pnpm-lock.yaml`, `apps/uw-app/app.tsx` (mount `app.route('/mcp', mcpRoutes(deps))` after `withPrincipal`), `apps/uw-app/deps.ts`, `apps/uw-app/kernel.ts`, `apps/uw-app/auth/principal-middleware.ts`, `apps/uw-app/testing/deps.ts`, `apps/uw-app/testing/postgres.ts` (the clock seam below), `knip.json` only if needed
- Create: `apps/uw-app/mcp/context.ts`, `handler.ts`, `tools.ts`, `dispatch.ts`, `server.ts`, `routes.ts`, `in-process.ts`, `verbs/index.ts`, `verbs/get-health.ts`; `apps/uw-app/testing/mcp.ts`; tests `apps/uw-app/mcp/tools.test.ts`, `server.test.ts` (Workers pool), `routes.pg.test.ts`

**Interfaces:**
- Produces:

```ts
export type McpHost = 'external' | 'workflow';
export type VerbContext = {
  readonly principal: Principal;
  readonly host: McpHost;
  readonly at: Date;
  readonly traceId: string;
  readonly kernel: Kernel;
  readonly db: Database;
  readonly commit: string;
  readonly logger: Logger;
};

export type VerbInput<N extends VerbName> = z.infer<(typeof verbIo)[N]['input']>;
export type VerbOutput<N extends VerbName> = z.infer<(typeof verbIo)[N]['output']>;
export type VerbRefusal = { readonly status: 'error'; readonly reason: ErrorReason; readonly detail: Detail };
export type VerbReply<N extends VerbName> =
  | { readonly status: 'accepted'; readonly output: VerbOutput<N> }
  | VerbRefusal;

export type GatedHandler<N extends VerbName> = {
  readonly kind: 'gated';
  readonly name: N;
  readonly hiddenAs: ErrorReason;
  resource(context: VerbContext, input: VerbInput<N>): Promise<AclResource | VerbRefusal>;
  run(context: VerbContext, input: VerbInput<N>): Promise<VerbReply<N>>;
};
export type RowFilteredHandler<N extends VerbName> = {
  readonly kind: 'rows';
  readonly name: N;
  run(context: VerbContext, input: VerbInput<N>): Promise<VerbReply<N>>;
};
export type VerbHandler = GatedHandler<VerbName> | RowFilteredHandler<VerbName>;
export function gatedHandler<N extends VerbName>(handler: Omit<GatedHandler<N>, 'kind'>): GatedHandler<N>;
export function rowFilteredHandler<N extends VerbName>(handler: Omit<RowFilteredHandler<N>, 'kind'>): RowFilteredHandler<N>;
export function refusal(reason: ErrorReason, detail?: Detail): VerbRefusal;
export function fromKernel<T, N extends VerbName>(outcome: KernelOutcome<T>, output: (value: T) => VerbOutput<N>): VerbReply<N>;

export function toolsFor(principal: Principal, at: Date, registry?: readonly VerbDefinition[]): Tool[];
export function servedVerb(name: string, principal: Principal, at: Date, registry?: readonly VerbDefinition[]): VerbDefinition | null;
export function callVerb(context: VerbContext, name: string, args: unknown, handlers: ReadonlyMap<string, VerbHandler>): Promise<CallToolResult>;
export function createVerbServer(context: VerbContext, handlers?: ReadonlyMap<string, VerbHandler>): Server;
export function mcpRoutes(deps: Pick<AppDeps, 'clock'>): Hono<AppEnv>;
export function connectInProcess(context: Omit<VerbContext, 'host'>): Promise<Client>;
export const verbHandlers: ReadonlyMap<string, VerbHandler>;
```

(The type of `gatedHandler`'s result may need a widening helper so a `GatedHandler<'claim_item'>` sits in a `ReadonlyMap<string, VerbHandler>`; keep it typed, no `any`.)

`toolsFor`: the registry entries with `servedInV1`, and, for an entry whose grant is `fixed_area`, only when `can(principal, actionForVerbRole(role), { kind: 'area', area }, at)`; each as `{ name, description: summary, inputSchema: z.toJSONSchema(input, { io: 'input' }), outputSchema: z.toJSONSchema(output, { io: 'output' }) }`. `servedVerb` is the same test for one name.

`callVerb`, in order:
1. `servedVerb(name, …)` null → `throw new McpError(ErrorCode.InvalidParams, \`Unknown tool: ${name}\`)`.
2. No handler → refusal `not_wired`.
3. `definition.input.safeParse(args ?? {})` fails → refusal `malformed_command` with detail `{ fields: <issue paths joined by '.'> }` (never the values).
4. A `gated` handler: `resource` (a refusal returns as is); `!can(principal, 'read', resource, at)` → refusal `hiddenAs`; the action is `actionForVerbRole(grant.role)` and, for a `fixed_area` grant, the resource is `{ kind: 'area', area: grant.area }`; `!can(principal, action, resource, at)` → refusal `not_permitted`.
5. `run`. An accepted output is re-parsed with `definition.output` (a mismatch is an internal error).
6. Any throw: `PortNotWiredError` → refusal `not_wired`; anything else → `context.logger.error('verb failed', { verb: name, ...errorFields(error) })` and refusal `internal_error`. `McpError` from step 1 is not caught.

Results: accepted → `{ content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output }`; refusal → `{ content: [{ type: 'text', text: JSON.stringify({ status: 'error', reason, detail }) }], isError: true }`.

`createVerbServer`: `new Server({ name: 'uw-platform', version: CONTRACT_VERSION }, { capabilities: { tools: { listChanged: false } }, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() })`, with `ListToolsRequestSchema` → `{ tools: toolsFor(context.principal, context.at) }` and `CallToolRequestSchema` → `callVerb(context, request.params.name, request.params.arguments, handlers)`.

**The clock seam.** `AppDeps` gains `readonly clock: Clock` (`platformDeps.clock` is `systemClock`; `postgresDeps(db, fixture, sink, clock = systemClock)` and the Workers test deps pass one); `withPrincipal` reads `deps.clock.now()` where it now calls `systemClock.now()`; `platformKernel(database, clock = systemClock)` passes it to `platformPorts`. Production wiring is unchanged; tests can move one clock for the edge and the kernel together (Task 13 needs it for the lease warning and expiry).

`mcpRoutes`: `use('*', withAgentPrincipal())`; `POST /`: build the context (host `external`, `kernel: platformKernel(database, deps.clock)`, `db: database.db`, `at: c.get('now')`, `traceId`, `commit: commitOf(c.env)`, `logger: c.get('logger')`), `const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`, `await server.connect(transport)`, `const response = await transport.handleRequest(c.req.raw)`, `await server.close()`, set the request outcome, return the response. `GET /` and `DELETE /` → `405` with `Allow: POST` and body `{ status: 'error', reason: 'not_wired' }`.

`connectInProcess`: `InMemoryTransport.createLinkedPair()`, the server with `{ ...context, host: 'workflow' }`, and `new Client({ name: 'uw-workflow-host', version: CONTRACT_VERSION }, { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() })`.

`verbs/get-health.ts`: `gatedHandler({ name: 'get_health', hiddenAs: 'harness_not_found', resource: area of kernel.reads.harness, run })`, `run` per decision 13 (overall status the worst of `ok`/`amber`/`red` among indicators, ignoring `not_wired` and `not_configured`). `verbs/index.ts`: `verbHandlers = new Map(handlers.map((handler) => [handler.name, handler]))` over an array.

`testing/mcp.ts`: `httpClient(app, headers): Promise<Client>` (the SDK `Client` over `StreamableHTTPClientTransport(new URL('http://uw.test/mcp'), { fetch: (url, init) => app.request(url, init, fixtureAccessEnv), requestInit: { headers } })`), and `callTool(client, name, args): Promise<{ readonly isError: boolean; readonly body: Record<string, unknown> }>` parsing the text content.

- [ ] **Step 1: Install and write the failing tests**

`pnpm --filter @uw/uw-app add @modelcontextprotocol/sdk@^1.31.0 @cfworker/json-schema@^4.1.1`.

`tools.test.ts` (Workers pool):
- `describe('AB-1 the tool list is the served registry and nothing else', …)`: for an editor's agent principal, `toolsFor(...).map((tool) => tool.name)` equals `verbRegistry.filter((verb) => verb.servedInV1).map((verb) => verb.name)` (eleven names, registry order); each tool's description is the registry summary and its `inputSchema.type` is `'object'`; no tool name contains any of `approve`, `merge`, `deploy`, `publish`, `advance` (case-insensitive substring).
- `describe('AB-2 a role-gated verb is offered only to a principal whose owner holds its area grant', …)`: a fixture registry (`ZZ-` names are not needed; reuse `list_gifts` with `servedInV1: true`) lists it for a principal with `editor(40-49)` and not for one with `editor(80-89)`; an expired `editor(40-49)` grant does not list it.

`server.test.ts` (Workers pool, proving the SDK runs in workerd), with a stub handler map:
- `describe('AB-1 the verb server runs in workerd', …)`: `createVerbServer` with an in-memory pair and a `Client` using the cfworker validator: `listTools` returns the served tools; a raw `POST` through `WebStandardStreamableHTTPServerTransport` (an `initialize` JSON-RPC request with `accept: application/json, text/event-stream`) returns 200 JSON with `serverInfo.name` `uw-platform`.
- `describe('AB-1 a forbidden or unknown name is the unknown-tool error', …)`: for each of `approve`, `Approve`, `APPROVE`, `approve_item`, `gate_approve`, `merge`, `merge_pr`, `deploy`, `publish`, `publish_page`, `advance`, `advance_item`, ` approve`, `list_gifts`, `nope`, `callTool` rejects with an `McpError` whose `code` is `-32602` and message `Unknown tool: <name>`, and the stub handlers were never called.
- `describe('AB-3 the handler receives the principal minted at the edge', …)`: a stub gated handler records `context.principal`; after a call it is the same object passed to `createVerbServer`; a principal without the grant gets `not_permitted` and the stub's `run` is not called; a principal that cannot read the resource gets the handler's `hiddenAs`.
- `describe('AB-4 every refusal is a closed-set reason', …)`: a stub that throws `PortNotWiredError` → `not_wired`; one that throws `Error('boom')` → `internal_error` and the text content does not contain `boom`; bad arguments → `malformed_command` with field paths only.

`routes.pg.test.ts`, `describe.skipIf(!testServer)('AB-1 /mcp is a Streamable HTTP endpoint behind Access', …)`: no JWT → 401; a tampered JWT → 401; an editor's JWT with `x-uw-device: laptop` → the SDK client initialises, `listTools` gives the eleven served names, `callTool('get_health', { harnessId })` on a harness in 80-89 → accepted with indicator names `harness, database, spend, breaker, runs_today, live_delegations, gate_refusals_week, agent_writes, stale_learnings` and the `not_wired` ones marked so; a viewer of another area calling `get_health` → `harness_not_found`; `callTool('approve', {})` → unknown-tool error; `GET /mcp` → 405 with `Allow: POST`.

Run: `pnpm vitest run --project workers apps/uw-app/mcp`, then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-app/mcp/routes.pg.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement** as specified. Keep each file under 500 lines and each function under 50.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS, including `pnpm build` (the Worker bundles the SDK's web-standard transport) and `pnpm audit:prod`.

```bash
git add apps/uw-app pnpm-lock.yaml knip.json
git commit -m "feat(uw-app): the MCP surface at /mcp: tools listed from the verb registry, one dispatcher that gates every handler with can(), unknown names refused as unknown tools" -m "AB-1 AB-2 AB-3 AB-4"
```

### Task 13: The harness verbs

**Requirements:** AB-4 (`poll_queue`, `claim_item` through KN-5 with a `delegation_id`, `submit_to_gate` through KN-6 with no argument or path past a human gate, `record_run_step` renewing the lease, reporting tokens with the cost basis by host and writing the play-by-play event, a step on an expired lease refused, lease expiry and warning on claim and step responses, every refusal in the closed set), AB-3 (every write records the agent identity in the event log).

**Files:**
- Create: `apps/uw-app/mcp/verbs/poll-queue.ts`, `claim-item.ts`, `submit-to-gate.ts`, `record-run-step.ts`; `apps/uw-app/mcp/harness-verbs.pg.test.ts`; `tools/properties/submit-human-gate.test.ts`
- Modify: `apps/uw-app/mcp/verbs/index.ts`

**Interfaces:**
- Consumes: `kernel.reads.poll`, `kernel.reads.item`, `kernel.items.claim`, `kernel.items.submit`, `kernel.items.recordRunStep`; `gatedHandler`, `rowFilteredHandler`, `fromKernel`, `refusal`.
- Produces: four handlers. `poll_queue` is `rowFilteredHandler` (registry grant null; the kernel filters by `can()`); the others are `gatedHandler` with `hiddenAs: 'item_not_found'` and `resource` = `{ kind: 'area', area }` of `kernel.reads.item`'s harness. The caller is `{ actor: context.principal, traceId: context.traceId }`.
  - `claim_item` → `kernel.items.claim(caller, { itemId, delegationId })` → `{ itemId, leaseExpiresAt, leaseWarning }`.
  - `submit_to_gate` → `kernel.items.submit(caller, { itemId, to, evidence, change })` with `change = pullRequest && head ? { pullRequest, head, paths: [], declaration: null } : null` → `{ itemId, result, failures }`.
  - `record_run_step`: `const hostCostBasis = new Map<McpHost, CostBasis>([['external', 'subscription'], ['workflow', 'metered']])`; a different `costBasis` → `refusal('not_permitted', { why: 'cost_basis_is_the_hosts', expected })`; else `kernel.items.recordRunStep(caller, input)` → `{ leaseExpiresAt, leaseWarning }`.

- [ ] **Step 1: Write the failing tests**

`harness-verbs.pg.test.ts` on one migrated database through `httpClient` (an editor of 80-89 with device `laptop`; software activated by Ian through `platformKernel`, Package made `allowed` with `updateStage`, items enqueued there):
- `describe('AB-4 poll_queue lists what the runner may claim', …)`: the items in priority order; after a claim the claimed one is gone.
- `describe('AB-4 claim_item takes a lease and records the agent', …)`: `leaseExpiresAt` is about 15 minutes after the request, `leaseWarning` false; the item's `item_claimed` event actor is `agent:<personId>/laptop` (AB-3); a second runner's claim → `lease_held`; a non-interactive service-token runner without a delegation → `delegation_required`.
- `describe('AB-4 record_run_step renews the lease, reports tokens by host, and refuses an expired lease', …)`: a step with `costBasis: 'subscription'` → `run_step_recorded` with the tokens and `subscription`, a later `leaseExpiresAt`; `metered` from the HTTP surface → `not_permitted` `{ why: 'cost_basis_is_the_hosts', expected: 'subscription' }`; with the app's clock (`postgresDeps(…, clock)`, a settable clock from Task 12's seam) moved 13 minutes past the claim, the step's `leaseWarning` is true; 16 minutes later → `lease_expired`.
- `describe('AB-4 submit_to_gate parks at a human gate', …)`: after `updateStage(check, { exitGate: 'human_approval' })`, move an item to Check with the kernel (a person claims and submits it through `package`, `scope`, `plan` and `build`, whose exits are `none` or `checks` with no validators), let the runner claim it there and submit with a pull request and head → `parked`; the item did not advance.
- `describe('AB-4 every refusal through the surface is a closed-set reason', …)`: every `isError` body seen in this file parses with `refusalSchema` extended by `detail`.

`tools/properties/submit-human-gate.test.ts`, `describe('AB-4 submit_to_gate has no input that advances past a human gate', …)`: fast-check, `numRuns: 25`, one world for the file; each run makes a fresh item held by an agent at Check gated to `human_approval` (add a sim fixture `simHeldAtCheck` beside `simParkedAtCheck` in `sim/fixtures.ts`: it gates Check, enqueues, `simAdvance`s through `package`, `scope`, `plan`, `build`, and has an agent claim at Check; Ship cannot be used because its pickup is `none`), then submits with `to` drawn from every stage key, `null` and arbitrary strings, `pullRequest` and `head` drawn null together or set, and `evidence` arbitrary JSON; the result is never `advanced`, and the item's stage is unchanged afterwards.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-app/mcp/harness-verbs.pg.test.ts`, then `pnpm vitest run tools/properties/submit-human-gate.test.ts`
Expected: FAIL (`not_wired` for the four verbs).

- [ ] **Step 2: Implement** the four handlers and register them.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add apps/uw-app tools/properties sim/fixtures.ts
git commit -m "feat(uw-app): poll_queue, claim_item, submit_to_gate and record_run_step over the kernel, with the lease on every response and the cost basis set by the host" -m "AB-3 AB-4"
```

### Task 14: The page verbs

**Requirements:** AB-5 (`search_pages` and `read_page` return only pages the principal may read; `write_page` runs the page API's validation, records the agent identity, lands gated types as `suggested` and never as an edit, cannot reach a stage row), AB-3 (page version history records the agent identity).

**Files:**
- Create: `apps/uw-app/pages/reads.ts`, `apps/uw-app/pages/agent-write.ts`, `apps/uw-app/mcp/verbs/search-pages.ts`, `read-page.ts`, `write-page.ts`, `apps/uw-app/mcp/page-verbs.pg.test.ts`
- Modify: `apps/uw-app/mcp/verbs/index.ts`, `docs/exceptions.md` (a row for `pages/reads.ts`, first)

**Interfaces:**
- Produces:

```ts
export const gatedPageTypes: ReadonlySet<PageType>;
export function pageArea(db: Executor, pageId: string): Promise<JdArea | null>;
export function searchPages(
  db: Executor, actor: Principal,
  query: { readonly text: string; readonly type: PageType | null; readonly limit: number }, at: Date,
): Promise<readonly PageSummary[]>;
export function writePageAsAgent(
  db: Database, actor: Principal, input: VerbInput<'write_page'>, traceId: string, at: Date,
): Promise<PageResult>;
```

`gatedPageTypes` is `new Set(['learning', 'skill', 'persona'])`. `searchPages`: `readableAreas(actor, at)`; `some` with no areas → `[]`; SQL `WHERE to_tsvector('simple', title || ' ' || body_md) @@ websearch_to_tsquery('simple', $text)` and the type and `jd_area = ANY($areas)` filters, ordered by `ts_rank` descending then id, `LIMIT $limit`. `writePageAsAgent` per decision 9: `expectedVersion` null → `createPage` with a fresh `requestId`, status `suggested` for a gated type and `draft` otherwise; else `readPage` → `page_not_found`; a `type` or `jdArea` that differs from the stored page → `malformed_command`; a gated stored page not `suggested` → `not_permitted` `{ why: 'gated_page' }`; else `updatePage` with the stored status. It never writes Drizzle itself.

Handlers: `search_pages` `rowFilteredHandler` (its file calls `searchPages`, which filters by `readableAreas`; Task 17's check accepts either call); `read_page` `gatedHandler` `hiddenAs: 'page_not_found'`, resource the page's area (missing page → `page_not_found`); `write_page` `gatedHandler` `hiddenAs: 'page_not_found'`, resource `input.jdArea` for a create and the stored area for a save.

- [ ] **Step 1: Write the failing test**

`page-verbs.pg.test.ts` through `httpClient` (an editor of 80-89 with device `laptop`, a viewer of 30-39 with device `laptop`), pages seeded in 80-89 and 30-39:
- `describe('AB-5 search_pages and read_page return only pages the principal may read', …)`: the viewer's search for a word in both areas' pages returns only 30-39's; `read_page` of an 80-89 page → `page_not_found`; the editor finds both; `type` narrows.
- `describe('AB-5 write_page runs the page API\'s validation and records the agent', …)`: a new `product` page in 80-89 → accepted, status `draft`, and its `page_versions.edit_source` is `agent:<personId>/laptop` (AB-3); an unknown frontmatter field → `invalid_frontmatter`; a taken slug → `slug_taken`; a stale version → `stale_version`; the viewer writing in 80-89 → `not_permitted`.
- `describe('AB-5 a gated page lands as suggested and is never edited by an agent', …)`: a new `learning` → status `suggested`; saving it while `suggested` → accepted, still `suggested`; a person sets it `active` with `updatePage`; the agent's save → `not_permitted` `{ why: 'gated_page' }`, no new version, status `active`; the same for an `active` persona page; `type: 'policy'` → `malformed_command`.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-app/mcp/page-verbs.pg.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement** as specified (the exceptions row first).

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add apps/uw-app docs/exceptions.md
git commit -m "feat(uw-app): search_pages, read_page and write_page: only readable pages, the page API's validation, and learning, skill and persona pages only ever suggested" -m "AB-3 AB-5"
```

### Task 15: Context and records: `resolve_context`, `query_entities`, `create_task`

**Requirements:** AB-5 (`resolve_context` returns the stage's instructions page, the package pages and the applicable confirmed learnings, most specific first, each with `confidence` and `as_of`; `query_entities` runs only whitelisted, parameterised queries and returns no row the principal could not read directly; `create_task` creates a `suggested` task attributed to the agent), AB-1 (every served verb has its handler).

**Files:**
- Create: `apps/uw-app/pages/context.ts`, `apps/uw-app/records/queries.ts`, `apps/uw-app/mcp/verbs/resolve-context.ts`, `query-entities.ts`, `create-task.ts`, `apps/uw-app/mcp/context-verbs.pg.test.ts`, `apps/uw-app/mcp/verbs/registry.test.ts`
- Modify: `apps/uw-app/mcp/verbs/index.ts`, `docs/exceptions.md` (a row for `pages/context.ts`, first)

**Interfaces:**
- Produces:

```ts
export type ContextPages = {
  readonly instructions: PageSummary | null;
  readonly package: readonly PageSummary[];
  readonly learnings: readonly { readonly page: PageSummary; readonly confidence: EvidenceLabel; readonly asOf: string }[];
};
export function contextPages(
  db: Executor, actor: Principal,
  scope: { readonly itemPageId: string | null; readonly instructionsPageId: string | null; readonly area: JdArea },
  at: Date,
): Promise<ContextPages>;

export type EntityQuery = {
  readonly params: z.ZodType;
  run(context: VerbContext, params: unknown): Promise<readonly Record<string, JsonValue>[] | VerbRefusal>;
};
export const entityQueries: ReadonlyMap<string, EntityQuery>;
```

`contextPages` per decision 10, every page filtered by `readableAreas`. `entityQueries`: `open_tasks` (`z.object({ jdArea: jdAreaSchema })`, rows from `openTasks` as `{ taskId, title, pageId, due, status, jdArea }`) and `stage_items` (`z.object({ harnessId: z.uuid(), stageKey: stageKeySchema })`, rows from `kernel.reads.inStage` as `itemStateSchema` JSON; a kernel refusal returns as is).

Handlers: `resolve_context` `gatedHandler` `hiddenAs: 'item_not_found'`, resource the item's harness area via `kernel.reads.item`, run → `contextPages` with the item's page, the stage's `instructionsPageId` and the harness's area; `query_entities` `rowFilteredHandler`: unknown name → `refusal('malformed_command', { why: 'unknown_query' })`, params failing → `malformed_command`, else the rows; `create_task` `gatedHandler` `hiddenAs: 'not_permitted'`, resource `input.jdArea`, run → `createTask` with a fresh task id → `{ taskId, status: 'suggested' }`.

- [ ] **Step 1: Write the failing tests**

`context-verbs.pg.test.ts` through `httpClient`:
- `describe('AB-5 resolve_context returns instructions, package and confirmed learnings, most specific first', …)`: an item whose page has two children (a `product_strategy` and a `learning`) and a stage whose instructions page has a learning child, plus a third `active` learning in the area with no parent and one `suggested` learning: `instructions` is the stage's page; `package` holds the item's page and the `product_strategy` child (not the learning); `learnings` are, in order, the item-page child, the instructions child, the area-wide one, each with `confidence` and `asOf` from its frontmatter; the `suggested` one is absent; a viewer of another area → `item_not_found`.
- `describe('AB-5 query_entities runs only whitelisted queries and returns only readable rows', …)`: `open_tasks` for 30-39 by a viewer of 80-89 → `rows: []`; by an editor → the open tasks; `stage_items` for the software harness's `scope` → its items; for a harness the caller cannot read → `harness_not_found`; `query: 'drop_tables'` → `malformed_command` `{ why: 'unknown_query' }`; `open_tasks` with `params: { jdArea: '8-89' }` → `malformed_command`.
- `describe('AB-5 create_task suggests a task attributed to the agent', …)`: → `{ taskId, status: 'suggested' }`, and the row's `created_by` is the agent identity; in an area the agent cannot write → `not_permitted`.

`registry.test.ts` (Workers pool):
- `describe('AB-1 every served verb has exactly one handler and nothing else has one', …)`: the keys of `verbHandlers` equal the served registry names; each handler's `name` equals its key.
- `describe('AB-3 the gated handlers are exactly the verbs whose registry grant is not null', …)`: `kind === 'gated'` ⇔ `findVerb(name).grant !== null`.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-app/mcp/context-verbs.pg.test.ts`, then `pnpm vitest run --project workers apps/uw-app/mcp/verbs/registry.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement** as specified (the exceptions row first).

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add apps/uw-app docs/exceptions.md
git commit -m "feat(uw-app): resolve_context, the whitelisted query_entities and create_task, and every served verb has its handler" -m "AB-1 AB-3 AB-5"
```

### Task 16: Delegated runners, end to end

**Requirements:** AB-6 (a non-interactive principal claims only with a live delegation for that persona and harness, otherwise `delegation_required`; an interactive principal needs none; with a live delegation every event carries `agent:<person>/<device> as <persona> via delegation:<id>`, or `agent:<persona>` for a hosted beat; the liveness checks re-run on every `record_run_step` and `submit_to_gate`; a delegation that stops being live writes `delegation_lapsed` and the run stops).

**Files:**
- Create: `sim/scenarios/AB-6.a-delegated-runner-names-itself-and-stops-on-lapse.ts`, `apps/uw-app/mcp/delegated.pg.test.ts`
- Modify: only what the tests show is missing (expected: nothing in the kernel; the surface may need nothing beyond Task 9's headers)

- [ ] **Step 1: Write the scenario and the test**

`AB-6.…ts`: software on 80-89, Package made `allowed`, items enqueued there; admin K grants `agent:iterate` a delegation (capability `iterate`). The device `agent:<K>/hourly-routine` non-interactive without delegation headers: claim with `delegationId: null` → `delegation_required` and the item's log gains `delegation_required`. The delegated identity `agent:<K>/hourly-routine as iterate via delegation:<id>` (non-interactive): claim with `delegationId: null` → `delegation_required`; with the id → accepted, holder the delegated identity; `recordRunStep` → `run_step_recorded` whose actor is the delegated identity; `submit` at a `none` exit advances with actor the delegated identity. A second item: claimed the same way, then K's delegation revoked; `recordRunStep` → `delegation_lapsed`, and the harness log has exactly one `delegation_lapsed` for that delegation; `submit` → `delegation_lapsed` with no second `delegation_lapsed` event. An interactive device `agent:<editor>/laptop` claims a third item with no delegation. The hosted beat: `kernel.delegations.beat` for a fresh delegation gives `agent:iterate`; its claim with the id records actor `agent:iterate` and `delegationId` in the evidence. Return `{ state: { lapsed: 1 } }`.

`delegated.pg.test.ts`, `describe.skipIf(!testServer)('AB-6 a routine on a service token works only under a live delegation, and names it on every event', …)`: Ian binds `routine-1.access` to admin K's `hourly-routine`; K grants `agent:iterate` a delegation through `platformKernel(...).delegations.grant`; through `httpClient` with the service-token JWT: no delegation headers, `claim_item` with `delegationId: null` → `delegation_required`; with `x-uw-persona: iterate` and `x-uw-delegation: <id>`, `claim_item` with the id → accepted; `record_run_step` with `subscription` → accepted; the item's events since the claim all have actor `agent:<K>/hourly-routine as iterate via delegation:<id>`; after K's delegation is revoked, `record_run_step` → `delegation_lapsed`, `submit_to_gate` → `delegation_lapsed`; `x-uw-delegation` naming another person's delegation → `delegation_not_found`.

Run: `pnpm sim -- AB-6`, then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-app/mcp/delegated.pg.test.ts`
Expected: these mostly pass on the code from Tasks 3, 9, 10 and 13. Prove each can fail: remove the `delegationIdOf` branch from `withAgentPrincipal`'s identity (mint the plain device) by hand and see the actor assertions go red; restore. If anything fails for a real reason, fix it in the module that owns the behaviour and say so in the commit.

- [ ] **Step 2: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add sim/scenarios apps/uw-app
git commit -m "test(uw-app): a delegated routine claims only under a live delegation, names it on every event, and stops when it lapses" -m "AB-6"
```

### Task 17: The static boundary checks: nothing agent-reachable touches a gate, and every handler goes through `can()`

**Requirements:** AB-7 static (no route or tool handler reachable by an agent principal touches `gate_decisions`, proven by a planted fixture handler that makes the check fail), AB-3 (a static check fails the build for a handler that skips `can()`), AB-5 (`write_page` cannot reach a `harness_stages` row).

**Files:**
- Create: `tools/architecture/agent-boundary.ts`, `tools/architecture/agent-boundary.test.ts`

**Interfaces:**
- Produces:

```ts
export type SourceFiles = { readonly files: readonly string[]; read(file: string): string };
export function agentReachable(sources: SourceFiles): string[];
export function gateTouches(sources: SourceFiles, files: readonly string[]): string[];
export function handlersSkippingCan(sources: SourceFiles): string[];
```

- `agentReachable`: start from every non-test source under `apps/uw-app/mcp/` (`.ts`, `.tsx`, `.js`, `.mjs`); follow relative imports (`from './x.ts'`, `from '../pages/store.ts'`, `import('./y.ts')`) transitively while they stay inside `apps/uw-app/`; return the sorted closure. Package imports (`@uw/*`) end the walk: the kernel's own gate code is proven by KN-13 and Task 18.
- `gateTouches`: the files whose text matches

```ts
const gateReach =
  /\bgateDecisions\b|\bgate_decisions\b|\bharnessStages\b|\bharness_stages\b|\.gates\s*\??\.|\.stages\s*\??\.|\.repair\s*\??\.|\.delegations\s*\??\.\s*(?:grant|revoke)\b|\bexitThroughConnector\b|\bconnectors\s*\??\./;
```

- `handlersSkippingCan`: every non-test file in `apps/uw-app/mcp/verbs/` except `index.ts` that does not call `gatedHandler(` or `rowFilteredHandler(`; every file that calls `rowFilteredHandler(` but none of `can(`, `readableAreas(`, `searchPages(`, `.reads.poll(`, `entityQueries`; and `apps/uw-app/mcp/dispatch.ts` if it does not call `can(`.

- [ ] **Step 1: Write the failing test**

`agent-boundary.test.ts`:
- `describe('AB-7 no file an agent principal can reach touches a gate decision or a stage row', …)`: over `repoFiles()` read from disk, `gateTouches(sources, agentReachable(sources))` is `[]`, and the closure contains `apps/uw-app/mcp/dispatch.ts`, `apps/uw-app/pages/store.ts` and `apps/uw-app/tasks/store.ts` (it really follows imports).
- `describe('AB-7 the static check fails on a planted handler', …)`: a virtual `SourceFiles` holding the real files plus `apps/uw-app/mcp/verbs/approve-sneak.ts` importing `../../gates/sneak.ts`, which contains `await tx.gateDecisions.write.insert(row)` → flagged; plants each of `kernel.gates.decide(caller, input)`, `ports.connectors.run(request)`, `kernel.stages.updateStage(...)`, `kernel.delegations.grant(...)`, `db.insert(harnessStages)` and a `.mjs` variant → each flagged.
- `describe('AB-3 every MCP handler goes through can()', …)`: over the real files, `handlersSkippingCan` is `[]`; a planted `apps/uw-app/mcp/verbs/raw.ts` exporting an object literal handler → flagged; a planted `rowFilteredHandler({ name: 'search_pages', run: async () => ({ status: 'accepted', output: { pages: [] } }) })` with no filter call → flagged; a planted `dispatch.ts` without `can(` → flagged.

Run: `pnpm vitest run tools/architecture/agent-boundary.test.ts`
Expected: FAIL (the module does not exist).

- [ ] **Step 2: Implement** `agent-boundary.ts` over `repoFiles` from `tools/repo-files.ts`.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add tools/architecture
git commit -m "test(architecture): nothing an agent can reach touches a gate decision or a stage row, every MCP handler goes through can(), and planted handlers fail both checks" -m "AB-3 AB-5 AB-7"
```

### Task 18: The runtime boundary check: no agent identity, in any grant combination, writes a gate decision

**Requirements:** AB-7 runtime (for every role and scope combination and for a delegated principal, an agent identity's attempt to write a gate decision is refused and writes `gate_refused_to_agent`; the check fails on a planted fixture).

**Files:**
- Modify: `packages/harness/gates/decide.ts` (`refuseAgent`), `sim/kernel/agent-refusals.test.ts`
- Create: `sim/agent-boundary.ts`, `sim/scenarios/AB-7.no-agent-identity-writes-a-gate-decision.ts`, `sim/kernel/agent-boundary-runtime.test.ts`

**Interfaces:**
- Produces (in `sim/agent-boundary.ts`):

```ts
export type Decide = Kernel['gates']['decide'];
export type AgentAttempt = { readonly label: string; readonly actor: Principal };
export type Violation = { readonly label: string; readonly decision: GateDecision; readonly why: string };
export function agentAttempts(world: World, harnessId: string): Promise<readonly AgentAttempt[]>;
export function gateViolations(
  world: World, target: { readonly itemId: string; readonly harnessId: string },
  attempts: readonly AgentAttempt[], decide: Decide,
): Promise<readonly Violation[]>;
```

`agentAttempts`: for each grant set among no grant and the nine of roles `admin`, `editor`, `viewer` by scopes `org`, `jd_area 80-89` (the harness's area), `jd_area 30-39`, a person (`simPerson`, numbered from 20) and, for each, four identity forms: bare `agent:reviewer` interactive, device `agent:<id>/laptop` interactive, device `agent:<id>/hourly-routine` non-interactive, and a principal of kind `person` carrying an agent identity; plus, for an org admin, a delegated device `agent:<id>/laptop as iterate via delegation:<id>` and the hosted beat principal from `kernel.delegations.beat`. Labels say the grant set and form.

`gateViolations`: for each attempt and each of `approve`, `reject`, `take_over`, `override` (reason `'planted'` for override), a violation when the outcome is accepted, when the reason is not `gate_refused_to_agent` or `item_not_found`, when the reply is `gate_refused_to_agent` but the caller could not read the harness, or when the item's log did not gain exactly one `gate_refused_to_agent` with that actor; after all attempts, a violation `'gate_decisions'` if the item has any decision row, and one if the item's stage, holder or gate status changed.

`refuseAgent` (decision 15): when the item and its harness exist, record `gate_refused_to_agent` `{ decision, stage }` whatever the agent's grants, then reply `gate_refused_to_agent` when `allowed(actor, 'read', harness, at)` and `item_not_found` otherwise; a missing item or harness still records nothing and replies `item_not_found`.

- [ ] **Step 1: Write the failing scenario and tests**

`AB-7.no-agent-identity-writes-a-gate-decision.ts`: software on 80-89, an item parked at Check (`simParkedAtCheck`); `assert.deepEqual(await gateViolations(world, target, await agentAttempts(world, harness.id), world.kernel.gates.decide), [])`; return `{ state: { attempts: n, decisions: 0 } }`.

`sim/kernel/agent-boundary-runtime.test.ts`, `describe('AB-7 the runtime check fails on a planted gate command that lets an agent decide', …)`: a planted `decide` that returns `{ status: 'accepted', value: … }` for every agent → `gateViolations` is non-empty and names the accepted attempts; a planted `decide` that refuses with `not_permitted` and records nothing → non-empty (missing event).

`sim/kernel/agent-refusals.test.ts`: the case "answers item_not_found and records no event" becomes "answers item_not_found and records gate_refused_to_agent".

Run: `pnpm vitest run sim/kernel/agent-boundary-runtime.test.ts sim/kernel/agent-refusals.test.ts && pnpm sim -- AB-7`
Expected: FAIL (the viewer-of-30-39 attempts record no event).

- [ ] **Step 2: Implement** the `refuseAgent` change and `sim/agent-boundary.ts`.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness/gates/decide.ts sim
git commit -m "feat(harness): every agent attempt at a gate decision records gate_refused_to_agent, and a runtime check over every grant combination and identity form fails on a planted gate command" -m "AB-7 KN-13"
```

### Task 19: The conformance check: both hosts see the same verbs, and each verb is callable from both

**Requirements:** AB-7 conformance (the tool list served to a Workflow-host principal equals the list served to an external-runner principal with the same owner grants, equals the registry, and each verb is callable from both; the check fails on a planted fixture), D5.

**Files:**
- Create: `apps/uw-app/testing/conformance.ts`, `apps/uw-app/mcp/conformance.pg.test.ts`

**Interfaces:**
- Produces:

```ts
export type ToolSurface = { readonly host: McpHost; readonly tools: readonly Tool[] };
export function toolSurfaceMismatches(surfaces: readonly ToolSurface[], served: readonly string[]): string[];
export function callableFailures(host: McpHost, results: readonly { readonly verb: string; readonly outcome: unknown }[]): string[];
```

`toolSurfaceMismatches` reports, per surface, a name missing from or extra to `served`, and, between surfaces, a name or an `inputSchema` or `outputSchema` that differs (compare `JSON.stringify` of each tool's schemas). `callableFailures` reports a verb whose call rejected with the unknown-tool error, or whose result is neither an accepted body that parses with its output schema nor an `isError` body whose `reason` parses with `errorReasonSchema`.

- [ ] **Step 1: Write the failing test**

`conformance.pg.test.ts`, `describe.skipIf(!testServer)('AB-7 the Workflow host and an external runner see the same verbs, and each is callable from both', …)`: owner O with `admin` and `editor` on 80-89; software activated; O grants `agent:builder` a delegation (capability `build`). The Workflow-host principal is `kernel.delegations.beat(...)`'s principal, connected with `connectInProcess` (host `workflow`). The external runner is O's JWT with `x-uw-device: laptop` through `httpClient` (host `external`). `listTools` on both; `toolSurfaceMismatches([...], served)` is `[]`. Each served verb is called from both with the first valid fixture in `packages/contracts/verb-fixtures/<verb>/input/valid/` (ids that do not exist refuse with closed reasons; `record_run_step` uses each host's own cost basis); `callableFailures` is `[]` for both.

`describe('AB-7 the conformance check fails on a planted host-specific tool', …)` (in the same file, no database needed but kept beside its subject): surfaces where the workflow list has an extra `approve_item` tool, or a changed `inputSchema` for `claim_item` → mismatches name them; a planted unknown-tool rejection → `callableFailures` names the verb.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run apps/uw-app/mcp/conformance.pg.test.ts`
Expected: FAIL (the helpers do not exist).

- [ ] **Step 2: Implement** `testing/conformance.ts`.

- [ ] **Step 3: Run and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add apps/uw-app/testing/conformance.ts apps/uw-app/mcp/conformance.pg.test.ts
git commit -m "test(uw-app): the Workflow host and an external runner are served the same verbs, each callable from both, and a planted host-specific tool fails the check" -m "AB-7"
```

### Task 20: The tracker and the architecture, and step 4 marked built

**Requirements:** DX-5 (`pnpm trace:built` passes with step 4 built), `AGENTS.md` section 7 step 7.

**Files:**
- Modify: `docs/progress_tracker.md`, `docs/architecture.md`

- [ ] **Step 1: Check every requirement has its proof**

Run `pnpm trace` and confirm none of AB-1 to AB-8 is listed. For each ID, grep `sim/scenarios/` and the test titles: AB-1 (`apps/uw-app/mcp/tools.test.ts`, `server.test.ts`, `routes.pg.test.ts`, `verbs/registry.test.ts`), AB-2 (`packages/core/principal.test.ts`, `sim/kernel/owner-binding.test.ts`, `apps/uw-app/mcp/mint*.test.ts`, `apps/uw-app/agents/service-tokens.pg.test.ts`, `packages/db/agent-boundary-tables.test.ts`), AB-3 (`server.test.ts`, `harness-verbs.pg.test.ts`, `page-verbs.pg.test.ts`, `tools/architecture/agent-boundary.test.ts`), AB-4 (`sim/scenarios/AB-4.*`, `sim/kernel/reads.test.ts`, `harness-verbs.pg.test.ts`, `tools/properties/submit-human-gate.test.ts`), AB-5 (`page-verbs.pg.test.ts`, `context-verbs.pg.test.ts`, `apps/uw-app/tasks/store.pg.test.ts`, `packages/core/acl.test.ts`, `tools/properties/readable-areas.test.ts`), AB-6 (`sim/scenarios/AB-6.*`, `apps/uw-app/mcp/delegated.pg.test.ts`, `mint.test.ts`), AB-7 (`sim/scenarios/AB-7.*`, `sim/kernel/agent-boundary-runtime.test.ts`, `tools/architecture/agent-boundary.test.ts`, `apps/uw-app/mcp/conformance.pg.test.ts`), AB-8 (`sim/scenarios/AB-8.*`, `packages/harness/personas/tool-check.test.ts`, `sim/kernel/persona-activation.test.ts`).

- [ ] **Step 2: Update `docs/architecture.md`**

Rewrite "The agent boundary" to state what is built: the endpoint `POST /mcp` behind Access (stateless Streamable HTTP, JSON responses; `GET` and `DELETE` 405); minting (`x-uw-device`, `x-uw-persona`, `x-uw-delegation`; service token bindings; editor anywhere; exactly the owner's grants); the two hosts (`external` over HTTP, `workflow` in process through `connectInProcess`) and the cost basis each forces; `toolsFor` and `callVerb` (unknown tool `-32602`, the central `can()`, gated and row-filtered handlers, refusals as `isError` results with closed reasons); the three AB-7 checks and where each lives. Add `kernel.reads` and `kernel.personas` to the `Kernel` listing, and the schema split to "What is durable, and who writes it" (with `tasks` and `service_tokens` rows).

- [ ] **Step 3: Update `docs/progress_tracker.md`**

- Status table: step 4 `Built`, evidence `docs/superpowers/plans/2026-10-02-step-04-agent-boundary.md`; scenarios `sim/scenarios/AB-4.*`, `AB-6.*`, `AB-7.*`, `AB-8.*`; tests named AB-1 to AB-8 (the files of Step 1); `pnpm verify` green with `TEST_DATABASE_URL` set.
- A `## Step 4 evidence by requirement` table: each of AB-1 to AB-8, its commits (`git log --oneline` for this step, leaving out the plan) and its scenario and test files.
- Decisions made during the build: one row for each of this plan's decisions 1 to 18 (date 2026-10-02, the requirement, the decision, why, and cost if wrong), plus these rows:

| Requirement | Decision | Cost if wrong |
|---|---|---|
| AB-2 | Step-3 carry closed: `principalSchema` and the kernel (`actingPrincipal`, `holdsClaim`, `reads.poll`) bind a device identity's owner segment to `principal.personId` | A principal built outside both (no such path today) would still be refused by the kernel |
| AB-6 | Step-3 carry "capability words `iterate`, `build`, `review` all yield the same `editor` grant": AB-6 needs no narrowing (the toolset narrows verbs, the delegation binds persona and harness), so the row stays carried to step 10 | A review-only beat could claim a Build item until PE steps narrow by capability |
| KN-5 | Step-3 carry closed: `packages/db/store/claim-race.test.ts` races `write.claim` on two server connections without the kernel's locks | None |
| KN-18 | Step-3 carry "a remove-stage command, route or MCP handler enforces P17": no MCP handler reaches the stage command (Task 17's check forbids it), so the row stays for step 6 | None for the MCP surface |
| AB-7 | Step-3 re-review carry (a): `exitThroughConnector` leaves the public barrel for `@uw/harness/testing`, imported only by tests (dependency-cruiser `harness-testing-only-in-tests`); the connector-callers check scans `.js` and `.mjs` | None |
| KN-5 | Carry (b): the system-principal check allows `sim/`, `apps/uw-app/cron/` and app tests only, and catches template and concatenated `agent:system` | The lease-sweep cron (P8) must live under `apps/uw-app/cron/` |
| FD-8 KN-5 | Carry (c): the lock-key check flags `pg_try_advisory_*`, `_shared` locks and an uncast `${…}` key | None |
| KN-7 | Carry (d): attaching a learning requires an agent to hold the item; a person needs `write` | An agent cannot attach to an item it is not working |
| KN-16 AB-6 | Carry (e): a delegation of another person is answered exactly as an unknown id (`delegation_not_found`) | None |
| AB-2 | Carry (f): persona slugs `system` and `ingest` are reserved in persona identities, persona pages, delegations and the `x-uw-persona` header | A persona cannot be called `system` or `ingest` |
| AB-4 | `AppDeps.clock` (Task 12) feeds both the request instant and the MCP route's kernel, so tests move one clock for both; production passes `systemClock` | A deps object built without it fails to typecheck, which is the intent |

- New dependencies: `2026-10-02 | @modelcontextprotocol/sdk ^1.31.0 (MIT, apps/uw-app) | a hand-written JSON-RPC and Streamable HTTP server, client and in-process transport for the MCP surface`; `2026-10-02 | @cfworker/json-schema ^4.1.1 (MIT, apps/uw-app) | Ajv's code-generating validator, which Workers forbid, as the SDK's JSON Schema validator`; `2026-10-02 | Contract versions 4.0.0 (Task 2, principal and persona schemas tighten) and 5.0.0 (Task 4, additive) | Not a dependency: contractVersion in both apps moved with each`. Add any `pnpm.overrides` or knip ignore that Task 12 needed.
- Not verified: the MCP endpoint behind a real Access application (a person's Claude Code or Codex signing in through `cloudflared access` and the edge adding `cf-access-jwt-assertion`; a real service-token JWT's `common_name`); the SDK's web-standard transport in a deployed Worker (only `pnpm build` and the Workers Vitest pool ran it); a real client's handling of the stateless server's `405` on `GET`; Postgres full-text search on Neon (only the local Postgres 16 ran it).
- Waiting on a person: `| 2026-10-02 | AB-2 AB-6 | The /mcp endpoint, service-token bindings and the minting edge | Access service tokens for agent identities (PRD 15), bound with bind_service_token; a first real external run (Claude Code with an MCP server entry for https://<uw-app>/mcp and the x-uw-device header) | Ian |`.
- Carried to later steps: `| 2026-10-02 | Step 4 | Step 5 | GH-5: submit_to_gate's paths and risk declaration come from GitHub facts at the head; today the MCP handler passes paths [] and no declaration, so the ship rule refuses risk_tier_undeclared |`; `| 2026-10-02 | Step 4 | Step 5 | GH-2's six tables go in packages/db/schema-github.ts, re-exported by schema.ts |`; `| 2026-10-02 | Step 4 | Step 7 | HE-1: the Workflow host reaches the platform through connectInProcess with the beat or run principal; record_run_step there is metered |`; `| 2026-10-02 | Step 4 | Step 8 | WB-10: get_health switches its not_wired indicators to WB-10's exported queries |`; `| 2026-10-02 | Step 4 | Step 10 | PE-3: activation's dry run and status flip replace the not_wired success; PE-7: query_entities gains measurements_for_item with measurements' writer; the personas projection joins poll_queue's subscription |`.

- [ ] **Step 4: Verify and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS, including `pnpm trace:built` with step 4 marked Built.

```bash
git add docs/progress_tracker.md docs/architecture.md
git commit -m "docs(tracker): step 4, agent boundary, built: evidence, decisions, what was not verified and what waits on a person" -m "AB-1 AB-2 AB-3 AB-4 AB-5 AB-6 AB-7 AB-8"
```
