# Two axes: where a thing is filed, and why it exists

This guide is for an organization adopting the platform. It explains the two ways the platform organizes everything, how they relate, and how to declare that relation for your own organization. The words used here are defined in [`CONTEXT.md`](../../CONTEXT.md), under "The two axes".

## The two axes

**The filing axis: Johnny.Decimal.** Every page, task, workflow and credential is filed in one **area**, a decade such as `20-29`. Inside an area, knowledge pages are filed in a two-digit **category** (`21`) and may carry an **ID** (`21.10`). The filing axis answers *where do I put this, and where do I look for it?* It changes rarely: renumbering is a restructure. Access follows it, because permission follows job function: a grant reads one area (ADR 0015).

**The purpose axis: the Strategic Cascade.** Purpose, Objective, Principles, then **portfolios**, **programs** and **projects**, then tasks. The purpose axis answers *what outcome does this serve?* It is meant to change every planning cycle. Money and outcomes roll up along it.

Neither axis is derived from the other, and neither is the parent of the other. A project can be filed in Finance and serve a field program; those are two facts, recorded separately.

## How the platform records each

| Fact | Where it lives | Who sets it |
|---|---|---|
| An entity's area | The entity's own `jd_area` | Whoever files it, with write on that area |
| A cascade node | A page of type `portfolio`, `program` or `project`, in its built-in collection | An editor of the collection's area |
| An entity's place in the cascade | One row of `cascade_placements` naming one cascade node | A writer of the entity's area who can read the node |
| How an area relates to a cascade node | One row of `jd_cascade_map`, with a relation of `owns`, `supports`, `funds` or `reports_on` | An org admin; every change is kept in `jd_cascade_map_audit` |

A cascade node does not need a placement: it sits at its own tier. A portfolio field on a program is a relation to the portfolio page, and a portfolio field on a project is a rollup through its program. No collection stores a cascade coordinate as a plain select, and a test keeps it that way, because a select copied onto several collections is exactly how the two axes drift apart.

## The relations

- **owns**: the area does the work of this node. A field area owns the programs that run there.
- **supports**: the area serves this node without owning it. Finance supports every portfolio.
- **funds**: the area raises or holds the money for this node. A fundraising area funds the portfolios it raises for.
- **reports_on**: the area reports on this node to someone outside it, such as a board or a funder.

An area can hold several relations to one node, and a node can relate to many areas.

## The crosswalk

The JD Crosswalk screen (`/crosswalk`) shows both axes at once: areas down, cascade tiers across. Each cell counts the pages, tasks and items filed in that area and placed at that tier, and lists that area's relations to the tier's nodes. A cell opens the list of what it counts. A node opens every area it touches, with what each has placed under it. The last column counts what is filed but not yet placed.

It counts only areas the reader can read. Someone with no grant on Finance sees no Finance row and no Finance relations, even on a node they can read.

## Declaring the map for your organization

Do this once at setup, then revisit it at each planning cycle.

1. **List your areas.** Write down your decades and their names. If you have no filing scheme, run with one area for everything; the crosswalk then has one row.
2. **List your cascade.** Create your portfolios, programs and projects in their collections. If you have no strategy yet, run with no nodes; every entity counts as not placed.
3. **Declare each relation.** For each pair of an area and a node that matters, an org admin opens the crosswalk and declares how they relate. Start with *owns*: every program should be owned by at least one area. Then add *supports*, *funds* and *reports_on* where they are true.
4. **Place the work.** Writers place pages, tasks and items under the node they serve. The "Not placed" column is the list still to do.
5. **Read the crosswalk.** An empty row is an area that serves nothing you have declared. An empty column is a tier with no work under it. Both are questions for the next planning conversation, not errors.

A worksheet that helps with steps 1 to 3:

| Area | Name | Owns | Supports | Funds | Reports on |
|---|---|---|---|---|---|
| `00-09` | | | | | |
| `10-19` | | | | | |
| … | | | | | |

Fill one row per area with the nodes it relates to, then declare each filled cell on the crosswalk.

## What unfoldingWord uses

unfoldingWord's index, `00.01 unfoldingWord Index (Johnny.Decimal)`, is the source of truth for its areas, categories and IDs. The platform's area names and the numbers it shows beside each module follow that index. Another organization replaces the area names in `apps/uw-app/views/parts/names.ts` with its own and names its categories on the wiki screens.
