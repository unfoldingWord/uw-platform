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
| `tools/lint/` | | The date gate: the `uw/no-ad-hoc-dates` ESLint rule and the `lint:dates` grep, over the same patterns |

`infra/` (wrangler configs, Access policies, R2 lifecycle, Neon branches, the drift detector, plan §19) is reserved for #5.

These plan packages are deliberately not created in M0, and their names are reserved so nobody invents a different layout: `apps/uw-www/` (public site), `apps/uw-desktop/` (Tauri shell), `packages/editor/` (Tiptap and Yjs editor and sync client), `packages/charts/` (chart specs and renderers), `packages/docs/` (print styles, letterhead, PDF and DOCX rendering), `packages/compliance/` (obligations, reports, evidence queries). The harness packages in `docs/architecture.md` (`packages/harness/`, `packages/ui/`, `sim/`) arrive with the issues that build them.

## Scripts

| Command | Runs |
|---|---|
| `pnpm check` | `tsc --noEmit` at the root and in every package |
| `pnpm lint` | ESLint, which today hosts the date rule; the full config is #67 |
| `pnpm lint:dates` | The CI grep for locale-dependent and ad-hoc date formatting outside `packages/core/dates.ts` |
| `pnpm test` | Vitest over every package; the Workers pool is #67 |
| `pnpm verify` | All of the above in order. #67 extends it to the full chain and #68 makes CI call it |

## Status

Spec ratified, issues filed, contributor rules written. The M0 scaffold is in progress: the workspace layout, the date module and its gate, and the module registry are in place; the toolchain (#67), CI (#68) and deploys (#5) follow.

## Licence

To be confirmed by unfoldingWord.
