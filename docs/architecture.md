# Architecture

How the unfoldingWord Platform is built and why it holds together. Part 1 describes what runs today and is checked against the code. Part 2 describes the shape planned for what does not exist yet.

This document covers structure only. What the platform does for people is in [`PRD.md`](PRD.md). Why a choice was made, and what was rejected, is in [`decisions.md`](decisions.md), cited here as "ADR NNNN". The words are defined in [`CONTEXT.md`](../CONTEXT.md). The rules for changing the repository, and the release procedure, are in [`AGENTS.md`](../AGENTS.md). How each environment is set up is in [`infra/README.md`](../infra/README.md).

One rule for this document: it does not restate a list or a count that the code holds. Where a set is closed (verbs, events, tables, engines, page types, ports, dependency rules), the file that holds it is named, and that file is the truth.

# Part 1. What runs today

## 1. Topology

Two Cloudflare Workers, one Postgres database, one sign-in.

| Piece | What it is | Declared in |
|---|---|---|
| `uw-platform` | The internal Worker: server-rendered screens and islands (Hono), the command API, the MCP surface, the live hub, hosted runs, the queue consumer and the crons | `infra/uw-platform/wrangler.toml` |
| `uw-ingest` | The public Worker: verifies a webhook's signature, records the delivery and puts it on a queue. Nothing else. It has no Cloudflare Access in front and never touches the kernel | `infra/uw-ingest/wrangler.toml` |
| Postgres | AWS Aurora, reached from both Workers through Cloudflare Hyperdrive (binding `HYPERDRIVE`) over a Cloudflare Tunnel and a Workers VPC service | `infra/README.md` |
| Sign-in | Cloudflare Access. Two applications on the `uw-platform` host with separate audiences: the app, and `/mcp` | `infra/access/uw-platform.json` |
| Queue | One ingest queue from `uw-ingest` to `uw-platform`, with a dead-letter queue | both wrangler files |
| Durable Objects | `HarnessHub` (live updates, one per harness), `PageDraft` (a shared editing draft, one per page version), and the two sandbox container classes | `apps/uw-platform/index.ts` exports them |
| Cloudflare Workflows | `HarnessRun` (a hosted agent run) and `PdfExportRun` (a binder export) | `apps/uw-platform/runs/workflow.ts`, `apps/uw-platform/pdf/workflow.ts` |
| Containers | One image per sandbox engine, with the internet off and all outbound HTTP routed through the Worker | `infra/containers/` |
| R2 | The `FILES` bucket: page files and finished PDF exports | wrangler |
| Browser rendering | The `BROWSER` binding prints PDFs | wrangler |
| AWS KMS | Wraps the data key of every stored credential. Called with a signed `fetch`; its IAM policy is `infra/aws/credentials-kms.json` | `apps/uw-platform/credentials/kms/aws.ts` |
| AI Gateway | Every model call goes through it; it is also where spend is read | `apps/uw-platform/engines/gateway/spend.ts` |
| GitHub Apps | The platform's App and the Builder and Reviewer Apps | `infra/github/` |
| Crons | A minute job and a nightly job | wrangler `triggers`, `apps/uw-platform/cron/registry.ts` |

**Environments.** `staging` and `production` carry every binding above. `preview` is the per-pull-request Worker: it has the database, the hub, page drafts and the staging files bucket, and no queue, cron, Cloudflare Workflow, container or browser binding, so anything that needs one answers `not_wired` there. A caller always answers `not_wired` for a missing binding; it never throws.

**Declared, never clicked.** Everything in the table is a file under `infra/`, and tests under `tools/infra/` and `tools/ci/` hold those files to the rules (which bindings each environment has, that the two wrangler files of a Worker agree, that every stored secret has an owner). `infra/go-live.json` is a switch those tests read through `tools/infra/switch.ts`; `infra/README.md` explains it and the second wrangler file beside each Worker's.

## 2. The repository

```
apps/uw-platform/        the internal Worker (composition root)
apps/uw-ingest/          the public webhook Worker (composition root)
packages/harness/        the kernel: pure TypeScript over ports
packages/contracts/      commands, events, outcomes, verbs, page types, closed sets, as Zod
packages/db/             the Drizzle schema, migrations, and the one store implementation
packages/core/           access rules (can), principals, dates, money, logging, the module registry
packages/ui/             tokens, the stylesheet, page shapes and parts
sim/                     test adapters for every port, fixtures, scenarios, the CLI
tools/                   lint rules, architecture checks, CI and infra tests, UI build scripts
infra/                   wrangler files, Access, containers, GitHub Apps, AWS, logs
design-system/           the design boards, synced from Claude Design; code imports nothing from it
```

Dependencies run one way:

```
packages/contracts  → zod only
packages/core       → contracts
packages/db         → contracts, core
packages/ui         → nothing
packages/harness    → contracts, core
apps/uw-ingest      → contracts, core, db
apps/uw-platform    → harness, db, contracts, core, ui
sim/                → harness, contracts, db
```

The rules are dependency-cruiser rules in `tools/architecture/cruise/` (run by `pnpm architecture`) and ESLint rules in `eslint.config.ts`. One import crosses between the two apps: the health screen reads `uw-ingest`'s delivery backlog. It is a recorded exception, and no rule forbids app-to-app imports in general.

`apps/uw-platform` and `sim/` are the two places that construct the kernel. `apps/uw-ingest` is a root too, but it only verifies and enqueues; the queue consumer inside `uw-platform` (`apps/uw-platform/queue/`) hands the delivery on.

Inside `apps/uw-platform`, each top-level folder is one module: `commands/`, `mcp/`, `runs/`, `engines/`, `github/`, `live/`, `notify/`, `pages/`, `markdown/`, `collections/`, `crosswalk/`, `credentials/`, `pdf/`, `people/`, `acl/`, `tasks/`, `agents/`, `health/`, `views/`, `islands/`, `cron/`, `queue/`, `auth/`, `http/` and `ports/`.

## 3. The kernel over ports

"Harness" in the code is a **workflow** in the UI. The **kernel** is the pure core that runs workflows. "Engine" means only the code behind the model-vendor seam.

`createKernel(ports)` in `packages/harness/kernel.ts` returns the kernel; its `Kernel` type in that file is the list of what it offers. `packages/harness` imports nothing from Workers, Drizzle, a vendor SDK or the network, and its tsconfig has no Workers types, so it runs in plain Node. It reaches everything outside itself through a port, the database included (ADR 0001).

- **The ports** are the members of `Ports` in `packages/harness/ports.ts`. The Store's table gateways are in `packages/harness/store-ports.ts`.
- **Every port has a platform adapter** in `apps/uw-platform/ports/` **and a test adapter** in `sim/adapters/`. A platform adapter whose binding is missing is replaced by its `*.not-wired.ts` twin.
- **One contract suite per port** lives in `packages/harness/port-contracts/` and runs against every adapter of that port, so the two cannot drift. `tools/architecture/port-contracts.test.ts` fails a port without one.
- **One store.** `packages/db/store/` is the single Drizzle implementation of the Store and Grants ports. The platform binds it to Hyperdrive; the sim binds it to an embedded Postgres (PGlite, `packages/db/embedded.ts`) that runs the real migrations. Nothing imitates a table.
- **Platform modules query directly.** Only the kernel is behind the Store port. A module under `apps/` that owns tables (pages, collections, credentials and the rest; each declares them with `export const owns`) uses Drizzle in its own data files, and everything else calls that module's functions (ADR 0033).
- **One composition root per process.** The Worker builds the kernel in `apps/uw-platform/kernel.ts`; the sim builds it in `sim/world.ts`. Nothing else constructs a kernel module.

Validators and connectors are registries the kernel picks from by key on a stage row (`packages/harness/validators/`, `packages/harness/connectors/`). Templates are data (`packages/harness/templates/`). The `walk` function enumerates every path through a template, and activation refuses a template in which any path reaches an external effect without crossing a human gate.

**Platform seams are not ports.** What only the platform calls, and the kernel never reaches, sits behind a seam in `apps/uw-platform/` shaped like a port: an adapter over the binding, one for tests, and a `not_wired` answer when the binding is missing. File storage (`apps/uw-platform/pages/file-store.ts`), PDF printing (`apps/uw-platform/pdf/renderer.ts`) and the key service (`apps/uw-platform/credentials/data-keys.ts`) are seams. The kernel is deliberately not given a port that could open a credential (ADR 0019).

**The sim.** `sim/` is the kernel on test adapters with a settable clock. Scenarios in `sim/scenarios/` are named for the requirement they prove and assert on the event log and the folded state. `pnpm sim -- <scenario>` runs one, `pnpm walk -- <template>` prints every path and the gate each crosses. A question a scenario can answer is answered there before any deployed Worker is touched.

**What only a real Postgres server can prove.** PGlite is one connection. Tests that race two connections (a claim against a claim, the work-in-progress limit, the gate decision's locked grant re-read, event positions under concurrency, the application role's missing grants) are the `*.pg.test.ts` files. They run against the Postgres service container in CI, or any server `TEST_DATABASE_URL` names, and are skipped without one. No test needs a live account or a secret.

## 4. Durable data

**One schema.** Drizzle in `packages/db/schema.ts` is the only schema. It holds the kernel's item, event, run, gate and delegation tables and re-exports one `packages/db/schema-<domain>.ts` file per domain; the `export *` lines at the foot of `schema.ts` are the list. Migrations are in `packages/db/migrations/`, generated by `pnpm db:generate`, with hand-written SQL only where Drizzle cannot generate it (triggers, functions). `tools/db/drift.test.ts` fails when the schema and the migrations disagree.

**Every table declares its class.** A table is declared through `declareTable` in `packages/db/declarations.ts`, which requires a `classification` (`public`, `internal`, `restricted` or `sensitive`) and an `offlineEligibility` (`sync`, `cache_readonly` or `never`). A bare `pgTable` does not pass the schema test. Page types carry the same two declarations in `packages/contracts/page-types.ts`.

**One writer per table.** Each table is written by exactly one module, which exports an `owns` constant naming its tables. `tools/architecture/owners.test.ts` fails on a table claimed twice or written elsewhere. A kernel table is written through its Store gateway's `write` half, which only the owning kernel module calls. Every other module reads through the owner's exported functions.

**What the database itself refuses.** These hold whatever the application does:

- A stage whose connector has an external effect must exit on human approval: a check constraint on `harness_stages`, tested in `packages/db/ship-invariant.test.ts` (ADR 0003).
- `harness_events` refuses UPDATE, DELETE and TRUNCATE by trigger, and the application role has no grant for them. A trigger assigns each event's position under a per-harness lock held to commit, so positions become visible in order (ADR 0004).
- `gate_decisions` is append-only. A row written with an agent as actor must name a delegation, be an approval of a merge, and name that delegation's grantor as approver (ADR 0010).
- `credential_versions` and `credential_access_log` are append-only; the access log's reasons and actions are closed by check constraint (ADR 0019).

**Reads of restricted data.** Three layers narrow a read, all in `packages/core/acl.ts`:

1. **Area.** A grant on an area reads that area and no other; only an `org` grant reads every area (ADR 0015).
2. **Row.** A row of a `restricted` or `sensitive` table is read only by the rule its table declares in `rowReadRules`: an area role, the row's owner, and whether an org admin reads it. A rule is a ceiling; a path may show less (ADR 0017).
3. **Property.** A collection property may be classified narrower than its row, with a steward area, a role and an owner. The query engine enforces it in SQL, and a page read drops the withheld keys (ADR 0024).

Two checks hold the row layer: `tools/properties/restricted-rows.test.ts` (every such table has a rule, and `can()` agrees with an independent oracle) and `tools/architecture/restricted-reads.test.ts` (every file that reads such a table is listed in `tools/architecture/restricted-reads.ts` as applying the rule, returning only a count or yes/no, or reading for the platform's own enforcement).

**Conventions.** Dates are `YYYY-MM-DD` through one `formatDate` and `parseDate` pair (`packages/core/dates.ts`), enforced by `pnpm lint:dates`. Money is integer minor units (`packages/core/money.ts`). Ids are UUIDs. Every boundary parses with Zod.

## 5. Authorization

There is one function, `can(actor, action, resource, at)` in `packages/core/acl.ts`, and nothing beside it.

- **Grants.** `role_grants` gives a person `admin`, `editor` or `viewer` at `org` scope or on one Johnny.Decimal area. Grant commands are in `apps/uw-platform/acl/` and every change is written to `grant_audit`.
- **The principal** is minted at the edge on every request (`apps/uw-platform/auth/principal-middleware.ts`) from the Access credential, with the person's live grants. Its shape is `packages/contracts/principal.ts`; the identity forms are `packages/contracts/identity.ts`. A grant revoked now is gone on the next request.
- **Resources.** An area or the org answers `read`, `write` and `admin`. A row answers `read` only, by its rule. A credential answers only its own capabilities (`see`, `use`, `reveal`, `manage`) and never `read` (ADR 0018).
- **Every route, verb and Cloudflare Workflow step calls `can()`** on the area it acts in before it acts. A resource the caller may not read is answered exactly as a missing one, so an id cannot be probed.
- **Pure.** `can()` takes no database handle. A caller loads the facts a rule needs and passes them on the resource.

A new person waits for approval (`apps/uw-platform/people/approval.ts`). Approval gives them `viewer` on the organization's home area so everyone reads the shared pages (ADR 0031).

## 6. Events and state

Everything that happens to a workflow is a row in `harness_events`. The vocabulary is the closed enum in `packages/contracts/events.ts`; adding one is a contract change with fixtures. Item state is a fold over events, and replaying the log reproduces the recorded state (`tools/properties/replay.test.ts`). The Queue, the Flow, the play-by-play and the audit trail are all reads over the same rows. A failure is an event with a closed-set reason, shown as state in place, never as exception text.

Kernel modules do not call each other's internals. After a transaction that appended events commits, the kernel wakes the live hub and plans notifications (`packages/harness/hub-wakes.ts`, `packages/harness/notify/`). Both happen after commit and neither can change a command's outcome.

`packages/contracts` publishes one live contract version (`packages/contracts/version.ts`), with golden fixtures and a lock file (`packages/contracts/contract-lock.json`) that fails the build on an unversioned change.

## 7. Transactions and locks

A kernel command opens one transaction and passes it to everything it calls; transactions never nest. Isolation is READ COMMITTED, Postgres's default, and the design depends on it: a count or a re-read after a lock wait must see what committed during the wait.

Locks are taken in one order, and none after the first event append:

1. **The breaker lock**, for commands that read the spend breaker's level to act on runs.
2. **The stage locks.** `harness-stages:<harnessId>` for edits of a workflow's stages, then `harness-stage-claims:<stageId>` for claim, take over and the gate decision, so the work-in-progress count and the claim are one serial step. Never the second before the first.
3. **The item row**, locked by id alone and re-read after the lock.
4. **Grants.** `FOR SHARE` on the person's `role_grants` where a revoke must wait for the command (stage and gate commands).
5. **The delegation row**, where a lapse is recorded.
6. **The run row.**
7. **The append**, which takes the per-harness event lock inside the insert trigger.

Paths with no stage to lock take a named key first: issue import (`github-issue:<id>`), persona activation, the GitHub read model (`github-repo:<id>`, in ascending id, before any `gh_*` row), Zulip topic linking, the hosted beat's start, and an assistant's turn (`assistant-request:<id>`). Where there is no row to lock, a unique constraint is the guard.

Every advisory lock is a string key hashed by one function, `advisoryLock` in `packages/db/advisory-locks.ts`. That file and `packages/harness/lock-keys.ts` are the registry of keys. `tools/architecture/lock-keys.test.ts` fails if one key is a prefix of another, if a key is unregistered, or if a numeric advisory lock appears anywhere.

No lock is held while GitHub, a model or KMS is called. A command that needs outside facts reads them before its transaction and re-checks under the lock.

## 8. The agent boundary

Agents reach the platform only through the MCP surface, which serves the verb registry and nothing else (ADR 0002).

**The registry.** `packages/contracts/verb-names.ts` lists the verbs and `FORBIDDEN_VERBS`; `packages/contracts/verbs.ts` gives each its grant, its served flag and its schemas. There is no verb that approves, merges, deploys, publishes or advances past a human gate, and a test fails if a name containing one of those words is registered.

**Access.** `/mcp` is its own Access application with its own audience. The edge picks the expected audience by path, so a token for one never works on the other, and a service token is admitted on `/mcp` only. A credential an agent holds can therefore never reach the person routes under `/api`.

**Minting** (`apps/uw-platform/mcp/mint.ts`). On `/mcp` a credential always becomes an agent identity, never a person: `agent:<personId>/<device>`, carrying exactly that person's live grants. A service token is looked up in `service_tokens` and minted for the person and device it is bound to. A persona and a delegation are named together or not at all.

**Two hosts, one server.** `createVerbServer` (`apps/uw-platform/mcp/server.ts`) builds the same server for both hosts (ADR 0006):

- the **external** host is `POST /mcp`, for a runner on a person's own machine;
- the **workflow** host (a Cloudflare Workflow) is the same server over an in-memory transport (`apps/uw-platform/mcp/in-process.ts`), used only by hosted run steps.

`apps/uw-platform/mcp/conformance.pg.test.ts` holds the two hosts to the same tools and schemas. The host fixes the cost basis of a run step: a subscription the person already pays for on the external host, metered spend on the workflow host. The platform stores no subscription credential.

**The dispatcher** (`apps/uw-platform/mcp/dispatch.ts`). The tool list is the served verbs the principal's grants allow. A call for anything else is an unknown-tool error. For an identity that names a delegation, the delegation is checked before every call. Every handler is built by a builder in `apps/uw-platform/mcp/handler.ts`, which runs `can()` on the resource the handler names before the handler acts, or filters each row through it; the server refuses to start with a handler no builder made.

**Delegations.** Unattended work runs only on a delegation: a person lends an agent a capability on one workflow, up to a tier, until a date (ADR 0005). It is checked at every beat, and it lapses the moment the grantor loses the grant behind it.

**The one agent-reachable gate write.** `recordDelegatedDecision` in `packages/harness/gates/delegated-ship.ts` records a merge approval under a merge delegation, with the granting person as approver and the agent as actor (ADR 0010). `tools/architecture/gate-writers.ts` allows exactly two functions to write `gate_decisions`, this one and the person's gate command, and the database binds the row to its delegation.

**The person surface** (`apps/uw-platform/commands/person/`) is the only place in the Worker that touches gates, stages and delegation grants (ADR 0009). `tools/architecture/agent-boundary.ts` follows every import from the app entry and from `apps/uw-platform/mcp/` and fails if anything outside the person surface can reach a gate, a stage write or a connector. `sim/kernel/agent-boundary-runtime.test.ts` then tries every agent identity form against every gate decision.

**Hosted runs.** A hosted run is the `HarnessRun` Cloudflare Workflow. Its core (`apps/uw-platform/runs/run-core.ts`) runs named, checkpointed steps. Each step opens its own in-process connection and asks the kernel for the run's scene; a run that is not running, whose delegation has lapsed, or that no longer holds its item gets nothing. The model is served only its persona's toolset, and the scene is re-checked before every call and after every turn. A paused run, or one parked at a gate, waits in the Workflow and re-reads its row.

**Engines.** The engine seam is `apps/uw-platform/engines/seam.ts`; the registry is `apps/uw-platform/engines/registry.ts`; each engine is its own directory. A vendor SDK is imported only inside its engine's directory (`pnpm lint:vendor`, dependency-cruiser `tools/architecture/cruise/engines.mjs`). Two kinds exist:

- **Tool-loop engines** call a model API from the Worker.
- **Sandbox engines** run a coding CLI in a container (`apps/uw-platform/engines/sandbox/`). The container starts with the internet off. Every outbound request passes the egress proxy (`egress.ts`), which forwards only to the step's own verb server and to the model's inference paths with the organization's key added on the way out, so the container holds no credential. The proxy re-checks the scene before each model request, so a stop, a pause, a lapsed delegation or the breaker ends the step's spend at its next request.

An engine that is registered but not yet available is a directory whose adapter rejects with `EngineNotAvailableError`.

**The spend breaker.** `packages/harness/runs/breaker.ts` reads spend through AI Gateway, records the level as events, and hibernates or resumes hosted runs. It stops; it does not fail over to a cheaper model.

## 9. Untrusted content

Text that entered from outside (a pull request diff or title, an issue, a review comment, a page an agent may have written) reaches a model only wrapped as untrusted content.

- `packages/harness/untrusted.ts` holds the only constructor. The type cannot be built, cast or spread anywhere else. The sources are a closed set in `packages/contracts/closed-sets.ts`.
- The prompt builders (`apps/uw-platform/runs/prompts.ts`) type every field that can carry outside text as untrusted. The wrapper renders the text inside a fence it cannot close, labelled as data.
- A run's reads carry the run's principal, so `can()` filters what a prompt can hold exactly as it filters an MCP read.
- No cache of model output exists. One that is added must key on `clearanceKey` (`packages/harness/clearance.ts`), the reader's readable areas.

`tools/architecture/untrusted-content.ts` is the backstop for each of these; the types are the enforcement.

## 10. The command API and the live hub

**Commands.** People act on a workflow through one route group, `POST /api/harness/:harness/commands/:name` (`apps/uw-platform/commands/routes.ts`). The command names and bodies are `packages/contracts/commands.ts`. `executeCommand` in `apps/uw-platform/commands/dispatch.ts` runs every command in the same order: find the handler, require a database and a principal, parse the body, resolve the workflow (hidden equals missing), refuse a non-person principal, call `can()`, check that every id in the body belongs to this workflow, then the request ledger, the handler and the settle.

- **The request ledger** (`apps/uw-platform/commands/requests.ts`) keys a request by principal and `requestId`, so a retry replays its outcome and never runs twice. It is read only after the access checks, so a revoked caller gets the refusal and not the old outcome.
- **Handlers** are built by a builder with a literal action and carry no database handle, environment or secret; `tools/architecture/command-handlers.test.ts` and `command-routes.test.ts` hold that.
- **Every answer** is `accepted` or `error` with a closed-set reason (`packages/contracts/outcomes.ts`).

Other modules expose their own person routes in the same style: pages, collections, credentials, the crosswalk, grants, agents, push and exports each have a `routes.ts` mounted in `apps/uw-platform/app.tsx`.

**The live hub.** `HarnessHub` (`apps/uw-platform/live/`) is a SQLite-backed Durable Object on the WebSocket Hibernation API, one per workflow. A wake is one small message that carries no data; it only tells a client to re-read through the access-checked routes. A browser connects through `GET /api/harness/:harness/live` (`apps/uw-platform/live/connect.ts`), which reads the workflow through `can()` first, so nobody subscribes to a workflow they cannot read. The kernel wakes the hub after each commit; a failed or slow wake is logged and never fails the command. `tools/architecture/hub-wiring.test.ts` lists the files that may build a hub.

## 11. Pages, the editor and drafts

**The record is markdown.** A page is a row of `pages` with frontmatter and a markdown body; every save adds a row to `page_versions`. `apps/uw-platform/pages/` owns both tables. Page types, with each type's frontmatter schema, are the registry in `packages/contracts/page-types.ts`.

- **Filing.** A knowledge page is filed in a two-digit category, and its area is that category's decade; a save whose category and area disagree is refused (ADR 0031).
- **Gated types.** `apps/uw-platform/pages/gating.ts` lists the page types an agent can only ever save as `suggested`; such a page becomes `active` only through its activation command.
- **Rendering.** `apps/uw-platform/markdown/` renders markdown to HTML on the server, including wiki links, embeds and embedded views. Links and embeds are stored in `page_links` so backlinks are a read.
- **Search** is Postgres full-text search with stored weights and trigram matching (`packages/db/page-search.ts`, `apps/uw-platform/pages/search.ts`), filtered by the reader's areas.
- **Files** are in R2 behind the `FileStore` seam, with a `page_files` row each.

**The editor** (ADR 0030) is Milkdown Crepe, whose own source is markdown, so there is no conversion between an editor format and the record. It is a separate script and stylesheet (`apps/uw-platform/islands/editor/`, built into `apps/uw-platform/generated/editor.ts`) loaded only on the edit screen. A page the editor would change by opening it opens as plain text instead.

**Shared drafts.** `PageDraft` (`apps/uw-platform/pages/draft-hub.ts`) is a Durable Object on `y-partyserver`, one per page version. People editing the same version join it over a WebSocket that admits only someone who may write the page, for a bounded time, after which the Worker checks access again. Nothing reaches readers until Save, which is the ordinary page update with the draft's markdown. A save from elsewhere moves the version on; an open draft's Save is then refused `stale_version` and nothing is merged.

## 12. Collections and the query engine

A **collection** is a stored definition over pages or typed records (ADR 0023). `apps/uw-platform/collections/` owns the tables in `packages/db/schema-collections.ts`.

- **The definition is data.** A collection has one row per property; each property's settings are JSON validated by the property catalogue in `packages/contracts/collections.ts`. A row is parsed by a Zod schema compiled from the definition at runtime. There is no runtime DDL: Drizzle stays the only schema.
- **Where values live.** A page collection's values are keys of the page's frontmatter, written only through collection commands that call the pages module's narrow writers, so `pages` keeps one writer. A relation is a `page_links` row. A collection can instead list typed records (tasks, people), whose writes go through their owner module.
- **Built-in collections** (`apps/uw-platform/collections/builtins/`) are TypeScript values inserted by the same create path as any other.
- **The query engine** (`apps/uw-platform/collections/query/`) compiles each property source to SQL. Frontmatter values are read by typed, immutable extractor functions so they can back expression indexes. Area scope and property-level classification are applied in the SQL, before rows leave the database.
- **Saved views** are rows; the layouts are the closed set in `packages/contracts/collection-views.ts`.
- **A collection owns no money.** Money appears only as a read-through property served by another module's feed. No feed is wired, so each answers `not_wired`.

**The crosswalk** (`apps/uw-platform/crosswalk/`, `packages/db/schema-crosswalk.ts`) stores each cascade entity's place as a placement row and the map between Johnny.Decimal areas and the Strategic Cascade, with an audit of changes (ADR 0027). `crosswalk/chain.ts` walks from a placement up the program and portfolio relations.

**Policies, charters and decision pages** (ADR 0034) are page types, so the pages module writes them and all three are gated. Two checks run on every save, in `apps/uw-platform/pages/content-checks.ts`: a page type may declare body problems in the page-type registry (missing charter or decision headings), and a page type that declares `appliesToNode` must name in `applies_to` a live node or product the writer can read. Resolution is split three ways: `pages/policies.ts` builds the policy chain and reads the active policy pages; the pure `resolvePolicies` in `packages/harness/policies/` decides what is in force; `pages/policies.ts` then keeps what the reader may read, for `resolve_context`, beside `pages/decisions.ts` for decision pages. `pages/policy-reading.ts` gathers what a person sees of a policy for its page and for `/wiki/policies`, over one load of every active policy (`pages/policy-book.ts`), which judges each superseding pair on the chain that holds both. Candidate reads run in keyset batches (`pages/batches.ts`) with the reader's areas in the query, never under a cap. `pages/policy-templates.ts` copies a template policy and adopts an update; the pure `templateDrift` reports copies behind their template.

**Suggestion sets** (ADR 0035) are rows of `page_suggestion_sets` (`packages/db/schema-suggestions.ts`), owned by the pages module. The save path takes an optional divert: `agent-write.ts` sets one that, for an active page whose type declares `agentSuggests`, records the save as a set (`pages/suggestions.ts`) after every save check has run. `pages/suggestion-decisions.ts` accepts a set through `updateWithin`, the same transaction a person's save uses, or rejects it; only `pages/routes.ts` and the review screen may import it (`suggestion-decisions-only-from-page-routes`). Migration 0072 adds the trigger that keeps a decided set as it was decided.

**People.** A person's profile is their directory row (ADR 0025); `apps/uw-platform/people/` owns the people and directory tables.

## 13. Credentials

`apps/uw-platform/credentials/` is the one writer of the credential tables in `packages/db/schema-credentials.ts`.

- **Envelope encryption** (ADR 0019). Each credential version is sealed with AES-256-GCM under its own data key, which KMS generates and wraps. The credential, the version and the area are bound into both the KMS encryption context and the cipher's authenticated data, so a ciphertext moved to another row does not open. A copy of the database alone reveals nothing.
- **One function opens a value.** `openCredential` asks `can()`, calls KMS, then, inside one transaction that locks the credential row, reads the credential, its bindings, its reveal grants and the person's grants again and asks `can()` again. Only then is the access-log row written and the value returned. A revocation that commits before that lock wins.
- **Use by reference** (ADR 0020). `useCredential` is the only way a value leaves for use: the caller passes a reference and a function, receives a `Secret` that renders as `[secret]` everywhere but one explicit call, and the bytes are zeroed when the function returns. What the function returns is searched for the value before it is handed back. The effect connectors other than merge are not wired, so nothing calls it in production yet.
- **Reveal** (ADR 0021). One route returns a value, uncached, to an interactive person. A reveal tells the area's other admins by web push. A reveal grant given by an org admin who is not an area admin waits for a second person.
- **The boundary is a build rule.** `tools/architecture/cruise/credentials.mjs` keeps the AWS signer inside the KMS client, the files that open a value inside the store, the reveal behind its one route, and every file of the store away from `mcp/`, `engines/`, `runs/` and `agents/`.

## 14. PDF

PDF is printed from the platform's own HTML (ADR 0028). Any screen asked for with `?format=pdf` is rendered through the same route with print styles (`packages/ui/print.css`) and printed in the request by the `PdfRenderer` seam over the `BROWSER` binding. A binder (several pages in one file) is queued on the `PdfExportRun` Workflow, which plans the binder again as the requester, so pages they cannot read are left out, and stores the file in R2. `apps/uw-platform/pdf/` owns `pdf_exports`; a nightly cron removes exports past their expiry. Each PDF carries a provenance footer with a hash of its source. An agent's `render_pdf` verb answers an export's id and status, never its bytes; only a signed-in person downloads the file.

## 15. Notifications

After a commit, the kernel plans one wake per triggering event and sends them through the Notifier port (`packages/harness/notify/`, `apps/uw-platform/notify/`).

- **Web push** to the recipient's devices (`apps/uw-platform/notify/push/` owns the subscription and cooldown tables). A person present on the relevant screen, as the live hub reports, is not pushed. A cooldown claimed in one SQL statement stops two wakes sending twice.
- **Zulip**: one post to the item's topic in the channel configured for the area (`apps/uw-platform/notify/zulip/`). The post carries the workflow key, the item ref, a fixed sentence and a link, never a title or body. Replies come back through `uw-ingest` and are recorded as comments; they decide nothing.
- **The installed app.** The service worker (`apps/uw-platform/islands/worker/`) caches the shell and shows a push.

A failed or unconfigured notification never changes a command's outcome.

## 16. Assistants

A person's **assistant** is a persona on that person's own **personal harness**, lent authority by that person and acting with no one deciding only within a closed low-risk set (ADR 0036). Its kernel module is `packages/harness/assistants/`, reached as `kernel.assistants`.

- **The personal harness.** A `harnesses` row whose `person_id` is set, with template `assistant` and no stages. `enable` creates it when a person turns their assistant on (below); the older `provision`, for an org admin or an admin of the assistants area, is reached by no route and kept for the sim and tests. The area is never the caller's to name: it is `assistantsArea` in the `KernelSettings` passed to `createKernel` (`packages/harness/kernel-settings.ts`), and while it is unset both are refused `not_wired`. The platform's kernel passes `10-19` from trusted code (`apps/uw-platform/assistants/area.ts`), in `platformKernel` and in the `AssistantTurn` Workflow's settings. Template activation holds the stage count to the template key: the assistant template has none and every other template at least one, and the `template_activated` evidence refuses either mix-up; the assistant template is not in the templates registry, so no generic command makes one. The database holds the template and the person together and allows one assistant per person (`packages/db/schema-harnesses.ts`). Stage edits on it are refused (`packages/harness/stages/guards.ts`), and persona activation refuses any identity but that person's assistant on it (`packages/harness/personas/harness-guard.ts`).
- **Turning on and off** (ADR 0040). `kernel.assistants.enable` and `disable` take only an interactive person acting for themself (`actingPerson`: never an agent, the system or a person without live grants). `enable` refuses an invalid or reserved name and a name another live assistant holds, then, under the `jd-allocation:10` advisory lock, gives the lowest free number from 10.51 upward (`nextAssistantJdId` in `packages/contracts/assistant-accounts.ts`), creates or retitles the personal harness ("10.51 Barnabas") and writes the `assistant_accounts` row (kernel-owned, `packages/db/schema-assistant-accounts.ts`; unique partial indexes hold one number and one name per live assistant and one row per person) with `assistant_enabled`. A repeat answers the same assistant; turning back on restores the number, and may take a new free name. `disable` marks the row turned off, revokes the live `assist` delegations under the harness lock and records `assistant_disabled`. `retire`, only for `agent:assistant-provisioner` and only 30 days after turning off, clears the number and records `assistant_deleted`; `activatePersona` and `recordProvisioning` are the provisioner's too. The wiki's number suggester (`apps/uw-platform/pages/jd-ids.ts`) counts assistant numbers as taken in category 10.
- **Provisioning** (ADR 0040). `apps/uw-platform/assistants/provisioning/` owns `assistant_provisioning`, one progress row per assistant keyed to the account's version. `provisioner.ts` runs the steps for the account's goal, each idempotent: turned on, the Workspace user (`google/directory.ts`: Admin SDK `users.insert` in `GOOGLE_ASSISTANT_OU` with a random password kept nowhere and an external id naming the harness, adopting a user that already carries it and restoring a suspended one), the Zulip bot (`zulip/provision.ts`: create, seal the key, pair by email, or reactivate and rename), the persona (a suggested page from the assistant role, activated by the provisioner through the tool check and dry run) and the `assist` delegation (waiting until the person grants it); turned off, suspending the user and deactivating the bot. A failure is kept with its closed reason, recorded once as `assistant_provisioning_failed` and retried with backoff; a reached goal records `assistant_provisioned`. The person's commands (`/api/assistant/commands/enable_assistant`, `disable_assistant`, `grant_assist`, `apps/uw-platform/commands/assistant-routes.ts` and `commands/person/assistant.ts`) first ask the directory whether the address is free (a user or an alias), then call the kernel and drive the steps at once; a guarded minute-cron step re-drives due work, five at a time, and a nightly job deactivates the bot, deletes the Workspace user and retires the number 30 days after turning off.
- **Authority.** Each capability word has a policy in `packages/harness/delegations/capability.ts`: who grants it, on which kind of harness, and whether the run beat or a device may act under it. `assist` is granted by the harness's person, only to that person's own assistant identity, stays live while that person holds a live grant (`delegations/live.ts`), and is skipped by the run beat and refused to devices. The assistant's principal is built in `assistants/principal.ts`: the person's live grants, each clamped to `viewer` and ending no later than the delegation.
- **A request and a turn.** `recordRequest` takes only the ingest or system principal and records a request once per channel and external id. `beginTurn` takes the system principal and, in one transaction under the `assistant-request:<id>` lock and then the `assistant-harness:<id>` lock, refuses a turn already finished and a paused harness (`harness_paused`), then checks the live `assist` delegation, the active persona, the spend breaker and the persona's monthly budget: the known costs in `assistant_turn_finished` evidence, with each unknown cost and each started but unfinished turn counted at the role's per-turn ceiling. The harness lock serialises admission per assistant, so two requests cannot both spend the last of a month; `finishTurn` takes the same lock after the request lock, so no turn settles while an admission reads the month, and the month is read in one statement. `beginTurn` carries an `attemptId` the caller keeps for retries of one call, recorded on `assistant_turn_started`. A `beginTurn` for a request whose turn is started and unfinished replays it only for the same attempt: the same turn id and loop, no second `assistant_turn_started`; any other attempt is refused `turn_taken`, so a redelivered or concurrent duplicate never reaches the model. If the replay is refused (paused, delegation gone, persona inactive, breaker held), the turn is closed in the same transaction with `assistant_turn_finished` at outcome `refused` and no usage, and the refusal carries its turn id, so no turn stays reserved. The start event binds the turn to the `assist` delegation it was admitted under. Each refusal is an `assistant_turn_refused` event, and no model is called. A turn's loop is the role's instructions with the person's customisation after them, the role's toolset, up to six earlier exchanges from the same thread, and a prompt of the person's note followed by every untrusted part in its fence. The caller runs it through the tool loop (`packages/harness/runs/tool-loop.ts`).
- **The effect ledger.** `finishTurn` first rechecks the delegation the turn was admitted under; if it was revoked, expired or its person's grants are gone, the reply is withheld, recorded as failed `delegation_lapsed`, and `assistant_turn_finished` still records the usage. Otherwise it records the reply as a `reply_to_requester` row in `assistant_effects` under an idempotency key, sends it through the `DirectMessages` port after that transaction commits, then records the outcome and `assistant_turn_finished`. The attempt that recorded the row owns the outcome: a retry while it sends is refused `request_in_flight`, a retry after it settled gets the settled result, and only once its ten-minute delivery lease has passed does a retry mark the effect `outcome_unknown`, after which the late sender writes nothing. The send is bound to the lease: each message carries a send-by time five minutes after the effect was recorded, and the port delivers nothing at or after it and answers `deadline_passed`, so a send still waiting when the lease passes can no longer deliver. The recipient is the request's owner on the request's channel: the port sends only when that person's verified binding for the channel is the address the request came from, and otherwise answers `not_paired` and delivers nothing; the model never names one. A check constraint on `assistant_effects` admits only the closed set in `packages/contracts/assistants.ts`.
- **Reminders.** The verbs `set_reminder`, `cancel_reminder` and `list_reminders` (group `assistant`, served only by the assistant host below, never on the external MCP surface) reach `kernel.assistants.setReminder`, `cancelReminder` and `listReminders`, which take only the turn's own assistant principal for a started, unfinished turn whose delegation is still live (`assistants/reminder-turn.ts`). Setting and cancelling only draft: each writes a `reminder_set` or `reminder_cancelled` row in `assistant_effects` and records `assistant_effect_started`, refusing a due time under a minute or over two years ahead and more than five effects a request or fifty reminders a day; a repeated draft with the same payload answers the first. `finishTurn` applies the drafts in the transaction that claims the reply (`assistants/reminders.ts`): a set becomes a row in `assistant_reminders` with `assistant_reminder_set`, a cancel closes the row with `assistant_reminder_cancelled` or fails `reminder_closed`, and with a lapsed delegation every draft fails `delegation_lapsed`. `fireDueReminders` takes the system principal (`assistants/reminder-fire.ts`): for each due reminder, under the `assistant-harness:<id>` lock, it rechecks the live `assist` delegation, then either closes the row `undelivered` with `assistant_reminder_undelivered {why: delegation_lapsed}`, or closes it `fired` with `assistant_reminder_fired` and, after that commits, sends it through `DirectMessages` to the address of the request that set it, with the reminder's id as the effect id and a five-minute send-by. Delivery is at most once: a failed send moves the row from `fired` to `undelivered` with the port's reason, and a crash after the claim never resends. The minute cron runs it as the guarded `reminders` step after the beat (`apps/uw-platform/cron/minute.ts`), 50 a minute, ordered by due time.
- **Zulip, one bot per person** (ADR 0037). `apps/uw-platform/assistants/zulip/` owns `assistant_zulip_bots` (the bot, its KMS-sealed API key and its webhook token digest) and `assistant_zulip_sends` (one claim per effect id). `provision.ts` creates, adopts, deactivates and reactivates a bot through the admin client (`admin.ts`, plain `fetch`, five-second timeout, one wait on a short `Retry-After`) and binds the person's account found by email through `kernel.assistants.bindAddress`. `uw-ingest`'s `zulip-assistant` source verifies a delivery by that bot's token digest (`apps/uw-ingest/sources/zulip-assistant.ts`, `deliveries/bot-tokens.ts`); the queue consumer's `assistantDmHandler` (`inbound.ts`) records a request only from the bound account in a one-to-one message, fencing quotes (`quotes.ts`), or offers a lone code to `kernel.assistants.completePairing`. Bindings and pairing codes are kernel tables (`assistant_bindings`, `assistant_pairing_codes`, `packages/harness/assistants/pairing.ts`). The `DirectMessages` port's platform adapter (`apps/uw-platform/ports/direct-messages.ts`) sends a reply or reminder as the person's bot, only to the bound address, before `sendBy`, at most once; the queue consumer, the minute cron and the run Workflow's kernels take it from `apps/uw-platform/assistants/direct-messages.ts`.
- **The hosted turn** (ADR 0038). A recorded request starts one `AssistantTurn` Cloudflare Workflow whose instance id is the request id (`apps/uw-platform/assistants/turn/`): the queue consumer's `assistantDmHandler` calls `turnStarterOf(env.ASSISTANT_TURN)` after `recordRequest`, and a start for a request that already has an instance answers `already_started`. A request whose start was lost is found again: the minute cron's guarded `assistant-starts` step asks `kernel.assistants.unstartedRequests` for requests recorded more than two minutes and less than a day ago that no turn started or refused (`assistantRequests.read.unstarted`), and starts each, 20 a minute. The Workflow's core (`run.ts`) runs four named steps: `attempt` keeps one `attemptId` per instance, so every retry or restart replays the same turn and a second instance for the request is refused `turn_taken`; `begin` admits the turn; `loop` (no retries, so a turn is never paid twice) replays `beginTurn` for the same attempt to rebuild the principal and loop, opens the assistant host and runs the tool loop through the platform's model engine; `finish` calls `finishTurn`, which claims, sends and settles the reply, and retries while another attempt's send holds its lease. A loop that throws is finished as outcome `failed` at an unknown cost, and the person is told once. The loop is marked `zeroRetention`, so the OpenRouter engine routes it only to zero-data-retention endpoints (`provider.zdr`, `data_collection: deny`) as well as pinning its provider, and the Claude engine refuses it (`ZeroRetentionUnavailableError`). The assistant host (`apps/uw-platform/mcp/assistant-host.ts`, the third site allowed to build the verb server) is an in-process MCP server under the turn's assistant principal, host `assistant`, serving only the turn's tools: the role's read verbs and the `assistant` group, whose handlers (`apps/uw-platform/mcp/verbs/assistant-reminders.ts`) take the turn's request and turn id from the host, never from the model. The external host never serves the `assistant` group (`apps/uw-platform/mcp/tools.ts`).
- **The calendar** (ADR 0039). The verbs `read_my_calendar`, `find_free_time`, `hold_time` and `release_hold` (group `assistant`, served only by the assistant host, handlers in `apps/uw-platform/mcp/verbs/assistant-calendar.ts`) reach `kernel.assistants.readMyCalendar`, `findFreeTime`, `holdTime` and `releaseHold`, for the turn's own assistant principal in a started, unfinished turn with a live delegation. The reads (`assistants/calendar-reads.ts`) go to the new `Workspace` port at once, keyed by the person's id, never an address: a day or up to fourteen days of the person's own events in their timezone (`zonedDateOf`, `zonedInstant` and `formatZonedMinute` in `packages/core/dates.ts`), each event's title, place and description fenced as untrusted `calendar_event`, and free slots in working hours (09:00 to 17:00, weekdays, `assistants/free-slots.ts`) for the person and up to ten colleagues, whose addresses the port refuses `outside_organization` unless each is an active person in the organization's domain. `holdTime` and `releaseHold` only draft a `calendar_hold_added` or `calendar_hold_removed` effect (at most a day long, starting within about eighteen months, twenty holds a day). `finishTurn` first runs `applyCalendarDrafts` (`assistants/calendar-apply.ts`): with the turn still open, no reply claimed and the delegation live, it asks the port for each unsettled calendar draft outside any transaction, then records, under the harness lock, `assistant_hold_placed` with a row in `assistant_calendar_holds` (kernel-owned, owner-only) or `assistant_hold_released`, each with `assistant_effect_done`, or `assistant_effect_failed` with `calendar_refused`, `calendar_unavailable`, `not_own_hold` or `not_wired`; a failure is named in the reply. A hold's Google event id is its hold id's hex, so a retried placement is answered by Google's conflict and creates nothing new. With a lapsed delegation the drafts fail `delegation_lapsed` with the reminders.
- **Google** (ADR 0039). `apps/uw-platform/assistants/google/` holds the plain-`fetch` client: `token.ts` signs an RS256 jwt-bearer assertion with `jose` from the service account in `GOOGLE_WORKSPACE_KEY` and exchanges it at Google's token endpoint, refusing before it signs any subject or scope outside its allowlist (an active assistant mailbox for Gmail, an active person in `GOOGLE_WORKSPACE_DOMAIN` for the calendar, the one `GOOGLE_WORKSPACE_ADMIN_SUBJECT` for the directory), and caches each token per service account, subject and scope set in the isolate until five minutes before it expires; `rest.ts` calls with a five-second timeout and re-mints once on a 401; `calendar.ts` lists, asks free/busy, inserts holds (`sendUpdates=none`, visibility private, a private extended-property marker naming the harness and the hold) and deletes only an event carrying the marker. `subjects.ts` owns `assistant_mailboxes` and reads `people` for the allowlist. The platform adapter `apps/uw-platform/ports/workspace.ts` resolves the person's address itself; `apps/uw-platform/assistants/workspace.ts` builds it once the key and domain are set and answers not wired otherwise. The sim adapter is `sim/adapters/workspace.ts`; both pass the Workspace port contract (`packages/harness/port-contracts/workspace.ts`), the platform one against the recorded-shape `assistants/google/testing/fake-google.ts`.
- **Stale turns.** A turn whose host died stays open and reserved. `closeStaleTurns` (system only, `assistants/stale.ts`) takes turns started more than an hour ago and never finished: with no reply claimed it records `assistant_turn_finished` at outcome `abandoned` with no usage, releasing the reservation; with a reply claimed and its lease passed it settles the reply `outcome_unknown`; within the lease it waits. A late `finishTurn` for an abandoned turn is refused and sends nothing. The minute cron runs it as the guarded `assistant-turns` step, 50 a minute.
- **The assistants pool.** Admission also refuses `assistants_capped` once the month's spend of every assistant together (`harnessEvents.read.assistantPoolSpend`, counted like one assistant's month) reaches the pool: the sum of the budgets of every personal harness with a live `assist` delegation (`assistantBudgets.read.pool`), each the admin's `assistant_budgets` row or the role default, held under `assistantSpendCapMinor` when set (`assistants/pool.ts`, `KernelSettings`, from `ASSISTANT_SPEND_CAP_MINOR`). Pool admission takes the `assistant-pool` lock after the harness lock. A person's own budget is their `assistant_budgets` row when an org admin set one (`setBudget`, `assistant_budget_set`, the `set_assistant_budget` command on `/api/acl/commands`), and the persona's otherwise. The breaker's reading subtracts the assistants' known spend from the gateway's, so assistant spend never moves the platform cap (`packages/harness/runs/breaker.ts`).
- **Where content lives.** Settings, requests, effects, reminders, holds, bindings, pairing codes and bots are owner-only restricted tables that are never offline (`packages/db/schema-assistants.ts`, `rowReadRules` in `packages/core/acl.ts`). No agent principal reads them; the kernel reads them for the platform, as the restricted-reads ledger records. Every assistant event is content-free: its evidence holds only ids, closed sets and numbers (`packages/contracts/assistant-evidence.ts`), and an invalid fixture proves a text field is refused.
- **Wakes.** A wake on a personal harness goes only to its person and is marked personal (`packages/harness/notify/plan.ts`); the Zulip notifier never posts one to a stream (`apps/uw-platform/notify/zulip/send.ts`).

**Reached from the Worker.** The minute cron fires due reminders and closes stale turns, the queue consumer records Zulip requests and pairings and starts each request's `AssistantTurn`, and the `AssistantTurn` Workflow (bound as `ASSISTANT_TURN` in staging and production) runs the turn. The `AssistantTurn` Workflow's kernel also takes the `Workspace` factory in `apps/uw-platform/assistants/workspace.ts`, so its turns reach the person's Google calendar once `GOOGLE_WORKSPACE_KEY` and `GOOGLE_WORKSPACE_DOMAIN` are set (until then a calendar verb is refused `calendar_not_wired`); the calendar path from a direct message to a hold on the person's calendar is proven in `apps/uw-platform/assistants/turn/calendar.pg.test.ts` against the fake Google. They, and the run Workflow, build their kernels with the `DirectMessages` factory in `apps/uw-platform/assistants/direct-messages.ts`, which wires the Zulip adapter once `ZULIP_SITE` is set (until then a reply is recorded `not_wired`); email replies stay not wired until the email slice. The minute cron also re-drives assistant provisioning, and the nightly cron deletes assistants turned off 30 days ago (`apps/uw-platform/cron/assistant-deletion.ts`); both build the provisioner from `apps/uw-platform/assistants/provisioning/deps.ts`, which leaves the Workspace or Zulip side unset, and every step on it recorded failed `workspace_not_wired` or `zulip_not_wired`, until their configuration is set. Turning on, provisioning against the fake Google directory and the fake Zulip, turning off, turning back on and final deletion are proven in `apps/uw-platform/assistants/provisioning/provisioner.pg.test.ts`, `cron/assistant-provisioning.pg.test.ts` and `commands/person/assistant.pg.test.ts`. The whole path from a direct message to a reply from the person's bot is proven in `apps/uw-platform/assistants/turn/turn.pg.test.ts` against the fake Zulip, a fake KMS and a scripted OpenRouter gateway. The behaviour runs in the sim, proven by the PA scenarios, the database constraints in `packages/db/assistant-tables.test.ts`, `assistant-reminders-table.test.ts` and `assistant-zulip-tables.test.ts`, and the Zulip path against `apps/uw-platform/assistants/zulip/testing/fake-zulip.ts`.

## 17. GitHub

GitHub is the source of every fact the Ship gate reads.

- **Ingest.** `uw-ingest` verifies the signature, records the delivery (`apps/uw-ingest/deliveries/`) and enqueues it. Its sources are the registry in `apps/uw-ingest/sources/registry.ts`.
- **The read model.** `apps/uw-platform/github/facts/` owns the `gh_*` tables in `packages/db/schema-github.ts`. One guarded upsert (`upsert.ts`) is the only writer, called by the queue consumer and the nightly sweep (`apps/uw-platform/github/sweep.ts`). A fact never moves backwards: a completed check stays completed, and a head change clears the stored file list.
- **The clients.** `apps/uw-platform/github/session.ts` mints one installation token per unit of work, scoped to one repository. No function returns a token. Dependency-cruiser (`tools/architecture/cruise/github.mjs`) fixes who may import the read client, the comment writer and the ship writes; nothing under `mcp/` or `engines/` imports the GitHub module.
- **The ship rule** (`packages/harness/ship-rule.ts`) is a pure function over GitHub facts, the risk tier and the approver's principal. Its only caller is the Ship assembler (`packages/harness/gates/ship-input.ts`, `approve-at-ship.ts`), which refreshes the facts first and refuses stale ones. The risk tier is re-derived from the changed files at the pull request's current head; a declaration in the pull request can only raise it.
- **The merge connector** (`apps/uw-platform/github/merge.ts`) is the one wired effect connector (`apps/uw-platform/ports/connectors.ts`). It re-reads the live pull request and refuses any head, base or repository other than the decided one before it writes. `outcomeOf` reports a merge that already happened without causing one, which is how a lost result is recovered.
- **Issue import.** An open issue with the workflow's label in a repository a workflow names becomes one item, idempotently on the issue's GitHub id.

Green CI is not a guard on its own, because code in a pull request runs in CI. The guards are the Reviewer's approval on the head and the person who approves; workflow tokens are held without `checks: write` (`tools/ci/workflow-permissions.test.ts`).

## 18. The UI layer

- **Tokens.** `packages/ui/tokens/*.css` is the one token system: the brand colours, the semantic theme over them, and the scales (`scales.css`, generated by `pnpm ui:tokens`). `packages/ui/app.css` declares a Tailwind 4 theme whose every value is a token, with Tailwind's defaults reset, so a value not in the tokens does not exist (ADR 0007, ADR 0011). Light and dark follow the system setting with a stored override.
- **Shapes and parts.** `packages/ui/shapes/` holds the page shapes; `packages/ui/components/` holds the parts. A screen imports its shape and its parts and writes no layout or control classes of its own (ADR 0029). Charts are ECharts rendered to SVG (ADR 0012); icons are referenced by token (ADR 0013).
- **Screens.** Every screen is a route in `apps/uw-platform/views/routes.tsx` with its handler in `apps/uw-platform/views/screens/` and an entry in `apps/uw-platform/views/registry.ts`. A screen reads with the request's principal at the request's instant, and renders the same not-found page for what the person may not read as for what does not exist.
- **Islands** are the browser scripts for behaviour the server cannot render (`apps/uw-platform/islands/browser/`), built by `pnpm ui:islands` into `apps/uw-platform/generated/`. They call the command API and never the kernel. On a wake, an island fetches the same URL as a fragment and morphs it in place; a form the person has edited is never replaced, and an older answer never replaces a newer one.
- **Built assets are committed.** The stylesheet (`packages/ui/generated/`) and the island bundles are generated files with hashed paths; tests fail when a committed build is not the current one.
- **Headers.** `apps/uw-platform/http/security-headers.ts` sets a Content-Security-Policy that allows only same-origin scripts; the edit screen alone adds a per-response style nonce for the editor.

The checks are under `tools/ui/`: tokens agree with the theme, no hex colour or arbitrary value outside the token files, Kindle orange only on a human action, each part defined once, and the one-way rule that screens take their layout from `packages/ui`.

## 19. Secrets and health

**Secrets** (ADR 0022). `withSecrets` (`apps/uw-platform/secrets.ts`, `apps/uw-ingest/secrets.ts`, over `packages/core/platform-secrets.ts`) runs at each Worker's entry and returns every secret as a plain string. A secret is read from its Cloudflare Secrets Store binding when one is declared and from the Worker secret otherwise, and a failed store read falls back loudly. `infra/secrets-store.json` lists each secret's owner and rotation date. No secret is in a wrangler file, a workflow file or the repository.

**Health.** `apps/uw-platform/health/indicators.ts` builds the platform indicators, and `/health` shows them with the agent plane. `/health/probe` is public for the deploy check, so it counts sources and states and never names a secret or shows a value.

**Logs.** Each request, queue batch, cron and run step logs structured JSON with a trace id (`packages/core/log.ts`, `packages/core/trace.ts`). Log shipping and retention are declared in `infra/logs/`.

## 20. CI, deploy and release

The procedure and who may do what are in `AGENTS.md`. The mechanics:

- **CI** (`.github/workflows/ci.yml`) runs on every pull request and every push to `develop` or `main`: the dependency audit, lint, typecheck, architecture, the test shards and scenarios against a Postgres service container, and the build. `pnpm verify` runs the same chain locally except the dependency audit.
- **Preview.** Each pull request gets its own Worker (`build-pr.yml`, `deploy-pr.yml`, `cleanup-pr.yml`).
- **Staging** deploys after CI passes on a push to `develop` (`deploy-staging.yml`), never cancelling a deploy mid-migration.
- **Production** deploys by dispatch on a `v*` tag whose commit is on `main` (`deploy-production.yml`).
- **A red CI run** on either long-lived branch opens an issue (`main-alarm.yml`).

Tests under `tools/ci/` hold the workflow files to these rules.

## 21. Every rule is a check

A rule that lives only in prose drifts. Each of these has a check.

| Rule | Check |
|---|---|
| Imports follow the dependency directions | dependency-cruiser rules in `tools/architecture/cruise/layers.mjs`, run by `pnpm architecture` |
| The kernel is pure | `harness-imports-contracts-and-core-only`, ESLint restricted imports and globals, `tools/architecture/harness-tsconfig.test.ts` |
| Every port has a contract suite run against every adapter | `tools/architecture/port-contracts.test.ts` |
| A vendor SDK is imported only in its engine directory | `pnpm lint:vendor`, `tools/architecture/cruise/engines.mjs` |
| No agent-reachable code writes a gate decision or a stage, except the delegated Ship exit | `tools/architecture/agent-boundary.test.ts`, `gate-writers.test.ts`, `sim/kernel/agent-boundary-runtime.test.ts` |
| Both hosts serve the same verbs | `apps/uw-platform/mcp/conformance.pg.test.ts` |
| No forbidden verb is registered | `packages/contracts/verbs.test.ts` |
| Outside text reaches a model only as untrusted content | the types, and `tools/architecture/untrusted-content.test.ts` |
| Ship exits only on human approval | the check constraint, `packages/db/ship-invariant.test.ts`, and the template walk at activation |
| An assistant's effects with no person deciding stay in the closed low-risk set | the check constraint on `assistant_effects`, `packages/db/assistant-tables.test.ts` |
| Replay equals record | `tools/properties/replay.test.ts` |
| One writer per table | `tools/architecture/owners.test.ts` |
| Every table declares classification and offline eligibility | `packages/db/declarations.test.ts` |
| A restricted row is read only by its rule, and every reader is accounted for | `tools/properties/restricted-rows.test.ts`, `tools/architecture/restricted-reads.test.ts` |
| A credential value is opened only inside the store | `tools/architecture/cruise/credentials.mjs`, `credentials-rules.test.ts` |
| The schema and the migrations agree | `tools/db/drift.test.ts` |
| Lock keys are registered and never overlap | `tools/architecture/lock-keys.test.ts` |
| Dates are `YYYY-MM-DD` | `pnpm lint:dates` |
| Tokens are the only source of a visual value | `tools/ui/` |
| Islands never call the kernel | dependency-cruiser |
| Code carries no comments | `tools/lint/no-comments.ts`, applied to `apps/`, `packages/` and `sim/` |
| Files stay under the length limit | ESLint `max-lines`, counting non-blank lines |
| A query lives in a data file of a module that owns tables, never in a route, a handler, a component, a view or an island | `tools/architecture/data-files.test.ts` |
| Nothing unused | `pnpm knip` |

**Rules with no mechanical check.** These are stated in `AGENTS.md` and held by review only:

- *The notifier is reached only through its port.* Not checked. The credential reveal notice deliberately bypasses it, as a recorded exception.
- *One app does not import another.* Not checked.
- *The no-comments and vendor-SDK rules outside `apps/`, `packages/` and `sim/`.* `tools/` and the root config files are not covered.
- *`docs/exceptions.md` is complete.* No test compares it to the code.

## 22. Where a change goes

| Change | Place |
|---|---|
| A new kernel behaviour | a function on the module's interface in `packages/harness`, a test there, a scenario in `sim/scenarios/` |
| A new thing the kernel needs from the world | a port in `packages/harness/ports.ts`, its platform adapter, its test adapter and its contract suite, together |
| A new event | the enum in `packages/contracts/events.ts`, its fixtures, and the folds that should count it |
| A new verb | the registry in `packages/contracts`, the MCP handler through a builder, the persona toolsets that may hold it |
| A new command | `packages/contracts`, a handler through a builder with `can()`, a scenario |
| A new engine | a directory under `apps/uw-platform/engines/` and a registry row; never a branch in shared code |
| A new validator or connector | a registry entry and a handler; a stage row picks it by key |
| A new table or column | the `packages/db/schema-<domain>.ts` file for its domain, with its classification, its one owner, and a migration |
| A new restricted table | the above, and its rule in `rowReadRules` and its readers in the restricted-reads ledger |
| A new collection | a definition, as data; a built-in one is a value under `apps/uw-platform/collections/builtins/` |
| A new page type | the registry in `packages/contracts/page-types.ts` |
| A new screen | a route, an entry in `apps/uw-platform/views/registry.ts`, a test that renders it, a named page shape; an island only for behaviour the server cannot render |
| A new part or a new visual value | `packages/ui` first; a value not in the tokens is a design change |
| A new binding or secret | `infra/`, with its test under `tools/infra/` |
| A new word | `CONTEXT.md` first |
| A reason the next reader will not guess | `docs/decisions.md` |

# Part 2. Planned shape

Nothing in this part exists in the code. It records only what the platform's design has already fixed for the pieces still to come, so that work on them starts from one shape. The features themselves are in `PRD.md`.

## 23. The public site and publishing

A third Worker, `uw-www`, serves the public site as pre-rendered HTML from R2 and KV with no database dependency, so the site survives a database outage. Publishing is a pipeline: a page is marked for publishing, an area admin approves, a queue renders markdown to HTML in the brand template and writes it to R2, and a publish log records exactly which page version is public. A preview is reachable behind Access before approval. The `publish` connector that this needs is declared and not wired.

## 24. Desktop and offline

- **A desktop app** (Tauri, `apps/uw-desktop`) reuses the editor and a sync client, with a local SQLite store and, optionally, a folder of plain markdown files kept in step with it. The web app gets the same sync client behind its service worker later.
- **What may leave the server is decided by the schema.** The sync manifest is generated from each table's and page type's `offlineEligibility`, which is already declared. A `never` row is never sent; it is not filtered by a client. Ledger, gift and donor data never sync.
- **A device registry** records each replica, the areas it holds and when it last connected. A revoked grant purges its areas on next connect, and a replica that stays away too long seals itself.
- **Selective sync** is by area, and the ACL applies at sync time.
- **Provenance.** Every synced or imported fact carries its source and sync state, and a screen shows a failed sync rather than stale data.

## 25. Modules and enablement

`packages/core/modules.ts` already declares some modules as data (key, areas, dependencies, what each owns), and the sidebar marks which entries are built (`apps/uw-platform/views/parts/names.ts`). Still planned:

- **Enablement per scope**, in a table of enablements at `org` or area scope with a pilot flag. A disabled module's routes, verbs, navigation and crons disappear, and its API answers "module not enabled".
- **A boundary check.** A module may depend only on modules it declares, and reaches another only through a typed function or a verb, never by joining into its tables. A check over the schema and the import graph enforces it.
- **Four things per module**: a runbook page, a data-export path, verification steps and its classification declaration.

## 26. Finance, donors and field data

The design fixes these points; the schemas are not written.

- **The ledger** is a double-entry, append-only journal in integer minor units. A posted entry is never edited; a correction is a reversing entry. Its tables are `restricted`, never offline, and its exports are hash-chained. Agents may draft a journal entry; posting is a human gate.
- **Gifts and contacts** are `restricted` to the development area and never offline. A soft credit is a first-class row of the gift model.
- **Field reporting** records that touch protected countries are `sensitive`, with offline copies only by an area admin's dated, per-device opt-in.
- **Money in collections** stays read-through: a collection reads figures from the budget module's feeds and never stores them.
- **Read-access logging** is on for these classes of data and kept separately from operational logs, for seven years.
- **More ingest sources** (payments first) are added to `uw-ingest` as registry entries.

Each lands under the existing rules: one owner module per table, a row read rule before the migration can land, and `can()` on every path.

## 27. The chart primitive

One chart part exists today. The plan is a declarative chart spec (type, a whitelisted query reference, encodings, formatting) in its own package, embedded by any page, view or PDF, with a `render_chart` verb for agents. Every chart states its lineage (query, as-of time, filters, excluded rows), ships a table of its own data and a CSV, and uses the one palette and the shared date and money formatters. The renderer is ECharts to SVG (ADR 0012).

## 28. Backups, drift and stewardship

- **Backups**: point-in-time recovery on the database, nightly logical dumps, a nightly export of the page corpus, all to an object-locked bucket, and a weekly encrypted copy at a second provider.
- **Restore drills** run on a schedule into a fresh database, are scored, and write their result as a page. An overdue drill turns the infrastructure health indicator red.
- **Drift detection** compares the live Cloudflare and AWS configuration to `infra/` nightly and opens an item when they differ.
- **Lifecycle**: dependency and CVE scanning with a remediation window, rotation dates with expiry alarms over `infra/secrets-store.json`, and cost tracking with an alert.
- **An infrastructure steward persona** proposes this work as items with evidence. It may open pull requests and draft runbooks; it may not apply a migration to production, rotate a secret or change an Access policy.

## 29. Observability

Four planes, joined by the trace id that already runs from the edge through queue messages and Cloudflare Workflow steps:

1. **Technical**: structured logs for every request, queue message, step and cron; query statistics; Durable Object health; dead-letter depth.
2. **Data**: freshness and completeness for every synced source, shown where the data is used.
3. **Agent**: per run, persona and queue, the model, tokens, cost, tools called and outcome, with budgets and the breaker.
4. **Human and process**: active use per module, stale pages, aging blocked work and work-in-progress breaches.

Alerts fire on symptoms only and each names the runbook page that resolves it. Health grows from the present indicators to one indicator set per module, on the same screen and the same `get_health` verb. Retention is thirty days of full logs, thirteen months of aggregates and seven years of audit trail.
