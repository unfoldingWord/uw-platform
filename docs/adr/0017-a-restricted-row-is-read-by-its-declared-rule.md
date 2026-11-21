---
status: accepted
date: 2026-11-20
---
# A restricted row is read by its declared rule

Every table declares a `classification`, but no read checked it. After ADR 0015 one gap was left: a grant at `org` scope, of any role, still read every row, so an org viewer or org editor read every `restricted` and `sensitive` row. Eight tables are `restricted` today (`role_grants`, `grant_audit`, `person_audit`, `service_tokens`, `push_subscriptions`, `delegations`, `routines`, `gate_decisions`) and none is `sensitive` yet; credentials, gifts and the ledger are next.

**Decision (2026-11-20).** A row of a `restricted` or `sensitive` table is read only by the **read rule** its table declares. A rule has three parts:

- `area`: the least role, on the row's own JD area, that reads it, or `null` when no area grant does. An `org` grant never counts here.
- `owner`: whether the person the row belongs to reads it. Only a person principal is an owner; an agent bound to that person is not.
- `orgAdmin`: whether an `admin` grant at `org` scope reads it. This is the one named org capability. An org viewer or org editor has none.

The rules live in `rowReadRules` in `packages/core/acl.ts`, keyed by table name, so the kernel, which cannot import the schema, reads the same rule the app does. `can(actor, 'read', { kind: 'row', table, area, ownerId })` is the one function that applies a rule. A read path supplies the row's area and owner; where a table has no area column the path passes the area it joins to (a delegation's workflow area) or `null`. A row resource answers `read` only: `write` and `admin` on it are always refused, so nobody is given a write through a read rule.

| Table | Area role | Owner | Org admin |
|---|---|---|---|
| `role_grants`, `grant_audit` | `admin` on the grant's area | the person the grant is for | yes |
| `person_audit`, `service_tokens`, `push_subscriptions` | none | the person it belongs to | yes |
| `delegations`, `routines` | any grant on the workflow's area | the person who granted it, or whose device runs it | yes |
| `gate_decisions` | any grant on the workflow's area | none | yes |

The first two rows are the owner's ruling on issue #155 for tables with no area. `person_audit` arrived with #154 after that ruling and follows the same pattern. The last two are this ADR's: the issue's general rule ("a grant on the row's area") with the org admin kept, because an org admin already administers every workflow and decides its gates.

**A rule is a ceiling, not a grant.** A path may show less than the rule allows, and several do: the delegation list still requires a read of the workflow, the persona page shows delegations only to an admin of the workflow, and the Access screen shows sign-in decisions only to an org admin.

**Two checks keep it true.**

- `tools/properties/restricted-rows.test.ts`: every `restricted` or `sensitive` table in the schema has a rule that names an area role, an owner, or both, and no rule is left for a table that is not one; so a new table cannot land without a rule. `can()` on a row agrees with an independent oracle over grant sets, tables, areas, owners and principal kinds.
- `tools/architecture/restricted-reads.test.ts`: every source file that selects from such a table, or reads it through its Store gateway, is in the ledger `tools/architecture/restricted-reads.ts` as one of three kinds, and a new reader fails the build until it is added.
  - `rule`: rows reach a caller, and the named file applies the read rule to each row.
  - `derived`: only a count or a yes/no leaves the file (decisions per day, whether an item has a decision, whether a holder is reviewing), never a row's fields.
  - `platform`: the platform reads the row to enforce or to operate (resolving a principal's grants, checking a delegation is live, writing a gate decision, sending a push), or the table's one writer re-reads its own row. The caller gets an outcome, not the row.

**What it leaves room for.** Credentials (#156) need more than read: `see`, `use`, `reveal` and `manage`, with an org admin given `see` and `manage` and never `use` or `reveal`. That is a new resource kind in `can()` with one rule per capability; the three parts above express each of them (`see`: `viewer` on the area and the org admin; `use`: `editor` on the area and no org admin). The `credentials` tables will also need an entry in `rowReadRules` before their migration can land, which the property test enforces.

**Rejected.**

- **Declare the rule on the table, in `declareTable`.** It would sit beside the classification and fail at compile time. But the kernel reads `delegations` and `gate_decisions` and may not import Drizzle, so it would need a second copy of the rule. One registry in `packages/core` with a test against the schema keeps one copy.
- **Enforce in the Store gateways.** The gateways serve the kernel's own enforcement reads (is this delegation live, has this stage a decision), which have no reader to judge. Filtering there would break the gate. The rule is applied where a row is handed to a caller.
- **Postgres row-level security.** The Worker reaches Postgres as one role through Hyperdrive; the principal is not a database role. It would also put authorization beside `can()`, which section 1 of `AGENTS.md` forbids.
- **Let any `org` grant read restricted rows whose table has no area.** That is today's behaviour and the gap the issue closes.

**Consequences.** An org viewer or org editor who holds no grant on a workflow's area still sees the workflow, its items and its events, but no longer sees its delegations (the agents screen's permissions, the health list of live delegations, the delegation list command) or its routines; to see them they need a grant on that area. The same facts are still written to `harness_events`, which is `internal`: a `delegation_granted` or a gate event in the item history is not hidden by this ADR. The agents screen still marks where an agent can work for every reader of the workflow, which is derived from delegations. Counts on the health plane are unchanged. Source: issue #155; `prd/Credentials Store - Design Proposal.md`, finding 2.
