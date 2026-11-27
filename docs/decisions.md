# Decisions

Why the unfoldingWord Platform is shaped the way it is, and what was rejected on the way. [`PRD.md`](PRD.md) says what the platform does and [`architecture.md`](architecture.md) says how it is built; this file says why, so that nobody reopens a settled question without knowing what was already weighed.

**How to read it.** Part 1 holds the numbered decisions. Other documents, tests and commit messages cite them as "ADR NNNN", and that number is the entry's heading here. Part 2 holds the shorter design decisions of the workflow module, which keep their original ids (D, P, V2, V3). Part 3 holds product rulings that no numbered entry covers. Each entry states the ruling as it stands today, not as it stood on the day it was made.

**Numbers are never reused.** 0016 was withdrawn and stays empty. Two pairs of entries once shared a number; the page editor entry is now 0030 and the knowledge category entry is now 0031. An older commit or pull request that says "ADR 0017" for the editor or "ADR 0018" for knowledge categories means 0030 or 0031.

**When to add an entry.** In the same pull request as the change, when the change is hard to reverse, surprising without context, and the result of a real trade-off. A change that is none of those needs no entry. Take the next free number.

**When a later entry changes an earlier one, both say so.** The later entry names what it changes; the earlier entry's "Changes / changed by" line names the later one, and its Decision text is rewritten to the ruling now in force.

**What does not belong here.** Whether something is built (that is the GitHub epic), lists and counts the code already holds (name the file), and how to do the work (`AGENTS.md`).

---

# Part 1. Decisions

## 0001 The kernel is pure TypeScript over ports, driven headlessly in a sim

*2026-09-29, amended 2026-10-01.*

**Decision.** The stage machine, the ship rule, the walker, the fold and every workflow module live in `packages/harness`, the kernel: pure TypeScript with no Worker, vendor or database import, reached only through a fixed set of ports, the database included. Each port has a platform adapter in `apps/uw-platform` and a test adapter in `sim/`, and one contract test that runs against every adapter. The sim wires workflows over test adapters, a fixture GitHub and scripted personas, so an item's whole journey runs in Node without a deployed Worker. The Store port's test adapter is the same Drizzle implementation as production (`packages/db/store`) over an embedded Postgres running the real migrations. "Kernel" names the pure core; "engine" means only the code behind the model-vendor seam. Validators are a registry inside the kernel, not a port.

**Why.** The design names its guarantees as tests (replay equals record, every path to an external effect crosses a human gate, the ship rule is deterministic, both hosts see the same verbs) and names seams that vary (engines, connectors, validators, hosts). Both point to a core that can be driven without infrastructure. A hand-written in-memory Store would have to imitate transactions, the Ship check constraint, the conditional lease claim and the append-only rule, and a green sim would then prove the kernel against the imitation.

**Rejected.**
- Kernel logic written directly against Drizzle, Cloudflare Workflows and vendor SDKs inside the Worker. Staging would be the only place the workflow could be observed, and the property tests would become integration tests nobody runs.
- Dropping the Store port and letting command handlers talk to Postgres, keeping ports only for external services. The kernel reaching everything outside itself through a port is the shape, and the embedded Postgres removed the cost that argued against it.
- "A port with a single adapter is a defect." Replaced by: every port has a platform adapter and a test adapter, and may have more platform adapters.

**Consequences.** The Worker is thin: adapters, rendering and wiring. dependency-cruiser and ESLint enforce the layering, so a violation is a red build. `sim/` may import `packages/db` and Node built-ins. The guarantees only separate Postgres connections can prove run on a Postgres server in CI; `architecture.md` lists which.

**Changes / changed by.** Amended by 0033: only the kernel reaches Postgres through a port. 0019 and 0028 each decline to add a port for code the kernel never calls.

## 0002 Agents reach the platform only through the MCP surface, and gate verbs do not exist

*2026-09-29.*

**Decision.** A persona touches the platform through one remote MCP server that serves exactly the verb registry published by `packages/contracts`. There is no verb for approving, merging, deploying, publishing or advancing past a human gate, for any agent identity, on any host. A persona is configuration over the verb registry and the run-shape registry; it selects from both and adds to neither. A new verb, run shape or engine is reviewed code.

**Why.** The gate is enforced by the absence of a route, not by a prompt or a permission check a prompt could talk around. A verb that does not exist cannot be granted.

**Rejected.** A broad internal API that agents call with a role that denies the dangerous verbs. The boundary would then sit in an authorization check every new route has to remember, and a persona would have somewhere to ask for an exception.

**Consequences.** The served tool list is tested equal to the registry and free of the forbidden names (`FORBIDDEN_VERBS` in `packages/contracts/verb-names.ts`). Activating a persona whose `requires_tools` names an absent verb fails visibly and opens a card on the software workflow. Both hosts see the same tools, asserted in CI.

**Changes / changed by.** 0010 adds no verb but changes what the kernel does with `submit_to_gate` at a merge Ship stage when the claim carries a live merge delegation. 0020 and 0028 each confirm the rule for a new capability (no verb takes a credential reference; `render_pdf` makes a file and cannot send it).

## 0003 The Ship gate is a Postgres invariant, and the ship rule is a pure function over facts

*2026-09-29, amended 2026-10-15.*

**Decision.** Two rulings that only work together. First, a stage with an external effect cannot exit without a human: `harness_stages.connector` and `exit_gate` are `NOT NULL`, and a check constraint requires `connector = 'none' OR exit_gate = 'human_approval'` on insert and update. Templates stay data; the invariant does not. Second, whether Ship may exit is decided by a pure function whose inputs are GitHub facts about the head commit, the item's risk tier and domains, the workflow's required checks and freeze, and the approver's principal with its resolved grants. The item's own narrative record is never an input. Its output is advance, or refusals from a closed set. When a decision is recorded, the command locks and re-reads the approver's grant rows in the same transaction as the `gate_decisions` insert. The rule runs a second time immediately before the merge connector, and the connector merges only the head that second run evaluated.

**Why.** An earlier draft held both "a stage is a row, not code" and "the gate is the absence of a route", which conflict: a template author, an admin or an agent with page-writing rights could lower Ship's gate. Review also found that a bare implication passes on null and that a co-transactional read is not atomic under read committed; both are answered by the constraint text and the lock.

**Rejected.**
- The exit gate as template data only.
- A stored verdict the merge reads. A verdict written for one item or one head can be read for another.
- A quorum of approvers. The rule takes exactly one approver principal; an item touching two risk domains needs one approver holding both grants.

**Consequences.** Stage rows are edited only by an admin command, never through a page. A property test walks every template's paths, loop edges included, and fails if any reaches an external effect without a human gate. Two tests stay on real Postgres: the migration test that tries to insert an effect stage with a `checks` exit, and the race test in both orders.

**Changes / changed by.** 0010 adds the delegated Ship exit: the "approver is a human" check is unchanged, new checks bind an agent actor to a merge delegation, and the rule's input gains the delegation's tier and the protected paths.

## 0004 Events are the source of truth; item state is a fold, and replay equals record

*2026-09-29.*

**Decision.** Everything that happens to a workflow is a row in `harness_events`: append-only, from a closed vocabulary in `packages/contracts`, carrying the actor's full identity string, the host and the cost basis. An item's state is a fold over its events. The play-by-play, the queue, the dashboard feed, the live hub's wakes and the audit trail are all reads over the same rows; none keeps its own bookkeeping. Failures are events too.

**Why.** One source means the dashboard, the audit trail and the play-by-play cannot disagree. Recording a refused gate attempt, a refused stage edit and a lapsed delegation as rows is what makes the gaps visible on screen instead of hidden in a prompt.

**Rejected.** A `history jsonb` column on the item. The item row would be the truth and the history a copy that drifts.

**Consequences.** The database refuses UPDATE, DELETE and TRUNCATE on `harness_events`. A property test asserts that folding an item's events reproduces its stored record. Clients hold a cursor into the log and read forward from it, so a dropped wake loses time and nothing else. Adding an event is a contract change to a shared root and is named in the pull request; it may share a commit with the feature it serves (`AGENTS.md` rule 4), which replaces this entry's first wording that it must be its own pull request.

**Changes / changed by.** 0020 rules that a credential use is not a workflow event.

## 0005 Unattended work runs on a delegation, on every host

*2026-09-29.*

**Decision.** An unattended beat (a scheduled Cloudflare Workflow, or a person's routine on their own machine) carries no one's authority. It carries a delegation: a row in which a person holding `admin` on the workflow's area grants a persona one capability word for a bounded time, revocable, with a required expiry that defaults to ninety days. Every unattended claim, on either host, presents a live delegation or is refused `delegation_required`. At every beat the kernel checks that the delegation is unexpired, unrevoked and that the grantor still holds `admin`; any failing stops the loop and writes `delegation_lapsed`. The identity on every event names the host and the delegation. A routine is bound to one delegation: its machine login presents that delegation or is refused, a paused routine is refused, and revoking the routine deletes its Cloudflare service token.

**Why.** The platform requires a principal on every request, and an unattended beat has no live human session to mint one from. The authority must be the approver's, must end when the person leaves or loses their grant, and needs an explicit record.

**Rejected.**
- "Beats carry their creator's authority." It never ends and names the wrong person.
- Treating a person's scheduled routine as an ordinary external runner. That quietly exempted it from the delegation check.

**Consequences.** A non-interactive principal cannot claim without a delegation id. Delegations appear on the person's page, the persona's dashboard and the access review, as time-boxed grants do.

**Changes / changed by.** 0010 gives the capability word `merge` a maximum tier and makes it alone able to lend the Ship exit.

## 0006 Two first-class hosts, one verb registry, an engine seam, and billing by host

*2026-09-29, confirmed 2026-11-17.*

**Decision.** A persona runs on either of two hosts with the same verbs and the same gates: a Cloudflare Workflow inside the platform, or a staff member's own Claude Code or Codex on their own machine over remote MCP. Neither is a special mode. The model vendor sits behind one seam, with each engine in its own directory under `apps/uw-platform/engines/` (the registry there is the list); a vendor SDK is imported in exactly one directory. Billing is a property of the host, not the persona. A platform-hosted run is metered on the organization's API keys through AI Gateway under one spend cap. An external run is the person's own subscription, with tokens self-reported, labelled as contributed time and never counted against the API budget. Hosted Builder is off by default; the always-on tier (scout passes, Iterate, intake, validators, and Reviewer by default) runs on `openrouter-messages` on a cheap open model, which makes that engine the platform's baseline model service. `high`-tier items add a second reviewer identity on another model provider.

**Why.** The vendors' own line: a person's subscription covers that person's use of the vendor's tool, and a product serving other people must use API keys. The hosted personas are the organization's product; a staff member's own tool on their own seat is not.

**Rejected.**
- Storing a subscription credential or SDK login on the platform. Considered again when the hosted agents were first configured and declined on 2026-11-18 (issue 98): organization API keys through AI Gateway stay the only hosted billing.
- A branch per engine in shared code. A new engine is a directory, never a branch in another.
- Failing over to a cheaper model when the cap is reached. The breaker stops (P27).

**Consequences.** Cloudflare Sandbox and Containers are Builder and Reviewer hosts only, holding no state, with the laptop host as the fallback. A Grok or other subscription fits the external host only; an API key for any vendor is one more engine directory. The cap and the always-on model are settings in the wrangler configuration, set by an owner.

**Changes / changed by.** None.

## 0007 Tailwind 4 over the brand tokens

*2026-09-29.*

**Decision.** Screens are styled with Tailwind 4, whose theme is defined in CSS from the unfoldingWord brand tokens, not from Tailwind's defaults. The tokens live in `packages/ui/tokens/*.css` and are the only source of a colour, size, spacing step, radius or shadow. Light and dark follow the system setting with a persisted user override. Kindle orange marks a human action and nothing else. Nothing hard-codes a hex value.

**Why.** Tailwind's value here is not dark mode, which the tokens already provide, but one vocabulary for consuming them.

**Rejected.** Hand-written CSS per island against the same variables. It would work and would drift: every island would carry its own spacing scale and its own dark-mode branches.

**Consequences.** A value that is not in the tokens is a design change, not a code change, and a check fails the build on one.

**Changes / changed by.** 0011 changed the tokens' source (generated scales, not a prototype's CSS) and widened the lock from hex literals to every value a screen can choose. 0029 withdrew this entry's original intent that a `design-system/` folder would replace the token files: the tokens stay in `packages/ui/tokens/`, and `design-system/` holds reference boards that code never imports.

## 0008 Issues are the work, Codex reviews every pull request, a human squash-merges

*2026-09-29. Superseded.*

**Decision.** No longer in force. It set: work only as GitHub issues under milestones, pickup by a `ready` label, one open pull request per worker, `harness/<issue>-<slug>` branches off `main`, a Codex review round on every pull request, and a human squash-merge to `main` enforced by hand because branch protection was unavailable.

**Why it went.** It was superseded on 2026-10-01 when the work list moved out of issues, and again on 2026-11-12 by the branching model in 0032. What survives from it: Conventional Commits, hooks always pass, `--no-verify` is never used, and a person decides every merge to `main`.

**Rejected at the time.** Markdown lists of work, which drift, and one pull request per review item, which was too slow.

**Changes / changed by.** Superseded by 0032 and by `AGENTS.md` sections 7, 7b and 8.

## 0009 The person surface decides gates

*2026-10-03.*

**Decision.** People approve, reject, take over and override gates, and recover lost connector results, through the command API. The person surface is one directory, `apps/uw-platform/commands/person/`. It is the only place in `uw-platform` that calls `kernel.gates`, `kernel.stages` and `kernel.delegations.grant` or `revoke`, with one exception named below. Nothing reached from `apps/uw-platform/mcp/` may reach any file under `apps/uw-platform/commands/`. Only `commands/person/gates.ts` builds a kernel wired with GitHub writes, and only for a principal whose identity is a person's.

**Why.** The kernel's own refusals are the enforcement: `kernel.gates.decide` refuses every agent identity, records the refusal, re-reads the approver's grants under lock and requires `admin`. The static check is the backstop that keeps a gate call out of anything an agent's import closure reaches, and a directory makes the rule visible from the layout.

**Rejected.**
- A second Worker for people. It would keep gate calls out of the agent Worker's bundle, but doubles the deploy surface, the Access applications, the bindings and the health checks, for a guarantee the kernel already gives at runtime.
- An allow-list of individual handlers in the static check. It drifts each time a handler is added or split, and a reviewer cannot see the rule from the layout.

**Consequences.** A new handler that touches gates, stages or delegation grants lives in `commands/person/`. dependency-cruiser refuses an import from `mcp/`, `engines/`, `queue/` or `cron/` into `commands/`.

**Changes / changed by.** 0010 adds the one file outside the person surface that calls a gate command: `apps/uw-platform/cron/delegated-exits.ts`, which calls only `kernel.gates.exitDelegated` as the system principal.

## 0010 A person may lend an agent the Ship exit for a merge, under a delegation

*2026-10-15.*

**Decision.** A workflow can opt into one unattended Ship exit. A person holding `admin` on the workflow's area grants a persona a delegation whose capability word is `merge`, with a maximum risk tier of `low` or `standard`, an expiry and revocation. An agent holding it may claim an item at a stage whose exit is `human_approval` with the `merge` connector, and submit it. Inside the `submit_to_gate` transaction the kernel locks and re-reads the delegation and the grantor's grants, runs the ship rule with the delegation as an input, and either records one gate decision or records `ship_refused` and leaves the item parked for a person. The decision's approver is the granting person, its actor is the agent, and it names the delegation. The merge itself runs from the minute job, which refreshes the GitHub facts, re-checks the delegation and the grantor's `admin`, and runs the ship rule again before the connector. A delegation never covers deploy or publish, a changed file under a protected path, a change above its tier, `high` at all, a shadow workflow, or a loop target.

**Why.** At a small team's volume, low-risk merges waiting on a click were the bottleneck. Lending the exit keeps a named person as approver of record, bounded by tier, protected paths, expiry and the rule run twice.

**Rejected.**
- An agent `merge` verb. It would put the merge on the MCP surface, where 0002 says a gate verb cannot exist, and every host would serve it.
- A per-repository auto-merge flag with no grantor. Nobody would be the approver of record, expiry and revocation would not apply, and the Postgres rule would need an exception for a row with no person.
- Running the merge on the agent's own request. It would put a GitHub write client in a kernel an agent's request builds.
- Letting a delegation cover `high`, deploy, publish or protected paths. Those stay a person's at the keyboard.

**Consequences.** A workflow that opts in merges a change nobody read. Delegated merges are shown on the gates screen, in the play-by-play and on health, and wake the grantor. Exactly two functions write `gate_decisions`: the gate command's `recordDecision` and `recordDelegatedDecision` in `packages/harness/gates/delegated-ship.ts`; `tools/architecture/gate-writers.ts` holds that. Whether the platform's own repository may ever be given a merge delegation is a person's decision and is open.

**Changes / changed by.** Changes 0002 (no verb added; `submit_to_gate` behaves differently under a merge delegation), 0003 (new database checks bind an agent actor to a merge delegation and its grantor; the rule gains `tier_above_delegation` and `protected_path_needs_person`), 0005 (`merge` alone carries a maximum tier and lends the exit; `high` is refused `tier_not_delegable`) and 0009 (one more GitHub-wired kernel, in the minute job).

## 0011 One token system, generated from the brand colours and locked in Tailwind

*2026-11-04.*

**Decision.** Screens use one set of tokens and nothing else: colour scales computed in OKLCH from the brand colours with each brand hex exact on its step and a grey tinted toward Ocean; roles that name a job, mapped per theme to one step of a scale; fixed scales for type, spacing, radius and shadow; and named layout widths. The values are the files in `packages/ui/tokens/`. Every text role on every surface role passes WCAG AA in both themes, and a test says so. The fonts are bundled with the Worker because the content security policy is `font-src 'self'`. The token scales are the whole Tailwind theme: Tailwind's default spacing is cleared as its colours are, and a check fails the build on any arbitrary value in a class and on a raw colour, size or shadow outside the token files.

**Why.** With one colour and one tint per brand colour, three greys, one spacing unit and no shadows, every screen chose for itself: the mockup rounds accumulated 25 font sizes, 24 spacing values, 58 hex colours and 42 shadows before they were measured. Define the system first, then use only it; the lock is what makes the rule hold after its authors move on.

**Rejected.**
- Hand-picked shades per screen, which is the state measured above.
- Tailwind's default palette and spacing, which are not the brand.
- A published palette such as Radix Colors, which would need retoning to the brand and so be generated anyway.
- Leaving arbitrary values allowed and reviewing for them. That review did not happen in the first two versions.

**Consequences.** A new value is a design change: it is added to the token files or it does not compile. No automated screenshot check holds the look; it was removed on 2026-11-23 and a person checks by eye.

**Changes / changed by.** Changes 0007 (the tokens' source and the reach of the lock). 0014 retuned the scales to the prototype's look without replacing them. 0029 adds motion tokens and leaves the colour, spacing, type and radius scales unchanged, and withdraws the intent that `design-system/` would replace the token files.

## 0012 Charts are Apache ECharts, drawn as SVG on the server

*2026-11-04.*

**Decision.** Charts are drawn with Apache ECharts using its SVG renderer, by the one chart component in `packages/ui/components/chart.tsx`, rendered on the server into the page's HTML. No animation, hairline grid lines, small axis labels, bars for counts and lines for rates. Colours come from the token roles as classes, never from literals, and the output carries no inline style, so it passes the content security policy. The figure a chart shows is also in the page as text.

**Why.** unfoldingWord's other dashboard, `bt-servant-telemetry`, already uses ECharts with these settings; the same library keeps the organization's charts alike and lets one person's knowledge carry. SVG suits both themes and print, and server rendering suits server-rendered pages.

**Rejected.**
- Hand-written SVG, which grows a private charting library.
- Chart.js and uPlot, which draw on a canvas in the browser only.
- Recharts, which needs React.
- ECharts' Svelte wrapper, because the islands are plain TypeScript.
- A browser island as the default. It was the fallback if server rendering failed under the security policy; it did not.

**Consequences.** One runtime dependency, imported only by the chart component and tree-shaken to the series and parts it uses.

**Changes / changed by.** 0028 prints the same server-drawn SVG. 0038 draws charts from a spec over a whitelisted query, with series tokens beside the four roles.

## 0013 Icons are Font Awesome Pro, installed with a token and never committed

*2026-11-04.*

**Decision.** Every icon comes through one icon component in `packages/ui`, by name. When the Font Awesome Pro packages are installed, the component draws them. When they are not, it draws the nearest Font Awesome Free icon for the same name, and a name with no free equivalent draws a neutral placeholder of the same size. The Pro packages are installed from Font Awesome's registry with a token held as a secret; the token and the Pro artwork are never in this repository. The build and every test pass without the token.

**Why.** The approved look uses Font Awesome Pro Regular. This repository is public, and Pro artwork may not be published in it.

**Rejected.**
- Committing the SVG paths of the icons used, which would publish Pro artwork.
- Font Awesome Free only, which lacks the Regular style for most icons the look uses.
- A different open icon set, which would change the approved look.

**Consequences.** Two looks exist: Pro where the token is, Free where it is not. A Pro icon that renders wrongly is seen by a person, not by CI.

**Open.** This assumes the Pro licence permits installing with the token in CI and in Cloudflare's build, and that the licence is unfoldingWord's and covers this repository. An owner confirms it with whoever holds the licence; until then every environment draws the fallback.

**Changes / changed by.** None.

## 0014 The prototype sets the frame; its values snap to the token scales

*2026-11-12, amended 2026-11-24.*

**Decision.** The frame of every screen is the original Claude Design prototype's: an Ocean sidebar grouped by area code with the white unfoldingWord logo, a white top bar with the area code and breadcrumb, figure cards with an accent top rule, and pale lanes of compact cards. Where the prototype used a value off a token scale, the screen uses the nearest token; the scales were retuned so the prototype's canvas, lines and muted text are exact steps, not replaced. The prototype had no dark theme and no phone layout: dark keeps the same structure a step deeper, and on a phone the sidebar becomes a header whose menu opens the same list, lanes keep their width and scroll, and figure cards go two across. On desktop only the content scrolls. Icons stay Font Awesome, each prototype icon mapped to the nearest name.

**Why.** An earlier redesign drifted from the prototype and was not what the sponsor wanted. The owner chose the prototype's look but not its values: "we need to conform to our design rules." Giving up the lock to match the prototype pixel for pixel would undo the reason for 0011.

**Rejected.**
- Replacing the scales with the prototype's own values, which would bring back the unmanaged values 0011 measured.
- Dropping the lock and writing values by hand.
- Drawing the prototype's own line icons in place of Font Awesome, which the owner declined.
- Leaving dark and phone as they were, which would make the two themes look like two products.

**Consequences.** A screen that differs from the prototype's frame by less than a token step is correct. The prototype itself is not in the repository (it held internal material); this entry and `design-system/` are the record of its look.

**Changes / changed by.** Amended by 0029, which keeps the frame above and withdraws the rest of the prototype's look: the canvas of bordered cards as every screen's container, small uppercase labels, heavy badges, unbuilt modules shown dimmed in the sidebar, and the status bar. 0026 departs from the prototype for knowledge pages, which it never drew.

## 0015 A grant on an area reads only that area

*2026-11-19.*

**Decision.** A grant on a Johnny.Decimal area, of any role, reads that area and no other. Only an `org`-scope grant, of any role, reads every area. Write and admin are unchanged: they need a grant on the area itself or at `org` scope. Everything that filters by `can(read)` or `readableAreas` (`packages/core/acl.ts`) narrows with it: page search and reads, agent context, the untrusted-content clearance key and the notification holders of an area. An agent's MCP session runs with its bound person's grants, so an agent reads only the areas its person holds grants in. To keep the open culture for someone, an org admin grants them `viewer` at `org` scope.

**Why.** The first design let an `editor` or `admin` on one area read every other, to stay as open as the Notion workspace the platform replaces. That meant an editor on 80-89 could read Finance (20-29), and the credentials store, gifts and the ledger would have been readable the same way. Narrowing the default means a new table is closed until someone grants access, and openness becomes a visible, audited grant, not a side effect of being an editor somewhere.

**Rejected.**
- Keep the open read and carve out restricted data by classification. Every new sensitive table would have to remember to opt out, and one that forgot would leak.
- Narrow reads only for `restricted` and `sensitive` tables. Every page type is `internal`, so a page in Finance stayed readable from any area, which was the exposure the owner asked to close.
- A new `reader` role with org-wide read. That is `viewer` at `org` scope, which already exists.

**Consequences.** Workflow lists, search and agent context are scoped to a person's grants. A hosted run reads its persona's instructions only if the run's principal may read the persona page's area, and is otherwise answered `page_not_found`, so a persona page in another area cannot run and its existence is not confirmed. Any runbook that lists who belongs in an area's private channel follows this rule: people with a grant on that area or at `org` scope.

**Changes / changed by.** Overturns the first design's "an `editor` anywhere reads org-wide". 0017 closes the gap this left for `org` grants on restricted rows. 0031 gives every approved person `viewer` on 00-09.

## 0016 Withdrawn

This number was used and withdrawn. It is not reused.

## 0017 A restricted row is read by its declared rule

*2026-11-20.*

**Decision.** A row of a `restricted` or `sensitive` table is read only by the read rule its table declares. A rule has three parts: `area`, the least role on the row's own area that reads it, or none (an `org` grant never counts here); `owner`, whether the person the row belongs to reads it (a person principal only, never an agent bound to that person); and `orgAdmin`, whether an `admin` grant at `org` scope reads it. An org viewer or org editor has no such capability. The rules live in `rowReadRules` in `packages/core/acl.ts`, keyed by table name, and `can(actor, 'read', { kind: 'row', … })` is the one function that applies them. A row resource answers `read` only. A rule is a ceiling, not a grant: a path may show less than the rule allows.

**Why.** Every table declares a classification, but no read checked it. After 0015 one gap was left: a grant at `org` scope still read every row, so an org viewer read every restricted row.

**Rejected.**
- Declare the rule on the table, in `declareTable`. The kernel reads some of these tables and may not import Drizzle, so it would need a second copy of the rule. One registry in `packages/core` with a test against the schema keeps one copy.
- Enforce in the Store gateways. The gateways serve the kernel's own enforcement reads (is this delegation live, has this stage a decision), which have no reader to judge; filtering there would break the gate.
- Postgres row-level security. The Worker reaches Postgres as one role; the principal is not a database role, and it would put authorization beside `can()`.
- Let any `org` grant read restricted rows whose table has no area. That was the gap.

**Consequences.** Two checks keep it true. `tools/properties/restricted-rows.test.ts`: every restricted or sensitive table has a rule and no rule is left for a table that is not one, so a new table cannot land without a rule. `tools/architecture/restricted-reads.test.ts`: every source file that reads such a table is in the ledger `tools/architecture/restricted-reads.ts` as `rule` (rows reach a caller and the file applies the rule), `derived` (only a count or a yes/no leaves the file) or `platform` (the platform reads the row to enforce or operate). An org viewer with no grant on a workflow's area still sees the workflow and its events, which are `internal`, but not its delegations or routines.

**Changes / changed by.** Builds on 0015. 0018 adds the credential resource kind this entry left room for. 0024 extends the same rule shape to single properties.

## 0018 A credential answers four capabilities and never read

*2026-11-20.*

**Decision.** `can()` on a credential resource answers four capabilities, `see`, `use`, `reveal` and `manage`, each by the rule `credentialRules` declares in `packages/core/acl.ts`. A credential answers nothing else: `read`, `write` and `admin` on it are always refused, and a capability asked of an area, the org or a row is always refused. On the credential's own area, `see` and `reveal` need `viewer` or higher, `use` needs `editor` or higher, and `manage` needs `admin`. An org admin gets `see` and `manage` on every credential and never `use` or `reveal` by that grant; an org editor or viewer gets nothing. `use` also needs the use to name a workflow and connector the credential is bound to; `reveal` also needs a live reveal grant for that person on that credential. `see`, `reveal` and `manage` are answered only for an interactive person at the keyboard. An agent may `use`, on its person's grants, and never receives the value. The facts a rule needs (bindings, this use, reveal grants) travel on the resource, so `can()` stays pure.

**Why.** `read`, `write` and `admin` are each satisfied by an `org` grant on every area. A credential that answered them would be used by every org editor and revealed to every org admin.

**Rejected.**
- Map the capabilities onto `read`, `write` and `admin`. `see` as `read` gives every org viewer the list; `use` as `write` gives every org editor every credential.
- Put reveal grants on the principal. The principal travels on every request and queue message; that widens a contract for a fact one screen needs.
- Pass `bound: true` and `revealGranted: true`. Each caller would write its own matching of person, credential, expiry and binding, and one that forgot the expiry would reveal.
- Let an agent `see`. An agent takes a reference from configuration and does not need the list. Opening it later changes one field of one rule; closing it later would break whatever came to depend on it.
- Let a delegation's lent person principal reveal or rotate. It is a person and not interactive; without the interactive rule a delegation would act in its grantor's name.

**Consequences.** A reveal grant adds to an area grant: `reveal` needs the reveal grant and `see`, so a person's reveal grants stop working when their role grants are revoked without anyone deleting them. A reveal grant always expires. A principal that carries no person (the system, an unbound service token) is refused `use`. A restriction of one credential to named people is not part of this rule.

**Changes / changed by.** Builds on 0017. 0019 seals the value, 0020 defines use, 0021 defines reveal and the second-person rule.

## 0019 A credential is sealed under its own data key, wrapped by AWS KMS

*2026-11-20.*

**Decision.** Sealing a value asks AWS KMS for a fresh 256-bit data key. The value is encrypted with it once, with AES-256-GCM through Web Crypto, and the key is kept only wrapped, beside the ciphertext. Rotating adds a version with a new data key; no key seals two values. The encryption context is the credential, the version and the JD area, bound twice: KMS refuses to unwrap under any other, and the cipher takes it as additional authenticated data. The key service is an app-level seam (`DataKeys` in `apps/uw-platform/credentials/data-keys.ts`) with an AWS adapter and an in-memory test adapter running one contract suite; KMS is called with a signed `fetch`, not the AWS SDK. The store's tables have one writer, `apps/uw-platform/credentials/`; the version table and the access log are append-only in the database. One function, `openCredential`, opens a value: it asks `can()`, refuses a revoked or expired credential, and writes the access log, done or refused, before it returns. Access is checked twice and the second check decides: after the unwrap, one transaction locks the credential row, re-reads its bindings, reveal grants and the person's live status and grants, and asks `can()` again before the `done` row is written and the value released. Sealing follows the same rule. Every failure is a closed-set reason; no exception text reaches a caller or the log.

**Why.** The store's first guarantee is that a copy of the database alone reveals nothing, and the storage format is hard to change once a credential is stored under it. The key service can take seconds to answer, so what was true when the request arrived may not be true when the bytes exist. Binding the area into the context means a credential row rewritten to an area an attacker administers does not open.

**Rejected.**
- A Worker secret as the key-encryption key. Simpler and free, but anyone holding that secret and a database dump opens everything, and no unwrap is logged outside the platform.
- One data key per credential reused across versions, or one per area. A nonce would have to be unique per key across rotations, and one leaked data key would open every past value.
- KMS `Encrypt` on the value directly. It fails for values over 4 KB such as a certificate chain or an SSH key.
- `@aws-sdk/client-kms`. A large dependency tree in the Worker bundle for two HTTP calls. If the signer stops being maintained, another replaces it inside `credentials/kms/aws.ts` and nothing else changes.
- A kernel port with a sim adapter. The kernel never seals or opens a credential; a port it never calls would hand kernel code the ability to unwrap data keys. Moving the seam into the kernel's ports later is a file move, and the contract suite already exists.
- `bytea` columns. Base64 text reads the same on Postgres and on the embedded database the tests use, and is what the KMS API speaks.

**Consequences.** Opening a value costs one KMS call. Losing the KMS key loses every credential, so the key needs deletion protection and its policy reviewed as infrastructure. KMS's own key rotation needs no change here; moving to a different key means re-sealing each credential as a new version. Old versions are kept: destroying them after a grace period would need a relaxation of the append-only rule and is not decided. What remains uncovered is the time between the final check's commit and the caller using the bytes; no lock can cover it.

**Changes / changed by.** Builds on 0017 and 0018. 0020 rules out a cache of opened values. 0022 moves the KMS key pair into the Secrets Store.

## 0020 A connector uses a credential by reference, as the run's person

*2026-11-20.*

**Decision.** One function, `useCredential` in `apps/uw-platform/credentials/use.ts`, is the only way a value leaves the store for use. The caller names a credential by reference with the workflow, connector, run and acting principal, and passes a function to call; it never receives bytes or text. The store does not trust the grants on the principal: it looks up the run's person, refuses one who is not active, and reads that person's live grants at the moment of use, and again at the final check of 0019. The value exists as a `Secret` for the length of one call; only `exposeSecret` gives the text back, and afterwards the bytes are zeroed. Everywhere else (a string, JSON, a log line, an event, a page) a `Secret` renders `[secret]` and does not throw. What the caller's function returns is searched for the value before it is handed back, and an outcome that carries it or cannot be walked is refused `value_in_outcome`; a function that throws is answered `connector_failed` with no text. Binding and unbinding need `manage` and are logged. Nothing is cached. No verb is added and no verb takes a reference: a reference is named in configuration a person writes, never in a tool call. A use is a row in the credential access log, not a workflow event.

**Why.** A value has to get from the store to the outside service a connector calls without passing through anything an agent can read. Connectors run on a stage's exit after its gate, never from a verb, so a verb that ran one would let an agent pass a human gate. An event naming a credential would tell everyone who reads the workflow's area that it exists, which is `see`.

**Rejected.**
- Trust the grants on the principal. A grant revoked during a long run would keep working until the run ended.
- A person principal built for the check, as a delegation's lender is. The log would then name the person as the actor of a call an agent made.
- Return the value and trust the caller to drop it. One caller that put it on a result would leak it into an event.
- A `Secret` that throws when serialised. It finds the mistake sooner, and fails a production request for a mistake that leaked nothing.
- A short cache of opened values. It keeps plaintext in an isolate between requests and lets a use succeed after a revoke with no matching log row.

**Consequences.** Build rules hold the boundary: only the store imports the files that open a sealed value; only the store and `apps/uw-platform/ports/connectors.ts` import `use.ts` and `secret.ts`; nothing under `mcp/`, `engines/`, `runs/` or `agents/` imports the store. A JavaScript string cannot be zeroed, so the exposed text lives until garbage collection. The outcome search is a net, not a proof: the build rules are the proof. `manage` on the credential is enough to bind; a use still needs `editor` on the credential's own area. The binding, which names the workflow, is what keeps a delegated run to the credentials meant for it.

**Changes / changed by.** Builds on 0002, 0017, 0018 and 0019. 0021 adds the one file that opens a value for a person.

## 0021 A value is revealed in one uncached answer, and a break-glass reveal needs a second person

*2026-11-20.*

**Decision.** One route returns a value, uncached, to an interactive person: `revealCredential` (`apps/uw-platform/credentials/reveal.ts`) calls `openCredential`, and a build rule lets only `credentials/routes.ts` import it. The value is in no page, URL, event or log line; the browser shows it on an explicit action and forgets it after one minute, on Hide and when the page is left. A person who cannot `see` a credential is told it does not exist, while the log records the refusal. A reveal tells every other admin of the credential's own area by web push; the notice names the area and never the credential, has no cooldown, and a failed push does not hold the value back. A break-glass reveal is a reveal grant that waits for a second person: a grant given by an org admin who is not an admin of the credential's area counts for nothing until a second person who may `manage` the credential confirms it, and the database refuses a confirmation by the giver. A reveal grant lasts between 5 minutes and 24 hours.

**Why.** Rendering a value into a page leaves it where a proxy, a cache, the service worker or the back button could keep it. Saying "not permitted" confirms an id exists.

**Rejected.**
- Render the value into the page.
- `not_permitted` for a credential the asker cannot see.
- A separate break-glass table or command. The grant row already says who, for whom and until when; two columns say who confirmed it.
- Block the reveal until every admin's push is delivered. A person with no device, or a push service that is down, would lock every value.
- Requiring two org admins. An area admin could give the same grant alone, so their confirmation is at least as strong, and an area with an admin on hand should not have to find a second org admin.
- A Zulip post. It goes to the area's channel, whose members include people with no `see`.
- Sending the notice through the kernel's Notifier port. A wake names a workflow; a credential has none (recorded in `docs/exceptions.md`).

**Consequences.** An area admin may give themselves a reveal grant; the other admins are told at the reveal, not at the grant. An area with one admin has nobody to tell, and the access log is then the only record. A value shown in the browser can be copied by the person who sees it.

**Changes / changed by.** Builds on 0018, 0019 and 0020.

## 0022 Platform secrets are read at the Worker's entry, from the Secrets Store first

*2026-11-20.*

**Decision.** `withSecrets(env)` (`apps/uw-platform/secrets.ts` and `apps/uw-ingest/secrets.ts`, over `packages/core/platform-secrets.ts`) runs before a request, queue batch, cron or run is handled, and returns the same bindings with every listed secret as a plain string under its old name. A secret `X` is read from the Secrets Store binding `STORE_X` when one is declared, and from the Worker secret `X` when none is, so both can exist at once and removing the binding puts the Worker secret back in use. A fallback is never silent: an unreadable binding turns the `secrets` health indicator red and logs the secret's name, while health itself only counts sources and never names a secret, because the probe is public. A value is read once per Worker instance and re-read every five minutes. Each binding is declared in the go-live wrangler file and copied into the live one secret by secret, each with an owner and rotation date in `infra/secrets-store.json`. Store names carry the environment. The AWS key pair for KMS is among them, bound to `uw-platform` only, with its IAM policy in `infra/aws/credentials-kms.json`; it is an IAM user, because a Worker has no identity AWS can trust to assume a role.

**Why.** Every secret was a Worker secret readable by the whole Worker. A stored value cannot be read back, so the move re-enters or re-issues every value by hand; how the code reads a secret and how the move is made reversible are both hard to change once production depends on them.

**Rejected.**
- Switching in one step with the binding under the secret's own name. What a deploy does when a binding and a Worker secret share a name could not be confirmed; with two names the rollback is a revert.
- Making every reader async. About twenty modules and their tests would change for no gain: least privilege here is per Worker, set by its bindings.
- Reading on every request with no memory.
- Names in the health indicator. Easier to act on, but the probe is public; the names are in the log.
- Amber while any Worker secret is still in use. Every environment would show Watch until its move is done and people would stop reading it.
- Moving the GitHub App ids and installation ids. They are not secrets.

**Consequences.** Until a person moves an environment, nothing changes there and health says so. The deploy token needs Secrets Store edit rights, and can then create, replace and delete stored secrets, though not read them. A rotated or revoked value takes up to five minutes to arrive. The runbook is in `infra/README.md`.

**Changes / changed by.** Builds on 0019.

## 0023 A collection is a stored definition over pages or records

*2026-11-21.*

**Decision.** Five rulings.
- **A collection's schema is data.** A collection is a row with one row per property; each property's settings are validated by the property catalogue in `packages/contracts/collections.ts`. On every write the whole definition is checked against every other collection, and a row is parsed by the schema compiled from the definition at runtime. A definition change that would break a saved view is refused with the views named. Each change advances the collection's version and keeps the full definition. The built-in collections (`apps/uw-platform/collections/builtins/`) go through the same create path. Changing a definition is a person's command needing `admin` on the collection's area; no verb does it. A property's type change is all or nothing across every row.
- **Values live in `pages.frontmatter`; relations in `page_links`.** No entity-attribute-value table and no runtime DDL; Drizzle stays the only schema. A collection page's frontmatter is written only through a collection command, so `pages` keeps one writer.
- **A collection owns no money.** The catalogue has no money type. Money is a read-through property from a closed set of feeds served by the budget module; no collection command writes one.
- **Computed properties are a closed set**, with rollups over a relation. No formula language.
- **A collection lists pages or typed records.** Each property declares its source (a frontmatter key, a typed column, a relation, a computed value, a read-through feed or a system field); the query engine compiles each to SQL and views do not know the difference. A write to a record goes through its owner module's command.

**Why.** The Notion databases the platform replaces are database-shaped pages with typed properties, relations and saved views. Building each as its own screen would make every new one a pull request.

**Rejected.**
- Zod in code only. Every new collection would need a deploy.
- A real column per property, as Twenty, NocoDB and Baserow do. Runtime DDL from a Worker breaks "Drizzle is the only schema", and data queried hard already lives in typed records.
- One JSON blob per view or per definition. A deleted property would leave dead filters behind; properties in their own rows let a saved view hold a foreign key to one.
- A stored money type behind a permission. It would be a second writer of figures the budget module owns.
- A general formula language. A parser, SQL compilation, a dependency graph and injection hardening; if one is ever wanted, an existing sandboxed expression library is used.
- Inline databases with a private schema inside a page. Every collection is a page type.

**Consequences.** Page types that hold collection rows have a permissive registry schema; their real schema is the collection's compiled one, and `create_page` refuses those types so a row is always created through its collection. A collection with very many rows may outgrow JSONB extraction; the answer then is a typed table under the last ruling, not runtime DDL.

**Changes / changed by.** 0024 classifies single properties. 0025 makes the directory row a person's profile. 0027 refuses a tier-named select on any built-in collection.

## 0024 A property can be classified narrower than its row

*2026-11-21.*

**Decision.** A collection property may declare a classification narrower than its row (`restricted` or `sensitive`) with a property rule: `steward`, the JD area whose grant reads it (or the row's own area); `role`, the least role on that area; and `owner`, whether the person the row belongs to reads it. An `admin` at `org` scope always reads it. `canReadProperty` and `propertyAccess` in `packages/core/acl.ts` apply it. The query engine enforces it in SQL before rows leave the database: a property the reader may not read is dropped from the select list, or projected only on the reader's own row. Filtering, sorting and grouping on it are refused unless the reader may read it on every row. Rollups and computed values over it are withheld. A property the reader may not read is not writable by them. Page reads drop the same keys (`apps/uw-platform/pages/property-rules.ts`). A property on a typed record narrows its record's row rule and never widens it.

**Why.** A directory row is `internal`: every colleague reads who works here. Its mailing address, phone and compliance fields are not. Classification per table cannot say that.

**Rejected.**
- Hide it in the screen. The JSON route, the agent verb and the export would still carry it.
- Split restricted fields into a restricted table. It works for the directory but not for an admin-made collection, and turns every narrower property into a migration.
- Refuse the whole row to a reader without the property's grant. The rest of a directory row is meant for everyone.
- Allow filtering on a property a reader may read only on their own row. It would still tell other rows apart.

**Consequences.** Every restricted property needs a steward; the definition schema refuses a narrower classification without a rule.

**Changes / changed by.** Extends 0017 to properties. 0028 hashes only the fields the exporter may see.

## 0025 A person's profile is their directory row

*2026-11-21.*

**Decision.** There is one page per person: the row of the directory collection for their `people` record. It is what the app opens wherever a person appears, so every person chip links to it, and nothing about a person is kept on a second profile screen. It shows the directory properties the reader may read (0024), a narrative body, and read-through lists of their open tasks, the programs and projects they lead or work on, and the pages they own, all through the collections query engine. A person edits their own contact fields and body; role, team, employment and compliance fields are written by the people who administer the directory. The directory fields are typed columns owned by the people module; the body is a page of type `profile`, written only by the people module's own command. A profile is readable exactly when the directory would list the person to the reader, so a chip never links to a Not Found; a pending or declined person has no profile.

**Why.** Two places to keep a person's details drift.

**Rejected.**
- A profile screen separate from the directory.
- Profile fields in `people`. It is the sign-in record, read at the edge on every request.
- Letting the page editor write a profile body. An editor of the directory's area could then rewrite someone else's body.

**Changes / changed by.** Builds on 0023 and 0024.

## 0026 A page is read under a band beside its page tree

*2026-11-21, amended 2026-11-24.*

**Decision.** Four rulings stand.
1. **The page tree lives in the sidebar.** On every wiki and knowledge page screen, the "Pages & Wiki" row opens into a branch: each area group the reader may read, the categories of the group they are in, and the pages at the top of their category, with the current page marked. It is built per request from the reads the wiki screens already use, so it shows only what the reader may read.
2. **A page is read under a band.** A full-width band holds the breadcrumb, Jump to a page, the actions, and in the reading column the JD ID, the title, a line of facts and the contents. The text sits directly on the page below it, followed by the neighbouring pages, the pages under this one, the pages linking here and the history.
3. **Edit mode has its own address** (`/pages/:pageId/edit`), its own form post and the editor's hooks, and draws the read view's frame and layout, so nothing moves when a person starts or stops editing. Esc returns to reading, asking first when unsaved text is not in a working draft.
4. **Kindle stays a human action**: Edit, Save and New page are the only orange controls. One theme role, `band`, was added for the read view's band.

**Why.** A reader reached a page through three screens and, once there, had only the breadcrumb to move on; edit mode was a different-looking screen.

**Rejected.**
- A second panel for the tree beside the sidebar. It takes 280 px from every page, and the sidebar already lists modules by area the same way.
- Read, Edit, History and Comments as tabs with a side rail. Cheapest to build, but keeps edit mode a different-looking card and adds a rail to every page.
- Edit on the read view's own address. The read view promises no field that can change the page; a separate address keeps that promise and keeps the editor's large script off the read view (0030).
- The read view's header inside a bordered card under the ordinary top bar. Built first; the owner found it did not separate the page's header from its text.
- Focus mode: dropping the sidebar, top bar and status bar and raising a sheet from the bottom of the window. This was this entry's original third point; 0029 overturned it because it repaints the whole page to change one word and loses the reader's place.

**Consequences.** Every knowledge page and wiki screen pays two or three extra indexed reads for the branch.

**Changes / changed by.** Departs from 0014 for knowledge pages. Point 3 was rewritten by 0029. Depends on 0030 for the editor and its working draft.

## 0027 An entity's place in the cascade is a placement row, and the JD map is a table an org admin writes

*2026-11-23.*

**Decision.** The platform organizes everything twice: by Johnny.Decimal area (where a thing is filed) and by the Strategic Cascade (why it exists). Neither is derived from the other. A cascade node is a page of a cascade type, at the tier its type names (`packages/contracts/crosswalk.ts` holds the tiers). An entity's place in the cascade is one row of `cascade_placements`, keyed by the entity's kind and id and naming one node; the entity's area stays on the entity. Placing needs write on the entity's area and read on the node's. The JD map is `jd_cascade_map`: one row per area, node and relation, many to many, declared only by an org admin, with every change audited. The crosswalk module owns these tables and writes no entity's own table; the crosswalk screen counts only areas the reader can read.

**Why.** They are different facts: a project filed in Finance can serve a field program.

**Rejected.**
- A cascade column on `pages`, `tasks` and `harness_items`. Each table has one owner, so the column would be written by three modules, and one of them is a kernel table. One placement table gives one writer and adds nothing to the kernel. The cost: no foreign key from a placement to three tables, so a placement can outlive a deleted entity; every count joins from the entity, so such a row is never counted or shown.
- Deriving the cascade from the area, or the area from the cascade.
- A portfolio or program select on each collection. That is duplicated-select debt; a test refuses it on any built-in collection.
- Letting an area admin declare the map. It relates an area to the whole organization's strategy, so it is an org decision.
- Auditing placements. A placement is filing, as a page's category is; it keeps only its last writer and time. A map row is a strategy decision and is kept in full.

**Consequences.** Placing work is a separate step from filing it, and the crosswalk's "Not placed" column is the list still to do. A node is retired, never deleted, so a retired node stops counting its placements without losing them.

**Changes / changed by.** Builds on 0015 and 0023. The cascade tiers above a portfolio (purpose, objective, principles) are not nodes under this entry; adding them is a new decision.

## 0028 A PDF is printed from the platform's own HTML, by Browser Run, with nothing fetched

*2026-11-24.*

**Decision.**
1. **The renderer is a platform seam, not a kernel port** (`apps/uw-platform/pdf/renderer.ts`), with one adapter over the binding and one that records jobs for tests. A failed render reaches the person as a closed-set reason; the log never holds the printed HTML.
2. **The engine is Cloudflare Browser Run** through the binding's quick action. No npm dependency is added.
3. **The browser is handed one self-contained HTML document and fetches nothing.** The Worker inlines the stylesheet and fonts, inlines each picture only after checking the reader may read it, and removes scripts and forms. Pictures are inlined within a byte budget (`IMAGE_BUDGET_BYTES` in `apps/uw-platform/pdf/print-html.ts`); past it they print as their alt text and the provenance says how many were left out.
4. **Any screen prints with `?format=pdf`**, running the same handler, reads and `can()` as the screen.
5. **Every PDF carries its provenance**: the source address, a reference, the filters, who exported it, the date, and a source hash of what was printed from, never of the PDF file. A page's hash is over its stored version, so anyone can recompute it; every page path hashes through one function (`apps/uw-platform/pdf/page-source.ts`). A stored export also records the hash of the file's bytes. The source hash covers only the fields the exporter may see, and says so when something was withheld.
6. **Print styles come from tokens.** Paper is Letter. Charts print as the server-drawn SVG.
7. **Links are footnoted on the server.**
8. **A binder is an ordered set of pages printed as one PDF**, with a cover, a contents list and continuous page numbers. A page the requester cannot read is left out silently.
9. **A binder always runs in the background** as a Cloudflare Workflow and is stored with a row in `pdf_exports`, which `apps/uw-platform/pdf/exports.ts` alone writes. A single screen renders in the request.
10. **A download checks `can(read)` again** on every area the export covers. An export expires after seven days.
11. **The agent verb `render_pdf` makes a PDF and never hands it over.** Its reply carries no bytes and its input has no recipient. Only a signed-in person can fetch the file.

**Why.** Cloudflare Access covers the whole host, so a browser could not load the app anyway, and inlining keeps the reader's own `can()` as the only gate. Hashing withheld fields would let a reader confirm a guess at a low-entropy withheld value by hashing candidates.

**Rejected.**
- Puppeteer or another npm package. The quick action does what is needed with no dependency and no session to manage.
- An HMAC-signed download link. A signing key is a new secret in every environment; Access plus the random id plus the `can()` check gives the assurance file downloads already rely on.
- A kernel port for the renderer. The kernel never prints.
- Page numbers in the contents list through `target-counter()`. Chromium does not implement it, and two passes would double the cost of every binder.
- Letting the browser fetch the app with an Access service token. A failure there would print a login page or let the browser read as someone it is not.
- Storing an export as a page file. A PDF is an output, never a record; an export expires.

**Consequences and what it costs if wrong.** A new screen prints with no extra code. The browser's handling of the print stylesheet, `data:` fonts and a large inlined document is proven only against a fake until an environment prints; fixes belong in the print files, not the shape. The image budget is a guess at Browser Run's limit. A page or view rendered by `render_pdf` runs inside the request; a very large one would move to the Workflow. The Workflow renders as the requester's live principal, so a grant revoked between queueing and rendering leaves that area out. Without a signed link nobody outside Access can download an export; an outside recipient needs a new decision. Redline and appendix modes and scheduled output wait for suggested changes.

**Changes / changed by.** Confirms 0002 for a new verb. Uses 0012's charts and 0024's withheld fields.

## 0029 The design system is a calm page of five shapes, revealed on intent and edited in place

*2026-11-24.*

**Decision.**
1. **A page, not a pile of cards.** Content sits on one surface; groups are separated by space and a hairline. A frame is kept for an object a person can open, move or act on.
2. **Quiet until asked.** Row actions, menus and handles appear on hover and focus-within, and are always shown on touch. Never hidden: a gate, a refusal reason, the count of what waits on a person, and the view's one primary action.
3. **One loud thing per view.** At most one filled primary button. Kindle marks a human action and nothing else; Save is that action.
4. **Reveal in four steps.** A hint on hover or focus; an anchored menu or popover on click; a side panel that keeps the list in view and puts the item in the address, so it works without JavaScript; a full page only for long work. Reading never needs a modal.
5. **Five page shapes.** Every screen is a List, Document, Form, Board or Overview, each a component in `packages/ui/shapes/`. A screen sets no grid, maximum width or page padding of its own. A sixth shape is a design change.
6. **Edit in place.** Editing is asked for, with a pencil or an Edit button. Once asked, the text becomes fields where it is, and nothing on the page moves.
7. **Six text styles.** Uppercase stays only in table heads.
8. **Three motion tokens**, in `packages/ui/tokens/effects.css`, with an instant swap under reduced motion.
9. **One way to do each thing.** A screen imports its parts from `packages/ui` and never writes a button, heading or card frame class string itself; a missing part is added there first. `tools/ui/one-way.test.ts` holds it.

`design-system/` is the reference a person and an agent read before UI work. It is produced in Claude Design and synced; code never imports it and nobody hand-edits it. The values stay in `packages/ui/tokens/`.

**Why.** The tokens were locked and the frame was the prototype's, but nothing sat between them: no rule for how parts combine, when controls appear, or what a new screen starts from. On 2026-11-24 the repository showed 13 different class strings on one heading level, 19 screens drawing the card frame by hand, and buttons as class strings used more than fifty times with no button part at all.

**Rejected.**
- Always editable, as Notion is. Every click becomes a cursor and a tap meant to select text can change it; the owner named stray edits as the reason to keep an explicit Edit.
- Keep the focus-mode sheet of 0026.
- Edit on the read view's own address. It would break the read view's promise and ship the editor script to every reader.
- The uW Generative Glass design system. A different look, which would mean new tokens and a redesign, not a cleanup.
- Leaving the look alone and adding only a lint rule. A rule against hand-written class strings needs the parts it points to.

**Consequences.** No screenshot check holds this look; a person checks it by eye in light, dark and phone width. Unbuilt modules sit behind a "More" row in the sidebar, and the status bar is one dot in the top bar that opens the same facts.

**Changes / changed by.** Amends 0014 (keeps the frame, withdraws the card canvas, uppercase labels, heavy badges, dimmed modules and status bar). Overturns 0026's original third point. Withdraws the intent in 0007 and 0011 that `design-system/` replaces the token files. Depends on 0030 for the editor.

## 0030 Pages are edited in Milkdown Crepe, shared through a sync hub, and saved as markdown

*2026-11-20, amended 2026-11-23. Formerly a second 0017.*

**Decision.**
1. **Markdown stays the record and is the editor's own source.** The edit screen uses Milkdown with its Crepe interface. Milkdown parses markdown and writes it back, so the editor loads the page's markdown directly and Save sends the markdown it writes. A small plugin keeps the wiki's own syntax (`[[links]]`, `![[embeds]]`, callout markers) as typed.
2. **A page the editor would change opens as text.** The browser compares the meaning of what the editor would write with what was saved; if they differ, the page opens in a plain text field with a line saying why. No page is rewritten by being opened.
3. **The editor is its own script and stylesheet**, loaded only on the edit address. The content security policy still allows no inline style.
4. **A working draft is shared, per page version.** `PageDraft` is a Durable Object named for the page and version. Everyone editing that version joins it over a WebSocket that admits only a person who may write the page. Undo takes back only the person's own edits. If the draft cannot be reached, the person edits alone.
5. **Nothing reaches readers until Save.** Save is one command with the draft's markdown and a snapshot. The old version's hub closes only if its document equals that snapshot; otherwise it keeps the draft and tells the people in it.
6. **The first content is the same for everyone.** The fill is built with a fixed client id, so two people arriving together produce the same bytes.
7. **A save from elsewhere is caught at Save and announced before it.** The browser checks the page's version periodically; a stale draft's Save is refused and the screen keeps what was typed, edited alone, so two people's refused text is never merged.
8. **A draft socket is admitted for a bounded time**, so a revoked grant stops a person's edits within minutes.
9. **Links to pages and files are added from the editor.**

**Why.** People coming from Notion expect a formatted editor and to see each other typing. The platform's record of a page is its markdown, saved as numbered versions, and agents read and write that markdown directly.

**Rejected.**
- An editor with its own document shape, converted to and from markdown. The first build used one; every conversion was a place to lose formatting, and pasted markdown arrived as plain text.
- Save the Yjs document or the editor's JSON as the record. Agents, search, links, embeds and history all read markdown.
- Autosave straight to the page. The owner asked that a page not change by being opened or typed in, and readers and agents would see half-written procedures.
- Merge an agent's write into the open draft. It needs the editor's parser and schema to run in the Workers runtime; the draft is told instead.
- One sync hub per page, reset on Save. A browser that still held the old draft would merge it into the new one on reconnect. A hub per version cannot be rejoined with stale text.
- Fill the first content on the server. The Worker would have to run the editor's parser.
- Hocuspocus or a hosted collaboration service. Either adds a server or a vendor outside Cloudflare.
- Restyle Crepe in the platform's tokens in the first change.
- Block storage, and an "always editable" preference. See Part 3.

**Consequences.** A working draft lives in its hub's storage, not in Postgres, until it is saved, discarded or idle for 30 days. Crepe's image block stores a picture's display size in its alt text, which the owner accepted. A hub holds its sockets open without hibernation, so it is billed while people edit. Rendering is not cached; a very long page is slow to read, and caching the rendered HTML per version is the next step if real pages are that long. A draft is stored as one value under Durable Object storage's size limit; a very long page with a long editing history might not fit, and this has not been measured. Where the hub's binding is absent, people edit alone.

**Changes / changed by.** 0026 and 0029 set the screens around it.

## 0031 Knowledge pages are filed in a category, and everyone reads 00-09

*2026-11-20. Formerly a second 0018.*

**Decision.**
1. **A knowledge page is filed in a category.** A page of type `knowledge` carries a required two-digit `jd_category`; its area is that category's decade. A create or save whose category and area disagree is refused. A page may carry a JD ID, which must begin with its category.
2. **An area is always one decade.** `60-79 Field Programs` is a cluster: a label over two areas in navigation. A cluster holds no pages and takes no grant.
3. **Everyone approved reads 00-09.** Approving a person gives them `viewer` on 00-09, audited with the action `default`. Other areas need their own grant.
4. **Moving a page to another area needs the editor role in both.** The page keeps its id, so links keep working; its JD ID is cleared.
5. **A category's name is data**, set by an area admin.

**Why.** The wiki being replaced is organized by Johnny.Decimal numbers, people already cite pages by number, and the platform scopes grants by area. Filing has to decide who can read a page.

**Rejected.**
- Folders or free nesting in place of categories. A tree with no numbers would lose the address every existing page has.
- A grant on the cluster. It would read two areas with one grant, which 0015 removed for a reason.
- Everyone reads everything. Open reading is a visible `org` grant, not the default.
- Category as a tag. A tag does not decide who can read a page.
- Per-page sharing and private personal pages. A page's area is its scope; private pages are an open question.

**Consequences.** A page cannot be created without a category, so an import of existing content must derive one for every page or list the page for a person to file. Search, the Quick Switcher, backlinks and embeds show a person only pages in areas they can read, so two people can see different results for the same words.

**Changes / changed by.** Builds on 0015.

## 0032 Two long-lived branches: work lands on develop, releases reach main by merge commit, and there is no hotfix branch

*2026-11-12. Supersedes 0008.*

**Decision.** `develop` is the integration and default branch. Work is pushed straight to it or reaches it through a pull request; it requires no pull request, no passing check and no up-to-date branch, and keeps only linear history with force-push and deletion refused. An issue is optional. CI runs on every push to `develop`, and staging deploys only after that CI passes. `main` is the release branch: it only ever receives `develop`, through a release pull request merged with a merge commit by an owner, and production deploys by dispatch on a version tag whose commit is on `main`. Pull requests into `develop` are squash-merged. There is no hotfix branch into `main`: an urgent fix lands on `develop` and a release follows. Review is an owner's step; an agent says a pull request is ready and stops. Work happens on normal branches in the main checkout, never in a git worktree. Nothing reaches `main` or production without an owner's word. `AGENTS.md` sections 7b and 8 are the procedure.

**Why.**
- **Direct pushes to `develop`.** With a small team and CI in about six minutes, a required pull request per change was slower than the risk it removed; a red push never reaches staging and opens an alarm issue.
- **No hotfix branch.** A branch name is chosen by its author, so a `hotfix/*` exception could not prove the branch is a hotfix, and any branch could use it to skip `develop` and staging.
- **Squash into `develop`.** One commit per change keeps a straight history that is easy to read and revert.
- **Merge commit into `main`.** A squash would copy `develop`'s work into a commit `develop` never contains; the branches would diverge and every later release pull request would re-list already-shipped commits.
- **`develop` is always releasable.** Work not ready to ship stays on its branch or merges behind a flag that is off in production; nothing is cherry-picked into `main`.

**Rejected.**
- The protocol of 0008: issues as the only work list, pickup by label, a Codex round started by the author on every pull request.
- A hotfix path into `main`.
- Squash or rebase for release pull requests.
- Agents starting their own review, with reviewer subagents or a review workflow.
- Git worktrees for builds. Work in progress shares one checkout and a second task waits or stashes; the owner chose that cost.

**Consequences.** CI refuses a pull request into `main` from any branch but `develop`. Staging deploys are queued, never cancelled mid-migration, and each checks that its commit is still `develop`'s tip. The platform's own merges (the Merge stage) go to the default branch, so workflow pull requests land on `develop` too.

**Changes / changed by.** Supersedes 0008.

---

## 0033 A platform module queries Postgres directly, in its own data files

*2026-11-25. Amends 0001.*

**Decision.** Only the workflow kernel reaches Postgres through a port. A platform module under `apps/` uses Drizzle directly, and only in its own data files: a file imports Drizzle or the schema only inside a module that declares the tables it owns, and never in a route or handler file, a component, a view, an island or any file that imports Hono. Other code calls the module's functions. A module writes only the tables it owns and may read another module's tables in a join. `tools/architecture/data-files.test.ts` holds this.

**Why.**
- **A port needs a second implementation to earn its cost.** There is one database by decision, and the kernel's own Store port has one Drizzle implementation that the sim binds to an embedded Postgres.
- **Queries are proven on a real database.** Constraints, transactions, locks and access rules fail only there, so a port that let a module fake its tables would hide the bugs that matter.
- **The old rule was not held.** "Application code reaches Postgres only through a port" had no check, and most files that broke it had no recorded exception.
- **What protects the data is ownership and place.** One writer per table and `can()` on every route were already checked; this adds the missing one, that a query lives in a known place.

**Rejected.**
- A port, a second adapter and a contract suite for every platform module. Each port would have one real implementation, and every new module would pay for the layer before its first query.
- Leaving the rule and recording each file as an exception. Nothing stopped the next file.
- Refusing reads of another module's tables. Collections, the crosswalk and pages join across modules today, and splitting those joins would move work from the database into the Worker.

**Consequences.** The per-file exceptions for Rule 2 and Postgres are removed from `docs/exceptions.md`. If the offline app is built on a store other than Postgres, the modules that work offline need a port then, and this decision is reopened for those modules.

---

## 0034 Policies, charters and decision pages are gated page types; policies resolve by a pure function over a policy chain

*2026-11-25. Builds on 0027. Changed by 0035.*

**Decision.** A policy is a page of type `policy` (Core), a charter a page of type `charter` (Strategy) and a decision page a page of type `decision` (Agents). All three are gated: an agent's new page lands `suggested` and only a person confirms it; an agent's save to an active policy or charter is held as a suggestion set (0035). A policy's frontmatter holds its enforcement (`required`, `default` or `template`), `applies_to` (a cascade node or product page, or none for the whole organization), `supersedes` (policy ids), `effective_from`, `effective_until`, and `copied_from` (the template page and version a copy was made from). Its level is the type of the page it applies to, or `organization` when it applies to none; it is never stored on its own. A save is refused with `applies_to_not_found` when that page is not a live node or product the writer can read. Charters and decision pages name what they apply to the same way.

The policies for an item are worked out by `resolvePolicies` in `packages/harness/policies/`, a pure function over a **policy chain**: the item's product (its page or the nearest product above it), the item's own placement or else the product's, that node's parents through the program and portfolio relations, then the organization. Most specific first; an uncopied `template` takes no part; a `default` drops when a policy further down supersedes it; a `required` one stays and the attempt is recorded as a conflict; a supersession from the same level or above has no effect and is recorded too. Resolution runs over every active policy on the chain, read in full, then the answer keeps only the policies the reader may read. A conflict shown to a person is judged on the chain that holds both policies. A decision page replaces only one decided before it. `resolve_context` returns them beside the learnings, with the decision pages on the same chain.

A copy of a template policy keeps its own text. `templateDrift` (kernel) reports a copy whose template has a newer version, or is retired or gone; adopting the update is a person's save of the template's current text and version.

A charter's NISO sections are level-two headings in its body, Need, Idea, Strategy, Outcomes, Risks and Roadmap, in that order; a decision page's are Context, Decision and Consequences. A save without them is refused with `sections_missing`, naming the missing ones.

A policy's page and the Policies screen show its level, target, enforcement, dates, template and every conflict it is part of.

**Why.**
- **One fact, one place.** Storing a level beside `applies_to` would let the two disagree; reading it from the page's type cannot.
- **Supersession is judged when it is read.** Whether one policy is below another, and whether the replaced one is `required`, can change after a save: a node is moved, a policy is confirmed or retired. Refusing on save would let a later change make a saved page wrong without anyone touching it. Showing the conflicts where people read policies makes that judgment visible instead of silent.
- **The kernel can prove precedence and drift.** Pure functions run in the sim and in unit tests without a database, the way the ship rule does (0001, 0003).
- **The organization needs no node.** 0027 keeps the tiers above a portfolio off the cascade; an empty `applies_to` says "everywhere" without reopening it.
- **People edit bodies, not frontmatter.** The page editor shows the body; sections as headings keep a charter or decision page editable in place and still readable by a machine.
- **Obligations never change silently.** A copy records the version it took; a newer template is a report and a deliberate save, not a live link.
- **Agents suggest; people decide.** 0002 keeps agents short of decisions.

**Rejected.**
- A `level` field beside `applies_to`. Two facts that can disagree.
- Refusing on save a policy that supersedes a `required` one. It can become true later without a save; recording the conflict at resolution is always current.
- A `policies` table. A policy is a document with versions, links, search and suggestions, which pages already are.
- NISO sections as frontmatter fields. The editor does not edit frontmatter, so charters would be writable only through the API.
- A separate `resolve_policies` verb. `resolve_context` is what every agent session reads first, and the verb registry stays small (0002).
- Leaving out policies the reader cannot read before resolving. A readable default would then look in force when an unreadable descendant has replaced it.
- A copy that follows its template live. A template edit would change every obligation made from it without anyone deciding.

**Consequences.** An agent reads policies and decision pages through `resolve_context`; a person reads them on their pages and on the Policies screen. A policy in an area the reader cannot read still takes part in resolution, so a readable default may be absent from the answer; its page names the conflict only when the reader can read both policies. Working out a policy's conflicts reads each policy that names it, so the Policies screen does work in proportion to the policies it lists. Not built here, each its own piece of work: attestation (#203) and the lean default policies (#255).

**Changes / changed by.** 0035 replaces the refusal of an agent's save to an active policy or charter with a suggestion set.

---

## 0035 An agent's save to an active policy or charter is a whole-document suggestion set a person decides

*2026-11-25. Builds on 0002 and 0034. Part of #197.*

**Decision.** `page_suggestion_sets`, owned by the pages module, holds a proposed title, frontmatter and body for one page over a base version. An agent's `write_page` to an active page whose type declares `agentSuggests` (policy and charter) runs every check a save runs and is then held as a set instead of written; `write_page` answers the set's id. Each agent holds at most one pending set per page, and a later save replaces it. `accept_suggestion` saves the set through the ordinary save path as exactly one new version and records who accepted it and the version made; `reject_suggestion` records the decision and changes nothing. Both are person-only, only the page routes and the review screen import them (a dependency rule holds this), and a database trigger keeps a decided set as it was decided. A set whose base version is no longer the page's version is refused as stale and can only be rejected. A set carries a revision that each save by its agent bumps; a decision names the revision shown and is refused with `suggestion_changed` if it moved. A decision locks the page before the set, as a save does, and records its request id so the same request is answered once.

**Why.**
- **The PRD says the in-place write does not exist** for these types (PRD, Suggested changes); before this, the only alternative was to refuse the agent outright.
- **A whole document is enough to decide on.** The review screen shows text and properties as a line diff against the base version, which is all a person needs to accept or reject the set as a whole.
- **Accepting is a save.** Going through the save path keeps every check (frontmatter, sections, `applies_to`, links) and the one-version-per-save history, so a suggestion can never write something a person's save could not.
- **One writer per table.** The pages module owns the set, as it owns versions.

**Rejected.**
- Anchored suggestions per passage now. They need anchors that survive edits and an export format; the PRD's whole-set accept does not need them. They stay in #197.
- A pending row in `page_versions`. Versions are immutable history; a pending change is not part of it.
- Rebasing a stale set automatically. A person would accept text written against a page that has since changed.
- Holding agents' saves to every gated type. Learnings, skills and personas keep their own confirmation and activation rules; the PRD names policies, charters, contracts and work orders.

**Consequences.** Contract and work order pages, when they exist, declare `agentSuggests` and get the same path. Anchored suggestions, named review sets and revision marks in markdown, PDF and DOCX remain #197's.

**Changes / changed by.** Changed by 0037: an agent's save to an active policy or charter is now a review set of suggested changes, and anchored suggestions, review sets and markdown marks are built there. Suggestion sets already pending are still decided as here.

---

## 0036 A measure runs a pinned package in a sandbox, after a trial and an activation by a person

*2026-11-25.*

**Decision.** Six rulings.
- **Measuring is data, not a pull request.** A measure is a page that names a runtime from a closed set, an exactly pinned package, a command as an argument list with only `{address}` and `{host}` filled in, its resources, its schedule, and how its values are read from JSON output. An agent can write one. A new runtime is reviewed code; a new tool within a runtime is not.
- **An agent authors through typed verbs.** The agent is any MCP client on `/mcp`; there is no chat box. It saves a measure with `save_measure` and a dashboard with `save_dashboard`, whose fields are typed in the tool list and whose replies name every problem with its field. It never writes frontmatter or panel YAML; the platform writes the page.
- **A person runs the trial and a person activates.** Run trial and Activate are platform commands needing `admin` on the measure's area, not harness commands, since a measure belongs to an area and not to a harness. No verb starts either, and no verb makes a dashboard active. A change to the tool, package, command or resources returns the measure to `suggested` and needs a new trial.
- **What runs is exactly what the trial ran.** The trial records the dependency lock with hashes; activation fixes it; every run installs with hashes required.
- **The sandbox reaches only what it measures.** The measure container has the internet off; the egress proxy allows the package index while installing, then only the origin of the resource being measured and that origin's `www.` sibling (apex and `www.`, same scheme and port), never a private address, and records every refusal. A site's address is recorded as its canonical one, after its redirects. A measure holds no credential.
- **Observations are typed records, and a failure is never zero.** One owner table holds every measure's observations, with values validated against the measure's version, read through the measures module and its verbs; the database refuses values on a failed observation. A failed observation is kept with a closed-set reason and left out of every figure. A tool that exits 0 but reports a failure is caught by the measure's optional failure path, a JSON pointer such as `/error`: anything there but null, false or empty text makes the observation failed, with no values. Dashboards are pages of a closed set of native panels, drawn with the existing chart part; no custom HTML or script runs in them.

**Why.** The first dashboard asked for (GEO scores of the organization's websites) was built outside the platform as a scheduled GitHub workflow that committed a JSON file, read by an artifact page that ran a query as each reader. That made a repository the database and a chat artifact the screen, and kept the numbers out of every other page. A person asking for a dashboard should get it without a code change, and its numbers should be platform records that any page, export or agent can read under the same access rules.

**Rejected.**
- A reviewed adapter in code for every new measurement. Each dashboard would wait for a pull request and a deploy, which is the reason the first one was built elsewhere.
- Running the tool in GitHub Actions and reading the results from the repository. It makes a repository the record, puts the schedule outside the platform, and gives the numbers no area, classification or access check.
- An agent starting the trial itself. It would run third-party code chosen by an agent with no person having seen the package, version or hosts.
- Letting the tool reach any host. A measure could be used to fetch arbitrary addresses from the platform's network.
- Following a redirect to any host, or allowing every subdomain of the resource's domain. The `www.` sibling covers the commonest redirect (apex to `www.` and back) and nothing broader; a site that redirects elsewhere is recorded at its canonical address.
- Treating a tool's exit code as the only sign of failure. `geo audit` exits 0 with a score of 0 when it cannot fetch a site, and that 0 would count as a score.
- A table per measure. Runtime DDL breaks "Drizzle is the only schema" (ADR 0023).
- Custom HTML dashboards in the first version. They need an isolated origin and a sandboxed renderer, and every panel the first dashboards need is native.
- The agent writing measure frontmatter and panel YAML with `write_page`. A save refused as `invalid_frontmatter` tells the agent nothing it can fix by, and YAML written by a model is the commonest failure.
- A record collection over observations in the first version. It needs a new row source, a property source for JSON values and a collection created inside activation; the panels, the JSON route, CSV and the verbs cover the first dashboards.
- Waiting On You entries for measures. Waiting On You is a view over harnesses and a measure has none; the measure's page and a Measures screen show what waits.
- Waiting for the chart spec of section 26 (#199) before drawing panels.

**Consequences.** A measure that needs a key waits until a measure can use a credential by reference (ADR 0020), which is an open question. Tools that print only text cannot be measures until a text runtime is reviewed. A run is done under the activating person's authority, a trial under that of the person who pressed Run trial, re-read at each step since no request outlives the press (recorded in `docs/exceptions.md`), each resource read again under that authority in its own step and skipped when it is no longer readable, and a measure pauses when its activator loses `admin` on the area. A paused measure, unless retired, is activated again by an admin pressing Activate, who becomes its activator. A person's edit or restore of an active measure or dashboard, or an agent's save of one, returns it to `suggested` and pauses the measure in the same transaction. A run belongs to the activated version it was asked under and stops, without pausing the measure, once a later version is activated. At most four runs hold a sandbox at once, trials and requested runs included; a run that finds no free slot waits queued and the minute job starts it when one frees, and a scheduled run whose job cannot be created is retried each minute for up to an hour after its slot. A resource step that fails past its retries is recorded failed and the run goes on, and every run closes from what it observed against what it planned, so a run that leaves a resource unmeasured is never ok. A started run with no progress for an hour is closed as stalled. A stored export records the areas of every dashboard, measure and resource its panels drew from, so downloading it later needs read on each of them. Activation judges only the trial observations the activating admin may read, and needs at least one ok among them. A resource serves portfolios, programs and projects only; serving a product page waits for a collection that lists products. Raw output is deleted after 13 months by the nightly job, not by a bucket lifecycle rule. Panels move onto the chart spec when #199 is built.

**Changes / changed by.** Changed by 0038: the chart spec is built, and panels stay on their own chart parts until a chart query reads observations.

---

## 0037 Suggested changes are anchored spans grouped in review sets, accepted as one save, and carried through markdown export as CriticMarkup

*2026-11-26. Builds on 0035 and 0028. Changes 0035. Part of #197.*

**Decision.** Six rulings.
- **Words.** A **suggested change** is an insertion, deletion, replacement or comment anchored to a span of one page version; a **review set** is a named group of them decided together. "Revision" stays the Iterate run's draft page.
- **Anchors.** Each change records W3C-style text position (start and end offsets into the base version's body, in UTF-16 code units, as JavaScript counts them) and a text-quote selector (the exact text and up to 32 characters before and after). `resolveAnchor` keeps the position while the text there still matches its quote, otherwise finds the quote with its context, otherwise the exact text alone, and reports the anchor as orphaned when what it looks for is missing or appears more than once. A proposal with an orphaned anchor is refused with `anchor_orphaned`; one whose changes overlap is refused with `changes_overlap`. Two insertions at one point overlap; an insertion at either end of a span does not.
- **Tables.** The pages module owns `page_review_sets` (page, name, base version, an optional proposed title and properties, status, author, request id, revision, who decided, when, the version made), `page_suggested_changes` (the set, its position, kind, anchor, proposed text, note, author) and `page_review_decisions`, an append-only audit row per decision. Migration 0076 refuses changing or deleting a decided set; adding, changing or removing the changes of a decided set; and any UPDATE or DELETE of a decision, as 0072 does for suggestion sets.
- **Deciding.** `accept_review_set` locks the page, then the set, applies every change but comments to the base text and saves the result through `updateWithin` with the base as the expected version: exactly one `page_versions` row and one decision row, in one transaction. `reject_review_set` writes the decision row and no version. Both are for a person who may write the area, name the revision they read, and answer a replayed request once; a set over an older version can only be rejected. Only the page routes and the review set screen import them (`review-decisions-only-from-page-routes`).
- **Agents.** An agent's `write_page` to an active policy or charter becomes the agent's one pending review set: the body as word-level suggested changes against the stored body (jsdiff's `diffWordsWithSpace`), and a changed title or properties carried on the set and applied with it. A later save replaces the set's changes and bumps its revision. No agent principal can save a gated page's body directly: the agent writer diverts or refuses, and the person save path now refuses any principal that is not a person on a gated type. `write_page` answers `reviewSetId` instead of `suggestionId` (contract 15.0.0). People propose review sets with `propose_review_set`, or from the page: an edited copy of the text, diffed word by word, or a pasted marked export.
- **Export.** `GET /api/pages/:pageId/export?mode=marked|accepted|original`, default `accepted`. `accepted` is the clean current text with embeds written out; `original` is the stored text verbatim, the text a marked export's marks are over; `marked` is the stored text with the changes of every pending review set over the current version in CriticMarkup, a comment as `{==span==}{>>note<<}` and a note on any other change as a following `{>>note<<}`, leaving out a change that overlaps one already marked and counting it in `left_out`. Every export's front matter is stamped with `source: slug@version`, `exported` (`formatDate`), `sha256` (`pageVersionHash` of the version as shown to the exporter, as the PDF footer does) and `mode`. `parseMarked` reads CriticMarkup back into the text under the marks and the same suggested changes; `verifyExport` recomputes the hash from the stored version and checks the source, the title and the text under the marks, so an edited file or a later version fails.

**Why.**
- **A version is history, a suggestion is not (PRD, Suggested changes).** Keeping changes in their own rows, applied only by a save, keeps `page_versions` at one row per save and makes a decided set and its audit row permanent.
- **Position first, quote second.** Offsets are exact while nothing moves; the quote is what survives an edit elsewhere or a trip through a plain-text file. Refusing on a missing or doubled quote is cheaper than accepting text into the wrong place.
- **Accepting is a save.** Going through `updateWithin` keeps every save check and the one-version-per-save history, so a review set can never write something a person's save could not (0035).
- **Word-level changes are what a person reads.** A whole-document set showed a line diff and could only be taken whole; word changes show exactly what an agent altered and still decide as one unit.
- **CriticMarkup is plain text.** It diffs, survives any editor and reads back without a binary format; the hash ties the file to the version it came from.
- **jsdiff** (`diff`, BSD-3-Clause, pure JavaScript, typed) runs on Workers and in Node and replaces hand-writing a word LCS beside `pages/diff.ts`.

**Rejected.**
- Suggested changes as rows of `page_versions`, or a pending version. Versions are immutable history.
- Keeping the agent's whole-document suggestion set for the body. It cannot be anchored, exported as marks or reviewed change by change.
- Rebasing a stale set onto the new version automatically. A person would accept changes placed by a guess.
- Guessing among several matches for a quote. An orphaned anchor is reported.
- Expanding embeds in `marked` and `original` exports. Embedded text is not the page's own and would shift every offset; only `accepted` writes them out.
- A hash over the exported file. The source hash must resolve against the stored version in every mode, as the PDF footer's does; the file is checked by recomputing.
- A separate import command. `propose_review_set` takes anchors, and the page's form reads a marked export into them.

**Consequences.** Offsets count UTF-16 code units, so a client counting code points must convert. A page whose own text contains CriticMarkup delimiters reads back wrongly from a marked export; nothing escapes them. A review set leaves slug, parent and status alone. Suggestion sets pending before this change stay decidable on their screen, and nothing makes new ones. PDF redline and appendix modes, DOCX tracked changes and their import, and marks shown inline in the read view remain #197's.

**Changes / changed by.** Changes 0035: an agent's save to an active policy or charter is now a review set.

---

## 0038 A chart is a spec over a whitelisted query, drawn with its lineage and the rows it drew

*2026-11-26. Builds on 0012. Changes 0036. Part of #199.*

**Decision.** Six rulings.
- **A spec, not code per screen.** A chart is a Zod-validated spec in `packages/contracts`: a type from a closed set, one query by key with typed parameters, encodings and formatting. Screens, exports and the `render_chart` verb all draw through one function, and the standard charts are specs defined once by key.
- **A whitelist, refused by name.** A spec may name only a query on the platform's whitelist. The key stays a free word in the schema so that one off the whitelist is refused with `chart_query_not_allowed`, parameters that do not fit with `malformed_command` naming the fields, and a column the query lacks with `chart_encoding_unknown`. A query runs under the reader's access; `render_chart` is gated `viewer` on the workflow's area.
- **One set of rows.** The picture, the table on the screen, the CSV and the JSON are drawn from the same rows the query answered, unchanged, and every figure drawn is in the SVG as text.
- **Lineage and staleness in the picture.** Every chart carries its source, query, as-of time, filters, rows left out by closed-set reason, and staleness. A harness chart's source is stale when a GitHub delivery has waited more than five minutes to be consumed, or when that cannot be read; the note is drawn into the SVG and shown on the screen, and the series is not cut.
- **History is a kernel fold.** Cumulative flow, cycle time and burndown are pure folds over `item_created`, `stage_advanced` and `loop_edge_taken`, read through the Store port as a kernel view, capped at the newest 5,000 events; an item whose creation was not read is left out and counted.
- **A colour-blind-safe palette without Kindle; PNG through Browser Run.** Six series tokens from Inspire, Ocean, Cultivate and Tech alternate light and dark, each at least 3:1 on its ground, with a dash and a marker per series. Kindle is not a series colour, since it marks a human action and nothing else (ADR 0007, ADR 0011), although PRD 4.4 allowed it "sparingly". PNG is a screenshot of the SVG in one self-contained document through the existing `BROWSER` binding, behind a `ChartRasteriser` seam with a recording adapter.

**Why.**
- **Nine definitions of "actual spend" (PRD 4.4).** One spec and one whitelist make each chart's definition a reviewed key, and a key an agent invents is refused rather than run.
- **A chart nobody can check is a claim.** Drawing the CSV and the table from the very rows drawn makes the export the evidence, and a staleness note in the picture survives being copied into a memo.
- **The kernel already owns item history.** Folding events where replay and record are proven keeps the charts module free of tables and of Drizzle.
- **Browser Run is already bound and draws the app's own CSS.** The SVG's colours are token classes; a rasteriser that does not run the stylesheet would draw them black.

**Rejected.**
- A free query or a query language in the spec. It would make every chart a new definition and every agent a query author.
- A closed enum for the query key in the spec schema. A key off the whitelist would fail as a malformed call, not with a reason that says why.
- `@resvg/resvg-wasm` for PNG. It does not apply a stylesheet, so token classes would have to be resolved to literal colours, which the content security policy and the token rules forbid in the page's SVG; it would also add a megabyte-scale wasm module to the Worker.
- Inline `style` or `<style>` in the exported SVG. The SVG served from the platform's origin is under the same policy as the page; the export names the app stylesheet with an `xml-stylesheet` instruction instead.
- Cutting the series at the stale point. The rows before and after are what was recorded; the note says which days may be short, and the CSV still equals what was drawn.
- Kindle as a fifth series colour, and a red or amber for a stale chart.
- Moving the measures panels onto the spec now. No chart query reads observations yet, and the panels already show their source time and rows; they move when one does.

**Consequences.** A chart query is code, reviewed like a validator: budget and revenue charts arrive as queries. Every whitelisted query today is scoped to one workflow, so `render_chart` resolves its grant from that workflow; a query over another area will need its own resource. Staleness for harness charts reads the GitHub ingest queue only. The PNG path is proven against a fake binding; the `screenshot` quick action's option names follow the Browser Run REST API and are not yet run on staging. A downloaded SVG opened away from the platform's origin has no stylesheet and draws its classes in the viewer's defaults. Workflows with more than 5,000 item events show their older items as left out.

**Changes / changed by.** Builds on 0012. Changes 0036: the measures panels do not move onto the spec yet. Extended by 0039.

## 0039 The team charts resolve names at read time, never guess, and report what they leave out in the lineage

*2026-11-26. Extends 0038. Part of #200.*

**Decision.** Seven rulings.
- **Platform data, two new tables.** The commitments network, staff allocation and people and portfolios charts read `people`, `directory_entries`, the portfolio and program pages and their `program.portfolio` relation, and two tables the people module owns: `staff_allocations` (a person to exactly one of a program page or a portfolio page, a whole percent from 0 to 100 or none) and `person_commitments` (a person to exactly one of a person or a text). Both are `internal` and `cache_readonly`; the database refuses a row with both targets or neither, a percent out of range, a blank text and a commitment to oneself.
- **A commitment keeps its words.** A commitment entered as text stays text and is resolved each time a chart is drawn: by id exactly; otherwise by exact full name, then by a loose name with punctuation flattened, then by a first name when the text is one word. At each step one candidate resolves; two or more make the entry ambiguous; none at every step leaves it unresolved. An ambiguous or unresolved entry is never drawn and never guessed.
- **The data-quality note is the lineage.** `lineage.excluded` gains `entries` (reason, who, what they named, and the candidates) and five closed-set reasons: `ambiguous_name`, `unresolved_name`, `person_not_readable`, `page_not_readable`, `page_retired`. An entry the reader may see is listed by name; a person the reader cannot read is only counted, and a page the reader cannot read is listed without its title. The notes in the picture and on the screen are drawn from these entries.
- **Two graph types with fixed layouts.** `graph` places its nodes on a circle in name order and `bipartite` places people in one column and programs and portfolios in another, grouped and coloured by portfolio, each edge labelled with its percent or "unspecified". Both are ECharts graph series with positions computed on the server, so the same rows always draw the same picture. The spec names the edge's other end in a new `target` encoding, and a two-column graph its `group`; other types refuse both. People and portfolios is a bar chart of counts by portfolio and ring with the names in its rows.
- **Reads under the reader's access.** A team chart needs a read of the directory's area (`00-09`); a person is listed only when `can()` reads their record, a page only when it reads the page's area. The rows carry display names and page titles, never an email, phone or address. Team charts read live tables, so they are never stale.
- **Writers.** A person adds and removes their own commitments; an `admin` on `10-19`, or an org admin, writes anyone's commitments and every allocation, through `add_commitment`, `remove_commitment`, `set_staff_allocation` and `remove_staff_allocation` at `/api/team/commands/:name`. Editing is asked for on the Team Charts screen.
- **`render_chart` reaches the team charts on the directory's area.** A spec over a team query is gated `viewer` on `00-09`; an agent reads no person record, so its team chart has no people in it.

**Why.**
- **A prose list is how commitments were written.** Keeping the words lets an import from prose arrive whole, and a later directory change (a second "Sam" joining) turns a once-clear name ambiguous in the note instead of silently pointing at the wrong colleague.
- **One lineage, one note.** A chart that leaves rows out already says so in its lineage (ADR 0038); a second report beside it would drift from the first.
- **A random layout is not checkable.** Two exports of the same rows must be the same picture.

**Rejected.**
- Resolving a text when it is saved and storing the person. It freezes a guess and loses what was written.
- The reference dashboard's prefix and initials matching ("Ada" for "Adaline", "ada e."), and a table of manual overrides. Prefixes and initials are guesses; an entry by id is the override.
- A force-directed layout. It is random unless seeded, and hand-tuned relaxation belongs in a browser, which ADR 0012 keeps out of the chart.
- A sankey for allocations. A flow needs a width, and a blank percent has none.
- The reference dashboard's ellipse of people by portfolio sector and ring. Its overlap relaxation measures text in a browser; counts by portfolio and ring with the names in the table carry the same facts and print.
- A separate data-quality report field beside the lineage.

**Consequences.** A directory edit can change which entries resolve, so a chart's lineage, not the stored row, says what was drawn. Two people with one display name are one node in a graph and make every text naming them ambiguous until one is renamed. A table cell may now hold up to 4,000 characters, for the names in a people row. Retiring the Apps Script deployment is an operations step outside this repository. Cost if wrong: the resolution tiers are one pure function (`people/name-resolution.ts`) and the layouts one renderer (`packages/ui/components/graph-chart.ts`); either changes without a migration.

**Changes / changed by.** Extends 0038 (two chart types, a value format, five exclusion reasons and listed entries in the lineage).

## 0040 A story's level is a server filter over a render channel, raised only by an area admin on a recorded consent

*2026-11-26. Builds on 0015 and 0017. Part of #201.*

**Decision.** Eight rulings.
- **Level and consent beside the page, not in it.** An `impact_story` page (gated; an agent's edit to an active story is held as a review set) carries its tags as validated frontmatter: `jd_category` (its area's `xx.96` home), an ISO 3166-1 alpha-2 `country` (a user-assigned code such as `XA` is accepted for invented test places), an ISO 3166-2 `region` that starts with that country, BCP 47 `languages` (an ISO 639-3 code is a valid tag), `illustrates` page ids and free-form `themes` that are never a join key. The level is a row of `story_levels`, the consent a row of `story_consents`, each file's level a row of `story_media_levels` and every use a row of the append-only `story_uses`, all owned by `apps/uw-platform/stories/`. No page save can set or raise a level.
- **The ladder and the channels are closed sets.** Levels are `internal` < `private_circulation` < `newsletter` < `public`; render channels are `platform` (staff screens behind sign-in, the reach of `internal`), `private_circulation`, `newsletter` and `public`. One pure function, `storyMayAppear(level, channel)`, decides, and one SQL predicate, `storyChannelFilter(channel, at)`, applies it in the read path: a story shows in a channel wider than `platform` only when its level reaches the channel and its consent is neither withdrawn nor past its expiry day. A story with no level row is `internal`.
- **Every render path declares its channel.** Staff screens, listings, backlinks and the tree are `platform`. `read_page`, `search_pages`, `resolve_context` and `render_pdf` take a `channel` argument, the markdown export a `channel` query parameter and a binder request a `channel` field, each defaulting to `platform`. A page asked for above its level is refused with `story_above_channel`; a story reached through an embed, a binder or a context package is left out, the embed drawn as "not cleared for this channel". Embeds, binder sections and images inherit the request's channel and nothing nested can reset it, so a verb cannot widen what its caller asked for.
- **Raising needs an area admin and a valid consent; lowering needs a writer.** Raising needs a person holding `admin` on the story's area, with grants re-read inside the transaction, and a consent record with a release reference and a day that is neither expired nor withdrawn; a file's level also needs the photo release. Lowering is open to anyone who may write the page. An agent identity never raises. Recording consent needs a person who may write the page.
- **Withdrawal is a report.** Withdrawing consent stamps the record, drops the story and each of its files to `internal`, and answers with every recorded use.
- **Every export records its stories.** A markdown export, a PDF of a page and a PDF binder record one use per story drawn into it, embedded ones included, at every channel; `read_page` records an agent read when asked for a wider channel. The database refuses an update, delete or truncate of `story_uses`.
- **Consent is restricted.** `story_consents` is `restricted` with the read rule `viewer` on the story's own area or org admin; an org viewer reads the story and its level but not who consented. The level, media and uses tables are `internal`. All four are `never` offline.
- **A seam for the field-record ceiling.** The ceiling a sensitive engagement would set is not built, because no field data is in the platform yet; it belongs in `storyChannelFilter` as one more condition.

**Why.**
- **A label is not a permission.** The failure the PRD names is a well-meaning draft putting a named field worker on the public web; only a filter in the read path, not an editorial habit, prevents it on every path at once.
- **Frontmatter is writable by every save.** An agent's page save could otherwise set `level: public`; a table only the stories module writes, behind a person and a consent, cannot be reached by a page write.
- **Uses traced at render time are complete.** Recording a use where a rendering includes a story catches embeds and binders that a caller never named.

**Rejected.**
- The level as a frontmatter select. Any page writer could raise it.
- One table for level and consent. The level is read by every filter and every listing; the consent names a person and links a signed release, and deserves the restricted rule.
- Refusing the whole host page when it embeds a story above the channel. Leaving the section out keeps a newsletter buildable from a page that also serves staff.
- A package for country and language codes. `Intl.DisplayNames` and `Intl.getCanonicalLocales` validate them on Workers and in Node with no dependency; the cost is that a few CLDR region codes that are not countries (`EU`, `UN`) are also accepted.
- Recording uses only for channels wider than `platform`. A board packet printed for staff is still a place the story landed.

**Consequences.** Every page read with a wider channel joins `story_levels` and `story_consents`; a platform read adds nothing. Screen PDFs (`?format=pdf`) are platform renderings and do not record uses. A wiki link to a story still shows its title in a wider export. The public publishing path (#252) must render through these channels. Cost if wrong: the ladder and the channels are contract sets, the decision one pure function and the read rule one predicate, so a change to either touches two files and the contract lock.

**Changes / changed by.** Builds on 0015 and 0017 (a new restricted table and its rule). Extended by 0041 (story records and their expressions).

## 0041 A story record is the parent and every telling is an expression, linked, flagged and never refused

*2026-11-26. Extends 0040. Part of #201.*

**Decision.** Seven rulings, each with what it costs if wrong.
- **The record is the page; the tellings are rows.** The `impact_story` page stays the story record: its title is the story's name, and its frontmatter gains `occurred_on` (a whole day or none), `place` (free text up to 120 characters) and `programs` (ids of live program pages the writer may read, checked on every save and confirm with `program_not_found`). Country, region, languages, illustrates, themes, consent and level are unchanged. The body becomes the staff summary and research notes. *If wrong* (a story needs a partial date, or a place as a code): the fields are three keys of one Zod schema and one check function; a partial date is a new key, and old rows parse with defaults.
- **One table of expressions, owned by the stories module.** `story_expressions` holds one telling in one format and venue: title, a format from a closed set of thirteen, a venue, a render channel (the audience it reached or is meant for), `kind` `link` with an `https` address stored normalised (scheme and host lower case, default port and fragment dropped, credentials refused) or `native` with `page_id_native`, exactly one by a check, a BCP 47 language, the day it was told (none while drafted or planned), an excerpt of at most 1,000 characters, a status (`suggested`, `confirmed`, `retired`), who added it and who decided it. One address once per story. `internal`, `never` offline, like the other story tables but consent. *If wrong* (a telling needs two links, or one link serves two stories): the unique index and the one-location check change in one migration.
- **Told above its level, or without consent, is recorded and flagged, never refused.** A telling happened outside the platform; refusing to record it would hide the evidence the flag exists to show. `told_above_level` is computed at read time against the story's current level, so a withdrawal (which drops the level to `internal`) flags every telling above the platform; `told_without_consent` marks a telling outside the platform whose day the consent did not cover (none recorded, given later, expired before, or withdrawn on or before that day). Flags show on the story page, as counts on the Story Bank, and in `read_story`; retired tellings keep their row and leave the counts. *If wrong* (flags should freeze at the level when told): store the level beside each row; today a later raise clears an earlier flag.
- **Agents do the research and collation over MCP, and decide nothing.** `list_stories` (row-filtered) finds a story before a duplicate is made; `write_page` makes and edits the record (an agent's lands suggested); `add_story_expression` (editor) lands `suggested` with the agent as adder and answers a repeated address on the same story with the existing id and `created: false`; `update_story_expression` (editor) edits only an expression the agent added that is still suggested; `read_story` (viewer) answers the record, level, consent state, expressions by format with flags and every use, and the consent's reference and person only under the `story_consents` row rule. Every story verb input is a strict object, so a status, level or consent field is refused. No verb confirms or retires an expression, sets a level or records consent; those are person commands at `/api/stories/commands/:name`, and a person's own addition is confirmed at once. `read_story` and `list_stories` are outside reads for the untrusted-content check. *If wrong* (an agent should retire its own mistaken suggestion): one more allowed transition for the adder.
- **Every told expression is a use.** The usage log on the story page lists recorded uses and expressions with a day told; the withdrawal report gains every expression (title, format, venue, channel, link, day, status) beside every recorded use. *If wrong*: the report is one Zod schema.
- **Place follows the consent's precision outside the platform.** Above `platform`, `readPageIn` cuts the record to the precision of a consent that is not withdrawn: `region` keeps country and region, `country` the country, `none` or no consent nothing, and `place` is never shown, since free text cannot be shown to be no finer than a region. The Story Bank, a staff screen, shows the place with the precision it may be told at. This also stops the region leaking at `country` precision, which ADR 0040 left open. *If wrong* (a place that is only a region name is hidden needlessly): add a precision finer than `region` to the consent set.
- **Native expressions are reserved, not built.** Building one needs a page type for the telling whose every read path (screens, exports, verbs, search, embeds) takes its story's level and consent through `storyChannelFilter`, as a story's own files do, and a writer that sets `page_id_native` only for a page of that type. *If wrong*: the column and check are there, so it is additive.

**Why.**
- **One story, many tellings, one consent.** The organization reuses a story across social media, reports and newsletters; tracking where it was told is what makes a withdrawal of consent traceable to every post and document, and what stops the same story going to the same funder twice.
- **Agents collect; people decide.** Initially an agent researches and links the tellings; idempotent verbs make a rerun safe, and leaving every decision to a person keeps ADR 0002's boundary.
- **A record is evidence.** A flag on a stored row says what happened; a refusal would leave a post on the web with no trace in the platform.

**Rejected.**
- Each telling as a page under the story. Every telling would be a page to gate, level and filter on every read path, the work native expressions are deferred for, and links outside would still need a home.
- Refusing a telling above the level or without consent. It hides the evidence.
- Telling text stored whole. An excerpt is enough to recognise it, and a whole document copied in is a second copy to keep consented.
- A `confirm_story_expression` verb, or agent retirement. Both are decisions.
- Matching duplicates by title. Addresses are what an agent can find again; titles change between tellings.

**Consequences.** The story bank adds four verbs (contract 15.4.0) and six refusal reasons (`url_not_https`, `story_retired`, `expression_not_found`, `expression_exists`, `expression_decided`, `program_not_found`). Flags cost a level and consent read per story listed. A person adding a link that is already on the story is refused with `expression_exists`, not answered with the old id, so the form says so. The Story Bank list reads each story's precision one by one. Links out are shown as written by people and agents; they are `https` and opened with `rel="noopener noreferrer"`, never fetched by the platform.

**Changes / changed by.** Extends 0040 (the record's fields, the expressions table, the flags, the withdrawal report and the place precision on wider channels).

---

# Part 2. Workflow design decisions

The shorter decisions of the workflow module (the "harness" in code), under their original ids. An id that a Part 1 entry now states in full points there. Entries that only narrated the order of the first builds were dropped.

## The first design (D)

| Id | Decision |
|---|---|
| D1 | Software delivery first, Build-Measure-Learn second, both shipped as templates on one stage machine. The GitHub App came into the first version because its deploy and measure facts are already machine-readable. |
| D2 | No native phone app. "Waiting on you" is served by web push from the installable web app and by the Zulip bot; the contract package stays mobile-ready. Rejected for now: iOS and Android apps, which an earlier brief asked for. |
| D3 | One Durable Object per active workflow as a wakeup hub with per-session cursors; polling stays as the fallback. |
| D4 | A published contract package: one live version, golden fixtures and a conformance test, so the web client, a later client and personas cannot drift. |
| D5 | Two first-class hosts. See 0006. |
| D6 | Each stage names the stages it `feeds`, so Iterate can route back to Build or Package. An unattended traversal of a loop edge runs only under a delegation, and the Ship property test walks these edges. |
| D7 | The event log is the source of truth. See 0004. |
| D8 | The ship rule and the Ship invariant. See 0003 and 0010. |
| D9 | **Open.** Which Deploy channel is wired first (the web host, the mailing list or a social connector), and whether the publishing site joins the workflow's Ship stage. Until decided, every effect connector but `merge` answers `not_wired`. |
| D10 | The Product Package is three typed pages (`system_goal`, `product_strategy`, `data_sources`) under a product page, so agents read the package as markdown. |
| D11 | External runs self-report tokens, labelled subscription; the breaker never counts them. Hosted runs read AI Gateway's cost data. There is no token ledger of our own. |
| D12 | On a person's own machine their git credentials are present. Accepted, guarded by branch protection on `main`, a `harness/<item>` branch convention, and the ship rule checking that the pull request's head is the commit the item expected. |
| D13 | Anyone holding `editor` on the workflow's area may mint an agent identity under themselves and claim from it. There is no separate allow-list. Reads follow 0015. |
| D14 | Personas select verbs; a new verb is reviewed code; `requires_tools` makes a missing verb a visible card. See 0002. |
| D15 | A persona is a page type: typed frontmatter, a markdown body as its instructions, moved from `suggested` to `active` by a person after a tool check and a dry run. Its toolset is limited to its creator's grants. |
| D16 | One engine seam, an engine per directory. See 0006. |
| D17 | Billing follows the host; one cap across vendors; hosted Builder off by default. See 0006. The first wording allowed "hard stop or fail-over to a cheaper model"; the fail-over was withdrawn by P27. |
| D18 | Delegations. See 0005 and 0010. |
| D19 | `risk_tier` and `risk_domains` on every item, floored from the diff's paths and declared in the pull request. `high` needs two reviewer identities whose resolved model providers are distinct, and an approver holding the grant each touched domain names. |
| D20 | Close is a validator, `learning_attached`: a suggested learning or skill page, or a signed "nothing learned". Evidence labels are required on every Iterate revision. |
| D21 | `openrouter-messages` is the always-on tier and the baseline model service. See 0006. |
| D22 | A scheduled routine on a person's machine is an external runner on a delegation. See 0005. |

Also settled in the first design's review: the scout pass is the first step inside Builder, not its own persona, until premise-refusal rates show it earns a stage; whoever holds `admin` on the workflow's area approves at Ship, by grant and never by name; when a person's machine dies mid-claim, the lease expiry marks the branch abandoned, the harness skill pushes a `wip:` commit at the expiry warning, and the next claim starts from the expected head unless it adopts the branch.

## Decisions made while writing the requirements (P)

| Id | Decision |
|---|---|
| P1, P35 | Kernel naming, the Store test adapter and port contract tests. See 0001. |
| P2 | Reviewer diversity is judged by resolved model provider, not by vendor or engine. `reviewer_providers_not_distinct` is in the refusal set. |
| P3 | Reviewer's default engine is `openrouter-messages`; `codex-sandbox` is the second identity. |
| P4 | Closed sets are CHECK-constrained text columns, not Postgres enums, so a contract change is a migration of a constraint. |
| P5 | Area scopes share one text form, `NN-NN`, everywhere an area is stored. |
| P6 | The Postgres driver is `postgres` with Drizzle's `postgres-js` adapter. Every table is declared through `declareTable` (`packages/db/declarations.ts`), which records it in a registry a test walks. |
| P7 | The event position is a per-workflow sequence. Events are never archived. A repair routine rebuilds the item projection from the log. |
| P8 | The lease length and its warning are constants in `packages/harness/items/leases.ts`. An expired lease is detected lazily by the claim predicate and by the minute cron; `lease_expired` is written once. A failed `wip:` push is logged and the lease still expires. |
| P9 | An item traversing a loop edge is the same item re-entering the earlier stage, with `loop_edge_taken` recorded. |
| P10 | The walker cuts a cycle at the first revisited stage on a path. An effect stage's own `human_approval` exit satisfies the property; exits belong to the stage, so no edge can bypass one. |
| P11 | The ship rule reports every failing reason, in a fixed order. |
| P12 | Override may bypass a missing reviewer approval and open review findings only. It never bypasses a head mismatch, red checks, an undeclared tier, the `high` reviewer rules, or the grant check. |
| P13 | The locked re-read refuses with `approver_lacks_domain_grant`. Take over releases any lease and sets the person as holder. |
| P14 | A delegation carries one capability word from the closed set in `packages/contracts/closed-sets.ts`; `none` opens nothing. Renewal writes a new row that names the one it supersedes. The beat check takes no row lock. |
| P15 | Protected directories map paths to risk domains: migrations; the ACL and everything that decides what Ship sees and what merges; infrastructure, CI and the architecture checks; and a future ledger. The map is `packages/harness/risk/protected-directories.ts`, and derivation runs at every `submit_to_gate`. |
| P16 | The pull request declaration is a fenced block in the body headed `harness`, with `closes`, `risks`, `touches`, `risk_tier` and `risk_domains` lines. Its parsed shape is a contract schema. |
| P17 | Default agent pickup: none at Package and Ship, allowed elsewhere. A default WIP limit per stage. Stage positions are gapped. A stage holding an item cannot be removed. |
| P18 | Trace ids are UUIDs carried in an `x-trace-id` header and on every event row. Request and response bodies are never logged. |
| P19 | Webhook replay detection stores only the delivery id. The ingest system identity is `agent:ingest`. |
| P20 | Page status is a closed set. Slugs are unique per area. Page writes use a version check and refuse a stale version. Search is Postgres full-text. |
| P21 | Local development uses a dev-only principal enabled by a variable the staging and production environments cannot set. A pending person is approved by an org admin. |
| P22 | The workflow's merge method is squash and the tag is `harness/<item>`. A redelivered `requestId` replays the first outcome. Commands are `POST /api/harness/:harness/commands/:name`. |
| P23 | The live hub uses WebSockets with backoff, with polling as the fallback. A wake carries no position, and wakes in one tick coalesce to one. |
| P24 | Web push has a per-person cooldown. Stage-advanced wakes go to the item's holder only. Presence comes from the live hub. A failed send is not retried. The payload carries no delegation id. |
| P25 | Zulip topics are named `<workflow>/<item ref>`. Only waiting-on-you and run-failed reasons post. A post uses no cooldown and mentions no one. Replies become comment events; a reply from an unmapped author is recorded with the email and no person. |
| P26 | A failed run is a Cloudflare Workflow that has exhausted its retries or been aborted. A failed hosted run under a delegation wakes the delegating person. |
| P27 | The spend breaker stops; it does not fail over to a cheaper model. This withdrew the fail-over in D17's first wording. |
| P28 | The persona dry run is one turn against a fixture item on test adapters that writes nothing durable. A persona whose missing verb later ships needs the person to press Activate again. |
| P29 | Builder's hosted model is the persona page's `model` field. For `high` items the first reviewer reads for correctness and the second for security. |
| P30 | `assumed` and `inferred` learnings get a default review date after their `as_of`. A contradiction is detected by `supersedes` alone. |
| P31 | Each stage's bracket is a column on the stage row. Reorder is a menu action with drag-and-drop as an addition, and the keyboard way always exists. The play-by-play is paged. A gate the person cannot decide for lack of a domain grant is not shown to them. |
| P32 | The service worker caches the shell only and holds no workflow data. The tested phone width is fixed. |
| P34 | The engine seam's loop has a turn cap. A tool error is returned to the model as the tool result. |

Dropped: P33 (per-pull-request databases on a database vendor no longer used), the part of P35 about a requirement-trace gate that was removed on 2026-11-12, and the open-question rows about a phone app and seat prices that D2 and 0006 now answer.

## Decisions for merge delegation, fix claims and intake (V2)

*2026-10-15.*

| Id | Decision | Cost if wrong |
|---|---|---|
| V2-1, V2-7 | Merge delegation is in, off by default, with no agent verb added. See 0010. | See 0010. |
| V2-2 | The fix claim is in, off by default on every workflow: after a review round records real or plausible findings and the item's claim is free, a Builder holding a `fix` delegation may claim the fix on another author's pull request, within a size cap, without changing its declared purpose, and only after running the repository's checks. Rejected: a second writer pushing while the author holds the claim. | A fix lands that the author did not want; bounded by the cap and a revert. |
| V2-3 | Untrusted content is a rule plus a check, not a defence system. Outside text that reaches a prompt is wrapped and labelled with its source; prompt reads use the run's own principal; a static check fails the build on an unwrapped outside read. A connector that brings in new outside content inherits the rule. | A later connector finds the rule the wrong shape and it is reworked once. |
| V2-4, V3-1 | Epic intake is in: intake refuses an issue without a done-when. **Lessons with statuses are deferred and not scheduled.** The intended design: `rejected` and `recurring` join the page statuses; an active learning may point at the test or check that enforces it; health counts adopted learnings with no enforcing check; a cross-item view groups learnings by area. | Lessons from real use wait to be filed. |
| V2-5 | The platform is the record's home. An outside review bench is offered it as a plug-in through two hooks: its approvals read as Reviewer verdicts, and its rulings land as `suggested` learnings. | The bench declines and two stores grow; the hooks still serve a later reconciliation. |
| V2-6 | An approval survives a base-only update. The ship rule accepts a Reviewer approval on an earlier head when the pull request's patch identity is unchanged between that head and the current one; the record names both heads. | An approval is honoured on a head the reviewer never saw whose diff is identical; CI re-runs on it and must be green. |
| V2-8 | Built for unfoldingWord's volume. Not built: a ruling ledger as a GitHub comment protocol, re-approval churn machinery, anything sized for a hundred pull requests a day. Batch gate decisions answer the click bottleneck. Also not built, each waiting for evidence: Linear or Jira as an intake source, quiet hours, a phone-call rank, a planner persona, memory across items. | A click bottleneck appears at a few pull requests a day, which batch decisions already answer. |

Related rulings from the same round: a shadow workflow is turned on or off by the admin command `set_shadow`, replacing an earlier one-way "lift" command; and the closed set of untrusted sources is the one in `packages/contracts/closed-sets.ts`.

## Decisions for the look (V3)

*2026-10-21 to 2026-11-04.*

| Id | Decision |
|---|---|
| V3-2, V3-3 | One generated token system, locked in Tailwind. See 0011. |
| V3-4 | Both themes are complete. Dark was judged first; light uses the same roles and passes the same contrast test. |
| V3-5 | Every text colour pair passes WCAG AA, as a test. A design that needs lower-contrast text fails the build until it is rethought. |
| V3-6 | Fonts are bundled with the Worker. See 0011. |
| V3-7 | Font Awesome Pro by token. See 0013. |
| V3-8 | Charts are ECharts as SVG. See 0012. |
| V3-9 | Navigation items and page names are Title Case; everything else is sentence case. |
| V3-10 | A workflow has a display name, `harnesses.title`, separate from its key and changed only by the admin command `set_title`. |
| V3-11 | Nothing on a screen is invented. Every figure has a source in the database; what is not recorded is not drawn. Live agent readouts, per-indicator history and a lease progress bar were removed for that reason. |
| V3-13 | Normal branches, no worktrees. See 0032. |

Dropped: V3-12 (the mockup is not committed) and V3-14 (go-live ran on its own track), which describe how that build was run.

---

# Part 3. Other product rulings

Rulings made by an owner when accepting a design, where no numbered entry covers them.

**Knowledge base (2026-11-20).**
- The knowledge base was the first slice of the Notion replacement, ahead of the databases.
- Live co-editing was part of the first build, not deferred, and transclusion is required. See 0030.
- Wiki links work for input everywhere text is entered. Links are stored by page id, so a rename does not break them.
- Search stems in English.
- Not built on purpose: block storage (markdown is the record); inline databases inside pages (typed records and collections replace them); multi-column layouts and cover images; per-page sharing; an "always editable" preference, which would bring back stray edits for anyone who chose it.

**Access and sign-in (2026-11-19).**
- Sign-in is Google through Cloudflare Access. An outsider who signs in lands as pending and is decided by an org admin, not refused at the door.
- A page a reader may not read is answered as not found, never as not permitted, so the platform does not confirm that it exists. See 0015 and 0021 for the same rule on personas and credentials.
- Tables with no area follow the record's owner. See 0017.

**Collections (2026-11-21).**
- The words are in `CONTEXT.md`: collection, property, saved view and the rest.
- Not built on purpose, each a person's call if wanted later: real recurring tasks (a "recurring" status option imports as a status), and grouping on free text beyond an exact match (a structured property is the better fix).

**Credentials (2026-11-19).**
- The order of work was: narrow reads first (0015), then classification-aware reads (0017), then the store.
- Platform secrets and area credentials are different things. Platform secrets are what the platform itself runs on (0022); area credentials belong to an area's work and live in the store (0018 to 0021).

**Open, for a person to decide.**
- D9: which effect connector is wired first after `merge`.
- Whether the platform's own repository may be granted a merge delegation (0010).
- Whether the Font Awesome Pro licence covers this repository (0013).
- Whether old credential versions are destroyed after a grace period (0019).
- Private personal pages (0031).
- The licence for this repository.
