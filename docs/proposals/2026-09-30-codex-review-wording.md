# Describe Codex review as it actually runs

## Problem

`AGENTS.md` section 8 and ADR 0008 say Codex "posts one exit condition per round" and that the author answers "exactly that condition". That is the `tc-mobile` bench's behaviour, not Codex's. In this repository Codex is run by a person from the Codex CLI, so a PR waits at "ready for review" until someone runs it. Each round it posts findings by severity, inline comments, and a verdict, and the author must answer every finding, not one condition. Codex also posts from a person's account, so when that person authored the PR its verdict is a comment rather than a formal approval, and the "Approved" badge says nothing about it.

## Change

In `AGENTS.md` section 8, replace the first bullet with:

> **Codex reviews every PR**, run by a person from the Codex CLI, so a PR waits at "ready for review" until someone runs it. Each round it posts findings by severity, inline comments, and a verdict. Answer every finding it lists, in one push per round. Unrelated changes restart the review.

In the same section, insert after "Never merge your own PR.":

> Codex posts from a person's account. When that account authored the PR, GitHub allows only a comment, so Codex's verdict is a comment, not a formal approval, and the merging human reads the verdict, never the badge. When a different account runs Codex, it can submit a formal approval, and that approval counts toward the one branch protection requires.

In ADR 0008, replace "Every PR is reviewed by Codex, which posts one exit condition per round; the author answers exactly that condition in one push;" with:

> Every PR is reviewed by Codex, run by a person from the Codex CLI, which posts findings by severity and a verdict each round; the author answers every finding in one push;

Once this proposal is approved, the edits land in their own follow-up PR.

## Alternatives

- Leave the text as it is. Agents then wait for a single exit condition that never arrives, and answer one finding when the review lists several.
- Configure Codex to post one exit condition per round. The CLI review does not work that way, and the per-severity list is more useful to the author.
- Record the difference in `docs/exceptions.md`. It is not an exception to a rule; the rule itself describes the process wrongly.

## Rules affected

- `AGENTS.md` section 8, Review and merge: wording of the Codex and merge bullets. No rule is added or removed.
- ADR 0008: the review sentence. The decision (Codex reviews every PR, a human squash-merges) is unchanged, so no new ADR is needed.
- Rule 4 applies because `AGENTS.md` and `docs/adr/` are shared roots; hence this proposal.
