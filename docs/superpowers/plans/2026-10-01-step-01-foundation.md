# Step 1, Finish the Foundation: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the platform foundation the kernel will stand on: real Postgres in CI, the go-live wiring (written, switched off), Access sign-in and a typed `Principal`, `role_grants` and `can()`, pages and page versions, the ingest Worker and its queue, one trace id with a structured logger and `/health`, and the verb registry under a contract lock.

**Architecture:** Everything durable is a table in `packages/db/schema.ts` with a migration and a real-Postgres test. Boundary shapes (principal, commands, pages, envelope, health, verbs) are Zod in `packages/contracts`, guarded by a contract lock that forces `CONTRACT_VERSION` to move with every closed set. `packages/core` holds the pure pieces later steps import: `Principal`, `can()`, the logger and the trace header. `apps/uw-app` and `apps/uw-ingest` are composition roots: Hono routes over small modules that each own their tables and export an `owns` constant. Anything that needs a Cloudflare, Neon or GitHub resource is declared in `infra/` or `.github/workflows/` and either skips cleanly or stays out of the deployed wrangler file until the resource exists.

**Tech Stack:** TypeScript 6 strict, Hono 4.13, Zod 4.6, Drizzle ORM 0.45 over `postgres` 3.4, drizzle-kit 0.31, Vitest 4 (Workers pool and a node project), jose 6.2 (JWT and JWKS), @octokit/webhooks-methods 6.0 (webhook HMAC), smol-toml 1.9 (reading wrangler files in tests), GitHub Actions, Neon GitHub actions (`neondatabase/create-branch-action@v6`, `neondatabase/delete-branch-action@v3`).

**Spec:** `docs/PRD.md` (approved). Design source: `prd/Harness v1 - Architecture.md` ("Who may act", "One verb registry") and `prd/An App For Everything - Platform Architecture Plan.md` (§0, §1, §2, §2.6, §4, §18, §19).

**Requirements covered:** FD-6, FD-12 (written, not switched on), FD-7, FD-8, FD-9, FD-10, FD-11, CT-2, CT-3.

**What this step hands to later steps (keep these names exactly):**

| Interface | Where | Consumed by |
|---|---|---|
| `Principal`, `Grant`, `principalSchema`, `grantSchema` | `packages/contracts/principal.ts`, re-exported with constructors from `packages/core/principal.ts` | every handler, queue message, MCP call (AB-2, AB-3, KN-13) |
| `can(actor, action, resource)`, `AclAction`, `AclResource` | `packages/core/acl.ts` | every route, verb and command (KN-5, KN-13, AB-3, WB-1) |
| `resolveGrants(db, personId)` | `apps/uw-app/acl/grant-store.ts` | the Grants port platform adapter (DX-1, KN-13) |
| `people`, `role_grants`, `grant_audit`, `pages`, `page_versions`, `webhook_deliveries`, `queue_watermarks` | `packages/db/schema.ts` | KN-1, AB-5, GH-2 |
| `createLogger`, `Logger`, `LogSink`, `TRACE_HEADER`, `traceIdSchema` | `packages/core/log.ts`, `packages/core/trace.ts` | every Worker, Workflow step and queue consumer (HE-1) |
| `ingestEnvelopeSchema`, `IngestEnvelope`, `ingestHandlers` | `packages/contracts/ingest.ts`, `apps/uw-app/queue/consumer.ts` | GH-2 (the read-model writer replaces the `github` handler) |
| `verbRegistry`, `verbManifest()`, `findVerb()`, `verbNames`, `FORBIDDEN_VERBS` | `packages/contracts/verbs.ts`, `packages/contracts/verb-names.ts` | AB-1, AB-3, AB-8, PE-1 |
| `pageTypeRegistry`, `pageTypeDefinition()` | `packages/contracts/page-types.ts` | AB-5, PE-1, KN-15 |
| `healthReportSchema`, indicator functions | `packages/contracts/health.ts`, `apps/uw-app/health/indicators.ts` | WB-10, `get_health` |

---

## Global Constraints

Every task obeys every line here. The controller passes this section to each implementer.

**Where and how**

- Work only in the worktree `/home/ianjl/projects/uw-platform-v1` on branch `build/v1`. Never commit to `main`, never force-push, never `--no-verify`.
- Read `AGENTS.md` sections 1, 4, 6 and 10 before the first edit. When this plan and `AGENTS.md` disagree, `AGENTS.md` wins; record the conflict in `docs/progress_tracker.md` and build the version that keeps the rule.
- Words come from `CONTEXT.md`. Use "principal", "grant", "person", "agent identity", "verb", "command", "trace id", "page type", "envelope", "indicator". Never "user", "permission", "tool" (as prose for a verb), "session".

**Code rules (all mechanically enforced by `pnpm verify`)**

- TypeScript `strict`, no `any`, no `@ts-ignore`, no `as unknown as`.
- No code comments of any kind: no line comments, block comments, JSDoc, directive comments or commented-out code. Meaning goes into names, types, tests and `docs/`. This includes SQL migration files you write by hand: no `--` comment lines except drizzle's `--> statement-breakpoint` separator.
- Files under 500 lines; functions under 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters.
- Dates: only `formatDate`/`parseDate` and `isoDateSchema` from `packages/core/dates.ts`. Instants are `Date` objects or ISO strings from `Date.prototype.toISOString()` used whole (never sliced). No `toLocale*`, no `Intl.DateTimeFormat`.
- Zod at every boundary: every request body, queue message and JSON column read is parsed with a schema from `packages/contracts`.
- Layering (dependency-cruiser and ESLint): `packages/contracts` imports only `zod`; `packages/core` imports `packages/contracts` and `zod`; `packages/db` imports `packages/contracts`, `packages/core`, `drizzle-orm`, `postgres`; `apps/*` are composition roots; `apps/uw-ingest` never imports `packages/harness`; no vendor SDK anywhere in this step.
- Discovery by registry, never by a switch on a name: webhook sources, page types, verbs and queue handlers are looked up in a registry object or `Map`. Use `Map` or `Object.hasOwn` for lookups so `security/detect-object-injection` stays quiet.
- Every table has exactly one writer module, which exports `export const owns = [...] as const` naming its tables. No other module writes them; others call the owner's exported functions.
- Prefer a maintained package over custom code (`AGENTS.md` §5). The packages this step adds are exactly: `jose@^6.2.12` (apps/uw-app), `@octokit/webhooks-methods@^6.0.0` (apps/uw-ingest), `smol-toml@^1.9.0` (root devDependency), plus workspace links (`@uw/contracts`, `@uw/db`) and `drizzle-orm@^0.45.3`, `hono@^4.13.11`, `wrangler@^4.144.0`, `@cloudflare/workers-types@^5.20260930.1` where a package newly needs them. Add nothing else without recording it in the tracker.

**Shared roots**

- These are shared roots: `packages/db/schema.ts` (and its migrations), `packages/contracts/`, `packages/harness/ports.ts`, `packages/core/acl.ts`, `infra/`, `.github/workflows/`, `AGENTS.md`, `CONTEXT.md`, `docs/adr/`. A change to one goes in its own commit with no feature code in it, and the commit message names the shared root and why it changed. A task that touches a shared root and feature code makes two or more commits.

**Contracts**

- Every exported Zod schema in `packages/contracts` is registered in `packages/contracts/registry.ts` under a kebab-case key and has `fixtures/<key>/valid/*.json` and `fixtures/<key>/invalid/*.json` (at least one each). The existing `contracts.test.ts` fails otherwise.
- From Task 2 on, any change to a closed set (any `z.enum` in the registry) appends an entry to `packages/contracts/contract-lock.json` and changes `CONTRACT_VERSION` in `packages/contracts/version.ts`, and every consumer's `package.json` `contractVersion` (`apps/uw-app`, `apps/uw-ingest`) moves to the same value. Removing or renaming a value is a major bump; only adding is a minor bump. The versions this plan uses: Task 2 locks `1.0.0`, Task 3 moves to `2.0.0`, Task 4 to `2.1.0`, Task 5 to `2.2.0`.

**Tests**

- Write the failing test first, run it, see it fail for the expected reason, then implement.
- The ESLint fitness functions apply to test files too: Vitest callbacks count toward `max-nested-callbacks` (3) and `max-lines-per-function` (50). Hoist assertion logic into top-level helper functions and split long `describe` blocks rather than nesting. Name each `describe` with the requirement ID it proves, for example `describe('FD-8 can()', ...)`.
- Real Postgres: tests that need a database use `TEST_DATABASE_URL`. Locally it is `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test` (a private local server, Postgres 16, already running). In CI it is the `postgres:16` service container on `postgres://postgres@127.0.0.1:5432/postgres`. Each test file creates its own throwaway database with `withMigratedDatabase` or `withEmptyDatabase` from `@uw/db/test-database`. Database tests are wrapped in `describe.skipIf(!testServer)(...)`; Task 1 adds the check that makes a skip in CI a failure.
- Database-backed tests under `apps/` are named `*.pg.test.ts`. They run in the Vitest `node` project; all other `apps/**/*.test.ts` run in the `workers` project. Do not put a `*.pg.test.ts` file under `packages/` (those already run in node).
- No test needs a live account or a secret (PRD DX-8). Access JWTs are signed by a key pair generated in the test; webhook signatures use the fixture secret `fixture-webhook-secret`; Cloudflare, Neon and GitHub are never called.
- Never add a binding, a job or a test that fails when a secret is absent.

**Verify and commit**

- At the end of every task run, from the worktree root: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify`. It must be green, and the database tests must have run, not skipped (check the Vitest summary for the `*.pg.test.ts` files and `packages/db` tests).
- After adding a dependency run `pnpm install` and commit `pnpm-lock.yaml` with the change that needed it.
- Commits are Conventional Commits. The body names the requirement IDs on its own line, for example `FD-7`. No `Co-Authored-By` line, no attribution footer of any kind. Hooks always run.

---

## Review Focus

Inputs the PRD implies but does not spell out, most likely to bite first. Each has its test in the owning task.

1. A GitHub delivery whose JSON is larger than the 128 KB Cloudflare Queues message limit: the envelope is sent with `payload: null` and `payloadTruncated: true`, and the delivery is accepted, never refused in a retry loop (Task 13).
2. The queue send fails after the delivery id was recorded: the record is released, so GitHub's redelivery is accepted rather than refused as a replay (Task 13).
3. Two org admins revoke each other's org-admin grant at the same moment: exactly one revoke is accepted and the other is refused `last_org_admin`, on two real connections (Task 11).
4. Email spelling at sign-in: `Ian.Lindsley@UnfoldingWord.org` maps to the same `people` row as the lowercase form, and lookalike domains (`x@evil-unfoldingword.org`, `x@unfoldingword.org.evil.com`) are provisioned `pending`, not active (Task 10).
5. A page update that sets `parentId` to the page itself or one of its descendants is refused `parent_cycle`, and a principal who may not read a page's area gets `page_not_found`, never a 403 that confirms the page exists (Task 12).

---

## File map

```
CONTEXT.md                                   Task 1 (words)
vitest.config.ts                             Task 1 (node project runs apps/**/*.pg.test.ts)
packages/db/test-database.ts, package.json   Task 1 (withMigratedDatabase, exports)
.github/workflows/ci.yml                     Task 1 (Postgres service), Task 16
tools/ci/test-database.test.ts               Task 1
packages/contracts/contract-lock.json        Task 2, 3, 4, 5
packages/contracts/contract-lock.test.ts     Task 2
packages/contracts/{outcomes,closed-sets,areas,principal,platform-commands,acl-commands,health}.ts   Task 3
packages/contracts/{pages,verb-names,verb-io,verbs}.ts, verbs.test.ts, verb-fixtures/   Task 4
packages/contracts/{page-types,ingest}.ts, page-types.test.ts   Task 5
packages/core/{principal,acl}.ts (+ tests)   Task 6
packages/core/{log,trace}.ts (+ tests)       Task 8
packages/db/{schema,checks}.ts, migrations/, foundation.test.ts   Task 7
apps/uw-app/{env,deps,database,observe,app}.ts(x)   Task 8
apps/uw-app/http/outcomes.ts                 Task 9
apps/uw-app/auth/{access,principal-middleware,dev-principal}.ts   Task 9, 10
apps/uw-app/testing/{access-keys,postgres}.ts   Task 9, 10
apps/uw-app/people/directory.ts              Task 10
apps/uw-app/acl/{grant-store,grant-commands,routes}.ts   Task 10, 11
apps/uw-app/pages/{validate,store,routes}.ts   Task 12
apps/uw-ingest/**                            Task 13
infra/uw-ingest/wrangler.toml                Task 13
apps/uw-app/queue/{consumer,watermarks}.ts, index.ts   Task 14
apps/uw-app/health/{indicators,routes}.tsx   Task 15
infra/logs/*.json, infra/*/wrangler.toml [observability]   Task 15
infra/access/uw-app.json                     Task 9
infra/*/wrangler.go-live.toml, .github/workflows/{neon-pr,cleanup-pr,deploy-staging,deploy-production}.yml, .github/scripts/secret-gate.sh   Task 13, 16
tools/infra/*.test.ts, tools/ci/*.test.ts    Task 9, 13, 15, 16
tools/architecture/owners.test.ts, packages/core/modules.ts   Task 17
docs/exceptions.md                           Task 9, 13
docs/progress_tracker.md, infra/README.md    Task 16, 17
```

---

### Task 1: Real Postgres for every database test, locally and in CI

**Proves:** FD-6.

**Files:**
- Modify: `CONTEXT.md` (own commit, shared root)
- Modify: `.github/workflows/ci.yml` (own commit, shared root)
- Modify: `vitest.config.ts`
- Modify: `packages/db/test-database.ts`, `packages/db/package.json`
- Modify: `apps/uw-app/tsconfig.json`, `apps/uw-app/package.json`, `apps/uw-ingest/tsconfig.json`, `apps/uw-ingest/package.json`
- Create: `apps/uw-app/tsconfig.node.json`, `apps/uw-ingest/tsconfig.node.json`
- Create: `tools/ci/test-database.test.ts`
- Modify: `package.json` (root devDependency `smol-toml@^1.9.0`; Task 9 onward reads TOML with it, and adding it here keeps the lockfile change in one place)

**Interfaces:**
- Produces: `withMigratedDatabase(server: string, work: (connectionString: string) => Promise<T>): Promise<T>`, `createMigratedDatabase(server: string): Promise<TestDatabase>` with `TestDatabase = { connectionString: string; drop(): Promise<void> }`, and the existing `testServer`, `withEmptyDatabase`, `query`, all exported from `@uw/db/test-database`. `migrationsFolder` and `applyMigrations` exported from `@uw/db/migrate`.
- Produces: the convention that `apps/**/*.pg.test.ts` runs in the Vitest `node` project and is type-checked by `apps/<app>/tsconfig.node.json`.

- [ ] **Step 1: Add the words (own commit, shared root `CONTEXT.md`)**

Append these entries to the matching sections of `CONTEXT.md`, in its existing format (`**Word**:`, a definition, `_Avoid_:`):

- Under "Who acts", after **Grant**: **Grant audit**: "One row of `grant_audit`: who granted or revoked which grant, when, the row before and after, and the trace id. Append-only." _Avoid_: access log, history.
- Under "How work runs", at the end: **Trace id**: "The UUID minted at the edge of each Worker for one request or delivery, carried in the `x-trace-id` header, on every log line, in every envelope and on the audit row it produces." _Avoid_: request id (that is a command's `requestId`), correlation id, span.
- **Envelope**: "The Zod-validated message `uw-ingest` puts on the queue for one verified webhook delivery: source, delivery id, event, trace id, the ingest principal and the payload." _Avoid_: event (that is a row of `harness_events`), message (the queue's word for the transport), job.
- **Page type**: "One entry of the page-type registry in `packages/contracts`: a frontmatter schema, a classification and an offline eligibility. Seven in v1: `skill`, `learning`, `persona`, `product`, `system_goal`, `product_strategy`, `data_sources`." _Avoid_: template (that is a stage graph), kind, category.
- Under "Reaching a person", at the end: **Indicator**: "One named line of `/health`: a status from `ok`, `amber`, `red`, `not_configured`, `not_wired` and a short detail. The overall status is the worst indicator." _Avoid_: metric, check (that is a CI job or a validator), alarm.
- Under "The repo and the build", at the end: **Go-live wiring**: "The CI jobs, bindings and declarations that need an account or a secret (PRD FD-12). Written during the build, they skip or stay out of the deployed wrangler file until the resource exists." _Avoid_: production setup, deployment config.

```bash
git add CONTEXT.md
git commit -m "docs(context): words for grant audit, trace id, envelope, page type, indicator and go-live wiring

Shared root CONTEXT.md: step 1 introduces these words; they come before the code that uses them.

FD-7 FD-8 FD-9 FD-10 FD-11 FD-12"
```

- [ ] **Step 2: Write the failing FD-6 test**

Create `tools/ci/test-database.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = { name?: string; run?: string; env?: Record<string, string> };
type Service = { image?: string; env?: Record<string, string>; ports?: string[]; options?: string };
type Job = { env?: Record<string, string>; services?: Record<string, Service>; steps?: Step[] };

const ci: { jobs: Record<string, Job> } = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const testJob = ci.jobs['test'] ?? {};
const serviceUrl = 'postgres://postgres@127.0.0.1:5432/postgres';

describe('FD-6 the CI test job runs on a real Postgres', () => {
  it('starts a postgres:16 service container that needs no password', () => {
    const postgres = testJob.services?.['postgres'];
    expect(postgres?.image).toBe('postgres:16');
    expect(postgres?.env?.['POSTGRES_HOST_AUTH_METHOD']).toBe('trust');
    expect(postgres?.ports).toEqual(['5432:5432']);
    expect(postgres?.options).toContain('--health-cmd pg_isready');
  });

  it('points TEST_DATABASE_URL at the service container', () => {
    expect(testJob.env?.['TEST_DATABASE_URL']).toBe(serviceUrl);
  });

  it('applies every migration from empty, re-applies them, then runs the tests', () => {
    const runs = (testJob.steps ?? []).map((step) => step.run ?? '');
    const migrate = runs.flatMap((run, index) => (run === 'pnpm db:migrate' ? [index] : []));
    const test = runs.indexOf('pnpm test');
    expect(migrate).toHaveLength(2);
    expect(test).toBeGreaterThan(Math.max(...migrate));
    const migrateEnv = (testJob.steps ?? []).filter((step) => step.run === 'pnpm db:migrate');
    expect(migrateEnv.every((step) => step.env?.['DATABASE_URL'] === serviceUrl)).toBe(true);
  });

  it('references no secret', () => {
    expect(JSON.stringify(testJob)).not.toMatch(/secrets/);
  });
});

describe.skipIf(process.env['CI'] !== 'true')('FD-6 database tests never skip in CI', () => {
  it('has TEST_DATABASE_URL set wherever CI runs the tests', () => {
    expect(process.env['TEST_DATABASE_URL']).toMatch(/^postgres:\/\//);
  });
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `pnpm exec vitest run --project node tools/ci/test-database.test.ts`
Expected: FAIL in "starts a postgres:16 service container" (no `services`) and the two after it.

- [ ] **Step 4: Change the CI test job (own commit, shared root `.github/workflows/`)**

Replace the `test` job in `.github/workflows/ci.yml` with exactly this (job id and `name` stay `test`, it is the check-run contract):

```yaml
  test:
    name: test
    needs: [security-audit]
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_HOST_AUTH_METHOD: trust
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      TEST_DATABASE_URL: postgres://postgres@127.0.0.1:5432/postgres
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - name: Apply every migration to an empty database
        run: pnpm db:migrate
        env:
          DATABASE_URL: postgres://postgres@127.0.0.1:5432/postgres
      - name: Re-apply every migration, which must be a no-op
        run: pnpm db:migrate
        env:
          DATABASE_URL: postgres://postgres@127.0.0.1:5432/postgres
      - run: pnpm test
```

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the test job on a Postgres service container

Shared root .github/workflows/: the test job starts postgres:16, applies every
migration from empty, re-applies them, and runs the tests with TEST_DATABASE_URL
pointing at the container. No secret, no account.

FD-6"
```

- [ ] **Step 5: Make app database tests runnable**

`packages/db/test-database.ts`: add, below `withEmptyDatabase`:

```ts
export type TestDatabase = { readonly connectionString: string; drop(): Promise<void> };

export async function createMigratedDatabase(server: string): Promise<TestDatabase> {
  const name = `uw_test_${randomBytes(6).toString('hex')}`;
  const target = new URL(server);
  target.pathname = `/${name}`;
  await withAdmin(server, (admin) => admin.unsafe(`CREATE DATABASE "${name}"`));
  await applyMigrations(target.toString());
  return {
    connectionString: target.toString(),
    drop: async () => {
      await withAdmin(server, (admin) => admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`));
    },
  };
}

export async function withMigratedDatabase<T>(
  server: string,
  work: (connectionString: string) => Promise<T>,
): Promise<T> {
  const database = await createMigratedDatabase(server);
  try {
    return await work(database.connectionString);
  } finally {
    await database.drop();
  }
}
```

with `import { applyMigrations } from './migrate.ts';` at the top. `createMigratedDatabase` is for test files that share one database across their tests (`beforeAll` creates, `afterAll` drops). In `packages/db/package.json` `exports` add `"./migrate": "./migrate.ts"` and `"./test-database": "./test-database.ts"`.

`vitest.config.ts`: in the `workers` project add `exclude: ['**/*.pg.test.ts', '**/node_modules/**']`; in the `node` project change `include` to `['packages/**/*.test.ts', 'tools/**/*.test.ts', 'sim/**/*.test.ts', 'apps/**/*.pg.test.ts']`.

For each of `apps/uw-app` and `apps/uw-ingest`:
- `tsconfig.json`: change `exclude` to `["node_modules", "**/*.pg.test.ts", "testing/postgres.ts"]`.
- Create `tsconfig.node.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"],
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  },
  "include": ["**/*.pg.test.ts", "testing/postgres.ts"],
  "exclude": ["node_modules"]
}
```

  (`apps/uw-ingest/tsconfig.node.json` omits the two `jsx` keys.)
- `package.json`: `"check": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json"`, and add `"@uw/db": "workspace:*"` to `dependencies` and `"@types/node": "^22.20.4"` to `devDependencies`.

`tsc -p tsconfig.node.json` with an include that matches no file errors with TS18003. Until Task 10 adds the first `*.pg.test.ts`, each app needs one: create `apps/uw-app/database.pg.test.ts` and `apps/uw-ingest/database.pg.test.ts` with this body (the uw-ingest copy names `uw-ingest` in the describe):

```ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createClient } from '@uw/db/client';
import { testServer, withMigratedDatabase } from '@uw/db/test-database';

describe.skipIf(!testServer)('FD-6 uw-app reaches the migrated test database', () => {
  it('runs a query against a database with every migration applied', () =>
    withMigratedDatabase(testServer ?? '', async (target) => {
      const db = createClient(target);
      try {
        const rows = await db.execute<{ answer: number }>(sql`SELECT 1 AS answer`);
        expect([...rows]).toEqual([{ answer: 1 }]);
      } finally {
        await db.$client.end();
      }
    }));
});
```

Add `"drizzle-orm": "^0.45.3"` to both apps' `dependencies`. Root `package.json`: add `"smol-toml": "^1.9.0"` to `devDependencies`. Run `pnpm install`.

- [ ] **Step 6: Run the tests and the chain**

Run: `pnpm exec vitest run --project node tools/ci/test-database.test.ts` → PASS.
Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm exec vitest run --project node apps` → both `database.pg.test.ts` files PASS (not skipped).
Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green. If knip reports `smol-toml` unused, add it to `ignoreDependencies` at the root workspace in `knip.json` for this task only and remove that entry in Task 9, when its first import lands.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts packages/db apps/uw-app apps/uw-ingest tools/ci/test-database.test.ts package.json pnpm-lock.yaml knip.json
git commit -m "test: run app database tests in node against real Postgres

apps/**/*.pg.test.ts run in the Vitest node project against TEST_DATABASE_URL,
type-checked by a node tsconfig per app; withMigratedDatabase gives each test
file a fresh migrated database; a test fails CI when TEST_DATABASE_URL is unset.

FD-6"
```

---

### Task 2: The contract lock

**Proves:** CT-3.

**Files:**
- Create: `packages/contracts/contract-lock.json` (shared root)
- Create: `packages/contracts/contract-lock.test.ts` (shared root)

**Interfaces:**
- Produces: `packages/contracts/contract-lock.json` with the shape `{ "versions": [ { "version": "1.0.0", "sets": { "<registry key>": ["value", ...] } } ] }`. Every later contract change appends one entry.

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/contract-lock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import lock from './contract-lock.json' with { type: 'json' };
import { schemaRegistry } from './registry.ts';
import { CONTRACT_VERSION } from './version.ts';

type Sets = Record<string, readonly string[]>;
type Entry = { version: string; sets: Sets };

const entries: readonly Entry[] = lock.versions;

function currentSets(): Sets {
  const enums = Object.entries(schemaRegistry).flatMap(([key, schema]) =>
    schema instanceof z.ZodEnum ? [[key, [...schema.options].map(String)] as const] : [],
  );
  return Object.fromEntries([...enums].sort(([a], [b]) => a.localeCompare(b)));
}

function parts(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return [major, minor, patch];
}

function isAfter(later: string, earlier: string): boolean {
  const [a, b] = [parts(later), parts(earlier)];
  return a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
}

function removed(before: Sets, after: Sets): string[] {
  return Object.entries(before).flatMap(([key, values]) => {
    const kept = after[key];
    if (!kept) return [`${key} (whole set)`];
    return values.filter((value) => !kept.includes(value)).map((value) => `${key}:${value}`);
  });
}

const pairs = entries.slice(1).map((entry, index) => [entries[index], entry] as [Entry, Entry]);

describe('CT-3 the contract lock', () => {
  it('ends at the live CONTRACT_VERSION', () => {
    expect(entries.at(-1)?.version).toBe(CONTRACT_VERSION);
  });

  it('records every closed set exactly as it is now', () => {
    expect(entries.at(-1)?.sets).toEqual(currentSets());
  });

  it('lists versions in strictly increasing order', () => {
    expect(pairs.filter(([earlier, later]) => !isAfter(later.version, earlier.version))).toEqual([]);
  });

  it('takes a major version whenever a value or a set is removed', () => {
    const breaking = pairs.filter(
      ([earlier, later]) =>
        removed(earlier.sets, later.sets).length > 0 &&
        parts(later.version)[0] === parts(earlier.version)[0],
    );
    expect(breaking.map(([, later]) => later.version)).toEqual([]);
  });
});
```

Create `packages/contracts/contract-lock.json` as `{ "versions": [] }`.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm exec vitest run --project node packages/contracts/contract-lock.test.ts`
Expected: FAIL, "ends at the live CONTRACT_VERSION" (undefined vs `1.0.0`).

- [ ] **Step 3: Write the 1.0.0 entry**

Generate the sets from the code rather than by hand, then paste the output as the single entry:

```bash
cd /home/ianjl/projects/uw-platform-v1/packages/contracts && node --input-type=module -e "
import { z } from 'zod';
import { schemaRegistry } from './registry.ts';
const sets = Object.fromEntries(Object.entries(schemaRegistry).filter(([, s]) => s instanceof z.ZodEnum).map(([k, s]) => [k, [...s.options]]).sort(([a], [b]) => a.localeCompare(b)));
console.log(JSON.stringify({ versions: [{ version: '1.0.0', sets }] }, null, 2));
" > contract-lock.json
```

Then run `pnpm exec prettier --write packages/contracts/contract-lock.json` from the root.

- [ ] **Step 4: Run it, and watch it go red once on purpose**

Run the test: PASS. Then add `'probe'` to the end of `connectorSchema` in `closed-sets.ts`, run the test again and confirm "records every closed set exactly as it is now" FAILS; revert the edit (`git checkout packages/contracts/closed-sets.ts`) and confirm PASS.

- [ ] **Step 5: Verify and commit (shared root `packages/contracts/`)**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add packages/contracts/contract-lock.json packages/contracts/contract-lock.test.ts
git commit -m "feat(contracts): lock the closed sets to CONTRACT_VERSION

Shared root packages/contracts/: contract-lock.json records every closed set per
version; a test fails when a set changes without a new entry at a new version, or
when a value is removed without a major bump.

CT-3"
```

---

### Task 3: Refusal reasons, the principal, grant commands and the health report as contracts

**Proves:** CT-3 (contract change moves the version), and the contract half of FD-7, FD-8, FD-11.

**Files (all shared root `packages/contracts/`, one commit):**
- Modify: `outcomes.ts`, `closed-sets.ts`, `registry.ts`, `index.ts`, `version.ts`, `contract-lock.json`, `contracts.test.ts`
- Create: `areas.ts`, `principal.ts`, `platform-commands.ts`, `acl-commands.ts`, `health.ts`
- Create fixtures (each listed path is one JSON file):
  - `fixtures/refusal/valid/not-permitted.json` `{"status":"error","reason":"not_permitted"}`; `fixtures/refusal/invalid/unknown-reason.json` `{"status":"error","reason":"nope"}`
  - `fixtures/capability-word/valid/first.json` `"none"`, `valid/last.json` `"review"`, `invalid/unknown.json` `"deploy"`
  - `fixtures/gate-decision/valid/first.json` `"approve"`, `valid/last.json` `"override"`, `invalid/unknown.json` `"merge"`
  - `fixtures/person-status/valid/first.json` `"active"`, `valid/last.json` `"pending"`, `invalid/unknown.json` `"suspended"`
  - `fixtures/jd-area/valid/software.json` `"80-89"`, `valid/first.json` `"00-09"`, `invalid/mismatched-decade.json` `"80-19"`, `invalid/single-digits.json` `"8-9"`, `invalid/jd-id.json` `"80.89"`
  - `fixtures/grant/valid/org-admin.json`, `valid/area-editor.json`, `invalid/org-with-area.json`, `invalid/area-without-area.json` (shapes below)
  - `fixtures/principal/valid/person.json`, `valid/ingest.json`, `invalid/person-with-agent-identity.json`, `invalid/no-grants.json`
  - `fixtures/grant-role-command/valid/area-editor.json`, `invalid/org-with-area.json`, `invalid/no-request-id.json`
  - `fixtures/revoke-role-command/valid/revoke.json`, `invalid/not-a-uuid.json`
  - `fixtures/platform-command-name/valid/first.json` `"grant_role"`, `valid/last.json` `"revoke_role"`, `invalid/unknown.json` `"approve"`
  - `fixtures/indicator-status/valid/first.json` `"ok"`, `valid/last.json` `"not_wired"`, `invalid/unknown.json` `"green"`
  - `fixtures/overall-status/valid/first.json` `"ok"`, `valid/last.json` `"red"`, `invalid/unknown.json` `"not_configured"`
  - `fixtures/health-indicator/valid/database.json` `{"name":"database","status":"not_configured","detail":"no Hyperdrive binding"}`, `invalid/bad-name.json` `{"name":"Database!","status":"ok","detail":""}`
  - `fixtures/health-report/valid/no-database.json`, `invalid/unknown-status.json`
  - Modify: `fixtures/error-reason/valid/first.json` → `"pr_not_open"`, `fixtures/error-reason/valid/last.json` → `"parent_cycle"`, `fixtures/outcome/valid/not-wired.json` and `fixtures/error-outcome/valid/not-wired.json` → `"reason": "not_wired"`
- Modify: `apps/uw-app/package.json`, `apps/uw-ingest/package.json` (`contractVersion` → `2.0.0`, in a second commit; see Step 5)

**Interfaces (produces, exact):**

`packages/contracts/outcomes.ts`, replace `errorReasonSchema` with this list in this order (PRD 8.5 ship-rule reasons in P11 order, then 8.5 "elsewhere", then `malformed_command`, then the step-1 reasons), and add `refusalSchema`:

```ts
export const errorReasonSchema = z.enum([
  'pr_not_open',
  'pr_is_draft',
  'head_mismatch',
  'checks_not_green',
  'no_reviewer_approval',
  'risk_tier_undeclared',
  'reviewer_count_below_tier',
  'reviewer_providers_not_distinct',
  'approver_lacks_domain_grant',
  'not_permitted',
  'not_wired',
  'wip_limit_reached',
  'lease_held',
  'lease_expired',
  'pickup_not_allowed',
  'validator_failed',
  'unknown_validator',
  'delegation_required',
  'gate_refused_to_agent',
  'reason_required',
  'spend_held',
  'hosted_builder_off',
  'engine_not_available',
  'diff_exceeds_review_budget',
  'unknown_verb',
  'forbidden_verb',
  'malformed_command',
  'unauthenticated',
  'access_not_configured',
  'database_not_configured',
  'internal_error',
  'pending_approval',
  'person_not_found',
  'grant_not_found',
  'grant_exists',
  'last_org_admin',
  'expiry_in_past',
  'unknown_page_type',
  'invalid_frontmatter',
  'page_not_found',
  'page_exists',
  'slug_taken',
  'stale_version',
  'parent_not_found',
  'parent_cycle',
]);

export const refusalSchema = z.object({
  status: z.literal('error'),
  reason: errorReasonSchema,
});

export type Refusal = z.infer<typeof refusalSchema>;
```

`command_not_wired` is gone (renamed `not_wired`, as PRD 8.5 names it): this is why the version is a major bump. `refusalSchema` is the body of a refusal that has no command, so no `requestId` (401, 403 and 404 on reads, 503).

`packages/contracts/closed-sets.ts`, append:

```ts
export const capabilityWordSchema = z.enum(['none', 'iterate', 'build', 'review']);
export const gateDecisionSchema = z.enum(['approve', 'reject', 'take_over', 'override']);
export const personStatusSchema = z.enum(['active', 'pending']);

export type CapabilityWord = z.infer<typeof capabilityWordSchema>;
export type GateDecision = z.infer<typeof gateDecisionSchema>;
export type PersonStatus = z.infer<typeof personStatusSchema>;
```

`packages/contracts/areas.ts`:

```ts
import { z } from 'zod';

export const jdAreaSchema = z
  .string()
  .regex(/^([0-9])0-\19$/, 'a JD area is NN-NN with one decade, for example 80-89');

export type JdArea = z.infer<typeof jdAreaSchema>;
```

`packages/contracts/principal.ts`:

```ts
import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { roleSchema } from './closed-sets.ts';
import { identitySchema } from './identity.ts';

const instant = z.iso.datetime();

export const grantSchema = z.discriminatedUnion('scopeKind', [
  z.object({
    grantId: z.uuid(),
    role: roleSchema,
    scopeKind: z.literal('org'),
    scopeArea: z.null(),
    expiresAt: instant.nullable(),
  }),
  z.object({
    grantId: z.uuid(),
    role: roleSchema,
    scopeKind: z.literal('jd_area'),
    scopeArea: jdAreaSchema,
    expiresAt: instant.nullable(),
  }),
]);

export const principalSchema = z
  .object({
    identity: identitySchema,
    kind: z.enum(['person', 'agent']),
    personId: z.uuid().nullable(),
    email: z.email().nullable(),
    grants: z.array(grantSchema),
    interactive: z.boolean(),
  })
  .refine(
    (principal) =>
      principal.kind === 'person'
        ? principal.identity === `human:${principal.personId ?? ''}` && principal.email !== null
        : principal.identity.startsWith('agent:'),
    'a person principal is human:<personId> with an email; an agent principal is agent:…',
  );

export type Grant = z.infer<typeof grantSchema>;
export type Principal = z.infer<typeof principalSchema>;
```

`packages/contracts/platform-commands.ts`:

```ts
import { z } from 'zod';

export const platformCommandNameSchema = z.enum(['grant_role', 'revoke_role']);

export type PlatformCommandName = z.infer<typeof platformCommandNameSchema>;
```

`packages/contracts/acl-commands.ts`:

```ts
import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { roleSchema, scopeSchema } from './closed-sets.ts';

export const grantRoleCommandSchema = z
  .object({
    command: z.literal('grant_role'),
    requestId: z.uuid(),
    personId: z.uuid(),
    role: roleSchema,
    scopeKind: scopeSchema,
    scopeArea: jdAreaSchema.nullable(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .refine(
    (command) => (command.scopeKind === 'org') === (command.scopeArea === null),
    'org scope names no area; jd_area scope names one',
  );

export const revokeRoleCommandSchema = z.object({
  command: z.literal('revoke_role'),
  requestId: z.uuid(),
  grantId: z.uuid(),
});

export type GrantRoleCommand = z.infer<typeof grantRoleCommandSchema>;
export type RevokeRoleCommand = z.infer<typeof revokeRoleCommandSchema>;
```

`packages/contracts/health.ts`:

```ts
import { z } from 'zod';

export const indicatorStatusSchema = z.enum(['ok', 'amber', 'red', 'not_configured', 'not_wired']);
export const overallStatusSchema = z.enum(['ok', 'amber', 'red']);

export const healthIndicatorSchema = z.object({
  name: z.string().regex(/^[a-z][a-z_]*$/),
  status: indicatorStatusSchema,
  detail: z.string().max(200),
});

export const healthReportSchema = z.object({
  status: overallStatusSchema,
  commit: z.string().min(1),
  indicators: z.array(healthIndicatorSchema),
});

export type IndicatorStatus = z.infer<typeof indicatorStatusSchema>;
export type OverallStatus = z.infer<typeof overallStatusSchema>;
export type HealthIndicator = z.infer<typeof healthIndicatorSchema>;
export type HealthReport = z.infer<typeof healthReportSchema>;
```

`registry.ts` adds, in this order after the existing entries: `refusal`, `capability-word`, `gate-decision`, `person-status`, `jd-area`, `grant`, `principal`, `platform-command-name`, `grant-role-command`, `revoke-role-command`, `indicator-status`, `overall-status`, `health-indicator`, `health-report`. `index.ts` adds `export * from` each new file. `version.ts`: `CONTRACT_VERSION = '2.0.0'`.

Fixture shapes (use these exact values):

```json
{ "grantId": "3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11", "role": "admin", "scopeKind": "org", "scopeArea": null, "expiresAt": null }
```
(`grant/valid/org-admin.json`; `area-editor.json` is `role: "editor", scopeKind: "jd_area", scopeArea: "80-89", expiresAt: "2026-12-31T00:00:00.000Z"`; `org-with-area.json` is the org admin with `"scopeArea": "80-89"`; `area-without-area.json` is the area editor with `"scopeArea": null`.)

```json
{
  "identity": "human:00000000-0000-4000-8000-000000000001",
  "kind": "person",
  "personId": "00000000-0000-4000-8000-000000000001",
  "email": "ian.lindsley@unfoldingword.org",
  "grants": [{ "grantId": "00000000-0000-4000-8000-000000000101", "role": "admin", "scopeKind": "org", "scopeArea": null, "expiresAt": null }],
  "interactive": true
}
```
(`principal/valid/person.json`; `ingest.json` is `{"identity":"agent:ingest","kind":"agent","personId":null,"email":null,"grants":[],"interactive":false}`; `person-with-agent-identity.json` is `person.json` with `"identity": "agent:ingest"`; `no-grants.json` is `person.json` without the `grants` key.)

`grant-role-command/valid/area-editor.json`: `{"command":"grant_role","requestId":"3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11","personId":"00000000-0000-4000-8000-000000000002","role":"editor","scopeKind":"jd_area","scopeArea":"80-89","expiresAt":null}`; `invalid/org-with-area.json` the same with `"scopeKind":"org"`; `invalid/no-request-id.json` without `requestId`. `revoke-role-command/valid/revoke.json`: `{"command":"revoke_role","requestId":"3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11","grantId":"00000000-0000-4000-8000-000000000101"}`; `invalid/not-a-uuid.json` with `"grantId":"g-1"`. `health-report/valid/no-database.json`: `{"status":"ok","commit":"unknown","indicators":[{"name":"commit","status":"ok","detail":"unknown"},{"name":"database","status":"not_configured","detail":"no Hyperdrive binding"}]}`; `invalid/unknown-status.json` the same with `"status":"green"`.

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/contracts.test.ts`: change the "carries a reason that says a command is not wired" test to use `'not_wired'`, and add:

```ts
describe('FD-7 FD-8 the principal and grants as contract data', () => {
  it('round-trips a person principal through JSON, as a queue message carries it', () => {
    const principal = principalSchema.parse(personFixture);
    expect(principalSchema.parse(JSON.parse(JSON.stringify(principal)))).toEqual(principal);
  });

  it('refuses a JD area whose two decades differ', () => {
    expect(jdAreaSchema.safeParse('80-89').success).toBe(true);
    expect(jdAreaSchema.safeParse('80-19').success).toBe(false);
  });

  it('carries the PRD section 8.5 reasons in order, ship rule first', () => {
    expect(errorReasonSchema.options.slice(0, 9)).toEqual([
      'pr_not_open', 'pr_is_draft', 'head_mismatch', 'checks_not_green', 'no_reviewer_approval',
      'risk_tier_undeclared', 'reviewer_count_below_tier', 'reviewer_providers_not_distinct',
      'approver_lacks_domain_grant',
    ]);
    expect(errorReasonSchema.options).not.toContain('command_not_wired');
  });
});
```

where `personFixture` is read with the existing `loadFixtures('principal', 'valid')` helper (first entry) and the imports come from `./principal.ts`, `./areas.ts`, `./outcomes.ts`. Extend the "holds the values the spec names" test with `capabilityWordSchema.options` `['none','iterate','build','review']` and `gateDecisionSchema.options` `['approve','reject','take_over','override']`.

- [ ] **Step 2: Run and see them fail**

Run: `pnpm exec vitest run --project node packages/contracts`
Expected: FAIL on missing modules and on the reason order.

- [ ] **Step 3: Implement the files and fixtures above, bump to 2.0.0, append the lock entry**

Append the `2.0.0` entry to `contract-lock.json` with the generator from Task 2 Step 3, changed to print only the new entry and pasted at the end of `versions` (do not rewrite the `1.0.0` entry).

- [ ] **Step 4: Run the contracts tests**

Run: `pnpm exec vitest run --project node packages/contracts` → PASS (golden fixtures, lock, conformance).

- [ ] **Step 5: Commit the contract, then the consumers**

```bash
git add packages/contracts
git commit -m "feat(contracts)!: refusal reasons, principal, grant commands and health report

Shared root packages/contracts/: errorReasonSchema follows PRD 8.5 and adds the
step-1 reasons; command_not_wired is renamed not_wired, so CONTRACT_VERSION is
2.0.0. Adds refusalSchema, capability word, gate decision, person status, JD area,
grant and principal schemas, grant and revoke commands, and the health report.

CT-3 FD-7 FD-8 FD-11"
```

Then set `"contractVersion": "2.0.0"` in `apps/uw-app/package.json` and `apps/uw-ingest/package.json`, run `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green, and commit:

```bash
git add apps/uw-app/package.json apps/uw-ingest/package.json
git commit -m "chore: pin uw-app and uw-ingest to contract 2.0.0

CT-3"
```

---

### Task 4: Pages as contract data, and the verb registry

**Proves:** CT-2, CT-3, and the contract half of FD-9.

**Files (shared root `packages/contracts/`, one commit; consumers in a second):**
- Create: `pages.ts`, `verb-names.ts`, `verb-io.ts`, `verbs.ts`, `verbs.test.ts`
- Create: `verb-fixtures/<verb>/<input|output>/<valid|invalid>/*.json`, at least one file in each of the 52 directories (13 verbs × input/output × valid/invalid)
- Modify: `platform-commands.ts` (add `create_page`, `update_page`), `registry.ts`, `index.ts`, `version.ts` (`2.1.0`), `contract-lock.json`, `fixtures/platform-command-name/valid/last.json` → `"update_page"`
- Create fixtures: `page-type` (first `"skill"`, last `"data_sources"`, invalid `"policy"`), `page-status` (first `"draft"`, last `"retired"`, invalid `"published"`), `slug` (valid `"harness-skill"`, invalid `"Harness Skill"`, invalid `"-leading"`), `frontmatter` (valid `{"confidence":"observed"}`, invalid `[]`), `page` (valid one full page, invalid version 0), `create-page-command` (valid, invalid missing `pageId`), `update-page-command` (valid, invalid `expectedVersion` 0), `verb-name` (first `"search_pages"`, last `"get_health"`, invalid `"approve"`), `forbidden-verb` (first `"approve"`, last `"advance"`, invalid `"merge_pr"`), `verb-group` (first `"pages_and_context"`, last `"harness"`, invalid `"admin"`), `verb-grant` (valid `{"scope":"resource_area","role":"editor"}`, valid `{"scope":"fixed_area","role":"editor","area":"40-49"}`, invalid `{"scope":"fixed_area","role":"editor"}`)
- Modify: `apps/uw-app/package.json`, `apps/uw-ingest/package.json` (`contractVersion` → `2.1.0`)

**Interfaces (produces, exact):**

`packages/contracts/pages.ts`:

```ts
import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';

export const pageTypes = [
  'skill',
  'learning',
  'persona',
  'product',
  'system_goal',
  'product_strategy',
  'data_sources',
] as const;

export const pageTypeSchema = z.enum(pageTypes);
export const pageStatusSchema = z.enum(['draft', 'suggested', 'active', 'retired']);
export const slugSchema = z
  .string()
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'a slug is lowercase kebab-case');
export const frontmatterSchema = z.record(z.string(), z.json());

const title = z
  .string()
  .max(200)
  .refine((value) => value.trim().length > 0, 'a title is not blank');
const bodyMd = z.string().max(1_000_000);

export const pageSchema = z.object({
  id: z.uuid(),
  type: pageTypeSchema,
  jdArea: jdAreaSchema,
  slug: slugSchema,
  title,
  parentId: z.uuid().nullable(),
  frontmatter: frontmatterSchema,
  bodyMd,
  version: z.number().int().min(1),
  status: pageStatusSchema,
});

const editable = {
  slug: slugSchema,
  title,
  parentId: z.uuid().nullable(),
  frontmatter: frontmatterSchema,
  bodyMd,
  status: pageStatusSchema,
};

export const createPageCommandSchema = z.object({
  command: z.literal('create_page'),
  requestId: z.uuid(),
  pageId: z.uuid(),
  type: z.string().min(1).max(64),
  jdArea: jdAreaSchema,
  ...editable,
});

export const updatePageCommandSchema = z.object({
  command: z.literal('update_page'),
  requestId: z.uuid(),
  pageId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  ...editable,
});

export type PageType = z.infer<typeof pageTypeSchema>;
export type PageStatus = z.infer<typeof pageStatusSchema>;
export type Page = z.infer<typeof pageSchema>;
export type CreatePageCommand = z.infer<typeof createPageCommandSchema>;
export type UpdatePageCommand = z.infer<typeof updatePageCommandSchema>;
```

`type` on create is any short string on purpose: an unknown type is refused by the handler as `unknown_page_type`, not as `malformed_command`. `type` and `jdArea` are not on update: in v1 a page keeps its type and its area.

`packages/contracts/verb-names.ts`:

```ts
import { z } from 'zod';

export const verbNames = [
  'search_pages',
  'read_page',
  'write_page',
  'resolve_context',
  'query_entities',
  'create_task',
  'list_gifts',
  'create_draft_journal_entry',
  'poll_queue',
  'claim_item',
  'submit_to_gate',
  'record_run_step',
  'get_health',
] as const;

export const FORBIDDEN_VERBS = ['approve', 'merge', 'deploy', 'publish', 'advance'] as const;

export const verbNameSchema = z.enum(verbNames);
export const forbiddenVerbSchema = z.enum(FORBIDDEN_VERBS);

export type VerbName = z.infer<typeof verbNameSchema>;
export type ForbiddenVerb = z.infer<typeof forbiddenVerbSchema>;
```

`packages/contracts/verb-io.ts`:

```ts
import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { costBasisSchema, evidenceLabelSchema } from './closed-sets.ts';
import { healthReportSchema } from './health.ts';
import { frontmatterSchema, pageSchema, pageStatusSchema, pageTypeSchema, slugSchema } from './pages.ts';
import type { VerbName } from './verb-names.ts';

const json = z.record(z.string(), z.json());
const limit = z.number().int().min(1).max(50);
const pageSummary = pageSchema.pick({
  id: true,
  type: true,
  jdArea: true,
  slug: true,
  title: true,
  status: true,
});
const lease = z.object({
  leaseExpiresAt: z.iso.datetime().nullable(),
  leaseWarning: z.boolean(),
});

export const verbIo = {
  search_pages: {
    input: z.object({ query: z.string().min(1).max(200), type: pageTypeSchema.nullable(), limit }),
    output: z.object({ pages: z.array(pageSummary) }),
  },
  read_page: {
    input: z.object({ pageId: z.uuid() }),
    output: z.object({ page: pageSchema }),
  },
  write_page: {
    input: z.object({
      pageId: z.uuid(),
      type: pageTypeSchema,
      jdArea: jdAreaSchema,
      slug: slugSchema,
      title: z.string().min(1).max(200),
      parentId: z.uuid().nullable(),
      frontmatter: frontmatterSchema,
      bodyMd: z.string().max(1_000_000),
      expectedVersion: z.number().int().min(1).nullable(),
    }),
    output: z.object({ pageId: z.uuid(), version: z.number().int().min(1), status: pageStatusSchema }),
  },
  resolve_context: {
    input: z.object({ itemId: z.uuid() }),
    output: z.object({
      instructions: pageSummary.nullable(),
      package: z.array(pageSummary),
      learnings: z.array(
        z.object({ page: pageSummary, confidence: evidenceLabelSchema, asOf: z.iso.date() }),
      ),
    }),
  },
  query_entities: {
    input: z.object({ query: z.string().regex(/^[a-z][a-z_]*$/), params: json }),
    output: z.object({ rows: z.array(json) }),
  },
  create_task: {
    input: z.object({
      title: z.string().min(1).max(200),
      pageId: z.uuid().nullable(),
      due: z.iso.date().nullable(),
    }),
    output: z.object({ taskId: z.uuid(), status: z.literal('suggested') }),
  },
  list_gifts: {
    input: z.object({ since: z.iso.date() }),
    output: z.object({ gifts: z.array(json) }),
  },
  create_draft_journal_entry: {
    input: z.object({
      memo: z.string().min(1).max(500),
      lines: z
        .array(
          z.object({
            account: z.string().min(1).max(64),
            amountMinor: z.number().int(),
            currency: z.string().regex(/^[A-Z]{3}$/),
          }),
        )
        .min(2),
    }),
    output: z.object({ entryId: z.uuid() }),
  },
  poll_queue: {
    input: z.object({ harnessId: z.uuid().nullable(), limit }),
    output: z.object({
      items: z.array(
        z.object({
          itemId: z.uuid(),
          harnessId: z.uuid(),
          stage: z.string().min(1),
          title: z.string().min(1),
          priority: z.number().int(),
        }),
      ),
    }),
  },
  claim_item: {
    input: z.object({ itemId: z.uuid(), delegationId: z.uuid().nullable() }),
    output: lease.extend({ itemId: z.uuid() }),
  },
  submit_to_gate: {
    input: z.object({ itemId: z.uuid(), evidence: json }),
    output: z.object({
      itemId: z.uuid(),
      result: z.enum(['advanced', 'parked', 'checks_failed']),
      failures: z.array(z.string()),
    }),
  },
  record_run_step: {
    input: z.object({
      itemId: z.uuid(),
      runId: z.uuid(),
      step: z.enum(['read', 'scout', 'work', 'submit']),
      tokensIn: z.number().int().min(0),
      tokensOut: z.number().int().min(0),
      costBasis: costBasisSchema,
    }),
    output: lease,
  },
  get_health: {
    input: z.object({ harnessId: z.uuid() }),
    output: healthReportSchema,
  },
} as const satisfies Record<VerbName, { input: z.ZodType; output: z.ZodType }>;
```

`packages/contracts/verbs.ts`:

```ts
import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { roleSchema, type Role } from './closed-sets.ts';
import { verbIo } from './verb-io.ts';
import type { VerbName } from './verb-names.ts';

export const verbGroupSchema = z.enum(['pages_and_context', 'records', 'role_gated', 'harness']);

export const verbGrantSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('resource_area'), role: roleSchema }),
  z.object({ scope: z.literal('fixed_area'), role: roleSchema, area: jdAreaSchema }),
]);

export type VerbGroup = z.infer<typeof verbGroupSchema>;
export type VerbGrant = z.infer<typeof verbGrantSchema>;

export type VerbDefinition = {
  readonly name: VerbName;
  readonly group: VerbGroup;
  readonly grant: VerbGrant | null;
  readonly servedInV1: boolean;
  readonly input: z.ZodType;
  readonly output: z.ZodType;
};

export type VerbManifestEntry = {
  readonly name: VerbName;
  readonly group: VerbGroup;
  readonly grant: VerbGrant | null;
  readonly servedInV1: boolean;
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown>;
};

const onResource = (role: Role): VerbGrant => ({ scope: 'resource_area', role });
const inArea = (role: Role, area: string): VerbGrant => ({ scope: 'fixed_area', role, area });

function verb(name: VerbName, group: VerbGroup, grant: VerbGrant | null, servedInV1 = true): VerbDefinition {
  return { name, group, grant, servedInV1, ...verbIo[name] };
}

export const verbRegistry: readonly VerbDefinition[] = [
  verb('search_pages', 'pages_and_context', null),
  verb('read_page', 'pages_and_context', onResource('viewer')),
  verb('write_page', 'pages_and_context', onResource('editor')),
  verb('resolve_context', 'pages_and_context', onResource('viewer')),
  verb('query_entities', 'records', null),
  verb('create_task', 'records', onResource('editor')),
  verb('list_gifts', 'role_gated', inArea('editor', '40-49'), false),
  verb('create_draft_journal_entry', 'role_gated', inArea('editor', '20-29'), false),
  verb('poll_queue', 'harness', null),
  verb('claim_item', 'harness', onResource('editor')),
  verb('submit_to_gate', 'harness', onResource('editor')),
  verb('record_run_step', 'harness', onResource('editor')),
  verb('get_health', 'harness', onResource('viewer')),
];

const byName = new Map<string, VerbDefinition>(verbRegistry.map((entry) => [entry.name, entry]));

export function findVerb(name: string): VerbDefinition | undefined {
  return byName.get(name);
}

export function verbManifest(): VerbManifestEntry[] {
  return verbRegistry.map(({ input, output, ...entry }) => ({
    ...entry,
    input: z.toJSONSchema(input),
    output: z.toJSONSchema(output),
  }));
}
```

`grant: null` means the verb's results are filtered row by row through `can()` (search, query, poll) rather than gated on one resource. Registry keys added: `page-type`, `page-status`, `slug`, `frontmatter`, `page`, `create-page-command`, `update-page-command`, `verb-name`, `forbidden-verb`, `verb-group`, `verb-grant`. `platformCommandNameSchema` becomes `z.enum(['grant_role', 'revoke_role', 'create_page', 'update_page'])`.

- [ ] **Step 1: Write the failing CT-2 test**

Create `packages/contracts/verbs.test.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verbIo } from './verb-io.ts';
import { FORBIDDEN_VERBS, verbNames } from './verb-names.ts';
import { findVerb, verbManifest, verbRegistry } from './verbs.ts';

const fixtureRoot = join(import.meta.dirname, 'verb-fixtures');
const sides = ['input', 'output'] as const;
const kinds = ['valid', 'invalid'] as const;

function fixtures(verb: string, side: string, kind: string): unknown[] {
  const dir = join(fixtureRoot, verb, side, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')));
}

describe('CT-2 the verb registry', () => {
  it('registers exactly the thirteen verbs of PRD section 8.2', () => {
    expect(verbRegistry.map((entry) => entry.name)).toEqual([
      'search_pages', 'read_page', 'write_page', 'resolve_context',
      'query_entities', 'create_task',
      'list_gifts', 'create_draft_journal_entry',
      'poll_queue', 'claim_item', 'submit_to_gate', 'record_run_step', 'get_health',
    ]);
    expect(verbRegistry.map((entry) => entry.name)).toEqual([...verbNames]);
  });

  it('exports the forbidden verbs and registers none of them', () => {
    expect([...FORBIDDEN_VERBS]).toEqual(['approve', 'merge', 'deploy', 'publish', 'advance']);
    expect(FORBIDDEN_VERBS.filter((name) => findVerb(name) !== undefined)).toEqual([]);
  });

  it('does not register resolve_policies under that name', () => {
    expect(findVerb('resolve_policies')).toBeUndefined();
  });

  it('serves every verb in v1 except the two role-gated ones', () => {
    const unserved = verbRegistry.filter((entry) => !entry.servedInV1).map((entry) => entry.name);
    expect(unserved).toEqual(['list_gifts', 'create_draft_journal_entry']);
  });

  it('groups the verbs as PRD section 8.2 does', () => {
    const groups = Object.fromEntries(verbRegistry.map((entry) => [entry.name, entry.group]));
    expect(groups['resolve_context']).toBe('pages_and_context');
    expect(groups['create_task']).toBe('records');
    expect(groups['list_gifts']).toBe('role_gated');
    expect(groups['get_health']).toBe('harness');
  });

  it('is plain JSON-serialisable contract data', () => {
    const manifest = verbManifest();
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
    expect(manifest).toHaveLength(13);
  });

  describe.each(verbNames)('%s', (name) => {
    it.each(sides)('has valid and invalid %s fixtures that the schema judges correctly', (side) => {
      const schema = verbIo[name][side];
      const [valid, invalid] = kinds.map((kind) => fixtures(name, side, kind));
      expect(valid?.length).toBeGreaterThan(0);
      expect(invalid?.length).toBeGreaterThan(0);
      expect((valid ?? []).every((value) => schema.safeParse(value).success)).toBe(true);
      expect((invalid ?? []).some((value) => schema.safeParse(value).success)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm exec vitest run --project node packages/contracts/verbs.test.ts` → FAIL, missing modules.

- [ ] **Step 3: Implement**

If the nested `describe.each` / `it.each` / `.every` callbacks in `verbs.test.ts` exceed `max-nested-callbacks`, hoist the per-side check into a top-level `function judge(name: VerbName, side: 'input' | 'output'): void` and call it from the `it.each` body. Write the five files above, the registry and index entries, the fixtures (the simplest valid object per schema; each invalid fixture breaks exactly one rule, for example a non-UUID id, a negative token count, an unknown `step`, a missing required key), bump `CONTRACT_VERSION` to `2.1.0`, append the `2.1.0` lock entry with the Task 2 generator.

- [ ] **Step 4: Run the contracts tests** → PASS.

- [ ] **Step 5: Commit the contract, then the consumers**

```bash
git add packages/contracts
git commit -m "feat(contracts): page shapes and the verb registry

Shared root packages/contracts/: the thirteen verbs of PRD 8.2 as plain contract
data with input and output schemas and a JSON manifest; FORBIDDEN_VERBS exported
and never registered; resolve_policies absent. Page, page status, slug and the
create and update page commands. CONTRACT_VERSION 2.1.0.

CT-2 CT-3 FD-9"
```

Then `contractVersion` → `2.1.0` in both apps, `pnpm verify` green with `TEST_DATABASE_URL` set, and `git commit -m "chore: pin uw-app and uw-ingest to contract 2.1.0" -m "CT-3"`.

---

### Task 5: The page-type registry and the ingest envelope

**Proves:** FD-9 (page-type registry), FD-10 (envelope schema), CT-3.

**Files (shared root `packages/contracts/`):**
- Create: `page-types.ts`, `page-types.test.ts`, `ingest.ts`
- Modify: `registry.ts`, `index.ts`, `version.ts` (`2.2.0`), `contract-lock.json`
- Create fixtures: `skill-frontmatter`, `learning-frontmatter`, `persona-frontmatter`, `product-frontmatter`, `system-goal-frontmatter`, `product-strategy-frontmatter`, `data-sources-frontmatter` (one valid and one invalid each, from the schemas below); `ingest-source` (valid `"github"`, invalid `"stripe"`); `ingest-refusal` (first `"unknown_source"`, last `"enqueue_failed"`, invalid `"nope"`); `ingest-envelope` (valid with payload, valid truncated with `payload: null` and `payloadTruncated: true`, invalid with `envelopeVersion: 2`); `ingest-response` (valid accepted `{"status":"accepted"}`, valid refused `{"status":"error","reason":"bad_signature"}`, invalid `{"status":"error","reason":"not_permitted"}`)
- Modify: both apps' `contractVersion` → `2.2.0` (second commit)

**Interfaces (produces, exact):**

`packages/contracts/page-types.ts`:

```ts
import { z } from 'zod';
import {
  capabilityWordSchema,
  engineSchema,
  evidenceLabelSchema,
  runShapeSchema,
  type Classification,
  type OfflineEligibility,
} from './closed-sets.ts';
import type { PageType } from './pages.ts';
import { verbNameSchema } from './verb-names.ts';

const text = z.string().min(1).max(2000);
const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const humanIdentity = z.string().regex(/^human:[A-Za-z0-9][A-Za-z0-9_-]*$/);
const distinct = <T>(values: readonly T[]) => new Set(values).size === values.length;

export const skillFrontmatterSchema = z.strictObject({
  name: z.string().max(64).regex(kebab),
  description: z.string().min(1).max(1024),
});

export const learningFrontmatterSchema = z.strictObject({
  confidence: evidenceLabelSchema,
  as_of: z.iso.date(),
  supersedes: z.array(z.uuid()),
  review_by: z.iso.date().nullable(),
});

export const personaFrontmatterSchema = z.strictObject({
  identity: z.string().regex(/^agent:[a-z][a-z0-9-]*$/),
  owner: humanIdentity,
  harness: z.uuid(),
  toolset: z.array(verbNameSchema).refine(distinct, 'a toolset names each verb once'),
  run_shape: runShapeSchema,
  engine: engineSchema,
  model: z.string().min(1).max(200),
  budget: z.strictObject({
    monthly_minor: z.number().int().min(0),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  capability: capabilityWordSchema,
  requires_tools: z.array(z.string().regex(/^[a-z][a-z_]*$/)).refine(distinct),
});

export const productFrontmatterSchema = z.strictObject({ owner: humanIdentity, summary: text });

export const systemGoalFrontmatterSchema = z.strictObject({
  statement: text,
  measure: text,
  horizon: z.iso.date(),
});

export const productStrategyFrontmatterSchema = z.strictObject({ niche: text, hypothesis: text });

export const dataSourcesFrontmatterSchema = z.strictObject({
  sources: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(200),
        kind: z.enum(['web_analytics', 'mailing_list', 'manual']),
        url: z.url().nullable(),
      }),
    )
    .min(1),
});

export type PageTypeDefinition = {
  readonly frontmatter: z.ZodType;
  readonly classification: Classification;
  readonly offlineEligibility: OfflineEligibility;
};

const internalSync = { classification: 'internal', offlineEligibility: 'sync' } as const;

export const pageTypeRegistry = {
  skill: { frontmatter: skillFrontmatterSchema, ...internalSync },
  learning: { frontmatter: learningFrontmatterSchema, ...internalSync },
  persona: { frontmatter: personaFrontmatterSchema, ...internalSync },
  product: { frontmatter: productFrontmatterSchema, ...internalSync },
  system_goal: { frontmatter: systemGoalFrontmatterSchema, ...internalSync },
  product_strategy: { frontmatter: productStrategyFrontmatterSchema, ...internalSync },
  data_sources: { frontmatter: dataSourcesFrontmatterSchema, ...internalSync },
} as const satisfies Record<PageType, PageTypeDefinition>;

const byType = new Map<string, PageTypeDefinition>(Object.entries(pageTypeRegistry));

export function pageTypeDefinition(type: string): PageTypeDefinition | undefined {
  return byType.get(type);
}
```

`requires_tools` takes any verb-shaped name, not only registered ones, so a persona can name a verb that does not exist yet (AB-8 needs that). `toolset` takes only registered verbs (PE-1). The Product Package pages (`system_goal`, `product_strategy`, `data_sources`) point at their product through `parentId`, not a frontmatter field.

`packages/contracts/ingest.ts`:

```ts
import { z } from 'zod';
import { principalSchema } from './principal.ts';

export const INGEST_PAYLOAD_LIMIT_BYTES = 120_000;

export const ingestSourceSchema = z.enum(['github']);

export const ingestRefusalSchema = z.enum([
  'unknown_source',
  'source_not_configured',
  'unsigned',
  'bad_signature',
  'malformed_delivery',
  'malformed_payload',
  'replayed',
  'replay_store_not_configured',
  'queue_not_configured',
  'enqueue_failed',
]);

export const ingestEnvelopeSchema = z.object({
  envelopeVersion: z.literal(1),
  traceId: z.uuid(),
  source: ingestSourceSchema,
  deliveryId: z.string().min(1).max(200),
  event: z.string().min(1).max(100),
  receivedAt: z.iso.datetime(),
  principal: principalSchema,
  payload: z.json().nullable(),
  payloadTruncated: z.boolean(),
});

export const ingestResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('accepted') }),
  z.object({ status: z.literal('error'), reason: ingestRefusalSchema }),
]);

export type IngestSource = z.infer<typeof ingestSourceSchema>;
export type IngestRefusal = z.infer<typeof ingestRefusalSchema>;
export type IngestEnvelope = z.infer<typeof ingestEnvelopeSchema>;
export type IngestResponse = z.infer<typeof ingestResponseSchema>;
```

Registry keys: `skill-frontmatter`, `learning-frontmatter`, `persona-frontmatter`, `product-frontmatter`, `system-goal-frontmatter`, `product-strategy-frontmatter`, `data-sources-frontmatter`, `ingest-source`, `ingest-refusal`, `ingest-envelope`, `ingest-response`. `INGEST_PAYLOAD_LIMIT_BYTES` is not a schema and is not registered.

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/page-types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classificationSchema, offlineEligibilitySchema } from './closed-sets.ts';
import { pageTypeDefinition, pageTypeRegistry, personaFrontmatterSchema } from './page-types.ts';
import { pageTypes } from './pages.ts';

const persona = {
  identity: 'agent:builder',
  owner: 'human:00000000-0000-4000-8000-000000000001',
  harness: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
  toolset: ['read_page', 'claim_item'],
  run_shape: 'workflow-run',
  engine: 'openrouter-messages',
  model: 'glm-5.3-flash',
  budget: { monthly_minor: 5000, currency: 'USD' },
  capability: 'build',
  requires_tools: ['read_page', 'open_pull_request'],
};

describe('FD-9 the page-type registry', () => {
  it('registers exactly the seven v1 page types', () => {
    expect(Object.keys(pageTypeRegistry)).toEqual([...pageTypes]);
  });

  it.each(pageTypes)('gives %s a frontmatter schema, a classification and an offline eligibility', (type) => {
    const definition = pageTypeDefinition(type);
    expect(definition?.frontmatter).toBeDefined();
    expect(classificationSchema.safeParse(definition?.classification).success).toBe(true);
    expect(offlineEligibilitySchema.safeParse(definition?.offlineEligibility).success).toBe(true);
  });

  it('knows no type outside the registry', () => {
    expect(pageTypeDefinition('policy')).toBeUndefined();
    expect(pageTypeDefinition('constructor')).toBeUndefined();
  });

  it('refuses a persona toolset verb outside the registry, and an engine outside the six', () => {
    expect(personaFrontmatterSchema.safeParse(persona).success).toBe(true);
    expect(personaFrontmatterSchema.safeParse({ ...persona, toolset: ['approve'] }).success).toBe(false);
    expect(personaFrontmatterSchema.safeParse({ ...persona, engine: 'gpt-5' }).success).toBe(false);
  });

  it('lets requires_tools name a verb that does not exist yet', () => {
    expect(persona.requires_tools).toContain('open_pull_request');
    expect(personaFrontmatterSchema.safeParse(persona).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run and see it fail** → FAIL, missing module.

- [ ] **Step 3: Implement** the two files, registry, index, fixtures, `2.2.0` and its lock entry.

- [ ] **Step 4: Run** `pnpm exec vitest run --project node packages/contracts` → PASS.

- [ ] **Step 5: Commit the contract, then the consumers**

```bash
git add packages/contracts
git commit -m "feat(contracts): page-type registry and the ingest envelope

Shared root packages/contracts/: seven page types each with a frontmatter schema,
classification and offline eligibility; the envelope uw-ingest puts on the queue,
its sources and refusal reasons. CONTRACT_VERSION 2.2.0.

FD-9 FD-10 CT-3"
```

Then pin both apps to `2.2.0`, `pnpm verify` green, `git commit -m "chore: pin uw-app and uw-ingest to contract 2.2.0" -m "CT-3"`.

### Task 6: The principal and `can()` in packages/core

**Proves:** FD-7 (typed, serialisable principal exported from `packages/core`), FD-8 (`can()` is pure over resolved grants).

**Files:**
- Modify: `packages/core/package.json` (dependency `"@uw/contracts": "workspace:*"`; exports `"./principal": "./principal.ts"`, `"./acl": "./acl.ts"`)
- Create: `packages/core/principal.ts`, `packages/core/principal.test.ts`
- Create: `packages/core/acl.ts` (shared root, its own commit), `packages/core/acl.test.ts`

**Interfaces:**
- Consumes: `principalSchema`, `Principal`, `Grant`, `Role`, `JdArea` from `@uw/contracts` (Task 3).
- Produces (exact):

```ts
export type { Grant, Principal } from '@uw/contracts';
export const INGEST_IDENTITY = 'agent:ingest';
export function personPrincipal(person: {
  readonly personId: string;
  readonly email: string;
  readonly grants: readonly Grant[];
  readonly interactive: boolean;
}): Principal;
export function serviceTokenPrincipal(clientId: string): Principal;
export function ingestPrincipal(): Principal;
export function parsePrincipal(value: unknown): Principal;

export type AclAction = 'read' | 'write' | 'admin';
export type AclResource = { readonly kind: 'org' } | { readonly kind: 'area'; readonly area: JdArea };
export const minimumRole: Readonly<Record<AclAction, Role>>;
export function can(actor: Principal, action: AclAction, resource: AclResource): boolean;
```

`can()` takes `action` from `read | write | admin`, not a verb name: the PRD's `can(actor, verb, resource)` signature, with "verb" narrowed to an ACL action so it does not collide with the CONTEXT.md word **Verb** (an MCP tool). Later steps map their verbs and commands onto these three actions; `verbRegistry[].grant.role` already names the role each verb needs.

- [ ] **Step 1: Write the failing tests**

`packages/core/acl.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Grant } from '@uw/contracts';
import { can, type AclAction, type AclResource } from './acl.ts';
import { personPrincipal } from './principal.ts';

const personId = '00000000-0000-4000-8000-000000000009';
const grantId = '00000000-0000-4000-8000-000000000909';

function holding(...grants: Grant[]) {
  return personPrincipal({ personId, email: 'p@unfoldingword.org', grants, interactive: true });
}
const org = (role: Grant['role']): Grant => ({ grantId, role, scopeKind: 'org', scopeArea: null, expiresAt: null });
const area = (role: Grant['role'], scopeArea: string): Grant => ({ grantId, role, scopeKind: 'jd_area', scopeArea, expiresAt: null });

const software: AclResource = { kind: 'area', area: '80-89' };
const finance: AclResource = { kind: 'area', area: '20-29' };
const wholeOrg: AclResource = { kind: 'org' };

type Row = [string, Grant[], AclAction, AclResource, boolean];

const matrix: Row[] = [
  ['org admin may administer any area', [org('admin')], 'admin', finance, true],
  ['org admin may administer the org', [org('admin')], 'admin', wholeOrg, true],
  ['area admin may administer its area', [area('admin', '80-89')], 'admin', software, true],
  ['area admin may not administer another area', [area('admin', '80-89')], 'admin', finance, false],
  ['area admin may not administer the org', [area('admin', '80-89')], 'admin', wholeOrg, false],
  ['area admin reads every area', [area('admin', '80-89')], 'read', finance, true],
  ['editor writes its own area', [area('editor', '80-89')], 'write', software, true],
  ['editor may not write another area', [area('editor', '80-89')], 'write', finance, false],
  ['editor reads every area', [area('editor', '80-89')], 'read', finance, true],
  ['editor may not administer its area', [area('editor', '80-89')], 'admin', software, false],
  ['viewer reads its own area', [area('viewer', '80-89')], 'read', software, true],
  ['viewer may not read another area', [area('viewer', '80-89')], 'read', finance, false],
  ['viewer may not write its own area', [area('viewer', '80-89')], 'write', software, false],
  ['org editor writes every area', [org('editor')], 'write', finance, true],
  ['org viewer reads every area', [org('viewer')], 'read', finance, true],
  ['org viewer may not write', [org('viewer')], 'write', software, false],
  ['no grant may do nothing', [], 'read', software, false],
  ['grants add up', [area('viewer', '80-89'), area('editor', '20-29')], 'write', finance, true],
];

describe('FD-8 can()', () => {
  it.each(matrix)('%s', (_label, grants, action, resource, expected) => {
    expect(can(holding(...grants), action, resource)).toBe(expected);
  });

  it('lets an org-scope admin do everything an area admin may', () => {
    const actions: AclAction[] = ['read', 'write', 'admin'];
    const areaAdmin = holding(area('admin', '80-89'));
    const orgAdmin = holding(org('admin'));
    for (const action of actions) {
      if (can(areaAdmin, action, software)) expect(can(orgAdmin, action, software)).toBe(true);
    }
  });

  it('takes three arguments and no database handle', () => {
    expect(can.length).toBe(3);
  });
});
```

`packages/core/principal.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ingestPrincipal, parsePrincipal, personPrincipal, serviceTokenPrincipal } from './principal.ts';

describe('FD-7 the principal', () => {
  const person = personPrincipal({
    personId: '00000000-0000-4000-8000-000000000001',
    email: 'ian.lindsley@unfoldingword.org',
    grants: [{ grantId: '00000000-0000-4000-8000-000000000101', role: 'admin', scopeKind: 'org', scopeArea: null, expiresAt: null }],
    interactive: true,
  });

  it('names a person as human:<personId> and keeps the resolved grants', () => {
    expect(person.identity).toBe('human:00000000-0000-4000-8000-000000000001');
    expect(person.kind).toBe('person');
    expect(person.grants).toHaveLength(1);
  });

  it('survives serialisation into a queue message', () => {
    expect(parsePrincipal(JSON.parse(JSON.stringify(person)))).toEqual(person);
  });

  it('makes a service token non-interactive, with no grants of its own', () => {
    const agent = serviceTokenPrincipal('a1b2c3d4.access');
    expect(agent).toMatchObject({ identity: 'agent:svc-a1b2c3d4-access', kind: 'agent', interactive: false, grants: [] });
  });

  it('names the ingest system identity agent:ingest', () => {
    expect(ingestPrincipal()).toMatchObject({ identity: 'agent:ingest', kind: 'agent', personId: null, interactive: false });
  });

  it('refuses a principal whose kind and identity disagree', () => {
    expect(() => parsePrincipal({ ...person, identity: 'agent:builder' })).toThrow();
  });

  it('refuses a service token id that leaves nothing to name', () => {
    expect(() => serviceTokenPrincipal('...')).toThrow();
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm exec vitest run --project node packages/core` → FAIL, missing modules.

- [ ] **Step 3: Implement**

`packages/core/principal.ts`:

```ts
import { principalSchema, type Grant, type Principal } from '@uw/contracts';

export type { Grant, Principal };

export const INGEST_IDENTITY = 'agent:ingest';

export function personPrincipal(person: {
  readonly personId: string;
  readonly email: string;
  readonly grants: readonly Grant[];
  readonly interactive: boolean;
}): Principal {
  return principalSchema.parse({
    identity: `human:${person.personId}`,
    kind: 'person',
    personId: person.personId,
    email: person.email,
    grants: [...person.grants],
    interactive: person.interactive,
  });
}

export function serviceTokenPrincipal(clientId: string): Principal {
  const segment = clientId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return principalSchema.parse({
    identity: `agent:svc-${segment}`,
    kind: 'agent',
    personId: null,
    email: null,
    grants: [],
    interactive: false,
  });
}

export function ingestPrincipal(): Principal {
  return principalSchema.parse({
    identity: INGEST_IDENTITY,
    kind: 'agent',
    personId: null,
    email: null,
    grants: [],
    interactive: false,
  });
}

export function parsePrincipal(value: unknown): Principal {
  return principalSchema.parse(value);
}
```

`serviceTokenPrincipal('...')` yields `agent:svc-`, which the identity schema refuses, so it throws: that is the intended refusal. `packages/core/acl.ts`:

```ts
import type { Grant, JdArea, Principal, Role } from '@uw/contracts';

export type AclAction = 'read' | 'write' | 'admin';

export type AclResource = { readonly kind: 'org' } | { readonly kind: 'area'; readonly area: JdArea };

export const minimumRole: Readonly<Record<AclAction, Role>> = {
  read: 'viewer',
  write: 'editor',
  admin: 'admin',
};

const rank: Readonly<Record<Role, number>> = { viewer: 1, editor: 2, admin: 3 };

function reaches(held: Role, needed: Role): boolean {
  return rank[held] >= rank[needed];
}

function grantAllows(grant: Grant, action: AclAction, resource: AclResource): boolean {
  const needed = minimumRole[action];
  if (grant.scopeKind === 'org') return reaches(grant.role, needed);
  if (resource.kind === 'org') return false;
  if (grant.scopeArea === resource.area) return reaches(grant.role, needed);
  return action === 'read' && reaches(grant.role, 'editor');
}

export function can(actor: Principal, action: AclAction, resource: AclResource): boolean {
  return actor.grants.some((grant) => grantAllows(grant, action, resource));
}
```

If ESLint's `security/detect-object-injection` flags `rank[held]` or `minimumRole[action]`, replace those two lookups with `Map`s built from the same literals; do not add a disable directive (directive comments are banned).

- [ ] **Step 4: Run** `pnpm exec vitest run --project node packages/core` → PASS. Run `pnpm architecture` → green (core now imports contracts, which the DAG allows).

- [ ] **Step 5: Verify and commit (two commits)**

`TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add packages/core/package.json packages/core/principal.ts packages/core/principal.test.ts pnpm-lock.yaml
git commit -m "feat(core): a typed, serialisable principal

personPrincipal, serviceTokenPrincipal and ingestPrincipal build a Principal that
parses through the contract schema, so it can travel in a queue message.

FD-7"
git add packages/core/acl.ts packages/core/acl.test.ts
git commit -m "feat(core): can() over the grants resolved on the principal

Shared root packages/core/acl.ts: one pure can(actor, action, resource) with no
database handle. Org admin is allowed everything an area admin is; editor on one
area reads every area and writes only its own; viewer reads only its own.

FD-8"
```

---

### Task 7: The foundation tables, their constraints and the bootstrap migration

**Proves:** FD-8 (`role_grants`, `grant_audit`, bootstrap org admins), FD-9 (`pages`, `page_versions`), FD-10 (`webhook_deliveries`), FD-11 (`queue_watermarks`), FD-7 (`people`), and FD-6 (the constraint tests run on real Postgres).

**Files:**
- Modify: `packages/db/package.json` (dependency `"@uw/contracts": "workspace:*"`)
- Create: `packages/db/checks.ts`
- Modify: `packages/db/schema.ts` (shared root)
- Create: `packages/db/migrations/0000_foundation_tables.sql`, `0001_grant_audit_append_only.sql`, `0002_bootstrap_admins.sql`, and drizzle-kit's `meta/` snapshots and journal entries (generated)
- Modify: `packages/db/client.ts` (add `Transaction`, `Executor` types)
- Create: `packages/db/foundation.test.ts`

**Interfaces:**
- Produces Drizzle exports from `@uw/db/schema`: `people`, `roleGrants`, `grantAudit`, `pages`, `pageVersions`, `webhookDeliveries`, `queueWatermarks`.
- Produces from `@uw/db/client`: `type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]` and `type Executor = Database | Transaction`.
- Produces fixed bootstrap ids: Ian `00000000-0000-4000-8000-000000000001` (`ian.lindsley@unfoldingword.org`), the sponsor `00000000-0000-4000-8000-000000000002` (`sponsor@unfoldingword.org`), their org-admin grants `…0101` and `…0102`.

- [ ] **Step 1: Write the failing constraint tests**

`packages/db/foundation.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { declarationOf } from './declarations.ts';
import * as schema from './schema.ts';
import { createMigratedDatabase, testServer, type TestDatabase } from './test-database.ts';

const timeout = 60_000;
let database: TestDatabase;
let sql: ReturnType<typeof postgres>;

async function attempt(text: string): Promise<string> {
  return sql.unsafe(text).then(
    () => 'ok',
    (error: { code?: string }) => error.code ?? 'error',
  );
}

const person = (id: string, email: string) =>
  `INSERT INTO people (id, email, display_name, status) VALUES ('${id}', '${email}', 'P', 'active')`;
const grant = (personId: string, role: string, kind: string, area: string | null) =>
  `INSERT INTO role_grants (person_id, role, scope_kind, scope_area) VALUES ('${personId}', '${role}', '${kind}', ${area === null ? 'NULL' : `'${area}'`})`;
const page = (id: string, fields: Partial<Record<'type' | 'jd_area' | 'slug' | 'version', string>> = {}) =>
  `INSERT INTO pages (id, type, jd_area, slug, title, frontmatter, body_md, version, status) VALUES ('${id}', '${fields.type ?? 'skill'}', '${fields.jd_area ?? '80-89'}', '${fields.slug ?? `s-${id.slice(-4)}`}', 'T', '{}', '', ${fields.version ?? '1'}, 'draft')`;

const p1 = '10000000-0000-4000-8000-000000000001';

describe.skipIf(!testServer)('the foundation tables on real Postgres', () => {
  beforeAll(async () => {
    database = await createMigratedDatabase(testServer ?? '');
    sql = postgres(database.connectionString, { max: 1, onnotice: () => undefined });
  }, timeout);
  afterAll(async () => {
    await sql.end();
    await database.drop();
  });

  describe('FD-7 people', () => {
    it('refuses an email that is not lowercase, and an unknown status', async () => {
      expect(await attempt(person('10000000-0000-4000-8000-0000000000aa', 'Mixed@unfoldingword.org'))).toBe('23514');
      expect(await attempt(`INSERT INTO people (email, display_name, status) VALUES ('x@unfoldingword.org', 'X', 'suspended')`)).toBe('23514');
      expect(await attempt(person(p1, 'p1@unfoldingword.org'))).toBe('ok');
      expect(await attempt(person('10000000-0000-4000-8000-0000000000ab', 'p1@unfoldingword.org'))).toBe('23505');
    });
  });

  describe('FD-8 role_grants and grant_audit', () => {
    it('refuses an unknown role, an org grant with an area, and an area grant without a valid one', async () => {
      expect(await attempt(grant(p1, 'owner', 'org', null))).toBe('23514');
      expect(await attempt(grant(p1, 'admin', 'org', '80-89'))).toBe('23514');
      expect(await attempt(grant(p1, 'editor', 'jd_area', null))).toBe('23514');
      expect(await attempt(grant(p1, 'editor', 'jd_area', '80-19'))).toBe('23514');
      expect(await attempt(grant(p1, 'editor', 'jd_area', '80-89'))).toBe('ok');
    });

    it('holds one live grant per person, role and scope, and allows it again after revoke', async () => {
      expect(await attempt(grant(p1, 'editor', 'jd_area', '80-89'))).toBe('23505');
      await sql.unsafe(`UPDATE role_grants SET revoked_at = now() WHERE person_id = '${p1}'`);
      expect(await attempt(grant(p1, 'editor', 'jd_area', '80-89'))).toBe('ok');
    });

    it('grants org admin to Ian and the sponsor in the bootstrap migration, with an audit row each', async () => {
      const admins = await sql`
        SELECT p.email FROM role_grants g JOIN people p ON p.id = g.person_id
        WHERE g.role = 'admin' AND g.scope_kind = 'org' AND g.revoked_at IS NULL ORDER BY p.email`;
      expect(admins.map((row) => row['email'])).toEqual([
        'ian.lindsley@unfoldingword.org',
        'sponsor@unfoldingword.org',
      ]);
      const audits = await sql`SELECT actor, action FROM grant_audit WHERE action = 'bootstrap'`;
      expect(audits).toHaveLength(2);
      expect(audits.every((row) => row['actor'] === 'agent:bootstrap')).toBe(true);
    });

    it('refuses UPDATE, DELETE and TRUNCATE on grant_audit', async () => {
      expect(await attempt(`UPDATE grant_audit SET actor = 'human:x'`)).toBe('P0001');
      expect(await attempt(`DELETE FROM grant_audit`)).toBe('P0001');
      expect(await attempt(`TRUNCATE grant_audit`)).toBe('P0001');
    });
  });

  describe('FD-9 pages and page_versions', () => {
    const a = '20000000-0000-4000-8000-00000000000a';
    it('refuses an unknown type, a bad slug, a bad area and version 0', async () => {
      expect(await attempt(page('20000000-0000-4000-8000-000000000001', { type: 'policy' }))).toBe('23514');
      expect(await attempt(page('20000000-0000-4000-8000-000000000002', { slug: 'Not Kebab' }))).toBe('23514');
      expect(await attempt(page('20000000-0000-4000-8000-000000000003', { jd_area: '8-9' }))).toBe('23514');
      expect(await attempt(page('20000000-0000-4000-8000-000000000004', { version: '0' }))).toBe('23514');
    });

    it('keeps slugs unique per area and allows the same slug in another area', async () => {
      expect(await attempt(page(a, { slug: 'shared' }))).toBe('ok');
      expect(await attempt(page('20000000-0000-4000-8000-00000000000b', { slug: 'shared' }))).toBe('23505');
      expect(await attempt(page('20000000-0000-4000-8000-00000000000c', { slug: 'shared', jd_area: '20-29' }))).toBe('ok');
    });

    it('keeps one snapshot per page version and an identity-shaped edit source', async () => {
      const snapshot = (version: number, source: string) =>
        `INSERT INTO page_versions (page_id, version, type, jd_area, slug, title, frontmatter, body_md, status, edit_source) VALUES ('${a}', ${version}, 'skill', '80-89', 'shared', 'T', '{}', '', 'draft', '${source}')`;
      expect(await attempt(snapshot(1, 'human:ian'))).toBe('ok');
      expect(await attempt(snapshot(1, 'human:ian'))).toBe('23505');
      expect(await attempt(snapshot(2, 'robot:x'))).toBe('23514');
    });
  });

  describe('FD-10 webhook_deliveries', () => {
    it('records a delivery id once per source and refuses an unknown source', async () => {
      const row = (source: string) => `INSERT INTO webhook_deliveries (source, delivery_id) VALUES ('${source}', 'd-1')`;
      expect(await attempt(row('github'))).toBe('ok');
      expect(await attempt(row('github'))).toBe('23505');
      expect(await attempt(row('stripe'))).toBe('23514');
    });
  });

  it('declares every table with its classification and offline eligibility (plan §2.6)', () => {
    expect(declarationOf(schema.people)).toEqual({ classification: 'internal', offlineEligibility: 'cache_readonly' });
    expect(declarationOf(schema.roleGrants)).toEqual({ classification: 'restricted', offlineEligibility: 'never' });
    expect(declarationOf(schema.grantAudit)).toEqual({ classification: 'restricted', offlineEligibility: 'never' });
    expect(declarationOf(schema.pages)).toEqual({ classification: 'internal', offlineEligibility: 'sync' });
    expect(declarationOf(schema.pageVersions)).toEqual({ classification: 'internal', offlineEligibility: 'sync' });
    expect(declarationOf(schema.webhookDeliveries)).toEqual({ classification: 'internal', offlineEligibility: 'never' });
    expect(declarationOf(schema.queueWatermarks)).toEqual({ classification: 'internal', offlineEligibility: 'never' });
  });
});
```

The tests in this file run in order and share one database: later cases rely on rows earlier ones inserted (`p1`, the `shared` slug). If a `describe` callback passes 50 lines, split it into two `describe` blocks; the assertions stay as written.

- [ ] **Step 2: Run and see it fail**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm exec vitest run --project node packages/db/foundation.test.ts` → FAIL (tables do not exist; `schema.people` undefined).

- [ ] **Step 3: Write `checks.ts` and the schema**

`packages/db/checks.ts`:

```ts
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

const plainWord = /^[a-z0-9_-]+$/;

export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const unsafe = values.filter((value) => !plainWord.test(value));
  if (unsafe.length > 0) {
    throw new TypeError(`closed-set values must be plain words: ${unsafe.join(', ')}`);
  }
  return sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;
}

export function matches(column: AnyPgColumn, pattern: string): SQL {
  if (pattern.includes("'")) throw new TypeError('a CHECK pattern may not contain a quote');
  return sql`${column} ~ ${sql.raw(`'${pattern}'`)}`;
}

export const JD_AREA_PATTERN = '^([0-9])0-\\19$';
export const SLUG_PATTERN = '^[a-z0-9]+(-[a-z0-9]+)*$';
export const IDENTITY_PATTERN = '^(human|agent):.+$';
```

`packages/db/schema.ts` (replaces `export {};`):

```ts
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ingestSourceSchema,
  pageStatusSchema,
  pageTypeSchema,
  personStatusSchema,
  roleSchema,
  scopeSchema,
} from '@uw/contracts';
import { IDENTITY_PATTERN, JD_AREA_PATTERN, SLUG_PATTERN, matches, oneOf } from './checks.ts';
import { declareTable } from './declarations.ts';

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const people = declareTable(
  'people',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    status: text('status').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  { classification: 'internal', offlineEligibility: 'cache_readonly' },
  (t) => [
    check('people_status_known', oneOf(t.status, personStatusSchema.options)),
    check('people_email_lowercase', sql`${t.email} = lower(${t.email})`),
  ],
);

export const roleGrants = declareTable(
  'role_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id').notNull().references(() => people.id),
    role: text('role').notNull(),
    scopeKind: text('scope_kind').notNull(),
    scopeArea: text('scope_area'),
    grantedBy: uuid('granted_by').references(() => people.id),
    grantedAt: instant('granted_at').notNull().defaultNow(),
    expiresAt: instant('expires_at'),
    revokedAt: instant('revoked_at'),
  },
  { classification: 'restricted', offlineEligibility: 'never' },
  (t) => [
    check('role_grants_role_known', oneOf(t.role, roleSchema.options)),
    check('role_grants_scope_known', oneOf(t.scopeKind, scopeSchema.options)),
    check(
      'role_grants_area_matches_scope',
      sql`(${t.scopeKind} = 'org' AND ${t.scopeArea} IS NULL) OR (${t.scopeKind} = 'jd_area' AND ${matches(t.scopeArea, JD_AREA_PATTERN)})`,
    ),
    uniqueIndex('role_grants_one_live')
      .on(t.personId, t.role, t.scopeKind, sql`coalesce(${t.scopeArea}, '')`)
      .where(sql`${t.revokedAt} IS NULL`),
    index('role_grants_person').on(t.personId),
  ],
);

export const grantAudit = declareTable(
  'grant_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor: text('actor').notNull(),
    at: instant('at').notNull().defaultNow(),
    action: text('action').notNull(),
    grantId: uuid('grant_id').notNull().references(() => roleGrants.id),
    before: jsonb('before'),
    after: jsonb('after'),
    traceId: uuid('trace_id'),
  },
  { classification: 'restricted', offlineEligibility: 'never' },
  (t) => [
    check('grant_audit_action_known', oneOf(t.action, ['grant', 'revoke', 'bootstrap'])),
    check('grant_audit_actor_is_identity', matches(t.actor, IDENTITY_PATTERN)),
    index('grant_audit_grant').on(t.grantId),
  ],
);

export const pages = declareTable(
  'pages',
  {
    id: uuid('id').primaryKey(),
    type: text('type').notNull(),
    jdArea: text('jd_area').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    parentId: uuid('parent_id'),
    frontmatter: jsonb('frontmatter').notNull(),
    bodyMd: text('body_md').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    foreignKey({ name: 'pages_parent_fk', columns: [t.parentId], foreignColumns: [t.id] }),
    check('pages_type_known', oneOf(t.type, pageTypeSchema.options)),
    check('pages_status_known', oneOf(t.status, pageStatusSchema.options)),
    check('pages_area_form', matches(t.jdArea, JD_AREA_PATTERN)),
    check('pages_slug_form', matches(t.slug, SLUG_PATTERN)),
    check('pages_version_positive', sql`${t.version} >= 1`),
    uniqueIndex('pages_slug_per_area').on(t.jdArea, t.slug),
    index('pages_parent').on(t.parentId),
  ],
);

export const pageVersions = declareTable(
  'page_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id').notNull().references(() => pages.id),
    version: integer('version').notNull(),
    type: text('type').notNull(),
    jdArea: text('jd_area').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    parentId: uuid('parent_id'),
    frontmatter: jsonb('frontmatter').notNull(),
    bodyMd: text('body_md').notNull(),
    status: text('status').notNull(),
    editSource: text('edit_source').notNull(),
    traceId: uuid('trace_id'),
    savedAt: instant('saved_at').notNull().defaultNow(),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    uniqueIndex('page_versions_page_version').on(t.pageId, t.version),
    check('page_versions_edit_source_is_identity', matches(t.editSource, IDENTITY_PATTERN)),
  ],
);

export const webhookDeliveries = declareTable(
  'webhook_deliveries',
  {
    source: text('source').notNull(),
    deliveryId: text('delivery_id').notNull(),
    receivedAt: instant('received_at').notNull().defaultNow(),
  },
  { classification: 'internal', offlineEligibility: 'never' },
  (t) => [
    primaryKey({ name: 'webhook_deliveries_pk', columns: [t.source, t.deliveryId] }),
    check('webhook_deliveries_source_known', oneOf(t.source, ingestSourceSchema.options)),
  ],
);

export const queueWatermarks = declareTable(
  'queue_watermarks',
  {
    queue: text('queue').primaryKey(),
    lastEnqueuedAt: instant('last_enqueued_at').notNull(),
    lastConsumedAt: instant('last_consumed_at').notNull(),
  },
  { classification: 'internal', offlineEligibility: 'never' },
);
```

The frontmatter and body have no SQL default: the page API always writes both. If `matches()` typed on `AnyPgColumn` rejects a nullable column such as `t.scopeArea`, widen its parameter type to `AnyPgColumn | SQL.Aliased` only as far as `tsc` requires; do not cast.

- [ ] **Step 4: Generate the migrations**

```bash
cd /home/ianjl/projects/uw-platform-v1
pnpm --filter @uw/db exec drizzle-kit generate --name foundation_tables
pnpm --filter @uw/db exec drizzle-kit generate --custom --name grant_audit_append_only
pnpm --filter @uw/db exec drizzle-kit generate --custom --name bootstrap_admins
```

Read the generated `0000_foundation_tables.sql`: every CHECK, the partial unique index and both foreign keys must be present. Then fill the two custom files. `0001_grant_audit_append_only.sql`:

```sql
CREATE FUNCTION grant_audit_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'grant_audit is append-only' USING ERRCODE = 'P0001';
END
$$;
--> statement-breakpoint
CREATE TRIGGER grant_audit_no_update_or_delete BEFORE UPDATE OR DELETE ON grant_audit FOR EACH ROW EXECUTE FUNCTION grant_audit_refuse_change();
--> statement-breakpoint
CREATE TRIGGER grant_audit_no_truncate BEFORE TRUNCATE ON grant_audit FOR EACH STATEMENT EXECUTE FUNCTION grant_audit_refuse_change();
```

`0002_bootstrap_admins.sql`:

```sql
INSERT INTO people (id, email, display_name, status) VALUES
  ('00000000-0000-4000-8000-000000000001', 'ian.lindsley@unfoldingword.org', 'Ian Lindsley', 'active'),
  ('00000000-0000-4000-8000-000000000002', 'sponsor@unfoldingword.org', 'Sponsor', 'active')
ON CONFLICT (email) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_grants (id, person_id, role, scope_kind, scope_area, granted_by) VALUES
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'admin', 'org', NULL, NULL),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000002', 'admin', 'org', NULL, NULL)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO grant_audit (actor, action, grant_id, before, after)
SELECT 'agent:bootstrap', 'bootstrap', g.id, NULL, to_jsonb(g)
FROM role_grants g
WHERE g.id IN ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102');
```

Run `pnpm exec prettier --check packages/db/migrations` and fix the JSON snapshots with `--write` if needed (SQL files are not formatted by Prettier).

`packages/db/client.ts`: append

```ts
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;
```

- [ ] **Step 5: Run the tests and the drift check**

Run: `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm exec vitest run --project node packages/db tools/db` → PASS: `foundation.test.ts`, the existing `migrations.test.ts` (applies from empty, re-applies as a no-op), `declarations.test.ts` and the drift check.

- [ ] **Step 6: Verify and commit (schema in its own commit)**

`TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add packages/db/schema.ts packages/db/checks.ts packages/db/migrations packages/db/package.json pnpm-lock.yaml
git commit -m "feat(db): people, grants, grant audit, pages, page versions, deliveries and watermarks

Shared root packages/db/schema.ts: the foundation tables with their classification
and offline eligibility, closed sets as CHECK constraints (P4), one live grant per
person, role and scope, slugs unique per area (P20), an append-only grant_audit,
and a bootstrap migration granting org admin to Ian and the sponsor.

FD-7 FD-8 FD-9 FD-10 FD-11"
git add packages/db/foundation.test.ts packages/db/client.ts
git commit -m "test(db): the foundation constraints on real Postgres

FD-6 FD-8 FD-9 FD-10"
```

---

### Task 8: One trace id and a structured logger in both Workers' shared core, and uw-app's request log

**Proves:** FD-11 (trace id per request, structured JSON log line with `trace_id`, `principal`, `route`, `latency_ms`, `outcome`, commit; bodies never logged).

**Files:**
- Create: `packages/core/log.ts`, `packages/core/log.test.ts`, `packages/core/trace.ts`
- Modify: `packages/core/package.json` (exports `"./log"`, `"./trace"`)
- Create: `apps/uw-app/env.ts`, `apps/uw-app/database.ts`, `apps/uw-app/deps.ts`, `apps/uw-app/observe.ts`, `apps/uw-app/observe.test.ts`
- Modify: `apps/uw-app/app.tsx`, `apps/uw-app/app.test.ts`

**Interfaces:**
- Produces (exact):

```ts
export const TRACE_HEADER = 'x-trace-id';
export const traceIdSchema: z.ZodUUID;

export type LogLevel = 'info' | 'warn' | 'error';
export type LogContext = {
  readonly traceId: string;
  readonly commit: string;
  readonly route: string;
  readonly principal: string | null;
};
export type LogValue = string | number | boolean | null;
export type LogFields = { readonly outcome: string; readonly latencyMs?: number } & {
  readonly [key: string]: LogValue | undefined;
};
export type LogSink = (line: string) => void;
export type Logger = {
  readonly context: LogContext;
  with(update: Partial<LogContext>): Logger;
  info(message: string, fields: LogFields): void;
  warn(message: string, fields: LogFields): void;
  error(message: string, fields: LogFields): void;
};
export function createLogger(context: LogContext, sink: LogSink): Logger;
```

Every line is one JSON object with exactly these keys first, in this order: `level`, `message`, `trace_id`, `principal`, `route`, `latency_ms` (number or `null`), `outcome`, `commit`, then any extra fields (primitive values only; a key that collides with one of the eight is dropped).

`apps/uw-app/env.ts`:

```ts
export type HyperdriveBinding = { readonly connectionString: string };
export type QueueProducer<Body> = { send(body: Body): Promise<void> };

export type Bindings = {
  COMMIT_SHA?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_PRINCIPAL_EMAIL?: string;
  HYPERDRIVE?: HyperdriveBinding;
  INGEST_DLQ?: QueueProducer<unknown>;
};

export const UNKNOWN_COMMIT = 'unknown';

export function commitOf(env: Bindings): string {
  return env.COMMIT_SHA ?? UNKNOWN_COMMIT;
}
```

The binding types are structural on purpose, so app modules type-check under both the Workers and the node tsconfig; Cloudflare's `Hyperdrive` and `Queue` satisfy them.

`apps/uw-app/database.ts`:

```ts
import type { MiddlewareHandler } from 'hono';
import { createClient, type Database } from '@uw/db/client';
import type { AppDeps, AppEnv } from './deps.ts';
import type { Bindings } from './env.ts';

export type DatabaseHandle = { readonly db: Database; release(): Promise<void> };

export function hyperdriveDatabase(env: Bindings): DatabaseHandle | null {
  if (!env.HYPERDRIVE) return null;
  const db = createClient(env.HYPERDRIVE.connectionString);
  return { db, release: () => db.$client.end() };
}

export function withDatabase(deps: Pick<AppDeps, 'openDatabase'>): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const handle = deps.openDatabase(c.env);
    c.set('database', handle);
    try {
      await next();
    } finally {
      await handle?.release();
    }
  };
}
```

`apps/uw-app/deps.ts`:

```ts
import type { LogSink, Logger } from '@uw/core/log';
import type { Principal } from '@uw/core/principal';
import { hyperdriveDatabase, type DatabaseHandle } from './database.ts';
import type { Bindings } from './env.ts';

export type AppDeps = {
  readonly openDatabase: (env: Bindings) => DatabaseHandle | null;
  readonly newId: () => string;
  readonly sink: LogSink;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    traceId: string;
    logger: Logger;
    database: DatabaseHandle | null;
    principal: Principal | null;
    outcome: string | null;
  };
};

export const platformDeps: AppDeps = {
  openDatabase: hyperdriveDatabase,
  newId: () => crypto.randomUUID(),
  sink: (line) => console.log(line),
};
```

(Task 9 adds `accessKeys` to `AppDeps` and `platformDeps`.) `createApp(deps: AppDeps = platformDeps): Hono<AppEnv>` in `app.tsx` wires, in this order: `observe(deps)`, `withDatabase(deps)`, the existing `/health` and `/` routes, and an `onError` handler that logs `error` with `outcome: 'internal_error'` and returns `refusalSchema`-shaped `{ status: 'error', reason: 'internal_error' }` with status 500 and no exception text.

- [ ] **Step 1: Write the failing tests**

`packages/core/log.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createLogger } from './log.ts';

function capture() {
  const lines: Record<string, unknown>[] = [];
  return { lines, sink: (line: string) => lines.push(JSON.parse(line)) };
}

const context = { traceId: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11', commit: 'abc1234', route: 'GET /health', principal: null };

describe('FD-11 the structured logger', () => {
  it('writes every required field on every line, in order', () => {
    const { lines, sink } = capture();
    createLogger(context, sink).info('request', { outcome: 'http_200', latencyMs: 12 });
    expect(Object.keys(lines[0] ?? {})).toEqual(['level', 'message', 'trace_id', 'principal', 'route', 'latency_ms', 'outcome', 'commit']);
    expect(lines[0]).toMatchObject({ level: 'info', trace_id: context.traceId, latency_ms: 12, outcome: 'http_200', commit: 'abc1234' });
  });

  it('writes null latency when none is given and keeps extra primitive fields', () => {
    const { lines, sink } = capture();
    createLogger(context, sink).warn('webhook refused', { outcome: 'unsigned', source: 'github' });
    expect(lines[0]).toMatchObject({ latency_ms: null, source: 'github', level: 'warn' });
  });

  it('carries a principal set later, and never lets an extra field overwrite a required one', () => {
    const { lines, sink } = capture();
    createLogger(context, sink).with({ principal: 'human:ian' }).error('failed', { outcome: 'internal_error', trace_id: 'forged' });
    expect(lines[0]).toMatchObject({ principal: 'human:ian', trace_id: context.traceId });
  });
});
```

`apps/uw-app/observe.test.ts` (Workers pool):

```ts
import { describe, expect, it } from 'vitest';
import { createApp } from './app.tsx';
import type { AppDeps } from './deps.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function recordingDeps() {
  const lines: Record<string, unknown>[] = [];
  const deps: AppDeps = {
    openDatabase: () => null,
    newId: () => crypto.randomUUID(),
    sink: (line) => lines.push(JSON.parse(line)),
  };
  return { deps, lines };
}

describe('FD-11 one trace id per request, and the request log line', () => {
  it('mints a trace id, returns it in x-trace-id and writes it on the log line', async () => {
    const { deps, lines } = recordingDeps();
    const response = await createApp(deps).request('/health', {}, { COMMIT_SHA: 'abc1234' });
    const traceId = response.headers.get('x-trace-id') ?? '';
    expect(traceId).toMatch(uuid);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ trace_id: traceId, principal: null, route: 'GET /health', outcome: 'http_200', commit: 'abc1234' });
    expect(typeof lines[0]?.['latency_ms']).toBe('number');
  });

  it('mints a fresh trace id even when the caller sends one', async () => {
    const { deps } = recordingDeps();
    const forged = '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11';
    const response = await createApp(deps).request('/health', { headers: { 'x-trace-id': forged } }, {});
    expect(response.headers.get('x-trace-id')).not.toBe(forged);
  });

  it('never logs a request body', async () => {
    const { deps, lines } = recordingDeps();
    await createApp(deps).request('/health', { method: 'POST', body: 'secret-body-text' }, {});
    expect(JSON.stringify(lines)).not.toContain('secret-body-text');
  });
});
```

Keep the existing tests in `apps/uw-app/app.test.ts`, changing each `createApp()` call to `createApp(recordingDeps().deps)` (move `recordingDeps` into `apps/uw-app/testing/deps.ts` and import it from both files).

- [ ] **Step 2: Run and see them fail**

Run: `pnpm exec vitest run --project node packages/core/log.test.ts` and `pnpm exec vitest run --project workers apps/uw-app/observe.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`packages/core/trace.ts`:

```ts
import { z } from 'zod';

export const TRACE_HEADER = 'x-trace-id';
export const traceIdSchema = z.uuid();
```

`packages/core/log.ts`:

```ts
export type LogLevel = 'info' | 'warn' | 'error';

export type LogContext = {
  readonly traceId: string;
  readonly commit: string;
  readonly route: string;
  readonly principal: string | null;
};

export type LogValue = string | number | boolean | null;

export type LogFields = { readonly outcome: string; readonly latencyMs?: number } & {
  readonly [key: string]: LogValue | undefined;
};

export type LogSink = (line: string) => void;

export type Logger = {
  readonly context: LogContext;
  with(update: Partial<LogContext>): Logger;
  info(message: string, fields: LogFields): void;
  warn(message: string, fields: LogFields): void;
  error(message: string, fields: LogFields): void;
};

const required = new Set([
  'level', 'message', 'trace_id', 'principal', 'route', 'latency_ms', 'outcome', 'commit',
]);

function render(level: LogLevel, message: string, context: LogContext, fields: LogFields): string {
  const { outcome, latencyMs, ...extra } = fields;
  const kept = Object.entries(extra).filter(([key, value]) => value !== undefined && !required.has(key));
  return JSON.stringify({
    level,
    message,
    trace_id: context.traceId,
    principal: context.principal,
    route: context.route,
    latency_ms: latencyMs ?? null,
    outcome,
    commit: context.commit,
    ...Object.fromEntries(kept),
  });
}

export function createLogger(context: LogContext, sink: LogSink): Logger {
  const write = (level: LogLevel) => (message: string, fields: LogFields) =>
    sink(render(level, message, context, fields));
  return {
    context,
    with: (update) => createLogger({ ...context, ...update }, sink),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
  };
}
```

`packages/core` has no `console` type (its tsconfig loads no DOM or node types), which is why the sink is always passed in.

`apps/uw-app/observe.ts`:

```ts
import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import { createLogger } from '@uw/core/log';
import { TRACE_HEADER } from '@uw/core/trace';
import type { AppDeps, AppEnv } from './deps.ts';
import { commitOf } from './env.ts';

export function observe(deps: Pick<AppDeps, 'newId' | 'sink'>): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = Date.now();
    const traceId = deps.newId();
    const logger = createLogger(
      { traceId, commit: commitOf(c.env), route: c.req.method, principal: null },
      deps.sink,
    );
    c.set('traceId', traceId);
    c.set('logger', logger);
    c.set('principal', null);
    c.set('outcome', null);
    await next();
    c.header(TRACE_HEADER, traceId);
    logger
      .with({ route: `${c.req.method} ${routePath(c, -1)}`, principal: c.get('principal')?.identity ?? null })
      .info('request', { outcome: c.get('outcome') ?? `http_${c.res.status}`, latencyMs: Date.now() - started });
  };
}
```

`routePath(c, -1)` should give the last matched route pattern (`/health`, later `/api/acl/commands/:name`); if it returns `*` in this Hono version, use `matchedRoutes(c).filter((route) => route.method !== 'ALL').at(-1)?.path ?? c.req.path` from `hono/route` instead, and keep the test's `route: 'GET /health'` assertion.

- [ ] **Step 4: Run** both test files → PASS.

- [ ] **Step 5: Verify and commit**

`TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add packages/core apps/uw-app pnpm-lock.yaml
git commit -m "feat(uw-app): one trace id per request and a structured JSON log line

packages/core gains createLogger, TRACE_HEADER and traceIdSchema; uw-app mints a
trace id at the edge, returns it in x-trace-id and logs trace_id, principal,
route, latency_ms, outcome and the deployed commit on every request, never a body.

FD-11"
```

---

### Task 9: Verify the Access JWT at the edge, and declare Access in infra

**Proves:** FD-7 (signature, audience, issuer, expiry verified on every request; tampered, expired or wrong-audience JWT gets 401; service token yields a non-interactive principal; Access declared in `infra/`).

**Files:**
- Modify: `apps/uw-app/package.json` (dependency `"jose": "^6.2.12"`)
- Create: `apps/uw-app/auth/access.ts`, `apps/uw-app/auth/principal-middleware.ts`, `apps/uw-app/http/outcomes.ts`, `apps/uw-app/testing/access-keys.ts`, `apps/uw-app/auth/access.test.ts`
- Modify: `apps/uw-app/deps.ts` (add `accessKeys`), `apps/uw-app/app.tsx`, `apps/uw-app/app.test.ts`, `apps/uw-app/testing/deps.ts`
- Create: `infra/access/uw-app.json`, `tools/infra/access.test.ts` (shared root `infra/`, own commit)
- Modify: `infra/README.md` (Access section, same infra commit)
- Modify: `docs/exceptions.md` (the `/health` entry, in the feature commit)
- Modify: `knip.json` (drop any temporary `smol-toml` ignore from Task 1)

**Interfaces:**
- Produces (exact):

```ts
export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';
export type AccessConfig = { readonly teamDomain: string; readonly audience: string };
export type AccessIdentity =
  | { readonly kind: 'person'; readonly email: string }
  | { readonly kind: 'service'; readonly clientId: string };
export function accessConfigFrom(env: Bindings): AccessConfig | null;
export function remoteAccessKeys(config: AccessConfig): JWTVerifyGetKey;
export function verifyAccessJwt(token: string, config: AccessConfig, keys: JWTVerifyGetKey): Promise<AccessIdentity | null>;

export function withPrincipal(deps: Pick<AppDeps, 'accessKeys' | 'openDatabase'>): MiddlewareHandler<AppEnv>;

export function httpStatusFor(reason: ErrorReason): ContentfulStatusCode;
export function refuse(c: Context<AppEnv>, reason: ErrorReason): Response;
export function reply(c: Context<AppEnv>, outcome: Outcome): Response;
```

`AppDeps` gains `readonly accessKeys: (config: AccessConfig) => JWTVerifyGetKey`, with `remoteAccessKeys` in `platformDeps`. `accessConfigFrom` returns a config only when both `ACCESS_TEAM_DOMAIN` (matching `^https://[a-z0-9-]+\.cloudflareaccess\.com$`) and `ACCESS_AUD` are set. `remoteAccessKeys` caches one `createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`))` per team domain in a module-level `Map` (key material only; grants are never cached).

`http/outcomes.ts` maps reasons to HTTP status with a `Map<ErrorReason, ContentfulStatusCode>`: `unauthenticated` 401; `not_permitted`, `pending_approval` 403; `person_not_found`, `grant_not_found`, `page_not_found`, `not_wired` 404; `grant_exists`, `last_org_admin`, `page_exists`, `slug_taken`, `stale_version` 409; `malformed_command` 400; `internal_error` 500; `access_not_configured`, `database_not_configured` 503; every other reason 422. `refuse` sets `c.var.outcome` to the reason and returns `{ status: 'error', reason }`; `reply` sets it to `accepted` or the reason and returns the outcome envelope.

The route order in `createApp` becomes: `observe`, `withDatabase`, `GET /health`, `withPrincipal` on `*`, then every other route. `/health` is the only route registered before `withPrincipal`. In this task `withPrincipal` does:

1. `config = accessConfigFrom(env)`; none → `refuse(c, 'access_not_configured')`.
2. Token from `cf-access-jwt-assertion`; missing, or `verifyAccessJwt` returns `null` → `refuse(c, 'unauthenticated')`.
3. Service identity → `c.set('principal', serviceTokenPrincipal(clientId))`, `await next()`.
4. Person identity with `c.get('database') === null` → `refuse(c, 'database_not_configured')`.
5. Person identity with a database → `refuse(c, 'not_wired')` (Task 10 replaces this step with sign-in).

`verifyAccessJwt`:

```ts
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

const claimsSchema = z.object({
  email: z.email().optional(),
  common_name: z.string().min(1).max(200).optional(),
});

export async function verifyAccessJwt(
  token: string,
  config: AccessConfig,
  keys: JWTVerifyGetKey,
): Promise<AccessIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.teamDomain,
      audience: config.audience,
      algorithms: ['RS256'],
    });
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) return null;
    if (claims.data.email) return { kind: 'person', email: claims.data.email.toLowerCase() };
    if (claims.data.common_name) return { kind: 'service', clientId: claims.data.common_name };
    return null;
  } catch {
    return null;
  }
}
```

`apps/uw-app` adds `zod` (`^4.6.5`) to `dependencies` for this import.

`apps/uw-app/testing/access-keys.ts` (runtime-agnostic, used by Workers and node tests):

```ts
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';

export const FIXTURE_TEAM_DOMAIN = 'https://uw-fixture.cloudflareaccess.com';
export const FIXTURE_AUDIENCE = 'fixture-audience-tag';
export const fixtureAccessEnv = { ACCESS_TEAM_DOMAIN: FIXTURE_TEAM_DOMAIN, ACCESS_AUD: FIXTURE_AUDIENCE };

export type SignOptions = { readonly audience?: string; readonly issuer?: string; readonly expiresAt?: number };

export type AccessFixture = {
  readonly keys: JWTVerifyGetKey;
  sign(claims: Record<string, unknown>, options?: SignOptions): Promise<string>;
};

export async function createAccessFixture(): Promise<AccessFixture> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: 'fixture', alg: 'RS256' };
  return {
    keys: createLocalJWKSet({ keys: [jwk] }),
    sign: (claims, options = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
        .setIssuer(options.issuer ?? FIXTURE_TEAM_DOMAIN)
        .setAudience(options.audience ?? FIXTURE_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(options.expiresAt ?? Math.floor(Date.now() / 1000) + 300)
        .sign(privateKey),
  };
}
```

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/auth/access.test.ts` (Workers pool), with a `beforeAll` that creates one `AccessFixture` and a `request(path, token?, env?)` helper calling `createApp({ ...recordingDeps().deps, accessKeys: () => fixture.keys }).request(path, { headers: token ? { 'cf-access-jwt-assertion': token } : {} }, { ...fixtureAccessEnv, ...env })`. Cases, each asserting the status and, for refusals, that the body parses with `refusalSchema` and names the reason:

| Case | Expect |
|---|---|
| `/health` with no token and no Access config | 200 |
| `/` with no Access config at all | 503 `access_not_configured` |
| `/` with Access config and no token | 401 `unauthenticated` |
| a valid person token, no database | 503 `database_not_configured` (verification passed) |
| a valid service token (`{ common_name: 'a1b2c3d4.access' }`) | 200, and the log line's `principal` is `agent:svc-a1b2c3d4-access` |
| the person token with one character of its payload segment changed | 401 `unauthenticated` |
| a token whose `expiresAt` is 60 seconds in the past | 401 |
| a token signed with `audience: 'someone-else'` | 401 |
| a token signed with `issuer: 'https://evil.cloudflareaccess.com'` | 401 |
| a token with header `{"alg":"none"}` and an empty signature, built by hand with base64url | 401 |
| a token signed HS256 with the secret `fixture` | 401 |
| a token with neither `email` nor `common_name` | 401 |

Change the existing `app.test.ts` root-page test to send a valid service token with the fixture Access env (the page still renders `<h1>unfoldingWord</h1>` and the commit), and its 404 test to expect the 404 for an unknown path when signed in as a service token.

`tools/infra/access.test.ts` (node), reading `infra/access/uw-app.json`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Rule = Record<string, unknown>;
type Policy = { name: string; decision: string; include: Rule[] };
type Application = { name: string; domain: string; destinations?: { uri: string }[]; allowed_idps: string[] };
type Declaration = {
  application: Application;
  policies: Policy[];
  health_bypass: { application: Application; policies: Policy[] };
};

const declaration: Declaration = JSON.parse(readFileSync('infra/access/uw-app.json', 'utf8'));

describe('FD-7 Cloudflare Access in front of uw-app, declared in infra', () => {
  it('covers staging and every per-PR Worker', () => {
    expect(declaration.application.destinations?.map((d) => d.uri)).toEqual([
      'uw-app-staging.unfoldingword.workers.dev',
      'uw-app-pr-*.unfoldingword.workers.dev',
    ]);
  });

  it('signs people in with Google and lets any valid service token through as non-identity', () => {
    const [people, agents] = declaration.policies;
    expect(people).toMatchObject({ decision: 'allow', include: [{ login_method: { id: '<google-idp-id>' } }] });
    expect(agents).toMatchObject({ decision: 'non_identity', include: [{ any_valid_service_token: {} }] });
  });

  it('bypasses Access for /health only', () => {
    expect(declaration.health_bypass.application.domain).toBe('uw-app-staging.unfoldingword.workers.dev/health');
    expect(declaration.health_bypass.policies).toEqual([
      { name: 'Deploy health probe', decision: 'bypass', include: [{ everyone: {} }] },
    ]);
  });

  it('holds no secret', () => {
    expect(JSON.stringify(declaration)).not.toMatch(/secret|token_value|client_secret/i);
  });
});
```

- [ ] **Step 2: Run and see them fail** → FAIL.

- [ ] **Step 3: Implement** `access.ts`, `principal-middleware.ts`, `http/outcomes.ts`, `testing/access-keys.ts`, the `deps.ts` and `app.tsx` changes. Write `infra/access/uw-app.json`:

```json
{
  "application": {
    "name": "uw-app",
    "type": "self_hosted",
    "domain": "uw-app-staging.unfoldingword.workers.dev",
    "destinations": [
      { "type": "public", "uri": "uw-app-staging.unfoldingword.workers.dev" },
      { "type": "public", "uri": "uw-app-pr-*.unfoldingword.workers.dev" }
    ],
    "allowed_idps": ["<google-idp-id>"],
    "auto_redirect_to_identity": true,
    "session_duration": "24h"
  },
  "policies": [
    { "name": "Anyone signed in with Google", "decision": "allow", "include": [{ "login_method": { "id": "<google-idp-id>" } }] },
    { "name": "Agent service tokens", "decision": "non_identity", "include": [{ "any_valid_service_token": {} }] }
  ],
  "health_bypass": {
    "application": {
      "name": "uw-app health probe",
      "type": "self_hosted",
      "domain": "uw-app-staging.unfoldingword.workers.dev/health",
      "allowed_idps": []
    },
    "policies": [{ "name": "Deploy health probe", "decision": "bypass", "include": [{ "everyone": {} }] }]
  }
}
```

The allow policy admits any Google account on purpose: a person outside `@unfoldingword.org` must reach the app to be recorded as pending (FD-7); authorization is the grants table, not Access. Add to `infra/README.md` a section "Access (FD-7)" stating: the file is the body of the Cloudflare API calls `POST /accounts/{account_id}/access/apps` and `POST /accounts/{account_id}/access/apps/{app_id}/policies`, applied by a person with an API token holding Access: Apps and Policies Edit; `<google-idp-id>` is replaced with the Google identity provider's id from `GET /accounts/{account_id}/access/identity_providers`; after creation, the application's AUD tag and the team domain go into `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` in `infra/uw-app/wrangler.go-live.toml` (Task 16); production gets its own application when `uw-app` has a production route.

Add this row to `docs/exceptions.md`, dated 2026-10-01: rule "Section 10: no route without `can()`; PRD FD-7: the Access JWT is verified on every request"; file `apps/uw-app/app.tsx` (`GET /health`), `infra/access/uw-app.json`; why: the deploy jobs' health probe (`.github/scripts/await-health.sh`) must read the deployed commit without a credential, and `/health` returns only the commit and indicator statuses, no harness, page or person data; review: when WB-10 adds drill-through lists, those live under a path behind Access and `can()`.

- [ ] **Step 4: Run** `pnpm exec vitest run --project workers apps/uw-app` and `pnpm exec vitest run --project node tools/infra` → PASS.

- [ ] **Step 5: Verify and commit (infra in its own commit)**

`TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add infra/access/uw-app.json infra/README.md tools/infra/access.test.ts
git commit -m "feat(infra): declare Cloudflare Access with Google in front of uw-app

Shared root infra/: the Access application and policies for staging and per-PR
Workers, Google sign-in for people, any valid service token as non-identity for
agents, and a bypass for /health only. Applied by a person; awaiting go-live.

FD-7"
git add apps/uw-app docs/exceptions.md knip.json pnpm-lock.yaml
git commit -m "feat(uw-app): verify the Access JWT on every request

jose checks signature, issuer, audience, expiry and RS256; a missing, tampered,
expired or wrong-audience token gets 401 with the closed reason unauthenticated;
a service token becomes a non-interactive agent principal; without Access
configuration every route but /health refuses with access_not_configured.

FD-7"
```

---

### Task 10: Map the email to a person, resolve grants on every request, and the dev principal

**Proves:** FD-7 (email to `people` row, auto-provision `@unfoldingword.org`, everyone else pending with an explicit "pending approval" response, principal available to every handler), FD-8 (grants resolve from the table on every request with no cross-request cache), P21 (dev-only principal).

**Files:**
- Create: `apps/uw-app/people/directory.ts`, `apps/uw-app/acl/grant-store.ts`, `apps/uw-app/auth/dev-principal.ts`, `apps/uw-app/auth/me.ts`, `apps/uw-app/testing/postgres.ts`
- Modify: `apps/uw-app/auth/principal-middleware.ts`, `apps/uw-app/app.tsx`
- Create: `apps/uw-app/auth/principal.pg.test.ts`, `apps/uw-app/auth/dev-principal.test.ts` (Workers pool)
- Create: `tools/infra/wrangler.test.ts`
- Delete: `apps/uw-app/database.pg.test.ts` (the Task 1 placeholder; `principal.pg.test.ts` replaces it. Grep first: `grep -rn "database.pg.test" .` must show no references.)

**Interfaces:**
- Consumes: `people`, `roleGrants` (Task 7), `personPrincipal`, `serviceTokenPrincipal` (Task 6), `withPrincipal` (Task 9), `Executor` (Task 7).
- Produces (exact):

```ts
export const owns = ['people'] as const;
export const ORG_EMAIL_DOMAIN = 'unfoldingword.org';
export type PersonRecord = { readonly personId: string; readonly email: string; readonly status: PersonStatus };
export function normaliseEmail(email: string): string;
export function statusForEmail(email: string): PersonStatus;
export function signIn(db: Executor, email: string): Promise<PersonRecord>;
export function findPerson(db: Executor, personId: string): Promise<PersonRecord | null>;
export function lockPerson(tx: Transaction, personId: string): Promise<PersonRecord | null>;
export function activatePerson(tx: Transaction, personId: string): Promise<void>;

export function resolveGrants(db: Executor, personId: string): Promise<Grant[]>;
export function toGrant(row: typeof roleGrants.$inferSelect): Grant;

export function devEmail(env: Bindings, url: string): string | null;

export function meRoutes(): Hono<AppEnv>;
```

`resolveGrants` selects rows with `person_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`, ordered by `granted_at, id`, every call, no memo. `signIn` normalises (trim, lowercase), selects by email, and only when absent inserts with `display_name` = the local part and `status` from `statusForEmail` using `onConflictDoNothing()`, then selects again (a concurrent first sign-in lands on the same row). `statusForEmail` is `active` exactly when the normalised address ends with `@unfoldingword.org`. `devEmail` returns `env.DEV_PRINCIPAL_EMAIL` only when `accessConfigFrom(env) === null` and the request host is `localhost` or `127.0.0.1`; otherwise `null`. `GET /api/me` returns `{ principal }` for the caller's own principal.

`withPrincipal` is now:

1. `dev = devEmail(env, c.req.url)`; when set, the identity is `{ kind: 'person', email: dev }` and steps 2 and 3 are skipped.
2. `config = accessConfigFrom(env)`; none → `access_not_configured`.
3. Token and `verifyAccessJwt`; failure → `unauthenticated`.
4. Service identity → `serviceTokenPrincipal`, `next()`.
5. No database → `database_not_configured`.
6. `person = await signIn(db, email)`; `pending` → 403 `pending_approval`: JSON refusal by default, and when the `accept` header includes `text/html`, an HTML page with `<h1>Your sign-in is waiting for approval</h1>` and `<p>An unfoldingWord admin needs to approve your account before you can continue.</p>`, status 403, and `c.var.outcome = 'pending_approval'`.
7. `grants = await resolveGrants(db, person.personId)`; `c.set('principal', personPrincipal({ personId, email, grants, interactive: true }))`; `next()`.

`apps/uw-app/testing/postgres.ts` (node only, excluded from the Workers tsconfig in Task 1):

```ts
import { createClient, type Database } from '@uw/db/client';
import { testServer, withMigratedDatabase } from '@uw/db/test-database';
import type { AppDeps } from '../deps.ts';
import type { AccessFixture } from './access-keys.ts';

export { testServer };

export async function withAppDatabase<T>(work: (db: Database) => Promise<T>): Promise<T> {
  return withMigratedDatabase(testServer ?? '', async (target) => {
    const db = createClient(target);
    try {
      return await work(db);
    } finally {
      await db.$client.end();
    }
  });
}

export function postgresDeps(db: Database, fixture: AccessFixture, sink: AppDeps['sink'] = () => undefined): AppDeps {
  return {
    openDatabase: () => ({ db, release: async () => undefined }),
    accessKeys: () => fixture.keys,
    newId: () => crypto.randomUUID(),
    sink,
  };
}
```

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/auth/principal.pg.test.ts`, inside `describe.skipIf(!testServer)`, each case using `withAppDatabase`, `createAccessFixture`, `postgresDeps`, `fixtureAccessEnv`, and a helper `me(app, email)` that signs `{ email }` and GETs `/api/me`:

```ts
describe.skipIf(!testServer)('FD-7 FD-8 the principal minted at the edge', () => {
  it('provisions an @unfoldingword.org address as active with no grants', ...);
  it('maps a differently cased address to the same people row', ...);
  it('marks any other address pending and answers with pending approval', ...);
  it('marks lookalike domains pending', ...);
  it('renders the pending approval page for a browser', ...);
  it('gives the bootstrap admin the org admin grant', ...);
  it('leaves out a revoked grant and an expired grant', ...);
  it('sees a grant added between two requests, with no cache', ...);
  it('returns a principal that parses back through the contract schema', ...);
});
```

with these exact expectations:
- `new.person@unfoldingword.org` → 200; body `principal` has `kind: 'person'`, `identity: 'human:<id>'`, `grants: []`, `interactive: true`; `SELECT status FROM people WHERE email = 'new.person@unfoldingword.org'` is `active`.
- `Ian.Lindsley@UnfoldingWord.org` and `ian.lindsley@unfoldingword.org` → both 200 with the same `personId` `00000000-0000-4000-8000-000000000001`, and `SELECT count(*) FROM people WHERE email = 'ian.lindsley@unfoldingword.org'` is 1.
- `someone@gmail.com` → 403, body `{ status: 'error', reason: 'pending_approval' }`, row status `pending`.
- `x@evil-unfoldingword.org` and `x@unfoldingword.org.evil.com` → 403 `pending_approval` each.
- `someone@gmail.com` with `accept: text/html` → 403, `content-type` contains `text/html`, body contains `waiting for approval`.
- Ian → `principal.grants` equals `[{ grantId: '00000000-0000-4000-8000-000000000101', role: 'admin', scopeKind: 'org', scopeArea: null, expiresAt: null }]`.
- For a signed-in `g@unfoldingword.org`, insert one revoked grant (`revoked_at = now()`) and one expired grant (`expires_at = now() - interval '1 minute'`) directly with SQL → `principal.grants` is `[]`.
- Request once (no grants), insert an `editor` grant on `80-89` with SQL, request again → the second principal holds it.
- `parsePrincipal(JSON.parse(JSON.stringify(body.principal)))` equals `body.principal`.

`apps/uw-app/auth/dev-principal.test.ts` (Workers pool, pure function):

```ts
describe('P21 the dev-only principal', () => {
  it('uses DEV_PRINCIPAL_EMAIL on localhost when Access is not configured', () => {
    expect(devEmail({ DEV_PRINCIPAL_EMAIL: 'dev@unfoldingword.org' }, 'http://localhost/')).toBe('dev@unfoldingword.org');
    expect(devEmail({ DEV_PRINCIPAL_EMAIL: 'dev@unfoldingword.org' }, 'http://127.0.0.1:8787/')).toBe('dev@unfoldingword.org');
  });
  it('ignores it on any other host', () => {
    expect(devEmail({ DEV_PRINCIPAL_EMAIL: 'dev@unfoldingword.org' }, 'https://uw-app-staging.unfoldingword.workers.dev/')).toBeNull();
  });
  it('ignores it whenever Access is configured', () => {
    expect(devEmail({ ...fixtureAccessEnv, DEV_PRINCIPAL_EMAIL: 'dev@unfoldingword.org' }, 'http://localhost/')).toBeNull();
  });
});
```

`tools/infra/wrangler.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

const files = readdirSync('infra', { recursive: true, encoding: 'utf8' })
  .filter((file) => /wrangler[^/]*\.toml$/.test(file))
  .map((file) => join('infra', file));

function declaredVars(config: Record<string, unknown>): string[] {
  const envs = Object.values((config['env'] ?? {}) as Record<string, Record<string, unknown>>);
  return [config, ...envs].flatMap((block) => Object.keys((block['vars'] ?? {}) as Record<string, unknown>));
}

describe('P21 no deployed environment can set the dev principal', () => {
  it('finds the wrangler files', () => {
    expect(files.length).toBeGreaterThan(0);
  });
  it.each(files)('%s declares no DEV_PRINCIPAL_EMAIL', (file) => {
    expect(declaredVars(parse(readFileSync(file, 'utf8')))).not.toContain('DEV_PRINCIPAL_EMAIL');
  });
});
```

- [ ] **Step 2: Run and see them fail** (`TEST_DATABASE_URL=… pnpm exec vitest run --project node apps/uw-app tools/infra`; `pnpm exec vitest run --project workers apps/uw-app/auth`) → FAIL.

- [ ] **Step 3: Implement** the files above; mount `meRoutes()` at `/api/me` after `withPrincipal`.

- [ ] **Step 4: Run** the same commands → PASS, with the pg tests reported as run.

- [ ] **Step 5: Verify and commit**

`TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add apps/uw-app tools/infra/wrangler.test.ts
git commit -m "feat(uw-app): sign a person in by email and resolve grants on every request

The Access email maps to a people row: @unfoldingword.org is provisioned active,
anyone else pending with an explicit pending-approval response. Grants are read
from role_grants on every request, live only, never cached. A dev-only principal
works on localhost without Access and nowhere else.

FD-7 FD-8"
```

---

### Task 11: Grant and revoke commands with an audit record

**Proves:** FD-8 (grant and revoke are commands requiring `admin` in the target scope, writing an audit record with actor, time, before and after), FD-11 (the request's trace id reaches the database write), P21 (a pending person is approved by an org admin through the grants command).

**Files:**
- Create: `apps/uw-app/acl/grant-commands.ts`, `apps/uw-app/acl/routes.ts`, `apps/uw-app/http/commands.ts`, `apps/uw-app/http/pg-errors.ts`
- Modify: `apps/uw-app/app.tsx` (mount `aclRoutes()` at `/api/acl`)
- Create: `apps/uw-app/acl/grant-commands.pg.test.ts`, `apps/uw-app/acl/last-org-admin.pg.test.ts`

**Interfaces:**
- Consumes: `can`, `AclResource` (Task 6), `lockPerson`, `activatePerson` (Task 10), `toGrant` (Task 10), `grantRoleCommandSchema`, `revokeRoleCommandSchema` (Task 3), `reply`, `refuse` (Task 9).
- Produces (exact):

```ts
export const owns = ['role_grants', 'grant_audit'] as const;
export type CommandResult = { readonly ok: true } | { readonly ok: false; readonly reason: ErrorReason };
export function scopeResource(scopeKind: Scope, scopeArea: string | null): AclResource;
export function grantRole(db: Database, actor: Principal, command: GrantRoleCommand, traceId: string): Promise<CommandResult>;
export function revokeRole(db: Database, actor: Principal, command: RevokeRoleCommand, traceId: string): Promise<CommandResult>;

export function aclRoutes(): Hono<AppEnv>;

export function readJson(c: Context<AppEnv>): Promise<unknown>;
export function malformed(c: Context<AppEnv>, body: unknown): Response;
export function toOutcome(requestId: string, result: CommandResult): Outcome;

export function pgErrorCode(error: unknown): string | null;
export function pgConstraint(error: unknown): string | null;
```

Routes: `POST /api/acl/commands/:name` with `name` looked up in a `Map` of `grant_role` and `revoke_role`; an unknown name → `refuse(c, 'not_wired')` (404). A body that fails its schema → `malformed(c, body)`: 400 error outcome `malformed_command` echoing `requestId` when the body carries a valid UUID `requestId`, otherwise a 400 `refusalSchema` body. No database handle → `database_not_configured`. A `CommandResult` → `reply(c, toOutcome(requestId, result))`. `pgErrorCode` and `pgConstraint` read `code` and `constraint_name` from the error or, when Drizzle wraps it, from `error.cause`.

`grantRole`, in order:
1. `can(actor, 'admin', scopeResource(command.scopeKind, command.scopeArea))` or `not_permitted`.
2. `expiresAt` not null and not after now → `expiry_in_past`.
3. In one transaction: `lockPerson` or `person_not_found`; a `pending` person needs `can(actor, 'admin', { kind: 'org' })` or `not_permitted`, and is then `activatePerson`ed; any unrevoked grant for the same person, role, scope kind and area whose `expires_at <= now()` is revoked first, with its own `revoke` audit row; insert the grant with `granted_by = actor.personId`; insert the audit row `{ actor: actor.identity, action: 'grant', grantId, before: null, after: auditRow(row), traceId }`.
4. A unique violation (`23505` on `role_grants_one_live`) → `grant_exists`.

`revokeRole`, in one transaction, in order:
1. Lock every live org-admin grant: `SELECT id FROM role_grants WHERE role = 'admin' AND scope_kind = 'org' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY id FOR UPDATE`.
2. Lock the target: `SELECT … FROM role_grants WHERE id = $1 AND revoked_at IS NULL FOR UPDATE`; none → `grant_not_found`.
3. `can(actor, 'admin', scopeResource(grant.scopeKind, grant.scopeArea))` or `not_permitted`.
4. When the target is among the locked org-admin ids and they number exactly one → `last_org_admin`.
5. `UPDATE role_grants SET revoked_at = now() WHERE id = $1 RETURNING *`; audit `{ action: 'revoke', before: auditRow(locked), after: auditRow(updated) }`.

Locking all live org-admin rows in id order before counting is what makes two concurrent revokes of the last two admins serialise: the second transaction waits, then re-reads the rows under READ COMMITTED and sees only one left. `auditRow(row)` is a plain object with snake_case keys `id, person_id, role, scope_kind, scope_area, granted_by, granted_at, expires_at, revoked_at`, instants as `toISOString()` strings or `null`. Keep each exported function under 50 lines by extracting `lockLiveOrgAdmins`, `lockLiveGrant`, `closeExpiredDuplicate` and `writeAudit` as module-private functions.

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/acl/grant-commands.pg.test.ts`, inside `describe.skipIf(!testServer)('FD-8 grant and revoke commands', …)`. Helpers: `as(email)` signs a person token; `command(email, body)` POSTs `body` to `/api/acl/commands/<body.command>` and returns `{ status, body, traceId }`; `personId(email)` signs in once through `/api/me` and returns the id; Ian is the bootstrap org admin. Cases:

| Case | Expect |
|---|---|
| Ian grants `editor` on `80-89` to `e@unfoldingword.org` | 200 `{ status: 'accepted', requestId }`; `e`'s next `/api/me` holds the grant; one new `grant_audit` row with `actor = 'human:00000000-0000-4000-8000-000000000001'`, `action = 'grant'`, `before IS NULL`, `after->>'role' = 'editor'`, `after->>'scope_area' = '80-89'`, and `trace_id` equal to the response's `x-trace-id` |
| `e` (editor on 80-89) grants `viewer` on `80-89` to someone | 403 `not_permitted`, no new audit row |
| Ian grants `admin` on `80-89` to `a@`; `a` grants `viewer` on `80-89` to `v@` | accepted |
| `a` grants `editor` on `20-29`, and `admin` at `org` | 403 `not_permitted` each |
| Ian repeats the `editor` on `80-89` grant to `e` | 409 `grant_exists` |
| an `editor` on `80-89` for `x@` inserted by SQL with `expires_at = now() - interval '1 day'`, then Ian grants the same | accepted; `x` has one live grant; audit shows one `revoke` then one `grant` |
| Ian grants with `expiresAt` one minute in the past | 422 `expiry_in_past` |
| Ian grants to a random UUID | 404 `person_not_found` |
| `pending@gmail.com` signs in (403), `a` (area admin) grants it `viewer` on `80-89` | 403 `not_permitted`, person still pending |
| Ian grants the same | accepted; `people.status` is `active`; `pending@gmail.com`'s next `/api/me` is 200 |
| Ian revokes `e`'s grant | accepted; audit `before->>'revoked_at'` is null and `after->>'revoked_at'` is not; `e`'s next `/api/me` has no grant |
| Ian revokes the same grant again, and a random UUID | 404 `grant_not_found` each |
| Ian revokes the sponsor's org admin (`…0102`), then his own (`…0101`) | first accepted, second 409 `last_org_admin` |
| a service-token principal posts a grant | 403 `not_permitted` |
| body `{ "command": "grant_role" }` | 400 refusal `malformed_command` with no `requestId` |
| a body with a valid `requestId` and `role: 'owner'` | 400 `{ status: 'error', requestId, reason: 'malformed_command' }` |
| `POST /api/acl/commands/approve` | 404 `not_wired` |

Run the "Ian revokes the sponsor's org admin, then his own" case in its own `withAppDatabase` (it removes an org admin the other cases rely on); the rest may share one database in table order.

`apps/uw-app/acl/last-org-admin.pg.test.ts` (review focus 3): in one migrated database, open two separate clients with `createClient(target)` (two connections), build Ian's and the sponsor's principals with `personPrincipal` and their bootstrap grants, and run `Promise.all([revokeRole(dbA, ian, revokeSponsor, traceA), revokeRole(dbB, sponsor, revokeIan, traceB)])` ten times over fresh databases or after re-inserting the revoked grant. Every round: exactly one result is `{ ok: true }` and the other is `{ ok: false, reason: 'last_org_admin' }`, and `SELECT count(*) FROM role_grants WHERE role = 'admin' AND scope_kind = 'org' AND revoked_at IS NULL` is 1.

- [ ] **Step 2: Run and see them fail** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm exec vitest run --project node apps/uw-app/acl` → PASS.
- [ ] **Step 5: Verify and commit**

`TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add apps/uw-app
git commit -m "feat(uw-app): grant and revoke commands with an audit record

POST /api/acl/commands/grant_role and revoke_role require admin in the target
scope, write grant_audit with the actor, time, before and after rows and the
request's trace id, refuse leaving the org without an admin even under a race,
and let an org admin approve a pending person by granting a role.

FD-8 FD-11"
```

---

### Task 12: Pages and page versions

**Proves:** FD-9 (create, read and update handlers validate frontmatter by page type, refuse unknown types, write one version per save with `edit_source`, check `can()` with the page's `jd_area`; no editor UI).

**Files:**
- Create: `apps/uw-app/pages/validate.ts`, `apps/uw-app/pages/validate.test.ts` (Workers pool), `apps/uw-app/pages/store.ts`, `apps/uw-app/pages/routes.ts`, `apps/uw-app/pages/pages.pg.test.ts`
- Modify: `apps/uw-app/app.tsx` (mount `pageRoutes()` at `/api/pages`)

**Interfaces:**
- Consumes: `pageTypeDefinition`, `pageTypeSchema`, `pageSchema`, `createPageCommandSchema`, `updatePageCommandSchema` (Tasks 4, 5); `can`; `readJson`, `malformed`, `reply`, `refuse`, `pgErrorCode`, `pgConstraint` (Task 11).
- Produces (exact):

```ts
export type FrontmatterCheck =
  | { readonly ok: true; readonly type: PageType; readonly frontmatter: Record<string, unknown> }
  | { readonly ok: false; readonly reason: 'unknown_page_type' | 'invalid_frontmatter' };
export function checkFrontmatter(type: string, frontmatter: unknown): FrontmatterCheck;

export const owns = ['pages', 'page_versions'] as const;
export type PageResult = { readonly ok: true; readonly page: Page } | { readonly ok: false; readonly reason: ErrorReason };
export function readPage(db: Executor, actor: Principal, pageId: string): Promise<Page | null>;
export function createPage(db: Database, actor: Principal, command: CreatePageCommand, traceId: string): Promise<PageResult>;
export function updatePage(db: Database, actor: Principal, command: UpdatePageCommand, traceId: string): Promise<PageResult>;

export function pageRoutes(): Hono<AppEnv>;
```

Behaviour, exact:
- `readPage` returns `null` when the page does not exist or `can(actor, 'read', { kind: 'area', area: page.jdArea })` is false. Callers cannot tell the two apart (review focus 5).
- `createPage`: `checkFrontmatter(command.type, command.frontmatter)` first (reason passes through); then `can(actor, 'write', area)` or `not_permitted`; a non-null `parentId` that `readPage` cannot see → `parent_not_found`; in one transaction insert the page at `version = 1` and one `page_versions` snapshot of every column with `edit_source = actor.identity` and `trace_id`; `23505` on `pages_pkey` → `page_exists`, on `pages_slug_per_area` → `slug_taken`.
- `updatePage`: `readPage` or `page_not_found`; `can(actor, 'write', area of the stored page)` or `not_permitted`; `checkFrontmatter(stored.type, command.frontmatter)`; parent check: `parentId === pageId` → `parent_cycle`; a parent `readPage` cannot see → `parent_not_found`; the stored page appears among the new parent's ancestors → `parent_cycle`, using

```sql
WITH RECURSIVE chain(id, parent_id) AS (
  SELECT id, parent_id FROM pages WHERE id = $parentId
  UNION
  SELECT p.id, p.parent_id FROM pages p JOIN chain c ON p.id = c.parent_id
)
SELECT 1 FROM chain WHERE id = $pageId LIMIT 1
```

  then in one transaction `UPDATE pages SET … , version = $expected + 1, updated_at = now() WHERE id = $pageId AND version = $expected RETURNING *`; zero rows → `stale_version`; otherwise one snapshot as on create; `slug_taken` as on create. Type and area never change on update.
- Routes: `POST /api/pages/commands/:name` (`create_page`, `update_page` in a `Map`; unknown → `not_wired`), answering with `reply` and the outcome envelope; `GET /api/pages/:pageId` → 200 `{ page }` (parsed through `pageSchema`) or 404 refusal `page_not_found`, including for a `pageId` that is not a UUID.

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/pages/validate.test.ts`: `checkFrontmatter('policy', {})` → `unknown_page_type`; `checkFrontmatter('constructor', {})` → `unknown_page_type`; a valid persona frontmatter (the object from Task 5's test) → `ok` with `type: 'persona'`; the same with `toolset: ['approve']` → `invalid_frontmatter`; a learning with `confidence: 'certain'` → `invalid_frontmatter`; a skill with an extra key → `invalid_frontmatter` (frontmatter schemas are strict).

`apps/uw-app/pages/pages.pg.test.ts`, inside `describe.skipIf(!testServer)('FD-9 pages and page versions', …)`. Ian grants, through the grants command, `editor` on `80-89` to `ed@`, `viewer` on `80-89` to `vw@`, `editor` on `20-29` to `fin@`, `viewer` on `20-29` to `fv@`. Cases:

| Case | Expect |
|---|---|
| `ed` creates a `persona` page in `80-89` | 200 accepted; `GET` returns `version: 1` and the frontmatter; one `page_versions` row with `version = 1`, `edit_source = 'human:<ed id>'`, `trace_id` = the create response's `x-trace-id` |
| `ed` creates a `skill` and a `learning` page | accepted each |
| `ed` creates type `policy` | 422 `unknown_page_type`, no row |
| `ed` creates a persona with `toolset: ['approve']` | 422 `invalid_frontmatter` |
| `vw` creates in `80-89` | 403 `not_permitted` |
| `ed` creates in `20-29` | 403 `not_permitted` |
| `fin` (editor elsewhere) reads the `80-89` page | 200 |
| `fv` (viewer elsewhere) reads it | 404 `page_not_found` |
| `ed` updates with `expectedVersion: 1` | accepted; `GET` shows `version: 2`; two `page_versions` rows |
| `ed` updates again with `expectedVersion: 1` | 409 `stale_version`; still two snapshots |
| `ed` creates a second page with the first one's slug in `80-89` | 409 `slug_taken` |
| the same slug in `20-29` by `fin` | accepted |
| `ed` creates with an existing `pageId` | 409 `page_exists` |
| `ed` sets a page's `parentId` to itself | 422 `parent_cycle` |
| with `child.parentId = parent`, `ed` sets `parent.parentId = child` | 422 `parent_cycle` |
| `ed` creates with an unknown `parentId` | 422 `parent_not_found` |
| `GET /api/pages/not-a-uuid` | 404 `page_not_found` |
| `POST /api/pages/commands/delete_page` | 404 `not_wired` |

- [ ] **Step 2: Run and see them fail** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Workers and node tests for `apps/uw-app/pages` → PASS.
- [ ] **Step 5: Verify and commit**

`TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add apps/uw-app
git commit -m "feat(uw-app): create, read and update pages with a version per save

Frontmatter is validated by the page-type registry and unknown types refused;
every save writes a full page_versions snapshot with the editor's identity and
trace id; writes check can() on the page's area, a stale version and a parent
cycle are refused, and a page the principal cannot read is not found.

FD-9 FD-11"
```

### Task 13: The uw-ingest Worker: verify, refuse replays, enqueue an envelope

**Proves:** FD-10 (second Hono Worker, not behind Access, own wrangler config and deploy job; signature verified over the raw body; unsigned, badly signed and replayed deliveries refused with a logged refusal and no queue message; a trace id minted; a Zod-validated envelope enqueued), FD-11 (trace id and log line in uw-ingest), P19 (replay detection stores only the delivery id; the ingest identity is `agent:ingest`).

**Files:**
- Modify: `apps/uw-ingest/package.json` (dependencies `hono@^4.13.11`, `@octokit/webhooks-methods@^6.0.0`, `zod@^4.6.5`; devDependencies `wrangler@^4.144.0`, `@cloudflare/workers-types@^5.20260930.1`; scripts `build` and `deploy:staging` mirroring `apps/uw-app` with `../../infra/uw-ingest/wrangler.toml`)
- Create: `apps/uw-ingest/env.ts`, `apps/uw-ingest/app.ts`, `apps/uw-ingest/index.ts`, `apps/uw-ingest/receive.ts`, `apps/uw-ingest/observe.ts`, `apps/uw-ingest/sources/registry.ts`, `apps/uw-ingest/sources/github.ts`, `apps/uw-ingest/deliveries/ledger.ts`
- Create: `apps/uw-ingest/testing/doubles.ts`, `apps/uw-ingest/fixtures/github/pull_request.opened.json`, `apps/uw-ingest/app.test.ts` (Workers pool), `apps/uw-ingest/deliveries/ledger.pg.test.ts`
- Delete: `apps/uw-ingest/database.pg.test.ts` (the Task 1 placeholder; grep for references first)
- Create: `infra/uw-ingest/wrangler.toml`; Modify: `infra/README.md` (uw-ingest section) — shared root `infra/`, own commit
- Modify: `.github/workflows/deploy-staging.yml`, `.github/workflows/deploy-production.yml` (ingest deploy jobs) — shared root, own commit
- Modify: `tools/ci/workflow-trust.test.ts` (the checkout map for the two deploy workflows), in the workflow commit
- Modify: `docs/exceptions.md` (the webhook route entry), in the feature commit

**Interfaces:**
- Consumes: `ingestEnvelopeSchema`, `ingestRefusalSchema`, `ingestResponseSchema`, `INGEST_PAYLOAD_LIMIT_BYTES`, `IngestSource` (Task 5); `ingestPrincipal` (Task 6); `createLogger`, `TRACE_HEADER` (Task 8); `webhookDeliveries` (Task 7).
- Produces (exact):

```ts
export type IngestBindings = {
  COMMIT_SHA?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  HYPERDRIVE?: { readonly connectionString: string };
  INGEST_QUEUE?: { send(body: IngestEnvelope): Promise<void> };
};

export type VerifiedDelivery = { readonly deliveryId: string; readonly event: string };
export type WebhookSource = {
  secret(env: IngestBindings): string | undefined;
  verify(headers: Headers, rawBody: string, secret: string): Promise<VerifiedDelivery | IngestRefusal>;
};
export const webhookSources: ReadonlyMap<string, WebhookSource>;

export const owns = ['webhook_deliveries'] as const;
export type DeliveryLedger = {
  claim(source: IngestSource, deliveryId: string): Promise<boolean>;
  release(source: IngestSource, deliveryId: string): Promise<void>;
};
export type LedgerHandle = { readonly ledger: DeliveryLedger; release(): Promise<void> };
export function postgresLedger(db: Database): DeliveryLedger;
export function hyperdriveLedger(env: IngestBindings): LedgerHandle | null;

export type IngestDeps = {
  readonly openLedger: (env: IngestBindings) => LedgerHandle | null;
  readonly newId: () => string;
  readonly now: () => Date;
  readonly sink: LogSink;
};
export const platformIngestDeps: IngestDeps;
export type IngestEnv = {
  Bindings: IngestBindings;
  Variables: { traceId: string; logger: Logger; outcome: string | null };
};
export function createIngestApp(deps?: IngestDeps): Hono<IngestEnv>;
```

Routes: `GET /health` → `healthReportSchema`-shaped `{ status: 'ok', commit, indicators: [{ name: 'commit', status: 'ok', detail: commit }] }`. `POST /webhooks/:source` → 202 `{ status: 'accepted' }` or a refusal `{ status: 'error', reason }` from `ingestRefusalSchema`, with status from a `Map`: `unknown_source` 404; `unsigned`, `bad_signature` 401; `malformed_delivery`, `malformed_payload` 400; `replayed` 409; `source_not_configured`, `replay_store_not_configured`, `queue_not_configured`, `enqueue_failed` 503. Every response carries `x-trace-id`; every request writes one log line (`route` `POST /webhooks/:source`, `principal` `agent:ingest`, `outcome` `accepted` or the refusal reason, refusals at `warn`); no line ever contains the body.

`receive` runs these checks in this order, stopping at the first refusal, and writes nothing and enqueues nothing before step 8:

1. Source in `webhookSources`, else `unknown_source`.
2. `source.secret(env)` present, else `source_not_configured`.
3. `rawBody = await c.req.text()`; `source.verify(headers, rawBody, secret)`; a refusal passes through (`unsigned`, `bad_signature`, `malformed_delivery`).
4. `JSON.parse(rawBody)` inside `try`, else `malformed_payload`.
5. `openLedger(env)`, else `replay_store_not_configured`.
6. `env.INGEST_QUEUE`, else `queue_not_configured`.
7. Build the envelope: `{ envelopeVersion: 1, traceId, source, deliveryId, event, receivedAt: now().toISOString(), principal: ingestPrincipal(), payload, payloadTruncated }` where `payloadTruncated = new TextEncoder().encode(rawBody).byteLength > INGEST_PAYLOAD_LIMIT_BYTES` and `payload` is `null` when truncated; `ingestEnvelopeSchema.parse` it.
8. `ledger.claim(source, deliveryId)`; `false` → `replayed`.
9. `queue.send(envelope)`; on a throw, `ledger.release(source, deliveryId)` and refuse `enqueue_failed`.

`github.verify` reads `x-hub-signature-256` (absent → `unsigned`), checks it with `verify(secret, rawBody, signature)` from `@octokit/webhooks-methods` (false or a throw → `bad_signature`), then requires `x-github-delivery` and `x-github-event` (absent → `malformed_delivery`). `postgresLedger.claim` is `INSERT … ON CONFLICT DO NOTHING RETURNING delivery_id` and returns whether a row came back; `release` deletes that one row. `apps/uw-ingest/observe.ts` is uw-ingest's own copy of the trace-and-log middleware (the two Workers are separate composition roots and share only `packages/core`).

`infra/uw-ingest/wrangler.toml`:

```toml
name = "uw-ingest"
main = "../../apps/uw-ingest/index.ts"
compatibility_date = "2026-09-01"
compatibility_flags = ["nodejs_compat"]
workers_dev = false

[vars]
COMMIT_SHA = "unknown"

[env.staging]
name = "uw-ingest-staging"
workers_dev = true

[env.staging.vars]
COMMIT_SHA = "unknown"

[env.production]
name = "uw-ingest"
workers_dev = false

[env.production.vars]
COMMIT_SHA = "unknown"
```

No queue or Hyperdrive binding goes here until the resource exists (FD-12; Task 16 writes them in `wrangler.go-live.toml`). `GITHUB_WEBHOOK_SECRET` is a Worker secret set with `wrangler secret put --env <name>`, never in the file.

`apps/uw-ingest/testing/doubles.ts` holds `recordingQueue()` (`{ sent: IngestEnvelope[]; send; failNext(): void }`) and `memoryLedger()` (a `Set` of `source:deliveryId` keys implementing `DeliveryLedger`). They stand in for the two bindings in the Workers-pool route tests; `postgresLedger` itself is proven against real Postgres in `ledger.pg.test.ts`.

- [ ] **Step 1: Write the failing tests**

`apps/uw-ingest/app.test.ts` (Workers pool). Signs with `sign('fixture-webhook-secret', body)` from `@octokit/webhooks-methods`; posts to `/webhooks/github` with headers `x-hub-signature-256`, `x-github-delivery: d-<n>`, `x-github-event: pull_request`; env `{ GITHUB_WEBHOOK_SECRET: 'fixture-webhook-secret', INGEST_QUEUE: queue, COMMIT_SHA: 'abc1234' }`; deps `{ openLedger: () => ({ ledger, release: async () => undefined }), newId: () => crypto.randomUUID(), now: () => new Date('2026-10-01T12:00:00.000Z'), sink }`. The body is the fixture `pull_request.opened.json` (a small hand-written `{"action":"opened","number":1,"pull_request":{"number":1,"head":{"sha":"0123456789abcdef0123456789abcdef01234567"}}}`).

| Case | Expect |
|---|---|
| a correctly signed delivery | 202 `{ status: 'accepted' }`; `queue.sent` has one envelope that parses with `ingestEnvelopeSchema`, with `deliveryId: 'd-1'`, `event: 'pull_request'`, `principal.identity: 'agent:ingest'`, `payloadTruncated: false`, `receivedAt: '2026-10-01T12:00:00.000Z'`; its `traceId` equals the `x-trace-id` header and the log line's `trace_id` |
| no signature header | 401 `unsigned`; queue empty; ledger empty; one `warn` line with `outcome: 'unsigned'` |
| a signature made with another secret | 401 `bad_signature`; queue empty |
| the body changed by one byte after signing | 401 `bad_signature` |
| the same delivery id twice | first 202, second 409 `replayed`; queue holds one envelope |
| `POST /webhooks/stripe` | 404 `unknown_source` |
| no `GITHUB_WEBHOOK_SECRET` | 503 `source_not_configured` |
| no ledger (`openLedger: () => null`) | 503 `replay_store_not_configured` |
| no `INGEST_QUEUE` | 503 `queue_not_configured`, and the ledger holds nothing |
| signed body `not json` | 400 `malformed_payload` |
| signed, no `x-github-delivery` | 400 `malformed_delivery` |
| a signed body of 130 000 bytes (a JSON object with one long string) | 202; envelope `payload: null`, `payloadTruncated: true` (review focus 1) |
| `queue.failNext()` then a delivery, then the same delivery again | first 503 `enqueue_failed` and the ledger no longer holds the id; second 202 with one envelope (review focus 2) |
| `GET /health` | 200 with `commit: 'abc1234'` |
| any of the above | no log line contains the raw body text |

`apps/uw-ingest/deliveries/ledger.pg.test.ts`: inside `describe.skipIf(!testServer)('FD-10 the delivery ledger on real Postgres', …)` with `withMigratedDatabase`: `claim('github', 'd-1')` → `true`; again → `false`; `release` then `claim` → `true`; and one end-to-end case through `createIngestApp` with `openLedger` returning `postgresLedger(db)`: a signed delivery is 202, its replay 409, and `SELECT count(*) FROM webhook_deliveries` is 1 with only `source`, `delivery_id`, `received_at` columns.

- [ ] **Step 2: Run and see them fail** → FAIL.

- [ ] **Step 3: Implement the Worker.** `index.ts` is `export default createIngestApp();`. `hyperdriveLedger(env)` mirrors uw-app's `hyperdriveDatabase`: `null` without `env.HYPERDRIVE`, otherwise a client per request whose `release` ends it.

Add this row to `docs/exceptions.md`, dated 2026-10-01: rule "Section 10: no route without `can()`"; file `apps/uw-ingest/app.ts` (`POST /webhooks/:source`, `GET /health`); why: uw-ingest is not behind Access by design (plan §1) and a webhook has no principal to check; each source authenticates by its signature over the raw body, the route writes only `webhook_deliveries` and the queue, and the envelope carries `agent:ingest` (P19) so every downstream write is checked against that identity; review: when a second source (Stripe) is added, its verifier ships with its own signature tests.

- [ ] **Step 4: Run** `pnpm exec vitest run --project workers apps/uw-ingest` and `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm exec vitest run --project node apps/uw-ingest` → PASS. Run `pnpm build`: both Workers dry-run bundle.

- [ ] **Step 5: Add the wrangler config and the deploy jobs**

Append to `.github/workflows/deploy-staging.yml` a job with the same guard as `deploy-staging` (copy its `if:` exactly):

```yaml
  deploy-ingest-staging:
    name: deploy-ingest-staging
    if: >-
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.event == 'push' &&
      github.event.workflow_run.head_branch == 'main'
    runs-on: ubuntu-latest
    env:
      SHA: ${{ github.event.workflow_run.head_sha }}
      INGEST_URL: https://uw-ingest-staging.unfoldingword.workers.dev
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
      - uses: ./.github/actions/setup
      - name: Deploy uw-ingest to staging
        working-directory: apps/uw-ingest
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: >-
          pnpm exec wrangler deploy --config ../../infra/uw-ingest/wrangler.toml --env staging
          --var "COMMIT_SHA:$SHA"
      - name: Confirm /health reports the deployed commit
        run: bash .github/scripts/await-health.sh "$INGEST_URL" "$SHA"
```

Append to `.github/workflows/deploy-production.yml`:

```yaml
  deploy-ingest-production:
    name: deploy-ingest-production
    needs: [production-gate]
    runs-on: ubuntu-latest
    env:
      SHA: ${{ github.sha }}
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - name: Deploy uw-ingest to production
        working-directory: apps/uw-ingest
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: >-
          pnpm exec wrangler deploy --config ../../infra/uw-ingest/wrangler.toml --env production
          --var "COMMIT_SHA:$SHA"
```

In `tools/ci/workflow-trust.test.ts` set `'deploy-production.yml': [null, null, null]` and `'deploy-staging.yml': [workflowRunHead, workflowRunHead]`. The existing staging-guard test then checks the new job's guard too.

Add an "uw-ingest" section to `infra/README.md`: the two environments (`uw-ingest-staging` on workers.dev, `uw-ingest` with no route yet), not behind Access, deployed by `deploy-ingest-staging` and `deploy-ingest-production`, the `GITHUB_WEBHOOK_SECRET` Worker secret, and that its queue and Hyperdrive bindings are in `wrangler.go-live.toml` until the resources exist.

- [ ] **Step 6: Verify and commit (three commits)**

`TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add infra/uw-ingest/wrangler.toml infra/README.md
git commit -m "feat(infra): wrangler config for uw-ingest, staging and production

Shared root infra/: uw-ingest is its own Worker, not behind Access, with no queue
or Hyperdrive binding until those resources exist.

FD-10"
git add .github/workflows/deploy-staging.yml .github/workflows/deploy-production.yml tools/ci/workflow-trust.test.ts
git commit -m "ci: deploy uw-ingest to staging after green CI on main and to production on a tag

Shared root .github/workflows/: deploy-ingest-staging carries the staging guard
and the health check; deploy-ingest-production waits on the production gate.

FD-10"
git add apps/uw-ingest docs/exceptions.md pnpm-lock.yaml
git commit -m "feat(uw-ingest): verify webhook signatures, refuse replays, enqueue an envelope

POST /webhooks/:source verifies the source's signature over the raw body, refuses
unsigned, badly signed and replayed deliveries with a logged closed reason and no
queue message, records only the delivery id, mints a trace id, and enqueues a
Zod-validated envelope carrying agent:ingest. Oversized payloads are truncated.

FD-10 FD-11"
```

---

### Task 14: The queue consumer in uw-app, with a dead-letter queue and duplicate tolerance

**Proves:** FD-10 (uw-app consumes the queue, sends a malformed message to a declared dead-letter queue, tolerates duplicates), FD-11 (the envelope's trace id is on every consumer log line; consumer lag is recorded for `/health`, P18).

**Files:**
- Create: `apps/uw-app/queue/consumer.ts`, `apps/uw-app/queue/watermarks.ts`, `apps/uw-app/queue/worker.ts`
- Modify: `apps/uw-app/index.ts`
- Create: `apps/uw-app/queue/consumer.test.ts` (Workers pool), `apps/uw-app/queue/watermarks.pg.test.ts`, `apps/uw-app/index.test.ts` (Workers pool)

**Interfaces:**
- Consumes: `ingestEnvelopeSchema`, `IngestEnvelope`, `IngestSource` (Task 5); `createLogger`, `Logger`, `LogSink` (Task 8); `queueWatermarks` (Task 7); `QueueProducer`, `Bindings`, `commitOf` (Task 8); `hyperdriveDatabase` (Task 8).
- Produces (exact):

```ts
export const INGEST_QUEUE_KEY = 'ingest';
export type ConsumerMessage = {
  readonly body: unknown;
  readonly timestamp: Date;
  ack(): void;
  retry(): void;
};
export type IngestHandler = (envelope: IngestEnvelope, logger: Logger) => Promise<void>;
export type Watermarks = { record(queue: string, enqueuedAt: Date, consumedAt: Date): Promise<void> };
export type ConsumerDeps = {
  readonly handlers: ReadonlyMap<IngestSource, IngestHandler>;
  readonly deadLetter: QueueProducer<unknown> | null;
  readonly watermarks: Watermarks | null;
  readonly sink: LogSink;
  readonly commit: string;
  readonly newId: () => string;
  readonly now: () => Date;
};
export const ingestHandlers: ReadonlyMap<IngestSource, IngestHandler>;
export function consumeBatch(messages: readonly ConsumerMessage[], deps: ConsumerDeps): Promise<void>;

export const owns = ['queue_watermarks'] as const;
export type Watermark = { readonly lastEnqueuedAt: Date; readonly lastConsumedAt: Date };
export function postgresWatermarks(db: Database): Watermarks;
export function readWatermark(db: Executor, queue: string): Promise<Watermark | null>;

export function consumeIngestBatch(batch: MessageBatch<unknown>, env: Bindings): Promise<void>;
```

`consumeBatch`, per message in order:
1. `ingestEnvelopeSchema.safeParse(body)` fails → with `deadLetter`: `await deadLetter.send({ reason: 'malformed_envelope', body })`, `ack()`, log `warn` `outcome: 'malformed_envelope'` under a fresh trace id; without `deadLetter`: `retry()` and log `error` with the same outcome (the queue's own `dead_letter_queue` takes it after `max_retries`).
2. A `source:deliveryId` already seen in this batch → `ack()`, log `outcome: 'duplicate'`.
3. No handler for the source → treat as step 1.
4. `await handler(envelope, logger)` → `ack()`; a throw → `retry()`, log `error` `outcome: 'handler_failed'`.

The logger for steps 2 to 4 is `createLogger({ traceId: envelope.traceId, commit, route: 'queue ingest', principal: envelope.principal.identity }, sink)`. After the loop, when `watermarks` is set and the batch is non-empty, `record(INGEST_QUEUE_KEY, latest message timestamp, now())`; a watermark failure is logged `warn` `outcome: 'watermark_failed'` and never fails the batch. Across batches, duplicates are the handler's to tolerate: every handler must be idempotent on `(source, deliveryId)`. The v1 `github` handler logs `info` `'github delivery received'` with `outcome: 'not_wired'`, `event` and `delivery_id`; GH-2 replaces it with the read-model writer.

`postgresWatermarks.record` is `INSERT … ON CONFLICT (queue) DO UPDATE SET last_enqueued_at = greatest(queue_watermarks.last_enqueued_at, excluded.last_enqueued_at), last_consumed_at = excluded.last_consumed_at`. `queue/worker.ts` (Workers types; not imported by node tests) adapts `batch.messages` and builds `ConsumerDeps` from `env` (`deadLetter: env.INGEST_DLQ ?? null`, watermarks from `hyperdriveDatabase(env)`, released in `finally`). `index.ts`:

```ts
import { createApp } from './app.tsx';
import type { Bindings } from './env.ts';
import { consumeIngestBatch } from './queue/worker.ts';

const app = createApp();

export default {
  fetch: app.fetch,
  queue: consumeIngestBatch,
} satisfies ExportedHandler<Bindings>;
```

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/queue/consumer.test.ts` with a `fakeMessage(body, timestamp)` that records `acked` and `retried`, a recording dead-letter producer, a recording handler map, and a valid envelope built from the Task 5 fixture `ingest-envelope/valid` shape:

| Case | Expect |
|---|---|
| one valid envelope | handler called once with it; message acked; a log line has `trace_id` equal to the envelope's `traceId` and `principal: 'agent:ingest'` |
| `{ "not": "an envelope" }` with a dead-letter producer | dead-letter received `{ reason: 'malformed_envelope', body }`; acked; not retried; handler not called |
| the same without a dead-letter producer | retried; not acked |
| two messages with the same source and delivery id in one batch | handler called once; both acked; a line with `outcome: 'duplicate'` |
| the handler throws | retried; not acked; a line with `outcome: 'handler_failed'` |
| a batch of three with timestamps t1 < t3 < t2 | `watermarks.record('ingest', t2, now)` called once |
| the watermark recorder throws | every message still acked; a line with `outcome: 'watermark_failed'` |

`apps/uw-app/index.test.ts`: the default export has a `fetch` and a `queue` function.

`apps/uw-app/queue/watermarks.pg.test.ts`: record twice with a later then an earlier enqueue time → `readWatermark` returns the later enqueue time and the second consume time; one row.

- [ ] **Step 2: Run and see them fail** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Workers and node tests for `apps/uw-app/queue` and `apps/uw-app/index.test.ts` → PASS; `pnpm build` bundles the `queue` export.
- [ ] **Step 5: Verify and commit**

`TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add apps/uw-app
git commit -m "feat(uw-app): consume the ingest queue with a dead-letter queue

The consumer validates each envelope, sends a malformed one to the dead-letter
queue, acks duplicates within a batch, retries a failed handler, logs under the
envelope's trace id, and records consumer lag for /health.

FD-10 FD-11"
```

---

### Task 15: `/health` with named indicators, and log shipping declared

**Proves:** FD-11 (`/health` returns JSON with a named list of indicators and an overall status and renders a screen: deployed commit, database reachability, queue depth; an unreachable database turns its indicator amber or red and never errors the route; log shipping and 30-day retention declared in `infra/`), FD-12 (without a database binding `/health` reports the database indicator as `not_configured`).

**Files:**
- Create: `apps/uw-app/health/indicators.ts`, `apps/uw-app/health/routes.tsx`, `apps/uw-app/health/health.test.ts` (Workers pool), `apps/uw-app/health/health.pg.test.ts`
- Modify: `apps/uw-app/app.tsx` (replace the inline `/health` with `healthRoutes(deps)`), `apps/uw-app/app.test.ts` (health shape)
- Create: `infra/logs/logpush-workers.json`, `infra/logs/r2-lifecycle.json`; Modify: `infra/uw-app/wrangler.toml`, `infra/uw-ingest/wrangler.toml` (`[observability]`), `infra/README.md` (log section) — shared root `infra/`, own commit
- Create: `tools/infra/logs.test.ts`

**Interfaces:**
- Consumes: `HealthIndicator`, `HealthReport`, `OverallStatus`, `healthReportSchema` (Task 3); `DatabaseHandle` (Task 8); `readWatermark`, `INGEST_QUEUE_KEY` (Task 14).
- Produces (exact):

```ts
export const DATABASE_AMBER_MS = 500;
export const DATABASE_TIMEOUT_MS = 2000;
export const QUEUE_AMBER_SECONDS = 60;
export const QUEUE_RED_SECONDS = 300;
export function commitIndicator(commit: string): HealthIndicator;
export function databaseIndicator(handle: DatabaseHandle | null, clock: () => number): Promise<HealthIndicator>;
export function queueIndicator(env: Bindings, handle: DatabaseHandle | null): Promise<HealthIndicator>;
export function overallStatus(indicators: readonly HealthIndicator[]): OverallStatus;
export function healthReport(env: Bindings, handle: DatabaseHandle | null, clock: () => number): Promise<HealthReport>;
export function healthRoutes(deps: AppDeps): Hono<AppEnv>;
```

Indicators, in this order, exactly:
- `commit`: `ok`, detail the full commit or `unknown`.
- `database`: no handle → `not_configured`, `no Hyperdrive binding`; `SELECT 1` within `DATABASE_TIMEOUT_MS` (a `Promise.race` with a timer that is cleared) in under `DATABASE_AMBER_MS` → `ok`, `reachable in <n> ms`; slower → `amber`; a throw or the timeout → `red`, `unreachable`.
- `queue`: no `INGEST_DLQ` binding or no handle → `not_configured`, `no queue binding`; no watermark row → `ok`, `no messages consumed yet`; lag = `(lastConsumedAt − lastEnqueuedAt)` in whole seconds: under `QUEUE_AMBER_SECONDS` `ok`, under `QUEUE_RED_SECONDS` `amber`, else `red`, detail `consumer lag <n> s`; a read failure → `red`, `watermark unreadable`.

`overallStatus` is `red` if any indicator is `red`, else `amber` if any is `amber`, else `ok`; `not_configured` and `not_wired` count as neither. `healthReport` never throws (each indicator catches its own failure). `GET /health` answers `c.json(report)` with 200 always, unless the `accept` header includes `text/html`, in which case it renders, with Hono JSX and no inline colour or hex value:

```tsx
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>unfoldingWord health</title>
  </head>
  <body>
    <main>
      <h1>Health</h1>
      <p>Overall status: {report.status}</p>
      <ul>
        {report.indicators.map((indicator) => (
          <li>
            <strong>{indicator.name}</strong> {indicator.status}: {indicator.detail}
          </li>
        ))}
      </ul>
    </main>
  </body>
</html>
```

The screen is restyled on the tokens in WB-10; this task proves the content. The JSON keeps a top-level `"commit":"<sha>"` because `.github/scripts/await-health.sh` greps for it.

`infra/logs/logpush-workers.json`:

```json
{
  "name": "uw-workers-logs",
  "dataset": "workers_trace_events",
  "destination_conf": "r2://uw-logs/{DATE}?account-id=${CLOUDFLARE_ACCOUNT_ID}&access-key-id=${R2_ACCESS_KEY_ID}&secret-access-key=${R2_SECRET_ACCESS_KEY}",
  "output_options": {
    "field_names": ["EventTimestampMs", "Outcome", "ScriptName", "Logs", "Exceptions"],
    "timestamp_format": "rfc3339"
  },
  "enabled": true
}
```

`infra/logs/r2-lifecycle.json`:

```json
{
  "rules": [
    {
      "id": "expire-after-30-days",
      "enabled": true,
      "conditions": { "prefix": "" },
      "deleteObjectsTransition": { "condition": { "type": "Age", "maxAge": 2592000 } }
    }
  ]
}
```

Both wrangler files gain three tables, because wrangler does not carry top-level observability into environments: one after the top-level keys, and one under each environment's block:

```toml
[observability]
enabled = true

[env.staging.observability]
enabled = true

[env.production.observability]
enabled = true
```

`logpush = true` is not added here: Workers Logpush needs the paid plan and the job above, so it goes in `wrangler.go-live.toml` (Task 16). `infra/README.md` gains a "Logs (FD-11)" section: Workers Logs is on for both Workers; 30-day retention is the R2 bucket `uw-logs` with the lifecycle rule above, fed by the Logpush job; a person creates the bucket, applies `r2-lifecycle.json` with `PUT /accounts/{account_id}/r2/buckets/uw-logs/lifecycle`, substitutes the three `${…}` placeholders from the shell with `envsubst` and posts `logpush-workers.json` to `POST /accounts/{account_id}/logpush/jobs`; nothing in the files is a secret.

- [ ] **Step 1: Write the failing tests**

`apps/uw-app/health/health.test.ts` (Workers pool, `createApp` with `recordingDeps`):

| Case | Expect |
|---|---|
| no database, no queue, `COMMIT_SHA` set | 200; body parses with `healthReportSchema`; `status: 'ok'`; indicators by name: `commit` `ok`, `database` `not_configured`, `queue` `not_configured`; raw text contains `"commit":"<sha>"` |
| `openDatabase` returns a handle whose `db.execute` rejects | 200; `database` `red`; overall `red`; body has no exception text |
| `openDatabase` returns a handle whose `db.execute` never settles | 200 within `DATABASE_TIMEOUT_MS` plus a margin; `database` `red` |
| `accept: text/html` | 200 `text/html`; contains `<h1>Health</h1>`, `database` and `not_configured` |
| `overallStatus` over `[ok, not_configured, amber]` and `[ok, red, amber]` and `[not_wired]` | `amber`, `red`, `ok` |

Build the failing handles with a small object `{ db: { execute: () => Promise.reject(new Error('down')) }, release: async () => undefined }` and type it through a `satisfies Pick<DatabaseHandle, 'release'>` plus a narrow `HealthDatabase = { execute(query: SQL): Promise<unknown> }` that `databaseIndicator` accepts instead of the full `Database`; `DatabaseHandle['db']` satisfies it.

`apps/uw-app/health/health.pg.test.ts` with a real migrated database: `database` is `ok` with a detail matching `/^reachable in \d+ ms$/`; with `INGEST_DLQ` set and no watermark row, `queue` is `ok` `no messages consumed yet`; after `record('ingest', t, t + 120 s)` `queue` is `amber`; after `record('ingest', t, t + 400 s)` it is `red` and overall `red`; with lag 10 s it is `ok`.

`tools/infra/logs.test.ts`: the lifecycle `maxAge` is `2592000` (30 days) and its prefix covers everything; the Logpush dataset is `workers_trace_events` into `r2://uw-logs/`; every credential in `destination_conf` is a `${…}` placeholder; both wrangler files enable observability at the top level and in `staging` and `production` (parse with `smol-toml`).

- [ ] **Step 2: Run and see them fail** → FAIL.
- [ ] **Step 3: Implement** the indicators and route, and the infra files.
- [ ] **Step 4: Run** the Workers, node and tools tests above → PASS.
- [ ] **Step 5: Verify and commit (infra in its own commit)**

`TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add infra/logs infra/uw-app/wrangler.toml infra/uw-ingest/wrangler.toml infra/README.md tools/infra/logs.test.ts
git commit -m "feat(infra): Workers Logs on, and 30-day log retention declared

Shared root infra/: observability enabled for uw-app and uw-ingest in every
environment; a Logpush job into the uw-logs R2 bucket and a 30-day lifecycle
rule, applied by a person and awaiting go-live.

FD-11"
git add apps/uw-app
git commit -m "feat(uw-app): /health with named indicators and an overall status

Commit, database reachability and queue consumer lag, as JSON or a screen. A
database that is slow turns amber, one that is down or silent turns red, and
the route always answers; with no binding the database is not configured.

FD-11 FD-12"
```

---

### Task 16: The go-live wiring, written and switched off

**Proves:** FD-12 (a CI job that creates a Neon branch per PR and drops it; a migrate-staging job on merge to `main` after CI is green; a migrate-production job on a tagged release; the Hyperdrive binding for staging and production; each job skips cleanly and stays green while its secret is absent; a binding is added to a wrangler file only when its resource exists; a test asserts each job skips when its secret is absent), and the go-live half of FD-7 and FD-10 (Access variables and queue bindings).

**Files:**
- Create: `.github/scripts/secret-gate.sh`
- Create: `.github/workflows/neon-pr.yml`; Modify: `.github/workflows/cleanup-pr.yml`, `.github/workflows/deploy-staging.yml`, `.github/workflows/deploy-production.yml` — shared root, one commit
- Create: `infra/uw-app/wrangler.go-live.toml`, `infra/uw-ingest/wrangler.go-live.toml`; Modify: `infra/README.md` ("Switching on the go-live wiring") — shared root, one commit
- Modify: `packages/db/bin/migrate.ts` (optional folder argument)
- Create: `tools/ci/go-live.test.ts`, `tools/infra/go-live.test.ts`
- Modify: `tools/ci/workflow-trust.test.ts`

**Interfaces:**
- Produces: secrets and variables a person adds at go-live, by exact name: secret `NEON_API_KEY`, variable `NEON_PROJECT_ID`, secret `NEON_DIRECT_URL_STAGING`, secret `NEON_DIRECT_URL_PRODUCTION`. Queues `uw-ingest-events-staging`, `uw-ingest-events-staging-dlq`, `uw-ingest-events-production`, `uw-ingest-events-production-dlq`. Bindings `HYPERDRIVE` (both Workers), `INGEST_QUEUE` (uw-ingest producer), `INGEST_DLQ` (uw-app producer), and uw-app's consumer of the events queue with `max_retries = 3` and `dead_letter_queue` set.
- Produces: `node packages/db/bin/migrate.ts [migrationsFolder]` (no argument keeps today's behaviour).

`.github/scripts/secret-gate.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

name="$1"
value="${!name:-}"

if [[ -n "$value" ]]; then
  echo "configured=true" >> "$GITHUB_OUTPUT"
else
  echo "configured=false" >> "$GITHUB_OUTPUT"
  echo "::notice::$name is not set, so this job skips its go-live steps and stays green."
fi
```

Every go-live job has this shape: its trusted checkout first, then a step `id: gate` that runs `bash .github/scripts/secret-gate.sh <NAME>` with the secret in that step's `env`, then every later step guarded by `if: steps.gate.outputs.configured == 'true'`. No job-level `if` reads a secret.

`.github/workflows/neon-pr.yml`:

```yaml
name: Neon PR Branch

on:
  workflow_run:
    workflows: [CI]
    types: [completed]

concurrency:
  group: neon-pr-${{ github.event.workflow_run.head_branch }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  neon-branch:
    name: neon-branch
    if: >-
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.event == 'pull_request' &&
      github.event.workflow_run.head_repository.full_name == github.repository &&
      github.event.workflow_run.pull_requests[0] != null
    runs-on: ubuntu-latest
    env:
      BRANCH: pr-${{ github.event.workflow_run.pull_requests[0].number }}
    steps:
      - uses: actions/checkout@v4
      - name: Skip unless the Neon API key is set
        id: gate
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
        run: bash .github/scripts/secret-gate.sh NEON_API_KEY
      - name: Check out the PR's migrations as data, beside main's tooling
        if: steps.gate.outputs.configured == 'true'
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
          path: pr
          persist-credentials: false
      - if: steps.gate.outputs.configured == 'true'
        uses: ./.github/actions/setup
      - name: Create or reuse the PR's Neon branch
        id: branch
        if: steps.gate.outputs.configured == 'true'
        uses: neondatabase/create-branch-action@v6
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          branch_name: ${{ env.BRANCH }}
          api_key: ${{ secrets.NEON_API_KEY }}
      - name: Apply the PR's migrations with main's runner
        if: steps.gate.outputs.configured == 'true'
        env:
          DATABASE_URL: ${{ steps.branch.outputs.db_url }}
        run: node packages/db/bin/migrate.ts "$GITHUB_WORKSPACE/pr/packages/db/migrations"
      - name: Re-apply them, which must be a no-op
        if: steps.gate.outputs.configured == 'true'
        env:
          DATABASE_URL: ${{ steps.branch.outputs.db_url }}
        run: node packages/db/bin/migrate.ts "$GITHUB_WORKSPACE/pr/packages/db/migrations"
```

Only main's code runs with the secret; the PR's SQL files are read as data and touch only the PR's own Neon branch (P33).

`cleanup-pr.yml` gains:

```yaml
  drop-neon-branch:
    name: drop-neon-branch
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.repository.default_branch }}
      - name: Skip unless the Neon API key is set
        id: gate
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
        run: bash .github/scripts/secret-gate.sh NEON_API_KEY
      - name: Drop the PR's Neon branch, if one was made
        if: steps.gate.outputs.configured == 'true'
        continue-on-error: true
        uses: neondatabase/delete-branch-action@v3
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          branch: pr-${{ github.event.pull_request.number }}
          api_key: ${{ secrets.NEON_API_KEY }}
```

(`continue-on-error` because a PR whose CI never went green never got a branch; the step's failure shows in the log and the job stays green.)

`deploy-staging.yml` gains a first job, and both deploy jobs gain `needs: [migrate-staging]`:

```yaml
  migrate-staging:
    name: migrate-staging
    if: >-
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.event == 'push' &&
      github.event.workflow_run.head_branch == 'main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
      - name: Skip unless the staging direct connection is set
        id: gate
        env:
          NEON_DIRECT_URL_STAGING: ${{ secrets.NEON_DIRECT_URL_STAGING }}
        run: bash .github/scripts/secret-gate.sh NEON_DIRECT_URL_STAGING
      - if: steps.gate.outputs.configured == 'true'
        uses: ./.github/actions/setup
      - name: Apply migrations to staging
        if: steps.gate.outputs.configured == 'true'
        env:
          DATABASE_URL: ${{ secrets.NEON_DIRECT_URL_STAGING }}
        run: pnpm db:migrate
```

`deploy-production.yml` gains the same job as `migrate-production` with `needs: [production-gate]`, a plain `actions/checkout@v4` (no `ref`), `NEON_DIRECT_URL_PRODUCTION`, and step name `Apply migrations to production`; `deploy-production` and `deploy-ingest-production` become `needs: [production-gate, migrate-production]`.

`tools/ci/workflow-trust.test.ts`: `'cleanup-pr.yml': [defaultBranch, defaultBranch]`, `'deploy-production.yml': [null, null, null, null]`, `'deploy-staging.yml': [workflowRunHead, workflowRunHead, workflowRunHead]`, and a new entry `'neon-pr.yml': [null, workflowRunHead]`. The staging-guard test now covers `migrate-staging` too.

`packages/db/bin/migrate.ts`: `await applyMigrations(target, process.argv[2] ?? migrationsFolder);` with `migrationsFolder` imported from `../migrate.ts`.

`infra/uw-app/wrangler.go-live.toml` is `infra/uw-app/wrangler.toml` exactly, plus, in each of `staging` and `production` (shown for staging):

```toml
[env.staging]
name = "uw-app-staging"
workers_dev = true
logpush = true

[env.staging.vars]
COMMIT_SHA = "unknown"
ACCESS_TEAM_DOMAIN = "https://set-at-go-live.cloudflareaccess.com"
ACCESS_AUD = "set-at-go-live"

[[env.staging.hyperdrive]]
binding = "HYPERDRIVE"
id = "set-at-go-live"

[[env.staging.queues.consumers]]
queue = "uw-ingest-events-staging"
max_retries = 3
dead_letter_queue = "uw-ingest-events-staging-dlq"

[[env.staging.queues.producers]]
binding = "INGEST_DLQ"
queue = "uw-ingest-events-staging-dlq"
```

`infra/uw-ingest/wrangler.go-live.toml` is `infra/uw-ingest/wrangler.toml` plus, per environment, `logpush = true`, the same `[[env.<name>.hyperdrive]]` block, and:

```toml
[[env.staging.queues.producers]]
binding = "INGEST_QUEUE"
queue = "uw-ingest-events-staging"
```

`infra/README.md` gains "Switching on the go-live wiring (FD-12)": the four secrets and one variable above and where each comes from (the Neon project and its API key; the direct, non-pooled connection strings for the staging and production branches); creating the Hyperdrive configs (`wrangler hyperdrive create uw-staging --connection-string=…`) and the four queues (`wrangler queues create …`); replacing every `set-at-go-live` with the real id, AUD tag and team domain; then, once every resource exists, copying each `wrangler.go-live.toml` over its `wrangler.toml` in one reviewed PR. Until that PR, the per-PR and staging Workers run with no database and no queue, `/health` says so, and every go-live job logs a notice and stays green. After it, per-PR Workers bind to staging's Hyperdrive (P33).

- [ ] **Step 1: Write the failing tests**

`tools/ci/go-live.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = { id?: string; if?: string; run?: string; uses?: string; env?: Record<string, string> };
type Job = { if?: string; needs?: string[]; steps?: Step[] };

function job(file: string, id: string): Job {
  const workflow: { jobs: Record<string, Job> } = parse(readFileSync(join('.github/workflows', file), 'utf8'));
  return workflow.jobs[id] ?? {};
}

function runGate(env: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'uw-gate-'));
  const output = join(dir, 'output');
  try {
    execFileSync('bash', ['.github/scripts/secret-gate.sh', 'PROBE_SECRET'], {
      env: { PATH: process.env['PATH'] ?? '', GITHUB_OUTPUT: output, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return readFileSync(output, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const goLiveJobs: [string, string, string][] = [
  ['neon-pr.yml', 'neon-branch', 'NEON_API_KEY'],
  ['cleanup-pr.yml', 'drop-neon-branch', 'NEON_API_KEY'],
  ['deploy-staging.yml', 'migrate-staging', 'NEON_DIRECT_URL_STAGING'],
  ['deploy-production.yml', 'migrate-production', 'NEON_DIRECT_URL_PRODUCTION'],
];

const gated = "steps.gate.outputs.configured == 'true'";

describe('FD-12 the go-live jobs skip cleanly while their secret is absent', () => {
  it('reports not configured, and exits 0, when the secret is absent', () => {
    expect(runGate({})).toBe('configured=false\n');
  });

  it('reports configured when the secret is present', () => {
    expect(runGate({ PROBE_SECRET: 'x' })).toBe('configured=true\n');
  });

  it.each(goLiveJobs)('%s %s gates every go-live step on %s', (file, id, secret) => {
    const steps = job(file, id).steps ?? [];
    const gateIndex = steps.findIndex((step) => step.id === 'gate');
    expect(steps[gateIndex]?.run).toBe(`bash .github/scripts/secret-gate.sh ${secret}`);
    expect(steps.slice(gateIndex + 1).every((step) => step.if === gated)).toBe(true);
    expect(steps.slice(0, gateIndex).every((step) => !JSON.stringify(step).includes('secrets'))).toBe(true);
    expect(job(file, id).if ?? '').not.toMatch(/secrets/);
  });

  it('migrates before it deploys', () => {
    expect(job('deploy-staging.yml', 'deploy-staging').needs).toEqual(['migrate-staging']);
    expect(job('deploy-staging.yml', 'deploy-ingest-staging').needs).toEqual(['migrate-staging']);
    expect(job('deploy-production.yml', 'deploy-production').needs).toEqual(['production-gate', 'migrate-production']);
    expect(job('deploy-production.yml', 'deploy-ingest-production').needs).toEqual(['production-gate', 'migrate-production']);
  });
});
```

`tools/infra/go-live.test.ts` (parse with `smol-toml`):
- For each app, removing `logpush`, `hyperdrive`, `queues` from each environment and `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` from each environment's `vars` turns the go-live file into exactly the live file (`toEqual`).
- No live `wrangler.toml` declares `hyperdrive`, `queues`, `logpush`, `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` anywhere.
- In each environment, uw-ingest's `INGEST_QUEUE` producer queue equals uw-app's consumer queue; uw-app's consumer `dead_letter_queue` equals its `INGEST_DLQ` producer queue and is the events queue name plus `-dlq`; `max_retries` is 3; both Hyperdrive bindings are named `HYPERDRIVE`.
- Every Hyperdrive `id` and `ACCESS_AUD` is `set-at-go-live` or 32 lowercase hex characters; every `ACCESS_TEAM_DOMAIN` matches `^https://[a-z0-9-]+\.cloudflareaccess\.com$`.

- [ ] **Step 2: Run and see them fail** → FAIL (files and jobs missing).
- [ ] **Step 3: Implement** the script (`chmod +x`), the workflows, the go-live files, the README section and the migrate argument.
- [ ] **Step 4: Run** `pnpm exec vitest run --project node tools` → PASS, including `workflow-trust.test.ts` and `ci-workflow.test.ts`.
- [ ] **Step 5: Verify and commit (three commits)**

`TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green.

```bash
git add .github/scripts/secret-gate.sh .github/workflows tools/ci/workflow-trust.test.ts tools/ci/go-live.test.ts
git commit -m "ci: Neon branch per PR, migrate staging and production, all skipping without secrets

Shared root .github/workflows/: neon-pr creates the PR's Neon branch and applies
its migrations with main's runner; cleanup-pr drops it; migrate-staging runs after
green CI on main and migrate-production after the production gate, each before
its deploys. Every job gates its go-live steps on its secret and stays green
while it is absent.

FD-12"
git add infra/uw-app/wrangler.go-live.toml infra/uw-ingest/wrangler.go-live.toml infra/README.md tools/infra/go-live.test.ts
git commit -m "feat(infra): Hyperdrive, queue and Access bindings, kept out of the deployed config

Shared root infra/: wrangler.go-live.toml holds the bindings whose resources do not
exist yet, so a deploy never fails on a missing one; a test keeps it equal to the
live config plus those bindings, and the README says how to switch it on.

FD-12 FD-10 FD-7"
git add packages/db/bin/migrate.ts
git commit -m "feat(db): the migrate command takes an optional migrations folder

FD-12"
```

---

### Task 17: One writer per table, the module registry, and the progress tracker

**Proves:** AGENTS.md rule 3 for every table this step adds (each written by exactly one module that exports `owns`), and records step 1 in `docs/progress_tracker.md` (FD-6 to FD-12, CT-2, CT-3).

**Files:**
- Create: `tools/architecture/owners.test.ts`
- Modify: `packages/core/modules.ts`, `packages/core/modules.test.ts` (if a test names the tables)
- Modify: `docs/progress_tracker.md`

**Interfaces:**
- Consumes: the `owns` exports of `apps/uw-app/people/directory.ts`, `apps/uw-app/acl/grant-commands.ts`, `apps/uw-app/pages/store.ts`, `apps/uw-app/queue/watermarks.ts`, `apps/uw-ingest/deliveries/ledger.ts`; the tables in `packages/db/schema.ts`.

- [ ] **Step 1: Write the failing test**

`tools/architecture/owners.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../../packages/db/schema.ts';
import { owns as acl } from '../../apps/uw-app/acl/grant-commands.ts';
import { owns as pages } from '../../apps/uw-app/pages/store.ts';
import { owns as people } from '../../apps/uw-app/people/directory.ts';
import { owns as queue } from '../../apps/uw-app/queue/watermarks.ts';
import { owns as deliveries } from '../../apps/uw-ingest/deliveries/ledger.ts';

const owners: { dir: string; tables: readonly string[] }[] = [
  { dir: 'apps/uw-app/people/', tables: people },
  { dir: 'apps/uw-app/acl/', tables: acl },
  { dir: 'apps/uw-app/pages/', tables: pages },
  { dir: 'apps/uw-app/queue/', tables: queue },
  { dir: 'apps/uw-ingest/deliveries/', tables: deliveries },
];

const tables = Object.entries(schema).flatMap(([exportName, value]) =>
  is(value, PgTable) ? [{ exportName, table: getTableName(value) }] : [],
);

const sources = ['apps/uw-app', 'apps/uw-ingest'].flatMap((root) =>
  readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.ts$/.test(file) && !file.includes('node_modules'))
    .map((file) => join(root, file)),
);

function writers(exportName: string, table: string): string[] {
  const patterns = [
    new RegExp(`\\.(insert|update|delete)\\(\\s*${exportName}\\b`),
    new RegExp(`\\b(INSERT INTO|UPDATE|DELETE FROM)\\s+"?${table}"?\\b`, 'i'),
  ];
  return sources.filter((file) => patterns.some((pattern) => pattern.test(readFileSync(file, 'utf8'))));
}

describe('AGENTS.md rule 3: every table has one writer', () => {
  it('has every schema table owned by exactly one module', () => {
    const claimed = owners.flatMap((owner) => owner.tables);
    expect([...claimed].sort()).toEqual(tables.map((entry) => entry.table).sort());
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it.each(tables)('$table is written only inside its owner', ({ exportName, table }) => {
    const owner = owners.find((candidate) => candidate.tables.includes(table));
    const outside = writers(exportName, table).filter((file) => !file.startsWith(owner?.dir ?? '\0'));
    expect(outside).toEqual([]);
  });
});
```

If `security/detect-non-literal-regexp` fires on the two `new RegExp` calls, add `tools/architecture/owners.test.ts` to the existing `tools/**` override that already relaxes the fs and object-injection rules for tools, rather than writing a directive.

- [ ] **Step 2: Run it.** It should already pass if Tasks 10 to 14 kept their writes inside their modules. Prove it can fail: add `await db.insert(people)` to `apps/uw-app/acl/grant-store.ts` temporarily, run the test, see "people is written only inside its owner" FAIL naming that file, then revert with `git checkout apps/uw-app/acl/grant-store.ts`.

- [ ] **Step 3: Declare the tables and page types in the module registry**

In `packages/core/modules.ts`, the `core` module's `tables` become `['people', 'role_grants', 'grant_audit', 'pages', 'page_versions', 'webhook_deliveries', 'queue_watermarks']`, its `routes` `['/health', '/api/me', '/api/acl/commands/:name', '/api/pages/commands/:name', '/api/pages/:pageId', '/webhooks/:source']` and its `queues` `['uw-ingest-events']`; the `agents` module's `page_types` become `['skill', 'learning', 'persona', 'product', 'system_goal', 'product_strategy', 'data_sources']` and its `mcp_tools` the thirteen verb names in registry order. Run `pnpm exec vitest run --project node packages/core/modules.test.ts` → PASS (no table claimed twice).

- [ ] **Step 4: Update `docs/progress_tracker.md`**

Status row for step 1: state `Built`, evidence `docs/superpowers/plans/2026-10-01-step-01-foundation.md; tests named FD-6 to FD-12, CT-2, CT-3; pnpm verify green with TEST_DATABASE_URL set`. Also change its requirements cell to `FD-6 to FD-12, CT-2, CT-3`.

"Decisions made during the build", one row each, dated 2026-10-01, with the requirement, decision, why and cost if wrong:

| Requirement | Decision | Why | Cost if wrong |
|---|---|---|---|
| FD-7 FD-8 FD-9 FD-10 | Step-1 platform modules (people, acl, pages, deliveries, watermarks) take a Drizzle handle directly; ports arrive in step 2, where the Grants port's platform adapter wraps `acl/grant-store.ts` | `packages/harness/ports.ts` does not exist yet and these are platform modules, not kernel modules | Step 2 refactors the call sites onto the Grants and Store ports |
| FD-6 | Database-backed app tests are `*.pg.test.ts` in the Vitest node project; Workers-pool tests cover every path without a database | postgres.js over TCP inside the Workers pool is unproven; real Postgres semantics matter more than the runtime here | A defect only `postgres` under workerd shows surfaces at go-live |
| FD-10 | Route tests in uw-ingest use a recording queue and an in-memory delivery ledger; `postgresLedger` is proven separately on real Postgres | The queue binding has no local stand-in without an account | A mismatch between the double and the table semantics; mitigated by the end-to-end pg test |
| CT-3 | `contract-lock.json` records every closed set per version; removing a value needs a major bump | Makes "enum, fixtures and version change together" mechanical | An edit in place to an old entry is caught only by review |
| CT-3 | `command_not_wired` renamed `not_wired` (PRD 8.5); contract 2.0.0 | The PRD names the reason `not_wired` | None in use yet |
| CT-2 | Verb grants: reads `viewer` on the resource's area, writes `editor`, `list_gifts` `editor(40-49)`, `create_draft_journal_entry` `editor(20-29)`, and `search_pages`, `query_entities`, `poll_queue` gated row by row | PRD 11 and plan §4 | A wrong grant on one verb is a contract change in step 4 |
| CT-2 | Every verb's input and output schema is defined now | CT-2 requires them in the registry | Step 4 may reshape some; each is a contract bump |
| FD-9 | Frontmatter fields for the seven page types (Task 5); persona `status` lives in `pages.status`, not frontmatter; `requires_tools` accepts unregistered verb names | AB-8 must name a missing verb; one status column avoids two sources of truth | PE-1 or KN-15 may add fields: a contract change |
| FD-9 | Clients supply `pageId` on create; type and area never change on update; a page the principal cannot read is `page_not_found` | Keeps the outcome envelope to `accepted` or `error`; avoids confirming a hidden page exists | Moving a page between areas needs a later command |
| FD-8 | `can(actor, action, resource)` takes `read`, `write` or `admin`; editor reads every area as FD-8 states, without the plan's finance and CRM read exclusions | Avoids colliding with the word Verb; the exclusions belong to the ledger and CRM modules, not in v1 | When ledger or CRM tables land, `can()` gains the exclusion for 20-29 and 40-49 |
| FD-8 | Granting a role to a pending person needs org admin and activates them (P21); the people module exports `activatePerson` so it stays the only writer | One writer per table | None known |
| FD-8 | Revoking the last live org-admin grant is refused `last_org_admin`, serialised by locking every live org-admin row | The org must never lose its last admin | None known |
| FD-8 | Re-granting a grant that expired but was never revoked first revokes the expired row, with its own audit record | The one-live-grant index would otherwise refuse it | None known |
| FD-8 | `grant_audit` is append-only by trigger | It is an audit trail kept 7 years (PRD 9) | None known |
| FD-8 | The sponsor's bootstrap email is `sponsor@unfoldingword.org` | No address for the sponsor is in the repository | If wrong, the sponsor signs in as a separate person without the grant; fixed by a migration or by Ian granting him |
| FD-7 | A service token's identity is `agent:svc-<client id>` with no grants | AB-2 maps tokens to owners in step 4 | AB-2 replaces it |
| FD-7 | `/health` is outside Access and has no `can()` (exceptions.md) | The deploy probe needs the commit without a credential | WB-10's drill-through must live behind Access |
| FD-7 | People are classified `internal`, `cache_readonly` | Plan §2.6 puts the directory there | None known |
| FD-11 | Each Worker mints its own trace id and ignores an inbound `x-trace-id`; queue consumers use the envelope's | A caller cannot forge log correlation | A future cross-Worker call must pass the id in its body or envelope |
| FD-11 | A small JSON logger in `packages/core` rather than a package | Workers Logs ingests `console.log` JSON; pino and similar assume Node streams | Low; about 50 lines |
| FD-11 | Queue depth on `/health` is consumer lag from `queue_watermarks` (P18); thresholds 60 s amber, 300 s red; database 500 ms amber, 2 s timeout red | Queue backlog needs the Cloudflare API and a token | Thresholds tuned at go-live |
| FD-11 | 30-day retention is Logpush into R2 `uw-logs` with a lifecycle rule, declared as API bodies in `infra/logs/` | Workers Logs keeps days, not 30 | Needs Workers Paid for Logpush |
| FD-7 FD-11 | Access and Logpush are declared as Cloudflare API JSON applied by a person, not Terraform | No new tool for two declarations | A drift detector (plan §19) must read these files later |
| FD-10 | Malformed messages are sent to the DLQ producer explicitly and acked; with no DLQ bound they retry into the queue's own `dead_letter_queue` | Fails fast without losing the message | None known |
| FD-10 | Payloads over 120 000 bytes are enqueued with `payload: null`, `payloadTruncated: true` | Cloudflare Queues messages are limited to 128 KB | GH-2 must re-read a truncated delivery from the GitHub API |
| FD-10 | The delivery id is claimed before the send and released if the send fails | A failed send must not turn GitHub's redelivery into a replay | A crash between claim and send loses that delivery until the nightly sweep (GH) |
| FD-10 | Duplicates are acked within a batch; across batches every ingest handler must be idempotent on `(source, deliveryId)` | Cloudflare Queues delivers at least once | GH-2 must upsert |
| FD-12 | Bindings whose resources do not exist live in `wrangler.go-live.toml`, kept equal to the live config plus those bindings by a test; switching on is copying it over | A binding to a missing resource fails the deploy | One reviewed PR at go-live |
| FD-12 | The Neon PR job runs main's migrator over the PR's SQL files, checked out as data, in a `workflow_run` job | PR code never runs with the Neon key | A PR's SQL can still damage its own Neon branch, which is disposable |
| FD-12 | `drop-neon-branch` continues on error | A PR that never went green has no branch | A real deletion failure leaves a branch to delete by hand |
| CT-3 | The event vocabulary is left as on `main` until KN-3 (step 3) | KN-3 owns the event log | None |

"New dependencies", dated 2026-10-01: `jose` (replaces hand-written JWT and JWKS verification); `@octokit/webhooks-methods` (replaces a hand-written HMAC-SHA256 constant-time compare); `smol-toml` (replaces hand-parsing wrangler TOML in tests).

"Not verified", dated 2026-10-01: FD-7, the Access JWT from a real Access application (fixture key pair only); FD-6 and FD-10, `postgres` under workerd against Hyperdrive (pg tests run in Node); FD-10, Cloudflare Queues delivery, retries and the dead-letter queue (doubles and fixtures only); FD-11, Workers Logs output and the Logpush and R2 lifecycle bodies against the Cloudflare API; FD-12, every go-live job's configured path (only the skip path ran in CI); FD-8, the sponsor's email; FD-11, the run-step leg of the trace id, which has nothing to follow until HE-1 adds Workflow steps (the request, webhook, queue message and database-write legs are tested).

"Waiting on a person", dated 2026-10-01:

| Requirement | What is written | What is needed to verify it live | From whom |
|---|---|---|---|
| FD-7 | Access JWT verification, `infra/access/uw-app.json` | The Access application with Google as IdP, its AUD tag and team domain, a service token | Ian, the sponsor |
| FD-8 | Bootstrap migration | Confirm the sponsor's sign-in address | The sponsor |
| FD-10 | uw-ingest Worker, deploy jobs, queue bindings in `wrangler.go-live.toml` | The four queues; `GITHUB_WEBHOOK_SECRET` as a Worker secret (with GH-1's App) | Ian, an org owner |
| FD-11 | Workers Logs, `infra/logs/*.json` | Workers Paid for Logpush; the `uw-logs` bucket; R2 credentials | Ian |
| FD-12 | `neon-pr.yml`, `drop-neon-branch`, `migrate-staging`, `migrate-production`, Hyperdrive bindings in `wrangler.go-live.toml` | `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_DIRECT_URL_STAGING`, `NEON_DIRECT_URL_PRODUCTION`; Hyperdrive configs for staging and production; then the switch-on PR | Ian |

- [ ] **Step 5: Verify and commit**

`TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/uw_test pnpm verify` → green, with every `*.pg.test.ts` and `packages/db` test reported as run.

```bash
git add tools/architecture/owners.test.ts packages/core/modules.ts packages/core/modules.test.ts eslint.config.ts docs/progress_tracker.md
git commit -m "test(architecture): one writer per table; record step 1 in the tracker

Every table in packages/db/schema.ts is owned by exactly one module that exports
owns, and written nowhere else. The module registry declares the tables, routes,
queue, page types and verbs. The tracker records step 1 as built, every ruling it
made, what was not verified and what waits on a person.

FD-6 FD-7 FD-8 FD-9 FD-10 FD-11 FD-12 CT-2 CT-3"
```

Then push the branch (`git push -u origin build/v1`); if no draft pull request exists for `build/v1`, open one per `AGENTS.md` section 8 (`gh pr create --draft --base main --head build/v1`) with a body listing the requirement IDs built so far and no attribution footer.
