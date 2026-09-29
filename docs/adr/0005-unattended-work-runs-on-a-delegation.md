---
status: accepted
date: 2026-09-29
---
# Unattended work runs on a delegation, on every host

The plan requires a principal on every request. An unattended beat, a scheduled Workflow or a person's hourly routine on their own laptop, has no live human session to mint one from. So a beat carries no one's authority; it carries a delegation: a row in which a person holding `admin` on the harness's area grants a persona one capability word for a bounded time, revocable, with a required expiry that defaults to ninety days. Every unattended claim, on either host, presents a live delegation or is refused with `delegation_required`. At every beat the engine checks that the delegation is unexpired, unrevoked and that the grantor still holds `admin`; any of the three failing stops the loop and writes `delegation_lapsed`. The identity on every event is `agent:<person>/<device> as <persona> via delegation:<id>`.

The earlier draft said "beats carry their creator's authority". Jesse's review found three faults: the authority should be the approver's, it must end when the person leaves or loses their grant, and the plan's principal model needs an explicit record. The Codex review then found that calling a person's scheduled routine an "external runner" had quietly exempted it; it is not exempt.

**Consequences.** A routine authenticates with a non-interactive service token, and a non-interactive principal cannot claim without a delegation id. Delegations appear on the person's page, the persona's dashboard and the quarterly access review, exactly as time-boxed contractor grants do. A person's routine "identifying itself in the system" is the claim itself, with its delegation. Source: spec "Unattended loops run on a delegation", "A scheduled routine is an external runner on a delegation", D18, D22.
