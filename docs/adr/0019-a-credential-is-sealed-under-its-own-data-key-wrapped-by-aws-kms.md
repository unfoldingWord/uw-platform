---
status: accepted
date: 2026-11-20
---
# A credential is sealed under its own data key, wrapped by AWS KMS

The credentials store (#157 to #159) holds secrets that belong to an area's work. Its first guarantee is that a copy of the database alone reveals nothing (`prd/Credentials Store - Design Proposal.md`, Part 2), and the owner chose AWS KMS over a Worker secret as the place the key-encryption key lives (Decisions, 2026-11-19). This ADR records how that is built, because the storage format is hard to change once a credential is stored under it.

**Decision (2026-11-20).**

- **One data key per credential version.** Sealing a value asks KMS `GenerateDataKey` for a fresh 256-bit key. The value is encrypted with it once, and the key is kept only wrapped, in the same row as the ciphertext. Rotating a credential adds a version with a new data key; no key ever seals two values.
- **AES-256-GCM through Web Crypto**, the same code on Workers and on Node. The nonce is 96 random bits, stored beside the ciphertext; the tag is 128 bits. Because a data key seals exactly one value, a nonce cannot repeat under a key. No cipher mode, padding or key derivation of our own.
- **The encryption context is the credential, the version and the JD area** (`purpose`, `credential_id`, `version_id`, `jd_area`). It is bound twice. KMS takes it as the `EncryptionContext` of the data key and refuses to unwrap under any other; and the cipher takes it, with the cipher name and the key id, as additional authenticated data. So a ciphertext copied onto another credential or version, or a credential row whose `jd_area` was rewritten to an area the attacker administers, does not open, even for someone the ACL would then allow.
- **Every failure is a closed-set reason.** `key_rejected` (KMS will not unwrap this key under this context), `key_service_refused`, `key_service_unavailable`, `ciphertext_rejected` (the tag did not verify) and `envelope_malformed`. No exception text reaches a caller or the log; a check constraint refuses any other reason in `credential_access_log`.
- **The key service is an app-level seam, not a kernel port.** `DataKeys` (`apps/uw-app/credentials/data-keys.ts`) has two calls, `generate` and `unwrap`. The AWS adapter (`credentials/kms/aws.ts`) and the in-memory test adapter (`credentials/testing/memory-data-keys.ts`) run the same contract suite. The kernel never seals or opens a credential, so it is not given a port that can.
- **KMS is called with a signed `fetch`, not the AWS SDK.** Two JSON calls, signed by `aws4fetch`. Dependency-cruiser keeps the signer inside `credentials/kms/` and the KMS client inside `credentials/`.
- **Five tables, one writer** (`apps/uw-app/credentials/`). `credentials` holds no value. `credential_versions` is append-only: the database refuses UPDATE, DELETE and TRUNCATE. `credential_access_log` is append-only and the database refuses to delete a row younger than seven years. Each has a read rule (ADR 0017): `credentials` at `see`, `credential_grants` like a role grant, the rest at `manage`.
- **One function opens a value.** `openCredential` loads the bindings and the live reveal grants, asks `can()` for `use` or `reveal` (ADR 0018), refuses a revoked or expired credential, and writes the access log, done or refused, before it returns. There is no decrypt that skips the check or the log.
- **Access is checked twice, and the second check decides (2026-11-20, review of #157).** The key service can take seconds to answer, so what was true when the request arrived may not be true when the bytes exist. After the unwrap, `openCredential` opens one transaction that locks the credential row (`FOR UPDATE`), reads the credential, its bindings and its reveal grants again, reads the person's status and role grants again under a share lock (`credentials/live-actor.ts`; a grant the principal carried that is no longer live is dropped, and none is added), takes a fresh time from the clock, and asks `can()` and the revoked and expired checks again. Only then is the `done` row written, in that same transaction, stamped with the fresh time, and the value returned. If the second check refuses, the decrypted bytes are zeroed and a `refused` row is written with the closed-set reason; if anything throws, the bytes are zeroed and nothing is released. A revocation, an unbinding or a withdrawn reveal grant that commits before the lock is taken wins. One that commits after the `done` row is a later event and the log shows it as one. What remains is the time between that commit and the caller using the bytes: no lock can cover it, and it is the same as the request having arrived that much earlier. A rotation that commits during the unwrap does not refuse the open: the caller gets the version the log row names.
- **Sealing follows the same rule.** `createCredential` and `rotateCredential` check `manage` before asking for a data key and again, with the person's role grants read afresh, inside the transaction that writes. A rotation refused there is recorded; a creation refused there writes nothing, as before.
- **Every rotation is recorded, including one refused for its value.** `value_not_storable` (an empty value, or one over 64 KiB) is in the closed set the access log accepts (migration `0051_value_not_storable_reason`), and `rotateCredential` records it like any other refusal. A creation refused for its value still writes nothing: there is no credential for a log row to point at.

**Rejected.**

- **A Worker secret as the key-encryption key.** Simpler and free, but anyone holding that secret and a database dump opens everything, and no unwrap is logged outside the platform. The owner's decision.
- **One data key per credential, reused across versions**, or one per area. Fewer KMS calls, but a nonce would then have to be unique per key across rotations, and one leaked data key would open every past value.
- **KMS `Encrypt` on the value directly, with no data key.** It works for values under 4 KB and fails for a certificate chain or an SSH key; envelope encryption has no size limit that matters.
- **`@aws-sdk/client-kms`.** Maintained by AWS, but it adds a large dependency tree to the Worker bundle for two HTTP calls. If `aws4fetch` stops being maintained, `@smithy/signature-v4` replaces it inside `credentials/kms/aws.ts` and nothing else changes.
- **A kernel port in `packages/harness/ports.ts` with a sim adapter**, as the issue's wording suggests. The kernel does not reach KMS in this design: a connector's platform adapter does (#158). A port the kernel never calls would hand kernel code the ability to unwrap data keys, and its adapters would have to be listed in the frozen progress tracker (`tools/architecture/no-live-account.test.ts`). Moving the seam into `ports.ts` later is a file move; the contract suite already exists.
- **`bytea` columns.** Base64 `text` reads the same on Postgres and on the embedded database the tests use, and is what the KMS API speaks.

**Consequences.**

- Opening a value costs one KMS `Decrypt`; a connector that uses a credential often will want a short in-memory cache, which is #158's decision.
- Losing the KMS key loses every credential. The key needs deletion protection and its policy needs review as infrastructure; neither is declared in `infra/` yet.
- KMS key rotation (new backing material under the same key) needs no change here: KMS unwraps old data keys with the old material. Moving to a different key means re-sealing each credential as a new version.
- Old versions are never destroyed yet. The design says they are, after a grace period; that needs a grace period and a relaxation of the append-only trigger, and is not in #157.
- The Worker's KMS credentials are a long-lived access key pair read from the Worker's settings until #160 moves them to Cloudflare Secrets Store.
- Nothing calls the store from a route, a verb or a screen yet: #158 and #159.

Source: issue #157; `prd/Credentials Store - Design Proposal.md`, Part 2; ADR 0017; ADR 0018.
