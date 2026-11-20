---
status: accepted
date: 2026-11-20
---
# Pages are edited in Tiptap, shared through a sync hub, and saved as markdown

The knowledge base (#175) replaces the Notion wiki. People there expect a formatted editor and to see each other typing. The platform's record of a page is its markdown, saved as numbered versions, and agents read and write that markdown directly. This ADR records how the two fit.

**Decision (2026-11-20).**

1. **Markdown stays the record.** The editor is a view of it. `apps/uw-app/markdown/editor-html.ts` turns markdown into the HTML the editor loads, and `markdown/from-editor.ts` turns the editor's HTML back into markdown on Save. The two are tested as a round trip (`markdown/round-trip.test.ts`, and through the real editor in `islands/editor/round-trip.test.ts`).
2. **A page the editor cannot show opens as text.** Before the editor starts it converts the page there and back. If the markdown would change, the person gets the plain text field and a line saying why. `?as=text` asks for the text field on purpose. No page is rewritten by being opened.
3. **The editor is its own script.** Tiptap, ProseMirror and Yjs are about 1 MB. They load only on `/pages/:pageId/edit` (`generated/editor.ts`), not in the islands bundle every screen loads.
4. **A working draft is shared, per page version.** `PageDraft` is a Durable Object built on `y-partyserver`. Its name is `<pageId>.<version>`. Everyone in edit mode on that version joins it over `GET /api/pages/:pageId/draft` (a WebSocket), which admits only a person who may write the page and only for the current version.
5. **Nothing reaches readers until Save.** Save is the same form post and the same `update_page` command as before, with the markdown of the draft. The page moves to the next version, the old version's sync hub is told to close, and the next person to edit starts a new one from the saved text. Discard sets the draft back to the saved text for everyone in it.
6. **The first content is the same for everyone.** The first person into an empty sync hub fills it from the saved page. Two people arriving together would both fill it, so the fill is built with a fixed Yjs client id: both produce the same bytes, and applying them twice changes nothing (`islands/editor/collaboration.test.ts`).
7. **A save from elsewhere is caught at Save.** An agent, the API or another tab can save a newer version while a draft is open. The draft's Save is then refused `stale_version`, as it always was, and the screen keeps what was typed and edits it alone, not in a shared draft, so two people's refused text is never merged into one.

**Rejected.**

- **Save the Yjs document, or Tiptap JSON, as the record.** Agents, search, links, embeds and history all read markdown. A second format would need a converter on every read and would make the versions unreadable outside the editor.
- **Autosave straight to the page, as Notion does.** The owner asked that a page not change by being opened or typed in. Readers and agents would also see half-written procedures.
- **One sync hub per page, reset on Save.** A browser that still held the old draft would merge it into the new one when it reconnected. A hub per version cannot be rejoined with stale text: the socket is refused once the version moves on.
- **Fill the first content on the server.** The Worker would have to run the editor's parser. The fixed client id gives the same guarantee with no editor code in the Worker.
- **Hocuspocus or a hosted collaboration service.** Either adds a server or a vendor outside Cloudflare. `y-partyserver` runs in the Worker the app already deploys.

**Consequences.**

- A working draft lives in its sync hub's storage, not in Postgres. It is kept until it is saved, discarded, or has been idle for 30 days.
- The read view asks the sync hub whether a draft is open, for people who may edit, and says so. That is one Durable Object call on those page views.
- A person's name beside their cursor is sent by their own browser. Only people who may write the page can connect, so the worst a person can do is mislabel their own cursor.
- A sync hub holds its sockets open without hibernation, so it is billed while people are in edit mode.
- A draft is stored as one value. Durable Object storage limits one value to 2 MB; a page's markdown is limited to 1 MB, so an ordinary draft fits, but a very long page with a long editing history might not, and its draft would then stop being stored. This has not been measured.
- The `PAGE_DRAFT` binding and its `v3` migration are in both wrangler files. Where the binding is absent the edit screen offers no shared draft and people edit alone.

Source: issue #175; `prd/Knowledge Base - Design Proposal.md`.
