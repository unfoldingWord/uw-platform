# Step 16, Merge Delegation: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person holding `admin` on a harness's area can lend one agent persona the Ship exit for merges, up to `low` or `standard`, until an expiry. An agent holding that merge delegation claims an item at Ship and submits it; the kernel locks and re-reads the delegation and the grantor's grants, runs the ship rule with the delegation as an input, and either writes one gate decision whose approver is the grantor, whose actor is the agent and whose `delegation_id` names the delegation, or records `ship_refused` and leaves the item parked for a person. The merge then runs from the system's minute job, which runs the ship rule once more and re-checks the delegation before merging. The database refuses an agent actor without a delegation, a delegated row that is not a merge approval, and a delegation of another harness. The static checks allow exactly this one agent-reachable writer by name and fail on a planted second. The merge shows on the Gates screen, in the play-by-play, on `/health`, and as a `delegated_merge` wake at rank 2 to the grantor. A joined pull request (check-only harness, no `harness/<item>` branch) can now merge at Ship, by a person or under a delegation.

**Architecture:** The decision half lives in `packages/harness/gates/delegated-ship.ts` and runs inside the `submit_to_gate` transaction, after the item parks; its writer is one named function, `recordDelegatedDecision`. The merge half lives in `packages/harness/gates/delegated-exits.ts` (`gates.exitDelegated`, system principal only) and reuses step 15's `exitAfterDecision` and its exit guard, which learns to re-check a delegation. The agent's request never holds a GitHub write client (ADR 0009 stands for the agent path); the minute cron builds the one extra GitHub-wired kernel in `apps/uw-app/cron/delegated-exits.ts`. The ship rule stays pure: its input gains `delegation` (`delegationId`, `maxTier`, and the protected paths the change touches), and two predicates. `delegableExit(stage)` (human approval with the `merge` connector) is the one definition of where a delegation may act, shared by claim, poll, submit, the template property and the walk-based MD-4 property. The merge connector accepts a joined pull request's own head ref, still pinned to the evaluated head SHA, the harness repository and the default branch.

**Tech Stack:** TypeScript strict, Zod 4, Drizzle and drizzle-kit, Vitest 4 (node project and the Postgres service), Hono JSX for the Gates screen and the play-by-play, the sim over the embedded Postgres Store, dependency-cruiser rules in `tools/architecture/cruise/`.

**Spec:** `docs/PRD.md` section 7.11 (MD-1 to MD-6), sections 8.1, 8.3, 8.5, 8.6, 13 (step 16) and 18.3 (V2-1, V2-7); the design is `docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` sections 2, 3, 5.2, 6 and 7. ADRs 0002, 0003, 0005 and 0009; spec Decisions D8 and D18 (`prd/Harness v1 - Architecture.md`).

**Requirements covered:** MD-1, MD-2, MD-3, MD-4, MD-5, MD-6 (all Must). Also step 14's carry-forward item 1 (the merge connector and a joined pull request), which DX-10 needs.

**Builds on steps 14 and 15 (planned in `docs/superpowers/plans/2026-10-15-step-14-joining.md` and `docs/superpowers/plans/2026-10-15-step-15-ship-rule-and-gates.md`, both built before this plan runs).** Names used exactly as they hand them over: from step 14, `Harness.shadow`, `Harness.externalReviewerIdentities`, `usableHead`'s S14-R6 relaxation (`const joined = item.branchState === 'none'`), `dispatchRefusal` in claims, `createSimHarness` options (`dispatchable` defaults `true`), S14-R9 (a shadow harness refuses approve at a connector stage), migration `0029_joining`; from step 15, `shipRefusalSchema` ending `harness_frozen`, `ShipRuleInput` with `carries`, `requiredChecks`, `closes`, `wraps`, `frozen`, `countedApprovals`, `Shipped`, `ShipCheck.shipped`, `PendingExit` with `evaluatedHead`, `harness`, `approver`, `override`, `ExitInput.evaluatedHead`, `ExitGuard`, `exitThroughConnector(ports, context, input, guard)`, `exitAfterDecision` (exported from `packages/harness/testing.ts`), the exit guard in `approve-at-ship.ts` (S15-R9: "MD-3 adds the delegation to the ship-rule input and to `PendingExit`; the guard in `approve-at-ship.ts` is where it reads it"), `recordDecision` as the only person writer (reused by `decide-batch.ts`), `Harness.frozen`, `Harness.freezeAllow`, `Harness.requiredChecks`, `greenFacts` carrying a green comparison, `comparedAt`, contract `13.0.0`, migration `0030_ship_rule_and_gates`, `PlaneTotals.reviewerRefutes` and the `reviewer_refutes` indicator. Where a file below differs from the text quoted here because steps 14 and 15 changed it, keep their lines and make only this plan's change.

**Rulings made while planning** (recorded here and in `docs/progress_tracker.md` by the last task):

| Ruling | Cost if wrong |
|---|---|
| S16-R1. A delegated Ship exit starts from a claim. Ship keeps `agentPickup: 'none'`; the one exception is a stage where `delegableExit(stage)` holds (`exitGate` `human_approval` and `connector` `merge`): an agent presenting a live `merge` delegation may claim there, and `poll_queue` offers such items to an actor whose reach includes `merge`. `merge` reaches no other stage, so it is not added to `capabilityReaches`' bracket map. `pageAgrees` does not apply to `merge`: the persona page names what the persona does at its own stages, and the merge delegation is a person lending it one exit | Any persona can be lent the exit, Reviewer included; the grant is an admin act naming the persona, and it is visible on `/health` |
| S16-R2. `delegation_required` (MD-4): an agent claim or submit at a delegable exit with no delegation records `delegation_required` and is refused with it; a submit there whose claim carries a delegation whose capability is not `merge` is refused the same way. An agent claim there with a non-merge delegation stays `pickup_not_allowed`. Stages that are not delegable exits keep v0.1.0's `pickup_not_allowed` (KN-5 unchanged) | An agent that wandered into Ship sees `delegation_required` rather than `pickup_not_allowed`; both say "a person decides here" |
| S16-R3. The decision is written in the agent's `submit_to_gate` transaction, after the item parks, on the read-model facts (`githubFacts.pullRequest`), because the agent's kernel holds no GitHub client. The submit answers `parked` either way: `failures` is empty when the decision was written and lists the ship rule's reasons when it refused. A refusal records `ship_refused` and leaves the item parked for a person; no decision row is written. A shadow harness, or an item with a loop `gateTarget`, never takes the delegated exit: it parks for a person (consistent with S14-R9) and `failures` says `shadow` or `gate_target`; a delegation that lapsed between the claim check and the lock says `delegation_lapsed` | An agent must read empty `failures` at Ship as "approved, merging"; a submit result value for it would be a contract change later |
| S16-R4. The merge runs from the system's minute job, not on the agent's request: `kernel.gates.exitDelegated` (system principal only) takes delegated decisions from the last 15 minutes (`CONNECTOR_TIMEOUT_MS`) that have no connector outcome, refreshes the facts for the base, and runs step 15's `exitAfterDecision`, whose guard refreshes again, re-checks the delegation's liveness and the grantor's grants, and re-runs the ship rule with the delegation before the connector. Past 15 minutes a person's `recover_connectors` handles it as today. The cron builds the one GitHub-wired kernel for this in `apps/uw-app/cron/delegated-exits.ts`; ADR 0010 records it | A merge lands up to a minute after the agent submits; one more file holds GitHub merge wiring, reachable only from the scheduled handler and refused to every principal but the system's |
| S16-R5. `gate_decisions.actor` keeps its meaning and its check `gate_decisions_actor_is_human`, which is "the approver is a human principal", unchanged. Two nullable columns are added: `agent_actor` (an `agent:` identity) and `delegation_id`. New checks: `gate_decisions_agent_with_delegation` (`(agent_actor IS NULL) = (delegation_id IS NULL)`, MD-3's "requires `delegation_id` whenever the actor is an agent identity"), `gate_decisions_agent_actor_is_agent`, and `gate_decisions_delegated_approves_merge` (a delegated row is an `approve` whose evidence names the `merge` connector, MD-4's database half). A composite foreign key `(delegation_id, harness_id)` to `delegations (id, harness_id)` pins the delegation to the decision's harness. That the approver equals the delegation's grantor is enforced by the kernel and pinned by a test, not by the database | A future writer could record a grantor other than the delegation's person; the MD-5 check allows one writer, and its test pins the equality |
| S16-R6. The approver principal is the grantor: `personId` from the locked delegation, grants from `grants.lockAndReread` inside the transaction, and the email from `grants.holders(area)` read before the transaction (it refuses to run inside one). A grantor missing from the holders has lost `admin`, which `livenessOf` also finds; either way the exit records the lapse reason in `failures` and the item parks for a person | One extra read of the area's holders per delegated submit |
| S16-R7. "Protected directory" is the union of the kernel's `protectedDirectories` (`packages/harness/risk/protected-directories.ts`, this repository's paths, each also flooring the tier to `high` with a domain) and a new harness column `protected_paths` for any other repository: a list of at most 50 repository-relative paths, set at activation (`activate_template.protectedPaths`, default `[]`), a trailing `/` meaning a directory, matched with the same normalisation as the risk floor. The column affects only a delegated exit, never the risk tier. Changed paths the facts cannot name (no comparison at the head) fail closed as `protected_path_needs_person` | A joined repository's list changes only by re-activation, like S14-R2 and S15-R1 |
| S16-R8. `max_tier`: a `merge` grant must name `low` or `standard`; `high` is refused `tier_not_delegable`, no tier is refused `malformed_command` (`why: max_tier_required`), and a tier on any other capability is refused `malformed_command` (`why: max_tier_only_for_merge`). The database holds both rules (`delegations_max_tier_known`, `delegations_merge_has_max_tier`). Supersession keeps working: a superseding grant names its own tier | None beyond one more field on the grant form |
| S16-R9. `delegated_merge` is recorded with `connector_succeeded` in the exit (not at the decision), carrying the decision, the delegation, the grantor's id and email, the persona, the expiry and the tier, so the play-by-play and the wake say "merged" only after GitHub merged. The decision row's evidence carries the same object under `delegation`, so recovery can record it too. The wake goes to the grantor if they can still read the harness, at rank 2, by push and the hub only (not posted to Zulip). A parked `submitted_to_gate` followed in the same commit by a `gate_approved` for the same item wakes no `gate_waiting` | A Zulip reader learns of delegated merges from the screens, not the channel; adding it is one map entry |
| S16-R10. A joined pull request merges at its own head ref. `ConnectorRequest` gains `joined` (`item.branchState === 'none' && item.pullRequest !== null`, the S14-R6 combination, now one exported function `joinedPullRequest`); the merge connector skips only the `harness/<item>` head-ref check for it. Everything else still holds: head repository is the harness repository (no forks), live head equals the evaluated head (`sha` guard on the merge), base is the default branch and equals the decided base. The tag is still `harness/<item>` | The platform writes a `harness/<uuid>` tag into a joined repository on every merge; dropping it is one line |
| S16-R11. MD-5 has two halves. Kernel: a new check finds every write of `gate_decisions` in `apps/`, `packages/` (not `packages/db/` or the port-contract suites) and `sim/`, names its enclosing top-level function, and allows exactly `packages/harness/gates/decide.ts#recordDecision` and `packages/harness/gates/delegated-ship.ts#recordDelegatedDecision`; the import closure of `packages/harness/items/`, `runs/` and `reads/` (what the agent verbs call) must contain the second and never `gates/decide.ts`. App: AB-7's static check allows exactly `kernel.gates.exitDelegated(` in exactly `apps/uw-app/cron/delegated-exits.ts`; the GH-6 wiring checks and the dependency-cruiser roots name that file too | A token-level check can be evaded by an unusual syntax, as AB-7's can; the runtime refusals and the database checks are the enforcement |
| S16-R12. AGENTS.md gains the one section 10 line the design names, and rules 2 and 3 each gain a clause pointing at it, because without them the file contradicts itself (rule 3 says `gate_decisions` is written only by the gate command for a human principal) | Three lines change instead of one |
| S16-R13. The contract moves one minor version for the step (expected `13.0.0` to `13.1.0`): new enum values, a new enum, and fields with defaults | None; the lock test enforces the rule |
| S16-R14. MD-6's Gates view is a "Merged under a delegation" list on the Gates screen: the last 7 days' `delegated_merge` events on harnesses the person administers, newest first, each "Merged under a delegation granted by *email* until *expiry*" with a link to the item. `/health`'s live delegations indicator says how many live delegations are merge delegations, and its drill-through rows gain a `max tier` column | A person who wants the record older than a week reads the play-by-play |

**What this step hands to later steps (keep these names exactly):**

| Interface | Where | Consumed by |
|---|---|---|
| `delegableTierSchema`, `DelegableTier` (`low`, `standard`); registry key `delegable-tier` | `packages/contracts/closed-sets.ts` | FL-1 (a fix delegation has no tier) |
| `ShipRuleInput.delegation` (`delegatedShipSchema`: `delegationId`, `maxTier`, `protectedTouched`) | `packages/contracts/ship-rule.ts` | DX-10 |
| `delegatedMergeSchema`, `DelegatedMerge`; event `delegated_merge`; wake reason `delegated_merge` (rank 2) | `packages/contracts/event-evidence.ts`, `closed-sets.ts`, `packages/harness/notify/rank.ts` | OB-1 (`silence_alarm` follows the same steps), OB-2 |
| `protectedPathsSchema`, `Harness.protectedPaths`, `activate_template.protectedPaths` | `packages/contracts/harness.ts`, `commands.ts` | GL-5 (a template change keeps the column), DX-10 |
| `schedule_regular_tweak.maxTier`, `delegation_granted.maxTier`, `Delegation.maxTier` | contracts, `packages/harness/store-ports.ts` | FL-1 (`fix` names no tier) |
| `delegableExit(stage)` | `packages/harness/gates/delegable.ts` | FL-2 (a fix claim never reaches Ship) |
| `delegationProperty(stages, delegable?)` | `packages/harness/template-property.ts` | release criterion 4 (step 20) |
| `protectedAmong(paths, harnessPaths)` | `packages/harness/risk/protected-paths.ts` | FL-3 |
| `gates.exitDelegated(caller, { limit })` | `packages/harness/gates/delegated-exits.ts` via `GateCommands` | DX-10 (the sim calls it as the system) |
| `joinedPullRequest(item)`; `ConnectorRequest.joined` | `packages/harness/gates/ship-input.ts`, `packages/harness/ports.ts` | DX-10, GL-5 |
| `ExitInput.delegated`, `PendingExit.delegated` | `packages/harness/gates/exit.ts`, `approve-at-ship.ts` | none |
| Store: `delegations.read.lock`, `gateDecisions.read.delegatedSince`, `GateDecisionRow.agentActor`, `GateDecisionRow.delegationId` | `packages/harness/store-ports.ts`, `packages/db/store/` | OB-2 (who holds the ball under a delegation) |
| `views.delegatedMerges(caller, options)` returning `DelegatedMergeRow[]` | `packages/harness/views/delegated-merges.ts` | DX-10, OB-2 |
| `simAtShip(world, input)`, `simLendMerge(world, admin, input)` | `sim/ship-fixtures.ts` | DX-10 ("a merge under a delegation on a second item, refused on a third for a protected path") |
| `tools/architecture/gate-writers.ts`: `gateWriteSites`, `agentKernelClosure`, `gateWriteViolations` | `tools/architecture/` | release criterion 5 (step 20) |

**Left for later steps, found while planning (recorded in the tracker by Task 11):**

1. While a delegated decision waits for the minute job, the Gates view still lists the item as decidable; a person's approve answers `decision_in_flight`. Hiding in-flight rows is a view change for OB-2.
2. `release criterion 4` and `5` in `tools/release/criteria.test.ts` still name v1's checks; step 20 adds `MD-4 ...` (`delegationProperty`) and `MD-5 ...` (`gate-writers.test.ts`) titles to them.
3. A delegated merge needs the GitHub App configured for the cron (`GITHUB_APP_*` secrets); with none, the step logs `github_not_configured` and the decision waits for a person's recovery. GL-1's live run covers it.

---

## Global Constraints

Every task obeys every line here. The controller passes this section to each implementer.

**Where and how**

- Work only in `/home/ianjl/projects/uw-platform-v0.2.0`, branch `build/v0.2.0`. Never commit to `main`, never force-push, never `--no-verify`.
- Read `AGENTS.md` sections 1, 4 and 10 before the first edit. When this plan and `AGENTS.md` disagree, `AGENTS.md` wins; record the conflict in `docs/progress_tracker.md` and build the version that keeps the rule.
- This step is the change AGENTS.md section 8 names ("a change that would let an agent identity pass a human gate"). The person decided it: V2-1 in the design, "approved by Ian on 2026-10-15", and PRD 18.3. The plan builds exactly that decision and nothing wider: a merge only, up to `standard`, never deploy, publish, a protected path or `high`, with the grantor as approver. Anything that would widen it (another connector, `high`, an agent verb) is a stop.
- Words come from `CONTEXT.md`: **merge delegation**, **delegation**, **gate decision**, **ship rule**, **check-only harness**, and this step's **delegated Ship exit** and **protected path** (Task 1). Never "auto-merge", "robot merge", "auto-approve" or "bypass".
- Commits: Conventional Commits, the agent as sole author, no attribution footer. Hooks always pass. Put the requirement IDs in each commit body.

**Code rules (all mechanically enforced by `pnpm verify`)**

- TypeScript `strict`, no `any`, no `@ts-ignore`, no `as unknown as`, no non-null assertion.
- No code comments of any kind.
- Files under 500 non-blank lines; functions under 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters. `packages/harness/items/submit.ts` (about 400 lines) gets at most 25 more and moves code out as Task 7 says; `tools/architecture/agent-boundary.test.ts` (452) gets no new line: the new planted cases live in `tools/architecture/gate-writers.test.ts`.
- Zod at every boundary. `packages/contracts` imports only `zod`. `packages/harness` imports nothing from Workers, Drizzle or the network.
- Every exported Zod schema registered in `packages/contracts/registry.ts` has `fixtures/<key>/valid/*.json` and `fixtures/<key>/invalid/*.json`. Any change to a registered `z.enum` appends a full entry to `packages/contracts/contract-lock.json` and changes `CONTRACT_VERSION`.
- Every route and command has `can()` on the harness's area through the command registry's `action`; `schedule_regular_tweak` stays `admin`.
- `gate_decisions` is written by exactly two functions after this step: `recordDecision` in `packages/harness/gates/decide.ts` and `recordDelegatedDecision` in `packages/harness/gates/delegated-ship.ts`. Nothing else writes it, and Task 9's check fails if anything does.
- `shipRule(` stays called only in `packages/harness/gates/approve-at-ship.ts` and `packages/harness/ship-rule.ts`; `assembleShipInput(` only there and in `ship-input.ts`; `exitThroughConnector(` only in `approve-at-ship.ts` and `exit.ts`; `recordExitOutcomes(` only in `exit.ts` and `recover.ts` (`tools/architecture/connector-callers.test.ts`). The new kernel files never write the word `connectors` (use the `ExitPorts` type), so the connectors-reference list is unchanged.
- UI: tokens only, sentence case, second person, no exclamation marks; Kindle orange marks a human action and nothing else, so the delegated-merge list uses none; every control has an accessible name; light, dark and phone width hold.

**Contract version**

- At planning time `packages/contracts/version.ts` reads `12.3.0`; step 14 moves it to the next minor (expected `12.4.0`) and step 15 to the next major (expected `13.0.0`). This step moves it to the next minor after whatever is current (expected `13.1.0`), once, in Task 2, by the script in Task 2 Step 5, which reads the version and computes it.

**Migrations**

- One migration for the step, generated in Task 3 with `--name merge_delegation`, at the next index after step 15's (expected `0031`). Nothing is appended by hand.

**Shared roots**

- `docs/adr/`, `prd/Harness v1 - Architecture.md` and `docs/PRD.md` section 18 (Task 1, one commit, as MD-1 requires), `AGENTS.md` (Task 1), `CONTEXT.md` (Task 1), `packages/contracts/` (Task 2), `packages/db/schema.ts` with the migration (Task 3), `packages/harness/ports.ts`, `packages/harness/store-ports.ts` and its mirror `packages/db/store/types.ts` (Task 4), and `tools/architecture/` rules with `docs/exceptions.md` (Task 9) are shared roots. Each change to one is its own commit with no feature code, and the message names the root and why. `packages/db/store/`, `packages/db/test-seed.ts`, `apps/uw-app/generated/islands.ts` and the sim are not shared roots.
- Between Task 2's contracts commit and its follow-up commit `pnpm check` is red; between Task 2 and Task 3 `tools/db/drift.test.ts` is red (the event-name check derives from the enum); between Task 4's port commit and its binding commit `pnpm check` is red. Do each pair back to back.

**Tests**

- A test that proves a requirement has a `describe` or `it` title that starts with the requirement ID and a space, as `tools/trace/proofs.ts` reads it. A scenario's `id` is the requirement ID.
- Run one file with `npx vitest run <path>`. Database tests (`*.pg.test.ts`, `packages/db`, the Store contract on the platform adapter) need `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres` after `pg_ctl -D ~/.local/share/uw-platform-test-pg -o "-p 54329" start`. Never run two Vitest suites at once on this machine (WSL runs out of memory); `pnpm verify` runs them in sequence.

## Review Focus

Inputs the spec implies that no requirement row spells out, most likely to bite first. Each line names the task that pins it.

1. A delegation revoked between the agent's submit and the minute job must not merge. Task 8 pins a revocation after the decision: the exit records `connector_refused` with `delegation_lapsed` and calls no connector.
2. The approver on a delegated row must be the delegation's grantor, not the person who enqueued the item or whoever runs the minute job. Task 7 pins `actor` equal to a second admin who granted the delegation, not the admin who enqueued and advanced the item; Task 8 pins the merge recorded by `agent:system` with `delegated_merge` still naming the grantor.
3. A merge delegation must never move an item at a `publish` or `deploy` stage. Task 6 pins the walk property on every template and a permissive planted predicate failing it; Task 7 pins a merge-delegated agent refused `pickup_not_allowed` at a Ship stage whose connector was edited to `deploy`; Task 4 pins the database refusing a delegated row naming `deploy`.
4. The minute job runs every minute; a decision already exited must not reach the connector twice, and an agent's second submit must not write a second decision. Task 8 pins a second `exitDelegated` exiting nothing with one connector call in total; Task 7 pins the second submit answering `not_holder` with one decision row.
5. A joined pull request merges at its own ref and nowhere else. Task 8 pins the connector refusing a joined request from a fork and one whose live head moved, and a non-joined request at a foreign ref still `head_ref_mismatch`.
6. A delegation that ends at any point must stop the merge it lent. Task 7 pins one revoked after the claim refusing the submit `delegation_lapsed` with no row; Task 8 pins one revoked after the decision stopping the merge. A grantor who loses `admin` is the same lapse (`livenessOf`, `grant_lost`), checked at both points.

---

### Task 1: MD-1, ADR 0010 with the spec and PRD decisions; the AGENTS.md line; the words; the PRD data sections

**Files:**
- Create: `docs/adr/0010-merge-under-delegation.md`
- Modify: `prd/Harness v1 - Architecture.md` (Decisions table rows D8 and D18)
- Modify: `docs/PRD.md` (section 18.1 rows D8 and D18; section 18.3 row V2-1) in the same commit as the two above (MD-1)
- Modify: `AGENTS.md` (rule 2's sixth bullet, rule 3's last bullet, one new line in section 10)
- Modify: `CONTEXT.md` (two entries after step 15's **Strictness preset**)
- Modify: `docs/PRD.md` (sections 8.1, 8.5, 8.6) in its own commit

This task writes no feature code; one test file proves MD-1. Four commits: MD-1's (ADR, spec, PRD 18), `AGENTS.md`, `CONTEXT.md`, and the PRD data sections.

- [ ] **Step 1: Write ADR 0010**

`docs/adr/0010-merge-under-delegation.md`:

```markdown
---
status: accepted
date: 2026-10-15
---
# A person may lend an agent the Ship exit for a merge, under a delegation

A harness can opt into one unattended Ship exit. A person holding `admin` on the harness's area grants a persona a delegation whose capability word is `merge`, with a maximum risk tier of `low` or `standard`, an expiry, and revocation, exactly as ADR 0005's delegations work. An agent holding that delegation may claim an item at a stage whose exit is `human_approval` with the `merge` connector, and submit it. Inside the `submit_to_gate` transaction the kernel locks and re-reads the delegation and the grantor's grants, runs the ship rule with the delegation as an input, and either records one gate decision or records `ship_refused` and leaves the item parked for a person. The decision's approver is the granting person, its actor is the agent identity, and it names the delegation. The merge itself runs from the system's minute job, which refreshes the facts from GitHub, re-checks the delegation and the grantor's `admin`, and runs the ship rule again before the merge connector, as SR-3 does for a person's approval. This is V2-1 and V2-7 of the v0.2.0 design.

**What changes in earlier decisions.**

- ADR 0002. No verb is added: `approve`, `merge`, `deploy`, `publish` and `advance` stay forbidden, and the MCP surface is unchanged. What changes is what the kernel does with `submit_to_gate` at a merge Ship stage when the claim carries a live merge delegation. An agent's request still never holds a GitHub write client.
- ADR 0003. The Postgres check "the approver is a human principal" (`gate_decisions_actor_is_human`) is unchanged: the approver on a delegated row is the grantor. New checks: an agent actor requires a delegation (`gate_decisions_agent_with_delegation`), and a delegated row is a merge approval (`gate_decisions_delegated_approves_merge`); the delegation must belong to the decision's harness (a composite foreign key). The ship rule stays pure; its input gains the delegation's tier and the protected paths the change touches, and it refuses `tier_above_delegation` and `protected_path_needs_person`.
- ADR 0005. The closed set of capability words gains `merge`, which alone carries `max_tier`; `high` is refused `tier_not_delegable`.
- ADR 0009. The person surface is still the only place a person decides a gate. One more kernel wired with GitHub exists: the minute job's, in `apps/uw-app/cron/delegated-exits.ts`, which calls only `kernel.gates.exitDelegated` as the system principal, and the kernel refuses that call to everyone else. AB-7's static check allows exactly that call in exactly that file, and a new check allows exactly two functions to write `gate_decisions`: the gate command's `recordDecision` and the delegated Ship exit's `recordDelegatedDecision`.

**What a delegation never covers.** Deploy and publish connectors (the database refuses a delegated row naming any connector but `merge`, and a property over every template's paths fails if a delegated exit could reach one), a changed file under a protected path (the kernel's protected directories and the harness's `protected_paths`), a change whose tier is above the delegation's, `high` at all, a shadow harness, and a loop target.

**Rejected.**

- An agent `merge` verb. It would put the merge on the MCP surface, where ADR 0002 says a gate verb cannot exist, and every host would serve it.
- A per-repository auto-merge flag with no grantor. Nobody would be the approver of record, the expiry and revocation of ADR 0005 would not apply, and the Postgres rule would need an exception for a row with no person.
- Running the merge on the agent's own request. It would put a GitHub write client in a kernel an agent's request builds, which ADR 0009 and the GH-6 checks keep out.
- Letting a delegation cover `high`, deploy, publish or protected paths. The bench owner's fourth non-negotiable; those stay a person's at the keyboard.

**Consequences.** A harness that opts in merges a change nobody read, bounded by the tier, the protected paths, the expiry and the ship rule run twice, and the record names who lent the exit. Delegated merges are shown on the Gates screen, in the play-by-play and on `/health`, and wake the grantor. AGENTS.md section 10 names the one agent-reachable writer. Source: design `docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` V2-1, V2-7 and section 5.2; PRD MD-1 to MD-6; spec D8, D18.
```

- [ ] **Step 2: Amend the spec's Decisions table (D8, D18)**

In `prd/Harness v1 - Architecture.md`, in the Decisions table row `| D8 | Ship gate | ...`, append to the end of the fourth cell (the decision text, before ` | makes concrete |`):

```text
 Since v0.2.0 (ADR 0010) a person holding `admin` may lend an agent persona the Ship exit for a merge only, up to `standard`: the ship rule then takes the delegation as an input, the gate decision names the grantor as approver, the agent as actor and the delegation, and the Postgres rule that the approver is a human stays; deploy, publish, protected paths and `high` stay a person's
```

In the row `| D18 | Unattended loops | ...`, append to the end of its fourth cell (before ` | fills a gap (review item 3) |`):

```text
. Since v0.2.0 the capability word `merge` (ADR 0010) carries a maximum tier, `low` or `standard`, and lends the Ship exit for a merge
```

Read the two rows after editing: each must still have exactly five cells.

- [ ] **Step 3: Amend PRD section 18 in the same commit**

In `docs/PRD.md` section 18.1, the row `| D8 | The ship rule is a pure function ... |`: append ` Since v0.2.0 a merge delegation may take the Ship exit for a merge up to standard, with the grantor as approver (ADR 0010).` inside the second cell. The row `| D18 | A \`delegations\` table: ... |`: append ` The \`merge\` word carries a maximum tier (ADR 0010).` inside the second cell. In section 18.3, row V2-1: append ` Recorded in ADR 0010.` to the end of the decision cell.

- [ ] **Step 3a: The proof the trace reads**

`tools/release/merge-delegation-decision.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function rowOf(text: string, id: string): string | undefined {
  return text.split('\n').find((line) => line.startsWith(`| ${id} |`));
}

describe('MD-1 ADR 0010 records merge under delegation, and the spec and PRD cite it', () => {
  it('MD-1 the ADR names the decisions it changes and what was rejected', () => {
    const adr = readFileSync('docs/adr/0010-merge-under-delegation.md', 'utf8');
    for (const cited of ['ADR 0002', 'ADR 0003', 'ADR 0005', 'ADR 0009', 'An agent `merge` verb', 'with no grantor']) {
      expect(adr).toContain(cited);
    }
  });

  it('MD-1 the spec rows D8 and D18 and PRD rows D8, D18 and V2-1 cite ADR 0010', () => {
    const spec = readFileSync('prd/Harness v1 - Architecture.md', 'utf8');
    const prd = readFileSync('docs/PRD.md', 'utf8');
    for (const id of ['D8', 'D18']) {
      expect(rowOf(spec, id)).toContain('ADR 0010');
      expect(rowOf(prd, id)).toContain('ADR 0010');
    }
    expect(rowOf(prd, 'V2-1')).toContain('ADR 0010');
  });
});
```

Run: `npx vitest run tools/release/merge-delegation-decision.test.ts`
Expected: green after Steps 1 to 3 (run it once before Step 1 to see it fail on the missing ADR). If `tools/release/criteria.test.ts` reads files through a helper rooted elsewhere, use that helper instead of a relative path.

- [ ] **Step 4: Commit MD-1 (shared roots `docs/adr/`, the spec, `docs/PRD.md`)**

```bash
git add docs/adr/0010-merge-under-delegation.md "prd/Harness v1 - Architecture.md" docs/PRD.md tools/release/merge-delegation-decision.test.ts
git commit -m "docs(adr): ADR 0010, merge under delegation, with spec D8 and D18 and PRD 18

Shared roots docs/adr, the spec's Decisions table and PRD section 18,
in one commit as MD-1 requires. Records what changes from ADR 0002,
0003, 0005 and 0009, and what was rejected: an agent merge verb, a
per-repository flag with no grantor, the merge on the agent's request.

MD-1."
```

- [ ] **Step 5: The AGENTS.md lines (shared root `AGENTS.md`)**

In rule 2, change the bullet `- No route, tool handler or Workflow step reachable by an agent identity writes \`gate_decisions\` or \`harness_stages\`.` to:

```markdown
- No route, tool handler or Workflow step reachable by an agent identity writes `gate_decisions` or `harness_stages`, except the delegated Ship exit section 10 names.
```

In rule 3, change the last bullet to:

```markdown
- `gate_decisions` is written only by the gate command, only for a human principal, inside a transaction that locks and re-reads the approver's grants, and by the delegated Ship exit section 10 names.
```

In section 10, after the first bullet (`- No agent identity can approve, merge, ...`), add:

```markdown
- The delegated Ship exit (`recordDelegatedDecision` in `packages/harness/gates/delegated-ship.ts`, ADR 0010) is the one agent-reachable path that writes a gate decision. It writes the granting person as approver, the agent as actor and the delegation's id, for a merge only, up to the delegation's tier, never for a protected path, inside the transaction that locks and re-reads the delegation and the grantor's grants; the merge itself runs later from the minute job, which checks it all again. A second such path is wrong whatever else it does.
```

```bash
git add AGENTS.md
git commit -m "docs(agents): section 10 names the delegated Ship exit, the one agent-reachable gate writer

Shared root AGENTS.md. The design's one line in section 10, plus a
clause in rules 2 and 3 pointing at it, so the file does not contradict
itself (S16-R12). ADR 0010.

MD-1 MD-3 MD-5."
```

- [ ] **Step 6: The words (shared root `CONTEXT.md`)**

Append after step 15's **Strictness preset** entry:

```markdown
**Delegated Ship exit**:
A merge delegation used: an agent holding one submits an item at a merge Ship stage, and the kernel records a gate decision whose approver is the person who granted the delegation, whose actor is the agent, and which names the delegation. The merge runs afterwards from the minute job.
_Avoid_: auto-merge, auto-approve, robot merge

**Protected path**:
A changed file a delegation never covers: one under the kernel's protected directories (which also raise the risk tier to `high`) or under a path the harness lists in `protected_paths`. Ship refuses a delegated exit that touches one with `protected_path_needs_person`.
_Avoid_: sensitive file, locked path
```

```bash
git add CONTEXT.md
git commit -m "docs(context): delegated Ship exit and protected path

Shared root CONTEXT.md. The two words step 16's code and screens use.

MD-3 MD-4."
```

- [ ] **Step 7: The PRD data sections**

In `docs/PRD.md`:
- Section 8.1, row `harnesses`: append `, protected_paths` to the columns cell (after step 15's `required_checks`).
- Row `gate_decisions`: columns become `harness, item, stage, actor (the approver, always a person), agent actor and delegation (both or neither; a delegated row is a merge approval), decision, reason, evidence (with the evaluated head and the counted approvals at Ship, and the delegation on a delegated row), trace id`; writer becomes `the gate command, human principals only, and the delegated Ship exit (ADR 0010)`.
- Row `delegations`: after `capability,` insert `max tier (merge only),`.
- Section 8.5, after the "Added in v0.2.0" paragraph, add: "`protected_path_needs_person` and `tier_above_delegation` are refused only on a delegated Ship exit; the item stays parked for a person. `tier_not_delegable` refuses a merge grant naming `high`. `delegation_required` is also recorded when an agent claims or submits at a merge Ship stage without a merge delegation (S16-R2)."
- Section 8.6, after the "Added in v0.2.0" paragraph, add: "`delegated_merge` is recorded with `connector_succeeded` when a delegated exit merged, and carries the decision, the delegation, the grantor's id and email, the persona, the expiry and the tier (S16-R9). `delegation_granted` gains `maxTier` (null before contract 13.1.0)."

```bash
git add docs/PRD.md
git commit -m "docs(prd): step 16's columns, refusals and event in sections 8.1, 8.5 and 8.6

The delegated Ship exit's columns on gate_decisions and delegations,
protected_paths on harnesses, where the three refusals apply, and what
delegated_merge carries.

MD-2 MD-3 MD-4 MD-6."
```

---

### Task 2: The contracts for merge delegation (shared root `packages/contracts`), then the follow-up that keeps the tree green

**Files:**
- Modify: `packages/contracts/closed-sets.ts` (`delegableTierSchema`, `DelegableTier`; `delegated_merge` at the end of `wakeReasonSchema`)
- Modify: `packages/contracts/ship-rule.ts` (two values at the end of `shipRefusalSchema`; `delegatedShipSchema`; `shipRuleInputSchema.delegation`)
- Modify: `packages/contracts/outcomes.ts` (three values at the end of `errorReasonSchema`)
- Modify: `packages/contracts/harness.ts` (`protectedPathSchema`, `protectedPathsSchema`, `harnessSchema.protectedPaths`)
- Modify: `packages/contracts/commands.ts` (`schedule_regular_tweak.maxTier`, `activate_template.protectedPaths`)
- Modify: `packages/contracts/events.ts` (`delegated_merge` at the end of `eventNames`)
- Modify: `packages/contracts/event-evidence.ts` (`delegatedMergeSchema`, `DelegatedMerge`; `delegated_merge` in `itemEvidence`; `delegation_granted.maxTier`)
- Modify: `packages/contracts/registry.ts` (`delegable-tier`)
- Create: fixtures (Step 4)
- Modify: `packages/contracts/contracts.test.ts` (new block), `packages/contracts/events.test.ts` (the vocabulary count)
- Modify: `packages/contracts/contract-lock.json`, `packages/contracts/version.ts`
- Second commit, not a shared root: `packages/harness/ship-rule.ts` (two predicates), `packages/harness/ship-rule.test.ts`, `packages/harness/notify/rank.ts`, `packages/harness/notify/plan.ts` (`screens`), `packages/harness/items/fold.ts` (`unchangedNames`), `packages/harness/gates/ship-input.ts` (`delegation: null`), every `Harness` literal `pnpm check` names, `apps/uw-app/generated/islands.ts` (regenerated)

**Interfaces:**
- Produces: `delegableTierSchema = z.enum(['low', 'standard'])`; `delegatedShipSchema = { delegationId: uuid, maxTier: DelegableTier, protectedTouched: string[] | null }`; `ShipRuleInput.delegation: DelegatedShip | null` (default `null`); `ShipRefusal` gains `protected_path_needs_person`, `tier_above_delegation`; `ErrorReason` gains those two and `tier_not_delegable`; `WakeReason` gains `delegated_merge`; `EventName` gains `delegated_merge`; `DelegatedMerge = { decisionId, delegationId, personId, email, persona, expiresAt, maxTier }`; `Harness.protectedPaths: string[]` (default `[]`); `CommandBody<'schedule_regular_tweak'>.maxTier: RiskTier | null` (default `null`, so `high` reaches the kernel to be refused `tier_not_delegable`); `CommandBody<'activate_template'>.protectedPaths: string[]` (default `[]`); `EventEvidence['delegation_granted'].maxTier: DelegableTier | null` (default `null`).

- [ ] **Step 1: Write the failing tests**

Append to `packages/contracts/contracts.test.ts` (import from the package's own files the way its neighbours do: `delegableTierSchema`, `wakeReasonSchema` from `./closed-sets.ts`; `commandSchema` from `./commands.ts`; `errorReasonSchema` from `./outcomes.ts`; `eventEvidenceSchemas` from `./event-evidence.ts`; `harnessSchema` from `./harness.ts`; `shipRefusalSchema`, `shipRuleInputSchema` from `./ship-rule.ts`):

```ts
describe('MD-2 MD-4 MD-6 the merge delegation contracts', () => {
  const requestId = '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11';
  const delegationId = '00000000-0000-4000-8000-0000000000d1';

  it('MD-2 a merge grant names a tier, and high still parses so the kernel can refuse it', () => {
    const grant = {
      command: 'schedule_regular_tweak',
      requestId,
      persona: 'agent:shipper',
      capability: 'merge',
      expiresAt: null,
      supersedes: null,
    };
    expect(commandSchema.parse(grant)).toMatchObject({ maxTier: null });
    expect(commandSchema.parse({ ...grant, maxTier: 'standard' })).toMatchObject({ maxTier: 'standard' });
    expect(commandSchema.safeParse({ ...grant, maxTier: 'high' }).success).toBe(true);
    expect(commandSchema.safeParse({ ...grant, maxTier: 'urgent' }).success).toBe(false);
    expect(delegableTierSchema.options).toEqual(['low', 'standard']);
    expect(errorReasonSchema.options).toContain('tier_not_delegable');
  });

  it('MD-2 the grant event names the tier, and an older grant reads as none', () => {
    const granted = {
      delegationId,
      personId: '00000000-0000-4000-8000-000000000001',
      persona: 'agent:shipper',
      capability: 'merge',
      expiresAt: '2026-10-20T00:00:00.000Z',
      supersedes: null,
    };
    expect(eventEvidenceSchemas.delegation_granted.parse(granted)).toMatchObject({ maxTier: null });
    expect(eventEvidenceSchemas.delegation_granted.safeParse({ ...granted, maxTier: 'high' }).success).toBe(false);
  });

  it('MD-4 the ship rule gains two refusals and the delegation as an input', () => {
    expect(shipRefusalSchema.options.slice(-2)).toEqual(['protected_path_needs_person', 'tier_above_delegation']);
    for (const reason of shipRefusalSchema.options) expect(errorReasonSchema.options).toContain(reason);
    const input = shipRuleInputSchema.parse({
      pullRequest: null,
      expectedHead: null,
      carries: [],
      checks: [],
      requiredChecks: [],
      approvals: [],
      closes: [],
      wraps: null,
      riskTier: null,
      riskDomains: [],
      area: '80-89',
      approver: {
        identity: 'human:00000000-0000-4000-8000-000000000001',
        kind: 'person',
        personId: '00000000-0000-4000-8000-000000000001',
        email: 'ian.lindsley@unfoldingword.org',
        grants: [],
        interactive: true,
      },
      at: '2026-10-15T09:00:00.000Z',
      frozen: false,
      override: false,
    });
    expect(input.delegation).toBeNull();
    const lent = { delegationId, maxTier: 'standard', protectedTouched: [] };
    expect(shipRuleInputSchema.parse({ ...input, delegation: lent }).delegation).toEqual(lent);
    expect(shipRuleInputSchema.safeParse({ ...input, delegation: { ...lent, maxTier: 'high' } }).success).toBe(false);
  });

  it('MD-4 a harness lists protected paths, relative and without dot-dot, and an older row lists none', () => {
    const older = {
      id: delegationId,
      key: 'tc-admin-app',
      template: 'check-only',
      jdArea: '80-89',
      repository: 'unfoldingWord/tc-admin-app',
      hostedBuilderEnabled: false,
      paused: false,
    };
    expect(harnessSchema.parse(older)).toMatchObject({ protectedPaths: [] });
    expect(harnessSchema.safeParse({ ...older, protectedPaths: ['src/billing/', 'deploy.sh'] }).success).toBe(true);
    for (const bad of ['/etc/', '../outside', 'src/../x', ' spaced', '']) {
      expect(harnessSchema.safeParse({ ...older, protectedPaths: [bad] }).success).toBe(false);
    }
    expect(harnessSchema.safeParse({ ...older, protectedPaths: ['a/', 'a/'] }).success).toBe(false);
  });

  it('MD-6 the grantor is woken by delegated_merge, which names the grantor and the expiry', () => {
    expect(wakeReasonSchema.options.at(-1)).toBe('delegated_merge');
    const merged = {
      decisionId: delegationId,
      delegationId,
      personId: '00000000-0000-4000-8000-000000000001',
      email: 'ian.lindsley@unfoldingword.org',
      persona: 'agent:shipper',
      expiresAt: '2026-10-20T00:00:00.000Z',
      maxTier: 'standard',
    };
    expect(eventEvidenceSchemas.delegated_merge.parse(merged)).toEqual(merged);
    expect(eventEvidenceSchemas.delegated_merge.safeParse({ ...merged, maxTier: 'high' }).success).toBe(false);
  });
});
```

If step 15's `shipRuleInputSchema` has a field this literal does not name, `parse` reports it: add it with its neutral value (as `green()` in `packages/harness/ship-rule.test.ts` does) and keep the assertions. If `personaIdentitySchema` refuses `agent:shipper`, copy a persona identity from `fixtures/persona-identity/valid/`.

In `packages/contracts/events.test.ts`, the vocabulary test's count goes up by one from the number step 15 left (expected 59 to 60); change its title's number word to match.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/contracts/contracts.test.ts packages/contracts/events.test.ts`
Expected: FAIL; `delegableTierSchema` is undefined and the vocabulary count differs.

- [ ] **Step 3: Write the contracts**

`packages/contracts/closed-sets.ts`, beside `riskTierSchema`:

```ts
export const delegableTierSchema = z.enum(['low', 'standard']);
```

and `export type DelegableTier = z.infer<typeof delegableTierSchema>;` beside `RiskTier`. Append `'delegated_merge'` as the last value of `wakeReasonSchema`.

`packages/contracts/ship-rule.ts`: import `delegableTierSchema` with `riskTierSchema` from `./closed-sets.ts`. Append after `'harness_frozen',` in `shipRefusalSchema`:

```ts
  'protected_path_needs_person',
  'tier_above_delegation',
```

Above `shipRuleInputSchema`:

```ts
export const delegatedShipSchema = z.strictObject({
  delegationId: z.uuid(),
  maxTier: delegableTierSchema,
  protectedTouched: z.array(z.string().min(1).max(500)).max(100).nullable(),
});
```

and in `shipRuleInputSchema`, after `frozen: z.boolean(),`:

```ts
  delegation: delegatedShipSchema.nullable().default(null),
```

with `export type DelegatedShip = z.infer<typeof delegatedShipSchema>;` beside the other types.

`packages/contracts/outcomes.ts`: append to `errorReasonSchema`, after the last value step 15 added:

```ts
  'protected_path_needs_person',
  'tier_above_delegation',
  'tier_not_delegable',
```

`packages/contracts/harness.ts`, above `harnessSchema`:

```ts
const protectedPathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\s\\]{1,200}$/;
export const protectedPathSchema = z
  .string()
  .regex(protectedPathPattern, 'a protected path is repository-relative, with no dot-dot segment');
export const protectedPathsSchema = z
  .array(protectedPathSchema)
  .max(50)
  .refine(distinct, 'each protected path once');
```

and in `harnessSchema`, after step 15's last field:

```ts
  protectedPaths: protectedPathsSchema.default([]),
```

`packages/contracts/commands.ts`: import `protectedPathsSchema` from `./harness.ts` and `riskTierSchema` from `./closed-sets.ts` if absent. `schedule_regular_tweak` gains `maxTier: riskTierSchema.nullable().default(null),` after `supersedes`; `activate_template` gains `protectedPaths: protectedPathsSchema.default([]),` after step 15's `requiredChecks`.

`packages/contracts/events.ts`: append `'delegated_merge',` as the last value of `eventNames`.

`packages/contracts/event-evidence.ts`: import `delegableTierSchema` from `./closed-sets.ts` and `personaIdentitySchema` if absent. Above `itemEvidence`:

```ts
export const delegatedMergeSchema = z.strictObject({
  decisionId: id,
  delegationId: id,
  personId: id,
  email: z.email(),
  persona: personaIdentitySchema,
  expiresAt: instant,
  maxTier: delegableTierSchema,
});
export type DelegatedMerge = z.infer<typeof delegatedMergeSchema>;
```

In `itemEvidence`, add `delegated_merge: delegatedMergeSchema,`. In `harnessEvidence`, `delegation_granted` gains `maxTier: delegableTierSchema.nullable().default(null),` after `supersedes`.

`packages/contracts/registry.ts`, beside `'risk-tier'`: `'delegable-tier': closedSets.delegableTierSchema,`. `packages/contracts/index.ts` already re-exports each file with `export *`; if it lists names instead, add `delegableTierSchema`, `DelegableTier`, `delegatedShipSchema`, `DelegatedShip`, `delegatedMergeSchema`, `DelegatedMerge`, `protectedPathSchema`, `protectedPathsSchema`.

- [ ] **Step 4: Add the fixtures**

```bash
mkdir -p packages/contracts/fixtures/delegable-tier/valid packages/contracts/fixtures/delegable-tier/invalid
printf '"low"\n' > packages/contracts/fixtures/delegable-tier/valid/low.json
printf '"standard"\n' > packages/contracts/fixtures/delegable-tier/valid/standard.json
printf '"high"\n' > packages/contracts/fixtures/delegable-tier/invalid/high.json
printf '"delegated_merge"\n' > packages/contracts/fixtures/wake-reason/valid/delegated-merge.json
printf '"tier_not_delegable"\n' > packages/contracts/fixtures/error-reason/valid/tier-not-delegable.json
printf '"protected_path_needs_person"\n' > packages/contracts/fixtures/ship-refusal/valid/protected-path.json
```

Copy `packages/contracts/fixtures/ship-rule-input/valid/high-two-reviewers.json` to `.../valid/delegated-standard.json` and add `"delegation": { "delegationId": "00000000-0000-4000-8000-0000000000d1", "maxTier": "standard", "protectedTouched": [] }`; copy it again to `.../invalid/delegated-high.json` with `"maxTier": "high"`. If the fixture folders for `wake-reason`, `error-reason` or `ship-refusal` name their files differently, keep this step's file names; the golden-fixture test reads every file in the folder.

- [ ] **Step 5: Append the lock entry and bump the minor version**

```bash
node -e '
const fs = require("node:fs");
const p = "packages/contracts/contract-lock.json";
const versionFile = "packages/contracts/version.ts";
const current = /CONTRACT_VERSION = .(\d+)\.(\d+)\.(\d+)./.exec(fs.readFileSync(versionFile, "utf8"));
const next = `${current[1]}.${Number(current[2]) + 1}.0`;
const lock = JSON.parse(fs.readFileSync(p, "utf8"));
const last = lock.versions.at(-1).sets;
const add = (key, values) => [...last[key], ...values.filter((value) => !last[key].includes(value))];
const refusals = ["protected_path_needs_person", "tier_above_delegation"];
const sets = { ...last,
  "ship-refusal": add("ship-refusal", refusals),
  "error-reason": add("error-reason", [...refusals, "tier_not_delegable"]),
  "event-name": add("event-name", ["delegated_merge"]),
  "wake-reason": add("wake-reason", ["delegated_merge"]),
  "delegable-tier": ["low", "standard"] };
const sorted = Object.fromEntries(Object.entries(sets).sort(([a], [b]) => a.localeCompare(b)));
lock.versions.push({ version: next, sets: sorted });
fs.writeFileSync(p, JSON.stringify(lock, null, 2) + "\n");
fs.writeFileSync(versionFile, fs.readFileSync(versionFile, "utf8").replace(/CONTRACT_VERSION = .\d+\.\d+\.\d+./, `CONTRACT_VERSION = \x27${next}\x27`));
console.log(next);
'
npx prettier --write packages/contracts/contract-lock.json packages/contracts/version.ts
```

Expected: prints `13.1.0` (the next minor after what step 15 left). A minor, because every change adds a value or a field with a default (S16-R13). If the lock test names an enum the script missed, add it the same way and re-run from a clean lock (`git checkout packages/contracts/contract-lock.json packages/contracts/version.ts` first).

- [ ] **Step 6: Run the contracts tests**

Run: `npx vitest run packages/contracts`
Expected: all green, including `golden fixtures`, `CT-3 the contract lock`, `contract version` and the new block.

- [ ] **Step 7: Find every pin of the old version and commit (shared root)**

```bash
grep -rn "13\.0\.0" --include='*.ts' --include='*.sql' packages apps sim tools | grep -v node_modules | grep -v contract-lock.json
```

Use the version you replaced. A `.ts` file that calls `assertLiveContractVersion` with it changes to the new version in this commit; a file that only lists names stays.

```bash
git add packages/contracts
git commit -m "feat(contracts): merge delegation, its tier, its refusals and its wake (13.1.0)

Shared root packages/contracts. delegable-tier; the ship rule's
delegation input and its two refusals; tier_not_delegable; the
delegated_merge event and wake reason; protected paths on a harness and
at activation; maxTier on the grant command and event. Additive, so a
minor version (S16-R13).

MD-2 MD-3 MD-4 MD-6."
```

- [ ] **Step 8: The follow-up: the two predicates, the wake rank, and every literal the compiler names**

`pnpm check` is red now. Make it green with exactly these changes.

`packages/harness/ship-rule.ts`: import `riskTierSchema` with the other names from `@uw/contracts`. Add:

```ts
function protectedPathNeedsPerson(input: ShipRuleInput): boolean {
  const lent = input.delegation;
  if (lent === null) return false;
  return lent.protectedTouched === null || lent.protectedTouched.length > 0;
}

function tierAboveDelegation(input: ShipRuleInput): boolean {
  const lent = input.delegation;
  if (lent === null || input.riskTier === null) return false;
  const rank = (tier: string) => riskTierSchema.options.findIndex((known) => known === tier);
  return rank(input.riskTier) > rank(lent.maxTier);
}
```

and append to `failing`:

```ts
  ['protected_path_needs_person', protectedPathNeedsPerson],
  ['tier_above_delegation', tierAboveDelegation],
```

`packages/harness/ship-rule.test.ts`, append:

```ts
describe('MD-4 a delegation never covers a protected path or a tier above its own', () => {
  const lent = (maxTier: 'low' | 'standard', protectedTouched: string[] | null = []) => ({
    delegationId: '00000000-0000-4000-8000-0000000000d1',
    maxTier,
    protectedTouched,
  });
  const standard = (): ShipRuleInput => ({ ...green(), riskTier: 'standard', riskDomains: [] });

  it('MD-4 advances a standard change under a standard delegation that touches no protected path', () => {
    expect(shipRule({ ...standard(), delegation: lent('standard') })).toEqual({ verdict: 'advance' });
  });

  it('MD-4 refuses tier_above_delegation for a standard change under a low delegation', () => {
    expect(refusedWith({ ...standard(), delegation: lent('low') })).toEqual(['tier_above_delegation']);
  });

  it('MD-4 refuses protected_path_needs_person when the change touches one', () => {
    const touched = { ...standard(), delegation: lent('standard', ['src/billing/rates.ts']) };
    expect(refusedWith(touched)).toEqual(['protected_path_needs_person']);
  });

  it('MD-4 fails closed when the changed paths are unknown', () => {
    expect(refusedWith({ ...standard(), delegation: lent('standard', null) })).toEqual([
      'protected_path_needs_person',
    ]);
  });

  it('MD-4 a high change under a standard delegation is above its tier', () => {
    const high = { ...standard(), riskTier: 'high' as const, delegation: lent('standard') };
    expect(refusedWith(high)).toContain('tier_above_delegation');
  });

  it('MD-4 a person approval carries no delegation and is refused for neither', () => {
    const reasons = refusedWith({ ...standard(), riskTier: 'high', delegation: null });
    expect(reasons).not.toContain('tier_above_delegation');
    expect(reasons).not.toContain('protected_path_needs_person');
  });
});
```

`packages/harness/notify/rank.ts`: `wakeRank` gains `delegated_merge: 2,`. `packages/harness/notify/plan.ts`: `screens` gains `['delegated_merge', 'item'],`. `packages/harness/items/fold.ts`: `unchangedNames` gains `'delegated_merge',` after `'connector_refused',`.

`packages/harness/gates/ship-input.ts`, `assembleShipInput`: the returned object gains `delegation: null,` (Task 6 replaces it).

Every `Harness` literal `pnpm check` names (expect `packages/harness/stages/activate.ts`, port-contract fixtures such as `harnessOf` in `packages/harness/port-contracts/store-gateway-fixtures.ts`, and test helpers): add `protectedPaths: []`. In `packages/harness/stages/activate.ts` the literal reads `protectedPaths: [...(input.protectedPaths ?? [])],` and `ActivateInput` gains `readonly protectedPaths?: readonly string[];`. `packages/db/store/rows.ts` `toHarness`: add `protectedPaths: row.protectedPaths` only after Task 3 adds the column; for now omit it and let `harnessSchema.parse` fill the default.

Regenerate the islands bundle: `pnpm ui:islands`.

- [ ] **Step 9: Run the checks**

Run: `pnpm check && npx vitest run packages/harness/ship-rule.test.ts packages/harness/notify packages/harness/items/fold.test.ts packages/contracts`
Expected: green. `tools/db/drift.test.ts` stays red until Task 3.

- [ ] **Step 10: Commit**

```bash
git add packages/harness apps/uw-app/generated/islands.ts
git commit -m "feat(harness): the ship rule refuses a protected path or a tier above a delegation

The two MD-4 predicates, which only a delegated exit's input can trip;
delegated_merge ranks 2 and opens the item; it changes no item state;
every harness literal names its protected paths. Islands regenerated for
13.1.0.

MD-4 MD-6."
```

---

### Task 3: The columns, the checks and the migration (shared root `packages/db/schema.ts`)

**Files:**
- Modify: `packages/db/schema.ts` (`harnesses.protected_paths`; `delegations.max_tier` with two checks and a unique index; `gate_decisions.agent_actor`, `gate_decisions.delegation_id` with a foreign key, three checks and an index)
- Create: `packages/db/migrations/00NN_merge_delegation.sql` with its snapshot and journal entry (generated)
- Create: `packages/db/merge-delegation-columns.test.ts`

**Interfaces:**
- Produces: `harnesses.protected_paths text[] NOT NULL DEFAULT '{}'` (at most 50); `delegations.max_tier text` (null, `low` or `standard`; set exactly when `capability = 'merge'`); unique index `delegations_id_harness` on `(id, harness_id)`; `gate_decisions.agent_actor text`, `gate_decisions.delegation_id uuid`, foreign key `gate_decisions_delegation_fk (delegation_id, harness_id) → delegations (id, harness_id)`; checks `gate_decisions_agent_with_delegation`, `gate_decisions_agent_actor_is_agent`, `gate_decisions_delegated_approves_merge`, `delegations_max_tier_known`, `delegations_merge_has_max_tier`, `harnesses_protected_paths_bounded`; index `gate_decisions_delegated` on `decided_at` where `delegation_id IS NOT NULL`. Drizzle fields `protectedPaths`, `maxTier`, `agentActor`, `delegationId`. The check `gate_decisions_actor_is_human` is untouched.

- [ ] **Step 1: Write the failing test**

`packages/db/merge-delegation-columns.test.ts`, on the frame of `packages/db/joining-columns.test.ts` (`openDatabase`, `refusal`, `databaseTargets`):

```ts
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { seedPerson } from './test-seed.ts';
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

const personId = '00000000-0000-4000-8000-00000000d001';

async function harnessFor(db: Db, key: string): Promise<string> {
  await seedPerson(db, { id: personId, email: 'grantor@unfoldingword.org' });
  const rows = await db.execute<{ id: string }>(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
    VALUES (gen_random_uuid(), ${key}, 'software', '80-89', now()) RETURNING id`);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('no harness');
  return id;
}

function delegate(db: Db, harnessId: string, capability: string, maxTier: string | null) {
  return db.execute(sql`INSERT INTO delegations
    (id, person_id, persona, harness_id, capability, granted_at, expires_at, trace_id, max_tier)
    VALUES (gen_random_uuid(), ${personId}, 'agent:shipper', ${harnessId}, ${capability},
      now(), now() + interval '1 day', gen_random_uuid(), ${maxTier})`);
}

async function definitions(db: Db, names: readonly string[]): Promise<string> {
  const rows = await db.execute<{ definition: string }>(sql`
    SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conname IN (${sql.join(names.map((name) => sql`${name}`), sql`, `)})`);
  return rows.map((row) => row.definition).join(' ');
}

function mergeDelegationColumns(db: () => Db): void {
  it('MD-2 a merge delegation carries low or standard, and only a merge delegation carries a tier', async () => {
    const harnessId = await harnessFor(db(), 'merge-tiers');
    await delegate(db(), harnessId, 'merge', 'standard');
    await delegate(db(), harnessId, 'merge', 'low');
    await delegate(db(), harnessId, 'build', null);
    expect(await refusal(delegate(db(), harnessId, 'merge', 'high'))).toEqual({
      code: '23514',
      constraint: 'delegations_max_tier_known',
    });
    expect(await refusal(delegate(db(), harnessId, 'merge', null))).toEqual({
      code: '23514',
      constraint: 'delegations_merge_has_max_tier',
    });
    expect(await refusal(delegate(db(), harnessId, 'build', 'low'))).toEqual({
      code: '23514',
      constraint: 'delegations_merge_has_max_tier',
    });
  });

  it('MD-4 a harness lists at most fifty protected paths and starts with none', async () => {
    const harnessId = await harnessFor(db(), 'merge-paths');
    const rows = await db().execute<{ paths: string[] }>(
      sql`SELECT protected_paths AS paths FROM harnesses WHERE id = ${harnessId}`,
    );
    expect(rows[0]?.paths).toEqual([]);
    const many = `{${Array.from({ length: 51 }, (_, n) => `p${n}/`).join(',')}}`;
    const update = db().execute(sql`UPDATE harnesses SET protected_paths = ${many}::text[] WHERE id = ${harnessId}`);
    expect(await refusal(update)).toEqual({ code: '23514', constraint: 'harnesses_protected_paths_bounded' });
  });

  it('MD-3 an agent actor requires a delegation, a delegated row approves a merge, and the approver check is unchanged', async () => {
    const text = await definitions(db(), [
      'gate_decisions_actor_is_human',
      'gate_decisions_agent_with_delegation',
      'gate_decisions_agent_actor_is_agent',
      'gate_decisions_delegated_approves_merge',
    ]);
    expect(text).toContain('(agent_actor IS NULL) = (delegation_id IS NULL)');
    expect(text).toContain("'^agent:");
    expect(text).toContain("(evidence ->> 'connector'::text) = 'merge'::text");
    expect(text).toContain("decision = 'approve'::text");
    expect(text).toContain("'^human:");
    const fk = await db().execute<{ definition: string }>(sql`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'gate_decisions_delegation_fk'`);
    expect(fk[0]?.definition).toBe('FOREIGN KEY (delegation_id, harness_id) REFERENCES delegations(id, harness_id)');
  });

  it('MD-6 admits the delegated_merge event name', async () => {
    expect(await definitions(db(), ['harness_events_name_known'])).toContain("'delegated_merge'");
  });
}

describe('the merge delegation columns', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => mergeDelegationColumns(openDatabase(target)),
  );
});
```

The row-level behaviour of the four `gate_decisions` checks and the foreign key is pinned through the Store gateway in Task 4, on both adapters. If `seedPerson`'s argument has more required fields, read it and fill them.

- [ ] **Step 2: Run it and see it fail**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/db/merge-delegation-columns.test.ts`
Expected: FAIL, column `max_tier` does not exist.

- [ ] **Step 3: Add the columns and checks**

`packages/db/schema.ts`: import `delegableTierSchema` from `@uw/contracts` beside `capabilityWordSchema`; import `isNotNull` from `drizzle-orm` if the file uses it, else write the partial index with `sql`.

In `harnesses`, after step 15's last column:

```ts
    protectedPaths: text('protected_paths').array().notNull().default(emptyText),
```

and in its checks:

```ts
    check('harnesses_protected_paths_bounded', sql`cardinality(${t.protectedPaths}) <= 50`),
```

In `delegations`, after `traceId`:

```ts
    maxTier: text('max_tier'),
```

and in its checks:

```ts
    check('delegations_max_tier_known', oneOf(t.maxTier, delegableTierSchema.options)),
    check(
      'delegations_merge_has_max_tier',
      sql`(${t.capability} = 'merge') = (${t.maxTier} IS NOT NULL)`,
    ),
    uniqueIndex('delegations_id_harness').on(t.id, t.harnessId),
```

Read `oneOf` in `packages/db/checks.ts` first: it must pass on NULL (a `CHECK` passes when its expression is NULL, so `col IN (...)` does). If `oneOf` wraps the column with `coalesce` or `IS NOT NULL`, write `sql\`${t.maxTier} IS NULL OR ${t.maxTier} IN ('low', 'standard')\`` instead.

In `gateDecisions`, after `decidedAt`:

```ts
    agentActor: text('agent_actor'),
    delegationId: uuid('delegation_id'),
```

and in its constraints, after `gate_decisions_stage_fk`:

```ts
    foreignKey({
      name: 'gate_decisions_delegation_fk',
      columns: [t.delegationId, t.harnessId],
      foreignColumns: [delegations.id, delegations.harnessId],
    }),
    check(
      'gate_decisions_agent_with_delegation',
      sql`(${t.agentActor} IS NULL) = (${t.delegationId} IS NULL)`,
    ),
    check(
      'gate_decisions_agent_actor_is_agent',
      sql`${t.agentActor} IS NULL OR ${t.agentActor} ~ '^agent:'`,
    ),
    check(
      'gate_decisions_delegated_approves_merge',
      sql`${t.delegationId} IS NULL OR (${t.decision} = 'approve' AND ${t.evidence} ->> 'connector' = 'merge')`,
    ),
    index('gate_decisions_delegated')
      .on(t.decidedAt)
      .where(sql`${t.delegationId} IS NOT NULL`),
```

`gateDecisions` is declared after `delegations` in the file; if it is not, the foreign key needs `() =>` columns the way `harnessItems` references `harnesses`; read the file and follow its pattern.

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @uw/db exec drizzle-kit generate --name merge_delegation`
Expected: one new file `packages/db/migrations/00NN_merge_delegation.sql` (the next index after step 15's, expected `0031`) with the four columns, the six checks, the unique index, the foreign key, the partial index, and a drop-and-add of `harness_events_name_known` with `delegated_merge`. Read the file; if it contains anything else, stop and find out why. The unique index must be created before the foreign key in the file; if drizzle-kit orders them the other way, the migration test fails on Step 5 with "there is no unique constraint matching given keys": move the `CREATE UNIQUE INDEX "delegations_id_harness"` statement above the `ALTER TABLE "gate_decisions" ADD CONSTRAINT "gate_decisions_delegation_fk"` statement, keeping the breakpoint markers.

- [ ] **Step 5: Run the database tests and the drift test**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/db tools/db/drift.test.ts`
Expected: green, including `migrations`, `KN-1 gate_decisions takes only a human actor and is append-only`, `the merge delegation columns` on both targets, and `schema drift`.

- [ ] **Step 6: Commit (shared root)**

```bash
git add packages/db/schema.ts packages/db/migrations packages/db/merge-delegation-columns.test.ts
git commit -m "feat(db): the delegated gate decision, the merge tier and protected paths

Shared root packages/db/schema.ts. gate_decisions gains agent_actor and
delegation_id: an agent actor requires a delegation of the same harness,
and a delegated row approves a merge and nothing else. The approver
check gate_decisions_actor_is_human is unchanged. delegations gain
max_tier, set exactly for merge; harnesses gain protected_paths.

MD-2 MD-3 MD-4. S16-R5 S16-R7 S16-R8."
```

---

### Task 4: The ports, the Store's lock and delegated read, and the joined request (shared roots `ports.ts`, `store-ports.ts`)

**Files:**
- Modify (shared-root commit): `packages/harness/store-ports.ts` and its mirror `packages/db/store/types.ts` (`Delegation.maxTier`; `DelegationsGateway.read.lock`; `GateDecisionRow.agentActor`, `GateDecisionRow.delegationId`; `GateDecisionsGateway.read.delegatedSince`), `packages/harness/ports.ts` (`ConnectorRequest.joined`)
- Modify (binding commit): `packages/db/store/delegations.ts`, `packages/db/store/gate-decisions.ts`, `packages/db/store/rows.ts` (`toDelegation`, `toGateDecision`, `toHarness`), `packages/harness/gates/decide.ts` (`recordDecision`'s insert), `packages/harness/gates/exit.ts` (`requestOf`), `packages/harness/gates/ship-input.ts` (`joinedPullRequest`, `usableHead`), `packages/harness/delegations/commands.ts` (`draftOf` sets `maxTier: null`; Task 5 fills it), every `Delegation`, `GateDecisionRow` and `ConnectorRequest` literal `pnpm check` names (expect `packages/harness/port-contracts/store-delegations.ts`, `store-gateways.ts`, `connectors.ts`, `apps/uw-app/github/testing/merge-rig.ts`, `sim/lost-exit.ts`, `apps/uw-app/testing/lost-exit.ts`)
- Modify: `packages/harness/port-contracts/store-gateways.ts` (`describeGateDecisions`), `packages/harness/port-contracts/store-delegations.ts` (a `describeLockAndTier` block), `packages/harness/gates/ship-input.test.ts`

**Interfaces:**
- Produces: `Delegation.maxTier: DelegableTier | null`; `DelegationsGateway.read.lock(delegationId: string): Promise<Delegation | null>` (`SELECT ... FOR SHARE`); `GateDecisionRow.agentActor: Identity | null`, `GateDecisionRow.delegationId: string | null`; `GateDecisionsGateway.read.delegatedSince(since: Date, limit: number): Promise<readonly GateDecisionRow[]>` (rows with a delegation decided at or after `since`, by decision time then id); `ConnectorRequest.joined: boolean`; `joinedPullRequest(item: Pick<ItemState, 'branchState' | 'pullRequest'>): boolean`.

- [ ] **Step 1: The port types (shared root)**

`packages/harness/store-ports.ts` (and the same lines in `packages/db/store/types.ts`, which mirrors it):

```ts
export type Delegation = {
  readonly id: string;
  readonly personId: string;
  readonly persona: Identity;
  readonly harnessId: string;
  readonly capability: CapabilityWord;
  readonly maxTier: DelegableTier | null;
  readonly grantedAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly lapsedAt: Date | null;
  readonly supersedes: string | null;
};
```

(import `DelegableTier` with `CapabilityWord`). `DelegationsGateway.read` gains `lock(delegationId: string): Promise<Delegation | null>;` after `byId`. `GateDecisionRow` gains, after `actor`:

```ts
  readonly agentActor: Identity | null;
  readonly delegationId: string | null;
```

and `GateDecisionsGateway.read` gains `delegatedSince(since: Date, limit: number): Promise<readonly GateDecisionRow[]>;`.

`packages/harness/ports.ts`, `ConnectorRequest` gains `readonly joined: boolean;` after `pullRequest`.

```bash
git add packages/harness/store-ports.ts packages/db/store/types.ts packages/harness/ports.ts
git commit -m "feat(harness): ports for the delegated gate decision and a joined pull request's merge

Shared roots packages/harness/store-ports.ts (with its mirror) and
packages/harness/ports.ts. A delegation names its merge tier and can be
locked for share; a gate decision row names its agent actor and
delegation, and the delegated ones of the last minutes can be read; a
connector request says whether its item joined without a harness branch.

MD-2 MD-3. S16-R5 S16-R10."
```

`pnpm check` is red until Step 4 commits.

- [ ] **Step 2: Write the failing contract tests**

`packages/harness/port-contracts/store-gateways.ts`, in `decisionOf` add `agentActor: null, delegationId: null,` after `actor`, and append inside `describeGateDecisions`:

```ts
  const delegationFor = (base: number, harnessBase: number): Delegation => ({
    id: uid(base),
    personId: '00000000-0000-4000-8000-000000000001',
    persona: identitySchema.parse('agent:shipper'),
    harnessId: uid(harnessBase),
    capability: 'merge',
    maxTier: 'standard',
    grantedAt: at,
    expiresAt: new Date(at.getTime() + hour),
    revokedAt: null,
    lapsedAt: null,
    supersedes: null,
  });
  const delegated = (base: number, delegationBase: number): GateDecisionRow => ({
    ...decisionOf(base, 1, 'human:00000000-0000-4000-8000-000000000001', at),
    agentActor: identitySchema.parse('agent:shipper'),
    delegationId: uid(delegationBase),
    evidence: { findings: [], gateTarget: null, connector: 'merge', next: null },
  });

  it('MD-3 reads back a delegated decision with its agent actor and delegation, and lists it as delegated', async () => {
    const row = delegated(0x1500, 0x15d0);
    const found = await subject().store.transaction(async (tx) => {
      await seedDecisionItem(tx, 0x1500, 'gateway-delegated');
      await tx.delegations.write.insert(delegationFor(0x15d0, 0x1500), uid(0x15e0));
      await tx.gateDecisions.write.insert(row);
      await tx.gateDecisions.write.insert(decisionOf(0x1500, 2, 'human:ian', at));
      return {
        forItem: await tx.gateDecisions.read.forItem(uid(0x1500 + 11)),
        since: await tx.gateDecisions.read.delegatedSince(at, 10),
        later: await tx.gateDecisions.read.delegatedSince(new Date(at.getTime() + 1), 10),
      };
    });
    expect(found.forItem).toContainEqual(row);
    expect(found.since.map((entry) => entry.id)).toContain(row.id);
    expect(found.since.every((entry) => entry.delegationId !== null)).toBe(true);
    expect(found.later.map((entry) => entry.id)).not.toContain(row.id);
  });

  it('MD-3 refuses an agent actor with no delegation, naming gate_decisions_agent_with_delegation', async () => {
    const outcome = await refusedBy(async (tx) => {
      await seedDecisionItem(tx, 0x1600, 'gateway-agent-no-delegation');
      await tx.gateDecisions.write.insert({
        ...decisionOf(0x1600, 1, 'human:ian', at),
        agentActor: identitySchema.parse('agent:shipper'),
      });
    }, subject().store);
    expect(outcome).toMatchObject({ code: '23514', constraint: 'gate_decisions_agent_with_delegation' });
  });

  it('MD-3 still refuses an agent as the approver of a delegated row, naming gate_decisions_actor_is_human', async () => {
    const outcome = await refusedBy(async (tx) => {
      await seedDecisionItem(tx, 0x1700, 'gateway-agent-approver');
      await tx.delegations.write.insert(delegationFor(0x17d0, 0x1700), uid(0x17e0));
      await tx.gateDecisions.write.insert({ ...delegated(0x1700, 0x17d0), actor: identitySchema.parse('agent:shipper') });
    }, subject().store);
    expect(outcome).toMatchObject({ code: '23514', constraint: 'gate_decisions_actor_is_human' });
  });

  it('MD-4 refuses a delegated row that names deploy, naming gate_decisions_delegated_approves_merge', async () => {
    const outcome = await refusedBy(async (tx) => {
      await seedDecisionItem(tx, 0x1800, 'gateway-delegated-deploy');
      await tx.delegations.write.insert(delegationFor(0x18d0, 0x1800), uid(0x18e0));
      const row = delegated(0x1800, 0x18d0);
      await tx.gateDecisions.write.insert({ ...row, evidence: { ...row.evidence, connector: 'deploy' } });
    }, subject().store);
    expect(outcome).toMatchObject({ code: '23514', constraint: 'gate_decisions_delegated_approves_merge' });
  });

  it('MD-3 refuses a delegation of another harness, naming gate_decisions_delegation_fk', async () => {
    const outcome = await refusedBy(async (tx) => {
      await seedDecisionItem(tx, 0x1900, 'gateway-delegated-elsewhere');
      await seedHarness(tx, 0x1a00, 'gateway-delegated-other');
      await tx.delegations.write.insert(delegationFor(0x19d0, 0x1a00), uid(0x19e0));
      await tx.gateDecisions.write.insert(delegated(0x1900, 0x19d0));
    }, subject().store);
    expect(outcome).toMatchObject({ code: '23503', constraint: 'gate_decisions_delegation_fk' });
  });
```

Import `Delegation` with `GateDecisionRow` from `../ports.ts`, and `seedHarness`, `hour` from `./store-gateway-fixtures.ts` if absent. If `refusedBy` names the foreign-key violation's code differently, read `packages/db/store/refusal.ts` and use what it reports for `23503`.

`packages/harness/port-contracts/store-delegations.ts`: `delegationOf` gains `maxTier: null,` after `capability`; add and call from `describeDelegations`:

```ts
function describeLockAndTier(subject: DelegationsSubject): void {
  it('MD-2 MD-3 locks a delegation for share and reads it back with its merge tier', async () => {
    const merge = delegationOf(0x1c00, 1, { capability: 'merge', maxTier: 'low' });
    const found = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x1c00, 'gateway-delegations-lock');
      await tx.delegations.write.insert(merge, uid(0x1c80));
      return { locked: await tx.delegations.read.lock(merge.id), absent: await tx.delegations.read.lock(uid(0x1cfe)) };
    });
    expect(found).toEqual({ locked: merge, absent: null });
  });
}
```

`packages/harness/gates/ship-input.test.ts`, append (reuse the file's ready `item`, its harness and its facts names; import `requestOf` from `./exit.ts`, `joinedPullRequest` from `./ship-input.ts`, and `stagesOf` from `../port-contracts/store-gateway-fixtures.ts`):

```ts
describe('MD-3 a joined item asks the merge connector to accept its own head ref', () => {
  const context = {
    actor: identitySchema.parse('human:00000000-0000-4000-8000-000000000001'),
    at: new Date('2026-10-15T09:00:00.000Z'),
    traceId: '00000000-0000-4000-8000-0000000000f1',
    requestId: null,
    ids: { next: () => '00000000-0000-4000-8000-0000000000f2' },
  };
  const exitOf = (joined: boolean) => ({
    item: joined ? { ...item, branchState: 'none' as const } : { ...item, branchState: 'active' as const },
    stage: stagesOf(0x2000).ship,
    connector: 'merge' as const,
    next: null,
    decisionId: '00000000-0000-4000-8000-0000000000f3',
    overrideReason: null,
    repository: 'unfoldingWord/uw-platform',
    expectedBase: null,
    evaluatedHead: null,
    delegated: null,
  });

  it('MD-3 names a joined item joined and a harness-branch item not', () => {
    expect(joinedPullRequest({ branchState: 'none', pullRequest: item.pullRequest })).toBe(item.pullRequest !== null);
    expect(joinedPullRequest({ branchState: 'none', pullRequest: null })).toBe(false);
    expect(requestOf(context, exitOf(true)).joined).toBe(item.pullRequest !== null);
    expect(requestOf(context, exitOf(false)).joined).toBe(false);
  });
});
```

`delegated: null` is the field Task 8 adds to `ExitInput`; write it now and let `pnpm check` name it until then, or add `readonly delegated: DelegatedMerge | null;` to `ExitInput` in this step (Task 8 then only fills it). Do the latter: in `packages/harness/gates/exit.ts`, `ExitInput` gains `readonly delegated: DelegatedMerge | null;` (import the type from `@uw/contracts`); `decide.ts`'s `pendingExit` and `recover.ts`'s `stuckAt` set `delegated: null`; `PendingExit` in `approve-at-ship.ts` gains the same field. If the file's `item` has `pullRequest: null`, give the joined case `{ ...item, pullRequest: { repo: 'unfoldingWord/uw-platform', number: 7 } }` and assert `true`.

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm check`
Expected: FAIL, naming the gateways' missing `lock` and `delegatedSince`, `requestOf`'s missing `joined`, and every literal.

- [ ] **Step 4: Bind them**

`packages/db/store/delegations.ts`, in `read`:

```ts
      lock: async (delegationId) => {
        const rows = await executor
          .select()
          .from(delegations)
          .where(eq(delegations.id, delegationId))
          .for('share');
        return rows[0] ? toDelegation(rows[0]) : null;
      },
```

`packages/db/store/gate-decisions.ts`: import `and`, `gte`, `isNotNull` from `drizzle-orm` and `checkedRows` from `./limits.ts`; in `read`:

```ts
      delegatedSince: async (since, limit) => {
        const rows = await executor
          .select()
          .from(gateDecisions)
          .where(and(isNotNull(gateDecisions.delegationId), gte(gateDecisions.decidedAt, since)))
          .orderBy(asc(gateDecisions.decidedAt), asc(gateDecisions.id))
          .limit(checkedRows(limit, 'delegated decision'));
        return rows.map(toGateDecision);
      },
```

`packages/db/store/rows.ts`: `toDelegation` gains `maxTier: row.maxTier === null ? null : delegableTierSchema.parse(row.maxTier),`; `toGateDecision` gains `agentActor: row.agentActor === null ? null : identitySchema.parse(row.agentActor), delegationId: row.delegationId,`; `toHarness` passes `protectedPaths: row.protectedPaths` to `harnessSchema.parse`.

`packages/harness/gates/decide.ts`, `recordDecision`'s insert: after `actor: approver.identity,` add `agentActor: null, delegationId: null,`.

`packages/harness/gates/ship-input.ts`:

```ts
export function joinedPullRequest(item: Pick<ItemState, 'branchState' | 'pullRequest'>): boolean {
  return item.branchState === 'none' && item.pullRequest !== null;
}
```

and in `usableHead` replace step 14's `const joined = item.branchState === 'none';` with `const joined = joinedPullRequest(item);` (the next line is unchanged).

`packages/harness/gates/exit.ts`, `requestOf`: add `joined: joinedPullRequest(item),` after `pullRequest: item.pullRequest,` (import `joinedPullRequest` from `./ship-input.ts`).

`packages/harness/delegations/commands.ts`, `draftOf`'s returned delegation: add `maxTier: null,` after `capability` (Task 5 replaces it).

Every other literal `pnpm check` names: `maxTier: null` on a `Delegation`, `agentActor: null, delegationId: null` on a `GateDecisionRow`, `joined: false` on a `ConnectorRequest`.

- [ ] **Step 5: Run the checks and the contract suites on both adapters**

Run: `pnpm check && npx vitest run packages/harness/gates sim/kernel/gate-command.test.ts sim/kernel/recover.test.ts`
Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/db/store apps/uw-app/ports sim/adapters`
Expected: green, including the five new `describeGateDecisions` cases and `describeLockAndTier` on the sim Store and the platform Store, and `KN-1 gate_decisions takes only a human actor and is append-only`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/store packages/harness apps/uw-app sim
git commit -m "feat(db): bind the delegation lock, the delegated decisions read and the joined request

The Store locks a delegation for share and lists delegated decisions by
time; rows carry the merge tier, the agent actor and the delegation. The
gate command writes no agent actor. A connector request names an item
that joined without a harness branch, the combination usableHead already
accepts (S14-R6), now one function.

MD-2 MD-3 MD-4. S16-R5 S16-R10."
```

---

### Task 5: MD-2, granting a merge delegation with its tier; protected paths at activation

**Files:**
- Modify: `packages/harness/delegations/commands.ts` (`GrantInput.maxTier`, `tierOf`, `draftOf`, the grant event)
- Modify: `apps/uw-app/commands/person/delegations.ts` (passes `maxTier`)
- Modify: `apps/uw-app/commands/person/stages.ts` (`activate_template` passes `protectedPaths`)
- Modify: `sim/fixtures.ts` (`simDelegate`'s input gains `maxTier`; `createSimHarness` option `protectedPaths`)
- Create: `sim/kernel/merge-delegation-grant.test.ts`
- Modify: `apps/uw-app/commands/delegations.pg.test.ts` (one case)

**Interfaces:**
- Consumes: Task 2's `delegableTierSchema`, `schedule_regular_tweak.maxTier`, `activate_template.protectedPaths`, `delegation_granted.maxTier`; Task 4's `Delegation.maxTier`.
- Produces: `GrantInput.maxTier: RiskTier | null`; `createSimHarness(world, template, { protectedPaths })`; `simDelegate(world, actor, { ..., maxTier? })`.

- [ ] **Step 1: Write the failing tests**

`sim/kernel/merge-delegation-grant.test.ts`:

```ts
import type { Principal, RiskTier } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = { readonly world: World; readonly harnessId: string; readonly admin: Principal };

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    await work({ world, harnessId: harness.id, admin });
  } finally {
    await world.close();
  }
}

function grant(scene: Scene, actor: Principal, capability: 'merge' | 'build', maxTier: RiskTier | null) {
  return scene.world.kernel.delegations.grant(simCaller(scene.world, actor), {
    harnessId: scene.harnessId,
    persona: 'agent:shipper',
    capability,
    maxTier,
    expiresAt: null,
    supersedes: null,
  });
}

function reasonOf(outcome: KernelOutcome<unknown>): string | null {
  return outcome.status === 'accepted' ? null : outcome.reason;
}

async function grantEvents(scene: Scene) {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, null),
  );
  return events.filter((event) => event.name === 'delegation_granted');
}

describe('MD-2 a merge delegation carries a tier, and only an admin grants one', () => {
  it('MD-2 an admin grants merge up to standard; the event names the grantor and the tier', () =>
    inScene(async (scene) => {
      const granted = await grant(scene, scene.admin, 'merge', 'standard');
      expect(granted).toMatchObject({ status: 'accepted', value: { capability: 'merge', maxTier: 'standard' } });
      const [event] = await grantEvents(scene);
      expect(event?.evidence).toMatchObject({
        personId: scene.admin.personId,
        capability: 'merge',
        maxTier: 'standard',
      });
      expect(event?.actor).toBe(scene.admin.identity);
    }));

  it('MD-2 refuses high as tier_not_delegable and records nothing', () =>
    inScene(async (scene) => {
      expect(reasonOf(await grant(scene, scene.admin, 'merge', 'high'))).toBe('tier_not_delegable');
      expect(await grantEvents(scene)).toEqual([]);
    }));

  it('MD-2 refuses a merge grant with no tier, and a tier on any other capability', () =>
    inScene(async (scene) => {
      const none = await grant(scene, scene.admin, 'merge', null);
      expect(none).toMatchObject({ status: 'error', reason: 'malformed_command', detail: { why: 'max_tier_required' } });
      const build = await grant(scene, scene.admin, 'build', 'low');
      expect(build).toMatchObject({ status: 'error', reason: 'malformed_command', detail: { why: 'max_tier_only_for_merge' } });
      expect(reasonOf(await grant(scene, scene.admin, 'build', null))).toBeNull();
    }));

  it('MD-2 an editor on the area and an agent cannot grant merge', () =>
    inScene(async (scene) => {
      const editor = await simPerson(scene.world, 7, [
        { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
      ]);
      expect(reasonOf(await grant(scene, editor, 'merge', 'low'))).toBe('not_permitted');
      const agent = simAgent(scene.admin, 'shipper', { interactive: false });
      expect(reasonOf(await grant(scene, agent, 'merge', 'low'))).toBe('not_permitted');
      expect(await grantEvents(scene)).toEqual([]);
    }));
});
```

If `readAllEvents` does not take `null` for harness-level events, read them the way `sim/kernel/stage-command.test.ts` does for `hosted_builder_set`. If `Refused`'s detail field has another name than `detail`, read `packages/harness/outcome.ts` and match it.

`apps/uw-app/commands/delegations.pg.test.ts`, add beside `scheduled`:

```ts
async function mergeTier(db: Database): Promise<void> {
  const { harnessId } = await softwareHarness(db);
  const high = await command(db, IAN, harnessId, 'schedule_regular_tweak', tweak({ capability: 'merge', maxTier: 'high' }));
  expect(high.body).toMatchObject({ status: 'error', reason: 'tier_not_delegable' });
  const body = tweak({ persona: 'agent:shipper', capability: 'merge', maxTier: 'standard' });
  const sent = await command(db, IAN, harnessId, 'schedule_regular_tweak', body);
  expect(sent.body).toEqual({ status: 'accepted', requestId: body.requestId });
  const [delegation] = await delegationsOf(db, harnessId);
  expect(delegation).toMatchObject({ capability: 'merge', maxTier: 'standard', personId: IAN_ID });
}
```

and inside the `describe.skipIf(!testServer)` block:

```ts
  it('MD-2 schedule_regular_tweak grants merge up to standard and refuses high as tier_not_delegable', () =>
    withAppDatabase(mergeTier));
```

If a refused command's body has another shape, read `editorCannot` in the same file and match it.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run sim/kernel/merge-delegation-grant.test.ts`
Expected: FAIL; `maxTier` is not on `GrantInput` and the grant never refuses `tier_not_delegable`.

- [ ] **Step 3: The kernel grant**

`packages/harness/delegations/commands.ts`: import `delegableTierSchema`, `type DelegableTier`, `type RiskTier` from `@uw/contracts`.

```ts
export type GrantInput = {
  readonly harnessId: string;
  readonly persona: string;
  readonly capability: CapabilityWord;
  readonly maxTier: RiskTier | null;
  readonly expiresAt: Date | null;
  readonly supersedes: string | null;
};

type Tiered = { readonly maxTier: DelegableTier | null };

function tierOf(input: GrantInput): Tiered | Refused {
  if (input.capability !== 'merge') {
    if (input.maxTier === null) return { maxTier: null };
    return refused('malformed_command', { why: 'max_tier_only_for_merge' });
  }
  if (input.maxTier === null) return refused('malformed_command', { why: 'max_tier_required' });
  const tier = delegableTierSchema.safeParse(input.maxTier);
  return tier.success ? { maxTier: tier.data } : refused('tier_not_delegable', { maxTier: input.maxTier });
}
```

`draftOf` takes `input: GrantInput & Tiered` (the intersection narrows `maxTier` to `DelegableTier | null`; if TypeScript refuses the intersection, take `tier: Tiered` as part of an object argument instead of a sixth parameter) and sets `maxTier: input.maxTier` in place of Task 4's `maxTier: null`. In `grantIn`, after `adminRefusal`:

```ts
  const tier = tierOf(input);
  if ('status' in tier) return tier;
  const next = draftOf(ports, caller, harness, { ...input, maxTier: tier.maxTier }, at);
```

The `delegation_granted` draft gains `maxTier: next.maxTier,` after `supersedes`.

- [ ] **Step 4: The app and the sim pass the new fields**

`apps/uw-app/commands/person/delegations.ts`: destructure `maxTier` from `body` and add it to `input`.

`apps/uw-app/commands/person/stages.ts`, `activateTemplateCommand`: pass `protectedPaths: body.protectedPaths` in `input`, beside steps 14 and 15's `shadow`, `externalReviewerIdentities` and `requiredChecks`.

`sim/fixtures.ts`: the local `GrantInput` gains `readonly maxTier?: RiskTier | null;` (import the type) and `simDelegate` calls `world.kernel.delegations.grant(simCaller(world, actor), { ...input, maxTier: input.maxTier ?? null })`. `SimHarnessOptions` gains `readonly protectedPaths?: readonly string[];` and `createSimHarness` passes `protectedPaths: options.protectedPaths ?? []` to `activate`.

Any other `kernel.delegations.grant(` call `pnpm check` names: add `maxTier: null`.

- [ ] **Step 5: Run the tests**

Run: `pnpm check && npx vitest run sim/kernel/merge-delegation-grant.test.ts sim/kernel/delegations.test.ts sim/kernel/delegation-guard.test.ts`
Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/commands/delegations.pg.test.ts apps/uw-app/commands/stages.pg.test.ts`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/harness/delegations apps/uw-app/commands sim
git commit -m "feat(harness): an admin grants a merge delegation up to low or standard

A merge grant must name its tier; high is refused tier_not_delegable,
no tier and a tier on another capability are malformed. The grant event
names the grantor and the tier. Activation takes the harness's protected
paths.

MD-2. S16-R7 S16-R8."
```

---

### Task 6: MD-4, where a delegation may act: the delegable exit, protected paths, the ship-rule input, and the property over every template

**Files:**
- Create: `packages/harness/gates/delegable.ts`
- Create: `packages/harness/risk/protected-paths.ts`, `packages/harness/risk/protected-paths.test.ts`
- Modify: `packages/harness/risk/derive.ts` (export `normalise` and `matches`)
- Modify: `packages/harness/gates/ship-input.ts` (`ShipHarness`, `ShipInputSource.delegation`, `delegationAt`, `assembleShipInput`)
- Modify: `packages/harness/gates/ship-input.test.ts` (the `harness` literal; one block)
- Modify: `packages/harness/template-property.ts` (`delegationProperty`, `describeDelegationViolation`), `packages/harness/template-property.test.ts`
- Modify: `packages/harness/index.ts` (export `delegableExit`, `delegationProperty`, `protectedAmong`)

**Interfaces:**
- Produces: `delegableExit(stage: ExitShape): boolean` with `ExitShape = { readonly exitGate: ExitGate; readonly connector: Connector }`; `protectedAmong(paths: readonly string[], harnessPaths: readonly string[]): readonly string[]` (at most 100); `ShipInputSource.delegation?: ShipDelegation | null` with `ShipDelegation = { readonly delegationId: string; readonly maxTier: DelegableTier }`; `delegationProperty(stages: readonly WalkStage[], delegable?: (stage: ExitShape) => boolean): readonly TemplateViolation[]`.

- [ ] **Step 1: Write the failing tests**

`packages/harness/risk/protected-paths.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { protectedAmong } from './protected-paths.ts';

describe('MD-4 protected paths are the kernel list and the harness list', () => {
  it('MD-4 names a path under a kernel protected directory whatever the harness lists', () => {
    expect(protectedAmong(['packages/db/migrations/0099_x.sql', 'apps/uw-app/board.tsx'], [])).toEqual([
      'packages/db/migrations/0099_x.sql',
    ]);
  });

  it('MD-4 names a path under a directory or equal to a file the harness lists, after normalising', () => {
    const listed = ['src/billing/', 'deploy.sh'];
    expect(protectedAmong(['src/billing/rates.ts', './Deploy.sh', 'src/billing', 'src/billingx.ts'], listed)).toEqual([
      'src/billing/rates.ts',
      './Deploy.sh',
      'src/billing',
    ]);
  });

  it('MD-4 names nothing for a change outside both lists', () => {
    expect(protectedAmong(['src/board.ts'], ['src/billing/'])).toEqual([]);
  });
});
```

`packages/harness/gates/ship-input.test.ts`: add `protectedPaths: []` (and any field steps 14 and 15 added that the literal lacks) to the top-level `harness` literal, then append:

```ts
describe('MD-4 the ship-rule input carries the delegation and the protected paths the change touches', () => {
  const lent = { delegationId: '00000000-0000-4000-8000-0000000000d1', maxTier: 'standard' as const };

  it('MD-4 a person approval carries no delegation', () => {
    expect(assembled().delegation).toBeNull();
  });

  it('MD-4 a delegated exit carries the tier and an empty list for an unprotected change', () => {
    expect(assembleShipInput({ ...sourceOf({}), delegation: lent }).delegation).toEqual({
      ...lent,
      protectedTouched: [],
    });
  });

  it('MD-4 names the changed paths the harness protects', () => {
    const source = sourceOf({});
    const guarded = { ...source, harness: { ...source.harness, protectedPaths: ['apps/uw-app/'] }, delegation: lent };
    expect(assembleShipInput(guarded).delegation?.protectedTouched).toEqual(['apps/uw-app/board.tsx']);
  });

  it('MD-4 fails closed when the facts cannot name the changed paths at the head', () => {
    const unknown = { ...sourceOf({ facts: { files: null } }), delegation: lent };
    expect(assembleShipInput(unknown).delegation?.protectedTouched).toBeNull();
  });
});
```

`packages/harness/template-property.test.ts`, append (import `bml` from `./templates/bml.ts`, `templates` from `./templates.ts`, and `delegationProperty`, `describeDelegationViolation` from `./template-property.ts` if absent):

```ts
describe('MD-4 no path reaches a deploy or publish connector through an exit a delegation can take', () => {
  it('MD-4 every registered template passes', () => {
    for (const template of templates.values()) expect(delegationProperty(template.stages)).toEqual([]);
  });

  it('MD-4 a delegation that could take any human exit fails on the publish stage, naming it', () => {
    const permissive = (stage: { readonly exitGate: string }) => stage.exitGate === 'human_approval';
    const [violation] = delegationProperty(bml.stages, permissive);
    expect(violation?.effectStage).toBe('ship');
    expect(violation && describeDelegationViolation(violation)).toBe(
      `path ${violation?.path.join(' > ')} reaches ship, whose connector is not merge, through an exit a delegation could take`,
    );
  });
});
```

Read `packages/harness/templates/bml.ts` first: its publish stage's key is `ship` because `eightStages` names it so; if the key differs, use it.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/harness/risk/protected-paths.test.ts packages/harness/gates/ship-input.test.ts packages/harness/template-property.test.ts`
Expected: FAIL; the modules and functions do not exist.

- [ ] **Step 3: Write the code**

`packages/harness/gates/delegable.ts`:

```ts
import type { Connector, ExitGate } from '@uw/contracts';

export type ExitShape = { readonly exitGate: ExitGate; readonly connector: Connector };

export function delegableExit(stage: ExitShape): boolean {
  return stage.exitGate === 'human_approval' && stage.connector === 'merge';
}
```

`packages/harness/risk/derive.ts`: add `export` to `function normalise` and `function matches` (names and bodies unchanged).

`packages/harness/risk/protected-paths.ts`:

```ts
import { domainOf, matches, normalise } from './derive.ts';

const TOUCHED_LIMIT = 100;

export function protectedAmong(
  paths: readonly string[],
  harnessPaths: readonly string[],
): readonly string[] {
  const listed = (path: string) => harnessPaths.some((entry) => matches(entry, normalise(path)));
  return paths.filter((path) => domainOf(path) !== null || listed(path)).slice(0, TOUCHED_LIMIT);
}
```

`packages/harness/gates/ship-input.ts`: import `type DelegableTier` from `@uw/contracts` and `protectedAmong` from `../risk/protected-paths.ts`. `ShipHarness`'s `Pick` gains `'protectedPaths'`. Add:

```ts
export type ShipDelegation = { readonly delegationId: string; readonly maxTier: DelegableTier };
```

`ShipInputSource` gains `readonly delegation?: ShipDelegation | null;`. Add:

```ts
function delegationAt(source: ShipInputSource): ShipRuleInput['delegation'] {
  const lent = source.delegation ?? null;
  if (lent === null) return null;
  const { facts, item, harness } = source;
  const head = usableHead(facts, item, harness);
  const paths = facts === null || head === null ? null : pathsComparedAt(facts, head);
  const protectedTouched = paths === null ? null : [...protectedAmong(paths, harness.protectedPaths)];
  return { ...lent, protectedTouched };
}
```

and in `assembleShipInput` replace Task 2's `delegation: null,` with `delegation: delegationAt(source),`.

`packages/harness/template-property.ts`:

```ts
import { delegableExit, type ExitShape } from './gates/delegable.ts';

export function delegationProperty(
  stages: readonly WalkStage[],
  delegable: (stage: ExitShape) => boolean = delegableExit,
): readonly TemplateViolation[] {
  return effectPaths(walk(stages))
    .filter((effect) => {
      const last = effect.steps.at(-1);
      return last !== undefined && last.connector !== 'merge' && delegable(last);
    })
    .map((effect) => {
      const path = effect.steps.map((entry) => entry.key);
      return { path, effectStage: path.at(-1) ?? '' };
    });
}

export function describeDelegationViolation(violation: TemplateViolation): string {
  return `path ${violation.path.join(' > ')} reaches ${violation.effectStage}, whose connector is not merge, through an exit a delegation could take`;
}
```

`packages/harness/index.ts`: export `delegableExit` and type `ExitShape` from `./gates/delegable.ts`, `delegationProperty` from `./template-property.ts`, `protectedAmong` from `./risk/protected-paths.ts`.

- [ ] **Step 4: Run the tests and the walk**

Run: `pnpm check && npx vitest run packages/harness/risk packages/harness/gates packages/harness/template-property.test.ts packages/harness/ship-rule.test.ts` then `pnpm walk:all`
Expected: green; the walk is unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/harness
git commit -m "feat(harness): a delegation acts only at a merge exit and never on a protected path

delegableExit is the one definition of where a merge delegation may
act. The ship-rule input carries the delegation's tier and the changed
paths under the kernel's protected directories or the harness's own,
failing closed when the paths are unknown. A property over every
template's paths fails if a deploy or publish effect sits behind an exit
a delegation could take.

MD-4. S16-R7."
```

---

### Task 7: MD-3, the delegated Ship exit's decision: claim, poll, submit, and the one named writer

**Files:**
- Create: `packages/harness/gates/lent.ts`
- Create: `packages/harness/gates/delegated-ship.ts`
- Modify: `packages/harness/gates/approve-at-ship.ts` (export `type ShipGate`; `shipCheck` and `shipVerdict` take a `ShipDelegation | null`)
- Modify: `packages/harness/items/claim.ts` (`pickupRefusal`, `unlentRefusal`, `capabilityRefusal`, `mergeReach`)
- Modify: `packages/harness/reads/poll.ts` (`pickupOpen`, `claimable`)
- Modify: `packages/harness/items/submit.ts` (the pre-read, the guard, `recordSubmission`, `delegatedAfter`)
- Modify: `sim/ship-fixtures.ts` (`simAtShip`, `simLendMerge`, `MergeLoan`; `simParkedAtShip` built on `simAtShip`)
- Create: `sim/kernel/delegated-ship.test.ts`
- Create: `sim/scenarios/MD-4.a-delegation-never-covers-a-protected-path.ts`

**Interfaces:**
- Consumes: Task 4's `delegations.read.lock`, `GateDecisionRow.agentActor`/`delegationId`; Task 6's `delegableExit`, `ShipDelegation`, `ShipInputSource.delegation`; step 15's `shipCheck`, `ShipCheck.shipped`, `Shipped`.
- Produces: `lentInDecision(ports, tx, input)`, `lentAtExit(ports, delegated, at)` returning `Lent | NotLent` with `Lent = { delegation, approver, lent }` and `NotLent = 'delegation_required' | 'delegation_lapsed'`; `delegatedPreRead(ports, caller, itemId): Promise<DelegatedRead | Refused | null>`; `delegationRequiredAtShip(tx, standing)`; `shipUnderDelegation(ports, tx, scene): Promise<DelegatedOutcome | null>`; `recordDelegatedDecision(tx, scene, decided)`; `simAtShip(world, input: ShipInput): Promise<ItemState>`; `simLendMerge(world, grantor, { harnessId, maxTier, persona? }): Promise<MergeLoan>` with `MergeLoan = { delegationId: string; agent: Principal }`.

- [ ] **Step 1: The sim fixtures**

`sim/ship-fixtures.ts`: split `simParkedAtShip` at its second agent `submitWithChange`. Everything up to and including that call becomes:

```ts
export async function simAtShip(world: World, input: ShipInput): Promise<ItemState> {
  const editor = simCaller(world, input.editor);
  const { itemId } = accepted(
    await world.kernel.items.enqueue(editor, {
      harnessId: input.harnessId,
      title: input.title,
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
    'enqueue',
  );
  const { harnessId } = input;
  await simAdvance(world, { harnessId, itemId, worker: input.editor, through: ['package'] });
  const agent = simAgent(input.editor, `${input.editor.personId}/builder`, { interactive: true });
  await simAdvance(world, { harnessId, itemId, worker: agent, through: ['scope', 'plan'] });
  await submitWithChange(world, agent, itemId, input.change);
  const atShip = await submitWithChange(world, agent, itemId, input.change);
  if (atShip.stageKey !== 'ship' || atShip.gateStatus !== 'working') {
    throw new Error(`the item is ${atShip.gateStatus} at ${atShip.stageKey}, not working at ship`);
  }
  return atShip;
}
```

and `simParkedAtShip` keeps its tail on top of it:

```ts
export async function simParkedAtShip(world: World, input: ShipInput): Promise<ItemState> {
  const atShip = await simAtShip(world, input);
  const parked = await submitWithChange(world, input.editor, atShip.itemId, null);
  if (parked.stageKey !== 'ship' || parked.gateStatus !== 'parked') {
    throw new Error(`the item is ${parked.gateStatus} at ${parked.stageKey}, not parked at ship`);
  }
  return parked;
}
```

If step 15 added lines to `simParkedAtShip` (facts given before a submit), keep each on the side of the split where it ran. Then add (import `readSpend`, `simDelegate` from `./fixtures.ts` and `type Principal` if absent):

```ts
export type MergeLoan = { readonly delegationId: string; readonly agent: Principal };

export type LoanInput = {
  readonly harnessId: string;
  readonly maxTier: 'low' | 'standard';
  readonly persona?: string;
};

export async function simLendMerge(
  world: World,
  grantor: Principal,
  input: LoanInput,
): Promise<MergeLoan> {
  const persona = input.persona ?? 'shipper';
  const granted = await simDelegate(world, grantor, {
    harnessId: input.harnessId,
    persona: `agent:${persona}`,
    capability: 'merge',
    maxTier: input.maxTier,
    expiresAt: null,
    supersedes: null,
  });
  const delegation = accepted(granted, 'the merge delegation');
  await readSpend(world);
  return { delegationId: delegation.id, agent: simAgent(grantor, persona, { interactive: false }) };
}
```

- [ ] **Step 2: Write the failing tests**

`sim/kernel/delegated-ship.test.ts`:

```ts
import type { ItemState, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simDelegate, simPerson } from '../fixtures.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  simAtShip,
  simLendMerge,
  standardChange,
  type MergeLoan,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly admin: Principal;
  readonly harnessId: string;
  readonly item: ItemState;
};

type Options = { readonly protectedPaths?: readonly string[]; readonly shadow?: boolean };

async function inScene(options: Options, work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software, options);
    const input = { harnessId: harness.id, editor: admin, title: 'Show the board', change: standardChange };
    const item = await simAtShip(world, input);
    const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', standardChange.head, 9300000001)];
    world.adapters.githubFacts.given(greenFacts(world, { itemId: item.itemId, head: standardChange.head, reviews }));
    await work({ world, admin, harnessId: harness.id, item });
  } finally {
    await world.close();
  }
}

function claim(scene: Scene, agent: Principal, delegationId: string | null) {
  return scene.world.kernel.items.claim(simCaller(scene.world, agent), { itemId: scene.item.itemId, delegationId });
}

function submit(scene: Scene, agent: Principal) {
  const input = { itemId: scene.item.itemId, to: null, evidence: {}, change: null };
  return scene.world.kernel.items.submit(simCaller(scene.world, agent), input);
}

async function claimAndSubmit(scene: Scene, loan: MergeLoan) {
  expect((await claim(scene, loan.agent, loan.delegationId)).status).toBe('accepted');
  return submit(scene, loan.agent);
}

function rows(scene: Scene) {
  return scene.world.adapters.store.transaction((tx) => tx.gateDecisions.read.forItem(scene.item.itemId));
}

function lastEvent(scene: Scene) {
  return itemLog(scene.world, scene.harnessId, scene.item.itemId).then((log) => log.events.at(-1));
}

describe('MD-3 an agent under a merge delegation takes the Ship exit, and the record names the grantor', () => {
  it('MD-3 writes one decision: the grantor approves, the agent acts, the delegation is named; nothing merges yet', () =>
    inScene({}, async (scene) => {
      const loan = await simLendMerge(scene.world, scene.admin, { harnessId: scene.harnessId, maxTier: 'standard' });
      const submitted = await claimAndSubmit(scene, loan);
      expect(submitted).toMatchObject({ status: 'accepted', value: { result: 'parked', failures: [] } });
      const [row, ...more] = await rows(scene);
      expect(more).toEqual([]);
      expect(row).toMatchObject({
        actor: scene.admin.identity,
        agentActor: loan.agent.identity,
        delegationId: loan.delegationId,
        decision: 'approve',
        evidence: {
          connector: 'merge',
          head: standardChange.head,
          delegation: { delegationId: loan.delegationId, personId: scene.admin.personId, maxTier: 'standard' },
        },
      });
      expect(await lastEvent(scene)).toMatchObject({ name: 'gate_approved', actor: loan.agent.identity });
      expect(scene.world.adapters.connectors.calls()).toEqual([]);
    }));

  it('MD-3 the approver is whoever granted the delegation', () =>
    inScene({}, async (scene) => {
      const kim = await simPerson(scene.world, 8, [{ role: 'admin', scopeKind: 'org', scopeArea: null }]);
      const loan = await simLendMerge(scene.world, kim, { harnessId: scene.harnessId, maxTier: 'standard' });
      await claimAndSubmit(scene, loan);
      const [row] = await rows(scene);
      expect(row?.actor).toBe(kim.identity);
      expect(row?.actor).not.toBe(scene.admin.identity);
    }));

  it('MD-3 a second submit answers not_holder and writes no second decision', () =>
    inScene({}, async (scene) => {
      const loan = await simLendMerge(scene.world, scene.admin, { harnessId: scene.harnessId, maxTier: 'standard' });
      await claimAndSubmit(scene, loan);
      expect(await submit(scene, loan.agent)).toMatchObject({ status: 'error', reason: 'not_holder' });
      expect(await rows(scene)).toHaveLength(1);
    }));

  it('MD-3 a delegation revoked after the claim refuses the submit delegation_lapsed and writes nothing', () =>
    inScene({}, async (scene) => {
      const loan = await simLendMerge(scene.world, scene.admin, { harnessId: scene.harnessId, maxTier: 'standard' });
      expect((await claim(scene, loan.agent, loan.delegationId)).status).toBe('accepted');
      const revoked = await scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.admin), {
        delegationId: loan.delegationId,
      });
      expect(revoked.status).toBe('accepted');
      expect(await submit(scene, loan.agent)).toMatchObject({ status: 'error', reason: 'delegation_lapsed' });
      expect(await rows(scene)).toEqual([]);
    }));

  it('MD-3 poll_queue offers the Ship item under a merge delegation and not under a build one', () =>
    inScene({}, async (scene) => {
      const loan = await simLendMerge(scene.world, scene.admin, { harnessId: scene.harnessId, maxTier: 'low' });
      const offered = await scene.world.kernel.reads.poll(simCaller(scene.world, loan.agent), {
        harnessId: scene.harnessId,
        limit: 10,
      });
      expect(offered).toMatchObject({ status: 'accepted' });
      expect(offered.status === 'accepted' && offered.value.map((entry) => entry.itemId)).toContain(scene.item.itemId);
      await simDelegate(scene.world, scene.admin, {
        harnessId: scene.harnessId,
        persona: 'agent:builder',
        capability: 'build',
        expiresAt: null,
        supersedes: null,
      });
      const builder = simAgent(scene.admin, 'builder', { interactive: false });
      const shown = await scene.world.kernel.reads.poll(simCaller(scene.world, builder), {
        harnessId: scene.harnessId,
        limit: 10,
      });
      expect(shown.status === 'accepted' && shown.value.map((entry) => entry.itemId)).not.toContain(scene.item.itemId);
    }));
});

describe('MD-4 what a merge delegation never covers', () => {
  it('MD-4 a protected path is refused protected_path_needs_person and the item waits for a person, who can approve', () =>
    inScene({ protectedPaths: ['apps/uw-app/'] }, async (scene) => {
      const loan = await simLendMerge(scene.world, scene.admin, { harnessId: scene.harnessId, maxTier: 'standard' });
      const submitted = await claimAndSubmit(scene, loan);
      expect(submitted).toMatchObject({ status: 'accepted', value: { result: 'parked', failures: ['protected_path_needs_person'] } });
      expect(await lastEvent(scene)).toMatchObject({ name: 'ship_refused', evidence: { reasons: ['protected_path_needs_person'] } });
      expect(await rows(scene)).toEqual([]);
      const decided = await scene.world.kernel.gates.decide(simCaller(scene.world, scene.admin), {
        itemId: scene.item.itemId,
        decision: 'approve',
        reason: null,
        findings: [],
        seenHead: standardChange.head,
      });
      expect(decided).toMatchObject({ status: 'accepted', value: { advanced: true } });
      expect(await rows(scene)).toMatchObject([{ actor: scene.admin.identity, agentActor: null, delegationId: null }]);
    }));

  it('MD-4 a standard change under a low delegation is refused tier_above_delegation', () =>
    inScene({}, async (scene) => {
      const loan = await simLendMerge(scene.world, scene.admin, { harnessId: scene.harnessId, maxTier: 'low' });
      const submitted = await claimAndSubmit(scene, loan);
      expect(submitted).toMatchObject({ status: 'accepted', value: { failures: ['tier_above_delegation'] } });
      expect(await rows(scene)).toEqual([]);
    }));

  it('MD-4 an agent claiming at Ship without a delegation is refused delegation_required, which is recorded', () =>
    inScene({}, async (scene) => {
      const device = simAgent(scene.admin, `${scene.admin.personId}/laptop`, { interactive: true });
      expect(await claim(scene, device, null)).toMatchObject({ status: 'error', reason: 'delegation_required' });
      expect(await lastEvent(scene)).toMatchObject({ name: 'delegation_required', evidence: { stage: 'ship' } });
    }));

  it('MD-4 a build delegation is refused pickup at Ship, and a merge delegation at a deploy stage', () =>
    inScene({}, async (scene) => {
      const granted = await simDelegate(scene.world, scene.admin, {
        harnessId: scene.harnessId,
        persona: 'agent:builder',
        capability: 'build',
        expiresAt: null,
        supersedes: null,
      });
      const buildId = granted.status === 'accepted' ? granted.value.id : '';
      const builder = simAgent(scene.admin, 'builder', { interactive: false });
      expect(await claim(scene, builder, buildId)).toMatchObject({ status: 'error', reason: 'pickup_not_allowed' });
      const edited = await scene.world.kernel.stages.updateStage(simCaller(scene.world, scene.admin), {
        harnessId: scene.harnessId,
        stageKey: 'ship',
        change: { connector: 'deploy' },
      });
      expect(edited.status).toBe('accepted');
      const loan = await simLendMerge(scene.world, scene.admin, { harnessId: scene.harnessId, maxTier: 'standard' });
      expect(await claim(scene, loan.agent, loan.delegationId)).toMatchObject({ status: 'error', reason: 'pickup_not_allowed' });
    }));

  it('MD-4 a shadow harness never takes the delegated exit', () =>
    inScene({ shadow: true }, async (scene) => {
      const loan = await simLendMerge(scene.world, scene.admin, { harnessId: scene.harnessId, maxTier: 'standard' });
      const submitted = await claimAndSubmit(scene, loan);
      expect(submitted).toMatchObject({ status: 'accepted', value: { result: 'parked', failures: ['shadow'] } });
      expect(await rows(scene)).toEqual([]);
    }));
});
```

If `updateStage` refuses a connector change on a stage that holds an item, do it before `simAtShip` by moving the edit into an `inScene` option; the assertion stays. If `createSimHarness` does not take `shadow` for the software template, pass it as step 14 does for the check-only one and read its option name.

`sim/scenarios/MD-4.a-delegation-never-covers-a-protected-path.ts` drives the first MD-4 case through `defineScenario` (id `'MD-4'`), written like `sim/scenarios/KN-13.agent-cannot-write-decision.ts` (imports from `../fixtures.ts`, `../ship-fixtures.ts`, `../scenario.ts`, `node:assert/strict`), asserting with `assert.deepEqual` and returning `{ state: { failures, decisions } }`.

- [ ] **Step 3: Run them and see them fail**

Run: `npx vitest run sim/kernel/delegated-ship.test.ts`
Expected: FAIL; `simLendMerge`'s agent is refused `pickup_not_allowed` at Ship.

- [ ] **Step 4: The lent delegation**

`packages/harness/gates/lent.ts`:

```ts
import type { DelegatedMerge, Principal } from '@uw/contracts';
import { personPrincipal } from '@uw/core/principal';
import { livenessOf, recordLapse } from '../delegations/live.ts';
import type { RecordContext } from '../items/record.ts';
import type { Delegation, Ports, StoreTransaction } from '../ports.ts';
import type { ShipDelegation } from './ship-input.ts';

type LentPorts = Pick<Ports, 'grants'>;

export type Lent = {
  readonly delegation: Delegation;
  readonly approver: Principal;
  readonly lent: ShipDelegation;
};

export type NotLent = 'delegation_required' | 'delegation_lapsed';

export type LendingInput = {
  readonly delegationId: string;
  readonly email: string | null;
  readonly context: RecordContext;
};

function lentOf(delegation: Delegation, approver: Principal): Lent | NotLent {
  if (delegation.maxTier === null) return 'delegation_required';
  return { delegation, approver, lent: { delegationId: delegation.id, maxTier: delegation.maxTier } };
}

export async function lentInDecision(
  ports: LentPorts,
  tx: StoreTransaction,
  input: LendingInput,
): Promise<Lent | NotLent> {
  const { context } = input;
  const delegation = await tx.delegations.read.lock(input.delegationId);
  if (delegation === null || delegation.capability !== 'merge') return 'delegation_required';
  const liveness = await livenessOf(tx, ports, delegation, context.at);
  if (!liveness.live) {
    if (liveness.why !== null) await recordLapse(tx, context, delegation, liveness.why);
    return 'delegation_lapsed';
  }
  if (input.email === null) return 'delegation_lapsed';
  const grants = await ports.grants.lockAndReread(tx, delegation.personId, context.at);
  const approver = personPrincipal({ personId: delegation.personId, email: input.email, grants, interactive: false });
  return lentOf(delegation, approver);
}

export async function lentAtExit(
  ports: Pick<Ports, 'grants' | 'store'>,
  delegated: DelegatedMerge,
  at: Date,
): Promise<Lent | NotLent> {
  return ports.store.transaction(async (tx) => {
    const delegation = await tx.delegations.read.byId(delegated.delegationId);
    if (delegation === null || delegation.capability !== 'merge') return 'delegation_lapsed';
    const liveness = await livenessOf(tx, ports, delegation, at);
    if (!liveness.live) return 'delegation_lapsed';
    const approver = personPrincipal({
      personId: delegation.personId,
      email: delegated.email,
      grants: liveness.grants,
      interactive: false,
    });
    return lentOf(delegation, approver);
  });
}
```

`lentAtExit` is Task 8's; it lives here so `approve-at-ship.ts` and `delegated-ship.ts` share one module without importing each other in a cycle.

- [ ] **Step 5: The decision half**

`packages/harness/gates/approve-at-ship.ts`: export the `ShipGate` type (`export type ShipGate = ...`); import `type ShipDelegation` from `./ship-input.ts`; `shipVerdict(gate, decision, snapshot, delegation: ShipDelegation | null)` adds `delegation` to its `source` object; `shipCheck(tx, gate, decision, snapshot, delegation: ShipDelegation | null = null)` passes it to `shipVerdict`. The person path is unchanged (it passes nothing).

`packages/harness/gates/delegated-ship.ts`:

```ts
import type { DelegatedMerge, Harness, ItemState, Stage } from '@uw/contracts';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { recordDelegationRequired } from '../delegations/acting.ts';
import { draft, recordItemEvents, type RecordContext } from '../items/record.ts';
import { resolveExit } from '../items/transitions.ts';
import type { Refused } from '../outcome.ts';
import type { Ports, PullRequestFacts, StoreTransaction } from '../ports.ts';
import { shipCheck, type ShipCheck } from './approve-at-ship.ts';
import { delegableExit } from './delegable.ts';
import { factsFailure } from './facts-failure.ts';
import { lentInDecision, type Lent } from './lent.ts';

export type DelegatedPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'store'>;

export type DelegatedRead = {
  readonly facts: PullRequestFacts | null;
  readonly email: string | null;
};

export type DelegatedScene = {
  readonly caller: Caller;
  readonly item: ItemState;
  readonly harness: Harness;
  readonly stages: readonly Stage[];
  readonly stage: Stage;
  readonly delegationId: string;
  readonly context: RecordContext;
  readonly read: DelegatedRead;
};

export type DelegatedOutcome = { readonly item: ItemState; readonly failures: readonly string[] };

type AtExit = { readonly item: ItemState; readonly harness: Harness; readonly personId: string };

type Standing = {
  readonly caller: Caller;
  readonly item: ItemState;
  readonly stage: Stage;
  readonly context: RecordContext;
};

async function atDelegableExit(tx: StoreTransaction, itemId: string): Promise<AtExit | null> {
  const item = await tx.harnessItems.read.byId(itemId);
  if (item === null || item.delegationId === null) return null;
  const harness = await tx.harnesses.read.byId(item.harnessId);
  const stages = await tx.harnessStages.read.forHarness(item.harnessId);
  const stage = stages.find((entry) => entry.key === item.stageKey);
  if (harness === null || stage === undefined || !delegableExit(stage)) return null;
  const delegation = await tx.delegations.read.byId(item.delegationId);
  if (delegation?.capability !== 'merge') return null;
  return { item, harness, personId: delegation.personId };
}

export async function delegatedPreRead(
  ports: DelegatedPorts,
  caller: Caller,
  itemId: string,
): Promise<DelegatedRead | Refused | null> {
  if (!isAgent(caller.actor)) return null;
  const found = await ports.store.transaction((tx) => atDelegableExit(tx, itemId));
  if (found === null) return null;
  const holders = await ports.grants.holders(found.harness.jdArea, ports.clock.now());
  const email = holders.find((holder) => holder.personId === found.personId)?.email ?? null;
  const ref = found.item.pullRequest;
  if (ref === null) return { facts: null, email };
  try {
    return { facts: await ports.githubFacts.pullRequest(ref), email };
  } catch (error) {
    return factsFailure(error);
  }
}

export async function delegationRequiredAtShip(
  tx: StoreTransaction,
  standing: Standing,
): Promise<Refused | null> {
  const { caller, item, stage, context } = standing;
  if (!isAgent(caller.actor) || !delegableExit(stage)) return null;
  const delegation = item.delegationId === null ? null : await tx.delegations.read.byId(item.delegationId);
  if (delegation?.capability === 'merge') return null;
  return recordDelegationRequired(tx, context, item.itemId, stage.key);
}

function heldBack(scene: DelegatedScene): string | null {
  if (scene.harness.shadow) return 'shadow';
  return scene.item.gateTarget === null ? null : 'gate_target';
}

function reasonsOf(refusal: Refused): readonly string[] {
  const reasons = refusal.detail['reasons'];
  return typeof reasons === 'object' && reasons !== null ? [...reasons] : [refusal.reason];
}

function delegatedMergeOf(decisionId: string, found: Lent): DelegatedMerge {
  const { delegation, approver, lent } = found;
  return {
    decisionId,
    delegationId: delegation.id,
    personId: delegation.personId,
    email: approver.email ?? '',
    persona: delegation.persona,
    expiresAt: delegation.expiresAt.toISOString(),
    maxTier: lent.maxTier,
  };
}

type Decided = { readonly found: Lent; readonly ship: ShipCheck };

export async function recordDelegatedDecision(
  tx: StoreTransaction,
  scene: DelegatedScene,
  decided: Decided,
): Promise<DelegatedOutcome> {
  const { item, stages, stage, context, caller } = scene;
  const { found, ship } = decided;
  const decisionId = context.ids.next();
  const shipped = ship.shipped === null ? {} : { head: ship.shipped.head, approvals: ship.shipped.approvals.map((entry) => ({ ...entry })) };
  await tx.gateDecisions.write.insert({
    id: decisionId,
    harnessId: item.harnessId,
    itemId: item.itemId,
    stageId: stage.id,
    actor: found.approver.identity,
    agentActor: caller.actor.identity,
    delegationId: found.delegation.id,
    decision: 'approve',
    reason: null,
    evidence: {
      findings: [],
      gateTarget: null,
      connector: 'merge',
      next: resolveExit(stages, stage, null)?.to?.key ?? null,
      ...shipped,
      delegation: { ...delegatedMergeOf(decisionId, found) },
    },
    traceId: context.traceId,
    decidedAt: context.at,
  });
  const drafts = [...ship.drafts, draft('gate_approved', { decisionId, stage: stage.key })];
  const recorded = await recordItemEvents(tx, context, item.itemId, drafts);
  return { item: recorded.item, failures: [] };
}

export async function shipUnderDelegation(
  ports: DelegatedPorts,
  tx: StoreTransaction,
  scene: DelegatedScene,
): Promise<DelegatedOutcome | null> {
  const { item, harness, stage, context, read } = scene;
  if (!delegableExit(stage) || item.gateStatus !== 'parked') return null;
  const held = heldBack(scene);
  if (held !== null) return { item, failures: [held] };
  const found = await lentInDecision(ports, tx, { delegationId: scene.delegationId, email: read.email, context });
  if (typeof found === 'string') return { item, failures: [found] };
  const gate = { item, harness, stage, approver: found.approver, context };
  const ship = await shipCheck(tx, gate, 'approve', { item, facts: read.facts }, found.lent);
  if (ship.refusal !== null) return { item, failures: reasonsOf(ship.refusal) };
  return recordDelegatedDecision(tx, scene, { found, ship });
}
```

If `recordDelegatedDecision` passes 50 lines after formatting, move the evidence object into `function decisionEvidence(scene: DelegatedScene, decided: Decided, decisionId: string): HarnessEvent['evidence']`; the `tx.gateDecisions.write.insert(` call must stay inside `recordDelegatedDecision` (Task 9's check names that function). The word `connectors` must not appear in this file.

- [ ] **Step 6: Claim and poll at a merge Ship stage**

`packages/harness/items/claim.ts`: import `delegableExit` from `../gates/delegable.ts` and `type Delegation` from `../ports.ts`.

```ts
function pickupRefusal(caller: Caller, stage: Stage): Refused | null {
  if (isAgent(caller.actor) && stage.agentPickup === 'none' && !delegableExit(stage)) {
    return refused('pickup_not_allowed', { stage: stage.key });
  }
  return null;
}

async function unlentRefusal(
  tx: StoreTransaction,
  scene: Scene,
  item: ItemState,
  delegationId: string | null,
): Promise<Refused | null> {
  const { caller, stage, context } = scene;
  if (!isAgent(caller.actor) || !delegableExit(stage) || delegationId !== null) return null;
  return recordDelegationRequired(tx, context, item.itemId, stage.key);
}

function mergeReach(stage: Stage, delegation: Delegation): Refused | null {
  if (delegation.capability === 'merge' && delegableExit(stage)) return null;
  return refused('pickup_not_allowed', { stage: stage.key, capability: delegation.capability });
}
```

In `capabilityRefusal`, after the `delegation === null` return and `const { harness, stage } = scene;`, add `if (delegation.capability === 'merge' || delegableExit(stage)) return mergeReach(stage, delegation);` before the persona page read. In `claimIn`, extend the `stale` chain: `const stale = lockedGuards(locked, item) ?? (await heldRefusal(tx, locked, item)) ?? (await unlentRefusal(tx, locked, item, input.delegationId));` (keep step 14's dispatch guard where it is).

`packages/harness/reads/poll.ts`: import `delegableExit` from `../gates/delegable.ts`.

```ts
function pickupOpen(stage: Stage, reach: ReadonlySet<CapabilityWord> | null): boolean {
  if (delegableExit(stage)) return reach !== null && reach.has('merge');
  return stage.agentPickup !== 'none' && reachable(stage, reach);
}
```

and in `claimable` replace `if (stage === undefined || stage.paused || stage.agentPickup === 'none') return false;` and the `reachable` line with `if (stage === undefined || stage.paused || !pickupOpen(stage, judged.reach)) return false;`.

- [ ] **Step 7: Submit runs the delegated exit after the park**

`packages/harness/items/submit.ts`: import `delegatedPreRead`, `delegationRequiredAtShip`, `shipUnderDelegation`, `type DelegatedRead` from `../gates/delegated-ship.ts`.

`Command` gains `readonly lent: DelegatedRead | null;`. In `submit`, after the `readFacts` refusal return:

```ts
  const lent = await delegatedPreRead(ports, caller, normalised.itemId);
  if (lent !== null && 'status' in lent) return lent;
  const command = { caller, input: normalised, facts: read.facts, lent, at: ports.clock.now() };
```

`submitGuards`' chain gains `?? (await delegationRequiredAtShip(tx, standing))` after `standingRefusal`, where `standing` is the `Standing` object `submitGuards` already receives (pass it as one value: `const standing = { caller, item, harness, stage, context }` is the argument; if `submitGuards` destructures, call it with the parameter).

Replace the last three statements of `submitIn` (`ending`, `recorded`, `return accepted(...)`) with:

```ts
  const recording = { command, scene, context, decision, attaching };
  const recorded = await recordSubmission(tx, recording);
  return accepted(await delegatedAfter(ports, tx, { ...recording, recorded }));
```

and add:

```ts
type Recording = {
  readonly command: Command;
  readonly scene: SubmitScene;
  readonly context: RecordContext;
  readonly decision: Decision;
  readonly attaching: readonly Attachment[];
};

async function recordSubmission(tx: StoreTransaction, recording: Recording): Promise<ItemState> {
  const { command, scene, context, decision, attaching } = recording;
  const { item, stage } = scene;
  const ending = await submittedRun(tx, { item, stage, decision, at: command.at });
  const recorded = await recordItemEvents(tx, context, item.itemId, [
    ...riskDraft(command, item),
    ...attaching.map((attachment) => draft('learning_attached', attachment)),
    ...decision.drafts,
    ...ending,
  ]);
  return recorded.item;
}

async function delegatedAfter(
  ports: SubmitPorts,
  tx: StoreTransaction,
  after: Recording & { readonly recorded: ItemState },
): Promise<Submitted> {
  const { command, scene, context, decision, recorded } = after;
  const delegationId = scene.item.delegationId;
  const read = command.lent;
  const shipped =
    read === null || delegationId === null
      ? null
      : await shipUnderDelegation(ports, tx, { ...scene, item: recorded, caller: command.caller, delegationId, context, read });
  return { item: shipped?.item ?? recorded, result: decision.result, failures: shipped?.failures ?? decision.failures };
}
```

`scene` is the `SubmitScene` `submitIn` reads (`item` before the park, so its `delegationId` is the claim's). If `submitIn` destructures the scene before this point, keep a reference to it.

- [ ] **Step 8: Run the tests**

Run: `pnpm check && npx vitest run sim/kernel/delegated-ship.test.ts sim/kernel/submit.test.ts sim/kernel/claim.test.ts sim/kernel/capability-brackets.test.ts sim/kernel/reads.test.ts sim/kernel/gate-command.test.ts` then `pnpm sim -- MD-4 && pnpm sim -- KN-5 && pnpm sim -- KN-6 && pnpm sim -- all`
Expected: green. KN-5 still refuses `pickup_not_allowed` at Package; KN-6 still parks at Ship for a person.

- [ ] **Step 9: Commit**

```bash
git add packages/harness sim
git commit -m "feat(harness): the delegated Ship exit records the grantor as approver

An agent holding a live merge delegation claims at a merge Ship stage
and submits; inside the submit transaction the kernel locks and re-reads
the delegation and the grantor's grants, runs the ship rule with the
delegation, and either writes one gate decision (recordDelegatedDecision:
approver the grantor, actor the agent, the delegation named) or records
ship_refused and leaves the item parked for a person. An agent at Ship
without a merge delegation is refused delegation_required. Nothing
merges yet.

MD-3 MD-4. S16-R1 S16-R2 S16-R3 S16-R6."
```

---

### Task 8: MD-3, the delegated Ship exit's merge: the minute job's kernel command, the guard, the record, and a joined pull request

**Files:**
- Create: `packages/harness/gates/delegated-exits.ts`
- Modify: `packages/harness/gates/commands.ts` (`GateCommands.exitDelegated`)
- Modify: `packages/harness/gates/approve-at-ship.ts` (`ShipPorts` gains `grants`; `standingAtExit`; the exit guard uses it)
- Modify: `packages/harness/gates/exit.ts` (`recordIn` appends `delegated_merge` with a delegated success)
- Modify: `packages/harness/gates/recover.ts` (export `CONNECTOR_TIMEOUT_MS`; `DecidedRoute.delegated`; `delegatedOf`; `stuckAt`)
- Modify: `apps/uw-app/github/merge.ts` (`Target.joined`, `identityRefusal`)
- Modify: `apps/uw-app/github/merge.test.ts` (one block)
- Create: `sim/kernel/delegated-exit.test.ts`
- Create: `sim/scenarios/MD-3.an-agent-merges-under-a-delegation-and-the-grantor-is-the-approver.ts`

**Interfaces:**
- Consumes: Task 7's `lentAtExit`, `simAtShip`, `simLendMerge`; Task 4's `gateDecisions.read.delegatedSince`, `ExitInput.delegated`, `ConnectorRequest.joined`; step 15's `exitAfterDecision`, `PendingExit`, `ExitGuard`.
- Produces: `exitDelegated(ports: DelegatedExitPorts, caller: Caller, input: { readonly limit: number }): Promise<KernelOutcome<DelegatedExits>>` with `DelegatedExits = { readonly exited: readonly { readonly itemId: string; readonly advanced: boolean }[] }`; `GateCommands.exitDelegated(caller, input)`; `CONNECTOR_TIMEOUT_MS` exported from `recover.ts`.

- [ ] **Step 1: Write the failing tests**

`sim/kernel/delegated-exit.test.ts`:

```ts
import type { ItemState, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simSystem } from '../fixtures.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  simAtShip,
  simLendMerge,
  simSha,
  standardChange,
  type MergeLoan,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly admin: Principal;
  readonly harnessId: string;
  readonly item: ItemState;
  readonly loan: MergeLoan;
};

const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', standardChange.head, 9300000001)];

async function decided(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const input = { harnessId: harness.id, editor: admin, title: 'Show the board', change: standardChange };
    const item = await simAtShip(world, input);
    world.adapters.githubFacts.given(greenFacts(world, { itemId: item.itemId, head: standardChange.head, reviews }));
    const loan = await simLendMerge(world, admin, { harnessId: harness.id, maxTier: 'standard' });
    const caller = simCaller(world, loan.agent);
    await world.kernel.items.claim(caller, { itemId: item.itemId, delegationId: loan.delegationId });
    const submitted = await world.kernel.items.submit(caller, { itemId: item.itemId, to: null, evidence: {}, change: null });
    expect(submitted).toMatchObject({ status: 'accepted', value: { failures: [] } });
    await work({ world, admin, harnessId: harness.id, item, loan });
  } finally {
    await world.close();
  }
}

function runExits(scene: Scene, actor: Principal = simSystem()) {
  return scene.world.kernel.gates.exitDelegated(simCaller(scene.world, actor), { limit: 20 });
}

function names(scene: Scene) {
  return itemLog(scene.world, scene.harnessId, scene.item.itemId).then((log) => log.events.map((event) => event.name));
}

function lastEvent(scene: Scene) {
  return itemLog(scene.world, scene.harnessId, scene.item.itemId).then((log) => log.events.at(-1));
}

describe('MD-3 the minute job merges a delegated decision after running the ship rule again', () => {
  it('MD-3 merges the evaluated head and records delegated_merge with the merge, naming the grantor', () =>
    decided(async (scene) => {
      expect(await runExits(scene)).toEqual({
        status: 'accepted',
        value: { exited: [{ itemId: scene.item.itemId, advanced: true }] },
      });
      const [call, ...more] = scene.world.adapters.connectors.calls();
      expect(more).toEqual([]);
      expect(call).toMatchObject({ connector: 'merge', expectedHead: standardChange.head, joined: false });
      const after = await names(scene);
      const merged = after.indexOf('connector_succeeded');
      expect(after.slice(merged, merged + 3)).toEqual(['connector_succeeded', 'delegated_merge', 'stage_advanced']);
      const log = await itemLog(scene.world, scene.harnessId, scene.item.itemId);
      expect(log.events.find((event) => event.name === 'delegated_merge')?.evidence).toMatchObject({
        delegationId: scene.loan.delegationId,
        personId: scene.admin.personId,
        email: scene.admin.email,
        persona: scene.loan.agent.identity,
        maxTier: 'standard',
      });
    }));

  it('MD-3 only the system principal runs it', () =>
    decided(async (scene) => {
      expect(await runExits(scene, scene.admin)).toMatchObject({ status: 'error', reason: 'not_permitted' });
      expect(await runExits(scene, scene.loan.agent)).toMatchObject({ status: 'error', reason: 'not_permitted' });
      expect(scene.world.adapters.connectors.calls()).toEqual([]);
    }));

  it('MD-3 a second run exits nothing, and the merge ran once', () =>
    decided(async (scene) => {
      await runExits(scene);
      expect(await runExits(scene)).toEqual({ status: 'accepted', value: { exited: [] } });
      expect(scene.world.adapters.connectors.calls()).toHaveLength(1);
    }));

  it('MD-3 a delegation revoked after the decision stops the merge', () =>
    decided(async (scene) => {
      await scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.admin), {
        delegationId: scene.loan.delegationId,
      });
      expect(await runExits(scene)).toEqual({
        status: 'accepted',
        value: { exited: [{ itemId: scene.item.itemId, advanced: false }] },
      });
      expect(scene.world.adapters.connectors.calls()).toEqual([]);
      expect(await lastEvent(scene)).toMatchObject({
        name: 'connector_refused',
        evidence: { connector: 'merge', reason: 'delegation_lapsed' },
      });
    }));

  it('MD-3 a head moved after the decision is refused by the second run of the rule', () =>
    decided(async (scene) => {
      const moved = greenFacts(scene.world, { itemId: scene.item.itemId, head: simSha('c0de'), reviews });
      scene.world.adapters.githubFacts.given(moved);
      await runExits(scene);
      expect(scene.world.adapters.connectors.calls()).toEqual([]);
      expect((await lastEvent(scene))?.evidence['reason']).toMatch(/^ship_rule_refused: .*head_mismatch/);
    }));

  it('MD-3 past fifteen minutes the job leaves the decision to a person', () =>
    decided(async (scene) => {
      scene.world.adapters.clock.advance(16 * 60_000);
      expect(await runExits(scene)).toEqual({ status: 'accepted', value: { exited: [] } });
      expect(scene.world.adapters.connectors.calls()).toEqual([]);
    }));
});
```

If `simAgent`'s identity for persona `shipper` is not `agent:shipper` (read `simAgent`), the `persona` assertion uses the delegation's persona, `'agent:shipper'`. If the moved-head case's reason names more reasons first, the regular expression still matches.

`sim/scenarios/MD-3.an-agent-merges-under-a-delegation-and-the-grantor-is-the-approver.ts` (id `'MD-3'`, the same import rules as Task 7's MD-4 scenario): the first case above end to end, asserting with `assert.deepEqual` the decision row's `actor`, `agentActor` and `delegationId`, then that `exitDelegated` as `simSystem()` advanced the item and the connector was called once; return `{ state: { approver, actor, merged } }`.

`apps/uw-app/github/merge.test.ts`, append:

```ts
describe('MD-3 the merge connector merges a joined pull request at its own head ref, pinned to the evaluated head', () => {
  const joined = { ...request, joined: true };
  const contributor = 'feature/login-form';

  it('MD-3 merges a joined pull request whose head ref is the contributor branch, with the sha guard', async () => {
    const github = openGitHub(pullAt({ ref: contributor }));
    expect(await mergeOver(app, github).run(joined)).toEqual(succeeded('false'));
    expect(github.requests().find((entry) => entry.method === 'PUT')?.body).toMatchObject({
      sha: request.expectedHead,
    });
  });

  it('MD-3 still refuses a joined pull request from a fork and one whose head moved, writing nothing', async () => {
    const fork = openGitHub(pullAt({ ref: contributor, headRepo: 'someone/uw-platform' }));
    expect(await mergeOver(app, fork).run(joined)).toEqual(refusedFor('head_repository_mismatch'));
    const moved = openGitHub(pullAt({ ref: contributor, head: otherHead }));
    expect(await mergeOver(app, moved).run(joined)).toEqual(refusedFor('head_mismatch'));
    expect([...writesOf(fork), ...writesOf(moved)]).toEqual([]);
  });

  it('MD-3 an item with a harness branch is still refused head_ref_mismatch at a foreign ref', async () => {
    const github = openGitHub(pullAt({ ref: contributor }));
    expect(await mergeOver(app, github).run(request)).toEqual(refusedFor('head_ref_mismatch'));
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run sim/kernel/delegated-exit.test.ts apps/uw-app/github/merge.test.ts`
Expected: FAIL; `kernel.gates.exitDelegated` does not exist and a joined request is refused `head_ref_mismatch`.

- [ ] **Step 3: The record and the guard**

`packages/harness/gates/exit.ts`, in `recordIn`, replace the line that records the outcomes with:

```ts
  const outcomes = open.map((entry) => outcomeDraft(entry.input.connector, entry.outcome));
  const merged = advancing?.input.delegated ?? null;
  const told = merged === null ? [] : [draft('delegated_merge', { ...merged })];
  await recordItemEvents(tx, context, itemId, [...outcomes, ...told, ...exit]);
```

`packages/harness/gates/approve-at-ship.ts`: `ShipPorts` becomes `Pick<Ports, 'githubFacts' | 'grants' | 'store'> & ExitPorts`. Import `lentAtExit`, `type NotLent` from `./lent.ts` and `type ShipDelegation` from `./ship-input.ts`. Add:

```ts
type ExitStanding = { readonly approver: Principal; readonly delegation: ShipDelegation | null };

async function standingAtExit(ports: ShipPorts, pending: PendingExit): Promise<ExitStanding | NotLent> {
  if (pending.delegated === null) return { approver: pending.approver, delegation: null };
  const found = await lentAtExit(ports, pending.delegated, pending.context.at);
  return typeof found === 'string' ? found : { approver: found.approver, delegation: found.lent };
}
```

and in step 15's `exitGuard`, after the `'unavailable'` return:

```ts
    const standing = await standingAtExit(ports, pending);
    if (typeof standing === 'string') return { refused: standing };
    const { item, harness, override, context } = pending;
    const source = { facts, item, harness, approver: standing.approver, at: context.at, override };
    const input = assembleShipInput({ ...source, delegation: standing.delegation });
```

replacing step 15's destructuring and `assembleShipInput` call (the rest of the guard is unchanged). Callers of `exitAfterDecision` pass ports that hold `grants` already (`GatePorts`).

`packages/harness/gates/recover.ts`: `const CONNECTOR_TIMEOUT_MS` becomes `export const CONNECTOR_TIMEOUT_MS`. Import `delegatedMergeSchema`, `type DelegatedMerge` from `@uw/contracts`. `DecidedRoute` gains `readonly delegated: DelegatedMerge | null;`. Add:

```ts
function delegatedOf(row: GateDecisionRow): DelegatedMerge | null {
  if (row.delegationId === null) return null;
  const parsed = delegatedMergeSchema.safeParse(row.evidence['delegation']);
  return parsed.success ? parsed.data : null;
}
```

`decidedConnectors` adds `delegated: delegatedOf(row)` to each entry; `stuckAt`'s returned object replaces Task 4's `delegated: null` with `delegated: recorded?.delegated ?? null,`. A person's recovery of a delegated merge that GitHub made records `delegated_merge` too.

- [ ] **Step 4: The minute job's kernel command**

`packages/harness/gates/delegated-exits.ts`:

```ts
import { delegatedMergeSchema, type DelegatedMerge, type Harness, type ItemState, type Stage } from '@uw/contracts';
import { personPrincipal } from '@uw/core/principal';
import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { fullSha } from '../github/identifiers.ts';
import { readAllEvents, recordContext, type RecordContext } from '../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { DecidedBase, GateDecisionRow, Ports, StoreTransaction } from '../ports.ts';
import { exitAfterDecision, type PendingExit } from './approve-at-ship.ts';
import type { ExitPorts } from './exit.ts';
import { outcomeRecordedSince, parkingChangedSince } from './parking.ts';
import { CONNECTOR_TIMEOUT_MS } from './recover.ts';

export type DelegatedExitPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'ids' | 'store'> &
  ExitPorts;

export type DelegatedExit = { readonly itemId: string; readonly advanced: boolean };
export type DelegatedExits = { readonly exited: readonly DelegatedExit[] };

const LIMIT_MAX = 50;

type Placed = {
  readonly item: ItemState;
  readonly harness: Harness;
  readonly stage: Stage;
  readonly next: Stage | null;
};

async function placedFor(tx: StoreTransaction, row: GateDecisionRow): Promise<Placed | null> {
  const item = await tx.harnessItems.read.byId(row.itemId);
  const harness = await tx.harnesses.read.byId(row.harnessId);
  if (item === null || harness === null || item.gateStatus !== 'parked') return null;
  const events = await readAllEvents(tx, row.harnessId, row.itemId);
  if (outcomeRecordedSince(events, row.id) || parkingChangedSince(events, row.id)) return null;
  const stages = await tx.harnessStages.read.forHarness(row.harnessId);
  const stage = stages.find((entry) => entry.id === row.stageId);
  if (stage === undefined || stage.key !== item.stageKey) return null;
  const nextKey = row.evidence['next'];
  return { item, harness, stage, next: stages.find((entry) => entry.key === nextKey) ?? null };
}

function pendingOf(
  placed: Placed,
  row: GateDecisionRow,
  delegated: DelegatedMerge,
  context: RecordContext,
): PendingExit {
  const head = row.evidence['head'];
  const { item, harness, stage, next } = placed;
  const approver = personPrincipal({ personId: delegated.personId, email: delegated.email, grants: [], interactive: false });
  return {
    item,
    stage,
    connector: 'merge',
    next,
    decisionId: row.id,
    overrideReason: null,
    repository: harness.repository,
    expectedBase: null,
    evaluatedHead: typeof head === 'string' ? head : item.expectedHead,
    harness,
    approver,
    override: false,
    context,
    delegated,
  };
}

async function baseNow(ports: DelegatedExitPorts, item: ItemState): Promise<DecidedBase | null> {
  if (item.pullRequest === null) return null;
  try {
    const facts = await ports.githubFacts.refresh(item.pullRequest);
    const sha = facts === null ? null : fullSha(facts.base);
    return facts === null || sha === null ? null : { sha, ref: facts.baseRef };
  } catch {
    return null;
  }
}

async function exitOne(
  ports: DelegatedExitPorts,
  row: GateDecisionRow,
  context: RecordContext,
): Promise<DelegatedExit | null> {
  const delegated = delegatedMergeSchema.safeParse(row.evidence['delegation']);
  if (!delegated.success) return null;
  const placed = await ports.store.transaction((tx) => placedFor(tx, row));
  if (placed === null) return null;
  const pending = { ...pendingOf(placed, row, delegated.data, context), expectedBase: await baseNow(ports, placed.item) };
  const exited = await exitAfterDecision(ports, pending);
  return { itemId: placed.item.itemId, advanced: exited.advanced };
}

export async function exitDelegated(
  ports: DelegatedExitPorts,
  caller: Caller,
  input: { readonly limit: number },
): Promise<KernelOutcome<DelegatedExits>> {
  if (!isSystemPrincipal(caller.actor)) return refused('not_permitted', { actor: caller.actor.identity });
  const at = ports.clock.now();
  const since = new Date(at.getTime() - CONNECTOR_TIMEOUT_MS);
  const limit = Math.max(1, Math.min(input.limit, LIMIT_MAX));
  const rows = await ports.store.transaction((tx) => tx.gateDecisions.read.delegatedSince(since, limit));
  const context = recordContext(ports, caller, at);
  const exited: DelegatedExit[] = [];
  for (const row of rows) {
    const one = await exitOne(ports, row, context);
    if (one !== null) exited.push(one);
  }
  return accepted({ exited });
}
```

The word `connectors` must not appear in this file (`ExitPorts` carries the port). If `parkingChangedSince` is not exported from `parking.ts`, it is (it is used by `exit.ts`); if `PendingExit` after step 15 has a field this literal does not set, `pnpm check` names it: set it as `decide.ts`'s `pendingExit` does for an approval with no override.

`packages/harness/gates/commands.ts`: import `exitDelegated`, `type DelegatedExits` from `./delegated-exits.ts`; `GateCommands` gains

```ts
  exitDelegated(
    caller: Caller,
    input: { readonly limit: number },
  ): Promise<KernelOutcome<DelegatedExits>>;
```

and `createGateCommands` gains `exitDelegated: (caller, input) => exitDelegated(ports, caller, input),`. `packages/harness/index.ts`: export type `DelegatedExits`.

- [ ] **Step 5: The merge connector accepts a joined pull request's own ref**

`apps/uw-app/github/merge.ts`: `Target` gains `readonly joined: boolean;`; `targetOf` returns `{ ...pullRequest, itemId, head, base, repository, title, overrideReason, joined: request.joined }`; `identityRefusal` becomes:

```ts
function identityRefusal(target: Target, live: Live): Refusal | null {
  if (live.headRepo === null || !sameRepository(live.headRepo, target.repository)) {
    return refusal('head_repository_mismatch');
  }
  if (!target.joined && live.headRef !== tagOf(target)) return refusal('head_ref_mismatch');
  return null;
}
```

Nothing else in the file changes: the merge still sends `sha: target.head` (the evaluated head), still requires the default branch and the decided base, and still tags `harness/<item>`.

- [ ] **Step 6: Run the tests**

Run: `pnpm check && npx vitest run sim/kernel/delegated-exit.test.ts sim/kernel/delegated-ship.test.ts sim/kernel/merge-recheck.test.ts sim/kernel/exit-guard.test.ts sim/kernel/recover.test.ts sim/kernel/gate-command.test.ts tools/architecture/connector-callers.test.ts apps/uw-app/github/merge.test.ts` then `pnpm sim -- MD-3 && pnpm sim -- SR-3 && pnpm sim -- all`
Expected: green. `connector-callers` passes unchanged: `exitThroughConnector(` is still called only in `approve-at-ship.ts` and `exit.ts`, and the new files never name the connectors port.

- [ ] **Step 7: Commit**

```bash
git add packages/harness apps/uw-app/github sim
git commit -m "feat(harness): the minute job merges a delegated decision after checking it again

gates.exitDelegated, for the system principal only, takes delegated
decisions of the last fifteen minutes with no connector outcome and runs
the stage exit, whose guard re-checks the delegation and the grantor's
admin and runs the ship rule again. A merge records delegated_merge with
connector_succeeded. The merge connector accepts a joined pull request's
own head ref, still pinned to the evaluated head, the harness repository
and the default branch.

MD-3. S16-R4 S16-R9 S16-R10."
```

---

### Task 9: MD-5, the agent-boundary checks learn the one path; then the minute job runs it

**Files:**
- Create (shared-root commit): `tools/architecture/gate-writers.ts`, `tools/architecture/gate-writers.test.ts`
- Modify (shared-root commit): `tools/architecture/agent-boundary.ts` (`delegatedExitRoot`, `withoutDelegatedExitCall` in `gateTouches`), `tools/architecture/connector-callers.test.ts` (the two GH-6 lists), `tools/architecture/cruise/shared.mjs` (`readRoots`, `appConfigRoots`), `docs/exceptions.md` (one row), `docs/architecture.md` (the `gate_decisions` row and the AB-7 static row)
- Create (feature commit): `apps/uw-app/cron/delegated-exits.ts`, `apps/uw-app/cron/delegated-exits.pg.test.ts`
- Modify (feature commit): `apps/uw-app/cron/minute.ts` (one step)

**Interfaces:**
- Produces: `gateWriteSites(sources: SourceFiles): WriteSite[]` with `WriteSite = { readonly file: string; readonly fn: string }`; `agentKernelClosure(sources: SourceFiles): string[]`; `gateWriteViolations(sources: SourceFiles): string[]`; `PERSON_WRITER`, `DELEGATED_WRITER`; `runDelegatedExits(run: DelegatedRun)`, `exitDelegatedMerges(kernel, run)`, `delegatedExitKernel(run, github)`, `cronShipGitHub(env, clock)` in `apps/uw-app/cron/delegated-exits.ts`.

- [ ] **Step 1: Write the failing checks and their planted cases**

`tools/architecture/gate-writers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { agentReachable, gateTouches, repoSources, type SourceFiles } from './agent-boundary.ts';
import { agentKernelClosure, gateWriteSites, gateWriteViolations } from './gate-writers.ts';

const real = repoSources();
const delegatedShip = 'packages/harness/gates/delegated-ship.ts';
const cronRoot = 'apps/uw-app/cron/delegated-exits.ts';
const sneakVerb = 'apps/uw-app/mcp/verbs/merge-sneak.ts';

function withPlanted(planted: Readonly<Record<string, string>>): SourceFiles {
  const texts = new Map(Object.entries(planted));
  const added = [...texts.keys()].filter((file) => !real.files.includes(file));
  return { files: [...real.files, ...added], read: (file) => texts.get(file) ?? real.read(file) };
}

function violationsWith(planted: Readonly<Record<string, string>>): string[] {
  return gateWriteViolations(withPlanted(planted));
}

function touchedWith(planted: Readonly<Record<string, string>>): string[] {
  const sources = withPlanted(planted);
  return gateTouches(sources, agentReachable(sources));
}

const writer = (name: string, body: string) =>
  `export async function ${name}(tx: Tx, row: Row): Promise<void> {\n  ${body}\n}\n`;

describe('MD-5 exactly two named functions write a gate decision, and agent verbs reach only the delegated one', () => {
  it('MD-5 finds the gate command and the delegated Ship exit and nothing else on the tree', () => {
    expect(gateWriteSites(real)).toEqual([
      { file: 'packages/harness/gates/decide.ts', fn: 'recordDecision' },
      { file: delegatedShip, fn: 'recordDelegatedDecision' },
    ]);
    expect(gateWriteViolations(real)).toEqual([]);
  });

  it('MD-5 the closure of the item, run and read commands holds the delegated exit and never the person writer', () => {
    const closure = agentKernelClosure(real);
    expect(closure).toContain(delegatedShip);
    expect(closure).toContain('packages/harness/items/submit.ts');
    expect(closure).not.toContain('packages/harness/gates/decide.ts');
    expect(closure).not.toContain('packages/harness/gates/commands.ts');
  });

  it('MD-5 the minute job may call exactly kernel.gates.exitDelegated, from exactly its own file', () => {
    expect(touchedWith({})).toEqual([]);
  });
});

describe('MD-5 a planted second delegated writer fails', () => {
  it('MD-5 flags a second delegated writer an agent verb reaches', () => {
    const planted = {
      'packages/harness/items/fast-ship.ts': writer('fastShip', 'await tx.gateDecisions.write.insert({ ...row, delegationId: row.id });'),
    };
    expect(violationsWith(planted)).toEqual([
      'packages/harness/items/fast-ship.ts writes gate_decisions in fastShip',
      'an agent verb reaches the gate_decisions write in packages/harness/items/fast-ship.ts#fastShip',
    ]);
  });

  it('MD-5 flags a second function writing in the delegated exit\'s own file', () => {
    const planted = { [delegatedShip]: `${real.read(delegatedShip)}\n${writer('shipAgain', 'await tx.gateDecisions.write.insert(row);')}` };
    expect(violationsWith(planted)).toContain(`${delegatedShip} writes gate_decisions in shipAgain`);
  });

  it.each([
    ['aliased', 'const decisions = tx.gateDecisions;\n  await decisions.write.insert(row);'],
    ['bracketed', "await tx.gateDecisions['write'].insert(row);"],
    ['destructured', 'const { write } = tx.gateDecisions;\n  await write.insert(row);'],
    ['raw', 'await sql`INSERT INTO gate_decisions VALUES (${row.id})`;'],
  ])('MD-5 flags a %s write anywhere in the kernel', (_form, body) => {
    const planted = { 'packages/harness/stages/stray.ts': writer('stray', body) };
    expect(violationsWith(planted)).toContain('packages/harness/stages/stray.ts writes gate_decisions in stray');
  });

  it('MD-5 flags an item command importing the person writer', () => {
    const planted = { 'packages/harness/items/shortcut.ts': "import { decide } from '../gates/decide.ts';\nexport const shortcut = decide;\n" };
    expect(violationsWith(planted)).toContain('an agent verb reaches packages/harness/gates/decide.ts');
  });

  it('MD-5 flags the exit call anywhere but the minute job\'s file, and any other gate call in that file', () => {
    const call = 'await kernel.gates.exitDelegated(caller, { limit: 50 });';
    const elsewhere = 'apps/uw-app/cron/other-exits.ts';
    expect(touchedWith({ [sneakVerb]: call })).toEqual([sneakVerb]);
    expect(touchedWith({ [sneakVerb]: "import '../../cron/other-exits.ts';", [elsewhere]: call })).toEqual([elsewhere]);
    const widened = `${call}\nawait kernel.gates.decide(caller, input);`;
    expect(touchedWith({ [sneakVerb]: "import '../../cron/delegated-exits.ts';", [cronRoot]: widened })).toEqual([cronRoot]);
    expect(touchedWith({ [sneakVerb]: "import '../../cron/delegated-exits.ts';", [cronRoot]: call })).toEqual([]);
  });
});
```

The tree assertions ("finds ... on the tree", "the minute job may call ...") pass only after the feature commit below adds `apps/uw-app/cron/delegated-exits.ts`; until then the cron file does not exist and they pass trivially. If `touchedWith({})` is not `[]` on the real tree, a real file fails AB-7: find it before going on.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tools/architecture/gate-writers.test.ts`
Expected: FAIL; `./gate-writers.ts` does not exist.

- [ ] **Step 3: The kernel check**

`tools/architecture/gate-writers.ts`:

```ts
import { importsOf, type SourceFiles } from './agent-boundary.ts';

export type WriteSite = { readonly file: string; readonly fn: string };

export const PERSON_WRITER: WriteSite = {
  file: 'packages/harness/gates/decide.ts',
  fn: 'recordDecision',
};
export const DELEGATED_WRITER: WriteSite = {
  file: 'packages/harness/gates/delegated-ship.ts',
  fn: 'recordDelegatedDecision',
};

const scannedRoots = ['apps/', 'packages/', 'sim/'];
const unscannedRoots = ['packages/db/', 'packages/harness/port-contracts/'];
const agentSeeds = ['packages/harness/items/', 'packages/harness/runs/', 'packages/harness/reads/'];
const sourceFile = /\.(?:tsx?|m?js)$/;
const testFile = /\.test\.(?:tsx?|m?js)$/;

const writes = [
  /\bgateDecisions\s*\??\.\s*write\b/g,
  /\bgateDecisions\s*\??\.?\s*\[\s*['"`]write['"`]\s*\]/g,
  /\.insert\(\s*(?:\w+\.)?gateDecisions\b/g,
  /\bINSERT\s+INTO\s+"?gate_decisions"?/gi,
  /\{[^{}]*\bwrite\b[^{}]*\}\s*=\s*[\w.?]*\bgateDecisions\b/g,
  /=\s*[\w.?]*\bgateDecisions\s*[;,)\n]/g,
];
const declarations = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*[=:]/gm;

function scanned(file: string): boolean {
  return (
    scannedRoots.some((root) => file.startsWith(root)) &&
    !unscannedRoots.some((root) => file.startsWith(root)) &&
    sourceFile.test(file) &&
    !testFile.test(file) &&
    !file.includes('node_modules/')
  );
}

function enclosing(text: string, index: number): string {
  let name = '<module>';
  for (const match of text.matchAll(declarations)) {
    if (match.index > index) break;
    name = match[1] ?? match[2] ?? name;
  }
  return name;
}

function sitesIn(file: string, text: string): WriteSite[] {
  const found = writes.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match.index));
  return [...new Set(found.map((index) => enclosing(text, index)))].map((fn) => ({ file, fn }));
}

const keyOf = (site: WriteSite) => `${site.file}#${site.fn}`;

export function gateWriteSites(sources: SourceFiles): WriteSite[] {
  return sources.files
    .filter(scanned)
    .flatMap((file) => sitesIn(file, sources.read(file)))
    .sort((left, right) => keyOf(left).localeCompare(keyOf(right)));
}

export function agentKernelClosure(sources: SourceFiles): string[] {
  const known = new Set(sources.files.filter((file) => file.startsWith('packages/harness/') && scanned(file)));
  const pending = [...known].filter((file) => agentSeeds.some((seed) => file.startsWith(seed)));
  const reached = new Set(pending);
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    for (const target of importsOf(file, sources.read(file))) {
      if (known.has(target) && !reached.has(target)) {
        reached.add(target);
        pending.push(target);
      }
    }
  }
  return [...reached].sort();
}

const same = (left: WriteSite, right: WriteSite) => keyOf(left) === keyOf(right);

export function gateWriteViolations(sources: SourceFiles): string[] {
  const sites = gateWriteSites(sources);
  const closure = new Set(agentKernelClosure(sources));
  const stray = sites
    .filter((site) => !same(site, PERSON_WRITER) && !same(site, DELEGATED_WRITER))
    .map((site) => `${site.file} writes gate_decisions in ${site.fn}`);
  const reached = sites
    .filter((site) => closure.has(site.file) && !same(site, DELEGATED_WRITER))
    .map((site) => `an agent verb reaches the gate_decisions write in ${keyOf(site)}`);
  const person = closure.has(PERSON_WRITER.file) ? [`an agent verb reaches ${PERSON_WRITER.file}`] : [];
  return [...stray, ...reached, ...person];
}
```

`importsOf` and `SourceFiles` are already exported from `tools/architecture/agent-boundary.ts`. If `match.index` types as `number | undefined` under the repository's TypeScript lib, map with `match.index ?? 0`.

- [ ] **Step 4: AB-7 allows exactly the minute job's call**

`tools/architecture/agent-boundary.ts`, beside `personSurfaceCalls`:

```ts
const delegatedExitRoot = 'apps/uw-app/cron/delegated-exits.ts';
const delegatedExitCall = /\bkernel\s*\.\s*gates\s*\.\s*exitDelegated\s*\(/g;

function withoutDelegatedExitCall(file: string, text: string): string {
  return file === delegatedExitRoot ? text.replaceAll(delegatedExitCall, '(') : text;
}
```

and in `gateTouches`:

```ts
      const stripped = withoutPersonSurfaceCalls(file, withoutModulePaths(sources.read(file)));
      const text = withoutDelegatedExitCall(file, stripped);
```

- [ ] **Step 5: GH-6 and dependency-cruiser name the one more GitHub-wired root**

`tools/architecture/connector-callers.test.ts`: add `const delegatedExitRoot = 'apps/uw-app/cron/delegated-exits.ts';`. In `GH-6 the only kernel built with GitHub reads or the ship writes is the gate kernel`, add `delegatedExitRoot` to the expected list (keep it sorted; rename the title to `GH-6 MD-5 the only kernels built with GitHub reads or the ship writes are the gate kernel, the run host and the delegated exit job`). In `GH-6 the queue and cron roots name no ship or read wiring`, filter it out: `const roots = readOnlyRootFiles(sources()).filter((file) => file !== delegatedExitRoot);` (the planted `apps/uw-app/cron/n.ts` case still fails, so any other cron file stays read-only).

`tools/architecture/cruise/shared.mjs`: add `export const delegatedExitJob = '^apps/uw-app/cron/delegated-exits\\.ts$';`; append it to `readRoots`; change `appConfigRoots`' first entry to `'^apps/uw-app/(queue/worker|cron/github-sweep|cron/delegated-exits)\\.ts$'`. If `tools/architecture/planted-cruise.ts` asserts these lists, update its expectation the same way.

`docs/exceptions.md`, a new row after the 2026-10-03 AB-7 row:

```markdown
| 2026-10-15 | Section 10: no agent identity can approve or merge past a human gate, as enforced by AB-7 (no gate call in the import closure of `apps/uw-app/index.ts`) and GH-6 (no GitHub-wired kernel in a cron root) | `apps/uw-app/cron/delegated-exits.ts`, `tools/architecture/agent-boundary.ts`, `tools/architecture/connector-callers.test.ts`, `tools/architecture/cruise/shared.mjs` | A merge under a delegation (ADR 0010) runs after the agent's request, from the minute job, which needs a kernel wired with GitHub and one call into `kernel.gates`. AB-7 allows exactly `kernel.gates.exitDelegated(` in exactly that file, and GH-6 and dependency-cruiser name that file as the one cron root holding GitHub wiring. The rule still holds at runtime: `exitDelegated` refuses every principal but the system's, only exits a decision the delegated Ship exit already recorded, and re-checks the delegation and the ship rule before the merge. The agent's request never holds a GitHub write client. | ADR 0010; S16-R4, S16-R11 |
```

`docs/architecture.md`: in the tables row for `gate_decisions` (line ~101), the writer becomes `the gate command for human principals, and the delegated Ship exit (ADR 0010)`; in the AB-7 table's Static row append: ` Since step 16, a second check (\`tools/architecture/gate-writers.ts\`) allows exactly two functions to write \`gate_decisions\`, \`recordDecision\` and \`recordDelegatedDecision\`, and the closure of the item, run and read commands must reach only the second; and \`kernel.gates.exitDelegated(…)\` is allowed in exactly \`apps/uw-app/cron/delegated-exits.ts\` (ADR 0010).`

- [ ] **Step 6: Run the checks and commit (shared root `tools/architecture`)**

Run: `npx vitest run tools/architecture && pnpm architecture`
Expected: green; the planted cases fail as written.

```bash
git add tools/architecture docs/exceptions.md docs/architecture.md
git commit -m "test(architecture): MD-5, the agent-boundary checks allow the one delegated path by name

Shared root tools/architecture. A new check finds every write of
gate_decisions and allows exactly recordDecision and
recordDelegatedDecision; the agent verbs' kernel closure reaches only
the second. AB-7 allows exactly kernel.gates.exitDelegated in exactly
the minute job's delegated-exits file, and GH-6 and dependency-cruiser
name that file as the one cron root holding GitHub wiring. A planted
second delegated writer, an aliased, bracketed, destructured or raw
write, an item command importing the person writer, and the call in any
other file all fail. The exception row is written before the code.

MD-5. S16-R4 S16-R11."
```

- [ ] **Step 7: Write the failing job test**

`apps/uw-app/cron/delegated-exits.pg.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@uw/core/log';
import { systemPrincipal } from '@uw/core/principal';
import { agentOf, kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { ian } from '../testing/commands.ts';
import { exitDelegatedMerges } from './delegated-exits.ts';

type Line = Record<string, unknown>;

function loggerInto(lines: Line[]) {
  const context = { traceId: randomUUID(), commit: 'test', route: 'cron minute', principal: null };
  return createLogger(context, (line: string) => lines.push(JSON.parse(line) as Line));
}

describe.skipIf(!testServer)('MD-3 the minute job runs the delegated exits as the system', () => {
  it('MD-3 runs exitDelegated as the system and logs what it exited', () =>
    withAppDatabase(async (db) => {
      const lines: Line[] = [];
      const kernel = kernelOn(db, { now: () => new Date() });
      const caller = { actor: systemPrincipal(), traceId: randomUUID(), requestId: null };
      await exitDelegatedMerges(kernel, { caller, logger: loggerInto(lines) });
      expect(lines.at(-1)).toMatchObject({ step: 'delegated_exits', outcome: 'delegated_exits_run', exited: 0, merged: 0 });
    }));

  it('MD-3 logs a refusal for any other caller and exits nothing', () =>
    withAppDatabase(async (db) => {
      const lines: Line[] = [];
      const kernel = kernelOn(db, { now: () => new Date() });
      const caller = { actor: agentOf(await ian(db)), traceId: randomUUID(), requestId: null };
      await exitDelegatedMerges(kernel, { caller, logger: loggerInto(lines) });
      expect(lines.at(-1)).toMatchObject({ step: 'delegated_exits', outcome: 'not_permitted' });
    }));
});
```

Read `apps/uw-app/testing/kernel.ts` for `agentOf`'s signature and `packages/core/log` for `createLogger`'s sink type and the field the logger writes the fields under; adapt the two `toMatchObject` paths to it (the minute job's own test, `apps/uw-app/cron/minute.pg.test.ts`, reads its lines the same way). The kernel path itself is proven in the sim (Task 8) and the merge connector in `apps/uw-app/github/merge.test.ts`; the GitHub-wired run against a real repository is GL-1's (Task 11 records it under Not verified).

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/cron/delegated-exits.pg.test.ts`
Expected: FAIL, `./delegated-exits.ts` not found.

- [ ] **Step 8: The job**

`apps/uw-app/cron/delegated-exits.ts`:

```ts
import { errorFields, type Logger } from '@uw/core/log';
import type { Caller, Clock, Kernel } from '@uw/harness';
import type { DatabaseHandle } from '../database.ts';
import type { Bindings } from '../env.ts';
import { githubAppOf } from '../github/app-config.ts';
import { createGitHubReads } from '../github/client.ts';
import { platformGitHubTransport } from '../github/transport.ts';
import { hubWiring, platformKernel, type LiveWiring } from '../kernel.ts';
import type { ShipGitHub } from '../ports/connectors.ts';

const EXIT_LIMIT = 50;
const STEP = 'delegated_exits';

export type DelegatedRun = {
  readonly database: DatabaseHandle;
  readonly env: Bindings;
  readonly clock: Clock;
  readonly live: LiveWiring;
  readonly caller: Caller;
  readonly logger: Logger;
};

export function cronShipGitHub(env: Bindings, clock: Clock): ShipGitHub | null {
  const app = githubAppOf(env);
  return app === null ? null : { app, transport: platformGitHubTransport(() => clock.now()) };
}

export function delegatedExitKernel(run: DelegatedRun, github: ShipGitHub): Kernel {
  const reads = { open: () => createGitHubReads(github.app, github.transport), logger: run.logger };
  const wiring = hubWiring(run.live.hub, { runs: run.live.runs, notifier: run.live.notifier });
  return platformKernel(run.database, run.clock, { ...wiring, reads, ship: github });
}

export async function exitDelegatedMerges(
  kernel: Kernel,
  run: Pick<DelegatedRun, 'caller' | 'logger'>,
): Promise<void> {
  const outcome = await kernel.gates.exitDelegated(run.caller, { limit: EXIT_LIMIT });
  if (outcome.status !== 'accepted') {
    run.logger.warn('delegated exits refused', { step: STEP, outcome: outcome.reason });
    return;
  }
  const { exited } = outcome.value;
  const merged = exited.filter((entry) => entry.advanced).length;
  run.logger.info('delegated exits run', {
    step: STEP,
    outcome: 'delegated_exits_run',
    exited: exited.length,
    merged,
  });
}

export async function runDelegatedExits(run: DelegatedRun): Promise<void> {
  const github = cronShipGitHub(run.env, run.clock);
  if (github === null) {
    run.logger.info('delegated exits skipped: no GitHub App', { step: STEP, outcome: 'github_not_configured' });
    return;
  }
  try {
    await exitDelegatedMerges(delegatedExitKernel(run, github), run);
  } catch (error) {
    run.logger.error('minute step failed', { step: STEP, outcome: 'internal_error', ...errorFields(error) });
  }
}
```

Write the type import of `ShipGitHub` exactly as above (the connectors-reference check exempts only that line). The file names no `connectors` otherwise.

`apps/uw-app/cron/minute.ts`, in `minuteWith`: build the notifier once (`const notifier = notifierOf(env, database, deps.sink, deps.fetch);`) and pass it to `hubWiring` as now; import `runDelegatedExits` from `./delegated-exits.ts`; after `await guarded(minute, 'beat', beat);` add:

```ts
    await runDelegatedExits({
      database,
      env,
      clock: { now: deps.now },
      live: { hub: unit.hub, runs: runsOf(env), notifier },
      caller,
      logger,
    });
```

- [ ] **Step 9: Run everything that guards the boundary**

Run: `pnpm check && npx vitest run tools/architecture && pnpm architecture`
Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/cron`
Expected: green, including `MD-5 finds the gate command and the delegated Ship exit and nothing else on the tree`, `MD-5 the minute job may call exactly kernel.gates.exitDelegated, from exactly its own file`, every `AB-7` case in `agent-boundary.test.ts` unchanged, and `minute.pg.test.ts` (if it asserts the exact list of steps it logs, add `delegated_exits` with outcome `github_not_configured`, which its test env produces).

- [ ] **Step 10: Commit**

```bash
git add apps/uw-app/cron
git commit -m "feat(cron): the minute job runs the delegated exits with a GitHub-wired kernel

As the system principal, after the beat, the minute job calls
kernel.gates.exitDelegated on a kernel wired with the GitHub App's reads
and merge, the one cron root allowed to hold them (MD-5). With no App
configured it logs github_not_configured and a delegated decision waits
for a person's recovery.

MD-3 MD-5. S16-R4."
```

---

### Task 10: MD-6, delegated merges are visible: the wake, the play-by-play, the Gates screen, `/health`

**Files:**
- Modify: `packages/harness/notify/triggers.ts` (`delegated_merge`; no `gate_waiting` for a park approved in the same commit), `packages/harness/notify/recipients.ts` (the grantor), `packages/harness/notify/triggers.test.ts`
- Modify: `apps/uw-app/islands/worker/sw-core.ts` (`PUSH_TITLES`), `apps/uw-app/generated/islands.ts` (regenerated)
- Modify: `apps/uw-app/views/parts/play-evidence.ts` (a describer); Create: `apps/uw-app/views/parts/play-evidence.test.ts`
- Create: `packages/harness/views/delegated-merges.ts`; Modify: `packages/harness/views/index.ts` (`ViewReads.delegatedMerges`), `packages/harness/index.ts` (type `DelegatedMergeRow`)
- Create: `apps/uw-app/views/parts/delegated-merges.tsx`; Modify: `apps/uw-app/views/screens/gates.tsx`
- Modify: `packages/harness/views/types.ts` (`PlaneTotals.liveDelegations.merge`), `packages/harness/views/plane.ts`, `packages/harness/views/plane-list.ts` (the `maxTier` cell), `apps/uw-app/health/agent-plane.ts` (`delegationsIndicator`)
- Create: `sim/kernel/delegated-merges-view.test.ts`
- Modify: `apps/uw-app/views/gates.pg.test.ts` (one case)

**Interfaces:**
- Consumes: Task 8's `delegated_merge` event; Task 7's `simAtShip`, `simLendMerge`.
- Produces: `ViewReads.delegatedMerges(caller: Caller, options?: ReadOptions): Promise<readonly DelegatedMergeRow[]>` with `DelegatedMergeRow = { harness: Harness; itemId: string; title: string; email: string; expiresAt: Date; at: Date }` (newest first, 7 days, harnesses the caller administers); `PlaneTotals.liveDelegations.merge: number`; `DelegatedMerges` JSX part.

- [ ] **Step 1: Write the failing tests**

`packages/harness/notify/triggers.test.ts`, append (import `rankOf` from `./rank.ts`, `identitySchema` from `@uw/contracts`, `type Delegation` from `../ports.ts`):

```ts
describe('MD-6 a delegated merge wakes the grantor at rank 2', () => {
  const personId = '00000000-0000-4000-8000-000000000302';
  const other = '00000000-0000-4000-8000-000000000303';
  const merged = event(10, 'delegated_merge', {
    decisionId: itemId,
    delegationId: itemId,
    personId,
    email: 'grantor@example.org',
    persona: 'agent:shipper',
    expiresAt: '2026-10-20T00:00:00.000Z',
    maxTier: 'standard',
  });
  const delegation: Delegation = {
    id: itemId,
    personId,
    persona: identitySchema.parse('agent:shipper'),
    harnessId,
    capability: 'merge',
    maxTier: 'standard',
    grantedAt: new Date('2026-10-01T09:00:00.000Z'),
    expiresAt: new Date('2026-10-20T00:00:00.000Z'),
    revokedAt: null,
    lapsedAt: null,
    supersedes: null,
  };
  const reader = (grantId: string): Grant => ({
    grantId,
    role: 'viewer',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    expiresAt: null,
  });
  const scope = (holders: readonly string[]) => ({
    trigger: { event: merged, reason: 'delegated_merge' as const },
    harness: harnessOf('80-89'),
    item: null,
    run: null,
    delegation,
    holders: holders.map((id) => ({ personId: id, email: `${id.slice(-3)}@example.org`, grants: [reader(id)] })),
    delegationPerson: () => personId,
    at: new Date('2026-10-03T09:00:00.000Z'),
  });

  it('MD-6 delegated_merge is a wake of rank 2 that reaches the grantor alone, while they can read', () => {
    expect(triggersOf([merged]).map((trigger) => trigger.reason)).toEqual(['delegated_merge']);
    expect(rankOf('delegated_merge')).toBe(2);
    expect(recipientsOf(scope([personId, other]))).toEqual([personId]);
    expect(recipientsOf(scope([other]))).toEqual([]);
  });

  it('MD-6 a park approved under a delegation in the same commit wakes nobody for the gate', () => {
    const approved = event(4, 'gate_approved', { decisionId: itemId, stage: 'ship' });
    expect(triggersOf([submitted(3, 'parked'), approved])).toEqual([]);
    expect(triggersOf([submitted(3, 'parked')]).map((trigger) => trigger.reason)).toEqual(['gate_waiting']);
  });
});
```

`apps/uw-app/views/parts/play-evidence.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eventSchema } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import { evidenceOf } from './play-evidence.ts';

describe('MD-6 the play-by-play shows a delegated merge', () => {
  it('MD-6 says merged under a delegation granted by the person until the expiry', () => {
    const expiresAt = '2026-10-20T00:00:00.000Z';
    const event = eventSchema.parse({
      eventId: '00000000-0000-4000-8000-0000000000e1',
      harnessId: '00000000-0000-4000-8000-0000000000e2',
      itemId: '00000000-0000-4000-8000-0000000000e3',
      name: 'delegated_merge',
      position: 7,
      at: '2026-10-15T09:01:00.000Z',
      actor: 'agent:system',
      evidence: {
        decisionId: '00000000-0000-4000-8000-0000000000e4',
        delegationId: '00000000-0000-4000-8000-0000000000e5',
        personId: '00000000-0000-4000-8000-000000000001',
        email: 'ian.lindsley@unfoldingword.org',
        persona: 'agent:shipper',
        expiresAt,
        maxTier: 'standard',
      },
      traceId: '00000000-0000-4000-8000-0000000000e6',
      requestId: null,
    });
    const shown = evidenceOf(event);
    expect(shown.list).toEqual([
      `Merged under a delegation granted by ian.lindsley@unfoldingword.org until ${formatInstant(new Date(expiresAt))}`,
    ]);
    expect(shown.facts).toContainEqual({ label: 'Persona', value: 'agent:shipper' });
  });
});
```

`sim/kernel/delegated-merges-view.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson, simSystem } from '../fixtures.ts';
import { approvedBy, greenFacts, simAtShip, simLendMerge, standardChange } from '../ship-fixtures.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

describe('MD-6 the Gates view and /health show delegated merges', () => {
  it('MD-6 lists a merge under a delegation for an admin, with the grantor and the expiry, and counts live merge delegations', async () => {
    const world = await createWorld();
    try {
      const { harness, admin } = await createSimHarness(world, software);
      const item = await simAtShip(world, { harnessId: harness.id, editor: admin, title: 'Show the board', change: standardChange });
      const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', standardChange.head, 9300000001)];
      world.adapters.githubFacts.given(greenFacts(world, { itemId: item.itemId, head: standardChange.head, reviews }));
      const loan = await simLendMerge(world, admin, { harnessId: harness.id, maxTier: 'standard' });
      const agent = simCaller(world, loan.agent);
      await world.kernel.items.claim(agent, { itemId: item.itemId, delegationId: loan.delegationId });
      await world.kernel.items.submit(agent, { itemId: item.itemId, to: null, evidence: {}, change: null });
      await world.kernel.gates.exitDelegated(simCaller(world, simSystem()), { limit: 20 });
      const rows = await world.kernel.views.delegatedMerges(simCaller(world, admin));
      expect(rows).toMatchObject([{ itemId: item.itemId, title: 'Show the board', email: admin.email }]);
      const viewer = await simPerson(world, 9, [{ role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' }]);
      expect(await world.kernel.views.delegatedMerges(simCaller(world, viewer))).toEqual([]);
      expect(await world.kernel.views.delegatedMerges(simCaller(world, loan.agent))).toEqual([]);
      const totals = await world.kernel.views.planeTotals({ at: world.adapters.clock.now() });
      expect(totals.liveDelegations).toMatchObject({ count: 1, merge: 1 });
      const listed = await world.kernel.views.planeList(simCaller(world, admin), 'live_delegations');
      expect(listed).toMatchObject([{ cells: { capability: 'merge', maxTier: 'standard' } }]);
    } finally {
      await world.close();
    }
  });
});
```

If the harness the sim activates is not in area `80-89`, read `createSimHarness` and use its area for the viewer. If `planeTotals` counts delegations the scene's `createSimHarness` seeds, compare `merge` only and `count` with `toBeGreaterThanOrEqual(1)`.

`apps/uw-app/views/gates.pg.test.ts`: add one case on the frame of the file's first case: seed one `delegated_merge` event on an item of the harness with `seedEvent` (`@uw/db/test-seed`; read its `SeedEvent` fields), render `/gates` as the admin, and assert the body contains `Merged under a delegation` and `granted by ian.lindsley@unfoldingword.org until`. Title: `MD-6 the Gates screen lists a merge under a delegation with its grantor and expiry`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/harness/notify/triggers.test.ts apps/uw-app/views/parts/play-evidence.test.ts sim/kernel/delegated-merges-view.test.ts`
Expected: FAIL; `delegated_merge` wakes nobody, the play line is empty, `views.delegatedMerges` does not exist.

- [ ] **Step 3: The wake**

`packages/harness/notify/triggers.ts`:

```ts
const direct: ReadonlyMap<string, WakeReason> = new Map<string, WakeReason>([
  ['delegation_lapsed', 'delegation_lapsed'],
  ['run_failed', 'run_failed'],
  ['stage_advanced', 'stage_advanced'],
  ['handed_to_person', 'handed_to_person'],
  ['delegated_merge', 'delegated_merge'],
]);

function approvedItems(events: readonly HarnessEvent[]): ReadonlySet<string> {
  return new Set(
    events.flatMap((event) => (event.name === 'gate_approved' && event.itemId !== null ? [event.itemId] : [])),
  );
}

function reasonOf(event: HarnessEvent, approved: ReadonlySet<string>): WakeReason | null {
  if (event.name !== 'submitted_to_gate') return direct.get(event.name) ?? null;
  if (event.evidence['result'] !== 'parked') return null;
  return event.itemId !== null && approved.has(event.itemId) ? null : 'gate_waiting';
}
```

and `triggersOf` computes `const approved = approvedItems(events);` first and calls `reasonOf(event, approved)`. A person's approval is always its own commit, so only a delegated exit puts a park and an approval in one batch.

`packages/harness/notify/recipients.ts`:

```ts
function grantorOf(scope: RecipientScope): string | null {
  return scope.delegation?.personId ?? null;
}
```

and `byReason` gains `['delegated_merge', readerOnly(grantorOf)],`.

`apps/uw-app/islands/worker/sw-core.ts`: `PUSH_TITLES` gains `delegated_merge: 'An agent merged under a delegation you gave',`. Regenerate: `pnpm ui:islands`.

- [ ] **Step 4: The play-by-play line**

`apps/uw-app/views/parts/play-evidence.ts`:

```ts
function delegatedMerge(fields: Fields): Shown {
  const by = text(fields, 'email') ?? 'a person no longer named';
  return {
    facts: [
      { label: 'Persona', value: text(fields, 'persona') ?? 'None' },
      { label: 'Up to tier', value: words(text(fields, 'maxTier')) },
    ],
    list: [`Merged under a delegation granted by ${by} until ${instant(text(fields, 'expiresAt'))}`],
  };
}
```

and `describers` gains `['delegated_merge', delegatedMerge],`.

- [ ] **Step 5: The Gates view**

`packages/harness/views/delegated-merges.ts`:

```ts
import { eventEvidenceSchemas, type Harness, type HarnessEvent, type ItemState } from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import type { StoreTransaction } from '../ports.ts';
import type { ScenePorts } from '../reads/scene.ts';
import { readableHarnesses } from './readable.ts';
import { VIEW_LIMIT } from './types.ts';

export const DELEGATED_MERGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type DelegatedMergeRow = {
  readonly harness: Harness;
  readonly itemId: string;
  readonly title: string;
  readonly email: string;
  readonly expiresAt: Date;
  readonly at: Date;
};

function rowOf(
  event: HarnessEvent,
  harnesses: ReadonlyMap<string, Harness>,
  items: ReadonlyMap<string, ItemState>,
): DelegatedMergeRow | null {
  const harness = harnesses.get(event.harnessId);
  const item = event.itemId === null ? undefined : items.get(event.itemId);
  const evidence = eventEvidenceSchemas.delegated_merge.safeParse(event.evidence);
  if (harness === undefined || item === undefined || !evidence.success) return null;
  const { email, expiresAt } = evidence.data;
  return { harness, itemId: item.itemId, title: item.title, email, expiresAt: new Date(expiresAt), at: new Date(event.at) };
}

export async function delegatedMerges(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<readonly DelegatedMergeRow[]> {
  if (isAgent(caller.actor) || caller.actor.personId === null) return [];
  const readable = await readableHarnesses(ports, tx, caller, at);
  const administered = readable.filter((harness) => allowed(caller.actor, 'admin', harness, at));
  if (administered.length === 0) return [];
  const harnesses = new Map(administered.map((harness) => [harness.id, harness]));
  const since = new Date(at.getTime() - DELEGATED_MERGE_WINDOW_MS);
  const query = { since, names: ['delegated_merge'] as const, agentsOnly: false, limit: VIEW_LIMIT, harnessIds: [...harnesses.keys()] };
  const events = await tx.harnessEvents.read.recent(query);
  const itemIds = events.flatMap((event) => (event.itemId === null ? [] : [event.itemId]));
  const items = new Map((await tx.harnessItems.read.byIds(itemIds)).map((item) => [item.itemId, item]));
  return events
    .flatMap((event) => {
      const row = rowOf(event, harnesses, items);
      return row === null ? [] : [row];
    })
    .toSorted((left, right) => right.at.getTime() - left.at.getTime());
}
```

`packages/harness/views/index.ts`: import `delegatedMerges`, `type DelegatedMergeRow`; `ViewReads` gains `delegatedMerges(caller: Caller, options?: ReadOptions): Promise<readonly DelegatedMergeRow[]>;`; `createViewReads` gains:

```ts
    delegatedMerges: (caller, options) => {
      const at = instant(options);
      return store.transaction((tx) => delegatedMerges(ports, tx, caller, at));
    },
```

`packages/harness/index.ts`: export type `DelegatedMergeRow`.

`apps/uw-app/views/parts/delegated-merges.tsx`:

```tsx
import { formatInstant } from '@uw/core/dates';
import type { DelegatedMergeRow } from '@uw/harness';
import { itemPath } from './paths.ts';

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

export function DelegatedMerges(props: { readonly rows: readonly DelegatedMergeRow[] }) {
  if (props.rows.length === 0) return null;
  return (
    <section aria-labelledby="delegated-merges-heading" class="mt-6 flex flex-col gap-2">
      <h2 id="delegated-merges-heading" class="m-0 text-base font-bold text-ink">
        Merged under a delegation
      </h2>
      <ul class="m-0 flex list-none flex-col gap-3 p-0">
        {props.rows.map((row) => (
          <li class="flex flex-col gap-1">
            <a href={itemPath(row.harness.id, row.itemId)} class={`text-link underline ${focus}`}>
              {`${row.title} on ${row.harness.key}`}
            </a>
            <span class="break-words text-sm text-muted">
              {`Merged under a delegation granted by ${row.email} until ${formatInstant(row.expiresAt)}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`apps/uw-app/views/screens/gates.tsx`: read `const merged = await screen.kernel.views.delegatedMerges(screen.caller, { at: screen.at });` beside the gates read, and render `<DelegatedMerges rows={merged} />` as the last child of both branches of the returned fragment (after `GateList` and after the empty-state note; steps 14 and 15 may have added a shadow section and "approve all shown": put it after those).

- [ ] **Step 6: `/health`**

`packages/harness/views/types.ts`: `liveDelegations: { readonly count: number; readonly merge: number; readonly soonestExpiry: Date | null };`.

`packages/harness/views/plane.ts`, `liveDelegations`: return `{ count: live.length, merge: live.filter((delegation) => delegation.capability === 'merge').length, soonestExpiry: soonest }`.

`packages/harness/views/plane-list.ts`, `delegationRows`' cells gain `maxTier: delegation.maxTier,` after `capability`.

`apps/uw-app/health/agent-plane.ts`, `delegationsIndicator`:

```ts
  const merges = liveDelegations.merge === 0 ? '' : `, ${formatCount(liveDelegations.merge)} of them merge`;
  const detail = `${formatCount(count)} live${merges}; next expiry ${formatInstant(soonestExpiry)}`;
```

(the `None live` branch is unchanged). Any `PlaneTotals` literal `pnpm check` names gains `merge: 0` in `liveDelegations`.

- [ ] **Step 7: Run the tests and look at the screens**

Run: `pnpm check && npx vitest run packages/harness/notify sim/kernel/delegated-merges-view.test.ts sim/kernel/views-plane.test.ts sim/kernel/wakes.test.ts apps/uw-app/views/parts tools/ui`
Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/views apps/uw-app/health`
Expected: green. If a health test pins the live delegations detail text, it reads the same when no merge delegation is live.

Load `/gates` and an item's play-by-play in the local dev server in light and dark at phone width with one delegated merge seeded; record in the tracker whether you could (step 15's and step 14's screen checks say how they did it).

- [ ] **Step 8: Commit**

```bash
git add packages/harness apps/uw-app sim
git commit -m "feat(views): delegated merges are visible on Gates, in the play-by-play, on /health and to the grantor

The Gates screen lists the week's merges under a delegation with the
grantor and the expiry; the play-by-play says the same; /health names
how many live delegations are merge delegations and shows each one's
tier; delegated_merge wakes the grantor at rank 2. A park approved under
a delegation in the same commit no longer pages the deciders.

MD-6. S16-R9 S16-R14."
```

---

### Task 11: Verify, record, push

**Files:**
- Modify: `docs/progress_tracker.md` (step 16 row; a rulings table for S16; Not verified; Carried to later steps)

- [ ] **Step 1: Run the whole chain**

Run with `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres` set: `pnpm verify`
Expected: green. Note the test count and scenario count from the output. Then run `pnpm trace` and confirm no MD ID is listed as unproven (MD-1 by `tools/release/merge-delegation-decision.test.ts`, MD-2 to MD-6 by the files below); once Step 2 marks the step Built, `pnpm trace:built` fails on any that is.

- [ ] **Step 2: Update the tracker**

In `docs/progress_tracker.md`, change the step 16 row's state to `Built` and its evidence to: the commit SHAs of Tasks 1 to 10, the test files and scenarios named for MD-1 to MD-6 (`tools/release/merge-delegation-decision.test.ts`, `sim/kernel/merge-delegation-grant.test.ts`, `sim/kernel/delegated-ship.test.ts`, `sim/kernel/delegated-exit.test.ts`, `sim/kernel/delegated-merges-view.test.ts`, `packages/harness/ship-rule.test.ts`, `packages/harness/template-property.test.ts`, `packages/harness/risk/protected-paths.test.ts`, `packages/db/merge-delegation-columns.test.ts`, the Store contract cases, `tools/architecture/gate-writers.test.ts`, `apps/uw-app/github/merge.test.ts`, `apps/uw-app/cron/delegated-exits.pg.test.ts`, scenarios `MD-3` and `MD-4`), `pnpm verify` green locally with the counts, and "CI not run" or the CI run id. Add a "Step 16 evidence by requirement" section in the shape of step 13's. Under the step's heading in the rulings section (the shape of the S15 rows: `| date | requirement | ruling | cost if wrong |`), add S16-R1 to S16-R14 from the top of this plan, each tagged with its requirement IDs.

Under "Not verified": the minute job's GitHub-wired merge against a real repository (needs the GitHub App on staging; GL-1); the screens in a browser if Task 10 Step 7 could not load them.

Under "Carried to later steps": the three items in this plan's "Left for later steps" list, and "the merge connector's joined-pull-request case is proven against the fixture GitHub only; DX-10 drives it in the sim through a check-only harness".

- [ ] **Step 3: Commit and push**

```bash
git add docs/progress_tracker.md
git commit -m "docs(tracker): step 16 is built"
git push
```

The draft pull request for `build/v0.2.0` already exists; push only.

---

## Self-review

**Spec coverage.** MD-1: Task 1 (ADR 0010, spec D8 and D18, PRD 18 in one commit with the test that proves it; AGENTS.md section 10; the words). MD-2: Task 2 (the word existed since step 12; the tier and refusal contracts), Task 3 (the column and its two checks), Task 5 (the grant, `admin` only, `tier_not_delegable`, the event naming the grantor). MD-3: Task 3 (the new check, the approver check unchanged), Task 4 (the Store), Task 7 (the decision inside the transaction that locks and re-reads the delegation, the grantor approver, the agent actor), Task 8 (then the merge connector runs, with the delegation re-checked). MD-4: Task 2 (the two refusals as predicates), Task 6 (protected paths, the delegable exit, the property over every template), Task 7 (`delegation_required`, pickup refusals, the item parked for a person), Task 3 (the database half: delegated rows only approve a merge). MD-5: Task 9 (the named writer check, the agent closure, the planted second delegated writer, AB-7's one allowed call). MD-6: Task 10. Step 14's carry-forward 1: Tasks 4 and 8 (`joined`, the merge connector).

**Placeholders.** None; every step carries its code or its command. Where a file differs because steps 14 and 15 changed it (the shape of `simParkedAtShip`, `submitIn`, the Gates screen's branches, a test file's helper names), the step names what to keep and what to change.

**Type consistency.** `DelegableTier` (Task 2) is `Delegation.maxTier` (Task 4), `ShipDelegation.maxTier` (Task 6), `Lent.lent.maxTier` (Task 7) and `DelegatedMerge.maxTier` (Task 2). `ShipDelegation` (Task 6) is what `shipCheck` (Task 7) and `standingAtExit` (Task 8) pass to `assembleShipInput`. `DelegatedMerge` (Task 2) is `ExitInput.delegated` and `PendingExit.delegated` (Task 4), what `recordDelegatedDecision` writes under `evidence.delegation` (Task 7), what `delegatedOf` and `exitDelegated` parse back (Task 8), and the `delegated_merge` evidence `recordIn` records (Task 8) and the views read (Task 10). `recordDelegatedDecision` and `recordDecision` are the two names Task 9's `DELEGATED_WRITER` and `PERSON_WRITER` hold. `kernel.gates.exitDelegated` (Task 8) is the one call Task 9 allows in `apps/uw-app/cron/delegated-exits.ts`.

**Review Focus.** Line 1 is pinned by Task 8's revocation case; line 2 by Task 7's second-admin case; line 3 by Task 6's property, Task 7's deploy-stage case and Task 4's `deploy` row refusal; line 4 by Task 8's second run and Task 7's second submit; line 5 by Task 8's merge connector block; line 6 by Task 7's revocation-after-claim case and Task 8's revocation-after-decision case.
