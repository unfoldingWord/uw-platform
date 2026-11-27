# Google Workspace for personal assistants: one-time setup

This is the step-by-step setup a Google Cloud project owner and a Workspace super-admin do once per environment, before anyone turns an assistant on (PRD section 4.2, ADR 0039, ADR 0040, ADR 0042). The platform's own settings for it are in `infra/README.md`, section "Google Workspace". Nothing here is clicked twice: each step says how to check it is done.

The platform reaches Google with **one service account with domain-wide delegation** (owner decision 1). It acts:

- as a **person**, for that person's own calendar (`calendar.events`, `calendar.freebusy`);
- as an **assistant mailbox** (`<name>@unfoldingword.org`), for that mailbox's mail (`gmail.modify`);
- as **one admin account**, `GOOGLE_WORKSPACE_ADMIN_SUBJECT`, for the directory (`admin.directory.user`).

The code refuses, before it signs a token, any other subject or scope (`apps/uw-platform/assistants/google/token.ts`). Delegation itself cannot be narrowed to subjects in Google, so the audit alert in step 7 is the second line.

## Who does what

| Step | Who | Where |
|---|---|---|
| 1-3 | Google Cloud project owner | Google Cloud console, or `gcloud` |
| 4 | Whoever holds the Cloudflare Secrets Store role | `wrangler`, see `infra/README.md` "Platform secrets" |
| 5-8 | Workspace super-admin | admin.google.com |
| 9 | Whoever has the key file and a test person | a terminal with this repository |

Staging and production use **separate** service accounts and keys (and, if possible, separate projects), so a staging key can never act in production. The admin subject and the organizational unit may be the same account and unit for both, since they are inside one Workspace.

## 1. Project and APIs

```bash
gcloud projects create uw-platform-assistants-<env> --name="uw-platform assistants <env>"
gcloud config set project uw-platform-assistants-<env>
gcloud services enable calendar-json.googleapis.com gmail.googleapis.com admin.googleapis.com
```

Check: `gcloud services list --enabled` lists all three.

## 2. The service account

```bash
gcloud iam service-accounts create uw-assistants \
  --display-name="uw-platform assistants (<env>)"
gcloud iam service-accounts describe uw-assistants@uw-platform-assistants-<env>.iam.gserviceaccount.com \
  --format='value(oauth2ClientId)'
```

Write down the numeric **client id** the second command prints; step 6 needs it. The service account needs no IAM role in the project: delegation, not a role, is what lets it act.

## 3. One JSON key

```bash
gcloud iam service-accounts keys create "$TMPDIR/uw-assistants-<env>.json" \
  --iam-account=uw-assistants@uw-platform-assistants-<env>.iam.gserviceaccount.com
```

The file holds `client_email` and a `private_key` that begins `-----BEGIN PRIVATE KEY-----` (PKCS#8), which is the form the platform reads. Keep the file only until step 4 and step 9 are done, then delete it. If the organization policy `iam.disableServiceAccountKeyCreation` is enforced, a project owner must exempt this project first; the platform has no other way to sign as the service account from a Worker.

## 4. Store the key

The whole JSON file is the secret `GOOGLE_WORKSPACE_KEY` (`UW_STAGING_GOOGLE_WORKSPACE_KEY` or `UW_PRODUCTION_GOOGLE_WORKSPACE_KEY` in the Secrets Store). It has many lines, so pass it on standard input:

```bash
pnpm --filter @uw/uw-platform exec wrangler secrets-store secret create "$STORE_ID" \
  --name UW_<ENV>_GOOGLE_WORKSPACE_KEY --scopes workers --remote < "$TMPDIR/uw-assistants-<env>.json"
```

Then set its `owner` and `rotate_by` in `infra/secrets-store.json` and copy its `[[env.<env>.secrets_store_secrets]]` block into `infra/uw-platform/wrangler.toml`, as `infra/README.md` "Move staging" steps 2 and 3 say. Check: `/health/probe` counts one more secret from the Secrets Store.

## 5. The admin subject and the assistants' unit

In admin.google.com:

1. **Organizational unit.** Directory, Organizational units: create `/Assistants` (the value of `GOOGLE_ASSISTANT_OU`). Under Apps for that unit, turn off what an assistant does not need: Drive sharing outside the domain, Meet, Chat, YouTube, and any Marketplace apps. Under Gmail, Compliance, add a routing rule for the unit that **rejects mail from outside the domain**; an assistant then only hears from people inside the organization. Leave Calendar on.
2. **Admin subject.** Create a dedicated account, for example `platform-assistants-admin@unfoldingword.org`, that is no person's own account. Account, Admin roles: create a custom role "Assistant provisioner" with Admin API privileges Users: Create, Read, Update (which covers suspend) and Delete, assigned to this account **for the `/Assistants` unit only**. This address is `GOOGLE_WORKSPACE_ADMIN_SUBJECT` in both wrangler files.
3. **Licences.** Billing: confirm enough Workspace licences. Every assistant that is on, or was turned off in the last 30 days, holds one; the nightly deletion frees it (owner decision 11). If automatic licensing is off, assign the licence to the unit.

Check: the unit exists, the account shows the custom role scoped to the unit, and the licence count covers the people expected to turn an assistant on.

## 6. Domain-wide delegation

Security, Access and data control, API controls, Manage domain-wide delegation, Add new:

- **Client ID:** the numeric id from step 2.
- **OAuth scopes,** exactly these four, comma-separated:

  ```
  https://www.googleapis.com/auth/calendar.events,https://www.googleapis.com/auth/calendar.freebusy,https://www.googleapis.com/auth/gmail.modify,https://www.googleapis.com/auth/admin.directory.user
  ```

Add nothing else: not `gmail.send` (the probe in step 9 shows whether `gmail.modify` is enough to send; add `gmail.send` only if it fails, and say so in the code's allowlist), not a group scope, not Drive. Check: the entry lists the client id with exactly four scopes.

## 7. Audit alert

Security, Alert center, or Reporting, Rules: create a rule on the OAuth token log events for the service account's client id, alerting the platform owners when a token is issued for any user who is not a person, an assistant mailbox in `/Assistants`, or the admin subject. Check: create a test alert by running step 9 and confirm the events appear in the token log under the client id.

## 8. Rotation

Every 90 days at most: create a new key (step 3), store it with `secret update` (`infra/README.md` "Roll back"), confirm `/health/probe` and step 9's read probes pass, then delete the old key with `gcloud iam service-accounts keys delete <old key id> --iam-account=...`. Set the next `rotate_by`.

## 9. Probe it before anyone uses it

Run the probes from a terminal with the key file and a test person who has a Google calendar and a Zulip account. Without `--write` they only read; with it they create and remove a probe user, a probe hold and a probe Zulip bot, and send one direct message and one email to the test person.

```bash
cat > "$TMPDIR/uw-probe.env" <<'ENV'
GOOGLE_WORKSPACE_KEY_FILE=/path/to/uw-assistants-<env>.json
GOOGLE_WORKSPACE_DOMAIN=unfoldingword.org
GOOGLE_WORKSPACE_ADMIN_SUBJECT=platform-assistants-admin@unfoldingword.org
GOOGLE_ASSISTANT_OU=/Assistants
PROBE_PERSON_EMAIL=<test person>@unfoldingword.org
PROBE_COLLEAGUE_EMAIL=<a colleague>@unfoldingword.org
PROBE_ASSISTANT_MAILBOX=<an assistant's address, once one is turned on>
ENV
node --env-file="$TMPDIR/uw-probe.env" apps/uw-platform/bin/probe-assistants.ts
node --env-file="$TMPDIR/uw-probe.env" apps/uw-platform/bin/probe-assistants.ts --write
```

Each line is `PASS`, `FAIL`, `SKIP` (a setting is missing, or the probe writes and `--write` was not given) or `MANUAL` (only a person on staging can check it; the line says how). The probe ids are the numbered entries of the assistants' staging-probes list, which names the exact request and the answer the code expects for each. The command exits 1 if any probe failed. A Google failure reads as the code reads it: `refused` is a 400, 401 or 403 (a scope not delegated, a subject Google does not know, a missing privilege), `unavailable` is anything else.

For the DMARC probe (`s8.1`), first send a plain mail from the test person's own account to `PROBE_ASSISTANT_MAILBOX`. If it fails with `unverified_sender`, keep `ASSISTANT_EMAIL_INSTRUCTIONS = "off"` in production and tell the owner (owner rule; PRD open question 30).

Delete the key file and `$TMPDIR/uw-probe.env` afterwards.

## Undoing it

To stop the platform reaching Google at once: delete the domain-wide delegation entry (step 6). Every calendar verb is then refused, every mail sweep fails, and provisioning records `workspace_refused` and retries; nothing else breaks. Then delete the service account's keys and remove `GOOGLE_WORKSPACE_KEY` from the store.
