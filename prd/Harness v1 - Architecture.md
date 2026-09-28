# Harness v1

*The Build · Measure · Learn loop drawn as a mechanism: which component owns each box, where the human hand sits, and how status reaches the web page and the phone.*

**For:** Jesse
**From:** Ian
**Date:** 2026-09-28
**Status:** draft for iteration
**Sits under:** Platform Architecture Plan §1, §6, §8, §18 · Key Visuals fig. 2 and 5 · BML Harness

> **Provenance.** This file is the markdown form of the artifact Jesse reviewed on 2026-09-28 (https://claude.ai/artifact/EpMRSpB9mKa1Pr2kRENrfT). The text is unchanged from that artifact; the figures are the same SVGs, extracted to `figures/`. Jesse's review is in `Harness v1 - Architecture Review.md`. Revisions from here on happen in this file, in git.

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

**What the picture claims.** A persona can reach the platform only through the MCP surface, and that surface has no gate verb, so the orange line from a person to `gate_decisions` is the only way an item passes a human gate. A persona runs on either of two hosts, a platform Workflow or a staff member's own Claude Code, with the same verbs and the same gates; the surface has no internal-only verbs, and it is a versioned registry rather than a fixed list (see "Jobs are config, verbs are code"). The persona concept and its definition are the plan's (§6); the four names shown are worked examples for the two templates. Scout is the plan's "scout pass" promoted to its own persona, Builder and Reviewer are the plan's agent lane and reviewer harness, and Iterate is a proposed name for whoever works the Iterate box in the BML drawing, which names no worker. The engine does not push data to screens; it wakes the live hub, and each screen reads events in order from its own cursor. A phone push is the same idea over APNs and FCM: a wake that names the harness and the reason, never the content, so no harness data lands on a lock screen; the app reads from its cursor on open. A dropped push therefore loses nothing, only time. Pushes are ranked (a gate waiting on you outranks a failed run, which outranks a stage advance) and coalesced into one cooldown window per person, so a weak wake never spends the window a strong one needs, and the device you are already looking at is not woken. The ship rule enters the engine from the outside world, not from the item's own record.

## Figure 2 · One item's journey, on both templates

The engine runs eight generic stages. The software template and the BML template are the same geometry with different names, workers, and connectors. The brackets under the stages are Jesse's four BML boxes.

![Eight stages left to right: Package, Scope, Plan, Build, Check, Ship, Validate, Close. Above each, who works it and its exit gate. Ship is the human gate in orange. Below, two rows name the same stages for the software template and the BML template, and four brackets map the stages onto Product Package, Build Package, Deploy Package and Iterate. A loop arrow returns from Close to Scope as the regular tweak and a dashed arrow from Validate to Package as the occasional tweak.](figures/harness-v1-fig2-one-items-journey.svg)

A stage is a row, not code:

```
harness_stages(key, position, agent_pickup, exit_gate, wip_limit, instructions_page_id, feeds[])
-- the plan's queue_stages plus feeds
```

**What the picture claims.** Both of Jesse's loops fit one stage graph. The human gate sits at the same place in each (between Build Package and Deploy Package), the Scout's premise check is the "explorer" pass the plan already asks for, and the two return arrows from the BML drawing are the `feeds` edges on the stage rows. Choosing which template goes live first is Decision D1.

## Figure 3 · The gate, as a mechanism

Three paths meet at a waiting item. Only one of them can move it.

![An agent submits an item to a gate through the MCP verb submit_to_gate; the item waits on a human. A person's approve command writes a gate_decisions row, the engine records gate_approved and advances the item, and the live hub wakes clients. A struck dashed line from the agent to gate_decisions shows there is no such route and the attempt is logged. At Ship, the engine also evaluates the ship rule over GitHub facts and either advances or refuses with a closed reason.](figures/harness-v1-fig3-the-gate.svg)

An override is allowed, because a person may overrule the reviewers. The override and its reason ride into the audit trail with the merge, exactly as the prototype's merge button says.

**What the picture claims.** The gate is enforced by the absence of a route, not by a prompt. The ship button is enabled by facts read from GitHub at that moment, and the human's decision is the only write into `gate_decisions`. Both facts are testable in CI: "no agent tool or route writes gate decisions" and "the ship rule is deterministic over its inputs."

## Figure 4 · Lending token aid: a person's own Claude Code picks up work

Anyone with a platform login can point their own Claude Code at the harness and work a card with their own tokens. It is the same persona, the same verbs, and the same gates as a platform-hosted run. Nothing about the gate cares where the agent ran.

![Sequence from left to right: a staff member's Claude Code signs in through Access and is minted an agent identity under that person; it polls and claims an item on a lease; a git worktree on branch harness/item is created; the run works, and every record_run_step call renews the lease and reports tokens; submit_to_gate parks the item; the person approves on the phone. If the laptop closes, the lease expires and the item is released for anyone else.](figures/harness-v1-fig4-external-runner.svg)

**Same as a platform run:** verbs, gates, WIP, lease, event log, play-by-play, live updates, write recorded as `agent:<person>/<device>` with grants ≤ that person's, and one CI test: every verb a Workflow can call, an external runner can call.

**Different, and said so:** tokens are reported by the runner, not metered; cost basis is "subscription" on /health. Git writes use the person's own credentials: branch protection and the ship rule's head check guard the merge. No checkpointing: a dead laptop means a released lease.

**What the picture claims.** An external runner is not a special mode. It is a persona on a different host, and the MCP surface is the whole interface, so there is nothing a platform-hosted run can do that a laptop cannot, and nothing a laptop can do that a platform run cannot. Staff, volunteers, and contractors can contribute agent time with their own tokens and their own login, and the merge is still a person's decision.

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

**Why hosted runs use API keys and external runs use subscriptions.** Both vendors draw the line by whose use it is, not by how the model runs. A person's own subscription covers that person's own use of the vendor's own tool, interactively or headless: Anthropic's one-year setup-token exists for exactly that, and its support pages say the Agent SDK and `claude -p` draw on the subscription for personal use. What a subscription does not cover is a product that serves other people: Anthropic's legal page says such products, "including those using the Agent SDK, should use API key authentication," and OpenAI's only documented automation credential on a ChatGPT plan is a Business or Enterprise access token. The harness's hosted personas are an organization's product serving many staff, so they run on organization API keys. A staff member's own Claude Code or Codex on their own seat, connected to our MCP surface, is that person using the vendor's tool, so it runs on their plan. The host is irrelevant to this; Cloudflare neither helps nor hurts.

**What it costs, roughly.** Thirty heavy hosted runs a day (2M input tokens with heavy caching, 75K output) is about $1,600 a month on Sonnet 5 and $2,900 on Opus 5.5 at list, plus under $200 of sandbox compute. The Executive Brief budgets about $1,250 a month for all AI tooling. The levers: cheaper models for Scout and Iterate, fewer and lighter hosted runs, AI Gateway spend limits with one budget across both vendors (open beta), and Builder work done by people on nonprofit Team seats, which Anthropic prices at $8 per user per month with Claude Code included.

## What v1 ships

**Engine**
- Harness, stage, item, event, run, gate decision, measurement, persona tables
- Leases, WIP limits, exit gates, loop edges
- Runs as Cloudflare Workflows, costed per step, hibernating at gates
- Spend breaker on the AI Gateway meter
- Two templates: software delivery, BML product flywheel

**Agent boundary**
- MCP verbs: poll, claim, read, resolve context, write page, submit to gate, record step, health
- No approve, merge, deploy, or advance verbs
- Four personas as configuration: Scout, Builder, Reviewer, Iterate
- Reviewer has its own identity and a different model; verdict read back from GitHub
- Two hosts, first class: a platform Workflow, or a staff member's own Claude Code over remote MCP with their own tokens
- A synced harness skill in the repo so a local session knows the flow

**Web page**
- Flow view: the BML diagram live, with counts, WIP, age, cost
- Board, Gates, Item play-by-play
- Home "waiting on me"; Agent plane on /health
- Every control returns an outcome; unwired controls say so

**Phone app**
- Gates first: approve, reject, take over from a push
- Flow and Board read, reorder, priority; Item play-by-play
- Ranked, coalesced push; resume by watermark after sleep
- Harness data is internal, so it may live on a device

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
| Schedule regular tweak | person | Beats carry the creator's authority and one capability word | owner only |

## Decisions to make together

Each row is a place where this proposal adds to, reorders, or makes concrete something in the plan. The plan's position is quoted so we can see whether a change is real, and whether it is defensible.

| # | Decision | The plan today | This proposal | Kind |
|---|---|---|---|---|
| D1 | First harness instance | §8 doctrine for software; GitHub App in Phase 4 | Software delivery first, BML second, both shipped as templates; GitHub App pulled into v1 because its Deploy and Measure facts are already machine-readable | reorders phasing |
| D2 | Phone app | Web plus Tauri desktop; no mobile | iOS and Android app on the same contract; harness data classified internal; stack open: Kotlin Multiplatform or Expo | new scope |
| D3 | Live updates | HTMX and islands; Durable Objects reserved for page sync hubs | One Durable Object per active harness as wakeup hub with per-session cursors; polling stays as the fallback | extends DO use |
| D4 | Client contract | Zod at every boundary; shared TypeScript types | A published contract package, one live version, golden fixtures, CI conformance, so web, phone and personas cannot drift | addition |
| D5 | Where agents run | Workflows; evaluate Cloudflare OS at Phase 4.5 | Two first-class hosts in v1: uw-app Workflows, and a staff member's own Claude Code over remote MCP. One tool registry, one CI test that the two hosts see identical verbs. Cloudflare OS becomes a third host later, not a replacement | extension |
| D11 | Spend from external runners | Per-run cost through AI Gateway; circuit breaker | The platform meter cannot see a laptop's tokens, and a subscription run has no dollar cost. External runs self-report tokens per step, labelled subscription on the board and on /health; the breaker never counts them against the API budget. Hosted runs read AI Gateway's cost data; no token ledger of our own | new |
| D16 | Engine seam | Workflows host runs; model provider unstated | Five engines behind one seam, chosen per persona: claude-messages in the step, claude-code-sandbox, claude-managed-agent, codex-sandbox, external. A vendor SDK is named in one directory; a CI text gate refuses it elsewhere. A new engine is a directory, never a branch | makes concrete |
| D17 | Billing by host | AI Gateway budgets and a breaker (§6, §18) | Hosted runs: organization API keys, BYOK through AI Gateway, one spend limit across Anthropic and OpenAI, hard stop or fail-over to a cheaper model. External runs: the person's own plan. Nonprofit Team seats ($8 per user per month, Claude Code included) for staff who lend time. No subscription credential is ever stored on the platform | policy |
| D12 | Write boundary on a laptop | Write tokens live in the host step, never in the model process | On a laptop the person's own git credentials are present. Accepted, with three guards: branch protection on main, a `harness/<item>` branch convention, and the ship rule checking that the PR head is the commit the item expected | accepted risk |
| D13 | Who may run externally | Agents have identities and Access service tokens; grants ≤ owner's | Any person with an Access login can mint `agent:<person>/<device>` under themselves; a harness may restrict external pickup to a role. Default open for the software harness, role-gated for BML | policy |
| D6 | Loop edges | Stages in a straight line, ordered by position; a card only moves forward | `feeds` on each stage so Iterate can route to Build or Package | extension |
| D7 | Item history | `history jsonb` on `queue_items` | A `harness_events` table as the source of truth, with replay ≡ record pinned by test; it is also the dashboard feed | column → table |
| D8 | Ship gate | "Mechanical gates"; PR declares what it closes, risks, touches | A pure function over GitHub facts with a closed set of refusal reasons; the item's own record is not an input | makes concrete |
| D9 | Deploy Package target | §7 publish pipeline: R2 + KV, uw-www | Is the BML harness's web host the platform's publishing module, or external hosts? Decides whether uw-www joins v1 | open |
| D10 | Product Package shape | Page-type registry | Three typed pages, `system_goal`, `product_strategy`, `data_sources`, under a product page, so agents read the package as markdown | extension |
| D14 | When a persona needs a verb that does not exist | "Personas are configuration: new ones are data, not code" | Keep the rule by bounding it: personas select verbs, skills may carry sandboxed scripts over existing verbs, and a new verb is a reviewed PR. `requires_tools` on a persona; a missing verb opens a card in the software harness instead of failing silently | makes concrete |
| D15 | How a persona is made | Personas are data; no creation flow described or prototyped | `persona` is a page type: typed frontmatter form (identity, owner, harness, toolset limited to the creator's grants, run shape from a registry, model, budget, capability word, `requires_tools`), markdown body as instructions, `suggested` → `active` flipped by a person after a tool check and a dry run; the page's default view is the persona's dashboard. Interview-driven creation via the intake persona in v1.1 | fills a gap |

## Questions for Jesse (or Jesse's Claude)

1. Is the BML harness meant to run on the same engine as the software pipeline, or do you see them as separate things? Figure 2 assumes one engine.
2. For the Deploy Package, which channel should be wired first: the web host, the mailing list, or a social connector? The rest can ship as "not yet wired."
3. Who besides you approves at Ship in v1? The gate model supports any human identity with the right grant; the question is policy.
4. Does a phone app belong in v1 at all, and if so is "Gates first" the right first screen?
5. Should the Iterate persona be allowed to open a revision unattended (a scheduled beat with a capability word), or must every revision start with a person?
6. External runners (Figure 4): should any staff login be able to pick up software-harness cards from their own Claude Code, or only a granted role? And should reported spend count against the harness budget, or be tracked separately as contributed time?
7. Personas: is the scout pass its own persona with its own stage exit, or the first step inside the Builder's run, as §6 reads literally? And in the BML drawing, is the Iterate box a person's job, an agent's, or both?
8. Making a persona: is "a persona is a page type with a typed form, activated by a person" the experience you want for non-technical staff, with the interview layer in v1.1? Or should the interview be the v1 front door?
9. Budget: the Executive Brief's AI-tooling line is about $1,250 a month. Thirty heavy hosted runs a day exceeds it on any current model. How much of the Builder work do you expect people on their own seats to carry, and should we apply for Claude for Nonprofits Team seats now?

---

Sources: An App For Everything — Executive Brief, Platform Architecture Plan (§0, §1, §2, §5, §6, §8, §13, §14, §18, §19, §21), Key Visuals (figs. 2, 5, 6), the platform prototype (Home, Development, Agents, Health screens), the BML Harness drawing, and the research note "Engines, hosting, and billing for the harness" (2026-09-28) for every vendor claim and price. Colors follow the unfoldingWord brand tokens used in Key Visuals; Kindle orange marks a human hand on the process and nothing else.
