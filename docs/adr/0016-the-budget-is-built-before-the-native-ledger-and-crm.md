---
status: accepted
date: 2026-11-20
---
# The budget is built before the native ledger and CRM, over Sage and Virtuous

The platform plan replaces Sage Intacct with a native double-entry ledger (Phase 3) and Virtuous with a native CRM (Phase 2). Under it, budget against actual "is a single join on identical dimension keys" inside that ledger, and Sage reaches the platform only as a CSV mirror during a parallel run. Until then the Rolling Budget stays a Google Sheet in which the CFO types each month's actuals from Sage over the forecast.

**Decision (2026-11-20, by an owner).** The Rolling Budget becomes native platform data now. The native ledger and CRM come later, and until they do the platform integrates with Sage Intacct and Virtuous through their APIs, read-only.

- Actuals are a mirror of Sage journal lines and period states. Gifts and gift asks are a mirror of Virtuous. Each sits behind a port with a platform adapter and a test adapter, and every mirrored row carries its provenance.
- Budgets, forecasts and worksheets are platform data from the start: versions with an author, a lens and a status, as `docs/specs/2026-11-20-rolling-budget-migration-plan.md` section 4 describes.
- Budget data is read with a grant on the Johnny.Decimal ID `21.10`, a grant on area `20–29`, or `admin` at `org` scope. The grant on an ID is a new scope; the pull request that adds it carries its own ADR.

**What changes in earlier decisions.** The platform plan's phase order no longer governs the budget: `budget_lines` and the Sage mirror arrive ahead of Phase 2 and Phase 3. The plan's sponsor decision to replace both systems stands, with no date. The plan is history and is not edited; this ADR is the record.

**Rejected.**

- **Wait for the native ledger.** No re-sequencing, but the CFO keeps closing months by hand, and the forecast keeps being overwritten by actuals, for as long as the ledger takes.
- **Sync the sheet into the database and keep the sheet as the source.** Quick, and it removes none of the manual work. It survives only as the first step: the sheet is imported once so the new views can be proven against it.
- **A CSV mirror of Sage, as the plan describes.** API access is available, and a file drop would make "actuals as they come in" a daily manual step.

**Consequences.** The mirror tables are shaped to become the plan's Sage parallel-run mirror, and the plan tables to become its `budget_lines`, so the native ledger inherits them and does not replace them. Two external systems become runtime dependencies of a platform feature, so their credentials wait on the credentials store (#157, #158) and a sync failure is shown as state, never as stale figures. Finance data arrives before classification-aware reads (#155) are finished; the read rule above is enforced by the budget's own queries until then. Source: the migration plan; the owner's instruction of 2026-11-20.
