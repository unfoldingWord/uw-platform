---
status: accepted
date: 2026-11-21
---
# A page is read on a sheet beside its page tree, and edited in focus mode

The owner was not happy with how a person moves between pages or with the switch from reading a page to editing it. Three designs were drawn on a Claude Design canvas (a page tree beside every page; tabs with a side rail; and the one chosen here) and the owner chose the third, "Focus", on 2026-11-21. This ADR records it, because it departs from the prototype ADR 0014 makes the visual authority: the prototype has no knowledge base, and its frame is the same on every screen.

**Before.** "Pages & Wiki" was one sidebar row. A reader reached a page through three screens (the wiki, an area, a category) and, once there, had only the breadcrumb to move on. The read view was a page head, a card holding the text, and seven underlined links above and below it. Edit mode was a different screen: a "Edit this page" card with a Title field, the editor, an upload field, and Save and Cancel at the bottom.

**Decision.**

1. **The page tree lives in the sidebar.** On every wiki screen and every knowledge page screen, the "Pages & Wiki" row opens into a branch of the sidebar: each area group the reader may read, the categories of the group they are in, and the pages filed at the top of the category they are in, with the page they are on marked current. The branch is built per request from the same reads the wiki screens use (`categoryCounts`, `pagesInCategory`), so it shows only what the reader may read. A category with more pages than the branch shows ends in a "More in NN" row to its own screen. On a phone the same branch is in the menu.
2. **A page is read on a sheet.** The title, its JD ID, a line of facts (owner, verification, version, open comments), the contents as chips, and the actions sit above a single bordered sheet in the reading column (`max-w-flow`). Below it: the previous and next pages in the category, the pages under this one, the pages linking here, and the history, closed by default. The actions are Favourite, Edit, and a "More" menu that holds the rest (comments, comment on a passage, export, print, new page under this one, move, copy or retire).
3. **Edit mode is focus mode.** `/pages/:pageId/edit` keeps its address, its form post and every hook the editor island reads, but the shell draws no sidebar, top bar or status bar. One Ocean bar across the top holds "Back to reading", the page's JD ID and title, the working draft's status and the people in it, Discard draft and Save. Under it is the same sheet as the read view, with the title as a large field and the text in the editor, so opening edit mode changes what can be typed, not where things are. The formatting toolbar floats at the bottom of the window. Esc, when focus is not in a field or the editor, goes back to reading; the working draft is kept by the sync hub (ADR 0017), and a page opened as text says that leaving drops what was typed.
4. **Kindle stays a human action.** Edit, Save and New page are the only orange controls. The Ocean bar uses the sidebar's roles (`side`, `side-text`, `side-line`), so dark and light follow the system as the sidebar already does.
5. **No new token.** The layout uses the existing scales and theme roles. The tree's indentation uses spacing steps 6 to 8.

**Rejected.**

- **A second panel for the tree beside the sidebar** (the canvas's option A). It takes 280 px from every page, and the sidebar already lists the modules by area the same way the tree lists areas.
- **Read, Edit, History and Comments as tabs with a side rail** (option B). The cheapest to build, but it keeps edit mode a different-looking card and adds a rail to every page.
- **Edit in place on the read view's address.** The read view promises no field that can change the page (CONTEXT: Read view). A separate address keeps that promise, keeps the editor's 1 MB script off the read view (ADR 0017, point 3), and keeps every existing test of the form post.
- **A new tinted band token for the page header.** The sheet on the canvas gives the same separation with roles the contrast test already covers.

**Consequences.** Every knowledge page screen and wiki screen pays two or three extra reads for the branch; they are the same indexed reads the wiki screens already make. The screenshot check's pictures of the page and wiki screens are retaken in CI and reviewed by an owner before they are committed. Source: the owner on 2026-11-21.
