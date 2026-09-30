# Neon, Hyperdrive and the Drizzle schema package (issue #7)

## Problem

Issue #7 asks for `packages/db` with `schema.ts`, a drizzle-kit config, migrations, a client factory, a Hyperdrive binding in the wrangler config, and a CI job that creates a Neon branch, applies every migration, runs the schema tests and drops the branch. Four of those pieces sit in shared roots that AGENTS.md rule 4 reserves for an approved proposal:

- `.github/workflows/`: the Neon-branch CI job and the staging and production migration jobs. Issue #68 owns the workflows, and none exist yet.
- `infra/`: the Hyperdrive binding in the staging and production wrangler configs. Issue #5 owns the wrangler configs and `infra/` does not exist yet.
- `packages/db/schema.ts`: the file the issue creates. It changes only in its own PR, and the issue lists no table (harness tables are #15, `role_grants` is #8, `pages` is #9, `people` is #6).
- The declaration mechanism and the client factory sit in `packages/db`, which is not a shared root, but they depend on the decisions below.

The issue also marks three decisions "decide in the PR". They need a human's eye because each is hard to reverse once tables exist.

## Change

Split the issue into two PRs so that no shared root is touched incidentally.

**PR A (`packages/db` only, after this proposal is approved).**
- `packages/db/declarations.ts`: `Classification = 'public' | 'internal' | 'restricted' | 'sensitive'`, `OfflineEligibility = 'sync' | 'cache_readonly' | 'never'`, and `declareTable(name, columns, { classification, offlineEligibility })`, a wrapper around `pgTable` that records the declaration in a registry the test walks. Omitting either value is a type error.
- `packages/db/schema.ts`: created with no tables, exporting the registry. The first table arrives in its own PR.
- `packages/db/client.ts`: a factory taking a connection string, used by `uw-app` with the Hyperdrive binding's `connectionString`, plus a direct-connection factory used only by the migration runner.
- `packages/db/drizzle.config.ts`, `packages/db/migrate.ts` (applies generated and hand-written `.sql` files in filename order, a second run being a no-op), a trivial hand-written `.sql` migration proving the ordering, and a drift check that fails when `schema.ts` differs from the generated migrations.
- Tests: the registry walk fails on a missing declaration, the closed sets are typed, migrations apply from empty and re-apply as a no-op against real Postgres, the hand-written file runs in order. New dependencies, each recorded with what it replaces: `drizzle-orm`, `drizzle-kit`, `postgres`.

**PR B (shared roots, after this proposal is approved and #5 and #68 have landed).**
- `.github/workflows/`: a job that creates a Neon branch named `pr-<number>` from the `main` branch, applies migrations, runs the schema tests and drops the branch in an `if: always()` step, plus a `pull_request: closed` job that drops it when the PR closes without merging. A migrate-staging job on push to `main` and a migrate-production job on a release tag.
- `infra/`: the Hyperdrive binding for staging and production. No secret goes in a wrangler or workflow file; Neon API keys and connection strings come from repository secrets.

**Decisions proposed for the three "decide in the PR" items.** Each is stated so a human can veto it:
1. Neon branches are named `pr-<number>`, forked from `main`, and dropped by the `if: always()` step and by the `pull_request: closed` job.
2. The driver is `postgres` (postgres.js) behind Hyperdrive, with `drizzle-orm/postgres-js`. Table declarations attach through the `declareTable` wrapper and registry above, not a lookup over exported tables.
3. On staging and production the migration runs before the Worker deploy, and migrations are written expand-then-contract so the previous Worker still runs against the new schema.

## Alternatives

- **One PR for the whole issue.** It touches four shared roots at once and waits on #5 and #68, which are not merged.
- **Skip the proposal and read the issue as approval.** That is the incidental shared-root change rule 4 exists to stop.
- **`node-postgres` (`pg`) as the driver.** It works on Workers with `nodejs_compat`, but postgres.js has a smaller footprint and is the driver Cloudflare's Hyperdrive documentation leads with. This is a judgement, not a measurement.
- **A lookup over exported tables instead of a wrapper.** It needs no wrapper, but a test can then only read declarations that are attached some other way, which is the comment-style declaration §2.6 rules out.

## Rules affected

- AGENTS.md rule 4: one sanctioned change each to `.github/workflows/`, `infra/` and `packages/db/schema.ts`, in the two PRs above. No other shared root is touched.
- AGENTS.md rule 3: `declareTable` records `owns` metadata later; this proposal adds no writer.
- No entry in `docs/exceptions.md` is needed if this is approved.
- Acceptance criteria on #7 that PR A cannot satisfy alone: the CI Neon branch, the staging and production migration jobs, and the Hyperdrive binding. They wait for PR B.
