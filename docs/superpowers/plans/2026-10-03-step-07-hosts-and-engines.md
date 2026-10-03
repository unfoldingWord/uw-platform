# Step 7: Hosts and Engines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run personas on both hosts: a hosted run is one Cloudflare Workflow per claim with read, scout, work and submit as checkpointed steps that hibernate at a human gate, behind one engine seam with six engines, metered and stopped by a spend breaker; an external run is a person's own Claude Code or Codex over the MCP surface on their subscription, guided by a synced harness skill.

**Architecture:** The kernel gains a runs module (the only writer of `harness_runs`) and a breaker. `kernel.runs.start` claims an item under a delegation, writes the run row and `run_started` in one transaction, then starts a Workflow through the Runs port. Each Workflow step asks `kernel.runs.scene(runId)` for the beat principal derived from the run's delegation and opens one in-process MCP connection with it, so a hosted run reaches the platform only through the verbs. The engine seam is a platform registry keyed by the six engine keys under `apps/uw-app/engines/<key>/`; the two message engines run one shared tool loop (pure, in `packages/harness`) over their vendor SDK's turn; the two container engines run a CLI in a Cloudflare Sandbox whose model key and MCP route are injected by an egress proxy; `claude-managed-agent` is reserved and `external` never runs on the platform. The breaker reads AI Gateway's month-to-date cost through the ModelEngine port once a minute, records each level change as an event on every harness, holds new hosted claims at 75 percent and hibernates running hosted runs at 90.

**Tech Stack:** TypeScript strict, Zod 4, Hono 4, Drizzle over Postgres, Cloudflare Workers, Cloudflare Workflows (`WorkflowEntrypoint`, `step.do`, `step.waitForEvent`), Cloudflare Sandbox (`@cloudflare/sandbox`), `@anthropic-ai/sdk`, `openai` (OpenRouter's OpenAI-compatible API), `@modelcontextprotocol/sdk` (in-memory transport), Vitest (Node and Workers pools), PGlite in the sim.

**Spec:** `docs/PRD.md` (approved; no brainstorm, no approval step). Requirements covered: **HE-1, HE-2, HE-3, HE-4, HE-5, HE-6, HE-7, HE-8, HE-9, HE-10** (HE-10 is Later: reserved and refusing). Carries planned here: the platform Runs adapter's `finish` (step 2); `connectInProcess` derives its principal from the beat, one connection per Workflow step, the `in-process-host-only-in-tests` rule lifted for the step module, `record_run_step` metered in process (step 4); a paused harness or lane and runs (step 3, S6-R50); `prompt_run` and `stop_run` on a run the caller does not own need `admin` (step 6); the Reviewer's review body opens with the `harness-review` block (step 5); and every rule from steps 1 to 6.

## Global Constraints

Every task obeys every line here. Copy exact values; do not paraphrase them in code.

- **Where:** the worktree `/home/ianjl/projects/uw-platform-v1`, branch `build/v1`. Implementers commit; they do not push (the controller pushes and watches CI).
- **Read before the first edit:** `AGENTS.md` sections 1, 4, 6 and 10; `CONTEXT.md` for every word (Run, Run shape, Run step, Host, Engine, Persona, Delegation, Beat, Lease, Principal, Agent identity, Kernel, Port, Adapter, Scenario, and the words Task 1 adds); `docs/exceptions.md`; `docs/architecture.md` sections "The agent boundary" and "Transactions and locks".
- **Verify, at the end of every task, green:** `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. If the local server is down: `/usr/lib/postgresql/16/bin/pg_ctl -D ~/.local/share/uw-platform-test-pg -o "-p 54329 -k '' -c listen_addresses=127.0.0.1" -l ~/.local/share/uw-platform-test-pg.log start`. The local server is private; CI uses a Postgres service container. Run `pnpm format` before verify.
- **R37:** never run two test suites at once. No parallel `pnpm verify`, `pnpm test`, `vitest` or `pnpm sim:all`; wait for one to finish before starting another (concurrent suites kill the WSL VM).
- **DX-8:** no test, binding or job may need a live account or a secret. Engines, the AI Gateway spend reader, the Workflows adapter, the Sandbox host, the GitHub review writer and the diff read are proven against fixtures and fakes (a fake `fetch`, a fake Workflow binding, a fake container host); their live run is recorded under "Waiting on a person". Never add a binding, job or test that fails when a secret is absent: with a secret missing, the code answers `not_wired` (a `PortNotWiredError` or a `not_wired` refusal) and logs, it does not throw at startup.
- **Production:** every Workflows, Durable Object, container, cron or queue binding and every Cloudflare migration goes in `infra/uw-app/wrangler.go-live.toml` only, never `infra/uw-app/wrangler.toml` (S5-R32, S6-R38); each adds a "Waiting on a person" row in the final task. Model and provider credentials are live secrets; nothing may need a live API key.
- **Layering (dependency-cruiser and ESLint enforce it):** `packages/contracts` → nothing; `packages/core` → contracts; `packages/db` → contracts, core; `packages/harness` → contracts, core types, pure (no Workers, Drizzle, vendor SDK, MCP SDK or network); `apps/uw-app` → harness, db, contracts, core, ui; `sim/` → harness, contracts, db and the Node built-ins AGENTS.md lists. A vendor SDK (`@anthropic-ai/*`, `openai`, OpenRouter) is imported only under `apps/uw-app/engines/<key>/` (`pnpm lint:vendor`). `@cloudflare/sandbox` is imported only under `apps/uw-app/engines/`.
- **Code:** no comments of any kind (no line, block, JSDoc or directive comments, no commented-out code). Files under 500 lines; functions under 50 lines; ESLint fitness limits: 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters. TypeScript strict, no `any`, no `@ts-ignore`.
- **Commits:** Conventional Commits. The body's last line lists the requirement IDs the commit proves or serves (for example `HE-1 HE-5`). No `Co-Authored-By` and no attribution footer of any kind. Hooks always pass; never `--no-verify`.
- **Shared roots** (`packages/db/schema.ts`, `packages/db/schema-*.ts`, `packages/contracts/`, `packages/harness/ports.ts`, `packages/core/acl.ts`, `infra/`, `.github/workflows/`, `AGENTS.md`, `CONTEXT.md`, `docs/adr/`): a change goes in its own commit with no feature code, and the message names the shared root and why it changed. Migrations travel with the `schema*.ts` commit that needs them.
- **Exceptions:** any exception to AGENTS.md rules 1 to 4 gets its `docs/exceptions.md` row in the same commit as the code, written before it.
- **Contract version:** Task 1 moves `CONTRACT_VERSION` from `10.0.0` to `11.0.0` and moves `contractVersion` in `apps/uw-app/package.json` and `apps/uw-ingest/package.json` with it. No later task changes `packages/contracts/`.
- **New closed values (contract 11.0.0):** events `run_completed`, `run_prompted`, `hosted_builder_set`; reason `run_not_found`; command `set_hosted_builder`; persona activation refusal `engine_not_available`; closed sets `run-hibernation` (`gate`, `paused`, `breaker`), `run-stop` (`stopped_by_person`, `released`, `lease_expired`, `delegation_lapsed`, `gate_wait_expired`), `run-failure` (`retries_exhausted`, `provider_mismatch`, `start_failed`, `turn_limit`, `lease_lost`), `run-result` (`submitted`, `premise_held`, `decided`, `review_posted`, `review_withheld`, `review_refused`), `breaker-level` (`open`, `holding`, `pausing`), `review-verdict` (`approve`, `request_changes`).
- **Only humans decide gates.** No agent identity can approve, merge, deploy, publish or advance past a human gate by any route or step. A hosted run submits and hibernates; only a person's decision through `kernel.gates.decide` moves a parked item. No Workflow step calls `kernel.gates`, `kernel.stages` or `kernel.delegations.grant`/`revoke`.
- **Agents never hold a GitHub client.** The verbs a hosted run calls are served by a kernel with no GitHub wiring (`hubWiring`). Only the run host's own kernel (`apps/uw-app/runs/`) gets the GitHub read client (for the review diff) and the Reviewer review writes; no model process, sandbox, MCP reply or log line ever carries a token.
- **What an agent sees equals what it may act on** (R27, R32, R33); hidden equals missing (`*_not_found`, byte-identical); delegations are checked on every beat and every step (AB-6, R35).
- **Cost basis is set by the host:** `record_run_step` from HTTP is `subscription` and carries no cost (`costMinor` and `computeMinor` null); in process it is `metered`. Subscription tokens are never counted against the spend cap.
- **Lock order** (`docs/architecture.md`): stage lock (`harness-stages:<harnessId>` before `harness-stage-claims:<stageId>`), then item rows (ascending id), then run rows (ascending id), then grants, then appends; no lock after the first append. Transactions never nest. No port call (Runs, ModelEngine, GitHubFacts, Connectors) inside a Store transaction.
- **One writer per table.** `harness_runs` is written only under `packages/harness/runs/` (`owns` in `packages/harness/runs/owns.ts`); `harnesses` only under `packages/harness/stages/`; `harness_items` and `harness_events` only by the kernel's record functions.
- **R36 trace honesty:** a `describe`/`it`/`test` title that leads with a requirement ID must prove that requirement's clauses; supporting tests lead with no ID. Scenarios are `sim/scenarios/<ID>.<slug>.ts`.
- **Kernel instants and callers:** every kernel read a route or step makes is judged at its own instant; every command passes `{ actor, traceId, requestId }`; every Workflow step's events carry the run's trace id.
- **Loop caps (P34, P26):** the tool loop stops at 40 turns; a tool error goes back to the model as the tool result; Workflow steps retry 3 times.

## Review Focus

The inputs the PRD implies but no single requirement names, most likely first. Each line's test lives in the task named.

1. **A delegation revoked mid-run:** the next step's `kernel.runs.scene` records `delegation_lapsed` once, stops the run `delegation_lapsed`, releases the item, and the step opens no MCP connection. Test in Task 5.
2. **A hosted run's model calling `claim_item` for a second item while the breaker holds:** refused `spend_held`, nothing recorded. Test in Task 8.
3. **A person's decision while the run's Workflow cannot be reached:** the decision commits and the run row reads `running` (resumed), the port failure is swallowed; the Workflow's gate wait later times out and the run stops `gate_wait_expired`. Test in Task 6 (kernel) and Task 18 (core).
4. **Text a model writes to forge a verdict:** a second `harness-scout` or `harness-verdict` block, a block not first, an HTML comment or a CR-only line makes the verdict ambiguous: the scout fails closed (premise held) and no review is posted. Test in Task 11.
5. **An external runner reusing a hosted run's id, or another item's run id, in `record_run_step`:** refused `not_permitted` `{ why: 'run_elsewhere' }`, nothing recorded. Test in Task 5.
6. **`stop_run` by an editor who does not own the run:** `not_permitted`; by an admin: stopped, released, `Runs.stop` called. Test in Task 6 and Task 10.

## Decisions this plan makes

Choices the PRD, the spec and AGENTS.md leave open. The final task copies each into `docs/progress_tracker.md` "Decisions made during the build" with the cost if wrong.

| # | Decision | Cost if wrong |
|---|---|---|
| S7-D1 | `kernel.runs.start` takes the delegation's seed caller (the bare persona identity and the delegation's person, no grants), claims the item under the delegation, inserts the run row and records `run_started` in one transaction, then calls `Runs.start`; a start the port refuses or throws on records `run_failed` `start_failed` and `item_released` in a second transaction and answers `not_wired` (a `PortNotWiredError`) or rethrows | A port that started the Workflow and then threw leaves a Workflow whose first step finds the run failed and ends |
| S7-D2 | Hosted runs are started only by `kernel.runs.beat` (system principal), from the one-minute cron: for each live delegation with a capability other than `none` whose persona has an `active` persona page on that harness with `run_shape: workflow-run` and no live run, it polls as that delegation's beat principal and starts one run on the first item. Personas become `active` only through PE-3 (step 10) or the test seed, so until then the beat starts nothing on the platform | A persona waits up to a minute for its next item |
| S7-D3 | A Workflow step's principal is `kernel.runs.scene(runId)`: the beat principal of the run's delegation at the step's instant, refused unless the run is `running`, the delegation live, `can(write)` holds on the harness's area and the item is held by the run; `connectInProcess` takes a run id, never a principal, and each step opens and closes its own connection | A step that outlives its instant acts on grants judged at the step's start |
| S7-D4 | At a `human_approval` stage the submit step parks the item and hibernates the run (`run_hibernated` `gate`); a person's decision on that item resumes it (`run_resumed` `gate`, then `Runs.resume`, whose failure is swallowed) and the run's close step completes it `decided`; the Workflow waits at most 30 days, then stops the run `gate_wait_expired` | An item undecided for 30 days has no run waiting on it; a person still decides it |
| S7-D5 | Pause hibernates every live hosted run on an item in the paused lane or harness (`run_hibernated` `paused`, then `Runs.hibernate`); resume resumes those no longer under any pause. Lease renewal (`renewLease`) stays accepted while paused (closing the step-3 carry); a run whose lease lapsed while hibernated stops `lease_expired` at its next step | A long pause costs a hosted run its lease and the item is reclaimed |
| S7-D6 | `stop_run` and `prompt_run` need `write` on the area and, when the caller does not own the run (the run's delegation person for a hosted run, the device owner of an external run's holder), `admin`; agents are refused. Stop records `run_stopped` `stopped_by_person`, releases the item and calls `Runs.stop` for a hosted run. Prompt queues the message on the run (at most 20 pending, 4,000 characters each), records `run_prompted`, and delivers it in the next `record_run_step` reply's `prompts` on either host | A runner that never steps again never reads the prompt |
| S7-D7 | `record_run_step` gains `costMinor`, `computeMinor`, `model`, `resolvedProvider`, `toolsCalled`, `writes` (defaults `null`, `null`, `null`, `null`, `[]`, `0`) and answers `prompts`; a `subscription` step with any cost is `malformed_command` `{ why: 'subscription_has_no_cost' }`; a run holds at most 200 steps (`not_permitted` `{ why: 'run_step_limit' }`) | A runner that reports more than 200 steps must start a new run id |
| S7-D8 | External runs: the first `record_run_step` from the external host for an unknown run id creates its `harness_runs` row (`external-run`, engine `external`, persona = the runner's identity, the item's delegation, model from the step or `unreported`); a hosted (metered) step for an unknown run id is `run_not_found`; a run id belonging to another item, shape or runner is `not_permitted` `{ why: 'run_elsewhere' }`. The holder's submit completes the external run `submitted`; release stops it `released`; lease expiry stops it `lease_expired` | A runner that changes run id mid-item shows two runs |
| S7-D9 | Contract 11.0.0 (major: typed evidence replaces any-object evidence for the run, breaker and premise events): the values in Global Constraints; persona frontmatter `provider` (nullable, default null); `persona_activation_failed` evidence `verb` becomes nullable and gains `engine` | None: no external consumer yet |
| S7-D10 | Engine descriptors are kernel data in `packages/harness/engines.ts` (availability, kind, run shapes, default provider, needs hosted Builder, reviewer id); the kernel and the run host read flags and never branch on an engine key | A seventh engine needs a descriptor row as well as a directory |
| S7-D11 | The breaker reads AI Gateway's month-to-date cost through a new `ModelEngine.spend()`; the cap is `AI_SPEND_CAP_MINOR` (default `125000`, currency `USD`, the brief's $1,250 a month); levels by `floor(spent * 100 / cap)`: `open` below 75, `holding` 75 to 89, `pausing` 90 and above; a level change appends `breaker_<level>` to every harness; the current level is the latest breaker event on any harness (none means `open`); `holding` and `pausing` refuse a hosted start and a bare persona's claim `spend_held` with nothing recorded; `pausing` hibernates every running hosted run (`breaker`); `open` resumes runs hibernated for `breaker`; an unreadable spend changes nothing and is logged `breaker_unreadable` | A Gateway outage leaves the breaker at its last level until a reading lands |
| S7-D12 | The engine seam is the platform registry `apps/uw-app/engines/registry.ts` of `EngineAdapter.work(input)` keyed by the six keys; the message engines' `work` is the shared tool loop over their own `turn`; the platform ModelEngine port adapter dispatches `turn` by key over the message engines and reads spend; `claude-managed-agent` and `external` answer `EngineNotAvailableError` | The ModelEngine port carries turn-based engines only; container engines are reached through the registry, not the port |
| S7-D13 | Vendor SDKs: `@anthropic-ai/sdk` for `claude-messages` with base URL `https://gateway.ai.cloudflare.com/v1/<AI_GATEWAY_ACCOUNT_ID>/<AI_GATEWAY_ID>/anthropic` and `ANTHROPIC_API_KEY`; `openai` for `openrouter-messages` with base URL `.../openrouter/v1` and `OPENROUTER_API_KEY`; `AI_GATEWAY_TOKEN`, when set, is sent as `cf-aig-authorization: Bearer <token>`. Any of account, gateway or key absent is not configured (`not_wired`) | AI Gateway's path for a provider differs from its documentation; fixed at go-live |
| S7-D14 | Every run pins a provider: the persona's `provider`, else the engine's default (`anthropic`, `openai`); an `openrouter-messages` persona without one is refused at start `malformed_command` `{ why: 'provider_required' }`. OpenRouter requests carry `provider: { order: [<pin>], allow_fallbacks: false }`; the resolved provider is the response's `provider` lowercased and NFKC-normalised; a mismatch is `ProviderMismatchError`, the run fails `provider_mismatch` and posts no review | A provider whose OpenRouter slug and response name differ fails every run until the persona names the response form |
| S7-D15 | The tool loop stops at 40 turns (`turn_limit`, the run fails, the item is released); a tool error goes back to the model as the tool result; costs are carried as integer micro-units of the currency (`costMicros`) per turn and converted once per step to minor units, rounding half up; the run host renews the lease through `kernel.items.renewLease` when 5 minutes have passed since the last renewal inside a step | A step that costs under half a cent records 0 |
| S7-D16 | The scout step runs on `openrouter-messages` with read-only tools (the persona's toolset intersected with `search_pages`, `read_page`, `resolve_context`, `query_entities`, `get_health`); its model and provider are the persona's when the persona is on `openrouter-messages`, else `ALWAYS_ON_MODEL` (default `z-ai/glm-5.3-flash`) and `ALWAYS_ON_PROVIDER` (default `z-ai`), placeholders (Q10). Its final text must open with a fenced `harness-scout` block (`premise: holds` or `premise: held`, `reason: <one line>`), parsed by the declaration's allowlist rules; anything else is a held premise with reason `no scout verdict`. A held premise records `premise_held`, releases the item, and completes the run `premise_held` | A model that forgets the block holds every premise; held premises are counted per persona (PE-5) |
| S7-D17 | Reviews: a run under a delegation with capability `review` whose work text opens with a fenced `harness-verdict` block (`verdict: approve` or `verdict: request_changes`, then `- ` finding lines) posts a GitHub review on the item's expected head through the new `Connectors.review`, as the engine descriptor's reviewer (`uw-reviewer`, `uw-reviewer-codex`) with that Reviewer App's own token; the body opens with the `harness-review` block (`provider`, `model`) that `parseReviewProvider` reads. Withheld (run completed `review_withheld`) when the item has no pull request or expected head, when the resolved provider is not the pinned one, or when another Reviewer identity's latest review on the head carries the same provider. The diff is read through the new `GitHubFacts.diff` at the head; over 80,000 bytes the item is `checks_failed` `['diff_exceeds_review_budget']` and released for a person, and the run completes `review_refused` | A diff over 80 KB always needs a person; the budget is a constant |
| S7-D18 | Workflows: binding `HARNESS_RUN`, class `HarnessRun`, workflow names `harness-run-staging` and `harness-run-production`, in `wrangler.go-live.toml` only and not in `preview`; steps retry 3 times with exponential backoff from 10 seconds; step timeout 15 minutes, the work step 30 minutes. The platform Runs adapter maps hibernate to `pause()`, resume to `resume()` when paused and otherwise `sendEvent({ type: 'run-resumed' })`, stop to `terminate()`, and status `queued`/`running`/`unknown` to `running`, `paused`/`waiting`/`waitingForPause` to `hibernated`, `terminated` to `stopped`, `complete` to `completed`, `errored` to `failed` | A preview Worker never runs a hosted run |
| S7-D19 | Container engines use `@cloudflare/sandbox` for both (`ClaudeCodeSandbox`, `CodexSandbox`; images `infra/containers/claude-code/Dockerfile`, `infra/containers/codex/Dockerfile`; go-live only). The egress proxy lets a sandbox reach exactly the model host (the key injected, never in the sandbox) and `mcp.internal` (routed to the step's in-process MCP server for the run's principal); everything else is refused 403, GitHub included, so hosted Builder's push and pull request are carried to PE-5 (step 10). Compute cost is sandbox wall time × `SANDBOX_MINOR_PER_HOUR` (default 10, USD) per step. If the installed SDK exposes no outbound interception, `work` answers `not_wired` `{ why: 'egress_unavailable' }` | Hosted Builder cannot push until step 10; the compute rate is a guess until the first invoice |
| S7-D20 | `set_hosted_builder` is an `admin` person-surface command that writes `harnesses.hosted_builder_enabled` and records `hosted_builder_set`; a start on an engine whose descriptor needs hosted Builder, on a harness with it off, is `hosted_builder_off` with nothing recorded; turning it off does not stop a run already started | A run started before the switch-off finishes |
| S7-D21 | The harness skill's repo copy is `skills/harness/SKILL.md`; its page is the source: `pnpm skill:sync -- <page.json>` writes the file from an exported `skill` page and a test proves the file parses as a `skill` page and round-trips. `tools/architecture/skill-scripts.test.ts` refuses a file under `skills/**/scripts/` that names a credential or a URL other than the MCP endpoint, or calls `fetch`, `curl`, `wget`, `gh` or `git push` | The skill page and file drift until someone syncs |
| S7-D22 | One cron `* * * * *` (go-live only) runs, in order, the lease sweep (P8, unscheduled until now), the breaker check and the hosted beat | Three jobs share one invocation's subrequest budget |
| S7-D23 | A run that fails (`run_failed`) releases its item; a run whose next step finds the item no longer held fails `lease_lost` | An item whose run failed returns to the queue at once |
| S7-D24 | One live run per item: a partial unique index on `harness_runs (item_id)` where `outcome IN ('running','hibernated')` | A second runner on one item must wait for the first run to end |
| S7-D25 | AGENTS.md section 10's `can()` for Workflow steps: every host member that acts on the item or on GitHub (`scene`, `hibernateAtGate`, `holdPremise`, `reviewDiff`, `postReview`) first runs the scene check (the beat principal must hold `write` on the harness's area); `complete`, `fail` and `halt` only end the run record and release an item the run holds, which the lease sweep would do anyway, so they need no grant | A run whose owner lost the grant can still be recorded as ended, never act |

---

### Task 1: Contracts 11.0.0: run, breaker and review values, `record_run_step` costs and prompts, `set_hosted_builder`

Shared root `packages/contracts/` in one commit; `docs/PRD.md` and `CONTEXT.md` in a second (CONTEXT.md is a shared root; the PRD rides with it as docs).

**Requirements:** HE-1, HE-4, HE-5, HE-6, HE-8, HE-10 (contract halves); CT-3.

**Files:**
- Modify: `packages/contracts/closed-sets.ts`, `packages/contracts/events.ts`, `packages/contracts/event-evidence.ts`, `packages/contracts/outcomes.ts`, `packages/contracts/commands.ts`, `packages/contracts/verb-io.ts`, `packages/contracts/page-types.ts`, `packages/contracts/registry.ts`, `packages/contracts/index.ts`, `packages/contracts/version.ts`, `packages/contracts/contract-lock.json`, `packages/contracts/events.test.ts`, `packages/contracts/commands.test.ts`, `packages/contracts/page-types.test.ts`
- Create: `packages/contracts/runs.ts`, `packages/contracts/runs.test.ts`; fixtures `packages/contracts/fixtures/{run-hibernation,run-stop,run-failure,run-result,breaker-level,review-verdict,provider-id}/{valid,invalid}/*.json`; new cases under `packages/contracts/fixtures/{event,command,error-reason,persona-frontmatter,persona-activation-refusal}/` and `packages/contracts/verb-fixtures/record_run_step/` (follow the existing layouts exactly)
- Modify: `apps/uw-app/package.json`, `apps/uw-ingest/package.json` (`"contractVersion": "11.0.0"`)
- Modify (second commit): `docs/PRD.md` (8.1 `harness_runs` columns, 8.3 the six new sets, 8.5 `run_not_found`, 8.6 the three new events and a paragraph on run evidence, PE-1 frontmatter gains `provider`), `CONTEXT.md` (new words: **Breaker**, **Run scene**, **Egress proxy**, **Scout verdict**, **Review verdict**, **Hosted Builder**, **Engine descriptor**)

**Interfaces produced:** `runHibernationSchema`, `runStopSchema`, `runFailureSchema`, `runResultSchema`, `breakerLevelSchema`, `reviewVerdictSchema` and their types `RunHibernation`, `RunStop`, `RunFailure`, `RunResult`, `BreakerLevel`, `ReviewVerdict`; `providerIdSchema`, `ProviderId`; `reviewRecordSchema`, `ReviewRecord`; `runStepRecordSchema`, `RunStepRecord`; `recordRunStepReplySchema`; `harnessCommandSchemas.set_hosted_builder`.

- [ ] **Step 1: Write the failing tests**

`packages/contracts/runs.test.ts` (`base` must match the event envelope's real fields; copy them from an existing valid fixture under `packages/contracts/fixtures/event/valid/`):

```ts
import { describe, expect, it } from 'vitest';
import { eventSchema } from './events.ts';
import { providerIdSchema, reviewRecordSchema } from './runs.ts';
import { verbIo } from './verb-io.ts';

const runId = '00000000-0000-4000-8000-0000000000a1';
const base = {
  eventId: '00000000-0000-4000-8000-0000000000a2',
  harnessId: '00000000-0000-4000-8000-0000000000a3',
  itemId: '00000000-0000-4000-8000-0000000000a4',
  position: 1,
  at: '2026-10-03T09:00:00.000Z',
  actor: 'agent:builder',
  traceId: '00000000-0000-4000-8000-0000000000a5',
  requestId: null,
};

describe('HE-1 a run is recorded with closed-set evidence', () => {
  it('names why a run hibernated, stopped, failed and how it ended', () => {
    const parse = (name: string, evidence: object) =>
      eventSchema.safeParse({ ...base, name, evidence }).success;
    expect(parse('run_hibernated', { runId, why: 'gate' })).toBe(true);
    expect(parse('run_hibernated', { runId, why: 'nap' })).toBe(false);
    expect(parse('run_stopped', { runId, why: 'stopped_by_person' })).toBe(true);
    expect(parse('run_failed', { runId, step: 'work', why: 'retries_exhausted', detail: null })).toBe(true);
    expect(
      parse('run_completed', { runId, result: 'decided', gates: ['ship'], review: null }),
    ).toBe(true);
    expect(parse('run_completed', { runId, result: 'merged', gates: [], review: null })).toBe(false);
  });

  it('keeps an older run_step_recorded without costs parsing, with null costs', () => {
    const parsed = eventSchema.parse({
      ...base,
      name: 'run_step_recorded',
      evidence: {
        runId,
        step: 'read',
        tokensIn: 0,
        tokensOut: 0,
        costBasis: 'metered',
        leaseExpiresAt: '2026-10-03T09:15:00.000Z',
      },
    });
    expect(parsed.evidence).toMatchObject({ costMinor: null, toolsCalled: [], writes: 0 });
  });
});

describe('HE-6 a subscription step reports tokens and no cost', () => {
  it('takes the cost fields as optional on record_run_step and answers prompts', () => {
    const input = verbIo.record_run_step.input.parse({
      itemId: base.itemId,
      runId,
      step: 'work',
      tokensIn: 10,
      tokensOut: 2,
      costBasis: 'subscription',
    });
    expect(input).toMatchObject({ costMinor: null, computeMinor: null, toolsCalled: [], writes: 0 });
    expect(Object.keys(verbIo.record_run_step.output.shape)).toContain('prompts');
  });
});

describe('HE-4 a provider id is a slug', () => {
  it('accepts lowercase slugs and refuses display names', () => {
    expect(providerIdSchema.safeParse('deepinfra').success).toBe(true);
    expect(providerIdSchema.safeParse('DeepInfra').success).toBe(false);
    expect(providerIdSchema.safeParse('deep infra').success).toBe(false);
  });

  it('records the reviewer, provider, model and verdict of a posted review', () => {
    const record = { reviewer: 'uw-reviewer', provider: 'z-ai', model: 'glm', verdict: 'approve', reviewId: 7 };
    expect(reviewRecordSchema.safeParse(record).success).toBe(true);
    expect(reviewRecordSchema.safeParse({ ...record, verdict: 'merge' }).success).toBe(false);
  });
});
```

Add to `packages/contracts/commands.test.ts` (title `HE-8 hosted Builder is turned on through a command`): `{ command: 'set_hosted_builder', requestId, enabled: true }` parses; without `enabled`, or with `enabled: 'yes'`, it does not. Add to `packages/contracts/page-types.test.ts` (title `HE-4 a persona pins its provider`): persona frontmatter without `provider` parses with `provider: null`; `provider: 'z-ai'` parses; `provider: 'Z AI'` does not. Add to `packages/contracts/events.test.ts`: `breaker_holding` needs `{ spentMinor, capMinor, currency, percent }`; `hosted_builder_set` needs `{ enabled }`; `premise_held` needs `{ runId, reason }` with a one-line reason; `persona_activation_failed` with `verb: null, engine: 'claude-managed-agent', reason: 'engine_not_available'` parses.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run packages/contracts`
Expected: FAIL (`./runs.ts` missing; `run_hibernated` evidence untyped).

- [ ] **Step 3: Write the contracts**

`packages/contracts/closed-sets.ts`, append (and export the types beside the others):

```ts
export const runHibernationSchema = z.enum(['gate', 'paused', 'breaker']);
export const runStopSchema = z.enum([
  'stopped_by_person',
  'released',
  'lease_expired',
  'delegation_lapsed',
  'gate_wait_expired',
]);
export const runFailureSchema = z.enum([
  'retries_exhausted',
  'provider_mismatch',
  'start_failed',
  'turn_limit',
  'lease_lost',
]);
export const runResultSchema = z.enum([
  'submitted',
  'premise_held',
  'decided',
  'review_posted',
  'review_withheld',
  'review_refused',
]);
export const breakerLevelSchema = z.enum(['open', 'holding', 'pausing']);
export const reviewVerdictSchema = z.enum(['approve', 'request_changes']);
```

`packages/contracts/runs.ts` (complete):

```ts
import { z } from 'zod';
import { reviewVerdictSchema } from './closed-sets.ts';
import { runStepSchema } from './verb-io.ts';
import { verbNameSchema } from './verb-names.ts';

export const providerIdSchema = z.string().regex(/^[a-z0-9._-]{1,64}$/);
export type ProviderId = z.infer<typeof providerIdSchema>;

const minor = z.number().int().min(0);
const model = z.string().min(1).max(200);

export const reviewRecordSchema = z.strictObject({
  reviewer: z.string().regex(/^[a-z0-9-]{1,64}$/),
  provider: providerIdSchema,
  model,
  verdict: reviewVerdictSchema,
  reviewId: z.number().int().nullable(),
});
export type ReviewRecord = z.infer<typeof reviewRecordSchema>;

export const runStepCosts = {
  costMinor: minor.nullable().default(null),
  computeMinor: minor.nullable().default(null),
  model: model.nullable().default(null),
  resolvedProvider: providerIdSchema.nullable().default(null),
  toolsCalled: z.array(verbNameSchema).max(200).default([]),
  writes: z.number().int().min(0).max(10_000).default(0),
};

export const runStepRecordSchema = z.strictObject({
  step: runStepSchema,
  tokensIn: minor,
  tokensOut: minor,
  ...runStepCosts,
  at: z.iso.datetime(),
});
export type RunStepRecord = z.infer<typeof runStepRecordSchema>;
```

`runStepSchema` already lives in `verb-io.ts`; if importing it from `runs.ts` creates a cycle with `verb-io.ts` importing `runStepCosts`, move `runStepSchema` into `runs.ts` and re-export it from `verb-io.ts` unchanged.

`packages/contracts/verb-io.ts`: `record_run_step.input` becomes `z.object({ itemId, runId, step, tokensIn, tokensOut, costBasis, ...runStepCosts })`; its output becomes `recordRunStepReplySchema = lease.extend({ prompts: z.array(z.string().min(1).max(4000)).max(20) })` (exported). `claim_item` keeps `lease`.

`packages/contracts/event-evidence.ts`, new entries (import the new sets, `providerIdSchema`, `reviewRecordSchema`, `runStepCosts`, `engineSchema`, `runShapeSchema`, `identitySchema`):

```ts
const breakerEvidence = z.strictObject({
  spentMinor: z.number().int().min(0),
  capMinor: z.number().int().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  percent: z.number().int().min(0).max(100_000),
});
```

- `run_started: { runId: id, persona: identitySchema, runShape: runShapeSchema, engine: engineSchema, model: z.string().min(1).max(200), delegationId: id.nullable() }`
- `run_step_recorded`: the existing fields plus `...runStepCosts`
- `run_hibernated` and `run_resumed: { runId: id, why: runHibernationSchema }`
- `run_stopped: { runId: id, why: runStopSchema }`
- `run_failed: { runId: id, step: runStepSchema.nullable(), why: runFailureSchema, detail: z.string().max(500).nullable() }`
- `run_completed: { runId: id, result: runResultSchema, gates: z.array(stage).max(20), review: reviewRecordSchema.nullable() }`
- `run_prompted: { runId: id, message: z.string().min(1).max(4000) }`
- `premise_held: { runId: id.nullable(), reason: oneLine }`
- `breaker_holding`, `breaker_pausing`, `breaker_open`: `breakerEvidence`
- `hosted_builder_set: { enabled: z.boolean() }`
- `persona_activation_failed`: `verb` becomes `z.string().regex(/^[a-z][a-z_]*$/).nullable()`, add `engine: engineSchema.nullable().default(null)`; `personaActivationRefusalSchema` gains `'engine_not_available'`.

`packages/contracts/events.ts`: add `'run_completed'` and `'run_prompted'` to `eventNames` after `'run_stopped'`, and `'hosted_builder_set'` after `'harness_resumed'`. `packages/contracts/outcomes.ts`: append `'run_not_found'`. `packages/contracts/commands.ts`: append `'set_hosted_builder'` to `commandNames`, `set_hosted_builder: body('set_hosted_builder', { enabled: z.boolean() })` to `harnessCommandSchemas` and to the `commandSchema` union. `packages/contracts/page-types.ts`: `personaFrontmatterSchema` gains `provider: providerIdSchema.nullable().default(null)`.

Register `run-hibernation`, `run-stop`, `run-failure`, `run-result`, `breaker-level`, `review-verdict`, `provider-id`, `review-record`, `run-step-record` in `registry.ts`; add a `11.0.0` entry to `contract-lock.json` holding every set of `10.0.0` plus the six new sets, the three new event names, `run_not_found`, `set_hosted_builder` and `engine_not_available`; `CONTRACT_VERSION = '11.0.0'`; export the new names from `index.ts`.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/contracts`
Expected: PASS, including `contract-lock.test.ts` (a major bump may add and tighten).

- [ ] **Step 5: Docs commit**

PRD 8.1 `harness_runs` row becomes: "item, persona, persona page, delegation, run shape (the run shape names the host), engine, model, pinned and resolved provider, steps with tokens, cost, compute cost and cost basis, gates met, pending prompts, trace id, outcome and why it hibernated or failed". 8.6 adds a paragraph: "`run_started`, `run_hibernated`, `run_resumed`, `run_stopped`, `run_failed`, `run_completed` and `run_prompted` (contract 11.0.0) record a run's life with closed-set reasons; `breaker_*` carry the spend reading; `hosted_builder_set` records the switch." CONTEXT.md entries, one or two sentences each, in the file's existing format: **Breaker** (the spend guard over AI Gateway's cost: holds new hosted claims at 75 percent of the cap, hibernates running hosted runs at 90; _Avoid_: budget, limiter), **Run scene** (what a hosted step acts as: the run, its item and the beat principal derived from its delegation at that step), **Egress proxy** (the platform hook a sandbox's outbound traffic passes through: it injects the model key and routes the MCP host, and refuses everything else), **Scout verdict** (the fenced `harness-scout` block that ends a scout step: the premise holds or is held), **Review verdict** (the fenced `harness-verdict` block that ends a review run's work), **Hosted Builder** (the per-harness switch that lets Builder run on `claude-code-sandbox`; off by default), **Engine descriptor** (the kernel's data about one engine: availability, kind, run shapes, default provider, reviewer identity).

- [ ] **Step 6: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS. The kernel's existing `run_step_recorded` drafts still type-check because the new fields default.

```bash
git add packages/contracts apps/uw-app/package.json apps/uw-ingest/package.json
git commit -m "feat(contracts): contract 11.0.0, run and breaker evidence, record_run_step costs and prompts, set_hosted_builder

Shared root packages/contracts: typed evidence replaces any-object evidence
for the run, breaker and premise events (a tightening, so major).

HE-1 HE-4 HE-5 HE-6 HE-8 HE-10 CT-3"
git add docs/PRD.md CONTEXT.md
git commit -m "docs(prd): the run record, the new closed sets and the step-7 words

Shared root CONTEXT.md: Breaker, Run scene, Egress proxy, Scout verdict,
Review verdict, Hosted Builder, Engine descriptor.

HE-1 HE-5 HE-8"
```

---

### Task 2: The run table's columns, the runs gateway, the latest named event and the active persona read

Shared root `packages/db/schema.ts` with its migration in one commit; shared root `packages/harness/ports.ts` in a second; the store implementation, its contract cases and the sim and platform bindings in a third.

**Requirements:** HE-1, HE-5 (storage); DX-3.

**Files:**
- Modify: `packages/db/schema.ts` (`harnessRuns`), `packages/db/harness-tables.test.ts`, `packages/db/kernel-defaults.test.ts`
- Create: `packages/db/migrations/0023_runs.sql` (generated with `pnpm db:generate`, then the hand-written CHECKs and indexes appended), the journal entry `pnpm db:generate` writes
- Modify: `packages/harness/ports.ts`
- Create: `packages/db/store/runs.ts`, `packages/harness/port-contracts/store-runs.ts`
- Modify: `packages/db/store/store.ts`, `packages/db/store/types.ts`, `packages/db/store/rows.ts`, `packages/db/store/events.ts`, `packages/db/store/pages.ts`, `packages/db/store/index.ts`, `packages/harness/port-contracts/store.ts` (call the new describe), `packages/harness/port-contracts/store-gateways.ts` (the `Object.keys(tx)` members test gains `harnessRuns`, sorted), `packages/harness/port-contracts/store-gateway-fixtures.ts`

**Migration `0023_runs.sql`** (after drizzle-kit's `ADD COLUMN`s, hand-write the rest; the event-name CHECK follows `0020`'s pattern with the full 11.0.0 list):

```sql
ALTER TABLE "harness_runs" ADD COLUMN "persona_page_id" uuid REFERENCES "pages"("id");--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "delegation_id" uuid REFERENCES "delegations"("id");--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "pinned_provider" text;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "compute_minor" bigint;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "hibernated_for" text;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "failure" text;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "gates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "prompts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_hibernated_for_known" CHECK ("hibernated_for" IS NULL OR "hibernated_for" IN ('gate', 'paused', 'breaker'));--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_hibernated_has_why" CHECK (("outcome" = 'hibernated') = ("hibernated_for" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_failure_known" CHECK ("failure" IS NULL OR "failure" IN ('retries_exhausted', 'provider_mismatch', 'start_failed', 'turn_limit', 'lease_lost'));--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_subscription_has_no_cost" CHECK ("cost_basis" <> 'subscription' OR ("cost_minor" IS NULL AND "compute_minor" IS NULL));--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_shape_matches_engine" CHECK (("run_shape" = 'external-run') = ("engine" = 'external'));--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_steps_bounded" CHECK (jsonb_typeof("steps") = 'array' AND jsonb_array_length("steps") <= 200);--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_prompts_bounded" CHECK (jsonb_typeof("prompts") = 'array' AND jsonb_array_length("prompts") <= 20);--> statement-breakpoint
CREATE UNIQUE INDEX "harness_runs_one_live_per_item" ON "harness_runs" ("item_id") WHERE "outcome" IN ('running', 'hibernated');--> statement-breakpoint
CREATE INDEX "harness_runs_live" ON "harness_runs" ("harness_id") WHERE "outcome" IN ('running', 'hibernated');--> statement-breakpoint
ALTER TABLE "harness_events" DROP CONSTRAINT "harness_events_name_known";--> statement-breakpoint
ALTER TABLE "harness_events" ADD CONSTRAINT "harness_events_name_known" CHECK ("harness_events"."name" IN ( /* every name of 0020 plus 'run_completed', 'run_prompted', 'hosted_builder_set' */ ));
```

(The last statement's list is written out literally from `eventNames`; the placeholder above is plan text, not SQL to copy.) Declare the same columns, CHECKs and indexes in `schema.ts` so the drift check passes; express the index predicates with `sql`.

**Port additions** (`packages/harness/ports.ts`, its own commit):

```ts
export type RunRow = {
  readonly id: string;
  readonly harnessId: string;
  readonly itemId: string;
  readonly persona: Identity;
  readonly personaPageId: string | null;
  readonly delegationId: string | null;
  readonly runShape: RunShape;
  readonly engine: Engine;
  readonly model: string;
  readonly pinnedProvider: string | null;
  readonly resolvedProvider: string | null;
  readonly steps: readonly RunStepRecord[];
  readonly costMinor: number | null;
  readonly computeMinor: number | null;
  readonly costBasis: CostBasis;
  readonly traceId: string;
  readonly outcome: RunOutcome;
  readonly hibernatedFor: RunHibernation | null;
  readonly failure: RunFailure | null;
  readonly gates: readonly string[];
  readonly prompts: readonly string[];
  readonly startedAt: Date;
  readonly endedAt: Date | null;
};
export type HarnessRunsGateway = {
  readonly read: {
    byId(runId: string): Promise<RunRow | null>;
    lock(runId: string): Promise<RunRow | null>;
    liveForItem(itemId: string): Promise<RunRow | null>;
    live(harnessId: string | null): Promise<readonly RunRow[]>;
  };
  readonly write: {
    insert(run: RunRow): Promise<void>;
    update(run: RunRow): Promise<boolean>;
  };
};
```

`StoreTransaction` gains `readonly harnessRuns: HarnessRunsGateway`. `HarnessEventsGateway.read` gains `latestNamed(names: readonly EventName[], harnessId: string | null): Promise<HarnessEvent | null>` (the newest by `at`, then position, among events with one of the names, in that harness or in any). `PagesGateway.read` gains `activePersona(identity: Identity, harnessId: string): Promise<PageFacts | null>` (a `persona` page with status `active` whose frontmatter `identity` and `harness` equal the arguments; the newest by version if several). `TurnUsage.costMinor` is not touched here (Task 3).

**Store semantics** (`packages/db/store/runs.ts`): `lock` is `SELECT id FROM harness_runs WHERE id = $1 FOR UPDATE`, then a read (S5-R48's pattern). `liveForItem` reads the one row with `outcome IN ('running','hibernated')`. `live(null)` lists every live row, `live(h)` those of harness `h`, ordered by id. `update` writes every mutable column (`resolved_provider`, `steps`, `cost_minor`, `compute_minor`, `outcome`, `hibernated_for`, `failure`, `gates`, `prompts`, `ended_at`) where `id` matches and answers whether a row changed. Row mapping in `rows.ts` parses `steps` with `runStepRecordSchema` and `gates`/`prompts` as string arrays.

- [ ] **Step 1: Write the failing tests**

`packages/harness/port-contracts/store-runs.ts` exports `describeStoreRuns(open)` (titled `DX-3 store runs gateway on <adapter>`), called from `describeStoreContract`. Cases: insert then `byId` round-trips every field (steps, gates and prompts as arrays, `costMinor` null for subscription); `update` changes `outcome` and answers `true`, and answers `false` for a missing id; a second live row for one item is refused by `harness_runs_one_live_per_item` (assert `StoreRefusedError` with that constraint); a row may be inserted for an item whose earlier run is `completed`; a subscription row with a cost is refused (`harness_runs_subscription_has_no_cost`); `hibernated` without `hibernatedFor` is refused (`harness_runs_hibernated_has_why`); `live(harnessId)` lists running and hibernated rows only; `latestNamed(['breaker_holding','breaker_open'], null)` answers the newest across two harnesses and `null` when none; `activePersona` finds an active persona page by identity and harness, and answers `null` for a `suggested` one, another harness and another identity (seed pages with `seedPage` and `activateSeededPage` from `@uw/db/test-seed`).

Update `packages/db/harness-tables.test.ts` for the new columns and constraints (titles without a requirement ID, R36) and `kernel-defaults.test.ts` (no default on an id or instant; `gates` and `prompts` default `[]` is allowed because they are not ids or instants — extend its allow-list by name).

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run packages/db sim/adapters/store.contract.test.ts`
Expected: FAIL (`harnessRuns` missing on the transaction).

- [ ] **Step 3: Implement**

The schema commit, the ports commit, then `packages/db/store/runs.ts` (`bindRuns(executor)`), `bindEvents` gains `latestNamed`, `bindPages` gains `activePersona` (a Drizzle query on `pages` with `frontmatter->>'identity'` and `frontmatter->>'harness'`), `bind` adds `harnessRuns: bindRuns(executor)`. The sim and the platform Store bindings need no change beyond the type (they bind `@uw/db/store`).

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS on both the embedded Postgres and the server.

```bash
git add packages/db/schema.ts packages/db/migrations
git commit -m "feat(db): harness_runs carries its delegation, persona page, pin, compute cost, gates and prompts

Shared root packages/db/schema.ts with migration 0023: one live run per item,
subscription rows carry no cost, three new event names.

HE-1 HE-5"
git add packages/harness/ports.ts
git commit -m "feat(harness): the store port gains the runs gateway, the latest named event and the active persona read

Shared root packages/harness/ports.ts.

HE-1 HE-5"
git add packages/db packages/harness/port-contracts
git commit -m "feat(db): the runs gateway, latestNamed and activePersona in the shared store

HE-1 HE-5 DX-3"
```

---

### Task 3: Ports: AI Gateway spend, the review diff, the review write, and turn costs in micro-units

Shared root `packages/harness/ports.ts` in one commit; the contract suites, the sim adapters and the platform adapter stubs in a second.

**Requirements:** HE-4, HE-5, HE-9 (port halves); DX-3.

**Files:**
- Modify: `packages/harness/ports.ts`, `packages/harness/index.ts`
- Modify: `packages/harness/port-contracts/model-engine.ts`, `packages/harness/port-contracts/github-facts.ts`, `packages/harness/port-contracts/connectors.ts`
- Modify: `sim/adapters/model-engine.ts`, `sim/adapters/github-facts.ts`, `sim/adapters/connectors.ts`, `apps/uw-app/ports/model-engine.not-wired.ts`, `apps/uw-app/ports/github-facts.ts`, `apps/uw-app/ports/github-facts.not-wired.ts`, `apps/uw-app/ports/connectors.ts`
- Modify: every test fixture that builds a `TurnUsage` (grep `costMinor:` under `packages/harness/port-contracts/` and `sim/`)

**Port changes** (`packages/harness/ports.ts`):

```ts
export type TurnUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number | null;
  readonly costBasis: CostBasis;
};
export type Spend = {
  readonly spentMinor: number;
  readonly currency: string;
  readonly since: Date;
  readonly asOf: Date;
};
export type ModelEngine = {
  turn(request: TurnRequest): Promise<TurnResult>;
  spend(since: Date): Promise<Spend>;
};

export type DiffRange = { readonly base: string; readonly head: string };
export type DiffRead =
  | { readonly kind: 'diff'; readonly text: string; readonly bytes: number }
  | { readonly kind: 'too_large'; readonly bytes: number | null }
  | { readonly kind: 'unavailable'; readonly reason: string };
export type GitHubFacts = {
  pullRequest(ref: PullRequestRef): Promise<PullRequestFacts | null>;
  refresh(ref: PullRequestRef): Promise<PullRequestFacts | null>;
  diff(ref: PullRequestRef, range: DiffRange, budgetBytes: number): Promise<DiffRead>;
};

export type ReviewRequest = {
  readonly reviewer: string;
  readonly repository: string;
  readonly pullRequest: PullRequestRef;
  readonly head: string;
  readonly verdict: ReviewVerdict;
  readonly body: string;
  readonly traceId: string;
};
export type ReviewOutcome =
  | { readonly outcome: 'posted'; readonly reviewId: number }
  | { readonly outcome: 'refused'; readonly reason: string };
export type Connectors = {
  run(request: ConnectorRequest): Promise<ConnectorOutcome>;
  outcomeOf(request: ConnectorRequest): Promise<ConnectorOutcome | null>;
  review(request: ReviewRequest): Promise<ReviewOutcome>;
};
```

**Contract cases:** ModelEngine: `spend(since)` answers a non-negative integer `spentMinor`, a three-letter currency and `asOf >= since`; usage reports `costMicros` as a non-negative integer or null. GitHubFacts: `diff` answers `too_large` when the scripted diff exceeds the budget and `diff` with `bytes` equal to the UTF-8 length otherwise; the not-wired platform adapter refuses `diff` (`describeNotWired` gains `diff: true`). Connectors: `review` answers `posted` with an integer id for a scripted success and `refused` with the reason for a scripted refusal; it never throws for a refusal.

**Sim adapters:** `SimModelEngine` gains `setSpend(spend: Spend)` (default `{ spentMinor: 0, currency: 'USD' }`) and `spend` answers it with `since` echoed and `asOf` from the sim clock; `SimGitHubFacts` gains `setDiff(ref, range, text)` and `diff` answers `unavailable` `no_diff` when none is set; `SimConnectors` gains `reviews(): readonly ReviewRequest[]` (what was posted) and `refuseNextReview(reason)`.

**Platform stubs (wired for real in Tasks 13 and 17):** `modelEngineNotWired.spend` is `notWiredCall('modelEngine', 'spend')`; `platformGitHubFacts(...).diff` answers `{ kind: 'unavailable', reason: 'not_wired' }` until Task 17; `platformConnectors(...).review` answers `{ outcome: 'refused', reason: 'not_wired' }` until Task 17.

- [ ] **Step 1:** Write the contract cases first; run `pnpm vitest run sim/adapters apps/uw-app/ports`; expected FAIL.
- [ ] **Step 2:** Make the ports commit, then the adapters and stubs; rename every `costMinor` in a `TurnUsage` fixture to `costMicros` (value × 10,000 for USD minor to micros).
- [ ] **Step 3: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS.

```bash
git add packages/harness/ports.ts
git commit -m "feat(harness): the ports gain AI Gateway spend, the review diff and the review write

Shared root packages/harness/ports.ts: turn usage moves to integer micro-units
so a cheap turn is not rounded to zero before a step sums it.

HE-4 HE-5 HE-9"
git add packages/harness sim/adapters apps/uw-app/ports
git commit -m "feat(sim): spend, diff and review on the test adapters, not-wired stubs on the platform

HE-4 HE-5 HE-9 DX-3"
```

---

### Task 4: Engine descriptors, run shapes, and a reserved engine refused at activation

**Requirements:** HE-2 (the registry's data half), HE-10.

**Files:**
- Create: `packages/harness/engines.ts`, `packages/harness/engines.test.ts`, `packages/harness/runs/shapes.ts`
- Modify: `packages/harness/personas/activate.ts`, `packages/harness/personas/tool-check.ts` (if the refusal lives there), `packages/harness/index.ts`, `sim/kernel/persona-activation.test.ts`

**Interface** (`packages/harness/engines.ts`, complete):

```ts
import { engineSchema, type Engine, type RunShape } from '@uw/contracts';

export type EngineKind = 'messages' | 'sandbox' | 'external';
export type EngineDescriptor = {
  readonly key: Engine;
  readonly availability: 'available' | 'reserved';
  readonly kind: EngineKind;
  readonly runShapes: readonly RunShape[];
  readonly defaultProvider: string | null;
  readonly needsHostedBuilder: boolean;
  readonly reviewer: string | null;
};

const descriptors: Readonly<Record<Engine, EngineDescriptor>> = {
  'claude-messages': {
    key: 'claude-messages',
    availability: 'available',
    kind: 'messages',
    runShapes: ['workflow-run'],
    defaultProvider: 'anthropic',
    needsHostedBuilder: false,
    reviewer: 'uw-reviewer',
  },
  'claude-code-sandbox': {
    key: 'claude-code-sandbox',
    availability: 'available',
    kind: 'sandbox',
    runShapes: ['workflow-run'],
    defaultProvider: 'anthropic',
    needsHostedBuilder: true,
    reviewer: null,
  },
  'claude-managed-agent': {
    key: 'claude-managed-agent',
    availability: 'reserved',
    kind: 'sandbox',
    runShapes: ['workflow-run'],
    defaultProvider: 'anthropic',
    needsHostedBuilder: true,
    reviewer: null,
  },
  'codex-sandbox': {
    key: 'codex-sandbox',
    availability: 'available',
    kind: 'sandbox',
    runShapes: ['workflow-run'],
    defaultProvider: 'openai',
    needsHostedBuilder: false,
    reviewer: 'uw-reviewer-codex',
  },
  external: {
    key: 'external',
    availability: 'available',
    kind: 'external',
    runShapes: ['external-run'],
    defaultProvider: null,
    needsHostedBuilder: false,
    reviewer: null,
  },
  'openrouter-messages': {
    key: 'openrouter-messages',
    availability: 'available',
    kind: 'messages',
    runShapes: ['workflow-run'],
    defaultProvider: null,
    needsHostedBuilder: false,
    reviewer: 'uw-reviewer',
  },
};

export function engineDescriptor(key: Engine): EngineDescriptor {
  return descriptors[engineSchema.parse(key)];
}

export function engineDescriptors(): readonly EngineDescriptor[] {
  return engineSchema.options.map((key) => descriptors[key]);
}

export function hostable(key: Engine, shape: RunShape): boolean {
  const descriptor = engineDescriptor(key);
  return descriptor.availability === 'available' && descriptor.runShapes.includes(shape);
}
```

(`descriptors[key]` with a literal-typed record and a parsed key keeps `security/detect-object-injection` quiet; if the lint still flags it, use a `Map` built from the record as `verbIo` does.)

`packages/harness/runs/shapes.ts`: `export const workflowRunSteps = ['read', 'scout', 'work', 'submit'] as const satisfies readonly RunStep[];` and `export const runShapes: Readonly<Record<RunShape, { readonly host: 'platform' | 'external'; readonly costBasis: CostBasis }>> = { 'workflow-run': { host: 'platform', costBasis: 'metered' }, 'external-run': { host: 'external', costBasis: 'subscription' } };`

**HE-10 at activation:** in `kernel.personas.activate`, after the version check and before the tool check, a persona whose frontmatter `engine` descriptor is `reserved` is refused `engine_not_available` `{ engine }` and records `persona_activation_failed` with `verb: null`, `engine`, `reason: 'engine_not_available'`, `message: 'persona X uses engine Y, which is not available'`, `itemId: null`; no item opens.

- [ ] **Step 1: Write the failing tests**

`packages/harness/engines.test.ts`:
- `HE-2 every engine key has exactly one descriptor`: `engineDescriptors().map((d) => d.key)` equals `engineSchema.options`.
- `HE-2 no descriptor lets a reserved engine host a run`: `hostable('claude-managed-agent', 'workflow-run')` is false; `hostable('external', 'workflow-run')` is false; `hostable('openrouter-messages', 'workflow-run')` is true.
- `HE-9 the codex engine reviews as the second Reviewer identity`: its `reviewer` is `uw-reviewer-codex`, the message engines' is `uw-reviewer`, and both ids are reviewer ids in `packages/harness/github/reviewers.ts` (import its exported list; if it exports none, read through its `reviewerOf` with the `[bot]` logins).
- `HE-10 claude-managed-agent is reserved`.

`sim/kernel/persona-activation.test.ts` gains `HE-10 activating a persona on claude-managed-agent is refused engine_not_available and opens no item` (asserts the outcome, the one `persona_activation_failed` event with `verb: null` and `engine`, and no `item_created`).

- [ ] **Step 2:** Run `pnpm vitest run packages/harness/engines.test.ts sim/kernel/persona-activation.test.ts`; expected FAIL.
- [ ] **Step 3:** Implement; export `engineDescriptor`, `engineDescriptors`, `hostable`, `EngineDescriptor`, `workflowRunSteps`, `runShapes` from `@uw/harness`.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add packages/harness sim/kernel
git commit -m "feat(harness): engine descriptors and run shapes as kernel data; a reserved engine is refused at activation

HE-2 HE-10"
```

---

### Task 5: Kernel runs: start a hosted run, derive a step's principal, record steps on both hosts

**Requirements:** HE-1, HE-6, HE-8 (refusal), AB-6 (lapse at the step).

**Files:**
- Create: `packages/harness/runs/rows.ts` (run row helpers: `newHostedRun`, `newExternalRun`, `withStep`, `ended`), `packages/harness/runs/persona.ts` (`personaOfPage(facts): RunPersona | Refused`), `packages/harness/runs/start.ts`, `packages/harness/runs/scene.ts`, `packages/harness/runs/steps.ts`, `packages/harness/runs/commands.ts`, `packages/harness/runs/breaker-level.ts` (`currentLevel(tx)`; Task 8 adds the rest of the breaker)
- Modify: `packages/harness/delegations/commands.ts` (export `beatWithin`; `beatIn` becomes it), `packages/harness/items/claim.ts` (export `claimWithin(ports, tx, caller, input, at)`; `claim` calls it), `packages/harness/items/run-steps.ts` (calls `recordStepIn` from `runs/steps.ts` inside `renewIn` when an input is given; answers `prompts`), `packages/harness/kernel.ts` (`runs: RunCommands`), `packages/harness/index.ts`, `apps/uw-app/mcp/verbs/record-run-step.ts` (pass the new fields; answer `prompts`)
- Create tests: `sim/kernel/run-start.test.ts`, `sim/kernel/run-scene.test.ts`, `sim/kernel/run-steps.test.ts`, `sim/runs.ts` (scene helper: a harness from the software template, an active persona page, a live delegation, an item in Scope)

**Interfaces** (`packages/harness/runs/commands.ts`; Tasks 6, 7, 8 and 17 add members):

```ts
export type RunPersona = {
  readonly identity: Identity;
  readonly pageId: string;
  readonly engine: Engine;
  readonly model: string;
  readonly provider: string;
  readonly toolset: readonly VerbName[];
  readonly instructions: string;
};
export type StartRunInput = {
  readonly itemId: string;
  readonly delegationId: string;
  readonly personaPageId: string;
};
export type StartedRun = {
  readonly runId: string;
  readonly harnessId: string;
  readonly itemId: string;
  readonly persona: Identity;
  readonly engine: Engine;
  readonly model: string;
  readonly leaseExpiresAt: string | null;
};
export type RunScene = {
  readonly run: RunRow;
  readonly principal: Principal;
  readonly harness: Harness;
  readonly item: ItemState;
  readonly persona: RunPersona;
  readonly capability: CapabilityWord;
};
export type RunCommands = {
  start(caller: Caller, input: StartRunInput): Promise<KernelOutcome<StartedRun>>;
  scene(runId: string): Promise<KernelOutcome<RunScene>>;
};
```

**Start, in order** (`runs/start.ts`; one transaction, then the port):
1. Item, harness and stages read as claim does; `item_not_found`, `harness_not_found` as claim does.
2. The persona page: `tx.pages.read.facts([personaPageId])`; refuse `page_not_found` `{ pageId }` unless it is a `persona` page, `active`, whose frontmatter parses with `personaFrontmatterSchema`, whose `identity` equals the caller's identity and the delegation's persona, and whose `harness` is the item's harness.
3. `runShapes` and descriptors: `run_shape` must be `workflow-run` (`not_permitted` `{ why: 'run_shape' }`); `hostable(engine, 'workflow-run')` else `engine_not_available` `{ engine }`; `needsHostedBuilder && !harness.hostedBuilderEnabled` → `hosted_builder_off` `{ harnessId }`; pinned provider `frontmatter.provider ?? descriptor.defaultProvider`, null → `malformed_command` `{ why: 'provider_required' }`.
4. The breaker: `currentLevel(tx)` from `tx.harnessEvents.read.latestNamed(['breaker_open','breaker_holding','breaker_pausing'], null)`; `holding` or `pausing` → `spend_held` `{ level }`. Nothing is recorded for any refusal so far.
5. The beat principal: the seed caller (bare persona identity, the delegation's person, no grants) passes `beatIn`'s logic (the delegation is the caller's, bound to its persona, live — a lapse records `delegation_lapsed` once and answers `delegation_lapsed` — then `beatPrincipal`); export that logic from `packages/harness/delegations/commands.ts` as `beatWithin(ports, tx, caller, delegationId, at)` so `kernel.delegations.beat` and the run module share it. Then `claimWithin(ports, tx, { ...caller, actor: <beat principal> }, { itemId, delegationId }, at)`: every claim rule holds (`can(write)` on the beat principal's grants, `actingPrincipal` again, pickup, WIP, lease, pause, owner binding); its refusals answer as claim's do.
6. A run id from `ports.ids`; `tx.harnessRuns.write.insert(newHostedRun(...))` with `outcome: 'running'`, `costBasis: 'metered'`, `costMinor: 0`, `computeMinor: 0`, `traceId: caller.traceId`; then `recordItemEvents(..., [draft('run_started', { runId, persona, runShape: 'workflow-run', engine, model, delegationId })])`.
7. After commit: `ports.runs.start({ runId, harnessId, itemId, persona, runShape: 'workflow-run', engine, traceId })`. On a throw: a second transaction locks the item and the run, sets the run `failed` (`failure: 'start_failed'`, `endedAt`), and records `run_failed` `{ runId, step: null, why: 'start_failed', detail: <error name> }` and `item_released` `{ holder }` on the item; then answer `not_wired` for a `PortNotWiredError` and rethrow anything else.

**Scene** (`runs/scene.ts`), at `ports.clock.now()`: lock the item then the run (lock order); `run_not_found` `{ runId }` when absent; `not_permitted` `{ why: 'run_<outcome>' }` unless `running` (so `run_hibernated` for a hibernated run); the delegation's liveness through `assertDelegationLive` — a lapse records `delegation_lapsed` once (`recordLapse`), sets the run `stopped` and records `run_stopped` `{ why: 'delegation_lapsed' }` and `item_released`, then answers `delegation_lapsed`; the principal is `beatPrincipal(...)`; `allowed(principal, 'write', harness, at)` else `not_permitted` `{ harnessId }`; the item must be held by `principal.identity` under `run.delegationId` with a live lease, else `not_permitted` `{ why: 'lease_lost' }` (the host fails the run `lease_lost`, Task 18). The persona comes from the run's persona page facts (`personaOfPage`), the capability from the delegation.

**Steps** (`runs/steps.ts`, `recordStepIn(tx, context, scene)`; `renewIn` calls it after the holder, pause and standing checks and before its own append, with the item already locked):
- `tx.harnessRuns.read.lock(runId)`. Absent: metered → `run_not_found`; subscription → create the external run (S7-D8) and add `run_started` to the drafts returned.
- Present: `run.itemId !== item.itemId`, or `run.costBasis !== input.costBasis`, or an external run whose `persona !== caller identity` → `not_permitted` `{ why: 'run_elsewhere' }`; not `running` → `not_permitted` `{ why: 'run_<outcome>' }`; 200 steps → `not_permitted` `{ why: 'run_step_limit' }`.
- Subscription with `costMinor` or `computeMinor` non-null → `malformed_command` `{ why: 'subscription_has_no_cost' }`.
- Append the `RunStepRecord`; add `costMinor` and `computeMinor` to the run's sums (metered only); set `resolvedProvider` when null; take `prompts` and clear them; `write.update`.
- Returns `{ drafts, prompts }`; `renewIn` appends `run_started` (if any) and `run_step_recorded` (with the new fields) together and answers `{ leaseExpiresAt, leaseWarning, prompts }`.

The MCP `record_run_step` handler passes the new fields through and answers `prompts`; the host's cost-basis rule is unchanged.

- [ ] **Step 1: Write the failing tests** (titles exactly as given; each asserts outcome, events and the run row)

`sim/kernel/run-start.test.ts`:
- `HE-1 a start claims the item under the delegation, writes one running run and records run_started`
- `HE-1 a start the Runs port refuses fails the run start_failed and releases the item` (a sim Runs adapter whose `start` throws `PortNotWiredError`: answer `not_wired`, run `failed`, events `run_started`, `run_failed`, `item_released`)
- `HE-8 a start on a sandbox engine where hosted Builder is off is refused hosted_builder_off and records nothing`
- `HE-10 a start on claude-managed-agent is refused engine_not_available`
- `HE-4 a start on openrouter-messages without a provider is refused provider_required`
- `HE-1 a start with a suggested persona page, another persona's page or another harness's page is page_not_found`
- `HE-1 a second start on an item with a live run is refused lease_held and writes no second run`

`sim/kernel/run-scene.test.ts`:
- `HE-1 a step's principal is the delegation's beat principal at the step's instant`
- `HE-1 a scene for a hibernated run is refused run_hibernated`
- `HE-1 a revoked delegation stops the run at the next step, records delegation_lapsed once and releases the item`
- `HE-1 a scene whose lease lapsed is refused lease_lost`

`sim/kernel/run-steps.test.ts`:
- `HE-1 a metered step appends to the run, sums cost and compute, and records run_step_recorded with them`
- `HE-1 a metered step for an unknown run id is run_not_found`
- `HE-6 the first subscription step for an unknown run id creates an external run with no cost`
- `HE-6 a subscription step carrying a cost is malformed_command and records nothing`
- `HE-6 a run id of another item or another runner is not_permitted run_elsewhere`
- `HE-1 the 201st step is refused run_step_limit`

- [ ] **Step 2:** Run `pnpm vitest run sim/kernel/run-start.test.ts sim/kernel/run-scene.test.ts sim/kernel/run-steps.test.ts`; expected FAIL.
- [ ] **Step 3:** Implement as specified; extend `apps/uw-app/mcp/harness-verbs.pg.test.ts` with `HE-6 record_run_step over HTTP answers prompts and creates the external run` (the existing external-host fixtures).
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add packages/harness sim apps/uw-app/mcp
git commit -m "feat(harness): start a hosted run under its delegation, derive each step's principal, record steps on both hosts

HE-1 HE-6 HE-8 HE-10"
```

---

### Task 6: Kernel runs: the gate hibernation, completion, failure, a held premise, and stop and prompt

**Requirements:** HE-1, the step-6 SECURITY carry (stop and prompt on another's run need `admin`).

**Files:**
- Create: `packages/harness/runs/lifecycle.ts` (`hibernateAtGate`, `complete`, `fail`, `holdPremise`, `halt`), `packages/harness/runs/resume.ts` (`resumeRunsWhere(ports, select, why)`: one transaction per run, then `ports.runs.resume`, swallowing a port error), `packages/harness/runs/control.ts` (`stop`, `prompt`)
- Modify: `packages/harness/runs/commands.ts`, `packages/harness/gates/commands.ts` (after an accepted decision of any kind, `resumeRunsWhere` for runs on that item hibernated for `gate`), `packages/harness/gates/decide.ts` port type (`GatePorts` gains `runs`), `packages/harness/items/submit.ts` (note the stage on the item's live run's `gates` before the append)
- Create: `sim/kernel/run-lifecycle.test.ts`, `sim/kernel/run-control.test.ts`, `sim/scenarios/HE-1.a-hosted-run-hibernates-at-the-gate-and-resumes-on-the-decision.ts`

**Members added to `RunCommands`:**

```ts
hibernateAtGate(runId: string): Promise<KernelOutcome<RunRow>>;
complete(runId: string, input: { readonly result: RunResult; readonly review: ReviewRecord | null }): Promise<KernelOutcome<RunRow>>;
fail(runId: string, input: { readonly step: RunStep | null; readonly why: RunFailure; readonly detail: string | null }): Promise<KernelOutcome<RunRow>>;
holdPremise(runId: string, input: { readonly reason: string }): Promise<KernelOutcome<RunRow>>;
halt(runId: string, why: Extract<RunStop, 'gate_wait_expired' | 'lease_expired'>): Promise<KernelOutcome<RunRow>>;
stop(caller: Caller, input: { readonly itemId: string }): Promise<KernelOutcome<RunRow>>;
prompt(caller: Caller, input: { readonly itemId: string; readonly message: string }): Promise<KernelOutcome<RunRow>>;
```

The run-id members are the host's: their events carry the run's persona as actor and the run's trace id (a `RecordContext` built from the run row). Each locks the item, then the run. `hibernateAtGate` and `holdPremise` run the scene check first (S7-D25); `complete`, `fail` and `halt` do not.
- `hibernateAtGate`: the run `running` and its item `parked` (else `not_permitted` `{ why: 'not_parked' }`); run `hibernated`, `hibernatedFor: 'gate'`; `run_hibernated` `{ why: 'gate' }`.
- `complete`: from `running` only; `completed`, `endedAt`; `run_completed` `{ result, gates: run.gates, review }`.
- `fail`: from `running` or `hibernated`; `failed`, `failure`, `endedAt`; `run_failed`; and `item_released` when the item's holder is the run's persona (S7-D23).
- `holdPremise`: from `running`, the item held by the run; `premise_held` `{ runId, reason }`, `item_released`, then the run `completed` with `run_completed` `{ result: 'premise_held' }` — all one transaction. The item does not move.
- `halt`: from `running` or `hibernated`; `stopped`; `run_stopped` `{ why }`.
- Gate resume: after `kernel.gates.decide` answers `accepted` (approve, reject, take over or override), for the item's live run hibernated for `gate`: `running`, `hibernatedFor: null`, `run_resumed` `{ why: 'gate' }`, commit, then `ports.runs.resume(runId)` with any error swallowed (Review Focus 3). A decision that is refused resumes nothing.
- `stop` and `prompt` (person commands): `isAgent` → `not_permitted` `{ actor }`; the item and its live run (`run_not_found` `{ itemId }` when none); grants re-read with `resolveIn`; `write` on the area required; the owner is `run.delegationId`'s person for a hosted run, or the person id in the holder's device identity for an external run; a non-owner needs `admin`. Stop: `stopped`, `run_stopped` `{ why: 'stopped_by_person' }`, `item_released` when the run's persona holds the item, commit, then `ports.runs.stop(runId)` for a `workflow-run` (errors swallowed). Prompt: from `running` or `hibernated`; at 20 pending prompts `not_permitted` `{ why: 'prompts_full' }`; append, `run_prompted` `{ runId, message }`.

- [ ] **Step 1: Write the failing tests**

`sim/kernel/run-lifecycle.test.ts`:
- `HE-1 a run parked at a human gate hibernates and a person's approve resumes it`
- `HE-1 a refused decision resumes nothing`
- `HE-1 a reject and a take over resume the run too, and its close completes it decided`
- `HE-1 a run that fails releases its item`
- `HE-1 a held premise records premise_held, releases the item and leaves it in its stage`
- `HE-1 a completed run accepts no other transition` (complete, fail, hibernate, halt each `not_permitted` `run_completed`)
- `HE-1 the run records each gate it met`

`sim/kernel/run-control.test.ts`:
- `HE-1 stop aborts the run, releases the item and asks the Runs port to stop it`
- `HE-1 an editor who does not own the run is refused stop and prompt; an admin is not` (the step-6 carry)
- `HE-1 the delegating person stops their own run with write alone`
- `HE-1 an agent is refused stop and prompt`
- `HE-1 a prompt reaches the run's next step and is delivered once` (prompt, then a `recordRunStep` answers `prompts: [message]`, the next answers `[]`)
- `HE-1 a twenty-first pending prompt is refused prompts_full`

Scenario `sim/scenarios/HE-1.a-hosted-run-hibernates-at-the-gate-and-resumes-on-the-decision.ts`: neither template lets an agent pick up work at a `human_approval` stage (Ship's pickup is `none`, P17), so `sim/runs.ts` gains a fixture harness whose one stage is `sign-off` (`exitGate: 'human_approval'`, `connector: 'none'`, `agentPickup: 'allowed'`, WIP 3, no validators, no feeds) — build it with the helper `createSimHarness` uses; if that helper takes only the two templates, give it a `stages` option. Enqueue an item, grant a delegation, seed an active persona page; start the run; record `read` and `submit` steps as its beat principal; submit (`parked`); hibernate for `gate`; a person rejects with findings; the run resumes and completes `decided`. It returns the folded run and item state; `pnpm sim -- HE-1.a-hosted-run-hibernates-at-the-gate-and-resumes-on-the-decision` prints the log. The same fixture serves Task 18's gate test.

- [ ] **Step 2:** Run `pnpm vitest run sim/kernel/run-lifecycle.test.ts sim/kernel/run-control.test.ts && pnpm sim -- HE-1.a-hosted-run-hibernates-at-the-gate-and-resumes-on-the-decision`; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add packages/harness sim
git commit -m "feat(harness): a hosted run hibernates at a human gate and resumes on a person's decision; stop and prompt with admin on another's run

HE-1"
```

---

### Task 7: Pause hibernates runs; an external run ends with its submit, release or lease expiry

**Requirements:** HE-1 (pause and resume), HE-6, the step-3 carry (pause and runs; lease renewal while paused).

**Files:**
- Create: `packages/harness/runs/suspend.ts` (`hibernateRunsWhere(ports, select, why)`, the counterpart of `resumeRunsWhere`), `packages/harness/runs/ends.ts` (`endRunDrafts(tx, item, holder, end)`: locks the item's live external run held by `holder`, updates it and returns the drafts)
- Modify: `packages/harness/stages/pause.ts` (after an accepted pause, `hibernateRunsWhere` for live `workflow-run` runs whose items are in the paused lane or harness; after an accepted resume, `resumeRunsWhere` for runs hibernated for `paused` whose item's lane and harness are both unpaused), `packages/harness/items/submit.ts` (the holder's submit → `endRunDrafts(..., { outcome: 'completed', result: 'submitted' })`), `packages/harness/items/release.ts` (→ `stopped` `released`), `packages/harness/items/leases.ts` (`expireLapsedLease` → `stopped` `lease_expired`); the drafts join the command's own `recordItemEvents` call so the run row lock precedes the first append
- Create: `sim/kernel/run-pause.test.ts`, `sim/kernel/external-runs.test.ts`, `sim/scenarios/HE-6.an-external-run-reports-subscription-tokens-and-ends-on-expiry.ts`
- Modify: `apps/uw-app/mcp/conformance.pg.test.ts` only if a pinned outcome changes (it should not)

- [ ] **Step 1: Write the failing tests**

`sim/kernel/run-pause.test.ts`:
- `HE-1 pausing a lane hibernates the hosted runs on its items and asks the Runs port to hibernate each`
- `HE-1 resuming the lane resumes them, but not while the harness is still paused`
- `HE-1 a run hibernated for its gate is not resumed by a lane resume`
- `HE-1 lease renewal is accepted while paused and a run step is refused` (closes the step-3 carry)
- `HE-1 a Runs port that throws on hibernate leaves the run hibernated in the log`

`sim/kernel/external-runs.test.ts`:
- `HE-6 the holder's submit completes the external run submitted`
- `HE-6 release stops the external run released`
- `HE-6 a lapsed lease, expired by the sweep or by the next claim, stops the external run lease_expired once`
- `HE-6 the platform keeps no checkpoint: an expired external run's next step is not_holder`

Scenario `sim/scenarios/HE-6.an-external-run-reports-subscription-tokens-and-ends-on-expiry.ts`: an `editor`'s interactive device identity claims an item, records two `work` steps with `subscription` tokens and no cost, the clock passes the lease, the sweep (`systemPrincipal`) expires it, the run is `stopped` `lease_expired`, the item is free; a second claimant starts from the expected head; and a non-interactive device identity without a delegation is refused `delegation_required` (AB-6).

- [ ] **Step 2:** Run the two test files and `pnpm sim -- HE-6.an-external-run-reports-subscription-tokens-and-ends-on-expiry`; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add packages/harness sim
git commit -m "feat(harness): pause and resume hibernate hosted runs; an external run ends with its submit, release or lapsed lease

HE-1 HE-6"
```

---

### Task 8: The spend breaker

**Requirements:** HE-5.

**Files:**
- Create: `packages/harness/runs/breaker.ts`, `packages/harness/runs/breaker.test.ts`, `sim/kernel/breaker.test.ts`, `sim/scenarios/HE-5.a-cost-spike-trips-both-thresholds.ts`
- Modify: `packages/harness/runs/breaker-level.ts`, `packages/harness/kernel.ts` (`breaker: BreakerCommands`), `packages/harness/items/claim.ts` (a bare persona's claim reads the level after the stage lock: `holding` or `pausing` → `spend_held` `{ level }`, nothing recorded), `packages/harness/index.ts`, `apps/uw-app/mcp/verbs/get-health.ts` (the `breaker` indicator), `apps/uw-app/mcp/harness-verbs.pg.test.ts`

**Interface** (`packages/harness/runs/breaker.ts`):

```ts
export const BREAKER_HOLD_PERCENT = 75;
export const BREAKER_PAUSE_PERCENT = 90;
export const DEFAULT_SPEND_CAP = { capMinor: 125_000, currency: 'USD' } as const;

export type BreakerReading = {
  readonly level: BreakerLevel;
  readonly spentMinor: number;
  readonly capMinor: number;
  readonly currency: string;
  readonly percent: number;
};
export type BreakerState = { readonly level: BreakerLevel; readonly reading: BreakerReading | null; readonly at: string | null };
export type BreakerCheck = BreakerReading & {
  readonly previous: BreakerLevel;
  readonly changed: boolean;
  readonly hibernated: readonly string[];
  readonly resumed: readonly string[];
};
export type BreakerCommands = {
  check(caller: Caller, input: { readonly capMinor: number; readonly currency: string; readonly since: Date }): Promise<KernelOutcome<BreakerCheck>>;
  state(): Promise<BreakerState>;
};

export function levelOf(spentMinor: number, capMinor: number): { readonly level: BreakerLevel; readonly percent: number } {
  const percent = Math.floor((spentMinor * 100) / capMinor);
  if (percent >= BREAKER_PAUSE_PERCENT) return { level: 'pausing', percent };
  if (percent >= BREAKER_HOLD_PERCENT) return { level: 'holding', percent };
  return { level: 'open', percent };
}
```

`check`: only `isSystemPrincipal` (`not_permitted` otherwise); `capMinor` must be a positive integer and the currency three capitals (`malformed_command`); read `ports.modelEngine.spend(since)` outside any transaction (a throw propagates to the cron, which logs `breaker_unreadable`); a currency other than the cap's is `malformed_command` `{ why: 'currency' }`; compare with `currentLevel` (a missing event is `open`). Unchanged: answer `changed: false` and touch nothing. Changed: one transaction appends `breaker_<level>` with the reading to every harness (`tx.harnesses.read.list()`); to `pausing`, every live `workflow-run` run that is `running` is hibernated for `breaker` (run events on its item, in the same transaction, runs in ascending id after their items); to `open`, every run hibernated for `breaker` whose item is not under a pause is resumed. After commit: `ports.runs.hibernate` or `ports.runs.resume` for each, errors swallowed. Subscription tokens never enter: the reading is the port's spend only.

`state()`: the latest breaker event on any harness, its evidence as the reading, or `{ level: 'open', reading: null, at: null }`.

`get_health`'s `breaker` indicator: `ok` for `open`, `amber` for `holding`, `red` for `pausing`; detail "<percent> percent of the cap spent" (or "no reading yet"); the other six WB-10 indicators stay `not_wired`.

- [ ] **Step 1: Write the failing tests**

`packages/harness/runs/breaker.test.ts`: `HE-5 the levels trip at 75 and 90 percent of the cap` (`levelOf` at 74, 75, 89, 90, 120 percent of 125,000).

`sim/kernel/breaker.test.ts`:
- `HE-5 a reading at the same level records nothing`
- `HE-5 crossing 75 percent records breaker_holding on every harness and refuses a new hosted start spend_held`
- `HE-5 crossing 90 percent records breaker_pausing and hibernates every running hosted run`
- `HE-5 falling below 75 percent records breaker_open, resumes the breaker's runs and lets starts through again`
- `HE-5 a bare persona's claim_item is refused spend_held while holding; a device identity's claim is not`
- `HE-5 subscription tokens recorded by an external run never move the level`
- `HE-5 only the system principal may check the breaker`

`apps/uw-app/mcp/harness-verbs.pg.test.ts`: `HE-5 get_health shows the breaker as an indicator`.

Scenario `sim/scenarios/HE-5.a-cost-spike-trips-both-thresholds.ts`: two harnesses, one running hosted run; spend 10 percent (no event), 80 percent (`breaker_holding` on both, a start refused `spend_held`), 95 percent (`breaker_pausing`, the run hibernated), 50 percent (`breaker_open`, the run resumed); the state is the event names in order and the run's outcome.

- [ ] **Step 2:** Run the tests and the scenario; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add packages/harness sim apps/uw-app/mcp
git commit -m "feat(harness): the spend breaker holds hosted claims at 75 percent and hibernates hosted runs at 90

HE-5"
```

---

### Task 9: Hosted Builder's switch and the hosted beat that starts runs

**Requirements:** HE-8 (the switch), HE-1 (one Workflow per claim, started by the beat).

**Files:**
- Create: `packages/harness/stages/hosted-builder.ts`, `packages/harness/runs/beat.ts`, `sim/kernel/hosted-builder.test.ts`, `sim/kernel/run-beat.test.ts`, `sim/scenarios/HE-8.a-sandbox-run-needs-hosted-builder-on.ts`
- Modify: `packages/harness/ports.ts` (`HarnessesGateway.write` gains `setHostedBuilder(harnessId: string, enabled: boolean): Promise<boolean>`, in its own shared-root commit), then `packages/db/store/harnesses.ts` and a case in `packages/harness/port-contracts/store-harnesses.ts` in the next commit
- Modify: `packages/harness/stages/commands.ts` (`setHostedBuilder(caller, { harnessId, enabled })`), `packages/harness/runs/commands.ts` (`beat(caller, { limit })`)

**`setHostedBuilder`:** agents refused (`agentRefusal`); takes `harness-stages:<harnessId>`; the harness; `adminRefusal` (grants re-read `FOR SHARE`); unchanged value records nothing and answers the scene; else `setHostedBuilder`, then `hosted_builder_set` `{ enabled }` as a harness event.

**`beat` (system principal only):** `limit` 1 to 50. `tx.delegations.read.live({ personId: null, persona: null, harnessId: null }, at)` with capability other than `none`; for each, `tx.pages.read.activePersona(delegation.persona, delegation.harnessId)` whose frontmatter `run_shape` is `workflow-run`; skip one with a live run for that persona on that harness (`tx.harnessRuns.read.live(harnessId)`); the seed caller is `{ identity: delegation.persona, kind: 'agent', personId: delegation.personId, email: null, grants: [], interactive: false }` with the beat's trace id; the first item `kernel.reads.poll` would give that seed (reuse the poll function, not the public command); then `start(seed, { itemId, delegationId, personaPageId })`. One start per delegation per beat, at most `limit` starts; a refused start is skipped and returned in `skipped` with its reason. Answers `{ started: StartedRun[], skipped: { delegationId, reason }[] }`.

- [ ] **Step 1: Write the failing tests**

`sim/kernel/hosted-builder.test.ts`:
- `HE-8 hosted Builder is off by default and only an admin turns it on, recorded as hosted_builder_set`
- `HE-8 an editor and an agent are refused`
- `HE-8 turning it off does not stop a run already started`

`sim/kernel/run-beat.test.ts`:
- `HE-1 the beat starts one run per live delegation whose active persona is a workflow-run`
- `HE-1 the beat starts nothing for a suggested persona, a capability none delegation or an external-run persona`
- `HE-1 the beat does not start a second run for a persona that has a live one`
- `HE-1 only the system principal may beat`

Scenario `sim/scenarios/HE-8.a-sandbox-run-needs-hosted-builder-on.ts`: a `claude-code-sandbox` persona under a delegation; the beat skips it with `hosted_builder_off`; an admin turns hosted Builder on; the next beat starts the run.

- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement (ports commit, store commit, then the kernel).
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add packages/harness/ports.ts
git commit -m "feat(harness): the harnesses gateway writes the hosted Builder switch

Shared root packages/harness/ports.ts.

HE-8"
git add packages/db packages/harness/port-contracts
git commit -m "feat(db): write hosted_builder_enabled through the harnesses gateway

HE-8 DX-3"
git add packages/harness sim
git commit -m "feat(harness): an admin turns hosted Builder on; the hosted beat starts one run per delegated persona

HE-1 HE-8"
```

---

### Task 10: The command routes for `set_hosted_builder`, `stop_run` and `prompt_run`

**Requirements:** HE-8 ("through a command"), HE-1 (stop and prompt), the step-6 carry.

**Files:**
- Create: `apps/uw-app/commands/handlers/runs.ts` (`stopRunCommand`, `promptRunCommand`, action `write`; the kernel adds the ownership-or-admin rule), `apps/uw-app/commands/runs.pg.test.ts`
- Modify: `apps/uw-app/commands/person/stages.ts` (`setHostedBuilderCommand`, action `admin`, through `kernel.stages.setHostedBuilder`), `apps/uw-app/commands/registry.ts` (replace the two `notWiredCommand` rows; add `setHostedBuilderCommand`), `apps/uw-app/commands/registry.test.ts` (`set_hosted_builder: 'admin'`), `apps/uw-app/commands/items.pg.test.ts` and `apps/uw-app/commands/commands.pg.test.ts` (the two `not_wired` cases become real outcomes; retitle so no test claims WB-1 for what is now HE-1, R36)

Each handler follows the step-6 builder pattern (`commandHandler`, a contract body, the dispatcher's `can()` before the kernel); `stop_run` and `prompt_run` map `run_not_found`, `not_permitted` and `item_not_found` through the outcome envelope unchanged.

- [ ] **Step 1: Write the failing tests** (`apps/uw-app/commands/runs.pg.test.ts`, on the Postgres server with the step-6 command helpers):
  - `HE-8 an admin turns hosted Builder on through set_hosted_builder; an editor is refused not_permitted`
  - `HE-1 stop_run by the delegating person stops the run and releases the item`
  - `HE-1 stop_run and prompt_run by an editor who does not own the run are not_permitted`
  - `HE-1 prompt_run queues a message the run's next record_run_step answers`
  - `HE-1 stop_run on an item with no live run is run_not_found`
  - `HE-1 a repeated requestId replays the first stop outcome` (the ledger)
- [ ] **Step 2:** Run `pnpm vitest run apps/uw-app/commands`; expected FAIL.
- [ ] **Step 3:** Implement; `pnpm vitest run tools/architecture` stays green (the person surface holds the `kernel.stages` call; `kernel.runs.stop`/`prompt` are not gate touches).
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add apps/uw-app/commands
git commit -m "feat(commands): set_hosted_builder, stop_run and prompt_run are wired

HE-1 HE-8"
```

---

### Task 11: The tool loop, the scout and review verdicts, and the review body

**Requirements:** HE-3 (the loop), HE-4 (the loop, the review body), HE-1 (the scout verdict).

**Files:**
- Create: `packages/harness/runs/tool-loop.ts`, `packages/harness/runs/tool-loop.test.ts`, `packages/harness/github/verdicts.ts`, `packages/harness/github/verdicts.test.ts`, `packages/harness/github/review-body.ts`, `packages/harness/github/review-body.test.ts`
- Modify: `packages/harness/github/fenced-block.ts` only if a shared helper must be exported for a second block label (reuse it; do not copy the allowlist rules), `packages/harness/index.ts`, `packages/harness/risk/` protected-directory map is unchanged (`packages/harness/github/` is already `acl`)

**Tool loop** (`packages/harness/runs/tool-loop.ts`, complete shape; bodies split to stay under 50 lines):

```ts
export const TURN_LIMIT = 40;

export type ToolReply = { readonly output: unknown; readonly isError: boolean };
export type ToolCaller = { call(verb: VerbName, input: unknown): Promise<ToolReply> };

export type LoopRequest = Omit<TurnRequest, 'messages'> & { readonly prompt: string };
export type LoopUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number | null;
};
export type LoopResult = {
  readonly outcome: 'ended' | 'turn_limit';
  readonly text: string | null;
  readonly usage: LoopUsage;
  readonly resolvedProvider: string | null;
  readonly resolvedModel: string;
  readonly toolsCalled: readonly VerbName[];
  readonly turns: number;
};

export async function runToolLoop(
  turn: ModelEngine['turn'],
  tools: ToolCaller,
  request: LoopRequest,
  onTurn: () => Promise<void>,
): Promise<LoopResult>;
```

Rules: the first message is `{ role: 'user', text: request.prompt }`; each turn passes the whole history; a turn's tool calls are answered in order by `tools.call`, each appended as a `tool` message (`isError` from the reply; a thrown error is caught and answered `{ output: { error: <error name> }, isError: true }`), after the assistant message that made them; the loop ends when a turn makes no tool call (`ended`, its `text` the result) or after the 40th turn (`turn_limit`, `text: null`); `onTurn` runs after every turn; `ProviderMismatchError` and `ToolOutsideToolsetError` from `turn` propagate (they fail the run); `costMicros` sums every turn's, and is `null` if any turn's is `null`; `resolvedProvider` is the first turn's, and a later turn naming another provider throws `ProviderMismatchError(first, later)`.

**Verdicts** (`packages/harness/github/verdicts.ts`): `parseScoutVerdict(text)` answers `{ premise: 'holds' | 'held'; reason: string }` or a problem (`missing`, `ambiguous_block`, `unknown_key`, `missing_key`, `invalid_value`); `parseReviewVerdict(text)` answers `{ verdict: ReviewVerdict; findings: readonly string[] }` or a problem. Both use the same allowlist as the PR declaration and `parseReviewProvider` (S5-R39, S5-R40): the text's first line is exactly the fence (```` ```harness-scout ```` or ```` ```harness-verdict ````), the block holds only its keys, a second fence of the label or any `harness*` fence after it, HTML comments, `<pre`/`<code`, character references, NUL, lone CR and the other separators are `ambiguous_block`. Scout keys: `premise` (`holds` or `held`), `reason` (one line, 1 to 200 characters). Verdict keys: `verdict` (`approve` or `request_changes`); findings are the `- ` lines after the block's closing fence, each 1 to 500 characters, at most 50. A scout problem is a held premise with reason `no scout verdict` at the caller (S7-D16); a verdict problem posts no review.

**Review body** (`packages/harness/github/review-body.ts`): `reviewBody({ provider, model, verdict, findings }): string` is

````
```harness-review
provider: <provider>
model: <model>
```

<"Approved." or "Changes requested.">

- <finding>
````

with `provider` validated as a `providerIdSchema` slug, `model` stripped of every character outside `[A-Za-z0-9._/:-]` and cut to 200, and each finding folded to one line by the same rule the merge commit uses (control, format and separator characters to a space, runs collapsed, cut to 500; written in `packages/harness/github/review-body.ts`, since the harness cannot import `apps/uw-app/github/merge-commit.ts`) with any leading fence characters removed.

- [ ] **Step 1: Write the failing tests**

`packages/harness/runs/tool-loop.test.ts` (a scripted `turn` and a recording `ToolCaller`):
- `HE-3 the loop answers each tool call with its result and ends on a turn without one`
- `HE-3 a tool error is returned to the model as the tool result`
- `HE-3 a tool that throws is answered as an error, not thrown`
- `HE-3 the loop stops at 40 turns with turn_limit`
- `HE-4 a provider that changes between turns fails the loop with ProviderMismatchError`
- `HE-3 usage and the tools called are summed across turns`

`packages/harness/github/verdicts.test.ts`: `HE-1 a scout verdict holds or holds the premise only from the opening block`; the forgery cases (a second block, a block not first, `<!--`, a CR-only line, `harness-scout` after the block, an unknown key) are each a problem. `HE-4 a review verdict is approve or request_changes with its findings`, with the same forgery cases.

`packages/harness/github/review-body.test.ts`: `HE-4 a review body opens with the harness-review block that parseReviewProvider reads back` (a fast-check property in `tools/properties/review-body.test.ts` too: for any provider slug, model and findings, `parseReviewProvider(reviewBody(x))` equals the provider; the property file's titles lead with `HE-4`).

- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; export `runToolLoop`, `TURN_LIMIT`, `ToolCaller`, `parseScoutVerdict`, `parseReviewVerdict`, `reviewBody`.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add packages/harness tools/properties
git commit -m "feat(harness): one tool loop for the message engines, the scout and review verdicts, and the harness-review body

HE-1 HE-3 HE-4"
```

---

### Task 12: The engine seam on the platform

**Requirements:** HE-2, HE-10.

**Files:**
- Create: `apps/uw-app/engines/seam.ts`, `apps/uw-app/engines/registry.ts`, `apps/uw-app/engines/config.ts`, `apps/uw-app/engines/registry.test.ts`, and one directory per engine with an `index.ts` exporting its adapter: `apps/uw-app/engines/claude-messages/index.ts`, `apps/uw-app/engines/openrouter-messages/index.ts`, `apps/uw-app/engines/claude-code-sandbox/index.ts`, `apps/uw-app/engines/codex-sandbox/index.ts` (these four answer `not_wired` until Tasks 13, 14, 19 and 20), `apps/uw-app/engines/claude-managed-agent/index.ts`, `apps/uw-app/engines/external/index.ts` (both answer `EngineNotAvailableError` for good)
- Create: `apps/uw-app/ports/model-engine.ts` (the platform ModelEngine adapter), `apps/uw-app/ports/model-engine.contract.test.ts`
- Modify: `apps/uw-app/kernel.ts` (`modelEngine` from `platformModelEngine(engineRegistryOf(env), spendReaderOf(env))` where a factory needs the environment; until Task 13 the spend reader is not wired), `apps/uw-app/env.ts` (the configuration names below, all optional strings), `tools/architecture/port-contracts.ts` (`modelEngine` also accepts contract tests under `apps/uw-app/engines/<key>/`), `.dependency-cruiser.mjs` (rule `engines-only-from-the-seam`: `apps/uw-app/engines/<key>/` is imported only by `apps/uw-app/engines/registry.ts` and tests; `apps/uw-app/engines/` imports nothing under `apps/uw-app/github/`, `apps/uw-app/commands/` or `apps/uw-app/mcp/` except the type-only `ToolCaller` from `packages/harness`), `packages/harness/port-errors.ts` (`EngineNotAvailableError(engine)`, name `EngineNotAvailableError`)

**Seam** (`apps/uw-app/engines/seam.ts`):

```ts
export type EngineWork = {
  readonly runId: string;
  readonly itemId: string;
  readonly traceId: string;
  readonly model: string;
  readonly pinnedProvider: string;
  readonly instructions: string;
  readonly prompt: string;
  readonly toolset: readonly VerbName[];
  readonly tools: ToolCaller;
  readonly onTurn: () => Promise<void>;
};
export type EngineWorkResult = {
  readonly outcome: 'ended' | 'turn_limit';
  readonly text: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number | null;
  readonly computeMinor: number | null;
  readonly resolvedProvider: string | null;
  readonly resolvedModel: string;
  readonly toolsCalled: readonly VerbName[];
};
export type EngineAdapter = {
  readonly key: Engine;
  readonly turn: ModelEngine['turn'] | null;
  work(input: EngineWork): Promise<EngineWorkResult>;
};
```

`registry.ts`: `engineRegistryOf(config: EngineConfig): ReadonlyMap<Engine, EngineAdapter>` built from the six directories' factories (each `(config) => EngineAdapter`) and refusing at construction a missing key, a duplicate key, or a key whose `adapter.key` differs; `engineAdapter(registry, key)` looks up by key. `messageWork(turn)` (in `seam.ts`) is the shared `work` for message engines: `runToolLoop(turn, tools, { engine, model, pinnedProvider, persona, instructions, tools: toolset, traceId, prompt }, onTurn)` mapped to `EngineWorkResult` with `computeMinor: null`.

`apps/uw-app/ports/model-engine.ts`: `platformModelEngine(registry, spend)`: `turn(request)` is `registry.get(request.engine)?.turn` or `EngineNotAvailableError(request.engine)`; `spend(since)` is the reader's. The adapter imports no vendor SDK.

`config.ts`: `EngineConfig` read from `Bindings`: `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_ID`, `AI_GATEWAY_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `AI_GATEWAY_ANALYTICS_TOKEN`, `AI_SPEND_CAP_MINOR`, `ALWAYS_ON_MODEL`, `ALWAYS_ON_PROVIDER`, `SANDBOX_MINOR_PER_HOUR`, plus the injected `fetch`. No name ends in `_OAUTH_TOKEN`, `_SESSION` or `_SUBSCRIPTION`.

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/engines/registry.test.ts`:
- `HE-2 the registry holds exactly the six engine keys, each from its own directory`
- `HE-2 the registry refuses a missing, duplicated or misnamed engine at construction`
- `HE-2 no file outside apps/uw-app/engines/ names an engine key in a branch` (a scan over `apps/uw-app/**/*.ts` and `packages/harness/**/*.ts`, tests excluded, for `=== '<key>'`, `case '<key>'` and `'<key>' ===` for every engine key, with a planted case)
- `HE-10 claude-managed-agent answers engine_not_available for a turn and for work`
- `HE-2 external never runs on the platform`
- `HE-2 an engine reaches the platform only through the MCP tool caller` (an `expectTypeOf` case: `EngineWork` has no kernel, database, GitHub or environment member; and the dependency rule below with a planted import)

Add to `.dependency-cruiser.mjs` in this task: `engines-reach-only-the-tool-caller`: nothing under `apps/uw-app/engines/` imports `@uw/db`, `apps/uw-app/kernel.ts`, `apps/uw-app/database.ts`, `apps/uw-app/ports/` (except `apps/uw-app/ports/model-engine.ts` importing the registry, which is the other direction) or `apps/uw-app/github/`.

`apps/uw-app/ports/model-engine.contract.test.ts`: `describeModelEngineNotWired`-style cases for keys without a configured turn, and the full `describeModelEngineContract('platform', …)` over a registry whose `openrouter-messages` turn is a scripted fake (the real engine contract runs in Task 14).

- [ ] **Step 2:** Run `pnpm vitest run apps/uw-app/engines apps/uw-app/ports/model-engine.contract.test.ts tools/architecture`; expected FAIL.
- [ ] **Step 3:** Implement. Delete `apps/uw-app/ports/model-engine.not-wired.ts` only if nothing imports it after `kernel.ts` moves (grep first; the DX-3 check requires a not-wired export only where a not-wired adapter exists, so update `apps/uw-app/ports/not-wired.contract.test.ts` with it and say so in the commit body).
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add apps/uw-app packages/harness/port-errors.ts packages/harness/index.ts tools/architecture .dependency-cruiser.mjs
git commit -m "feat(engines): one seam and a registry of six engines, each in its own directory

HE-2 HE-10"
```

---

### Task 13: `claude-messages` through AI Gateway, and the AI Gateway spend reader

**Requirements:** HE-3, HE-5 (the reading).

**Files:**
- Create: `apps/uw-app/engines/claude-messages/turn.ts`, `apps/uw-app/engines/claude-messages/prices.ts`, `apps/uw-app/engines/claude-messages/turn.contract.test.ts`, `apps/uw-app/engines/claude-messages/turn.test.ts`, `apps/uw-app/engines/gateway/spend.ts`, `apps/uw-app/engines/gateway/spend.test.ts`, `apps/uw-app/engines/fixtures/` (recorded-shape responses trimmed from vendor documentation), `apps/uw-app/engines/no-subscription-credential.test.ts`
- Modify: `apps/uw-app/engines/claude-messages/index.ts`, `apps/uw-app/package.json` (`@anthropic-ai/sdk`)

**Dependency:** `pnpm --filter @uw/uw-app add @anthropic-ai/sdk` (MIT, fetch-based, runs on Workers); record the resolved version. The SDK is constructed with `{ apiKey: ANTHROPIC_API_KEY, baseURL: 'https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic', fetch: config.fetch, defaultHeaders: token ? { 'cf-aig-authorization': `Bearer ${token}` } : {} , maxRetries: 0 }` (the Workflow step owns retries).

**Turn mapping:** `TurnRequest` to `messages.create({ model, system: instructions, max_tokens: 4096, tools, messages })`: each verb in `request.tools` becomes a tool whose input schema is `z.toJSONSchema(verbIo[verb].input)` computed in the engine (a few lines in `apps/uw-app/engines/tool-schemas.ts`, shared by both message engines; the engines import nothing under `apps/uw-app/mcp/`); assistant `toolCalls` become `tool_use` blocks, `tool` messages `tool_result` blocks with `is_error`; the reply's `tool_use` blocks become `ToolCall`s whose verb must be in `request.tools` (`ToolOutsideToolsetError` otherwise); `stop_reason` maps `end_turn`→`end_turn`, `tool_use`→`tool_use`, `max_tokens`→`max_tokens`, `refusal`→`refused`; `resolvedProvider` is `'anthropic'` and a pin other than `anthropic` throws `ProviderMismatchError`; usage `costMicros` = tokens × the model's price in `prices.ts` (micro-USD per token for input and output; an unknown model is `null`); `costBasis: 'metered'`.

**Spend** (`apps/uw-app/engines/gateway/spend.ts`): `gatewaySpend(config)` POSTs to `https://api.cloudflare.com/client/v4/graphql` with `Authorization: Bearer <AI_GATEWAY_ANALYTICS_TOKEN>` the query

```graphql
query Spend($account: string!, $gateway: string!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      aiGatewayRequestsAdaptiveGroups(
        limit: 1
        filter: { gateway: $gateway, datetime_geq: $since, datetime_lt: $until }
      ) {
        sum { cost }
      }
    }
  }
}
```

and parses the reply with Zod; `spentMinor` is `Math.round(cost * 100)` (USD), `currency: 'USD'`; any configuration missing is `PortNotWiredError`; a non-200 or a GraphQL `errors` array throws `SpendUnreadableError` with the status (never the body). The dataset and field names are from Cloudflare's documentation and unverified (Not verified row, final task).

- [ ] **Step 1: Write the failing tests**
  - `turn.contract.test.ts`: `describeModelEngineContract('claude-messages', …)` with a fake `fetch` answering fixture Messages API bodies (its `respondNextWith` translates a `TurnResult` into a fixture reply).
  - `turn.test.ts`: `HE-3 calls go to AI Gateway's anthropic path with the organization key`; `HE-3 the tools offered are exactly the request's toolset with each verb's schema`; `HE-3 a reply calling a verb outside the toolset is refused`; `HE-4 a pin other than anthropic fails closed`; `HE-3 an engine with no key answers not_wired`.
  - `spend.test.ts`: `HE-5 the spend is AI Gateway's summed cost for the month in minor units`; `HE-5 an unconfigured reader is not_wired and an error reply is unreadable without its body`.
  - `no-subscription-credential.test.ts`: `HE-3 no hosted engine's configuration names a subscription credential` (scan `apps/uw-app/engines/**`, `apps/uw-app/env.ts` and both wrangler files for `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`, `OAUTH`, `setup-token`, `CODEX_`, `CHATGPT`, `OPENAI_ACCESS_TOKEN`; a planted case fails).
- [ ] **Step 2:** Run `pnpm vitest run apps/uw-app/engines`; expected FAIL.
- [ ] **Step 3:** Implement; `pnpm lint:vendor` passes with the SDK only in `apps/uw-app/engines/claude-messages/`; `pnpm audit:prod` stays clean.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add apps/uw-app pnpm-lock.yaml
git commit -m "feat(engines): claude-messages through AI Gateway on the organization key, and the AI Gateway spend reader

HE-3 HE-5"
```

---

### Task 14: `openrouter-messages`: the always-on tier, pinned and fallback-free

**Requirements:** HE-4, HE-3 (the same loop).

**Files:**
- Create: `apps/uw-app/engines/openrouter-messages/turn.ts`, `apps/uw-app/engines/openrouter-messages/turn.contract.test.ts`, `apps/uw-app/engines/openrouter-messages/turn.test.ts`
- Modify: `apps/uw-app/engines/openrouter-messages/index.ts`, `apps/uw-app/package.json` (`openai`)

**Dependency:** `pnpm --filter @uw/uw-app add openai` (Apache-2.0, fetch-based, runs on Workers); record the resolved version. Client: `{ apiKey: OPENROUTER_API_KEY, baseURL: 'https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openrouter/v1', fetch: config.fetch, defaultHeaders: { 'cf-aig-authorization': … when set }, maxRetries: 0 }`.

**Turn mapping:** `chat.completions.create({ model, messages, tools, tool_choice: 'auto', provider: { order: [pinnedProvider], allow_fallbacks: false }, usage: { include: true } })` (the two OpenRouter fields pass through the SDK's body; type them with a local intersection, never `any`); system message from `instructions`; assistant `tool_calls` and `tool` messages map one to one; the resolved provider is the reply's `provider` field, NFKC-normalised, trimmed, lowercased; a reply without it, or with a provider other than the pin, throws `ProviderMismatchError(pin, resolved)` (S7-D14); `costMicros` is `Math.round(usage.cost * 1_000_000)` when OpenRouter reports `usage.cost`, else `null`; `finish_reason` maps `stop`→`end_turn`, `tool_calls`→`tool_use`, `length`→`max_tokens`, `content_filter`→`refused`.

- [ ] **Step 1: Write the failing tests**
  - `turn.contract.test.ts`: `describeModelEngineContract('openrouter-messages', …)` over fixture Chat Completions replies.
  - `turn.test.ts`: `HE-4 every request pins the persona's provider and refuses fallbacks`; `HE-4 a reply served by another provider fails closed with both names`; `HE-4 a reply that names no provider fails closed`; `HE-4 the model is the persona's model field`; `HE-4 calls go to AI Gateway's openrouter path`; `HE-4 the turn's cost comes from OpenRouter's usage in micro-units`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; `pnpm lint:vendor` passes.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add apps/uw-app pnpm-lock.yaml
git commit -m "feat(engines): openrouter-messages pins its provider, refuses fallbacks and fails closed on a mismatch

HE-3 HE-4"
```

---

### Task 15: The one-minute cron: the lease sweep, the breaker check and the hosted beat

Shared root `infra/` in its own commit.

**Requirements:** HE-5 (the breaker runs), HE-1 (the beat runs), KN-5's P8 sweep (unscheduled until now).

**Files:**
- Create: `apps/uw-app/cron/minute.ts`, `apps/uw-app/cron/minute.pg.test.ts`
- Modify: `apps/uw-app/cron/registry.ts` (`MINUTE_CRON = '* * * * *'` → `minuteJob`), `apps/uw-app/cron/registry.test.ts`, `apps/uw-app/cron/job.ts` (`CronDeps` gains `engines: EngineConfig` read from `env`), `infra/uw-app/wrangler.go-live.toml` (`crons = ["17 3 * * *", "* * * * *"]` under staging and production), `tools/infra/crons.test.ts` (the minute cron is in the go-live file only; a planted case in `wrangler.toml` fails), `.dependency-cruiser.mjs` if the cron imports `apps/uw-app/engines/gateway/spend.ts` (allow `apps/uw-app/cron/minute.ts` to import it)

**`minuteJob(env, deps)`:** without a database, log `database_not_configured` and return. Otherwise, with the system principal (`systemPrincipal()` from `@uw/core/principal`, allowed under `apps/uw-app/cron/`): (1) `kernel.items.expireLeases(caller, { limit: 200 })`; (2) `kernel.breaker.check(caller, { capMinor, currency: 'USD', since: <first instant of the current UTC month> })`, `capMinor` from `AI_SPEND_CAP_MINOR` (a positive integer) else `DEFAULT_SPEND_CAP.capMinor`; a `PortNotWiredError` logs `breaker_not_configured`, any other throw logs `breaker_unreadable` with `errorFields`, and neither stops the job; (3) `kernel.runs.beat(caller, { limit: 10 })`, logging the started and skipped counts. Each step is caught and logged separately so one failure never skips the others. The kernel is built with `hubWiring(hubOf(env, logger))` and the platform Runs adapter (Task 16; until then `runsNotWired`, so starts answer `not_wired` and the beat logs them as skipped).

- [ ] **Step 1: Write the failing tests** (`apps/uw-app/cron/minute.pg.test.ts`, the Postgres server, a fake spend reader injected through `deps`):
  - `HE-5 the minute cron checks the breaker against the configured cap`
  - `HE-5 an unreadable spend is logged and the sweep and the beat still run`
  - `HE-1 the minute cron runs the hosted beat as the system principal`
  - a test titled without an ID: the lease sweep expires a lapsed lease once a minute
  - `apps/uw-app/cron/registry.test.ts`: the minute job is registered
- [ ] **Step 2:** Run `pnpm vitest run apps/uw-app/cron tools/infra`; expected FAIL.
- [ ] **Step 3:** Implement; infra commit first.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add infra/uw-app/wrangler.go-live.toml
git commit -m "build(infra): a one-minute cron trigger, for go-live only

Shared root infra/: the lease sweep, the spend breaker and the hosted beat
need a minute's cadence; nothing live runs them before the switch-on.

HE-1 HE-5"
git add apps/uw-app tools/infra .dependency-cruiser.mjs
git commit -m "feat(cron): the minute job sweeps leases, checks the breaker and runs the hosted beat

HE-1 HE-5"
```

---

### Task 16: The platform Runs adapter over Cloudflare Workflows

Shared root `infra/` in its own commit.

**Requirements:** HE-1 (the Workflow per claim), the step-2 carry (`RunsSubject.finish`).

**Files:**
- Create: `apps/uw-app/ports/runs.ts`, `apps/uw-app/ports/runs.contract.test.ts`, `apps/uw-app/runs/testing.ts` (`fakeWorkflowBinding()`: instances in a map with a settable status, recording `create`, `pause`, `resume`, `terminate`, `sendEvent`)
- Modify: `apps/uw-app/env.ts` (`HARNESS_RUN?: WorkflowBinding`, a structural type with `create({ id, params })` and `get(id)` answering `{ id, status(): Promise<{ status: string }>, pause(), resume(), terminate(), sendEvent({ type, payload }) }`), `apps/uw-app/kernel.ts` (`runs: runsOf(env)`: `platformRuns(env.HARNESS_RUN)` when bound, else `runsNotWired`; thread `env` or the binding through `KernelWiring` as `runs`), `apps/uw-app/ports/not-wired.contract.test.ts` (keeps `runsNotWired`), `infra/uw-app/wrangler.go-live.toml`, `tools/infra/go-live.test.ts`

**Adapter:** S7-D18's mapping. `start` refuses (`RunTransitionError(runId, <state>, 'start')`) when `get(runId)` finds an instance, then `create({ id: runId, params: run })`; `hibernate` requires `running`; `resume` requires `hibernated`, then `resume()` if the instance is `paused`, else `sendEvent({ type: 'run-resumed', payload: {} })`; `stop` requires `running` or `hibernated`, then `terminate()`; `status` answers `null` for an id `get` cannot find. The contract's `finish` sets the fake instance's status to `complete` or `errored`.

**go-live** (`infra/uw-app/wrangler.go-live.toml`), per environment, staging and production only:

```toml
[[env.staging.workflows]]
name = "harness-run-staging"
binding = "HARNESS_RUN"
class_name = "HarnessRun"
```

(and `harness-run-production` under `env.production`). `tools/infra/go-live.test.ts` gains a case: `HARNESS_RUN` and `HarnessRun` appear in the go-live file under staging and production only, never in `wrangler.toml` and never under `preview` (a planted case fails).

- [ ] **Step 1: Write the failing tests**: `apps/uw-app/ports/runs.contract.test.ts` runs `describeRunsContract('platform', …)` over `platformRuns(fakeWorkflowBinding())` with `finish` from the fake; plus `HE-1 resume sends run-resumed to a Workflow waiting at a gate and resumes a paused one` (titled HE-1 since it proves the gate resume half).
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; infra commit first. The `HarnessRun` class is exported in Task 18; until then the go-live file names a class the bundle lacks, which is acceptable only because nothing deploys the go-live file (the switch-on PR comes after the build) — say so in the commit body.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add infra/uw-app/wrangler.go-live.toml tools/infra/go-live.test.ts
git commit -m "build(infra): declare the HarnessRun Workflow for go-live only

Shared root infra/: one Workflow binding per environment, none for preview.

HE-1"
git add apps/uw-app
git commit -m "feat(uw-app): the platform Runs adapter over Cloudflare Workflows runs the Runs contract

HE-1"
```

---

### Task 17: The review path: the diff at the head, the Reviewer's review, and the run's review commands

**Requirements:** HE-4 (records provider and model on the review; fails closed; the diff budget), HE-9 (the second identity's review read back), the step-5 carry (the `harness-review` block).

**Files:**
- Create: `apps/uw-app/github/diff.ts` (the read client's `GET /repos/{o}/{r}/compare/{base}...{head}` with `Accept: application/vnd.github.diff`, reading at most `budget + 1` bytes), `apps/uw-app/github/review-writes.ts` (a Reviewer App's session with `pull_requests: write`, `metadata: read`, one repository; `POST /repos/{o}/{r}/pulls/{n}/reviews` with `commit_id: head`, `event: 'APPROVE' | 'REQUEST_CHANGES'`, `body`), `apps/uw-app/github/reviewer-apps.ts` (configuration per reviewer id: `REVIEWER_GITHUB_APP_ID`/`_INSTALLATION_ID`/`_PRIVATE_KEY` for `uw-reviewer`, `REVIEWER_CODEX_GITHUB_APP_ID`/`_INSTALLATION_ID`/`_PRIVATE_KEY` for `uw-reviewer-codex`), tests beside each
- Create: `packages/harness/runs/review.ts` (`reviewDiff`, `postReview`), `sim/kernel/run-review.test.ts`, `sim/scenarios/HE-4.a-provider-mismatch-fails-the-run-and-posts-no-review.ts`, `apps/uw-app/github/review-readback.pg.test.ts`
- Modify: `apps/uw-app/ports/github-facts.ts` (`diff` through `diff.ts` with the read client; `unavailable` `not_wired` without one), `apps/uw-app/ports/connectors.ts` (`review` through `review-writes.ts`; `refused` `not_wired` without the reviewer's App), `apps/uw-app/kernel.ts` (`KernelWiring` gains `reviews: ReviewGitHub | null`; `hubWiring` keeps it null; a new `runWiring(hub, reads, reviews)` used only under `apps/uw-app/runs/`), `.dependency-cruiser.mjs` (`review-writes.ts` imported only by `apps/uw-app/ports/connectors.ts`; `runWiring`'s GitHub openers only from `apps/uw-app/runs/`), `tools/architecture/connector-callers.test.ts` (the MCP, queue, cron and command kernels never pass `reviews`), `infra/github/reviewer-app-manifest.json` and `infra/github/reviewer-codex-app-manifest.json` (permissions `metadata: read`, `pull_requests: write`; no events) in an infra commit, `infra/README.md` (registering the two Reviewer Apps), `packages/harness/runs/commands.ts`

**Kernel members:**

```ts
reviewDiff(runId: string): Promise<KernelOutcome<{ readonly diff: string } | { readonly refused: 'review_refused' }>>;
postReview(runId: string, input: { readonly verdict: ReviewVerdict; readonly findings: readonly string[]; readonly resolvedProvider: string | null; readonly resolvedModel: string }): Promise<KernelOutcome<RunRow>>;
```

`reviewDiff` and `postReview` run the scene check first (S7-D25). `reviewDiff`: the run `running` under a delegation whose capability is `review` (`not_permitted` `{ why: 'not_a_review_run' }`); the item's `pullRequest` and `expectedHead`, and the facts' base (`ports.githubFacts.pullRequest`) — any missing completes the run `review_withheld`; `ports.githubFacts.diff(ref, { base, head }, 80_000)` outside a transaction; `too_large` → one transaction: `checks_failed` `{ stage, failures: ['diff_exceeds_review_budget'] }` and `item_released` on the item, and the run `completed` `review_refused`; `unavailable` → the run fails `retries_exhausted` with the reason as detail (the Workflow already retried); `diff` → answers it.

`postReview`: the run `running`, capability `review`; withheld (run `completed` `review_withheld`, no port call) when the resolved provider is null or is not `run.pinnedProvider`, when the item has no pull request or expected head, or when another Reviewer identity's latest decisive review on the head (from `ports.githubFacts.pullRequest`) carries the same provider; else `ports.connectors.review({ reviewer: engineDescriptor(run.engine).reviewer, repository: harness.repository, pullRequest, head: expectedHead, verdict, body: reviewBody({ provider, model, verdict, findings }), traceId: run.traceId })` outside a transaction; `posted` → the run `completed` `review_posted` with `review: { reviewer, provider, model, verdict, reviewId }`; `refused` → `completed` `review_withheld` with `review: { …, reviewId: null }`. A provider mismatch never reaches here: the engine threw and the run failed (Task 18).

- [ ] **Step 1: Write the failing tests**

`sim/kernel/run-review.test.ts`:
- `HE-4 a review run posts a review on the expected head whose body opens with the harness-review block`
- `HE-4 a review whose resolved provider is not the pinned one is withheld`
- `HE-4 a diff over the budget fails the item's checks with diff_exceeds_review_budget and releases it for a person`
- `HE-9 a second Reviewer identity whose provider equals the first review's withholds its review`
- `HE-4 a run that is not a review run cannot post one`

Scenario `sim/scenarios/HE-4.a-provider-mismatch-fails-the-run-and-posts-no-review.ts`: a review run on `openrouter-messages` pinned to `deepinfra`; the sim model engine serves its work turn from `together`; the run's work fails with `ProviderMismatchError`; `kernel.runs.fail(runId, { step: 'work', why: 'provider_mismatch', detail: 'deepinfra/together' })`; the sim connectors recorded no review; the item is released.

`apps/uw-app/github/diff.test.ts`, `review-writes.test.ts` (fixture transport): `HE-4 the diff is read by base and head SHA and refused over the budget without reading further`; `HE-4 a Reviewer's review is posted on the head commit with its own App's token scoped to one repository`. `apps/uw-app/github/review-readback.pg.test.ts`: `HE-9 a codex review posted on the head is read back from gh_reviews and counts as the second provider` (a `pull_request_review` webhook fixture whose body is `reviewBody({ provider: 'openai', … })` from `uw-reviewer-codex[bot]`, then the assembler counts two reviewers with distinct providers).

- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; infra commit (the two manifests and the README section) first.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add infra/github infra/README.md
git commit -m "build(infra): manifests for the two Reviewer GitHub Apps

Shared root infra/: each Reviewer identity is its own App with pull request
write and nothing else.

HE-4 HE-9"
git add apps/uw-app packages/harness sim tools .dependency-cruiser.mjs
git commit -m "feat(harness): a review run reads the diff at the head and posts its review under its own Reviewer identity, or withholds it

HE-4 HE-9"
```

---

### Task 18: The step connection and the hosted run's Workflow

**Requirements:** HE-1 (named checkpointed steps, retry from the failed step, a deploy mid-run, hibernation, the run record), HE-3 (the loop inside the step, the persona's toolset), HE-4 (fail closed), the step-4 SECURITY carries.

**Files:**
- Modify: `apps/uw-app/mcp/in-process.ts` (complete below), `apps/uw-app/mcp/in-process.test.ts`, `apps/uw-app/mcp/conformance.pg.test.ts` (the Workflow-host principal is now a run scene's), `apps/uw-app/testing/conformance.test.ts` and `apps/uw-app/testing/conformance.ts` (serve an arbitrary principal through the new test helper)
- Create: `apps/uw-app/testing/in-process.ts` (`serveVerbsForTest(context, handlers)`: the server pair with any principal, for tests only), `apps/uw-app/runs/step-runner.ts`, `apps/uw-app/runs/run-core.ts`, `apps/uw-app/runs/steps.ts`, `apps/uw-app/runs/prompts.ts`, `apps/uw-app/runs/workflow.ts`, `apps/uw-app/runs/deps.ts`, `apps/uw-app/runs/run-core.pg.test.ts`, `apps/uw-app/runs/step-connection.pg.test.ts`
- Modify: `apps/uw-app/index.ts` (`export { HarnessRun } from './runs/workflow.ts';`), `.dependency-cruiser.mjs` (rename `in-process-host-only-in-tests` to `in-process-host-only-in-run-steps`: from anything but test files and `^apps/uw-app/runs/steps\.ts$` to `apps/uw-app/mcp/in-process.ts`; new rule `run-host-only-from-the-workflow`: `apps/uw-app/runs/` is imported only by `apps/uw-app/index.ts`, `apps/uw-app/runs/` itself and tests; `apps/uw-app/mcp/` imports nothing under `apps/uw-app/runs/`), `tools/architecture/runs-callers.test.ts` (new: `kernel.runs.scene`, `hibernateAtGate`, `complete`, `fail`, `holdPremise`, `halt`, `reviewDiff`, `postReview` are named only under `apps/uw-app/runs/`, `apps/uw-app/mcp/in-process.ts` (scene), `sim/` and tests; `kernel.runs.beat` only under `apps/uw-app/cron/`; planted cases fail), `docs/architecture.md` ("The agent boundary": the Workflow host paragraph; "Transactions and locks": run rows after item rows)

**`apps/uw-app/mcp/in-process.ts`** (complete):

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { CONTRACT_VERSION } from '@uw/contracts';
import type { Logger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import type { Kernel, KernelOutcome, RunScene } from '@uw/harness';
import { createVerbServer } from './server.ts';

export type RunStepConnection = {
  readonly verbKernel: Kernel;
  readonly runKernel: Kernel;
  readonly runId: string;
  readonly at: Date;
  readonly db: Database;
  readonly commit: string;
  readonly logger: Logger;
};

export type OpenStep = { readonly client: Client; readonly scene: RunScene; close(): Promise<void> };

export async function connectInProcess(
  connection: RunStepConnection,
): Promise<KernelOutcome<OpenStep>> {
  const found = await connection.runKernel.runs.scene(connection.runId);
  if (found.status !== 'accepted') return found;
  const scene = found.value;
  const server = createVerbServer({
    principal: scene.principal,
    host: 'workflow',
    at: connection.at,
    traceId: scene.run.traceId,
    kernel: connection.verbKernel,
    db: connection.db,
    commit: connection.commit,
    logger: connection.logger,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client(
    { name: 'uw-workflow-host', version: CONTRACT_VERSION },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  await client.connect(clientSide);
  return {
    status: 'accepted',
    value: { client, scene, close: async () => { await client.close(); await server.close(); } },
  };
}
```

(Match `KernelOutcome`'s real accepted shape in `packages/harness/outcome.ts`; `verbKernel` is the kernel built with `hubWiring` that serves the verbs, `runKernel` is the run host's kernel built with `runWiring`; the two share one database and clock. `apps/uw-app/runs/steps.ts` holds `openStep(deps, runId)`, the only caller of `connectInProcess`.)

**Step runner** (`apps/uw-app/runs/step-runner.ts`):

```ts
export type StepConfig = { readonly retries: number; readonly timeout: string };
export const STEP: StepConfig = { retries: 3, timeout: '15 minutes' };
export const WORK_STEP: StepConfig = { retries: 3, timeout: '30 minutes' };
export const GATE_WAIT = '30 days';
export type StepRunner = {
  do<T extends Serializable>(name: string, config: StepConfig, body: () => Promise<T>): Promise<T>;
  waitForResume(name: string, timeout: string): Promise<'resumed' | 'timed_out'>;
};
export function workflowStepRunner(step: WorkflowStep): StepRunner;
```

`workflowStepRunner` maps `do` to `step.do(name, { retries: { limit: config.retries, delay: '10 seconds', backoff: 'exponential' }, timeout: config.timeout }, body)` and `waitForResume` to `step.waitForEvent(name, { type: 'run-resumed', timeout })`, answering `timed_out` when it throws its timeout error. `Serializable` is a local JSON type. `NonRetryable` failures are thrown as `NonRetryableError` from `cloudflare:workflows` inside `workflow.ts` only; the core throws its own `RunStop` and `RunFailed` errors and `workflowStepRunner` wraps them as non-retryable.

**Run core** (`apps/uw-app/runs/run-core.ts`, `runWorkflow(start: RunStart, steps: StepRunner, deps: RunDeps)`), in order, each a named `steps.do`:
1. `read`: open the step (`connectInProcess`), call `resolve_context` `{ itemId }` through the client, record `record_run_step` `{ step: 'read', tokensIn: 0, tokensOut: 0, costBasis: 'metered' }`, close; answers `{ context }` (the reply's text cut to 60,000 characters) and any prompts.
2. `scout`: open; the scout engine (`openrouter-messages` per S7-D16) through `engineAdapter(...).work` with the read-only toolset and the scout prompt (instructions, context, prompts, and the scout verdict format); `record_run_step` `{ step: 'scout', … }` with the usage, the step's minor cost (`costMicros` → minor, half up), the resolved provider and model, the tools called and the write count (tool calls whose verb's registry grant role is `editor`); close; answers the parsed verdict.
3. Held premise: `steps.do('hold premise', …, () => kernel.runs.holdPremise(runId, { reason }))` and end.
4. `work`: open; the persona's engine and model, the persona's toolset, the work prompt (instructions, context, prompts; for a `review` capability, the diff from `kernel.runs.reviewDiff`, ending the run when it answers `review_refused` or `review_withheld`); `onTurn` renews the lease through `deps.runs.items.renewLease(<scene principal caller>, { itemId })` when 5 minutes have passed since the last renewal; `record_run_step` `{ step: 'work', … }` with `computeMinor` from the engine; close; answers `{ text, outcome, resolvedProvider, resolvedModel }`. `turn_limit` → `kernel.runs.fail(runId, { step: 'work', why: 'turn_limit', detail: null })` and end.
5. Review: when the capability is `review`, `steps.do('post review', …)`: `parseReviewVerdict(text)`; a problem → `kernel.runs.complete(runId, { result: 'review_withheld', review: null })`; else `kernel.runs.postReview(...)`; then end (a Reviewer at Check submits through the item's validators on the next step only if the item is still held — it is: `postReview` does not release).
6. `submit`: open; if the item is still held by the run, `submit_to_gate` `{ itemId, to: null, pullRequest: null, head: null }`; `record_run_step` `{ step: 'submit', … }`; close; a `parked` result → `kernel.runs.hibernateAtGate(runId)` inside the same step body; answers the result.
7. `parked`: `steps.waitForResume('gate decided', GATE_WAIT)`; `timed_out` → `steps.do('gate wait expired', …, () => kernel.runs.halt(runId, 'gate_wait_expired'))`; `resumed` → `steps.do('close', …, () => kernel.runs.complete(runId, { result: 'decided', review: null }))`.
8. Otherwise `steps.do('close', …, () => kernel.runs.complete(runId, { result: 'submitted', review: null }))`.

A scene refused `run_hibernated` (paused or breaker) inside any step throws `RunHibernated`; the core then `waitForResume('resume after hibernation', GATE_WAIT)` and runs the step again. A scene refused `lease_lost` → `kernel.runs.fail(runId, { step, why: 'lease_lost' })`; `delegation_lapsed`, `run_stopped` or `run_failed` (the run already ended) → end quietly. `ProviderMismatchError` → `kernel.runs.fail(runId, { step, why: 'provider_mismatch', detail: '<pinned>/<resolved>' })`, never retried, no review. Any other error that exhausts a step's retries → `steps.do('record failure', …, () => kernel.runs.fail(runId, { step, why: 'retries_exhausted', detail: <error name> }))`.

**Workflow class** (`apps/uw-app/runs/workflow.ts`): `export class HarnessRun extends WorkflowEntrypoint<Bindings, RunStart>` whose `run(event, step)` parses `event.payload` with a Zod schema of `RunStart` and calls `runWorkflow(payload, workflowStepRunner(step), runDepsOf(this.env))`. `runDepsOf` (`deps.ts`) builds the database, the two kernels (`hubWiring` and `runWiring` with the GitHub read client and the reviewer writes when configured), the engine registry, a logger carrying the run's trace id, and the clock. The class file is the only one importing `cloudflare:workers` and `cloudflare:workflows` under `runs/`; it is excluded from the Node Vitest project like `live/harness-hub.ts`.

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/runs/step-connection.pg.test.ts`:
- `HE-1 a step connects as the run's beat principal and never as a principal it is given` (the type has no principal field; the connection's `tools/list` equals an external principal's with the same owner grants)
- `HE-1 each step opens its own connection at its own instant`
- `HE-1 record_run_step from a step is metered and a subscription basis is refused`
- `HE-1 a step for a run whose delegation lapsed opens no connection`

`apps/uw-app/runs/run-core.pg.test.ts` (the Postgres server, a fake `StepRunner` that checkpoints step results by name and implements retries, a scripted engine registry):
- `HE-1 a run records read, scout, work and submit as named steps, each through record_run_step with its cost`
- `HE-1 a step that fails is retried from that step without re-running the steps before it`
- `HE-1 a run replayed after a crash between steps resumes from the last checkpoint` (run the core, throw after `scout` completes, run it again on the same fake: the engine was asked for one scout and one work)
- `HE-1 a run that exhausts a step's retries is recorded failed and its item released`
- `HE-1 at a human gate the run submits, hibernates, and resumes only when a person decides`
- `HE-1 a run paused mid-flight waits and continues after resume`
- `HE-1 the run record carries the trace id, model, tokens, cost, duration, tools called, writes, gates and outcome`
- `HE-3 the tools offered to the model are exactly the persona's toolset`
- `HE-4 a provider mismatch fails the run provider_mismatch and posts no review`
- `HE-1 a held premise ends the run without a work step`
- `HE-1 a gate left undecided for 30 days stops the run gate_wait_expired`

`tools/architecture/runs-callers.test.ts` (titled without an ID: it guards the boundary, not a requirement clause) with planted cases.

- [ ] **Step 2:** Run `pnpm vitest run apps/uw-app/runs apps/uw-app/mcp tools/architecture`; expected FAIL.
- [ ] **Step 3:** Implement. Close the FD-11 "run-step leg of the trace id" Not verified row's test half: `run-core.pg.test.ts` asserts every event the run appends carries the run's trace id.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS, including `pnpm build` (the Workflow class bundles).

```bash
git add apps/uw-app tools/architecture .dependency-cruiser.mjs docs/architecture.md
git commit -m "feat(runs): the HarnessRun Workflow: read, scout, work and submit as checkpointed steps, each connected as the run's beat principal

HE-1 HE-3 HE-4"
```

---

### Task 19: The container engines' host, the egress proxy, and `claude-code-sandbox`

**Requirements:** HE-8.

**Files:**
- Create: `apps/uw-app/engines/sandbox/host.ts` (the `ContainerHost` interface and `sandboxHost(namespace)` over `@cloudflare/sandbox`), `apps/uw-app/engines/sandbox/egress.ts`, `apps/uw-app/engines/sandbox/egress.test.ts`, `apps/uw-app/engines/sandbox/session.ts` (`runSession(host, spec)`: start, write files, exec, collect, destroy, measure wall time), `apps/uw-app/engines/sandbox/session.test.ts`, `apps/uw-app/engines/sandbox/testing.ts` (`fakeContainerHost()`), `apps/uw-app/engines/claude-code-sandbox/work.ts`, `apps/uw-app/engines/claude-code-sandbox/work.test.ts`, `apps/uw-app/engines/sandbox/classes.ts` (`export { Sandbox as ClaudeCodeSandbox, Sandbox as CodexSandbox } from '@cloudflare/sandbox'` or the subclasses the egress hook needs)
- Modify: `apps/uw-app/engines/claude-code-sandbox/index.ts`, `apps/uw-app/engines/seam.ts` (`EngineWork` gains `egress: EgressRoutes`, built by the run core from the step's open connection), `apps/uw-app/runs/run-core.ts` (pass it), `apps/uw-app/package.json` (`@cloudflare/sandbox`), `apps/uw-app/index.ts` (re-export the two classes from `engines/sandbox/classes.ts` if `pnpm build` bundles them; if it does not, leave them out and record it), `.dependency-cruiser.mjs` (`@cloudflare/sandbox` only under `apps/uw-app/engines/`)

**Dependency:** `pnpm --filter @uw/uw-app add @cloudflare/sandbox`; record the resolved version; read its type declarations for the real method names (`getSandbox`, `exec`, `writeFile`, `destroy`) and for an outbound-interception hook. Write `ContainerHost` as the smallest interface the session needs:

```ts
export type ContainerHost = {
  open(sessionId: string): Promise<ContainerSession>;
};
export type ContainerSession = {
  writeFile(path: string, content: string): Promise<void>;
  exec(command: readonly string[], env: Readonly<Record<string, string>>, timeoutMs: number): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>;
  destroy(): Promise<void>;
};
```

**Egress proxy** (`apps/uw-app/engines/sandbox/egress.ts`, pure over `Request`):

```ts
export type EgressRoutes = {
  readonly model: { readonly host: string; readonly upstream: string; readonly headers: Readonly<Record<string, string>> };
  readonly mcp: (request: Request) => Promise<Response>;
};
export async function egress(request: Request, routes: EgressRoutes, fetcher: typeof fetch): Promise<Response>;
```

Rules: the URL's host `mcp.internal` → `routes.mcp(request)` (a Streamable HTTP handler over `createVerbServer` with the step's scene principal and `host: 'workflow'`, built by the run core from the same scene, never from a header); the host equal to `routes.model.host` → forwarded to `routes.model.upstream` with the path kept, every incoming `authorization`, `x-api-key`, `cf-aig-authorization` and `cookie` header dropped and `routes.model.headers` (the organization key and the gateway token) set; anything else → `403` with body `egress refused`, logged with the host only. The key never appears in the sandbox's environment, files or command line (tests assert on the fake host's recorded env, files and commands).

**`claude-code-sandbox` work:** a session per work step, id `run-<runId>-<step attempt>`; files: `/workspace/.mcp.json` naming one server `uw-platform` at `http://mcp.internal/mcp`, and `/workspace/PROMPT.md` (the prompt); command `claude -p --output-format json --mcp-config /workspace/.mcp.json --allowedTools <mcp__uw-platform__<verb> for each toolset verb> --max-turns 40 --model <model>` with `ANTHROPIC_BASE_URL=http://model.internal` and no key; the JSON result's `result` is the text, its `usage` the tokens, `total_cost_usd` → `costMicros`; the resolved provider is `anthropic`; `computeMinor` = wall seconds × `SANDBOX_MINOR_PER_HOUR` / 3600, half up; the session is destroyed in a `finally` (no durable state). Without the namespace binding or without an egress hook in the installed SDK, `work` throws `PortNotWiredError` with `why: 'egress_unavailable'` recorded in the log (S7-D19).

- [ ] **Step 1: Write the failing tests**
  - `egress.test.ts`: `HE-8 the organization key is injected at the egress proxy and the sandbox's own credentials are dropped`; `HE-8 the MCP host reaches the step's in-process surface as the run's principal`; `HE-8 every other host is refused, GitHub included`.
  - `session.test.ts`: `HE-8 the sandbox is destroyed after the step, also when the command fails`.
  - `work.test.ts`: `HE-8 Claude Code runs headless with the persona's toolset as MCP tools and no key in its environment`; `HE-8 sandbox compute cost is recorded beside model cost`; `HE-8 without the sandbox binding the engine is not wired`.
  - Extend `run-core.pg.test.ts`: `HE-8 a Builder on claude-code-sandbox runs only where hosted Builder is on` (the start refuses; Task 5's kernel test is the unit proof).
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add apps/uw-app pnpm-lock.yaml .dependency-cruiser.mjs
git commit -m "feat(engines): claude-code-sandbox runs Claude Code headless in a Sandbox behind an egress proxy that holds the key

HE-8"
```

---

### Task 20: `codex-sandbox`, the second Reviewer identity, and the container images

Shared root `infra/` in its own commit.

**Requirements:** HE-9.

**Files:**
- Create: `apps/uw-app/engines/codex-sandbox/work.ts`, `apps/uw-app/engines/codex-sandbox/work.test.ts`, `infra/containers/claude-code/Dockerfile`, `infra/containers/codex/Dockerfile`, `tools/infra/containers.test.ts`
- Modify: `apps/uw-app/engines/codex-sandbox/index.ts`, `infra/uw-app/wrangler.go-live.toml`, `infra/README.md`, `tools/infra/go-live.test.ts`

**`codex-sandbox` work:** the session pattern of Task 19; files `/workspace/.codex/config.toml` (one MCP server `uw-platform` at `http://mcp.internal/mcp`, `model = "<model>"`, `model_provider` pointing at `http://model.internal` with no key) and `/workspace/PROMPT.md`; command `codex exec --json --skip-git-repo-check --cd /workspace "$(cat /workspace/PROMPT.md)"`; the last `agent_message` event's text is the result, `token_count` events the usage; resolved provider `openai`; `costMicros` null unless the JSON reports a cost; compute as Task 19. The run core posts its verdict through `postReview` as `uw-reviewer-codex` (the descriptor's reviewer), on a provider distinct from the first review's (Task 17 withholds otherwise).

**Images:** `infra/containers/claude-code/Dockerfile` from Cloudflare's sandbox base image (`docker.io/cloudflare/sandbox:<the version matching the installed SDK>`), installing `@anthropic-ai/claude-code` globally with npm, `USER` non-root, no `ENV` holding a key; `infra/containers/codex/Dockerfile` the same with `@openai/codex`. `tools/infra/containers.test.ts`: neither Dockerfile sets an `ENV` or `ARG` whose name matches `KEY|TOKEN|SECRET|OAUTH|AUTH`, both end on a non-root `USER`, and each `FROM` pins a tag (a planted case fails).

**go-live** (staging and production only):

```toml
[[env.staging.containers]]
class_name = "ClaudeCodeSandbox"
image = "../containers/claude-code/Dockerfile"
max_instances = 4

[[env.staging.containers]]
class_name = "CodexSandbox"
image = "../containers/codex/Dockerfile"
max_instances = 4

[[env.staging.durable_objects.bindings]]
name = "CLAUDE_CODE_SANDBOX"
class_name = "ClaudeCodeSandbox"

[[env.staging.durable_objects.bindings]]
name = "CODEX_SANDBOX"
class_name = "CodexSandbox"
```

and a top-level `[[migrations]] tag = "v2" new_sqlite_classes = ["ClaudeCodeSandbox", "CodexSandbox"]`. `tools/infra/go-live.test.ts` asserts none of these reaches `wrangler.toml` or `preview` (planted cases).

- [ ] **Step 1: Write the failing tests**
  - `work.test.ts`: `HE-9 Codex runs in its own container with the toolset as MCP tools and no key in its environment`; `HE-9 its verdict is posted as uw-reviewer-codex on the head commit`; `HE-9 the container holds no state after the step`.
  - `tools/infra/containers.test.ts` and the go-live cases (titled without an ID).
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; infra commit first.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add infra tools/infra
git commit -m "build(infra): the two sandbox images and their bindings, for go-live only

Shared root infra/: Claude Code and Codex images with no key baked in; the
Durable Object classes and their v2 migration wait for the switch-on.

HE-8 HE-9"
git add apps/uw-app
git commit -m "feat(engines): codex-sandbox, the second Reviewer identity on its own provider

HE-9"
```

---

### Task 21: The synced harness skill

**Requirements:** HE-7, HE-6 (the external runner's flow).

**Files:**
- Create: `skills/harness/SKILL.md`, `tools/skills/sync-harness-skill.ts`, `tools/skills/sync-harness-skill.test.ts`, `tools/skills/fixtures/harness-skill-page.json`, `tools/architecture/skill-scripts.test.ts`
- Modify: `package.json` (`"skill:sync": "node tools/skills/sync-harness-skill.ts"`), `knip.json` or the knip config if the new tool needs an entry

**`skills/harness/SKILL.md`:** agentskills.io format: YAML frontmatter `name: harness`, `description: <one sentence>` (the fields `skillFrontmatterSchema` requires; read it), then sections, sentence case, second person: Sign in (`cloudflared access` and the MCP server entry for `https://<uw-app>/mcp` with the `x-uw-device` header), Poll (`poll_queue`), Claim (`claim_item`, with `delegation_id` for a scheduled routine), Worktree (`git worktree add ../<item> -b harness/<item> <expected head>`, or the adopted branch), Context (`resolve_context`), Work and record (`record_run_step` on every step with `tokensIn`, `tokensOut` and `costBasis: subscription`, no cost; read `prompts` in the reply), The lease warning (when a reply carries `leaseWarning: true`, commit everything as `wip: <item>` and push to `harness/<item>` with your own git credentials), Pull request (open it with the fenced `harness` declaration first in the body: `closes`, `risks`, `touches`, `risk_tier`, `risk_domains`), Submit (`submit_to_gate` with the pull request and head), What you never do (approve, merge, deploy, publish; no verb exists for them). No `scripts/` folder in v1.

**Sync** (`tools/skills/sync-harness-skill.ts`): reads a page JSON (the `read_page` verb's output shape) from the path argument, refuses one whose `type` is not `skill` or whose frontmatter fails `skillFrontmatterSchema`, and writes `skills/harness/SKILL.md` as `---\n<frontmatter as YAML>\n---\n\n<body_md>`; `--check` compares instead of writing and exits 1 on a difference.

**Script check** (`tools/architecture/skill-scripts.test.ts`): for every file under `skills/**/scripts/` (via `repoFiles()`), refuse a match of `/(api[_-]?key|token|secret|password|bearer|oauth)/i`, `/https?:\/\/(?!<the MCP host placeholder>)/`, `\bfetch\(`, `\bcurl\b`, `\bwget\b`, `\bgh\s`, `git\s+push`; planted fixtures under `tools/architecture/fixtures/skills/` (a script with a token, one calling `curl`, one calling the MCP surface only) prove each case.

- [ ] **Step 1: Write the failing tests**
  - `sync-harness-skill.test.ts`: `HE-7 the harness skill in the repo parses as a skill page`; `HE-7 syncing from the skill page writes the repo copy and a second sync changes nothing`; `HE-7 the skill tells a session the flow in order` (the section headings in order); `HE-7 the skill pushes a wip commit at the lease warning with the person's own credentials`.
  - `skill-scripts.test.ts`: `HE-7 a script in a skill's folder that holds a credential or calls outside the MCP surface is refused`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; `pnpm skill:sync -- tools/skills/fixtures/harness-skill-page.json --check` passes.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add skills tools package.json
git commit -m "feat(skills): the synced harness skill for a person's own Claude Code, and the skill-script check

HE-6 HE-7"
```

---

### Task 22: Record step 7 in the progress tracker

**Requirements:** HE-1 to HE-10 (the record); DX-5.

**Files:**
- Modify: `docs/progress_tracker.md`, `.superpowers/sdd/BUILD.md` is the controller's and is not touched

- [ ] **Step 1: Prove the trace**

Run: `pnpm trace:built` and `pnpm trace`
Expected: `trace:built` passes; `pnpm trace` lists none of HE-1 to HE-9 (HE-10 is Later and not counted). Record the summary line exactly as printed.

- [ ] **Step 2: Update the tracker**

1. Status row 7: `Built`, with the evidence: the plan path; each requirement's scenarios and tests (listed from `tools/trace/proofs.ts`'s scanner output for HE-*), which have a scenario (HE-1, HE-4, HE-5, HE-6, HE-8) and which are proven by tests only (HE-2, HE-3, HE-7, HE-9, HE-10); the trace summary line; `pnpm verify` green with `TEST_DATABASE_URL` set; and what has not run live (no Workflow, Sandbox, Container, AI Gateway, Anthropic, OpenAI, OpenRouter or Reviewer App has been called; the cron and every binding are in the go-live file only).
2. A "Step 7 evidence by requirement" section in the format of step 6's (commits from this step's first task commit to the tracker commit, the plan commit left out; a commit listed against every requirement its body's last line names).
3. "Decisions made during the build": S7-D1 to S7-D25, one row each, with the date, the requirement IDs, the decision, why and the cost if wrong, plus every ruling the controller makes during execution.
4. "New dependencies": `@anthropic-ai/sdk` (replaces a hand-written Messages API client in `claude-messages`), `openai` (replaces a hand-written Chat Completions client for OpenRouter), `@cloudflare/sandbox` (replaces a hand-written Containers client for the two sandbox engines), each with its resolved version and licence; contract `11.0.0` (not a dependency; the apps' `contractVersion` moved).
5. "Not verified": the AI Gateway paths for `anthropic` and `openrouter` and the GraphQL dataset `aiGatewayRequestsAdaptiveGroups` and its `sum.cost` field; OpenRouter's `provider` reply field and its slug form; Workflows' `waitForEvent` timeout behaviour and buffering of an event sent before the wait; the Sandbox SDK's outbound interception (whether the egress proxy can be bound, S7-D19); the Claude Code and Codex CLI flags and JSON output in the images; the sandbox compute rate; the Cloudflare per-invocation subrequest limit for the minute job; a real Reviewer review posted and read back; the FD-11 run-step trace leg in a deployed Workflow (its test half is now proven).
6. "Waiting on a person", one row each: the `HARNESS_RUN` Workflow binding (switch-on PR; confirm the deploy token may create Workflows); the minute cron trigger; AI Gateway (create the gateway, set `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_ID`, optionally `AI_GATEWAY_TOKEN`, and `AI_GATEWAY_ANALYTICS_TOKEN` with Account Analytics read; set the cap in AI Gateway to the brief's figure and `AI_SPEND_CAP_MINOR` to match); `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` as Worker secrets; the always-on model and provider (`ALWAYS_ON_MODEL`, `ALWAYS_ON_PROVIDER`, Q10); Cloudflare Sandbox and Containers enabled, the two images built and the `v2` migration applied; the two Reviewer GitHub Apps registered from `infra/github/reviewer-app-manifest.json` and `reviewer-codex-app-manifest.json` with their secrets, and their logins confirmed against `packages/harness/github/reviewers.ts`; a first hosted run on staging end to end (a review run on `openrouter-messages` posting a review that reads back) and a first external run through the skill. Each names PRD section 15's owner.
7. "Carried to later steps": hosted Builder's git push and pull request through the egress proxy, and its GitHub identity (to step 10, PE-5); Reviewer's three-round hand-off (step 10, PE-6); `get_health`'s `spend` and `runs_today` indicators and the run columns of the Flow, Board, play-by-play and `/health` views (step 8, WB-4, WB-8, WB-10); run-failed and delegation-lapsed wakes (step 9, NT-4); the `personas` projection replacing `pages.read.activePersona` in the beat (step 10, PE-3). Close the step-2 row (`RunsSubject.finish`, Task 16), the two step-4 rows (Task 18), the step-3 pause row (Task 7), the step-5 HE-4 row (Task 17) and the step-6 stop and prompt row (Tasks 6 and 10), each with its commits.

- [ ] **Step 3: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS (`trace:built` now holds step 7 to its proofs).

```bash
git add docs/progress_tracker.md
git commit -m "docs(tracker): step 7, hosts and engines, built: evidence, decisions, what was not verified and what waits on a person

HE-1 HE-2 HE-3 HE-4 HE-5 HE-6 HE-7 HE-8 HE-9 HE-10"
```
