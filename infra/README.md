# infra

Everything Cloudflare, Neon and Access that the platform runs on is declared here. A setting that exists only in a dashboard is a defect (plan §19).

## uw-app

`uw-app/wrangler.toml` declares two environments, `staging` and `production`. Every command names its environment; the top-level block is never deployed.

| Environment | Worker name | Reachable at | Deployed by |
|---|---|---|---|
| staging | `uw-app-staging` | `https://uw-app-staging.<account subdomain>.workers.dev` | `main` (workflow in #68); by hand until then |
| production | `uw-app` | nowhere yet: no route, `workers_dev = false` | a tagged release only (#68) |

### Deploy staging by hand

```
pnpm --filter @uw/uw-app deploy:staging
```

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` come from the shell or from the CI secret store. They are never written to a wrangler file. The token is scoped to Workers Scripts edit on the one account.

The deployed commit reaches the Worker as the `COMMIT_SHA` var, set on the deploy command line. The value in the file is the placeholder `unknown`, which `/health/probe` reports when nothing was passed.

### Where each later binding goes

A binding is added by a diff to `uw-app/wrangler.toml`, once in `[env.staging]` and once in `[env.production]`, so the two cannot drift. Each block sits directly under the environment's `[env.<name>.vars]` table.

| Binding | Table to add | Issue |
|---|---|---|
| Hyperdrive | `[[env.<name>.hyperdrive]]` with `binding`, `id` | #7 |
| Queue consumer | `[[env.<name>.queues.consumers]]` with `queue` | #10 |
| Queue producer | `[[env.<name>.queues.producers]]` with `binding`, `queue` | #10 |
| Durable Objects | `[[env.<name>.durable_objects.bindings]]` with `name`, `class_name`, plus `[[env.<name>.migrations]]` | live hub |
| Workflows | `[[env.<name>.workflows]]` with `name`, `binding`, `class_name` | runs |
| Containers | `[[env.<name>.containers]]` with `class_name`, `image`, `max_instances`, plus a Durable Object binding per class and a migration | sandbox engines |
| Crons | `[env.<name>.triggers]` with `crons` | later |

Ids that are not secret (a Hyperdrive id) may be committed. A secret is set with `wrangler secret put --env <name>` and appears in the file nowhere.

### Sandbox containers (HE-8, HE-9)

`containers/claude-code/Dockerfile` and `containers/codex/Dockerfile` are the images the two sandbox engines run: Cloudflare's sandbox base image at a pinned tag, the one CLI installed globally at a pinned version, and a non-root `runner` user whose home is `/workspace`. Neither image holds a key, a token or a login: the CLI gets a placeholder key and a base URL of `http://model.internal`, and the Worker's egress proxy swaps in the organization's key on the way to AI Gateway (S7-R48). `tools/infra/containers.test.ts` refuses an `ENV` or `ARG` named like a credential, an unpinned base and an image that ends as root.

The classes `ClaudeCodeSandbox` and `CodexSandbox` (`apps/uw-app/engines/sandbox/classes.ts`) start with the internet off and send every outbound HTTP request through one handler, which answers `403 egress refused` for anything but the model host and `mcp.internal` (S7-R47). `wrangler.go-live.toml` declares them for staging and production only: two `[[env.<name>.containers]]` blocks, the `CLAUDE_CODE_SANDBOX` and `CODEX_SANDBOX` Durable Object bindings, and the top-level `v2` migration that adds both as SQLite classes. A deploy with these blocks needs Docker on the runner to build the images.

## Access (FD-7)

`access/uw-app.json` declares Cloudflare Access in front of `uw-app` on staging and every per-PR Worker, as three applications. The app application covers the host: people sign in with Google, and no service token is admitted. The `mcp` application covers `/mcp` alone with its own AUD tag: people sign their agents in with Google (through `cloudflared access`), and any valid service token passes as a non-identity request and becomes a non-interactive agent principal. Because the two applications have different audiences, a token an agent holds for `/mcp` is refused on every other path, and a browser session is refused on `/mcp` (R34). `/health/probe` alone is bypassed, on staging and on every per-PR Worker, so the deploy jobs (`deploy-staging.yml` and `deploy-pr.yml`, through `await-health.sh`) can read the deployed commit; `/health` itself shows the agent plane and needs a signed-in person. The app application sends its session cookie `SameSite=Lax`, so a form posted from another site carries no session. Applying either change on Cloudflare is a person's (Waiting on a person).

The allow policy admits any Google account on purpose. A person outside `@unfoldingword.org` must reach the app to be recorded as pending (FD-7). Authorization is the grants table, not Access.

The file holds the bodies of two Cloudflare API calls, applied by a person with an API token holding Access: Apps and Policies Edit:

- `POST /accounts/{account_id}/access/apps`, then `POST /accounts/{account_id}/access/apps/{app_id}/policies`, for `application` with `policies`.
- The same two calls for `health_bypass.application` with `health_bypass.policies`.
- The same two calls for `mcp.application` with `mcp.policies`.

Replace `<google-idp-id>` with the Google identity provider's id from `GET /accounts/{account_id}/access/identity_providers`. After creation, the app application's AUD tag, the `mcp` application's AUD tag and the team domain go into `ACCESS_AUD`, `ACCESS_MCP_AUD` and `ACCESS_TEAM_DOMAIN` in `infra/uw-app/wrangler.go-live.toml` (Task 16 of the step-1 plan). An AUD tag is configuration, not a secret. Production gets its own application when `uw-app` has a production route.

## uw-ingest

`uw-ingest/wrangler.toml` declares two environments, `staging` and `production`, like `uw-app`. uw-ingest is a separate Worker and is not behind Access: each webhook source authenticates by its signature over the raw body.

| Environment | Worker name | Reachable at | Deployed by |
|---|---|---|---|
| staging | `uw-ingest-staging` | `https://uw-ingest-staging.<account subdomain>.workers.dev` | `deploy-ingest-staging` after green CI on `main` |
| production | `uw-ingest` | nowhere yet: no route, `workers_dev = false` | `deploy-ingest-production` on a tagged release, after the production gate |

`GITHUB_WEBHOOK_SECRET` is a Worker secret, set with `wrangler secret put GITHUB_WEBHOOK_SECRET --env <name>`. It appears in no file.

The queue and Hyperdrive bindings are in `uw-ingest/wrangler.go-live.toml` until the resources exist; nothing in `wrangler.toml` binds a resource that is not there yet.

Deploy staging by hand:

```
pnpm --filter @uw/uw-ingest deploy:staging
```

## GitHub App (GH-1)

`github/app-manifest.json` declares the staging App, `uw-harness-staging`: private, its webhook pointed at `uw-ingest`'s `/webhooks/github` route, the five events `issues`, `pull_request`, `pull_request_review`, `check_run` and `push`, and least-privilege permissions. `metadata`, `checks` and `pull_requests` are read. `issues` is write for the cross-reference comment, and `contents` is write for the merge and its tag: GitHub's "Permissions required for GitHub Apps" lists `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge` under Contents write with no additional permission, and `POST /repos/{owner}/{repo}/git/refs` under Contents write with additional permissions marked; Workflows write is one of them, and a tag ref needs none of them. The harness writes nothing else to GitHub.

An org owner of `unfoldingWord` sets it up once, awaiting go-live:

1. Register the App with GitHub's "Register a GitHub App from a manifest" flow (docs.github.com): post the file's JSON, with a `redirect_url` added for the flow's one-time `code`, as the `manifest` field of a form to `https://github.com/organizations/unfoldingWord/settings/apps/new`, then exchange the code with `POST /app-manifests/{code}/conversions`. The answer carries the App id, the webhook secret and a private key, once.
2. Install the App on `unfoldingWord/uw-platform` only, and note the installation id from the installation's settings URL.
3. Convert the key to PKCS#8, which the Worker requires: `openssl pkcs8 -topk8 -nocrypt -in key.pem -out key.pkcs8.pem`. Delete both files after step 4.
4. Set the secrets. For `uw-app` (from `infra/uw-app`):

   ```
   wrangler secret put GITHUB_APP_ID --env <name>
   wrangler secret put GITHUB_APP_INSTALLATION_ID --env <name>
   wrangler secret put GITHUB_APP_PRIVATE_KEY --env <name>
   ```

   For `uw-ingest` (from `infra/uw-ingest`):

   ```
   wrangler secret put GITHUB_WEBHOOK_SECRET --env <name>
   ```

None of the four appears in any file. Until they are set, `uw-app` treats GitHub as not configured and nothing that runs needs them.

The production App is a second registration from a copy of the manifest with production's ingest URL, once that Worker has a route.

The webhook host assumes the account's `workers.dev` subdomain is `unfoldingword`; confirm it before registering, and correct the manifest if it differs.

### Tokens and the subrequest budget

`uw-app` signs a JWT with the App key and mints one installation token per unit of work: one queue delivery, one sweep run over one repository, or one connector run. Each token is scoped when it is minted, to the one repository the unit concerns and to the permissions of its client: the read client asks for `contents`, `pull_requests`, `issues`, `checks` and `metadata` read; the comment writer for `issues` write and `metadata` read; the merge and tag writes for `contents` write with `pull_requests` and `metadata` read. A read client's token never carries a write permission, and a client refuses a request for a second repository. Listing the installation's repositories uses a separate token with `metadata` read and no repository. The token lives only inside the client object for that unit, so it never reaches a caller, a log line, a model process or an MCP response. GitHub answers each token with its expiry (an hour); the client mints again when its token is within five minutes of expiry, and never keeps a failed mint, so the next request retries.

Each unit therefore spends one subrequest on the token plus one per GitHub request. The client bounds every list it reads: a pull request's files in one comparison of its base and head SHAs (GitHub lists at most 300 files there, and 300 or more counts as too many), the issues of a sweep at the caller's page limit, and any other list at 10 pages. A delivery that refreshes one pull request's facts makes at most 23 subrequests (token, pull request, the comparison, 10 pages of reviews, 10 of check runs) and usually 5. Every unit must stay under the Workers per-invocation subrequest limit of the account's plan.

The nightly sweep (`apps/uw-app/github/sweep.ts`, cron `17 3 * * *`) is one invocation over every repository. It spends one subrequest on the installation token that lists the repositories and one on each repository's own token, so it mints once per repository per run. It starts the repository it attempted least recently first, so a busy repository cannot starve the others. Per repository it reads 100 issues per request, each request starting from the greatest `updated_at` seen so far (keyset, so an item updated mid-listing or tied at a boundary is never skipped), then, for each pull request in that listing or still open in the read model, the pull request, its reviews, the check runs on its head and, when the files at that head and base are not stored, one comparison: 4 subrequests in the usual case and up to 23 with long review or check lists. The sweep counts every subrequest it sends and never sends more than its bound (`maxSubrequests`, 900 by default). It starts a pull request only while 8 remain, starts a repository only while its token, one listing page and one pull request fit, and shrinks the listing's page limit to what remains. A pull request it does not reach, or cannot read, waits for the next night: the watermark moves only to the greatest `updated_at` it listed and stored, never past the first listed pull request it did not store, and never back. Every run records its outcome (`ok`, `capped`, `stalled`, `deferred` or `failed`), the hold point and the reason in `gh_repos.last_sweep`. The bound must stay under the plan's per-invocation limit, which a person confirms before the cron trigger is switched on.

## Reviewer Apps (HE-4, HE-9)

Each Reviewer identity is its own GitHub App, so a review it posts is attributed to that identity and nothing else can post as it: `github/reviewer-app-manifest.json` declares `uw-reviewer` (the message engines' Reviewer) and `github/reviewer-codex-app-manifest.json` declares `uw-reviewer-codex` (the Codex engine's). Both are private, ask for `pull_requests` write and `metadata` read and nothing else, and subscribe to no event: the harness reads their reviews back through the harness App's `pull_request_review` webhook, which counts a review toward Ship only when its login (`uw-reviewer[bot]`, `uw-reviewer-codex[bot]`, `packages/harness/github/reviewers.ts`) is a Reviewer identity.

Only the run host's kernel (`apps/uw-app/runs/`) holds these Apps. It mints one token per review, scoped to the one repository and to `pull_requests` write and `metadata` read, and posts `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` with the head commit as `commit_id`. The MCP, queue, cron and command kernels never receive them.

An org owner of `unfoldingWord` registers each App once, awaiting go-live:

1. Register the App from its manifest with the same "Register a GitHub App from a manifest" flow as the harness App (above), adding a `redirect_url`. The App name must stay `uw-reviewer` or `uw-reviewer-codex`, since its slug is its Reviewer login; confirm GitHub kept the slug.
2. Install it on `unfoldingWord/uw-platform` only, and note the installation id.
3. Convert the key to PKCS#8 as above, then set the secrets for `uw-app` (from `infra/uw-app`):

   ```
   wrangler secret put REVIEWER_GITHUB_APP_ID --env <name>
   wrangler secret put REVIEWER_GITHUB_APP_INSTALLATION_ID --env <name>
   wrangler secret put REVIEWER_GITHUB_APP_PRIVATE_KEY --env <name>
   wrangler secret put REVIEWER_CODEX_GITHUB_APP_ID --env <name>
   wrangler secret put REVIEWER_CODEX_GITHUB_APP_INSTALLATION_ID --env <name>
   wrangler secret put REVIEWER_CODEX_GITHUB_APP_PRIVATE_KEY --env <name>
   ```

Until a Reviewer's three secrets are set, its review answers `not_wired` and the run completes `review_withheld`.

## The notifier: web push and Zulip (NT-1, NT-3)

The notifier reads its configuration from `uw-app`'s variables and secrets. With any piece missing or malformed, that channel answers `not_configured` and logs; nothing fails at startup.

Variables, in `infra/uw-app/wrangler.go-live.toml` under staging and production only (`set-at-go-live` until then):

| Variable | Value |
|---|---|
| `APP_ORIGIN` | The app's `https://` origin with no path; a Zulip post's link starts with it |
| `VAPID_PUBLIC_KEY` | The VAPID public key, base64url, 87 characters |
| `VAPID_SUBJECT` | `mailto:` an address that answers, or an `https://` page |
| `ZULIP_SITE` | The Zulip realm's `https://` origin |
| `ZULIP_BOT_EMAIL` | The bot's email address |
| `ZULIP_CHANNELS` | A JSON object from area to channel name, for example `{"80-89":"80-89 Technology"}`; an area with no channel drops its Zulip wakes. Each channel must be private, with members exactly the people who can read that area (see below) |

Secrets, set with `wrangler secret put <name> --env <name>` and written in no file:

```bash
# uw-app (from infra/uw-app)
wrangler secret put VAPID_PRIVATE_JWK --env <name>   # the VAPID private key as JWK JSON (kty EC, crv P-256, d, x, y)
wrangler secret put ZULIP_BOT_API_KEY --env <name>
# uw-ingest (from infra/uw-ingest)
wrangler secret put ZULIP_WEBHOOK_TOKEN --env <name>
```

The Zulip bot is an outgoing-webhook bot. Its endpoint URL is `https://<uw-ingest host>/webhooks/zulip`, its payload format is Zulip's own, and its token is `ZULIP_WEBHOOK_TOKEN`. `uw-ingest` answers an accepted delivery with no `content` and `"response_not_required": true`, so the bot posts nothing back.

A post reaches everyone in its channel, and the platform does not check who that is. Every channel in `ZULIP_CHANNELS` must therefore be a private channel (never public or web-public) whose members are exactly the people who can read that area: anyone with a live grant on the area, an org grant, or an editor or admin grant on any area. Whoever configures the realm keeps membership in step with grants: a person granted read on an area joins its channel, and a person whose grant is revoked or expires leaves it. Otherwise a person who cannot read the area sees its harness key, its repository names and issue numbers, and that a gate, a lapse or a failed run is waiting. The post carries only the harness key, the item ref, one fixed sentence and the link, never an item's title or body.

## Logs (FD-11)

Workers Logs is on for both Workers, in the top-level block and in `staging` and `production`, because wrangler does not carry top-level observability into an environment.

Thirty-day retention is the R2 bucket `uw-logs` with the lifecycle rule in `logs/r2-lifecycle.json`, fed by the Logpush job in `logs/logpush-workers.json`. A person applies both, once, awaiting go-live:

- Create the bucket `uw-logs`.
- Apply the rule with `PUT /accounts/{account_id}/r2/buckets/uw-logs/lifecycle`, sending `logs/r2-lifecycle.json` as the body.
- Substitute the three `${...}` placeholders in `logs/logpush-workers.json` from the shell with `envsubst`, then send it with `POST /accounts/{account_id}/logpush/jobs`.

Nothing in the files is a secret. `logpush = true` is added to `wrangler.go-live.toml` with the go-live wiring, because Workers Logpush needs the paid plan and the job above.

## Switching on the go-live wiring (FD-12)

`uw-app/wrangler.go-live.toml` and `uw-ingest/wrangler.go-live.toml` are each their `wrangler.toml` plus the bindings whose resources do not exist yet: `logpush`, the `HYPERDRIVE` binding, the ingest queue producer and consumer, the `INGEST_DLQ` producer, and uw-app's `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. A test keeps each file equal to its live twin plus exactly those.

`uw-app/wrangler.toml` also declares a `preview` environment. Per-PR Workers deploy with `--env preview`, so they never register as the staging queue consumer. In the go-live file `preview` binds Hyperdrive and declares no queue consumer. Its Hyperdrive id must equal staging's (P33); a test checks that they match.

A person adds, in the repository settings:

| Name | Kind | Where it comes from |
|---|---|---|
| `NEON_API_KEY` | secret | An API key for the Neon project |
| `NEON_PROJECT_ID` | variable | The Neon project's id |
| `NEON_DIRECT_URL_STAGING` | secret | The direct, non-pooled connection string for the staging branch |
| `NEON_DIRECT_URL_PRODUCTION` | secret | The direct, non-pooled connection string for the production branch |

The per-PR Neon branch `pr-<number>` is forked from the Neon branch named `staging` (`parent_branch: staging` in `neon-pr.yml`), never from the project's default branch, which may hold production data. The Neon branch `staging` must exist and must be staging's data.

Then, with Cloudflare access:

- Create the Hyperdrive configs: `wrangler hyperdrive create uw-staging --connection-string=...` and `wrangler hyperdrive create uw-production --connection-string=...`, using the pooled connection strings.
- Create the four queues: `wrangler queues create uw-ingest-events-staging`, `uw-ingest-events-staging-dlq`, `uw-ingest-events-production` and `uw-ingest-events-production-dlq`.
- Replace every `set-at-go-live` with the real Hyperdrive id, Access AUD tag and Access team domain.
- Once every resource exists, copy each `wrangler.go-live.toml` over its `wrangler.toml` in one reviewed PR.

Until that PR, the per-PR and staging Workers run with no database and no queue, `/health/probe` says so, and every go-live job logs a notice and stays green. After it, per-PR Workers bind to staging's Hyperdrive (P33).
