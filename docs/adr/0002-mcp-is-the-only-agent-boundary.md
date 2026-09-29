---
status: accepted
date: 2026-09-29
---
# Agents reach the platform only through the MCP surface, and gate verbs do not exist

A persona touches the platform through one remote MCP server that serves exactly the verb registry published by `packages/contracts`. There is no verb for approving, merging, deploying, publishing or advancing past a human gate, for any agent identity, on any host. The gate is enforced by the absence of a route, not by a prompt or a permission check that a prompt could talk around. A persona is configuration over the verb registry and the run-shape registry; it can select from both and add to neither. A new verb, run shape or engine is reviewed code through the software harness.

The alternative, a broad internal API that agents call with a role that denies the dangerous verbs, would put the boundary in an authorization check that every new route has to remember, and would give a persona a place to ask for an exception. A verb that does not exist cannot be granted.

**Consequences.** The MCP surface is a versioned registry, not a hand-written list, and a CI test asserts the served tool list equals the registry and contains none of the forbidden verbs. A missing verb is visible: activating a persona whose `requires_tools` names an absent verb fails clearly and opens a card on the software harness. Both hosts see the same tools, asserted in CI. Source: spec Figure 1, Figure 3, "Jobs are config, verbs are code", D14.
