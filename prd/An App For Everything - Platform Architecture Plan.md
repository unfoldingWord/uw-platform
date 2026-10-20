# An App For Everything — Platform Architecture Plan

*A vertically and horizontally integrated operating system for the whole organization.*

## Context

unfoldingWord runs on four disconnected systems: Sage Intacct (GL actuals), Virtuous (CRM + giving), Notion (knowledge/PM), and a Google Sheets "Rolling Budget" — plus GitHub/ZenHub for dev work. Program pages in Notion manually reconcile money across all four; the research pass found program leads hand-documenting discrepancies (e.g., translationCore running −$73K vs plan with a mis-categorized multi-year ask). AI-assisted development makes an integrated, self-hosted platform feasible for a team of one-plus-agents.

**Decisions made (by the sponsor):** Cloudflare serverless stack; external Postgres (Neon) via Hyperdrive; full double-entry fund-accounting GL built from the start (replacing Sage); native CRM replacing Virtuous with Stripe direct; maintained primarily by the sponsor + AI agents.

**What the Notion research found (grounds the data model):**
- Johnny.Decimal is the org spine: areas 00–99, each = Notion teamspace + Google shared drive + Zulip folder. Reserved IDs xx.96–99 (Impact Stories/Templates/Meetings/Archive).
- Hierarchy: the **Strategic Cascade** (see `Strategic Cascade.png`): Purpose (enduring) → Objective/MTP (stable) → Principles + Values (stable) → Strategic Intent (1–3+ yrs) → Programs (qtr–1 yr) → Projects (wks–mos) → Tasks (daily). Strategic Intent and Portfolio overlap — each portfolio has a strategic intent; effectively synonyms. Notion relations exist but with integrity debt (Portfolio duplicated as a select on both Programs and Projects; grant DB has a parallel non-relational "Program" taxonomy; trailing-space property names).
- Key databases: Product Catalog (~37 products), Program Portfolio, Projects Kanban (cost formulas incl. 18% operational assessment), 2030 OKRs (two-level tree), Colleague Directory + Areas of Responsibility (person×area×%), Grant Management pipeline, Contact/Voicemail intake, Parking Lot.
- NISO (Need/Idea/Strategy/Outcomes + Risks + Roadmap) is the house charter format at every level — preserve as a structured template.
- Portfolios map to GAUs (semi-restricted funds) with an 18% operational assessment (Catalyst Partners = unrestricted, 0%).
- Dev management is entirely in GitHub/ZenHub — nothing machine-readable in Notion.
- Formal policies mostly live in Google Drive with Notion as index; core values/security/AI-use pages are in Notion.

---

**Convergent prior art — Richwood OS.** A peer team (Richwood Industries) independently designed the same architecture for their company — one canonical entity layer over every system, a small MCP tool surface as the agent abstraction, apps and agents composing on top, memory woven across — and their explainer explicitly cites this project as convergent design: "same bet, same era, different scale." Ideas borrowed from their two documents are marked ⟨RW⟩ throughout: the spine test, provenance-first read models, institutional memory with confidence decay, agent personas with evidence ledgers, the independent reviewer harness, mechanical gates, and the compatibility-output migration rule.

**The spine test ⟨RW⟩.** The layers stack: source systems → canonical entity layer (Postgres) → MCP surface (small, single-purpose tool verbs — the agent abstraction) → platform UI + apps + agents, with institutional memory woven across. Every "should we build X?" question is answered by where X sits on the spine — a one-line governance rule that prevents accretion of side systems.

## 0. Conventions (binding across the whole platform)

Small rules, chosen once, enforced mechanically — because in a system this wide the cost of inconsistency is paid forever, and AI agents reading and writing the corpus need one shape to match.

**Dates are always ISO 8601 `YYYY-MM-DD`. No exceptions, anywhere.**

- **Storage**: `date` for calendar dates, `timestamptz` in UTC for instants. Never a formatted string in a data column.
- **Display and entry**: `YYYY-MM-DD` in every UI, every table, every chart axis label, every filename, every export, every PDF footer, every log line, every agent-facing API response. Timestamps render `YYYY-MM-DD HH:MM` with an explicit timezone label when the time matters. No `MM/DD/YYYY`, no `March 3, 2026`, no locale-dependent rendering — a US finance lead and a field partner in Chad must read the same string the same way.
- **Derived forms**: fiscal/accounting periods `YYYY-MM`; quarters `YYYY-Q1`; ranges `YYYY-MM-DD..YYYY-MM-DD`; date-stamped slugs and filenames lead with the date (`2026-08-24-board-packet.pdf`) so they sort correctly everywhere.
- **Frontmatter**: unquoted ISO dates, validated by a shared Zod date schema so an invalid date fails at the boundary rather than in a report.
- **Enforced, not requested**: one `formatDate`/`parseDate` pair in `packages/core`; an ESLint rule and a CI grep ban `toLocaleDateString`, `toLocaleString`, and ad-hoc format strings outside that module. Notion/FRED/Sage/Virtuous imports normalize on the way in; anything unparseable lands in a quarantine report rather than being guessed.
- **Why it earns a rule of its own**: ISO dates sort lexically (so a plain `ORDER BY` on text is right, and so are filenames and headings), are unambiguous across the countries uW works in, are stable in diffs and CSV round-trips, and are the format agents parse most reliably.

Companion conventions, stated here so they are searchable in one place: money is **integer minor units** with an explicit currency (§3, never floats); identifiers are UUIDs with human-facing slugs; JD IDs are `NN.NN`; languages use IETF tags; countries use ISO 3166-1 alpha-2; all text is UTF-8 markdown; file and page slugs are lowercase kebab-case.

## 1. System Topology

Monorepo, three Workers:

| Worker | Purpose | Why separate |
|---|---|---|
| `uw-app` | Everything internal: SSR UI, API, MCP server, queue consumers, crons | One deploy, one log stream |
| `uw-ingest` | Public webhooks: Stripe, GitHub (later Zulip) | No Cloudflare Access in front; isolates signature verification; app deploys never drop a Stripe webhook |
| `uw-www` | Public site: pre-rendered HTML from KV/R2 | Zero DB dependency; site survives Postgres outage |

**Stack** (chosen for AI-agent legibility — boring, typed, greppable):
- TypeScript strict + **Hono** (Workers-native framework)
- **Drizzle ORM** — schema-as-TypeScript is the single source of truth; plain reviewable SQL migrations via drizzle-kit (applied by GitHub Actions direct to Neon, bypassing Hyperdrive)
- **Neon Postgres** via Hyperdrive (free connector). Neon over Supabase: we only want Postgres — Access/R2/DO already cover auth/storage/realtime. Branch-per-PR = free staging DBs.
- **Zod** at every boundary; frontmatter schemas defined once, reused for validation + types + forms
- UI: Hono JSX SSR + HTMX/minimal islands for dashboards, boards, and admin; the **page editor/browser is a shared TypeScript client component** (Tiptap + Yjs, markdown-canonical) mounted as an island on the web and as the whole app in the Tauri desktop shell (§2.5)
- Desktop: **Tauri** app in the same monorepo (`apps/uw-desktop`), reusing the editor/sync client with local SQLite + optional on-disk markdown vault
- Testing: Vitest with workers pool; ledger gets property-based tests ("any generated posting balances or is rejected")
- CI/CD: GitHub Actions → wrangler; main→staging auto, prod on tagged release

**Primitives:** one Queue (webhooks, acknowledgment emails, search refresh — fire-and-forget events) with DLQ monitoring; **Cloudflare Workflows for anything multi-step or long-running ⟨OA⟩** — agent queue runs, the publish pipeline, meeting-correlation jobs, migration imports, month-end assessment drafting. Workflows give durable, checkpointed, resumable execution (a step that fails retries from that step, not from scratch; a run interrupted by a deploy resumes), which is the pattern Vercel's Open Agents proved out for agent loops — implemented here on Cloudflare's native equivalent. Crons for nightly R2 dumps, Stripe reconciliation, GitHub gap-repair sweep. R2: `uw-files`, `uw-backups` (object-locked, 7-yr retention), `uw-site`. **Durable Objects: one per active page as the Yjs sync hub** (websocket collab + offline reconciliation, §2) — idle pages evict and cost nothing. The ledger still does NOT use DOs; Postgres advisory locks serialize posting.

Infra cost estimate: **$25–60/mo** (Workers $5 + Neon ~$19 + pennies; Cloudflare Access free ≤50 users).

## 2. Core Data Model — Pages + Records

Everything human-readable is a **page** (typed frontmatter JSONB + whole-doc markdown body). Everything with financial/referential integrity is a **record** in a typed table pointing at a page for narrative. Never store money facts only in frontmatter.

```
pages (id, type, jd_area, jd_id, slug, title, parent_id, frontmatter jsonb,
       body_md text, version int, status, tsvector search, audit cols)
page_versions (full snapshot per save, edit_source = human:<id> | agent:<id>)
page_links (from, to, rel)  -- rebuilt on save from frontmatter + wiki-links
```

Typed tables: `people, contacts, gifts, grants, journal_entries/lines, accounts, funds, functions, budget_lines, contracts, work_orders, partner_invoices, commitments, gh_issues, sprints, responsibilities, jd_areas, tasks` — plus the FRED field-data tables (`language_engagements, training_events, translation_products, field_orgs`; see §9).

**Strategic Cascade as the entity spine.** The page tree mirrors the cascade: Purpose → Objective (MTP) → Principles + Values → **Portfolio (carrying its Strategic Intent)** → Program → Project → Task. Since each portfolio has exactly one strategic intent, they are modeled as **one entity**: a `portfolio` page with a `strategic_intent` frontmatter block (statement, horizon, brand color) — eliminating today's duplicated Strategic-Intent-vs-Portfolio relations in Notion. Principles + Values sit in the cascade as org-level `policy` pages (the policy engine §5 is the "Principles + Values" tier made executable). Each cascade tier carries its time horizon in frontmatter, surfacing the cadence discipline the cascade diagram encodes.

**Products are on a different plane.** A product has a primary owning program/portfolio (`parent_id`), but products can cross those boundaries, and projects can be pieces of a product's development lifecycle. So in addition to the tree: `page_links` relations `project —(delivers_for)→ product` and `product —(also_serves)→ program|portfolio`, many-to-many. Rollups (funding, impact, work) follow the tree by default and can pivot to the product plane via these links.

**Tasks are universal.** A lightweight `tasks` table (title, status, assignee, due, priority, `page_id` → any parent entity, `source` = manual | meeting_action_item | agent_suggested, `source_ref`) usable by anyone as a personal/team todo list — attached to a project, meeting, product, or nothing at all ("My Tasks" view = assignee filter). This replaces the Notion Tasks DB and becomes the sink for extracted meeting action items (§12).

**Page types are a first-class controlled vocabulary** (answering "should there be page types?" — yes, and the design already keys on `pages.type`; here it's formalized). Each type gets a Zod frontmatter schema, a default template, default views, and ACL/publishing behavior:

| Type | Notes |
|---|---|
| `knowledge` | default wiki page |
| `runbook` | ops procedures; required sections validated (trigger, steps, rollback) |
| `policy` | the §5 engine; enforcement levels |
| `template` | instantiation source (JD xx.97 convention) |
| `charter` | NISO format, validated headings |
| `decision` | ADR: context/decision/consequences — the "prior decisions" record agents search first |
| `learning` | working rules + measured facts with confidence labels; institutional memory (§6) |
| `skill` | reusable procedure in agentskills.io format; runnable by platform agents and local tools (§6) |
| `meeting` | agenda + notes; linked calendar event, transcript, tasks (§12) |
| `transcript` | ingested from Zoom; immutable body, correlation frontmatter |
| `impact_story` | JD xx.96 convention; Story Bank entry with sensitivity + consent (§9.5); feeds impact models, grant reports, and publishing |
| `portfolio` `program` `project` `product` `okr` `person` `org` `grant` `fund_page` | entity narrative pages backing typed records |
| `intake` `parking_lot` | queue-shaped pages |
| `module` | one generated page per module (§14) — what it owns, depends on, and how to run it |
| `health` | per-module health surface (§18); `obligation` for compliance registry entries (§20) |

Types drive search filters, per-type list views, and reserved-JD-ID conventions (xx.96 impact stories, xx.97 templates, xx.98 meetings, xx.99 archive) — enforced at creation UI, extensible by super admin without migrations (types are data + a Zod schema registry in code).

**Whole-doc markdown at rest + CRDT sync layer (Yjs), not blocks.** Blocks (Notion's model) kill diffability and make agent writes multi-row transactions — still rejected. An earlier draft also rejected CRDTs and used optimistic-concurrency LWW, but the **offline/desktop requirement (§2.5) changes that calculus**: offline editing makes divergence normal rather than rare, and 3-way merge prompts on every reconnect would be miserable. The design:

- Each page body is a **Yjs document**; Tiptap has first-class Yjs bindings, so the same editor does realtime co-editing online and conflict-free merge after offline work. Adopted from Phase 0 — retrofitting CRDT under a live editor later would be far more expensive than starting with it.
- **Markdown stays canonical at rest**: on every sync point/idle save, the server exports the Yjs doc to markdown into `pages.body_md` + `page_versions`, so search, AI agents, exports, publishing, and the version history all see plain markdown, never CRDT binary. The Yjs state is a sync-layer artifact (snapshot + update log in Durable Object storage, compacted), not the system of record. If the CRDT layer ever had to be abandoned, the markdown corpus is complete.
- **Frontmatter is NOT CRDT-merged**: typed properties are form-edited, per-field LWW with field-level timestamps (concurrent edits to *different* fields both win; same field, latest wins, both recorded in version history). Merging YAML by CRDT invites schema-invalid garbage.
- Sync hub: **one Durable Object per active page** (y-partyserver/PartyKit patterns — Cloudflare acquired PartyKit; y-sweet is the same shape), websocket online, update-batch exchange for reconnecting offline clients. This is the real job DOs were reserved for; a page-DO is idle-evicted and costs nothing when nobody edits.

Agent writes go through `write_page` as before: the server applies them as Yjs transactions, so an agent edit merges with concurrent human edits instead of clobbering them.

### 2.4 Document revision methodology (that survives export)

Three concepts are kept deliberately distinct, because collapsing them is how document systems become untrustworthy:

- **Versions** — immutable snapshots, one per save (`page_versions`, already in the model), addressable as `slug@v37`.
- **Suggestions** — proposed changes awaiting a decision (tracked-changes mode), not yet part of the document.
- **Revision marks** — the rendering of what changed between two versions, for a reader.

```sql
page_suggestions (id, page_id, from_version, author_id, author_kind check in ('human','agent'),
   kind check in ('insert','delete','replace','comment'),
   anchor jsonb,                 -- Yjs relative position + a text-quote fallback (quote, prefix, suffix)
   payload text, rationale text,
   review_set_id fk page_review_sets,
   status check in ('draft','open','accepted','rejected','superseded'),
   resolved_by, resolved_at, created_at)
page_review_sets (id, page_id, name, opened_by, opened_at, closed_at, resulting_version)
```

Anchors are Yjs relative positions so a suggestion survives concurrent edits to the rest of the document, with a **text-quote fallback** (quoted span plus prefix/suffix context) so the same anchor still resolves against exported markdown, where Yjs positions mean nothing. **Review sets** bundle suggestions into a named unit ("Board review 2026-09-01", "Counsel redline of the Chad MOU") that is accepted or rejected as a whole, producing exactly one new version plus one audit record — which is what a policy or contract redline actually is.

**Agents suggest; they do not overwrite.** On `policy`, `charter`, `contract`, and `work_order` pages an agent's `write_page` is coerced into a suggestion set — the in-place write verb does not exist for those types, the same pattern as ledger posting and publish approval.

**Export fidelity is the requirement.** Revision state is carried through every boundary rather than lost at it:

- **Markdown** — revision marks serialize as **CriticMarkup** (`{++inserted++}`, `{--deleted--}`, `{~~old~>new~~}`, `{==highlight==}`, `{>>comment<<}`): plain text, diffable, greppable, readable in Obsidian and in the desktop app's on-disk vault (§2.5), survives git. Three export modes: `marked` (default), `accepted` (clean current text), `original` (pre-suggestion text). No proprietary blob, no CRDT binary, ever, in an exported file.
- **PDF** (§16) — three modes: *clean*; *redline* (insertions underlined, deletions struck, margin change bars, comments as numbered margin notes); and *clean + revision appendix* (a table of every change with date `YYYY-MM-DD`, actor, from→to version, and rationale). Contracts, work orders, and policies default to clean+appendix, so a document sent for signature states on its face what changed since the last executed version.
- **DOCX** — the same pipeline maps CriticMarkup to native Word tracked changes for counterparties who redline in Word; re-importing their file lands their edits as a suggestion set rather than as an overwrite.
- **CSV/JSON** — every data export carries `version`, `as_of`, and the version hash.

**Every exported artifact is citable and verifiable.** PDFs and data exports are footer-stamped `slug@v37 · exported 2026-08-24 · sha256:…`, and that hash resolves against `page_versions` — an export is evidence with a provenance chain, not a photocopy that may or may not match. This is the mechanism that lets a generated audit report (§20) or a grant attachment be traced back to exactly what the system held when it was produced.

**Diff is a first-class view**: any two versions render a word-level markdown diff (`diff-match-patch`) on screen and in PDF, including across the offline path — a field editor's reconnect produces a reviewable diff, not a mystery merge.

### 2.5 Desktop app + offline (Obsidian-like)

A **Tauri** desktop app (same TypeScript client code as the web editor; ~10MB installer, no Electron weight) for staff who want a local, installable, offline-capable workspace — with field staff in low-connectivity countries (Chad, Sudan, Vietnam) as the driving use case, not a nice-to-have.

- **Local replica, scoped to what offline makes sense for**: pages (markdown + Yjs state) and tasks sync to a local SQLite store; entity read models (directory, projects, calendar) cache read-only. **Ledger, gifts, and CRM never sync offline** — financial invariants live in Postgres and money data doesn't belong on laptops in sensitive countries; those screens require connectivity. FRED-sensitive records follow the same rule: excluded from local replicas by default, area-admin opt-in per device.
- **Selective sync** like Obsidian vaults: pick JD areas to keep locally; ACL applies at sync time (you replicate only what you can read; grant revocation purges on next connect).
- **A real markdown folder, optionally**: the app can materialize a synced "vault" of plain `.md` files (frontmatter included, one file per page) on disk — so Obsidian, Claude Code, grep, or any local tool can read and even edit the corpus; the app watches the folder and feeds edits back through the same Yjs path. This makes the "AI agents partner in everything" goal work fully offline against local files.
- **Offline task capture**: create/edit tasks offline; queued and reconciled per-field on reconnect. Drafts of anything (a grant response, a JE) can be written offline as pages; the *submission* verbs stay online-only.
- The web app gets the same sync client behind a service worker later (PWA), sharing all the code; desktop ships first because Tauri's local SQLite + filesystem make offline robust with less browser-storage fragility.

**Provenance on everything synced ⟨RW⟩.** Every read-model record and imported fact carries `provenance` (source system, source id, synced_at, sync_status): GitHub issues, calendar events, the Sage mirror during parallel run, Virtuous-imported gifts, FRED rows, Progress Bible data. The UI renders provenance and **renders the absence when a sync failed** ("Sage mirror: last synced 3d ago — 2 entries failed") instead of silently showing stale data. During the multi-year transition when four systems are being absorbed, honest data lineage is what makes the platform trustworthy rather than just convenient. `external_ids` grows into a proper alias map: every source system's name for an entity, so a Virtuous contact ID, a Stripe customer, and a Sage vendor resolve to one canonical record.

**Search:** Postgres FTS day one (GIN index, filtered by caller's readable areas); pgvector embeddings later — same DB, same backup, same ACL join.

### 2.6 Data classification & offline eligibility (enforced by the schema, not by trust)

§2.5 states which data stays online; this makes it a declared, mechanically enforced property rather than a design intention. Every table and page type carries two attributes in the Drizzle schema:

- `classification` ∈ `public` | `internal` | `restricted` | `sensitive`
- `offline_eligibility` ∈ `sync` (full local replica) | `cache_readonly` (short-TTL read cache that hard-expires offline) | `never` (must not leave the server)

| Data | Class | Offline |
|---|---|---|
| Wiki, runbooks, templates, charters, decisions, learnings, skills | internal | `sync` |
| Tasks, personal notes, drafts | internal | `sync` |
| Directory, org chart, projects/programs read models | internal | `cache_readonly` |
| Ledger, budgets, funds, journal entries, contracts, work orders, expenses | restricted (20–29) | **`never`** |
| Contacts, gifts, soft credits, giving history, donor notes | restricted (40–49) | **`never`** |
| FRED sensitive engagements, field orgs in protected countries | sensitive (60–79) | **`never`** by default; area-admin per-device opt-in with an expiry date |
| Story Bank entries above their consented level (§9.5) | per story | `never` above `internal` |
| Security incidents, access grants, audit logs | restricted | **`never`** |

Enforcement points, all server-side:

- **The sync protocol emits only what the manifest allows.** The manifest is generated from the schema, so a `never` row is not filtered by a client that could be modified or a device that could be stolen — it is never sent. A CI test fails the build when a new table or page type ships without a classification, so the default is "you must decide," not "it quietly syncs."
- **Device registry**: `devices (id, person_id, platform, replica_token, areas jsonb, last_sync_at, max_offline_days, revoked_at)`. Grant revocation purges the affected areas on next connect; a replica that has not reconnected within `max_offline_days` (default 30) seals itself — a lost laptop stops holding current data even if nobody reports it. Disk encryption is a policy precondition for registering a device.
- **Honest offline UX**: screens backed by `never` data render an explicit "requires connectivity" state offline. They never show an empty table or a stale number, because a stale trial balance is worse than no trial balance (a stale staff directory is fine — hence `cache_readonly`).
- Sensitive-record opt-in is itself audited and expires; the quarterly access review (§20) lists every device holding a sensitive-area replica.

## 3. Ledger (full design in the ledger schema, key invariants here)

Dimensions: **account × fund (GAU) × function** on every line — the ASC 958 functional-expense matrix and 990 Part IX fall directly out of GROUP BY queries. Funds carry `net_asset_class` (with/without donor restrictions), `restriction_kind`, `portfolio_page_id` (GAU↔portfolio binding), `assessment_bp` (1800 = 18%, 0 for Catalyst Partners).

Invariants enforced **in Postgres, nowhere else**:
1. Deferred constraint trigger: entries must balance to zero (functional USD, and per original currency) at commit
2. Append-only: REVOKE UPDATE/DELETE; only `draft→posted→reversed` transitions; corrections via reversing entries only
3. Period lock: posting rejects dates in closed periods; soft-close allows finance-admin adjustments only
4. Gapless entry numbering under `pg_advisory_xact_lock` — no DO needed at this volume
5. `ledger_audit` table + nightly R2 export with a SHA-256 hash chain over entries — tamper-evident history for auditors

Amounts: **integer minor units**, original currency + fx rate + functional USD. No revaluation engine v1 (verify uW holds no material non-USD balances).

**Workflows:** restriction-release entries (drafted with qualifying-expense picker, finance posts); monthly 18% assessment cron drafts one JE per assessed fund (idempotent by fund+period; expense-vs-contra-revenue treatment to be decided with the audit firm); budget-vs-actual is a single join on identical dimension keys — this kills the manual Notion reconciliation tables and the Google Sheets Rolling Budget.

**Stripe → gifts → GL:** `uw-ingest` verifies + stores raw events → queue → upsert contact → create gift → auto-post JE from a finance-approved `posting_rules` table (the one auto-posted class; nightly payout reconciliation cross-checks). Acknowledgments: Pub 1771 templates (≥$250 contemporaneous written acknowledgment, >$75 quid pro quo disclosure, intangible-religious-benefits language), January annual-statement batch, `ack_status` on every gift.

**Sage migration:** CoA/fund/function mapping from Intacct export → opening-balance import JEs tying to trial balance to the cent → **parallel run until sign-off** (automated CSV mirror of Intacct entries, monthly zero-diff trial-balance report; target 6–12 months, extending to a full audited fiscal year if the audit firm wants one) → cutover only with written audit-firm comfort.

### Contracts, MOUs & work orders (replaces the Sage WO module and Drive folders 24/25/26)

MOUs, contracts, and work orders move out of Google Drive and become native records with page bodies — the agreement text IS the markdown, versioned like everything else, with PDF as an *output* format rather than the storage format.

```sql
contracts (id, page_id, kind check in ('mou','field_contract','internal_contract','vendor_agreement'),
   counterparty_org_id fk field_orgs|contacts, jd_id,           -- 24.xx / 25.xx / 26.xx
   parent_contract_id fk contracts,                             -- MOU → contracts under it
   total_value_minor bigint, currency, starts date, ends date,
   fund_id fk, program_page_id fk,                              -- where its money lives
   status check in ('draft','in_review','executed','active','expired','terminated'))

work_orders (id, page_id, contract_id fk, wo_number text unique,
   value_minor bigint, currency, scope_summary,
   deliverables jsonb,                                          -- milestone list w/ due dates + amounts
   status check in ('draft','pm_review','cfo_review','issued','active','complete','closed','rejected'),
   pm_approved_by/at, cfo_approved_by/at)

partner_invoices (id, page_id, work_order_id fk, invoice_number, counterparty ref,
   amount_minor bigint, currency, received_at, deliverable_refs jsonb,
   status check in ('received','matched','pm_approved','finance_approved','je_drafted','paid','disputed'),
   journal_entry_id fk, paid_at)

signed_documents (id, contract_id|work_order_id, r2_key, sha256, signer_name, signed_at,
   method check in ('wet_upload','esign'), uploaded_by)
```

**Managing against full contract value** (the Sage WO feature being replaced): issuing a WO checks `SUM(issued WO values) + new WO ≤ contract.total_value` and records a **commitment** in a `commitments` table keyed to the same account×fund×function dimensions as the ledger — not a GL entry, but it appears as the "Committed" column in every budget-vs-actual view (this is what the Projects Kanban's hand-maintained Committed field becomes). Committed releases to actual as invoices post.

**Approval workflow rides the work-queue engine (§6)**: WO stages `pm_review` → `cfo_review` are queue stages with `exit_gate: human_approval`; PM approval requires editor+ on the owning program's area, CFO approval requires `admin(20-29)`. Both approvals are recorded with actor and timestamp on the WO and in the audit log. An agent validator on the review stage runs the existing 11-criteria WO compliance check automatically before a human ever looks (the uw-wo-compliance skill, productionized) — reviewers see the checklist result, then decide.

**Three-way correlation**: partner invoice arrives (email ingest or upload) → matched to its WO and deliverables → PM confirms delivery → finance approval drafts the AP journal entry (debit expense with the WO's dimensions, credit AP) → payment recorded → commitment released. Invoice-over-WO-remaining and delivery-before-WO-issued both hard-block at the DB.

**PDF output + signatures**: contract/WO pages render to branded PDFs via Cloudflare Browser Rendering (HTML→PDF, same template machinery as web publishing). Signed copies: v1 is upload-the-signed-PDF to R2 with hash + signer metadata (`signed_documents`); e-signature integration (Documenso — open-source DocuSign alternative — or DocuSign itself) is an add-on decision, not a blocker. A nightly report flags executed contracts missing signed copies and WOs active past their contract end date.

**Migration**: bulk import from Drive areas 24/25/26 — PDFs to R2, metadata extracted agent-assisted into contract records, each verified by the owning admin before the Drive folder is frozen.

### Soft credits (a first-class citizen of the gift model, not a CRM afterthought)

The legal donor and the relationship donor are frequently different people: a gift arrives from a donor-advised fund but the relationship is with the advisor; a foundation cuts the check but a trustee championed it; an employer match follows an employee's gift; a church remits a member's designated giving; a solicitor's work produced someone else's gift. Virtuous models this with soft credits, fund development runs on those numbers, and a migration that flattened them would silently destroy the org's picture of its own donor relationships. So it is in the schema from day one, next to the gift, not bolted on later.

```sql
gift_credits (id, gift_id fk, contact_id fk,
   credit_kind check in ('hard','soft'),
   soft_reason check in ('daf_advisor','foundation_trustee','employer_match','matching_campaign',
                         'solicitor','household_member','church_conduit','tribute','estate'),
   amount_minor bigint, percent_bp int, notes, created_by, created_at)

contact_relationships (from_contact_id, to_contact_id,
   kind check in ('household','employee_of','advises','trustee_of','congregant_of','spouse','assistant'),
   starts, ends)
```

Invariants, in Postgres:

1. **Exactly one `hard` credit per gift** (partial unique index) — the legal donor, the one and only party who receives the Pub 1771 substantiation.
2. Hard credit amount equals the gift amount. A gift's revenue is recognized once.
3. Soft credits **may overlap and may each equal the full gift amount** — they are not a split. A $10,000 DAF gift can soft-credit the advisor for $10,000 *and* the solicitor for $10,000; both statements are true and neither is revenue.
4. **Soft credits have zero ledger effect.** The journal entry is derived from the hard credit alone; no soft credit can create, move, or restrict a dollar. This single rule is what keeps relationship reporting expressive without ever corrupting the GL. Genuine allocation across funds is a *split on the JE*, a different concept, deliberately not modeled here.

**Every donor-facing report declares its `credit_basis`** — `hard` (financial truth; ties to the GL to the cent) or `soft_inclusive` (relationship truth; what a development officer needs to see) — and states which on its face. Giving histories, LYBUNT/SYBUNT, major-donor tiers, portfolio-of-relationships views, campaign progress, and every chart or PDF derived from them carry the label (§16/§17), so the two are never mistaken for each other in a board packet. Soft-inclusive totals summed across donors deliberately exceed contributed revenue, and the view says so rather than leaving a reader to discover it.

Acknowledgments follow the same split: the hard credit receives the tax receipt with substantiation language; soft-credited contacts receive a thank-you variant with **no tax language**, since the deduction belongs to the legal donor only (§"Gotchas", Pub 1771).

`contact_relationships` drives **suggested** soft credits at gift creation (a match arrives from an employer whose employee is a known contact; a DAF sponsor whose advisor is on file) — suggested until a human confirms, the same gate pattern as tasks and learnings.

**Migration**: Virtuous soft credits import into `gift_credits` with source IDs preserved in `external_ids`; a reconciliation report is part of cutover acceptance — hard-credit totals must equal GL contributed revenue to the cent, and no soft credit may appear in any ledger total.

### Expense reimbursement (forward the receipt; the agent does the rest; a human decides)

Today's reimbursement flow is a form somebody fills in badly, weeks late, with an allocation guessed from memory. The platform already holds everything needed to make a far better guess than the submitter can — so it makes the guess, shows its work, and asks a human to confirm.

**Intake is an email forward.** Send or forward the receipt to `expenses@` (Cloudflare Email Routing → `uw-ingest` → queue). The sender address resolves to a `people` row — that is "it knows who you are." Attachments (PDF/JPG/HEIC) land in R2 with a hash. There is no app to open and no form to fill in; Zulip (`@platform expense:` with an image) and desktop drag-and-drop are the same pipeline with a different front door.

**Extraction.** A Workflow runs vision extraction (Claude API) over the receipt: vendor, date (normalized to `YYYY-MM-DD`), amount, currency, tax, line items, payment method, and receipt-vs-invoice classification. Every field lands in an **evidence ledger** (§6) marked `observed` (legible on the receipt), `inferred` (derived from something else), or `assumed` — so the reviewer can see at a glance which numbers were read and which were guessed. Duplicate detection runs on vendor + date + amount + hash.

**Allocation, from data the platform already has** — this is the part no standalone expense tool can do, and the reason it belongs here rather than in another SaaS subscription:

- **Calendar** (§12): the submitter's calendar for that date and place → the meeting, training event, or trip → its linked project/program → fund, function, and account.
- **Areas of Responsibility**: the person × area × % records as a prior when the calendar is silent (a 60/40 split person's uncontextualized expenses propose 60/40).
- **Contracts, work orders, and grants**: a hotel during a grant-funded trip proposes that grant's fund; travel inside a work order's scope proposes the WO's dimensions and consumes its commitment.
- **History**: the same person's prior *approved* allocations for the same vendor and category — the strongest signal after a few months, and it accrues as a `learning` (§6), so the system's guesses measurably improve instead of resetting each year.
- **Policy** (§5): `resolve_policies` on the proposed entity returns the travel and expense policy — per-diem caps, receipt thresholds, disallowed categories, approval limits, mileage rates with effective dates (policy-page data, never hard-coded). Violations are flagged on the card at submission, not discovered at month-end close.

Output is a proposed allocation, possibly split across dimensions, with a confidence and a stated reason per line.

```sql
expense_reports (id, page_id, person_id, period, total_minor, currency,
   status check in ('draft','submitted','manager_review','finance_review','approved','paid','rejected'),
   submitted_at, approved_by, approved_at, journal_entry_id fk, paid_at)

expense_items (id, report_id, incurred_on date, vendor, description,
   amount_minor bigint, currency, fx_rate, functional_usd_minor bigint, category,
   account_id fk, fund_id fk, function_id fk, program_page_id fk, work_order_id fk, grant_id fk,
   allocation_confidence numeric, allocation_basis jsonb,   -- the evidence ledger, shown to the reviewer
   policy_flags jsonb, receipt_r2_key, receipt_sha256, extraction jsonb,
   status check in ('proposed','confirmed','flagged','rejected'))
```

**Humans review, in the work-queue engine** (§6). Each report is a card on the **Expense review** queue showing the receipt image, the extraction with its confidence marks, the proposed allocation with its reasons, and the policy check. The submitter confirms or corrects — one click when the guess is right, which is the whole point — then the approver (their AoR lead; finance for their own expenses) approves at a stage with `exit_gate: human_approval`.

**Ledger.** Approval drafts one journal entry (debit expense at account × fund × function, credit accrued reimbursements); **finance posts it under the normal rules — the agent drafts and can never post** (§6). Payment clears the liability and closes the item. Corporate cards run the same pipeline from the other end: the card feed creates already-paid items, receipts are matched to charges, and unmatched charges age on a report. Non-employee reimbursements (field partners) route to `partner_invoices` instead — same review shape, different rail, because those carry contract and deliverable obligations.

**Verification**: forward a real receipt and get a correctly allocated draft within minutes; a policy-violating item cannot be approved without an explicit override that is recorded; an approved report produces a balanced JE with the right dimensions; no agent identity can post it or approve it.

## 4. Auth & ACL

**Authentication vs authorization are deliberately split.** Google is the *identity provider only* (SSO); the platform owns users and ACL natively.

**Authentication:** Cloudflare Access (Google Workspace as OIDC IdP) in front of everything internal; app verifies the Access JWT per request and maps email → `people` row (auto-provisioned on first login for `@unfoldingword.org`, pending-approval for anyone else). This was compared against the alternatives:

| Option | Verdict |
|---|---|
| **Cloudflare Access + Google IdP** (chosen) | Free ≤50 users, zero auth code to maintain, MFA/session policy inherited from Workspace, service tokens for agents/webhooks built in. Adding a second IdP later (contractor without a Google account) is an Access config change, not a code change. |
| Auth libraries in-app (better-auth, Lucia-style) | Reintroduces session/token code the platform would own forever; Access already does this at the edge |
| SaaS IdPs (WorkOS, Auth0, Clerk) | Per-user pricing for a problem Access solves free; another vendor |
| Self-hosted IdP (Keycloak, Authentik, Zitadel) | A server to run, patch, and back up — violates the serverless/ops-minimal constraint |

**Authorization: native, not Google Groups.** The earlier draft synced roles from Google Groups; on reflection that makes Workspace admin an invisible, out-of-band authz console (flagged as risk #4). Instead the platform manages ACL itself: a grants admin UI (super-admin and per-area admin can grant within their scope), every grant change audit-logged and versioned like everything else, quarterly access-review report generated from the grants table. A **one-time bootstrap import** from Google Groups seeds initial grants; after that, groups remain what they're good at (email lists, Drive sharing) and the platform is the single authority for its own permissions.

**Three roles, applied at any scope** — `role_grants (person_id, role ∈ admin|editor|viewer, scope_kind ∈ org|jd_area, scope_area, granted_by, granted_at, expires_at?)`. Time-boxed grants (`expires_at`) cover contractors and temporary elevation.

- `admin(scope)` — full control within scope: pages, templates, policies, publish approvals; org-scope admin = super admin
- `editor(scope)` — create/edit pages and records in scope; read org-wide (open-Notion culture default)
- `viewer(scope)` — read within scope

There is deliberately no separate finance/fund-dev role: **JD areas already encode those domains** (20–29 Finance, 40–49 Engage Benefactors), so `admin(20-29)` is the finance admin (only role that posts JEs, closes periods, sees GL detail), `editor(40-49)` is the fund-dev team (contacts/gifts/grants/acknowledgments), etc. Domain-sensitive data follows its area: ledger tables belong to areas 20–29, CRM to 40–49, and the query layer scopes them exactly like pages. Two refinements ride on top: (1) gift amounts, giving history, and GL detail are excluded from org-wide read — visible only with a 20-29/40-49 grant as appropriate; (2) the FRED sensitivity filter (§9) restricts flagged field records to 60–79 grant-holders.

One `can(actor, verb, resource)` function. Finance/CRM behind separate route groups AND query-layer filters — two independent checks. **The principal travels with every request ⟨RW⟩**: a structured principal (person or agent id + resolved grants) is minted at the edge and passed through every internal call, queue message, and MCP invocation, so redaction happens at the data layer — a query simply cannot return rows the principal can't see, rather than hoping the UI hides them. No entity-subtree ACLs: a page's JD area is its scope, matching how Drive/Zulip already work.

## 5. Policy Hierarchy

Policies are pages with frontmatter: `policy_level (org|portfolio|program|project|product)`, `enforcement (required|default|template)`, `applies_to`, `attached_to`, `supersedes`, `effective`. Resolution walks the parent tree, most-specific-first; `required` at a higher level cannot be overridden below; `default` yields to descendant supersedes. Templates are **copied** (not referenced) into new products with `instantiated_from` + version — obligations never silently change; a drift report makes template updates deliberate. NISO charters are validated page templates so they stay machine-parseable. MCP tool `resolve_policies(entity_id)` returns the resolved ordered set for agents to load before acting.

## 6. AI Agent Integration

Remote MCP server inside `uw-app` (Streamable HTTP): `search_pages`, `read_page`, `write_page` (same validation path as UI), `query_entities` (whitelisted parameterized queries, never raw SQL), `resolve_policies`, `create_task`, `create_draft_journal_entry`, role-gated `list_gifts`, plus the work-queue tools below. Agents have their own identities + Access service tokens, grants always ≤ their owner's; every write records `agent:<id>` in version history and ledger audit. **Agents can never post a JE, send donor email, or approve a publish — those verbs don't exist as tools.**

### Agent work queues (native feature)

AI participation in real work — drafting proposals, building product pages, writing grant responses, triaging intake — is modeled as **kanban boards whose stages have machine-readable controls**, not ad-hoc prompting:

```sql
work_queues (id, name, jd_area, board_page_id)
queue_stages (id, queue_id, name, position, wip_limit,
   agent_pickup check in ('none','allowed','auto'),   -- who may pull work in this stage
   exit_gate check in ('none','checks','human_approval'),
   instructions_page_id)                              -- per-stage brief agents load before working
queue_items (id, queue_id, stage_id, title, page_id,  -- the card wraps a page/entity (proposal draft, product page, intake item)
   claimed_by, claimant_kind check in ('human','agent'), lease_expires,
   priority, due, history jsonb)
queue_subscriptions (agent_id, queue_id, filter jsonb, active)
```

Mechanics:
- **Subscribe & pick up**: agents subscribe to queues; when an item enters an `agent_pickup: allowed|auto` stage, subscribed agents are notified (MCP `poll_queue` / webhook trigger to an external runner). Claiming takes a **lease** (`claimed_by` + `lease_expires`) so two agents never grab the same card; expired leases auto-release. `auto` stages dispatch to the best-matching subscribed agent without waiting.
- **Work happens through the same page API**: the agent reads the card's page, `resolve_policies` for its entity, the stage's instructions page, and relevant context (linked grant, product, transcript), then writes its deliverable as page drafts/versions attached to the card.
- **Stage exit gates are enforced server-side**: an agent finishing work can only move the card to the next stage if `exit_gate: none`; `checks` runs validators (schema, required sections, lint); `human_approval` parks the card in review — the advance verb simply isn't available to agents, same principle as ledger posting. Every transition logs actor, kind, and evidence.
- **WIP limits apply to agents too** — lean flow control (§13) governs machine workers the same as humans.

Canonical queues at launch: **Grant responses** (RFP arrives → intake → agent drafts against the funder template using uw-grant-writing-style workflow → human review → submit), **Product content** (define/update product page → agent drafts from template + policies → review → publish request), **Intake triage** (contact/voicemail/parking lot → agent classifies, links, suggests owner → human confirms), **Correlation review** (§12 low-confidence links). New queues are configuration, not code.

### Institutional memory ⟨RW⟩ (the company that compounds vs. the company that re-learns)

Richwood's "MemGrid" idea, adapted: institutional memory as queryable infrastructure, not scattered prose. Built from primitives the plan already has — `decision` (ADR) pages and policies — plus one new type: **`learning`** pages (working rules and measured facts: "the vendor quirk that cost a week," "the assessment treatment the auditor approved," "why this table is shaped this way") with frontmatter for `confidence` (observed | confirmed | inferred | assumed), `as_of` date, `supersedes`, and a contradiction flag set when a newer learning conflicts with an older one that hasn't been retired. Mechanics:

- `resolve_policies` grows into `resolve_context(entity_id)`: policies + applicable decisions + learnings, ordered and labeled — **every agent session reads it before acting and is expected to write durable learnings back** (as `suggested` learnings a human confirms, same gate pattern as tasks)
- Stale-confidence report: `assumed`/`inferred` learnings past their review date surface for confirmation or retirement — confidence decays instead of fossilizing
- A lesson paid for once is filed once: post-mortems, audit findings, and pivots land as learnings linked to the decision they modify

### Agent personas with jobs, and evidence ledgers ⟨RW⟩

Two refinements to the work-queue design:

- **Guided discovery instead of vague tickets**: an intake persona interviews the requester in plain questions ("I need…" → structured requirements) and writes an **evidence ledger** as it goes — every entry marked `observed / confirmed / inferred / assumed / unknown`. A planning pass turns the ledger into a scoped card; integrity checks reconcile what the persona *says* against what the records actually hold. This is unfoldingWord's evidence-first discipline made mechanical, and it slots straight into the intake-triage and grant-response queues (a grant draft whose claims are all marked `confirmed` with sources is reviewable in minutes).
- **Personas are configuration**: a persona = an agent identity + a queue subscription + an instructions page + a toolset — new ones are data, not code.

### Borrowed patterns: Open Agents ⟨OA⟩ and Hermes ⟨H⟩

Two more agent systems reviewed for the AI layer — Vercel Labs' **Open Agents** (cloud coding agents on durable workflows) and Nous Research's **Hermes** (MIT-licensed self-hosted persistent agent). Neither is adopted wholesale (Open Agents is Vercel-infrastructure-native; Hermes is a single-user agent, not a multi-tenant platform), but four patterns transfer:

- **Durable agent runs ⟨OA⟩**: every queue-item claim executes as a Cloudflare Workflow — checkpointed steps (read context → work → write drafts → submit to gate), automatic retry from the failed step, resumable across deploys, and **per-run cost/token attribution** recorded on the queue item so each board shows what its automation actually costs. Long waits (a human approval gate) hibernate the run instead of holding compute.
- **Explorer/executor split ⟨OA⟩**: agent work on nontrivial cards runs a cheap scout pass first (verify the card's premise against current data/code, gather context, estimate scope) before the build pass — the same premise-verification our parallel-lane doctrine (§8) requires, now explicit in the run shape. Dev-factory lanes get sandbox-per-task with a git branch, auto-committed work, and cached diffs for review.
- **Self-documenting skills ⟨H⟩**: procedures agents figure out the hard way become reusable **skill pages** — `skill` joins the page-type registry, authored in the **agentskills.io open standard format** so the same skill files work in Claude Code, Hermes, or any compliant runner (including against the desktop app's local markdown vault, fully offline). Skills complement institutional memory: learnings are *facts*, skills are *procedures*. An agent finishing a novel queue item drafts a skill the same way it drafts learnings — `suggested` until a human confirms. Per-stage queue instructions pages are themselves skills.
- **Conversation continuity across channels ⟨H⟩**: Hermes' "start on Telegram, pick it up in your terminal" maps to our stack as: an agent conversation is keyed to its entity/queue item, not to the channel — start a thread with the platform bot in Zulip, continue it in the web app or against the MCP server, same session context. The Zulip gateway (§12) is the first channel; the design leaves the session keyed so others are additive.

### Cloudflare OS alignment

Cloudflare just open-sourced **Cloudflare OS** (blog.cloudflare.com/cloudflare-os/): an agent workspace (browser-based, isolated runtimes, org-context skills), **Gatekeepers** (service-specific Workers mediating agent access with fine-grained scopes), observation tracking (what data an agent touched constrains where its output can flow), per-team model/cost budgets via AI Gateway, and agent-built mini-apps on Dynamic Workers/Durable Object Facets with per-app SQLite. Position for this project:

- **It is not the platform** — its per-app SQLite silos are the opposite of the unified-dataset goal, and it has no ledger/CRM/wiki. The Postgres core stays as designed.
- **It is a strong candidate for the agent-execution layer**: instead of building bespoke agent runners, workers subscribed to our queues can *live* in Cloudflare OS workspaces, reaching the platform only through our MCP server — which then functions exactly as a Gatekeeper in their architecture. Its skills library is where per-queue/per-stage instructions can be mounted for non-technical staff to run agents.
- **Adopt immediately regardless**: AI Gateway for model routing + per-agent/per-queue cost budgets; the Gatekeeper pattern validates the "verbs don't exist" security design already in this plan.
- **Maturity caveat**: announced days ago, roadmap items (managed dashboard, container support) not yet GA — track it during Phases 0–2, evaluate adoption for the agent layer at Phase 4.5 rather than taking a day-one dependency.

## 7. Website Publishing

Cloudflare-native static publish; **do not push to WordPress** (second content model, PHP surface — the opposite of surface minimization). Freeze WP for legacy paths, route new paths to `uw-www` at the zone, retire WP ≤12 months. Flow: `publish: requested` → area-admin approval task → queue renders markdown→HTML (brand template: Inspire/Ocean/Tech palette) → R2 + KV cache → `publish_log` records exactly which page version is public. Signed preview URLs behind Access before approval.

## 8. GitHub / Dev Management (ZenHub replacement)

GitHub App webhooks → read-model tables (`gh_repos/issues/prs/milestones`); GitHub stays source of truth for issue content; nightly sweep repairs webhook gaps. Platform adds `sprints`, `epics`, `issue_links` (issue↔sprint/epic/project/product) via label/`uw:PROJ-slug` convention. Boards, burndowns, epic rollups = queries over the read model. Write-back limited to link labels + cross-reference comments.

### How the platform's own software gets built ⟨RW⟩ (doctrine, written down and enforced)

Since AI agents write most of this system — including its ledger — the development discipline is part of the architecture, not a habit:

- **Staged SDLC with risk tiers**: scope → plan → build → check → ship → validate → close, followed by humans and agents alike; the risk tier (a ledger trigger vs. a page-view tweak) decides how much review a change earns
- **Reviewer harness**: every substantial change is reviewed by independent AI reviewers — different models, different lenses (correctness, security) — that argue with the code until findings are **fixed or refuted with evidence, never ignored**; the last word is never theirs: only a human approves and merges. Ledger and ACL changes always take the full harness plus the sponsor
- **Mechanical gates**: a PR declares what it closes, what it risks, and what collateral it touched — automation refuses PRs that don't; a gate you can't check mechanically isn't a gate
- **Parallel agent lanes**: concurrent work runs in isolated worktrees, and each lane verifies its issue's premise against current code before building — the codebase moves faster than the backlog, and a wrong thing built correctly is still wrong
- **Evidence over confidence**: claims carry their verification path; a closed issue is a claim to verify, not a fact to trust; practices live as ADR/learning pages synced into the repo so every session — human or agent — starts from the same law

## 9. FRED — Field Reporting & Engagement Data

Inspected live (MariaDB via MCP): 469 language engagements, 216 training events, 61 organizations, 2,661 translation products, plus imported reference datasets (Progress Bible: ~27,800 projects / 7,422 languages; Joshua Project). Small data — migrates into the platform Postgres trivially.

**Key finding: FRED has its own `portfolios` (6) and `programs` (26) tables — a third parallel program taxonomy alongside Notion's Program Portfolio and the Grant DB's select field.** Unification is the whole point: FRED's programs/portfolios are replaced by relations to the platform's program/portfolio pages, making the impact rollup a pure join:

> training_event / language_engagement → program → portfolio → fund (GAU) → grants/gifts → donors

That single chain answers "who funded what, and what happened" — the report that today requires manually stitching FRED + Notion + Virtuous + Sage.

**Data model** (native tables, each pointing at a page for narrative like other records):
- `language_engagements` (country, ietf language, translation org, sensitivity, population, cluster) + `engagement_orgs` junction (role) + `engagement_notes` (the metadata/communication log)
- `training_events` (date, category, country, org, participant counts, man-hours) — gains a proper FK to platform projects (today's Notion "Google Training Event ID" string key goes away)
- `translation_products` (FRED's per-language products; distinct from the ~37-item Product Catalog — keep the names distinct: "products" = catalog, "translation outputs" = FRED's)
- `field_orgs` (partner organizations with sensitivity, CBBT spectrum, org type) — merge candidates with CRM `contacts`/organizations; keep separate tables, link where the same real-world org appears in both
- Reference imports (`pb_language_data`, `pb_all_translation_projects`, `joshua_project_data`, IETF codes, bible_info) stay refresh-on-schedule read-only tables — a queue-driven import job replaces whatever feeds FRED today
- FRED's RFP/foundation tables (`foundations`, `rfp_programs`, `rfp_milestones`, `rfp_reports`, `rfp_report_responses`) are **empty** (0 rows in `rfp_programs`) — that workflow evidently moved elsewhere; the platform's grants module supersedes them, and the foundation-question-set → quarterly-response structure is worth preserving as the grant-reporting model.

**Sensitivity is an ACL dimension FRED forces us to handle:** engagements/orgs carry `sensitivity` values and protected-country flags. Rule: sensitive field records are readable only by `member(60-79 areas)` + field-program admins + super admin; sensitive engagement details never flow into published web pages or org-wide dashboards (aggregates only). This is a per-record filter layered on the JD-area check — the one place the simple area model gets a refinement, and it's justified by real safety concerns for field partners.

**Impact models per portfolio.** FRED already computes an org-wide impact run-log (`impact_model_metrics`: case studies, white papers, open apps/components, PR counts, translated products, OBS completions, engagement counts — snapshotted per run with status/errors). The platform generalizes this to **one impact model per portfolio**:

- `impact_models (id, portfolio_page_id, page_id)` — the model itself is a page (narrative theory of change) plus structured metric definitions
- `impact_metrics (id, impact_model_id, key, name, definition_sql_ref, unit, direction, target)` — each metric is a whitelisted, versioned query over platform data (training events, engagements, translation outputs, published products, stories)
- `impact_snapshots (metric_id, as_of, value, run_id, status)` — nightly cron evaluates all metrics, appends time series; failures logged per metric like FRED's status/error columns

Because engagements/events/products now relate to programs→portfolios→funds natively, each portfolio's impact dashboard sits beside its budget-vs-actual and its grants — impact, money, and work on one page, which is the grant-report generator's data source (the uw-grant-reporting workflow reads promised-vs-delivered straight from here).

**Migration**: Phase 1.5 (after pages/entities, before CRM) — schema-mapped import from MariaDB, FRED frozen read-only after verification, ufw.io/fred URL redirected to the platform's field-data views. Existing FRED MCP query patterns get re-exposed through the platform MCP server so agent workflows (AAG lookups, country briefs) keep working.

### 9.5 Story Bank (impact stories with release permissions built in)

The `impact_story` page type becomes a real **Story Bank**: one searchable corpus of field narrative, where every story carries its own permission to be told, and the system — not an editor's memory — decides where it may appear. Reserved JD ID `xx.96` (Impact Stories) stays as the story's home, so today's Notion convention survives the migration intact.

**Sensitivity is an ordered ladder, and it is a permission, not a label.** Each level implies everything below it:

| Level | May appear in |
|---|---|
| `internal` | staff views inside the platform only — never leaves |
| `private_circulation` | named partners/donors: `/private` pages behind Access or a signed link, board packets, one-to-one funder communication |
| `newsletter` | supporter mailings, printed reports, closed-list publications — published, but not indexable |
| `public` | open internet, indexed, quotable by press |

The publish pipeline (§7), the newsletter/report generators, and the grant-report assembler all read the story's level and **refuse** to render it into a channel above it. The check is a server-side query filter on a column, not an editorial habit — the failure mode this exists to prevent is a well-meaning communications draft putting a named field worker in a protected country onto the public web. Downgrading (`public` → `internal`) is always allowed and triggers an unpublish sweep across every channel the story reached; upgrading requires the area admin plus a recorded consent reference.

**Consent and safety are fields, not folklore**: `consent_ref` (who granted permission, when, in what form — link to the signed release in R2), `consent_expires`, `subject_anonymized`, `name_use` (`real | pseudonym | none`), `location_precision` (`country | region | none`), `photo_release` (tracked separately from the text release), and `review_by`. A story about work in a sensitive country inherits its engagement's sensitivity as a **ceiling** — a story can never be more public than the field record it describes, enforced by the same filter as §9's sensitivity rule. Media in R2 carries its own level, so a story can be `public` while a photograph in it stays `internal`.

**Tagging is relational, not free text.** Stories link to `country` (ISO 3166-1), `region`, and `language` (IETF tag) — and, the part that free-tagging always loses, to `program`, `portfolio`, `project`, `product`, `grant`, and `training_event` pages via `page_links` with rel `illustrates`. That is what makes a story findable at the moment it is actually needed: the grant-report generator for Portfolio X pulls every consented, appropriately-levelled story illustrating X's programs within the reporting period, automatically — narrative sitting beside the numbers from the same portfolio's impact model, which is the whole argument for keeping stories inside the platform rather than in a shared drive. Free-form `themes` tags (first-scripture, perseverance, women-translators) stay available on top for editorial angles; they are additive and never the join key.

```sql
-- frontmatter-backed record fields on impact_story pages
stories (page_id, sensitivity, consent_ref, consent_expires, subject_anonymized,
         name_use, location_precision, photo_release, review_by,
         country, region, language_tag, collected_on date, collected_by)
story_usages (story_id, channel check in ('newsletter','grant_report','web','board_packet','social','print'),
              artifact_ref, used_on date, audience_note)
```

**Lifecycle.** Stories arrive through the intake queue — email from the field, `@platform story:` in Zulip, trip reports, meeting-transcript extraction (§12). An agent drafts the structure and proposes tags, entity links, and themes (suggested); a human confirms consent and sets the level. **A story is created at `internal` and is not publishable until a human has recorded consent and set a level** — there is no path where a default makes something public.

`story_usages` records every newsletter, grant report, web page, and board packet a story appeared in — so the same story is not sent to the same funder twice, so communications can see what is over-used, and so a **consent withdrawal can be traced to everywhere the story landed** and retracted deliberately rather than hoped about.

## 10. Language Choice: TypeScript vs Rust

Both run on Workers; Rust compiles to WASM via `workers-rs`. With AI agents writing the code, build cost is discounted for both — the comparison is about everything else:

| Dimension | TypeScript | Rust (workers-rs/WASM) |
|---|---|---|
| Workers support | First-class; every CF feature ships JS-first (Queues, DO, MCP helpers, Hyperdrive examples) | Supported but second-class; API gaps lag months behind; smaller community when stuck |
| Ecosystem fit | Everything this platform needs exists validated: Tiptap, Drizzle, Zod, Stripe SDK, Octokit, googleapis, unified/remark | No equivalents for editor/serialization; Stripe/Google/GitHub crates are community-grade; you'd write more from scratch — opposite of the reuse goal |
| The UI problem | One language everywhere — editor, SSR, API, MCP | The Tiptap/ProseMirror editor is unavoidably JS. Rust backend = permanent two-language codebase, two toolchains, duplicated types across a serialization boundary |
| Correctness | Weaker (null/undefined, structural typing); mitigated by strict mode + Zod at boundaries + **invariants living in Postgres, not app code** | Genuinely better: exhaustive matching, no null, ownership — real value for ledger logic |
| Runtime perf | More than sufficient; workload is I/O-bound CRUD at 50-user scale | Faster CPU, but nothing here is CPU-bound; WASM adds bundle-size/cold-start cost and 128MB memory limit applies equally |
| AI-agent effectiveness | Largest training corpus of any language; agents are measurably strongest here; instant iteration (no compile step in dev loop) | Agents are good but corpus is thinner, especially for workers-rs; borrow-checker fights slow agent iteration loops |
| Bus factor | Any TS contractor + agent can maintain; huge hiring pool | Sharply smaller pool of Rust+Workers maintainers — the worst property for a bus-factor-1 org |

**Decision: TypeScript everywhere.** The strongest Rust argument — compiler-enforced correctness for the ledger — is deliberately neutralized by this design: balance, append-only, period-lock, and numbering invariants are enforced by Postgres triggers/constraints, so they hold no matter what language (or agent) talks to the database. App-level correctness is covered by strict TS + Zod + property-based tests. If a genuinely CPU-bound, pure-logic component ever emerges (it shouldn't), it can be added as a single WASM module without re-platforming.

## 11. Open-Source Reuse Policy

Rule: **buy validated feature sets from the OSS ecosystem; write only the integration and the domain logic that is uniquely ours.** Concrete picks (all MIT/Apache/BSD unless noted):

| Need | Package | Status |
|---|---|---|
| HTTP framework | Hono | de facto Workers standard |
| ORM/migrations | Drizzle | plain-SQL migrations, schema-as-code |
| Validation | Zod | single schema → validation + types + forms |
| WYSIWYG↔Markdown | Tiptap (MIT core) on ProseMirror; `prosemirror-markdown` serializer | the validated Notion-style editing stack |
| CRDT sync | Yjs + y-partyserver/PartyKit (Cloudflare-acquired) on Durable Objects | realtime collab + offline merge; markdown stays canonical |
| Desktop shell | Tauri | ~10MB installers, same TS client code, local SQLite + filesystem vault |
| Markdown pipeline | unified/remark/rehype | parsing, frontmatter, wiki-link plugins, HTML render — battle-tested |
| Diff/merge | `diff-match-patch` / `node-diff3` | 3-way markdown merge for LWW conflicts |
| Property-based testing | fast-check | ledger invariant tests |
| Stripe, GitHub, Google | official `stripe`, `octokit`, `googleapis` SDKs | vendor-maintained |
| Email templates | react-email (or MJML) | Pub 1771 acknowledgments, annual statements |
| Notion export | official Notion SDK + `notion-to-md` | one-time migration |
| MCP server | official `@modelcontextprotocol/sdk` + Cloudflare's `agents` helpers | |
| Tables/boards UI | TanStack Table | kanban/sprint/CRM views |
| Chat | Zulip (existing instance) | integrated via REST API/bots, never rebuilt |
| E-signature (optional) | Documenso | open-source DocuSign alternative; v1 tracks uploaded signed PDFs instead |
| Skill format | agentskills.io open standard | platform skills portable to Claude Code, Hermes (MIT), and other compliant runners |
| Transcription fallback | OpenAI Whisper (OSS) | if Zoom native transcripts underperform |
| Charts | **Chart.js 4.x** (ported from the sister dashboards), Observable Plot for exploratory views | already vendored + SRI-verified in Budget Report / Revenue Projection / team-charts (§17) |
| PDF rendering | Cloudflare Browser Rendering (headless Chromium) | one HTML→PDF pipeline for contracts, reports, board packets (§16) |
| DOCX in/out | `docx` + `mammoth` | CriticMarkup ↔ Word tracked changes for counterparty redlines (§2.4) |
| Revision marks | CriticMarkup convention | plain-text tracked changes that survive export, grep, git, and Obsidian |
| Receipt/invoice extraction | Claude API vision | expense receipts and partner invoices (§3) |
| Logs & metrics | Workers Analytics Engine + Logpush | native to the stack, no extra vendor (§18) |
| Error tracking | Sentry (SaaS or self-hosted) | release-tagged exceptions |
| Email intake | Cloudflare Email Routing → Worker | receipts to `expenses@`, invoices, story submissions |

**Where OSS does not save us:** there is no production-grade, serverless-Postgres-compatible OSS fund-accounting ledger. TigerBeetle (excellent OSS ledger DB) and Formance are self-hosted services — violates the serverless constraint; Medici is MongoDB; ERP suites (ERPNext, Odoo CE) are the monoliths this project exists to avoid. We therefore borrow the *patterns* (pgledger-style Postgres ledger design, Modern Treasury's published ledger docs) but own the ~15 tables and triggers ourselves — they are small, testable, and the part auditors examine anyway.

**Reciprocity**: uW already runs open infrastructure (Door43, DCS/Gitea). Building this platform as a public open-source repo (secrets/config out-of-band) fits the org's mission, aids audit transparency, and is the strongest bus-factor mitigation available: any future maintainer can read everything.

## 12. Communications, Meetings & Auto-Correlation

### Zulip: integrate, don't rebuild

Zulip stays. It is open source, already loved, and its topic-per-conversation model is exactly the persistence the org values — rebuilding chat would be the single largest avoidable scope addition to this project, and a homegrown messenger would be worse than Zulip for years. Instead, deep integration via Zulip's REST API + outgoing webhooks (each JD area already maps to a Zulip folder, so the join key exists):

- **Entity ↔ topic linking**: every program/project/product/meeting page gets a `zulip_topic` frontmatter link; one click from page to conversation and back (a bot posts the page URL when a topic is first linked)
- **Outbound notifications**: platform events (publish approved, JE posted, task assigned, intake item created, sprint started) post to the right area channel/topic via bot — replacing email noise
- **Inbound capture**: a `@platform` bot in Zulip lets anyone file a task, intake item, or parking-lot idea from chat (`@platform task: …` in a topic auto-links the created task to the topic's linked entity)
- **Selective archive, not full mirror**: messages flagged by the bot (decision marker, action item) are captured into the linked page's activity log; the full firehose is NOT mirrored — Zulip remains the system of record for conversation, searchable in Zulip

### Zoom meetings, transcripts, recordings

Zoom webhooks (`recording.completed`, `meeting.ended`) → `uw-ingest` → queue: recording video/audio → R2 (`uw-files`), transcript → a `transcript` page (immutable body, speaker-labeled markdown), both linked to the meeting. If Zoom's native transcript is poor, run Whisper (open source) on the audio as a fallback job.

### Google Calendar

Two-way where safe, one-way where not: a sync job (Calendar API, service account) mirrors relevant calendars into a `calendar_events` read model keyed by Google event ID (the key Projects Kanban already uses for training events). Creating a `meeting` page can create the Calendar event (organizer = creator); edits in Google win (Google is source of truth for scheduling). Training-event pages link to their calendar events natively, replacing the string-ID field.

### The correlation engine (the point of all this)

Manual correlation is the pain; the platform automates it as a queue-driven pipeline over every ingested artifact (transcript, recording, calendar event, flagged Zulip message):

1. **Deterministic joins first**: Zoom meeting UUID ↔ Calendar event (Zoom link in event body) ↔ `meeting` page (linked event ID) ↔ its agenda, attendees (email match to `people`), and the entity the meeting page belongs to (its `parent_id`/JD area). Recurring meetings inherit their series' entity link. No AI needed for the common case — the graph already connects.
2. **AI-assisted linking second**: for unmatched artifacts, an extraction job (Claude API) reads the transcript against the entity index (FTS over portfolios/programs/projects/products) and proposes links with confidence scores. High confidence → auto-link, logged with `edit_source: agent`; low confidence → a review queue item on the area's dashboard. Evidence-first rule: every auto-link records *why* (matched title, attendees, explicit mentions).
3. **Action-item extraction**: the same job extracts action items (owner, task, due-if-stated) into `tasks` with `source: meeting_action_item`, `source_ref: transcript page + line anchor`, status `suggested` until the owner or meeting organizer confirms with one click — extracted todos never silently become commitments.
4. **Meeting page assembly**: after the pipeline, a meeting page shows agenda, calendar details, attendees, recording link, transcript link, decisions, confirmed + suggested tasks — assembled automatically, editable by humans.

## 13. Lean Program & Product Management (principles baked in, not bolted on)

Lean is enforced through the same policy/template machinery rather than as tooling exhortation:

- **Visualize flow + limit WIP**: every board (projects, sprints, intake, grants pipeline) is a kanban with per-column WIP limits configurable per area; cumulative-flow and cycle-time charts come free from status-change history (`page_versions` already timestamps every transition)
- **Small batches / pull**: sprint layer (§8) supports pull-based flow; the Parking Lot → intake → project pipeline makes demand visible before commitment
- **Validated learning on products**: the product template carries hypothesis/experiment sections (extending NISO's Need/Idea with expected-evidence fields); `decision` pages record pivots with their evidence — matching the org's evidence-first discipline
- **Outcome over output**: OKRs and impact-model metrics (§9) are the measures boards roll up to; output counts (issues closed) stay on dev dashboards, never on portfolio ones
- **Waste made visible**: stale-page reports (no edits + no views in N days), blocked-task aging, template-drift reports, and the review queues are all standard saved views
- Lean defaults ship as **org-level `default` policies** (WIP limits, definition-of-done, canvas-before-commitment) so areas inherit them but can consciously supersede — the policy engine is the enforcement mechanism

## 14. Modules — what the system is made of, and what you can turn on

A platform this wide is unusable as one undifferentiated mass, both for the humans who have to understand it and for the rollout that has to happen one piece at a time. So **module** is a real construct, not a documentation convenience: a named, documented, independently enable-able slice that owns its tables, page types, routes, MCP tools, queues, crons, policies, and permissions.

```ts
// packages/core/modules.ts — declared in code, rendered as a page in the platform
module: { key, name, summary, jd_areas[], depends_on[], tables[], page_types[],
          routes[], mcp_tools[], queues[], crons[],
          data_classification, offline_eligibility, status: 'core' | 'standard' | 'optional' }
```

| Module | Key | Depends on | Owns |
|---|---|---|---|
| Core | `core` | — | pages, versions, revisions/suggestions, search, JD registry, ACL, policy engine, tasks, files |
| Strategy | `strategy` | core | cascade entities (purpose → portfolio → program → project), OKRs, NISO charters |
| Directory | `directory` | core | people, organizations, Areas of Responsibility |
| Agents | `agents` | core | MCP surface, work queues, personas, institutional memory, skills |
| Ledger | `ledger` | core, directory | GL, funds, functions, budgets, periods, assessments |
| Contracts | `contracts` | ledger | MOU/contract/WO, commitments, partner invoices, signatures |
| Expenses | `expenses` | ledger | reimbursements, corporate cards, receipt intake |
| CRM & Giving | `crm` | core, directory | contacts, gifts, soft credits, Stripe, acknowledgments |
| Grants | `grants` | crm, strategy | pipeline, funder templates, grant reporting |
| Field Data (FRED) | `field` | strategy | engagements, training events, translation outputs, field orgs, reference imports |
| Impact | `impact` | field, strategy | impact models, metric definitions, snapshots |
| Story Bank | `stories` | core | impact stories, consent, sensitivity, usage tracking |
| Publishing | `publish` | core | render pipeline, `uw-www`, web templates |
| Documents | `docs_out` | core | PDF/DOCX rendering, letterhead, document sets (§16) |
| Charts | `charts` | core | chart specs, renderers, standard chart library (§17) |
| Dev | `dev` | core | GitHub read model, sprints, epics, boards |
| Comms | `comms` | core | Zulip, Zoom, Calendar, correlation engine |
| Desktop & Offline | `offline` | core | sync protocol, local replica, markdown vault |
| Observability | `observe` | core | §18 |
| Infrastructure | `infra` | core | §19 |
| Compliance | `compliance` | ledger, core | §20 |

**Rules that make modules real rather than decorative:**

- A module may only depend on modules it declares, and cross-module access goes through a published interface — a typed service function or an MCP tool — **never a direct join into another module's tables**. A CI check over the schema and import graph enforces it. Without this, "modules" degrade into folder names within six months.
- Disabling a module removes its routes, tools, nav entries, and crons, and its API returns a clear "module not enabled" rather than a 500. Enabling is per-scope, not only global: `module_enablements (module_key, scope_kind ∈ org|jd_area, scope_area, pilot bool, enabled_by, enabled_at)` — so Story Bank can pilot with one team and Expenses can run for finance before the whole org.
- Every module ships four things or it is not done: a **runbook page**, a **data-export path**, its **verification steps**, and its **classification/offline declaration** (§2.6).

**Why this earns its own section, twice over.** For humans: "what is this system?" is answered by twenty short module pages generated from the registry, not by reading this document. For rollout and for the open-source release (§11): modules are the unit of adoption. Another organization can take `core + strategy + stories` and never stand up a ledger; someone who wants only the fund-accounting GL can take `core + ledger + compliance`. A platform that can only be adopted whole will not be adopted.

## 15. Johnny.Decimal ↔ Strategic Cascade — the two axes, mapped

The organization is organized twice, on purpose, and the two schemes answer different questions. Conflating them is the root cause of the relation debt the Notion research found, and explaining the difference clearly is most of what an outside adopter needs from this project.

- **Johnny.Decimal (00–99)** — the **functional** axis: *where a thing lives*. Stable, addressable, mirrored in Notion teamspaces, Google shared drives, and Zulip folders. It answers "where do I file this, and where do I look for it." It changes rarely; a renumber is an org restructure.
- **Strategic Cascade** — the **strategic/impact** axis: *why a thing exists*. Purpose → Objective (MTP) → Principles + Values → Portfolio (Strategic Intent) → Program → Project → Task. It answers "what outcome does this serve." It is *supposed* to change every planning cycle.

Neither is derivable from the other, and neither is a parent of the other. **Every entity carries both coordinates**: `jd_area`/`jd_id` for function, and a position in the cascade tree (`parent_id`) for strategy. A project files into one area and serves one program, and those are different facts.

The relationship between the two is many-to-many and **explicit**, never implied:

```sql
jd_cascade_map (jd_area, cascade_page_id,
   relation check in ('owns','supports','funds','reports_on'), note)
```

A portfolio typically *owns* one or two areas and is *supported* by several — Finance (20–29) supports every portfolio; the field areas (60–79) are owned by the portfolios whose programs run there; Engage Benefactors (40–49) *funds* across all of them.

**The crosswalk is a real screen**, not a diagram in a slide deck: a matrix with areas down and cascade tiers across, cells carrying counts — pages, active projects, committed and actual spend, stories, impact metrics — and clicking through in both directions. "Show me everything in Finance" and "show me everything serving the Church-Centric Bible Translation intent" become the same query with a different pivot.

Consequences already latent in this plan, now stated plainly:

- **Access rides the functional axis** (§4): grants are per JD area, because permission follows job function, not strategy. This is why there is no separate finance role.
- **Money and outcomes ride the strategic axis** (§3, §9): rollups follow project → program → portfolio → fund (GAU) → grants/gifts.
- **Reporting joins them**: a portfolio's budget-vs-actual is a strategic rollup whose approvals and postings are functional. The join is the `jd_cascade_map`, which is why it is a table and not a convention.

**The failure mode this prevents** is already visible in today's systems: when only one axis is modeled, the other gets smuggled in as duplicated select fields — precisely the Portfolio-select-duplicated-on-Programs-and-Projects debt and the grant database's parallel program taxonomy. Two named axes plus one explicit map is the fix, and Phase 1's import is where the debt gets paid off rather than carried forward.

**For adopters.** This section is what makes the model portable. An organization with no filing scheme runs the cascade alone with a single default area; one with a filing scheme but no strategy runs the reverse; most will want both and should declare the map deliberately as a setup step, with a worksheet template shipped alongside (list your areas, list your strategic tiers, declare each relation). Getting this wrong is the most common way an "operating system for the organization" collapses back into a filing cabinet with opinions.

## 16. PDF export & document rendering (first-class, everywhere)

**Every page and every view exports to PDF.** Not a feature added to the three screens where somebody asked: one rendering service and one route convention — `?format=pdf` on any page, entity, list view, board, dashboard, or report — available wherever the caller can already read the data. The export runs **the same query as the screen** under the same ACL, so there is no parallel reporting path to drift out of agreement with the UI.

- **Mechanics**: Cloudflare **Browser Rendering** (headless Chromium) renders the platform's own HTML through a print stylesheet. One pipeline for contracts, work orders, grant reports, board packets, letterhead correspondence, budget-vs-actual, impact dashboards, and ordinary wiki pages. No second templating system, no LaTeX, no library assembling boxes by hand.
- **Print CSS is part of the design system from Phase 0**, not retrofitted: `@page` sizes and margins, running headers carrying the unfoldingWord letterhead (Inspire/Ocean/Tech palette, brand logo asset), page numbering, `break-inside: avoid` on cards and table rows, table headers repeating across page breaks, links footnoted as URLs, dark mode neutralized. The sister dashboards already ship print stylesheets for board hand-offs — that precedent transfers directly.
- **Provenance footer on every PDF**: source page or view, `slug@version`, the exact filters/parameters used, exported-by, exported-on (`YYYY-MM-DD`), and a sha256 resolving back to the underlying version (§2.4). A PDF in a board packet or an audit binder is therefore traceable to the state that produced it, which is what makes generated compliance artifacts (§20) defensible.
- **Revision modes** per §2.4 — clean, redline, or clean + revision appendix; contracts, work orders, and policies default to clean+appendix.
- **Charts render as vector** (§17), never as raster screenshots of a dashboard.
- **Async and batch**: large reports render through a Workflow and land in R2 behind a signed URL instead of blocking a request. **Document sets** compose many pages into one PDF with a cover, table of contents, and continuous pagination — the board packet, the grant report with appendices, the audit binder, the quarterly portfolio review.
- **Scheduled output**: month-end financial statements, the quarterly board packet, annual donor statements, and the compliance artifacts of §20 are cron- or queue-driven, archived to R2 with retention, and logged like a publish.
- **`render_pdf(target, options)` is an MCP tool**, so an agent can produce a sendable deliverable — under the same ACL, with the same footer, and with no ability to send it anywhere itself.
- **PDF is an output, never a record.** Markdown plus typed records remain the system of record platform-wide; §3 states this for agreements and it holds everywhere. The only PDFs that are records are counterparty-signed documents, which are stored with hash and signer metadata precisely because they came from outside.

## 17. Charting & data visualization (first-class, and largely already built)

Charts are a **platform primitive**: a declarative `chart` spec (type, whitelisted query reference, encodings, formatting, palette) that any page, dashboard, report, or PDF embeds, and that any agent can produce through MCP. Not per-screen bespoke code, which is how a system ends up with nine subtly different definitions of "actual spend."

**Prior art to port, not re-derive.** Three sister projects have already solved most of this for unfoldingWord, and their patterns transfer directly:

- **`../Budget Report`** — Chart.js 4.4.1 dashboards over the Rolling Budget, an overview-dashboard spec, a print stylesheet for board and meeting hand-offs, and the stale-while-revalidate load pattern (paint the cached payload instantly, refresh behind it).
- **`../Revenue Projection`** — the pipeline-vs-trend framing where two lenses are *never summed*, confidence-tiered KPI callouts, probability-weighted forecasting, and cumulative actual→projection lines against a prior-year reference.
- **`../team-charts`** — shared chart scaffolding in a single include (status bar, load watchdog, PNG export, print CSS, pan/zoom, sortable roster), a force-directed relationship graph, and the discipline of rendering a **data-quality report beside every chart**: ambiguous entries are omitted and reported, never guessed.

Their chart configurations, brand styling, and helpers are ported into `packages/charts` in Phase 1; the dashboards themselves are re-hosted as platform views and their Apps Script deployments retired once the underlying data lives here. **Chart.js 4.x is the default renderer** on that precedent (already vendored with SRI-verified integrity in those projects, so it works with no CDN dependency); Observable Plot remains the option for exploratory and statistical views.

**Standard chart library shipped with the platform**, because these recur everywhere and each deserves exactly one definition: budget vs. committed vs. actual by period; cumulative revenue actual→projection with prior-year reference; the functional-expense matrix (account × function); fund balances over time; grant pipeline by confidence tier; donor retention and LYBUNT/SYBUNT cohorts (labelled with their `credit_basis`, §3); sprint burndown, cumulative flow, and cycle-time charts straight off `page_versions` history (§13); impact-metric time series (§9); engagement and training coverage by country and language; and org/relationship graphs.

- **Every chart states its lineage**: source query, as-of timestamp, filters, and a data-quality note whenever rows were excluded or unresolved — the team-charts rule, generalized. A chart whose upstream sync failed **renders the absence** (§2 provenance) rather than a silently truncated series.
- **One palette, one set of formatting rules**, shared by screen, PDF, and published web: Inspire `#31ADE3`, Ocean `#014263`, Tech `#231F20`, Cultivate `#70C9CC`, Kindle `#E59D33` used sparingly; colorblind-safe ordering; `YYYY-MM-DD` axis labels (§0); money formatted from integer minor units by one shared helper.
- **Export everywhere**: PNG and SVG per chart, vector into PDF (§16), and **the underlying data as CSV beside every chart** — a chart nobody can check is a claim without evidence, which fails the org's own standard.
- **Honesty and accessibility**: every chart ships a table view of its own data; axes start at zero for magnitude comparisons or state why not; dual-axis charts are off by default.
- **`render_chart(spec)` is an MCP tool** returning SVG/PNG plus the data table, so an agent drafting a grant report or board memo produces a real, checkable chart instead of a paragraph describing one.

## 18. Observability

A one-maintainer platform has to notice its own breakage before a person does, and "is the system healthy?" has to be a page anyone can open. Observability spans four planes, tied together by a trace id that propagates from the edge through queue messages and Workflow steps — so a single id follows a Stripe webhook all the way to a posted journal entry.

1. **Technical.** Workers Analytics Engine + Logpush carrying structured JSON for every request, queue message, Workflow step, and cron (trace id, principal, route, latency, outcome); Neon and Hyperdrive query statistics; Durable Object and websocket health for the sync layer; error tracking with release tagging; DLQ depth and age.
2. **Data.** Freshness and completeness for every synced source — Sage mirror, Stripe, GitHub, Calendar, Zoom, Zulip, Progress Bible refresh: last successful sync, lag, failure count, row deltas. These feed the provenance surfaces in §2, so staleness appears **in the UI where the data is used**, not only on a dashboard nobody opens. Domain checks live here too: trial balance equals zero, draft-JE aging, unreconciled Stripe payouts, commitments exceeding contract value, period-close readiness, unallocated expense items.
3. **Agent.** Every agent run records model, tokens, cost, duration, tools called, rows read, writes made, gates encountered, and outcome — per run, per persona, per queue, per month. Budgets and alerts per persona and queue through AI Gateway, with a **circuit breaker** rather than a surprise invoice; each board displays what its own automation costs (§6).
4. **Human and process.** Adoption and flow: active users per module (§14), stale pages, aging blocked tasks, review-queue depth, WIP-limit breaches, unresolved suggestion sets, unconfirmed action items. This plane is what reveals that a module was rolled out and then quietly abandoned — the most likely failure of the whole project, and invisible to the other three.

**SLOs, and alerts on symptoms only**: donation flow (webhook → gift → acknowledgment) success rate and latency; page save and sync success; publish pipeline success; nightly backup completion; correlation-pipeline latency. Alerts route to the right Zulip channel (§12) and **every alert must name the runbook page that resolves it** — an alert without a runbook is a defect in the alert, not a fact of life.

`health` is a page type and `/health` is a real screen: green/amber/red per module, each indicator clicking through to the query behind it. The same data is exposed as MCP `get_health(module?)` so an agent triaging a card can see the state of the system it is working against — an agent that cannot tell "the data is stale" from "the number is low" will confidently draw the wrong conclusion.

**Access and audit logging are separate from operational logging** and retained far longer (§20): who read which donor record, who changed a grant, who exported what to PDF. Read-access logging is on for finance, CRM, and sensitive field data (§9) — not for the general wiki, where it would be surveillance without a purpose.

Retention: full-fidelity logs 30 days, aggregated metrics 13 months (so year-over-year comparisons work), audit trails 7 years in object-locked R2 alongside the ledger exports.

**Verification**: deliberately break a sync and confirm the affected screens say so within their stated window; a synthetic test-mode donation runs hourly end-to-end and alerts if any step fails; an agent cost spike trips its breaker in test.

## 19. Infrastructure management & self-stewardship

The layer that looks after the architecture itself — and, within firm limits, proposes its own improvements.

**Everything is declared; nothing is clicked.** Infrastructure as code in the monorepo: `wrangler.toml` per Worker, Neon branches and roles, R2 buckets with lifecycle and object-lock settings, Cloudflare Access applications and policies, DNS, queues, crons, AI Gateway configuration. A **drift detector** runs nightly against the live Cloudflare and Neon APIs and opens a card when reality diverges from the repo — a fix applied in a dashboard at 11pm and forgotten is the single most common failure mode for a one-person platform, and it is exactly the class of thing that survives until an audit finds it.

**Backup and restore as a verified property, not an intention:**

- **Continuous**: Neon point-in-time recovery with an explicit retention window; nightly logical dumps; a nightly markdown + CSV corpus export; the hash-chained ledger export (§3) — all to `uw-backups` (object-locked, 7-year retention).
- **Off-provider copy**: a weekly encrypted copy to a second provider, so an account-level failure at Cloudflare or Neon is survivable. This is vendor risk and bus-factor mitigation in one line item.
- **Restore drills are automated and scored**: a quarterly cron-triggered, human-observed restore into a fresh Neon branch runs the trial balance, row-count comparisons, and hash verification, then writes the result as a page with an explicit pass/fail. **A drill that has not run in 100 days turns the infrastructure health indicator red.** The annual drill is executed by *someone other than the sponsor*, from written runbooks — that is the only real test of risk #2, and the report of it goes to the board.

**Lifecycle stewardship**, all of it scheduled and surfaced rather than remembered: dependency and CVE scanning with a stated remediation window per severity; Cloudflare and Neon deprecation and changelog monitoring; a **secret inventory with rotation dates and expiry alarms** (Stripe keys, Access service tokens, Notion/Zoom/Zulip tokens, agent credentials); certificate and domain expiry; and cost tracking against the $25–60/month envelope with an alert on deviation, since unexplained cost is usually a bug.

**Capacity and schema hygiene**: table growth and index bloat, slow-query digest, unused-index report, deployed-schema versus migration-history check, Yjs snapshot compaction, R2 object counts and orphan sweeps.

**An infrastructure steward persona** (§6) subscribes to an `infra` queue. It reads drift, dependency, cost, capacity, and health signals and **proposes work as cards with evidence**: a PR bumping a dependency, a migration adding a missing index, a runbook update after an incident, a card when a backup was skipped or a drill is overdue. It obeys the same law as every other agent — it can open pull requests and draft runbooks, and it **cannot** apply a migration to production, rotate a secret, change an Access policy, delete a backup, or modify object-lock settings. Those verbs do not exist in its toolset. The system iterating on itself is a *proposal loop with a human gate*, never autonomy over its own foundations; a platform whose agents can rewrite their own guardrails has no guardrails.

**Change management** (§8 doctrine applied to infrastructure): every production change is a merged PR carrying a plan, a rollback, and a risk tier; migrations are reviewed as plain SQL; ledger, ACL, and infrastructure changes always take the full reviewer harness plus the sponsor. Incidents produce a `decision` or `learning` page, and a repeated incident produces a runbook — the loop by which the platform gets better at operating itself.

**Environments**: production, staging (main), and branch-per-PR Neon databases. **No manual production data edits, ever** — a correction is a migration or a reversing entry, and both leave a record.

## 20. Automated audit & compliance reporting

Compliance obligations become **scheduled, versioned report definitions with owners and due dates**, not a calendar reminder and an annual scramble. A registry drives everything:

```sql
compliance_obligations (id, page_id, obligation, authority, scope, frequency, due_rule,
   owner_person_id, report_definition_ref, evidence_query_ref,
   last_run_at, last_result, next_due, status)
```

Every row produces an artifact on schedule — a PDF (§16) plus its machine-readable data — archived to R2 under retention, with the provenance footer and a sha256. A dashboard shows what is due, what ran, and what failed.

**Financial and regulatory** (the risk register's legal obligations, mechanized):

- **Form 990-ready exports**: Part IX functional-expense matrix (natural × function), net asset classes with and without donor restrictions, and program-service accomplishment sections drawn from portfolio impact models (§9) and consented Story Bank entries (§9.5).
- **ASC 958 statements** — financial position, activities, functional expenses, cash flows — as a `GROUP BY` over account × fund × function, produced **monthly** rather than only at year end, so the first time anyone sees them is not during the audit.
- **The audit binder, generated**: trial balance, GL detail, journal-entry listing with actor and evidence, hash-chain verification, bank and Stripe reconciliations, restricted-fund release schedules, assessment calculations, the contracts and WO register with signed-copy status, and grant compliance schedules — one PDF set plus a CSV/JSON package, reproducible for any period at any time. This also satisfies Rev. Proc. 98-25 machine-readable retention with the same artifacts.
- **State charitable-solicitation registration tracker**: the 39 states + DC with their thresholds, revenue-by-state computed from gift addresses, filing and renewal dates with alarms, and a flag the moment a threshold is crossed (CA $2M, NY $1M, PA $750K, MA/CT $500K, RI $300K). The same monitor watches federal award revenue against the single-audit threshold.
- **Pub 1771 substantiation report**: every gift ≥$250 with acknowledgment status, date sent, and language variant; >$75 quid-pro-quo disclosures; **exceptions listed rather than a clean bill assumed**. The January annual-statement batch reconciles to the GL, and soft credits are excluded from substantiation by construction (§3).
- **Grant compliance**: per-grant promised-versus-delivered (§9), restricted spend within period, the report-submission calendar, and a variance flag when spend or milestones drift from award terms.

**Governance and internal control** — the part small organizations almost never have, and the part an auditor will scrutinize hardest precisely because the GL is homegrown:

- **Quarterly access review** (§4): every grant with its scope, granter, age, expiry, and last use, plus a sign-off page; expired and never-used grants listed for revocation; devices holding sensitive-area replicas listed (§2.6).
- **Segregation-of-duties report**: who can both request and approve; work orders approved by their requester; journal entries posted by their drafter; self-approved expenses. Surfaced **continuously**, not sampled annually.
- **Policy attestation**: which required policies (§5) each person has acknowledged, at which version, and where instantiated templates have drifted from their source.
- **Retention and destruction**: what is due for destruction under the schedule, what is under legal hold, what is object-locked and therefore cannot be destroyed.
- **Data-subject requests** (GDPR; Colorado if that threshold is ever crossed): export and erasure as scripted, logged runbooks implementing the ledger rule — anonymize the contact, keep the financial entry.
- **Change and incident evidence**: production changes with approvals, restore-drill results (§19), and incident learnings — the IT general controls evidence an audit of a custom accounting system will ask for.

**How they are produced.** Each obligation's report is a versioned definition built from the **same whitelisted parameterized queries the screens use** — no shadow reporting path that can quietly disagree with the application. A Workflow renders it on schedule; PDF and data land in R2. An agent may **assemble, narrate, and flag anomalies in** a report; a human signs it; **nothing is auto-filed with any authority, ever**.

**Evidence-first by construction**: every figure in a generated report clicks through (or, in PDF, references by stable anchor) to the query and the source records behind it. That traceability is the entire argument for a homegrown general ledger surviving its first audit (risk #1) — and it is dramatically cheaper to build into Phase 3 than to reconstruct under deadline in Phase 5.

## 21. Phasing (6–12 months to full cutover on the fast path, up to ~24 if the auditors want a full parallel fiscal year — the calendar is dominated by the parallel run, not build time)

**The compatibility-output rule ⟨RW⟩ — retirement is a gradient, not a weekend migration.** Where the plan says a legacy system goes "read-only," the stronger pattern is: once the platform becomes system of record for a domain, writes to the old tool become *emissions from our own state* — the old system keeps receiving a faithful copy until the last person stops looking at it, and retirement is measured by who still needs the copy. Applied here: after Virtuous cutover, a nightly export keeps a Virtuous-shaped CSV archive current until fund development signs off; after GL cutover, Sage-shaped trial-balance exports continue through the first post-cutover audit; the Notion freeze stays a freeze (its content is fully absorbed, nothing new lands there). This inverts cleanly from the parallel-run phase, where the direction is mirrored the other way (legacy → platform).

| Phase | Scope | Effort | Parallel-run |
|---|---|---|---|
| 0 Foundation | Repo, CI/CD, staging, Cloudflare Access + native ACL with grants UI (Groups bootstrap import), pages/versions/FTS, JD registry, Yjs-backed editor with per-page DO sync hub; **conventions enforced from commit one** (§0 dates, minor units, lint gates), **revision/suggestion layer + CriticMarkup export** (§2.4), **module registry + data-classification declarations with their CI gates** (§14, §2.6), print-CSS + PDF service skeleton (§16), observability and IaC/backup baseline (§18, §19) | 9–11 wks | — |
| 1 Notion replacement | Typed entities on the Strategic Cascade spine (portfolios+intents unified, programs, projects, products with cross-plane links, OKRs, directory, AoR, grants, intake, parking lot), universal tasks, page-type registry, Notion API export→markdown import preserving JD + fixing relation debt, **`jd_cascade_map` + crosswalk view** (§15), policy engine (lean defaults as org policies), NISO templates, MCP v1 + agent work queues v1 (intake triage, grant responses), **`packages/charts` seeded by porting the three sister dashboards** (§17), **PDF export live on every page and view** (§16), **Story Bank with consent + sensitivity** (§9.5) | 13–15 wks | Notion read-only after import verification |
| 1.5 FRED merge | Engagements, training events, translation outputs, field orgs, reference-data import jobs; sensitivity ACL filter; re-expose FRED query patterns via platform MCP; program taxonomy unified | 4–5 wks | FRED read-only after verification; ufw.io/fred redirected |
| 2 CRM + giving | Contacts, **soft credits + contact relationships with the hard/soft-basis reporting split** (§3), Stripe Checkout + webhooks, gifts, Pub 1771 acknowledgments, Virtuous import (IDs and soft credits preserved, reconciled to the cent) | 7–9 wks | Virtuous read-only 3–6 mo |
| 2.5 Desktop & offline | Tauri app, local SQLite replica (pages + tasks, selective sync by JD area), offline reconciliation, optional on-disk markdown vault for Obsidian/local-tool interop (overlaps Phase 3) | 6–8 wks | Field-staff pilot in one low-connectivity program before org rollout |
| 3 General ledger | Full ledger, budgets, Intacct mirror import, assessment/release workflows, hash-chained R2 dumps; contracts/MOU/WO module with commitments, PM→CFO approval gates, partner-invoice matching, PDF + signed-copy tracking, Drive 24/25/26 import; **expense reimbursement (email intake → extraction → allocation → review → drafted JE)** (§3); **compliance obligation registry + generated ASC 958 / 990 / audit-binder artifacts** (§20) | 17–21 wks build + **parallel run until sign-off (6–12 mo target)** | Intacct remains system of record until CFO + auditor sign-off (a full audited fiscal year if the firm requires it); Sage WO module retired at same cutover; Drive contract folders frozen after import verification |
| 4 Publish + GitHub | Publish pipeline, GitHub App + sprint layer with WIP-limited boards (overlaps Phase 3 wait) | 5–6 wks | WP frozen; ZenHub off after first in-platform sprint |
| 4.5 Comms & correlation | Zulip bot + entity↔topic linking, Zoom ingest (recordings→R2, transcripts→pages), Calendar sync, correlation engine + action-item extraction, impact-model snapshots, correlation-review queue; evaluate Cloudflare OS as agent-execution layer (overlaps Phase 3 wait) | 6–8 wks | Zulip/Zoom/Calendar all remain systems of record — integration, not replacement |
| 5 GL cutover | Audit-firm review, opening balances, Intacct decommission, restore-drill signoff | 3–4 wks | — |

**Observability (§18) and infrastructure management (§19) are not phases.** They ship incrementally with every phase and are a completion criterion for each: a module is not done until its health indicators, runbook, backup coverage, and export path exist. Compliance reporting (§20) is scaffolded in Phase 0 as a registry and populated as each domain lands, so Phase 5's audit review reads generated artifacts that have been running for months rather than a report written for the occasion.

## Gotchas, Legal & Risk Register

**Legal: building your own accounting system is legal.** No law mandates particular software; obligations attach to records and outputs:
- **IRS Rev. Proc. 98-25**: machine-readable records retained for the limitations period, full audit trail from source doc to return figure, hardcopy on request — a design requirement, met by the append-only ledger + R2 exports.
- **GAAP/ASC 958 (ASU 2016-14)**: two net asset classes on the face of statements; functional expense reporting (natural × function) for all nonprofits; liquidity disclosures; four statements. Met natively by the three-dimension line model.
- **Form 990**: functional breakdowns (Part IX), net asset classes, written document-retention policy (Part VI Q14 is public). CPA firm will want 990-mapped exports — ship as saved report definitions.
- **State audit thresholds** apply where you *solicit* (a national donate button generally counts): CA $2M, NY $1M, PA $750K, MA/CT $500K, RI $300K. 39 states + DC require charitable solicitation registration. Federal single audit at ~$1M in federal awards (verify current threshold with CPA).
- **Pub 1771 receipts**: ≥$250 contemporaneous written acknowledgment; >$75 quid pro quo disclosure (penalties on the org); intangible-religious-benefits language relevant for uW.
- **PCI**: Stripe Checkout/hosted Elements → SAQ A / SAQ A-EP; store only Stripe tokens. PCI DSS 4.0 still requires payment-page script integrity controls.
- **Privacy**: CCPA exempts nonprofits; **Colorado does not** (100K+ CO residents threshold — likely not met, but build data-subject export/delete anyway); **GDPR has no nonprofit exception** — a global org soliciting internationally should assume it applies. Right-to-erasure vs append-only ledger resolves by anonymizing the contact record while keeping the financial entry.
- **Retention**: 7 years standard for financial records, permanent for governing docs → object-locked R2 exports.

**Top risks:**
1. **Homegrown GL vs audit acceptance (highest).** Engage the audit firm at Phase 3 *design* time. Hash-chained exports + monthly zero-diff parallel run for as long as the audit firm requires. No cutover without written auditor comfort. First audit on custom GL will cost more.
2. **Bus factor = 1.** Everything exportable by design (nightly markdown + CSV to R2, mirrored somewhere others can reach); ADRs/runbooks live as pages in the system itself; boring stack any TS contractor + AI agent can maintain; annual "the builder is unavailable" restore drill run by someone else; board-level risk acknowledgment.
3. **Self-lock-in inversion.** Commercial systems have importers; nothing imports from a custom schema. Documented export path per entity from day one.
4. **Access drift** — permissions rot as people change roles. ACL is native and audit-logged (§4); time-boxed grants for contractors; quarterly access-review report; grant changes touching finance areas notify super admins.
5. **Parallel-run fatigue** — Intacct mirror is an automated import job, not re-keying; manual burden scoped to monthly reconciliation review.
6. **Backup theater** — quarterly scripted restore drill (dump → fresh Neon branch → trial balance matches), logged as a page.
7. **CRDT sync layer complexity** — Yjs + per-page DOs is the most intricate subsystem outside the ledger. Contained by design: markdown remains the complete system of record (the CRDT layer could be ripped out and the corpus survives intact), frontmatter is excluded from CRDT merge, Yjs/Tiptap/PartyKit are widely deployed OSS rather than homegrown, and snapshot compaction + export are covered by property tests (offline edit → reconnect → exported markdown contains both writers' changes).
8. **Local replicas on devices** — laptops in sensitive countries hold synced content. Mitigations: ledger/CRM/donor data never syncs offline; FRED-sensitive records excluded by default; selective sync by JD area with ACL enforced at sync time; revocation purges on next connect; OS-level disk encryption required by policy for the desktop app.
9. **Story-Bank consent failure** — a field story published above its consented level is a safety incident, not an editorial mistake. Mitigations: level is a column enforced server-side in the publish path, stories inherit their engagement's sensitivity as a hard ceiling, default on creation is `internal`, `story_usages` makes a consent withdrawal traceable to every place the story landed (§9.5).
10. **Module sprawl / dependency rot** — modules that quietly join into each other's tables stop being modules within months. Mitigated by the CI check over the schema and import graph, and by the rule that a module ships a runbook, an export path, verification steps, and a classification or it is not done (§14).
11. **Automation that hides its own failure** — generated compliance reports and agent-drafted allocations are more dangerous when wrong than absent. Mitigated by evidence ledgers on every proposal, provenance footers and click-through on every figure, rendering absence rather than stale data, and the standing rule that agents assemble and narrate while humans sign (§18, §20).
12. **Ledger-correctness pitfalls to never violate**: integer minor units (no floats); no UPDATE/DELETE on posted entries; balance enforced at the DB; balances computed from the journal, never mutable balance columns; fund/function dimensions native from day one, never bolted on.

## Repo Skeleton (greenfield, under this directory)

- `packages/db/schema.ts` — Drizzle schema (pages, versions, ledger, CRM, ACL) — single source of truth
- `packages/db/migrations/…` — incl. hand-written SQL for ledger triggers (balance, append-only, period lock, gapless numbering)
- `packages/core/acl.ts` — the `can(actor, verb, resource)` function + role definitions
- `apps/uw-app/` — Hono monolith (UI, API, MCP, queue consumer, crons)
- `apps/uw-ingest/` — Stripe/GitHub webhook verification + enqueue
- `apps/uw-www/` — public site server
- `apps/uw-desktop/` — Tauri shell around the shared editor/sync client
- `packages/editor/` — shared Tiptap + Yjs editor and sync client (used by uw-app islands and uw-desktop), incl. the suggestion/revision layer and CriticMarkup serializer (§2.4)
- `packages/core/modules.ts` — the module registry (§14): dependencies, tables, routes, tools, classification
- `packages/core/dates.ts` — the single `formatDate`/`parseDate` pair; everything else is banned by lint (§0)
- `packages/charts/` — chart specs, standard chart library, brand palette, SVG/PNG/CSV export (§17), seeded by porting `../Budget Report`, `../Revenue Projection`, `../team-charts`
- `packages/docs/` — print stylesheets, letterhead templates, PDF/DOCX rendering + document sets (§16)
- `packages/compliance/` — obligation registry, report definitions, evidence queries (§20)
- `infra/` — wrangler configs, Access policies, R2 lifecycle/object-lock, Neon branches, drift detector (§19)

## Verification

- **Phase 0 (conventions & modules)**: a PR introducing a `toLocaleDateString` call or a table without a `classification` fails CI; every date rendered anywhere in the app reads `YYYY-MM-DD`; disabling a module removes its routes, nav, and crons and its API returns "module not enabled" rather than an error.
- **Phase 0**: log in via Cloudflare Access with a Google account; create/edit/version a page; grant and revoke a role in the grants UI and confirm the change takes effect immediately and appears in the audit log.
- **Phase 0 (revisions & export)**: open a suggestion set on a policy page, accept it, and confirm one new version plus one audit record; export the same page as marked markdown (CriticMarkup round-trips through a plain text editor), as a redline PDF with change bars, and as clean + revision appendix; verify the PDF footer's sha256 resolves to the stated version; an agent's write to a `policy` page lands as a suggestion, never as an edit.
- **Phase 0 (PDF & offline classification)**: `?format=pdf` works on an arbitrary page, list view, and dashboard, and a viewer who cannot read the data cannot export it either; the sync manifest generated from the schema contains no `restricted` financial or CRM table, verified by test rather than inspection.
- **Phase 1**: import Notion export; spot-check 20 pages across areas against live Notion; confirm relation integrity (every project's portfolio derived via its program, not a duplicate select).
- **Phase 1 (two axes)**: the crosswalk matrix renders areas × cascade tiers with live counts, and the same project is reachable from both its JD area and its portfolio; no entity carries a duplicated portfolio select field after import.
- **Phase 1 (charts)**: a ported budget-vs-actual chart in the platform reproduces the Budget Report dashboard's figures for the same period; every chart offers PNG, SVG, and CSV of its own data and states its as-of timestamp; breaking an upstream sync makes the chart show the staleness instead of a short series; a chart embedded in a PDF is vector, not raster.
- **Phase 1 (Story Bank)**: a story marked `newsletter` cannot be rendered to a public URL by any path including the MCP tools; a story linked to a sensitive engagement cannot be raised above that engagement's level; a grant report for a portfolio pulls only consented, appropriately-levelled stories from the right period; withdrawing consent lists every prior usage.
- **Phase 1 (queues)**: drop a test RFP into the grant-response queue → a subscribed agent claims it (lease visible on the board), drafts into the funder template, and the card lands in human review — the agent cannot advance it past the gate; two agents polling simultaneously never double-claim.
- **Phase 1.5**: row counts and spot-checks match live FRED (469 engagements, 216 training events, 2,661 translation products at time of research); an impact-rollup query (training events → program → portfolio) returns the same numbers as FRED's current reports; a sensitive engagement is invisible to a non-field member account.
- **Phase 2**: Stripe test-mode donation → contact + gift + posted JE + acknowledgment email within a minute; reconciliation cron matches test payouts.
- **Phase 2 (soft credits)**: a DAF gift soft-credited at full value to both advisor and solicitor leaves contributed revenue unchanged in the GL; the hard-credit report ties to the ledger to the cent while the soft-inclusive report deliberately exceeds it and says so on its face; only the hard-credit contact receives substantiation language; the Virtuous import reconciliation shows zero soft credits creating revenue.
- **Phase 2.5**: two clients edit the same page, one offline in airplane mode → on reconnect both sets of changes appear with no conflict prompt and the exported markdown contains both; a sensitive FRED record never appears in a local replica without the opt-in; revoking an area grant purges that area from the device on next connect; open the local vault folder in Obsidian, edit a file, and see the change sync back.
- **Phase 3 (contracts/WO)**: issue a test WO exceeding its contract's remaining value → hard-blocked; a compliant WO flows draft → PM approval → CFO approval with both recorded; the compliance agent's 11-criteria checklist appears on the review card; a matched partner invoice drafts the AP entry with the WO's dimensions and releases the commitment; budget view shows budget vs committed vs actual on one row; WO PDF renders on letterhead and an uploaded signed copy stores with hash + signer.
- **Phase 3 (expenses)**: forward a real receipt from a staff email address and get a draft with correct vendor, `YYYY-MM-DD` date, amount, and a program allocation derived from that day's calendar entry, each field marked observed/inferred/assumed; a per-diem over policy cannot be approved without a recorded override; approval produces a balanced JE with the right account × fund × function; no agent identity can post or approve it.
- **Phase 3 (compliance)**: generate the audit binder for a closed month unattended and confirm every figure clicks through to its source records; the segregation-of-duties report catches a deliberately planted self-approved work order; the state-threshold monitor fires on seeded revenue.
- **Phase 3**: property-based ledger tests green; attempt UPDATE on posted line fails at DB; monthly trial-balance diff vs Intacct = $0.00; restore drill from R2 dump reproduces trial balance.
- **Phase 4**: approve a product page → public URL serves rendered HTML; publish_log matches served version; GitHub issue with `uw:` link appears on sprint board.
- **Ongoing (observability & infrastructure)**: break a sync deliberately and see the affected screens say so within the stated window; the hourly synthetic donation alerts on failure with a runbook link attached; an agent exceeding its queue budget trips its breaker; a change made directly in the Cloudflare dashboard appears as a drift card the next morning; the quarterly restore drill reproduces the trial balance and writes a pass/fail page, and skipping one turns the infra indicator red; the annual drill is completed by someone other than the sponsor from the written runbook alone.
- **Phase 4.5**: hold a real Zoom meeting on a linked calendar event → within minutes the meeting page shows recording, transcript, and suggested tasks with correct owners; confirm one task and it appears in the owner's My Tasks; a `@platform task:` message in Zulip creates a task linked to the topic's entity; portfolio impact dashboard shows nightly snapshot series.
