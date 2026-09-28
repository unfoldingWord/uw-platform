# An App For Everything - Executive Brief

*A vertically and horizontally integrated operating system for the whole organization.*

**Prepared for:** unfoldingWord leadership
**Date:** 2026-08-24 (updated; first issued 2026-08-21)
**Status:** Architecture plan complete; build not started

## The problem

Our operational data lives in five systems that do not work well together. Sage Intacct holds the general ledger. Virtuous holds donors and gifts. Notion holds knowledge, programs, and projects. A Google Sheet holds the rolling budget. FRED holds field engagements and training events. GitHub and ZenHub hold the development work.

Staff pay for this fragmentation in hours–AI pays for it in decisioning because it can't determine the source of truth. Program leads copy budget tables into Notion by hand and annotate the mismatches. FRED keeps its own list of 26 programs and 6 portfolios that duplicates the Notion Program Portfolio, so a question like "what training happened under the grants this foundation funded?" requires someone to stitch four exports together. Meeting recordings, transcripts, agendas, and action items sit unconnected until a person manually connects them.

## The proposal

We build one platform that holds all of it: knowledge base, program and product management, donor CRM, fund-accounting ledger, field data, and software development tracking, on one database with one login. AI coding assistance has dropped the cost of custom software far enough that a one-developer nonprofit can now build what only vendors could sell five years ago.

Three design commitments shape the system:

1. **One data spine.** The Strategic Cascade (Purpose, MTP, Principles, Strategic Intent, Programs, Projects, Tasks) and the Johnny.Decimal areas we already use become the organizational schema. Field reporting rolls up through programs to portfolios to funds to the donors who gave. Impact, money, and work appear on the same page.
2. **Markdown everywhere.** Pages render like Notion but store as plain markdown with typed properties, so staff and AI agents read and write the same documents. Policies attach at org, portfolio, program, and product levels, and AI agents load them before acting.
3. **AI agents as *governed* coworkers.** Agents subscribe to kanban work queues (grant drafting, product content, intake triage) and claim cards like any team member. Stage gates enforce human approval server-side. An agent cannot post a journal entry, send donor email, or publish a page; those actions do not exist in its toolset.

**Built as modules, rolled out one at a time.** The platform is a defined set of about twenty modules — core wiki, strategy, directory, ledger, contracts, expenses, CRM and giving, grants, field data, impact, story bank, publishing, documents, charts, development, communications, offline, observability, infrastructure, compliance — each with its own runbook, export path, and on/off switch. Nothing has to land all at once: a module can pilot with one team before the organization sees it, and another organization adopting this openly could take the wiki and strategy pieces without ever standing up a ledger.

Capabilities worth naming for leadership, because they are the daily-work ones:

- **Every page and view exports to PDF**, on letterhead, with a stamp tying the document back to the exact version it came from. Board packets, contracts, and grant reports come out of the same pipeline as the screens.
- **Charts are built in, not bolted on.** The Budget Report, Revenue Projection, and Team Charts dashboards already built this year move into the platform rather than being rewritten, and every chart publishes the data behind it.
- **Expense reimbursement becomes a forwarded email.** The system reads the receipt, works out from your calendar and responsibilities which program it belongs to, checks it against policy, and asks you to confirm. Finance still approves and posts; the machine only proposes.
- **A story bank with permissions built in.** Every field story carries its consent record and how far it may travel — staff only, named partners, newsletter, or open internet — and the system refuses to publish above that line. Stories link to the programs and grants they illustrate, so grant reports assemble narrative and numbers together.
- **Soft credits are first-class**, so the donor-advised funds, foundations, and matches that fund development tracks in Virtuous survive the move without ever distorting the general ledger.
- **The system watches itself.** Health, data freshness, and agent cost are visible on a page anyone can open; backups are drilled quarterly and scored; compliance reports — 990 exports, functional expense statements, the audit binder, access reviews, segregation of duties — are generated on a schedule rather than assembled under deadline.

## Platform and cost

Cloudflare Workers plus a managed Postgres database, with files in R2 and Google sign-in through Cloudflare Access. Estimated infrastructure cost: $25 to $60 per month. Stripe handles payments, so card data never touches our systems (and they handle all the payment processor requirements). Zulip, Zoom, and Google Calendar stay and connect through integrations; the platform correlates transcripts to meetings to projects and extracts suggested action items for human confirmation. A desktop app keeps a local, offline copy of pages and tasks so field staff in low-connectivity countries can work anywhere; financial and donor data never syncs to devices.

### What we spend today vs. what this costs

| Line item                         | Current annual cost | After cutover     |
| --------------------------------- | ------------------- | ----------------- |
| Sage Intacct (accounting)         | ~$40,000            | $0                |
| Virtuous (CRM + giving)           | ~$40,000            | $0                |
| Notion (knowledge management)     | ~$3,500             | $0                |
| FP&A package (budgeting/planning) | ~$30,000 avoided    | $0                |
| Platform infrastructure           |                     | ~$300–700         |
| Staff build & maintenance time    | ~$10,000            | $10,000           |
| **Total**                         | **~$123,500**       | **under $11,000** |

Two caveats. Subscriptions overlap during the transition: Sage may run a full parallel year and Virtuous stays read-only for months after migration, so the savings arrive in steps across the migration window, with the full amount recurring each year after cutover. Stripe's per-transaction fees continue and are comparable to what we pay through Virtuous today.

And the true ongoing cost includes **maintenance time plus AI tooling,** which we estimate as less than $15k per year, small against six figures but not zero. We already spend considerable staff time wrangling our CRM and donor giving pages, those costs will transfer over but can be simplified by the introduction on AI into the pipeline.

## The hard part: accounting

Building our own ledger is legal. The IRS and GAAP regulate the records, the audit trail, and the outputs, and the design meets those requirements from day one: append-only entries, donor-restriction tracking, functional expense dimensions, tamper-evident nightly exports retained seven years. The risk is audit acceptance, but we manage that up front and can provide any validation required. Sage remains the system of record, with monthly zero-difference reconciliation, for as long as we want. We cut over only when we and the auditors sign off.

## Timeline and sequence

Roughly 9-15 months to full cutover, and the calendar is still dominated by the deliberate accounting parallel run rather than build time; that run extends to a full fiscal year if the auditors want one. Order: foundation and wiki, then the Notion migration, then FRED, then CRM and giving, then the ledger, with publishing, GitHub, and meeting integrations built during the parallel-run wait. The added months over the first estimate are the modules named above — documents, charts, story bank, expenses, and generated compliance reporting — which are cheaper to build in than to retrofit, particularly the compliance artifacts the first audit will ask for.

## Top risks and mitigations

- **Bus factor of one.** Nightly exports of all data in open formats, runbooks stored inside the system, a boring TypeScript stack any contractor can maintain, and an annual restore drill run by someone other than the builder.
- **Audit friction on our ledger.** Addressed above; the audit firm gets a veto. The other parts of the system work even if we don't switch off of Sage.
- **Scope creep.** We integrate with Zulip, Zoom, Google Calendar, and GitHub rather than rebuilding them. The build list stays limited to what no vendor offers: an integrated app for all our information based on our cascade, our funds, our impact models, in one place.

## Independent confirmation

A peer team at Richwood Industries designed the same architecture for their company without seeing ours: one canonical data layer over every system, staff and AI agents reading and writing the same records, and agents whose forbidden actions do not exist as tools. Their published design brief cites our project as convergent prior art and calls two teams reaching the same shape from different starting points "the strongest signal either has that the architecture is right." We also borrowed their best refinements: an institutional memory layer so a lesson paid for once is filed once, evidence ledgers where every AI-gathered claim is marked observed, confirmed, inferred, or assumed, and an AI reviewer harness where independent reviewers argue with every substantial code change until it is clean, but only a human merges it.

## Why it matters

Every hour a program lead spends reconciling spreadsheets is an hour not spent serving the church partners we exist for. One shared dataset means grant reports draw from live data, donors see the impact chain their gift funded, and the whole team, human and AI together, works from the same source of truth. And the roughly $123,000 a year we now send to software vendors goes back to Bible translation.