# Harness v0.2.0: the version a real repository can use

Status: approved in conversation on 2026-10-15; awaiting Ian's review of this written form. The spec for the v0.2.0 build. `docs/PRD.md` stays the list of work: section 5 below is written into the PRD as section 7.11, section 3 as 18.3 and section 8 into section 13, in the same commit that approves this spec, so `pnpm trace` sees every ID.

## 1. Why this version exists

v0.1.0 (merge commit `83e3f64`, tagged 2026-10-12) is a complete eight-stage product that has never read a real pull request. Every piece of feedback from the Four Harnesses comparison turns on that fact. v0.2.0 is the set of changes that lets one real repository join the platform without anyone being brave, plus the five decisions the feedback forced.

The inputs, in the order they arrived:

| Source | Date | What it asked |
|---|---|---|
| Four Harnesses artifact, "what the shared harness could take from each" table | 2026-10-07 | 22 practices: 6 already there, 7 partly, 9 not started |
| Birch, artifact comment | 2026-10-09 | Intake should take a whole epic with its sub-issues, order blockers, run parallel agents |
| Jesse, three artifact comments | 2026-10-08 | Human merges by default with a per-project override; learnings at project, work-type and org level; migration candidates |
| Seth, "Feedback on Four Harnesses" | 2026-10-11 | Nine non-negotiables; answers to the seven questions; shadow mode; scoping is the throughput lever |
| Jesse's forwarded review of the meeting transcript | 2026-10-12 | The plan never mentions prompt injection; parallel stores undo the integration |
| Seth, "Since Four Harnesses" | 2026-10-14 | Four classes of human action; who holds the ball; approvals carried across base-only updates; agents' refusals are gates; real/plausible/theoretical findings |

"Done" for this version means the code is reviewed, merged to `main` and tagged `v0.2.0`. The pilot runs on the tag; it is not a condition of the tag.

## 2. Words

New entries for `CONTEXT.md`, added in their own commit before any code uses them.

| Word | Meaning | Avoid |
|---|---|---|
| **Platform** | The whole product in `uw-platform`. The comparison called it "the shared harness"; in this repository a harness is one row | the shared harness, the system |
| **Shadow mode** | A harness setting under which the ship rule is evaluated and recorded as an event on every head, and nothing is posted to GitHub and no connector runs | dry run (that is a persona check), read-only mode |
| **Check-only harness** | A harness whose template activates only Check and Ship, joined by a repository requesting the Reviewer identity on a pull request | review service, opt-in review |
| **Merge delegation** | A delegation whose capability word is `merge`: a person lends an agent the Ship exit on one harness, up to one risk tier, until an expiry, recorded | auto-merge, robot merge |
| **Fix claim** | A claim the Builder takes on an item after a review round with findings, under a delegation whose capability word is `fix`, when no other claim is live | fix lane (the bench's word for a second writer) |
| **Untrusted content** | Text that entered the platform from outside it: a pull request diff, an issue body, a review comment, and later a transcript or an invoice. Carried as data, never as instructions, and marked so at the boundary | user input, external text |
| **Epic** | A GitHub issue with sub-issues. Intake reads it as an ordered set of items with blockers | parent issue, milestone (that is a GitHub milestone) |
| **Done-when** | The sentence in an issue that says what finished looks like. Intake refuses an issue without one | acceptance criteria, definition of done |
| **Holder** | Who has the ball on an item right now: the claimant, the Reviewer, or a person waiting to decide | owner (that is the repository's), assignee |
| **Freeze** | A harness setting under which Ship refuses every item except those a person named when setting it | code freeze, lock |
| **Finding weight** | A Reviewer's rating of one finding as `real`, `plausible` or `theoretical`. Only the first two count toward a review round | severity (that is the finding's impact), confidence (that is a learning's label) |
| **Silence alarm** | The health indicator that goes red when items wait in Check and no review step has run for 90 minutes | watchdog |

## 3. Decisions

Made on 2026-10-15 between Ian and Claude, each with what it costs if wrong. These become PRD section 18.3.

| # | Decision | Cost if wrong |
|---|---|---|
| V2-1 | **Merge delegation is in, default off on every harness.** A person grants it; it is scoped to one harness and a maximum tier of `standard`; it never covers deploy, publish, protected paths or `high`; every merge under it is a gate decision whose approver is the granting person and whose actor is the agent, with the delegation id on the row. The Postgres rule "the approver is a human principal" stays | A repo that opts in merges a change nobody read, bounded by the tier and the expiry. The record names who granted it |
| V2-2 | **The fix claim is in, off by default on every harness.** The bench-style second writer, pushing while the author holds the claim, is not built | A Builder fix lands that the author did not want; bounded by the 25% cap and `git revert` |
| V2-3 | **Untrusted content is a rule plus a check, not a defence system.** The two prompt sites that exist are wrapped; prompt reads use the run's own principal; a static check fails the build on an unwrapped outside read. No new content sources are built | A connector in v0.3.0 inherits a rule that turns out to be the wrong shape and is reworked once |
| V2-4 | **Epic intake is in; lessons with statuses wait for v0.3.0.** Intake refuses an issue without a done-when. The v0.3.0 design for lessons is recorded in section 17 | The pilot's queue runs dry anyway, because the epics lack done-whens; or the pilot produces lessons we cannot file for six weeks |
| V2-5 | **The platform is the record's home.** Ian tells Seth this week, framed as plug-in; Jesse is told afterwards. v0.2.0 carries the two hooks the bench needs: its approvals read as Reviewer verdicts, its rulings land as `suggested` learnings | Seth declines and two stores grow; the hooks still serve any later reconciliation |
| V2-6 | **An approval survives a base-only update.** The ship rule accepts a Reviewer approval on an earlier head when the pull request's patch identity (the diff against its merge base) is unchanged between that head and the current one; the record names both heads. This reconciles Seth's "approvals on the exact head" with his "carry an approval across base-only updates" | An approval is honoured on a head the reviewer never saw whose diff is byte-identical; the exposure is a changed merge base, which CI re-runs on and the rule still requires green |
| V2-7 | **No agent verb is added.** A merge under delegation and a fix claim both ride on `submit_to_gate` and `claim_item`; the delegation on the call changes what the kernel does with it. `approve`, `merge`, `deploy`, `publish` and `advance` remain forbidden verbs | None; this is the shape that keeps ADR 0002 |
| V2-8 | **Built for uW's volume.** Seth's ruling ledger as a GitHub comment protocol, re-approval churn machinery and anything sized for a hundred pull requests a day are not built. The shapes that are toggles are taken | The pilot shows a click bottleneck at five pull requests a day, which is unlikely, and batch gate decisions (GD-1) already answer it |

## 4. What a real repository sees

The path a repository such as tc-admin-app takes, in order. Each step names the requirements that make it true.

1. An admin creates a check-only harness naming the repository and sets shadow mode (GL-1, GL-2, GL-4).
2. A contributor requests the Reviewer identity as a reviewer on a pull request. The sweep sees it and enqueues an item at Check (GL-3).
3. The Reviewer runs, posts nothing, and the kernel records its verdict and the ship rule's verdict as events (GL-4, RV-1).
4. For a week, a person compares those events with the bench's verdicts on the same pull requests in the Gates view (OB-3).
5. The admin lifts shadow mode. The Reviewer now posts its review on the head commit; Ship still waits for a person (GL-4).
6. Later, if the repository wants the whole lifecycle, the admin activates the full software template on the same harness; the items it has stay (GL-5).

## 5. Requirements

Every row follows the PRD's conventions: a stable ID, Must or Should, a scenario or test named for the ID, no live account or secret needed to prove it. **Cost** is the toggle test: *toggle* means a value on a harness or stage row, a preset or a persona-page line; *additive* means new files and registry rows with no rule changed; *shared root* means a change to a shared root in its own commit, naming which; *fixed decision* means an ADR as well.

### 5.1 Go-live and joining (GL)

| ID | Requirement | Priority | Cost | Source |
|---|---|---|---|---|
| GL-1 | **Go-live wiring switched on.** Every FD-12 job and binding runs when its secret exists; the tracker's "Waiting on a person" rows for FD-6, FD-7, FD-10 and FD-12 are closed by a live run or restated with what is still missing. Nothing new is written; this is the switch. The release gate for this ID is the staging health probe answering through Hyperdrive | Must | additive | PRD section 14 items 7 to 9 |
| GL-2 | **A check-only template.** A third template fixture, `check-only`, with Check and Ship as its only stages, Ship exiting through `human_approval`, and no Package. It passes the template property test (KN-10). A harness built from it has no Package page and `kickstart` refuses it with `template_has_no_package` | Must | additive; shared root `packages/contracts` for the template fixture | Seth, Q1 and scale check; artifact "opt-in by requesting uwreview" |
| GL-3 | **Joining by review request.** When the GitHub facts show the Reviewer identity requested as a reviewer on a pull request in a check-only harness's repository, the sweep enqueues an item at Check for that pull request, once, with the head as its expected head and no `harness/<item>` branch. A pull request on a repository with no harness enqueues nothing and logs `no_harness_for_repo` | Must | additive | Seth Q1; artifact table |
| GL-4 | **Shadow mode.** A harness column `shadow` (default `false`). While true: the Reviewer's verdict is recorded as a `review_verdict_recorded` event and no GitHub review is posted; the ship rule is evaluated on every head change and recorded as `shadow_verdict`; no connector runs; the Gates view shows the verdict with the label "shadow". Lifting it is an admin command recorded as `shadow_lifted`. A test proves that in shadow mode no GitHub write port method is called | Must | toggle; shared root `packages/db/schema.ts` for the column | Seth Q1 |
| GL-5 | **Template change on a live harness.** An admin may replace a check-only harness's template with the software template; items in Check and Ship keep their stage, and the new stages start empty. Any other template change is refused `template_change_not_allowed` | Should | additive | Section 4 step 6 |
| GL-6 | **Ownership gate on dispatch.** A harness names its repository (exists) and a `dispatch_allowed` list of repositories lives on the platform page for the area. A claim or a sweep on a repository not on the list is refused `repository_not_dispatchable`; if the list cannot be read, every claim is refused `dispatch_list_unavailable`. Fail closed, as Seth's incident | Must | additive | Seth, "things the comparison doesn't cover" |

### 5.2 Merge delegation (MD)

| ID | Requirement | Priority | Cost | Source |
|---|---|---|---|---|
| MD-1 | **ADR 0010, merge under delegation.** Records what changes from ADR 0002 and 0003 and what was rejected (an agent `merge` verb; a per-repo flag without a grantor). Changes the spec's Decisions table (D8, D18) and PRD section 18 in the same commit | Must | fixed decision | V2-1 |
| MD-2 | **The `merge` capability word.** Added to the closed set. A delegation with it carries `max_tier` (`low` or `standard`; `high` is refused `tier_not_delegable`) and the existing harness, persona, expiry and revocation. Granting it needs `admin` on the area; the grant is an event naming the grantor | Must | shared root `packages/contracts`, `packages/db/schema.ts` | Seth non-negotiable 4; Jesse comment |
| MD-3 | **Ship under delegation.** When `submit_to_gate` at Ship carries a live merge delegation, the kernel evaluates the ship rule with the delegation as an input. If it advances, the kernel writes one `gate_decisions` row whose approver is the granting person, whose actor is the agent identity, and whose `delegation_id` names the delegation, inside the transaction that locks and re-reads the delegation; then the merge connector runs. The Postgres check "approver is a human principal" is unchanged; a new check requires `delegation_id` whenever the actor is an agent identity | Must | shared root `packages/db/schema.ts`; fixed decision (MD-1) | V2-1, V2-7 |
| MD-4 | **What a delegation never covers.** The ship rule refuses `protected_path_needs_person` when any changed file is under a protected directory, `tier_above_delegation` when the item's tier exceeds `max_tier`, and `delegation_required` when an agent submits at Ship without one. Deploy and publish connectors never run from a delegated exit: a template property test fails if any path reaches them without a human decision row that has no `delegation_id` | Must | shared root `packages/contracts` for the refusal reasons | Seth non-negotiable 4 |
| MD-5 | **The agent-boundary checks learn the one path.** AB-7's static check that no agent-reachable code writes `gate_decisions` is amended to allow exactly the kernel's delegated Ship exit, by name, and to fail on any second path. The planted fixtures gain a second delegated writer, which must fail | Must | shared root `tools/architecture` rules | ADR 0003 |
| MD-6 | **Delegated merges are visible.** The Gates view and the play-by-play show "merged under a delegation granted by *person* until *expiry*"; `/health` lists live merge delegations beside the others; the notifier sends `delegated_merge` at rank 2 to the grantor | Must | additive | Seth non-negotiable 4 |

### 5.3 The fix claim (FL)

| ID | Requirement | Priority | Cost | Source |
|---|---|---|---|---|
| FL-1 | **The `fix` capability word** and a harness column `fix_claim` (default `false`). While false the Builder is never offered a fix claim and the behaviour equals v0.1.0 | Must | toggle; shared root `packages/contracts`, `packages/db/schema.ts` | V2-2 |
| FL-2 | **When the Builder may claim.** After a review round records findings of weight `real` or `plausible` and the item's claim is free (released or expired), `poll_queue` offers the item to the Builder persona on a harness with `fix_claim` true, and `claim_item` with a live `fix` delegation takes it. One identity holds the branch at a time, as KN-5 already enforces | Must | additive | Seth Q4 |
| FL-3 | **Two validators on a fix.** `fix_size_cap`: the fix changes at most 25% of the pull request's changed lines and touches only files the pull request already touches, plus tests and docs; `fix_keeps_purpose`: the PR declaration is unchanged. Both in the validator registry, both run at `submit_to_gate` from a fix claim, both refuse with their own reason and release the claim | Must | additive | Seth, "cap the fix size, and never change what the PR is for" |
| FL-4 | **Run what you fix.** The Builder's fix work spec installs and runs the repository's declared checks before pushing; if the repository declares none or they fail, the run ends `run_failed` with `checks_not_run_locally` and pushes nothing | Must | additive | Seth, "run what you fix" |

### 5.4 Untrusted content and clearance (UC)

| ID | Requirement | Priority | Cost | Source |
|---|---|---|---|---|
| UC-1 | **One wrapper.** `packages/harness/untrusted.ts` exports the only constructor of `UntrustedContent`: a branded type carrying the text, its source (`pr_diff`, `issue_body`, `review_comment`, `page_from_agent`, and a closed set to extend) and the item. A prompt builder accepts platform text or `UntrustedContent` and renders the latter inside a fence that names the source and says it is data | Must | additive; shared root `CONTEXT.md` for the word | Jesse's review item 3; Seth's leak lesson |
| UC-2 | **The two sites that exist.** The Reviewer's `reviewPrompt` wraps the diff; the Builder's work prompt wraps the issue body and the review comments it reads. A test renders each prompt and asserts every outside string sits inside a fence | Must | additive | UC-1 |
| UC-3 | **Reads carry the run's principal.** Every read a hosted run makes to build a prompt goes through the kernel's read functions with the run's agent principal, so `can()` filters it as it filters an MCP read. A test gives a run an agent identity lacking `read` on a page and asserts the page is absent from the prompt | Must | additive | Seth, "redact before the prompt" |
| UC-4 | **The build check.** An ESLint rule or architecture test fails when a prompt builder is called with a string sourced from a GitHub facts column, an issue or review table, or a page written by an agent identity, unless wrapped by UC-1. A planted fixture fails it | Must | shared root `tools/architecture` rules | V2-3 |
| UC-5 | **Caches keyed by clearance.** Any cache of model output (none exists in v0.1.0; this binds future ones) includes the reading principal's grant set in its key. Recorded as a rule in `docs/architecture.md` and checked by the same rule as UC-4 when a cache module appears | Should | additive | Seth, "key any cache by clearance" |

### 5.5 Epic intake (EI)

| ID | Requirement | Priority | Cost | Source |
|---|---|---|---|---|
| EI-1 | **Sub-issues in the GitHub facts.** `gh_issues` gains `parent_issue_id` and the sweep and import read GitHub's sub-issue list. An issue with sub-issues is an epic | Must | shared root `packages/db/schema.ts` | Birch |
| EI-2 | **Done-when is required.** Intake (import, `kickstart`, and EI-3) refuses an issue whose body has no `Done when` heading with at least one line under it, with `done_when_missing`, and records the refusal as an event on the harness so the Board shows which issues are not ready. An epic's done-when is the union of its sub-issues' | Must | additive | Seth, "most issues lacked a clear done-when"; V2-4 |
| EI-3 | **Enqueue an epic.** `enqueue_epic` (a person command, not an agent verb) reads the epic, creates one item per sub-issue in sub-issue order, and records blockers from `Blocked by: #N` lines in each body, the convention the cross-repo dependency map already uses. A blocked item is not offered by `poll_queue` until every blocker's item has passed Ship. The epic itself becomes no item | Must | additive | Birch; the lasker `xrepo-deps` convention |
| EI-4 | **Parallel claims respect the WIP limit.** Independent sub-issue items may be claimed concurrently up to the stage's WIP limit (exists). A scenario enqueues an epic of four with one blocker chain and shows two claims live and two waiting | Must | additive | Birch |
| EI-5 | **The Board shows the epic.** Items from one epic group under its title, with the blocker edges drawn | Should | additive | Birch |

### 5.6 Ship rule and gate decisions (SR, GD)

| ID | Requirement | Priority | Cost | Source |
|---|---|---|---|---|
| SR-1 | **Five more inputs, five more refusals.** `behind_by` from the pull request's comparison with its base (`base_behind`); a quoted or unquoted closing keyword that would auto-close an issue the item does not wrap (`auto_close_keyword`); a `[skip ci]` marker in any commit on the head (`skip_ci_marker`); a required check that has never run on this head (`required_check_never_ran`); the harness frozen (`harness_frozen`, GD-2). Each is a GitHub fact or a harness column, never a value planted on the item | Must | shared root `packages/contracts` | Seth Q5 |
| SR-2 | **Approval across base-only updates.** `gh_prs` gains `patch_id` per head (the stable hash of the diff against the merge base). An approval counts when its commit equals the head, or when the patch id at its commit equals the patch id at the head and the only change between them is a merge from base. The ship rule's record names both heads. A scenario pushes a base merge after approval and advances; another pushes a code change and refuses `head_mismatch` | Must | shared root `packages/contracts`, `packages/db/schema.ts` | V2-6; Seth follow-up section 3 |
| SR-3 | **The script's exit code is the gate.** The merge connector runs the ship rule in-process and merges only on `advance`; the `--match-head-commit` equivalent is the head the rule evaluated. A test plants a stale verdict from another item and shows it is never read | Must | additive | Seth Q5 and follow-up section 4 |
| GD-1 | **Batch gate decisions.** One person command, `decide_gates`, takes a list of (item, head, decision) and writes one `gate_decisions` row per item in one transaction, each still pinned to its own head and checked by the same rule; any refusal fails the whole batch with the refusing item named. The Gates view offers "approve all shown" over its filtered list | Must | additive | Seth follow-up, the ruling ledger; V2-8 |
| GD-2 | **Freeze.** Harness columns `frozen` (default `false`) and `freeze_allow` (item ids). An admin command sets or lifts it, recorded as `freeze_changed`. Ship refuses `harness_frozen` for any item not in the list | Must | toggle; shared root `packages/db/schema.ts` | Seth follow-up section 4 |
| GD-3 | **Refusals are never routed around.** A `run_failed` whose reason is an engine's own refusal (`engine_refused`) is never re-dispatched to another engine or persona by the kernel; the item is handed to a person. A test plants a refusing engine and asserts no second run starts | Must | additive | Seth follow-up section 5 |

### 5.7 Review verdicts (RV)

| ID | Requirement | Priority | Cost | Source |
|---|---|---|---|---|
| RV-1 | **Finding weight.** Each finding in a Reviewer verdict carries `weight` from the closed set `real`, `plausible`, `theoretical`. A verdict with only `theoretical` findings is recorded and does not count as a review round; "no findings" is recorded as a success. The Reviewer persona page's instructions ask for the weight; a verdict without it is refused `finding_weight_missing` | Must | shared root `packages/contracts` for the field | Seth follow-up section 8 |
| RV-2 | **Refute rate per reviewer.** A finding a person marks `refuted` on the Gates view (a new, person-only action recorded as an event) feeds a measurement per Reviewer identity: findings, refuted, rate, over 30 days; shown on the persona view and `/health` | Must | additive | Seth Q3 |
| RV-3 | **Reviewer strictness preset.** A persona-page line, `approve_at`: `zero_findings` or `no_real_or_plausible` (default). Dimension Z's rule is the first; the bench's and the platform's is the second | Should | toggle | Comparison, "what a finding looks like" |

### 5.8 Observability (OB)

| ID | Requirement | Priority | Cost | Source |
|---|---|---|---|---|
| OB-1 | **Silence alarm.** A `/health` indicator: red when any item has waited in Check for 90 minutes with no review run step recorded on the harness in that time; amber at 45. It sends `silence_alarm` at rank 3 to the harness's admins once per cooldown. Its query is the indicator's drill-through | Must | additive | Seth non-negotiable 5 |
| OB-2 | **Who holds the ball.** The item card and the Board show the holder (claimant, Reviewer, or the person a gate waits on) and how long they have held it; `/health` shows "with a person over 24 hours" and "with an agent over 2 hours" as counts with drill-through | Must | additive | Seth follow-up, "measure who holds the ball" |
| OB-3 | **Shadow comparison.** The Gates view, on a harness in shadow mode, lists each head's shadow verdict beside the GitHub review state the bench or any other reviewer posted on the same head, and marks disagreements. An export of the list is one read route | Must | additive | Seth Q1 |
| OB-4 | **Honest counts.** Every count of items or pull requests on Home, the Board and `/health` excludes pull requests whose author is a bot account the harness lists (`bot_authors`, default `dependabot[bot]`) and says so in the label | Should | toggle | Seth follow-up, "numbers lie until you clean them" |

### 5.9 Plug-in hooks for the bench (PI)

| ID | Requirement | Priority | Cost | Source |
|---|---|---|---|---|
| PI-1 | **A second reviewer's approval counts by configuration.** A harness lists `external_reviewer_identities` (GitHub logins, default empty). An approval on the head by one of them counts toward the tier's reviewer count with its provider recorded as `external`; distinctness still applies. This is how the bench's `uwreview` approvals reach the ship rule | Must | toggle; shared root `packages/db/schema.ts` | V2-5; Seth Q1 |
| PI-2 | **Rulings land as suggested learnings.** The page API accepts a `learning` page from an external runner on a delegation with capability `review`, landing `suggested` as AB-5 already requires, with `source: external` and the pull request it came from. The bench's weekly patterns can be posted this way; nothing reads the bench's own store | Must | additive | V2-5; Seth Q6 |

### 5.10 Proof (DX)

| ID | Requirement | Priority | Cost | Source |
|---|---|---|---|---|
| DX-9 | **The trace knows v0.2.0.** `pnpm trace` reads the v0.2.0 IDs (GL, MD, FL, UC, EI, SR, GD, RV, OB, PI, DX-9, DX-10) from PRD section 7.11 and reports them as it reports v1's; an unproven Must fails `pnpm test` | Must | additive | DX-5 |
| DX-10 | **The joining journey.** One scenario drives section 4 end to end in the sim: a check-only harness in shadow mode, a review request, a Reviewer verdict recorded and not posted, a shadow verdict, shadow lifted, a posted review, Ship waiting on a person, then a merge under a delegation on a second item, refused on a third for a protected path | Must | additive | Section 4 |

## 6. Data and contracts

**Tables and columns.** `harnesses`: `shadow`, `fix_claim`, `frozen`, `freeze_allow`, `external_reviewer_identities`, `bot_authors`. `delegations`: `max_tier`. `gate_decisions`: `delegation_id` (nullable, foreign key) and the check in MD-3. `gh_issues`: `parent_issue_id`. `gh_prs`: `patch_id`, `behind_by`. `gh_reviews`: `findings[].weight`, `findings[].refuted_by`, `refuted_at`. `measurements`: the refute-rate aggregate. Every table keeps one writer (rule 3); the new columns on `harnesses` are written by the stage command, the new columns on `gh_*` by the sweep, `gate_decisions` by the gate command and, under MD-3, by the kernel's delegated Ship exit, which MD-5 names.

**Closed sets.** Capability words gain `merge`, `fix`. Ship refusals gain `base_behind`, `auto_close_keyword`, `skip_ci_marker`, `required_check_never_ran`, `harness_frozen`, `protected_path_needs_person`, `tier_above_delegation`. Elsewhere: `template_has_no_package`, `no_harness_for_repo`, `template_change_not_allowed`, `repository_not_dispatchable`, `dispatch_list_unavailable`, `tier_not_delegable`, `checks_not_run_locally`, `done_when_missing`, `finding_weight_missing`, `engine_refused`. Finding weight: `real`, `plausible`, `theoretical`. Untrusted sources: `pr_diff`, `issue_body`, `review_comment`, `page_from_agent`.

**Events.** `review_verdict_recorded`, `shadow_verdict`, `shadow_lifted`, `freeze_changed`, `epic_enqueued`, `finding_refuted`, `silence_alarm`, `delegated_merge`. Wake reasons gain `silence_alarm` (rank 3) and `delegated_merge` (rank 2).

**Commands (person surface).** `set_shadow`, `set_freeze`, `enqueue_epic`, `decide_gates`, `refute_finding`, `change_template`. Each has `can()` on the harness's area as its scope and a scenario.

**Verbs (agent surface).** None added. V2-7.

**Contract version.** 13.0.0: the finding weight is a required field on a verdict, which is breaking; everything else is additive within it.

## 7. Shared roots touched

Each in its own commit whose message names the root and why (rule 4).

| Root | For |
|---|---|
| `CONTEXT.md` | Section 2 words |
| `docs/adr/0010-merge-under-delegation.md` | MD-1 |
| `prd/Harness v1 - Architecture.md` Decisions table | D8, D18 amended by MD-1 |
| `docs/PRD.md` | Section 7.11 (these requirements), 8.x closed sets and events, 13 (build order below), 18.3 |
| `packages/db/schema.ts` | Section 6 columns and the MD-3 check, in one migration per step |
| `packages/contracts/` | Capability words, refusal reasons, finding weight, the check-only template fixture, 13.0.0 |
| `tools/architecture/` rules | MD-5, UC-4 |
| `AGENTS.md` | One line in section 10: the delegated Ship exit is the one agent-reachable path that writes a gate decision, and it writes the grantor as approver |

## 8. Build order

Numbered after v1's eleven so the trace reads them as steps not yet built. Each step needs the ones above it and all of v1. Within a step, order is free. One plan per step under `docs/superpowers/plans/`, written against the code at that moment.

12. **Words and contracts.** Section 2 into `CONTEXT.md`; closed sets, finding weight and the check-only fixture into `packages/contracts` at 13.0.0; DX-9.
13. **Untrusted content.** UC-1 to UC-5. First because every later prompt site inherits it.
14. **Joining.** GL-2, GL-3, GL-4, GL-6, OB-3, PI-1. The pilot's path.
15. **Ship rule and gates.** SR-1, SR-2, SR-3, GD-1, GD-2, GD-3, RV-1, RV-2, RV-3.
16. **Merge delegation.** MD-1 to MD-6. After step 4 so the rule it extends is final.
17. **The fix claim.** FL-1 to FL-4.
18. **Epic intake.** EI-1 to EI-5.
19. **Observability and hooks.** OB-1, OB-2, OB-4, PI-2, GL-5.
20. **The joining journey and the switch.** DX-10; GL-1 last, because it is the only step that touches a live service and it is a person's to run.

## 9. Release

v0.2.0 is tagged when:

1. `pnpm verify` is green, including `walk`, `trace`, `sim -- all`.
2. Every Must in section 5 has a scenario or test named for its ID (DX-9).
3. DX-10 passes.
4. The template property test passes on all three templates and fails on the planted bypass; MD-4's deploy-and-publish property passes.
5. MD-5 and UC-4 pass on the tree and fail on their planted fixtures.
6. The CI `test` job is green on the merge commit, or the billing waiver of 2026-10-12 is extended by name in `docs/exceptions.md`.
7. Ian has reviewed the branch with Codex and merged it with a merge commit.

GL-1's live run, the week of shadow mode and the comparison with the bench happen on the tag.

## 10. Not in v0.2.0

Recorded so nothing is lost; each waits for the pilot's evidence.

- **Lessons with statuses.** Design for v0.3.0: `rejected` and `recurring` join `suggested` and `active`; an `active` learning may point at the test, lint or check that enforces it, and `/health` counts adopted learnings with no enforcing check; a cross-item view groups learnings by area (Jesse's three levels are the page's area). Agents propose, people confirm, as today.
- **The bench-style second writer.** A fixer pushing while the author holds the claim. Rejected in V2-2; revisit only if fix claims prove too slow.
- **The ruling ledger as a GitHub comment protocol.** GD-1 serves the same need at our volume.
- **Linear or Jira as an intake source.** A Connector adapter when a team asks.
- **Quiet hours, a phone-call rank, the planner persona, memory across items.** From the artifact's table; unchanged.
- **Zoom, invoice, intake-form and RFP connectors.** They inherit UC-1 when built.

## 11. What this spec does not establish

Nobody has yet run the bench and the platform on the same pull request; OB-3 exists to make that possible, not to predict it. The GL-1 live run may find defects in the platform adapters that no test adapter could; the tracker's hand-off table lists where. Whether Seth accepts V2-5 is his to decide; the two hooks stand either way. Birch's identity as the Benjamin of the comparison is inferred from context and unconfirmed.
