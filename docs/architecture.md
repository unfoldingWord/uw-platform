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

Paths with no stage to lock take a named key first: issue import (`github-issue:<id>`), persona activation, the GitHub read model (`github-repo:<id>`, in ascending id, before any `gh_*` row), Zulip topic linking, and the hosted beat's start. Where there is no row to lock, a unique constraint is the guard.

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

**Review sets** (ADR 0037) are rows of `page_review_sets`, `page_suggested_changes` and the append-only `page_review_decisions` (`packages/db/schema-review-sets.ts`), owned by the pages module; migration 0076 adds the triggers that keep a decided set, its changes and every decision as they were. The pure parts sit beside the page code: `pages/anchors.ts` makes and resolves an anchor (offsets, then quote with context, then quote alone, else orphaned), `pages/review-changes.ts` finds overlaps and applies changes, and `pages/word-diff.ts` turns two texts into word changes and suggested changes over jsdiff (`diff`). `pages/review-sets.ts` proposes a set (`propose_review_set`) and reads sets and their changes; `pages/agent-review.ts` is the save path's divert for an agent's save to an active page whose type declares `agentSuggests`, which holds the agent's one pending set after every save check has run; `pages/review-decisions.ts` accepts a set through `updateWithin`, the same transaction a person's save uses, and writes the decision row, or rejects it; only `pages/routes.ts` and the review set screen may import it (`review-decisions-only-from-page-routes`). The person save path (`updatePageWith`) refuses any principal that is not a person on a gated type. The screens are `/pages/:pageId/review-sets/new` (Form shape, from `page-manage.tsx`) and `/pages/:pageId/review-sets/:reviewSetId` (Document shape, from `page-suggestion.tsx`); the version screen compares any two versions by line or by word.

**Markdown export** (`markdown/export.ts`, served by `pages/export-page.ts` at `/api/pages/:pageId/export?mode=`) writes `accepted`, `original` or `marked` text and stamps the front matter with `source`, `exported`, `sha256` (`pdf/page-source.ts` `pageSourceHash`, the PDF footer's hash) and `mode`. `markdown/critic.ts` writes suggested changes as CriticMarkup and reads them back; `markdown/export-verify.ts` reads an export's stamp and checks it against a stored version.

**Suggestion sets** (ADR 0035) are rows of `page_suggestion_sets` (`packages/db/schema-suggestions.ts`), owned by the pages module, made by agents before review sets and no longer made. `pages/suggestion-decisions.ts` still accepts a pending set through `updateWithin` or rejects it; only `pages/routes.ts` and its review screen may import it (`suggestion-decisions-only-from-page-routes`). Migration 0072 adds the trigger that keeps a decided set as it was decided.

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

## 16. GitHub

GitHub is the source of every fact the Ship gate reads.

- **Ingest.** `uw-ingest` verifies the signature, records the delivery (`apps/uw-ingest/deliveries/`) and enqueues it. Its sources are the registry in `apps/uw-ingest/sources/registry.ts`.
- **The read model.** `apps/uw-platform/github/facts/` owns the `gh_*` tables in `packages/db/schema-github.ts`. One guarded upsert (`upsert.ts`) is the only writer, called by the queue consumer and the nightly sweep (`apps/uw-platform/github/sweep.ts`). A fact never moves backwards: a completed check stays completed, and a head change clears the stored file list.
- **The clients.** `apps/uw-platform/github/session.ts` mints one installation token per unit of work, scoped to one repository. No function returns a token. Dependency-cruiser (`tools/architecture/cruise/github.mjs`) fixes who may import the read client, the comment writer and the ship writes; nothing under `mcp/` or `engines/` imports the GitHub module.
- **The ship rule** (`packages/harness/ship-rule.ts`) is a pure function over GitHub facts, the risk tier and the approver's principal. Its only caller is the Ship assembler (`packages/harness/gates/ship-input.ts`, `approve-at-ship.ts`), which refreshes the facts first and refuses stale ones. The risk tier is re-derived from the changed files at the pull request's current head; a declaration in the pull request can only raise it.
- **The merge connector** (`apps/uw-platform/github/merge.ts`) is the one wired effect connector (`apps/uw-platform/ports/connectors.ts`). It re-reads the live pull request and refuses any head, base or repository other than the decided one before it writes. `outcomeOf` reports a merge that already happened without causing one, which is how a lost result is recovered.
- **Issue import.** An open issue with the workflow's label in a repository a workflow names becomes one item, idempotently on the issue's GitHub id.

Green CI is not a guard on its own, because code in a pull request runs in CI. The guards are the Reviewer's approval on the head and the person who approves; workflow tokens are held without `checks: write` (`tools/ci/workflow-permissions.test.ts`).

## 17. The UI layer

- **Tokens.** `packages/ui/tokens/*.css` is the one token system: the brand colours, the semantic theme over them, and the scales (`scales.css`, generated by `pnpm ui:tokens`). `packages/ui/app.css` declares a Tailwind 4 theme whose every value is a token, with Tailwind's defaults reset, so a value not in the tokens does not exist (ADR 0007, ADR 0011). Light and dark follow the system setting with a stored override.
- **Shapes and parts.** `packages/ui/shapes/` holds the page shapes; `packages/ui/components/` holds the parts. A screen imports its shape and its parts and writes no layout or control classes of its own (ADR 0029). Charts are ECharts rendered to SVG (ADR 0012); icons are referenced by token (ADR 0013).
- **Screens.** Every screen is a route in `apps/uw-platform/views/routes.tsx` with its handler in `apps/uw-platform/views/screens/` and an entry in `apps/uw-platform/views/registry.ts`. A screen reads with the request's principal at the request's instant, and renders the same not-found page for what the person may not read as for what does not exist.
- **Islands** are the browser scripts for behaviour the server cannot render (`apps/uw-platform/islands/browser/`), built by `pnpm ui:islands` into `apps/uw-platform/generated/`. They call the command API and never the kernel. On a wake, an island fetches the same URL as a fragment and morphs it in place; a form the person has edited is never replaced, and an older answer never replaces a newer one.
- **Built assets are committed.** The stylesheet (`packages/ui/generated/`) and the island bundles are generated files with hashed paths; tests fail when a committed build is not the current one.
- **Headers.** `apps/uw-platform/http/security-headers.ts` sets a Content-Security-Policy that allows only same-origin scripts; the edit screen alone adds a per-response style nonce for the editor.

The checks are under `tools/ui/`: tokens agree with the theme, no hex colour or arbitrary value outside the token files, Kindle orange only on a human action, each part defined once, and the one-way rule that screens take their layout from `packages/ui`.

## 18. Secrets and health

**Secrets** (ADR 0022). `withSecrets` (`apps/uw-platform/secrets.ts`, `apps/uw-ingest/secrets.ts`, over `packages/core/platform-secrets.ts`) runs at each Worker's entry and returns every secret as a plain string. A secret is read from its Cloudflare Secrets Store binding when one is declared and from the Worker secret otherwise, and a failed store read falls back loudly. `infra/secrets-store.json` lists each secret's owner and rotation date. No secret is in a wrangler file, a workflow file or the repository.

**Health.** `apps/uw-platform/health/indicators.ts` builds the platform indicators, and `/health` shows them with the agent plane. `/health/probe` is public for the deploy check, so it counts sources and states and never names a secret or shows a value.

**Logs.** Each request, queue batch, cron and run step logs structured JSON with a trace id (`packages/core/log.ts`, `packages/core/trace.ts`). Log shipping and retention are declared in `infra/logs/`.

## 19. CI, deploy and release

The procedure and who may do what are in `AGENTS.md`. The mechanics:

- **CI** (`.github/workflows/ci.yml`) runs on every pull request and every push to `develop` or `main`: the dependency audit, lint, typecheck, architecture, the test shards and scenarios against a Postgres service container, and the build. `pnpm verify` runs the same chain locally except the dependency audit.
- **Preview.** Each pull request gets its own Worker (`build-pr.yml`, `deploy-pr.yml`, `cleanup-pr.yml`).
- **Staging** deploys after CI passes on a push to `develop` (`deploy-staging.yml`), never cancelling a deploy mid-migration.
- **Production** deploys by dispatch on a `v*` tag whose commit is on `main` (`deploy-production.yml`).
- **A red CI run** on either long-lived branch opens an issue (`main-alarm.yml`).

Tests under `tools/ci/` hold the workflow files to these rules.

## 20. Every rule is a check

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

## 21. Where a change goes

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

## 22. The public site and publishing

A third Worker, `uw-www`, serves the public site as pre-rendered HTML from R2 and KV with no database dependency, so the site survives a database outage. Publishing is a pipeline: a page is marked for publishing, an area admin approves, a queue renders markdown to HTML in the brand template and writes it to R2, and a publish log records exactly which page version is public. A preview is reachable behind Access before approval. The `publish` connector that this needs is declared and not wired.

## 23. Desktop and offline

- **A desktop app** (Tauri, `apps/uw-desktop`) reuses the editor and a sync client, with a local SQLite store and, optionally, a folder of plain markdown files kept in step with it. The web app gets the same sync client behind its service worker later.
- **What may leave the server is decided by the schema.** The sync manifest is generated from each table's and page type's `offlineEligibility`, which is already declared. A `never` row is never sent; it is not filtered by a client. Ledger, gift and donor data never sync.
- **A device registry** records each replica, the areas it holds and when it last connected. A revoked grant purges its areas on next connect, and a replica that stays away too long seals itself.
- **Selective sync** is by area, and the ACL applies at sync time.
- **Provenance.** Every synced or imported fact carries its source and sync state, and a screen shows a failed sync rather than stale data.

## 24. Modules and enablement

`packages/core/modules.ts` already declares some modules as data (key, areas, dependencies, what each owns), and the sidebar marks which entries are built (`apps/uw-platform/views/parts/names.ts`). Still planned:

- **Enablement per scope**, in a table of enablements at `org` or area scope with a pilot flag. A disabled module's routes, verbs, navigation and crons disappear, and its API answers "module not enabled".
- **A boundary check.** A module may depend only on modules it declares, and reaches another only through a typed function or a verb, never by joining into its tables. A check over the schema and the import graph enforces it.
- **Four things per module**: a runbook page, a data-export path, verification steps and its classification declaration.

## 25. Finance, donors and field data

The design fixes these points; the schemas are not written.

- **The ledger** is a double-entry, append-only journal in integer minor units. A posted entry is never edited; a correction is a reversing entry. Its tables are `restricted`, never offline, and its exports are hash-chained. Agents may draft a journal entry; posting is a human gate.
- **Gifts and contacts** are `restricted` to the development area and never offline. A soft credit is a first-class row of the gift model.
- **Field reporting** records that touch protected countries are `sensitive`, with offline copies only by an area admin's dated, per-device opt-in.
- **Money in collections** stays read-through: a collection reads figures from the budget module's feeds and never stores them.
- **Read-access logging** is on for these classes of data and kept separately from operational logs, for seven years.
- **More ingest sources** (payments first) are added to `uw-ingest` as registry entries.

Each lands under the existing rules: one owner module per table, a row read rule before the migration can land, and `can()` on every path.

## 26. The chart primitive

One chart part exists today. The plan is a declarative chart spec (type, a whitelisted query reference, encodings, formatting) in its own package, embedded by any page, view or PDF, with a `render_chart` verb for agents. Every chart states its lineage (query, as-of time, filters, excluded rows), ships a table of its own data and a CSV, and uses the one palette and the shared date and money formatters. The renderer is ECharts to SVG (ADR 0012).

## 27. Backups, drift and stewardship

- **Backups**: point-in-time recovery on the database, nightly logical dumps, a nightly export of the page corpus, all to an object-locked bucket, and a weekly encrypted copy at a second provider.
- **Restore drills** run on a schedule into a fresh database, are scored, and write their result as a page. An overdue drill turns the infrastructure health indicator red.
- **Drift detection** compares the live Cloudflare and AWS configuration to `infra/` nightly and opens an item when they differ.
- **Lifecycle**: dependency and CVE scanning with a remediation window, rotation dates with expiry alarms over `infra/secrets-store.json`, and cost tracking with an alert.
- **An infrastructure steward persona** proposes this work as items with evidence. It may open pull requests and draft runbooks; it may not apply a migration to production, rotate a secret or change an Access policy.

## 28. Observability

Four planes, joined by the trace id that already runs from the edge through queue messages and Cloudflare Workflow steps:

1. **Technical**: structured logs for every request, queue message, step and cron; query statistics; Durable Object health; dead-letter depth.
2. **Data**: freshness and completeness for every synced source, shown where the data is used.
3. **Agent**: per run, persona and queue, the model, tokens, cost, tools called and outcome, with budgets and the breaker.
4. **Human and process**: active use per module, stale pages, aging blocked work and work-in-progress breaches.

Alerts fire on symptoms only and each names the runbook page that resolves it. Health grows from the present indicators to one indicator set per module, on the same screen and the same `get_health` verb. Retention is thirty days of full logs, thirteen months of aggregates and seven years of audit trail.

## 29. Measures and dashboards

The contracts, the page types, the Resources collection and the tables are written; the runs, the sandbox and the screens are built on them. The features are in `PRD.md`, section 3, Charts, and the rules in ADR 0036.

- **The charts module.** `packages/core/modules.ts` declares `charts`, depending on Core and Strategy. It claims the page types `resource`, `measure` and `dashboard`, the tables `measure_activations`, `measure_runs` and `observations`, and the seven measure verbs.
- **Contracts.** `packages/contracts/measures.ts` holds the closed sets and the measure frontmatter: a runtime from a closed set (only `uvx`), a package pinned as `name==version`, a command as an argument list whose first argument names the tool and in which only `{address}` and `{host}` are filled in, the resources as one saved view, a schedule (every day, every week on a weekday, every month on a day from 1 to 28), the values read at RFC 6901 JSON pointers, an optional `failure_path` (a JSON pointer below the whole output where the tool reports a failure while exiting 0), and the metrics by a rule from a closed set, checked against the values they name. `dashboards.ts` holds the dashboard context (organization, page with or without descendants, a set of resources, or the host page) and the six panel kinds. `measure-commands.ts` holds the person command bodies and `measure-verb-io.ts` the verbs' input and output.
- **One owner module**, `apps/uw-platform/measures/`, owns the three tables in `packages/db/schema-measures.ts`, all `internal` and never offline. `measure_activations` holds, per measure, the activated version, the tool hash, the lock and its SHA-256, the activator, the area, the next run and the paused reason (`changed`, `activator_lost_access` or `retired`). `measure_runs` holds the measure and its version, the tool hash, the kind (trial, scheduled or requested), who asked, the state, the lock and its hash, the refused hosts, the area and the times. `observations` (Drizzle export `observationRecords`, since the owner check reads a bare `observations` as a write) holds the run, the measure and its version, the resource, the time, the tool's version, the values, the outcome, the closed-set reason, the R2 key and SHA-256 of the raw output and the area, one per resource per run. The database refuses values on a failed observation and a failed observation without a reason, so a failure cannot be stored as zero.
- **The tool hash** is the SHA-256 of the canonical JSON of the runtime, package, command and resources. Activation needs a trial run at the current tool hash with at least one ok observation the activating admin may read, and every ok observation they may read must have raw output that the current values, metrics and failure path read without error. Observations of resources the admin cannot read are not judged, as in `save_measure` and `preview_dashboard` (`readsCleanly` in `measures/trial-reads.ts`); when none is readable, Activate answers `trial_required`. A save that changes the tool returns an active measure to `suggested`, pauses it as `changed` and needs a new trial; a save that changes only values, metrics, targets or the report card returns it to `suggested` and pauses it, and activating again needs no new trial.
- **Pages, not new definition tables.** `measure` and `dashboard` are gated page types: an agent's save lands `suggested`, the page API cannot make one `active`, and `confirm_page` refuses both. An agent writes them with the typed verbs `save_measure` and `save_dashboard`, which save through pages-module functions and return each problem with its field; the agent never writes frontmatter or YAML. A dashboard's panels are stored in its body as fenced `panel` blocks of YAML, written and parsed with the `yaml` package in the app and validated by the panel schema. `resource` is a collection page type: a row of the built-in Resources collection (`apps/uw-platform/collections/builtins/resources.ts`, key `resource`), made only by the row verbs. Its properties are kind, address, owner and three one-way relations, `serves_portfolio`, `serves_program` and `serves_project`, stored as `page_links` rows with rel `resource.serves_*`, whose other side shows as a backlink. Product pages are not a target, since no collection lists them. The built-in shared view "Websites" has a fixed id. Built-ins are seeded at runtime by `ensureBuiltIns`, which adds any missing key on the first collection verb or collection screen; an existing database such as staging gains Resources on the first such call after the deploy, and no migration seeds it. There is no record collection over observations in the first version.
- **Platform commands, not verbs and not the harness command surface.** `run_measure_trial`, `activate_measure`, `run_measure_now` and `activate_dashboard` are platform commands at `POST /api/measures/commands/:name` in `apps/uw-platform/measures/routes.ts`, a route file listed in `tools/architecture/command-routes.test.ts`. The harness command dispatcher under `commands/person/` needs a harness, and a measure belongs to an area. Run trial and Activate need `admin` on the measure's area; Run now needs `editor`, as `run_measure` does, and the two share a limit of one run an hour counted from the latest requested run; `activate_dashboard` needs `editor` on the dashboard's area. Activation is one transaction: the activator's grants are re-read under lock, the page's status flips through `pages/gated-flip.ts`, the activation row is written, the measure is scheduled, and any dashboards the command names are made active with it; a refusal rolls all of it back. The Activate control on the measure page lists, as ticked checkboxes, the `suggested` dashboards the person may write that belong with the measure (its report card and each dashboard whose panels name it, found by `offeredDashboards` in `measures/measure-pages.ts` among at most 20 `suggested` dashboards whose body names the measure or that are its report card), and sends the ticked ones. Before that transaction the raw output of the trial's ok observations that the activating admin may read is read back from `FILES` and must read cleanly with the current values and failure path (`trial_unreadable` otherwise, `trial_required` when the admin may read none); activating again at the activated tool hash re-reads the newest run of any kind at that hash whose ok observations still have raw output, and falls back to the trial. Activate also accepts an `active` measure whose activation is paused (`changed` or `activator_lost_access`, never `retired`): it keeps the page as it is, re-checks the trial rules and writes a new activator. Activation sets the next run to the moment of activation, so the first scheduled run starts at the next minute. A trial measures up to three resources of the view: its install step resolves the lock, and every resource installs from it. The dependency-cruiser rules `measure-activation-only-from-measure-routes` and `gated-flip-only-from-measure-activation` keep `measures/trial.ts`, `measures/activation.ts` and the flip out of reach of `mcp/`, the cron and the Workflow. A command whose binding is absent answers `not_wired`.
- **Verbs.** `save_measure`, `save_dashboard`, `run_measure`, `read_measure_run`, `read_metric`, `read_observations` and `preview_dashboard` are registered with their schemas. All seven are served on both hosts. `save_measure`, `save_dashboard`, `run_measure` and `read_measure_run` are handled in `measures/`; `save_measure` and `save_dashboard` save through `pages/gated-save.ts`, which lets an agent update a measure or dashboard that is active and lands it `suggested`, and return problems (an unreadable view, report card, measure, metric, value, page or resource, a report card whose context kind is not `host`, and each value that does not read, and each output that reports a failure at the failure path (`measure.failure_path`), in the output of the trial or newest usable run at the tool hash, by resource and only for resources the caller may read) without refusing the save. A trial whose output is JSON is recorded ok even when the values of the moment do not read in it, so fixing a path needs no second trial; scheduled and requested runs still record `output_unfit`. The command schema refuses a first argument of `uvx`, `uv` or an option. A malformed call answers `malformed_command` with each field and the schema's own message (`issues`). The tool list carries, beside each summary, a guide from `packages/contracts/measure-guides.ts`: the command and package form, JSON pointers, the failure path (`/error` for `geo audit`), recording each site's canonical address after its redirects, the Resources collection key and Websites view id, `set_property` on `serves_*`, a host report card and the flow from `save_measure` to Activate. `run_measure` and Run now share `measures/run-now.ts`, which refuses a measure never activated (`not_permitted`), one paused or changed since activation (`measure_paused`) and a second request within the hour (`run_too_soon`). `read_measure_run` leaves out the observations of resources the reader cannot read, takes an optional `resourceId`, and gives the first three observations (or the one named) an outline of the JSON pointers in the raw output with a sample each, the raw text only when it is short (a long non-JSON output as its tail), and the problems the current values and failure path meet in it; long JSON is never cut. Only those detailed observations read their raw output from `FILES`; every other observation gives the raw length recorded with it when the output was kept (`observations.raw_length`, in UTF-16 code units, cleared with the raw output when it expires). An outline sample is cut to the reply's 80 UTF-16 code units without splitting a character. It names at most 100 refused hosts (`REFUSED_HOSTS_SHOWN`), sorted, leaves out any host longer than 253 characters (`REFUSED_HOST_LENGTH`, which a tool can ask for, port included), and sets `refusedHostsMore` when the run refused more than it names. None starts a trial, activates or makes a dashboard active.
- **The scheduler.** A step of the minute cron, `runDueMeasures`, bounded and idempotent, finds due measures and starts a `MeasureRun` Cloudflare Workflow per run; no cron string is added. Every run, trials and requested runs included, starts only by claiming one of `MEASURE_RUN_SLOTS` (4) slots: `claimSlot` in `measures/runs.ts`, under the advisory lock `measure-run-slots`, counts the open runs that have started and sets the run's `started_at` when one is free, and only then is its Workflow created (`launchRun` in `measures/launch.ts`). A trial or Run now that finds no free slot stays `queued` with no `started_at`, and its command answers `queued`. Each minute the step first starts waiting runs, oldest first, into the free slots (`launchWaiting`), then the due measures with the room left, oldest first; measures left over stay due for the next minute. `MeasureSandbox` allows 6 containers, two more than the slots. A Workflow that cannot be created closes its run as `failed`, and the run is not counted as started; for a scheduled run, `restoreSchedule` puts the measure's next run back to the slot it missed while that slot is less than an hour old, so the next minute tries again, and after that the measure waits for its next slot. Each measure's scheduled slot is 06:00 UTC plus a minute from 0 to 59 hashed from its id, so measures on one schedule spread over the hour. A run's steps are `prepare` (read the view: up to three resources for a trial, up to 500 otherwise, and checkpoint only their ids, so its result stays far below the Workflow step result limit of 1 MiB), `install` (lock and install the package in the sandbox), one checkpointed step per resource, which reads that resource, its address included, under the activator's grants of that moment and skips, recording nothing, a resource they can no longer read, then `release` and `finish`, and each observation is written as it lands, so a deploy or a retry resumes at the next resource. The sandbox steps time out after 15 minutes, longer than the worst case of an install or of one resource (container start 2 minutes, lock 2, install 5, tool 4, each runner call plus 30 seconds' grace), and retry five times from 30 seconds with exponential backoff, so a container pool that is full is waited out; the database steps time out after 2 minutes (`measures/step-budgets.ts`, checked against `SANDBOX_LIMITS` in `measures/sandbox.ts`, which the host's own limits must equal). An error from the sandbox itself, such as no container to start, fails the step for a retry and is never recorded as an unreachable site. A resource step that still fails after its retries is recorded, in a record step of its own, as a failed observation with the reason `tool_failed`, and the run goes on to the next resource; if the install step or any other step fails past its retries, the run still releases the container and runs `finish`, which closes it from the observations it holds against the number of resources `prepare` planned: `ok` only when every planned resource was observed ok, `failed` when none was, and `partial` otherwise, so a run that stopped part way, skipped a resource or lost a record step past its retries is never `ok`. A tool that exits 0 with anything but null, false or empty text at the measure's failure path is recorded failed with no values, as `host_refused` when that job refused a host and `tool_failed` otherwise, and its JSON output is kept as the raw output, so a later save reads it again. A failed install is recorded on every resource with its reason, and no tool runs. The `release` step stops the run's container once no job runs in it. A scheduled run is recorded as asked by the system principal, which only the cron names. Before each step the run re-reads the measure's version and status and the activator's `admin` grant, and pauses the measure with its reason if any changed. Raw output goes to the `FILES` bucket at `measures/raw/<runId>/<resourceId>.json` with its SHA-256, and a step of the nightly cron deletes raw output older than 13 months, at most 500 files a night, as the PDF export expiry does; the bucket has no lifecycle rule for it. The minute cron's measures step, before it starts due runs, closes up to 200 started runs that have been `queued` or `running` for an hour with no progress (no start and no new observation) as `stalled`, and a stalled trial never blocks a new one. A run waiting for a slot has no `started_at` and is never closed as stalled; a waiting trial still counts as the trial in flight. Each run step stops, without pausing, when the run's measure version, tool hash or lock is no longer the activation's, so a run queued or part way through when the measure is activated again at a new version never writes observations of that version, and the prepare step reads the view again when it is replayed after the run started. A person's `update_page` or restore of an `active` measure or dashboard lands it `suggested` and, for a measure, pauses its activation as `changed` in the same transaction (`updatePageWith` with the measures module's `measurePauses`). An agent's `save_measure` over an `active` measure does the same inside its own page transaction (`saveGatedPageAsAgent` with `measurePauses`), and that pause touches only an activation of a version older than the one saved, so it can never pause a later activation.
- **The measure sandbox.** A third container image, `infra/containers/measure/`, holds `uv` and nothing else, with the internet off. The measures module reaches it through one interface: `MeasureSandbox.install(job)` locks (for a trial) and installs the package, `measure(job)`, whose job names the run, the runtime, the package, the lock (none for a trial), the argument list as the measure's template with `{address}` and `{host}` still in it, the address, a time limit (4 minutes, `MEASURE_TIMEOUT_MS`) and an output limit (1 MB), installs again only when the container lost the install and then runs the tool, and `release(runId)` stops the container. The job checks each template argument (at most 500 characters) and the address (a plain `http` or `https` address of at most 2,048 characters) against limits of their own, and `runner.py` fills the address and its host into the template once, inside the container, so a long address never meets the argument limit. There is one container per run, named by the run's id; it runs one job at a time. Its egress goes through the Worker's egress proxy, which forwards the package index's hosts only while packages install, then only the origin of the resource being measured and that origin's `www.` sibling (the apex for a `www.` host, `www.` for any other name, never for an IP address or a single-label name), in the same scheme and port (`siteOrigins` in `packages/contracts/measure-hosts.ts`, which the measure page also uses to list the hosts each resource's run may reach). It resolves names itself, refuses private, loopback, link-local and metadata addresses and any redirect that leaves the allowed origins, and records each refusal on the run. A trial resolves dependencies with hashes and records the lock; every later run installs with that lock and requires the hashes. The container holds no credential and has no verb server.
- **Metrics** are pure functions in `apps/uw-platform/measures/metrics.ts` over the latest non-trial observation of each resource, or its series for a value over time. Failed and missing observations are left out and counted in the coverage, over readable resources only. Scores are never summed, and a change of the tool's version breaks a trend. A context is resolved in `measures/context-resources.ts` to at most 500 resources the reader may read: every resource of a kind, the resources whose `resource.serves_*` link names a page (with its descendants through `program.portfolio` and `project.program` when asked), or a named set. Latest, previous and change give one figure only when the context holds one resource; average, minimum and maximum work over the latest values; count and share meeting a condition count the resources scored. Each resource's value, time and failure reason come from the one observation its rule reads: the latest, or the one before it for previous; a change that cannot be worked out names the failure of either. A figure carries the unit of its rule (`figureUnit`): none for a count, `%` for a share, and the value's unit otherwise, while each resource's reading keeps the value's unit (`unit`). A series is read in SQL as the newest observations of each resource, up to 400 a resource and fewer when many resources share the 20,000-row bound (`seriesOf` in `measures/observation-reads.ts`), so a resource measured seldom is never crowded out by one measured often. `read_metric`, `read_observations` (newest first, an offset cursor, filtered by the resource's area in the query) and `preview_dashboard` (trial observations included, the trial or newest usable run's raw output read again with the measure's current values in `measures/value-checks.ts`, each problem with its field, a host page needed for a report card) are served on both hosts.
- **Panels** are drawn on the server with the chart part of `packages/ui/components/chart.tsx`, its sibling `panel-chart.tsx` (horizontal bars with a dashed target line, and a small line per resource that breaks where the tool's version changes) and the Kpi, Table, Badge and Section parts, not with the chart spec of section 26, which is not built. A trend is drawn as small multiples, one line per resource. A fenced `panel` block renders to a numbered placeholder (`markdown/panel-embeds.ts`) that the page screen fills for each reader after the render cache, as view embeds are. A page embedded with `![[...]]` marks its blocks with its own id (`claimPanels`), so a dashboard embedded by hand is filled the same way, for each reader, on the page screen, the collection row screen, `?format=pdf` and exports (`pdf/print-targets.ts`), with the host page as the context of a dashboard whose context is the host. `withPanels` returns, beside the html, the areas the panels drew from: each dashboard drawn, the measure of each drawn panel and every resource in that dashboard's context (`areas` of `dashboardRead`, since a table lists every resource and coverage counts them). `printPage` and each binder section add them to the page's own area, `render_pdf` stores the union on the export, and the binder Workflow writes the union of the queued areas and the rendered ones when it finishes, so `readExport` asks `can()` for read on every area that reached the file. A block that does not parse is shown in place with its first problem, and a list panel names a resource that was not scored with the reason. A dashboard page is drawn in the Overview shape. Each panel states its source time, gives its figures as a table (a trend as one row for each plotted point, with the resource, time, value and tool version), and offers a CSV at `GET /api/measures/dashboards/:dashboardId/panels/:index` (`?host=` for a report card); a dashboard's figures are JSON at `GET /api/measures/dashboards/:dashboardId` and a measure's latest observations at `GET /api/measures/:measureId`. `?format=pdf` prints the panels as vector through the existing print path; a frozen report that pins the observations is not built yet.
- **Report cards on pages.** A page's read view, on the page screen and on the collection row screen, asks the measures module for the report cards of the resources that serve it or its descendants, found by a join over `page_links` and then the measures with a non-trial observation of any of them (`measures/report-cards.ts`), and renders each with the host page as its context. A card therefore appears once the measure's first scheduled or requested run has recorded, about a minute after activation. The cached page render holds a placeholder, and the figures are read for each reader, as view embeds are. A Measures screen lists the measures and dashboards the reader may read with their state, since Waiting On You is a view over harnesses. A report card is a dashboard whose context is the host page; it is shown only when the measure and the dashboard are both `active` and the reader may read the measure, the dashboard and at least one resource in the card's own context (serving the page, or its descendants only when the card includes them) that the measure has a non-trial observation of. At most ten measures are looked at per page. `?format=pdf` prints the Measures section with the screen; the export path (`pdf/print-targets.ts`, for `render_pdf` and binders) fills panels but does not add the Measures section yet. The Measures section's heading id is `measures-heading` and the measure section's `measure-state-heading`, so a heading in the page body never takes them. The Measures screen is `/measures`, in the sidebar as Measures & Dashboards; it lists at most 300, retired pages left out. `resolve_context` adds `measures`: the latest figure of each metric of each readable measure observing a resource that serves the item's page or its descendants, with no per-resource rows; the measure read verbs are listed among the outside reads of `tools/architecture/untrusted-content.ts`.
- **`preview` answers `not_wired`** for trials and runs, since it has no container or Cloudflare Workflow binding; dashboards still render there from existing observations.
