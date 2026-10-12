# Step 11: The End-to-End Scenario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One scenario, `sim/scenarios/DX-7.software-template-end-to-end.ts`, takes a kickstarted fixture item from Package to Close on the software template across every gate on both hosts, and the build closes against PRD section 14 items 1 to 6 with the evidence in `docs/progress_tracker.md`.

**Architecture:** The scenario is built from three journey modules under `sim/e2e/` (to Ship, through Ship, to Close), each a sequence of kernel calls over the test adapters that asserts with `node:assert/strict` as it goes, plus one coverage module that checks the travelled path against `kernel.walk` and the exit gates crossed. A growing Vitest file `sim/e2e/e2e.test.ts` drives each journey while it is being built; the scenario composes them once all three exist. A release-criteria guard in `tools/release/criteria.test.ts` makes PRD section 14 items 1 to 6 fail mechanically if a proof is removed or skipped, and the final task closes step 11 and the build in the tracker with a go-live hand-off listing every Not verified and Waiting on a person row.

**Tech Stack:** TypeScript strict, Node 22, Vitest (Node pool), PGlite through `@uw/db/embedded` in the sim, `node:assert/strict`. No new dependency.

**Spec:** `docs/PRD.md` (approved; no brainstorm, no approval step). Requirements covered: **DX-7**, and the release-criteria closeout of PRD section 14 items 1 to 6 (which re-prove DX-5, KN-10, AB-7 and DX-6 without changing them). Carries planned here: the tracker's "Carried to later steps" table names no row for step 11 or for "final" (checked on 2026-10-03 against `docs/progress_tracker.md` lines 653 to 704); Task 6 re-reads the table and closes any row added since that names step 11 or the final step, and lists every row still open in the go-live hand-off. Plans for steps 8, 9 and 10 were not in `docs/superpowers/plans/` when this plan was written; this plan assumes they are Built and touches none of their files.

## Global Constraints

Every task obeys every line here. Copy exact values; do not paraphrase them in code.

- **Where:** the worktree `/home/ianjl/projects/uw-platform-v1`, branch `build/v1`. Implementers commit; they do not push (the controller pushes and watches CI).
- **Read before the first edit:** `AGENTS.md` sections 1, 4, 6 and 10; `CONTEXT.md` for every word (Item, Stage, Exit gate, Connector, Lease, Delegation, Beat, Run, Run shape, Host, Persona, Principal, Agent identity, Kernel, Port, Adapter, Scenario); `docs/exceptions.md`; `docs/architecture.md` sections "The sim" and "Transactions and locks".
- **Verify, at the end of every task, green:** `pnpm format`, then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. The local server is private; CI uses a Postgres service container. If it is down: `/usr/lib/postgresql/16/bin/pg_ctl -D ~/.local/share/uw-platform-test-pg -o "-p 54329 -k '' -c listen_addresses=127.0.0.1" -l ~/.local/share/uw-platform-test-pg.log start`.
- **R37:** never run two test suites at once. No parallel `pnpm verify`, `pnpm test`, `vitest`, `pnpm sim -- all` or `pnpm sim:all`; wait for one to finish before starting another (concurrent suites kill the WSL VM). One focused file is run with `pnpm exec vitest run --project node <file>`.
- **DX-8:** no test, binding or job may need a live account or a secret. Everything in this step runs on the sim's test adapters and fixture GitHub facts. This step adds no binding, cron, queue, Durable Object or migration; were one ever needed it would go in `infra/uw-app/wrangler.go-live.toml` only, with a "Waiting on a person" row.
- **Layering (dependency-cruiser and ESLint enforce it):** `sim/*` imports `packages/harness` (`@uw/harness`), `packages/contracts` (`@uw/contracts`), `packages/db` (`@uw/db/*`) and the Node built-ins `node:fs`, `node:fs/promises`, `node:path`, `node:url`, `node:process`, `node:assert`, `node:assert/strict`; its tests also Vitest; nothing else (no `apps/*`, no Drizzle, no PGlite directly). `tools/*` may read files and import `@uw/harness` and `tools/trace/*`. Nothing imports a vendor SDK.
- **Code:** no comments of any kind (no line, block, JSDoc or directive comments, no commented-out code). Files under 500 lines; functions under 50 lines; ESLint fitness limits: 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters. TypeScript strict, no `any`, no `@ts-ignore`.
- **Commits:** Conventional Commits. The body's last line lists the requirement IDs the commit proves or serves (for example `DX-7`). No `Co-Authored-By` and no attribution footer of any kind. Hooks always pass; never `--no-verify`.
- **Shared roots** (`packages/db/schema.ts`, `packages/db/schema-*.ts`, `packages/contracts/`, `packages/harness/ports.ts`, `packages/core/acl.ts`, `infra/`, `.github/workflows/`, `AGENTS.md`, `CONTEXT.md`, `docs/adr/`): this plan changes none. If a task finds it must, that change goes in its own commit with no feature code, the message names the shared root and why, and the task's report says so.
- **Exceptions:** any exception to AGENTS.md rules 1 to 4 gets its `docs/exceptions.md` row in the same commit as the code, written before it. This plan expects none.
- **Contract lock:** contracts are at `11.0.0` (or whatever steps 8 to 10 left them at). This plan adds no event, reason, verb or command. If a defect fix needs one: an addition is a minor bump, a removal or tightening a major one, in its own commit.
- **Only humans decide gates.** Only a `human:<personId>` principal's `kernel.gates.decide` moves a parked item. The scenario proves agents are refused; nothing in this step gives an agent a way past a gate.
- **Agents never hold a GitHub client.** GitHub reaches the sim only as `world.adapters.githubFacts.given(...)` fixtures and `world.adapters.connectors.calls()`.
- **What an agent sees equals what it may act on** (R27, R32, R33); **hidden equals missing** (R28); **delegations are checked on every beat and step** (AB-6).
- **Lock order** (kernel code, should a defect fix touch it): stage lock, item rows (ascending id), run rows, grants, appends; no lock after the first append; no port call inside a Store transaction.
- **One writer per table.** The sim seeds people, grants and pages only through `@uw/db/test-seed` (`seedPage`, `seedPerson`, `seedGrant`, `revokeSeededGrant`) and writes everything else through kernel commands.
- **R36 trace honesty:** a `describe`/`it`/`test` title that leads with a requirement ID must prove that requirement's clauses; supporting tests lead with no ID. Only the scenario file `sim/scenarios/DX-7.software-template-end-to-end.ts` (id `DX-7`) proves DX-7. The `sim/e2e/` tests and the release guard lead with no ID.
- **When an observed value differs from one this plan pins:** read the kernel code named next to it. If the kernel is right and the plan's expectation is wrong (an event order, a detail key), pin what the kernel writes and say so in the commit body. If the kernel is wrong, write a failing test for the defect at the kernel's interface (in `sim/kernel/`), fix it in its owning module, and add a "Decisions made during the build" or "Not verified" row as the case needs. Never weaken an assertion to pass.
- **Fixed values used across tasks:** heads `simSha('d7a1')` (first push, undeclared), `simSha('d7b2')` (declared, the head that ships), `simSha('d7c3')` (a later push nobody saw); page ids `00000000-0000-4000-8000-0000000d7001` (Builder persona), `...0d7002` (Iterate persona), `...0d7003` (the product page kickstarted), `...0d7004` (the learning Iterate drafts); people `simIan` (org admin, decides the gate), `simPerson(world, 2, editor 80-89)` "Max", `simPerson(world, 4, admin 80-89)` "Kim" (owns the personas and grants their delegations); devices `agent:<Max>/laptop` and `agent:<Max>/desktop` (interactive); hosted personas `agent:builder` (capability `build`, engine `claude-messages`) and `agent:iterate` (capability `iterate`, engine `openrouter-messages`, model `z-ai/glm-5.3-flash`, provider `z-ai`); the Reviewer login `uw-reviewer[bot]` with provider `anthropic`; review ids `9100000301`, `9100000302`.

## Review Focus

The inputs the PRD implies but no single requirement names, most likely first. Each line's test lives in the task named.

1. **A held premise must leave the item claimable, not stuck:** after `runs.holdPremise` the wrong item sits in Scope with no holder and `working`, and another runner can claim and release it. Test in Task 1.
2. **A refused approve must not reach the merge connector:** after both ship refusals and both agent attempts, `connectors.calls()` is empty, no `gate_decisions` row exists and the item is still parked at Ship; the one approve produces exactly one call. Test in Task 2.
3. **A lapsed delegation must not let the Iterate beat act again:** after the revoke, the run's next scene is refused `delegation_lapsed` once, a second beat is refused with no second `delegation_lapsed`, and the item is released for a person. Test in Task 3.
4. **The fold must still equal the record after a long, mixed journey** (two hosts, a sweep, refusals, a revoke): `readWorldLog(store).drift` is empty at the end of the scenario. Test in Task 4.
5. **A release criterion silently weakened** (a planted fixture deleted, a race suite skipped, an AB-7 check marked `.skip`): the guard fails. Test in Task 5.

## Decisions this plan makes

Choices the PRD, the spec and AGENTS.md leave open. Task 6 copies each into `docs/progress_tracker.md` "Decisions made during the build" with the date `2026-10-03` (or the day it lands), requirement `DX-7` or the item named, and the cost if wrong.

| # | Decision | Cost if wrong |
|---|---|---|
| S11-D1 | The sim's kickstart is `kernel.items.enqueue` with a seeded `product` page in the harness's area, priority `null` — the call `apps/uw-app/commands/handlers/items.ts` `kickstartCommand` makes; the sim may not import `apps/` | A kickstart-only check added to the route later is not in DX-7 (it is in `apps/uw-app/commands/items.pg.test.ts`) |
| S11-D2 | The held premise is on a second, deliberately wrong item, through a hosted Builder run under Kim's `build` delegation (read and scout steps, then `kernel.runs.holdPremise`), as PRD section 14 item 8 does; the main item's premise holds | None for the build; it mirrors the acceptance run |
| S11-D3 | The main item is worked by an external runner (`agent:<Max>/laptop`, then `agent:<Max>/desktop`) on Scope to Check, so DX-7 crosses both hosts: hosted runs for the held premise and Iterate, external runs for the build | None |
| S11-D4 | The lease warning and expiry happen at Check, after the Build submit recorded the expected head, so the fresh claim starts from that head (GH-4); the warning is read from `record_run_step`'s reply 13 minutes into the lease | None |
| S11-D5 | The Reviewer's approval is a fixture GitHub review fact (`uw-reviewer[bot]`, provider `anthropic`, on the head); DX-7 does not run a hosted review, which HE-4, PE-6 and HE-9 prove | DX-7 does not show the review path end to end; the acceptance run (item 8) does |
| S11-D6 | The ship rule's refusals in DX-7 are `no_reviewer_approval` with `risk_tier_undeclared` (a pull request whose declaration was removed and with no review), then `head_mismatch` (a later push); the agent attempts are the laptop device and the hosted Builder's beat principal | The other refusal reasons are proven by KN-11 and KN-12, not again here |
| S11-D7 | Iterate works the software harness's Validate and Close under its own `iterate` delegation: one hosted run moves Validate to Close; a second, at Close, attaches its drafted learning and is stopped when Kim revokes the delegation; a person then closes the item. The BML Iterate stays PE-7's | None |
| S11-D8 | The delegation lapses by revocation (`revoked`), as the acceptance run does; KN-16 proves `grant_lost` | None |
| S11-D9 | No measurement is recorded at Validate in DX-7 (DX-7 does not list one; section 14 item 8 does, at go-live) | None for the build |
| S11-D10 | The release guard `tools/release/criteria.test.ts` pins items 1 to 6 by structure (scripts, files, test titles, no skip markers) and re-runs the two cheap pure checks (the trace over the repository, the template property); it does not re-run the suites it names | A proof that keeps its title but stops proving is caught by R36 review, not by the guard |
| S11-D11 | `pnpm verify` keeps `pnpm trace:built` (AGENTS.md section 2); with every step Built it equals `pnpm trace` (DX-5), and the guard additionally asserts `pnpm trace`'s exit code is 0 so an unproven Must fails verify from now on | None |
| S11-D12 | Item 6's evidence is the GitHub Actions `ci` workflow run on `build/v1` whose `test` job is green on the step's last code commit, cited by run id and URL | If the controller has not pushed, item 6 stays "pending the CI run" in the tracker until the controller records it |

---

### Task 1: The DX-7 cast and the road to Ship

**Proves:** serves DX-7 (kickstart, the claim, a held premise, the lease warning and expiry, the PR declaration, parking at Ship). No title leads with an ID.

**Files:**
- Modify: `sim/runs.ts` (export `personaPrincipal` with an identity parameter)
- Create: `sim/e2e/cast.ts`
- Create: `sim/e2e/to-ship.ts`
- Create: `sim/e2e/e2e.test.ts`

**Interfaces:**
- Consumes (exist): `createWorld`, `World` (`sim/world.ts`); `createSimHarness`, `simPerson`, `simAgent`, `simCaller`, `simSystem`, `simAdvance`, `simSeenHead` (`sim/fixtures.ts`); `builderFrontmatter`, `seedPersona`, `startOn`, `beatOf`, `stepOn`, `itemOf`, `runOf`, `value`, `reasonOf`, `type RunWorld` (`sim/runs.ts`); `greenFacts`, `itemLog`, `namesSince`, `shipPullRequest`, `simSha` (`sim/ship-fixtures.ts`); `seedPage` (`@uw/db/test-seed`); `software`, `LEASE_MS`, `type Caller` (`@uw/harness`); `type Principal`, `type Stage`, `type CapabilityWord` (`@uw/contracts`).
- Produces:
  - `sim/runs.ts`: `export function personaPrincipal(owner: Principal, identity: string = personaIdentity): Principal` (unchanged body but for the identity).
  - `sim/e2e/cast.ts`: `minute`, `heads`, `pageIds`, `type Hosted`, `type Cast`, `type Journey`, `createCast(world)`, `hostedOn(cast, hosted, itemId)`, `callerFor(cast, actor)`, `host(cast)`, `externalStep(cast, itemId)`, `changeTo(itemId, head)` — exact code below.
  - `sim/e2e/to-ship.ts`: `export async function travelToShip(world: World): Promise<Journey>` — returns the cast, the main item parked at Ship on head `heads.second`, and the wrong item held in Scope.

- [ ] **Step 1: Export `personaPrincipal` from `sim/runs.ts`**

Change the existing private function to:

```ts
export function personaPrincipal(owner: Principal, identity: string = personaIdentity): Principal {
  return principalSchema.parse({
    identity,
    kind: 'agent',
    personId: owner.personId,
    email: null,
    grants: [],
    interactive: false,
  });
}
```

Its one caller, `withPersona`, keeps calling `personaPrincipal(scene.owner)`.

- [ ] **Step 2: Write `sim/e2e/cast.ts`**

```ts
import type { CapabilityWord, Principal, Stage } from '@uw/contracts';
import { software, type Caller } from '@uw/harness';
import { createSimHarness, simAgent, simCaller, simPerson, simSystem } from '../fixtures.ts';
import {
  builderFrontmatter,
  personaPrincipal,
  seedPersona,
  value,
  type RunWorld,
} from '../runs.ts';
import { shipPullRequest, simSha } from '../ship-fixtures.ts';
import type { World } from '../world.ts';

export const minute = 60_000;

export const heads = {
  first: simSha('d7a1'),
  second: simSha('d7b2'),
  pushed: simSha('d7c3'),
} as const;

export const pageIds = {
  builder: '00000000-0000-4000-8000-0000000d7001',
  iterate: '00000000-0000-4000-8000-0000000d7002',
  product: '00000000-0000-4000-8000-0000000d7003',
  learning: '00000000-0000-4000-8000-0000000d7004',
} as const;

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;

export type Hosted = {
  readonly identity: 'agent:builder' | 'agent:iterate';
  readonly delegationId: string;
  readonly pageId: string;
};

export type Cast = {
  readonly world: World;
  readonly harnessId: string;
  readonly stages: readonly Stage[];
  readonly ian: Principal;
  readonly max: Principal;
  readonly kim: Principal;
  readonly laptop: Caller;
  readonly desktop: Caller;
  readonly builder: Hosted;
  readonly iterate: Hosted;
};

export type Journey = {
  readonly cast: Cast;
  readonly itemId: string;
  readonly wrongItemId: string;
};

type Hire = {
  readonly identity: Hosted['identity'];
  readonly capability: CapabilityWord;
  readonly pageId: string;
  readonly change: Readonly<Record<string, unknown>>;
};

type Hiring = { readonly world: World; readonly harnessId: string; readonly owner: Principal };

const iterateChange = {
  identity: 'agent:iterate',
  engine: 'openrouter-messages',
  model: 'z-ai/glm-5.3-flash',
  provider: 'z-ai',
  capability: 'iterate',
} as const;

async function hire(scene: Hiring, wanted: Hire): Promise<Hosted> {
  await seedPersona(scene, {
    id: wanted.pageId,
    frontmatter: builderFrontmatter(scene, wanted.change),
  });
  const granted = await scene.world.kernel.delegations.grant(simCaller(scene.world, scene.owner), {
    harnessId: scene.harnessId,
    persona: wanted.identity,
    capability: wanted.capability,
    expiresAt: null,
    supersedes: null,
  });
  return { identity: wanted.identity, delegationId: value(granted).id, pageId: wanted.pageId };
}

export async function createCast(world: World): Promise<Cast> {
  const { harness, stages, admin } = await createSimHarness(world, software);
  const max = await simPerson(world, 2, [{ role: 'editor', ...area }]);
  const kim = await simPerson(world, 4, [{ role: 'admin', ...area }]);
  const device = (name: string) =>
    simCaller(world, simAgent(max, `${max.personId}/${name}`, { interactive: true }));
  const hiring = { world, harnessId: harness.id, owner: kim };
  const builder = await hire(hiring, {
    identity: 'agent:builder',
    capability: 'build',
    pageId: pageIds.builder,
    change: {},
  });
  const iterate = await hire(hiring, {
    identity: 'agent:iterate',
    capability: 'iterate',
    pageId: pageIds.iterate,
    change: iterateChange,
  });
  const laptop = device('laptop');
  const desktop = device('desktop');
  return { world, harnessId: harness.id, stages, ian: admin, max, kim, laptop, desktop, builder, iterate };
}

export function hostedOn(cast: Cast, hosted: Hosted, itemId: string): RunWorld {
  return {
    world: cast.world,
    harnessId: cast.harnessId,
    itemId,
    admin: cast.ian,
    owner: cast.kim,
    delegationId: hosted.delegationId,
    pageId: hosted.pageId,
    persona: personaPrincipal(cast.kim, hosted.identity),
  };
}

export function callerFor(cast: Cast, actor: Principal): Caller {
  return simCaller(cast.world, actor);
}

export function host(cast: Cast): Caller {
  return simCaller(cast.world, simSystem());
}

export function externalStep(cast: Cast, itemId: string) {
  return {
    itemId,
    runId: cast.world.adapters.ids.next(),
    step: 'work' as const,
    tokensIn: 1200,
    tokensOut: 300,
    costBasis: 'subscription' as const,
  };
}

export function changeTo(itemId: string, head: string) {
  return { itemId, to: null, evidence: {}, change: { pullRequest: shipPullRequest, head } };
}
```

If the persona frontmatter schema at the time refuses `builderFrontmatter`'s output (step 10 may have added keys), fix `builderFrontmatter` in `sim/runs.ts`, not this file: every run test depends on it. If `prettier` reflows the long `return` in `createCast`, keep its output.

- [ ] **Step 3: Write the failing test `sim/e2e/e2e.test.ts`**

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { heads } from './cast.ts';
import { travelToShip } from './to-ship.ts';
import { itemOf } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inWorld<T>(work: (world: World) => Promise<T>): Promise<T> {
  const world = await createWorld();
  try {
    return await work(world);
  } finally {
    await world.close();
  }
}

describe('the end-to-end journey on the software template', () => {
  it('kickstarts an item, holds a wrong premise, survives a lapsed lease and parks at Ship on the declared head', () =>
    inWorld(async (world) => {
      const journey = await travelToShip(world);
      const item = await itemOf(world, journey.itemId);
      expect(item).toMatchObject({
        stageKey: 'ship',
        gateStatus: 'parked',
        expectedHead: heads.second,
        riskTier: 'standard',
        branchState: 'active',
      });
      const wrong = await itemOf(world, journey.wrongItemId);
      expect(wrong).toMatchObject({ stageKey: 'scope', holder: null, gateStatus: 'working' });
    }));
});
```

Run: `pnpm exec vitest run --project node sim/e2e/e2e.test.ts` — Expected: FAIL (`./to-ship.ts` does not exist).

- [ ] **Step 4: Write `sim/e2e/to-ship.ts`**

Five phases, each under 50 lines, each asserting with `node:assert/strict` as it goes, composed by `travelToShip`. Exact behaviour and values:

```ts
import assert from 'node:assert/strict';
import { seedPage } from '@uw/db/test-seed';
import { LEASE_MS } from '@uw/harness';
import { simAdvance } from '../fixtures.ts';
import { beatOf, itemOf, runOf, startOn, stepOn, value } from '../runs.ts';
import { greenFacts, itemLog, namesSince } from '../ship-fixtures.ts';
import type { World } from '../world.ts';
import {
  callerFor,
  changeTo,
  createCast,
  externalStep,
  heads,
  host,
  hostedOn,
  minute,
  pageIds,
  type Cast,
  type Journey,
} from './cast.ts';

async function kickstart(cast: Cast): Promise<string> {
  const { world, max } = cast;
  await seedPage(world.database.db, {
    id: pageIds.product,
    type: 'product',
    status: 'active',
    jdArea: '80-89',
    slug: 'board-view',
    title: 'Show the board',
    bodyMd: 'People see their harness as a board of stages.',
    frontmatter: { owner: max.identity, summary: 'The board view of a harness' },
  });
  const created = value(
    await world.kernel.items.enqueue(callerFor(cast, max), {
      harnessId: cast.harnessId,
      title: 'Show the board',
      pageId: pageIds.product,
      priority: null,
      due: null,
      delegationId: null,
    }),
  );
  assert.equal(created.stageKey, 'package');
  assert.equal(created.pageId, pageIds.product);
  return created.itemId;
}
```

`holdTheWrongPremise(cast): Promise<string>`:
1. Max enqueues `'Fix the typo on the board'` (pageId `null`, priority `null`) and passes it through Package with `simAdvance(world, { harnessId, itemId, worker: cast.max, through: ['package'] })`.
2. `const scene = hostedOn(cast, cast.builder, itemId)`; `const { runId } = value(await startOn(scene))`; `const beat = await beatOf(scene)`; `value(await stepOn(scene, beat, { runId, step: 'read' }))`; `value(await stepOn(scene, beat, { runId, step: 'scout' }))`.
3. Take `before = await itemLog(world, harnessId, itemId)`; call `value(await world.kernel.runs.holdPremise(host(cast), runId, { reason: 'the typo was fixed by an earlier pull request' }))`; take `after`.
4. Assert `namesSince(before, after)` deep-equals `['premise_held', 'item_released', 'run_completed']` (`packages/harness/runs/lifecycle.ts` `holdPremise`); the `premise_held` evidence deep-equals `{ runId, reason: 'the typo was fixed by an earlier pull request' }`; `(await runOf(world, runId))?.outcome === 'completed'`; the item (`itemOf`) is `stageKey: 'scope'`, `holder: null`, `gateStatus: 'working'`.
5. Review Focus 1: `value(await world.kernel.items.claim(cast.laptop, { itemId, delegationId: null }))`, then `value(await world.kernel.items.release(cast.laptop, { itemId, delegationId: null }))`. Return `itemId`.

`workToCheck(cast, itemId): Promise<void>`:
1. `simAdvance(..., worker: cast.max, through: ['package'])`, then `simAdvance(..., worker: cast.laptop.actor, through: ['scope', 'plan'])`.
2. `const claimed = value(await world.kernel.items.claim(cast.laptop, { itemId, delegationId: null }))`; assert `claimed.item.stageKey === 'build'`, `claimed.leaseWarning === false`, `claimed.leaseExpiresAt === new Date(world.adapters.clock.now().getTime() + LEASE_MS).toISOString()`.
3. `const step = value(await world.kernel.items.recordRunStep(cast.laptop, externalStep(cast, itemId)))`; assert `step.leaseWarning === false`.
4. The pushed pull request lacks its declaration: `world.adapters.githubFacts.given(greenFacts(world, { itemId, head: heads.first, reviews: [], declaration: null }))`; `const submitted = value(await world.kernel.items.submit(cast.laptop, changeTo(itemId, heads.first)))`.
5. Assert `submitted.result === 'advanced'`, `submitted.item.stageKey === 'check'`, `submitted.item.expectedHead === heads.first`, `submitted.item.riskTier === null`, `submitted.item.branchState === 'active'`; the last `risk_derived` event on the item has `evidence.refusal === 'risk_tier_undeclared'` and `evidence.declaration === null`.

`lapseAtCheck(cast, itemId): Promise<void>`:
1. `const claimed = value(await world.kernel.items.claim(cast.laptop, { itemId, delegationId: null }))`; assert `claimed.leaseWarning === false`.
2. `world.adapters.clock.advance(13 * minute)`; `const warned = value(await world.kernel.items.recordRunStep(cast.laptop, externalStep(cast, itemId)))`; assert `warned.leaseWarning === true` (`packages/harness/items/run-steps.ts`: the warning is the time left before renewal, at most `LEASE_WARNING_MS`, 3 minutes).
3. `world.adapters.clock.advance(16 * minute)`; `before = await itemLog(...)`; `const swept = value(await world.kernel.items.expireLeases(host(cast), { limit: 10 }))`; assert `swept.expired` deep-equals `[itemId]`; `namesSince(before, after)` deep-equals `['lease_expired', 'branch_abandoned', 'run_stopped']` (the external run stops `lease_expired`, S7-D8); the `branch_abandoned` evidence deep-equals `{ head: heads.first }`; the `run_stopped` evidence has `why: 'lease_expired'`. Read `packages/harness/items/leases.ts` and `packages/harness/items/run-steps.ts` `expireLeases` if the order differs (Global Constraints).
4. The fresh claim: `const fresh = value(await world.kernel.items.claim(cast.desktop, { itemId, delegationId: null, adoptBranch: false }))`; assert `fresh.branch` deep-equals `{ name: \`harness/${itemId}\`, startFrom: heads.first, adopted: false }` and `fresh.item.branchState === 'abandoned'`.

`parkAtShip(cast, itemId): Promise<void>`:
1. The declared pull request on the second head: `world.adapters.githubFacts.given(greenFacts(world, { itemId, head: heads.second, reviews: [] }))` (the default declaration is `standard` with no domains, `sim/ship-fixtures.ts`).
2. `const checked = value(await world.kernel.items.submit(cast.desktop, changeTo(itemId, heads.second)))`; assert `result === 'advanced'`, `item.stageKey === 'ship'`, `item.expectedHead === heads.second`, `item.riskTier === 'standard'`, `item.riskDomains` deep-equals `[]`, `item.branchState === 'active'`.
3. Max (Ship's pickup is `none`; a person works it): `value(await world.kernel.items.claim(callerFor(cast, cast.max), { itemId, delegationId: null }))`; `const parked = value(await world.kernel.items.submit(callerFor(cast, cast.max), { itemId, to: null, evidence: {}, change: null }))`; assert `parked.result === 'parked'`, `parked.item.stageKey === 'ship'`, `parked.item.gateStatus === 'parked'`.

```ts
export async function travelToShip(world: World): Promise<Journey> {
  const cast = await createCast(world);
  const itemId = await kickstart(cast);
  const wrongItemId = await holdTheWrongPremise(cast);
  await workToCheck(cast, itemId);
  await lapseAtCheck(cast, itemId);
  await parkAtShip(cast, itemId);
  return { cast, itemId, wrongItemId };
}
```

`itemOf` returns `ItemState | null`; assert non-null with `assert.ok(item)` before reading fields.

- [ ] **Step 5: Run the test**

Run: `pnpm exec vitest run --project node sim/e2e/e2e.test.ts` — Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run `pnpm format`, then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` — green (knip passes: every new export is used by the test or a later import in this task).

```bash
git add sim/runs.ts sim/e2e/cast.ts sim/e2e/to-ship.ts sim/e2e/e2e.test.ts
git commit -m "test(sim): the end-to-end cast and the road to Ship

A kickstarted item on the software template goes Package to Ship through
an external runner, past a lapsed lease at Check and a fresh claim from
the expected head, with a wrong item's premise held by a hosted Builder.

DX-7"
```

---

### Task 2: The Ship gate: the rule's refusals, the agents refused, the approve and the merge

**Proves:** serves DX-7 (the ship rule's refusals, an agent's refused gate attempt, the approve, the merge connector). No title leads with an ID.

**Files:**
- Create: `sim/e2e/at-ship.ts`
- Modify: `sim/e2e/e2e.test.ts`

**Interfaces:**
- Consumes: `travelToShip`, `type Journey`, `callerFor`, `heads`, `hostedOn` (Task 1); `approvedBy`, `greenFacts`, `itemLog`, `namesSince`, `shipPullRequest` (`sim/ship-fixtures.ts`); `simSeenHead` (`sim/fixtures.ts`); `beatOf`, `itemOf`, `value` (`sim/runs.ts`); `readWorldLog` (`sim/runner/log.ts`).
- Produces: `export async function travelThroughShip(journey: Journey): Promise<void>` — on return the main item is at Validate, `working`, one `gate_decisions` row (`approve`) exists, and `connectors.calls()` holds exactly one `merge` call on `heads.second`.

- [ ] **Step 1: Add the failing test to `sim/e2e/e2e.test.ts`**

```ts
  it('refuses the approve on the facts and for every agent, then a person approves and the merge connector runs once', () =>
    inWorld(async (world) => {
      const journey = await travelToShip(world);
      await travelThroughShip(journey);
      const item = await itemOf(world, journey.itemId);
      expect(item).toMatchObject({ stageKey: 'validate', gateStatus: 'working', holder: null });
      expect(world.adapters.connectors.calls()).toHaveLength(1);
    }));
```

with `import { travelThroughShip } from './at-ship.ts';`. Run the file — Expected: FAIL (module missing).

- [ ] **Step 2: Write `sim/e2e/at-ship.ts`**

```ts
async function approve(journey: Journey) {
  const { cast, itemId } = journey;
  return cast.world.kernel.gates.decide(callerFor(cast, cast.ian), {
    itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: await simSeenHead(cast.world, itemId),
  });
}
```

`refusedOnTheFacts(journey): Promise<void>` — two refusals, each through one helper `refusedOver(journey, facts, reasons)` that: sets `world.adapters.githubFacts.given(facts)`; takes `before`; calls `approve`; asserts the outcome is `error` with `reason === reasons[0]` and `detail.reasons` deep-equal to `reasons`; asserts `namesSince(before, after)` deep-equals `['risk_derived', 'ship_refused']` and the `ship_refused` evidence deep-equals `{ stage: 'ship', reasons }`; asserts `after.decisions` deep-equals `[]`, `connectors.calls()` deep-equals `[]`, and `readWorldLog(world.adapters.store)` has `drift` deep-equal to `[]` (pattern: `sim/scenarios/KN-11.ship-rule-refuses-on-facts.ts`).
1. The declaration was removed and no Reviewer has approved: `greenFacts(world, { itemId, head: heads.second, reviews: [], declaration: null })`, reasons `['no_reviewer_approval', 'risk_tier_undeclared']` (the closed-set order in `packages/harness/ship-rule.ts`).
2. Someone pushed after the person looked: `greenFacts(world, { itemId, head: heads.pushed, reviews: [approvedBy('uw-reviewer[bot]', 'anthropic', heads.pushed, 9100000301)] })`, reasons `['head_mismatch']`.

`refusedForAgents(journey): Promise<void>`:
1. `const beat = await beatOf(hostedOn(cast, cast.builder, itemId))`; the attempts are `[cast.laptop, beat]`.
2. Take `before`; for each attempt call `world.kernel.gates.decide(attempt, { itemId, decision: 'approve', reason: null, findings: [], seenHead: heads.second })` and assert `error` with `reason === 'gate_refused_to_agent'`.
3. Assert `namesSince(before, after)` deep-equals `['gate_refused_to_agent', 'gate_refused_to_agent']`, their actors deep-equal `[cast.laptop.actor.identity, beat.actor.identity]`, each evidence deep-equals `{ decision: 'approve', stage: 'ship' }`; `after.decisions` deep-equals `[]`; `connectors.calls()` deep-equals `[]`; the item is `stageKey: 'ship'`, `gateStatus: 'parked'` (Review Focus 2).

`approvedAndMerged(journey): Promise<void>`:
1. `world.adapters.githubFacts.given(greenFacts(world, { itemId, head: heads.second, reviews: [approvedBy('uw-reviewer[bot]', 'anthropic', heads.second, 9100000302)] }))`.
2. `const decided = value(await approve(journey))`; assert `decided.advanced === true`, `decided.item.stageKey === 'validate'`, `decided.item.gateStatus === 'working'`.
3. Assert `namesSince(before, after)` deep-equals `['risk_derived', 'gate_approved', 'connector_succeeded', 'stage_advanced']`; the `gate_approved` actor is `cast.ian.identity`; the `connector_succeeded` evidence deep-equals `{ connector: 'merge', detail: {} }`; the `stage_advanced` evidence deep-equals `{ from: 'ship', to: 'validate' }`; `after.decisions` deep-equals `['approve']`.
4. `const calls = world.adapters.connectors.calls()`; assert length 1 and `calls[0]` matches `{ connector: 'merge', harnessId, itemId, pullRequest: shipPullRequest, expectedHead: heads.second, repository: 'unfoldingWord/uw-platform', title: 'Show the board', overrideReason: null }`: pick those keys from `calls[0]` into a new object and `assert.deepEqual` it to that value.

```ts
export async function travelThroughShip(journey: Journey): Promise<void> {
  await refusedOnTheFacts(journey);
  await refusedForAgents(journey);
  await approvedAndMerged(journey);
}
```

- [ ] **Step 3: Run, verify, commit**

Run the file — PASS. `pnpm format`; `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` — green.

```bash
git add sim/e2e/at-ship.ts sim/e2e/e2e.test.ts
git commit -m "test(sim): the end-to-end journey through the Ship gate

The approve is refused on the facts (no review and no declaration, then a
later head) and for the laptop runner and the hosted Builder's beat; then
a person approves, the merge connector runs once and the item moves to
Validate.

DX-7"
```

---

### Task 3: Validate and Close: Iterate under a delegation that lapses, a refused Close and a Close with a learning

**Proves:** serves DX-7 (a refused Close, a Close with a learning, an Iterate beat under a delegation that then lapses, and the beat refused without one). No title leads with an ID.

**Files:**
- Create: `sim/e2e/to-close.ts`
- Modify: `sim/e2e/e2e.test.ts`

**Interfaces:**
- Consumes: `type Journey`, `callerFor`, `host`, `hostedOn`, `pageIds` (Task 1); `travelThroughShip` (Task 2); `startOn`, `beatOf`, `stepOn`, `runOf`, `itemOf`, `value`, `reasonOf`, `detailOf`, `personaPrincipal` (`sim/runs.ts`); `simAgent`, `simCaller` (`sim/fixtures.ts`); `itemLog`, `namesSince` (`sim/ship-fixtures.ts`); `harnessLog` (`sim/persona-fixtures.ts`); `seedPage` (`@uw/db/test-seed`).
- Produces: `export async function travelToClose(journey: Journey): Promise<{ readonly lapses: number }>` — on return the main item is at Close with `gateStatus: 'done'`, carrying the learning `pageIds.learning`, and the Iterate delegation has exactly one `delegation_lapsed` (`why: 'revoked'`).

- [ ] **Step 1: Add the failing test**

```ts
  it('lets Iterate move Validate to Close, refuses Close without a learning, stops Iterate when its delegation is revoked, and closes with the learning it drafted', () =>
    inWorld(async (world) => {
      const journey = await travelToShip(world);
      await travelThroughShip(journey);
      const closed = await travelToClose(journey);
      expect(closed.lapses).toBe(1);
      expect(await itemOf(world, journey.itemId)).toMatchObject({ stageKey: 'close', gateStatus: 'done' });
    }));
```

with `import { travelToClose } from './to-close.ts';`. Run — FAIL (module missing).

- [ ] **Step 2: Write `sim/e2e/to-close.ts`**

`iterateValidates(journey): Promise<void>`:
1. `const scene = hostedOn(cast, cast.iterate, itemId)`; `const { runId } = value(await startOn(scene))`; `const beat = await beatOf(scene)`; `value(await stepOn(scene, beat, { runId, step: 'read' }))`.
2. `const moved = value(await world.kernel.items.submit(beat, { itemId, to: null, evidence: {}, change: null }))`; assert `moved.result === 'advanced'`, `moved.item.stageKey === 'close'`, `moved.item.holder === null`.
3. The host ends the run: `const run = value(await world.kernel.runs.complete(host(cast), runId, { result: 'submitted', review: null }))`; assert `run.outcome === 'completed'`.

`closeRefused(journey): Promise<void>`:
1. `value(await world.kernel.items.claim(callerFor(cast, cast.max), { itemId, delegationId: null }))`.
2. `const refused = value(await world.kernel.items.submit(callerFor(cast, cast.max), { itemId, to: null, evidence: {}, change: null }))`; assert `refused.result === 'checks_failed'`, `refused.failures` deep-equals `['learning_attached: the item carries no suggested learning or skill page and no nothing_learned marker']` (`packages/harness/validators/learning-attached.ts`), `refused.item.stageKey === 'close'`; the last item event is `checks_failed` with evidence `{ stage: 'close', failures: refused.failures }`.
3. Max lets it go for Iterate: `value(await world.kernel.items.release(callerFor(cast, cast.max), { itemId, delegationId: null }))`.

`iterateRefusedWithoutDelegation(journey): Promise<void>`:
1. `const bare = simCaller(world, simAgent(cast.kim, 'iterate', { interactive: false }))`; `const outcome = await world.kernel.items.claim(bare, { itemId, delegationId: null })`; assert `reasonOf(outcome) === 'delegation_required'` and the item's last event name is `delegation_required` (pattern: `sim/scenarios/AB-6.a-delegated-runner-names-itself-and-stops-on-lapse.ts`).

`iterateLapses(journey): Promise<number>`:
1. `const scene = hostedOn(cast, cast.iterate, itemId)`; start run 2, beat, record step `read` as in `iterateValidates`.
2. Iterate drafts its learning, every claim labelled (KN-7): `seedPage(world.database.db, { id: pageIds.learning, type: 'learning', status: 'suggested', jdArea: '80-89', slug: 'learning-board-first', title: 'People open the board first', bodyMd: '- [observed] people open the board before the gates\n- [inferred] the board is the first screen a person needs' })`; `value(await world.kernel.items.attachLearning(beat, { itemId, pageId: pageIds.learning, delegationId: cast.iterate.delegationId }))`.
3. Kim revokes: `value(await world.kernel.delegations.revoke(callerFor(cast, cast.kim), { delegationId: cast.iterate.delegationId }))`.
4. Take `before`; `const stopped = await world.kernel.runs.scene(host(cast), runId)`; assert `reasonOf(stopped) === 'delegation_lapsed'` and `detailOf(stopped)` has `why: 'revoked'`; `namesSince(before, after)` deep-equals `['run_stopped', 'item_released']` (`packages/harness/runs/scene.ts` `stopForLapse`), the `run_stopped` evidence deep-equals `{ runId, why: 'delegation_lapsed' }`; `(await runOf(world, runId))?.outcome === 'stopped'`; the item's `holder` is `null`.
5. Review Focus 3: a further beat `await world.kernel.delegations.beat(simCaller(world, personaPrincipal(cast.kim, 'agent:iterate')), { delegationId: cast.iterate.delegationId })` is refused `delegation_lapsed`.
6. `const lapses = (await harnessLog(world, cast.harnessId)).filter((event) => event.name === 'delegation_lapsed')`; assert length 1 and `lapses[0]?.evidence` deep-equals `{ delegationId: cast.iterate.delegationId, why: 'revoked' }`. Return `lapses.length`.

`closedWithLearning(journey): Promise<void>`:
1. Max claims Close and submits with `change: null`; assert `result === 'advanced'`, `item.gateStatus === 'done'`, `item.stageKey === 'close'`; the last item event is `stage_advanced` with evidence `{ from: 'close', to: null }`.

```ts
export async function travelToClose(journey: Journey): Promise<{ readonly lapses: number }> {
  await iterateValidates(journey);
  await closeRefused(journey);
  await iterateRefusedWithoutDelegation(journey);
  const lapses = await iterateLapses(journey);
  await closedWithLearning(journey);
  return { lapses };
}
```

If `runs.start` refuses the Iterate run (for example `malformed_command` `{ why: 'provider_required' }` or `not_permitted` `{ why: 'run_shape' }`), the persona page is wrong, not the kernel: check `iterateChange` in `sim/e2e/cast.ts` against `packages/harness/runs/start.ts` and `packages/harness/engines.ts`.

- [ ] **Step 3: Run, verify, commit**

Run the file — PASS. `pnpm format`; `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` — green.

```bash
git add sim/e2e/to-close.ts sim/e2e/e2e.test.ts
git commit -m "test(sim): the end-to-end journey through Validate and Close

Iterate moves the item to Close under its delegation; Close is refused
without a learning; Iterate is refused without a delegation, attaches its
labelled learning under one, and is stopped when Kim revokes it; a person
then closes the item with the learning.

DX-7"
```

---

### Task 4: The DX-7 scenario: every gate crossed on a walked path, and replay equals record

**Proves:** **DX-7**. The scenario is the only file that names the ID.

**Files:**
- Create: `sim/e2e/coverage.ts`
- Create: `sim/scenarios/DX-7.software-template-end-to-end.ts`
- Modify: `docs/architecture.md` (section "The sim": one paragraph on `sim/e2e/`)

**Interfaces:**
- Consumes: `travelToShip` (Task 1), `travelThroughShip` (Task 2), `travelToClose` (Task 3); `itemLog` (`sim/ship-fixtures.ts`); `itemOf` (`sim/runs.ts`); `readWorldLog` (`sim/runner/log.ts`); `defineScenario` (`sim/scenario.ts`); `type ExitGate`, `type HarnessEvent`, `type Stage` (`@uw/contracts`).
- Produces: `export async function everyGateCrossed(journey: Journey): Promise<readonly ExitGate[]>` in `sim/e2e/coverage.ts`; the scenario `DX-7`.

- [ ] **Step 1: Write the scenario first (it fails: `../e2e/coverage.ts` is missing)**

```ts
import assert from 'node:assert/strict';
import { travelThroughShip } from '../e2e/at-ship.ts';
import { everyGateCrossed } from '../e2e/coverage.ts';
import { travelToClose } from '../e2e/to-close.ts';
import { travelToShip } from '../e2e/to-ship.ts';
import { itemOf } from '../runs.ts';
import { readWorldLog } from '../runner/log.ts';
import { defineScenario } from '../scenario.ts';
import { itemLog } from '../ship-fixtures.ts';

export const scenario = defineScenario({
  id: 'DX-7',
  title:
    'one kickstarted item travels the software template from Package to Close on both hosts: a claim, a held premise, the lease warning and expiry, the PR declaration, the ship rule refusing, agents refused at the gate, a person approving, the merge connector, a refused Close, a Close with a learning, and an Iterate beat under a delegation that lapses',
  run: async (world) => {
    const journey = await travelToShip(world);
    await travelThroughShip(journey);
    const { lapses } = await travelToClose(journey);
    const gates = await everyGateCrossed(journey);
    assert.deepEqual((await readWorldLog(world.adapters.store)).drift, []);
    const item = await itemOf(world, journey.itemId);
    assert.ok(item);
    const { decisions } = await itemLog(world, journey.cast.harnessId, journey.itemId);
    return {
      state: {
        item: { stage: item.stageKey, gateStatus: item.gateStatus, head: item.expectedHead, tier: item.riskTier },
        heldPremise: (await itemOf(world, journey.wrongItemId))?.stageKey ?? null,
        decisions,
        merges: world.adapters.connectors.calls().length,
        lapses,
        gates,
      },
    };
  },
});
```

Run: `pnpm sim -- DX-7` — Expected: FAIL (cannot resolve `../e2e/coverage.ts`).

- [ ] **Step 2: Write `sim/e2e/coverage.ts`**

Behaviour, each check an `assert` that names what failed:

1. `travelled(events)`: from the item's `stage_advanced` events in order, the list of `evidence.from` values. Assert it deep-equals `['package', 'scope', 'plan', 'build', 'check', 'ship', 'validate', 'close']` and that the last `stage_advanced` has `to === null`.
2. `onAWalkedPath(stages, visited)`: `cast.world.kernel.walk(cast.stages)` returns paths; assert some path's first `visited.length` keys equal `visited` (the item took a route the walker enumerates; KN-9).
3. Exit gates crossed: map each visited key to its stage's `exitGate` from `cast.stages`; the distinct values, sorted, must deep-equal `['checks', 'human_approval', 'none']`. Return them.
4. The effect after a person: in the item's events, the index of `connector_succeeded` is greater than the index of the one `gate_approved`, whose `actor` starts with `human:`; there is no `connector_*` event before it; `itemLog(...).decisions` deep-equals `['approve']`.
5. The DX-7 milestones in order: `inOrder(names, milestones)` asserts `milestones` is a subsequence of the item's event names, where
   ```ts
   const milestones = [
     'item_created',
     'item_claimed',
     'risk_derived',
     'lease_expired',
     'branch_abandoned',
     'submitted_to_gate',
     'ship_refused',
     'ship_refused',
     'gate_refused_to_agent',
     'gate_refused_to_agent',
     'gate_approved',
     'connector_succeeded',
     'run_started',
     'checks_failed',
     'delegation_required',
     'learning_attached',
     'run_stopped',
     'stage_advanced',
   ] as const;
   ```
   and the wrong item's names include `premise_held` exactly once.

`export async function everyGateCrossed(journey: Journey): Promise<readonly ExitGate[]>` reads the item's events once (`itemLog`) and the wrong item's once, runs 1 to 5, and returns the gates from 3. Keep each helper under 50 lines.

- [ ] **Step 3: Run the scenario and the sim**

Run: `pnpm sim -- DX-7` — Expected: PASS, printing the event log and the state with `gates: ['checks', 'human_approval', 'none']`, `decisions: ['approve']`, `merges: 1`, `lapses: 1`, `heldPremise: 'scope'`. Then `pnpm trace` lists DX-7 as proven.

- [ ] **Step 4: Update `docs/architecture.md` "The sim"**

After the paragraph that names `DX-7.software-template-end-to-end.ts`, add one paragraph: the DX-7 scenario is composed from the journey modules in `sim/e2e/` (`cast.ts`, `to-ship.ts`, `at-ship.ts`, `to-close.ts`, `coverage.ts`); each journey asserts as it goes; `sim/e2e/e2e.test.ts` drives them separately so a failure names its stretch of the road; the scenario adds the checks only the whole journey can make (every exit gate crossed on a walked path, the merge only after a person's approval, replay equals record).

- [ ] **Step 5: Verify and commit**

`pnpm format`; `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` — green.

```bash
git add sim/e2e/coverage.ts sim/scenarios/DX-7.software-template-end-to-end.ts docs/architecture.md
git commit -m "test(sim): DX-7, one item from kickstart to Close with every gate exercised

The scenario composes the three journeys and checks what only the whole
road shows: the item crosses none, checks and human_approval exits along a
path the walker enumerates, the merge follows a person's approval, the
DX-7 milestones happen in order, and replay equals record.

DX-7"
```

---

### Task 5: The release-criteria guard and the full release run

**Proves:** the release closeout, PRD section 14 items 1 to 6. Titles lead with no ID (R36): the guard re-pins proofs that their own IDs already carry.

**Files:**
- Create: `tools/release/criteria.test.ts`

**Interfaces:**
- Consumes: `repositoryTrace` (`tools/trace/repository.ts`), `traceExitCode` (`tools/trace/trace.ts`); `templates`, `bypassesShip`, `templateProperty` (`@uw/harness`).
- Produces: `tools/release/criteria.test.ts` with one `describe` per section 14 item (items 1 to 6); Task 6 adds the hand-off case to it.

- [ ] **Step 1: Write the guard**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { bypassesShip, templateProperty, templates } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { repositoryTrace } from '../trace/repository.ts';
import { traceExitCode } from '../trace/trace.ts';

const titlePattern = /\b(?:describe|it|test)(?:\.(?:each|skipIf|runIf)\([^)]*\))?\(\s*(['"`])((?:(?!\1).)*)\1/gs;
const weakeners = /\b(?:describe|it|test)\.(?:skip|todo|fails|only)\b/;

function source(path: string): string {
  expect(existsSync(path), `${path} is missing`).toBe(true);
  return readFileSync(path, 'utf8');
}

function titles(path: string): string[] {
  return [...source(path).matchAll(titlePattern)].map((match) => match[2] ?? '');
}

function expectTitle(path: string, prefix: string): void {
  expect(titles(path).some((title) => title.startsWith(prefix)), `${path}: "${prefix}"`).toBe(true);
}

function expectNotWeakened(path: string): void {
  expect(weakeners.test(source(path)), `${path} skips or narrows a case`).toBe(false);
}
```

Cases (exact paths and title prefixes; each `it` names what the item needs in words):

- **Item 1** (`describe('release criterion 1: pnpm verify runs walk, trace and the whole sim', ...)`): parse `package.json`; split `scripts.verify` on `' && '`; expect it to contain, in this order, `'pnpm walk:all'`, `'pnpm trace:built'`, `'pnpm test'`, `'pnpm sim:all'`; expect `scripts['walk:all']` to be `'node sim/cli/walk.ts all'` and `scripts['sim:all']` to be `'node sim/cli/sim.ts all'`.
- **Item 2** (`'release criterion 2: every Must requirement has a scenario or a test named for it'`): `const report = repositoryTrace()`; `expect(report.unproven.map((entry) => entry.id)).toEqual([])`; `expect(traceExitCode(report, 'all')).toBe(0)`.
- **Item 3** (`'release criterion 3: the DX-7 scenario exists and proves the whole journey'`): `sim/scenarios/DX-7.software-template-end-to-end.ts` exists and its source contains `id: 'DX-7'`; `sim/e2e/coverage.ts` exists.
- **Item 4** (`'release criterion 4: both templates pass the property and the negative fixture fails it'`): `[...templates.keys()].sort()` deep-equals `['bml', 'software']`; each `templateProperty(template.stages)` is `[]`; `templateProperty(bypassesShip.stages)` has length greater than 0; `expectTitle('packages/harness/template-property.test.ts', 'KN-10 every registered template')` and `'KN-10 the negative fixture'`; `expectNotWeakened` on that file.
- **Item 5** (`'release criterion 5: the three agent-boundary checks pass and fail on their planted fixtures'`):
  - static: `expectTitle('tools/architecture/agent-boundary.test.ts', 'AB-7 no file an agent principal can reach')` and `'AB-7 the static check fails on a planted handler'`;
  - runtime: `sim/scenarios/AB-7.no-agent-identity-writes-a-gate-decision.ts` exists; `expectTitle('sim/kernel/agent-boundary-runtime.test.ts', 'AB-7 the runtime check fails on a planted gate command')`;
  - conformance: `expectTitle('apps/uw-app/mcp/conformance.pg.test.ts', 'AB-7 the Workflow host and an external runner see the same verbs')` and `expectTitle('apps/uw-app/testing/conformance.test.ts', 'AB-7 the conformance check fails on a planted host-specific tool')`;
  - `expectNotWeakened` on all four test files.
- **Item 6** (`'release criterion 6: the race and concurrency tests run on the CI Postgres service container'`):
  - `expectTitle('apps/uw-app/harness/grant-race.pg.test.ts', 'KN-14 DX-6 the grant re-read race')`, `expectTitle('apps/uw-app/harness/claims.pg.test.ts', 'DX-6 claims race on separate connections')`, `expectTitle('packages/db/store/claim-race.test.ts', 'KN-5 write.claim is one conditional update')`, `expectTitle('tools/ci/test-database.test.ts', 'FD-6 database tests never skip in CI')`; `expectNotWeakened` on all four;
  - each of the three race files gates its suite with `describe.skipIf(!testServer)` (the source contains `describe.skipIf(!testServer)`);
  - `vitest.config.ts` contains `'apps/**/*.pg.test.ts'` in the node project's `include`.

If `prettier` or ESLint splits the title regex or a call, keep their output; the regex must still match multi-line `describe(\n  'title'` calls (the `s` flag and `\s*`).

- [ ] **Step 2: Run the guard**

Run: `pnpm exec vitest run --project node tools/release/criteria.test.ts` — Expected: PASS. If item 2 fails, the listed IDs are Must requirements of steps 1 to 10 with no proof: report them to the controller with the list (status BLOCKED); they belong to their step's plan, not this one. Any other failure means a named file or title moved: find where (grep the title) and fix the guard's path, or, if the proof is gone, report it the same way.

- [ ] **Step 3: Run the release commands one at a time (R37) and keep their output for Task 6**

1. `pnpm walk -- software` and `pnpm walk -- bml` — each path reaching `merge` or `publish` crosses `ship` with `human_approval`.
2. `pnpm trace` — exit 0; note the summary line (`trace: N Must requirements; N proven, 0 unproven ...`).
3. `pnpm sim -- DX-7` — PASS; note the state printed.
4. `pnpm sim -- all` — every scenario passes; note the count.
5. `pnpm exec vitest run --project node packages/harness/template-property.test.ts tools/architecture/agent-boundary.test.ts sim/kernel/agent-boundary-runtime.test.ts` — PASS (the planted cases inside them are the "fail when planted" half of items 4 and 5).
6. `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm exec vitest run --project node apps/uw-app/harness/grant-race.pg.test.ts apps/uw-app/harness/claims.pg.test.ts packages/db/store/claim-race.test.ts apps/uw-app/mcp/conformance.pg.test.ts` — PASS, none skipped (the reporter shows no skipped suites).
7. `pnpm exec vitest run --project workers apps/uw-app/testing/conformance.test.ts` — PASS.

Write the outputs' key lines into the task report (the controller passes them to Task 6).

- [ ] **Step 4: Verify and commit**

`pnpm format`; `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` — green.

```bash
git add tools/release/criteria.test.ts
git commit -m "test(release): pin PRD section 14 items 1 to 6 in one guard

The guard fails when verify stops running walk, trace or the whole sim,
when any Must requirement loses its proof, when the DX-7 scenario, a
template-property case, an AB-7 planted case or a DX-6 race suite is
removed or skipped.

DX-7 DX-5 KN-10 AB-7 DX-6"
```

---

### Task 6: Close step 11 and the build in the progress tracker

**Proves:** the release closeout record (AGENTS.md section 8: the build is over when section 14 items 1 to 6 hold and the tracker says so with the evidence). Serves DX-7.

**Before this task is dispatched:** the controller pushes `build/v1` and waits for the `ci` workflow on that head (`run_in_background`, not an inline poll). The implementer reads the result with `gh run list --workflow ci.yml --branch build/v1 --limit 5 --json databaseId,headSha,conclusion,url` and `gh run view <id> --json jobs --jq '.jobs[] | {name, conclusion}'`. If no run exists for the head, item 6 is recorded "pending the CI run" (S11-D12) and the controller fills it in after the push.

**Files:**
- Modify: `docs/progress_tracker.md`
- Modify: `tools/release/criteria.test.ts` (the hand-off case)

- [ ] **Step 1: Write the failing hand-off case in `tools/release/criteria.test.ts`**

```ts
type HandOffKey = string;

function sectionRows(tracker: string, heading: string): string[] {
  const lines = tracker.split('\n');
  const start = lines.indexOf(heading);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => /^\| \d{4}-\d{2}-\d{2} \|/.test(line));
}

function cells(row: string): string[] {
  return row.split('|').slice(1, -1).map((cell) => cell.trim());
}

function sourceKeys(tracker: string, heading: string, source: string): HandOffKey[] {
  return sectionRows(tracker, heading).map((row) => {
    const [date, requirement] = cells(row);
    return `${source} | ${date ?? ''} | ${requirement ?? ''}`;
  });
}

function handOffKeys(tracker: string): HandOffKey[] {
  const lines = tracker.split('\n');
  const start = lines.indexOf('## Go-live hand-off');
  const rest = start === -1 ? [] : lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end))
    .filter((line) => /^\| (?:Not verified|Waiting on a person) \|/.test(line))
    .map((line) => cells(line).slice(0, 3).join(' | '));
}

describe('the go-live hand-off names every row a person must still close', () => {
  it('lists each Not verified and each Waiting on a person row once, by its section, date and requirement', () => {
    const tracker = readFileSync('docs/progress_tracker.md', 'utf8');
    const expected = [
      ...sourceKeys(tracker, '## Not verified', 'Not verified'),
      ...sourceKeys(tracker, '## Waiting on a person', 'Waiting on a person'),
    ].sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(handOffKeys(tracker).sort()).toEqual(expected);
  });
});
```

Run the file — Expected: FAIL (no `## Go-live hand-off` section).

- [ ] **Step 2: Update `docs/progress_tracker.md`**

Every edit below is exact in shape; fill the values from the commits of Tasks 1 to 5 (`git log --oneline` on `build/v1`) and from Task 5's report.

1. **Status row 11:** `| 11. The end-to-end scenario | DX-7 | Built | <evidence> |` — evidence: this plan's path; the scenario `sim/scenarios/DX-7.software-template-end-to-end.ts`; the journey modules and `sim/e2e/e2e.test.ts`; the guard `tools/release/criteria.test.ts`; `pnpm trace`'s summary line from Task 5 with "0 unproven"; `pnpm verify` green with `TEST_DATABASE_URL` set. Also confirm rows 7 to 10 read `Built` (if one does not, stop and report BLOCKED: the build is not over).
2. **`## Step 11 evidence by requirement`** (after the last step's evidence section, same table shape `| Requirement | Commits | Scenarios and tests |`): one row `DX-7` with the commits of Tasks 1 to 5 and the files `sim/scenarios/DX-7.software-template-end-to-end.ts`, `sim/e2e/e2e.test.ts`, `tools/release/criteria.test.ts`.
3. **`## Release criteria`** (new section after the status table): one row per PRD section 14 item 1 to 6, columns `| Item | Holds | Evidence |`:
   - 1: `pnpm verify` green on `<commit>` with `TEST_DATABASE_URL` set (it runs `walk:all`, `trace:built`, `sim:all`), and the CI run `<id>` green on `<head>`;
   - 2: `pnpm trace` exits 0, `<summary line>`; guard item 2;
   - 3: `pnpm sim -- DX-7` passes; the printed state; guard item 3;
   - 4: `packages/harness/template-property.test.ts` (KN-10) and `tools/properties/template.test.ts`; `pnpm walk -- software` and `pnpm walk -- bml`; the negative fixture `packages/harness/templates/fixtures/bypasses-ship.ts` fails; guard item 4;
   - 5: the three checks and their planted halves, by file (static `tools/architecture/agent-boundary.test.ts`; runtime `sim/scenarios/AB-7.no-agent-identity-writes-a-gate-decision.ts` and `sim/kernel/agent-boundary-runtime.test.ts`; conformance `apps/uw-app/mcp/conformance.pg.test.ts` and `apps/uw-app/testing/conformance.test.ts`); guard item 5;
   - 6: the CI run `<id>` (`<url>`): the `test` job green on `<head>` with `TEST_DATABASE_URL` pointing at the `postgres:16` service container, running `grant-race.pg.test.ts`, `claims.pg.test.ts`, `claim-race.test.ts`; guard item 6. If no CI run exists yet: `Holds` reads `pending the CI run` (S11-D12).
4. **"Decisions made during the build":** one row per S11-D1 to S11-D12 from this plan, columns `| Date | Requirement | Decision | Why | Cost if wrong |`.
5. **"New dependencies":** none; add no row.
6. **"Not verified":** add `| <date> | DX-7 | The journey on real services: DX-7 runs on the sim's test adapters and fixture GitHub facts only | PRD section 14 item 8, the acceptance run on staging, is a person's (DX-8) |`. If a guard item was recorded pending (item 6), add its row too.
7. **"Waiting on a person":** add `| <date> | DX-7 | The DX-7 journey as code (`sim/scenarios/DX-7.software-template-end-to-end.ts`) and every platform adapter listed above | PRD section 14 items 7 to 10: the go-live wiring switched on (FD-12), the acceptance scenario of issue #64 on staging, the exported event log with screenshots, and the first real item (issue #65) | Ian, with an org owner for the GitHub Apps |`.
8. **"Carried to later steps":** re-read the table. Close every row whose `To step` names 11, "final" or "Final review" and is not closed, by prefixing its `What` with `Closed by step 11 Task <n> (<commit>):`. List every row still open (any `To step` not marked closed) in the hand-off's "Open carries" table below; change none of them.
9. **`## Go-live hand-off`** (new section, after "Release criteria"): one paragraph saying the build is finished when section 14 items 1 to 6 hold (they do, above) and that what follows is for people at go-live, then:
   - a table `| Source | Date | Requirement | What to do | Who acts |` with **one row for every row** of "Not verified" (`Source` = `Not verified`, `What to do` = that row's "What was not verified" shortened to one sentence naming the live check that closes it, `Who acts` = Ian unless the row names someone else) and **one row for every row** of "Waiting on a person" (`Source` = `Waiting on a person`, `What to do` = its "What is needed to verify it live" shortened to one sentence, `Who acts` = its "From whom"). Date and requirement are copied exactly from the source row so the guard can match them. Order the rows by `Who acts`, then date;
   - a table `| From | To step | What |` titled "Open carries" for the rows found in 8.

- [ ] **Step 3: Run the guard, verify, commit**

Run: `pnpm exec vitest run --project node tools/release/criteria.test.ts` — PASS (the hand-off matches every source row). Then `pnpm format`; `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` — green; `pnpm trace:built` and `pnpm trace` both exit 0.

```bash
git add docs/progress_tracker.md tools/release/criteria.test.ts
git commit -m "docs(tracker): step 11 built; release criteria 1 to 6 hold; the go-live hand-off

Marks the end-to-end scenario Built, records the evidence for PRD section
14 items 1 to 6, the step's decisions S11-D1 to S11-D12, and one hand-off
table naming every Not verified and Waiting on a person row by who acts;
a guard fails if the hand-off misses one.

DX-7"
```

After this commit the build is over by AGENTS.md section 8: the controller pushes, marks the draft pull request ready, and reports what is built, every ruling, everything not verified and everything waiting on a person, leaving the merge to a person.
