---
status: accepted
date: 2026-09-29
---
# Issues are the work, Codex reviews every PR, a human squash-merges

Work exists only as GitHub issues under the ten milestones, each citing the section of the spec it implements, with acceptance criteria and native blocked-by edges. Pickup is by the `ready` label, not by assignee: the highest-priority unblocked issue in the lowest milestone, claimed by assigning yourself. One open PR per worker. Branches are `harness/<issue>-<slug>` off `main`; the PR says which issue it closes and declares what it touches and its risk tier. Every PR is reviewed by Codex, which posts one exit condition per round; the author answers exactly that condition in one push; an approved PR is frozen and non-blocking notes become follow-up issues. A human merges, by squash, once CI is green and the review is approved. Branch protection requires the named CI checks, one approval, an up-to-date branch, and dismisses stale approvals on new commits, which is GitHub's native answer to an approval riding onto a head nobody reviewed.

This replaces two things we tried: markdown lists of work, which drift, and one PR per review item, which was too slow. It is also the protocol Jesse's hourly routines already follow on `tc-mobile`, with this repo's nouns, so his bots and our sessions obey the same rules.

**Consequences.** Codex needs its own GitHub identity for its approval to count on a PR from the account it runs under; until then, humans cross-approve. The files most likely to conflict, `packages/db/schema.ts`, `packages/contracts` and the event vocabulary, change only in their own PRs. Once the harness's external runner and delegations exist (milestone six), a routine claims through the harness itself rather than by label, and the identity on every event is the routine's; nothing else in this protocol changes. The org commit convention from `unfoldingWord/uw-dev-skills` applies: Conventional Commits, the agent as sole author, no attribution footer, hooks always pass, never `--no-verify`, no merge to `main` without a human's explicit word.
