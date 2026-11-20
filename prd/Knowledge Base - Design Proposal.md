# Knowledge Base: Design Proposal

**Status:** proposed, awaiting decisions (see "Decisions needed").
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
| Teamspaces are the JD areas, one of them `60-79 Field Programs` | Teamspace list | Pages cannot be stored in `60-79` today (Part 2, finding 4) |
| Articles use callouts, toggle headings, tables with a header row and column, code blocks, checklists, images, bookmarks, a table of contents, coloured highlights and columns | `01.26 Budgeting`, `01.35 Notion Training Guide`, `00.25 Operations Meeting` | These decide the markdown dialect (Part 3) |
| Pages link to each other constantly: 66 page mentions in the index, 133 in the Operations Meeting page | Same pages | Links must survive a rename, and backlinks are worth having |
| Inline comments are used on policy text | Five threads on `01.47 Security Guidelines`, several on `01.26 Budgeting` | Comments are a real use, though a later one |
| One long-running page per recurring meeting, a toggle per date, with action items as checkboxes (27 open, 22 done) and pasted transcript summaries | `00.25 Operations Meeting`, 147,000 characters | Works as a plain page at first. The plan's `meeting` type and universal tasks replace it later |
| Synced blocks exist but are rare | Two in the index, one in the training guide | Import them as plain copies. Do not build transclusion |
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
4. **Field Programs cannot hold a page.** A page's area must be one decade (`^([0-9])0-\1[9]$`, `packages/contracts/areas.ts:3`), and Field Programs is `60-79`. The same check guards `tasks`.
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
| 3 | **A `knowledge` page type** | Optional frontmatter: `jd_id`, `owner`, `tags`, `overview`, `icon`, `aliases`, `verified_by`, `verified_until` |
| 4 | **Navigation** | "Pages & Wiki" in the sidebar, a page tree per area, breadcrumbs, an on-page table of contents |
| 5 | **Quick Switcher on Cmd/Ctrl+O** | Titles, JD IDs and aliases; also on Cmd/Ctrl+K |
| 6 | **Full-text search** | Title and body, title weighted higher, snippets, filters |
| 7 | **Create, move, rename, retire and restore a page** | Retire is the existing `retired` status; it is the trash |
| 8 | **Links between pages that survive a rename** | Type `[[` to pick a page |
| 9 | **Images and attachments** | The imported articles are full of screenshots |
| 10 | **History with a diff and restore** | Snapshots exist; the comparison and the restore command do not |
| 11 | **A real editor** | Formatting without knowing markdown |
| 12 | **The Notion import** | Part 6 |

### Should have soon after

Backlinks. Favourites and recently viewed. Owner and verification with a reminder when verification expires, and a stale-page list. Templates. Page comments, then comments anchored to a passage. Export to markdown and PDF (plan §16). A "someone else is editing" notice.

### Deliberately not building

- **Block storage.** The plan rejected it (§2); nothing found here argues otherwise.
- **Inline databases inside pages.** Typed records replace them.
- **Synced blocks, multi-column layouts and cover images.** Rare or decorative in the sample.
- **Per-page sharing.** A page's area is its scope (plan §4). Private personal pages are an open question, not part of this proposal.
- **Always-on editing as a preference.** Outline and Docmost both let a person switch back to always-editable. That would bring the original problem back for anyone who chose it, so there is no such setting.

## Part 4. Design

### Read first, edit on purpose

- `GET /pages/:pageId` is always the read view: rendered markdown, breadcrumbs, table of contents, properties, backlinks. It never contains a form field for the body.
- A pencil button in the page header, shown only when the person may write, goes to `GET /pages/:pageId/edit`. It is the page's one Kindle-orange control, because it is the human action. The `e` key does the same when no field has focus.
- Edit mode has **Save** and **Cancel**. Save writes one new version and returns to the read view. Cancel returns without writing and asks first when there are unsaved changes. Nothing is saved without Save.
- Unsaved text is kept in the browser until saved or discarded, so a closed tab does not lose work. It never becomes a version by itself.
- A stale save is refused as it is today (`stale_version`), with both texts kept so nothing is lost.
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

Links store the page's ID, not its title or slug, so renaming or moving a page breaks nothing. `page_links (from_page, to_page)` is rebuilt on every save by reading the links out of the body; backlinks are a query on it.

### Navigation

- **Sidebar:** "Pages & Wiki" becomes a built module. It opens a browse screen with one section per area the person may read.
- **Area home:** each area may name one page as its landing page (the hand-kept list the Notion wiki home is today), with the generated tree of that area's pages beside it.
- **Tree:** from `parent_id`, ordered by JD ID and then title. Pages without a JD ID follow.
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

Tiptap (MIT) on ProseMirror, as the plan chose, loaded only on the edit route. It reads and writes markdown; the stored body never becomes editor JSON.

**The risk to manage:** the official `@tiptap/markdown` package still describes itself as an early release, and its documentation does not promise a lossless round trip. `prosemirror-markdown` (MIT, used by Outline) is the alternative. Before either is adopted, a golden-file test opens and saves every imported article unchanged and fails on any difference. A page that does not survive the round trip opens in a plain markdown editor instead, which is today's textarea and remains available to anyone who prefers it.

**Realtime co-editing (Yjs) is not in this proposal.** The plan adopted it from Phase 0 because offline editing makes divergence normal. That reasoning still holds for the desktop app. Read-first changes the online case: with an explicit edit mode, a version check and a "someone else is editing" notice, two people rarely collide. Recommendation: build the editor so Yjs can be added (Tiptap has the binding) and add the per-page sync hub with the desktop and offline work (plan Phase 2.5), not before. This departs from the plan's "adopted from Phase 0" and is Decision 2.

### Files and images

A `files` table (area, classification, content type, size, hash, uploader) and the R2 bucket the plan already names, `uw-files`. A file is served through a route that checks `can(read)` on its area; nothing is public. Paste or drop an image in edit mode to upload.

### Access

- **Reading:** unchanged. A page's area decides, per ADR 0015.
- **The knowledge base must be readable by all staff.** Under ADR 0015 that needs a grant. Recommendation: every approved person receives `viewer` on `00-09`, as a visible, audited grant made at approval. This is Decision 3.
- **Editing:** `editor` on the page's area, as today. Most staff will be readers of `00-09`, which is the point; the comment feature is how a reader flags something wrong.
- **Field Programs:** Decision 4.

### Built for a second client

A phone app is out of scope, and it decides the shape of this work now. The rule: **every screen is drawn from a read function that also has a JSON route, and every change goes through a command in `packages/contracts`.** The web screens get no private path.

| Need | Addition |
|---|---|
| Browse | `GET /api/pages?area=&parent=&type=&cursor=` |
| Jump | `GET /api/pages/index` (the title index, with an ETag) |
| Search | `GET /api/pages/search?q=…` |
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

**New dependencies this plan would add**, all permissive, each named again in the pull request that adds it: `unified`, `remark`, `rehype` and a sanitiser (MIT); Tiptap core and the chosen markdown bridge (MIT); a fuzzy matcher (MIT); a diff library (plan §11 names `diff-match-patch`, Apache-2.0); `@notionhq/client` (MIT) for the import only.

## Part 6. The Notion import

A one-time job, safe to run again, with a dry run first.

- **Source:** Notion's own markdown endpoint (`GET /v1/pages/:id/markdown`), verified to exist in Notion's developer documentation. It returns child pages and databases as tags to follow, and file links that expire, so images are downloaded immediately. **Not verified:** how faithful it is on our pages; the dry run answers that. `notion-to-md` (ISC) is the fallback.
- **Mapping:** teamspace to area. A leading `NN.NN` in the title to `jd_id`. Owner, Tags, Overview and Verification to frontmatter. Parent page to `parent_id`. Callouts, toggles and highlights to the dialect in Part 4.
- **Links:** two passes. Every page is created first and its Notion ID recorded; then every mention is rewritten to the new permanent address. A link to something not imported stays a Notion link and is listed in the report.
- **Old addresses:** the Notion ID is kept on each page, so `/notion/<id>` can redirect a bookmarked Notion link to the new page.
- **Left behind on purpose:** teamspaces in the trash, databases (a link back to Notion stands in), cover images, column layouts, comment threads (counted in the report, so the owner of a page with open threads can settle them first).
- **The dry-run report:** every page with its target area, every block type that would be flattened or dropped, every unresolved link, and every page over the size limit. It is also the full inventory that Part 1 only sampled.
- **Done when:** the plan's own check passes (20 pages across areas compared by eye against Notion), every internal link resolves, and the knowledge base is locked read-only in Notion with a banner pointing to the platform.

## Decisions needed

1. **Scope.** Is the knowledge base (this proposal) the right first slice of the Notion replacement, ahead of the databases? Recommended: yes. It is small, self-contained, and the part named as the priority.
2. **Realtime co-editing.** Defer Yjs and the per-page sync hub to the desktop and offline work, or keep the plan's "from Phase 0"? Recommended: defer. If wrong, the cost is adding the sync layer under a live editor later, which the plan judged expensive; the mitigation is choosing the editor that already has the binding and keeping markdown canonical.
3. **Who reads the knowledge base.** Give every approved person `viewer` on `00-09` at approval? Recommended: yes. The alternative is an org-wide `viewer` grant per person, which also opens Finance.
4. **Field Programs (`60-79`).** Either pages are filed under one decade (`60-69` or `70-79`) and the sidebar keeps showing one "Field Programs" group, or the area form is widened to allow a two-decade area. Recommended: keep one decade per area and file under the decade, because the area form is a shared rule across pages, tasks, grants and the ACL, and ADR 0015's "a grant on an area reads only that area" is simplest when an area is one thing. This needs your knowledge of how 60 to 69 and 70 to 79 are actually used.
5. **Search language.** `english` stemming in place of `simple`? Recommended: yes. Names and identifiers still match exactly; the cost is a rebuild of the index if another language's content arrives.
6. **Links stored by page ID.** Recommended: yes. The cost is that a raw markdown file shows an ID in the link target; the markdown export rewrites links to relative file paths.
7. **Private pages.** Out of this proposal. Say if staff rely on Notion's private section enough that it must come with the first release.

## Proposed issues (one pull request each, into `develop`)

An epic, "Knowledge base: replace the Notion wiki", with these sub-issues in order. The first five are the smallest release that is useful by itself: read, browse, jump and search existing pages.

**Slice A. Read and find**

1. Words: add Page, Knowledge page, Read view, Edit mode, Quick Switcher, Backlink and Area home to `CONTEXT.md`; correct the stale "Page type" entry (shared root).
2. Page type `knowledge` with optional frontmatter, `open` gating, `internal` and `sync` (shared root: `packages/contracts`; migration for the type check).
3. Read view: markdown rendered on the server and sanitised; the page screen shows it by default; the pencil goes to `/pages/:id/edit`, which holds today's form; Save and Cancel; the Worker render time measured on the largest page.
4. Search index: generated weighted `tsvector`, GIN index, `english`, `websearch_to_tsquery`, snippets; `search_pages` uses it (migration; decision 5).
5. Page read API: list, children, title index, search, versions; `capabilities` on a page; commands return the version and use the request ledger (shared root: `packages/contracts`).
6. "Pages & Wiki": the browse screen, the area tree, breadcrumbs and the on-page table of contents; the sidebar item becomes built.
7. Quick Switcher island on Cmd/Ctrl+O and Cmd/Ctrl+K, with recently viewed pages (new table `page_views`) and the six-browser check.
8. Search screen with filters and "titles only".
9. Access: `viewer` on `00-09` at approval (decision 3); the Field Programs ruling (decision 4, ADR if the area form changes).

**Slice B. Write**

10. Create, rename, move, retire and restore a page from the screen; duplicate a page.
11. `page_links` rebuilt on save; links by page ID; backlinks on the read view (migration).
12. Files: the `files` table, the R2 adapter behind a port with its test adapter and contract suite, upload and the checked read route (shared roots: `packages/harness/ports.ts`, `infra/`).
13. Editor: the markdown round-trip golden test over real articles, then Tiptap on the edit route with the `[[` page picker, slash menu, tables, callouts and collapsible sections; plain markdown editing kept as the fallback (ADR: the editor and its markdown bridge).
14. History: compare two versions and restore one.

**Slice C. Move in**

15. Notion import, dry run and report only.
16. Notion import, the write pass, link rewriting, images, `/notion/<id>` redirects.
17. Import verification and the Notion knowledge base set read-only (a person's step).

**Slice D. Keep it true**

18. Owner and verification on a page, a reminder when verification expires, and the stale-page list.
19. Favourites; templates.
20. Comments on a page, then anchored to a passage (plan §2.4's `page_suggestions` with kind `comment`).
21. Export a page to markdown and PDF (plan §16).
22. "Someone else is editing" notice.

**Later, with the desktop and offline work:** Yjs and the per-page sync hub (decision 2), the local replica, and the phone app's sign-in.

## What this review did not verify

- The Notion workspace was sampled, not crawled. Page counts beyond the wiki are unknown until the dry run.
- Cmd/Ctrl+O interception in real browsers; the markdown pipeline's CPU time in a Worker; `pg_trgm` in the sim's embedded Postgres; the fidelity of Notion's markdown endpoint on our content; Tiptap's markdown round trip on our content. Each is assigned to an issue above.
- No code was written or run for this proposal.
