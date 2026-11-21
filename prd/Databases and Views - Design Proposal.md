# Databases and Views: Design Proposal

Status: draft for review, 2026-11-21; decisions C and H ruled by Jesse the same day. Nothing here is built. It compares what the platform plan specifies with how four Notion databases are used today (Program Portfolio, Projects Kanban, Colleague Directory, and two task lists), then proposes the feature set that lets the program and project pages, and any other database-shaped page, be built on the platform.

The goal is not to rebuild the Program Portfolio and Projects Kanban screens by hand. It is to build the parts they are made of (typed properties, relations, saved views, templates, embeds) so those two are configuration, and the next collection (grants pipeline, workshop plans, OKRs, intake) is configuration too.

## Part 1. How Notion is used today

Read on 2026-11-21 through the Notion connector: the `00.12 Program Portfolio` and `00.13 Projects Kanban` databases, both under `00 Dashboard for unfoldingWord`, plus the `Portfolios` data source they relate to. The Tasks data source that Projects relates to returned "not found" to the connector, so its schema and views are not covered here. Formula definitions were not readable either; only their names and descriptions were.

### Properties in use

| Property type | Program Portfolio | Projects Kanban | Notes |
|---|---|---|---|
| Title | Name | Project name | |
| Status, with groups (to-do, in progress, complete) | Phase (6 options), Status (health: on track, at risk, off track) | Phase (7 options) | Filters and boards use the **group** as often as the option |
| Select, multi | Stakeholders (15 partner orgs), Tags (8) | Tags (6) | Stakeholders is a list of organizations kept as select options. It should be a relation to the directory |
| Person, single and multi | Program Leader, uW Program Team | Project Manager, Project Team | |
| Date range | Duration | Duration | Drives the calendar view and the "overdue" filter |
| URL | Financials | | A link out to a spreadsheet |
| Text | | Google Training Event ID | A hand-kept foreign key |
| Number (dollars) | | Field Cost, Committed | Money in a property |
| Relation | Portfolio, 2030 OKRs, Workshop Plans | Program, 2030 OKRs, Tasks | Program ↔ Project is two-way |
| Rollup | | Portfolio (through Program, show unique) | |
| Formula | | Total Cost, Remaining Funding Need, Plus Field Staff | Money arithmetic over the number fields |

### Views in use

Program Portfolio has 4 views; Projects Kanban has 12.

| View type | Count | Used for |
|---|---|---|
| Board | 11 | Grouped by Phase (status option), by Portfolio (relation), by 2030 OKR (relation); manual or ascending group order; hide empty groups |
| Table | 3 | Column choice and widths; multi-key sort (Program, then Remaining Funding Need) |
| Calendar | 1 | Training events placed on the Duration range |
| Chart | 1 | Donut of program count by Phase group |

Filters used: status is option or is group, multi-select contains, person contains **me**, date before **today**, and one nested and/or group. Three views carry empty filter rows (a person or date filter with no value) that do nothing; an import should drop them.

### Page shape

- Each database has a **default template** ("New Program", "New Project").
- The record page has a **layout**: property sections ("Overview", "Details", "Budget"), one property hidden when empty, a relations panel, the body, then discussions.
- Both databases are **locked** against schema edits.
- The parent `00 Dashboard` embeds 11 databases beside prose (Knowledge Base proposal, Part 1).

### Two more databases, checked against the design

Added on 2026-11-21 to test whether the design is general rather than shaped to programs and projects.

**`00.05 Colleague Directory`** (5 views, locked, two templates):

- Properties: title, text (Role, Mailing Address), select (Area with 11 options, Employment with 5, Ring with 3, a compliance status with 3), date (Joined, a compliance due date), URL, **email**, **phone**, relation to Portfolios.
- Views: **gallery** ×3 (sorted by name; grouped by Area, and grouped by the exact text of Mailing Address), table ×1, donut chart ×1 (count by compliance status).
- The Area options include both "HR" and "Human Resources". "Area" here is a team, not a Johnny.Decimal area.
- Mailing address, phone and the compliance fields are personal data in a database every colleague reads.

**Tasks.** The Projects Kanban's own Tasks data source is still unreadable. Two others were read instead:

- `⚙️ Tasks` under Infrastructure (2 views): status with groups (Backlog, Recurring, To do, In progress, Review, Complete), person (Assign), select Priority (URGENT, HIGH, NORMAL, LOW) sorted by option order, multi-select Tags (45 options), a **self-relation** (Related task), a **files** property (Attachments), text (Task Content), and four hand-kept dates: Created, Updated, Closed, Due. "Created By" is a select of three names rather than a person or the system's own creator. Views: board by status sorted by priority then closed date, and a table of every property.
- `My Tasks` on the Home page (Notion's built-in personal task list): one **list** view, assignee is **me**, status in the to-do or in-progress groups, sorted by due date, showing a Source property.

## Part 2. What the plan specifies

From `prd/An App For Everything - Platform Architecture Plan.md`:

- **§2 Pages + records.** Every human-readable thing is a page with typed frontmatter (JSONB) and a markdown body. Anything with financial integrity is a record in a typed table pointing at a page. "Never store money facts only in frontmatter."
- **§2 Cascade spine.** Purpose → Objective → Principles → Portfolio (carrying its Strategic Intent, one entity) → Program → Project → Task. Products sit on a second plane, linked by `page_links` (`delivers_for`, `also_serves`).
- **§2 Page types.** Each type gets a Zod frontmatter schema, a default template, **default views**, and ACL and publishing behaviour. Types are "extensible by super admin without migrations (types are data + a Zod schema registry in code)". `portfolio`, `program`, `project`, `product`, `okr`, `person`, `org` are listed.
- **§2 Tasks are universal.** One `tasks` table with title, status, assignee, due, priority, a parent page, and a source.
- **§2 Frontmatter merge.** Per-field last-writer-wins with field timestamps, not CRDT.
- **§2.6** Projects and programs read models are `internal`, `cache_readonly`.
- **§11** TanStack Table for tables and boards.
- **§13 Lean.** Every board is a kanban with per-column WIP limits per area; cumulative flow and cycle time from status history; stale-page and blocked-task reports are "standard saved views".
- **§14 Modules.** `strategy` owns the cascade entities, OKRs and charters; `core` owns pages, tasks and search.
- **§17 / ADR 0012** Charts are ECharts SVG.
- **Dashboards proposal.** A `dashboard` page type, embeds that keep their own context and permissions, data contracts instead of arbitrary SQL.

## Part 3. What the code has today

Checked on `infra/uw-files-buckets` at `fb0d817e`:

- `pages`, `page_versions`, `page_links`, `page_comments`, `page_files`, `page_favourites`, `area_homes` in `packages/db/schema-platform.ts`.
- Page types: `skill`, `learning`, `persona`, `product`, `system_goal`, `product_strategy`, `data_sources`, `issue`, `platform`, `knowledge` (`packages/contracts/page-types.ts`). Frontmatter schemas are Zod in code. **No** `portfolio`, `program`, `project` or `okr` type.
- `tasks` exists with title, status, due, parent page and area. It has **no** assignee, priority or source yet.
- The Queue board is for harness items, a different thing (`CONTEXT.md` reserves "board" and "card" for it).
- ECharts is in `packages/ui`. Transclusion and wiki links arrived with the knowledge base (#172).

## Part 4. The gaps

| Needed by the Notion usage | Plan | Code | Gap |
|---|---|---|---|
| Typed properties on a page | Yes: Zod frontmatter per type | Yes, in code | A **property catalogue** (status with groups, person, date range, relation, select) that a view can introspect. Zod alone does not tell a board what it can group by |
| New collections without a deploy | "Types are data" | No, code only | Decide whether a collection's schema is data (Part 5, decision A) |
| Relations as properties, two-way | `page_links` with `rel` | Table exists | Relation properties that read and write `page_links`, shown on both ends |
| Rollups and formulas | Not specified | None | A small, safe computed-property set |
| Saved views (table, board, calendar, chart) | Named, not designed | None | The view model: filter, sort, group, displayed properties, layout per type |
| Relative filters (me, today) | Not specified | None | Resolved on the server from the principal and `formatDate` |
| Board that moves items | Kanban with WIP limits | Queue only | Drag writes the group property through a command; WIP limit per group |
| Personal and shared views | Not specified | None | Shared views per collection, personal views per person |
| Templates and page layout | Default template per type | Templates in KB scope | Property sections, hide-when-empty, relations panel |
| A view embedded in a page | Dashboards proposal | Transclusion exists | A view embed, permission-checked like a dashboard embed |
| Money (Field Cost, Committed, totals, the Financials link) | Records, never frontmatter | Rolling Budget epic (#178–#182) | Read-through money properties from Sage and the budget views, edited only in budgeting and revenue projection; programs keyed to their Sage program ID (decision C) |
| Organizations as select options | `org` page type, directory module | Not built | Stakeholders becomes a relation to `org` pages |
| History-based charts (cycle time, cumulative flow) | From `page_versions` | Versions exist | A status-transition read over versions |
| Directory rows are people; task rows are tasks | `people` and `tasks` are typed tables (plan §2) | Both tables exist | A collection must list **typed records** as well as pages (Part 5, decision F) |
| Gallery and list layouts | Not specified | None | 3 of the directory's 5 views are galleries; My Tasks is a list |
| Email, phone, files, multi-line text | Not specified | `page_files` exists | More property types |
| Created, updated and closed times kept by hand | `page_versions` timestamps every change | Versions exist | System properties, with closed time derived from entering the complete group |
| Sort by priority | Not specified | None | Select options carry an order that sorts and groups use |
| Personal fields visible to everyone | Classification per table (§2.6) | Per table | Classification **per property**, so address and phone can be narrower than the row |
| Two templates; a view picks its default | One default per type | None | Several templates per collection, a default per view |

## Part 5. Decisions this needs

**A. Collection schemas are data, validated as strictly as code.** Recommended. A collection definition (properties, their types and options, status groups, required fields) is stored as a versioned record and compiled to a Zod schema at runtime. The built-in strategy types (portfolio, program, project, OKR) ship as seeded definitions through the same path, so there is one mechanism, not two. The plan's sentence already leans this way. Cost if wrong: if only engineers should add collections, the admin screens are wasted work, but the runtime compiler is still used by the built-ins. Alternative: Zod in code only, as today, which makes every new collection a pull request.

**B. Property values stay in `pages.frontmatter`; relations stay in `page_links`.** Recommended. No entity-attribute-value table. Filters and sorts compile to JSONB expressions with generated expression indexes for properties a view sorts or groups on. Relations are rows in `page_links` with the property key as `rel`, so backlinks and the cascade tree use the same data.

**C. A collection owns no money. Its money properties are related, not stored.** Ruled by Jesse, 2026-11-21, and required by plan §2. Every financial figure comes from Sage Intacct or from the budgeting and revenue projection features (Rolling Budget epic, #178 to #182). Concretely:

- **One program, one identity.** A program page is the program cascade node the budget plan already names (the plan is kept outside this public repository). The program collection does not create a second program record beside it.
- **Correlated to Sage by its program ID.** Each program carries its Sage Intacct program ID through the budget plan's `sage_dimension_map` (Sage dimension → cascade node, with effective dates), not as a typed text property on the page. A program with no Sage ID is listed for the CFO, as the budget plan already does for a missing department. The budget plan maps the Sage **department** today; whether "program ID" is the department or a separate Intacct dimension needs confirming with finance before issue 7.
- **Money properties are read-through.** Budget, actuals, income by source, committed, remaining need and balance are properties whose source is the budget module's views (actuals from whichever source is authoritative per period, plan lines from the current version, revenue from the projection). Their source is a related record, so a collection definition cannot declare a stored money property at all; the property catalogue has no such type.
- **Edited only in the budget and revenue projection processes.** A money property on a program row shows its value and opens the owning budget or projection screen to change it. The collection's own edit commands never write a figure. That keeps the budget module as the one writer (AGENTS.md rule 3) and keeps versions, close state and approvals where they already live.
- **Read rules follow the money, not the collection.** Program pages are `internal`; the figures behind them follow the budget plan's read rules (§4.4: a `21.10` reader gets the projection, Sage detail needs a grant on `20–29`). A reader without the grant sees the projection or nothing in that column, by decision G, never a typed copy.
- **Projects follow the same rule.** Field Cost, Committed, Total Cost and Remaining Funding Need become read-through properties once budget line items can be attached to a project. Until then a project row shows "no budget lines yet", not a number.
- **Notion's money fields are not imported as values.** The Notion import reports each program's and project's typed figures beside the budget's figures for the same period, for a person to reconcile, and imports none of them. The Program Portfolio's "Financials" link to a spreadsheet is dropped once the program's budget view exists.

**D. Formulas are a closed set, not a language.** Recommended for the first build: sum, difference, count, date-until, and rollups (count, sum, show unique, percent per group) over a relation. A general formula language is a later decision, and if taken, an existing sandboxed expression library is used (AGENTS.md §5).

**F. A collection can list pages or typed records.** Required by the directory and tasks. Each property declares its source: page frontmatter, a column of a typed table (`people`, `tasks`, later budget lines), or computed. A record-backed collection writes through the owning module's command, never into the table directly (AGENTS.md rule 3), and a record with a narrative still points at a page. Decision C's money properties are a case of F whose source is the budget module's views; unlike `people` and `tasks`, those properties are never writable from a collection. The query engine compiles each source to its own SQL; views do not know the difference.

**G. Classification can be narrower on a property than on its row.** Recommended. A directory row is `internal`, but its mailing address, phone and compliance fields can be `restricted`, read by the person themself and by HR's area. The query engine drops a property the reader may not see before rows leave the server; a filter or group on it is refused for that reader rather than leaking values through grouping. This extends ADR 0017's row rules to properties and needs its own ADR.

**H. A person's profile is their colleague page.** Ruled by Jesse, 2026-11-21. There is one page per person: the directory row for their `people` record. It is the profile page the app opens wherever a person appears (a person property, an assignee, a page owner, a comment author, an approver on a gate, a mention), so every person chip in the app is a link to it. Nothing about a person is kept on a second profile screen. The page shows the directory properties the reader may see (decision G), the narrative body, and read-through lists of their open tasks, the programs and projects they lead or work on, and the pages they own. A person may edit their own contact fields and body; role, team, employment and compliance fields are written by the people who administer the directory. No route for this exists yet; the code has no profile screen today.

**E. Words.** `CONTEXT.md` avoids "board" (the Queue's old name), "card" and "task" (reserved), and "view" already appears in "Read view" and "Gate view". Proposed new words: **Collection** (a page type whose pages are listed and queried as rows), **Property**, **Saved view** (with layouts Table, Board, Calendar, Chart), **Group**. The Board layout of a saved view needs a name that does not collide with the Queue; "Board" may be fine once the Queue owns its own name, but that is a `CONTEXT.md` ruling.

## Part 6. The feature set

### Must have to replace the two databases

1. **Property catalogue.** Types: title, text (single and multi-line), number, select and multi-select (with an option order), status (options in to-do, in progress, complete groups), person (single or multi), date and date range, URL, email, phone, checkbox, files, relation (one-way or two-way, to a named collection or to itself), rollup, computed. System properties on every row: created time and by, last edited time and by, and the time it entered its status's complete group. Each type declares its source (decision F), its classification (decision G), and how it filters, sorts, groups and renders. Pure TypeScript, in a package with no Workers imports, so the sim can run it.
2. **Collection definitions.** Stored, versioned, edited by an area admin; changing a definition validates existing pages and reports which ones no longer fit instead of failing silently. Lock flag, matching Notion's locked databases.
3. **Query engine.** A filter, sort and group syntax tree (Zod, in `packages/contracts`), compiled to SQL on the server, always intersected with what the principal may read (plan §4, ADR 0015, ADR 0017) before rows leave the database. Relative values (`me`, `today`, `this week`) resolve on the server. Paginated. The same query serves the screen, the MCP surface and exports.
4. **Saved views.** One record per view: collection, layout, filter, sorts, group, displayed properties, column widths, group order, hide empty groups. Shared views belong to the collection; personal views to a person. Layouts:
   - **Table**: TanStack Table (plan §11), column choice and widths, inline edit for properties the person may write.
   - **Board**: group by status, select, person or relation; drag between groups writes the property through a command and returns an outcome; manual group order; per-group WIP limit (plan §13).
   - **Calendar**: placed by a date or date range.
   - **Chart**: count or sum by group, drawn with ECharts (ADR 0012), with the figures also in the page as text.
   - **Gallery**: cards with chosen properties and an optional cover from the page, grouped or not. The directory's main layout.
   - **List**: one line per row. My Tasks.
5. **Record page layout and templates.** Property sections, hide-when-empty, a relations panel listing the pages that point here, then the body and comments. Several templates per collection that pre-fill properties and body; each view names its default.
6. **Directory and tasks as record-backed collections.** The directory lists `people` with its properties; personal fields carry a narrower classification. Each directory row is that person's profile page, and every person chip in the app links to it (decision H). Tasks list the `tasks` table, which gains assignees, priority, tags, a description, files, related tasks and source (plan §2 already names most of these). One tasks table serves every team's list: the Infrastructure board is a saved view filtered by area, and My Tasks is a list view filtered by assignee "me".
7. **Strategy collections.** `portfolio` (carrying strategic intent, per plan §2), `program`, `project`, `okr`, seeded as definitions over the budget plan's cascade nodes. Project → Program is a two-way relation; Portfolio on a project is a rollup through Program; tasks attach through `tasks.page_id`. A program is keyed to its Sage Intacct program ID; every money figure on these rows is read-through and edited only in budgeting or revenue projection (decision C).
8. **Agent reach.** Read a saved view, read a collection's definition, create a page in a collection, set a property: verbs in the registry, each behind `can()` on the area. Changing a definition and moving a page past a gate stay person-only.
9. **Notion import for collections.** Map schema, options, status groups, people, relations and views; drop empty filter rows; turn the Stakeholders options into `org` pages and relations; keep the Notion ID on each page for the `/notion/<id>` redirect. Cleanups the dry run reports for a person to confirm: merge duplicate options ("HR" and "Human Resources"), turn a select of names into a person or the system creator, and replace hand-kept created, updated and closed dates with system properties after checking they agree. Dry run first, as in the knowledge base import.

### Should have soon after

- **View embeds** in any page, so the `00 Dashboard` can be rebuilt as an area home with views beside prose. Same permission rule as dashboard embeds: the embed never widens access.
- **Timeline** layout over a date range, for program and project durations.
- **History charts**: cycle time and cumulative flow from status changes in `page_versions` (plan §13).
- **Universal tasks completed**: assignee, priority, source, and a "My Tasks" saved view (plan §2).

### Deliberately not now

- A general formula language.
- Inline databases with their own private schema inside a page. Every collection is a page type.
- Real recurring tasks. "Recurring" is a status option in the Infrastructure board; it imports as one.
- Grouping on free text beyond exact match. The directory's "By location" groups on the whole address string; a structured location property is the better fix and a person's call.

## Part 7. Compared with open-source Notion and Airtable clones

Read on 2026-11-21 from source at each project's default branch: Twenty, AppFlowy (and AppFlowy-Collab), BlockSuite (AFFiNE's editor), NocoDB, Baserow and Docmost. Outline has no database feature. File-level citations are in the appendix; the claims below marked unverified were not confirmed in code.

### How they store things

| | Schema | Row values | Relations | Formulas | Views | Manual order |
|---|---|---|---|---|---|---|
| Twenty | Metadata tables | A real table per object, a real column per field (DDL at runtime) | Foreign keys | None ("coming in 2026") | Normalized: view, view fields, filters, filter groups, sorts, groups | One float position per record, shared by every view |
| NocoDB | Metadata tables | Real tables | A junction table per link, with order columns | jsep parser compiled to SQL | Grid columns with show, order, width; collaborative, locked or personal | A table-wide order field |
| Baserow | Metadata tables | A generated Django model per table | Generated through tables | ANTLR grammar compiled to SQL, with a dependency graph | Nested filter groups, per-view field options; personal views are a paid tier | A table-wide order |
| AppFlowy | In the CRDT | One Yrs document per row; each row has a body document | One-way; the cell holds row ids | None | One CRDT map per view: layout, filters, sorts, groups, field settings, row order | A row-id list per view |
| AFFiNE | In the CRDT | Cells inside the document's Yjs | In the document | None | Table and kanban only; filters run in the browser | Unverified |
| Docmost "Bases" (2026) | Metadata tables, with `pending_type` and `schema_version` | JSONB cells, read through typed SQL extractor functions | Unverified | Unverified | A view row with a JSONB config | Fractional text position, `COLLATE "C"` |

### Where the design holds

- **Server-side queries.** AppFlowy and AFFiNE keep the whole database in a CRDT and filter in the client; AppFlowy users report large grids are slow without pagination. Compiling a filter tree to SQL on the server, as here, is what Twenty, NocoDB and Baserow do.
- **No formula language yet.** Twenty and AppFlowy ship without one. NocoDB and Baserow show the cost of adding one: a parser, compilation to SQL, a field dependency graph and injection hardening. Decision D stands.
- **Rows are pages with a body.** Only AppFlowy does this, and Notion's users rely on it (project canvases, colleague bios). Decision B stands.
- **Field-level read rules.** Twenty ships them in open source and Baserow in its enterprise tier, so it is a known shape. Decision G stands, with one addition below.

### What to adapt

1. **Views as normalized rows, not one blob** (Twenty). A saved view row, plus child rows for its properties (visible, width, position), its filter groups (nested, and/or), its filters, its sorts, and its groups (value, visible, position). A deleted property then removes its view rows by foreign key instead of leaving dead filters, which is exactly the problem three Notion views have today.
2. **Board columns stored per view** (Twenty, NocoDB, Baserow). The view's group rows hold each column's value, order and visibility, not only the property it groups by.
3. **Card order is per view, by fractional key** (AppFlowy's per-view order, Docmost's fractional key). Twenty, NocoDB and Baserow share one position per row across every view, so two boards grouped differently fight over the same order. Here a view with manual order keeps a `(view, row, position)` row, the position a fractional text key with `COLLATE "C"` from the `fractional-indexing` package (AGENTS.md §5). A view without manual order uses its sorts.
4. **Typed extractor functions over JSONB** (Docmost). One SQL function per property type that reads a typed value out of frontmatter, used by filters, sorts and the expression indexes on hot properties. A function that casts text to a timestamp depends on the session time zone and must be `STABLE`, not `IMMUTABLE`; dates here are `YYYY-MM-DD` and cast without a zone.
5. **Safe type changes** (Docmost). A property's type change is recorded as pending, converted row by row, and finished, with the collection definition's version advanced only when every row fits. This is how decision A's "validate existing pages" runs in practice.
6. **Relative values as a structured node** (Twenty). `{direction, unit, amount}` for dates, plus `me`, resolved on the server.
7. **Relations need order and indexes.** `page_links` gains a position (for a manually ordered list of linked pages) and indexes on `(rel, from)` and `(rel, to)`.
8. **Hidden properties are hidden in rollups too.** A rollup over a property the reader cannot see is refused or empty for that reader; the SQL projection, not the screen, enforces it.

### Where the design diverges on purpose

- **JSONB, not a real column per property.** Twenty, NocoDB and Baserow run DDL at runtime for every new field. Here Drizzle is the only schema and every change is a reviewed migration (AGENTS.md §1), and runtime DDL from a Worker through Hyperdrive would break that. Data that is queried hard already lives in real columns, because it lives in typed records (`people`, `tasks`, budget lines) under decision F. Page frontmatter uses extractor functions and expression indexes. No project published a JSONB-versus-columns benchmark; the spike in the build issue measures it on our data, and if a page collection outgrows JSONB the answer is a typed table under decision F, not runtime DDL.
- **A Yjs body beside last-writer-wins properties.** None of these projects keeps a versioned markdown copy beside a CRDT body. That risk belongs to the knowledge base work (#175) and is not reopened here.

## Part 8. Issues

Three issues. Jesse asked for few issues, with the build grouped so it moves fast; the migration is its own, and the profile page is its own.

**1. Collections and saved views** (#206). Everything in Part 6 and the adaptations in Part 7, in this order of work. The steps can land as several pull requests against the one issue where that is easier to review; each leaves `develop` releasable.

1. Words in `CONTEXT.md` (decision E); one ADR for decisions A to D and F, one for property classification (G), one for the profile page (H).
2. Property catalogue and collection definitions: the pure package, contracts, runtime Zod compile, property sources, safe type changes.
3. Query engine: the filter, sort and group tree; extractor functions and expression indexes, with the JSONB spike measured and recorded; the ACL and property intersection; relative values; MCP read verbs.
4. Saved views as normalized rows; per-view card order by fractional key; `page_links` position and indexes.
5. Layouts: table, board (drag, WIP limits), list, gallery, calendar, chart; record page layout; templates.
6. Tasks and directory: widen `tasks`; extend `people` or add the directory table; the directory collection over it, with personal fields classified narrower. The profile screen on top of it is #208.
7. Strategy collections: portfolio, program, project and OKR over the budget plan's cascade nodes, each program keyed to its Sage Intacct program ID, money read-through from the budget views. Depends on #178; money columns fill in as #179 to #181 land.
8. View embeds in pages and the `00 Dashboard` rebuilt as an area home.

Shared roots it touches: `packages/contracts`, `packages/db/schema-platform.ts` and a new `schema-collections.ts`, `packages/core/acl.ts` (property rules), `CONTEXT.md`, `docs/adr/`. The profile ADR (H) is written here with the others so issue 3 starts from a ruling.

**2. Collections: migrate the Notion databases** (#207). The Colleague Directory, the task lists, the Program Portfolio and the Projects Kanban, with their views. Dry run report first; the cleanups a person confirms (duplicate options, names kept as a select, hand-kept dates, dead filters, Stakeholders to `org` pages); money figures reported against the budget, never imported; write pass; verification against Notion; then setting the Notion databases read-only, which is a person's step. Depends on issue 1.

**3. The profile page: every person links to their colleague page** (#208). Decision H. A route for one person's page (the directory row for their `people` record), with the directory properties the reader may see, the body, and read-through lists of their open tasks, the programs and projects they lead or work on, and the pages they own. One person chip in `packages/ui` that links there, used everywhere a person or a human identity is shown today (Access, Home, gates, runs, page owners, comments, assignees, mentions). A person edits their own contact fields and body; directory administrators edit role, team, employment and compliance fields. Depends on issue 1 steps 1 to 3 and 6. The chip and the route can land first, showing only what `people` holds, and fill in as the directory collection lands.

## Appendix. Sources for Part 7

Read on 2026-11-21 at each project's default branch.

- Twenty, `https://github.com/twentyhq/twenty/blob/main/`: field and object creation by DDL in `packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/action-handlers/{object,field}/services/`; view tables in `packages/twenty-server/src/engine/metadata-modules/view*/entities/`; view types in `packages/twenty-shared/src/types/ViewType.ts`; relative date operands in `packages/twenty-shared/src/types/ViewFilterOperand.ts`; card position in `packages/twenty-front/src/modules/object-record/utils/computeNewPositionOfDraggedRecord.ts`; field permissions in `.../object-permission/field-permission/field-permission.entity.ts`; no formulas per `packages/twenty-docs/user-guide/workflows/how-tos/crm-automations/formula-fields.mdx`.
- AppFlowy-Collab, `https://github.com/AppFlowy-IO/AppFlowy-Collab/blob/main/collab/src/database/`: rows and their body documents in `rows/row.rs`; field types in `fields/type_option/`; views in `views/define.rs`, `views/layout.rs`, `views/row_order.rs`. Filters in AppFlowy `frontend/rust-lib/flowy-database2/src/services/filter/entities.rs`. Pagination complaint: `https://forum.appflowy.com/t/appflowy-actually-doesnt-really-work-well-for-grid-with-large-number-of-rows-due-to-lack-of-pagination/4232`.
- BlockSuite, `https://github.com/toeverything/blocksuite/blob/main/packages/affine/`: `model/src/blocks/database/database-model.ts`, `data-view/src/view-presets/kanban/define.ts`, `data-view/src/core/filter/eval.ts`. The standalone repository's last commit is July 2025; current AFFiNE may differ.
- NocoDB, `https://github.com/nocodb/nocodb/blob/develop/packages/`: links in `nocodb/src/models/LinkToAnotherRecordColumn.ts`; formulas in `nocodb-sdk/src/lib/formula/jsepInstances.ts` and `nocodb/src/db/formulav2/formulaQueryBuilderv2.ts`; filters in `nocodb/src/models/Filter.ts`; views in `View.ts` and `GridViewColumn.ts`.
- Baserow, `https://github.com/baserow/baserow/blob/develop/`: dynamic tables in `backend/src/baserow/contrib/database/table/models.py`; formula grammar `BaserowFormula.g4` and `formula/expression_generator/django_expressions.py`; view ownership in `premium/backend/src/baserow_premium/views/view_ownership_types.py`; field permissions under `enterprise/backend/src/baserow_enterprise/api/field_permissions/`.
- Docmost: `https://github.com/docmost/docmost/blob/main/apps/server/src/database/migrations/20260529T125146-bases.ts`.

## What this proposal did not verify

- The Projects Kanban's own Tasks data source: the connector could not read it. The Infrastructure and My Tasks lists stand in for it; if it carries properties those two lack, the catalogue may need more.
- `people` today holds only email, display name and status. Decision F assumes role, team, employment, joined date and contact details are added to it (or to a directory table the Directory module owns), not kept as frontmatter. Which one is a schema decision for issue 6.
- Formula definitions for Total Cost, Remaining Funding Need and Plus Field Staff: only their descriptions were readable.
- Row counts in either database; no rows were queried.
- Whether JSONB expression indexes keep board and table reads inside the query budget on Hyperdrive; that is a spike inside issue 3.
- No code was written or run for this proposal.
