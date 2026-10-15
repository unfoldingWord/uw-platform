# Step 15, Ship Rule and Gates: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The ship rule reads five more facts and refuses on each (a head behind its base, a closing keyword for an issue the item does not wrap, a `[skip ci]` commit, a required check that never ran, a frozen harness); an approval survives a merge from base when the change is byte-identical; the merge runs the ship rule again in-process and merges exactly the head it evaluated; a person decides a batch of gates in one transaction, freezes a harness, and never sees an engine's refusal routed to another engine; every Reviewer finding carries a weight, only `real` and `plausible` findings make a review round, a person can mark a finding refuted, and each Reviewer's refute rate shows on its persona view and on `/health`.

**Architecture:** The ship rule stays one pure function in `packages/harness/ship-rule.ts`; its input grows by facts and two harness columns, never by a value planted on the item. Required checks become a harness column (`required_checks`), which retires the ship rule's dependence on this repository's six CI job names. The GitHub facts module records, at each head, the comparison with the base (`behind_by`, the patch id, the commits with their skip-ci markers and closing references) from the compare call it already makes, so no new GitHub endpoint is read. The carry of an approval across a base merge is a pure function (`carriedCommits`) the assembler feeds to the rule. The in-process re-run before the merge lives in the approve-at-Ship path (the only module allowed to call `shipRule`) and reaches the connector through a guard argument to `exitThroughConnector`. `decide_gates` reuses the single decision's transaction body for each entry inside one transaction. The engine refusal rides the existing `stopReason: 'refused'` of a model turn. Finding weights live in the Reviewer's verdict lines (`- real: ...`), in the run's review record and in the GitHub read-back; the refute rate is a read over 30 days of events, not a stored row.

**Tech Stack:** TypeScript strict, Zod 4, Drizzle and drizzle-kit, Vitest 4 (node project and the Postgres service), Hono JSX for the Gates and persona screens, the sim over the embedded Postgres Store, Web Crypto (`crypto.subtle`) for the patch id in the app.

**Spec:** `docs/PRD.md` section 7.11 (SR-1, SR-2, SR-3, GD-1, GD-2, GD-3, RV-1, RV-2, RV-3), sections 8.1, 8.3, 8.5, 8.6 and 13 (step 15); the design is `docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` sections 2, 3 (V2-6, V2-8), 5.6, 5.7, 6 and 7.

**Requirements covered:** SR-1, SR-2, SR-3, GD-1, GD-2, GD-3, RV-1, RV-2 (all Must) and RV-3 (Should, built: it is one frontmatter line and one function this step needs anyway for RV-1's verdict).

**Builds on step 14 (planned in `docs/superpowers/plans/2026-10-15-step-14-joining.md`, built before this plan runs).** Names used exactly as step 14 hands them over: `Harness.shadow`, `Harness.externalReviewerIdentities`, the events `review_verdict_recorded`, `shadow_verdict`, `shadow_lifted`, the command `set_shadow`, `shadowComparisonSchema` in `packages/contracts/shadow.ts`, `shipPreview` and its second caller `packages/harness/gates/shadow-verdict.ts`, `gates.recordShadowVerdicts`, `countedReviewer` and `EXTERNAL_PROVIDER` in `packages/harness/github/reviewers.ts`, `latestDecisive(facts, head, external)` and `reviewsOn(facts, head, external)` in `packages/harness/gates/ship-input.ts`, `gh_prs.requested_reviewers`, the contract version step 14 leaves (expected `12.4.0`) and its migration (expected `0029_joining`). Step 14's "left for later" item 2 (the six CI job names) is resolved here by S15-R1.

**Rulings made while planning** (recorded here and in `docs/progress_tracker.md` by the last task):

| Ruling | Cost if wrong |
|---|---|
| S15-R1. Required checks are a harness column `required_checks` (jsonb, a list of `{ app, name }`, at most 30, each once), set at activation (`activate_template.requiredChecks`, default `[]`). An empty list means every check that ran on the head (latest per app and name) concluded `success` and at least one ran. A non-empty list means each named check ran on the head (else `required_check_never_ran`) and concluded `success` (else `checks_not_green`). The migration backfills the harness on `unfoldingWord/uw-platform` with the six `github-actions` jobs (`defaultCiChecks`); the sim and the app test helpers activate software harnesses with them, so v0.1.0's behaviour holds there | Changing the list on a live harness waits for an additive command; a repository whose CI only runs some checks on some paths needs the empty list or a later per-path rule |
| S15-R2. The five SR-1 refusals apply only once the pull request is usable (the head is known); a missing or foreign pull request keeps v0.1.0's reasons. Unknown comparison facts fail closed: a null `behindBy` refuses `base_behind`, unknown commits refuse `skip_ci_marker` | A head whose comparison the sweep has not read yet waits one sweep or one refresh |
| S15-R3. A closing keyword is any of close, closes, closed, fix, fixes, fixed, resolve, resolves, resolved, case-insensitive, followed by an optional colon and `#N`, `owner/name#N` or an issue URL, anywhere in the pull request body or in any commit message on the head, quoted, unquoted or inside a code span. Any reference other than the item's wrapped issue refuses; an item that wraps no issue (enqueued or joined) refuses any closing keyword | Over-refusal on a body that quotes a keyword it does not mean; the author rewrites one line |
| S15-R4. A skip-ci marker is `[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]`, `[actions skip]` or a `skip-checks: true` trailer, case-insensitive, in any commit message on the head | A marker GitHub adds later is not seen until the list grows |
| S15-R5. The comparison is the compare call the facts module already makes (`base...head`, the pull request's recorded base SHA), now with `per_page: 100`, so it carries `behind_by` and the head's commits. Commits are known only when the answer lists all of them (`total_commits` at most 100); more is unknown | A pull request of more than 100 commits refuses `skip_ci_marker` until it is squashed or a later step pages the commits |
| S15-R6. The patch id is SHA-256 over the compare files sorted, each as status, previous name, name and the patch with every hunk header reduced to `@@` (or `blob <sha>` when GitHub sends no patch). It is null at 300 files or more, or when a file has neither. `gh_prs.patch_id` holds the head's; `gh_prs.patch_ids` maps every head the facts module has seen to its patch id and resets to the current head at 100 heads. Written only by the facts module (sweep and Ship refresh call it) | Two diffs that differ only in hunk position read as the same change; the base they were applied to is still checked by CI on the new head |
| S15-R7. "The only change between them is a merge from base" means: in the head's commit list every commit after the approved commit is a merge commit (two or more parents), and the approved commit's recorded patch id equals the head's. Such a commit is *carried*. A carried expected head is not `head_mismatch`, an approval on a carried commit counts, and the merge runs at the current head | A merge commit that resolves a conflict with a hand edit changes the patch id and refuses, which is the intent |
| S15-R8. "The ship rule's record names both heads" is the gate decision: `gate_decisions.evidence` gains `head` (the head the rule evaluated) and `approvals` (`[{ reviewer, commit, head }]`). The outcome schema is unchanged | A reader wanting the pair on an event reads the decision row |
| S15-R9. SR-3's in-process re-run is in the approve-at-Ship path (the only allowed `shipRule` caller besides its module) and reaches the connector as a guard argument to `exitThroughConnector`. It refreshes the facts, runs the rule with the decision's approver, and either hands the connector the evaluated head or records `connector_refused` with `ship_rule_refused: <reasons>` (or `ship_rule_unavailable`) and calls nothing. It runs on every connector exit. Recovery asks GitHub about the head recorded in the decision's evidence | One more GitHub read per merge |
| S15-R10. `set_freeze` takes `{ frozen, allow }`; lifting needs `allow` empty and clears the list; `allow` names at most 100 items of the harness, each once; the same state again records nothing; `freeze_changed { frozen, allow }` is a harness event; admin only | A freeze cannot be edited without lifting and setting it again |
| S15-R11. `decide_gates` takes 1 to 50 entries `{ itemId, head, decision }`, `decision` `approve` or `reject`, each item once, all in the command's harness. Each entry is pinned: its head must equal the item's expected head for either decision. One transaction runs the single decision's body per entry in item-id order; any refusal rolls the whole batch back, records nothing (no `ship_refused`) and names the refusing item. Connectors run after the commit. Agents are refused at the route. `override` and `take_over` stay single-item | A person approving forty gates in one click; V2-8 already accepts that |
| S15-R12. An engine's own refusal is a model turn with `stopReason: 'refused'`; the tool loop ends `refused`, the run fails `engine_refused` (a run-failure value, not an error reason), and the kernel appends `handed_to_person { why: 'engine_refused', rounds: null }` to the delegation's grantor. The beat never starts a run on an item whose last `engine_refused` failure has no later event by a `human:` actor | A refusal on a run with no delegation is not handed to anyone, only never re-dispatched |
| S15-R13. A Reviewer finding line is `- <weight>: <text>`. A verdict with any unweighted finding is refused `finding_weight_missing`: nothing is posted, the run fails with the run-failure value `finding_weight_missing`, and the host treats the refusal as an ended run. The run's review record carries its findings (`default([])` for events before 13.0.0). Findings read back from GitHub carry a nullable weight | A model that ignores the format burns one run per attempt, backed off as any failure |
| S15-R14. The posted verdict is derived: no findings posts `approve`; a finding the persona's `approve_at` treats as blocking posts `request_changes`; otherwise the model's verdict. A review round counts only a posted `request_changes` with at least one `real` or `plausible` finding; events before 13.0.0 carry no findings and no longer count | Hand-offs that v0.1.0 data was one round from do not fire |
| S15-R15. RV-3 is built: `approve_at` on the persona frontmatter, default `no_real_or_plausible`; the Reviewer fixtures write it; the persona view shows it | None beyond one line |
| S15-R16. A refutation is the event `finding_refuted` keyed by run and finding index, person-only with `write` on the area, idempotent. The refute rate is a read over 30 days of `run_completed` and `finding_refuted` events, shown on the persona view and as the agent-plane indicator `reviewer_refutes` with a drill-through. No `gh_reviews` column and no `measurements` row; design section 6 is corrected in Task 1 | A history of the rate needs a nightly recorder later |
| S15-R17. The contract moves to `13.0.0` once for the whole step (S12-R1): the finding weight is required, the ship-rule input gains required fields and `handed_to_person.rounds` becomes nullable | None; the lock test enforces the rule |

**What this step hands to later steps (keep these names exactly):**

| Interface | Where | Consumed by |
|---|---|---|
| `shipRefusalSchema` ends `base_behind`, `auto_close_keyword`, `skip_ci_marker`, `required_check_never_ran`, `harness_frozen` | `packages/contracts/ship-rule.ts` | MD-4 appends `protected_path_needs_person`, `tier_above_delegation` |
| `requiredCheckSchema`, `requiredChecksSchema`, `defaultCiChecks`, `closingRefSchema`, `ClosingRef`, `RequiredCheck` | `packages/contracts/ship-rule.ts` | GL-5, DX-10 |
| `ShipRuleInput` fields `carries`, `requiredChecks`, `closes`, `wraps`, `frozen`, `pullRequest.behindBy`, `pullRequest.skipCi`, `checks[].app` | `packages/contracts/ship-rule.ts` | MD-3 (adds the delegation input) |
| `countedApprovals(input)` | `packages/harness/ship-rule.ts` | MD-3's decision row |
| `carriedCommits(comparison, head)` | `packages/harness/gates/carry.ts` | FL-3 |
| `PullRequestFacts.closes`, `PullRequestFacts.comparison: BaseComparison \| null`, `HeadCommit`, `ReviewFact.findings: readonly ReadFinding[]` | `packages/harness/ports.ts` | FL-3, EI-2 |
| `Harness.frozen`, `Harness.freezeAllow`, `Harness.requiredChecks`; `HarnessesGateway.write.setFreeze` | contracts, `store-ports.ts` | DX-10, GL-5 |
| Commands `set_freeze`, `decide_gates`, `refute_finding`; events `freeze_changed`, `finding_refuted` | `packages/contracts` | DX-10, OB-2 |
| `gates.decideGates(caller, BatchInput)`, `gates.refuteFinding(caller, RefuteInput)`, `stages.setFreeze(caller, FreezeInput)` | `packages/harness/gates/*`, `stages/freeze.ts` | MD-3 (a delegated batch is not built) |
| `ExitInput.evaluatedHead`, `exitThroughConnector(ports, context, input, guard)` | `packages/harness/gates/exit.ts` | MD-3 |
| `reviewFindingSchema`, `readFindingSchema`, `approveAtSchema`, `ReviewRecord.findings`, `runFailureSchema` gains `engine_refused`, `finding_weight_missing`; `handOffReasonSchema` gains `engine_refused` | `packages/contracts` | FL-2 (offers a fix claim after a counted round) |
| `weighedFindings`, `postedVerdict`, `countsAsRound` | `packages/harness/runs/weights.ts` | FL-2 |
| `refuteTallies(events)`, `PlaneTotals.reviewerRefutes`, `PersonaDashboard.refutes`, `PersonaDashboard.approveAt` | `packages/harness/views/refutes.ts`, `views/types.ts`, `views/persona.ts` | OB-2 |
| `comparedAt(head, change)` sim fixture; `greenFacts` now carries a green comparison | `sim/ship-fixtures.ts` | every later sim test at Ship |

---

## Global Constraints

Every task obeys every line here. The controller passes this section to each implementer.

**Where and how**

- Work only in `/home/ianjl/projects/uw-platform-v0.2.0`, branch `build/v0.2.0`. Never commit to `main`, never force-push, never `--no-verify`.
- Read `AGENTS.md` sections 1, 4 and 10 before the first edit. When this plan and `AGENTS.md` disagree, `AGENTS.md` wins; record the conflict in `docs/progress_tracker.md` and build the version that keeps the rule.
- Words come from `CONTEXT.md`: **ship rule**, **freeze**, **finding weight**, **review round**, **hand-off**, **gate decision**, and this step's new **required check**, **carried approval**, **refuted finding**, **strictness preset** (Task 1). Never "code freeze", "severity", "auto-merge" or "escalation" for a hand-off.
- Commits: Conventional Commits, the agent as sole author, no attribution footer. Hooks always pass. Put the requirement IDs in each commit body.

**Code rules (all mechanically enforced by `pnpm verify`)**

- TypeScript `strict`, no `any`, no `@ts-ignore`, no `as unknown as`, no non-null assertion.
- No code comments of any kind.
- Files under 500 non-blank lines; functions under 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters. `apps/uw-app/github/facts/upsert.ts` is at the limit after step 14: Task 6 moves the files writer out before adding a line. `apps/uw-app/github/sweep.ts` gets no new line.
- Zod at every boundary. `packages/contracts` imports only `zod`. `packages/harness` imports nothing from Workers, Drizzle or the network.
- Every exported Zod schema registered in `packages/contracts/registry.ts` has `fixtures/<key>/valid/*.json` and `fixtures/<key>/invalid/*.json`. Any change to a registered `z.enum` appends a full entry to `packages/contracts/contract-lock.json` and changes `CONTRACT_VERSION`.
- `shipRule(` is called only in `packages/harness/gates/approve-at-ship.ts` and `packages/harness/ship-rule.ts`; `assembleShipInput(` only there and in `ship-input.ts`; `recordExitOutcomes(` only in `exit.ts` and `recover.ts`; `exitThroughConnector(` only in `approve-at-ship.ts` and `exit.ts` (`tools/architecture/connector-callers.test.ts`). This plan keeps every list unchanged.
- `gate_decisions` is written only by `tx.gateDecisions.write.insert` inside `packages/harness/gates/decide.ts` (`recordDecision`); the batch reuses that function and adds no second writer.
- Every route and command has `can()` on the harness's area through the command registry's `action`.
- UI: tokens only, sentence case, second person, no exclamation marks; Kindle orange (`HumanActionButton`) marks a human action: approve all, refute. Light, dark and phone width hold; every control has an accessible name and returns an outcome.

**Contract version**

- At planning time `packages/contracts/version.ts` reads `12.3.0`; step 14 moves it to the next minor (expected `12.4.0`). This step moves it to the next major after whatever is current (expected `13.0.0`), once, in Task 2 (S15-R17). Task 2 Step 6 reads the version and computes it.

**Migrations**

- One migration for the step, generated in Task 3 with `--name ship_rule_and_gates`, at the next index after step 14's (expected `0030`). It carries one hand-written statement, the S15-R1 backfill, appended after the generated SQL.

**Shared roots**

- `CONTEXT.md` and `docs/adr/` (Task 1), `packages/contracts/` (Task 2), `packages/db/schema.ts`, `packages/db/schema-github.ts` with the migration (Task 3), `packages/harness/ports.ts` and `packages/harness/store-ports.ts` with its mirror `packages/db/store/types.ts` (Task 4) are shared roots. Each change to one is its own commit with no feature code, and the message names the root and why. `docs/PRD.md` and the design are corrected in Task 1 in their own commit.
- Between Task 2 and Task 3 `tools/db/drift.test.ts` is red (the name checks derive from the enums). Between Task 4's port commit and its binding commit `pnpm check` is red. Do those pairs back to back.

**Tests**

- A test that proves a requirement has a `describe` or `it` title starting with the requirement ID and a space, as `tools/trace/proofs.ts` reads it. A scenario's `id` is the requirement ID.
- Run one file with `npx vitest run <path>`. Database tests (`*.pg.test.ts`, `packages/db`, the Store contract on the platform adapter) need `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres` after `pg_ctl -D ~/.local/share/uw-platform-test-pg -o "-p 54329" start`. Never run two Vitest suites at once on this machine (WSL runs out of memory); `pnpm verify` runs them in sequence.

## Review Focus

Inputs the spec implies that no requirement row spells out, most likely to bite first. Each line names the task that pins it.

1. A rebase (the approved commit no longer in the head's commit list) must not carry an approval even when the patch id matches. Task 5 pins `carriedCommits` returning `[]` when the approved commit is absent, and when a non-merge commit sits between it and the head.
2. A `Fixes #12` inside backticks or quotes in a pull request body still closes the issue on GitHub. Task 5 pins the quoted and the code-span forms refusing, and `prefix #12` not matching.
3. The ship rule changed between the person's click and the merge must stop the merge. Task 8 pins a head moved after the decision: the connector is never called and `connector_refused` names `ship_rule_refused`.
4. A batch with one refusing item must leave no row, no `gate_approved` and no `ship_refused` for the others. Task 9 pins the decision list and the event log unchanged after a refused batch.
5. A refused engine must not be retried by the backoff after 15 minutes. Task 10 pins `beat` after the backoff window has passed still starting nothing, and starting again once a person released the item.
6. A model writing `- Real: x` or `- real - x` must not slip an unweighted finding past the check. Task 11 pins the case-sensitive `weight: ` form and a refusal on the dash form.
7. A person must not refute the same finding twice into the rate. Task 12 pins the second refutation recording nothing and the tally counting one.

---

### Task 1: The words, the ADR amendment and the document corrections

**Files:**
- Modify: `CONTEXT.md` (four entries at the end of the v0.2.0 block, after **Silence alarm**)
- Modify: `docs/adr/0003-ship-gate-is-a-database-invariant-and-the-ship-rule-is-pure.md` (an amendment section at the end)
- Modify: `docs/PRD.md` (sections 8.1, 8.3, 8.5, 8.6)
- Modify: `docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` (section 6)

This task writes no code. Three commits, because `CONTEXT.md` and `docs/adr/` are each a shared root.

- [ ] **Step 1: Add the words (shared root `CONTEXT.md`)**

Append after the **Silence alarm** entry:

```markdown
**Required check**:
A check a harness names, by GitHub App and check name, that must have run on the head and passed before Ship. A harness that names none requires every check that ran on the head to have passed, and at least one to have run.
_Avoid_: required status, CI gate, branch protection (that is GitHub's)

**Carried approval**:
A Reviewer approval on an earlier head that counts on the current head because every commit since it is a merge and the change against the merge base is byte-identical (the same patch id). The gate decision names both heads.
_Avoid_: sticky approval, inherited review

**Refuted finding**:
A Reviewer finding a person marked wrong on the Gates view. The share of a Reviewer's findings refuted over 30 days is its refute rate.
_Avoid_: rejected finding (a gate is rejected), false positive

**Strictness preset**:
The persona-page line `approve_at`: `zero_findings` approves only with no findings at all; `no_real_or_plausible`, the default, approves when every finding is `theoretical`.
_Avoid_: threshold, severity level
```

```bash
git add CONTEXT.md
git commit -m "docs(context): required check, carried approval, refuted finding, strictness preset

Shared root CONTEXT.md. The four words step 15 introduces, before any code
uses them.

SR-1 SR-2 RV-2 RV-3."
```

- [ ] **Step 2: Amend ADR 0003 (shared root `docs/adr/`)**

Append to `docs/adr/0003-ship-gate-is-a-database-invariant-and-the-ship-rule-is-pure.md`:

```markdown
## Amendment, 2026-10-15 (v0.2.0 step 15)

The ship rule's inputs grow, and stay facts. Five GitHub facts join the head's checks and reviews: the head's distance behind its base, the closing references in the body and the commits, the skip-ci markers in the commits, and the commits and patch identity that let an approval carry across a merge from base (V2-6). Two harness columns join them: the harness's required checks, which replace this repository's six CI job names as a constant, and the freeze with its allow list (GD-2). The item's narrative record is still not an input. The rule is also run a second time, in the same process, immediately before the merge connector, and the connector merges only the head that second run evaluated (SR-3). Rejected: a stored verdict the merge reads, because a verdict written for one item or one head can be read for another.
```

```bash
git add docs/adr/0003-ship-gate-is-a-database-invariant-and-the-ship-rule-is-pure.md
git commit -m "docs(adr): ADR 0003 amended, the ship rule's v0.2.0 inputs and the second run

Shared root docs/adr. Records what SR-1, SR-2, SR-3 and GD-2 add to the
ship rule's inputs and why the merge evaluates rather than reads a verdict.

SR-1 SR-2 SR-3 GD-2."
```

- [ ] **Step 3: Correct the PRD and the design**

In `docs/PRD.md` section 8.1:
- The `harnesses` row's columns gain `shadow, external_reviewer_identities` (if step 14 did not add them), `frozen, freeze_allow, required_checks`.
- The `gh_*` row's facts gain "on `gh_prs` the closing references in the body (`closes`), and at the head the comparison with the base (`behind_by`, `patch_id`, `head_commits`) and the patch id of every head seen (`patch_ids`)".
- The `gate_decisions` row's columns become `harness, item, stage, actor, decision, reason, evidence (with the evaluated head and the counted approvals at Ship), trace id`.

In section 8.3, add rows: `| approve at (v0.2.0) | zero_findings, no_real_or_plausible |` and `| run failure (v0.2.0) | adds engine_refused, finding_weight_missing |`.

In section 8.5, after the "Added in v0.2.0" paragraph, add: "`engine_refused` and `finding_weight_missing` are also run-failure values; `engine_refused` is recorded as a run failure only and is never returned as a command refusal (S15-R12)."

In section 8.6, after the "Added in v0.2.0" paragraph, add: "`handed_to_person` gains the reason `engine_refused`, whose `rounds` is null (contract 13.0.0). `run_completed`'s review record carries its weighted findings."

In the design, section 6, replace "`gh_reviews`: `findings[].weight`, `findings[].refuted_by`, `refuted_at`. `measurements`: the refute-rate aggregate." with "`gh_reviews`: `findings[].weight` (read back from the posted review). A refutation is the event `finding_refuted`; the refute rate is a read over those events and the runs' review records, not a stored row (S15-R16)." and add "`harnesses`: `required_checks` (S15-R1)." to the tables line.

```bash
git add docs/PRD.md docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md
git commit -m "docs(prd): step 15's columns, sets and events, and the refute rate as a read

PRD sections 8.1, 8.3, 8.5 and 8.6 name what step 15 adds; the design's
section 6 records that refutations are events and the rate is derived
(S15-R16), and that required checks are a harness column (S15-R1).

SR-1 SR-2 GD-3 RV-1 RV-2."
```

---

### Task 2: The contracts at 13.0.0 (shared root `packages/contracts`)

**Files:**
- Modify: `packages/contracts/ship-rule.ts`, `outcomes.ts`, `closed-sets.ts`, `runs.ts`, `event-evidence.ts`, `events.ts`, `harness.ts`, `commands.ts`, `page-types.ts`, `gate-view.ts`, `shadow.ts` (step 14's), `registry.ts`
- Modify: `packages/contracts/contracts.test.ts`, `packages/contracts/events.test.ts`
- Create and modify: fixtures (Step 5)
- Modify: `packages/contracts/contract-lock.json`, `packages/contracts/version.ts`
- Second commit, not a shared root: the totals and the neutral fixes the types force (Step 9)

**Interfaces:**
- Produces every contract name in the hand-off table. `ShipRuleInput` is:

```ts
{
  pullRequest: { open: boolean; draft: boolean; head: string; behindBy: number | null; skipCi: boolean | null } | null;
  expectedHead: string | null;
  carries: string[];
  checks: { name: string; app: string | null; headSha: string; conclusion: CheckConclusion | null }[];
  requiredChecks: { app: string; name: string }[];
  approvals: { reviewer: string; commit: string; provider: string | null }[];
  closes: { repo: string; number: number }[];
  wraps: { repo: string; number: number } | null;
  riskTier; riskDomains; area; approver; at;
  frozen: boolean;
  override: boolean;
}
```

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/events.test.ts`, change the vocabulary test's count to the count on disk plus two and its last name to `'finding_refuted'` (step 14 left the last name `shadow_lifted`; the two new names follow it).

Append to `packages/contracts/contracts.test.ts` (import from the package's own files the way its neighbours do: `approveAtSchema`, `runFailureSchema` from `./closed-sets.ts`; `commandSchema` from `./commands.ts`; `errorReasonSchema` from `./outcomes.ts`; `eventEvidenceSchemas` from `./event-evidence.ts`; `harnessSchema` from `./harness.ts`; `personaFrontmatterSchema` from `./page-types.ts`; `reviewFindingSchema`, `reviewRecordSchema` from `./runs.ts`; `defaultCiChecks`, `shipRefusalSchema`, `shipRuleInputSchema` from `./ship-rule.ts`):

```ts
describe('SR-1 SR-2 GD-1 GD-2 GD-3 RV-1 RV-2 RV-3 the contracts for the ship rule and gates', () => {
  const requestId = '00000000-0000-4000-8000-0000000000aa';
  const itemId = '00000000-0000-4000-8000-0000000000b1';
  const head = 'a'.repeat(40);

  it('SR-1 appends five ship refusals, each also an error reason', () => {
    const added = ['base_behind', 'auto_close_keyword', 'skip_ci_marker', 'required_check_never_ran', 'harness_frozen'];
    expect(shipRefusalSchema.options.slice(-5)).toEqual(added);
    for (const reason of added) expect(errorReasonSchema.options).toContain(reason);
    expect(errorReasonSchema.options).toContain('finding_weight_missing');
  });

  it('SR-1 names the six CI jobs as the default required checks of github-actions', () => {
    expect(defaultCiChecks.map((check) => check.app)).toEqual(Array(6).fill('github-actions'));
    expect(defaultCiChecks).toHaveLength(6);
  });

  it('SR-1 SR-2 needs every new ship-rule input', () => {
    const input = {
      pullRequest: { open: true, draft: false, head, behindBy: 0, skipCi: false },
      expectedHead: head,
      carries: [],
      checks: [{ name: 'lint', app: 'github-actions', headSha: head, conclusion: 'success' }],
      requiredChecks: [{ app: 'github-actions', name: 'lint' }],
      approvals: [],
      closes: [],
      wraps: null,
      riskTier: 'standard',
      riskDomains: [],
      area: '80-89',
      approver: { identity: 'human:00000000-0000-4000-8000-000000000001', kind: 'person', personId: '00000000-0000-4000-8000-000000000001', email: 'ian@unfoldingword.org', grants: [], interactive: true },
      at: '2026-10-15T09:00:00.000Z',
      frozen: false,
      override: false,
    };
    expect(shipRuleInputSchema.safeParse(input).success).toBe(true);
    const unfrozen = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'frozen'));
    expect(shipRuleInputSchema.safeParse(unfrozen).success).toBe(false);
  });

  it('GD-2 SR-1 reads an older harness row as unfrozen with no required checks', () => {
    const older = { id: '00000000-0000-4000-8000-0000000000a1', key: 'software', template: 'software', jdArea: '80-89', repository: 'unfoldingWord/uw-platform', hostedBuilderEnabled: false, paused: false };
    expect(harnessSchema.parse(older)).toMatchObject({ frozen: false, freezeAllow: [], requiredChecks: [] });
  });

  it('GD-2 sets a freeze with its allow list and lifts it only with an empty list', () => {
    const set = { command: 'set_freeze', requestId, frozen: true, allow: [itemId] };
    expect(commandSchema.safeParse(set).success).toBe(true);
    expect(commandSchema.safeParse({ ...set, frozen: false }).success).toBe(false);
    expect(commandSchema.safeParse({ ...set, frozen: false, allow: [] }).success).toBe(true);
    expect(commandSchema.safeParse({ ...set, allow: [itemId, itemId] }).success).toBe(false);
  });

  it('GD-1 decides a batch of one to fifty pinned entries, each item once', () => {
    const entry = { itemId, head, decision: 'approve' };
    const batch = { command: 'decide_gates', requestId, entries: [entry] };
    expect(commandSchema.safeParse(batch).success).toBe(true);
    expect(commandSchema.safeParse({ ...batch, entries: [] }).success).toBe(false);
    expect(commandSchema.safeParse({ ...batch, entries: [entry, entry] }).success).toBe(false);
    expect(commandSchema.safeParse({ ...batch, entries: [{ ...entry, decision: 'override' }] }).success).toBe(false);
  });

  it('GD-3 fails a run engine_refused and hands it over with no round count', () => {
    expect(runFailureSchema.options).toContain('engine_refused');
    const handed = eventEvidenceSchemas.handed_to_person;
    const personId = '00000000-0000-4000-8000-000000000001';
    expect(handed.safeParse({ personId, why: 'engine_refused', rounds: null }).success).toBe(true);
    expect(handed.safeParse({ personId, why: 'engine_refused', rounds: 1 }).success).toBe(false);
    expect(handed.safeParse({ personId, why: 'review_rounds_exhausted', rounds: null }).success).toBe(false);
  });

  it('RV-1 requires a weight on every finding of a Reviewer verdict', () => {
    expect(reviewFindingSchema.safeParse({ text: 'The lease is late.', weight: 'real' }).success).toBe(true);
    expect(reviewFindingSchema.safeParse({ text: 'The lease is late.' }).success).toBe(false);
    const record = { reviewer: 'uw-reviewer', provider: 'deepinfra', model: 'z-ai/glm-5.3', verdict: 'approve', reviewId: null };
    expect(reviewRecordSchema.parse(record)).toMatchObject({ findings: [] });
    expect(runFailureSchema.options).toContain('finding_weight_missing');
  });

  it('RV-2 refutes one finding of one run by index', () => {
    const refute = { command: 'refute_finding', requestId, itemId, runId: '00000000-0000-4000-8000-0000000000d1', finding: 0 };
    expect(commandSchema.safeParse(refute).success).toBe(true);
    expect(commandSchema.safeParse({ ...refute, finding: 50 }).success).toBe(false);
  });

  it('RV-3 defaults the strictness preset to no_real_or_plausible', () => {
    expect(approveAtSchema.options).toEqual(['zero_findings', 'no_real_or_plausible']);
    const page = {
      identity: 'agent:reviewer',
      owner: 'human:00000000-0000-4000-8000-000000000001',
      harness: '00000000-0000-4000-8000-0000000000a1',
      toolset: ['read_page'],
      run_shape: 'workflow-run',
      engine: 'openrouter-messages',
      model: 'z-ai/glm-5.3-flash',
      budget: { monthly_minor: 0, currency: 'USD' },
      capability: 'review',
    };
    expect(personaFrontmatterSchema.parse(page)).toMatchObject({ approve_at: 'no_real_or_plausible' });
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/contracts/contracts.test.ts packages/contracts/events.test.ts`
Expected: FAIL; `defaultCiChecks`, `reviewFindingSchema`, `approveAtSchema` are undefined and the counts differ.

- [ ] **Step 3: Write the contracts**

`packages/contracts/ship-rule.ts`. Append the five values to `shipRefusalSchema` after `'approver_lacks_domain_grant',`:

```ts
  'base_behind',
  'auto_close_keyword',
  'skip_ci_marker',
  'required_check_never_ran',
  'harness_frozen',
```

Below `fullShaSchema`, add (this file must not import `harness.ts`, which imports it, so the repository shape is written here):

```ts
export const requiredCheckSchema = z.strictObject({
  app: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  name: z.string().min(1).max(200),
});

const distinctChecks = (checks: readonly { readonly app: string; readonly name: string }[]) =>
  new Set(checks.map((check) => `${check.app} ${check.name}`)).size === checks.length;

export const requiredChecksSchema = z
  .array(requiredCheckSchema)
  .max(30)
  .refine(distinctChecks, 'each required check once');

export const defaultCiChecks: readonly z.infer<typeof requiredCheckSchema>[] =
  ciJobSchema.options.map((name) => ({ app: 'github-actions', name }));

export const closingRefSchema = z.strictObject({
  repo: z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/),
  number: z.number().int().min(1),
});
```

Replace `shipRuleInputSchema` with:

```ts
export const shipRuleInputSchema = z.strictObject({
  pullRequest: z
    .strictObject({
      open: z.boolean(),
      draft: z.boolean(),
      head: sha,
      behindBy: z.number().int().min(0).nullable(),
      skipCi: z.boolean().nullable(),
    })
    .nullable(),
  expectedHead: sha.nullable(),
  carries: z.array(sha).max(250),
  checks: z.array(
    z.strictObject({
      name: z.string().min(1),
      app: z.string().min(1).nullable(),
      headSha: sha,
      conclusion: checkConclusionSchema.nullable(),
    }),
  ),
  requiredChecks: requiredChecksSchema,
  approvals: z.array(
    z.strictObject({
      reviewer: z.string().min(1),
      commit: sha,
      provider: z.string().min(1).nullable(),
    }),
  ),
  closes: z.array(closingRefSchema).max(100),
  wraps: closingRefSchema.nullable(),
  riskTier: riskTierSchema.nullable(),
  riskDomains: riskDomainsSchema,
  area: jdAreaSchema,
  approver: principalSchema,
  at: z.iso.datetime(),
  frozen: z.boolean(),
  override: z.boolean(),
});
```

and add the types:

```ts
export type RequiredCheck = z.infer<typeof requiredCheckSchema>;
export type ClosingRef = z.infer<typeof closingRefSchema>;
```

`packages/contracts/outcomes.ts`: append to `errorReasonSchema` (after the last value step 14 added):

```ts
  'base_behind',
  'auto_close_keyword',
  'skip_ci_marker',
  'required_check_never_ran',
  'harness_frozen',
  'finding_weight_missing',
```

`packages/contracts/closed-sets.ts`: append `'engine_refused', 'finding_weight_missing'` to `runFailureSchema`; add beside `findingWeightSchema`:

```ts
export const approveAtSchema = z.enum(['zero_findings', 'no_real_or_plausible']);
```

and `export type ApproveAt = z.infer<typeof approveAtSchema>;` beside `FindingWeight`.

`packages/contracts/runs.ts`: import `findingWeightSchema` with `reviewVerdictSchema`; above `reviewRecordSchema`:

```ts
const findingText = z.string().min(1).max(500);
export const reviewFindingSchema = z.strictObject({ text: findingText, weight: findingWeightSchema });
export const readFindingSchema = z.strictObject({
  text: findingText,
  weight: findingWeightSchema.nullable(),
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type ReadFinding = z.infer<typeof readFindingSchema>;
```

and in `reviewRecordSchema`, after `reviewId`: `findings: z.array(reviewFindingSchema).max(50).default([]),`.

`packages/contracts/event-evidence.ts`:
- `handOffReasonSchema = z.enum(['review_rounds_exhausted', 'engine_refused']);`
- import `findingWeightSchema` from `./closed-sets.ts`, `reviewFindingSchema` from `./runs.ts`.
- `handed_to_person` becomes:

```ts
  handed_to_person: z
    .strictObject({
      personId: id,
      why: handOffReasonSchema,
      rounds: z.number().int().min(1).nullable(),
    })
    .refine(
      (handed) => (handed.why === 'review_rounds_exhausted') === (handed.rounds !== null),
      'only review rounds name a round count',
    ),
```

- step 14's `review_verdict_recorded.findings` becomes `z.array(reviewFindingSchema).max(50),`.
- add to `gateEvidence`:

```ts
  finding_refuted: z.strictObject({
    runId: id,
    persona: identitySchema,
    reviewer: z.string().regex(/^[a-z0-9-]{1,64}$/),
    index: z.number().int().min(0).max(49),
    weight: findingWeightSchema,
    text,
  }),
```

- add to `harnessEvidence`: `freeze_changed: z.strictObject({ frozen: z.boolean(), allow: z.array(id).max(100) }),`.

Before relying on a refined `handed_to_person`, run `grep -rn "handed_to_person.shape\|handed_to_person\.extend" packages apps sim`; expect nothing.

`packages/contracts/events.ts`: append `'freeze_changed', 'finding_refuted',` after step 14's last name.

`packages/contracts/harness.ts`: import `requiredChecksSchema` with `fullShaSchema` from `./ship-rule.ts`; in `harnessSchema` after step 14's two fields:

```ts
  frozen: z.boolean().default(false),
  freezeAllow: z.array(z.uuid()).max(100).default([]),
  requiredChecks: requiredChecksSchema.default([]),
```

`packages/contracts/commands.ts`: import `requiredChecksSchema` with `fullShaSchema`; append `'set_freeze', 'decide_gates', 'refute_finding'` to `commandNames`; add above `harnessCommandSchemas`:

```ts
const itemIdList = z
  .array(itemId)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, 'each item once');

const batchEntrySchema = z.strictObject({
  itemId,
  head: fullShaSchema,
  decision: z.enum(['approve', 'reject']),
});

const setFreezeSchema = body('set_freeze', { frozen: z.boolean(), allow: itemIdList }).refine(
  (command) => command.frozen || command.allow.length === 0,
  'lifting a freeze names no item',
);
```

in `harnessCommandSchemas`, `activate_template` gains `requiredChecks: requiredChecksSchema.default([]),` and three entries follow step 14's `set_shadow`:

```ts
  set_freeze: setFreezeSchema,
  decide_gates: body('decide_gates', {
    entries: z
      .array(batchEntrySchema)
      .min(1)
      .max(50)
      .refine(
        (entries) => new Set(entries.map((entry) => entry.itemId)).size === entries.length,
        'each item once',
      ),
  }),
  refute_finding: body('refute_finding', {
    itemId,
    runId: z.uuid(),
    finding: z.number().int().min(0).max(49),
  }),
```

and add the three to the end of the `commandSchema` union.

`packages/contracts/page-types.ts`: import `approveAtSchema`; in `personaFrontmatterSchema` after `capability`: `approve_at: approveAtSchema.default('no_real_or_plausible'),`.

`packages/contracts/gate-view.ts`: import `reviewVerdictSchema` from `./closed-sets.ts`, `identitySchema` from `./identity.ts`, `readFindingSchema`, `reviewFindingSchema` from `./runs.ts`. In `shipInputSchema`'s `checks` object add `app: z.string().min(1).max(100).nullable(),` after `name`. In `reviewSchema` change `findings` to `z.array(readFindingSchema).max(50),`. Add:

```ts
const verdictSchema = z.strictObject({
  runId: z.uuid(),
  persona: identitySchema,
  reviewer: z.string().regex(/^[a-z0-9-]{1,64}$/),
  verdict: reviewVerdictSchema,
  findings: z.array(reviewFindingSchema.extend({ refuted: z.boolean() })).max(50),
});
```

and in `gateViewSchema` after `reviews`: `verdicts: z.array(verdictSchema).max(20).default([]),`.

`packages/contracts/shadow.ts` (step 14): in `recordedSchema` change `findings` to `z.array(reviewFindingSchema).max(50),` importing `reviewFindingSchema` from `./runs.ts`.

`packages/contracts/registry.ts`: import the new schemas and add beside their neighbours:

```ts
  'approve-at': closedSets.approveAtSchema,
  'review-finding': reviewFindingSchema,
  'read-finding': readFindingSchema,
  'required-check': requiredCheckSchema,
  'closing-ref': closingRefSchema,
```

- [ ] **Step 4: Run the new tests**

Run: `npx vitest run packages/contracts/contracts.test.ts packages/contracts/events.test.ts`
Expected: the new block and the vocabulary test pass; `golden fixtures` and `CT-3 the contract lock` still fail until Steps 5 and 6.

- [ ] **Step 5: Write and update the fixtures**

Run from the repository root:

```bash
node --input-type=module -e '
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
const root = "packages/contracts/fixtures";
const write = (path, value) => {
  const file = `${root}/${path}`;
  mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
};
const read = (path) => JSON.parse(readFileSync(`${root}/${path}`, "utf8"));
const inputOf = (input) => ({
  ...input,
  pullRequest: input.pullRequest === null ? null : { ...input.pullRequest, behindBy: 0, skipCi: false },
  carries: [],
  checks: input.checks.map((check) => ({ ...check, app: "github-actions" })),
  requiredChecks: input.checks.map((check) => ({ app: "github-actions", name: check.name })).filter((check, index, all) => all.findIndex((other) => other.name === check.name) === index),
  closes: [],
  wraps: null,
  frozen: false,
});
for (const name of readdirSync(`${root}/ship-rule-input/valid`)) {
  write(`ship-rule-input/valid/${name}`, inputOf(read(`ship-rule-input/valid/${name}`)));
}
const findingsOf = (review) => ({ ...review, findings: review.findings.map((text) => (typeof text === "string" ? { text, weight: null } : text)) });
for (const side of ["valid", "invalid"]) {
  for (const name of readdirSync(`${root}/gate-view/${side}`)) {
    const view = read(`gate-view/${side}/${name}`);
    const reviews = Array.isArray(view.reviews) ? view.reviews.map(findingsOf) : view.reviews;
    const ship = view.ship && view.ship.input ? { ...view.ship, input: inputOf(view.ship.input) } : view.ship;
    write(`gate-view/${side}/${name}`, { ...view, reviews, ship });
  }
}
const head = "a".repeat(40);
const harnessId = "00000000-0000-4000-8000-0000000000a1";
const itemId = "00000000-0000-4000-8000-0000000000b1";
const runId = "00000000-0000-4000-8000-0000000000d1";
const requestId = "00000000-0000-4000-8000-0000000000aa";
const ian = "human:00000000-0000-4000-8000-000000000001";
const event = (n, name, item, actor, evidence) => ({
  eventId: `00000000-0000-4000-8000-0000000001e${n}`,
  harnessId, itemId: item, name, position: n, at: "2026-10-15T09:00:00.000Z", actor, evidence,
  traceId: "00000000-0000-4000-8000-0000000000c1", requestId: null,
});
write("event/valid/freeze-changed.json", event(1, "freeze_changed", null, ian, { frozen: true, allow: [itemId] }));
write("event/valid/finding-refuted.json", event(2, "finding_refuted", itemId, ian, { runId, persona: "agent:reviewer", reviewer: "uw-reviewer", index: 0, weight: "plausible", text: "The empty state is dropped." }));
write("event/invalid/finding-refuted-index-too-high.json", event(2, "finding_refuted", itemId, ian, { runId, persona: "agent:reviewer", reviewer: "uw-reviewer", index: 50, weight: "real", text: "x" }));
write("event/valid/handed-to-person-engine-refused.json", event(3, "handed_to_person", itemId, "agent:reviewer", { personId: "00000000-0000-4000-8000-000000000001", why: "engine_refused", rounds: null }));
write("event/invalid/handed-to-person-rounds-without-count.json", event(3, "handed_to_person", itemId, "agent:reviewer", { personId: "00000000-0000-4000-8000-000000000001", why: "review_rounds_exhausted", rounds: null }));
write("command/valid/set-freeze.json", { command: "set_freeze", requestId, frozen: true, allow: [itemId] });
write("command/valid/lift-freeze.json", { command: "set_freeze", requestId, frozen: false, allow: [] });
write("command/invalid/lift-freeze-with-items.json", { command: "set_freeze", requestId, frozen: false, allow: [itemId] });
write("command/valid/decide-gates.json", { command: "decide_gates", requestId, entries: [{ itemId, head, decision: "approve" }] });
write("command/invalid/decide-gates-empty.json", { command: "decide_gates", requestId, entries: [] });
write("command/valid/refute-finding.json", { command: "refute_finding", requestId, itemId, runId, finding: 0 });
write("command/invalid/refute-finding-negative.json", { command: "refute_finding", requestId, itemId, runId, finding: -1 });
write("harness/valid/frozen-with-required-checks.json", { id: harnessId, key: "software", template: "software", jdArea: "80-89", repository: "unfoldingWord/uw-platform", hostedBuilderEnabled: false, paused: false, frozen: true, freezeAllow: [itemId], requiredChecks: [{ app: "github-actions", name: "lint" }] });
write("harness/invalid/required-check-twice.json", { id: harnessId, key: "software", template: "software", jdArea: "80-89", repository: "unfoldingWord/uw-platform", hostedBuilderEnabled: false, paused: false, requiredChecks: [{ app: "github-actions", name: "lint" }, { app: "github-actions", name: "lint" }] });
write("approve-at/valid/first.json", "zero_findings");
write("approve-at/valid/last.json", "no_real_or_plausible");
write("approve-at/invalid/unknown.json", "any_findings");
write("review-finding/valid/real.json", { text: "The lease is late.", weight: "real" });
write("review-finding/invalid/no-weight.json", { text: "The lease is late." });
write("read-finding/valid/unweighted.json", { text: "The lease is late.", weight: null });
write("read-finding/invalid/empty-text.json", { text: "", weight: null });
write("required-check/valid/lint.json", { app: "github-actions", name: "lint" });
write("required-check/invalid/app-with-space.json", { app: "github actions", name: "lint" });
write("closing-ref/valid/issue.json", { repo: "unfoldingWord/uw-platform", number: 12 });
write("closing-ref/invalid/no-owner.json", { repo: "uw-platform", number: 12 });
write("review-record/valid/with-weighted-findings.json", { reviewer: "uw-reviewer", provider: "deepinfra", model: "z-ai/glm-5.3", verdict: "request_changes", reviewId: 9300000001, findings: [{ text: "The empty state is dropped.", weight: "real" }] });
write("review-record/invalid/unweighted-finding.json", { reviewer: "uw-reviewer", provider: "deepinfra", model: "z-ai/glm-5.3", verdict: "request_changes", reviewId: 9300000001, findings: [{ text: "The empty state is dropped." }] });
write("error-reason/valid/finding-weight-missing.json", "finding_weight_missing");
write("ship-refusal/valid/harness-frozen.json", "harness_frozen");
'
npx prettier --write packages/contracts/fixtures
```

Before running it: list `packages/contracts/fixtures/event/valid` and copy the `eventId` style an existing fixture uses (each fixture's `eventId` must be a UUID; the script's are). Confirm `fixtures/ship-refusal`, `fixtures/error-reason` and `fixtures/review-record` exist under those names; if one differs, write into the existing directory. The gate-view `with-reviews.json` fixture now carries `{ text, weight: null }` findings; read it after the script and confirm.

- [ ] **Step 6: Append the lock entry and bump the major version**

```bash
node -e '
const fs = require("node:fs");
const p = "packages/contracts/contract-lock.json";
const versionFile = "packages/contracts/version.ts";
const current = /CONTRACT_VERSION = .(\d+)\.(\d+)\.(\d+)./.exec(fs.readFileSync(versionFile, "utf8"));
const next = `${Number(current[1]) + 1}.0.0`;
const lock = JSON.parse(fs.readFileSync(p, "utf8"));
const last = lock.versions.at(-1).sets;
const add = (key, values) => [...last[key], ...values.filter((value) => !last[key].includes(value))];
const refusals = ["base_behind", "auto_close_keyword", "skip_ci_marker", "required_check_never_ran", "harness_frozen"];
const sets = { ...last,
  "ship-refusal": add("ship-refusal", refusals),
  "error-reason": add("error-reason", [...refusals, "finding_weight_missing"]),
  "event-name": add("event-name", ["freeze_changed", "finding_refuted"]),
  "command-name": add("command-name", ["set_freeze", "decide_gates", "refute_finding"]),
  "run-failure": add("run-failure", ["engine_refused", "finding_weight_missing"]),
  "hand-off-reason": add("hand-off-reason", ["engine_refused"]),
  "approve-at": ["zero_findings", "no_real_or_plausible"] };
const sorted = Object.fromEntries(Object.entries(sets).sort(([a], [b]) => a.localeCompare(b)));
lock.versions.push({ version: next, sets: sorted });
fs.writeFileSync(p, JSON.stringify(lock, null, 2) + "\n");
fs.writeFileSync(versionFile, fs.readFileSync(versionFile, "utf8").replace(/CONTRACT_VERSION = .\d+\.\d+\.\d+./, `CONTRACT_VERSION = \x27${next}\x27`));
console.log(next);
'
npx prettier --write packages/contracts/contract-lock.json packages/contracts/version.ts
```

Expected: prints `13.0.0`. A major, because the finding weight is required and the ship-rule input gains required fields (S15-R17). If the lock test names an enum the script missed (a registered `z.enum` this task changed that is not in the list), add it the same way and re-run from a clean lock (`git checkout packages/contracts/contract-lock.json packages/contracts/version.ts` first).

- [ ] **Step 7: Run the contracts tests**

Run: `npx vitest run packages/contracts`
Expected: all green, including `golden fixtures`, `CT-3 the contract lock`, `contract version`, `WB-1 every control is a command with a requestId`.

- [ ] **Step 8: Find every pin of the old version and commit (shared root)**

```bash
grep -rn "12\.4\.0" --include='*.ts' --include='*.sql' packages apps sim tools | grep -v node_modules | grep -v contract-lock.json
```

Use the version you replaced. A `.ts` file that calls `assertLiveContractVersion` with it changes to `13.0.0` in this commit; a file that only lists names stays.

```bash
git add packages/contracts
git commit -m "feat(contracts)!: the ship rule's new inputs, batch and freeze, weighted findings (13.0.0)

Shared root packages/contracts. Five ship refusals and their inputs
(required checks, the base comparison, closing references, the freeze),
set_freeze, decide_gates, refute_finding, freeze_changed, finding_refuted,
the engine_refused hand-off, and a required weight on every Reviewer
finding. Breaking, so a major version.

SR-1 SR-2 GD-1 GD-2 GD-3 RV-1 RV-2 RV-3. S15-R1 S15-R12 S15-R13 S15-R17."
```

- [ ] **Step 9: The totals and the neutral fixes the types force (second commit)**

These keep `pnpm check` and the existing tests green with no behaviour change; later tasks replace every neutral value.

1. `packages/harness/items/fold.ts`, `unchangedNames`: add `'freeze_changed'`, `'finding_refuted'`.
2. `apps/uw-app/commands/registry.ts`: `notWiredCommand('set_freeze', 'admin')`, `notWiredCommand('decide_gates', 'admin')`, `notWiredCommand('refute_finding', 'write')` at the end; `apps/uw-app/commands/registry.test.ts`: `set_freeze: 'admin', decide_gates: 'admin', refute_finding: 'write',` in `actions`.
3. `packages/harness/gates/ship-input.ts`, `fromFacts`: the `pullRequest` object gains `behindBy: 0, skipCi: false`; both return branches gain `carries: []`, `closes: []`; `latestChecks` maps `app: check.app`; `assembleShipInput` gains `wraps: null`, `requiredChecks: [...defaultCiChecks]` (import from `@uw/contracts`), `frozen: false`. The rule still reads `ciJobSchema` until Task 5, so this changes nothing.
4. `packages/harness/ship-rule.test.ts`, `green()`: add `carries: [], closes: [], wraps: null, frozen: false, requiredChecks: [...defaultCiChecks]`, `pullRequest: { …, behindBy: 0, skipCi: false }`, and `app: 'github-actions'` on each check (and in `withChecks` callers that build checks). `packages/contracts/harness.test.ts`: the same additions wherever it parses a ship-rule input.
5. `packages/harness/gates/ship-input.ts`, `reviewsOn`: `findings: counted.review.findings.map((text) => ({ text, weight: null }))` (Task 4 changes `ReviewFact.findings` and removes the map).
6. `packages/harness/runs/review.ts`: the `record` in `plannedFrom` gains `findings: []`; step 14's `shadowReview` writes `findings: []` on `review_verdict_recorded` instead of `boundedFindings(...)` (delete `boundedFindings` and its two constants if then unused; grep first). Step 14's `packages/harness/gates/shadow-verdict.ts` maps `findings: recorded.findings.map((finding) => finding.text)`. Task 11 restores the findings.
7. `packages/harness/views/types.ts`: the `handed_to_person` waiting row's `rounds: number | null`; `packages/harness/views/waiting.ts`: `HandOff.rounds: number | null`; `apps/uw-app/views/screens/home.tsx`: the hand-off text becomes

```tsx
      text:
        row.rounds === null
          ? `${row.item.title} was handed to you because an engine refused it`
          : `${row.item.title} was handed to you after ${roundsText(row.rounds)} review rounds`,
```

8. Every `Harness` literal `pnpm check` names (expect `packages/harness/stages/activate.ts`, `packages/db/store/rows.ts` `toHarness`, port-contract fixtures): `frozen: false, freezeAllow: [], requiredChecks: []`. In `toHarness` read `row.frozen`, `row.freezeAllow`, `row.requiredChecks` only after Task 3; for now pass the defaults through `harnessSchema.parse` by omitting them (the schema fills them).
9. Every persona frontmatter literal typed as the parsed frontmatter: `approve_at: 'no_real_or_plausible'`.
10. `apps/uw-app/commands/handler.ts`: add `'decide_gates'` to `gateCommands` (it opens the gate GitHub like `approve`).
11. `apps/uw-app/views/parts/gate-panel.tsx`, `Findings`: render `{finding.text}` (the view's review findings are now objects; Task 12 adds the weight). Step 14's `apps/uw-app/views/parts/shadow-list.tsx` (or wherever it renders the recorded findings): render `finding.text` the same way.

Regenerate the islands bundle: `pnpm ui:islands`.

Run: `pnpm check && npx vitest run packages/contracts packages/harness apps/uw-app/commands/registry.test.ts tools/ui/generated-islands.test.ts` then `pnpm sim -- all`
Expected: green. `tools/db/drift.test.ts` is red until Task 3. If `pnpm check` names a site this list does not, apply the same rule: the neutral value that keeps today's behaviour.

```bash
git add -A packages/harness apps/uw-app sim
git commit -m "chore: the totals and neutral values the 13.0.0 contracts force

The new events fold to nothing, the three commands are registered not
wired, the ship-rule input carries neutral new fields, findings read back
unweighted, and a hand-off may carry no round count. No behaviour changes;
Tasks 4 to 12 replace each neutral value.

SR-1 GD-1 GD-2 GD-3 RV-1 RV-2."
```

(Stage only the files you changed; `git status` first. `-A` on these three roots is safe only if nothing else is modified.)

---

### Task 3: The columns and the migration (shared root `packages/db/schema.ts`, `schema-github.ts`)

**Files:**
- Modify: `packages/db/schema.ts` (`harnesses`: three columns, two checks)
- Modify: `packages/db/schema-github.ts` (`gh_prs`: five columns, one check)
- Create: `packages/db/migrations/00NN_ship_rule_and_gates.sql` and its snapshot and journal entry (generated), with one appended statement
- Create: `packages/db/ship-rule-columns.test.ts`

**Interfaces:**
- Produces: `harnesses.frozen boolean NOT NULL DEFAULT false`, `harnesses.freeze_allow uuid[] NOT NULL DEFAULT '{}'` (at most 100), `harnesses.required_checks jsonb NOT NULL DEFAULT '[]'` (an array); `gh_prs.closes jsonb NOT NULL DEFAULT '[]'`, `gh_prs.behind_by integer` (null or at least 0), `gh_prs.patch_id text`, `gh_prs.head_commits jsonb`, `gh_prs.patch_ids jsonb NOT NULL DEFAULT '{}'`. Drizzle fields `frozen`, `freezeAllow`, `requiredChecks`, `closes`, `behindBy`, `patchId`, `headCommits`, `patchIds`.

- [ ] **Step 1: Write the failing test**

`packages/db/ship-rule-columns.test.ts`, copying step 14's `packages/db/joining-columns.test.ts` frame (`openDatabase`, `refusal`, `databaseTargets`):

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

function shipRuleColumns(db: () => Db): void {
  it('GD-2 SR-1 a harness starts unfrozen with no allow list and no required checks', async () => {
    await db().execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
      VALUES (gen_random_uuid(), 'ship-defaults', 'software', '80-89', now())`);
    const rows = await db().execute<{ frozen: boolean; allow: string[]; checks: unknown }>(
      sql`SELECT frozen, freeze_allow AS allow, required_checks AS checks FROM harnesses WHERE key = 'ship-defaults'`,
    );
    expect(rows[0]).toEqual({ frozen: false, allow: [], checks: [] });
  });

  it('SR-1 refuses required checks that are not an array by harnesses_required_checks_array', async () => {
    const insert = db().execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at, required_checks)
      VALUES (gen_random_uuid(), 'ship-object', 'software', '80-89', now(), '{}'::jsonb)`);
    expect(await refusal(insert)).toEqual({ code: '23514', constraint: 'harnesses_required_checks_array' });
  });

  it('SR-1 refuses a negative distance behind the base by gh_prs_behind_by_counted', async () => {
    const checks = await db().execute<{ definition: string }>(sql`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'gh_prs_behind_by_counted'`);
    expect(checks[0]?.definition).toContain('behind_by >= 0');
  });

  it('GD-2 RV-2 admits the new event, command and run-failure names', async () => {
    const checks = await db().execute<{ definition: string }>(sql`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conname IN ('harness_events_name_known', 'command_requests_command_known')`);
    const text = checks.map((row) => row.definition).join(' ');
    for (const name of ['freeze_changed', 'finding_refuted', 'set_freeze', 'decide_gates', 'refute_finding']) {
      expect(text).toContain(`'${name}'`);
    }
  });
}

describe('the ship rule and gate columns', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => shipRuleColumns(openDatabase(target)),
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/db/ship-rule-columns.test.ts`
Expected: FAIL, column `frozen` does not exist.

- [ ] **Step 3: Add the columns**

`packages/db/schema.ts`, in `harnesses` after step 14's `externalReviewerIdentities`:

```ts
    frozen: boolean('frozen').notNull().default(false),
    freezeAllow: uuid('freeze_allow')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    requiredChecks: jsonb('required_checks')
      .notNull()
      .default(sql`'[]'::jsonb`),
```

and in its checks:

```ts
    check('harnesses_freeze_allow_bounded', sql`cardinality(${t.freezeAllow}) <= 100`),
    check('harnesses_required_checks_array', sql`jsonb_typeof(${t.requiredChecks}) = 'array'`),
```

(import `uuid` and `jsonb` from `drizzle-orm/pg-core` if the file does not already).

`packages/db/schema-github.ts`, in `ghPrs` after step 14's `requestedReviewers`:

```ts
    closes: jsonb('closes')
      .notNull()
      .default(sql`'[]'::jsonb`),
    behindBy: integer('behind_by'),
    patchId: text('patch_id'),
    headCommits: jsonb('head_commits'),
    patchIds: jsonb('patch_ids')
      .notNull()
      .default(sql`'{}'::jsonb`),
```

and in its checks: `check('gh_prs_behind_by_counted', sql\`${t.behindBy} IS NULL OR ${t.behindBy} >= 0\`),`.

- [ ] **Step 4: Generate the migration and append the backfill**

Run: `pnpm --filter @uw/db exec drizzle-kit generate --name ship_rule_and_gates`
Expected: one new file `packages/db/migrations/00NN_ship_rule_and_gates.sql` with the three `harnesses` columns, the five `gh_prs` columns, the three checks, and a drop-and-add of `harness_events_name_known`, `command_requests_command_known` and the run-failure check on `harness_runs` (its name is whatever the schema calls it; read the file) with the new values. Read the file; if it contains anything else, stop and find out why.

Append, as the file's last statement (S15-R1):

```sql
--> statement-breakpoint
UPDATE "harnesses" SET "required_checks" = '[{"app":"github-actions","name":"security-audit"},{"app":"github-actions","name":"lint"},{"app":"github-actions","name":"typecheck"},{"app":"github-actions","name":"architecture"},{"app":"github-actions","name":"test"},{"app":"github-actions","name":"build"}]'::jsonb WHERE lower("repository") = 'unfoldingword/uw-platform';
```

Copy the breakpoint marker exactly as the generated file writes it between statements.

- [ ] **Step 5: Run the database tests and the drift test**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/db tools/db/drift.test.ts`
Expected: green, including `migrations`, `the ship rule and gate columns` on both targets and `schema drift`. The drift test compares the schema with the generated snapshot; the appended `UPDATE` changes no shape.

- [ ] **Step 6: Commit (shared root)**

```bash
git add packages/db/schema.ts packages/db/schema-github.ts packages/db/migrations packages/db/ship-rule-columns.test.ts
git commit -m "feat(db): freeze, required checks and the base comparison

Shared root packages/db/schema.ts and schema-github.ts, one migration for
step 15. harnesses.frozen, freeze_allow and required_checks are written by
the stage command; gh_prs.closes, behind_by, patch_id, head_commits and
patch_ids by the facts module. The harness on unfoldingWord/uw-platform is
backfilled with its six CI jobs. The event, command and run-failure checks
admit 13.0.0's names.

SR-1 SR-2 GD-2. S15-R1 S15-R5 S15-R6."
```

---

### Task 4: The ports, the Store's freeze write and the facts every test reads (shared roots `ports.ts`, `store-ports.ts`)

**Files:**
- Modify: `packages/harness/ports.ts` (`ReviewFact.findings`, `HeadCommit`, `BaseComparison`, two `PullRequestFacts` fields)
- Modify: `packages/harness/store-ports.ts` and its mirror `packages/db/store/types.ts` (`HarnessesGateway.write.setFreeze`)
- Modify: `packages/db/store/harnesses.ts` (`setFreeze`), `packages/db/store/rows.ts` (`toHarness`)
- Create: `packages/harness/port-contracts/store-freeze.ts`; Modify: `packages/harness/port-contracts/store.ts` (wire it)
- Modify: `apps/uw-app/github/facts/queries.ts` (`pullRequestFacts` reads `closes` and the comparison; findings read back weighted or not)
- Modify: `packages/harness/stages/activate.ts` (`ActivateInput.requiredChecks`), `apps/uw-app/commands/person/stages.ts` (passes `body.requiredChecks`)
- Modify: `sim/ship-fixtures.ts` (`comparedAt`, `simPatchId`, `greenFacts`), `sim/fixtures.ts` (`requiredChecks` option, default `defaultCiChecks`)
- Modify: `apps/uw-app/github/testing/facts-fixtures.ts`, the app activation helpers (`apps/uw-app/testing/commands.ts`, `apps/uw-app/github/testing/ship-rig.ts`, `import-rig.ts`, `apps/uw-app/testing/board-world.ts`), and every `PullRequestFacts` literal `pnpm check` names
- Modify: `packages/harness/gates/ship-input.ts` (`reviewsOn` drops Task 2's string map)

**Interfaces:**
- Produces:

```ts
export type HeadCommit = {
  readonly sha: string;
  readonly merge: boolean;
  readonly skipCi: boolean;
  readonly closes: readonly ClosingRef[];
};
export type BaseComparison = {
  readonly head: string;
  readonly base: string;
  readonly behindBy: number | null;
  readonly patchId: string | null;
  readonly commits: readonly HeadCommit[] | null;
  readonly patchIds: Readonly<Record<string, string>>;
};
```

  `PullRequestFacts` gains `readonly closes: readonly ClosingRef[]` (the body's closing references) and `readonly comparison: BaseComparison | null` (present when the facts module compared this head with this base). `ReviewFact.findings: readonly ReadFinding[]`. `HarnessesGateway.write.setFreeze(harnessId: string, frozen: boolean, allow: readonly string[]): Promise<boolean>`. `ActivateInput.requiredChecks: readonly RequiredCheck[]`.
- Consumes: Task 2's `ClosingRef`, `ReadFinding`, `RequiredCheck`, `defaultCiChecks`, `readFindingSchema`, `closingRefSchema`; Task 3's columns.

- [ ] **Step 1: Change the ports (shared-root commit)**

`packages/harness/ports.ts`: add `ClosingRef` and `ReadFinding` to the `@uw/contracts` type import; change `ReviewFact.findings` to `readonly ReadFinding[]`; add `HeadCommit` and `BaseComparison` (above) after `ChangedFiles`; and in `PullRequestFacts` after `declaration`:

```ts
  readonly closes: readonly ClosingRef[];
  readonly comparison: BaseComparison | null;
```

`packages/harness/store-ports.ts` and `packages/db/store/types.ts`, in `HarnessesGateway.write` after `setHostedBuilder` (and step 14's `setShadow`):

```ts
    setFreeze(harnessId: string, frozen: boolean, allow: readonly string[]): Promise<boolean>;
```

Run: `pnpm check`
Expected: FAIL only where the bindings and the facts literals lack the new members.

```bash
git add packages/harness/ports.ts packages/harness/store-ports.ts packages/db/store/types.ts
git commit -m "feat(harness): the facts carry the base comparison and closing references; the Store sets a freeze

Shared root packages/harness/ports.ts and store-ports.ts (with its mirror
packages/db/store/types.ts). PullRequestFacts gains closes and comparison,
ReviewFact's findings carry a weight, and the harnesses gateway gains
setFreeze. The bindings follow in the next commit.

SR-1 SR-2 GD-2 RV-1."
```

- [ ] **Step 2: Write the failing Store contract suite**

`packages/harness/port-contracts/store-freeze.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultCiChecks } from '@uw/contracts';
import type { Store } from '../ports.ts';
import { at, harnessOf, uid } from './store-gateway-fixtures.ts';

type FreezeSubject = () => { readonly store: Store };

export function describeStoreFreeze(adapter: string, subject: FreezeSubject): void {
  describe(`store freeze and required checks on ${adapter}`, () => {
    it('DX-3 stores the required checks and sets, then lifts, a freeze', async () => {
      const harness = { ...harnessOf(0x7500, 'gateway-freeze'), requiredChecks: [...defaultCiChecks] };
      const allowed = uid(0x7501);
      const read = await subject().store.transaction(async (tx) => {
        await tx.harnesses.write.insert(harness, at);
        const set = await tx.harnesses.write.setFreeze(harness.id, true, [allowed]);
        const frozen = await tx.harnesses.read.byId(harness.id);
        const lifted = await tx.harnesses.write.setFreeze(harness.id, false, []);
        const missing = await tx.harnesses.write.setFreeze(uid(0x7599), true, []);
        return { set, frozen, lifted, missing, after: await tx.harnesses.read.byId(harness.id) };
      });
      expect(read).toEqual({
        set: true,
        frozen: { ...harness, frozen: true, freezeAllow: [allowed] },
        lifted: true,
        missing: false,
        after: { ...harness, frozen: false, freezeAllow: [] },
      });
    });
  });
}
```

`packages/harness/port-contracts/store.ts`: `import { describeStoreFreeze } from './store-freeze.ts';` and `describeStoreFreeze(adapter, subject);` after step 14's `describeStoreJoining(adapter, subject);`. If `uid(0x75..)` collides with another suite, take the next free block above the highest `uid(0x7` in `packages/harness/port-contracts/`.

- [ ] **Step 3: Write the bindings**

`packages/db/store/rows.ts`, `toHarness`: add `frozen: row.frozen, freezeAllow: row.freezeAllow, requiredChecks: row.requiredChecks,` (the `harnessSchema.parse` validates the jsonb).

`packages/db/store/harnesses.ts`, in `write` after `setHostedBuilder`:

```ts
      setFreeze: (harnessId, frozen, allow) =>
        refusing(async () => {
          const rows = await executor
            .update(harnesses)
            .set({ frozen, freezeAllow: [...allow] })
            .where(eq(harnesses.id, harnessId))
            .returning({ id: harnesses.id });
          return rows.length > 0;
        }),
```

`insert` already spreads the `Harness` into the row, so `frozen`, `freezeAllow` and `requiredChecks` land through it.

`packages/harness/stages/activate.ts`: `ActivateInput` gains `readonly requiredChecks: readonly RequiredCheck[];` (import the type from `@uw/contracts`); the `harness` literal sets `requiredChecks: [...input.requiredChecks], frozen: false, freezeAllow: []`.

`apps/uw-app/commands/person/stages.ts`, `activateTemplateCommand`: pass `requiredChecks: body.requiredChecks` in `input` (beside step 14's `shadow` and `externalReviewerIdentities`).

- [ ] **Step 4: The facts read the comparison and the closing references**

`apps/uw-app/github/facts/queries.ts`: import `closingRefSchema`, `readFindingSchema` from `@uw/contracts` and `BaseComparison` from `@uw/harness`; replace the `findings` constant and add the row shapes:

```ts
const findingRow = z.union([
  z
    .string()
    .min(1)
    .max(500)
    .transform((text) => ({ text, weight: null })),
  readFindingSchema,
]);
const findings = z.array(findingRow).max(50);
const closesRow = z.array(closingRefSchema).max(100);
const headCommitsRow = z
  .array(
    z.strictObject({
      sha: z.string().min(1),
      merge: z.boolean(),
      skipCi: z.boolean(),
      closes: z.array(closingRefSchema).max(100),
    }),
  )
  .max(100);
const patchIdsRow = z.record(z.string(), z.string());
```

and above `pullNamed`:

```ts
function comparisonOf(pull: PullRow): BaseComparison | null {
  if (pull.filesHead !== pull.headSha || pull.filesBase !== pull.baseSha) return null;
  const commits = pull.headCommits === null ? null : headCommitsRow.safeParse(pull.headCommits);
  return {
    head: pull.headSha,
    base: pull.baseSha,
    behindBy: pull.behindBy,
    patchId: pull.patchId,
    commits: commits === null || !commits.success ? null : commits.data,
    patchIds: patchIdsRow.safeParse(pull.patchIds).data ?? {},
  };
}
```

In `pullRequestFacts`' returned object, after `declaration`:

```ts
    closes: closesRow.safeParse(pull.closes).data ?? [],
    comparison: comparisonOf(pull),
```

The string branch of `findingRow` reads reviews stored before 13.0.0.

`packages/harness/gates/ship-input.ts`, `reviewsOn`: back to `findings: [...counted.review.findings],` (the type now matches).

- [ ] **Step 5: The fixtures carry a green comparison**

`sim/ship-fixtures.ts`: import `BaseComparison` from `@uw/harness`; add below `shipBase`:

```ts
export function simPatchId(seed: string): string {
  return seed.padEnd(64, '0');
}

export function comparedAt(head: string, change: Partial<BaseComparison> = {}): BaseComparison {
  const patchId = simPatchId('9a7c');
  return {
    head,
    base: shipBase,
    behindBy: 0,
    patchId,
    commits: [{ sha: head, merge: false, skipCi: false, closes: [] }],
    patchIds: { [head]: patchId },
    ...change,
  };
}
```

and in `greenFacts`' returned object, after `declaration`:

```ts
    closes: [],
    comparison: comparedAt(head),
```

(`shipBase` is declared below `greenFacts` today; move `simPatchId`, `comparedAt` below `shipBase`, which both use.)

`sim/fixtures.ts`: `SimHarnessOptions` gains `readonly requiredChecks?: readonly RequiredCheck[];` and `createSimHarness` passes `requiredChecks: options.requiredChecks ?? defaultCiChecks` to `activate` (import both from `@uw/contracts`).

`apps/uw-app/github/testing/facts-fixtures.ts`: read it; every `PullRequestFacts` it builds gains `closes: []` and a green comparison at its head, written the same way as `comparedAt` (base = the fixture's base SHA).

The app activation helpers (`apps/uw-app/testing/commands.ts` `activated`, `apps/uw-app/github/testing/ship-rig.ts` `enqueued`, `apps/uw-app/github/testing/import-rig.ts`, `apps/uw-app/testing/board-world.ts` `activatedHarness`): pass `requiredChecks: defaultCiChecks` on every software harness, `[]` on any other. Run `grep -rn "stages.activate(" apps sim packages --include=*.ts | grep -v node_modules` and treat each call the compiler names the same way.

Every other `PullRequestFacts` literal `pnpm check` names (expect `packages/harness/port-contracts/github-facts.ts`, `packages/harness/gates/ship-input.test.ts`, the app pg tests listed in this step's file list): add `closes: [], comparison: null` unless the test drives the facts through the ship rule to `advance`, in which case add a green comparison at its head as above. Task 5 is where a missing comparison starts to refuse.

- [ ] **Step 6: Run the Store contract on both adapters and the suites the shapes touch**

Run: `pnpm check && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/harness/port-contracts sim/adapters apps/uw-app/ports apps/uw-app/github/facts`
Then: `npx vitest run packages/harness sim/kernel` and `pnpm sim -- all`
Expected: green; `store freeze and required checks` runs on the sim adapter and on the platform adapter.

- [ ] **Step 7: Commit**

```bash
git add packages/db/store packages/harness apps/uw-app sim
git commit -m "feat(db): bind the freeze write, the required checks and the base comparison read

The harness row carries frozen, freeze_allow and required_checks; activation
takes the required checks; the facts read the body's closing references and
the head's comparison; findings read back weighted, older ones unweighted.
The sim and the app fixtures carry a green comparison and the six CI jobs
on software harnesses.

SR-1 SR-2 GD-2 RV-1. S15-R1."
```

(Stage the files you changed by name if anything outside them is modified.)

---

### Task 5: The ship rule reads the five facts and carries an approval (SR-1, SR-2)

**Files:**
- Modify: `packages/harness/ship-rule.ts`
- Create: `packages/harness/gates/carry.ts`, `packages/harness/gates/carry.test.ts`
- Modify: `packages/harness/gates/ship-input.ts` (`ShipHarness`, `latestChecks`, `latestDecisive`, `approvalsOn`, `fromFacts`, `assembleShipInput`)
- Modify: `packages/harness/ship-rule.test.ts`, `packages/harness/gates/ship-input.test.ts`
- Modify: `packages/harness/index.ts` (export `countedApprovals`, `carriedCommits`, type `CountedApproval`)
- Modify: the tests and scenario whose planted facts omit a CI job (Step 7)

**Interfaces:**
- Consumes: Task 2's input shape; Task 4's `BaseComparison`, `PullRequestFacts.closes`, `Harness.requiredChecks`, `Harness.frozen`, `Harness.freezeAllow`.
- Produces: `shipRule` with the five predicates; `countedApprovals(input: ShipRuleInput): readonly CountedApproval[]` with `CountedApproval = { readonly reviewer: string; readonly commit: string; readonly head: string }`; `carriedCommits(comparison: BaseComparison, head: string): readonly string[]`.

- [ ] **Step 1: Write the failing unit tests**

`packages/harness/gates/carry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BaseComparison, HeadCommit } from '../ports.ts';
import { carriedCommits } from './carry.ts';

const approved = 'a'.repeat(40);
const merged = 'b'.repeat(40);
const fixed = 'c'.repeat(40);
const patch = '1'.repeat(64);
const other = '2'.repeat(64);

function commit(sha: string, merge: boolean): HeadCommit {
  return { sha, merge, skipCi: false, closes: [] };
}

function comparison(commits: readonly HeadCommit[], patchIds: Record<string, string>): BaseComparison {
  const head = commits.at(-1)?.sha ?? approved;
  return { head, base: '0'.repeat(40), behindBy: 0, patchId: patchIds[head] ?? null, commits, patchIds };
}

describe('SR-2 an approval carries across merges from base with the same patch id', () => {
  it('carries the approved commit across one merge from base', () => {
    const compared = comparison([commit(approved, false), commit(merged, true)], { [approved]: patch, [merged]: patch });
    expect(carriedCommits(compared, merged)).toEqual([approved]);
  });

  it('does not carry across a code change, even a merge after it', () => {
    const changed = comparison(
      [commit(approved, false), commit(fixed, false), commit(merged, true)],
      { [approved]: patch, [fixed]: other, [merged]: other },
    );
    expect(carriedCommits(changed, merged)).toEqual([fixed]);
    expect(carriedCommits(changed, merged)).not.toContain(approved);
  });

  it('does not carry when the patch id changed across the merge', () => {
    const compared = comparison([commit(approved, false), commit(merged, true)], { [approved]: patch, [merged]: other });
    expect(carriedCommits(compared, merged)).toEqual([]);
  });

  it('does not carry a commit the head no longer contains, as after a rebase', () => {
    const rebased = comparison([commit(fixed, false), commit(merged, true)], { [approved]: patch, [fixed]: patch, [merged]: patch });
    expect(carriedCommits(rebased, merged)).toEqual([fixed]);
  });

  it('carries nothing when the commits or the patch id are unknown', () => {
    const unknown = { ...comparison([commit(approved, false), commit(merged, true)], { [approved]: patch, [merged]: patch }), commits: null };
    expect(carriedCommits(unknown, merged)).toEqual([]);
    const noPatch = { ...comparison([commit(approved, false), commit(merged, true)], { [approved]: patch }), patchId: null };
    expect(carriedCommits(noPatch, merged)).toEqual([]);
  });
});
```

Append to `packages/harness/ship-rule.test.ts` (it already has `green()`, `refusedWith`, `approval`; Task 2 gave `green()` the new fields with `requiredChecks: [...defaultCiChecks]`):

```ts
describe('SR-1 the ship rule refuses on the five new facts', () => {
  it('SR-1 refuses base_behind when the head is behind its base or the distance is unknown', () => {
    const behind = { ...green(), pullRequest: { open: true, draft: false, head: 'abc123', behindBy: 3, skipCi: false } };
    expect(refusedWith(behind)).toEqual(['base_behind']);
    const unknown = { ...green(), pullRequest: { open: true, draft: false, head: 'abc123', behindBy: null, skipCi: false } };
    expect(refusedWith(unknown)).toEqual(['base_behind']);
  });

  it('SR-1 refuses auto_close_keyword for a closing reference to an issue the item does not wrap', () => {
    const wrapped = { repo: 'unfoldingWord/uw-platform', number: 12 };
    expect(refusedWith({ ...green(), closes: [wrapped], wraps: wrapped })).toEqual([]);
    expect(refusedWith({ ...green(), closes: [{ repo: 'UNFOLDINGWORD/UW-PLATFORM', number: 12 }], wraps: wrapped })).toEqual([]);
    expect(refusedWith({ ...green(), closes: [{ ...wrapped, number: 13 }], wraps: wrapped })).toEqual(['auto_close_keyword']);
    expect(refusedWith({ ...green(), closes: [wrapped], wraps: null })).toEqual(['auto_close_keyword']);
  });

  it('SR-1 refuses skip_ci_marker on a marked commit or unknown commits', () => {
    const marked = { ...green(), pullRequest: { open: true, draft: false, head: 'abc123', behindBy: 0, skipCi: true } };
    expect(refusedWith(marked)).toEqual(['skip_ci_marker']);
    const unknown = { ...green(), pullRequest: { open: true, draft: false, head: 'abc123', behindBy: 0, skipCi: null } };
    expect(refusedWith(unknown)).toEqual(['skip_ci_marker']);
  });

  it('SR-1 refuses required_check_never_ran for a required check with no run on the head, and checks_not_green for one that failed', () => {
    const missing = { ...green(), checks: green().checks.filter((check) => check.name !== 'lint') };
    expect(refusedWith(missing)).toEqual(['required_check_never_ran']);
    const failed = { ...green(), checks: green().checks.map((check) => (check.name === 'lint' ? { ...check, conclusion: 'failure' as const } : check)) };
    expect(refusedWith(failed)).toEqual(['checks_not_green']);
  });

  it('SR-1 with no required checks needs every check that ran to pass and at least one to have run', () => {
    const open = { ...green(), requiredChecks: [] };
    expect(refusedWith(open)).toEqual([]);
    expect(refusedWith({ ...open, checks: [] })).toEqual(['checks_not_green']);
    const thirdParty = [...green().checks, { name: 'codecov', app: 'codecov', headSha: 'abc123', conclusion: 'failure' as const }];
    expect(refusedWith({ ...open, checks: thirdParty })).toEqual(['checks_not_green']);
  });

  it('SR-1 counts a required check only from its own app', () => {
    const impostor = green().checks.map((check) => (check.name === 'lint' ? { ...check, app: 'someone-else' } : check));
    expect(refusedWith({ ...green(), checks: impostor })).toEqual(['required_check_never_ran']);
  });

  it('GD-2 refuses harness_frozen while the harness is frozen for this item', () => {
    expect(refusedWith({ ...green(), frozen: true })).toEqual(['harness_frozen']);
  });

  it('SR-1 keeps the v0.1.0 reasons alone when there is no usable pull request', () => {
    const none = { ...green(), pullRequest: null, closes: [{ repo: 'unfoldingWord/uw-platform', number: 9 }] };
    expect(refusedWith(none)).toEqual(['pr_not_open', 'head_mismatch', 'checks_not_green', 'no_reviewer_approval']);
  });
});

describe('SR-2 the ship rule counts a carried approval and a carried expected head', () => {
  const merged = 'def456';

  it('advances on a head carried from the approved, expected head', () => {
    const carried = {
      ...green(),
      pullRequest: { open: true, draft: false, head: merged, behindBy: 0, skipCi: false },
      carries: ['abc123'],
      checks: green().checks.map((check) => ({ ...check, headSha: merged })),
    };
    expect(shipRule(carried)).toEqual({ verdict: 'advance' });
    expect(countedApprovals(carried)).toEqual([{ reviewer: 'reviewer-openrouter', commit: 'abc123', head: merged }]);
  });

  it('refuses head_mismatch and counts no approval when nothing is carried', () => {
    const moved = {
      ...green(),
      pullRequest: { open: true, draft: false, head: merged, behindBy: 0, skipCi: false },
      checks: green().checks.map((check) => ({ ...check, headSha: merged })),
    };
    expect(refusedWith(moved)).toEqual(['head_mismatch', 'no_reviewer_approval']);
    expect(countedApprovals(moved)).toEqual([]);
  });
});
```

Import `countedApprovals` from `./ship-rule.ts` and `defaultCiChecks` from `@uw/contracts` at the top. Read the file's `KN-11` block: any test that removed a CI job to get `checks_not_green` now expects `required_check_never_ran`; change its expectation and keep its title.

In `packages/harness/gates/ship-input.test.ts`, change `harness` to

```ts
const harness = {
  jdArea: '80-89',
  repository: 'unfoldingWord/uw-platform',
  externalReviewerIdentities: [],
  requiredChecks: [...defaultCiChecks],
  frozen: false,
  freezeAllow: [],
} as const;
```

(keep step 14's field if it already added it), give `facts` `closes: []` and `comparison: { head, base, behindBy: 0, patchId: '1'.repeat(64), commits: [{ sha: head, merge: false, skipCi: false, closes: [] }], patchIds: { [head]: '1'.repeat(64) } }`, and append:

```ts
describe('SR-1 SR-2 the assembler reads the comparison, the closing references, the required checks and the freeze', () => {
  const source = { facts, item, harness, approver, at, override: false };

  it('SR-1 reads behind_by and the skip-ci markers from the comparison at this head and base', () => {
    const behind = { ...facts, comparison: { ...facts.comparison!, behindBy: 2 } };
    expect(assembleShipInput({ ...source, facts: behind }).pullRequest).toMatchObject({ behindBy: 2, skipCi: false });
    const elsewhere = { ...facts, comparison: { ...facts.comparison!, base: older } };
    expect(assembleShipInput({ ...source, facts: elsewhere }).pullRequest).toMatchObject({ behindBy: null, skipCi: null });
  });

  it('SR-1 joins the body and commit closing references once each, and wraps the item issue', () => {
    const ref = { repo: 'unfoldingWord/uw-platform', number: 12 };
    const commits = [{ sha: head, merge: false, skipCi: false, closes: [ref, { ...ref, number: 13 }] }];
    const closing = { ...facts, closes: [ref], comparison: { ...facts.comparison!, commits } };
    const input = assembleShipInput({ ...source, facts: closing });
    expect(input.closes).toEqual([ref, { ...ref, number: 13 }]);
    expect(input.wraps).toBeNull();
  });

  it('SR-1 GD-2 takes the required checks from the harness and the freeze unless the item is allowed', () => {
    expect(assembleShipInput(source).requiredChecks).toEqual(defaultCiChecks);
    expect(assembleShipInput({ ...source, harness: { ...harness, frozen: true } }).frozen).toBe(true);
    expect(assembleShipInput({ ...source, harness: { ...harness, frozen: true, freezeAllow: [itemId] } }).frozen).toBe(false);
  });

  it('SR-2 counts an approval on a carried commit with the commit it was given on', () => {
    const merged = 'd'.repeat(40);
    const patchId = '1'.repeat(64);
    const commits = [
      { sha: head, merge: false, skipCi: false, closes: [] },
      { sha: merged, merge: true, skipCi: false, closes: [] },
    ];
    const comparison = { head: merged, base, behindBy: 0, patchId, commits, patchIds: { [head]: patchId, [merged]: patchId } };
    const moved = { ...facts, head: merged, comparison, checks: facts.checks.map((one) => ({ ...one, headSha: merged })), files: { head: merged, base, paths: ['apps/uw-app/board.tsx'] } };
    const input = assembleShipInput({ ...source, facts: moved });
    expect(input.carries).toEqual([head]);
    expect(input.approvals).toEqual([{ reviewer: 'uw-reviewer', commit: head, provider: 'anthropic' }]);
  });
});
```

Use the file's existing names (`older`, `base`, `head`, `itemId`, `item`, `approver`, `at`); if the file avoids `!`, replace `facts.comparison!` with a local `const compared = facts.comparison ?? (() => { throw new Error('no comparison'); })();` at the top of the block (the lint forbids non-null assertions; prefer the local). Import `defaultCiChecks` from `@uw/contracts`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/harness/ship-rule.test.ts packages/harness/gates/carry.test.ts packages/harness/gates/ship-input.test.ts`
Expected: FAIL; `carry.ts` and `countedApprovals` do not exist and the new reasons are never returned.

- [ ] **Step 3: Write the carry**

`packages/harness/gates/carry.ts`:

```ts
import type { BaseComparison } from '../ports.ts';

export function carriedCommits(comparison: BaseComparison, head: string): readonly string[] {
  const { commits, patchId, patchIds } = comparison;
  if (commits === null || patchId === null || comparison.head !== head) return [];
  const at = commits.findIndex((commit) => commit.sha === head);
  const carried: string[] = [];
  for (let index = at - 1; index >= 0; index -= 1) {
    const after = commits[index + 1];
    const commit = commits[index];
    if (after === undefined || commit === undefined || !after.merge) break;
    if (patchIds[commit.sha] === patchId) carried.push(commit.sha);
  }
  return carried;
}
```

(`at` is `-1` when the head is absent, and the loop does not run.)

- [ ] **Step 4: Write the rule**

`packages/harness/ship-rule.ts`: drop the `ciJobSchema` import; import `ClosingRef`, `RequiredCheck` types. Replace `approvalsOnHead`, `headMismatch`, `jobIsGreen`, `checksNotGreen` and add the new predicates and `countedApprovals`:

```ts
type Check = ShipRuleInput['checks'][number];

export type CountedApproval = {
  readonly reviewer: string;
  readonly commit: string;
  readonly head: string;
};

function countsOnHead(input: ShipRuleInput, commit: string): boolean {
  const head = headOf(input);
  return head !== null && (commit === head || input.carries.includes(commit));
}

function approvalsOnHead(input: ShipRuleInput): ShipRuleInput['approvals'] {
  return input.approvals.filter((approval) => countsOnHead(input, approval.commit));
}

function headMismatch(input: ShipRuleInput): boolean {
  return input.expectedHead === null || !countsOnHead(input, input.expectedHead);
}

function checksOnHead(input: ShipRuleInput, head: string): readonly Check[] {
  return input.checks.filter((check) => check.headSha === head);
}

function isRequired(check: Check, required: RequiredCheck): boolean {
  return check.name === required.name && check.app === required.app;
}

function checksNotGreen(input: ShipRuleInput): boolean {
  const head = headOf(input);
  if (head === null) return true;
  const onHead = checksOnHead(input, head);
  if (input.requiredChecks.length === 0) {
    return onHead.length === 0 || onHead.some((check) => check.conclusion !== 'success');
  }
  return input.requiredChecks.some((required) =>
    onHead.some((check) => isRequired(check, required) && check.conclusion !== 'success'),
  );
}

function requiredCheckNeverRan(input: ShipRuleInput): boolean {
  const head = headOf(input);
  if (head === null) return false;
  const onHead = checksOnHead(input, head);
  return input.requiredChecks.some(
    (required) => !onHead.some((check) => isRequired(check, required)),
  );
}

function baseBehind(input: ShipRuleInput): boolean {
  const { pullRequest } = input;
  return pullRequest !== null && (pullRequest.behindBy === null || pullRequest.behindBy > 0);
}

function skipCiMarker(input: ShipRuleInput): boolean {
  return input.pullRequest !== null && input.pullRequest.skipCi !== false;
}

function sameIssue(left: ClosingRef, right: ClosingRef | null): boolean {
  return (
    right !== null &&
    left.number === right.number &&
    left.repo.toLowerCase() === right.repo.toLowerCase()
  );
}

function autoCloseKeyword(input: ShipRuleInput): boolean {
  return input.pullRequest !== null && input.closes.some((ref) => !sameIssue(ref, input.wraps));
}

function harnessFrozen(input: ShipRuleInput): boolean {
  return input.frozen;
}
```

`headMismatch` relies on `countsOnHead` returning false when the head is unknown. Append to `failing`:

```ts
  ['base_behind', baseBehind],
  ['auto_close_keyword', autoCloseKeyword],
  ['skip_ci_marker', skipCiMarker],
  ['required_check_never_ran', requiredCheckNeverRan],
  ['harness_frozen', harnessFrozen],
```

and below `shipRule`:

```ts
export function countedApprovals(input: ShipRuleInput): readonly CountedApproval[] {
  const head = headOf(input);
  if (head === null) return [];
  return approvalsOnHead(input).map(({ reviewer, commit }) => ({ reviewer, commit, head }));
}
```

- [ ] **Step 5: Write the assembler**

`packages/harness/gates/ship-input.ts` (on top of step 14's external-reviewer code and Task 2's neutral values). Import `carriedCommits` from `./carry.ts`, `ClosingRef` type from `@uw/contracts`, `BaseComparison` from `../ports.ts`; drop the `ciJobs` set and the `ciJobSchema` import if nothing else uses them (grep), keep `GITHUB_ACTIONS_APP` (the test imports it).

```ts
type ShipHarness = Pick<
  Harness,
  'jdArea' | 'repository' | 'externalReviewerIdentities' | 'requiredChecks' | 'frozen' | 'freezeAllow'
>;

function latestChecks(facts: PullRequestFacts, head: string): ShipRuleInput['checks'] {
  const latest = new Map<string, CheckFact>();
  for (const check of facts.checks) {
    if (fullSha(check.headSha) !== head) continue;
    const key = `${check.app ?? ''} ${check.name}`;
    const seen = latest.get(key);
    if (seen === undefined || check.checkId > seen.checkId) latest.set(key, check);
  }
  return [...latest.values()].map((check) => ({
    name: check.name,
    app: check.app,
    headSha: head,
    conclusion: check.conclusion,
  }));
}

function comparisonAt(facts: PullRequestFacts, head: string): BaseComparison | null {
  const compared = facts.comparison;
  if (compared === null || compared.head !== head) return null;
  return compared.base === fullSha(facts.base) ? compared : null;
}

function skipCiOf(compared: BaseComparison | null): boolean | null {
  if (compared === null || compared.commits === null) return null;
  return compared.commits.some((commit) => commit.skipCi);
}

function sameRef(left: ClosingRef, right: ClosingRef): boolean {
  return left.number === right.number && left.repo.toLowerCase() === right.repo.toLowerCase();
}

function closesOf(facts: PullRequestFacts, compared: BaseComparison | null): ClosingRef[] {
  const all = [...facts.closes, ...(compared?.commits ?? []).flatMap((commit) => commit.closes)];
  return all.filter((ref, index) => all.findIndex((other) => sameRef(ref, other)) === index).slice(0, 100);
}
```

`latestDecisive` takes `heads: ReadonlySet<string>` instead of `head` and tests `heads.has(fullSha(review.commit) ?? '')`; `reviewsOn(facts, head, external)` calls it with `new Set([head])`; `approvalsOn` becomes:

```ts
function approvalsOn(
  facts: PullRequestFacts,
  heads: ReadonlySet<string>,
  external: readonly string[],
): ShipRuleInput['approvals'] {
  return [...latestDecisive(facts, heads, external).entries()]
    .filter(([, counted]) => counted.review.state === 'approved')
    .map(([reviewer, counted]) => ({
      reviewer,
      commit: fullSha(counted.review.commit) ?? counted.review.commit,
      provider: providerOf(counted),
    }));
}
```

`fromFacts` returns, for a usable head:

```ts
  const compared = comparisonAt(facts, head);
  const carries = compared === null ? [] : [...carriedCommits(compared, head)];
  return {
    pullRequest: {
      open: facts.state === 'open',
      draft: facts.draft,
      head,
      behindBy: compared?.behindBy ?? null,
      skipCi: skipCiOf(compared),
    },
    carries,
    checks: latestChecks(facts, head),
    approvals: approvalsOn(facts, new Set([head, ...carries]), source.harness.externalReviewerIdentities),
    closes: closesOf(facts, compared),
    ...riskAtHead(facts, source, head),
  };
```

and for no usable head `{ pullRequest: null, carries: [], checks: [], approvals: [], closes: [], riskTier: null, riskDomains: [...item.riskDomains] }`. If `fromFacts` passes 50 lines, move the usable-head branch into `fromUsableHead(source, facts, head)`.

`assembleShipInput`:

```ts
export function assembleShipInput(source: ShipInputSource): ShipRuleInput {
  const { item, harness } = source;
  return {
    ...fromFacts(source),
    expectedHead: item.expectedHead === null ? null : fullSha(item.expectedHead),
    requiredChecks: [...harness.requiredChecks],
    wraps: item.issue === null ? null : { repo: item.issue.repo, number: item.issue.number },
    area: harness.jdArea,
    approver: source.approver,
    at: source.at.toISOString(),
    frozen: harness.frozen && !harness.freezeAllow.includes(item.itemId),
    override: source.override,
  };
}
```

`packages/harness/index.ts`: export `countedApprovals` and type `CountedApproval` from `./ship-rule.ts`, `carriedCommits` from `./gates/carry.ts`.

- [ ] **Step 6: Run the unit tests**

Run: `pnpm check && npx vitest run packages/harness/ship-rule.test.ts packages/harness/gates`
Expected: green.

- [ ] **Step 7: Run the sim and the views; update what planted a missing CI job**

Run: `npx vitest run sim/kernel packages/harness` then `pnpm sim -- all`
Expected: green except where a test or scenario removed a CI job to see `checks_not_green` (expect `sim/scenarios/KN-11.ship-rule-refuses-on-facts.ts`, `sim/kernel/gate-command.test.ts`; `grep -rln checks_not_green sim apps --include=*.ts`). There the expectation becomes `required_check_never_ran`; where a job failed it stays `checks_not_green`. Any shadow-verdict expectation of step 14 that now gains a reason means its facts lack the green comparison: give them one (`comparedAt`), do not change the expectation.

- [ ] **Step 8: Commit**

```bash
git add packages/harness sim
git commit -m "feat(harness): the ship rule reads the base comparison, closing references, required checks and the freeze

Five refusals join the rule: base_behind, auto_close_keyword,
skip_ci_marker, required_check_never_ran and harness_frozen. Required
checks come from the harness, not this repository's six job names. An
approval on a commit carried across merges from base with the same patch
id counts, and a carried expected head is not head_mismatch.

SR-1 SR-2 GD-2. S15-R1 S15-R2 S15-R3 S15-R7."
```

---

### Task 6: The GitHub facts record the base comparison at each head (SR-1, SR-2)

**Files:**
- Create: `packages/harness/github/closing-keywords.ts`, `packages/harness/github/closing-keywords.test.ts`
- Modify: `packages/harness/index.ts` (export `closingReferences`, `hasSkipCiMarker`)
- Modify: `apps/uw-app/github/payloads.ts` (`fileSchema`, `compareCommitSchema`)
- Modify: `apps/uw-app/github/client.ts` (`changedFiles` returns the comparison)
- Create: `apps/uw-app/github/facts/patch-id.ts`, `apps/uw-app/github/facts/head-facts.ts`, `apps/uw-app/github/facts/head-facts.test.ts`
- Create: `apps/uw-app/github/facts/heads.ts` (the files writer, moved out of `upsert.ts` and grown)
- Modify: `apps/uw-app/github/facts/upsert.ts` (drop the files writer; `closes` and the cleared comparison on a new head), `records.ts` (`FilesRecord`, `PullRequestRecord.closes`, `unknownHead`), `normalise.ts` (`pullOf` reads the closing references; `filesFromRest` takes the head facts), `files.ts` (`fetchFilesAtHead`)
- Create: `apps/uw-app/github/facts/heads.pg.test.ts`
- Modify: the fixture GitHub answers to the compare call (`apps/uw-app/github/testing/ship-rig.ts` `listing`, `sweep-rig.ts`, `apps/uw-app/github/fixtures/*.json` the compare answer, `client.test.ts`), `facts-fixtures.ts` (`openedPull.closes`), and the importers of `recordFiles`

**Interfaces:**
- Produces: `closingReferences(text: string | null, repository: string): readonly ClosingRef[]`; `hasSkipCiMarker(message: string): boolean`; `GitHubReads.changedFiles(repo, base, head): Promise<GitHubResult<Compared>>` with `Compared = { readonly files: List | 'too_many_files'; readonly behindBy: number | null; readonly commits: List | null }`; `patchIdOf(files: readonly unknown[]): Promise<string | null>`; `headFactsOf(compared: Compared, repository: string): Promise<HeadFacts>` with `HeadFacts = Pick<FilesRecord, 'behindBy' | 'patchId' | 'commits'>`; `recordFiles(db, files: FilesRecord)` now in `heads.ts`.

- [ ] **Step 1: Write the failing unit tests**

`packages/harness/github/closing-keywords.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { closingReferences, hasSkipCiMarker } from './closing-keywords.ts';

const here = 'unfoldingWord/uw-platform';

describe('SR-1 closing keywords, quoted or not, in a pull request body or a commit', () => {
  it('reads every GitHub closing keyword before #N, owner/name#N and an issue URL', () => {
    const body = [
      'Fixes #12',
      'closes: unfoldingWord/tc-admin-app#3',
      'Resolved https://github.com/unfoldingWord/uw-platform/issues/40',
      'fix #12 again',
    ].join('\n');
    expect(closingReferences(body, here)).toEqual([
      { repo: here, number: 12 },
      { repo: 'unfoldingWord/tc-admin-app', number: 3 },
      { repo: here, number: 40 },
    ]);
  });

  it('reads a keyword inside quotes or a code span', () => {
    expect(closingReferences('The bot wrote "Closes #7" here', here)).toEqual([{ repo: here, number: 7 }]);
    expect(closingReferences('Do not write `fixes #8` in a body', here)).toEqual([{ repo: here, number: 8 }]);
  });

  it('reads nothing from a word that only ends in a keyword or a keyword with no reference', () => {
    expect(closingReferences('the prefix #12 and suffix #13', here)).toEqual([]);
    expect(closingReferences('This fixes the board', here)).toEqual([]);
    expect(closingReferences(null, here)).toEqual([]);
  });
});

describe('SR-1 skip-ci markers in a commit message', () => {
  it('finds every marker GitHub honours, in any case', () => {
    for (const marker of ['[skip ci]', '[CI SKIP]', '[no ci]', '[skip actions]', '[actions skip]']) {
      expect(hasSkipCiMarker(`Tidy the board ${marker}`)).toBe(true);
    }
    expect(hasSkipCiMarker('Tidy the board\n\nskip-checks: true')).toBe(true);
  });

  it('finds no marker in an ordinary message', () => {
    expect(hasSkipCiMarker('Skip the empty state when CI is red')).toBe(false);
  });
});
```

`apps/uw-app/github/facts/head-facts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { headFactsOf } from './head-facts.ts';
import { patchIdOf } from './patch-id.ts';

const here = 'unfoldingWord/uw-platform';
const sha = (seed: string) => seed.padEnd(40, '0');

const file = (patch: string) => ({ filename: 'apps/uw-app/board.tsx', status: 'modified', patch });

describe('SR-2 the patch id is the change against the merge base', () => {
  it('stays the same when only the hunk positions move', async () => {
    const before = await patchIdOf([file('@@ -10,2 +10,3 @@ function Board\n a\n+b\n c')]);
    const after = await patchIdOf([file('@@ -14,2 +14,3 @@ function Board\n a\n+b\n c')]);
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    expect(after).toBe(before);
  });

  it('changes when a line of the change changes, and is the same in any file order', async () => {
    const one = await patchIdOf([file('@@ -1 +1 @@\n-a\n+b'), { filename: 'z.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+z' }]);
    const reordered = await patchIdOf([{ filename: 'z.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+z' }, file('@@ -1 +1 @@\n-a\n+b')]);
    const changed = await patchIdOf([file('@@ -1 +1 @@\n-a\n+c'), { filename: 'z.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+z' }]);
    expect(reordered).toBe(one);
    expect(changed).not.toBe(one);
  });

  it('uses the blob sha of a file with no patch, and is unknown when neither is given', async () => {
    expect(await patchIdOf([{ filename: 'logo.png', status: 'added', sha: sha('b10b') }])).toMatch(/^[0-9a-f]{64}$/);
    expect(await patchIdOf([{ filename: 'logo.png', status: 'added' }])).toBeNull();
  });
});

describe('SR-1 SR-2 the head facts from one compare answer', () => {
  const commits = [
    { sha: sha('a1'), commit: { message: 'Show the board\n\nFixes #12' }, parents: [{ sha: sha('ba5e') }] },
    { sha: sha('b2'), commit: { message: "Merge branch 'main' [skip ci]" }, parents: [{ sha: sha('a1') }, { sha: sha('ba5f') }] },
  ];

  it('reads the distance behind the base, the merges, the markers and the closing references', async () => {
    const facts = await headFactsOf({ files: [file('@@ -1 +1 @@\n-a\n+b')], behindBy: 2, commits }, here);
    expect(facts.behindBy).toBe(2);
    expect(facts.patchId).toMatch(/^[0-9a-f]{64}$/);
    expect(facts.commits).toEqual([
      { sha: sha('a1'), merge: false, skipCi: false, closes: [{ repo: here, number: 12 }] },
      { sha: sha('b2'), merge: true, skipCi: true, closes: [] },
    ]);
  });

  it('knows no patch id at the file cap and no commits when GitHub listed only some', async () => {
    const facts = await headFactsOf({ files: 'too_many_files', behindBy: null, commits: null }, here);
    expect(facts).toEqual({ behindBy: null, patchId: null, commits: null });
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/harness/github/closing-keywords.test.ts apps/uw-app/github/facts/head-facts.test.ts`
Expected: FAIL; the modules do not exist.

- [ ] **Step 3: Write the closing references and the markers**

`packages/harness/github/closing-keywords.ts`:

```ts
import type { ClosingRef } from '@uw/contracts';

const owner = '[A-Za-z0-9-]{1,39}\\/[A-Za-z0-9._-]{1,100}';
const reference = new RegExp(
  `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\b\\s*:?\\s*(?:https:\\/\\/github\\.com\\/(${owner})\\/issues\\/|(${owner})#|#)([1-9][0-9]{0,9})\\b`,
  'giu',
);
const skipMarker = /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]|^skip-checks:\s*true\s*$/imu;
const REFERENCE_LIMIT = 100;

function sameRef(left: ClosingRef, right: ClosingRef): boolean {
  return left.number === right.number && left.repo.toLowerCase() === right.repo.toLowerCase();
}

export function closingReferences(text: string | null, repository: string): readonly ClosingRef[] {
  if (text === null) return [];
  const found: ClosingRef[] = [];
  for (const match of text.matchAll(reference)) {
    const ref = { repo: match[1] ?? match[2] ?? repository, number: Number(match[3] ?? '0') };
    if (ref.number > 0 && !found.some((seen) => sameRef(seen, ref))) found.push(ref);
    if (found.length === REFERENCE_LIMIT) break;
  }
  return found;
}

export function hasSkipCiMarker(message: string): boolean {
  return skipMarker.test(message);
}
```

`packages/harness/index.ts`: `export { closingReferences, hasSkipCiMarker } from './github/closing-keywords.ts';`.

- [ ] **Step 4: Read the comparison from the compare call**

`apps/uw-app/github/payloads.ts`:

```ts
export const fileSchema = z.object({
  filename: name,
  previous_filename: name.optional(),
  status: text.optional(),
  patch: text.optional(),
  sha: z.string().nullable().optional(),
});

export const compareCommitSchema = z.object({
  sha: z.string(),
  commit: z.object({ message: text }),
  parents: z.array(z.object({ sha: z.string() })),
});
```

`apps/uw-app/github/client.ts`: export the type and replace `comparison` and `changedFiles`:

```ts
export type Compared = {
  readonly files: List | 'too_many_files';
  readonly behindBy: number | null;
  readonly commits: List | null;
};

const commitsPerPage = 100;
const comparison = z
  .object({
    status: z.string().optional(),
    files: array.optional(),
    behind_by: z.number().int().min(0).optional(),
    total_commits: z.number().int().min(0).optional(),
    commits: array.optional(),
  })
  .refine((answer) => answer.files !== undefined || answer.status === 'identical')
  .transform((answer) => ({
    files: answer.files ?? [],
    behindBy: answer.behind_by ?? null,
    commits:
      answer.commits !== undefined &&
      answer.total_commits !== undefined &&
      answer.commits.length >= answer.total_commits
        ? answer.commits
        : null,
  }));
```

In `GitHubReads`, `changedFiles(repo: string, base: string, head: string): Promise<GitHubResult<Compared>>;` and in `pullRequestReads`:

```ts
    changedFiles: (repo: string, base: string, head: string) =>
      refusedUnless(isFullSha(base) && isFullSha(head), async (): Promise<GitHubResult<Compared>> => {
        const route = 'GET /repos/{owner}/{repo}/compare/{basehead}';
        const parameters = { basehead: `${base}...${head}`, per_page: commitsPerPage, page: 1 };
        const answer = await session.request(route, parameters, repo);
        if (!answer.ok) return answer;
        const compared = shaped(comparison, answer.value);
        if (!compared.ok) return compared;
        const { files } = compared.value;
        return {
          ok: true,
          value: { ...compared.value, files: files.length >= listedFiles ? 'too_many_files' : files },
        };
      }),
```

`apps/uw-app/github/facts/patch-id.ts`:

```ts
import type { z } from 'zod';
import { fileSchema } from '../payloads.ts';

type PatchFile = z.infer<typeof fileSchema>;

const hunkHeader = /^@@.*$/gmu;
const field = '\u0000';
const entry = '\u0001';

function entryOf(file: PatchFile): string | null {
  const body =
    file.patch !== undefined
      ? file.patch.replace(hunkHeader, '@@')
      : typeof file.sha === 'string' && file.sha !== ''
        ? `blob ${file.sha}`
        : null;
  if (body === null) return null;
  return [file.status ?? '', file.previous_filename ?? '', file.filename, body].join(field);
}

function hex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function patchIdOf(files: readonly unknown[]): Promise<string | null> {
  const parsed = fileSchema.array().safeParse(files);
  if (!parsed.success) return null;
  const entries = parsed.data.map(entryOf);
  const known = entries.filter((one): one is string => one !== null);
  if (known.length !== entries.length) return null;
  const text = [...known].sort().join(entry);
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
```

If the lint forbids a nested ternary, write `bodyOf(file)` with two `if`s. If it flags the `crypto` global, use `globalThis.crypto.subtle`.

`apps/uw-app/github/facts/records.ts`: import `HeadCommit` from `@uw/harness` and `ClosingRef` from `@uw/contracts`; `PullRequestRecord` gains `readonly closes: readonly ClosingRef[];`; `FilesRecord` gains

```ts
  readonly behindBy: number | null;
  readonly patchId: string | null;
  readonly commits: readonly HeadCommit[] | null;
```

and add

```ts
export type HeadFacts = Pick<FilesRecord, 'behindBy' | 'patchId' | 'commits'>;
export const unknownHead: HeadFacts = { behindBy: null, patchId: null, commits: null };
```

`apps/uw-app/github/facts/head-facts.ts`:

```ts
import { closingReferences, fullSha, hasSkipCiMarker, type HeadCommit } from '@uw/harness';
import type { Compared } from '../client.ts';
import { compareCommitSchema } from '../payloads.ts';
import { patchIdOf } from './patch-id.ts';
import type { HeadFacts } from './records.ts';

function commitsOf(listed: readonly unknown[], repository: string): readonly HeadCommit[] | null {
  const parsed = compareCommitSchema.array().safeParse(listed);
  if (!parsed.success) return null;
  const commits: HeadCommit[] = [];
  for (const entry of parsed.data) {
    const sha = fullSha(entry.sha);
    if (sha === null) return null;
    const { message } = entry.commit;
    const closes = [...closingReferences(message, repository)];
    commits.push({ sha, merge: entry.parents.length > 1, skipCi: hasSkipCiMarker(message), closes });
  }
  return commits;
}

export async function headFactsOf(compared: Compared, repository: string): Promise<HeadFacts> {
  return {
    behindBy: compared.behindBy,
    patchId: compared.files === 'too_many_files' ? null : await patchIdOf(compared.files),
    commits: compared.commits === null ? null : commitsOf(compared.commits, repository),
  };
}
```

- [ ] **Step 5: Run the unit tests**

Run: `npx vitest run packages/harness/github/closing-keywords.test.ts apps/uw-app/github/facts/head-facts.test.ts`
Expected: green.

- [ ] **Step 6: Write the failing read-model test**

`apps/uw-app/github/facts/heads.pg.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import { base, head, nextHead, openedPull, repo } from '../testing/facts-fixtures.ts';
import { recordFiles } from './heads.ts';
import { pullRequestFacts } from './queries.ts';
import { emptyBatch } from './records.ts';
import { upsertFacts } from './upsert.ts';

const at = new Date('2026-10-15T09:00:00.000Z');
const later = new Date('2026-10-15T09:05:00.000Z');
const patch = '1'.repeat(64);
const ref = { repo: repo.fullName, number: openedPull.number };
const commit = { sha: head, merge: false, skipCi: false, closes: [{ repo: repo.fullName, number: 12 }] };

async function stored(db: Database): Promise<void> {
  const pull = { ...openedPull, closes: [{ repo: repo.fullName, number: 12 }] };
  await upsertFacts(db, { ...emptyBatch, repos: [repo], pullRequests: [pull] }, at);
  await recordFiles(db, {
    pullRequestId: openedPull.githubId,
    head,
    base,
    paths: ['apps/uw-app/board.tsx'],
    problem: null,
    behindBy: 0,
    patchId: patch,
    commits: [commit],
  });
}

async function readsTheComparison(db: Database): Promise<void> {
  await stored(db);
  const facts = await pullRequestFacts(db, ref);
  expect(facts?.closes).toEqual([{ repo: repo.fullName, number: 12 }]);
  expect(facts?.comparison).toEqual({ head, base, behindBy: 0, patchId: patch, commits: [commit], patchIds: { [head]: patch } });
}

async function clearsItOnANewHeadAndKeepsTheHistory(db: Database): Promise<void> {
  await stored(db);
  const moved = { ...openedPull, headSha: nextHead, closes: [], githubUpdatedAt: later };
  await upsertFacts(db, { ...emptyBatch, repos: [repo], pullRequests: [moved] }, later);
  const facts = await pullRequestFacts(db, ref);
  expect(facts?.comparison).toBeNull();
  await recordFiles(db, {
    pullRequestId: openedPull.githubId,
    head: nextHead,
    base,
    paths: ['apps/uw-app/board.tsx'],
    problem: null,
    behindBy: 1,
    patchId: patch,
    commits: null,
  });
  const after = await pullRequestFacts(db, ref);
  expect(after?.comparison).toMatchObject({ head: nextHead, behindBy: 1, commits: null, patchIds: { [head]: patch, [nextHead]: patch } });
}

describe.skipIf(!testServer)('the base comparison in the read model', () => {
  it('SR-1 SR-2 reads the closing references and the comparison recorded at the head', () =>
    withAppDatabase(readsTheComparison));
  it('SR-2 clears the comparison when the head moves and keeps the patch id of every head', () =>
    withAppDatabase(clearsItOnANewHeadAndKeepsTheHistory));
});
```

Read `facts-fixtures.ts` first: if `openedPull`'s head or base are not `head` and `base`, use the fields it carries (`openedPull.headSha`, `openedPull.baseSha`) everywhere above; if its timestamp field is not `githubUpdatedAt`, use the record's name. If `pullRequestFacts` lives under another name, import the export `queries.ts` uses for `PullRequestFacts`.

- [ ] **Step 7: Run it and see it fail**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/github/facts/heads.pg.test.ts`
Expected: FAIL; `heads.ts` does not exist.

- [ ] **Step 8: The writer**

`apps/uw-app/github/facts/heads.ts` (move `recordFilesIn`, `recordAllFiles` and `recordFiles` out of `upsert.ts` and grow them):

```ts
import { and, eq, sql } from 'drizzle-orm';
import type { Database, Executor, Transaction } from '@uw/db/client';
import { ghPrs } from '@uw/db/schema';
import type { FilesRecord } from './records.ts';

const PATCH_HISTORY = 100;

function patchIdsAfter(files: FilesRecord) {
  if (files.patchId === null) return sql`${ghPrs.patchIds}`;
  const added = JSON.stringify({ [files.head]: files.patchId });
  return sql`CASE WHEN (SELECT count(*) FROM jsonb_object_keys(${ghPrs.patchIds})) >= ${PATCH_HISTORY}
    THEN ${added}::jsonb ELSE ${ghPrs.patchIds} || ${added}::jsonb END`;
}

async function recordFilesIn(db: Executor, files: FilesRecord): Promise<boolean> {
  const at = and(
    eq(ghPrs.githubId, files.pullRequestId),
    eq(ghPrs.headSha, files.head),
    eq(ghPrs.baseSha, files.base),
  );
  const rows = await db
    .update(ghPrs)
    .set({
      files: files.paths,
      filesHead: files.head,
      filesBase: files.base,
      filesProblem: files.problem,
      behindBy: files.behindBy,
      patchId: files.patchId,
      headCommits: files.commits,
      patchIds: patchIdsAfter(files),
    })
    .where(at)
    .returning({ githubId: ghPrs.githubId });
  return rows.length > 0;
}

export async function recordAllFiles(tx: Transaction, files: readonly FilesRecord[]) {
  let landed = 0;
  const ordered = [...files].sort((a, b) => a.pullRequestId - b.pullRequestId);
  for (const record of ordered) if (await recordFilesIn(tx, record)) landed += 1;
  return landed;
}

export function recordFiles(db: Database, files: FilesRecord): Promise<boolean> {
  return recordFilesIn(db, files);
}
```

`apps/uw-app/github/facts/upsert.ts`: delete the three moved functions and the `FilesRecord` import, `import { recordAllFiles } from './heads.ts';`; add `closes: ghPrs.closes,` to `pullColumns`; in `upsertPulls`' `set`, beside the four `sameHeadOr` lines:

```ts
        behindBy: sameHeadOr('behind_by'),
        patchId: sameHeadOr('patch_id'),
        headCommits: sameHeadOr('head_commits'),
```

(`patch_ids` is not cleared; it is the history.) Every importer of `recordFiles` from `./upsert.ts` (`grep -rn "recordFiles" apps --include=*.ts`) imports it from `heads.ts`.

`apps/uw-app/github/facts/normalise.ts`: `pullOf(repo: RepoRecord, pull: Pull)` takes the repository record (its one caller, `pullBatch`, passes `repo`), uses `repo.githubId` where it used `repoId`, and adds `closes: [...closingReferences(pull.body ?? null, repo.fullName)],` (import `closingReferences` from `@uw/harness`; if `pullSchema` names the body differently, use that field, as `declarationOf` does). `filesFromRest` gains a fourth parameter `head: HeadFacts` and spreads it into every record it returns: `{ pullRequestId, head: compared.head, base: compared.base, paths, problem, ...head }` (rename the local `head` of `compared` destructuring to avoid the clash).

`apps/uw-app/github/facts/files.ts`:

```ts
import type { Database } from '@uw/db/client';
import type { GitHubReads } from '../client.ts';
import type { GitHubResult } from '../failures.ts';
import { headFactsOf } from './head-facts.ts';
import { recordFiles } from './heads.ts';
import { filesFromRest } from './normalise.ts';
import type { PullRequestChange } from './queries.ts';

export async function fetchFilesAtHead(
  reads: GitHubReads,
  db: Database,
  pull: PullRequestChange,
): Promise<GitHubResult<boolean>> {
  const answer = await reads.changedFiles(pull.repo, pull.baseSha, pull.head);
  if (!answer.ok) return answer;
  const compared = { head: pull.head, base: pull.baseSha };
  const head = await headFactsOf(answer.value, pull.repo);
  const files = filesFromRest(pull.githubId, compared, answer.value.files, head);
  return { ok: true, value: await recordFiles(db, files) };
}
```

- [ ] **Step 9: The fixture GitHub answers the comparison**

Every fixture answer to `GET /repos/.../compare/...` gains `behind_by: 0`, `total_commits: 1` and `commits: [{ sha: <the head it compares>, commit: { message: 'Show the board' }, parents: [{ sha: <its base> }] }]`, and each file a `status` and a `patch` (any short `@@ -1 +1 @@\n-a\n+b`). Find them: `grep -rln "compare/" apps/uw-app --include=*.ts` and the JSON answers under `apps/uw-app/github/fixtures/` that those files load (the sweep rig's `restFiles`). In `ship-rig.ts`, `listing(paths)` becomes:

```ts
function listing(paths: readonly string[]) {
  const files = paths.map((filename) => ({ filename, status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }));
  const commits = [{ sha: head, commit: { message: 'Show the board' }, parents: [{ sha: base }] }];
  return { status: 200, body: { status: 'ahead', behind_by: 0, total_commits: 1, commits, files } };
}
```

`facts-fixtures.ts`'s `openedPull` gains `closes: []`; every `FilesRecord` literal (`storedOnTheOldBase` in `ship-rig.ts`, tests `pnpm check` names) spreads `unknownHead` unless the test drives Ship to `advance`, where it gives `behindBy: 0, patchId: null, commits: [{ sha: <head>, merge: false, skipCi: false, closes: [] }]`. `client.test.ts`'s compare expectations read `value.files`.

- [ ] **Step 10: Run the facts, the sweep, the refresh and the gate suites**

Run: `pnpm check && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/github apps/uw-app/commands/gates.pg.test.ts apps/uw-app/commands/gate-view.pg.test.ts packages/harness/github`
Expected: green, including `the base comparison in the read model`. A ship test that now refuses `base_behind` or `skip_ci_marker` means its compare answer lacks the Step 9 fields.

- [ ] **Step 11: Commit**

```bash
git add packages/harness/github packages/harness/index.ts apps/uw-app/github
git commit -m "feat(github): record the head's comparison with its base: behind_by, patch id, commits

The compare call the facts module already makes now lists the head's
commits and its distance behind the base. The facts module records, at
each head, behind_by, the patch id (SHA-256 of the diff against the merge
base with hunk positions dropped), each commit's merge parents, skip-ci
markers and closing references, and keeps the patch id of every head seen.
The body's closing references are read on every upsert. The files writer
moves to facts/heads.ts.

SR-1 SR-2. S15-R3 S15-R4 S15-R5 S15-R6."
```

---

### Task 7: Freeze (GD-2)

**Files:**
- Create: `packages/harness/stages/freeze.ts`
- Modify: `packages/harness/stages/commands.ts` (`StageCommands.setFreeze`)
- Modify: `packages/harness/index.ts` (type `FreezeInput`)
- Modify: `apps/uw-app/commands/person/stages.ts` (`setFreezeCommand`), `apps/uw-app/commands/registry.ts` (replace the not-wired entry)
- Create: `sim/kernel/freeze.test.ts`, `sim/scenarios/GD-2.a-freeze-refuses-ship-except-for-named-items.ts`
- Modify: `apps/uw-app/commands/stages.pg.test.ts` (the route)

**Interfaces:**
- Consumes: Task 4's `setFreeze` write and `Harness.frozen`/`freezeAllow`; Task 5's `harness_frozen` predicate fed by `assembleShipInput`.
- Produces: `StageCommands.setFreeze(caller: Caller, input: FreezeInput): Promise<KernelOutcome<HarnessScene>>` with `FreezeInput = { readonly harnessId: string; readonly frozen: boolean; readonly allow: readonly string[] }`.

- [ ] **Step 1: Write the failing tests**

`sim/kernel/freeze.test.ts`:

```ts
import type { ItemState, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import {
  approvedBy,
  greenFacts,
  secondChange,
  simParkedAtShip,
  standardChange,
  type ShipChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly admin: Principal;
  readonly harnessId: string;
  readonly first: ItemState;
  readonly second: ItemState;
};

function approvedFacts(world: World, item: ItemState, change: ShipChange, reviewId: number) {
  const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', change.head, reviewId)];
  return greenFacts(world, { itemId: item.itemId, head: change.head, ref: change.pullRequest, reviews });
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const parked = (title: string, change: ShipChange) =>
      simParkedAtShip(world, { harnessId: harness.id, editor: admin, title, change });
    const first = await parked('Show the board', standardChange);
    const second = await parked('Show the flow', secondChange);
    world.adapters.githubFacts.given(approvedFacts(world, first, standardChange, 9300000001));
    world.adapters.githubFacts.given(approvedFacts(world, second, secondChange, 9300000002));
    await work({ world, admin, harnessId: harness.id, first, second });
  } finally {
    await world.close();
  }
}

function approve(scene: Scene, item: ItemState) {
  return scene.world.kernel.gates.decide(simCaller(scene.world, scene.admin), {
    itemId: item.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: item.expectedHead,
  });
}

function freeze(scene: Scene, actor: Principal, frozen: boolean, allow: readonly string[]) {
  const caller = simCaller(scene.world, actor);
  return scene.world.kernel.stages.setFreeze(caller, { harnessId: scene.harnessId, frozen, allow });
}

async function harnessNames(scene: Scene): Promise<readonly string[]> {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, null),
  );
  return events.map((event) => event.name);
}

describe('GD-2 freeze', () => {
  it('GD-2 refuses Ship harness_frozen for an item not on the list and advances the named one', () =>
    inScene(async (scene) => {
      const frozen = value(await freeze(scene, scene.admin, true, [scene.second.itemId]));
      expect(frozen.harness).toMatchObject({ frozen: true, freezeAllow: [scene.second.itemId] });
      expect(reasonOf(await approve(scene, scene.first))).toBe('harness_frozen');
      expect(value(await approve(scene, scene.second)).advanced).toBe(true);
    }));

  it('GD-2 lifting the freeze lets the other item ship, and each change is one freeze_changed', () =>
    inScene(async (scene) => {
      value(await freeze(scene, scene.admin, true, []));
      value(await freeze(scene, scene.admin, true, []));
      value(await freeze(scene, scene.admin, false, []));
      expect(value(await approve(scene, scene.first)).advanced).toBe(true);
      expect((await harnessNames(scene)).filter((name) => name === 'freeze_changed')).toHaveLength(2);
    }));

  it('GD-2 refuses a lift that names items, an item of another harness, a non-admin and an agent', () =>
    inScene(async (scene) => {
      expect(reasonOf(await freeze(scene, scene.admin, false, [scene.first.itemId]))).toBe('malformed_command');
      expect(reasonOf(await freeze(scene, scene.admin, true, [scene.world.adapters.ids.next()]))).toBe('item_not_found');
      const editor = await simPerson(scene.world, 7, [{ role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' }]);
      expect(reasonOf(await freeze(scene, editor, true, []))).toBe('not_permitted');
      const agent = { ...scene.admin, identity: 'agent:builder', kind: 'agent' as const };
      expect(reasonOf(await freeze(scene, agent, true, []))).not.toBeNull();
    }));
});
```

Add the second change to `sim/ship-fixtures.ts`, below `standardChange`:

```ts
export const secondChange: ShipChange = {
  ...standardChange,
  pullRequest: { repo: 'unfoldingWord/uw-platform', number: 43 },
  head: simSha('def456'),
};
```

Read `readAllEvents`' signature first: if it does not take `null` for harness-level events, read the harness events the way `sim/kernel/stage-command.test.ts` does for `hosted_builder_set` and use that. If `simPerson`'s grant shape differs, copy it from `sim/kernel/exit-guard.test.ts`. The agent check asserts a refusal only; `agentRefusal` decides the reason.

`sim/scenarios/GD-2.a-freeze-refuses-ship-except-for-named-items.ts`:

```ts
import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { approvedBy, greenFacts, simParkedAtShip, standardChange } from '../ship-fixtures.ts';

export const scenario = defineScenario({
  id: 'GD-2',
  title: 'an admin freezes a harness naming no item, and Ship refuses harness_frozen until the freeze is lifted',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const caller = () => simCaller(world, admin);
    const item = await simParkedAtShip(world, { harnessId: harness.id, editor: admin, title: 'Show the board', change: standardChange });
    const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', standardChange.head, 9300000001)];
    world.adapters.githubFacts.given(greenFacts(world, { itemId: item.itemId, head: standardChange.head, reviews }));
    value(await world.kernel.stages.setFreeze(caller(), { harnessId: harness.id, frozen: true, allow: [] }));
    const input = { itemId: item.itemId, decision: 'approve' as const, reason: null, findings: [], seenHead: standardChange.head };
    const refused = reasonOf(await world.kernel.gates.decide(caller(), input));
    value(await world.kernel.stages.setFreeze(caller(), { harnessId: harness.id, frozen: false, allow: [] }));
    const shipped = value(await world.kernel.gates.decide(caller(), input));
    assert.equal(refused, 'harness_frozen');
    assert.equal(shipped.advanced, true);
    return { state: { refused, advanced: shipped.advanced } };
  },
});
```

In `apps/uw-app/commands/stages.pg.test.ts`, add one test beside the `set_hosted_builder` route test, copying its frame: `GD-2 set_freeze freezes for an admin, is refused for an editor, and records freeze_changed`. It posts `{ frozen: true, allow: [] }`, expects `accepted` and one `freeze_changed` event, then posts as the editor and expects the `not_permitted` refusal the hosted-builder test expects.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run sim/kernel/freeze.test.ts` then `pnpm sim -- GD-2`
Expected: FAIL; `stages.setFreeze` does not exist.

- [ ] **Step 3: Write the command**

`packages/harness/stages/freeze.ts`:

```ts
import type { Harness } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import type { HarnessScene } from '../reads/scene.ts';
import { adminRefusal, agentRefusal } from './rules.ts';

type FreezePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type FreezeInput = {
  readonly harnessId: string;
  readonly frozen: boolean;
  readonly allow: readonly string[];
};

const ALLOW_LIMIT = 100;

function shapeRefusal(input: FreezeInput): Refused | null {
  const distinct = new Set(input.allow).size === input.allow.length;
  if (!distinct || input.allow.length > ALLOW_LIMIT) {
    return refused('malformed_command', { field: 'allow' });
  }
  if (!input.frozen && input.allow.length > 0) {
    return refused('malformed_command', { why: 'lift_names_items' });
  }
  return null;
}

async function strangerIn(
  tx: StoreTransaction,
  harnessId: string,
  allow: readonly string[],
): Promise<string | null> {
  for (const itemId of allow) {
    const item = await tx.harnessItems.read.byId(itemId);
    if (item === null || item.harnessId !== harnessId) return itemId;
  }
  return null;
}

function sameFreeze(harness: Harness, input: FreezeInput): boolean {
  if (harness.frozen !== input.frozen || harness.freezeAllow.length !== input.allow.length) {
    return false;
  }
  return harness.freezeAllow.every((itemId) => input.allow.includes(itemId));
}

export async function setFreeze(
  ports: FreezePorts,
  caller: Caller,
  input: FreezeInput,
): Promise<KernelOutcome<HarnessScene>> {
  const denied = agentRefusal(caller) ?? shapeRefusal(input);
  if (denied !== null) return denied;
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.harnessStages(input.harnessId));
    const harness = await tx.harnesses.read.byId(input.harnessId);
    if (harness === null) return refused('harness_not_found', { harnessId: input.harnessId });
    const notAdmin = await adminRefusal(ports, tx, caller, harness, at);
    if (notAdmin !== null) return notAdmin;
    const stranger = await strangerIn(tx, harness.id, input.allow);
    if (stranger !== null) return refused('item_not_found', { itemId: stranger });
    const stages = await tx.harnessStages.read.forHarness(harness.id);
    if (sameFreeze(harness, input)) return accepted({ harness, stages });
    const allow = [...input.allow];
    if (!(await tx.harnesses.write.setFreeze(harness.id, input.frozen, allow))) {
      return refused('harness_not_found', { harnessId: harness.id });
    }
    await recordHarnessEvents(tx, recordContext(ports, caller, at), harness.id, [
      draft('freeze_changed', { frozen: input.frozen, allow }),
    ]);
    return accepted({ harness: { ...harness, frozen: input.frozen, freezeAllow: allow }, stages });
  });
}
```

`packages/harness/stages/commands.ts`: import `setFreeze, type FreezeInput`; `StageCommands` gains `setFreeze(caller: Caller, input: FreezeInput): Promise<KernelOutcome<HarnessScene>>;`; the factory gains `setFreeze: (caller, input) => setFreeze(ports, caller, input),`. `packages/harness/index.ts`: `export type { FreezeInput } from './stages/freeze.ts';`.

`apps/uw-app/commands/person/stages.ts`:

```ts
export const setFreezeCommand = commandHandler({
  name: 'set_freeze',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'set_freeze'>) =>
    fromKernel(
      await kernel.stages.setFreeze(caller, { harnessId, frozen: body.frozen, allow: body.allow }),
    ),
});
```

`apps/uw-app/commands/registry.ts`: import it and replace `notWiredCommand('set_freeze', 'admin')` with `setFreezeCommand`.

- [ ] **Step 4: Run them**

Run: `pnpm check && npx vitest run sim/kernel/freeze.test.ts apps/uw-app/commands/registry.test.ts` then `pnpm sim -- GD-2` then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/commands/stages.pg.test.ts`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/harness/stages packages/harness/index.ts apps/uw-app/commands sim/ship-fixtures.ts sim/kernel/freeze.test.ts sim/scenarios/GD-2.a-freeze-refuses-ship-except-for-named-items.ts
git commit -m "feat(harness): an admin freezes a harness; Ship refuses harness_frozen except for named items

set_freeze records freeze_changed with the allow list; lifting clears it.
The ship rule reads the freeze through the harness row.

GD-2. S15-R10."
```

---

### Task 8: Ship at the gate: the five facts, the carried approval, both heads recorded, and the second run before the merge (SR-1, SR-2, SR-3)

**Files:**
- Modify: `packages/harness/gates/approve-at-ship.ts` (`ShipVerdict`, `ShipCheck`, `PendingExit`, the exit guard)
- Modify: `packages/harness/gates/decide.ts` (`Decision.shipped`, `recordDecision` evidence, `pendingExit`)
- Modify: `packages/harness/gates/exit.ts` (`ExitInput.evaluatedHead`, `ExitGuard`, `exitThroughConnector`'s fourth argument, `requestOf`)
- Modify: `packages/harness/gates/recover.ts` (the evaluated head from the decision row)
- Modify: `packages/harness/testing.ts` (export `exitAfterDecision`, type `PendingExit`)
- Modify: `sim/kernel/exit-guard.test.ts` (the literal gains `evaluatedHead: null`)
- Create: `sim/kernel/ship-facts.test.ts`, `sim/kernel/merge-recheck.test.ts`
- Create: `sim/scenarios/SR-1.ship-refuses-a-change-behind-its-base-auto-closing-skipping-ci-or-unchecked.ts`, `sim/scenarios/SR-2.an-approval-carries-across-a-base-merge-and-not-across-a-code-change.ts`, `sim/scenarios/SR-3.the-merge-runs-the-ship-rule-again-and-never-reads-another-verdict.ts`

**Interfaces:**
- Consumes: Task 5's `countedApprovals`, `CountedApproval`; Task 4's `comparedAt`.
- Produces: `ExitInput.evaluatedHead: string | null`; `type ExitGuard = () => Promise<{ readonly head: string | null } | { readonly refused: string }>`; `exitThroughConnector(ports, context, input, guard?)`; `PendingExit` gains `harness: Harness`, `approver: Principal`, `override: boolean`, `evaluatedHead: string | null`; `gate_decisions.evidence` at a connector stage gains `head` and `approvals`.

- [ ] **Step 1: Write the failing tests**

`sim/kernel/ship-facts.test.ts`:

```ts
import type { ItemState, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software, type PullRequestFacts } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import {
  approvedBy,
  comparedAt,
  greenFacts,
  itemLog,
  simParkedAtShip,
  simPatchId,
  simSha,
  standardChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = { readonly world: World; readonly admin: Principal; readonly item: ItemState };

const approvedHead = standardChange.head;
const mergedHead = simSha('b4e2');

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const item = await simParkedAtShip(world, { harnessId: harness.id, editor: admin, title: 'Show the board', change: standardChange });
    await work({ world, admin, item });
  } finally {
    await world.close();
  }
}

function approved(scene: Scene, head: string): PullRequestFacts {
  const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', approvedHead, 9300000001)];
  return greenFacts(scene.world, { itemId: scene.item.itemId, head, reviews });
}

function approve(scene: Scene) {
  return scene.world.kernel.gates.decide(simCaller(scene.world, scene.admin), {
    itemId: scene.item.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: approvedHead,
  });
}

function withComparison(facts: PullRequestFacts, change: Parameters<typeof comparedAt>[1]): PullRequestFacts {
  return { ...facts, comparison: comparedAt(facts.head, change) };
}

const planted: readonly (readonly [string, (facts: PullRequestFacts) => PullRequestFacts])[] = [
  ['base_behind', (facts) => withComparison(facts, { behindBy: 2 })],
  ['auto_close_keyword', (facts) => ({ ...facts, closes: [{ repo: 'unfoldingWord/uw-platform', number: 99 }] })],
  ['skip_ci_marker', (facts) => withComparison(facts, { commits: [{ sha: facts.head, merge: false, skipCi: true, closes: [] }] })],
  ['required_check_never_ran', (facts) => ({ ...facts, checks: facts.checks.filter((check) => check.name !== 'lint') })],
];

describe('SR-1 a person approving at Ship is refused on each new fact', () => {
  for (const [reason, plant] of planted) {
    it(`SR-1 refuses ${reason} and records it as ship_refused`, () =>
      inScene(async (scene) => {
        scene.world.adapters.githubFacts.given(plant(approved(scene, approvedHead)));
        expect(reasonOf(await approve(scene))).toBe(reason);
        const log = await itemLog(scene.world, scene.item.harnessId, scene.item.itemId);
        expect(log.events.at(-1)).toMatchObject({ name: 'ship_refused', evidence: { reasons: [reason] } });
        expect(log.decisions).toEqual([]);
        expect(scene.world.adapters.connectors.calls()).toEqual([]);
      }));
  }
});

describe('SR-2 an approval carries across a merge from base', () => {
  it('SR-2 advances on a base merge after the approval, merges the new head and records both heads', () =>
    inScene(async (scene) => {
      const patchId = simPatchId('9a7c');
      const commits = [
        { sha: approvedHead, merge: false, skipCi: false, closes: [] },
        { sha: mergedHead, merge: true, skipCi: false, closes: [] },
      ];
      const patchIds = { [approvedHead]: patchId, [mergedHead]: patchId };
      scene.world.adapters.githubFacts.given(withComparison(approved(scene, mergedHead), { commits, patchIds, patchId }));
      expect(value(await approve(scene)).advanced).toBe(true);
      expect(scene.world.adapters.connectors.calls().map((call) => call.expectedHead)).toEqual([mergedHead]);
      const rows = await scene.world.adapters.store.transaction((tx) => tx.gateDecisions.read.forItem(scene.item.itemId));
      expect(rows[0]?.evidence).toMatchObject({
        head: mergedHead,
        approvals: [{ reviewer: 'uw-reviewer', commit: approvedHead, head: mergedHead }],
      });
    }));

  it('SR-2 refuses head_mismatch on a code change pushed after the approval', () =>
    inScene(async (scene) => {
      const commits = [
        { sha: approvedHead, merge: false, skipCi: false, closes: [] },
        { sha: mergedHead, merge: false, skipCi: false, closes: [] },
      ];
      const patchIds = { [approvedHead]: simPatchId('9a7c'), [mergedHead]: simPatchId('c0de') };
      const changed = withComparison(approved(scene, mergedHead), { commits, patchIds, patchId: simPatchId('c0de') });
      scene.world.adapters.githubFacts.given(changed);
      expect(reasonOf(await approve(scene))).toBe('head_mismatch');
      expect(scene.world.adapters.connectors.calls()).toEqual([]);
    }));
});
```

`sim/kernel/merge-recheck.test.ts`:

```ts
import type { ItemState, Principal, Stage } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software } from '@uw/harness';
import { exitAfterDecision, type PendingExit } from '@uw/harness/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import {
  approvedBy,
  comparedAt,
  greenFacts,
  secondChange,
  simParkedAtShip,
  simPatchId,
  simSha,
  standardChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly admin: Principal;
  readonly harness: Awaited<ReturnType<typeof createSimHarness>>['harness'];
  readonly stages: readonly Stage[];
  readonly item: ItemState;
};

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin, stages } = await createSimHarness(world, software);
    const item = await simParkedAtShip(world, { harnessId: harness.id, editor: admin, title: 'Show the board', change: standardChange });
    await work({ world, admin, harness, stages, item });
  } finally {
    await world.close();
  }
}

function stageOf(scene: Scene, key: string): Stage {
  const stage = scene.stages.find((entry) => entry.key === key);
  if (stage === undefined) throw new Error(`no stage ${key}`);
  return stage;
}

function pendingFor(scene: Scene): PendingExit {
  const { world } = scene;
  return {
    item: scene.item,
    stage: stageOf(scene, 'ship'),
    connector: 'merge',
    next: stageOf(scene, 'validate'),
    decisionId: world.adapters.ids.next(),
    overrideReason: null,
    repository: 'unfoldingWord/uw-platform',
    expectedBase: null,
    evaluatedHead: scene.item.expectedHead,
    harness: scene.harness,
    approver: scene.admin,
    override: false,
    context: { actor: scene.admin.identity, at: world.adapters.clock.now(), traceId: world.adapters.ids.next(), requestId: null, ids: world.adapters.ids },
  };
}

async function lastEvent(scene: Scene) {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.item.harnessId, scene.item.itemId),
  );
  return events.at(-1);
}

describe('SR-3 the merge connector runs the ship rule in-process', () => {
  it('SR-3 never reads a verdict from another item: an approved, merged neighbour does not merge this one', () =>
    inScene(async (scene) => {
      const { world, admin } = scene;
      const other = await simParkedAtShip(world, { harnessId: scene.harness.id, editor: admin, title: 'Show the flow', change: secondChange });
      const neighbour = [approvedBy('uw-reviewer[bot]', 'deepinfra', secondChange.head, 9300000002)];
      world.adapters.githubFacts.given(greenFacts(world, { itemId: other.itemId, head: secondChange.head, ref: secondChange.pullRequest, reviews: neighbour }));
      const input = { itemId: other.itemId, decision: 'approve' as const, reason: null, findings: [], seenHead: secondChange.head };
      expect(value(await world.kernel.gates.decide(simCaller(world, admin), input)).advanced).toBe(true);
      world.adapters.githubFacts.given(greenFacts(world, { itemId: scene.item.itemId, head: standardChange.head, reviews: [] }));
      const exited = await exitAfterDecision(world.adapters, pendingFor(scene));
      expect(exited.advanced).toBe(false);
      expect(world.adapters.connectors.calls().map((call) => call.itemId)).toEqual([other.itemId]);
      expect(await lastEvent(scene)).toMatchObject({
        name: 'connector_refused',
        evidence: { connector: 'merge', reason: 'ship_rule_refused: no_reviewer_approval' },
      });
    }));

  it('SR-3 refuses the merge when the head moved after the decision, and calls no connector', () =>
    inScene(async (scene) => {
      const { world } = scene;
      const moved = simSha('c0de');
      const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', standardChange.head, 9300000001)];
      world.adapters.githubFacts.given(greenFacts(world, { itemId: scene.item.itemId, head: moved, reviews }));
      expect((await exitAfterDecision(world.adapters, pendingFor(scene))).advanced).toBe(false);
      expect(world.adapters.connectors.calls()).toEqual([]);
      expect((await lastEvent(scene))?.evidence['reason']).toMatch(/^ship_rule_refused: head_mismatch/);
    }));

  it('SR-3 hands the connector the head the rule evaluated, not the one the item expected', () =>
    inScene(async (scene) => {
      const { world } = scene;
      const merged = simSha('b4e2');
      const patchId = simPatchId('9a7c');
      const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', standardChange.head, 9300000001)];
      const commits = [
        { sha: standardChange.head, merge: false, skipCi: false, closes: [] },
        { sha: merged, merge: true, skipCi: false, closes: [] },
      ];
      const facts = greenFacts(world, { itemId: scene.item.itemId, head: merged, reviews });
      world.adapters.githubFacts.given({ ...facts, comparison: comparedAt(merged, { commits, patchId, patchIds: { [standardChange.head]: patchId, [merged]: patchId } }) });
      expect((await exitAfterDecision(world.adapters, pendingFor(scene))).advanced).toBe(true);
      expect(world.adapters.connectors.calls().map((call) => call.expectedHead)).toEqual([merged]);
    }));
});
```

The three scenarios each drive one of the tests above through `defineScenario`:
- `SR-1....ts`: id `'SR-1'`; plants a head two commits behind its base and asserts `base_behind`, then a body closing `#99` and asserts `auto_close_keyword`; returns both reasons.
- `SR-2....ts`: id `'SR-2'`; the base-merge advance and the code-change refusal from `ship-facts.test.ts`, on two items (`standardChange` and `secondChange`); returns `{ advanced, refused }`.
- `SR-3....ts`: id `'SR-3'`; the neighbour case from `merge-recheck.test.ts`; returns the connector calls' item ids.

Write each as `sim/scenarios/GD-2.*` is written in Task 7 (imports from `../fixtures.ts`, `../runs.ts`, `../ship-fixtures.ts`, `../scenario.ts`, `node:assert/strict`), asserting with `assert.equal`/`assert.deepEqual` and returning `{ state }`. A scenario may import `exitAfterDecision` from `@uw/harness/testing` only if `sim/scenarios` already imports from it (grep); otherwise SR-3's scenario uses two `decide` calls: the neighbour advances, and this item, whose facts have no approval, is refused `no_reviewer_approval` at the decision with no connector call for it.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run sim/kernel/ship-facts.test.ts sim/kernel/merge-recheck.test.ts`
Expected: FAIL. `ship-facts` passes its SR-1 refusals already (Task 5) but fails on the recorded `head` and `approvals` and on the connector's `expectedHead`; `merge-recheck` fails on the missing `exitAfterDecision` export and the missing guard.

- [ ] **Step 3: The exit takes a guard and an evaluated head**

`packages/harness/gates/exit.ts`:

```ts
export type ExitInput = {
  readonly item: ItemState;
  readonly stage: Stage;
  readonly connector: EffectConnector;
  readonly next: Stage | null;
  readonly decisionId: string;
  readonly overrideReason: string | null;
  readonly repository: string | null;
  readonly expectedBase: DecidedBase | null;
  readonly evaluatedHead: string | null;
};

export type ExitGuard = () => Promise<
  { readonly head: string | null } | { readonly refused: string }
>;
```

In `requestOf`: `expectedHead: input.evaluatedHead ?? item.expectedHead,`. Replace `exitThroughConnector`:

```ts
function passThrough(input: ExitInput): ExitGuard {
  return async () => ({ head: input.evaluatedHead });
}

export async function exitThroughConnector(
  ports: ExitPorts,
  context: RecordContext,
  input: ExitInput,
  guard: ExitGuard = passThrough(input),
): Promise<boolean> {
  const guarded = await guard();
  if ('refused' in guarded) {
    const outcome: ConnectorOutcome = { outcome: 'refused', reason: guarded.refused };
    return (await recordExitOutcomes(ports, context, [{ input, outcome }])).advanced;
  }
  const evaluated = { ...input, evaluatedHead: guarded.head };
  const outcome = await runConnector(ports, requestOf(context, evaluated));
  return (await recordExitOutcomes(ports, context, [{ input: evaluated, outcome }])).advanced;
}
```

`packages/harness/gates/recover.ts`: `DecidedRoute` gains `readonly head: string | null;`; `decidedConnectors` adds `head: typeof row.evidence['head'] === 'string' ? row.evidence['head'] : null` to each entry; `stuckAt`'s returned object gains `evaluatedHead: recorded?.head ?? null,`.

`sim/kernel/exit-guard.test.ts`: the crafted `ExitInput` gains `evaluatedHead: null`.

- [ ] **Step 4: The decision records both heads; the exit runs the rule again**

`packages/harness/gates/approve-at-ship.ts`: import `countedApprovals, type CountedApproval` with `shipRule`, `ExitGuard` with `exitThroughConnector`, and `Harness`, `Principal` are already imported. Add and change:

```ts
export type Shipped = {
  readonly head: string | null;
  readonly approvals: readonly CountedApproval[];
};

export type PendingExit = {
  readonly item: ItemState;
  readonly stage: Stage;
  readonly connector: EffectConnector;
  readonly next: Stage | null;
  readonly decisionId: string;
  readonly overrideReason: string | null;
  readonly repository: string | null;
  readonly expectedBase: DecidedBase | null;
  readonly evaluatedHead: string | null;
  readonly harness: Harness;
  readonly approver: Principal;
  readonly override: boolean;
  readonly context: RecordContext;
};

export type ShipCheck = {
  readonly refusal: Refused | null;
  readonly drafts: readonly EventDraft[];
  readonly shipped: Shipped | null;
};

type ShipVerdict = {
  readonly reasons: readonly ShipRefusal[];
  readonly derived: readonly EventDraft[];
  readonly shipped: Shipped | null;
};
```

In `shipVerdict`, the early return gains `shipped: null`; the main path becomes:

```ts
  const input = assembleShipInput(source);
  const outcome = shipRule(input);
  const evidence = riskDerivedAtShip(source);
  return {
    reasons: outcome.verdict === 'advance' ? [] : outcome.reasons,
    derived: evidence === null ? [] : [draft('risk_derived', evidence)],
    shipped: { head: input.pullRequest?.head ?? null, approvals: countedApprovals(input) },
  };
```

`shipCheck` returns `{ refusal: null, drafts: derived, shipped }` on success and `{ refusal: refused(first, { stage, reasons }), drafts: [], shipped: null }` on refusal.

Add the guard and pass it:

```ts
type FactsAtExit = PullRequestFacts | null | 'unavailable';

async function factsAtExit(ports: ShipPorts, item: ItemState): Promise<FactsAtExit> {
  if (item.pullRequest === null) return null;
  try {
    return await ports.githubFacts.refresh(item.pullRequest);
  } catch {
    return 'unavailable';
  }
}

function exitGuard(ports: ShipPorts, pending: PendingExit): ExitGuard {
  return async () => {
    const facts = await factsAtExit(ports, pending.item);
    if (facts === 'unavailable') return { refused: 'ship_rule_unavailable' };
    const { item, harness, approver, override, context } = pending;
    const input = assembleShipInput({ facts, item, harness, approver, at: context.at, override });
    const outcome = shipRule(input);
    if (outcome.verdict === 'refuse') {
      return { refused: `ship_rule_refused: ${outcome.reasons.join(', ')}` };
    }
    return { head: input.pullRequest?.head ?? null };
  };
}

export async function exitAfterDecision(
  ports: ShipPorts,
  pending: PendingExit,
): Promise<{ readonly item: ItemState; readonly advanced: boolean }> {
  const guard = exitGuard(ports, pending);
  const advanced = await exitThroughConnector(ports, pending.context, pending, guard);
  const now = await ports.store.transaction((tx) => tx.harnessItems.read.byId(pending.item.itemId));
  return { item: now ?? pending.item, advanced };
}
```

The connector's refusal reason is bounded to 500 characters by `boundedReason`; nine reasons fit.

`packages/harness/gates/decide.ts`:
- `Decision` gains `readonly shipped: Shipped | null;` (import the type).
- `checkedRoute` returns `{ refusal: await approverRefusal(tx, gate, decision), drafts: [], shipped: null }` on the no-connector path.
- `decisionOf(input, route, ship: ShipCheck)` sets `before: ship.drafts, shipped: ship.shipped` (its caller in `decideIn` passes `ship`).
- `recordDecision`'s evidence:

```ts
    evidence: {
      findings: [...input.findings],
      gateTarget: item.gateTarget,
      connector: decision.connector,
      next: decision.next,
      ...(decision.shipped === null
        ? {}
        : {
            head: decision.shipped.head,
            approvals: decision.shipped.approvals.map((approval) => ({ ...approval })),
          }),
    },
```

- `pendingExit(gate, decided, route, request, shipped: Shipped | null)` adds `evaluatedHead: shipped?.head ?? null, harness: gate.harness, approver: gate.approver, override: input.decision === 'override',`; `decideIn` passes `ship.shipped`.

`packages/harness/testing.ts`: `export { exitAfterDecision, type PendingExit } from './gates/approve-at-ship.ts';`.

- [ ] **Step 5: Run the tests, the gate suites and the architecture gate**

Run: `pnpm check && npx vitest run sim/kernel/ship-facts.test.ts sim/kernel/merge-recheck.test.ts sim/kernel/exit-guard.test.ts sim/kernel/gate-command.test.ts sim/kernel/recover.test.ts tools/architecture/connector-callers.test.ts` then `pnpm sim -- SR-1 && pnpm sim -- SR-2 && pnpm sim -- SR-3 && pnpm sim -- all`
Expected: green. `connector-callers` passes unchanged: `shipRule(` is still called only in `approve-at-ship.ts` and `ship-rule.ts`, and the exit only from `approve-at-ship.ts`.

Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/commands/gates.pg.test.ts apps/uw-app/harness apps/uw-app/github/merge.test.ts`
Expected: green. The platform merge now refreshes the facts a second time before `PUT .../merge`; a test that counts GitHub requests (`readsBeforeTheMerge`) gains the second pull read before the merge, which is the SR-3 behaviour: update its expected list and say so in the commit body.

- [ ] **Step 6: Commit**

```bash
git add packages/harness/gates packages/harness/testing.ts sim apps/uw-app
git commit -m "feat(harness): the merge runs the ship rule again and merges the head it evaluated

The approve-at-Ship path hands the stage exit a guard that refreshes the
facts and runs the ship rule in-process; the connector merges only on
advance, at the evaluated head, and otherwise records connector_refused
with the reasons. The gate decision records the evaluated head and each
counted approval's commit, so a carried approval names both heads.

SR-1 SR-2 SR-3. S15-R7 S15-R8 S15-R9."
```

---

### Task 9: Batch gate decisions (GD-1)

**Files:**
- Create: `packages/harness/gates/decide-batch.ts`
- Modify: `packages/harness/gates/decide.ts` (export `decideIn`, `normalised`, the types `DecideRequest` and `Committed`; a pinned reject)
- Modify: `packages/harness/gates/commands.ts` (`GateCommands.decideGates`), `packages/harness/index.ts` (types `BatchInput`, `BatchEntry`, `BatchDecided`)
- Modify: `apps/uw-app/commands/person/gates.ts` (`decideGatesCommand`), `apps/uw-app/commands/registry.ts`
- Create: `apps/uw-app/views/parts/approve-all.tsx`; Modify: `apps/uw-app/views/screens/gates.tsx`
- Modify: `apps/uw-app/islands/browser/command-body.ts` (`decide_gates` shape), `apps/uw-app/islands/browser/command-form.ts` (`OUTCOME_TEXT`), `apps/uw-app/generated/islands.ts` (regenerated)
- Create: `sim/kernel/decide-gates.test.ts`, `sim/scenarios/GD-1.decide-gates-approves-a-batch-or-refuses-it-whole.ts`, `apps/uw-app/commands/ship-gates.pg.test.ts`
- Modify: `apps/uw-app/islands/browser/command-form.test.ts`, `apps/uw-app/views/gates.pg.test.ts`

**Interfaces:**
- Produces: `GateCommands.decideGates(caller: Caller, input: BatchInput): Promise<KernelOutcome<BatchDecided>>` with `BatchEntry = { readonly itemId: string; readonly head: string; readonly decision: 'approve' | 'reject' }`, `BatchInput = { readonly harnessId: string; readonly entries: readonly BatchEntry[] }`, `BatchDecided = { readonly decided: readonly Decided[] }`.

- [ ] **Step 1: Write the failing tests**

`sim/kernel/decide-gates.test.ts`:

```ts
import type { ItemState, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software, type BatchEntry } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { detailOf, reasonOf, value } from '../runs.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  secondChange,
  simParkedAtShip,
  standardChange,
  type ShipChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly admin: Principal;
  readonly harnessId: string;
  readonly first: ItemState;
  readonly second: ItemState;
};

function factsFor(world: World, item: ItemState, change: ShipChange, approved: boolean) {
  const reviews = approved ? [approvedBy('uw-reviewer[bot]', 'deepinfra', change.head, change === standardChange ? 9300000001 : 9300000002)] : [];
  return greenFacts(world, { itemId: item.itemId, head: change.head, ref: change.pullRequest, reviews });
}

async function inScene(secondApproved: boolean, work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const parked = (title: string, change: ShipChange) =>
      simParkedAtShip(world, { harnessId: harness.id, editor: admin, title, change });
    const first = await parked('Show the board', standardChange);
    const second = await parked('Show the flow', secondChange);
    world.adapters.githubFacts.given(factsFor(world, first, standardChange, true));
    world.adapters.githubFacts.given(factsFor(world, second, secondChange, secondApproved));
    await work({ world, admin, harnessId: harness.id, first, second });
  } finally {
    await world.close();
  }
}

function entry(item: ItemState, decision: BatchEntry['decision'] = 'approve'): BatchEntry {
  return { itemId: item.itemId, head: item.expectedHead ?? '', decision };
}

function batch(scene: Scene, entries: readonly BatchEntry[], actor: Principal = scene.admin) {
  return scene.world.kernel.gates.decideGates(simCaller(scene.world, actor), { harnessId: scene.harnessId, entries });
}

async function logs(scene: Scene) {
  return Promise.all([scene.first, scene.second].map((item) => itemLog(scene.world, scene.harnessId, item.itemId)));
}

describe('GD-1 decide_gates', () => {
  it('GD-1 writes one gate decision per item in one call, each pinned to its own head, and merges each', () =>
    inScene(true, async (scene) => {
      const decided = value(await batch(scene, [entry(scene.first), entry(scene.second)]));
      expect(decided.decided.map((one) => one.advanced)).toEqual([true, true]);
      const [first, second] = await logs(scene);
      expect(first?.decisions).toEqual(['approve']);
      expect(second?.decisions).toEqual(['approve']);
      expect(scene.world.adapters.connectors.calls().map((call) => call.expectedHead).sort()).toEqual(
        [standardChange.head, secondChange.head].sort(),
      );
    }));

  it('GD-1 fails the whole batch on one refusal, names the refusing item, and records nothing', () =>
    inScene(false, async (scene) => {
      const before = await logs(scene);
      const refused = await batch(scene, [entry(scene.first), entry(scene.second)]);
      expect(reasonOf(refused)).toBe('no_reviewer_approval');
      expect(detailOf(refused)).toMatchObject({ itemId: scene.second.itemId });
      const after = await logs(scene);
      expect(after.map((log) => log.decisions)).toEqual([[], []]);
      expect(after.map((log) => log.events.length)).toEqual(before.map((log) => log.events.length));
      expect(scene.world.adapters.connectors.calls()).toEqual([]);
    }));

  it('GD-1 refuses an entry whose head is not the head the item expects, for a reject too', () =>
    inScene(true, async (scene) => {
      const stale = { ...entry(scene.second, 'reject'), head: 'f'.repeat(40) };
      const refused = await batch(scene, [entry(scene.first), stale]);
      expect(reasonOf(refused)).toBe('head_mismatch');
      expect(detailOf(refused)).toMatchObject({ itemId: scene.second.itemId });
    }));

  it('GD-1 rejects with a pinned head, and refuses a repeated item, an empty batch, an item elsewhere and an agent', () =>
    inScene(true, async (scene) => {
      expect(value(await batch(scene, [entry(scene.second, 'reject')])).decided).toHaveLength(1);
      expect(reasonOf(await batch(scene, [entry(scene.first), entry(scene.first)]))).toBe('malformed_command');
      expect(reasonOf(await batch(scene, []))).toBe('malformed_command');
      const elsewhere = await scene.world.kernel.gates.decideGates(simCaller(scene.world, scene.admin), {
        harnessId: scene.world.adapters.ids.next(),
        entries: [entry(scene.first)],
      });
      expect(reasonOf(elsewhere)).toBe('item_not_found');
      const agent = { ...scene.admin, identity: 'agent:builder', kind: 'agent' as const };
      expect(reasonOf(await batch(scene, [entry(scene.first)], agent))).toBe('not_permitted');
    }));
});
```

(`detailOf` is exported by `sim/runs.ts`.)

`sim/scenarios/GD-1.decide-gates-approves-a-batch-or-refuses-it-whole.ts`: id `'GD-1'`, title `'a person approves two gates in one decide_gates and both merge; a batch with one unapproved item records nothing'`. It builds the first test's scene on one harness (two items, both approved), calls `decideGates`, asserts two `advanced`, then parks a third item (`{ ...standardChange, pullRequest: { repo: 'unfoldingWord/uw-platform', number: 44 }, head: simSha('f00d') }`) with facts that carry no approval and asserts a one-entry batch is refused `no_reviewer_approval` naming it. Return `{ advanced, refused }`.

`apps/uw-app/commands/ship-gates.pg.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { command, softwareHarness } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const head = 'a'.repeat(40);

async function belowTheirAction(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const batch = await command(db, scene.editor, scene.harnessId, 'decide_gates', {
    requestId: randomUUID(),
    entries: [{ itemId: randomUUID(), head, decision: 'approve' }],
  });
  const freeze = await command(db, scene.editor, scene.harnessId, 'set_freeze', {
    requestId: randomUUID(),
    frozen: true,
    allow: [],
  });
  const refute = await command(db, scene.viewer, scene.harnessId, 'refute_finding', {
    requestId: randomUUID(),
    itemId: randomUUID(),
    runId: randomUUID(),
    finding: 0,
  });
  for (const sent of [batch, freeze, refute]) expect(sent.body).toMatchObject({ reason: 'not_permitted' });
}

describe.skipIf(!testServer)('the ship and gate commands on the command API', () => {
  it('GD-1 GD-2 RV-2 decide_gates and set_freeze need admin and refute_finding needs write on the area', () =>
    withAppDatabase(belowTheirAction));
});
```

Read one refusal assertion in `apps/uw-app/commands/commands.pg.test.ts` first and match its shape (status code and body) exactly; `refute_finding` is registered not wired until Task 12, and its refusal for a viewer comes from `can()` before the handler, so this test holds now.

In `apps/uw-app/islands/browser/command-form.test.ts` (or the file that tests `commandBody`), add:

```ts
  it('GD-1 the approve-all form sends decide_gates with each shown item and its head', () => {
    const itemId = '00000000-0000-4000-8000-0000000000b1';
    const head = 'a'.repeat(40);
    const body = commandBody('decide_gates', { entries: `${itemId}:${head}` }, '00000000-0000-4000-8000-0000000000aa');
    expect(body).toMatchObject({ command: 'decide_gates', entries: [{ itemId, head, decision: 'approve' }] });
  });
```

In `apps/uw-app/views/gates.pg.test.ts`, copy the WB-6 test that renders two decidable gates and add `GD-1 the Gates view offers approve all shown over the gates whose ship rule advances`: assert one `form[data-command="decide_gates"]` per harness with an approvable gate, its hidden `entries` value listing exactly the approvable `itemId:head` pairs, and no such form when no shown gate advances.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run sim/kernel/decide-gates.test.ts apps/uw-app/islands/browser`
Expected: FAIL; `gates.decideGates` does not exist and `commandBody` returns null for `decide_gates`.

- [ ] **Step 3: Export the single decision's body; pin a reject**

`packages/harness/gates/decide.ts`: rename the type `Request` to `DecideRequest` and export it; export `Committed`, `normalised` and `decideIn`. Change `notTheHeadSeen`:

```ts
function notTheHeadSeen(input: DecideInput, item: ItemState): boolean {
  const pinned = advancing.has(input.decision) || input.seenHead !== undefined;
  return pinned && input.seenHead !== item.expectedHead;
}
```

(The single `reject` and `take_over` commands pass no `seenHead`, so they are unchanged.)

- [ ] **Step 4: Write the batch**

`packages/harness/gates/decide-batch.ts`:

```ts
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { StoreTransaction } from '../ports.ts';
import { exitAfterDecision, readShipFacts, type ShipSnapshot } from './approve-at-ship.ts';
import {
  decideIn,
  normalised,
  type Committed,
  type Decided,
  type DecideInput,
  type GatePorts,
} from './decide.ts';

export type BatchEntry = {
  readonly itemId: string;
  readonly head: string;
  readonly decision: 'approve' | 'reject';
};
export type BatchInput = { readonly harnessId: string; readonly entries: readonly BatchEntry[] };
export type BatchDecided = { readonly decided: readonly Decided[] };

type Planned = { readonly input: DecideInput; readonly snapshot: ShipSnapshot | null };
type Batch = { readonly caller: Caller; readonly harnessId: string; readonly at: Date };

const BATCH_LIMIT = 50;

class BatchRefused extends Error {
  readonly refusal: Refused;

  constructor(refusal: Refused) {
    super(`the batch was refused: ${refusal.reason}`);
    this.name = 'BatchRefused';
    this.refusal = refusal;
  }
}

function naming(outcome: Refused, itemId: string): Refused {
  return refused(outcome.reason, { ...outcome.detail, itemId });
}

function shapeRefusal(input: BatchInput): Refused | null {
  const ids = input.entries.map((entry) => entry.itemId);
  const fits = ids.length > 0 && ids.length <= BATCH_LIMIT && new Set(ids).size === ids.length;
  return fits ? null : refused('malformed_command', { field: 'entries' });
}

function inputOf(entry: BatchEntry): DecideInput {
  const { itemId, decision, head } = entry;
  return { itemId, decision, reason: null, findings: [], seenHead: head };
}

async function planned(
  ports: GatePorts,
  batch: Batch,
  entries: readonly BatchEntry[],
): Promise<readonly Planned[] | Refused> {
  const plans: Planned[] = [];
  for (const entry of [...entries].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    const input = normalised(inputOf(entry));
    if ('status' in input) return naming(input, entry.itemId);
    const request = { actor: batch.caller.actor, at: batch.at, itemId: entry.itemId, decision: entry.decision };
    const snapshot = await readShipFacts(ports, request);
    if (snapshot !== null && 'status' in snapshot) return naming(snapshot, entry.itemId);
    plans.push({ input, snapshot });
  }
  return plans;
}

async function oneIn(
  ports: GatePorts,
  tx: StoreTransaction,
  batch: Batch,
  plan: Planned,
): Promise<Committed> {
  const { itemId } = plan.input;
  const item = await tx.harnessItems.read.byId(itemId);
  if (item === null || item.harnessId !== batch.harnessId) {
    throw new BatchRefused(refused('item_not_found', { itemId }));
  }
  const request = { caller: batch.caller, input: plan.input, at: batch.at, snapshot: plan.snapshot };
  const outcome = await decideIn(ports, tx, request);
  if (outcome.status !== 'accepted') throw new BatchRefused(naming(outcome, itemId));
  return outcome.value;
}

async function committedAll(
  ports: GatePorts,
  batch: Batch,
  plans: readonly Planned[],
): Promise<readonly Committed[] | Refused> {
  try {
    return await ports.store.transaction(async (tx) => {
      const all: Committed[] = [];
      for (const plan of plans) all.push(await oneIn(ports, tx, batch, plan));
      return all;
    });
  } catch (error) {
    if (error instanceof BatchRefused) return error.refusal;
    throw error;
  }
}

export async function decideGates(
  ports: GatePorts,
  caller: Caller,
  input: BatchInput,
): Promise<KernelOutcome<BatchDecided>> {
  if (isAgent(caller.actor)) return refused('not_permitted', { actor: caller.actor.identity });
  const shape = shapeRefusal(input);
  if (shape !== null) return shape;
  const batch = { caller, harnessId: input.harnessId, at: ports.clock.now() };
  const plans = await planned(ports, batch, input.entries);
  if ('status' in plans) return plans;
  const committed = await committedAll(ports, batch, plans);
  if ('status' in committed) return committed;
  const decided: Decided[] = [];
  for (const { decided: one, pending } of committed) {
    decided.push(pending === null ? one : { ...one, ...(await exitAfterDecision(ports, pending)) });
  }
  return accepted({ decided });
}
```

A refusal inside the transaction throws, so Postgres rolls back every row and event the earlier entries wrote (S15-R11). An item in another harness is `item_not_found`: the caller's grants on this harness say nothing about the other.

`packages/harness/gates/commands.ts`: import `decideGates` and the three types; `GateCommands` gains `decideGates(caller: Caller, input: BatchInput): Promise<KernelOutcome<BatchDecided>>;` and the factory:

```ts
async function decideGatesAndResume(
  ports: GatePorts,
  caller: Caller,
  input: BatchInput,
): Promise<KernelOutcome<BatchDecided>> {
  const outcome = await decideGates(ports, caller, input);
  if (outcome.status !== 'accepted') return outcome;
  for (const one of outcome.value.decided) {
    await resumeRunsWhere(ports, gateWaiting(one.item.itemId), 'gate');
  }
  return outcome;
}
```

with `decideGates: (caller, input) => decideGatesAndResume(ports, caller, input),`. `packages/harness/index.ts`: export the three types from `./gates/decide-batch.ts`.

- [ ] **Step 5: The command, the form and the island shape**

`apps/uw-app/commands/person/gates.ts`:

```ts
export const decideGatesCommand = commandHandler({
  name: 'decide_gates',
  action: 'admin',
  run: async (context, body: CommandBody<'decide_gates'>) => {
    const kernel = context.gateKernel();
    const input = { harnessId: context.harnessId, entries: body.entries };
    return fromKernel(await kernel.gates.decideGates(context.caller, input));
  },
});
```

`apps/uw-app/commands/registry.ts`: replace `notWiredCommand('decide_gates', 'admin')` with `decideGatesCommand`. (Task 2 put `decide_gates` in `gateCommands`, so the handler gets the gate kernel with the ship wiring. Agents are refused by the handler's default rule.)

`apps/uw-app/islands/browser/command-body.ts`, beside `findingsOf`:

```ts
function entriesOf(text: string | undefined): readonly Readonly<Record<string, string>>[] {
  return (text ?? '')
    .split(',')
    .filter((pair) => pair !== '')
    .map((pair) => {
      const [itemId = '', head = ''] = pair.split(':');
      return { itemId, head, decision: 'approve' };
    });
}
```

and in `shapes`: `['decide_gates', (given) => ({ entries: entriesOf(given.get('entries')) })],`. `command-form.ts` `OUTCOME_TEXT`: `decide_gates: 'Approved',`.

`apps/uw-app/views/parts/approve-all.tsx`:

```tsx
import { CommandForm } from '@uw/ui/components/command-form.tsx';
import { HumanActionButton } from '@uw/ui/components/human-action.tsx';

export type Approvable = {
  readonly harnessId: string;
  readonly harnessKey: string;
  readonly entries: readonly { readonly itemId: string; readonly head: string }[];
};

function labelOf(batch: Approvable): string {
  const count = batch.entries.length;
  return count === 1
    ? `Approve the 1 gate shown on ${batch.harnessKey}`
    : `Approve all ${count} gates shown on ${batch.harnessKey}`;
}

export function ApproveAll(props: { readonly batch: Approvable }) {
  const { batch } = props;
  const value = batch.entries.map((entry) => `${entry.itemId}:${entry.head}`).join(',');
  return (
    <CommandForm harnessId={batch.harnessId} command="decide_gates">
      <input type="hidden" name="entries" value={value} />
      <HumanActionButton itemId={batch.harnessId} label={labelOf(batch)} name="decision" value="approve" />
    </CommandForm>
  );
}
```

`apps/uw-app/views/screens/gates.tsx`: import `ApproveAll, type Approvable`; add

```ts
const BATCH_LIMIT = 50;

function approvable(shown: readonly Shown[]): readonly Approvable[] {
  const byHarness = new Map<string, Approvable>();
  for (const { row, gate } of shown) {
    const head = gate.view.expectedHead;
    const ready = gate.decides && gate.ability.can && gate.view.ship?.outcome.verdict === 'advance';
    if (!ready || head === null) continue;
    const held = byHarness.get(row.harness.id) ?? { harnessId: row.harness.id, harnessKey: row.harness.key, entries: [] };
    byHarness.set(row.harness.id, { ...held, entries: [...held.entries, { itemId: row.item.itemId, head }] });
  }
  return [...byHarness.values()].map((batch) => ({ ...batch, entries: batch.entries.slice(0, BATCH_LIMIT) }));
}
```

and render, between the note and `<GateList shown={shown} />`:

```tsx
        {approvable(shown).map((batch) => (
          <ApproveAll batch={batch} />
        ))}
```

Regenerate the islands bundle: `pnpm ui:islands`.

- [ ] **Step 6: Run them**

Run: `pnpm check && npx vitest run sim/kernel/decide-gates.test.ts sim/kernel/gate-command.test.ts apps/uw-app/islands tools/ui/generated-islands.test.ts apps/uw-app/commands/registry.test.ts` then `pnpm sim -- GD-1`
Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/commands/ship-gates.pg.test.ts apps/uw-app/views/gates.pg.test.ts tools/architecture`
Expected: green. `tools/architecture` holds: `gate_decisions` is still written only in `decide.ts`'s `recordDecision`, now reached from two exported callers in the gates module.

- [ ] **Step 7: Check the screen in light, dark and phone width**

Run the app as the `run` skill or `docs/progress_tracker.md`'s screen-check recipe says, open `/gates` with two approvable gates, and confirm the approve-all control in light and dark at 375 px: Kindle button, visible focus, the outcome line after a click. If no browser can run here, add a "Not verified" row naming the screen and the reason.

- [ ] **Step 8: Commit**

```bash
git add packages/harness/gates packages/harness/index.ts apps/uw-app sim/kernel/decide-gates.test.ts sim/scenarios/GD-1.decide-gates-approves-a-batch-or-refuses-it-whole.ts
git commit -m "feat(harness): decide_gates, one transaction of pinned gate decisions, refused whole

A person approves or rejects up to fifty gates in one command. Each entry
runs the single decision's body, pinned to its own head and checked by the
same ship rule, inside one transaction; any refusal rolls the batch back
and names the item. The Gates view offers approve all shown per harness.

GD-1. S15-R11."
```

---

### Task 10: An engine's refusal is never routed around (GD-3)

**Files:**
- Modify: `packages/harness/runs/tool-loop.ts` (outcome `refused`), `packages/harness/runs/tool-loop.test.ts`
- Modify: `apps/uw-app/engines/seam.ts` (`EngineWorkResult.outcome`), `apps/uw-app/runs/bodies.ts` (`ModelDone.outcome`), `apps/uw-app/runs/run-core.ts` (`afterWork`)
- Modify: `packages/harness/runs/lifecycle.ts` (`fail` hands over on `engine_refused`)
- Modify: `packages/harness/runs/backoff.ts` (`refusedByEngine`), `packages/harness/runs/beat.ts` (`firstItem`)
- Create: `packages/harness/runs/refused.test.ts`, `sim/kernel/engine-refused.test.ts`, `sim/scenarios/GD-3.an-engine-refusal-hands-the-item-to-a-person-and-starts-no-second-run.ts`, `apps/uw-app/runs/engine-refused.pg.test.ts`

**Interfaces:**
- Produces: `LoopResult.outcome: 'ended' | 'turn_limit' | 'refused'`; `refusedByEngine(events: readonly HarnessEvent[]): boolean`.

- [ ] **Step 1: Write the failing tests**

In `packages/harness/runs/tool-loop.test.ts`, copying its turn fixture (read the file; it builds `TurnResult`s with a helper):

```ts
  it('GD-3 ends refused on a turn the engine refused, and calls no tool after it', async () => {
    const calls: string[] = [];
    const tools = { call: async (verb: string) => { calls.push(verb); return { output: {}, isError: false }; } };
    const refusedTurn = { ...turnResult('end_turn'), stopReason: 'refused' as const, text: 'I cannot help with that.' };
    const loop = await runToolLoop(async () => refusedTurn, tools, request, async () => undefined);
    expect(loop.outcome).toBe('refused');
    expect(loop.turns).toBe(1);
    expect(calls).toEqual([]);
  });
```

using the file's own names for the turn builder and the request (`turnResult` and `request` above stand for them).

`packages/harness/runs/refused.test.ts`:

```ts
import { eventSchema, type HarnessEvent } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { refusedByEngine } from './backoff.ts';

const runId = '00000000-0000-4000-8000-0000000000d1';
const person = '00000000-0000-4000-8000-000000000001';
let position = 0;

function event(name: string, actor: string, evidence: Record<string, unknown>): HarnessEvent {
  position += 1;
  return eventSchema.parse({
    eventId: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
    harnessId: '00000000-0000-4000-8000-0000000000a1',
    itemId: '00000000-0000-4000-8000-0000000000b1',
    name,
    position,
    at: '2026-10-15T09:00:00.000Z',
    actor,
    evidence,
    traceId: '00000000-0000-4000-8000-0000000000c1',
    requestId: null,
  });
}

const failed = (why: string) =>
  event('run_failed', 'agent:reviewer', { runId, step: 'work', why, detail: null });
const handed = event('handed_to_person', 'agent:reviewer', { personId: person, why: 'engine_refused', rounds: null });
const released = event('item_released', `human:${person}`, { holder: `human:${person}` });

describe('GD-3 an engine refusal holds the item until a person acts', () => {
  it('holds after an engine_refused failure and after the hand-off', () => {
    expect(refusedByEngine([failed('engine_refused'), handed])).toBe(true);
  });

  it('lets go once a person acts on the item', () => {
    expect(refusedByEngine([failed('engine_refused'), handed, released])).toBe(false);
  });

  it('does not hold for any other failure', () => {
    expect(refusedByEngine([failed('retries_exhausted')])).toBe(false);
    expect(refusedByEngine([])).toBe(false);
  });
});
```

`sim/kernel/engine-refused.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller } from '../fixtures.ts';
import { reviewWorld, type ReviewWorld } from '../review-runs.ts';
import { itemEvents, itemOf, systemCaller, value } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const DAY_MS = 24 * 3_600_000;

async function inWorld(work: (scene: ReviewWorld) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await reviewWorld(world));
  } finally {
    await world.close();
  }
}

function beat(scene: ReviewWorld) {
  return scene.world.kernel.runs.beat(systemCaller(scene), { limit: 10 });
}

describe('GD-3 refusals are never routed around', () => {
  it('GD-3 hands the item to the grantor and starts no second run, on any engine, even after the backoff', () =>
    inWorld(async (scene) => {
      const why = { step: 'work' as const, why: 'engine_refused' as const, detail: null };
      value(await scene.world.kernel.runs.fail(scene.host, scene.runId, why));
      const tail = (await itemEvents(scene, scene.itemId)).slice(-3);
      expect(tail.map((event) => event.name)).toEqual(['run_failed', 'item_released', 'handed_to_person']);
      expect(tail[2]?.evidence).toEqual({ personId: scene.owner.personId, why: 'engine_refused', rounds: null });
      expect(await itemOf(scene.world, scene.itemId)).toMatchObject({ holder: `human:${scene.owner.personId ?? ''}` });
      scene.world.adapters.clock.advance(2 * DAY_MS);
      expect(value(await beat(scene)).started).toEqual([]);
    }));

  it('GD-3 dispatches again once the person releases the item', () =>
    inWorld(async (scene) => {
      const why = { step: 'work' as const, why: 'engine_refused' as const, detail: null };
      value(await scene.world.kernel.runs.fail(scene.host, scene.runId, why));
      value(await scene.world.kernel.items.release(simCaller(scene.world, scene.owner), { itemId: scene.itemId }));
      scene.world.adapters.clock.advance(2 * DAY_MS);
      expect(value(await beat(scene)).started).toHaveLength(1);
    }));
});
```

(If the kernel's `fail` lives under another name on `kernel.runs`, use the one `apps/uw-app/runs/run-core.ts`'s `failRun` calls. If the review run does not hold the item, the tail has no `item_released`; read the tail and keep the assertion on `run_failed` and `handed_to_person`.)

`sim/scenarios/GD-3.an-engine-refusal-hands-the-item-to-a-person-and-starts-no-second-run.ts`: id `'GD-3'`, the first test's steps through `defineScenario`, returning `{ handed: evidence, started: count }`.

`apps/uw-app/runs/engine-refused.pg.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { Caller, RunStart } from '@uw/harness';
import { platformStore } from '../ports/store.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { ended, fakeSteps, hostRig, runDepsFor, scriptedEngines, startedRun } from '../testing/run-host.ts';
import { runWorkflow } from './run-core.ts';

const host: Caller = { actor: systemPrincipal(), traceId: randomUUID(), requestId: null };
const holds = '```harness-scout\npremise: holds\nreason: the plan still stands\n```';

async function refusedOnce(db: Database): Promise<void> {
  const rig = await hostRig(db, host, {});
  const worked: string[] = [];
  const engines = scriptedEngines({
    'openrouter-messages': async () => ended(holds, { resolvedProvider: 'z-ai', resolvedModel: 'z-ai/glm-5.3-flash' }),
    'claude-messages': async (work) => {
      worked.push(work.runId);
      return ended('I will not do this.', { outcome: 'refused' });
    },
  });
  const runId = await startedRun(rig);
  const start: RunStart = {
    runId,
    harnessId: rig.harnessId,
    itemId: rig.itemId,
    persona: 'agent:builder',
    runShape: 'workflow-run',
    engine: 'claude-messages',
    traceId: randomUUID(),
  };
  expect(await runWorkflow(start, fakeSteps(), runDepsFor(rig, host, engines))).toBe('failed');
  const run = await platformStore(rig.db).transaction((tx) => tx.harnessRuns.read.byId(runId));
  expect(run).toMatchObject({ outcome: 'failed', failure: 'engine_refused' });
  expect(worked).toEqual([runId]);
}

describe.skipIf(!testServer)('GD-3 an engine refusal on the platform host', () => {
  it('GD-3 fails the run engine_refused after one work step and runs it again nowhere', () =>
    withAppDatabase(refusedOnce));
});
```

(Read `RunRow`'s failure field name in `packages/harness/ports.ts` or `store-ports.ts`; use it.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/harness/runs/tool-loop.test.ts packages/harness/runs/refused.test.ts sim/kernel/engine-refused.test.ts`
Expected: FAIL; the loop ignores `stopReason`, `refusedByEngine` does not exist, and no hand-off is appended.

- [ ] **Step 3: The loop, the seam and the host**

`packages/harness/runs/tool-loop.ts`: `LoopResult.outcome: 'ended' | 'turn_limit' | 'refused';` and in `runToolLoop`, after `await onTurn();`:

```ts
    if (result.stopReason === 'refused') return finished(tally, 'refused', result.text);
```

`apps/uw-app/engines/seam.ts`: `EngineWorkResult.outcome: 'ended' | 'turn_limit' | 'refused';`. `apps/uw-app/runs/bodies.ts`: the same union on its `outcome` field. `apps/uw-app/runs/run-core.ts`, `afterWork`, before the `turn_limit` line:

```ts
  if (work.outcome === 'refused') return failRun(flow, 'work', 'engine_refused', null);
```

- [ ] **Step 4: The hand-off and the dispatcher**

`packages/harness/runs/lifecycle.ts`:

```ts
async function handOffAfterRefusal(
  tx: StoreTransaction,
  held: Held,
  why: RunFailure,
): Promise<readonly EventDraft[]> {
  if (why !== 'engine_refused' || held.run.delegationId === null) return [];
  const delegation = await tx.delegations.read.byId(held.run.delegationId);
  if (delegation === null) return [];
  return [draft('handed_to_person', { personId: delegation.personId, why: 'engine_refused', rounds: null })];
}
```

and `fail`'s work becomes:

```ts
  return onRun(ports, caller, { runId, outcomes: live }, async (tx, held) => {
    const next = ended(held.run, { outcome: 'failed', failure: input.why }, held.context.at);
    const handed = await handOffAfterRefusal(tx, held, input.why);
    return endRun(tx, held, next, [
      draft('run_failed', { runId, step: input.step, why: input.why, detail: input.detail }),
      ...released(held.item, held.run),
      ...handed,
    ]);
  });
```

`packages/harness/runs/backoff.ts`:

```ts
export function refusedByEngine(events: readonly HarnessEvent[]): boolean {
  const refusal = events.findLastIndex(
    (event) => event.name === 'run_failed' && event.evidence['why'] === 'engine_refused',
  );
  return refusal !== -1 && !events.slice(refusal + 1).some((event) => event.actor.startsWith('human:'));
}
```

`packages/harness/runs/beat.ts`, `firstItem`: import `refusedByEngine`; the loop's condition becomes

```ts
    const held = refusedByEngine(events) || backingOff(events, persona, at);
    if (!held && !reviewedAtHead(events, persona)) return item.itemId;
```

- [ ] **Step 5: Run them**

Run: `pnpm check && npx vitest run packages/harness/runs sim/kernel/engine-refused.test.ts sim/kernel/run-beat.test.ts sim/kernel/review-rounds.test.ts` then `pnpm sim -- GD-3`
Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/runs`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/harness/runs apps/uw-app/engines/seam.ts apps/uw-app/runs sim/kernel/engine-refused.test.ts sim/scenarios/GD-3.an-engine-refusal-hands-the-item-to-a-person-and-starts-no-second-run.ts
git commit -m "feat(runs): an engine's refusal fails the run engine_refused and hands the item to a person

A model turn that stops refused ends the tool loop; the host fails the run
engine_refused, the kernel hands the item to the delegation's grantor, and
the beat starts no run on it, on any engine or persona, until a person acts.

GD-3. S15-R12."
```

---

### Task 11: Finding weight and the strictness preset (RV-1, RV-3)

**Files:**
- Create: `packages/harness/github/finding-line.ts`
- Modify: `packages/harness/github/verdicts.ts` (findings carry a weight or null), `review-body.ts` (writes `- <weight>: <text>`), `review-findings.ts` (reads the weight back)
- Create: `packages/harness/runs/weights.ts`, `packages/harness/runs/weights.test.ts`
- Modify: `packages/harness/runs/review.ts` (`PostReviewInput.findings`, the refusal, the posted verdict, the record's findings, step 14's shadow branch), `rounds.ts` (`countsAsRound`), `types.ts` and `persona.ts` (`RunPersona.approveAt`)
- Modify: `packages/harness/templates/personas.ts` (the Reviewer's instructions; `approveAt` on the fixtures and the draft)
- Modify: `packages/harness/views/persona.ts` (`PersonaDashboard.approveAt`), `apps/uw-app/views/parts/persona-figures.tsx` (the line)
- Modify: `apps/uw-app/runs/prompts.ts` (`reviewPrompt`), `apps/uw-app/runs/prompts.test.ts`, `apps/uw-app/runs/steps.ts` (`finding_weight_missing` ends the run), `apps/uw-app/github/facts/records.ts` (`ReviewRecord.findings: readonly ReadFinding[]`)
- Modify: `sim/review-runs.ts` (`ReviewSetup.approveAt`), and every `postReview(` input in `sim/` (findings become weighted)
- Modify: `packages/harness/github/verdicts.test.ts`, `review-body.test.ts`, `review-findings.test.ts`
- Create: `sim/kernel/finding-weight.test.ts`, `sim/scenarios/RV-1.theoretical-findings-are-recorded-and-never-make-a-review-round.ts`, `sim/scenarios/RV-3.the-zero-findings-preset-requests-changes-on-a-theoretical-finding.ts`

**Interfaces:**
- Produces: `weighedLine(line: string): ReadFinding` in `finding-line.ts`; `weighedFindings(drafts: readonly ReadFinding[]): readonly ReviewFinding[] | null`, `postedVerdict(approveAt: ApproveAt, verdict: ReviewVerdict, findings: readonly ReviewFinding[]): ReviewVerdict`, `countsAsRound(review: ReviewRecord): boolean` in `runs/weights.ts`; `PostReviewInput.findings: readonly ReadFinding[]`; `RunPersona.approveAt: ApproveAt`; `PersonaDashboard.approveAt: ApproveAt | null`.

- [ ] **Step 1: Write the failing unit tests**

`packages/harness/runs/weights.test.ts`:

```ts
import type { ReviewFinding, ReviewRecord } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { countsAsRound, postedVerdict, weighedFindings } from './weights.ts';

const real: ReviewFinding = { text: 'The lease is never renewed.', weight: 'real' };
const plausible: ReviewFinding = { text: 'The empty state may be dropped.', weight: 'plausible' };
const theoretical: ReviewFinding = { text: 'A clock skew of a year would break this.', weight: 'theoretical' };

function record(verdict: ReviewRecord['verdict'], findings: readonly ReviewFinding[]): ReviewRecord {
  return { reviewer: 'uw-reviewer', provider: 'deepinfra', model: 'z-ai/glm-5.3', verdict, reviewId: 9300000001, findings: [...findings] };
}

describe('RV-1 every finding carries a weight', () => {
  it('keeps weighted findings, trimmed and bounded', () => {
    expect(weighedFindings([{ text: '  The lease is never renewed. ', weight: 'real' }])).toEqual([real]);
    expect(weighedFindings(Array.from({ length: 60 }, () => real))).toHaveLength(50);
  });

  it('refuses the verdict when any finding has no weight', () => {
    expect(weighedFindings([real, { text: 'No weight here.', weight: null }])).toBeNull();
  });

  it('posts approve for no findings, whatever the model said', () => {
    expect(postedVerdict('no_real_or_plausible', 'request_changes', [])).toBe('approve');
  });

  it('counts a review round only for request_changes with a real or plausible finding', () => {
    expect(countsAsRound(record('request_changes', [real]))).toBe(true);
    expect(countsAsRound(record('request_changes', [plausible, theoretical]))).toBe(true);
    expect(countsAsRound(record('request_changes', [theoretical]))).toBe(false);
    expect(countsAsRound(record('request_changes', []))).toBe(false);
    expect(countsAsRound(record('approve', [real]))).toBe(false);
  });
});

describe('RV-3 the strictness preset decides what blocks', () => {
  it('no_real_or_plausible requests changes on a real or plausible finding and keeps the model verdict otherwise', () => {
    expect(postedVerdict('no_real_or_plausible', 'approve', [plausible])).toBe('request_changes');
    expect(postedVerdict('no_real_or_plausible', 'approve', [theoretical])).toBe('approve');
    expect(postedVerdict('no_real_or_plausible', 'request_changes', [theoretical])).toBe('request_changes');
  });

  it('zero_findings requests changes on any finding at all', () => {
    expect(postedVerdict('zero_findings', 'approve', [theoretical])).toBe('request_changes');
  });
});
```

In `packages/harness/github/verdicts.test.ts`, add:

```ts
describe('RV-1 the verdict block reads a weight on every finding line', () => {
  const block = ['```harness-verdict', 'verdict: request_changes', '```'];

  it('reads real, plausible and theoretical, and an unweighted line as weight null', () => {
    const lines = [...block, '- real: The lease is never renewed.', '- theoretical: A year of skew breaks it.', '- No weight here.'];
    expect(parseReviewVerdict(text(lines))).toEqual({
      ok: true,
      verdict: {
        verdict: 'request_changes',
        findings: [
          { text: 'The lease is never renewed.', weight: 'real' },
          { text: 'A year of skew breaks it.', weight: 'theoretical' },
          { text: 'No weight here.', weight: null },
        ],
      },
    });
  });

  it('reads a capitalised or dashed weight as no weight', () => {
    const lines = [...block, '- Real: The lease is never renewed.', '- real - The lease is never renewed.'];
    const read = parseReviewVerdict(text(lines));
    expect(read.ok && read.verdict.findings.map((finding) => finding.weight)).toEqual([null, null]);
  });
});
```

using the file's own `text(lines)` helper (read the top of the file; if it takes a string, join with `'\n'`). The file's existing expectations of `findings: ['...']` become `{ text, weight: null }` objects for lines with no weight.

In `review-body.test.ts` and `review-findings.test.ts`, every expected finding line gains its weight: the body writes `- real: the lease is late` from `{ text: 'the lease is late', weight: 'real' }`, and `parseReviewFindings` reads it back as that object; a line in an older body with no weight reads back as `{ text, weight: null }`. Keep each test's meaning; change only the shapes.

- [ ] **Step 2: Write the failing kernel tests**

`sim/review-runs.ts`: `ReviewSetup` gains `readonly approveAt?: ApproveAt;` (import the type from `@uw/contracts`) and `builderFrontmatter(base, { ... })` in `reviewWorld` gains `approve_at: setup.approveAt ?? 'no_real_or_plausible',`.

`sim/kernel/finding-weight.test.ts`:

```ts
import type { ApproveAt, ReadFinding } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { reviewWorld, type ReviewWorld } from '../review-runs.ts';
import { itemEvents, reasonOf, runOf, startOn, value } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const theoretical: ReadFinding = { text: 'A year of clock skew would break the lease.', weight: 'theoretical' };
const real: ReadFinding = { text: 'The board change drops the empty state.', weight: 'real' };

function review(verdict: 'approve' | 'request_changes', findings: readonly ReadFinding[]) {
  return { verdict, findings, resolvedProvider: 'deepinfra', resolvedModel: 'z-ai/glm-5.3' };
}

async function inWorld(approveAt: ApproveAt, work: (scene: ReviewWorld) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await reviewWorld(world, { approveAt }));
  } finally {
    await world.close();
  }
}

async function post(scene: ReviewWorld, runId: string | null, input: ReturnType<typeof review>) {
  const id = runId ?? value(await startOn(scene)).runId;
  return scene.world.kernel.runs.postReview(scene.host, id, input);
}

describe('RV-1 finding weight', () => {
  it('RV-1 refuses a verdict with an unweighted finding finding_weight_missing, posts nothing and fails the run', () =>
    inWorld('no_real_or_plausible', async (scene) => {
      const unweighted = review('request_changes', [real, { text: 'No weight here.', weight: null }]);
      expect(reasonOf(await post(scene, scene.runId, unweighted))).toBe('finding_weight_missing');
      expect(scene.world.adapters.connectors.reviews()).toEqual([]);
      expect(await runOf(scene.world, scene.runId)).toMatchObject({ outcome: 'failed', failure: 'finding_weight_missing' });
    }));

  it('RV-1 posts each finding with its weight and records the findings on the run', () =>
    inWorld('no_real_or_plausible', async (scene) => {
      value(await post(scene, scene.runId, review('request_changes', [real])));
      const [posted] = scene.world.adapters.connectors.reviews();
      expect(posted?.verdict).toBe('request_changes');
      expect(posted?.body).toContain('- real: The board change drops the empty state.');
      const completed = (await itemEvents(scene, scene.itemId)).findLast((event) => event.name === 'run_completed');
      expect(completed?.evidence['review']).toMatchObject({ findings: [real] });
    }));

  it('RV-1 records theoretical-only verdicts and never counts them as review rounds', () =>
    inWorld('no_real_or_plausible', async (scene) => {
      value(await post(scene, scene.runId, review('request_changes', [theoretical])));
      value(await post(scene, null, review('request_changes', [theoretical])));
      value(await post(scene, null, review('request_changes', [theoretical])));
      const names = (await itemEvents(scene, scene.itemId)).map((event) => event.name);
      expect(names.filter((name) => name === 'run_completed')).toHaveLength(3);
      expect(names).not.toContain('handed_to_person');
    }));

  it('RV-1 records no findings as a success: approve is posted', () =>
    inWorld('no_real_or_plausible', async (scene) => {
      value(await post(scene, scene.runId, review('request_changes', [])));
      expect(scene.world.adapters.connectors.reviews().map((one) => one.verdict)).toEqual(['approve']);
    }));
});

describe('RV-3 the strictness preset on the persona page', () => {
  it('RV-3 zero_findings posts request_changes on a theoretical finding the model approved', () =>
    inWorld('zero_findings', async (scene) => {
      value(await post(scene, scene.runId, review('approve', [theoretical])));
      expect(scene.world.adapters.connectors.reviews().map((one) => one.verdict)).toEqual(['request_changes']);
    }));

  it('RV-3 no_real_or_plausible keeps the approve on a theoretical finding', () =>
    inWorld('no_real_or_plausible', async (scene) => {
      value(await post(scene, scene.runId, review('approve', [theoretical])));
      expect(scene.world.adapters.connectors.reviews().map((one) => one.verdict)).toEqual(['approve']);
    }));
});
```

Read `sim/adapters/connectors.ts` for the recorded review's field names (`reviews()` returns the `ReviewRequest`s: `verdict`, `body`); use them. If a second `startOn` refuses because the previous review run still holds the item, follow `sim/kernel/review-rounds.test.ts`'s `round` helper, which does the same thing successfully.

The two scenarios: `RV-1....ts` (id `'RV-1'`) runs the theoretical-only test's three rounds and asserts no `handed_to_person`; `RV-3....ts` (id `'RV-3'`) runs the zero-findings test. Each builds its scene with `reviewWorld(world, { approveAt })` and returns the posted verdicts.

- [ ] **Step 3: Run them and see them fail**

Run: `npx vitest run packages/harness/runs/weights.test.ts packages/harness/github sim/kernel/finding-weight.test.ts`
Expected: FAIL; `weights.ts` does not exist and findings are strings.

- [ ] **Step 4: Read and write the weight**

`packages/harness/github/finding-line.ts`:

```ts
import { findingWeightSchema, type ReadFinding } from '@uw/contracts';

const weighed = /^([a-z]+): (.+)$/u;

export function weighedLine(line: string): ReadFinding {
  const match = weighed.exec(line.trim());
  const weight = findingWeightSchema.safeParse(match?.[1]);
  const text = match?.[2]?.trim() ?? '';
  return weight.success && text !== '' ? { text, weight: weight.data } : { text: line.trim(), weight: null };
}
```

`packages/harness/github/verdicts.ts`: import `weighedLine` and `ReadFinding`; `ReviewVerdictRead.findings: readonly ReadFinding[]`; `findingsOf` ends `return lines.every((line) => withinLimit(line, FINDING_LIMIT)) ? lines.map(weighedLine) : null;` (rename its local array `lines`).

`packages/harness/github/review-body.ts`: `ReviewBodySource.findings: readonly ReviewFinding[]`; `findingLine(finding: ReviewFinding)` neutralises and folds `finding.text` exactly as it does today, then returns `` `${finding.weight}: ${safe}` `` cut to `FINDING_LIMIT`; `reviewBody` maps `source.findings` through it.

`packages/harness/github/review-findings.ts`: returns `readonly ReadFinding[]`; after the existing cut and filter, `.map(weighedLine)`.

`apps/uw-app/github/facts/records.ts`: `ReviewRecord.findings: readonly ReadFinding[]`.

- [ ] **Step 5: The weights and the verdict in the kernel**

`packages/harness/runs/weights.ts`:

```ts
import type {
  ApproveAt,
  FindingWeight,
  ReadFinding,
  ReviewFinding,
  ReviewRecord,
  ReviewVerdict,
} from '@uw/contracts';

const FINDING_LIMIT = 500;
const FINDINGS_LIMIT = 50;

const blocking: Readonly<Record<ApproveAt, ReadonlySet<FindingWeight>>> = {
  zero_findings: new Set<FindingWeight>(['real', 'plausible', 'theoretical']),
  no_real_or_plausible: new Set<FindingWeight>(['real', 'plausible']),
};

export function weighedFindings(drafts: readonly ReadFinding[]): readonly ReviewFinding[] | null {
  const findings: ReviewFinding[] = [];
  for (const draft of drafts.slice(0, FINDINGS_LIMIT)) {
    if (draft.weight === null) return null;
    const text = draft.text.trim().slice(0, FINDING_LIMIT);
    if (text !== '') findings.push({ text, weight: draft.weight });
  }
  return findings;
}

export function postedVerdict(
  approveAt: ApproveAt,
  verdict: ReviewVerdict,
  findings: readonly ReviewFinding[],
): ReviewVerdict {
  if (findings.length === 0) return 'approve';
  if (findings.some((finding) => blocking[approveAt].has(finding.weight))) return 'request_changes';
  return verdict;
}

export function countsAsRound(review: ReviewRecord): boolean {
  const counted = blocking.no_real_or_plausible;
  return (
    review.verdict === 'request_changes' && review.findings.some((finding) => counted.has(finding.weight))
  );
}
```

`packages/harness/runs/types.ts`: `RunPersona` gains `readonly approveAt: ApproveAt;`. `packages/harness/runs/persona.ts`: both `personaOfPage` and `pinnedPersonaOf` return `approveAt: frontmatter.approve_at,`. Every other `RunPersona` literal `pnpm check` names gains `approveAt: 'no_real_or_plausible'`.

`packages/harness/runs/review.ts`:
- `PostReviewInput.findings: readonly ReadFinding[]`.
- `type Weighed = Omit<PostReviewInput, 'findings'> & { readonly findings: readonly ReviewFinding[] };` and `groundsOf`, `plannedFrom`, `plan` and step 14's `shadowReview` take `Weighed` where they took `PostReviewInput`.
- `plannedFrom`'s `record` is `{ reviewer, provider, model, verdict, findings: [...findings] }` (Task 2's `findings: []` goes) and the body is `reviewBody({ provider, model, verdict, findings })`.
- In `shadowReview`, `review_verdict_recorded` carries `findings: [...input.review.findings]` (Task 2's neutral `[]` goes).
- Add:

```ts
function weighedReview(scene: RunScene, input: PostReviewInput): Weighed | null {
  const findings = weighedFindings(input.findings);
  if (findings === null) return null;
  const verdict = postedVerdict(scene.persona.approveAt, input.verdict, findings);
  return { ...input, verdict, findings };
}

async function unweighed(
  ports: ReviewPorts,
  caller: Caller,
  runId: string,
): Promise<KernelOutcome<RunRow>> {
  const why = { step: 'work' as const, why: 'finding_weight_missing' as const, detail: null };
  const failed = await fail(ports, caller, runId, why);
  return failed.status === 'accepted' ? refused('finding_weight_missing', { runId }) : failed;
}
```

- `postReview` becomes, after the scene check:

```ts
  const review = weighedReview(scene.value, input);
  if (review === null) return unweighed(ports, caller, runId);
  if (scene.value.harness.shadow) {
    return shadowReview(ports, caller, runId, { scene: scene.value, review });
  }
  const planned = await plan(ports, scene.value, review);
```

and the rest of the function is unchanged. If `review.ts` passes 500 lines, move `weighedReview`, `unweighed` and `handOff` into `packages/harness/runs/review-verdict.ts`.

`packages/harness/runs/rounds.ts`: import `countsAsRound`; in `requestedChanges` replace `review.verdict !== 'request_changes'` with `!countsAsRound(review)`; in `roundsAfter` replace `review.verdict !== 'request_changes'` with `!countsAsRound(review)`.

`apps/uw-app/runs/steps.ts`: add `'finding_weight_missing'` to `endingReasons` (the kernel already failed the run; the host only stops).

- [ ] **Step 6: The Reviewer is asked for the weight; the preset is on its page**

`packages/harness/templates/personas.ts`:
- `reviewerSections`, after the `## Verdict` line:

```ts
  '',
  '## Findings',
  'Write each finding on its own line after the block, starting with its weight: `- real: ...` for a defect you are sure of, `- plausible: ...` for one that may be real, `- theoretical: ...` for one that only could be. A finding without its weight is refused. No findings means approve.',
```

- `PersonaFixture` gains `readonly approveAt: ApproveAt | null;`: `builder` and `iterate` `null`, `reviewer` `'no_real_or_plausible'` (`builderHosted` and `reviewerCodex` inherit by spread).
- `personaPageDraft`'s frontmatter ends `...(fixture.approveAt === null ? {} : { approve_at: fixture.approveAt }),`.

`apps/uw-app/runs/prompts.ts`, `reviewPrompt`: replace the three lines from `'Open your answer with this block...'` to `'- <finding>',` with:

```ts
    'Open your answer with this block and nothing before it, then one finding per line, each starting with its weight:',
    '```harness-verdict',
    'verdict: approve',
    '```',
    '- real: <a defect you are sure of>',
    '- plausible: <a defect that may be real>',
    '- theoretical: <a defect that only could be real>',
    'Write no finding lines when you found nothing.',
```

and update `prompts.test.ts`'s expectation of those lines.

`packages/harness/views/persona.ts`: `PersonaDashboard` gains `readonly approveAt: ApproveAt | null;`; `personaView` returns `approveAt: frontmatter.capability === 'review' ? frontmatter.approve_at : null,`. `apps/uw-app/views/parts/persona-figures.tsx`, in `PersonaKpis` after the writes KPI:

```tsx
      {props.dashboard.approveAt === null ? null : (
        <Kpi
          label="Approves at"
          value={approveAtText[props.dashboard.approveAt]}
          detail="The strictness preset on this persona page"
        />
      )}
```

with

```ts
const approveAtText: Readonly<Record<ApproveAt, string>> = {
  zero_findings: 'Zero findings',
  no_real_or_plausible: 'No real or plausible finding',
};
```

- [ ] **Step 7: Give every Reviewer post in the sim its weight**

Run `grep -rln "postReview(" sim --include=*.ts`. Every Reviewer `findings: ['...']` in those files (expect `sim/kernel/review-rounds.test.ts` `changes`, `sim/kernel/run-review.test.ts`, step 14's `sim/joining.ts` `approveVerdict`, `sim/scenarios/PE-6.three-review-rounds-hand-the-item-to-a-person.ts`, `sim/scenarios/HE-4.*`, `sim/e2e/*`) becomes `findings: [{ text: '...', weight: 'real' }]`, so every test that counted rounds still counts them. A person's `reject` findings (`KN-13`, `HE-1`, `WB-8`) stay strings: they are gate findings, not a Reviewer's.

- [ ] **Step 8: Run them**

Run: `pnpm check && npx vitest run packages/harness sim/kernel apps/uw-app/runs/prompts.test.ts apps/uw-app/views/parts` then `pnpm sim -- RV-1 && pnpm sim -- RV-3 && pnpm sim -- PE-6 && pnpm sim -- all`
Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/runs apps/uw-app/github apps/uw-app/views/persona.pg.test.ts`
Expected: green. A run-core test that posts a verdict text with unweighted lines now ends `failed` with `finding_weight_missing`: give its verdict text weighted lines unless the test is about the refusal.

- [ ] **Step 9: Commit**

```bash
git add packages/harness apps/uw-app sim
git commit -m "feat(runs): every Reviewer finding carries a weight; theoretical findings make no review round

The Reviewer writes each finding as - real:, - plausible: or - theoretical:.
A verdict with an unweighted finding is refused finding_weight_missing and
posts nothing. The posted verdict follows the persona's approve_at preset;
no findings posts approve. Only a request_changes with a real or plausible
finding counts toward the three review rounds. The weight is posted, read
back from GitHub, and recorded on the run.

RV-1 RV-3. S15-R13 S15-R14 S15-R15."
```

---

### Task 12: Refuted findings and the refute rate (RV-2)

**Files:**
- Create: `packages/harness/gates/refute.ts`, `packages/harness/gates/verdicts.ts`
- Modify: `packages/harness/gates/commands.ts` (`GateCommands.refuteFinding`), `packages/harness/gates/view.ts` (the view's `verdicts`), `packages/harness/index.ts` (types `RefuteInput`, `Refuted`, `RefuteTally`)
- Create: `packages/harness/views/refutes.ts`, `packages/harness/views/refutes.test.ts`
- Modify: `packages/harness/views/persona.ts` (`PersonaDashboard.refutes`), `packages/harness/views/plane.ts` (`reviewerRefutes`), `packages/harness/views/types.ts` (`PlaneTotals.reviewerRefutes`, `PlaneIndicator` gains `'reviewer_refutes'`), `packages/harness/views/plane-list.ts` (its reader)
- Modify: `apps/uw-app/commands/person/gates.ts` (`refuteFindingCommand`), `apps/uw-app/commands/registry.ts`
- Modify: `apps/uw-app/views/parts/gate-panel.tsx` (the verdicts with a refute control), `apps/uw-app/views/parts/persona-figures.tsx` (the rate), `apps/uw-app/health/agent-plane.ts` (`reviewer_refutes`), `apps/uw-app/views/screens/health-list.tsx`, `apps/uw-app/views/parts/health-words.ts`, `apps/uw-app/islands/browser/command-body.ts`, `command-form.ts`, `apps/uw-app/generated/islands.ts` (regenerated)
- Create: `sim/kernel/refute.test.ts`, `sim/scenarios/RV-2.a-refuted-finding-feeds-the-reviewer-refute-rate.ts`
- Modify: `apps/uw-app/views/health.pg.test.ts` (the label list), `apps/uw-app/health/agent-plane.pg.test.ts` if it lists details

**Interfaces:**
- Produces: `GateCommands.refuteFinding(caller: Caller, input: RefuteInput): Promise<KernelOutcome<Refuted>>` with `RefuteInput = { readonly itemId: string; readonly runId: string; readonly finding: number }`, `Refuted = { readonly recorded: boolean }`; `verdictsOf(events): GateView['verdicts']`; `refuteTallies(events: readonly HarnessEvent[]): readonly RefuteTally[]` with `RefuteTally = { readonly harnessId: string; readonly persona: string; readonly findings: number; readonly refuted: number }`, `REFUTE_WINDOW_MS`, `refuteNames`; `PersonaDashboard.refutes: { readonly findings: number; readonly refuted: number; readonly capped: boolean } | null`; `PlaneTotals.reviewerRefutes: { readonly tallies: readonly RefuteTally[]; readonly capped: boolean }`.

- [ ] **Step 1: Write the failing tests**

`packages/harness/views/refutes.test.ts`:

```ts
import { eventSchema, type HarnessEvent } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { refuteTallies } from './refutes.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const runId = '00000000-0000-4000-8000-0000000000d1';
let position = 0;

function event(name: string, actor: string, evidence: Record<string, unknown>): HarnessEvent {
  position += 1;
  return eventSchema.parse({
    eventId: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
    harnessId,
    itemId: '00000000-0000-4000-8000-0000000000b1',
    name,
    position,
    at: '2026-10-15T09:00:00.000Z',
    actor,
    evidence,
    traceId: '00000000-0000-4000-8000-0000000000c1',
    requestId: null,
  });
}

const findings = [
  { text: 'The lease is never renewed.', weight: 'real' },
  { text: 'A year of clock skew breaks it.', weight: 'theoretical' },
];
const review = { reviewer: 'uw-reviewer', provider: 'deepinfra', model: 'z-ai/glm-5.3', verdict: 'request_changes', reviewId: 9300000001, findings };
const completed = event('run_completed', 'agent:reviewer', { runId, result: 'review_posted', gates: [], review });
const refuted = event('finding_refuted', 'human:00000000-0000-4000-8000-000000000001', {
  runId,
  persona: 'agent:reviewer',
  reviewer: 'uw-reviewer',
  index: 1,
  weight: 'theoretical',
  text: 'A year of clock skew breaks it.',
});

describe('RV-2 the refute rate per Reviewer identity', () => {
  it('counts findings from review records and refutations by the persona that wrote them', () => {
    expect(refuteTallies([completed, refuted])).toEqual([
      { harnessId, persona: 'agent:reviewer', findings: 2, refuted: 1 },
    ]);
  });

  it('counts nothing for a run with no review', () => {
    const builder = event('run_completed', 'agent:builder', { runId, result: 'submitted', gates: [], review: null });
    expect(refuteTallies([builder])).toEqual([]);
  });
});
```

`sim/kernel/refute.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller } from '../fixtures.ts';
import { reviewWorld, type ReviewWorld } from '../review-runs.ts';
import { itemEvents, reasonOf, value } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const findings = [
  { text: 'The board change drops the empty state.', weight: 'real' as const },
  { text: 'A year of clock skew breaks the lease.', weight: 'theoretical' as const },
];

async function reviewed(work: (scene: ReviewWorld) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const scene = await reviewWorld(world);
    const input = { verdict: 'request_changes' as const, findings, resolvedProvider: 'deepinfra', resolvedModel: 'z-ai/glm-5.3' };
    value(await world.kernel.runs.postReview(scene.host, scene.runId, input));
    await work(scene);
  } finally {
    await world.close();
  }
}

function refute(scene: ReviewWorld, finding: number, actor = scene.admin) {
  const input = { itemId: scene.itemId, runId: scene.runId, finding };
  return scene.world.kernel.gates.refuteFinding(simCaller(scene.world, actor), input);
}

describe('RV-2 a person marks a finding refuted', () => {
  it('RV-2 records finding_refuted once, with the finding, and a second mark records nothing', () =>
    reviewed(async (scene) => {
      expect(value(await refute(scene, 1))).toEqual({ recorded: true });
      expect(value(await refute(scene, 1))).toEqual({ recorded: false });
      const marks = (await itemEvents(scene, scene.itemId)).filter((event) => event.name === 'finding_refuted');
      expect(marks.map((event) => event.evidence)).toEqual([
        { runId: scene.runId, persona: 'agent:reviewer', reviewer: 'uw-reviewer', index: 1, weight: 'theoretical', text: 'A year of clock skew breaks the lease.' },
      ]);
    }));

  it('RV-2 refuses an agent and a finding the run did not write', () =>
    reviewed(async (scene) => {
      const agent = { ...scene.admin, identity: 'agent:builder', kind: 'agent' as const };
      expect(reasonOf(await refute(scene, 1, agent))).toBe('not_permitted');
      expect(reasonOf(await refute(scene, 7))).toBe('malformed_command');
    }));

  it('RV-2 shows the 30-day refute rate on the persona view and in the agent plane', () =>
    reviewed(async (scene) => {
      value(await refute(scene, 1));
      const caller = simCaller(scene.world, scene.admin);
      const dashboard = value(await scene.world.kernel.views.persona(caller, { pageId: scene.pageId }));
      expect(dashboard.refutes).toEqual({ findings: 2, refuted: 1, capped: false });
      const totals = await scene.world.kernel.views.planeTotals();
      expect(totals.reviewerRefutes.tallies).toEqual([
        { harnessId: scene.harnessId, persona: 'agent:reviewer', findings: 2, refuted: 1 },
      ]);
    }));
});

```

(`reviewWorld`'s reviewer key comes from the engine descriptor; if it is not `uw-reviewer` for `openrouter-messages`, use the key the posted `run_completed` carries. `scene.admin` holds `admin` on the area, which includes `write`.)

`sim/scenarios/RV-2.a-refuted-finding-feeds-the-reviewer-refute-rate.ts`: id `'RV-2'`; the third test's steps; returns `{ refutes: dashboard.refutes }`.

In `apps/uw-app/views/health.pg.test.ts`, the expected label list gains `'Reviewer refute rate'` at the end (the indicator is appended last).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/harness/views/refutes.test.ts sim/kernel/refute.test.ts`
Expected: FAIL; nothing exists yet.

- [ ] **Step 3: The command and the view's verdicts**

`packages/harness/gates/refute.ts`:

```ts
import { eventEvidenceSchemas, type EventEvidence, type HarnessEvent } from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, readAllEvents, recordContext, recordItemEvents, type RecordContext } from '../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';

type RefutePorts = Pick<Ports, 'clock' | 'ids' | 'store'>;
type Review = NonNullable<EventEvidence['run_completed']['review']>;

export type RefuteInput = { readonly itemId: string; readonly runId: string; readonly finding: number };
export type Refuted = { readonly recorded: boolean };

const FINDING_INDEX_LIMIT = 49;

function reviewOf(events: readonly HarnessEvent[], runId: string): { readonly persona: string; readonly review: Review } | null {
  for (const event of events) {
    if (event.name !== 'run_completed') continue;
    const evidence = eventEvidenceSchemas.run_completed.parse(event.evidence);
    if (evidence.runId === runId && evidence.review !== null) return { persona: event.actor, review: evidence.review };
  }
  return null;
}

function marked(events: readonly HarnessEvent[], input: RefuteInput): boolean {
  return events.some(
    (event) =>
      event.name === 'finding_refuted' &&
      event.evidence['runId'] === input.runId &&
      event.evidence['index'] === input.finding,
  );
}

async function refuteIn(
  tx: StoreTransaction,
  context: RecordContext,
  caller: Caller,
  input: RefuteInput,
): Promise<KernelOutcome<Refuted>> {
  const item = await tx.harnessItems.read.lock(input.itemId);
  const harness = item === null ? null : await tx.harnesses.read.byId(item.harnessId);
  if (item === null || harness === null) return refused('item_not_found', { itemId: input.itemId });
  if (!allowed(caller.actor, 'write', harness, context.at)) return refused('not_permitted', { harnessId: harness.id });
  const events = await readAllEvents(tx, item.harnessId, item.itemId);
  const found = reviewOf(events, input.runId);
  const finding = found?.review.findings[input.finding];
  if (found === null || finding === undefined) return refused('malformed_command', { field: 'finding' });
  if (marked(events, input)) return accepted({ recorded: false });
  const { persona, review } = found;
  await recordItemEvents(tx, context, item.itemId, [
    draft('finding_refuted', { runId: input.runId, persona, reviewer: review.reviewer, index: input.finding, ...finding }),
  ]);
  return accepted({ recorded: true });
}

export function refuteFinding(
  ports: RefutePorts,
  caller: Caller,
  input: RefuteInput,
): Promise<KernelOutcome<Refuted>> {
  if (isAgent(caller.actor) || caller.actor.personId === null) {
    return Promise.resolve(refused('not_permitted', { actor: caller.actor.identity }));
  }
  if (!Number.isInteger(input.finding) || input.finding < 0 || input.finding > FINDING_INDEX_LIMIT) {
    return Promise.resolve(refused('malformed_command', { field: 'finding' }));
  }
  const context = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction((tx) => refuteIn(tx, context, caller, input));
}
```

(If `HarnessEvent['actor']` is typed `Identity` and the evidence wants `Identity`, the types line up; if `persona` must be parsed, parse it with `identitySchema`.)

`packages/harness/gates/verdicts.ts`:

```ts
import { eventEvidenceSchemas, type GateView, type HarnessEvent } from '@uw/contracts';

const VERDICTS_SHOWN = 20;

function refutedKeys(events: readonly HarnessEvent[]): ReadonlySet<string> {
  return new Set(
    events
      .filter((event) => event.name === 'finding_refuted')
      .map((event) => `${String(event.evidence['runId'])} ${String(event.evidence['index'])}`),
  );
}

export function verdictsOf(events: readonly HarnessEvent[]): GateView['verdicts'] {
  const refuted = refutedKeys(events);
  const verdicts = events.flatMap((event) => {
    if (event.name !== 'run_completed') return [];
    const { runId, review } = eventEvidenceSchemas.run_completed.parse(event.evidence);
    if (review === null || review.findings.length === 0) return [];
    const findings = review.findings.map((finding, index) => ({ ...finding, refuted: refuted.has(`${runId} ${index}`) }));
    return [{ runId, persona: event.actor, reviewer: review.reviewer, verdict: review.verdict, findings }];
  });
  return verdicts.slice(-VERDICTS_SHOWN);
}
```

`packages/harness/gates/view.ts`: `Seen` gains `readonly verdicts: GateView['verdicts'];`; `seenIn` returns `verdicts: verdictsOf(events)`; `viewOf` passes `verdicts: seen.verdicts` into `gateViewSchema.parse`.

`packages/harness/gates/commands.ts`: `GateCommands` gains `refuteFinding(caller: Caller, input: RefuteInput): Promise<KernelOutcome<Refuted>>;` and the factory `refuteFinding: (caller, input) => refuteFinding(ports, caller, input),`.

`apps/uw-app/commands/person/gates.ts`:

```ts
export const refuteFindingCommand = commandHandler({
  name: 'refute_finding',
  action: 'write',
  run: async ({ kernel, caller }, body: CommandBody<'refute_finding'>) => {
    const input = { itemId: body.itemId, runId: body.runId, finding: body.finding };
    return fromKernel(await kernel.gates.refuteFinding(caller, input));
  },
});
```

and replace the not-wired entry in `registry.ts`.

- [ ] **Step 4: The rate, on the persona view and in the agent plane**

`packages/harness/views/refutes.ts`:

```ts
import { eventEvidenceSchemas, type HarnessEvent } from '@uw/contracts';

export const REFUTE_WINDOW_MS = 30 * 24 * 3_600_000;
export const refuteNames = ['run_completed', 'finding_refuted'] as const;

export type RefuteTally = {
  readonly harnessId: string;
  readonly persona: string;
  readonly findings: number;
  readonly refuted: number;
};

type Counting = { harnessId: string; persona: string; findings: number; refuted: number };

function counting(tallies: Map<string, Counting>, harnessId: string, persona: string): Counting {
  const key = `${harnessId} ${persona}`;
  const held = tallies.get(key) ?? { harnessId, persona, findings: 0, refuted: 0 };
  tallies.set(key, held);
  return held;
}

function count(tallies: Map<string, Counting>, event: HarnessEvent): void {
  if (event.name === 'run_completed') {
    const { review } = eventEvidenceSchemas.run_completed.parse(event.evidence);
    if (review !== null) counting(tallies, event.harnessId, event.actor).findings += review.findings.length;
  }
  if (event.name === 'finding_refuted') {
    const { persona } = eventEvidenceSchemas.finding_refuted.parse(event.evidence);
    counting(tallies, event.harnessId, persona).refuted += 1;
  }
}

export function refuteTallies(events: readonly HarnessEvent[]): readonly RefuteTally[] {
  const tallies = new Map<string, Counting>();
  for (const event of events) count(tallies, event);
  return [...tallies.values()]
    .filter((tally) => tally.findings > 0 || tally.refuted > 0)
    .sort((a, b) => a.persona.localeCompare(b.persona, 'en') || a.harnessId.localeCompare(b.harnessId, 'en'))
    .map((tally) => ({ ...tally }));
}

export function refuteSince(at: Date): Date {
  return new Date(at.getTime() - REFUTE_WINDOW_MS);
}
```

`packages/harness/views/persona.ts`: `PersonaDashboard` gains `readonly refutes: { readonly findings: number; readonly refuted: number; readonly capped: boolean } | null;`; add

```ts
async function refutesOf(tx: StoreTransaction, scene: Scene, at: Date): Promise<PersonaDashboard['refutes']> {
  if (scene.frontmatter.capability !== 'review') return null;
  const events = await tx.harnessEvents.read.recent({
    since: refuteSince(at),
    names: refuteNames,
    agentsOnly: false,
    limit: PLANE_LIMIT,
    harnessIds: [scene.harness.id],
  });
  const mine = refuteTallies(events).find((tally) => tally.persona === scene.frontmatter.identity);
  return { findings: mine?.findings ?? 0, refuted: mine?.refuted ?? 0, capped: events.length === PLANE_LIMIT };
}
```

and `personaView` returns `refutes: await refutesOf(tx, scene, at),` (import `PLANE_LIMIT` from `./types.ts`, the rest from `./refutes.ts`; use the file's own scene type name for `Scene`).

`packages/harness/views/types.ts`: `PlaneIndicator` gains `| 'reviewer_refutes'`; `PlaneTotals` gains `readonly reviewerRefutes: { readonly tallies: readonly RefuteTally[]; readonly capped: boolean };`.

`packages/harness/views/plane.ts`:

```ts
async function refuteTotals(tx: StoreTransaction, at: Date): Promise<PlaneTotals['reviewerRefutes']> {
  const events = await tx.harnessEvents.read.recent({
    since: refuteSince(at),
    names: refuteNames,
    agentsOnly: false,
    limit: PLANE_LIMIT,
  });
  return { tallies: refuteTallies(events), capped: events.length === PLANE_LIMIT };
}
```

and `planeTotals` returns `reviewerRefutes: await refuteTotals(tx, at),`.

`packages/harness/views/plane-list.ts`: add

```ts
function rateOf(tally: RefuteTally): string | null {
  return tally.findings === 0 ? null : `${Math.round((tally.refuted / tally.findings) * 100)}%`;
}

async function refuteRows(scope: ListScope): Promise<readonly PlaneRow[]> {
  const events = await scope.tx.harnessEvents.read.recent({
    since: refuteSince(scope.at),
    names: refuteNames,
    agentsOnly: false,
    limit: PLANE_LIMIT,
  });
  return refuteTallies(events).map((tally) => ({
    harnessId: tally.harnessId,
    cells: { persona: tally.persona, findings: tally.findings, refuted: tally.refuted, rate: rateOf(tally) },
  }));
}
```

and `['reviewer_refutes', refuteRows],` in `readers`. `packages/harness/index.ts`: export type `RefuteTally`.

`apps/uw-app/health/agent-plane.ts`: append `'reviewer_refutes'` to `AGENT_PLANE_INDICATORS`; add

```ts
function refutesIndicator({ reviewerRefutes }: PlaneTotals): HealthIndicator {
  const { tallies, capped } = reviewerRefutes;
  if (tallies.length === 0) {
    return { name: 'reviewer_refutes', status: 'ok', detail: 'No Reviewer findings in 30 days' };
  }
  const parts = tallies.map(
    (tally) => `${tally.persona} ${formatCount(tally.refuted)} of ${formatCount(tally.findings)} refuted`,
  );
  return {
    name: 'reviewer_refutes',
    status: capped ? 'amber' : 'ok',
    detail: fitted('Refuted findings in 30 days', parts),
  };
}
```

and append `refutesIndicator(totals),` to `agentPlaneIndicators`' list. `apps/uw-app/views/screens/health-list.tsx`: add `'reviewer_refutes'` to `planeIndicators`. `apps/uw-app/views/parts/health-words.ts`: `['reviewer_refutes', 'Reviewer refute rate'],`.

`apps/uw-app/views/parts/persona-figures.tsx`, in `PersonaKpis` after the approve-at KPI:

```tsx
      {props.dashboard.refutes === null ? null : (
        <Kpi
          label="Refuted findings, 30 days"
          value={`${formatCount(props.dashboard.refutes.refuted)} of ${formatCount(props.dashboard.refutes.findings)}`}
          detail={refuteDetail(props.dashboard.refutes)}
        />
      )}
```

with

```ts
function refuteDetail(refutes: NonNullable<PersonaDashboard['refutes']>): string {
  if (refutes.findings === 0) return 'No findings in 30 days';
  const rate = `${Math.round((refutes.refuted / refutes.findings) * 100)}% refuted`;
  return refutes.capped ? `${rate}, at least` : rate;
}
```

- [ ] **Step 5: The refute control on the Gates view**

`apps/uw-app/views/parts/gate-panel.tsx`: the existing `Findings` list renders each GitHub finding as `finding.weight === null ? finding.text : `${reasonText(finding.weight)}: ${finding.text}``. Add, outside any other form:

```tsx
function RefuteForm(props: { readonly view: GateView; readonly runId: string; readonly index: number }) {
  const { view, runId, index } = props;
  const scope = `${runId}-${String(index)}`;
  return (
    <CommandForm harnessId={view.harnessId} command="refute_finding" itemId={scope}>
      <input type="hidden" name="itemId" value={view.itemId} />
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="finding" value={String(index)} />
      <HumanActionButton itemId={scope} label="Mark refuted" name="refute" value="refute" />
    </CommandForm>
  );
}

function Verdicts(props: { readonly view: GateView }) {
  const { view } = props;
  if (view.verdicts.length === 0) return null;
  return (
    <div class="flex flex-col gap-2">
      <h3 class="m-0 text-base font-bold text-ink">Reviewer verdicts on this item</h3>
      <ul class="m-0 flex list-none flex-col gap-3 p-0 text-sm">
        {view.verdicts.map((verdict) => (
          <li class="flex flex-col gap-1">
            <p class="m-0 font-bold">{`${verdict.reviewer}: ${reasonText(verdict.verdict)}`}</p>
            <ul class="m-0 flex flex-col gap-2 pl-5">
              {verdict.findings.map((finding, index) => (
                <li class="flex flex-wrap items-center gap-2 break-words">
                  <span>{`${reasonText(finding.weight)}: ${finding.text}`}</span>
                  {finding.refuted ? (
                    <span class="text-muted">Refuted</span>
                  ) : (
                    <RefuteForm view={view} runId={verdict.runId} index={index} />
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

and in `GatePanel` render `<Verdicts view={view} />` after `<DecisionForm gate={gate} />` (a sibling, not inside it: a form cannot hold a form) and after the read-only `<Findings view={view} />`.

`apps/uw-app/islands/browser/command-body.ts` `shapes`: `['refute_finding', (given) => ({ itemId: given.get('itemId'), runId: given.get('runId'), finding: Number(given.get('finding')) })],`; `command-form.ts` `OUTCOME_TEXT`: `refute_finding: 'Marked refuted',`. Regenerate: `pnpm ui:islands`.

- [ ] **Step 6: Run them**

Run: `pnpm check && npx vitest run packages/harness/views sim/kernel/refute.test.ts sim/kernel/persona-dashboard.test.ts sim/kernel/views-plane.test.ts apps/uw-app/islands tools/ui` then `pnpm sim -- RV-2 && pnpm sim -- all`
Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/health apps/uw-app/views apps/uw-app/commands`
Expected: green. A plane or persona test comparing a whole `PlaneTotals` or `PersonaDashboard` gains `reviewerRefutes: { tallies: [], capped: false }` or `refutes: null` / `approveAt: null` as its scene implies.

- [ ] **Step 7: Check the Gates view and the persona view in light, dark and phone width**

As in Task 9 Step 7: the verdict list with a "Mark refuted" control, the persona view's two new KPIs, and `/health`'s new indicator and its drill-through. Record a "Not verified" row if no browser can run.

- [ ] **Step 8: Commit**

```bash
git add packages/harness apps/uw-app sim/kernel/refute.test.ts sim/scenarios/RV-2.a-refuted-finding-feeds-the-reviewer-refute-rate.ts
git commit -m "feat(harness): a person marks a Reviewer finding refuted; the 30-day refute rate per Reviewer

refute_finding records finding_refuted once per finding, for a person with
write on the area. The Gates view lists each Reviewer verdict with its
weighted findings and a refute control. The refute rate, findings and
refuted per Reviewer persona over 30 days, shows on the persona view and as
the agent-plane indicator reviewer_refutes with its drill-through.

RV-2. S15-R16."
```

---

### Task 13: Verify, record, push

**Files:**
- Modify: `docs/progress_tracker.md` (step 15 row; "Step 15 evidence by requirement"; S15 rulings; carries; "Not verified")

- [ ] **Step 1: Run the whole chain**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres pnpm verify`
Expected: green. Run `pnpm trace` first and confirm SR-1, SR-2, SR-3, GD-1, GD-2, GD-3, RV-1, RV-2 and RV-3 no longer appear as unproven. Note the test and scenario counts.

- [ ] **Step 2: Update the tracker**

In `docs/progress_tracker.md`:
- The step 15 row: state `Built`; evidence: the commit SHAs of Tasks 1 to 12; the proving files per requirement (SR-1 `packages/harness/ship-rule.test.ts`, `packages/harness/gates/ship-input.test.ts`, `packages/harness/github/closing-keywords.test.ts`, `apps/uw-app/github/facts/head-facts.test.ts`, `sim/kernel/ship-facts.test.ts`, scenario SR-1; SR-2 `packages/harness/gates/carry.test.ts`, `apps/uw-app/github/facts/heads.pg.test.ts`, `sim/kernel/ship-facts.test.ts`, scenario SR-2; SR-3 `sim/kernel/merge-recheck.test.ts`, scenario SR-3; GD-1 `sim/kernel/decide-gates.test.ts`, `apps/uw-app/commands/ship-gates.pg.test.ts`, `apps/uw-app/views/gates.pg.test.ts`, scenario GD-1; GD-2 `sim/kernel/freeze.test.ts`, `apps/uw-app/commands/stages.pg.test.ts`, scenario GD-2; GD-3 `packages/harness/runs/refused.test.ts`, `packages/harness/runs/tool-loop.test.ts`, `sim/kernel/engine-refused.test.ts`, `apps/uw-app/runs/engine-refused.pg.test.ts`, scenario GD-3; RV-1 `packages/harness/runs/weights.test.ts`, `packages/harness/github/verdicts.test.ts`, `sim/kernel/finding-weight.test.ts`, scenario RV-1; RV-2 `packages/harness/views/refutes.test.ts`, `sim/kernel/refute.test.ts`, scenario RV-2; RV-3 `sim/kernel/finding-weight.test.ts`, scenario RV-3); `pnpm verify` green locally with the counts; contract `13.0.0`; "CI not run" or the run id.
- A "Step 15 evidence by requirement" table in the shape of step 12's.
- Under decisions made during the build, rows S15-R1 to S15-R17 in the shape of the S12 rows (`| date | requirement | ruling | cost if wrong |`).
- Under carried to later steps: step 14's carry 2 (the six CI job names) is closed by S15-R1; new carries: "the required checks of a live harness change only by re-activation (a command for it is additive, GL-5 or later)"; "a pull request of more than 100 commits refuses `skip_ci_marker` (S15-R5)"; "MD-3 adds the delegation to the ship-rule input and to `PendingExit`; the guard in `approve-at-ship.ts` is where it reads it".
- Under "Not verified": the patch id against a real GitHub compare answer (fixtures only); the approve-all and refute controls and the two persona KPIs in a browser, if Steps 7 of Tasks 9 and 12 could not run; the engine refusal from a real model (only the `stopReason` mapping is proven).

- [ ] **Step 3: Commit and push**

```bash
git add docs/progress_tracker.md
git commit -m "docs(tracker): step 15 is built

SR-1 SR-2 SR-3 GD-1 GD-2 GD-3 RV-1 RV-2 RV-3, with the S15 rulings, contract
13.0.0, and what is carried to steps 16 and 19."
git push
```

The draft pull request for `build/v0.2.0` already exists; push only.

---

## Self-review

**Spec coverage.** Step 15 in PRD section 13 names SR-1, SR-2, SR-3, GD-1, GD-2, GD-3, RV-1, RV-2 and RV-3.
- SR-1: the five refusals in the contract (Task 2), the columns (Task 3), the facts (Task 6: `behind_by`, the commits' skip-ci markers and closing references, the body's closing references), the harness columns (Task 4: required checks, freeze), the predicates and the assembler (Task 5), each proven at the gate (Task 8). The carry-forward concern (uw-platform's six CI jobs) is resolved by S15-R1: required checks are a harness column read by the rule, backfilled for uw-platform.
- SR-2: `patch_id` per head (Task 6, `patch_id` and `patch_ids`, written only by the facts module), the carry (Task 5), "the record names both heads" (Task 8, the decision's evidence), the advancing base-merge scenario and the `head_mismatch` code-change scenario (Task 8).
- SR-3: the in-process re-run before the merge and the evaluated head as the connector's `expectedHead` (Task 8), the planted verdict from another item never read (Task 8).
- GD-1: `decide_gates`, one transaction, pinned per head, same rule, refused whole naming the item, and "approve all shown" (Task 9).
- GD-2: the columns (Task 3), `set_freeze` and `freeze_changed` (Task 7), `harness_frozen` (Tasks 5 and 7).
- GD-3: `engine_refused` from the tool loop through the host (Task 10), no second run by the beat and a hand-off to a person (Task 10), the planted refusing engine (Task 10's app test).
- RV-1: the weight on every finding (Tasks 2 and 11), `finding_weight_missing` (Task 11), theoretical-only not a round (Task 11), no findings a success (Task 11), the Reviewer's instructions (Task 11).
- RV-2: the person-only action and event (Task 12), the measurement as a 30-day read on the persona view and `/health` (Task 12).
- RV-3: the `approve_at` line, its two values and the default (Tasks 2 and 11), shown on the persona view (Task 11).
Design section 6's other columns (`fix_claim`, `bot_authors`, `max_tier`, `delegation_id`, `parent_issue_id`) belong to steps 16 to 19 and are not added. The design's `gh_reviews.refuted_by` and the stored aggregate are replaced by S15-R16 and corrected in Task 1.

**Placeholders.** None in the code steps. Steps that touch files this plan could not read (step 14's code, the app's fixture GitHub answers, the platform test helpers) name the function or the grep that finds them and the exact change to make. The three SR scenarios in Task 8 and the GD-1, GD-3, RV-1, RV-2, RV-3 scenarios are described by the test they run and the state they return, in the frame Task 7 gives in full.

**Type consistency.** `ShipRuleInput`'s fields (Task 2) are what `assembleShipInput` fills (Task 5) and what the rule reads (Task 5). `BaseComparison` and `HeadCommit` (Task 4) are what `carriedCommits` (Task 5), `comparisonOf` (Task 4), `headFactsOf` (Task 6) and `comparedAt` (Task 4) use. `countedApprovals`/`CountedApproval` (Task 5) are what `Shipped` holds (Task 8). `ExitInput.evaluatedHead` and `ExitGuard` (Task 8) are what `recover.ts` and `exitAfterDecision` fill. `DecideRequest`, `Committed`, `decideIn`, `normalised` (Task 9) are exported from `decide.ts` and used only by `decide-batch.ts`. `ReadFinding`/`ReviewFinding` (Task 2) are `ReviewFact.findings` (Task 4), `PostReviewInput.findings` and the record (Task 11), and the verdicts on the gate view (Task 12). `RefuteTally` is the same shape in the persona view, the plane totals and the drill-through (Task 12).

**Review Focus.** Line 1 is pinned in Task 5 (`carry.test.ts`: the rebase and the code-change cases); line 2 in Task 6 (`closing-keywords.test.ts`: quotes, code span, `prefix #12`); line 3 in Task 8 (`merge-recheck.test.ts`: the moved head); line 4 in Task 9 (`decide-gates.test.ts`: decisions and event counts unchanged); line 5 in Task 10 (`engine-refused.test.ts`: two days later, then the release); line 6 in Task 11 (`verdicts.test.ts`: `Real:` and `real -`); line 7 in Task 12 (`refute.test.ts`: the second mark records nothing, the tally counts one).
