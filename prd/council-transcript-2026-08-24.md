# LLM Council Transcript — "An App For Everything": Go / No-Go

**Date:** 2026-08-24
**Question brought to the council:** Review the brief and the plan and render an opinion on whether this should be built. Enumerate the pros and cons but make a final recommendation for a go/no go.

---

## The Framed Question

Should unfoldingWord — a US 501(c)(3) Bible-translation nonprofit, ~30–50 staff and contractors, working in low-connectivity and politically sensitive countries — build "An App For Everything," a single custom platform on Cloudflare Workers + Neon Postgres replacing Sage Intacct (GL, ~$40K/yr), Virtuous (donor CRM + giving, ~$40K/yr), Notion (~$3.5K/yr), a Google Sheet rolling budget, and FRED (field database)?

Scope proposed: markdown wiki, program/product/project management, native donor CRM with Stripe direct, a full double-entry fund-accounting general ledger replacing Sage from day one (GAAP/ASC 958, append-only, hash-chained exports, 990-ready), FRED field data, contracts/MOUs/work-orders with PM→CFO approval and commitment tracking, GitHub-synced dev boards, a Tauri desktop app with offline CRDT sync, meeting/transcript auto-correlation, and AI agents on kanban work queues under server-enforced approval gates.

Built primarily by **one person** — Jesse, technical leader and executive with other duties — working with AI coding agents.

Documented pain (verified against the live Notion workspace and FRED database): money flows through four disconnected systems reconciled by hand; one program page documents being $73K off plan from a mis-categorized multi-year ask; three parallel conflicting "program" taxonomies (Notion, FRED, grants DB); cross-system questions require stitching four exports together.

Claimed payoff: eliminate ~$113,500/yr software spend, recover staff hours, unify impact + money + work in one dataset.

At stake: the organization's books, donor records, and field data. Failure modes include failed audit, lost donor trust, or an unmaintainable system if the single builder becomes unavailable.

---

## Advisor Responses

### The Contrarian (anonymized as Response C)

Three things in this proposal are not what they claim to be.

**The savings number is fiction.** $30K of the $113.5K is an FP&A package they never bought — you cannot save money you weren't spending. Notion at $3.5K is noise. And the number omits the only cost that matters: Jesse. An executive-level technical leader burning 50-60 weeks of build capacity has an opportunity cost well north of $113K/yr. The financial case is negative before the first commit.

**The timeline is internally contradictory.** The plan's own phases total 50-60 weeks of *full-time* work, then claims 6-12 months to cutover "dominated by the parallel run." Jesse is not full-time. That's a 2-3 year calendar reality, during which the org runs two of everything. The claim that parallel-run dominates is the tell — the builder has already privately discounted his own estimates.

**Virtuous and Sage aren't feature purchases, they're liability transfers.** Stripe direct makes uW own PCI scope, dunning, failed recurring gifts, and tax receipting. A homegrown ledger makes uW own audit defense. $80K/yr buys someone else's insurance and someone else's on-call.

And the diagnosis is wrong. The $73K variance was a miscategorized ask — a governance failure. Three conflicting taxonomies is a data-stewardship failure. A custom monolith will encode the same bad categorization, faster and with no vendor to blame. If the org can't hold one program ID consistent across three systems today, it will not hold one across a system only one person understands.

Untested assumption that should be a gate, not a risk: no auditor has said yes.

**CONDITIONAL-GO.** Scope: a read-only reporting warehouse over Sage/Virtuous/FRED/Notion exports, plus one canonical program/grant/portfolio dimension enforced everywhere, plus retiring FRED's duplicate tables and the Google Sheet budget. No ledger. No CRM. No Stripe. No CRDT. Revisit only after 12 months of that warehouse being maintained without Jesse touching it.

### The First Principles Thinker (anonymized as Response E)

**You're asking a build-vs-buy question. That's not the problem.**

Strip it down. Three conflicting program taxonomies exist. That is not a software defect — it's the absence of a decision about what a "program" is and who owns that list. No platform creates a canonical program ID. A person does, in a meeting, and then everything else references it. If you build the app without making that decision, you will migrate three taxonomies into one schema and have the same ambiguity with better SQL. If you make that decision without building anything, Notion, FRED, and the grants sheet all reconcile — because the join key finally exists.

Second demolition: the $113,500 "savings" is a category error. You are not eliminating a cost; you are converting a priced, transferable, SLA-backed vendor expense into an unpriced, non-transferable liability sitting on the calendar of one executive. Jesse's attention is the scarcest asset unfoldingWord has. Sage costs $40K/yr. Jesse's year does not cost $40K.

Third: the GL is the least interesting component and the one being built first. A general ledger is a solved commodity. Nothing about ASC 958 is distinctive to your mission. The pain you actually documented — $73K off plan, four exports stitched by hand — lives *between* systems, in the reporting layer, not inside any ledger.

The real problem statement: "we cannot answer cross-system questions about money, work, and impact." That is a read-only problem. Solve it read-only.

**CONDITIONAL-GO.** Scope: (1) a canonical program/portfolio/grant ID registry, decided by humans, enforced as the key everywhere; (2) a read-only warehouse pulling Intacct, Virtuous, FRED, Notion into Neon, with the cross-system reports on top. No writes. No GL. No CRM. No CRDT. Revisit in twelve months once you know what the reports actually need.

### The Expansionist (anonymized as Response D)

**The $113,500 is the least interesting number in this proposal.**

Saving software spend is a rounding error against uW's budget. The actual asset is a *category-defining public good*: the first open-source, GAAP-compliant, offline-capable, fund-accounting-plus-field-data platform built for organizations too small for NetSuite and too complex for QuickBooks. There are hundreds of them in Bible translation alone, thousands across global missions and small-NGO work. None can afford enterprise ERP. All of them have exactly this fragmentation.

Richwood Industries independently converging on the same architecture is not a coincidence — it's a market signal arriving before the product does. When a peer outside your sector reinvents your design and cites you, you've found a shape the world wants.

Three upsides nobody's pricing:

1. **This is fundable.** Infrastructure-for-the-ecosystem is a grant category. uW could plausibly raise more building this openly than it costs to build. Funders love a $60/month platform that replaces $113K/year across a hundred grantees.
2. **It's mission-consistent, not a detour.** uW already gives away Door43 and DCS. "Open resources for the global church" extends naturally to open operational infrastructure. This is the same act, applied to a new layer.
3. **The unified dataset is the moat.** Money, impact, and work in one schema is something no vendor stack can ever offer you, because no vendor owns all five. Cost-per-language-completed becomes a query, not a quarter-long project. AI agents get one substrate instead of five APIs.

**CONDITIONAL-GO.** Scope condition: build it *multi-tenant and open-licensed from the first commit* — org_id in every table, deployment docs from day one. The marginal cost is small; the option value is enormous. Ship uW as tenant one, publicly, and let the ecosystem fund what comes next.

### The Outsider (anonymized as Response A)

What jumps out first: the cost claim is wrong on its face. You will not eliminate $113,500/yr — Zoom, Google Workspace, GitHub, and WordPress aren't in the build. And "$25-60/month infrastructure" prices the servers, not the system. One executive's time is the real cost. If Jesse's loaded cost is $150K+ and this consumes half his year for two years, you've spent more than the software to save less than the software.

Second: an auditor does not ask "is your ledger append-only and hash-chained." They ask who else can review the code, who segregates duties, and what your change-control documentation looks like. A general ledger whose designer, implementer, sole operator, and sole reviewer are the same person — who is also an executive with financial authority — is a segregation-of-duties finding before anyone opens a file. That's not a technical objection. It's the one thing the audit is for.

Third: nobody in the pain section asked for a new general ledger. The stated pain is *reconciliation* — four systems that don't talk, three conflicting taxonomies, $73K off plan. Replacing Sage doesn't fix that. Sage is the one system that's working.

Fourth, the tell: markdown wiki, CRDT offline sync, AI agents on kanban queues, meeting transcript correlation. None of that appears in the pain. That's a builder's wishlist wearing a business case.

A donor reading this asks why their gift funded software instead of translation.

**CONDITIONAL-GO.** Scope: a read-only reporting layer over Sage, Virtuous, FRED, and the sheet — one canonical program taxonomy, nightly pulls, answers the cross-system questions. Plus FRED cleanup. Six to ten weeks. No ledger, no CRM, no donations, no offline sync, no agents. Revisit only after that ships and is used.

### The Executor (anonymized as Response B)

Do the arithmetic first. 60-75 weeks of estimates from one part-time builder is not 6-12 months — it's three-plus years at 40% capacity, and that assumes no estimate slips, which they always do. The stated timeline is off by a factor of three or more.

Worse, the sequencing puts the payoff last. Phase 3+5 replaces Sage — that's ~$40K of the $80K real savings, and it's the final 16-20 weeks. Every dollar of claimed ROI arrives after the riskiest work, done by the person least available to do it. You never build a general ledger as a solo side project. Auditors, 1099s, restricted-fund accounting, revenue recognition — that's not a schema problem, it's a compliance surface.

But the actual pain isn't the systems. It's that nobody can answer cross-system questions and one program is $73K off plan. That's a reporting problem, and it's cheap.

Monday morning: build a read-only warehouse. Nightly pulls from Intacct, Virtuous, Notion, FRED into one Postgres. One canonical program/portfolio dimension that maps all three taxonomies. A dashboard showing budget vs. actual vs. field results per program. Four to six weeks, one person, zero risk to the books. If that doesn't get built and used, nothing else will.

Fix the Google Sheet budget as a real table in that warehouse. That's Phase 1.5 of value at 5% of cost.

**CONDITIONAL-GO.** Scope: read-only reporting warehouse plus canonical program taxonomy. First milestone: a working budget-vs-actual-vs-field dashboard for all programs in 6 weeks, used weekly by three program leads for a month. No Notion replacement, no CRM, no ledger — those get re-decided only after that milestone holds.

---

## Peer Review Round

*Anonymization mapping: A = The Outsider · B = The Executor · C = The Contrarian · D = The Expansionist · E = The First Principles Thinker*

### Review 1

**1. Strongest: E.** It's the only one that identifies the root cause as a governance decision rather than a tooling gap — a canonical program ID is created by people in a meeting, not by a schema — and shows that fixing it alone reconciles Notion, FRED, and the sheet. Its framing of the $113.5K as converting a priced, transferable, SLA-backed liability into an unpriced one on a single executive's calendar is the cleanest financial argument in the set. C is a close second and adds the strongest gate: no auditor has said yes.

**2. Biggest blind spot: D.** It asserts a market ("hundreds... thousands") with zero evidence, treats a peer team's architecture as a demand signal, and claims the build is fundable without naming a funder or grant. It never engages the binding constraint every other response names — one part-time builder — and multi-tenancy plus open licensing *increases* scope, adds support obligations, and worsens the timeline it never addresses.

**3. All five missed:** nobody considered *buying* the fix — Intacct already does fund accounting, dimensions, and budget-vs-actual; the sheet may exist because a licensed module went unconfigured. Nor did anyone price hiring an ops/data analyst against Jesse's time, or ask who maintains the warehouse when Jesse leaves. Five identical CONDITIONAL-GOs suggests anchoring, not consensus.

### Review 2

**1. Strongest: E.** It's the only one that identifies a non-software root cause and shows the counterfactual — decide the canonical program ID in a meeting, and Notion/FRED/the grants sheet reconcile *without* building anything. Its reframe of the $113.5K ("converting a priced, transferable, SLA-backed expense into an unpriced, non-transferable liability on one executive's calendar") is the sharpest line in the council. C runs second, and adds the one thing E lacks: that $30K of the "savings" is an FP&A package never purchased, and that "no auditor has said yes" is a gate, not a risk.

**2. Biggest blind spot: D.** It asserts an ecosystem market with zero demand evidence — no peer org interviewed, no one has said they'd deploy it. Worse, its scope condition makes the plan *harder*: multi-tenant plus public release adds support obligations, security disclosure, and release discipline to a solo builder already 3x over on schedule. Grant-fundable is speculation presented as an asset.

**3. All five missed continuity.** Every response prescribes the same warehouse and hands it to the same single person. If Jesse leaves, the warehouse is orphaned too — and unlike Sage, it has no vendor. Name a second maintainer, or the recommended scope carries the same bus-factor defect it rejected the full build for. Nobody asked what the $73K variance actually costs annually — the ROI denominator is unmeasured. And nobody checked whether Intacct/Virtuous API terms and rate limits even permit nightly extraction.

### Review 3

**1. Strongest: E.** It's the only one that names the root cause as a governance act rather than a tooling gap — a canonical program ID is decided by humans in a meeting, and without that decision the app migrates three taxonomies into one schema. It also reframes the savings correctly: converting an SLA-backed, transferable vendor cost into an unpriced liability on one executive's calendar. B is the best-operationalized (6-week dashboard, named users), C the best-evidenced (the $30K FP&A package never bought).

**2. Biggest blind spot: D.** It prices upside and ignores capacity entirely. Multi-tenant + open-licensed from the first commit makes a plan already 3x over its timeline strictly more expensive — org_id, deployment docs, external support, security review. Its market evidence is one peer team converging on an architecture, which is not demand. And an open GL that other nonprofits book on transfers audit liability toward uW, not away.

**3. All five missed:**
- Nobody priced the labor alternative. A contract data engineer or $15-30K integration consultant builds the same warehouse without spending Jesse's year — the warehouse costs his time too.
- Nobody checked whether Sage Intacct's existing dimension model already delivers the canonical program taxonomy.
- Nobody set a kill criterion or named who besides Jesse maintains the warehouse.

### Review 4

**1. Strongest: E.** It's the only one that names the actual root cause: three taxonomies exist because nobody decided what a "program" is. That's a governance act, not a schema, and E shows the decision alone reconciles Notion, FRED, and the sheet without code. Its framing of the $113.5K as converting a transferable vendor expense into a non-transferable liability on one executive's calendar is the cleanest argument in the set. C is a close second — it alone caught that ~$30K of "savings" is an FP&A package never purchased, and it turns the audit question into a gate rather than a risk.

**2. Biggest blind spot: D.** It prices an ecosystem opportunity with zero evidence of demand — no named peer org committed, no grant prospect, no maintenance funding. Multi-tenancy and open licensing from commit one *add* 30-40% to a build already estimated at 3x the stated timeline, done by one part-time person. D never addresses execution capacity, audit exposure, or what happens when tenant two files a bug.

**3. All five missed:** the buy option for the recommended scope. Everyone converged on "build a read-only warehouse" without asking whether Intacct dimensions, Virtuous integrations, or off-the-shelf ETL/BI would deliver it in weeks. The build bias survived into the consensus. Second: the warehouse has the same bus factor — no one set a maintainability or handoff requirement.

### Review 5

**1. Strongest: E.** It's the only one that identifies a root cause rather than a scope reduction. Three taxonomies is a governance artifact, not a software defect — and E proves it by noting the join key can be created in a meeting, at which point Notion, FRED, and the sheet reconcile with no build at all. Its canonical-ID registry is the one deliverable that has value whether or not anything gets built. B and C reach the same warehouse conclusion; E explains why it works. C's "no auditor has said yes" is the single best gate any advisor named.

**2. Biggest blind spot: D.** It prices a market and never prices delivery. Multi-tenancy from the first commit adds org_id plumbing, deployment docs, and support obligations to a project that, by the other four's arithmetic, cannot ship tenant one. It offers no evidence of demand beyond one peer team, and it ignores that open-sourcing a fund-accounting GL exports uW's audit risk to other nonprofits.

**3. All five missed:** the fallback was never itself build-vs-buy tested. Fivetran/Airbyte plus Metabase, or Intacct's own dimensions, likely delivers the warehouse in days. And every recommendation still routes through Jesse — the bus factor survives every scope cut. Nor did anyone note this is a board decision.

---

## Chairman's Synthesis

### Where the Council Agrees

Five advisors, five independent CONDITIONAL-GOs. Not one said build it as scoped. Not one said don't build anything. The convergence is unusually tight on four points:

1. **The diagnosis is right; the prescription overshoots it.** Four of five advisors independently observed that the documented pain — $73K off plan, three taxonomies, four manual exports — is a *reporting and governance* problem, and that none of it is solved by replacing the general ledger. The Outsider put it bluntly: "Sage is the one system that's working."
2. **The savings figure does not survive contact.** $30K is an FP&A package never purchased and cannot be booked as a saving. Notion's $3.5K is noise. Most importantly, the real cost — an executive's build capacity — appears nowhere in the table.
3. **The timeline is off by roughly 3x.** The plan's own phase estimates total 60–76 weeks of full-time work. The builder is not full-time. Both the Contrarian and the Executor arrived at 2–3 years independently.
4. **The ledger is sequenced exactly backwards.** It is the riskiest component, carries the largest share of real savings, and lands last — after 40+ weeks of prerequisite work, executed by the least-available person.

### Where the Council Clashes

**The Expansionist versus everyone else, and it lost decisively.** All five peer reviewers independently named it the biggest blind spot — the only unanimous verdict in the round. Its argument: the software savings are a rounding error, and the real asset is a reusable public good for hundreds of small nonprofits, mission-consistent with uW's open-source heritage, plausibly grant-fundable.

The rebuttals were surgical: one peer team converging on an architecture is not market demand; no funder has been named; multi-tenancy and open licensing *add* 30–40% scope to a plan already 3x over on schedule; and — the sharpest point — open-sourcing a fund-accounting ledger that other nonprofits book on transfers audit liability *toward* unfoldingWord, not away from it.

Where the Expansionist survives: the mission-alignment argument is real, and it justifies open-sourcing whatever does get built. That is an argument for a license, not for more scope.

**A second, quieter clash: how much to build at all.** The Executor wants a 6-week dashboard. The Contrarian wants 12 months of proven, unattended operation before revisiting anything. The First Principles Thinker argues the decisive act may require no code at all.

### Blind Spots the Council Caught

Four findings emerged only in peer review, and three of them cut against the council's own consensus:

- **Nobody build-vs-buy tested the fallback.** Every advisor converged on "build a read-only warehouse" without asking whether Airbyte/Fivetran plus Metabase, or Sage Intacct's own dimension model, delivers the same thing in days. Two reviewers noted the Google Sheet may exist because a licensed Intacct module was never configured. The build bias survived into the consensus.
- **The recommended scope inherits the exact defect it rejects.** Every path still routes through one person. A warehouse orphaned by Jesse's departure is worse than Sage orphaned by it — Sage has a vendor.
- **The ROI denominator is unmeasured.** Nobody asked what the reconciliation pain actually costs per year in hours. Without that number, no scope can be justified on efficiency grounds.
- **One reviewer flagged the council itself:** five identical CONDITIONAL-GOs may indicate anchoring rather than genuine convergence.

### The Recommendation

**Staged GO, with the ledger gated behind an external precondition — and the current plan's scope and timeline rejected as written.**

The plan is not wrong about the problem. The research behind it is real: three conflicting program taxonomies and hand-reconciled money across four systems are documented facts, not speculation. Something should be built. But the council is right that the plan solves a $10K problem with a $300K instrument, in the wrong order, on a timeline that cannot survive arithmetic.

One thing to weigh that the council could not: the premise that AI collapses build cost may well be true. Grant it entirely — and every binding constraint the council identified survives intact. AI does not get you an auditor's sign-off. It does not create segregation of duties. It does not fix a bus factor of one. It does not make a wrong journal entry less wrong. The objections here are almost entirely about non-build costs, which is exactly why the AI-leverage argument, however correct, does not rescue the ledger.

**Build now:**
- The canonical program/portfolio/grant ID registry — decided by people, owned by a named person, enforced everywhere. Do this whether or not any code follows.
- A read-only warehouse over Sage, Virtuous, FRED, and the budget sheet, with budget-vs-actual-vs-field reporting. **Buy-test it first** — one day evaluating Airbyte + Metabase and Intacct's own dimensions before writing custom ETL.
- Retire FRED's duplicate programs/portfolios tables and move the Google Sheet budget into real tables.

**Gate behind three preconditions:** (1) the audit firm says in writing what it would require to accept a homegrown ledger; (2) a second named maintainer exists who is not Jesse; (3) the warehouse has run 90 days in weekly use.

**Do not build until those clear:** the general ledger, the donor CRM, Stripe direct, contracts/work-orders, CRDT offline sync, and the agent work queues. The Notion replacement is genuinely low-risk and defensible on its merits — but at $3.5K/yr it is the weakest ROI in the stack and should wait its turn.

**Two corrections to the documents themselves:** the brief's cost table sums a never-purchased $30K FP&A package into a column labeled "Current annual cost" — that is a factual error a CFO or board member will catch immediately, and it discredits the rest of the case. And the 6–12 month timeline contradicts the plan's own phase math. Publish the honest number.

### The One Thing to Do First

**Call the audit firm this week and ask one question: "What would you need to see before you'd accept a general ledger we built ourselves?"**

One hour, no code, no cost. It is the only untested assumption that can invalidate 16+ weeks of the plan's most expensive work — and the answer resolves it either way. If they say "a SOC-style control narrative, an independent code reviewer, and segregation of duties you cannot currently provide," the ledger question closes and the plan gets dramatically simpler and better. If they lay out a workable path, you have converted the project's largest risk into a checklist.

Everything else in this recommendation can start the day after that call.
