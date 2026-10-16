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

**Grant audit**:
One row of `grant_audit`: who granted or revoked which grant, when, the row before and after, and the trace id. Append-only.
_Avoid_: access log, history

**Persona**:
A job an agent does, defined as configuration: an identity, a harness subscription, an instructions page, a toolset picked from the verb registry, a run shape and an engine. Three jobs in v1: Builder, Reviewer, Iterate. A persona is a page of type `persona`; it runs only once **activated**. The template fixtures hold five: `agent:builder` (external run), `agent:builder-hosted` (workflow run on `claude-code-sandbox`), `agent:reviewer`, `agent:reviewer-codex` (a second Reviewer on `codex-sandbox`) and `agent:iterate`.
_Avoid_: agent (an agent is the identity a persona runs as), bot, worker, role

**Activation**:
A person with `admin` on the harness's area turning a `suggested` persona page `active`, at the version they saw, after the tool check and the **dry run**. The only way a persona runs. It flips the page's status, writes the `personas` projection and records `persona_activated` in one transaction.
_Avoid_: enable, publish, deploy (those are gate words), confirm (that is for learnings and skills)

**Dry run**:
The check activation runs before the flip: the persona's instructions are an agentskills document named for it, its engine hosts its run shape, it resolves a provider, a `review` persona holds no `write_page`, and one fixture turn runs through the tool loop with every tool refused. Pure: it writes nothing and calls no port. A failure records `persona_activation_failed` with `dry_run_failed`.
_Avoid_: test run, smoke test, rehearsal

**Agent identity**:
The principal a persona runs as: `agent:<persona>` for a platform-hosted run, `agent:<person>/<device>` for a run on a person's own machine, suffixed `as <persona>` and, when unattended, `via delegation:<id>`. Its grants never exceed its owner's.
_Avoid_: service account, bot user, machine user

**Device**:
The second segment of `agent:<person>/<device>`: a lowercase name a person gives one of their machines or routines (`laptop`, `hourly-routine`). The first segment is the person's id, so a device identity always names its owner. A person's login names the device in the `x-uw-device` header; a service token's device comes from its binding. In web push, a device is one browser install holding one push subscription, kept by its endpoint.
_Avoid_: host (that is where a run executes), machine id, client

**Service token binding**:
A row of `service_tokens` that maps one Cloudflare Access service token (by its client id) to the person it acts for and the device it is. Only an org admin binds or revokes one. A token with no live binding cannot reach the MCP surface.
_Avoid_: API key, agent account, allow-list

**Scout pass**:
The first step of a Builder run: verify the item's premise against current code and data before building. In v1 it is a step, not a persona.
_Avoid_: Scout (as a persona name in v1), explorer, triage

**Scout verdict**:
The fenced `harness-scout` block that ends a scout step: the premise holds or is held, with a one-line reason. Anything else is a held premise.
_Avoid_: scout result, triage outcome

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

**Kernel**:
The pure core in `packages/harness`: the stage machine, the ship rule, the fold and the walker, built by `createKernel(ports)` and reaching everything outside itself through a port.
_Avoid_: engine (that is the model-vendor seam), core (that is `packages/core`), service, backend

**Port**:
An interface the kernel needs from the world: Clock, Ids, Store, Grants, GitHubFacts, Connectors, ModelEngine, Hub, Notifier, Runs. Each has a platform adapter, a test adapter and one contract test run against both.
_Avoid_: interface (too general), driver, provider, memory adapter (the test adapter for Store is real Postgres)

**Adapter**:
One implementation of a port. A **platform adapter** lives in `apps/uw-app/ports/` and reaches the real service; a **test adapter** lives in `sim/adapters/` and is scripted or records what it was asked. The Store and Grants adapters bind the one Drizzle implementation in `packages/db/store/`, so both run the same queries. An adapter whose service is built in a later step is **not wired**: every call rejects with `PortNotWiredError`, which the kernel reports as the refusal `not_wired`.
_Avoid_: driver, implementation, mock, fake, stub (say "not wired")

**Port contract**:
The one shared test suite for a port, in `packages/harness/port-contracts/`, run against every adapter of that port, so a platform adapter and a test adapter cannot drift.
_Avoid_: interface test, integration test

**Sim**:
The kernel on test adapters, run in Node: `sim/`. `pnpm sim -- <scenario>` runs one scenario and prints its event log and folded state.
_Avoid_: simulator, harness (that is the pipeline), test bed

**World**:
What a scenario runs in: one embedded Postgres with the real migrations, the ten test adapters, one clock, and the kernel built over them. Built by `createWorld()`.
_Avoid_: fixture (that is data), context, environment

**Scenario**:
A file in `sim/scenarios/` named `<requirement ID>.<slug>.ts` that drives a world and asserts on the event log and the folded state.
_Avoid_: test (tests sit at module interfaces), story, script

**Walk**:
Every path through a template's stages from Package along position order and every feeds edge, cut at the first revisited stage. `pnpm walk -- <template>` prints every path to an external effect and the gate each crosses.
_Avoid_: traversal, crawl

**Trace**:
The check that every Must requirement not marked Built has a scenario or a test named for it. `pnpm trace` lists every unproven one; `pnpm trace:built` fails only on those whose build-order step the progress tracker marks Built.
_Avoid_: coverage (that is lines of code), audit

**Engine**:
The code behind one seam that talks to a model vendor: `claude-messages`, `claude-code-sandbox`, `claude-managed-agent`, `codex-sandbox`, `external`, `openrouter-messages`. A persona picks one. The vendor SDK is named in exactly one directory per engine.
_Avoid_: model (that is one field of the persona), provider, backend, LLM

**Always-on tier**:
The hosted runs that happen often and need no frontier model: scout passes, Iterate reads, intake, validators, and Reviewer by default (spec D21). They run on `openrouter-messages` on a cheap open model.
_Avoid_: background jobs, cheap tier, batch

**Run step**:
One recorded unit inside a run: read, scout, work, submit. Each renews the lease and reports its tokens.
_Avoid_: checkpoint, task, action

**Run scene**:
What a hosted step acts as: the run, its item and the beat principal derived from its delegation at that step. Each step derives it afresh.
_Avoid_: session, run context

**Engine descriptor**:
The kernel's data about one engine: availability, kind, run shapes, default provider, whether it needs hosted Builder, and its reviewer identity. The kernel reads the descriptor and never branches on an engine key.
_Avoid_: engine config, engine settings

**Hosted Builder**:
The per-harness switch that lets Builder run on `claude-code-sandbox`. Off by default; turning it off does not stop a run already started.
_Avoid_: sandbox mode, cloud Builder

**Breaker**:
The spend guard over AI Gateway's cost: it holds new hosted claims at 75 percent of the cap and hibernates running hosted runs at 90.
_Avoid_: budget, limiter

**Egress proxy**:
The platform hook a sandbox's outbound traffic passes through: it injects the model key, routes the MCP host, and refuses everything else.
_Avoid_: firewall, gateway (that is a Store gateway or AI Gateway)

**Review verdict**:
The fenced `harness-verdict` block that ends a review run's work: approve or request changes, then the findings.
_Avoid_: review result, approval (only a person approves a gate)

**Review round**:
One review a Reviewer posts on an item. The third `request_changes` from one Reviewer since the item last entered its stage ends the rounds and causes a **hand-off**.
_Avoid_: iteration, pass, cycle

**Hand-off**:
The kernel giving an item to a named person, with no lease, so no agent can claim it; recorded as `handed_to_person` with the reason and the round count.
_Avoid_: escalation (that is the dashboard's rate), reassignment, takeover (that is a gate decision)

**Verb**:
One tool on the MCP surface, from the one registry published by `packages/contracts`. `approve`, `merge`, `deploy`, `publish` and advancing past a human gate are not verbs; they do not exist for any agent identity.
_Avoid_: tool (as the noun in prose; tool is the MCP wire word), command (that is a person's action), capability (that is the delegation's word)

**MCP surface**:
The remote MCP server inside `uw-app` that serves the verb registry. The only way a persona touches the platform, on either host.
_Avoid_: API (that is the command API people use), agent API, gateway

**Command**:
An action a person takes on the harness through the command API: kickstart, enqueue, import, reorder, claim, release, submit, approve, reject, take over, override, prompt run, stop run, pause, resume, tweak package, schedule regular tweak, revoke delegation, recover connectors, and the stage command: activate template, create, update, reorder and remove stage; and set hosted Builder. Every command carries a `requestId` and returns `accepted` or `error`.
_Avoid_: verb (that is the agent's word), action, mutation, endpoint

**Person surface**:
The command handlers that decide gates, edit stages and grant or revoke delegations: `apps/uw-app/commands/person/`. Only a person's command reaches them; nothing the MCP surface reaches imports them.
_Avoid_: admin API, privileged routes

**Gate view**:
What a person deciding a gate is shown: the parsed PR declaration, the tier and domains with the head they were derived at, every ship-rule input and the rule's answer for them. Read from the read model; the decision refreshes.
_Avoid_: gate page, approval screen

**Request ledger**:
The `command_requests` table: one row per person and `requestId`, so a repeated command replays its first outcome.
_Avoid_: idempotency cache, dedupe table

**Event**:
One row of `harness_events`: a typed, append-only record of something that happened to a harness, from a closed vocabulary. The item's state is a fold over its events; replay equals record.
_Avoid_: log line, history entry, audit row (the audit trail is a fold over events), message

**Projection**:
The `harness_items` row: the fold of an item's events, written in the same transaction as the events it folds. Replaying the log must give exactly the projection.
_Avoid_: cache, snapshot

**Gateway**:
One table's member of a Store transaction, `tx.<table>`, with a `read` half and a `write` half; only the table's owner calls the write half.
_Avoid_: repository, DAO

**Play-by-play**:
The rendering of an item's events in order, with actor, host, cost basis and links.
_Avoid_: timeline, activity, log, history

**Gate decision**:
One row of `gate_decisions`: a person's approve, reject, take over or override at a gate, with reason and evidence, kept seven years. Written only by a human principal, inside a transaction that locks and re-reads the approver's grants.
_Avoid_: approval (that is one kind of decision), sign-off, review

**Learning**:
A page of type `learning`: a measured fact or working rule with a confidence label (`observed`, `confirmed`, `inferred`, `assumed`), an as-of date and what it supersedes (plan §6). Close refuses an item that attaches neither a learning nor a signed `nothing_learned`.
_Avoid_: note, insight, lesson, memory (the plan's phrase is institutional memory; a learning is one unit of it)

**Confirmation**:
A person turning a `suggested` learning or skill page `active` at the version they read, with `write` on its area. Agents cannot confirm. A persona is not confirmed but activated.
_Avoid_: approval (that is a gate decision), activation (that is for personas), sign-off

**Contradiction**:
A learning whose `supersedes` names a learning that is not retired. The flag `contradicts` sits on the newer learning, derived by the page writer on every write; the older one carries no mark.
_Avoid_: conflict, clash, override

**Stale learning**:
A `suggested` or `active` learning labelled `assumed` or `inferred` whose review date (`review_by`, else `as_of` plus 90 days) has passed. Counted by the `stale_learnings` indicator and listed by the stale-confidence report.
_Avoid_: expired learning, outdated, old

**Skill**:
A page of type `skill`: a procedure in the agentskills.io format that any compliant runner can load. Per-stage instructions pages are skills. The **synced harness skill** is checked into the repo so a local session knows the flow.
_Avoid_: prompt, playbook, instructions (as a noun; an instructions page is a skill)

**Measurement**:
A row of `measurements` read at Validate: web analytics, list aggregates, manual entries. In v1 nothing that carries donor identity.
_Avoid_: metric, KPI, analytics (that is a source of measurements)

**Revision**:
A page an Iterate run drafts to change the Product Package (a `product`, `system_goal`, `product_strategy` or `data_sources` page), attached to the item and routed along a `feeds` edge. Every claim in it carries an evidence label.
_Avoid_: change request, proposal, patch, edit

**Trace id**:
The UUID minted at the edge of each Worker for one request or delivery, carried in the `x-trace-id` header, on every log line, in every envelope and on the audit row it produces.
_Avoid_: request id (that is a command's `requestId`), correlation id, span

**Envelope**:
The Zod-validated message `uw-ingest` puts on the queue for one verified webhook delivery: source, delivery id, event, trace id, the ingest principal and the payload.
_Avoid_: event (that is a row of `harness_events`), message (the queue's word for the transport), job

**Page type**:
One entry of the page-type registry in `packages/contracts`: a frontmatter schema, a classification and an offline eligibility. Seven in v1: `skill`, `learning`, `persona`, `product`, `system_goal`, `product_strategy`, `data_sources`.
_Avoid_: template (that is a stage graph), kind, category

## What GitHub says

**GitHub facts**:
What GitHub says about a PR: whether it is open, its head commit, the check runs on that head and the reviews on it. Read from the read model at evaluation time, never from an agent or a value planted on an item.
_Avoid_: PR status, CI result

**Read model**:
The six `gh_*` tables (`gh_repos`, `gh_issues`, `gh_milestones`, `gh_prs`, `gh_check_runs`, `gh_reviews`), one row per GitHub id, each with a classification and a freshness timestamp, written by one module from webhooks and the sweep.
_Avoid_: cache, mirror

**Sweep**:
The nightly repair that re-reads GitHub from a repository's watermark through the same upsert path the webhooks use, and records what it repaired.
_Avoid_: sync, backfill, reconcile job

**PR declaration**:
The fenced `harness` block that opens a PR body, naming `closes`, `risks`, `touches`, `risk_tier` and `risk_domains`. The body's first line is exactly ```` ```harness ```` and the block closes on a line that is exactly ```` ``` ````; prose follows it. It can raise an item's risk tier, never lower it. A body that does not open with the block, an unclosed block, a second harness-like fence or a declaration key line after the block, HTML markup starting `<!` or `<?`, an HTML character reference, a `<pre>` or `<code>` tag, or an unusual line break or NUL declares nothing.
_Avoid_: PR template, PR metadata

**Reviewer identity**:
A GitHub login listed as a Reviewer. Only its reviews on the head commit count toward the ship rule; a review by another login, or on an older commit, does not.
_Avoid_: reviewer account, bot reviewer

**Cross-reference comment**:
The one comment the harness leaves on an imported issue, linking it to its item. Exactly one lands, whether a webhook or the sweep imports the issue first.
_Avoid_: bot comment, backlink

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
The Home view and the wake for gates the current person can decide, their delegations that lapsed and were not renewed, and failed runs on items they hold or ran.
_Avoid_: inbox, to-do, notifications

**Presence**:
A person's open live session on one screen of a harness. A wake for that screen is suppressed. Only a person's own session counts, never an agent's.
_Avoid_: online, active

**Screen**:
The view a live session watches: `home`, `flow`, `board`, `gates` or `item`. An `item` session also names its item.
_Avoid_: page (that is a content page), route

**Zulip topic**:
The one topic per item, `<harness key>/<item ref>`, posted to in the area's channel and named on the item by `zulip_topic_linked`. A harness-level wake posts to the topic `<harness key>`.
_Avoid_: thread, stream

**Item ref**:
`<repository name>#<number>` for an item that wraps an issue, else `item-<first 8 hex of the item id>`.
_Avoid_: item key, slug

**Indicator**:
One named line of `/health`: a status from `ok`, `amber`, `red`, `not_configured`, `not_wired` and a short detail. The overall status is the worst indicator.
_Avoid_: metric, check (that is a CI job or a validator), alarm

**Token**:
One CSS custom property in `packages/ui/tokens/*.css`, the only source of a colour, size or radius.
_Avoid_: variable, style constant

**Shell**:
The page frame every screen renders inside: sidebar, top bar and content, fluid from phone width up.
_Avoid_: layout, chrome, template (that is a stage graph)

**Home**:
The app root, where "Waiting on you" lists what the person can act on, ranked.
_Avoid_: dashboard, inbox

**Flow view**:
One harness drawn as the BML diagram from its stage rows under the four brackets, with each stage's count, WIP, age and cost, live.
_Avoid_: pipeline view, diagram page

**Board**:
The screen with one column per stage and one card per item.
_Avoid_: kanban (the prototype's word), queue

**Card**:
The Board's rendering of an item.
_Avoid_: ticket, tile

**Agent plane**:
The indicators on `/health` about agents: spend, breaker, runs, delegations, gate refusals, agent writes, stale learnings and the GitHub sweep, each with a drill-through.
_Avoid_: ops dashboard, metrics

**Persona view**:
A persona page's default view: its dashboard, with runs and spend today, the escalation rate, gate refusals, its writes, where it runs, its last runs and its delegations, and Activate for an `admin`.
_Avoid_: persona page (that is the page itself), profile, agent card

**Drill-through**:
The list behind one indicator, filtered by `can()`.
_Avoid_: detail page, report

**Island**:
The browser code the bundle carries: the command forms and the live refresh. It calls the command API and the event read route, never the kernel.
_Avoid_: widget, client app, SPA

**Fragment refresh**:
Re-rendering `<main>` from the server after a wake, merged into the page without a reload.
_Avoid_: hot reload, polling (that is the hub's fallback)

## The repo and the build

**PRD**:
`docs/PRD.md`, the list of what v1 is: every requirement with a stable ID, the build order, the release criteria and the decision log. The list of work; there is no other.
_Avoid_: backlog, issues (they are history), roadmap

**Requirement**:
One row of the PRD with a stable ID such as `KN-13`. Scenarios, tests, commits and the progress tracker name requirements by ID.
_Avoid_: issue, ticket, story, task

**Spec**:
`prd/Harness v1 - Architecture.md`, the ratified design. The source of truth for how the harness is designed and why. Its Decisions table is where a design change is recorded.
_Avoid_: PRD (that is `docs/PRD.md`), design doc, RFC

**Plan**:
`prd/An App For Everything - Platform Architecture Plan.md`, Jesse's design for the whole platform. The harness sits one level below it and consumes its ACL, pages and topology.
_Avoid_: roadmap, vision (that is the Executive Brief)

**Build-order step**:
One of the eleven steps in PRD section 13. Each needs the ones before it; the progress tracker reports by step.
_Avoid_: milestone (the GitHub milestones M0 to M9 are history), phase (that is the plan's word for platform rollout), sprint, epic

**Verify**:
`pnpm verify`, the whole check chain, the same one CI runs.
_Avoid_: build, test (one part of it), lint (one part of it)

**Go-live wiring**:
The CI jobs, bindings and declarations that need an account or a secret (PRD FD-12). Written during the build, they skip or stay out of the deployed wrangler file until the resource exists.
_Avoid_: production setup, deployment config

**Platform**:
The whole product in `uw-platform`. The comparison called it "the shared harness"; in this repository a harness is one row.
_Avoid_: the shared harness, the system

**Shadow mode**:
A harness setting under which the ship rule is evaluated and recorded as an event on every head, and nothing is posted to GitHub and no connector runs.
_Avoid_: dry run (that is a persona check), read-only mode

**Check-only harness**:
A harness whose template activates only Check and Ship, joined by a repository requesting the Reviewer identity on a pull request.
_Avoid_: review service, opt-in review

**Merge delegation**:
A delegation whose capability word is `merge`: a person lends an agent the Ship exit on one harness, up to one risk tier, until an expiry, recorded.
_Avoid_: auto-merge, robot merge

**Fix claim**:
A claim the Builder takes on an item after a review round with findings, under a delegation whose capability word is `fix`, when no other claim is live.
_Avoid_: fix lane (the bench's word for a second writer)

**Untrusted content**:
Text that entered the platform from outside it: a pull request diff, an issue body, a review comment, and later a transcript or an invoice. Carried as data, never as instructions, and marked so at the boundary.
_Avoid_: user input, external text

**Clearance**:
What a principal may read at an instant: the set of areas its live grants let it read. A cache of model output keys each entry on the reading principal's clearance, so text one reader's prompt held never reaches a reader who could not have read it.
_Avoid_: security level, permission set (that is the grants themselves)

**Epic**:
A GitHub issue with sub-issues. Intake reads it as an ordered set of items with blockers.
_Avoid_: parent issue, milestone (that is a GitHub milestone)

**Done-when**:
The sentence in an issue that says what finished looks like. Intake refuses an issue without one.
_Avoid_: acceptance criteria, definition of done

**Holder**:
Who has the ball on an item right now: the claimant, the Reviewer, or a person waiting to decide.
_Avoid_: owner (that is the repository's), assignee

**Freeze**:
A harness setting under which Ship refuses every item except those a person named when setting it.
_Avoid_: code freeze, lock

**Finding weight**:
A Reviewer's rating of one finding as `real`, `plausible` or `theoretical`. Only the first two count toward a review round.
_Avoid_: severity (that is the finding's impact), confidence (that is a learning's label)

**Silence alarm**:
The health indicator that goes red when items wait in Check and no review step has run for 90 minutes.
_Avoid_: watchdog

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

**Delegated Ship exit**:
A merge delegation used: an agent holding one submits an item at a merge Ship stage, and the kernel records a gate decision whose approver is the person who granted the delegation, whose actor is the agent, and which names the delegation. The merge runs afterwards from the minute job.
_Avoid_: auto-merge, auto-approve, robot merge

**Protected path**:
A changed file a delegation never covers: one under the kernel's protected directories (which also raise the risk tier to `high`) or under a path the harness lists in `protected_paths`. Ship refuses a delegated exit that touches one with `protected_path_needs_person`.
_Avoid_: sensitive file, locked path
