# Step 20, The Joining Journey and the Switch: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove design section 4 end to end in the sim (DX-10), make the go-live switch one reviewed change a person makes and prove by test that everything it switches is inert until then (GL-1's build half), then confirm the v0.2.0 release list (design section 9, items 1 to 6) with its evidence in the tracker.

**Architecture:** No behaviour changes. DX-10 is one scenario composed from the sim helpers steps 14 to 17 built (`joinedWorld`, `simLendMerge`, `exitDelegated`, the sim connectors), plus a new helper module for its six beats. GL-1 adds no binding, job or secret: it turns "copy the go-live files and edit five tests" into "copy the go-live files and flip one flag", writes the runbook a person follows, restates every tracker row that waits on FD-6, FD-7, FD-10 or FD-12 with the runbook step that closes it, and pins all of that with tests titled `GL-1`. The live run (the staging probe answering through Hyperdrive) stays a person's, as `AGENTS.md` section 8 requires.

**Tech Stack:** TypeScript strict, Vitest 4 (node and workers projects), the sim (`sim/`), `yaml` and `smol-toml` for the workflow and wrangler files, Markdown.

**Spec:** `docs/PRD.md` section 7.11 (DX-10 in 7.11.10, GL-1 in 7.11.1), section 13 step 20, section 14 and section 15; the design is `docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` sections 4, 5.1, 5.10 and 9.

**Requirements covered:** DX-10 (Must), GL-1 (Must; its live run is a person's). Also the v0.2.0 release list (design section 9 items 1 to 6) and the carries addressed to step 20: S14 (GL-3, the person's move from Check to Ship), S16 (MD-4 MD-5, the release guard's titles), S16 (MD-3, the GitHub App for the cron, restated), S16 (MD-3, S16-R10, the joined merge in the sim).

**Rulings made while planning** (recorded here and in `docs/progress_tracker.md` by the last task):

| Ruling | Cost if wrong |
|---|---|
| S20-R1 (CF-3, the S14 carry). Only a person moves a joined item from Check to Ship. A posted approval does not advance it. DX-10 drives every move with the admin's own `submit_to_gate` at Check, and asserts the item is still at Check after the Reviewer's posted approval | One more person action per joined pull request; advancing on a posted approval is a later toggle on the harness, additive |
| S20-R2. DX-10's check-only harness names its own required checks, `github-actions` `test` and `build` (S15-R1), which the planted CI satisfies: `greenFacts` plants all six `ciJobSchema` jobs as `success` on the head. Items 2 and 3 carry the Reviewer's approval as a GitHub fact planted on their head, as MD-3's scenario does, because the sim does not feed a posted review back into the facts | The sim never shows a posted review being read back; GH-5's tests prove that read path on its own |
| S20-R3. The switch is one flag: `infra/go-live.json` holds `{ "switchedOn": false }`, read by `goLiveSwitchedOn()` in `tools/infra/switch.ts`. The five live-file assertions in `tools/infra/go-live.test.ts` and `tools/infra/crons.test.ts` compare the live file with its go-live twin when the flag is on and with nothing when it is off. The switch pull request copies the two go-live files and flips the flag; no test is edited | One more file in the `infra/` shared root. Flipping the flag without copying, or copying without flipping, fails the build, which is the intent |
| S20-R4. The GL-1 runbook is a subsection, "The GL-1 switch, in order", appended to the existing FD-12 section of `infra/README.md`, not a new `docs/go-live.md`, so `AGENTS.md` section 0's document table is unchanged. It has eight numbered steps; the GL-1 test pins their numbers | The README grows by one subsection; moving it later is a cut and paste plus one path in the test |
| S20-R5. GL-1 is proven for the trace by tests titled `GL-1`: every job that reads a Neon secret is found by scanning the workflows (not from a list), sits behind its gate and runs when the secret is set; the runbook names every secret and every `set-at-go-live` value; the tracker rows cite the runbook; the probe reports the database through the `HYPERDRIVE` binding. The release gate itself, the staging probe answering through Hyperdrive, is recorded as a person's under "Waiting on a person" and in the hand-off | The trace counts GL-1 proven while the live switch has not run; the GL-1 waiting row and the PRD status line say so in words |
| S20-R6. FD-6 has no "Waiting on a person" row; its live check is the "Not verified" row dated 2026-10-01 for FD-6 FD-10. GL-1's restatement therefore covers every row in "Waiting on a person", "Not verified" and the go-live hand-off whose requirement cell names FD-6, FD-7, FD-10 or FD-12 (28 rows at planning time): each gains "Still missing on <date>; see the GL-1 switch, step N, in `infra/README.md`." | None beyond the PRD's wording; the GL-1 test names any row left out |
| S20-R7. Step 20 changes no contract, schema, migration, port, `CONTEXT.md` word or ADR. `CONTRACT_VERSION` stays whatever steps 18 and 19 leave it at (13.4.0 at planning time plus their minors) | None |
| S20-R8. DX-10 follows PRD 7.11.10's sentence exactly, and adds design section 4 step 4 as one read of the shadow comparison (OB-3) while in shadow. Section 4 step 6 (GL-5, the template change) is not in the journey: GL-5 is a Should with its own scenario from step 19, and a template change mid-journey would put items 2 and 3 on the software template, where the joined-merge case is not what is being proven | The journey does not show the template change; GL-5's own scenario does |
| S20-R9. Release item 6 (design section 9): if GitHub Actions still refuses to start jobs, the build writes an extension of the 2026-10-12 waiver by name in `docs/exceptions.md`, naming Ian (DRI) as the one who confirms or refuses it at his review; the tracker says item 6 holds only on that confirmation. The pull request is marked ready for review (AGENTS.md section 8). Nothing is tagged or merged | If Ian refuses the extension, the pull request waits on billing; nothing else changes |

**What this step hands on (keep these names exactly):**

| Interface | Where | Consumed by |
|---|---|---|
| `goLiveSwitchedOn()`, `parseSwitch(text)` | `tools/infra/switch.ts` | the switch pull request (a person's), `tools/infra/go-live.test.ts`, `tools/infra/crons.test.ts`, `tools/infra/switch.test.ts` |
| `infra/go-live.json` `{ "switchedOn": false }` | `infra/` | the switch pull request |
| "The GL-1 switch, in order", steps 1 to 8 | `infra/README.md` | Ian at go-live; every FD-6, FD-7, FD-10 and FD-12 tracker row cites a step |
| `shadowRound`, `liftAndPost`, `waitsForAPerson`, `mergedUnderDelegation`, `refusedForProtectedPath`, `joinedChecks`, `protectedDirectory`, `mergedChange`, `protectedChange` | `sim/joining-journey.ts` | DX-10; v0.3.0's journeys |
| `joinedWorld` options `requiredChecks`, `protectedPaths`; `joinedFacts` inputs `ref`, `paths`; `joinRequest` override `title` | `sim/joining.ts` | DX-10 |
| Release guard cases for DX-10, MD-4, MD-5, UC-4 | `tools/release/criteria.test.ts` | every later version's release |

---

## Global Constraints

Every task obeys every line here. The controller passes this section to each implementer.

**Where and how**

- Work only in the worktree `/home/ianjl/projects/uw-platform-v0.2.0` on branch `build/v0.2.0`. Never commit to `main`, never force-push, never `--no-verify`. Other implementers commit in the same worktree: `git add` only the files your task names.
- Read `AGENTS.md` sections 1, 4, 8 and 10 before the first edit. When this plan and `AGENTS.md` disagree, `AGENTS.md` wins; record the conflict in `docs/progress_tracker.md` and build the version that keeps the rule.
- **Builds on steps 12 to 19 (built before this plan runs).** Names used exactly as their plans hand them over: `joinedWorld`, `joinRequest`, `joinedFacts`, `startReview`, `approveVerdict`, `joinedPull`, `joinedHead`, `joinedRepository` (`sim/joining.ts`, step 14); `greenFacts`, `approvedBy`, `itemLog`, `simSha`, `simLendMerge`, `MergeLoan` (`sim/ship-fixtures.ts`, steps 15 and 16); `kernel.gates.recordShadowVerdicts`, `kernel.stages.liftShadow`, `kernel.views.shadow` (step 14); `kernel.gates.exitDelegated`, `kernel.views.delegatedMerges`, `ConnectorRequest.joined`, `delegationProperty` (step 16). Steps 18 and 19 may have added options to `createSimHarness` and helpers to `sim/`; where a file below differs from the text quoted here because they changed it, keep their lines and make only this plan's change.
- Words come from `CONTEXT.md`: **check-only harness**, **shadow mode**, **merge delegation**, **platform**. "The switch" is the PRD's word for GL-1, not a new term. Never "dry run" for shadow, never "auto-merge".
- Commits: Conventional Commits, the agent as sole author, no attribution footer. Hooks always pass.

**Code rules (all mechanically enforced by `pnpm verify`)**

- TypeScript `strict`, no `any`, no `@ts-ignore`, no `as unknown as`.
- No code comments of any kind. Meaning goes into names, types, tests and `docs/`.
- Files under 500 lines; functions under 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters.
- `sim/*` imports only `packages/harness`, `packages/contracts`, `packages/db` and the allowed Node built-ins (`node:assert/strict` included).
- No contract change in this step (S20-R7). If a task finds it needs one, stop and record it in the tracker; do not add it.

**Shared roots**

- `infra/` and `docs/PRD.md` are touched. Each change goes in its own commit, with no other file in it, and the message names the root and why: Task 3 Step 1 (`infra/go-live.json`), Task 5 Step 3 (`infra/README.md`), Task 9 Step 3 (`docs/PRD.md`). No other shared root is touched. `docs/progress_tracker.md`, `docs/exceptions.md`, `tools/` and `sim/` are not shared roots.

**Tests**

- A test that proves a requirement has a `describe` or `it` title that starts with the requirement ID and a space, as `tools/trace/proofs.ts` reads it. A scenario proves its requirement by its file name `sim/scenarios/<ID>.<slug>.ts`.
- Run one node-project file with `npx vitest run <path>`, one workers-project file with `npx vitest run --project workers <path>`, one scenario with `pnpm sim -- <ID>`. Never run two Vitest processes at once (the WSL VM runs out of memory).
- `pnpm verify` needs `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres`; start the server first with `pg_ctl -D ~/.local/share/uw-platform-test-pg -o "-p 54329" start` if `pg_isready -h 127.0.0.1 -p 54329` says it is not accepting connections.

## Review Focus

Inputs the spec implies that no task's tests would otherwise exercise, most likely to bite first. Each line names the task that pins it.

1. A posted approval on a check-only harness must not move the item: if anything advanced it, "Ship waiting on a person" would be a lie. Task 2's `liftAndPost` asserts the item is still `check working` after the posted review.
2. The delegated merge of a joined pull request must reach the merge connector with `joined: true`, its own pull request, its own head and the harness's repository, or S16-R10's case is still proven only against the fixture GitHub. Task 2's `mergedUnderDelegation` asserts all four.
3. The third item's refusal must be `protected_path_needs_person` alone: an approval missing or a tier above the delegation would also refuse and hide the case. Task 2 plants the approval and a standard declaration and asserts the failures equal exactly that one reason.
4. A Neon job added later without a gate would pass a test that reads a hand-written list. Task 5's GL-1 test finds the jobs by scanning every workflow for `secrets.NEON_` and `vars.NEON_`, and a planted job proves the scan fails.
5. The switch pull request must not need a test edit, and must fail if half done. Task 3's refactor makes all five live-file assertions read the flag; Task 9 does not flip it.
6. Restating the tracker rows must not break the hand-off guard (one hand-off row per source row, by date and requirement). Task 6 changes only the action or reason cells and runs `tools/release/criteria.test.ts`.

---

### Task 1: Joining helpers take the journey's options

**Files:**
- Modify: `sim/joining.ts`

**Interfaces:**
- Consumes: `createSimHarness` options `requiredChecks`, `protectedPaths` (`sim/fixtures.ts`, steps 15 and 16); `greenFacts` input `ref`, `paths` (`sim/ship-fixtures.ts`); `RequiredCheck` (`@uw/contracts`).
- Produces: `JoinedOptions.requiredChecks?`, `JoinedOptions.protectedPaths?`; `joinedFacts` input `ref?`, `paths?`; `joinRequest` override `title?`. Existing callers (the GL-4 and OB-3 scenarios, `sim/kernel/shadow.test.ts`, `join.test.ts`) are unchanged.

- [ ] **Step 1: Read the file and its callers**

Run: `grep -rn "joinedWorld\|joinedFacts\|joinRequest" sim --include=*.ts | grep -v "^sim/joining.ts"`
Expected: callers in `sim/scenarios/GL-4.*`, `OB-3.*`, `sim/kernel/shadow.test.ts`, `join.test.ts` and any that steps 18 and 19 added. None passes the new options; all keep working.

- [ ] **Step 2: Widen `joinedFacts`**

In `sim/joining.ts` replace the `FactsInput` type and `joinedFacts` with:

```ts
type FactsInput = {
  readonly head?: string;
  readonly reviews?: readonly ReviewFact[];
  readonly ref?: PullRequestRef;
  readonly paths?: readonly string[];
};

export function joinedFacts(world: World, input: FactsInput = {}): PullRequestFacts {
  const head = input.head ?? joinedHead;
  const facts = greenFacts(world, {
    itemId: 'joined',
    head,
    reviews: input.reviews ?? [],
    ref: input.ref ?? joinedPull,
    ...(input.paths === undefined ? {} : { paths: input.paths }),
  });
  return { ...facts, headRef: 'feature/login-form' };
}
```

- [ ] **Step 3: Let a join name its title**

Replace `JoinOverrides` and the `title` line of `joinRequest`:

```ts
type JoinOverrides = {
  readonly pullRequest?: PullRequestRef;
  readonly head?: string;
  readonly title?: string;
  readonly requestedReviewers?: readonly string[];
};
```

```ts
    title: overrides.title ?? 'Fix the login form',
```

- [ ] **Step 4: Let `joinedWorld` set required checks and protected paths**

Change the contracts import to `import { principalSchema, type Principal, type RequiredCheck } from '@uw/contracts';`. Replace `JoinedOptions` and add a helper above `joinedWorld`:

```ts
type JoinedOptions = {
  readonly shadow: boolean;
  readonly externalReviewerIdentities?: readonly string[];
  readonly requiredChecks?: readonly RequiredCheck[];
  readonly protectedPaths?: readonly string[];
};

function harnessOptionsOf(options: JoinedOptions) {
  return {
    key: 'tc-admin-app',
    repository: joinedRepository,
    shadow: options.shadow,
    externalReviewerIdentities: options.externalReviewerIdentities ?? [],
    ...(options.requiredChecks === undefined ? {} : { requiredChecks: options.requiredChecks }),
    ...(options.protectedPaths === undefined ? {} : { protectedPaths: options.protectedPaths }),
  };
}
```

In `joinedWorld`, replace the `createSimHarness(world, checkOnly, { ... })` call's object with `harnessOptionsOf(options)`:

```ts
  const { harness, admin } = await createSimHarness(world, checkOnly, harnessOptionsOf(options));
```

If step 19 added another option to `JoinedOptions` (for example `botAuthors`), move its line into `harnessOptionsOf` the same way.

- [ ] **Step 5: Run the callers**

Run: `npx vitest run sim/kernel/shadow.test.ts sim/kernel/join.test.ts`, then `pnpm sim -- GL-4` and `pnpm sim -- OB-3`.
Expected: all green, unchanged.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm check && npx eslint sim/joining.ts --max-warnings 0`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add sim/joining.ts
git commit -m "test(sim): a joined harness takes its own required checks and protected paths

DX-10 needs a check-only harness that names its required checks
(S15-R1) and a protected directory (MD-4), and joined pull requests
with their own paths and titles. Every existing caller is unchanged.
S20-R2."
```

---

### Task 2: DX-10, the joining journey

**Files:**
- Create: `sim/joining-journey.ts`
- Create: `sim/scenarios/DX-10.the-joining-journey-from-shadow-to-a-delegated-merge.ts`

**Interfaces:**
- Consumes: Task 1's options; `simAdvance`, `simCaller`, `simSystem` (`sim/fixtures.ts`); `approvedBy`, `itemLog`, `simSha`, `simLendMerge`, `MergeLoan` (`sim/ship-fixtures.ts`); `value` (`sim/runs.ts`); `readAllEvents`, `PullRequestRef` (`@uw/harness`); kernel commands `gates.recordShadowVerdicts`, `runs.postReview`, `views.shadow`, `stages.liftShadow`, `views.gates`, `items.claim`, `items.submit`, `gates.exitDelegated`, `views.delegatedMerges`; the sim adapters `connectors.reviews()`, `connectors.calls()`, `githubFacts.given()`, `store.transaction`.
- Produces: the names in the hand-off table; scenario `DX-10`.

The journey, item by item (design section 4, PRD 7.11.10):

| Beat | Item | What the scenario asserts |
|---|---|---|
| 1 | `#12` | Joined at Check by the review request on a check-only harness in shadow (inside `joinedWorld`) |
| 2 | `#12` | The ship rule's verdict and the Reviewer's verdict are recorded (`shadow_verdict` twice, `review_verdict_recorded` once); no review posted, no connector run; the shadow comparison lists the head |
| 3 | `#12` | Shadow lifted (`shadow_lifted`); a second review run posts its review on the head; the item is still at Check (S20-R1) |
| 4 | `#12` | The admin moves it to Ship and submits there: parked, listed on the admin's Gates view, no decision, no connector run: Ship waits on a person |
| 5 | `#13` | Joined, approved on its head, moved to Ship by the admin; an agent with a `merge` delegation claims and submits; one decision names the grantor as approver and the agent as actor; the minute job's exit runs the merge connector once with `joined: true` on `#13`'s own ref; `delegated_merge` recorded; the delegated merges view lists it under the grantor |
| 6 | `#14` | Same, touching `src/auth/session.ts` under the protected `src/auth/`: refused `protected_path_needs_person` alone, `ship_refused` recorded, no decision, parked, still one connector call in total |

- [ ] **Step 1: Write the scenario (red)**

Create `sim/scenarios/DX-10.the-joining-journey-from-shadow-to-a-delegated-merge.ts`:

```ts
import assert from 'node:assert/strict';
import {
  joinedChecks,
  liftAndPost,
  mergedUnderDelegation,
  protectedDirectory,
  refusedForProtectedPath,
  shadowRound,
  waitsForAPerson,
} from '../joining-journey.ts';
import { joinedWorld } from '../joining.ts';
import { defineScenario } from '../scenario.ts';
import { simLendMerge } from '../ship-fixtures.ts';

export const scenario = defineScenario({
  id: 'DX-10',
  title:
    'the joining journey: a check-only harness in shadow records the verdicts and posts nothing, the lift posts the review, Ship waits on a person, and a merge delegation merges a second joined pull request and is refused on a third that touches a protected path',
  run: async (world) => {
    const scene = await joinedWorld(world, {
      shadow: true,
      requiredChecks: joinedChecks,
      protectedPaths: [protectedDirectory],
    });
    const shadow = await shadowRound(scene);
    assert.deepEqual(shadow, { shadowVerdicts: 2, recorded: 1, compared: 1 });
    const posted = await liftAndPost(scene);
    const waiting = await waitsForAPerson(scene);
    const loan = await simLendMerge(world, scene.admin, {
      harnessId: scene.harnessId,
      maxTier: 'standard',
    });
    const merged = await mergedUnderDelegation(scene, loan);
    const refused = await refusedForProtectedPath(scene, loan);
    return {
      state: {
        shadow,
        posted,
        waiting,
        merged: merged.joined,
        grantorApproved: merged.grantor === scene.admin.identity,
        refused: [...refused],
      },
    };
  },
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm sim -- DX-10`
Expected: FAIL, the module `../joining-journey.ts` cannot be found.

- [ ] **Step 3: Write the journey's beats**

Create `sim/joining-journey.ts`:

```ts
import assert from 'node:assert/strict';
import type { RequiredCheck } from '@uw/contracts';
import { readAllEvents, type PullRequestRef } from '@uw/harness';
import { simAdvance, simCaller, simSystem } from './fixtures.ts';
import {
  approveVerdict,
  joinedFacts,
  joinedHead,
  joinedPull,
  joinedRepository,
  joinRequest,
  startReview,
  type JoinedWorld,
} from './joining.ts';
import { value } from './runs.ts';
import { approvedBy, itemLog, simSha, type MergeLoan } from './ship-fixtures.ts';

export type JoinedChange = {
  readonly pullRequest: PullRequestRef;
  readonly head: string;
  readonly title: string;
  readonly paths: readonly string[];
};

export type ShadowRound = {
  readonly shadowVerdicts: number;
  readonly recorded: number;
  readonly compared: number;
};

export type DelegatedMerge = {
  readonly itemId: string;
  readonly joined: boolean;
  readonly grantor: string;
};

export const protectedDirectory = 'src/auth/';

export const joinedChecks: readonly RequiredCheck[] = [
  { app: 'github-actions', name: 'test' },
  { app: 'github-actions', name: 'build' },
];

export const mergedChange: JoinedChange = {
  pullRequest: { repo: joinedRepository, number: 13 },
  head: simSha('d00d'),
  title: 'Add the export button',
  paths: ['src/export/button.tsx'],
};

export const protectedChange: JoinedChange = {
  pullRequest: { repo: joinedRepository, number: 14 },
  head: simSha('5afe'),
  title: 'Shorten the session',
  paths: [`${protectedDirectory}session.ts`],
};

const reviewerLogin = 'uw-reviewer[bot]';
const firstApprovalId = 9300000000;

async function eventNames(scene: JoinedWorld, itemId: string): Promise<readonly string[]> {
  const log = await itemLog(scene.world, scene.harnessId, itemId);
  return log.events.map((event) => event.name);
}

function count(names: readonly string[], name: string): number {
  return names.filter((found) => found === name).length;
}

async function placeOf(scene: JoinedWorld, itemId: string): Promise<string> {
  const item = await scene.world.adapters.store.transaction((tx) =>
    tx.harnessItems.read.byId(itemId),
  );
  return `${item?.stageKey ?? 'missing'} ${item?.gateStatus ?? 'missing'}`;
}

export async function shadowRound(scene: JoinedWorld): Promise<ShadowRound> {
  const { world } = scene;
  value(await world.kernel.gates.recordShadowVerdicts(scene.ingest, { pullRequest: joinedPull }));
  const runId = await startReview(scene);
  value(await world.kernel.runs.postReview(scene.host, runId, approveVerdict));
  assert.deepEqual(world.adapters.connectors.reviews(), []);
  assert.deepEqual(world.adapters.connectors.calls(), []);
  const comparison = value(
    await world.kernel.views.shadow(simCaller(world, scene.admin), { harnessId: scene.harnessId }),
  );
  assert.equal(comparison.rows[0]?.head, joinedHead);
  assert.equal(comparison.rows[0]?.reviewer?.verdict, 'approve');
  const names = await eventNames(scene, scene.itemId);
  return {
    shadowVerdicts: count(names, 'shadow_verdict'),
    recorded: count(names, 'review_verdict_recorded'),
    compared: comparison.rows.length,
  };
}

async function harnessEventNames(scene: JoinedWorld): Promise<readonly string[]> {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, null),
  );
  return events.map((event) => event.name);
}

export async function liftAndPost(scene: JoinedWorld): Promise<number> {
  const { world } = scene;
  const lift = simCaller(world, scene.admin);
  const lifted = value(await world.kernel.stages.liftShadow(lift, { harnessId: scene.harnessId }));
  assert.equal(lifted.harness.shadow, false);
  assert.equal((await harnessEventNames(scene)).includes('shadow_lifted'), true);
  const runId = await startReview(scene);
  value(await world.kernel.runs.postReview(scene.host, runId, approveVerdict));
  const posted = world.adapters.connectors.reviews();
  assert.deepEqual(
    posted.map((review) => [review.pullRequest, review.head, review.verdict]),
    [[joinedPull, joinedHead, 'approve']],
  );
  assert.equal(count(await eventNames(scene, scene.itemId), 'review_verdict_recorded'), 1);
  assert.equal(await placeOf(scene, scene.itemId), 'check working');
  return posted.length;
}

export async function waitsForAPerson(scene: JoinedWorld): Promise<string> {
  const { world, admin } = scene;
  const parked = await simAdvance(world, {
    harnessId: scene.harnessId,
    itemId: scene.itemId,
    worker: admin,
    through: ['check', 'ship'],
  });
  const place = `${parked.stageKey} ${parked.gateStatus}`;
  assert.equal(place, 'ship parked');
  const { rows } = await world.kernel.views.gates(simCaller(world, admin));
  assert.deepEqual(
    rows.map((row) => row.item.itemId),
    [scene.itemId],
  );
  assert.deepEqual((await itemLog(world, scene.harnessId, scene.itemId)).decisions, []);
  assert.deepEqual(world.adapters.connectors.calls(), []);
  return place;
}

async function joinedAtShip(scene: JoinedWorld, change: JoinedChange): Promise<string> {
  const { world } = scene;
  const approval = firstApprovalId + change.pullRequest.number;
  const reviews = [approvedBy(reviewerLogin, 'deepinfra', change.head, approval)];
  const { pullRequest: ref, head, paths } = change;
  world.adapters.githubFacts.given(joinedFacts(world, { ref, head, paths, reviews }));
  const joining = { pullRequest: ref, head, title: change.title };
  const { item } = value(await joinRequest(world, joining));
  const atShip = await simAdvance(world, {
    harnessId: scene.harnessId,
    itemId: item.itemId,
    worker: scene.admin,
    through: ['check'],
  });
  assert.equal(`${atShip.stageKey} ${atShip.gateStatus}`, 'ship working');
  return item.itemId;
}

async function agentSubmitsAtShip(scene: JoinedWorld, loan: MergeLoan, itemId: string) {
  const agent = simCaller(scene.world, loan.agent);
  const { items } = scene.world.kernel;
  value(await items.claim(agent, { itemId, delegationId: loan.delegationId }));
  return value(await items.submit(agent, { itemId, to: null, evidence: {}, change: null }));
}

export async function mergedUnderDelegation(
  scene: JoinedWorld,
  loan: MergeLoan,
): Promise<DelegatedMerge> {
  const { world } = scene;
  const itemId = await joinedAtShip(scene, mergedChange);
  const submitted = await agentSubmitsAtShip(scene, loan, itemId);
  assert.deepEqual(submitted.failures, []);
  const [decision] = await world.adapters.store.transaction((tx) =>
    tx.gateDecisions.read.forItem(itemId),
  );
  assert.deepEqual(
    [decision?.actor, decision?.agentActor, decision?.delegationId],
    [scene.admin.identity, loan.agent.identity, loan.delegationId],
  );
  assert.deepEqual(world.adapters.connectors.calls(), []);
  const exits = await world.kernel.gates.exitDelegated(simCaller(world, simSystem()), { limit: 20 });
  assert.deepEqual(value(exits), { exited: [{ itemId, advanced: true }], failed: [] });
  const [merge] = world.adapters.connectors.calls();
  assert.deepEqual(
    [merge?.connector, merge?.joined, merge?.pullRequest, merge?.expectedHead, merge?.repository],
    ['merge', true, mergedChange.pullRequest, mergedChange.head, joinedRepository],
  );
  assert.equal((await eventNames(scene, itemId)).includes('delegated_merge'), true);
  assert.equal(await placeOf(scene, itemId), 'ship done');
  const { rows } = await world.kernel.views.delegatedMerges(simCaller(world, scene.admin));
  assert.deepEqual(
    rows.map((row) => [row.itemId, row.email]),
    [[itemId, scene.admin.email]],
  );
  return { itemId, joined: merge?.joined ?? false, grantor: decision?.actor ?? '' };
}

export async function refusedForProtectedPath(
  scene: JoinedWorld,
  loan: MergeLoan,
): Promise<readonly string[]> {
  const { world } = scene;
  const itemId = await joinedAtShip(scene, protectedChange);
  const submitted = await agentSubmitsAtShip(scene, loan, itemId);
  assert.deepEqual(submitted.failures, ['protected_path_needs_person']);
  assert.equal(`${submitted.item.stageKey} ${submitted.item.gateStatus}`, 'ship parked');
  const log = await itemLog(world, scene.harnessId, itemId);
  assert.equal(log.events.at(-1)?.name, 'ship_refused');
  assert.deepEqual(log.decisions, []);
  assert.equal(world.adapters.connectors.calls().length, 1);
  return submitted.failures;
}
```

`mergedUnderDelegation` is the longest function; if `pnpm lint` reports it over 25 statements or 50 lines, move the three lines from `const { rows } = …` to the `assert.deepEqual` after it into a helper `async function listedUnder(scene: JoinedWorld, itemId: string): Promise<void>` and call it. Do not drop an assertion.

- [ ] **Step 4: Run the scenario**

Run: `pnpm sim -- DX-10`
Expected: PASS, printing the event log and the state:

```
shadow: { shadowVerdicts: 2, recorded: 1, compared: 1 }
posted: 1
waiting: ship parked
merged: true
grantorApproved: true
refused: [ protected_path_needs_person ]
```

If an assertion fails, use superpowers:systematic-debugging: read the failing beat's kernel command and the event log the run printed, and find which assumption in the table above the kernel disagrees with. A disagreement on beat 3 (the item moved off Check) or beat 5 (`joined` false, or a second connector call) is a defect in the kernel, not in the scenario: fix it with its own failing test first, in its own commit, and record it in the tracker. Any other disagreement (an event name, a place string) is a wrong premise here: correct the assertion to what the kernel records, and record the correction in the tracker under the step 20 rulings. Never delete an assertion to make it pass.

- [ ] **Step 5: Run the sim and the scenario discovery tests**

Run: `pnpm sim:all`, then `npx vitest run sim/runner sim/cli`
Expected: every scenario passes, DX-10 among them; discovery finds the new file.

- [ ] **Step 6: Check, lint, knip**

Run: `pnpm check && npx eslint sim/joining-journey.ts sim/scenarios --max-warnings 0 && pnpm knip`
Expected: clean. `protectedChange` and `mergedChange` are imported only inside `sim/joining-journey.ts`; if knip reports them as unused exports, drop their `export` keyword (and the two type exports it names) and remove them from the hand-off table in the tracker.

- [ ] **Step 7: Commit**

```bash
git add sim/joining-journey.ts sim/scenarios/DX-10.the-joining-journey-from-shadow-to-a-delegated-merge.ts
git commit -m "test(sim): DX-10, the joining journey from shadow to a delegated merge

One scenario drives design section 4: a check-only harness in shadow
records the Reviewer verdict and the shadow verdicts and posts nothing,
the lift posts the review, the posted approval leaves the item at Check
until a person moves it, Ship waits on a person, a merge delegation
merges a second joined pull request at its own ref, and is refused on
a third that touches a protected path. S20-R1, S20-R2, S20-R8."
```

---

### Task 3: The switch is one flag

**Files:**
- Create: `infra/go-live.json` (shared root, own commit)
- Create: `tools/infra/switch.ts`
- Modify: `tools/infra/go-live.test.ts` (three `it`s and the import)
- Modify: `tools/infra/crons.test.ts` (two `it`s and the import)

**Interfaces:**
- Produces: `parseSwitch(text: string): boolean`, `goLiveSwitchedOn(): boolean`.

- [ ] **Step 1: The flag (own commit, shared root `infra/`)**

Create `infra/go-live.json`:

```json
{ "switchedOn": false }
```

Run: `npx prettier --write infra/go-live.json`

```bash
git add infra/go-live.json
git commit -m "chore(infra): the go-live switch is one flag, off

Shared root infra/. GL-1's switch pull request copies each
wrangler.go-live.toml over its wrangler.toml and sets switchedOn to
true here; the live-file tests read this flag, so no test is edited at
the switch. Rejected: editing five assertions in the switch pull
request. S20-R3."
```

- [ ] **Step 2: Write the reader**

Create `tools/infra/switch.ts`:

```ts
import { readFileSync } from 'node:fs';

const switchFile = 'infra/go-live.json';

function switchedOnIn(parsed: unknown): boolean | null {
  if (typeof parsed !== 'object' || parsed === null || !('switchedOn' in parsed)) return null;
  return typeof parsed.switchedOn === 'boolean' ? parsed.switchedOn : null;
}

export function parseSwitch(text: string): boolean {
  const switchedOn = switchedOnIn(JSON.parse(text));
  if (switchedOn === null) {
    throw new Error(`${switchFile} must read { "switchedOn": true } or { "switchedOn": false }`);
  }
  return switchedOn;
}

export function goLiveSwitchedOn(): boolean {
  return parseSwitch(readFileSync(switchFile, 'utf8'));
}
```

- [ ] **Step 3: Make the go-live assertions read the flag**

In `tools/infra/go-live.test.ts`, add `import { goLiveSwitchedOn } from './switch.ts';` after the vitest import. Then replace exactly these three cases.

In `FD-12 the go-live config is the live config plus the bindings whose resources do not exist yet`, replace

```ts
  it.each(apps)('%s live file declares none of the go-live bindings', (app) => {
    expect(goLiveKeysIn(load(`infra/${app}/${live}`))).toEqual([]);
  });
```

with

```ts
  it.each(apps)('%s live file declares the go-live bindings only once the switch is on', (app) => {
    const twin = goLiveSwitchedOn() ? load(`infra/${app}/${goLive}`) : {};
    expect(goLiveKeysIn(load(`infra/${app}/${live}`))).toEqual(goLiveKeysIn(twin));
  });
```

In `HE-1 the HarnessRun Workflow is declared for go-live only, in staging and production`, replace

```ts
  it('declares no Workflow in the live file', () => {
    expect(workflowSites(load(`infra/uw-app/${live}`))).toEqual([]);
  });
```

with

```ts
  it('declares a Workflow in the live file only once the switch is on', () => {
    const twin = goLiveSwitchedOn() ? load(`infra/uw-app/${goLive}`) : {};
    expect(workflowSites(load(`infra/uw-app/${live}`))).toEqual(workflowSites(twin));
  });
```

In `the sandbox containers are declared for go-live only, in staging and production`, replace

```ts
  it('declares no container, sandbox binding or migration in the live file', () => {
    const config = load(`infra/uw-app/${live}`);
    expect(sandboxSites(config)).toEqual([]);
    expect(config['migrations']).toBeUndefined();
  });
```

with

```ts
  it('declares a container, sandbox binding or migration in the live file only once the switch is on', () => {
    const config = load(`infra/uw-app/${live}`);
    const twin = goLiveSwitchedOn() ? load(`infra/uw-app/${goLive}`) : {};
    expect(sandboxSites(config)).toEqual(sandboxSites(twin));
    expect(config['migrations']).toEqual(twin['migrations']);
  });
```

- [ ] **Step 4: Make the cron assertions read the flag**

In `tools/infra/crons.test.ts`, add `import { goLiveSwitchedOn } from './switch.ts';` after the vitest import, and replace

```ts
  it('finds no cron anywhere in the live file', () => {
    expect(everyCron(readFileSync('infra/uw-app/wrangler.toml', 'utf8'))).toEqual([]);
  });
```

with

```ts
  it('finds a cron in the live file only once the switch is on', () => {
    const twin = goLiveSwitchedOn() ? readFileSync('infra/uw-app/wrangler.go-live.toml', 'utf8') : '';
    expect(everyCron(readFileSync('infra/uw-app/wrangler.toml', 'utf8'))).toEqual(everyCron(twin));
  });
```

and

```ts
  it.each(deployed)('the live %s environment triggers no cron until go-live', (name) => {
    expect(environment('wrangler.toml', name)['triggers']).toBeUndefined();
  });
```

with

```ts
  it.each(deployed)('the live %s environment triggers its crons only once the switch is on', (name) => {
    const twin = goLiveSwitchedOn() ? environment('wrangler.go-live.toml', name) : {};
    expect(environment('wrangler.toml', name)['triggers']).toEqual(twin['triggers']);
  });
```

- [ ] **Step 5: Prove the flag bites, then put it back**

Run: `npx vitest run tools/infra/go-live.test.ts tools/infra/crons.test.ts`
Expected: green.

Then flip the flag without copying: `printf '{ "switchedOn": true }\n' > infra/go-live.json` and run the same command.
Expected: FAIL in all five changed cases (the live files lack what their twins declare). This is the half-done switch failing, as S20-R3 intends.

Restore it: `git checkout -- infra/go-live.json` and run the command again.
Expected: green.

- [ ] **Step 6: Check, lint, knip**

Run: `pnpm check && npx eslint tools/infra --max-warnings 0 && npx prettier --check tools/infra && pnpm knip`
Expected: clean. If prettier rewraps a changed line, run `npx prettier --write` on that file.

- [ ] **Step 7: Commit**

```bash
git add tools/infra/switch.ts tools/infra/go-live.test.ts tools/infra/crons.test.ts
git commit -m "test(infra): the live-file checks read the go-live switch

While infra/go-live.json is off, each live wrangler file declares none
of the go-live bindings, Workflows, containers or crons, as before;
once it is on, each must carry what its go-live twin declares. The
switch pull request copies the files and flips the flag, and a half
switch fails. GL-1, S20-R3."
```

---

### Task 4: GL-1, the probe answers the database through Hyperdrive

**Files:**
- Modify: `apps/uw-app/health/health.test.ts` (workers project; one `describe` appended, two imports)

**Interfaces:**
- Consumes: `platformDeps` (`apps/uw-app/deps.ts`), `hyperdriveDatabase` (`apps/uw-app/database.ts`), the file's own `handleWithPing`, `commit`, `recordingDeps`, `createApp`, `healthReportSchema`.

- [ ] **Step 1: Write the test**

Add these imports to `apps/uw-app/health/health.test.ts`, beside the existing `../database.ts` type import:

```ts
import { hyperdriveDatabase, type DatabaseHandle } from '../database.ts';
import { platformDeps } from '../deps.ts';
```

(replace the existing `import type { DatabaseHandle } from '../database.ts';` line with the first of these). Append:

```ts
describe('GL-1 the staging probe answers the database through Hyperdrive', () => {
  it('GL-1 the platform opens its database from the HYPERDRIVE binding and from nothing else', async () => {
    expect(platformDeps.openDatabase).toBe(hyperdriveDatabase);
    expect(hyperdriveDatabase({})).toBeNull();
    const bound = hyperdriveDatabase({
      HYPERDRIVE: { connectionString: 'postgres://unused@127.0.0.1:1/unused' },
    });
    expect(bound).not.toBeNull();
    await bound?.release();
  });

  it('GL-1 the probe reports the database ok, with its latency, once the binding answers', async () => {
    const response = await getHealth(() => handleWithPing(async () => undefined));
    expect(response.status).toBe(200);
    const report = healthReportSchema.parse(await response.json());
    const database = report.indicators.find((found) => found.name === 'database');
    expect(database).toMatchObject({
      status: 'ok',
      detail: expect.stringMatching(/^reachable in \d+ ms$/),
    });
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run --project workers apps/uw-app/health/health.test.ts`
Expected: green on first run. Both cases pin behaviour that FD-11 and FD-12 built; GL-1's test is the proof that the switch needs nothing more in the Worker. Record in the tracker that it was green on first run and why. If the second case reports `amber`, the fake ping took over 500 ms on this machine: rerun once; if it repeats, report it as a finding rather than loosening the status.

- [ ] **Step 3: Lint and commit**

Run: `npx eslint apps/uw-app/health/health.test.ts --max-warnings 0 && pnpm check`
Expected: clean.

```bash
git add apps/uw-app/health/health.test.ts
git commit -m "test(uw-app): GL-1, the probe reports the database through the Hyperdrive binding

The platform opens its database only from HYPERDRIVE, opens nothing
without it, and the public probe reports the database ok with its
latency once the binding answers. This is the reading GL-1's live
release gate takes on staging."
```

---

### Task 5: GL-1, the runbook and the gated jobs

**Files:**
- Modify: `infra/README.md` (shared root, own commit; one subsection appended at the end)
- Create: `tools/infra/switch.test.ts`

**Interfaces:**
- Consumes: `parseSwitch` (Task 3); `.github/scripts/secret-gate.sh`; every `.github/workflows/*.yml`; both `infra/*/wrangler.go-live.toml`.
- Produces: the runbook's eight numbered steps; helpers `switchSection`, `runbookSteps` inside the test file (Task 6 appends to the same file).

- [ ] **Step 1: Write the test (red)**

Create `tools/infra/switch.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { parseSwitch } from './switch.ts';

type Step = {
  readonly id?: string;
  readonly if?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string>>;
};
type Job = {
  readonly if?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly steps?: readonly Step[];
};
type Block = Record<string, unknown>;
type Located = { readonly site: string; readonly job: Job };

const workflows = '.github/workflows';
const gated = "steps.gate.outputs.configured == 'true'";
const neonName = /\b(?:secrets|vars)\.(NEON_[A-Z_]+)\b/g;
const gateRun = /^bash \.github\/scripts\/secret-gate\.sh ([A-Z_]+)$/;
const placeholder = 'set-at-go-live';
const goLiveFiles = ['infra/uw-app/wrangler.go-live.toml', 'infra/uw-ingest/wrangler.go-live.toml'];
const switchHeading = '## Switching on the go-live wiring (FD-12)';
const runbookStep = /^(\d+)\. \*\*/gm;

function jobsIn(file: string): [string, Job][] {
  const text = readFileSync(join(workflows, file), 'utf8');
  const workflow = parseYaml(text) as { readonly jobs?: Record<string, Job> };
  return Object.entries(workflow.jobs ?? {});
}

function neonNames(value: unknown): string[] {
  return [...JSON.stringify(value).matchAll(neonName)].map((match) => match[1] ?? '');
}

function neonJobs(): Located[] {
  const files = readdirSync(workflows)
    .filter((file) => file.endsWith('.yml'))
    .sort();
  return files.flatMap((file) =>
    jobsIn(file)
      .filter(([, job]) => neonNames(job).length > 0)
      .map(([id, job]) => ({ site: `${file} ${id}`, job })),
  );
}

function gateSecret(job: Job): string {
  const gate = (job.steps ?? []).find((step) => step.id === 'gate');
  return gateRun.exec(gate?.run ?? '')?.[1] ?? '';
}

function ungatedSteps(job: Job): number[] {
  const steps = job.steps ?? [];
  const gate = steps.findIndex((step) => step.id === 'gate');
  return steps.flatMap((step, index) => {
    const early = index < gate && neonNames(step).length > 0;
    const loose = index > gate && step.if !== gated;
    return early || loose ? [index] : [];
  });
}

function runGate(secret: string, present: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'uw-switch-'));
  const output = join(dir, 'output');
  try {
    const env = {
      PATH: process.env['PATH'] ?? '',
      GITHUB_OUTPUT: output,
      ...(present ? { [secret]: 'set' } : {}),
    };
    execFileSync('bash', ['.github/scripts/secret-gate.sh', secret], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return readFileSync(output, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function switchSection(): string {
  const text = readFileSync('infra/README.md', 'utf8');
  const start = text.indexOf(switchHeading);
  return start === -1 ? '' : text.slice(start);
}

function runbookSteps(section: string): number[] {
  return [...section.matchAll(runbookStep)].map((match) => Number(match[1]));
}

function environmentsOf(path: string): Block[] {
  const config = parseToml(readFileSync(path, 'utf8')) as Block;
  return Object.values((config['env'] ?? {}) as Record<string, Block>);
}

function placeholdersIn(block: Block): string[] {
  const vars = Object.entries((block['vars'] ?? {}) as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string' && value.includes(placeholder))
    .map(([key]) => key);
  const ids = (block['hyperdrive'] ?? []) as readonly { readonly id?: string }[];
  return ids.some((entry) => entry.id === placeholder) ? [...vars, 'Hyperdrive id'] : vars;
}

function placeholderNames(): string[] {
  return [...new Set(goLiveFiles.flatMap(environmentsOf).flatMap(placeholdersIn))].sort();
}

function stagingProbe(): string {
  const text = readFileSync(join(workflows, 'deploy-staging.yml'), 'utf8');
  const workflow = parseYaml(text) as { readonly jobs: Record<string, Job> };
  return `${workflow.jobs['deploy-staging']?.env?.['STAGING_URL'] ?? ''}/health/probe`;
}

describe('GL-1 every go-live job runs when its secret exists and skips while it is absent', () => {
  it('GL-1 finds every job that reads a Neon secret, each behind a gate on a Neon secret', () => {
    const jobs = neonJobs();
    expect(jobs.map((found) => found.site)).toEqual([
      'cleanup-pr.yml drop-neon-branch',
      'deploy-production.yml migrate-production',
      'deploy-staging.yml migrate-staging',
      'neon-pr.yml neon-branch',
    ]);
    for (const { site, job } of jobs) {
      expect(gateSecret(job), site).toMatch(/^NEON_/);
      expect(ungatedSteps(job), site).toEqual([]);
      expect(neonNames(job.env ?? {}), site).toEqual([]);
      expect(job.if ?? '', site).not.toMatch(/secrets/);
    }
  });

  it('GL-1 the gate opens each job when its secret is set and keeps it green when it is not', () => {
    for (const { job } of neonJobs()) {
      expect(runGate(gateSecret(job), true)).toBe('configured=true\n');
      expect(runGate(gateSecret(job), false)).toBe('configured=false\n');
    }
  });

  it('GL-1 flags a planted job that reads a Neon secret before its gate or runs a step outside it', () => {
    const planted: Job = {
      steps: [
        { run: 'pnpm db:migrate', env: { DATABASE_URL: 'secrets.NEON_DIRECT_URL_STAGING' } },
        { id: 'gate', run: 'bash .github/scripts/secret-gate.sh NEON_DIRECT_URL_STAGING' },
        { run: 'pnpm db:migrate' },
      ],
    };
    expect(gateSecret(planted)).toBe('NEON_DIRECT_URL_STAGING');
    expect(ungatedSteps(planted)).toEqual([0, 2]);
    expect(ungatedSteps({ steps: [{ run: 'pnpm db:migrate' }] })).toEqual([0]);
  });
});

describe('GL-1 the runbook switches on what the go-live files leave unset', () => {
  it('GL-1 names every secret a go-live job reads and every value still set-at-go-live', () => {
    const section = switchSection();
    const secrets = [...new Set(neonJobs().flatMap(({ job }) => neonNames(job)))].sort();
    expect(secrets).toEqual([
      'NEON_API_KEY',
      'NEON_DIRECT_URL_PRODUCTION',
      'NEON_DIRECT_URL_STAGING',
      'NEON_PROJECT_ID',
    ]);
    expect(placeholderNames()).toContain('Hyperdrive id');
    expect([...secrets, ...placeholderNames()].filter((name) => !section.includes(name))).toEqual(
      [],
    );
  });

  it('GL-1 orders the switch in eight steps and ends on the staging probe answering the database through Hyperdrive', () => {
    const section = switchSection();
    expect(runbookSteps(section)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(stagingProbe()).toBe('https://uw-app-staging.unfoldingword.workers.dev/health/probe');
    expect(section).toContain(stagingProbe());
    expect(section).toContain('select(.name == "database")');
    expect(section).toContain('reachable in');
    expect(section).toContain('infra/go-live.json');
  });

  it('GL-1 the switch is a boolean in infra/go-live.json and nothing else', () => {
    expect(parseSwitch('{ "switchedOn": false }')).toBe(false);
    expect(parseSwitch('{ "switchedOn": true }')).toBe(true);
    expect(() => parseSwitch('{ "switchedOn": "yes" }')).toThrow('infra/go-live.json');
    expect(() => parseSwitch('{}')).toThrow('infra/go-live.json');
    expect(typeof parseSwitch(readFileSync('infra/go-live.json', 'utf8'))).toBe('boolean');
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tools/infra/switch.test.ts`
Expected: the first describe and the third case of the second pass; `names every secret …` fails on the placeholder names the README does not mention yet (at least `ACCESS_MCP_AUD`, `APP_ORIGIN`, `Hyperdrive id`), and `orders the switch in eight steps …` fails on `[]` steps. If the first case lists a fifth Neon job (a step 18 or 19 workflow), that job must be gated: fix the workflow, not the list, in its own commit (`.github/workflows/` is a shared root).

- [ ] **Step 3: Write the runbook (own commit, shared root `infra/`)**

Append to the end of `infra/README.md` (after the paragraph that begins "Until that PR, …"):

````markdown
### The GL-1 switch, in order

GL-1 switches the wiring above on. It writes no code: each step creates a resource, sets a secret or a value, or checks one. Every row of `docs/progress_tracker.md` that waits on FD-6, FD-7, FD-10 or FD-12 names the step that closes it. Steps 1 to 5 can run in any order; step 6 needs them all; step 7 is GL-1's release gate.

1. **Neon (FD-12).** Create the Neon project on Postgres 16 or later, and its branch `staging`. In the repository settings set `NEON_API_KEY`, `NEON_DIRECT_URL_STAGING` and `NEON_DIRECT_URL_PRODUCTION` as secrets and `NEON_PROJECT_ID` as a variable (the table above). Check: open a test pull request; `neon-branch` runs its steps instead of the notice "NEON_API_KEY is not set", and closing the pull request runs `drop-neon-branch`.
2. **Hyperdrive (FD-12, FD-6).** `wrangler hyperdrive create uw-staging --connection-string=<pooled staging string>`, and the same for `uw-production`. Put each Hyperdrive id in place of `set-at-go-live` in `[[env.staging.hyperdrive]]` and `[[env.production.hyperdrive]]` of both go-live files, and staging's Hyperdrive id in uw-app's `[[env.preview.hyperdrive]]` (P33).
3. **Queues and hosts (FD-10).** Create the four queues listed above with `wrangler queues create`. Read the account's `workers.dev` subdomain in the Cloudflare dashboard; if it is not `unfoldingword`, correct `STAGING_URL` and `INGEST_URL` in `.github/workflows/deploy-staging.yml` and the address in step 7.
4. **Access and origins (FD-7).** Apply the three applications as the Access section says. Put the app application's AUD tag in `ACCESS_AUD`, the `mcp` application's in `ACCESS_MCP_AUD` and the team domain in `ACCESS_TEAM_DOMAIN`, under staging, production and preview of `uw-app/wrangler.go-live.toml`, and the staging origin in `APP_ORIGIN`. `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `ZULIP_SITE` and `ZULIP_BOT_EMAIL` come from the notifier section; the push and Zulip halves read their secrets (`VAPID_PRIVATE_JWK`, `ZULIP_BOT_API_KEY`) before these values, so they stay off until those secrets are set.
5. **Worker secrets (FD-10, GH-1).** Once an org owner has registered the GitHub App (the GitHub App section), set `GITHUB_WEBHOOK_SECRET` on uw-ingest and the `GITHUB_APP_*` secrets on uw-app with `wrangler secret put <name> --env staging`, as that section lists. Step 7's probe does not need them; the FD-10 webhook check and the delegated merge's live run do.
6. **The switch pull request.** In one pull request: copy `uw-app/wrangler.go-live.toml` over `uw-app/wrangler.toml` and `uw-ingest/wrangler.go-live.toml` over `uw-ingest/wrangler.toml`, and set `"switchedOn": true` in `infra/go-live.json`. `pnpm verify` must be green: with the flag on, the live-file tests require each live file to carry everything its go-live twin declares, and with it off they require none of it, so a half switch fails. Merge it on a green CI `test` job; `deploy-staging.yml` then runs `migrate-staging` and deploys both Workers. The deploy builds the sandbox images, so the runner needs Docker (the sandbox section).
7. **The release gate: the staging probe through Hyperdrive.** Run

   ```
   curl -fsS https://uw-app-staging.unfoldingword.workers.dev/health/probe \
     | jq -e '.indicators[] | select(.name == "database") | .status == "ok"'
   ```

   It prints `true` and exits 0 when the database answers through Hyperdrive, and the indicator's detail reads `reachable in <n> ms`. `not_configured` means the deployed Worker has no `HYPERDRIVE` binding (step 6 did not deploy); `red` means Hyperdrive cannot reach Neon (step 2's connection string). Then run each tracker row's own check: sign in through Access, send one GitHub delivery through uw-ingest, watch a failing message reach the dead-letter queue, and load `https://uw-ingest-staging.unfoldingword.workers.dev/health`.
8. **Close the rows.** For each tracker row that cites a step and whose check passed, change its go-live hand-off action to "None: closed by the live run on <date>" and say so in its own section. A row whose check failed stays open, restated with what failed.
````

Then:

```bash
npx prettier --check infra/README.md || npx prettier --write infra/README.md
git add infra/README.md
git commit -m "docs(infra): the GL-1 switch, in order

Shared root infra/. Eight steps a person follows at go-live: Neon,
Hyperdrive, queues and hosts, Access and origins, Worker secrets, the
switch pull request, the staging probe through Hyperdrive as GL-1's
release gate, and closing the tracker rows. Rejected: a separate
docs/go-live.md beside the FD-12 section it extends. S20-R4."
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tools/infra/switch.test.ts`
Expected: green. If `names every secret …` still lists a name, the runbook omitted it: add it to the step that sets it in a second `infra/README.md` commit with the same message shape, never by loosening the test.

- [ ] **Step 5: Run the infra and CI tests together, then lint**

Run: `npx vitest run tools/infra tools/ci`
Expected: green.
Run: `npx eslint tools/infra --max-warnings 0 && npx prettier --check tools/infra && pnpm check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add tools/infra/switch.test.ts
git commit -m "test(infra): GL-1, every go-live job is gated on its secret and the runbook names what is unset

The jobs that read a Neon secret are found by scanning every workflow,
each sits behind its gate and runs when the secret is set; a planted
ungated job fails. The runbook names every Neon secret and every
set-at-go-live value, orders the switch in eight steps and ends on the
staging probe reading the database through Hyperdrive. S20-R5."
```

---

### Task 6: GL-1, the tracker restates what is still missing

**Files:**
- Modify: `docs/progress_tracker.md` (28 rows restated; one "Waiting on a person" row and its hand-off row added for GL-1)
- Modify: `tools/infra/switch.test.ts` (one `describe` appended, with its helpers)

**Interfaces:**
- Consumes: `switchSection`, `runbookSteps` (Task 5, same file).

- [ ] **Step 1: Write the test (red)**

Append to `tools/infra/switch.test.ts`, after the last `describe`:

```ts
const restatedRequirement = /\bFD-(?:6|7|10|12)\b/;
const citation = /GL-1 switch, step (\d+)/;
const closedLive = /None: closed by the live run/;
const trackerSections = ['## Go-live hand-off', '## Not verified', '## Waiting on a person'];

function sectionRows(tracker: string, heading: string): string[] {
  const lines = tracker.split('\n');
  const start = lines.indexOf(heading);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => line.startsWith('| '));
}

function requirementOf(row: string): string {
  const cells = row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
  return /^\d{4}-\d{2}-\d{2}$/.test(cells[0] ?? '') ? (cells[1] ?? '') : (cells[2] ?? '');
}

function tracker(): string {
  return readFileSync('docs/progress_tracker.md', 'utf8');
}

function restatedRows(): string[] {
  const text = tracker();
  return trackerSections
    .flatMap((heading) => sectionRows(text, heading))
    .filter((row) => restatedRequirement.test(requirementOf(row)));
}

function uncited(rows: readonly string[], steps: readonly number[]): string[] {
  return rows.filter(
    (row) => !closedLive.test(row) && !steps.includes(Number(citation.exec(row)?.[1])),
  );
}

describe('GL-1 the tracker restates what FD-6, FD-7, FD-10 and FD-12 still miss', () => {
  it('GL-1 every hand-off, Not verified and Waiting on a person row for them cites the runbook step that closes it', () => {
    const rows = restatedRows();
    expect(rows.length).toBeGreaterThanOrEqual(28);
    expect(uncited(rows, runbookSteps(switchSection()))).toEqual([]);
  });

  it('GL-1 waits on a person for the live switch, in its own row and in the hand-off', () => {
    const text = tracker();
    const waiting = sectionRows(text, '## Waiting on a person').map(requirementOf);
    const handOff = sectionRows(text, '## Go-live hand-off').map(requirementOf);
    expect(waiting).toContain('GL-1');
    expect(handOff).toContain('GL-1');
  });

  it('GL-1 flags a row that cites no step or a step the runbook does not have', () => {
    const rows = [
      '| 2026-10-01 | FD-7 | x | y |',
      '| 2026-10-01 | FD-10 | x | see the GL-1 switch, step 9 |',
      '| 2026-10-01 | FD-12 | x | see the GL-1 switch, step 1 |',
      '| Not verified | 2026-10-01 | FD-6 FD-10 | None: closed by the live run on 2026-11-01. | x |',
    ];
    expect(uncited(rows, [1, 2])).toEqual(rows.slice(0, 2));
    expect(rows.map(requirementOf)).toEqual(['FD-7', 'FD-10', 'FD-12', 'FD-6 FD-10']);
  });
});
```

Run: `npx vitest run tools/infra/switch.test.ts -t "tracker restates"`
Expected: FAIL. The first case lists the 28 uncited rows; the second finds no GL-1 row; the third passes.

- [ ] **Step 2: Restate the 28 rows**

Run this from the repository root. It appends the citation to the action cell of each hand-off row, to the "What is needed to verify it live" cell of each "Waiting on a person" row, and to the "Why" cell of each "Not verified" row; it fails loudly if a prefix matches anything but exactly one row in its section, and skips a row already restated.

```bash
node - <<'EOF'
const fs = require('node:fs');
const path = 'docs/progress_tracker.md';
const today = new Date().toISOString().slice(0, 10);
const cite = (step) => ` Still missing on ${today}; see the GL-1 switch, step ${step}, in \`infra/README.md\`.`;
const handOff = [
  ['| Not verified | 2026-10-01 | FD-7 | Ian: once the Access application exists', 4],
  ['| Not verified | 2026-10-01 | FD-6 FD-10 |', 7],
  ['| Not verified | 2026-10-01 | FD-10 | Ian: once the queues exist', 3],
  ['| Not verified | 2026-10-01 | FD-10 | Ian: run the uw-ingest deploy job', 3],
  ['| Not verified | 2026-10-01 | FD-10 | Ian: once the GitHub App', 5],
  ['| Not verified | 2026-10-01 | FD-12 | Ian: once the Neon key', 1],
  ['| Not verified | 2026-10-01 | FD-12 | Ian: create the Neon `staging` branch', 1],
  ['| Waiting on a person | 2026-10-01 | FD-10 | Ian: once the queues exist, open the switch-on', 6],
  ['| Waiting on a person | 2026-10-01 | FD-12 |', 1],
  ['| Not verified | 2026-10-02 | AB-1 FD-7 |', 4],
  ['| Waiting on a person | 2026-10-02 | AB-1 AB-2 FD-7 |', 4],
  ['| Not verified | 2026-10-03 | WB-3 FD-7 |', 4],
  ['| Waiting on a person | 2026-10-01 | FD-7 |', 4],
  ['| Waiting on a person | 2026-10-01 | FD-10 | Ian: create the four queues', 3],
];
const notVerified = [
  ['| 2026-10-01 | FD-7 | The Access JWT', 4],
  ['| 2026-10-01 | FD-6 FD-10 | `postgres` under workerd', 7],
  ['| 2026-10-01 | FD-10 | Cloudflare Queues delivery', 3],
  ['| 2026-10-01 | FD-10 | The uw-ingest deploy jobs', 3],
  ['| 2026-10-01 | FD-10 | The GitHub webhook signature', 5],
  ['| 2026-10-01 | FD-12 | Every go-live job', 1],
  ['| 2026-10-01 | FD-12 | The Neon `staging` branch', 1],
  ['| 2026-10-02 | AB-1 FD-7 | That Cloudflare Access', 4],
  ['| 2026-10-03 | WB-3 FD-7 | A WebSocket upgrade', 4],
];
const waiting = [
  ['| 2026-10-01 | FD-7 | Access JWT verification', 4],
  ['| 2026-10-01 | FD-10 | uw-ingest Worker', 3],
  ['| 2026-10-01 | FD-10 | The Queues consumer', 6],
  ['| 2026-10-01 | FD-12 | `neon-pr.yml`', 1],
  ['| 2026-10-02 | AB-1 AB-2 FD-7 | The `mcp` Access', 4],
];
const lines = fs.readFileSync(path, 'utf8').split('\n');
function range(heading) {
  const start = lines.indexOf(heading);
  if (start === -1) throw new Error(`no ${heading}`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return [start, end === -1 ? lines.length : end];
}
let edited = 0;
function apply(heading, rules, lastCell) {
  const [start, end] = range(heading);
  for (const [prefix, step] of rules) {
    const hits = [];
    for (let index = start; index < end; index += 1) if (lines[index].startsWith(prefix)) hits.push(index);
    if (hits.length !== 1) throw new Error(`${heading}: "${prefix}" matched ${hits.length} rows`);
    const index = hits[0];
    if (lines[index].includes('GL-1 switch, step')) continue;
    lines[index] = lastCell
      ? lines[index].replace(/ \|$/, `${cite(step)} |`)
      : lines[index].replace(/ \| ([^|]*) \|$/, `${cite(step)} | $1 |`);
    edited += 1;
  }
}
apply('## Go-live hand-off', handOff, false);
apply('## Not verified', notVerified, true);
apply('## Waiting on a person', waiting, false);
fs.writeFileSync(path, lines.join('\n'));
console.log(`restated ${edited} rows`);
EOF
```

Expected: `restated 28 rows`. If a prefix matches zero or two rows because steps 18 or 19 edited one, read that row with `grep -n` and lengthen or correct the prefix; never edit a row by hand outside the script's rule.

- [ ] **Step 3: Add GL-1's own waiting row and its hand-off row**

```bash
node - <<'EOF'
const fs = require('node:fs');
const path = 'docs/progress_tracker.md';
const today = new Date().toISOString().slice(0, 10);
const lines = fs.readFileSync(path, 'utf8').split('\n');
function lastRowBefore(heading) {
  const stop = lines.indexOf(heading);
  if (stop === -1) throw new Error(`no ${heading}`);
  for (let index = stop - 1; index >= 0; index -= 1) if (lines[index].startsWith('| ')) return index;
  throw new Error(`no row before ${heading}`);
}
const waitingRow = `| ${today} | GL-1 | The switch, written: the four Neon jobs gated on their secrets (\`.github/scripts/secret-gate.sh\`), both \`wrangler.go-live.toml\` files, the flag \`infra/go-live.json\` and the runbook "The GL-1 switch, in order" in \`infra/README.md\` | Every resource and value in the runbook's steps 1 to 5, then the switch pull request (step 6) and the staging probe reporting the database \`ok\` through Hyperdrive (step 7), GL-1's release gate; each FD-6, FD-7, FD-10 and FD-12 row cites the step that closes it | Ian; an org owner (GitHub App) |`;
const handOffRow = `| Waiting on a person | ${today} | GL-1 | Ian: follow the GL-1 switch in \`infra/README.md\`, steps 1 to 8, and record the staging probe's database indicator reading \`ok\` through Hyperdrive as GL-1's release gate. | Ian |`;
lines.splice(lastRowBefore('## Carried to later steps') + 1, 0, waitingRow);
lines.splice(lastRowBefore('### Open carries') + 1, 0, handOffRow);
fs.writeFileSync(path, lines.join('\n'));
console.log('added the GL-1 rows');
EOF
```

Expected: `added the GL-1 rows`. Check with `grep -n "| GL-1 |" docs/progress_tracker.md`: one row under "Waiting on a person" (just above "## Carried to later steps") and one hand-off row (just above "### Open carries").

- [ ] **Step 4: Run the test and the hand-off guard**

Run: `npx vitest run tools/infra/switch.test.ts tools/release/criteria.test.ts`
Expected: green. The hand-off guard still pairs every source row with one hand-off row by section, date and requirement, now including GL-1's; the restated cells keep their actions whole.

- [ ] **Step 5: Lint and commit**

Run: `npx eslint tools/infra --max-warnings 0 && npx prettier --check tools/infra docs/progress_tracker.md`
Expected: clean (run `npx prettier --write docs/progress_tracker.md` if it reformats a table, then rerun Step 4).

```bash
git add docs/progress_tracker.md tools/infra/switch.test.ts
git commit -m "docs(tracker): GL-1, every FD-6, FD-7, FD-10 and FD-12 row says what is still missing

Each Not verified, Waiting on a person and hand-off row for them now
cites the step of the GL-1 switch in infra/README.md that closes it,
and GL-1's live switch waits on a person in its own row. The test
names any row that cites no step or a step the runbook lacks. S20-R5,
S20-R6."
```

---

### Task 7: The release guard knows v0.2.0

**Files:**
- Modify: `tools/release/criteria.test.ts`

**Interfaces:**
- Consumes: `delegationProperty`, `templates` (`packages/harness/index.ts`); the DX-10 scenario (Task 2); `tools/architecture/gate-writers.test.ts` (MD-5) and `tools/architecture/untrusted-content.test.ts` (UC-4) titles as they stand.

- [ ] **Step 1: Add the v0.2.0 cases (red first for DX-10 only if Task 2 is not yet committed)**

In `tools/release/criteria.test.ts`:

Change the harness import to:

```ts
import {
  bypassesShip,
  delegationProperty,
  templateProperty,
  templates,
} from '../../packages/harness/index.ts';
```

Add beside the other path constants:

```ts
const templatePropertyTest = 'packages/harness/template-property.test.ts';
const joiningJourney = 'sim/scenarios/DX-10.the-joining-journey-from-shadow-to-a-delegated-merge.ts';
const gateWriters = 'tools/architecture/gate-writers.test.ts';
const untrustedCheck = 'tools/architecture/untrusted-content.test.ts';
```

After the `release criterion 3, by structure: …` describe, add:

```ts
describe('release criterion 3 for v0.2.0, by structure: the DX-10 scenario drives the joining journey (pnpm sim:all in item 1 runs it)', () => {
  it('keeps the scenario file named for DX-10 and its six beats', () => {
    const scenario = source(joiningJourney);
    expect(scenario).toContain("id: 'DX-10'");
    const beats = [
      'shadowRound(',
      'liftAndPost(',
      'waitsForAPerson(',
      'mergedUnderDelegation(',
      'refusedForProtectedPath(',
    ];
    for (const beat of beats) expect(scenario).toContain(`await ${beat}`);
    expect(scenario).toContain('await joinedWorld(world, {');
  });
});
```

Replace the whole `release criterion 4: …` describe with:

```ts
describe('release criterion 4: the three templates pass the property, the negative fixture fails it, and no exit a delegation can take reaches deploy or publish', () => {
  it('passes software, bml and check-only, fails the fixture that bypasses Ship, and keeps both KN-10 cases', () => {
    expect([...templates.keys()].sort()).toEqual(['bml', 'check-only', 'software']);
    for (const template of templates.values()) {
      expect(templateProperty(template.stages)).toEqual([]);
    }
    expect(templateProperty(bypassesShip.stages).length).toBeGreaterThan(0);
    expectTitle(templatePropertyTest, 'KN-10 every registered template');
    expectTitle(templatePropertyTest, 'KN-10 the negative fixture');
    expectNotWeakened(templatePropertyTest);
  });

  it('passes the MD-4 delegation property on every template, fails a delegation that could take any human exit, and keeps both MD-4 cases', () => {
    for (const template of templates.values()) {
      expect(delegationProperty(template.stages)).toEqual([]);
    }
    const permissive = (stage: { readonly exitGate: string }) => stage.exitGate === 'human_approval';
    const bml = templates.get('bml')?.stages ?? [];
    expect(delegationProperty(bml, permissive).length).toBeGreaterThan(0);
    expectTitle(templatePropertyTest, 'MD-4 no path reaches a deploy or publish connector');
    expectTitle(templatePropertyTest, 'MD-4 every registered template passes');
    expectTitle(templatePropertyTest, 'MD-4 a delegation that could take any human exit fails');
  });
});
```

Inside the `release criterion 5, …` describe, after `it('skips none of the four files', …)`, add:

```ts
  it('keeps the MD-5 gate-writer check over the tree and its planted second writer, unskipped', () => {
    expectTitle(gateWriters, 'MD-5 exactly two named functions write a gate decision');
    expectTitle(gateWriters, 'MD-5 a planted second delegated writer fails');
    expectTitle(gateWriters, 'MD-5 a planted write in any form fails');
    expectNotWeakened(gateWriters);
  });

  it('keeps the UC-4 untrusted content check over the tree and its planted cases, unskipped', () => {
    expectTitle(untrustedCheck, 'UC-4 the tree passes the untrusted content check');
    expectTitle(untrustedCheck, 'UC-4 the check fails on a planted call with an unwrapped outside read');
    expectTitle(untrustedCheck, 'UC-4 the check fails on a planted builder');
    expectTitle(untrustedCheck, 'UC-4 the check fails on a planted forgery of the wrapper');
    expectNotWeakened(untrustedCheck);
  });
```

Before relying on the six title strings, confirm each with `grep -n "describe('MD-5\|describe('UC-4" tools/architecture/gate-writers.test.ts tools/architecture/untrusted-content.test.ts`; `expectTitle` matches a prefix, so use the start of the title as it stands.

- [ ] **Step 2: Run it**

Run: `npx vitest run tools/release/criteria.test.ts`
Expected: green. Then prove the new structure checks bite: temporarily rename `sim/scenarios/DX-10.the-joining-journey-from-shadow-to-a-delegated-merge.ts` to `…/DX-10.renamed.ts` with `git mv`, run the file and see `release criterion 3 for v0.2.0` fail on the missing source, then `git mv` it back and rerun green.

- [ ] **Step 3: Lint and commit**

Run: `npx eslint tools/release --max-warnings 0 && npx prettier --check tools/release && pnpm check`
Expected: clean.

```bash
git add tools/release/criteria.test.ts
git commit -m "test(release): the guard checks v0.2.0's journey, three templates, MD-4, MD-5 and UC-4

Design section 9 items 3 to 5: DX-10's scenario and its six beats
exist; all three templates pass the template property and the MD-4
delegation property, whose permissive case fails; the MD-5 and UC-4
checks and their planted halves exist unskipped. Closes the S16 carry
(MD-4 MD-5) to step 20."
```

---

### Task 8: Release readiness, design section 9 items 1 to 6

**Files:**
- Modify: `docs/progress_tracker.md` (a v0.2.0 subsection under "Release criteria")
- Modify: `docs/exceptions.md` (one row, only if CI still cannot run)

No code. Every claim in the tracker cites the command run in this task and its output.

- [ ] **Step 1: The whole chain**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres pnpm verify; echo "verify exit $?"`
Expected: `verify exit 0`. From the output note: the test files, tests passed and skipped, the scenario count (`N of N scenarios`), the walk lines for `software`, `bml`, `check-only`, and the trace line. Note: step 20 is not yet Built in the tracker, so `trace:built` does not yet require DX-10 or GL-1; Task 9 reruns it after marking the step.

- [ ] **Step 2: Item 2, the trace**

Run: `pnpm trace`
Expected: exit 0 and a line of the form `trace: <n> Must requirements; <n> proven, 0 unproven (0 due, 0 in steps not yet built)`. DX-10 and GL-1 are proven (Tasks 2, 4, 5, 6). If any v0.2.0 Must is unproven, stop: it belongs to an earlier step, and the tracker records it under that step as a defect before anything is marked Built.

- [ ] **Step 3: Items 3 to 5, one at a time**

Run each, recording the output line that proves it:

- `pnpm sim -- DX-10` (item 3): the state block of Task 2 Step 4.
- `pnpm walk -- check-only`, `pnpm walk -- software`, `pnpm walk -- bml` (item 4): each lists its path to an effect crossing `ship` with `human_approval`.
- `npx vitest run packages/harness/template-property.test.ts tools/properties/template.test.ts` (item 4, the negative fixture and MD-4).
- `npx vitest run tools/architecture/gate-writers.test.ts tools/architecture/untrusted-content.test.ts tools/architecture/agent-boundary.test.ts` (item 5).
- `npx vitest run tools/release/criteria.test.ts` (the guard over all of it).

Expected: all green.

- [ ] **Step 4: Item 6, CI**

Run: `gh run list --branch build/v0.2.0 --limit 5 --json databaseId,headSha,status,conclusion,createdAt`
Then for the newest run: `gh run view <databaseId> --json jobs --jq '.jobs[] | [.name, .conclusion] | @tsv'`

- If the `test` job concluded `success` on the branch head: item 6 holds on that run; record its id and URL. Skip Step 5.
- If no job started (the run shows the billing message, as every run since 2026-10-03 has): record the run id and the message, and do Step 5.

- [ ] **Step 5: Extend the waiver by name (only if CI did not run)**

Append one row to the table in `docs/exceptions.md`, after the 2026-10-12 row, filling the bracketed values from Steps 1 and 4 (today's date in `YYYY-MM-DD`):

```markdown
| <today> | Design section 9 item 6 for v0.2.0, PRD section 14 item 6 and AGENTS.md section 8: the CI `test` job green on the merge commit | `.github/workflows/ci.yml`, pull request #84 (`build/v0.2.0`) | The waiver of 2026-10-12 above, extended by name to the v0.2.0 merge as design section 9 item 6 allows. GitHub Actions on the unfoldingWord organisation still refuses to start any job: run <run id> on `<head sha>` ("<the message gh shows>"). The code is not the cause. The same chain CI runs, `pnpm verify` with `TEST_DATABASE_URL` on the local Postgres server, exited 0 on `<head sha>` on <today>: <files> test files, <passed> tests passed, <skipped> skipped, <n> of <n> scenarios, <proven> of <must> Must requirements proven. Item 6 is waived, not held: the DX-6 row of the go-live hand-off stays open, and this exception closes when CI runs green on the merge commit's head. | Proposed by the build on <today>; Ian (DRI) confirms or refuses it at his review of #84, before the merge |
```

```bash
git add docs/exceptions.md
git commit -m "docs(exceptions): propose extending the CI billing waiver to the v0.2.0 merge

Design section 9 item 6. Actions still starts no job (run <run id>);
the local verify on <head sha> is the evidence. Ian confirms or
refuses the extension at his review. S20-R9."
```

- [ ] **Step 6: Record the v0.2.0 release list in the tracker**

In `docs/progress_tracker.md`, directly after the table under "## Release criteria" (before "## Go-live hand-off"), add the following, with each Evidence cell filled from Steps 1 to 4 (the command and the line it printed; never a claim without its run):

```markdown
### v0.2.0 (design section 9)

The v0.2.0 release list. Items 1 to 6 are the build's; item 7 is Ian's. GL-1's live run, the week of shadow mode and the comparison with the bench happen on the tag.

| Item | Holds | Evidence |
|---|---|---|
| 1. `pnpm verify` is green, including `walk`, `trace`, `sim -- all` | Yes | `pnpm verify` with `TEST_DATABASE_URL` on `<head sha>`, <today>: <files> test files, <passed> passed, <skipped> skipped; <n> of <n> scenarios; walk lists `software`, `bml`, `check-only`. Local only (item 6) |
| 2. Every Must in section 5 has a scenario or test named for its ID (DX-9) | Yes | `pnpm trace`: "<the trace line>"; the DX-9 test in `tools/trace/trace.test.ts` and release criterion 2 |
| 3. DX-10 passes | Yes | `pnpm sim -- DX-10`: <the state line>; release criterion 3 for v0.2.0 pins the file and its six beats |
| 4. The template property passes on all three templates and fails on the planted bypass; MD-4's deploy-and-publish property passes | Yes | `packages/harness/template-property.test.ts` (KN-10 and MD-4 cases), `tools/properties/template.test.ts`, release criterion 4 (both cases) |
| 5. MD-5 and UC-4 pass on the tree and fail on their planted fixtures | Yes | `tools/architecture/gate-writers.test.ts`, `tools/architecture/untrusted-content.test.ts`; release criterion 5's MD-5 and UC-4 cases |
| 6. The CI `test` job is green on the merge commit, or the billing waiver of 2026-10-12 is extended by name in `docs/exceptions.md` | <Yes on run <id> / Waived, pending Ian's confirmation> | <the run id and its outcome; or "the extension row dated <today> in `docs/exceptions.md`, proposed by the build, confirmed or refused by Ian at his review of #84"> |
| 7. Ian has reviewed the branch with Codex and merged it with a merge commit | No: Ian's | Not the build's to do (AGENTS.md section 8) |
```

```bash
git add docs/progress_tracker.md
git commit -m "docs(tracker): the v0.2.0 release list with its evidence

Design section 9 items 1 to 5 hold on the local chain; item 6 holds on
<CI run id> or waits on Ian's confirmation of the waiver extension;
item 7 is Ian's."
```

---

### Task 9: Verify, record, push

**Files:**
- Modify: `docs/progress_tracker.md` (step 20 row Built; "Step 20 evidence by requirement"; S20 rulings; the carries addressed to step 20)
- Modify: `docs/PRD.md` (the Status line; shared root, own commit)

- [ ] **Step 1: Mark step 20 Built and record its evidence**

In `docs/progress_tracker.md`:

1. The step 20 row of "Status by build-order step": state `Built`; evidence: "Tasks 1 to 8 on `build/v0.2.0`: <the commit SHAs of Tasks 1 to 8, by task>. DX-10 is proven by `sim/scenarios/DX-10.the-joining-journey-from-shadow-to-a-delegated-merge.ts`; GL-1 by `tools/infra/switch.test.ts` and the GL-1 describe in `apps/uw-app/health/health.test.ts`. GL-1's live switch waits on a person (the GL-1 row under Waiting on a person). `pnpm verify` green locally: counts in Step 2 below. CI: <run id, or the waiver proposal of Task 8 Step 5>. `docs/superpowers/plans/2026-10-15-step-20-joining-journey-and-switch.md`".
2. A section "## Step 20 evidence by requirement", directly before "## Decisions made during the build", in the shape of step 17's:

```markdown
## Step 20 evidence by requirement

Commits are on `build/v0.2.0`. The plan commit is left out. `pnpm verify` at the step's tracker commit: <counts>; CI <run id or "not run (Actions billing)">.

| Requirement | Commits | Scenarios and tests |
|---|---|---|
| DX-10 | <Task 1 SHA>, <Task 2 SHA> | scenario `DX-10`; release criterion 3 for v0.2.0 in `tools/release/criteria.test.ts` |
| GL-1 | <Task 3 SHAs>, <Task 4 SHA>, <Task 5 SHAs>, <Task 6 SHA> | `tools/infra/switch.test.ts` (three GL-1 describes), `apps/uw-app/health/health.test.ts` (GL-1 describe), `tools/infra/go-live.test.ts` and `tools/infra/crons.test.ts` (the live-file cases read the switch); the live release gate is a person's (Waiting on a person, GL-1) |
| GL-1 (green on first run) | <Task 4 SHA> | The probe and the Hyperdrive binding were built in step 1 (FD-11, FD-12); the GL-1 test pins them, so it passed when written |
```

3. Under "## Decisions made during the build", append S20-R1 to S20-R9 from the top of this plan, one row each, shape `| <today> | <requirement> | S20-Rn. <ruling> | <cost if wrong> |` (requirements: R1 and R2 and R8 `DX-10`; R3 to R6 `GL-1`; R7 `DX-10 GL-1`; R9 `DX-6 GL-1`). Add any correction Task 2 Step 4 made, as its own row.
4. Under "## Carried to later steps", close the rows addressed to step 20. Find them with `grep -n "| 20 |" docs/progress_tracker.md`. At planning time there are four:
   - `S14 (GL-3)`: To step becomes `20 (closed)`; the What cell starts "Closed by step 20 (S20-R1; <Task 2 SHA>): only a person moves a joined item from Check to Ship; DX-10 asserts a posted approval leaves it at Check." then keeps its text.
   - `S16 (MD-4 MD-5)`: `20 (closed)`; "Closed by step 20 (<Task 7 SHA>): release criteria 4 and 5 check MD-4's property and the MD-5 and UC-4 checks." then its text.
   - `S16 (MD-3, S16-R10)`: `20 (closed)`; "Closed by step 20 (<Task 2 SHA>): DX-10 merges a joined pull request under a delegation in the sim, and the merge connector is asked with `joined: true` at the pull request's own ref." then its text.
   - `S16 (MD-3)` (the GitHub App for the cron): `20 (restated)`; "Restated by step 20: still a person's, at the GL-1 switch, step 5, in `infra/README.md`; the Not verified row for MD-3 dated 2026-10-15 holds the live check." then its text.
   Any row steps 17 to 19 addressed to step 20 is closed the same way when this step did the work, or restated with the GL-1 switch step or the later step that owns it, with the reason.

- [ ] **Step 2: Rerun the chain with step 20 Built**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres pnpm verify; echo "verify exit $?"`
Expected: `verify exit 0`. `trace:built` now requires DX-10 and GL-1, and finds both. Put the counts into the step 20 row and the evidence section.

- [ ] **Step 3: The PRD status line (own commit, shared root `docs/PRD.md`)**

In `docs/PRD.md`, replace the Status row's value with:

```markdown
| Status | Approved. v1 (sections 7.1 to 7.10) was built as v0.1.0, merge commit `83e3f64`, tagged 2026-10-12. v0.2.0 (section 7.11), approved on 2026-10-15, is built on `build/v0.2.0` (pull request #84) and waits for Ian's Codex review and merge; GL-1's live switch and the week of shadow mode are a person's, on the tag (`docs/progress_tracker.md`, Release criteria, v0.2.0) |
```

```bash
git add docs/PRD.md
git commit -m "docs(prd): v0.2.0 is built and waits for review

Shared root docs/PRD.md. The status line names v0.2.0 as built on
build/v0.2.0 and leaves the merge, the tag and GL-1's live switch to
people."
```

- [ ] **Step 4: Commit the tracker and push**

```bash
git add docs/progress_tracker.md
git commit -m "docs(tracker): step 20, the joining journey and the switch, is built

DX-10 and GL-1 proven; S20-R1 to S20-R9 recorded; the carries to step
20 closed or restated. The v0.2.0 release list holds items 1 to 5 on
the local chain; item 6 as recorded; item 7 is Ian's."
git push
```

- [ ] **Step 5: Mark the pull request ready for Ian's review, and stop**

```bash
gh pr edit 84 --title "feat: harness v0.2.0" --body "The v0.2.0 build (PRD section 7.11; design docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md), steps 12 to 20. Evidence per requirement, every ruling, what was not verified and what waits on a person are in docs/progress_tracker.md; the release list is under Release criteria, v0.2.0. Release item 6: see that table and docs/exceptions.md. GL-1's live switch follows infra/README.md, The GL-1 switch, in order."
gh pr ready 84
```

Do not tag, do not merge, do not deploy. Report, in this order: anything not verified first; what is built (DX-10, GL-1, the release list); every S20 ruling in one line each; every row still waiting on a person, starting with GL-1's.

---

## Self-review

**Spec coverage.** DX-10 (PRD 7.11.10): Task 2, with every clause of its sentence a beat in the scenario's table: check-only harness in shadow (beat 1), a review request (beat 1, `joinRequest` inside `joinedWorld`), a verdict recorded and not posted (beat 2), a shadow verdict (beat 2), shadow lifted (beat 3), a posted review (beat 3), Ship waiting on a person (beat 4), a merge under a delegation on a second item (beat 5), refused on a third for a protected path (beat 6). Design section 4 step 4 is beat 2's comparison read; step 6 is left out by S20-R8. GL-1 (PRD 7.11.1): "every FD-12 job and binding runs when its secret exists" is Task 5's first describe (jobs) and Task 3 plus Task 5's runbook (bindings, by the switch); "the tracker's Waiting rows … restated with what is still missing" is Task 6 under S20-R6; "nothing new is written" holds: no binding, job, secret or behaviour is added, only the test-side flag (S20-R3); "the release gate … the staging health probe answering through Hyperdrive" is Task 4 (what the probe reports) and runbook step 7 (the person's run), recorded as waiting by Task 6. CF-3: S20-R1, asserted in Task 2. S16-R10: Task 2 beat 5. S15-R1: S20-R2 and `joinedChecks`. Release list: Tasks 7 and 8; the PRD status line and the tracker: Task 9.

**Placeholders.** Code and commands are complete. The bracketed values in Task 8 Steps 5 and 6 and Task 9 Steps 1 and 2 (SHAs, counts, run ids, dates) exist only after the runs those steps name, and each says where it comes from.

**Type consistency.** `JoinedChange`, `ShadowRound`, `DelegatedMerge`, `joinedChecks`, `protectedDirectory`, `mergedChange`, `protectedChange` and the five beat functions are spelled the same in Task 2's module, its scenario, Task 7's guard and the hand-off table. `goLiveSwitchedOn` and `parseSwitch` match between Task 3's module, its two refactored test files and Task 5's test. `switchSection` and `runbookSteps` are defined in Task 5 and reused in Task 6 in the same file. The runbook's eight steps (Task 5) are the numbers Task 6's script cites and Task 5's test pins.

**Review Focus.** Line 1 is pinned by `liftAndPost`'s `check working` assertion; line 2 by `mergedUnderDelegation`'s connector assertion; line 3 by `refusedForProtectedPath`'s exact failures; line 4 by Task 5's scan and planted job; line 5 by Task 3 Step 5's flip-and-fail; line 6 by Task 6 Step 4 running the hand-off guard.
