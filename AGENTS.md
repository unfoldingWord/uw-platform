# AGENTS.md

Rules for anyone, human or agent, changing this repository. Read this whole file before your first edit. Every rule here exists because an agent without it will take the shortcut it describes.

## 0. The tower of documents

Each document has one job. Load the one the task needs; do not restate one inside another.

| Read | For |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | The words. Every module, test, issue and screen uses these and no synonyms |
| [`docs/architecture.md`](docs/architecture.md) | The shape: the engine over ports, the tower, events, the sim, the checks |
| [`prd/Harness v1 - Architecture.md`](prd/Harness%20v1%20-%20Architecture.md) | What to build and why: the ratified spec. Its Decisions table (D1 to D22) and figures are the design; cite them |
| [`prd/An App For Everything - Platform Architecture Plan.md`](prd/An%20App%20For%20Everything%20-%20Platform%20Architecture%20Plan.md) | The platform the harness sits in: ACL (§4), pages (§2), topology (§1), conventions (§0). Read the section an issue cites |
| [`docs/adr/`](docs/adr/) | Why the shape is this way. Read before proposing to change it |
| GitHub issues and milestones | The work. Each issue cites the spec, carries acceptance criteria and blocked-by edges. There is no other list |
| `ui-design/` and, when it lands, `design-system/` | The prototype and the tokens. See ADR 0007 |
| `docs/exceptions.md` | Recorded exceptions to the rules |

Where the spec and this file disagree, the spec wins on what and this file wins on how. Where an issue and the spec disagree, the spec wins and the issue is corrected.

## 1. Fixed decisions

These are settled. Work inside them; changing one is an architecture change (section 9), made in its own PR.

| Concern | Decision |
|---|---|
| Language | TypeScript, `strict: true`, no `any`, no `// @ts-ignore` |
| Platform | Cloudflare Workers: `uw-app` (Hono SSR and islands, command API, MCP surface, live hub, Workflows, crons) and `uw-ingest` (webhooks). Neon Postgres through Hyperdrive. Declared in `infra/`, never clicked |
| Shape | The harness engine is pure TypeScript over ports in `packages/harness`, with a platform adapter and a memory adapter per port; the sim drives it in Node (ADR 0001) |
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
| Toolchain | The `bt-servant-worker` standard (issue #67): ESLint flat config with fitness functions, Prettier, Vitest on the Workers pool, dependency-cruiser, Husky, `pnpm audit` |
| Tests | Vitest. Scenarios in `sim/scenarios/` named for the spec section or issue they prove, tests at each module's interface, and two Postgres-only tests on a Neon branch in CI |
| Lint and format | `pnpm check`; the full chain is `pnpm verify`, the same one CI runs |
| Code comments | None. Meaning lives in names, types, tests and `docs/`, never in a comment |
| File length | Under 500 lines; functions under 50 |
| Commits | Conventional Commits; the agent as sole author with no attribution footer, per `unfoldingWord/uw-dev-skills`; hooks always pass; `--no-verify` unused |

The scaffold (milestone M0) is accepted only when every check in `docs/architecture.md` ("Every rule is a check") exists and has been observed red once.

## 2. The cockpit

The commands a worker drives the system with. Until M0 lands they are the contract for what it must provide.

```
pnpm sim -- <scenario>     run one scenario; print the event log and the folded state
pnpm sim -- all            every scenario
pnpm walk -- <template>    every path from Package to an external effect, and the gate each crosses
pnpm trace                 spec sections and issues with neither a scenario nor a test
pnpm check                 lint, format, typecheck
pnpm verify                the whole chain, the same one CI runs
pnpm db:migrate            apply migrations to the target in DATABASE_URL
```

Start from the sim. A deployed Worker is for three things: platform adapters, rendering, and the two Postgres-only tests. If a question can be answered by a scenario or an event log, it is answered there first.

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

- New engine module: a function on the module's interface in `packages/harness`, a test at that interface, a scenario named for the spec section.
- New port: `packages/harness/ports.ts`, then both adapters in the same PR, never one.
- New event: the enum in `packages/contracts`; the folds that should count it; its own PR.
- New verb: the registry in `packages/contracts`, the MCP handler, the persona toolsets that may hold it; its own PR.
- New engine: a directory under `apps/uw-app/engines/<key>/`; the vendor SDK imported there and nowhere else.
- New validator or connector: a registry entry and a handler; a stage row picks it by key.
- New table or column: `packages/db/schema.ts` with its classification, and a migration; its own PR.
- New command: `packages/contracts`, the Hono route with `can()`, a scenario.
- New screen: one island, one route, one scenario, tokens only.
- New word: `CONTEXT.md` first.

If the work does not fit a template, say so on the issue and ask before building. Do not improvise.

### Rule 2. Forbidden dependencies fail mechanically

The build enforces these. A violation is a red build, not a review comment.

- `packages/harness/*` imports nothing from Workers, Drizzle, a vendor SDK or the network. It is pure TypeScript and runs in plain Node. This is what lets the sim exist.
- `packages/contracts/*` and `packages/db/*` import nothing from `apps/*`.
- A vendor SDK (`@anthropic-ai/*`, `openai`, OpenRouter) is imported only inside `apps/uw-app/engines/<key>/`.
- Application code reaches Postgres, GitHub, a model, the hub or a notifier only through a port; nothing outside `apps/uw-app` and `sim/adapters` implements one.
- No route, tool handler or Workflow step reachable by an agent identity writes `gate_decisions` or `harness_stages`.
- Islands never call the engine directly; they call the command API.
- `sim/*` imports `packages/harness` and `packages/contracts` and nothing else.

Enforced by dependency-cruiser, ESLint `no-restricted-imports` and `no-restricted-globals`, a tsconfig for `packages/harness` with no Workers types, and the static route test. When you hit the wall, the fix is to move the code, not to relax the rule.

### Rule 3. Every durable value has one obvious writer

A durable value is anything in Postgres.

- Each table is written by exactly one module, named in `docs/architecture.md`; `harness_events` is append-only and the database refuses UPDATE and DELETE on it.
- Every other module reads through the owner's exported functions.
- The writer exports an `owns` constant listing every table it owns; a check fails on any table claimed twice or written elsewhere.
- `gate_decisions` is written only by the gate command, only for a human principal, inside a transaction that locks and re-reads the approver's grants.

### Rule 4. New work adds isolated files rather than branches in shared roots

Adding a persona, an engine, a validator, a connector or a screen means adding a folder or a registry row, and touching shared roots only at reserved discovery points.

- Discovery is by registry, never by editing a switch. An `if (engineName)` or `if (personaName)` branch in shared code is the smell this rule forbids.
- Changes to `packages/db/schema.ts`, `packages/contracts/`, `packages/harness/ports.ts`, `packages/core/acl.ts`, `infra/`, `.github/workflows/`, `AGENTS.md`, `CONTEXT.md`, or `docs/adr/` are architecture changes. Each goes in its own PR, never mixed into feature work, and the PR description says which shared root it changes and why. The human who merges it is the approval.
- `ui-design/` and `design-system/` are produced in Claude Design and synced here. A code PR reads them and never hand-edits them.

### Rule 5. Exceptions are narrow, explicit, and recorded

- Every exception to rules 1 to 4 is recorded in `docs/exceptions.md` with: the rule broken, the file, why the rule cannot hold here, and the date.
- An exception without an entry is a defect.
- The entry is written before the code, in the same commit.

## 5. Prefer open source over custom code

Before writing a utility, a client, a parser or a component, search for an existing package. Reach for custom code only when no maintained package does the job. Choose a package that has a permissive license, runs on Workers (and, for anything under `packages/harness`, in plain Node), is typed, is maintained, and does not report to a third party on its own. Record every new dependency in the PR description with one line: what it replaces.

## 6. UI rules

- Before any UI work read ADR 0007, then `packages/ui/tokens/`, then the matching screen in `ui-design/` (Development, Agent Queues, Health) or `design-system/` when it exists.
- Tokens are the only source of a color, size or radius. A value not in the tokens is a design change, not a code change; the tokens-agree check fails the build on a hard-coded hex.
- Every screen renders correctly in light and dark, at phone width, with visible focus and an accessible name on every control.
- Every control returns an outcome; an unwired control says so. Never silence.
- Kindle orange marks a human action and nothing else. There is no red for status; refusals are shown in place, on the control that refused, with the closed-set reason.
- Copy is sentence case, second person, no exclamation marks, no emoji. `unfoldingWord` is camelCase every time.

## 7. Working steps

Do these in order for every task.

1. **Pick.** Take the highest-priority open issue labelled `ready` in the lowest-numbered milestone whose blocked-by list is empty and that nobody is assigned to. Assign yourself and comment that you are starting. One open PR per worker.
2. **Orient.** Read the issue, then the spec section and plan section it cites, then `CONTEXT.md` for the words, then the folder it touches, then `docs/exceptions.md`. State in one line which template (rule 1) applies.
3. **Search for prior decisions.** Grep for the tables, events and verbs involved. Find the existing writer (rule 3) before adding one. Check the spec's Decisions table and `docs/adr/` before reopening a settled question. Where the issue says "not specified in the spec; decide in the PR", decide, and record the decision in the PR body.
4. **Plan the files.** List every file you will add or edit. If any is a shared root (rule 4), that change goes in its own PR, and its description says which shared root and why.
5. **Write the scenario first.** For a spec section, the scenario in `sim/scenarios/` that proves it, observed red. For a bug, the scenario that reproduces it, observed red. Only then implement.
6. **Implement.** Copy the template. Fill it. Keep each file under 500 lines and each function under 50.
7. **Verify.** `pnpm verify` green. If a screen changed, load it in light and dark at phone width. If an adapter changed, run it against staging. Paste the command output in your summary.
8. **Open the PR.** Branch `harness/<issue>-<slug>` off `main`. The body says `Closes #<issue>`, what it touches, its risk tier and domains, and every "decide in the PR" decision you made. Draft until verify is green, then mark ready for review.
9. **Report.** Summarize what changed, what you verified, and what you did not verify. Label inferences as inferences. If you could not verify something, say so first.

Done means: all nine steps completed, `pnpm verify` green, no shared root changed inside a feature PR, no exception missing its entry, every acceptance criterion on the issue checked with the evidence behind it, and no claim of verification standing without the run behind it.

## 8. Review and merge

- **Codex reviews every PR**, run by a person from the Codex CLI, so a PR waits at "ready for review" until someone runs it. Each round it posts findings by severity, inline comments, and a verdict. Answer every finding it lists, in one push per round. Unrelated changes restart the review.
- **An approved PR is frozen.** Push only if the reviewer requested changes or the PR conflicts with `main`. Record non-blocking notes (P3, follow-up, hygiene) as follow-up issues, never as pushes to an approved PR.
- **Every merge is a squash, on green.** Codex posts from a person's account. When that account authored the PR, GitHub allows only a comment, so Codex's verdict is a comment, not a formal approval, and the merger reads the verdict, never the badge. When a different account runs Codex, it can submit a formal approval. Never merge from the "Approved" badge alone.
- **The unattended pickup agent merges its own reviewed PR.** It may merge when all four hold: it authored the PR; the review state is a formal `APPROVED` from an account that did not author it; every check on the current head is green with none pending; and the PR is mergeable without conflict. Read the first and the last with `gh pr view <number> --json reviewDecision,mergeable,author`, and the checks with `gh pr checks <number>`. Anything short of all four means no merge. It never merges a PR it did not author, and never merges a PR that touches a shared root (rule 4) — a human merges those. Every other merge is a human's.
- **Never merge on red.** The repository is private on GitHub's Free plan, so there is no branch protection or ruleset (issue #12): GitHub does not stop a merge with failing checks, a stale approval or an out-of-date branch. The merger enforces it. Before merging, confirm with `gh pr checks <number>` that every check on the current head is green, and none pending, and say so in the merge; until CI exists (#68), `pnpm verify` on the head, run by the merger, stands in. A red or pending check means no merge.
- **Do not subscribe to the PR.** Check it on your next run instead. If you hold an open PR, finish it before taking new work: merge it if it meets the conditions above, push one round answering every finding if the reviewer asked for changes, and otherwise exit. Only with no open PR do you pick a new issue (section 7 step 1).
- **Decisions go on the PR**, as a comment from your own account. The DRIs are Ian and Jesse; the reviewer acts only on a decision it can see there.
- **Hot files.** `packages/db/schema.ts`, `packages/contracts/` and the event vocabulary are the files most likely to conflict. They change only in their own PRs, and the M2 issues that touch the schema are worked in order, tables first.
- If none of this applies because no `ready` issue is available, exit without doing anything.

## 9. Architecture changes

A change to a shared root (rule 4) or a fixed decision (section 1) goes in its own PR. The description says what changes, why, and what was rejected. Codex reviews it like any other PR and a human merges it; there is no separate approval step. If the change is hard to reverse, surprising without context and the result of a real trade-off, the same PR adds an ADR in `docs/adr/`, and if it changes the design it also changes the spec's Decisions table.

## 10. Things that always hold

- No agent identity can approve, merge, deploy, publish or advance an item past a human gate, on any host, by any route. A change that makes it possible fails review whatever else it does.
- No route, tool or Workflow step is added without `can()` on the harness's area as its scope.
- No vendor SDK outside its engine directory. No subscription credential stored on the platform. No secret in a wrangler file or a workflow file.
- Everything that happens to a harness is an event in `harness_events`; a failure is an event with a closed-set reason, shown as state in place, never as raw exception text.
- A control goes busy before the first `await` in its handler. An async re-read never overwrites a known value with a stale one.
- Code carries no comments: no line comments, no block comments, no JSDoc, no directive comments, no commented-out code. What a comment would have said goes into a name, a type, a test, or `docs/`. A lint rule enforces this.
- Deleting code with no visible callers is allowed once a grep of the repo confirms zero references. Say that you grepped.
- No merge to `main` without a human's permission. For the unattended pickup agent merging its own reviewed PR, that permission is granted in advance by section 8 and bounded by the four conditions stated there. Every other merge needs a human at the keyboard.
- When the requested implementation conflicts with a rule in this file, the rule wins. Say so, and ask the DRIs on the issue or PR before building.
