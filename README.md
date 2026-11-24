# unfoldingWord Platform

The organization's operating platform, built as modules on one database with one login. The first module is the **harness**: the Build, Measure, Learn loop as a mechanism. Work items move through the stages of a workflow, agents do the work as governed coworkers, and a person decides at every gate that has an effect on the world.

It runs on Cloudflare Workers, with PostgreSQL (Amazon Aurora) reached through Cloudflare Hyperdrive, and Cloudflare Access for sign-in.

## Start here

- [`AGENTS.md`](AGENTS.md): the rules for anyone, human or agent, changing this repository. Read it in full before your first edit.
- [`CONTEXT.md`](CONTEXT.md): the vocabulary. One word per concept, everywhere.
- [`docs/architecture.md`](docs/architecture.md): the shape. A pure kernel over ports, driven headlessly in a simulator, with events as the spine.
- [`docs/adr/`](docs/adr/): the decisions behind that shape.
- [`docs/PRD.md`](docs/PRD.md): every requirement with a stable ID, and the decision log.
- [`docs/guides/two-axes.md`](docs/guides/two-axes.md): for adopters, the two ways the platform organizes work (Johnny.Decimal areas and the Strategic Cascade) and how to declare the map between them.
- [`infra/README.md`](infra/README.md): how each environment is set up: Workers, Hyperdrive, Access, GitHub Apps, secrets and logs.
- [`prd/`](prd/): the platform corpus the harness sits under, including the ratified harness spec and its review.

The list of work is GitHub issues: one issue, one pull request. [`docs/progress_tracker.md`](docs/progress_tracker.md) is frozen history from before that.

## Layout

A pnpm workspace on Node 22, TypeScript strict throughout.

| Path | For |
|---|---|
| `apps/uw-platform/` | The Worker: server-rendered pages with small browser scripts ("islands"), the command API, the MCP endpoint agents use, the live-update hub, hosted agent runs, the queue consumer and the crons |
| `apps/uw-ingest/` | Public webhooks (GitHub): signature checks, then onto a queue. Nothing else |
| `packages/harness/` | The kernel: commands, reads and views as pure TypeScript over ports. It runs in plain Node and imports no Workers, database or vendor code |
| `packages/contracts/` | Commands, events, outcomes and the verb registry as Zod schemas, versioned, with fixtures |
| `packages/db/` | The schema, migrations, and the one store implementation of the kernel's ports |
| `packages/core/` | Shared basics: dates, access rules, logging, money, principals |
| `packages/ui/` | Design tokens, the stylesheet and the page components |
| `sim/` | The simulator: scenarios that drive the kernel end to end without a network |
| `tools/` | Lint rules, architecture checks, CI and infra tests, and the UI build scripts |
| `infra/` | Wrangler configs, Access policies, container and GitHub App setup |

## Scripts

Every script is a root script.

| Command | Runs |
|---|---|
| `pnpm check` | TypeScript at the root and in every package |
| `pnpm lint` | ESLint with zero warnings, including the size limits (50-line functions, complexity 10, 5 parameters), the no-comments and date rules, and the import rules that keep the kernel pure |
| `pnpm format` / `pnpm format:check` | Prettier, the only formatter |
| `pnpm knip` | Unused files, exports and dependencies |
| `pnpm architecture` | The dependency rules in `docs/architecture.md` |
| `pnpm test` | Vitest. Worker code runs in the Workers runtime, everything else in Node. Tests named `*.pg.test.ts` need `TEST_DATABASE_URL` set to a Postgres server where the role may create databases; without it they are skipped |
| `pnpm sim:all` / `pnpm walk:all` | Every simulator scenario, and every walk-through |
| `pnpm ui:css` / `pnpm ui:islands` | Rebuild the stylesheet and the browser scripts after changing them |
| `pnpm db:generate` / `pnpm db:migrate` | Write the next migration from the schema, or apply migrations to `DATABASE_URL` |
| `pnpm build` | Bundle the Workers |
| `pnpm verify` | The whole chain CI runs: check, lint, the date and vendor gates, format, knip, architecture, walks, tests, scenarios, build |

## Running the tests locally

1. Use Node 22 (`.nvmrc`) and the pnpm version in `packageManager`, then `pnpm install`. This also installs the pre-commit hook, which runs ESLint and Prettier on staged files.
2. For the database tests, run PostgreSQL 16 and set `TEST_DATABASE_URL`, for example `postgres://postgres@localhost:5432/postgres`. Each test creates and drops its own database.
3. Run `pnpm verify`, or a single file with `npx vitest run <path>`. Don't run two full test runs at once: each worker opens its own database.

## Branches, deploys and releases

- **`develop`** takes every change, one pull request per issue, squash-merged once CI is green and the change is reviewed.
- **Staging** deploys automatically after CI passes on a push to `develop`.
- **`main`** only takes releases: a "Release vX.Y.Z: develop → main" pull request, merged with a merge commit. The version lives on the release tag.
- **Production** deploys by dispatching `Deploy Production` on the `v*` tag. It refuses anything but a tag on `main`.
- Each pull request also gets its own preview Worker, removed when the pull request closes.

[`AGENTS.md`](AGENTS.md) section 7b has the full procedure, including who may merge and release.

| Workflow | When | What |
|---|---|---|
| `CI` | every pull request and push to `develop` or `main` | `security-audit`, `lint`, `typecheck`, `architecture`, the test shards and scenarios, `build`; `Release Source` on pull requests into `main` |
| `Build PR` / `Deploy PR` / `Cleanup PR Worker` | a pull request opens, updates or closes | build without secrets, deploy the preview Worker, delete it |
| `Deploy Staging` | `CI` succeeds on `develop` | deploy that exact commit to staging and check its health |
| `Main Alarm` | `CI` finishes on `develop` or `main` | open an issue when CI goes red, close it on the next green |
| `Deploy Production` | manual dispatch on a `v*` tag | deploy production |

## Status

Live in staging and production. The latest release is the newest `v*` tag; what's in progress is in the open issues.

## Licence

To be confirmed by unfoldingWord.
