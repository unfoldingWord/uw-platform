---
status: accepted
date: 2026-11-19
---
# A grant on an area reads only that area

Until now an `editor` or `admin` grant on one Johnny.Decimal area also let its holder read every other area: `can(actor, 'read', area)` was true for any area, and `readableAreas` answered `all`. That followed the spec's "org-wide read that `editor` anywhere carries" and kept the platform as open as the Notion workspace it replaces. It also meant an editor on 80–89 could read Finance (20–29). The credentials store, gifts and the ledger were next to arrive, and all of them would have been readable the same way.

**Decision (2026-11-19).** A grant on an area, of any role, reads that area and no other. Only an `org`-scope grant, of any role, reads every area. Write and admin are unchanged: they always needed a grant on the area itself or at `org` scope.

- `packages/core/acl.ts`: `readScope` no longer widens an editor or admin grant to every area. `readableAreas` now equals the areas a person holds grants in, plus everything for an `org` grant.
- Everything that filters by `can(read)` or `readableAreas` narrows with it, without code changes of its own: MCP `search_pages`, `read_page` and `resolve_context`, the untrusted-content clearance key, and the notification holders of an area.
- An agent's MCP session already runs with its bound person's grants (`apps/uw-app/mcp/mint.ts`), so an agent now also reads only the areas its person holds grants in. A run's beat principal, an `editor` on its workflow's area, reads only that area.

**To keep the open culture for someone,** an org admin grants them `viewer` at `org` scope. Only an org admin can: `grantRole` requires `admin` on the scope it grants, and an area admin is refused `not_permitted` for an `org` grant. Openness is now a visible, audited grant in `grant_audit`, not a side effect of being an editor somewhere.

**What changes in earlier decisions.** The spec's permission table rows "`viewer` on the harness's area, or the org-wide read that `editor` anywhere carries" now read "a grant on the harness's area, or any `org` grant". PRD FD-8, and the step plans that tested "editor reads every area" (step 1) and used it as a control (step 13, S13-R5), are history and are not edited. This ADR is the record.

**Rejected.**

- **Keep the open read and carve out restricted data.** This is the platform plan's §4 idea: keep editor-reads-everything, but exclude finance, donor and credential rows by classification. It keeps the default open, but every new sensitive table would have to remember to opt out, and one table that forgot would leak. Narrowing the default means a new table is closed until someone grants access.
- **Narrow reads only for `restricted` and `sensitive` tables.** Today's pages, tasks and workflows would stay open. Rejected for this change because a page's classification comes from its type, every page type is `internal` (`packages/contracts/page-types.ts`), and so a page in Finance was readable from any area. That is the exposure the owner asked to close. Classification-aware reads are still planned for `restricted` and `sensitive` rows, as their own issue. Under this ADR they matter mainly for `org`-scope grants.
- **A new `reader` role with org-wide read.** That is `viewer` at `org` scope, which already exists.

**Consequences.** People who could see other areas only because they were editors somewhere lose that view on deploy. Before this ships to production, an org admin (an area admin cannot) should give `viewer` at `org` scope to everyone who should keep seeing the whole organization, and should deliberately leave out anyone who should not see Finance. Workflow lists, search and agent context are now scoped to a person's grants. A hosted run reads its persona's instructions only if the run's principal, an `editor` on the workflow's area, may read the persona page's area: run start and every scene read refuse `page_not_found` otherwise, so a persona page activated in another area cannot run (review of #163). Source: issue #153; `prd/Credentials Store - Design Proposal.md`, finding 1.
