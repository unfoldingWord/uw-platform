# unfoldingWord Platform

One operating platform for the whole organization: knowledge, planning, people, money, field reporting, software delivery and the agents that help with all of it, as modules on one database with one login.

## Why

unfoldingWord has run on disconnected systems: an accounting ledger, a donor database, a knowledge base, a budget spreadsheet and a separate tool for software work. The same program shows up in each of them under a different name, and people reconcile them by hand. The platform replaces that with one canonical record of the organization, organized two ways at once (by Johnny.Decimal area and by the Strategic Cascade from purpose down to task), so that a question about a program, a gift, a person or a product has one answer.

Three ideas hold it together:

- **Modules.** Each part of the platform is a named slice that owns its data, screens and agent tools, and can be turned on one at a time.
- **Agents as governed coworkers.** Agents reach the platform through one small set of tools. They do work in workflows, and a person decides at every gate that has an effect on the world.
- **One spine.** Every "should we build this?" question is answered by where it sits: source systems, the canonical record, the agent tools, then screens and agents on top.

## Where things are

Each document has one job, and no fact lives in two of them.

| File | Job |
|---|---|
| [`README.md`](README.md) | What the platform is and why, the layout, and these pointers |
| [`AGENTS.md`](AGENTS.md) | Process and coding rules for anyone, human or agent, changing this repository. Read it in full before your first edit |
| [`CONTEXT.md`](CONTEXT.md) | The words. One word per concept, everywhere |
| [`docs/PRD.md`](docs/PRD.md) | What the platform does: every module, its features and its rules. Kept current, and covers the whole platform, not only what exists so far |
| [`docs/architecture.md`](docs/architecture.md) | How it is built: the shape as it runs today, and the planned shape of what is not there yet. Kept current |
| [`docs/decisions.md`](docs/decisions.md) | Why: each settled decision, its reason and what was rejected, cited everywhere as "ADR NNNN". Read it before changing the shape or reopening a question |
| [`docs/exceptions.md`](docs/exceptions.md) | Recorded exceptions to the rules |
| [`infra/README.md`](infra/README.md) | The runbook: how each environment is set up |
| [`skills/harness/SKILL.md`](skills/harness/SKILL.md) | The skill an agent loads to work an item in a workflow |
| [`design-system/README.md`](design-system/README.md) | The design system boards, synced from Claude Design |

What is built and what is outstanding is not in any file. It is in GitHub: every feature in the PRD has an issue under the platform epic, and the epic is the only place status is kept.

Three rules keep the documents from drifting apart:

- **One home per fact.** What the platform does lives in the PRD, the shape in the architecture document, the reason in a decision, status in an issue. Do not restate one inside another; link to it.
- **Never restate what the code holds.** A list or a count the code defines (verbs, events, page types, tables, engines, checks) is named by its file, never copied into a document.
- **No history.** These documents say what is true now. What changed and when is in git and in the decisions; there is no tracker, plan or spec to update.

## Layout

A pnpm workspace on Node 22, TypeScript strict throughout. It runs on Cloudflare Workers, with PostgreSQL (Amazon Aurora) reached through Cloudflare Hyperdrive and Cloudflare Access for sign-in.

"Harness" in the code is a **workflow** in the UI and in conversation: a set of stages that items move through, with the people and agents who work them. A **Cloudflare Workflow** is always written with both words.

| Path | For |
|---|---|
| `apps/uw-platform/` | The Worker: server-rendered pages with small browser scripts ("islands"), the command API, the MCP endpoint agents use, the live-update hub, hosted agent runs, the Cloudflare Workflows, the queue consumer and the crons |
| `apps/uw-ingest/` | Public webhooks: signature checks, then onto a queue. Nothing else |
| `packages/harness/` | The workflow kernel: commands, reads and views as pure TypeScript over ports. It runs in plain Node and imports no Workers, database or vendor code |
| `packages/contracts/` | Commands, events, outcomes and the verb registry as Zod schemas, versioned, with fixtures |
| `packages/db/` | The schema, migrations, and the one store implementation of the kernel's ports |
| `packages/core/` | Shared basics: dates, access rules, logging, money, principals, modules |
| `packages/ui/` | Design tokens, the stylesheet, the page shapes and the parts screens are made of |
| `sim/` | Scenarios that drive the kernel end to end without a network |
| `tools/` | Lint rules, architecture checks, CI and infra tests, and the UI build scripts |
| `infra/` | Wrangler configs, Access policies, container and GitHub App setup |
| `design-system/` | Reference boards. Code never imports them |

## Running the checks locally

1. Use Node 22 (`.nvmrc`) and the pnpm version in `packageManager`, then `pnpm install`. This also installs the pre-commit hook, which runs ESLint and Prettier on staged files.
2. For the database tests, run PostgreSQL 16 and set `TEST_DATABASE_URL`, for example `postgres://postgres@localhost:5432/postgres`. Each test creates and drops its own database. Without it, tests named `*.pg.test.ts` are skipped.
3. Run `pnpm verify`, or a single file with `pnpm exec vitest run <path>`. Do not run two full test runs at once: each worker opens its own database.

The commands, the branch model and how work lands are in [`AGENTS.md`](AGENTS.md), sections 2, 7b and 8.

## Licence

To be confirmed by unfoldingWord.
