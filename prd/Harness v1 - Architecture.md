# Harness v1

*The Build · Measure · Learn loop drawn as a mechanism: which component owns each box, where the human hand sits, and how status reaches the web page and the person waiting on it.*

**For:** Jesse
**From:** Ian
**Date:** 2026-09-28
**Status:** draft for iteration
**Revision:** v1.0 reviewed by Jesse 2026-09-28 · v1.1 applies every item of that review in one revision; see "Review responses" at the end
**Sits under:** Platform Architecture Plan §1, §6, §8, §18 · Key Visuals fig. 2 and 5 · BML Harness

> **Provenance.** This file began as the markdown form of the artifact Jesse reviewed on 2026-09-28 (https://claude.ai/artifact/EpMRSpB9mKa1Pr2kRENrfT); that unchanged v1.0 text is commit `80d4c80`. Jesse's review is in `Harness v1 - Architecture Review.md`, and v1.1 is the text with that review applied. The figures in `figures/` are still the v1.0 drawings and are regenerated once v1.1 merges; where a figure and the text disagree (the phone app, the fifth persona name, the verb list), the text wins.

## How to read this

Everything drawn here is one level below the Platform Architecture Plan. The spine (sources → entity layer → MCP surface → workspace) is unchanged; these figures zoom into the `harness` module and show the moving parts the plan describes in prose. Where this proposal adds to or reorders the plan, it is listed in the Decisions table at the end, with the plan's current position beside it. Nothing else is meant to conflict.

Key to the figures:

- **Ocean outline** — already in the plan
- **Inspire (light blue) fill** — added by this proposal
- **Kindle (orange)** — the human hand; Kindle marks exactly one thing
- **Dashed grey** — later, not in v1
- **Red outline** — verb that does not exist for agents

## Figure 1 · The harness on the spine

Top to bottom: the people, the edge, the engine, the agent boundary, the personas, the outside systems, the database. Arrows say what moves. The only orange line is a human deciding at a gate.

![Layered architecture of the harness module: web page and phone app on top, command API, live hub and push in the edge layer, the harness engine with stages, leases, event log, workflow runs and spend breaker, the MCP surface as the agent boundary, four personas, two hosts they run on, external sources, and Postgres at the bottom. A single orange arrow carries human gate decisions from the clients to the gate_decisions table.](figures/harness-v1-fig1-harness-on-the-spine.svg)

**What the picture claims.** A persona can reach the platform only through the MCP surface, and that surface has no gate verb, so the orange line from a person to `gate_decisions` is the only way an item passes a human gate. A persona runs on either of two hosts, a platform Workflow or a staff member's own Claude Code, with the same verbs and the same gates; the surface has no internal-only verbs, and it is a versioned registry rather than a fixed list (see "Jobs are config, verbs are code"). The persona concept and its definition are the plan's (§6); the four names shown are worked examples for the two templates. Scout is the plan's "scout pass"; it is drawn as its own persona, and in v1 it runs as the first step inside Builder (see "Personas in v1"). Builder and Reviewer are the plan's agent lane and reviewer harness, and Iterate is a proposed name for whoever works the Iterate box in the BML drawing, which names no worker. The engine does not push data to screens; it wakes the live hub, and each screen reads events in order from its own cursor. A notification is the same idea over web push and the Zulip bot (plan §12): a wake that names the harness and the reason, never the content, so no harness data lands in a notification tray or a Zulip stream; the client reads from its cursor on open. A dropped notification therefore loses nothing, only time. Notifications are ranked (a gate waiting on you outranks a failed run, which outranks a stage advance) and coalesced into one cooldown window per person, so a weak wake never spends the window a strong one needs, and the screen you are already looking at is not woken. The ship rule enters the engine from the outside world, not from the item's own record.

## Figure 2 · One item's journey, on both templates

The engine runs eight generic stages. The software template and the BML template are the same geometry with different names, workers, and connectors. The brackets under the stages are Jesse's four BML boxes.

![Eight stages left to right: Package, Scope, Plan, Build, Check, Ship, Validate, Close. Above each, who works it and its exit gate. Ship is the human gate in orange. Below, two rows name the same stages for the software template and the BML template, and four brackets map the stages onto Product Package, Build Package, Deploy Package and Iterate. A loop arrow returns from Close to Scope as the regular tweak and a dashed arrow from Validate to Package as the occasional tweak.](figures/harness-v1-fig2-one-items-journey.svg)

A stage is a row, not code:

```
harness_stages(key, position, agent_pickup, exit_gate, connector, wip_limit, instructions_page_id, validators[], feeds[])
-- the plan's queue_stages plus connector, validators and feeds
-- connector  NOT NULL DEFAULT 'none' ∈ none | merge | deploy | publish | send | post   what leaving the stage does
-- exit_gate  NOT NULL ∈ none | checks | human_approval
-- CHECK (connector = 'none' OR exit_gate = 'human_approval')   see "The gate is a constraint"
```

**What the picture claims.** Both of Jesse's loops fit one stage graph. The human gate sits at the same place in each (between Build Package and Deploy Package), the Scout's premise check is the "explorer" pass the plan already asks for, and the two return arrows from the BML drawing are the `feeds` edges on the stage rows. Choosing which template goes live first is Decision D1.

### Close produces memory, mechanically

The v1.0 text said Close "writes learning" and Iterate "proposes revisions" as narrative. Both are now validators on the stage row, so an item cannot leave Close without having done them.

- **`learning_attached`**, the Close exit validator. The item must carry either a `suggested` learning or skill page (plan §6, confirmed by a person like any other) or an explicit `nothing_learned` marker with a one-line reason. An item with neither does not close. The marker is deliberate friction: "nothing learned" is a claim someone signed.
- **Evidence labels from day one.** Every revision Iterate proposes, and every claim in a learning it drafts, carries the plan's label: `observed`, `confirmed`, `inferred`, or `assumed`. A revision without labels fails the same validator. The interview persona can wait for v1.1; the labels cannot.
- **Personas in v1.** Three identities, not four. The scout pass runs as the first step inside Builder's run, so there is one fewer identity to govern. Scout becomes its own persona with its own stage exit when premise-refusal rates show it earns one; the stage graph does not change when that happens, only who works Scope.

## Figure 3 · The gate, as a mechanism

Three paths meet at a waiting item. Only one of them can move it.

![An agent submits an item to a gate through the MCP verb submit_to_gate; the item waits on a human. A person's approve command writes a gate_decisions row, the engine records gate_approved and advances the item, and the live hub wakes clients. A struck dashed line from the agent to gate_decisions shows there is no such route and the attempt is logged. At Ship, the engine also evaluates the ship rule over GitHub facts and either advances or refuses with a closed reason.](figures/harness-v1-fig3-the-gate.svg)

An override is allowed, because a person may overrule the reviewers. The override and its reason ride into the audit trail with the merge, exactly as the prototype's merge button says.

**What the picture claims.** The gate is enforced by the absence of a route, not by a prompt. The ship button is enabled by facts read from GitHub at that moment, and the human's decision is the only write into `gate_decisions`. Both facts are testable in CI: "no agent tool or route writes gate decisions" and "the ship rule is deterministic over its inputs."

### The gate is a constraint, not a column value

The review found a real conflict. "A stage is a row, not code" and "the gate is enforced by the absence of a route" cannot both hold if `exit_gate` is an ordinary column: a template author, or anything that can write a stage row, could set Ship's exit to `checks`, and the engine would obey. The fix is the one the plan uses for the ledger. The invariant lives in Postgres, where no template, command, or agent can talk it out of holding.

- **Every stage declares what leaving it does in the world.** `connector` is a closed set: `none`, `merge`, `deploy`, `publish`, `send`, `post`. A stage with an external effect is not a matter of naming; the row says so, and the engine's connector registry has exactly one handler per value.
- **The database refuses an external effect without a human gate, and nulls cannot slip past it.** Both columns are `NOT NULL`, `connector` defaulting to `none`, and the constraint is `CHECK (connector = 'none' OR exit_gate = 'human_approval')`. The `NOT NULL` matters: a Postgres check passes when its expression is unknown, so without it `connector = 'merge'` with a null `exit_gate` would be accepted. A check constraint applies on insert and on update alike, so there is no separate trigger to keep in step with it. A migration test asserts all three facts against the live schema: both columns non-null, the constraint present, and an insert of `('merge', 'checks')` refused. Templates stay data; this rule does not.
- **Stage rows are not pages.** They are edited through a stage command that requires `admin` on the harness's area, never through `write_page`, so no persona toolset reaches them. An admin who tries to lower Ship's gate gets the database's refusal, with the reason, as an event on the harness.
- **A property test that walks the loops.** For each template, walk the stage graph from Package along `position` order and along every `feeds` edge; every path to a stage with `connector <> 'none'` must cross a `human_approval` exit first. The regular-tweak edge from Close to Scope and the occasional-tweak edge to Package are part of the walk, so a loop cannot offer a way around Ship. The test runs in CI on the template fixtures and again at template activation, so a template that fails it cannot go live.

### Risk tier in the ship rule

Plan §8 says ledger, ACL, and infrastructure changes always take the full reviewer harness plus a human. The v1.0 ship rule required one reviewer identity for everything. It now takes the tier as an input.

- **`harness_items.risk_tier ∈ low | standard | high` and `risk_domains[] ⊆ {ledger, acl, infra, migration}`.** The PR declares both under the mechanical-gates rule, alongside what it closes, what it risks, and what it touches. The engine derives a floor from the paths the diff touches: each protected directory maps to one domain, and any domain present floors the tier at `high`. The declaration may add domains or raise the tier and can never remove or lower. A PR with no declaration is refused with `risk_tier_undeclared`.
- **What each tier needs at Ship.** `low` and `standard`: one reviewer identity approved the head commit. `high`: two reviewer identities from different vendors approved the head commit (the Codex engine makes the second one cheap), and the approver holds `admin` on the area plus the extra grant each touched domain names. The extra grant comes from the domain, not from the tier, so non-financial ACL work does not need the finance admin: `ledger` needs `admin(20-29)`, the same rule the plan applies to posting a journal entry; `acl`, `infra`, and `migration` need org-scope `admin`, the super-admin of plan §4, because those changes reach every area. An item touching two domains needs one approver who holds both grants, because the ship rule takes exactly one approver principal and cannot evaluate the union of two. A quorum of approvals is not in v1; if it is ever needed, the rule's input becomes a set of recorded decisions and the item stays parked until their grants together cover every required domain.
- **The ship rule stays a pure function, and the approver is one of its inputs.** Inputs are GitHub facts, the item's tier and domains, and the approver's principal as minted at the edge for this request, which carries their resolved grants. Given the same inputs it returns the same answer; nothing inside it reads the database. When the decision is recorded, the command re-reads the approver's `role_grants` rows with `SELECT … FOR SHARE` in the transaction that inserts the `gate_decisions` row, and refuses if they no longer cover every required grant. The lock is what makes this atomic rather than merely co-transactional: a revocation is always an update or delete of those same rows, so under read committed it either commits first, in which case the locked re-read sees the revoked row and the gate refuses, or it queues behind the gate transaction, in which case the decision was recorded while the grant was still valid. A test runs the race in both orders. A revoked grant therefore cannot ride a stale button. The item's narrative is still not an input. The closed refusal set grows by three: `risk_tier_undeclared`, `reviewer_count_below_tier`, `approver_lacks_domain_grant`.

## Figure 4 · Lending token aid: a person's own Claude Code picks up work

Anyone holding `editor` on the harness's JD area can point their own Claude Code at the harness and work a card with their own tokens. It is the same persona, the same verbs, and the same gates as a platform-hosted run. Nothing about the gate cares where the agent ran.

![Sequence from left to right: a staff member's Claude Code signs in through Access and is minted an agent identity under that person; it polls and claims an item on a lease; a git worktree on branch harness/item is created; the run works, and every record_run_step call renews the lease and reports tokens; submit_to_gate parks the item; the person approves from the notification. If the laptop closes, the lease expires and the item is released for anyone else.](figures/harness-v1-fig4-external-runner.svg)

**Same as a platform run:** verbs, gates, WIP, lease, event log, play-by-play, live updates, write recorded as `agent:<person>/<device>` with grants ≤ that person's, and one CI test: every verb a Workflow can call, an external runner can call.

**Different, and said so:** tokens are reported by the runner, not metered; cost basis is "subscription" on /health, tracked as contributed time and never against the API budget. Git writes use the person's own credentials: branch protection and the ship rule's head check guard the merge. No checkpointing: a dead laptop means a released lease.

**When the laptop dies.** The lease expiring releases the item; that was already in v1.0. It also protects the next claimant's hours. On expiry the engine records `lease_expired` and marks the item's branch `abandoned`, so the next claim starts from the item's expected head, not from a stale branch, unless the claimant explicitly adopts the abandoned one. Where the runner is still alive at the warning before expiry, the synced harness skill pushes a `wip:` commit to the `harness/<item>` branch so the work is on the remote before the lease lapses. A stale head can still never merge; the ship rule's head check handles that. This handles the waste.

**A scheduled routine is an external runner on a delegation.** Jesse's case: a routine on his own machine that runs every hour and codes. That is Figure 4 with no one at the keyboard, and "no one at the keyboard" is the point: it is unattended, so it runs under the same rule as every other unattended beat (see "Unattended loops run on a delegation"), whatever host it is on. The mechanics: an attended session authenticates with the person's own interactive Access login, and its claims ride that live principal. A routine authenticates with an Access service token minted under the person and marked non-interactive, and `claim_item` from a non-interactive principal requires a `delegation_id`; without a live one the surface refuses with `delegation_required`. The routine's prompt therefore names the MCP server, the persona it plays, and the delegation it holds. Every event it writes carries `agent:<person>/<device> as <persona> via delegation:<id>`, the play-by-play, the board, and /health show it that way, and the delegation's capability word and expiry bound what it may do inside the person's grant ceiling. Gate verbs do not exist for it, as for any agent identity. That is the whole of "identifying itself in the system": the claim, with its delegation, is the identification.

**What the picture claims.** An external runner is not a special mode. It is a persona on a different host, and the MCP surface is the whole interface, so there is nothing a platform-hosted run can do that a laptop cannot, and nothing a laptop can do that a platform run cannot. Staff, volunteers, and contractors can contribute agent time with their own tokens and their own login, and the merge is still a person's decision.

## Who may act: grants, not names

The harness has no authorization model of its own. Every "who" in this document resolves through the plan's one model (§4): `role_grants (person, role ∈ admin|editor|viewer, scope ∈ org|jd_area)`, agents' grants ≤ their owner's, and the principal travelling with every request. A harness is scoped to a JD area the way a page is, and the area's grants decide who may claim, who may approve, and who may see.

```
harnesses(id, key, template, jd_area, ...)
-- the software harness lives in 80–89
-- a BML harness lives in the area of the program whose product it serves
```

| Act | Requires | Who holds it in v1 |
|---|---|---|
| See a harness, its board, and its items | `viewer` on the harness's area, or the org-wide read that `editor` anywhere carries | everyone, as for any internal page |
| Claim an item, on either host | `editor` on the harness's area; an agent claims through its owner's grant | software: `editor(80-89)` · BML: `editor` on the program's area |
| Mint `agent:<person>/<device>` and run externally | the same `editor` grant; the identity inherits it and nothing more | same set; there is no separate external-runner list |
| Approve, reject, take over, or override at Ship | `admin` on the harness's area | a grants-table row, not a name in a config file |
| Approve a `high` item whose diff touches the ledger | `admin` on the area **and** `admin(20-29)`, the same rule the plan applies to posting a journal entry | finance admin; see "Risk tier in the ship rule" |
| Approve a `high` item whose diff touches ACL, infrastructure, or migrations | `admin` on the area **and** org-scope `admin` | super admin; the extra grant follows the touched domain, not the tier |
| Schedule an unattended loop | `admin` on the harness's area, recorded as a delegation | see "Unattended loops run on a delegation" |
| Create or activate a persona on a harness | `admin` on the harness's area; the persona's toolset is bounded by the creator's grants | see "Making a persona" |

Consequences the reader should be able to check:

- **The approver set is a query, not a setting.** "Who approves at Ship" is `people with admin(area)`. Adding a second approver is a grant with an optional `expires_at`, audit-logged like every other grant, and it appears on the quarterly access review. Jesse being the only approver today is a fact about the grants table, not about the harness.
- **Visibility is the area's, not "internal".** An earlier draft called harness data "classified internal". That is not a platform concept; a harness item carries its area's classification and offline eligibility from §2.6 exactly as any page does. Software-harness items in 80–89 are `internal`, so they may sync to a registered device. Nothing in a harness item may hold a value the principal could not read directly.
- **BML measurements stay on the public side in v1.** The Validate stage reads web analytics and mailing-list aggregates that carry no donor identity. Any measurement drawn from areas 40–49 passes through the finance and CRM read exclusions and the FRED sensitivity filter of §4 and §9, and is out of scope until a BML harness needs it.
- **Two CI tests.** Every harness command and MCP verb calls `can(actor, verb, resource)` with the harness's area as the resource scope; a route that skips it fails the build. And no grant, on any path, lets an agent identity write `gate_decisions`, which is Figure 3 restated as a test.

## Unattended loops run on a delegation

The v1.0 text said "unattended beats carry their creator's authority." The review is right that this fails three ways: the authority should be the approver's, not the creator's; it must end when that person leaves or their grant is revoked, and nothing said it did; and the plan requires a principal on every request, which an unattended beat does not have. So a beat does not carry anyone's authority. It carries a delegation.

```
delegations(id, person_id, persona_id, harness_id, capability, granted_at, expires_at, revoked_at)
-- person_id must hold admin(area) on the harness at grant time and at every beat
-- capability is one word; the narrowest opens nothing
-- expires_at is required; default 90 days, renewable by the same person
```

- **Who may grant one.** The person who approved the package at Ship, or any other holder of `admin` on the harness's area. Scheduling the regular tweak is the act of writing this row; there is no other way to make a loop run unattended.
- **Regardless of host.** A beat is any claim made without a live interactive human session: a platform Workflow on a schedule, or a person's own scheduled routine on their laptop authenticating with a non-interactive service token. Both must present a live delegation at claim, and both record its id on every event. The external host is not a way around this rule; see "A scheduled routine is an external runner on a delegation".
- **What a beat runs as.** `agent:<persona>` acting `on_behalf_of` the delegation. The principal minted for the beat is derived from the delegation, not from a live session, and it is bounded by the delegating person's grants at that moment. A beat can do what the persona's toolset allows within the capability word, and never a gate verb.
- **Fail closed.** At every beat the engine checks that the delegation is unexpired and unrevoked and that the person still holds `admin` on the area. Any of the three failing stops the loop and writes `delegation_lapsed` to the harness, which is a "waiting on you" notification to the person, or to the area's other admins if the person is gone.
- **Visible in two places.** The person's page lists the delegations they hold open, and the persona's dashboard lists the delegations it runs under. The quarterly access review (plan §20) lists every live delegation, exactly as it lists time-boxed contractor grants, because that is what a delegation is.

## Jobs are config, verbs are code

The plan's rule that a new persona is data, not code, holds because a persona only selects from things that already exist: verbs from the tool registry, and a **run shape** from a second, smaller registry. It can never add either. A verb is a capability, and a run shape is a loop with its own concurrency and failure handling; both are reviewed code. So a persona is config over two registries, and when a new persona needs a verb or a shape the platform lacks, that is a work item for the software harness, not a configuration problem. Three tiers, and only the third is platform code.

```
persona        = config over ( verb registry × run-shape registry )
new verb       = code, reviewed
new run shape  = code, reviewed          v1 shapes: workflow-run · external-run
new persona    = pick a shape, pick verbs, write instructions
```

| Need | What it is | Who makes it | Gate |
|---|---|---|---|
| A new job using existing verbs | A persona: identity + harness subscription + instructions page + a toolset picked from the registry | Anyone with the grant; an agent may draft one | `suggested` until a person confirms |
| Deterministic logic over existing verbs | A skill with a script in its folder (the agentskills.io format allows this): parsers, formatters, checkers, calculations. Runs in the runner's sandbox with only the persona's grants | Anyone; an agent may draft one | Same page gate; versioned with the page; CI refuses a script holding a credential or calling outside the MCP surface |
| A new platform verb | Code in `uw-app`: a new MCP tool, a new stage validator, a new connector. Lands in `packages/contracts`, the tool registry, and the persona's allowed list in one change | A PR through the software harness, risk-tiered | Reviewer harness, then a person merges |

The mechanism that keeps it honest: a persona's instructions page declares `requires_tools`. Activating a persona whose verb is missing fails with a clear message and opens a card in the software harness, "persona X requires verb Y, which does not exist." The persona activates when the verb ships. A missing tool is visible on the board, never hidden in a prompt. Stage validators, the checks in an exit gate, are a registry too: a stage row picks validators by key and cannot define one inline.

### One verb registry

The v1.0 text listed eight harness verbs and the plan's §6 lists a different set; each omits things the other needs. Scout cannot verify a premise without `search_pages`, and Iterate cannot read measurements without `query_entities`. The registry is the union, published from `packages/contracts` (D4) as one live version with golden fixtures and a conformance test, and plan §6 should point at it instead of listing verbs inline.

| Group | Verbs | Notes |
|---|---|---|
| Pages and context | `search_pages` · `read_page` · `write_page` · `resolve_context` | the plan's, unchanged; `resolve_context` is the grown form of `resolve_policies` |
| Records | `query_entities` · `create_task` | whitelisted parameterized queries, never raw SQL |
| Role-gated | `list_gifts` · `create_draft_journal_entry` | offered only to a persona whose owner holds the area grant |
| Harness | `poll_queue` · `claim_item` · `submit_to_gate` · `record_run_step` · `get_health` | this document's additions |
| Do not exist | approve · merge · deploy · publish · advance past a human gate | for any agent identity, on any host |

### Making a persona

The plan defines a persona and says it is data, but neither the plan nor the prototype shows how one is made. Following the plan's own pattern, a persona is a page type: typed frontmatter with a Zod schema, a form for the properties, and a markdown body that is the persona's instructions in the agentskills.io format. Creating one is "New page, type: persona." No special screen.

![A persona page. The top half is a form with fields: identity, owner, harness subscription, toolset checkboxes offering only verbs the creator holds with forbidden verbs not offered, run shape from a registry, model and budget, capability word, requires_tools derived from the toolset, and status suggested to active with an Activate button for a person. The bottom half is the markdown instructions body. Beside it, the same page's default view shows runs today, spend, escalation rate, gate refusals, writes, hosts, and the last play-by-plays.](figures/harness-v1-fig5-persona-page.svg)

**What the picture claims.** A persona is made where every other thing in the platform is made, the page editor, and the form can only offer verbs the creator already holds. Activation is a gate like any other, and the page doubles as the persona's dashboard. The interview layer: the plan's intake persona (§6), which turns "I need…" into structured requirements with an evidence ledger, can be pointed at this page type, so a person describes the agent they need in plain words and reviews the drafted form. That is agents constructing agents, with the human at the same gate. It is one more persona whose output is a page, so it adds nothing to the architecture and is proposed for v1.1.

## Engines, and who pays

A persona picks an engine the way it picks a run shape. The engine is code behind one seam; the vendor SDK is named in exactly one directory. Billing is a property of the host, not the persona: a platform-hosted run is always metered on the organization's API key through AI Gateway, and an external run is always the person's own subscription. Verified against vendor pages on 2026-09-28; the companion research note has the sources.

| Engine | Where the model runs | Needs a container? | Billing | Good for |
|---|---|---|---|---|
| `claude-messages` | A tool-use loop over the MCP verbs, inside the Workflow step | No | API key, metered | Scout, Iterate, intake: personas with no filesystem or shell |
| `claude-code-sandbox` | Claude Code headless in a Cloudflare Sandbox; official Cloudflare tutorial; key injected at the egress proxy | Yes | API key, metered | Builder |
| `claude-managed-agent` | Anthropic hosts the loop, Cloudflare hosts the sandbox; API-driven with session budgets and GitHub PRs | Yes, theirs | API key + $0.08 per session-hour | Builder, when we would rather not own the loop |
| `codex-sandbox` | Codex via the OpenAI Agents API executor in a Cloudflare Container; official tutorial | Yes | API key, metered | Reviewer: a different vendor's model, as the plan asks |
| `external` | The person's own Claude Code or Codex on their machine, connected to the MCP surface | No, theirs | Their subscription; tokens self-reported | Builder, Reviewer, anything a person chooses to lend time to |
| `openrouter-messages` | The same tool-use loop as `claude-messages`, inside the Workflow step, with the model chosen per persona from OpenRouter's catalogue (a flash-class model such as GLM 5.3 flash) | No | OpenRouter API key, metered through AI Gateway | The always-on backbone: Scout, Iterate, intake, validators; anything that runs often and needs no frontier model |

**The always-on tier.** Jesse's point, and the answer to the cost line below: most of what the harness does all day is not Builder work. Premise checks, measurement reads, intake triage, and validators run often, need no filesystem, and do not need a frontier model. The sixth engine routes them to a cheap model through one OpenRouter key, behind the same seam and the same AI Gateway budget as everything else. The vendor SDK rule still holds: OpenRouter's is named in one directory. A Grok subscription, like a Claude seat, is a person's own credential and fits the external host only; an xAI API key would be one more row in this table if it is ever wanted.

**Where the engines live in the plan's topology.** Plan §1 is three Workers plus Durable Objects, chosen to minimize operational surface. `claude-code-sandbox` and `codex-sandbox` add Cloudflare Sandbox and Containers to that, which the plan should say in §1 with two rules: containers host Builder and Reviewer runs only and hold no state, everything durable being in Postgres and the event log; and the laptop host is the documented fallback if containers are ever cut, since Figure 4 already proves the surface does not depend on them.

**Why hosted runs use API keys and external runs use subscriptions.** Both vendors draw the line by whose use it is, not by how the model runs. A person's own subscription covers that person's own use of the vendor's own tool, interactively or headless: Anthropic's one-year setup-token exists for exactly that, and its support pages say the Agent SDK and `claude -p` draw on the subscription for personal use. What a subscription does not cover is a product that serves other people: Anthropic's legal page says such products, "including those using the Agent SDK, should use API key authentication," and OpenAI's only documented automation credential on a ChatGPT plan is a Business or Enterprise access token. The harness's hosted personas are an organization's product serving many staff, so they run on organization API keys. A staff member's own Claude Code or Codex on their own seat, connected to our MCP surface, is that person using the vendor's tool, so it runs on their plan. The host is irrelevant to this; Cloudflare neither helps nor hurts.

**What it costs, and the v1 default that keeps it inside the brief.** The v1.0 estimate stands as a warning: thirty heavy hosted Builder runs a day (2M input tokens with heavy caching, 75K output) is about $1,600 a month on Sonnet 5 and $2,900 on Opus 5.5 at list, plus under $200 of sandbox compute, against an Executive Brief line of about $1,250 a month for all AI tooling. The review's resolution is adopted as the v1 default:

- **Builder runs on the external host by default.** Staff seats carry the heavy work. Hosted Builder runs exist and are metered, but a harness starts with hosted Builder off and an admin turns it on per harness.
- **Hosted runs are the always-on tier.** Scout, Iterate, intake, and validators run on `openrouter-messages` on a flash-class model. At flash-class list prices that is tens of dollars a month, not thousands; the exact figure goes in the research note once the model is chosen.
- **The breaker trips before the budget does.** The AI Gateway hard cap is set to the brief's number, one limit across Anthropic, OpenAI, and OpenRouter, holding new runs at 75 percent and pausing running ones at 90 percent as Figure 1 shows.
- **The brief gets an "AI runs" line** with the hosting assumption stated, so the number leadership sees is the number the breaker enforces.
- **The seat price is to be re-verified.** The v1.0 text quoted Anthropic's nonprofit Team seats at $8 per user per month with Claude Code included, from the 2026-09-28 research note. It does not enter the brief until re-checked against Anthropic's current nonprofit page, with the link recorded in the note.

## What v1 ships

**Engine**
- Harness, stage, item, event, run, gate decision, measurement, persona, delegation tables; every harness in a JD area
- Leases, WIP limits, exit gates, loop edges
- Ship invariant: a database check that an external-effect stage exits only on human approval, plus a template property test that walks the loops
- Risk tier and risk domains on every item, derived from the diff and declared in the PR, inputs to the ship rule along with the approver's principal
- Close exit validator: a suggested learning or skill, or a signed "nothing learned"; evidence labels on every Iterate revision
- Runs as Cloudflare Workflows, costed per step, hibernating at gates
- Spend breaker on the AI Gateway meter, capped at the brief's number
- Two templates: software delivery, BML product flywheel

**Agent boundary**
- One verb registry from `packages/contracts`: the plan's page, record, and role-gated verbs plus poll, claim, submit to gate, record step, health
- No approve, merge, deploy, publish, or advance verbs
- Three personas as configuration: Builder (scout pass as its first step), Reviewer, Iterate
- Reviewer has its own identity and a different vendor; verdict read back from GitHub; two reviewers for `high` items
- Two hosts, first class: a platform Workflow, or a staff member's own Claude Code over remote MCP with their own tokens; a scheduled routine on either host claims only under a live delegation
- Six engines behind one seam; hosted Builder off by default, the always-on tier on OpenRouter
- A synced harness skill in the repo so a local session knows the flow and pushes a WIP commit before a lease lapses

**Web page**
- Flow view: the BML diagram live, with counts, WIP, age, cost
- Board, Gates, Item play-by-play
- Home "waiting on me"; Agent plane on /health, with delegations and per-host spend
- Every control returns an outcome; unwired controls say so
- The Gates view works at phone width and is installable, so a web push opens straight to the waiting gate

**Reaching a person** (in place of a phone app; see the scope cut in "Review responses")
- Web push from the web app: "a gate is waiting on you", ranked and coalesced per person, never carrying content
- The Zulip bot thread keyed to the item (plan §12), moved from "later" to v1: the same wake, and a place to talk about the card
- Resume by cursor on open, so a dropped notification loses time and nothing else
- The contract package stays mobile-ready; a native app is revisited after a quarter of harness operation

## Controls on the pipeline

| Control | Who | What it does | Gate |
|---|---|---|---|
| Kickstart | person | Creates the first item from the package page and enters stage 1 | — |
| Enqueue / import | person, ingest | New item: manual, or a labelled GitHub issue | — |
| Reorder / priority | person | Ordering by "before this item," never by a client-side index | — |
| Claim / release | agent (lease), person | Lease with expiry; a human claim has no lease | WIP limit |
| Submit to gate | agent, person | Runs the stage's checks, then parks the item | server |
| Approve / reject / take over | person | Advances, returns with findings, or reassigns to a person | `human_approval` |
| Override | person | Advances despite open findings; reason required; audit trail | logged |
| Prompt run / stop run | person | A message into a running agent, or an abort | — |
| Pause / resume | person | A lane or a whole harness; runs hibernate | — |
| Tweak package | person | A new version of the package page (the occasional-tweak arrow) | `human_approval` |
| Schedule regular tweak | person with `admin(area)` | Writes a delegation: the beat runs as `agent:<persona>` on behalf of that person's grant, one capability word, `expires_at` required; revocable from the person's page | delegation |

## Decisions to make together

Each row is a place where this proposal adds to, reorders, or makes concrete something in the plan. The plan's position is quoted so we can see whether a change is real, and whether it is defensible.

| # | Decision | The plan today | This proposal | Kind |
|---|---|---|---|---|
| D1 | First harness instance | §8 doctrine for software; GitHub App in Phase 4 | Software delivery first, BML second, both shipped as templates; GitHub App pulled into v1 because its Deploy and Measure facts are already machine-readable | reorders phasing |
| D2 | Phone app | Web plus Tauri desktop; no mobile | **Withdrawn for v1 on the review's scope cut.** "Waiting on you" is served by web push from the installable web app and the Zulip bot; the contract package stays mobile-ready; a native app is revisited after a quarter of operation. Needs Jesse's explicit confirmation, since the earlier v1 brief asked for iOS and Android | withdrawn |
| D3 | Live updates | HTMX and islands; Durable Objects reserved for page sync hubs | One Durable Object per active harness as wakeup hub with per-session cursors; polling stays as the fallback | extends DO use |
| D4 | Client contract | Zod at every boundary; shared TypeScript types | A published contract package, one live version, golden fixtures, CI conformance, so web, phone and personas cannot drift | addition |
| D5 | Where agents run | Workflows; evaluate Cloudflare OS at Phase 4.5 | Two first-class hosts in v1: uw-app Workflows, and a staff member's own Claude Code over remote MCP. One tool registry, one CI test that the two hosts see identical verbs. Cloudflare OS becomes a third host later, not a replacement. Cloudflare Sandbox and Containers enter plan §1 as Builder and Reviewer hosts only, holding no state, with the laptop host as the documented fallback | extension |
| D11 | Spend from external runners | Per-run cost through AI Gateway; circuit breaker | The platform meter cannot see a laptop's tokens, and a subscription run has no dollar cost. External runs self-report tokens per step, labelled subscription on the board and on /health; the breaker never counts them against the API budget. Hosted runs read AI Gateway's cost data; no token ledger of our own | new |
| D16 | Engine seam | Workflows host runs; model provider unstated | Six engines behind one seam, chosen per persona: claude-messages in the step, claude-code-sandbox, claude-managed-agent, codex-sandbox, external, openrouter-messages for the always-on tier. A vendor SDK is named in one directory; a CI text gate refuses it elsewhere. A new engine is a directory, never a branch | makes concrete |
| D17 | Billing by host | AI Gateway budgets and a breaker (§6, §18) | Hosted runs: organization API keys, BYOK through AI Gateway, one spend limit across Anthropic, OpenAI, and OpenRouter capped at the brief's number, hard stop or fail-over to a cheaper model. Hosted Builder off by default; the always-on tier on a flash-class model. External runs: the person's own plan, tracked as contributed time. Nonprofit Team seats for staff who lend time, price to be re-verified before it enters the brief. No subscription credential is ever stored on the platform | policy |
| D12 | Write boundary on a laptop | Write tokens live in the host step, never in the model process | On a laptop the person's own git credentials are present. Accepted, with three guards: branch protection on main, a `harness/<item>` branch convention, and the ship rule checking that the PR head is the commit the item expected | accepted risk |
| D13 | Who may run externally | Agents have identities and Access service tokens; grants ≤ owner's | Any person holding `editor` on the harness's JD area may mint `agent:<person>/<device>` under themselves and claim from it. There is no separate allow-list: the software harness is open to `editor(80-89)`, a BML harness to `editor` on its program's area. See "Who may act" | policy |
| D6 | Loop edges | Stages in a straight line, ordered by position; a card only moves forward | `feeds` on each stage so Iterate can route to Build or Package. An unattended traversal runs only under a delegation (D18), and the Ship property test walks these edges | extension |
| D7 | Item history | `history jsonb` on `queue_items` | A `harness_events` table as the source of truth, with replay ≡ record pinned by test; it is also the dashboard feed | column → table |
| D8 | Ship gate | "Mechanical gates"; PR declares what it closes, risks, touches | A pure function over GitHub facts, the item's risk tier and domains, and the approver's principal, with a closed set of refusal reasons; the item's own record is not an input; one approver holds every required grant; grant rows locked and re-read in the transaction that records the decision. Ship exits only on `human_approval`, enforced by a null-safe Postgres check on `harness_stages` keyed on the stage's `connector`, and by a property test that every path from Package to an external effect crosses a human gate, loops included | makes concrete |
| D9 | Deploy Package target | §7 publish pipeline: R2 + KV, uw-www | Is the BML harness's web host the platform's publishing module, or external hosts? Decides whether uw-www joins v1 | open |
| D10 | Product Package shape | Page-type registry | Three typed pages, `system_goal`, `product_strategy`, `data_sources`, under a product page, so agents read the package as markdown | extension |
| D14 | When a persona needs a verb that does not exist | "Personas are configuration: new ones are data, not code" | Keep the rule by bounding it: personas select verbs, skills may carry sandboxed scripts over existing verbs, and a new verb is a reviewed PR. `requires_tools` on a persona; a missing verb opens a card in the software harness instead of failing silently | makes concrete |
| D15 | How a persona is made | Personas are data; no creation flow described or prototyped | `persona` is a page type: typed frontmatter form (identity, owner, harness, toolset limited to the creator's grants, run shape from a registry, model, budget, capability word, `requires_tools`), markdown body as instructions, `suggested` → `active` flipped by a person after a tool check and a dry run; the page's default view is the persona's dashboard. Interview-driven creation via the intake persona in v1.1 | fills a gap |
| D18 | Unattended loops | Principal travels with every request; time-boxed grants for contractors | A `delegations` table: a beat runs as `agent:<persona>` on behalf of an `admin(area)` holder's grant, one capability word, required expiry, revocable, checked at every beat, listed on the quarterly access review | fills a gap (review item 3) |
| D19 | Risk tier | §8: ledger, ACL, infra changes take the full harness plus a human | `risk_tier` and `risk_domains[]` on every item, floored from the diff paths and declared in the PR; `high` needs two reviewer identities from different vendors and an approver holding the grant each touched domain names (`admin(20-29)` for ledger, org-scope `admin` for ACL, infra, migrations); three new closed refusal reasons | makes concrete (review item 7) |
| D20 | Close as a validator | Agents "write durable learnings back" | `learning_attached` exit validator: a suggested learning or skill page, or a signed `nothing_learned`; evidence labels required on every Iterate revision from v1 | makes concrete (review item 8) |
| D21 | Always-on tier | AI Gateway for routing and budgets | `openrouter-messages` engine on a flash-class model for Scout, Iterate, intake, validators; hosted Builder off by default; Grok or other subscriptions fit the external host only | new (Jesse, Zulip) |
| D22 | Scheduled routines as runners | Agent identities and service tokens | A person's own scheduled Claude Code routine is an external runner on a delegation: it authenticates with a non-interactive service token, must present a live `delegation_id` at claim, and writes `agent:<person>/<device> as <persona> via delegation:<id>` on every event; same grants ceiling, bounded further by the delegation; no gate verbs | makes concrete (Jesse, Zulip; tightened by Codex review) |

## Questions for Jesse, and the review's answers

The v1.0 questions, kept with their numbers. Struck ones are answered by the review and applied above.

1. ~~Is the BML harness meant to run on the same engine as the software pipeline?~~ **One engine, two templates** (D1).
2. **Still open.** For the Deploy Package, which channel should be wired first: the web host, the mailing list, or a social connector? The rest can ship as "not yet wired." Tied to D9.
3. ~~Who besides you approves at Ship in v1?~~ **Whoever holds `admin` on the harness's JD area.** A grants-table row, not a name. See "Who may act".
4. ~~Does a phone app belong in v1?~~ **No.** Web push and the Zulip bot serve "waiting on you" (D2). **Please confirm explicitly**, since your earlier v1 brief asked for iOS and Android.
5. ~~May Iterate open a revision unattended?~~ **Yes, only under a delegation with an expiry** (D18).
6. ~~Who may run externally, and how are their tokens counted?~~ **Anyone with `editor` on the area; tokens tracked separately as contributed time, never against the API budget** (D11, D13).
7. ~~Is the scout pass its own persona?~~ **First step inside Builder for v1;** promoted when premise-refusal rates show it earns its own stage. The Iterate box in the BML drawing is worked by the Iterate persona, with a person at the gates it feeds.
8. ~~Persona creation: form in v1, interview in v1.1?~~ **Yes.** Evidence labels ship in v1 regardless (D20).
9. ~~Budget?~~ **Builder external by default, the always-on tier on a cheap model, the breaker capped at the brief's number** (D17, D21).

New since the review:

10. Which flash-class model, through OpenRouter, should the always-on tier start on? GLM 5.3 flash was your example; the research note will price two or three.
11. Should `high`-tier items require the two reviewer identities from day one, or can v1 run with one reviewer until the Codex engine is wired, with the tier recorded either way?

## Review responses

One row per item in *Harness v1 - Architecture Review.md*, plus two points Jesse raised on Zulip on 2026-09-28 that the written review does not cover.

| Item | The review said | Response | Where |
|---|---|---|---|
| 1 · Bind to the platform ACL | The harness names no areas, roles, or grants; it must derive from the plan's one model | **Accepted in full.** `harnesses.jd_area` added; claim = `editor(area)`, approve = `admin(area)`, finance-touching items add `admin(20-29)`; D13 rewritten; "classified internal" replaced by the area's §2.6 classification; BML measurements limited to public analytics in v1; two CI tests named | "Who may act", D13, question 3 |
| 2 · Ship invariant in Postgres | `exit_gate` as a column lets a template or an agent set Ship's exit to `checks`; fix it in Postgres and add a property test | **Accepted in full.** `connector` column; both gate columns `NOT NULL` and a null-safe check constraint (Codex caught that a bare implication passes on null); stage rows editable only by an `admin(area)` command; property test walks every template including `feeds` edges, in CI and at activation | "The gate is a constraint", Figure 2 code block, D8 |
| 3 · Delegations for unattended loops | Beats must not carry a person's authority indefinitely; authority is the approver's, time-boxed, revocable, with an explicit delegation record | **Accepted in full.** `delegations` table; beats run as `agent:<persona>` on behalf of an `admin(area)` holder; required expiry, revocation, and grant re-check at every beat; fail closed with `delegation_lapsed`; listed on the access review | "Unattended loops run on a delegation", Controls, D6, D18 |
| 4 · One verb registry | Union of both lists, published from the contract package; plan §6 references it | **Accepted in full.** Registry table added; `search_pages` and `query_entities` join the harness verbs; the "do not exist" list gains publish | "One verb registry", "What v1 ships" |
| 5 · Reconcile the cost line | Roughly 2× over the brief; default Builder to the external host, cap the Gateway at the brief's number, add an AI-runs line to the brief, re-verify the seat price | **Accepted in full**, with Jesse's always-on tier as the mechanism for the cheap hosted runs. Seat price marked as to be re-verified rather than dropped | "What it costs", D17, D21 |
| 6 · Engine hosts in the topology | Sandbox and Containers belong in plan §1: Builder-only, no state, laptop host as fallback | **Accepted**, extended to Reviewer since `codex-sandbox` needs a container too | "Where the engines live", D5 |
| 7 · Risk tier in the Ship rule | Add `risk_tier`; `high` takes two reviewer identities from different vendors and the area-admin approver set | **Accepted in full.** Tier and domains floored from diff paths and declared in the PR; the extra approver grant follows the touched domain, not the tier; three new refusal reasons; ship rule stays pure with the tier, domains, and one approver principal as inputs, that approver holding every required grant, grant rows locked and re-read when the decision is recorded | "Risk tier in the ship rule", "Who may act", D19, question 11 |
| 8 · Close stage produces memory | Make it a validator; evidence labels from day one, interview in v1.1 | **Accepted in full.** `learning_attached` validator with a signed `nothing_learned` alternative; labels required on Iterate revisions | "Close produces memory, mechanically", D20 |
| 9 · External-runner failure mode | Mark the branch abandoned, or auto-push a WIP commit, so the next claimant does not build on a stale head | **Accepted in full.** `branch_abandoned` on lease expiry; the harness skill pushes a `wip:` commit at the expiry warning; next claim starts from the expected head unless it adopts the branch | "When the laptop dies" |
| Scope cut · phone app | Not a v1 item; web push and the Zulip bot serve the need; keep the contract mobile-ready | **Accepted, pending Jesse's explicit confirmation**, because it reverses the earlier v1 brief that asked for iOS and Android. The document now reads as if the cut stands | "Reaching a person", D2, question 4 |
| Question 7 · Scout | First step inside Builder for v1 | **Accepted.** Three persona identities in v1 | "Personas in v1", Figure 1 caption |
| Zulip · cheap always-on backbone | "Grok subscription and/or an OpenRouter key pegged on whatever models we want... think GLM 5.3 flash" | **Adopted as the sixth engine**, `openrouter-messages`, and as the v1 home of every non-Builder hosted run. A Grok subscription is a personal credential and fits the external host only | "The always-on tier", D16, D21, question 10 |
| Zulip · self-identifying routines | "If I set up a routine to run every hour that codes, could it identify what it is and what role it is playing, recorded on the ledger?" | **Yes, Figure 4 on a delegation.** A routine is unattended, so it claims only with a live `delegation_id`, like any other beat; the identity on every event becomes `agent:<person>/<device> as <persona> via delegation:<id>`; the claim is the identification | "A scheduled routine is an external runner on a delegation", "Unattended loops", D22 |

---

Sources: An App For Everything — Executive Brief, Platform Architecture Plan (§0, §1, §2, §5, §6, §8, §13, §14, §18, §19, §21), Key Visuals (figs. 2, 5, 6), the platform prototype (Home, Development, Agents, Health screens), the BML Harness drawing, and the research note "Engines, hosting, and billing for the harness" (2026-09-28) for every vendor claim and price. Colors follow the unfoldingWord brand tokens used in Key Visuals; Kindle orange marks a human hand on the process and nothing else.
