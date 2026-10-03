# Step 6: Command API, Live Hub and Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give people one command API over the kernel (every Controls row, the issue import, connector recovery and the stage command), a live hub that wakes clients without carrying content, and the design system the step-8 views are built from.

**Architecture:** Every `/api/harness/:harness/*` route runs one dispatcher that parses a contract body, replays a repeated `requestId` from a ledger, resolves the harness (hidden equals missing), calls `can()` and only then the kernel. The commands that decide gates, edit stages or grant delegations live in one directory, the person surface, which the MCP closure can never reach; only the gate commands build a kernel with a GitHub read client and the ship writes. The kernel wakes the hub after every committed append; one Durable Object per harness sends `{"type":"wake","harnessId":…}` to its WebSocket sessions, each of which reads events after its own cursor from the one read route and polls it when the socket is down. `packages/ui` holds the brand tokens, a Tailwind 4 CSS-first theme over them, a committed generated stylesheet and the Hono JSX shell pieces.

**Tech Stack:** TypeScript strict, Hono 4 (routes and JSX), Zod 4, Drizzle over Postgres, Cloudflare Workers and Durable Objects (WebSocket Hibernation API), Vitest (Workers pool and Node), Tailwind CSS 4 (`tailwindcss`, `@tailwindcss/cli`), `colorjs.io` (contrast tests), `partysocket` (the reconnecting client socket).

**Spec:** `docs/PRD.md` (approved; no brainstorm, no approval step). Requirements covered: **WB-1, WB-2, WB-3, WB-11**. Carries planned here: step 5 rows (S5-R40 gate view, `risk_derived.head`, the person gate route's GitHub read client and ship writes, `kernel.ts` back on the GitHub allow-list, the import command, the connector recovery command, a connector edited to `none` under a waiting approval), step 3 row (P17 stage removal), step 4 R31/R34 (every `/api/*` handler through the dispatcher and `can()`), and every rule from steps 1 to 5.

## Global Constraints

Every task obeys every line here. Copy exact values; do not paraphrase them in code.

- **Where:** the worktree `/home/ianjl/projects/uw-platform-v1`, branch `build/v1`. Implementers commit; they do not push (the controller pushes).
- **Read before the first edit:** `AGENTS.md` sections 1, 4, 6 and 10; `CONTEXT.md` for every word (Command, Item, Stage, Gate, Live hub, Wake, Cursor, Principal, Grant, Person, Agent identity, Kernel, Port, Adapter, Scenario); `docs/exceptions.md`.
- **Verify, at the end of every task, green:** `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. If the local server is down: `/usr/lib/postgresql/16/bin/pg_ctl -D ~/.local/share/uw-platform-test-pg -o "-p 54329 -k '' -c listen_addresses=127.0.0.1" -l ~/.local/share/uw-platform-test-pg.log start`. The local server is private; CI uses a Postgres service container.
- **R37:** never run two test suites at once. No parallel `pnpm verify`, `pnpm test`, `vitest` or `pnpm sim:all`; wait for one to finish before starting another (concurrent suites kill the WSL VM).
- **DX-8:** no test, binding or job may need a live account or a secret. Platform adapters are proven against fixtures and test doubles; their live run is recorded as waiting on a person. Never add a binding, job or test that fails when a secret is absent.
- **Layering (dependency-cruiser and ESLint enforce it):** `packages/contracts` → nothing; `packages/core` → contracts; `packages/db` → contracts, core; `packages/ui` → no workspace code (npm `hono` only); `packages/harness` → contracts, core types, pure (no Workers, Drizzle, vendor SDK or network); `apps/uw-app` → harness, db, contracts, core, ui; `sim/` → harness, contracts, db and the Node built-ins AGENTS.md lists. Islands (`apps/uw-app/islands/`) never import `packages/harness`.
- **Code:** no comments of any kind (no line, block, JSDoc or directive comments, no commented-out code). Files under 500 lines; functions under 50 lines; ESLint fitness limits: 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters. TypeScript strict, no `any`, no `@ts-ignore`.
- **Commits:** Conventional Commits. The body's last line lists the requirement IDs the commit proves or serves (for example `WB-1 WB-2`). No `Co-Authored-By` and no attribution footer of any kind. Hooks always pass; never `--no-verify`.
- **Shared roots** (`packages/db/schema.ts`, `packages/db/schema-*.ts`, `packages/contracts/`, `packages/harness/ports.ts`, `packages/core/acl.ts`, `infra/`, `.github/workflows/`, `AGENTS.md`, `CONTEXT.md`, `docs/adr/`): a change goes in its own commit with no feature code, and the message names the shared root and why it changed. Migrations travel with the `schema*.ts` commit that needs them.
- **Exceptions:** any exception to AGENTS.md rules 1 to 4 gets its `docs/exceptions.md` row in the same commit as the code, written before it.
- **Contract version:** Task 1 moves `CONTRACT_VERSION` from `9.1.0` to `10.0.0` and moves `contractVersion` in `apps/uw-app/package.json` and `apps/uw-ingest/package.json` with it. No later task changes the contracts.
- **Routes (P22):** commands are `POST /api/harness/:harness/commands/:name`; reads are `GET /api/harness/:harness/events`, `GET /api/harness/:harness/stages/:stage/items`, `GET /api/harness/:harness/gates/:item`; the live socket is `GET /api/harness/:harness/live`. The stylesheet is `GET /assets/app-<hash>.css`.
- **Command names (closed set, contract 10.0.0):** `kickstart`, `enqueue`, `import`, `reorder`, `claim`, `release`, `submit_to_gate`, `approve`, `reject`, `take_over`, `override`, `prompt_run`, `stop_run`, `pause`, `resume`, `tweak_package`, `schedule_regular_tweak`, `revoke_delegation`, `recover_connectors`, `activate_template`, `create_stage`, `update_stage`, `reorder_stages`, `remove_stage`.
- **Outcomes:** a command's response body is exactly `{ "status": "accepted", "requestId" }` or `{ "status": "error", "requestId", "reason" }` with `reason` from the closed set; nothing else. New reasons in 10.0.0: `request_in_flight`, `issue_not_found`, `stage_not_empty`. New events: `item_reordered`, `stage_removed`.
- **Hidden equals missing:** a harness the caller may not read answers `harness_not_found`, byte-identical to a missing one; an item answers `item_not_found`.
- **Only humans decide gates.** No agent identity can approve, merge, deploy, publish or advance past a human gate by any route. Gate decisions run only through `kernel.gates.decide`, which refuses every non-`human:<personId>` principal and records `gate_refused_to_agent`.
- **GitHub clients:** only the gate commands (`approve`, `reject`, `take_over`, `override`, `recover_connectors`) build a kernel with a GitHub read client and the ship writes `{ app, transport }`. The MCP, queue and cron kernels never get either; nothing under `apps/uw-app/mcp/` or `apps/uw-app/engines/` reaches a GitHub client; agents never get any GitHub client.
- **Lock order** (docs/architecture.md): stage lock (`harness-stages:<harnessId>` or `harness-stage-claims:<stageId>`, never both), then item rows (several rows: ascending id), then grants, then appends; no lock after the first append. Transactions never nest. Isolation stays READ COMMITTED.
- **One writer per table.** New table `command_requests` is written only by `apps/uw-app/commands/requests.ts` (exports `owns`). `harnesses` and `harness_stages` are written only by `packages/harness/stages/`. `harness_items` and `harness_events` only by the kernel.
- **R36 trace honesty:** a `describe`/`it`/`test` title that leads with a requirement ID must prove that requirement; supporting tests lead with no ID. Scenarios are `sim/scenarios/<ID>.<slug>.ts`. Test files that the trace reads end in `.test.ts`.
- **UI:** tokens are the only source of a colour, size or radius; no hex literal (and no `rgb(`, `hsl(`, `oklch(`) outside `packages/ui/tokens/*.css` and `packages/ui/generated/app-css.ts`. Kindle marks a human action and nothing else (only `packages/ui/components/human-action.tsx` uses it). No red for status. Copy is sentence case, second person, no exclamation marks, no emoji; `unfoldingWord` is camelCase every time. Every control has an accessible name and visible focus. After any change to a class in `packages/ui/components/` or `apps/uw-app/**/*.tsx`, run `pnpm ui:css` and commit the regenerated `packages/ui/generated/app-css.ts`.
- **Kernel instants:** every kernel read a route makes is judged at the request instant; every command passes `{ actor, traceId, requestId }` as its `Caller`.

## Review Focus

The five inputs the PRD implies but no single requirement names, most likely first. Each line's test lives in the task named.

1. **A double-clicked or retried approve** (two requests, one `requestId`, at the same moment): exactly one `gate_decisions` row and one set of events; the second request replays the first outcome or answers `request_in_flight`, never a second decision. Test in Task 7 (ledger race) and Task 10 (approve twice).
2. **An approve on a head the person did not see** (an agent submits a new head between the gate view and the click): refused `head_mismatch`, nothing decided. Test in Task 6 (kernel) and Task 10 (HTTP).
3. **A wake that arrives while a read is in flight, and a socket killed mid-session**: the session reads again after the in-flight read, never moves its cursor backwards, never delivers an event twice, and after reconnect or a poll delivers everything appended while it was down. Test in Task 16.
4. **A person whose grant is revoked while their socket is open**: wakes keep arriving (they carry nothing), and the next event read answers `harness_not_found`. Test in Task 13.
5. **A reorder against an item that has moved to another stage** (the board is stale): refused `malformed_command`, no priority changes. Test in Task 4.

## Decisions this plan makes

Choices the PRD, the spec and AGENTS.md leave open. The final task copies each into `docs/progress_tracker.md` "Decisions made during the build" with the cost if wrong.

| # | Decision | Cost if wrong |
|---|---|---|
| S6-D1 | Command bodies carry `command: <name>` (the platform-command pattern) and the route refuses a body whose `command` differs from `:name` as `malformed_command` | One redundant field per request |
| S6-D2 | The command API adds `import`, `revoke_delegation`, `recover_connectors` and the stage command (`activate_template`, `create_stage`, `update_stage`, `reorder_stages`, `remove_stage`) to the Controls rows, because carried rows and go-live need a route for each | Seven more routes to keep under `can()`; all are admin or write |
| S6-D3 | `requestId` replay is a ledger table `command_requests` keyed on (actor identity, requestId), outside kernel transactions: a settled row replays its outcome; a pending row younger than 5 minutes answers `request_in_flight`; an older one is retaken; a thrown error releases the claim. A reused `requestId` with another command or harness is `malformed_command` | A crash after a kernel commit and before the settle, then a retry after 5 minutes, runs the command twice; the kernel's own guards (conditional claim, `decision_in_flight`, idempotent import) bound the damage |
| S6-D4 | Events carry `requestId` (nullable column `harness_events.request_id`, event field `requestId`); `Caller.requestId` stamps every event a command appends; MCP, queue and cron events carry null | None known |
| S6-D5 | The command API is for people: a non-person principal is refused `not_permitted` before any state, except on `approve`, `reject`, `take_over` and `override`, where a principal that can read the harness reaches `kernel.gates.decide`, which records `gate_refused_to_agent` as on the MCP surface | An agent on `/api` (impossible since R34) leaves a refusal event only on the gate commands |
| S6-D6 | Reorder renumbers the item's stage: items sorted by the kernel's order (priority descending, then id), the item moved before `beforeItemId` (or to the end when null), priorities reassigned `(n - index) * 10`, one `item_reordered` per item whose priority changed; it takes the stage-claims lock and then each item row in ascending id; agents are refused | Renumbering writes up to WIP-limit events per reorder |
| S6-D7 | Kickstart enqueues one item wrapping a `product` page in the harness's area, titled with the page's title; it is not limited to once per page | A second kickstart of one product opens a second item |
| S6-D8 | `tweak_package` is a submit of a held item to the harness's first stage by position, which parks it for a person's decision (KN-8's occasional tweak); editing the package page itself stays with the page API | None known |
| S6-D9 | Pause and resume act on the whole harness (`stageKey: null`) or one lane, need `admin`, write `harnesses.paused` or `harness_stages.paused` and record `harness_paused`/`harness_resumed` with `{ stage }`; a repeat records nothing. Claims, submits and runs ignore pause until step 7 (HE-1 carry) | A paused lane still takes claims until step 7 |
| S6-D10 | `prompt_run` and `stop_run` resolve the harness and call `can()` and then answer `not_wired` until step 7 wires runs | None |
| S6-D11 | P17: `remove_stage` refuses `stage_not_empty` when any item of the harness is at that stage, refuses a removal that leaves a dangling `feeds` target or breaks the template property, and records `stage_removed`; the step-5 carry is closed by refusing `decision_in_flight` on a connector change while an approval at that stage waits for its connector outcome | A stage with only done items cannot be removed |
| S6-D12 | The gate view (`kernel.gates.view`) answers from the read model only (no GitHub refresh), evaluates the ship rule for the viewer as approver, and shows the parsed declaration from the current facts, the latest recorded `risk_derived` (tier, domains, head, declaration) and what the rule would derive now; the decision then refreshes. `approve` and `override` carry the head the person saw (`head`), and the kernel refuses `head_mismatch` when it is not the item's expected head | A view up to a webhook's lag old; the head check refuses the decision rather than letting it ride a new head |
| S6-D13 | The person surface is the directory `apps/uw-app/commands/person/`. The AB-7 static closure still starts at `apps/uw-app/app.tsx`; gate, stage and delegation-grant touches are allowed only in the person surface; the closure seeded from `apps/uw-app/mcp/` must reach nothing under `apps/uw-app/commands/`; dependency-cruiser allows the person surface to be imported only from `apps/uw-app/commands/`. ADR 0009 records it | A person-surface handler that skipped the kernel's own refusals; the kernel refuses agents on every gate, stage and delegation write |
| S6-D14 | The gate GitHub opener is not in `AppDeps` (which the MCP routes hold): `createApp(deps, person)` takes a second `PersonDeps = { gateGitHub }` passed only to the harness routes | None |
| S6-D15 | `platformPorts(database, clock, wiring)` and `platformKernel(...)` take `KernelWiring = { hub, reads, ship }`; `hubWiring(hub)` is the only wiring the MCP, queue, cron and non-gate command kernels pass | None |
| S6-D16 | The person's `import` imports an open issue carrying the `harness` label that the read model holds, in the repository of the harness named in the path; the page is written under the ingest identity (it mirrors GitHub), the `item_created` event under the person; no GitHub client is held, so the cross-reference comment is posted by the nightly sweep | The comment lands up to a day later for a person's import |
| S6-D17 | The kernel wakes the hub after each committed transaction that appended events, once per harness, awaiting every wake and dropping its failure | A broken hub shows only as a stale last wake on `/health` |
| S6-D18 | The hub is a Durable Object `HarnessHub` (SQLite-backed, WebSocket Hibernation API), binding `HARNESS_HUB`, one object per harness by `idFromName(harnessId)`, declared in `infra/uw-app/wrangler.toml` and `wrangler.go-live.toml` (no account resource is needed; the deploy creates it). Its logic is `createHubCore(state, timers, now)` so tests run on a fake state; wakes in one tick coalesce to one `setTimeout(…, 0)` flush; it stores only `lastWakeAt`; `ping` auto-answers `pong` | The Durable Object in workerd (hibernation, eviction) runs first on staging |
| S6-D19 | `/health` gains `live_hub`: `not_configured` without the binding, else the sum of connections and the latest wake across at most 50 harnesses (`kernel.reads.harnessIds()`), `amber` if any object fails to answer within 2 s | 50 objects polled per health probe |
| S6-D20 | The live client (`apps/uw-app/islands/live/session.ts`) holds the cursor; it uses `partysocket` for reconnect with backoff from 1 s doubling to 30 s (P23), polls every 15 s only while the socket is not open, reads once on every open, and coalesces wakes during a read into one more read | A browser that never opens the socket polls every 15 s |
| S6-D21 | Tokens: five brand colours verbatim as `--uw-brand-*`; semantic light values from the prototype and dark values from Key Visuals (ADR 0007); links and the focus ring are Ocean in light and Inspire in dark because Inspire on white is 2.56:1; an `--uw-on-accent` (`#04222F`) for text on Inspire, Cultivate and Kindle; base text 1rem, not the prototype's 13.5px | A visual change if the `design-system/` handoff picks other values; only the token files change |
| S6-D22 | No web font is loaded: the stack is `'Nunito Sans', 'Avenir', 'Avenir Next', system-ui, sans-serif` | Devices without Nunito Sans render Avenir or the system font |
| S6-D23 | The Tailwind build output is committed as `packages/ui/generated/app-css.ts` (`appCss`, `appCssPath`) so the per-PR deploy of a prebuilt bundle needs no build step; a test regenerates it and fails on a difference. The stylesheet route is mounted before the principal middleware and has an exceptions row | A forgotten `pnpm ui:css` fails the test, not production |
| S6-D24 | Money is formatted once, in `packages/core/money.ts` (`formatMoney`), and a test allows `Intl.NumberFormat` nowhere else; components take preformatted strings | None |

---

### Task 1: Contracts 10.0.0: command bodies, reasons, events, the hub wake, the event page and the gate view

Shared root `packages/contracts/` in one commit; the PRD and CONTEXT.md in a second (CONTEXT.md is a shared root; the PRD rides with it as docs).

**Requirements:** WB-1, WB-2, WB-3 (contract halves); CT-3.

**Files:**
- Modify: `packages/contracts/commands.ts` (rewrite), `packages/contracts/outcomes.ts`, `packages/contracts/events.ts`, `packages/contracts/event-evidence.ts`, `packages/contracts/registry.ts`, `packages/contracts/index.ts`, `packages/contracts/version.ts`, `packages/contracts/contract-lock.json`, `packages/contracts/contracts.test.ts`, `packages/contracts/events.test.ts`
- Create: `packages/contracts/live.ts`, `packages/contracts/gate-view.ts`, `packages/contracts/live.test.ts`, `packages/contracts/commands.test.ts`, fixtures `packages/contracts/fixtures/{hub-wake,event-page-reply,gate-view}/{valid,invalid}/*.json` and new cases under `packages/contracts/fixtures/command/` (follow the existing fixture layout exactly)
- Modify: `apps/uw-app/package.json`, `apps/uw-ingest/package.json` (`"contractVersion": "10.0.0"`)
- Modify (second commit): `docs/PRD.md` (8.1, 8.5, 8.6), `CONTEXT.md`

**Interfaces:**
- Produces: `commandNames`, `commandNameSchema`, `CommandName`, `harnessCommandSchemas`, `commandSchema`, `Command`, `CommandBody<N>`, `templateKeySchema`, `TemplateKey`; reasons `request_in_flight`, `issue_not_found`, `stage_not_empty`; event names `item_reordered`, `stage_removed`; evidence for `item_reordered`, `stage_removed`, `harness_paused`, `harness_resumed`; event field `requestId: string | null`; `hubWakeSchema`, `HubWake`; `eventPageReplySchema`, `EventPageReply`; `eventQuerySchema`, `EventQuery` (contract type name `EventReadQuery` to avoid the harness `EventQuery`); `gateViewSchema`, `GateView`.

- [ ] **Step 1: Write the failing tests**

`packages/contracts/commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { commandNames, commandSchema, harnessCommandSchemas } from './commands.ts';

const requestId = '00000000-0000-4000-8000-0000000000aa';
const itemId = '00000000-0000-4000-8000-0000000000bb';
const head = 'a'.repeat(40);

describe('WB-1 every control is a command with a requestId', () => {
  it('names a body schema for every command and no other', () => {
    expect(Object.keys(harnessCommandSchemas).sort()).toEqual([...commandNames].sort());
  });

  it('refuses every command body without a requestId', () => {
    for (const name of commandNames) {
      expect(commandSchema.safeParse({ command: name }).success).toBe(false);
    }
  });

  it('refuses a field the command does not name', () => {
    expect(
      commandSchema.safeParse({ command: 'claim', requestId, itemId, delegationId: null }).success,
    ).toBe(false);
  });

  it('takes an import by repository and number, never a GitHub id', () => {
    const base = { command: 'import', requestId, repository: 'unfoldingWord/uw-platform' };
    expect(commandSchema.safeParse({ ...base, number: 7 }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, number: 7, githubId: 9 }).success).toBe(false);
  });

  it('needs a non-blank reason and the seen head on an override', () => {
    const base = { command: 'override', requestId, itemId, head };
    expect(commandSchema.safeParse({ ...base, reason: '  ' }).success).toBe(false);
    expect(commandSchema.safeParse({ ...base, reason: 'reviewed by hand' }).success).toBe(true);
  });

  it('takes a pull request and its head together or neither on submit', () => {
    const base = { command: 'submit_to_gate', requestId, itemId, to: null };
    const pullRequest = { repo: 'unfoldingWord/uw-platform', number: 7 };
    expect(commandSchema.safeParse({ ...base, pullRequest, head }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, pullRequest: null, head: null }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, pullRequest, head: null }).success).toBe(false);
  });
});

describe('WB-2 reorder names the item to place before, never an index', () => {
  it('takes beforeItemId or null and refuses a position', () => {
    const base = { command: 'reorder', requestId, itemId };
    expect(commandSchema.safeParse({ ...base, beforeItemId: null }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, beforeItemId: itemId }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, position: 2 }).success).toBe(false);
  });
});
```

`packages/contracts/live.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hubWakeSchema } from './live.ts';

const harnessId = '00000000-0000-4000-8000-0000000000cc';

describe('WB-3 the wake carries nothing but the news', () => {
  it('has exactly the fields type and harnessId', () => {
    expect(Object.keys(hubWakeSchema.shape).sort()).toEqual(['harnessId', 'type']);
  });

  it('refuses a wake that carries an event, an item, a body or a position', () => {
    for (const extra of [{ event: {} }, { itemId: harnessId }, { body: 'x' }, { position: 3 }]) {
      expect(hubWakeSchema.safeParse({ type: 'wake', harnessId, ...extra }).success).toBe(false);
    }
  });
});
```

Add to `packages/contracts/events.test.ts`: an `item_reordered` event with evidence `{ priority: 30, before: null }` parses; one with `{ priority: 1.5, before: null }` does not; a `stage_removed` event needs `before`; an event without `requestId` parses with `requestId: null`; one with `requestId: 'x'` does not. Update `contracts.test.ts` for the new `commandSchema` (the old `{ command: 'pause' }` without requestId stays refused; the `override` cases now need `itemId` and `head`).

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run packages/contracts`
Expected: FAIL (missing exports `harnessCommandSchemas`, `live.ts`).

- [ ] **Step 3: Write the contracts**

`packages/contracts/commands.ts` (complete):

```ts
import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { capabilityWordSchema } from './closed-sets.ts';
import {
  personaIdentitySchema,
  pullRequestRefSchema,
  repositorySchema,
  stageKeySchema,
  stageSchema,
} from './harness.ts';
import { slugSchema } from './pages.ts';
import { fullShaSchema } from './ship-rule.ts';

export const commandNames = [
  'kickstart',
  'enqueue',
  'import',
  'reorder',
  'claim',
  'release',
  'submit_to_gate',
  'approve',
  'reject',
  'take_over',
  'override',
  'prompt_run',
  'stop_run',
  'pause',
  'resume',
  'tweak_package',
  'schedule_regular_tweak',
  'revoke_delegation',
  'recover_connectors',
  'activate_template',
  'create_stage',
  'update_stage',
  'reorder_stages',
  'remove_stage',
] as const;

export const commandNameSchema = z.enum(commandNames);
export type CommandName = z.infer<typeof commandNameSchema>;

export const templateKeySchema = z.enum(['software', 'bml']);
export type TemplateKey = z.infer<typeof templateKeySchema>;

const requestId = z.uuid();
const itemId = z.uuid();
const nonBlank = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, 'not blank');

const body = <Name extends CommandName, Shape extends z.ZodRawShape>(name: Name, shape: Shape) =>
  z.strictObject({ command: z.literal(name), requestId, ...shape });

const stageInputSchema = stageSchema.omit({ id: true, harnessId: true, paused: true });
const stageChangeSchema = stageSchema
  .omit({ id: true, harnessId: true, key: true })
  .partial()
  .strict()
  .refine((change) => Object.keys(change).length > 0, 'a change names at least one column');

export const submitCommandSchema = body('submit_to_gate', {
  itemId,
  to: stageKeySchema.nullable(),
  pullRequest: pullRequestRefSchema.nullable(),
  head: fullShaSchema.nullable(),
}).refine(
  (command) => (command.pullRequest === null) === (command.head === null),
  'a pull request and its head come together',
);

export const overrideCommandSchema = body('override', {
  itemId,
  head: fullShaSchema.nullable(),
  reason: nonBlank(2000),
});

export const harnessCommandSchemas = {
  kickstart: body('kickstart', { pageId: z.uuid() }),
  enqueue: body('enqueue', {
    title: nonBlank(200),
    pageId: z.uuid().nullable(),
    due: z.iso.date().nullable(),
  }),
  import: body('import', { repository: repositorySchema, number: z.number().int().min(1) }),
  reorder: body('reorder', { itemId, beforeItemId: z.uuid().nullable() }),
  claim: body('claim', { itemId }),
  release: body('release', { itemId }),
  submit_to_gate: submitCommandSchema,
  approve: body('approve', { itemId, head: fullShaSchema.nullable() }),
  reject: body('reject', { itemId, findings: z.array(nonBlank(500)).max(50) }),
  take_over: body('take_over', { itemId }),
  override: overrideCommandSchema,
  prompt_run: body('prompt_run', { itemId, message: nonBlank(4000) }),
  stop_run: body('stop_run', { itemId }),
  pause: body('pause', { stageKey: stageKeySchema.nullable() }),
  resume: body('resume', { stageKey: stageKeySchema.nullable() }),
  tweak_package: body('tweak_package', { itemId }),
  schedule_regular_tweak: body('schedule_regular_tweak', {
    persona: personaIdentitySchema,
    capability: capabilityWordSchema,
    expiresAt: z.iso.datetime().nullable(),
    supersedes: z.uuid().nullable(),
  }),
  revoke_delegation: body('revoke_delegation', { delegationId: z.uuid() }),
  recover_connectors: body('recover_connectors', {}),
  activate_template: body('activate_template', {
    harnessKey: slugSchema,
    jdArea: jdAreaSchema,
    template: templateKeySchema,
    repository: repositorySchema.nullable(),
  }),
  create_stage: body('create_stage', { stage: stageInputSchema }),
  update_stage: body('update_stage', { stageKey: stageKeySchema, change: stageChangeSchema }),
  reorder_stages: body('reorder_stages', { order: z.array(stageKeySchema).min(1) }),
  remove_stage: body('remove_stage', { stageKey: stageKeySchema }),
} as const satisfies Record<CommandName, z.ZodType>;

export const commandSchema = z.discriminatedUnion('command', [
  harnessCommandSchemas.kickstart,
  harnessCommandSchemas.enqueue,
  harnessCommandSchemas.import,
  harnessCommandSchemas.reorder,
  harnessCommandSchemas.claim,
  harnessCommandSchemas.release,
  harnessCommandSchemas.submit_to_gate,
  harnessCommandSchemas.approve,
  harnessCommandSchemas.reject,
  harnessCommandSchemas.take_over,
  harnessCommandSchemas.override,
  harnessCommandSchemas.prompt_run,
  harnessCommandSchemas.stop_run,
  harnessCommandSchemas.pause,
  harnessCommandSchemas.resume,
  harnessCommandSchemas.tweak_package,
  harnessCommandSchemas.schedule_regular_tweak,
  harnessCommandSchemas.revoke_delegation,
  harnessCommandSchemas.recover_connectors,
  harnessCommandSchemas.activate_template,
  harnessCommandSchemas.create_stage,
  harnessCommandSchemas.update_stage,
  harnessCommandSchemas.reorder_stages,
  harnessCommandSchemas.remove_stage,
]);

export type Command = z.infer<typeof commandSchema>;
export type CommandBody<Name extends CommandName> = z.infer<(typeof harnessCommandSchemas)[Name]>;
export type OverrideCommand = z.infer<typeof overrideCommandSchema>;
```

If `z.discriminatedUnion` refuses the refined `submit_to_gate` or `override` members under Zod 4, keep the refinement on the member and move the union to `z.union([...])` with the same members; the tests above decide.

`packages/contracts/outcomes.ts`: append `'request_in_flight'`, `'issue_not_found'`, `'stage_not_empty'` to `errorReasonSchema` (after `'facts_stale'`).

`packages/contracts/events.ts`: add `'item_reordered'` after `'item_released'` and `'stage_removed'` after `'stage_edited'`; add `requestId: z.uuid().nullable().default(null)` to `fields`.

`packages/contracts/event-evidence.ts`: in `itemEvidence` add `item_reordered: z.strictObject({ priority: z.number().int(), before: id.nullable() })`; in `harnessEvidence` add `stage_removed: z.strictObject({ stageId: id, key: stage, before: stageColumns })`, `harness_paused: z.strictObject({ stage: stage.nullable() })`, `harness_resumed: z.strictObject({ stage: stage.nullable() })`.

`packages/contracts/live.ts` (complete):

```ts
import { z } from 'zod';
import { eventSchema } from './events.ts';

export const hubWakeSchema = z.strictObject({ type: z.literal('wake'), harnessId: z.uuid() });

export const eventPageReplySchema = z.strictObject({
  events: z.array(eventSchema),
  next: z.number().int().min(0).nullable(),
});

export const eventQuerySchema = z.strictObject({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  item: z.uuid().optional(),
});

export type HubWake = z.infer<typeof hubWakeSchema>;
export type EventPageReply = z.infer<typeof eventPageReplySchema>;
export type EventReadQuery = z.infer<typeof eventQuerySchema>;
```

`packages/contracts/gate-view.ts` (complete):

```ts
import { z } from 'zod';
import { connectorSchema, gateStatusSchema, riskDomainsSchema, riskTierSchema } from './closed-sets.ts';
import { pullRequestDeclarationSchema } from './github.ts';
import { pullRequestRefSchema, stageKeySchema } from './harness.ts';
import {
  fullShaSchema,
  riskDeclarationSchema,
  shipRuleInputSchema,
  shipRuleOutcomeSchema,
} from './ship-rule.ts';

const derivedSchema = z.strictObject({
  riskTier: riskTierSchema.nullable(),
  riskDomains: riskDomainsSchema,
  head: fullShaSchema.nullable(),
});

export const gateViewSchema = z.strictObject({
  itemId: z.uuid(),
  harnessId: z.uuid(),
  stageKey: stageKeySchema,
  gateStatus: gateStatusSchema,
  connector: connectorSchema,
  expectedHead: fullShaSchema.nullable(),
  pullRequest: pullRequestRefSchema.nullable(),
  recorded: z
    .strictObject({
      riskTier: riskTierSchema.nullable(),
      riskDomains: riskDomainsSchema,
      floorDomains: riskDomainsSchema,
      head: fullShaSchema.nullable(),
      declaration: riskDeclarationSchema.nullable(),
      refusal: z.literal('risk_tier_undeclared').nullable(),
    })
    .nullable(),
  facts: z
    .strictObject({
      head: z.string().min(1),
      state: z.enum(['open', 'closed', 'merged']),
      draft: z.boolean(),
      baseRef: z.string().min(1),
      freshAt: z.iso.datetime(),
      declaration: pullRequestDeclarationSchema.nullable(),
    })
    .nullable(),
  ship: z
    .strictObject({
      input: shipRuleInputSchema.omit({ approver: true }),
      outcome: shipRuleOutcomeSchema,
      derived: derivedSchema.nullable(),
    })
    .nullable(),
});

export type GateView = z.infer<typeof gateViewSchema>;
```

`index.ts`: export `./gate-view.ts` and `./live.ts`. `registry.ts`: register `hub-wake` → `hubWakeSchema`, `event-page-reply` → `eventPageReplySchema`, `gate-view` → `gateViewSchema`, `template-key` → `templateKeySchema`; keep `command`, `command-name`, `override-command`. Add valid and invalid fixtures for each new schema and for `command` (one valid body per new command name; invalid: an import with `githubId`, a reorder with `position`) following the existing layout. `contract-lock.json`: add the 10.0.0 entry the lock test asks for (new command names, reasons, event names, `template-key`); the lock test passes only with a major bump because the command bodies change shape. `version.ts`: `'10.0.0'`; both apps' `contractVersion`: `"10.0.0"`.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm vitest run packages/contracts apps/uw-app/contract-conformance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the contracts**

```bash
git add packages/contracts apps/uw-app/package.json apps/uw-ingest/package.json
git commit -m "feat(contracts)!: harness command bodies, the hub wake, the event page and the gate view (10.0.0)" -m "Shared root packages/contracts: every Controls row plus import, revoke_delegation, recover_connectors and the stage command become strict command bodies with a requestId; reorder names the item to place before; events carry the requestId; item_reordered, stage_removed and the pause evidence are added; request_in_flight, issue_not_found and stage_not_empty join the reasons; the hub wake has no field that can carry content." -m "WB-1 WB-2 WB-3 CT-3"
```

- [ ] **Step 6: Update the PRD and CONTEXT.md, then commit**

`docs/PRD.md`: in 8.1 add the row `| \`command_requests\` | actor, request id, command, harness, outcome, trace id, claimed at, settled at; primary key on actor and request id | the command API's request ledger (\`apps/uw-app/commands/requests.ts\`) |`; in 8.5 add the line `Added in step 6: \`request_in_flight\` (a command whose \`requestId\` is still running), \`issue_not_found\` (an import the read model does not hold), \`stage_not_empty\` (P17).`; in 8.6 add `item_reordered` and `stage_removed` to the vocabulary block and a paragraph: "`item_reordered` (contract 10.0.0) records an item's new priority and, for the moved item, the item it was placed before. `stage_removed` records a removed stage's id, key and columns. `harness_paused` and `harness_resumed` name the lane, or null for the whole harness. Every event carries the `requestId` of the command that appended it, or null."

`CONTEXT.md`: in **Command** replace the list with the 24 names in words (kickstart, enqueue, import, reorder, claim, release, submit, approve, reject, take over, override, prompt run, stop run, pause, resume, tweak package, schedule regular tweak, revoke delegation, recover connectors, and the stage command: activate template, create, update, reorder and remove stage); add entries:

```
**Person surface**:
The command handlers that decide gates, edit stages and grant or revoke delegations: `apps/uw-app/commands/person/`. Only a person's command reaches them; nothing the MCP surface reaches imports them.
_Avoid_: admin API, privileged routes

**Gate view**:
What a person deciding a gate is shown: the parsed PR declaration, the tier and domains with the head they were derived at, every ship-rule input and the rule's answer for them. Read from the read model; the decision refreshes.
_Avoid_: gate page, approval screen

**Request ledger**:
The `command_requests` table: one row per person and `requestId`, so a repeated command replays its first outcome.
_Avoid_: idempotency cache, dedupe table

**Token**:
One CSS custom property in `packages/ui/tokens/*.css`, the only source of a colour, size or radius.
_Avoid_: variable, style constant

**Shell**:
The page frame every screen renders inside: sidebar, top bar and content, fluid from phone width up.
_Avoid_: layout, chrome, template (that is a stage graph)
```

```bash
git add docs/PRD.md CONTEXT.md
git commit -m "docs(context): the person surface, the gate view, the request ledger, tokens and the shell; PRD 8.1, 8.5, 8.6 for step 6" -m "Shared root CONTEXT.md: the words step 6 introduces, before any code uses them." -m "WB-1 WB-2 WB-3 WB-11"
```

- [ ] **Step 7: Verify**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: green. If an existing caller of the old `commandSchema` shape breaks, fix it in the contracts commit (amend before the docs commit only if not yet committed; otherwise a follow-up `fix(contracts)` commit).

---

### Task 2: The request ledger table, the event's request id, and the store writes for pause and removal

**Requirements:** WB-1 (ledger and request id), P17 (removal write), S6-D9 (pause write).

**Files:**
- Modify: `packages/db/schema-platform.ts` (table `command_requests`), `packages/db/schema.ts` (`harness_events.request_id`), `packages/db/migrations/0020_command_requests.sql` (generated with `pnpm db:generate`, plus the hand-written CHECKs the generator does not emit), `packages/db/migrations/meta/*`
- Modify: `packages/db/store/events.ts`, `packages/db/store/rows.ts`, `packages/db/store/harnesses.ts`, `packages/db/store/stages.ts`, `packages/harness/ports.ts` (shared root, own commit), `packages/harness/port-contracts/store-gateways.ts`, `packages/harness/port-contracts/store-events.ts`
- Test: `packages/db/command-requests.test.ts`, the port contract suites above (they run against both adapters)

**Interfaces:**
- Produces (ports.ts): `HarnessesGateway.write.setPaused(harnessId: string, paused: boolean): Promise<void>`; `HarnessStagesGateway.write.remove(stageId: string): Promise<void>`; `HarnessEvent.requestId` round-trips through `harnessEvents.write.append` and `read.page`.
- Produces (db): `commandRequests` Drizzle table export from `@uw/db/schema`.

- [ ] **Step 1: Write the failing tests**

`packages/db/command-requests.test.ts` (both targets, following `packages/db/both-targets.test.ts`): the table declares `classification: 'internal'`, `offlineEligibility: 'never'`; inserting the same `(actor, request_id)` twice is refused by the primary key; a `command` outside `commandNames` is refused (`command_requests_command_known`); an outcome without `settled_at` is refused (`command_requests_settled_with_outcome`); an `actor` that is not an identity string is refused.

In `packages/harness/port-contracts/store-gateways.ts` add (titles lead with `DX-3`):

```ts
it('DX-3 sets a harness paused and back', async () => {
  const subject = await open();
  await subject.store.transaction(async (tx) => {
    await tx.harnesses.write.setPaused(harness.id, true);
    expect((await tx.harnesses.read.byId(harness.id))?.paused).toBe(true);
    await tx.harnesses.write.setPaused(harness.id, false);
    expect((await tx.harnesses.read.byId(harness.id))?.paused).toBe(false);
  });
});

it('DX-3 removes a stage that holds no item', async () => {
  const subject = await open();
  await subject.store.transaction(async (tx) => {
    await tx.harnessStages.write.remove(spareStage.id);
    const keys = (await tx.harnessStages.read.forHarness(harness.id)).map((stage) => stage.key);
    expect(keys).not.toContain(spareStage.key);
  });
});
```

(Use the suite's existing fixture helpers for `harness` and a stage; `spareStage` is a stage the fixture inserts with no items.) In `store-events.ts` add `DX-3 keeps the requestId an event was appended with, and null when none` (append one event with `requestId` set and one without; read the page; compare).

- [ ] **Step 2: Run and see them fail**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run packages/db/command-requests.test.ts packages/db/store sim/adapters/store.contract.test.ts apps/uw-app/ports/store.contract.pg.test.ts`
Expected: FAIL.

- [ ] **Step 3: The schema and migration (shared-root commit)**

In `packages/db/schema-platform.ts`:

```ts
export const commandRequests = declareTable(
  'command_requests',
  {
    actor: text('actor').notNull(),
    requestId: uuid('request_id').notNull(),
    command: text('command').notNull(),
    harnessId: uuid('harness_id').notNull(),
    outcome: jsonb('outcome'),
    traceId: uuid('trace_id').notNull(),
    claimedAt: instant('claimed_at').notNull(),
    settledAt: instant('settled_at'),
  },
  { classification: 'internal', offlineEligibility: 'never' },
  (t) => [
    primaryKey({ name: 'command_requests_pkey', columns: [t.actor, t.requestId] }),
    check('command_requests_command_known', oneOf(t.command, commandNameSchema.options)),
    check('command_requests_actor_is_identity', matches(t.actor, IDENTITY_PATTERN)),
    check(
      'command_requests_settled_with_outcome',
      sql`(${t.outcome} IS NULL) = (${t.settledAt} IS NULL)`,
    ),
  ],
);
```

`harness_id` has no foreign key: `activate_template` claims a harness id that does not exist yet. In `packages/db/schema.ts` add `requestId: uuid('request_id')` (nullable) to `harnessEvents`. Run `pnpm db:generate`; name the migration `0020_command_requests.sql`; add any CHECK the generator leaves out by hand in the same file; confirm `pnpm db:migrate` twice against the test server is a no-op the second time (the migrations test does this).

```bash
git add packages/db/schema-platform.ts packages/db/schema.ts packages/db/migrations packages/db/command-requests.test.ts
git commit -m "feat(db): command_requests ledger and harness_events.request_id" -m "Shared root packages/db/schema*.ts: the command API replays a repeated requestId from its own ledger, and every event a command appends carries that requestId." -m "WB-1"
```

- [ ] **Step 4: The ports and the store (shared-root commit for ports.ts, then the store)**

`packages/harness/ports.ts`: add `setPaused` to `HarnessesGateway.write` and `remove` to `HarnessStagesGateway.write` with the signatures above. Commit alone:

```bash
git add packages/harness/ports.ts
git commit -m "feat(harness): the store port can pause a harness and remove a stage" -m "Shared root packages/harness/ports.ts: pause and resume (S6-D9) and P17's stage removal need these writes; the stage command is their only caller." -m "WB-1"
```

Then `packages/db/store/harnesses.ts` (`UPDATE harnesses SET paused = $2 WHERE id = $1`), `packages/db/store/stages.ts` (`DELETE FROM harness_stages WHERE id = $1`), `packages/db/store/events.ts` and `rows.ts` (write and read `request_id` as `requestId`), the two port-contract suites, and commit:

```bash
git commit -m "feat(db): the store pauses a harness, removes a stage and keeps each event's requestId" -m "WB-1"
```

- [ ] **Step 5: Verify**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: green (the drift check, the declarations test and `tools/architecture/owners.test.ts` pass; the owners check will start requiring an owner for `command_requests` in Task 7: if it already fails here because the table has no owner, add `command_requests` to the owners test's list of tables not yet written in this commit, and remove that entry in Task 7).

---

### Task 3: Commands stamp their requestId, and the kernel wakes the hub after every committed append

**Requirements:** WB-1 (event carries actor, requestId, trace id), WB-3 (the hub is woken on every appended event).

**Files:**
- Modify: `packages/harness/caller.ts`, `packages/harness/items/record.ts`, `packages/harness/kernel.ts`
- Create: `packages/harness/hub-wakes.ts`, `packages/harness/hub-wakes.test.ts`, `sim/scenarios/WB-3.every-append-wakes-the-hub-after-commit.ts`
- Modify: `packages/harness/kernel.test.ts`

**Interfaces:**
- Consumes: `Store`, `StoreTransaction`, `Hub` from `ports.ts`; event `requestId` (Task 1, Task 2).
- Produces: `Caller = { readonly actor: Principal; readonly traceId: string; readonly requestId?: string | null }`; `RecordContext.requestId: string | null`; `wakingStore(store: Store, hub: Hub): Store` (exported from `packages/harness/hub-wakes.ts`, used only by `createKernel`).

- [ ] **Step 1: Write the failing tests**

`packages/harness/hub-wakes.test.ts` (pure; fake store and hub; titles lead with WB-3):

```ts
import { describe, expect, it } from 'vitest';
import type { Hub, Store, StoreTransaction } from './ports.ts';
import { wakingStore } from './hub-wakes.ts';

function fakeStore(appendFor: readonly string[], fail = false): Store {
  const tx = {
    harnessEvents: {
      read: { page: async () => ({ events: [], next: null }) },
      write: {
        append: async () => appendFor.map((harnessId) => ({ harnessId })),
      },
    },
  } as unknown as StoreTransaction;
  return {
    appliedMigrations: async () => [],
    transaction: async (work) => {
      const result = await work(tx);
      if (fail) throw new Error('rolled back');
      return result;
    },
  };
}

function recordingHub(failing = false): Hub & { readonly woken: string[] } {
  const woken: string[] = [];
  return {
    woken,
    wake: async (harnessId) => {
      woken.push(harnessId);
      if (failing) throw new Error('hub down');
    },
  };
}

describe('WB-3 the kernel wakes the hub after a committed append', () => {
  it('wakes each harness that got an event, once, after the transaction', async () => {
    const hub = recordingHub();
    const store = wakingStore(fakeStore(['h1', 'h1', 'h2']), hub);
    await store.transaction((tx) => tx.harnessEvents.write.append([]));
    expect(hub.woken.sort()).toEqual(['h1', 'h2']);
  });

  it('wakes nothing when the transaction rolls back', async () => {
    const hub = recordingHub();
    const store = wakingStore(fakeStore(['h1'], true), hub);
    await expect(store.transaction((tx) => tx.harnessEvents.write.append([]))).rejects.toThrow();
    expect(hub.woken).toEqual([]);
  });

  it('wakes nothing for a transaction that appended nothing', async () => {
    const hub = recordingHub();
    await wakingStore(fakeStore([]), hub).transaction(async () => 1);
    expect(hub.woken).toEqual([]);
  });

  it('answers the command even when the hub fails', async () => {
    const store = wakingStore(fakeStore(['h1']), recordingHub(true));
    await expect(store.transaction(async () => 'done')).resolves.toBe('done');
  });
});
```

The `as unknown as` cast is test-only scaffolding over a partial transaction; if the lint config forbids it in this package, build the fake with every gateway member set to a function that throws.

`sim/scenarios/WB-3.every-append-wakes-the-hub-after-commit.ts`: create a software harness (`createSimHarness`), enqueue an item, assert `world.adapters.hub.wakes()` contains the harness id; a refused enqueue by a viewer appends nothing, so the wake count does not change; then the item's `item_created` event carries the `requestId` the caller passed (`simCaller` gains an optional `requestId`) and `traceId`.

In `packages/harness/kernel.test.ts` add `WB-1 a command's events carry its actor, requestId and trace id`.

- [ ] **Step 2: Run them and see them fail**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm vitest run packages/harness/hub-wakes.test.ts packages/harness/kernel.test.ts` then `pnpm sim -- WB-3`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/harness/caller.ts`:

```ts
import type { Principal } from '@uw/contracts';

export type Caller = {
  readonly actor: Principal;
  readonly traceId: string;
  readonly requestId?: string | null;
};
```

`items/record.ts`: `RecordContext` gains `readonly requestId: string | null`; `recordContext` sets `requestId: caller.requestId ?? null`; `stamp` passes `requestId: context.requestId` into `newEventSchema.parse`.

`packages/harness/hub-wakes.ts` (complete; list every transaction member explicitly, never spread the transaction, because the Drizzle store's transaction object may carry methods on a prototype):

```ts
import type { Hub, HarnessEventsGateway, Store, StoreTransaction } from './ports.ts';

function trackingEvents(events: HarnessEventsGateway, appended: Set<string>): HarnessEventsGateway {
  return {
    read: events.read,
    write: {
      append: async (drafts) => {
        const stored = await events.write.append(drafts);
        for (const event of stored) appended.add(event.harnessId);
        return stored;
      },
    },
  };
}

function tracking(tx: StoreTransaction, appended: Set<string>): StoreTransaction {
  return {
    lock: (key) => tx.lock(key),
    harnesses: tx.harnesses,
    harnessStages: tx.harnessStages,
    harnessItems: tx.harnessItems,
    harnessEvents: trackingEvents(tx.harnessEvents, appended),
    gateDecisions: tx.gateDecisions,
    delegations: tx.delegations,
    pages: tx.pages,
  };
}

export function wakingStore(store: Store, hub: Hub): Store {
  return {
    appliedMigrations: () => store.appliedMigrations(),
    transaction: async (work) => {
      const appended = new Set<string>();
      const result = await store.transaction((tx) => work(tracking(tx, appended)));
      await Promise.allSettled([...appended].map((harnessId) => hub.wake(harnessId)));
      return result;
    },
  };
}
```

`packages/harness/kernel.ts`: at the top of `createKernel`, `const live: Ports = { ...ports, store: wakingStore(ports.store, ports.hub) };` and pass `live` to every `create*` call and to `health`. (`Ports` is a plain object of adapters, so the spread is safe there.)

- [ ] **Step 4: Run them and see them pass**

Run: the commands from Step 2, then `pnpm sim -- all`.
Expected: PASS; every existing scenario still passes.

- [ ] **Step 5: Commit**

```bash
git add packages/harness sim/scenarios/WB-3.every-append-wakes-the-hub-after-commit.ts sim/fixtures.ts
git commit -m "feat(harness): every command stamps its requestId on its events, and the kernel wakes the hub after each committed append" -m "WB-1 WB-3"
```

- [ ] **Step 6: Verify** — `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` green.

---

### Task 4: Reorder places an item before another (kernel)

**Requirements:** WB-2.

**Files:**
- Create: `packages/harness/items/reorder.ts`, `sim/scenarios/WB-2.reorder-places-an-item-before-another.ts`, `sim/kernel/reorder.test.ts`
- Modify: `packages/harness/items/commands.ts`, `packages/harness/items/fold.ts`, `packages/harness/index.ts`, `tools/properties/item-events.ts` (the replay property generator gains `item_reordered`)

**Interfaces:**
- Consumes: `byPriorityThenId` (`reads/scene.ts`), `lockKeys.stageClaims`, `recordItemEvents`, `agentRefusal`, `allowed`.
- Produces: `ItemCommands.reorder(caller: Caller, input: ReorderInput): Promise<KernelOutcome<readonly ItemState[]>>`; `export type ReorderInput = { readonly itemId: string; readonly beforeItemId: string | null }` (exported from the index).

- [ ] **Step 1: Write the failing tests**

Scenario `WB-2.reorder-places-an-item-before-another.ts` (title: "reorder takes the item to place before, never an index, and the stage's order afterwards is the server's"): enqueue A, B, C in Package as the admin; `kernel.reads.inStage` order is the enqueue-independent server order; `reorder(C, before A)` → order C, A, B; `reorder(A, null)` → C, B, A; each changed item has one `item_reordered` and the moved one names `before`; `replay(events)` equals the projection for every item.

`sim/kernel/reorder.test.ts` (titles lead with WB-2 where they prove it):
- `WB-2 refuses a beforeItemId in another stage as malformed_command and changes no priority` (move B to Scope by claim and submit first; this is Review Focus line 5).
- `WB-2 refuses placing an item before itself as malformed_command`.
- `WB-2 refuses a viewer not_permitted and an agent not_permitted`.
- `WB-2 answers item_not_found for an item the caller may not read, like a missing one` (hidden equals missing).
- `WB-2 a reorder that changes nothing appends nothing`.

- [ ] **Step 2: Run them and see them fail** — `pnpm sim -- WB-2`; `TEST_DATABASE_URL=… pnpm vitest run sim/kernel/reorder.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/harness/items/reorder.ts`: one transaction:
1. `agentRefusal(caller)` → refused.
2. Read the item (`harnessItems.read.byId`); missing → `item_not_found`. Read its harness; not `allowed(actor, 'read', …)` → `item_not_found` (hidden equals missing); not `allowed(actor, 'write', …)` → `not_permitted`.
3. Find the item's stage; `tx.lock(lockKeys.stageClaims(stage.id))`; re-read the item after the lock and re-check its stage.
4. Read the stage's items (`harnessItems.read.forHarness` filtered by stage key) and sort with `byPriorityThenId`. If `beforeItemId` is the item itself, or not among them → `refused('malformed_command', { why: 'before_not_in_stage' })` (`why: 'before_is_the_item'` for itself).
5. Lock every item row of the stage in ascending id (`harnessItems.read.lock`).
6. Compute the new order and priorities with the pure function below; for each item whose priority changes, `recordItemEvents(tx, context, itemId, [draft('item_reordered', { priority, before })])` where `before` is `beforeItemId` for the moved item and `null` for the others. Return the new order.

```ts
export function reordered(
  order: readonly ItemState[],
  itemId: string,
  beforeItemId: string | null,
): readonly { readonly item: ItemState; readonly priority: number }[] {
  const moved = order.find((item) => item.itemId === itemId);
  if (moved === undefined) return [];
  const rest = order.filter((item) => item.itemId !== itemId);
  const at = beforeItemId === null ? rest.length : rest.findIndex((i) => i.itemId === beforeItemId);
  const placed = [...rest.slice(0, at), moved, ...rest.slice(at)];
  return placed.map((item, index) => ({ item, priority: (placed.length - index) * 10 }));
}
```

`fold.ts`: `item_reordered` sets `priority` from evidence. `commands.ts`: add `reorder`. `index.ts`: export `ReorderInput`. `tools/properties/item-events.ts`: generate `item_reordered` with an integer priority so the replay-equals-record property covers it.

- [ ] **Step 4: Run them and see them pass** — the Step 2 commands, then `TEST_DATABASE_URL=… pnpm vitest run tools/properties`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(harness): reorder places an item before another and renumbers its stage" -m "WB-2"
```

- [ ] **Step 6: Verify** — `pnpm verify` green with `TEST_DATABASE_URL`.

---

### Task 5: Pause and resume, stage removal (P17), and no connector change under a waiting approval

**Requirements:** WB-1 (pause/resume control), KN-18 with P17, step-5 carry (connector edited to `none`).

**Files:**
- Create: `packages/harness/stages/pause.ts`, `sim/scenarios/WB-1.pause-and-resume-a-lane-and-a-harness.ts`, `sim/scenarios/KN-18.a-stage-holding-an-item-cannot-be-removed.ts`, `sim/scenarios/KN-18.a-connector-cannot-change-under-a-waiting-approval.ts`, `sim/kernel/stage-removal.test.ts`
- Modify: `packages/harness/stages/commands.ts`, `packages/harness/stages/edit.ts`, `packages/harness/index.ts`

**Interfaces:**
- Consumes: `harnesses.write.setPaused`, `harnessStages.write.remove` (Task 2); `decisionInFlight` (`gates/parking.ts`), `readAllEvents`; `templateProperty`, `stageProblems`.
- Produces: `StageCommands.pause(caller, input: PauseInput): Promise<KernelOutcome<HarnessScene>>`, `StageCommands.resume(caller, input: PauseInput): Promise<KernelOutcome<HarnessScene>>`, `StageCommands.removeStage(caller, input: { readonly harnessId: string; readonly stageKey: string }): Promise<KernelOutcome<readonly Stage[]>>`; `export type PauseInput = { readonly harnessId: string; readonly stageKey: string | null }`; `EditWork<T>` becomes `(tx: StoreTransaction, harness: Harness, stages: readonly Stage[]) => Promise<EditPlan<T> | Refused>`.

- [ ] **Step 1: Write the failing tests**

Scenario `WB-1.pause-and-resume-a-lane-and-a-harness.ts` (title: "pause and resume record harness_paused and harness_resumed for a lane and for the harness, change the paused flags, and a repeat records nothing"): admin pauses `build`, the stage row is paused and one `harness_paused { stage: 'build' }` is recorded; pausing again records nothing; resuming records `harness_resumed { stage: 'build' }`; pausing the harness (`stageKey: null`) sets `harness.paused`; an editor is refused `not_permitted`; an agent `not_permitted`.

Scenario `KN-18.a-stage-holding-an-item-cannot-be-removed.ts`: an item at `plan`; `removeStage(plan)` is `stage_not_empty`; a fresh stage `spare` created at position 25 with no feeds and no items is removed, recording `stage_removed { stageId, key: 'spare', before }`; removing `ship` (no items) is refused because the walk loses a human gate or a feed dangles (`template_bypasses_gate` or `unknown_feed_target`, whichever `stageProblems`/`templateProperty` answers first; assert the reason the code gives and that the stage is still there).

Scenario `KN-18.a-connector-cannot-change-under-a-waiting-approval.ts`: approve an item at Ship with the sim connectors scripted to lose the outcome (use `sim/lost-exit.ts` as GH-6's scenario does), so the approval waits for its connector outcome; `updateStage(ship, { connector: 'none', exitGate: 'checks' })` is `decision_in_flight`; after recovery records the outcome, the same edit is no longer refused for that reason.

`sim/kernel/stage-removal.test.ts`: `KN-18 removal of an unknown stage is stage_not_found`; `KN-18 a non-admin cannot remove a stage`.

- [ ] **Step 2: Run them and see them fail** — `pnpm sim -- WB-1`, `pnpm sim -- KN-18`, the vitest file. Expected: FAIL.

- [ ] **Step 3: Implement**

`stages/edit.ts`: `EditWork` gains `tx` as its first argument and returns a promise; `editInTransaction` awaits `work(tx, harness, current)`. `editDrafts(before, after)` also emits, for every stage id in `before` and not in `after`, `draft('stage_removed', { stageId, key, before: columnsOf(stage) })`. Update the three existing work functions to the new signature.

`stages/commands.ts`:
- `updateWork`: when `parsed.data.connector !== undefined && parsed.data.connector !== current.connector`, read the harness's items at that stage that are `parked`; for each, `decisionInFlight(await readAllEvents(tx, harness.id, item.itemId))` → `refused('decision_in_flight', { stage: stageKey })`.
- `removeWork(stageKey)`: `stage_not_found` if absent; `refused('stage_not_empty', { stage: stageKey })` if any item of the harness has `stageKey === stageKey` (any gate status); `resulting = stages.filter(…)`; if `templateProperty(resulting)` has a violation → `template_bypasses_gate` with the same detail activation uses; `apply` calls `tx.harnessStages.write.remove(stage.id)` and returns `resulting` sorted by position. `stageProblems(resulting)` (run by `editInTransaction`) refuses a dangling `feeds` target.
- `removeStage`, `pause`, `resume` added to `createStageCommands`.

`stages/pause.ts`: one transaction: `agentRefusal`; `tx.lock(lockKeys.harnessStages(harnessId))`; read the harness (`harness_not_found`); `adminRefusal`; if `stageKey === null` compare `harness.paused` and call `setPaused`; otherwise find the stage (`stage_not_found`), compare `paused`, `tx.harnessStages.write.update({ ...stage, paused })`; append `harness_paused` or `harness_resumed` with `{ stage: stageKey }` through `recordHarnessEvents` only when the flag changed; return the harness scene re-read after the write. Lane pause does not go through `editInTransaction`, so no `stage_edited` is recorded for it (one event per control).

- [ ] **Step 4: Run them and see them pass**, then `pnpm sim -- all`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(harness): pause and resume a lane or a harness, remove an empty stage, and refuse a connector change under a waiting approval" -m "P17: a stage holding an item cannot be removed. Step 5 carry: a connector edited while an approval at that stage waits for its connector outcome is decision_in_flight." -m "WB-1 KN-18"
```

- [ ] **Step 6: Verify** — `pnpm verify` green with `TEST_DATABASE_URL`.

---

### Task 6: The gate view, the head the person saw, and event reads that hide like missing

**Requirements:** step-5 carries S5-R40 and `risk_derived.head` (proven under GH-5), KN-13 (the decision names its head), WB-3 (the one read route, hidden equals missing).

**Files:**
- Create: `packages/harness/gates/view.ts`, `sim/kernel/gate-view.test.ts`, `sim/scenarios/KN-13.an-approve-must-name-the-head-the-person-saw.ts`
- Modify: `packages/harness/gates/approve-at-ship.ts` (export `shipPreview`), `packages/harness/gates/decide.ts`, `packages/harness/gates/commands.ts`, `packages/harness/items/events.ts`, `packages/harness/reads/index.ts`, `packages/harness/index.ts`, `tools/architecture/connector-callers.test.ts` (the assembler and rule stay called only from `approve-at-ship.ts`)

**Interfaces:**
- Consumes: `GateView` (Task 1); `assembleShipInput`, `riskDerivedAtShip`, `shipRule` (only inside `approve-at-ship.ts`); `githubFacts.pullRequest`.
- Produces: `GateCommands.view(caller: Caller, input: { readonly itemId: string }): Promise<KernelOutcome<GateView>>`; `DecideInput.seenHead?: string | null`; `KernelReads.harnessIds(): Promise<readonly string[]>`; `EventReads.read` refuses an unreadable harness `harness_not_found`.

- [ ] **Step 1: Write the failing tests**

`sim/kernel/gate-view.test.ts` (sim fixtures from `sim/ship-fixtures.ts`):
- `GH-5 the gate view shows the parsed declaration, the derived tier and domains and the head they were derived at`: park an item at Ship with fixture facts whose body declares `risk_tier: high`, `risk_domains: [acl]`; `kernel.gates.view(admin, { itemId })` returns `facts.declaration` equal to the parsed declaration (closes, risks, touches, tier, domains), `recorded.head` equal to the head `risk_derived` was recorded at, `recorded.riskTier` and `recorded.riskDomains` as recorded, `ship.outcome` equal to what an approve would evaluate, `ship.derived.head` the current head, and `gateViewSchema.parse(view)` succeeds.
- `GH-5 the gate view never reads GitHub`: the sim GitHubFacts adapter counts `refresh` calls; the view makes none.
- `GH-5 the gate view of a hidden item is item_not_found like a missing one`.
- `GH-5 the gate view of an item not at a connector stage has ship null`.
- `an agent's gate view is refused not_permitted and records nothing` (supporting, no requirement ID: agents never see the gate view; it is a person's read).

Scenario `KN-13.an-approve-must-name-the-head-the-person-saw.ts`: park at Ship at head A; a new submit moves the expected head to B; `decide(approve, seenHead: A)` is `head_mismatch` and no `gate_decisions` row exists; `decide(approve, seenHead: B)` proceeds to the ship rule. (Review Focus line 2.)

In the existing events read test file (find it with `grep -rln "events.read" sim packages`), add `WB-3 an event read on a harness the caller may not read answers harness_not_found, like a missing one`.

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement**

`approve-at-ship.ts`: export

```ts
export type ShipPreview = {
  readonly input: Omit<ShipRuleInput, 'approver'>;
  readonly outcome: ShipRuleOutcome;
  readonly derived: { readonly riskTier: RiskTier | null; readonly riskDomains: readonly RiskDomain[]; readonly head: string | null } | null;
};

export function shipPreview(source: ShipInputSource): ShipPreview {
  const { approver: _approver, ...input } = assembleShipInput(source);
  const evidence = riskDerivedAtShip(source);
  return {
    input,
    outcome: shipRule({ ...input, approver: source.approver }),
    derived: evidence === null ? null : { riskTier: evidence.riskTier, riskDomains: evidence.riskDomains, head: evidence.head },
  };
}
```

(Name the unused binding to satisfy the lint config, or build `input` by omitting the key another way the lint rules accept.)

`gates/view.ts`: one transaction reads the item (`item_not_found`), its harness (hidden equals missing via `allowed(actor, 'read')`), refuses an agent `not_permitted` (`isAgent`), reads the stages and the item's events; `recorded` is the evidence of the last `risk_derived` event (or null); outside the transaction, `facts = item.pullRequest ? await ports.githubFacts.pullRequest(item.pullRequest) : null` (a `FactsUnavailableError` maps to `facts: null`); `ship` is `shipPreview({ facts, item, harness, approver: caller.actor, at, override: false })` when the stage's connector is not `none` and the item is parked with a forward exit, else null. The function returns `gateViewSchema.parse(view)`.

`decide.ts`: `DecideInput` gains `readonly seenHead?: string | null`. In `standing` (after the `item_not_at_gate` check), when `input.seenHead !== undefined` and the decision is `approve` or `override` and `input.seenHead !== item.expectedHead`, return `refused('head_mismatch', { why: 'not_the_head_you_saw', expectedHead: item.expectedHead })` before any write.

`items/events.ts`: return `refused('harness_not_found', { harnessId })` for an unreadable harness (update the existing test that expected `not_permitted`).

`reads/index.ts`: `harnessIds: () => ports.store.transaction(async (tx) => (await tx.harnesses.read.list()).map((harness) => harness.id))`.

- [ ] **Step 4: Run them and see them pass**, then `pnpm sim -- all` and `pnpm vitest run tools/architecture/connector-callers.test.ts`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(harness): the gate view shows the parsed declaration and the tier with its head, an approve names the head the person saw, and event reads hide like missing" -m "Step 5 carries S5-R40 and risk_derived.head; S6-D12." -m "GH-5 KN-13 WB-3"
```

- [ ] **Step 6: Verify** — green.

---

### Task 7: The command API frame: dispatcher, request ledger, handler builder, route, and the first item commands

**Requirements:** WB-1.

**Files:**
- Create: `apps/uw-app/commands/handler.ts`, `apps/uw-app/commands/dispatch.ts`, `apps/uw-app/commands/scope.ts`, `apps/uw-app/commands/requests.ts`, `apps/uw-app/commands/registry.ts`, `apps/uw-app/commands/routes.ts`, `apps/uw-app/commands/handlers/items.ts`, `apps/uw-app/commands/not-wired.ts`
- Create (tests): `apps/uw-app/commands/commands.pg.test.ts`, `apps/uw-app/commands/requests.pg.test.ts`, `apps/uw-app/commands/testing.ts` (route helpers: sign as a person, post a command, read the events), `tools/architecture/command-routes.test.ts`
- Modify: `apps/uw-app/app.tsx` (mount), `apps/uw-app/http/outcomes.ts` (statuses), `docs/exceptions.md` (requests.ts row), `tools/architecture/owners.test.ts` (owner of `command_requests`), `docs/architecture.md` (a "The command API" section)

**Interfaces:**
- Consumes: `harnessCommandSchemas`, `CommandName`, `CommandBody` (Task 1); `platformKernel` (`apps/uw-app/kernel.ts`); `can` (`@uw/core/acl`); `Caller` with `requestId` (Task 3).
- Produces:

```ts
export type CommandContext = {
  readonly kernel: Kernel;
  readonly caller: Caller;
  readonly harnessId: string;
  readonly harness: Harness | null;
  readonly stages: readonly Stage[];
  readonly database: DatabaseHandle;
  readonly env: Bindings;
  readonly person: PersonDeps;
  readonly hub: Hub;
  readonly clock: Clock;
  readonly logger: Logger;
};
export type CommandScope = 'harness' | 'new_harness';
export type AgentRule = 'refused' | 'recorded';
export type CommandHandler = {
  readonly name: CommandName;
  readonly action: AclAction;
  readonly scope: CommandScope;
  readonly agents: AgentRule;
  readonly run: (context: CommandContext, body: unknown) => Promise<CommandResult>;
};
export function commandHandler<Name extends CommandName>(spec: {
  readonly name: Name;
  readonly action: AclAction;
  readonly scope?: CommandScope;
  readonly agents?: AgentRule;
  readonly run: (context: CommandContext, body: CommandBody<Name>) => Promise<CommandResult>;
}): CommandHandler;
export function fromKernel<T>(outcome: KernelOutcome<T>): CommandResult;
export function notWiredCommand(name: CommandName, action: AclAction): CommandHandler;
export const commandRegistry: ReadonlyMap<CommandName, CommandHandler>;
export type PersonDeps = { readonly gateGitHub: (env: Bindings, now: () => Date) => MergeGitHub | null };
export function harnessRoutes(deps: AppDeps, person: PersonDeps): Hono<AppEnv>;
```

`PersonDeps` lives in `apps/uw-app/commands/person-deps.ts` with `export const noGateGitHub: PersonDeps = { gateGitHub: () => null }`; Task 9 replaces the platform value. `createApp(deps = platformDeps, person: PersonDeps = platformPersonDeps)` passes `person` only to `harnessRoutes`.

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/commands/commands.pg.test.ts` (pattern of `apps/uw-app/pages/pages.pg.test.ts`: `createApp(postgresDeps(db, fixture), noGateGitHub).request(path, init, fixtureAccessEnv)`; seed a software harness with `activate` through the kernel as an org admin in the test setup, and grants with `seedGrant`):

```ts
describe('WB-1 the command API', () => {
  it('WB-1 enqueue appends item_created with the actor, the requestId and the trace id', async () => {
    await withAppDatabase(async (db) => {
      const scene = await softwareHarness(db);
      const requestId = randomUUID();
      const sent = await command(db, scene.editor, scene.harnessId, 'enqueue', {
        requestId,
        title: 'Draw the board',
        pageId: null,
        due: null,
      });
      expect(sent.status).toBe(200);
      expect(sent.body).toEqual({ status: 'accepted', requestId });
      const [created] = await eventsNamed(db, scene.harnessId, 'item_created');
      expect(created).toMatchObject({ actor: `human:${scene.editorId}`, requestId, traceId: sent.traceId });
    });
  });

  it('WB-1 a repeated requestId replays the first outcome and appends nothing', async () => { /* send the same enqueue twice; same body; one item_created */ });
  it('WB-1 a requestId reused for another command is malformed_command', async () => { /* enqueue then claim with the same requestId */ });
  it('WB-1 a viewer is refused not_permitted and nothing is appended', async () => {});
  it('WB-1 a harness the caller may not read answers harness_not_found, byte-identical to a missing one', async () => {});
  it('WB-1 an unknown command answers not_wired', async () => {});
  it('WB-1 a body whose command names another command is malformed_command', async () => {});
  it('WB-1 every response is accepted or error with a closed reason and nothing else', async () => {
    /* for each response in this file: outcomeSchema.strict().parse(body) */
  });
  it('WB-1 claim and release through the command API hold and free the item for the person, with no lease', async () => {});
});
```

`apps/uw-app/commands/requests.pg.test.ts`:
- `WB-1 two claims of one requestId at the same moment: one runs, the other is request_in_flight or replays` (two connections; Review Focus line 1).
- `WB-1 a pending claim older than five minutes is retaken`.
- `WB-1 a thrown command releases its claim so a retry runs`.
- Supporting (no ID): `the ledger keys requests by actor, so another person's requestId is not replayed to you`.

`tools/architecture/command-routes.test.ts` (titles lead with WB-1; planted files in a temp dir like `connector-callers.test.ts` does):
- `WB-1 the registry serves exactly the contract's command names`: import `commandRegistry` and `commandNames`; compare.
- `WB-1 every command handler is built by commandHandler or notWiredCommand with a literal action`: every non-test file under `apps/uw-app/commands/handlers/` and `apps/uw-app/commands/person/` that declares a `name:` literal matches `/\b(?:commandHandler|notWiredCommand)\s*\(/` and `/action\s*:\s*['"](?:read|write|admin)['"]/` (for `notWiredCommand` the second argument literal).
- `WB-1 the dispatcher calls can() before it runs a handler`: `dispatch.ts` contains `can(` and the index of `can(` precedes the index of `.run(`.
- `WB-1 no route is registered outside the reviewed route files`: scan non-test `apps/uw-app/**/*.{ts,tsx}` for `/\.(?:get|post|put|patch|delete|all|on)\(\s*['"`]/`; allowed files: `apps/uw-app/app.tsx`, `apps/uw-app/commands/routes.ts`, `apps/uw-app/mcp/routes.ts`, `apps/uw-app/acl/routes.ts`, `apps/uw-app/agents/routes.ts`, `apps/uw-app/pages/routes.ts`, `apps/uw-app/health/routes.tsx`, `apps/uw-app/auth/me.ts`, `apps/uw-app/assets/routes.ts` (Task 18 creates it).
- `WB-1 flags a planted handler without a builder, a planted action that is not a literal, and a planted route file`.

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement**

`requests.ts` (owner of `command_requests`; `export const owns = ['command_requests'] as const;`):

```ts
export type RequestKey = { readonly actor: string; readonly requestId: string };
export type PriorRequest =
  | { readonly kind: 'none' }
  | { readonly kind: 'settled'; readonly command: string; readonly harnessId: string; readonly outcome: Outcome }
  | { readonly kind: 'pending'; readonly command: string; readonly harnessId: string; readonly claimedAt: Date };

export const RETAKE_AFTER_MS = 5 * 60 * 1000;

export async function priorRequest(db: Database, key: RequestKey): Promise<PriorRequest>;
export async function claimRequest(
  db: Database,
  key: RequestKey,
  claim: { readonly command: CommandName; readonly harnessId: string; readonly traceId: string; readonly at: Date },
): Promise<boolean>;
export async function settleRequest(db: Database, key: RequestKey, outcome: Outcome, at: Date): Promise<void>;
export async function releaseRequest(db: Database, key: RequestKey, traceId: string): Promise<void>;
```

`claimRequest`: `INSERT … ON CONFLICT (actor, request_id) DO NOTHING RETURNING request_id`; if no row, `UPDATE command_requests SET claimed_at = $at, trace_id = $trace WHERE actor = $1 AND request_id = $2 AND settled_at IS NULL AND command = $command AND harness_id = $harness AND claimed_at < $at - interval '5 minutes' RETURNING request_id`; true when either returned a row. `settleRequest`: `UPDATE … SET outcome = $o, settled_at = $at WHERE actor AND request_id AND settled_at IS NULL`. `releaseRequest`: `DELETE … WHERE actor AND request_id AND settled_at IS NULL AND trace_id = $trace`. `priorRequest` parses `outcome` with `outcomeSchema`.

`dispatch.ts`: `executeCommand(request: CommandRequest, scope: DispatchScope): Promise<Outcome | Refusal>` holds the logic so tests can pass any principal; the Hono handler in `routes.ts` only builds the request from the context and calls `reply`/`refuse`. Order (each step a small function, none over 50 lines):
1. Handler by name, else `not_wired` (refusal without requestId).
2. Database present, else `database_not_configured`; principal present, else `unauthenticated`.
3. Parse the body with `harnessCommandSchemas[name]`; a body whose `command` differs from `:name` fails the literal; on failure answer through `malformed` (which keeps a carried `requestId`). Parse `:harness` with `z.uuid()`; failure → `harness_not_found`.
4. `priorRequest` for `{ actor: principal.identity, requestId }`: `settled` with the same command and harness → replay its outcome; with another command or harness → `malformed_command`.
5. Scope: for `harness`, `kernel.reads.harness(caller, { harnessId }, { at })`; refused → `harness_not_found`; the area is `harness.jdArea`. For `new_harness`, the area is the body's `jdArea`.
6. Agent rule: a principal with `kind !== 'person'` → `not_permitted` when `agents === 'refused'`; when `'recorded'`, skip step 7 and go to 8 (the kernel records `gate_refused_to_agent`).
7. `can(principal, handler.action, { kind: 'area', area }, at)`, else `not_permitted`.
8. `claimRequest`; false → read `priorRequest` again: `settled` → replay; otherwise `request_in_flight`.
9. Run the handler inside `try`; on a thrown error `releaseRequest` and rethrow (the app's `onError` answers `internal_error`).
10. `toOutcome(requestId, result)`; `settleRequest`; return it.

The kernel is `platformKernel(database, clock)` built once per request (Task 9 adds the wiring argument; Task 14 adds the hub); the caller is `{ actor: principal, traceId, requestId }`; the instant is `c.get('now')`.

`handler.ts`: `commandHandler` returns the spec with defaults `scope: 'harness'`, `agents: 'refused'`, and a `run` that re-parses `body` with the command's schema (defence in depth) before calling the typed `run`. `fromKernel(outcome)` is `{ ok: true }` or `{ ok: false, reason }`.

`handlers/items.ts`: `enqueue` (write: `kernel.items.enqueue(caller, { harnessId, title, pageId, priority: 0, due, delegationId: null })`), `claim` (write: `kernel.items.claim(caller, { itemId, delegationId: null })`), `release` (write: `kernel.items.release(caller, { itemId, delegationId: null })`).

`not-wired.ts`: `notWiredCommand(name, action)` returns a handler whose run answers `{ ok: false, reason: 'not_wired' }`.

`registry.ts`: a `Map<CommandName, CommandHandler>` over the three item handlers and `notWiredCommand` for the rest, with actions: `kickstart` write, `import` write, `reorder` write, `submit_to_gate` write, `approve`/`reject`/`take_over`/`override` admin, `prompt_run`/`stop_run` write, `pause`/`resume` admin, `tweak_package` write, `schedule_regular_tweak`/`revoke_delegation` admin, `recover_connectors` admin, the stage commands admin. A test pins the action table.

`routes.ts`: `harnessRoutes(deps, person)` registers `routes.post('/:harness/commands/:name', …)`; `app.tsx` mounts `app.route('/api/harness', harnessRoutes(deps, person))` after `withPrincipal`.

`http/outcomes.ts` statuses: `harness_not_found` 404, `item_not_found` 404, `stage_not_found` 404, `issue_not_found` 404, `delegation_not_found` 404, `request_in_flight` 409, `decision_in_flight` 409, `wip_limit_reached` 409, `lease_held` 409, `not_holder` 409, `stage_not_empty` 409, `harness_exists` 409, `gate_refused_to_agent` 403.

`docs/exceptions.md` row (same commit as `requests.ts`): Rule 2, `apps/uw-app/commands/requests.ts`, "A platform module, not kernel code: it owns `command_requests` and writes it with Drizzle directly, one statement per claim, settle or release, outside any kernel transaction, as `tasks/store.ts` does for tasks.", review "Revisit when a kernel module needs the ledger."

- [ ] **Step 4: Run them and see them pass.**

Run: `TEST_DATABASE_URL=… pnpm vitest run apps/uw-app/commands tools/architecture/command-routes.test.ts tools/architecture/owners.test.ts tools/architecture/agent-boundary.test.ts`
Expected: PASS (the agent-boundary closure from `app.tsx` now includes `commands/`; nothing there touches a gate yet).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(uw-app): the command API dispatcher, its request ledger, and enqueue, claim and release as commands" -m "Every harness command resolves the harness (hidden equals missing), calls can() and only then the kernel; a repeated requestId replays the first outcome; unbuilt commands answer not_wired after can()." -m "WB-1"
```

- [ ] **Step 6: Verify** — green.

---

### Task 8: Kickstart, submit, reorder, tweak package, prompt and stop run; the stage's items in the server's order

**Requirements:** WB-1, WB-2.

**Files:**
- Modify: `apps/uw-app/commands/handlers/items.ts`, `apps/uw-app/commands/registry.ts`, `apps/uw-app/commands/routes.ts`
- Create: `apps/uw-app/commands/reads.ts` (items in a stage), `apps/uw-app/commands/items.pg.test.ts`, `apps/uw-app/commands/reorder.pg.test.ts`

**Interfaces:**
- Consumes: `kernel.items.submit`, `kernel.items.reorder` (Task 4), `kernel.reads.inStage`, `readPage` (`apps/uw-app/pages/store.ts`).
- Produces: `GET /api/harness/:harness/stages/:stage/items` → `{ items: ItemState[] }` in the kernel's order (`itemStateSchema` per item), `harness_not_found`/`stage_not_found` as refusals.

- [ ] **Step 1: Write the failing tests**

`items.pg.test.ts`:
- `WB-1 kickstart enqueues one item wrapping the harness's product page, titled with the page`: create a `product` page in `80-89` through the page API, then kickstart; one `item_created` with `pageId` and the page title.
- `WB-1 kickstart refuses a page of another type or another area as malformed_command, and a page the person cannot read as page_not_found`.
- `WB-1 submit_to_gate by the holding person runs the stage's gate`: person claims at Package (agent pickup `none` lets a person claim), submits, item advances to Scope (`none` gate).
- `WB-1 tweak_package parks an item for a person's decision on the occasional tweak`: drive an item to Validate as the holder (sim-free: through kernel calls in setup), then `tweak_package`; the item is `parked` with `gateTarget` equal to the first stage's key.
- `WB-1 prompt_run and stop_run answer not_wired after can(): a viewer gets not_permitted, an editor not_wired`.

`reorder.pg.test.ts`:
- `WB-2 reorder through the command API places the item before the named one and the stage's items read back in the server's order`: enqueue A, B, C; `reorder` C before A; `GET …/stages/package/items` lists C, A, B.
- `WB-2 a stale board's reorder against an item now in another stage is refused and the order is unchanged`.

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement**

`handlers/items.ts`:
- `kickstart` (write): `readPage(database.db, caller.actor, body.pageId, at)`; null → `page_not_found`; `page.type !== 'product'` or `page.jdArea !== harness.jdArea` → `malformed_command`; else `kernel.items.enqueue(caller, { harnessId, title: page.title.slice(0, 200), pageId: page.id, priority: 0, due: null, delegationId: null })`.
- `submit_to_gate` (write): `kernel.items.submit(caller, { itemId, to, evidence: {}, change: pullRequest && head ? { pullRequest, head } : null })`.
- `reorder` (write): `kernel.items.reorder(caller, { itemId, beforeItemId })`.
- `tweak_package` (write): the first stage by position from `context.stages`; none → `stage_not_found`; `kernel.items.submit(caller, { itemId, to: first.key, evidence: {}, change: null })`.
- `prompt_run`, `stop_run`: stay `notWiredCommand(name, 'write')` (S6-D10).

`reads.ts`: `stageItems(c)`: principal and database as the dispatcher does; `kernel.reads.inStage(caller, { harnessId, stageKey }, { at })`; `harness_not_found` → 404 refusal; accepted → `c.json({ items: value.map((item) => itemStateSchema.parse(item)) })`. `routes.ts` registers `routes.get('/:harness/stages/:stage/items', stageItems)`.

- [ ] **Step 4: Run them and see them pass.**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(uw-app): kickstart, submit, reorder and tweak package as commands, prompt and stop run not wired, and a stage's items in the server's order" -m "WB-1 WB-2"
```

- [ ] **Step 6: Verify** — green.

---

### Task 9: Kernel wiring: the hub for every kernel, and GitHub only for the gate kernel

**Requirements:** step-5 carries (person gate route's GitHub read client and ship writes; `kernel.ts` back on the allow-list), GH-6 (only the gate route's kernel gets the ship writes).

**Files:**
- Modify: `apps/uw-app/kernel.ts`, `apps/uw-app/kernel.test.ts`, `apps/uw-app/testing/kernel.ts`, `apps/uw-app/mcp/routes.ts`, `apps/uw-app/queue/worker.ts`, `apps/uw-app/cron/github-sweep.ts`, `apps/uw-app/commands/dispatch.ts`
- Create: `apps/uw-app/commands/person/gate-kernel.ts`, `apps/uw-app/commands/person/gate-github.ts`, `apps/uw-app/commands/person/gate-kernel.test.ts`
- Modify: `apps/uw-app/commands/person-deps.ts` (`platformPersonDeps`), `apps/uw-app/app.tsx`
- Modify (own commit, protected `infra` domain under P15): `.dependency-cruiser.mjs`, `tools/architecture/github-rules.test.ts`, `tools/architecture/connector-callers.test.ts`

**Interfaces:**
- Produces:

```ts
export type KernelWiring = {
  readonly hub: Hub;
  readonly reads: GitHubAccess | null;
  readonly ship: ShipGitHub | null;
};
export function hubWiring(hub: Hub): KernelWiring;
export function platformPorts(database: DatabaseHandle | null, clock?: Clock, wiring?: KernelWiring): Ports;
export function platformKernel(database: DatabaseHandle | null, clock?: Clock, wiring?: KernelWiring): Kernel;
export function gateKernel(database: DatabaseHandle, clock: Clock, github: MergeGitHub | null, hub: Hub, logger: Logger): Kernel;
export function platformGateGitHub(env: Bindings, now: () => Date): MergeGitHub | null;
export const platformPersonDeps: PersonDeps;
```

`GitHubAccess` is imported in `kernel.ts` from `./github/refresh.ts` (type only); the default wiring is `hubWiring(hubNotWired)`.

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/kernel.test.ts`:
- `GH-6 platformPorts wires the merge connector only when given the ship GitHub, and refresh only when given a read client`: with `hubWiring(hub)` the connectors answer `not_wired` and `githubFacts.refresh` rejects `PortNotWiredError`; with `{ hub, reads, ship }` from a fixture GitHub both reach the fixture.
- `WB-3 every platform kernel is given the hub it is wired with`.

`apps/uw-app/commands/person/gate-kernel.test.ts`: `GH-6 the gate kernel opens the read client and the ship writes from one GitHub App configuration, and none without it`.

`tools/architecture/connector-callers.test.ts`: replace `threeArguments` with two checks:
- `GH-6 the only kernel built with GitHub reads or the ship writes is the gate kernel`: in every non-test source under `apps/uw-app/`, a `platformKernel(`/`platformPorts(` call whose third argument is not `hubWiring(` (regex `/\bplatform(?:Kernel|Ports)\s*\(\s*[^,()]*,\s*[^,()]*,\s*(?!hubWiring\()/`) appears only in `apps/uw-app/commands/person/gate-kernel.ts`.
- `GH-6 the queue and cron roots name no ship or read wiring` (keep `shipWiring` over the roots and add `/\b(?:reads|ship)\s*:/` to it).
Keep the planted cases; add a planted `platformKernel(database, clock, { hub, reads, ship })` in `apps/uw-app/queue/w.ts` that the first check flags.

`tools/architecture/github-rules.test.ts`: planted cases proving the new dependency-cruiser rules below fail.

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: The dependency rules (own commit)**

In `.dependency-cruiser.mjs`:
- Add `^apps/uw-app/kernel\.ts$` and `^apps/uw-app/commands/person/gate-kernel\.ts$` to the allowed `from` of `github-reads-only-in-github-and-composition-roots` (`readRoots`) and of `github-module-only-in-ports-and-roots`; add `^apps/uw-app/commands/person/gate-github\.ts$` to `appConfigRoots` and to `github-module-only-in-ports-and-roots`.
- New rule `gate-kernel-only-in-gate-commands`: from `pathNot: ['^apps/uw-app/commands/person/gates\\.ts$', testFile]` to `^apps/uw-app/commands/person/gate-(kernel|github)\\.ts$`, except that `apps/uw-app/commands/person-deps.ts` may import `gate-github.ts`.
- New rule `person-surface-only-from-commands`: from `pathNot: ['^apps/uw-app/commands/', appTesting, testFile]` to `^apps/uw-app/commands/person/`.
- New rule `agent-hosts-never-import-commands`: from `^apps/uw-app/(mcp|engines|queue|cron)/` to `^apps/uw-app/commands/`.

```bash
git add .dependency-cruiser.mjs tools/architecture/github-rules.test.ts
git commit -m "build(architecture): the gate kernel alone opens GitHub for a person's decision, and no agent host imports the command API" -m "Step 5 carry: apps/uw-app/kernel.ts is back on the GitHub read-client allow-list because the person gate route's kernel is given a reader; the person surface is imported only from apps/uw-app/commands/." -m "GH-6 WB-1"
```

- [ ] **Step 4: Implement**

`kernel.ts`:

```ts
export type KernelWiring = {
  readonly hub: Hub;
  readonly reads: GitHubAccess | null;
  readonly ship: ShipGitHub | null;
};

export function hubWiring(hub: Hub): KernelWiring {
  return { hub, reads: null, ship: null };
}

const idle = hubWiring(hubNotWired);

export function platformPorts(
  database: DatabaseHandle | null,
  clock: Clock = systemClock,
  wiring: KernelWiring = idle,
): Ports {
  return {
    clock,
    ids: randomIds,
    store: database ? platformStore(database.db) : storeNotWired,
    grants: database ? platformGrants(database.db) : grantsNotWired,
    githubFacts: database
      ? platformGitHubFacts(database.db, wiring.reads, clock)
      : githubFactsNotWired,
    connectors: platformConnectors(wiring.ship),
    modelEngine: modelEngineNotWired,
    hub: wiring.hub,
    notifier: notifierNotWired,
    runs: runsNotWired,
  };
}
```

`platformKernel` mirrors it. `gate-github.ts`: `platformGateGitHub(env, now)` returns `{ app, transport: platformGitHubTransport(now) }` when `githubAppOf(env)` is not null, else null. `gate-kernel.ts`:

```ts
export function gateKernel(
  database: DatabaseHandle,
  clock: Clock,
  github: MergeGitHub | null,
  hub: Hub,
  logger: Logger,
): Kernel {
  const reads = github === null ? null : { open: () => createGitHubReads(github.app, github.transport), logger };
  return platformKernel(database, clock, { hub, reads, ship: github });
}
```

`person-deps.ts`: `export const platformPersonDeps: PersonDeps = { gateGitHub: platformGateGitHub };`. `app.tsx`: default `person = platformPersonDeps`. The MCP, queue, cron and dispatcher call sites pass `hubWiring(hubNotWired)` explicitly now (Task 14 swaps in `hubOf(env)`).

- [ ] **Step 5: Run the tests and see them pass; commit**

```bash
git commit -m "feat(uw-app): kernels take their wiring, and only the gate kernel is given the GitHub reader and the ship writes" -m "Step 5 carry: the person gate route builds its kernel with a read-only GitHub client for Ship's refresh and the ship writes for the merge connector; MCP, queue and cron kernels get the hub and nothing else." -m "GH-6 WB-1"
```

- [ ] **Step 6: Verify** — green.

---

### Task 10: The gate commands on the person surface, with the AB-7 carve-out and ADR 0009

**Requirements:** WB-1 (approve, reject, take over, override, recover connectors), KN-13 through HTTP, AB-7 (static check kept for the new routes), step-5 carries.

**Files:**
- Create: `apps/uw-app/commands/person/gates.ts`, `apps/uw-app/commands/gates.pg.test.ts`, `apps/uw-app/commands/agent-gate.pg.test.ts`, `docs/adr/0009-the-person-surface-decides-gates.md`
- Modify: `apps/uw-app/commands/registry.ts`, `tools/architecture/agent-boundary.ts`, `tools/architecture/agent-boundary.test.ts`, `docs/architecture.md` (the AB-7 table's Static row and a "The person surface" paragraph)

**Interfaces:**
- Consumes: `gateKernel` (Task 9), `DecideInput.seenHead` (Task 6), `kernel.gates.recoverConnectors`, `CommandContext.person.gateGitHub`.
- Produces: handlers `approve`, `reject`, `take_over`, `override` (`action: 'admin'`, `agents: 'recorded'`), `recover_connectors` (`action: 'admin'`, `agents: 'refused'`); `personSurface = 'apps/uw-app/commands/person/'` and `mcpReachable(sources)` in `tools/architecture/agent-boundary.ts`.

- [ ] **Step 1: Write the failing tests**

`gates.pg.test.ts` (use `apps/uw-app/github/testing/ship-rig.ts` and `fixtureGitHub()` to park an item at Ship with facts, reviews and checks that pass; pass `{ gateGitHub: () => ({ app: fixtureApp, transport: fixture.transport }) }` as `PersonDeps`):
- `WB-1 approve at Ship through the command API refreshes GitHub facts, writes one gate decision and merges through the connector` (assert one `gate_decisions` row, `gate_approved`, `connector_succeeded`, the fixture saw one merge and one tag, every event carries the `requestId`).
- `WB-1 approving twice with one requestId writes one decision and replays the outcome` (Review Focus line 1).
- `WB-1 approve naming a head other than the expected one is head_mismatch and decides nothing` (Review Focus line 2).
- `WB-1 approve with no GitHub App configured answers not_wired and decides nothing`.
- `WB-1 reject returns the item with its findings, take_over makes the person its holder, override needs a reason and records it`.
- `WB-1 an editor's approve is not_permitted before any state`.
- `WB-1 recover_connectors records a lost connector result` (use the recovery rig from `apps/uw-app/harness/recover-race.pg.test.ts` or `sim/lost-exit.ts`'s pattern on the platform store).

`agent-gate.pg.test.ts`: calls `executeCommand` directly with an agent principal (`agentOf` from `apps/uw-app/testing/kernel.ts`) holding admin: `WB-1 an agent principal on a gate command reaches the kernel, which records gate_refused_to_agent and decides nothing`; `WB-1 an agent principal on any other command is not_permitted and appends nothing`; `WB-1 an agent that cannot read the harness gets harness_not_found and nothing is recorded`.

`tools/architecture/agent-boundary.test.ts`:
- `AB-7 gate, stage and delegation-grant touches reachable from app.tsx live only in the person surface` (replace the current "no gate touch in the closure" assertion: `gateTouches(sources, agentReachable(sources).filter((f) => !f.startsWith(personSurface)))` is empty).
- `AB-7 nothing the MCP surface reaches imports the command API` (`mcpReachable(sources)` contains no file under `apps/uw-app/commands/`).
- `AB-7 a planted gate touch outside the person surface fails, and a planted MCP import of the command API fails`.

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: ADR 0009 (own commit)**

`docs/adr/0009-the-person-surface-decides-gates.md` (front matter `status: accepted`, `date: 2026-10-03`): the person surface (`apps/uw-app/commands/person/`) is the one place in `uw-app` that calls `kernel.gates`, `kernel.stages` and `kernel.delegations.grant`/`revoke`; the AB-7 static closure still starts at `app.tsx` and allows those touches only there; nothing seeded from `apps/uw-app/mcp/` may reach `apps/uw-app/commands/`; the kernel's own refusals (agents never decide, `admin` re-read under lock) remain the enforcement and the static check the backstop; only `person/gates.ts` builds a kernel with GitHub. Rejected: a second Worker for people (doubles deploy surface), a token-level allow-list of individual handlers (drifts as handlers grow). Consequence: a new gate- or stage-touching handler must live in `person/`, where review looks.

```bash
git add docs/adr/0009-the-person-surface-decides-gates.md
git commit -m "docs(adr): 0009 the person surface decides gates" -m "Shared root docs/adr: the command API adds person routes that call kernel.gates and kernel.stages; this records why they live in one directory the MCP closure cannot reach, and what was rejected." -m "WB-1 AB-7"
```

- [ ] **Step 4: Implement**

`tools/architecture/agent-boundary.ts`: export `personSurface = 'apps/uw-app/commands/person/'`; `mcpReachable(sources)` is `agentReachable` with seeds limited to files under `mcpRoot`; keep `agentReachable` seeded from `mcpRoot` and the entry points.

`person/gates.ts`:

```ts
function decision(name: 'approve' | 'reject' | 'take_over' | 'override') {
  return commandHandler({
    name,
    action: 'admin',
    agents: 'recorded',
    run: async (context, body) => {
      const github = context.person.gateGitHub(context.env, () => context.clock.now());
      const kernel = gateKernel(context.database, context.clock, github, context.hub, context.logger);
      return fromKernel(await kernel.gates.decide(context.caller, decideInput(name, body)));
    },
  });
}
```

`decideInput` maps bodies: `approve` → `{ itemId, decision: 'approve', reason: null, findings: [], seenHead: body.head }`; `override` → `reason: body.reason, seenHead: body.head`; `reject` → `findings: body.findings`; `take_over` → plain. (If one generic `decision(name)` does not type-check against `CommandBody<Name>`, write four small handlers.) `recover_connectors`: `gateKernel(…).gates.recoverConnectors(caller, { harnessId })`. The gate kernel takes `context.hub`, the same hub the dispatcher wired into `context.kernel` (`hubNotWired` until Task 14). Register the five in `registry.ts` in place of their `notWiredCommand` entries.

`docs/architecture.md`: update the AB-7 Static row to "From `apps/uw-app/app.tsx`, gate, stage and delegation-grant touches only in the person surface (`apps/uw-app/commands/person/`, ADR 0009); from `apps/uw-app/mcp/`, nothing under `apps/uw-app/commands/`"; replace "No kernel is given a read client yet …" in "The platform GitHubFacts adapter" with "Only the gate commands' kernel (`apps/uw-app/commands/person/gate-kernel.ts`) is given a read client and the ship writes".

- [ ] **Step 5: Run the tests, see them pass; commit**

```bash
git commit -m "feat(uw-app): approve, reject, take over, override and connector recovery as commands on the person surface" -m "Only the gate commands build a kernel with the GitHub reader and the ship writes; an agent principal reaching a gate command is recorded as gate_refused_to_agent by the kernel; the AB-7 static check allows gate touches only in apps/uw-app/commands/person/ and keeps the MCP closure away from the command API." -m "WB-1 KN-13 AB-7 GH-6"
```

- [ ] **Step 6: Verify** — green.

---

### Task 11: The stage and delegation commands on the person surface

**Requirements:** WB-1 (pause, resume, schedule regular tweak), KN-18 (stage command routes), KN-16 (revoke), P17.

**Files:**
- Create: `apps/uw-app/commands/person/stages.ts`, `apps/uw-app/commands/person/delegations.ts`, `apps/uw-app/commands/stages.pg.test.ts`, `apps/uw-app/commands/delegations.pg.test.ts`
- Modify: `apps/uw-app/commands/registry.ts`

**Interfaces:**
- Consumes: `kernel.stages.activate`, `createStage`, `updateStage`, `reorderStages`, `removeStage`, `pause`, `resume` (Task 5); `kernel.delegations.grant`, `revoke`; `templates` from `@uw/harness`.
- Produces: handlers `activate_template` (`scope: 'new_harness'`), `create_stage`, `update_stage`, `reorder_stages`, `remove_stage`, `pause`, `resume`, `schedule_regular_tweak`, `revoke_delegation`, all `action: 'admin'`.

- [ ] **Step 1: Write the failing tests**

`stages.pg.test.ts`:
- `WB-1 activate_template creates the harness named in the path from a template, for an admin of the body's area`; a second activation of the same id is `harness_exists`; an editor is `not_permitted`.
- `WB-1 pause and resume through the command API record harness_paused and harness_resumed`.
- `KN-18 remove_stage through the command API refuses stage_not_empty for a stage holding an item` and removes an empty spare stage.
- `KN-18 update_stage refuses decision_in_flight while an approval waits for its connector`.
- `KN-18 create_stage and reorder_stages through the command API are the stage command`.

`delegations.pg.test.ts`:
- `WB-1 schedule_regular_tweak writes a delegation for the admin with the capability word and expiry`.
- `WB-1 revoke_delegation revokes it and records delegation_revoked`.
- `WB-1 an editor cannot schedule a regular tweak`.

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement**

`person/stages.ts`: `activate_template` → `templates.get(body.template)` (absent → `malformed_command`), `kernel.stages.activate(caller, { harnessId: context.harnessId, harnessKey: body.harnessKey, jdArea: body.jdArea, template, repository: body.repository })`; the rest map one to one (`createStage(caller, { harnessId, stage: body.stage })`, `updateStage(caller, { harnessId, stageKey, change })`, `reorderStages(caller, { harnessId, order })`, `removeStage(caller, { harnessId, stageKey })`, `pause`/`resume(caller, { harnessId, stageKey })`). `person/delegations.ts`: `schedule_regular_tweak` → `kernel.delegations.grant(caller, { harnessId, persona, capability, expiresAt: expiresAt === null ? null : new Date(expiresAt), supersedes })`; `revoke_delegation` → `kernel.delegations.revoke(caller, { delegationId })`. Register all nine.

- [ ] **Step 4: Run them and see them pass.**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(uw-app): the stage command and the delegation commands on the person surface" -m "activate_template, create, update, reorder and remove stage, pause, resume, schedule_regular_tweak and revoke_delegation; P17 and the connector carry hold through the API." -m "WB-1 KN-18 KN-16"
```

- [ ] **Step 6: Verify** — green.

---

### Task 12: Import an issue by reference, from GitHub facts

**Requirements:** WB-1 (import), GH-3 (one code path for webhook, sweep and person), step-5 carry.

**Files:**
- Create: `apps/uw-app/commands/handlers/import.ts`, `apps/uw-app/commands/import.pg.test.ts`
- Modify: `apps/uw-app/github/facts/queries.ts` (`issueByNumber`), `apps/uw-app/github/import.ts` (extract `importStoredIssue`), `apps/uw-app/commands/registry.ts`, `.dependency-cruiser.mjs` (allow `^apps/uw-app/commands/handlers/import\.ts$` to import `apps/uw-app/github/import.ts` and `apps/uw-app/github/facts/queries.ts`; own commit), `tools/architecture/github-rules.test.ts`

**Interfaces:**
- Produces: `issueByNumber(db: Database, repository: string, number: number): Promise<IssueChange | null>` (case-insensitive repository match, the stored row's GitHub id, title, open state and labels); `importStoredIssue(deps: GitHubDeps, caller: Caller, change: IssueChange, logger: Logger): Promise<ImportResult>` with `ImportResult = { readonly ok: true; readonly created: boolean } | { readonly ok: false; readonly reason: ErrorReason }`.

- [ ] **Step 1: Write the failing tests**

`import.pg.test.ts` (seed `gh_repos` and `gh_issues` through `upsertFacts` with the fixture batches in `apps/uw-app/github/testing/batches.ts`):
- `WB-1 import takes the issue's GitHub id from the read model and records item_created under the person`: `item_created.evidence.issue.githubId` equals the stored id; the actor is `human:<id>`; the page's first version is written by `agent:ingest`.
- `WB-1 importing the same issue again creates nothing new`.
- `WB-1 an issue the read model does not hold is issue_not_found`.
- `WB-1 a closed issue, or one without the harness label, is not_permitted`.
- `WB-1 an issue whose repository belongs to another harness is not_permitted`.
- `WB-1 the import holds no GitHub client and leaves the cross-reference comment pending for the sweep` (assert `gh_issues.xref_comment_id` is null and no request reached a fixture).

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement**

`github/import.ts`: move the body of `importLabelled` after the caller into `importStoredIssue(deps, caller, change, logger)`, returning `ImportResult` (`not_permitted` for no import target, `slug_taken` for the page, the kernel's reason otherwise, and `ensureCrossReference` only when `deps.client !== null`); `wrapPage` writes the page with `editor: ingestIdentity` whatever the caller (S6-D16); `importLabelled` keeps its logging by calling it with the ingest caller. `handlers/import.ts` (write): `issueByNumber` → null → `issue_not_found`; `!change.open || !carriesHarnessLabel(change.labels)` → `not_permitted`; `kernel.reads.importTarget(caller, { repository: change.repo })` refused or a different `harnessId` → `not_permitted`; otherwise `importStoredIssue({ db, kernel, client: null, now }, caller, change, logger)`.

The dependency-cruiser change is its own commit:

```bash
git commit -m "build(architecture): the import command reads issues from the read model through the import path" -m "WB-1 GH-3"
```

- [ ] **Step 4: Run them and see them pass; commit**

```bash
git commit -m "feat(uw-app): a person imports an issue by reference, with its id taken from GitHub facts" -m "Step 5 carry: the IssueRef comes from gh_issues, never from the person; the webhook, the sweep and the person share importStoredIssue." -m "WB-1 GH-3"
```

- [ ] **Step 5: Verify** — green.

---

### Task 13: The one event read route and the gate view route

**Requirements:** WB-3 (sessions read after their cursor from one route, filtered by `can()`), step-5 carries (gate view).

**Files:**
- Modify: `apps/uw-app/commands/reads.ts`, `apps/uw-app/commands/routes.ts`
- Create: `apps/uw-app/commands/person/gate-view.ts`, `apps/uw-app/commands/events.pg.test.ts`, `apps/uw-app/commands/gate-view.pg.test.ts`

**Interfaces:**
- Consumes: `kernel.events.read`, `eventQuerySchema`, `eventPageReplySchema`, `kernel.gates.view`, `gateViewSchema`.
- Produces: `GET /api/harness/:harness/events?after=<n>&limit=<1..100>&item=<uuid>` → `EventPageReply`; `GET /api/harness/:harness/gates/:item` → `GateView`.

- [ ] **Step 1: Write the failing tests**

`events.pg.test.ts`:
- `WB-3 a session reads the events after its cursor, in order, a page at a time`: append 150 events (enqueue plus claims), read with `after=0` → 100 and `next`; read with `after=next` → the rest, `next: null`.
- `WB-3 an item filter returns only that item's events`.
- `WB-3 a person who loses their grant reads harness_not_found on the next read` (Review Focus line 4).
- `WB-3 a malformed cursor is malformed_command`.

`gate-view.pg.test.ts`:
- `GH-5 the gate view route shows the parsed declaration, the tier and domains and the head they were derived at` (Ship rig from Task 10; `gateViewSchema.parse(body)`; `recorded.head` and `facts.declaration` asserted).
- `GH-5 the gate view route of a hidden item is item_not_found`.

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement**

`reads.ts`: `harnessEvents(c)`: parse `c.req.query()` with `eventQuerySchema` (failure → `malformed_command`), `kernel.events.read(caller, { harnessId, itemId: query.item ?? null, after: query.after, limit: query.limit })`, refused → the refusal, accepted → `c.json(eventPageReplySchema.parse(value))`. `person/gate-view.ts`: `gateView(c)` → `kernel.gates.view(caller, { itemId })` → JSON. `routes.ts`: `routes.get('/:harness/events', harnessEvents)`, `routes.get('/:harness/gates/:item', gateView)`; the gate view checks that the item's harness is `:harness` (else `item_not_found`).

- [ ] **Step 4: Run them and see them pass; commit**

```bash
git commit -m "feat(uw-app): the one event read route by cursor, and the gate view route" -m "WB-3 GH-5"
```

- [ ] **Step 5: Verify** — green.

---

### Task 14: The live hub Durable Object and the platform Hub adapter

**Requirements:** WB-3.

**Files:**
- Create: `apps/uw-app/live/hub-core.ts`, `apps/uw-app/live/harness-hub.ts`, `apps/uw-app/live/hub-core.test.ts`, `apps/uw-app/ports/hub.ts`, `apps/uw-app/ports/hub.contract.test.ts`, `apps/uw-app/live/testing.ts` (fake hub state and namespace)
- Modify: `apps/uw-app/index.ts` (`export { HarnessHub } from './live/harness-hub.ts'`), `apps/uw-app/env.ts` (`HARNESS_HUB?: HubNamespace`), `apps/uw-app/mcp/routes.ts`, `apps/uw-app/queue/worker.ts`, `apps/uw-app/cron/github-sweep.ts`, `apps/uw-app/commands/dispatch.ts` (each passes `hubWiring(hubOf(env))`), `docs/architecture.md` (Hub row and a "The live hub" section)
- Modify (own commit, shared root `infra/`): `infra/uw-app/wrangler.toml`, `infra/uw-app/wrangler.go-live.toml`, `tools/infra/wrangler.test.ts`

**Interfaces:**
- Produces:

```ts
export type HubSocket = { send(message: string): void };
export type HubState = {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): readonly HubSocket[];
  readonly storage: {
    get(key: string): Promise<unknown>;
    put(key: string, value: string): Promise<void>;
  };
};
export type HubTimers = { setTimeout(run: () => void, ms: number): unknown };
export type HubStats = { readonly connections: number; readonly lastWakeAt: string | null };
export type HubCore = { wake(harnessId: string): void; stats(): Promise<HubStats> };
export function createHubCore(state: HubState, timers: HubTimers, now: () => Date): HubCore;
export function hubFetch(core: HubCore, state: HubState, request: Request): Promise<Response>;
export type HubNamespace = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(input: string, init?: RequestInit): Promise<Response> };
};
export function platformHub(namespace: HubNamespace): Hub;
export function hubOf(env: Bindings): Hub;
```

- [ ] **Step 1: Write the failing tests**

`hub-core.test.ts` (Workers pool; fake state from `live/testing.ts` whose sockets record what they are sent):
- `WB-3 a wake sends every session one message carrying only the harness id`: two sockets, one wake, flush; each got exactly `JSON.stringify({ type: 'wake', harnessId })` and `hubWakeSchema.parse` accepts it.
- `WB-3 wakes in one tick coalesce to one message`: three wakes before the timer runs → one message per socket (P23).
- `WB-3 a socket that throws on send does not stop the others`.
- `WB-3 stats count the connections and the last wake time`.
- `WB-3 the hub answers ping with pong without waking` — assert `hubFetch`'s constructor path sets the auto-response (the DO class test only checks `HarnessHub` is exported from `index.ts`; the hibernation runtime is not run, S6-D18).
- `WB-3 /connect without an Upgrade header is 426; /wake with a malformed body is 400; an unknown path is 404`.

`ports/hub.contract.test.ts`: `describeHubContract('the platform hub over a Durable Object namespace', open)` where `open` builds `platformHub(fakeNamespace)` over `createHubCore` instances (one per name) with fake sockets; `wakes()` waits one macrotask and returns the harness ids seen in sent messages. Keep the not-wired contract for `hub.not-wired.ts` in `not-wired.contract.test.ts` (it is still used when the binding is absent).

In `apps/uw-app/kernel.test.ts`: `WB-3 the command, MCP, queue and cron kernels are wired with the hub of their environment` (lexical: each of the four files calls `hubWiring(hubOf(`).

`tools/infra/wrangler.test.ts`: `WB-3 every environment binds HARNESS_HUB to the HarnessHub class and the migration declares it as a SQLite class`.

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: The wrangler declarations (own commit)**

In both `infra/uw-app/wrangler.toml` and `wrangler.go-live.toml`, add at top level and for each of `env.staging`, `env.production`, `env.preview` (Durable Object bindings do not inherit):

```toml
[[durable_objects.bindings]]
name = "HARNESS_HUB"
class_name = "HarnessHub"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["HarnessHub"]

[[env.staging.durable_objects.bindings]]
name = "HARNESS_HUB"
class_name = "HarnessHub"
```

(and the same `[[env.production.durable_objects.bindings]]` and `[[env.preview.durable_objects.bindings]]` blocks; `migrations` stays top-level only). No account resource is needed: the deploy creates the namespace from the exported class (S6-D18). Confirm `pnpm build` (the wrangler dry run) accepts the file.

```bash
git add infra/uw-app tools/infra/wrangler.test.ts
git commit -m "build(infra): declare the HarnessHub Durable Object for every uw-app environment" -m "Shared root infra/: WB-3's live hub is one Durable Object per harness; a SQLite-backed class needs no account resource, so the binding is declared in the live wrangler file." -m "WB-3"
```

- [ ] **Step 4: Implement**

`live/hub-core.ts`:

```ts
import { hubWakeSchema } from '@uw/contracts';

const LAST_WAKE = 'lastWakeAt';

export function createHubCore(state: HubState, timers: HubTimers, now: () => Date): HubCore {
  const pending = new Set<string>();
  const flush = async () => {
    const woken = [...pending];
    pending.clear();
    for (const harnessId of woken) {
      const message = JSON.stringify(hubWakeSchema.parse({ type: 'wake', harnessId }));
      for (const socket of state.getWebSockets()) {
        try {
          socket.send(message);
        } catch {
          continue;
        }
      }
    }
    await state.storage.put(LAST_WAKE, now().toISOString());
  };
  return {
    wake: (harnessId) => {
      const first = pending.size === 0;
      pending.add(harnessId);
      if (first) timers.setTimeout(() => void flush(), 0);
    },
    stats: async () => {
      const last = await state.storage.get(LAST_WAKE);
      return {
        connections: state.getWebSockets().length,
        lastWakeAt: typeof last === 'string' ? last : null,
      };
    },
  };
}
```

(If the lint config refuses the empty `catch`, record the failure in a counter the stats report, or move the send into a helper that returns a boolean.) `hubFetch(core, state, request)`: `/connect` needs `Upgrade: websocket` (else 426), creates `new WebSocketPair()`, `state.acceptWebSocket(pair[1])`, returns `new Response(null, { status: 101, webSocket: pair[0] })`; `POST /wake` parses `z.strictObject({ harnessId: z.uuid() })` (else 400), `core.wake`, 202; `GET /stats` returns the stats JSON; else 404.

`live/harness-hub.ts`:

```ts
import { DurableObject } from 'cloudflare:workers';

export class HarnessHub extends DurableObject<Bindings> {
  private readonly core: HubCore;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.core = createHubCore(hubStateOf(ctx), { setTimeout }, () => new Date());
  }

  override fetch(request: Request): Promise<Response> {
    return hubFetch(this.core, hubStateOf(this.ctx), request);
  }

  override webSocketMessage(): void {}

  override webSocketClose(socket: WebSocket, code: number): void {
    socket.close(code, 'closed');
  }
}
```

(`hubStateOf(ctx)` adapts `ctx.acceptWebSocket`, `ctx.getWebSockets()` and `ctx.storage.get/put`. If the empty `webSocketMessage` body trips a lint rule, have it ignore the message by returning `undefined` explicitly. The constructor reads the clock once through `() => new Date()` only at wake time; if the no-clock-reads architecture check flags `new Date()` here, take the clock from `systemClock` in `apps/uw-app/ports/clock.ts`.)

`ports/hub.ts`:

```ts
export function platformHub(namespace: HubNamespace): Hub {
  return {
    wake: async (harnessId) => {
      const stub = namespace.get(namespace.idFromName(harnessId));
      const answer = await stub.fetch('https://hub.internal/wake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ harnessId }),
      });
      if (answer.status !== 202) throw new Error(`hub wake answered ${answer.status}`);
    },
  };
}

export function hubOf(env: Bindings): Hub {
  return env.HARNESS_HUB ? platformHub(env.HARNESS_HUB) : hubNotWired;
}
```

Swap `hubWiring(hubNotWired)` for `hubWiring(hubOf(env))` in the MCP routes, the queue worker, the cron sweep and the dispatcher (the gate kernel takes `context.hub`, which the dispatcher sets to `hubOf(env)`).

- [ ] **Step 5: Run the tests, see them pass, and commit**

```bash
git commit -m "feat(uw-app): the live hub, one Durable Object per harness, and the platform Hub adapter that wakes it" -m "Wakes in one tick coalesce to one message that carries only the harness id; the hub stores only its last wake time." -m "WB-3"
```

- [ ] **Step 6: Verify** — green.

---

### Task 15: The live socket route and the hub's health indicator

**Requirements:** WB-3 (sessions connect through `can()`; connection count and last wake time are health indicators).

**Files:**
- Create: `apps/uw-app/live/connect.ts`, `apps/uw-app/live/connect.pg.test.ts`, `apps/uw-app/health/hub.ts`, `apps/uw-app/health/hub.pg.test.ts`
- Modify: `apps/uw-app/commands/routes.ts` (`routes.get('/:harness/live', connectLive)`), `apps/uw-app/health/indicators.ts`, `apps/uw-app/health/routes.tsx` (pass what the indicator needs), `tools/architecture/command-routes.test.ts` (no change to the allow-list: the route is registered in `commands/routes.ts`)

**Interfaces:**
- Consumes: `hubOf`, `HubNamespace`, `kernel.reads.harness`, `kernel.reads.harnessIds` (Task 6), `deps.timers`.
- Produces: `GET /api/harness/:harness/live` forwards a WebSocket upgrade to the harness's hub at `https://hub.internal/connect`; `hubIndicator(env, kernel, timers): Promise<HealthIndicator>` named `live_hub`.

- [ ] **Step 1: Write the failing tests**

`connect.pg.test.ts` (fake `HARNESS_HUB` namespace in the env whose stub records the forwarded request and answers 200 with header `x-hub: connected`, since Node cannot build a 101 response):
- `WB-3 a reader's upgrade is forwarded to the harness's hub` (the stub saw `/connect` for the `idFromName(harnessId)`).
- `WB-3 a harness the person may not read answers harness_not_found and never reaches the hub`.
- `WB-3 a request without an Upgrade header is malformed_command with status 426`.
- `WB-3 no HARNESS_HUB binding answers not_wired`.

`health/hub.pg.test.ts`:
- `WB-3 the live_hub indicator sums connections and reports the latest wake across harnesses`.
- `WB-3 live_hub is not_configured without the binding and amber when a hub does not answer in 2 seconds` (inject `deps.timers` as the FD-11 health test does).

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement**

`connect.ts`: principal and database as the dispatcher; `Upgrade` header `websocket` (case-insensitive) else `c.json({ status: 'error', reason: 'malformed_command' }, 426)`; `kernel.reads.harness(caller, { harnessId }, { at })` refused → `harness_not_found`; `env.HARNESS_HUB` absent → `not_wired`; else `return stub.fetch(new Request('https://hub.internal/connect', c.req.raw))`.

`health/hub.ts`: no binding → `{ name: 'live_hub', status: 'not_configured', detail: 'no hub binding' }`; else the first 50 of `kernel.reads.harnessIds()`, each `GET https://hub.internal/stats` raced against a 2 s timer; detail `"<n> connections across <m> harnesses; last wake <iso or never>"` (at most 200 characters); `amber` if any failed or timed out, else `ok`. `indicators.ts` appends it (a database-less run reports `not_configured`).

- [ ] **Step 4: Run them and see them pass; commit**

```bash
git commit -m "feat(uw-app): the live socket route behind can(), and live_hub on /health with connections and the last wake" -m "WB-3"
```

- [ ] **Step 5: Verify** — green.

---

### Task 16: The live session: a cursor, a reconnecting socket and the polling fallback

**Requirements:** WB-3 (each session holds its cursor; polling is the fallback; killing the object loses nothing).

**Files:**
- Create: `apps/uw-app/islands/live/session.ts`, `apps/uw-app/islands/live/read-events.ts`, `apps/uw-app/islands/live/session.test.ts`, `apps/uw-app/islands/live/read-events.test.ts`
- Modify: `apps/uw-app/package.json` (dependency `partysocket`), `docs/progress_tracker.md` is not touched here (Task 21 records the dependency)

**Interfaces:**
- Produces:

```ts
export type LiveSocket = {
  addEventListener(type: 'open' | 'close' | 'message', listener: (event: { readonly data?: unknown }) => void): void;
  close(): void;
};
export type LiveTimers = {
  setInterval(run: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};
export type LiveSessionOptions = {
  readonly harnessId: string;
  readonly cursor: number;
  readonly read: (after: number) => Promise<EventPageReply>;
  readonly connect: () => LiveSocket;
  readonly onEvents: (events: readonly HarnessEvent[]) => void;
  readonly timers: LiveTimers;
};
export type LiveSession = { cursor(): number; close(): void };
export const POLL_MS = 15_000;
export const BACKOFF = { minReconnectionDelay: 1_000, maxReconnectionDelay: 30_000, reconnectionDelayGrowFactor: 2 } as const;
export function startLiveSession(options: LiveSessionOptions): LiveSession;
export function reconnectingSocket(url: string): LiveSocket;
export function readEvents(fetcher: typeof fetch, harnessId: string): (after: number) => Promise<EventPageReply>;
```

`reconnectingSocket(url)` is `new ReconnectingWebSocket(url, [], { ...BACKOFF, connectionTimeout: 10_000 })` from `partysocket/ws` (`partysocket` `^1.1.0`, MIT; it runs in browsers and Workers and has no telemetry; record the resolved version).

- [ ] **Step 1: Write the failing tests**

`session.test.ts` (Workers pool; a fake socket with `emit('open' | 'close' | 'message')`, a fake `read` over an in-memory event list that the test appends to, `vi.useFakeTimers()` driving a fake `LiveTimers` built on `setInterval`):
- `WB-3 on open the session reads from its cursor and delivers each event once, in order`.
- `WB-3 a wake makes the session read after its cursor; a wake during a read causes exactly one more read` (Review Focus line 3).
- `WB-3 the cursor never moves backwards, even when a slow read answers after a newer one`.
- `WB-3 while the socket is closed the session polls every 15 seconds, and stops polling once it opens`.
- `WB-3 killing the hub mid-session loses nothing`: open, deliver 2 events, emit `close`, append 3 events, advance 15 s (poll) and then emit `open` (reconnect): exactly the 3 new events delivered once, in order (Review Focus line 3).
- `WB-3 a message that is not a wake is ignored, and a failed read keeps the cursor`.
- `WB-3 the reconnect backoff starts at 1 second, doubles, and stops at 30 seconds` (assert `BACKOFF` equals P23's values and `reconnectingSocket` passes them; the doubling itself is partysocket's).

`read-events.test.ts`: `WB-3 readEvents asks the one read route with the cursor and parses the page` (fake `fetch`; asserts the URL `/api/harness/<id>/events?after=<n>` and that an invalid page rejects).

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement**

`session.ts`: state `{ cursor, reading: boolean, again: boolean, open: boolean, poll: handle | null, closed: boolean }`. `pull()`: if reading, set `again` and return; else loop: `page = await read(cursor)`; keep only events with `position > cursor`; deliver; `cursor = Math.max(cursor, last.position)`; continue while `page.next !== null`; then if `again`, clear it and pull once more; on a rejected read, stop and keep the cursor. Socket `open` → `open = true`, stop polling, pull. `close` → `open = false`, start polling (`setInterval(pull, POLL_MS)`) unless closed. `message` → parse `JSON.parse(data)` with `hubWakeSchema.safeParse` and the matching `harnessId` → pull. Polling starts at once if the socket has not opened. `close()` stops polling and closes the socket. Islands import `@uw/contracts` only (never `@uw/harness`).

`read-events.ts`: `fetcher(`/api/harness/${harnessId}/events?after=${after}`, { headers: { accept: 'application/json' } })`, non-200 → reject, body → `eventPageReplySchema.parse`.

- [ ] **Step 4: Run them and see them pass; commit**

```bash
git commit -m "feat(uw-app): the live session holds its cursor, reconnects with backoff, and polls the one read route while the socket is down" -m "Adds partysocket for the reconnecting socket." -m "WB-3"
```

- [ ] **Step 5: Verify** — green.

---

### Task 17: The design system's tokens, the Tailwind 4 theme over them, and the checks

**Requirements:** WB-11.

**Files:**
- Create: `packages/ui/package.json` (`@uw/ui`, `"type": "module"`, exports map for `./components/*`, `./generated/app-css`; dependency `hono` `^4.13.11`; devDependencies `tailwindcss` and `@tailwindcss/cli` `^4.1.0`, `colorjs.io` `^0.5.2`), `packages/ui/tsconfig.json` (extends the base; `"jsx": "react-jsx"`, `"jsxImportSource": "hono/jsx"`), `packages/ui/tokens/brand.css`, `packages/ui/tokens/theme.css`, `packages/ui/tokens/type.css`, `packages/ui/tokens/layout.css`, `packages/ui/app.css`, `packages/ui/generated/app-css.ts` (generated), `packages/ui/tokens/tokens.test.ts`, `packages/ui/tokens/contrast.test.ts`, `tools/ui/build-css.ts`, `tools/ui/generated-css.test.ts`, `tools/ui/tokens-agree.test.ts`, `tools/ui/no-hex.test.ts`, `tools/ui/css-tokens.ts` (a small parser shared by the tests)
- Modify: root `package.json` (scripts `"ui:css": "node tools/ui/build-css.ts"`), `knip.json` (workspace `packages/ui` with `project: ["**/*.ts", "**/*.tsx"]`, entry `tools/ui/build-css.ts` in the root workspace), `.prettierignore` (`packages/ui/generated/`), `apps/uw-app/package.json` (`"@uw/ui": "workspace:*"`), `vitest.config.ts` only if `packages/ui` tests need it (they are `.test.ts` and already included by `packages/**/*.test.ts`), `docs/architecture.md` (`packages/ui` line)

**Interfaces:**
- Produces: token names `--uw-brand-inspire`, `--uw-brand-ocean`, `--uw-brand-tech`, `--uw-brand-cultivate`, `--uw-brand-kindle`; semantic `--uw-bg`, `--uw-surface`, `--uw-ink`, `--uw-muted`, `--uw-line`, `--uw-ocean`, `--uw-ocean-panel`, `--uw-ocean-panel-ink`, `--uw-inspire`, `--uw-inspire-soft`, `--uw-cultivate`, `--uw-cultivate-soft`, `--uw-kindle`, `--uw-kindle-soft`, `--uw-on-accent`, `--uw-link`, `--uw-focus`; type `--uw-font-sans`, `--uw-font-mono`, `--uw-text-xs|sm|base|lg|xl|2xl`; layout `--uw-space`, `--uw-radius-sm|md|lg`, `--uw-breakpoint-md`, `--uw-breakpoint-lg`, `--uw-sidebar`; Tailwind utilities `bg-bg`, `bg-surface`, `text-ink`, `text-muted`, `border-line`, `bg-ocean-panel`, `text-ocean-panel-ink`, `text-ocean`, `bg-inspire`, `bg-inspire-soft`, `bg-cultivate`, `bg-cultivate-soft`, `bg-kindle`, `bg-kindle-soft`, `text-on-accent`, `text-link`, `outline-focus`, `font-sans`, `font-mono`, `text-xs…text-2xl`, `rounded-sm|md|lg`, `md:`, `lg:`; `appCss: string`, `appCssPath: string` from `@uw/ui/generated/app-css`.

- [ ] **Step 1: Write the tokens and the theme**

`packages/ui/tokens/brand.css`:

```css
:root {
  --uw-brand-inspire: #31ade3;
  --uw-brand-ocean: #014263;
  --uw-brand-tech: #231f20;
  --uw-brand-cultivate: #70c9cc;
  --uw-brand-kindle: #e59d33;
}
```

`packages/ui/tokens/theme.css` (light from the prototype, dark from Key Visuals, S6-D21):

```css
:root {
  color-scheme: light;
  --uw-bg: #f4f8fa;
  --uw-surface: #ffffff;
  --uw-ink: var(--uw-brand-tech);
  --uw-muted: #5a6e7a;
  --uw-line: #c4d3db;
  --uw-ocean: var(--uw-brand-ocean);
  --uw-ocean-panel: var(--uw-brand-ocean);
  --uw-ocean-panel-ink: #e8f4fa;
  --uw-inspire: var(--uw-brand-inspire);
  --uw-inspire-soft: #e3f3fb;
  --uw-cultivate: #4fa9ac;
  --uw-cultivate-soft: #e4f4f4;
  --uw-kindle: #c97f14;
  --uw-kindle-soft: #fbefdc;
  --uw-on-accent: #04222f;
  --uw-link: var(--uw-brand-ocean);
  --uw-focus: var(--uw-brand-ocean);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
    --uw-bg: #0b171e;
    --uw-surface: #11222c;
    --uw-ink: #e6eef2;
    --uw-muted: #94aab5;
    --uw-line: #2c4756;
    --uw-ocean: #7fc3e8;
    --uw-ocean-panel: #0e2c3c;
    --uw-ocean-panel-ink: #d9edf8;
    --uw-inspire: var(--uw-brand-inspire);
    --uw-inspire-soft: #10303f;
    --uw-cultivate: var(--uw-brand-cultivate);
    --uw-cultivate-soft: #0f2e30;
    --uw-kindle: var(--uw-brand-kindle);
    --uw-kindle-soft: #33270f;
    --uw-on-accent: #04222f;
    --uw-link: var(--uw-brand-inspire);
    --uw-focus: var(--uw-brand-inspire);
  }
}

:root[data-theme='dark'] {
  color-scheme: dark;
  --uw-bg: #0b171e;
  --uw-surface: #11222c;
  --uw-ink: #e6eef2;
  --uw-muted: #94aab5;
  --uw-line: #2c4756;
  --uw-ocean: #7fc3e8;
  --uw-ocean-panel: #0e2c3c;
  --uw-ocean-panel-ink: #d9edf8;
  --uw-inspire: var(--uw-brand-inspire);
  --uw-inspire-soft: #10303f;
  --uw-cultivate: var(--uw-brand-cultivate);
  --uw-cultivate-soft: #0f2e30;
  --uw-kindle: var(--uw-brand-kindle);
  --uw-kindle-soft: #33270f;
  --uw-on-accent: #04222f;
  --uw-link: var(--uw-brand-inspire);
  --uw-focus: var(--uw-brand-inspire);
}
```

`type.css`: `--uw-font-sans: 'Nunito Sans', 'Avenir', 'Avenir Next', system-ui, sans-serif; --uw-font-mono: ui-monospace, SFMono-Regular, Menlo, monospace; --uw-text-xs: 0.75rem; --uw-text-sm: 0.875rem; --uw-text-base: 1rem; --uw-text-lg: 1.125rem; --uw-text-xl: 1.375rem; --uw-text-2xl: 1.75rem;`. `layout.css`: `--uw-space: 0.25rem; --uw-radius-sm: 4px; --uw-radius-md: 6px; --uw-radius-lg: 10px; --uw-breakpoint-md: 48rem; --uw-breakpoint-lg: 64rem; --uw-sidebar: 16rem;`.

`packages/ui/app.css`:

```css
@import 'tailwindcss' source(none);
@import './tokens/brand.css';
@import './tokens/theme.css';
@import './tokens/type.css';
@import './tokens/layout.css';

@source './components';
@source '../../apps/uw-app';

@theme {
  --color-*: initial;
  --font-*: initial;
  --text-*: initial;
  --radius-*: initial;
  --shadow-*: initial;
  --breakpoint-*: initial;
  --breakpoint-md: 48rem;
  --breakpoint-lg: 64rem;
}

@theme inline {
  --color-bg: var(--uw-bg);
  --color-surface: var(--uw-surface);
  --color-ink: var(--uw-ink);
  --color-muted: var(--uw-muted);
  --color-line: var(--uw-line);
  --color-ocean: var(--uw-ocean);
  --color-ocean-panel: var(--uw-ocean-panel);
  --color-ocean-panel-ink: var(--uw-ocean-panel-ink);
  --color-inspire: var(--uw-inspire);
  --color-inspire-soft: var(--uw-inspire-soft);
  --color-cultivate: var(--uw-cultivate);
  --color-cultivate-soft: var(--uw-cultivate-soft);
  --color-kindle: var(--uw-kindle);
  --color-kindle-soft: var(--uw-kindle-soft);
  --color-on-accent: var(--uw-on-accent);
  --color-link: var(--uw-link);
  --color-focus: var(--uw-focus);
  --font-sans: var(--uw-font-sans);
  --font-mono: var(--uw-font-mono);
  --text-xs: var(--uw-text-xs);
  --text-sm: var(--uw-text-sm);
  --text-base: var(--uw-text-base);
  --text-lg: var(--uw-text-lg);
  --text-xl: var(--uw-text-xl);
  --text-2xl: var(--uw-text-2xl);
  --radius-sm: var(--uw-radius-sm);
  --radius-md: var(--uw-radius-md);
  --radius-lg: var(--uw-radius-lg);
  --spacing: var(--uw-space);
}

@layer base {
  body {
    background: var(--uw-bg);
    color: var(--uw-ink);
    font-family: var(--uw-font-sans);
  }
}
```

`tools/ui/build-css.ts`: runs `pnpm exec tailwindcss -i packages/ui/app.css -o <tmp>/app.css --minify` (`node:child_process` `execFileSync`), reads it, computes `sha256` (`node:crypto`), and writes `packages/ui/generated/app-css.ts` as:

```ts
export const appCssPath = '/assets/app-<first 12 hex of the hash>.css';
export const appCss = <JSON.stringify of the css>;
```

With `--check` it writes nothing and exits 1 when the file differs. Run `pnpm ui:css` once and commit the output.

- [ ] **Step 2: Write the checks (they fail until Step 1 is complete; write them first and watch them fail against an empty `packages/ui`)**

`packages/ui/tokens/tokens.test.ts`:
- `WB-11 the five brand colours are tokens with the brand guide's values` (`#31ADE3`, `#014263`, `#231F20`, `#70C9CC`, `#E59D33`, compared case-insensitively).
- `WB-11 light and dark define the same semantic tokens, and the forced-dark block equals the system-dark block`.

`packages/ui/tokens/contrast.test.ts` (resolve `var()` through `tools/ui/css-tokens.ts`; `new Color(a).contrast(new Color(b), 'WCAG21')` from `colorjs.io`), in both themes:
- `WB-11 text tokens meet 4.5:1 on their backgrounds`: ink/bg, ink/surface, muted/surface, muted/bg, link/surface, ocean/surface, on-accent/inspire, on-accent/cultivate, on-accent/kindle, ink/inspire-soft, ink/cultivate-soft, ink/kindle-soft, ocean-panel-ink/ocean-panel.
- `WB-11 the focus ring and the human-action colour meet 3:1 against the surface`: focus/surface, kindle/surface.

`tools/ui/tokens-agree.test.ts`:
- `WB-11 every theme value is a token`: each declaration in the `@theme` and `@theme inline` blocks of `packages/ui/app.css`, other than the `initial` resets, is `var(--uw-…)` naming a token defined in `packages/ui/tokens/*.css`, or a literal equal to the token named `--uw-` plus the theme name (`--breakpoint-md` ↔ `--uw-breakpoint-md`).
- `WB-11 every semantic colour token has a theme colour` (each `--uw-*` in `theme.css` has `--color-<same suffix>`).
- `WB-11 flags a planted theme value that is not a token, and a planted token with no theme colour`.

`tools/ui/generated-css.test.ts`:
- `WB-11 the committed stylesheet is the Tailwind build of the tokens and components` (runs `node tools/ui/build-css.ts --check`).
- `WB-11 the stylesheet has no red and no Tailwind default colour` (`appCss` contains no `--color-red` and no `--color-` name outside the 17 above).

`tools/ui/no-hex.test.ts`:
- `WB-11 no hex colour or colour function outside the token files`: every git-tracked, non-test `.ts`, `.tsx`, `.css` and `.html` file under `apps/` and `packages/`, except `packages/ui/tokens/*.css` and `packages/ui/generated/app-css.ts`, matches none of `/['"`]\s*#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/` (TS/TSX), `/#[0-9a-fA-F]{3,8}\b/` (CSS and HTML), `/\b(?:rgba?|hsla?|oklch)\(/`.
- `WB-11 flags a planted hex colour in a component and in a stylesheet`.

- [ ] **Step 3: Run them and see them pass**

Run: `pnpm install`, `pnpm ui:css`, then `TEST_DATABASE_URL=… pnpm vitest run packages/ui tools/ui`.
Expected: PASS. Confirm `pnpm exec tailwindcss --help` runs in CI's image (the oxide binary installs through optional dependencies; if pnpm blocks a build script, add the package to `onlyBuiltDependencies` in `pnpm-workspace.yaml` and say so in the commit).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ui): brand tokens, a Tailwind 4 theme that is the tokens and nothing else, and the tokens-agree, contrast and no-hex checks" -m "Adds tailwindcss, @tailwindcss/cli and colorjs.io; the built stylesheet is committed as packages/ui/generated/app-css.ts and a test rebuilds it." -m "WB-11"
```

- [ ] **Step 5: Verify** — green.

---

### Task 18: The shell: sidebar, top bar, page head, segmented control, the theme switch and the stylesheet route

**Requirements:** WB-11 (shell pieces exist once; fluid; dark follows the system with a persisted `data-theme` override).

**Files:**
- Create: `packages/ui/components/shell.tsx`, `packages/ui/components/sidebar.tsx`, `packages/ui/components/top-bar.tsx`, `packages/ui/components/page-head.tsx`, `packages/ui/components/segmented-control.tsx`, `packages/ui/components/theme-switch.tsx`, `packages/ui/components/shell.test.ts`, `packages/ui/components/segmented-control.test.ts`, `apps/uw-app/assets/routes.ts`, `apps/uw-app/assets/routes.test.ts`
- Modify: `apps/uw-app/app.tsx` (mount the stylesheet before `withPrincipal`; render `/` in the shell), `apps/uw-app/app.test.ts`, `docs/exceptions.md` (stylesheet row), `packages/ui/generated/app-css.ts` (regenerated)

**Interfaces:**
- Produces:

```ts
export type NavItem = { readonly href: string; readonly label: string; readonly jd?: string };
export type Crumb = { readonly label: string; readonly href?: string };
export function Shell(props: { readonly title: string; readonly nav: readonly NavItem[]; readonly current: string; readonly crumbs: readonly Crumb[]; readonly stylesheet: string; readonly children?: Child }): JSX.Element;
export function Sidebar(props: { readonly items: readonly NavItem[]; readonly current: string }): JSX.Element;
export function TopBar(props: { readonly crumbs: readonly Crumb[] }): JSX.Element;
export function PageHead(props: { readonly title: string; readonly eyebrow?: string; readonly lede?: string; readonly actions?: Child }): JSX.Element;
export type Choice = { readonly value: string; readonly label: string };
export function SegmentedControl(props: { readonly name: string; readonly legend: string; readonly choices: readonly Choice[]; readonly selected: string }): JSX.Element;
export function ThemeSwitch(): JSX.Element;
export const THEME_KEY = 'uw-theme';
export function assetRoutes(): Hono<AppEnv>;
```

- [ ] **Step 1: Write the failing tests**

`shell.test.ts` (render with `String(await Shell({...}))` or `jsx(Shell, props)`; titles lead with WB-11):
- `WB-11 the shell renders one main landmark, a labelled navigation and a skip link`: `<main id="main"`, `<nav aria-label="Main"`, `<a href="#main"`.
- `WB-11 the shell is fluid: no fixed page width, the sidebar collapses into a disclosure below the md breakpoint`: no `w-[1440px]`-style width; the nav is inside `<details` with a `<summary` labelled "Menu" that is `md:hidden`; the sidebar column is `md:grid-cols-[var(--uw-sidebar)_1fr]`.
- `WB-11 the current page is marked aria-current="page"`.
- `WB-11 the theme script reads the persisted choice before paint and sets data-theme`: the head carries an inline script referencing `uw-theme` and `data-theme`, before the stylesheet link.
- `WB-11 copy says unfoldingWord in camelCase and has no exclamation marks`.

`segmented-control.test.ts`: `WB-11 a segmented control is a fieldset with a legend and one labelled radio per choice, the selected one checked`; `WB-11 every control has visible focus` (each input or label carries `focus-visible:outline-2` and `outline-focus`).

`apps/uw-app/assets/routes.test.ts`: `WB-11 the stylesheet is served at its hashed path as text/css, immutable` and `WB-11 any other asset path is 404`.

Update `app.test.ts`: `/` renders inside the shell (has `<nav aria-label="Main"` and the deployed commit line).

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement**

`shell.tsx` (complete, as the reference for the other components):

```tsx
import type { Child } from 'hono/jsx';
import { raw } from 'hono/html';
import { Sidebar, type NavItem } from './sidebar.tsx';
import { TopBar, type Crumb } from './top-bar.tsx';
import { THEME_KEY } from './theme-switch.tsx';

const themeScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export function Shell(props: {
  readonly title: string;
  readonly nav: readonly NavItem[];
  readonly current: string;
  readonly crumbs: readonly Crumb[];
  readonly stylesheet: string;
  readonly children?: Child;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{props.title}</title>
        <script>{raw(themeScript)}</script>
        <link rel="stylesheet" href={props.stylesheet} />
      </head>
      <body class="min-h-dvh bg-bg text-ink font-sans text-base">
        <a href="#main" class="sr-only focus-visible:not-sr-only focus-visible:outline-2 outline-focus">
          Skip to content
        </a>
        <div class="grid min-h-dvh md:grid-cols-[var(--uw-sidebar)_1fr]">
          <Sidebar items={props.nav} current={props.current} />
          <div class="flex min-w-0 flex-col">
            <TopBar crumbs={props.crumbs} />
            <main id="main" class="min-w-0 flex-1 p-4 md:p-6">
              {props.children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
```

(`var(--uw-sidebar)` inside a Tailwind arbitrary value is a token reference, not a literal; the no-hex test allows it.) `sidebar.tsx`: `<aside class="bg-ocean-panel text-ocean-panel-ink">` holding the wordmark "unfoldingWord" and one `<details class="group">` whose `<summary class="md:hidden">Menu</summary>` is followed by `<nav aria-label="Main" class="hidden group-open:block md:block">` (one navigation, shown behind the disclosure below `md` and always from `md` up; no JavaScript); each link `aria-current={current === href ? 'page' : undefined}`, with `focus-visible:outline-2 outline-focus`. `top-bar.tsx`: `<header>` with `<nav aria-label="Breadcrumb"><ol>` crumbs and the `ThemeSwitch`. `page-head.tsx`: eyebrow `text-xs text-ocean`, `<h1 class="text-2xl font-extrabold">`, lede `text-muted`, actions slot. `segmented-control.tsx`: `<fieldset><legend class="sr-only">` and one `<label>` per choice wrapping an `<input type="radio" name value checked>` and its text, with `focus-visible` styles on the input. `theme-switch.tsx`: `SegmentedControl` named `theme` with legend "Colour theme" and choices System, Light, Dark, plus an inline script that sets `data-theme` and `localStorage` on change (System removes both); `THEME_KEY = 'uw-theme'`.

`apps/uw-app/assets/routes.ts`: `routes.get(appCssPath, (c) => c.body(appCss, 200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable' }))` and nothing else; `app.tsx` mounts `app.route('/', assetRoutes())` before `app.use(withPrincipal(deps))`, and renders `/` as `<Shell title="unfoldingWord" nav={[{ href: '/', label: 'Home' }, { href: '/health', label: 'Health' }]} current="/" crumbs={[{ label: 'Home' }]} stylesheet={appCssPath}>` with a `PageHead` titled "unfoldingWord" and the line "Deployed commit {commit}.".

`docs/exceptions.md` row (same commit): "Section 10: no route without `can()`; PRD FD-7: the Access JWT is verified on every request | `apps/uw-app/assets/routes.ts` (`GET /assets/app-<hash>.css`) | The stylesheet carries no harness, page or person data; it is served before the principal middleware so a page's stylesheet does not mint a principal on every load. Access still fronts the host at the edge. | Any asset that carries data goes behind the principal and `can()`."

Run `pnpm ui:css` and commit the regenerated file with the components.

- [ ] **Step 4: Run them and see them pass; commit**

```bash
git commit -m "feat(ui): the shell, sidebar, top bar, page head, segmented control and theme switch, and the hashed stylesheet route" -m "WB-11"
```

- [ ] **Step 5: Verify** — green. Then, if a browser is available, load `/` with `pnpm --filter @uw/uw-app dev` in light and dark at 390 px width and check focus; if not, say so in the report (Task 21 records it under Not verified).

---

### Task 19: Content pieces: card, badge, chip, table, KPI, note, evidence label; money formatted once

**Requirements:** WB-11.

**Files:**
- Create: `packages/ui/components/card.tsx`, `badge.tsx`, `chip.tsx`, `table.tsx`, `kpi.tsx`, `note.tsx`, `evidence-label.tsx`, and their `*.test.ts`; `packages/core/money.ts`, `packages/core/money.test.ts`; `tools/ui/one-formatter.test.ts`; `tools/ui/evidence-labels.test.ts`
- Modify: `packages/core/package.json` (export `./money`), `packages/ui/generated/app-css.ts` (regenerated)

**Interfaces:**
- Produces:

```ts
export function Card(props: { readonly title?: string; readonly children?: Child }): JSX.Element;
export type BadgeTone = 'neutral' | 'info' | 'success' | 'held';
export function Badge(props: { readonly tone: BadgeTone; readonly children: Child }): JSX.Element;
export function Chip(props: { readonly label: string; readonly selected?: boolean; readonly href?: string }): JSX.Element;
export type Column = { readonly key: string; readonly label: string; readonly numeric?: boolean };
export function Table(props: { readonly caption: string; readonly columns: readonly Column[]; readonly rows: readonly Readonly<Record<string, Child>>[] }): JSX.Element;
export function Kpi(props: { readonly label: string; readonly value: string; readonly detail?: string }): JSX.Element;
export function Note(props: { readonly children: Child }): JSX.Element;
export const evidenceLabels = ['observed', 'confirmed', 'inferred', 'assumed'] as const;
export type EvidenceLabelValue = (typeof evidenceLabels)[number];
export function EvidenceLabel(props: { readonly label: EvidenceLabelValue }): JSX.Element;
export type Money = { readonly amountMinor: number; readonly currency: string };
export function formatMoney(money: Money): string;
```

- [ ] **Step 1: Write the failing tests**

Per component (titles lead with WB-11): the badge has no red tone and each tone uses only token classes (`bg-inspire-soft text-ocean` for info, `bg-cultivate-soft text-ink` for success, `bg-surface text-muted border border-dashed border-line` for held, `bg-bg text-muted border border-line` for neutral); the table has a caption (`sr-only` allowed), `<th scope="col">`, numeric columns right-aligned with `font-mono`, and an `overflow-x-auto` wrapper so it scrolls at phone width; the chip is a link with an accessible name when `href` is set and `aria-pressed` reflects `selected` when it is a button; the KPI renders its label as `<dt>` and value as `<dd>`; the note has `role="note"`; the evidence label renders its word with a `title` that defines it in sentence case.

`packages/core/money.test.ts`: `WB-11 money is formatted once from integer minor units`: `{ amountMinor: 125000, currency: 'USD' }` → `$1,250.00`; `{ amountMinor: 5, currency: 'JPY' }` → `¥5`; a fraction or an unsafe integer throws `RangeError`; a currency outside `^[A-Z]{3}$` throws.

`tools/ui/one-formatter.test.ts`: `WB-11 Intl.NumberFormat appears only in packages/core/money.ts` (non-test sources under `apps/`, `packages/`, `sim/`), with a planted file that fails.

`tools/ui/evidence-labels.test.ts`: `WB-11 the evidence label component knows exactly the contract's evidence labels` (`evidenceLabels` equals `evidenceLabelSchema.options` from `@uw/contracts`; the test lives in `tools/` because `packages/ui` imports no workspace code).

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement** the components with token classes only, and `money.ts`:

```ts
const currencyPattern = /^[A-Z]{3}$/;

export type Money = { readonly amountMinor: number; readonly currency: string };

export function formatMoney(money: Money): string {
  if (!Number.isSafeInteger(money.amountMinor)) {
    throw new RangeError('money is an integer count of minor units');
  }
  if (!currencyPattern.test(money.currency)) throw new RangeError('a currency is an ISO 4217 code');
  const format = new Intl.NumberFormat('en-US', { style: 'currency', currency: money.currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(money.amountMinor / 10 ** digits);
}
```

Run `pnpm ui:css`.

- [ ] **Step 4: Run them and see them pass; commit**

```bash
git commit -m "feat(ui): card, badge, chip, table, KPI, note and evidence label, and money formatted once from minor units" -m "WB-11"
```

- [ ] **Step 5: Verify** — green.

---

### Task 20: Harness pieces: gate callout, human action, lane and kanban card; Kindle only on a human action

**Requirements:** WB-11.

**Files:**
- Create: `packages/ui/components/human-action.tsx`, `gate-callout.tsx`, `lane.tsx`, `kanban-card.tsx`, their `*.test.ts`, `tools/ui/kindle.test.ts`
- Modify: `packages/ui/generated/app-css.ts` (regenerated), `docs/architecture.md` (one paragraph: what `packages/ui` holds and the Kindle rule's check)

**Interfaces:**
- Produces:

```ts
export function HumanActionButton(props: {
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly disabledReason?: string | null;
}): JSX.Element;
export function HumanGateMark(props: { readonly label: string }): JSX.Element;
export function GateCallout(props: { readonly title: string; readonly reason: string | null; readonly actions: Child; readonly children?: Child }): JSX.Element;
export function Lane(props: { readonly title: string; readonly count: number; readonly wipLimit: number; readonly paused?: boolean; readonly children?: Child }): JSX.Element;
export function KanbanCard(props: { readonly title: string; readonly href: string; readonly meta: readonly { readonly label: string; readonly value: string }[] }): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

- `WB-11 a human action is a Kindle button with an accessible name and visible focus`: `<button type="submit" name value>` with the label as text, `bg-kindle text-on-accent`, `focus-visible:outline-2 outline-focus`.
- `WB-11 a refused human action is disabled with its closed reason shown beside it`: with `disabledReason: 'checks_not_green'` the button has `disabled` and `aria-describedby` pointing at an element that shows the reason in place (no red).
- `WB-11 the gate callout is a labelled region whose heading names the gate, with the reason in place when the rule refuses`.
- `WB-11 a lane shows its count against its WIP limit and says when it is paused` ("3 of 3", a "Paused" `Badge` with tone `held`), and is a `<section aria-labelledby>`.
- `WB-11 a kanban card is an article whose title links to the item and whose facts are a description list`.
- `tools/ui/kindle.test.ts`: `WB-11 Kindle marks a human action and nothing else`: the substring `kindle` (as a class token `-kindle` or `kindle-soft`) appears in non-test `.ts`/`.tsx` files under `apps/` and `packages/ui/components/` only in `packages/ui/components/human-action.tsx`; planted uses in another component and in an app route fail.

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement** with token classes only (Kindle only in `human-action.tsx`; `HumanGateMark` is a small `bg-kindle-soft text-ink border border-kindle` label used later by the Flow view to mark Ship). Run `pnpm ui:css`.

- [ ] **Step 4: Run them and see them pass; commit**

```bash
git commit -m "feat(ui): gate callout, human action, lane and kanban card, with Kindle on a human action and nowhere else" -m "WB-11"
```

- [ ] **Step 5: Verify** — green.

---

### Task 21: Record step 6 in the progress tracker

**Requirements:** WB-1, WB-2, WB-3, WB-11 (evidence); every decision S6-D1 to S6-D24.

**Files:**
- Modify: `docs/progress_tracker.md`, `docs/architecture.md` (only if a section above was left inconsistent)

- [ ] **Step 1: Prove the step is complete**

Run: `pnpm trace` and confirm none of WB-1, WB-2, WB-3, WB-11 is listed as unproven. Run `git log --oneline <plan commit>..HEAD` and collect the commits per requirement (a commit counts for every requirement its body's last line names).

- [ ] **Step 2: Update the tracker**

1. Status table: row 6 → `Built`, with evidence: this plan's path; scenarios `sim/scenarios/WB-1.*`, `WB-2.*`, `WB-3.*`, the new `KN-13.*` and `KN-18.*`; tests named WB-1 (`apps/uw-app/commands/*.pg.test.ts`, `packages/contracts/commands.test.ts`, `tools/architecture/command-routes.test.ts`), WB-2 (`sim/kernel/reorder.test.ts`, `apps/uw-app/commands/reorder.pg.test.ts`), WB-3 (`packages/harness/hub-wakes.test.ts`, `packages/contracts/live.test.ts`, `apps/uw-app/live/*.test.ts`, `apps/uw-app/ports/hub.contract.test.ts`, `apps/uw-app/islands/live/*.test.ts`, `apps/uw-app/commands/events.pg.test.ts`), WB-11 (`packages/ui/**/*.test.ts`, `tools/ui/*.test.ts`, `packages/core/money.test.ts`, `apps/uw-app/assets/routes.test.ts`); the `pnpm trace:built` line with its counts; `pnpm verify` green with `TEST_DATABASE_URL` set.
2. A "Step 6 evidence by requirement" section in the format of step 5's: one row per WB-1, WB-2, WB-3, WB-11, plus rows for KN-13, KN-18, GH-5, GH-6, AB-7 where step 6 added proofs.
3. "Decisions made during the build": one row per S6-D1 to S6-D24, dated 2026-10-03, with the "Cost if wrong" column from this plan, plus any implementer choice a reviewer accepted.
4. "New dependencies": `tailwindcss` and `@tailwindcss/cli` (resolved versions; MIT) — hand-written CSS per screen; `colorjs.io` (MIT) — a hand-written WCAG contrast function in the token tests; `partysocket` (MIT) — a hand-written reconnecting WebSocket with backoff; `@uw/ui` workspace link in `uw-app` — not a replacement; contract version `10.0.0` — not a dependency, both apps' `contractVersion` moved with it.
5. "Not verified": the `HarnessHub` Durable Object in workerd (hibernation, eviction, `ping` auto-response) — tests run its core on a fake state; WebSocket upgrade through Cloudflare Access with the app audience; the screens in a browser in light and dark at 390 px (unless Task 18 ran it); the Tailwind oxide binary on Cloudflare's build image is not needed (the CSS is committed) but CI's install was the only Linux run; the partysocket backoff timings in a real browser.
6. "Waiting on a person": `apps/uw-app/live/harness-hub.ts` and `apps/uw-app/ports/hub.ts` — a first deploy to staging, one browser session on `/api/harness/<id>/live` behind Access, a wake observed and `live_hub` on `/health`; the gate commands with a real GitHub App — the approve-at-Ship merge through the command API against the test repository (extends the GH-6 row); the `/api/*` command routes behind the real Access application (extends the FD-7 row).
7. "Carried to later steps": step 7 — `prompt_run` and `stop_run` answer `not_wired` until runs exist (HE-1); pause and resume do not yet stop claims, submits or runs (HE-1, with the existing row); step 8 — the views consume `apps/uw-app/islands/live/session.ts`, the gate view route (WB-6), the stage items route (WB-5) and `packages/ui` components, and bundle the live session for the browser; step 9 — web push reuses the hub's presence (P24).
8. Close the step-5 and step-3 carry rows step 6 resolved, in the existing "(closed)" style naming the commits: the connector edited to `none` (S6-D11), the S5-R40 gate view, `risk_derived.head`, the person gate route's GitHub client, `kernel.ts` on the allow-list, the import and recovery commands, and P17.

- [ ] **Step 3: Verify and commit**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` (with step 6 now marked Built, `trace:built` must stay green).

```bash
git add docs/progress_tracker.md docs/architecture.md
git commit -m "docs(tracker): step 6, the command API, the live hub and the design system, built: evidence, decisions, what was not verified and what waits on a person" -m "WB-1 WB-2 WB-3 WB-11"
```
