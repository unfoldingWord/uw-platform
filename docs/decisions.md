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

**Decision.** A persona touches the platform through one remote MCP server that serves exactly the verb registry published by `packages/contracts`. There is no verb for approving, merging, deploying, publishing or advancing past a human gate, for any agent identity, on any host. The one effect an agent causes with no person deciding is an assistant's direct effect, inside the closed set of 0036, run at the end of a turn and never by a verb. A persona is configuration over the verb registry and the run-shape registry; it selects from both and adds to neither. A new verb, run shape or engine is reviewed code.

**Why.** The gate is enforced by the absence of a route, not by a prompt or a permission check a prompt could talk around. A verb that does not exist cannot be granted.

**Rejected.** A broad internal API that agents call with a role that denies the dangerous verbs. The boundary would then sit in an authorization check every new route has to remember, and a persona would have somewhere to ask for an exception.

**Consequences.** The served tool list is tested equal to the registry and free of the forbidden names (`FORBIDDEN_VERBS` in `packages/contracts/verb-names.ts`). Activating a persona whose `requires_tools` names an absent verb fails visibly and opens a card on the software workflow. Both hosts see the same tools, asserted in CI.

**Changes / changed by.** 0010 adds no verb but changes what the kernel does with `submit_to_gate` at a merge Ship stage when the claim carries a live merge delegation. 0020 and 0028 each confirm the rule for a new capability (no verb takes a credential reference; `render_pdf` makes a file and cannot send it). 0036 lets the registry hold assistant verbs that draft effects which take effect without a person, only within its closed low-risk set; no gate verb is added.

## 0003 The Ship gate is a Postgres invariant, and the ship rule is a pure function over facts

*2026-09-29, amended 2026-10-15.*

**Decision.** Two rulings that only work together. First, a stage with an external effect cannot exit without a human: `harness_stages.connector` and `exit_gate` are `NOT NULL`, and a check constraint requires `connector = 'none' OR exit_gate = 'human_approval'` on insert and update. Templates stay data; the invariant does not. Second, whether Ship may exit is decided by a pure function whose inputs are GitHub facts about the head commit, the item's risk tier and domains, the workflow's required checks and freeze, and the approver's principal with its resolved grants. The item's own narrative record is never an input. Its output is advance, or refusals from a closed set. When a decision is recorded, the command locks and re-reads the approver's grant rows in the same transaction as the `gate_decisions` insert. The rule runs a second time immediately before the merge connector, and the connector merges only the head that second run evaluated.

**Why.** An earlier draft held both "a stage is a row, not code" and "the gate is the absence of a route", which conflict: a template author, an admin or an agent with page-writing rights could lower Ship's gate. Review also found that a bare implication passes on null and that a co-transactional read is not atomic under read committed; both are answered by the constraint text and the lock.

**Rejected.**
- The exit gate as template data only.
- A stored verdict the merge reads. A verdict written for one item or one head can be read for another.
- A quorum of approvers. The rule takes exactly one approver principal; an item touching two risk domains needs one approver holding both grants.

**Consequences.** Stage rows are edited only by an admin command, never through a page. A property test walks every template's paths, loop edges included, and fails if any reaches an external effect without a human gate. Two tests stay on real Postgres: the migration test that tries to insert an effect stage with a `checks` exit, and the race test in both orders.

**Changes / changed by.** 0010 adds the delegated Ship exit: the "approver is a human" check is unchanged, new checks bind an agent actor to a merge delegation, and the rule's input gains the delegation's tier and the protected paths. 0036 leaves the Ship constraint untouched and adds a twin: a check constraint on `assistant_effects` holds an assistant's effects done with no person deciding to its closed low-risk set.

## 0004 Events are the source of truth; item state is a fold, and replay equals record

*2026-09-29.*

**Decision.** Everything that happens to a workflow is a row in `harness_events`: append-only, from a closed vocabulary in `packages/contracts`, carrying the actor's full identity string, the host and the cost basis. An item's state is a fold over its events. The play-by-play, the queue, the dashboard feed, the live hub's wakes and the audit trail are all reads over the same rows; none keeps its own bookkeeping. Failures are events too.

**Why.** One source means the dashboard, the audit trail and the play-by-play cannot disagree. Recording a refused gate attempt, a refused stage edit and a lapsed delegation as rows is what makes the gaps visible on screen instead of hidden in a prompt.

**Rejected.** A `history jsonb` column on the item. The item row would be the truth and the history a copy that drifts.

**Consequences.** The database refuses UPDATE, DELETE and TRUNCATE on `harness_events`. A property test asserts that folding an item's events reproduces its stored record. Clients hold a cursor into the log and read forward from it, so a dropped wake loses time and nothing else. Adding an event is a contract change to a shared root and is named in the pull request; it may share a commit with the feature it serves (`AGENTS.md` rule 4), which replaces this entry's first wording that it must be its own pull request.

**Changes / changed by.** 0020 rules that a credential use is not a workflow event.

## 0005 Unattended work runs on a delegation, on every host

*2026-09-29.*

**Decision.** An unattended beat (a scheduled Cloudflare Workflow, or a person's routine on their own machine) carries no one's authority. It carries a delegation: a row in which a person holding `admin` on the workflow's area grants a persona one capability word for a bounded time, revocable, with a required expiry that defaults to ninety days. The one other grantor is a personal harness's own person, who alone grants `assist` there (0036). Every unattended claim, on either host, presents a live delegation or is refused `delegation_required`. At every beat the kernel checks that the delegation is unexpired, unrevoked and that the grantor still holds `admin` (for `assist`, that the grantor is still the harness's person and still holds a live grant); any failing stops the loop and writes `delegation_lapsed`. The identity on every event names the host and the delegation. A routine is bound to one delegation: its machine login presents that delegation or is refused, a paused routine is refused, and revoking the routine deletes its Cloudflare service token.

**Why.** The platform requires a principal on every request, and an unattended beat has no live human session to mint one from. The authority must be the approver's, must end when the person leaves or loses their grant, and needs an explicit record.

**Rejected.**
- "Beats carry their creator's authority." It never ends and names the wrong person.
- Treating a person's scheduled routine as an ordinary external runner. That quietly exempted it from the delegation check.

**Consequences.** A non-interactive principal cannot claim without a delegation id. Delegations appear on the person's page, the persona's dashboard and the access review, as time-boxed grants do.

**Changes / changed by.** 0010 gives the capability word `merge` a maximum tier and makes it alone able to lend the Ship exit. 0036 adds the capability word `assist`, granted on a personal harness by that harness's person rather than an area admin, and live while that person still holds a live grant.

## 0006 Two first-class hosts, one verb registry, an engine seam, and billing by host

*2026-09-29, confirmed 2026-11-17. Changed by 0038.*

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

**Changes / changed by.** 0028 prints the same server-drawn SVG.

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

**Decision.** A grant on a Johnny.Decimal area, of any role, reads that area and no other. Only an `org`-scope grant, of any role, reads every area. Write and admin are unchanged: they need a grant on the area itself or at `org` scope. Everything that filters by `can(read)` or `readableAreas` (`packages/core/acl.ts`) narrows with it: page search and reads, agent context, the untrusted-content clearance key and the notification holders of an area. An agent's MCP session runs with its bound person's grants, so an agent reads only the areas its person holds grants in. A person's assistant holds its person's grants clamped to `viewer` (0036). To keep the open culture for someone, an org admin grants them `viewer` at `org` scope.

**Why.** The first design let an `editor` or `admin` on one area read every other, to stay as open as the Notion workspace the platform replaces. That meant an editor on 80-89 could read Finance (20-29), and the credentials store, gifts and the ledger would have been readable the same way. Narrowing the default means a new table is closed until someone grants access, and openness becomes a visible, audited grant, not a side effect of being an editor somewhere.

**Rejected.**
- Keep the open read and carve out restricted data by classification. Every new sensitive table would have to remember to opt out, and one that forgot would leak.
- Narrow reads only for `restricted` and `sensitive` tables. Every page type is `internal`, so a page in Finance stayed readable from any area, which was the exposure the owner asked to close.
- A new `reader` role with org-wide read. That is `viewer` at `org` scope, which already exists.

**Consequences.** Workflow lists, search and agent context are scoped to a person's grants. A hosted run reads its persona's instructions only if the run's principal may read the persona page's area, and is otherwise answered `page_not_found`, so a persona page in another area cannot run and its existence is not confirmed. Any runbook that lists who belongs in an area's private channel follows this rule: people with a grant on that area or at `org` scope.

**Changes / changed by.** Overturns the first design's "an `editor` anywhere reads org-wide". 0017 closes the gap this left for `org` grants on restricted rows. 0031 gives every approved person `viewer` on 00-09. 0036 gives the principal under an `assist` delegation its person's grants clamped to `viewer`, in every area the person reads, not only the personal harness's area.

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

*2026-11-20. Changed by 0037.*

**Decision.** One function, `useCredential` in `apps/uw-platform/credentials/use.ts`, is the only way a value leaves the store for use. The caller names a credential by reference with the workflow, connector, run and acting principal, and passes a function to call; it never receives bytes or text. The store does not trust the grants on the principal: it looks up the run's person, refuses one who is not active, and reads that person's live grants at the moment of use, and again at the final check of 0019. The value exists as a `Secret` for the length of one call; only `exposeSecret` gives the text back, and afterwards the bytes are zeroed. Everywhere else (a string, JSON, a log line, an event, a page) a `Secret` renders `[secret]` and does not throw. What the caller's function returns is searched for the value before it is handed back, and an outcome that carries it or cannot be walked is refused `value_in_outcome`; a function that throws is answered `connector_failed` with no text. Binding and unbinding need `manage` and are logged. Nothing is cached. No verb is added and no verb takes a reference: a reference is named in configuration a person writes, never in a tool call. A use is a row in the credential access log, not a workflow event.

**Why.** A value has to get from the store to the outside service a connector calls without passing through anything an agent can read. Connectors run on a stage's exit after its gate, never from a verb, so a verb that ran one would let an agent pass a human gate. An event naming a credential would tell everyone who reads the workflow's area that it exists, which is `see`.

**Rejected.**
- Trust the grants on the principal. A grant revoked during a long run would keep working until the run ended.
- A person principal built for the check, as a delegation's lender is. The log would then name the person as the actor of a call an agent made.
- Return the value and trust the caller to drop it. One caller that put it on a result would leak it into an event.
- A `Secret` that throws when serialised. It finds the mistake sooner, and fails a production request for a mistake that leaked nothing.
- A short cache of opened values. It keeps plaintext in an isolate between requests and lets a use succeed after a revoke with no matching log row.

**Consequences.** Build rules hold the boundary: only the store imports the files that open a sealed value; only the store and `apps/uw-platform/ports/connectors.ts` import `use.ts` and `secret.ts`; nothing under `mcp/`, `engines/`, `runs/` or `agents/` imports the store. A JavaScript string cannot be zeroed, so the exposed text lives until garbage collection. The outcome search is a net, not a proof: the build rules are the proof. `manage` on the credential is enough to bind; a use still needs `editor` on the credential's own area. The binding, which names the workflow, is what keeps a delegated run to the credentials meant for it.

**Changes / changed by.** Builds on 0002, 0017, 0018 and 0019. 0021 adds the one file that opens a value for a person. 0036 rules that an assistant's effect is not a connector: it runs at the end of an assistant turn through its own port, never from a stage exit.

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

---

## 0036 A person's assistant is a persona on their own harness, lent authority by that person, acting directly only within a closed low-risk set

*2026-11-26. Changes 0002, 0003, 0005, 0015 and 0020. Changed by 0037, 0038, 0039, 0040, 0041, 0042 and 0043.*

**Decision.**

1. **A personal harness.** Each assistant has its own harness: template `assistant`, no stages, key `assistant-<personId>`, in the assistants area. `harnesses.person_id` names its one person; a check constraint holds `(template = 'assistant') = (person_id IS NOT NULL)`, and a unique index allows one assistant per person. Only `kernel.assistants.provision` creates one, for an org admin or an admin of the assistants area (amended by 0040: the person turns their own assistant on with `kernel.assistants.enable`, and `provision` is reached by no route). The template is not in the templates registry and not in `templateKeySchema`, so no generic command creates or switches to it. Stage edits on a personal harness are refused, so no item can enter one.
2. **A real persona per person.** The identity is `agent:assistant-<personId>`, stable across renames and email changes. Its persona page is seeded from the **assistant role**, a fixture in code (`packages/harness/assistants/role.ts`): instructions, a fixed toolset with no write verb, an engine, a capability word and a monthly budget. It is activated through the existing tool check and dry run. Activation refuses an `agent:assistant-*` identity on any harness but that person's personal harness, and any other identity on a personal harness. The person's **customisation** (display name, an instructions addendum and a timezone) lives in an owner-only row and is appended after the role under "the role's limits win". It never replaces the role.
3. **Authority is a delegation the person grants.** The capability word `assist` is grantable only on a personal harness and only by that harness's person; every other word is refused there. Expiry (default ninety days), revoke, supersede and lapse are unchanged. An `assist` delegation stays live while its grantor is still the harness's person and still holds a live grant. The rules sit in one policy registry per capability word (`packages/harness/delegations/capability.ts`), not in a branch. The assistant's principal holds its person's live grants clamped to `viewer`, each ending at the earlier of the grant's and the delegation's expiry, so it reads only what its person reads, never an owner-only row, and makes no platform write through a write verb. The workflow run beat skips `assist` delegations, and no device host can act under one.
4. **Requests and turns are kernel commands on the personal harness, and events carry no content.** A request is recorded by the ingest principal, once per channel and external id. The person's text and any untrusted parts live only in owner-only restricted tables (`packages/db/schema-assistants.ts`) that are never offline. Every change records a `harness_events` row on the personal harness in the same transaction, whose evidence holds only ids, closed sets and numbers, so `harness_events` stays the one source of truth (0004 unchanged). Wakes on a personal harness go only to its person and are never posted to a Zulip stream.
5. **The closed low-risk set.** An effect is done with no person deciding only if all six hold: it lands on the requester's own resource or the assistant's own; no third party receives, sees or is told of anything; it moves no money and shares nothing beyond the requester; the requester can undo it in one step; its parameters, target included, are fixed in code and not chosen by the model; and its volume is capped. The set is `assistantDirectEffectSchema` in `packages/contracts/assistants.ts`:
   - **Reply to the requester.** The turn's final text, sent to the address the verified request came from. The recipient is copied by code from the request record and sent only when it is the person's verified binding for that channel; the model has no recipient parameter, and the text was produced under the person's own viewer grants.
   - **Reminder set or cancelled.** A row in the person's own reminders, between a minute and two years ahead, delivered only to the person.
   - **Calendar hold added, changed or removed.** An event on the person's own primary calendar, reached through their share to the assistant mailbox, with no attendees, no notice sent, private visibility and a private marker naming the effect; at most 24 hours long and starting within 18 months. Only an event carrying this assistant's marker may be changed or removed.

   Reads are not effects. Caps: five direct effects per request, twenty holds and fifty reminders a day.
6. **Everything else is a proposal its person decides.** An email or direct message to anyone else, an invitation with attendees, an RSVP, a change to an event the assistant did not make, any write to a shared page and an expense line are proposals. A proposal waits in an owner-only table, and only its person decides it, on the web app, through a person-surface command with an interactive human principal. A chat or email reply saying "yes" is a new request, never a decision. The decision binds a digest of the proposal's payload, and the proposal runs only if the digest is unchanged. Payment, purchase and booking are never available, even as a proposal.
7. **Effects run at the turn's exit, never inside a verb.** Assistant verbs only draft effects. `finishTurn` re-reads the turn's drafts, classifies each again, runs direct effects through their own ports (`DirectMessages`, and later a Workspace port) and turns any other kind into a proposal. A reminder is a draft until its turn ends; it fires later from the minute cron with no model, at most once (its row is claimed before the send), to the address of the request that set it, and only while the `assist` delegation is live; otherwise it is recorded undelivered and nothing is sent.
8. **Enforcement is mechanical.** The closed sets are contracts, so the set cannot grow without a contract change and a new entry here. A check constraint on `assistant_effects` admits only the closed set; once proposals exist it also admits an effect whose proposal a person decided, a check constraint requires a proposal's decider to be a person, and a trigger refuses an effect whose proposal is undecided. An architecture test then fails if any agent-, MCP-, Cloudflare Workflow- or cron-reachable file writes a proposal's decision, in the manner of `tools/architecture/gate-writers.ts`. The port methods behind direct effects cannot name a third party.
9. **Who may instruct an assistant.** On Zulip, only its person, in a one-to-one direct message, bound by Zulip's sender id through a one-time pairing code; the sender's email alone is not trusted. By email, only mail whose first `Authentication-Results` header from `mx.google.com` shows `dmarc=pass` and whose From is the person's address. Automated mail never starts a turn. Forwarded, quoted or attached text, and others' calendar text, is wrapped as untrusted content.
10. **Spend.** Each turn checks the global breaker, then the persona's monthly budget (the first persona budget the platform enforces), then, once real traffic starts, a cap on all assistants together. The month's spend is summed from `assistant_turn_finished` evidence; a turn whose cost is unknown, and a turn admitted but not yet finished, counts at the role's per-turn ceiling, and admission is serialised per assistant, with a turn's settlement taking the same lock. A turn is admitted once per request and attempt: a retry of the same attempt replays it, any other attempt is refused, and a replay refused for pause, delegation, persona or breaker closes the turn with no usage. A reply's send is bound by a send-by time inside the delivery lease, so the port never delivers after a retry may have recorded `outcome_unknown`.

**Why.** Issue #123 asks for one named assistant per person that takes requests by Zulip and email and acts for them. The owner ruled that both channels are supported with a Google Workspace mailbox per assistant, that each person's assistant is its own persona seeded from a predefined role and customised by its person, and that it acts with no gate for low-risk effects on the requester's own resources while everything else is drafted and approved by a person. Until now every persona, delegation and event belonged to a workflow's area, and every effect outside the platform waited at a human gate (0003, 0020). A personal harness keeps the persona, the delegation and the event log as they are and changes only who lends the authority. A set closed in contracts and in the database, rather than a judgment in a prompt, is what lets an assistant act with no one deciding without letting an injected instruction reach anyone else.

**Rejected.**
- A separate assistant module with its own event log. It would be a second source of truth beside `harness_events`, against 0004.
- A standing permission in place of a delegation. It drops the mechanism of 0005, on which the owner did not rule.
- Items, stages and runs per request with a low-risk exit gate. It adds up to two minutes of latency, widens the exit and the agent boundary, carries request content into run steps, and would let any area admin decide the person's gate.
- Bending the area rule in `allowed()` for personal harnesses. Every caller that does not pass the person would stay on the area rule and fail open.
- Giving the assistant the person's editor grants. An injected email could edit shared pages live.
- Approval by a chat or email reply.
- Sending email as the person.
- Cloudflare Email Routing. It has no precedent in `infra/`, and its mailbox cannot send.

**Consequences.** PRD section 4.2 gains "Assistants" with requirements PA-1 onward. "An agent can produce a deliverable and cannot send it" and "no route reaches an external effect without crossing a human gate" each gain one named exception: the closed set above. A reply direct-messaged to its own person carries content; nothing posted to a stream does. Content-free assistant events are internal like every harness's events: readers of the assistants area and org-scope readers (0015) can see that a request, turn or effect kind happened and when, and never what it said. The request text goes to the model vendor; which provider, how long text is kept, which area holds the personal harnesses and how Google is reached are open questions in the PRD.

**Changes / changed by.** Changes 0002 (the registry may gain verbs that draft effects which take effect without a person, only within this set), 0003 (the Ship constraint is untouched; a twin constraint holds the assistant's set), 0005 (the grantor of `assist` is the harness's person, not an area admin), 0015 (the principal under an `assist` delegation holds its person's grants clamped to `viewer`, in every area the person reads) and 0020 (an assistant effect is not a connector; it runs at the turn's exit through its own port).

## 0037 One Zulip bot per person, paired by email or a one-time code, its key sealed by KMS

*2026-11-26. Changes 0020 and 0036. Changed by 0040.*

**Decision.**

1. **Each assistant is its own Zulip bot.** The owner ruled one bot per person (issue #123, decision 3), replacing the single shared bot 0036's design assumed. The platform creates each bot through Zulip's admin API, signed in as one org-admin service account (`ZULIP_ADMIN_EMAIL`, `ZULIP_ADMIN_API_KEY`), as an outgoing-webhook bot whose endpoint is `uw-ingest`'s `/webhooks/zulip-assistant`. It deactivates the bot when its person turns the assistant off and reactivates it when they turn it back on (`apps/uw-platform/assistants/zulip/provision.ts`). The person picks the bot's name.
2. **A bot's secrets never enter the Secrets Store.** Its API key is sealed with the credentials KMS key under its own encryption context (`purpose: assistant_bot_key`, the harness id and the bot's user id), so a key sealed for one bot opens for no other bot and no credential (0020's envelope, `apps/uw-platform/credentials/envelope.ts`). Its webhook token is kept only as a SHA-256 digest. Both live in `assistant_zulip_bots`, owned by `apps/uw-platform/assistants/zulip/`.
3. **`uw-ingest` verifies each delivery against its own bot.** The new source `zulip-assistant` reads the delivery's `bot_email`, looks up that active bot's token digest over Hyperdrive and compares digests in constant time; the delivery id is `zulip-assistant:<bot user id>:<message id>`, so one group message reaching two bots is not a replay. The stream bot's source, path and `ZULIP_WEBHOOK_TOKEN` are unchanged.
4. **A binding is the person's verified address, held by the kernel.** `assistant_bindings` holds one address per assistant and channel, and one assistant per address (a unique index). It is written only by `kernel.assistants`: `bindAddress`, for the system principal, when provisioning finds the person's Zulip account by their email and nothing is bound yet; and `completePairing`, for the ingest principal, when the account sends back the one-time code its person started on the platform (`startPairing`, for the person only, interactive and holding a live grant). A code lives ten minutes, is stored only as a digest, and is spent by five wrong tries. Each pairing records `assistant_paired`, `assistant_pairing_started` or `assistant_pairing_refused`, with only the channel and a closed-set reason.
5. **Only a one-to-one message from the bound account is a request.** The queue consumer's `assistantDmHandler` records a request only for a private message whose recipients are exactly the sender and the bot and whose sender id is the bound address; a group message, a stranger and a stream message record nothing, and a message that is only a pairing code is offered to `completePairing`. Zulip quote blocks (`> ` lines and `quote` fences) are fenced as `chat_quote` untrusted parts. An assistant takes at most thirty requests an hour.
6. **Replies go out as that person's bot, at most once.** The platform `DirectMessages` adapter (`apps/uw-platform/ports/direct-messages.ts`) answers `deadline_passed` at or after `sendBy`, `not_paired` unless the request's address is the person's binding and the bot is active, claims the effect id in `assistant_zulip_sends` before sending, and never sends an effect again once its outcome is unknown (Zulip takes no idempotency key). It passes the DirectMessages port contract against a recorded-shape fake of Zulip.

**Why.** The owner chose one bot per person so each assistant has its own name and identity in Zulip. Per-bot keys need a store that grows with people, and the Secrets Store is capped per account. Binding by Zulip user id, not email, keeps a masked or changed email from redirecting replies, and the one-time code covers a person whose Zulip email differs from their platform email.

**Rejected.**
- One shared platform bot (0036's design default). Overruled by the owner.
- A path per bot (`/webhooks/zulip-assistant/<id>`). A bot's id is not known until it is created, and the webhook URL is set at creation.
- Polling each bot's event queue. Workers have no long-lived process, and Zulip drops idle queues.
- Storing bot keys in the Secrets Store or the credentials vault rows. The store is capped, and the vault's rows are area-scoped credentials a person reveals, not platform keys.

**Changes / changed by.** Changes 0020 (its envelope also seals assistant bot keys, under their own context) and 0036 (item 9: the pairing is by email at provisioning or by a one-time code, and each assistant has its own bot). 0044 runs its staging probes as `pnpm probe:assistants` and the walk in `infra/README.md`.

## 0038 An assistant's turn is a Cloudflare Workflow named by its request, on zero-retention OpenRouter, inside its own spend pool

*2026-11-26. Changes 0006 and 0036.*

**Decision.**

1. **One Workflow per request.** A recorded request starts the `AssistantTurn` Workflow (`apps/uw-platform/assistants/turn/`) with the request id as its instance id, so a redelivered message cannot start a second one. A request whose start was lost (the queue gave up) is started by the minute cron two minutes after it was recorded, for up to a day. Its steps are `attempt` (one `attemptId` per instance, kept by the Workflow), `begin`, `loop` and `finish`. Every retry and restart of an instance replays the same turn (0036 item 10); a second instance for the same request is refused `turn_taken` and sends nothing. The `loop` step has no retries, so a model loop is never paid twice by a retry; a loop that fails is finished as outcome `failed`, its cost unknown and counted at the per-turn ceiling, and the person is told once. Delivery runs inside `finish`, through `finishTurn`, which claims, sends and settles the reply under its delivery lease; the step retries while another attempt's send holds the lease.
2. **A host that serves only the assistant.** The loop reaches the platform through an in-process MCP server under the turn's clamped assistant principal (host `assistant`), offered only the role's read verbs and the `assistant` verb group. The `assistant` group is served on no other host. Its verbs take the turn's request and turn id from the host, never from the model.
3. **Zero-retention OpenRouter only.** Assistant turns run on the platform's OpenRouter engine, pinned to the role's provider with no fallback, and every assistant request asks OpenRouter to route only to zero-data-retention endpoints (`provider.zdr`, `data_collection: deny`) on top of the account's ZDR lock. An engine that cannot honour that refuses the turn. Running on a person's own Claude subscription stays rejected (0006): the owner offered it only if the platform already supported it, and it does not.
4. **A separate assistants pool.** Assistants do not spend the platform's AI cap. Their pool for the month is the sum of the budgets of every assistant with a live `assist` delegation, each USD 20 unless an org admin set that person's (`set_assistant_budget`, the `assistant_budgets` table, `assistant_budget_set`), held under `ASSISTANT_SPEND_CAP_MINOR` when that is set. A turn is refused `assistants_capped` once the pool's month, counted like one assistant's, reaches it. The breaker subtracts the assistants' known spend from the gateway's reading. Every turn still respects the breaker's level and freshness, as 0036 says.
5. **Stale turns are closed.** A turn left open by a dead host is closed by the minute cron an hour after it started: as `abandoned` with no usage when no reply was claimed, releasing its reservation, or with the reply settled `outcome_unknown` once its lease has passed. A late finish for an abandoned turn is refused and sends nothing.

**Why.** The owner asked that a direct message to a person's bot produce a model-written reply end to end, on the platform's ZDR-locked OpenRouter account, with assistants in their own monthly pool of USD 20 each outside the platform cap (issue #123, decisions 7, 12 and 13), and that a crash never leave a turn reserved (review R11). A Workflow gives checkpointed steps that survive a Worker restart, and the request id as instance id makes the start idempotent without a table.

**Rejected.**
- Running the turn inside the queue consumer. A turn can take minutes, longer than a queue batch should hold, and a crash would redeliver the whole batch.
- Retrying the loop step. A retry calls the model again for the same turn and pays twice; failing closed and telling the person is cheaper.
- A fifth of the platform cap as the assistants' share (the build plan). Replaced by the owner's separate pool.
- Leaving assistant spend inside the breaker's reading. Assistants would then pause the platform's own agents.
- Releasing an abandoned turn's reservation at its ceiling cost. The owner asked that the reservation be released; the turn's real cost, if any, still reaches the gateway.

**Consequences.** `ASSISTANT_TURN` is bound in staging and production, in `wrangler.toml` and `wrangler.go-live.toml`. Preview has no Workflows, so a direct message there is recorded and its turn is not started (`not_wired` in the log). An abandoned turn counts no cost in the pool, so a dead host's model calls are spent but uncounted for that month. Whether assistants should keep running while the platform breaker pauses the platform's agents is open for the owner.

**Changes / changed by.** Changes 0006 (a third hosted shape, the assistant turn, billed to the platform's OpenRouter account) and 0036 (item 10: the cap on all assistants together is the pool above, outside the platform cap).

## 0039 The platform reaches Google with one domain-wide-delegated service account, allowlisted in code before it signs

*2026-11-26. Changes 0036. Changed by 0040, 0041, 0042 and 0043.*

**Decision.**

1. **One service account with domain-wide delegation.** The owner ruled it (issue #123, decision 1): one Google Cloud service account, its JSON key held as the platform secret `GOOGLE_WORKSPACE_KEY` in the Secrets Store (0022), uw-platform only, approved once by a Workspace super-admin for the scopes `gmail.modify`, `calendar.events`, `calendar.freebusy` and `admin.directory.user`. No person grants the platform their own Google consent, and no refresh token is stored.
2. **An allowlist in code, checked before signing.** `apps/uw-platform/assistants/google/token.ts` refuses, before it signs an assertion, any subject or scope outside one table: an active assistant mailbox (`assistant_mailboxes`) may be the subject for Gmail; an active person whose address is in `GOOGLE_WORKSPACE_DOMAIN` may be the subject for the calendar; only the one `GOOGLE_WORKSPACE_ADMIN_SUBJECT` may be the subject for the directory. Every other combination answers `not_allowed` and nothing reaches Google.
3. **The calendar is reached as the person, not through a share.** The owner ruled that the account impersonates each person for Calendar, replacing 0036's design in which people shared their calendar with their assistant's mailbox. Calendar calls are keyed by the person's id; the adapter resolves the address from `people` and refuses anyone who is not active in the domain.
4. **A hold is the assistant's own, provably.** A hold is a private event on the person's primary calendar, inserted with `sendUpdates=none`, no attendees and a private extended property naming the harness and the hold; its Google event id is the hold id's hex, so a retried insert meets Google's conflict and places nothing new. Removal reads the event first and deletes only one carrying this assistant's marker. Free/busy is asked only for addresses that are active people in the domain.
5. **A plain `fetch` client.** No Google SDK is added (AGENTS.md section 5): `googleapis` and `google-auth-library` depend on Node's HTTP stack and do not run on Workers, so the client is `fetch` plus `jose` (already a dependency) for RS256, with a five-second timeout per call. Access tokens are cached in the isolate's memory per service account, subject and scope set until five minutes before they expire; an access token is minted from a platform secret, not a vault credential, so 0020's rule against caching opened credential values does not reach it. A 401 forgets the cached token and mints once more.

**Why.** The owner chose domain-wide delegation so that assistants work for everyone without each person granting consent, and asked that calendar access act as the person. The allowlist keeps the key from acting as anyone the platform has not named, and a hold's marker keeps an assistant from editing events it did not make.

**Rejected.**
- A share from each person's calendar to their assistant's mailbox (0036's design). Overruled by the owner; it also needed a probe per person.
- An OAuth token per person or per assistant. It needs a consent flow and stored refresh tokens, and the owner chose delegation.
- The Google Node client libraries. They do not run on Workers.
- Caching tokens across isolates (KV or the cache API). An extra token request per cold isolate is cheap, and a shared cache would hold live tokens outside memory.

**Consequences.** A leaked key can act as any user in the domain for the delegated scopes; Google cannot limit delegation to some users. The mitigations are the allowlist, the four scopes, key rotation and Workspace audit alerts on unexpected subjects. Scope names, the token exchange, the conflict on a reused event id and the free/busy shape come from Google's published API, not a live call; staging confirms them before go-live.

**Changes / changed by.** Changes 0036 (calendar holds are placed acting as the person through domain-wide delegation, not through the person's share to the assistant mailbox). 0044 runs its staging probes as `pnpm probe:assistants` and the walk in `infra/README.md`.

## 0040 A person turns their own assistant on and off; a narrow provisioner principal makes its accounts, numbered from 10.51

*2026-11-27. Changes 0036, 0037 and 0039.*

**Decision.**

1. **Only the person turns it on or off.** `kernel.assistants.enable` and `disable` take only an interactive person, acting for themself, who holds a live grant. No admin, agent or system principal turns someone's assistant on (owner decision 5 says the platform creates the accounts when someone turns their assistant on). The person-surface routes `/api/assistant/commands/<name>` call them with the request's principal; they ask no `can()` on an area, because the only resource is the caller's own personal harness and the kernel holds the caller to it (`docs/exceptions.md`).
2. **The person picks the name, which is the address.** The name is the mailbox's local part exactly, `<name>@<GOOGLE_WORKSPACE_DOMAIN>`, with no suffix, and the Zulip bot's name (owner decision 9): lowercase letters, digits, dots and hyphens, 2 to 30 characters, no `..`, not a reserved mailbox name (`assistantNameRefusal`). It is refused when another live assistant holds it (a unique partial index) or when Google Workspace holds it as a user or an alias (Admin SDK `users.get`, which resolves aliases, asked before the kernel and again when the user is inserted: a conflict there is recorded `name_taken`).
3. **Numbers in area 10-19, lowest free from 10.51, reused after final deletion.** The platform kernel passes `assistantsArea = '10-19'` from trusted code (`apps/uw-platform/assistants/area.ts`), closing review R5. `enable` takes the lowest number from 10.51 upward that no assistant holds (10.99, then 10.100 and on; owner decision 10), under the advisory lock `jd-allocation:10`, keeps it while the assistant is turned off, and frees it only at final deletion. The wiki's suggester counts assistant numbers as taken in category 10, and the personal harness's title carries the number ("10.51 Barnabas").
4. **A narrow provisioner principal.** The platform's steps run as `agent:assistant-provisioner`: kind agent, no person, no grants, not interactive, a platform identity no persona can take (`assistantProvisionerPrincipal`, `isProvisionerPrincipal`). Only it may bind a Zulip address at provisioning (`bindAddress`, which was the system principal's), activate the suggested assistant persona on that person's personal harness (`activatePersona`, through the same tool check and dry run as any activation, and only an `assistant` persona for that harness's person), record provisioning outcomes and retire an assistant. It cannot grant `assist`; only the person can.
5. **Resumable, idempotent steps.** `apps/uw-platform/assistants/provisioning/` keeps one progress row per assistant, keyed to the account's version, and runs the steps for its goal. Turned on: the Workspace user (`users.insert` in `GOOGLE_ASSISTANT_OU`, a random password generated and sent once and stored nowhere, an external id naming the harness so a retry adopts its own user and a stranger's address is refused), the Zulip bot (0037), the persona, then waiting for the person's `assist` delegation. Turned off: suspend the user and deactivate the bot at once (owner decision 11). A failure is kept with a closed reason (`assistantProvisioningFailureSchema`), recorded once per account version and step as `assistant_provisioning_failed`, and retried with backoff by a guarded minute-cron step; the person's command drives the steps at once as well.
6. **Final deletion after 30 days.** A nightly cron step deletes the Workspace user of an assistant turned off 30 days ago (which frees the licence), leaves the bot deactivated, and calls `retire`, which clears the number and records `assistant_deleted`. Turning on again afterwards takes the lowest free number and makes a new Workspace user; the bot is reactivated and renamed.

**Why.** The owner ruled that a person turns their own assistant on, picks its name, gets a Workspace user and a Zulip bot made automatically, numbered from 10.51 with numbers reused after deletion, and that turning off suspends both, deleting the user after 30 days (issue #123, decisions 4, 5, 9, 10 and 11). The build plan had an area admin provisioning each assistant (0036 item 1), which would make every person wait for an admin and let an admin choose someone's assistant. A narrow principal, rather than the system principal, keeps the steps that touch Google and Zulip from carrying the system's other powers, and the steps' idempotency lets a crashed Worker or a refused API call be retried without a second user, bot or number.

**Rejected.**
- Running the steps as the person. A person holds no `admin.directory.user` right, and the steps must run unattended after the request ends.
- Running them as `agent:system`. It would let every system path bind addresses and activate personas.
- A `.assistant` suffix on the address (the build plan). Overruled by the owner.
- Keeping a number forever (the build plan). Overruled by the owner: numbers are reused after final deletion.
- A `jd_id` column on `harnesses`. The number belongs to the assistant account, which outlives a turned-off state and is cleared at deletion, so it lives on `assistant_accounts` beside the name and status.
- A Cloudflare Workflow per provisioning. The steps are short, idempotent and recorded; the minute cron re-drives them with no new binding.

**Consequences.** `GOOGLE_ASSISTANT_OU` is a new variable; `GOOGLE_WORKSPACE_ADMIN_SUBJECT`, `ZULIP_ADMIN_EMAIL` and their secrets must be set before any assistant can be turned on in an environment; until then every step is recorded failed `workspace_not_wired` or `zulip_not_wired` and the person sees that. A name held by a Google group, not a user or alias, is found only when the user is inserted, and is recorded `name_taken`; the person turns the assistant off and back on with another name. The Admin SDK request shapes come from Google's published API, not a live call; staging confirms them before go-live.

**Changes / changed by.** Changes 0036 (item 1: the person turns their own assistant on with `enable`, in area 10-19), 0037 (item 4: `bindAddress` is the provisioner's, not the system principal's) and 0039 (the directory is reached as the admin subject only by the provisioner, to insert, suspend, restore and delete assistant users).

## 0041 My Assistant is the person's own screen; an assistant's text is kept one year and the person may delete it sooner

*2026-11-27. Changes 0036 and 0039.*

**Decision.**

1. **One screen for the person, reached by everyone.** `/assistant` (My Assistant, Form shape, started from `new-agent.tsx`) is a module under area 10-19 in every sidebar. It reads `kernel.views.myAssistant`, which answers the person's own assistant in full, an org admin a named person's assistant without its content (accounts, number, budget and spend only; no settings, requests, effects, reminders or holds), and refuses anyone else. An admin's view is `/assistant?person=<id>` and carries the `set_assistant_budget` control (0038).
2. **Every control posts to the person's own endpoint.** `/api/assistant/commands/<name>` (0040) gains `customise_assistant`, `renew_assist`, `revoke_assist`, `undo_assistant_effect` and `delete_my_assistant_history`. Each acts on the caller's own assistant, found from the caller, never from the body; an agent principal is refused before any work. Pairing is a server form (`POST /assistant/pairing`) because its answer is a code shown once.
3. **Undo by the person.** `kernel.assistants.undoEffect` lets only the effect's person undo a `reminder_set` whose reminder is still set (it is cancelled and never fires) or a `calendar_hold_added` whose hold is held and not yet ended (the Workspace port removes it, then the hold is released with no releasing effect, which migration 0080 allows). Both record `assistant_effect_undone {effectId, kind}`. The person's undo is the person's own action, not an assistant effect, so it is outside ADR 0036's closed set and its caps.
4. **Retention one year (owner decision 8).** `kernel.assistants.redactHistory` as the system principal, run by a nightly cron step, empties the note and untrusted parts of every request recorded more than 365 days ago, the payloads of that request's effects (reply text, reminder and hold drafts), the text of reminders closed and the titles of holds ended or released more than 365 days ago. As the person it does the same for their own assistant up to now, except a reminder still set or a hold still ahead. Each row keeps `redacted_at`, and check constraints hold that a redacted row carries no text and that a set reminder is never redacted. Each batch records `assistant_history_redacted {why, requests}` per harness. Events are never touched: they carry no text (0004, 0036).
5. **A personal harness is listed only to its person and org admins.** `admittedHarnesses` (and so every harness list, the sidebar's Agent Queues and `readableHarness`) leaves out a personal harness for anyone but its person, an org admin and the system principal, even when they read area 10-19.

**Why.** The owner asked for the whole feature to work for a real person, with request text and replies kept one year and the person able to delete their own sooner. Without a screen the person could turn the assistant on only by hand-made requests; without retention the owner-only tables would keep every request forever.

**Rejected.**
- Deleting old request rows. The rows anchor the content-free events, the effects and the reminders through foreign keys, and the effect keys keep a retried turn from acting twice.
- Redacting a reminder still to come on delete-my-history. It would leave a reminder that fires with no text; the person cancels it with Undo instead.
- Showing an admin the content. The tables are owner-only (0036); an admin needs only the budget.
- A separate harness list filter in each view. One rule in `admittedHarnesses` covers every list and the single read.

**Consequences.** The nightly retention redacts at most 20 batches of 500 requests a night, so a backlog drains over several nights. A hold the person removed in Google themselves cannot be undone from the screen (the port answers `not_own_hold`); it stays listed until it ends.

**Changes / changed by.** Changes 0036 (item 4: assistant text is redacted after 365 days or on the person's request; a personal harness is hidden from area readers) and 0039 (a hold can be released by its person, with no releasing effect).

## 0042 Mail instructs an assistant only from its person's own address, proven by Google's top authentication header, and is answered by email to that address alone

*2026-11-27. Changes 0036 and 0039.*

**Decision.**

1. **Mail in is swept, not pushed.** A guarded minute-cron step reads every active assistant mailbox through the Gmail API as that mailbox (the `gmail.modify` scope 0039 already allows it): at most 25 mailboxes a minute, the least recently swept first, ten messages each, within a 20-second budget. It reads Gmail's history since the mailbox's stored history id, or the unprocessed inbox of the last two days when the history id has expired or was never read, and labels each message it has handled `uw/processed`. The cursor advances only when the whole page was handled, so a pass cut short repeats safely; a request is recorded once per Gmail message id.
2. **The sender verdict is pure and closed.** `emailSenderVerdict` returns `automated_sender` for mail marked automatic (`Auto-Submitted` other than `no`, `Precedence` bulk, junk, list or auto_reply, `List-Id`, `List-Unsubscribe`, `X-Autoreply`, `X-Autorespond`, an empty `Return-Path`) or sent from another assistant mailbox; then `other_sender` unless exactly one From header names exactly one address, the person's bound address; then `unverified_sender` unless the topmost `Authentication-Results` header was written by `mx.google.com` and shows `dmarc=pass` with `header.from` the person's domain, or `spf=pass` with `smtp.mailfrom` the person's exact address together with `dkim=pass` for the person's domain. A lower header is never read: any sender can write one, and Google adds its own on top.
3. **Instructions behind a flag.** `kernel.assistants.admitMail` (system only) records the request, or records `assistant_mail_declined {why}` with no content and starts nothing. A passing mail is honoured only when `ASSISTANT_EMAIL_INSTRUCTIONS` is `on`; it is on in staging and off in production until a staging probe shows Gmail marks mail inside the domain as passing (PRD open question 30).
4. **The person's words and the rest.** `splitForward` keeps the person's own words as the note and fences a forwarded original, an Outlook original, a quoted reply and quoted lines as `email_forwarded`; text attachments (plain, markdown, CSV, VTT, calendar) are fenced as `email_attachment`; other attachments are not read. The note is held to 20,000 characters and the fenced parts to the request's limits.
5. **One reply, to the person, on their thread.** The `DirectMessages` port's email adapter sends only to the person's email binding (bound to their own address when the assistant's Workspace user is made), only while the mailbox is active and before `sendBy`, at most once per effect (`assistant_mail_sends`; an unknown outcome keeps the claim). The reply is plain text from the assistant mailbox, `Re:` the original subject, `In-Reply-To` and `References` the original, on the original's Gmail thread, with `Auto-Submitted: auto-replied` and no other recipient; the recipient comes from the binding, never from the model or the mail.
6. **`postal-mime`** parses the raw message (MIT-0, Workers-compatible, typed, no telemetry); it replaces a hand-written MIME parser.

**Why.** The owner wants email in and out working for a real person, with instructions honoured only when authentication passes for the person's own address. The top header is the only one the receiving server vouches for. Polling needs no public push endpoint and no Pub/Sub topic, and Gmail's history gives a cheap cursor.

**Rejected.**
- Gmail push through Pub/Sub into `uw-ingest`: a second verifier, a topic and a subscription to run, for a latency the minute cron already meets.
- Trusting any `Authentication-Results` header that says pass: a sender can add one below Google's.
- SPF alone: Google's shared sending servers would pass for any Google customer naming the person's address as envelope sender.
- Replying to a forwarded sender or anyone in Cc: that is a message to someone else, a proposal under 0036.
- Sending as the person: the assistant sends only as its own mailbox.

**Consequences.** Gmail's exact shapes (history 404 on an expired id, the label search spelling, the `Authentication-Results` Gmail writes on mail inside the domain) come from Google's published API, not a live call; the staging probes confirm them before the flag is turned on in production. A person whose own address changes keeps the old binding until their assistant is turned off and on. A declined mail retried after a failed label is recorded declined again.

**Changes / changed by.** Changes 0036 (item 9: the email rule is the verdict above, SPF with DKIM accepted beside DMARC, and a declined mail is recorded without content) and 0039 (the assistant mailbox subject reads, labels and sends its own mail). 0044 runs its staging probes as `pnpm probe:assistants` and the walk in `infra/README.md`.

## 0043 An assistant proposes; only its person decides, on the digest they saw, and the decision runs once as that person

*2026-11-27. Changes 0036 and 0039.*

**Decision.**

1. **Three proposal kinds, drafted at once.** `propose_email` (from the assistant's own mailbox to up to ten people and ten in copy), `propose_invite` (an event on the person's own calendar with attendees) and `propose_page_append` (text added at the end of a page the person can write) are assistant verbs served only in an assistant turn. Each writes a pending row in the owner-only `assistant_proposals` table and records `assistant_proposal_drafted` with ids and the kind only. Five a request, twenty a day; an invitation at most twelve hours long, not in the past, starting within about eighteen months; a page addition only to a page the person can write now. A proposal expires seven days after it was drafted.
2. **The digest is the database's.** A trigger sets `digest` to the SHA-256 of the payload as Postgres stores it on every write, so it cannot be forged or left stale, and another trigger keeps the payload as drafted (redaction aside) and a decided row as decided. The person's page carries that digest; the decision names it; the kernel compares it under the harness lock and the store's update binds it again in its `WHERE`.
3. **Only the person decides.** `decide_assistant_proposal` exists only on the person endpoint. `decideProposal` accepts only the interactive person whose personal harness holds the proposal, after locking and re-reading their grants; `decided_by` must match `human:%` in a check constraint; an architecture test fails when any other function writes the decision, any file outside `commands/person/` asks the kernel for it, or anything an assistant turn reaches imports the decider. A chat or email "yes" is a new request.
4. **An accepted proposal runs once, as the person.** One `assistant_effects` row per proposal (`proposal_id`, unique; a trigger refuses it unless the proposal is accepted, on the same harness and of the matching kind), run through a port after the decision commits and settled done or failed; it is never retried. The email goes through `Workspace.sendMail` from the assistant's mailbox with the person as Reply-To, at most once per effect; the invitation through `Workspace.sendInvite` on the person's calendar with `sendUpdates=all` and an event id derived from the proposal; the page addition through a new `PageAppends` port whose platform adapter saves the page with the person's own principal through the normal page update path, the effect id as the save's request id, appending to the page's current version (an addition does not overwrite, so a moved page is not refused).
5. **The person is told twice.** The drafted event wakes the person (`proposal_waiting`, personal, web push) with the deep link `/assistant#proposal-<id>`, and the turn's reply names each pending proposal with the same link on the app origin. My Assistant shows each pending proposal in full with Accept (the human-action colour) and Decline; a proposal's statuses are `pending`, `accepted`, `declined` and `expired`, never a gate's "reject".
6. **Meeting transcripts are their own untrusted source.** `meeting_transcript` fences a transcript pasted in a direct message (WebVTT, or three or more cue or time-stamped speaker lines) or attached to an email (`.vtt`, `.srt` or a text file of that shape). The PRD's "add a Zoom transcript to the project notes" is a page-addition proposal of the assistant's summary or the transcript.

**Why.** The owner wants the whole feature working, and 0036 made everything outside the closed set wait for its person. A digest the database computes is the only one nobody can make disagree with its payload. Running the page addition through the normal save, as the person, keeps page history, links and checks exactly as for a person's own edit.

**Rejected.**
- Reusing page suggestion sets or item gates: any area editor or admin could decide them, not only the person.
- A kernel-side hash: the kernel has no crypto library and none could be added; a hash in the application could disagree with what is stored.
- A whole-body snapshot for a page addition (refused on any later edit): an addition is meant to survive other edits.
- Sending the email as the person: 0039 gives the platform Gmail only as the assistant mailbox.
- A separate screen per proposal: the proposals live on My Assistant, which the deep link opens at the proposal.

**Consequences.** Gmail's send as the assistant mailbox with a Reply-To, and the calendar insert with attendees and `sendUpdates=all`, are staging probes. A send whose outcome is unknown is recorded failed `outcome_unknown` and never retried. Expiry runs nightly; a proposal past its week is refused and shown expired before the job marks it.

**Changes / changed by.** Changes 0036 (item 6: the proposal kinds, the decision path and the effect check are built as above) and 0039 (the Workspace port also sends a proposed mail as the assistant mailbox and an invitation as the person).

## 0044 Assistants go live through declared settings, staging probes run from a terminal, and one scenario walks a person's whole day

*2026-11-27. Changes 0037, 0039 and 0042 (only how their staging probes are run).*

**Decision.**

1. **Every setting is declared, checked and documented in one place.** The two assistant secrets (`GOOGLE_WORKSPACE_KEY`, `ZULIP_ADMIN_API_KEY`) are in `infra/secrets-store.json`, `platformSecretNames`, the Worker's `Bindings` and both environments' Secrets Store blocks of `wrangler.go-live.toml`; the variables (`GOOGLE_WORKSPACE_DOMAIN`, `GOOGLE_WORKSPACE_ADMIN_SUBJECT`, `GOOGLE_ASSISTANT_OU`, `ZULIP_ADMIN_EMAIL`, `ASSISTANT_WEBHOOK_BASE`, `ASSISTANT_EMAIL_INSTRUCTIONS`, `ASSISTANT_SPEND_CAP_MINOR`) are declared under staging and production in both wrangler files. `ASSISTANT_SPEND_CAP_MINOR` is declared empty, which means no ceiling (owner decision 12). `tools/infra/assistants-config.test.ts` fails on a missing or malformed one, and on production email instructions that are not `off`.
2. **The assistants' area is not a setting.** It is `10-19` in `apps/uw-platform/assistants/area.ts`, because the numbering from 10.51 is fixed in the contracts (`ASSISTANT_JD_CATEGORY`, owner decisions 4 and 10). The test keeps the two in step and refuses an `ASSISTANTS_AREA` variable.
3. **Staging probes are a command.** `pnpm probe:assistants` (`apps/uw-platform/bin/probe-assistants.ts`) runs `apps/uw-platform/assistants/probes/`, which calls the same functions the platform calls (the Zulip admin client and direct send, the Google token minter, calendar, directory and Gmail clients, the mail verdict, and the OpenRouter engine through the engine registry), one probe per numbered entry of the staging-probes list, and prints `PASS`, `FAIL`, `SKIP` or `MANUAL` per line, exiting 1 on any failure. Without `--write` it only reads; with it, it creates and removes a probe Workspace user, a probe hold and a probe Zulip bot, and sends the test person one direct message and one email. What only a deployed Worker or a person can show (Workflow instance reuse and step replay, the outgoing webhook, latency, the web push link) is listed `MANUAL` with how to check it, never reported passed. The probes run against the recorded-shape fakes in `probes.test.ts`, so a probe that would pass on a wrong answer fails there first.
4. **One scenario walks a person's whole day.** PA-18 turns an assistant on with a name, provisions its persona and bindings, takes the person's grant, answers a calendar question in their timezone, fires a reminder once, places a private hold, answers forwarded mail by email on its thread, sends an email only after the person accepts it, and once turned off takes no turn and frees its number 30 days later.

**Why.** The owner requires the whole feature to work for a real person, and every external shape so far was assumed from documentation. A command that calls the real code paths turns each assumption into a line that passes or fails on staging, before anyone relies on it.

**Rejected.**
- A probe route on the deployed Worker, using its own secrets: it would add an admin route that creates users and bots, reachable over HTTP, for a one-time check; and the admin who runs the setup holds the key file at that moment anyway.
- An `ASSISTANTS_AREA` variable: it could only disagree with the numbering the contracts fix.
- Leaving `ASSISTANT_SPEND_CAP_MINOR` undeclared: an admin reading the wrangler file would not know the ceiling exists.

**Consequences.** Running the probes needs the service account key and the Zulip admin key on the admin's machine for the length of the run; the runbook says to delete the env file after. The probes cannot prove Workflow semantics, the webhook delivery or the DMARC result for forged mail from outside; those stay manual. A probe bot is left deactivated in the realm.

**Changes / changed by.** Changes 0037, 0039 and 0042 only in how their staging probes are run: by `pnpm probe:assistants` and the walk in `infra/README.md`, "Going live with personal assistants".

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
