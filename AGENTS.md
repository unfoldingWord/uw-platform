# AGENTS.md

Rules for anyone, human or agent, changing this repository. Read this whole file before your first edit. Work comes from GitHub issues, one issue per pull request into `develop`. Every rule here exists because an agent without it will take the shortcut it describes.

## 0. The documents

Each document has one job. Load the one the task needs; do not restate one inside another.

| Read | For |
|---|---|
| **GitHub issues** | **The list of work.** Every task is an issue; a larger piece of work is an epic issue with sub-issues (for example #99). An issue says what to build and when it is done. There is no other list |
| [`docs/PRD.md`](docs/PRD.md) | Reference: how the platform was designed and why, requirement by requirement. Read the section an issue touches; it is not a checklist new work must cite or extend |
| [`prd/Harness v1 - Architecture.md`](prd/Harness%20v1%20-%20Architecture.md) | Reference: the ratified design. Its Decisions table (D1 to D22) and figures explain the shape |
| [`CONTEXT.md`](CONTEXT.md) | The words. Every module, test and screen uses these and no synonyms |
| [`docs/architecture.md`](docs/architecture.md) | The shape: the kernel over ports, events, the sim, the checks |
| [`prd/An App For Everything - Platform Architecture Plan.md`](prd/An%20App%20For%20Everything%20-%20Platform%20Architecture%20Plan.md) | The platform the harness sits in: ACL (§4), pages (§2), topology (§1), conventions (§0) |
| [`docs/adr/`](docs/adr/) | Why the shape is this way. Read before changing it |
| `packages/ui/tokens/` | The tokens. See ADR 0007 and ADR 0011 |
| `docs/exceptions.md` | Recorded exceptions to the rules |
| [`docs/progress_tracker.md`](docs/progress_tracker.md) and `docs/plans/` | **History, frozen on 2026-11-12.** How v0.1 to v0.3 were built. Read for context; never update them |

"Harness" in the code is a **workflow** in the UI and in conversation: a set of stages that items move through, with the people and agents who work them.

## 1. Fixed decisions

These are settled. Work inside them; changing one is an architecture change (section 9).

| Concern | Decision |
|---|---|
| Language | TypeScript, `strict: true`, no `any`, no `// @ts-ignore` |
| Platform | Cloudflare Workers: `uw-app` (Hono SSR and islands, command API, MCP surface, live hub, Workflows, crons) and `uw-ingest` (webhooks). Postgres (AWS Aurora) through Hyperdrive, reached over a Cloudflare Tunnel and a Workers VPC service. Declared in `infra/`, never clicked |
| Shape | Ports and adapters. The harness kernel is pure TypeScript in `packages/harness`, reached only through ports, the database included. Every port has a platform adapter and a test adapter; the sim drives the kernel in Node (ADR 0001) |
| Words | "Kernel" is the pure core. "Engine" means only the code behind the model-vendor seam |
| Agent boundary | Agents reach the platform only through the MCP surface serving the verb registry; approve, merge, deploy, publish and advance do not exist as verbs (ADR 0002) |
| The gate | Ship exits only on human approval, enforced by a Postgres check constraint; the ship rule is a pure function over GitHub facts, risk tier and the approver's principal (ADR 0003) |
| Truth | `harness_events` is append-only and the source of truth; state is a fold; replay equals record (ADR 0004) |
| Unattended work | Runs only on a delegation, on every host (ADR 0005) |
| Hosts, engines, billing | Two hosts, one verb registry, six engines each in its own directory, billing by host (ADR 0006; whether to add subscription billing is open in #98) |
| Schema | Drizzle in `packages/db/schema.ts` is the only schema; it re-exports one `packages/db/schema-<domain>.ts` file per domain (platform, and later GitHub) so no file passes 500 lines; migrations in `packages/db/migrations/`; every table declares `classification` and `offline_eligibility` (plan §2.6) |
| Authorization | Plan §4: `role_grants` with `admin | editor | viewer` at `org` or `jd_area` scope, one `can(actor, verb, resource)`, a principal minted at the edge on every request. The harness derives from it and adds nothing beside it |
| Conventions | Plan §0: dates `YYYY-MM-DD` through one `formatDate`/`parseDate` pair, money in integer minor units, UUID ids with slugs, Zod at every boundary |
| Contracts | `packages/contracts` publishes commands, events, outcomes and the verb registry as Zod, one live version, golden fixtures, a conformance test (spec D4) |
| Design | Tailwind 4 over one token system in `packages/ui/tokens/*.css`, generated from the brand colours and, from v0.3.0 build step 21, locked: the token scales are the whole Tailwind theme, spacing included, and an arbitrary value fails the build; light and dark follow the system setting with a persisted override; Kindle orange marks a human action and nothing else (ADR 0007, ADR 0011). Screens take the look of the Claude Design prototype in git history (`9a4955e^:ui-design/`), its values snapped to the token scales (ADR 0014) |
| Package manager | pnpm workspaces, Node 22 |
| Toolchain | ESLint flat config with fitness functions, Prettier, Vitest on the Workers pool, dependency-cruiser, knip, Husky, `pnpm audit` |
| Tests | Vitest. Scenarios in `sim/scenarios/` and tests at each module's interface, named for what they prove, one contract test per port run against every adapter, and the tests only separate connections can prove on a Postgres service container in CI (PRD DX-6). No test needs a live account or a secret (PRD DX-8) |
| Lint and format | `pnpm check`; the full chain is `pnpm verify`, the same one CI runs |
| Code comments | None. Meaning lives in names, types, tests and `docs/`, never in a comment |
| File length | Under 500 lines; functions under 50 |
| Commits | Conventional Commits; the agent as author, per `unfoldingWord/uw-dev-skills`, and an attribution footer is allowed; hooks always pass; `--no-verify` unused |

## 2. The cockpit

The commands a worker drives the system with. `pnpm verify` runs the whole chain, including `pnpm walk:all` and `pnpm sim:all`.

```
pnpm sim -- <scenario>     run one scenario; print the event log and the folded state
pnpm sim -- all            every scenario
pnpm walk -- <template>    every path from Package to an external effect, and the gate each crosses
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

- New kernel module: a function on the module's interface in `packages/harness`, a test at that interface, a scenario for the behaviour.
- New port: `packages/harness/ports.ts`, then the platform adapter in `apps/uw-app/ports/`, the test adapter in `sim/adapters/` and the port's contract suite in `packages/harness/port-contracts/` with a contract test beside each adapter, together, never one without the others. A port whose service is built in a later step gets a platform adapter that is not wired, and its contract test proves that.
- New event: the enum in `packages/contracts`, its fixtures, and the folds that should count it.
- New verb: the registry in `packages/contracts`, the MCP handler, the persona toolsets that may hold it.
- New engine: a directory under `apps/uw-app/engines/<key>/`; the vendor SDK imported there and nowhere else.
- New validator or connector: a registry entry and a handler; a stage row picks it by key.
- New table or column: the `packages/db/schema.ts` file for its domain (`schema.ts` for the harness, `schema-platform.ts` for the platform) with its classification, and a migration.
- New command: `packages/contracts`, the Hono route with `can()`, a scenario.
- New screen: one island, one route, one scenario, tokens only.
- New word: `CONTEXT.md` first.

If the work does not fit a template, choose the nearest one, say which and why in the pull request description, and continue. Do not improvise silently.

### Rule 2. Forbidden dependencies fail mechanically

The build enforces these. A violation is a red build, not a judgment call.

- `packages/harness/*` imports nothing from Workers, Drizzle, a vendor SDK or the network. It is pure TypeScript and runs in plain Node. This is what lets the sim exist.
- `packages/contracts/*` and `packages/db/*` import nothing from `apps/*`.
- A vendor SDK (`@anthropic-ai/*`, `openai`, OpenRouter) is imported only inside `apps/uw-app/engines/<key>/`.
- Application code reaches Postgres, GitHub, a model, the hub or a notifier only through a port; nothing outside `apps/uw-app`, `sim/adapters` and `packages/db/store` implements one. `packages/db/store` holds the one Drizzle implementation of the Store and Grants ports, which the platform adapter and the sim's test adapter both bind, because both must run the same queries (PRD DX-2).
- No route, tool handler or Workflow step reachable by an agent identity writes `gate_decisions` or `harness_stages`. The one exception is `gate_decisions` written by the delegated Ship exit section 10 names; `harness_stages` has none.
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
- `gate_decisions` is written only by the gate command, only for a human principal, inside a transaction that locks and re-reads the approver's grants, and by the delegated Ship exit section 10 names.

### Rule 4. New work adds isolated files rather than branches in shared roots

Adding a persona, an engine, a validator, a connector or a screen means adding a folder or a registry row, and touching shared roots only at reserved discovery points.

- Discovery is by registry, never by editing a switch. An `if (engineName)` or `if (personaName)` branch in shared code is the smell this rule forbids.
- The shared roots are `packages/db/schema.ts`, `packages/db/schema-*.ts`, `packages/contracts/`, `packages/harness/ports.ts`, `packages/harness/store-ports.ts`, `packages/core/acl.ts`, `infra/`, `.github/workflows/`, `AGENTS.md`, `CONTEXT.md` and `docs/adr/`. A pull request that changes one names it in its description, under a heading **Shared roots**, with why it changed. It can share a commit with the feature it serves, because feature pull requests are squash-merged into `develop` and separate commits would not survive the merge.
- `design-system/` is produced in Claude Design and synced here. Code reads it and never hand-edits it.

### Rule 5. Exceptions are narrow, explicit, and recorded

- Every exception to rules 1 to 4 is recorded in `docs/exceptions.md` with: the rule broken, the file, why the rule cannot hold here, and the date.
- An exception without an entry is a defect.
- The entry is written before the code, in the same commit.

## 5. Prefer open source over custom code

Before writing a utility, a client, a parser or a component, search for an existing package. Reach for custom code only when no maintained package does the job. Choose a package that has a permissive license, runs on Workers (and, for anything under `packages/harness`, in plain Node), is typed, is maintained, and does not report to a third party on its own. Name every new dependency in the pull request description with one line: what it replaces.

## 6. UI rules

- Before any UI work read ADR 0007, ADR 0014, then `packages/ui/tokens/`, then the existing screens under `apps/uw-app/views/`, or `design-system/` when it exists. A new screen starts from its counterpart in the prototype (`git archive 9a4955e^ ui-design`), or the closest one, and records which.
- Tokens are the only source of a color, size, spacing step, radius or shadow. A value not in the tokens is a design change, not a code change; the build fails on a hard-coded hex, and from v0.3.0 build step 21 also on an arbitrary Tailwind value such as `p-[18px]` (ADR 0011).
- Every screen renders correctly in light and dark, at phone width, with visible focus and an accessible name on every control.
- Every control returns an outcome; an unwired control says so. Never silence.
- Kindle orange marks a human action and nothing else. There is no red for status; refusals are shown in place, on the control that refused, with the closed-set reason.
- Copy is sentence case, second person, no exclamation marks, no emoji. Navigation items and page names are Title Case, every word capitalized ("Waiting On You", "My Items"). `unfoldingWord` is camelCase every time.

## 7. Working steps

A task is one GitHub issue. Do these in order.

1. **Orient.** Read the issue and its epic, then `CONTEXT.md` for the words, then the folder it touches, then `docs/exceptions.md`. Read the PRD or spec section only where the issue touches a part of the design you need to understand. State in one line which template (rule 1) applies.
2. **Search for prior decisions.** Grep for the tables, events and verbs involved. Find the existing writer (rule 3) before adding one. Check `docs/adr/` and the spec's Decisions table before reopening a settled question. Where nothing decides something, decide it and say so in the pull request description, with what it costs if wrong.
3. **Plan the files.** List every file you will add or edit. If any is a shared root (rule 4), the pull request description will name it.
4. **Write the test first.** The scenario in `sim/scenarios/` or the test that proves the behaviour, named for what it proves, observed red. For a bug, the test that reproduces it, observed red. Only then implement.
5. **Implement.** Copy the template. Fill it. Keep each file under 500 lines and each function under 50.
6. **Verify.** Before pushing, the fast local checks pass: `pnpm check`, `pnpm lint`, `pnpm format:check`, and the tests for what you touched (`pnpm exec vitest run <paths>`). CI then runs the whole `pnpm verify` on every push; read its result before calling the work done. If a screen changed, load it in light and dark at phone width. If a platform adapter changed and its credentials exist, run it against staging; if they do not, say so in the pull request.
7. **Open the pull request** into `develop`, with `Closes #<issue>` and a description of what changed, what was verified and how, and what was not verified.
8. **Report and stop.** Summarize what changed, what you verified, and what you did not verify. Label inferences as inferences. If you could not verify something, say so first.

Done means: CI green on the pull request (the whole `pnpm verify`), every shared-root change named in the description, no exception missing its entry, the behaviour the issue asks for proven by a test or scenario, the pull request open against `develop`, and no claim of verification standing without the run behind it.

## 7b. Branching model (develop → main)

Two long-lived branches, since 2026-11-12, the model of `bt-servant-worker` with one difference: `main` takes no hotfix branches (below).

- **`develop`** is the integration branch and the default branch. Every feature branch and every PR targets `develop`. Staging deploys automatically after CI passes on a push to `develop`. Bot review plus CI is enough to merge there.
- **`main`** is the release branch. It only ever receives `develop`, through a release PR ("Release vX.Y.Z: develop → main"). Only the repo owner can merge to `main`: branch protection restricts pushes and requires a code-owner review. Production deploys from `main` by tag.
- **Rule: `develop` is always releasable.** Work that is not ready to ship stays on its branch, or merges behind a flag that is off in production. Never cherry-pick into `main`; if something on `develop` must not ship, revert it on `develop` or flag it off, then release.
- **Urgent fix:** there is no hotfix branch into `main`. A branch name is chosen by its author, so a `hotfix/*` exception could not prove the branch is a hotfix, and any branch could use it to skip `develop` and staging. An urgent fix is a PR into `develop`, then a release PR straight after; CI takes about six minutes.
- **Release (manual, on the owner's word).** When the owner says to cut a release, the agent works out what is on `develop` since the last tag, proposes the version (a fix bumps the patch, a feature the minor; the owner may override it), writes a changelog from the merged pull requests, opens "Release vX.Y.Z: develop → main" with that changelog, waits for CI (including `Release Source`) and reports. When the owner says to merge it, the agent merges with a merge commit, tags `vX.Y.Z` on the resulting `main` commit, dispatches the production deploy on the tag (`gh workflow run deploy-production.yml --ref vX.Y.Z`), watches it, checks production's `/health/probe`, and reports. Nothing reaches `main` or production without those two words from the owner.
- **Merging into `develop`.** Reviews posted from the owner's own account are comments, not approvals, so `develop`'s required approval is met through the owner's review bypass. On the owner's "good to merge" with CI green, resolve every addressed review thread, then squash-merge with the bypass (`gh pr merge <n> --squash --admin --delete-branch`).
- **Merge methods:** feature PRs into `develop` are **squash**-merged (`develop` requires linear history). Release PRs into `main` use a **merge commit**, never squash or rebase; a ruleset on `main` allows only merge commits. A squash would copy `develop`'s work into a commit `develop` never contains, so the branches would diverge and every later release PR would re-list already-shipped commits.
- **Up to date before merge:** `develop` requires a PR branch to be current with `develop` ("Update branch"), so two PRs that pass alone cannot break together. `main` does not, because `develop` never contains `main`'s release merge commits.

CI's `Release Source` job refuses a PR into `main` from any branch but `develop`; it reads the PR's branch name from an environment variable, never by interpolating it into the script, so a branch name cannot inject shell. `deploy-production.yml` runs only by dispatch, and refuses anything but a `v*` tag whose commit is on `main` (it checks out full history to test that). Staging deploys only after CI on a push to `develop`, since a release PR's CI also runs with head branch `develop`; staging deploys are queued, never cancelled mid-migration, and each first checks that its commit is still `develop`'s tip, so an older run finishing late skips instead of rolling staging back. The red-CI alarm opens one issue per branch (`ci-red-develop`, `ci-red-main`). The app's own merges (the Merge stage) go to the default branch, so workflow PRs land on `develop` too.

## 8. Working an issue

One issue, one branch, one pull request.

- **Branch** from `develop` in the main checkout, named for the work (`feat/agent-queues-landing`, `fix/uw-app-role-exists`), never for a version, and never in a git worktree.
- **Scope** is the issue. Work you notice outside it becomes a new issue, not a bigger pull request.
- **Push** once the fast local checks pass (section 7, step 6); CI runs the whole `pnpm verify` in about six minutes and is the gate. Never force-push.
- **Review is the owner's step.** When the pull request is ready, say so and stop. Do not start a review of your own: no review workflow, no multi-agent fan-out, no reviewer subagents. The owner runs the review (Codex) and passes on its comments.
- **Every review comment is fixed**, whatever its severity, unless there is a concrete, named reason it is wrong; that reason goes in a reply on the comment.
- **Merging** into `develop` happens when the owner says the pull request is good to merge. Merging into `main` (a release) and any production deploy happen only when the owner asks for them.
- **More than one issue in a run** only when the owner asks for it by name ("do #104 and #105"). Then each issue still gets its own branch and pull request, one after another.
- **Rulings, not stalls,** inside an issue: where the issue, the code and this file leave a choice open, make it, say so in the pull request, and keep going.

Stop and ask for these: a destructive or irreversible operation; a change that would let an agent identity pass a human gate; merging to `main`; anything touching production; a secret you would have to invent or paste into a file; a choice that changes what the issue asks for.

## 9. Architecture changes

A change to a shared root (rule 4) or a fixed decision (section 1) is named in the pull request description, which says what changes, why, and what was rejected. If the change is hard to reverse, surprising without context and the result of a real trade-off, the same pull request adds an ADR in `docs/adr/`. The ADR is the record; the PRD and the spec are not updated.

## 10. Things that always hold

- No agent identity can approve, merge, deploy, publish or advance an item past a human gate, on any host, by any route, except the delegated Ship exit below, where the approver is the granting person and the database refuses any other agent-written decision. A change that makes it possible otherwise is wrong whatever else it does.
- The delegated Ship exit (`recordDelegatedDecision` in `packages/harness/gates/delegated-ship.ts`, ADR 0010) is the one agent-reachable path that writes a gate decision. It writes the granting person as approver, the agent as actor and the delegation's id, for a merge only, up to the delegation's tier, never for a protected path, inside the transaction that locks and re-reads the delegation and the grantor's grants; the merge itself runs later from the minute job, which checks it all again. A second such path is wrong whatever else it does.
- No route, tool or Workflow step is added without `can()` on the harness's area as its scope.
- No vendor SDK outside its engine directory. No subscription credential stored on the platform. No secret in a wrangler file, a workflow file or the repository.
- Everything that happens to a harness is an event in `harness_events`; a failure is an event with a closed-set reason, shown as state in place, never as raw exception text.
- A control goes busy before the first `await` in its handler. An async re-read never overwrites a known value with a stale one.
- Code carries no comments: no line comments, no block comments, no JSDoc, no directive comments, no commented-out code. What a comment would have said goes into a name, a type, a test, or `docs/`. A lint rule enforces this.
- Deleting code with no visible callers is allowed once a grep of the repo confirms zero references. Say that you grepped.
- No merge to this repository's `main`, from any branch, and no production deploy without a person at the keyboard saying so. This governs the build process, the agents building this repository; a merge the platform makes for a harness's repository under a merge delegation is the delegated Ship exit above. Whether the platform's own harness (`unfoldingWord/uw-platform`) may ever be granted a merge delegation is a person's decision, still open.
- Never merge on red CI. Never push with the fast local checks failing.
- When the requested implementation conflicts with a rule in this file, the rule wins. Build the version that keeps the rule, record the conflict in the pull request description, and continue; stop only when no version keeps the rule.
