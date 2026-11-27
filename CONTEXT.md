# unfoldingWord Platform: the harness

The vocabulary of the harness, the module of the unfoldingWord platform that runs work through stages with agents as governed coworkers and a person at every gate that has an effect on the world. One context; every document, module, test, issue and screen uses these words and no synonyms. Where a word is the platform's rather than the harness's, the Platform Architecture Plan section is cited.

## The pipeline

**Harness**:
One instance of the pipeline, built from a template, scoped to a JD area. The UI and conversation call it a **workflow**; the code says harness. The software harness lives in area 80 to 89; a BML harness lives in the area of the program whose product it serves.
_Avoid_: pipeline (that is the drawing), queue (that is a screen, the Queue), board (the Queue's old name), work queue (the plan's older name)

**Template**:
The stage graph a harness is built from. Two in v1: software delivery and the BML product flywheel. Same eight stages, different names, workers and connectors.
_Avoid_: workflow (that is a harness), process

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
A check picked by key from a registry and run at a `checks` gate; `fix_size_cap` and `fix_keeps_purpose` also run at every submit from a **fix claim**, whatever the stage's gate. `learning_attached` is the Close validator.
_Avoid_: linter, rule, test (validators run on items, tests run on code)

**Feeds**:
The loop edges on a stage row that let an item re-enter an earlier stage: the **regular tweak** from Close to Scope and the **occasional tweak** from Validate to Package.
_Avoid_: loop, back-edge, retry

**Draft**:
A private copy of a harness's stages that one area admin edits on the Flow tab. It is checked a few seconds after each change, by the same rules as `walk`, and nothing in it is live until it is published. One harness has at most one draft, a row of `workflow_drafts`.
_Avoid_: pending edit, staged change, copy

**Editing lock**:
The hold one admin has on a harness's draft. Others see who holds it and since when, and can watch the draft but not edit it. It lapses after 30 minutes without a save, and another admin can take it over at any time with a recorded reason; the draft's changes are kept either way.
_Avoid_: lease (that is an item's hold), checkout

**Publish**:
Applying a draft to the live stages in one transaction, once its check passes and the live stages have not changed since the draft was opened. It records a `stage_edited` or `stage_removed` per changed stage and one `workflow_published` with what was added, removed and changed, then deletes the draft. It is the only way a person changes a harness's stages.
_Avoid_: deploy, release, save

**Ship rule**:
The pure function that decides whether the Ship button is enabled. Inputs: GitHub facts about the head commit, the item's risk tier and domains, and the approver's principal. Output: advance, or a refusal from a closed set.
_Avoid_: merge check, policy, gate logic

**Risk tier**:
`low`, `standard` or `high` on every item, floored from the paths its diff touches and raised by the PR's declaration, never lowered. **Risk domains** name which protected areas it touches: `ledger`, `acl`, `infra`, `migration`.
_Avoid_: severity, priority (that is ordering), impact

## Who acts

**Person**:
A human principal with a Google login through Cloudflare Access and rows in the grants table. The only kind of identity that can be the approver of a gate decision.
_Avoid_: user, human (as a noun in code), approver (that is a role a person plays at one gate)

**Person status**:
`active`, `pending` or `disabled`. A sign-in from `@unfoldingword.org` starts `active`; any other starts `pending` and is refused at the edge until an org admin **approves** it (to `active`) or **declines** it (to `disabled`). A disabled person is refused at the edge whatever grants they hold, and an org admin can approve them later. Each decision writes a `person_audit` row.
_Avoid_: banned, blocked, suspended (that is what Google Workspace does to an account), invited

**Person page**:
The one page for a person: the **row page** of their **directory entry**, at `/collections/directory/rows/<id>`. It shows the directory fields the reader may see, the **profile body**, and read-through lists of their open tasks, the programs and projects they lead, manage or are on the team of, and the pages they own, each only from areas the reader can read. A person, never an agent, opens it when they can read the directory's area (`00-09`) and the person is `active`, which is exactly when the directory lists them. Anyone else gets Not Found, so the page never says whether the person exists.
_Avoid_: profile, profile screen, user page

**Profile body**:
What a person writes about themself on their **person page**: a page of type `profile` in `00-09` that their **directory entry** points at, created the first time it is saved. Only the people module writes it, through `save_profile_body`, for the person themself or an `admin` on `10-19`; the page editor and `update_page` refuse it.
_Avoid_: bio, about page

**Person chip**:
How a person is shown wherever the app names one: their initials and display name, linking to their **person page** when the reader may open it and plain text when they may not. An agent identity is not a person and never gets one.
_Avoid_: avatar, user badge, mention (that is a link written in a page body)

**Waiting for access**:
A person who has signed in and can reach nothing yet: pending, or active with no live grant. Listed on the **Access** screen for an admin.
_Avoid_: new user, unassigned, guest

**Access** (the screen):
Where grants are seen, given and revoked, under 30-39 Infrastructure. An org admin sees every grant; an area admin sees and manages the grants on their own areas; anyone sees their own. "Cloudflare Access" is always written in full, so the bare word means this screen.
_Avoid_: permissions page, user management, directory (that is the 10-19 module)

**Principal**:
The structured identity minted at the edge for every request: a person or agent id plus their resolved grants. It travels with every call, queue message and MCP invocation.
_Avoid_: session, token, actor (actor is the field name on an event, and holds a principal's id)

**Grant**:
One row of `role_grants`: a role (`admin`, `editor`, `viewer`) at a scope (the org, or one JD area), optionally expiring. `can(actor, verb, resource)` is the one function that reads them.
_Avoid_: permission, role (a role is one field of a grant), ACL entry

**Read rule**:
Who reads a row of a `restricted` or `sensitive` table, declared per table in `rowReadRules` (`packages/core/acl.ts`): the least role on the row's own JD area, whether the person the row belongs to reads it, and whether an org admin does. `can(actor, 'read', row)` is the one function that applies it; an `org` viewer or editor never satisfies it (ADR 0017).
_Avoid_: row-level security, policy, classification check

**Credential**:
A secret that belongs to one JD area's work (a partner API key, a portal password, a funder system login), held for that area and not for a person. The secrets the platform itself runs on are platform secrets, not credentials.
_Avoid_: secret (that is the value, or a platform secret), key, password, token

**Credential capability**:
What a principal may do with one credential, asked as `can(actor, capability, credential)` and never as `read`: `see` (know it exists, never its value), `use` (have a connector use it without seeing it), `reveal` (see the value) and `manage` (create, rotate, revoke, bind, give a reveal grant). Each needs a grant on the credential's own JD area; an org admin has `see` and `manage` only, and an org editor or viewer has none. An agent has `use` and nothing else (ADR 0018).
_Avoid_: credential permission, secret access, credential role, read (a credential is never read through a page read)

**Reveal grant**:
A person's time-limited leave to `reveal` one credential, given by a person who may `manage` it. It always expires, names one credential and one person, and adds to a grant on the credential's area without replacing it.
_Avoid_: reveal permission, break-glass (that is a reveal outside the grants, given by an org admin and confirmed by a second person), share

**Break-glass reveal**:
A reveal grant given by an org admin who is not an admin of the credential's area. It is not live until a second person who may `manage` the credential, never the one who gave it, confirms it; both are recorded on the grant and in the credential access log, and its time starts when it is confirmed (ADR 0021).
_Avoid_: emergency access, override (a gate has one), second approval (a gate is approved)

**Reveal notice**:
The web push sent to every admin of a credential's area, other than the person revealing, each time its value is revealed. It names the area and the reason and never the credential.
_Avoid_: wake (a wake names a workflow), alert, reveal email

**Credential binding**:
The workflow and connector a credential may be used from. `use` is refused anywhere else, whatever grants the principal holds.
_Avoid_: binding on its own (a service token has one too), attachment, scope (a scope is the org or a JD area on a grant)

**Credential reference**:
How a caller names a credential it wants used: the credential's id and nothing else. A connector passes one to `useCredential` with the workflow and connector of the use; it never holds the value outside the one call the store opens it for (ADR 0020).
_Avoid_: credential handle, secret reference, credential key, token

**Secret**:
In code, the wrapper a credential's opened value travels in (`Secret` in `apps/uw-platform/credentials/secret.ts`). It shows `[secret]` wherever it is printed, serialised or logged, gives its text only to `exposeSecret`, and is spent when the call it was opened for ends.
_Avoid_: secret for a credential (that is the thing stored), plaintext, raw value

**Credential version**:
One row of `credential_versions`: one sealed value of a credential. Rotating a credential adds a version and never changes one; the highest version is the one in use.
_Avoid_: revision (a page has those), secret version, key version

**Data key**:
The 256-bit key that seals exactly one credential version with AES-256-GCM. It is stored only wrapped, beside the ciphertext it sealed, and exists unwrapped only in memory while a value is sealed or opened.
_Avoid_: key on its own, credential key, DEK

**Key-encryption key**:
The AWS KMS key that wraps and unwraps every data key. It never leaves KMS, so a copy of the database alone opens nothing.
_Avoid_: master key, KEK, root key, the KMS credentials (those are a platform secret that signs requests to KMS)

**Encryption context**:
The facts a sealed value is bound to: its credential, its version and its JD area. KMS refuses to unwrap a data key under a different context, and the cipher refuses to open the value under one.
_Avoid_: additional data, AAD, tags

**Credential access log**:
The rows of `credential_access_log`: every create, rotate, revoke, bind, unbind, use and reveal of a credential, and every reveal grant given, confirmed or revoked, done or refused, with the actor, the run, the workflow and connector of a use, and the trace id. Append-only and kept seven years.
_Avoid_: audit log on its own, grant audit (that records grants), history

**Final check**:
The second time a credential's access is decided, after the key service has answered and before the value is returned or a sealed value is written. It runs in one transaction that locks the credential row, reads the credential, its bindings, its reveal grants and the person's role grants again at a fresh time, and writes the access log row. The final check decides; the first check only saves a call to the key service (ADR 0019).
_Avoid_: recheck, revalidation, double check

**Grant audit**:
One row of `grant_audit`: who granted or revoked which grant, when, the row before and after, and the trace id. Append-only.
_Avoid_: access log, history

**Persona**:
A job an agent does, defined as configuration: an identity, a harness subscription, an instructions page, a toolset picked from the verb registry, a run shape and an engine. Three jobs in v1: Builder, Reviewer, Iterate. A persona is a page of type `persona`; it runs only once **activated**. The template fixtures hold five: `agent:builder` (external run), `agent:builder-hosted` (workflow run on `claude-code-sandbox`), `agent:reviewer`, `agent:reviewer-codex` (a second Reviewer on `codex-sandbox`) and `agent:iterate`.
_Avoid_: agent (an agent is the identity a persona runs as), bot, worker, role

**Activation**:
A person with `admin` on the area turning a `suggested` persona or measure page `active`, at the version they saw: a persona after the tool check and the **dry run**, a measure after its **trial run**, or a measure paused for any reason but retirement, when the person activating it becomes its activator. The only way a persona or a measure runs. For a persona it flips the page's status, writes the `personas` projection and records `persona_activated` in one transaction.
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
The fenced `harness-scout` block that opens the answer of a scout step: the premise holds or is held, with a one-line reason. Anything else is a held premise.
_Avoid_: scout result, triage outcome

**Delegation**:
A row that lets unattended work run: a person holding `admin` on the harness's area grants a persona one capability word for a bounded time. Every **beat** (an unattended claim, on any host) presents a live delegation or is refused.
_Avoid_: schedule, cron, impersonation, service token (that is how a routine authenticates; the delegation is what lets it act)

**Lease**:
The time-boxed hold an agent takes on an item at claim, renewed by every run step and released on expiry. A person's claim has no lease.
_Avoid_: lock, assignment (a person is assigned; an agent holds a lease), checkout

**WIP limit**:
The maximum number of items a stage may hold at once, applied to people and agents alike, and the maximum number of rows one Board group may hold.
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
One implementation of a port. A **platform adapter** lives in `apps/uw-platform/ports/` and reaches the real service; a **test adapter** lives in `sim/adapters/` and is scripted or records what it was asked. The Store and Grants adapters bind the one Drizzle implementation in `packages/db/store/`, so both run the same queries. An adapter whose service is built in a later step is **not wired**: every call rejects with `PortNotWiredError`, which the kernel reports as the refusal `not_wired`.
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
The fenced `harness-verdict` block that opens a review run's answer: approve or request changes, then the findings.
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
The remote MCP server inside `uw-platform` that serves the verb registry. The only way a persona touches the platform, on either host.
_Avoid_: API (that is the command API people use), agent API, gateway

**Command**:
An action a person takes on the harness through the command API: kickstart, enqueue, import, reorder, claim, release, submit, approve, reject, take over, override, prompt run, stop run, pause, resume, tweak package, schedule regular tweak, revoke delegation, recover connectors, and the stage command: activate template, create, update, reorder and remove stage; and set hosted Builder. Every command carries a `requestId` and returns `accepted` or `error`.
_Avoid_: verb (that is the agent's word), action, mutation, endpoint

**Person surface**:
The command handlers that decide gates, edit stages and grant or revoke delegations: `apps/uw-platform/commands/person/`. Only a person's command reaches them; nothing the MCP surface reaches imports them.
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
One row of `gate_decisions`: a person's approve, reject, take over or override at a gate, with reason and evidence, kept seven years. Written only by a human principal, inside a transaction that locks and re-reads the approver's grants, or by the delegated Ship exit with the granting person as approver (ADR 0010).
_Avoid_: approval (that is one kind of decision), sign-off, review

**Learning**:
A page of type `learning`: a measured fact or working rule with a confidence label (`observed`, `confirmed`, `inferred`, `assumed`), an as-of date and what it supersedes Close refuses an item that attaches neither a learning nor a signed `nothing_learned`.
_Avoid_: note, insight, lesson, memory (the plan's phrase is institutional memory; a learning is one unit of it)

**Confirmation**:
A person turning a `suggested` learning, skill, policy, charter or decision page `active` at the version they read, with `write` on its area. Agents cannot confirm. A persona is not confirmed but activated.
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
_Avoid_: event (that is a row of `harness_events`), message (the message queue's word for the transport), job

**Page type**:
One entry of the page-type registry in `packages/contracts`: a frontmatter schema, a classification and an offline eligibility. The types are listed in `packages/contracts/page-types.ts`; the frontmatter of a collection row type is checked by its collection's definition.
_Avoid_: template (that is a stage graph), kind, category (that is where a knowledge page is filed)

## The knowledge base

**Page**:
A row of `pages`: a type, an area, a title, typed frontmatter and a markdown body, saved as numbered versions. The markdown is the record; everything else about a page is drawn from it.
_Avoid_: document, doc, note, article, block

**Knowledge page**:
A page of type `knowledge`: a wiki page a person reads. It is filed in a **category**, may carry a JD ID, an owner, tags and aliases, and is what "Pages & Wiki" lists.
_Avoid_: wiki page, article, doc

**Category**:
Two digits, such as `61`: the Johnny.Decimal level below an area, and where a knowledge page is filed. The page's area is the category's decade, so `61` is in `60-69`.
_Avoid_: folder, section, collection, space

**Page file**:
A picture, video or other file stored with one page, in the `uw-files` bucket, and read only through `/api/files/:fileId` by someone who may read the page's area. A person adds one by pasting or dropping it in edit mode; an agent adds one with `attach_file`. The page body embeds a picture or a video as `![name](/api/files/:fileId)`; the read view draws a video with player controls.
_Avoid_: attachment (alone), asset, upload, media

**Cluster**:
Two or more areas shown as one group in navigation, such as `60-79 Field Programs` over `60-69` and `70-79`. A cluster holds no pages and takes no grant; each of its areas does.
_Avoid_: area (a cluster is not one), super-area, range

**Read view**:
What `/pages/:pageId` shows: the page's last saved version, rendered below a tinted band that holds its title, facts and actions, with no field that can change it. Every page opens here.
_Avoid_: preview, view mode, published view

**Page tree**:
The branch of the sidebar under "Pages & Wiki" on wiki and knowledge page screens: the areas a person may read, the categories of the area they are in, and the pages of the category they are in.
_Avoid_: file tree, outline, navigator, explorer

**Edit mode**:
What `/pages/:pageId/edit` shows to a person who may write the page, reached by Edit: the read view's own frame and layout, with the title and text turned into fields where they stood and the band's actions replaced by Cancel and Save. Nothing on the page moves on the way in or out (ADR 0029). Leaving it asks first when what was typed is not in a working draft. Nothing in it reaches the read view until Save.
_Avoid_: editor (that is the Milkdown Crepe component inside it), editing view, focus mode

**Working draft**:
The unsaved text of a page in edit mode, shared live by everyone editing it and held by the page's **sync hub**. Save publishes it as one version; Discard throws it away.
_Avoid_: draft (alone, that is the Flow tab's private copy of stages, or the page status `draft`), autosave, revision

**Sync hub**:
One Durable Object per page version being edited (`PageDraft`), holding its working draft as a Yjs document and passing changes between the people in edit mode. It is not the record: the saved markdown is. A new version gets a new sync hub, so a working draft always starts from one saved version.
_Avoid_: live hub (that sends wakes for a harness and holds no data), collab server, room

**Verification**:
A person's statement, on a knowledge page, that they read it and it is still right, with the date it holds until. After that date the verification has **lapsed**: the read view says so and the page is on the "Needs review" list.
_Avoid_: approval (that is a gate decision), review (alone), sign-off

**Template**:
A knowledge page tagged `template`. A new page can start from its text; the template itself is an ordinary page. A policy whose enforcement is `template` is a **template policy**, not a template in this sense.
_Avoid_: blueprint, boilerplate

**Favourite**:
A page a person marked for themselves. Only that person sees it, on "Pages & Wiki".
_Avoid_: bookmark, star, pin

**Comment**:
A reader's note on a page, kept beside the page and not in its text. Anyone who can read the page can comment; its author or an editor of the page's area resolves it.
_Avoid_: note, annotation, thread

**Quick Switcher**:
The dialog Cmd/Ctrl+O opens on any screen: type part of a title, a JD ID or an alias and go to that page. It matches titles only; searching the text of pages is **search**.
_Avoid_: command palette, omnibox, spotlight, launcher

**Search**:
Full-text search over the title and body of the pages a person may read, title weighted higher. One reader serves the search screen, the JSON route and the agent verb `search_pages`.
_Avoid_: find, lookup, query (that is the text a person typed)

**Wiki link**:
`[[Page title]]` as typed. On save the server resolves it to a link that carries the target page's id, so a rename breaks nothing. One that names no page yet stays as typed and offers to create the page.
_Avoid_: mention, internal link, reference

**Backlink**:
A page that links to this one, read from `page_links`.
_Avoid_: reference, incoming link, linked mention

**Embed**:
`![[Page title]]` or `![[Page title#Heading]]`: another page's saved text, or one section of it, shown in place and edited only at its source. Access is checked for the reader.
_Avoid_: transclusion (in the UI; the design documents use it), synced block, include, snippet

**PDF export**:
A PDF printed from the platform's own HTML by Cloudflare Browser Run (ADR 0028). Any screen prints with `?format=pdf` and streams back at once; a **binder**, or an export the agent verb `render_pdf` asks for, is a row of `pdf_exports` with its file in the `uw-files` bucket, downloaded only through `/api/exports/:exportId/file` by a signed-in person who may read every area it covers, for seven days. A PDF is an output, never a record: the page version or view it was printed from is.
_Avoid_: report (that is a page or a view), printout, document, snapshot (that is a page version)

**Binder**:
An ordered set of pages printed as one PDF export, with a cover, a contents list and continuous page numbers. It is named by a titled list of up to fifty pages, or by a root page with the pages under it, depth-first. A page the requester may not read is left out, as a missing one is. A binder always prints in the background (`PdfExportRun`) and opens at `/exports/:exportId`.
_Avoid_: document set (the plan's word), packet, bundle, book, document

**Provenance footer**:
What every PDF export says about where it came from: the running footer's short line (reference, export date, the first twelve characters of the source sha256, page n of N), and the full Provenance block that closes the body: source address, reference, filters, who exported it, the date and the whole source sha256. The source sha256 hashes what was printed from, never the file; the file sha256 is the hash of the PDF bytes, recorded for a stored export and sent with every download. For a page the reference is `<area>/<slug>@v<version>` and the source sha256 is recomputable from that version in `page_versions`, over the fields shown to the exporter; for a saved view it is `<collection>/<view>` with the filters in words and a source sha256 over the view, its settings, the place and the rows printed.
_Avoid_: watermark, stamp, signature (nothing is signed), checksum (alone)

**Print stylesheet**:
`packages/ui/print.css`, the part of the app stylesheet that applies only on paper: light tokens whatever the theme, controls and anything marked `data-pdf-hidden` left out, table headers repeated on each page, and nothing split across a page that should stay whole. Paper size and margins are tokens (`--uw-print-*`).
_Avoid_: print theme, PDF CSS

## Collections

**Collection**:
A stored definition that lists pages or typed records as rows and lets them be queried and shown in saved views: a row of `collections` with its properties. A **page collection** lists pages (each page names its collection in `pages.collection_id`); a **record collection** lists the rows of a typed table (`tasks`, `people`). Built-in collections (tasks, directory, portfolio, program, project, OKR, resources) are seeded through the same path an area admin uses (ADR 0023).
_Avoid_: database (Notion's word, and Postgres is the database), table (that is a layout, or a Postgres table), list (that is a layout), category (that is where a knowledge page is filed)

**Row**:
One page or record a collection lists.
_Avoid_: record (alone, that is the typed table row behind it), entry (that is the page type of an admin-made collection's pages), item (that is a harness's unit of work)

**Property**:
One typed field of a collection: a key, a name, a type from the **property catalogue** (title, text, number, select, multi-select, status, person, date, date range, URL, email, phone, checkbox, files, relation, rollup, computed, read-through), a **property source** (a frontmatter key, a column of the record table, a relation, a computed value, a read-through feed, or a system field) and a classification.
_Avoid_: field (in prose; the column of a record table is a column), attribute, column (that is a table layout's rendering of a property)

**Definition**:
A collection's properties and settings, versioned: each change advances the collection's version and keeps the whole definition in `collection_versions`. Only a person with `admin` on the collection's area changes it, and not while it is **locked**.
_Avoid_: schema (that is Drizzle's), configuration

**Status group**:
One of the three groups a status property's options fall into: to-do, in progress and complete. Filters and boards can use the group as well as the option; the time a row entered its complete group is a system property.
_Avoid_: group (alone, that is a saved view's grouping), phase, stage (that is a harness's)

**Rollup**:
A property that reads another property across a relation: count, sum, show unique or percent complete.
_Avoid_: lookup, aggregate, formula

**Computed property**:
A property worked out from others of the same row from a closed set: sum, difference, count, date until. There is no formula language.
_Avoid_: formula, calculated field

**Read-through property**:
A property whose value is read from another module and never stored or written by a collection: the money on a program or project (from the budget module's views) and a program's Sage Intacct program ID. Until the budget module serves a feed it reads `not_wired`.
_Avoid_: money property, linked field, synced property

**Property rule**:
A property's classification narrower than its row, with who reads it: a steward area and the least role on it, and whether the row's own person does. A reader without it gets no value, a refused filter, sort and group, and nothing from a rollup over it (ADR 0024).
_Avoid_: field permission, column security, read rule (that is a whole table's)

**Saved view**:
A named way of showing a collection: a layout, the properties shown with their widths, a filter, sorts and a group, stored as normalized rows. A **shared view** belongs to the collection; a **personal view** to one person.
_Avoid_: view (alone, ambiguous with the read view and the gate view), report, filter (that is one part of it), board (that is one layout)

**Layout**:
How a saved view draws its rows: **Table**, **Board**, **List**, **Gallery**, **Calendar** or **Chart**. "Board" names only this layout; the harness screen is the Queue.
_Avoid_: view type, display, kanban (the prototype's word)

**Filter**:
A tree of conditions and nested and/or groups on a saved view, compiled to SQL on the server. A condition may name a **relative value**: `me`, `today`, or a past or next count of days, weeks, months or years.
_Avoid_: query (that is the text a person typed into search), where clause, rule

**Group**:
A saved view's grouping of rows by one property, and one value of it: a Board column, a Gallery section. Each group has an order, may be hidden, and on a Board may carry a WIP limit.
_Avoid_: column (a table's), lane, swimlane, bucket, status group (that is a status option's group)

**Card order**:
A saved view's manual order of its rows, one fractional text key per row and view, so two Boards grouped differently never fight over one order.
_Avoid_: rank, position (alone), sort (that is by a property)

**Row page**:
What a row opens to: its properties in sections, empty ones hidden where the definition says so, a relations panel, then the page body and comments.
_Avoid_: record page, detail view, profile (that is a person's directory row page)

**Row template**:
A named starting point for a new row in one collection: property values and a body. A saved view names its default.
_Avoid_: template (alone, that is a stage graph or a knowledge page tagged template), blueprint

**View embed**:
`![View name](/collections/<key>/views/<view id>)` on a line of its own in a page's body: a saved view drawn in place for the reader, checked on both the page and the view, so an embed never widens access. The cached rendering holds only a placeholder; the rows are read for each reader.
_Avoid_: inline database, linked view, embed (alone, that is another page's text)

**Task**:
A row of `tasks`: a unit of a person's work in a JD area, with a status, assignees, priority, tags, a due date, an optional parent page and a source. Listed by the tasks collection.
_Avoid_: item (that is a harness's), to-do, ticket, card

**Directory entry**:
The directory fields of one person (role, team, employment, joined date, contact details, compliance), a row of `directory_entries` owned by the people module. The directory collection lists people with these fields; a person's row page is their profile (ADR 0025).
_Avoid_: profile record, contact, employee record

## The two axes

**Johnny.Decimal index**:
The organization's filing scheme: areas (`00-09`), categories (`00`) and IDs (`00.01`), with the name of each. The index `00.01 unfoldingWord Index (Johnny.Decimal)` is the one source of truth for every number and name; the platform's areas, category names and module numbers follow it. It answers where a thing is filed.
_Avoid_: JD tree, taxonomy, folder structure

**Strategic Cascade**:
The organization's purpose axis: Purpose, Objective, Principles, Portfolio, Program, Project and Task. It answers why a thing exists. Neither axis is derived from the other.
_Avoid_: hierarchy, org chart, strategy tree

**Cascade node**:
A page that is a place in the Strategic Cascade: a page of type `portfolio`, `program` or `project`, kept by its built-in collection.
_Avoid_: strategy item, initiative

**Cascade tier**:
The level of a cascade node: `portfolio`, `program` or `project`, the page's type. The crosswalk has one column per tier.
_Avoid_: level, rank

**Placement**:
Where an entity sits in the Strategic Cascade: one cascade node named for one page, task or item, a row of `cascade_placements`. An entity's area and its placement are two separate facts, set separately. A cascade node is placed by being one, at its own tier.
_Avoid_: cascade field, portfolio select, tag

**JD map**:
The explicit, many-to-many map from areas to cascade nodes, rows of `jd_cascade_map`. Each row says how one area relates to one node, as one **map relation**: `owns`, `supports`, `funds` or `reports_on`. An org admin declares or removes a row, and every change is kept in `jd_cascade_map_audit`.
_Avoid_: mapping table, link, crosswalk (that is the screen)

**Crosswalk**:
The screen at `/crosswalk` that shows both axes at once: areas down, cascade tiers across. Each cell counts the pages, tasks and items in that area placed at that tier, and lists the JD map relations between the area and that tier's nodes. A cell opens the entities it counts; a node opens every area it touches. It counts only areas the reader can read.
_Avoid_: matrix, pivot, JD/cascade report

**Policy**:
A page of type `policy`: a rule that binds work at one **policy level**, with an **enforcement**, what it supersedes, and the dates it holds from and until. It applies to the whole organization or to one cascade node or product page (`applies_to`); its level is that page's type, never typed separately. An agent's policy lands `suggested` and only a person confirms it.
_Avoid_: rule (alone), guideline, setting

**Policy level**:
Where a policy binds: `organization`, `portfolio`, `program`, `project` or `product`. Not a cascade tier: the organization and products are policy levels but not cascade nodes.
_Avoid_: tier (that is the cascade's), scope (that is a grant's)

**Enforcement**:
How a policy binds below its level. `required` holds whatever a descendant says; `default` holds until a descendant supersedes it; `template` is a starting text to copy, not an obligation in force.
_Avoid_: severity, strength, mandatory/optional

**Policy resolution**:
Working out the policies in force for an entity on a date: walk its **policy chain**, product, then its placement's node and that node's parents, then the organization; keep each policy in force on that date; drop a `default` that a policy further down supersedes; keep a `required` one whatever supersedes it, and record the attempt as a **policy conflict**. A supersession from the same level or above changes nothing and is a conflict too. The pure function is `resolvePolicies` in `packages/harness/policies/`; a policy's page and the Policies screen show its conflicts.
_Avoid_: inheritance, cascade (that is the axis), merge

**Template copy**:
A policy made from a template policy, whose `copied_from` names the template page and the version copied. Its text is its own: a later change to the template reaches it only when a person adopts it, as one new version.
_Avoid_: instance, clone, inherited policy

**Template drift**:
A template copy whose template has a newer version, or is retired or gone. Listed on the Policies screen and worked out by `templateDrift` in `packages/harness/policies/`.
_Avoid_: out of sync, stale copy

**Charter**:
A page of type `charter` in the NISO format: level-two headings Need, Idea, Strategy, Outcomes, Risks and Roadmap, in that order, so any level's charter can be read by a machine. A save without them is refused with `sections_missing`. It names the node or product it charters, or none for the organization.
_Avoid_: brief, proposal, one-pager

**Decision page**:
A page of type `decision`: level-two headings Context, Decision and Consequences, the date it was decided, what it applies to and what it supersedes. `resolve_context` answers the decision pages on an item's policy chain that the caller may read, most specific and then newest first, leaving out any a later decision page supersedes. Not a **Decision** (an entry of `docs/decisions.md`).
_Avoid_: ADR (that is a Decision), ruling, minute

**Suggestion set**:
A whole proposed new title, properties and text for one page over a base version, waiting for a person: a row of `page_suggestion_sets` (ADR 0035). Agents made them before review sets; none is made now, and those still pending are decided as before: a person accepts one as one new version or rejects it, and once decided it never changes. A set whose base is no longer the page's version can only be rejected.
_Avoid_: draft (that is a working draft), revision, proposal, pull request

**Suggested change**:
One proposed edit inside one page version, waiting in a **review set**: an insertion, a deletion, a replacement or a comment, anchored to a span of the base version's text by its start and end offsets and by a quote of that text with up to 32 characters either side (ADR 0037); the offsets span exactly the quote. Where the offsets no longer hold, the quote finds the span again; where the quote is gone or appears more than once, the change is **orphaned** and nothing is guessed. A row of `page_suggested_changes`. A comment changes no text.
_Avoid_: revision (that is an Iterate run's draft page), edit, patch, annotation, tracked change (that is Word's)

**Review set**:
A named group of suggested changes over one base version of one page, such as "Board review 2026-12-01", accepted or rejected as a whole: a row of `page_review_sets`. Accepting applies every change in one save, under the rules of an ordinary edit (an issue mirror refuses it; an active measure or dashboard returns to suggested), making exactly one new version and one row of `page_review_decisions`; rejecting makes the row and no version. Only a person who may write the page decides, and a set whose base is no longer the page's version can only be rejected. An agent's save to an active decision page, policy, charter or impact story becomes one, worked out word by word, and each agent holds at most one pending set per page, which its next save replaces; an agent's save to any other active gated page is refused, because that type has its own path (a person confirms a skill, persona or learning whole; a measure or dashboard is trialled and activated again; the platform page is a person's alone). The review set screen shows each readable property it would change, with its value now and the value proposed. Changes in one set never overlap.
_Avoid_: suggestion set (that is the older whole-page set), change request, changeset, batch, pull request

**Marked export**:
A page's markdown export in `marked` mode: the current version's text with the suggested changes of its pending review sets written in CriticMarkup (`{++ ++}`, `{-- --}`, `{~~ ~> ~~}`, `{== ==}{>> <<}`), which reads back into the same suggested changes. The other modes are `accepted`, the clean current text and the default, and `original`, the stored text the marks are over. Delimiters in the page's own text, a proposed text or a note are escaped with a backslash, so the text and the changes read back exactly. Every export is stamped with `source` (`slug@version`), `exported`, `sha256` (of the stored version, as in a provenance footer) and `mode`, and a marked export also with `changes_sha256` (of the suggested changes it carries); `verifyExport` checks a file against the stored version and the stored changes. A marked export pasted back on the review set form is taken only when its stamp names this page at the open version and its text under the marks is the stored text.
_Avoid_: redline (that is the PDF mode, not built), tracked changes, diff

## Charts

**Chart spec**:
What a chart is, declared rather than drawn by hand: a type from a closed set (bar, line, stacked area, graph, or a two-column graph), one **chart query** with its typed parameters, its encodings (the column on x, the columns on y, an optional column that splits the series, which then allows one column on y, and for a graph the column its edges point to and, for a two-column graph, the column that groups their targets) and its formatting (`YYYY-MM-DD` dates, counts, days, percents, or money in minor units with its currency). Validated by Zod in `packages/contracts/chart-spec.ts` and drawn on the server to SVG. A **standard chart** is a chart spec defined once by key, such as `cumulative_flow`.
_Avoid_: chart config, widget, panel (that is a dashboard's), view (that is a collection's)

**Chart query**:
One entry of the whitelist a chart spec may name, by key: its parameters' schema, its columns and its source, run under the reader's access. A spec naming any other key is refused with `chart_query_not_allowed`; there is no free query.
_Avoid_: data source (that is a Package page), report query, SQL

**Lineage**:
What every drawn chart says about its rows: the source, the chart query, the as-of time, the filters, the rows left out with a count per closed-set reason and, where the reader may see them, the entries themselves, whether its history read was capped and at how many of the newest events, and, when its source is behind or unreadable, since when. A downloaded SVG or PNG carries the source, as-of time and filters under its picture. A stale source is drawn with a note, never as a short series passed off as whole.
_Avoid_: provenance (that is a page export's footer), metadata, audit trail

**Data-quality note**:
The lines a chart draws under its picture and shows on its screen for what its **lineage** left out: each ambiguous entry with the people it could name (the first 20 by name, and a count of the rest), each unresolved entry, each entry on a retired page or a page the reader cannot read, and a count of the rest. Ambiguous entries are left out and listed, never guessed (ADR 0039).
_Avoid_: quality report, warnings, errors

**Commitment**:
A person's commitment to a colleague, a row of `person_commitments` owned by the people module: from one person to another person by id, or to a text such as a name copied from prose. A text is resolved each time a chart is drawn, by full name, loose name or a unique first name; two or more matches make it ambiguous and none makes it unresolved (ADR 0039).
_Avoid_: CLOU (the reference dashboard's word), relationship, link

**Staff allocation**:
A person's share of time on exactly one program or portfolio, a row of `staff_allocations` owned by the people module, with a whole percent from 0 to 100 or none when it is not known ("unspecified"). Written only by the directory steward (`admin` on `10-19`) or an org admin.
_Avoid_: assignment, FTE, capacity

**Team Charts**:
The screen at `/team-charts`, beside the Colleague Directory, that draws the commitments network, staff allocation, and people and portfolios as **standard charts** of the chart spec, each with its data-quality note, rows and downloads, and prints as a PDF. A graph's nodes are people and pages by id, labelled by name, so two colleagues or two programs with one name are two nodes. The directory steward chooses whose commitments to edit there (`?person=<id>`); a colleague edits only their own.
_Avoid_: org chart, team dashboard

## Measures and dashboards

**Resource**:
A measured thing with a stable address, such as a website or a mobile app: a page of type `resource`, a row of the built-in Resources collection.
_Avoid_: asset, property (that is a collection's typed field), site (alone; a site is one kind of resource)

**Serves**:
The relation from a resource to the portfolio, program and project pages it belongs to, kept as three properties of the Resources collection (`serves_portfolio`, `serves_program`, `serves_project`) and read from the other side as a backlink. It is how a report card finds the pages it is shown on. Product pages are not served in the first version.
_Avoid_: belongs to, linked project, owner (that is a person)

**Measure**:
A page of type `measure` that says how to measure a set of resources: a pinned tool and its command, a saved view of resources, a schedule, the values kept, an optional **failure path** and the metrics worked out from them. An agent saves one with `save_measure`. It runs only once **activated** (ADR 0036).
_Avoid_: collector, probe, job, check (that is a validator's), data source (that is a Package page)

**Failure path**:
The JSON pointer in a measure where its tool reports a failure while still exiting 0, such as `/error` for `geo audit`. Anything there but null, false or empty text makes the observation failed, with no values.
_Avoid_: error field, status path

**Trial run**:
A measure's tool run once on up to three of its resources, started by a person with `admin` on its area with Run trial, keeping only the trial's own record, its observations and the dependency lock. It runs the tool for real, unlike a **dry run**.
_Avoid_: dry run (that is a persona's, and runs nothing), test run, preview (that is `preview_dashboard`)

**Tool hash**:
The SHA-256 of a measure's runtime, package, command and resources. A trial counts for activation only at the current tool hash, so changing any of them needs a new trial.
_Avoid_: version (that is the page's), lock (that is the resolved dependencies)

**Measure run**:
One scheduled or requested run of an active measure over its resources, done as its activator, a row of `measure_runs`. It starts only into one of the four sandbox slots, as a trial does, and waits `queued` until one is free; once started, one that makes no progress for an hour is closed as `stalled`.
_Avoid_: run (alone, that is a hosted agent run), job, sync

**Observation**:
What one measure run recorded about one resource: the values, the raw output and its hash, and an outcome, a row of `observations` read through the measures module. A failed observation keeps its reason and is never counted as zero.
_Avoid_: data point, sample, result, row (that is a collection's)

**Metric**:
A named figure read from observations by a rule from a closed set (latest, previous, change, average, minimum, maximum, count or share meeting a condition, value over time), with a unit and an optional target.
_Avoid_: KPI, formula, computed property (that is a collection's), indicator (that is health's)

**Dashboard**:
A page of type `dashboard`: panels over metrics for one context, saved by an agent with `save_dashboard` and made active by a person. Home, Agent Queues, the persona view and the Measures screen are screens, not dashboards; the seeded area home "00 Dashboard for unfoldingWord" is a knowledge page, not a dashboard.
_Avoid_: report (that is an export or a compliance artifact), board (that is a layout)

**Dashboard context**:
The saved set of resources a dashboard describes: the organization, a page with or without its descendants, a named set, or the page it is shown on. It selects; it never grants access.
_Avoid_: scope (that is a grant's), filter (that is a saved view's)

**Panel**:
One fenced `panel` block of YAML on a dashboard, written by the platform, of a kind from a closed set: figure, bars, table, trend, list or status.
_Avoid_: widget, tile, chart (a chart is drawn by a panel), card (that is the Queue's)

**Report card**:
The dashboard a measure names to be shown, with the host page as its context, in the Measures section of every page its resources serve.
_Avoid_: scorecard, summary, embed (alone, that is another page's text)

## Story Bank

**Impact story**:
A page of type `impact_story`: one account from the field, filed under its area's `xx.96` home, tagged with a country, a region and languages as codes and with the pages it illustrates. Its sensitivity level and its consent record live beside it in the stories module, never in its frontmatter, so no page save can change them. An agent's save lands `suggested` (ADR 0040).
_Avoid_: testimonial, case study, anecdote, story (alone, in code)

**Story record**:
The parent of everything said about one impact story: the `impact_story` page, whose title is the story's name and whose frontmatter holds who, when (`occurred_on`), where (`place`, `country`, `region`), in which languages and for which programs (ids of program pages its writer may read). Its consent record and sensitivity level hang from it. Its body is the staff summary and research notes, not a telling; the story is told in its expressions (ADR 0041).
_Avoid_: master story, canonical story, story page (alone, any page is a page)

**Story expression**:
One telling of a story in one format and venue: a social post, a newsletter article, an annual report, a video and so on, each a row of `story_expressions` with its format, venue, channel (the audience it reached or is meant for), language, the day it was told (none while drafted or planned), a short excerpt and a status (`suggested`, `confirmed`, `retired`). Today an expression is a link to an https address outside the platform; a native expression, a platform page of its own, is reserved and not built. A telling above its story's level or without valid consent is kept and flagged, never refused. An agent adds expressions as `suggested`; only a person confirms or retires one.
_Avoid_: version, variant, draft, revision (each is a page's), copy, post (alone, that is one format)

**Sensitivity level**:
How widely an impact story may be told, from an ordered ladder where each level includes those below it: `internal` < `private_circulation` < `newsletter` < `public`. A story is created `internal`. Raising it needs `admin` on its area and a valid consent record; lowering it is open to anyone who may write the page. An agent never sets or raises one. It is a permission, not a label.
_Avoid_: visibility, privacy setting, tier (that is a risk tier), classification (that is a table's)

**Consent record**:
The release behind a story: a reference to the stored release, who consented, in what form and on what day, when it expires, whether the subject is anonymised, how names are used (`real`, `pseudonym`, `none`), how precise the location is (`country`, `region`, `none`), a separate photo release, a review date and, once withdrawn, when. It is **in effect** on a day from its start day up to, not including, its expiry day, unless withdrawn on or before that day; one rule decides raising, rendering and flagging. A row of the restricted `story_consents` table, read by its area's readers and org admins only; it holds the current release.
_Avoid_: permission (that is a grant's), release form (that is the stored document), waiver

**Consent history**:
Every release interval a story has had and every withdrawal, in the order recorded, as append-only rows of the restricted `story_consent_history` table. A telling is judged against the release that covered its day, so a renewal does not flag what was told under the original release (ADR 0041).
_Avoid_: consent log, audit trail (that is the grant's)

**Render channel**:
Where a rendering will be seen, from a closed set: `platform` (staff screens behind sign-in, the same reach as `internal`), `private_circulation`, `newsletter` and `public`. Every render path declares one; exports and verbs take it as a parameter that defaults to `platform`. A story appears in a channel only when `storyMayAppear(level, channel)` says so, and everything a rendering pulls in, embeds and images included, obeys the same channel.
_Avoid_: audience, destination, target (that is a PDF export's), visibility

**Media level**:
The sensitivity level of one file attached to an impact story, kept apart from the story's own level, so a story can be `public` while one photograph in it stays `internal`. A file with no level of its own is `internal`; raising one also needs the consent record's photo release, and it appears above `platform` only while the current consent still holds it.
_Avoid_: image privacy, photo tier

**Story use**:
One line of the append-only `story_uses` log: which story, at which version, went into which channel, by which kind of rendering (a markdown export, a PDF of a page or a binder, an agent read), where, by whom and when. Every story expression with a day told counts as a use too. A page's Print as PDF is a use at `platform`. Withdrawing consent drops the story to `internal` and answers with every recorded use and every expression, the **withdrawal report**; a stored PDF that drew the story into a wider channel can no longer be downloaded.
_Avoid_: view (that is a page view), impression, citation

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
The view a live session watches: `home`, `queues` (Agent Queues), `flow`, `board` (the Queue; the value keeps the screen's old name), `gates` (a workflow's Waiting On You tab and a gate's own page) or `item`. An `item` session also names its item.
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

**Page shape**:
One of the five arrangements of a screen's content inside the shell: List, Document, Form, Board and Overview, each a component in `packages/ui/shapes/` (ADR 0029). Every screen is one of them.
_Avoid_: template (that is a stage graph), layout, page type

**Side panel**:
The panel that opens on the right of a List when a person opens a row, keeping the list in view and the row in the address as `?peek=`. Read and act there; a full page is for long work.
_Avoid_: peek view, drawer, modal, flyout

**Home**:
The app root, where "Waiting on you" lists what the person can act on, ranked.
_Avoid_: dashboard, inbox

**Flow view**:
One harness drawn as the BML diagram from its stage rows under the four brackets, with each stage's count, WIP, age and cost, live.
_Avoid_: pipeline view, diagram page

**Agent Queues**:
The landing page that lists, one card per harness, every harness in an area the person holds a live grant on (an org grant covers every area), with its open items by phase and what waits on the person.
_Avoid_: dashboard, harness list

**Queue**:
The screen of one harness with one column per stage, grouped by bracket, and one card per item, where people and agents claim the same items. It was called the Board until #105; the kernel read behind it (`boardView`) and its live screen value (`board`) keep the old name. Since #206, "Board" is a saved view's layout and never this screen. Capitalised, Queue is always this screen; the transport that carries ingest envelopes is the message queue.
_Avoid_: board (its old name, outside the code that keeps it), kanban (the prototype's word), work queue

**Card**:
The Queue's rendering of an item, and a row's rendering on a Board or Gallery layout.
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
`docs/PRD.md`: what the platform does, module by module, for the whole platform and not only what exists so far. Kept current with the code. It carries no status.
_Avoid_: backlog, roadmap, spec, plan

**Requirement**:
One row of the PRD with a stable ID such as `KN-13`. Scenarios, tests and commits name requirements by ID.
_Avoid_: issue, ticket, story, task

**Architecture document**:
`docs/architecture.md`: how the platform is built as it runs today, and the planned shape of what is not there yet.
_Avoid_: spec, design doc, RFC

**Decision**:
One entry of `docs/decisions.md`: a settled ruling, its reason and what was rejected, cited as "ADR NNNN". A later entry that changes an earlier one says so on both.
_Avoid_: RFC, proposal

**Platform epic**:
The GitHub issue whose sub-issues are the PRD's features. The only place that says what is built and what is outstanding.
_Avoid_: tracker, roadmap, milestone, build step, phase (that is the PRD's word for the order of rollout)

**Verify**:
`pnpm verify`, the whole check chain. CI runs the same checks as separate jobs, and the dependency audit besides.
_Avoid_: build, test (one part of it), lint (one part of it)

**Go-live wiring**:
The CI jobs, bindings and declarations that need an account or a secret (PRD FD-12). Written during the build, they skip or stay out of the deployed wrangler file until the resource exists.
_Avoid_: production setup, deployment config

**Platform**:
The whole product in `uw-platform`. The comparison called it "the shared harness"; in this repository a harness is one row.
_Avoid_: the shared harness, the system

**Shadow mode**:
A harness setting under which the ship rule is evaluated and recorded as an event on every head, and nothing is posted to GitHub and no connector runs. An area admin turns it on or off at any time.
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

**Declared checks**:
The commands a repository says prove a change, in the file `.harness/checks.sh` at its root. A fix run reads the file at the commit the fix starts from, runs it after the model has worked, and pushes only when it passes. Not the **required checks** of the ship rule, which are CI checks GitHub reports.
_Avoid_: local CI, pre-push hook, test script

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

**Blocker**:
An item another item in the same epic waits on: the item for an issue named on a `Blocked by:` line in the waiting item's issue. A blocked item is offered to no one until every blocker's item has passed Ship; a person may still claim it.
_Avoid_: dependency, prerequisite, parent

**Not ready**:
An issue or product page intake refused because it has no done-when. The refusal is recorded on the harness and the Queue lists it until it becomes an item.
_Avoid_: invalid, rejected (that is a gate decision), backlog

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

**Bot author**:
A GitHub account a harness lists in `bot_authors` (by default `dependabot[bot]`). An item whose pull request a bot author opened is shown on every screen and left out of every count of items, and the count says so.
_Avoid_: bot item, ignored author

**External learning**:
A learning page an external runner posted on a delegation whose capability is `review`, as the bench posts its weekly patterns. It lands `suggested`, names `source: external` and the pull request it came from, and a person confirms it like any other learning.
_Avoid_: bench learning, imported learning, ruling (that is the bench's word for a reviewer's decision)

**Required check**:
A check a harness names, by GitHub App and check name, that must have run on the head and passed before Ship. A harness that names none requires every check that ran on the head to have passed, and at least one to have run.
_Avoid_: required status, CI gate, branch protection (that is GitHub's)

**Carried approval**:
A Reviewer approval on an earlier head that counts on the current head because every commit since it is a merge and the change against the merge base is byte-identical (the same patch id). The gate decision names both heads.
_Avoid_: sticky approval, inherited review

**Refuted finding**:
A Reviewer finding a person marked wrong on a gate's page. The share of a Reviewer's findings refuted over 30 days is its refute rate.
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
