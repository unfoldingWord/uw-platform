# Step 12, Words and Contracts: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give v0.2.0 its vocabulary in code: the trace proves it reads the v0.2.0 requirements (DX-9), the closed sets every later step consumes exist in `packages/contracts` with fixtures and a lock entry, and the check-only template is registered and passes the template property.

**Architecture:** Nothing here changes a behaviour. It adds values to enums, a new template to the registry and a test to the trace, so that steps 13 to 20 touch the contracts root as little as possible. The words themselves landed on `main` in `a03d1a1`; the PRD amendment in `b8e031f`; the `Should` priority and the built-mode guard in `c46532b`. This step finishes DX-9 with its named test and adds what those commits did not.

**Tech Stack:** TypeScript strict, Zod 4, Vitest 4 (node project), the contract lock JSON, the harness template registry.

**Spec:** `docs/PRD.md` section 7.11 (DX-9, GL-2's fixture half) and section 8.3; the design is `docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` sections 5.1, 5.10 and 6.

**Requirements covered:** DX-9. The check-only template fixture half of GL-2 (the `kickstart` refusal and the harness behaviour are step 14). Closed sets for FL-1, MD-2, RV-1 and UC-1 (the sets only; their consumers are in later steps).

**Rulings made while planning** (recorded here and in `docs/progress_tracker.md` by the last task):

| Ruling | Cost if wrong |
|---|---|
| S12-R1. The contract moves `12.1.0` → `12.2.0` in this step, not `13.0.0`. Everything here is additive. The major bump the design names lands in step 15 when RV-1 makes `weight` a required field on a finding | None; the lock test enforces the semver rule either way |
| S12-R2. Only sets with no runtime consumer, or whose consumers are total maps this step also edits, are added here: capability words, finding weight, untrusted source, template key. Ship refusals, event names and wake reasons are added by the steps that emit them, because `shipRule` refuses on any reason without a predicate, `harness_events` has a check constraint on names, and `wakeRank` is a total record | A later step touches the contracts root once more than it would have; rule 4 makes that one commit |
| S12-R3. The check-only template has two stages, `check` at position 10 and `ship` at 20, Ship with `human_approval` and the `merge` connector, Check with `agentPickup: 'allowed'` and no validators. It has no `package`, `validate` or `close`, so no `feeds` edge | If step 14 finds the Reviewer needs a stage before Check, a stage is added to the fixture then |
| S12-R4. `templatePersonas` gives the check-only template the two Reviewer fixtures and no Builder | A Builder on a check-only harness is a fix-claim question for step 17 |

**What this step hands to later steps (keep these names exactly):**

| Interface | Where | Consumed by |
|---|---|---|
| `capabilityWordSchema` now `['none', 'iterate', 'build', 'review', 'merge', 'fix']` | `packages/contracts/closed-sets.ts` | MD-2, FL-1 |
| `findingWeightSchema`, `FindingWeight`: `['real', 'plausible', 'theoretical']` | `packages/contracts/closed-sets.ts` | RV-1 |
| `untrustedSourceSchema`, `UntrustedSource`: `['pr_diff', 'issue_body', 'review_comment', 'page_from_agent']` | `packages/contracts/closed-sets.ts` | UC-1 |
| `templateKeySchema` now `['software', 'bml', 'check-only']` | `packages/contracts/commands.ts` | GL-2, GL-5 |
| `checkOnly: Template` with stage keys `check`, `ship` | `packages/harness/templates/check-only.ts`, exported from `packages/harness/index.ts` | GL-2, GL-3, DX-10 |
| Registry keys `finding-weight`, `untrusted-source` | `packages/contracts/registry.ts` | the fixture and lock tests |

---

## Global Constraints

Every task obeys every line here. The controller passes this section to each implementer.

**Where and how**

- Work only in the worktree for branch `build/v0.2.0` (created by the using-git-worktrees skill at the start of the build; the path is printed then). Never commit to `main`, never force-push, never `--no-verify`.
- Read `AGENTS.md` sections 1, 4 and 10 before the first edit. When this plan and `AGENTS.md` disagree, `AGENTS.md` wins; record the conflict in `docs/progress_tracker.md` and build the version that keeps the rule.
- Words come from `CONTEXT.md`. This step's words are **platform**, **check-only harness**, **finding weight**, **untrusted content**, **merge delegation**, **fix claim**. Never "the shared harness" for the product, never "fix lane" for the fix claim, never "watchdog".
- Commits: Conventional Commits, the agent as sole author, no attribution footer. Hooks always pass.

**Code rules (all mechanically enforced by `pnpm verify`)**

- TypeScript `strict`, no `any`, no `@ts-ignore`, no `as unknown as`.
- No code comments of any kind. Meaning goes into names, types, tests and `docs/`.
- Files under 500 lines; functions under 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters.
- Zod at every boundary. `packages/contracts` imports only `zod`.
- Every exported Zod schema in `packages/contracts` is registered in `packages/contracts/registry.ts` under a kebab-case key and has `fixtures/<key>/valid/*.json` and `fixtures/<key>/invalid/*.json` with at least one file each. The golden-fixture test enforces it.
- Any change to a closed set (any `z.enum` reachable from the registry) appends a full entry to `packages/contracts/contract-lock.json` and changes `CONTRACT_VERSION` in `packages/contracts/version.ts`. The lock test requires the last entry to equal the registry's enums exactly, and at least a minor bump when a value is added.

**Shared roots**

- `packages/contracts/` and `CONTEXT.md` are shared roots. Every change to one goes in its own commit, with no feature code in that commit, and the message names the root and why. Tasks 2 and 3 below are each one such commit. `packages/harness/templates/` is not a shared root.

**Tests**

- A test that proves a requirement has a `describe` or `it` title that starts with the requirement ID and a space, as `tools/trace/proofs.ts` reads it: `describe('DX-9 the trace reads the v0.2.0 requirements', …)`.
- Run a single file with `npx vitest run <path>`; the node project needs no database for anything in this step. Run `pnpm verify` before the final commit of the step; it needs `TEST_DATABASE_URL` pointing at a Postgres server (locally `postgres://postgres@127.0.0.1:54329/postgres` once `pg_ctl -D ~/.local/share/uw-platform-test-pg -o "-p 54329" start` has run).

## Review Focus

Inputs the spec implies that no task's tests would otherwise exercise, most likely to bite first. Each line names the task that pins it.

1. A requirement row in section 7.11 whose priority is `Should` must parse and must never count as a Must, or the guard either rejects the PRD or demands proof of a Should. Task 1 pins both.
2. A v0.2.0 step number that collides with a v1 step would make its IDs "due" and fail the guard on `main`. Task 1 pins that steps 12 to 20 exist and 1 to 11 contain no v0.2.0 ID.
3. A template with no `package` stage must still pass the template property and the walk, or the registry breaks `pnpm walk:all`. Task 4 pins both.
4. A capability word outside the set must still be refused by the delegation grant command's schema after the set grows. Task 2 pins `'deploy'` refused.
5. The lock must take a minor bump, not a patch, for the added values, or the lock test fails on the version line and the message is cryptic. Task 2's lock step says `12.2.0` and why.

---

### Task 1: DX-9, the trace reads the v0.2.0 requirements

**Files:**
- Modify: `tools/trace/trace.test.ts` (add one `describe` block at the end)

**Interfaces:**
- Consumes: `parseRequirements`, `parseBuildOrder` from `tools/trace/prd.ts`; `repositoryTrace` from `tools/trace/repository.ts`; `realPrd()` and `idsOfStep()` helpers already defined at the top of `trace.test.ts` (read lines 1 to 66 first and reuse them; do not redefine).
- Produces: the proof the trace counts for DX-9.

- [ ] **Step 1: Write the failing test**

Append to `tools/trace/trace.test.ts`:

```ts
describe('DX-9 the trace reads the v0.2.0 requirements', () => {
  const v2Prefixes = ['GL', 'MD', 'FL', 'UC', 'EI', 'SR', 'GD', 'RV', 'OB', 'PI'];
  const isV2 = (id: string) => v2Prefixes.includes(id.slice(0, 2)) || id === 'DX-9' || id === 'DX-10';

  it('parses every section 7.11 row, Must and Should, without counting a Should as a Must', () => {
    const requirements = parseRequirements(realPrd());
    const v2 = requirements.filter((requirement) => isV2(requirement.id));
    expect(v2.length).toBe(43);
    expect(v2.filter((requirement) => requirement.priority === 'Should').map((r) => r.id)).toEqual([
      'GL-5',
      'UC-5',
      'EI-5',
      'RV-3',
      'OB-4',
    ]);
    expect(v2.filter((requirement) => requirement.priority === 'Must').length).toBe(38);
  });

  it('places every v0.2.0 ID in a step from 12 to 20 and none in steps 1 to 11', () => {
    const steps = parseBuildOrder(realPrd());
    const placed = steps.flatMap((step) => step.ids.filter(isV2).map((id) => [id, step.step] as const));
    expect(placed.length).toBe(43);
    for (const [, step] of placed) expect(step).toBeGreaterThanOrEqual(12);
    for (const [, step] of placed) expect(step).toBeLessThanOrEqual(20);
    expect(idsOfStep(12)).toEqual(['DX-9']);
    expect(idsOfStep(20)).toEqual(['DX-10', 'GL-1']);
  });

  it('reports an unproven v0.2.0 Must as not yet due while its step is not built', () => {
    const report = repositoryTrace();
    const v2Unproven = report.unproven.filter((entry) => isV2(entry.id));
    for (const entry of v2Unproven) expect(entry.due).toBe(false);
    expect(traceExitCode(report, 'built')).toBe(0);
  });
});
```

If `idsOfStep` in the file takes a different shape than `(step: number) => string[]`, adapt the two calls to it rather than redefining it.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tools/trace/trace.test.ts -t "DX-9"`
Expected: the third `it` passes already (the guard was moved to built mode on `main`); the first two fail only if `idsOfStep(12)` lists more than `DX-9`, which happens because step 12's line in the PRD reads "DX-9 and the section 7.11 closed sets" and `idsIn` reads IDs only, so it should pass. If all three pass at once, that is the expected state: the test is the proof, and the step proceeds. Record in the tracker that the test was green on first run and why.

- [ ] **Step 3: Run the whole trace test file and the release guard**

Run: `npx vitest run tools/trace tools/release/criteria.test.ts`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tools/trace/trace.test.ts
git commit -m "test(trace): DX-9, the trace reads the v0.2.0 requirements and their steps"
```

---

### Task 2: The closed sets v0.2.0 consumes (own commit, shared root `packages/contracts`)

**Files:**
- Modify: `packages/contracts/closed-sets.ts` (capability words; two new enums and their types)
- Modify: `packages/contracts/registry.ts` (two registry keys)
- Modify: `packages/contracts/index.ts` (export the two new schemas and types, following how `capabilityWordSchema` is exported)
- Modify: `packages/contracts/contracts.test.ts:180` (the capability-word assertion) and the `closed sets` block
- Create: `packages/contracts/fixtures/finding-weight/valid/first.json`, `…/valid/last.json`, `…/invalid/unknown.json`
- Create: `packages/contracts/fixtures/untrusted-source/valid/first.json`, `…/valid/last.json`, `…/invalid/unknown.json`
- Modify: `packages/contracts/fixtures/capability-word/valid/last.json` (now `"fix"`)
- Modify: `packages/contracts/contract-lock.json` (append the `12.2.0` entry)
- Modify: `packages/contracts/version.ts` (`12.2.0`)

**Interfaces:**
- Produces: `capabilityWordSchema` with `merge` and `fix`; `findingWeightSchema`, `FindingWeight`; `untrustedSourceSchema`, `UntrustedSource`; registry keys `finding-weight`, `untrusted-source`.

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/contracts.test.ts`, change the capability-word line in `closed sets of the principal and the gate` to:

```ts
    expect(closedSets.capabilityWordSchema.options).toEqual([
      'none',
      'iterate',
      'build',
      'review',
      'merge',
      'fix',
    ]);
```

Add a new block after it:

```ts
describe('closed sets added for v0.2.0', () => {
  it('holds the finding weights and the untrusted sources the design names', () => {
    expect(closedSets.findingWeightSchema.options).toEqual(['real', 'plausible', 'theoretical']);
    expect(closedSets.untrustedSourceSchema.options).toEqual([
      'pr_diff',
      'issue_body',
      'review_comment',
      'page_from_agent',
    ]);
  });

  it('still refuses a capability word outside the set on a delegation grant', () => {
    const grant = {
      command: 'schedule_regular_tweak',
      requestId: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
      persona: 'agent:builder',
      capability: 'deploy',
      expiresAt: '2026-10-16T00:00:00.000Z',
      supersedes: null,
    };
    expect(commandSchema.safeParse(grant).success).toBe(false);
    expect(commandSchema.safeParse({ ...grant, capability: 'merge' }).success).toBe(true);
  });
});
```

The delegation grant command is `schedule_regular_tweak` in `packages/contracts/commands.ts` (its body is `persona`, `capability`, `expiresAt`, `supersedes`); a command envelope is flat, `{ command, requestId, ...body }`, as the `override` test in the same file shows. `commandSchema` is already imported there. If `personaIdentitySchema` refuses `'agent:builder'`, copy a persona identity string from `fixtures/persona-identity/valid/`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/contracts/contracts.test.ts -t "v0.2.0|capability"`
Expected: FAIL. The first on the new values; the second on `findingWeightSchema` being undefined.

- [ ] **Step 3: Add the sets**

In `packages/contracts/closed-sets.ts`, change the capability line and add two enums beside it:

```ts
export const capabilityWordSchema = z.enum(['none', 'iterate', 'build', 'review', 'merge', 'fix']);
export const findingWeightSchema = z.enum(['real', 'plausible', 'theoretical']);
export const untrustedSourceSchema = z.enum([
  'pr_diff',
  'issue_body',
  'review_comment',
  'page_from_agent',
]);
```

And the types, beside `CapabilityWord`:

```ts
export type FindingWeight = z.infer<typeof findingWeightSchema>;
export type UntrustedSource = z.infer<typeof untrustedSourceSchema>;
```

In `packages/contracts/registry.ts`, beside `'review-verdict': closedSets.reviewVerdictSchema,` add:

```ts
  'finding-weight': closedSets.findingWeightSchema,
  'untrusted-source': closedSets.untrustedSourceSchema,
```

In `packages/contracts/index.ts`, export the two schemas and two types the same way the file exports `capabilityWordSchema` and `CapabilityWord` (read the file; it may use `export * from './closed-sets.ts'`, in which case nothing is needed).

- [ ] **Step 4: Add the fixtures**

```bash
mkdir -p packages/contracts/fixtures/finding-weight/valid packages/contracts/fixtures/finding-weight/invalid
mkdir -p packages/contracts/fixtures/untrusted-source/valid packages/contracts/fixtures/untrusted-source/invalid
printf '"real"\n' > packages/contracts/fixtures/finding-weight/valid/first.json
printf '"theoretical"\n' > packages/contracts/fixtures/finding-weight/valid/last.json
printf '"severe"\n' > packages/contracts/fixtures/finding-weight/invalid/unknown.json
printf '"pr_diff"\n' > packages/contracts/fixtures/untrusted-source/valid/first.json
printf '"page_from_agent"\n' > packages/contracts/fixtures/untrusted-source/valid/last.json
printf '"zoom_transcript"\n' > packages/contracts/fixtures/untrusted-source/invalid/unknown.json
printf '"fix"\n' > packages/contracts/fixtures/capability-word/valid/last.json
```

- [ ] **Step 5: Append the lock entry and bump the version**

`packages/contracts/contract-lock.json` holds `{"versions": [ { "version", "sets" }, … ]}`; the lock test requires the last entry's `sets` to equal every `z.enum` in the registry, keyed by registry key, values in declaration order. Append a `12.2.0` entry by copying the `12.1.0` entry and changing exactly these keys:

```json
"capability-word": ["none", "iterate", "build", "review", "merge", "fix"],
"finding-weight": ["real", "plausible", "theoretical"],
"untrusted-source": ["pr_diff", "issue_body", "review_comment", "page_from_agent"]
```

Keys in each entry are sorted alphabetically (`currentSets()` sorts by key); place the two new keys in order. Do this with a short Node one-liner run from the repository root rather than by hand, so the copy is exact:

```bash
node -e '
const fs = require("node:fs");
const p = "packages/contracts/contract-lock.json";
const lock = JSON.parse(fs.readFileSync(p, "utf8"));
const last = lock.versions.at(-1);
const sets = { ...last.sets,
  "capability-word": ["none", "iterate", "build", "review", "merge", "fix"],
  "finding-weight": ["real", "plausible", "theoretical"],
  "untrusted-source": ["pr_diff", "issue_body", "review_comment", "page_from_agent"] };
const sorted = Object.fromEntries(Object.entries(sets).sort(([a], [b]) => a.localeCompare(b)));
lock.versions.push({ version: "12.2.0", sets: sorted });
fs.writeFileSync(p, JSON.stringify(lock, null, 2) + "\n");
'
npx prettier --write packages/contracts/contract-lock.json
```

Then in `packages/contracts/version.ts`: `export const CONTRACT_VERSION = '12.2.0';`. A minor bump, because values were added and none removed (S12-R1).

- [ ] **Step 6: Run the contracts tests**

Run: `npx vitest run packages/contracts`
Expected: all green, including `golden fixtures`, `CT-3 the contract lock` and `contract version`.

- [ ] **Step 7: Find every pin of the contract version outside the package**

```bash
grep -rn "12\.1\.0" --include='*.ts' --include='*.json' --include='*.sql' --include='*.md' packages apps sim tools docs | grep -v node_modules | grep -v contract-lock.json
```

Expected: hits only in `docs/progress_tracker.md` history rows, which stay as history. If a `.ts` or `.sql` file pins `12.1.0` (the v1 build added "the event-name and command-name checks admit contract 12.1.0" in `packages/db`), read that file: if it asserts the live version by calling `assertLiveContractVersion`, change its pinned string to `12.2.0` in this same commit and say so in the commit body; if it only lists event or command names, leave it, since none changed.

- [ ] **Step 8: Run the full check and the architecture gate**

Run: `pnpm check && pnpm lint && pnpm architecture`
Expected: green.

- [ ] **Step 9: Commit (shared root)**

```bash
git add packages/contracts
git commit -m "feat(contracts): capability words merge and fix, finding weight, untrusted source (12.2.0)

Shared root packages/contracts. The sets steps 13 to 17 consume, added
before any consumer so each later step touches this root at most once.
Additive, so a minor version. S12-R1, S12-R2."
```

If Step 7 changed a file outside `packages/contracts`, add it to the same commit and name it in the body.

---

### Task 3: The check-only template key (own commit, shared root `packages/contracts`)

**Files:**
- Modify: `packages/contracts/commands.ts:48` (`templateKeySchema`)
- Create: `packages/contracts/fixtures/template-key/valid/check-only.json`
- Modify: `packages/contracts/contract-lock.json` (append `12.3.0`)
- Modify: `packages/contracts/version.ts` (`12.3.0`)

**Interfaces:**
- Produces: `templateKeySchema` with `'check-only'`; `TemplateKey` includes it.

The template itself is Task 4; this task is the contracts half, kept separate because the root takes its own commit. Between Task 3 and Task 4 the test `the template keys a command may name are the templates registry` is red; Task 4 makes it green. Do Tasks 3 and 4 back to back.

- [ ] **Step 1: Write the failing test**

In `packages/contracts/contracts.test.ts`, inside `closed sets added for v0.2.0`:

```ts
  it('names the check-only template', () => {
    expect(templateKeySchema.options).toEqual(['software', 'bml', 'check-only']);
  });
```

Import `templateKeySchema` from `./commands.ts` if the file does not already.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run packages/contracts/contracts.test.ts -t "check-only"`
Expected: FAIL on the missing value.

- [ ] **Step 3: Add the key, the fixture and the lock entry**

`packages/contracts/commands.ts`:

```ts
export const templateKeySchema = z.enum(['software', 'bml', 'check-only']);
```

```bash
printf '"check-only"\n' > packages/contracts/fixtures/template-key/valid/check-only.json
node -e '
const fs = require("node:fs");
const p = "packages/contracts/contract-lock.json";
const lock = JSON.parse(fs.readFileSync(p, "utf8"));
const last = lock.versions.at(-1);
lock.versions.push({ version: "12.3.0", sets: { ...last.sets, "template-key": ["software", "bml", "check-only"] } });
fs.writeFileSync(p, JSON.stringify(lock, null, 2) + "\n");
'
npx prettier --write packages/contracts/contract-lock.json
```

`packages/contracts/version.ts`: `'12.3.0'`. Repeat Task 2 Step 7's grep for `12.2.0` and treat any hit the same way.

- [ ] **Step 4: Run the contracts tests**

Run: `npx vitest run packages/contracts`
Expected: green.

- [ ] **Step 5: Commit (shared root)**

```bash
git add packages/contracts
git commit -m "feat(contracts): the check-only template key (12.3.0)

Shared root packages/contracts. GL-2's template is registered in the
harness in the next commit; the key lands first so the two halves are
each one commit."
```

---

### Task 4: The check-only template in the harness registry

**Files:**
- Create: `packages/harness/templates/check-only.ts`
- Modify: `packages/harness/templates.ts` (register it)
- Modify: `packages/harness/index.ts:56-57` (export it beside `software` and `bml`)
- Modify: `packages/harness/templates/personas.ts:186-189` (`templatePersonas` entry)
- Create: `packages/harness/templates/check-only.test.ts`

**Interfaces:**
- Consumes: `Template`, `TemplateStage` from `./types.ts`; `templateProperty` from `../template-property.ts`; `templates` from `../templates.ts`; `reviewer`, `reviewerCodex` persona fixtures in `personas.ts` (module-private consts; the entry is added inside that file).
- Produces: `checkOnly: Template` with `key: 'check-only'`, stages `check` (position 10) and `ship` (position 20).

- [ ] **Step 1: Write the failing tests**

`packages/harness/templates/check-only.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { templateKeySchema } from '@uw/contracts';
import { connectorRegistered, connectorRegistry } from '../connectors/registry.ts';
import { templateProperty } from '../template-property.ts';
import { templates } from '../templates.ts';
import { validatorRegistry } from '../validators/registry.ts';
import { checkOnly } from './check-only.ts';
import { personasOf } from './personas.ts';

describe('GL-2 the check-only template has Check and Ship and nothing before them', () => {
  it('has two stages, check then ship, gapped by 10 with WIP 3', () => {
    expect(checkOnly.key).toBe('check-only');
    expect(checkOnly.stages.map((stage) => stage.key)).toEqual(['check', 'ship']);
    expect(checkOnly.stages.map((stage) => stage.position)).toEqual([10, 20]);
    expect(checkOnly.stages.map((stage) => stage.wipLimit)).toEqual([3, 3]);
  });

  it('lets agents pick up Check and never Ship', () => {
    const [check, ship] = checkOnly.stages;
    expect(check?.agentPickup).toBe('allowed');
    expect(check?.exitGate).toBe('checks');
    expect(check?.connector).toBe('none');
    expect(ship?.agentPickup).toBe('none');
  });

  it('gates Ship on a human_approval exit with the merge connector and no feeds', () => {
    const ship = checkOnly.stages.find((stage) => stage.key === 'ship');
    expect(ship?.exitGate).toBe('human_approval');
    expect(ship?.connector).toBe('merge');
    expect(checkOnly.stages.every((stage) => stage.feeds.length === 0)).toBe(true);
  });

  it('passes the template property', () => {
    expect(templateProperty(checkOnly.stages)).toEqual([]);
  });

  it('names only registered validators and connectors', () => {
    for (const stage of checkOnly.stages) {
      for (const key of stage.validators) expect(validatorRegistry.has(key)).toBe(true);
      expect(connectorRegistered(stage.connector, connectorRegistry)).toBe(true);
    }
  });

  it('is registered under the key the command schema names, with the two Reviewer personas', () => {
    expect(templates.get('check-only')).toBe(checkOnly);
    expect(templateKeySchema.options).toContain('check-only');
    expect(personasOf('check-only').map((persona) => persona.slug)).toEqual([
      'reviewer',
      'reviewer-codex',
    ]);
  });
});
```

Before relying on the slugs `'reviewer'` and `'reviewer-codex'`, read `personas.ts` and use the exact `slug` values of the two Reviewer fixtures.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/harness/templates/check-only.test.ts`
Expected: FAIL, `./check-only.ts` not found.

- [ ] **Step 3: Write the template**

`packages/harness/templates/check-only.ts`:

```ts
import type { Template, TemplateStage } from './types.ts';

const check: TemplateStage = {
  key: 'check',
  title: 'CI and review verdict',
  position: 10,
  bracket: 'build_package',
  agentPickup: 'allowed',
  exitGate: 'checks',
  connector: 'none',
  validators: [],
  feeds: [],
  wipLimit: 3,
};

const ship: TemplateStage = {
  key: 'ship',
  title: 'Merge',
  position: 20,
  bracket: 'deploy_package',
  agentPickup: 'none',
  exitGate: 'human_approval',
  connector: 'merge',
  validators: [],
  feeds: [],
  wipLimit: 3,
};

export const checkOnly: Template = {
  key: 'check-only',
  title: 'Review and merge only',
  stages: [check, ship],
};
```

`packages/harness/templates.ts`:

```ts
import { bml } from './templates/bml.ts';
import { checkOnly } from './templates/check-only.ts';
import { software } from './templates/software.ts';
import type { Template } from './templates/types.ts';

export type { Template };

export const templates: ReadonlyMap<string, Template> = new Map<string, Template>([
  [software.key, software],
  [bml.key, bml],
  [checkOnly.key, checkOnly],
]);
```

`packages/harness/index.ts`, beside the `bml` export:

```ts
export { checkOnly } from './templates/check-only.ts';
```

`packages/harness/templates/personas.ts`, the record:

```ts
export const templatePersonas: Readonly<Record<TemplateKey, readonly PersonaFixture[]>> = {
  software: [builder, builderHosted, reviewer, reviewerCodex],
  bml: [iterate],
  'check-only': [reviewer, reviewerCodex],
};
```

- [ ] **Step 4: Run the new tests, the template tests and the property test**

Run: `npx vitest run packages/harness/templates packages/harness/template-property.test.ts`
Expected: green. `KN-10 every registered template reaches an effect only after a human_approval exit` now runs three templates.

- [ ] **Step 5: Walk it**

Run: `pnpm walk -- check-only` and `pnpm walk:all`
Expected: `check-only` lists exactly one path to an effect, `check → ship`, crossing `ship` with `human_approval`; `walk:all` prints all three templates and exits 0.

- [ ] **Step 6: Run the KN-15 scenario and the sim**

Run: `pnpm sim -- KN-15` then `pnpm sim -- all`
Expected: green. KN-15 names `software` and `bml` explicitly and is unaffected. If any scenario or test enumerates `templates` and asserts eight stages or a `package` stage, it is a defect in that test's premise, not in the template: list it in the tracker under "Not verified" with its path and fix the assertion to iterate `[software, bml]`, in the same commit, and say so in the body.

- [ ] **Step 7: Commit**

```bash
git add packages/harness/templates/check-only.ts packages/harness/templates/check-only.test.ts packages/harness/templates.ts packages/harness/index.ts packages/harness/templates/personas.ts
git commit -m "feat(harness): the check-only template, Check and Ship with the merge connector

GL-2's template half. Registered beside software and bml, walked, and
proven against the template property. The kickstart refusal and the
harness behaviour on it are step 14. S12-R3, S12-R4."
```

---

### Task 5: Verify, record, push

**Files:**
- Modify: `docs/progress_tracker.md` (step 12 row; a rulings table for S12; the Not verified table if Task 4 Step 6 found anything)

- [ ] **Step 1: Run the whole chain**

Run with `TEST_DATABASE_URL` set: `pnpm verify`
Expected: green. Note the test count and scenario count from the output.

- [ ] **Step 2: Update the tracker**

In `docs/progress_tracker.md`, change the step 12 row's state from `Not started` to `Built` and its evidence to: the commit SHAs of Tasks 1 to 4, the test files named for DX-9 and GL-2, `pnpm verify` green locally with the counts, and "CI not run" or the CI run id if Actions billing is fixed by then. Under the step's heading in the rulings section (follow the shape of the S11 rows: `| date | requirement | ruling | cost if wrong |`), add S12-R1 to S12-R4 from the top of this plan. If Task 1 Step 2 passed on first run, add one line saying so and why.

- [ ] **Step 3: Commit and push; open the draft pull request if this is the first push of the branch**

```bash
git add docs/progress_tracker.md
git commit -m "docs(tracker): step 12 is built"
git push -u origin build/v0.2.0
gh pr create --draft --base main --head build/v0.2.0 --title "feat: harness v0.2.0 build (step 12, words and contracts)" --body "Draft pull request for the v0.2.0 build on build/v0.2.0. Design: docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md. Requirements built so far: DX-9, GL-2 (template half). Evidence, rulings and what was not verified are in docs/progress_tracker.md."
```

If the pull request already exists, push only.

---

## Self-review

**Spec coverage.** Step 12 in PRD section 13 names DX-9 and "the section 7.11 closed sets, finding weight, the check-only template fixture, contract 13.0.0". DX-9: Task 1. Finding weight and the other sets: Task 2. The template fixture: Tasks 3 and 4. Contract 13.0.0: deferred to step 15 by S12-R1, recorded. Ship refusals, events and wake reasons: deferred by S12-R2 to their emitting steps, recorded.

**Placeholders.** None; every step carries its code or its command.

**Type consistency.** `checkOnly` is the export name in Task 4 and in the hand-off table; `findingWeightSchema` and `untrustedSourceSchema` match between Task 2's code, tests and registry keys; `templateKeySchema` is changed in Task 3 and asserted in Tasks 3 and 4.

**Review Focus.** Lines 1 and 2 are pinned by Task 1; line 3 by Task 4 Steps 4 and 5; line 4 by Task 2 Step 1's second test; line 5 by Task 2 Step 5's version note.
