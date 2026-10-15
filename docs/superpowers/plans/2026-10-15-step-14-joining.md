# Step 14, Joining: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real repository can join the platform the way design section 4 describes: an admin activates a check-only harness in shadow mode, a review request on a pull request enqueues one item at Check, the Reviewer's verdict and the ship rule's verdict are recorded and nothing is written to GitHub, the Gates view compares those verdicts with other reviewers' on the same head, an admin lifts shadow, an external reviewer's approval counts by configuration, and no agent is dispatched onto a repository the area's platform page does not list.

**Architecture:** Additive throughout. The contracts gain four refusal reasons, three events, one command, one page type and three shapes in one shared-root commit; the database gains three columns and the regenerated name checks in one migration; the Store gains three gateway methods behind the port contract. The kernel gains a join command (`items.join`), a dispatch guard on agent claims, a shadow branch in `postReview`, a shadow-verdict recorder (`gates.recordShadowVerdicts`) built on the existing `shipPreview`, a shadow refusal in `decide`, a lift command (`stages.liftShadow`) and one view (`views.shadow`). The app follows every pull-request upsert (webhook and sweep) with a join attempt and a shadow-verdict attempt, refuses `kickstart` on a harness with no Package stage, serves the export route, and adds the shadow section to the Gates screen. External reviewer approvals count through one function the ship-rule input and the gate view share.

**Tech Stack:** TypeScript strict, Zod 4, Drizzle and drizzle-kit, Vitest 4 (node project and the Postgres service), Hono JSX for the Gates screen, the sim over the embedded Postgres Store.

**Spec:** `docs/PRD.md` section 7.11 (GL-2, GL-3, GL-4, GL-6, OB-3, PI-1), sections 8.1, 8.5, 8.6 and 13 (step 14); the design is `docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` sections 4, 5.1, 5.8, 5.9, 6 and 7.

**Requirements covered:** GL-2 (the `kickstart` refusal and "no Package page"; the template fixture is step 12), GL-3, GL-4, GL-6, OB-3, PI-1. All six are Must.

**Rulings made while planning** (recorded here and in `docs/progress_tracker.md` by the last task):

| Ruling | Cost if wrong |
|---|---|
| S14-R1. Shadow is set at activation: `activate_template` gains `shadow` (default `false`), recorded on `template_activated` as `shadow`. `set_shadow` takes `{ shadow: false }` only and records `shadow_lifted {}`; a second lift is accepted and records nothing. Re-entering shadow on a live harness is not built | An admin who wants an existing harness back in shadow waits for an additive command that accepts `true` |
| S14-R2. `external_reviewer_identities` is set at activation (`activate_template.externalReviewerIdentities`, default `[]`, at most 20 GitHub logins, distinct in any case). A login that is, or folds to, a platform Reviewer identity is refused `malformed_command` | Changing the list on a live harness needs a later command; the pilot harness is created after the tag, so it is set once |
| S14-R3. "The platform page for the area" is a new page type `platform`, gated like `skill` and `learning`, at the fixed slug `platform` in the area, frontmatter `{ dispatch_allowed: repository[] }` (at most 200, distinct in any case). Only an `active` page counts; a person activates it with `confirm_page`, which needs `write` on the area. A missing page, a page short of `active`, or frontmatter that does not parse means the list cannot be read | If the platform plan later names another home for area settings, one page type and one Store read move. An area editor, not only an admin, can change the list |
| S14-R4. The dispatch gate applies to agent claims (every `claim` by an agent identity, which includes a run start through `claimWithin`) and to joining. Person claims and harnesses that name no repository are not gated. A database error while reading the list aborts the claim's transaction, so it fails closed as `internal_error`, not as `dispatch_list_unavailable` | A person can still work a repository that is not on the list by hand, which is the intent: dispatch means handing work to an agent |
| S14-R5. Joining needs a platform Reviewer login (`uw-reviewer[bot]` or `uw-reviewer-codex[bot]`) among the pull request's requested reviewers, an open pull request, a harness on the repository with no `product_package` stage and a `check` stage, and the repository on the dispatch list. A harness with a Package stage refuses `transition_not_allowed` (`why: harness_has_package`). "Once" means one item per pull request per harness, whatever its state. The expected head is the head at joining; a later push is not followed in this step | A pull request pushed after it joined keeps its first head: the Reviewer reviews that head and Ship refuses `head_mismatch` until a person takes it over. Following the head on a check-only harness is listed below for a later step |
| S14-R6. A joined item is the only kind with a pull request and `branch_state` `none`, so `usableHead` skips the `harness/<item>` head-ref check for exactly that combination; every other item still needs its harness branch. Fork pull requests are still refused (the head repository must be the harness repository) | If a later step creates items with a pull request and no harness branch for another reason, they inherit the relaxation; the test in Task 7 pins the combination |
| S14-R7. In shadow the Reviewer's run completes `review_withheld` with its review record (`reviewId: null`) after a `review_verdict_recorded` event. No run result is added | A reader counting withheld reviews also counts shadow ones; the event tells them apart |
| S14-R8. The shadow verdict is `shipPreview` over the read-model facts with the Reviewer's recorded verdicts added as if posted, minus `approver_lacks_domain_grant` (shadow has no approver). It is recorded as `shadow_verdict` after every pull-request upsert the facts module reports and after every recorded Reviewer verdict, and only when its head, verdict or reasons differ from the item's last one | A rule that depends on who approves is not visible in shadow; the comparison covers what the rule says about the change |
| S14-R9. On a shadow harness an `approve` or `override` at a connector stage is refused `not_permitted` (`why: shadow`) before any gate decision is written; `reject` and `take_over` still work | A person cannot rehearse the merge click in shadow; they lift shadow first |
| S14-R10. OB-3 compares the Reviewer's recorded verdict on a head with each other reviewer's latest decisive GitHub review on the same head: `approve` against `changes_requested`, or `request_changes` against `approved`, is a disagreement. The ship rule's shadow verdict is shown beside it, not compared. Rows cover the last 30 days, at most `VIEW_LIMIT` events. Reading needs `read` on the area. The export is `GET /api/harness/:harness/shadow`, the JSON `shadow-comparison` | A person who wanted the ship-rule verdict compared with the bench's merge decision reads two columns instead of one flag |
| S14-R11. An external approval's reviewer key is the login lowercased without its `[bot]` suffix, and its provider is `external`. Two external reviewers share that provider, so they never satisfy distinctness on their own | A high-tier change approved only by two external reviewers refuses `reviewer_providers_not_distinct`; that is the rule as written |
| S14-R12. Requested reviewers are a facts column, `gh_prs.requested_reviewers text[]`, written by the facts module from the REST pull and the webhook payload. The join and the shadow verdict follow every upsert through `followUpserts`, so the webhook path joins as soon as the request lands and the nightly sweep catches what it missed | One more column on a read-model table; a review request that GitHub drops from the payload once the reviewer submits leaves the item joined, which is what "once" wants |
| S14-R13. The contract moves one minor version for the whole step (everything is additive; new fields carry defaults). Step 15 still takes 13.0.0 for RV-1 | None; the lock test enforces the rule |

**What this step hands to later steps (keep these names exactly):**

| Interface | Where | Consumed by |
|---|---|---|
| `errorReasonSchema` gains `template_has_no_package`, `no_harness_for_repo`, `repository_not_dispatchable`, `dispatch_list_unavailable` | `packages/contracts/outcomes.ts` | GL-5, EI-2 |
| Events `review_verdict_recorded`, `shadow_verdict`, `shadow_lifted` and their evidence | `packages/contracts/events.ts`, `event-evidence.ts` | DX-10, RV-1 (weight joins the recorded findings), OB-1 |
| Command `set_shadow` (`{ shadow: false }`), `activate_template.shadow`, `activate_template.externalReviewerIdentities` | `packages/contracts/commands.ts` | DX-10, GL-5 |
| `Harness.shadow`, `Harness.externalReviewerIdentities`; `githubLoginSchema`, `externalReviewerIdentitiesSchema` | `packages/contracts/harness.ts` | GD-2 (beside `frozen`), OB-4 |
| `item_created.pullRequest`, `item_created.expectedHead` (default `null`) | `packages/contracts/event-evidence.ts` | EI-3 |
| Page type `platform`, `platformPageSlug`, `platformFrontmatterSchema` | `packages/contracts/pages.ts`, `page-types.ts` | any area-level setting |
| `shadowComparisonSchema`, `ShadowComparison` | `packages/contracts/shadow.ts` | OB-3's export, DX-10 |
| `items.join(caller, JoinInput)` returning `Joined` | `packages/harness/items/join.ts` | EI-3 (a sibling path), DX-10 |
| `dispatchRefusal(tx, harness)` | `packages/harness/items/dispatch.ts` | FL-2, EI-4 |
| `hasPackageStage(stages)` | `packages/harness/stages/package.ts`, exported | GL-5 |
| `stages.liftShadow(caller, { harnessId })` | `packages/harness/stages/shadow.ts` | DX-10 |
| `gates.recordShadowVerdicts(caller, { pullRequest })` | `packages/harness/gates/shadow.ts` | SR-1, SR-2 (their reasons appear in shadow verdicts for free) |
| `views.shadow(caller, { harnessId }, options)` | `packages/harness/views/shadow.ts` | DX-10 |
| `countedReviewer(login, external)`, `requestsPlatformReviewer(logins)`, `EXTERNAL_PROVIDER` | `packages/harness/github/reviewers.ts` | MD-3 |
| Store: `harnessItems.read.byPullRequest`, `pages.read.platformFor`, `harnesses.write.setShadow` | `packages/harness/store-ports.ts`, `packages/db/store/` | EI-3, GD-2 |
| `seedPlatformPage(db, seed)`; `createSimHarness` options `shadow`, `externalReviewerIdentities`, `dispatchable` | `packages/db/test-seed.ts`, `sim/fixtures.ts` | every later sim test on a harness with a repository |

**Left for later steps, found while planning (recorded in the tracker by Task 12):**

1. The merge connector (`apps/uw-app/github/merge.ts`, `tagOf`) refuses any head ref that is not `harness/<item>` (`head_ref_mismatch`), so a joined pull request cannot merge at Ship yet. Steps 16 or 20 (DX-10's "merge under a delegation") must teach it the S14-R6 combination.
2. `checksNotGreen` requires this repository's six CI job names (`ciJobSchema`) from `github-actions`. A joined repository with other job names gets `checks_not_green` in every shadow verdict. SR-1 (step 15, `required_check_never_ran`) is where required checks become per repository.
3. Nothing moves a joined item from Check to Ship except a person's `submit_to_gate`. DX-10 (step 20) decides whether a posted approval advances it.
4. A push after joining is not followed (S14-R5).

---

## Global Constraints

Every task obeys every line here. The controller passes this section to each implementer.

**Where and how**

- Work only in `/home/ianjl/projects/uw-platform-v0.2.0`, branch `build/v0.2.0`. Never commit to `main`, never force-push, never `--no-verify`.
- Read `AGENTS.md` sections 1, 4 and 10 before the first edit. When this plan and `AGENTS.md` disagree, `AGENTS.md` wins; record the conflict in `docs/progress_tracker.md` and build the version that keeps the rule.
- Words come from `CONTEXT.md`: **platform**, **check-only harness**, **shadow mode**, **holder**. Never "the shared harness", "dry run" or "read-only mode" for shadow, never "review service" or "opt-in review" for a check-only harness.
- Commits: Conventional Commits, the agent as sole author, no attribution footer. Hooks always pass. Put the requirement IDs in each commit body.

**Code rules (all mechanically enforced by `pnpm verify`)**

- TypeScript `strict`, no `any`, no `@ts-ignore`, no `as unknown as`, no non-null assertion.
- No code comments of any kind.
- Files under 500 non-blank lines; functions under 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters. `apps/uw-app/github/facts/upsert.ts` (496 lines) and `apps/uw-app/github/sweep.ts` (491) are near the limit: Task 9 adds at most three lines to `upsert.ts` and none to `sweep.ts`.
- Zod at every boundary. `packages/contracts` imports only `zod`. `packages/harness` imports nothing from Workers, Drizzle or the network.
- Every exported Zod schema registered in `packages/contracts/registry.ts` has `fixtures/<key>/valid/*.json` and `fixtures/<key>/invalid/*.json`. Any change to a registered `z.enum` appends a full entry to `packages/contracts/contract-lock.json` and changes `CONTRACT_VERSION`.
- Every route and command has `can()` on the harness's area, directly or through a kernel read the route test recognises (`kernel.views.*`, `kernel.reads.*`, `executeCommand`).
- `gate_decisions` is never written by anything this step adds.
- UI: tokens only, sentence case, second person, no exclamation marks; Kindle orange marks a human action and nothing else, so the shadow list uses no Kindle; every control has an accessible name; light, dark and phone width hold.

**Contract version**

- At the time of planning `packages/contracts/version.ts` reads `12.2.0` and step 12 (in flight) ends at `12.3.0`; step 13 may or may not bump. Task 1 reads the version at execution and moves it to the next minor (expected `12.4.0`). Every later mention of "the step's version" means that value.

**Shared roots**

- `packages/contracts/` (Task 1), `packages/db/schema.ts` and `packages/db/schema-github.ts` with the migration (Task 2), `packages/harness/store-ports.ts` (Task 3), and the `tools/architecture/` allowlist (Task 8) are shared roots. Each change to one is its own commit with no feature code, and the message names the root and why. `packages/db/store/`, `packages/db/test-seed.ts`, `apps/uw-app/generated/islands.ts` and the sim are not shared roots.
- Between Task 1 and Task 2 the drift test (`tools/db/drift.test.ts`) is red, because the schema's name checks derive from the enums. Do Tasks 1 and 2 back to back.

**Tests**

- A test that proves a requirement has a `describe` or `it` title that starts with the requirement ID and a space, as `tools/trace/proofs.ts` reads it. A scenario's `id` is the requirement ID.
- Run one file with `npx vitest run <path>`. Database tests (`*.pg.test.ts`, `packages/db` targets, the Store contract on the platform adapter) need `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres`, after `pg_ctl -D ~/.local/share/uw-platform-test-pg -o "-p 54329" start`. Never run two Vitest suites at once on this machine (WSL runs out of memory); `pnpm verify` runs them in sequence.

## Review Focus

Inputs the spec implies that no requirement row spells out, most likely to bite a person first. Each line names the task that pins it.

1. A pull request whose review is requested again (after a push, or by a second person) must not create a second item. Task 7 pins a second `join` returning the first item with `created: false` and one `item_created`.
2. A platform page an agent wrote lands `suggested`; it must never open dispatch. Task 6 pins a `suggested` page and a page with malformed frontmatter both refusing `dispatch_list_unavailable`.
3. External logins arrive in any case and with or without `[bot]`. Task 10 pins `UWReview[bot]` counting against a configured `uwreview[bot]` once, and Task 4 pins activation refusing an external login that names a platform Reviewer.
4. The sweep reports the same pull request night after night; the shadow verdict must not grow by one event a night. Task 8 pins a repeated `recordShadowVerdicts` with no change appending nothing.
5. A person clicking approve at Ship on a shadow harness must leave no `gate_decisions` row and call no connector. Task 8 pins the refusal, the empty decision list and both empty connector recordings.

---

### Task 1: The contracts for joining (shared root `packages/contracts`)

**Files:**
- Modify: `packages/contracts/outcomes.ts` (four reasons at the end of `errorReasonSchema`)
- Modify: `packages/contracts/events.ts` (three names at the end of `eventNames`)
- Modify: `packages/contracts/event-evidence.ts` (`item_created`, `template_activated`, three new evidence schemas)
- Modify: `packages/contracts/commands.ts` (`set_shadow`; `activate_template` fields)
- Modify: `packages/contracts/harness.ts` (`githubLoginSchema`, `externalReviewerIdentitiesSchema`, two `harnessSchema` fields)
- Modify: `packages/contracts/pages.ts` (`'platform'` in `pageTypes`)
- Modify: `packages/contracts/page-types.ts` (`platformPageSlug`, `platformFrontmatterSchema`, registry entry)
- Create: `packages/contracts/shadow.ts`
- Modify: `packages/contracts/index.ts` (`export * from './shadow.ts';`)
- Modify: `packages/contracts/registry.ts` (`github-login`, `platform-frontmatter`, `shadow-comparison`)
- Create: fixtures (Step 5)
- Modify: `packages/contracts/events.test.ts:31-35`, `packages/contracts/contracts.test.ts` (new block)
- Modify: `packages/contracts/contract-lock.json`, `packages/contracts/version.ts`
- Second commit, not a shared root: `packages/harness/items/fold.ts` (`unchangedNames`), `apps/uw-app/pages/gating.ts`, `apps/uw-app/commands/registry.ts`, `apps/uw-app/commands/registry.test.ts`, `apps/uw-app/generated/islands.ts` (regenerated)

**Interfaces:**
- Produces: everything in the hand-off table that lives in `packages/contracts`. `CommandBody<'set_shadow'>` is `{ command: 'set_shadow'; requestId: string; shadow: false }`. `EventEvidence['shadow_verdict']` is `{ head: string | null; verdict: 'advance' | 'refuse'; reasons: ShipRefusal[] }`. `EventEvidence['review_verdict_recorded']` is `{ runId, head, reviewer, provider, model, verdict, findings }`. `Harness` gains `shadow: boolean` and `externalReviewerIdentities: string[]`.

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/events.test.ts`, change the vocabulary test:

```ts
  it('has the fifty-seven names and none of the placeholders it replaces', () => {
    expect(eventNameSchema.options).toHaveLength(57);
    expect(eventNameSchema.safeParse('stage_edited').success).toBe(true);
    expect(eventNameSchema.options[0]).toBe('item_created');
    expect(eventNameSchema.options.at(-1)).toBe('shadow_lifted');
    expect(eventNameSchema.safeParse('abandoned').success).toBe(false);
    expect(eventNameSchema.safeParse('branch_abandoned').success).toBe(true);
  });
```

If step 12 or 13 changed the count, use the count on disk plus three and keep the rest.

Append to `packages/contracts/contracts.test.ts` (import `commandSchema`, `errorReasonSchema`, `eventEvidenceSchemas`, `harnessSchema`, `pageTypeSchema`, `platformFrontmatterSchema`, `shadowComparisonSchema` from the package's own files the way the file already imports its neighbours):

```ts
describe('GL-2 GL-3 GL-4 GL-6 OB-3 PI-1 the contracts for joining', () => {
  const requestId = '00000000-0000-4000-8000-0000000000aa';
  const head = 'a'.repeat(40);

  it('names the four refusals joining and dispatch need', () => {
    expect(errorReasonSchema.options.slice(-4)).toEqual([
      'template_has_no_package',
      'no_harness_for_repo',
      'repository_not_dispatchable',
      'dispatch_list_unavailable',
    ]);
  });

  it('lifts shadow and never sets it on a live harness', () => {
    const lift = { command: 'set_shadow', requestId, shadow: false };
    expect(commandSchema.safeParse(lift).success).toBe(true);
    expect(commandSchema.safeParse({ ...lift, shadow: true }).success).toBe(false);
  });

  it('activates a harness in shadow with external reviewers, and defaults both off', () => {
    const base = {
      command: 'activate_template',
      requestId,
      harnessKey: 'tc-admin-app',
      jdArea: '80-89',
      template: 'check-only',
      repository: 'unfoldingWord/tc-admin-app',
    };
    expect(commandSchema.parse(base)).toMatchObject({ shadow: false, externalReviewerIdentities: [] });
    const shadowed = { ...base, shadow: true, externalReviewerIdentities: ['uwreview[bot]'] };
    expect(commandSchema.safeParse(shadowed).success).toBe(true);
    const twice = { ...base, externalReviewerIdentities: ['uwreview[bot]', 'UWReview[bot]'] };
    expect(commandSchema.safeParse(twice).success).toBe(false);
  });

  it('reads an older harness row as not in shadow with no external reviewers', () => {
    const older = {
      id: '00000000-0000-4000-8000-0000000000a1',
      key: 'software',
      template: 'software',
      jdArea: '80-89',
      repository: 'unfoldingWord/uw-platform',
      hostedBuilderEnabled: false,
      paused: false,
    };
    expect(harnessSchema.parse(older)).toMatchObject({ shadow: false, externalReviewerIdentities: [] });
  });

  it('carries a joined pull request and its head on item_created, together or not at all', () => {
    const created = { stage: 'check', title: 'Fix the login form', pageId: null, priority: 0, due: null };
    const pullRequest = { repo: 'unfoldingWord/tc-admin-app', number: 12 };
    const schema = eventEvidenceSchemas.item_created;
    expect(schema.parse(created)).toMatchObject({ pullRequest: null, expectedHead: null });
    expect(schema.safeParse({ ...created, pullRequest, expectedHead: head }).success).toBe(true);
    expect(schema.safeParse({ ...created, pullRequest, expectedHead: null }).success).toBe(false);
  });

  it('knows the platform page type and its dispatch list', () => {
    expect(pageTypeSchema.options).toContain('platform');
    const list = { dispatch_allowed: ['unfoldingWord/tc-admin-app'] };
    expect(platformFrontmatterSchema.safeParse(list).success).toBe(true);
    const repeated = { dispatch_allowed: ['unfoldingWord/a', 'UNFOLDINGWORD/A'] };
    expect(platformFrontmatterSchema.safeParse(repeated).success).toBe(false);
  });

  it('bounds a shadow comparison row', () => {
    const row = {
      itemId: '00000000-0000-4000-8000-0000000000b1',
      title: 'Fix the login form',
      pullRequest: { repo: 'unfoldingWord/tc-admin-app', number: 12 },
      head,
      shadow: { verdict: 'refuse', reasons: ['checks_not_green'] },
      reviewer: { reviewer: 'uw-reviewer', verdict: 'approve', findings: [] },
      github: [{ reviewer: 'uwreview[bot]', state: 'changes_requested' }],
      disagrees: true,
    };
    const comparison = {
      harnessId: '00000000-0000-4000-8000-0000000000a1',
      harnessKey: 'tc-admin-app',
      shadow: true,
      capped: false,
      rows: [row],
    };
    expect(shadowComparisonSchema.safeParse(comparison).success).toBe(true);
    const commented = { ...row, github: [{ reviewer: 'x', state: 'commented' }] };
    expect(shadowComparisonSchema.safeParse({ ...comparison, rows: [commented] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/contracts/contracts.test.ts packages/contracts/events.test.ts`
Expected: FAIL. The count is 54, `platformFrontmatterSchema` and `shadowComparisonSchema` are undefined, `set_shadow` is not a command.

- [ ] **Step 3: Write the contracts**

`packages/contracts/outcomes.ts`, after `'dry_run_failed',`:

```ts
  'template_has_no_package',
  'no_harness_for_repo',
  'repository_not_dispatchable',
  'dispatch_list_unavailable',
```

`packages/contracts/events.ts`, after `'handed_to_person',`:

```ts
  'review_verdict_recorded',
  'shadow_verdict',
  'shadow_lifted',
```

`packages/contracts/harness.ts`, below `repositorySchema`:

```ts
export const githubLoginPattern = '^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\\[bot\\])?$';
export const githubLoginSchema = z
  .string()
  .regex(new RegExp(githubLoginPattern), 'a GitHub login, with [bot] for an app');

const distinctInAnyCase = (values: readonly string[]) =>
  new Set(values.map((value) => value.toLowerCase())).size === values.length;

export const externalReviewerIdentitiesSchema = z
  .array(githubLoginSchema)
  .max(20)
  .refine(distinctInAnyCase, 'each login once, in any case');
```

and in `harnessSchema`, after `paused: z.boolean(),`:

```ts
  shadow: z.boolean().default(false),
  externalReviewerIdentities: externalReviewerIdentitiesSchema.default([]),
```

`packages/contracts/commands.ts`: import `externalReviewerIdentitiesSchema` from `./harness.ts`; add `'set_shadow'` at the end of `commandNames`; in `harnessCommandSchemas` change `activate_template` and add `set_shadow` after `record_measurement`:

```ts
  activate_template: body('activate_template', {
    harnessKey: slugSchema,
    jdArea: jdAreaSchema,
    template: templateKeySchema,
    repository: repositorySchema.nullable(),
    shadow: z.boolean().default(false),
    externalReviewerIdentities: externalReviewerIdentitiesSchema.default([]),
  }),
```

```ts
  set_shadow: body('set_shadow', { shadow: z.literal(false) }),
```

and `harnessCommandSchemas.set_shadow,` at the end of the `commandSchema` union.

`packages/contracts/pages.ts`: add `'platform',` at the end of `pageTypes`.

`packages/contracts/page-types.ts`: below `issueFrontmatterSchema`:

```ts
export const platformPageSlug = 'platform';

const distinctRepositories = (values: readonly string[]) =>
  new Set(values.map((value) => value.toLowerCase())).size === values.length;

export const platformFrontmatterSchema = z.strictObject({
  dispatch_allowed: z
    .array(repositorySchema)
    .max(200)
    .refine(distinctRepositories, 'each repository once, in any case'),
});
```

and in `pageTypeRegistry`: `platform: { frontmatter: platformFrontmatterSchema, ...internalSync },`.

`packages/contracts/shadow.ts`:

```ts
import { z } from 'zod';
import { reviewVerdictSchema } from './closed-sets.ts';
import { pullRequestRefSchema } from './harness.ts';
import { slugSchema } from './pages.ts';
import { fullShaSchema, shipRefusalSchema } from './ship-rule.ts';

export const shadowVerdictValueSchema = z.enum(['advance', 'refuse']);

const shadowSchema = z.strictObject({
  verdict: shadowVerdictValueSchema,
  reasons: z.array(shipRefusalSchema).max(shipRefusalSchema.options.length),
});

const recordedSchema = z.strictObject({
  reviewer: z.string().regex(/^[a-z0-9-]{1,64}$/),
  verdict: reviewVerdictSchema,
  findings: z.array(z.string().min(1).max(500)).max(50),
});

const otherReviewSchema = z.strictObject({
  reviewer: z.string().min(1).max(100),
  state: z.enum(['approved', 'changes_requested', 'dismissed']),
});

export const shadowRowSchema = z.strictObject({
  itemId: z.uuid(),
  title: z.string().min(1).max(200),
  pullRequest: pullRequestRefSchema,
  head: fullShaSchema,
  shadow: shadowSchema.nullable(),
  reviewer: recordedSchema.nullable(),
  github: z.array(otherReviewSchema).max(100),
  disagrees: z.boolean(),
});

export const shadowComparisonSchema = z.strictObject({
  harnessId: z.uuid(),
  harnessKey: slugSchema,
  shadow: z.boolean(),
  capped: z.boolean(),
  rows: z.array(shadowRowSchema).max(5000),
});

export type ShadowRow = z.infer<typeof shadowRowSchema>;
export type ShadowComparison = z.infer<typeof shadowComparisonSchema>;
```

`packages/contracts/event-evidence.ts`: add `reviewVerdictSchema` to the `./closed-sets.ts` import, `providerIdSchema` to the `./runs.ts` import, and `import { shadowVerdictValueSchema } from './shadow.ts';`. Replace `item_created` in `itemEvidence`:

```ts
  item_created: z
    .strictObject({
      stage,
      title: z.string().min(1).max(200),
      pageId: id.nullable(),
      priority: z.number().int(),
      due: z.iso.date().nullable(),
      issue: issueRefSchema.nullable().default(null),
      pullRequest: pullRequestRefSchema.nullable().default(null),
      expectedHead: head.nullable().default(null),
    })
    .refine(
      (created) => (created.pullRequest === null) === (created.expectedHead === null),
      'a joined pull request comes with its head',
    ),
```

Add to `gateEvidence`:

```ts
  review_verdict_recorded: z.strictObject({
    runId: id,
    head,
    reviewer: z.string().regex(/^[a-z0-9-]{1,64}$/),
    provider: providerIdSchema,
    model: modelIdSchema,
    verdict: reviewVerdictSchema,
    findings: z.array(text).max(50),
  }),
  shadow_verdict: z.strictObject({
    head: head.nullable(),
    verdict: shadowVerdictValueSchema,
    reasons: z.array(shipRefusalSchema).max(shipRefusalSchema.options.length),
  }),
```

Add to `harnessEvidence`: `shadow_lifted: z.strictObject({}),` and change `template_activated`:

```ts
  template_activated: z.strictObject({
    template: slugSchema,
    stages: z.array(stage).min(1),
    repository: repositorySchema.nullable(),
    shadow: z.boolean().default(false),
  }),
```

Before relying on `eventEvidenceSchemas.item_created.shape`, run `grep -rn "item_created.shape" packages apps sim`; Zod 4 keeps `.shape` on a refined object, and the grep should be empty anyway.

`packages/contracts/registry.ts`: import `githubLoginSchema` from `./harness.ts`, `platformFrontmatterSchema` from `./page-types.ts`, `shadowComparisonSchema` from `./shadow.ts`, and add beside their neighbours:

```ts
  'github-login': githubLoginSchema,
  'platform-frontmatter': platformFrontmatterSchema,
  'shadow-comparison': shadowComparisonSchema,
```

`packages/contracts/index.ts`: `export * from './shadow.ts';` in alphabetical place.

- [ ] **Step 4: Run the new tests**

Run: `npx vitest run packages/contracts/contracts.test.ts packages/contracts/events.test.ts`
Expected: the new block and the vocabulary test pass. `golden fixtures` and `CT-3 the contract lock` still fail until Steps 5 and 6.

- [ ] **Step 5: Write the fixtures**

Run from the repository root:

```bash
node --input-type=module -e '
import { mkdirSync, writeFileSync } from "node:fs";
const root = "packages/contracts/fixtures";
const write = (path, value) => {
  const file = `${root}/${path}`;
  mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
};
const head = "a".repeat(40);
const harnessId = "00000000-0000-4000-8000-0000000000a1";
const itemId = "00000000-0000-4000-8000-0000000000b1";
const requestId = "00000000-0000-4000-8000-0000000000aa";
const pullRequest = { repo: "unfoldingWord/tc-admin-app", number: 12 };
const event = (n, name, item, actor, evidence) => ({
  eventId: `00000000-0000-4000-8000-0000000000e${n}`,
  harnessId, itemId: item, name, position: n, at: "2026-10-15T09:00:00.000Z", actor, evidence,
  traceId: "00000000-0000-4000-8000-0000000000c1", requestId: null,
});
const created = { stage: "check", title: "Fix the login form", pageId: null, priority: 0, due: null, issue: null };
write("event/valid/item-created-joining-a-pull-request.json",
  event(1, "item_created", itemId, "agent:ingest", { ...created, pullRequest, expectedHead: head }));
write("event/invalid/item-created-pull-request-without-head.json",
  event(1, "item_created", itemId, "agent:ingest", { ...created, pullRequest, expectedHead: null }));
write("event/valid/review-verdict-recorded.json", event(2, "review_verdict_recorded", itemId, "agent:reviewer", {
  runId: "00000000-0000-4000-8000-0000000000d1", head, reviewer: "uw-reviewer", provider: "deepinfra",
  model: "z-ai/glm-5.3", verdict: "approve", findings: ["The form validates as it should."] }));
write("event/valid/shadow-verdict.json", event(3, "shadow_verdict", itemId, "agent:ingest",
  { head, verdict: "refuse", reasons: ["no_reviewer_approval"] }));
write("event/invalid/shadow-verdict-unknown-reason.json", event(3, "shadow_verdict", itemId, "agent:ingest",
  { head, verdict: "refuse", reasons: ["looks_wrong"] }));
write("event/valid/shadow-lifted.json",
  event(4, "shadow_lifted", null, "human:00000000-0000-4000-8000-000000000001", {}));
write("command/valid/set-shadow.json", { command: "set_shadow", requestId, shadow: false });
write("command/invalid/set-shadow-on.json", { command: "set_shadow", requestId, shadow: true });
write("command/valid/activate-template-in-shadow.json", { command: "activate_template", requestId,
  harnessKey: "tc-admin-app", jdArea: "80-89", template: "check-only", repository: pullRequest.repo,
  shadow: true, externalReviewerIdentities: ["uwreview[bot]"] });
const harness = { id: harnessId, key: "tc-admin-app", template: "check-only", jdArea: "80-89",
  repository: pullRequest.repo, hostedBuilderEnabled: false, paused: false };
write("harness/valid/check-only-in-shadow.json",
  { ...harness, shadow: true, externalReviewerIdentities: ["uwreview[bot]"] });
write("harness/invalid/external-reviewer-not-a-login.json",
  { ...harness, externalReviewerIdentities: ["not a login"] });
write("github-login/valid/app.json", "uwreview[bot]");
write("github-login/valid/person.json", "seth-k");
write("github-login/invalid/space.json", "not a login");
write("platform-frontmatter/valid/one-repository.json", { dispatch_allowed: [pullRequest.repo] });
write("platform-frontmatter/valid/empty.json", { dispatch_allowed: [] });
write("platform-frontmatter/invalid/repeated.json",
  { dispatch_allowed: [pullRequest.repo, "UNFOLDINGWORD/TC-ADMIN-APP"] });
write("platform-frontmatter/invalid/not-a-repository.json", { dispatch_allowed: ["tc-admin-app"] });
const row = { itemId, title: "Fix the login form", pullRequest, head,
  shadow: { verdict: "refuse", reasons: ["checks_not_green"] },
  reviewer: { reviewer: "uw-reviewer", verdict: "approve", findings: [] },
  github: [{ reviewer: "uwreview[bot]", state: "changes_requested" }], disagrees: true };
const comparison = { harnessId, harnessKey: "tc-admin-app", shadow: true, capped: false, rows: [row] };
write("shadow-comparison/valid/disagreeing.json", comparison);
write("shadow-comparison/invalid/commented-review.json",
  { ...comparison, rows: [{ ...row, github: [{ reviewer: "x", state: "commented" }] }] });
write("page-type/valid/platform.json", "platform");
write("error-reason/valid/dispatch-list-unavailable.json", "dispatch_list_unavailable");
'
npx prettier --write packages/contracts/fixtures
```

Before running it, list `packages/contracts/fixtures/event/valid` and copy the `actor` an existing ingest-written fixture uses (`ingestIdentity` in `packages/contracts/identity.ts`); replace `"agent:ingest"` with that string if it differs. Check that `fixtures/page-type/valid` and `fixtures/error-reason/valid` exist; if a directory has a different name, write those two files there.

- [ ] **Step 6: Append the lock entry and bump the version**

```bash
node -e '
const fs = require("node:fs");
const { readFileSync } = fs;
const p = "packages/contracts/contract-lock.json";
const version = /CONTRACT_VERSION = .(\d+)\.(\d+)\.(\d+)./.exec(readFileSync("packages/contracts/version.ts", "utf8"));
const next = `${version[1]}.${Number(version[2]) + 1}.0`;
const lock = JSON.parse(readFileSync(p, "utf8"));
const last = lock.versions.at(-1).sets;
const add = (key, values) => [...last[key], ...values.filter((value) => !last[key].includes(value))];
const sets = { ...last,
  "error-reason": add("error-reason", ["template_has_no_package", "no_harness_for_repo", "repository_not_dispatchable", "dispatch_list_unavailable"]),
  "event-name": add("event-name", ["review_verdict_recorded", "shadow_verdict", "shadow_lifted"]),
  "command-name": add("command-name", ["set_shadow"]),
  "page-type": add("page-type", ["platform"]) };
const sorted = Object.fromEntries(Object.entries(sets).sort(([a], [b]) => a.localeCompare(b)));
lock.versions.push({ version: next, sets: sorted });
fs.writeFileSync(p, JSON.stringify(lock, null, 2) + "\n");
fs.writeFileSync("packages/contracts/version.ts", readFileSync("packages/contracts/version.ts", "utf8").replace(/CONTRACT_VERSION = .\d+\.\d+\.\d+./, `CONTRACT_VERSION = \x27${next}\x27`));
console.log(next);
'
npx prettier --write packages/contracts/contract-lock.json packages/contracts/version.ts
```

Expected: prints the step's version (expected `12.4.0`).

- [ ] **Step 7: Run the contracts tests**

Run: `npx vitest run packages/contracts`
Expected: all green, including `golden fixtures`, `WB-1 every control is a command with a requestId`, `CT-3 the contract lock`.

- [ ] **Step 8: Find every pin of the old version outside the package**

```bash
grep -rn "12\.3\.0" --include='*.ts' --include='*.sql' packages apps sim tools | grep -v node_modules | grep -v contract-lock.json
```

Use the version you replaced. If a `.ts` file asserts the live version with `assertLiveContractVersion`, change its string to the step's version in this commit and name it in the body; if it only lists names, leave it.

- [ ] **Step 9: Commit (shared root)**

```bash
git add packages/contracts
git commit -m "feat(contracts): joining, shadow and the dispatch list

Shared root packages/contracts. Four refusals (template_has_no_package,
no_harness_for_repo, repository_not_dispatchable, dispatch_list_unavailable),
three events (review_verdict_recorded, shadow_verdict, shadow_lifted),
set_shadow, shadow and external reviewers on activation and on the
harness, a joined pull request on item_created, the platform page type,
and the shadow comparison. Additive, one minor version.

GL-2 GL-3 GL-4 GL-6 OB-3 PI-1. S14-R1 S14-R2 S14-R3 S14-R13."
```

- [ ] **Step 10: Fill the totals the new values force (second commit)**

`packages/harness/items/fold.ts`, add to `unchangedNames`: `'review_verdict_recorded'`, `'shadow_verdict'`, `'shadow_lifted'`.

`apps/uw-app/pages/gating.ts`, add `platform: 'gated',` to `gatingByType`.

`apps/uw-app/commands/registry.ts`: `import { notWiredCommand } from './not-wired.ts';` and add `notWiredCommand('set_shadow', 'admin'),` at the end of the `commandRegistryOf([...])` list. `apps/uw-app/commands/registry.test.ts`: add `set_shadow: 'admin',` to `actions`.

Regenerate the islands bundle, which embeds the contract schemas: `pnpm ui:islands`.

Run: `pnpm check && npx vitest run packages/harness/items/fold.test.ts apps/uw-app/commands/registry.test.ts tools/ui/generated-islands.test.ts packages/contracts`
Expected: green. `tools/db/drift.test.ts` is red until Task 2.

```bash
git add packages/harness/items/fold.ts apps/uw-app/pages/gating.ts apps/uw-app/commands/registry.ts apps/uw-app/commands/registry.test.ts apps/uw-app/generated/islands.ts
git commit -m "chore: the totals the joining contracts force

The new events fold to nothing, the platform page type is gated, set_shadow
is registered not wired until Task 4, and the islands bundle is rebuilt.

GL-4 GL-6."
```

---

### Task 2: The columns and the migration (shared root `packages/db/schema.ts`, `schema-github.ts`)

**Files:**
- Modify: `packages/db/schema.ts` (`harnesses`: two columns and one check)
- Modify: `packages/db/schema-github.ts` (`gh_prs.requested_reviewers`)
- Create: `packages/db/migrations/00NN_joining.sql`, `packages/db/migrations/meta/00NN_snapshot.json`, `meta/_journal.json` entry (generated)
- Create: `packages/db/joining-columns.test.ts`

**Interfaces:**
- Consumes: Task 1's enums (the name checks regenerate from them).
- Produces: `harnesses.shadow boolean NOT NULL DEFAULT false`, `harnesses.external_reviewer_identities text[] NOT NULL DEFAULT '{}'` (at most 20), `gh_prs.requested_reviewers text[] NOT NULL DEFAULT '{}'`; Drizzle fields `shadow`, `externalReviewerIdentities`, `requestedReviewers`.

- [ ] **Step 1: Write the failing test**

`packages/db/joining-columns.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

function openDatabase(target: DatabaseTarget): () => Db {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function insertHarness(db: Db, key: string, external: string) {
  return db.execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at, external_reviewer_identities)
    VALUES (gen_random_uuid(), ${key}, 'check-only', '80-89', now(), ${external}::text[])`);
}

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

function joiningColumns(db: () => Db): void {
  it('GL-4 PI-1 a harness starts out of shadow with no external reviewers', async () => {
    await db().execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
      VALUES (gen_random_uuid(), 'joining-defaults', 'check-only', '80-89', now())`);
    const rows = await db().execute<{ shadow: boolean; external: string[] }>(
      sql`SELECT shadow, external_reviewer_identities AS external FROM harnesses WHERE key = 'joining-defaults'`,
    );
    expect(rows[0]).toEqual({ shadow: false, external: [] });
  });

  it('PI-1 refuses more than twenty external reviewers by harnesses_external_reviewers_bounded', async () => {
    const many = `{${Array.from({ length: 21 }, (_, n) => `r${n}`).join(',')}}`;
    expect(await refusal(insertHarness(db(), 'joining-many', many))).toEqual({
      code: '23514',
      constraint: 'harnesses_external_reviewers_bounded',
    });
  });

  it('GL-3 admits the new event and command names and the platform page type', async () => {
    const checks = await db().execute<{ name: string; definition: string }>(sql`
      SELECT conname AS name, pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conname IN ('harness_events_name_known', 'command_requests_command_known', 'pages_type_known')`);
    const text = checks.map((row) => row.definition).join(' ');
    for (const name of ['shadow_verdict', 'review_verdict_recorded', 'shadow_lifted', 'set_shadow', 'platform']) {
      expect(text).toContain(`'${name}'`);
    }
  });
}

describe('the joining columns', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => joiningColumns(openDatabase(target)),
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/db/joining-columns.test.ts`
Expected: FAIL, column `shadow` does not exist.

- [ ] **Step 3: Add the columns**

`packages/db/schema.ts`, in `harnesses` after `repository: text('repository'),`:

```ts
    shadow: boolean('shadow').notNull().default(false),
    externalReviewerIdentities: text('external_reviewer_identities')
      .array()
      .notNull()
      .default(emptyText),
```

and in its checks:

```ts
    check(
      'harnesses_external_reviewers_bounded',
      sql`cardinality(${t.externalReviewerIdentities}) <= 20`,
    ),
```

`packages/db/schema-github.ts`, in `ghPrs` after `filesProblem`:

```ts
    requestedReviewers: text('requested_reviewers').array().notNull().default(emptyText),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @uw/db exec drizzle-kit generate --name joining`
Expected: one new file `packages/db/migrations/00NN_joining.sql` (the next index after the newest, 0029 if no earlier step added one) with: `ALTER TABLE "harnesses" ADD COLUMN "shadow" boolean DEFAULT false NOT NULL`, `ADD COLUMN "external_reviewer_identities" text[] DEFAULT '{}'::text[] NOT NULL`, `ALTER TABLE "gh_prs" ADD COLUMN "requested_reviewers" ...`, the `harnesses_external_reviewers_bounded` check, and a drop-and-add of `harness_events_name_known`, `command_requests_command_known` and `pages_type_known` (and `page_versions_type_known` if that table carries one) whose lists include the new names. Read the file; if it contains anything else, stop and find out why before committing.

- [ ] **Step 5: Run the database tests and the drift test**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/db tools/db/drift.test.ts`
Expected: green, including `migrations`, `the joining columns` on both targets, and `schema drift`.

- [ ] **Step 6: Commit (shared root)**

```bash
git add packages/db/schema.ts packages/db/schema-github.ts packages/db/migrations packages/db/joining-columns.test.ts
git commit -m "feat(db): shadow, external reviewers and requested reviewers

Shared root packages/db/schema.ts and schema-github.ts, one migration for
step 14. harnesses.shadow and harnesses.external_reviewer_identities are
written by the stage command; gh_prs.requested_reviewers by the facts
module. The event, command and page-type checks admit the contract's new
names.

GL-3 GL-4 PI-1. S14-R12."
```

---

### Task 3: The Store reads and write joining needs (shared root `packages/harness/store-ports.ts`)

**Files:**
- Modify: `packages/harness/store-ports.ts` and `packages/db/store/types.ts` (identical changes; the second mirrors the first)
- Modify: `packages/db/store/harnesses.ts` (`setShadow`), `packages/db/store/rows.ts` (`toHarness`), `packages/db/store/items.ts` (`byPullRequest`), `packages/db/store/pages.ts` (`platformFor`)
- Create: `packages/harness/port-contracts/store-joining.ts`
- Modify: `packages/harness/port-contracts/store.ts` (wire the suite)
- Modify: `packages/harness/port-contracts/store-gateway-fixtures.ts` only if `harnessOf` needs nothing (it parses, so the defaults fill in)

**Interfaces:**
- Produces:
  - `HarnessesGateway.write.setShadow(harnessId: string, shadow: boolean): Promise<boolean>`
  - `HarnessItemsGateway.read.byPullRequest(harnessId: string, pullRequest: PullRequestKey): Promise<ItemState | null>` with `export type PullRequestKey = { readonly repo: string; readonly number: number };`, case-insensitive on `repo`, the earliest created item if several
  - `PagesGateway.read.platformFor(jdArea: string): Promise<PageFacts | null>`: the page of type `platform` at slug `platformPageSlug` in the area, whatever its status

- [ ] **Step 1: Change the port (shared-root commit)**

In both `packages/harness/store-ports.ts` and `packages/db/store/types.ts`:

```ts
export type PullRequestKey = { readonly repo: string; readonly number: number };
```

beside `StagePosition`; in `HarnessesGateway.write` add `setShadow(harnessId: string, shadow: boolean): Promise<boolean>;`; in `HarnessItemsGateway.read` add `byPullRequest(harnessId: string, pullRequest: PullRequestKey): Promise<ItemState | null>;` after `byIssue`; in `PagesGateway.read` add `platformFor(jdArea: string): Promise<PageFacts | null>;`.

Run: `pnpm check`
Expected: FAIL only in `packages/db/store/*.ts`, where the bindings lack the three members. Commit the port change alone:

```bash
git add packages/harness/store-ports.ts packages/db/store/types.ts
git commit -m "feat(harness): the Store learns a pull request's item, the platform page and the shadow switch

Shared root packages/harness/store-ports.ts (and its mirror in
packages/db/store/types.ts). Three gateway members joining, dispatch and
shadow need; the bindings follow in the next commit.

GL-3 GL-4 GL-6."
```

(`pnpm check` is red between this commit and the next; hooks run lint-staged only. Do Step 2 straight after.)

- [ ] **Step 2: Write the failing contract suite**

`packages/harness/port-contracts/store-joining.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { platformPageSlug } from '@uw/contracts';
import type { Store } from '../ports.ts';
import { at, harnessOf, itemOf, seedHarness, uid } from './store-gateway-fixtures.ts';
import type { SeededPage } from './store-gateways.ts';

type JoiningSubject = () => {
  readonly store: Store;
  seedPage(page: SeededPage): Promise<void>;
};

const pullRequest = { repo: 'unfoldingWord/tc-admin-app', number: 12 };

function platformPage(jdArea: string): SeededPage {
  return {
    id: uid(0x7001),
    type: 'platform',
    status: 'active',
    jdArea,
    title: 'Platform',
    bodyMd: 'The repositories the platform may dispatch onto.',
    frontmatter: { dispatch_allowed: [pullRequest.repo] },
    slug: platformPageSlug,
  };
}

function describeByPullRequest(subject: JoiningSubject): void {
  it('DX-3 finds the item on a pull request in its harness in any case, and nothing elsewhere', async () => {
    const joined = itemOf(0x7100, 1, { pullRequest, expectedHead: 'a'.repeat(40) });
    const found = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x7100, 'gateway-joined');
      await tx.harnessItems.write.insert(joined, at);
      return {
        same: await tx.harnessItems.read.byPullRequest(uid(0x7100), {
          repo: 'UNFOLDINGWORD/TC-ADMIN-APP',
          number: 12,
        }),
        other: await tx.harnessItems.read.byPullRequest(uid(0x7100), { ...pullRequest, number: 13 }),
        elsewhere: await tx.harnessItems.read.byPullRequest(uid(0x7200), pullRequest),
      };
    });
    expect(found).toEqual({ same: joined, other: null, elsewhere: null });
  });
}

function describePlatformFor(subject: JoiningSubject): void {
  it('DX-3 reads the platform page of an area by type and slug, and nothing for another area', async () => {
    await subject().seedPage(platformPage('70-79'));
    const read = await subject().store.transaction(async (tx) => ({
      area: await tx.pages.read.platformFor('70-79'),
      other: await tx.pages.read.platformFor('60-69'),
    }));
    expect(read.area).toMatchObject({
      id: uid(0x7001),
      type: 'platform',
      status: 'active',
      frontmatter: { dispatch_allowed: [pullRequest.repo] },
    });
    expect(read.other).toBeNull();
  });
}

function describeSetShadow(subject: JoiningSubject): void {
  it('DX-3 stores shadow and the external reviewers, and lifts shadow', async () => {
    const harness = {
      ...harnessOf(0x7300, 'gateway-shadow'),
      shadow: true,
      externalReviewerIdentities: ['uwreview[bot]'],
    };
    const read = await subject().store.transaction(async (tx) => {
      await tx.harnesses.write.insert(harness, at);
      const before = await tx.harnesses.read.byId(harness.id);
      const lifted = await tx.harnesses.write.setShadow(harness.id, false);
      const missing = await tx.harnesses.write.setShadow(uid(0x7399), false);
      return { before, lifted, missing, after: await tx.harnesses.read.byId(harness.id) };
    });
    expect(read).toEqual({
      before: harness,
      lifted: true,
      missing: false,
      after: { ...harness, shadow: false },
    });
  });
}

export function describeStoreJoining(adapter: string, subject: JoiningSubject): void {
  describe(`store reads for joining on ${adapter}`, () => {
    describeByPullRequest(subject);
    describePlatformFor(subject);
    describeSetShadow(subject);
  });
}
```

`packages/harness/port-contracts/store.ts`: `import { describeStoreJoining } from './store-joining.ts';` and `describeStoreJoining(adapter, subject);` after `describeStoreMeasurements(adapter, subject);`.

If `uid(0x7001)` … `uid(0x7399)` collide with ids another suite in the same file family uses, pick the next free block above the highest `uid(0x…)` in `packages/harness/port-contracts/` (grep `uid(0x7`).

- [ ] **Step 3: Write the bindings**

`packages/db/store/rows.ts`, in `toHarness`: add `shadow: row.shadow,` and `externalReviewerIdentities: row.externalReviewerIdentities,`.

`packages/db/store/harnesses.ts`, in `write`, after `setHostedBuilder`:

```ts
      setShadow: (harnessId, shadow) =>
        refusing(async () => {
          const rows = await executor
            .update(harnesses)
            .set({ shadow })
            .where(eq(harnesses.id, harnessId))
            .returning({ id: harnesses.id });
          return rows.length > 0;
        }),
```

`packages/db/store/items.ts`: import `PullRequestKey` from `./types.ts`; add above `bindReads`:

```ts
async function byPullRequest(
  executor: AnyExecutor,
  harnessId: string,
  pullRequest: PullRequestKey,
): Promise<ItemState | null> {
  const rows = await selectItems(executor)
    .where(
      and(
        eq(harnessItems.harnessId, harnessId),
        sql`lower(${harnessItems.prRepo}) = lower(${pullRequest.repo})`,
        eq(harnessItems.prNumber, pullRequest.number),
      ),
    )
    .orderBy(asc(harnessItems.createdAt), asc(harnessItems.id))
    .limit(1);
  return rows[0] ? toItemState(rows[0].item, rows[0].stageKey) : null;
}
```

and in `bindReads` after `byIssue`: `byPullRequest: (harnessId, pullRequest) => byPullRequest(executor, harnessId, pullRequest),`.

`packages/db/store/pages.ts`: import `platformPageSlug` from `@uw/contracts`; add above `bindPages`:

```ts
async function platformFor(executor: AnyExecutor, jdArea: string): Promise<PageFacts | null> {
  const [row] = await executor
    .select(factColumns)
    .from(pages)
    .where(
      and(
        eq(pages.jdArea, jdArea),
        eq(pages.slug, platformPageSlug),
        eq(pages.type, 'platform'),
      ),
    )
    .limit(1);
  return row === undefined ? null : toFacts(row);
}
```

and in `read`: `platformFor: (jdArea) => platformFor(executor, jdArea),`.

- [ ] **Step 4: Run the Store contract on both adapters**

Run: `pnpm check && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/harness/port-contracts sim/adapters apps/uw-app/ports`
Expected: green; `store reads for joining` runs on the sim adapter and on the platform adapter. If `pnpm check` reports a `Harness` literal outside these files missing `shadow` or `externalReviewerIdentities`, add `shadow: false, externalReviewerIdentities: []` there (expect `packages/harness/stages/activate.ts`, fixed properly in Task 4; add the two fields with those values now).

- [ ] **Step 5: Commit**

```bash
git add packages/db/store packages/harness/port-contracts packages/harness/stages/activate.ts
git commit -m "feat(db): bind the pull-request item read, the platform page read and the shadow write

The Store contract gains a joining suite run on the embedded and the
platform adapter.

GL-3 GL-4 GL-6."
```

---

### Task 4: Shadow and external reviewers at activation; lifting shadow (GL-4, PI-1 setup)

**Files:**
- Modify: `packages/harness/stages/activate.ts` (input fields, validation, `template_activated.shadow`)
- Create: `packages/harness/stages/shadow.ts`
- Modify: `packages/harness/stages/commands.ts` (`liftShadow`)
- Modify: `packages/harness/github/reviewers.ts` (`countedReviewer`, `namesPlatformReviewer`, `requestsPlatformReviewer`, `EXTERNAL_PROVIDER`)
- Modify: `packages/harness/index.ts` (export `requestsPlatformReviewer`, `EXTERNAL_PROVIDER`)
- Modify: `apps/uw-app/commands/person/stages.ts` (`activate_template` passes the fields; `setShadowCommand`)
- Modify: `apps/uw-app/commands/registry.ts` (replace the not-wired `set_shadow`)
- Modify: `sim/fixtures.ts` (`createSimHarness` options `shadow`, `externalReviewerIdentities`)
- Create: `sim/kernel/shadow-switch.test.ts`
- Create: `apps/uw-app/commands/joining.pg.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts; Task 3 `harnesses.write.setShadow`.
- Produces:
  - `ActivateInput` gains `readonly shadow?: boolean; readonly externalReviewerIdentities?: readonly string[];` (defaults `false`, `[]`)
  - `StageCommands.liftShadow(caller: Caller, input: { readonly harnessId: string }): Promise<KernelOutcome<HarnessScene>>`
  - `countedReviewer(login: string, external: readonly string[]): { readonly reviewer: string; readonly external: boolean } | null`
  - `namesPlatformReviewer(login: string): boolean`, `requestsPlatformReviewer(logins: readonly string[]): boolean`, `EXTERNAL_PROVIDER = 'external'`
  - `createSimHarness(world, template, { shadow?, externalReviewerIdentities? })`

- [ ] **Step 1: Write the failing kernel tests**

`sim/kernel/shadow-switch.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { checkOnly, readAllEvents } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

const repository = 'unfoldingWord/tc-admin-app';

describe('GL-4 shadow is set at activation and lifted by an admin', () => {
  it('records shadow on template_activated and reads it back on the harness', () =>
    inWorld(async (world) => {
      const { harness } = await createSimHarness(world, checkOnly, { repository, shadow: true });
      expect(harness.shadow).toBe(true);
      const events = await world.adapters.store.transaction((tx) => readAllEvents(tx, harness.id, null));
      expect(events[0]?.evidence).toMatchObject({ template: 'check-only', shadow: true });
    }));

  it('lifts shadow once, records shadow_lifted, and refuses an area editor', () =>
    inWorld(async (world) => {
      const { harness, admin } = await createSimHarness(world, checkOnly, { repository, shadow: true });
      const editor = await simPerson(world, 2, [
        { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
      ]);
      const refused = await world.kernel.stages.liftShadow(simCaller(world, editor), {
        harnessId: harness.id,
      });
      expect(refused).toMatchObject({ status: 'error', reason: 'not_permitted' });
      const lifted = await world.kernel.stages.liftShadow(simCaller(world, admin), {
        harnessId: harness.id,
      });
      expect(lifted.status === 'accepted' && lifted.value.harness.shadow).toBe(false);
      const again = await world.kernel.stages.liftShadow(simCaller(world, admin), {
        harnessId: harness.id,
      });
      expect(again.status).toBe('accepted');
      const names = (
        await world.adapters.store.transaction((tx) => readAllEvents(tx, harness.id, null))
      ).map((event) => event.name);
      expect(names).toEqual(['template_activated', 'shadow_lifted']);
    }));
});

describe('PI-1 external reviewers are named at activation', () => {
  it('stores the logins and refuses one that names a platform Reviewer', () =>
    inWorld(async (world) => {
      const { harness } = await createSimHarness(world, checkOnly, {
        repository,
        externalReviewerIdentities: ['uwreview[bot]'],
      });
      expect(harness.externalReviewerIdentities).toEqual(['uwreview[bot]']);
      await expect(
        createSimHarness(world, checkOnly, {
          key: 'second',
          repository: 'unfoldingWord/second',
          externalReviewerIdentities: ['UW-Reviewer[bot]'],
        }),
      ).rejects.toThrow('malformed_command');
    }));
});
```

(The last test leans on `createSimHarness` throwing `activating … was refused: <reason>`, which it already does.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run sim/kernel/shadow-switch.test.ts`
Expected: FAIL; `createSimHarness` ignores `shadow`, `liftShadow` does not exist.

- [ ] **Step 3: The reviewer identities**

Append to `packages/harness/github/reviewers.ts` (add `import { normalisedIdentifier } from './identifiers.ts';` at the top):

```ts
export const EXTERNAL_PROVIDER = 'external';

export type CountedReviewer = { readonly reviewer: string; readonly external: boolean };

const botSuffix = /\[bot\]$/u;

function externalKey(login: string): string | null {
  return normalisedIdentifier(login.trim().toLowerCase().replace(botSuffix, ''));
}

export function countedReviewer(
  login: string,
  external: readonly string[],
): CountedReviewer | null {
  const own = reviewerOf(login);
  if (own !== null) return { reviewer: own, external: false };
  const folded = login.trim().toLowerCase();
  if (!external.some((entry) => entry.trim().toLowerCase() === folded)) return null;
  const key = externalKey(folded);
  return key === null ? null : { reviewer: key, external: true };
}

export function namesPlatformReviewer(login: string): boolean {
  const key = externalKey(login);
  return reviewerOf(login) !== null || reviewerIdentities.some((entry) => entry.reviewer === key);
}

export function requestsPlatformReviewer(logins: readonly string[]): boolean {
  return logins.some((login) => reviewerOf(login) !== null);
}
```

`packages/harness/index.ts`: `export { EXTERNAL_PROVIDER, requestsPlatformReviewer } from './github/reviewers.ts';`.

- [ ] **Step 4: Activation takes the fields**

`packages/harness/stages/activate.ts`: import `harnessSchema` beside `repositorySchema` and `namesPlatformReviewer` from `../github/reviewers.ts`. `ActivateInput` gains:

```ts
  readonly shadow?: boolean;
  readonly externalReviewerIdentities?: readonly string[];
```

Add:

```ts
function externalRefusal(external: readonly string[]): Refused | null {
  const parsed = harnessSchema.shape.externalReviewerIdentities.safeParse(external);
  if (parsed.success && !external.some(namesPlatformReviewer)) return null;
  return refused('malformed_command', { why: 'external_reviewer_identities' });
}
```

In `activateTemplate`, after the repository check:

```ts
  const external = [...(input.externalReviewerIdentities ?? [])];
  const unknown = externalRefusal(external);
  if (unknown !== null) return unknown;
```

and the harness literal gains `shadow: input.shadow ?? false, externalReviewerIdentities: external,` (replacing the placeholder Task 3 added). In `insertAll`, the `template_activated` draft gains `shadow: harness.shadow,`. If `activateTemplate` passes 50 lines, move the harness literal into `function harnessOf(input: ActivateInput, external: string[]): Harness`.

- [ ] **Step 5: The lift**

`packages/harness/stages/shadow.ts`:

```ts
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import type { HarnessScene } from '../reads/scene.ts';
import { adminRefusal, agentRefusal } from './rules.ts';

type ShadowPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type LiftShadowInput = { readonly harnessId: string };

export async function liftShadow(
  ports: ShadowPorts,
  caller: Caller,
  input: LiftShadowInput,
): Promise<KernelOutcome<HarnessScene>> {
  const agent = agentRefusal(caller);
  if (agent !== null) return agent;
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.harnessStages(input.harnessId));
    const harness = await tx.harnesses.read.byId(input.harnessId);
    if (harness === null) return refused('harness_not_found', { harnessId: input.harnessId });
    const denied = await adminRefusal(ports, tx, caller, harness, at);
    if (denied !== null) return denied;
    const stages = await tx.harnessStages.read.forHarness(harness.id);
    if (!harness.shadow) return accepted({ harness, stages });
    if (!(await tx.harnesses.write.setShadow(harness.id, false))) {
      return refused('harness_not_found', { harnessId: harness.id });
    }
    await recordHarnessEvents(tx, recordContext(ports, caller, at), harness.id, [
      draft('shadow_lifted', {}),
    ]);
    return accepted({ harness: { ...harness, shadow: false }, stages });
  });
}
```

`packages/harness/stages/commands.ts`: import `liftShadow, type LiftShadowInput` from `./shadow.ts`; `StageCommands` gains `liftShadow(caller: Caller, input: LiftShadowInput): Promise<KernelOutcome<HarnessScene>>;`; `createStageCommands` gains `liftShadow: (caller, input) => liftShadow(ports, caller, input),`.

- [ ] **Step 6: The sim fixture**

`sim/fixtures.ts`, `SimHarnessOptions` gains `readonly shadow?: boolean; readonly externalReviewerIdentities?: readonly string[];` and the `activate` call passes `shadow: options.shadow ?? false, externalReviewerIdentities: options.externalReviewerIdentities ?? [],`.

- [ ] **Step 7: Run the kernel tests**

Run: `npx vitest run sim/kernel/shadow-switch.test.ts sim/kernel/stage-command.test.ts sim/kernel/harness-repository.test.ts`
Expected: green.

- [ ] **Step 8: Write the failing route tests**

`apps/uw-app/commands/joining.pg.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { command, eventsNamed, person } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const IAN = { email: 'ian.lindsley@unfoldingword.org' };
const repository = 'unfoldingWord/tc-admin-app';

async function checkOnlyHarness(db: Database, shadow: boolean): Promise<string> {
  const harnessId = randomUUID();
  const sent = await command(db, IAN, harnessId, 'activate_template', {
    requestId: randomUUID(),
    harnessKey: `tc-admin-app-${harnessId.slice(0, 8)}`,
    jdArea: '80-89',
    template: 'check-only',
    repository: `${repository}-${harnessId.slice(0, 8)}`,
    shadow,
    externalReviewerIdentities: ['uwreview[bot]'],
  });
  expect(sent.body).toMatchObject({ status: 'accepted' });
  return harnessId;
}

describe.skipIf(!testServer)('GL-4 shadow through the command API', () => {
  it('activates in shadow, refuses an editor the lift, lifts for an admin and refuses setting it on', () =>
    withAppDatabase(async (db) => {
      const harnessId = await checkOnlyHarness(db, true);
      const [activated] = await eventsNamed(db, harnessId, 'template_activated');
      expect(activated?.evidence).toMatchObject({ shadow: true });
      const editor = await person(db, 'shadow-editor', 'editor', '80-89');
      const lift = { requestId: randomUUID(), shadow: false };
      expect((await command(db, editor, harnessId, 'set_shadow', lift)).body).toMatchObject({
        status: 'error',
        reason: 'not_permitted',
      });
      const lifted = await command(db, IAN, harnessId, 'set_shadow', { ...lift, requestId: randomUUID() });
      expect(lifted.body).toMatchObject({ status: 'accepted' });
      expect(await eventsNamed(db, harnessId, 'shadow_lifted')).toHaveLength(1);
      const on = await command(db, IAN, harnessId, 'set_shadow', { requestId: randomUUID(), shadow: true });
      expect(on.status).toBe(400);
    }));
});
```

`person` in `apps/uw-app/testing/commands.ts` is module-private today (the `person(db, name, role, area)` at line ~148). Export it (`export async function person`). `eventsNamed` returns events with `evidence`; if its shape differs, read it first and adapt the two `toMatchObject` lines.

- [ ] **Step 9: The handlers**

`apps/uw-app/commands/person/stages.ts`, in `activateTemplateCommand`:

```ts
    const { harnessKey, jdArea, repository, shadow, externalReviewerIdentities } = body;
    const input = {
      harnessId,
      harnessKey,
      jdArea,
      template,
      repository,
      shadow,
      externalReviewerIdentities,
    };
```

and append:

```ts
export const setShadowCommand = commandHandler({
  name: 'set_shadow',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }) =>
    fromKernel(await kernel.stages.liftShadow(caller, { harnessId })),
});
```

`apps/uw-app/commands/registry.ts`: import `setShadowCommand` from `./person/stages.ts`, replace `notWiredCommand('set_shadow', 'admin')` with `setShadowCommand`, and remove the `notWiredCommand` import if nothing else uses it (grep the file).

- [ ] **Step 10: Run the route and registry tests**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/commands/joining.pg.test.ts apps/uw-app/commands/registry.test.ts apps/uw-app/commands/stages.pg.test.ts tools/architecture/command-routes.test.ts`
Expected: green.

- [ ] **Step 11: Commit**

```bash
git add packages/harness/stages packages/harness/github/reviewers.ts packages/harness/index.ts apps/uw-app/commands sim/fixtures.ts sim/kernel/shadow-switch.test.ts apps/uw-app/testing/commands.ts
git commit -m "feat(harness): shadow and external reviewers at activation, and the admin lift

activate_template carries shadow and the external reviewer logins (a login
naming a platform Reviewer is refused); set_shadow lifts shadow for an
admin and records shadow_lifted once.

GL-4 PI-1. S14-R1 S14-R2."
```

---

### Task 5: Kickstart refuses a harness with no Package stage (GL-2)

**Files:**
- Create: `packages/harness/stages/package.ts`
- Modify: `packages/harness/index.ts` (export `hasPackageStage`)
- Modify: `apps/uw-app/commands/handlers/items.ts` (`kickstartCommand`)
- Modify: `apps/uw-app/commands/joining.pg.test.ts` (one `describe`)
- Create: `packages/harness/stages/package.test.ts`

**Interfaces:**
- Produces: `hasPackageStage(stages: readonly Pick<Stage, 'bracket'>[]): boolean`.

- [ ] **Step 1: Write the failing tests**

`packages/harness/stages/package.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkOnly } from '../templates/check-only.ts';
import { software } from '../templates/software.ts';
import { hasPackageStage } from './package.ts';

describe('GL-2 a check-only harness has no Package stage', () => {
  it('finds the Package stage on the software template and none on the check-only one', () => {
    expect(hasPackageStage(software.stages)).toBe(true);
    expect(hasPackageStage(checkOnly.stages)).toBe(false);
  });
});
```

Append to `apps/uw-app/commands/joining.pg.test.ts` (add `import { sql } from 'drizzle-orm';`):

```ts
describe.skipIf(!testServer)('GL-2 kickstart refuses a check-only harness, which has no Package page', () => {
  it('refuses template_has_no_package and leaves the area without a product page or Package stage', () =>
    withAppDatabase(async (db) => {
      const harnessId = await checkOnlyHarness(db, false);
      const kicked = await command(db, IAN, harnessId, 'kickstart', {
        requestId: randomUUID(),
        pageId: randomUUID(),
      });
      expect(kicked.body).toMatchObject({ status: 'error', reason: 'template_has_no_package' });
      const products = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM pages WHERE type = 'product' AND jd_area = '80-89'`,
      );
      expect(products[0]?.n).toBe(0);
      const packages = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM harness_stages WHERE harness_id = ${harnessId} AND bracket = 'product_package'`,
      );
      expect(packages[0]?.n).toBe(0);
    }));
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/harness/stages/package.test.ts` then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/commands/joining.pg.test.ts -t "GL-2"`
Expected: FAIL; `./package.ts` missing; kickstart answers `page_not_found`.

- [ ] **Step 3: Implement**

`packages/harness/stages/package.ts`:

```ts
import type { Stage } from '@uw/contracts';

export function hasPackageStage(stages: readonly Pick<Stage, 'bracket'>[]): boolean {
  return stages.some((stage) => stage.bracket === 'product_package');
}
```

`packages/harness/index.ts`: `export { hasPackageStage } from './stages/package.ts';`.

`apps/uw-app/commands/handlers/items.ts`: `import { hasPackageStage } from '@uw/harness';` and first line of `kickstartCommand.run`:

```ts
    if (!hasPackageStage(context.stages)) return { ok: false, reason: 'template_has_no_package' };
```

- [ ] **Step 4: Run them**

Same commands as Step 2, plus `npx vitest run apps/uw-app/commands/registry.test.ts`.
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/harness/stages/package.ts packages/harness/stages/package.test.ts packages/harness/index.ts apps/uw-app/commands/handlers/items.ts apps/uw-app/commands/joining.pg.test.ts
git commit -m "feat(app): kickstart refuses a harness with no Package stage

A check-only harness has no Package stage and no Package page, so
kickstart answers template_has_no_package before reading the page.

GL-2."
```

---

### Task 6: The ownership gate on dispatch (GL-6)

**Files:**
- Create: `packages/harness/items/dispatch.ts`
- Modify: `packages/harness/items/claim.ts` (`dispatchGuard` in `claimIn`)
- Modify: `apps/uw-app/pages/confirm.ts` (`'platform'` in `CONFIRMABLE`)
- Modify: `packages/db/test-seed.ts` (`seedPlatformPage`)
- Modify: `sim/fixtures.ts` (`createSimHarness` seeds the page; option `dispatchable`; `platformPageIdOf`)
- Create: `sim/kernel/dispatch.test.ts`
- Modify: `apps/uw-app/pages/gated-activation.pg.test.ts` (`platform` joins the gated types; one GL-6 test)
- Modify: every app rig or test that then fails `dispatch_list_unavailable` (Step 7)

**Interfaces:**
- Consumes: Task 3 `pages.read.platformFor`; Task 1 `platformFrontmatterSchema`, `platformPageSlug`.
- Produces:
  - `dispatchRefusal(tx: Pick<StoreTransaction, 'pages'>, harness: Pick<Harness, 'jdArea' | 'repository'>): Promise<Refused | null>`
  - `seedPlatformPage(db: AnyExecutor, seed: { readonly id: string; readonly jdArea: string; readonly repositories: readonly string[] }): Promise<void>` (creates the active page, or adds the repositories to the existing one)
  - `platformPageIdOf(jdArea: JdArea): string` in `sim/fixtures.ts`; `createSimHarness` option `dispatchable?: boolean` (default `true`)

- [ ] **Step 1: Write the failing tests**

`sim/kernel/dispatch.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { rewritePageFrontmatter, rewritePageStatus, seedPlatformPage } from '@uw/db/test-seed';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createSimHarness,
  platformPageIdOf,
  simAdvance,
  simAgent,
  simCaller,
} from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = { readonly world: World; readonly itemId: string; claim(): Promise<string | null> };

async function atScope(world: World): Promise<Scene> {
  const { harness, admin } = await createSimHarness(world, software, { dispatchable: false });
  const caller = simCaller(world, admin);
  const { itemId } = value(
    await world.kernel.items.enqueue(caller, {
      harnessId: harness.id,
      title: 'Show the board',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
  );
  await simAdvance(world, { harnessId: harness.id, itemId, worker: admin, through: ['package'] });
  const agent = simAgent(admin, `${admin.personId ?? ''}/builder`, { interactive: true });
  const claim = async () =>
    reasonOf(await world.kernel.items.claim(simCaller(world, agent), { itemId, delegationId: null }));
  return { world, itemId, claim };
}

async function inWorld(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await atScope(world));
  } finally {
    await world.close();
  }
}

const pageId = platformPageIdOf('80-89');

describe('GL-6 ownership gate on dispatch', () => {
  it('refuses an agent claim dispatch_list_unavailable while the area has no platform page', () =>
    inWorld(async (scene) => {
      expect(await scene.claim()).toBe('dispatch_list_unavailable');
    }));

  it('refuses repository_not_dispatchable when the list leaves the repository out', () =>
    inWorld(async (scene) => {
      const db = scene.world.database.db;
      await seedPlatformPage(db, { id: pageId, jdArea: '80-89', repositories: ['unfoldingWord/other'] });
      expect(await scene.claim()).toBe('repository_not_dispatchable');
    }));

  it('fails closed on a page short of active and on a list that does not parse', () =>
    inWorld(async (scene) => {
      const db = scene.world.database.db;
      await seedPlatformPage(db, { id: pageId, jdArea: '80-89', repositories: ['unfoldingWord/uw-platform'] });
      await rewritePageStatus(db, pageId, 'suggested');
      expect(await scene.claim()).toBe('dispatch_list_unavailable');
      await rewritePageStatus(db, pageId, 'active');
      await rewritePageFrontmatter(db, pageId, { dispatch_allowed: 'unfoldingWord/uw-platform' });
      expect(await scene.claim()).toBe('dispatch_list_unavailable');
    }));

  it('admits the claim once the repository is listed, in any case', () =>
    inWorld(async (scene) => {
      const db = scene.world.database.db;
      await seedPlatformPage(db, { id: pageId, jdArea: '80-89', repositories: ['UNFOLDINGWORD/UW-PLATFORM'] });
      expect(await scene.claim()).toBeNull();
    }));
});
```

(The repository-not-listed join refusal is pinned in Task 7, which builds the join.)

In `apps/uw-app/pages/gated-activation.pg.test.ts`: add `['platform', { dispatch_allowed: ['unfoldingWord/tc-admin-app'] }]` to `frontmatterByType`, `'platform'` to `gated`, and a block (import `confirmPage` from `./confirm.ts`):

```ts
describe.skipIf(!testServer)('GL-6 the platform page is activated only by a person confirming it', () => {
  it('creates a platform page short of active and lets an area editor confirm it', () =>
    withAppDatabase(async (db) => {
      const person = await editor(db);
      const { pageId, created } = create(db, person, 'platform', 'suggested');
      expect(await created).toMatchObject({ ok: true });
      const confirmed = await confirmPage(
        db,
        person,
        { command: 'confirm_page', requestId: crypto.randomUUID(), pageId, expectedVersion: 1 },
        crypto.randomUUID(),
        new Date(),
      );
      expect(confirmed).toMatchObject({ ok: true, page: { status: 'active' } });
    }));
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run sim/kernel/dispatch.test.ts`
Expected: FAIL; `seedPlatformPage` and `platformPageIdOf` are missing.

- [ ] **Step 3: The seed and the sim fixture**

`packages/db/test-seed.ts`: import `platformFrontmatterSchema, platformPageSlug` (a value import beside the existing type import) from `@uw/contracts`; append after `seedPage`:

```ts
export type SeedPlatformPage = {
  readonly id: string;
  readonly jdArea: string;
  readonly repositories: readonly string[];
};

export async function seedPlatformPage(db: AnyExecutor, seed: SeedPlatformPage): Promise<void> {
  const [held] = await db
    .select({ id: pages.id, frontmatter: pages.frontmatter })
    .from(pages)
    .where(and(eq(pages.jdArea, seed.jdArea), eq(pages.slug, platformPageSlug)));
  const listed = platformFrontmatterSchema.safeParse(held?.frontmatter);
  const before = listed.success ? listed.data.dispatch_allowed : [];
  const frontmatter = { dispatch_allowed: [...new Set([...before, ...seed.repositories])] };
  if (held !== undefined) {
    await db.update(pages).set({ frontmatter }).where(eq(pages.id, held.id));
    return;
  }
  await seedPage(db, {
    id: seed.id,
    type: 'platform',
    status: 'active',
    jdArea: seed.jdArea,
    slug: platformPageSlug,
    title: 'Platform',
    bodyMd: 'The repositories the platform may dispatch work onto.',
    frontmatter,
  });
}
```

`sim/fixtures.ts`: import `seedPlatformPage` beside the other seeds; `SimHarnessOptions` gains `readonly dispatchable?: boolean;`; add:

```ts
export function platformPageIdOf(jdArea: JdArea): string {
  return `00000000-0000-4000-8000-${`a${jdArea.replace('-', '')}`.padStart(12, '0')}`;
}

async function seedDispatch(world: World, harness: Harness): Promise<void> {
  if (harness.repository === null) return;
  await seedPlatformPage(world.database.db, {
    id: platformPageIdOf(harness.jdArea),
    jdArea: harness.jdArea,
    repositories: [harness.repository],
  });
}
```

and in `createSimHarness`, after the refusal check: `if (options.dispatchable !== false) await seedDispatch(world, outcome.value.harness);`. The page id is derived from the area, never from `world.adapters.ids`, so no existing scenario's ids move.

- [ ] **Step 4: The guard**

`packages/harness/items/dispatch.ts`:

```ts
import { platformFrontmatterSchema, type Harness } from '@uw/contracts';
import { sameRepository } from '../github/identifiers.ts';
import { refused, type Refused } from '../outcome.ts';
import type { StoreTransaction } from '../ports.ts';

type DispatchTransaction = Pick<StoreTransaction, 'pages'>;
type DispatchHarness = Pick<Harness, 'jdArea' | 'repository'>;

async function dispatchList(
  tx: DispatchTransaction,
  jdArea: string,
): Promise<readonly string[] | null> {
  const page = await tx.pages.read.platformFor(jdArea);
  if (page === null || page.type !== 'platform' || page.status !== 'active') return null;
  const parsed = platformFrontmatterSchema.safeParse(page.frontmatter);
  return parsed.success ? parsed.data.dispatch_allowed : null;
}

export async function dispatchRefusal(
  tx: DispatchTransaction,
  harness: DispatchHarness,
): Promise<Refused | null> {
  const { repository } = harness;
  if (repository === null) return null;
  const allowed = await dispatchList(tx, harness.jdArea);
  if (allowed === null) return refused('dispatch_list_unavailable', { jdArea: harness.jdArea });
  if (allowed.some((entry) => sameRepository(entry, repository))) return null;
  return refused('repository_not_dispatchable', { repository });
}
```

`packages/harness/items/claim.ts`: `import { dispatchRefusal } from './dispatch.ts';`, add

```ts
async function dispatchGuard(tx: StoreTransaction, scene: Scene): Promise<Refused | null> {
  return isAgent(scene.caller.actor) ? dispatchRefusal(tx, scene.harness) : null;
}
```

and in `claimIn` replace the `stale` line with:

```ts
  const stale =
    lockedGuards(locked, item) ??
    (await heldRefusal(tx, locked, item)) ??
    (await dispatchGuard(tx, locked));
```

`apps/uw-app/pages/confirm.ts`: `const CONFIRMABLE: ReadonlySet<string> = new Set(['learning', 'skill', 'platform']);`.

- [ ] **Step 5: Run the new tests**

Run: `npx vitest run sim/kernel/dispatch.test.ts` and `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/pages/gated-activation.pg.test.ts`
Expected: green.

- [ ] **Step 6: Commit the gate**

```bash
git add packages/harness/items/dispatch.ts packages/harness/items/claim.ts packages/db/test-seed.ts sim/fixtures.ts sim/kernel/dispatch.test.ts apps/uw-app/pages/confirm.ts apps/uw-app/pages/gated-activation.pg.test.ts
git commit -m "feat(harness): agents claim only on repositories the area's platform page lists

The platform page (gated, confirmed by a person) carries dispatch_allowed.
An agent claim on a harness whose repository is not listed refuses
repository_not_dispatchable; a missing, unconfirmed or unreadable list
refuses dispatch_list_unavailable. Person claims and harnesses with no
repository are not gated.

GL-6. S14-R3 S14-R4."
```

- [ ] **Step 7: Make the existing tests list their repositories**

Every scenario and test whose agent claims on a harness with a repository now needs the page. The sim's `createSimHarness` seeds it; the app rigs do not. Run the whole suite with the database:

```bash
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres pnpm test 2>&1 | tee /tmp/claude-step14-gl6.log | grep -B3 -A3 "dispatch_list_unavailable" | head -200
pnpm sim:all 2>&1 | grep -B3 "dispatch_list_unavailable" | head -50
```

For each failing file, add a `seedPlatformPage(db, { id: randomUUID(), jdArea: '80-89', repositories: [<the harness's repository>] })` where its harness is activated: in a shared rig when the rig activates the harness (likely `apps/uw-app/testing/commands.ts` `activated`, `apps/uw-app/testing/gate-world.ts`, `apps/uw-app/testing/board-world.ts`, `apps/uw-app/testing/run-host.ts`, `apps/uw-app/github/testing/gate-rig.ts`, `merge-rig.ts`, `ship-rig.ts`, `import-rig.ts`), otherwise in the test's own setup (candidates: `apps/uw-app/mcp/*.pg.test.ts`, `apps/uw-app/harness/*-race.pg.test.ts`). Do not change any assertion; if a test only passes by asserting the new refusal, it is a defect in the change, not the test: stop and report it. Seeding the same area twice is safe (it adds to the list).

Run the two commands again until neither prints a refusal, then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres pnpm test && pnpm sim:all`.
Expected: green.

```bash
git add -A apps/uw-app sim
git commit -m "test: the rigs list their repositories on the area's platform page

Agent claims now need the dispatch list (GL-6); every rig that activates a
harness with a repository seeds it. No assertion changed.

GL-6."
```

---

### Task 7: Joining by review request in the kernel (GL-3)

**Files:**
- Modify: `packages/harness/items/record.ts` (`NewItem` gains the pull request and head; `createItem` writes them only when set)
- Modify: `packages/harness/items/fold.ts` (`created` reads them)
- Create: `packages/harness/items/join.ts`
- Modify: `packages/harness/items/commands.ts` (`join`)
- Modify: `packages/harness/index.ts` (types `JoinInput`, `Joined`)
- Modify: `packages/harness/gates/ship-input.ts` (`usableHead`, S14-R6)
- Modify: `packages/harness/gates/ship-input.test.ts` (one test)
- Create: `sim/joining.ts`
- Create: `sim/kernel/join.test.ts`

**Interfaces:**
- Consumes: Task 3 `byPullRequest`; Task 5 `hasPackageStage`; Task 6 `dispatchRefusal`; Task 4 `requestsPlatformReviewer`.
- Produces:
  - `JoinInput = { readonly pullRequest: PullRequestRef; readonly head: string; readonly title: string; readonly requestedReviewers: readonly string[] }`
  - `Joined = { readonly item: ItemState; readonly created: boolean }`
  - `ItemCommands.join(caller: Caller, input: JoinInput): Promise<KernelOutcome<Joined>>` (import principal only)
  - `sim/joining.ts`: `joinedRepository`, `joinedPull`, `joinedHead`, `joinedFacts(world, input?)`, `joinRequest(world, overrides?)`, `joinedWorld(world, { shadow, externalReviewerIdentities? })` returning `JoinedWorld`, `startReview(scene)`, `approveVerdict`

- [ ] **Step 1: The sim helper**

`sim/joining.ts`:

```ts
import { principalSchema, type Principal } from '@uw/contracts';
import {
  checkOnly,
  type Caller,
  type PullRequestFacts,
  type PullRequestRef,
  type ReviewFact,
} from '@uw/harness';
import {
  createSimHarness,
  readSpend,
  simCaller,
  simDelegate,
  simIngest,
  simPerson,
  simSystem,
} from './fixtures.ts';
import { builderFrontmatter, seedPersona, value } from './runs.ts';
import { greenFacts, simSha } from './ship-fixtures.ts';
import type { World } from './world.ts';

export const joinedRepository = 'unfoldingWord/tc-admin-app';
export const joinedPull: PullRequestRef = { repo: joinedRepository, number: 12 };
export const joinedHead = simSha('c0ffee');
const reviewer = 'agent:reviewer';
const reviewerPage = '00000000-0000-4000-8000-000000009901';

export type JoinedWorld = {
  readonly world: World;
  readonly harnessId: string;
  readonly admin: Principal;
  readonly owner: Principal;
  readonly delegationId: string;
  readonly itemId: string;
  readonly persona: Principal;
  readonly ingest: Caller;
  readonly host: Caller;
};

type FactsInput = { readonly head?: string; readonly reviews?: readonly ReviewFact[] };

export function joinedFacts(world: World, input: FactsInput = {}): PullRequestFacts {
  const head = input.head ?? joinedHead;
  const facts = greenFacts(world, { itemId: 'joined', head, reviews: input.reviews ?? [], ref: joinedPull });
  return { ...facts, headRef: 'feature/login-form' };
}

type JoinOverrides = { readonly pullRequest?: PullRequestRef; readonly head?: string; readonly requestedReviewers?: readonly string[] };

export function joinRequest(world: World, overrides: JoinOverrides = {}) {
  return world.kernel.items.join(simCaller(world, simIngest()), {
    pullRequest: overrides.pullRequest ?? joinedPull,
    head: overrides.head ?? joinedHead,
    title: 'Fix the login form',
    requestedReviewers: overrides.requestedReviewers ?? ['uw-reviewer[bot]'],
  });
}

function reviewerPrincipal(owner: Principal): Principal {
  return principalSchema.parse({
    identity: reviewer,
    kind: 'agent',
    personId: owner.personId,
    email: null,
    grants: [],
    interactive: false,
  });
}

type JoinedOptions = { readonly shadow: boolean; readonly externalReviewerIdentities?: readonly string[] };

export async function joinedWorld(world: World, options: JoinedOptions): Promise<JoinedWorld> {
  const { harness, admin } = await createSimHarness(world, checkOnly, {
    key: 'tc-admin-app',
    repository: joinedRepository,
    shadow: options.shadow,
    externalReviewerIdentities: options.externalReviewerIdentities ?? [],
  });
  await readSpend(world);
  const owner = await simPerson(world, 4, [{ role: 'admin', scopeKind: 'jd_area', scopeArea: '80-89' }]);
  const granted = await simDelegate(world, owner, {
    harnessId: harness.id,
    persona: reviewer,
    capability: 'review',
    expiresAt: null,
    supersedes: null,
  });
  world.adapters.githubFacts.given(joinedFacts(world));
  const { item } = value(await joinRequest(world));
  const scene = { world, harnessId: harness.id, owner };
  await seedPersona(scene, {
    id: reviewerPage,
    frontmatter: builderFrontmatter(scene, {
      identity: reviewer,
      engine: 'openrouter-messages',
      model: 'z-ai/glm-5.3',
      provider: 'deepinfra',
      capability: 'review',
      toolset: ['read_page', 'record_run_step'],
    }),
  });
  return {
    world,
    harnessId: harness.id,
    admin,
    owner,
    delegationId: value(granted).id,
    itemId: item.itemId,
    persona: reviewerPrincipal(owner),
    ingest: simCaller(world, simIngest()),
    host: simCaller(world, simSystem()),
  };
}

export async function startReview(scene: JoinedWorld): Promise<string> {
  const started = await scene.world.kernel.runs.start(simCaller(scene.world, scene.persona), {
    itemId: scene.itemId,
    delegationId: scene.delegationId,
    personaPageId: reviewerPage,
  });
  return value(started).runId;
}

export const approveVerdict = {
  verdict: 'approve' as const,
  findings: ['The form validates as it should.'],
  resolvedProvider: 'deepinfra',
  resolvedModel: 'z-ai/glm-5.3',
};
```

`startReview` and `approveVerdict` are used from Task 8; if knip flags them as unused at this task's commit, keep them anyway (Task 8 lands before `pnpm verify` runs in Task 12) or move them into Task 8's commit.

- [ ] **Step 2: Write the failing tests**

`sim/kernel/join.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { checkOnly, readAllEvents, software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simIan } from '../fixtures.ts';
import { joinedHead, joinedPull, joinedRepository, joinRequest } from '../joining.ts';
import { reasonOf, value } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

async function createdEvents(world: World, harnessId: string) {
  const events = await world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, null));
  return events.filter((event) => event.name === 'item_created');
}

describe('GL-3 joining by review request', () => {
  it('enqueues one item at Check with the head as its expected head and no harness branch', () =>
    inWorld(async (world) => {
      const { harness } = await createSimHarness(world, checkOnly, { repository: joinedRepository });
      const first = value(await joinRequest(world));
      expect(first.created).toBe(true);
      expect(first.item).toMatchObject({
        stageKey: 'check',
        pullRequest: joinedPull,
        expectedHead: joinedHead,
        branchState: 'none',
        issue: null,
      });
      const again = value(await joinRequest(world, { head: 'b'.repeat(40) }));
      expect(again).toEqual({ item: first.item, created: false });
      expect(await createdEvents(world, harness.id)).toHaveLength(1);
    }));

  it('enqueues nothing on a repository with no harness, refusing no_harness_for_repo', () =>
    inWorld(async (world) => {
      expect(reasonOf(await joinRequest(world))).toBe('no_harness_for_repo');
    }));

  it('joins only when a platform Reviewer is requested, only for ingest, only without a Package stage', () =>
    inWorld(async (world) => {
      await createSimHarness(world, checkOnly, { repository: joinedRepository });
      expect(reasonOf(await joinRequest(world, { requestedReviewers: ['seth-k'] }))).toBe('not_permitted');
      const person = simCaller(world, await simIan(world));
      const byPerson = await world.kernel.items.join(person, {
        pullRequest: joinedPull,
        head: joinedHead,
        title: 'x',
        requestedReviewers: ['uw-reviewer[bot]'],
      });
      expect(reasonOf(byPerson)).toBe('not_permitted');
      await createSimHarness(world, software, { key: 'other', repository: 'unfoldingWord/other' });
      const onSoftware = await joinRequest(world, { pullRequest: { repo: 'unfoldingWord/other', number: 3 } });
      expect(reasonOf(onSoftware)).toBe('transition_not_allowed');
    }));

  it('GL-6 refuses a join on a repository the area does not list', () =>
    inWorld(async (world) => {
      await createSimHarness(world, checkOnly, { repository: joinedRepository, dispatchable: false });
      expect(reasonOf(await joinRequest(world))).toBe('dispatch_list_unavailable');
    }));
});
```

In `packages/harness/gates/ship-input.test.ts`, add (reuse the file's own item, facts and harness builders; read lines 1 to 80 first and copy their names):

```ts
describe('GL-3 a joined item counts its head without a harness branch', () => {
  it('reads the head of a joined pull request and still needs the branch once a harness branch exists', () => {
    const joined = { ...item, pullRequest: ref, expectedHead: head, branchState: 'none' as const };
    const foreignRef = { ...facts, headRef: 'feature/login-form' };
    expect(usableHead(foreignRef, joined, harness)).toBe(head);
    expect(usableHead(foreignRef, { ...joined, branchState: 'active' }, harness)).toBeNull();
  });
});
```

where `item`, `facts`, `ref`, `head` and `harness` are the names the file already uses for a ready item, its facts, its pull request, its head and its harness; import `usableHead` from `./ship-input.ts` if the file does not.

- [ ] **Step 3: Run them and see them fail**

Run: `npx vitest run sim/kernel/join.test.ts packages/harness/gates/ship-input.test.ts`
Expected: FAIL; `items.join` does not exist; `usableHead` returns null for the joined item.

- [ ] **Step 4: Items carry a joined pull request from creation**

`packages/harness/items/record.ts`: `NewItem` gains

```ts
  readonly pullRequest?: NonNullable<ItemState['pullRequest']> | null;
  readonly expectedHead?: string | null;
```

Add:

```ts
function createdDraft(initial: NewItem): EventDraft {
  const evidence = {
    stage: initial.stageKey,
    title: initial.title,
    pageId: initial.pageId,
    priority: initial.priority,
    due: initial.due,
    issue: initial.issue,
  };
  const pullRequest = initial.pullRequest ?? null;
  const expectedHead = initial.expectedHead ?? null;
  if (pullRequest === null || expectedHead === null) return { name: 'item_created', evidence };
  return {
    name: 'item_created',
    evidence: { ...evidence, pullRequest: { ...pullRequest }, expectedHead },
  };
}
```

and in `createItem` replace the `draft('item_created', {...})` argument with `createdDraft(initial)`. Items that do not join keep exactly the evidence keys they had (GH-3's scenario asserts them), and `stamp` still validates the evidence against the `item_created` schema, defaults included.

`packages/harness/items/fold.ts`, in `created`: replace `expectedHead: null,` with `expectedHead: evidence.expectedHead,` and `pullRequest: null,` with `pullRequest: evidence.pullRequest,`.

- [ ] **Step 5: The join**

`packages/harness/items/join.ts`:

```ts
import { pullRequestRefSchema, type ItemState } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { fullSha } from '../github/identifiers.ts';
import { requestsPlatformReviewer } from '../github/reviewers.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports, PullRequestRef, StoreTransaction } from '../ports.ts';
import { hasPackageStage } from '../stages/package.ts';
import { dispatchRefusal } from './dispatch.ts';
import { isImportPrincipal } from './import.ts';
import { createItem, recordContext, type RecordContext } from './record.ts';

type JoinPorts = Pick<Ports, 'clock' | 'ids' | 'store'>;

export type JoinInput = {
  readonly pullRequest: PullRequestRef;
  readonly head: string;
  readonly title: string;
  readonly requestedReviewers: readonly string[];
};
export type Joined = { readonly item: ItemState; readonly created: boolean };

const CHECK_STAGE = 'check';
const TITLE_LIMIT = 200;

function titleOf(input: JoinInput): string {
  const trimmed = input.title.trim().slice(0, TITLE_LIMIT);
  return trimmed === '' ? `${input.pullRequest.repo}#${input.pullRequest.number}` : trimmed;
}

async function joinIn(
  tx: StoreTransaction,
  context: RecordContext,
  input: JoinInput,
  head: string,
): Promise<KernelOutcome<Joined>> {
  const { pullRequest } = input;
  const repository = pullRequest.repo;
  const found = await tx.harnesses.read.byRepository(repository);
  if (found === null) return refused('no_harness_for_repo', { repository });
  await tx.lock(lockKeys.harnessStages(found.id));
  const harness = await tx.harnesses.read.byId(found.id);
  if (harness === null) return refused('no_harness_for_repo', { repository });
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  if (hasPackageStage(stages)) {
    return refused('transition_not_allowed', { why: 'harness_has_package', harnessId: harness.id });
  }
  const check = stages.find((stage) => stage.key === CHECK_STAGE);
  if (check === undefined) return refused('stage_not_found', { stage: CHECK_STAGE });
  const undispatchable = await dispatchRefusal(tx, harness);
  if (undispatchable !== null) return undispatchable;
  const existing = await tx.harnessItems.read.byPullRequest(harness.id, pullRequest);
  if (existing !== null) return accepted({ item: existing, created: false });
  const recorded = await createItem(tx, context, {
    itemId: context.ids.next(),
    harnessId: harness.id,
    stageKey: check.key,
    title: titleOf(input),
    pageId: null,
    priority: 0,
    due: null,
    issue: null,
    pullRequest: { repo: pullRequest.repo, number: pullRequest.number },
    expectedHead: head,
  });
  return accepted({ item: recorded.item, created: true });
}

export async function joinByReviewRequest(
  ports: JoinPorts,
  caller: Caller,
  input: JoinInput,
): Promise<KernelOutcome<Joined>> {
  if (!isImportPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  const head = fullSha(input.head);
  if (head === null || !pullRequestRefSchema.safeParse(input.pullRequest).success) {
    return refused('malformed_command', { field: 'pullRequest' });
  }
  if (!requestsPlatformReviewer(input.requestedReviewers)) {
    return refused('not_permitted', { why: 'reviewer_not_requested' });
  }
  const at = ports.clock.now();
  const context = recordContext(ports, caller, at);
  return ports.store.transaction((tx) => joinIn(tx, context, input, head));
}
```

If `joinIn` passes 25 statements, move the `createItem` call into `function joinedItem(tx, context, harnessId, …)`.

`packages/harness/items/commands.ts`: import `joinByReviewRequest, type Joined, type JoinInput` from `./join.ts`; `ItemCommands` gains `join(caller: Caller, input: JoinInput): Promise<KernelOutcome<Joined>>;`; `createItemCommands` gains `join: (caller, input) => joinByReviewRequest(ports, caller, input),`.

`packages/harness/index.ts`: `export type { Joined, JoinInput } from './items/join.ts';`.

- [ ] **Step 6: The joined head counts (S14-R6)**

`packages/harness/gates/ship-input.ts`, in `usableHead`, replace `if (facts.headRef !== branchFor(item.itemId)) return null;` with:

```ts
  const joined = item.branchState === 'none';
  if (!joined && facts.headRef !== branchFor(item.itemId)) return null;
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run sim/kernel/join.test.ts packages/harness/gates packages/harness/items sim/kernel/import.test.ts sim/kernel/events.test.ts` then `pnpm sim -- GH-3`
Expected: green; GH-3's exact-keys assertion still holds.

- [ ] **Step 8: Commit**

```bash
git add packages/harness/items packages/harness/gates/ship-input.ts packages/harness/gates/ship-input.test.ts packages/harness/index.ts sim/joining.ts sim/kernel/join.test.ts
git commit -m "feat(harness): a review request joins a check-only harness once

items.join, for the ingest principal, enqueues one item at Check per pull
request with the requested head as its expected head and no harness
branch. No harness refuses no_harness_for_repo; a Package stage refuses
transition_not_allowed; the dispatch list applies. A joined item's head
counts without a harness/<item> ref.

GL-3 GL-6. S14-R5 S14-R6."
```

---

### Task 8: Shadow in the kernel: the recorded verdict, the shadow verdict, no write (GL-4)

**Files:**
- Create: `packages/harness/gates/shadow-verdict.ts` (pure)
- Create: `packages/harness/gates/shadow.ts` (records)
- Modify: `packages/harness/gates/commands.ts` (`recordShadowVerdicts`)
- Modify: `packages/harness/gates/decide.ts` (`shadowRefusal`)
- Modify: `packages/harness/runs/review.ts` (shadow branch)
- Modify: `packages/harness/index.ts` (type `ShadowInput`)
- Modify: `tools/architecture/connector-callers.test.ts` (shared root: the preview caller list)
- Create: `sim/kernel/shadow.test.ts`
- Create: `sim/scenarios/GL-4.a-shadow-harness-records-verdicts-and-writes-nothing-to-github.ts`

**Interfaces:**
- Consumes: Task 7 `sim/joining.ts`, `byPullRequest`; Task 4 `Harness.shadow`.
- Produces:
  - `shadowVerdictOf(source: ShadowSource): EventEvidence['shadow_verdict']`, `lastShadowVerdict(events)`, `sameVerdict(a, b)` in `shadow-verdict.ts`
  - `GateCommands.recordShadowVerdicts(caller: Caller, input: ShadowInput): Promise<KernelOutcome<readonly ItemState[]>>` with `ShadowInput = { readonly pullRequest: PullRequestRef }` (ingest or system principal only; returns the items it recorded a verdict on, zero or one)

- [ ] **Step 1: Write the failing tests**

`sim/kernel/shadow.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simAdvance, simCaller } from '../fixtures.ts';
import { approveVerdict, joinedHead, joinedPull, joinedWorld, startReview, type JoinedWorld } from '../joining.ts';
import { reasonOf, value } from '../runs.ts';
import { itemLog } from '../ship-fixtures.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inShadow(work: (scene: JoinedWorld) => Promise<void>, shadow = true): Promise<void> {
  const world = await createWorld();
  try {
    await work(await joinedWorld(world, { shadow }));
  } finally {
    await world.close();
  }
}

async function named(scene: JoinedWorld, name: string) {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, scene.itemId),
  );
  return events.filter((event) => event.name === name);
}

function recordVerdicts(scene: JoinedWorld) {
  return scene.world.kernel.gates.recordShadowVerdicts(scene.ingest, { pullRequest: joinedPull });
}

describe('GL-4 shadow mode', () => {
  it('records the Reviewer verdict as review_verdict_recorded and posts no GitHub review', () =>
    inShadow(async (scene) => {
      const runId = await startReview(scene);
      const run = value(await scene.world.kernel.runs.postReview(scene.host, runId, approveVerdict));
      expect(run.outcome).toBe('completed');
      expect(scene.world.adapters.connectors.reviews()).toEqual([]);
      const [recorded] = await named(scene, 'review_verdict_recorded');
      expect(recorded?.evidence).toMatchObject({ runId, head: joinedHead, reviewer: 'uw-reviewer', verdict: 'approve' });
      const [completed] = await named(scene, 'run_completed');
      expect(completed?.evidence).toMatchObject({ result: 'review_withheld', review: { reviewId: null, verdict: 'approve' } });
    }));

  it('evaluates the ship rule on the head as shadow_verdict, once per change', () =>
    inShadow(async (scene) => {
      expect(value(await recordVerdicts(scene))).toHaveLength(1);
      expect(value(await recordVerdicts(scene))).toHaveLength(0);
      const runId = await startReview(scene);
      value(await scene.world.kernel.runs.postReview(scene.host, runId, approveVerdict));
      const verdicts = (await named(scene, 'shadow_verdict')).map((event) => event.evidence);
      expect(verdicts).toEqual([
        { head: joinedHead, verdict: 'refuse', reasons: ['no_reviewer_approval'] },
        { head: joinedHead, verdict: 'advance', reasons: [] },
      ]);
    }));

  it('GL-4 calls no GitHub write port method in shadow mode, and refuses the Ship approval', () =>
    inShadow(async (scene) => {
      const { world, admin, harnessId, itemId } = scene;
      value(await recordVerdicts(scene));
      const runId = await startReview(scene);
      value(await world.kernel.runs.postReview(scene.host, runId, approveVerdict));
      const parked = await simAdvance(world, { harnessId, itemId, worker: admin, through: ['check', 'ship'] });
      expect(parked).toMatchObject({ stageKey: 'ship', gateStatus: 'parked' });
      const approved = await world.kernel.gates.decide(simCaller(world, admin), {
        itemId,
        decision: 'approve',
        reason: null,
        findings: [],
        seenHead: joinedHead,
      });
      expect(reasonOf(approved)).toBe('not_permitted');
      expect(world.adapters.connectors.calls()).toEqual([]);
      expect(world.adapters.connectors.reviews()).toEqual([]);
      expect((await itemLog(world, harnessId, itemId)).decisions).toEqual([]);
    }));

  it('posts the review once shadow is lifted', () =>
    inShadow(async (scene) => {
      value(await scene.world.kernel.stages.liftShadow(simCaller(scene.world, scene.admin), { harnessId: scene.harnessId }));
      const runId = await startReview(scene);
      value(await scene.world.kernel.runs.postReview(scene.host, runId, approveVerdict));
      expect(scene.world.adapters.connectors.reviews()).toHaveLength(1);
      expect(await named(scene, 'review_verdict_recorded')).toEqual([]);
    }));

  it('records no shadow verdict on a harness that is not in shadow', () =>
    inShadow(async (scene) => {
      expect(value(await recordVerdicts(scene))).toEqual([]);
    }, false));
});
```

`sim/scenarios/GL-4.a-shadow-harness-records-verdicts-and-writes-nothing-to-github.ts`:

```ts
import assert from 'node:assert/strict';
import { simAdvance, simCaller } from '../fixtures.ts';
import { approveVerdict, joinedHead, joinedPull, joinedWorld, startReview } from '../joining.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'GL-4',
  title:
    'a check-only harness in shadow records the Reviewer verdict and the ship rule verdict, refuses the Ship approval, and calls no GitHub write port method',
  run: async (world) => {
    const scene = await joinedWorld(world, { shadow: true });
    value(await world.kernel.gates.recordShadowVerdicts(scene.ingest, { pullRequest: joinedPull }));
    const runId = await startReview(scene);
    value(await world.kernel.runs.postReview(scene.host, runId, approveVerdict));
    await simAdvance(world, { harnessId: scene.harnessId, itemId: scene.itemId, worker: scene.admin, through: ['check', 'ship'] });
    const approve = await world.kernel.gates.decide(simCaller(world, scene.admin), {
      itemId: scene.itemId,
      decision: 'approve',
      reason: null,
      findings: [],
      seenHead: joinedHead,
    });
    assert.equal(approve.status, 'error');
    assert.deepEqual(world.adapters.connectors.calls(), []);
    assert.deepEqual(world.adapters.connectors.reviews(), []);
    return { state: { refused: approve.status === 'error' ? approve.reason : null } };
  },
});
```

If scenarios are discovered from a registry rather than the directory, add this one where `sim/scenarios` files are listed (grep `KN-18.activate-a-template` under `sim/` to find the list).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run sim/kernel/shadow.test.ts`
Expected: FAIL; `gates.recordShadowVerdicts` does not exist and the review is posted.

- [ ] **Step 3: The pure verdict**

`packages/harness/gates/shadow-verdict.ts`:

```ts
import {
  eventEvidenceSchemas,
  type EventEvidence,
  type Harness,
  type HarnessEvent,
  type ItemState,
  type Principal,
} from '@uw/contracts';
import { fullSha } from '../github/identifiers.ts';
import { reviewerIdentities } from '../github/reviewers.ts';
import type { PullRequestFacts, ReviewFact } from '../ports.ts';
import { shipPreview } from './approve-at-ship.ts';

export type ShadowVerdict = EventEvidence['shadow_verdict'];

export type ShadowSource = {
  readonly facts: PullRequestFacts | null;
  readonly item: ItemState;
  readonly harness: Harness;
  readonly events: readonly HarnessEvent[];
  readonly approver: Principal;
  readonly at: Date;
};

const RECORDED_REVIEW_ID = 0;
const approverBound = 'approver_lacks_domain_grant';

function loginOf(reviewer: string): string | null {
  return reviewerIdentities.find((entry) => entry.reviewer === reviewer)?.login ?? null;
}

function recordedReviews(event: HarnessEvent): readonly ReviewFact[] {
  if (event.name !== 'review_verdict_recorded') return [];
  const recorded = eventEvidenceSchemas.review_verdict_recorded.parse(event.evidence);
  const login = loginOf(recorded.reviewer);
  if (login === null) return [];
  return [
    {
      reviewId: RECORDED_REVIEW_ID,
      reviewer: login,
      commit: recorded.head,
      state: recorded.verdict === 'approve' ? 'approved' : 'changes_requested',
      provider: recorded.provider,
      findings: [...recorded.findings],
      submittedAt: new Date(event.at),
    },
  ];
}

function withRecorded(facts: PullRequestFacts, events: readonly HarnessEvent[]): PullRequestFacts {
  return { ...facts, reviews: [...facts.reviews, ...events.flatMap(recordedReviews)] };
}

export function shadowVerdictOf(source: ShadowSource): ShadowVerdict {
  const facts = source.facts === null ? null : withRecorded(source.facts, source.events);
  const { item, harness, approver, at } = source;
  const preview = shipPreview({ facts, item, harness, approver, at, override: false });
  const reasons =
    preview.outcome.verdict === 'advance'
      ? []
      : preview.outcome.reasons.filter((reason) => reason !== approverBound);
  const head = preview.input.pullRequest === null ? null : fullSha(preview.input.pullRequest.head);
  return { head, verdict: reasons.length === 0 ? 'advance' : 'refuse', reasons };
}

export function lastShadowVerdict(events: readonly HarnessEvent[]): ShadowVerdict | null {
  const last = events.findLast((event) => event.name === 'shadow_verdict');
  return last === undefined ? null : eventEvidenceSchemas.shadow_verdict.parse(last.evidence);
}

export function sameVerdict(left: ShadowVerdict, right: ShadowVerdict): boolean {
  return (
    left.head === right.head &&
    left.verdict === right.verdict &&
    left.reasons.join(',') === right.reasons.join(',')
  );
}
```

- [ ] **Step 4: The recorder**

`packages/harness/gates/shadow.ts`:

```ts
import { pullRequestRefSchema, type ItemState, type Principal } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { isImportPrincipal } from '../items/import.ts';
import { draft, readAllEvents, recordContext, recordItemEvents, type RecordContext } from '../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import { FactsUnavailableError } from '../port-errors.ts';
import type { Ports, PullRequestFacts, PullRequestRef, StoreTransaction } from '../ports.ts';
import { lastShadowVerdict, sameVerdict, shadowVerdictOf } from './shadow-verdict.ts';

type ShadowPorts = Pick<Ports, 'clock' | 'githubFacts' | 'ids' | 'store'>;

export type ShadowInput = { readonly pullRequest: PullRequestRef };

type Seen = {
  readonly facts: PullRequestFacts | null;
  readonly pullRequest: PullRequestRef;
  readonly approver: Principal;
};

async function readFacts(ports: ShadowPorts, ref: PullRequestRef): Promise<PullRequestFacts | null> {
  try {
    return await ports.githubFacts.pullRequest(ref);
  } catch (error) {
    if (error instanceof FactsUnavailableError) return null;
    throw error;
  }
}

async function recordIn(
  tx: StoreTransaction,
  context: RecordContext,
  seen: Seen,
): Promise<readonly ItemState[]> {
  const harness = await tx.harnesses.read.byRepository(seen.pullRequest.repo);
  if (harness === null || !harness.shadow) return [];
  const found = await tx.harnessItems.read.byPullRequest(harness.id, seen.pullRequest);
  const item = found === null ? null : await tx.harnessItems.read.lock(found.itemId);
  if (item === null || item.gateStatus === 'done') return [];
  const events = await readAllEvents(tx, harness.id, item.itemId);
  const { facts, approver } = seen;
  const verdict = shadowVerdictOf({ facts, item, harness, events, approver, at: context.at });
  const last = lastShadowVerdict(events);
  if (last !== null && sameVerdict(last, verdict)) return [];
  const recorded = await recordItemEvents(tx, context, item.itemId, [draft('shadow_verdict', verdict)]);
  return [recorded.item];
}

export async function recordShadowVerdicts(
  ports: ShadowPorts,
  caller: Caller,
  input: ShadowInput,
): Promise<KernelOutcome<readonly ItemState[]>> {
  const approver = caller.actor;
  if (!isImportPrincipal(approver)) return refused('not_permitted', { actor: approver.identity });
  if (!pullRequestRefSchema.safeParse(input.pullRequest).success) {
    return refused('malformed_command', { field: 'pullRequest' });
  }
  const facts = await readFacts(ports, input.pullRequest);
  const context = recordContext(ports, caller, ports.clock.now());
  const seen = { facts, pullRequest: input.pullRequest, approver };
  return accepted(await ports.store.transaction((tx) => recordIn(tx, context, seen)));
}
```

`packages/harness/gates/commands.ts`: import `recordShadowVerdicts, type ShadowInput` from `./shadow.ts` and `ItemState` from `@uw/contracts`; `GateCommands` gains `recordShadowVerdicts(caller: Caller, input: ShadowInput): Promise<KernelOutcome<readonly ItemState[]>>;`; `createGateCommands` gains `recordShadowVerdicts: (caller, input) => recordShadowVerdicts(ports, caller, input),`.

`packages/harness/index.ts`: `export type { ShadowInput } from './gates/shadow.ts';`.

- [ ] **Step 5: The Reviewer in shadow**

`packages/harness/runs/review.ts`: import `recordShadowVerdicts` from `../gates/shadow.ts`; add:

```ts
const FINDINGS_LIMIT = 50;
const FINDING_LENGTH = 500;

function boundedFindings(findings: readonly string[]): string[] {
  return findings
    .map((finding) => finding.trim().slice(0, FINDING_LENGTH))
    .filter((finding) => finding !== '')
    .slice(0, FINDINGS_LIMIT);
}

async function shadowReview(
  ports: ReviewPorts,
  caller: Caller,
  runId: string,
  input: { readonly scene: RunScene; readonly review: PostReviewInput },
): Promise<KernelOutcome<RunRow>> {
  const grounds = groundsOf(input.scene, input.review);
  if (grounds === null) return complete(ports, caller, runId, { result: 'review_withheld', review: null });
  const { record } = plannedFrom(grounds, input.review);
  const done = await completeAfter(ports, caller, runId, {
    result: 'review_withheld',
    review: { ...record, reviewId: null },
    before: () => [
      draft('review_verdict_recorded', {
        runId,
        head: grounds.target.head,
        ...record,
        findings: boundedFindings(input.review.findings),
      }),
    ],
  });
  if (done.status !== 'accepted') return done;
  await recordShadowVerdicts(ports, caller, { pullRequest: grounds.target.ref });
  return done;
}
```

and in `postReview`, after `if (scene.status !== 'accepted') return scene;`:

```ts
  if (scene.value.harness.shadow) {
    return shadowReview(ports, caller, runId, { scene: scene.value, review: input });
  }
```

`record.model` is the parsed model or `'unreported'`; if `modelIdSchema` refuses `'unreported'` in the event, check `UNREPORTED_MODEL` against `modelIdSchema` first (it is already used in the `run_completed` review record, so it parses).

- [ ] **Step 6: No Ship approval in shadow (S14-R9)**

`packages/harness/gates/decide.ts`: add

```ts
function shadowRefusal(gate: Gate, route: Route): Refused | null {
  if (!gate.harness.shadow || route.connector === null) return null;
  return refused('not_permitted', { why: 'shadow', harnessId: gate.harness.id });
}
```

and in `decideIn`, after `if (isRefused(route)) return route;`:

```ts
  const shadow = shadowRefusal(gate, route);
  if (shadow !== null) return shadow;
```

- [ ] **Step 7: The architecture allowlist (shared root, own commit)**

`tools/architecture/connector-callers.test.ts`, in `finds the ship preview defined beside the approve-at-Ship path and called only from the gate view`, change the list to:

```ts
    expect(filesMatching(previewCall, sources())).toEqual([
      approveAtShip,
      'packages/harness/gates/shadow-verdict.ts',
      'packages/harness/gates/view.ts',
    ]);
```

and its title to `'finds the ship preview defined beside the approve-at-Ship path and called only from the gate view and the shadow verdict'`.

```bash
git add tools/architecture/connector-callers.test.ts
git commit -m "test(architecture): the shadow verdict may call the ship preview

Shared root tools/architecture. The shadow verdict (GL-4) is the second
reader of shipPreview; the ship rule and the assembler keep their single
callers.

GL-4. S14-R8."
```

(Commit this after Step 8 passes, so the allowlist and its caller land together in sequence.)

- [ ] **Step 8: Run the tests**

Run: `npx vitest run sim/kernel/shadow.test.ts sim/kernel/run-review.test.ts sim/kernel/gate-command.test.ts tools/architecture/connector-callers.test.ts` then `pnpm sim -- GL-4`
Expected: green.

- [ ] **Step 9: Commit**

```bash
git add packages/harness/gates packages/harness/runs/review.ts packages/harness/index.ts sim/kernel/shadow.test.ts sim/scenarios/GL-4.a-shadow-harness-records-verdicts-and-writes-nothing-to-github.ts
git commit -m "feat(harness): shadow records the Reviewer and ship-rule verdicts and writes nothing

On a shadow harness the Reviewer's verdict is review_verdict_recorded and no
review is posted; the ship rule, with the recorded verdicts as if posted,
is recorded as shadow_verdict when it changes; an approve at a connector
stage is refused. A test proves no GitHub write port method is called.

GL-4. S14-R7 S14-R8 S14-R9."
```

---

### Task 9: The app follows pull requests: requested reviewers, joins and shadow verdicts (GL-3, GL-4)

**Files:**
- Modify: `apps/uw-app/github/payloads.ts` (`requested_reviewers` on `pullSchema`)
- Modify: `apps/uw-app/github/facts/records.ts` (`PullRequestRecord.requestedReviewers`)
- Modify: `apps/uw-app/github/facts/normalise.ts` (`pullOf`)
- Modify: `apps/uw-app/github/facts/upsert.ts` (`pullColumns`, the insert copy)
- Modify: `apps/uw-app/github/facts/queries.ts` (`PullRequestChange` gains `title`, `open`, `requestedReviewers`)
- Modify: `apps/uw-app/github/import.ts` (export `callerFor`)
- Create: `apps/uw-app/github/join.ts`
- Modify: `apps/uw-app/github/follow-up.ts`
- Modify: `apps/uw-app/github/facts/normalise.test.ts` (one test)
- Create: `apps/uw-app/github/join.pg.test.ts`
- Modify: every `PullRequestRecord` or `PullRequestChange` literal `pnpm check` then flags (add `requestedReviewers: []`, and `title`, `open` for changes)

**Interfaces:**
- Consumes: Task 7 `kernel.items.join`; Task 8 `kernel.gates.recordShadowVerdicts`; Task 4 `requestsPlatformReviewer`.
- Produces: `followPullRequestJoins(deps: GitHubDeps, changes: readonly PullRequestChange[], logger: Logger): Promise<void>`; log outcomes `pull_request_joined`, `pull_request_already_joined`, the refusal reason (including `no_harness_for_repo`), `shadow_verdict`.

- [ ] **Step 1: Write the failing tests**

In `apps/uw-app/github/facts/normalise.test.ts` (reuse the file's REST pull fixture and repo record; read its top first):

```ts
describe('GL-3 the facts carry the requested reviewers', () => {
  it('reads the requested logins from a pull request, once each, and none when absent', () => {
    const requested = {
      ...restPull,
      requested_reviewers: [{ login: 'uw-reviewer[bot]' }, { login: 'seth-k' }, { login: 'seth-k' }],
    };
    expect(factsFromPull(repo, requested)?.pullRequests[0]?.requestedReviewers).toEqual([
      'uw-reviewer[bot]',
      'seth-k',
    ]);
    expect(factsFromPull(repo, restPull)?.pullRequests[0]?.requestedReviewers).toEqual([]);
  });
});
```

`apps/uw-app/github/join.pg.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedPlatformPage } from '@uw/db/test-seed';
import { checkOnly } from '@uw/harness';
import { accepted, callerOf, ian } from '../testing/commands.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import type { GitHubAppConfig } from './app-config.ts';
import restPull from './fixtures/rest-pull.json' with { type: 'json' };
import { fixtureApp } from './testing/app-key.ts';
import { head } from './testing/facts-fixtures.ts';
import { firstRun, nextRun, platform, programmed, pullPath, sweepOnce } from './testing/sweep-rig.ts';

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function requested() {
  const github = programmed();
  github.on('GET', pullPath(7), {
    status: 200,
    body: { ...restPull, requested_reviewers: [{ login: 'uw-reviewer[bot]' }] },
  });
  return github;
}

async function checkOnlyOn(db: Database, shadow: boolean): Promise<string> {
  const harnessId = randomUUID();
  accepted(
    await kernelOn(db, { now: () => firstRun }).stages.activate(callerOf(await ian(db)), {
      harnessId,
      harnessKey: 'uw-platform-review',
      jdArea: '80-89',
      template: checkOnly,
      repository: platform,
      shadow,
    }),
  );
  await seedPlatformPage(db, { id: randomUUID(), jdArea: '80-89', repositories: [platform] });
  return harnessId;
}

async function joinedItems(db: Database, harnessId: string) {
  const kernel = kernelOn(db, { now: () => nextRun });
  const items = await kernel.reads.inStage(callerOf(await ian(db)), {
    harnessId,
    stageKey: 'check',
    after: null,
    limit: 50,
  });
  return accepted(items).filter((item) => item.pullRequest !== null);
}

describe.skipIf(!testServer)('GL-3 the sweep joins a pull request that requests the Reviewer', () => {
  it('enqueues one item at Check with the head, once across two sweeps', () =>
    withAppDatabase(async (db) => {
      const harnessId = await checkOnlyOn(db, false);
      await sweepOnce(db, app, { github: requested(), at: firstRun });
      await sweepOnce(db, app, { github: requested(), at: nextRun });
      const items = await joinedItems(db, harnessId);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        pullRequest: { repo: platform, number: 7 },
        expectedHead: head,
        branchState: 'none',
      });
    }));

  it('logs no_harness_for_repo and enqueues nothing when the repository has no harness', () =>
    withAppDatabase(async (db) => {
      const { lines } = await sweepOnce(db, app, { github: requested(), at: firstRun });
      expect(lines.some((line) => line['outcome'] === 'no_harness_for_repo')).toBe(true);
    }));

  it('GL-4 records a shadow verdict for the joined pull request on a shadow harness', () =>
    withAppDatabase(async (db) => {
      await checkOnlyOn(db, true);
      const { lines } = await sweepOnce(db, app, { github: requested(), at: firstRun });
      expect(lines.some((line) => line['outcome'] === 'shadow_verdict')).toBe(true);
    }));
});
```

If `kernel.reads.inStage`'s input differs (read `packages/harness/reads/scene.ts` `StageItemsInput`), adapt `joinedItems`; if `head` is not exported from `facts-fixtures.ts` under that name, use the `head.sha` of `rest-pull.json`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run apps/uw-app/github/facts/normalise.test.ts` and `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/github/join.pg.test.ts`
Expected: FAIL; `requestedReviewers` is undefined and nothing is joined.

- [ ] **Step 3: Requested reviewers into the facts**

`apps/uw-app/github/payloads.ts`, in `pullSchema`: `requested_reviewers: z.array(z.object({ login: name })).optional(),` (use whatever the file calls its bounded login string; `name` is the head-ref string schema).

`apps/uw-app/github/facts/records.ts`, `PullRequestRecord` gains `readonly requestedReviewers: readonly string[];`.

`apps/uw-app/github/facts/normalise.ts`: add

```ts
const REQUESTED_LIMIT = 100;

function requestedOf(pull: Pull): readonly string[] {
  const logins = (pull.requested_reviewers ?? []).map((user) => user.login);
  return [...new Set(logins)].slice(0, REQUESTED_LIMIT);
}
```

and in `pullOf` after `milestoneId`: `requestedReviewers: requestedOf(pull),`.

`apps/uw-app/github/facts/upsert.ts`: add `requestedReviewers: ghPrs.requestedReviewers,` to `pullColumns`, and in `upsertPulls` change the values line to:

```ts
    .values(
      pulls.map((pull) => ({ ...pull, requestedReviewers: [...pull.requestedReviewers], freshAt })),
    )
```

(at most three added non-blank lines; the file must stay under 500).

`apps/uw-app/github/facts/queries.ts`: `PullRequestChange` gains `readonly title: string; readonly open: boolean; readonly requestedReviewers: readonly string[];` and `pullRequestChanges` maps `title: pull.title, open: pull.state === 'open', requestedReviewers: [...pull.requestedReviewers],`.

Run `pnpm check` and add `requestedReviewers: []` (and `title`, `open` for a change) to each literal it flags in test rigs (`apps/uw-app/github/testing/facts-fixtures.ts` and the `*.pg.test.ts` files under `apps/uw-app/github/`).

- [ ] **Step 4: The follow**

`apps/uw-app/github/import.ts`: `export function callerFor(logger: Logger): Caller {` (only the `export` changes).

`apps/uw-app/github/join.ts`:

```ts
import type { Logger } from '@uw/core/log';
import { requestsPlatformReviewer } from '@uw/harness';
import type { GitHubDeps } from './deps.ts';
import type { PullRequestChange } from './facts/queries.ts';
import { callerFor } from './import.ts';

function fieldsOf(change: PullRequestChange) {
  return { repository: change.repo, pull_request: change.number };
}

async function joinOne(deps: GitHubDeps, change: PullRequestChange, logger: Logger): Promise<void> {
  const joined = await deps.kernel.items.join(callerFor(logger), {
    pullRequest: { repo: change.repo, number: change.number },
    head: change.head,
    title: change.title,
    requestedReviewers: change.requestedReviewers,
  });
  if (joined.status !== 'accepted') {
    logger.info('pull request not joined', { outcome: joined.reason, ...fieldsOf(change) });
    return;
  }
  const outcome = joined.value.created ? 'pull_request_joined' : 'pull_request_already_joined';
  logger.info('pull request joined', { outcome, ...fieldsOf(change) });
}

async function shadowOne(deps: GitHubDeps, change: PullRequestChange, logger: Logger): Promise<void> {
  const pullRequest = { repo: change.repo, number: change.number };
  const recorded = await deps.kernel.gates.recordShadowVerdicts(callerFor(logger), { pullRequest });
  if (recorded.status !== 'accepted') {
    logger.warn('shadow verdict not recorded', { outcome: recorded.reason, ...fieldsOf(change) });
    return;
  }
  if (recorded.value.length > 0) {
    logger.info('shadow verdict recorded', { outcome: 'shadow_verdict', ...fieldsOf(change) });
  }
}

export async function followPullRequestJoins(
  deps: GitHubDeps,
  changes: readonly PullRequestChange[],
  logger: Logger,
): Promise<void> {
  for (const change of changes) {
    if (change.open && requestsPlatformReviewer(change.requestedReviewers)) {
      await joinOne(deps, change, logger);
    }
    await shadowOne(deps, change, logger);
  }
}
```

`apps/uw-app/github/follow-up.ts`: `import { followPullRequestJoins } from './join.ts';` and as the last line of `followUpserts`: `await followPullRequestJoins(unit, report.pullRequests, logger);`. Files are read first, so a shadow verdict sees the changed paths.

- [ ] **Step 5: Run the tests and the GitHub suite**

Run: `pnpm check && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/github`
Expected: green, including the existing sweep, ingest and upsert tests.

- [ ] **Step 6: Commit**

```bash
git add apps/uw-app/github
git commit -m "feat(github): requested reviewers in the facts; every pull-request upsert may join and record a shadow verdict

gh_prs.requested_reviewers is read from the REST pull and the webhook. After
each upsert, on the webhook and the sweep alike, an open pull request that
requests a platform Reviewer is joined (no harness logs no_harness_for_repo)
and a shadow harness records its shadow verdict.

GL-3 GL-4. S14-R12."
```

---

### Task 10: An external reviewer's approval counts by configuration (PI-1)

**Files:**
- Modify: `packages/harness/gates/ship-input.ts` (`ShipHarness`, `latestDecisive`, `approvalsOn`, `reviewsOn`, `providerOf`)
- Modify: `packages/harness/gates/view.ts` (`reviewsShown` passes the list)
- Modify: `packages/harness/gates/ship-input.test.ts` (harness literals gain `externalReviewerIdentities: []`; one test)
- Create: `sim/scenarios/PI-1.an-external-approval-counts-with-its-provider.ts`
- Create: `sim/kernel/external-reviewers.test.ts`

**Interfaces:**
- Consumes: Task 4 `countedReviewer`, `EXTERNAL_PROVIDER`, `Harness.externalReviewerIdentities`.
- Produces: `reviewsOn(facts: PullRequestFacts, head: string, external: readonly string[]): GateView['reviews']`; `ShipHarness = Pick<Harness, 'jdArea' | 'repository' | 'externalReviewerIdentities'>`.

- [ ] **Step 1: Write the failing tests**

`sim/kernel/external-reviewers.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software, type ReviewFact } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import { approvedBy, greenFacts, simParkedAtShip, standardChange } from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Seen = { readonly approvals: unknown; readonly outcome: unknown };

async function shipSeen(world: World, external: readonly string[], reviews: (head: string) => readonly ReviewFact[]): Promise<Seen> {
  const { harness, admin } = await createSimHarness(world, software, { externalReviewerIdentities: external });
  const parked = await simParkedAtShip(world, { harnessId: harness.id, editor: admin, title: 'Show the board', change: standardChange });
  const { head } = standardChange;
  world.adapters.githubFacts.given(greenFacts(world, { itemId: parked.itemId, head, reviews: reviews(head) }));
  const view = value(await world.kernel.gates.view(simCaller(world, admin), { itemId: parked.itemId }));
  return { approvals: view.ship?.input.approvals, outcome: view.ship?.outcome };
}

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

describe('PI-1 a second reviewer\'s approval counts by configuration', () => {
  it('counts a listed login in any case with the provider external, and ignores it unlisted', () =>
    inWorld(async (world) => {
      const listed = await shipSeen(world, ['uwreview[bot]'], (head) => [
        approvedBy('UWReview[bot]', null, head, 9300000001),
      ]);
      expect(listed.approvals).toEqual([
        { reviewer: 'uwreview', commit: standardChange.head, provider: 'external' },
      ]);
      expect(listed.outcome).toEqual({ verdict: 'advance' });
    }));

  it('refuses no_reviewer_approval when the login is not listed', () =>
    inWorld(async (world) => {
      const unlisted = await shipSeen(world, [], (head) => [approvedBy('uwreview[bot]', null, head, 9300000001)]);
      expect(unlisted.approvals).toEqual([]);
      expect(unlisted.outcome).toMatchObject({ verdict: 'refuse', reasons: ['no_reviewer_approval'] });
    }));
});
```

(`simParkedAtShip` names its fields `harnessId`, `editor`, `title`, `change`; `approvedBy(login, provider, commit, reviewId)`. Read both in `sim/ship-fixtures.ts` before relying on them.)

`sim/scenarios/PI-1.an-external-approval-counts-with-its-provider.ts`:

```ts
import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { approvedBy, greenFacts, simParkedAtShip, standardChange } from '../ship-fixtures.ts';

export const scenario = defineScenario({
  id: 'PI-1',
  title:
    'a high-tier change approved by the platform Reviewer and a listed external reviewer passes distinctness; two external reviewers alone do not',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software, {
      externalReviewerIdentities: ['uwreview[bot]', 'benchbot[bot]'],
    });
    const change = { ...standardChange, declaration: { riskTier: 'high' as const, riskDomains: [] } };
    const parked = await simParkedAtShip(world, { harnessId: harness.id, editor: admin, title: 'Show the board', change });
    const { head } = change;
    const viewWith = async (reviews: Parameters<typeof greenFacts>[1]['reviews']) => {
      world.adapters.githubFacts.given(greenFacts(world, { itemId: parked.itemId, head, reviews }));
      return value(await world.kernel.gates.view(simCaller(world, admin), { itemId: parked.itemId })).ship?.outcome;
    };
    const mixed = await viewWith([
      approvedBy('uw-reviewer[bot]', 'deepinfra', head, 9300000001),
      approvedBy('uwreview[bot]', null, head, 9300000002),
    ]);
    const externalOnly = await viewWith([
      approvedBy('uwreview[bot]', null, head, 9300000002),
      approvedBy('benchbot[bot]', null, head, 9300000003),
    ]);
    assert.equal(mixed?.verdict === 'refuse' && mixed.reasons.includes('reviewer_providers_not_distinct'), false);
    assert.equal(externalOnly?.verdict === 'refuse' && externalOnly.reasons.includes('reviewer_providers_not_distinct'), true);
    return { state: { mixed, externalOnly } };
  },
});
```

If `mixed` refuses for another reason on a high-tier change (a domain grant, for example), assert only on `reviewer_providers_not_distinct` as written; that is the property PI-1 adds.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run sim/kernel/external-reviewers.test.ts` then `pnpm sim -- PI-1`
Expected: FAIL; the external approval is ignored.

- [ ] **Step 3: Count external approvals**

`packages/harness/gates/ship-input.ts`: replace the `reviewerOf` import with `import { countedReviewer, EXTERNAL_PROVIDER } from '../github/reviewers.ts';`; then:

```ts
type ShipHarness = Pick<Harness, 'jdArea' | 'repository' | 'externalReviewerIdentities'>;

type Counted = { readonly review: DecisiveReview; readonly external: boolean };

function latestDecisive(
  facts: PullRequestFacts,
  head: string,
  external: readonly string[],
): Map<string, Counted> {
  const latest = new Map<string, Counted>();
  for (const review of facts.reviews) {
    const counted = countedReviewer(review.reviewer, external);
    if (counted === null || fullSha(review.commit) !== head || !isDecisive(review)) continue;
    const seen = latest.get(counted.reviewer);
    if (seen === undefined || later(review, seen.review)) {
      latest.set(counted.reviewer, { review, external: counted.external });
    }
  }
  return latest;
}

function providerOf({ review, external }: Counted): string | null {
  if (external) return EXTERNAL_PROVIDER;
  return review.provider === null ? null : normalisedIdentifier(review.provider);
}

function approvalsOn(
  facts: PullRequestFacts,
  head: string,
  external: readonly string[],
): ShipRuleInput['approvals'] {
  return [...latestDecisive(facts, head, external).entries()]
    .filter(([, counted]) => counted.review.state === 'approved')
    .map(([reviewer, counted]) => ({ reviewer, commit: head, provider: providerOf(counted) }));
}

export function reviewsOn(
  facts: PullRequestFacts,
  head: string,
  external: readonly string[],
): GateView['reviews'] {
  return [...latestDecisive(facts, head, external).entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([reviewer, counted]) => ({
      reviewer,
      commit: head,
      state: counted.review.state,
      provider: providerOf(counted),
      findings: [...counted.review.findings],
    }));
}
```

and in `fromFacts`: `approvals: approvalsOn(facts, head, source.harness.externalReviewerIdentities),`.

`packages/harness/gates/view.ts`, `reviewsShown`: `reviewsOn(facts, head, seen.harness.externalReviewerIdentities)`.

`packages/harness/gates/ship-input.test.ts`: add `externalReviewerIdentities: []` to each harness literal `pnpm check` flags, and a unit test:

```ts
describe('PI-1 the provider of an external approval is external', () => {
  it('lists the external reviewer beside the platform Reviewer in the gate view reviews', () => {
    const reviews = [
      { ...approval, reviewer: 'uw-reviewer[bot]', provider: 'deepinfra', reviewId: 1 },
      { ...approval, reviewer: 'uwreview[bot]', provider: null, reviewId: 2 },
    ];
    expect(reviewsOn({ ...facts, reviews }, head, ['uwreview[bot]']).map((review) => [review.reviewer, review.provider])).toEqual([
      ['uw-reviewer', 'deepinfra'],
      ['uwreview', 'external'],
    ]);
  });
});
```

where `approval`, `facts` and `head` are the file's own fixture names for an approved `ReviewFact`, ready facts and their head (read the file first and use its names; build `approval` from `approvedBy` in its style if none exists).

- [ ] **Step 4: Run them**

Run: `pnpm check && npx vitest run sim/kernel/external-reviewers.test.ts packages/harness/gates sim/kernel/gate-view.test.ts` then `pnpm sim -- PI-1 && pnpm sim -- GH-5 && pnpm sim -- KN-12`
Expected: green; GH-5 and KN-12 unchanged (no external list on their harnesses).

- [ ] **Step 5: Commit**

```bash
git add packages/harness/gates sim/kernel/external-reviewers.test.ts sim/scenarios/PI-1.an-external-approval-counts-with-its-provider.ts
git commit -m "feat(harness): a listed external reviewer's approval counts with provider external

The ship-rule input and the gate view count an approval by a login the
harness lists in external_reviewer_identities, in any case, under the
login's key and the provider external; distinctness still applies.

PI-1. S14-R11."
```

---

### Task 11: The shadow comparison: view, export and the Gates screen (OB-3, GL-4's label)

**Files:**
- Create: `packages/harness/views/shadow-rows.ts` (pure)
- Create: `packages/harness/views/shadow.ts`
- Modify: `packages/harness/views/index.ts` (`shadow` read)
- Create: `apps/uw-app/commands/person/shadow-export.ts`
- Modify: `apps/uw-app/commands/routes.ts` (`GET /:harness/shadow`)
- Modify: `apps/uw-app/views/parts/paths.ts` (`shadowExportPath`)
- Create: `apps/uw-app/views/parts/shadow-list.tsx`
- Modify: `apps/uw-app/views/screens/gates.tsx`
- Create: `sim/scenarios/OB-3.the-gates-view-compares-shadow-verdicts-with-other-reviews.ts`
- Create: `apps/uw-app/views/shadow.pg.test.ts`

**Interfaces:**
- Consumes: Task 8 events; Task 7 `sim/joining.ts`; Task 1 `shadowComparisonSchema`.
- Produces:
  - `ViewReads.shadow(caller: Caller, input: { readonly harnessId: string }, options?: ReadOptions): Promise<KernelOutcome<ShadowComparison>>` (refuses `harness_not_found` when the caller may not read the harness or is an agent)
  - `GET /api/harness/:harness/shadow` answering `shadowComparisonSchema` JSON
  - `shadowExportPath(harnessId: string): string`

- [ ] **Step 1: Write the failing scenario**

`sim/scenarios/OB-3.the-gates-view-compares-shadow-verdicts-with-other-reviews.ts`:

```ts
import assert from 'node:assert/strict';
import { simCaller } from '../fixtures.ts';
import { approveVerdict, joinedFacts, joinedHead, joinedWorld, startReview } from '../joining.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'OB-3',
  title:
    'on a shadow harness the Gates view lists the head with its shadow verdict beside the bench review on the same head, and marks the disagreement',
  run: async (world) => {
    const scene = await joinedWorld(world, { shadow: true });
    world.adapters.githubFacts.given(
      joinedFacts(world, {
        reviews: [
          {
            reviewId: 9400000001,
            reviewer: 'uwreview[bot]',
            commit: joinedHead,
            state: 'changes_requested',
            provider: null,
            findings: ['The form posts twice.'],
            submittedAt: world.adapters.clock.now(),
          },
        ],
      }),
    );
    const runId = await startReview(scene);
    value(await world.kernel.runs.postReview(scene.host, runId, approveVerdict));
    const comparison = value(
      await world.kernel.views.shadow(simCaller(world, scene.admin), { harnessId: scene.harnessId }),
    );
    const [row] = comparison.rows;
    assert.equal(comparison.rows.length, 1);
    assert.equal(row?.head, joinedHead);
    assert.deepEqual(row?.reviewer?.verdict, 'approve');
    assert.deepEqual(row?.github, [{ reviewer: 'uwreview[bot]', state: 'changes_requested' }]);
    assert.equal(row?.disagrees, true);
    assert.notEqual(row?.shadow, null);
    return { state: { rows: comparison.rows.length, disagrees: row?.disagrees ?? null } };
  },
});
```

Add to `sim/kernel/shadow.test.ts` (Task 8's file):

```ts
describe('OB-3 the shadow comparison', () => {
  it('shows a recorded verdict with no other review as not compared, and hides the harness from an outsider', () =>
    inShadow(async (scene) => {
      const runId = await startReview(scene);
      value(await scene.world.kernel.runs.postReview(scene.host, runId, approveVerdict));
      const comparison = value(
        await scene.world.kernel.views.shadow(simCaller(scene.world, scene.admin), { harnessId: scene.harnessId }),
      );
      expect(comparison).toMatchObject({ shadow: true, capped: false });
      expect(comparison.rows[0]).toMatchObject({ github: [], disagrees: false });
      const outsider = await simPerson(scene.world, 9, [{ role: 'viewer', scopeKind: 'jd_area', scopeArea: '20-29' }]);
      const hidden = await scene.world.kernel.views.shadow(simCaller(scene.world, outsider), { harnessId: scene.harnessId });
      expect(reasonOf(hidden)).toBe('harness_not_found');
    }));
});
```

(import `simPerson` from `../fixtures.ts`.)

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm sim -- OB-3` and `npx vitest run sim/kernel/shadow.test.ts -t "OB-3"`
Expected: FAIL; `views.shadow` does not exist.

- [ ] **Step 3: The rows**

`packages/harness/views/shadow-rows.ts`:

```ts
import {
  eventEvidenceSchemas,
  type HarnessEvent,
  type ItemState,
  type ShadowRow,
} from '@uw/contracts';
import { fullSha } from '../github/identifiers.ts';
import { reviewerOf } from '../github/reviewers.ts';
import type { PullRequestFacts, PullRequestRef, ReviewFact, ReviewState } from '../ports.ts';

type OtherState = ShadowRow['github'][number]['state'];
type Part = Partial<Pick<ShadowRow, 'shadow' | 'reviewer'>>;
type Entry = { readonly head: string; readonly part: Part };
type Collected = {
  readonly item: ItemState;
  readonly pullRequest: PullRequestRef;
  readonly head: string;
  readonly shadow: ShadowRow['shadow'];
  readonly reviewer: ShadowRow['reviewer'];
};

export type RowsInput = {
  readonly events: readonly HarnessEvent[];
  readonly items: readonly ItemState[];
  readonly facts: ReadonlyMap<string, PullRequestFacts | null>;
};

const otherStates: ReadonlySet<ReviewState> = new Set<ReviewState>([
  'approved',
  'changes_requested',
  'dismissed',
]);

function isOther(state: ReviewState): state is OtherState {
  return otherStates.has(state);
}

function entryOf(event: HarnessEvent): Entry | null {
  if (event.name === 'shadow_verdict') {
    const verdict = eventEvidenceSchemas.shadow_verdict.parse(event.evidence);
    if (verdict.head === null) return null;
    const shadow = { verdict: verdict.verdict, reasons: [...verdict.reasons] };
    return { head: verdict.head, part: { shadow } };
  }
  if (event.name === 'review_verdict_recorded') {
    const recorded = eventEvidenceSchemas.review_verdict_recorded.parse(event.evidence);
    const reviewer = {
      reviewer: recorded.reviewer,
      verdict: recorded.verdict,
      findings: [...recorded.findings],
    };
    return { head: recorded.head, part: { reviewer } };
  }
  return null;
}

function collect(input: RowsInput): ReadonlyMap<string, Collected> {
  const byId = new Map(input.items.map((item) => [item.itemId, item]));
  const rows = new Map<string, Collected>();
  for (const event of [...input.events].sort((a, b) => a.position - b.position)) {
    const item = event.itemId === null ? undefined : byId.get(event.itemId);
    const entry = entryOf(event);
    if (item?.pullRequest == null || entry === null) continue;
    const key = `${item.itemId} ${entry.head}`;
    const empty = { item, pullRequest: item.pullRequest, head: entry.head, shadow: null, reviewer: null };
    rows.set(key, { ...(rows.get(key) ?? empty), ...entry.part });
  }
  return rows;
}

function othersOn(facts: PullRequestFacts | null, head: string): ShadowRow['github'] {
  const latest = new Map<string, ReviewFact & { readonly state: OtherState }>();
  for (const review of facts?.reviews ?? []) {
    const { state } = review;
    if (reviewerOf(review.reviewer) !== null || fullSha(review.commit) !== head || !isOther(state)) continue;
    const login = review.reviewer.trim().toLowerCase();
    const seen = latest.get(login);
    if (seen === undefined || review.reviewId > seen.reviewId) latest.set(login, { ...review, state });
  }
  return [...latest.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reviewer, review]) => ({ reviewer, state: review.state }));
}

function disagreeing(reviewer: ShadowRow['reviewer'], github: ShadowRow['github']): boolean {
  if (reviewer === null) return false;
  const opposite: OtherState = reviewer.verdict === 'approve' ? 'changes_requested' : 'approved';
  return github.some((review) => review.state === opposite);
}

export function comparisonRows(input: RowsInput): ShadowRow[] {
  return [...collect(input).values()].map(({ item, pullRequest, head, shadow, reviewer }) => {
    const github = othersOn(input.facts.get(item.itemId) ?? null, head);
    return {
      itemId: item.itemId,
      title: item.title,
      pullRequest,
      head,
      shadow,
      reviewer,
      github,
      disagrees: disagreeing(reviewer, github),
    };
  });
}
```

If the lint rejects `== null` on `item?.pullRequest`, write `item === undefined || item.pullRequest === null`.

- [ ] **Step 4: The view**

`packages/harness/views/shadow.ts`:

```ts
import {
  shadowComparisonSchema,
  type Harness,
  type HarnessEvent,
  type ItemState,
  type ShadowComparison,
} from '@uw/contracts';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import { FactsUnavailableError } from '../port-errors.ts';
import type { Ports, PullRequestFacts, StoreTransaction } from '../ports.ts';
import { readableHarness } from '../reads/scene.ts';
import { comparisonRows } from './shadow-rows.ts';
import { VIEW_LIMIT } from './types.ts';

type ShadowPorts = Pick<Ports, 'githubFacts' | 'grants' | 'store'>;
type Read = {
  readonly harness: Harness;
  readonly events: readonly HarnessEvent[];
  readonly items: readonly ItemState[];
};

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function readIn(
  ports: ShadowPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: { readonly harnessId: string; readonly at: Date },
): Promise<KernelOutcome<Read>> {
  const harness = isAgent(caller.actor)
    ? null
    : await readableHarness(ports, tx, caller, input.harnessId, input.at);
  if (harness === null) return refused('harness_not_found', { harnessId: input.harnessId });
  const events = await tx.harnessEvents.read.recent({
    since: new Date(input.at.getTime() - WINDOW_MS),
    names: ['shadow_verdict', 'review_verdict_recorded'],
    agentsOnly: false,
    limit: VIEW_LIMIT,
    harnessIds: [harness.id],
  });
  const itemIds = [...new Set(events.flatMap((event) => (event.itemId === null ? [] : [event.itemId])))];
  return accepted({ harness, events, items: await tx.harnessItems.read.byIds(itemIds) });
}

async function factsOf(ports: ShadowPorts, item: ItemState): Promise<PullRequestFacts | null> {
  if (item.pullRequest === null) return null;
  try {
    return await ports.githubFacts.pullRequest(item.pullRequest);
  } catch (error) {
    if (error instanceof FactsUnavailableError) return null;
    throw error;
  }
}

export async function shadowComparison(
  ports: ShadowPorts,
  caller: Caller,
  input: { readonly harnessId: string },
  at: Date,
): Promise<KernelOutcome<ShadowComparison>> {
  const read = await ports.store.transaction((tx) =>
    readIn(ports, tx, caller, { harnessId: input.harnessId, at }),
  );
  if (read.status !== 'accepted') return read;
  const { harness, events, items } = read.value;
  const facts = new Map<string, PullRequestFacts | null>();
  for (const item of items) facts.set(item.itemId, await factsOf(ports, item));
  return accepted(
    shadowComparisonSchema.parse({
      harnessId: harness.id,
      harnessKey: harness.key,
      shadow: harness.shadow,
      capped: events.length === VIEW_LIMIT,
      rows: comparisonRows({ events, items, facts }),
    }),
  );
}
```

`packages/harness/views/index.ts`: import `shadowComparison` from `./shadow.ts` and `ShadowComparison` from `@uw/contracts`; `ViewReads` gains

```ts
  shadow(
    caller: Caller,
    input: { readonly harnessId: string },
    options?: ReadOptions,
  ): Promise<KernelOutcome<ShadowComparison>>;
```

and `createViewReads` gains `shadow: (caller, input, options) => shadowComparison(ports, caller, input, instant(options)),`.

- [ ] **Step 5: Run the scenario and the kernel test**

Run: `pnpm sim -- OB-3 && npx vitest run sim/kernel/shadow.test.ts`
Expected: green.

- [ ] **Step 6: Commit the kernel view**

```bash
git add packages/harness/views sim/scenarios/OB-3.the-gates-view-compares-shadow-verdicts-with-other-reviews.ts sim/kernel/shadow.test.ts
git commit -m "feat(harness): the shadow comparison view

Each head on a shadow harness, with the ship rule's shadow verdict and the
Reviewer's recorded verdict beside the other reviewers' latest decisive
reviews on that head; an opposite verdict is a disagreement.

OB-3. S14-R10."
```

- [ ] **Step 7: Write the failing app tests**

`apps/uw-app/views/shadow.pg.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { shadowComparisonSchema } from '@uw/contracts';
import { ingestPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { seedPlatformPage } from '@uw/db/test-seed';
import { checkOnly } from '@uw/harness';
import { accepted, callerOf, get, ian, person } from '../testing/commands.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { gatesPath, shadowExportPath } from './parts/paths.ts';

const IAN_EMAIL = 'ian.lindsley@unfoldingword.org';
const repository = 'unfoldingWord/tc-admin-app';
const head = 'c'.repeat(40);
const clock = { now: () => new Date() };

async function shadowHarness(db: Database): Promise<string> {
  const harnessId = randomUUID();
  const kernel = kernelOn(db, clock);
  accepted(
    await kernel.stages.activate(callerOf(await ian(db)), {
      harnessId,
      harnessKey: 'tc-admin-app',
      jdArea: '80-89',
      template: checkOnly,
      repository,
      shadow: true,
    }),
  );
  await seedPlatformPage(db, { id: randomUUID(), jdArea: '80-89', repositories: [repository] });
  const ingest = { actor: ingestPrincipal(), traceId: randomUUID() };
  const pullRequest = { repo: repository, number: 12 };
  accepted(
    await kernel.items.join(ingest, {
      pullRequest,
      head,
      title: 'Fix the login form',
      requestedReviewers: ['uw-reviewer[bot]'],
    }),
  );
  accepted(await kernel.gates.recordShadowVerdicts(ingest, { pullRequest }));
  return harnessId;
}

describe.skipIf(!testServer)('OB-3 the shadow comparison export', () => {
  it('answers the comparison as JSON for a reader and harness_not_found for an outsider', () =>
    withAppDatabase(async (db) => {
      const harnessId = await shadowHarness(db);
      const read = await get(db, { email: IAN_EMAIL }, shadowExportPath(harnessId));
      expect(read.status).toBe(200);
      const comparison = shadowComparisonSchema.parse(read.body);
      expect(comparison).toMatchObject({ harnessKey: 'tc-admin-app', shadow: true });
      expect(comparison.rows.map((row) => row.head)).toEqual([head]);
      const outsider = await person(db, 'shadow-outsider', 'viewer', '20-29');
      const hidden = await get(db, { email: outsider.email }, shadowExportPath(harnessId));
      expect(hidden.body).toMatchObject({ status: 'error', reason: 'harness_not_found' });
    }));
});

describe.skipIf(!testServer)('GL-4 OB-3 the Gates view shows shadow verdicts labelled shadow', () => {
  it('lists the head under the harness with the shadow label and an export link, and passes the screen checks', () =>
    withAppDatabase(async (db) => {
      const harnessId = await shadowHarness(db);
      const html = await getHtml(db, IAN_EMAIL, gatesPath(), {}, clock);
      const document = new JSDOM(html.text).window.document;
      const section = [...document.querySelectorAll('main section')].find((candidate) =>
        candidate.querySelector('h2')?.textContent?.includes('tc-admin-app'),
      );
      expect(section?.textContent).toContain('shadow');
      expect(section?.querySelector('a')?.getAttribute('href')).toBe(shadowExportPath(harnessId));
      expect(section?.querySelector('table caption')?.textContent).toBe('Shadow verdicts on tc-admin-app');
      expect(await screenProblems(html.text)).toEqual([]);
    }));
});
```

Read `apps/uw-app/testing/views.ts` `getHtml` before relying on its fourth and fifth arguments (`{}` and the clock), and `get` in `testing/commands.ts` (claims object, path).

- [ ] **Step 8: The route, the paths and the screen**

`apps/uw-app/views/parts/paths.ts`:

```ts
export function shadowExportPath(harnessId: string): string {
  return `/api/harness/${segment(harnessId)}/shadow`;
}
```

`apps/uw-app/commands/person/shadow-export.ts`:

```ts
import type { Context } from 'hono';
import { z } from 'zod';
import { shadowComparisonSchema } from '@uw/contracts';
import type { Caller } from '@uw/harness';
import type { AppEnv } from '../../deps.ts';
import { refuse } from '../../http/outcomes.ts';
import { platformKernel } from '../../kernel.ts';

const idParam = z.uuid();

export async function shadowExport(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const harness = idParam.safeParse(c.req.param('harness'));
  if (!harness.success) return refuse(c, 'harness_not_found');
  const at = c.get('now');
  const kernel = platformKernel(database, { now: () => at });
  const caller: Caller = { actor, traceId: c.get('traceId') };
  const view = await kernel.views.shadow(caller, { harnessId: harness.data }, { at });
  if (view.status !== 'accepted') return refuse(c, view.reason);
  const body = shadowComparisonSchema.parse(view.value);
  c.header('content-disposition', `attachment; filename="shadow-${body.harnessKey}.json"`);
  return c.json(body);
}
```

`apps/uw-app/commands/routes.ts`: `import { shadowExport } from './person/shadow-export.ts';` and `routes.get('/:harness/shadow', shadowExport);` after the `gates/:item` route.

`apps/uw-app/views/parts/shadow-list.tsx`:

```tsx
import type { ShadowComparison, ShadowRow } from '@uw/contracts';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Table, type Column } from '@uw/ui/components/table.tsx';
import { domId, reasonText } from '@uw/ui/components/text.ts';
import { pullRequestUrl, shadowExportPath } from './paths.ts';

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

const columns: readonly Column[] = [
  { key: 'pull', label: 'Pull request' },
  { key: 'head', label: 'Head' },
  { key: 'shadow', label: 'Shadow verdict' },
  { key: 'reviewer', label: 'Reviewer' },
  { key: 'github', label: 'Other reviews on this head' },
  { key: 'agreement', label: 'Agreement' },
];

function verdictText(row: ShadowRow): string {
  if (row.shadow === null) return 'No verdict yet';
  if (row.shadow.verdict === 'advance') return 'Would advance';
  return `Would refuse: ${row.shadow.reasons.map(reasonText).join(', ')}`;
}

function reviewerText(row: ShadowRow): string {
  if (row.reviewer === null) return 'No verdict recorded';
  const verdict = row.reviewer.verdict === 'approve' ? 'approve' : 'request changes';
  return `${row.reviewer.reviewer}: ${verdict}`;
}

function githubText(row: ShadowRow): string {
  if (row.github.length === 0) return 'None';
  return row.github.map((review) => `${review.reviewer}: ${review.state.replaceAll('_', ' ')}`).join('; ');
}

function agreementCell(row: ShadowRow) {
  if (row.disagrees) return <Badge tone="info">Disagree</Badge>;
  return row.reviewer === null || row.github.length === 0 ? 'Not compared' : 'Agree';
}

function rowOf(row: ShadowRow) {
  const pull = `${row.pullRequest.repo}#${row.pullRequest.number}`;
  return {
    pull: (
      <a href={pullRequestUrl(row.pullRequest)} class={`text-link underline ${focus}`}>
        {pull}
      </a>
    ),
    head: <span class="font-mono">{row.head.slice(0, 12)}</span>,
    shadow: (
      <span class="flex flex-wrap items-center gap-2">
        <Badge tone="held">shadow</Badge>
        <span>{verdictText(row)}</span>
      </span>
    ),
    reviewer: reviewerText(row),
    github: githubText(row),
    agreement: agreementCell(row),
  };
}

export function ShadowList(props: { readonly comparison: ShadowComparison }) {
  const { comparison } = props;
  const headingId = domId('shadow', comparison.harnessId);
  const caption = `Shadow verdicts on ${comparison.harnessKey}`;
  return (
    <section aria-labelledby={headingId} class="flex flex-col gap-2">
      <h2 id={headingId} class="m-0 text-base font-bold text-ink">
        {caption}
      </h2>
      <p class="m-0">
        <a href={shadowExportPath(comparison.harnessId)} class={`text-link underline ${focus}`}>
          {`Export the shadow verdicts for ${comparison.harnessKey}`}
        </a>
      </p>
      {comparison.rows.length === 0 ? (
        <Note>No shadow verdict has been recorded on this harness yet.</Note>
      ) : (
        <Table caption={caption} columns={columns} rows={comparison.rows.map(rowOf)} />
      )}
    </section>
  );
}
```

`apps/uw-app/views/screens/gates.tsx`: import `ShadowComparison` from `@uw/contracts` and `ShadowList` from `../parts/shadow-list.tsx`; add

```ts
async function shadowComparisons(screen: ScreenKernel): Promise<ShadowComparison[]> {
  const read = { at: screen.at };
  const shown: ShadowComparison[] = [];
  for (const harness of await screen.kernel.views.harnesses(screen.caller, read)) {
    if (!harness.shadow) continue;
    const comparison = await screen.kernel.views.shadow(screen.caller, { harnessId: harness.id }, read);
    if (comparison.status === 'accepted') shown.push(comparison.value);
  }
  return shown;
}
```

In `gatesScreen`, compute `const comparisons = await shadowComparisons(screen);`, pass `[...shown.map(({ row }) => row.harness.id), ...comparisons.map((comparison) => comparison.harnessId)]` to `liveCursors`, and render `{comparisons.map((comparison) => <ShadowList comparison={comparison} />)}` after the existing content in both branches (wrap each branch's fragment so the sections follow the gate list or the "No gate is waiting" note). If `gatesScreen` passes 50 lines, move the two branches into `function GatesBody(props: { shown; capped; comparisons })`.

Rebuild the stylesheet in case a utility class is new to the tree: `pnpm ui:css`; commit the regenerated file if it changed.

- [ ] **Step 9: Run the app tests and the route checks**

Run: `pnpm check && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/views apps/uw-app/commands tools/architecture/command-routes.test.ts tools/ui`
Expected: green; the route test sees `kernel.views.shadow(` as the guarded entry.

- [ ] **Step 10: Look at it**

Run the app as `AGENTS.md` section 7 step 6 asks (the `run` skill or the repository's dev script), open `/gates` as Ian with the shadow harness from Step 7 seeded, in light and dark and at 390px width. Confirm the table scrolls inside its border and not the page, every link has a visible focus ring, and nothing is orange. If the app cannot be run locally, say so in the tracker under "Not verified" and rely on `screenProblems`.

- [ ] **Step 11: Commit**

```bash
git add apps/uw-app/commands apps/uw-app/views apps/uw-app/assets packages/ui
git commit -m "feat(app): the Gates view lists shadow verdicts, and the comparison exports as JSON

Each readable shadow harness gets a section on /gates: every head with its
shadow verdict labelled shadow, the Reviewer's recorded verdict, the other
reviews on that head and the agreement. GET /api/harness/:harness/shadow
answers the same list.

GL-4 OB-3. S14-R10."
```

(Stage `apps/uw-app/assets` or `packages/ui` only if `pnpm ui:css` changed a file there; otherwise drop them from the `git add`.)

---

### Task 12: Verify, record, push

**Files:**
- Modify: `docs/progress_tracker.md` (step 14 row; S14 rulings; the four items left for later steps; "Not verified")

- [ ] **Step 1: Run the whole chain**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres pnpm verify`
Expected: green. `trace:built` passes once the tracker marks step 14 Built in Step 2 (run `pnpm trace` now and confirm GL-2, GL-3, GL-4, GL-6, OB-3 and PI-1 no longer appear as unproven). Note the test and scenario counts.

- [ ] **Step 2: Update the tracker**

In `docs/progress_tracker.md`:
- The step 14 row: state `Built`; evidence: the commit SHAs of Tasks 1 to 11, the proving files (`apps/uw-app/commands/joining.pg.test.ts` GL-2 and GL-4, `sim/kernel/join.test.ts` and `apps/uw-app/github/join.pg.test.ts` GL-3, `sim/kernel/shadow.test.ts` and scenario GL-4, `sim/kernel/dispatch.test.ts` GL-6, scenario OB-3 and `apps/uw-app/views/shadow.pg.test.ts`, scenario PI-1 and `sim/kernel/external-reviewers.test.ts`), `pnpm verify` green locally with the counts, the contract version, and "CI not run" or the run id.
- Under decisions made during the build, rows for S14-R1 to S14-R13 in the shape of the S12 rows (`| date | requirement | ruling | cost if wrong |`).
- Under the open carries (or the section the file uses for work handed forward), the four "Left for later steps" items from the top of this plan, each naming the step that should take it.
- Under "Not verified": the Gates screen in a browser if Task 11 Step 10 could not run; the webhook path's join against a live `pull_request.review_requested` delivery (proven only with the sweep rig); every list the rigs needed in Task 6 Step 7, by file.

- [ ] **Step 3: Commit and push**

```bash
git add docs/progress_tracker.md
git commit -m "docs(tracker): step 14 is built

GL-2 GL-3 GL-4 GL-6 OB-3 PI-1, with the S14 rulings and what is left for
steps 15, 16 and 20."
git push
```

The draft pull request for `build/v0.2.0` already exists; push only.

---

## Self-review

**Spec coverage.** Step 14 in PRD section 13 names GL-2, GL-3, GL-4, GL-6, OB-3 and PI-1.
- GL-2: the `kickstart` refusal and "no Package page", Task 5 (the template is step 12).
- GL-3: the facts column (Task 2), the Store read (Task 3), the kernel join with "once", the expected head, no harness branch and `no_harness_for_repo` (Task 7), the sweep and webhook follow with the log line (Task 9).
- GL-4: the column (Task 2), activation and `set_shadow` with `shadow_lifted` (Task 4), `review_verdict_recorded` with no posted review, `shadow_verdict` on every head change, no connector, and the named no-write test (Task 8), the head-change trigger (Task 9), the "shadow" label on the Gates view (Task 11).
- GL-6: the page type (Task 1), the read (Task 3), the guard on claims and joins with both refusals, failing closed (Tasks 6 and 7).
- OB-3: the view, the disagreement mark, the Gates screen section and the one export route (Task 11).
- PI-1: the column (Task 2), activation (Task 4), counting with provider `external` and distinctness (Task 10).
Design section 6's other columns (`fix_claim`, `frozen`, `freeze_allow`, `bot_authors`, `max_tier`, `patch_id`, `behind_by`, `parent_issue_id`) belong to steps 15 to 19 and are not added here.

**Placeholders.** None; every code step carries its code. Steps that touch files whose local fixture names this plan could not see (Task 7 Step 2 and Task 10 Step 3 in `ship-input.test.ts`, Task 9 Step 1 in `normalise.test.ts`) tell the implementer which names to read and reuse rather than inventing new ones; Task 6 Step 7 gives the command that finds the rigs to change and the one line to add.

**Type consistency.** `JoinInput`/`Joined` (Task 7) are what `apps/uw-app/github/join.ts` (Task 9) and `apps/uw-app/views/shadow.pg.test.ts` (Task 11) call. `recordShadowVerdicts(caller, { pullRequest })` returns `readonly ItemState[]` in Task 8 and is read as `.length` in Task 9. `byPullRequest(harnessId, { repo, number })` is the same in Tasks 3, 7 and 8. `countedReviewer`, `namesPlatformReviewer`, `requestsPlatformReviewer`, `EXTERNAL_PROVIDER` are defined in Task 4 and used in Tasks 7, 9 and 10. `ShadowComparison`/`ShadowRow` (Task 1) are what `views/shadow.ts`, `shadow-rows.ts` and `shadow-list.tsx` (Task 11) use. `platformPageSlug` and `platformFrontmatterSchema` are defined in Task 1 and used in Tasks 3 and 6. `createSimHarness` options `shadow`, `externalReviewerIdentities` (Task 4) and `dispatchable` (Task 6) are used by `sim/joining.ts` (Task 7).

**Review Focus.** Line 1 is pinned in Task 7 (`again` with another head, one `item_created`); line 2 in Task 6 (`suggested` page and a string `dispatch_allowed`); line 3 in Tasks 10 (`UWReview[bot]`) and 4 (`UW-Reviewer[bot]` refused); line 4 in Task 8 (second `recordVerdicts` returns `[]`); line 5 in Task 8 (decisions `[]`, `calls()` and `reviews()` empty).
