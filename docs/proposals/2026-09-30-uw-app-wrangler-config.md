# Declare the `uw-app` Worker's wrangler config and environments in `infra/`

## Problem

Issue #5 asks for the `uw-app` Worker's wrangler configuration in `infra/`, with a staging and a production environment, and for a documented place where later issues add bindings by diff. AGENTS.md rule 4 names `infra/` as a shared root. The approved skeleton proposal (`2026-09-29-m0-skeleton-placeholders.md`, approved on #72) created `infra/` with a README only: no wrangler file, no environment, no secret. Nothing yet sanctions the wrangler config itself, so #5 cannot land without a proposal.

## Change

PR #73 adds to `infra/`:

- `infra/uw-app/wrangler.toml`: the `uw-app` Worker, entry `apps/uw-app/index.ts`, `nodejs_compat`, and one var, `COMMIT_SHA`, holding the placeholder `unknown`. Two environments:
  - `staging`: Worker `uw-app-staging`, `workers_dev = true`, reachable at `uw-app-staging.<account subdomain>.workers.dev`.
  - `production`: Worker `uw-app`, `workers_dev = false` and no route, so it is unreachable; nothing deploys to it in M0 (issue #68 adds the gated production workflow).
  - The top-level block is never deployed; every command names its environment.
- `infra/README.md`: the hand-deploy command for staging, where the Cloudflare credentials come from (the shell or the CI secret store, never a wrangler file), and a table naming where each later binding goes.

No binding, no secret, no route and no custom domain.

Later bindings in the README table (Hyperdrive #7, Queue #10, Durable Objects, Workflows, crons) are added by diff to this file, once in `[env.staging]` and once in `[env.production]`. Each of those is still a change to `infra/`, and this proposal does not approve them in advance: each arrives with its own proposal, or with an approval recorded on its issue or PR.

## Alternatives

- **Keep the wrangler file in `apps/uw-app/`**, as the sibling Worker repos do. Plan §19 and issue #5 put infrastructure in `infra/`, so that everything the platform runs on is declared in one place and a drift detector can read it; splitting it would undo that.
- **Read issue #5 as the approval.** The skeleton proposal already rejected that: it sets the precedent that an issue can waive rule 4.
- **Pre-approve every binding in the README table now.** It would save a proposal per binding, but it approves changes whose ids, names and scopes do not exist yet.

## Rules affected

- AGENTS.md rule 4: one sanctioned change to `infra/`, limited to `infra/uw-app/wrangler.toml` and `infra/README.md` as described above. No other shared root is touched.
- No exception entry is needed in `docs/exceptions.md` if this is approved, because the change goes through the proposal route the rule prescribes.
