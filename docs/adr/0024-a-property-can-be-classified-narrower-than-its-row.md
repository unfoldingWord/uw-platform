---
status: accepted
date: 2026-11-21
---
# A property can be classified narrower than its row

A directory row is `internal`: every colleague reads who works here. Its mailing address, phone and compliance fields are not. Notion shows them to everyone; plan §2.6 classifies per table. Decision G of `prd/Databases and Views - Design Proposal.md` extends ADR 0017's row read rules to properties.

**Decision (2026-11-21).** A collection property may declare a `classification` narrower than its row (`restricted` or `sensitive`) with a **property rule**: `steward`, the JD area whose grant reads it (or `null` for the row's own area), `role`, the least role on that area, and `owner`, whether the person the row belongs to reads it. An `admin` grant at `org` scope always reads it, as for restricted rows. `canReadProperty(actor, rule, row, at)` in `packages/core/acl.ts` applies it; `propertyAccess` answers for a reader once per query whether they read the property on every row (`all`), only on the row they own (`own`), or never (`none`).

The query engine enforces it in SQL before rows leave the database:

- **Projection.** `none` drops the property from the select list; `own` projects `CASE WHEN <row owner> = <reader> THEN <value> END`. The screen never receives a value it must hide.
- **Filter, sort and group.** Refused with `property_not_readable` unless the reader's access is `all`, so a reader cannot learn values by grouping or by narrowing a filter. `own` is not enough: filtering on it would still tell other rows apart.
- **Rollups and computed values.** A rollup over a property the reader may not read, or a computed value with one such input, is left out of the reply, as a withheld property is.
- **Writes.** A property the reader may not read is not writable by them, whatever their area role.
- **Page reads.** A collection row is also a page, so `readPage` and `pageVersion` in the pages module drop every frontmatter key whose property the reader may not read on that row (`withoutWithheld` in `apps/uw-app/pages/property-rules.ts`). The page screen, the page verbs and page history never carry a withheld value either.
- **Row rules first.** A property on a typed record narrows its record's own row rule, never widens it: the directory's private columns are read only where `directory_private`'s row rule and the property rule both allow.

**Rejected.**
- **Hide it in the screen.** The JSON route, the MCP verb and the export would still carry it.
- **Split restricted fields into a restricted table.** It works for the directory but not for an admin-made collection, and would turn every narrower property into a migration.
- **Refuse the whole row to a reader without the property's grant.** The rest of a directory row is meant for everyone.

**Consequences.** The directory's phone, mailing address and compliance fields are `restricted` with the people-administration area (`10-19`) as steward and the person themself as owner. Every new restricted property needs a steward; the definition schema refuses a narrower classification without a rule.
