# unfoldingWord Platform: the harness

The vocabulary of the harness, the module of the unfoldingWord platform that runs work through stages with agents as governed coworkers and a person at every gate that has an effect on the world. One context; every document, module, test, issue and screen uses these words and no synonyms. Where a word is the platform's rather than the harness's, the Platform Architecture Plan section is cited.

## The pipeline

**Harness**:
One instance of the pipeline, built from a template, scoped to a JD area. The software harness lives in area 80 to 89; a BML harness lives in the area of the program whose product it serves.
_Avoid_: pipeline (that is the drawing), queue, board (that is a screen), work queue (the plan's older name)

**Template**:
The stage graph a harness is built from. Two in v1: software delivery and the BML product flywheel. Same eight stages, different names, workers and connectors.
_Avoid_: workflow (that is a Cloudflare Workflow), process

**Stage**:
One row of `harness_stages`: a position, who may pick up work there, how an item leaves, what leaving does in the world, and which validators run. Eight per template: Package, Scope, Plan, Build, Check, Ship, Validate, Close.
_Avoid_: column, step (that is a run step), phase

**Item**:
One unit of work moving through a harness: a row of `harness_items` wrapping a page or a GitHub issue. It has a stage, a holder, a lease, a risk tier and a history.
_Avoid_: card (the board's rendering of an item), ticket, task (the platform's `tasks` table is a different thing)

**Package**:
The first stage, and the typed pages that describe what a harness is for: `system_goal`, `product_strategy`, `data_sources`. A **kickstart** creates the first item from it.
_Avoid_: brief, spec, epic

**Gate**:
How an item leaves a stage. `none`, `checks` (validators run), or `human_approval` (a person decides). The Ship gate is always `human_approval`; the database refuses anything else.
_Avoid_: approval step, checkpoint, review (that is what Reviewer does)

**Connector**:
What leaving a stage does in the world: `none`, `merge`, `deploy`, `publish`, `send`, `post`. A stage with a connector other than `none` has an external effect and therefore a human gate.
_Avoid_: integration, hook, action

**Validator**:
A check picked by key from a registry and run at a `checks` gate. `learning_attached` is the Close validator.
_Avoid_: linter, rule, test (validators run on items, tests run on code)

**Feeds**:
The loop edges on a stage row that let an item re-enter an earlier stage: the **regular tweak** from Close to Scope and the **occasional tweak** from Validate to Package.
_Avoid_: loop, back-edge, retry

**Ship rule**:
The pure function that decides whether the Ship button is enabled. Inputs: GitHub facts about the head commit, the item's risk tier and domains, and the approver's principal. Output: advance, or a refusal from a closed set.
_Avoid_: merge check, policy, gate logic

**Risk tier**:
`low`, `standard` or `high` on every item, floored from the paths its diff touches and raised by the PR's declaration, never lowered. **Risk domains** name which protected areas it touches: `ledger`, `acl`, `infra`, `migration`.
_Avoid_: severity, priority (that is ordering), impact

## Who acts

**Person**:
A human principal with a Google login through Cloudflare Access and rows in the grants table. The only kind of identity that can write a gate decision.
_Avoid_: user, human (as a noun in code), approver (that is a role a person plays at one gate)

**Principal**:
The structured identity minted at the edge for every request: a person or agent id plus their resolved grants. It travels with every call, queue message and MCP invocation (plan §4).
_Avoid_: session, token, actor (actor is the field name on an event, and holds a principal's id)

**Grant**:
One row of `role_grants`: a role (`admin`, `editor`, `viewer`) at a scope (the org, or one JD area), optionally expiring. `can(actor, verb, resource)` is the one function that reads them (plan §4).
_Avoid_: permission, role (a role is one field of a grant), ACL entry

**Persona**:
A job an agent does, defined as configuration: an identity, a harness subscription, an instructions page, a toolset picked from the verb registry, a run shape and an engine. Three in v1: Builder, Reviewer, Iterate. A persona is a page of type `persona`.
_Avoid_: agent (an agent is the identity a persona runs as), bot, worker, role

**Agent identity**:
The principal a persona runs as: `agent:<persona>` for a platform-hosted run, `agent:<person>/<device>` for a run on a person's own machine, suffixed `as <persona>` and, when unattended, `via delegation:<id>`. Its grants never exceed its owner's.
_Avoid_: service account, bot user, machine user

**Scout pass**:
The first step of a Builder run: verify the item's premise against current code and data before building. In v1 it is a step, not a persona.
_Avoid_: Scout (as a persona name in v1), explorer, triage

**Delegation**:
A row that lets unattended work run: a person holding `admin` on the harness's area grants a persona one capability word for a bounded time. Every **beat** (an unattended claim, on any host) presents a live delegation or is refused.
_Avoid_: schedule, cron, impersonation, service token (that is how a routine authenticates; the delegation is what lets it act)

**Lease**:
The time-boxed hold an agent takes on an item at claim, renewed by every run step and released on expiry. A person's claim has no lease.
_Avoid_: lock, assignment (a person is assigned; an agent holds a lease), checkout

**WIP limit**:
The maximum number of items a stage may hold at once, applied to people and agents alike (plan §13).
_Avoid_: capacity, quota, throttle

## How work runs

**Run**:
One execution of one persona turn against one item: a row of `harness_runs`. It has a host, an engine, steps with costs, and it hibernates at a human gate.
_Avoid_: job, session, invocation, execution

**Run shape**:
The loop a run follows, from a registry: `workflow-run` (a Cloudflare Workflow) or `external-run` (a person's own tool over remote MCP). A new shape is code.
_Avoid_: mode, runner type

**Host**:
Where a run executes: the platform (a Cloudflare Workflow, optionally with a Sandbox or Container) or an **external runner** (a staff member's own Claude Code or Codex on their own machine). Billing follows the host.
_Avoid_: environment, runtime, machine

**Engine**:
The code behind one seam that talks to a model vendor: `claude-messages`, `claude-code-sandbox`, `claude-managed-agent`, `codex-sandbox`, `external`, `openrouter-messages`. A persona picks one. The vendor SDK is named in exactly one directory per engine.
_Avoid_: model (that is one field of the persona), provider, backend, LLM

**Always-on tier**:
The hosted runs that happen often and need no frontier model: scout passes, Iterate reads, intake, validators, and Reviewer by default (spec D21). They run on `openrouter-messages` on a cheap open model.
_Avoid_: background jobs, cheap tier, batch

**Run step**:
One recorded unit inside a run: read, scout, work, submit. Each renews the lease and reports its tokens.
_Avoid_: checkpoint, task, action

**Verb**:
One tool on the MCP surface, from the one registry published by `packages/contracts`. `approve`, `merge`, `deploy`, `publish` and advancing past a human gate are not verbs; they do not exist for any agent identity.
_Avoid_: tool (as the noun in prose; tool is the MCP wire word), command (that is a person's action), capability (that is the delegation's word)

**MCP surface**:
The remote MCP server inside `uw-app` that serves the verb registry. The only way a persona touches the platform, on either host.
_Avoid_: API (that is the command API people use), agent API, gateway

**Command**:
An action a person takes on the harness through the command API: kickstart, enqueue, reorder, claim, release, submit, approve, reject, take over, override, prompt run, stop run, pause, resume, tweak package, schedule regular tweak. Every command carries a `requestId` and returns `accepted` or `error`.
_Avoid_: verb (that is the agent's word), action, mutation, endpoint

**Event**:
One row of `harness_events`: a typed, append-only record of something that happened to a harness, from a closed vocabulary. The item's state is a fold over its events; replay equals record.
_Avoid_: log line, history entry, audit row (the audit trail is a fold over events), message

**Play-by-play**:
The rendering of an item's events in order, with actor, host, cost basis and links.
_Avoid_: timeline, activity, log, history

**Gate decision**:
One row of `gate_decisions`: a person's approve, reject, take over or override at a gate, with reason and evidence, kept seven years. Written only by a human principal, inside a transaction that locks and re-reads the approver's grants.
_Avoid_: approval (that is one kind of decision), sign-off, review

**Learning**:
A page of type `learning`: a measured fact or working rule with a confidence label (`observed`, `confirmed`, `inferred`, `assumed`), an as-of date and what it supersedes (plan §6). Close refuses an item that attaches neither a learning nor a signed `nothing_learned`.
_Avoid_: note, insight, lesson, memory (the plan's phrase is institutional memory; a learning is one unit of it)

**Skill**:
A page of type `skill`: a procedure in the agentskills.io format that any compliant runner can load. Per-stage instructions pages are skills. The **synced harness skill** is checked into the repo so a local session knows the flow.
_Avoid_: prompt, playbook, instructions (as a noun; an instructions page is a skill)

**Measurement**:
A row of `measurements` read at Validate: web analytics, list aggregates, manual entries. In v1 nothing that carries donor identity.
_Avoid_: metric, KPI, analytics (that is a source of measurements)

## Reaching a person

**Wake**:
A notification that names the harness and the reason, never the content, and tells the client to read events from its cursor. Delivered by web push and by the Zulip bot thread.
_Avoid_: push (that is one transport), alert, message

**Live hub**:
One Durable Object per active harness that sends wakes. It holds no data; each client reads from its own **cursor**, so a dropped wake loses time and nothing else.
_Avoid_: socket, websocket server, pub/sub, sync hub (that is the plan's per-page editor hub)

**Cooldown**:
One window per person in which a weaker wake never spends what a stronger one needs. Ranked: gate waiting on you, then run failed, then stage advanced.
_Avoid_: debounce, rate limit, digest

**Waiting on you**:
The Home view and the wake for gates the current person can decide and runs on items they hold.
_Avoid_: inbox, to-do, notifications

## The repo and the build

**Spec**:
`prd/Harness v1 - Architecture.md`, the ratified design. The source of truth for what the harness is. Its Decisions table is where a design change is recorded.
_Avoid_: PRD (the plan's PRD is the platform's), design doc, RFC

**Plan**:
`prd/An App For Everything - Platform Architecture Plan.md`, Jesse's design for the whole platform. The harness sits one level below it and consumes its ACL, pages and topology.
_Avoid_: roadmap, vision (that is the Executive Brief)

**Milestone**:
One of the ten GitHub milestones M0 to M9. Issues carry their milestone, a priority label, an area label and native blocked-by edges.
_Avoid_: phase (that is the plan's word for platform rollout), sprint, epic

**Ready**:
The label on an issue that is unblocked and pickable. Assigning yourself is the claim.
_Avoid_: available, open (every unclosed issue is open), unassigned

**Verify**:
`pnpm verify`, the whole check chain, the same one CI runs.
_Avoid_: build, test (one part of it), lint (one part of it)
