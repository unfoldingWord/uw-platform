---
status: accepted
date: 2026-11-24
---
# A PDF is printed from the platform's own HTML, by Browser Run, with nothing fetched

Plan section 16 asks that any page, list view or dashboard export to a PDF that carries its provenance, with links footnoted, print styles taken from the tokens, and a sha256 that resolves back to the version it was printed from (section 2.4). Agents may produce a PDF but must not send one. Issue #198. Redline and appendix modes wait for suggested changes (#197); scheduled output is not part of this issue.

**Decision.**

1. **The renderer is a platform seam, not a harness port.** `PdfRenderer` (`apps/uw-platform/pdf/renderer.ts`) is shaped like `FileStore`: one adapter over the binding (`browserPdf`), one that records jobs for tests (`recordingPdf`), and `pdfRendererOf(env)` answering none when the binding is missing. The kernel never prints, so the ten ports stay as they are.
2. **The engine is Cloudflare Browser Run**, through the binding's `quickAction('pdf', …)`, as typed in the pinned `@cloudflare/workers-types`. No npm dependency is added. The binding is `[env.<name>.browser] binding = "BROWSER"` under staging, production and preview, in both `wrangler.toml` and `wrangler.go-live.toml`, because environments do not inherit it.
3. **The browser is handed one self-contained HTML document and fetches nothing.** Cloudflare Access covers the whole host, so the browser could not load the app anyway. The Worker inlines the app stylesheet, with its fonts as `data:` URIs. It inlines each page picture as a `data:` URI, read from R2 only after `serveFile` checks the reader may read it. It removes scripts and forms. The quick action runs with JavaScript off, `allowRequestPattern: ['^data:']`, `cacheTTL: 0` and the print media type.
4. **Any screen prints with `?format=pdf`.** `renderScreen` runs the screen's handler exactly as it does for the screen, the same reads and the same `can()`, and only the last step differs. A screen the reader may not see answers the same 404 with or without the query.
5. **Every PDF carries its provenance.** The source address (`APP_ORIGIN`, the path, the query without `format`), a reference, the filters, who exported it (a person's email or an agent's identity), the date through `formatDate`, and a sha256.
   - For a page or page version: reference `<area>/<slug>@v<version>`; the sha256 is over the canonical JSON of `{pageId, version, slug, title, frontmatter, bodyMd}` from that version's `page_versions` row, so anyone can recompute it.
   - For a saved view: reference `<collection>/<view name>`, the filter, sorts, grouping and place written in words, and a sha256 over `{viewId, settings, params, rowIds}` for the rows printed.
   - For any other screen: the path, the sorted query, and a sha256 over the printed HTML.
   - For a binder: a sha256 over the list of each page's reference and hash.

   The running footer holds the short line: reference, date, the first twelve characters of the hash, and page n of N. The closing Provenance block holds every field in full. The hash names what was printed, not the PDF's bytes, which differ on every render.
6. **Print styles come from tokens.** Paper is Letter, because unfoldingWord is US-based. Margins and the header and footer sizes are `--uw-print-*` tokens, resolved at build into `printMetrics` and `printColours` in `packages/ui/generated/app-css.ts` for the header and footer templates. `packages/ui/print.css` forces the light theme on paper, hides controls and anything marked `data-pdf-hidden`, repeats table headers and keeps rows, cards, figures and charts whole. Charts print as the vector SVG the server already draws.
7. **Links are footnoted on the server.** Each link in the printed body gets a superscript number, and the same address reuses its number. A numbered Links list of absolute addresses closes the body, before the Provenance block.
8. **A binder is an ordered set of pages printed as one PDF**, with a cover, a contents list and continuous page numbers. It is named by a titled list of 1 to 50 page ids, or by a root page with its readable descendants depth-first, in the page tree's order, root included, 50 at most. A page the requester cannot read is left out silently. The contents list links to anchors in the document and shows no page numbers.
9. **A binder always runs in the background**, as the `PdfExportRun` Workflow. It stores the file in the `FILES` bucket at `exports/<exportId>.pdf` and records it in `pdf_exports`, which `apps/uw-platform/pdf/exports.ts` alone writes. A single screen renders in the request and streams back. Every export made in the background or by an agent has a row.
10. **The download is `GET /api/exports/:exportId/file`**, behind Access like the rest of the host. The id is a random uuid, and each download checks `can(read)` again for the downloader on every area the export covers, as `/api/files` does. An export expires after seven days. The nightly cron deletes the object and marks the row `expired`, and a row past its time reads as expired before the cron reaches it.
11. **The agent verb `render_pdf` makes a PDF and never hands it over.** It needs a viewer grant and is in the `pages_and_context` group. A page or view target renders in the call and answers `{ exportId, status: 'ready', file, sha256, bytes }`. A binder target queues the Workflow and answers `queued`. The reply never carries the bytes, and the input has no recipient, address or email field. A service token is refused outside `/mcp`, so only a signed-in person can fetch the file. An agent can produce a deliverable and cannot send it.
12. **Previews get the browser and not the Workflow**, by the go-live rule. A binder on a preview Worker answers `not_wired`, while a single page or view still prints.
13. **Redline and appendix modes and scheduled output are out of scope** (#197).

**Rejected.**

- **Puppeteer or another npm package for the browser.** The binding's quick action does what the platform needs. A package would add a dependency and a session to manage, and the quick action needs neither.
- **An HMAC-signed download link.** A signing key is a new secret, and a person would have to set it in every environment. Access already admits only signed-in people, and the random id plus the `can()` check on every download gives the same assurance that `/api/files` already relies on.
- **A harness port for the renderer.** The kernel never prints. A port would bring a contract suite, a sim adapter and a change to the fixed ten ports, for code only the platform calls.
- **Page numbers in the contents list through `target-counter()`.** Chromium does not implement it. Two passes, rendering once to find the page numbers and again to print them, would double the cost of every binder.
- **Letting the browser fetch the app with `goto` and an Access service token.** That needs a token the browser holds, an Access policy that admits it, and a principal the app would have to mint for it. A failure there would show a login page in the PDF or let the browser read as someone it is not. Inlining keeps the reader's own `can()` as the only gate.
- **Storing an export as a page file** (`attach_file`). The plan says a PDF is an output, never a record. A page file outlives the page version it came from; an export expires.

**What this costs if wrong.**

- **The browser was tested only through a fake.** How Browser Run's Chromium handles the print stylesheet, the header and footer templates, `data:` fonts under `allowRequestPattern` and a large inlined document is unverified until staging prints. If one of them fails, the fix is in `print-document.ts`, `print-templates.ts` or `print.css`, not in the shape.
- **The account must be on Workers Paid with Browser Run enabled.** The Free plan allows ten browser minutes a day. A person checks this before the first staging deploy that prints.
- **A page or view rendered by `render_pdf` runs inside the `/mcp` request.** A very large view could reach the Worker's CPU or memory limit. If it does, those targets move to the Workflow too, and the reply becomes `queued`.
- **The Workflow renders as the principal stored with the request,** with the grants it held when the export was queued. A grant revoked in the seconds between queueing and rendering does not change what is printed. Every download checks the downloader's grants as they are now, so nobody gains a read they lost.
- **A binder's areas are fixed when it is queued.** If a page moves to another area before the render, the download still checks the areas recorded at queue time.
- **Footer page numbers come from Chromium's `pageNumber` and `totalPages`**, not from CSS. They count the whole binder, cover and contents included.
- **Without `target-counter()`, the contents list has no page numbers.** If readers need them, a second pass is the way back. It costs one more render per binder.
- **Without a signed link, nobody outside Access can download an export.** A forwarded link gives nothing away, and it also lets no partner read the PDF. If an outside recipient must download without signing in, that needs an HMAC link and its secret, and a person decides it.

**Consequences.** A new screen prints with no extra code. It marks what should not print with `data-pdf-hidden` and, when it has a better reference or hash than its path and HTML, sets `printed` on its `ScreenSpec`. Adding a print format, such as A4 or a redline, changes the tokens and `print-document.ts`, and no route.
