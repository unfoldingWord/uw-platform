---
status: accepted
date: 2026-11-20
---
# Platform secrets are read at the Worker's entry, from the Secrets Store first

Every secret the platform runs on was a Worker secret: a string on `env`, readable by all of `uw-app` (`prd/Credentials Store - Design Proposal.md`, finding 4). Issue #160 moves them to Cloudflare Secrets Store, each Worker binding only what it reads, with the AWS key pair #157 uses to call KMS among them. A Secrets Store binding is not a string; it is read with `await binding.get()`. A stored value cannot be read back, from a Worker secret or from the store, so the move re-enters or re-issues every value by hand. This ADR records how the code reads a secret and how the move is made reversible, because both are hard to change once production depends on them.

**Decision (2026-11-20).**

- **One seam, at the entry.** `withSecrets(env)` (`apps/uw-app/secrets.ts`, `apps/uw-ingest/secrets.ts`, over `packages/core/platform-secrets.ts`) runs before a request, a queue batch, a cron or a run is handled. It returns the same bindings with every listed secret as a plain string under its old name, and `SECRET_SOURCES`, which says where each came from. No config reader, engine or route changed, and none awaits a secret.
- **The store first, the Worker secret second.** A secret `X` is read from the binding `STORE_X` when one is declared, and from the Worker secret `X` when none is. The binding has its own name so that both can exist on a Worker at once: a deploy that adds a binding cannot replace or drop the Worker secret, and removing the binding puts the Worker secret back in use.
- **A fallback is never silent.** If a declared binding cannot be read, the Worker secret is used while one exists, the `secrets` health indicator is red, and the Worker logs `secret_store_unreadable` with the secret's name. Health counts sources (`from the Secrets Store`, `from Worker secrets`, `not set`, `unreadable`) and never names a secret or shows a value, because `/health/probe` and `uw-ingest`'s `/health` are public.
- **Read once per Worker instance, re-read every five minutes**, thirty seconds after a failed read. A rotated value arrives without a deploy.
- **Declared in the go-live file, copied secret by secret.** Each `wrangler.go-live.toml` declares every binding for staging and production; `wrangler.toml` holds the blocks whose secrets exist in the store. `preview` binds none. A test keeps a live block equal to its go-live twin and refuses one whose secret has no owner and rotation date in `infra/secrets-store.json`, the list under 30-39 Infrastructure.
- **One name per environment in the store**, `UW_STAGING_<NAME>` and `UW_PRODUCTION_<NAME>`: an account has one store and at most 100 secrets, and this uses 32.
- **The KMS key pair moves with the rest**, bound to `uw-app` only. Its IAM policy, `kms:Decrypt` and `kms:GenerateDataKey` on the one key, is declared in `infra/aws/credentials-kms.json`. It is an IAM user, not a role: a Worker has no identity AWS can trust to assume one.

**Rejected.**

- **Switching in one step**, with the binding under the secret's own name. What a deploy does when a binding and a Worker secret share a name could not be confirmed without an account; if the binding replaces the secret, a bad value in the store could only be undone by re-entering the old one. With two names the question does not arise and the rollback is a revert.
- **Making every reader async** (`await env.X.get()` where the string was read). About twenty modules and their tests would change for no gain in what a Worker can reach: least privilege here is per Worker, set by its bindings.
- **Reading on every request with no memory.** Fourteen reads before each response; what one costs could not be measured without an account.
- **Names in the health indicator.** Easier to act on, but the probe is public. The names are in the log.
- **Amber while any Worker secret is still in use.** Every environment would show Watch from the day this merges until its move is done, and people would stop reading it. The count says it instead.
- **Moving the GitHub App ids and installation ids.** They are not secrets. They stay Worker settings; declaring them as vars is a separate change.

**Consequences.**

- Until a person moves an environment, nothing changes there: every secret is read from its Worker secret and health says so.
- The deploy token needs Secrets Store edit to deploy a Worker that binds a secret. That token can then create, replace and delete stored secrets, though not read them. It is the same token the 2026-09-30 exception describes.
- A cold Worker instance waits for its secrets before its first response. If that is slow on staging, the freshness window is the knob.
- A secret kept in memory for five minutes means a revoked value can be used for up to five minutes after it is replaced in the store.
- `tools/github-apps/convert.ts` still sets a new App's private key as a Worker secret. It works, and health counts it; moving it to the store is by hand until that tool is changed.
- The runbook is `infra/README.md`, "Platform secrets in Cloudflare Secrets Store".

Source: issue #160; `prd/Credentials Store - Design Proposal.md`, "Platform secrets versus area credentials"; ADR 0019.
