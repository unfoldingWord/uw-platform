---
status: accepted
date: 2026-11-20
---
# A connector uses a credential by reference, as the run's person

ADR 0017 says who may `use` a credential and ADR 0018 says how a value is sealed and opened. Neither says how a value gets from the store to the outside service a connector calls without passing through anything an agent can read. The design (`prd/Credentials Store - Design Proposal.md`, Part 2, "How agents and connectors use one") gives the shape: the caller holds a reference, platform code opens the value, calls out and discards it. This ADR records how that is built, because every later connector that needs a credential copies it.

**Decision (2026-11-20).** One function, `useCredential` in `apps/uw-app/credentials/use.ts`, is the only way a value leaves the store for use.

- **The caller names a credential by reference.** It passes `{ credentialId }`, the workflow and connector the use comes from, the run, the trace id, the principal the run acts as, and a function to call. It never receives bytes or text.
- **The store asks about the run's person.** The principal a caller passes says who is acting and which person the run works for. Its grants are not trusted: the store looks the person up, refuses one who is not active, and reads that person's live grants from `role_grants` at the moment of the use. It then asks `can()` for `use` with the acting identity and those grants. So a hosted run's seed principal, which carries no grants, uses on its person's grants; a principal carrying grants its person has since lost is refused; and a principal with no person (the system, the ingest identity, a service token nobody bound) is refused. The access log records the acting identity as the actor and the person beside it. The person's status and grants are read a second time at the final check (ADR 0018), after the key service has answered and under the credential row lock, so a person who lost the grant, or a credential unbound or revoked, during the unwrap never reaches the caller's function.
- **The value exists as a `Secret` for the length of one call.** `openCredential` returns the bytes; `useCredential` wraps them in a `Secret<string>` and hands that to the caller's function. Only `exposeSecret` gives the text back, and the caller uses it where it builds the outside request. When the function returns or throws, the bytes are zeroed and the `Secret` exposes nothing. Nothing is cached, so every use is one KMS `Decrypt` and one row in the access log.
- **A `Secret` shows a marker everywhere else.** The bytes are held outside the object, in a map private to `credentials/secret.ts`, so the object has no property to serialise, clone or walk. As a string, in JSON, in a template, in a log line, in a console dump, in an event and in a page it renders `[secret]`. It does not throw: a log line that throws on the request path would turn a logging mistake into a failed request.
- **The outcome is searched before it is handed back.** What the caller's function returns is walked for the value, as text, as bytes and in base64. An outcome that carries it, or that cannot be walked to the end (a `Map`, an `Error`, a `Response`, a loop, too deep or too large), is refused `value_in_outcome`. A function that throws is answered `connector_failed` with no text, because an outside service's error often quotes the request.
- **Binding and unbinding are the store's writes.** `bindCredential` and `unbindCredential` (`credentials/bindings.ts`) need `manage`, lock the credential row (`FOR UPDATE`, the lock the final check takes, so an unbinding and an open in flight are decided one after the other), refuse a revoked credential for a bind and allow an unbind, and write the access log in the same transaction. `unbind` is its own action in the log's closed set, so the log says when a use stopped being possible.
- **A store with no key service refuses by reason.** When the four KMS settings are absent or malformed, `credentialsDepsOf` (`credentials/compose.ts`) wires an adapter that answers `key_service_not_configured` to every call. Nothing throws, a use is recorded as refused, and a create writes nothing.
- **Three build rules hold the boundary.** Only the store imports the files that open a sealed value (`open.ts`, `envelope.ts`, `outcome-guard.ts`). Only the store and the connectors adapter (`apps/uw-app/ports/connectors.ts`) import `use.ts` and `secret.ts`. Nothing under `apps/uw-app/mcp/`, `engines/`, `runs/` or `agents/` imports any file of the store. With the restricted-reads ledger (ADR 0016), which lists every file that reads a credential table, no verb, prompt or run step can reach a value.

**Rulings this ADR makes,** where the issue and the design left a choice.

- **No verb is added and no verb takes a reference yet.** The design draws an agent passing `credential_ref` to an MCP verb that runs a connector. Today the only connectors are the five effect connectors (`merge`, `deploy`, `publish`, `send`, `post`), `credential_bindings.connector_key` is checked against exactly those, and they run on a stage's exit after its gate, never from a verb: ADR 0002 keeps merge, deploy and publish out of the verb registry. A verb that ran one would let an agent pass a human gate. So the reference mechanism is built and proven on its own, and a reference will be named in configuration a person writes (a stage's connector settings), not in a tool call.
- **No connector uses a credential yet.** `merge` signs with the GitHub App keys, which are platform secrets (#160), and the other four are not wired. `ConnectorRequest` therefore does not carry a reference or the acting principal; the pull request that wires the first credentialed connector adds both to the kernel port and reads the reference from the stage.
- **A use is not a harness event.** It is a row in `credential_access_log`, which is `sensitive` and read at `manage`. `harness_events` is read by everyone who reads the workflow's area, and an event naming a credential would tell them it exists, which is `see`. The connector's own `connector_succeeded` or `connector_refused` event still records that the effect ran.
- **`manage` on the credential is enough to bind.** The design says an area admin decides which workflow and connector may use a credential. Binding gives nobody new access to the workflow, and a use still needs `editor` on the credential's own area, so no grant on the workflow's area is asked.
- **The run is recorded as given.** The caller is platform code and passes the run id it holds; the store does not read `harness_runs`, which the kernel owns.

**Rejected.**

- **Trust the grants on the principal.** They are minted when a request or a run step starts. A grant revoked during a long run would keep working until the run ended, and the design says use ends when the role grant is revoked.
- **A person principal built for the check,** as a delegation's lender is (`packages/harness/gates/lent.ts`). The log would then name the person as the actor of a call an agent made.
- **Return the value and trust the caller to drop it.** Every caller would then decide for itself when the value is gone, and one that put it on a result would leak it into an event.
- **A `Secret` that throws when serialised.** It finds the mistake sooner, and it fails a request in production for a mistake that leaked nothing.
- **A short cache of opened values.** ADR 0018 left it to this issue. It saves a KMS call and keeps plaintext in an isolate between requests, and it would let a use succeed after a revoke without a log row that matches a KMS record.

**Consequences.**

- A JavaScript string cannot be zeroed. The text `exposeSecret` returns lives until the garbage collector takes it, as does any header or body built from it. The bytes the store holds are zeroed.
- The search of an outcome is a net, not a proof: a value split in two, encrypted or re-encoded some other way passes. The proof is the build rules; the search catches the plain mistake.
- The reveal command of #159 opens a value for a person and must add its one file to `credential-value-opened-only-inside-the-store`, in that pull request, with its reason.
- A delegation narrows an agent to one workflow's area; the use check reads all of its person's grants. The binding, which names the workflow, is what keeps a delegated run to the credentials meant for it.

Source: issue #158; `prd/Credentials Store - Design Proposal.md`, Part 2; ADR 0002; ADR 0016; ADR 0017; ADR 0018.
