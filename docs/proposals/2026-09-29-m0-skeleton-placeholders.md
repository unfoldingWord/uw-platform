# Create the empty `infra/` and `packages/contracts/` roots in the M0 skeleton

## Problem

Issue #4 asks for the layout `apps/uw-app`, `apps/uw-ingest`, `packages/db`, `packages/core`, `packages/contracts` and `infra/`. AGENTS.md rule 4 names `packages/contracts/` and `infra/` as shared roots: a change to either is an architecture change that needs a proposal first, and the contracts change only in their own PR. Creating the two directories is a change to both, so the skeleton cannot be finished without one.

## Change

The skeleton PR for #4 creates the two roots with nothing in them that anything depends on:

- `packages/contracts/`: a `package.json` named `@uw/contracts` with no dependencies and no exports, a `tsconfig.json` that extends the shared base, and one wiring test that asserts the package depends on no other workspace package (the DAG in `docs/architecture.md`: `packages/contracts → nothing`). No command, event, outcome or verb. The contents stay with #13 and #14, each in its own PR.
- `infra/`: a `README.md` that states what the directory will hold (wrangler configs, Access policies, R2 lifecycle, Neon branches, drift detector, per plan §19 and the Repo Skeleton) and that #5 fills it. No wrangler file, no environment, no secret.

## Alternatives

- **Leave both out of #4** and let #5 create `infra/` and #13 create `packages/contracts/`. The skeleton then misses two of its acceptance criteria, and the README has to describe roots that do not exist yet.
- **Create both without a proposal**, reading the issue itself as the approval. That is the incidental shared-root change rule 4 exists to stop, and it sets the precedent that an issue can waive the rule.

## Rules affected

- AGENTS.md rule 4: one sanctioned change to each of `packages/contracts/` and `infra/`, limited to creating them empty. No other shared root is touched.
- No exception entry is needed in `docs/exceptions.md` if this is approved, because the change goes through the proposal route the rule prescribes.
