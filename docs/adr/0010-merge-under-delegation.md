---
status: accepted
date: 2026-10-15
---
# A person may lend an agent the Ship exit for a merge, under a delegation

A harness can opt into one unattended Ship exit. A person holding `admin` on the harness's area grants a persona a delegation whose capability word is `merge`, with a maximum risk tier of `low` or `standard`, an expiry, and revocation, exactly as ADR 0005's delegations work. An agent holding that delegation may claim an item at a stage whose exit is `human_approval` with the `merge` connector, and submit it. Inside the `submit_to_gate` transaction the kernel locks and re-reads the delegation and the grantor's grants, runs the ship rule with the delegation as an input, and either records one gate decision or records `ship_refused` and leaves the item parked for a person. The decision's approver is the granting person, its actor is the agent identity, and it names the delegation. The merge itself runs from the system's minute job, which refreshes the facts from GitHub, re-checks the delegation and the grantor's `admin`, and runs the ship rule again before the merge connector, as SR-3 does for a person's approval. This is V2-1 and V2-7 of the v0.2.0 design.

**What changes in earlier decisions.**

- ADR 0002. No verb is added: `approve`, `merge`, `deploy`, `publish` and `advance` stay forbidden, and the MCP surface is unchanged. What changes is what the kernel does with `submit_to_gate` at a merge Ship stage when the claim carries a live merge delegation. An agent's request still never holds a GitHub write client.
- ADR 0003. The Postgres check "the approver is a human principal" (`gate_decisions_actor_is_human`) is unchanged: the approver on a delegated row is the grantor. New checks: an agent actor requires a delegation (`gate_decisions_agent_with_delegation`), and a delegated row is a merge approval (`gate_decisions_delegated_approves_merge`); the delegation must belong to the decision's harness (a composite foreign key), and since migration 0039 that key also binds the row's agent actor to the delegation's persona and its approver to the delegation's grantor (`delegations.grantor`, generated from the person), so the database refuses any other approver on a delegated row. The ship rule stays pure; its input gains the delegation's tier and the protected paths the change touches, and it refuses `tier_above_delegation` and `protected_path_needs_person`.
- ADR 0005. The capability word `merge` was already in the closed set; it now alone carries `max_tier` and alone lends the Ship exit; `high` is refused `tier_not_delegable`.
- ADR 0009. The person surface is still the only place a person decides a gate. One more kernel wired with GitHub exists: the minute job's, in `apps/uw-app/cron/delegated-exits.ts`, which calls only `kernel.gates.exitDelegated` as the system principal, and the kernel refuses that call to everyone else. AB-7's static check allows exactly that call in exactly that file, and a new check allows exactly two functions to write `gate_decisions`: the gate command's `recordDecision` and the delegated Ship exit's `recordDelegatedDecision`.

**What a delegation never covers.** Deploy and publish connectors (the database refuses a delegated row naming any connector but `merge`, and a property over every template's paths fails if a delegated exit could reach one), a changed file under a protected path (the kernel's protected directories and the harness's `protected_paths`), a change whose tier is above the delegation's, `high` at all, a shadow harness, and a loop target.

**Rejected.**

- An agent `merge` verb. It would put the merge on the MCP surface, where ADR 0002 says a gate verb cannot exist, and every host would serve it.
- A per-repository auto-merge flag with no grantor. Nobody would be the approver of record, the expiry and revocation of ADR 0005 would not apply, and the Postgres rule would need an exception for a row with no person.
- Running the merge on the agent's own request. It would put a GitHub write client in a kernel an agent's request builds, which ADR 0009 and the GH-6 checks keep out.
- Letting a delegation cover `high`, deploy, publish or protected paths. The bench owner's fourth non-negotiable; those stay a person's at the keyboard.

**Consequences.** A harness that opts in merges a change nobody read, bounded by the tier, the protected paths, the expiry and the ship rule run twice, and the record names who lent the exit. Delegated merges are shown on the Gates screen, in the play-by-play and on `/health`, and wake the grantor. AGENTS.md section 10 names the one agent-reachable writer. Source: design `docs/superpowers/specs/2026-10-15-harness-v0-2-0-design.md` V2-1, V2-7 and section 5.2; PRD MD-1 to MD-6; spec D8, D18.
