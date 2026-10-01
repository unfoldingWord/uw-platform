---
status: accepted
date: 2026-09-29
amended: 2026-10-01
---
# The harness kernel is pure TypeScript over ports, driven headlessly in a sim

The spec names its guarantees as tests: replay equals record, every path from Package to an external effect crosses a human gate, the ship rule is deterministic over its inputs, the two hosts see identical verbs. It also names seams that vary: six engines behind one interface, connectors and validators in registries, two run shapes, two hosts. Both facts point the same way. We put the stage machine, the ship rule, the walker, the fold and every module in `packages/harness`, the kernel: pure TypeScript with no Worker, vendor or database import, reached only through a fixed set of ports, the database included. Each port has a platform adapter in `apps/uw-app` and a test adapter in `sim/`. The sim wires harnesses over test adapters, a fixture GitHub and scripted personas, so Figure 2 runs end to end in Node and every spec test but the ones that race two connections runs without a deployed Worker.

The alternative, kernel logic written directly against Drizzle, Workflows and the vendor SDKs inside the Worker, would have made staging the only place the harness can be observed, and would have made the property tests the spec relies on into integration tests nobody runs.

**Consequences.** The Worker is thin: adapters, rendering and wiring. Every port has a platform adapter and a test adapter, and may have more than one platform adapter. Every port has one contract test that runs against every adapter, so the two cannot drift. dependency-cruiser and ESLint enforce the layering; a violation is a red build, not a review comment. The plan's rule that a vendor SDK is named in one directory becomes a structural fact, since only an engine adapter may import one.

**Amended 2026-10-01 (issue #82).** This shape was carried over from `uw-app`, a single-user offline phone app. Four details did not fit a multi-user server whose core guarantees are enforced by Postgres, and are corrected here.

- The pure core is called the kernel. "Engine" means only the code behind the model-vendor seam.
- The Store port's test adapter is the same Drizzle adapter over an embedded Postgres (PGlite) running the real migrations, not hand-written in-memory tables. A hand-written fake would have to imitate transactions, the Ship check constraint, the conditional lease claim and the append-only rule, and a green sim would then prove the kernel against that imitation. `sim/` may therefore import `packages/db`.
- "A port with a single adapter is a defect" is replaced by the rule above. Validators are a registry inside the kernel, not a port.
- The tests only real Postgres with separate connections can prove are more than the two first named. The table in `docs/architecture.md` lists each guarantee and where it runs.

The alternative considered on 2026-10-01 was to drop the Store port and let command handlers talk to Postgres directly, keeping ports only for external services. It was rejected: the kernel reaching everything outside itself through a port is the shape, and the embedded Postgres removes the cost that argued against it.
