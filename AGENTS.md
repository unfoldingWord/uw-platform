# AGENTS.md

Rules for anyone, human or agent, changing this repository. Read this whole file before your first edit. Every rule here exists because an agent without it will take the shortcut it describes.

## 0. The documents

Each document has one job. Load the one the task needs; do not restate one inside another.

| Read | For |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | What to build: every requirement with a stable ID, the build order (section 13), the release criteria (section 14), what needs a person (section 15) and the decision log (section 18). This is the list of work. There is no other list |
| [`prd/Harness v1 - Architecture.md`](prd/Harness%20v1%20-%20Architecture.md) | Why, and the design: the ratified spec. Its Decisions table (D1 to D22) and figures are the design; cite them |
| [`CONTEXT.md`](CONTEXT.md) | The words. Every module, test and screen uses these and no synonyms |
| [`docs/architecture.md`](docs/architecture.md) | The shape: the kernel over ports, events, the sim, the checks |
| [`prd/An App For Everything - Platform Architecture Plan.md`](prd/An%20App%20For%20Everything%20-%20Platform%20Architecture%20Plan.md) | The platform the harness sits in: ACL (§4), pages (§2), topology (§1), conventions (§0). Read the section a requirement cites |
| [`docs/adr/`](docs/adr/) | Why the shape is this way. Read before changing it |
| [`docs/progress_tracker.md`](docs/progress_tracker.md) | Where the build stands: requirements done, decisions made along the way, what was not verified, what waits on a person |
| `ui-design/` and, when it lands, `design-system/` | The prototype and the tokens. See ADR 0007 |
| `docs/exceptions.md` | Recorded exceptions to the rules |

Where the spec and the PRD disagree on design, the spec wins and the PRD is corrected. Where either disagrees with this file, they win on what and this file wins on how. GitHub issues #4 to #82 are history; the PRD's Appendix B maps each to the requirements that replaced it.

## 1. Fixed decisions

These are settled. Work inside them; changing one is an architecture change (section 9).

| Concern | Decision |
|---|---|
| Language | TypeScript, `strict: true`, no `any`, no `// @ts-ignore` |
| Platform | Cloudflare Workers: `uw-app` (Hono SSR and islands, command API, MCP surface, live hub, Workflows, crons) and `uw-ingest` (webhooks). Neon Postgres through Hyperdrive. Declared in `infra/`, never clicked |
| Shape | Ports and adapters. The harness kernel is pure TypeScript in `packages/harness`, reached only through ports, the database included. Every port has a platform adapter and a test adapter; the sim drives the kernel in Node (ADR 0001) |
| Words | "Kernel" is the pure core. "Engine" means only the code behind the model-vendor seam |
| Agent boundary | Agents reach the platform only through the MCP surface serving the verb registry; approve, merge, deploy, publish and advance do not exist as verbs (ADR 0002) |
| The gate | Ship exits only on human approval, enforced by a Postgres check constraint; the ship rule is a pure function over GitHub facts, risk tier and the approver's principal (ADR 0003) |
| Truth | `harness_events` is append-only and the source of truth; state is a fold; replay equals record (ADR 0004) |
| Unattended work | Runs only on a delegation, on every host (ADR 0005) |
| Hosts, engines, billing | Two hosts, one verb registry, six engines each in its own directory, billing by host (ADR 0006) |
| Schema | Drizzle in `packages/db/schema.ts` is the only schema; migrations in `packages/db/migrations/`; every table declares `classification` and `offline_eligibility` (plan §2.6) |
| Authorization | Plan §4: `role_grants` with `admin | editor | viewer` at `org` or `jd_area` scope, one `can(actor, verb, resource)`, a principal minted at the edge on every request. The harness derives from it and adds nothing beside it |
| Conventions | Plan §0: dates `YYYY-MM-DD` through one `formatDate`/`parseDate` pair, money in integer minor units, UUID ids with slugs, Zod at every boundary |
| Contracts | `packages/contracts` publishes commands, events, outcomes and the verb registry as Zod, one live version, golden fixtures, a conformance test (spec D4) |
| Design | Tailwind 4 over the brand tokens in `packages/ui/tokens/*.css`; light and dark follow the system setting with a persisted override; Kindle orange marks a human action and nothing else (ADR 0007) |
| Package manager | pnpm workspaces, Node 22 |
| Toolchain | ESLint flat config with fitness functions, Prettier, Vitest on the Workers pool, dependency-cruiser, knip, Husky, `pnpm audit` |
| Tests | Vitest. Scenarios in `sim/scenarios/` named for the PRD requirement ID they prove, tests at each module's interface, one contract test per port run against every adapter, and the tests only separate connections can prove on a Postgres service container in CI (PRD DX-6). No test needs a live account or a secret (PRD DX-8) |
| Lint and format | `pnpm check`; the full chain is `pnpm verify`, the same one CI runs |
| Code comments | None. Meaning lives in names, types, tests and `docs/`, never in a comment |
| File length | Under 500 lines; functions under 50 |
| Commits | Conventional Commits; the agent as sole author with no attribution footer, per `unfoldingWord/uw-dev-skills`; hooks always pass; `--no-verify` unused |

## 2. The cockpit

The commands a worker drives the system with. `pnpm verify` runs `pnpm walk:all`, `pnpm trace:built` and `pnpm sim:all`; `trace:built` fails only on an unproven Must requirement whose build-order step the progress tracker marks Built, and `pnpm trace` lists every unproven one.

```
pnpm sim -- <scenario>     run one scenario; print the event log and the folded state
pnpm sim -- all            every scenario
pnpm walk -- <template>    every path from Package to an external effect, and the gate each crosses
pnpm trace                 PRD requirement IDs with neither a scenario nor a test
pnpm trace:built           the same list; fails only on requirements whose step is marked Built
pnpm check                 lint, format, typecheck
pnpm verify                the whole chain, the same one CI runs
pnpm db:generate           generate a migration from the schema
pnpm db:migrate            apply migrations to the target in DATABASE_URL
```

Start from the sim. A deployed Worker is for three things: platform adapters, rendering, and the tests only real infrastructure can prove. If a question can be answered by a scenario or an event log, it is answered there first.

## 3. The contract

A coding agent optimizes for what fits in its context. Left alone it will:

- copy the nearest working pattern;
- edit the file already open;
- choose the shortest path that compiles;
- avoid deleting code whose callers are not visible;
- follow the requested implementation even when it conflicts with a system invariant;
- claim a verification it did not perform;
- reach for staging when the sim would have answered;
- add a route, a tool or a column that quietly widens what an agent identity can do.

These behaviors are predictable inputs. The repository is shaped so that the conventional path is also the shortest one. Five rules carry that shape.

## 4. The five rules

### Rule 1. The conventional path requires fewer decisions than a shortcut

Every kind of work has one template. Copy the template, fill the blanks, stop.

- New kernel module: a function on the module's interface in `packages/harness`, a test at that interface, a scenario named for the requirement ID.
- New port: `packages/harness/ports.ts`, then the platform adapter in `apps/uw-app/ports/`, the test adapter in `sim/adapters/` and the port's contract suite in `packages/harness/port-contracts/` with a contract test beside each adapter, together, never one without the others. A port whose service is built in a later step gets a platform adapter that is not wired, and its contract test proves that.
- New event: the enum in `packages/contracts`, its fixtures, and the folds that should count it.
- New verb: the registry in `packages/contracts`, the MCP handler, the persona toolsets that may hold it.
- New engine: a directory under `apps/uw-app/engines/<key>/`; the vendor SDK imported there and nowhere else.
- New validator or connector: a registry entry and a handler; a stage row picks it by key.
- New table or column: `packages/db/schema.ts` with its classification, and a migration.
- New command: `packages/contracts`, the Hono route with `can()`, a scenario.
- New screen: one island, one route, one scenario, tokens only.
- New word: `CONTEXT.md` first.

If the work does not fit a template, choose the nearest one, say which and why in `docs/progress_tracker.md`, and continue. Do not improvise silently.

### Rule 2. Forbidden dependencies fail mechanically

The build enforces these. A violation is a red build, not a judgment call.

- `packages/harness/*` imports nothing from Workers, Drizzle, a vendor SDK or the network. It is pure TypeScript and runs in plain Node. This is what lets the sim exist.
- `packages/contracts/*` and `packages/db/*` import nothing from `apps/*`.
- A vendor SDK (`@anthropic-ai/*`, `openai`, OpenRouter) is imported only inside `apps/uw-app/engines/<key>/`.
- Application code reaches Postgres, GitHub, a model, the hub or a notifier only through a port; nothing outside `apps/uw-app`, `sim/adapters` and `packages/db/store` implements one. `packages/db/store` holds the one Drizzle implementation of the Store and Grants ports, which the platform adapter and the sim's test adapter both bind, because both must run the same queries (PRD DX-2).
- No route, tool handler or Workflow step reachable by an agent identity writes `gate_decisions` or `harness_stages`.
- Islands never call the kernel directly; they call the command API.
- `sim/*` imports `packages/harness`, `packages/contracts`, `packages/db` and the Node built-ins `node:fs`, `node:fs/promises`, `node:path`, `node:url`, `node:process`, `node:assert` and `node:assert/strict`, its tests also Vitest, and nothing else. `node:os` and `node:child_process` appear only in sim tests, `sim/cli` and `sim/runner`. It imports `packages/db` because the Store test adapter runs the real migrations on an embedded Postgres (PRD DX-2), and never imports Drizzle or PGlite itself.
- A port's contract suite lives in `packages/harness/port-contracts/`; those files are the only non-test harness code that imports Vitest, and no non-test file in `apps/`, `sim/` or `packages/` imports them.

Enforced by dependency-cruiser, ESLint `no-restricted-imports` and `no-restricted-globals`, a tsconfig for `packages/harness` with no Workers types, and the static route test. When you hit the wall, the fix is to move the code, not to relax the rule.

### Rule 3. Every durable value has one obvious writer

A durable value is anything in Postgres.

- Each table is written by exactly one module, named in PRD section 8.1; `harness_events` is append-only and the database refuses UPDATE and DELETE on it.
- Every other module reads through the owner's exported functions.
- The writer exports an `owns` constant listing every table it owns; a check fails on any table claimed twice or written elsewhere.
- A kernel table is written through its Store gateway's `write` half (`tx.<table>.write.*`), named after the table's Drizzle export; only the table's owner module calls it, and `tools/architecture/owners.test.ts` treats that call as a write.
- `gate_decisions` is written only by the gate command, only for a human principal, inside a transaction that locks and re-reads the approver's grants.

### Rule 4. New work adds isolated files rather than branches in shared roots

Adding a persona, an engine, a validator, a connector or a screen means adding a folder or a registry row, and touching shared roots only at reserved discovery points.

- Discovery is by registry, never by editing a switch. An `if (engineName)` or `if (personaName)` branch in shared code is the smell this rule forbids.
- The shared roots are `packages/db/schema.ts`, `packages/contracts/`, `packages/harness/ports.ts`, `packages/core/acl.ts`, `infra/`, `.github/workflows/`, `AGENTS.md`, `CONTEXT.md` and `docs/adr/`. A change to one goes in its own commit, never mixed with feature code, and the commit message names the shared root and why it changed.
- `ui-design/` and `design-system/` are produced in Claude Design and synced here. Code reads them and never hand-edits them.

### Rule 5. Exceptions are narrow, explicit, and recorded

- Every exception to rules 1 to 4 is recorded in `docs/exceptions.md` with: the rule broken, the file, why the rule cannot hold here, and the date.
- An exception without an entry is a defect.
- The entry is written before the code, in the same commit.

## 5. Prefer open source over custom code

Before writing a utility, a client, a parser or a component, search for an existing package. Reach for custom code only when no maintained package does the job. Choose a package that has a permissive license, runs on Workers (and, for anything under `packages/harness`, in plain Node), is typed, is maintained, and does not report to a third party on its own. Record every new dependency in `docs/progress_tracker.md` with one line: what it replaces.

## 6. UI rules

- Before any UI work read ADR 0007, then `packages/ui/tokens/`, then the matching screen in `ui-design/` (Development, Agent Queues, Health) or `design-system/` when it exists.
- Tokens are the only source of a color, size or radius. A value not in the tokens is a design change, not a code change; the tokens-agree check fails the build on a hard-coded hex.
- Every screen renders correctly in light and dark, at phone width, with visible focus and an accessible name on every control.
- Every control returns an outcome; an unwired control says so. Never silence.
- Kindle orange marks a human action and nothing else. There is no red for status; refusals are shown in place, on the control that refused, with the closed-set reason.
- Copy is sentence case, second person, no exclamation marks, no emoji. `unfoldingWord` is camelCase every time.

## 7. Working steps

Do these in order for every task. A task is one or more PRD requirements, named by ID.

1. **Orient.** Read the task, then the PRD requirements it names, then the spec section and plan section they cite, then `CONTEXT.md` for the words, then the folder it touches, then `docs/exceptions.md`. State in one line which template (rule 1) applies.
2. **Search for prior decisions.** Grep for the tables, events and verbs involved. Find the existing writer (rule 3) before adding one. Check PRD section 18, the spec's Decisions table and `docs/adr/` before reopening a settled question. Where none of them decides something, decide it, and record the decision in `docs/progress_tracker.md` with what it costs if wrong.
3. **Plan the files.** List every file you will add or edit. If any is a shared root (rule 4), that change is its own commit.
4. **Write the scenario first.** For a requirement, the scenario in `sim/scenarios/` or the test that proves it, named for the requirement ID, observed red. For a bug, the scenario that reproduces it, observed red. Only then implement.
5. **Implement.** Copy the template. Fill it. Keep each file under 500 lines and each function under 50.
6. **Verify.** `pnpm verify` green. If a screen changed, load it in light and dark at phone width. If a platform adapter changed and its credentials exist, run it against staging; if they do not, say so in the tracker.
7. **Commit and record.** Commit with the requirement IDs in the message body. Update `docs/progress_tracker.md`: the requirements now done, what was verified and how, and what was not verified.
8. **Report.** Summarize what changed, what you verified, and what you did not verify. Label inferences as inferences. If you could not verify something, say so first.

Done means: all eight steps completed, `pnpm verify` green, every shared-root change in its own commit, no exception missing its entry, every requirement touched has its scenario or test, and no claim of verification standing without the run behind it.

## 8. Building the whole scope

When a person asks for the whole scope, or v1, to be built, that request is the approval to plan and build all of it without stopping between steps.

- **The input is `docs/PRD.md`.** Work through section 13 in order. Write one implementation plan per build-order step, against the code that exists at that moment, under `docs/superpowers/plans/`. Each plan names `docs/PRD.md` as its spec and lists the requirement IDs it covers. Execute each plan as soon as it is written; do not wait for a person to approve a plan or to choose how it runs.
- **The PRD is the approved spec.** Do not brainstorm, do not write another spec, and do not ask for the PRD or a plan to be approved. Go from `docs/PRD.md` straight to writing plans.
- **Subagents are requested.** When the person names subagent-driven development, every subagent that skill dispatches is requested by them for the whole build: the implementer per task, the reviewer per task, the fix rounds and the whole-branch review. Do not ask again, and do not skip the reviewers.
- **Worktree: yes, without asking.** The declared preference is an isolated git worktree on a new branch named `build/v1`. Create it at the start and do not ask for consent.
- **Rulings, not stalls.** Where the PRD, the spec and this file leave a choice open, make it, record it in `docs/progress_tracker.md` with what it costs if wrong, and keep going.
- **Nothing waits on a person.** No account, secret or installation in PRD section 15 is needed to finish the build (PRD DX-8). Prove every requirement against test adapters and fixtures, write the platform adapter, record it under "Waiting on a person" in the tracker as awaiting live verification, and move to the next requirement. Never add a binding, a job or a test that fails when a secret is absent. The staging acceptance run and the first real item (PRD section 14, items 7 to 10) are a person's to do.
- **Branch and push.** Build on a branch, not on `main`. Push whenever `pnpm verify` is green and a requirement or a plan is complete. Open one draft pull request for the branch at the first push, so CI and the per-PR Worker run on every push after it. Never force-push.
- **The build is over** when PRD section 14, items 1 to 6, hold and the tracker says so with the evidence. Then mark the pull request ready and report: what is built, every ruling made, everything not verified, and everything waiting on a person. Do not present a menu of ways to finish; the choice is made: push the branch, keep the worktree, mark the pull request ready, and leave the merge to a person.

Stop and ask only for these: a destructive or irreversible operation; a change that would let an agent identity pass a human gate; merging to `main`; anything touching production; a secret you would have to invent or paste into a file.

## 9. Architecture changes

A change to a shared root (rule 4) or a fixed decision (section 1) goes in its own commit, and the message says what changes, why, and what was rejected. If the change is hard to reverse, surprising without context and the result of a real trade-off, the same commit adds an ADR in `docs/adr/`. If it changes the design, it also changes the spec's Decisions table and PRD section 18.

## 10. Things that always hold

- No agent identity can approve, merge, deploy, publish or advance an item past a human gate, on any host, by any route. A change that makes it possible is wrong whatever else it does.
- No route, tool or Workflow step is added without `can()` on the harness's area as its scope.
- No vendor SDK outside its engine directory. No subscription credential stored on the platform. No secret in a wrangler file, a workflow file or the repository.
- Everything that happens to a harness is an event in `harness_events`; a failure is an event with a closed-set reason, shown as state in place, never as raw exception text.
- A control goes busy before the first `await` in its handler. An async re-read never overwrites a known value with a stale one.
- Code carries no comments: no line comments, no block comments, no JSDoc, no directive comments, no commented-out code. What a comment would have said goes into a name, a type, a test, or `docs/`. A lint rule enforces this.
- Deleting code with no visible callers is allowed once a grep of the repo confirms zero references. Say that you grepped.
- No merge to `main` and no production deploy without a person at the keyboard saying so.
- Never push on a red `pnpm verify`.
- When the requested implementation conflicts with a rule in this file, the rule wins. Build the version that keeps the rule, record the conflict in `docs/progress_tracker.md`, and continue; stop only when no version keeps the rule.
