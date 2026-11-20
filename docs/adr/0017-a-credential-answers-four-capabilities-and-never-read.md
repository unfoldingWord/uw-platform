---
status: accepted
date: 2026-11-20
---
# A credential answers four capabilities and never read

The credentials store (#157 to #159) holds secrets that belong to an area's work. `can()` knew three actions, `read`, `write` and `admin`, and an `org` grant satisfies each of them on every area. A credential that answered those actions would be used by every org editor and revealed to every org admin. ADR 0016 left room for a resource kind with its own rule; this is it.

**Decision (2026-11-20).** `can(actor, capability, { kind: 'credential', ... }, at)` answers four capabilities, `see`, `use`, `reveal` and `manage`, each by the rule `credentialRules` declares in `packages/core/acl.ts`. A credential resource answers nothing else: `read`, `write` and `admin` on it are always refused, and a capability asked of an area, the org or a row is always refused. So no credential is reached through a page read, and no page is reached through a capability.

| Capability | Grant on the credential's own area | Org admin | Org editor, org viewer | Also needs | Who may ask |
|---|---|---|---|---|---|
| `see` | `viewer` or higher | yes | no | | a person at the keyboard |
| `use` | `editor` or higher | no | no | the use names a workflow and connector the credential is bound to | any principal: a person, an agent with its person's grants, a lent person |
| `reveal` | `viewer` or higher | yes | no | a live reveal grant for that person on that credential | a person at the keyboard |
| `manage` | `admin` | yes | no | | a person at the keyboard |

The rows for the roles are the design (`prd/Credentials Store - Design Proposal.md`, Part 2) and the owner's ruling on issue #156: an org admin gets `see` and `manage` on every credential and never `use` or `reveal`; an org editor or viewer gets nothing. An org admin who also holds `editor` on the credential's area uses it through that area grant, like anyone else.

**The facts travel on the resource.** `can()` stays pure and takes no database handle, so the caller loads what the rule needs and passes it: the credential's id and area, its bindings, the workflow and connector of this use (`usedBy`, or `null` when nothing is being used), and its reveal grants. `can()` matches them itself. A reveal grant for another person, on another credential, or expired, counts for nothing; a use from a workflow or connector that is not bound is refused. The principal contract does not change.

**Four rulings this ADR makes,** where the issue and the design left a choice.

- **A person at the keyboard.** `see`, `reveal` and `manage` are answered only for a principal of kind `person` that is `interactive`. An agent is refused whatever grants it carries (finding 3 of the design: an agent's carried grants are too broad for credentials). So is a person principal the kernel mints for a delegation (`packages/harness/gates/lent.ts`), which is `person` and not interactive: without this, a delegation would reveal or rotate in its grantor's name. `manage` includes giving a reveal grant, so an agent that could manage could open a reveal for its own person; section 10 of `AGENTS.md` forbids that kind of path.
- **An agent may `use`.** The design's use path is an agent passing a reference to a connector that checks the run's person has `use`. An agent's principal carries its person's grants, so it is answered `use` on the same terms as the person: `editor` on the area, where bound. It never receives the value; `use` is the leave for platform code to decrypt on its behalf.
- **A reveal grant adds to an area grant.** `reveal` needs the reveal grant and `see`. The design says a person's reveal grants end when their role grants are revoked; requiring `see` makes that true without anyone deleting the reveal grant. An org admin holds `see`, so a reveal grant is all they lack, as the ruling says.
- **A reveal grant always expires.** Its `expiresAt` is an instant, never `null`, and one that is not a date is never live.

**What #157 builds on.** The five credential tables are `restricted` or `sensitive`, so `tools/properties/restricted-rows.test.ts` refuses their migration until each has an entry in `rowReadRules`. A read rule is a ceiling (ADR 0016), and the three parts express the capability that guards each table: `{ area: 'viewer', owner: false, orgAdmin: true }` is `see`, and `{ area: 'admin', owner: false, orgAdmin: true }` is `manage`. No rule is as narrow as `reveal`, so the ciphertext table takes the `manage` ceiling and its readers are `platform` in the restricted-reads ledger. Every path that hands a credential row to a caller asks `can()` for the capability, on the credential resource, and not `read` on the row.

**Rejected.**

- **Map the capabilities onto `read`, `write` and `admin`.** `see` as `read` gives every org viewer the list of credentials; `use` as `write` gives every org editor every credential. The owner's ruling removes exactly those.
- **Put reveal grants on the principal.** The principal is minted on every request and travels on every queue message; carrying per-credential grants there widens a contract (`packages/contracts`) for a fact only one screen needs.
- **Pass `bound: true` and `revealGranted: true`.** Shorter, but each caller would then write its own matching of person, credential, expiry and binding, and one that forgot the expiry would reveal. One function matches them.
- **Let an agent `see`.** An agent takes a reference from its stage's configuration and does not need the list. It can be opened later by changing one field of one rule; closing it later would break whatever had come to depend on it.

**Consequences.** Nothing calls this yet: the store, the connector path and the screen are #157, #158 and #159. Named-person restrictions on a pinned credential and the two-org-admin break-glass reveal are in the design and not in this rule; they need facts (#157's `credential_grants`) that do not exist yet. A run whose principal carries no grants (a service token, the system) is refused `use`; the connector path decides which principal it asks about. Source: issue #156; `prd/Credentials Store - Design Proposal.md`, Part 2.
