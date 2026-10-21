# Step 19, Observability and Hooks: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person can see who holds the ball on every item and for how long (on the Board, on the item and as two `/health` counts), `/health` goes amber then red when items wait in Check while no review step runs and the red alarm wakes the harness's admins once per cooldown, every count of items on Home, the Board and `/health` leaves out pull requests a listed bot opened and says so, the bench can post its rulings as `suggested` learnings that name their external source and pull request, and an admin can move a check-only harness onto the software template without losing the items it holds.

**Architecture:** Additive, with five shared-root commits. The holder is computed, not stored: a pure `holderOf(item, stage, reviewing)` over the item projection, plus one new projected value, `ItemState.heldSince`, which the fold sets whenever the holder, the gate status or the stage changes (or a claim lands). The silence alarm is one kernel reader (`silenceOf`) that both the `/health` indicator and a new system-only command (`alarms.soundSilence`, run by the minute cron) use; the command records a harness-level `silence_alarm` event, and the existing after-commit notifier turns it into a rank-3 wake for the area's admins. Honest counts read pull request authors through a new batch method on the GitHub facts port (`GitHubFacts.authors`) over a new facts column (`gh_prs.author_login`) and a new harness column (`bot_authors`). External learnings are a provenance rule inside the page API's frontmatter derivation, fed by the MCP `write_page` verb when the caller is an external runner on a `review` delegation. The template change is one more stage edit through `editInTransaction`, with a compare-and-set on `harnesses.template`.

**Tech Stack:** TypeScript strict, Zod 4, Drizzle and drizzle-kit, Vitest 4 (node project and the Postgres service), Hono JSX for the Board, item and Health screens, the sim over the embedded Postgres Store, the MCP SDK test client.

**Spec:** `docs/PRD.md` section 7.11 (OB-1, OB-2, OB-4, PI-2, GL-5), sections 8.1, 8.3, 8.5, 8.6 and 13 (step 19); the design is `docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` sections 2 (Holder, Silence alarm), 3 (V2-5, V2-8), 4 (step 6), 5.1, 5.8, 5.9, 6 and 7.

**Requirements covered:** OB-1, OB-2, PI-2 (Must); OB-4 and GL-5 (Should, both built: OB-4 is the reason `/health` counts can be trusted on a repository Dependabot writes to, and GL-5 is design section 4 step 6, the pilot's way onto the whole lifecycle).

**Builds on steps 14 to 18 (built before this plan runs).** Names used exactly as the plans hand them over. From `docs/superpowers/plans/2026-10-15-step-14-joining.md`: `Harness.shadow`, `Harness.externalReviewerIdentities`, `githubLoginSchema`, `externalReviewerIdentitiesSchema`, `activate_template.shadow` and `.externalReviewerIdentities`, `stages.liftShadow` in `packages/harness/stages/shadow.ts`, `hasPackageStage`, the facts module's `requestedReviewers` path (`payloads.ts`, `records.ts`, `normalise.ts` `pullOf`, `upsert.ts` `pullColumns`), `createSimHarness` options `shadow`, `externalReviewerIdentities`, `dispatchable`, and migration `0029_joining`. From `docs/superpowers/plans/2026-10-15-step-15-ship-rule-and-gates.md`: contract `13.0.0`, `apps/uw-app/github/facts/heads.ts` (the files writer moved out of `upsert.ts`), `PlaneTotals.reviewerRefutes` and the `reviewer_refutes` indicator appended to `AGENT_PLANE_INDICATORS`, `greenFacts` and `simParkedAtShip` in `sim/ship-fixtures.ts`. From `docs/superpowers/plans/2026-10-15-step-16-merge-delegation.md`: wake reason `delegated_merge` at rank 2 with `screens` entry `['delegated_merge', 'item']` (the pattern this plan repeats for `silence_alarm`), `/health`'s live delegations indicator counting merge delegations, `Harness.protectedPaths`, `activate_template.protectedPaths`, `joinedPullRequest(item)`. From step 17 (planned after this plan was written): only that it may add a minor contract version and columns on `harnesses`; this plan touches nothing it owns. From `docs/superpowers/plans/2026-10-15-step-18-epic-intake.md`: `ItemState.epic`, `ItemState.blockedBy` (the precedent for a projected `ItemState` field: contract field with a default, `harness_items` column, `toItemState` and `columnsOf` in the Store, every literal `pnpm check` names), `GitHubFacts.epic` (the precedent for a new facts port method: `ports.ts`, contract suite, sim adapter, platform adapter, not-wired adapter, `fixedFacts`, every `GitHubFacts` literal), `BoardView.epics`, `BoardView.notReady`. Where a file below differs from the text quoted here because those steps changed it, keep their lines and make only this plan's change.

**Rulings made while planning** (recorded here and in `docs/progress_tracker.md` by the last task):

| Ruling | Cost if wrong |
|---|---|
| S19-R1. The holder is derived, never stored: an item that is claimed is held by its claimant (`kind` from `claimantKind`), and the role is `reviewer` when the claim's delegation has capability `review`, `claimant` otherwise; an unclaimed item parked at a stage whose exit gate is `human_approval` is held by "a person who may decide" (`decider`, kind `person`, no identity); any other item is held by nobody. A done item has no holder | A Builder fix claim (step 17) shows as `claimant`, not `reviewer`, which is what it is |
| S19-R2. "How long" is `ItemState.heldSince`: the `at` of the last event that changed the holder, the gate status or the stage, or that was an `item_claimed` (the claim write updates the row before the event folds, so a claim moves it by name). It is a projected field (`harness_items.held_since`), so replay equals record. Items folded before this step read `null` ("since unknown") until their next event or `rebuildItem`, and are never counted as held too long | A long-held item from before the deploy is invisible to the two counts until it moves; the tracker lists it under Not verified with the rebuild command |
| S19-R3. OB-2's `/health` counts are two indicators, `held_by_person` (persons: claimant people and deciders, over 24 hours) and `held_by_agent` (agent claimants including the Reviewer, over 2 hours). Each is `ok` at zero and `amber` otherwise, never `red`; each drills through to one row per item | A person who wanted red at some longer hold reads the count; a threshold is one constant |
| S19-R4. OB-1's Check is the stage keyed `check` (all three templates). An item waits there when it is in that stage, unclaimed, not done, not a listed bot's pull request, has a stage-entry event, and no run completed a review on it (`review_posted` or `review_withheld`) since it entered. A review run step is a `run_step_recorded` whose run's delegation has capability `review`. "In that time" is the last 90 (red) or 45 (amber) minutes. A paused harness, a paused Check lane or a harness with no `check` stage is `ok` | A reviewed item that sits in Check waiting for a person (step 14 carry-forward 3) never sounds the alarm; that wait is OB-2's to show |
| S19-R5. Only red sends. The minute cron runs `alarms.soundSilence` as the system; it records one harness-level `silence_alarm` per harness at most once per `COOLDOWN_MS` (the notifier's 10-minute cooldown), under the harness's event lock. The wake goes to the area's admins at rank 3 by push and the hub, is not posted to Zulip, and links `/health/silence_alarm`; `deepLinkSchema` admits `/health/<indicator>` for it | A red harness that stays red for a day records 144 events and pushes its admins every 10 minutes; the cooldown is one constant if the pilot finds it noisy |
| S19-R6. `bot_authors` is a harness column (GitHub logins, at most 20, distinct in any case, default `['dependabot[bot]']`), set at activation (`activate_template.botAuthors`) and kept by a template change; no command edits it on a live harness. An item is a bot's when its pull request's author, read from `gh_prs.author_login`, is listed. The author is captured from the REST pull and the webhook payload's `user.login` on the next upsert of that pull request; an unknown author counts | A Dependabot pull request untouched since the deploy counts until its next webhook or sweep; changing the list needs a re-activation, as S14-R2 |
| S19-R7. "Every count" is: the Board's per-stage "Items" count, Home's "waiting on you" count, and the `/health` counts of OB-1 and OB-2 (and their drill-through rows, which match the counts). Bot items still appear as cards and rows; only the numbers leave them out. The WIP gauge (`held` of `wipLimit`) stays whole, because the kernel enforces WIP on every claim. The Flow screen is not named by OB-4 and is unchanged. The count's text says so whenever it left at least one item out: "3, not counting 2 by dependabot[bot]" on the Board, ", not counting 2 on pull requests by bot accounts" on Home, "; not counting 2 by bot accounts" on `/health` (the Kpi's detail line is its label text) | A reader who expects the phrase on every count sees it only when something was left out; with nothing left out the number is exact |
| S19-R8. The author read is a new batch method, `GitHubFacts.authors(refs)`, answering `{ ref, author }` for each pull request the read model knows an author for, grouped by repository in one query each | One more method on a port every adapter implements |
| S19-R9. PI-2's route is the MCP `write_page` verb: service tokens are refused on `/api/*` (`verifiedIdentity`), so an external runner reaches the platform only through `/mcp`, and `write_page` runs the page API's own create and update. `source` is derived, never trusted: `external` when the verb runs on the external host, the principal is a delegated identity, and its live delegation has capability `review`; `platform` otherwise. An external learning must name `pull_request` in the delegation's harness repository (`malformed_command` without one, `not_permitted` for another repository). On an update, `source` and an external page's `pull_request` stay what they were. A frontmatter naming a `source` other than the derived one is refused `malformed_command` | The bench posts by MCP, not a bare HTTP POST; adding an HTTP route on the MCP surface is one file if the bench owner asks |
| S19-R10. `change_template { template }` is an admin command. Only `check-only` to `software` is allowed; any other pair, or a check-only harness whose stages are not a subset of the software template's keys, is refused `template_change_not_allowed` (with `why`). The kept stages keep their ids, items, WIP limits, instructions and every other column the admin set, and move to the software template's positions; the six new stages are inserted from the template; the change is recorded as a new harness event `template_changed` plus the `stage_edited` rows `editInTransaction` already records. Shadow, freeze, the external reviewers, protected paths and bot authors are untouched. The command drafts the software template's persona pages, skipping slugs already taken | A harness whose admin added a stage cannot change template until the stage is removed; the refusal says `stages_edited` |
| S19-R11. The silence alarm reuses `lockKeys.harnessEvents(harnessId)` for its check-and-record, so no lock prefix is added | Two minute jobs on one harness serialise briefly behind persona activation's lock |
| S19-R12. The contract moves one minor version for the whole step (everything is additive; new fields carry defaults) | None; the lock test enforces the rule |
| S19-R13. `template_changed` is an event the design did not list, and `harness_items.held_since` and `gh_prs.author_login` are columns it did not list; PRD sections 8.1, 8.3 and 8.6 and design section 6 are corrected in Task 1 | None |

**What this step hands to later steps (keep these names exactly):**

| Interface | Where | Consumed by |
|---|---|---|
| Wake reason `silence_alarm` (rank 3); event `silence_alarm` `{ level: 'red', waiting, oldestEnteredAt, lastReviewStepAt }`; `healthLink(indicator)` | `packages/contracts/closed-sets.ts`, `event-evidence.ts`, `notify.ts` | DX-10 (the journey may show a quiet Check) |
| `ItemState.heldSince`; `harness_items.held_since` | `packages/contracts/harness.ts`, `packages/db/schema.ts` | DX-10 |
| `holderOf(item, stage, reviewing)`, `heldTooLong(holder, at)`, `reviewingIds(tx, items)`, `Holder`, `HolderRole`, `PERSON_HOLD_MS`, `AGENT_HOLD_MS` | `packages/harness/views/holder.ts`, exported from `@uw/harness` | any later screen that shows a holder |
| `BoardCard.holder`, `BoardColumn.uncounted`, `PlayByPlay.holder`, `Waiting.uncounted` | `packages/harness/views/types.ts` | DX-10 |
| `views.silence(options)` returning `Silence[]`; `views.holds(options)` returning `Holds`; `PlaneIndicator` gains `silence_alarm`, `held_by_person`, `held_by_agent` | `packages/harness/views/index.ts`, `alarms/silence.ts`, `views/holds.ts` | GL-1's live run (the indicators answer through Hyperdrive) |
| `alarms.soundSilence(caller, { limit })` (system only) | `packages/harness/alarms/commands.ts`, `Kernel.alarms` | DX-10 |
| `Harness.botAuthors`, `botAuthorsSchema`, `defaultBotAuthors`, `activate_template.botAuthors` | `packages/contracts/harness.ts`, `commands.ts` | DX-10 |
| `GitHubFacts.authors(refs)`, `PullRequestAuthor`; `gh_prs.author_login`; `uncountedItems(facts, scopes)`, `pullRequestKey(ref)` | `packages/harness/ports.ts`, `packages/db/schema-github.ts`, `packages/harness/views/bots.ts` | GL-1 |
| `learningSourceSchema`, `LearningSource`; learning frontmatter `source`, `pull_request` | `packages/contracts/closed-sets.ts`, `page-types.ts` | v0.3.0 lessons (design section 10) |
| `learningProvenance`, `provenanceOf`, `ExternalWriter`; `createPageAs(db, actor, command, request)` | `apps/uw-app/pages/provenance.ts`, `store.ts` | any later external writer |
| Command `change_template`; error reason `template_change_not_allowed`; event `template_changed`; `stages.changeTemplate(caller, { harnessId, template })`; Store `harnesses.write.setTemplate(harnessId, from, to)` | contracts, `packages/harness/stages/template-change.ts`, `store-ports.ts` | DX-10 |
| sim `SimGitHubFacts.givenAuthor(ref, author)`; `createSimHarness` option `botAuthors` | `sim/adapters/github-facts.ts`, `sim/fixtures.ts` | DX-10 |

**Left for later steps, found while planning (recorded in the tracker by Task 11):**

1. `bot_authors` and `external_reviewer_identities` change only by re-activation; a `set_harness_lists` admin command is the additive fix if the pilot needs one.
2. The Flow screen's per-stage counts still include bot pull requests (S19-R7).
3. Items projected before this step have `heldSince: null` until their next event; `kernel.repair.rebuildItem` fills one item, and there is no bulk rebuild.
4. The silence alarm reads up to `VIEW_LIMIT` open items per harness per minute; a harness past 5,000 open items is capped and the indicator does not say so.

---

## Global Constraints

Every task obeys every line here. The controller passes this section to each implementer.

**Where and how**

- Work only in `/home/ianjl/projects/uw-platform-v0.2.0`, branch `build/v0.2.0`. Never commit to `main`, never force-push, never `--no-verify`.
- Read `AGENTS.md` sections 1, 4 and 10 before the first edit. When this plan and `AGENTS.md` disagree, `AGENTS.md` wins; record the conflict in `docs/progress_tracker.md` and build the version that keeps the rule.
- Words come from `CONTEXT.md`: **holder**, **silence alarm**, **check-only harness**, **item**, **claim**, **delegation**, **learning**, and this step's **bot author** and **external learning** (Task 1). Never "watchdog", "owner" or "assignee" for a holder, "review service" for a check-only harness, or "auto" anything.
- Commits: Conventional Commits, the agent as sole author, no attribution footer. Hooks always pass. Put the requirement IDs in each commit body.

**Code rules (all mechanically enforced by `pnpm verify`)**

- TypeScript `strict`, no `any`, no `@ts-ignore`, no `as unknown as`, no non-null assertion.
- No code comments of any kind.
- Files under 500 non-blank lines; functions under 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters. `apps/uw-app/github/facts/upsert.ts` and `apps/uw-app/github/sweep.ts` are near the limit after steps 14, 15 and 18: Task 6 adds one line to `upsert.ts` (`pullColumns`) and none to `sweep.ts`; if `upsert.ts` is at the limit, move one more reader out to a sibling file first, as steps 15 and 18 did, and say so in the commit body.
- Zod at every boundary. `packages/contracts` imports only `zod`. `packages/harness` imports nothing from Workers, Drizzle or the network.
- Every exported Zod schema registered in `packages/contracts/registry.ts` has `fixtures/<key>/valid/*.json` and `fixtures/<key>/invalid/*.json`. Any change to a registered `z.enum` appends a full entry to `packages/contracts/contract-lock.json` and changes `CONTRACT_VERSION`.
- Every route and command has `can()` on the harness's area through the command registry's `action`. `change_template` is `admin`. No MCP verb is added and no persona toolset changes (V2-7).
- `gate_decisions` and `harness_stages` are never written by anything an agent can reach. `harness_stages` is written here only by `editInTransaction`'s plan inside the stage command (`packages/harness/stages/`), which owns it. `harness_events` is written only through `recordHarnessEvents` and `recordItemEvents` (`packages/harness/items/record.ts`). `harnesses` is written only through `tx.harnesses.write.*` from `packages/harness/stages/`. `gh_prs` is written only by `apps/uw-app/github/facts/`. `pages` only by `apps/uw-app/pages/`.
- The system principal is named only in composition roots (`tools/architecture/system-principal.test.ts`): the kernel checks it with `isSystemPrincipal`, the cron builds it.
- UI: tokens only (no hex, no fixed pixel widths in classes), sentence case, second person, no exclamation marks, no emoji; Kindle orange marks a human action and nothing else, and this step adds no control, so it adds no Kindle; every link has an accessible name and visible focus; light, dark and phone width hold (`tools/ui` checks).

**Contract version**

- At planning time `packages/contracts/version.ts` reads `12.4.0` with step 14 in flight; step 15 moves it to `13.0.0`; steps 16, 17 and 18 may each add a minor. This step moves it to **the next minor after whatever is current** (expected `13.2.0` to `13.4.0`), once, in Task 2. Procedure: Task 2 Step 6 reads `CONTRACT_VERSION`, computes `<major>.<minor + 1>.0`, appends a lock entry built from the last one plus this step's values, writes the version, and prints it. Every later mention of "the step's version" means that printed value.

**Migrations**

- One migration for the step, generated in Task 3 with `--name observability_and_hooks`, at the next index after the newest file in `packages/db/migrations/` (expected `0033` or `0034`). No hand-written statement.

**Shared roots**

- `CONTEXT.md` (Task 1), `docs/PRD.md` and the design (Task 1, their own commit), `packages/contracts/` (Task 2), `packages/db/schema.ts` and `packages/db/schema-github.ts` with the migration (Task 3), `packages/harness/ports.ts` and `packages/harness/store-ports.ts` with its mirror `packages/db/store/types.ts` (Task 4) are shared roots. Each change to one is its own commit with no feature code, and the message names the root and why. `packages/db/store/`, `packages/db/test-seed.ts`, `apps/uw-app/generated/islands.ts` and the sim are not shared roots.
- Between Task 2 and Task 3 `tools/db/drift.test.ts` is red (the name checks derive from the enums). Between Task 4's port commit and its adapter commit `pnpm check` is red. Do those pairs back to back.

**Tests**

- A test that proves a requirement has a `describe` or `it` title starting with the requirement ID and a space, as `tools/trace/proofs.ts` reads it. A scenario's `id` is the requirement ID and its file is `sim/scenarios/<ID>.<slug>.ts`.
- Run one file with `npx vitest run <path>`. Database tests (`*.pg.test.ts`, `packages/db`, the Store and GitHub facts contracts on the platform adapter) need `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres` after `pg_ctl -D ~/.local/share/uw-platform-test-pg -o "-p 54329" start`. Never run two Vitest suites at once on this machine (WSL runs out of memory); `pnpm verify` runs them in sequence.

## Review Focus

Inputs the spec implies that no requirement row spells out, most likely to bite a person first. Each line names the task that pins it.

1. A claim writes the claim columns before the `item_claimed` event folds, so a fold that compares before and after sees no change and never starts the clock. Task 5 pins a claim folded onto a row that already names the claimant moving `heldSince`.
2. An item that was reviewed and now waits in Check for a person must not page the admins every ten minutes forever. Task 7 pins a reviewed item leaving the harness `ok`, and a build-capability run's steps not counting as review steps.
3. The minute cron runs every minute; a red harness must wake its admins once per cooldown, not once a minute. Task 7 pins two sounds a minute apart recording one event, and a third after the cooldown recording a second.
4. A Dependabot pull request's login arrives as `dependabot[bot]` and may be listed in another case. Task 6 pins `Dependabot[bot]` on the pull request being left out by a harness listing `dependabot[bot]`, and an author the facts do not know being counted.
5. A person posting to the page API, or a hosted agent, must not be able to mark a learning as the bench's. Task 9 pins a person's `source: external` refused, a runner on an `iterate` delegation refused for naming it, and an external learning's pull request not changing on a later edit.
6. Moving Check from position 10 to 50 and Ship from 20 to 60 must not collide with the positions the new stages take, and the items must keep their stage ids. Task 10 pins the item at Check and the item at Ship keeping their stage after the change, with eight stages in software order.

---

### Task 1: The words and the document corrections (shared roots `CONTEXT.md`, `docs/PRD.md`, the design)

**Files:**
- Modify: `CONTEXT.md` (two entries after **Silence alarm**)
- Modify: `docs/PRD.md` (sections 8.1, 8.3 and 8.6)
- Modify: `docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` (section 6)

**Interfaces:**
- Produces: the words **Bot author** and **External learning**.

This task writes no code. Two commits.

- [ ] **Step 1: Add the words**

In `CONTEXT.md`, after the **Silence alarm** entry (it ends `_Avoid_: watchdog`), and after any entry an earlier step appended there, insert:

```markdown

**Bot author**:
A GitHub account a harness lists in `bot_authors` (by default `dependabot[bot]`). An item whose pull request a bot author opened is shown on every screen and left out of every count of items, and the count says so.
_Avoid_: bot item, ignored author

**External learning**:
A learning page an external runner posted on a delegation whose capability is `review`, as the bench posts its weekly patterns. It lands `suggested`, names `source: external` and the pull request it came from, and a person confirms it like any other learning.
_Avoid_: bench learning, imported learning, ruling (that is the bench's word for a reviewer's decision)
```

- [ ] **Step 2: Commit (shared root)**

```bash
git add CONTEXT.md
git commit -m "docs(context): bot author and external learning

Shared root CONTEXT.md. The two words step 19's counts and page hook use.

OB-4 PI-2."
```

- [ ] **Step 3: Correct PRD sections 8.1, 8.3 and 8.6**

In `docs/PRD.md` section 8.1:

- In the `harnesses` row's "Columns that matter", append after the last column an earlier step added: `, the bot authors whose pull requests no count includes (\`bot_authors\`, default \`dependabot[bot]\`; OB-4)`.
- In the `harness_items` row, append: `, when the holder took the ball (\`held_since\`; OB-2)`.
- In the `gh_repos`, `gh_issues`, `gh_prs`, ... row, append to the facts list: `; on \`gh_prs\` the author's login (\`author_login\`; OB-4)`.
- In the `pages`, `page_versions` row, replace `see FD-9` with `see FD-9; a \`learning\` page's frontmatter names its \`source\` (\`platform\` or \`external\`) and, for an external one, the \`pull_request\` it came from (PI-2)`.

In section 8.3, after the row `| untrusted source (v0.2.0) | ... |` (and after any row a later step appended), add:

```markdown
| learning source (v0.2.0) | `platform`, `external` |
```

In section 8.6, in the line beginning `Added in v0.2.0:`, add `` `template_changed` `` after `` `delegated_merge` `` (and after any name an earlier step added), and after that line add:

```markdown
`silence_alarm` (step 19) is a harness event recorded by the minute cron as the system: `{ level: 'red', waiting, oldestEnteredAt, lastReviewStepAt }`, at most one per harness per notifier cooldown; it wakes the area's admins at rank 3 with a link to `/health/silence_alarm`. `template_changed` (step 19, GL-5) records `{ from, to, kept, added }` (stage keys) beside the `stage_edited` rows of the same change.
```

- [ ] **Step 4: Correct design section 6**

In `docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` section 6:

- **Tables and columns**: after the `harnesses` list add `` `harness_items`: `held_since`. `` (after anything step 18 added for `harness_items`), and in the `gh_prs` list add `` `author_login` ``.
- **Closed sets**: append `Learning source: \`platform\`, \`external\`.`
- **Events**: append `` `template_changed` `` to the list.

- [ ] **Step 5: Commit**

```bash
git add docs/PRD.md docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md
git commit -m "docs(prd): step 19's columns, closed set and events in sections 8.1, 8.3 and 8.6

The design names the requirements; step 19 found the projected held_since,
the facts column author_login, the learning source and the template_changed
event they need. Design section 6 corrected in the same commit.

OB-2 OB-4 PI-2 GL-5. S19-R13."
```

---

### Task 2: The contracts for observability and hooks (shared root `packages/contracts`)

**Files:**
- Modify: `packages/contracts/closed-sets.ts` (`silence_alarm` at the end of `wakeReasonSchema`; `learningSourceSchema`, `LearningSource`)
- Modify: `packages/contracts/events.ts` (`silence_alarm`, `template_changed` at the end of `eventNames`)
- Modify: `packages/contracts/event-evidence.ts` (two evidence schemas in `harnessEvidence`)
- Modify: `packages/contracts/outcomes.ts` (`template_change_not_allowed` at the end of `errorReasonSchema`)
- Modify: `packages/contracts/harness.ts` (`defaultBotAuthors`, `botAuthorsSchema`, `Harness.botAuthors`, `ItemState.heldSince`)
- Modify: `packages/contracts/commands.ts` (`change_template`; `activate_template.botAuthors`)
- Modify: `packages/contracts/page-types.ts` (`learningFrontmatterSchema` gains `source`, `pull_request`)
- Modify: `packages/contracts/notify.ts` (the deep-link pattern; `healthLink`)
- Modify: `packages/contracts/registry.ts` (`learning-source`, `bot-authors`)
- Create: fixtures (Step 5)
- Modify: `packages/contracts/events.test.ts` (the vocabulary count), `packages/contracts/contracts.test.ts` (new block)
- Modify: `packages/contracts/contract-lock.json`, `packages/contracts/version.ts`
- Second commit, not a shared root: `packages/harness/items/fold.ts` (`unchangedNames`; `created` sets `heldSince: null`), `packages/harness/notify/rank.ts`, `packages/harness/notify/plan.ts` (`screens`), `packages/harness/stages/activate.ts` (the `Harness` literal), every `Harness` and `ItemState` literal `pnpm check` flags, `apps/uw-app/commands/registry.ts`, `apps/uw-app/commands/registry.test.ts`, `apps/uw-app/generated/islands.ts`

**Interfaces:**
- Produces: `LearningSource = 'platform' | 'external'`; `defaultBotAuthors = ['dependabot[bot]']`; `Harness.botAuthors: string[]` (default `defaultBotAuthors`); `ItemState.heldSince: string | null` (default `null`); `EventEvidence['silence_alarm'] = { level: 'red'; waiting: number; oldestEnteredAt: string; lastReviewStepAt: string | null }`; `EventEvidence['template_changed'] = { from: string; to: string; kept: string[]; added: string[] }`; `CommandBody<'change_template'> = { command; requestId; template: TemplateKey }`; `activate_template.botAuthors` (default `defaultBotAuthors`); learning frontmatter `source: LearningSource` (default `'platform'`), `pull_request: PullRequestRef | null` (default `null`); `healthLink(indicator: string): DeepLink`.

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/events.test.ts`, the vocabulary test asserts a count and the last name. Read the count on disk (`grep -n "toHaveLength" packages/contracts/events.test.ts`), add two, and set the last name:

```ts
    expect(eventNameSchema.options.at(-1)).toBe('template_changed');
```

Append to `packages/contracts/contracts.test.ts` (import `commandSchema`, `defaultBotAuthors`, `deepLinkSchema`, `errorReasonSchema`, `eventEvidenceSchemas`, `harnessSchema`, `healthLink`, `itemStateSchema`, `learningFrontmatterSchema`, `learningSourceSchema`, `botAuthorsSchema`, `wakeReasonSchema` the way the file already imports its neighbours):

```ts
describe('OB-1 OB-2 OB-4 PI-2 GL-5 the contracts for observability and hooks', () => {
  const requestId = '00000000-0000-4000-8000-0000000000aa';
  const harness = {
    id: '00000000-0000-4000-8000-0000000000a1',
    key: 'tc-admin-app',
    template: 'check-only',
    jdArea: '80-89',
    repository: 'unfoldingWord/tc-admin-app',
    hostedBuilderEnabled: false,
    paused: false,
  };
  const item = {
    itemId: '00000000-0000-4000-8000-0000000000b1',
    harnessId: harness.id,
    stageKey: 'check',
    title: 'Bump the lockfile',
    pageId: null,
    priority: 0,
    due: null,
    holder: null,
    claimantKind: null,
    delegationId: null,
    leaseExpiresAt: null,
    gateStatus: 'working',
    gateTarget: null,
    branchState: 'none',
    expectedHead: null,
    riskTier: null,
    riskDomains: [],
    pullRequest: null,
    issue: null,
    zulipTopic: null,
  };
  const learning = { confidence: 'observed', as_of: '2026-10-15', supersedes: [], review_by: null };

  it('OB-1 ranks the silence alarm among the wake reasons and links its drill-through', () => {
    expect(wakeReasonSchema.options.at(-1)).toBe('silence_alarm');
    expect(healthLink('silence_alarm')).toBe('/health/silence_alarm');
    expect(deepLinkSchema.safeParse('/health/Silence').success).toBe(false);
    expect(deepLinkSchema.safeParse('/health/silence_alarm/more').success).toBe(false);
    const red = {
      level: 'red',
      waiting: 2,
      oldestEnteredAt: '2026-10-15T07:00:00.000Z',
      lastReviewStepAt: null,
    };
    expect(eventEvidenceSchemas.silence_alarm.safeParse(red).success).toBe(true);
    expect(eventEvidenceSchemas.silence_alarm.safeParse({ ...red, level: 'amber' }).success).toBe(false);
    expect(eventEvidenceSchemas.silence_alarm.safeParse({ ...red, waiting: 0 }).success).toBe(false);
  });

  it('OB-2 an item carries when its holder took the ball, null for an item folded before it', () => {
    expect(itemStateSchema.parse(item).heldSince).toBeNull();
    const held = { ...item, heldSince: '2026-10-15T08:00:00.000Z' };
    expect(itemStateSchema.parse(held).heldSince).toBe('2026-10-15T08:00:00.000Z');
    expect(itemStateSchema.safeParse({ ...item, heldSince: 'yesterday' }).success).toBe(false);
  });

  it('OB-4 a harness lists dependabot as a bot author unless told otherwise', () => {
    expect(defaultBotAuthors).toEqual(['dependabot[bot]']);
    expect(harnessSchema.parse(harness).botAuthors).toEqual(['dependabot[bot]']);
    expect(harnessSchema.parse({ ...harness, botAuthors: [] }).botAuthors).toEqual([]);
    expect(botAuthorsSchema.safeParse(['renovate[bot]', 'Renovate[bot]']).success).toBe(false);
    expect(botAuthorsSchema.safeParse(Array.from({ length: 21 }, (_, n) => `bot${n}`)).success).toBe(false);
    const activation = {
      command: 'activate_template',
      requestId,
      harnessKey: 'tc-admin-app',
      jdArea: '80-89',
      template: 'check-only',
      repository: 'unfoldingWord/tc-admin-app',
    };
    const parsed = commandSchema.parse(activation);
    expect(parsed.command === 'activate_template' ? parsed.botAuthors : null).toEqual(['dependabot[bot]']);
  });

  it('PI-2 a learning names its source and the pull request it came from, platform by default', () => {
    expect(learningSourceSchema.options).toEqual(['platform', 'external']);
    expect(learningFrontmatterSchema.parse(learning)).toMatchObject({ source: 'platform', pull_request: null });
    const external = {
      ...learning,
      source: 'external',
      pull_request: { repo: 'unfoldingWord/tc-admin-app', number: 7 },
    };
    expect(learningFrontmatterSchema.safeParse(external).success).toBe(true);
    expect(learningFrontmatterSchema.safeParse({ ...learning, source: 'bench' }).success).toBe(false);
  });

  it('GL-5 changes a template by command and refuses with its own reason', () => {
    const change = { command: 'change_template', requestId, template: 'software' };
    expect(commandSchema.safeParse(change).success).toBe(true);
    expect(commandSchema.safeParse({ ...change, template: 'kanban' }).success).toBe(false);
    expect(errorReasonSchema.options.at(-1)).toBe('template_change_not_allowed');
    const changed = { from: 'check-only', to: 'software', kept: ['check', 'ship'], added: ['package'] };
    expect(eventEvidenceSchemas.template_changed.safeParse(changed).success).toBe(true);
    expect(eventEvidenceSchemas.template_changed.safeParse({ ...changed, added: [] }).success).toBe(false);
  });
});
```

If a later step appended an error reason or a wake reason after this plan was written and before this task runs, the two `at(-1)` assertions still hold, because this task appends its values last.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/contracts/contracts.test.ts packages/contracts/events.test.ts -t "OB-1|OB-2|OB-4|PI-2|GL-5|vocabulary"`
Expected: FAIL; `healthLink` and the new schemas are undefined.

- [ ] **Step 3: The closed sets, the names and the evidence**

`packages/contracts/closed-sets.ts`: append `'silence_alarm'` as the last value of `wakeReasonSchema`; beside `untrustedSourceSchema`:

```ts
export const learningSourceSchema = z.enum(['platform', 'external']);
```

and beside `UntrustedSource`: `export type LearningSource = z.infer<typeof learningSourceSchema>;`.

`packages/contracts/events.ts`: append `'silence_alarm',` and `'template_changed',` as the last two values of `eventNames`.

`packages/contracts/outcomes.ts`: append `'template_change_not_allowed',` as the last value of `errorReasonSchema`.

`packages/contracts/event-evidence.ts`, inside `harnessEvidence`, after the last entry:

```ts
  silence_alarm: z.strictObject({
    level: z.literal('red'),
    waiting: z.number().int().min(1),
    oldestEnteredAt: instant,
    lastReviewStepAt: instant.nullable(),
  }),
  template_changed: z.strictObject({
    from: slugSchema,
    to: slugSchema,
    kept: z.array(stage).min(1),
    added: z.array(stage).min(1),
  }),
```

- [ ] **Step 4: The harness, the item, the commands, the learning and the link**

`packages/contracts/harness.ts`, after `externalReviewerIdentitiesSchema`:

```ts
export const defaultBotAuthors: readonly string[] = ['dependabot[bot]'];

export const botAuthorsSchema = z
  .array(githubLoginSchema)
  .max(20)
  .refine(distinctInAnyCase, 'each login once, in any case');
```

In `harnessSchema`, after the last field an earlier step added: `botAuthors: botAuthorsSchema.default([...defaultBotAuthors]),`. In `itemStateSchema`, after the last field an earlier step added (step 18's `blockedBy`): `heldSince: z.iso.datetime().nullable().default(null),`.

`packages/contracts/commands.ts`: append `'change_template',` as the last value of `commandNames`; in `activate_template`'s body, after the last field an earlier step added: `botAuthors: botAuthorsSchema.default([...defaultBotAuthors]),` (import both from `./harness.ts`); after the last entry of `harnessCommandSchemas`:

```ts
  change_template: body('change_template', { template: templateKeySchema }),
```

and add `harnessCommandSchemas.change_template,` as the last member of `commandSchema`'s union.

`packages/contracts/page-types.ts`: import `learningSourceSchema` from `./closed-sets.ts` and `pullRequestRefSchema` beside `repositorySchema` from `./harness.ts`; in `learningFrontmatterSchema`, after `contradicts`:

```ts
  source: learningSourceSchema.default('platform'),
  pull_request: pullRequestRefSchema.nullable().default(null),
```

`packages/contracts/notify.ts`:

```ts
const deepLinkPattern = new RegExp(
  `^/(?:harnesses/${uuidPart}/(?:gates|items)/${uuidPart}|health/[a-z][a-z_]{0,63})?$`,
);
```

and after `itemLink`:

```ts
export function healthLink(indicator: string): DeepLink {
  return deepLinkSchema.parse(`/health/${indicator}`);
}
```

`packages/contracts/registry.ts`, beside `'untrusted-source'`:

```ts
  'learning-source': closedSets.learningSourceSchema,
  'bot-authors': botAuthorsSchema,
```

(import `botAuthorsSchema` the way the file imports `externalReviewerIdentitiesSchema`). If `packages/contracts/index.ts` does not `export *` from `closed-sets.ts`, `harness.ts` and `notify.ts`, export the new names the way their neighbours are exported.

- [ ] **Step 5: The fixtures**

```bash
node --input-type=module -e '
import { mkdirSync, writeFileSync } from "node:fs";
const root = "packages/contracts/fixtures";
const write = (path, value) => {
  const file = `${root}/${path}`;
  mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
};
const harnessId = "00000000-0000-4000-8000-0000000000a1";
const requestId = "00000000-0000-4000-8000-0000000000aa";
const system = "agent:system";
const person = "human:00000000-0000-4000-8000-000000000001";
const event = (n, name, actor, evidence, request = null) => ({
  eventId: `00000000-0000-4000-8000-0000000001f${n}`,
  harnessId, itemId: null, name, position: n, at: "2026-10-15T09:00:00.000Z", actor, evidence,
  traceId: "00000000-0000-4000-8000-0000000000c1", requestId: request,
});
write("learning-source/valid/platform.json", "platform");
write("learning-source/valid/external.json", "external");
write("learning-source/invalid/unknown.json", "bench");
write("bot-authors/valid/dependabot.json", ["dependabot[bot]"]);
write("bot-authors/valid/none.json", []);
write("bot-authors/invalid/twice-in-any-case.json", ["renovate[bot]", "Renovate[bot]"]);
write("wake-reason/valid/silence-alarm.json", "silence_alarm");
write("error-reason/valid/template-change-not-allowed.json", "template_change_not_allowed");
write("deep-link/valid/health-indicator.json", "/health/silence_alarm");
write("deep-link/invalid/health-nested.json", "/health/silence_alarm/rows");
write("command/valid/change-template.json", { command: "change_template", requestId, template: "software" });
write("command/invalid/change-template-unknown.json", { command: "change_template", requestId, template: "kanban" });
write("learning-frontmatter/valid/external.json", {
  confidence: "observed", as_of: "2026-10-15", supersedes: [], review_by: null,
  source: "external", pull_request: { repo: "unfoldingWord/tc-admin-app", number: 7 } });
write("learning-frontmatter/invalid/unknown-source.json", {
  confidence: "observed", as_of: "2026-10-15", supersedes: [], review_by: null, source: "bench" });
write("event/valid/silence-alarm.json", event(1, "silence_alarm", system, {
  level: "red", waiting: 2, oldestEnteredAt: "2026-10-15T07:00:00.000Z", lastReviewStepAt: null }));
write("event/invalid/silence-alarm-amber.json", event(1, "silence_alarm", system, {
  level: "amber", waiting: 2, oldestEnteredAt: "2026-10-15T07:00:00.000Z", lastReviewStepAt: null }));
write("event/valid/template-changed.json", event(2, "template_changed", person, {
  from: "check-only", to: "software", kept: ["check", "ship"],
  added: ["package", "scope", "plan", "build", "validate", "close"] }, requestId));
write("event/invalid/template-changed-adding-nothing.json", event(2, "template_changed", person, {
  from: "check-only", to: "software", kept: ["check", "ship"], added: [] }, requestId));
'
npx prettier --write packages/contracts/fixtures
```

If the `agent:system` identity string is not the one `packages/contracts/identity.ts` exports as the system identity, use that string in the two `silence_alarm` fixtures.

- [ ] **Step 6: Append the lock entry and bump the version**

```bash
node -e '
const fs = require("node:fs");
const { readFileSync } = fs;
const p = "packages/contracts/contract-lock.json";
const versionFile = "packages/contracts/version.ts";
const version = /CONTRACT_VERSION = .(\d+)\.(\d+)\.(\d+)./.exec(readFileSync(versionFile, "utf8"));
const next = `${version[1]}.${Number(version[2]) + 1}.0`;
const lock = JSON.parse(readFileSync(p, "utf8"));
const last = lock.versions.at(-1).sets;
const add = (key, values) => [...last[key], ...values.filter((value) => !last[key].includes(value))];
const sets = { ...last,
  "wake-reason": add("wake-reason", ["silence_alarm"]),
  "event-name": add("event-name", ["silence_alarm", "template_changed"]),
  "command-name": add("command-name", ["change_template"]),
  "error-reason": add("error-reason", ["template_change_not_allowed"]),
  "learning-source": ["platform", "external"] };
const sorted = Object.fromEntries(Object.entries(sets).sort(([a], [b]) => a.localeCompare(b)));
lock.versions.push({ version: next, sets: sorted });
fs.writeFileSync(p, JSON.stringify(lock, null, 2) + "\n");
fs.writeFileSync(versionFile, readFileSync(versionFile, "utf8").replace(/CONTRACT_VERSION = .\d+\.\d+\.\d+./, `CONTRACT_VERSION = \x27${next}\x27`));
console.log(next);
'
npx prettier --write packages/contracts/contract-lock.json packages/contracts/version.ts
```

Expected: prints the step's version. If the lock names a set by another key than `wake-reason`, `event-name`, `command-name` or `error-reason` (read the last entry's keys first), use the lock's key.

- [ ] **Step 7: Run the contracts tests**

Run: `npx vitest run packages/contracts`
Expected: all green, including `golden fixtures`, `CT-3 the contract lock` and `contract version`.

- [ ] **Step 8: Find every pin of the old version outside the package**

```bash
grep -rn "<the version you replaced>" --include='*.ts' --include='*.sql' packages apps sim tools | grep -v node_modules | grep -v contract-lock.json
```

If a `.ts` file asserts the live version with `assertLiveContractVersion`, change its string to the step's version in this commit and name it in the body; if it only lists names, leave it.

- [ ] **Step 9: Commit (shared root)**

```bash
git add packages/contracts
git commit -m "feat(contracts): the silence alarm, the holder's clock, bot authors, external learnings and the template change

Shared root packages/contracts. The wake reason and harness event
silence_alarm with a /health deep link; ItemState.heldSince; the harness
list bot_authors (default dependabot[bot]) set at activation; a learning's
source and pull request; the command change_template, its refusal
template_change_not_allowed and the event template_changed. Every new field
has a default, so earlier rows and events read unchanged. Additive, one
minor version.

OB-1 OB-2 OB-4 PI-2 GL-5. S19-R5 S19-R6 S19-R9 S19-R10 S19-R12."
```

- [ ] **Step 10: Fill the totals the new values force (second commit)**

`packages/harness/items/fold.ts`: add `'silence_alarm',` and `'template_changed',` to `unchangedNames`; in `created`, after the last field (step 18's `blockedBy`), add `heldSince: null,` (Task 5 makes it the creation time).

`packages/harness/notify/rank.ts`: `wakeRank` gains `silence_alarm: 3,`. `packages/harness/notify/plan.ts`: `screens` gains `['silence_alarm', 'home'],`.

`packages/harness/stages/activate.ts`: the `Harness` literal gains `botAuthors: [...defaultBotAuthors],` (import `defaultBotAuthors` from `@uw/contracts`); Task 6 makes it the activation input.

Run `pnpm check`. For each `Harness` object literal it flags, add `botAuthors: []` (a test literal that means a harness without bots) or `botAuthors: ['dependabot[bot]']` (one that compares with a stored harness); for each `ItemState` literal, add `heldSince: null`.

`apps/uw-app/commands/registry.ts`: add `notWiredCommand('change_template', 'admin'),` as the last entry of the `commandRegistryOf([...])` list (import `notWiredCommand` from `./not-wired.ts` if it is not imported). `apps/uw-app/commands/registry.test.ts`: add `change_template: 'admin',` to `actions`.

Regenerate the islands bundle, which embeds the contract schemas: `pnpm ui:islands`.

Run: `pnpm check && npx vitest run packages/harness/items packages/harness/notify packages/contracts apps/uw-app/commands/registry.test.ts tools/ui/generated-islands.test.ts`
Expected: green. `tools/db/drift.test.ts` is red until Task 3.

```bash
git add packages/harness apps/uw-app sim tools
git commit -m "chore: the totals the observability contracts force

The two harness events fold to nothing, silence_alarm ranks 3 and opens
Home, every Harness and ItemState literal names botAuthors and heldSince,
change_template is registered not wired until Task 10, and the islands
bundle is rebuilt.

OB-1 OB-2 OB-4 GL-5."
```

---

### Task 3: The columns, the migration and the Store binding (shared root `packages/db/schema.ts`, `schema-github.ts`)

**Files:**
- Modify: `packages/db/schema.ts` (`harnesses.bot_authors` and its check; `harness_items.held_since`)
- Modify: `packages/db/schema-github.ts` (`gh_prs.author_login`)
- Create: `packages/db/migrations/00NN_observability_and_hooks.sql`, its snapshot and journal entry (generated)
- Create: `packages/db/observability-columns.test.ts`
- Second commit: `packages/db/store/rows.ts` (`toHarness`, `toItemState`), `packages/db/store/items.ts` (`columnsOf`), `packages/harness/port-contracts/store-observability.ts` (create), `packages/harness/port-contracts/store.ts` (wire it)

**Interfaces:**
- Consumes: Task 2's enums (the name checks regenerate from them), `Harness.botAuthors`, `ItemState.heldSince`.
- Produces: Drizzle fields `harnesses.botAuthors`, `harnessItems.heldSince`, `ghPrs.authorLogin`. The Store reads and writes `Harness.botAuthors` and `ItemState.heldSince` through the existing `insert`, `project`, `byId`, `byIds`, `forHarness`, `openFor`, `list`.

- [ ] **Step 1: Write the failing test**

`packages/db/observability-columns.test.ts`:

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

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

function observabilityColumns(db: () => Db): void {
  it('OB-4 a harness lists dependabot as a bot author by default', async () => {
    await db().execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
      VALUES (gen_random_uuid(), 'bots-default', 'check-only', '80-89', now())`);
    const rows = await db().execute<{ bots: string[] }>(
      sql`SELECT bot_authors AS bots FROM harnesses WHERE key = 'bots-default'`,
    );
    expect(rows[0]).toEqual({ bots: ['dependabot[bot]'] });
  });

  it('OB-4 refuses more than twenty bot authors by harnesses_bot_authors_bounded', async () => {
    const many = `{${Array.from({ length: 21 }, (_, n) => `b${n}`).join(',')}}`;
    const insert = db().execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at, bot_authors)
      VALUES (gen_random_uuid(), 'bots-many', 'check-only', '80-89', now(), ${many}::text[])`);
    expect(await refusal(insert)).toEqual({ code: '23514', constraint: 'harnesses_bot_authors_bounded' });
  });

  it('OB-2 OB-4 adds the held-since instant and the pull request author', async () => {
    const columns = await db().execute<{ table_name: string; column_name: string; is_nullable: string }>(sql`
      SELECT table_name, column_name, is_nullable FROM information_schema.columns
      WHERE (table_name, column_name) IN (('harness_items', 'held_since'), ('gh_prs', 'author_login'))
      ORDER BY table_name`);
    expect(columns.map((row) => [row.table_name, row.column_name, row.is_nullable])).toEqual([
      ['gh_prs', 'author_login', 'YES'],
      ['harness_items', 'held_since', 'YES'],
    ]);
  });

  it('OB-1 GL-5 admits the new event and command names', async () => {
    const checks = await db().execute<{ definition: string }>(sql`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conname IN ('harness_events_name_known', 'command_requests_command_known')`);
    const text = checks.map((row) => row.definition).join(' ');
    for (const name of ['silence_alarm', 'template_changed', 'change_template']) {
      expect(text).toContain(`'${name}'`);
    }
  });
}

describe('the observability columns', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => observabilityColumns(openDatabase(target)),
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/db/observability-columns.test.ts`
Expected: FAIL, column `bot_authors` does not exist.

- [ ] **Step 3: Add the columns**

`packages/db/schema.ts`, in `harnesses` after the last column an earlier step added:

```ts
    botAuthors: text('bot_authors').array().notNull().default(sql`'{dependabot[bot]}'::text[]`),
```

and in its checks:

```ts
    check('harnesses_bot_authors_bounded', sql`cardinality(${t.botAuthors}) <= 20`),
```

In `harnessItems`, after the last column an earlier step added: `heldSince: instant('held_since'),`.

`packages/db/schema-github.ts`, in `ghPrs` after `requestedReviewers` (and after any column step 15 added): `authorLogin: text('author_login'),`.

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @uw/db exec drizzle-kit generate --name observability_and_hooks`
Expected: one new file `packages/db/migrations/00NN_observability_and_hooks.sql` with: `ALTER TABLE "harnesses" ADD COLUMN "bot_authors" text[] DEFAULT '{dependabot[bot]}'::text[] NOT NULL`, `ALTER TABLE "harness_items" ADD COLUMN "held_since" timestamp with time zone`, `ALTER TABLE "gh_prs" ADD COLUMN "author_login" text`, the `harnesses_bot_authors_bounded` check, and a drop-and-add of `harness_events_name_known` and `command_requests_command_known` whose lists include the new names. Read the file; if it contains anything else, stop and find out why before committing.

- [ ] **Step 5: Run the database tests and the drift test**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/db tools/db/drift.test.ts`
Expected: green, including `migrations`, `the observability columns` on both targets, and `schema drift`.

- [ ] **Step 6: Commit (shared root)**

```bash
git add packages/db/schema.ts packages/db/schema-github.ts packages/db/migrations packages/db/observability-columns.test.ts
git commit -m "feat(db): bot authors, the holder's clock and the pull request author

Shared root packages/db/schema.ts and schema-github.ts, one migration for
step 19. harnesses.bot_authors (default dependabot[bot], at most 20) is
written by the stage command; harness_items.held_since by the kernel's
fold; gh_prs.author_login by the facts module. The event and command checks
admit silence_alarm, template_changed and change_template.

OB-1 OB-2 OB-4 GL-5. S19-R2 S19-R6."
```

- [ ] **Step 7: Bind the columns in the Store (second commit)**

`packages/db/store/rows.ts`: `toHarness` passes `botAuthors: row.botAuthors,`; `toItemState` passes `heldSince: row.heldSince?.toISOString() ?? null,`. `packages/db/store/items.ts`: `columnsOf` gains `heldSince: item.heldSince === null ? null : new Date(item.heldSince),`. (The harness insert spreads the `Harness`, whose `botAuthors` field matches the Drizzle field name.)

`packages/harness/port-contracts/store-observability.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Store } from '../ports.ts';
import { at, harnessOf, itemOf, seedHarness, uid } from './store-gateway-fixtures.ts';

type ObservabilitySubject = () => { readonly store: Store };

export function describeStoreObservability(adapter: string, subject: ObservabilitySubject): void {
  describe(`store columns for observability on ${adapter}`, () => {
    it('DX-3 stores the bot authors and when an item was taken', async () => {
      const harness = { ...harnessOf(0x7800, 'gateway-bots'), botAuthors: ['renovate[bot]'] };
      const held = itemOf(0x7900, 1, { heldSince: '2026-10-01T08:00:00.000Z' });
      const read = await subject().store.transaction(async (tx) => {
        await tx.harnesses.write.insert(harness, at);
        await seedHarness(tx, 0x7900, 'gateway-held');
        await tx.harnessItems.write.insert(held, at);
        const inserted = await tx.harnessItems.read.byId(held.itemId);
        await tx.harnessItems.write.project({ ...held, heldSince: '2026-10-01T09:30:00.000Z' });
        return {
          harness: await tx.harnesses.read.byId(harness.id),
          inserted,
          projected: await tx.harnessItems.read.byId(held.itemId),
          plain: await tx.harnessItems.read.byId(uid(0x9999)),
        };
      });
      expect(read.harness?.botAuthors).toEqual(['renovate[bot]']);
      expect(read.inserted?.heldSince).toBe('2026-10-01T08:00:00.000Z');
      expect(read.projected?.heldSince).toBe('2026-10-01T09:30:00.000Z');
      expect(read.plain).toBeNull();
    });
  });
}
```

`packages/harness/port-contracts/store.ts`: import it and call `describeStoreObservability(adapter, subject);` after `describeStoreJoining(adapter, subject);` (and after any describe a later step added there). The Store's `setTemplate` case joins this file in Task 4.

If `itemOf` refuses `heldSince` because `itemStateSchema` was parsed before Task 2 landed, it will not: Task 2 is committed by now.

Run: `pnpm check && npx vitest run sim/adapters/store.contract.test.ts` then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/ports/store.contract.pg.test.ts packages/db`
Expected: green.

```bash
git add packages/db/store packages/harness/port-contracts
git commit -m "feat(db): the Store reads and writes bot authors and the holder's clock

Harness.botAuthors and ItemState.heldSince go through the existing insert,
project and reads; the Store contract pins both on every adapter.

OB-2 OB-4."
```

---

### Task 4: The ports: the template write and the author read (shared roots `packages/harness/ports.ts`, `store-ports.ts`)

**Files:**
- Modify: `packages/harness/store-ports.ts` and its mirror `packages/db/store/types.ts` (`HarnessesGateway.write.setTemplate`)
- Modify: `packages/harness/ports.ts` (`PullRequestAuthor`, `GitHubFacts.authors`)
- Second commit: `packages/db/store/harnesses.ts` (`setTemplate`), `packages/harness/port-contracts/store-observability.ts` (one case), `packages/harness/port-contracts/github-facts.ts` (subject `givenAuthor`; one case; the not-wired record), `sim/adapters/github-facts.ts`, `sim/adapters/github-facts.contract.test.ts`, `apps/uw-app/github/facts/authors.ts` (create), `apps/uw-app/ports/github-facts.ts`, `apps/uw-app/ports/github-facts.not-wired.ts`, `apps/uw-app/ports/github-facts.contract.pg.test.ts`, `apps/uw-app/testing/kernel.ts` (`fixedFacts`), every `GitHubFacts` literal `pnpm check` flags (expect `apps/uw-app/testing/run-host.ts`, `sim/kernel/adopt-branch.test.ts`, `sim/kernel/ship-refresh.test.ts`, `sim/kernel/gate-view.test.ts`, `sim/kernel/connector-exit.test.ts`, `sim/kernel/submit-facts.test.ts`)

**Interfaces:**
- Produces:
  - `HarnessesGateway.write.setTemplate(harnessId: string, from: string, to: string): Promise<boolean>` (true only when the stored template was `from`)
  - `PullRequestAuthor = { readonly ref: PullRequestRef; readonly author: string }`
  - `GitHubFacts.authors(refs: readonly PullRequestRef[]): Promise<readonly PullRequestAuthor[]>` (one answer per known pull request with a known author, the repository named as the read model stores it; unknown ones are absent)
  - sim `SimGitHubFacts.givenAuthor(ref: PullRequestRef, author: string): void`; contract subject `givenAuthor(ref, author): Promise<void>`

- [ ] **Step 1: Change the ports (shared-root commit)**

`packages/harness/store-ports.ts`, in `HarnessesGateway.write` after `setShadow` (and after any write a later step added):

```ts
    setTemplate(harnessId: string, from: string, to: string): Promise<boolean>;
```

and the same line in the mirror `packages/db/store/types.ts`.

`packages/harness/ports.ts`, below `DiffRead`:

```ts
export type PullRequestAuthor = { readonly ref: PullRequestRef; readonly author: string };
```

and in `GitHubFacts`, after the last method (step 18's `epic`):

```ts
  authors(refs: readonly PullRequestRef[]): Promise<readonly PullRequestAuthor[]>;
```

Run: `pnpm check`
Expected: FAIL only where a `HarnessesGateway` or a `GitHubFacts` is built. Commit the ports alone:

```bash
git add packages/harness/ports.ts packages/harness/store-ports.ts packages/db/store/types.ts
git commit -m "feat(harness): the Store changes a harness's template; the GitHub facts read pull request authors

Shared roots packages/harness/ports.ts and store-ports.ts. setTemplate is a
compare-and-set on harnesses.template for GL-5; GitHubFacts.authors answers
the author of each known pull request in one read for OB-4's counts. The
adapters and the contract suites follow in the next commit (AGENTS rule 1).

OB-4 GL-5. S19-R8 S19-R10."
```

(`pnpm check` is red until Step 4.)

- [ ] **Step 2: The contract cases**

`packages/harness/port-contracts/store-observability.ts`, inside the `describe`:

```ts
    it('DX-3 changes a template only from the one it names', async () => {
      const harness = { ...harnessOf(0x7a00, 'gateway-template'), template: 'check-only' };
      const read = await subject().store.transaction(async (tx) => {
        await tx.harnesses.write.insert(harness, at);
        const wrong = await tx.harnesses.write.setTemplate(harness.id, 'bml', 'software');
        const changed = await tx.harnesses.write.setTemplate(harness.id, 'check-only', 'software');
        const again = await tx.harnesses.write.setTemplate(harness.id, 'check-only', 'software');
        const missing = await tx.harnesses.write.setTemplate(uid(0x7aff), 'check-only', 'software');
        return { wrong, changed, again, missing, after: await tx.harnesses.read.byId(harness.id) };
      });
      expect(read).toEqual({
        wrong: false,
        changed: true,
        again: false,
        missing: false,
        after: { ...harness, template: 'software' },
      });
    });
```

`packages/harness/port-contracts/github-facts.ts`: `GithubFactsSubject` gains `givenAuthor(ref: PullRequestRef, author: string): Promise<void>;`. Inside `describeGithubFactsContract`'s `describe`, add:

```ts
    it('OB-4 answers the author of each pull request it knows, in any case, and nothing for an unknown one', async () => {
      const subject = await open();
      await subject.given(factsFor('unfoldingWord/uw-platform', 31, 'b'.repeat(40)));
      await subject.given(factsFor('unfoldingWord/uw-platform', 32, 'c'.repeat(40)));
      await subject.givenAuthor({ repo: 'unfoldingWord/uw-platform', number: 31 }, 'dependabot[bot]');
      const authors = await subject.facts.authors([
        { repo: 'UNFOLDINGWORD/UW-PLATFORM', number: 31 },
        { repo: 'unfoldingWord/uw-platform', number: 32 },
        { repo: 'unfoldingWord/uw-platform', number: 404 },
      ]);
      expect(authors).toEqual([
        { ref: { repo: 'unfoldingWord/uw-platform', number: 31 }, author: 'dependabot[bot]' },
      ]);
      expect(await subject.facts.authors([])).toEqual([]);
    });
```

In `describeGithubFactsNotWired`'s record add `authors: true,`.

- [ ] **Step 3: The Store binding**

`packages/db/store/harnesses.ts`, in `write` after `setShadow`:

```ts
      setTemplate: (harnessId, from, to) =>
        refusing(async () => {
          const rows = await executor
            .update(harnesses)
            .set({ template: to })
            .where(and(eq(harnesses.id, harnessId), eq(harnesses.template, from)))
            .returning({ id: harnesses.id });
          return rows.length > 0;
        }),
```

(import `and` from `drizzle-orm` beside `eq`).

- [ ] **Step 4: The facts adapters**

`apps/uw-app/github/facts/authors.ts`:

```ts
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Executor } from '@uw/db/client';
import { ghPrs, ghRepos } from '@uw/db/schema';
import type { PullRequestAuthor, PullRequestRef } from '@uw/harness';

const AUTHORS_LIMIT = 5000;

function byRepository(refs: readonly PullRequestRef[]): ReadonlyMap<string, readonly number[]> {
  const grouped = new Map<string, number[]>();
  for (const ref of refs.slice(0, AUTHORS_LIMIT)) {
    const repo = ref.repo.toLowerCase();
    const numbers = grouped.get(repo) ?? [];
    numbers.push(ref.number);
    grouped.set(repo, numbers);
  }
  return grouped;
}

async function authorsIn(
  db: Executor,
  repo: string,
  numbers: readonly number[],
): Promise<readonly PullRequestAuthor[]> {
  const rows = await db
    .select({ repo: ghRepos.fullName, number: ghPrs.number, author: ghPrs.authorLogin })
    .from(ghPrs)
    .innerJoin(ghRepos, eq(ghRepos.githubId, ghPrs.repoId))
    .where(
      and(
        sql`lower(${ghRepos.fullName}) = ${repo}`,
        inArray(ghPrs.number, [...numbers]),
        isNotNull(ghPrs.authorLogin),
      ),
    );
  return rows.flatMap((row) =>
    row.author === null ? [] : [{ ref: { repo: row.repo, number: row.number }, author: row.author }],
  );
}

export async function pullRequestAuthors(
  db: Executor,
  refs: readonly PullRequestRef[],
): Promise<readonly PullRequestAuthor[]> {
  const found: PullRequestAuthor[] = [];
  for (const [repo, numbers] of byRepository(refs)) found.push(...(await authorsIn(db, repo, numbers)));
  return found;
}
```

`apps/uw-app/ports/github-facts.ts`: `authors: (refs) => pullRequestAuthors(db, refs),` (import from `../github/facts/authors.ts`). `apps/uw-app/ports/github-facts.not-wired.ts`: `authors: () => notWiredCall('githubFacts', 'authors'),`.

`apps/uw-app/ports/github-facts.contract.pg.test.ts`: the subject gains

```ts
      givenAuthor: async (ref, author) => {
        await db.execute(sql`UPDATE gh_prs SET author_login = ${author} FROM gh_repos
          WHERE gh_repos.github_id = gh_prs.repo_id AND lower(gh_repos.full_name) = lower(${ref.repo})
          AND gh_prs.number = ${ref.number}`);
      },
```

(import `sql` from `drizzle-orm`; use the name the file gives the subject's database handle).

`sim/adapters/github-facts.ts`: `SimGitHubFacts` gains `givenAuthor(ref: PullRequestRef, author: string): void;`; inside `createSimGitHubFacts`:

```ts
  const authors = new Map<string, PullRequestAuthor>();
```

and on the returned object:

```ts
    authors: async (refs) =>
      refs.flatMap((ref) => {
        const found = authors.get(keyOf(ref));
        return found === undefined ? [] : [structuredClone(found)];
      }),
    givenAuthor: (ref, author) => {
      authors.set(keyOf(ref), { ref: { ...ref }, author });
    },
```

(import `PullRequestAuthor` from `@uw/harness`). `sim/adapters/github-facts.contract.test.ts`: the subject gains `givenAuthor: async (ref, author) => facts.givenAuthor(ref, author),`.

`apps/uw-app/testing/kernel.ts` `fixedFacts`: `authors: async () => [],`. Run `pnpm check`; add `authors: async () => [],` to every other `GitHubFacts` literal it flags.

- [ ] **Step 5: Run the contracts and the adapters**

Run: `pnpm check && npx vitest run sim/adapters packages/harness/port-contracts` then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/ports`
Expected: green, including `DX-3 githubFacts port contract` with the `OB-4` case on both adapters and the not-wired record, and the Store contract's `setTemplate` case.

- [ ] **Step 6: Commit**

```bash
git add packages/db/store packages/harness/port-contracts sim apps/uw-app
git commit -m "feat: bind the template write and the author read on every adapter

The Store's setTemplate is a compare-and-set on harnesses.template; the
GitHub facts read authors from gh_prs.author_login by repository; the sim
answers the authors a scenario gives; both contracts pin the behaviour on
every adapter and the not-wired adapter refuses.

OB-4 GL-5. S19-R8."
```

---

### Task 5: OB-2, the holder and how long, on the Board and the item

**Files:**
- Modify: `packages/harness/items/fold.ts` (`heldSince` on creation and on every move)
- Create: `packages/harness/items/fold-held.test.ts`
- Create: `packages/harness/views/holder.ts`, `packages/harness/views/holder.test.ts`
- Modify: `packages/harness/views/types.ts` (`BoardCard.holder`, `PlayByPlay.holder`), `packages/harness/views/board.ts`, `packages/harness/views/play.ts`, `packages/harness/index.ts`
- Create: `apps/uw-app/views/parts/holder-words.ts`, `apps/uw-app/views/parts/holder-words.test.ts`
- Modify: `apps/uw-app/views/parts/board-card.tsx` (`CardViewer.at`; the Holder line), `apps/uw-app/views/screens/board.tsx` (`viewerOf`), `apps/uw-app/views/screens/play.tsx` (the holder line)
- Create: `sim/kernel/holder.test.ts`

**Interfaces:**
- Consumes: Task 2's `ItemState.heldSince`; Task 3's projection.
- Produces: `holderOf(item: ItemState, stage: Pick<Stage, 'exitGate'> | undefined, reviewing: boolean): Holder | null`; `heldTooLong(holder: Holder | null, at: Date): 'person' | 'agent' | null`; `reviewingIds(tx: StoreTransaction, items: readonly ItemState[]): Promise<ReadonlySet<string>>`; `Holder = { role: HolderRole; kind: 'agent' | 'person'; identity: Identity | null; since: Date | null }`; `HolderRole = 'claimant' | 'reviewer' | 'decider'`; `PERSON_HOLD_MS`, `AGENT_HOLD_MS`; `BoardCard.holder`, `PlayByPlay.holder`; `holderText(holder, at)` in the app.

- [ ] **Step 1: Write the failing tests**

`packages/harness/items/fold-held.test.ts`:

```ts
import { newEventSchema, type NewHarnessEvent } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { foldItem, replay } from './fold.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000b1';
const person = 'human:00000000-0000-4000-8000-000000000001';
let count = 0;

function event(name: string, at: string, evidence: Record<string, unknown>): NewHarnessEvent {
  count += 1;
  return newEventSchema.parse({
    eventId: `00000000-0000-4000-8000-${String(count).padStart(12, '0')}`,
    harnessId,
    itemId,
    name,
    at,
    actor: person,
    evidence,
    traceId: '00000000-0000-4000-8000-0000000000c1',
    requestId: null,
  });
}

const claim = { holder: person, claimantKind: 'person', delegationId: null, leaseExpiresAt: null };
const created = event('item_created', '2026-10-15T08:00:00.000Z', {
  stage: 'package',
  title: 'Hold the ball',
  pageId: null,
  priority: 0,
  due: null,
});
const claimed = event('item_claimed', '2026-10-15T09:00:00.000Z', claim);

describe('OB-2 an item knows when its holder took the ball', () => {
  it('OB-2 starts at creation and moves on a claim', () => {
    expect(replay([created])?.heldSince).toBe('2026-10-15T08:00:00.000Z');
    expect(replay([created, claimed])?.heldSince).toBe('2026-10-15T09:00:00.000Z');
  });

  it('OB-2 does not move on a lease renewal or a reorder', () => {
    const renewed = event('lease_renewed', '2026-10-15T10:00:00.000Z', {
      leaseExpiresAt: '2026-10-15T10:15:00.000Z',
    });
    const reordered = event('item_reordered', '2026-10-15T10:30:00.000Z', { priority: 4, before: null });
    expect(replay([created, claimed, renewed, reordered])?.heldSince).toBe('2026-10-15T09:00:00.000Z');
  });

  it('OB-2 moves on a release and on a stage change', () => {
    const released = event('item_released', '2026-10-15T11:00:00.000Z', { holder: person });
    const advanced = event('stage_advanced', '2026-10-15T12:00:00.000Z', { from: 'package', to: 'scope' });
    expect(replay([created, claimed, released])?.heldSince).toBe('2026-10-15T11:00:00.000Z');
    expect(replay([created, claimed, released, advanced])?.heldSince).toBe('2026-10-15T12:00:00.000Z');
  });

  it('OB-2 moves on a claim folded onto a row the claim write already updated', () => {
    const live = replay([created, claimed]);
    if (live === null) throw new Error('the item did not fold');
    const again = event('item_claimed', '2026-10-15T13:00:00.000Z', claim);
    expect(foldItem(live, again).heldSince).toBe('2026-10-15T13:00:00.000Z');
  });
});
```

If the `stage_advanced` step refuses to fold for an item that is not at `from`, it will not: the item was created at `package`.

`packages/harness/views/holder.test.ts`:

```ts
import { itemStateSchema, type ItemState } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { AGENT_HOLD_MS, PERSON_HOLD_MS, heldTooLong, holderOf } from './holder.ts';

const since = '2026-10-15T08:00:00.000Z';
const base: ItemState = itemStateSchema.parse({
  itemId: '00000000-0000-4000-8000-0000000000b1',
  harnessId: '00000000-0000-4000-8000-0000000000a1',
  stageKey: 'check',
  title: 'Hold the ball',
  pageId: null,
  priority: 0,
  due: null,
  holder: null,
  claimantKind: null,
  delegationId: null,
  leaseExpiresAt: null,
  gateStatus: 'working',
  gateTarget: null,
  branchState: 'none',
  expectedHead: null,
  riskTier: null,
  riskDomains: [],
  pullRequest: null,
  issue: null,
  zulipTopic: null,
  heldSince: since,
});
const person = 'human:00000000-0000-4000-8000-000000000001';
const agent = 'agent:reviewer';
const checks = { exitGate: 'checks' as const };
const human = { exitGate: 'human_approval' as const };

describe('OB-2 who holds the ball', () => {
  it('OB-2 is the claimant, a person or an agent', () => {
    const held = { ...base, holder: person, claimantKind: 'person' as const };
    expect(holderOf(held, checks, false)).toEqual({
      role: 'claimant',
      kind: 'person',
      identity: person,
      since: new Date(since),
    });
  });

  it('OB-2 is the Reviewer when the claim rides a review delegation', () => {
    const held = { ...base, holder: agent, claimantKind: 'agent' as const };
    expect(holderOf(held, checks, true)).toMatchObject({ role: 'reviewer', kind: 'agent', identity: agent });
  });

  it('OB-2 is a person who may decide while the item is parked at a human gate', () => {
    const parked = { ...base, gateStatus: 'parked' as const };
    expect(holderOf(parked, human, false)).toEqual({
      role: 'decider',
      kind: 'person',
      identity: null,
      since: new Date(since),
    });
    expect(holderOf(parked, checks, false)).toBeNull();
  });

  it('OB-2 is nobody for an unclaimed working item or a done one', () => {
    expect(holderOf(base, checks, false)).toBeNull();
    expect(holderOf({ ...base, holder: person, claimantKind: 'person', gateStatus: 'done' }, checks, false)).toBeNull();
  });

  it('OB-2 holds too long past 24 hours for a person and 2 hours for an agent, never without a since', () => {
    const start = new Date(since).getTime();
    const personHolder = holderOf({ ...base, holder: person, claimantKind: 'person' }, checks, false);
    const agentHolder = holderOf({ ...base, holder: agent, claimantKind: 'agent' }, checks, false);
    expect(heldTooLong(personHolder, new Date(start + PERSON_HOLD_MS))).toBeNull();
    expect(heldTooLong(personHolder, new Date(start + PERSON_HOLD_MS + 1))).toBe('person');
    expect(heldTooLong(agentHolder, new Date(start + AGENT_HOLD_MS + 1))).toBe('agent');
    const unknown = holderOf({ ...base, heldSince: null, holder: agent, claimantKind: 'agent' }, checks, false);
    expect(heldTooLong(unknown, new Date(start + PERSON_HOLD_MS * 10))).toBeNull();
  });
});
```

`apps/uw-app/views/parts/holder-words.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { holderText } from './holder-words.ts';

const at = new Date('2026-10-16T09:30:00.000Z');
const since = new Date('2026-10-15T08:00:00.000Z');

describe('OB-2 the holder in words', () => {
  it('OB-2 names the claimant and how long they have held it', () => {
    const holder = { role: 'claimant' as const, kind: 'person' as const, identity: 'human:ian', since };
    expect(holderText(holder, at)).toBe('Claimed by human:ian, for 1 d 1 h');
  });

  it('OB-2 names the Reviewer, a waiting decision, nobody, and an unknown start', () => {
    const reviewer = { role: 'reviewer' as const, kind: 'agent' as const, identity: 'agent:reviewer', since };
    const decider = { role: 'decider' as const, kind: 'person' as const, identity: null, since: null };
    expect(holderText(reviewer, at)).toBe('Under review by agent:reviewer, for 1 d 1 h');
    expect(holderText(decider, at)).toBe('Waiting on a person to decide');
    expect(holderText(null, at)).toBe('Nobody');
  });
});
```

`sim/kernel/holder.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { reviewWorld } from '../review-runs.ts';
import { value } from '../runs.ts';
import { simParkedAtShip, standardChange } from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const hour = 3_600_000;

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

function cardsOf(board: Awaited<ReturnType<World['kernel']['views']['board']>>, stageKey: string) {
  if (board.status !== 'accepted') throw new Error(`the board was refused: ${board.reason}`);
  return board.value.columns.find((column) => column.stage.key === stageKey)?.cards ?? [];
}

describe('OB-2 the Board and the item show who holds the ball and since when', () => {
  it('OB-2 a person who claims an item holds it from the claim', () =>
    inWorld(async (world) => {
      const { harness, admin } = await createSimHarness(world, software);
      const caller = simCaller(world, admin);
      const { itemId } = value(
        await world.kernel.items.enqueue(caller, {
          harnessId: harness.id,
          title: 'Hold the package',
          pageId: null,
          priority: 1,
          due: null,
          delegationId: null,
        }),
      );
      const claimedAt = world.adapters.clock.now();
      value(await world.kernel.items.claim(caller, { itemId, delegationId: null }));
      world.adapters.clock.advance(25 * hour);
      const board = await world.kernel.views.board(caller, { harnessId: harness.id, stageKey: null, after: null });
      const holder = { role: 'claimant', kind: 'person', identity: admin.identity, since: claimedAt };
      expect(cardsOf(board, 'package').map((card) => card.holder)).toEqual([holder]);
      const play = value(await world.kernel.views.playByPlay(caller, { itemId, after: 0 }));
      expect(play.holder).toEqual(holder);
    }));

  it('OB-2 the Reviewer holds the item it claimed under a review delegation', () =>
    inWorld(async (world) => {
      const scene = await reviewWorld(world);
      const caller = simCaller(world, scene.admin);
      const board = await world.kernel.views.board(caller, { harnessId: scene.harnessId, stageKey: null, after: null });
      const card = cardsOf(board, 'check').find((entry) => entry.item.itemId === scene.itemId);
      expect(card?.holder).toMatchObject({ role: 'reviewer', kind: 'agent', identity: 'agent:reviewer' });
    }));

  it('OB-2 an item parked at Ship waits on a person to decide from when it parked', () =>
    inWorld(async (world) => {
      const { harness, admin } = await createSimHarness(world, software);
      const parked = await simParkedAtShip(world, {
        harnessId: harness.id,
        editor: admin,
        title: 'Merge the board change',
        change: standardChange,
      });
      const parkedAt = world.adapters.clock.now();
      world.adapters.clock.advance(hour);
      const caller = simCaller(world, admin);
      const play = value(await world.kernel.views.playByPlay(caller, { itemId: parked.itemId, after: 0 }));
      expect(play.holder).toEqual({ role: 'decider', kind: 'person', identity: null, since: parkedAt });
    }));
});
```

(The sim clock does not move while a scene is built, so the claim and the parking happen at the instant read just before or after them. If a fixture advances the clock, read `heldSince` from the item instead and compare `since` with `new Date(item.heldSince)`.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/harness/items/fold-held.test.ts packages/harness/views/holder.test.ts apps/uw-app/views/parts/holder-words.test.ts sim/kernel/holder.test.ts`
Expected: FAIL; `heldSince` stays `null`, `holder.ts` and `holder-words.ts` do not exist.

- [ ] **Step 3: The clock in the fold**

`packages/harness/items/fold.ts`: in `created`, replace `heldSince: null,` with `heldSince: event.at,`. Add above `foldItem`:

```ts
function moved(before: ItemState, after: ItemState, event: FoldableEvent): boolean {
  return (
    event.name === 'item_claimed' ||
    before.holder !== after.holder ||
    before.gateStatus !== after.gateStatus ||
    before.stageKey !== after.stageKey
  );
}
```

and replace the last two lines of `foldItem` with:

```ts
  const step = steps.get(event.name);
  const next = step === undefined ? state : step(state, event);
  return moved(state, next, event) ? { ...next, heldSince: event.at } : next;
```

- [ ] **Step 4: The holder**

`packages/harness/views/holder.ts`:

```ts
import type { Identity, ItemState, Stage } from '@uw/contracts';
import type { StoreTransaction } from '../ports.ts';

export const PERSON_HOLD_MS = 24 * 3_600_000;
export const AGENT_HOLD_MS = 2 * 3_600_000;

export type HolderRole = 'claimant' | 'reviewer' | 'decider';
export type Holder = {
  readonly role: HolderRole;
  readonly kind: 'agent' | 'person';
  readonly identity: Identity | null;
  readonly since: Date | null;
};
export type HeldTooLong = 'person' | 'agent' | null;

function sinceOf(item: ItemState): Date | null {
  return item.heldSince === null ? null : new Date(item.heldSince);
}

export function holderOf(
  item: ItemState,
  stage: Pick<Stage, 'exitGate'> | undefined,
  reviewing: boolean,
): Holder | null {
  if (item.gateStatus === 'done') return null;
  const since = sinceOf(item);
  if (item.holder !== null) {
    const kind = item.claimantKind === 'agent' ? 'agent' : 'person';
    return { role: reviewing ? 'reviewer' : 'claimant', kind, identity: item.holder, since };
  }
  if (item.gateStatus === 'parked' && stage?.exitGate === 'human_approval') {
    return { role: 'decider', kind: 'person', identity: null, since };
  }
  return null;
}

export function heldTooLong(holder: Holder | null, at: Date): HeldTooLong {
  if (holder === null || holder.since === null) return null;
  const held = at.getTime() - holder.since.getTime();
  if (holder.kind === 'person') return held > PERSON_HOLD_MS ? 'person' : null;
  return held > AGENT_HOLD_MS ? 'agent' : null;
}

export async function reviewingIds(
  tx: StoreTransaction,
  items: readonly ItemState[],
): Promise<ReadonlySet<string>> {
  const reviews = new Map<string, boolean>();
  const reviewing = new Set<string>();
  for (const item of items) {
    const { delegationId } = item;
    if (item.holder === null || delegationId === null) continue;
    if (!reviews.has(delegationId)) {
      const delegation = await tx.delegations.read.byId(delegationId);
      reviews.set(delegationId, delegation?.capability === 'review');
    }
    if (reviews.get(delegationId) === true) reviewing.add(item.itemId);
  }
  return reviewing;
}
```

If `Identity` is not exported from `@uw/contracts`, use `string`.

`packages/harness/views/types.ts`: import `type Holder` from `./holder.ts`; `BoardCard` gains `readonly holder: Holder | null;`; `PlayByPlay` gains `readonly holder: Holder | null;`.

`packages/harness/views/board.ts`: import `holderOf, reviewingIds` from `./holder.ts`. Change `cardOf` to take the holder:

```ts
function cardOf(item: ItemState, runs: readonly RunRow[], holder: BoardCard['holder']): BoardCard {
  const own = runs.filter((run) => run.itemId === item.itemId);
  const liveRun = own.find((run) => liveOutcomes.has(run.outcome)) ?? null;
  return {
    item,
    host: hostOf(item, liveRun),
    leaseExpiresAt: leaseOf(item),
    bases: basesOf(own),
    cost: costOf(own),
    liveRun,
    holder,
  };
}

type Marks = { readonly reviewing: ReadonlySet<string> };

function columnOf(listed: Listed, runs: readonly RunRow[], marks: Marks): BoardColumn {
  const holder = (item: ItemState) =>
    holderOf(item, listed.stage, marks.reviewing.has(item.itemId));
  return {
    stage: listed.stage,
    held: listed.held,
    cards: listed.items.map((item) => cardOf(item, runs, holder(item))),
    next: nextOf(listed.items),
  };
}
```

and at the end of `boardView`:

```ts
  const items = listed.flatMap((column) => column.items);
  const runs = await tx.harnessRuns.read.forItems(items.map((item) => item.itemId));
  const marks = { reviewing: await reviewingIds(tx, items) };
  return accepted({ harness, columns: listed.map((column) => columnOf(column, runs, marks)) });
```

(keep any field step 18 added to the returned view, such as `epics` and `notReady`).

`packages/harness/views/play.ts`: import `holderOf, reviewingIds`; before the `return`:

```ts
  const reviewing = await reviewingIds(tx, [item]);
  const holder = holderOf(item, stage, reviewing.has(item.itemId));
```

and add `holder` to the accepted object.

`packages/harness/index.ts`: export `AGENT_HOLD_MS, PERSON_HOLD_MS, heldTooLong, holderOf` and the types `Holder`, `HolderRole` from `./views/holder.ts`.

- [ ] **Step 5: The holder on the Board card and the item screen**

`apps/uw-app/views/parts/holder-words.ts`:

```ts
import { formatDuration } from '@uw/core/dates';
import type { Holder, HolderRole } from '@uw/harness';

const roleWords = {
  claimant: 'Claimed by',
  reviewer: 'Under review by',
  decider: 'Waiting on a person to decide',
} as const satisfies Record<HolderRole, string>;

export function holderText(holder: Holder | null, at: Date): string {
  if (holder === null) return 'Nobody';
  const words = roleWords[holder.role];
  const who = holder.identity === null ? words : `${words} ${holder.identity}`;
  if (holder.since === null) return who;
  return `${who}, for ${formatDuration(at.getTime() - holder.since.getTime())}`;
}
```

`apps/uw-app/views/parts/board-card.tsx`: `CardViewer` becomes `{ readonly identity: string; readonly admin: boolean; readonly at: Date }`; `metaOf(card)` becomes `metaOf(card, at)` and its Holder line becomes `{ label: 'Holder', value: holderText(card.holder, at) },`; `BoardCardView` calls `metaOf(card, props.viewer.at)`.

`apps/uw-app/views/screens/board.tsx`: `viewerOf` returns `{ identity, admin, at }` (it already receives `at`).

`apps/uw-app/views/screens/play.tsx`: import `holderText`; directly after `<PageHead ... />` add:

```tsx
      <p class="m-0 mb-4 text-sm text-muted">{`Holder: ${holderText(play.holder, screen.at)}`}</p>
```

- [ ] **Step 6: Run them, the harness and the sim**

Run: `pnpm check && npx vitest run packages/harness apps/uw-app/views/parts sim/kernel` then `pnpm sim -- all`
Expected: green. A test or scenario that compares a whole `ItemState` with `toEqual` now carries `heldSince`; set it to the `at` of the last claim, release, stage change or parking the test performed (the sim clock does not move unless the test advances it, so it is usually the scene's start), and say so in the commit body. `KN-4 an item is the fold of its events` stays green because the projection and the replay agree.

Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/views tools/ui`
Expected: green. A Board test asserting the card's `Holder` value for a claimed card now reads `Claimed by <identity>, for <n> min`; update it to that.

- [ ] **Step 7: Check the Board and the item screen in light, dark and phone width**

Run the app locally (`pnpm --filter @uw/uw-app dev` with the dev principal, as step 8 records in the tracker) and load a Board with a claimed card and that item's page, at 360 px wide, in light and in dark. If no browser can run here, add a "Not verified" row to the tracker naming both screens.

- [ ] **Step 8: Commit**

```bash
git add packages/harness apps/uw-app sim
git commit -m "feat(harness): who holds the ball and for how long, on the Board and the item

The fold stamps heldSince whenever the holder, the gate status or the
stage changes, or a claim lands. holderOf names the claimant, the Reviewer
(a claim under a review delegation) or a person who may decide (parked at a
human gate); the Board card and the item screen show it with how long.

OB-2. S19-R1 S19-R2."
```

---

### Task 6: OB-4, the author on the facts and honest counts on the Board and Home

**Files:**
- Modify: `apps/uw-app/github/payloads.ts` (`user` on `pullSchema`), `apps/uw-app/github/facts/records.ts` (`PullRequestRecord.authorLogin`), `apps/uw-app/github/facts/normalise.ts` (`pullOf`), `apps/uw-app/github/facts/upsert.ts` (`pullColumns`), `apps/uw-app/github/facts/normalise.test.ts` (one test), every `PullRequestRecord` literal `pnpm check` flags
- Modify: `packages/harness/stages/activate.ts` (`ActivateInput.botAuthors`), `apps/uw-app/commands/person/stages.ts` (`activateTemplateCommand`), `sim/fixtures.ts` (`createSimHarness` option `botAuthors`)
- Create: `packages/harness/views/bots.ts`, `packages/harness/views/bots.test.ts`
- Modify: `packages/harness/views/types.ts` (`BoardColumn.uncounted`, `Waiting.uncounted`), `packages/harness/views/board.ts`, `packages/harness/views/waiting.ts`, `packages/harness/views/index.ts` (the ports the two views take), `packages/harness/index.ts`
- Modify: `apps/uw-app/views/screens/board.tsx` (the Items count), `apps/uw-app/views/screens/home.tsx` (the lede)
- Create: `sim/kernel/bot-counts.test.ts`

**Interfaces:**
- Consumes: Task 4's `GitHubFacts.authors` and `givenAuthor`; Task 3's `gh_prs.author_login`.
- Produces: `pullRequestKey(ref: PullRequestRef): string`; `listsAuthor(harness: Pick<Harness, 'botAuthors'>, author: string): boolean`; `uncountedItems(facts: Pick<GitHubFacts, 'authors'>, scopes: readonly CountScope[]): Promise<ReadonlySet<string>>` with `CountScope = { readonly harness: Pick<Harness, 'botAuthors'>; readonly items: readonly ItemState[] }`; `BoardColumn.uncounted: number`; `Waiting.uncounted: number`; `ActivateInput.botAuthors?: readonly string[]`.

- [ ] **Step 1: Write the failing tests**

In `apps/uw-app/github/facts/normalise.test.ts` (reuse the file's REST pull fixture and repo record; read its top first):

```ts
describe('OB-4 the facts carry the pull request author', () => {
  it('reads the author login, and none when the payload has no user', () => {
    const authored = { ...restPull, user: { login: 'dependabot[bot]' } };
    expect(factsFromPull(repo, authored)?.pullRequests[0]?.authorLogin).toBe('dependabot[bot]');
    expect(factsFromPull(repo, { ...restPull, user: null })?.pullRequests[0]?.authorLogin).toBeNull();
  });
});
```

If the REST fixture already carries a `user`, the second case sets it to `null` and still expects `null`.

`packages/harness/views/bots.test.ts`:

```ts
import { itemStateSchema, type ItemState } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { PullRequestAuthor, PullRequestRef } from '../ports.ts';
import { listsAuthor, pullRequestKey, uncountedItems } from './bots.ts';

const repo = 'unfoldingWord/tc-admin-app';

function item(n: number, pullRequest: PullRequestRef | null): ItemState {
  return itemStateSchema.parse({
    itemId: `00000000-0000-4000-8000-00000000000${n}`,
    harnessId: '00000000-0000-4000-8000-0000000000a1',
    stageKey: 'check',
    title: `Item ${n}`,
    pageId: null,
    priority: 0,
    due: null,
    holder: null,
    claimantKind: null,
    delegationId: null,
    leaseExpiresAt: null,
    gateStatus: 'working',
    gateTarget: null,
    branchState: 'none',
    expectedHead: pullRequest === null ? null : 'a'.repeat(40),
    riskTier: null,
    riskDomains: [],
    pullRequest,
    issue: null,
    zulipTopic: null,
  });
}

function answering(found: readonly PullRequestAuthor[]) {
  const asked: PullRequestRef[][] = [];
  return {
    asked,
    facts: {
      authors: async (refs: readonly PullRequestRef[]) => {
        asked.push([...refs]);
        return found;
      },
    },
  };
}

describe('OB-4 which items no count includes', () => {
  it('OB-4 leaves out a pull request a listed bot opened, in any case, and counts an unknown author', async () => {
    const bot = item(1, { repo, number: 7 });
    const person = item(2, { repo, number: 8 });
    const unknown = item(3, { repo, number: 9 });
    const plain = item(4, null);
    const { facts, asked } = answering([
      { ref: { repo: repo.toUpperCase(), number: 7 }, author: 'Dependabot[bot]' },
      { ref: { repo, number: 8 }, author: 'outside-reviewer' },
    ]);
    const harness = { botAuthors: ['dependabot[bot]'] };
    const left = await uncountedItems(facts, [{ harness, items: [bot, person, unknown, plain] }]);
    expect([...left]).toEqual([bot.itemId]);
    expect(asked).toEqual([[{ repo, number: 7 }, { repo, number: 8 }, { repo, number: 9 }]]);
  });

  it('OB-4 asks nothing for a harness that lists no bot', async () => {
    const { facts, asked } = answering([]);
    const left = await uncountedItems(facts, [{ harness: { botAuthors: [] }, items: [item(1, { repo, number: 7 })] }]);
    expect(left.size).toBe(0);
    expect(asked).toEqual([]);
  });

  it('OB-4 keys a pull request in any case and matches a login in any case', () => {
    expect(pullRequestKey({ repo: 'UnfoldingWord/TC', number: 3 })).toBe('unfoldingword/tc#3');
    expect(listsAuthor({ botAuthors: ['renovate[bot]'] }, 'Renovate[bot]')).toBe(true);
    expect(listsAuthor({ botAuthors: ['renovate[bot]'] }, 'renovate')).toBe(false);
  });
});
```

`sim/kernel/bot-counts.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { reviewWorld } from '../review-runs.ts';
import { simParkedAtShip, shipPullRequest, standardChange } from '../ship-fixtures.ts';
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

describe('OB-4 counts leave out pull requests a listed bot opened', () => {
  it('OB-4 the Board leaves the bot item out of the Check count and keeps its card', () =>
    inWorld(async (world) => {
      const scene = await reviewWorld(world);
      world.adapters.githubFacts.givenAuthor(shipPullRequest, 'dependabot[bot]');
      const caller = simCaller(world, scene.admin);
      const board = await world.kernel.views.board(caller, { harnessId: scene.harnessId, stageKey: null, after: null });
      if (board.status !== 'accepted') throw new Error(board.reason);
      const check = board.value.columns.find((column) => column.stage.key === 'check');
      expect(check?.cards.map((card) => card.item.itemId)).toContain(scene.itemId);
      expect(check?.uncounted).toBe(1);
    }));

  it('OB-4 the Board counts a pull request whose author is not listed', () =>
    inWorld(async (world) => {
      const scene = await reviewWorld(world);
      world.adapters.githubFacts.givenAuthor(shipPullRequest, 'outside-reviewer');
      const caller = simCaller(world, scene.admin);
      const board = await world.kernel.views.board(caller, { harnessId: scene.harnessId, stageKey: null, after: null });
      if (board.status !== 'accepted') throw new Error(board.reason);
      expect(board.value.columns.every((column) => column.uncounted === 0)).toBe(true);
    }));

  it('OB-4 Home lists a gate on a bot pull request and does not count it', () =>
    inWorld(async (world) => {
      const { harness, admin } = await createSimHarness(world, software);
      await simParkedAtShip(world, { harnessId: harness.id, editor: admin, title: 'Bump the lockfile', change: standardChange });
      world.adapters.githubFacts.givenAuthor(shipPullRequest, 'Dependabot[bot]');
      const waiting = await world.kernel.views.waitingOn(simCaller(world, admin));
      expect(waiting.rows.filter((row) => row.kind === 'gate')).toHaveLength(1);
      expect(waiting.uncounted).toBe(1);
    }));

  it('OB-4 a harness activated with no bot authors counts every item', () =>
    inWorld(async (world) => {
      const { harness, admin } = await createSimHarness(world, software, { botAuthors: [] });
      await simParkedAtShip(world, { harnessId: harness.id, editor: admin, title: 'Bump the lockfile', change: standardChange });
      world.adapters.githubFacts.givenAuthor(shipPullRequest, 'dependabot[bot]');
      expect(harness.botAuthors).toEqual([]);
      expect((await world.kernel.views.waitingOn(simCaller(world, admin))).uncounted).toBe(0);
    }));
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run apps/uw-app/github/facts/normalise.test.ts packages/harness/views/bots.test.ts sim/kernel/bot-counts.test.ts`
Expected: FAIL; `authorLogin`, `bots.ts`, `uncounted` and the `botAuthors` option do not exist.

- [ ] **Step 3: The author into the facts**

`apps/uw-app/github/payloads.ts`, in `pullSchema`: `user: z.object({ login: name }).nullable().optional(),`.

`apps/uw-app/github/facts/records.ts`, `PullRequestRecord` gains `readonly authorLogin: string | null;`.

`apps/uw-app/github/facts/normalise.ts`, in `pullOf`'s returned object after `milestoneId`: `authorLogin: pull.user?.login ?? null,`.

`apps/uw-app/github/facts/upsert.ts`, `pullColumns` gains `authorLogin: ghPrs.authorLogin,` (the insert copies the record, whose field name matches). Run `pnpm check`; add `authorLogin: null` to every `PullRequestRecord` literal it flags.

- [ ] **Step 4: Bot authors at activation**

`packages/harness/stages/activate.ts`: `ActivateInput` gains `readonly botAuthors?: readonly string[];`; in `activateTemplate`, after the repository check:

```ts
  const bots = botAuthorsSchema.safeParse(input.botAuthors ?? [...defaultBotAuthors]);
  if (!bots.success) return refused('malformed_command', { field: 'botAuthors' });
```

and the `Harness` literal's `botAuthors: [...defaultBotAuthors],` becomes `botAuthors: bots.data,` (import `botAuthorsSchema` beside `defaultBotAuthors`). If the function passes the statement limit, move the three input checks (repository, step 14's lists, bots) into one `inputRefusal(input)` helper returning `Refused | null` and say so in the commit body.

`apps/uw-app/commands/person/stages.ts`, `activateTemplateCommand`: destructure `botAuthors` from the body beside `shadow` and pass it in `input`.

`sim/fixtures.ts`: `SimHarnessOptions` gains `readonly botAuthors?: readonly string[];`; `createSimHarness` passes `...(options.botAuthors === undefined ? {} : { botAuthors: options.botAuthors }),` into the activation input.

- [ ] **Step 5: The count rule**

`packages/harness/views/bots.ts`:

```ts
import type { Harness, ItemState } from '@uw/contracts';
import type { GitHubFacts, PullRequestRef } from '../ports.ts';

export type CountScope = {
  readonly harness: Pick<Harness, 'botAuthors'>;
  readonly items: readonly ItemState[];
};

type Watched = {
  readonly harness: Pick<Harness, 'botAuthors'>;
  readonly itemId: string;
  readonly ref: PullRequestRef;
};

export function pullRequestKey(ref: PullRequestRef): string {
  return `${ref.repo.toLowerCase()}#${ref.number}`;
}

export function listsAuthor(harness: Pick<Harness, 'botAuthors'>, author: string): boolean {
  const login = author.toLowerCase();
  return harness.botAuthors.some((bot) => bot.toLowerCase() === login);
}

function watchedOf(scopes: readonly CountScope[]): readonly Watched[] {
  return scopes.flatMap(({ harness, items }) =>
    harness.botAuthors.length === 0
      ? []
      : items.flatMap((item) =>
          item.pullRequest === null ? [] : [{ harness, itemId: item.itemId, ref: item.pullRequest }],
        ),
  );
}

export async function uncountedItems(
  facts: Pick<GitHubFacts, 'authors'>,
  scopes: readonly CountScope[],
): Promise<ReadonlySet<string>> {
  const watched = watchedOf(scopes);
  if (watched.length === 0) return new Set();
  const found = await facts.authors(watched.map(({ ref }) => ref));
  const authors = new Map(found.map(({ ref, author }) => [pullRequestKey(ref), author]));
  const left = watched.filter(({ harness, ref }) => {
    const author = authors.get(pullRequestKey(ref));
    return author !== undefined && listsAuthor(harness, author);
  });
  return new Set(left.map(({ itemId }) => itemId));
}
```

`packages/harness/index.ts`: export `listsAuthor, pullRequestKey, uncountedItems` and the type `CountScope` from `./views/bots.ts`.

- [ ] **Step 6: The Board and Home leave them out**

`packages/harness/views/types.ts`: `BoardColumn` gains `readonly uncounted: number;`; `Waiting` gains `readonly uncounted: number;`.

`packages/harness/views/board.ts`: `boardView`'s first parameter becomes `ports: Pick<Ports, 'grants' | 'githubFacts'>` (import `Ports` from `../ports.ts`); `Marks` gains `readonly uncounted: ReadonlySet<string>;`; `columnOf` adds `uncounted: listed.items.filter((item) => marks.uncounted.has(item.itemId)).length,`; and

```ts
  const marks = {
    reviewing: await reviewingIds(tx, items),
    uncounted: await uncountedItems(ports.githubFacts, [{ harness, items }]),
  };
```

`packages/harness/views/waiting.ts`: `waitingOn`'s first parameter becomes `ports: Pick<Ports, 'grants' | 'githubFacts'>`; `nothingWaiting` gains `uncounted: 0`; add

```ts
function rowItem(row: WaitingRow): { readonly harness: Harness; readonly item: ItemState } | null {
  if (row.kind === 'gate') return { harness: row.gate.harness, item: row.gate.item };
  if (row.kind === 'delegation_lapsed') return null;
  return { harness: row.harness, item: row.item };
}

async function uncountedRows(
  facts: Pick<GitHubFacts, 'authors'>,
  rows: readonly WaitingRow[],
): Promise<number> {
  const pairs = rows.flatMap((row) => rowItem(row) ?? []);
  const scopes = pairs.map(({ harness, item }) => ({ harness, items: [item] }));
  const left = await uncountedItems(facts, scopes);
  return pairs.filter(({ item }) => left.has(item.itemId)).length;
}
```

and in `waitingOn`:

```ts
  const rows = [...gateRows, ...lapsed.rows, ...failed.rows, ...handed.rows];
  return {
    rows,
    uncounted: await uncountedRows(ports.githubFacts, rows),
    failedRunsCapped: failed.capped,
    gatesCapped: gates.capped,
    lapsedCapped: lapsed.capped,
    handedCapped: handed.capped,
  };
```

(import `ItemState` and `GitHubFacts`, `Ports` types, and `uncountedItems`; keep any row kind a later step added, mapping it in `rowItem` to its harness and item or `null`).

`packages/harness/views/index.ts` already passes `ports` (`ViewPorts` includes `githubFacts`) to both; `pnpm check` names any other caller of `boardView` or `waitingOn`, which passes its kernel's ports the same way.

`apps/uw-app/views/screens/board.tsx`, in `ColumnView` replace the `items` line with:

```tsx
  const items = itemsText(column, view.harness.botAuthors);
```

and add above `ColumnView`:

```tsx
function itemsText(column: BoardColumn, botAuthors: readonly string[]): string {
  if (column.next !== null) return '50 or more';
  const counted = formatCount(column.cards.length - column.uncounted);
  if (column.uncounted === 0) return counted;
  return `${counted}, not counting ${formatCount(column.uncounted)} by ${botAuthors.join(', ')}`;
}
```

`apps/uw-app/views/screens/home.tsx`: replace `lede` with

```ts
function lede(count: number, capped: boolean, uncounted: number): string {
  const head = capped
    ? `At least ${formatCount(count)} things are waiting on you`
    : count === 1
      ? '1 thing is waiting on you'
      : `${formatCount(count)} things are waiting on you`;
  if (uncounted === 0) return head;
  return `${head}, not counting ${formatCount(uncounted)} on pull requests by bot accounts`;
}
```

and its call becomes `lede(rows.length - waiting.uncounted, notes.length > 0, waiting.uncounted)`.

- [ ] **Step 7: Run them**

Run: `pnpm check && npx vitest run packages/harness/views apps/uw-app/github/facts/normalise.test.ts sim/kernel` then `pnpm sim -- all`
Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/github apps/uw-app/views apps/uw-app/commands tools/ui`
Expected: green. A test comparing a whole `BoardColumn` or `Waiting` gains `uncounted: 0`.

- [ ] **Step 8: Check the Board and Home in light, dark and phone width**

As Task 5 Step 7, with one card on a bot's pull request so the "not counting" text shows; the column header must wrap, not overflow, at 360 px.

- [ ] **Step 9: Commit**

```bash
git add apps/uw-app packages/harness sim
git commit -m "feat: honest counts leave out pull requests a listed bot opened

The facts record each pull request's author; a harness lists its bot
authors at activation (default dependabot[bot]). The Board's Items count and
Home's waiting count leave out items whose pull request a listed bot
opened, still show them, and say how many they left out.

OB-4. S19-R6 S19-R7."
```

---

### Task 7: OB-1, the silence alarm in the kernel, the wake and the minute cron

**Files:**
- Create: `packages/harness/alarms/silence.ts`, `packages/harness/alarms/silence.test.ts`, `packages/harness/alarms/commands.ts`
- Modify: `packages/harness/kernel.ts` (`Kernel.alarms`), `packages/harness/views/index.ts` (`silence`), `packages/harness/index.ts`
- Modify: `packages/harness/notify/triggers.ts`, `packages/harness/notify/recipients.ts`, `packages/harness/notify/plan.ts` (`linkOf`)
- Modify: `apps/uw-app/islands/worker/sw-core.ts` (`PUSH_TITLES`), `apps/uw-app/generated/islands.ts` (regenerated)
- Modify: `apps/uw-app/cron/minute.ts` (the `silence` step)
- Create: `apps/uw-app/cron/silence.pg.test.ts`
- Create: `sim/kernel/silence.test.ts`, `sim/scenarios/OB-1.a-silent-check-goes-red-and-wakes-the-admins-once-per-cooldown.ts`

**Interfaces:**
- Consumes: Task 6's `uncountedItems`; Task 2's `silence_alarm` event, wake reason and `healthLink`.
- Produces: `SILENCE_RED_MS`, `SILENCE_AMBER_MS`; `SilenceLevel = 'ok' | 'amber' | 'red'`; `WaitingInCheck = { item: ItemState; enteredAt: Date }`; `Silence = { harness: Harness; level: SilenceLevel; waiting: readonly WaitingInCheck[]; uncounted: number; lastReviewStepAt: Date | null }`; `silenceLevel(waiting, lastStep, at)`; `silenceOf(ports, tx, harness, at)`; `silences(ports, tx, at)`; `AlarmCommands.soundSilence(caller: Caller, input: { readonly limit: number }): Promise<KernelOutcome<{ readonly sounded: readonly string[] }>>`; `ViewReads.silence(options?): Promise<readonly Silence[]>`.

- [ ] **Step 1: Write the failing tests**

`packages/harness/alarms/silence.test.ts`:

```ts
import { itemStateSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { SILENCE_AMBER_MS, SILENCE_RED_MS, silenceLevel } from './silence.ts';

const at = new Date('2026-10-15T12:00:00.000Z');
const minute = 60_000;
const item = itemStateSchema.parse({
  itemId: '00000000-0000-4000-8000-0000000000b1',
  harnessId: '00000000-0000-4000-8000-0000000000a1',
  stageKey: 'check',
  title: 'Wait for a review',
  pageId: null,
  priority: 0,
  due: null,
  holder: null,
  claimantKind: null,
  delegationId: null,
  leaseExpiresAt: null,
  gateStatus: 'working',
  gateTarget: null,
  branchState: 'none',
  expectedHead: null,
  riskTier: null,
  riskDomains: [],
  pullRequest: null,
  issue: null,
  zulipTopic: null,
});

function waited(ms: number) {
  return [{ item, enteredAt: new Date(at.getTime() - ms) }];
}

describe('OB-1 the silence alarm level', () => {
  it('OB-1 is ok with nothing waiting, amber at 45 minutes and red at 90 with no review step', () => {
    expect(silenceLevel([], null, at)).toBe('ok');
    expect(silenceLevel(waited(SILENCE_AMBER_MS - minute), null, at)).toBe('ok');
    expect(silenceLevel(waited(SILENCE_AMBER_MS), null, at)).toBe('amber');
    expect(silenceLevel(waited(SILENCE_RED_MS), null, at)).toBe('red');
  });

  it('OB-1 a review step in the window keeps it from going red, or from amber when recent', () => {
    const tenAgo = new Date(at.getTime() - 10 * minute);
    const sixtyAgo = new Date(at.getTime() - 60 * minute);
    expect(silenceLevel(waited(SILENCE_RED_MS + minute), tenAgo, at)).toBe('ok');
    expect(silenceLevel(waited(SILENCE_RED_MS + minute), sixtyAgo, at)).toBe('amber');
  });
});
```

`sim/kernel/silence.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simAdvance, simCaller, simSystem } from '../fixtures.ts';
import { reviewWorld, type ReviewWorld } from '../review-runs.ts';
import { beatOf, stepOn, value } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const minute = 60_000;

async function waitingBeside(scene: ReviewWorld): Promise<string> {
  const { world, harnessId, admin } = scene;
  const caller = simCaller(world, admin);
  const { itemId } = value(
    await world.kernel.items.enqueue(caller, {
      harnessId,
      title: 'Wait beside the reviewed one',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
  );
  await simAdvance(world, { harnessId, itemId, worker: admin, through: ['package', 'scope', 'plan', 'build'] });
  return itemId;
}

async function levelOf(scene: ReviewWorld): Promise<string> {
  const silences = await scene.world.kernel.views.silence();
  return silences.find((silence) => silence.harness.id === scene.harnessId)?.level ?? 'missing';
}

async function withScene(
  setup: { readonly capability?: 'review' | 'build' },
  work: (scene: ReviewWorld, waiting: string) => Promise<void>,
): Promise<void> {
  const world = await createWorld();
  try {
    const scene = await reviewWorld(world, setup);
    await work(scene, await waitingBeside(scene));
  } finally {
    await world.close();
  }
}

describe('OB-1 only review steps quiet the alarm', () => {
  it('OB-1 a Reviewer stepping every ten minutes keeps a waiting item from going red, and silence turns it red', () =>
    withScene({}, async (scene) => {
      const beat = await beatOf(scene);
      for (let tick = 0; tick < 9; tick += 1) {
        scene.world.adapters.clock.advance(10 * minute);
        value(await stepOn(scene, beat, { runId: scene.runId, step: 'read' }));
      }
      scene.world.adapters.clock.advance(minute);
      expect(await levelOf(scene)).toBe('ok');
      scene.world.adapters.clock.advance(91 * minute);
      expect(await levelOf(scene)).toBe('red');
    }));

  it('OB-1 a build run stepping does not count as a review step', () =>
    withScene({ capability: 'build' }, async (scene) => {
      const beat = await beatOf(scene);
      for (let tick = 0; tick < 9; tick += 1) {
        scene.world.adapters.clock.advance(10 * minute);
        value(await stepOn(scene, beat, { runId: scene.runId, step: 'read' }));
      }
      scene.world.adapters.clock.advance(minute);
      expect(await levelOf(scene)).toBe('red');
    }));

  it('OB-1 an item reviewed since it entered Check is not waiting', () =>
    withScene({}, async (scene, waiting) => {
      const silences = await scene.world.kernel.views.silence();
      const mine = silences.find((silence) => silence.harness.id === scene.harnessId);
      expect(mine?.waiting.map((entry) => entry.item.itemId)).toEqual([waiting]);
      const system = simCaller(scene.world, simSystem());
      expect(value(await scene.world.kernel.alarms.soundSilence(system, { limit: 10 })).sounded).toEqual([]);
    }));
});
```

(The reviewed item in `reviewWorld` is claimed by the Reviewer, so it is not waiting; the third test pins that only the item beside it is. The Reviewer's lease is 15 minutes and each step renews it, which is why the loop steps every 10.)

`sim/scenarios/OB-1.a-silent-check-goes-red-and-wakes-the-admins-once-per-cooldown.ts`:

```ts
import assert from 'node:assert/strict';
import { healthLink } from '@uw/contracts';
import { software } from '@uw/harness';
import { createSimHarness, simAdvance, simCaller, simSystem } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { personOf, recipientIds } from '../wakes.ts';

const minute = 60_000;

export const scenario = defineScenario({
  id: 'OB-1',
  title:
    'an item waiting in Check with no review step turns the harness amber at 45 minutes and red at 90; the red alarm wakes the area admins once per cooldown with a link to its drill-through',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    world.adapters.notifier.subscribe(personOf(admin));
    const caller = simCaller(world, admin);
    const { itemId } = value(
      await world.kernel.items.enqueue(caller, {
        harnessId: harness.id,
        title: 'Wait for a review',
        pageId: null,
        priority: 1,
        due: null,
        delegationId: null,
      }),
    );
    await simAdvance(world, { harnessId: harness.id, itemId, worker: admin, through: ['package', 'scope', 'plan', 'build'] });
    const system = simCaller(world, simSystem());
    const levels: string[] = [];
    const sounded: number[] = [];
    for (const minutes of [46, 45, 1, 10]) {
      world.adapters.clock.advance(minutes * minute);
      const silences = await world.kernel.views.silence();
      levels.push(silences.find((silence) => silence.harness.id === harness.id)?.level ?? 'missing');
      sounded.push(value(await world.kernel.alarms.soundSilence(system, { limit: 10 })).sounded.length);
    }
    assert.deepEqual(levels, ['amber', 'red', 'red', 'red']);
    assert.deepEqual(sounded, [0, 1, 0, 1]);
    const wakes = world.adapters.notifier
      .delivered()
      .filter((wake) => wake.reason === 'silence_alarm')
      .map((wake) => ({ to: recipientIds(wake), link: wake.link, itemId: wake.itemId }));
    const wake = { to: [personOf(admin)], link: healthLink('silence_alarm'), itemId: null };
    assert.deepEqual(wakes, [wake, wake]);
    return { state: { levels, sounded, wakes } };
  },
});
```

`apps/uw-app/cron/silence.pg.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createClient } from '@uw/db/client';
import { createMigratedDatabase } from '@uw/db/test-database';
import type { Bindings } from '../env.ts';
import { softwareHarness } from '../testing/commands.ts';
import { testServer } from '../testing/postgres.ts';
import type { CronDeps } from './job.ts';
import { minuteJob } from './minute.ts';

type Line = Record<string, unknown>;

describe.skipIf(!testServer)('OB-1 the minute cron sounds the silence alarm', () => {
  it('runs the silence step as the system and logs what it sounded', async () => {
    const database = await createMigratedDatabase(testServer ?? '');
    const db = createClient(database.connectionString);
    try {
      await softwareHarness(db);
      const lines: Line[] = [];
      const env: Bindings = { HYPERDRIVE: { connectionString: database.connectionString } };
      const deps: CronDeps = {
        now: () => new Date(),
        fetch: () => Promise.reject(new Error('no request')),
        sink: (line) => lines.push(JSON.parse(line) as Line),
        newId: () => randomUUID(),
        commit: 'c',
        engines: {
          AI_GATEWAY_ACCOUNT_ID: 'account',
          AI_GATEWAY_ID: 'gateway',
          AI_GATEWAY_ANALYTICS_TOKEN: 'analytics',
          AI_SPEND_CAP_MINOR: undefined,
          fetch: () => Promise.reject(new Error('no spend read in this test')),
        },
      };
      await minuteJob(env, deps);
      const silence = lines.find((line) => line['step'] === 'silence');
      expect(silence).toMatchObject({ outcome: 'silence_checked', sounded: 0 });
    } finally {
      await db.$client.end();
      await database.drop();
    }
  });
});
```

(The engine fields are the ones `minute.pg.test.ts`'s `engines(spend, cap)` builds; the refused spend read makes the breaker step log `breaker_unreadable`, and `guarded` keeps the later steps running, as HE-5's test pins.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/harness/alarms sim/kernel/silence.test.ts` and `pnpm sim -- OB-1`
Expected: FAIL; `silence.ts`, `views.silence` and `kernel.alarms` do not exist.

- [ ] **Step 3: The reader**

`packages/harness/alarms/silence.ts`:

```ts
import type { Harness, HarnessEvent, ItemState } from '@uw/contracts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { uncountedItems } from '../views/bots.ts';
import { PLANE_LIMIT, VIEW_LIMIT } from '../views/types.ts';

export const SILENCE_RED_MS = 90 * 60_000;
export const SILENCE_AMBER_MS = 45 * 60_000;
const CHECK = 'check';
const reviewResults: ReadonlySet<unknown> = new Set(['review_posted', 'review_withheld']);

export type SilenceLevel = 'ok' | 'amber' | 'red';
export type WaitingInCheck = { readonly item: ItemState; readonly enteredAt: Date };
export type Silence = {
  readonly harness: Harness;
  readonly level: SilenceLevel;
  readonly waiting: readonly WaitingInCheck[];
  readonly uncounted: number;
  readonly lastReviewStepAt: Date | null;
};
export type SilencePorts = Pick<Ports, 'githubFacts'>;

export function silenceLevel(
  waiting: readonly WaitingInCheck[],
  lastStep: Date | null,
  at: Date,
): SilenceLevel {
  if (waiting.length === 0) return 'ok';
  const waited = at.getTime() - Math.min(...waiting.map((entry) => entry.enteredAt.getTime()));
  const quiet = lastStep === null ? Number.POSITIVE_INFINITY : at.getTime() - lastStep.getTime();
  if (waited >= SILENCE_RED_MS && quiet >= SILENCE_RED_MS) return 'red';
  if (waited >= SILENCE_AMBER_MS && quiet >= SILENCE_AMBER_MS) return 'amber';
  return 'ok';
}

function reviewedSince(events: readonly HarnessEvent[], entry: WaitingInCheck): boolean {
  return events.some(
    (event) =>
      event.itemId === entry.item.itemId &&
      reviewResults.has(event.evidence['result']) &&
      new Date(event.at).getTime() >= entry.enteredAt.getTime(),
  );
}

async function unreviewed(
  tx: StoreTransaction,
  harness: Harness,
  entries: readonly WaitingInCheck[],
): Promise<readonly WaitingInCheck[]> {
  if (entries.length === 0) return [];
  const since = new Date(Math.min(...entries.map((entry) => entry.enteredAt.getTime())));
  const completed = await tx.harnessEvents.read.recent({
    since,
    names: ['run_completed'],
    agentsOnly: false,
    limit: PLANE_LIMIT,
    harnessIds: [harness.id],
  });
  return entries.filter((entry) => !reviewedSince(completed, entry));
}

async function waitingIn(
  tx: StoreTransaction,
  harness: Harness,
  items: readonly ItemState[],
): Promise<readonly WaitingInCheck[]> {
  const candidates = items.filter(
    (item) => item.stageKey === CHECK && item.holder === null && item.gateStatus !== 'done',
  );
  if (candidates.length === 0) return [];
  const entries = await tx.harnessEvents.read.enteredStage(
    harness.id,
    candidates.map((item) => item.itemId),
  );
  const entered = new Map(entries.map((entry) => [entry.itemId, entry.at]));
  const known = candidates.flatMap((item) => {
    const enteredAt = entered.get(item.itemId);
    return enteredAt === undefined ? [] : [{ item, enteredAt }];
  });
  return unreviewed(tx, harness, known);
}

async function reviewRuns(
  tx: StoreTransaction,
  steps: readonly HarnessEvent[],
): Promise<ReadonlySet<string>> {
  const runIds = new Set(
    steps.map((event) => event.evidence['runId']).filter((id): id is string => typeof id === 'string'),
  );
  const reviewing = new Set<string>();
  for (const runId of runIds) {
    const run = await tx.harnessRuns.read.byId(runId);
    const delegationId = run?.delegationId ?? null;
    const delegation = delegationId === null ? null : await tx.delegations.read.byId(delegationId);
    if (delegation?.capability === 'review') reviewing.add(runId);
  }
  return reviewing;
}

async function lastReviewStepAt(
  tx: StoreTransaction,
  harness: Harness,
  at: Date,
): Promise<Date | null> {
  const steps = await tx.harnessEvents.read.recent({
    since: new Date(at.getTime() - SILENCE_RED_MS),
    names: ['run_step_recorded'],
    agentsOnly: false,
    limit: PLANE_LIMIT,
    harnessIds: [harness.id],
  });
  const reviewing = await reviewRuns(tx, steps);
  const latest = steps.find((event) => reviewing.has(String(event.evidence['runId'])));
  return latest === undefined ? null : new Date(latest.at);
}

function quietOf(harness: Harness): Silence {
  return { harness, level: 'ok', waiting: [], uncounted: 0, lastReviewStepAt: null };
}

export async function silenceOf(
  ports: SilencePorts,
  tx: StoreTransaction,
  harness: Harness,
  at: Date,
): Promise<Silence> {
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const check = stages.find((stage) => stage.key === CHECK);
  if (harness.paused || check === undefined || check.paused) return quietOf(harness);
  const open = await tx.harnessItems.read.openFor(harness.id, VIEW_LIMIT);
  const left = await uncountedItems(ports.githubFacts, [{ harness, items: open }]);
  const waiting = await waitingIn(tx, harness, open.filter((item) => !left.has(item.itemId)));
  const lastStep = waiting.length === 0 ? null : await lastReviewStepAt(tx, harness, at);
  const uncounted = open.filter((item) => item.stageKey === CHECK && left.has(item.itemId)).length;
  return { harness, level: silenceLevel(waiting, lastStep, at), waiting, uncounted, lastReviewStepAt: lastStep };
}

export async function silences(
  ports: SilencePorts,
  tx: StoreTransaction,
  at: Date,
): Promise<readonly Silence[]> {
  const found: Silence[] = [];
  for (const harness of await tx.harnesses.read.list()) found.push(await silenceOf(ports, tx, harness, at));
  return found;
}
```

(`recent` answers newest first, so `find` returns the latest review step.)

- [ ] **Step 4: The command**

`packages/harness/alarms/commands.ts`:

```ts
import type { Harness } from '@uw/contracts';
import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { COOLDOWN_MS } from '../notify/rank.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { silenceOf } from './silence.ts';

type AlarmPorts = Pick<Ports, 'clock' | 'githubFacts' | 'ids' | 'store'>;

export type SoundInput = { readonly limit: number };
export type Sounded = { readonly sounded: readonly string[] };
export type AlarmCommands = {
  soundSilence(caller: Caller, input: SoundInput): Promise<KernelOutcome<Sounded>>;
};

const SOUND_LIMIT = 200;

function soundOne(ports: AlarmPorts, caller: Caller, harness: Harness, at: Date): Promise<boolean> {
  return ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.harnessEvents(harness.id));
    const silence = await silenceOf(ports, tx, harness, at);
    const [oldest] = [...silence.waiting].sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime());
    if (silence.level !== 'red' || oldest === undefined) return false;
    const recent = await tx.harnessEvents.read.recent({
      since: new Date(at.getTime() - COOLDOWN_MS),
      names: ['silence_alarm'],
      agentsOnly: false,
      limit: 1,
      harnessIds: [harness.id],
    });
    if (recent.length > 0) return false;
    await recordHarnessEvents(tx, recordContext(ports, caller, at), harness.id, [
      draft('silence_alarm', {
        level: 'red',
        waiting: silence.waiting.length,
        oldestEnteredAt: oldest.enteredAt.toISOString(),
        lastReviewStepAt: silence.lastReviewStepAt?.toISOString() ?? null,
      }),
    ]);
    return true;
  });
}

async function soundSilence(
  ports: AlarmPorts,
  caller: Caller,
  input: SoundInput,
): Promise<KernelOutcome<Sounded>> {
  if (!isSystemPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > SOUND_LIMIT) {
    return refused('malformed_command', { why: 'limit' });
  }
  const at = ports.clock.now();
  const harnesses = await ports.store.transaction((tx) => tx.harnesses.read.list());
  const sounded: string[] = [];
  for (const harness of harnesses.slice(0, input.limit)) {
    if (await soundOne(ports, caller, harness, at)) sounded.push(harness.id);
  }
  return accepted({ sounded });
}

export function createAlarmCommands(ports: AlarmPorts): AlarmCommands {
  return { soundSilence: (caller, input) => soundSilence(ports, caller, input) };
}
```

`packages/harness/kernel.ts`: import `createAlarmCommands, type AlarmCommands` from `./alarms/commands.ts`; `Kernel` gains `readonly alarms: AlarmCommands;` and `createKernel` returns `alarms: createAlarmCommands(live),`.

`packages/harness/views/index.ts`: import `silences, type Silence` from `../alarms/silence.ts`; `ViewReads` gains `silence(options?: ReadOptions): Promise<readonly Silence[]>;` and the factory `silence: (options) => store.transaction((tx) => silences(ports, tx, instant(options))),`.

`packages/harness/index.ts`: export `SILENCE_AMBER_MS, SILENCE_RED_MS, silenceLevel` and the types `Silence`, `SilenceLevel`, `WaitingInCheck` from `./alarms/silence.ts`, and the types `AlarmCommands`, `Sounded` from `./alarms/commands.ts`.

- [ ] **Step 5: The wake**

`packages/harness/notify/triggers.ts`: `direct` gains `['silence_alarm', 'silence_alarm'],`.

`packages/harness/notify/recipients.ts`: add

```ts
function silenceAlarm(scope: RecipientScope): Named {
  return areaAdmins(scope.holders, scope.harness, scope.at);
}
```

and `['silence_alarm', silenceAlarm],` in `byReason`.

`packages/harness/notify/plan.ts`: import `healthLink`; at the top of `linkOf`:

```ts
  if (trigger.reason === 'silence_alarm') return healthLink('silence_alarm');
```

`apps/uw-app/islands/worker/sw-core.ts`: `PUSH_TITLES` gains `silence_alarm: 'Items wait in Check and no review has run',`. Regenerate: `pnpm ui:islands`.

- [ ] **Step 6: The minute cron**

`apps/uw-app/cron/minute.ts`: add `const SILENCE_LIMIT = 200;` beside the other limits, and

```ts
async function silence({ kernel, caller, logger }: Minute): Promise<void> {
  const sounded = await kernel.alarms.soundSilence(caller, { limit: SILENCE_LIMIT });
  if (sounded.status !== 'accepted') {
    logger.warn('silence alarm refused', { step: 'silence', outcome: sounded.reason });
    return;
  }
  logger.info('silence checked', {
    step: 'silence',
    outcome: 'silence_checked',
    sounded: sounded.value.sounded.length,
  });
}
```

and in `minuteWith`, after `await guarded(minute, 'beat', beat);` (and after any step a later plan added): `await guarded(minute, 'silence', silence);`.

- [ ] **Step 7: Run them**

Run: `pnpm check && npx vitest run packages/harness sim/kernel apps/uw-app/islands` then `pnpm sim -- OB-1 && pnpm sim -- all`
Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/cron tools/architecture tools/ui/generated-islands.test.ts`
Expected: green, including `only the composition roots construct the system principal` and the owners check (the alarm writes events only through `recordHarnessEvents`).

- [ ] **Step 8: Commit**

```bash
git add packages/harness apps/uw-app sim
git commit -m "feat(harness): the silence alarm goes red when Check waits and no review step runs

silenceOf reads the items waiting in Check (unclaimed, unreviewed since
they entered, not a listed bot's) and the last review step on the harness;
45 minutes is amber, 90 is red. The minute cron sounds the red alarm as
the system, once per notifier cooldown per harness, and the notifier wakes
the area's admins at rank 3 with a link to the drill-through.

OB-1. S19-R4 S19-R5 S19-R11."
```

---

### Task 8: OB-1, OB-2 and OB-4 on `/health`: three indicators and their drill-through

**Files:**
- Create: `packages/harness/views/holds.ts`
- Modify: `packages/harness/views/types.ts` (`PlaneIndicator`), `packages/harness/views/plane-list.ts` (the ports it takes; three readers), `packages/harness/views/index.ts` (`holds`), `packages/harness/index.ts`
- Create: `apps/uw-app/health/ball.ts`, `apps/uw-app/health/ball.test.ts`
- Modify: `apps/uw-app/health/agent-plane.ts` (three indicators), `apps/uw-app/views/screens/health-list.tsx` (`planeIndicators`), `apps/uw-app/views/parts/health-words.ts`
- Modify: `apps/uw-app/views/health.pg.test.ts` (the label list), `apps/uw-app/health/agent-plane.pg.test.ts` (the expected list), `apps/uw-app/mcp/routes.pg.test.ts` (`INDICATORS`)
- Create: `sim/kernel/holds.test.ts`, `sim/scenarios/OB-2.a-health-counts-who-has-held-the-ball-too-long.ts`

**Interfaces:**
- Consumes: Task 5's holder; Task 6's `uncountedItems`; Task 7's `silences`.
- Produces: `HeldRow = { harness: Harness; item: ItemState; holder: Holder }`; `Holds = { person: readonly HeldRow[]; agent: readonly HeldRow[]; uncounted: { person: number; agent: number }; capped: boolean }`; `holdsOf(ports, tx, at)`; `ViewReads.holds(options?): Promise<Holds>`; `PlaneIndicator` gains `'silence_alarm' | 'held_by_person' | 'held_by_agent'`; `silenceIndicator(silences, at)`, `heldIndicator(name, holds)`, `BALL_INDICATORS` in the app.

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/health/ball.test.ts`:

```ts
import { harnessSchema, itemStateSchema } from '@uw/contracts';
import type { Holds, Silence } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { heldIndicator, silenceIndicator } from './ball.ts';

const at = new Date('2026-10-15T12:00:00.000Z');
const minute = 60_000;
const harness = harnessSchema.parse({
  id: '00000000-0000-4000-8000-0000000000a1',
  key: 'tc-admin-app',
  template: 'check-only',
  jdArea: '80-89',
  repository: 'unfoldingWord/tc-admin-app',
  hostedBuilderEnabled: false,
  paused: false,
});
const item = itemStateSchema.parse({
  itemId: '00000000-0000-4000-8000-0000000000b1',
  harnessId: harness.id,
  stageKey: 'check',
  title: 'Wait for a review',
  pageId: null,
  priority: 0,
  due: null,
  holder: null,
  claimantKind: null,
  delegationId: null,
  leaseExpiresAt: null,
  gateStatus: 'working',
  gateTarget: null,
  branchState: 'none',
  expectedHead: null,
  riskTier: null,
  riskDomains: [],
  pullRequest: null,
  issue: null,
  zulipTopic: null,
});
const quiet: Silence = { harness, level: 'ok', waiting: [], uncounted: 0, lastReviewStepAt: null };

describe('OB-1 the silence alarm indicator', () => {
  it('OB-1 says nothing waits when every harness is ok', () => {
    expect(silenceIndicator([quiet], at)).toEqual({
      name: 'silence_alarm',
      status: 'ok',
      detail: 'No item has waited in Check over 45 minutes without a review step',
    });
  });

  it('OB-1 goes red with the longest wait and how long the harness has been quiet', () => {
    const red: Silence = {
      ...quiet,
      level: 'red',
      waiting: [{ item, enteredAt: new Date(at.getTime() - 95 * minute) }],
    };
    expect(silenceIndicator([quiet, red], at)).toEqual({
      name: 'silence_alarm',
      status: 'red',
      detail: '1 waiting in Check, the longest 1 h 35 min on tc-admin-app, with no review step for over 90 minutes',
    });
  });

  it('OB-4 says how many bot pull requests it left out', () => {
    expect(silenceIndicator([{ ...quiet, uncounted: 2 }], at).detail).toBe(
      'No item has waited in Check over 45 minutes without a review step; not counting 2 by bot accounts',
    );
  });
});

describe('OB-2 the two holder indicators', () => {
  const none: Holds = { person: [], agent: [], uncounted: { person: 0, agent: 0 }, capped: false };
  const holder = { role: 'claimant' as const, kind: 'person' as const, identity: 'human:ian', since: at };

  it('OB-2 counts items with a person over 24 hours and with an agent over 2 hours', () => {
    expect(heldIndicator('held_by_person', none)).toEqual({
      name: 'held_by_person',
      status: 'ok',
      detail: 'None over 24 hours',
    });
    const held = { ...none, person: [{ harness, item, holder }] };
    expect(heldIndicator('held_by_person', held)).toEqual({
      name: 'held_by_person',
      status: 'amber',
      detail: '1 item with a person over 24 hours',
    });
    expect(heldIndicator('held_by_agent', none).detail).toBe('None over 2 hours');
  });

  it('OB-4 says how many bot pull requests each count left out', () => {
    const left = { ...none, uncounted: { person: 0, agent: 3 } };
    expect(heldIndicator('held_by_agent', left).detail).toBe('None over 2 hours; not counting 3 by bot accounts');
    expect(heldIndicator('held_by_person', left).detail).toBe('None over 24 hours');
  });
});
```

`sim/kernel/holds.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller } from '../fixtures.ts';
import { reviewWorld } from '../review-runs.ts';
import { shipPullRequest } from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const hour = 3_600_000;

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

describe('OB-2 /health counts who has held the ball too long', () => {
  it('OB-2 the Reviewer holding an item over 2 hours is counted with an agent and listed in the drill-through', () =>
    inWorld(async (world) => {
      const scene = await reviewWorld(world);
      world.adapters.clock.advance(2 * hour + 1);
      const holds = await world.kernel.views.holds();
      expect(holds.agent.map((row) => [row.item.itemId, row.holder.role])).toEqual([[scene.itemId, 'reviewer']]);
      expect(holds.person).toEqual([]);
      const rows = await world.kernel.views.planeList(simCaller(world, scene.admin), 'held_by_agent');
      expect(rows.map((row) => row.cells['role'])).toEqual(['reviewer']);
    }));

  it('OB-4 the same hold on a listed bot pull request is left out of the count and the rows', () =>
    inWorld(async (world) => {
      const scene = await reviewWorld(world);
      world.adapters.githubFacts.givenAuthor(shipPullRequest, 'dependabot[bot]');
      world.adapters.clock.advance(2 * hour + 1);
      const holds = await world.kernel.views.holds();
      expect(holds.agent).toEqual([]);
      expect(holds.uncounted).toEqual({ person: 0, agent: 1 });
      expect(await world.kernel.views.planeList(simCaller(world, scene.admin), 'held_by_agent')).toEqual([]);
    }));

  it('OB-1 the silence drill-through does not list an item the Reviewer has claimed', () =>
    inWorld(async (world) => {
      const scene = await reviewWorld(world);
      const rows = await world.kernel.views.planeList(simCaller(world, scene.admin), 'silence_alarm');
      expect(rows.map((row) => row.cells['harness'])).toEqual([]);
    }));
});
```

(The third test pins that the Reviewer's own claimed item is not listed as waiting; Task 7's scenario and kernel tests cover a waiting one, whose row this drill-through reads from the same `silences`.)

`sim/scenarios/OB-2.a-health-counts-who-has-held-the-ball-too-long.ts`:

```ts
import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

const hour = 3_600_000;

export const scenario = defineScenario({
  id: 'OB-2',
  title:
    'a person who has held an item for over 24 hours is counted on /health with the drill-through row, and the Board card says who and for how long',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const caller = simCaller(world, admin);
    const { itemId } = value(
      await world.kernel.items.enqueue(caller, {
        harnessId: harness.id,
        title: 'Hold the package',
        pageId: null,
        priority: 1,
        due: null,
        delegationId: null,
      }),
    );
    value(await world.kernel.items.claim(caller, { itemId, delegationId: null }));
    world.adapters.clock.advance(23 * hour);
    const early = (await world.kernel.views.holds()).person.length;
    world.adapters.clock.advance(2 * hour);
    const holds = await world.kernel.views.holds();
    const rows = await world.kernel.views.planeList(caller, 'held_by_person');
    const board = value(await world.kernel.views.board(caller, { harnessId: harness.id, stageKey: null, after: null }));
    const card = board.columns.flatMap((column) => column.cards).find((entry) => entry.item.itemId === itemId);
    assert.equal(early, 0);
    assert.deepEqual(holds.person.map((row) => row.item.itemId), [itemId]);
    assert.deepEqual(rows.map((row) => [row.cells['item'], row.cells['held']]), [['Hold the package', '1 d 1 h']]);
    assert.equal(card?.holder?.identity, admin.identity);
    return { state: { held: holds.person.length, rows: rows.length } };
  },
});
```

In `apps/uw-app/views/health.pg.test.ts`, the expected label list gains, at its end (after `'Reviewer refute rate'` and any label a later step appended): `'Silence alarm'`, `'With a person over 24 hours'`, `'With an agent over 2 hours'`. In `apps/uw-app/health/agent-plane.pg.test.ts`, `statusesFollowTotals`'s expected tuple list gains at its end:

```ts
    ['silence_alarm', 'ok', 'No item has waited in Check over 45 minutes without a review step'],
    ['held_by_person', 'ok', 'None over 24 hours'],
    ['held_by_agent', 'ok', 'None over 2 hours'],
```

In `apps/uw-app/mcp/routes.pg.test.ts`, `INDICATORS` gains the same three names at its end.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run apps/uw-app/health/ball.test.ts sim/kernel/holds.test.ts` and `pnpm sim -- OB-2`
Expected: FAIL; `ball.ts`, `views.holds` and the three plane indicators do not exist.

- [ ] **Step 3: The holds read**

`packages/harness/views/holds.ts`:

```ts
import type { Harness, ItemState } from '@uw/contracts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { uncountedItems } from './bots.ts';
import { heldTooLong, holderOf, reviewingIds, type Holder } from './holder.ts';
import { VIEW_LIMIT } from './types.ts';

export type HeldRow = { readonly harness: Harness; readonly item: ItemState; readonly holder: Holder };
export type Holds = {
  readonly person: readonly HeldRow[];
  readonly agent: readonly HeldRow[];
  readonly uncounted: { readonly person: number; readonly agent: number };
  readonly capped: boolean;
};
type HoldPorts = Pick<Ports, 'githubFacts'>;
type Tally = { person: HeldRow[]; agent: HeldRow[]; uncounted: { person: number; agent: number } };

async function heldIn(ports: HoldPorts, tx: StoreTransaction, harness: Harness, at: Date): Promise<Holds> {
  const stages = new Map((await tx.harnessStages.read.forHarness(harness.id)).map((stage) => [stage.key, stage]));
  const open = await tx.harnessItems.read.openFor(harness.id, VIEW_LIMIT);
  const reviewing = await reviewingIds(tx, open);
  const left = await uncountedItems(ports.githubFacts, [{ harness, items: open }]);
  const tally: Tally = { person: [], agent: [], uncounted: { person: 0, agent: 0 } };
  for (const item of open) {
    const holder = holderOf(item, stages.get(item.stageKey), reviewing.has(item.itemId));
    const over = heldTooLong(holder, at);
    if (holder === null || over === null) continue;
    if (left.has(item.itemId)) tally.uncounted[over] += 1;
    else tally[over].push({ harness, item, holder });
  }
  return { ...tally, capped: open.length === VIEW_LIMIT };
}

export async function holdsOf(ports: HoldPorts, tx: StoreTransaction, at: Date): Promise<Holds> {
  const total: Tally = { person: [], agent: [], uncounted: { person: 0, agent: 0 } };
  let capped = false;
  for (const harness of await tx.harnesses.read.list()) {
    const held = await heldIn(ports, tx, harness, at);
    total.person.push(...held.person);
    total.agent.push(...held.agent);
    total.uncounted.person += held.uncounted.person;
    total.uncounted.agent += held.uncounted.agent;
    capped = capped || held.capped;
  }
  return { ...total, capped };
}
```

`packages/harness/views/index.ts`: import `holdsOf, type Holds` from `./holds.ts`; `ViewReads` gains `holds(options?: ReadOptions): Promise<Holds>;` and the factory `holds: (options) => store.transaction((tx) => holdsOf(ports, tx, instant(options))),`.

`packages/harness/index.ts`: export the types `HeldRow`, `Holds` from `./views/holds.ts`.

- [ ] **Step 4: The drill-through rows**

`packages/harness/views/types.ts`: `PlaneIndicator` gains `| 'silence_alarm' | 'held_by_person' | 'held_by_agent'`.

`packages/harness/views/plane-list.ts`: `ListScope.ports` becomes `Pick<Ports, 'grants' | 'githubFacts'>` (import `Ports`; `readableHarness` still takes it, since it needs only `grants`); import `formatDuration` beside `formatInstant` from `@uw/core/dates`, `holdsOf` from `./holds.ts` and `silences` from `../alarms/silence.ts`; add

```ts
function heldFor(at: Date, since: Date | null): string | null {
  return since === null ? null : formatDuration(at.getTime() - since.getTime());
}

async function heldRows(scope: ListScope, kind: 'person' | 'agent'): Promise<readonly PlaneRow[]> {
  const holds = await holdsOf(scope.ports, scope.tx, scope.at);
  return holds[kind].map(({ harness, item, holder }) => ({
    harnessId: harness.id,
    cells: {
      item: item.title,
      harness: harness.key,
      holder: holder.identity ?? 'A person who may decide',
      role: holder.role,
      since: holder.since === null ? null : formatInstant(holder.since),
      held: heldFor(scope.at, holder.since),
    },
  }));
}

async function silenceRows(scope: ListScope): Promise<readonly PlaneRow[]> {
  const found = await silences(scope.ports, scope.tx, scope.at);
  return found.flatMap((silence) =>
    silence.waiting.map(({ item, enteredAt }) => ({
      harnessId: silence.harness.id,
      cells: {
        item: item.title,
        harness: silence.harness.key,
        level: silence.level,
        entered: formatInstant(enteredAt),
        waited: heldFor(scope.at, enteredAt),
        'last review step':
          silence.lastReviewStepAt === null ? null : formatInstant(silence.lastReviewStepAt),
      },
    })),
  );
}
```

and in `readers`:

```ts
  ['silence_alarm', silenceRows],
  ['held_by_person', (scope) => heldRows(scope, 'person')],
  ['held_by_agent', (scope) => heldRows(scope, 'agent')],
```

- [ ] **Step 5: The indicators**

`apps/uw-app/health/ball.ts`:

```ts
import type { HealthIndicator, IndicatorStatus } from '@uw/contracts';
import { formatDuration } from '@uw/core/dates';
import { formatCount } from '@uw/core/money';
import type { Holds, Silence, SilenceLevel } from '@uw/harness';

export const BALL_INDICATORS = ['silence_alarm', 'held_by_person', 'held_by_agent'] as const;
type HeldName = 'held_by_person' | 'held_by_agent';

const DETAIL_LIMIT = 200;
const ranks: Readonly<Record<SilenceLevel, number>> = { ok: 0, amber: 1, red: 2 };
const holdWords = {
  held_by_person: { kind: 'person', noun: 'with a person', limit: '24 hours' },
  held_by_agent: { kind: 'agent', noun: 'with an agent', limit: '2 hours' },
} as const satisfies Record<HeldName, { kind: 'person' | 'agent'; noun: string; limit: string }>;

function botWords(uncounted: number): string {
  return uncounted === 0 ? '' : `; not counting ${formatCount(uncounted)} by bot accounts`;
}

function loudest(found: readonly Silence[]): Silence | null {
  let worst: Silence | null = null;
  for (const silence of found) {
    if (worst === null || ranks[silence.level] > ranks[worst.level]) worst = silence;
  }
  return worst;
}

function quietFor(worst: Silence, at: Date): string {
  const last = worst.lastReviewStepAt;
  return last === null ? 'over 90 minutes' : formatDuration(at.getTime() - last.getTime());
}

export function silenceIndicator(found: readonly Silence[], at: Date): HealthIndicator {
  const bots = botWords(found.reduce((sum, silence) => sum + silence.uncounted, 0));
  const worst = loudest(found);
  if (worst === null || worst.level === 'ok') {
    const detail = `No item has waited in Check over 45 minutes without a review step${bots}`;
    return { name: 'silence_alarm', status: 'ok', detail: detail.slice(0, DETAIL_LIMIT) };
  }
  const oldest = Math.min(...worst.waiting.map((entry) => entry.enteredAt.getTime()));
  const waiting = found.reduce((sum, silence) => sum + silence.waiting.length, 0);
  const longest = formatDuration(at.getTime() - oldest);
  const detail = `${formatCount(waiting)} waiting in Check, the longest ${longest} on ${worst.harness.key}, with no review step for ${quietFor(worst, at)}${bots}`;
  return { name: 'silence_alarm', status: worst.level, detail: detail.slice(0, DETAIL_LIMIT) };
}

export function heldIndicator(name: HeldName, holds: Holds): HealthIndicator {
  const { kind, noun, limit } = holdWords[name];
  const rows = holds[kind];
  const count = holds.capped ? `At least ${formatCount(rows.length)}` : formatCount(rows.length);
  const head =
    rows.length === 0
      ? `None over ${limit}`
      : `${count} ${rows.length === 1 ? 'item' : 'items'} ${noun} over ${limit}`;
  const status: IndicatorStatus = rows.length === 0 && !holds.capped ? 'ok' : 'amber';
  return { name, status, detail: `${head}${botWords(holds.uncounted[kind])}`.slice(0, DETAIL_LIMIT) };
}
```

`apps/uw-app/health/agent-plane.ts`: import `BALL_INDICATORS, heldIndicator, silenceIndicator` from `./ball.ts`; spread `...BALL_INDICATORS` at the end of `AGENT_PLANE_INDICATORS` (after `'reviewer_refutes'` and anything a later step added); in `agentPlaneIndicators`, read

```ts
  const found = await kernel.views.silence({ at });
  const holds = await kernel.views.holds({ at });
```

and append `silenceIndicator(found, at), heldIndicator('held_by_person', holds), heldIndicator('held_by_agent', holds),` to the returned list.

`apps/uw-app/views/screens/health-list.tsx`: `planeIndicators` gains `'silence_alarm'`, `'held_by_person'`, `'held_by_agent'`. `apps/uw-app/views/parts/health-words.ts`: `indicatorWords` gains

```ts
  ['silence_alarm', 'Silence alarm'],
  ['held_by_person', 'With a person over 24 hours'],
  ['held_by_agent', 'With an agent over 2 hours'],
```

- [ ] **Step 6: Run them**

Run: `pnpm check && npx vitest run apps/uw-app/health/ball.test.ts packages/harness/views sim/kernel` then `pnpm sim -- OB-2 && pnpm sim -- all`
Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/health apps/uw-app/views apps/uw-app/mcp/routes.pg.test.ts tools/architecture tools/ui`
Expected: green.

- [ ] **Step 7: Check `/health` and the three drill-throughs in light, dark and phone width**

As Task 5 Step 7: `/health` with the three new Kpis, and `/health/silence_alarm`, `/health/held_by_person`, `/health/held_by_agent` with a row each. The drill-through table must scroll inside its own container at 360 px, not the page.

- [ ] **Step 8: Commit**

```bash
git add packages/harness apps/uw-app sim
git commit -m "feat(health): the silence alarm and who has held the ball too long, with their drill-through

/health gains silence_alarm (amber at 45 minutes, red at 90), held_by_person
(over 24 hours) and held_by_agent (over 2 hours). Each detail says how many
bot pull requests it left out; each drills through to the rows its count
is made of.

OB-1 OB-2 OB-4. S19-R3 S19-R7."
```

---

### Task 9: PI-2, an external runner's learning lands suggested with its source and pull request

**Files:**
- Create: `apps/uw-app/pages/provenance.ts`, `apps/uw-app/pages/provenance.test.ts`
- Modify: `apps/uw-app/pages/derive.ts` (`Landing`, the learning branch, `DerivedFrontmatter`), `apps/uw-app/pages/store.ts` (`createPageAs`; `derivedSave`'s landing), `apps/uw-app/pages/agent-write.ts` (`AgentRequest.writer`)
- Create: `apps/uw-app/mcp/verbs/external-writer.ts`
- Modify: `apps/uw-app/mcp/verbs/write-page.ts`
- Create: `apps/uw-app/mcp/external-learning.pg.test.ts`

**Interfaces:**
- Consumes: Task 2's learning frontmatter `source`, `pull_request` and `learningSourceSchema`.
- Produces: `ExternalWriter = { readonly repository: string | null }`; `Provenance = { readonly source: LearningSource; readonly pullRequest: PullRequestRef | null }`; `provenanceOf(frontmatter): Provenance`; `learningProvenance(input: ProvenanceInput): ProvenanceCheck`; `createPageAs(db, actor, command, request: { traceId: string; at: Date; writer: ExternalWriter | null })`; `externalWriter(context: VerbContext): Promise<ExternalWriter | null>`.

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/pages/provenance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { learningProvenance } from './provenance.ts';

const repo = 'unfoldingWord/tc-admin-app';
const base = {
  confidence: 'observed',
  as_of: '2026-10-15',
  supersedes: [],
  review_by: null,
  contradicts: false,
  source: 'platform',
  pull_request: null,
};
const pull = { repo, number: 7 };
const bench = { repository: repo };

describe('PI-2 where a learning came from', () => {
  it('PI-2 an external runner on a review delegation writes an external learning naming its pull request', () => {
    const parsed = { ...base, pull_request: pull };
    expect(learningProvenance({ parsed, raw: { pull_request: pull }, prior: null, writer: bench })).toEqual({
      ok: true,
      frontmatter: { ...parsed, source: 'external' },
    });
  });

  it('PI-2 refuses an external learning without its pull request or naming another repository', () => {
    expect(learningProvenance({ parsed: base, raw: {}, prior: null, writer: bench })).toEqual({
      ok: false,
      reason: 'malformed_command',
    });
    const elsewhere = { ...base, pull_request: { repo: 'unfoldingWord/uw-platform', number: 7 } };
    expect(learningProvenance({ parsed: elsewhere, raw: {}, prior: null, writer: bench })).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
  });

  it('PI-2 a person or another writer is the platform and cannot claim external', () => {
    expect(learningProvenance({ parsed: base, raw: {}, prior: null, writer: null })).toMatchObject({
      ok: true,
      frontmatter: { source: 'platform' },
    });
    const claimed = { ...base, source: 'external', pull_request: pull };
    expect(learningProvenance({ parsed: claimed, raw: { source: 'external' }, prior: null, writer: null })).toEqual({
      ok: false,
      reason: 'malformed_command',
    });
  });

  it('PI-2 an edit keeps an external learning external and its pull request fixed', () => {
    const prior = { source: 'external' as const, pullRequest: pull };
    const kept = { ...base, pull_request: pull };
    expect(learningProvenance({ parsed: kept, raw: {}, prior, writer: null })).toMatchObject({
      ok: true,
      frontmatter: { source: 'external', pull_request: pull },
    });
    const moved = { ...base, pull_request: { repo, number: 8 } };
    expect(learningProvenance({ parsed: moved, raw: {}, prior, writer: null })).toEqual({
      ok: false,
      reason: 'malformed_command',
    });
  });
});
```

`apps/uw-app/mcp/external-learning.pg.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { sql } from 'drizzle-orm';
import { createPageCommandSchema, type CapabilityWord, type Principal } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { software, type Caller, type Kernel } from '@uw/harness';
import { createApp } from '../app.tsx';
import { createPage } from '../pages/store.ts';
import { systemClock } from '../ports/clock.ts';
import { createAccessFixture, type AccessFixture } from '../testing/access-keys.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps } from '../testing/postgres.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const BENCH_OWNER = {
  id: '00000000-0000-4000-8000-000000002701',
  email: 'bench-owner@unfoldingword.org',
  grant: '00000000-0000-4000-8000-000000002711',
};

type Rig = {
  readonly db: Database;
  readonly fixture: AccessFixture;
  readonly kernel: Kernel;
  readonly ian: Principal;
  readonly drop: () => Promise<void>;
};
type Bench = { readonly harnessId: string; readonly repository: string };

let rigged: Promise<Rig> | null = null;

async function openRig(): Promise<Rig> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  await seedPerson(db, { id: BENCH_OWNER.id, email: BENCH_OWNER.email });
  await seedGrant(db, {
    id: BENCH_OWNER.grant,
    personId: BENCH_OWNER.id,
    role: 'admin',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  const ian = await personOn(db, IAN_ID, 'ian.lindsley@unfoldingword.org', new Date());
  const drop = async () => {
    await db.$client.end();
    await database.drop();
  };
  return { db, fixture: await createAccessFixture(), kernel: kernelOn(db, systemClock), ian, drop };
}

function rig(): Promise<Rig> {
  rigged ??= openRig();
  return rigged;
}

afterAll(async () => {
  if (rigged !== null) await (await rigged).drop();
});

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function value<T>(outcome: { status: 'accepted'; value: T } | { status: 'error'; reason: string }) {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function benchHarness(r: Rig): Promise<Bench> {
  const harnessId = crypto.randomUUID();
  const key = `bench-${harnessId.slice(0, 8)}`;
  const repository = `unfoldingWord/${key}`;
  const activate = { harnessId, harnessKey: key, jdArea: '80-89', template: software, repository };
  value(await r.kernel.stages.activate(caller(r.ian), activate));
  return { harnessId, repository };
}

async function runner(r: Rig, bench: Bench, capability: CapabilityWord, persona: string): Promise<Client> {
  const owner = await personOn(r.db, BENCH_OWNER.id, BENCH_OWNER.email, new Date());
  const grant = { harnessId: bench.harnessId, persona: `agent:${persona}`, expiresAt: null, supersedes: null };
  const delegation = value(await r.kernel.delegations.grant(caller(owner), { ...grant, capability }));
  const token = await r.fixture.signForMcp({ email: BENCH_OWNER.email });
  return httpClient(createApp(postgresDeps(r.db, r.fixture)), {
    'cf-access-jwt-assertion': token,
    'x-uw-device': 'bench',
    'x-uw-persona': persona,
    'x-uw-delegation': delegation.id,
  });
}

function learning(pageId: string, frontmatter: Record<string, unknown>, expectedVersion: number | null = null) {
  return {
    pageId,
    type: 'learning',
    jdArea: '80-89',
    slug: `bench-${pageId.slice(0, 8)}`,
    title: 'Migrations that skip the down step come back',
    parentId: null,
    frontmatter: { confidence: 'observed', as_of: '2026-10-15', supersedes: [], review_by: null, ...frontmatter },
    bodyMd: 'Three reviews this week asked for the down migration.',
    expectedVersion,
  };
}

async function stored(r: Rig, pageId: string) {
  const rows = await r.db.execute<{ status: string; frontmatter: Record<string, unknown> }>(
    sql`SELECT status, frontmatter FROM pages WHERE id = ${pageId}`,
  );
  return rows[0] ?? null;
}

describe.skipIf(!testServer)('PI-2 the bench posts its rulings as suggested learnings', () => {
  it('PI-2 a learning from an external runner on a review delegation lands suggested, external, with its pull request', async () => {
    const r = await rig();
    const bench = await benchHarness(r);
    const client = await runner(r, bench, 'review', 'reviewer');
    const pageId = crypto.randomUUID();
    const pull = { repo: bench.repository, number: 7 };
    const written = await callTool(client, 'write_page', learning(pageId, { pull_request: pull }));
    expect(written.isError).toBe(false);
    expect(await stored(r, pageId)).toMatchObject({
      status: 'suggested',
      frontmatter: { source: 'external', pull_request: pull },
    });
  });

  it('PI-2 refuses an external learning without its pull request or from another repository', async () => {
    const r = await rig();
    const bench = await benchHarness(r);
    const client = await runner(r, bench, 'review', 'reviewer');
    const bare = await callTool(client, 'write_page', learning(crypto.randomUUID(), {}));
    const elsewhere = await callTool(
      client,
      'write_page',
      learning(crypto.randomUUID(), { pull_request: { repo: 'unfoldingWord/uw-platform', number: 7 } }),
    );
    expect([bare.body['reason'], elsewhere.body['reason']]).toEqual(['malformed_command', 'not_permitted']);
  });

  it('PI-2 a runner on another capability writes a platform learning and cannot claim external', async () => {
    const r = await rig();
    const bench = await benchHarness(r);
    const client = await runner(r, bench, 'iterate', 'iterate');
    const plain = crypto.randomUUID();
    expect((await callTool(client, 'write_page', learning(plain, {}))).isError).toBe(false);
    expect((await stored(r, plain))?.frontmatter).toMatchObject({ source: 'platform' });
    const claimed = await callTool(client, 'write_page', learning(crypto.randomUUID(), { source: 'external' }));
    expect(claimed.body['reason']).toBe('malformed_command');
  });

  it('PI-2 an edit keeps the source and the pull request', async () => {
    const r = await rig();
    const bench = await benchHarness(r);
    const client = await runner(r, bench, 'review', 'reviewer');
    const pageId = crypto.randomUUID();
    const pull = { repo: bench.repository, number: 7 };
    await callTool(client, 'write_page', learning(pageId, { pull_request: pull }));
    const moved = await callTool(client, 'write_page', learning(pageId, { pull_request: { ...pull, number: 8 } }, 1));
    expect(moved.body['reason']).toBe('malformed_command');
    const kept = await callTool(client, 'write_page', learning(pageId, { pull_request: pull, confidence: 'confirmed' }, 1));
    expect(kept.isError).toBe(false);
    expect((await stored(r, pageId))?.frontmatter).toMatchObject({ source: 'external', confidence: 'confirmed' });
  });

  it('PI-2 a person cannot mark a learning external through the page API', async () => {
    const r = await rig();
    const { expectedVersion: _unused, ...page } = learning(crypto.randomUUID(), {
      source: 'external',
      pull_request: { repo: 'unfoldingWord/x', number: 1 },
    });
    const command = createPageCommandSchema.parse({
      command: 'create_page',
      requestId: crypto.randomUUID(),
      ...page,
      status: 'suggested',
    });
    const created = await createPage(r.db, r.ian, command, crypto.randomUUID(), new Date());
    expect(created).toMatchObject({ ok: false, reason: 'malformed_command' });
  });
});
```

(`createPageCommandSchema` is strict, so the page drops `expectedVersion` before spreading; if the lint rule on unused variables refuses `_unused`, build the page without it by a small `pageOf(pageId, frontmatter)` that `learning` spreads. If `delegations.grant` refuses `agent:reviewer` because the persona page must agree, seed the persona page the way `apps/uw-app/mcp/delegated.pg.test.ts` does, or use the `iterate` persona name with capability `review` if the grant allows it.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run apps/uw-app/pages/provenance.test.ts` and `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/mcp/external-learning.pg.test.ts`
Expected: FAIL; `provenance.ts` does not exist, and the stored learning reads `source: 'platform'`.

- [ ] **Step 3: The provenance rule**

`apps/uw-app/pages/provenance.ts`:

```ts
import {
  learningSourceSchema,
  pullRequestRefSchema,
  type LearningSource,
  type PullRequestRef,
} from '@uw/contracts';

type Frontmatter = Readonly<Record<string, unknown>>;
type Refusal = 'malformed_command' | 'not_permitted';

export type ExternalWriter = { readonly repository: string | null };
export type Provenance = { readonly source: LearningSource; readonly pullRequest: PullRequestRef | null };
export type ProvenanceInput = {
  readonly parsed: Frontmatter;
  readonly raw: Frontmatter;
  readonly prior: Provenance | null;
  readonly writer: ExternalWriter | null;
};
export type ProvenanceCheck =
  | { readonly ok: true; readonly frontmatter: Frontmatter }
  | { readonly ok: false; readonly reason: Refusal };

export function provenanceOf(frontmatter: Frontmatter): Provenance {
  const source = learningSourceSchema.safeParse(frontmatter['source']);
  const pull = pullRequestRefSchema.safeParse(frontmatter['pull_request']);
  return {
    source: source.success ? source.data : 'platform',
    pullRequest: pull.success ? pull.data : null,
  };
}

function samePullRequest(left: PullRequestRef | null, right: PullRequestRef | null): boolean {
  if (left === null || right === null) return left === right;
  return left.repo.toLowerCase() === right.repo.toLowerCase() && left.number === right.number;
}

function firstRefusal(source: LearningSource, given: Provenance, writer: ExternalWriter | null): Refusal | null {
  if (source !== 'external') return null;
  if (given.pullRequest === null) return 'malformed_command';
  const repository = writer?.repository ?? null;
  const same = repository !== null && repository.toLowerCase() === given.pullRequest.repo.toLowerCase();
  return same ? null : 'not_permitted';
}

function laterRefusal(prior: Provenance, given: Provenance): Refusal | null {
  if (prior.source !== 'external') return null;
  return samePullRequest(prior.pullRequest, given.pullRequest) ? null : 'malformed_command';
}

export function learningProvenance(input: ProvenanceInput): ProvenanceCheck {
  const derived: LearningSource = input.writer === null ? 'platform' : 'external';
  const source = input.prior?.source ?? derived;
  if (Object.hasOwn(input.raw, 'source') && input.raw['source'] !== source) {
    return { ok: false, reason: 'malformed_command' };
  }
  const given = provenanceOf(input.parsed);
  const refusal =
    input.prior === null ? firstRefusal(source, given, input.writer) : laterRefusal(input.prior, given);
  if (refusal !== null) return { ok: false, reason: refusal };
  return { ok: true, frontmatter: { ...input.parsed, source } };
}
```

- [ ] **Step 4: The page API derives it**

`apps/uw-app/pages/derive.ts`: import `learningProvenance, type ExternalWriter, type Provenance` from `./provenance.ts`; change

```ts
export type Landing = {
  readonly status: PageStatus;
  readonly stored: PageStatus | null;
  readonly prior: Provenance | null;
  readonly writer: ExternalWriter | null;
};

export type DerivedFrontmatter =
  | { readonly ok: true; readonly frontmatter: StoredFrontmatter }
  | {
      readonly ok: false;
      readonly reason: 'activation_required' | 'malformed_command' | 'not_permitted';
    };
```

and the learning branch of `derivedFrontmatter`:

```ts
  if (type === 'learning') {
    const provenance = learningProvenance({
      parsed,
      raw: input,
      prior: landing.prior,
      writer: landing.writer,
    });
    if (!provenance.ok) return { ok: false, reason: provenance.reason };
    return derived({ ...provenance.frontmatter, contradicts: await contradicts(tx, parsed) });
  }
```

`apps/uw-app/pages/store.ts`: import `provenanceOf, type ExternalWriter` from `./provenance.ts`. Rename `createPage` to `createPageAs` with the signature `(db: Database, actor: Principal, command: CreatePageCommand, request: CreateRequest)` where `export type CreateRequest = { readonly traceId: string; readonly at: Date; readonly writer: ExternalWriter | null };`, use `request.traceId`, `request.at` inside, and build its landing as `{ status: command.status, stored: null, prior: null, writer: request.writer }`. Add back:

```ts
export function createPage(
  db: Database,
  actor: Principal,
  command: CreatePageCommand,
  traceId: string,
  at: Date,
): Promise<PageResult | PageRefusal> {
  return createPageAs(db, actor, command, { traceId, at, writer: null });
}
```

In `derivedSave`, the landing becomes:

```ts
  const prior = stored.type === 'learning' ? provenanceOf(stored.frontmatter) : null;
  const landing = { status, stored: stored.status, prior, writer: null };
```

`apps/uw-app/pages/agent-write.ts`: `AgentRequest` gains `readonly writer: ExternalWriter | null;`; the create path calls `createPageAs(db, actor, { ...command, ...editable, type, jdArea, status }, { traceId, at, writer: request.writer })`.

- [ ] **Step 5: The verb names the external writer**

`apps/uw-app/mcp/verbs/external-writer.ts`:

```ts
import { delegationIdOf } from '@uw/contracts';
import type { ExternalWriter } from '../../pages/provenance.ts';
import { callerOf, type VerbContext } from '../context.ts';

export async function externalWriter(context: VerbContext): Promise<ExternalWriter | null> {
  if (context.host !== 'external') return null;
  const delegationId = delegationIdOf(context.principal.identity);
  if (delegationId === null) return null;
  const beat = await context.kernel.delegations.beat(callerOf(context), { delegationId });
  if (beat.status !== 'accepted' || beat.value.delegation.capability !== 'review') return null;
  const { harnessId } = beat.value.delegation;
  const scene = await context.kernel.reads.harness(callerOf(context), { harnessId });
  return { repository: scene.status === 'accepted' ? scene.value.harness.repository : null };
}
```

`apps/uw-app/mcp/verbs/write-page.ts`, in `run`:

```ts
    const writer = input.type === 'learning' ? await externalWriter(context) : null;
    const request = { traceId, at, instructions: kernel.reads, writer };
```

Run `pnpm check`; any other caller of `writePageAsAgent` passes `writer: null`.

- [ ] **Step 6: Run them**

Run: `pnpm check && npx vitest run apps/uw-app/pages`
Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/pages apps/uw-app/mcp apps/uw-app/commands/pages.pg.test.ts tools/architecture`
Expected: green. A test comparing a stored learning's whole frontmatter gains `source: 'platform', pull_request: null`.

- [ ] **Step 7: Commit**

```bash
git add apps/uw-app
git commit -m "feat(pages): the bench's rulings land as suggested external learnings

write_page from an external runner on a review delegation stamps a learning
source: external and requires the pull request it came from, in the
delegation's harness repository. Every other writer is the platform and
cannot claim external; an edit keeps the source and the pull request.

PI-2. S19-R9."
```

---

### Task 10: GL-5, a check-only harness takes the software template

**Files:**
- Create: `packages/harness/stages/template-change.ts`
- Modify: `packages/harness/stages/commands.ts` (`StageCommands.changeTemplate`)
- Modify: `apps/uw-app/commands/person/stages.ts` (`changeTemplateCommand`), `apps/uw-app/commands/registry.ts` (replace the not-wired entry)
- Create: `sim/kernel/template-change.test.ts`, `sim/scenarios/GL-5.a-check-only-harness-takes-the-software-template-and-keeps-its-items.ts`
- Create: `apps/uw-app/commands/template-change.pg.test.ts`

**Interfaces:**
- Consumes: Task 2's command, refusal and event; Task 4's `setTemplate`; `editInTransaction` and `EditWork` (`packages/harness/stages/edit.ts`), `bypassRefusal` and `stageFromTemplate` (`rules.ts`), `templates`.
- Produces: `ChangeTemplateInput = { readonly harnessId: string; readonly template: string }`; `StageCommands.changeTemplate(caller: Caller, input: ChangeTemplateInput): Promise<KernelOutcome<HarnessScene>>`.

- [ ] **Step 1: Write the failing tests**

`sim/kernel/template-change.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { checkOnly, readAllEvents, software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAdvance, simCaller, simPerson } from '../fixtures.ts';
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

async function joined(world: World) {
  const scene = await createSimHarness(world, checkOnly, {
    key: 'tc-admin-app',
    repository: 'unfoldingWord/tc-admin-app',
  });
  const caller = simCaller(world, scene.admin);
  const harnessId = scene.harness.id;
  value(await world.kernel.stages.updateStage(caller, { harnessId, stageKey: 'check', change: { exitGate: 'none' } }));
  const enqueue = (title: string) =>
    world.kernel.items.enqueue(caller, { harnessId, title, pageId: null, priority: 1, due: null, delegationId: null });
  const atCheck = value(await enqueue('Stay at Check')).itemId;
  const atShip = value(await enqueue('Move to Ship')).itemId;
  await simAdvance(world, { harnessId, itemId: atShip, worker: scene.admin, through: ['check'] });
  return { ...scene, caller, atCheck, atShip };
}

describe('GL-5 a template change on a live harness', () => {
  it('GL-5 moves a check-only harness to software, keeping Check and Ship and their items, the new stages empty', () =>
    inWorld(async (world) => {
      const scene = await joined(world);
      const before = scene.stages.map((stage) => [stage.key, stage.id]);
      const changed = value(
        await world.kernel.stages.changeTemplate(scene.caller, { harnessId: scene.harness.id, template: 'software' }),
      );
      expect(changed.harness.template).toBe('software');
      expect(changed.stages.map((stage) => stage.key)).toEqual(software.stages.map((stage) => stage.key));
      expect(changed.stages.map((stage) => stage.position)).toEqual(software.stages.map((stage) => stage.position));
      const kept = changed.stages.filter((stage) => stage.key === 'check' || stage.key === 'ship');
      expect(kept.map((stage) => [stage.key, stage.id])).toEqual(before);
      expect(kept.find((stage) => stage.key === 'check')?.exitGate).toBe('none');
      const items = await world.adapters.store.transaction((tx) => tx.harnessItems.read.forHarness(scene.harness.id));
      const stageOf = new Map(items.map((item) => [item.itemId, item.stageKey]));
      expect([stageOf.get(scene.atCheck), stageOf.get(scene.atShip)]).toEqual(['check', 'ship']);
      expect(items.every((item) => item.stageKey === 'check' || item.stageKey === 'ship')).toBe(true);
      const events = await world.adapters.store.transaction((tx) => readAllEvents(tx, scene.harness.id, null));
      expect(events.filter((event) => event.name === 'template_changed')).toHaveLength(1);
    }));

  it('GL-5 refuses any other change, a second change, and a harness whose stages were added to', () =>
    inWorld(async (world) => {
      const scene = await joined(world);
      const harnessId = scene.harness.id;
      expect(reasonOf(await world.kernel.stages.changeTemplate(scene.caller, { harnessId, template: 'bml' }))).toBe(
        'template_change_not_allowed',
      );
      value(await world.kernel.stages.changeTemplate(scene.caller, { harnessId, template: 'software' }));
      expect(reasonOf(await world.kernel.stages.changeTemplate(scene.caller, { harnessId, template: 'software' }))).toBe(
        'template_change_not_allowed',
      );
      const other = await createSimHarness(world, checkOnly, { key: 'edited', repository: 'unfoldingWord/edited' });
      const otherCaller = simCaller(world, other.admin);
      const extra = {
        key: 'triage',
        title: 'Triage',
        position: 5,
        bracket: 'build_package' as const,
        agentPickup: 'allowed' as const,
        exitGate: 'checks' as const,
        connector: 'none' as const,
        wipLimit: 3,
        instructionsPageId: null,
        validators: [],
        feeds: [],
      };
      value(await world.kernel.stages.createStage(otherCaller, { harnessId: other.harness.id, stage: extra }));
      const refused = await world.kernel.stages.changeTemplate(otherCaller, { harnessId: other.harness.id, template: 'software' });
      expect(reasonOf(refused)).toBe('template_change_not_allowed');
    }));

  it('GL-5 refuses a person who is not an admin on the area', () =>
    inWorld(async (world) => {
      const scene = await joined(world);
      const editor = await simPerson(world, 6, [{ role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' }]);
      const refused = await world.kernel.stages.changeTemplate(simCaller(world, editor), {
        harnessId: scene.harness.id,
        template: 'software',
      });
      expect(reasonOf(refused)).toBe('not_permitted');
    }));
});
```

(`readAllEvents` with a `null` item reads every event on the harness; if `@uw/harness` does not export it, import it the way `sim/runs.ts` does. `createStage`'s input is `StageInput`, the stage without `id`, `harnessId` and `paused`; `triage` is a key no software stage has, which is what makes the change refuse `stages_edited`.)

`sim/scenarios/GL-5.a-check-only-harness-takes-the-software-template-and-keeps-its-items.ts`: id `'GL-5'`; the first test's steps with `assert.deepEqual` in place of `expect`; returns `{ state: { template: changed.harness.template, stages: changed.stages.map((stage) => stage.key) } }`.

`apps/uw-app/commands/template-change.pg.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { command } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const IAN = { email: 'ian.lindsley@unfoldingword.org' };

describe.skipIf(!testServer)('GL-5 the change_template command', () => {
  it('GL-5 changes a check-only harness to software and drafts the Builder personas', () =>
    withAppDatabase(async (db) => {
      const harnessId = randomUUID();
      const activation = {
        requestId: randomUUID(),
        harnessKey: 'joined-review',
        jdArea: '50-59',
        template: 'check-only',
        repository: 'unfoldingWord/joined-review',
      };
      expect((await command(db, IAN, harnessId, 'activate_template', activation)).body['status']).toBe('accepted');
      const changed = await command(db, IAN, harnessId, 'change_template', { requestId: randomUUID(), template: 'software' });
      expect(changed.body['status']).toBe('accepted');
      const slugs = await db.execute<{ slug: string }>(
        sql`SELECT slug FROM pages WHERE type = 'persona' AND jd_area = '50-59' ORDER BY slug`,
      );
      expect(slugs.map((row) => row.slug)).toEqual([
        'persona-builder',
        'persona-builder-hosted',
        'persona-reviewer',
        'persona-reviewer-codex',
      ]);
      const refused = await command(db, IAN, harnessId, 'change_template', { requestId: randomUUID(), template: 'bml' });
      expect(refused.body['reason']).toBe('template_change_not_allowed');
    }));
});
```

(If the check-only activation's persona drafts carry other slugs, read them from `templatePersonas['check-only']` and expect those plus the two Builder slugs.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run sim/kernel/template-change.test.ts`
Expected: FAIL; `changeTemplate` is not a function.

- [ ] **Step 3: The kernel**

`packages/harness/stages/template-change.ts`:

```ts
import type { Harness, Stage } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import type { HarnessScene } from '../reads/scene.ts';
import { templates } from '../templates.ts';
import type { Template } from '../templates/types.ts';
import { editInTransaction, type EditWork } from './edit.ts';
import { bypassRefusal, stageFromTemplate } from './rules.ts';

type ChangePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type ChangeTemplateInput = { readonly harnessId: string; readonly template: string };

type Change = { readonly kept: readonly Stage[]; readonly added: readonly Stage[] };
type Applying = {
  readonly harness: Harness;
  readonly target: Template;
  readonly change: Change;
  readonly context: RecordContext;
};

const allowed: ReadonlyMap<string, string> = new Map([['check-only', 'software']]);

function notAllowed(harness: Harness, to: string, why: string): Refused {
  return refused('template_change_not_allowed', { from: harness.template, to, why });
}

function planChange(
  ports: Pick<Ports, 'ids'>,
  harness: Harness,
  current: readonly Stage[],
  target: Template,
): Change | Refused {
  if (allowed.get(harness.template) !== target.key) {
    return notAllowed(harness, target.key, 'only_check_only_to_software');
  }
  const positions = new Map(target.stages.map((stage) => [stage.key, stage.position]));
  if (current.some((stage) => !positions.has(stage.key))) {
    return notAllowed(harness, target.key, 'stages_edited');
  }
  const kept = current.map((stage) => ({ ...stage, position: positions.get(stage.key) ?? stage.position }));
  const have = new Set(current.map((stage) => stage.key));
  const added = target.stages
    .filter((stage) => !have.has(stage.key))
    .map((stage) => stageFromTemplate(stage, harness.id, ports.ids.next()));
  return { kept, added };
}

async function applyChange(tx: StoreTransaction, applying: Applying): Promise<KernelOutcome<HarnessScene>> {
  const { harness, target, change } = applying;
  if (!(await tx.harnesses.write.setTemplate(harness.id, harness.template, target.key))) {
    return refused('stale_version', { harnessId: harness.id });
  }
  const descending = [...change.kept].sort((a, b) => b.position - a.position);
  for (const stage of descending) await tx.harnessStages.write.update(stage);
  for (const stage of change.added) await tx.harnessStages.write.insert(stage);
  await recordHarnessEvents(tx, applying.context, harness.id, [
    draft('template_changed', {
      from: harness.template,
      to: target.key,
      kept: change.kept.map((stage) => stage.key),
      added: change.added.map((stage) => stage.key),
    }),
  ]);
  const stages = [...change.kept, ...change.added].sort((a, b) => a.position - b.position);
  return accepted({ harness: { ...harness, template: target.key }, stages });
}

export function changeTemplate(
  ports: ChangePorts,
  caller: Caller,
  input: ChangeTemplateInput,
): Promise<KernelOutcome<HarnessScene>> {
  const target = templates.get(input.template);
  if (target === undefined) {
    return Promise.resolve(refused('malformed_command', { template: input.template }));
  }
  const context = recordContext(ports, caller, ports.clock.now());
  const work: EditWork<HarnessScene> = async (_tx, harness, current) => {
    const change = planChange(ports, harness, current, target);
    if ('status' in change) return change;
    const resulting = [...change.kept, ...change.added];
    const bypass = bypassRefusal(resulting);
    if (bypass !== null) return bypass;
    return {
      stageKey: null,
      resulting,
      apply: (tx) => applyChange(tx, { harness, target, change, context }),
    };
  };
  return editInTransaction(ports, caller, input.harnessId, work);
}
```

(If `RecordContext` is not exported from `items/record.ts`, export it there; it is the type `recordContext` returns. If `editInTransaction`'s `EditPlan.stageKey` is typed `string | null`, `null` is accepted; it names the stage a refusal is recorded against, and a template change names none.)

`packages/harness/stages/commands.ts`: import `changeTemplate, type ChangeTemplateInput` from `./template-change.ts`; `StageCommands` gains `changeTemplate(caller: Caller, input: ChangeTemplateInput): Promise<KernelOutcome<HarnessScene>>;` and the factory `changeTemplate: (caller, input) => changeTemplate(ports, caller, input),`.

- [ ] **Step 4: The command**

`apps/uw-app/commands/person/stages.ts`:

```ts
export const changeTemplateCommand = commandHandler({
  name: 'change_template',
  action: 'admin',
  run: async ({ kernel, caller, harnessId, pages }, body: CommandBody<'change_template'>) => {
    const changed = await kernel.stages.changeTemplate(caller, { harnessId, template: body.template });
    if (changed.status === 'accepted') {
      await pages.draftPersonas(body.template, changed.value.harness);
    }
    return fromKernel(changed);
  },
});
```

`apps/uw-app/commands/registry.ts`: import it and replace `notWiredCommand('change_template', 'admin'),` with `changeTemplateCommand,`.

- [ ] **Step 5: Run them**

Run: `pnpm check && npx vitest run sim/kernel/template-change.test.ts packages/harness/stages` then `pnpm sim -- GL-5 && pnpm sim -- all && pnpm walk:all`
Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/commands tools/architecture`
Expected: green, including `WB-1 the command registry` and `command handlers` architecture checks.

- [ ] **Step 6: Commit**

```bash
git add packages/harness apps/uw-app sim
git commit -m "feat(harness): an admin moves a check-only harness onto the software template

change_template keeps Check and Ship with their ids, items and settings,
moves them to the software positions, inserts the six other stages empty,
records template_changed beside the stage edits, and drafts the Builder
personas. Any other change, or a check-only harness with an added stage, is
refused template_change_not_allowed.

GL-5. S19-R10."
```

---

### Task 11: Verify, record, push

**Files:**
- Modify: `docs/progress_tracker.md` (the step 19 row; a rulings block for S19; the evidence by requirement; Not verified rows; the carry-forward rows)

- [ ] **Step 1: Run the whole chain**

Run with `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres` set: `pnpm verify`
Expected: green, with `pnpm trace:built` reporting none of OB-1, OB-2, PI-2 unproven once the step row reads Built (Step 2), and OB-4 and GL-5 proven as Shoulds. Note the test count and scenario count from the output.

- [ ] **Step 2: Update the tracker**

In `docs/progress_tracker.md`:

- Change the step 19 row's state from `Not started` to `Built` and its evidence to: the commit SHAs of Tasks 1 to 10; the proofs (OB-1 `packages/harness/alarms/silence.test.ts`, `sim/kernel/silence.test.ts`, `sim/scenarios/OB-1.a-silent-check-goes-red-and-wakes-the-admins-once-per-cooldown.ts`, `apps/uw-app/cron/silence.pg.test.ts`, `apps/uw-app/health/ball.test.ts`; OB-2 `packages/harness/items/fold-held.test.ts`, `packages/harness/views/holder.test.ts`, `sim/kernel/holder.test.ts`, `sim/kernel/holds.test.ts`, `sim/scenarios/OB-2.a-health-counts-who-has-held-the-ball-too-long.ts`, `apps/uw-app/views/parts/holder-words.test.ts`; OB-4 `packages/harness/views/bots.test.ts`, `sim/kernel/bot-counts.test.ts`, `packages/db/observability-columns.test.ts`, the `OB-4` case of the GitHub facts port contract; PI-2 `apps/uw-app/pages/provenance.test.ts`, `apps/uw-app/mcp/external-learning.pg.test.ts`; GL-5 `sim/kernel/template-change.test.ts`, `sim/scenarios/GL-5.a-check-only-harness-takes-the-software-template-and-keeps-its-items.ts`, `apps/uw-app/commands/template-change.pg.test.ts`); `pnpm verify` green locally with the counts; "CI not run (Actions billing)" or the CI run id; the plan path `docs/superpowers/plans/2026-10-15-step-19-observability-and-hooks.md`.
- Add a "Step 19 evidence by requirement" section after step 18's, one line per requirement naming its proofs as above.
- Under the rulings, add S19-R1 to S19-R13 from the top of this plan, in the shape of the S18 rows: `| date | requirement | ruling | cost if wrong |`.
- Under "Not verified": the screens of Tasks 5, 6 and 8 if no browser ran; "OB-1: the silence alarm's push and hub delivery on staging (the sim notifier proves the wake)"; "OB-2: items projected before step 19 read `heldSince: null` until their next event; run `kernel.repair.rebuildItem` on the pilot's open items after the deploy"; "OB-4: authors of pull requests not upserted since the deploy are unknown and counted until their next webhook or sweep".
- Under the carry-forward table, the four "Left for later" items from the top of this plan, each with "After v0.2.0" or the step that would take it.

- [ ] **Step 3: Commit and push**

```bash
git add docs/progress_tracker.md
git commit -m "docs(tracker): step 19 is built

OB-1 OB-2 OB-4 PI-2 GL-5 with their proofs, the S19 rulings, what was not
verified and what is left for later."
git push
```

The draft pull request for `build/v0.2.0` already exists; push only.

---

## Self-review

**Spec coverage.** OB-1: the level and the reader (Task 7 Steps 3 to 5, `silence.test.ts`, `sim/kernel/silence.test.ts`), the alarm at rank 3 to the admins once per cooldown (Task 7 scenario, `wakeRank` in Task 2), the `/health` indicator and its query as the drill-through (Task 8 `silenceIndicator`, `silenceRows` over the same `silences`), the cron (Task 7 Step 6 and its pg test). OB-2: the holder on the item card and the Board (Task 5), how long (`heldSince`, Tasks 2, 3, 5), the two `/health` counts with drill-through (Task 8). OB-4: the column with its default (Tasks 2, 3, 6), the author fact (Tasks 3, 4, 6), Home and the Board (Task 6), `/health` (Tasks 7 and 8 via `uncountedItems`), saying so (S19-R7, Tasks 6 and 8). PI-2: the external runner on a `review` delegation landing `suggested` with `source: external` and the pull request (Task 9, both test files). GL-5: check-only to software, items in Check and Ship keep their stage, new stages empty, any other change refused `template_change_not_allowed` (Task 10, kernel, scenario and command tests).

**Placeholders.** None; each step carries its code or its command. Where a file depends on a line an unbuilt earlier step adds (step 15's `reviewer_refutes`, step 16's `delegated_merge`, step 18's `blockedBy`), the step names that line and says to add after it.

**Type consistency.** `heldSince` is a string on `ItemState` (Tasks 2, 3, 5) and a `Date` on `Holder.since` (Task 5, 8). `Holder`, `holderOf`, `heldTooLong`, `reviewingIds` match between Tasks 5 and 8. `uncountedItems(facts, scopes)` and `CountScope` match between Tasks 6, 7 and 8. `Silence` and `silences` match between Tasks 7 and 8. `Holds.uncounted` is `{ person, agent }` in Task 8's read, indicator and tests. `GitHubFacts.authors` returns `PullRequestAuthor[]` in Task 4's port, adapters, contract and Task 6's helper. `ExternalWriter` and `Provenance` match between Task 9's rule, `derive.ts`, `store.ts`, `agent-write.ts` and the verb. `changeTemplate` and `ChangeTemplateInput` match between Task 10's kernel, `StageCommands` and the handler; `setTemplate(harnessId, from, to)` between Tasks 4 and 10.

**Review Focus.** Line 1 is pinned by Task 5's fourth fold test; line 2 by Task 7's second and third kernel tests; line 3 by Task 7's scenario; line 4 by Task 6's `bots.test.ts` and `bot-counts.test.ts`; line 5 by Task 9's pg tests 3, 4 and 5; line 6 by Task 10's first kernel test.
