# Step 18, Epic Intake: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person can hand the platform a whole GitHub epic: the facts know which issues are sub-issues of which, in GitHub's order; intake refuses any issue with no `Done when` heading and records the refusal so the Board shows what is not ready; `enqueue_epic` turns the epic's open sub-issues into items in order with the blockers their `Blocked by:` lines name; a blocked item is offered to no one until its blockers' items have passed Ship; independent items run in parallel up to the stage's WIP limit; and the Board draws each epic with its blocker edges.

**Architecture:** Additive. The GitHub facts module stores what intake needs from an issue body, never the body itself: the done-when lines and the same-repository blocker numbers, parsed by two pure functions in `packages/harness/github/issue-body.ts`, plus GitHub's sub-issue count and, on each sub-issue, its parent and place, read from GitHub's sub-issue list after every issue upsert (webhook and sweep alike). The kernel reads an epic through one new `GitHubFacts` port method, `epic`, over that read model. Items carry their epic place and their blockers on `ItemState` (folded from `item_created`), so `poll_queue` and `claim` decide "blocked" from the projection they already read. Refusals for a missing done-when are a harness event, `done_when_missing`, recorded once a day per issue or page, and the Board reads them back as its "Not ready" list. The Board's epic section is a pure grouping in the kernel view and a token-only SVG in the screen.

**Tech Stack:** TypeScript strict, Zod 4, Drizzle and drizzle-kit, Vitest 4 (node project and the Postgres service), Hono JSX for the Board, the sim over the embedded Postgres Store, the fixture GitHub transport.

**Spec:** `docs/PRD.md` section 7.11.5 (EI-1 to EI-5), sections 8.1, 8.5, 8.6 and 13 (step 18); the design is `docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` sections 2 (Epic, Done-when), 3 (V2-4), 5.5, 6 and 7.

**Requirements covered:** EI-1, EI-2, EI-3, EI-4 (Must) and EI-5 (Should, built: the grouping is one pure function over items the Board view can already read, and the drawing reuses the Flow diagram's SVG idiom).

**Builds on steps 14 to 17 (built before this plan runs).** Names used exactly as `docs/superpowers/plans/2026-10-15-step-14-joining.md` hands them over: `createdDraft` in `packages/harness/items/record.ts` and the `item_created` evidence with `pullRequest` and `expectedHead` (Task 7 of step 14), `createSimHarness` option `dispatchable` defaulting to `true` so agent claims on a harness with a repository pass the GL-6 gate, `notWiredCommand` in `apps/uw-app/commands/not-wired.ts`, and the step-14 contract procedure (append a lock entry, bump the minor, regenerate the islands bundle). From `docs/superpowers/plans/2026-10-15-step-15-ship-rule-and-gates.md`: `apps/uw-app/github/facts/heads.ts` (the files writer moved out of `upsert.ts`), the contract at `13.0.0`, and its migration. This plan touches nothing steps 16 and 17 own except one guard line each in `packages/harness/reads/poll.ts` (`claimableIn`) and `packages/harness/items/claim.ts` (`heldRefusal`); if those functions were reshaped by step 17, put the line where the same decision is made and say so in the commit body.

**Rulings made while planning** (recorded here and in `docs/progress_tracker.md` by the last task):

| Ruling | Cost if wrong |
|---|---|
| S18-R1. The facts keep what intake parses from an issue body, never the body: `gh_issues` gains `parent_issue_id` (the parent's GitHub id, no foreign key, set only by the sub-issue list), `parent_position` (the place in that list, both or neither), `sub_issues` (GitHub's `sub_issues_summary.total`, default 0), `done_when text[]` (at most 20 lines of at most 500 characters) and `blocked_by integer[]` (at most 50 issue numbers in the same repository). An issue with `sub_issues > 0` is an epic | Changing the parse rules needs a sweep to refresh the stored lines; reading the body again needs a GitHub call |
| S18-R2. A done-when is an ATX heading (`#` to `######`) whose text is "Done when" in any case, with an optional colon, outside a code fence, with at least one line under it before the next heading. List markers and checkboxes are stripped; blank lines, fenced lines and lines that are only an HTML comment do not count. A bold "**Done when:**" label is not a heading | An issue written with a bold label is refused until its author makes it a heading; the refusal says why |
| S18-R3. A blocker is a reference on a line that starts (after an optional list marker and bold) with "Blocked by" and a colon, outside a code fence: `#N`, or `owner/name#N` naming the issue's own repository, in any case. A struck reference (`~~…~~`) is shipped and skipped, as the cross-repo dependency map does. References to other repositories are dropped at parse | A cross-repository blocker never holds an item; the map's convention already treats those as a person's to track |
| S18-R4. The sub-issue list is read after every issue upsert whose `sub_issues` is above 0 (`followSubIssues`, called by `followUpserts`, so the webhook, the sweep and the import command all read it): `GET /repos/{owner}/{repo}/issues/{n}/sub_issues`, same-repository children upserted and given their parent and place, children no longer listed cleared. One level: a sub-issue's own sub-issues are not read through its parent. The `sub_issues` webhook is not subscribed in this step | A sub-issue added without touching the parent's `updated_at` waits for the parent's next upsert; `enqueue_epic` refuses `sub_issues_not_read` meanwhile (S18-R8) |
| S18-R5. Done-when is checked at every intake: a labelled issue's import (webhook, sweep and the `import` command, through `importStoredIssue` and again in the kernel's `importIssue`), `kickstart` (over the product page's body, which is what it enqueues), and `enqueue_epic` (every open sub-issue). A refusal appends the harness event `done_when_missing { via, issue, pageId, title }` at most once per issue or page per harness per 24 hours, and answers `done_when_missing`. An issue that already has an item is never checked again. The epic's own body is not checked: its done-when is the union of its open sub-issues', recorded on `epic_enqueued` | A storm of edits to a not-ready issue records one event a day; an issue whose done-when is removed after import keeps its item |
| S18-R6. A labelled issue with sub-issues is an epic and is not imported as an item: the import logs `issue_is_epic` and answers `not_permitted` (`why: epic`). Epics enter only through `enqueue_epic` | A team that labels an epic expecting one item gets none; the log line and the Board's empty lane say so |
| S18-R7. Items carry their place: `ItemState` gains `epic: { issue, title, position } \| null` and `blockedBy: itemId[]` (at most 50), folded from two optional `item_created` keys present only on epic items, so every other `item_created` keeps its exact key set (GH-3). `harness_items` gains `epic jsonb` and `blocked_by uuid[]` | A blocker edge added to GitHub after enqueue is not followed; re-enqueueing adds new sub-issues but does not rewrite existing items' blockers |
| S18-R8. `enqueue_epic { repository, number }` is a person command (`write` on the area; agents refused at the route and in the kernel). It reads the epic through `githubFacts.epic`, refuses `issue_not_found` for an unknown issue, `not_permitted` with `why: not_an_epic` for an issue with no sub-issues and `why: sub_issues_not_read` when the recorded sub-issues do not number GitHub's count (a stale list or a sub-issue in another repository). Items enter the first stage, as an import does, one per open sub-issue in sub-issue order, each at the bottom of the lane, with no issue page and no cross-reference comment. A closed sub-issue gets no item and blocks nothing. A sub-issue that already has an item in the harness keeps it unchanged and serves as a blocker target; one in another harness refuses `not_permitted` (`why: repository_mismatch`). A blocker cycle refuses `malformed_command` (`why: blocker_cycle`). Missing done-whens refuse the whole epic. `item_created` for epic items carries `requestId: null` (the one-item-per-request index allows one item per request); `epic_enqueued` carries the request id and is recorded only when at least one item was created | An epic item has no issue page for the Builder to read until a person writes one; the item still wraps its issue |
| S18-R9. A blocker's item has passed Ship when it is `done`, or when its stage sits after the harness's Ship stage: the lowest-positioned stage whose connector is not `none`. A harness with no such stage passes a blocker only when it is done. A blocker that loops back before Ship (Validate feeding Package) blocks again. A blocker whose item cannot be read blocks (fail closed) | A dependent waits again while its blocker is reworked, which is the intent |
| S18-R10. `poll_queue` drops a blocked item for every caller. `claim` refuses an agent's claim of a blocked item `not_permitted` (`why: blocked`, naming the blocker items); a person may still claim it | A person can start a blocked item by hand, which is how a person overrides a stale blocker line |
| S18-R11. The EI-4 scenario opens Package to agents with WIP 2 (KN-5's pattern), because epic items enter the first stage and the software template's Package has no agent pickup | None; the scenario proves the WIP limit and the blocker together |
| S18-R12. The Board shows, above the lanes and only on the unfiltered first page: one group per epic with at least one item not done (at most 20, by epic number), its items in sub-issue order laid out left to right by blocker depth with an arrow per blocker edge, and an ordered list saying the same in words for screen readers and phones; then "Not ready", at most 20 issues or pages from the last 30 days' `done_when_missing` events that still have no item. The view reads the harness's items once (`forHarness`) for this | A harness with thousands of items pays one wider read per Board load; V2-8 sizes for uW's volume |
| S18-R13. The contract moves one minor for the whole step (everything is additive; new item and evidence fields carry defaults) | None; the lock test enforces the rule |
| S18-R14. `done_when_missing` is an event as well as a refusal reason (as `delegation_required` is), and the columns of S18-R1 and S18-R7 are new. PRD sections 8.1 and 8.6 and design section 6 are corrected in Task 1 | None |

**What this step hands to later steps (keep these names exactly):**

| Interface | Where | Consumed by |
|---|---|---|
| `errorReasonSchema` gains `done_when_missing`; events `epic_enqueued`, `done_when_missing`; command `enqueue_epic` | `packages/contracts/outcomes.ts`, `events.ts`, `event-evidence.ts`, `commands.ts` | OB-2 (the holder on an epic item), DX-10 |
| `epicPlaceSchema`, `EpicPlace`; `intakeViaSchema`, `IntakeVia`; `ItemState.epic`, `ItemState.blockedBy` | `packages/contracts/harness.ts`, `closed-sets.ts` | OB-2, OB-4 (counts per epic) |
| `doneWhenOf(markdown)`, `blockedByOf(markdown, repository)` | `packages/harness/github/issue-body.ts`, exported | any later intake source (a Connector adapter, design section 10) |
| `openBlockers(item, items, stages)`, `passedShip(item, stages)`, `blockerCycle(edges)`, `blockedRefusal(tx, caller, item)` | `packages/harness/items/blockers.ts` | FL-2 (a fix claim on a blocked item), OB-2 |
| `GitHubFacts.epic(key: IssueKey): Promise<EpicFacts \| null>`; `IssueKey`, `IssueFact`, `EpicFacts` | `packages/harness/ports.ts` | GL-1's live run (the platform adapter over the read model) |
| `items.enqueueEpic(caller, EnqueueEpicInput)` returning `EpicEnqueued`; `items.recordNotReady(caller, NotReadyInput)` | `packages/harness/items/epic.ts`, `not-ready.ts` | DX-10 |
| `BoardView.epics: readonly EpicGroup[]`, `BoardView.notReady: readonly NotReady[]`; `epicGroupsOf`, `notReadyOf` | `packages/harness/views/types.ts`, `views/epics.ts` | OB-2 (the holder on the epic node), OB-4 |
| `recordSubIssues(db, list)`, `epicFacts(db, key)`, `issueChangeOf(row, repo, had)`, `followSubIssues(deps, changes, logger)`, `GitHubReads.subIssues` | `apps/uw-app/github/facts/sub-issues.ts`, `facts/epics.ts`, `facts/issues.ts`, `github/sub-issues.ts`, `github/client.ts` | GL-1 |
| `sim/epics.ts`: `epicRepository`, `epicKey`, `epicFact`, `epicOf`, `epicOfFour`, `enqueueEpicAs`; sim `githubFacts.givenEpic`; app test helper `answeringEpic` | `sim/`, `apps/uw-app/testing/kernel.ts` | DX-10 |

---

## Global Constraints

Every task obeys every line here. The controller passes this section to each implementer.

**Where and how**

- Work only in `/home/ianjl/projects/uw-platform-v0.2.0`, branch `build/v0.2.0`. Never commit to `main`, never force-push, never `--no-verify`.
- Read `AGENTS.md` sections 1, 4 and 10 before the first edit. When this plan and `AGENTS.md` disagree, `AGENTS.md` wins; record the conflict in `docs/progress_tracker.md` and build the version that keeps the rule.
- Words come from `CONTEXT.md`: **epic**, **done-when**, **blocker** and **not ready** (the last two added in Task 1), **item**, **claim**, **Ship**. Never "parent issue" or "milestone" for an epic, never "acceptance criteria" or "definition of done" for a done-when, never "dependency" for a blocker in code or copy.
- Commits: Conventional Commits, the agent as sole author, no attribution footer. Hooks always pass. Put the requirement IDs in each commit body.

**Code rules (all mechanically enforced by `pnpm verify`)**

- TypeScript `strict`, no `any`, no `@ts-ignore`, no `as unknown as`, no non-null assertion.
- No code comments of any kind.
- Files under 500 non-blank lines; functions under 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters. `apps/uw-app/github/facts/upsert.ts` and `apps/uw-app/github/sweep.ts` are near the limit: Task 4 moves two issue readers out of `upsert.ts` before adding its three lines, and `sweep.ts` gets no new line (the sub-issue read rides `followUpserts`).
- Zod at every boundary. `packages/contracts` imports only `zod`. `packages/harness` imports nothing from Workers, Drizzle or the network.
- Every exported Zod schema registered in `packages/contracts/registry.ts` has `fixtures/<key>/valid/*.json` and `fixtures/<key>/invalid/*.json`. Any change to a registered `z.enum` appends a full entry to `packages/contracts/contract-lock.json` and changes `CONTRACT_VERSION`.
- Every route and command has `can()` on the harness's area through the command registry's `action`. `enqueue_epic` is a person command: no MCP verb, no persona toolset line (V2-7).
- `gate_decisions` and `harness_stages` are never written by anything this step adds.
- Issue bodies are untrusted content (step 13). This step reads `Done when` and `Blocked by` lines only to parse them; no text from an issue body or title reaches a prompt here. Any later prompt that shows done-when lines wraps them with `untrusted('issue_body', …)` from `packages/harness/untrusted.ts`.
- UI: tokens only (no hex, no fixed pixel widths in classes), sentence case, second person, no exclamation marks, no emoji; Kindle orange marks a human action and nothing else, so the epic drawing and the not-ready list use no Kindle; every link has an accessible name and visible focus; light, dark and phone width hold (`screenProblems` checks).

**Contract version**

- At planning time `packages/contracts/version.ts` reads `12.4.0` with step 14 in flight; step 15 moves it to `13.0.0`; steps 16 and 17 may each add a minor. This step moves it to **the next minor after whatever is current** (expected `13.1.0` to `13.3.0`), once, in Task 2. Procedure: Task 2 Step 6 reads `CONTRACT_VERSION`, computes `<major>.<minor + 1>.0`, appends a lock entry built from the last one plus this step's values, writes the version, and prints it. Every later mention of "the step's version" means that printed value.

**Migrations**

- One migration for the step, generated in Task 3 with `--name epic_intake`, at the next index after the newest file in `packages/db/migrations/` (expected `0032` or `0033`). No hand-written statement.

**Shared roots**

- `CONTEXT.md` (Task 1), `docs/PRD.md` and the design (Task 1, their own commit), `packages/contracts/` (Task 2), `packages/db/schema.ts` and `packages/db/schema-github.ts` with the migration (Task 3), `packages/harness/ports.ts` (Task 5) are shared roots. Each change to one is its own commit with no feature code, and the message names the root and why. `packages/harness/store-ports.ts` does not change: the Store's item gateway already carries `ItemState`. `packages/db/store/`, `packages/db/test-seed.ts`, `apps/uw-app/generated/islands.ts` and the sim are not shared roots.
- Between Task 2 and Task 3 `tools/db/drift.test.ts` is red (the name checks derive from the enums). Between Task 5's port commit and its adapter commit `pnpm check` is red. Do those pairs back to back.

**Tests**

- A test that proves a requirement has a `describe` or `it` title starting with the requirement ID and a space, as `tools/trace/proofs.ts` reads it. A scenario's `id` is the requirement ID and its file is `sim/scenarios/<ID>.<slug>.ts`.
- Run one file with `npx vitest run <path>`. Database tests (`*.pg.test.ts`, `packages/db`, the Store and GitHub facts contracts on the platform adapter) need `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres` after `pg_ctl -D ~/.local/share/uw-platform-test-pg -o "-p 54329" start`. Never run two Vitest suites at once on this machine (WSL runs out of memory); `pnpm verify` runs them in sequence.

## Review Focus

Inputs the spec implies that no requirement row spells out, most likely to bite a person first. Each line names the task that pins it.

1. A sub-issue added to the epic on GitHub after the facts last read the list must not be silently left out. Task 7 pins `enqueue_epic` refusing `sub_issues_not_read` when GitHub's count and the recorded list disagree.
2. A person clicking "enqueue" twice, or again after a fifth sub-issue lands, must not duplicate items or blockers. Task 7 pins a second `enqueueEpic` creating nothing and appending no event, and a third after a new sub-issue creating exactly one item whose blocker points at the existing item.
3. An issue template that ships `## Done when` with an HTML comment placeholder, or a `## Done when` inside a code block, must not pass as a done-when. Task 4 pins both refusing (empty lines) and a list under the heading passing.
4. A webhook storm of edits on a labelled issue with no done-when must not grow the event log by one per edit. Task 6 pins two imports in the same day recording one `done_when_missing`, and a third after 24 hours recording a second.
5. An agent that skips `poll_queue` and claims a blocked item by id must be refused, and a blocker looping back from Validate to Package must block again. Task 8 pins the agent refusal, the person claim succeeding, and the pure loop-back case.

---

### Task 1: The words and the document corrections (shared roots `CONTEXT.md`, `docs/PRD.md`, the design)

**Files:**
- Modify: `CONTEXT.md` (two entries after **Done-when**)
- Modify: `docs/PRD.md` (sections 8.1 and 8.6)
- Modify: `docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` (section 6)

**Interfaces:**
- Produces: the words **Blocker** and **Not ready** every later task uses.

- [ ] **Step 1: Add the words**

In `CONTEXT.md`, directly after the **Done-when** entry (it ends `_Avoid_: acceptance criteria, definition of done`), insert:

```markdown

**Blocker**:
An item another item in the same epic waits on: the item for an issue named on a `Blocked by:` line in the waiting item's issue. A blocked item is offered to no one until every blocker's item has passed Ship; a person may still claim it.
_Avoid_: dependency, prerequisite, parent

**Not ready**:
An issue or product page intake refused because it has no done-when. The refusal is recorded on the harness and the Board lists it until it becomes an item.
_Avoid_: invalid, rejected (that is a gate decision), backlog
```

- [ ] **Step 2: Commit (shared root)**

```bash
git add CONTEXT.md
git commit -m "docs(context): blocker and not ready

Shared root CONTEXT.md. The two words step 18 uses beside epic and
done-when, added before any code names them (rule 1).

EI-2 EI-3. S18-R5 S18-R10."
```

- [ ] **Step 3: Correct the PRD and the design (S18-R14)**

`docs/PRD.md` section 8.1, in the `harness_items` row, replace `zulip_topic, created at | the kernel |` with:

```markdown
zulip_topic, the epic place (`epic`: the epic issue, its title and the item's place in its sub-issue list) and the blocker items (`blocked_by`; EI-3), created at | the kernel |
```

In the `gh_repos`, `gh_issues`, … row, replace `on `gh_issues` the cross-reference claim (`xref_claimed_at`, `xref_comment_id`)` with:

```markdown
on `gh_issues` the cross-reference claim (`xref_claimed_at`, `xref_comment_id`), GitHub's sub-issue count (`sub_issues`), the parent and place in the parent's sub-issue list (`parent_issue_id`, `parent_position`), and what intake parses from the body: the done-when lines (`done_when`) and the same-repository blocker numbers (`blocked_by`); the body itself is not stored (EI-1, EI-2, EI-3)
```

Section 8.6, in the line beginning `Added in v0.2.0:`, replace `` `epic_enqueued`, `` with `` `epic_enqueued`, `done_when_missing` (a harness event recording an intake refusal; EI-2), ``.

`docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` section 6, replace `` `gh_issues`: `parent_issue_id`. `` with:

```markdown
`gh_issues`: `parent_issue_id`, `parent_position`, `sub_issues`, `done_when`, `blocked_by` (parsed from the body; the body is not stored). `harness_items`: `epic`, `blocked_by`.
```

and in the **Events.** line replace `` `epic_enqueued`, `` with `` `epic_enqueued`, `done_when_missing`, ``.

Use the Edit tool with these exact strings; if a string is not found because an earlier step rewrote the sentence, make the same addition to the sentence as it now stands.

Run: `npx vitest run tools/trace`
Expected: green (the requirement rows are untouched).

- [ ] **Step 4: Commit**

```bash
git add docs/PRD.md docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md
git commit -m "docs(prd): the epic intake columns and the done_when_missing event

PRD 8.1 and 8.6 and design section 6 name what step 18 adds beyond
parent_issue_id and epic_enqueued: the parsed body facts on gh_issues,
the epic place and blockers on harness_items, and done_when_missing as an
event as well as a refusal.

EI-1 EI-2 EI-3. S18-R1 S18-R7 S18-R14."
```

---

### Task 2: The contracts for epic intake (shared root `packages/contracts`)

**Files:**
- Modify: `packages/contracts/outcomes.ts` (`done_when_missing` at the end of `errorReasonSchema`)
- Modify: `packages/contracts/events.ts` (two names at the end of `eventNames`)
- Modify: `packages/contracts/closed-sets.ts` (`intakeViaSchema`, `IntakeVia`)
- Modify: `packages/contracts/harness.ts` (`epicPlaceSchema`, `EpicPlace`; `itemStateSchema` gains `epic`, `blockedBy`)
- Modify: `packages/contracts/event-evidence.ts` (`item_created` gains `epic`, `blockedBy`; `epic_enqueued`, `done_when_missing`)
- Modify: `packages/contracts/commands.ts` (`enqueue_epic`)
- Modify: `packages/contracts/registry.ts` (`epic-place`, `intake-via`)
- Create: fixtures (Step 5)
- Modify: `packages/contracts/events.test.ts` (the vocabulary count), `packages/contracts/contracts.test.ts` (new block)
- Modify: `packages/contracts/contract-lock.json`, `packages/contracts/version.ts`
- Second commit, not a shared root: `packages/harness/items/fold.ts`, every `ItemState` literal `pnpm check` flags (expect `packages/harness/views/costs.test.ts`, `packages/harness/gates/ship-input.test.ts`, `apps/uw-app/github/review-readback.pg.test.ts`, `sim/kernel/events.test.ts`, `tools/properties/item-events.ts`), `apps/uw-app/commands/registry.ts`, `apps/uw-app/commands/registry.test.ts`, `apps/uw-app/generated/islands.ts`

**Interfaces:**
- Produces: `EpicPlace = { issue: IssueRef; title: string; position: number }`; `IntakeVia = 'import' | 'kickstart' | 'enqueue_epic'`; `ItemState.epic: EpicPlace | null` (default `null`), `ItemState.blockedBy: string[]` (default `[]`); `EventEvidence['epic_enqueued'] = { epic: IssueRef; title; items: { itemId; issue: IssueRef; created: boolean; blockedBy: string[] }[]; outside: number[]; doneWhen: string[] }`; `EventEvidence['done_when_missing'] = { via: IntakeVia; issue: IssueRef | null; pageId: string | null; title: string }` (exactly one of `issue` and `pageId`); `CommandBody<'enqueue_epic'> = { command; requestId; repository: string; number: number }`.

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/events.test.ts`, the vocabulary test asserts a count and the last name. Read the count on disk (`grep -n "toHaveLength" packages/contracts/events.test.ts`), add two, and set the last name:

```ts
    expect(eventNameSchema.options.at(-1)).toBe('done_when_missing');
```

Append to `packages/contracts/contracts.test.ts` (import `commandSchema`, `epicPlaceSchema`, `errorReasonSchema`, `eventEvidenceSchemas`, `intakeViaSchema`, `itemStateSchema` the way the file already imports its neighbours):

```ts
describe('EI-1 EI-2 EI-3 the contracts for epic intake', () => {
  const requestId = '00000000-0000-4000-8000-0000000000aa';
  const epicIssue = { repo: 'unfoldingWord/uw-platform', number: 40, githubId: 9100000340 };
  const subIssue = { repo: 'unfoldingWord/uw-platform', number: 41, githubId: 9100000341 };
  const place = { issue: epicIssue, title: 'Epic intake', position: 0 };

  it('names the refusal and the intake routes', () => {
    expect(errorReasonSchema.options.at(-1)).toBe('done_when_missing');
    expect(intakeViaSchema.options).toEqual(['import', 'kickstart', 'enqueue_epic']);
  });

  it('enqueues an epic by repository and number, as import names an issue', () => {
    const command = { command: 'enqueue_epic', requestId, repository: epicIssue.repo, number: 40 };
    expect(commandSchema.safeParse(command).success).toBe(true);
    expect(commandSchema.safeParse({ ...command, number: 0 }).success).toBe(false);
  });

  it('reads an older item as in no epic with no blockers', () => {
    const older = {
      itemId: '00000000-0000-4000-8000-0000000000b1',
      harnessId: '00000000-0000-4000-8000-0000000000a1',
      stageKey: 'package',
      title: 'Show the board',
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
    expect(itemStateSchema.parse(older)).toMatchObject({ epic: null, blockedBy: [] });
    expect(itemStateSchema.safeParse({ ...older, epic: place, blockedBy: [older.itemId] }).success).toBe(true);
    expect(epicPlaceSchema.safeParse({ ...place, position: -1 }).success).toBe(false);
  });

  it('carries the epic place and blockers on item_created only when given', () => {
    const created = { stage: 'package', title: 'Read the sub-issues', pageId: null, priority: 0, due: null, issue: subIssue };
    const schema = eventEvidenceSchemas.item_created;
    expect(schema.parse(created)).toMatchObject({ epic: null, blockedBy: [] });
    expect(schema.safeParse({ ...created, epic: place, blockedBy: [] }).success).toBe(true);
  });

  it('records an enqueued epic and a refusal for a missing done-when', () => {
    const enqueued = {
      epic: epicIssue,
      title: 'Epic intake',
      items: [{ itemId: '00000000-0000-4000-8000-0000000000b1', issue: subIssue, created: true, blockedBy: [] }],
      outside: [7],
      doneWhen: ['The sub-issues are read.'],
    };
    expect(eventEvidenceSchemas.epic_enqueued.safeParse(enqueued).success).toBe(true);
    const missing = { via: 'enqueue_epic', issue: subIssue, pageId: null, title: 'Read the sub-issues' };
    expect(eventEvidenceSchemas.done_when_missing.safeParse(missing).success).toBe(true);
    const both = { ...missing, pageId: '00000000-0000-4000-8000-0000000000c1' };
    expect(eventEvidenceSchemas.done_when_missing.safeParse(both).success).toBe(false);
    const neither = { ...missing, issue: null };
    expect(eventEvidenceSchemas.done_when_missing.safeParse(neither).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/contracts/contracts.test.ts packages/contracts/events.test.ts`
Expected: FAIL; `intakeViaSchema` and `epicPlaceSchema` are undefined, `enqueue_epic` is not a command, the count is two short.

- [ ] **Step 3: Write the contracts**

`packages/contracts/outcomes.ts`: add `'done_when_missing',` as the last value of `errorReasonSchema`.

`packages/contracts/events.ts`: add `'epic_enqueued',` and `'done_when_missing',` as the last two names of `eventNames`.

`packages/contracts/closed-sets.ts`, after `capabilityWordSchema`:

```ts
export const intakeViaSchema = z.enum(['import', 'kickstart', 'enqueue_epic']);
```

and beside the other types:

```ts
export type IntakeVia = z.infer<typeof intakeViaSchema>;
```

`packages/contracts/harness.ts`, directly above `itemStateSchema`:

```ts
export const epicPlaceSchema = z.strictObject({
  issue: issueRefSchema,
  title: z.string().min(1).max(200),
  position: z.number().int().min(0).max(999),
});
```

and in `itemStateSchema`, after `zulipTopic`:

```ts
  epic: epicPlaceSchema.nullable().default(null),
  blockedBy: z.array(z.uuid()).max(50).default([]),
```

and beside `IssueRef`: `export type EpicPlace = z.infer<typeof epicPlaceSchema>;`.

`packages/contracts/event-evidence.ts`: add `intakeViaSchema` to the `./closed-sets.ts` import and `epicPlaceSchema` to the `./harness.ts` import. In `item_created`'s `strictObject`, after `expectedHead`:

```ts
      epic: epicPlaceSchema.nullable().default(null),
      blockedBy: z.array(id).max(50).default([]),
```

In `harnessEvidence`, after `shadow_lifted` (or after the last entry steps 15 to 17 left there):

```ts
  epic_enqueued: z.strictObject({
    epic: issueRefSchema,
    title: z.string().min(1).max(200),
    items: z
      .array(
        z.strictObject({
          itemId: id,
          issue: issueRefSchema,
          created: z.boolean(),
          blockedBy: z.array(id).max(50),
        }),
      )
      .min(1)
      .max(100),
    outside: z.array(z.number().int().min(1)).max(50),
    doneWhen: z.array(text).max(100),
  }),
  done_when_missing: z
    .strictObject({
      via: intakeViaSchema,
      issue: issueRefSchema.nullable(),
      pageId: id.nullable(),
      title: z.string().min(1).max(200),
    })
    .refine((missing) => (missing.issue === null) !== (missing.pageId === null), 'an issue or a page'),
```

`packages/contracts/commands.ts`: add `'enqueue_epic',` as the last value of `commandNames`; in `harnessCommandSchemas`, last:

```ts
  enqueue_epic: body('enqueue_epic', {
    repository: repositorySchema,
    number: z.number().int().min(1),
  }),
```

and `harnessCommandSchemas.enqueue_epic,` as the last member of `commandSchema`'s union.

`packages/contracts/registry.ts`: import `intakeViaSchema` with the closed sets and `epicPlaceSchema` from `./harness.ts`; add beside `'issue-ref'`:

```ts
  'epic-place': epicPlaceSchema,
  'intake-via': intakeViaSchema,
```

- [ ] **Step 4: Run the new tests**

Run: `npx vitest run packages/contracts/contracts.test.ts packages/contracts/events.test.ts`
Expected: the new block and the vocabulary test pass; `golden fixtures` and `CT-3 the contract lock` fail until Steps 5 and 6.

- [ ] **Step 5: Write the fixtures**

Before running, list `packages/contracts/fixtures/event/valid` and copy the `actor` an existing person-written fixture uses; replace `"human:00000000-0000-4000-8000-000000000001"` if it differs. Confirm `fixtures/error-reason/valid`, `fixtures/command/valid` and `fixtures/item-state/valid` exist.

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
const itemId = "00000000-0000-4000-8000-0000000000b1";
const requestId = "00000000-0000-4000-8000-0000000000aa";
const person = "human:00000000-0000-4000-8000-000000000001";
const epic = { repo: "unfoldingWord/uw-platform", number: 40, githubId: 9100000340 };
const sub = { repo: "unfoldingWord/uw-platform", number: 41, githubId: 9100000341 };
const place = { issue: epic, title: "Epic intake", position: 0 };
const event = (n, name, item, evidence, request = null) => ({
  eventId: `00000000-0000-4000-8000-0000000000f${n}`,
  harnessId, itemId: item, name, position: n, at: "2026-10-15T09:00:00.000Z", actor: person, evidence,
  traceId: "00000000-0000-4000-8000-0000000000c1", requestId: request,
});
write("epic-place/valid/first.json", place);
write("epic-place/invalid/negative-position.json", { ...place, position: -1 });
write("intake-via/valid/import.json", "import");
write("intake-via/valid/enqueue-epic.json", "enqueue_epic");
write("intake-via/invalid/unknown.json", "label");
write("error-reason/valid/done-when-missing.json", "done_when_missing");
write("command/valid/enqueue-epic.json", { command: "enqueue_epic", requestId, repository: epic.repo, number: 40 });
write("command/invalid/enqueue-epic-without-number.json", { command: "enqueue_epic", requestId, repository: epic.repo });
const created = { stage: "package", title: "Read the sub-issues", pageId: null, priority: 0, due: null, issue: sub };
write("event/valid/item-created-in-an-epic.json", event(1, "item_created", itemId, { ...created, epic: place, blockedBy: [] }));
write("event/valid/epic-enqueued.json", event(2, "epic_enqueued", null, {
  epic, title: "Epic intake", items: [{ itemId, issue: sub, created: true, blockedBy: [] }], outside: [], doneWhen: ["The sub-issues are read."] }, requestId));
write("event/invalid/epic-enqueued-without-items.json", event(2, "epic_enqueued", null, {
  epic, title: "Epic intake", items: [], outside: [], doneWhen: [] }, requestId));
write("event/valid/done-when-missing.json", event(3, "done_when_missing", null, { via: "import", issue: sub, pageId: null, title: "Read the sub-issues" }));
write("event/invalid/done-when-missing-names-nothing.json", event(3, "done_when_missing", null, { via: "import", issue: null, pageId: null, title: "Read the sub-issues" }));
'
npx prettier --write packages/contracts/fixtures
```

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
  "error-reason": add("error-reason", ["done_when_missing"]),
  "event-name": add("event-name", ["epic_enqueued", "done_when_missing"]),
  "command-name": add("command-name", ["enqueue_epic"]),
  "intake-via": ["import", "kickstart", "enqueue_epic"] };
const sorted = Object.fromEntries(Object.entries(sets).sort(([a], [b]) => a.localeCompare(b)));
lock.versions.push({ version: next, sets: sorted });
fs.writeFileSync(p, JSON.stringify(lock, null, 2) + "\n");
fs.writeFileSync(versionFile, readFileSync(versionFile, "utf8").replace(/CONTRACT_VERSION = .\d+\.\d+\.\d+./, `CONTRACT_VERSION = \x27${next}\x27`));
console.log(next);
'
npx prettier --write packages/contracts/contract-lock.json packages/contracts/version.ts
```

Expected: prints the step's version (the next minor after whatever was current).

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
git commit -m "feat(contracts): epic intake, the epic place, blockers and done_when_missing

Shared root packages/contracts. The refusal done_when_missing, the events
epic_enqueued and done_when_missing, the command enqueue_epic, the intake
routes, and the epic place and blockers on an item and on item_created,
both defaulted so every earlier item and event reads unchanged. Additive,
one minor version.

EI-1 EI-2 EI-3. S18-R5 S18-R7 S18-R8 S18-R13."
```

- [ ] **Step 10: Fill the totals the new values force (second commit)**

`packages/harness/items/fold.ts`: add `'epic_enqueued'` and `'done_when_missing'` to `unchangedNames`; in `created`, after `zulipTopic: null,`:

```ts
    epic: evidence.epic,
    blockedBy: evidence.blockedBy,
```

Run `pnpm check`. For each `ItemState` object literal it flags (outside `fold.ts`), add `epic: null, blockedBy: []`.

`apps/uw-app/commands/registry.ts`: add `notWiredCommand('enqueue_epic', 'write'),` as the last entry of the `commandRegistryOf([...])` list (import `notWiredCommand` from `./not-wired.ts` if step 14's import is gone). `apps/uw-app/commands/registry.test.ts`: add `enqueue_epic: 'write',` to `actions`.

Regenerate the islands bundle, which embeds the contract schemas: `pnpm ui:islands`.

Run: `pnpm check && npx vitest run packages/harness/items packages/contracts apps/uw-app/commands/registry.test.ts tools/ui/generated-islands.test.ts`
Expected: green. `tools/db/drift.test.ts` is red until Task 3.

```bash
git add packages/harness apps/uw-app/commands/registry.ts apps/uw-app/commands/registry.test.ts apps/uw-app/generated/islands.ts apps/uw-app/github sim tools/properties
git commit -m "chore: the totals the epic intake contracts force

The two harness events fold to nothing, item_created folds the epic place
and blockers, every ItemState literal names them, enqueue_epic is
registered not wired until Task 9, and the islands bundle is rebuilt.

EI-2 EI-3."
```

---

### Task 3: The columns, the migration and the Store binding (shared root `packages/db/schema.ts`, `schema-github.ts`)

**Files:**
- Modify: `packages/db/schema-github.ts` (`ghIssues`: five columns, four checks, one index)
- Modify: `packages/db/schema.ts` (`harnessItems`: two columns, one check)
- Create: `packages/db/migrations/00NN_epic_intake.sql`, its snapshot and journal entry (generated)
- Create: `packages/db/epic-columns.test.ts`
- Second commit: `packages/db/store/rows.ts` (`toItemState`), `packages/db/store/items.ts` (`columnsOf`), `packages/harness/port-contracts/store-items-epic.ts` (create), `packages/harness/port-contracts/store.ts` (wire it)

**Interfaces:**
- Consumes: Task 2's enums (the name checks regenerate from them) and `ItemState.epic`, `ItemState.blockedBy`.
- Produces: Drizzle fields `ghIssues.parentIssueId`, `parentPosition`, `subIssues`, `doneWhen`, `blockedBy`; `harnessItems.epic`, `harnessItems.blockedBy`. The Store reads and writes `ItemState.epic` and `ItemState.blockedBy` through the existing `insert`, `project`, `byId`, `byIds`, `forHarness`.

- [ ] **Step 1: Write the failing test**

`packages/db/epic-columns.test.ts`:

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

async function seedRepo(db: Db, githubId: number): Promise<void> {
  await db.execute(sql`INSERT INTO gh_repos (github_id, full_name, default_branch, private, fresh_at)
    VALUES (${githubId}, ${`unfoldingWord/epic-${githubId}`}, 'main', true, now())`);
}

function insertIssue(db: Db, repoId: number, number: number) {
  return db.execute(sql`INSERT INTO gh_issues
    (github_id, repo_id, number, title, state, github_updated_at, fresh_at)
    VALUES (${repoId * 100 + number}, ${repoId}, ${number}, 'Epic intake', 'open', now(), now())`);
}

function insertChildWithoutPlace(db: Db, repoId: number, number: number, parentId: number) {
  return db.execute(sql`INSERT INTO gh_issues
    (github_id, repo_id, number, title, state, github_updated_at, fresh_at, parent_issue_id)
    VALUES (${repoId * 100 + number}, ${repoId}, ${number}, 'Epic intake', 'open', now(), now(), ${parentId})`);
}

function epicColumns(db: () => Db): void {
  it('EI-1 an issue starts with no parent, no sub-issues, no done-when and no blockers', async () => {
    await seedRepo(db(), 91001);
    await insertIssue(db(), 91001, 1);
    const rows = await db().execute<Record<string, unknown>>(sql`
      SELECT parent_issue_id, parent_position, sub_issues, done_when, blocked_by
      FROM gh_issues WHERE github_id = ${91001 * 100 + 1}`);
    expect(rows[0]).toEqual({
      parent_issue_id: null,
      parent_position: null,
      sub_issues: 0,
      done_when: [],
      blocked_by: [],
    });
  });

  it('EI-1 refuses a parent without a place by gh_issues_parent_with_place', async () => {
    await seedRepo(db(), 91002);
    expect(await refusal(insertChildWithoutPlace(db(), 91002, 2, 9100000340))).toEqual({
      code: '23514',
      constraint: 'gh_issues_parent_with_place',
    });
  });

  it('EI-3 an item starts in no epic with no blockers', async () => {
    const rows = await db().execute<{ column_name: string; column_default: string | null }>(sql`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_name = 'harness_items' AND column_name IN ('epic', 'blocked_by')
      ORDER BY column_name`);
    expect(rows.map((row) => row.column_name)).toEqual(['blocked_by', 'epic']);
    expect(rows[0]?.column_default).toContain("'{}'");
    expect(rows[1]?.column_default).toBeNull();
  });

  it('EI-2 EI-3 admits the new event and command names', async () => {
    const checks = await db().execute<{ definition: string }>(sql`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conname IN ('harness_events_name_known', 'command_requests_command_known')`);
    const text = checks.map((row) => row.definition).join(' ');
    for (const name of ['epic_enqueued', 'done_when_missing', 'enqueue_epic']) {
      expect(text).toContain(`'${name}'`);
    }
  });
}

describe('the epic intake columns', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => epicColumns(openDatabase(target)),
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/db/epic-columns.test.ts`
Expected: FAIL, column `parent_issue_id` does not exist.

- [ ] **Step 3: Add the columns**

`packages/db/schema-github.ts`, below `emptyText`:

```ts
const emptyIntegers = sql`'{}'::integer[]`;
```

In `ghIssues`, after `xrefCommentId`:

```ts
    parentIssueId: githubId('parent_issue_id'),
    parentPosition: integer('parent_position'),
    subIssues: integer('sub_issues').notNull().default(0),
    doneWhen: text('done_when').array().notNull().default(emptyText),
    blockedBy: integer('blocked_by').array().notNull().default(emptyIntegers),
```

and in its checks, after `gh_issues_state_known`:

```ts
    check(
      'gh_issues_parent_with_place',
      sql`(${t.parentIssueId} IS NULL) = (${t.parentPosition} IS NULL)`,
    ),
    check('gh_issues_sub_issues_counted', sql`${t.subIssues} >= 0`),
    check('gh_issues_done_when_bounded', sql`cardinality(${t.doneWhen}) <= 20`),
    check('gh_issues_blocked_by_bounded', sql`cardinality(${t.blockedBy}) <= 50`),
    index('gh_issues_parent').on(t.parentIssueId, t.parentPosition),
```

`packages/db/schema.ts`, in `harnessItems` after `zulipTopic`:

```ts
    epic: jsonb('epic'),
    blockedBy: uuid('blocked_by').array().notNull().default(sql`'{}'::uuid[]`),
```

and in its checks:

```ts
    check('harness_items_blocked_by_bounded', sql`cardinality(${t.blockedBy}) <= 50`),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @uw/db exec drizzle-kit generate --name epic_intake`
Expected: one new `packages/db/migrations/00NN_epic_intake.sql` with the five `gh_issues` columns, the two `harness_items` columns, the five checks, the index, and a drop-and-add of `harness_events_name_known` and `command_requests_command_known` whose lists include the new names. Read the file; if it contains anything else, stop and find out why before committing.

- [ ] **Step 5: Run the database tests and the drift test**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/db tools/db/drift.test.ts`
Expected: green, including `migrations`, `the epic intake columns` on both targets, and `schema drift`.

- [ ] **Step 6: Commit (shared root)**

```bash
git add packages/db/schema.ts packages/db/schema-github.ts packages/db/migrations packages/db/epic-columns.test.ts
git commit -m "feat(db): sub-issues and parsed body facts on gh_issues, the epic place and blockers on items

Shared root packages/db/schema.ts and schema-github.ts, one migration for
step 18. gh_issues gains parent_issue_id, parent_position, sub_issues,
done_when and blocked_by, written by the facts module; harness_items gains
epic and blocked_by, written by the kernel. The event and command checks
admit the contract's new names.

EI-1 EI-2 EI-3. S18-R1 S18-R7."
```

- [ ] **Step 7: Write the failing Store contract suite**

`packages/harness/port-contracts/store-items-epic.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Store } from '../ports.ts';
import { at, itemOf, seedHarness } from './store-gateway-fixtures.ts';

type EpicSubject = () => { readonly store: Store };

const place = {
  issue: { repo: 'unfoldingWord/uw-platform', number: 40, githubId: 9100000340 },
  title: 'Epic intake',
  position: 2,
};

export function describeStoreItemsEpic(adapter: string, subject: EpicSubject): void {
  describe(`store keeps an item's epic place and blockers on ${adapter}`, () => {
    it('DX-3 EI-3 inserts, reads, lists and projects the epic place and the blockers', async () => {
      const read = await subject().store.transaction(async (tx) => {
        await seedHarness(tx, 0x7600, 'gateway-epic');
        const blocker = itemOf(0x7600, 1, {});
        const waiting = itemOf(0x7600, 2, { epic: place, blockedBy: [blocker.itemId] });
        await tx.harnessItems.write.insert(blocker, at);
        await tx.harnessItems.write.insert(waiting, at);
        const inserted = await tx.harnessItems.read.byId(waiting.itemId);
        const listed = await tx.harnessItems.read.byIds([waiting.itemId]);
        await tx.harnessItems.write.project({ ...waiting, blockedBy: [] });
        return {
          blockerId: blocker.itemId,
          inserted,
          listed,
          projected: await tx.harnessItems.read.byId(waiting.itemId),
          plain: await tx.harnessItems.read.byId(blocker.itemId),
        };
      });
      expect(read.inserted).toMatchObject({ epic: place, blockedBy: [read.blockerId] });
      expect(read.listed[0]).toMatchObject({ epic: place, blockedBy: [read.blockerId] });
      expect(read.projected).toMatchObject({ epic: place, blockedBy: [] });
      expect(read.plain).toMatchObject({ epic: null, blockedBy: [] });
    });
  });
}
```

Before relying on `0x7600`, run `grep -rn "0x76" packages/harness/port-contracts`; if a suite uses that block, take the next free block above the highest `seedHarness(tx, 0x…` in the directory.

`packages/harness/port-contracts/store.ts`: `import { describeStoreItemsEpic } from './store-items-epic.ts';` and `describeStoreItemsEpic(adapter, subject);` after the last `describeStore…` call.

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run sim/adapters/store.contract.test.ts`
Expected: FAIL, the inserted item reads `epic: null` and `blockedBy: []`.

- [ ] **Step 8: Bind the columns**

`packages/db/store/rows.ts`, in `toItemState` after `zulipTopic: row.zulipTopic,`:

```ts
    epic: row.epic,
    blockedBy: row.blockedBy,
```

(`itemStateSchema.parse` validates the jsonb.)

`packages/db/store/items.ts`, in `columnsOf` after `zulipTopic: item.zulipTopic,`:

```ts
    epic: item.epic,
    blockedBy: [...item.blockedBy],
```

- [ ] **Step 9: Run the Store contract on both adapters**

Run: `pnpm check && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/harness/port-contracts sim/adapters apps/uw-app/ports`
Expected: green; `store keeps an item's epic place and blockers` runs on the sim and the platform adapter.

- [ ] **Step 10: Commit**

```bash
git add packages/db/store packages/harness/port-contracts
git commit -m "feat(db): the Store reads and writes an item's epic place and blockers

The item gateway carries ItemState.epic and ItemState.blockedBy through
insert, project and every read; the Store contract proves it on the
embedded and the platform adapter.

EI-3. S18-R7."
```

---

### Task 4: The facts read the sub-issue list and the body's done-when and blockers (EI-1)

**Files:**
- Create: `packages/harness/github/issue-body.ts`, `packages/harness/github/issue-body.test.ts`
- Modify: `packages/harness/index.ts` (export the two parsers)
- Modify: `apps/uw-app/github/payloads.ts` (`issueSchema` gains `body`, `sub_issues_summary`, `repository_url`)
- Modify: `apps/uw-app/github/facts/records.ts` (`IssueRecord` and `IssueChange` gain `subIssues`, `doneWhen`, `blockedBy`)
- Modify: `apps/uw-app/github/facts/normalise.ts` (`issueOf` takes the repository; `subIssuesFromRest`)
- Create: `apps/uw-app/github/facts/issues.ts` (`lockedLabels`, `storedIssues` moved from `upsert.ts`; `issueChangeOf`)
- Modify: `apps/uw-app/github/facts/upsert.ts` (drop the two moved functions; three columns)
- Modify: `apps/uw-app/github/facts/queries.ts` (`issueByNumber`, `issuesAwaitingCrossReference` use `issueChangeOf`)
- Create: `apps/uw-app/github/facts/sub-issues.ts` (`recordSubIssues`)
- Modify: `apps/uw-app/github/client.ts` (`GitHubReads.subIssues`)
- Create: `apps/uw-app/github/sub-issues.ts` (`followSubIssues`)
- Modify: `apps/uw-app/github/follow-up.ts` (one line)
- Modify: `apps/uw-app/github/fixtures/issues-labeled.json`, `issues-unlabeled.json`, `rest-issues.json` (issue 12's body gains a done-when)
- Modify: `apps/uw-app/github/testing/facts-fixtures.ts` (`labelledIssue`), and every `IssueRecord` literal `pnpm check` flags (expect `apps/uw-app/commands/import.pg.test.ts`, `apps/uw-app/github/facts/upsert-race.pg.test.ts`)
- Modify: `apps/uw-app/github/facts/normalise.test.ts` (one block; the existing issue expectations gain the three fields)
- Create: `apps/uw-app/github/sub-issues.pg.test.ts`

**Interfaces:**
- Produces:
  - `doneWhenOf(markdown: string): readonly string[]` and `blockedByOf(markdown: string, repository: string): readonly number[]`, exported from `@uw/harness`
  - `IssueRecord` and `IssueChange` gain `readonly subIssues: number; readonly doneWhen: readonly string[]; readonly blockedBy: readonly number[]`
  - `subIssuesFromRest(repo: Pick<RepoRecord, 'githubId' | 'fullName'>, listed: readonly unknown[]): readonly IssueRecord[]`
  - `issueChangeOf(issue: typeof ghIssues.$inferSelect, repo: string, had: readonly string[] | null): IssueChange`
  - `recordSubIssues(db: Database, list: SubIssueList): Promise<number>` with `SubIssueList = { readonly repoId: number; readonly parentId: number; readonly children: readonly number[] }`
  - `GitHubReads.subIssues(repo: string, number: number): Promise<GitHubResult<List>>`
  - `followSubIssues(deps: GitHubDeps, changes: readonly IssueChange[], logger: Logger): Promise<void>`; log outcomes `sub_issues_recorded`, `sub_issues_not_read`, `github_not_configured`

- [ ] **Step 1: Write the failing parser tests**

`packages/harness/github/issue-body.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { blockedByOf, doneWhenOf } from './issue-body.ts';

const repository = 'unfoldingWord/uw-platform';

describe('EI-2 a done-when is a heading with at least one line under it', () => {
  it('reads the lines under a Done when heading, stripping list markers and checkboxes', () => {
    const body = [
      'Show the board.',
      '',
      '## Done when',
      '',
      '- The board lists every stage.',
      '* [ ] A card shows its holder.',
      '1. The lanes show their WIP.',
      '',
      '## Notes',
      'Not part of it.',
    ].join('\n');
    expect(doneWhenOf(body)).toEqual([
      'The board lists every stage.',
      'A card shows its holder.',
      'The lanes show their WIP.',
    ]);
  });

  it('accepts any case, any heading level and a trailing colon', () => {
    expect(doneWhenOf('### done WHEN:\nIt ships.')).toEqual(['It ships.']);
    expect(doneWhenOf('# Done when #\nIt ships.')).toEqual(['It ships.']);
  });

  it('finds none without a heading, under an empty heading, under a template comment or inside a fence', () => {
    expect(doneWhenOf('Show the board.')).toEqual([]);
    expect(doneWhenOf('**Done when:** it ships.')).toEqual([]);
    expect(doneWhenOf('## Done when\n\n## Notes\nIt ships.')).toEqual([]);
    expect(doneWhenOf('## Done when\n<!-- say what finished looks like -->\n')).toEqual([]);
    expect(doneWhenOf('```\n## Done when\nIt ships.\n```')).toEqual([]);
    expect(doneWhenOf('## Done when\n```\nIt ships.\n```')).toEqual([]);
  });

  it('bounds the lines and drops NUL characters', () => {
    const many = ['## Done when', ...Array.from({ length: 30 }, (_, n) => `- Line ${n}`)].join('\n');
    expect(doneWhenOf(many)).toHaveLength(20);
    expect(doneWhenOf(`## Done when\n- ${'x'.repeat(600)}`)[0]).toHaveLength(500);
    expect(doneWhenOf('## Done when\n- It\u0000 ships.')).toEqual(['It ships.']);
  });
});

describe('EI-3 blockers come from Blocked by lines naming this repository', () => {
  it('reads #N and owner/name#N for this repository, in any case, once each', () => {
    const body = [
      'Blocked by: #41, #42',
      '- **Blocked by:** unfoldingWord/UW-Platform#43 and #41',
      'blocked by: #44',
    ].join('\n');
    expect(blockedByOf(body, repository)).toEqual([41, 42, 43, 44]);
  });

  it('skips other repositories, struck references, fenced lines and lines that are not Blocked by', () => {
    const body = [
      'Blocked by: nextgen-chess/lasker-chessdata-service#33, ~~#45~~, #46',
      'Consumed by: #47',
      'See #48',
      '```',
      'Blocked by: #49',
      '```',
    ].join('\n');
    expect(blockedByOf(body, repository)).toEqual([46]);
  });

  it('finds none in an empty body', () => {
    expect(blockedByOf('', repository)).toEqual([]);
  });
});
```

Run: `npx vitest run packages/harness/github/issue-body.test.ts`
Expected: FAIL, `./issue-body.ts` not found.

- [ ] **Step 2: Write the parsers**

`packages/harness/github/issue-body.ts`:

```ts
type Line = { readonly text: string; readonly fenced: boolean };

const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/;
const DONE_WHEN = /^done when:?$/i;
const FENCE = /^ {0,3}(```|~~~)/;
const LIST_MARK = /^(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const CHECKBOX = /^\[[ xX]\][ \t]+/;
const COMMENT_ONLY = /^<!--.*-->$/;
const BLOCKED_BY = /^(?:[-*+][ \t]+)?(?:\*\*|__)?blocked by(?:\*\*|__)?[ \t]*:(?:\*\*|__)?(.*)$/i;
const STRUCK = /~~.*?~~/g;
const REFERENCE = /(?:^|[^\w/])(?:([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+))?#(\d{1,9})\b/g;
const LINE_LIMIT = 20;
const LENGTH_LIMIT = 500;
const BLOCKER_LIMIT = 50;

function marked(markdown: string): readonly Line[] {
  let fence: string | null = null;
  return markdown
    .replaceAll('\u0000', '')
    .split(/\r?\n/)
    .map((text) => {
      const opened = FENCE.exec(text)?.[1] ?? null;
      if (fence === null && opened !== null) {
        fence = opened;
        return { text, fenced: true };
      }
      if (fence !== null && opened === fence) fence = null;
      return { text, fenced: fence !== null || opened !== null };
    });
}

function headingText(line: Line): string | null {
  if (line.fenced) return null;
  return HEADING.exec(line.text)?.[1] ?? null;
}

function cleaned(text: string): string {
  return text.trim().replace(LIST_MARK, '').replace(CHECKBOX, '').trim().slice(0, LENGTH_LIMIT);
}

export function doneWhenOf(markdown: string): readonly string[] {
  const lines = marked(markdown);
  const start = lines.findIndex((line) => DONE_WHEN.test(headingText(line) ?? ''));
  if (start < 0) return [];
  const found: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (headingText(line) !== null || found.length === LINE_LIMIT) break;
    const text = cleaned(line.text);
    if (!line.fenced && text !== '' && !COMMENT_ONLY.test(text)) found.push(text);
  }
  return found;
}

function referencesIn(listed: string, repository: string): readonly number[] {
  const own = repository.toLowerCase();
  return [...listed.replace(STRUCK, ' ').matchAll(REFERENCE)]
    .filter((match) => match[1] === undefined || match[1].toLowerCase() === own)
    .map((match) => Number(match[2]))
    .filter((number) => number > 0);
}

export function blockedByOf(markdown: string, repository: string): readonly number[] {
  const found = new Set<number>();
  for (const line of marked(markdown)) {
    const listed = line.fenced ? undefined : BLOCKED_BY.exec(line.text.trim())?.[1];
    if (listed === undefined) continue;
    for (const number of referencesIn(listed, repository)) found.add(number);
  }
  return [...found].slice(0, BLOCKER_LIMIT);
}
```

`packages/harness/index.ts`, beside `parseReviewFindings`:

```ts
export { blockedByOf, doneWhenOf } from './github/issue-body.ts';
```

Run: `npx vitest run packages/harness/github/issue-body.test.ts`
Expected: PASS. If the `marked` closure trips the lint rule on mutation inside a callback, rewrite it as a `for … of` loop that pushes into an array; the tests decide.

- [ ] **Step 3: Write the failing facts tests**

In `apps/uw-app/github/facts/normalise.test.ts` (read the top first; reuse its `repo` record and the `issuesLabeled` fixture import, adding the import if absent):

```ts
describe('EI-1 the facts read sub-issues and the body facts intake needs', () => {
  it('reads the sub-issue count, the done-when lines and the blockers from an issue', () => {
    const issue = {
      ...issuesLabeled.issue,
      body: '## Done when\n- It ships.\n\nBlocked by: #11, other/repo#3',
      sub_issues_summary: { total: 3, completed: 1, percent_completed: 33 },
    };
    const batch = factsFromWebhook('issues', { ...issuesLabeled, issue });
    expect(batch.kind === 'facts' && batch.batch.issues[0]).toMatchObject({
      subIssues: 3,
      doneWhen: ['It ships.'],
      blockedBy: [11],
    });
  });

  it('reads an issue with no body and no summary as no sub-issues, no done-when, no blockers', () => {
    const issue = { ...issuesLabeled.issue, body: null };
    const batch = factsFromWebhook('issues', { ...issuesLabeled, issue });
    expect(batch.kind === 'facts' && batch.batch.issues[0]).toMatchObject({
      subIssues: 0,
      doneWhen: [],
      blockedBy: [],
    });
  });

  it('keeps only same-repository sub-issues, in the order GitHub lists them', () => {
    const child = (id: number, number: number, repository: string) => ({
      ...issuesLabeled.issue,
      id,
      number,
      body: '## Done when\n- It ships.',
      repository_url: `https://api.github.com/repos/${repository}`,
    });
    const listed = [
      child(9100000342, 42, 'unfoldingWord/uw-platform'),
      child(9100000999, 9, 'unfoldingWord/other'),
      child(9100000341, 41, 'UNFOLDINGWORD/UW-PLATFORM'),
    ];
    const records = subIssuesFromRest({ githubId: 9100000001, fullName: 'unfoldingWord/uw-platform' }, listed);
    expect(records.map((record) => record.number)).toEqual([42, 41]);
  });
});
```

Import `factsFromWebhook` and `subIssuesFromRest` from `./normalise.ts`. If `factsFromWebhook` takes other arguments in this file's existing tests, copy that call shape.

`apps/uw-app/github/sub-issues.pg.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { ghIssues } from '@uw/db/schema';
import type { GitHubAppConfig } from './app-config.ts';
import restIssues from './fixtures/rest-issues.json' with { type: 'json' };
import { fixtureApp } from './testing/app-key.ts';
import { firstRun, issuesOf, nextRun, platform, programmed, sweepOnce } from './testing/sweep-rig.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

const [labelled] = restIssues;
const subIssuesPath = `/repos/${platform}/issues/40/sub_issues`;

function issue(number: number, extra: Record<string, unknown> = {}) {
  return {
    ...labelled,
    id: 9100000300 + number,
    number,
    title: `Issue ${number}`,
    labels: [],
    body: `## Done when\n- Issue ${number} ships.`,
    repository_url: `https://api.github.com/repos/${platform}`,
    ...extra,
  };
}

function withEpic(children: readonly unknown[]) {
  const github = programmed();
  const epic = issue(40, { sub_issues_summary: { total: children.length, completed: 0 } });
  github.on('GET', issuesOf(platform), { status: 200, body: [...restIssues, epic] });
  github.on('GET', subIssuesPath, { status: 200, body: children });
  return github;
}

async function parents(db: Database) {
  const rows = await db
    .select({ number: ghIssues.number, parent: ghIssues.parentIssueId, place: ghIssues.parentPosition })
    .from(ghIssues);
  return rows
    .filter((row) => row.parent !== null)
    .sort((a, b) => (a.place ?? 0) - (b.place ?? 0))
    .map((row) => [row.number, row.parent, row.place]);
}

describe.skipIf(!testServer)('EI-1 the sweep reads an epic’s sub-issue list', () => {
  it('records each sub-issue with its parent and its place, and the epic’s count', () =>
    withAppDatabase(async (db) => {
      const children = [issue(42), issue(41), issue(43)];
      const { lines } = await sweepOnce(db, app, { github: withEpic(children), at: firstRun });
      expect(await parents(db)).toEqual([
        [42, 9100000340, 0],
        [41, 9100000340, 1],
        [43, 9100000340, 2],
      ]);
      const [epic] = await db.select().from(ghIssues).where(eq(ghIssues.githubId, 9100000340));
      expect(epic?.subIssues).toBe(3);
      expect(lines.some((line) => line['outcome'] === 'sub_issues_recorded')).toBe(true);
    }));

  it('clears the parent of a sub-issue the list no longer names', () =>
    withAppDatabase(async (db) => {
      await sweepOnce(db, app, { github: withEpic([issue(41), issue(42)]), at: firstRun });
      await sweepOnce(db, app, { github: withEpic([issue(42)]), at: nextRun });
      expect(await parents(db)).toEqual([[42, 9100000340, 0]]);
    }));

  it('does not record a sub-issue in another repository', () =>
    withAppDatabase(async (db) => {
      const foreign = issue(9, { id: 9100000999, repository_url: 'https://api.github.com/repos/unfoldingWord/other' });
      await sweepOnce(db, app, { github: withEpic([issue(41), foreign]), at: firstRun });
      expect(await parents(db)).toEqual([[41, 9100000340, 0]]);
    }));
});
```


Run: `npx vitest run apps/uw-app/github/facts/normalise.test.ts` and `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/github/sub-issues.pg.test.ts`
Expected: FAIL; the records carry no `subIssues` and nothing reads `sub_issues`.

- [ ] **Step 4: Records and payloads**

`apps/uw-app/github/payloads.ts`, in `issueSchema` after `pull_request`:

```ts
  body: z.string().nullable().optional(),
  sub_issues_summary: z.object({ total: z.number().int().min(0) }).nullable().optional(),
  repository_url: z.string().optional(),
```

`apps/uw-app/github/facts/records.ts`: `IssueRecord` and `IssueChange` both gain, after `githubUpdatedAt`:

```ts
  readonly subIssues: number;
  readonly doneWhen: readonly string[];
  readonly blockedBy: readonly number[];
```

- [ ] **Step 5: Normalise**

`apps/uw-app/github/facts/normalise.ts`: add `blockedByOf, doneWhenOf` to the `@uw/harness` import. Replace `issueOf`:

```ts
type RepoName = Pick<RepoRecord, 'githubId' | 'fullName'>;

function issueOf(repo: RepoName, issue: z.infer<typeof issueSchema>): IssueRecord {
  const body = issue.body ?? '';
  return {
    githubId: issue.id,
    repoId: repo.githubId,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    labels: issue.labels.map((label) => label.name),
    milestoneId: issue.milestone?.id ?? null,
    githubUpdatedAt: issue.updated_at,
    subIssues: issue.sub_issues_summary?.total ?? 0,
    doneWhen: doneWhenOf(body),
    blockedBy: blockedByOf(body, repo.fullName),
  };
}
```

Change its two callers: the `'issues'` reader to `issueOf(repo, issue)` and `issuesFromRest` to `.map((issue) => issueOf(repo, issue))`. Add at the end of the file:

```ts
function inRepository(repo: RepoName, issue: z.infer<typeof issueSchema>): boolean {
  const url = issue.repository_url?.toLowerCase() ?? '';
  return url.endsWith(`/repos/${repo.fullName.toLowerCase()}`);
}

export function subIssuesFromRest(
  repo: RepoName,
  listed: readonly unknown[],
): readonly IssueRecord[] {
  return eachParsed(issueSchema, listed)
    .filter((issue) => !issue.pull_request && inRepository(repo, issue))
    .map((issue) => issueOf(repo, issue));
}
```

- [ ] **Step 6: Move the issue readers out of `upsert.ts` and write the three columns**

Create `apps/uw-app/github/facts/issues.ts`:

```ts
import { asc, eq, inArray } from 'drizzle-orm';
import type { Transaction } from '@uw/db/client';
import { ghIssues, ghRepos } from '@uw/db/schema';
import type { IssueChange } from './records.ts';

type IssueRow = typeof ghIssues.$inferSelect;

export function issueChangeOf(
  issue: IssueRow,
  repo: string,
  had: readonly string[] | null,
): IssueChange {
  return {
    repo,
    githubId: issue.githubId,
    number: issue.number,
    title: issue.title,
    open: issue.state === 'open',
    labels: issue.labels,
    hadLabels: had,
    githubUpdatedAt: issue.githubUpdatedAt,
    subIssues: issue.subIssues,
    doneWhen: issue.doneWhen,
    blockedBy: issue.blockedBy,
  };
}

export async function lockedLabels(tx: Transaction, ids: readonly number[]) {
  if (ids.length === 0) return new Map<number, readonly string[]>();
  const rows = await tx
    .select({ githubId: ghIssues.githubId, labels: ghIssues.labels })
    .from(ghIssues)
    .where(inArray(ghIssues.githubId, [...ids]))
    .orderBy(asc(ghIssues.githubId))
    .for('update');
  return new Map(rows.map((row) => [row.githubId, row.labels]));
}

export async function storedIssues(
  tx: Transaction,
  ids: readonly number[],
  had: ReadonlyMap<number, readonly string[]>,
): Promise<readonly IssueChange[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ issue: ghIssues, repo: ghRepos.fullName })
    .from(ghIssues)
    .innerJoin(ghRepos, eq(ghRepos.githubId, ghIssues.repoId))
    .where(inArray(ghIssues.githubId, [...ids]))
    .orderBy(asc(ghIssues.githubId));
  return rows.map(({ issue, repo }) => issueChangeOf(issue, repo, had.get(issue.githubId) ?? null));
}
```

`apps/uw-app/github/facts/upsert.ts`: delete `lockedLabels` and `storedIssues` and the now-unused `IssueChange` type import; `import { lockedLabels, storedIssues } from './issues.ts';`. Add to `issueColumns` after `githubUpdatedAt`:

```ts
  subIssues: ghIssues.subIssues,
  doneWhen: ghIssues.doneWhen,
  blockedBy: ghIssues.blockedBy,
```

and in `upsertIssues` replace the values line with:

```ts
    .values(
      issues.map((issue) => ({
        ...issue,
        labels: [...issue.labels],
        doneWhen: [...issue.doneWhen],
        blockedBy: [...issue.blockedBy],
        freshAt,
      })),
    )
```

`parentIssueId` and `parentPosition` are deliberately not in `issueColumns`: an issue upsert never clears the place the sub-issue list gave it.

`apps/uw-app/github/facts/queries.ts`: `import { issueChangeOf } from './issues.ts';`; in `issueByNumber` replace the returned literal with `return issueChangeOf(row.issue, row.repo, null);` (drop the destructuring); in `issuesAwaitingCrossReference` replace the mapped literal with `rows.map(({ issue, repo }) => issueChangeOf(issue, repo, null))`.

Check: `grep -c . apps/uw-app/github/facts/upsert.ts` stays under 500 non-blank lines.

- [ ] **Step 7: The sub-issue writer**

`apps/uw-app/github/facts/sub-issues.ts`:

```ts
import { and, eq, notInArray } from 'drizzle-orm';
import { advisoryLock, githubRepoKey } from '@uw/db/advisory-locks';
import type { Database } from '@uw/db/client';
import { ghIssues } from '@uw/db/schema';

export type SubIssueList = {
  readonly repoId: number;
  readonly parentId: number;
  readonly children: readonly number[];
};

function droppedFrom(list: SubIssueList) {
  const ofParent = eq(ghIssues.parentIssueId, list.parentId);
  if (list.children.length === 0) return ofParent;
  return and(ofParent, notInArray(ghIssues.githubId, [...list.children]));
}

export function recordSubIssues(db: Database, list: SubIssueList): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(advisoryLock(githubRepoKey(list.repoId)));
    await tx
      .update(ghIssues)
      .set({ parentIssueId: null, parentPosition: null })
      .where(droppedFrom(list));
    let recorded = 0;
    for (const [position, githubId] of list.children.entries()) {
      const rows = await tx
        .update(ghIssues)
        .set({ parentIssueId: list.parentId, parentPosition: position })
        .where(and(eq(ghIssues.githubId, githubId), eq(ghIssues.repoId, list.repoId)))
        .returning({ githubId: ghIssues.githubId });
      recorded += rows.length;
    }
    return recorded;
  });
}
```

- [ ] **Step 8: The read and the follow**

`apps/uw-app/github/client.ts`: `GitHubReads` gains, after `issuesSince`:

```ts
  subIssues(repo: string, number: number): Promise<GitHubResult<List>>;
```

and `issueReads` gains:

```ts
    subIssues: (repo: string, number: number) =>
      refusedUnless(isCount(number), () =>
        whole(
          session,
          listOf(
            'GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
            { issue_number: number },
            repo,
          ),
        ),
      ),
```

Run `pnpm check`; add a `subIssues` member to any `GitHubReads` test double it flags (answer `{ ok: true, value: [] }`).

`apps/uw-app/github/sub-issues.ts`:

```ts
import type { Logger } from '@uw/core/log';
import type { GitHubReads } from './client.ts';
import type { GitHubDeps } from './deps.ts';
import { subIssuesFromRest } from './facts/normalise.ts';
import { repoByName } from './facts/queries.ts';
import { emptyBatch, type IssueChange } from './facts/records.ts';
import { recordSubIssues } from './facts/sub-issues.ts';
import { upsertFacts } from './facts/upsert.ts';

async function followOne(
  deps: GitHubDeps,
  reads: GitHubReads,
  change: IssueChange,
  logger: Logger,
): Promise<void> {
  const fields = { repository: change.repo, issue: change.number };
  const repo = await repoByName(deps.db, change.repo);
  if (repo === null) return;
  const listed = await reads.subIssues(change.repo, change.number);
  if (!listed.ok) {
    const { failure, status } = listed;
    logger.warn('sub-issues not read', { outcome: 'sub_issues_not_read', ...fields, failure, status });
    return;
  }
  const children = subIssuesFromRest({ githubId: repo.githubId, fullName: change.repo }, listed.value);
  await upsertFacts(deps.db, { ...emptyBatch, issues: children }, deps.now());
  const recorded = await recordSubIssues(deps.db, {
    repoId: repo.githubId,
    parentId: change.githubId,
    children: children.map((child) => child.githubId),
  });
  logger.info('sub-issues recorded', {
    outcome: 'sub_issues_recorded',
    ...fields,
    listed: listed.value.length,
    recorded,
  });
}

export async function followSubIssues(
  deps: GitHubDeps,
  changes: readonly IssueChange[],
  logger: Logger,
): Promise<void> {
  const epics = changes.filter((change) => change.subIssues > 0);
  if (epics.length === 0) return;
  if (deps.client === null) {
    logger.warn('sub-issues not read: GitHub is not configured', { outcome: 'github_not_configured' });
    return;
  }
  const reads = deps.client.reads();
  for (const change of epics) await followOne(deps, reads, change, logger);
}
```

`apps/uw-app/github/follow-up.ts`: `import { followSubIssues } from './sub-issues.ts';` and as the last line of `followUpserts`: `await followSubIssues(unit, report.issues, logger);`. The sweep, the webhook and the import command all pass through `followUpserts`, so all three read the list; `sweep.ts` is unchanged. The children's upsert does not call `followUpserts`, so a sub-issue's own sub-issues are not read through its parent (S18-R4).

- [ ] **Step 9: Give the labelled fixtures a done-when**

In `apps/uw-app/github/fixtures/issues-labeled.json`, `issues-unlabeled.json` and `rest-issues.json`, change issue 12's `"body": "The board."` to `"body": "The board.\n\n## Done when\n\n- The board lists every stage."`. In `apps/uw-app/github/testing/facts-fixtures.ts`, `labelledIssue` gains:

```ts
  subIssues: 0,
  doneWhen: ['The board lists every stage.'],
  blockedBy: [],
```

Run `pnpm check` and add the same three fields (with `doneWhen: ['The board lists every stage.']`) to each `IssueRecord` literal it flags. In `normalise.test.ts`, existing `toEqual` expectations on issue records gain `subIssues: 0, doneWhen: ['The board lists every stage.'], blockedBy: []` for issue 12 and `subIssues: 0, doneWhen: [], blockedBy: []` for an issue whose body is absent.

- [ ] **Step 10: Run the tests and the GitHub suite**

Run: `pnpm check && npx vitest run packages/harness/github apps/uw-app/github/facts/normalise.test.ts && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/github`
Expected: green, including the sweep, ingest, import and upsert suites and the new `EI-1` tests.

- [ ] **Step 11: Commit**

```bash
git add packages/harness/github/issue-body.ts packages/harness/github/issue-body.test.ts packages/harness/index.ts apps/uw-app/github apps/uw-app/commands/import.pg.test.ts
git commit -m "feat(github): the facts read each epic's sub-issue list and the body's done-when and blockers

Every issue upsert reads the sub-issue count and parses the done-when lines
and the same-repository Blocked by references; an issue with sub-issues has
its list read after the upsert, on the webhook, the sweep and the import
command alike, and each same-repository sub-issue records its parent and
place. The two issue readers move out of upsert.ts to make room.

EI-1. S18-R1 S18-R2 S18-R3 S18-R4."
```

---

### Task 5: The epic read through the GitHub facts port (shared root `packages/harness/ports.ts`)

**Files:**
- Modify: `packages/harness/ports.ts` (`IssueKey`, `IssueFact`, `EpicFacts`, `GitHubFacts.epic`)
- Modify: `packages/harness/port-contracts/github-facts.ts` (subject `givenEpic`; epic cases; the not-wired record)
- Modify: `sim/adapters/github-facts.ts`, `sim/adapters/github-facts.contract.test.ts`
- Create: `apps/uw-app/github/facts/epics.ts` (`epicFacts`)
- Modify: `apps/uw-app/ports/github-facts.ts`, `apps/uw-app/ports/github-facts.not-wired.ts`, `apps/uw-app/ports/github-facts.contract.pg.test.ts`
- Modify: `apps/uw-app/testing/kernel.ts` (`fixedFacts` gains `epic`; `answeringEpic`)
- Modify: every `GitHubFacts` literal `pnpm check` flags (expect `apps/uw-app/testing/run-host.ts`, `sim/kernel/adopt-branch.test.ts`, `sim/kernel/ship-refresh.test.ts`, `sim/kernel/gate-view.test.ts`)

**Interfaces:**
- Consumes: Task 4's columns and `recordSubIssues`, `upsertFacts`, `IssueRecord`.
- Produces:
  - `IssueKey = { readonly repo: string; readonly number: number }`
  - `IssueFact = { readonly issue: IssueRef; readonly title: string; readonly open: boolean; readonly doneWhen: readonly string[]; readonly blockedBy: readonly number[] }`
  - `EpicFacts = { readonly epic: IssueFact; readonly subIssueCount: number; readonly subIssues: readonly IssueFact[] }` (sub-issues in sub-issue order)
  - `GitHubFacts.epic(key: IssueKey): Promise<EpicFacts | null>`
  - sim `SimGitHubFacts.givenEpic(epic: EpicFacts): void`; `answeringEpic(epic: EpicFacts | null): GitHubFacts`

- [ ] **Step 1: Change the port (shared-root commit)**

`packages/harness/ports.ts`: add `IssueRef` to the `@uw/contracts` import; below `DiffRead`:

```ts
export type IssueKey = { readonly repo: string; readonly number: number };
export type IssueFact = {
  readonly issue: IssueRef;
  readonly title: string;
  readonly open: boolean;
  readonly doneWhen: readonly string[];
  readonly blockedBy: readonly number[];
};
export type EpicFacts = {
  readonly epic: IssueFact;
  readonly subIssueCount: number;
  readonly subIssues: readonly IssueFact[];
};
```

and in `GitHubFacts`, after `diff`:

```ts
  epic(key: IssueKey): Promise<EpicFacts | null>;
```

Run: `pnpm check`
Expected: FAIL only where a `GitHubFacts` is built. Commit the port alone:

```bash
git add packages/harness/ports.ts
git commit -m "feat(harness): the GitHub facts port reads an epic

Shared root packages/harness/ports.ts. GitHubFacts.epic answers an issue's
facts, GitHub's sub-issue count and its recorded sub-issues in order, from
the read model. The contract suite and every adapter follow in the next
commit (AGENTS rule 1, new port method).

EI-3. S18-R8."
```

(`pnpm check` is red until Step 6.)

- [ ] **Step 2: The contract cases**

`packages/harness/port-contracts/github-facts.ts`: import `EpicFacts, IssueFact` from `../ports.ts`; `GithubFactsSubject` gains `givenEpic(epic: EpicFacts): Promise<void>;`. Add:

```ts
function issueFact(number: number, options: Partial<IssueFact> = {}): IssueFact {
  return {
    issue: { repo: 'unfoldingWord/uw-platform', number, githubId: 9100000300 + number },
    title: `Issue ${number}`,
    open: true,
    doneWhen: [`Issue ${number} ships.`],
    blockedBy: [],
    ...options,
  };
}

function epicOf(subIssues: readonly IssueFact[], number = 40): EpicFacts {
  return {
    epic: issueFact(number, { doneWhen: [] }),
    subIssueCount: subIssues.length,
    subIssues,
  };
}

function epicCases(open: () => Promise<GithubFactsSubject>): void {
  it('EI-3 answers null for an issue it has no facts for', async () => {
    const subject = await open();
    expect(await subject.facts.epic({ repo: 'unfoldingWord/uw-platform', number: 404 })).toBeNull();
  });

  it('EI-3 answers an epic with its sub-issues in order, their done-whens and blockers', async () => {
    const subject = await open();
    const known = epicOf([
      issueFact(42),
      issueFact(41, { blockedBy: [42] }),
      issueFact(43, { open: false, doneWhen: [] }),
    ]);
    await subject.givenEpic(known);
    expect(await subject.facts.epic({ repo: 'UNFOLDINGWORD/uw-platform', number: 40 })).toEqual(known);
  });

  it('EI-3 answers an issue with no sub-issues as an epic of none', async () => {
    const subject = await open();
    const lone = epicOf([], 50);
    await subject.givenEpic(lone);
    expect(await subject.facts.epic({ repo: 'unfoldingWord/uw-platform', number: 50 })).toEqual(lone);
  });

  it('EI-3 answers the latest list after a sub-issue leaves the epic', async () => {
    const subject = await open();
    await subject.givenEpic(epicOf([issueFact(61), issueFact(62)], 60));
    const shrunk = epicOf([issueFact(62)], 60);
    await subject.givenEpic(shrunk);
    expect(await subject.facts.epic({ repo: 'unfoldingWord/uw-platform', number: 60 })).toEqual(shrunk);
  });
}
```

Call `epicCases(open);` inside `describeGithubFactsContract` after `defaultBranchCases(open);`. In `describeGithubFactsNotWired`, add `epic: true,` to the record.

- [ ] **Step 3: The sim adapter**

`sim/adapters/github-facts.ts`: import `EpicFacts, IssueKey` from `@uw/harness`; `SimGitHubFacts` gains `givenEpic(epic: EpicFacts): void;`. Add `const issueKeyOf = (key: IssueKey): string => \`${key.repo.toLowerCase()}#${key.number}\`;` and in `createSimGitHubFacts` a `const epics = new Map<string, EpicFacts>();` with:

```ts
    epic: async (key) => {
      const found = epics.get(issueKeyOf(key));
      return found ? structuredClone(found) : null;
    },
    givenEpic: (epic) => {
      epics.set(issueKeyOf(epic.epic.issue), structuredClone(epic));
    },
```

`sim/adapters/github-facts.contract.test.ts`: the subject gains `givenEpic: async (epic) => facts.givenEpic(epic),`.

- [ ] **Step 4: The platform adapter**

`apps/uw-app/github/facts/epics.ts`:

```ts
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Executor } from '@uw/db/client';
import { ghIssues, ghRepos } from '@uw/db/schema';
import type { EpicFacts, IssueFact, IssueKey } from '@uw/harness';

type IssueRow = typeof ghIssues.$inferSelect;

function factOf(row: IssueRow, repo: string): IssueFact {
  return {
    issue: { repo, number: row.number, githubId: row.githubId },
    title: row.title,
    open: row.state === 'open',
    doneWhen: row.doneWhen,
    blockedBy: row.blockedBy,
  };
}

export async function epicFacts(db: Executor, key: IssueKey): Promise<EpicFacts | null> {
  const [found] = await db
    .select({ issue: ghIssues, repo: ghRepos.fullName })
    .from(ghIssues)
    .innerJoin(ghRepos, eq(ghRepos.githubId, ghIssues.repoId))
    .where(and(sql`lower(${ghRepos.fullName}) = lower(${key.repo})`, eq(ghIssues.number, key.number)))
    .limit(1);
  if (found === undefined) return null;
  const children = await db
    .select()
    .from(ghIssues)
    .where(eq(ghIssues.parentIssueId, found.issue.githubId))
    .orderBy(asc(ghIssues.parentPosition), asc(ghIssues.githubId));
  return {
    epic: factOf(found.issue, found.repo),
    subIssueCount: found.issue.subIssues,
    subIssues: children.map((row) => factOf(row, found.repo)),
  };
}
```

`apps/uw-app/ports/github-facts.ts`: `import { epicFacts } from '../github/facts/epics.ts';` and `epic: (key) => epicFacts(db, key),`.

`apps/uw-app/ports/github-facts.not-wired.ts`: `epic: () => notWiredCall('githubFacts', 'epic'),`.

`apps/uw-app/ports/github-facts.contract.pg.test.ts`: import `IssueFact, EpicFacts` from `@uw/harness`, `emptyBatch, type IssueRecord` from `../github/facts/records.ts`, `recordSubIssues` from `../github/facts/sub-issues.ts`; add:

```ts
function issueRecord(fact: IssueFact, repoId: number, subIssues: number, at: Date): IssueRecord {
  return {
    githubId: fact.issue.githubId,
    repoId,
    number: fact.issue.number,
    title: fact.title,
    state: fact.open ? 'open' : 'closed',
    labels: [],
    milestoneId: null,
    githubUpdatedAt: at,
    subIssues,
    doneWhen: [...fact.doneWhen],
    blockedBy: [...fact.blockedBy],
  };
}

async function givenEpic(db: Database, epic: EpicFacts): Promise<void> {
  updates += 1;
  const at = new Date(Date.UTC(2026, 9, 1, 8, updates));
  const fullName = epic.epic.issue.repo;
  const repoId = idFor(repoIds, fullName.toLowerCase(), 9100000001);
  const repo = { githubId: repoId, fullName, defaultBranch: 'main', private: true };
  const issues = [
    issueRecord(epic.epic, repoId, epic.subIssueCount, at),
    ...epic.subIssues.map((fact) => issueRecord(fact, repoId, 0, at)),
  ];
  await upsertFacts(db, { ...emptyBatch, repos: [repo], issues }, at);
  await recordSubIssues(db, {
    repoId,
    parentId: epic.epic.issue.githubId,
    children: epic.subIssues.map((fact) => fact.issue.githubId),
  });
}
```

and the subject gains `givenEpic: (epic) => givenEpic(db, epic),`.

`apps/uw-app/testing/kernel.ts`: `fixedFacts` gains `epic: async () => null,`; add:

```ts
export function answeringEpic(epic: EpicFacts | null): GitHubFacts {
  return {
    pullRequest: async () => null,
    refresh: async () => null,
    diff: () => notWiredCall('githubFacts', 'diff'),
    epic: async () => epic,
  };
}
```

(import `EpicFacts` with the other `@uw/harness` types).

- [ ] **Step 5: Fill the other literals**

Run `pnpm check`; add `epic: async () => null,` to each remaining `GitHubFacts` object literal it flags.

- [ ] **Step 6: Run the contract on every adapter**

Run: `pnpm check && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run sim/adapters apps/uw-app/ports tools/architecture/port-contracts.test.ts`
Expected: green; the four `EI-3` epic cases run on the sim and the platform adapter, and the not-wired suite covers `epic`.

- [ ] **Step 7: Commit**

```bash
git add packages/harness/port-contracts sim/adapters apps/uw-app/github/facts/epics.ts apps/uw-app/ports apps/uw-app/testing sim/kernel
git commit -m "feat(github): the epic read on every GitHub facts adapter, under the port contract

The sim answers what it was given; the platform adapter reads gh_issues for
the issue, its sub-issue count and its sub-issues in place order; the
not-wired adapter refuses. The port contract runs the epic cases on both.

EI-3. S18-R8."
```

---

### Task 6: Done-when is required at intake (EI-2)

**Files:**
- Create: `packages/harness/items/not-ready.ts`
- Modify: `packages/harness/items/import.ts` (`ImportIssueInput.doneWhen`; refuse and record)
- Modify: `packages/harness/items/commands.ts` (`recordNotReady`)
- Modify: `packages/harness/index.ts` (types `NotReadyInput`, `NotReadySubject`)
- Modify: `apps/uw-app/github/import.ts` (`importStoredIssue`: epics and missing done-whens)
- Modify: `apps/uw-app/commands/handlers/items.ts` (`kickstartCommand`)
- Modify: callers of `kernel.items.importIssue` (add `doneWhen`): `sim/scenarios/GH-3.a-labelled-issue-becomes-one-item.ts`, `sim/kernel/import.test.ts`, `sim/topics.ts`, `apps/uw-app/harness/import-race.pg.test.ts`, `apps/uw-app/harness/lock-after-move.pg.test.ts`
- Modify: kickstart tests whose product page has no done-when: `apps/uw-app/commands/items.pg.test.ts`, `apps/uw-app/commands/retaken.pg.test.ts` (and any other `kickstart` test `grep -rln "kickstart" apps --include=*.pg.test.ts` finds)
- Create: `sim/kernel/not-ready.test.ts`
- Modify: `apps/uw-app/github/import.pg.test.ts` (one block), `apps/uw-app/commands/items.pg.test.ts` (one test)

**Interfaces:**
- Consumes: Task 2's `done_when_missing`, `IntakeVia`; Task 4's `IssueChange.doneWhen`, `IssueChange.subIssues`, `doneWhenOf`.
- Produces:
  - `NotReadySubject = { readonly via: IntakeVia; readonly issue: IssueRef | null; readonly pageId: string | null; readonly title: string }`, `NotReadyInput = NotReadySubject & { readonly harnessId: string }`
  - `recordNotReadyIn(tx: StoreTransaction, context: RecordContext, harnessId: string, subject: NotReadySubject): Promise<boolean>` (true when it appended)
  - `notReadyRefusal(subject: NotReadySubject): Refused`
  - `intakeWriter(ports: Pick<Ports, 'grants'>, tx: StoreTransaction, actor: Principal, harness: Harness, at: Date): Promise<boolean>`
  - `ItemCommands.recordNotReady(caller: Caller, input: NotReadyInput): Promise<KernelOutcome<never>>`
  - `ImportIssueInput` gains `readonly doneWhen: readonly string[]`
  - log outcomes `issue_is_epic`, `issue_not_ready`

- [ ] **Step 1: Write the failing kernel tests**

`sim/kernel/not-ready.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simIngest, simPerson } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const DAY_MS = 86_400_000;
const issue = { repo: 'unfoldingWord/uw-platform', number: 12, githubId: 9100000012 };

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

async function missing(world: World, harnessId: string) {
  const events = await world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, null));
  return events.filter((event) => event.name === 'done_when_missing');
}

function importWithout(world: World, harnessId: string, doneWhen: readonly string[] = []) {
  return world.kernel.items.importIssue(simCaller(world, simIngest()), {
    harnessId,
    issue,
    title: 'Wire the board',
    pageId: null,
    doneWhen,
  });
}

describe('EI-2 intake refuses an issue without a done-when and records it on the harness', () => {
  it('refuses an import done_when_missing and records the refusal once a day', () =>
    inWorld(async (world) => {
      const { harness } = await createSimHarness(world, software);
      expect(reasonOf(await importWithout(world, harness.id))).toBe('done_when_missing');
      expect(reasonOf(await importWithout(world, harness.id))).toBe('done_when_missing');
      const recorded = await missing(world, harness.id);
      expect(recorded.map((event) => [event.itemId, event.evidence])).toEqual([
        [null, { via: 'import', issue, pageId: null, title: 'Wire the board' }],
      ]);
      world.adapters.clock.advance(DAY_MS + 1);
      expect(reasonOf(await importWithout(world, harness.id))).toBe('done_when_missing');
      expect(await missing(world, harness.id)).toHaveLength(2);
    }));

  it('imports once a done-when is there, and never checks an imported issue again', () =>
    inWorld(async (world) => {
      const { harness } = await createSimHarness(world, software);
      const first = value(await importWithout(world, harness.id, ['The board lists every stage.']));
      expect(first.created).toBe(true);
      const again = value(await importWithout(world, harness.id));
      expect(again).toEqual({ item: first.item, created: false });
      expect(await missing(world, harness.id)).toHaveLength(0);
    }));

  it('records a kickstart refusal against the page, for a person with write, and refuses an agent', () =>
    inWorld(async (world) => {
      const { harness } = await createSimHarness(world, software);
      const editor = await simPerson(world, 2, [{ role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' }]);
      const pageId = '00000000-0000-4000-8000-000000003101';
      const input = { harnessId: harness.id, via: 'kickstart' as const, issue: null, pageId, title: 'Show the board' };
      expect(reasonOf(await world.kernel.items.recordNotReady(simCaller(world, editor), input))).toBe(
        'done_when_missing',
      );
      const agent = simAgent(editor, `${editor.personId}/builder`, { interactive: true });
      expect(reasonOf(await world.kernel.items.recordNotReady(simCaller(world, agent), input))).toBe(
        'not_permitted',
      );
      const both = { ...input, issue };
      expect(reasonOf(await world.kernel.items.recordNotReady(simCaller(world, editor), both))).toBe(
        'malformed_command',
      );
      expect((await missing(world, harness.id)).map((event) => event.evidence)).toEqual([
        { via: 'kickstart', issue: null, pageId, title: 'Show the board' },
      ]);
    }));
});
```

If the sim clock's method to move time is not `advance` (read `sim/adapters/clock.ts`), use the name it has.

Run: `npx vitest run sim/kernel/not-ready.test.ts`
Expected: FAIL; `doneWhen` is not an import input and `recordNotReady` does not exist.

- [ ] **Step 2: The not-ready recorder**

`packages/harness/items/not-ready.ts`:

```ts
import {
  eventEvidenceSchemas,
  type Harness,
  type HarnessEvent,
  type IntakeVia,
  type IssueRef,
  type Principal,
} from '@uw/contracts';
import { allowed, isAgent, isIngestPrincipal, isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { refused, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { draft, recordContext, recordHarnessEvents, type RecordContext } from './record.ts';

type NotReadyPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type NotReadySubject = {
  readonly via: IntakeVia;
  readonly issue: IssueRef | null;
  readonly pageId: string | null;
  readonly title: string;
};
export type NotReadyInput = NotReadySubject & { readonly harnessId: string };

const DAY_MS = 86_400_000;
const RECENT_LIMIT = 500;
const TITLE_LIMIT = 200;

export async function intakeWriter(
  ports: Pick<Ports, 'grants'>,
  tx: StoreTransaction,
  actor: Principal,
  harness: Harness,
  at: Date,
): Promise<boolean> {
  if (isIngestPrincipal(actor) || isSystemPrincipal(actor)) return true;
  if (isAgent(actor) || actor.personId === null) return false;
  const grants = await ports.grants.resolveIn(tx, actor.personId, at);
  return allowed({ ...actor, grants: [...grants] }, 'write', harness, at);
}

function titled(subject: NotReadySubject): string {
  const trimmed = subject.title.trim().slice(0, TITLE_LIMIT);
  if (trimmed !== '') return trimmed;
  return subject.issue === null ? 'Untitled page' : `${subject.issue.repo}#${subject.issue.number}`;
}

function sameSubject(event: HarnessEvent, subject: NotReadySubject): boolean {
  const parsed = eventEvidenceSchemas.done_when_missing.safeParse(event.evidence);
  if (!parsed.success) return false;
  if (subject.issue !== null) return parsed.data.issue?.githubId === subject.issue.githubId;
  return parsed.data.pageId === subject.pageId;
}

export async function recordNotReadyIn(
  tx: StoreTransaction,
  context: RecordContext,
  harnessId: string,
  subject: NotReadySubject,
): Promise<boolean> {
  const recent = await tx.harnessEvents.read.recent({
    since: new Date(context.at.getTime() - DAY_MS),
    names: ['done_when_missing'],
    agentsOnly: false,
    limit: RECENT_LIMIT,
    harnessIds: [harnessId],
  });
  if (recent.some((event) => sameSubject(event, subject))) return false;
  const evidence = { via: subject.via, issue: subject.issue, pageId: subject.pageId, title: titled(subject) };
  await recordHarnessEvents(tx, context, harnessId, [draft('done_when_missing', evidence)]);
  return true;
}

export function notReadyRefusal(subject: NotReadySubject): Refused {
  if (subject.issue === null) return refused('done_when_missing', { pageId: subject.pageId });
  return refused('done_when_missing', { issue: subject.issue.number });
}

export async function recordNotReady(
  ports: NotReadyPorts,
  caller: Caller,
  input: NotReadyInput,
): Promise<Refused> {
  const { harnessId, ...subject } = input;
  if ((subject.issue === null) === (subject.pageId === null)) {
    return refused('malformed_command', { field: 'subject' });
  }
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    const harness = await tx.harnesses.read.byId(harnessId);
    if (harness === null) return refused('harness_not_found', { harnessId });
    if (!(await intakeWriter(ports, tx, caller.actor, harness, at))) {
      return refused('not_permitted', { harnessId });
    }
    await recordNotReadyIn(tx, recordContext(ports, caller, at), harness.id, subject);
    return notReadyRefusal(subject);
  });
}
```

If `isSystemPrincipal` lives elsewhere than `../access.ts`, import it from where `items/import.ts` does.

- [ ] **Step 3: Import refuses without a done-when**

`packages/harness/items/import.ts`: `ImportIssueInput` gains `readonly doneWhen: readonly string[];`. `import { notReadyRefusal, recordNotReadyIn } from './not-ready.ts';`. In `importIssue`'s transaction, move `const context = recordContext(ports, caller, at);` up to just after the permission check, and after `if (existing !== null) return accepted({ item: existing, created: false });` add:

```ts
    if (input.doneWhen.length === 0) {
      const subject = { via: 'import' as const, issue, pageId: null, title: input.title };
      await recordNotReadyIn(tx, context, harness.id, subject);
      return notReadyRefusal(subject);
    }
```

If the callback passes 25 statements, move the lines from `const existing` to the end into `async function importNew(tx, context, harness, input)`.

`packages/harness/items/commands.ts`: import `recordNotReady, type NotReadyInput` from `./not-ready.ts`; `ItemCommands` gains `recordNotReady(caller: Caller, input: NotReadyInput): Promise<KernelOutcome<never>>;`; `createItemCommands` gains `recordNotReady: (caller, input) => recordNotReady(ports, caller, input),`.

`packages/harness/index.ts`: `export type { NotReadyInput, NotReadySubject } from './items/not-ready.ts';`.

Add `doneWhen: ['The board lists every stage.']` to each `importIssue` call in `sim/scenarios/GH-3.a-labelled-issue-becomes-one-item.ts`, `sim/kernel/import.test.ts`, `sim/topics.ts`, `apps/uw-app/harness/import-race.pg.test.ts` and `apps/uw-app/harness/lock-after-move.pg.test.ts`. GH-3's `item_created` key assertion is unchanged (the evidence does not carry the done-when).

Run: `npx vitest run sim/kernel/not-ready.test.ts sim/kernel/import.test.ts && pnpm sim -- GH-3`
Expected: green.

- [ ] **Step 4: Write the failing app tests**

In `apps/uw-app/github/import.pg.test.ts` (read the file first; reuse its rig: the harness it activates, `deliver` or `depsOn` from `testing/import-rig.ts`, its logger lines and its item count helper):

```ts
describe.skipIf(!testServer)('EI-2 a labelled issue needs a done-when to be imported', () => {
  it('logs issue_not_ready, imports nothing, and records done_when_missing once', () =>
    withAppDatabase(async (db) => {
      const harnessId = await softwareHarnessOn(db);
      const bare = { ...issuesLabeled, issue: { ...issuesLabeled.issue, body: 'The board.' } };
      const first = await deliver(db, app, 'issues', bare);
      await deliver(db, app, 'issues', bare);
      expect(first.lines.some((line) => line['outcome'] === 'issue_not_ready')).toBe(true);
      expect(await itemsWithIssues(db)).toBe(0);
      expect(await eventsNamed(db, harnessId, 'done_when_missing')).toHaveLength(1);
    }));

  it('logs issue_is_epic and imports nothing for a labelled issue with sub-issues', () =>
    withAppDatabase(async (db) => {
      await softwareHarnessOn(db);
      const epic = {
        ...issuesLabeled,
        issue: { ...issuesLabeled.issue, sub_issues_summary: { total: 2, completed: 0 } },
      };
      const { lines } = await deliver(db, app, 'issues', epic);
      expect(lines.some((line) => line['outcome'] === 'issue_is_epic')).toBe(true);
      expect(await itemsWithIssues(db)).toBe(0);
    }));
});
```

`softwareHarnessOn`, `deliver` and `itemsWithIssues` stand for whatever the file already calls its harness activation, its webhook delivery and its item count: use those names, and add a three-line `itemsWithIssues` (`SELECT count(*)::int FROM harness_items WHERE issue_github_id IS NOT NULL`) only if none exists. `eventsNamed` comes from `../testing/commands.ts`. The delivery with an epic reaches GitHub for the sub-issue list; if the rig's fixture GitHub answers an unprogrammed path with an error, that is logged as `sub_issues_not_read` and does not affect the assertion.

In `apps/uw-app/commands/items.pg.test.ts`, beside the existing kickstart test (copy its seeding of a product page and its `command(...)` call):

```ts
  it('EI-2 kickstart refuses a product page with no done-when and records it against the page', () =>
    withAppDatabase(async (db) => {
      const { harnessId, editor } = await softwareHarness(db);
      const pageId = await productPage(db, 'People see their harness as a board of stages.');
      const sent = await command(db, editor, harnessId, 'kickstart', { requestId: randomUUID(), pageId });
      expect(sent.body).toMatchObject({ status: 'error', reason: 'done_when_missing' });
      const [recorded] = await eventsNamed(db, harnessId, 'done_when_missing');
      expect(recorded?.evidence).toMatchObject({ via: 'kickstart', issue: null, pageId });
    }));
```

where `productPage(db, bodyMd)` is the file's existing product-page seed, given the body as a parameter (extract it if the body is inline).

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/github/import.pg.test.ts apps/uw-app/commands/items.pg.test.ts`
Expected: FAIL; the bare issue imports and kickstart enqueues.

- [ ] **Step 5: The app's intake checks**

`apps/uw-app/github/import.ts`: replace `importStoredIssue` with the version below and add the two helpers above it.

```ts
type Fields = Readonly<Record<string, string | number>>;

async function intakeRefusal(
  deps: GitHubDeps,
  caller: Caller,
  change: IssueChange,
  harnessId: string,
): Promise<'issue_is_epic' | 'issue_not_ready' | null> {
  if (change.subIssues > 0) return 'issue_is_epic';
  if (change.doneWhen.length > 0) return null;
  await deps.kernel.items.recordNotReady(caller, {
    harnessId,
    via: 'import',
    issue: issueOf(change),
    pageId: null,
    title: boundedTitle(change.title, `${change.repo}#${change.number}`),
  });
  return 'issue_not_ready';
}

async function importAdmitted(
  deps: GitHubDeps,
  caller: Caller,
  change: IssueChange,
  target: { readonly harnessId: string; readonly jdArea: JdArea },
  log: { readonly logger: Logger; readonly fields: Fields },
) {
  const { logger, fields } = log;
  const page = await wrapPage(deps, caller, change, target.jdArea);
  if (!page.ok) {
    logger.warn('issue not imported: its page slug is taken', { outcome: 'issue_page_slug_taken', ...fields });
    return { ok: false as const, reason: 'slug_taken' as const };
  }
  const imported = await deps.kernel.items.importIssue(caller, {
    harnessId: target.harnessId,
    issue: issueOf(change),
    title: boundedTitle(change.title, `${change.repo}#${change.number}`),
    pageId: page.pageId,
    doneWhen: change.doneWhen,
  });
  return { ok: true as const, page, imported };
}

export async function importStoredIssue(
  deps: GitHubDeps,
  caller: Caller,
  change: IssueChange,
  logger: Logger,
  timing: CrossReferenceTiming,
): Promise<ImportResult> {
  const fields = { repository: change.repo, issue: change.number, importer: caller.actor.kind };
  const target = await deps.kernel.reads.importTarget(caller, { repository: change.repo });
  if (target.status !== 'accepted') {
    logger.info('issue not imported: no import target', { outcome: refusedTarget(caller), ...fields });
    return { ok: false, reason: 'not_permitted' };
  }
  const intake = await intakeRefusal(deps, caller, change, target.value.harnessId);
  if (intake !== null) {
    logger.info('issue not imported: intake refused it', { outcome: intake, ...fields });
    return { ok: false, reason: intake === 'issue_is_epic' ? 'not_permitted' : 'done_when_missing' };
  }
  const admitted = await importAdmitted(deps, caller, change, target.value, { logger, fields });
  if (!admitted.ok) return admitted;
  const { page, imported } = admitted;
  if (imported.status !== 'accepted') {
    const { reason } = imported;
    logger.warn('issue not imported', { outcome: 'issue_not_imported', ...fields, reason });
    return { ok: false, reason };
  }
  const { item, created } = imported.value;
  logger.info('issue imported', { outcome: created ? 'issue_imported' : 'issue_already_imported', ...fields });
  await crossReference(deps, change, { itemId: item.itemId, pageCreatedAt: page.createdAt }, timing, logger);
  return { ok: true, created };
}
```

Keep the existing `crossReference`, `wrapPage`, `issueOf`, `refusedTarget` and `CrossReferenceTiming` unchanged. If `wrapPage`'s result type does not narrow through `admitted.ok`, give `importAdmitted` an explicit return type union. Prettier will wrap the long lines.

`apps/uw-app/commands/handlers/items.ts`: `import { doneWhenOf } from '@uw/harness';`. In `kickstartCommand.run`, after the page type and area check (and after step 14's `template_has_no_package` check), before the enqueue:

```ts
    const title = page.title.slice(0, 200);
    if (doneWhenOf(page.bodyMd).length === 0) {
      return fromKernel(
        await context.kernel.items.recordNotReady(context.caller, {
          harnessId: context.harnessId,
          via: 'kickstart',
          issue: null,
          pageId: page.id,
          title,
        }),
      );
    }
```

and use `title` in the enqueue call.

- [ ] **Step 6: Give the existing kickstart pages a done-when**

For each kickstart test that seeds a product page (`grep -rln "'kickstart'" apps --include=*.pg.test.ts`), change the page's `bodyMd` to end with `\n\n## Done when\n\n- People see the board.` Do not change any assertion; a test that now passes only by asserting `done_when_missing` is a defect in the change: stop and report it.

- [ ] **Step 7: Run the tests**

Run: `pnpm check && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/github apps/uw-app/commands apps/uw-app/harness && npx vitest run sim/kernel`
Expected: green, including the new `EI-2` tests.

- [ ] **Step 8: Commit**

```bash
git add packages/harness/items packages/harness/index.ts apps/uw-app/github/import.ts apps/uw-app/github/import.pg.test.ts apps/uw-app/commands apps/uw-app/harness sim
git commit -m "feat(harness): intake refuses an issue or page with no done-when, and records it on the harness

The label import (webhook, sweep, import command) and kickstart refuse
done_when_missing and append done_when_missing once a day per issue or page;
the kernel's importIssue refuses as well. A labelled issue with sub-issues is
an epic and is not imported as an item.

EI-2. S18-R2 S18-R5 S18-R6."
```

---

### Task 7: `enqueue_epic` in the kernel (EI-3)

**Files:**
- Create: `packages/harness/items/blockers.ts` (the pure half: `passedShip`, `openBlockers`, `blockerCycle`; Task 8 adds `blockedRefusal`)
- Create: `packages/harness/items/blockers.test.ts`
- Create: `packages/harness/items/epic.ts`
- Modify: `packages/harness/items/record.ts` (`NewItem` gains `epic`, `blockedBy`; `createdDraft`)
- Modify: `packages/harness/items/enqueue.ts` (`EnqueueDraft` gains optional `itemId`, `epic`, `blockedBy`)
- Modify: `packages/harness/items/commands.ts` (`enqueueEpic`)
- Modify: `packages/harness/index.ts` (types; `openBlockers`, `passedShip`)
- Create: `sim/epics.ts`, `sim/kernel/enqueue-epic.test.ts`
- Create: `sim/scenarios/EI-3.an-epic-becomes-items-in-order-and-a-blocked-item-is-not-offered.ts`

**Interfaces:**
- Consumes: Task 5 `githubFacts.epic`, `EpicFacts`, `IssueFact`, `IssueKey`; Task 6 `intakeWriter`, `recordNotReadyIn`; step 14's `createdDraft`.
- Produces:
  - `EnqueueEpicInput = { readonly harnessId: string; readonly epic: IssueKey }`, `EpicEnqueued = { readonly items: readonly ItemState[]; readonly created: number }`
  - `ItemCommands.enqueueEpic(caller: Caller, input: EnqueueEpicInput): Promise<KernelOutcome<EpicEnqueued>>`
  - `passedShip(item: ItemState, stages: readonly Stage[]): boolean`, `openBlockers(item: ItemState, items: readonly ItemState[], stages: readonly Stage[]): readonly string[]`, `blockerCycle(edges: ReadonlyMap<number, readonly number[]>): readonly number[]`
  - `sim/epics.ts` as in the hand-off table

- [ ] **Step 1: Write the failing pure tests**

`packages/harness/items/blockers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ItemState, Stage } from '@uw/contracts';
import { software } from '../templates/software.ts';
import { blockerCycle, openBlockers, passedShip } from './blockers.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const stages: readonly Stage[] = software.stages.map((stage, index) => ({
  ...stage,
  id: `00000000-0000-4000-8000-00000000050${index}`,
  harnessId,
  instructionsPageId: null,
  paused: false,
  validators: [...stage.validators],
  feeds: [...stage.feeds],
}));

function item(n: number, stageKey: string, extra: Partial<ItemState> = {}): ItemState {
  return {
    itemId: `00000000-0000-4000-8000-00000000060${n}`,
    harnessId,
    stageKey,
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
    expectedHead: null,
    riskTier: null,
    riskDomains: [],
    pullRequest: null,
    issue: null,
    zulipTopic: null,
    epic: null,
    blockedBy: [],
    ...extra,
  };
}

describe('EI-3 a blocker holds its dependants until its item has passed Ship', () => {
  it('passes Ship past the merge stage or when done, and not at or before it', () => {
    expect(passedShip(item(1, 'check'), stages)).toBe(false);
    expect(passedShip(item(1, 'ship', { gateStatus: 'parked' }), stages)).toBe(false);
    expect(passedShip(item(1, 'validate'), stages)).toBe(true);
    expect(passedShip(item(1, 'close', { gateStatus: 'done' }), stages)).toBe(true);
  });

  it('blocks again when the blocker loops back to Package, and blocks on a blocker it cannot read', () => {
    const blocker = item(1, 'package');
    const waiting = item(2, 'package', { blockedBy: [blocker.itemId, item(9, 'package').itemId] });
    expect(openBlockers(waiting, [blocker], stages)).toEqual([blocker.itemId, item(9, 'package').itemId]);
    expect(openBlockers(waiting, [item(1, 'validate'), item(9, 'close', { gateStatus: 'done' })], stages)).toEqual([]);
  });

  it('passes a blocker only when done on a harness with no connector stage', () => {
    const plain = stages.map((stage) => ({ ...stage, connector: 'none' as const }));
    expect(passedShip(item(1, 'validate'), plain)).toBe(false);
    expect(passedShip(item(1, 'close', { gateStatus: 'done' }), plain)).toBe(true);
  });

  it('finds a cycle among blocker edges, a self edge included, and none in a chain', () => {
    expect(blockerCycle(new Map([[41, [42]], [42, [43]], [43, []]]))).toEqual([]);
    expect(blockerCycle(new Map([[41, [43]], [42, [41]], [43, [42]]]))).toEqual([41, 42, 43]);
    expect(blockerCycle(new Map([[44, [44]]]))).toEqual([44]);
  });
});
```

If `Stage` has fields the spread does not fill, read `stageSchema` in `packages/contracts/harness.ts` and add them with their defaults.

Run: `npx vitest run packages/harness/items/blockers.test.ts`
Expected: FAIL, `./blockers.ts` not found.

- [ ] **Step 2: The pure half of the blockers**

`packages/harness/items/blockers.ts`:

```ts
import type { ItemState, Stage } from '@uw/contracts';

type Mark = 'visiting' | 'done';

function shipStageOf(stages: readonly Stage[]): Stage | null {
  return stages
    .filter((stage) => stage.connector !== 'none')
    .reduce<Stage | null>(
      (lowest, stage) => (lowest === null || stage.position < lowest.position ? stage : lowest),
      null,
    );
}

export function passedShip(item: ItemState, stages: readonly Stage[]): boolean {
  if (item.gateStatus === 'done') return true;
  const ship = shipStageOf(stages);
  const at = stages.find((stage) => stage.key === item.stageKey);
  return ship !== null && at !== undefined && at.position > ship.position;
}

export function openBlockers(
  item: ItemState,
  items: readonly ItemState[],
  stages: readonly Stage[],
): readonly string[] {
  const byId = new Map(items.map((entry) => [entry.itemId, entry]));
  return item.blockedBy.filter((blockerId) => {
    const blocker = byId.get(blockerId);
    return blocker === undefined || !passedShip(blocker, stages);
  });
}

function cycleFrom(
  start: number,
  edges: ReadonlyMap<number, readonly number[]>,
  marks: Map<number, Mark>,
  path: number[],
): readonly number[] {
  marks.set(start, 'visiting');
  path.push(start);
  for (const next of edges.get(start) ?? []) {
    const mark = marks.get(next);
    if (mark === 'visiting') return path.slice(path.indexOf(next));
    const found = mark === undefined ? cycleFrom(next, edges, marks, path) : [];
    if (found.length > 0) return found;
  }
  path.pop();
  marks.set(start, 'done');
  return [];
}

export function blockerCycle(edges: ReadonlyMap<number, readonly number[]>): readonly number[] {
  const marks = new Map<number, Mark>();
  for (const start of [...edges.keys()].sort((a, b) => a - b)) {
    const found = marks.has(start) ? [] : cycleFrom(start, edges, marks, []);
    if (found.length > 0) return [...found].sort((a, b) => a - b);
  }
  return [];
}
```

Run: `npx vitest run packages/harness/items/blockers.test.ts`
Expected: PASS.

- [ ] **Step 3: The sim helpers and the failing kernel tests**

`sim/epics.ts`:

```ts
import type { Principal } from '@uw/contracts';
import type { EpicFacts, IssueFact, IssueKey } from '@uw/harness';
import { simCaller } from './fixtures.ts';
import type { World } from './world.ts';

export const epicRepository = 'unfoldingWord/uw-platform';
export const epicKey: IssueKey = { repo: epicRepository, number: 40 };

type FactOptions = {
  readonly blockedBy?: readonly number[];
  readonly doneWhen?: readonly string[];
  readonly open?: boolean;
};

export function epicFact(number: number, title: string, options: FactOptions = {}): IssueFact {
  return {
    issue: { repo: epicRepository, number, githubId: 9100000300 + number },
    title,
    open: options.open ?? true,
    doneWhen: options.doneWhen ?? [`${title} is merged and its tests pass.`],
    blockedBy: options.blockedBy ?? [],
  };
}

export function epicOf(subIssues: readonly IssueFact[], count = subIssues.length): EpicFacts {
  return { epic: epicFact(40, 'Epic intake', { doneWhen: [] }), subIssueCount: count, subIssues };
}

export const epicOfFour: EpicFacts = epicOf([
  epicFact(41, 'Read the sub-issues'),
  epicFact(42, 'Require a done-when'),
  epicFact(43, 'Enqueue the epic'),
  epicFact(44, 'Show the epic on the Board', { blockedBy: [43] }),
]);

export function enqueueEpicAs(world: World, actor: Principal, harnessId: string, epic = epicKey) {
  return world.kernel.items.enqueueEpic(simCaller(world, actor), { harnessId, epic });
}
```

`sim/kernel/enqueue-epic.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { enqueueEpicAs, epicFact, epicOf, epicOfFour } from '../epics.ts';
import { createSimHarness, simAgent, simCaller, simIngest, simPerson } from '../fixtures.ts';
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

async function named(world: World, harnessId: string, name: string) {
  const events = await world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, null));
  return events.filter((event) => event.name === name);
}

describe('EI-3 enqueue_epic makes one item per open sub-issue, in order, with blockers', () => {
  it('enqueues the four sub-issues in order at Package, the last blocked by the third, and no item for the epic', () =>
    inWorld(async (world) => {
      const { harness, admin } = await createSimHarness(world, software);
      world.adapters.githubFacts.givenEpic(epicOfFour);
      const enqueued = value(await enqueueEpicAs(world, admin, harness.id));
      expect(enqueued.created).toBe(4);
      expect(enqueued.items.map((item) => [item.issue?.number, item.stageKey, item.epic?.position])).toEqual([
        [41, 'package', 0],
        [42, 'package', 1],
        [43, 'package', 2],
        [44, 'package', 3],
      ]);
      const [, , third, fourth] = enqueued.items;
      expect(fourth?.blockedBy).toEqual([third?.itemId]);
      expect(enqueued.items.map((item) => item.priority)).toEqual([0, -1000, -2000, -3000]);
      const items = await world.adapters.store.transaction((tx) => tx.harnessItems.read.forHarness(harness.id));
      expect(items.some((item) => item.issue?.number === 40)).toBe(false);
    }));

  it('records epic_enqueued once with the outside blockers and the union of done-whens, and makes nothing twice', () =>
    inWorld(async (world) => {
      const { harness, admin } = await createSimHarness(world, software);
      world.adapters.githubFacts.givenEpic(
        epicOf([epicFact(41, 'Read the sub-issues', { blockedBy: [7] }), epicFact(42, 'Require a done-when')]),
      );
      const caller = simCaller(world, admin, '00000000-0000-4000-8000-0000000000aa');
      const first = value(await world.kernel.items.enqueueEpic(caller, { harnessId: harness.id, epic: { repo: 'unfoldingWord/uw-platform', number: 40 } }));
      const [recorded] = await named(world, harness.id, 'epic_enqueued');
      expect(recorded?.requestId).toBe('00000000-0000-4000-8000-0000000000aa');
      expect(recorded?.evidence).toMatchObject({
        title: 'Epic intake',
        outside: [7],
        doneWhen: ['Read the sub-issues is merged and its tests pass.', 'Require a done-when is merged and its tests pass.'],
      });
      const created = await named(world, harness.id, 'item_created');
      expect(created.map((event) => event.requestId)).toEqual([null, null]);
      const again = value(await enqueueEpicAs(world, admin, harness.id));
      expect(again).toEqual({ items: first.items, created: 0 });
      expect(await named(world, harness.id, 'epic_enqueued')).toHaveLength(1);
    }));

  it('adds a sub-issue that arrived later and points its blocker at the existing item', () =>
    inWorld(async (world) => {
      const { harness, admin } = await createSimHarness(world, software);
      world.adapters.githubFacts.givenEpic(epicOf([epicFact(41, 'Read the sub-issues')]));
      const [first] = value(await enqueueEpicAs(world, admin, harness.id)).items;
      world.adapters.githubFacts.givenEpic(
        epicOf([epicFact(41, 'Read the sub-issues'), epicFact(45, 'Follow up', { blockedBy: [41] })]),
      );
      const later = value(await enqueueEpicAs(world, admin, harness.id));
      expect(later.created).toBe(1);
      expect(later.items[0]).toEqual(first);
      expect(later.items[1]?.blockedBy).toEqual([first?.itemId]);
    }));

  it('gives a closed sub-issue no item and lets it block nothing', () =>
    inWorld(async (world) => {
      const { harness, admin } = await createSimHarness(world, software);
      world.adapters.githubFacts.givenEpic(
        epicOf([epicFact(41, 'Done already', { open: false, doneWhen: [] }), epicFact(42, 'Next', { blockedBy: [41] })]),
      );
      const enqueued = value(await enqueueEpicAs(world, admin, harness.id));
      expect(enqueued.items.map((item) => [item.issue?.number, item.blockedBy])).toEqual([[42, []]]);
    }));
});

describe('EI-2 an epic with a sub-issue lacking a done-when is not enqueued', () => {
  it('refuses done_when_missing, records it for that sub-issue only, and creates nothing', () =>
    inWorld(async (world) => {
      const { harness, admin } = await createSimHarness(world, software);
      world.adapters.githubFacts.givenEpic(
        epicOf([epicFact(41, 'Ready'), epicFact(42, 'Not ready', { doneWhen: [] })]),
      );
      expect(reasonOf(await enqueueEpicAs(world, admin, harness.id))).toBe('done_when_missing');
      const missing = await named(world, harness.id, 'done_when_missing');
      expect(missing.map((event) => event.evidence)).toEqual([
        { via: 'enqueue_epic', issue: epicFact(42, 'Not ready').issue, pageId: null, title: 'Not ready' },
      ]);
      expect(await named(world, harness.id, 'item_created')).toHaveLength(0);
    }));
});

describe('EI-3 enqueue_epic refuses what it cannot enqueue', () => {
  it('refuses an unknown issue, an issue with no sub-issues and a list not yet read', () =>
    inWorld(async (world) => {
      const { harness, admin } = await createSimHarness(world, software);
      expect(reasonOf(await enqueueEpicAs(world, admin, harness.id))).toBe('issue_not_found');
      world.adapters.githubFacts.givenEpic(epicOf([]));
      expect(reasonOf(await enqueueEpicAs(world, admin, harness.id))).toBe('not_permitted');
      world.adapters.githubFacts.givenEpic(epicOf([epicFact(41, 'Read')], 2));
      const stale = await enqueueEpicAs(world, admin, harness.id);
      expect(stale.status === 'error' && stale.detail['why']).toBe('sub_issues_not_read');
    }));

  it('refuses a blocker cycle, an agent, the ingest principal and a viewer', () =>
    inWorld(async (world) => {
      const { harness, admin } = await createSimHarness(world, software);
      world.adapters.githubFacts.givenEpic(
        epicOf([epicFact(41, 'A', { blockedBy: [42] }), epicFact(42, 'B', { blockedBy: [41] })]),
      );
      const cycle = await enqueueEpicAs(world, admin, harness.id);
      expect(cycle.status === 'error' && [cycle.reason, cycle.detail['why']]).toEqual(['malformed_command', 'blocker_cycle']);
      world.adapters.githubFacts.givenEpic(epicOfFour);
      const viewer = await simPerson(world, 3, [{ role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' }]);
      const agent = simAgent(admin, `${admin.personId}/builder`, { interactive: true });
      for (const actor of [viewer, agent, simIngest()]) {
        expect(reasonOf(await enqueueEpicAs(world, actor, harness.id))).toBe('not_permitted');
      }
    }));
});
```

Run: `npx vitest run sim/kernel/enqueue-epic.test.ts`
Expected: FAIL; `enqueueEpic` does not exist and `givenEpic` items carry no epic.

- [ ] **Step 4: Items carry an epic place from creation**

`packages/harness/items/record.ts`: import `EpicPlace` from `@uw/contracts`; `NewItem` gains:

```ts
  readonly epic?: EpicPlace | null;
  readonly blockedBy?: readonly string[];
```

Replace step 14's `createdDraft` with:

```ts
function joinedKeys(initial: NewItem) {
  const pullRequest = initial.pullRequest ?? null;
  const expectedHead = initial.expectedHead ?? null;
  if (pullRequest === null || expectedHead === null) return {};
  return { pullRequest: { ...pullRequest }, expectedHead };
}

function epicKeys(initial: NewItem) {
  const epic = initial.epic ?? null;
  if (epic === null) return {};
  return {
    epic: { issue: { ...epic.issue }, title: epic.title, position: epic.position },
    blockedBy: [...(initial.blockedBy ?? [])],
  };
}

function createdDraft(initial: NewItem): EventDraft {
  return {
    name: 'item_created',
    evidence: {
      stage: initial.stageKey,
      title: initial.title,
      pageId: initial.pageId,
      priority: initial.priority,
      due: initial.due,
      issue: initial.issue,
      ...joinedKeys(initial),
      ...epicKeys(initial),
    },
  };
}
```

An item that neither joins nor belongs to an epic keeps exactly the six keys GH-3 asserts.

`packages/harness/items/enqueue.ts`: `import type { EpicPlace } from '@uw/contracts';` (beside the others); `EnqueueDraft` gains:

```ts
  readonly itemId?: string;
  readonly epic?: EpicPlace | null;
  readonly blockedBy?: readonly string[];
```

and in `enqueueIn` the `createItem` call becomes:

```ts
    await createItem(tx, context, {
      ...input,
      itemId: input.itemId ?? context.ids.next(),
      harnessId: harness.id,
      stageKey: first.key,
      priority,
    }),
```

- [ ] **Step 5: The epic command**

`packages/harness/items/epic.ts`:

```ts
import type { EpicPlace, Harness, ItemState } from '@uw/contracts';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { sameRepository } from '../github/identifiers.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { EpicFacts, IssueFact, IssueKey, Ports, StoreTransaction } from '../ports.ts';
import { blockerCycle } from './blockers.ts';
import { enqueueIn } from './enqueue.ts';
import { intakeWriter, recordNotReadyIn } from './not-ready.ts';
import { draft, recordContext, recordHarnessEvents, type RecordContext } from './record.ts';

type EpicPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'ids' | 'store'>;

export type EnqueueEpicInput = { readonly harnessId: string; readonly epic: IssueKey };
export type EpicEnqueued = { readonly items: readonly ItemState[]; readonly created: number };

type Planned = {
  readonly fact: IssueFact;
  readonly position: number;
  readonly itemId: string;
  readonly existing: ItemState | null;
};
type Edges = { readonly blockedBy: ReadonlyMap<number, readonly string[]>; readonly outside: readonly number[] };

const TITLE_LIMIT = 200;
const DONE_WHEN_LIMIT = 100;

function titleOf(fact: IssueFact): string {
  const trimmed = fact.title.trim().slice(0, TITLE_LIMIT);
  return trimmed === '' ? `${fact.issue.repo}#${fact.issue.number}` : trimmed;
}

function shapeRefusal(facts: EpicFacts): Refused | null {
  if (facts.subIssueCount === 0) return refused('not_permitted', { why: 'not_an_epic' });
  if (facts.subIssues.length !== facts.subIssueCount) {
    return refused('not_permitted', { why: 'sub_issues_not_read' });
  }
  return null;
}

async function missingDoneWhen(
  tx: StoreTransaction,
  context: RecordContext,
  harnessId: string,
  open: readonly IssueFact[],
): Promise<Refused | null> {
  const missing = open.filter((fact) => fact.doneWhen.length === 0);
  for (const fact of missing) {
    const subject = { via: 'enqueue_epic' as const, issue: fact.issue, pageId: null, title: titleOf(fact) };
    await recordNotReadyIn(tx, context, harnessId, subject);
  }
  if (missing.length === 0) return null;
  return refused('done_when_missing', { issues: missing.map((fact) => `#${fact.issue.number}`) });
}

async function planned(
  tx: StoreTransaction,
  context: RecordContext,
  harness: Harness,
  facts: EpicFacts,
): Promise<readonly Planned[] | Refused> {
  const open = facts.subIssues.flatMap((fact, position) => (fact.open ? [{ fact, position }] : []));
  for (const githubId of open.map(({ fact }) => fact.issue.githubId).sort((a, b) => a - b)) {
    await tx.lock(lockKeys.githubIssue(githubId));
  }
  const plan: Planned[] = [];
  for (const { fact, position } of open) {
    const existing = await tx.harnessItems.read.byIssue(fact.issue.githubId);
    if (existing !== null && existing.harnessId !== harness.id) {
      return refused('not_permitted', { harnessId: harness.id, why: 'repository_mismatch' });
    }
    plan.push({ fact, position, itemId: existing?.itemId ?? context.ids.next(), existing });
  }
  return plan;
}

function edgesOf(plan: readonly Planned[], facts: EpicFacts): Edges {
  const itemOf = new Map(plan.map((entry) => [entry.fact.issue.number, entry.itemId]));
  const closed = new Set(facts.subIssues.filter((fact) => !fact.open).map((fact) => fact.issue.number));
  const outside = new Set<number>();
  const blockedBy = new Map<number, readonly string[]>();
  for (const { fact } of plan) {
    const named = fact.blockedBy.filter((number) => !closed.has(number));
    for (const number of named.filter((entry) => !itemOf.has(entry))) outside.add(number);
    blockedBy.set(fact.issue.number, named.flatMap((number) => itemOf.get(number) ?? []));
  }
  return { blockedBy, outside: [...outside].sort((a, b) => a - b) };
}

function cycleIn(plan: readonly Planned[]): readonly number[] {
  const numbers = new Set(plan.map((entry) => entry.fact.issue.number));
  const edges = new Map(
    plan.map((entry) => [entry.fact.issue.number, entry.fact.blockedBy.filter((n) => numbers.has(n))]),
  );
  return blockerCycle(edges);
}

function unionOf(open: readonly IssueFact[]): readonly string[] {
  return [...new Set(open.flatMap((fact) => fact.doneWhen))].slice(0, DONE_WHEN_LIMIT);
}
```

and, in the same file:

```ts
async function createAll(
  tx: StoreTransaction,
  context: RecordContext,
  harness: Harness,
  work: { readonly facts: EpicFacts; readonly plan: readonly Planned[]; readonly edges: Edges },
): Promise<KernelOutcome<EpicEnqueued>> {
  const place: Omit<EpicPlace, 'position'> = { issue: work.facts.epic.issue, title: titleOf(work.facts.epic) };
  const itemContext = { ...context, requestId: null };
  const items: ItemState[] = [];
  for (const entry of work.plan) {
    if (entry.existing !== null) {
      items.push(entry.existing);
      continue;
    }
    const recorded = await enqueueIn(tx, itemContext, harness, {
      itemId: entry.itemId,
      title: titleOf(entry.fact),
      pageId: null,
      priority: null,
      due: null,
      issue: entry.fact.issue,
      epic: { ...place, position: entry.position },
      blockedBy: work.edges.blockedBy.get(entry.fact.issue.number) ?? [],
    });
    if (recorded.status !== 'accepted') return recorded;
    items.push(recorded.value.item);
  }
  return accepted({ items, created: work.plan.filter((entry) => entry.existing === null).length });
}

async function recordEnqueued(
  tx: StoreTransaction,
  context: RecordContext,
  harnessId: string,
  work: { readonly facts: EpicFacts; readonly plan: readonly Planned[]; readonly edges: Edges },
): Promise<void> {
  const items = work.plan.map((entry) => ({
    itemId: entry.itemId,
    issue: entry.fact.issue,
    created: entry.existing === null,
    blockedBy: [...(work.edges.blockedBy.get(entry.fact.issue.number) ?? [])],
  }));
  const evidence = {
    epic: work.facts.epic.issue,
    title: titleOf(work.facts.epic),
    items,
    outside: [...work.edges.outside],
    doneWhen: [...unionOf(work.plan.map((entry) => entry.fact))],
  };
  await recordHarnessEvents(tx, context, harnessId, [draft('epic_enqueued', evidence)]);
}

async function enqueueEpicIn(
  ports: EpicPorts,
  tx: StoreTransaction,
  caller: Caller,
  facts: EpicFacts,
  input: { readonly harnessId: string; readonly at: Date },
): Promise<KernelOutcome<EpicEnqueued>> {
  const harness = await tx.harnesses.read.byId(input.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: input.harnessId });
  if (!(await intakeWriter(ports, tx, caller.actor, harness, input.at))) {
    return refused('not_permitted', { harnessId: harness.id });
  }
  if (!sameRepository(facts.epic.issue.repo, harness.repository)) {
    return refused('not_permitted', { harnessId: harness.id, why: 'repository_mismatch' });
  }
  const context = recordContext(ports, caller, input.at);
  const missing = await missingDoneWhen(tx, context, harness.id, facts.subIssues.filter((f) => f.open));
  if (missing !== null) return missing;
  const plan = await planned(tx, context, harness, facts);
  if ('status' in plan) return plan;
  const cycle = cycleIn(plan);
  if (cycle.length > 0) {
    return refused('malformed_command', { why: 'blocker_cycle', issues: cycle.map((n) => `#${n}`) });
  }
  const work = { facts, plan, edges: edgesOf(plan, facts) };
  const created = await createAll(tx, context, harness, work);
  if (created.status === 'accepted' && created.value.created > 0) {
    await recordEnqueued(tx, context, harness.id, work);
  }
  return created;
}

export async function enqueueEpic(
  ports: EpicPorts,
  caller: Caller,
  input: EnqueueEpicInput,
): Promise<KernelOutcome<EpicEnqueued>> {
  if (isAgent(caller.actor)) return refused('not_permitted', { why: 'person_command' });
  const facts = await ports.githubFacts.epic(input.epic);
  if (facts === null) {
    return refused('issue_not_found', { repository: input.epic.repo, number: input.epic.number });
  }
  const shape = shapeRefusal(facts);
  if (shape !== null) return shape;
  const at = ports.clock.now();
  return ports.store.transaction((tx) => enqueueEpicIn(ports, tx, caller, facts, { harnessId: input.harnessId, at }));
}
```

The ingest principal is an agent principal, so `enqueueEpic` refuses it before `intakeWriter` is reached. `recordHarnessEvents` stamps `epic_enqueued` with the caller's request id; the items carry `requestId: null` through `itemContext` (S18-R8). If `RecordContext` is not spreadable into a plain object because it holds `ids` by reference, that is fine: the spread keeps the same `ids`.

`packages/harness/items/commands.ts`: import `enqueueEpic, type EnqueueEpicInput, type EpicEnqueued` from `./epic.ts`; `ItemCommands` gains `enqueueEpic(caller: Caller, input: EnqueueEpicInput): Promise<KernelOutcome<EpicEnqueued>>;`; `createItemCommands` gains `enqueueEpic: (caller, input) => enqueueEpic(ports, caller, input),`.

`packages/harness/index.ts`:

```ts
export type { EnqueueEpicInput, EpicEnqueued } from './items/epic.ts';
export { openBlockers, passedShip } from './items/blockers.ts';
```

- [ ] **Step 6: Run the kernel tests**

Run: `npx vitest run sim/kernel/enqueue-epic.test.ts packages/harness/items && pnpm sim -- GH-3`
Expected: green.

- [ ] **Step 7: The EI-3 scenario**

`sim/scenarios/EI-3.an-epic-becomes-items-in-order-and-a-blocked-item-is-not-offered.ts`:

```ts
import assert from 'node:assert/strict';
import { readAllEvents, software } from '@uw/harness';
import { enqueueEpicAs, epicOfFour } from '../epics.ts';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'EI-3',
  title:
    'enqueue_epic turns an epic of four into four items in sub-issue order with the Blocked by line as a blocker, records epic_enqueued, makes no item for the epic, and poll_queue does not offer the blocked item',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    value(
      await world.kernel.stages.updateStage(simCaller(world, admin), {
        harnessId: harness.id,
        stageKey: 'package',
        change: { agentPickup: 'allowed' },
      }),
    );
    world.adapters.githubFacts.givenEpic(epicOfFour);
    const { items, created } = value(await enqueueEpicAs(world, admin, harness.id));
    assert.equal(created, 4);
    assert.deepEqual(items.map((item) => item.issue?.number), [41, 42, 43, 44]);
    const [, , third, fourth] = items;
    assert.deepEqual(fourth?.blockedBy, [third?.itemId]);
    const owner = await simPerson(world, 2, [{ role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' }]);
    const builder = simAgent(owner, `${owner.personId}/builder`, { interactive: true });
    const polled = value(await world.kernel.reads.poll(simCaller(world, builder), { harnessId: harness.id, limit: 10 }));
    assert.deepEqual(polled.map((item) => item.itemId), items.slice(0, 3).map((item) => item.itemId));
    const events = await world.adapters.store.transaction((tx) => readAllEvents(tx, harness.id, null));
    assert.equal(events.filter((event) => event.name === 'epic_enqueued').length, 1);
    return { state: { created, offered: polled.length } };
  },
});
```

This scenario fails at the poll assertion until Task 8 (the blocked item is still offered). Commit it with Task 8, not here: keep the file unstaged until then, or create it in Task 8 Step 1.

- [ ] **Step 8: Commit**

```bash
git add packages/harness/items packages/harness/index.ts sim/epics.ts sim/kernel/enqueue-epic.test.ts
git commit -m "feat(harness): enqueue_epic makes one item per open sub-issue, in order, with its blockers

The kernel reads the epic through githubFacts.epic, refuses an epic whose
open sub-issues lack a done-when (recording each), a list not yet read, a
cycle, an agent or a reader without write, and otherwise enqueues the
missing items at the first stage with their epic place and the item ids
their Blocked by lines name, recording epic_enqueued with the request id.

EI-2 EI-3. S18-R5 S18-R7 S18-R8."
```

---

### Task 8: A blocked item waits; independent items run in parallel under the WIP limit (EI-3, EI-4)

**Files:**
- Modify: `packages/harness/items/blockers.ts` (`blockedRefusal`)
- Modify: `packages/harness/reads/poll.ts` (`claimableIn`)
- Modify: `packages/harness/items/claim.ts` (`heldRefusal`)
- Create: `sim/kernel/epic-poll.test.ts`
- Create: `sim/scenarios/EI-3.an-epic-becomes-items-in-order-and-a-blocked-item-is-not-offered.ts` (Task 7 Step 7's content)
- Create: `sim/scenarios/EI-4.two-claims-live-and-two-waiting-under-the-wip-limit.ts`

**Interfaces:**
- Consumes: Task 7 `openBlockers`, `epicOfFour`, `enqueueEpicAs`.
- Produces: `blockedRefusal(tx: StoreTransaction, caller: Caller, item: ItemState): Promise<Refused | null>`.

- [ ] **Step 1: Write the failing tests**

`sim/kernel/epic-poll.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { rewriteItem } from '@uw/db/test-seed';
import { software, type ItemState } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { enqueueEpicAs, epicOfFour } from '../epics.ts';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly items: readonly ItemState[];
  readonly editor: Awaited<ReturnType<typeof simPerson>>;
};

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    value(
      await world.kernel.stages.updateStage(simCaller(world, admin), {
        harnessId: harness.id,
        stageKey: 'package',
        change: { agentPickup: 'allowed' },
      }),
    );
    world.adapters.githubFacts.givenEpic(epicOfFour);
    const { items } = value(await enqueueEpicAs(world, admin, harness.id));
    const editor = await simPerson(world, 2, [{ role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' }]);
    await work({ world, harnessId: harness.id, items, editor });
  } finally {
    await world.close();
  }
}

function agentOf(scene: Scene, name: string) {
  return simCaller(scene.world, simAgent(scene.editor, `${scene.editor.personId}/${name}`, { interactive: true }));
}

async function offered(scene: Scene): Promise<readonly string[]> {
  const polled = await scene.world.kernel.reads.poll(agentOf(scene, 'poller'), { harnessId: scene.harnessId, limit: 10 });
  return value(polled).map((item) => item.itemId);
}

describe('EI-3 a blocked item is not offered until every blocker’s item has passed Ship', () => {
  it('leaves the blocked item out of poll_queue for agents and people', () =>
    inScene(async (scene) => {
      const fourth = scene.items[3]?.itemId ?? '';
      expect(await offered(scene)).not.toContain(fourth);
      const byPerson = await scene.world.kernel.reads.poll(simCaller(scene.world, scene.editor), {
        harnessId: scene.harnessId,
        limit: 10,
      });
      expect(value(byPerson).map((item) => item.itemId)).not.toContain(fourth);
    }));

  it('offers it once the blocker’s item is done, as the views tests plant a gate status', () =>
    inScene(async (scene) => {
      const [, , third, fourth] = scene.items;
      await rewriteItem(scene.world.database.db, third?.itemId ?? '', { gateStatus: 'done' });
      expect(await offered(scene)).toContain(fourth?.itemId);
    }));

  it('refuses an agent’s claim of a blocked item by id, and lets a person claim it', () =>
    inScene(async (scene) => {
      const [, , third, fourth] = scene.items;
      const byAgent = await scene.world.kernel.items.claim(agentOf(scene, 'builder'), {
        itemId: fourth?.itemId ?? '',
        delegationId: null,
      });
      expect(reasonOf(byAgent)).toBe('not_permitted');
      expect(byAgent.status === 'error' && byAgent.detail['blockers']).toEqual([third?.itemId]);
      const byPerson = await scene.world.kernel.items.claim(simCaller(scene.world, scene.editor), {
        itemId: fourth?.itemId ?? '',
        delegationId: null,
      });
      expect(byPerson.status).toBe('accepted');
    }));
});
```

The second test plants `done` on the blocker's projection with `rewriteItem` (the same seam `apps/uw-app/views/gates.pg.test.ts` uses for a gate status): carrying an item through Ship needs the ship rule's facts, which steps 15 and 16 own; the meaning of "passed Ship" for every stage is pinned by `packages/harness/items/blockers.test.ts`. This test is not a scenario, so the runner's replay check does not read it.

Create the EI-3 scenario file with the content in Task 7 Step 7, and `sim/scenarios/EI-4.two-claims-live-and-two-waiting-under-the-wip-limit.ts`:

```ts
import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { software, type Caller } from '@uw/harness';
import { enqueueEpicAs, epicOfFour } from '../epics.ts';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

function device(world: World, owner: Principal, name: string): Caller {
  return simCaller(world, simAgent(owner, `${owner.personId ?? ''}/${name}`, { interactive: true }));
}

export const scenario = defineScenario({
  id: 'EI-4',
  title:
    'an epic of four with one blocker chain under a WIP limit of two: two independent items are claimed at once, the third independent one waits for a place and the blocked one is never offered',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    value(
      await world.kernel.stages.updateStage(simCaller(world, admin), {
        harnessId: harness.id,
        stageKey: 'package',
        change: { agentPickup: 'allowed', wipLimit: 2 },
      }),
    );
    world.adapters.githubFacts.givenEpic(epicOfFour);
    const { items } = value(await enqueueEpicAs(world, admin, harness.id));
    const [first, second, third, fourth] = items.map((item) => item.itemId);
    const owner = await simPerson(world, 2, [{ role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' }]);
    const [a, b, c] = ['builder-a', 'builder-b', 'builder-c'].map((name) => device(world, owner, name));
    const before = value(await world.kernel.reads.poll(a, { harnessId: harness.id, limit: 10 }));
    assert.deepEqual(before.map((item) => item.itemId), [first, second, third]);
    assert.equal((await world.kernel.items.claim(a, { itemId: first ?? '', delegationId: null })).status, 'accepted');
    assert.equal((await world.kernel.items.claim(b, { itemId: second ?? '', delegationId: null })).status, 'accepted');
    const full = await world.kernel.items.claim(c, { itemId: third ?? '', delegationId: null });
    assert.equal(reasonOf(full), 'wip_limit_reached');
    const blocked = await world.kernel.items.claim(c, { itemId: fourth ?? '', delegationId: null });
    assert.equal(reasonOf(blocked), 'not_permitted');
    const after = value(await world.kernel.reads.poll(c, { harnessId: harness.id, limit: 10 }));
    assert.equal(after.some((item) => item.itemId === fourth), false);
    const held = await world.adapters.store.transaction((tx) => tx.harnessItems.read.forHarness(harness.id));
    const live = held.filter((item) => item.holder !== null).length;
    assert.equal(live, 2);
    return { state: { live, waiting: items.length - live, full: reasonOf(full), blocked: reasonOf(blocked) } };
  },
});
```

`poll_queue` filters on pickup, gate status and blockers, not on the WIP limit, so after the two claims it still offers the third item; the claim is what refuses it, as KN-5 shows. The scenario asserts the claim.

Run: `npx vitest run sim/kernel/epic-poll.test.ts && pnpm sim -- EI-3 && pnpm sim -- EI-4`
Expected: FAIL; the blocked item is offered and the agent's claim of it is accepted.

- [ ] **Step 2: Poll and claim learn the blockers**

`packages/harness/items/blockers.ts`: add the imports and the guard:

```ts
import type { ItemState, Stage } from '@uw/contracts';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { refused, type Refused } from '../outcome.ts';
import type { StoreTransaction } from '../ports.ts';
```

```ts
export async function blockedRefusal(
  tx: StoreTransaction,
  caller: Caller,
  item: ItemState,
): Promise<Refused | null> {
  if (!isAgent(caller.actor) || item.blockedBy.length === 0) return null;
  const blockers = await tx.harnessItems.read.byIds(item.blockedBy);
  const stages = await tx.harnessStages.read.forHarness(item.harnessId);
  const open = openBlockers(item, blockers, stages);
  return open.length === 0 ? null : refused('not_permitted', { why: 'blocked', blockers: open });
}
```

`packages/harness/reads/poll.ts`: `import { openBlockers } from '../items/blockers.ts';`. In `claimableIn`, replace the filter line with:

```ts
  const waiting = (item: ItemState) => openBlockers(item, items, stages).length > 0;
  const candidates = items.filter((item) => claimable(stages, item, judged, at) && !waiting(item));
  for (const item of candidates) {
```

(keep the loop body as it is).

`packages/harness/items/claim.ts`: `import { blockedRefusal } from './blockers.ts';`; in `heldRefusal`, return:

```ts
  return (
    (await bareRefusal(tx, scene)) ??
    (await personHoldRefusal(tx, scene.caller, item)) ??
    (await blockedRefusal(tx, scene.caller, item))
  );
```

If step 17 reshaped `heldRefusal` or `claimableIn`, add the same check where the item's claimability is decided and say so in the commit body.

- [ ] **Step 3: Run the tests and the sim**

Run: `npx vitest run sim/kernel/epic-poll.test.ts sim/kernel packages/harness/reads packages/harness/items && pnpm sim -- all`
Expected: green; `EI-3` and `EI-4` pass and every earlier scenario holds (items with no blockers are unaffected).

- [ ] **Step 4: Commit**

```bash
git add packages/harness/items/blockers.ts packages/harness/reads/poll.ts packages/harness/items/claim.ts sim/kernel/epic-poll.test.ts sim/scenarios/EI-3.an-epic-becomes-items-in-order-and-a-blocked-item-is-not-offered.ts sim/scenarios/EI-4.two-claims-live-and-two-waiting-under-the-wip-limit.ts
git commit -m "feat(harness): a blocked item waits for its blockers to pass Ship; independent items run in parallel

poll_queue leaves out an item whose blockers' items have not passed Ship,
for every caller; claim refuses an agent's claim of one and lets a person
take it. EI-3's scenario shows the order and the waiting item; EI-4's shows
two claims live and two waiting under a WIP limit of two.

EI-3 EI-4. S18-R9 S18-R10 S18-R11."
```

---

### Task 9: The `enqueue_epic` person command (EI-3)

**Files:**
- Create: `apps/uw-app/commands/person/epics.ts`
- Modify: `apps/uw-app/commands/registry.ts` (replace the not-wired entry)
- Create: `apps/uw-app/commands/epics.pg.test.ts`

**Interfaces:**
- Consumes: Task 7 `kernel.items.enqueueEpic`; Task 4 `upsertFacts`, `recordSubIssues`; Task 5 the platform `epic` read.
- Produces: `enqueueEpicCommand: CommandHandler` (`write`, agents refused).

- [ ] **Step 1: Write the failing route test**

`apps/uw-app/commands/epics.pg.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { recordSubIssues } from '../github/facts/sub-issues.ts';
import { upsertFacts } from '../github/facts/upsert.ts';
import { emptyBatch, type IssueRecord } from '../github/facts/records.ts';
import { labelledIssue, repo } from '../github/testing/facts-fixtures.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { command, eventsNamed, softwareHarness } from '../testing/commands.ts';

const platform = 'unfoldingWord/uw-platform';
const seededAt = new Date('2026-10-15T08:00:00.000Z');

function issue(number: number, overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    ...labelledIssue,
    githubId: 9100000300 + number,
    number,
    title: `Issue ${number}`,
    labels: [],
    doneWhen: [`Issue ${number} ships.`],
    ...overrides,
  };
}

async function seedEpic(db: Database): Promise<void> {
  const children = [issue(41), issue(42), issue(43, { blockedBy: [42] })];
  const epic = issue(40, { subIssues: children.length, doneWhen: [] });
  await upsertFacts(db, { ...emptyBatch, repos: [repo], issues: [epic, ...children] }, seededAt);
  await recordSubIssues(db, {
    repoId: repo.githubId,
    parentId: epic.githubId,
    children: children.map((child) => child.githubId),
  });
}

async function epicItems(db: Database) {
  const rows = await db.$client`
    SELECT issue_number, blocked_by, epic->>'position' AS position FROM harness_items
    WHERE epic IS NOT NULL ORDER BY (epic->>'position')::int`;
  return rows.map((row) => [Number(row['issue_number']), (row['blocked_by'] as unknown[]).length, Number(row['position'])]);
}

describe.skipIf(!testServer)('EI-3 enqueue_epic through the command API', () => {
  it('enqueues the epic’s sub-issues in order with their blockers for an editor', () =>
    withAppDatabase(async (db) => {
      const { harnessId, editor } = await softwareHarness(db);
      await seedEpic(db);
      const sent = await command(db, editor, harnessId, 'enqueue_epic', {
        requestId: randomUUID(),
        repository: platform,
        number: 40,
      });
      expect(sent.body).toMatchObject({ status: 'accepted' });
      expect(await epicItems(db)).toEqual([
        [41, 0, 0],
        [42, 0, 1],
        [43, 1, 2],
      ]);
      expect(await eventsNamed(db, harnessId, 'epic_enqueued')).toHaveLength(1);
    }));

  it('refuses a viewer by can(), another repository, and an issue that is not an epic', () =>
    withAppDatabase(async (db) => {
      const { harnessId, editor, viewer } = await softwareHarness(db);
      await seedEpic(db);
      const body = { repository: platform, number: 40 };
      const byViewer = await command(db, viewer, harnessId, 'enqueue_epic', { requestId: randomUUID(), ...body });
      expect(byViewer.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
      const elsewhere = await command(db, editor, harnessId, 'enqueue_epic', {
        requestId: randomUUID(),
        repository: 'unfoldingWord/uw-other',
        number: 40,
      });
      expect(elsewhere.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
      const lone = await command(db, editor, harnessId, 'enqueue_epic', { requestId: randomUUID(), ...body, number: 41 });
      expect(lone.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
      expect(await epicItems(db)).toEqual([]);
    }));
});
```

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/commands/epics.pg.test.ts`
Expected: FAIL, `not_wired`.

- [ ] **Step 2: The handler**

`apps/uw-app/commands/person/epics.ts`:

```ts
import { sameRepository } from '@uw/harness';
import { commandHandler, fromKernel } from '../handler.ts';

export const enqueueEpicCommand = commandHandler({
  name: 'enqueue_epic',
  action: 'write',
  run: async (context, body) => {
    if (!sameRepository(body.repository, context.harness?.repository ?? null)) {
      return { ok: false, reason: 'not_permitted' };
    }
    return fromKernel(
      await context.kernel.items.enqueueEpic(context.caller, {
        harnessId: context.harnessId,
        epic: { repo: body.repository, number: body.number },
      }),
    );
  },
});
```

`apps/uw-app/commands/registry.ts`: `import { enqueueEpicCommand } from './person/epics.ts';` and replace `notWiredCommand('enqueue_epic', 'write'),` with `enqueueEpicCommand,` (drop the `notWiredCommand` import if nothing else uses it).

- [ ] **Step 3: Run the command tests and the architecture checks**

Run: `pnpm check && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/commands tools/architecture`
Expected: green; `command-routes`, `command-handlers` and `person-surface-rules` accept the new handler.

- [ ] **Step 4: Commit**

```bash
git add apps/uw-app/commands/person/epics.ts apps/uw-app/commands/registry.ts apps/uw-app/commands/epics.pg.test.ts
git commit -m "feat(commands): enqueue_epic, a person command with can() on the harness area

The handler checks the repository is the harness's and hands the epic to the
kernel; the platform adapter reads it from the GitHub facts. Agents are
refused at the route; a viewer is refused by can().

EI-3. S18-R8."
```

---

### Task 10: The Board groups each epic, draws its blockers, and lists what is not ready (EI-5, EI-2)

**Files:**
- Create: `packages/harness/views/epics.ts`, `packages/harness/views/epics.test.ts`
- Modify: `packages/harness/views/types.ts` (`EpicNode`, `EpicGroup`, `NotReady`; `BoardView` gains `epics`, `notReady`)
- Modify: `packages/harness/views/board.ts` (read them on the unfiltered first page)
- Modify: `packages/harness/index.ts` (export the three types)
- Create: `apps/uw-app/views/parts/epic-layout.ts`, `apps/uw-app/views/parts/epic-layout.test.ts`
- Create: `apps/uw-app/views/parts/epic-board.tsx`
- Modify: `apps/uw-app/views/screens/board.tsx` (render the two sections)
- Create: `apps/uw-app/views/epic-board.pg.test.ts`
- Create: `sim/kernel/epic-board.test.ts`
- Create: `sim/scenarios/EI-5.the-board-groups-an-epic-and-draws-its-blockers.ts`

**Interfaces:**
- Consumes: Task 7 `openBlockers`, `passedShip`, `enqueueEpicAs`, `epicOfFour`; Task 6 `done_when_missing` events; Task 5 `answeringEpic`.
- Produces:
  - `EpicNode = { readonly itemId: string; readonly title: string; readonly issue: IssueRef | null; readonly stageKey: string; readonly position: number; readonly blockedBy: readonly string[]; readonly waiting: boolean; readonly passedShip: boolean }`
  - `EpicGroup = { readonly epic: IssueRef; readonly title: string; readonly nodes: readonly EpicNode[] }`
  - `NotReady = { readonly via: IntakeVia; readonly issue: IssueRef | null; readonly pageId: string | null; readonly title: string; readonly at: Date }`
  - `epicGroupsOf(items, stages): readonly EpicGroup[]`, `notReadyOf(events, items): readonly NotReady[]`, `epicBoard(tx, harnessId, stages, at)`
  - `epicLayout(group: EpicGroup): EpicLayout` with `EpicLayout = { width; height; nodes: { itemId; x; y }[]; edges: { from; to; x1; y1; x2; y2 }[] }`

- [ ] **Step 1: Write the failing kernel tests**

`sim/kernel/epic-board.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { enqueueEpicAs, epicFact, epicOf, epicOfFour } from '../epics.ts';
import { createSimHarness, simCaller, simIngest } from '../fixtures.ts';
import { value } from '../runs.ts';
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

describe('EI-5 the Board groups an epic’s items with their blocker edges', () => {
  it('shows one group under the epic’s title, in sub-issue order, with the blocked item waiting', () =>
    inWorld(async (world) => {
      const { harness, admin } = await createSimHarness(world, software);
      world.adapters.githubFacts.givenEpic(epicOfFour);
      const { items } = value(await enqueueEpicAs(world, admin, harness.id));
      const board = value(
        await world.kernel.views.board(simCaller(world, admin), { harnessId: harness.id, stageKey: null, after: null }),
      );
      expect(board.epics).toHaveLength(1);
      const [group] = board.epics;
      expect(group?.title).toBe('Epic intake');
      expect(group?.nodes.map((node) => [node.issue?.number, node.waiting])).toEqual([
        [41, false],
        [42, false],
        [43, false],
        [44, true],
      ]);
      expect(group?.nodes[3]?.blockedBy).toEqual([items[2]?.itemId]);
      const filtered = value(
        await world.kernel.views.board(simCaller(world, admin), { harnessId: harness.id, stageKey: 'package', after: null }),
      );
      expect(filtered.epics).toEqual([]);
    }));
});

describe('EI-2 the Board lists what intake refused as not ready', () => {
  it('lists an issue refused for a missing done-when until it becomes an item', () =>
    inWorld(async (world) => {
      const { harness, admin } = await createSimHarness(world, software);
      const issue = { repo: 'unfoldingWord/uw-platform', number: 12, githubId: 9100000012 };
      const ingest = simCaller(world, simIngest());
      const input = { harnessId: harness.id, issue, title: 'Wire the board', pageId: null };
      await world.kernel.items.importIssue(ingest, { ...input, doneWhen: [] });
      world.adapters.githubFacts.givenEpic(epicOf([epicFact(41, 'Ready'), epicFact(42, 'Not ready', { doneWhen: [] })]));
      await enqueueEpicAs(world, admin, harness.id);
      const read = async () =>
        value(await world.kernel.views.board(simCaller(world, admin), { harnessId: harness.id, stageKey: null, after: null }));
      expect((await read()).notReady.map((entry) => [entry.via, entry.issue?.number])).toEqual([
        ['enqueue_epic', 42],
        ['import', 12],
      ]);
      value(await world.kernel.items.importIssue(ingest, { ...input, doneWhen: ['The board lists every stage.'] }));
      expect((await read()).notReady.map((entry) => entry.issue?.number)).toEqual([42]);
    }));
});
```

Run: `npx vitest run sim/kernel/epic-board.test.ts`
Expected: FAIL; `board.epics` is undefined.

- [ ] **Step 2: The view**

`packages/harness/views/types.ts`: add `IntakeVia, IssueRef` to the `@uw/contracts` import and:

```ts
export type EpicNode = {
  readonly itemId: string;
  readonly title: string;
  readonly issue: IssueRef | null;
  readonly stageKey: string;
  readonly position: number;
  readonly blockedBy: readonly string[];
  readonly waiting: boolean;
  readonly passedShip: boolean;
};
export type EpicGroup = {
  readonly epic: IssueRef;
  readonly title: string;
  readonly nodes: readonly EpicNode[];
};
export type NotReady = {
  readonly via: IntakeVia;
  readonly issue: IssueRef | null;
  readonly pageId: string | null;
  readonly title: string;
  readonly at: Date;
};
```

and change `BoardView` to:

```ts
export type BoardView = {
  readonly harness: Harness;
  readonly columns: readonly BoardColumn[];
  readonly epics: readonly EpicGroup[];
  readonly notReady: readonly NotReady[];
};
```

`packages/harness/views/epics.ts`:

```ts
import {
  eventEvidenceSchemas,
  type EpicPlace,
  type HarnessEvent,
  type ItemState,
  type Stage,
} from '@uw/contracts';
import { openBlockers, passedShip } from '../items/blockers.ts';
import type { StoreTransaction } from '../ports.ts';
import type { EpicGroup, EpicNode, NotReady } from './types.ts';

const GROUP_LIMIT = 20;
const NOT_READY_LIMIT = 20;
const NOT_READY_MS = 30 * 86_400_000;
const RECENT_LIMIT = 500;

type Grouped = { readonly epic: EpicPlace; readonly members: ItemState[] };

function nodeOf(item: ItemState, items: readonly ItemState[], stages: readonly Stage[]): EpicNode {
  return {
    itemId: item.itemId,
    title: item.title,
    issue: item.issue,
    stageKey: item.stageKey,
    position: item.epic?.position ?? 0,
    blockedBy: item.blockedBy,
    waiting: openBlockers(item, items, stages).length > 0,
    passedShip: passedShip(item, stages),
  };
}

function byPlace(a: EpicNode, b: EpicNode): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.itemId < b.itemId ? -1 : 1;
}

function grouped(items: readonly ItemState[]): readonly Grouped[] {
  const groups = new Map<number, Grouped>();
  for (const item of items) {
    if (item.epic === null) continue;
    const key = item.epic.issue.githubId;
    const group = groups.get(key) ?? { epic: item.epic, members: [] };
    group.members.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function epicGroupsOf(
  items: readonly ItemState[],
  stages: readonly Stage[],
): readonly EpicGroup[] {
  return grouped(items)
    .filter((group) => group.members.some((item) => item.gateStatus !== 'done'))
    .sort((a, b) => a.epic.issue.number - b.epic.issue.number)
    .slice(0, GROUP_LIMIT)
    .map((group) => ({
      epic: group.epic.issue,
      title: group.epic.title,
      nodes: group.members.map((item) => nodeOf(item, items, stages)).sort(byPlace),
    }));
}

export function notReadyOf(
  events: readonly HarnessEvent[],
  items: readonly ItemState[],
): readonly NotReady[] {
  const issues = new Set(items.flatMap((item) => (item.issue === null ? [] : [item.issue.githubId])));
  const pages = new Set(items.flatMap((item) => (item.pageId === null ? [] : [item.pageId])));
  const seen = new Set<string>();
  const shown: NotReady[] = [];
  for (const event of events) {
    const parsed = eventEvidenceSchemas.done_when_missing.safeParse(event.evidence);
    if (!parsed.success) continue;
    const entry = parsed.data;
    const key = entry.issue === null ? `page:${entry.pageId ?? ''}` : `issue:${entry.issue.githubId}`;
    const imported = entry.issue === null ? pages.has(entry.pageId ?? '') : issues.has(entry.issue.githubId);
    if (seen.has(key) || imported || shown.length === NOT_READY_LIMIT) continue;
    seen.add(key);
    shown.push({ ...entry, at: new Date(event.at) });
  }
  return shown;
}

export async function epicBoard(
  tx: StoreTransaction,
  harnessId: string,
  stages: readonly Stage[],
  at: Date,
): Promise<{ readonly epics: readonly EpicGroup[]; readonly notReady: readonly NotReady[] }> {
  const items = await tx.harnessItems.read.forHarness(harnessId);
  const events = await tx.harnessEvents.read.recent({
    since: new Date(at.getTime() - NOT_READY_MS),
    names: ['done_when_missing'],
    agentsOnly: false,
    limit: RECENT_LIMIT,
    harnessIds: [harnessId],
  });
  return { epics: epicGroupsOf(items, stages), notReady: notReadyOf(events, items) };
}
```

`packages/harness/views/board.ts`: `import { epicBoard } from './epics.ts';`; before the final `return accepted(...)`:

```ts
  const whole = input.stageKey === null && input.after === null;
  const extras = whole ? await epicBoard(tx, harness.id, stages, at) : { epics: [], notReady: [] };
```

and return `accepted({ harness, columns: listed.map((column) => columnOf(column, runs)), ...extras })`.

`packages/harness/index.ts`: add `EpicGroup`, `EpicNode`, `NotReady` to the `./views/types.ts` type export.

`packages/harness/views/epics.test.ts`, to pin the pure halves:

```ts
import { describe, expect, it } from 'vitest';
import type { HarnessEvent } from '@uw/contracts';
import { notReadyOf } from './epics.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const issue = { repo: 'unfoldingWord/uw-platform', number: 12, githubId: 9100000012 };

function missing(n: number, evidence: Record<string, unknown>): HarnessEvent {
  return {
    eventId: `00000000-0000-4000-8000-0000000007${String(n).padStart(2, '0')}`,
    harnessId,
    itemId: null,
    name: 'done_when_missing',
    at: `2026-10-1${n}T09:00:00.000Z`,
    actor: 'agent:ingest',
    evidence,
    traceId: '00000000-0000-4000-8000-0000000000c1',
    requestId: null,
    position: n,
  } as HarnessEvent;
}

describe('EI-2 the not-ready list names each issue or page once, newest first', () => {
  it('keeps the first of repeated subjects and drops what is now an item', () => {
    const events = [
      missing(5, { via: 'import', issue, pageId: null, title: 'Wire the board' }),
      missing(4, { via: 'import', issue, pageId: null, title: 'Wire the board' }),
      missing(3, { via: 'kickstart', issue: null, pageId: '00000000-0000-4000-8000-000000003101', title: 'Show it' }),
    ];
    expect(notReadyOf(events, []).map((entry) => entry.title)).toEqual(['Wire the board', 'Show it']);
  });
});
```

Replace `'agent:ingest'` with `ingestIdentity` from `@uw/contracts` if the event type refuses the literal, and drop the `as HarnessEvent` cast by building the object through `eventSchema.parse(...)` if the lint rules flag the cast.

Run: `npx vitest run sim/kernel/epic-board.test.ts packages/harness/views sim/kernel/views-flow-board.test.ts`
Expected: green. If `views-flow-board.test.ts` compares a whole `BoardView` with `toEqual`, add `epics: [], notReady: []` to its expected value.

- [ ] **Step 3: The EI-5 scenario**

`sim/scenarios/EI-5.the-board-groups-an-epic-and-draws-its-blockers.ts`:

```ts
import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { enqueueEpicAs, epicOfFour } from '../epics.ts';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'EI-5',
  title:
    'the Board shows the items of one epic grouped under its title in sub-issue order, with an edge from the third to the fourth and the fourth waiting',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    world.adapters.githubFacts.givenEpic(epicOfFour);
    const { items } = value(await enqueueEpicAs(world, admin, harness.id));
    const board = value(
      await world.kernel.views.board(simCaller(world, admin), { harnessId: harness.id, stageKey: null, after: null }),
    );
    const [group] = board.epics;
    assert.equal(board.epics.length, 1);
    assert.equal(group?.title, 'Epic intake');
    assert.deepEqual(group?.nodes.map((node) => node.itemId), items.map((item) => item.itemId));
    const edges = group?.nodes.flatMap((node) => node.blockedBy.map((from) => [from, node.itemId])) ?? [];
    assert.deepEqual(edges, [[items[2]?.itemId, items[3]?.itemId]]);
    assert.deepEqual(group?.nodes.map((node) => node.waiting), [false, false, false, true]);
    return { state: { groups: board.epics.length, edges: edges.length } };
  },
});
```

Run: `pnpm sim -- EI-5`
Expected: green.

- [ ] **Step 4: Write the failing layout and screen tests**

`apps/uw-app/views/parts/epic-layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EpicGroup, EpicNode } from '@uw/harness';
import { epicLayout, GAP_X, NODE_WIDTH, PAD } from './epic-layout.ts';

function node(n: number, blockedBy: readonly string[] = []): EpicNode {
  return {
    itemId: `item-${n}`,
    title: `Item ${n}`,
    issue: { repo: 'unfoldingWord/uw-platform', number: 40 + n, githubId: 9100000340 + n },
    stageKey: 'package',
    position: n,
    blockedBy,
    waiting: blockedBy.length > 0,
    passedShip: false,
  };
}

const group: EpicGroup = {
  epic: { repo: 'unfoldingWord/uw-platform', number: 40, githubId: 9100000340 },
  title: 'Epic intake',
  nodes: [node(1), node(2), node(3, ['item-2']), node(4, ['item-3', 'item-9'])],
};

describe('EI-5 the epic drawing places each item after its blockers', () => {
  it('puts unblocked items in the first column and each dependant one column after its deepest blocker', () => {
    const laid = epicLayout(group);
    const xOf = (id: string) => laid.nodes.find((entry) => entry.itemId === id)?.x;
    const column = (depth: number) => PAD + depth * (NODE_WIDTH + GAP_X);
    expect([xOf('item-1'), xOf('item-2'), xOf('item-3'), xOf('item-4')]).toEqual([
      column(0),
      column(0),
      column(1),
      column(2),
    ]);
  });

  it('draws one edge per blocker inside the group and none for a blocker outside it', () => {
    const laid = epicLayout(group);
    expect(laid.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ['item-2', 'item-3'],
      ['item-3', 'item-4'],
    ]);
    expect(laid.width).toBeGreaterThan(0);
    expect(laid.height).toBeGreaterThan(0);
  });
});
```

`apps/uw-app/views/epic-board.pg.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { EpicFacts, IssueFact } from '@uw/harness';
import { software, type Clock } from '@uw/harness';
import { boardWorld } from '../testing/board-world.ts';
import { accepted, callerOf } from '../testing/commands.ts';
import { answeringEpic, kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { boardPath } from './parts/paths.ts';

const seedClock: Clock = { now: () => new Date('2026-10-15T06:00:00.000Z') };
const viewClock: Clock = { now: () => new Date('2026-10-15T09:00:00.000Z') };
const repository = 'unfoldingWord/uw-platform';

function fact(number: number, title: string, blockedBy: readonly number[] = []): IssueFact {
  return {
    issue: { repo: repository, number, githubId: 9100000300 + number },
    title,
    open: true,
    doneWhen: [`${title} ships.`],
    blockedBy,
  };
}

const epic: EpicFacts = {
  epic: { ...fact(40, 'Epic intake'), doneWhen: [] },
  subIssueCount: 3,
  subIssues: [fact(41, 'Read the sub-issues'), fact(42, 'Enqueue the epic'), fact(43, 'Show the epic', [42])],
};

async function epicBoardHtml(): Promise<string> {
  let html = '';
  await withAppDatabase(async (db) => {
    const world = await boardWorld(db, seedClock);
    const kernel = kernelOn(db, seedClock, { githubFacts: answeringEpic(epic) });
    const harnessId = randomUUID();
    accepted(
      await kernel.stages.activate(callerOf(world.ian), {
        harnessId,
        harnessKey: 'epics',
        jdArea: '80-89',
        template: software,
        repository,
      }),
    );
    accepted(await kernel.items.enqueueEpic(callerOf(world.ian), { harnessId, epic: { repo: repository, number: 40 } }));
    html = (await getHtml(db, world.ianEmail, boardPath(harnessId), {}, viewClock)).text;
  });
  return html;
}

describe.skipIf(!testServer)('EI-5 the Board screen draws an epic', () => {
  it('shows the epic under its title with its items in order and the blocker in words and as an edge', async () => {
    const document = new JSDOM(await epicBoardHtml()).window.document;
    const group = document.querySelector('[data-epic="40"]');
    expect(group?.querySelector('h3')?.textContent).toBe('#40 Epic intake');
    const listed = [...(group?.querySelectorAll('ol > li') ?? [])].map((entry) => entry.textContent ?? '');
    expect(listed).toHaveLength(3);
    expect(listed[2]).toContain('waits on #42');
    expect(group?.querySelectorAll('svg [data-edge]')).toHaveLength(1);
    expect(group?.querySelector('svg title')?.textContent).toContain('Epic intake');
  });

  it('renders with no screen problems: tokens only, focus, names, phone width, light and dark', async () => {
    expect(await screenProblems(await epicBoardHtml())).toEqual([]);
  });
});
```

If `boardWorld`'s harness has a repository already, activate this one with `repository: 'unfoldingWord/uw-epics'` and use that name in `epic`; if step 14's dispatch gate refuses nothing here (no agent claims), no platform page is needed.

Run: `npx vitest run apps/uw-app/views/parts/epic-layout.test.ts` and `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/views/epic-board.pg.test.ts`
Expected: FAIL; no layout and no epic section.

- [ ] **Step 5: The layout**

`apps/uw-app/views/parts/epic-layout.ts`:

```ts
import type { EpicGroup } from '@uw/harness';

export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 56;
export const GAP_X = 48;
export const GAP_Y = 16;
export const PAD = 16;

export type LaidNode = { readonly itemId: string; readonly x: number; readonly y: number };
export type LaidEdge = {
  readonly from: string;
  readonly to: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
};
export type EpicLayout = {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly LaidNode[];
  readonly edges: readonly LaidEdge[];
};

function depthsOf(group: EpicGroup): ReadonlyMap<string, number> {
  const ids = new Set(group.nodes.map((node) => node.itemId));
  const depth = new Map(group.nodes.map((node) => [node.itemId, 0]));
  for (let pass = 0; pass < group.nodes.length; pass += 1) {
    for (const node of group.nodes) {
      const deepest = node.blockedBy
        .filter((id) => ids.has(id))
        .reduce((most, id) => Math.max(most, (depth.get(id) ?? 0) + 1), 0);
      depth.set(node.itemId, Math.min(deepest, group.nodes.length - 1));
    }
  }
  return depth;
}

function placed(group: EpicGroup, depths: ReadonlyMap<string, number>): readonly LaidNode[] {
  const rows = new Map<number, number>();
  return group.nodes.map((node) => {
    const depth = depths.get(node.itemId) ?? 0;
    const row = rows.get(depth) ?? 0;
    rows.set(depth, row + 1);
    return {
      itemId: node.itemId,
      x: PAD + depth * (NODE_WIDTH + GAP_X),
      y: PAD + row * (NODE_HEIGHT + GAP_Y),
    };
  });
}

export function epicLayout(group: EpicGroup): EpicLayout {
  const nodes = placed(group, depthsOf(group));
  const at = new Map(nodes.map((node) => [node.itemId, node]));
  const edges = group.nodes.flatMap((node) =>
    node.blockedBy.flatMap((from) => {
      const start = at.get(from);
      const end = at.get(node.itemId);
      if (start === undefined || end === undefined) return [];
      const middle = NODE_HEIGHT / 2;
      return [{ from, to: node.itemId, x1: start.x + NODE_WIDTH, y1: start.y + middle, x2: end.x - 4, y2: end.y + middle }];
    }),
  );
  const width = Math.max(...nodes.map((node) => node.x + NODE_WIDTH), NODE_WIDTH) + PAD;
  const height = Math.max(...nodes.map((node) => node.y + NODE_HEIGHT), NODE_HEIGHT) + PAD;
  return { width, height, nodes, edges };
}
```

- [ ] **Step 6: The screen part**

`apps/uw-app/views/parts/epic-board.tsx`:

```tsx
import type { EpicGroup, EpicNode, NotReady } from '@uw/harness';
import { domId } from '@uw/ui/components/text.ts';
import { epicLayout, NODE_HEIGHT, NODE_WIDTH, type EpicLayout } from './epic-layout.ts';
import { issueUrl, itemPath } from './paths.ts';

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

const viaWords: Readonly<Record<NotReady['via'], string>> = {
  import: 'Refused at import',
  kickstart: 'Refused at kickstart',
  enqueue_epic: 'Refused when its epic was enqueued',
};

function nameOf(node: EpicNode): string {
  return node.issue === null ? node.title : `#${node.issue.number}`;
}

function waitsOn(node: EpicNode, group: EpicGroup): string {
  const names = node.blockedBy.flatMap((id) => {
    const blocker = group.nodes.find((other) => other.itemId === id);
    return blocker === undefined ? [] : [nameOf(blocker)];
  });
  return names.length === 0 ? '' : `, waits on ${names.join(' and ')}`;
}

function nodeClass(node: EpicNode): string {
  if (node.passedShip) return 'fill-bg stroke-line';
  return node.waiting ? 'fill-bg stroke-ocean' : 'fill-surface stroke-ocean';
}

function Drawing(props: { readonly harnessId: string; readonly group: EpicGroup; readonly laid: EpicLayout }) {
  const { group, laid } = props;
  const key = String(group.epic.githubId);
  const arrow = domId('epic', key, 'arrow');
  const titleId = domId('epic', key, 'title');
  const descId = domId('epic', key, 'desc');
  const byId = new Map(group.nodes.map((node) => [node.itemId, node]));
  return (
    <div class="overflow-x-auto rounded-lg border border-line bg-surface p-2">
      <svg role="group" aria-labelledby={`${titleId} ${descId}`} viewBox={`0 0 ${laid.width} ${laid.height}`} class="h-auto w-full">
        <title id={titleId}>{`#${group.epic.number} ${group.title} as items and blockers`}</title>
        <desc id={descId}>{`${group.nodes.length} items; an arrow runs from a blocker to the item that waits on it`}</desc>
        <defs>
          <marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" class="fill-ocean" />
          </marker>
        </defs>
        {laid.edges.map((edge) => (
          <line data-edge={`${edge.from} ${edge.to}`} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} stroke-width="2" class="stroke-ocean" marker-end={`url(#${arrow})`} />
        ))}
        {laid.nodes.map((placed) => {
          const node = byId.get(placed.itemId);
          if (node === undefined) return null;
          return (
            <a href={itemPath(props.harnessId, node.itemId)} aria-label={`${nameOf(node)} ${node.title}${waitsOn(node, group)}`} class={focus}>
              <rect x={placed.x} y={placed.y} width={NODE_WIDTH} height={NODE_HEIGHT} rx="8" stroke-width="2" class={nodeClass(node)} />
              <text x={placed.x + 12} y={placed.y + 22} class="fill-ink text-xs font-bold">{nameOf(node)}</text>
              <text x={placed.x + 12} y={placed.y + 42} class="fill-muted text-xs">{node.stageKey}</text>
            </a>
          );
        })}
      </svg>
    </div>
  );
}

function Group(props: { readonly harnessId: string; readonly group: EpicGroup }) {
  const { group } = props;
  const headingId = domId('epic', String(group.epic.githubId), 'heading');
  return (
    <section data-epic={String(group.epic.number)} aria-labelledby={headingId} class="mb-4 rounded-lg border border-line bg-surface p-4">
      <h3 id={headingId} class="mb-2 font-bold text-ink">{`#${group.epic.number} ${group.title}`}</h3>
      <Drawing harnessId={props.harnessId} group={group} laid={epicLayout(group)} />
      <ol class="mt-2 list-decimal pl-6 text-sm text-ink">
        {group.nodes.map((node) => (
          <li>
            <a href={itemPath(props.harnessId, node.itemId)} class={`text-link underline ${focus}`}>
              {`${nameOf(node)} ${node.title}`}
            </a>
            {`, ${node.stageKey}${waitsOn(node, group)}`}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function EpicGroups(props: { readonly harnessId: string; readonly epics: readonly EpicGroup[] }) {
  if (props.epics.length === 0) return null;
  const headingId = domId('board', props.harnessId, 'epics');
  return (
    <section aria-labelledby={headingId} class="mb-6">
      <h2 id={headingId} class="mb-2 text-lg font-bold text-ink">Epics</h2>
      {props.epics.map((group) => (
        <Group harnessId={props.harnessId} group={group} />
      ))}
    </section>
  );
}

export function NotReadyList(props: { readonly harnessId: string; readonly entries: readonly NotReady[] }) {
  if (props.entries.length === 0) return null;
  const headingId = domId('board', props.harnessId, 'not-ready');
  return (
    <section aria-labelledby={headingId} class="mb-6 rounded-lg border border-line bg-surface p-4">
      <h2 id={headingId} class="mb-1 text-lg font-bold text-ink">Not ready</h2>
      <p class="mb-2 text-sm text-muted">
        These have no Done when heading, so intake refused them. Add a Done when heading with at least one line under it, then import them again.
      </p>
      <ul class="list-disc pl-6 text-sm text-ink">
        {props.entries.map((entry) => (
          <li>
            {entry.issue === null ? (
              entry.title
            ) : (
              <a href={issueUrl(entry.issue)} class={`text-link underline ${focus}`}>
                {`#${entry.issue.number} ${entry.title}`}
              </a>
            )}
            {`. ${viaWords[entry.via]}.`}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Read `flow-diagram.tsx` and `board-card.tsx` before writing: use the same token class names they use (`fill-surface`, `stroke-ocean`, `fill-ink`, `fill-muted`, `border-line`, `text-link`). If a class here is not in `packages/ui/tokens/` (the tokens-agree check fails the build on one), use the nearest class those two files use. Prettier will wrap the long JSX lines; the `Drawing` function stays under 50 lines after wrapping only if the node mapping moves into its own `Node` component, so move it there.

`apps/uw-app/views/screens/board.tsx`: `import { EpicGroups, NotReadyList } from '../parts/epic-board.tsx';` and, between `<StageChips … />` and the lanes grid:

```tsx
      <EpicGroups harnessId={harnessId} epics={board.epics} />
      <NotReadyList harnessId={harnessId} entries={board.notReady} />
```

Both render nothing when empty, so the existing Board tests (which count `main section`) are unchanged.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run apps/uw-app/views/parts/epic-layout.test.ts && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/views && pnpm check && pnpm ui:islands && npx vitest run tools/ui`
Expected: green, including `the board renders with no screen problems` and both `EI-5` screen tests. (`pnpm ui:islands` only rewrites the bundle if a contract changed since Task 2; commit it if it changed.)

- [ ] **Step 8: Load the screen**

Run the app locally the way `docs/architecture.md` describes for screens (or `pnpm --filter uw-app dev` if that is the documented command) against the test database seeded by the pg test's steps, and look at the Board at 375 px wide and at desktop width, in light and in dark. If no local run is possible without an account, record "Board epic section not loaded in a browser; `screenProblems` and the JSDOM assertions are the evidence" under "Not verified" in the tracker in Task 11.

- [ ] **Step 9: Commit**

```bash
git add packages/harness/views packages/harness/index.ts apps/uw-app/views sim/kernel/epic-board.test.ts sim/scenarios/EI-5.the-board-groups-an-epic-and-draws-its-blockers.ts apps/uw-app/generated/islands.ts
git commit -m "feat(views): the Board groups each epic, draws its blockers, and lists what is not ready

The Board view reads each open epic's items in sub-issue order with whether
each waits on a blocker, and the issues and pages intake refused in the last
30 days that are still not items. The screen draws each epic as a token-only
SVG laid out by blocker depth, says the same in an ordered list, and lists
what is not ready with how to fix it.

EI-5 EI-2. S18-R12."
```

---

### Task 11: Verify, record, push

**Files:**
- Modify: `docs/progress_tracker.md` (the step 18 row; a "Step 18 evidence by requirement" section; the S18 rulings rows; Not verified; Waiting on a person)

- [ ] **Step 1: Run the whole chain**

Run with `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres` set: `pnpm verify`
Expected: green. Note the test count, the scenario count (three more than before: EI-3, EI-4, EI-5) and the trace line (EI-1 to EI-4 proven, 0 due).

- [ ] **Step 2: Update the tracker**

In `docs/progress_tracker.md`:

1. The step 18 row: state `Built`; evidence: the commit SHAs of Tasks 1 to 10 in order with one word each, the proofs (EI-1 `apps/uw-app/github/sub-issues.pg.test.ts`, `apps/uw-app/github/facts/normalise.test.ts`, `packages/db/epic-columns.test.ts`; EI-2 `packages/harness/github/issue-body.test.ts`, `sim/kernel/not-ready.test.ts`, `sim/kernel/enqueue-epic.test.ts`, `sim/kernel/epic-board.test.ts`, `apps/uw-app/github/import.pg.test.ts`, `apps/uw-app/commands/items.pg.test.ts`; EI-3 the EI-3 scenario, `packages/harness/items/blockers.test.ts`, `sim/kernel/enqueue-epic.test.ts`, `sim/kernel/epic-poll.test.ts`, `apps/uw-app/commands/epics.pg.test.ts`, the GitHub facts port contract; EI-4 the EI-4 scenario; EI-5 the EI-5 scenario, `apps/uw-app/views/epic-board.pg.test.ts`, `apps/uw-app/views/parts/epic-layout.test.ts`), the `pnpm verify` counts, the contract version this step reached, the migration file name, "CI not run" or the CI run id, and the plan path.
2. A "Step 18 evidence by requirement" section after step 17's, one line per ID naming its proof, in the shape of the step 13 section.
3. Under "Decisions made during the build", S18-R1 to S18-R14 from the top of this plan, in the shape of the S13 rows (date `2026-10-15`, the requirement IDs, the ruling, why, the cost if wrong).
4. Under "Not verified": the shape of GitHub's `sub_issues_summary` on an issue and of `GET /repos/{owner}/{repo}/issues/{n}/sub_issues` is taken from GitHub's documentation and proven only against fixtures; whether adding a sub-issue moves the parent's `updated_at` (so the sweep re-reads the list) is inferred, not observed; the `sub_issues` webhook is not subscribed; and Task 10 Step 8's result if the screen was not loaded.
5. Under "Waiting on a person": the GL-1 live run reads one real epic's sub-issues on the pilot repository and confirms the three points above.

- [ ] **Step 3: Commit and push**

```bash
git add docs/progress_tracker.md
git commit -m "docs(tracker): step 18 is built"
git push
```

The draft pull request for `build/v0.2.0` already exists; push only.

---

## Self-review

**Spec coverage.** EI-1 (`parent_issue_id`, the sweep and import read the sub-issue list, an issue with sub-issues is an epic): Task 3 columns, Task 4 the read on every upsert path, Task 5 the port, Task 6 S18-R6. EI-2 (refuse at import, `kickstart` and EI-3 with `done_when_missing`, record the refusal as a harness event, the Board shows it, the epic's done-when is the union): Task 4 parser, Task 6 import and kickstart, Task 7 `enqueue_epic` and the union on `epic_enqueued`, Task 10 the Board's "Not ready". EI-3 (person command, one item per sub-issue in order, blockers from `Blocked by: #N`, not offered until every blocker passed Ship, the epic becomes no item, `epic_enqueued`): Tasks 7, 8 and 9. EI-4 (parallel claims up to the WIP limit, a scenario of four with one blocker chain, two live and two waiting): Task 8's scenario. EI-5 (grouped under the title, blocker edges drawn): Task 10. The contract, the columns and the words: Tasks 1 to 3.

**Placeholders.** None that stand for missing work. Three places name an existing local helper by role rather than by name (Task 6 Step 4's import rig and product-page seed, Task 10 Step 6's token class names) because the file must be read to reuse it; each says what to do if the name differs.

**Type consistency.** `EpicPlace`, `IntakeVia`, `IssueKey`, `IssueFact`, `EpicFacts`, `EnqueueEpicInput`, `EpicEnqueued`, `NotReadySubject`, `NotReadyInput`, `EpicNode`, `EpicGroup`, `NotReady`, `openBlockers`, `passedShip`, `blockerCycle`, `blockedRefusal`, `recordNotReadyIn`, `notReadyRefusal`, `intakeWriter`, `epicGroupsOf`, `notReadyOf`, `epicBoard`, `epicLayout`, `recordSubIssues`, `epicFacts`, `issueChangeOf`, `followSubIssues`, `subIssuesFromRest`, `answeringEpic` and `givenEpic` are spelled the same in the task that defines them, the tasks that use them and the hand-off table. `ItemState.blockedBy` holds item ids; `IssueFact.blockedBy` and `gh_issues.blocked_by` hold issue numbers; Task 7's `edgesOf` is the one place that maps the second to the first.

**Review Focus.** Line 1 is pinned by Task 7 (`sub_issues_not_read`), line 2 by Task 7's second and third tests, line 3 by Task 4's parser tests, line 4 by Task 6's first kernel test and its app test, line 5 by Task 8's claim test and Task 7's pure loop-back test.
