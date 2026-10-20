# Step 10: Personas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make personas real: a persona page carries its own `status` and a derived `requires_tools`, a person with `admin` activates it after the tool check and a dry run, Builder, Reviewer and Iterate ship as persona pages in the template fixtures, Reviewer hands an item to a person after three rounds, hosted Builder pushes and opens its pull request through the egress proxy, Iterate reads measurements through `query_entities` and routes a labelled revision along a `feeds` edge, learnings and skills are confirmed by a person against the version they read, and every persona page opens on its dashboard.

**Architecture:** The kernel's persona module gains the dry run and the status flip (one conditional `UPDATE` through a new Store gateway method, the only kernel write to `pages`, recorded as an exception) and writes the `personas` projection, which then replaces `pages.read.activePersona` in the hosted beat, poll's subscription and the claim. The page owner (`apps/uw-app/pages/`) derives the server-owned frontmatter fields (persona `status` and `requires_tools`, the learning `contradicts` flag), confirms learnings and skills, and serves the stale-confidence report. Measurements get their writer (a person command at the `iterate` bracket) and a whitelisted query. `submit_to_gate` may attach pages, so a revision travels to `learning_attached` in the same transaction that routes it. The persona view is a server-rendered page over a kernel read, with plain form posts that run the command dispatcher.

**Tech Stack:** TypeScript strict, Zod 4, Hono 4 (JSX, `hono/csrf`), Drizzle over Postgres, PGlite in the sim, Vitest (Node and Workers pools), `yaml` 2.9 (agentskills headers), `@modelcontextprotocol/sdk` (unchanged), Cloudflare Sandbox (unchanged from step 7).

**Spec:** `docs/PRD.md` (approved; no brainstorm, no approval step). Requirements covered: **PE-1, PE-2, PE-3, PE-4, PE-5, PE-6, PE-7, PE-8**, and the KN-7 revision clause. Carries planned here (each closed in Task 9 with its commit): persona frontmatter `status` and the learning contradiction flag (step 1); PE-7 revisions to `learning_attached` and KN-7's revision clause (step 3); the capability words `iterate`, `build`, `review` (step 3, AB-6); PE-8 confirmation pins the version read (step 4); PE-2 `requires_tools` derived (step 4, R22); PE-3 dry run and status flip, PE-7 `measurements_for_item` with the measurements writer, the `personas` projection joining poll's subscription (step 4); PE-3/PE-8 flip as `UPDATE ... WHERE version = expectedVersion` and `activation_required` distinguishable in the UI (step 4); PE-6/HE-9 Reviewer logins seam (step 5); hosted Builder's push and pull request through the egress proxy and its GitHub identity (step 7, PE-5); Reviewer's three-round hand-off (step 7, PE-6); the `personas` projection replacing `pages.read.activePersona` in the beat (step 7, PE-3).

The plan is written against the code as it stands after step 7 (`docs/superpowers/plans/2026-10-03-step-07-hosts-and-engines.md`): `kernel.runs` (`start`, `scene`, `beat`, `hibernateAtGate`, `complete`, `fail`, `holdPremise`, `halt`, `stop`, `prompt`, `reviewDiff`, `postReview`), `packages/harness/engines.ts` (`engineDescriptor`, `hostable`), `packages/harness/runs/tool-loop.ts` (`runToolLoop`, `TURN_LIMIT`), `apps/uw-app/engines/sandbox/egress.ts` (`egress`, `EgressRoutes`), `apps/uw-app/runs/run-core.ts`, `apps/uw-app/github/reviewer-apps.ts`, contract `11.0.0`. Where a step-7 file named here differs in detail from the step-7 plan, follow the code and keep this plan's behaviour.

## Global Constraints

Every task obeys every line here. Copy exact values; do not paraphrase them in code.

- **Where:** the worktree `/home/ianjl/projects/uw-platform-v1`, branch `build/v1`. Implementers commit; they do not push (the controller pushes and watches CI).
- **Read before the first edit:** `AGENTS.md` sections 1, 4, 6 and 10; `CONTEXT.md` for every word (Persona, Learning, Skill, Measurement, Delegation, Beat, Run, Run step, Engine descriptor, Hosted Builder, Egress proxy, Reviewer identity, Scout verdict, Review verdict, and the words Task 1 adds); `docs/exceptions.md`; `docs/architecture.md` sections "The agent boundary" and "Transactions and locks".
- **Verify, at the end of every task, green:** `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. The local server is private; CI uses a Postgres service container. If it is down: `/usr/lib/postgresql/16/bin/pg_ctl -D ~/.local/share/uw-platform-test-pg -o "-p 54329 -k '' -c listen_addresses=127.0.0.1" -l ~/.local/share/uw-platform-test-pg.log start`.
- **R37:** never run two test suites at once. No parallel `pnpm verify`, `pnpm test`, `vitest` or `pnpm sim:all`; wait for one to finish before starting another.
- **DX-8:** no test, binding or job may need a live account or a secret. The Builder GitHub App, the Reviewer logins and the sandbox's GitHub egress are proven against fixtures, a fake `fetch` and the fake container host; their live run is recorded under "Waiting on a person" in Task 9. A missing secret answers `not_wired` and logs; it never throws at startup.
- **Production:** any Cloudflare binding, cron, queue, container or migration of Cloudflare resources goes in `infra/uw-app/wrangler.go-live.toml` only, never `infra/uw-app/wrangler.toml`, and gets a "Waiting on a person" row. This step adds secrets only (`BUILDER_GITHUB_APP_ID`, `BUILDER_GITHUB_APP_INSTALLATION_ID`, `BUILDER_GITHUB_APP_PRIVATE_KEY`), never in any wrangler file.
- **Layering (dependency-cruiser and ESLint):** `packages/contracts` → nothing but `zod`; `packages/core` → contracts; `packages/db` → contracts, core; `packages/harness` → contracts, core types, `yaml`, pure (no Workers, Drizzle, vendor SDK, MCP SDK or network); `apps/uw-app` → harness, db, contracts, core, ui; `sim/` → harness, contracts, db and the Node built-ins `AGENTS.md` lists. A vendor SDK only under `apps/uw-app/engines/<key>/`.
- **Code:** no comments of any kind. Files under 500 lines; functions under 50 lines; ESLint fitness limits: 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters. TypeScript strict, no `any`, no `@ts-ignore`.
- **Commits:** Conventional Commits. The body's last line lists the requirement IDs the commit proves or serves (for example `PE-3 PE-1`). No `Co-Authored-By` and no attribution footer of any kind. Hooks always pass; never `--no-verify`.
- **Shared roots** (`packages/db/schema.ts`, `packages/db/schema-*.ts`, `packages/contracts/`, `packages/harness/ports.ts`, `packages/core/acl.ts`, `infra/`, `.github/workflows/`, `AGENTS.md`, `CONTEXT.md`, `docs/adr/`): a change goes in its own commit with no feature code, and the message names the shared root and why it changed. A migration travels with the `schema*.ts` commit that needs it.
- **Exceptions:** any exception to `AGENTS.md` rules 1 to 4 gets its `docs/exceptions.md` row in the same commit as the code, written before it.
- **Contract version:** Task 1 moves `CONTRACT_VERSION` from `11.0.0` to `11.1.0` (every change is additive) and moves `contractVersion` in `apps/uw-app/package.json` and `apps/uw-ingest/package.json` with it. No later task changes `packages/contracts/`.
- **New closed values (contract 11.1.0):** events `measurement_recorded`, `handed_to_person`; error reasons `activation_required`, `dry_run_failed`; persona activation refusal `dry_run_failed`; harness commands `activate_persona`, `record_measurement`; platform command `confirm_page`; `learning_attached` evidence `kind` (`learning`, `revision`); `handed_to_person` evidence `why` (`review_rounds_exhausted`).
- **Only humans decide gates, activate personas and confirm learnings and skills.** No agent identity can approve, merge, deploy, publish or advance past a human gate, activate a persona, or move a `learning` or `skill` page to `active`, by any route or step.
- **Agents never hold a GitHub client.** The Builder App's token is minted in the host step and injected at the egress proxy; it never enters the sandbox's environment, files, command line, a model message, an MCP reply or a log line.
- **What an agent sees equals what it may act on** (R27, R32, R33): poll and claim apply the same persona and capability rules. Hidden equals missing (`*_not_found`, byte-identical). Delegations are checked on every beat and step.
- **Lock order** (`docs/architecture.md`): stage lock, item rows (ascending id), run rows, grants, then the page row of a persona activation, then appends; nothing locks after the first append. Transactions never nest. No port call inside a Store transaction.
- **One writer per table.** `pages` and `page_versions`: `apps/uw-app/pages/` (and `packages/harness/personas/` through `tx.pages.write.activatePersona` only, the Task 2 exception); `personas`: `packages/harness/personas/`; `measurements`: `packages/harness/measurements/`; `harness_items` and `harness_events`: the kernel's record functions.
- **R36 trace honesty:** a `describe`/`it`/`test` title that leads with a requirement ID must prove that requirement's clauses; supporting tests lead with no ID. Scenarios are `sim/scenarios/<ID>.<slug>.ts`.
- **Kernel instants and callers:** every kernel command takes a `Caller` (`{ actor, traceId, requestId }`) and reads `ports.clock.now()` once; every route judges at its own instant.
- **Copy:** sentence case, second person, no exclamation marks, no emoji; `unfoldingWord` camelCase. Kindle marks a human action and nothing else.

## Review Focus

The inputs the PRD implies but no requirement names, most likely first. Each line's test lives in the task named.

1. **A person activates a persona after an agent re-saved the suggested page:** the version they saw is stale; `stale_version` `{ pageId, version }`, nothing recorded, the page stays `suggested`. Test in Task 4.
2. **Two people press Activate on the same page at once:** exactly one `persona_activated`, one page version bump, one projection row; the other answers `stale_version` or `not_permitted` `{ why: 'not_suggested' }`. Two-connection test in Task 4.
3. **A persona page naming an identity another active page already holds:** refused `not_permitted` `{ why: 'identity_in_use' }`, nothing recorded. Test in Task 4.
4. **A sandbox push naming a second ref, deleting `harness/<item>`, or a pull request with another head or base:** `403 egress refused`, no token sent upstream. Test in Task 7.
5. **A revision attached by an agent that does not hold the item, or a revision of another area:** `not_holder` or `page_not_found`, nothing recorded. Test in Task 5.
6. **A learning that supersedes only retired learnings:** no contradiction flag. Test in Task 3.

## Decisions this plan makes

Choices the PRD, the spec and `AGENTS.md` leave open. Task 9 copies each into `docs/progress_tracker.md` "Decisions made during the build" with the cost if wrong.

| # | Decision | Cost if wrong |
|---|---|---|
| S10-D1 | PE-1's frontmatter `status` mirrors `pages.status`, written by the server on every page write (default `suggested` in the schema); an input whose persona frontmatter names a `status` other than the status the page lands in is refused `activation_required`. `pages.status` stays the one source of truth (step-1 decision) | A client that echoes an old `status` after an activation must re-read the page |
| S10-D2 | A persona `toolset` accepts any verb-shaped name (`^[a-z][a-z_]*$`, at most 64 characters, at most 50 entries, distinct) so a missing verb can still be named (D14, AB-8); `requires_tools` is derived on every write as the toolset in order, and any `requires_tools` in the input is replaced; the toolset form offers only served registry verbs the creator reaches, never a forbidden verb | A person writing raw JSON may name a verb that does not exist; activation then opens the AB-8 item, by design |
| S10-D3 | The dry run (P28) is pure and writes nothing: the persona's body must open with an agentskills header (`name` equal to the persona slug, `description` 1 to 1,024 characters, a non-empty body after it); the engine must host the run shape (`hostable`); a `workflow-run` persona must resolve a provider (its own or the engine's default); a `review` persona may not hold `write_page`; then one `claude-messages`-shaped turn runs through `runToolLoop` against a fixture item with a scripted fixture turn and tools that refuse every call. The first problem fails activation `dry_run_failed` with a one-line message and records `persona_activation_failed` | A model-level fault (a model id the vendor refuses) is found at the first real run, not at activation |
| S10-D4 | Activation flips status through `tx.pages.write.activatePersona`: `UPDATE pages SET status = 'active', version = version + 1, frontmatter = jsonb_set(frontmatter, '{status}', '"active"') WHERE id = $1 AND type = 'persona' AND status = 'suggested' AND version = $2 RETURNING *`, plus the `page_versions` snapshot; no row answers `stale_version`. It is the only kernel write to `pages`, recorded in `docs/exceptions.md`; the owners check allows exactly that call from `packages/harness/personas/` | A second kernel writer to `pages`; mitigated by the check pinning it to one call |
| S10-D5 | Activation writes the `personas` projection row (`identity`, `harnessId`, `pageId`; upsert on `identity`) in the same transaction and records `persona_activated` `{ pageId, persona, version }`. An identity whose projection row names another page that is still `active` is refused `not_permitted` `{ why: 'identity_in_use' }`. Every projection read joins `pages` and requires the page `active` with the same `identity` and `harness` in its frontmatter, so a retired or edited page drops out without a projection write | Retiring a persona leaves a stale row that readers ignore; the row is replaced at the next activation |
| S10-D6 | The projection replaces `pages.read.activePersona` everywhere (the hosted beat, `kernel.runs.start`), and a delegated or bare persona principal polls and claims only on a harness where its persona is active (`not_permitted` `{ why: 'persona_not_active' }` on claim); `pages.read.activePersona` is deleted once a grep finds no caller | A delegation for a persona whose page is retired stops working at once |
| S10-D7 | `activate_persona` is a harness command (`POST /api/harness/:harness/commands/activate_persona`, body `{ pageId, expectedVersion }`), action `admin`, agents refused; a page whose frontmatter `harness` is not the route's harness is `page_not_found` | One more route under `can()` |
| S10-D8 | The page API's refusal for activating a gated page becomes its own reason `activation_required` (was `not_permitted` `{ why: 'activation_required' }`), so a client can tell it apart without the detail the HTTP outcome omits | Clients matching the old reason break; none exists outside this repo |
| S10-D9 | `confirm_page` (platform command on `POST /api/pages/commands/confirm_page`, body `{ pageId, expectedVersion }`) moves a `suggested` `learning` or `skill` page to `active`: a person principal only (agents `not_permitted`), `write` on the page's area, `UPDATE ... WHERE id = $1 AND version = $2 AND status = 'suggested'` under the row lock (no row: `stale_version`), a `page_versions` snapshot attributed to the person. A `persona` is `not_permitted` `{ why: 'persona_needs_activation' }`; any other type `malformed_command` `{ why: 'not_confirmable' }` | An editor, not only an admin, can confirm a learning |
| S10-D10 | The contradiction flag is `contradicts` on the newer learning, derived by the page writer on every write: true when `supersedes` names at least one `learning` page whose status is not `retired`; an input value is replaced (P30: detection by `supersedes` alone) | The older learning carries no mark; readers find the contradiction from the newer one |
| S10-D11 | Stale learnings are `learning` pages in `suggested` or `active` whose `confidence` is `assumed` or `inferred` and whose review date (`review_by`, else `as_of` + 90 days, P30) is before today (UTC). The report is `GET /api/pages/reports/stale-learnings` (rows the caller may read, oldest review date first, at most 100); the `stale_learnings` indicator on `get_health` counts those in the harness's area and on `/health` counts all (an aggregate); `ok` at 0, `amber` above | A learning with a review date of today is not yet stale |
| S10-D12 | A stage's instructions page must be a `skill` page in the harness's area: another readable type is `malformed_command` `{ why: 'instructions_not_skill' }` (missing, hidden, other-area or `issue` stays `page_not_found`, S6-R56) | An admin cannot point a stage at a learning or a product page |
| S10-D13 | Measurements are written by `record_measurement` (harness command, a person with `write`, agents refused) on an item whose stage's bracket is `iterate`; source from the `data-sources` kind set, name 1 to 100 characters, a finite value, `asOf` a date not after today; event `measurement_recorded`. No verb writes a measurement. `query_entities` `measurements_for_item` `{ itemId }` answers at most 50 rows, newest `asOf` first, through the kernel's item read (hidden equals missing) | Measurements cannot be recorded before Validate; connectors that feed them come after v1 |
| S10-D14 | Attaching widens: besides a `suggested` `learning` or `skill`, an item may carry a revision, a `product`, `system_goal`, `product_strategy` or `data_sources` page in `draft` or `suggested` in the harness's area (`learning_attached` `{ pageId, kind: 'revision' }`). `learning_attached` still passes only with a learning, a skill or a signed `nothing_learned`, and checks evidence labels on every attached page that is not a skill, revisions included (KN-7). `submit_to_gate` (the verb) gains `attach` (at most 10 page ids), recorded before the validators in the submit's transaction; the person `submit_to_gate` command does not | A person cannot attach through the command API in v1; they attach through the kernel's existing path only in tests |
| S10-D15 | AB-6: the capability words keep one grant (`editor` on the area; `none` gives none); they narrow where a delegated principal works by stage bracket: `build` and `review` reach `build_package`, `iterate` reaches `iterate`. Poll filters and claim refuses `pickup_not_allowed` `{ stage, capability }` outside it. The review path stays gated on `review` (step 7) | A Builder cannot claim a Close item under a delegation; a review delegation can still claim a Build item (both are `build_package`) |
| S10-D16 | Template personas are data in `packages/harness/templates/personas.ts`; `activate_template` drafts them as `suggested` persona pages through the page owner, attributed to the activating admin, slug `persona-<slug>`, skipping one whose slug is taken in the area; an admin then activates each. Software: `agent:builder` (external-run, `external`), `agent:builder-hosted` (workflow-run, `claude-code-sandbox`), `agent:reviewer` (workflow-run, `openrouter-messages`), `agent:reviewer-codex` (workflow-run, `codex-sandbox`); BML: `agent:iterate` (workflow-run, `openrouter-messages`). Models and providers are placeholders (Q10, P29) | A second harness from the same template drafts no personas while the first holds the slugs; it needs its own pages |
| S10-D17 | The Reviewer identity seam is the reviewed table in `packages/harness/github/reviewers.ts`, which gains the persona each login belongs to (`agent:reviewer` → `uw-reviewer[bot]`, `agent:reviewer-codex` → `uw-reviewer-codex[bot]`), and a new reviewed `packages/harness/github/builder.ts` (`agent:builder-hosted` → `uw-builder[bot]`); a test binds the fixtures, the engine descriptors and the table, and a Builder login never counts as a Reviewer. The logins stay placeholders until an org owner registers the Apps | Until then no review counts and nothing ships, as today |
| S10-D18 | Review rounds: when a review run posts `request_changes` and it is the third such review on the item since the item last entered its stage, the same transaction records `checks_failed` `{ stage, failures: ['review_rounds_exhausted'] }` and `handed_to_person` `{ personId, why: 'review_rounds_exhausted', rounds }` with the run's delegation's person; the fold makes that person the holder with no lease, so no agent can claim it | The person may no longer hold a grant; they can still release it, and an admin can take it over |
| S10-D19 | Hosted Builder's GitHub: its own App `uw-builder` (`contents: write`, `pull_requests: write`, `metadata: read`, no events), a token minted in the host step per work step for the harness's one repository; the egress proxy allows fetches of that repository, a push whose every ref update targets `refs/heads/harness/<item>` and deletes nothing, `GET /repos/<repo>/pulls` and `POST /repos/<repo>/pulls` whose `head` is `harness/<item>`, whose `base` is the default branch and whose body opens with a declaration the PR declaration parser accepts; everything else is `403` | A Builder cannot comment on or edit its pull request after opening it in v1 |
| S10-D20 | The persona view is `GET /personas/:pageId` (server-rendered in the shell); "today" is since 00:00 UTC; escalation rate is runs ended today whose result is `premise_held` or `review_refused`, that failed, or whose item was `handed_to_person`, over runs ended today; gate refusals are `gate_refused_to_agent` and `checks_failed` events by the persona's identities today; delegations are listed to an `admin` on the harness's area and counted for everyone else. Activate and the toolset form are `<form method="post">` posts (`hono/csrf`) to `POST /personas/:pageId/activate` and `POST /personas/:pageId/toolset`, which run `executeCommand` and `updatePage` and re-render the view with the outcome beside the control | No live refresh of the dashboard until a view adopts the live client |

---

### Task 1: Contract 11.1.0, the migration that admits it, and the words

**Requirements:** PE-1, PE-2, PE-3, PE-6, PE-7, PE-8 (the contract half of each); CT-3 (the lock).

**Files:**
- Modify (commit 1, shared root `packages/contracts/`): `packages/contracts/page-types.ts`, `packages/contracts/events.ts`, `packages/contracts/event-evidence.ts`, `packages/contracts/outcomes.ts`, `packages/contracts/commands.ts`, `packages/contracts/platform-commands.ts`, `packages/contracts/pages.ts`, `packages/contracts/registry.ts`, `packages/contracts/verb-io.ts`, `packages/contracts/version.ts`, `packages/contracts/contract-lock.json`, the golden fixtures under `packages/contracts/fixtures/` and `packages/contracts/verb-fixtures/submit_to_gate/`, `packages/contracts/*.test.ts` that pin lists, `apps/uw-app/package.json` and `apps/uw-ingest/package.json` (`contractVersion`)
- Modify (commit 2, shared root `packages/db/`): `packages/db/migrations/<next>_contract_11_1_checks.sql` (generated by `pnpm db:generate`, renamed to the next free number with that suffix, as `0023_contract_11_checks.sql` was) and `packages/db/migrations/meta/`
- Modify (commit 3, shared root `CONTEXT.md` and the PRD): `CONTEXT.md`, `docs/PRD.md`

**Contract changes (exact):**

```ts
const verbShaped = z.string().regex(/^[a-z][a-z_]*$/).max(64);

export const learningFrontmatterSchema = z.strictObject({
  confidence: evidenceLabelSchema,
  as_of: z.iso.date(),
  supersedes: z.array(z.uuid()),
  review_by: z.iso.date().nullable(),
  contradicts: z.boolean().default(false),
});

export const personaFrontmatterSchema = z.strictObject({
  identity: agentIdentity,
  owner: humanIdentity,
  harness: z.uuid(),
  toolset: z.array(verbShaped).max(50).refine(distinct, 'a toolset names each verb once'),
  run_shape: runShapeSchema,
  engine: engineSchema,
  model: z.string().min(1).max(200),
  provider: providerIdSchema.nullable().default(null),
  budget: z.strictObject({
    monthly_minor: z.number().int().min(0),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  capability: capabilityWordSchema,
  requires_tools: z.array(verbShaped).max(50).refine(distinct).default([]),
  status: pageStatusSchema.default('suggested'),
});
```

- `events.ts`: append `measurement_recorded` and `handed_to_person` to the event names (after `persona_activated`; update the test that pins the last name).
- `event-evidence.ts`: `personaActivationRefusalSchema` gains `dry_run_failed`; new evidence `persona_activated: z.strictObject({ pageId: id, persona: personaIdentitySchema, version: z.number().int().min(1) })`; `learning_attached: z.strictObject({ pageId: id, kind: z.enum(['learning', 'revision']).default('learning') })`; `measurement_recorded: z.strictObject({ measurementId: id, source: dataSourceKindSchema, name: z.string().min(1).max(100), value: z.number().finite(), asOf: z.iso.date() })`; `handed_to_person: z.strictObject({ personId: id, why: z.enum(['review_rounds_exhausted']), rounds: z.number().int().min(1) })`. Register the two new `why`/`kind` enums in the lock like the step-1 inline enums.
- `outcomes.ts`: `errorReasonSchema` gains `activation_required` and `dry_run_failed`.
- `commands.ts`: `commandNames` gains `activate_persona` and `record_measurement`; `harnessCommandSchemas.activate_persona = body('activate_persona', { pageId: z.uuid(), expectedVersion: z.number().int().min(1) })`; `harnessCommandSchemas.record_measurement = body('record_measurement', { itemId, source: dataSourceKindSchema, name: nonBlank(100), value: z.number().finite(), asOf: z.iso.date() })`; both join `commandSchema`.
- `platform-commands.ts` gains `confirm_page`; `pages.ts` gains `confirmPageCommandSchema = z.object({ command: z.literal('confirm_page'), requestId: z.uuid(), pageId: z.uuid(), expectedVersion: z.number().int().min(1) })` and `ConfirmPageCommand`; `registry.ts` registers it as `'confirm-page-command'`.
- `verb-io.ts` `submit_to_gate.input` gains `attach: z.array(z.uuid()).max(10).refine(distinct).default([])` inside the strict object (the refine on pull request and head unchanged).
- `version.ts`: `CONTRACT_VERSION = '11.1.0'`; the lock gains an `11.1.0` entry listing the grown sets (add-only, so minor).

**CONTEXT.md words** (Task 1's third commit; each with an _Avoid_ line in the file's form): **Activation** (a person with `admin` turning a `suggested` persona page `active` after the tool check and the dry run; the only way a persona runs), **Dry run** (the pure check and one fixture turn activation runs; writes nothing), **Confirmation** (a person turning a `suggested` learning or skill `active` at the version they read), **Revision** (a page an Iterate run drafts to change the Product Package, attached to the item and routed along a `feeds` edge; every claim labelled), **Contradiction** (a learning whose `supersedes` names an unretired learning; flagged on the newer one), **Stale learning** (an `assumed` or `inferred` learning past its review date), **Review round** (one review a Reviewer posts on an item; the third `request_changes` since the item entered its stage hands it to a person), **Hand-off** (an item given to a named person by the kernel, with no lease; event `handed_to_person`), **Persona view** (a persona page's default view: its dashboard). Edit **Persona** to name the five fixture personas and say they live in the template fixtures.

**PRD edits** (same commit): 8.3 persona activation refusal gains `dry_run_failed`; 8.5 "Added in step 10: `activation_required`, `dry_run_failed`"; 8.6 the two events and a paragraph naming their evidence; 8.1 `measurements` written by "the measurements module, through `record_measurement`"; 8.2 unchanged.

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/page-types.test.ts`:
- `PE-1 a persona page's frontmatter carries status, defaulting to suggested` (parse without `status` → `suggested`; `status: 'active'` parses; `status: 'live'` fails)
- `PE-2 a toolset may name a verb that does not exist yet, and requires_tools defaults to empty` (`toolset: ['summarise_measurements']` parses; `'Bad'` and a 65-character name fail; 51 entries fail)
- `PE-8 a learning carries a contradiction flag, false by default`

In `packages/contracts/events.test.ts`: `PE-6 handed_to_person names the person, the reason and the round count`; `PE-7 measurement_recorded carries the source, name, value and date`; `PE-3 persona_activated names the page, the persona and the new version`.

In `packages/contracts/commands.test.ts`: `PE-3 activate_persona names the page and the version the person saw` (strict: an extra key fails); `PE-7 record_measurement refuses a non-finite value`.

In `packages/contracts/verbs.test.ts` (or the file pinning `verbIo`): `PE-7 submit_to_gate may attach up to ten distinct pages` (11 fail, a duplicate fails, absent defaults to `[]`).

`packages/contracts/contract-lock.test.ts` already proves add-only is minor; it must pass with the new entry.

- [ ] **Step 2:** Run `pnpm vitest run packages/contracts`; expected FAIL.
- [ ] **Step 3:** Implement the contract; regenerate fixtures the way `packages/contracts/fixtures/README` (or the fixtures test) says; move both apps' `contractVersion`.
- [ ] **Step 4:** `pnpm db:generate`, rename the migration to `<next>_contract_11_1_checks.sql`; it must only drop and re-add `harness_events_name_known` and `command_requests_command_known`. Run `pnpm vitest run packages/db` and the schema drift check.
- [ ] **Step 5: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add packages/contracts apps/uw-app/package.json apps/uw-ingest/package.json
git commit -m "feat(contracts): contract 11.1.0, persona status and derived tools, contradiction flag, measurements, hand-off, activation and confirmation

Shared root packages/contracts/: every change is additive, so the version is minor.

PE-1 PE-2 PE-3 PE-6 PE-7 PE-8"
git add packages/db/migrations
git commit -m "feat(db): the event-name and command-name checks admit contract 11.1.0

Shared root packages/db/: the CHECK constraints follow the contract's closed sets (P4).

PE-3 PE-6 PE-7"
git add CONTEXT.md docs/PRD.md
git commit -m "docs(context): activation, dry run, confirmation, revision, contradiction, stale learning, review round, hand-off, persona view

Shared root CONTEXT.md: the words step 10 uses.

PE-1 PE-3 PE-6 PE-7 PE-8"
```

---

### Task 2: The Store gains the persona flip, the personas projection, measurements and the persona's runs and counts

**Requirements:** PE-3, PE-4, PE-7 (the gateways); DX-3 (their port contracts).

**Files:**
- Modify (commit 1, shared root): `packages/harness/ports.ts`
- Modify (commit 2): `packages/db/store/pages.ts`, `packages/db/store/types.ts`, `packages/db/store/store.ts` (bind the new gateways), `packages/db/store/runs.ts`, `packages/db/store/events.ts`; create `packages/db/store/personas.ts`, `packages/db/store/measurements.ts`; port contracts: modify `packages/harness/port-contracts/store-runs.ts` and the pages and events suites, create `packages/harness/port-contracts/store-personas.ts`, `packages/harness/port-contracts/store-measurements.ts` (and register them where `tools/architecture/port-contracts.test.ts` expects); `tools/architecture/owners.test.ts`; `docs/exceptions.md`

**Port types** (`packages/harness/ports.ts`, added; `PagesGateway` gains `write`, `StoreTransaction` gains `personas` and `measurements`):

```ts
export type PersonaActivation = {
  readonly pageId: string;
  readonly expectedVersion: number;
  readonly editSource: Identity;
  readonly traceId: string;
};
export type PagesGateway = {
  readonly read: {
    facts(pageIds: readonly string[]): Promise<readonly PageFacts[]>;
    activePersona(identity: Identity, harnessId: string): Promise<PageFacts | null>;
  };
  readonly write: { activatePersona(activation: PersonaActivation): Promise<PageFacts | null> };
};

export type PersonaRow = { readonly identity: Identity; readonly harnessId: string; readonly pageId: string };
export type PersonasGateway = {
  readonly read: {
    byIdentity(identity: Identity): Promise<PersonaRow | null>;
    active(identity: Identity, harnessId: string): Promise<PageFacts | null>;
  };
  readonly write: { upsert(row: PersonaRow): Promise<void> };
};

export type MeasurementRow = {
  readonly id: string;
  readonly harnessId: string;
  readonly itemId: string;
  readonly source: DataSourceKind;
  readonly name: string;
  readonly value: number;
  readonly asOf: string;
  readonly recordedAt: Date;
};
export type MeasurementsGateway = {
  readonly read: { forItem(itemId: string, limit: number): Promise<readonly MeasurementRow[]> };
  readonly write: { insert(row: MeasurementRow): Promise<void> };
};

export type PersonaRunQuery = {
  readonly identity: Identity;
  readonly harnessId: string;
  readonly since: Date | null;
  readonly limit: number;
};
export type PersonaEventCount = {
  readonly harnessId: string;
  readonly personaSlug: string;
  readonly names: readonly EventName[];
  readonly since: Date;
};
```

`HarnessRunsGateway.read` gains `forPersona(query: PersonaRunQuery): Promise<readonly RunRow[]>` (runs whose `persona` is the identity on the harness, `startedAt >= since` when `since` is set, newest `startedAt` first, at most `limit`). `HarnessEventsGateway.read` gains `countForPersona(query: PersonaEventCount): Promise<ReadonlyMap<EventName, number>>` (events on the harness at or after `since` whose name is listed and whose `actor` is `agent:<slug>` or ends `as <slug> via delegation:<uuid>`; it lives in `packages/db/store/events.ts`, the one event read path, and the slug is matched exactly, not as a `LIKE` pattern: `actor = 'agent:' || $slug OR (actor ~ ' as ' || $slug || ' via delegation:[0-9a-f-]{36}$')` with the slug checked against `^[a-z0-9][a-z0-9-]*$` first, a non-matching slug answering an empty map). `DataSourceKind` and `EventName` are imported from `@uw/contracts`.

**`activatePersona` SQL** (`packages/db/store/pages.ts`, in the caller's transaction):

```sql
UPDATE pages
SET status = 'active',
    version = version + 1,
    frontmatter = jsonb_set(frontmatter, '{status}', '"active"'),
    updated_at = now()
WHERE id = $pageId AND type = 'persona' AND status = 'suggested' AND version = $expectedVersion
RETURNING *
```

then insert the `page_versions` snapshot of the returned row with `edit_source = editSource` and `trace_id = traceId` (the same columns `apps/uw-app/pages/store.ts` `snapshot` writes), and answer its `PageFacts`; no row answers `null`.

**`personas` gateway:** `upsert` is `INSERT ... ON CONFLICT (identity) DO UPDATE SET harness_id = EXCLUDED.harness_id, page_id = EXCLUDED.page_id`; `active(identity, harnessId)` joins `pages` on `page_id` and answers the page's facts only when the row's harness is `harnessId`, the page is `persona`, `active`, and its frontmatter `identity` and `harness` equal the row's and parse with `personaFrontmatterSchema` (else `null`, fail closed as `activePersona` does).

**Measurements gateway:** `forItem` orders `as_of DESC, recorded_at DESC, id`; `insert` writes one row.

**Owners check and exception:** `tools/architecture/owners.test.ts` gains

```ts
const narrowWrites = [
  { dir: 'packages/harness/personas/', table: 'pages', call: /\btx\.pages\.write\.activatePersona\(/g },
] as const;
```

and `writersOutsideOwner` skips a file under a listed `dir` when, after removing every match of its `call`, the file no longer `writes` the table. A planted case: a file under `packages/harness/personas/` calling `tx.pages.write.activatePersona(` passes; one calling `tx.pages.write.other(` or `db.update(pages)` fails; a file under `packages/harness/items/` calling `activatePersona` fails. `docs/exceptions.md` gains (date 2026-10-03) a Rule 3 row: `packages/harness/personas/` (`tx.pages.write.activatePersona`) — "Activation must flip the persona page's status, write the `personas` projection and record `persona_activated` in one transaction (S10-D4), and only the kernel's Store transaction can hold all three; the write is one conditional `UPDATE` of `status`, `version` and the frontmatter `status`, plus its `page_versions` snapshot, and the owners check pins it to that call" — Review: "Revisit if the page owner gains a way to join a kernel transaction."

- [ ] **Step 1: Write the failing tests** (port contract cases run against the PGlite Store and the server Store, both binding `packages/db/store`)
  - `store-pages`: `PE-3 activatePersona flips a suggested persona at the expected version and snapshots it`; `PE-3 activatePersona answers null for a stale version, an active page or another type, and changes nothing`.
  - `store-personas`: `PE-3 the projection upserts on identity and answers the active page`; `PE-3 the projection answers nothing for a retired page or one whose frontmatter names another identity or harness`.
  - `store-measurements`: `PE-7 measurements for an item come newest first and at most the limit`.
  - `store-runs`: `PE-4 a persona's runs on a harness come newest first, since an instant`.
  - events suite: `PE-4 events are counted per persona across its bare and delegated identities`; a planted `%`-bearing slug answers an empty map (titled without an ID).
  - `owners.test.ts` planted cases (titled without an ID).
- [ ] **Step 2:** Run `pnpm vitest run packages/db packages/harness/port-contracts tools/architecture/owners.test.ts`; expected FAIL.
- [ ] **Step 3:** Implement: ports commit, then the store, the contracts, the owners check and the exception row together.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add packages/harness/ports.ts
git commit -m "feat(harness): the store port gains the persona flip, the personas projection, measurements and a persona's runs and event counts

Shared root packages/harness/ports.ts.

PE-3 PE-4 PE-7"
git add packages/db packages/harness/port-contracts tools/architecture docs/exceptions.md
git commit -m "feat(db): the persona flip, the projection, measurements and persona reads in the shared store

PE-3 PE-4 PE-7 DX-3"
```

---

### Task 3: Page writes derive persona and learning fields; a person confirms a learning or skill; the stale-confidence report; instructions pages are skills

**Requirements:** PE-1, PE-2 (derived `requires_tools`, agent drafts land `suggested`), PE-8 (confirmation, contradiction, stale report and indicator, skills validate).

**Files:**
- Create: `apps/uw-app/pages/derive.ts`, `apps/uw-app/pages/derive.test.ts`, `apps/uw-app/pages/confirm.ts`, `apps/uw-app/pages/confirm.pg.test.ts`, `apps/uw-app/pages/stale.ts`, `apps/uw-app/pages/stale.pg.test.ts`, `apps/uw-app/pages/derive.pg.test.ts`
- Modify: `apps/uw-app/pages/store.ts` (create and update write the derived frontmatter; `activationRequired` becomes reason `activation_required` with no detail), `apps/uw-app/pages/agent-write.ts` (the same derivation through `updateCheckedPage` and `createPage`), `apps/uw-app/pages/routes.ts` (`confirm_page` handler; `GET /reports/stale-learnings` registered before `/:pageId`), `apps/uw-app/pages/gated-activation.pg.test.ts` (the reason changes), `apps/uw-app/mcp/verbs/get-health.ts` (the `stale_learnings` indicator), `apps/uw-app/health/indicators.ts` (the public aggregate), `packages/harness/stages/commands.ts` (`instructionsRefusal`), `sim/kernel/stage-command.test.ts`, `docs/exceptions.md` (one row for `apps/uw-app/pages/stale.ts`, a reader beside the owner like `pages/reads.ts`), `tools/skills/sync-harness-skill.test.ts`

If step 8 has already moved `get_health`'s WB-10 indicators out of `get-health.ts`, grep `stale_learnings` and wire the indicator where it now lives; the behaviour below is unchanged.

**`apps/uw-app/pages/derive.ts`:**

```ts
export type Landing = { readonly status: PageStatus };
export type DerivedFrontmatter =
  | { readonly ok: true; readonly frontmatter: Record<string, unknown> }
  | { readonly ok: false; readonly reason: 'activation_required' };

export async function derivedFrontmatter(
  tx: Executor,
  type: PageType,
  parsed: Record<string, unknown>,
  input: Readonly<Record<string, unknown>>,
  landing: Landing,
): Promise<DerivedFrontmatter>;
```

- `persona`: if `input` has an own `status` key and it is not `landing.status` → `{ ok: false, reason: 'activation_required' }`; else `{ ...parsed, status: landing.status, requires_tools: [...parsed.toolset] }`.
- `learning`: `contradicts` is true when `parsed.supersedes` is non-empty and `SELECT 1 FROM pages WHERE id = ANY($supersedes) AND type = 'learning' AND status <> 'retired' LIMIT 1` finds a row; else false. The input's `contradicts` is replaced.
- any other type: `parsed` unchanged.

`createPage` and `updateInTransaction` (and the agent write) call it after `checkFrontmatter` with the landing status (create: `command.status`, or `suggested`/`draft` for an agent; update: the status `statusFor` chose) and write the derived object, not `command.frontmatter`. `createPage` now runs the derivation inside its transaction.

**`apps/uw-app/pages/confirm.ts`:** `confirmPage(db, actor, command: ConfirmPageCommand, traceId, at): Promise<PageResult | PageRefusal>` per S10-D9, in one transaction: `actor.kind !== 'person'` → `not_permitted`; `lockedPage` (row lock; unreadable → `page_not_found`); type `persona` → `not_permitted` `{ why: 'persona_needs_activation' }`; type not `learning`/`skill` → `malformed_command` `{ why: 'not_confirmable' }`; no `write` on the area → `not_permitted`; status not `suggested` → `not_permitted` `{ why: 'not_suggested' }`; `UPDATE pages SET status = 'active', version = version + 1, updated_at = now() WHERE id = $1 AND version = $2 AND status = 'suggested' RETURNING *` (no row → `stale_version`); the snapshot with `editSource = actor.identity`.

**`apps/uw-app/pages/stale.ts`:** `staleLearnings(db, actor, query: { readonly jdArea: JdArea | null; readonly today: string; readonly limit: number }): Promise<readonly StaleLearning[]>` with `StaleLearning = { pageId, title, jdArea, confidence: 'assumed' | 'inferred', asOf, reviewBy }` (`reviewBy` the effective date), filtered in SQL to the areas `readableAreas(actor)` reaches (as `pages/reads.ts` does), ordered by the effective review date then id; and `staleLearningCount(db, jdArea: JdArea | null, today: string): Promise<number>` (no actor; an aggregate). The effective date is `coalesce((frontmatter->>'review_by')::date, (frontmatter->>'as_of')::date + 90)` guarded by the same calendar-shape check `resolve_context` uses (minor 9 of step 4), so a malformed date never throws.

Indicators: `get_health` `stale_learnings` → `staleLearningCount(db, harness.jdArea, today)`: `ok` "no stale learnings" at 0, else `amber` "<n> stale learnings"; `/health` the same with `jdArea: null`, and `not_configured` without a database.

**Instructions pages:** `instructionsRefusal` keeps `page_not_found` for a missing page, an `issue` page or one outside the harness's area, and answers `malformed_command` `{ why: 'instructions_not_skill' }` for any other non-`skill` type.

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/pages/derive.test.ts` (pure part) and `derive.pg.test.ts`:
- `PE-1 a persona page's frontmatter status follows the page's status on every write`
- `PE-1 a write whose persona frontmatter names another status is refused activation_required`
- `PE-2 requires_tools is derived from the toolset and an edited value is replaced`
- `PE-2 a persona an agent drafts through write_page lands suggested with requires_tools derived`
- `PE-8 a learning that supersedes an unretired learning is flagged as a contradiction`
- `PE-8 a learning that supersedes only retired learnings, or nothing, is not flagged` (Review Focus 6)

`apps/uw-app/pages/confirm.pg.test.ts`:
- `PE-8 a person confirms a suggested learning at the version they read`
- `PE-8 a confirmation at a stale version is refused stale_version and changes nothing`
- `PE-8 an agent cannot confirm a learning or a skill` (an agent principal → `not_permitted`; and `write_page` by an agent on an active learning stays `not_permitted` `{ why: 'gated_page' }`)
- `PE-8 confirmation is the only way a learning becomes active` (`update_page` with `status: 'active'` → `activation_required`)
- `PE-8 a persona is not confirmed but activated`

`apps/uw-app/pages/stale.pg.test.ts`:
- `PE-8 the stale-confidence report lists assumed and inferred learnings past their review date, defaulting to 90 days after as_of`
- `PE-8 the report shows only learnings the caller may read`
- `PE-8 the stale_learnings indicator counts them on get_health and on /health`

`sim/kernel/stage-command.test.ts`: `PE-8 a stage's instructions page must be a skill page`. `tools/skills/sync-harness-skill.test.ts`: `PE-8 the synced harness skill validates as a skill page` (parse `skills/harness/SKILL.md` through the same check the sync uses and `skillFrontmatterSchema`).

`apps/uw-app/mcp/page-verbs.pg.test.ts`: `PE-3 an agent's attempt to activate a persona through write_page is refused and logged` (an agent saves its suggested persona with frontmatter `status: 'active'` → `activation_required`; the dispatcher's `verb call` log entry records the outcome `activation_required`; the page stays `suggested`).

- [ ] **Step 2:** Run `pnpm vitest run apps/uw-app/pages apps/uw-app/mcp/page-verbs.pg.test.ts sim/kernel/stage-command.test.ts tools/skills`; expected FAIL.
- [ ] **Step 3:** Implement; the exceptions row for `stale.ts` is written before the code.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add apps/uw-app packages/harness/stages sim/kernel tools/skills docs/exceptions.md
git commit -m "feat(pages): persona status and tools derived on write, contradictions flagged, learnings and skills confirmed at the version read, stale learnings reported

PE-1 PE-2 PE-3 PE-8"
```

---

### Task 4: Persona activation: the dry run, the status flip and the projection, behind an admin command

**Requirements:** PE-3, PE-1 (status through activation), PE-2 (the tool check on the derived list); the projection carries (S10-D5, S10-D6).

**Files:**
- Create: `packages/harness/personas/instructions.ts` (`parseAgentSkillHeader(body)`), `packages/harness/personas/dry-run.ts`, `packages/harness/personas/dry-run.test.ts`, `packages/harness/personas/projection.ts` (`activePersonaOn(tx, identity, harnessId)`, `personaSlugFor(identity)`), `apps/uw-app/commands/person/personas.ts` (`activatePersonaCommand`), `apps/uw-app/commands/personas.pg.test.ts`, `apps/uw-app/harness/persona-activation-flip.pg.test.ts`, `sim/scenarios/PE-3.activation-runs-the-tool-check-and-a-dry-run-then-flips-status.ts`
- Modify: `packages/harness/personas/activate.ts`, `packages/harness/personas/commands.ts` (the outcome is `KernelOutcome<ActivatedPersona>`; input gains `harnessId`), `packages/harness/package.json` (`yaml` `^2.9.1`, ISC), `packages/harness/runs/beat.ts` and `packages/harness/runs/start.ts` (`tx.personas.read.active` in place of `tx.pages.read.activePersona`), `packages/harness/reads/poll.ts` and `packages/harness/items/claim.ts` (S10-D6), `packages/harness/index.ts`, `apps/uw-app/commands/registry.ts`, `sim/persona-fixtures.ts` (`activatePersona` passes `harnessId`), `packages/db/test-seed.ts` (`seedActivePersona(db, { pageId, identity, harnessId, ... })`: an `active` persona page and its projection row), the sim and test helpers that grant delegations for a persona (grep `delegations.grant` and `seedDelegation` under `sim/` and `apps/uw-app/`) so they seed an active persona when none exists, `sim/kernel/persona-activation.test.ts`, `docs/architecture.md` ("Transactions and locks": persona activation's order)
- Then, once a grep for `activePersona(` finds no caller: remove `PagesGateway.read.activePersona` from `packages/harness/ports.ts` (its own shared-root commit) and from `packages/db/store/pages.ts` and its port contract case.

**Types:**

```ts
export type ActivatedPersona = {
  readonly pageId: string;
  readonly persona: Identity;
  readonly harnessId: string;
  readonly version: number;
};

export type DryRunPersona = {
  readonly identity: Identity;
  readonly frontmatter: PersonaFrontmatter;
  readonly body: string;
};
export type DryRunProblem = { readonly message: string };
export async function dryRun(persona: DryRunPersona, registry?: readonly VerbDefinition[]): Promise<DryRunProblem | null>;

export type AgentSkillHeader = { readonly name: string; readonly description: string; readonly body: string };
export function parseAgentSkillHeader(text: string): AgentSkillHeader | { readonly problem: string };
```

`parseAgentSkillHeader`: the text's first line is exactly `---`; the header ends at the next line that is exactly `---`; it parses with `yaml`'s `parse` (with `{ uniqueKeys: true }`) to a plain mapping whose `name` matches `^[a-z0-9][a-z0-9-]{0,63}$` and whose `description` is a string of 1 to 1,024 characters (other agentskills keys `license`, `compatibility`, `metadata`, `allowed-tools` are allowed; any other key is a problem); the body after it, trimmed, is non-empty. Problems are one line: `no agentskills header`, `the header is not a mapping`, `the header has no name`, `the header's description is missing or too long`, `the header names <key>`, `the body is empty`.

`dryRun`, in order (the first problem wins; `<slug>` is `personaSlugOf(identity)`):
1. Header problem → `persona <slug> instructions are not an agentskills document: <problem>`; a `name` other than the slug → `persona <slug> instructions are named <name>`.
2. `!hostable(engine, run_shape)` → `persona <slug> runs <run_shape> on <engine>, which cannot host it`.
3. `run_shape === 'workflow-run'` and `provider ?? engineDescriptor(engine).defaultProvider` is null → `persona <slug> names no provider for <engine>`.
4. `capability === 'review'` and the toolset holds `write_page` → `persona <slug> reviews and may not hold write_page`.
5. One turn: `runToolLoop(fixtureTurn, refuseEveryTool, request, async () => undefined)` with `request = { engine, model, pinnedProvider: <the resolved provider or null>, persona: identity, instructions: body, tools: <toolset parsed with verbNameSchema>, prompt: FIXTURE_ITEM_PROMPT, traceId: '00000000-0000-4000-8000-000000000000' }`, where `FIXTURE_ITEM_PROMPT` is `'Dry run. Item: "Fixture item" in stage scope. Reply without calling a tool.'`, `fixtureTurn` answers `{ toolCalls: [], text: 'dry run', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 }, resolvedProvider: request.pinnedProvider, resolvedModel: request.model }` after asserting `request.instructions.length > 0` and `request.tools` equal to the toolset, and `refuseEveryTool.call` answers `{ output: { error: 'dry_run' }, isError: true }`. An outcome other than `ended`, or a throw, → `persona <slug> failed its dry run turn`. (Match `TurnUsage`'s real fields in `ports.ts`.)

**`activateIn`, in order** (replacing the `not_wired` tail):
1. `tx.lock(lockKeys.personaActivation(pageId))`; readable page; persona frontmatter; `harnessId` mismatch with the frontmatter's `harness` → `page_not_found` `{ pageId }`; admin and write checks; `stale_version`; `not_suggested`; reserved engine (HE-10) — all as today.
2. Tool check over `verbsOf(frontmatter)` (now `toolset ∪ requires_tools`, the same list) → the AB-8 path as today.
3. `dryRun` → on a problem: lock `harnessEvents(harness)`, append `persona_activation_failed` `{ pageId, persona, verb: null, engine: null, reason: 'dry_run_failed', message, itemId: null }`, answer `refused('dry_run_failed', { message })`.
4. Identity in use: `tx.personas.read.byIdentity(identity)`; a row whose `pageId` differs and whose page (`tx.pages.read.facts`) is `active` → `not_permitted` `{ why: 'identity_in_use' }`, nothing recorded.
5. `tx.pages.write.activatePersona({ pageId, expectedVersion, editSource: caller.actor.identity, traceId: caller.traceId })`; `null` → `stale_version` `{ pageId, version: page.version }` (Review Focus 1).
6. `tx.personas.write.upsert({ identity, harnessId, pageId })`.
7. Lock `harnessEvents(harness)`; append `persona_activated` `{ pageId, persona: identity, version: flipped.version }`; answer `accepted({ pageId, persona: identity, harnessId, version })`.

The dry run is pure and runs inside the transaction (it calls no port).

**Projection in the beat, start, poll and claim (S10-D6):** `beat` and `start` read `tx.personas.read.active(identity, harnessId)`. Poll's `delegated` and `persona` subscriptions keep a harness only when `tx.personas.read.active('agent:' + slug, harness.id)` is non-null. Claim, for a caller whose identity is a bare persona or carries a delegation, after the acting guard: no active persona for its slug on the item's harness → `not_permitted` `{ why: 'persona_not_active' }`, nothing recorded.

**Command:** `activatePersonaCommand = commandHandler({ name: 'activate_persona', action: 'admin', agents: 'refused', run: (context, body) => context.kernel.personas.activate(context.caller, { pageId: body.pageId, expectedVersion: body.expectedVersion, harnessId: context.harnessId }) ... })`, the outcome mapped as the other person handlers map theirs; registered in `commandRegistry`.

**Scenario** `sim/scenarios/PE-3.activation-runs-the-tool-check-and-a-dry-run-then-flips-status.ts`: a `personaScene`; a suggested Iterate page whose body lacks an agentskills header is refused `dry_run_failed` with one `persona_activation_failed` and stays `suggested`; a second suggested page for a second identity (`agent:iterate-two`, seeded with `seedPage` at version 1 with a valid body) is refused `not_permitted` for an editor; the admin activates it at `expectedVersion: 2` → `stale_version`; at version 1 → accepted, the page is `active` at version 2 with frontmatter `status: active`, the projection names it, one `persona_activated`; a second activation → `not_permitted` `{ why: 'not_suggested' }`. It returns the folded harness events and the page.

- [ ] **Step 1: Write the failing tests**

`packages/harness/personas/dry-run.test.ts`:
- `PE-3 the dry run passes a persona whose instructions are an agentskills document and whose engine hosts its run shape`
- `PE-3 the dry run names the first problem: header, name, engine, provider, review with write_page`
- `PE-3 the dry run runs one turn and calls no tool`

`sim/kernel/persona-activation.test.ts` (extend):
- `PE-3 activation runs the tool check and a dry run, then flips the persona to active and writes the projection`
- `PE-3 a dry run failure records persona_activation_failed and leaves the persona suggested`
- `PE-3 an editor and an agent cannot activate`
- `PE-3 activation at a stale version is refused and records nothing` (Review Focus 1)
- `PE-3 a persona whose identity another active page holds is refused identity_in_use` (Review Focus 3)
- `PE-1 an activated persona's frontmatter reads status active`
- `PE-2 activation checks the derived requires_tools: a missing verb opens one item and leaves the persona suggested`

`apps/uw-app/harness/persona-activation-flip.pg.test.ts` (two connections on the server): `PE-3 two activations of one page at once record exactly one persona_activated` (Review Focus 2).

`apps/uw-app/commands/personas.pg.test.ts`: `PE-3 activate_persona is admin only, refused to agents, and answers stale_version for an old version`; `PE-3 a page of another harness is page_not_found`.

`sim/kernel/run-beat.test.ts` and `sim/kernel/poll*.test.ts` (extend, or a new `sim/kernel/persona-projection.test.ts`): `PE-3 the beat starts runs only for personas the projection names active`; `PE-3 a delegated persona polls and claims only where its persona is active` (claim → `persona_not_active`).

- [ ] **Step 2:** Run `pnpm vitest run packages/harness/personas sim/kernel apps/uw-app/commands/personas.pg.test.ts apps/uw-app/harness/persona-activation-flip.pg.test.ts && pnpm sim -- PE-3.activation-runs-the-tool-check-and-a-dry-run-then-flips-status`; expected FAIL.
- [ ] **Step 3:** Implement; update the delegation helpers so existing AB-4, AB-6, AB-7, HE-* and KN-16 tests keep passing with an active persona seeded (do not weaken any assertion); then remove `activePersona` if no caller remains.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add packages/harness packages/db/test-seed.ts apps/uw-app sim docs/architecture.md pnpm-lock.yaml
git commit -m "feat(harness): an admin activates a persona after the tool check and a dry run; the flip and the projection land in one transaction

PE-1 PE-2 PE-3"
git add packages/harness/ports.ts
git commit -m "refactor(harness): the store port drops activePersona; the personas projection answers it

Shared root packages/harness/ports.ts: the projection replaced its last caller.

PE-3"
git add packages/db packages/harness/port-contracts
git commit -m "refactor(db): drop the activePersona read

PE-3"
```

---

### Task 5: Iterate's inputs and outputs: measurements, revisions routed to `learning_attached`, and capability brackets

**Requirements:** PE-7, KN-7 (the revision clause), AB-6 (the step-3 carry, S10-D15).

**Files:**
- Create: `packages/harness/measurements/record.ts`, `packages/harness/measurements/commands.ts`, `packages/harness/delegations/capability.ts`, `packages/harness/delegations/capability.test.ts`, `sim/kernel/measurements.test.ts`, `sim/kernel/revision-attach.test.ts`, `sim/kernel/capability-brackets.test.ts`, `apps/uw-app/commands/handlers/measurements.ts`, `apps/uw-app/commands/measurements.pg.test.ts`, `sim/scenarios/PE-7.iterate-reads-measurements-and-routes-a-labelled-revision.ts`
- Modify: `packages/harness/kernel.ts` (`measurements: MeasurementCommands`), `packages/harness/reads/index.ts` (`measurements(caller, { itemId }, { at })`), `packages/harness/items/learning.ts` (widened attach, `attachWithin(tx, ...)` exported for submit), `packages/harness/items/submit.ts` (`attach` before validators), `packages/harness/items/commands.ts` (`SubmitInput` gains `attach`), `packages/harness/validators/learning-attached.ts` (revisions count only for labels), `packages/harness/items/claim.ts` and `packages/harness/reads/poll.ts` (brackets), `packages/harness/index.ts`, `apps/uw-app/records/queries.ts` (`measurements_for_item`), `apps/uw-app/mcp/verbs/submit-to-gate.ts` (pass `attach`), `apps/uw-app/mcp/rows-verbs.pg.test.ts`, `apps/uw-app/mcp/harness-verbs.pg.test.ts`, `apps/uw-app/commands/registry.ts`, `packages/harness/measurements/owns.ts` (unchanged: `['measurements']`)

**Measurements (S10-D13):**

```ts
export type RecordMeasurementInput = {
  readonly itemId: string;
  readonly source: DataSourceKind;
  readonly name: string;
  readonly value: number;
  readonly asOf: string;
};
export type MeasurementCommands = {
  record(caller: Caller, input: RecordMeasurementInput): Promise<KernelOutcome<MeasurementRow>>;
};
```

`record`: `isAgent` → `not_permitted` `{ actor }`; one transaction: `tx.harnessItems.read.lock(itemId)` (`item_not_found`), the harness and its stages; grants re-read with `resolveIn`; `write` on the harness's area (`not_permitted`, and an unreadable harness is `item_not_found`); the item's stage's `bracket !== 'iterate'` → `not_permitted` `{ why: 'not_at_iterate' }`; `asOf` after today (UTC from `ports.clock`) or a name that is blank after trimming → `malformed_command`; `tx.measurements.write.insert({ id: ports.ids.next(), harnessId, itemId, source, name: name.trim(), value, asOf, recordedAt: at })`; `recordItemEvents(..., [draft('measurement_recorded', { measurementId, source, name, value, asOf })])`.

`kernel.reads.measurements(caller, { itemId }, { at })`: the item through the same read rule `kernel.reads.item` applies (hidden equals missing, R27 for agents), then `tx.measurements.read.forItem(itemId, 50)`. `measurements_for_item` in `apps/uw-app/records/queries.ts`: params `z.object({ itemId: z.uuid() })`; rows `{ measurementId, itemId, source, name, value, asOf }`, resource the harness's area.

`record_measurement` command: `commandHandler({ name: 'record_measurement', action: 'write', agents: 'refused', run: ... context.kernel.measurements.record(context.caller, body) })`.

**Revisions (S10-D14):** `attachWithin(tx, ports, scene, pageId, at)` answers the draft or a refusal: the page (`page_not_found` when missing or outside the harness's area); `learning`/`skill` in `suggested` → `{ pageId, kind: 'learning' }`; `product`, `system_goal`, `product_strategy`, `data_sources` in `draft` or `suggested` → `{ pageId, kind: 'revision' }`; anything else → `malformed_command` `{ pageId, type, status }`. `attachLearning` keeps its standing checks and uses it. `submit`: after the holder, delegation and lease checks and before the validators, each `attach` page id becomes a `learning_attached` draft (refusals answer before any append; a page attached earlier is not attached twice), and the validators' context sees the attached pages. `learningAttached`: `memoryFailures` counts only `kind: 'learning'` attachments of `learning`/`skill` pages (old events parse `kind` as `learning` by default); `labelFailures` covers every attached page that is not a skill. Failures for a revision read `learning_attached: revision <id> ...` in place of `page <id>`.

**Capability brackets (S10-D15)** (`packages/harness/delegations/capability.ts`, complete):

```ts
import type { CapabilityWord, StageBracket } from '@uw/contracts';

const reach: ReadonlyMap<CapabilityWord, ReadonlySet<StageBracket>> = new Map([
  ['none', new Set<StageBracket>()],
  ['build', new Set<StageBracket>(['build_package'])],
  ['review', new Set<StageBracket>(['build_package'])],
  ['iterate', new Set<StageBracket>(['iterate'])],
]);

export function capabilityReaches(capability: CapabilityWord, bracket: StageBracket): boolean {
  return reach.get(capability)?.has(bracket) ?? false;
}
```

(Use the real exported type names for the capability and bracket sets in `@uw/contracts`.) Claim: when the claim runs under a delegation (presented or carried by the identity), read it (`tx.delegations.read.byId`) after the acting guard and refuse `pickup_not_allowed` `{ stage, capability }` when `!capabilityReaches(delegation.capability, stage.bracket)`, nothing recorded. Poll's `delegated` and `persona` subscriptions drop items whose stage the delegation's capability does not reach, so poll and claim agree (R27). People and interactive devices without a delegation are unaffected.

**Scenario** `sim/scenarios/PE-7.iterate-reads-measurements-and-routes-a-labelled-revision.ts`: a BML harness; an active `agent:iterate` (seeded through Task 4's path or `seedActivePersona`) under an `iterate` delegation; an item moved to `close`; a person records two measurements; the beat principal reads them through `kernel.reads.measurements` (the kernel half of `query_entities`); an unattended claim without a delegation is refused `delegation_required`; under the delegation Iterate claims, drafts a `product_strategy` revision with an unlabelled claim and a suggested learning, and submits `to: 'scope'` with `attach` → `checks_failed` naming the revision; it fixes the revision's labels and submits again → `checks_passed`, `loop_edge_taken` to `scope`; the delegation is revoked and the next step stops with `delegation_lapsed`. It returns the item's folded state and events.

- [ ] **Step 1: Write the failing tests**

`sim/kernel/measurements.test.ts`:
- `PE-7 a person records a measurement on an item at the iterate bracket`
- `PE-7 a measurement elsewhere, in the future, or by an agent is refused`
- `PE-7 measurements are read through the item's read rule: hidden equals missing`

`apps/uw-app/mcp/rows-verbs.pg.test.ts`: `PE-7 query_entities measurements_for_item answers the item's measurements, newest first, and nothing for an item the caller cannot read`. `apps/uw-app/commands/measurements.pg.test.ts`: `PE-7 record_measurement is a person's write and is refused to agents`.

`sim/kernel/revision-attach.test.ts`:
- `KN-7 every revision Iterate proposes carries an evidence label, or learning_attached refuses it` (the revision clause; the item also carries a labelled learning, so only the revision fails)
- `PE-7 a revision is attached at submit and routed along the feeds edge in one transaction`
- `PE-7 a revision alone does not satisfy learning_attached`
- `PE-7 an agent that does not hold the item cannot attach, and a revision of another area is page_not_found` (Review Focus 5)

`packages/harness/delegations/capability.test.ts`: `AB-6 build and review reach the build package, iterate reaches iterate, none reaches nothing`. `sim/kernel/capability-brackets.test.ts`: `AB-6 a delegated claim outside its capability's bracket is refused pickup_not_allowed, and poll does not offer it`; `AB-6 a person's claim is not narrowed by any capability`.

`apps/uw-app/mcp/harness-verbs.pg.test.ts`: `PE-7 submit_to_gate attaches pages before its validators run`.

- [ ] **Step 2:** Run the files above and `pnpm sim -- PE-7.iterate-reads-measurements-and-routes-a-labelled-revision`; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add packages/harness sim apps/uw-app
git commit -m "feat(harness): measurements and their query, revisions routed to learning_attached at submit, and capability brackets for delegated work

PE-7 KN-7 AB-6"
```

---

### Task 6: Builder, Reviewer and Iterate as template persona pages; the Reviewer identity seam; three review rounds hand the item to a person

**Requirements:** PE-5 (Builder is a page; held premises counted per persona), PE-6 (Reviewer's identity, toolset and rounds), PE-7 (Iterate's page).

**Files:**
- Create: `packages/harness/templates/personas.ts`, `packages/harness/templates/personas.test.ts`, `packages/harness/github/builder.ts`, `packages/harness/runs/rounds.ts`, `sim/kernel/review-rounds.test.ts`, `sim/scenarios/PE-5.builder-is-a-page-and-a-held-premise-is-counted.ts`, `sim/scenarios/PE-6.three-review-rounds-hand-the-item-to-a-person.ts`, `apps/uw-app/commands/template-personas.pg.test.ts`
- Modify: `packages/harness/github/reviewers.ts` and `packages/harness/github/reviewers.test.ts`, `packages/harness/runs/review.ts` (`postReview` counts rounds), `packages/harness/items/fold.ts` and `packages/harness/items/fold.test.ts` (`handed_to_person`), `packages/harness/index.ts`, `apps/uw-app/commands/capabilities.ts` (`pages.draftPersonas`), `apps/uw-app/commands/person/stages.ts` (`activateTemplateCommand` drafts the template's personas after an accepted activation), `tools/architecture/command-handlers.test.ts` if the new capability needs listing

**Fixtures** (`packages/harness/templates/personas.ts`):

```ts
export type PersonaFixture = {
  readonly slug: string;
  readonly title: string;
  readonly toolset: readonly VerbName[];
  readonly run_shape: RunShape;
  readonly engine: Engine;
  readonly model: string;
  readonly provider: string | null;
  readonly capability: CapabilityWord;
  readonly budget: { readonly monthly_minor: number; readonly currency: string };
  readonly bodyMd: string;
};

export const BUILDER_TOOLSET = [
  'search_pages', 'read_page', 'write_page', 'resolve_context', 'query_entities', 'create_task',
  'poll_queue', 'claim_item', 'submit_to_gate', 'record_run_step', 'get_health',
] as const satisfies readonly VerbName[];
export const REVIEWER_TOOLSET = [
  'search_pages', 'read_page', 'resolve_context', 'query_entities',
  'poll_queue', 'claim_item', 'submit_to_gate', 'record_run_step', 'get_health',
] as const satisfies readonly VerbName[];
export const ITERATE_TOOLSET = [
  'search_pages', 'read_page', 'write_page', 'resolve_context', 'query_entities',
  'poll_queue', 'claim_item', 'submit_to_gate', 'record_run_step', 'get_health',
] as const satisfies readonly VerbName[];

export const templatePersonas: Readonly<Record<TemplateKey, readonly PersonaFixture[]>>;
export function personaPageDraft(fixture: PersonaFixture, harness: { readonly id: string; readonly jdArea: JdArea }, owner: Identity): {
  readonly slug: string; readonly title: string; readonly frontmatter: PersonaFrontmatterInput; readonly bodyMd: string;
};
```

| slug | template | run_shape | engine | model | provider | capability |
|---|---|---|---|---|---|---|
| `builder` | software | `external-run` | `external` | `unreported` | null | `build` |
| `builder-hosted` | software | `workflow-run` | `claude-code-sandbox` | `claude-sonnet-4-5` | `anthropic` | `build` |
| `reviewer` | software | `workflow-run` | `openrouter-messages` | `z-ai/glm-5.3-flash` | `z-ai` | `review` |
| `reviewer-codex` | software | `workflow-run` | `codex-sandbox` | `gpt-5-codex` | `openai` | `review` |
| `iterate` | bml | `workflow-run` | `openrouter-messages` | `z-ai/glm-5.3-flash` | `z-ai` | `iterate` |

Toolsets: Builders `BUILDER_TOOLSET`, Reviewers `REVIEWER_TOOLSET`, Iterate `ITERATE_TOOLSET`. Budget `{ monthly_minor: 20000, currency: 'USD' }` for each (a placeholder). Each `bodyMd` is an agentskills document (`---` / `name: <slug>` / `description: <one sentence>` / `---`, then sections in sentence case, second person): Builder — read, scout (verify the premise against current code and data; end with the `harness-scout` block), work on `harness/<item>`, open the pull request with the fenced `harness` declaration (`closes`, `risks`, `touches`, `risk_tier`, `risk_domains`), submit; Reviewer — read the diff and checks, end with the `harness-verdict` block, never write a page; Iterate — read measurements only through `query_entities` `measurements_for_item`, draft a revision in which every claim line starts with `[observed]`, `[confirmed]`, `[inferred]` or `[assumed]`, attach it with a learning, submit along the `feeds` edge. `personaPageDraft` returns slug `persona-<slug>`, the frontmatter with `identity: 'agent:<slug>'`, `owner`, `harness: harness.id`, the fixture fields and no `status` or `requires_tools` (the page writer derives both).

**Drafting:** `CommandCapabilities.pages` gains `draftPersonas(template: TemplateKey, harness: Harness): Promise<{ readonly drafted: number; readonly skipped: number }>`, built in `capabilities.ts` over the page owner's `createPage` with the caller's principal, `status: 'suggested'`, `jdArea: harness.jdArea`, a fresh page id and request id per page; `slug_taken` counts as skipped; any other refusal is logged with its reason and counted as skipped. `activateTemplateCommand` calls it only after the kernel accepted the activation; the command's outcome stays the activation's.

**Reviewer seam (S10-D17):** `ReviewerIdentity` gains `persona: Identity`: `{ login: 'uw-reviewer[bot]', reviewer: 'uw-reviewer', persona: 'agent:reviewer' }`, `{ login: 'uw-reviewer-codex[bot]', reviewer: 'uw-reviewer-codex', persona: 'agent:reviewer-codex' }`; export `reviewerForPersona(identity): string | null`. `packages/harness/github/builder.ts`: `export const builderIdentity = { login: 'uw-builder[bot]', app: 'uw-builder', persona: 'agent:builder-hosted' } as const;`. Both files sit under `packages/harness/github/` (protected, `acl`).

**Rounds (S10-D18)** (`packages/harness/runs/rounds.ts`):

```ts
export const REVIEW_ROUND_LIMIT = 3;
export function roundsSinceEntry(events: readonly HarnessEvent[], stageKey: string): number;
```

`roundsSinceEntry` finds the last event that put the item in `stageKey` (`item_created` when its stage is `stageKey`, `stage_advanced` or `loop_edge_taken` whose evidence's target is `stageKey`) and counts, after it, `run_completed` events whose evidence `result` is `review_posted` and whose `review.verdict` is `request_changes`. In `postReview`, the transaction that completes the run `review_posted` reads the item's events (`readAllEvents(tx, harnessId, itemId)`), adds this review, and when the count reaches `REVIEW_ROUND_LIMIT` and the run has a delegation, appends after `run_completed`: `checks_failed` `{ stage, failures: ['review_rounds_exhausted'] }` and `handed_to_person` `{ personId: delegation.personId, why: 'review_rounds_exhausted', rounds }`. The fold for `handed_to_person`: `holder = 'human:' + personId`, `claimantKind = 'person'`, `leaseExpiresAt = null`, `delegationId = null`, gate status unchanged.

**Scenarios:**
- `sim/scenarios/PE-5.builder-is-a-page-and-a-held-premise-is-counted.ts`: activate the software template (the kernel), draft its personas through the same fixture data as pages (`personaPageDraft` + `seedPage`, since the sim cannot import the app), activate `builder-hosted` through `kernel.personas.activate`; an admin turns hosted Builder on; a `build` delegation; the beat starts a run on an item in `scope`; `kernel.runs.holdPremise(runId, { reason: 'the premise names a file that no longer exists' })`; the item stays in `scope` and is free; one `premise_held`, whose actor is `agent:builder-hosted`; the scenario counts held premises per persona from the harness's events (`readAllEvents`, grouped by the actor's persona slug) and asserts 1 for `builder-hosted` and 0 for `builder` (Task 8's dashboard test proves the same count through `personaDashboard`).
- `sim/scenarios/PE-6.three-review-rounds-hand-the-item-to-a-person.ts`: an item at `check` with a pull request and expected head in the fixture GitHub facts; an active `reviewer` under a `review` delegation; three review runs each post `request_changes` (the sim connectors record each); after the third, `checks_failed` `review_rounds_exhausted` and `handed_to_person` to the delegating person; the item's holder is `human:<id>` with no lease; the Reviewer's next claim is `lease_held`.

- [ ] **Step 1: Write the failing tests**

`packages/harness/templates/personas.test.ts`:
- `PE-5 Builder is a persona page in the software fixture: its toolset is the eleven served verbs, external-run by default and workflow-run on claude-code-sandbox`
- `PE-6 Reviewer's toolset has no gate verb and no write_page, and its default engine is openrouter-messages; the second Reviewer is on codex-sandbox`
- `PE-7 Iterate is a persona page in the BML fixture on openrouter-messages and workflow-run, reading measurements only through query_entities` (its toolset holds `query_entities` and no verb that reads measurements otherwise)
- `PE-5 every fixture persona passes the frontmatter schema and the dry run` (`dryRun` from Task 4)

`packages/harness/github/reviewers.test.ts`: `PE-6 each Reviewer persona has its own GitHub identity, distinct from Builder's, and the engine descriptors agree with the table`; `PE-6 a review by the Builder's login never counts as a Reviewer's`.

`sim/kernel/review-rounds.test.ts`: `PE-6 the third request_changes round hands the item to the delegating person`; `PE-6 rounds count only since the item last entered its stage`; `PE-6 an approve does not count as a round`. `packages/harness/items/fold.test.ts`: `PE-6 handed_to_person makes the person the holder with no lease` (and the projection-equals-replay property in `tools/properties/` still passes; extend its generator with the event).

`apps/uw-app/commands/template-personas.pg.test.ts`: `PE-5 activating the software template drafts Builder and both Reviewers as suggested persona pages`; `PE-7 activating the BML template drafts Iterate`; a second activation of another harness from the same template skips taken slugs (titled without an ID).

- [ ] **Step 2:** Run the files above and both scenarios; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add packages/harness sim apps/uw-app tools
git commit -m "feat(harness): Builder, Reviewer and Iterate are template persona pages; Reviewer identities name their persona; a third review round hands the item to a person

PE-5 PE-6 PE-7"
```

---

### Task 7: Hosted Builder pushes and opens its pull request through the egress proxy

**Requirements:** PE-5 (work lands on `harness/<item>` with a declared pull request on the hosted path), the step-7 carry (S7-D19).

**Files:**
- Create (commit 1, shared root `infra/`): `infra/github/builder-app-manifest.json` (name `uw-builder`, `default_permissions`: `contents: write`, `pull_requests: write`, `metadata: read`; no `default_events`; no webhook), `infra/README.md` section "The Builder GitHub App (PE-5)" (register from the manifest, install on `unfoldingWord/uw-platform` only, set the three secrets with `wrangler secret put`)
- Create (commit 2): `apps/uw-app/github/builder-app.ts` (config from `BUILDER_GITHUB_APP_ID`, `BUILDER_GITHUB_APP_INSTALLATION_ID`, `BUILDER_GITHUB_APP_PRIVATE_KEY`; `builderToken(env, repository): Promise<string> | null` minting one installation token scoped to that one repository with `contents: write`, `pull_requests: write`, `metadata: read`, through the existing token module), `apps/uw-app/github/builder-app.test.ts`, `apps/uw-app/engines/sandbox/github-egress.ts`, `apps/uw-app/engines/sandbox/github-egress.test.ts`, `apps/uw-app/engines/sandbox/pkt-line.ts`, `apps/uw-app/engines/sandbox/pkt-line.test.ts`
- Modify: `apps/uw-app/engines/sandbox/egress.ts` (`EgressRoutes.github: GitHubEgress | null`), `apps/uw-app/engines/claude-code-sandbox/work.ts` (the repository setup and the build tools), `apps/uw-app/engines/claude-code-sandbox/work.test.ts`, `apps/uw-app/runs/run-core.ts` (build `github` routes for a `build` run on a sandbox engine of a harness with a repository; null otherwise), `apps/uw-app/runs/deps.ts`, `apps/uw-app/env.ts` (the three optional secrets), `packages/harness/risk/protected-directories.ts` and `packages/harness/risk/risk.test.ts` (`apps/uw-app/engines/sandbox/` → `acl`), `.dependency-cruiser.mjs` (`apps/uw-app/github/builder-app.ts` imported only by `apps/uw-app/runs/deps.ts` and tests), `tools/architecture/no-live-account.test.ts` only if it lists secret names

**`GitHubEgress`** (`github-egress.ts`):

```ts
export type GitHubEgress = {
  readonly repository: string;
  readonly branch: string;
  readonly defaultBranch: string;
  readonly token: () => Promise<string | null>;
};
export async function githubEgress(request: Request, route: GitHubEgress, fetcher: typeof fetch): Promise<Response | null>;
```

It answers `null` for a host other than `github.com` and `api.github.com` (so `egress` keeps its other rules), and otherwise, comparing the repository case-insensitively and refusing `403` with body `egress refused` on any other request:
- `github.com`: path `/<repository>.git/info/refs` with `service=git-upload-pack` (GET), `/<repository>.git/git-upload-pack` (POST): forwarded.
- `github.com`: `/<repository>.git/info/refs?service=git-receive-pack` (GET): forwarded. `/<repository>.git/git-receive-pack` (POST): the body is read once; `parseRefUpdates(bytes)` (`pkt-line.ts`) reads pkt-lines up to the first flush (`0000`), each `<old 40 hex> <new 40 hex> <ref>` with an optional `\0capabilities` tail; every ref must be `refs/heads/<branch>` and no `new` may be forty zeros (a delete); a malformed packet, a second ref, a delete or zero updates → `403`. Allowed bodies are forwarded unchanged.
- `api.github.com`: `GET /repos/<repository>/pulls` with query `head=<owner>:<branch>` (and optional `state`): forwarded. `POST /repos/<repository>/pulls`: JSON `{ title, head, base, body, draft? }`; `head` must be `<branch>` or `<owner>:<branch>`, `base` must be `defaultBranch`, `body` must parse with the PR declaration parser in `packages/harness/github/declaration.ts` (`riskDeclarationOf` or its exported parse) without a problem; else `403`.
- Every forwarded request drops incoming `authorization`, `cookie`, `x-api-key`, `cf-aig-authorization` and `proxy-authorization`; git requests get `authorization: Basic base64("x-access-token:" + token)`, API requests `authorization: Bearer <token>` and `x-github-api-version: 2022-11-28`; a `null` token answers `503` with body `egress not configured` and is logged `github_egress_not_wired` (host and path only, never the token).

**Work spec for a `build` run** (`claude-code-sandbox`): before `claude`, the session runs `git clone --no-tags https://github.com/<repository>.git /workspace/repo` and `git -C /workspace/repo checkout -B <branch> <expected head, else origin/<defaultBranch>>`, both through the proxy; `claude` runs with `--cwd /workspace/repo` (or `cd` in the command) and `--allowedTools` the MCP verbs plus `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Bash(git *)`, `Bash(curl *)`; the prompt (from the persona's body) tells it to push `HEAD:refs/heads/<branch>` and open the pull request with `curl` against `https://api.github.com/repos/<repository>/pulls`. The token is never written to a file, an environment variable or a command; tests assert on the fake host's recorded env, files and commands. A `review` or `iterate` run gets `github: null` (unchanged behaviour: every GitHub host refused).

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/engines/sandbox/github-egress.test.ts` (a fake `fetch` recording requests):
- `PE-5 a push to harness/<item> is forwarded with the Builder token injected`
- `PE-5 a push naming another ref, a second ref or a delete is refused` (Review Focus 4)
- `PE-5 a pull request is opened only from harness/<item> into the default branch with a parseable harness declaration`
- `PE-5 another repository and any other GitHub path are refused`
- `PE-5 the sandbox's own credentials are dropped and the token never reaches the sandbox`

`pkt-line.test.ts`: `PE-5 ref updates are read from the receive-pack request up to the first flush` (with a capability tail, a malformed length and a missing flush). `builder-app.test.ts`: `PE-5 the Builder token is scoped to one repository with contents and pull request write, and is not wired without its secrets`. `apps/uw-app/engines/claude-code-sandbox/work.test.ts`: `PE-5 a hosted Builder clones from the expected head onto harness/<item> with no token in its environment, files or commands`. `packages/harness/risk/risk.test.ts`: `KN-17 the sandbox egress is in the acl domain` (it proves the map row).

- [ ] **Step 2:** Run `pnpm vitest run apps/uw-app/engines apps/uw-app/github/builder-app.test.ts packages/harness/risk`; expected FAIL.
- [ ] **Step 3:** Implement: the infra commit first.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add infra/github/builder-app-manifest.json infra/README.md
git commit -m "build(infra): the Builder GitHub App manifest

Shared root infra/: hosted Builder's own identity, contents and pull request write on one repository.

PE-5"
git add apps/uw-app packages/harness/risk .dependency-cruiser.mjs tools
git commit -m "feat(engines): hosted Builder pushes harness/<item> and opens its declared pull request through the egress proxy, which holds the token

PE-5"
```

---

### Task 8: The persona view: the dashboard, the toolset form and Activate

**Requirements:** PE-4, PE-2 (the toolset form), PE-3 (Activate shown only to an admin).

**Files:**
- Create: `packages/harness/personas/dashboard.ts`, `packages/harness/personas/toolset-options.ts`, `packages/harness/personas/toolset-options.test.ts`, `sim/kernel/persona-dashboard.test.ts`, `apps/uw-app/personas/routes.tsx`, `apps/uw-app/personas/view.tsx`, `apps/uw-app/personas/toolset-form.tsx`, `apps/uw-app/personas/routes.pg.test.ts`, `apps/uw-app/personas/view.test.ts`
- Modify: `packages/harness/reads/index.ts` (`personaDashboard`), `packages/harness/index.ts`, `apps/uw-app/app.tsx` (`app.route('/personas', personaRoutes(deps, person))` after `withPrincipal`, and a "Personas" link is not added: the view is reached from a persona page link), `tools/architecture/command-routes.test.ts` and `tools/architecture/person-surface-rules.test.ts` if they enumerate person routes

**Kernel read** (`packages/harness/personas/dashboard.ts`):

```ts
export type PersonaRunSummary = {
  readonly runId: string;
  readonly itemId: string;
  readonly runShape: RunShape;
  readonly engine: Engine;
  readonly outcome: RunOutcome;
  readonly startedAt: string;
  readonly steps: readonly { readonly step: RunStep; readonly costBasis: CostBasis; readonly tokensIn: number; readonly tokensOut: number }[];
};
export type PersonaDashboard = {
  readonly page: { readonly id: string; readonly title: string; readonly status: PageStatus; readonly version: number };
  readonly persona: Identity;
  readonly harness: { readonly id: string; readonly key: string; readonly jdArea: JdArea };
  readonly today: string;
  readonly runsToday: { readonly total: number; readonly byHost: { readonly platform: number; readonly external: number }; readonly byEngine: Readonly<Partial<Record<Engine, number>>> };
  readonly spend: { readonly costMinor: number; readonly computeMinor: number; readonly currency: 'USD'; readonly subscriptionTokens: number; readonly budgetMinor: number };
  readonly escalation: { readonly ended: number; readonly escalated: number };
  readonly gateRefusals: number;
  readonly premisesHeld: number;
  readonly writes: number;
  readonly lastRuns: readonly PersonaRunSummary[];
  readonly delegations: { readonly count: number; readonly live: readonly { readonly id: string; readonly personId: string; readonly capability: CapabilityWord; readonly expiresAt: string }[] | null };
  readonly canActivate: boolean;
  readonly toolsetOptions: readonly VerbName[] | null;
};
```

`kernel.reads.personaDashboard(caller, { pageId }, { at })`: the page through `tx.pages.read.facts` (not a `persona` page, unreadable area, or a frontmatter that does not parse → `page_not_found` `{ pageId }`); the harness from the frontmatter (unreadable → `page_not_found`, hidden equals missing); `since` is 00:00 UTC of `at`; `tx.harnessRuns.read.forPersona({ identity, harnessId, since, limit: 500 })` for today's figures and `{ since: null, limit: 5 }` for `lastRuns`; `tx.harnessEvents.read.countForPersona({ harnessId, personaSlug, names: ['gate_refused_to_agent', 'checks_failed', 'premise_held', 'handed_to_person'], since })`; `tx.delegations.read.live({ personId: null, persona: identity, harnessId }, at)`. Figures (S10-D20): `byHost` by run shape (`workflow-run` platform, `external-run` external); `spend.costMinor` and `computeMinor` sum metered runs, `subscriptionTokens` sums `tokensIn + tokensOut` of subscription steps (never a money figure); `escalation.ended` counts runs that ended today, `escalated` those whose result is `premise_held` or `review_refused`, or that failed, plus `handed_to_person` events today; `writes` sums the steps' `writes`; `delegations.live` only for a caller with `admin` on the harness's area (grants re-read with `resolveIn`), else `null` with the count; `canActivate` is the page `suggested` and the caller a person with `admin` on the harness's area and `write` on the page's area; `toolsetOptions` is `toolsetOptions(...)` for a person with `write` on the page's area, else `null`. An agent caller is `not_permitted` `{ actor }`.

`toolsetOptions(principal, area, at, registry = verbRegistry): readonly VerbName[]`: served registry verbs (`servedInV1`), never a forbidden name, that `principal` reaches by the same rule as `toolCheck`'s `reaches` (export that helper from `tool-check.ts` and reuse it), in registry order.

**Routes** (`apps/uw-app/personas/routes.tsx`, every route behind `withPrincipal`; the POSTs behind `csrf()` from `hono/csrf`):
- `GET /:pageId` → `personaDashboard`; `page_not_found` answers a 404 page saying "This page does not exist or you cannot see it."; otherwise the view.
- `POST /:pageId/activate` (form fields `expectedVersion`, `requestId`, both rendered into hidden inputs, the request id a fresh UUID per render) → `executeCommand({ name: 'activate_persona', harness: <the persona's harness id>, body: { command: 'activate_persona', requestId, pageId, expectedVersion }, principal, traceId, at }, scope)` with the same `DispatchScope` the command routes build, then re-render the view with the outcome beside the button.
- `POST /:pageId/toolset` (form fields `expectedVersion`, `requestId`, `verb` repeated) → reads the page, keeps only verbs in `toolsetOptions`, and calls the page owner's `updatePage` with the page's other fields unchanged and `frontmatter.toolset` replaced; re-render with the outcome beside the form.

**View** (`view.tsx`, in `Shell`, tokens only; `PageHead` with the persona's title and status `Badge`): `Kpi`s for runs today (detail "<p> on the platform, <e> external"), spend (detail "<cost> metered, <compute> compute; <tokens> subscription tokens", money through the shared minor-units formatter, budget beside it), escalation rate ("<n> of <m> runs ended today" or "No runs ended today"), gate refusals, premises held, writes; a `Table` of the last runs (started, item, host, engine, outcome, steps with tokens and cost basis); a delegations table for an admin, else "<n> live delegations"; when `canActivate`, a `HumanActionButton` labelled "Activate" in a `<form method="post" action="/personas/<id>/activate">` (Kindle, the only Kindle on the page); when the persona is `active`, a `HumanGateMark` is not shown and the status badge says "Active"; when the caller may edit, `toolset-form.tsx`: a `<fieldset>` with a `<legend>` "Toolset" and one labelled checkbox per option, checked when the toolset holds it, and a submit button "Save toolset". The outcome of the last post renders in place: accepted → a `Note` "Done."; an error → the closed reason through `reasonText` beside the control that posted. Copy is sentence case, second person.

- [ ] **Step 1: Write the failing tests**

`packages/harness/personas/toolset-options.test.ts`: `PE-2 the toolset form offers only served registry verbs the creator reaches, never a forbidden verb` (a viewer gets the read verbs only; an editor gets the eleven served verbs; `list_gifts` is never offered in v1; no option matches `isForbiddenVerbName`).

`sim/kernel/persona-dashboard.test.ts`:
- `PE-4 the dashboard shows runs today by host and engine, spend with subscription tokens apart, escalation rate, gate refusals, writes and the last runs`
- `PE-4 the dashboard lists the delegations the persona runs under to an admin and counts them for others`
- `PE-4 a persona page the caller cannot read, or of a harness they cannot read, is page_not_found`
- `PE-5 held premises are counted per persona on its dashboard`
- `PE-3 Activate is offered only to a person holding admin on the harness's area, and only while the persona is suggested`

`apps/uw-app/personas/routes.pg.test.ts`:
- `PE-4 a persona page opens on its dashboard`
- `PE-3 the Activate form activates the persona through the command dispatcher and shows the outcome in place` (and a stale `expectedVersion` shows `stale_version` beside the button)
- `PE-2 the toolset form saves only offered verbs and requires_tools follows`
- a POST without a same-origin `Origin` is refused by `csrf()` (titled without an ID)

`apps/uw-app/personas/view.test.ts` (jsdom and `axe-core`, as `packages/ui` tests do): `PE-4 the persona view renders in light and dark with an accessible name on every control`; Kindle appears only on Activate (titled without an ID).

- [ ] **Step 2:** Run `pnpm vitest run packages/harness/personas sim/kernel/persona-dashboard.test.ts apps/uw-app/personas`; expected FAIL.
- [ ] **Step 3:** Implement. Load the view at 390 px wide in light and dark if a browser is available; if not, record it under "Not verified" in Task 9.
- [ ] **Step 4: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`

```bash
git add packages/harness sim apps/uw-app tools
git commit -m "feat(personas): a persona page opens on its dashboard, with the toolset form and Activate for an admin

PE-2 PE-3 PE-4 PE-5"
```

---

### Task 9: Record step 10 in the progress tracker

**Requirements:** PE-1 to PE-8 (the record); DX-5.

**Files:**
- Modify: `docs/progress_tracker.md` (`.superpowers/sdd/BUILD.md` is the controller's and is not touched)

- [ ] **Step 1: Prove the trace**

Run: `pnpm trace` and `pnpm trace:built`
Expected: `pnpm trace` lists none of PE-1 to PE-8. Record the summary line exactly as printed.

- [ ] **Step 2: Update the tracker**

1. Status row 10: `Built`, with the evidence: the plan path; scenarios `sim/scenarios/PE-3.*`, `PE-5.*`, `PE-6.*`, `PE-7.*`; PE-1, PE-2, PE-4 and PE-8 proven by tests only (list the files from `tools/trace/proofs.ts`'s scanner output for PE-*); the trace summary line; `pnpm verify` green with `TEST_DATABASE_URL` set; what has not run live (no Builder App, no Reviewer App, no sandbox push, no browser rendering unless Task 8 ran one).
2. Step 3's row and the KN-7 evidence row: the revision clause is now proven by `sim/kernel/revision-attach.test.ts` (`KN-7 every revision Iterate proposes carries an evidence label, ...`) and `sim/scenarios/PE-7.*`; remove "waits for PE-7".
3. A "Step 10 evidence by requirement" section in the format of step 6's (commits from Task 1's first commit to this commit, the plan commit left out; each commit listed against every requirement its body's last line names).
4. "Decisions made during the build": S10-D1 to S10-D20, one row each (date 2026-10-03, the requirement IDs, the decision, why, the cost if wrong), plus every ruling the controller makes during execution.
5. "New dependencies": `yaml` `^2.9.1` in `@uw/harness` (ISC; replaces a hand-written agentskills header parser; already a root devDependency); contract `11.1.0` (not a dependency; both apps' `contractVersion` moved).
6. "Not verified": the persona view in a browser at 390 px in light and dark (if not run); `git` over the egress proxy against real GitHub (pkt-line framing from documentation and fixtures only; protocol v2 and side-band behaviour unchecked); the pull-request creation through the proxy against real GitHub; the dry run's fixture turn is not a model call, so a model id a vendor refuses is found at the first real run (S10-D3).
7. "Waiting on a person": the Builder GitHub App (`infra/github/builder-app-manifest.json`; register, install on `unfoldingWord/uw-platform`, set `BUILDER_GITHUB_APP_ID`, `BUILDER_GITHUB_APP_INSTALLATION_ID`, `BUILDER_GITHUB_APP_PRIVATE_KEY`; then one hosted Builder run that pushes `harness/<item>` and opens a declared pull request; an org owner, Ian); update the GH-5 row on `packages/harness/github/reviewers.ts`: the table now names each Reviewer's persona (`agent:reviewer`, `agent:reviewer-codex`) and `packages/harness/github/builder.ts` names `uw-builder[bot]`; the logins are confirmed or replaced when the three Apps are registered (an org owner); the fixture personas' models and providers (`claude-sonnet-4-5`/`anthropic`, `z-ai/glm-5.3-flash`/`z-ai`, `gpt-5-codex`/`openai`) are placeholders to confirm with the AI Gateway setup (Q10, P29; Ian, the sponsor).
8. "Carried to later steps": close each row naming step 10 with its commits: the step-1 row (Task 1), the two step-3 rows (AB-6: Task 5, S10-D15; PE-7/KN-7: Task 5), the step-4 rows (PE-8 version pin: Task 3; PE-2 R22: Tasks 1 and 3; PE-3 dry run and flip, PE-7 `measurements_for_item`, the projection in poll: Tasks 2, 4 and 5; PE-3/PE-8 flip `WHERE version` and `activation_required`: Tasks 2, 3 and 4), the step-5 row (PE-6/HE-9 logins: Task 6, live logins still waiting), and the step-7 rows (hosted Builder push and pull request: Task 7; Reviewer three rounds: Task 6; projection in the beat: Task 4). Add any new carry the tasks found (step 11, DX-7).

- [ ] **Step 3: Verify and commit**

Run: `pnpm format && TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`
Expected: PASS (`trace:built` now holds step 10 to its proofs).

```bash
git add docs/progress_tracker.md
git commit -m "docs(tracker): step 10, personas, built: evidence, decisions, what was not verified and what waits on a person

PE-1 PE-2 PE-3 PE-4 PE-5 PE-6 PE-7 PE-8 KN-7"
```
