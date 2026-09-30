# unfoldingWord Platform

The organization's operating platform, built as modules on one database with one login. This repository holds the first module to be built, the **harness**: the Build, Measure, Learn loop as a mechanism, with agents as governed coworkers and a person at every gate that has an effect on the world.

## Start here

- [`AGENTS.md`](AGENTS.md): the rules for anyone, human or agent, changing this repository. Read it in full before your first edit.
- [`CONTEXT.md`](CONTEXT.md): the vocabulary. One word per concept, everywhere.
- [`prd/Harness v1 - Architecture.md`](prd/Harness%20v1%20-%20Architecture.md): the ratified spec for the harness, with Jesse's review applied. What to build and why.
- [`docs/architecture.md`](docs/architecture.md): the shape. A pure engine over ports, driven headlessly in a sim, with events as the spine.
- [`docs/adr/`](docs/adr/): why the shape is this way.
- [GitHub milestones](https://github.com/unfoldingWord/uw-platform/milestones): the work, M0 to M9. Every issue cites the spec and carries acceptance criteria and blocked-by edges. Pick by the `ready` label.
- [`prd/`](prd/): Jesse's platform corpus, which the harness sits under: the Executive Brief, the Platform Architecture Plan, Key Visuals, the council review, and the review of the harness spec.
- [`ui-design/`](ui-design/): the Claude Design prototype of the platform; the source of the brand tokens until a `design-system/` folder lands.

## Packages

A pnpm workspace on Node 22, TypeScript strict in every package through one `tsconfig.base.json`. The layout is the plan's Repo Skeleton; M0 creates only what the harness needs.

| Path | Package | For |
|---|---|---|
| `apps/uw-app/` | `@uw/uw-app` | The Hono monolith on Workers: SSR pages and islands, command API, MCP surface, live hub, Workflows, queue consumer, crons. The harness runs here as part of the `agents` module |
| `apps/uw-ingest/` | `@uw/uw-ingest` | Public webhooks (GitHub, later Stripe and Zulip): signature verification and enqueue, nothing else |
| `packages/core/` | `@uw/core` | `dates.ts`, the one `formatDate`/`parseDate` pair and the shared Zod ISO date schema (plan §0); `modules.ts`, the module registry (plan §14). `acl.ts` lands with the ACL work |
| `packages/db/` | `@uw/db` | The Drizzle schema, the only schema, and its migrations. Empty until #7 |
| `packages/contracts/` | `@uw/contracts` | Commands, events, outcomes and the verb registry as Zod. Depends on no other workspace package. Empty until #13 and #14 |
| `packages/harness/` | `@uw/harness` | The engine: pure TypeScript over ports. Empty until the engine issues land; its tsconfig has no Workers types |
| `tools/lint/` | | The custom gates: `uw/no-ad-hoc-dates`, `uw/no-comments`, the vendor-SDK text gate, and the `lint:dates` grep |
| `tools/architecture/` | | Tests that prove each dependency rule refuses what it should |

`infra/` (wrangler configs, Access policies, R2 lifecycle, Neon branches, the drift detector, plan §19) is reserved for #5.

These plan packages are deliberately not created in M0, and their names are reserved so nobody invents a different layout: `apps/uw-www/` (public site), `apps/uw-desktop/` (Tauri shell), `packages/editor/` (Tiptap and Yjs editor and sync client), `packages/charts/` (chart specs and renderers), `packages/docs/` (print styles, letterhead, PDF and DOCX rendering), `packages/compliance/` (obligations, reports, evidence queries). The harness packages in `docs/architecture.md` (`packages/ui/`, `sim/`) arrive with the issues that build them.

## Scripts

Every script is a root script; a package adds only the `check` and `build` it needs. CI calls `pnpm verify` and nothing else.

| Command | Runs |
|---|---|
| `pnpm check` | `tsc --noEmit` at the root and in every package. `packages/harness` has its own tsconfig with no Workers types, so a Workers global fails here |
| `pnpm lint` | ESLint flat config with zero warnings allowed: `@eslint/js`, `typescript-eslint`, `eslint-plugin-security`, the six fitness functions (function of 50 lines, 25 statements, complexity 10, depth 4, 3 nested callbacks, 5 parameters), the date rule, the no-comments rule, the vendor-SDK and `packages/harness` purity import rules |
| `pnpm lint:fix` | The same, with `--fix` |
| `pnpm lint:dates` | The CI grep for locale-dependent and ad-hoc date formatting outside `packages/core/dates.ts` |
| `pnpm lint:vendor` | The text gate: `@anthropic-ai/*`, `openai` and OpenRouter imports outside `apps/uw-app/engines/<engine>/` |
| `pnpm format` / `pnpm format:check` | Prettier, the only formatter, over code and config files |
| `pnpm knip` | Unused files, exports, dependencies and types |
| `pnpm architecture` | dependency-cruiser over `apps` and `packages`: the dependency DAG in `docs/architecture.md`, circular imports, vendor SDKs, the engine's purity |
| `pnpm test` | Vitest: Worker code in `apps/*` runs under `@cloudflare/vitest-pool-workers`, everything else in plain Node |
| `pnpm build` | `build` in every package that has one |
| `pnpm audit:prod` / `pnpm audit:all` | `pnpm audit` for production and for all dependencies; both fail on a high or critical advisory |
| `pnpm verify` | check, lint, lint:dates, lint:vendor, format:check, knip, architecture, test, build, in that order. `walk` and `trace` join the chain with the issues that create them |

## Contributing

Node 22 (`.nvmrc`) and the pnpm version in `packageManager`. `pnpm install` installs the Husky pre-commit hook, which runs lint-staged (ESLint with `--fix` and Prettier on staged files). The hook is the fast half; `pnpm verify` is the whole chain and the only thing CI runs. Audits run beside it in CI, not inside it, because they need the network. Read `AGENTS.md` before your first edit.

## Status

Spec ratified, issues filed, contributor rules written. The M0 scaffold is in progress: the workspace layout, the date module and its gate, and the module registry are in place; the toolchain (#67 in review), CI (#68) and deploys (#5) follow.

## Licence

To be confirmed by unfoldingWord.
