---
status: accepted
date: 2026-09-29
---
# Events are the source of truth; item state is a fold, and replay equals record

Everything that happens to a harness is a row in `harness_events`: append-only, from a closed vocabulary in `packages/contracts`, carrying the actor's full identity string, the host and the cost basis. An item's state is a fold over its events. The play-by-play, the board, the dashboard feed, the live hub's wakes and the seven-year audit trail are all reads over the same rows; none keeps its own bookkeeping. A property test asserts that folding an item's events reproduces its stored record, for random valid sequences.

The plan's earlier shape, a `history jsonb` column on the item, would have made the item row the truth and the history a copy that drifts, and would have given the dashboard, the audit trail and the play-by-play three different sources to disagree.

**Consequences.** The database refuses UPDATE and DELETE on `harness_events`. Adding an event is a contract change and its own PR. Clients hold a cursor into the log and read forward from it, so a dropped wake loses time and nothing else. Failures are events too; a refused gate attempt by an agent, a refused stage edit and a lapsed delegation are all rows, which is what makes the gaps visible on the board rather than hidden in a prompt. Source: spec Figure 1 "Event log", D7, "Unattended loops".
