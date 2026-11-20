# Rolling Budget migration plan

Status: plan, with an owner's decisions of 2026-11-20 recorded in section 9. Nothing here is built. The work is tracked in the epic named in section 7.

## 1. What was read, and how far to trust it

| Source | How it was read | Confidence |
|---|---|---|
| `21.10 Rolling Budget` (Google Sheet, 92 tabs) | Sheets API: tab list, the Program Template, six program tabs' formulas for 2026-10 to 2027-01 and the first two months, header colours, Global View column A and sample formulas | High for structure. Six program tabs were read (section 2.7); the other tabs, and the months in between, are assumed to follow |
| CFO pre-budget folder (8 files) | Five read in full: the allocations matrix, the source-of-funds list, one program's "All and Good Money" worksheet, the CFO's covering note, and the proposed portfolios and staff. The first-glance sheet was read from a local export. The two other program worksheets were not opened (assumed to match the first) | High for the five |
| `../Budget Report`, `../Revenue Projection` Apps Script | Read by a delegated agent, whole files, with line references | Medium-high. Not re-read line by line |
| Platform Plan, `docs/PRD.md`, ADRs, schema, ACL, issues | Read by a delegated agent; the claims behind each blocker in section 8 were spot-checked against the files and `gh` | High for the blockers, medium for the rest |

An owner states that API access is possible for both Sage Intacct and Virtuous (2026-11-20); this plan relies on that and did not test it. Still not known: how funder-level income is coded in Sage. See section 9.

## 2. How the Rolling Budget works today

### 2.1 Shape

- One tab per program or cost centre (about 40 live), one `Program Template`, one `Global View`, and about 50 hidden `SheetN` placeholders that reserve roll-up slots.
- Every tab has the same grid. Column A is the line label, B is `ACCT_NO` (Sage GL account), C is `DEPT_ID` (Sage department, one per tab). Columns D onward are months from 2024-01 to 2030-09, with a quarter column after every third month.
- Portfolio is not a column. It exists only as tab-name prefixes and as hand-built roll-up tabs.

### 2.2 The rows of a program tab

| Rows | Content | How it is produced |
|---|---|---|
| 2–27 | Income by funding source, one row per funder or giving channel, account 4030 or 4031 | Typed. Often arithmetic left in the cell (one number minus another) |
| 28 | Subtotal | `SUM(2:26)` |
| 29 | Operational Assessment (labelled "15/18% Allocation to General", account 4999) | Closed months: typed. Open months: a rate per source, 15% on some funders' rows and 18% on the rest; from 2027-01 a flat 15% of the subtotal |
| 30 | Project Income | Subtotal − allocation |
| 38 | Fiscal Year Budget | One typed value in that year's January column |
| 40 | Running Balance | Previous month + Month Net; the opening balance is buried in the first formula |
| 41 | Month Net | Project Income − Project Expense |
| 46–84 | Expense by GL account (6000–8200) | Closed months: typed from Sage. Open months: 7020–7500 pull the subtotal of a detail block below; 7600 Project Management is 10% of Project Income; 7700 Training is 15% of Project Income on the tab read (the rate is set per program and funder, see 4.1) |
| 85 | Project Expense | `SUM(46:84)` |
| 90+ | "Expense Budgeting" detail: named line items under each 7xxx account (partner travel, each translation team's stipend, each workshop) | Typed by the program manager |

### 2.3 Global View

- Every cell is the sum of `INDIRECT(tab name & "!same cell")` across 84 tab slots listed in A131:A214. That is the whole roll-up mechanism, and it is why the placeholder tabs exist.
- Extra org rows: Program Income, Unrestricted Income, Other Income, Program/Ops Expense, Net Gain/Loss, Unrestricted Balance, Program Balance, Total Net Assets.
- A block of allocation percentages for one pooled grant, per program per month (how one pooled grant is split).
- One running-balance row per program, and a Combined Program Balance.
- Some closed cells are typed over the formula.

### 2.4 Month close

A month is "closed" when its header cell is orange; 2024-01 to 2026-10 are orange today. Closing means the CFO types Sage actuals over the forecast in the same cells. Three consequences:

1. The forecast that stood before the close is destroyed. There is no budget-versus-actual, only whatever now sits in the cell.
2. The Budget Report's "as of" view cannot show the forecast as it stood then.
3. Nothing checks the typed number against Sage.

### 2.5 What the two dashboards add

- **Budget Report**: per program, year-to-date and anticipated income and expense, income by source, beginning, current and ending balance, inception-to-date, a health verdict (shortfall, watch, healthy); and a portfolio overview table with the org balance trend.
- **Revenue Projection**: the revenue trend from Global View; the Virtuous gift-ask pipeline weighted by status (closed 100%, then 90, 75, 50, 25); grants and majors pages; a calendar; and "still to raise" per program (budget − raised − anticipated).
- Gift asks are **not joined to programs** anywhere. The only link from revenue to a program is the funder's row label on the program tab.

### 2.6 What the CFO's pre-budget worksheets do that the sheet cannot

| Worksheet | What it models |
|---|---|
| The CFO's covering note | Top-down targets for unrestricted income and for program income |
| First glance | Portfolio → program proposed budgets, and funder → portfolio planned funding |
| Source of funds | Funder-level expectation with the reasoning behind each figure, from last year's giving to plainly aspirational |
| Allocations and Income Sources | A funder × program matrix: pooled funds split by percentage, plus carryover and last year's income per program |
| Three programs' "All and Good Money" | Two scenarios of the same program year: every hoped-for source, and only the confident ones. Expense lines follow income by percentage |
| Proposed Portfolios and Staff | People allocated to programs by percentage, with a second person's suggested changes beside the first |

These are the requirements in miniature: top-down and bottom-up numbers that must meet, scenarios by confidence, pooled-fund allocation, and two people's judgments side by side.

### 2.7 Five more tabs, one or more from each portfolio

After the first field program tab, five more were read: a second Transformation field program, two Innovation programs, one Catalyzation program, and Operations (General). The fixed rows (28, 29, 30, 40, 41, 85), the 34 expense accounts and the core formulas are the same on all of them. What differs is what people typed over the template:

| Finding | Seen on | What the model does about it |
|---|---|---|
| The Operational Assessment is a flat 15% formula, a typed amount that mixes 15% and 18%, a hard-coded product of two numbers, or typed 0 | Four of five, each differently | Rules by program and funder (4.1), with a typed override for one period that is shown as an override |
| Operations is not assessed, yet its 2027-01 column still holds the template's 15% formula | Operations | "Not assessed" is a program attribute; the leftover formula is not imported |
| Project Management and Training are 10% and 15% of Project Income in some months, typed 0 or blank in others, and typed at what looks like 10% and 5% on one tab (inferred) | All five | `program_cost_rules` (4.1); the import compares typed values with the rule and lists the differences |
| Operations has its own income lines and accounts: undesignated revenue 4000, interest 4100, investments 4125, internal transfer 4950, admin overhead transfer 4999, other income 4110 | Operations | Income lines are data per program, not a fixed list of 26 |
| Account 4999 is typed twice, as the assessment taken from each program and as overhead income on Operations, and nothing makes the two agree | Program tabs and Operations | One assessment figure, computed once, shown on both sides |
| No `DEPT_ID` at all | One Innovation program | The department belongs to the program, not to a row; a program with no Sage department is listed for the CFO |
| Opening balances sit inside the first running-balance formula | All five | `opening_balances` (4.1) |
| Income cells hold arithmetic: an annual grant divided by 12, or a total minus parts | Two tabs | The amount is imported; a line may carry "annual amount, spread evenly" as its rule |
| Funder labels vary by tab (a regional suffix added) | One tab | A funding source has an identity apart from its label |
| The detail block starts on different rows per tab, has sub-groups, and three tabs still hold template placeholders | All five | Line items are found by their account header, not by row number; placeholders with no amounts are skipped |
| Stray formulas: an annual total sitting in a 2027-01 income cell, and 2027-01 expense cells that read the 2026-10 detail column | Two tabs | The import flags any cell whose formula reads outside its own column or row pattern, for a person to confirm |
| No "Fiscal Year Budget" value in row 38 | All five | The year's budget is the official budget version, not a cell |
| No pooled-grant roll-down formulas in the months read; the amounts are typed | All five | `allocation_rules` stays, and the import records which amounts were typed |

The import in #178 therefore reads values, never formulas, and produces a report of every cell where the typed value and the stated rule disagree. That report is the list of things to settle with the CFO before the sheet is frozen.

Tab names, funder names, amounts and balances are left out of this document on purpose: the repository is public.

## 3. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | **Build the budget as a native domain now**, fed by read-only mirrors of Sage and Virtuous, with tables shaped so they become the Plan's ledger budget tables later | Delivers what is asked. Requires re-sequencing the Plan (section 8, blocker 1) and four prerequisites |
| B | Wait for the Plan's Phase 3 native GL and Phase 2 native CRM; budget-versus-actual falls out then | No re-sequencing. The CFO keeps closing months by hand for a year or more |
| C | Keep the sheet as the source of truth and sync it into the database for viewing | Quick. Removes none of the manual work and keeps the destroyed-forecast problem |

**Chosen by an owner on 2026-11-20: A, entered through a C-shaped first step** (ADR 0016). Import the sheet first, read-only, so the new views can be proven against the old ones before any writer moves. Then switch actuals to Sage, then move editing into the platform.

## 4. Data model

Principle: **store only what a person typed or a system reported; compute everything else.** Subtotals, quarter columns, Project Income, Month Net, Running Balance, roll-up tabs and the whole Global View become queries. The 84-slot `INDIRECT` machinery has no equivalent because it is not needed.

### 4.1 Reference data

| Table | Holds | Replaces |
|---|---|---|
| Cascade nodes (the Plan's page tree: Purpose → Objective → Principles → Portfolio → Program → Project) | The strategic hierarchy. A cost centre (Operations, Engage Benefactors) is a node of its own kind | Tab names, prefixes, roll-up tabs |
| `fiscal_calendars`, `fiscal_periods` | A calendar has a start month and an effective date. A period is one calendar month `YYYY-MM` with its fiscal year, fiscal quarter, and Sage close state | The orange headers; "fiscal year = calendar year" |
| `gl_accounts` | Account number, name, income or expense, display group | Column B |
| `sage_dimension_map` | Sage department (and any other dimension) → cascade node, with effective dates | Column C |
| `funding_sources` | A funder or giving channel, linked to its Virtuous contact and to the Sage coding that identifies it | Row labels 2–27 |
| `budget_line_items` | A named line under a program and account ("Sara Kaba translation team") | The "Expense Budgeting" block |
| `assessment_rules` | The Operational Assessment rate in basis points by funding source and program, with effective dates. Policy: 18%, or 15% where a foundation dictates it | The row-29 formulas; the 01.26 matrix |
| `program_cost_rules` | Project Management and Training rates by program and funding source, with effective dates and the reason for each change. These are direct program costs, not assessments. Default 10% + 12%; one funder's grants 10% + 15%; a field program at stage 3 drops Training to 5%; one-off exceptions for one funder on one program, with a start date | The 7600 and 7700 formulas; the 01.26 matrix and its change log |
| Program attributes | Program stage (with the date it changed), whether the program takes part in the field staff bucket, whether it receives pooled-grant funds | Clearing cells D77:DG79 by hand; the pooled-grant formulas in rows 6 and 7 |
| `allocation_rules` | How a pooled fund is split across programs, by percentage and period. This is the one figure that rolls **down**: the org-level amount × the program's share becomes that program's income line | The pooled-grant block; the allocations worksheet |
| `opening_balances` | Balance per program at a stated period, with its source | The constant inside row 40 |

Facts are stored by **calendar month**. Fiscal year is a lookup on the period, so changing the fiscal year later is a new calendar row, not a data migration, and any view can be asked for by fiscal or calendar year.

### 4.2 Actuals (system-reported, never typed)

- `sage_entries`: one row per Sage journal line: date, account, department, other dimensions, amount in minor units, document reference, and provenance (source id, synced at, sync status). This is the bottom of the drill-down.
- `gifts`, `gift_asks`: mirrored from Virtuous with the same provenance columns, each mapped to a funding source and, where known, a program.
- Monthly actuals per program and account are a query over `sage_entries`.

### 4.3 Plans (person-typed)

Two tables carry every budget, forecast, worksheet and scenario.

`plan_versions`

| Column | Meaning |
|---|---|
| `kind` | `budget` (a year's plan), `forecast` (the rolling projection of open months), `scenario` (a what-if) |
| `scope_node` | The cascade node it covers: one program, a portfolio, or the organization |
| `fiscal_year`, `calendar` | The year it plans, under which calendar |
| `author` | The person whose judgment it is |
| `lens` | Whose view it represents: `manager`, `cfo`, `development` (the gift pipeline), or a named scenario such as `all-money`, `good-money` |
| `status` | `worksheet` (private working copy) → `proposed` (visible up the cascade, marked unofficial) → `official` (pinned) → `superseded` |
| `based_on` | The version it was copied from |
| `pinned_at`, `pinned_by` | When and by whom it became official |

`plan_lines`: version, program, period, and either a funding source (income) or an account with an optional line item (expense); an amount in minor units; an optional rule ("10% of Project Income") instead of an amount; a confidence score on future income lines; a persistent note.

Confidence uses the scale staff already use as cell colours in the sheet: committed (a signed gift agreement, or received and recorded in the CRM), 90%, 75%, 50%. It is the same scale as the Virtuous gift-ask status, so a typed income line and a mirrored gift ask can be compared like for like.

`plan_comments`: a threaded, resolvable discussion on a line or a cell, separate from the persistent note. The sheet's rules ask for exactly this split (Google comments for questions that get closed, notes for information that stays).

Rules that fall out of this:

- **Official versus draft.** At most one `official` budget per scope and fiscal year, enforced by the database. An official version is immutable; a change is a new version that supersedes it, so every past official figure stays recoverable.
- **A CFO's draft seen through the cascade.** A `proposed` org-scope version rolls up and down like an official one; every figure from it is marked as proposed. Pinning it makes it official.
- **Distinct judgments that connect but are not forced equal.** The manager's forecast, the CFO's budget and the development team's pipeline are three versions over the same dimensions. Views place them side by side and show the gap. They are never summed, which is the rule the Revenue Projection already follows.
- **The pipeline lens is derived.** It is computed from Virtuous gift asks × probability by expected month, so it is always current and nobody types it.
- **Top-down meets bottom-up.** The CFO's org-scope version can hold a single target per program; program-scope versions hold the detail. A view shows target against the sum of detail.
- **No fixed horizon.** A forecast version may hold lines for any future period, so planning beyond twelve months needs no new columns.
- **Forecast history.** When a period closes, the forecast version in force is snapshotted. "As of" then shows what was expected at the time, which the sheet cannot.

### 4.4 Roll-up, up and down

```
Purpose → Objective → Portfolio (Strategic Intent) → Program → Project
                                                        │
                                   plan_lines ──────────┤ (program × account or source × month)
                                                        │
                    sage_dimension_map ─────────────────┤
                                                        ▼
                              sage_entries (journal lines in the books)
```

Any figure at any level is the sum over its descendants, for a chosen lens and version, and can be opened downward until it reaches the Sage journal lines or the Virtuous gifts behind it.

## 5. Month close without the CFO

1. A scheduled job mirrors Sage entries and each period's close state.
2. An open month shows actuals to date beside the forecast, labelled preliminary.
3. When Sage reports a period closed, the job snapshots the forecast, marks the period closed, and the views switch that month to actuals. Nobody types anything.
4. A later Sage adjustment to a closed period shows as a change with its entry, instead of being silently absorbed.

One thing must be settled before this works: the Operational Assessment and the Field Staff Offset lines. If Sage books them, they arrive as actuals. If the sheet has been computing them, they stay computed by `assessment_rules` and `program_cost_rules`. See section 9.

## 6. Views

| View | Shows | Source today |
|---|---|---|
| Program sheet | The program tab as a grid: income by source, allocation, expense by account, expandable line items, month net, running balance; months and quarters; closed and open months distinguished | Program tabs |
| Organization sheet | The same grid for any cascade node, including the org summary rows | Global View and roll-up tabs |
| Program financials | Year-to-date, anticipated, balances, income by source, running-balance chart, verdict | Budget Report |
| Portfolio overview | Program table with status, org balance trend | Budget Report |
| Revenue, Grants, Majors, Calendar | Trend, weighted pipeline, attention lists | Revenue Projection |
| Still to raise | Budget − raised − anticipated per program | Revenue Projection |
| Worksheet | An editable copy of a program or org plan; compare against official, against last year, against another person's version | CFO worksheets, "All and Good Money" |
| Funding allocation | Funder × program matrix with pooled-fund percentages | Allocations and Income Sources |
| Ledger drill-down | Sage entries behind any actual | None |

Every view takes: cascade node, fiscal or calendar year, lens and version, and an as-of date.

## 7. Phases and issues

The work is one epic (#182) with four issues, each a large pull request by an owner's choice (2026-11-20).

| Issue | Phases | Delivers | Proves |
|---|---|---|---|
| #178 Foundations and the sheet in the platform | 1–2 | The grant on a Johnny.Decimal ID (section 8.1); cascade nodes for portfolios and programs, fiscal calendar, accounts, funding sources, rules, dimension map; a repeatable import of the sheet into plan versions and typed history; read-only Program and Organization sheets; the Budget Report views | Every figure ties to the sheet for the same period |
| #179 Sage Intacct integration | 3 | A Sage port over the Intacct API, the mirror of entries and period states, automatic close, ledger drill-down | Mirrored actuals for 2024-01 to 2026-10 reconcile to the sheet's closed months; differences listed for the CFO |
| #180 Virtuous integration and revenue views | 4 | A Virtuous port over its API, mirrored gifts and gift asks, the gift ask → program mapping, the Revenue Projection views, the derived pipeline lens | Figures tie to the Revenue Projection app |
| #181 Worksheets, versions and cutover | 5–6 | The editable grid, worksheets, propose and pin, side-by-side lenses, funding allocation; a parallel run; the sheet frozen and the two Apps Script apps retired | The 2027 budget can be drafted and pinned in the platform; an owner's sign-off |

#178 needs no external credential, because it reads the sheet through a one-time export. #179 and #180 wait on the credentials store (#157, #158).

## 8. Comparison with the PRD and the Platform Plan

`docs/PRD.md` is the harness PRD and excludes this work in so many words (§4: "No ledger, CRM, grants, field data, publishing, page editor, charts"). The Platform Architecture Plan is the document that covers finance.

### 8.1 What an owner decided, and what it changes

| Finding | Decision (2026-11-20) | Result |
|---|---|---|
| The Plan replaces Sage with a native ledger (Phase 3) and Virtuous with a native CRM (Phase 2), and brings Sage in only as a CSV mirror | Build the budget domain now and integrate with both systems; the native ledger and CRM come "quite a bit later" | ADR 0016. `sage_entries` is the Plan's Sage mirror built early; the plan tables are dimensioned to become the Plan's `budget_lines` |
| Sage API access was unverified | API access is possible with both Sage and Virtuous | Both arrive through ports over their APIs, on a schedule. No CSV step |
| No credential store (#156–#158 open) | It will be built soon | A dependency of #179 and #180, not of #178 |
| The ACL has only `org` and area scopes | The current workflow stays: any program manager sees the full organization budget. That is a grant on **21.10**, the Rolling Budget's Johnny.Decimal ID. Grants on an ID are the exception, not the rule | The ACL gains a third scope, a Johnny.Decimal ID. No per-program scoping is built |
| Restricted rows are readable by any org-scope grant until #155 | An org-wide admin may see financial data | See the read rule below |

**The read rule for budget data.** A person reads the Rolling Budget, all of it, when they hold any of:

- a grant on `21.10`, of any role (program managers);
- a grant on the area `20–29` (Finance);
- `admin` at `org` scope.

Writing follows the same scopes with the `editor` role: a program manager with `editor` on `21.10` edits worksheets; pinning a version official needs `admin` on `21.10` or on `20–29`. This write rule is this plan's proposal, not an owner's statement.

Two things follow that the ACL work must handle:

- The decision names an org-wide **admin**. Whether `viewer` or `editor` at `org` scope also reads budget data is left to #155, which says restricted rows need a grant on their exact area. This plan assumes they do not.
- A grant on an ID reads only rows filed under that ID. It does not read the rest of area `20–29`, and a grant on `20–29` does read `21.10`.

Salary detail is not in the Rolling Budget today beyond account totals, so nothing finer than `21.10` is needed for this epic. Staff allocation by person (section 10) would need its own ID if it is built.

### 8.2 Gaps (work, not obstacles)

- No cascade tables, `jd_areas` table, `strategy` or `ledger` module, or portfolio and program page types exist. #178 adds what the budget needs and no more.
- The Plan names `budget_lines` but gives it no columns, and says nothing about versions, drafts, several people's forecasts, or a fiscal-year setting. Section 4 fills this.
- The Plan's ledger dimensions are account × fund × function. The sheet uses account × department. The mapping between department, fund and program must be written down with the CFO.
- No join from a Virtuous gift ask to a program exists. It needs a mapping and some cleanup in Virtuous.
- No editable grid exists (`packages/ui/components/table.tsx` is a static table). The chart component covers daily bars and sparklines only. ADR 0012 requires ECharts, while the two dashboards use Chart.js, so they are re-drawn, not ported.
- The Plan forbids direct joins between modules, so roll-ups across `strategy`, `ledger` and `crm` go through published functions.
- Words. `CONTEXT.md` reserves "Draft" for a workflow draft, and "grant" already means an access grant. Proposed: **worksheet**, **proposed**, **official**, **pinned**, **budget version**, and **funding grant** for the money kind. **Operational Assessment** is the required term for the 18% (01.26 Budgeting); "allocation to general" is not used.

## 9. Decisions

### Made by an owner, 2026-11-20

1. Build this budget domain now, before the native ledger and CRM, integrated with Sage and Virtuous (ADR 0016).
2. Sage and Virtuous data arrive through their APIs.
3. Any program manager sees the full organization budget, through a grant on `21.10`. An org-wide admin may see financial data. The ACL allows a grant on a Johnny.Decimal ID as an exception.
4. The credentials store is built first for #179 and #180; it is not part of this epic.
5. The work is as few, large issues as possible.

### Still open

Each is settled inside the issue it belongs to, with the CFO where it concerns the books.

1. **Is the Operational Assessment booked in Sage, or computed?** And which is authoritative when they differ? (#179)
2. **How does the cascade map to budget levels?** The Plan's tree is Portfolio → Program → Project. Does "Tactical Plan" mean Program and "Operational Reality" mean Project and below? (#178)
3. **How is a funder identified in Sage income?** The sheet shows many funders on accounts 4030 and 4031. If Sage does not carry the funder, funder-level actuals must come from Virtuous, and the two must be reconciled monthly. (#179 and #180)
4. **Where do opening balances come from?** Sage fund balances at 2023-12, or the constants in the sheet. (#178, confirmed in #179)

## 10. Small unknowns

- Cell A1 on program tabs is not a field: it holds the word "Income", a dash, or on one tab a number. It is not imported.
- The sheet's open months do not always follow the stated policy. On one field program tab, 2026-11 applies 15% and 18% by funder as the policy says, but 2027-01 onward applies a flat 15% to everything, and Training is 15% where the 01.26 matrix says 12% by default. Rules in the database will make such differences visible; the CFO decides which is right.
- 01.26 Budgeting disagrees with itself on one program's stage: the change log says stage 3 from 2025-07-01, a comment on the page says stage 4.
- The base for Project Management and Training is Project Income in the sheet's formulas, while 01.26 describes them as added to field program costs. The base must be confirmed.
- The confidence scale in 01.26 stops at 50%; the Revenue Projection also uses 25%.
- Staff allocation by percentage (Proposed Portfolios and Staff) fits the model as rule-driven lines, but salary data raises decision 3 and is left for a later phase.

## 11. Check against 01.26 Budgeting (Notion)

The page and its four comment threads (all resolved) were read on 2026-11-20. The page was last edited 2026-07-14 and is marked unverified in Notion.

| Note on the page | Where this plan covers it |
|---|---|
| Operational Assessment is 18%; 15% only where a foundation dictates. Always call it "Operational Assessment" | `assessment_rules` (4.1); the term is adopted (section 8, Words) |
| Project Management 10% and Training 12% are direct program costs, not assessments; one funder's Training rate is 15% | `program_cost_rules` (4.1), kept apart from the assessment |
| A field program's Training rate depends on the program's stage | Program attributes and `program_cost_rules` (4.1) |
| The program × funder matrix | `assessment_rules` and `program_cost_rules`, keyed by program and funding source |
| Change log (three dated changes in 2025: stage moves, one foundation's rate, one funder's exception on one program) and the three comments restating it | Effective dates and a reason on every rule (4.1). A past month keeps the rate that applied then |
| Forecasting beyond twelve months | No fixed horizon (4.3) |
| Quarterly and fiscal-year tie-outs | Computed from periods (4.1, section 6) |
| Consistent income and expense lines, with spare rows for new ones | `gl_accounts`, `funding_sources`, `budget_line_items` (4.1); a new line is a new row of data |
| Rows 30, 40 and 85 are fixed so other sheets can reference them | Project Income, Running Balance and Project Expense become named, computed measures. **New task:** list every sheet or script that references those rows before the sheet is frozen (phase 6) |
| Global View rolls up; the pooled grant rolls down | Section 4.4; `allocation_rules` (4.1) |
| Actuals are entered from Sage about a week after month end and the header turns orange | Section 5 |
| Actuals override the Expense Budgeting roll-up | Section 5: a closed period shows Sage actuals; the forecast is kept as a snapshot, not overwritten |
| Do not add, move or rename rows, columns or sheets; do not edit Global View formulas | Not needed: structure is data and roll-ups are queries |
| Comments for questions to be closed; notes for lasting information | `plan_comments` and the line note (4.3) |
| Confidence colour scale for anticipated funding | Confidence score on income lines, aligned to the gift-ask status (4.3) |
| Adding a new program: copy the template, set `DEPT_ID`, clear field staff cells, set the starting balance with a note, register on Global View, wire the pooled-grant formulas | Create a program node, map its Sage department, set its attributes and opening balance (4.1). No template, slots or formulas |
| Links to 21.10 Rolling Budget and 21.09 Program Financial Budget Dashboard | Both are replaced by the views in section 6; the page itself needs rewriting at cutover |

Three points on the page conflict with the sheet or with itself; they are listed in section 10.
