# Step 17, The Fix Claim: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin can turn a harness's fix claim on. While it is off nothing changes from v0.1.0. While it is on, a review round with a `real` or `plausible` finding opens the item, once, to the Builder persona under a live `fix` delegation: `poll_queue` offers it and `claim_item` takes it, recording the head and the pull request's declaration at that moment. The fix run reads the round's findings as untrusted `review_comment` text, works in a sandbox that cannot push, runs the repository's declared checks, and only then lets the platform push; with no declared checks, or failing ones, the run ends `run_failed` with `checks_not_run_locally` and nothing is pushed. At `submit_to_gate` from a fix claim, `fix_size_cap` and `fix_keeps_purpose` run from the validator registry; either refuses with its own reason and releases the claim, and a passing fix stays at its stage for the next review round.

**Architecture:** No agent verb is added (V2-7): the `fix` capability on the delegation changes what `claim_item` and `submit_to_gate` do. The offer is a pure fold over the item's events (`packages/harness/items/fix-offer.ts`): a counted round (step 15's `countsAsRound`) since the last head and the last stage change, with no `fix_claimed` after it, on a harness with `fix_claim` on and out of shadow, for an item with its own `harness/<item>` branch. `poll_queue` drops items only the `fix` reach would offer when the offer is closed; `claim` checks the same offer under the stage lock and records `fix_claimed`. The declaration snapshot is read from the GitHub facts before the claim's transaction, on both paths into `claimWithin` (`claim` and `startRun`). The two validators are registry entries over a widened `ValidationContext`; the submit reads two diffs through `githubFacts.diff` before its transaction and runs them in place of the stage's exit gate. The fix work spec is three container execs in one session (`apps/uw-app/engines/sandbox/fix-checks.ts`): the model with the GitHub push closed, the declared checks with a read-only package-registry route open, then the platform's own push.

**Tech Stack:** TypeScript strict, Zod 4, Drizzle and drizzle-kit, Vitest 4 (node project, workers project, and the Postgres service), the sim over the embedded Postgres Store, the fake container host in `apps/uw-app/engines/sandbox/testing.ts`.

**Spec:** `docs/PRD.md` section 7.11.3 (FL-1 to FL-4), sections 8.3, 8.5, 8.6, 13 (step 17) and 18.3 (V2-2, V2-7); the design is `docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` sections 2 (**Fix claim**), 3 (V2-2, V2-7), 5.3, 6 and 7.

**Requirements covered:** FL-1, FL-2, FL-3, FL-4 (all Must).

**Builds on steps 13 to 16 (built before this plan runs; step 13 is built at planning time, 14 is in progress, 15 and 16 are planned).** Names used exactly as they hand them over. From `docs/superpowers/plans/2026-10-15-step-13-untrusted-content.md`: `PromptSource.related: readonly UntrustedContent[]` (S13-R1, filled with `[]` until this step), `untrusted()`, `scanFences`, `promptSourceOf(read, itemId)`, `ReadText`, `readContext`, and S13-R4 (a GitHub read for a prompt is a host read). From `docs/superpowers/plans/2026-10-15-step-14-joining.md`: `Harness.shadow`, `createSimHarness`'s `dispatchable` default, contract `12.4.0`, migration `0029_joining` (it re-added `delegations_capability_known` with `merge` and `fix`). From `docs/superpowers/plans/2026-10-15-step-15-ship-rule-and-gates.md`: RV-1's finding weight (`ReadFinding`, `ReviewFinding`, `ReviewRecord.findings`), `countsAsRound(review)` in `packages/harness/runs/weights.ts` (a review round is a posted `request_changes` with a `real` or `plausible` finding, S15-R13, S15-R14), `PostReviewInput.findings: readonly ReadFinding[]`, `runFailureSchema` with `engine_refused` and `finding_weight_missing`, `endingReasons` with `finding_weight_missing`, contract `13.0.0`, migration `0030_ship_rule_and_gates`. From `docs/superpowers/plans/2026-10-15-step-16-merge-delegation.md`: `delegableExit(stage)` in `packages/harness/gates/delegable.ts` ("FL-2: a fix claim never reaches Ship"), `joinedPullRequest(item)` in `packages/harness/gates/ship-input.ts`, the reshaped `capabilityRefusal`, `pickupOpen` and `claimable` (S16-R1), the reshaped `submitIn` with `recordSubmission`, `delegatedAfter` and `Command.lent` (Task 7 of step 16), `Delegation.maxTier` (a `fix` grant names none, S16-R8), the contract-bump script of step 16 Task 2 Step 5, contract `13.1.0`, migration `0031_merge_delegation`. Where a file below differs from the text quoted here because steps 14 to 16 changed it, keep their lines and make only this plan's change.

**Rulings made while planning** (recorded here and in `docs/progress_tracker.md` by the last task):

| Ruling | Cost if wrong |
|---|---|
| S17-R1. `fix` reaches the `build_package` bracket in `capabilityReaches`, as `build` does, and a `fix` delegation agrees with a persona page whose capability is `build` (`pageAgrees`), so only a Builder can be lent a fix. Reach alone offers nothing: an item reachable only by `fix` needs the offer of S17-R2, in `poll_queue` and in `claim` | A persona page that says `capability: fix` is never offered; one map entry widens it |
| S17-R2. An item is offered for a fix when: the harness has `fix_claim` on and is not in shadow (a fix pushes to GitHub, and GL-4 writes nothing in shadow); the item wraps a pull request with an expected head and is not `joinedPullRequest` (a joined pull request has no `harness/<item>` branch to push to; this answers S12-R4: the check-only template still has no Builder); its stage is not a `delegableExit`; and since the item's last head (`branch_adopted`, or `submitted_to_gate` with a head) and its last stage change (`stage_advanced`, `loop_edge_taken`) its events hold a counted review round and no `fix_claimed` after it. One fix claim per round: a fix run that fails or lapses leaves the item to its author or a person | A failed fix is not retried by the Builder on the same round; the next counted round opens a new fix |
| S17-R3. `fix_claim` is switched by an admin person command `set_fix_claim { enabled }`, the copy of `set_hosted_builder`: harness event `fix_claim_set { enabled }`, the same state again records nothing, agents refused. Activation always writes `false` | One more command in the contracts; a harness cannot be activated with the fix claim already on |
| S17-R4. A fix claim records the item event `fix_claimed { delegationId, head, declaration }`: the expected head the review read and the pull request's declaration from the GitHub facts, read before the claim's transaction by `readFixStart` on both paths into `claimWithin` (`claim` and `startRun`). Facts that do not know the pull request refuse the claim `not_permitted` (`why: pull_request_unknown`); a facts read that fails refuses as `factsFailure` does | One more facts read per claim that presents a `fix` delegation |
| S17-R5. `fix_size_cap` reads two diffs before the submit's transaction through `githubFacts.diff` (budget 1,000,000 bytes): the pull request's base to the fix's start head (the expected head when the fix was claimed), and the start head to the submitted head. A changed line is a `+` or `-` line inside a hunk; a diff's paths are both sides of each `diff --git` header. The fix passes when four times its lines are at most the pull request's lines and every path it touches is one the pull request touches, a test path (a `test/`, `tests/`, `__tests__/` or `spec/` segment, or `.test.` or `.spec.` before the extension) or a doc path (under `docs/` or ending `.md`). A diff that is too large or unavailable, a start head that moved, or a fix submit with no change refuses `fix_size_cap` (fail closed) | A fix that merges the base into its branch counts the base's changes and is refused; a pull request whose diff passes 1 MB cannot take a fix |
| S17-R6. `fix_keeps_purpose` compares the declaration at submit (the facts read by `submit`) with the one `fix_claimed` recorded: `risks`, `touches` and `riskTier` as text, `closes` and `riskDomains` as sets; no declaration equals no declaration | A person who edits the pull request body during a fix has the fix refused |
| S17-R7. Both validators are registry entries over `ValidationContext.fix` (absent or `null` outside a fix, where both return nothing). They run at `submit_to_gate` from a fix claim before the stage's exit gate, whatever that gate is. A failure refuses the submit with the first failing key as the reason (`fix_size_cap` before `fix_keeps_purpose`) and every failure in the detail, and in the same transaction records `checks_failed { stage, failures }`, releases the claim (`item_released`) and stops the run (`run_stopped`, `released`). The expected head stays the reviewed head, so Ship refuses the pushed head `head_mismatch`; the pushed commit stays on the branch for the author or a person (V2-2's `git revert` bound). The host treats both reasons as an ended run | A refused fix lingers on the branch until someone reverts it |
| S17-R8. A fix that passes does not take the stage's exit: `submit_to_gate` answers the new result `awaiting_review`, records the head, and releases the claim. The Reviewer reviews the new head at the same stage, and PE-6's three rounds bound the loop. A fix never moves an item to Ship | Every client of `submit_to_gate` meets one more result value |
| S17-R9. The review comments a fix prompt reads are the findings of the round that opened the fix (`real` and `plausible`, from the round's `run_completed` review record), read by the host through `kernel.runs.reviewComments` in the run's scene, as S13-R4 reads the diff. Each is wrapped `review_comment` and placed in `PromptSource.related` (S13-R1's slot, shape unchanged). Comments people or external reviewers left on GitHub are not read | A person's GitHub comment does not reach the fixer; reading them is one more source later |
| S17-R10. A repository declares its checks in one file, `.harness/checks.sh`, read with `git show` at the fix's start commit before the model runs (so the model cannot change what is run) and run with `sh` in the repository after the model's exec; its exit status decides. With no such file the model exec exits 78 before Claude Code starts, so a repository with no declared checks costs no model spend | Other conventions (`package.json` scripts, a Makefile) are not read |
| S17-R11. The fix work spec is three execs in one container session: the model (clone, checkout at the start head, read the declaration, Claude Code with `git` but no `curl`, the GitHub egress refusing every push), the declared checks (a read-only package-registry route `registry.internal` to `https://registry.npmjs.org`, `GET` and `HEAD`, open only now), and the platform's own push (`git push origin HEAD:refs/heads/harness/<item>`, the only exec during which the egress forwards a push). Missing or failing checks make the engine answer `checks_not_run_locally`; the run fails with it and the submit never runs. A fix on an engine with no fix work spec (`codex-sandbox`, a message engine, or a run with no checkout) ends the same way without a session. Registry requests do not await `admit()`; the push after them does | A process the model leaves running into the later execs could reach the push (Claude Code's tool allowlist is the bound); only npm-registry ecosystems install |
| S17-R12. The contract moves one minor for the step (expected `13.1.0` to `13.2.0`): new values and a field with a default. One migration, `fix_claim` (expected `0032`) | None; the lock test enforces the rule |
| S17-R13. PRD sections 8.3, 8.5 and 8.6 and design section 6 gain this step's names (the `fix_claimed` and `fix_claim_set` events, the `set_fix_claim` command, the `fix_size_cap` and `fix_keeps_purpose` refusals, the `awaiting_review` result, `checks_not_run_locally` as a run failure). The step-13 "Not verified" row asking Ian whether tool replies should be fenced (S13-R11) stays with Ian: a fix run's tool replies are not fenced either | None |

**What this step hands to later steps (keep these names exactly):**

| Interface | Where | Consumed by |
|---|---|---|
| `Harness.fixClaim` (default `false`); command `set_fix_claim`; harness event `fix_claim_set`; `HarnessesGateway.write.setFixClaim`; `stages.setFixClaim(caller, FixClaimInput)` | contracts, `packages/harness/store-ports.ts`, `packages/harness/stages/fix-claim.ts` | GL-5 (a template change keeps the column), DX-10 |
| Item event `fix_claimed { delegationId, head, declaration }`; `fixRound(events)`, `fixOffered(harness, item, events)`, `onlyByFix(stage, reach)`, `offeredForFix(tx, harness, reach, stages, item)`, `roundFindings(events)` | `packages/contracts`, `packages/harness/items/fix-offer.ts` | OB-2 (the fixer as holder), step 18 (a blocked item is offered to no one) |
| `readFixStart(ports, itemId, delegationId)`, `fixClaiming(tx, scene, item, fixing)`, `FixRead`, `FixStart` | `packages/harness/items/fix-claim.ts` | step 18 |
| `claimWithin(ports, tx, caller, input, at, fix = null)`; `claimIn`'s last line now calls `takeWithFix` | `packages/harness/items/claim.ts` | step 18 (its `heldRefusal` line is untouched here) |
| `claimableIn`'s loop body now `heldForPerson` then `offeredForFix`; the `for … of items.filter(…)` line is unchanged | `packages/harness/reads/poll.ts` | step 18 (it replaces that filter line) |
| `submitToGateResultSchema` gains `awaiting_review` | `packages/contracts/verb-io.ts` | DX-10, OB-2 |
| `errorReasonSchema` gains `fix_size_cap`, `fix_keeps_purpose`; `runFailureSchema` gains `checks_not_run_locally` | `packages/contracts` | OB-1 (failed runs on `/health`) |
| `FIX_VALIDATORS`, `fixSizeCap`, `fixKeepsPurpose`, `sameDeclaration`, `testOrDoc`, `FixContext`, `ValidationContext.fix` | `packages/harness/validators/` | none |
| `diffStat(text)`, `DiffStat` | `packages/harness/github/diff-stat.ts` | none |
| `readFixDiffs(ports, itemId, change, facts)`, `fixRefusal(tx, submission)`, `FixDiffs` | `packages/harness/items/fix-submit.ts` | none |
| `runs.reviewComments(caller, runId)` returning `{ comments }` | `packages/harness/runs/fix-comments.ts` via `RunCommands` | none |
| `fixPrompt(source)`, `ReadText.comments`, `ReadDone.fix` | `apps/uw-app/runs/` | none |
| `Checkout.fix`, `GitHubEgress.pushes`, `EgressRoutes.registry`, `registryEgress`, `REGISTRY_HOST`, `fixPhase`, `fixFinish`, `readDeclaredChecks`, `NO_CHECKS_EXIT`, `SessionSpec.finish`, `SandboxPlan.finish` | `apps/uw-app/engines/` | GL-1's live run |
| `sim/fix-claims.ts`: `fixWorld`, `reviewedRound`, `claimFix`, `offeredTo`, `pushedFix`, `submitFix`, `diffText`, `fixHead`, `fixerPage` | `sim/` | DX-10 |

---

## Global Constraints

Every task obeys every line here. The controller passes this section to each implementer.

**Where and how**

- Work only in `/home/ianjl/projects/uw-platform-v0.2.0`, branch `build/v0.2.0`. Never commit to `main`, never force-push, never `--no-verify`.
- Read `AGENTS.md` sections 1, 4 and 10 before the first edit. When this plan and `AGENTS.md` disagree, `AGENTS.md` wins; record the conflict in `docs/progress_tracker.md` and build the version that keeps the rule.
- Words come from `CONTEXT.md`: **fix claim**, **review round**, **finding weight**, **delegation**, **validator**, **untrusted content**, and this step's **declared checks** (Task 1). Never "fix lane", "second writer", "auto-fix" or "severity".
- No agent verb is added (V2-7). `approve`, `merge`, `deploy`, `publish` and `advance` stay forbidden. Nothing in this step writes `gate_decisions` or `harness_stages`.
- Commits: Conventional Commits, the agent as sole author, no attribution footer. Hooks always pass. Put the requirement IDs in each commit body.

**Code rules (all mechanically enforced by `pnpm verify`)**

- TypeScript `strict`, no `any`, no `@ts-ignore`, no `as unknown as`, no non-null assertion.
- No code comments of any kind.
- Files under 500 non-blank lines; functions under 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters. `packages/harness/items/submit.ts` gets at most 30 more lines; if it would pass 480, move `handlerOf` and `awaitReview` into `packages/harness/items/submit-gates.ts` and export `submittedDraft` from `submit.ts` for it. `apps/uw-app/runs/run-core.pg.test.ts` and `apps/uw-app/engines/claude-code-sandbox/work.test.ts` get no new test: this step's tests live in new files.
- Regular expressions are literals with no nested quantifier.
- Zod at every boundary. `packages/contracts` imports only `zod`. `packages/harness` imports nothing from Workers, Drizzle or the network.
- Every exported Zod schema registered in `packages/contracts/registry.ts` has `fixtures/<key>/valid/*.json` and `fixtures/<key>/invalid/*.json`. Any change to a registered `z.enum` appends a full entry to `packages/contracts/contract-lock.json` and changes `CONTRACT_VERSION`.
- Every route and command has `can()` on the harness's area through the command registry's `action`; `set_fix_claim` is `admin`.
- Each table keeps its one writer: `harnesses.fix_claim` is written only through `tx.harnesses.write.setFixClaim` in `packages/harness/stages/fix-claim.ts` (the stage command, as design section 6 says); events only through `recordItemEvents` and `recordHarnessEvents`.
- `untrusted()` is the only constructor of untrusted content; review comments are wrapped in `apps/uw-app/runs/prompt-source.ts` after the step boundary (S13-R6), never inside a step body.
- knip runs in `verify`: export only what a non-test file or a test file imports.

**Contract version**

- At planning time `packages/contracts/version.ts` reads `12.4.0`; steps 15 and 16 move it to `13.0.0` and `13.1.0`. This step moves it to the next minor after whatever is current (expected `13.2.0`), once, in Task 2, by the script in Task 2 Step 5, which reads the version and computes it.

**Migrations**

- One migration for the step, generated in Task 3 with `--name fix_claim`, at the next index after step 16's (expected `0032`). Nothing is appended by hand.

**Shared roots**

- `CONTEXT.md` (Task 1), `docs/PRD.md` with the design document (Task 1, its own commit), `packages/contracts/` (Task 2), `packages/db/schema.ts` with the migration (Task 3), `packages/harness/store-ports.ts` with its mirror `packages/db/store/types.ts` (Task 4) are shared roots. Each change to one is its own commit with no feature code, and the message names the root and why. `docs/exceptions.md` changes in the same commit as the egress code it describes (rule 5).
- Between Task 2's contracts commit and its follow-up commit `pnpm check` is red; between Task 2 and Task 3 `tools/db/drift.test.ts` is red (the event-name, command-name and run-failure checks derive from the enums); between Task 4's port commit and its binding commit `pnpm check` is red. Do each pair back to back.

**Tests**

- A test that proves a requirement has a `describe` or `it` title that starts with the requirement ID and a space, as `tools/trace/proofs.ts` reads it. A scenario's `id` is the requirement ID.
- Run one file with `npx vitest run <path>` (node project) or `npx vitest run --project workers <path>` (an `apps/uw-app` test that is not `*.pg.test.ts`). Database tests (`*.pg.test.ts`, `packages/db`, the Store contract on the platform adapter) need `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres` after `pg_ctl -D ~/.local/share/uw-platform-test-pg -o "-p 54329" start`. Never run two Vitest suites at once on this machine (WSL runs out of memory); `pnpm verify` runs them in sequence.

## Review Focus

Inputs the spec implies that no requirement row spells out, most likely to bite first. Each line names the task that pins it.

1. A `theoretical`-only round must not open a fix, or the Builder rewrites code over a finding the Reviewer itself called unlikely. Task 5 pins a `theoretical` round offering nothing; Task 6's unit test pins `fixRound` on it.
2. A round must open exactly one fix: after a fix claim is released, the same round must not be offered again, or a failing fix loops. Task 5 pins the second claim refused `pickup_not_allowed` (`why: no_review_round`) and the item absent from the poll.
3. The model must not be able to push before the checks pass. Task 9 pins a push during the model exec answered `403` and no upstream request, and the push forwarded only in the third exec.
4. The declared checks must be read from the start commit, never from the working tree the model edited. Task 9 pins the script's `git show "$UW_START:.harness/checks.sh"` line before the `claude` line.
5. A refused fix must not move the item's expected head, or Ship evaluates the oversized head. Task 7 pins `expectedHead` equal to the reviewed head after both refusals, and a pass moving it.
6. A passing fix must not take Check's exit to Ship. Task 7 pins `awaiting_review` with the item still at `check`, and the author's ordinary submit still `advanced` with no fix validator run.
7. A fix delegation must never reach Ship. Task 6's unit test pins `onlyByFix` false at a delegable exit; step 16's `capabilityRefusal` refuses it in `claim`.
8. The review comments must reach the prompt fenced as `review_comment`, never as platform text. Task 8 pins the fix prompt's spans and `scan.outside` holding no finding text.

---

### Task 1: The words and the document corrections

**Files:**
- Modify: `CONTEXT.md` (one new entry; one sentence of **Validator**)
- Modify: `docs/PRD.md` (sections 8.3, 8.5, 8.6) and `docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` (section 6), in their own commit

**Interfaces:**
- Produces: the word **Declared checks** that Tasks 9 and 10 use.

- [ ] **Step 1: Confirm what the earlier steps hand over**

Run:

```bash
grep -n "export function countsAsRound" packages/harness/runs/weights.ts
grep -n "export function delegableExit" packages/harness/gates/delegable.ts
grep -n "export function joinedPullRequest" packages/harness/gates/ship-input.ts
grep -n "'fix'" packages/contracts/closed-sets.ts
grep -n "CONTRACT_VERSION =" packages/contracts/version.ts
ls packages/db/migrations | tail -3
```

Expected: one hit each for the three functions (steps 15 and 16), `capabilityWordSchema` holding `fix`, the version step 16 left (expected `13.1.0`), and step 16's migration last (expected `0031_merge_delegation.sql`). If any function is missing, stop and report: this plan's premise is false.

- [ ] **Step 2: The word (shared root `CONTEXT.md`)**

Find **Fix claim** (`grep -n '^\*\*Fix claim\*\*' CONTEXT.md`) and insert after its `_Avoid_` line, with one blank line before:

```markdown
**Declared checks**:
The commands a repository says prove a change, in the file `.harness/checks.sh` at its root. A fix run reads the file at the commit the fix starts from, runs it after the model has worked, and pushes only when it passes. Not the **required checks** of the ship rule, which are CI checks GitHub reports.
_Avoid_: local CI, pre-push hook, test script
```

In **Validator**, replace its first sentence with:

```markdown
A check picked by key from a registry and run at a `checks` gate; `fix_size_cap` and `fix_keeps_purpose` also run at every submit from a **fix claim**, whatever the stage's gate.
```

If step 15 did not add **Required check**, drop the last sentence of the new entry.

```bash
git add CONTEXT.md
git commit -m "docs(context): declared checks, and the validators a fix claim runs

Shared root CONTEXT.md. FL-4 runs the repository's declared checks
before a fix is pushed; FL-3's validators run at a fix claim's submit.
The words land before the code (rule 1).

FL-3 FL-4."
```

- [ ] **Step 3: The PRD and the design learn this step's names**

`docs/PRD.md` section 8.3, append two rows after `untrusted source (v0.2.0)`:

```markdown
| run failure (v0.2.0) | adds `checks_not_run_locally` (and step 15's `engine_refused`, `finding_weight_missing`) |
| submit result (v0.2.0) | `advanced`, `parked`, `checks_failed`, `awaiting_review` (a fix that passes its validators and waits at its stage for the next review round) |
```

If step 15 already added a run-failure row, add only `checks_not_run_locally` to it and keep the submit-result row.

Section 8.5, the "Added in v0.2.0" paragraph: after `tier_not_delegable`, insert `fix_size_cap`, `fix_keeps_purpose` (the two refusals of a submit from a fix claim, FL-3),.

Section 8.6, the "Added in v0.2.0" paragraph: after `delegated_merge`, insert `, fix_claimed` (an item event: the delegation, the head the fix starts from and the pull request's declaration, FL-2), `fix_claim_set` (a harness event: `{ enabled }`, FL-1)` and, as a new sentence, `The person command set_fix_claim switches a harness's fix claim (admin).`

Design section 6: in **Events** add `fix_claimed`, `fix_claim_set`; in **Commands (person surface)** add `set_fix_claim`; in **Closed sets** add `fix_size_cap`, `fix_keeps_purpose` to the "Elsewhere" list and a sentence `Submit results gain awaiting_review.`

```bash
git add docs/PRD.md docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md
git commit -m "docs(prd): the fix claim's events, command, refusals and submit result

Sections 8.3, 8.5 and 8.6 and design section 6 name what step 17 adds:
fix_claimed, fix_claim_set, set_fix_claim, fix_size_cap,
fix_keeps_purpose, awaiting_review, and checks_not_run_locally as a run
failure. S17-R13.

FL-1 FL-2 FL-3 FL-4."
```

---

### Task 2: The contracts for the fix claim (shared root `packages/contracts`), then the follow-up that keeps the tree green

**Files:**
- Modify: `packages/contracts/closed-sets.ts` (`checks_not_run_locally` at the end of `runFailureSchema`)
- Modify: `packages/contracts/outcomes.ts` (two values at the end of `errorReasonSchema`)
- Modify: `packages/contracts/verb-io.ts` (`awaiting_review` at the end of `submitToGateResultSchema`)
- Modify: `packages/contracts/harness.ts` (`harnessSchema.fixClaim`)
- Modify: `packages/contracts/commands.ts` (`set_fix_claim` name and body)
- Modify: `packages/contracts/events.ts` (two names at the end of `eventNames`)
- Modify: `packages/contracts/event-evidence.ts` (`fix_claimed` in `itemEvidence`, `fix_claim_set` in `harnessEvidence`)
- Create: fixtures (Step 4)
- Modify: `packages/contracts/contracts.test.ts` (new block), `packages/contracts/events.test.ts` (the vocabulary count)
- Modify: `packages/contracts/contract-lock.json`, `packages/contracts/version.ts`
- Second commit, not a shared root: `packages/harness/items/fold.ts` (`unchangedNames`), `packages/harness/stages/activate.ts` (`fixClaim: false`), every `Harness` literal `pnpm check` names, `apps/uw-app/generated/islands.ts` (regenerated)

**Interfaces:**
- Produces: `RunFailure` gains `checks_not_run_locally`; `ErrorReason` gains `fix_size_cap`, `fix_keeps_purpose`; `submitToGateResultSchema` gains `awaiting_review`; `Harness.fixClaim: boolean` (default `false`); `CommandBody<'set_fix_claim'> = { enabled: boolean }`; `EventEvidence['fix_claimed'] = { delegationId: uuid; head: full SHA; declaration: PullRequestDeclaration | null }`; `EventEvidence['fix_claim_set'] = { enabled: boolean }`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/contracts/contracts.test.ts` (it already imports `commandSchema`, `errorReasonSchema`, `eventEvidenceSchemas`, `harnessSchema` and `closedSets`; add `import { submitToGateResultSchema } from './verb-io.ts';` beside them):

```ts
describe('FL-1 FL-2 FL-3 FL-4 the fix claim contracts', () => {
  const requestId = '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11';
  const delegationId = '00000000-0000-4000-8000-0000000000f1';
  const head = 'c'.repeat(40);

  it('FL-1 a harness starts with the fix claim off, and an admin command switches it', () => {
    const older = {
      id: delegationId,
      key: 'tc-admin-app',
      template: 'software',
      jdArea: '80-89',
      repository: 'unfoldingWord/tc-admin-app',
      hostedBuilderEnabled: false,
      paused: false,
    };
    expect(harnessSchema.parse(older)).toMatchObject({ fixClaim: false });
    expect(harnessSchema.parse({ ...older, fixClaim: true })).toMatchObject({ fixClaim: true });
    const command = { command: 'set_fix_claim', requestId, enabled: true };
    expect(commandSchema.parse(command)).toEqual(command);
    expect(commandSchema.safeParse({ command: 'set_fix_claim', requestId }).success).toBe(false);
    expect(eventEvidenceSchemas.fix_claim_set.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it('FL-2 a fix claim records its delegation, its start head and the declaration', () => {
    const claimed = { delegationId, head, declaration: null };
    expect(eventEvidenceSchemas.fix_claimed.parse(claimed)).toEqual(claimed);
    const declared = {
      ...claimed,
      declaration: {
        closes: ['#12'],
        risks: 'the board renders slower on phones',
        touches: 'apps/uw-app/board',
        riskTier: 'standard',
        riskDomains: [],
      },
    };
    expect(eventEvidenceSchemas.fix_claimed.parse(declared)).toEqual(declared);
    expect(eventEvidenceSchemas.fix_claimed.safeParse({ ...claimed, head: 'abc' }).success).toBe(false);
  });

  it('FL-3 a fix is refused with its own reasons, and a passing fix waits for review', () => {
    expect(errorReasonSchema.options.slice(-2)).toEqual(['fix_size_cap', 'fix_keeps_purpose']);
    expect(submitToGateResultSchema.options.at(-1)).toBe('awaiting_review');
  });

  it('FL-4 a run that ran no declared checks fails checks_not_run_locally', () => {
    expect(closedSets.runFailureSchema.options.at(-1)).toBe('checks_not_run_locally');
  });
});
```

If `fullShaSchema` takes another length than 40, use a head the `fixtures/full-sha/valid/` files show. If a later step appended to `errorReasonSchema` after this plan was written, the slice still reads this step's two values because they go last.

In `packages/contracts/events.test.ts`, the vocabulary test's count goes up by two from the number step 16 left (expected 60 to 62); change its title's number word to match.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/contracts/contracts.test.ts packages/contracts/events.test.ts`
Expected: FAIL; `eventEvidenceSchemas.fix_claimed` is undefined and the count differs.

- [ ] **Step 3: Write the contracts**

`packages/contracts/closed-sets.ts`: append `'checks_not_run_locally',` as the last value of `runFailureSchema`.

`packages/contracts/outcomes.ts`: append after the last value of `errorReasonSchema`:

```ts
  'fix_size_cap',
  'fix_keeps_purpose',
```

`packages/contracts/verb-io.ts`:

```ts
export const submitToGateResultSchema = z.enum([
  'advanced',
  'parked',
  'checks_failed',
  'awaiting_review',
]);
```

`packages/contracts/harness.ts`, in `harnessSchema` after the last field steps 14 to 16 added:

```ts
  fixClaim: z.boolean().default(false),
```

`packages/contracts/commands.ts`: append `'set_fix_claim',` as the last value of `commandNames`, and beside `set_hosted_builder` in the bodies:

```ts
  set_fix_claim: body('set_fix_claim', { enabled: z.boolean() }),
```

`packages/contracts/events.ts`: append as the last two values of `eventNames`:

```ts
  'fix_claimed',
  'fix_claim_set',
```

`packages/contracts/event-evidence.ts`: import `pullRequestDeclarationSchema` from `./github.ts`. In `itemEvidence` add:

```ts
  fix_claimed: z.strictObject({
    delegationId: id,
    head,
    declaration: pullRequestDeclarationSchema.nullable(),
  }),
```

(`id` and `head` are the file's own consts, `z.uuid()` and `fullShaSchema`.) In `harnessEvidence`, beside `hosted_builder_set`:

```ts
  fix_claim_set: z.strictObject({ enabled: z.boolean() }),
```

`packages/contracts/index.ts` re-exports each file with `export *`; if it lists names instead, nothing new needs listing (no new schema is exported by name).

- [ ] **Step 4: Add the fixtures**

```bash
printf '"checks_not_run_locally"\n' > packages/contracts/fixtures/run-failure/valid/checks-not-run-locally.json
printf '"fix_size_cap"\n' > packages/contracts/fixtures/error-reason/valid/fix-size-cap.json
printf '"fix_keeps_purpose"\n' > packages/contracts/fixtures/error-reason/valid/fix-keeps-purpose.json
printf '"awaiting_review"\n' > packages/contracts/fixtures/submit-to-gate-result/valid/awaiting-review.json
printf '{\n  "command": "set_fix_claim",\n  "requestId": "00000000-0000-4000-8000-0000000000aa",\n  "enabled": true\n}\n' > packages/contracts/fixtures/command/valid/set-fix-claim.json
printf '{\n  "command": "set_fix_claim",\n  "requestId": "00000000-0000-4000-8000-0000000000aa"\n}\n' > packages/contracts/fixtures/command/invalid/set-fix-claim-without-enabled.json
printf '{\n  "itemId": "00000000-0000-4000-8000-000000000002",\n  "result": "awaiting_review",\n  "failures": []\n}\n' > packages/contracts/verb-fixtures/submit_to_gate/output/valid/awaiting-review.json
node -e '
const fs = require("node:fs");
const dir = "packages/contracts/fixtures/event";
const base = JSON.parse(fs.readFileSync(`${dir}/valid/item-claimed.json`, "utf8"));
const claimed = { ...base, name: "fix_claimed", evidence: {
  delegationId: "00000000-0000-4000-8000-0000000000d1",
  head: "c".repeat(40),
  declaration: JSON.parse(fs.readFileSync("packages/contracts/fixtures/pull-request-declaration/valid/standard-board.json", "utf8")) } };
fs.writeFileSync(`${dir}/valid/fix-claimed.json`, JSON.stringify(claimed, null, 2) + "\n");
fs.writeFileSync(`${dir}/invalid/fix-claimed-short-head.json`, JSON.stringify({ ...claimed, evidence: { ...claimed.evidence, head: "abc" } }, null, 2) + "\n");
const set = JSON.parse(fs.readFileSync(`${dir}/valid/hosted-builder-set.json`, "utf8"));
fs.writeFileSync(`${dir}/valid/fix-claim-set.json`, JSON.stringify({ ...set, name: "fix_claim_set", actor: "human:00000000-0000-4000-8000-000000000001" }, null, 2) + "\n");
const harness = JSON.parse(fs.readFileSync("packages/contracts/fixtures/harness/valid/software.json", "utf8"));
fs.writeFileSync("packages/contracts/fixtures/harness/valid/fix-claim-on.json", JSON.stringify({ ...harness, fixClaim: true }, null, 2) + "\n");
'
npx prettier --write packages/contracts/fixtures packages/contracts/verb-fixtures
```

Before running, open `packages/contracts/fixtures/event/valid/item-claimed.json` and `hosted-builder-set.json` and confirm their shape matches the one quoted in this plan's Step 1 context (`eventId`, `harnessId`, `itemId`, `name`, `position`, `at`, `actor`, `evidence`, `traceId`, `requestId`). If an existing person-written event fixture uses another `actor` form, copy it.

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
const sets = { ...last,
  "run-failure": add("run-failure", ["checks_not_run_locally"]),
  "error-reason": add("error-reason", ["fix_size_cap", "fix_keeps_purpose"]),
  "submit-to-gate-result": add("submit-to-gate-result", ["awaiting_review"]),
  "event-name": add("event-name", ["fix_claimed", "fix_claim_set"]),
  "command-name": add("command-name", ["set_fix_claim"]) };
const sorted = Object.fromEntries(Object.entries(sets).sort(([a], [b]) => a.localeCompare(b)));
lock.versions.push({ version: next, sets: sorted });
fs.writeFileSync(p, JSON.stringify(lock, null, 2) + "\n");
fs.writeFileSync(versionFile, fs.readFileSync(versionFile, "utf8").replace(/CONTRACT_VERSION = .\d+\.\d+\.\d+./, `CONTRACT_VERSION = \x27${next}\x27`));
console.log(next);
'
npx prettier --write packages/contracts/contract-lock.json packages/contracts/version.ts
```

Expected: prints `13.2.0` (the next minor after what step 16 left). A minor, because every change adds a value or a field with a default (S17-R12). If the lock test names an enum the script missed, add it the same way and re-run from a clean lock (`git checkout packages/contracts/contract-lock.json packages/contracts/version.ts` first).

- [ ] **Step 6: Run the contracts tests**

Run: `npx vitest run packages/contracts`
Expected: all green, including `golden fixtures`, `CT-2` for `submit_to_gate`, `CT-3 the contract lock`, `contract version` and the new block.

- [ ] **Step 7: Find every pin of the old version and commit (shared root)**

```bash
grep -rn "13\.1\.0" --include='*.ts' --include='*.sql' packages apps sim tools | grep -v node_modules | grep -v contract-lock.json
```

Use the version you replaced. A `.ts` file that calls `assertLiveContractVersion` with it changes to the new version in this commit; a file that only lists names stays.

```bash
git add packages/contracts
git commit -m "feat(contracts): the fix claim's switch, record, refusals and result (13.2.0)

Shared root packages/contracts. Harness.fixClaim (default off) and the
set_fix_claim command with its fix_claim_set event; the fix_claimed item
event carrying the start head and the declaration; fix_size_cap and
fix_keeps_purpose refusals; the awaiting_review submit result; the
checks_not_run_locally run failure. Additive, so a minor version
(S17-R12).

FL-1 FL-2 FL-3 FL-4."
```

- [ ] **Step 8: The follow-up: every literal the compiler names**

`pnpm check` is red now. Make it green with exactly these changes.

`packages/harness/items/fold.ts`: `unchangedNames` gains `'fix_claimed',` and `'fix_claim_set',` after `'hosted_builder_set',`.

`packages/harness/stages/activate.ts`, `harnessOf`: the literal gains `fixClaim: false,` (S17-R3: activation never turns it on).

Every other `Harness` literal `pnpm check` names (port-contract fixtures that do not go through `harnessSchema.parse`, test helpers): add `fixClaim: false`. `packages/db/store/rows.ts` `toHarness`: leave it to `harnessSchema.parse`'s default until Task 4 binds the column.

A `Record` keyed by `RunFailure`, `ErrorReason` or the submit result that `pnpm check` names (none is expected; the plan's grep found only `type SubmitToGateResult` in `submit.ts`, which widens by itself) gains its entry with the closest existing value's treatment.

Regenerate the islands bundle: `pnpm ui:islands`.

- [ ] **Step 9: Run the checks**

Run: `pnpm check && npx vitest run packages/harness/items/fold.test.ts packages/harness/stages packages/contracts`
Expected: green. `tools/db/drift.test.ts` stays red until Task 3.

- [ ] **Step 10: Commit**

```bash
git add packages/harness apps/uw-app/generated/islands.ts
git commit -m "feat(harness): every harness names its fix claim, off at activation

fix_claimed and fix_claim_set change no item state in the fold; every
harness literal names fixClaim; islands regenerated for 13.2.0.

FL-1 FL-2."
```

---

### Task 3: The column and the migration (shared root `packages/db/schema.ts`)

**Files:**
- Modify: `packages/db/schema.ts` (`harnesses.fix_claim`)
- Create: `packages/db/migrations/00NN_fix_claim.sql` with its snapshot and journal entry (generated)
- Create: `packages/db/fix-claim-columns.test.ts`

**Interfaces:**
- Produces: `harnesses.fix_claim boolean NOT NULL DEFAULT false`, Drizzle field `fixClaim`; `harness_events_name_known`, `command_requests_command_known` and `harness_runs_failure_known` admitting this step's names.

- [ ] **Step 1: Write the failing test**

`packages/db/fix-claim-columns.test.ts`, on the frame of `packages/db/joining-columns.test.ts`:

```ts
import { eq, inArray, sql } from 'drizzle-orm';
import { pgSchema, text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { harnesses } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

const pgConstraints = pgSchema('pg_catalog').table('pg_constraint', { name: text('conname') });

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

function fixClaimColumns(db: () => Db): void {
  it('FL-1 a harness starts with the fix claim off', async () => {
    await db().execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
      VALUES (gen_random_uuid(), 'fix-claim-default', 'software', '80-89', now())`);
    const rows = await db()
      .select({ fixClaim: harnesses.fixClaim })
      .from(harnesses)
      .where(eq(harnesses.key, 'fix-claim-default'));
    expect(rows[0]).toEqual({ fixClaim: false });
  });

  it('FL-1 FL-2 FL-4 admits the new event, command and run-failure names', async () => {
    const checks = await db()
      .select({ name: pgConstraints.name, definition: sql<string>`pg_get_constraintdef(oid)` })
      .from(pgConstraints)
      .where(
        inArray(pgConstraints.name, [
          'harness_events_name_known',
          'command_requests_command_known',
          'harness_runs_failure_known',
        ]),
      );
    const definitions = checks.map((row) => row.definition).join(' ');
    for (const name of ['fix_claimed', 'fix_claim_set', 'set_fix_claim', 'checks_not_run_locally']) {
      expect(definitions).toContain(`'${name}'`);
    }
  });
}

describe('the fix claim column', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => fixClaimColumns(openDatabase(target)),
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/db/fix-claim-columns.test.ts`
Expected: FAIL, column `fix_claim` does not exist.

- [ ] **Step 3: Add the column**

`packages/db/schema.ts`, in `harnesses` after the last column steps 14 to 16 added:

```ts
    fixClaim: boolean('fix_claim').notNull().default(false),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @uw/db exec drizzle-kit generate --name fix_claim`
Expected: one new file `packages/db/migrations/00NN_fix_claim.sql` (the next index after step 16's, expected `0032`) with the column and a drop-and-add of `harness_events_name_known`, `command_requests_command_known` and `harness_runs_failure_known`. Read the file; if it contains anything else, stop and find out why.

- [ ] **Step 5: Run the database tests and the drift test**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run packages/db tools/db/drift.test.ts`
Expected: green, including `migrations`, `the fix claim column` on both targets, and `schema drift`.

- [ ] **Step 6: Commit (shared root)**

```bash
git add packages/db/schema.ts packages/db/migrations packages/db/fix-claim-columns.test.ts
git commit -m "feat(db): harnesses.fix_claim, off by default, and the step's names

Shared root packages/db/schema.ts. The fix claim switch is a harness
column written only by the stage command; the event, command and
run-failure checks admit fix_claimed, fix_claim_set, set_fix_claim and
checks_not_run_locally.

FL-1 FL-2 FL-4. S17-R3."
```

---

### Task 4: The port and its binding (shared roots `store-ports.ts`, `packages/db/store/types.ts`)

**Files:**
- Modify: `packages/harness/store-ports.ts` and `packages/db/store/types.ts` (`HarnessesGateway.write.setFixClaim`) in their own commit
- Modify: `packages/db/store/harnesses.ts` (the binding), `packages/db/store/rows.ts` (`toHarness`)
- Create: `packages/harness/port-contracts/store-fix-claim.ts`
- Modify: `packages/harness/port-contracts/store.ts` (call `describeStoreFixClaim`)

**Interfaces:**
- Produces: `HarnessesGateway.write.setFixClaim(harnessId: string, enabled: boolean): Promise<boolean>`; `toHarness` reads `fixClaim`; the port-contract block `describeStoreFixClaim(adapter, subject)`.

- [ ] **Step 1: Change the ports (shared-root commit)**

`packages/harness/store-ports.ts` and `packages/db/store/types.ts`, in `HarnessesGateway.write` after `setShadow` (and after any setter steps 15 and 16 added):

```ts
    setFixClaim(harnessId: string, enabled: boolean): Promise<boolean>;
```

```bash
git add packages/harness/store-ports.ts packages/db/store/types.ts
git commit -m "feat(harness): the Store learns to switch a harness's fix claim

Shared roots packages/harness/store-ports.ts and its mirror
packages/db/store/types.ts. One write, setFixClaim, for the stage
command that owns the column. The binding follows in the next commit.

FL-1. S17-R3."
```

`pnpm check` is red until Step 4.

- [ ] **Step 2: Write the failing port-contract test**

`packages/harness/port-contracts/store-fix-claim.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Store } from '../ports.ts';
import { at, harnessOf, uid } from './store-gateway-fixtures.ts';

type FixClaimSubject = () => { readonly store: Store };

export function describeStoreFixClaim(adapter: string, subject: FixClaimSubject): void {
  describe(`${adapter} store: the fix claim switch`, () => {
    it('DX-3 FL-1 stores the fix claim off, switches it on and off, and reports a missing harness', async () => {
      const harness = harnessOf(0x7500, 'gateway-fix-claim');
      const read = await subject().store.transaction(async (tx) => {
        await tx.harnesses.write.insert(harness, at);
        const before = await tx.harnesses.read.byId(harness.id);
        const on = await tx.harnesses.write.setFixClaim(harness.id, true);
        const after = await tx.harnesses.read.byId(harness.id);
        const off = await tx.harnesses.write.setFixClaim(harness.id, false);
        const missing = await tx.harnesses.write.setFixClaim(uid(0x75fd), true);
        return { before, on, after, off, missing, last: await tx.harnesses.read.byId(harness.id) };
      });
      expect(read).toEqual({
        before: { ...harness, fixClaim: false },
        on: true,
        after: { ...harness, fixClaim: true },
        off: true,
        missing: false,
        last: { ...harness, fixClaim: false },
      });
    });
  });
}
```

`packages/harness/port-contracts/store.ts`: import it and call `describeStoreFixClaim(adapter, subject);` after the last `describeStore…` call in the block (step 14's `describeStoreJoining` or a later one). If `subject`'s type in `store.ts` is wider than `FixClaimSubject`, it still satisfies it.

- [ ] **Step 3: Run it and see it fail**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run sim/adapters/store.contract.test.ts`
Expected: FAIL to compile (`setFixClaim` is not bound).

- [ ] **Step 4: Bind it**

`packages/db/store/harnesses.ts`, in `write` after `setShadow`:

```ts
      setFixClaim: (harnessId, enabled) =>
        updateHarness(executor, harnessId, { fixClaim: enabled }),
```

`packages/db/store/rows.ts`, `toHarness`: add `fixClaim: row.fixClaim,` after the last field steps 14 to 16 added.

- [ ] **Step 5: Run the Store contract on both adapters**

Run: `pnpm check && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run sim/adapters/store.contract.test.ts apps/uw-app/ports`
Expected: green, including `DX-3 FL-1 stores the fix claim off …` on the sim and the platform adapter (the platform adapter's Store contract test lives under `apps/uw-app/ports/`; run whichever file `grep -rln describeStore apps/uw-app/ports` names).

- [ ] **Step 6: Commit**

```bash
git add packages/db/store packages/harness/port-contracts
git commit -m "feat(db): bind the fix claim switch and read it back on every harness

FL-1. S17-R3."
```

---

### Task 5: FL-1, the switch, and FL-2, the offer and the claim

**Files:**
- Create: `packages/harness/stages/fix-claim.ts`
- Modify: `packages/harness/stages/commands.ts` (`StageCommands.setFixClaim`)
- Modify: `apps/uw-app/commands/person/stages.ts` (`setFixClaimCommand`), `apps/uw-app/commands/registry.ts`
- Modify: `packages/harness/delegations/capability.ts` (`fix` reach; `pageAgrees`)
- Modify: `packages/harness/runs/backoff.ts` (export `setsHead`)
- Create: `packages/harness/items/fix-offer.ts`, `packages/harness/items/fix-claim.ts`
- Modify: `packages/harness/reads/poll.ts` (`claimableIn`'s loop body)
- Modify: `packages/harness/items/claim.ts` (`takeWithFix`, `claimIn`'s last line, `claimWithin`, `claim`)
- Modify: `packages/harness/runs/start.ts` (`Start.fix`, the pre-read in `startRun`, `openRun`)
- Create: `sim/fix-claims.ts`, `sim/kernel/fix-claim.test.ts`, `apps/uw-app/commands/fix-claim.pg.test.ts`
- Create: `sim/scenarios/FL-1.the-fix-claim-is-off-until-an-admin-turns-it-on.ts`, `sim/scenarios/FL-2.a-review-round-offers-the-item-once-to-the-builder-under-a-fix-delegation.ts`

**Interfaces:**
- Consumes: Task 2's contracts; Task 4's `setFixClaim`; step 15's `countsAsRound`; step 16's `delegableExit`, `joinedPullRequest`.
- Produces: `setFixClaim(ports, caller, input: FixClaimInput)`; `fixRound`, `fixOffered`, `onlyByFix`, `offeredForFix`, `roundFindings`; `readFixStart`, `fixClaiming`, `FixRead`, `FixStart`; `claimWithin(ports, tx, caller, input, at, fix = null)`; the sim helpers named in the hand-off table.

- [ ] **Step 1: The sim helpers**

`sim/fix-claims.ts`:

```ts
import type { FindingWeight, Principal, PullRequestDeclaration } from '@uw/contracts';
import type { KernelOutcome } from '@uw/harness';
import { simAgent, simCaller, simDelegate } from './fixtures.ts';
import { reviewWorld, type ReviewWorld } from './review-runs.ts';
import { builderFrontmatter, seedPersona, value } from './runs.ts';
import { greenFacts, shipBase, shipPullRequest, simSha } from './ship-fixtures.ts';
import type { World } from './world.ts';

export const fixerPage = '00000000-0000-4000-8000-000000017001';
export const fixHead = simSha('f1ed');
export const roundText = 'The board drops its empty state.';

export type FixWorld = ReviewWorld & { readonly fixer: Principal; readonly fixId: string };

export type FixOptions = { readonly fixClaim?: boolean; readonly weight?: FindingWeight };

export async function reviewedRound(scene: ReviewWorld, weight: FindingWeight): Promise<void> {
  const input = {
    verdict: 'request_changes' as const,
    findings: [{ text: roundText, weight }],
    resolvedProvider: 'deepinfra',
    resolvedModel: 'z-ai/glm-5.3',
  };
  value(await scene.world.kernel.runs.postReview(scene.host, scene.runId, input));
}

export async function fixWorld(world: World, options: FixOptions = {}): Promise<FixWorld> {
  const scene = await reviewWorld(world);
  await reviewedRound(scene, options.weight ?? 'real');
  if (options.fixClaim !== false) {
    const admin = simCaller(world, scene.admin);
    value(await world.kernel.stages.setFixClaim(admin, { harnessId: scene.harnessId, enabled: true }));
  }
  await seedPersona(scene, { id: fixerPage, frontmatter: builderFrontmatter(scene) });
  const granted = await simDelegate(world, scene.owner, {
    harnessId: scene.harnessId,
    persona: 'agent:builder',
    capability: 'fix',
    expiresAt: null,
    supersedes: null,
  });
  const fixer = simAgent(scene.owner, 'builder', { interactive: false });
  return { ...scene, fixer, fixId: value(granted).id };
}

export function claimFix(scene: FixWorld): Promise<KernelOutcome<unknown>> {
  return scene.world.kernel.items.claim(simCaller(scene.world, scene.fixer), {
    itemId: scene.itemId,
    delegationId: scene.fixId,
  });
}

export async function offeredTo(scene: FixWorld, actor: Principal): Promise<readonly string[]> {
  const polled = await scene.world.kernel.reads.poll(simCaller(scene.world, actor), {
    harnessId: scene.harnessId,
    limit: 10,
  });
  return value(polled).map((entry) => entry.itemId);
}

export function diffText(files: Readonly<Record<string, number>>): string {
  const blocks = Object.entries(files).map(([path, lines]) =>
    [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${lines.toString()} +1,${lines.toString()} @@`,
      ...Array.from({ length: lines }, (_, n) => `+line ${n.toString()}`),
    ].join('\n'),
  );
  return `${blocks.join('\n')}\n`;
}

export type FixChange = {
  readonly pull: Readonly<Record<string, number>>;
  readonly fix: Readonly<Record<string, number>> | null;
  readonly declaration?: PullRequestDeclaration | null;
};

export function pushedFix(scene: FixWorld, change: FixChange): void {
  const { world, itemId } = scene;
  const declared = change.declaration === undefined ? {} : { declaration: change.declaration };
  world.adapters.githubFacts.given(greenFacts(world, { itemId, head: fixHead, reviews: [], ...declared }));
  const pull = { base: shipBase, head: scene.head };
  world.adapters.githubFacts.setDiff(shipPullRequest, pull, diffText(change.pull));
  if (change.fix === null) return;
  const fix = { base: scene.head, head: fixHead };
  world.adapters.githubFacts.setDiff(shipPullRequest, fix, diffText(change.fix));
}

export function submitFix(scene: FixWorld, as: Principal = scene.fixer) {
  return scene.world.kernel.items.submit(simCaller(scene.world, as), {
    itemId: scene.itemId,
    to: null,
    evidence: {},
    change: { pullRequest: shipPullRequest, head: fixHead },
  });
}
```

`reviewWorld` (step 15's version, which posts weighted findings) leaves the Reviewer's run holding the item at Check with `greenFacts` at `reviewHead`; `postReview` completes the run and releases the item. If step 15 changed `reviewWorld`'s second argument, pass nothing (the default `approveAt` is `no_real_or_plausible`, under which a `real` finding posts `request_changes`). The persona page is seeded before `simDelegate`, because `seedActivePersona` keeps a projection that already exists; `builderFrontmatter` says `capability: 'build'`, which a `fix` delegation agrees with (S17-R1). If `FactsInput` in `sim/ship-fixtures.ts` does not take `declaration`, read it: `greenFacts` already reads `input.declaration`, so the field exists.

- [ ] **Step 2: Write the failing kernel tests**

`sim/kernel/fix-claim.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simAgent, simCaller, simPerson } from '../fixtures.ts';
import { claimFix, fixWorld, offeredTo, type FixOptions, type FixWorld } from '../fix-claims.ts';
import { itemEvents, itemOf } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inScene(options: FixOptions, work: (scene: FixWorld) => Promise<void>) {
  const world = await createWorld();
  try {
    await work(await fixWorld(world, options));
  } finally {
    await world.close();
  }
}

function author(scene: FixWorld) {
  return simAgent(scene.admin, `${scene.admin.personId ?? ''}/builder`, { interactive: true });
}

async function names(scene: FixWorld): Promise<readonly string[]> {
  return (await itemEvents(scene, scene.itemId)).map((event) => event.name);
}

describe('FL-1 the fix claim is off until an admin turns it on', () => {
  it('FL-1 an admin switches it with one event; the same state again records nothing', () =>
    inScene({ fixClaim: false }, async (scene) => {
      const admin = simCaller(scene.world, scene.admin);
      const input = { harnessId: scene.harnessId, enabled: true };
      expect(await scene.world.kernel.stages.setFixClaim(admin, input)).toMatchObject({
        status: 'accepted',
        value: { harness: { fixClaim: true } },
      });
      await scene.world.kernel.stages.setFixClaim(admin, input);
      const events = await scene.world.adapters.store.transaction((tx) =>
        tx.harnessEvents.read.page({ harnessId: scene.harnessId, itemId: null, after: 0, limit: 100 }),
      );
      expect(events.filter((event) => event.name === 'fix_claim_set')).toHaveLength(1);
    }));

  it('FL-1 an editor and an agent cannot switch it', () =>
    inScene({ fixClaim: false }, async (scene) => {
      const editor = await simPerson(scene.world, 7, [
        { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
      ]);
      const input = { harnessId: scene.harnessId, enabled: true };
      for (const actor of [editor, scene.fixer]) {
        const outcome = await scene.world.kernel.stages.setFixClaim(simCaller(scene.world, actor), input);
        expect(outcome.status).toBe('error');
      }
    }));

  it('FL-1 while it is off the Builder is never offered the reviewed item and its fix claim is refused', () =>
    inScene({ fixClaim: false }, async (scene) => {
      expect(await offeredTo(scene, scene.fixer)).not.toContain(scene.itemId);
      expect(await claimFix(scene)).toMatchObject({
        status: 'error',
        reason: 'pickup_not_allowed',
        detail: { capability: 'fix', why: 'fix_claim_off' },
      });
      expect(await names(scene)).not.toContain('fix_claimed');
    }));
});

describe('FL-2 a review round offers the item once to the Builder under a fix delegation', () => {
  it('FL-2 after a real finding the Builder is offered the item and takes it, recording head and declaration', () =>
    inScene({}, async (scene) => {
      expect(await offeredTo(scene, scene.fixer)).toContain(scene.itemId);
      expect(await claimFix(scene)).toMatchObject({ status: 'accepted' });
      const events = await itemEvents(scene, scene.itemId);
      const claimed = events.findLast((event) => event.name === 'fix_claimed');
      expect(claimed?.evidence).toMatchObject({ delegationId: scene.fixId, head: scene.head });
      expect(claimed?.evidence['declaration']).toMatchObject({ riskTier: 'standard' });
      expect(await itemOf(scene.world, scene.itemId)).toMatchObject({
        holder: scene.fixer.identity,
        delegationId: scene.fixId,
      });
    }));

  it('FL-2 a round of theoretical findings only offers nothing', () =>
    inScene({ weight: 'theoretical' }, async (scene) => {
      expect(await offeredTo(scene, scene.fixer)).not.toContain(scene.itemId);
      expect(await claimFix(scene)).toMatchObject({
        status: 'error',
        reason: 'pickup_not_allowed',
        detail: { why: 'no_review_round' },
      });
    }));

  it('FL-2 one identity holds the branch: each claim is refused lease_held while the other is live', () =>
    inScene({}, async (scene) => {
      const byAuthor = simCaller(scene.world, author(scene));
      expect(await claimFix(scene)).toMatchObject({ status: 'accepted' });
      const claimed = await scene.world.kernel.items.claim(byAuthor, { itemId: scene.itemId, delegationId: null });
      expect(claimed).toMatchObject({ status: 'error', reason: 'lease_held' });
    }));

  it('FL-2 the fixer is refused lease_held while the author holds the item', () =>
    inScene({}, async (scene) => {
      const byAuthor = simCaller(scene.world, author(scene));
      expect(
        await scene.world.kernel.items.claim(byAuthor, { itemId: scene.itemId, delegationId: null }),
      ).toMatchObject({ status: 'accepted' });
      expect(await offeredTo(scene, scene.fixer)).not.toContain(scene.itemId);
      expect(await claimFix(scene)).toMatchObject({ status: 'error', reason: 'lease_held' });
    }));

  it('FL-2 one fix claim per round: once released, the round is not offered again', () =>
    inScene({}, async (scene) => {
      expect(await claimFix(scene)).toMatchObject({ status: 'accepted' });
      const released = await scene.world.kernel.items.release(simCaller(scene.world, scene.fixer), {
        itemId: scene.itemId,
        delegationId: scene.fixId,
      });
      expect(released.status).toBe('accepted');
      expect(await offeredTo(scene, scene.fixer)).not.toContain(scene.itemId);
      expect(await claimFix(scene)).toMatchObject({
        status: 'error',
        reason: 'pickup_not_allowed',
        detail: { why: 'no_review_round' },
      });
    }));
});
```

If `harnessEvents.read.page`'s argument has another shape, read harness-level events the way `sim/runs.ts`'s `harnessNames` does. If `kernel.items.release` names its input differently, read `packages/harness/items/commands.ts`.

- [ ] **Step 3: Run them and see them fail**

Run: `npx vitest run sim/kernel/fix-claim.test.ts`
Expected: FAIL to compile; `kernel.stages.setFixClaim` does not exist.

- [ ] **Step 4: The switch**

`packages/harness/stages/fix-claim.ts`:

```ts
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import type { HarnessScene } from '../reads/scene.ts';
import { adminRefusal, agentRefusal } from './rules.ts';

type SwitchPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type FixClaimInput = { readonly harnessId: string; readonly enabled: boolean };

export async function setFixClaim(
  ports: SwitchPorts,
  caller: Caller,
  input: FixClaimInput,
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
    if (harness.fixClaim === input.enabled) return accepted({ harness, stages });
    if (!(await tx.harnesses.write.setFixClaim(harness.id, input.enabled))) {
      return refused('harness_not_found', { harnessId: harness.id });
    }
    await recordHarnessEvents(tx, recordContext(ports, caller, at), harness.id, [
      draft('fix_claim_set', { enabled: input.enabled }),
    ]);
    return accepted({ harness: { ...harness, fixClaim: input.enabled }, stages });
  });
}
```

`packages/harness/stages/commands.ts`: import `setFixClaim`, `type FixClaimInput` from `./fix-claim.ts`; `StageCommands` gains `setFixClaim(caller: Caller, input: FixClaimInput): Promise<KernelOutcome<HarnessScene>>;`; the factory gains `setFixClaim: (caller, input) => setFixClaim(ports, caller, input),`.

`apps/uw-app/commands/person/stages.ts`, after `setHostedBuilderCommand`:

```ts
export const setFixClaimCommand = commandHandler({
  name: 'set_fix_claim',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'set_fix_claim'>) =>
    fromKernel(await kernel.stages.setFixClaim(caller, { harnessId, enabled: body.enabled })),
});
```

`apps/uw-app/commands/registry.ts`: import `setFixClaimCommand` with the other stage commands and add it to `commandRegistry` after `setShadowCommand` (or the last stage command a later step added).

- [ ] **Step 5: The reach and the offer**

`packages/harness/delegations/capability.ts`:

```ts
import type { CapabilityWord, StageBracket } from '@uw/contracts';
import type { Delegation, PageFacts } from '../ports.ts';

const reach: ReadonlyMap<CapabilityWord, ReadonlySet<StageBracket>> = new Map([
  ['none', new Set<StageBracket>()],
  ['build', new Set<StageBracket>(['build_package'])],
  ['review', new Set<StageBracket>(['build_package'])],
  ['iterate', new Set<StageBracket>(['iterate'])],
  ['fix', new Set<StageBracket>(['build_package'])],
]);

const lentTo: ReadonlyMap<CapabilityWord, CapabilityWord> = new Map([['fix', 'build']]);

export function capabilityReaches(capability: CapabilityWord, bracket: StageBracket): boolean {
  return reach.get(capability)?.has(bracket) ?? false;
}

export function pageAgrees(page: PageFacts | null, delegation: Delegation): boolean {
  if (page === null) return true;
  const wanted = lentTo.get(delegation.capability) ?? delegation.capability;
  return page.frontmatter['capability'] === wanted;
}
```

Keep any line step 16 added to this file.

`packages/harness/runs/backoff.ts`: export the existing `setsHead` (`export function setsHead`), unchanged otherwise.

`packages/harness/items/fix-offer.ts`:

```ts
import {
  eventEvidenceSchemas,
  type CapabilityWord,
  type Harness,
  type HarnessEvent,
  type ItemState,
  type ReviewRecord,
  type Stage,
} from '@uw/contracts';
import { capabilityReaches } from '../delegations/capability.ts';
import { delegableExit } from '../gates/delegable.ts';
import { joinedPullRequest } from '../gates/ship-input.ts';
import type { StoreTransaction } from '../ports.ts';
import { setsHead } from '../runs/backoff.ts';
import { countsAsRound } from '../runs/weights.ts';
import { readAllEvents } from './record.ts';

export type FixRound = { readonly review: ReviewRecord | null; readonly claimed: boolean };

const leavesStage: ReadonlySet<string> = new Set(['stage_advanced', 'loop_edge_taken']);
const closed: FixRound = { review: null, claimed: false };

function countedReview(event: HarnessEvent): ReviewRecord | null {
  if (event.name !== 'run_completed') return null;
  const { result, review } = eventEvidenceSchemas.run_completed.parse(event.evidence);
  return result === 'review_posted' && review !== null && countsAsRound(review) ? review : null;
}

function nextRound(round: FixRound, event: HarnessEvent): FixRound {
  if (setsHead(event) || leavesStage.has(event.name)) return closed;
  if (event.name === 'fix_claimed') return { ...round, claimed: round.review !== null };
  const review = countedReview(event);
  return review === null ? round : { review, claimed: false };
}

export function fixRound(events: readonly HarnessEvent[]): FixRound {
  return events.reduce(nextRound, closed);
}

export function fixOffered(
  harness: Harness,
  item: ItemState,
  events: readonly HarnessEvent[],
): boolean {
  if (!harness.fixClaim || harness.shadow) return false;
  if (item.pullRequest === null || item.expectedHead === null || joinedPullRequest(item)) {
    return false;
  }
  const round = fixRound(events);
  return round.review !== null && !round.claimed;
}

export function onlyByFix(stage: Stage, reach: ReadonlySet<CapabilityWord> | null): boolean {
  if (reach === null || !reach.has('fix') || delegableExit(stage)) return false;
  return ![...reach].some(
    (capability) => capability !== 'fix' && capabilityReaches(capability, stage.bracket),
  );
}

export async function offeredForFix(
  tx: StoreTransaction,
  harness: Harness,
  reach: ReadonlySet<CapabilityWord> | null,
  stages: readonly Stage[],
  item: ItemState,
): Promise<boolean> {
  const stage = stages.find((entry) => entry.key === item.stageKey);
  if (stage === undefined || !onlyByFix(stage, reach)) return true;
  return fixOffered(harness, item, await readAllEvents(tx, item.harnessId, item.itemId));
}

export function roundFindings(events: readonly HarnessEvent[]): readonly string[] {
  const { review } = fixRound(events);
  if (review === null) return [];
  return review.findings
    .filter((finding) => finding.weight !== 'theoretical')
    .map((finding) => `${finding.weight}: ${finding.text}`);
}
```

`offeredForFix` takes five parameters, the limit; if a later edit needs a sixth, pass `{ harness, reach }` as one object.

`packages/harness/reads/poll.ts`: import `offeredForFix` from `../items/fix-offer.ts`. In `claimableIn`, keep the `for (const item of items.filter(…))` line exactly as it is (step 18 replaces it) and replace only the loop body `if (!(await heldForPerson(tx, item))) open.push(item);` with:

```ts
    if (await heldForPerson(tx, item)) continue;
    if (await offeredForFix(tx, harness, judged.reach, stages, item)) open.push(item);
```

- [ ] **Step 6: The claim**

`packages/harness/items/fix-claim.ts`:

```ts
import type { Harness, ItemState, PullRequestDeclaration, Stage } from '@uw/contracts';
import { factsFailure } from '../gates/facts-failure.ts';
import { refused, type Refused } from '../outcome.ts';
import type { Ports, PullRequestRef, StoreTransaction } from '../ports.ts';
import { fixOffered } from './fix-offer.ts';
import { draft, readAllEvents, type EventDraft } from './record.ts';

type FixPorts = Pick<Ports, 'githubFacts' | 'store'>;

export type FixStart = { readonly declared: PullRequestDeclaration | null };
export type FixRead = FixStart | { readonly refusal: Refused } | null;

type Target = { readonly ref: PullRequestRef | null };
type FixScene = { readonly harness: Harness; readonly stage: Stage };
type Fixing = { readonly delegationId: string | null; readonly fix: FixRead };
type Claiming = { readonly drafts: readonly EventDraft[] };

const notFixing: Claiming = { drafts: [] };

async function fixTarget(
  ports: FixPorts,
  itemId: string,
  delegationId: string | null,
): Promise<Target | null> {
  if (delegationId === null) return null;
  return ports.store.transaction(async (tx) => {
    const delegation = await tx.delegations.read.byId(delegationId);
    if (delegation?.capability !== 'fix') return null;
    const item = await tx.harnessItems.read.byId(itemId);
    return { ref: item?.pullRequest ?? null };
  });
}

export async function readFixStart(
  ports: FixPorts,
  itemId: string,
  delegationId: string | null,
): Promise<FixRead> {
  const target = await fixTarget(ports, itemId, delegationId);
  if (target === null) return null;
  if (target.ref === null) return { declared: null };
  try {
    const facts = await ports.githubFacts.pullRequest(target.ref);
    if (facts === null) return { refusal: refused('not_permitted', { why: 'pull_request_unknown' }) };
    return { declared: facts.declaration };
  } catch (error) {
    return { refusal: factsFailure(error) };
  }
}

function notOffered(scene: FixScene): Refused {
  const why = scene.harness.fixClaim ? 'no_review_round' : 'fix_claim_off';
  return refused('pickup_not_allowed', { stage: scene.stage.key, capability: 'fix', why });
}

export async function fixClaiming(
  tx: StoreTransaction,
  scene: FixScene,
  item: ItemState,
  fixing: Fixing,
): Promise<Claiming | Refused> {
  const { delegationId, fix } = fixing;
  if (delegationId === null) return notFixing;
  const delegation = await tx.delegations.read.byId(delegationId);
  if (delegation?.capability !== 'fix') return notFixing;
  const head = item.expectedHead;
  const events = await readAllEvents(tx, item.harnessId, item.itemId);
  if (head === null || !fixOffered(scene.harness, item, events) || fix === null) {
    return notOffered(scene);
  }
  if ('refusal' in fix) return fix.refusal;
  return { drafts: [draft('fix_claimed', { delegationId, head, declaration: fix.declared })] };
}
```

`packages/harness/items/claim.ts`: import `fixClaiming`, `readFixStart`, `type FixRead` from `./fix-claim.ts`. Add below `takeClaim`:

```ts
async function takeWithFix(
  tx: StoreTransaction,
  scene: Scene,
  item: ItemState,
  taking: Taking & { readonly fix: FixRead },
): Promise<KernelOutcome<ClaimTaken>> {
  const fixing = await fixClaiming(tx, scene, item, taking);
  if ('status' in fixing) return fixing;
  const taken = await takeClaim(tx, scene, item, taking);
  if (taken.status !== 'accepted') return taken;
  return accepted({ ...taken.value, drafts: [...taken.value.drafts, ...fixing.drafts] });
}
```

`claimIn`'s bag becomes `{ input, tip, fix }: { readonly input: ClaimInput; readonly tip: BranchTip | null; readonly fix: FixRead }` and its last line becomes:

```ts
  return takeWithFix(tx, locked, item, { delegationId: input.delegationId, tip, fix });
```

Leave `heldRefusal`, `capabilityRefusal` and every guard step 16 added as they are.

`claimWithin` gains a sixth parameter and passes it:

```ts
export function claimWithin(
  ports: ClaimPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: ClaimInput,
  at: Date,
  fix: FixRead = null,
): Promise<KernelOutcome<ClaimTaken>> {
  return claimIn(ports, tx, caller, { input, tip: null, fix }, at);
}
```

The `max-params` rule allows five; if it refuses six, change `claimWithin` to take `(ports, tx, caller, claiming: { readonly input: ClaimInput; readonly at: Date; readonly fix?: FixRead })` and update its one caller in `start.ts` to match.

`claim`: after the `tip` line add `const fix = await readFixStart(ports, input.itemId, input.delegationId);` and pass `{ input, tip, fix }` to `claimIn`.

`packages/harness/runs/start.ts`: import `readFixStart`, `type FixRead` from `../items/fix-claim.ts`. `Start` gains `readonly fix: FixRead;`. In `startRun`, before the `start` constant:

```ts
  const fix = await readFixStart(ports, input.itemId, input.delegationId);
  if (fix !== null && 'refusal' in fix) return fix.refusal;
```

and `start` becomes `{ caller, input, fix, runId: ports.ids.next(), traceId: ports.ids.next() }`. In `openRun`, the claim becomes `await claimWithin(ports, tx, acting, input, at, start.fix)` (destructure `fix` from `start` with the others if the function reads them that way).

- [ ] **Step 7: The scenarios and the command test**

`sim/scenarios/FL-1.the-fix-claim-is-off-until-an-admin-turns-it-on.ts` (id `'FL-1'`, written like `sim/scenarios/KN-13.agent-cannot-write-decision.ts`): `fixWorld(world, { fixClaim: false })`; assert with `assert.deepEqual` that the fixer's poll does not hold the item and `claimFix` refuses `pickup_not_allowed`; then the admin's `setFixClaim` on, and the poll holds it. Return `{ state: { offeredWhileOff, offeredWhenOn } }`.

`sim/scenarios/FL-2.a-review-round-offers-the-item-once-to-the-builder-under-a-fix-delegation.ts` (id `'FL-2'`): `fixWorld(world)`; claim; release; claim again refused `no_review_round`; return `{ state: { first, second } }` with the two statuses and the `fix_claimed` count.

`apps/uw-app/commands/fix-claim.pg.test.ts`, on the frame of `hostedBuilderSwitch` in `apps/uw-app/commands/runs.pg.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { command, eventsNamed, softwareHarness } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const IAN_EMAIL = 'ian.lindsley@unfoldingword.org';

async function fixClaimSwitch(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const requestId = randomUUID();
  const byEditor = await command(db, scene.editor, scene.harnessId, 'set_fix_claim', {
    requestId,
    enabled: true,
  });
  expect(byEditor.body).toEqual({ status: 'error', requestId, reason: 'not_permitted' });
  const fresh = { requestId: randomUUID(), enabled: true };
  const byAdmin = await command(db, { email: IAN_EMAIL }, scene.harnessId, 'set_fix_claim', fresh);
  expect(byAdmin.body).toEqual({ status: 'accepted', requestId: fresh.requestId });
  const [set] = await eventsNamed(db, scene.harnessId, 'fix_claim_set');
  expect(set).toMatchObject({ evidence: { enabled: true }, requestId: fresh.requestId });
}

describe.skipIf(!testServer)('the fix claim switch', () => {
  it('FL-1 an admin turns the fix claim on through set_fix_claim; an editor is refused not_permitted', () =>
    withAppDatabase(fixClaimSwitch));
});
```

- [ ] **Step 8: Run the tests**

Run: `pnpm check && npx vitest run sim/kernel/fix-claim.test.ts sim/kernel/claim.test.ts sim/kernel/capability-brackets.test.ts sim/kernel/reads.test.ts sim/kernel/run-start.test.ts sim/kernel/run-beat.test.ts` then `pnpm sim -- FL-1 && pnpm sim -- FL-2 && pnpm sim -- KN-5 && pnpm sim -- AB-4 && pnpm sim -- all`
Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/commands/fix-claim.pg.test.ts apps/uw-app/commands/registry.test.ts`
Expected: green. KN-5 and AB-4 hold: a `build` delegation is offered and claims exactly what it did before, because `onlyByFix` is false for any reach without `fix`.

- [ ] **Step 9: Commit**

```bash
git add packages/harness apps/uw-app/commands sim
git commit -m "feat(harness): a review round offers the item once to the Builder under a fix delegation

An admin switches the fix claim with set_fix_claim. While it is on and
out of shadow, a counted review round on an item with its own branch
opens it: poll_queue offers it to a persona whose reach is fix, and
claim_item with a live fix delegation takes it, recording fix_claimed
with the reviewed head and the pull request's declaration, read before
the claim's transaction on both claim paths. One fix claim per round;
KN-5 still lets one identity hold the branch.

FL-1 FL-2. S17-R1 S17-R2 S17-R3 S17-R4."
```

---

### Task 6: The offer's pure rules, tested at the interface

**Files:**
- Create: `packages/harness/items/fix-offer.test.ts`

**Interfaces:**
- Consumes: Task 5's `fixRound`, `fixOffered`, `onlyByFix`, `roundFindings`.

- [ ] **Step 1: Write the tests**

`packages/harness/items/fix-offer.test.ts`:

```ts
import {
  harnessSchema,
  itemStateSchema,
  stageSchema,
  type EventName,
  type HarnessEvent,
  type ReviewFinding,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { fixOffered, fixRound, onlyByFix, roundFindings } from './fix-offer.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000b1';
const head = 'c'.repeat(40);
let position = 0;

function event(name: EventName, evidence: HarnessEvent['evidence']): HarnessEvent {
  position += 1;
  return {
    eventId: `00000000-0000-4000-8000-${position.toString().padStart(12, '0')}`,
    harnessId,
    itemId,
    name,
    position,
    at: '2026-10-15T09:00:00.000Z',
    actor: 'agent:reviewer',
    evidence,
    traceId: '00000000-0000-4000-8000-0000000000c1',
    requestId: null,
  };
}

function round(findings: readonly ReviewFinding[], verdict = 'request_changes'): HarnessEvent {
  const review = {
    reviewer: 'uw-reviewer[bot]',
    provider: 'deepinfra',
    model: 'z-ai/glm-5.3',
    verdict,
    reviewId: 9300000001,
    findings: findings.map((finding) => ({ ...finding })),
  };
  return event('run_completed', { runId: itemId, result: 'review_posted', gates: [], review });
}

const real: ReviewFinding = { text: 'The lease is never renewed.', weight: 'real' };
const theoretical: ReviewFinding = { text: 'A year of skew breaks it.', weight: 'theoretical' };
const submitted = event('submitted_to_gate', {
  stage: 'check',
  result: 'advanced',
  to: null,
  expectedHead: head,
  pullRequest: null,
  evidence: {},
});
const advanced = event('stage_advanced', { from: 'check', to: 'ship' });
const claimed = event('fix_claimed', { delegationId: itemId, head, declaration: null });

const harness = harnessSchema.parse({
  id: harnessId,
  key: 'board',
  template: 'software',
  jdArea: '80-89',
  repository: 'unfoldingWord/uw-platform',
  hostedBuilderEnabled: false,
  paused: false,
  fixClaim: true,
});

function stage(key: string, change: Record<string, unknown> = {}) {
  return stageSchema.parse({
    id: '00000000-0000-4000-8000-0000000000d1',
    harnessId,
    key,
    title: key,
    position: 50,
    bracket: 'build_package',
    agentPickup: 'allowed',
    exitGate: 'checks',
    connector: 'none',
    validators: [],
    feeds: [],
    wipLimit: 3,
    paused: false,
    ...change,
  });
}
```

```ts
const item = itemStateSchema.parse({
  itemId,
  harnessId,
  stageKey: 'check',
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
  branchState: 'active',
  expectedHead: head,
  riskTier: null,
  riskDomains: [],
  pullRequest: { repo: 'unfoldingWord/uw-platform', number: 42 },
  issue: null,
  zulipTopic: null,
});
```

If a step before this one added a required field to `itemStateSchema`, `parse` names it: add it with the value its default or its fixture uses.

```ts
describe('FL-2 the rules that open a fix', () => {
  it('FL-2 a counted round opens the fix, and a theoretical or approving round does not', () => {
    expect(fixRound([submitted, round([real])]).review).not.toBeNull();
    expect(fixRound([submitted, round([theoretical])]).review).toBeNull();
    expect(fixRound([submitted, round([real], 'approve')]).review).toBeNull();
  });

  it('FL-2 a new head or a stage change closes the round, and a fix claim spends it', () => {
    expect(fixRound([round([real]), submitted]).review).toBeNull();
    expect(fixRound([round([real]), advanced]).review).toBeNull();
    expect(fixRound([round([real]), claimed])).toMatchObject({ claimed: true });
    expect(fixRound([round([real]), claimed, submitted, round([real])])).toMatchObject({
      claimed: false,
    });
  });

  it('FL-1 FL-2 the harness switch, shadow mode and a joined pull request each close the offer', () => {
    const open = [submitted, round([real])];
    expect(fixOffered(harness, item, open)).toBe(true);
    expect(fixOffered({ ...harness, fixClaim: false }, item, open)).toBe(false);
    expect(fixOffered({ ...harness, shadow: true }, item, open)).toBe(false);
    expect(fixOffered(harness, { ...item, branchState: 'none' }, open)).toBe(false);
    expect(fixOffered(harness, { ...item, pullRequest: null }, open)).toBe(false);
  });

  it('FL-2 only the fix reach is gated, and a fix never reaches a delegable exit', () => {
    const check = stage('check');
    expect(onlyByFix(check, new Set(['fix']))).toBe(true);
    expect(onlyByFix(check, new Set(['fix', 'build']))).toBe(false);
    expect(onlyByFix(check, new Set(['build']))).toBe(false);
    expect(onlyByFix(check, null)).toBe(false);
    const ship = stage('ship', { bracket: 'deploy_package', agentPickup: 'none', exitGate: 'human_approval', connector: 'merge' });
    expect(onlyByFix(ship, new Set(['fix']))).toBe(false);
  });

  it('FL-4 the fix reads the round findings that are real or plausible, with their weight', () => {
    const plausible: ReviewFinding = { text: 'The empty state may drop.', weight: 'plausible' };
    expect(roundFindings([round([real, theoretical, plausible])])).toEqual([
      'real: The lease is never renewed.',
      'plausible: The empty state may drop.',
    ]);
    expect(roundFindings([round([real]), submitted])).toEqual([]);
  });
});
```

`onlyByFix(ship, …)` is false because the merge Ship stage is a `delegableExit` (step 16). `fixOffered` with `branchState: 'none'` and a pull request is `joinedPullRequest` (S16-R10).

- [ ] **Step 2: Run them**

Run: `npx vitest run packages/harness/items/fix-offer.test.ts`
Expected: green (Task 5 wrote the code). Then break `nextRound` by deleting the `fix_claimed` line and run again: the "spends it" test fails. Restore it and record "red once" in the tracker evidence (Task 11).

- [ ] **Step 3: Commit**

```bash
git add packages/harness/items/fix-offer.test.ts
git commit -m "test(harness): the rules that open a fix, at their interface

FL-1 FL-2 FL-4. S17-R2."
```

---

### Task 7: FL-3, the two validators and the submit from a fix claim

**Files:**
- Create: `packages/harness/github/diff-stat.ts`, `packages/harness/github/diff-stat.test.ts`
- Create: `packages/harness/validators/fix.ts`, `packages/harness/validators/fix.test.ts`
- Modify: `packages/harness/validators/context.ts` (`FixContext`, `ValidationContext.fix`), `packages/harness/validators/registry.ts` (two entries, `FIX_VALIDATORS`)
- Create: `packages/harness/items/fix-submit.ts`
- Modify: `packages/harness/items/submit.ts` (`Command.fix`, the pre-read, `handlerOf`, `awaitReview`)
- Create: `sim/kernel/fix-validators.test.ts`, `sim/scenarios/FL-3.a-fix-over-the-cap-or-off-purpose-is-refused-and-releases-the-claim.ts`

**Interfaces:**
- Consumes: Task 5's `fixWorld`, `claimFix`, `pushedFix`, `submitFix`; Task 2's `awaiting_review`, `fix_size_cap`, `fix_keeps_purpose`.
- Produces: `diffStat(text): DiffStat`; `fixSizeCap`, `fixKeepsPurpose`, `sameDeclaration`, `testOrDoc`; `FIX_VALIDATORS = ['fix_size_cap', 'fix_keeps_purpose'] as const`; `FixContext`; `readFixDiffs`, `fixRefusal`, `FixDiffs`.

- [ ] **Step 1: Write the failing unit tests**

`packages/harness/github/diff-stat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { diffStat } from './diff-stat.ts';

const diff = [
  'diff --git a/apps/board.tsx b/apps/board.tsx',
  'index 1111111..2222222 100644',
  '--- a/apps/board.tsx',
  '+++ b/apps/board.tsx',
  '@@ -1,3 +1,4 @@',
  ' unchanged',
  '-old line',
  '+new line',
  '++++ a line that starts with three pluses',
  '\\ No newline at end of file',
  'diff --git a/old/name.ts b/new/name.ts',
  'similarity index 90%',
  'rename from old/name.ts',
  'rename to new/name.ts',
  '',
].join('\n');

describe('FL-3 a diff is measured in changed lines and touched paths', () => {
  it('FL-3 counts plus and minus lines inside hunks only, and names both sides of a rename', () => {
    expect(diffStat(diff)).toEqual({
      lines: 3,
      paths: ['apps/board.tsx', 'old/name.ts', 'new/name.ts'],
    });
  });

  it('FL-3 an empty diff changes nothing', () => {
    expect(diffStat('')).toEqual({ lines: 0, paths: [] });
  });
});
```

`packages/harness/validators/fix.test.ts`:

```ts
import type { PullRequestDeclaration } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { FixContext, ValidationContext } from './context.ts';
import { fixKeepsPurpose, fixSizeCap, sameDeclaration, testOrDoc } from './fix.ts';
import { FIX_VALIDATORS, runValidators, validatorRegistry } from './registry.ts';

const declaration: PullRequestDeclaration = {
  closes: ['#12', '#14'],
  risks: 'the board renders slower on phones',
  touches: 'apps/uw-app/board',
  riskTier: 'standard',
  riskDomains: [],
};

const fits: FixContext = {
  pull: { lines: 40, paths: ['apps/board.tsx', 'apps/lane.tsx'] },
  fix: { lines: 10, paths: ['apps/board.tsx', 'apps/board.test.tsx', 'docs/board.md'] },
  declared: declaration,
  declaration,
  claimed: true,
};

function context(fix: FixContext | null): ValidationContext {
  const item = {} as never;
  return { item, events: [], pages: new Map(), attaching: [], fix };
}

describe('FL-3 fix_size_cap and fix_keeps_purpose', () => {
  it('FL-3 both are in the validator registry and pass a fix that keeps to the rules', () => {
    expect(FIX_VALIDATORS.every((key) => validatorRegistry.has(key))).toBe(true);
    expect(runValidators(FIX_VALIDATORS, context(fits))).toEqual([]);
  });

  it('FL-3 fix_size_cap refuses more than a quarter of the pull request lines', () => {
    const over = { ...fits, fix: { ...fits.fix, lines: 11 } } as FixContext;
    expect(fixSizeCap(context(over))).toEqual([
      "fix_size_cap: the fix changes 11 lines, more than a quarter of the pull request's 40",
    ]);
  });

  it('FL-3 fix_size_cap refuses a file the pull request does not touch, but not a test or a doc', () => {
    const wider = { ...fits, fix: { lines: 4, paths: ['apps/billing.ts', 'apps/x.spec.ts'] } };
    expect(fixSizeCap(context(wider))).toEqual([
      'fix_size_cap: the fix touches apps/billing.ts, which the pull request does not',
    ]);
    for (const path of ['tests/board.ts', 'src/__tests__/a.ts', 'a.pg.test.ts', 'docs/a.txt', 'README.md']) {
      expect(testOrDoc(path)).toBe(true);
    }
    expect(testOrDoc('apps/contest.ts')).toBe(false);
  });

  it('FL-3 fix_size_cap refuses a fix it cannot measure', () => {
    expect(fixSizeCap(context({ ...fits, fix: null }))).toHaveLength(1);
    expect(fixSizeCap(context({ ...fits, pull: null }))[0]).toMatch(/^fix_size_cap: /);
  });

  it('FL-3 fix_keeps_purpose refuses a changed declaration and reads closes as a set', () => {
    const reordered = { ...declaration, closes: ['#14', '#12'] };
    expect(sameDeclaration(declaration, reordered)).toBe(true);
    const changed = { ...fits, declaration: { ...declaration, touches: 'apps/uw-app/billing' } };
    expect(fixKeepsPurpose(context(changed))).toEqual([
      'fix_keeps_purpose: the pull request declaration changed since the fix was claimed',
    ]);
    expect(fixKeepsPurpose(context({ ...fits, declared: null, declaration: null }))).toEqual([]);
    expect(fixKeepsPurpose(context({ ...fits, claimed: false }))).toHaveLength(1);
  });

  it('FL-3 outside a fix both validators pass', () => {
    expect(runValidators(FIX_VALIDATORS, context(null))).toEqual([]);
  });
});
```

`{} as never` stands for an `ItemState` the validators never read; if the lint forbids it, build one with `itemStateSchema.parse` from the first file in `packages/contracts/fixtures/item-state/valid/`. The `as FixContext` on `over` is a widening, not a cast through `unknown`; if lint refuses it, spell the object out in full.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/harness/github/diff-stat.test.ts packages/harness/validators/fix.test.ts`
Expected: FAIL; the modules do not exist.

- [ ] **Step 3: The measure and the validators**

`packages/harness/github/diff-stat.ts`:

```ts
export type DiffStat = { readonly lines: number; readonly paths: readonly string[] };

const fileHeader = /^diff --git a\/(.+) b\/(.+)$/u;

export function diffStat(text: string): DiffStat {
  const paths = new Set<string>();
  let lines = 0;
  let inHunk = false;
  for (const line of text.split('\n')) {
    const header = fileHeader.exec(line);
    if (header !== null) {
      for (const path of header.slice(1)) paths.add(path);
      inHunk = false;
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk && (line.startsWith('+') || line.startsWith('-'))) {
      lines += 1;
    }
  }
  return { lines, paths: [...paths] };
}
```

`packages/harness/validators/context.ts`: import `type PullRequestDeclaration` from `@uw/contracts` and `type DiffStat` from `../github/diff-stat.ts`; add:

```ts
export type FixContext = {
  readonly pull: DiffStat | null;
  readonly fix: DiffStat | null;
  readonly declared: PullRequestDeclaration | null;
  readonly declaration: PullRequestDeclaration | null;
  readonly claimed: boolean;
};
```

and `ValidationContext` gains `readonly fix?: FixContext | null;`.

`packages/harness/validators/fix.ts`:

```ts
import type { PullRequestDeclaration } from '@uw/contracts';
import type { DiffStat } from '../github/diff-stat.ts';
import type { FixContext, ValidationContext } from './context.ts';

const QUARTERS = 4;
const NAMED_PATHS = 5;
const testPath = /(?:^|\/)(?:test|tests|__tests__|spec)\/|\.(?:test|spec)\.[a-z]+$/u;
const docPath = /^docs\/|\.md$/u;

export function testOrDoc(path: string): boolean {
  return testPath.test(path) || docPath.test(path);
}

function outside(pull: DiffStat, fix: DiffStat): readonly string[] {
  const touched = new Set(pull.paths);
  return fix.paths.filter((path) => !touched.has(path) && !testOrDoc(path));
}

function sizeFailures(fix: FixContext): readonly string[] {
  if (fix.pull === null || fix.fix === null) {
    return ['fix_size_cap: the fix could not be measured against the pull request'];
  }
  const { pull } = fix;
  const lines = fix.fix.lines;
  const over =
    lines * QUARTERS > pull.lines
      ? [
          `fix_size_cap: the fix changes ${lines.toString()} lines, more than a quarter of the pull request's ${pull.lines.toString()}`,
        ]
      : [];
  const strays = outside(pull, fix.fix)
    .slice(0, NAMED_PATHS)
    .map((path) => `fix_size_cap: the fix touches ${path}, which the pull request does not`);
  return [...over, ...strays];
}

export function fixSizeCap(context: ValidationContext): readonly string[] {
  return context.fix === undefined || context.fix === null ? [] : sizeFailures(context.fix);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const seen = new Set(left);
  return seen.size === new Set(right).size && right.every((value) => seen.has(value));
}

function sameText(left: PullRequestDeclaration, right: PullRequestDeclaration): boolean {
  return left.risks === right.risks && left.touches === right.touches && left.riskTier === right.riskTier;
}

export function sameDeclaration(
  left: PullRequestDeclaration | null,
  right: PullRequestDeclaration | null,
): boolean {
  if (left === null || right === null) return left === right;
  return sameText(left, right) && sameSet(left.closes, right.closes) && sameSet(left.riskDomains, right.riskDomains);
}

export function fixKeepsPurpose(context: ValidationContext): readonly string[] {
  const { fix } = context;
  if (fix === undefined || fix === null) return [];
  if (!fix.claimed) return ['fix_keeps_purpose: the fix claim recorded no declaration'];
  return sameDeclaration(fix.declared, fix.declaration)
    ? []
    : ['fix_keeps_purpose: the pull request declaration changed since the fix was claimed'];
}
```

`packages/harness/validators/registry.ts`:

```ts
import type { ValidationContext, Validator } from './context.ts';
import { fixKeepsPurpose, fixSizeCap } from './fix.ts';
import { learningAttached } from './learning-attached.ts';

export const FIX_VALIDATORS = ['fix_size_cap', 'fix_keeps_purpose'] as const;

export const validatorRegistry: ReadonlyMap<string, Validator> = new Map<string, Validator>([
  ['learning_attached', learningAttached],
  ['fix_size_cap', fixSizeCap],
  ['fix_keeps_purpose', fixKeepsPurpose],
]);
```

and `runValidators` unchanged.

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run packages/harness/github/diff-stat.test.ts packages/harness/validators`
Expected: green, `validators.test.ts` included.

- [ ] **Step 5: Write the failing kernel tests**

`sim/kernel/fix-validators.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { declared } from '../ship-fixtures.ts';
import { simAgent, simCaller } from '../fixtures.ts';
import { claimFix, fixHead, fixWorld, pushedFix, submitFix, type FixWorld } from '../fix-claims.ts';
import { itemEvents, itemOf, value } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const pull = { 'apps/uw-app/board.tsx': 40 };

async function claimed(work: (scene: FixWorld) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const scene = await fixWorld(world);
    value(await claimFix(scene));
    await work(scene);
  } finally {
    await world.close();
  }
}

async function tail(scene: FixWorld, count: number) {
  return (await itemEvents(scene, scene.itemId)).slice(-count).map((event) => [event.name, event.evidence]);
}

describe('FL-3 a fix that keeps to the rules waits at its stage for the next review', () => {
  it('FL-3 within a quarter of the lines, on the pull request files and a test, it answers awaiting_review', () =>
    claimed(async (scene) => {
      pushedFix(scene, { pull, fix: { 'apps/uw-app/board.tsx': 8, 'apps/uw-app/board.test.tsx': 2 } });
      expect(await submitFix(scene)).toMatchObject({
        status: 'accepted',
        value: { result: 'awaiting_review', failures: [] },
      });
      expect(await itemOf(scene.world, scene.itemId)).toMatchObject({
        stageKey: 'check',
        expectedHead: fixHead,
        holder: null,
        gateStatus: 'working',
      });
      const names = (await tail(scene, 2)).map(([name]) => name);
      expect(names).toEqual(['submitted_to_gate', 'item_released']);
    }));
});

describe('FL-3 a fix over the cap or off its purpose is refused with its own reason and releases the claim', () => {
  it('FL-3 fix_size_cap refuses more than a quarter, records checks_failed and keeps the reviewed head', () =>
    claimed(async (scene) => {
      pushedFix(scene, { pull, fix: { 'apps/uw-app/board.tsx': 11 } });
      expect(await submitFix(scene)).toMatchObject({ status: 'error', reason: 'fix_size_cap' });
      expect(await itemOf(scene.world, scene.itemId)).toMatchObject({
        expectedHead: scene.head,
        holder: null,
        gateStatus: 'checks_failed',
      });
      const [failed, released] = await tail(scene, 2);
      expect(failed?.[0]).toBe('checks_failed');
      expect(released?.[0]).toBe('item_released');
    }));

  it('FL-3 fix_size_cap refuses a file the pull request does not touch', () =>
    claimed(async (scene) => {
      pushedFix(scene, { pull, fix: { 'apps/uw-app/billing.ts': 2 } });
      expect(await submitFix(scene)).toMatchObject({
        status: 'error',
        reason: 'fix_size_cap',
        detail: { failures: ['fix_size_cap: the fix touches apps/uw-app/billing.ts, which the pull request does not'] },
      });
    }));

  it('FL-3 fix_size_cap refuses a fix it cannot measure', () =>
    claimed(async (scene) => {
      pushedFix(scene, { pull, fix: null });
      expect(await submitFix(scene)).toMatchObject({ status: 'error', reason: 'fix_size_cap' });
    }));

  it('FL-3 fix_keeps_purpose refuses a declaration that changed during the fix', () =>
    claimed(async (scene) => {
      const changed = declared({ riskTier: 'low', riskDomains: [] });
      pushedFix(scene, { pull, fix: { 'apps/uw-app/board.tsx': 4 }, declaration: changed });
      expect(await submitFix(scene)).toMatchObject({ status: 'error', reason: 'fix_keeps_purpose' });
      expect(await itemOf(scene.world, scene.itemId)).toMatchObject({ expectedHead: scene.head, holder: null });
    }));
});

describe('FL-3 a claim that is not a fix claim runs no fix validator', () => {
  it('FL-3 the author submits a large change at Check and advances as in v0.1.0', async () => {
    const world = await createWorld();
    try {
      const scene = await fixWorld(world);
      const author = simAgent(scene.admin, `${scene.admin.personId ?? ''}/builder`, { interactive: true });
      value(await scene.world.kernel.items.claim(simCaller(world, author), { itemId: scene.itemId, delegationId: null }));
      pushedFix(scene, { pull, fix: { 'apps/uw-app/billing.ts': 400 } });
      expect(await submitFix(scene, author)).toMatchObject({ status: 'accepted', value: { result: 'advanced' } });
    } finally {
      await world.close();
    }
  });
});
```

`declared(risk)` in `sim/ship-fixtures.ts` builds a declaration from a risk tier and domains; if its result equals `standardDeclaration` for `{ riskTier: 'low', riskDomains: [] }` in every text field but the tier, the test still holds (the tier differs). If step 15 or 16 changed `simAdvance`'s author identity at Check, use the identity `sim/review-runs.ts`'s `itemAtCheck` uses.

- [ ] **Step 6: Run them and see them fail**

Run: `npx vitest run sim/kernel/fix-validators.test.ts`
Expected: FAIL; the first test answers `advanced` (the stage's exit) and the cap tests advance too.

- [ ] **Step 7: The submit learns the fix claim**

`packages/harness/items/fix-submit.ts`:

```ts
import {
  eventEvidenceSchemas,
  type HarnessEvent,
  type ItemState,
  type PullRequestDeclaration,
  type Stage,
} from '@uw/contracts';
import { diffStat, type DiffStat } from '../github/diff-stat.ts';
import { refused, type Refused } from '../outcome.ts';
import type {
  DiffRange,
  DiffRead,
  Ports,
  PullRequestFacts,
  PullRequestRef,
  StoreTransaction,
} from '../ports.ts';
import { endRunDrafts } from '../runs/ends.ts';
import type { FixContext } from '../validators/context.ts';
import { FIX_VALIDATORS, runValidators } from '../validators/registry.ts';
import { draft, readAllEvents, recordItemEvents, type RecordContext } from './record.ts';

type DiffPorts = Pick<Ports, 'githubFacts' | 'store'>;

export type FixDiffs = {
  readonly start: string | null;
  readonly pull: DiffRead | null;
  readonly fix: DiffRead | null;
};

export type FixSubmission = {
  readonly item: ItemState;
  readonly stage: Stage;
  readonly context: RecordContext;
  readonly diffs: FixDiffs;
  readonly facts: PullRequestFacts | null;
};

const FIX_DIFF_BUDGET = 1_000_000;
const unread: FixDiffs = { start: null, pull: null, fix: null };

async function fixClaimOn(ports: DiffPorts, itemId: string): Promise<ItemState | null> {
  return ports.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.byId(itemId);
    if (item === null || item.delegationId === null) return null;
    const delegation = await tx.delegations.read.byId(item.delegationId);
    return delegation?.capability === 'fix' ? item : null;
  });
}

async function readDiff(ports: DiffPorts, ref: PullRequestRef, range: DiffRange): Promise<DiffRead> {
  try {
    return await ports.githubFacts.diff(ref, range, FIX_DIFF_BUDGET);
  } catch {
    return { kind: 'unavailable', reason: 'diff_failed' };
  }
}

export async function readFixDiffs(
  ports: DiffPorts,
  itemId: string,
  change: { readonly head: string } | null,
  facts: PullRequestFacts | null,
): Promise<FixDiffs | null> {
  const item = await fixClaimOn(ports, itemId);
  if (item === null) return null;
  const start = item.expectedHead;
  const ref = item.pullRequest;
  if (start === null || ref === null || change === null || facts === null) return { ...unread, start };
  return {
    start,
    pull: await readDiff(ports, ref, { base: facts.base, head: start }),
    fix: await readDiff(ports, ref, { base: start, head: change.head }),
  };
}

function measured(read: DiffRead | null): DiffStat | null {
  return read?.kind === 'diff' ? diffStat(read.text) : null;
}

function claimedDeclaration(events: readonly HarnessEvent[]) {
  const claimed = events.findLast((event) => event.name === 'fix_claimed');
  if (claimed === undefined) return { claimed: false, declared: null };
  const declared: PullRequestDeclaration | null = eventEvidenceSchemas.fix_claimed.parse(
    claimed.evidence,
  ).declaration;
  return { claimed: true, declared };
}

function fixContextOf(submission: FixSubmission, events: readonly HarnessEvent[]): FixContext {
  const { diffs, item, facts } = submission;
  const same = diffs.start !== null && diffs.start === item.expectedHead;
  return {
    pull: same ? measured(diffs.pull) : null,
    fix: same ? measured(diffs.fix) : null,
    declaration: facts?.declaration ?? null,
    ...claimedDeclaration(events),
  };
}

async function refuseFix(
  tx: StoreTransaction,
  submission: FixSubmission,
  failures: readonly string[],
): Promise<Refused> {
  const { item, stage, context } = submission;
  const ending = await endRunDrafts(tx, item, { outcome: 'stopped', why: 'released', at: context.at });
  const released = item.holder === null ? [] : [draft('item_released', { holder: item.holder })];
  await recordItemEvents(tx, context, item.itemId, [
    draft('checks_failed', { stage: stage.key, failures: [...failures] }),
    ...released,
    ...ending.drafts,
  ]);
  const reason = failures.some((failure) => failure.startsWith('fix_size_cap'))
    ? 'fix_size_cap'
    : 'fix_keeps_purpose';
  return refused(reason, { stage: stage.key, failures: [...failures] });
}

export async function fixRefusal(
  tx: StoreTransaction,
  submission: FixSubmission,
): Promise<Refused | null> {
  const { item } = submission;
  const events = await readAllEvents(tx, item.harnessId, item.itemId);
  const fix = fixContextOf(submission, events);
  const failures = runValidators(FIX_VALIDATORS, { item, events, pages: new Map(), attaching: [], fix });
  return failures.length === 0 ? null : refuseFix(tx, submission, failures);
}
```

`checks_failed`'s `failures` text bound (`text` in `event-evidence.ts`) holds each failure string; a path longer than it is cut by the validator's own message length, which stays under 500 for paths under 400 characters.

`packages/harness/items/submit.ts`: import `fixRefusal`, `readFixDiffs`, `type FixDiffs` from `./fix-submit.ts`.

`Command` gains `readonly fix: FixDiffs | null;`. In `submit`, after step 16's `lent` lines:

```ts
  const fix = await readFixDiffs(ports, normalised.itemId, normalised.change, read.facts);
```

and the `command` constant gains `fix` beside `lent`.

Add beside `park`:

```ts
async function awaitReview(_tx: StoreTransaction, submission: Submission): Promise<Decision> {
  const { holder } = submission.item;
  return {
    result: 'awaiting_review',
    drafts: [
      submittedDraft(submission, 'awaiting_review'),
      ...(holder === null ? [] : [draft('item_released', { holder })]),
    ],
    failures: [],
  };
}

type Chosen = { readonly handler: GateHandler } | Refused;

type Choosing = {
  readonly item: ItemState;
  readonly stage: Stage;
  readonly context: RecordContext;
};

async function handlerOf(tx: StoreTransaction, command: Command, scene: Choosing): Promise<Chosen> {
  if (command.fix !== null) {
    const unfit = await fixRefusal(tx, { ...scene, diffs: command.fix, facts: command.facts });
    return unfit ?? { handler: awaitReview };
  }
  const handler = gates.get(scene.stage.exitGate);
  if (handler === undefined) return refused('malformed_command', { exitGate: scene.stage.exitGate });
  return { handler };
}
```

In `submitIn`, replace

```ts
  const handler = gates.get(stage.exitGate);
  if (handler === undefined) return refused('malformed_command', { exitGate: stage.exitGate });
```

with

```ts
  const chosen = await handlerOf(tx, command, { item, stage, context });
  if ('status' in chosen) return chosen;
```

and the `handler(tx, { … })` call becomes `chosen.handler(tx, { … })`. Everything step 16 put after it (`recordSubmission`, `delegatedAfter`) stays: a fix claim never stands at a delegable exit, so `shipUnderDelegation` returns `null` for it.

- [ ] **Step 8: The scenario**

`sim/scenarios/FL-3.a-fix-over-the-cap-or-off-purpose-is-refused-and-releases-the-claim.ts` (id `'FL-3'`): `fixWorld`, `claimFix`, `pushedFix` with 11 lines over 40, `submitFix`; assert `fix_size_cap`, the item's holder `null` and its expected head the reviewed head; return `{ state: { reason, holder, expectedHead } }`.

- [ ] **Step 9: Run the tests**

Run: `pnpm check && npx vitest run sim/kernel/fix-validators.test.ts sim/kernel/submit.test.ts sim/kernel/submit-facts.test.ts sim/kernel/delegated-ship.test.ts packages/harness` then `pnpm sim -- FL-3 && pnpm sim -- KN-6 && pnpm sim -- all`
Expected: green. `submit.test.ts` and KN-6 hold: a claim without a `fix` delegation reads no diff and takes its stage's exit.

- [ ] **Step 10: Commit**

```bash
git add packages/harness sim
git commit -m "feat(harness): a fix is capped at a quarter of the pull request and keeps its purpose

fix_size_cap and fix_keeps_purpose are validator registry entries over a
fix context: two diffs read before the submit's transaction and the
declaration fix_claimed recorded. At a submit from a fix claim they run
in place of the stage's exit gate; a failure refuses with its own
reason, records checks_failed, releases the claim and keeps the reviewed
head. A fix that passes answers awaiting_review and stays at its stage
for the next review round.

FL-3. S17-R5 S17-R6 S17-R7 S17-R8."
```

---

### Task 8: FL-4, the fix run reads the round's findings as untrusted content

**Files:**
- Create: `packages/harness/runs/fix-comments.ts`
- Modify: `packages/harness/runs/commands.ts` (`RunCommands.reviewComments`)
- Modify: `apps/uw-app/runs/prompt-source.ts` (`ReadText.comments`, `related`), `apps/uw-app/runs/prompts.ts` (`fixPrompt`)
- Modify: `apps/uw-app/runs/bodies.ts` (`ReadDone.fix`, `readBody`, `workBody`'s prompt choice, `ModelDone.outcome`, the no-checkout guard, `Submitted.result`)
- Modify: `apps/uw-app/runs/run-core.ts` (`fixComments`, `afterRead`, `afterWork`)
- Modify: `apps/uw-app/runs/steps.ts` (`endingReasons`)
- Modify: `apps/uw-app/runs/prompts.test.ts` (one block), and every `ReadText` literal `pnpm check` names
- Create: `sim/kernel/fix-comments.test.ts`, `apps/uw-app/runs/fix-run.pg.test.ts`

**Interfaces:**
- Consumes: Task 5's `roundFindings`, `fixWorld`, `fixerPage`; step 13's `untrusted`, `scanFences`, `PromptSource.related`.
- Produces: `reviewComments(ports, caller, runId): Promise<KernelOutcome<ReviewComments>>` with `ReviewComments = { readonly comments: readonly string[] }`; `fixPrompt(source)`; `ReadText.comments`; `ReadDone.fix`.

- [ ] **Step 1: Write the failing tests**

`sim/kernel/fix-comments.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller } from '../fixtures.ts';
import { fixerPage, fixWorld, roundText } from '../fix-claims.ts';
import { personaPrincipal, reasonOf, value } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

describe('FL-4 the fix run reads the findings of the round that opened it', () => {
  it('FL-4 the host reads real and plausible findings with their weight, for a fix run only', async () => {
    const world = await createWorld();
    try {
      const scene = await fixWorld(world);
      const persona = personaPrincipal(scene.owner, 'agent:builder');
      const started = await world.kernel.runs.start(simCaller(world, persona), {
        itemId: scene.itemId,
        delegationId: scene.fixId,
        personaPageId: fixerPage,
      });
      const { runId } = value(started);
      expect(value(await world.kernel.runs.reviewComments(scene.host, runId))).toEqual({
        comments: [`real: ${roundText}`],
      });
      expect(reasonOf(await world.kernel.runs.reviewComments(scene.host, scene.runId))).toBe('not_permitted');
      expect(reasonOf(await world.kernel.runs.reviewComments(simCaller(world, persona), runId))).toBe(
        'not_permitted',
      );
    } finally {
      await world.close();
    }
  });
});
```

`scene.runId` is the Reviewer's run, which has ended: `runScene` refuses it (or the capability check does); either way `not_permitted` or `run_not_found`. If it answers `run_not_found`, assert that and say so in the commit body.

In `apps/uw-app/runs/prompts.test.ts`, add `comments: []` to `fromIssue` and import `fixPrompt`; append:

```ts
describe('FL-4 the fix prompt carries the review comments as untrusted content', () => {
  it('FL-4 fences each comment as review_comment, outside text holds none of it, and it forbids a push', () => {
    const comments = [`real: The lease lapses. ${injection}`, 'plausible: The empty state may drop.'];
    const prompt = fixPrompt(promptSourceOf({ ...fromIssue, comments }, itemId));
    const scan = scanFences(prompt);
    expect(scan.spans.map((span) => span.source)).toEqual([
      'issue_body',
      'page_from_agent',
      'review_comment',
      'review_comment',
    ]);
    expect(scan.spans.slice(-2).map((span) => span.text)).toEqual(comments);
    expect(scan.outside).not.toContain(injection);
    expect(scan.outside).not.toContain('The lease lapses');
    expect(scan.outside).toContain('do not push');
  });

  it('FL-4 a build run carries no comment, so its prompt is unchanged', () => {
    expect(promptSourceOf(fromIssue, itemId).related).toEqual([]);
  });
});
```

`apps/uw-app/runs/fix-run.pg.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { Caller, RunStart } from '@uw/harness';
import { platformStore } from '../ports/store.ts';
import { allEvents } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  ended,
  fakeSteps,
  hostRig,
  runDepsFor,
  scriptedEngines,
  startedRun,
} from '../testing/run-host.ts';
import { runWorkflow } from './run-core.ts';

const host: Caller = { actor: systemPrincipal(), traceId: randomUUID(), requestId: null };
const holds = '```harness-scout\npremise: holds\nreason: the plan still stands\n```';

async function checksNotRun(db: Database): Promise<void> {
  const rig = await hostRig(db, host, {});
  const engines = scriptedEngines({
    'openrouter-messages': async () => ended(holds, { resolvedProvider: 'z-ai' }),
    'claude-messages': async () => ended('Fixed.', { outcome: 'checks_not_run_locally' }),
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
  const steps = fakeSteps();
  expect(await runWorkflow(start, steps, runDepsFor(rig, host, engines))).toBe('failed');
  expect(steps.names).not.toContain('submit');
  const run = await platformStore(rig.db).transaction((tx) => tx.harnessRuns.read.byId(runId));
  expect(run).toMatchObject({ outcome: 'failed', failure: 'checks_not_run_locally' });
  const names = (await allEvents(rig.db, rig.harnessId))
    .filter((event) => event.itemId === rig.itemId)
    .map((event) => event.name);
  expect(names).not.toContain('submitted_to_gate');
  expect(names.slice(-2)).toEqual(['run_failed', 'item_released']);
}

describe.skipIf(!testServer)('a fix run that ran no declared checks', () => {
  it('FL-4 the work step answering checks_not_run_locally ends run_failed with it and submits nothing', () =>
    withAppDatabase(checksNotRun));
});
```

The mapping is proven on a `build` rig because it does not read the capability: any engine answering `checks_not_run_locally` ends the run so, and only the fix work spec (Task 9) answers it.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run sim/kernel/fix-comments.test.ts && npx vitest run --project workers apps/uw-app/runs/prompts.test.ts`
Expected: FAIL; `runs.reviewComments` and `fixPrompt` do not exist.

- [ ] **Step 3: The host read**

`packages/harness/runs/fix-comments.ts`:

```ts
import type { Caller } from '../caller.ts';
import { roundFindings } from '../items/fix-offer.ts';
import { readAllEvents } from '../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { runScene } from './scene.ts';

type CommentPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type ReviewComments = { readonly comments: readonly string[] };

export async function reviewComments(
  ports: CommentPorts,
  caller: Caller,
  runId: string,
): Promise<KernelOutcome<ReviewComments>> {
  const scene = await runScene(ports, caller, runId);
  if (scene.status !== 'accepted') return scene;
  if (scene.value.capability !== 'fix') return refused('not_permitted', { why: 'not_a_fix_run' });
  const { item } = scene.value;
  const events = await ports.store.transaction((tx) => readAllEvents(tx, item.harnessId, item.itemId));
  return accepted({ comments: roundFindings(events) });
}
```

`packages/harness/runs/commands.ts`: import `reviewComments`, `type ReviewComments` from `./fix-comments.ts`; `RunCommands` gains `reviewComments(caller: Caller, runId: string): Promise<KernelOutcome<ReviewComments>>;`; the factory gains `reviewComments: hostOnly((caller, runId: string) => reviewComments(ports, caller, runId)),`.

- [ ] **Step 4: The prompt**

`apps/uw-app/runs/prompt-source.ts`: `ReadText` gains `readonly comments: readonly string[];`; in `promptSourceOf`, `related: []` becomes:

```ts
    related: read.comments.map((text) => wrapped('review_comment', text)),
```

`apps/uw-app/runs/prompts.ts`, after `workPrompt`:

```ts
export function fixPrompt(source: PromptSource): string {
  return [
    ...framed(source),
    '',
    'A review of this item found the defects quoted above. Fix them on the branch you are given and change nothing else.',
    "Keep the change within a quarter of the pull request's changed lines, in the files it already touches, plus tests and docs.",
    'Do not change what the pull request declares. Commit your fix and do not push: the platform runs the repository declared checks and pushes when they pass.',
  ].join('\n');
}
```

Every `ReadText` literal `pnpm check` names (`apps/uw-app/runs/untrusted-prompts.pg.test.ts`, other tests) gains `comments: []`.

- [ ] **Step 5: The run host**

`apps/uw-app/runs/bodies.ts`:
- import `fixPrompt` with the other prompts and `type EngineWorkResult` is already imported.
- `ReadDone` gains `readonly fix: boolean;`; `readBody` returns `comments: [],` and `fix: capability === 'fix',` beside `review`.
- `ModelDone.outcome` becomes `EngineWorkResult['outcome']`.
- `Submitted.result` becomes `'advanced' | 'parked' | 'checks_failed' | 'awaiting_review'`.
- Add:

```ts
function unrunFix(plan: ModelPlan): ModelDone {
  return {
    kind: 'model',
    text: null,
    outcome: 'checks_not_run_locally',
    resolvedProvider: null,
    resolvedModel: plan.model,
  };
}

function promptOf(read: ReadDone & { readonly diff: string | null }, itemId: string): string {
  if (read.diff !== null) return reviewPrompt(reviewSourceOf(read, itemId, read.diff));
  const source = promptSourceOf(read, itemId);
  return read.fix ? fixPrompt(source) : workPrompt(source);
}
```

- In `modelRun`, after `const access = await builderAccess(deps, open.scene, plan.step);`:

```ts
  if (plan.step === 'work' && open.scene.capability === 'fix' && access.checkout === null) {
    return unrunFix(plan);
  }
```

- `workBody`'s parameter type becomes `read: ReadDone & { readonly diff: string | null }`, and its body computes `const prompt = promptOf(read, item.itemId);` in place of the ternary.

`apps/uw-app/runs/run-core.ts`:

```ts
type CommentsRead = { readonly kind: 'comments'; readonly comments: string[] };

function fixComments(flow: Flow): Promise<CommentsRead | Awake> {
  const { deps, runId } = flow;
  return stepped<CommentsRead>(flow, 'review comments', STEP, async () => {
    const read = await deps.runKernel.runs.reviewComments(deps.host, runId);
    if (read.status !== 'accepted') return haltedBy(read.reason, read.detail);
    return { kind: 'comments', comments: [...read.value.comments] };
  });
}
```

`afterRead` becomes:

```ts
async function afterRead(flow: Flow, plain: ReadDone): Promise<string> {
  const { deps, runId } = flow;
  const diff = plain.review ? await reviewDiff(flow) : null;
  if (diff !== null && diff.kind !== 'diff') return settled(flow, 'work', diff);
  const found = plain.fix ? await fixComments(flow) : null;
  if (found !== null && found.kind !== 'comments') return settled(flow, 'read', found);
  const read = found === null ? plain : { ...plain, comments: found.comments };
  const scout = await stepped(flow, 'scout', STEP, () => scoutBody(deps, runId, read));
  if (scout.kind !== 'scout') return settled(flow, 'scout', scout);
  if (!scout.holds) {
    const halted = await hostStep(flow, 'scout', 'hold premise', (d) =>
      d.runKernel.runs.holdPremise(deps.host, runId, { reason: scout.reason }),
    );
    return halted ?? 'premise_held';
  }
  return afterWork(flow, read, diff?.diff ?? null);
}
```

In `afterWork`, after the `turn_limit` line:

```ts
  if (work.outcome === 'checks_not_run_locally') {
    return failRun(flow, 'work', 'checks_not_run_locally', null);
  }
```

`apps/uw-app/runs/steps.ts`: `endingReasons` gains `'fix_size_cap'` and `'fix_keeps_purpose'` (the kernel already released the claim and stopped the run, S17-R7).

- [ ] **Step 6: Run the tests**

Run: `pnpm check && npx vitest run sim/kernel/fix-comments.test.ts packages/harness/runs && npx vitest run --project workers apps/uw-app/runs`
Then: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/runs`
Then: `pnpm architecture`
Expected: green, including `untrusted-prompts.pg.test.ts`, `run-core.pg.test.ts` and `tools/architecture/untrusted-content.test.ts` (UC-4): the comments are wrapped in `prompt-source.ts` only, and `bodies.ts` and `run-core.ts` pass `read` to the builders, never an outside string.

- [ ] **Step 7: Commit**

```bash
git add packages/harness apps/uw-app/runs sim
git commit -m "feat(runs): a fix run reads its round's findings as untrusted review comments

The host reads the real and plausible findings of the round that opened
the fix (kernel.runs.reviewComments, fix runs only) and the prompt
carries each in a review_comment fence in the related slot, with a fix
prompt that asks for a small fix and no push. A work step that ran no
declared checks ends run_failed with checks_not_run_locally and never
submits; a fix with no checkout ends so without calling the model.

FL-4. S17-R9 S17-R11."
```

---

### Task 9: FL-4, the fix work spec: the push closed, the checks run, then the platform pushes

**Files:**
- Create: `apps/uw-app/engines/sandbox/paths.ts`, `apps/uw-app/engines/sandbox/fix-checks.ts`, `apps/uw-app/engines/sandbox/registry-egress.ts`
- Modify: `apps/uw-app/engines/sandbox/run.ts` (re-export the paths; `SandboxPlan.finish`; `sandboxWork`; `githubOf`)
- Modify: `apps/uw-app/engines/sandbox/session.ts` (`SessionSpec.finish`, `SessionRun.finished`)
- Modify: `apps/uw-app/engines/sandbox/egress.ts` (`EgressRoutes.registry`, the registry hop)
- Modify: `apps/uw-app/engines/sandbox/github-egress.ts` (`GitHubEgress.pushes`)
- Modify: `apps/uw-app/engines/seam.ts` (`Checkout.fix`, `EngineWorkResult.outcome`)
- Modify: `apps/uw-app/engines/claude-code-sandbox/work.ts` (the fix script, tools, section, `finish`), `apps/uw-app/engines/codex-sandbox/work.ts` (`finish: null`)
- Modify: `apps/uw-app/runs/builder-github.ts` (`builds`, `checkout.fix`)
- Modify: `apps/uw-app/engines/sandbox/github-egress.test.ts`, `session.test.ts`, `egress.test.ts`, and every `Checkout` or `GitHubEgress` literal `pnpm check` names
- Create: `apps/uw-app/engines/claude-code-sandbox/fix.test.ts`, `apps/uw-app/engines/sandbox/registry-egress.test.ts`
- Modify: `docs/exceptions.md` (the 2026-10-04 rule-2 row), `docs/architecture.md` (the sandbox paragraph), in the same commit (rule 5)

**Interfaces:**
- Consumes: Task 8's `checks_not_run_locally` mapping.
- Produces: `Checkout.fix: boolean`; `EngineWorkResult.outcome: 'ended' | 'turn_limit' | 'checks_not_run_locally'`; `GitHubEgress.pushes: () => boolean`; `EgressRoutes.registry: RegistryRoute | null`; `registryEgress`, `REGISTRY_HOST`; `fixPhase(fixing)`, `fixFinish(phase, ended)`, `readDeclaredChecks`, `NO_CHECKS_EXIT`; `SessionSpec.finish: SessionFinish | null`; `SessionRun.finished: FinishEnd | null`; `SandboxPlan.finish: ((input: EngineWork, phase: FixPhase) => SessionFinish) | null`.

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/engines/sandbox/registry-egress.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { registryEgress, REGISTRY_HOST } from './registry-egress.ts';

function rig(open: boolean) {
  const refused: string[] = [];
  const sent: Request[] = [];
  const route = {
    registry: { open: () => open },
    refused: (host: string, path: string) => void refused.push(`${host}${path}`),
  };
  const fetcher = async (request: Request) => {
    sent.push(request);
    return new Response('{}', { status: 200 });
  };
  return { route, fetcher, refused, sent };
}

describe('FL-4 the package registry is reachable only while the declared checks run', () => {
  it('FL-4 forwards a GET to the npm registry with only accept and user-agent while open', async () => {
    const { route, fetcher, sent } = rig(true);
    const request = new Request(`http://${REGISTRY_HOST}/react?x=1`, {
      headers: { accept: 'application/json', authorization: 'Bearer leak', 'user-agent': 'npm' },
    });
    expect((await registryEgress(request, route, fetcher))?.status).toBe(200);
    expect(sent.map((one) => one.url)).toEqual(['https://registry.npmjs.org/react?x=1']);
    expect(sent[0]?.headers.get('authorization')).toBeNull();
  });

  it('FL-4 refuses while closed, and refuses any write while open', async () => {
    const closed = rig(false);
    expect((await registryEgress(new Request(`http://${REGISTRY_HOST}/react`), closed.route, closed.fetcher))?.status).toBe(403);
    const open = rig(true);
    const put = new Request(`http://${REGISTRY_HOST}/react`, { method: 'PUT', body: '{}' });
    expect((await registryEgress(put, open.route, open.fetcher))?.status).toBe(403);
    expect([...closed.sent, ...open.sent]).toEqual([]);
    expect(await registryEgress(new Request('http://example.com/'), open.route, open.fetcher)).toBeNull();
  });
});
```

In `apps/uw-app/engines/sandbox/github-egress.test.ts`, `rig`'s options gain `readonly pushes?: boolean` and its `github` literal gains `pushes: () => options.pushes ?? true,`; add:

```ts
describe('FL-4 a fix run cannot push until the platform opens the push', () => {
  it('FL-4 refuses a push to the branch while pushes are closed and forwards nothing', async () => {
    const closed = rig({ pushes: false });
    const request = push(`${old} ${next} refs/heads/${branch}`);
    expect((await githubEgress(request, closed.route, closed.fetcher))?.status).toBe(403);
    expect(closed.sent).toEqual([]);
  });
});
```

(`push`, `old`, `next` and `branch` are the file's own helpers.)

`apps/uw-app/engines/claude-code-sandbox/fix.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EngineWork } from '../seam.ts';
import { sandboxWork } from '../sandbox/run.ts';
import { fakeContainerHost } from '../sandbox/testing.ts';
import { claudeCodeSandboxEngine } from './index.ts';
import { claudeCodePlan } from './work.ts';

const keys = {
  AI_GATEWAY_ACCOUNT_ID: 'account-1',
  AI_GATEWAY_ID: 'harness-gateway',
  AI_GATEWAY_TOKEN: 'gateway-token',
  ANTHROPIC_API_KEY: 'organization-key',
};
const head = 'c'.repeat(40);
const result = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Fixed.',
  total_cost_usd: 0.1,
  usage: { input_tokens: 1200, output_tokens: 340 },
};

const fixWork: EngineWork = {
  runId: 'run-1',
  itemId: 'item-1',
  traceId: 'trace-1',
  persona: 'agent:builder',
  model: 'claude-sonnet-5',
  pinnedProvider: 'anthropic',
  instructions: 'You build the item.',
  prompt: 'Fix the item.',
  toolset: ['read_page'],
  checkout: {
    repository: 'unfoldingWord/uw-platform',
    branch: 'harness/item-1',
    defaultBranch: 'main',
    expectedHead: head,
    fix: true,
  },
  tools: { call: () => Promise.reject(new Error('the sandbox calls tools over MCP')) },
  onTurn: async () => undefined,
  egress: {
    mcp: async () => Response.json({ jsonrpc: '2.0', id: 1, result: {} }),
    github: { token: async () => 'ghs_minted', unwired: () => undefined },
    refused: () => undefined,
  },
};

function engineOn(replies: Parameters<typeof fakeContainerHost>[0]) {
  const host = fakeContainerHost(replies);
  const sent: Request[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    sent.push(new Request(input, init));
    return Response.json({ ok: true });
  };
  const config = { ...keys, fetch, sandboxes: { claudeCode: host, codex: null }, now: () => new Date(0) };
  return { engine: claudeCodeSandboxEngine(config), config, host, sent };
}

function reply(body: unknown, exitCode = 0) {
  return { exitCode, stdout: JSON.stringify(body), stderr: '' };
}

function pushed(): Request {
  const update = `${'a'.repeat(40)} ${'b'.repeat(40)} refs/heads/harness/item-1\0report-status\n`;
  const body = `${(update.length + 4).toString(16).padStart(4, '0')}${update}0000PACK`;
  return new Request('http://github.internal/unfoldingWord/uw-platform.git/git-receive-pack', {
    method: 'POST',
    body,
  });
}

const registryGet = () => new Request('http://registry.internal/react');

describe('FL-4 the fix work spec runs the declared checks before anything is pushed', () => {
  it('FL-4 with no declared checks the run ends checks_not_run_locally before the model runs', async () => {
    const { engine, host } = engineOn([{ exitCode: 78, stdout: '', stderr: '' }]);
    expect(await engine.work(fixWork)).toMatchObject({
      outcome: 'checks_not_run_locally',
      inputTokens: 0,
      outputTokens: 0,
    });
    const [session] = host.sessions;
    expect(session?.commands).toHaveLength(1);
    const script = session?.commands[0]?.command[2] ?? '';
    const declared = 'git -C /workspace/repo show "$UW_START:.harness/checks.sh" > /workspace/checks.sh';
    expect(script.indexOf(declared)).toBeGreaterThan(-1);
    expect(script.indexOf(declared)).toBeLessThan(script.indexOf('exec claude'));
  });

  it('FL-4 failing checks end checks_not_run_locally; the model could not push and nothing was pushed', async () => {
    const statuses: number[] = [];
    const { engine, host, sent } = engineOn([
      async (egress) => {
        statuses.push((await egress(pushed())).status, (await egress(registryGet())).status);
        return reply(result);
      },
      async (egress) => {
        statuses.push((await egress(registryGet())).status);
        return { exitCode: 1, stdout: '', stderr: 'lint failed' };
      },
    ]);
    expect(await engine.work(fixWork)).toMatchObject({ outcome: 'checks_not_run_locally', inputTokens: 1200 });
    expect(statuses).toEqual([403, 403, 200]);
    expect(host.sessions[0]?.commands).toHaveLength(2);
    expect(sent.map((request) => request.url)).toEqual(['https://registry.npmjs.org/react']);
  });

  it('FL-4 passing checks let the platform push the fix from its own command', async () => {
    const statuses: number[] = [];
    const { engine, host, sent } = engineOn([
      reply(result),
      { exitCode: 0, stdout: 'ok', stderr: '' },
      async (egress) => {
        statuses.push((await egress(pushed())).status);
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    ]);
    expect(await engine.work(fixWork)).toMatchObject({ outcome: 'ended', text: 'Fixed.' });
    expect(statuses).toEqual([200]);
    const commands = host.sessions[0]?.commands ?? [];
    expect(commands[2]?.command.join(' ')).toContain('push origin "HEAD:refs/heads/$UW_BRANCH"');
    expect(commands[1]?.env).toMatchObject({ npm_config_registry: 'http://registry.internal/' });
    expect(commands[0]?.command.join(' ')).not.toContain('Bash(curl *)');
    const prompt = host.sessions[0]?.files.find((file) => file.path === '/workspace/PROMPT.md')?.content;
    expect(prompt).toContain('Do not push');
    expect(sent.map((request) => request.url)).toEqual([
      'https://github.com/unfoldingWord/uw-platform.git/git-receive-pack',
    ]);
  });

  it('FL-4 an engine with no fix work spec ends checks_not_run_locally without a session', async () => {
    const { config, host } = engineOn([]);
    const plan = { ...claudeCodePlan(config), finish: null };
    expect(await sandboxWork(config, plan, fixWork)).toMatchObject({ outcome: 'checks_not_run_locally' });
    expect(host.sessions).toEqual([]);
  });
});
```

If `claudeCodeSandboxEngine`'s config type wants more fields, copy `engineOn` from `work.test.ts` (read lines 1 to 80) and keep these tests' bodies. In the second test, the model exec's own requests to `model.internal` are not made, so `sent` holds only the forwarded registry request.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run --project workers apps/uw-app/engines`
Expected: FAIL to compile (`fix` is not on `Checkout`; `registry-egress.ts` does not exist).

- [ ] **Step 3: The seam, the paths and the session**

`apps/uw-app/engines/seam.ts`: `Checkout` gains `readonly fix: boolean;`; `EngineWorkResult.outcome` becomes `'ended' | 'turn_limit' | 'checks_not_run_locally'`.

`apps/uw-app/engines/sandbox/paths.ts`:

```ts
export const WORKSPACE = '/workspace';
export const REPOSITORY_DIR = `${WORKSPACE}/repo`;
```

`apps/uw-app/engines/sandbox/run.ts`: delete its two `WORKSPACE` and `REPOSITORY_DIR` constants, `import { REPOSITORY_DIR, WORKSPACE } from './paths.ts';` for its own use, and `export { REPOSITORY_DIR, WORKSPACE } from './paths.ts';` so the engines' imports stay.

`apps/uw-app/engines/sandbox/session.ts`:

```ts
export type SessionExec = (
  command: readonly string[],
  env: Readonly<Record<string, string>>,
) => Promise<ExecResult>;
export type FinishEnd = 'pushed' | 'checks_not_run_locally' | 'not_run';
export type SessionFinish = (ran: ExecResult, exec: SessionExec) => Promise<FinishEnd>;
```

`SessionSpec` gains `readonly finish: SessionFinish | null;`; `SessionRun` becomes `ExecResult & { readonly wallMs: number; readonly finished: FinishEnd | null }`; in `runSession`, after `const ran = await session.exec(…)`:

```ts
    const exec: SessionExec = (command, env) =>
      session.exec(command, { ...spec.env, ...env }, spec.timeoutMs);
    const finished = spec.finish === null ? null : await spec.finish(ran, exec);
    return { ...ran, wallMs: now().getTime() - started, finished };
```

`session.test.ts`'s specs gain `finish: null`.

- [ ] **Step 4: The egress**

`apps/uw-app/engines/sandbox/registry-egress.ts`:

```ts
export const REGISTRY_HOST = 'registry.internal';

const UPSTREAM = 'https://registry.npmjs.org';
const reading: ReadonlySet<string> = new Set(['GET', 'HEAD']);
const forwardedHeaders: readonly string[] = ['accept', 'user-agent'];

export type RegistryRoute = { readonly open: () => boolean };

type Routed = {
  readonly registry: RegistryRoute | null;
  readonly refused: (host: string, path: string) => void;
};

function upstream(request: Request, url: URL): Request {
  const headers = new Headers();
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Request(`${UPSTREAM}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    redirect: 'manual',
  });
}

export async function registryEgress(
  request: Request,
  route: Routed,
  fetcher: (request: Request) => Promise<Response>,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.hostname !== REGISTRY_HOST) return null;
  const open = route.registry !== null && route.registry.open();
  if (!open || !reading.has(request.method) || url.protocol !== 'http:' || url.port !== '') {
    route.refused(url.hostname, url.pathname);
    return new Response('egress refused', { status: 403 });
  }
  return fetcher(upstream(request, url));
}
```

`apps/uw-app/engines/sandbox/egress.ts`: import `registryEgress`, `type RegistryRoute` from `./registry-egress.ts`; `EgressRoutes` gains `readonly registry: RegistryRoute | null;`; in `egress`, after the GitHub hop:

```ts
  const registry = await registryEgress(request, routes, fetcher);
  if (registry !== null) return registry;
```

`egress.test.ts`'s route literals gain `registry: null`.

`apps/uw-app/engines/sandbox/github-egress.ts`: `GitHubEgress` gains `readonly pushes: () => boolean;`; `pushAllowed`'s first line becomes `if (!route.pushes() || !plainBody(request)) return null;`.

- [ ] **Step 5: The three execs**

`apps/uw-app/engines/sandbox/fix-checks.ts`:

```ts
import type { ExecResult } from './host.ts';
import { REPOSITORY_DIR, WORKSPACE } from './paths.ts';
import { REGISTRY_HOST } from './registry-egress.ts';
import type { SessionFinish } from './session.ts';

export const NO_CHECKS_EXIT = 78;

const DECLARED_CHECKS = '.harness/checks.sh';
const CHECKS_FILE = `${WORKSPACE}/checks.sh`;
const RUN_CHECKS = ['sh', '-c', `cd ${REPOSITORY_DIR} && sh ${CHECKS_FILE}`];
const PUSH = ['sh', '-c', `git -C ${REPOSITORY_DIR} push origin "HEAD:refs/heads/$UW_BRANCH"`];
const checksEnv = {
  npm_config_registry: `http://${REGISTRY_HOST}/`,
  npm_config_replace_registry_host: 'always',
  COREPACK_NPM_REGISTRY: `http://${REGISTRY_HOST}`,
};

export const readDeclaredChecks = `git -C ${REPOSITORY_DIR} show "$UW_START:${DECLARED_CHECKS}" > ${CHECKS_FILE} 2>/dev/null || exit ${NO_CHECKS_EXIT.toString()}`;

type Phase = 'model' | 'checks' | 'push';

export type FixPhase = {
  pushes(): boolean;
  installs(): boolean;
  enter(phase: Exclude<Phase, 'model'>): void;
};

export function fixPhase(fixing: boolean): FixPhase {
  let phase: Phase = 'model';
  return {
    pushes: () => !fixing || phase === 'push',
    installs: () => fixing && phase === 'checks',
    enter: (next) => {
      phase = next;
    },
  };
}

export function fixFinish(phase: FixPhase, ended: (ran: ExecResult) => boolean): SessionFinish {
  return async (ran, exec) => {
    if (ran.exitCode === NO_CHECKS_EXIT) return 'checks_not_run_locally';
    if (!ended(ran)) return 'not_run';
    phase.enter('checks');
    const checked = await exec(RUN_CHECKS, checksEnv);
    if (checked.exitCode !== 0) return 'checks_not_run_locally';
    phase.enter('push');
    const pushed = await exec(PUSH, {});
    if (pushed.exitCode !== 0) throw new Error(`the fix push exited ${pushed.exitCode.toString()}`);
    return 'pushed';
  };
}
```

`apps/uw-app/engines/sandbox/run.ts`:
- import `fixPhase`, `NO_CHECKS_EXIT`, `type FixPhase` from `./fix-checks.ts` and `type SessionFinish`, `type SessionRun` from `./session.ts` (with the names it already imports).
- `SandboxPlan` gains `readonly finish: ((input: EngineWork, phase: FixPhase) => SessionFinish) | null;`.
- `githubOf(plan, input, phase: FixPhase)` returns `{ repository, branch, defaultBranch, ...access, pushes: phase.pushes }`.
- Add:

```ts
const unread: SandboxReading = {
  outcome: 'checks_not_run_locally',
  text: null,
  inputTokens: 0,
  outputTokens: 0,
  costMicros: null,
  model: null,
};

function readingOf(plan: SandboxPlan, ran: SessionRun): SandboxReading {
  if (ran.finished !== 'checks_not_run_locally') return plan.read(ran);
  if (ran.exitCode === NO_CHECKS_EXIT) return unread;
  return { ...plan.read(ran), outcome: 'checks_not_run_locally' };
}

function unrunFix(plan: SandboxPlan, input: EngineWork): EngineWorkResult {
  const { model, ...reading } = unread;
  return {
    ...reading,
    computeMinor: null,
    resolvedProvider: plan.provider,
    resolvedModel: model ?? input.model,
    toolsCalled: [],
  };
}
```

- `SandboxReading.outcome` becomes `'ended' | 'turn_limit' | 'checks_not_run_locally'`.
- `sandboxWork` after the provider check:

```ts
  const fixing = input.checkout?.fix === true;
  const finish = fixing ? plan.finish : null;
  if (fixing && finish === null) return unrunFix(plan, input);
  const phase = fixPhase(fixing);
  const registry = fixing ? { open: phase.installs } : null;
  const routes = { ...input.egress, model: plan.model, github: githubOf(plan, input, phase), registry };
  const spec = {
    sessionId: sessionIdOf(input.runId),
    files: plan.files(input),
    command: plan.command(input),
    env: envOf(plan, input),
    timeoutMs: SESSION_TIMEOUT_MS,
    finish: finish === null ? null : finish(input, phase),
  };
  const ran = await guardedSession(plan.host, spec, routes, config, input.onTurn);
  const { model, ...reading } = readingOf(plan, ran);
```

and the return is unchanged. If `sandboxWork` passes 50 lines, move the `routes` and `spec` construction into `function sessionOf(plan, input, phase, finish)`.

- [ ] **Step 6: The Claude Code fix work spec**

`apps/uw-app/engines/claude-code-sandbox/work.ts`:
- import `fixFinish`, `readDeclaredChecks` from `../sandbox/fix-checks.ts`, `type Checkout` with `type EngineWork` from `../seam.ts`.
- Beside `BUILD_SCRIPT` and `BUILD_TOOLS`:

```ts
const FIX_SCRIPT = [
  'set -e',
  `git clone --no-tags "$UW_CLONE_URL" ${REPOSITORY_DIR}`,
  `git -C ${REPOSITORY_DIR} checkout -B "$UW_BRANCH" "$UW_START"`,
  readDeclaredChecks,
  `cd ${REPOSITORY_DIR}`,
  SCRIPT,
].join('\n');
const FIX_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git *)'];

type Script = { readonly script: string; readonly tools: readonly string[] };

function scriptOf(checkout: Checkout | null): Script {
  if (checkout === null) return { script: SCRIPT, tools: [] };
  return checkout.fix
    ? { script: FIX_SCRIPT, tools: FIX_TOOLS }
    : { script: BUILD_SCRIPT, tools: BUILD_TOOLS };
}

function fixSection(checkout: Checkout): string {
  return [
    '',
    '',
    '## Repository',
    `You work in ${REPOSITORY_DIR} on the branch ${checkout.branch}, at the head the review read.`,
    'Commit your fix on this branch. Do not push and do not open a pull request: the pull request exists, and the platform runs the repository declared checks and pushes your commits only when they pass.',
  ].join('\n');
}

function ended(ran: ExecResult): boolean {
  try {
    return read(ran).outcome === 'ended';
  } catch {
    return false;
  }
}
```

- `repositorySection`: after `if (checkout === null) return '';` add `if (checkout.fix) return fixSection(checkout);`.
- `command`: replace the `building` and `allowed` lines and the ternary with:

```ts
  const { script, tools } = scriptOf(input.checkout);
  const allowed = [...verbs, ...tools].join(',');
```

and use `script` as the third element.
- `claudeCodePlan` gains `finish: (_input, phase) => fixFinish(phase, ended),`. If the linter refuses the unused `_input`, write `finish: (...[, phase]) => fixFinish(phase, ended)` only if it passes, else name it `input` and keep it unused per the repository's `argsIgnorePattern` (read `eslint.config.*`).

`ended` and `read` are declared in the same file; move `ended` below `read` so it is defined after use is not an issue (function declarations hoist).

`apps/uw-app/engines/codex-sandbox/work.ts`, `codexPlan`: add `finish: null,` (S10-R21: it clones nothing, so it has no fix work spec).

`apps/uw-app/runs/builder-github.ts`: import `type CapabilityWord` from `@uw/contracts`;

```ts
const building: ReadonlySet<CapabilityWord> = new Set<CapabilityWord>(['build', 'fix']);

function builds(scene: RunScene): string | null {
  const { harness, capability, persona } = scene;
  if (!building.has(capability) || !engineDescriptor(persona.engine).needsHostedBuilder) return null;
  return harness.repository;
}
```

and the `checkout` literal gains `fix: scene.capability === 'fix',`.

Every `Checkout` literal `pnpm check` names (`work.test.ts`'s `checkout`, `codex-sandbox/work.test.ts`, run tests) gains `fix: false`.

- [ ] **Step 7: The exception row and the architecture paragraph**

`docs/exceptions.md`, the 2026-10-04 rule-2 row for the GitHub egress: after "a push whose single ref update targets `refs/heads/harness/<item>` and deletes nothing," insert "(on a fix run only in the platform's own push exec, after the repository's declared checks passed: during the model's exec every push is refused, FL-4, S17-R11)". Add to its last column ", step 17 S17-R11".

`docs/architecture.md`, the **The sandbox engines.** paragraph: append:

```markdown
A fix run (FL-4) is three execs in one session: the model, with the GitHub egress refusing every push and the declared checks read from `.harness/checks.sh` at the start commit before Claude Code starts; the declared checks, the only time `registry.internal` forwards (`GET` and `HEAD` to `https://registry.npmjs.org`); and the platform's own `git push`, the only time a push is forwarded. Missing or failing checks make the engine answer `checks_not_run_locally` and nothing is pushed (`apps/uw-app/engines/sandbox/fix-checks.ts`, S17-R10, S17-R11).
```

- [ ] **Step 8: Run the tests**

Run: `pnpm check && npx vitest run --project workers apps/uw-app/engines apps/uw-app/runs` then `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run apps/uw-app/runs` then `pnpm architecture`
Expected: green, including the PE-5 hosted Builder test (a build run still pushes from its model exec: `pushes()` is always true when not fixing) and the dependency-cruiser rules (`fix-checks.ts` imports nothing from `apps/uw-app/github/`).

- [ ] **Step 9: Commit**

```bash
git add apps/uw-app/engines apps/uw-app/runs docs/exceptions.md docs/architecture.md
git commit -m "feat(engines): a fix runs the repository's declared checks before the platform pushes it

The Claude Code fix work spec is three execs in one session: the model
with every push refused and the declared checks read from the start
commit before it starts; the checks with a read-only npm registry route
open; then the platform's own push. No declared checks, or failing ones,
answer checks_not_run_locally and push nothing; an engine with no fix
work spec answers so without a session. The rule-2 exception row says
when a fix may push.

FL-4. S17-R10 S17-R11."
```

---

### Task 10: The fix claim end to end in the sim

**Files:**
- Create: `sim/kernel/fix-claim-journey.test.ts`

**Interfaces:**
- Consumes: Tasks 5 to 8.

- [ ] **Step 1: Write the test**

`sim/kernel/fix-claim-journey.test.ts`:

```ts
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { claimFix, fixHead, fixWorld, offeredTo, pushedFix, reviewedRound, submitFix } from '../fix-claims.ts';
import { itemOf, startOn, value } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

describe('FL-2 FL-3 a fix that passes waits for the next review round, which can open another fix', () => {
  it('FL-2 FL-3 round, fix, re-review at the new head, second round, second fix offered', async () => {
    const world = await createWorld();
    try {
      const scene = await fixWorld(world);
      value(await claimFix(scene));
      pushedFix(scene, { pull: { 'apps/uw-app/board.tsx': 40 }, fix: { 'apps/uw-app/board.tsx': 6 } });
      expect(value(await submitFix(scene)).result).toBe('awaiting_review');
      expect(await offeredTo(scene, scene.fixer)).not.toContain(scene.itemId);
      const rerun = value(await startOn({ ...scene, pageId: scene.pageId }));
      await reviewedRound({ ...scene, runId: rerun.runId, head: fixHead }, 'plausible');
      expect(await offeredTo(scene, scene.fixer)).toContain(scene.itemId);
      expect(await itemOf(world, scene.itemId)).toMatchObject({ stageKey: 'check', expectedHead: fixHead });
    } finally {
      await world.close();
    }
  });
});
```

`startOn(scene)` starts the Reviewer's run again on the item (the scene's `delegationId`, `pageId` and `persona` are the Reviewer's, from `reviewWorld`). The Reviewer's `postReview` reads the facts at the item's new expected head, which `pushedFix` gave. If the second `postReview` withholds its review because the facts' reviews already hold one from this Reviewer at `fixHead`, that is a defect in this test's set-up, not in the code: give `greenFacts` at `fixHead` with `reviews: []` again before the second round.

- [ ] **Step 2: Run it**

Run: `npx vitest run sim/kernel/fix-claim-journey.test.ts && pnpm sim -- all`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add sim/kernel/fix-claim-journey.test.ts
git commit -m "test(sim): a passing fix waits for the next review round, which opens the next fix

FL-2 FL-3. S17-R2 S17-R8."
```

---

### Task 11: Verify, record, push

**Files:**
- Modify: `docs/progress_tracker.md` (the step 17 row; the S17 rulings; a "Step 17 evidence by requirement" section; Not verified and Waiting on a person rows)

- [ ] **Step 1: Run the whole chain**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres pnpm verify`
Expected: green. `pnpm trace:built` passes once the step row says Built, because FL-1 to FL-4 each have a test titled with their ID. Note the test and scenario counts from the output.

- [ ] **Step 2: Update the tracker**

In `docs/progress_tracker.md`:

1. The step 17 row: `Not started` becomes `Built`; its evidence names the commit SHAs of Tasks 1 to 10, `pnpm verify` green locally with the counts, and "CI not run" or the CI run id.
2. A "Step 17 evidence by requirement" section after step 16's, in the shape of the step 13 section:

| Requirement | Commits | Scenarios and tests |
|---|---|---|
| FL-1 | Tasks 2 to 5 | `sim/kernel/fix-claim.test.ts` (FL-1 block), `sim/scenarios/FL-1.…`, `apps/uw-app/commands/fix-claim.pg.test.ts`, `packages/db/fix-claim-columns.test.ts`, the Store contract's `DX-3 FL-1` case, `packages/contracts/contracts.test.ts` |
| FL-2 | Tasks 5, 6, 10 | `sim/kernel/fix-claim.test.ts` (FL-2 block), `packages/harness/items/fix-offer.test.ts`, `sim/scenarios/FL-2.…`, `sim/kernel/fix-claim-journey.test.ts` |
| FL-3 | Task 7, 10 | `packages/harness/validators/fix.test.ts`, `packages/harness/github/diff-stat.test.ts`, `sim/kernel/fix-validators.test.ts`, `sim/scenarios/FL-3.…` |
| FL-4 | Tasks 8, 9 | `apps/uw-app/engines/claude-code-sandbox/fix.test.ts`, `apps/uw-app/engines/sandbox/registry-egress.test.ts`, the FL-4 case in `github-egress.test.ts`, `apps/uw-app/runs/fix-run.pg.test.ts`, `apps/uw-app/runs/prompts.test.ts` (FL-4 block), `sim/kernel/fix-comments.test.ts` |
| FL-2 (red once) | Task 6 | Deleting `nextRound`'s `fix_claimed` line failed the "spends it" test; restored |

3. Under the step's heading in "Decisions made during the build" (the shape `| date | requirement | ruling | why | cost if wrong |` of the S16 rows), S17-R1 to S17-R13 from the top of this plan.
4. Under "Not verified": the three-exec fix session and the registry route on a real container (whether npm and pnpm fetch tarballs through `registry.internal` with `npm_config_replace_registry_host=always`, whether Corepack honours `COREPACK_NPM_REGISTRY`, whether a background process the model starts survives into the push exec); and that a repository's `.harness/checks.sh` runs inside the container's 25-minute exec limit. Each proven only against the fake container host.
5. Under "Waiting on a person" (Ian): one fix run on staging end to end against a repository that has `.harness/checks.sh`, during GL-1's live run.
6. If any implementer made a choice this plan did not (for example the `claimWithin` object form, or moving `handlerOf` into `submit-gates.ts`), one decision row each.

- [ ] **Step 3: Commit and push**

```bash
git add docs/progress_tracker.md
git commit -m "docs(tracker): step 17, the fix claim, is built

FL-1 FL-2 FL-3 FL-4. Rulings S17-R1 to S17-R13, the evidence by
requirement, and what only a live container can prove."
git push
```

The draft pull request for `build/v0.2.0` already exists; push only.

---

## Self-review

**Spec coverage.** FL-1: the `fix` word was already in the closed set (step 12, `8565f18`) and in `delegations_capability_known` (step 14's `0029`); the column, the default, the switch and "while false the behaviour equals v0.1.0" are Tasks 2 to 5 (`fixOffered` is false with the switch off, so no reach changes for any other capability; KN-5 and AB-4 are re-run). FL-2: the offer after a counted round with a free claim, `poll_queue` to the Builder persona on a harness with the switch on, `claim_item` with a live `fix` delegation, and KN-5's one holder are Task 5, with the pure rules in Task 6 and the loop in Task 10. FL-3: both validators in the registry, run at `submit_to_gate` from a fix claim, each refusing with its own reason and releasing the claim, are Task 7. FL-4: the fix work spec installing and running the declared checks before pushing, `run_failed` with `checks_not_run_locally` for none or failing, and nothing pushed, are Tasks 8 and 9; the fix prompt's review comments as `review_comment` untrusted content in the `related` slot are Task 8. No agent verb is added (V2-7): every change rides on `claim_item`, `submit_to_gate` and the run host.

**Placeholders.** None; every step carries its code or its command. Where a file depends on steps 15 and 16 not yet built, the step says which of their lines to keep and names the function to edit.

**Type consistency.** `FixRead` and `FixStart` are defined in `fix-claim.ts` and used by `claim.ts` and `start.ts`; `FixDiffs` in `fix-submit.ts` and `submit.ts`; `FixContext` in `validators/context.ts`, `fix.ts`, `fix-submit.ts` and its test; `DiffStat` in `diff-stat.ts` and `context.ts`; `FinishEnd`, `SessionFinish` and `SessionExec` in `session.ts`, `fix-checks.ts` and `run.ts`; `FixPhase` in `fix-checks.ts`, `run.ts` and `work.ts`; `Checkout.fix` in `seam.ts`, `builder-github.ts`, `work.ts` and the tests; `ReadText.comments` and `ReadDone.fix` in `prompt-source.ts`, `bodies.ts` and `run-core.ts`. The contract names (`fix_claimed`, `fix_claim_set`, `set_fix_claim`, `fix_size_cap`, `fix_keeps_purpose`, `awaiting_review`, `checks_not_run_locally`) are spelled the same in Tasks 1, 2, 3, 5, 7, 8 and 9.

**Review Focus.** Line 1 is pinned by Tasks 5 and 6; line 2 by Task 5; lines 3 and 4 by Task 9; lines 5 and 6 by Task 7; line 7 by Task 6; line 8 by Task 8.

**Steps 16 and 18.** This plan changes `claimableIn`'s loop body and `claimIn`'s last line, never `heldRefusal`, `capabilityRefusal`, `pickupOpen` or `claimable`, and never the `for … of items.filter(…)` line step 18 replaces.
