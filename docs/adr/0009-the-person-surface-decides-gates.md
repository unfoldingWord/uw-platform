---
status: accepted
date: 2026-10-03
---
# The person surface decides gates

Amended by [ADR 0010](0010-merge-under-delegation.md): the minute job's `apps/uw-app/cron/delegated-exits.ts` is the one file outside the person surface that calls a gate command, `kernel.gates.exitDelegated`, as the system principal.

People approve, reject, take over and override gates, and recover lost connector results, through the command API (`POST /api/harness/:harness/commands/:name`). Those commands call `kernel.gates`; the stage commands call `kernel.stages`; delegation commands call `kernel.delegations.grant` and `revoke`. Before this, the AB-7 static check refused any such call anywhere in the import closure of `apps/uw-app/app.tsx`, because nothing in the app decided a gate.

**Decision.** The person surface is one directory, `apps/uw-app/commands/person/`. It is the only place in `uw-app` that calls `kernel.gates`, `kernel.stages` and `kernel.delegations.grant`/`revoke`.

- The AB-7 static closure still starts at `apps/uw-app/app.tsx`, `apps/uw-app/index.ts` and every file under `apps/uw-app/mcp/`. In a file under the person surface, and only there, it allows a direct call `kernel.gates.<command>(…)`, `kernel.stages.<command>(…)`, `kernel.delegations.grant(…)` or `kernel.delegations.revoke(…)`. Everything else it refuses stays refused there too: naming `gate_decisions` or `harness_stages`, `kernel.repair`, a connector, `exitThroughConnector`, the delegation write gateway, destructuring or bracket access to `gates`, and a reference to a gate command that is not a call.
- Nothing reached from `apps/uw-app/mcp/` (the external MCP route and the in-process Workflow host) may reach any file under `apps/uw-app/commands/`. The closure check walks every relative import (static, re-export and dynamic) from every MCP file, and dependency-cruiser refuses a direct import from `mcp/`, `engines/`, `queue/` or `cron/` into `commands/`, and an import of the person surface from outside `commands/`.
- Only `apps/uw-app/commands/person/gates.ts` builds a kernel with GitHub (`gateKernel`, the read client and the ship writes). It builds one only for a person principal whose identity is `human:<personId>`; for any other caller it uses the dispatcher's ordinary kernel, and the dispatcher hands the GitHub opener only to a human on a gate command.
- The kernel's own refusals are the enforcement: `kernel.gates.decide` refuses every agent identity and records `gate_refused_to_agent`, re-reads the approver's grants under lock and requires `admin`; `recoverConnectors` refuses every caller who is not a person. The static check is the backstop that keeps a gate call out of anything an agent's closure reaches.

**Rejected.**

- A second Worker for people. It would keep gate calls out of the agent Worker's bundle entirely, but it doubles the deploy surface, the Access applications, the bindings and the health checks, for a guarantee the kernel already gives at runtime.
- An allow-list of individual handlers in the static check. It names files one by one, so it drifts each time a handler is added or split, and a reviewer cannot see the rule from the directory layout.

**Consequences.** A new handler that touches gates, stages or delegation grants must live in `apps/uw-app/commands/person/`, where review looks. The AB-7 table in `docs/architecture.md` and the exceptions row in `docs/exceptions.md` describe the same boundary.
