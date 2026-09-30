# Exceptions

Every exception to a rule in `AGENTS.md` is recorded here before the code, in the same commit. An exception without an entry is a defect.

| Date | Rule broken | File | Why the rule cannot hold here | Review |
|---|---|---|---|---|
| 2026-09-30 | Rule 4 and section 9: a proposal file, a stop and DRI approval before changing a shared root | `AGENTS.md`, `docs/adr/0008-review-and-merge-protocol.md`, `docs/proposals/` | This PR removes that gate. A separate proposal PR first would repeat the cost the change exists to remove (#71 took two PRs and four Codex rounds for three lines), so the proposal is carried in the #78 description instead, and the edits were committed before the approval. The exception covers #78 only; once it merges, section 9 no longer requires a proposal. | Approved by Ian (DRI) on #78: https://github.com/unfoldingWord/uw-platform/pull/78#issuecomment-5914876071 |
| 2026-09-30 | Rule 4: a shared-root change goes in its own PR, never mixed into feature work | `AGENTS.md` (section 8), `docs/adr/0008-review-and-merge-protocol.md` | Ian (DRI) directed this correction into #76 (contracts) rather than its own PR. It replaces the false claim that branch protection enforces CI and approval (it does not exist on the Free plan; issue #12) with the rule that the merger never merges on red. Text only, no rule relaxed. Covers #76 only. | Ian (DRI), directed in-session; decision recorded on #76 |
