---
status: accepted
date: 2026-09-29
---
# The harness engine is pure TypeScript over ports, driven headlessly in a sim

The spec names its guarantees as tests: replay equals record, every path from Package to an external effect crosses a human gate, the ship rule is deterministic over its inputs, the two hosts see identical verbs. It also names seams that vary: six engines behind one interface, connectors and validators in registries, two run shapes, two hosts. Both facts point the same way. We put the stage machine, the ship rule, the walker, the fold and every module in `packages/harness`, pure TypeScript with no Worker, vendor or database import, reached only through a fixed set of ports, each with exactly two adapters: the platform one in `apps/uw-app` and an in-memory one in `sim/`. The sim wires harnesses over memory adapters, a fixture GitHub and scripted personas, so Figure 2 runs end to end in Node in milliseconds and every spec test but two runs without a deployed Worker.

The alternative, engine logic written directly against Drizzle, Workflows and the vendor SDKs inside the Worker, would have made staging the only place the harness can be observed, and would have made the property tests the spec relies on into integration tests nobody runs.

**Consequences.** The Worker is thin: adapters, rendering and wiring. A port with a single adapter is a defect. Two tests stay on real Postgres because the pure layer cannot prove them: the null-safe stage check constraint and the locked grant re-read race. dependency-cruiser and ESLint enforce the layering; a violation is a red build, not a review comment. The plan's rule that a vendor SDK is named in one directory becomes a structural fact, since only an engine adapter may import one.
