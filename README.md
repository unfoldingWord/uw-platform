# unfoldingWord Platform

The organization's operating platform, built as modules on one database with one login. This repository holds the first module to be built, the **harness**: the Build, Measure, Learn loop as a mechanism, with agents as governed coworkers and a person at every gate that has an effect on the world.

## Start here

- [`AGENTS.md`](AGENTS.md): the rules for anyone, human or agent, changing this repository. Read it in full before your first edit.
- [`CONTEXT.md`](CONTEXT.md): the vocabulary. One word per concept, everywhere.
- [`prd/Harness v1 - Architecture.md`](prd/Harness%20v1%20-%20Architecture.md): the ratified spec for the harness, with Jesse's review applied. What to build and why.
- [`docs/architecture.md`](docs/architecture.md): the shape. A pure kernel over ports, driven headlessly in a sim, with events as the spine.
- [`docs/adr/`](docs/adr/): why the shape is this way.
- [`docs/PRD.md`](docs/PRD.md): the work. Every requirement with a stable ID, the build order, the release criteria and the decision log. GitHub issues #4 to #82 are history; the PRD's Appendix B maps each to the requirements that replaced it.
- [`docs/progress_tracker.md`](docs/progress_tracker.md): where the build stands.
- [`prd/`](prd/): the platform corpus the harness sits under: the Platform Architecture Plan, Key Visuals, the harness spec and its review.

## Packages

A pnpm workspace on Node 22, TypeScript strict in every package through one `tsconfig.base.json`. The layout is the plan's Repo Skeleton; M0 creates only what the harness needs.

| Path | Package | For |
|---|---|---|
| `apps/uw-app/` | `@uw/uw-app` | The Hono monolith on Workers: SSR pages and islands, command API, MCP surface, live hub, Workflows, queue consumer, crons. The harness runs here as part of the `agents` module |
| `apps/uw-ingest/` | `@uw/uw-ingest` | Public webhooks (GitHub, later Stripe and Zulip): signature verification and enqueue, nothing else |
| `packages/core/` | `@uw/core` | `dates.ts`, the one `formatDate`/`parseDate` pair and the shared Zod ISO date schema (plan §0); `modules.ts`, the module registry (plan §14). `acl.ts` lands with the ACL work |
| `packages/db/` | `@uw/db` | `schema.ts`, the only schema, holding no table yet; `declarations.ts`, `declareTable`, which every table goes through to state its `classification` and `offline_eligibility` (plan §2.6); `client.ts`, the factory `uw-app` calls with the Hyperdrive connection string; `migrate.ts`, the direct-connection runner, not exported, used only by `pnpm db:migrate`; `migrations/`, generated SQL and hand-written SQL in one journal |
| `packages/contracts/` | `@uw/contracts` | Commands, events, outcomes and the verb registry as Zod. Depends on no other workspace package. Empty until #13 and #14 |
| `packages/harness/` | `@uw/harness` | The kernel: pure TypeScript over ports. Empty until the kernel is built; its tsconfig has no Workers types |
| `tools/lint/` | | The custom gates: `uw/no-ad-hoc-dates`, `uw/no-comments`, the vendor-SDK text gate, and the `lint:dates` grep |
| `tools/architecture/` | | Tests that prove each dependency rule refuses what it should |
| `tools/db/` | | The drift check: `drizzle-kit generate` against a copy of the committed migrations, run by `pnpm test`, which fails when `schema.ts` changed without a migration |

`infra/` (wrangler configs, Access policies, R2 lifecycle, Neon branches, the drift detector, plan §19) is reserved for #5.

These plan packages are deliberately not created in M0, and their names are reserved so nobody invents a different layout: `apps/uw-www/` (public site), `apps/uw-desktop/` (Tauri shell), `packages/editor/` (Tiptap and Yjs editor and sync client), `packages/charts/` (chart specs and renderers), `packages/docs/` (print styles, letterhead, PDF and DOCX rendering), `packages/compliance/` (obligations, reports, evidence queries). The harness packages in `docs/architecture.md` (`packages/ui/`, `sim/`) arrive with the requirements that build them.

## Scripts

Every script is a root script; a package adds only the `check` and `build` it needs. CI runs the same steps as `pnpm verify`, split into named jobs (see CI and deploys).

| Command | Runs |
|---|---|
| `pnpm check` | `tsc --noEmit` at the root and in every package. `packages/harness` has its own tsconfig with no Workers types, so a Workers global fails here |
| `pnpm lint` | ESLint flat config with zero warnings allowed: `@eslint/js`, `typescript-eslint`, `eslint-plugin-security`, the six fitness functions (function of 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters), the date rule, the no-comments rule, the vendor-SDK and `packages/harness` purity import rules |
| `pnpm lint:fix` | The same, with `--fix` |
| `pnpm lint:dates` | The CI grep for locale-dependent and ad-hoc date formatting outside `packages/core/dates.ts` |
| `pnpm lint:vendor` | The text gate: `@anthropic-ai/*`, `openai` and OpenRouter imports outside `apps/uw-app/engines/<engine>/` |
| `pnpm format` / `pnpm format:check` | Prettier, the only formatter, over code and config files |
| `pnpm knip` | Unused files, exports, dependencies and types |
| `pnpm architecture` | dependency-cruiser over `apps` and `packages`: the dependency DAG in `docs/architecture.md`, circular imports, vendor SDKs, the kernel's purity |
| `pnpm test` | Vitest: Worker code in `apps/*` runs under `@cloudflare/vitest-pool-workers`, everything else in plain Node. The real-Postgres tests in `packages/db` run when `TEST_DATABASE_URL` names a server where the role may create databases; each creates and drops its own database. Without it they are skipped (#79 sets it in CI on a Neon branch) |
| `pnpm build` | `build` in every package that has one. `apps/uw-app` bundles the Worker with a wrangler dry run into `apps/uw-app/dist` |
| `pnpm audit:prod` / `pnpm audit:all` | `pnpm audit` for production and for all dependencies; both fail on a high or critical advisory |
| `pnpm db:generate` | `drizzle-kit generate` over `packages/db/schema.ts`: writes the next SQL migration. `pnpm db:generate --custom --name <name>` adds an empty hand-written one to the same journal, applied in order with the generated ones |
| `pnpm db:migrate` | Applies every migration to the database in `DATABASE_URL`, over a direct connection. Re-running is a no-op |
| `pnpm verify` | check, lint, lint:dates, lint:vendor, format:check, knip, architecture, test, build, in that order. `walk`, `trace` and `sim` join the chain when PRD DX-4 and DX-5 are built |

## CI and deploys

GitHub Actions, in `.github/workflows/`. The repository is private on GitHub's Free plan, so there is no branch protection (#12): nothing on GitHub stops a merge with red checks. Two things stand in for it. Whoever merges confirms every check is green with `gh pr checks <number>` and never merges on red (`AGENTS.md` section 10). And the deploy is the hard gate: nothing reaches staging or production unless CI passed on that exact commit.

| Workflow | When | What |
|---|---|---|
| `CI` | every PR and every push to `main` | `security-audit` first, then `lint`, `typecheck`, `architecture`, `test` and `build` in parallel. A newer push to the same ref cancels the older run |
| `Build PR` | a PR is opened, pushed to or reopened | bundles the PR with no secrets and uploads the bundle |
| `Deploy PR` | `Build PR` succeeds | runs from `main`'s definition: checks the PR is still open at that head, deploys the bundle to `uw-app-pr-<number>` with `main`'s wrangler config and tooling, checks `/health`, and posts the URL on the PR |
| `Cleanup PR Worker` | a PR is closed or merged | runs from `main`'s definition (`pull_request_target`) and deletes `uw-app-pr-<number>`; shares a concurrency group with `Deploy PR`, so closing cancels an in-flight deploy |
| `Deploy Staging` | `CI` succeeds on a push to `main` | deploys that exact commit to `uw-app-staging` and checks its `/health`. A red `CI` deploys nothing, so staging stays on the last green commit |
| `Main Alarm` | `CI` finishes on a push to `main` | on red, opens (or comments on) one issue labelled `ci-red-main` naming the commit and the failing run; on the next green, closes it |
| `Deploy Production` | a `v*` tag, or manual dispatch from `main` | refuses unless the actor is listed in `.github/production-deployers` on `main` (the DRIs) and all six CI jobs succeeded on that commit, then deploys `uw-app` (unreachable until it gets a route) |

**Check-run names are a contract.** The six `CI` jobs are named `security-audit`, `lint`, `typecheck`, `architecture`, `test` and `build`. The harness ship rule (#20) and the production gate read them by name, and `tools/ci/ci-workflow.test.ts` fails if they drift from this list or if `CI` stops running a step of `pnpm verify`.

**Secrets.** `CLOUDFLARE_API_TOKEN` (Workers Scripts edit on the unfoldingWord account) and `CLOUDFLARE_ACCOUNT_ID`, as repository secrets. Never in a wrangler or workflow file. No workflow that runs PR code sees a secret; `tools/ci/ci-workflow.test.ts` enforces it. One hole remains and is recorded in `docs/exceptions.md`: on this plan any writer can push a workflow that reads a repository secret, and the token can deploy production.

## Contributing

Node 22 (`.nvmrc`) and the pnpm version in `packageManager`. `pnpm install` installs the Husky pre-commit hook, which runs lint-staged (ESLint with `--fix` and Prettier on staged files). The hook is the fast half; `pnpm verify` is the whole chain, and CI runs the same steps. Audits run in CI, not inside `pnpm verify`, because they need the network. Read `AGENTS.md` before your first edit.

## Status

Spec ratified and the PRD written. The scaffold is in place: the workspace layout, the date module and its gate, the module registry, the toolchain, the Worker shell and its wrangler config, the contract envelopes, the schema package, and CI with deploys. Nothing of the harness itself is built yet. [`docs/progress_tracker.md`](docs/progress_tracker.md) has the current state.

## Licence

To be confirmed by unfoldingWord.
