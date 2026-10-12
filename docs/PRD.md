# unfoldingWord Platform, Harness v1: Product Requirements Document

| | |
|---|---|
| Status | Draft for review |
| Version | 0.1 |
| Date | 2026-10-01 |
| Owner | Ian Lindsley |
| Sponsor | Jesse Griffin |
| Repository | https://github.com/unfoldingWord/uw-platform |
| Design | The Claude Design prototype under [`ui-design/`](../ui-design/) and the brand tokens in [`prd/An App For Everything - Key Visuals.html`](../prd/An%20App%20For%20Everything%20-%20Key%20Visuals.html), until a `design-system/` folder lands |
| Companions | [`prd/Harness v1 - Architecture.md`](../prd/Harness%20v1%20-%20Architecture.md) for the ratified design and its figures, [`prd/An App For Everything - Platform Architecture Plan.md`](../prd/An%20App%20For%20Everything%20-%20Platform%20Architecture%20Plan.md) for the platform it sits in, [`CONTEXT.md`](../CONTEXT.md) for the words, [`architecture.md`](architecture.md) for the shape, [`adr/`](adr/) for why |
| Sources | The architecture spec v1.1, Jesse's review of it, and GitHub issues #4 to #82 (67 issues: 7 closed, 60 open). Appendix B maps every issue to the requirements that replace it |

This document is the single list of what v1 is. Where it and an issue disagree, this document wins. Where it and the architecture spec disagree on design, the spec wins and this document is corrected. "The spec" below means the architecture spec; "the plan" means the Platform Architecture Plan.

---

## 1. Vision

**Tagline**

> Agents do the work. A person decides what reaches the world.

**Vision statement**

> Run every piece of unfoldingWord's work through one loop, Build, Measure, Learn, with AI agents as governed coworkers and a person at every gate that has an effect on the world.

**Expanded vision**

unfoldingWord is building one operating platform on one database with one login. The harness is its first module: the mechanism that moves an item of work through stages, lets agents claim and work it, and parks it for a person wherever leaving a stage would merge, deploy, publish or send something. It exists so that one developer plus agents is a credible way to build the rest of the platform, and so that a staff member can lend their own Claude Code to the queue without the organization losing control of what ships.

**The feature test**

Every proposed feature must pass both questions:

1. Does it move work through the loop, or let a person see and decide on work in the loop?
2. Can it be done without giving any agent identity a way to approve, merge, deploy, publish or advance past a human gate?

If the first is no, it does not belong in v1. If the second is no, it does not belong at all.

---

## 2. Who it is for

**Primary: the people who approve.** Holders of `admin` on a harness's Johnny.Decimal area. Today that is Jesse and Ian. They need to see what is waiting on them, see the facts behind a ship decision, and decide from a phone.

**Primary: the people who lend agent time.** Staff, volunteers and contractors holding `editor` on a harness's area, who point their own Claude Code or Codex at the queue and work an item on their own subscription.

**Secondary: agents.** Three personas in v1, Builder, Reviewer and Iterate, each an agent identity with a toolset chosen from one verb registry. They are users of the MCP surface and of nothing else.

**Secondary: everyone else on staff.** Holders of `viewer` or org-wide read, who can watch a harness, its board and its items.

**Not designed for:** donors, partners, or anyone outside the organization. Nothing in v1 is public.

---

## 3. Goals

1. **One loop, two templates.** A single stage machine runs both the software-delivery template and the BML product-flywheel template: eight stages, same geometry, different names, workers and connectors.
2. **The gate cannot be talked around.** An item leaves a stage with an external effect only on a recorded human decision. This is enforced by a Postgres constraint, by the absence of any agent verb or route, and by a test that walks every path through every template.
3. **Agents as governed coworkers.** An agent reaches the platform only through the MCP surface, under an identity whose grants never exceed its owner's, and every write records that identity.
4. **Two hosts, one surface.** A platform-hosted run and a run on a staff member's own machine see identical verbs, gates and events. Billing follows the host.
5. **Unattended work is delegated.** Anything that runs with no person at the keyboard runs on an expiring, revocable delegation, checked at every beat, on either host.
6. **The ship decision rests on facts.** The ship rule is a pure function over facts read from GitHub, the item's risk tier and domains, and the approver's principal. The item's own narrative is never an input.
7. **Everything is an event.** An append-only log is the source of truth; item state, the play-by-play, the board, the dashboard and the audit trail are all reads over it.
8. **A person is reachable.** A gate waiting on someone reaches them by web push and a Zulip thread, opens straight to the gate at phone width, and never carries content.
9. **The loop produces memory.** An item cannot close without a learning, a skill, or a signed statement that nothing was learned.
10. **Spend stays inside the brief.** One cap across all model vendors, held by a breaker, with heavy Builder work on staff subscriptions by default.

---

## 4. Non-goals for v1

- **Not the rest of the platform.** No ledger, CRM, grants, field data, publishing, page editor, charts, desktop app or offline sync. The plan describes them; v1 builds only what the harness needs from them (pages, grants, people).
- **Not a native phone app.** Web push from the installable web app and the Zulip bot serve "waiting on you" (spec D2).
- **Not a public website.** `uw-www` is not built. The BML template's deploy and publish connectors are declared and return "not wired" (spec D9, open).
- **Not a fourth persona.** Scout is the first step inside Builder's run. Intake and interview-driven persona creation are v1.1.
- **Not a quorum.** One approver holds every grant an item needs. Multi-approver decisions are not in v1.
- **Not the role-gated finance verbs.** `list_gifts` and `create_draft_journal_entry` are in the verb registry and are not served.
- **Not BML measurements from donor data.** Validate reads public-side measurements only; nothing from areas 40 to 49.
- **Not the managed-agent engine.** `claude-managed-agent` is reserved in the registry and refuses cleanly.
- **Not a GitHub replacement.** GitHub stays the source of truth for issue content. The platform never edits an issue title or body.

---

## 5. Product principles

- **The gate is the absence of a route.** Safety comes from verbs that do not exist and constraints the database refuses, never from instructions in a prompt.
- **Config is data, capability is code.** A persona, a template and a stage are rows and pages. A verb, a run shape, a validator, a connector and an engine are reviewed code in a registry. Config selects from registries and can never add to one.
- **Grants, not names.** Every "who" resolves through `role_grants` and one `can(actor, verb, resource)`. The harness has no authorization model of its own.
- **Facts over reports.** A reviewer's verdict is read back from GitHub. A run saying "approved" is not a fact.
- **Every control returns an outcome.** `accepted` or `error` with a closed-set reason. A control that is not wired says so. A refusal is shown in place, on the control that refused.
- **A wake carries no content.** Notifications and the live hub say "this harness may have news" and why. The client reads from its own cursor. A dropped wake loses time and nothing else.
- **One kernel, one log.** Every harness behaviour is a call on a pure kernel, and everything that happened is a row in `harness_events`. The same kernel runs in a Worker and in the sim, so the harness is proven without a deployed Worker.
- **Kindle orange marks a human action and nothing else.**

---

## 6. Product overview

### 6.1 The loop

```
Package -> Scope -> Plan -> Build -> Check -> Ship -> Validate -> Close
   ^         ^                                 |         |          |
   |         +--------- regular tweak ---------+---------+----------+
   +------------------- occasional tweak (needs a person) -+
```

| # | Stage | Software template | BML template | Worked by | Exit | Connector |
|---|---|---|---|---|---|---|
| 1 | Package | backlog issue | goal, strategy, data | a person | `none` | `none` |
| 2 | Scope | premise verified | niche identification | Builder (scout pass) | `checks` | `none` |
| 3 | Plan | plan approved | product tuning | Builder | `checks` | `none` |
| 4 | Build | commits to PR | asset package | Builder | `checks` | `none` |
| 5 | Check | CI and review verdict | brand and policy checks | CI and Reviewer | `checks` | `none` |
| 6 | Ship | merge, tag, deploy | deploy to channels | a person | `human_approval` | `merge` (software), `publish` (BML) |
| 7 | Validate | deploy watched | collect feedback | the platform, Iterate | `checks` | `none` |
| 8 | Close | issue closed and learning | analyze, compare | Iterate, a person | `checks` with `learning_attached` | `none` |

Loop edges are `feeds` on the stage rows: Close to Scope (the regular tweak) and Validate to Package (the occasional tweak, which always needs a person). The four BML brackets, Product Package (1), Build Package (2 to 5), Deploy Package (6) and Iterate (7 to 8), are template data used by the Flow view.

### 6.2 The surfaces

```
People ──> Web app (uw-app) ──┬── Home "waiting on me"
                              ├── Flow view      one harness as the BML diagram, live
                              ├── Board          stages as columns, items as cards
                              ├── Gates          the ship decision, at phone width
                              ├── Item           play-by-play from the event log
                              ├── Persona page   form, instructions, dashboard
                              └── /health        the agent plane
        ──> Web push, Zulip thread   a wake, then the Gates view

Agents ──> MCP surface (uw-app) ──> thirteen verbs, no gate verb
           from a platform Workflow, or from a person's own Claude Code

GitHub ──> uw-ingest (webhooks) ──> queue ──> gh_* read model ──> the ship rule
```

---

## 7. Requirements

Requirement identifiers are stable. **Must** is a v1 requirement. **Later** is declared, reserved or stubbed in v1 and built afterwards. The Source column names the issue the requirement came from and the spec decision or section behind it. Requirements marked **Built** are already on `main`; they are listed so the document is complete and so nothing rebuilds them.

### 7.1 Foundation

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FD-1 | pnpm monorepo, TypeScript strict in every package from one base tsconfig, with `apps/uw-app`, `apps/uw-ingest`, `packages/{core,db,contracts,harness}`, `tools/`, `infra/`. One `formatDate`/`parseDate` pair and a shared Zod ISO date schema in `packages/core/dates.ts`; a lint rule and a grep refuse any other date formatting. The module registry in `packages/core/modules.ts` declares `core` and `agents`. | Built | #4 |
| FD-2 | Toolchain: ESLint flat config with six fitness functions (function 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters), Prettier, Vitest with the Workers pool, dependency-cruiser, knip, Husky, audits. `pnpm verify` is the whole chain and the one command CI calls. A no-comments rule and a vendor-SDK text gate run in it. | Built | #67 |
| FD-3 | `uw-app` is a Hono Worker with one server-rendered route and a health route that reports the deployed commit. Wrangler config in `infra/` declares staging and production; no secret in any wrangler file. | Built | #5 |
| FD-4 | CI with six separately named jobs (`security-audit`, `lint`, `typecheck`, `architecture`, `test`, `build`); a Worker per PR (`uw-app-pr-<number>`), deleted when the PR closes; staging deploys only after CI is green on that commit; production deploys only on a tag or manual dispatch by a listed deployer with all six jobs green; a red `main` opens one alarm issue. The job names are a contract the ship rule reads. | Built | #68, #12 |
| FD-5 | `packages/db` holds `schema.ts` as the only schema, a drizzle-kit config, and `migrations/` with generated SQL plus hand-written SQL for constraints and triggers, applied in order. A client factory takes a Hyperdrive connection string; a separate direct connection is used only by the migration runner. Every table declares `classification` (`public`, `internal`, `restricted`, `sensitive`) and `offline_eligibility` (`sync`, `cache_readonly`, `never`) as typed data; `pnpm verify` fails on a table without both, and on a schema change without a matching migration. Migrations apply from empty and re-applying is a no-op. | Built | #7 |
| FD-6 | CI's `test` job starts a Postgres service container, sets `TEST_DATABASE_URL` to it, applies every migration from empty, re-applies them, and runs the schema, constraint and concurrency tests against it. It needs no secret and no account. | Must | #79 |
| FD-12 | **Go-live wiring, written during the build and switched on after it.** A CI job that creates a Neon branch per PR and drops it; a migrate-staging job on merge to `main` after CI is green; a migrate-production job on a tagged release; the Hyperdrive binding for staging and production. Each job skips cleanly, and stays green, while its secret is absent. A binding is added to a wrangler file only when the resource it names exists, so a deploy never fails on a missing one; until then `uw-app` starts without a database and `/health` reports the database indicator as not configured. A test asserts each job skips when its secret is absent. | Must | #79 |
| FD-7 | Cloudflare Access with Google as the identity provider sits in front of `uw-app`, declared in `infra/`. Hono middleware verifies the Access JWT on every request (signature, audience, expiry), maps the email to a `people` row, auto-provisions `@unfoldingword.org` addresses and marks anyone else pending with an explicit "pending approval" response. A typed `Principal` (person or agent id, resolved grants, an `interactive` flag) is exported from `packages/core`, available to every handler, and serialisable into a queue message. A service-token JWT yields a non-interactive principal. A tampered, expired or wrong-audience JWT gets 401. | Must | #6 |
| FD-8 | `role_grants(person_id, role, scope_kind, scope_area, granted_by, granted_at, expires_at, revoked_at)` with roles `admin`, `editor`, `viewer` at scope `org` or `jd_area`, declared `restricted` and `never`. `can(actor, verb, resource)` in `packages/core/acl.ts` is pure over the grants already resolved on the principal and takes no database handle. Org-scope admin is allowed everything an area admin is; `editor` on one area reads every area and writes only its own; `viewer` reads only its own. Grants resolve from the table on every request with no cross-request cache. Grant and revoke are commands that require `admin` in the target scope and write an audit record with the actor, the time and the before and after row. A bootstrap migration grants org admin to Ian and Jesse. | Must | #8 |
| FD-9 | `pages(id, type, jd_area, slug, title, parent_id, frontmatter jsonb, body_md, version, status)` and `page_versions` (a full snapshot per save with `edit_source` of `human:<id>` or `agent:<id>`), declared `internal` and `sync`. A page-type registry in code gives each type a Zod frontmatter schema, a classification and an offline eligibility. Registered types: `skill`, `learning`, `persona`, `product`, `system_goal`, `product_strategy`, `data_sources`, `issue` (GH-3: an imported issue's page). Create, read and update handlers validate frontmatter, refuse unknown types, write one version per save, and check `can()` with the page's `jd_area`. No editor UI. Stage rows are not pages. | Must | #9 |
| FD-10 | `uw-ingest` is a second Hono Worker, not behind Access, with its own wrangler config and deploy job. It verifies each source's signature over the raw body, rejects unsigned, badly signed and replayed deliveries with a logged refusal and no queue message, mints a trace id, and enqueues a Zod-validated envelope to one Cloudflare Queue. `uw-app` consumes it, sends a malformed message to a declared dead-letter queue, and tolerates duplicates. | Must | #10 |
| FD-11 | One trace id follows a request, webhook, queue message and run step from the edge to the database write. A structured JSON logger in `packages/core` writes `trace_id`, `principal`, `route`, `latency_ms`, `outcome` and the deployed commit on every line, in both Workers. Log shipping and 30-day retention are declared in `infra/`. `/health` returns JSON with a named list of indicators and an overall status, and renders a screen: deployed commit, database reachability, queue depth. An unreachable database turns its indicator amber or red and never errors the route. | Must | #11 |

### 7.2 Contracts

| ID | Requirement | Priority | Source |
|---|---|---|---|
| CT-1 | `packages/contracts` publishes Zod schemas and inferred types for the command envelope (every command carries `requestId`), the outcome envelope (`accepted` or `error` with a closed-set reason), the event envelope with a closed event-name enum, the identity string forms, and every closed set in section 8.3. One exported `CONTRACT_VERSION`. Golden fixtures, valid and invalid, per schema, round-tripped in CI. A conformance test in each consumer fails on a stale version. The only runtime dependency is `zod`; no Node-only or Workers-only import. | Built | #13, D4 |
| CT-2 | The verb registry is plain, JSON-serialisable contract data: thirteen entries, each with name, group, the grant that gates it if any, a served-in-v1 flag, and input and output schemas. A test asserts exactly those thirteen names. `FORBIDDEN_VERBS` (`approve`, `merge`, `deploy`, `publish`, `advance`) is exported and a test asserts none is registered. `resolve_policies` is not a registered name. | Must | #14, D14 |
| CT-3 | Adding an event name, a refusal reason, a verb, a capability word or a command is a contract change: the enum, its fixtures and `CONTRACT_VERSION` change together. | Must | #13, #16 |

### 7.3 Kernel and data

| ID | Requirement | Priority | Source |
|---|---|---|---|
| KN-1 | Harness tables in the Drizzle schema with a migration: `harnesses`, `harness_stages`, `harness_items`, `harness_events`, `harness_runs`, `gate_decisions`, `delegations`, `measurements`, and a `personas` projection of persona pages (columns in section 8.1). Every harness has a `jd_area`. | Must | #15 |
| KN-2 | **The Ship invariant.** `harness_stages.connector` is `NOT NULL DEFAULT 'none'`, `exit_gate` is `NOT NULL`, and `CHECK (connector = 'none' OR exit_gate = 'human_approval')` holds on insert and update. A migration test against real Postgres asserts both columns non-null, the constraint present, an insert of `('merge','checks')` refused, an update to `('merge','checks')` refused, and an insert of `('merge', NULL)` refused. | Must | #15, D8 |
| KN-3 | `harness_events` is append-only: the application role has no UPDATE or DELETE grant and a trigger refuses both. Each row carries harness, item, name from the closed vocabulary, actor identity string, evidence payload, trace id, and a position that is strictly increasing per harness and safe to resume a cursor from. Writing an unknown name is refused. | Must | #16, D7 |
| KN-4 | `replay(events)` is a pure reducer that yields item state (stage, holder, lease, gate status, branch state). The `harness_items` row is a projection that must equal the replay; a property test asserts it over random valid sequences, and that replay is deterministic. One read function returns events for an item or a harness in cursor order with paging; it is the only event read path. | Must | #16, D7 |
| KN-5 | Claim is one conditional UPDATE that succeeds for exactly one caller. Before it, the claim checks `can(actor, claim, harness.jd_area)` (`editor` on the area), the stage's `agent_pickup` (an agent may not claim in a `none` stage), and the stage's `wip_limit`, for people and agents alike, with the count and the update in one transaction. An agent claim takes a 15-minute lease; a person's claim has no lease. `record_run_step` renews the lease. Expiry releases the item and writes `lease_expired` exactly once. The claim records the claimant and any delegation id on the item and the event. | Must | #17 |
| KN-6 | Exit gates are enforced server-side on submit: `none` advances; `checks` runs every validator in the stage's `validators[]` and advances only if all pass, otherwise returns the failures and writes them as an event; `human_approval` parks the item and never advances from the submit path. Validators are a registry keyed by name; a stage row cannot define one inline, and an unknown key fails closed with the key in the failure. | Must | #18 |
| KN-7 | `learning_attached`, the Close validator: passes when the item carries a `suggested` learning or skill page, or a `nothing_learned` marker with a one-line reason set by a person (who, when and why are recorded and written as an event). An item with neither is refused. Every claim in a learning an agent drafts, and every revision Iterate proposes, carries one of `observed`, `confirmed`, `inferred`, `assumed`; one without labels fails the same validator. | Must | #18, D20 |
| KN-8 | `feeds[]` on a stage row names target stages in the same harness that an item leaving the stage may enter in place of the next position. A transition to a stage that is neither next nor in `feeds[]` is refused; a dangling target is refused at write time. The occasional tweak to Package requires a recorded human gate decision. An unattended traversal of a loop edge is refused without a delegation id. | Must | #19, D6 |
| KN-9 | `walk(stages)` takes stage rows as data, performs no I/O, enumerates every path from Package along position order and every `feeds` edge, terminates on cycles, and returns each path as an ordered list of stage keys with each stage's `exit_gate` and `connector`. | Must | #19 |
| KN-10 | **The template property test.** For every template, on every walked path, every stage with a connector other than `none` is reached only after a `human_approval` exit. It runs in CI over the fixtures and is exported as a function that template activation calls. A failure names the offending path and the effect stage. A negative fixture with a `feeds` edge that bypasses Ship is kept in the repo and fails. | Must | #22, D8 |
| KN-11 | **The ship rule** is `shipRule(input)` returning `advance` or `refuse(reason)`, pure, with no database, network or clock access, and with input and output types published from the contracts. Inputs: PR open, not draft, head equals the item's expected commit, the six CI jobs green on that head, the reviewer approvals on that head each with the reviewer identity and the resolved model provider recorded on it, `risk_tier`, `risk_domains`, and the approver's principal with resolved grants. The item's narrative is not an input and the input type has no field for it. | Must | #20, D8, D19 |
| KN-12 | What each tier needs at Ship. `low` and `standard`: one reviewer identity approved the head. `high`: two reviewer identities approved the head and their resolved model providers are distinct; the approver holds `admin` on the area plus the grant each touched domain names (`ledger` needs `admin(20-29)`; `acl`, `infra`, `migration` need org-scope `admin`); one approver holds every required grant. Refusal reasons are the closed set in section 8.5. A determinism property test covers random inputs. | Must | #20, #25, D19 |
| KN-13 | **The gate decision command** handles approve, reject, take over and override. It accepts only a human principal; an agent identity's call writes `gate_refused_to_agent` and changes nothing. It requires `admin` on the harness's area. Approve at a stage with a connector evaluates the ship rule; then, in one transaction, it runs `SELECT ... FOR SHARE` on the approver's `role_grants` rows, refuses if they no longer cover every required grant, and otherwise inserts the `gate_decisions` row and writes `gate_approved`. Reject returns the item with findings. Take over reassigns it to a person. Override advances despite open review findings, requires a non-empty reason, and records it. | Must | #21, D8 |
| KN-14 | The grant re-read race is tested in both orders on two real database connections: revoke then decide refuses; decide then revoke records the decision. | Must | #21 |
| KN-15 | Two templates ship as fixtures that the schema accepts and activation can load: software delivery and the BML product flywheel, eight stages each as in section 6.1, with Close carrying `learning_attached` and the `feeds` edge to Scope, and Validate carrying the `feeds` edge to Package. Both pass KN-10. A test asserts every validator key they reference exists. | Must | #23, D1 |
| KN-16 | **Delegations.** A grant command, requiring `admin` on the harness's area, writes a `delegations` row with one capability word from a closed set and a required `expires_at` (default 90 days). A revoke command sets `revoked_at`. `assertDelegationLive` runs at every beat and checks the delegation is unexpired, unrevoked, and that its person still holds `admin` on the area; any failure stops the loop and writes `delegation_lapsed`. The beat's principal is derived from the delegation, bounded by the person's grants at that moment and by the capability word, and has no gate verb. Live delegations are queryable by person, by persona and for the access review. | Must | #24, D18 |
| KN-17 | **Risk tier and domains.** A protected-directory map, kept as reviewed data, maps each protected directory to exactly one domain. `floorFromPaths(paths)` floors the tier at `high` when any domain is present. `applyDeclaration(floor, declaration)` may add domains or raise the tier and never remove or lower; no declaration yields `risk_tier_undeclared`. The domain-to-grant map is data in one place that the ship rule imports. Both functions are pure. The result is written to the item and recorded as an event with the paths and declaration that produced it. | Must | #25, D19 |
| KN-18 | **The stage command** creates, updates and reorders `harness_stages` rows and activates a template onto a harness. It requires `admin` on the area and is the only writer of the table; a check fails on any other write. When Postgres refuses a write, the command writes `stage_edit_refused` with the database's reason and returns the refusal. Activation runs KN-10 and refuses, naming the path, when it fails. An unknown validator key, and a connector with no registered handler, are refused at write time. | Must | #26 |

### 7.4 Agent boundary

| ID | Requirement | Priority | Source |
|---|---|---|---|
| AB-1 | A Streamable HTTP MCP endpoint inside `uw-app`, behind Access. Its tool list is enumerated from the verb registry and nothing else. `approve`, `merge`, `deploy`, `publish` and `advance` are absent under any name; calling one returns an unknown-tool error. | Must | #27, D5 |
| AB-2 | Agent identities `agent:<persona>` and `agent:<person>/<device>` are minted from Access credentials with grants at or below the owner's. An owner losing a grant loses it for the agent on the next request. Anyone holding `editor` on the harness's area may mint `agent:<person>/<device>` under themselves; there is no separate allow-list. Role-gated verbs are offered only to a principal whose owner holds the area grant. | Must | #27, D13 |
| AB-3 | Every MCP handler calls `can(actor, verb, resource)` with the harness's area; a static check fails the build for a handler that skips it. Every write through the surface records the agent identity in the event log and in page version history. The principal minted at the edge is the one the handler receives. | Must | #27 |
| AB-4 | `poll_queue` returns items in stages whose `agent_pickup` is `allowed` or `auto`, on harnesses the persona subscribes to, filtered by `can()`. `claim_item` takes a lease through KN-5 and accepts a `delegation_id`. `submit_to_gate` runs KN-6 and has no argument or path that advances past a human gate. `record_run_step` renews the lease, reports tokens with the cost basis by host, and writes the play-by-play event; a step on an expired lease is refused. Claim and step responses carry the lease expiry and a warning flag. `get_health` returns the agent-plane facts for the caller's harness, scoped by `can()`. Every refusal reason is in the closed set. | Must | #28 |
| AB-5 | `search_pages` and `read_page` return only pages the principal may read. `write_page` runs the same validation as the page API, records the agent identity, and on gated types (`learning`, `skill`, `persona`, `policy`) lands as `suggested`, never as an edit; it cannot reach a `harness_stages` row. `query_entities` executes only whitelisted, parameterized queries and returns no row the principal could not read directly. `resolve_context` for an item returns the stage's instructions page, the package pages and the applicable confirmed learnings, most specific first, each learning with `confidence` and `as_of`. `create_task` creates a `suggested` task attributed to the agent. | Must | #29 |
| AB-6 | A non-interactive principal can claim only with a live delegation for that persona and that harness; otherwise the surface refuses with `delegation_required`. An interactive principal needs none. With a live delegation, every event carries `agent:<person>/<device> as <persona> via delegation:<id>`, or `agent:<persona>` on behalf of the delegation for a hosted beat. The three liveness checks re-run on every `record_run_step` and `submit_to_gate`; a delegation that stops being live writes `delegation_lapsed` and the run stops. | Must | #30, D22 |
| AB-7 | Three checks run on every PR. Static: no route or tool handler reachable by an agent principal touches `gate_decisions`, proven by a fixture handler that makes the check fail. Runtime: for every role and scope combination and for a delegated principal, an agent identity's attempt to write a gate decision is refused and writes `gate_refused_to_agent`. Conformance: the tool list served to a Workflow-host principal equals the list served to an external-runner principal with the same owner grants, equals the registry, and each verb is callable from both. | Must | #31 |
| AB-8 | A persona page declares `requires_tools`, derived from its toolset. Activation with a missing verb fails with "persona X requires verb Y, which does not exist", enqueues one item on the software harness linked to the persona page, and leaves the persona `suggested`; a second attempt opens no second item. A forbidden verb is refused with a distinct message and opens no item. A verb the creator's grants do not reach is refused. The failure is an event on the harness. | Must | #32, D14 |

### 7.5 GitHub facts

| ID | Requirement | Priority | Source |
|---|---|---|---|
| GH-1 | A GitHub App with least-privilege permissions (issues, pull requests, checks, reviews, contents, merge) and subscribed events (issues, pull_request, pull_request_review, check_run, push), both recorded in `infra/`. Its webhook points at `uw-ingest`. The private key, installation id and webhook secret live only in Worker secrets. Installation tokens are minted in the host step once per unit of work (a webhook delivery, a sweep run, a connector run), each scoped to that unit's one repository and to its client kind's permissions (read, comment, or the merge and tag), and never reach a model process or an MCP response. Write-back is limited to link labels, cross-reference comments and the merge. | Must | #33, D1, D12 |
| GH-2 | Read-model tables `gh_repos`, `gh_issues`, `gh_prs`, `gh_milestones`, `gh_check_runs`, `gh_reviews`, keyed on the GitHub id so a redelivery is an idempotent upsert, each with a classification and a freshness timestamp. One upsert path is used by the queue consumer and by a nightly sweep that repairs missed webhooks from a watermark and records what it repaired. For a PR the model answers from its own tables: is it open, what is the head, what are the check conclusions on that head, who approved that head. | Must | #34 |
| GH-3 | An issue carrying the harness label becomes one `harness_items` row in Package of the software harness, wrapping a page that links to the issue, idempotent on the issue id whether a webhook or the sweep finds it first. Removing the label records an event and does not delete the item. Exactly one cross-reference comment lands on the issue. Manual enqueue and import share one code path and one event shape. | Must | #35 |
| GH-4 | Builder work lands on branch `harness/<item>`. The item records the expected head commit at `submit_to_gate`; a later submit replaces it. On `lease_expired` the kernel records `branch_abandoned`; the next claim starts from the expected head unless the claim explicitly adopts the abandoned branch, and that choice is an event. | Must | #36, D12 |
| GH-5 | An assembler builds the ship rule's inputs from `gh_*` at evaluation time and is the rule's only caller outside its tests. Reviewer approval is a GitHub review by a Reviewer identity on the head commit; a review on an older commit, by another identity, or a value planted on the item, does not count. | Must | #36 |
| GH-6 | **The merge connector** runs only from the kernel's stage-exit path after a `gate_decisions` row exists for the item at Ship; a static check asserts that path is its only caller. It re-checks the head and refuses if it no longer equals the expected head. It squash-merges the PR, tags the merge with the item, and writes the outcome as an event. An override's reason travels into the merge commit message. A GitHub refusal is an event on the item, not an exception. | Must | #37 |
| GH-7 | The `deploy`, `publish`, `send` and `post` connectors are registered with handlers that return "not wired" and write an event. | Later | #37, D9 |

### 7.6 Web page and live hub

| ID | Requirement | Priority | Source |
|---|---|---|---|
| WB-1 | **The command API** is one Hono route group exposing every row of the Controls table as a command: kickstart, enqueue, import, reorder, claim, release, submit, approve, reject, take over, override, prompt run, stop run, pause, resume, tweak package, schedule regular tweak. Each body is a contract schema with a `requestId`; the response is `accepted` or `error` and nothing else. Each resolves the harness's area and calls `can()` before touching state; a check fails on a route that skips it. A repeated `requestId` replays the first outcome. A control that is not wired returns `not_wired`. Every accepted command appends its event with the actor, `requestId` and trace id. | Must | #38 |
| WB-2 | Reorder takes the id of the item to place before, never an index; the order shown afterwards is the server's. | Must | #38, #41 |
| WB-3 | **The live hub** is one Durable Object per active harness, woken on every appended event. Its only message is "this harness may have news"; the contract schema for it has no field that can carry an event, item or page body. Each session holds its own cursor and reads events after it from the one read route, filtered by `can()`. Polling the same route is the fallback. Killing the object mid-session loses nothing. Connection count and last wake time are health indicators. | Must | #39, D3 |
| WB-4 | **Flow view.** One harness drawn from its stage rows in position order under the template's four brackets, with no template-specific code. Each stage shows item count, WIP against limit, age of the oldest item, and cost: metered cost and reported subscription tokens shown separately and never summed. The two `feeds` edges are drawn. Ship is marked in Kindle and nothing else is. A paused lane shows as paused. Each stage links to the board filtered to it. It updates on a wake without a reload. | Must | #40 |
| WB-5 | **Board.** One column per stage with WIP against limit, `agent_pickup` and `exit_gate` in the header. Cards show title, issue ref, holder in the spec's full identity form, host, lease expiry for an agent and none for a person, risk tier and domains, and cost basis. Reorder, claim, release and enqueue issue commands and show the outcome; a WIP, grant or lease-held refusal shows its reason. | Must | #41 |
| WB-6 | **Gates view.** Lists items parked at a human gate that the current person can decide. For each, a table of every ship-rule input with its current value from GitHub facts, the tier and domains, and the reviewer findings. The button is enabled only when the ship rule returns `advance` for the current facts and the current principal; otherwise the closed reason is shown beside the disabled button. Approve, reject, take over and override each issue the gate command and show the outcome, including the refusal when a grant was revoked after page load. Each gate has a stable deep link. Kindle marks the four human buttons and nothing else. | Must | #42 |
| WB-7 | The Gates view works at phone width and the app is installable (manifest and service worker), so a push opens straight to the waiting gate and the client catches up from its cursor. | Must | #42, D2 |
| WB-8 | **Item play-by-play.** Every event on the item in order through the one read route, with the actor's full identity. Run steps show model, tokens and cost basis; subscription rows never show a dollar figure. Gate events show decision, reason, evidence and actor. Lease, branch and delegation events render. Evidence labels render. Links go to the PR, its checks and its reviews, with a slot for the Zulip topic. New events appear on a wake. | Must | #43 |
| WB-9 | **Home "waiting on me".** In rank order: gates the person can decide and lapsed delegations, then failed runs on items they hold. Only gates the person can decide appear, including the domain grant for `high` items. Each row deep-links. Any count shown is derived from the same query as the list. The empty state says so. | Must | #44 |
| WB-10 | **`/health` agent plane.** Indicators, each clicking through to its query: spend against budget with metered cost and reported tokens side by side; breaker state and the cap; runs today by host and by engine; live delegations with expiry; gate refusals in the last 7 days by closed reason; agent writes in the window; stale learnings. An indicator whose source is not built says "not wired". The queries are exported so `get_health` returns the same numbers. Aggregates are visible to everyone; drill-through lists respect `can()`. | Must | #45 |
| WB-11 | **Design system.** Tailwind 4 with a CSS-first theme whose values are the token CSS variables in `packages/ui/tokens/*.css` and nothing else. Dark mode follows the system setting with a persisted `data-theme` override. A tokens-agree check fails `pnpm verify` on a mismatch or on a hex literal outside the token files. Shell pieces (sidebar, top bar, page head, card, badge, table, KPI, gate callout, note, evidence label, lane, kanban card, segmented control, chip) exist once. The shell is fluid. Formatting helpers for `YYYY-MM-DD` dates and money from integer minor units exist once. | Must | #46 |
| WB-12 | Every screen renders in light and dark at phone width with visible focus and an accessible name on every control. Copy is sentence case, second person, with no exclamation marks and no emoji. | Must | #46 |

### 7.7 Hosts and engines

| ID | Requirement | Priority | Source |
|---|---|---|---|
| HE-1 | **Run shape `workflow-run`.** One Cloudflare Workflow instance per claim on the platform host, with read, scout, work and submit as named checkpointed steps, each recorded through `record_run_step` with its cost. A failed step retries from that step against the previous checkpoint. A deploy mid-run does not lose the run. At a `human_approval` stage it submits, hibernates, and resumes only on the gate event from a person's decision. Pause and resume hibernate and resume affected runs; stop aborts and writes an event. The run record carries trace id, model, tokens, cost, duration, tools called, writes made, gates encountered and outcome. | Must | #47 |
| HE-2 | **The engine seam.** One interface and a registry keyed by the six engine keys. A persona selects an engine by key; the run shape resolves it and imports no vendor SDK. A new engine is a directory under `apps/uw-app/engines/<key>/` and a registry row; no shared code branches on an engine or vendor name. The text gate refuses a vendor SDK import anywhere else. The engine inside a step reaches the platform only through the MCP surface. | Must | #48, D16 |
| HE-3 | **`claude-messages`.** A tool-use loop inside the Workflow step. The tools offered to the model are exactly the persona's toolset. Calls go through AI Gateway on the organization's key. No subscription credential exists in any hosted engine's configuration. | Must | #48 |
| HE-4 | **`openrouter-messages`**, the always-on tier and the default for the scout step, Iterate, Reviewer and model-calling validators. The same loop, with the model chosen per persona from its `model` field. Every run pins its provider, refuses fallbacks, and records the resolved provider and model on the run step and on any review it posts; if the resolved provider differs from the pinned one, the run fails closed and posts no review. A diff larger than the review's input allowance is refused with `diff_exceeds_review_budget`, which parks the item for a person. | Must | #49, D21 |
| HE-5 | **The spend breaker** reads AI Gateway's cost data and keeps no ledger of its own. One cap across Anthropic, OpenAI and OpenRouter, set by configuration to the brief's figure. At 75 percent new hosted claims are refused with a closed reason and stay queued; at 90 percent running hosted runs hibernate; below 75 percent both resume. Each transition is an event and a health indicator. Subscription tokens from external runs are never counted against the cap. A test simulates a cost spike and shows both thresholds trip. | Must | #50, D17 |
| HE-6 | **Run shape `external-run` and engine `external`.** A person's own Claude Code or Codex connects to the MCP surface with their interactive Access login, is minted `agent:<person>/<device>`, polls, claims on a lease, works in a git worktree on `harness/<item>`, self-reports tokens on every step (labelled `subscription`), and submits. The same runner under a non-interactive service token must present a live delegation (AB-6). No subscription credential is stored on the platform. A dead runner releases its lease on expiry; the platform holds no checkpoint of external work. | Must | #51, D5, D11 |
| HE-7 | **The synced harness skill**, in agentskills.io format, checked into the repo and synced from its `skill` page. It tells a local session the flow: sign in, poll, claim, worktree, `resolve_context`, record steps with tokens, open a PR with the declaration, submit. At the lease warning it commits the worktree as `wip:` and pushes to `harness/<item>` with the person's own credentials. A script in a skill's folder that holds a credential or calls outside the MCP surface is refused by a check. | Must | #52 |
| HE-8 | **`claude-code-sandbox`.** Claude Code headless in a Cloudflare Sandbox inside a `workflow-run` work step, connected to the MCP surface as the run's principal, with the organization's key injected at the egress proxy and never present in the sandbox. The sandbox holds no durable state. Hosted Builder is off per harness by default; only an `admin` on the area turns it on, through a command, and a Builder on this engine cannot claim where it is off. Sandbox compute cost is recorded beside model cost. | Must | #53 |
| HE-9 | **`codex-sandbox`**, the second Reviewer identity that `high` items need. Codex in a Cloudflare Container inside a Check step, connected as its own Reviewer identity on a provider distinct from the first reviewer's. Its verdict is a GitHub review on the head commit, read back from `gh_reviews`. The container holds no state. | Must | #54, D19 |
| HE-10 | **`claude-managed-agent`** is reserved in the engine registry with its own directory and refuses activation with the closed reason `engine_not_available`. | Later | #55 |

### 7.8 Reaching a person

| ID | Requirement | Priority | Source |
|---|---|---|---|
| NT-1 | **Web push.** `push_subscriptions` per person and device and `push_cooldowns` per person. Subscribe and unsubscribe from the installed app; expired subscriptions are pruned. On the events that wake the hub, a notifier computes candidate wakes per person, ranks them (gate waiting on you, then run failed, then stage advanced), applies one cooldown window per person so a weaker wake never spends the window a stronger one needs, suppresses the wake when the person has a live session on that screen, and sends to every subscribed device. | Must | #56, D2 |
| NT-2 | The payload names the harness, the reason and a deep link, and nothing else; a contract test rejects any payload with a content field. A gate wake reaches only people who can decide it. Every send, coalesce and suppress decision is logged with the trace id. | Must | #56 |
| NT-3 | **Zulip.** One topic per item, created on first wake in the channel mapped to the harness's area, stored on the item and linked from the play-by-play. A wake posts the harness, item ref, reason and link, never the body, diff or findings. Replies are recorded on the item as comments, with the author mapped to a `people` row by email, and appear on the play-by-play. Inbound webhooks are verified in `uw-ingest`. The bot accepts no commands: a reply saying "approve" is a comment and no `gate_decisions` row exists. A Zulip outage drops the wake and logs it; nothing else fails. | Must | #57 |
| NT-4 | `delegation_lapsed` wakes the delegation's person at the top rank, or every other `admin` on the area if that person no longer holds the grant. A run that fails finally, after the Workflow's retries, wakes the item's holder at the run-failed rank; a step that retries sends nothing. Both appear on Home and on the play-by-play. | Must | #58 |

### 7.9 Personas

| ID | Requirement | Priority | Source |
|---|---|---|---|
| PE-1 | **Persona as a page type.** Frontmatter: `identity`, `owner`, `harness`, `toolset`, `run_shape`, `engine`, `model`, `provider` (the pinned provider slug, or null for the engine's default), `budget`, `capability`, `requires_tools`, `status`. The schema rejects a value outside the run-shape registry or the six engine keys; a toolset name outside the verb registry is accepted, and activation turns it into AB-8's missing-verb item. "New page, type: persona" creates one; there is no special screen. The markdown body is the persona's instructions in agentskills.io format and is what a run's read step loads. | Must | #59, D15 |
| PE-2 | The toolset form offers only registry verbs the creator holds and never a forbidden verb. `requires_tools` is derived and cannot be edited by hand. A persona drafted by an agent lands `suggested`. | Must | #59 |
| PE-3 | Activation is shown only to a person holding `admin` on the harness's area. It runs the tool check (AB-8) and a dry run, then flips `status` to `active`. An agent identity's attempt through `write_page` is refused and logged. | Must | #59 |
| PE-4 | The persona page's default view is its dashboard: runs today, spend, escalation rate, gate refusals, writes, hosts, the last play-by-plays, and the delegations it runs under. | Must | #59 |
| PE-5 | **Builder** is a persona page in the software fixture, not code. Toolset: the eleven served verbs. Default run shape `external-run`; `workflow-run` on `claude-code-sandbox` where an admin has turned hosted Builder on. Its run is read, scout, work, submit. The scout step verifies the item's premise against current code and data; a failed premise holds the item with a reason event, the item does not advance, and held premises are counted per persona. Work lands on `harness/<item>` with a PR that declares what it closes, risks and touches plus `risk_tier` and `risk_domains`. On the hosted path the scout step runs on `openrouter-messages`. | Must | #60 |
| PE-6 | **Reviewer** is a persona page with its own identity, distinct from Builder's on the platform and on GitHub, working Check. Toolset has no gate verb and no `write_page`. Default engine `openrouter-messages`, reading the diff and checks through GitHub facts with no container. Findings reach the PR as a GitHub review on the head commit. Each round is a run step; after three rounds the item is handed to a person. A second Reviewer page on `codex-sandbox` supplies the second approval for `high` items. | Must | #61 |
| PE-7 | **Iterate** is a persona page in the BML fixture on `openrouter-messages` and `workflow-run`. It reads measurements only through `query_entities`, proposes a revision as a page draft in which every claim carries an evidence label, and routes it along a `feeds` edge. It runs unattended only under a delegation. | Must | #62 |
| PE-8 | **Learning and skill page types wired to Close.** `learning` frontmatter: `confidence`, `as_of`, `supersedes`, a contradiction flag, a review date. `skill` pages are in agentskills.io format. Both land `suggested` when an agent writes them and a person confirms. A newer learning that names an older unretired one in `supersedes` sets the contradiction flag. A stale-confidence report lists `assumed` and `inferred` learnings past their review date and feeds the health indicator. The harness skill and each stage's instructions page validate as `skill` pages. | Must | #63 |

### 7.10 Proof

| ID | Requirement | Priority | Source |
|---|---|---|---|
| DX-1 | **The kernel.** Every harness behaviour is a call on `createKernel(ports)` in `packages/harness`, pure TypeScript that imports nothing from Workers, Drizzle, a vendor SDK or the network. `apps/uw-app` constructs it with platform adapters; the sim constructs it with test adapters. | Must | #82, ADR 0001 |
| DX-2 | **The Store test adapter is real Postgres.** In the sim, the Store port is the same Drizzle adapter over an embedded Postgres (PGlite) running the real migrations from `packages/db`. No hand-written in-memory tables. The one Drizzle implementation of the Store and Grants ports lives in `packages/db/store`, and the platform adapter and the sim's test adapter both bind it. `sim/` may import `packages/harness`, `packages/contracts`, `packages/db` and the Node built-ins `fs`, `fs/promises`, `path`, `url`, `process`, `assert` and `assert/strict` (`os` and `child_process` only in its tests, CLI and runner), and its tests Vitest, and nothing else. | Must | #82 |
| DX-3 | **A contract test per port.** One shared test suite per port, run against every adapter of that port. A check fails on a port without one. | Must | #82 |
| DX-4 | **The sim.** `pnpm sim -- <scenario>` runs one scenario and prints the event log and the folded state; `pnpm sim -- all` runs every scenario. Scenarios live in `sim/scenarios/`, are named for the requirement ID they prove, and assert on the event log and folded state. | Must | architecture.md |
| DX-5 | **Every Must requirement in this document that is not marked Built has a scenario or a test that fails without it.** `pnpm trace` fails on a requirement ID with neither. `pnpm walk -- <template>` prints every path from Package to an external effect and the gate each crosses. Both join `pnpm verify`; during the build verify runs `pnpm trace:built`, which equals `pnpm trace` once the last build step is Built. | Must | architecture.md |
| DX-6 | **What only separate connections can prove** runs on the Postgres service container in CI (FD-6), and locally whenever `TEST_DATABASE_URL` points at a Postgres server: the grant re-read race (KN-14), N concurrent claims on one item, and two claims racing one WIP slot (KN-5). The constraint and trigger tests (KN-2, KN-3) run on both the embedded Postgres and the service container. | Must | #82, #17, #21 |
| DX-8 | **The build needs no live account.** Every Must requirement is proven against test adapters, fixture keys and recorded fixtures: Access JWTs signed by a fixture key pair, GitHub webhooks and API responses from fixtures, model turns scripted, AI Gateway cost data from fixtures, push and Zulip sends recorded. Each platform adapter is written, passes its port's contract test where the contract can run without the live service, and is listed in `docs/progress_tracker.md` as awaiting live verification. Nothing a requirement needs may be reachable only with a secret. | Must | section 15 |
| DX-7 | **Figure 2 end to end in the sim.** One scenario takes a fixture item from kickstart to Close on the software template with scripted personas and fixture GitHub facts, covering the claim, a held premise, the lease warning and expiry, the PR declaration, the ship rule's refusals, an agent's refused gate attempt, the approve, the merge connector, a refused Close, a Close with a learning, and an Iterate beat under a delegation that then lapses. It is the machine-checkable half of the release criteria. | Must | #64 |

---

## 8. Data and contracts

### 8.1 Tables and who writes them

Every table declares its classification and offline eligibility. Every table has one writer.

| Table | Columns that matter | Written by |
|---|---|---|
| `people` | id, email, display name, status (`active`, `pending`) | the Access middleware |
| `role_grants` | person, role, scope kind, scope area, granted by, granted at, expires at, revoked at | the grants command |
| `grant_audit` | actor, time, before, after | the grants command |
| `pages`, `page_versions` | see FD-9 | the page API and `write_page` |
| `webhook_deliveries` | source, delivery id, received at; primary key on source and delivery id | the `uw-ingest` delivery ledger |
| `queue_watermarks` | queue, last enqueued at, last consumed at | the queue consumer in `uw-app` |
| `harnesses` | id, key, template, jd_area, repository (`owner/name` or null, unique case-insensitively; GH-6), hosted_builder_enabled, paused, created at | the stage command |
| `harness_stages` | harness, key, title, position, bracket (P31), agent_pickup, exit_gate, connector, wip_limit, instructions_page_id, validators[], feeds[], paused | the stage command |
| `harness_items` | harness, stage, title, page, claimed_by, claimant_kind, delegation, lease_expires, priority, due, gate status, gate target, risk_tier, risk_domains[], expected_head, branch_state, pull request repository and `pr_number`, the wrapped issue (`issue_repo`, `issue_number`, `issue_github_id`, all or none, unique on the GitHub id; GH-3), zulip_topic, created at | the kernel |
| `harness_events` | see KN-3 | the kernel, append-only |
| `harness_runs` | item, persona, persona page, delegation, run shape (the run shape names the host), engine, model, pinned and resolved provider, steps with tokens, cost, compute cost and cost basis, gates met, pending prompts, trace id, outcome and why it hibernated or failed | the run shape |
| `gate_decisions` | harness, item, stage, actor, decision, reason, evidence, trace id | the gate command, human principals only |
| `delegations` | id, person, persona, harness, capability, granted at, expires at, revoked at, lapsed at, supersedes (P14), trace id | the delegation command |
| `measurements` | item, source, name, value, as of | the measurements module, through `record_measurement` |
| `personas` | identity, harness, page | a projection of persona pages |
| `gh_repos`, `gh_issues`, `gh_prs`, `gh_milestones`, `gh_check_runs`, `gh_reviews` | the GitHub id (primary key) on every table; the facts (repository full name, default branch; issue and milestone number, title, state, labels; pull request head SHA, head ref, head repository, base ref and base SHA, the parsed declaration or its problem, the changed files with the head and base they were compared at; check run head SHA, name, app, status, conclusion; review login, commit, state, provider); freshness (`fresh_at` on every row, GitHub's `updated_at` on issues, milestones and pull requests, the sweep watermark `swept_through` and `last_sweep` on `gh_repos`); on `gh_issues` the cross-reference claim (`xref_claimed_at`, `xref_comment_id`) | the read-model module `apps/uw-app/github/facts/`, called by the queue consumer and the nightly sweep |
| `push_subscriptions` | endpoint (primary key, `https:` on a known push service), person, p256dh key, auth secret, expires at, created at; at most 20 per person, the oldest removed first | the notifier (`apps/uw-app/notify/push/`) |
| `push_cooldowns` | person (primary key), window started at, rank (1 to 3) | the notifier (`apps/uw-app/notify/push/`) |
| `tasks` | id, jd_area, title, page, due, status (task status), created_by, trace id, created at | the tasks module, through `create_task` |
| `service_tokens` | client id, person, device, bound by, bound at, revoked at, trace id | the service-token command, org admin only |
| `command_requests` | actor, request id, command, harness, outcome, trace id, claimed at, settled at; primary key on actor and request id | the command API's request ledger (`apps/uw-app/commands/requests.ts`) |

### 8.2 The verb registry

| Group | Verbs | Served in v1 |
|---|---|---|
| Pages and context | `search_pages`, `read_page`, `write_page`, `resolve_context` | yes |
| Records | `query_entities`, `create_task` | yes |
| Role-gated | `list_gifts` (areas 40 to 49), `create_draft_journal_entry` (areas 20 to 29) | no |
| Harness | `poll_queue`, `claim_item`, `submit_to_gate`, `record_run_step`, `get_health` | yes |
| Do not exist | `approve`, `merge`, `deploy`, `publish`, `advance` | never |

### 8.3 Closed sets

| Set | Values |
|---|---|
| connector | `none`, `merge`, `deploy`, `publish`, `send`, `post` |
| exit gate | `none`, `checks`, `human_approval` |
| agent pickup | `none`, `allowed`, `auto` |
| risk tier | `low`, `standard`, `high` |
| risk domain | `ledger`, `acl`, `infra`, `migration` |
| evidence label | `observed`, `confirmed`, `inferred`, `assumed` |
| role | `admin`, `editor`, `viewer` |
| scope | `org`, `jd_area` |
| classification | `public`, `internal`, `restricted`, `sensitive` |
| offline eligibility | `sync`, `cache_readonly`, `never` |
| run shape | `workflow-run`, `external-run` |
| engine | `claude-messages`, `claude-code-sandbox`, `claude-managed-agent`, `codex-sandbox`, `external`, `openrouter-messages` |
| cost basis | `metered`, `subscription` |
| gate decision | `approve`, `reject`, `take_over`, `override` |
| capability word | `none`, `iterate`, `build`, `review` |
| stage bracket | `product_package`, `build_package`, `deploy_package`, `iterate` |
| task status | `suggested`, `open`, `done`, `dismissed` |
| persona activation refusal | `unknown_verb`, `forbidden_verb`, `not_permitted`, `engine_not_available`, `dry_run_failed` |
| gate status | `working`, `parked`, `checks_failed`, `done` |
| branch state | `none`, `active`, `abandoned` |
| run outcome | `running`, `hibernated`, `stopped`, `completed`, `failed` |
| delegation lapse | `expired`, `revoked`, `grant_lost` |
| run hibernation | `gate`, `paused`, `breaker` |
| run stop | `stopped_by_person`, `released`, `lease_expired`, `delegation_lapsed`, `gate_wait_expired` |
| run failure | `retries_exhausted`, `provider_mismatch`, `start_failed`, `turn_limit` |
| run result | `submitted`, `premise_held`, `decided`, `review_posted`, `review_withheld`, `review_refused` |
| breaker level | `open`, `holding`, `pausing` |
| review verdict | `approve`, `request_changes` |
| CI job | `security-audit`, `lint`, `typecheck`, `architecture`, `test`, `build` |
| check conclusion | `success`, `failure`, `neutral`, `cancelled`, `skipped`, `timed_out`, `action_required`, `stale` |
| wake reason | `gate_waiting`, `delegation_lapsed`, `run_failed`, `stage_advanced`, `handed_to_person` |
| live screen | `home`, `flow`, `board`, `gates`, `item` |

### 8.4 Identity strings

```
human:<id>
agent:<persona>
agent:<person>/<device>
agent:<person>/<device> as <persona> via delegation:<id>
```

### 8.5 Refusal reasons

Ship rule: `pr_not_open`, `pr_is_draft`, `head_mismatch`, `checks_not_green`, `no_reviewer_approval`, `risk_tier_undeclared`, `reviewer_count_below_tier`, `reviewer_providers_not_distinct`, `approver_lacks_domain_grant`.

Elsewhere: `not_permitted`, `not_wired`, `wip_limit_reached`, `lease_held`, `lease_expired`, `pickup_not_allowed`, `validator_failed`, `unknown_validator`, `delegation_required`, `gate_refused_to_agent`, `reason_required`, `spend_held`, `hosted_builder_off`, `engine_not_available`, `diff_exceeds_review_budget`, `unknown_verb`, `forbidden_verb`.

Added in step 1: `malformed_command`, `unauthenticated`, `access_not_configured`, `database_not_configured`, `internal_error`, `pending_approval`, `person_not_found`, `grant_not_found`, `grant_exists`, `last_org_admin`, `expiry_in_past`, `unknown_page_type`, `invalid_frontmatter`, `page_not_found`, `page_exists`, `slug_taken`, `stale_version`, `parent_not_found`, `parent_cycle`.

Added in step 3: `harness_not_found`, `harness_exists`, `stage_not_found`, `item_not_found`, `delegation_not_found`, `delegation_lapsed`, `not_holder`, `transition_not_allowed`, `unknown_feed_target`, `connector_not_registered`, `template_bypasses_gate`, `stage_edit_refused`, `item_not_at_gate`, `reason_not_one_line`, `decision_in_flight` (an approve or override at a connector stage while an earlier approval of the same parking still awaits its connector outcome).

Added in step 6: `request_in_flight` (a command whose `requestId` is still running), `issue_not_found` (an import the read model does not hold), `stage_not_empty` (P17).

Added in step 7: `run_not_found` (a run id the kernel does not hold, or one the caller may not see).

Added in step 10: `activation_required` (a write that would make a gated page active, which only activation or confirmation does), `dry_run_failed` (a persona whose dry run found a problem).

### 8.6 Event vocabulary

```
item_created  item_claimed  item_released  item_reordered  lease_renewed  lease_expired
branch_abandoned  branch_adopted  stage_advanced  loop_edge_taken  premise_held  risk_derived
label_removed  run_started  run_step_recorded  run_failed  run_hibernated  run_resumed  run_stopped
run_completed  run_prompted
submitted_to_gate  checks_passed  checks_failed  gate_approved  gate_rejected
gate_taken_over  gate_overridden  gate_refused_to_agent  ship_refused
connector_succeeded  connector_refused
delegation_granted  delegation_revoked  delegation_lapsed  delegation_required
stage_edit_refused  stage_edited  stage_removed  template_activated  harness_paused
harness_resumed  hosted_builder_set  learning_attached  nothing_learned  comment_recorded
zulip_topic_linked
breaker_holding  breaker_pausing  breaker_open
persona_activation_failed  persona_activated
measurement_recorded  handed_to_person
```

Since contract 12.0.0 (step 9), `comment_recorded` carries strict evidence `{ source: 'zulip', messageId, topic, personId, email, text, truncated }` (the text cut at 10,000 characters), and `zulip_topic_linked` `{ topic }` sets the item's Zulip topic in the fold.

Since contract 12.1.0 (step 10), `persona_activated` carries `{ pageId, persona, version }` (the version the flip wrote); `measurement_recorded` carries `{ measurementId, source, name, value, asOf }`; `handed_to_person` carries `{ personId, why: 'review_rounds_exhausted', rounds }`; and `learning_attached` gains `kind` (`learning`, the default, or `revision`).

`packages/contracts` on `main` carries four placeholder names (`gate_approved`, `lease_expired`, `delegation_lapsed`, `abandoned`). The list above replaces them; `abandoned` becomes `branch_abandoned`.

`stage_edited` (contract 3.2.0) records every accepted stage create, update and reorder: the stage id, its key, and before/after limited to the columns the edit changed (before is null for a creation; a reorder writes one per stage whose position changed). It is a harness-level event and changes no item.

`item_reordered` (contract 10.0.0) records an item's new priority and, for the moved item, the item it was placed before. `stage_removed` records a removed stage's id, key and columns. `harness_paused` and `harness_resumed` name the lane, or null for the whole harness. Every event carries the `requestId` of the command that appended it, or null.

`run_started`, `run_hibernated`, `run_resumed`, `run_stopped`, `run_failed`, `run_completed` and `run_prompted` (contract 11.0.0) record a run's life with closed-set reasons; `breaker_*` carry the spend reading; `hosted_builder_set` records the switch. `run_step_recorded` gains the step's cost, compute cost, model, resolved provider, the tools it called and its write count; a step recorded before 11.0.0 reads them as null, null, null, null, none and 0. A lost lease has one reason everywhere: the run stops `lease_expired`.

---

## 9. Platform and technical constraints

| Area | Decision |
|---|---|
| Language | TypeScript, `strict: true`, no `any`, no `@ts-ignore`. Node 22, pnpm workspaces. |
| Platform | Cloudflare Workers. `uw-app` holds server-rendered pages and islands, the command API, the MCP surface, the live hub (Durable Object), Workflows, the queue consumer and crons. `uw-ingest` holds webhooks and nothing else. |
| Database | Neon Postgres through Hyperdrive. Drizzle in `packages/db/schema.ts` is the only schema. Migrations are plain SQL, generated and hand-written. No manual production data edits. |
| Shape | Ports and adapters. One pure kernel in `packages/harness`, reached only through ports; the database is behind the Store port like everything else. Each port has a platform adapter in `apps/uw-app` and a test adapter in `sim/`, and may have more than one platform adapter. |
| Ports | Clock, Ids, Store, Grants, GitHubFacts, Connectors, ModelEngine, Hub, Notifier, Runs. Validators are a registry inside the kernel, not a port. |
| Naming | "Kernel" is the pure core. "Engine" means only the code behind the model-vendor seam. |
| Layering, enforced by the build | `packages/contracts` imports nothing. `packages/core` imports contracts. `packages/db` imports contracts and core. `packages/harness` imports contracts and core types and nothing with side effects. `apps/*` and `sim/` are the composition roots. Islands call the command API, never the kernel. A vendor SDK is imported only under `apps/uw-app/engines/<key>/`. |
| Truth | `harness_events` is append-only and is the source of truth. State is a fold. Replay equals record. |
| Agent boundary | Agents reach the platform only through the MCP surface serving the verb registry. |
| Authorization | One `can(actor, verb, resource)` over `role_grants`. A principal is minted at the edge on every request and travels with every call, queue message and MCP invocation. |
| Conventions | Dates `YYYY-MM-DD` through one pair of functions; instants `timestamptz` in UTC; money in integer minor units with a currency; UUID ids with kebab-case slugs; Zod at every boundary; JD ids `NN.NN`. |
| Infrastructure | Everything is declared in `infra/` and `.github/workflows/`. Nothing exists only in a dashboard. No secret in a wrangler or workflow file. |
| Code style | No code comments. Files under 500 lines, functions under 50. Conventional Commits. `pnpm verify` green before any push. |
| Observability | One trace id end to end. Structured JSON logs, 30 days. Audit trails 7 years. |
| Billing | Hosted runs use organization API keys through AI Gateway under one cap. External runs use the person's own subscription and are tracked as contributed time. Hosted Builder is off by default. |
| Dependencies | Prefer a maintained, typed, permissively licensed package that runs on Workers over custom code. |

---

## 10. Design

The source of truth for visual design is the prototype in `ui-design/` (Development, Agent Queues and Health screens) and the token block in the Key Visuals page, until Jesse's `design-system/` handoff lands. When it lands, its `tokens/*.css` replaces the interim extraction and nothing in the islands changes but the import.

| Prototype screen | Harness view |
|---|---|
| Development, Board segment | Board (WB-5) |
| Development, Merge gates segment | Gates (WB-6) |
| Agent Queues lanes and cards | Board (WB-5) |
| Agent Queues "What the run did" | Item play-by-play (WB-8) |
| Health | `/health` agent plane (WB-10) |
| Development, Flow segment | not used; the Flow view (WB-4) is the BML diagram |

**What is fixed**

- **Palette.** The five brand colours with their soft tints: Inspire, Ocean, Tech, Cultivate, Kindle. Light values from the prototype, dark values from Key Visuals. There is no red for status.
- **Kindle** marks a human action and nothing else. Every prototype use of Kindle that is not a person acting is retoned.
- **Type.** Nunito Sans with Avenir fallback; monospace for identifiers.
- **Layout.** Fluid, not the prototype's fixed 1440 by 1000. Phone width is first-class for the Gates view.
- **Figure key.** Ocean outline for what the plan had, Inspire fill for what the harness adds, dashed grey for later.
- **Copy.** Sentence case, second person, no exclamation marks, no emoji. unfoldingWord is always camelCase.

---

## 11. Security and authorization

| Act | Requires |
|---|---|
| See a harness, its board and its items | `viewer` on the area, or org-wide read |
| Claim an item, on either host | `editor` on the area; an agent claims through its owner's grant |
| Mint `agent:<person>/<device>` and run externally | the same `editor` grant |
| Approve, reject, take over or override at a gate | `admin` on the area |
| Approve a `high` item touching `ledger` | `admin` on the area and `admin(20-29)` |
| Approve a `high` item touching `acl`, `infra` or `migration` | `admin` on the area and org-scope `admin` |
| Schedule an unattended loop | `admin` on the area, recorded as a delegation |
| Create or activate a persona; edit stages; turn on hosted Builder | `admin` on the area |

- No agent identity can approve, merge, deploy, publish or advance an item past a human gate, on any host, by any route.
- No route, tool or Workflow step exists without a `can()` call scoped to the harness's area.
- Write tokens for GitHub live in the host step and never in a model process. On a laptop the person's own git credentials are used, guarded by the `harness/<item>` convention and the ship rule's head check.
- No subscription credential is stored on the platform.
- The software harness lives in area 80 to 89. A harness item carries its area's classification. Nothing in an item may hold a value the principal could not read directly.
- **Known gap.** The repository is private on GitHub's Free plan, so there is no branch protection, and any writer can push a workflow that reads the Cloudflare token. This is recorded in `docs/exceptions.md` and closes with a paid plan, a public repository, or a separate Cloudflare account for production.

---

## 12. What already exists

On `main` at commit `af6dc6c`:

- The workspace, the date module and its gates, the module registry (FD-1).
- The toolchain and `pnpm verify` (FD-2). `walk`, `trace` and `sim` are not in the chain yet.
- `apps/uw-app` with one route and a health route; `apps/uw-ingest` as a package with tests and no Worker code; `infra/uw-app/wrangler.toml` with staging and production (FD-3).
- The seven GitHub Actions workflows (FD-4).
- `packages/contracts` with the envelopes, closed sets, identity forms and fixtures (CT-1). The verb registry is not there yet.
- `packages/db` with an empty `schema.ts`, the `declareTable` declarations and their test, the client factory, the migration runner (`pnpm db:migrate`, `pnpm db:generate`), and the schema drift check (FD-5). No table is declared yet.
- `packages/harness` holds a wiring test.
- Eight ADRs, `docs/architecture.md`, `CONTEXT.md`, `AGENTS.md`.

Not on `main`: `sim/`, `packages/ui/`, any table, any port, any adapter, any MCP code.

---

## 13. Build order

Each step needs the ones above it. Within a step, order is free.

1. **Finish the foundation.** FD-6, FD-12 (written, not switched on), FD-7, FD-8, FD-9, FD-10, FD-11, CT-2.
2. **Stand up the kernel's frame.** DX-1 to DX-6 and DX-8: the ports, the embedded-Postgres Store adapter, the contract tests, the sim, `walk` and `trace`.
3. **Kernel and data.** KN-1 to KN-3 first (tables, the Ship invariant, the event log), then KN-4 to KN-18.
4. **Agent boundary.** AB-1 to AB-8.
5. **GitHub facts.** GH-1 to GH-7.
6. **Command API and live hub.** WB-1 to WB-3, with the design system WB-11 alongside.
7. **Hosts and engines.** HE-1, HE-2, HE-3, HE-4, HE-5, then HE-6, HE-7, then HE-8, HE-9, HE-10.
8. **Views.** WB-4 to WB-10, WB-12.
9. **Reaching a person.** NT-1 to NT-4.
10. **Personas.** PE-1 to PE-8.
11. **The end-to-end scenario.** DX-7.

`packages/db/schema.ts`, `packages/contracts/` and the event vocabulary are the files most likely to conflict; change them in small commits.

---

## 14. Release criteria

v1 is ready when all of these are true. There is no date.

**Provable by the build, with no person, no account and no secret**

1. `pnpm verify` is green, including `walk`, `trace` and `sim -- all`.
2. Every Must requirement not marked Built has a scenario or test named for its ID (DX-5).
3. DX-7 passes: one item travels Package to Close in the sim with every gate exercised.
4. Both templates pass the property test; the negative fixture fails it.
5. The three agent-boundary checks (AB-7) pass, and fail when their planted fixtures are added.
6. The CI `test` job passes the race and concurrency tests on its Postgres service container (DX-6).

The build is finished when items 1 to 6 hold. Nothing below is needed to reach that point.

**After the build: go-live, by people**

These start once the build is finished and the accounts in section 15 exist. Each platform adapter gets its first run against the real service here, so expect this stage to find defects the test adapters could not.

7. The go-live wiring (FD-12) is switched on: staging has its database through Hyperdrive, and each platform adapter listed in the tracker as awaiting live verification has run against its service. Unauthenticated requests to staging are rejected at the edge; a signed-in person reaches the app.
8. The acceptance scenario of issue #64 runs on staging, driven by one person with `admin(80-89)` and one with `editor` only: kickstart; a hosted claim with the scout step on the always-on engine; a laptop claim by the `editor` whose tool list equals the hosted one; a held premise on a deliberately wrong item; work on `harness/<item>` with subscription tokens on the board; the `wip:` push at the lease warning, then expiry and a fresh claim from the expected head; a PR refused without its declaration and accepted with it; CI and a Reviewer verdict read back from GitHub; a web push and a Zulip thread that carry no content and open the Gates view at phone width; the ship button disabled with its closed reason when the head changes and when a `high` item has one reviewer; an agent's approve attempt refused and logged on each host; an approve that produces exactly one `gate_decisions` row, a merge and a deploy; a measurement at Validate; Close refused without a learning and accepted with one; an Iterate beat under a delegation, refused without one, stopped when it is revoked; and `/health` showing all of it.
9. The event log for that item is exported with screenshots of the Flow, Board, Gates, play-by-play and `/health` views, in light and dark.
10. One real item, the council's canonical taxonomy registry, has travelled the production harness end to end and closed with a confirmed learning (issue #65).

---

## 15. Dependencies and prerequisites

These need a person, an account or a secret, and the build cannot create them. **None of them is needed until the build is finished** (DX-8): the build proves every requirement against test adapters and fixtures, writes the platform adapters, and records each one in `docs/progress_tracker.md` as awaiting live verification. They are needed for go-live, section 14 items 7 to 10. The one exception is already in place: the Cloudflare token that lets CI deploy the per-PR Worker.

| Dependency | Needed by | Owner | Status |
|---|---|---|---|
| Cloudflare account, API token, account id (GitHub secrets) | FD-3, FD-4 | Ian | In place |
| Neon project, API key, connection strings; Hyperdrive configs for staging and production | FD-12 | Ian | To set up, after the build |
| Cloudflare Access application with Google as identity provider; team domain and audience tag | FD-7 | Ian, Jesse | To set up |
| Access service tokens for agent identities | AB-2, AB-6 | Ian | To set up |
| Cloudflare Queue and dead-letter queue | FD-10 | Ian | To set up (declared in wrangler) |
| GitHub App registered on the unfoldingWord org; private key, installation id, webhook secret | GH-1 | an org owner | To set up |
| A GitHub identity for each Reviewer persona | PE-6, HE-9 | an org owner | To set up |
| A test repository for the merge connector's integration test | GH-6 | Ian | To create |
| AI Gateway; Anthropic, OpenAI and OpenRouter API keys | HE-3, HE-4, HE-5, HE-9 | Ian, Jesse | To set up |
| Cloudflare Sandbox and Containers enabled on the account | HE-8, HE-9 | Ian | To check |
| Zulip bot, its credentials, and an outgoing webhook | NT-3 | Jesse | To set up |
| Web push VAPID key pair | NT-1 | Ian | To generate |
| The brand guide link and the `design-system/` handoff | WB-11 | Jesse | Requested |
| Two people for the staging acceptance run | section 14 | Ian, Jesse | When the build is done |

---

## 16. Roadmap after v1

1. Scout as its own persona with its own stage exit, when premise-refusal rates show it earns one.
2. The intake persona and interview-driven persona creation (v1.1).
3. The BML Deploy Package channel: the web host, the mailing list or a social connector (D9).
4. `claude-managed-agent` implemented.
5. A native phone app, revisited after a quarter of harness operation.
6. A quorum of approvals for items touching more than one domain.
7. BML measurements from areas 40 to 49, behind the finance and CRM read exclusions.
8. The role-gated verbs, with the ledger and CRM modules.
9. Cloudflare OS as a third host.

---

## 17. Open questions

Each has a working assumption so the build does not wait. The assumption stands until a DRI changes it here.

| # | Question | Working assumption |
|---|---|---|
| Q2, D9 | Which Deploy Package channel is wired first, and does `uw-www` join v1? | None in v1. The BML template's Ship stage carries `publish`, and the handler returns "not wired". |
| Q4, D2 | Is the phone-app cut confirmed? | Yes. Needs Jesse's explicit word, because it reverses an earlier brief. |
| Q10, D21 | Which flash-class model does the always-on tier start on? | The model is configuration on each persona page. The fixtures name the spec's example, GLM 5.3 flash through OpenRouter, as a placeholder. |
| | What is the AI Gateway cap in dollars? | $1,250 a month, the brief's "less than $15k per year" for maintenance and AI tooling, as configuration. |
| | Nonprofit Team seat price | Not used anywhere in v1. To be re-verified before it enters the brief. |
| | Does the repository move to a plan with branch protection? | No. The deploy gate stands in for it. |
| | Licence for this repository | To be confirmed by unfoldingWord. |

---

## 18. Decision log

### 18.1 Decisions from the spec

Each row is ratified in the spec's Decisions table; the spec holds the full text.

| # | Decision |
|---|---|
| D1 | Software delivery first, BML second, both shipped as templates on one stage machine. The GitHub App is in v1. |
| D2 | No phone app in v1. Web push and the Zulip bot serve "waiting on you". |
| D3 | One Durable Object per active harness as a wakeup hub with per-session cursors; polling is the fallback. |
| D4 | A published contract package: one live version, golden fixtures, CI conformance. |
| D5 | Two first-class hosts in v1, a platform Workflow and a person's own Claude Code over remote MCP, with one verb registry and one test that both see identical verbs. |
| D6 | `feeds` on each stage for loop edges; unattended traversal only under a delegation. |
| D7 | `harness_events` is the source of truth; replay equals record. |
| D8 | The ship rule is a pure function with a closed refusal set. Ship exits only on human approval, enforced by a null-safe Postgres check and a property test over every path. |
| D10 | The Product Package is three typed pages under a product page. |
| D11 | External runs self-report tokens, labelled subscription; the breaker never counts them. No token ledger of our own. |
| D12 | On a laptop the person's own git credentials are present. Accepted, guarded by the branch convention and the head check. |
| D13 | Anyone with `editor` on the area may run externally. No separate allow-list. |
| D14 | Personas select verbs; a new verb is reviewed code; `requires_tools` makes a missing verb a visible card. |
| D15 | A persona is a page type, activated by a person after a tool check and a dry run. |
| D16 | Six engines behind one seam; a vendor SDK is named in one directory. |
| D17 | Billing follows the host. One cap across vendors. Hosted Builder off by default. |
| D18 | A `delegations` table: one capability word, required expiry, revocable, checked at every beat. |
| D19 | Risk tier and domains on every item; `high` needs two reviewers on distinct providers and an approver holding each domain's grant. |
| D20 | Close is a validator: a learning, a skill, or a signed "nothing learned". Evidence labels from day one. |
| D21 | `openrouter-messages` is the always-on tier and the platform's baseline model service. |
| D22 | A scheduled routine on a person's machine is an external runner on a delegation. |

### 18.2 Decisions made in this document

The issues left these as "decide in the PR". They are decided here so the build is not a series of silent choices. Anything unspecified that is not in this table is decided by the builder and recorded in `docs/progress_tracker.md` with what it costs if wrong.

| # | Decision |
|---|---|
| P1 | **Kernel naming, the Store test adapter, and port contract tests** follow issue #82 (DX-1 to DX-3). The pure core keeps the Store port. |
| P2 | **Reviewer diversity is judged by resolved model provider**, as spec v1.1 says, not by vendor or engine as some issue text says. The fourth refusal reason, `reviewer_providers_not_distinct`, is in the set. |
| P3 | **Reviewer's default engine is `openrouter-messages`**; `codex-sandbox` is the second identity. Issue #61's older line placing Reviewer on `codex-sandbox` is superseded. |
| P4 | Closed sets are CHECK-constrained text columns, not Postgres enums, so a contract change is a migration of a constraint. |
| P5 | `scope_area`, `pages.jd_area` and `harnesses.jd_area` share one text form, `NN-NN` (for example `80-89`). |
| P6 | The Postgres driver is `postgres` with `drizzle-orm/postgres-js`. Table declarations attach through a `declareTable` wrapper that records each one in a registry a test walks. |
| P7 | The event position is a per-harness sequence. Events are never archived in v1. A repair routine that rebuilds the `harness_items` projection from the log ships with KN-4. |
| P8 | The lease default is a constant 15 minutes. An expired lease is detected lazily by the claim predicate and by a one-minute cron; `lease_expired` is written once. The warning fires 3 minutes before expiry as a flag on the `record_run_step` response. A failed `wip:` push is logged by the skill and the lease still expires. |
| P9 | An item traversing a loop edge is the same item re-entering the earlier stage, with `loop_edge_taken` recorded. |
| P10 | The walker cuts a cycle at the first revisited stage on a path. An effect stage's own `human_approval` exit satisfies the property; an edge that lands on an effect stage and bypasses its exit cannot exist, because exits belong to the stage. |
| P11 | The ship rule reports every failing reason, in the order of section 8.5. |
| P12 | Override may bypass `no_reviewer_approval` and open review findings only. It never bypasses a head mismatch, red checks, an undeclared tier, the `high` reviewer rules, or the grant check. |
| P13 | The locked re-read refusal uses `approver_lacks_domain_grant`. Take over releases any lease and sets the person as holder. Reject findings are a list of text entries on the event. |
| P14 | Capability words are `none`, `iterate`, `build`, `review`. `none` opens nothing. Renewal writes a new delegation row that names the one it supersedes. The beat check does not take a row lock. |
| P15 | Protected directories: `packages/db/migrations/` is `migration`; `packages/core/acl.ts` and the grants command are `acl`, and so are the code that decides what Ship sees and what merges (the risk map, the ship rule and its contract, the gate path, the GitHub identity and merge code, the platform adapters and the kernel composition root); `infra/`, all of `.github/`, the dependency rules and the architecture checks are `infra`; a future `packages/ledger/` is `ledger`. The map is a file in `packages/harness`. Derivation runs at every `submit_to_gate`. |
| P16 | The PR declaration is a fenced block in the PR body headed `harness`, with `closes`, `risks`, `touches`, `risk_tier` and `risk_domains` lines. Its parsed shape is a contract schema. |
| P17 | Default `agent_pickup` per stage: Package `none`, Scope to Check `allowed`, Ship `none`, Validate and Close `allowed`. Default WIP limit is 3 per stage. Stage positions are gapped by 10. A stage holding an item cannot be removed. |
| P18 | Trace ids are UUIDs, carried in an `x-trace-id` header and on every event row. Request and response bodies are never logged. Queue depth on `/health` is consumer lag. |
| P19 | Webhook replay detection stores only the delivery id. The ingest system identity is `agent:ingest`. |
| P20 | `pages.status` is `draft`, `suggested`, `active`, `retired`. Slugs are unique per area. Page API writes use a version check and refuse a stale version. `create_task` writes to a minimal `tasks` table. Search is Postgres full-text. |
| P21 | Local development uses a dev-only principal enabled by a variable that the staging and production wrangler environments cannot set. A pending person is approved by an org admin through the grants command. |
| P22 | The merge method is squash. The tag is `harness/<item>`. A redelivered `requestId` replays the first outcome. Command routes are `POST /api/harness/:harness/commands/:name`. |
| P23 | The live hub uses WebSockets with exponential backoff to 30 seconds; the polling fallback is every 15 seconds. The wake carries no position. Wakes in one tick coalesce to one. |
| P24 | The push cooldown is 10 minutes per person. Stage-advanced wakes go to the item's holder only. Presence comes from the live hub. A failed send is not retried. The payload carries no delegation id. |
| P25 | Zulip topics are named `<harness>/<item ref>`. Only waiting-on-you and run-failed reasons post. A post does not use the cooldown and @-mentions no one. Replies are `comment_recorded` events. A reply from an unmapped author is recorded with the email and no person. A harness-level `delegation_lapsed` posts to a topic named for the harness. |
| P26 | A failed run is a Workflow that has exhausted its retries or been aborted. Workflow steps retry 3 times. A failed hosted run under a delegation wakes the delegating person. |
| P27 | The breaker stops; it does not fail over to a cheaper model. |
| P28 | The persona dry run is one `claude-messages`-shaped turn against a fixture item on test adapters that writes nothing durable. A persona whose missing verb later ships needs the person to press Activate again. |
| P29 | Builder's default model on the hosted path is the persona page's `model` field, with Sonnet-class as the fixture value. Reviewer's lens split for `high` items is correctness on the first reviewer and security on the second. |
| P30 | The default review date for `assumed` and `inferred` learnings is 90 days after `as_of`. A contradiction is detected by `supersedes` alone. |
| P31 | The bracket each stage belongs to is a column on `harness_stages`. The Flow diagram is inline SVG. Board reorder is a menu action, with drag-and-drop optional. The play-by-play pages 100 events at a time. Home lives at the app root. A gate the person cannot decide for lack of a domain grant is not shown. |
| P32 | The interim tokens live in `packages/ui/tokens/`. The tested phone width is 390 pixels. The service worker caches the shell only and holds no harness data. |
| P33 | Once FD-12 is on, per-PR Workers bind to shared staging's database through its Hyperdrive config; only CI's Neon job uses the per-PR Neon branch. Until then a per-PR Worker runs with no database. |
| P34 | The engine seam's loop caps at 40 turns. A tool error is returned to the model as the tool result. |
| P35 | **The shared Store implementation lives in `packages/db/store`.** `sim/` may not import `apps/` and `apps/` may not import `sim/`, so the one Drizzle implementation of the Store and Grants ports that DX-2 requires sits in `packages/db`, and both adapters bind it. `sim/` may also import the Node built-ins DX-2 names, and its tests Vitest. `pnpm verify` runs `pnpm trace:built` during the build, which equals `pnpm trace` once the last step is Built (DX-5). |

---

## Appendix A. Where the issues disagreed with the spec

- Issues #20, #36, #54 and #61 speak of reviewer "vendors"; spec v1.1 changed this to resolved model providers and added `reviewer_providers_not_distinct`. This document follows the spec (P2).
- Issue #61 carries two engine lines for Reviewer. The later one, `openrouter-messages` by default, is the spec's (P3).
- Issue #12 asked for branch protection. It was closed because the plan the repository is on does not offer it; FD-4's deploy gate stands in.
- The spec's Figure 2 drawing shows Close with exit `none`; the v1.1 text makes it `checks` with `learning_attached`. The text wins.
- `docs/architecture.md` and ADR 0001 used to say "engine" for the pure core and describe in-memory tables for the Store test adapter. Issue #82 corrected both on 2026-10-01; this document, `AGENTS.md`, `CONTEXT.md` and the dependency rules use the corrected terms.

## Appendix B. Issue to requirement map

| Issue | Requirements | | Issue | Requirements |
|---|---|---|---|---|
| #4 | FD-1 | | #40 | WB-4 |
| #5 | FD-3 | | #41 | WB-2, WB-5 |
| #6 | FD-7 | | #42 | WB-6, WB-7 |
| #7 | FD-5 | | #43 | WB-8 |
| #8 | FD-8 | | #44 | WB-9 |
| #9 | FD-9 | | #45 | WB-10 |
| #10 | FD-10 | | #46 | WB-11, WB-12 |
| #11 | FD-11 | | #47 | HE-1 |
| #12 | FD-4 (closed, not available) | | #48 | HE-2, HE-3 |
| #13 | CT-1, CT-3 | | #49 | HE-4 |
| #14 | CT-2 | | #50 | HE-5 |
| #15 | KN-1, KN-2 | | #51 | HE-6 |
| #16 | KN-3, KN-4 | | #52 | HE-7, GH-4 |
| #17 | KN-5 | | #53 | HE-8 |
| #18 | KN-6, KN-7 | | #54 | HE-9 |
| #19 | KN-8, KN-9 | | #55 | HE-10 |
| #20 | KN-11, KN-12 | | #56 | NT-1, NT-2 |
| #21 | KN-13, KN-14 | | #57 | NT-3 |
| #22 | KN-10 | | #58 | NT-4 |
| #23 | KN-15 | | #59 | PE-1 to PE-4 |
| #24 | KN-16 | | #60 | PE-5 |
| #25 | KN-17 | | #61 | PE-6 |
| #26 | KN-18 | | #62 | PE-7 |
| #27 | AB-1, AB-2, AB-3 | | #63 | PE-8 |
| #28 | AB-4 | | #64 | DX-7, section 14 item 8 |
| #29 | AB-5 | | #65 | section 14 item 10 |
| #30 | AB-6 | | #66 | section 17 |
| #31 | AB-7 | | #67 | FD-2 |
| #32 | AB-8 | | #68 | FD-4 |
| #33 | GH-1 | | #79 | FD-6, FD-12 |
| #34 | GH-2 | | #82 | DX-1, DX-2, DX-3, DX-6, P1 |
| #35 | GH-3 | | | |
| #36 | GH-4, GH-5 | | | |
| #37 | GH-6, GH-7 | | | |
| #38 | WB-1, WB-2 | | | |
| #39 | WB-3 | | | |
