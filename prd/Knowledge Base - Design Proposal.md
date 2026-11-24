# Knowledge Base: Design Proposal

**Status:** accepted 2026-11-20 with five changes from Jesse (see "Decisions"). Filed as two issues: the build and the content migration.
**Date:** 2026-11-20
**Reviewed against:** `develop` at `4da454f`. Sources: `packages/db/schema-platform.ts`, `packages/contracts/pages.ts`, `packages/contracts/page-types.ts`, `packages/contracts/areas.ts`, `apps/uw-app/pages/`, `apps/uw-app/views/screens/page.tsx`, `apps/uw-app/views/parts/names.ts`, `apps/uw-app/islands/`, `apps/uw-app/auth/`, ADR 0015, the platform plan (§1, §2, §2.4 to §2.6, §4, §11, §14, §21), and the live Notion workspace.

This proposal answers one question: what must the platform do before staff can stop opening Notion for the knowledge base? It covers the wiki. It does not cover Notion's databases (Program Portfolio, Projects Kanban, Colleague Directory, OKRs, Prayer Requests, Parking Lot), which the platform plan handles as typed records in its Phase 1.

Three labels are used throughout. **Verified** means read in the code, the Notion workspace or a project's own documentation during this review. **Inferred** means reasoned from those. **Not verified** means it still needs a check, and says which.

## Part 1. How Notion is used today

Sampled on 2026-11-20: the `01 Knowledge base` wiki and five of its articles, the `00 Dashboard`, the Johnny.Decimal index, the JD Areas list and the Operations Meeting page. This is a sample, not a full crawl; the importer's dry run (Part 6) produces the full inventory.

| Finding | Evidence | What it means for the platform |
|---|---|---|
| The knowledge base is one Notion wiki of about 50 articles, numbered `01.05` to `01.53`, grouped on a home page under Purpose, People, Process, Tools and Other | `01 Knowledge base` | The scale is small. The home page is a hand-kept list of links, so an area needs an editable landing page, not only a generated tree |
| Every title starts with its Johnny.Decimal ID, and the index page tells people to "Use Cmd/Ctrl F to search this page" | `00.01 unfoldingWord Index`, 168,000 characters, 94 toggles | People find things by ID. The Quick Switcher must match `01.47` as well as "security". It replaces the index page as the way to jump |
| Wiki pages carry four properties: Owner, Tags, Verification (with an expiry) and Overview | Wiki schema; two articles show verification expired on 2025-08-08 | Ownership and "is this still true" are already expected. Expired verification that nobody renewed says the reminder matters more than the field |
| The wiki database is locked | `locked` on the database | Staff already guard against accidental edits by hand. Read-first is the same wish, made the default |
| Teamspaces are the JD areas, one of them `60-79 Field Programs` | Teamspace list | `60-79` is a cluster of two decades. A page is filed in a category (decision 5) |
| Articles use callouts, toggle headings, tables with a header row and column, code blocks, checklists, images, bookmarks, a table of contents, coloured highlights and columns | `01.26 Budgeting`, `01.35 Notion Training Guide`, `00.25 Operations Meeting` | These decide the markdown dialect (Part 3) |
| Pages link to each other constantly: 66 page mentions in the index, 133 in the Operations Meeting page | Same pages | Links must survive a rename, and backlinks are worth having |
| Inline comments are used on policy text | Five threads on `01.47 Security Guidelines`, several on `01.26 Budgeting` | Comments are a real use, though a later one |
| One long-running page per recurring meeting, a toggle per date, with action items as checkboxes (27 open, 22 done) and pasted transcript summaries | `00.25 Operations Meeting`, 147,000 characters | Works as a plain page at first. The plan's `meeting` type and universal tasks replace it later |
| Synced blocks are used to keep one text in several places | Two in the index, one in the training guide (the area descriptions) | Transclusion is required (decision 3) |
| Dashboards embed databases beside prose | `00 Dashboard`: 11 databases | Out of scope here. Imported pages keep a link to the Notion database until its typed replacement exists |
| Many articles are an index to Google Drive documents | Handbook, Gift Acceptance Policy, Rolling Budget links | External links must stay first-class. Drive stays where it is |

## Part 2. What the code does today

### Already built

| Capability | Where |
|---|---|
| `pages` with type, area, slug, title, `parent_id` tree, JSON frontmatter, markdown body, version and status (`draft`, `suggested`, `active`, `retired`) | `packages/db/schema-platform.ts:128` |
| A full snapshot per save in `page_versions`, with who saved it | `schema-platform.ts:157`, `pages/history.ts` |
| Saves refuse a stale version, a parent cycle and a duplicate slug | `pages/store.ts` |
| Reads and search filtered by the areas a person may read, inside the SQL | `pages/reads.ts`, `packages/core/acl.ts` |
| JSON commands `create_page`, `update_page`, `confirm_page` and `GET /api/pages/:pageId` | `pages/routes.ts` |
| Agent verbs `search_pages`, `read_page`, `write_page` | `packages/contracts/verbs.ts` |
| Full-text search over title and body | `pages/reads.ts:47` |
| A page screen with history | `views/screens/page.tsx` |

### Findings

1. **The page screen opens in edit mode.** Anyone with write access gets the title and body as form fields straight away (`page.tsx:128`). A reader sees the body as raw text in a `<pre>`; nothing renders markdown.
2. **There is no general wiki page type.** The nine types are `skill`, `learning`, `persona`, `product`, `system_goal`, `product_strategy`, `data_sources`, `issue` and `platform`, and each requires its own frontmatter. The plan's `knowledge` type was never added.
3. **Nothing lets a person find a page.** "Pages & Wiki" is in the sidebar under `00-09` but greyed out (`names.ts:60`). There is no list, tree, breadcrumb, search screen or keyboard shortcut. Search is reachable only by agents through MCP.
4. **Nothing files a page below its area.** A page's area must be one decade (`^([0-9])0-\1[9]$`, `packages/contracts/areas.ts:3`). There is no category on a page, and the sidebar lists Field Programs as one area, `60-79`, which no page can carry.
5. **Search has no index.** The query builds `to_tsvector('simple', title || ' ' || body_md)` for every row on every search. That is fine for a few hundred agent pages and too slow once thousands are imported. `simple` also means no stemming: "budget" does not find "budgeting".
6. **The JSON surface is too thin for a second client.** There is no list, children, search, history or title endpoint. A command reply carries no new version, so a client must re-read after every save. Page commands echo `requestId` but do not record it, so a retried save is not safely repeatable.
7. **No table exists for links, files, comments, favourites or recently viewed pages.** No markdown, editor or diff library is installed.
8. **A grant on an area reads only that area (ADR 0015).** In Notion everyone can read the knowledge base. Here a person with a grant only on `80-89` cannot read a page in `00-09`.

## Part 3. The feature set

### Must have before staff can leave the Notion knowledge base

| # | Feature | Notes |
|---|---|---|
| 1 | **Read view by default, edit behind a pencil** | The design below |
| 2 | **Rendered markdown** | Headings, lists, tables, code, images, links, checklists, callouts, collapsible sections |
| 3 | **A `knowledge` page type** | Required: `jd_category` (two digits, such as `61`). Optional: `jd_id`, `owner`, `tags`, `overview`, `icon`, `aliases`, `verified_by`, `verified_until` |
| 4 | **Navigation** | "Pages & Wiki" in the sidebar, a page tree per area, breadcrumbs, an on-page table of contents |
| 5 | **Quick Switcher on Cmd/Ctrl+O** | Titles, JD IDs and aliases; also on Cmd/Ctrl+K |
| 6 | **Full-text search** | Title and body, title weighted higher, snippets, filters |
| 7 | **Create, move, rename, retire and restore a page** | Retire is the existing `retired` status; it is the trash |
| 8 | **Wiki links that survive a rename** | `[[Page title]]` works wherever text is entered: the editor, plain markdown, an agent's write and the import |
| 9 | **Images and attachments** | The imported articles are full of screenshots |
| 10 | **History with a diff and restore** | Snapshots exist; the comparison and the restore command do not |
| 11 | **A real editor, with live co-editing** | Formatting without knowing markdown; Yjs from the start (decision 2) |
| 12 | **Transclusion** | One text shown on several pages, edited in one place (decision 3) |
| 13 | **The Notion import** | Part 6 |

### Should have soon after

Backlinks. Favourites and recently viewed. Owner and verification with a reminder when verification expires, and a stale-page list. Templates. Page comments, then comments anchored to a passage. Export to markdown and PDF (plan §16). A "someone else is editing" notice.

### Deliberately not building

- **Block storage.** The plan rejected it (§2); nothing found here argues otherwise.
- **Inline databases inside pages.** Typed records replace them.
- **Multi-column layouts and cover images.** Decorative in the sample.
- **Per-page sharing.** A page's area is its scope (plan §4). Private personal pages are an open question, not part of this proposal.
- **Always-on editing as a preference.** Outline and Docmost both let a person switch back to always-editable. That would bring the original problem back for anyone who chose it, so there is no such setting.

## Part 4. Design

### Read first, edit on purpose

- `GET /pages/:pageId` is always the read view: rendered markdown, breadcrumbs, table of contents, properties, backlinks. It never contains a form field for the body.
- A pencil button in the page header, shown only when the person may write, goes to `GET /pages/:pageId/edit`. It is the page's one Kindle-orange control, because it is the human action. The `e` key does the same when no field has focus.
- Edit mode opens the page's **working draft**. Everyone in edit mode on that page sees the same draft and each other's cursors, live (Yjs, below).
- **Save** publishes the draft as one new version and returns to the read view. **Discard** throws the draft away after asking, and asks more firmly when someone else is in it. Leaving without either keeps the draft for next time.
- **The published page changes only on Save.** Readers, search, agents and exports see the last saved version, never a draft in progress. This is what keeps live co-editing from bringing accidental edits back.
- A page with an open draft shows editors a notice in the read view: who started it and when.
- Edit mode is its own URL for three reasons: it works with scripts off, a phone or a native app can link to either mode, and the editor's code loads only on the edit route so reading stays fast.

**Borrowed from:** BookStack and Wiki.js (read-only view with an explicit edit action), Docmost (its setting is described as "Avoid accidental edits"), Outline ("Separate editing", with a "Done editing" control). All four are verified from the projects' own repositories or documentation, except the BookStack and Wiki.js default behaviour, which is from general knowledge and not verified this session.

### Markdown stays the stored format

Whole-document markdown at rest, as the plan decided. The dialect is GitHub-flavoured markdown plus three additions, each chosen because a plain markdown reader (GitHub, Obsidian, a text editor) still shows it sensibly:

| Notion feature | Stored as |
|---|---|
| Callout | An alert blockquote: `> [!NOTE]`, `> [!WARNING]` |
| Toggle and toggle heading | `<details><summary>…</summary>…</details>` |
| Highlight (any colour) | `==text==`; colours are dropped |
| Link to a page | A standard link to the page's permanent address: `[01.47 Security Guidelines](/pages/<id>)` |
| Table of contents block | Nothing stored; the read view generates it |
| Columns | Flattened top to bottom |

Rendering is server-side, with `unified`, `remark` and `rehype` (already the plan's choice, §11) and a sanitising step, so the web screen, a phone app and PDF export all get the same HTML. **Not verified:** that this pipeline runs inside a Worker within its CPU limit on the largest page (147,000 characters). The first rendering issue measures it.

### Wiki links

`[[Page title]]` is the way to link, and it works for input everywhere text enters the platform.

- **In the editor,** typing `[[` opens a picker over the same title index as the Quick Switcher. Choosing a page inserts the link.
- **In plain markdown,** from the fallback editor, an agent's `write_page`, the import or a pasted note, `[[Page title]]`, `[[01.47]]` and `[[Page title|shown text]]` are accepted as written. On save the server resolves each one and rewrites it to a standard link to the page's permanent address, so one path handles every source.
- **Resolving:** an exact JD ID first, then an exact title or alias, case-insensitive, preferring a page in the same area. A title that matches several pages is left as written and listed for the author to choose.
- **A link to a page that does not exist yet** stays as `[[Page title]]`, shows in the read view as a link that offers to create the page, and resolves by itself once a page with that title exists. This is how Obsidian behaves, which staff already use.
- **At rest, links carry the page's ID,** not its title or slug, so renaming or moving a page breaks nothing. The shown text follows the page's current title unless the author gave their own.
- `page_links (from_page, to_page, rel)` is rebuilt on every save from the body, with `rel` one of `links`, `embeds` or `unresolved`. Backlinks are a query on it.

### Transclusion

One text, shown on several pages, edited in one place. This replaces Notion's synced blocks.

- **Input:** `![[Page title]]` embeds a whole page and `![[Page title#Heading]]` embeds one section. The editor offers it from the slash menu and from the `[[` picker.
- **At rest:** an embed of the page's permanent address, by ID, resolved on save the same way as a link.
- **Rendering:** the server inserts the source's last saved text when the page is read, so a change to the source appears everywhere at once. The embedded text is framed, names its source and links to it. It is read-only in place; "Edit source" goes to the source page's own pencil.
- **Access:** checked for the reader, not the author. A reader who may not read the source's area sees "You do not have access to this section" in its place and nothing else about it.
- **Limits:** a page cannot embed itself, directly or through a chain; saving refuses a cycle, and embeds nest two levels deep at most.
- **Search and history:** a page's index holds its own text, so embedded text is found once, on its source. A version stores the reference, not a copy. Exports to markdown and PDF write the embedded text out in full.
- **A removed heading or retired source** shows "This section no longer exists" with a link to the source's history, and appears on the stale-page list.

### Navigation

- **Sidebar:** "Pages & Wiki" becomes a built module. It opens a browse screen with one section per area the person may read.
- **Area home:** each area may name one page as its landing page (the hand-kept list the Notion wiki home is today), with the generated tree of that area's pages beside it.
- **Categories:** every `knowledge` page is filed in one category, two digits such as `60`, `61`, `70` or `74`. Its area is the category's decade (`61` is in `60-69`), set by the server, so the two cannot disagree. A page's `jd_id`, when it has one, must start with its category.
- **Clusters:** `60-79 Field Programs` is a cluster of two areas, `60-69` and `70-79`. The sidebar shows it as one group; pages, grants and reads stay on the decade, so ADR 0015 and the area form are unchanged.
- **Tree:** area or cluster, then category, then pages by `parent_id`, ordered by JD ID and then title.
- **Breadcrumbs:** area, then the parent chain.
- **Listed by default:** `knowledge` pages. The agent and harness types (`skill`, `persona`, `learning`, `issue` and the rest) stay where they are and are reachable by search with a type filter, so several thousand mirrored GitHub issues do not bury the wiki.

### Quick Switcher (Cmd/Ctrl+O)

A small island in the shell, present on every screen.

- **Opens on** Cmd+O on macOS and Ctrl+O elsewhere, and also on Cmd/Ctrl+K, which is what Notion, Outline, Docmost, Slack and Linear use, so muscle memory from any of them works. Inside the editor Cmd/Ctrl+K stays "insert link" and Cmd/Ctrl+O still opens the switcher.
- **Empty query:** your recently viewed pages, most recent first. Pressing Enter straight away returns to the page you were on before, as in Obsidian.
- **Typing:** fuzzy match on title, JD ID and aliases, so `0147`, `sec guide` and `security` all find `01.47 Security Guidelines`. Titles only; this is for jumping, not for searching.
- **Keys:** arrows to move, Enter to open, Cmd/Ctrl+Enter for a new tab, Escape to close.
- **Last rows:** "Search all text for …" (opens full-text search) and, for a person who may write, "Create page …".
- **How it matches:** the island fetches the title index of every page the person may read, once, and matches in the browser with a small fuzzy matcher. Inferred: at unfoldingWord's size (about 50 wiki articles today, a few thousand pages after import) this is tens of kilobytes and feels instant, and it is the same index a phone or desktop app would keep for offline use. The index is revalidated with an ETag.
- **Not verified:** that a page can take Cmd/Ctrl+O away from the browser's "Open file" in Chrome, Safari and Firefox on macOS and Windows. Web apps are generally able to (the research found one Mozilla source saying so; Safari was not confirmed). The switcher issue tests all six combinations by hand before it closes. If one fails, Cmd/Ctrl+K is the fallback there, and the desktop app owns Cmd+O outright.
- **No palette library.** `cmdk` and `kbar` need React; the framework-free option is stale. A native `<dialog>` plus a matcher such as `@leeoniya/ufuzzy` (MIT) or `fuzzysort` (MIT) fits the islands as they are built today.

### Full-text search

- **What is searched:** title and body together, with the title, JD ID, tags and overview weighted above the body. A "titles only" switch narrows it. This answers the open question in the request: both, with the title counting for more.
- **Index:** a stored, generated `tsvector` column on `pages` with a GIN index, built with `setweight`, replacing the per-query computation.
- **Language:** `english`, so "budget" finds "budgeting", in place of today's `simple`. Quoted phrases get an exact-match fallback, because stemming breaks them (Outline does the same).
- **Query:** `websearch_to_tsquery`, which accepts anything a person types, including quotes and `-word`, and cannot raise a syntax error.
- **Typos:** a `pg_trgm` index on the title offers "did you mean" when a search finds nothing. Verified: Aurora PostgreSQL 16 and 17 list `pg_trgm`. **Not verified:** that the embedded Postgres the sim uses loads it; if not, typo tolerance is left to the Quick Switcher's matcher and the database side is plain full-text.
- **Snippets:** `ts_headline` on the returned page of results only, over a capped length of body, with its output escaped (Docmost's approach; the Postgres documentation warns it is slow and not HTML-safe).
- **Filters:** area, page type, owner, updated since.
- **Permissions:** the existing `readableAreas` filter inside the SQL, unchanged.
- **One reader:** the search screen, the JSON endpoint and the agent verb `search_pages` all call the same function, so agents get the index too.
- No external search engine. Neither Outline nor Docmost uses one at this scale.

### The editor

Milkdown (MIT) with its Crepe interface, on ProseMirror, loaded only on the edit route. Milkdown parses and writes markdown itself, through remark, so markdown is the editor's own source; the stored body never becomes editor JSON. ADR 0017 records the decision.

**The risk to manage:** remark writes some markdown differently from how it was typed (bullet markers, table padding) and escapes syntax it does not know, such as `[[wiki links]]`. A golden-file test (`apps/uw-app/markdown/editor-round-trip.node.test.ts`) opens and saves sample articles and fails on any change of meaning, and a small plugin keeps the wiki's own syntax as typed. A page that does not survive the round trip opens in a plain markdown editor instead, which is today's textarea and remains available to anyone who prefers it.

**Live co-editing with Yjs, from the start** (decision 2, and the platform plan's original position).

- **One sync hub per page being edited:** a Durable Object, on the y-partyserver pattern the plan names, holding the page's working draft as a Yjs document. It is created when the first editor opens edit mode and costs nothing while idle.
- **Joining** needs `can(write)` on the page's area, checked at connect and again on Save. A reader never connects to it.
- **Markdown stays canonical.** The Yjs document is the draft, not the record. Save sends the draft's markdown through the same `update_page` command and validation as every other write, producing one version. If the sync layer were ever removed, the corpus is complete without it.
- **The draft survives** a closed tab, a dropped connection and the hub going idle, because the hub stores it. It ends on Save or Discard.
- **An agent's write, or a restore, while a draft is open** is merged into the draft as a Yjs change, as the plan describes, so nobody's work is overwritten.
- **Presence:** names and cursors of the people in the draft.
- **Offline later:** the desktop app and the phone app join the same hub with the same protocol and exchange updates on reconnect. Nothing here has to be rebuilt for them.
- A new word for `CONTEXT.md`: **sync hub**, which the glossary already reserves for exactly this.

**Not verified:** that converting markdown to a Yjs change runs inside the Durable Object without a browser, which merging an agent's write needs. If it does not, an agent's write during an open draft is saved as a version and the people in the draft are shown the difference to merge by hand.

### Files and images

A `files` table (area, classification, content type, size, hash, uploader) and the R2 bucket the plan already names, `uw-files`. A file is served through a route that checks `can(read)` on its area; nothing is public. Paste or drop an image in edit mode to upload.

### Access

- **Reading:** unchanged. A page's area decides, per ADR 0015.
- **Everyone reads the knowledge base.** Every approved person receives `viewer` on `00-09` by default: a visible, audited grant made at approval, and made once for the people already approved (decision 4).
- **Editing:** `editor` on the page's area, as today. Most staff will be readers of `00-09`, which is the point; the comment feature is how a reader flags something wrong.
- **Field Programs:** a grant is made on `60-69` or `70-79`. The Access screen offers both together when granting on the cluster.

### Built for a second client

A phone app is out of scope, and it decides the shape of this work now. The rule: **every screen is drawn from a read function that also has a JSON route, and every change goes through a command in `packages/contracts`.** The web screens get no private path.

| Need | Addition |
|---|---|
| Browse | `GET /api/pages?area=&parent=&type=&cursor=` |
| Jump | `GET /api/pages/index` (the title index, with an ETag) |
| Search | `GET /api/pages/search?q=…` |
| Co-edit | `GET /api/pages/:id/draft` upgrades to the sync hub's socket; the same protocol for web, desktop and phone |
| Read | `GET /api/pages/:id` gains `?format=html` for the rendered body, plus `capabilities` (`canEdit`, `canRetire`, `canComment`) so a client never re-implements `can()`; Outline's `policies` array is the model |
| History | `GET /api/pages/:id/versions` and `…/versions/:n` |
| Save | Command replies carry the new `version`; page commands record `requestId` in the request ledger so a retry from a queue is safe |
| Files | `POST /api/files`, `GET /api/files/:id` |

All of these are Zod contracts with fixtures, like the existing ones. Lists page with a cursor. A client-supplied page ID (already required by `create_page`) is what lets an offline client create a page and link to it before it syncs.

**Carried forward, not solved here:** a native app cannot use the browser's Cloudflare Access cookie, and service tokens are refused on the app surface by design. How a phone signs a person in is the mobile app's first design question. Nothing above makes it harder.

**Offline:** `knowledge` pages are `internal` and `sync`, the plan's classification for wiki content (§2.6). `files` needs its own declaration; an attachment inherits its area.

## Part 5. Ideas borrowed

No product is adopted and no code is copied. Licences were read from each project's repository on 2026-11-20.

| From | Licence | What is borrowed |
|---|---|---|
| Obsidian | Proprietary | The Quick Switcher: Cmd+O, titles and aliases only, recents when empty, create from the query |
| Docmost | AGPL-3.0 | Read and edit modes; capped search snippets; backlinks in a details panel; timed history |
| Outline | BSL 1.1 | "Separate editing"; a permissions list on every API answer; search ranking with an exact-phrase fallback; one API for every client |
| BookStack | MIT | "Someone started editing this page N minutes ago" as a warning, not a lock |
| HedgeDoc | AGPL-3.0 | Whole-document markdown with view and edit modes (not verified beyond the licence) |
| AppFlowy, AFFiNE, Logseq, SiYuan, Anytype, Trilium | AGPL, MPL or source-available | Reviewed; block or object stores that do not fit a markdown document model |

**New dependencies this plan would add**, all permissive, each named again in the pull request that adds it: `unified`, `remark`, `rehype` and a sanitiser (MIT); Milkdown and its Crepe interface, with its collaboration plugin and `y-prosemirror` (MIT); `yjs` and `y-partyserver` (MIT; licences to be confirmed in the pull request); a fuzzy matcher (MIT); a diff library (plan §11 names `diff-match-patch`, Apache-2.0); `@notionhq/client` (MIT) for the import only.

## Part 6. The Notion import

A one-time job, safe to run again, with a dry run first.

- **Source:** Notion's own markdown endpoint (`GET /v1/pages/:id/markdown`), verified to exist in Notion's developer documentation. It returns child pages and databases as tags to follow, and file links that expire, so images are downloaded immediately. **Not verified:** how faithful it is on our pages; the dry run answers that. `notion-to-md` (ISC) is the fallback.
- **Mapping:** a leading `NN.NN` in the title gives `jd_id`, its first two digits the category, and the category the area. A page with no ID takes its parent's category; one with neither is listed in the report for a person to file. Owner, Tags, Overview and Verification to frontmatter. Parent page to `parent_id`. Callouts, toggles and highlights to the dialect in Part 4.
- **Synced blocks:** each becomes a small page of its own under the page that held the original, and every place it appeared embeds that page.
- **Links:** two passes. Every page is created first and its Notion ID recorded; then every mention is rewritten to the new permanent address. A link to something not imported stays a Notion link and is listed in the report.
- **Old addresses:** the Notion ID is kept on each page, so `/notion/<id>` can redirect a bookmarked Notion link to the new page.
- **Left behind on purpose:** teamspaces in the trash, databases (a link back to Notion stands in), cover images, column layouts (flattened), comment threads (counted in the report, so the owner of a page with open threads can settle them first).
- **The dry-run report:** every page with its target area, every block type that would be flattened or dropped, every unresolved link, and every page over the size limit. It is also the full inventory that Part 1 only sampled.
- **Done when:** the plan's own check passes (20 pages across areas compared by eye against Notion), every internal link resolves, and the knowledge base is locked read-only in Notion with a banner pointing to the platform.

## Decisions (Jesse, 2026-11-20)

1. **Scope:** the knowledge base is the first slice of the Notion replacement, ahead of the databases.
2. **Yjs from the start.** Live co-editing and the per-page sync hub are part of the first build, not deferred. The proposal had recommended deferring.
3. **Transclusion is required.** The proposal had left it out.
4. **Everyone reads `00-09`:** every user has a default `viewer` grant on it.
5. **`60-79` is a cluster, and a page is always filed in a category** (`60`, `61`, `70`, `74`). Reading of this ruling, to confirm in review: the page's area stays the category's decade, so the area form, grants and ADR 0015 are unchanged, and the cluster is a grouping in navigation.
6. **Wiki links work for input:** `[[Page title]]` is accepted everywhere text is entered.
7. **One issue for the build,** not 22, and a separate one for the content migration.
8. **Taken as recommended:** `english` search stemming; links stored by page ID; no "always editable" preference; private pages left out.

## Issues

Two issues, each one pull request into `develop`.

**1. Knowledge base: read-first pages, Quick Switcher, search, wiki links, transclusion and live co-editing.** Everything in Parts 3 and 4, including the import tooling's prerequisites (files, the `/notion/<id>` redirect, the recorded Notion ID). It is one issue by decision 7. The order of work inside it, each step leaving `develop` releasable:

1. Words in `CONTEXT.md`; the `knowledge` type with `jd_category`; the category list and the cluster.
2. Rendered read view; the pencil and the edit route.
3. Search index; the page read API with `capabilities`; commands that return the version and use the request ledger.
4. "Pages & Wiki": browse, tree, breadcrumbs, table of contents; the default `00-09` grant.
5. Quick Switcher on Cmd/Ctrl+O and Cmd/Ctrl+K, with recently viewed pages and the six-browser check; the search screen.
6. Wiki links and `page_links`; backlinks; transclusion.
7. Files and images.
8. The editor: the markdown round-trip golden test, Milkdown Crepe, the `[[` picker and slash menu, then the sync hub, drafts and presence.
9. Create, rename, move, retire, restore, duplicate; history compare and restore.
10. Owner and verification with the reminder; favourites; templates; comments; export to markdown and PDF.

Shared roots it touches: `packages/contracts`, `packages/db/schema-platform.ts`, `packages/harness/ports.ts` (files), `packages/core/acl.ts` only if the default grant needs it, `infra/` (the sync hub and the R2 bucket), `CONTEXT.md`, and `docs/adr/` (the editor and its markdown bridge; the sync hub and draft-then-save; categories and clusters).

**A caution on size, for the record:** AGENTS.md asks for one issue per pull request, files under 500 lines and scope equal to the issue. One issue this wide means one very large pull request, a long-lived branch and one review of everything at once. The steps above are written so the work can still land as several pull requests against the same issue if that proves easier to review; that is an owner's call.

**2. Knowledge base: migrate the Notion content.** Part 6: the dry run and its report, the write pass, link rewriting, synced blocks to embeds, images, verification against Notion, and setting the Notion knowledge base read-only (a person's step). Depends on issue 1.

**Later, with the desktop and phone work:** the local replica, and how a phone signs a person in.

## What this review did not verify

- The Notion workspace was sampled, not crawled. Page counts beyond the wiki are unknown until the dry run.
- Cmd/Ctrl+O interception in real browsers; markdown-to-Yjs conversion inside a Durable Object; the markdown pipeline's CPU time in a Worker; `pg_trgm` in the sim's embedded Postgres; the fidelity of Notion's markdown endpoint on our content; the editor's markdown round trip on our content. Each is a step of issue 1 or 2.
- No code was written or run for this proposal.
