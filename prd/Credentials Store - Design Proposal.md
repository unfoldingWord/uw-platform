# Credentials Store: Design Proposal

**Status:** accepted 2026-11-19 (Jesse took every recommendation below). Finding 1 is fixed by issue #153 and ADR 0015; the rest is filed as issues.
**Date:** 2026-11-19
**Reviewed against:** `develop` at `a683d18c`. Sources: `packages/core/acl.ts`, `packages/core/principal.ts`, `packages/db/schema-platform.ts`, `apps/uw-platform/auth/`, `apps/uw-platform/acl/`, `apps/uw-platform/mcp/mint.ts` and `apps/uw-platform/env.ts`.

## Part 1. ACL audit: what is in the code today

### Working as designed

| Area | What the code does | Where |
|---|---|---|
| Sign-in at the edge | Verifies the Cloudflare Access JWT against the team's keys, issuer and audience, requiring RS256 and an expiry. The app and MCP use separate audiences, and setup is refused if they are the same. | `auth/access.ts` |
| Agent tokens | A service token is refused on the app surface. It works only on MCP. | `auth/principal-middleware.ts:29` |
| Dev login | Works only when Access is not configured and the host is local, so it cannot open a deployed Worker. | `auth/dev-principal.ts` |
| One permission check | `can(actor, read/write/admin, org/area, at)` with three roles at two scopes. Expired grants are dropped, and revoked grants are filtered when grants load. | `core/acl.ts`, `db/store/grants.ts:23` |
| Granting | Granting or revoking needs `admin` on the same scope. The last org admin cannot be revoked, and every change lands in `grant_audit`. | `acl/grant-commands.ts` |
| First admin | The bootstrap creates an org admin only if none exists, and records it in the audit as `bootstrap`. | `db/bootstrap-admin.ts` |
| Agents | An agent's MCP session runs with its bound person's grants, resolved fresh each time. | `mcp/mint.ts:125` |

### Findings

1. **Fixed by #153 and ADR 0015: a grant on an area now reads only that area.** Before that fix, an editor or admin on any area could read every area. This was deliberate (spec, the "org-wide read that `editor` anywhere carries"; `acl.test.ts:50,53`) and fits an open, Notion-like culture. It also means an editor in 80–89 can read Finance (20–29). The platform plan (§4) said finance detail and donor history would be excluded from that open read. That exclusion has not been built yet.
2. **Classification is labelling only, not enforcement.** Every table is labelled `public`, `internal`, `restricted` or `sensitive`. No read path in `apps/uw-platform` checks that label. Before any `restricted` or `sensitive` data arrives (credentials, gifts, ledger), reads of those rows must require a grant on that exact area. The broad cross-area read must not reach them. **Ruling (#155):** four restricted tables have no area (`grant_audit`, `service_tokens`, `push_subscriptions`, and `role_grants` for org grants), so they follow the record's owner: grants and their audit are read by org admins, the admin of the grant's area, and the grantee; service tokens and push subscriptions by the person they belong to, plus org admins.
3. **An agent carries all of its person's grants.** For pages and tasks this is acceptable. For credentials it is too broad (Part 2 narrows it).
4. **No credential store exists.** Every external secret is a Worker-wide environment secret: the model keys, five GitHub App private keys, the Access API token, the VAPID key and the Zulip bot key. Any code in `uw-platform` can read all of them, so the blast radius is the whole platform.
5. **The live grants could not be checked.** I could not see who actually holds what on staging and production: there is no database access from this machine, and production needs your go-ahead. Checks to run: list the live `role_grants`; confirm at least two org admins (bus factor); confirm nobody holds org-scope `editor` without need, since that means write access to every area, Finance included.

## Part 2. The credentials store

### What it must guarantee

- A credential belongs to a place in the Johnny.Decimal hierarchy. Only people with the right grant on that place can use it, see it or change it.
- **Using a credential and seeing it are different permissions.** Most of the time the system needs to *use* a credential (call an API, log in to a partner portal) and nobody needs to *see* it.
- Agents never receive a secret's value. They pass a reference, and platform code uses it for them. This follows ADR 0002: the dangerous verb does not exist.
- A database dump on its own reveals nothing.
- Every use, reveal and change is recorded.

### Where a credential lives in the hierarchy

Every credential has a `jd_area` (required, such as `20-29`). It can be pinned narrower, to a category (`28`, Monthly Close) or an ID (`43.27`). Credentials sit on the functional axis (where a thing lives). The Strategic Cascade is not used here.

A grant on an area covers that area's categories and IDs. A credential pinned to a category or ID can also be restricted to named people.

### Permissions (separate from page reads)

| Capability | What it lets you do | Who has it by default |
|---|---|---|
| `see` | Know the credential exists: its name, owner, expiry and last use. Never the value | `viewer` or higher **on that exact area** |
| `use` | Have a connector or run use it without seeing it | `editor` on that exact area, and only where the credential is bound (below) |
| `reveal` | See the plaintext value | Nobody by default. Needs an explicit, time-limited grant on that one credential from an area admin, and notifies the area's admins |
| `manage` | Create, rotate, revoke, bind, grant `reveal` | `admin` on that exact area |

**The open cross-area read never applies to credentials.** Every capability needs a grant on the credential's own area. **Ruling (#156):** the one org-scope exception is that an org admin gets `see` and `manage` on every credential, so someone can rotate or revoke when an area admin is unavailable. An org admin never gets `use` or `reveal`; to see a value, an org admin needs a reveal grant like anyone else. Org editors and org viewers get nothing on credentials. This is a new resource kind in `can()` with its own rule. It must not route through `read`. Its test cases come first: "an editor in 80–89 cannot use a 20–29 credential"; "an org admin cannot reveal without a reveal grant".

### How agents and connectors use one

```
agent ──(MCP verb with credential_ref)──> connector in uw-platform
                                           │ checks: run's person has `use` on the area
                                           │         credential is bound to this workflow + connector
                                           │         credential not expired or revoked
                                           ▼
                                   decrypt in memory → call the outside service → discard
                                           │
                                           ▼
                           credential_access_log (who, which run, which connector, outcome)
```

- **Binding:** `credential_bindings(credential_id, harness_id, connector_key)`. An area admin decides which workflow and which connector may use a credential. A grant alone is not enough: the credential must be bound to the place it is used.
- No MCP verb returns a value. There is no `read_credential`.
- The decrypted value has a branded type (`Secret<string>`) that cannot be logged, JSON-serialized or placed in an event, page or prompt. A test enforces this.

### Storage: envelope encryption

| Table | Holds | Classification |
|---|---|---|
| `credentials` | id, `jd_area`, optional `jd_ref`, name, kind (`api_key`, `oauth_refresh`, `password`, `ssh_key`, `certificate`), owner, `rotate_by`, `expires_at`, `revoked_at`. **No secret.** | `sensitive`, never offline |
| `credential_versions` | Append-only. Ciphertext, wrapped data key, key id, created by, created at. Rotating adds a version; old versions are destroyed after a grace period. | `sensitive`, never offline |
| `credential_grants` | Per-credential `reveal` grants (and named-person restrictions), with an expiry and who granted them | `restricted` |
| `credential_bindings` | Which workflow and connector may use it | `restricted` |
| `credential_access_log` | Append-only: use, reveal, rotate, revoke, bind, refused, with actor, run and trace | `sensitive`, kept 7 years |

Each value is encrypted with its own data key (AES-256-GCM, Web Crypto, available in Workers). That data key is wrapped by a **key-encryption key held outside Postgres**.

**Recommendation for where the key-encryption key lives: AWS KMS.** The database now runs on AWS Aurora, so KMS sits in the same account, and every unwrap is logged in CloudTrail. Stealing the database is then not enough: an attacker also needs KMS. The cheaper alternative is a Worker secret, which is simpler but means anyone with both the Worker secret and a database dump can decrypt everything. **This is your decision** (see below).

**Considered and not recommended:** running a separate vault (Infisical, HashiCorp Vault, or 1Password with only references in the app). Vault is the strongest option, but it adds a service to run, and the platform's goal is fewer moving parts. 1Password references could be added later for credentials people already keep there.

### Platform secrets versus area credentials

The secrets the platform itself runs on (model keys, GitHub App keys, Access API token, VAPID, Zulip bot) stay out of this store. They move from plain `wrangler secret` to **Cloudflare Secrets Store**, so each Worker binds only the secrets it needs, and they are listed under 30–39 Infrastructure for ownership and rotation. **Added (#160):** this includes the AWS credentials the store uses to call KMS, bound only to the Worker that decrypts, under an IAM role limited to `kms:Decrypt` and `kms:GenerateDataKey` on the one key. The credentials store is for credentials that belong to an area's work: partner APIs, portals, funder systems, bank exports.

### Lifecycle

- **Rotation:** `rotate_by` dates notify the owner and the area admins.
- **People leaving:** credentials belong to the area, not the person, so they survive a departure. That person's reveal grants and use end when their role grants are revoked.
- **Break-glass:** a reveal outside the normal grants needs two org admins, both recorded.

## Decisions (Jesse, 2026-11-19)

1. **Key-encryption key:** AWS KMS.
2. **Default for `use`:** any `editor` on the credential's area, where the credential is bound.
3. **Order:** the read-scope fix (#153) first, then classification-aware reads, then the store.
4. **Production check:** approved in principle. Reading the live `role_grants` still needs database access from a person, because no credentials exist on the build machine.
5. **An editor cannot read every area** (#153, ADR 0015). Org-wide visibility is now an explicit `viewer` grant at `org` scope.
6. **Persona activation across areas** answers `page_not_found` rather than `not_permitted`, so the platform does not confirm that a page exists to someone who cannot read it (#153).
7. **Tables with no area** follow the record's owner (#155). **Org admins** get `see` and `manage` on credentials, never `use` or `reveal` (#156). **The KMS credentials** are a platform secret (#160).
8. **Sign-in:** Google, per PRD FD-7; outsiders sign in and land as pending rather than being refused (#154).

## Proposed issues (one PR each, into `develop`)

1. ACL: classification-aware reads, so `restricted` and `sensitive` rows need a grant on their exact area (ADR).
2. ACL: credential capabilities `see`, `use`, `reveal`, `manage` in `can()`, with the test cases above (shared root: `packages/core/acl.ts`).
3. Credentials store: schema, envelope encryption, KMS adapter behind a port, test adapter for the sim (ADR).
4. Credentials: connector use path, bindings, `Secret` type and the test that it never leaves memory.
5. Credentials: the screen to manage, reveal, rotate and audit (area admins).
6. Platform secrets: move to Cloudflare Secrets Store with per-Worker bindings.
