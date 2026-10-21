# Harness v1 — Architecture Review

**Reviewed:** Ian's *Harness v1* (draft, 2026-09-28) — https://claude.ai/artifact/EpMRSpB9mKa1Pr2kRENrfT
**Against:** *An App For Everything — Platform Architecture Plan* (§1 topology, §4 auth/ACL, §6 agents and work queues, §8 build doctrine, §12 comms, §14 phasing) and the Executive Brief
**Reviewer:** Claude, for the sponsor · 2026-09-28

## Verdict

Harness v1 is a faithful, more detailed realization of plan §6 and §8. It connects to the platform at the right seams: it lives inside `uw-app`, takes webhooks through `uw-ingest`, stores in Neon via Hyperdrive with Drizzle as the schema source, runs personas as Cloudflare Workflows behind the AI Gateway spend breaker, and lets agents reach the platform only through the MCP surface — with no gate verbs in existence. Several of Ian's decisions are strictly better than what the plan says today and should be adopted back into it.

Recommendation: **adopt, with three must-fix items before any build, six should-fix items, and one scope cut.** The must-fixes are all about authority — who may act, under whose grant, and where the human gate is enforced. Everything else is alignment.

## Where it connects correctly

| Harness v1 | Plan | Status |
|---|---|---|
| Agents reach the platform only via MCP; `approve / merge / deploy / advance past human gate` do not exist as verbs | §6 "verbs that don't exist" | Matches exactly |
| `harness_stages(agent_pickup, exit_gate, wip_limit, instructions_page_id, feeds[])` | §6 `queue_stages` | Same model plus loop edges; Ian notes the rename |
| Ship gate = pure function over GitHub facts (PR open, head = expected commit, CI green, reviewer identity approved); item record is not an input; closed refusal set | §8 "mechanical gates" (prose) | **Better than the plan** — adopt into §8 |
| `gate_decisions` table, human identities only, 7-year retention; `gate_refused_to_agent` logged | §6 `queue_items.history jsonb` | **Better than the plan** — adopt |
| Two first-class hosts (Cloudflare Workflow; staff Claude Code over remote MCP), Cloudflare OS as a third later | §6 durable runs + Cloudflare OS evaluation at Phase 4.5 | Matches |
| Reviewer persona: own identity, different vendor (Codex engine) | §8 reviewer harness "different models, different lenses" | Matches |
| Persona = page type with typed frontmatter; `requires_tools` missing → card opens on the software harness | §2 page-type registry (`skill`, `learning`) | Matches the pattern — add `persona` to the registry |
| One trace ID end-to-end; 30d logs / 13mo metrics / 7y audit | §1 observability, gotchas retention | Matches |
| One DO per active harness with per-session cursors, polling fallback | §1 DO usage (per-page Yjs hubs) | Same pattern, no new primitive |
| External runner: identity `agent:<person>/<device>`, grants ≤ owner's, tokens self-reported and never counted against the API budget | §4 principal model, §6 agent identity | Compatible |

## Must fix before build

### 1. Bind the harness to the platform's ACL — it is currently unbound

Ian's document does not mention JD areas, roles, or grants once. Every authority statement is local ("any Access-login holder can mint an agent", "default open for the software harness, role-gated for BML", "harness data classified internal"). The plan has exactly one authorization model — `admin | editor | viewer` at `org` or `jd_area` scope, with agents' grants ≤ their owner's — and the harness must derive from it, not run beside it.

Concretely:
- `harnesses` gets a `jd_area` (the software harness is area 80–89; a BML harness for product content is the owning program's area).
- **Claiming** an item requires `editor` on the harness's area — for a person directly, for an agent via its owner.
- **Approving at Ship** requires `admin` on the harness's area. Items whose diff touches ledger, ACL, or infrastructure code (risk tier, item 7 below) additionally require `admin(20-29)` for finance code — the same rule the plan applies to journal posting.
- D13's "default open for the software harness" becomes "open to anyone holding `editor` on 80–89". This also answers Ian's open question 3 ("who approves at Ship beyond the sponsor") structurally: the approver set is whoever holds `admin` on the area, which is a grants-table row, not a name in a config file.
- "Classified internal" is not a platform concept. Harness items inherit their area's visibility like every other page. If BML `measurements` ever pull donor or list statistics from areas 40–49, they are subject to the plan's finance/CRM read exclusions and the FRED sensitivity filter; state that explicitly or keep BML measurements to public web analytics in v1.

### 2. Make "Ship exits only on human approval" a platform invariant, not template data

Ian's stage geometry has the human gate in the right place, and his best line — "the gate is enforced by the absence of a route, not by a prompt" — is exactly the plan's doctrine. But he also says "a stage is a row, not code." Those two statements conflict: if `exit_gate` is a column, a template author (or an agent with `write_page`) can set Ship's exit to `checks`, and nothing in the engine stops it.

Fix it the way the plan fixes the ledger: **in Postgres.** A check constraint or trigger on `harness_stages` that refuses `exit_gate <> 'human_approval'` for any stage whose connector has an external effect (merge, deploy, publish, send, post). Templates stay data; the invariant does not. Add a property test: for every template, the path from Package to any external effect crosses at least one human gate.

### 3. Unattended loops must not carry a person's authority indefinitely

Two phrases in the loop-edge design: "unattended beats carry their creator's authority" and "beats carry the creator's authority and one capability word, owner only." Meaning: the regular-tweak loop (Iterate → Scope, unattended) runs forever under the authority of whoever created the package.

Three problems. The authority should belong to whoever **approved** the package at Ship, not whoever created it. It must be **time-boxed and revocable** — when that person leaves or their grant is revoked, the loop must stop, and today nothing says it does. And the plan's principal model requires a principal to travel with every request; an unattended beat has no live human principal, so it needs an explicit delegation record.

Add a `delegations` table: `(person_id, persona_id, harness_id, capability, granted_at, expires_at, revoked_at)`. Beats execute as `agent:<persona>` acting `on_behalf_of` a delegation, fail closed when it is expired or revoked, and the delegation shows on the person's page and the persona's dashboard. This is the same pattern as the plan's time-boxed contractor grants.

## Should fix

### 4. One verb registry, the union of both lists

Ian's eight verbs omit `search_pages` and `query_entities`. Scout cannot verify a premise without search; Iterate cannot "read measurements" without a query verb. The plan's list omits `claim_item`, `submit_to_gate`, `record_run_step`, and `get_health`. Ian's D4 contract package is the right home: one published registry, one live version, golden fixtures, conformance test. Update plan §6 to reference it rather than list verbs inline.

### 5. Reconcile the cost line — it conflicts with the brief by roughly 2×

Ian estimates $1,600–2,900/month for thirty heavy hosted runs a day; the brief budgets under $15K/year for all AI tooling (~$1,250/month). The council independently flagged the brief's cost table this week. Resolution: (a) v1 defaults Builder to the **external host** (staff seats) and reserves hosted runs for Scout, Iterate, and intake on a cheaper model; (b) the AI Gateway hard cap is set to the brief's number, so the breaker trips before the budget does; (c) the brief's table gains a separate "AI runs" line with the hosting assumption stated. Ian's "$8/user/month nonprofit Team seats with Claude Code included" is unverified — confirm current pricing before it enters a budget.

### 6. Add the engine hosts to the plan's topology

The five-engine table introduces Cloudflare Sandbox and Containers. The plan's topology is three Workers plus DOs, chosen to minimize operational surface. The additions are justified (a Builder needs a filesystem), but they belong in §1 with two rules: containers host only Builder runs and hold no state; the laptop host is the documented fallback if containers are ever cut.

### 7. Put the risk tier in the Ship rule

Plan §8: ledger, ACL, and infrastructure changes always take the full reviewer harness plus a human. Ian's ship rule requires one reviewer identity. Add `risk_tier` to `harness_items`, declared in the PR per the mechanical-gates rule (what it closes, risks, touches — the plan's `change management` section already requires this for infra). Tier-high requires two reviewer identities from different vendors (his Codex engine makes this cheap) and the area-admin approver set from item 1.

### 8. Make the Close stage produce memory mechanically

Ian has "issue closed + learning" and Iterate "writes learning · revisions" — right instinct, but as narrative. Make it a Close-stage validator: the item must attach either a `suggested` learning/skill page or an explicit "nothing learned" marker. Iterate's proposed revisions should carry evidence labels (observed / confirmed / inferred / assumed) from day one; the interview persona can wait for v1.1, the labels cannot.

### 9. Tighten the external-runner failure mode

"Dead laptop = released lease" is fine for the lease. Also mark the branch abandoned (or auto-push a WIP commit on lease expiry where the runner can) so the next claimant does not build on a stale head. The ship rule's head-check protects the merge; this protects the wasted hours.

## Scope cut: the phone app is not a v1 item

D2 deliberately diverges from the plan (which has a Tauri desktop app and no mobile). It adds an entire platform — iOS and Android builds, app-store presence, APNs/FCM, `push_devices` and `push_cooldowns` tables, a Kotlin Multiplatform or Expo stack — to a team the council just told to cut scope. The need behind it ("waiting on you" reaches a person wherever they are) is real. Serve it with web push from the existing web app and the Zulip bot that plan §12 already routes notifications through; Ian marks Zulip "later" — flip the order. Keep his contract package mobile-ready so an app can follow once the harness has run for a quarter.

## Answers to Ian's open questions where the plan already decides

| # | Question | Answer from the plan |
|---|---|---|
| 1 | One engine for both harnesses? | One engine, two templates — his D1. |
| 3 | Who approves at Ship beyond the sponsor? | Whoever holds `admin` on the harness's JD area (item 1). A role, not a name. |
| 4 | Phone app in v1? | No. Web push + Zulip bot. |
| 5 | Iterate unattended or person-initiated? | Unattended is fine **only** under a delegation with an expiry (item 3). |
| 6 | Who may run externally; how are tokens counted? | Anyone with `editor` on the area; tokens tracked separately, never against the API budget — his D11. |
| 7 | Scout as its own persona or first step of Builder? | First step inside Builder for v1 (fewer identities to govern); promote it when premise-refusal rates show it earns its own stage. |
| 8 | Persona creation: form in v1, interview in v1.1? | Agree with his default. Ship evidence labels in v1 regardless. |
| 9 | Budget? | Item 5. |

## Two things worth saying to Ian directly

The Ship rule as a pure function over GitHub facts with the item record excluded and a closed refusal set is the single best design decision in either document, and the plan should cite it. And the `requires_tools` mechanism — a missing verb opens a visible card instead of failing inside a prompt — is precisely the kind of "make the gap visible on the board" rule the platform needs everywhere, not just here.

## Context from this week's council review

The council's go/no-go verdict landed a staged GO with the ledger gated and the scope cut to a canonical taxonomy plus a read-only reporting warehouse. The harness is the mechanism that makes "one person plus agents" credible at all, and its independent reviewer identity is the closest available answer to the council's segregation-of-duties objection. But note that Ian's open question 3 is the council's bus-factor objection in disguise: every human gate still routes to one person until item 1 makes approval a role. Recommendation: the harness's first real items should be the council-approved scope — the taxonomy registry and the warehouse — which dogfoods the harness on work that carries zero risk to the books.

## Plan edits this review implies

- §1 topology: add Sandbox/Containers as Builder-only engine hosts.
- §2 page types: add `persona`.
- §4 ACL: state that harness claim/approve derive from area grants; add `delegations`.
- §6: rename `work_queues/queue_stages/queue_items` to Ian's `harnesses/harness_stages/harness_items` (his names are the more specific ones and his schema is more complete), add `harness_events`, `harness_runs`, `gate_decisions`, `measurements`; reference the verb registry instead of listing verbs; add the Ship-gate DB invariant.
- §8: replace the mechanical-gates prose with the pure-function ship rule; add `risk_tier` handling.
- §12: "waiting on you" notifications via Zulip bot and web push, explicitly in place of a phone app.
- Brief cost table: separate AI-runs line with the hosting assumption stated.
