# infra

Everything Cloudflare, AWS and Access that the platform runs on is declared here. A setting that exists only in a dashboard is a defect.

## uw-platform

`uw-platform/wrangler.toml` declares two environments, `staging` and `production`. Every command names its environment; the top-level block is never deployed.

| Environment | Worker name | Reachable at | Deployed by |
|---|---|---|---|
| staging | `uw-platform-staging` | `https://uw-platform-staging.<account subdomain>.workers.dev` | every push to `develop`, after CI |
| production | `uw-platform` | `https://uw-platform.unfoldingword.workers.dev` (`workers_dev = true`, behind Access) | a `v*` tag on `main`, by dispatch (`gh workflow run deploy-production.yml --ref v<version>`) |

### Deploy staging by hand

```
pnpm --filter @uw/uw-platform deploy:staging
```

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` come from the shell or from the CI secret store. They are never written to a wrangler file. The token is scoped to Workers Scripts edit on the one account, and to Secrets Store edit once a Worker binds a secret from the store (the Platform secrets section).

The deployed commit reaches the Worker as the `COMMIT_SHA` var, set on the deploy command line. The value in the file is the placeholder `unknown`, which `/health/probe` reports when nothing was passed.

### Where each later binding goes

A binding is added by a diff to `uw-platform/wrangler.toml`, once in `[env.staging]` and once in `[env.production]`, so the two cannot drift. Each block sits directly under the environment's `[env.<name>.vars]` table.

| Binding | Table to add | Issue |
|---|---|---|
| Hyperdrive | `[[env.<name>.hyperdrive]]` with `binding`, `id` | #7 |
| Queue consumer | `[[env.<name>.queues.consumers]]` with `queue` | #10 |
| Queue producer | `[[env.<name>.queues.producers]]` with `binding`, `queue` | #10 |
| Durable Objects | `[[env.<name>.durable_objects.bindings]]` with `name`, `class_name`, plus `[[env.<name>.migrations]]` | live hub |
| Cloudflare Workflows | `[[env.<name>.workflows]]` with `name`, `binding`, `class_name` | runs |
| Browser Run | `[env.<name>.browser]` with `binding`, in `preview` too, because environments do not inherit it | #198 |
| Containers | `[[env.<name>.containers]]` with `class_name`, `image`, `max_instances`, plus a Durable Object binding per class and a migration | sandbox engines |
| Crons | `[env.<name>.triggers]` with `crons` | later |

Ids that are not secret (a Hyperdrive id, the Secrets Store id) may be committed. A secret's value appears in no file. It lives in Cloudflare Secrets Store and is bound to the one Worker that reads it (the Platform secrets section); until an environment is moved there, it is a Worker secret set with `wrangler secret put --env <name>`.

### Where the Worker runs (#142)

Each environment sets `[env.<name>.placement] region = "aws:us-west-2"`. Without it, the Worker runs at the Cloudflare location nearest the viewer, and every database query crosses to Aurora in us-west-2 and back. With it, Cloudflare runs the Worker in the data center closest to that region, so the queries a page makes stay short. `region` and `mode = "smart"` cannot both be set. If the database moves region, this value moves with it.

Hyperdrive's query cache is off (`caching.disabled: true`). It keeps a read for up to a minute and is not cleared by writes, so after someone claims an item or decides a gate a page could show the old state. Pages read outside transactions, where the cache would apply. Connection pooling stays on. Staging was switched on 2026-11-19 with `env -u CLOUDFLARE_API_TOKEN npx wrangler hyperdrive update 621c03bdb5ef4087a2a64f1e411779c8 --caching-disabled`; production (`2564258906e94905b1b28d0c28002ff6`) is switched the same way at the release that ships #142.

Every response carries a `Server-Timing` header: `total`, `frame` (the sidebar and status bar) and `db` (queries and transactions). The `request` log line records `queries` and `transactions` too. `apps/uw-platform/views/query-budget.pg.test.ts` keeps each page under a query budget and fails if a page's query count grows with the number of workflows or items.

### Sandbox containers (HE-8, HE-9)

`containers/claude-code/Dockerfile` and `containers/codex/Dockerfile` are the images the two sandbox engines run: the Node.js 22 slim image at a pinned tag with `git`, the one CLI installed globally at a pinned version, a non-root `runner` user whose home is `/workspace`, and a small HTTP listener on port 3000 that keeps the container alive for `exec`. Cloudflare's `cloudflare/sandbox:1.0.0` base was dropped on 2026-11-12: it has no `/bin/sh`, so neither image could be built. The CI `build` job builds both images and runs `git --version` and the CLI's `--version` in each, so a broken image fails a pull request, not a deploy. Neither image holds a key, a token or a login: the CLI gets a placeholder key and a base URL of `http://model.internal`, and the Worker's egress proxy swaps in the organization's key on the way to AI Gateway (S7-R48). `tools/infra/containers.test.ts` refuses an `ENV` or `ARG` named like a credential, an unpinned base and an image that ends as root.

The classes `ClaudeCodeSandbox` and `CodexSandbox` (`apps/uw-platform/engines/sandbox/classes.ts`) start with the internet off and send every outbound HTTP request through one handler, which answers `403 egress refused` for anything but the model host and `mcp.internal` (S7-R47). `wrangler.go-live.toml` declares them for staging and production only: two `[[env.<name>.containers]]` blocks, the `CLAUDE_CODE_SANDBOX` and `CODEX_SANDBOX` Durable Object bindings, and the top-level `v2` migration that adds both as SQLite classes. A deploy with these blocks needs Docker on the runner to build the images.

### Durable Object storage labels (v0.6.2)

Cloudflare names a Durable Object namespace after the Worker when it creates it, and cannot rename it. After the rename to uw-platform, staging and production each got their own migration history in `wrangler.toml`: `v4` deletes the four classes and `v5` creates them again. Cloudflare refuses both in one deploy, so the change ships in two:

1. `gh workflow run relabel-storage.yml --ref <ref> -f environment=<staging|production>`: production from its `v*` tag on main, staging from `develop`, behind the same deployer and green-CI checks as a production deploy. It rewrites its own checkout's `wrangler.toml` with `tools/infra/relabel.ts` so the environment stops at `v4` with no Durable Object bindings or containers, deploys that, then deletes the container applications whose namespace is gone.
2. The normal deploy of the same commit applies `v5`, which creates the classes and the container applications again.

Between the two, the live hub, page drafts and sandboxes do not work, and their data is gone. Previews keep the top-level history (`v1` to `v3`), because a new Worker cannot delete a class it never had. Staging was relabelled on 2026-11-24.

## Access (FD-7)

`access/uw-platform.json` declares Cloudflare Access in front of `uw-platform` on production, staging and every per-PR Worker, as three applications. The app application covers the host: people sign in with Google and nothing else (no one-time PIN, since #154), and no service token is admitted. The `mcp` application covers `/mcp` alone with its own AUD tag: people sign their agents in with Google (through `cloudflared access`), and any valid service token passes as a non-identity request and becomes a non-interactive agent principal. Because the two applications have different audiences, a token an agent holds for `/mcp` is refused on every other path, and a browser session is refused on `/mcp` (R34). `/health/probe` alone is bypassed, on every host, so the deploy jobs (`deploy-staging.yml` and `deploy-pr.yml`, through `await-health.sh`) can read the deployed commit; `/health` itself shows the agent plane and needs a signed-in person. The app application sends its session cookie `SameSite=Lax`, so a form posted from another site carries no session. Applying either change on Cloudflare is a person's (Waiting on a person).

The allow policy admits anyone with a Google account on purpose. A person outside `@unfoldingword.org` must reach the app to be recorded as pending (FD-7); an org admin then approves or declines them on the Access screen (`/access`). Authorization is the grants table, not Access, and Google Groups are not read. Because sign-in is Google, Workspace's multi-factor rules and offboarding apply to `@unfoldingword.org` accounts: suspending someone in Google stops their sign-in.

### Google as the identity provider (#154)

- **The OAuth client** lives in the Google Cloud project `uw-platform` (organization `unfoldingword.org`), under Google Auth Platform: app name "unfoldingWord Platform", audience External and published ("In production"), so any Google account can sign in; home page `https://unfoldingword.org/`, privacy policy `https://unfoldingword.org/privacy/`, authorized domains `cloudflareaccess.com` and `unfoldingword.org`. The client is "Cloudflare Access", a Web application, with JavaScript origin `https://unfoldingword.cloudflareaccess.com` and redirect URI `https://unfoldingword.cloudflareaccess.com/cdn-cgi/access/callback`. It asks only for `openid`, `email` and `profile`, which need no Google verification. Creating or changing it takes a Workspace account with rights on that project.
- **The identity provider** is added to Cloudflare Access as type `google` with that client's id and secret (`POST /accounts/{account_id}/access/identity_providers`). The client secret is held only by Cloudflare; it is not in this repository, in a Worker secret or in GitHub. The provider was added on 2026-11-19 with id `1cc60ad0-7558-4780-93b4-7e012b3179f6`; an id is configuration, not a secret.
- **The policy** is unchanged in shape: one allow rule for everyone, now reached only through Google, because `allowed_idps` on the app and `mcp` applications names the Google provider alone. With one provider and `auto_redirect_to_identity`, a visitor goes straight to Google.

The file holds the bodies of two Cloudflare API calls, applied by a person with an API token holding Access: Apps and Policies Edit:

- `POST /accounts/{account_id}/access/apps`, then `POST /accounts/{account_id}/access/apps/{app_id}/policies`, for `application` with `policies`.
- The same two calls for `health_bypass.application` with `health_bypass.policies`.
- The same two calls for `mcp.application` with `mcp.policies`.

Replace `<google-idp-id>` with the Google identity provider's id from `GET /accounts/{account_id}/access/identity_providers`. To apply a change to an application that already exists, send the same body with `PUT /accounts/{account_id}/access/apps/{app_id}`. After creation, the app application's AUD tag, the `mcp` application's AUD tag and the team domain go into `ACCESS_AUD`, `ACCESS_MCP_AUD` and `ACCESS_TEAM_DOMAIN` in `infra/uw-platform/wrangler.go-live.toml` (Task 16 of the step-1 plan). An AUD tag is configuration, not a secret. The three applications cover production, staging and every per-PR Worker; they were applied on 2026-11-10 to the team `unfoldingword.cloudflareaccess.com`.

A fourth application, `migrations`, covers the database hostname `uw-db-production.unfoldingword.us` and admits only the service token `uw-platform GitHub migrations` (replace `<github-migrations-service-token-id>` with its id). Its client id and secret are the `DATABASE_TUNNEL_CLIENT_ID` and `DATABASE_TUNNEL_CLIENT_SECRET` secrets. The tunnel's public TCP hostname, `uw-db-production.unfoldingword.us` to the Aurora endpoint on port 5432, is added on the tunnel itself.

The production Hyperdrive config `uw-platform-production` reaches Aurora through the Workers VPC service `uw-platform-db`. That service's certificate verification is `disabled`: a Workers VPC service verifies only against public certificate authorities and ignores a Hyperdrive custom CA, and the Amazon RDS certificate authority is not public. The connection is still TLS, inside the tunnel. The Amazon RDS us-west-2 CA is uploaded (`aws-rds-us-west-2`) for when either side supports it.

## uw-ingest

`uw-ingest/wrangler.toml` declares two environments, `staging` and `production`, like `uw-platform`. uw-ingest is a separate Worker and is not behind Access: each webhook source authenticates by its signature over the raw body.

| Environment | Worker name | Reachable at | Deployed by |
|---|---|---|---|
| staging | `uw-ingest-staging` | `https://uw-ingest-staging.<account subdomain>.workers.dev` | `deploy-ingest-staging` after green CI on a push to `develop` |
| production | `uw-ingest` | `uw-ingest.unfoldingword.workers.dev` | `deploy-ingest-production` with the same dispatch, after the production gate |

`GITHUB_WEBHOOK_SECRET` is a Worker secret, set with `wrangler secret put GITHUB_WEBHOOK_SECRET --env <name>`, until the environment is moved to the Secrets Store (the Platform secrets section). It appears in no file.

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
4. Set the secrets. For `uw-platform` (from `infra/uw-platform`):

   ```
   wrangler secret put GITHUB_APP_ID --env <name>
   wrangler secret put GITHUB_APP_INSTALLATION_ID --env <name>
   wrangler secret put GITHUB_APP_PRIVATE_KEY --env <name>
   ```

   For `uw-ingest` (from `infra/uw-ingest`):

   ```
   wrangler secret put GITHUB_WEBHOOK_SECRET --env <name>
   ```

None of the four appears in any file. Until they are set, `uw-platform` treats GitHub as not configured and nothing that runs needs them.

The production App, `uw-harness`, is a second registration from `github/app-manifest.production.json`, the same manifest with production's ingest URL. Production uw-ingest serves `uw-ingest.unfoldingword.workers.dev` for it.

The webhook host assumes the account's `workers.dev` subdomain is `unfoldingword`; confirm it before registering, and correct the manifest if it differs.

### Tokens and the subrequest budget

`uw-platform` signs a JWT with the App key and mints one installation token per unit of work: one queue delivery, one sweep run over one repository, or one connector run. Each token is scoped when it is minted, to the one repository the unit concerns and to the permissions of its client: the read client asks for `contents`, `pull_requests`, `issues`, `checks` and `metadata` read; the comment writer for `issues` write and `metadata` read; the merge and tag writes for `contents` write with `pull_requests` and `metadata` read. A read client's token never carries a write permission, and a client refuses a request for a second repository. Listing the installation's repositories uses a separate token with `metadata` read and no repository. The token lives only inside the client object for that unit, so it never reaches a caller, a log line, a model process or an MCP response. GitHub answers each token with its expiry (an hour); the client mints again when its token is within five minutes of expiry, and never keeps a failed mint, so the next request retries.

Each unit therefore spends one subrequest on the token plus one per GitHub request. The client bounds every list it reads: a pull request's files in one comparison of its base and head SHAs (GitHub lists at most 300 files there, and 300 or more counts as too many), the issues of a sweep at the caller's page limit, and any other list at 10 pages. A delivery that refreshes one pull request's facts makes at most 23 subrequests (token, pull request, the comparison, 10 pages of reviews, 10 of check runs) and usually 5. Every unit must stay under the Workers per-invocation subrequest limit of the account's plan.

The nightly sweep (`apps/uw-platform/github/sweep.ts`, cron `17 3 * * *`) is one invocation over every repository. It spends one subrequest on the installation token that lists the repositories and one on each repository's own token, so it mints once per repository per run. It starts the repository it attempted least recently first, so a busy repository cannot starve the others. Per repository it reads 100 issues per request, each request starting from the greatest `updated_at` seen so far (keyset, so an item updated mid-listing or tied at a boundary is never skipped), then, for each pull request in that listing or still open in the read model, the pull request, its reviews, the check runs on its head and, when the files at that head and base are not stored, one comparison: 4 subrequests in the usual case and up to 23 with long review or check lists. The sweep counts every subrequest it sends and never sends more than its bound (`maxSubrequests`, 900 by default). It starts a pull request only while 8 remain, starts a repository only while its token, one listing page and one pull request fit, and shrinks the listing's page limit to what remains. A pull request it does not reach, or cannot read, waits for the next night: the watermark moves only to the greatest `updated_at` it listed and stored, never past the first listed pull request it did not store, and never back. Every run records its outcome (`ok`, `capped`, `stalled`, `deferred` or `failed`), the hold point and the reason in `gh_repos.last_sweep`. The bound must stay under the plan's per-invocation limit, which a person confirms before the cron trigger is switched on.

## Reviewer Apps (HE-4, HE-9)

Each Reviewer identity is its own GitHub App, so a review it posts is attributed to that identity and nothing else can post as it: `github/reviewer-app-manifest.json` declares `uw-reviewer` (the message engines' Reviewer) and `github/reviewer-codex-app-manifest.json` declares `uw-reviewer-codex` (the Codex engine's). Both are private, ask for `pull_requests` write and `metadata` read and nothing else, and subscribe to no event: the harness reads their reviews back through the harness App's `pull_request_review` webhook, which counts a review toward Ship only when its login (`uw-reviewer[bot]`, `uw-reviewer-codex[bot]`, `packages/harness/github/reviewers.ts`) is a Reviewer identity.

Only the run host's kernel (`apps/uw-platform/runs/`) holds these Apps. It mints one token per review, scoped to the one repository and to `pull_requests` write and `metadata` read, and posts `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` with the head commit as `commit_id`. The MCP, queue, cron and command kernels never receive them.

An org owner of `unfoldingWord` registers each App once, awaiting go-live:

1. Register the App from its manifest with the same "Register a GitHub App from a manifest" flow as the harness App (above), adding a `redirect_url`. The App name must stay `uw-reviewer` or `uw-reviewer-codex`, since its slug is its Reviewer login; confirm GitHub kept the slug.
2. Install it on `unfoldingWord/uw-platform` only, and note the installation id.
3. Convert the key to PKCS#8 as above, then set the secrets for `uw-platform` (from `infra/uw-platform`):

   ```
   wrangler secret put REVIEWER_GITHUB_APP_ID --env <name>
   wrangler secret put REVIEWER_GITHUB_APP_INSTALLATION_ID --env <name>
   wrangler secret put REVIEWER_GITHUB_APP_PRIVATE_KEY --env <name>
   wrangler secret put REVIEWER_CODEX_GITHUB_APP_ID --env <name>
   wrangler secret put REVIEWER_CODEX_GITHUB_APP_INSTALLATION_ID --env <name>
   wrangler secret put REVIEWER_CODEX_GITHUB_APP_PRIVATE_KEY --env <name>
   ```

Until a Reviewer's three secrets are set, its review answers `not_wired` and the run completes `review_withheld`.

## The Builder GitHub App (PE-5)

The hosted Builder pushes its work and opens its pull request as its own GitHub App, `uw-builder` (`github/builder-app-manifest.json`): private, `contents` write, `pull_requests` write, `metadata` read, no webhook and no event. It has no `workflows` permission, so GitHub refuses a push that touches `.github/workflows/`. Its login is `uw-builder[bot]` (`packages/harness/github/builder.ts`), which never counts as a Reviewer.

The sandbox never holds its token. The container reaches GitHub only over plain HTTP to `http://github.internal` and `http://api.github.internal`; the egress proxy in the run host (`apps/uw-platform/engines/sandbox/github-egress.ts`) allows a clone and fetch of the harness's one repository, a push whose one ref update targets `refs/heads/harness/<item>` and deletes nothing, and a pull request from that branch into the default branch whose body opens with the `harness` declaration. It then mints one installation token per work step, scoped to that repository (`apps/uw-platform/github/builder-app.ts`), and sets it on the forwarded request. Everything else is `403 egress refused`.

An org owner of `unfoldingWord` registers the App once, awaiting go-live:

1. Register the App from its manifest with the same "Register a GitHub App from a manifest" flow as the harness App (above), adding a `redirect_url`. Keep the name `uw-builder` and confirm GitHub kept the slug, since the slug is the Builder login.
2. Install it on `unfoldingWord/uw-platform` only, and note the installation id.
3. Convert the key to PKCS#8 as above, then set the secrets for `uw-platform` (from `infra/uw-platform`):

   ```
   wrangler secret put BUILDER_GITHUB_APP_ID --env <name>
   wrangler secret put BUILDER_GITHUB_APP_INSTALLATION_ID --env <name>
   wrangler secret put BUILDER_GITHUB_APP_PRIVATE_KEY --env <name>
   ```

Until the three secrets are set, every GitHub request from the sandbox answers `503 egress not configured` and is logged `github_egress_not_wired` with its host and path.

## Hosted agents (#98)

A hosted agent needs three things the code reads but no file holds: an AI Gateway, the organization's API keys, and the GitHub Apps. Until they are set, the engines answer `not_wired` and nothing is spent. Billing stays as ADR 0006 says (confirmed 2026-11-17).

### Settings

| Setting | Kind | Worker | Value or source |
|---|---|---|---|
| `AI_GATEWAY_ACCOUNT_ID` | var | uw-platform | The account id, in the wrangler files |
| `AI_GATEWAY_ID` | var | uw-platform | `uw-platform-staging` or `uw-platform-production`, in the wrangler files |
| `AI_SPEND_CAP_MINOR` | var | uw-platform | `50000`, $500 a month, in the wrangler files |
| `ALWAYS_ON_PROVIDER`, `ALWAYS_ON_MODEL` | var | uw-platform | `z-ai` and `z-ai/glm-5.3-flash`, in the wrangler files |
| `SANDBOX_MINOR_PER_HOUR` | var | uw-platform | `3`, in the wrangler files (below) |
| `AI_GATEWAY_TOKEN` | secret | uw-platform | The gateway's authentication token |
| `AI_GATEWAY_ANALYTICS_TOKEN` | secret | uw-platform | An API token with Account Analytics: Read on the account, for the spend breaker |
| `OPENROUTER_API_KEY` | secret | uw-platform | The organization's key; the always-on tier |
| `ANTHROPIC_API_KEY` | secret | uw-platform | The organization's key; the Claude Code sandbox and `claude-messages` |
| `OPENAI_API_KEY` | secret | uw-platform | The organization's key; the Codex sandbox and the second reviewer |
| `GITHUB_APP_*`, `BUILDER_GITHUB_APP_*`, `REVIEWER_GITHUB_APP_*`, `REVIEWER_CODEX_GITHUB_APP_*` | secret | uw-platform | Set by `pnpm github-apps:convert` |
| `GITHUB_WEBHOOK_SECRET` | secret | uw-ingest | Set by `pnpm github-apps:convert` |

Each secret is set from `infra/uw-platform` (or `infra/uw-ingest`) with `wrangler secret put <NAME> --env staging`, then `--env production`, typed at the prompt and never written to a file or a chat. `tools/infra/agent-settings.test.ts` holds the vars to these values and refuses a var named like a credential.

**The sandbox rate.** Both sandboxes run on the `basic` instance type (1/4 vCPU, 1 GiB memory, 4 GB disk); `lite`'s 256 MiB is too small to run a Node CLI and a clone. At Cloudflare's Containers prices (developers.cloudflare.com/containers/pricing, read 2026-11-17: $0.0000025 per GiB-second of memory, $0.000020 per vCPU-second of active CPU, $0.00000007 per GB-second of disk), a fully busy `basic` instance costs about $0.028 an hour, so the rate is 3 cents an hour, rounded up.

### Setting it up

1. **AI Gateway.** In the Cloudflare dashboard (AI, AI Gateway, Create a custom gateway), create two gateways, `uw-platform-staging` and `uw-platform-production`. On each gateway's Settings, under Authenticated Gateway, choose Create authentication token: that token is the environment's `AI_GATEWAY_TOKEN`. For `AI_GATEWAY_ANALYTICS_TOKEN`, create a custom API token per environment with only Account Analytics: Read, on this account only. Under Spend Limits, give each gateway a $600 monthly budget on a fixed window for the whole gateway. It sits above the app's $500 cap, which counts the calendar month in UTC, so the app's breaker stops work cleanly first and the gateway refuses requests only if the breaker fails.
2. **API keys.** Set `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` on each environment, a separate key per environment from the organization's account with each provider.
3. **GitHub Apps, in one sitting with an org owner.** Run `pnpm github-apps:page <file.html>` and send the page to the owner. For each of the five Apps (`uw-harness-staging`, `uw-harness`, `uw-builder`, `uw-reviewer`, `uw-reviewer-codex`) they click Register, keep the name, install the App on `unfoldingWord/uw-platform` only, and send back the address GitHub lands on, which carries a one-time `code` valid for an hour. For each address, run `pnpm github-apps:convert '<address>'`. It exchanges the code, converts the key to PKCS#8 in memory, finds the installation, and sets the App's secrets on the environments it serves (the harness Apps on one each, with the webhook secret on uw-ingest; Builder and the Reviewers on both). It prints only the names it set. If the App was not installed yet, it says which installation id to set by hand.
4. **Turn on hosted Builder** for the Software workflow on staging only (Stages & Controls). Production stays off.
5. **Check on staging.** Add a Builder agent on the Agents tab, put it live, grant it `build`, and put an item in a build stage. The run should open a pull request from `harness/<item>`, its run step should show the model, tokens and cost, the request should appear in the gateway's log, and the spend indicator on Health should move. Then repeat steps 1 to 3 for production and compare `wrangler secret list --env production` with staging.

## The credentials store's key service (#157, #186)

The credentials store wraps each data key with an AWS KMS key. The keys and the IAM users were made by hand in the AWS console on 2026-11-20, in account `002723143144`, region `us-west-2`, where Aurora runs. Nothing reads these settings until #158 constructs the KMS adapter.

| | Staging | Production |
|---|---|---|
| Key alias | `alias/uw-platform-credentials-staging` | `alias/uw-platform-credentials-production` |
| IAM user | `uw-platform-credentials-staging` | `uw-platform-credentials-production` |

Each key is symmetric and single-region, with one key administrator who may not delete it. Each IAM user has no console access and one inline policy, `credentials-data-keys`, allowing only `kms:GenerateDataKey` and `kms:Decrypt` on its own key. The account's `management-events` CloudTrail trail logs every KMS call. Losing a key loses every credential stored under it.

| Setting | Kind | Worker | Value or source |
|---|---|---|---|
| `CREDENTIALS_KMS_REGION` | var | uw-platform | `us-west-2`, in the wrangler files |
| `CREDENTIALS_KMS_KEY_ID` | var | uw-platform | The environment's key ARN, in the wrangler files. An ARN, not the alias, so the key cannot be repointed |
| `CREDENTIALS_KMS_ACCESS_KEY_ID` | secret | uw-platform | The access key of that environment's IAM user |
| `CREDENTIALS_KMS_SECRET_ACCESS_KEY` | secret | uw-platform | Its secret, shown once when the access key is created |

`tools/infra/credentials-kms.test.ts` holds the two vars to these values, keeps the two environments on different keys, and gives a preview Worker neither.

**Setting or rotating the access key.** An IAM user may hold two access keys, so the old one works until the new one is in place.

1. In the AWS console open IAM, Users, the environment's user, Security credentials, and create an access key for an application running outside AWS.
2. From `infra/uw-platform`, with `CLOUDFLARE_ACCOUNT_ID` set to the organization's account if your login reaches more than one, run `wrangler secret put CREDENTIALS_KMS_ACCESS_KEY_ID --env <name>` and `wrangler secret put CREDENTIALS_KMS_SECRET_ACCESS_KEY --env <name>`, each typed at the prompt.
3. When the store has opened a credential with the new pair, delete the old access key in AWS.

## Routines (#134)

A routine is a person's own Claude Code or Codex working a workflow unattended, under one of their own standing permissions. An area admin sets one up on the workflow's Agents tab. The app then makes a Cloudflare Access service token for it, shows the secret once, and binds the token to that person, a device name and that one standing permission. Revoke deletes the token in Cloudflare as well. The MCP Access application already admits any valid service token (the Access section), so it needs no change.

| Setting | Kind | Worker | Value or source |
|---|---|---|---|
| `ACCESS_ACCOUNT_ID` | var | uw-platform | The account id, in the wrangler files |
| `ACCESS_SERVICE_TOKENS_API_TOKEN` | secret | uw-platform | An API token with only Access: Service Tokens Edit on this account |

Someone with Zero Trust rights on the account creates the API token (My Profile, API Tokens, Create Custom Token, Account, Access: Service Tokens, Edit, this account only). It is then set from `infra/uw-platform` with `wrangler secret put ACCESS_SERVICE_TOKENS_API_TOKEN --env staging`, then `--env production`, typed at the prompt. Until it is set, the Agents tab says routines are not switched on and nothing else changes.

## The notifier: web push and Zulip (NT-1, NT-3)

The notifier reads its configuration from `uw-platform`'s variables and secrets. With any piece missing or malformed, that channel answers `not_configured` and logs; nothing fails at startup.

Variables, in `infra/uw-platform/wrangler.go-live.toml` under staging and production only (`set-at-go-live` until then):

| Variable | Value |
|---|---|
| `APP_ORIGIN` | The app's `https://` origin with no path; a Zulip post's link starts with it |
| `VAPID_PUBLIC_KEY` | The VAPID public key, base64url, 87 characters |
| `VAPID_SUBJECT` | `mailto:` an address that answers, or an `https://` page |
| `ZULIP_SITE` | The Zulip realm's `https://` origin |
| `ZULIP_BOT_EMAIL` | The bot's email address |
| `ZULIP_CHANNELS` | A JSON object from area to channel name, for example `{"80-89":"80-89 Tech & SLR"}`; an area with no channel drops its Zulip wakes. Each channel must be private, with members exactly the people who can read that area (see below) |

Secrets, set with `wrangler secret put <name> --env <name>` and written in no file:

```bash
# uw-platform (from infra/uw-platform)
wrangler secret put VAPID_PRIVATE_JWK --env <name>   # the VAPID private key as JWK JSON (kty EC, crv P-256, d, x, y)
wrangler secret put ZULIP_BOT_API_KEY --env <name>
# uw-ingest (from infra/uw-ingest)
wrangler secret put ZULIP_WEBHOOK_TOKEN --env <name>
```

The Zulip bot is an outgoing-webhook bot. Its endpoint URL is `https://<uw-ingest host>/webhooks/zulip`, its payload format is Zulip's own, and its token is `ZULIP_WEBHOOK_TOKEN`. `uw-ingest` answers an accepted delivery with no `content` and `"response_not_required": true`, so the bot posts nothing back.

A post reaches everyone in its channel, and the platform does not check who that is. Every channel in `ZULIP_CHANNELS` must therefore be a private channel (never public or web-public) whose members are exactly the people who can read that area: anyone with a live grant on the area or a live org grant, and no one else (ADR 0015: a grant on another area reads nothing here). Whoever configures the realm keeps membership in step with grants: a person granted read on an area joins its channel, and a person whose grant is revoked or expires leaves it. Otherwise a person who cannot read the area sees its harness key, its repository names and issue numbers, and that a gate, a lapse or a failed run is waiting. The post carries only the harness key, the item ref, one fixed sentence and the link, never an item's title or body.

## Personal assistants on Zulip: one bot per person (PA-6)

Each person's assistant is its own Zulip bot user, with its own name and API key (ADR 0037). The platform creates the bot when the person turns their assistant on, deactivates it when they turn it off, and reactivates it when they turn it back on within 30 days. It signs in to Zulip as one org-admin service account to do that. Each bot is an outgoing-webhook bot pointed at `uw-ingest`, so a direct message to it arrives as a delivery; the platform replies through the Zulip REST API as that bot.

Variables, in `infra/uw-platform/wrangler.go-live.toml` (and `wrangler.toml`) under staging and production (`set-at-go-live` until then):

| Variable | Value |
|---|---|
| `ZULIP_ADMIN_EMAIL` | The email of the org-admin service account that creates the assistant bots |
| `ASSISTANT_WEBHOOK_BASE` | The `uw-ingest` Worker's `https://` origin with no path; every assistant bot posts to `<origin>/webhooks/zulip-assistant` |

`ZULIP_SITE` is the notifier's. Secret, set in the store as the table below names it:

```bash
# uw-platform (from infra/uw-platform)
wrangler secret put ZULIP_ADMIN_API_KEY --env <name>   # the service admin account's API key
```

One-time steps in Zulip, by a realm owner:

1. Create a dedicated service account (not a person's account), make it an organization administrator, and copy its API key into `ZULIP_ADMIN_API_KEY`. Bots it creates are owned by it; deactivating that account may deactivate every assistant bot, so it is never a person's own account.
2. Let administrators create bots (Organization settings, Who can create bots).
3. Run the staging probes in the assistants' staging-probes list before go-live: creating a bot (`POST /api/v1/bots`, `bot_type=3`), reading its webhook token (`GET /api/v1/bots`), looking a person up by email (`GET /api/v1/users/{email}`), deactivating and reactivating (`DELETE /api/v1/users/{id}`, `POST /api/v1/users/{id}/reactivate`), and a direct message (`POST /api/v1/messages`, `type=direct`).

`uw-ingest` verifies each assistant delivery by the SHA-256 digest of that bot's own webhook token, looked up by the bot's email in `assistant_zulip_bots`; the stream bot keeps `ZULIP_WEBHOOK_TOKEN` and `/webhooks/zulip`. A bot's API key is sealed with the credentials KMS key (`CREDENTIALS_KMS_*`) under its own encryption context, so the per-bot keys never enter the Secrets Store. Until `ZULIP_ADMIN_API_KEY`, `ZULIP_ADMIN_EMAIL` and `ASSISTANT_WEBHOOK_BASE` are set, no bot can be created; until `ZULIP_SITE` is set, an assistant reply is recorded `not_wired`.

### The hosted turn and the assistants pool (PA-16, PA-17)

Each recorded request starts one `AssistantTurn` Cloudflare Workflow, named by the request id: `assistant-turn-staging` and `assistant-turn-production`, both bound as `ASSISTANT_TURN` to the class `AssistantTurn` (`apps/uw-platform/assistants/turn/workflow.ts`), declared under `staging` and `production` only, in `wrangler.toml` and `wrangler.go-live.toml`, like `HARNESS_RUN` (ADR 0038). Preview declares no Workflow, so a direct message there is recorded and its turn is not started. The turn calls the model through the platform's OpenRouter engine (`OPENROUTER_API_KEY` and the AI Gateway settings of the hosted agents section) and asks OpenRouter for zero-data-retention endpoints only; the account's own ZDR lock stays on as well.

Assistants spend their own pool, outside `AI_SPEND_CAP_MINOR`: USD 20 a month for each assistant with a live `assist` delegation, unless an org admin sets one person's budget with the `set_assistant_budget` command (`POST /api/acl/commands/set_assistant_budget`, `monthlyMinor` in cents, `null` for the default). An optional hard ceiling on the whole pool, in cents, is the variable `ASSISTANT_SPEND_CAP_MINOR`; it is unset by default, and the pool is then just the sum of the budgets. The platform's spend breaker leaves assistant spend out of its reading. The minute cron starts the turn of a request whose start was lost (two minutes after it was recorded, for a day) and closes a turn left open an hour after it started, so a crashed turn's reservation is released.

Staging checks, before go-live (the staging-probes list has the exact requests): one OpenRouter call for `z-ai/glm-5.3-flash` pinned to `z-ai` with `provider.zdr = true` answers with a ZDR endpoint, and a direct message to a provisioned bot on staging gets one reply from that bot.

### Google Workspace: calendar now, mail and directory next (PA-8, PA-9)

The platform reaches Google with one service account that has domain-wide delegation (ADR 0039). It acts as a person for that person's calendar, as an assistant mailbox for Gmail, and as one admin account for the directory, and the code refuses, before it signs, any other subject or scope.

Variables, in `infra/uw-platform/wrangler.go-live.toml` (and `wrangler.toml`) under staging and production:

| Variable | Value |
|---|---|
| `GOOGLE_WORKSPACE_DOMAIN` | The Workspace domain, `unfoldingword.org`; only people whose address is in it can be acted as |
| `GOOGLE_WORKSPACE_ADMIN_SUBJECT` | The one Workspace admin account the platform acts as for the directory, to create, suspend, restore and delete assistant users; `set-at-go-live`. A dedicated admin account, never a person's own |
| `GOOGLE_ASSISTANT_OU` | The organizational unit path the assistant users are created in, `/Assistants` |

Secret, set in the store as the table below names it:

```bash
# uw-platform (from infra/uw-platform)
wrangler secret put GOOGLE_WORKSPACE_KEY --env <name>   # the service account's whole JSON key file
```

One-time steps, by a Google Cloud project owner and a Workspace super-admin:

1. In Google Cloud, create a project for the platform, enable the Google Calendar API, the Gmail API and the Admin SDK API, create a service account, and create one JSON key for it. Put the whole JSON file into `GOOGLE_WORKSPACE_KEY`; nothing else keeps a copy.
2. In the Workspace admin console (Security, Access and data control, API controls, Domain-wide delegation), a super-admin adds the service account's client id with exactly these scopes: `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/calendar.freebusy`, `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/admin.directory.user`.
3. Turn on a Workspace audit alert for token grants to the service account's client id for any subject that is not a person, an assistant mailbox or the admin subject.
4. Rotate the key at least every 90 days: create a new key, store it, then delete the old one in Google Cloud.
5. Run the Google staging probes in the assistants' staging-probes list before go-live, as one test person: a token for `calendar.events`, listing today's events, free/busy for two people, inserting a hold with a chosen id (and inserting it again, expecting a conflict), reading and deleting it.

Until `GOOGLE_WORKSPACE_KEY` and `GOOGLE_WORKSPACE_DOMAIN` are set, every calendar verb is refused `calendar_not_wired` and a drafted hold is recorded failed `not_wired`.

### Turning an assistant on and off (PA-14)

A person turns their own assistant on with `POST /api/assistant/commands/enable_assistant` (`{ "command": "enable_assistant", "requestId": "<uuid>", "name": "barnabas" }`), and off with `disable_assistant`; `grant_assist` (`expiresAt` or `null` for the default) lends it authority (ADR 0040). The name becomes `<name>@<GOOGLE_WORKSPACE_DOMAIN>` and the bot's name, and the assistant takes the lowest free number from 10.51 in area 10-19. The platform then makes, as `agent:assistant-provisioner`: the Workspace user in `GOOGLE_ASSISTANT_OU`, with a random password it keeps nowhere; the Zulip bot, paired with the person by email; and the active persona; then it waits for the person's `assist` grant. Turning off suspends the user and deactivates the bot at once. The minute cron re-drives unfinished steps (step `assistant-provisioning` in its log, five assistants a minute, backing off up to an hour after a failure), and the nightly cron (`cron assistant deletion`) deletes the Workspace user of an assistant turned off 30 days ago and frees its number; the bot stays deactivated.

Each environment needs, before anyone turns an assistant on: `GOOGLE_WORKSPACE_KEY`, `GOOGLE_WORKSPACE_DOMAIN`, `GOOGLE_WORKSPACE_ADMIN_SUBJECT` and `GOOGLE_ASSISTANT_OU` (this section), and `ZULIP_SITE`, `ZULIP_ADMIN_EMAIL`, `ZULIP_ADMIN_API_KEY`, `ASSISTANT_WEBHOOK_BASE` and the `CREDENTIALS_KMS_*` secrets (the Zulip section and the key service section). Until then every step is recorded failed with `workspace_not_wired` or `zulip_not_wired` (event `assistant_provisioning_failed`) and retried.

One-time steps in the Workspace admin console, by a super-admin:

1. Create the organizational unit named in `GOOGLE_ASSISTANT_OU` (`/Assistants`). Restrict it so its users receive mail only from inside the domain, and turn off services an assistant does not need (Drive sharing outside the domain, Meet, Chat).
2. Make `GOOGLE_WORKSPACE_ADMIN_SUBJECT` a dedicated admin account with the User management privileges (create, update, suspend and delete users) for that unit; the service account's `admin.directory.user` scope acts only as it.
3. Confirm there are enough Workspace licences: every assistant turned on or turned off within the last 30 days holds one; final deletion frees it.
4. Run the directory staging probes in the assistants' staging-probes list as the admin subject: `users.get` for a free address, a user and an alias; `users.insert` with an external id; a second insert (expecting a conflict); `users.update` with `suspended` true and false; `users.delete`.

When a person leaves, an org admin deactivates them; their live grants end, so the `assist` delegation lapses and their assistant takes no more turns. Its Workspace user and bot stay as they are, because turning an assistant off is the person's own command; suspend the user in the admin console and deactivate the bot in Zulip by hand until an admin path exists.

### My Assistant and retention (PA-7, PA-15)

A person does all of the above on the My Assistant screen at `/assistant` (sidebar, 10-19), which posts to the same endpoint; it also customises the assistant (`customise_assistant`), renews and revokes `assist` (`renew_assist`, `revoke_assist`), undoes a reminder or hold (`undo_assistant_effect`) and deletes the person's history (`delete_my_assistant_history`), and a pairing code is issued by `POST /assistant/pairing` (ADR 0041). An org admin opens `/assistant?person=<personId>` to see an assistant's accounts and spend and to change its monthly budget; the admin never sees what its person asked.

The nightly cron runs `cron assistant retention` after the deletion job: it empties request text, untrusted parts, replies, effect drafts and passed reminder and hold text recorded more than 365 days ago (owner decision 8), at most 10,000 requests a night, and records `assistant_history_redacted` on each assistant's harness. Its log line carries `outcome: history_redacted`, the count and `done: false` when a backlog remains for the next night. It needs no configuration beyond the database. Nothing restores redacted text; a backup taken before the run still holds it until the backup itself expires.

## Platform secrets in Cloudflare Secrets Store (#160)

The secrets the platform itself runs on live in the account's Cloudflare Secrets Store, and each Worker binds only the ones it reads. `uw-ingest` binds its two; `uw-platform` binds the rest; a per-PR Worker (`preview`) binds none. The list is `infra/secrets-store.json`, under 30-39 Infrastructure: each secret with what it is, who issues it, its owner and the date to rotate it by, per environment. `tools/infra/secrets-store.test.ts` keeps the list, the wrangler files and the code naming the same secrets, and fails when a binding named like a credential is added to a Worker without a row.

| Secret | Worker | Binding | Name in the store |
|---|---|---|---|
| `ACCESS_SERVICE_TOKENS_API_TOKEN` | uw-platform | `STORE_ACCESS_SERVICE_TOKENS_API_TOKEN` | `UW_<ENV>_ACCESS_SERVICE_TOKENS_API_TOKEN` |
| `AI_GATEWAY_ANALYTICS_TOKEN` | uw-platform | `STORE_AI_GATEWAY_ANALYTICS_TOKEN` | `UW_<ENV>_AI_GATEWAY_ANALYTICS_TOKEN` |
| `AI_GATEWAY_TOKEN` | uw-platform | `STORE_AI_GATEWAY_TOKEN` | `UW_<ENV>_AI_GATEWAY_TOKEN` |
| `ANTHROPIC_API_KEY` | uw-platform | `STORE_ANTHROPIC_API_KEY` | `UW_<ENV>_ANTHROPIC_API_KEY` |
| `BUILDER_GITHUB_APP_PRIVATE_KEY` | uw-platform | `STORE_BUILDER_GITHUB_APP_PRIVATE_KEY` | `UW_<ENV>_BUILDER_GITHUB_APP_PRIVATE_KEY` |
| `CREDENTIALS_KMS_ACCESS_KEY_ID` | uw-platform | `STORE_CREDENTIALS_KMS_ACCESS_KEY_ID` | `UW_<ENV>_CREDENTIALS_KMS_ACCESS_KEY_ID` |
| `CREDENTIALS_KMS_SECRET_ACCESS_KEY` | uw-platform | `STORE_CREDENTIALS_KMS_SECRET_ACCESS_KEY` | `UW_<ENV>_CREDENTIALS_KMS_SECRET_ACCESS_KEY` |
| `GITHUB_APP_PRIVATE_KEY` | uw-platform | `STORE_GITHUB_APP_PRIVATE_KEY` | `UW_<ENV>_GITHUB_APP_PRIVATE_KEY` |
| `GOOGLE_WORKSPACE_KEY` | uw-platform | `STORE_GOOGLE_WORKSPACE_KEY` | `UW_<ENV>_GOOGLE_WORKSPACE_KEY` |
| `OPENAI_API_KEY` | uw-platform | `STORE_OPENAI_API_KEY` | `UW_<ENV>_OPENAI_API_KEY` |
| `OPENROUTER_API_KEY` | uw-platform | `STORE_OPENROUTER_API_KEY` | `UW_<ENV>_OPENROUTER_API_KEY` |
| `REVIEWER_CODEX_GITHUB_APP_PRIVATE_KEY` | uw-platform | `STORE_REVIEWER_CODEX_GITHUB_APP_PRIVATE_KEY` | `UW_<ENV>_REVIEWER_CODEX_GITHUB_APP_PRIVATE_KEY` |
| `REVIEWER_GITHUB_APP_PRIVATE_KEY` | uw-platform | `STORE_REVIEWER_GITHUB_APP_PRIVATE_KEY` | `UW_<ENV>_REVIEWER_GITHUB_APP_PRIVATE_KEY` |
| `VAPID_PRIVATE_JWK` | uw-platform | `STORE_VAPID_PRIVATE_JWK` | `UW_<ENV>_VAPID_PRIVATE_JWK` |
| `ZULIP_ADMIN_API_KEY` | uw-platform | `STORE_ZULIP_ADMIN_API_KEY` | `UW_<ENV>_ZULIP_ADMIN_API_KEY` |
| `ZULIP_BOT_API_KEY` | uw-platform | `STORE_ZULIP_BOT_API_KEY` | `UW_<ENV>_ZULIP_BOT_API_KEY` |
| `GITHUB_WEBHOOK_SECRET` | uw-ingest | `STORE_GITHUB_WEBHOOK_SECRET` | `UW_<ENV>_GITHUB_WEBHOOK_SECRET` |
| `ZULIP_WEBHOOK_TOKEN` | uw-ingest | `STORE_ZULIP_WEBHOOK_TOKEN` | `UW_<ENV>_ZULIP_WEBHOOK_TOKEN` |

`<ENV>` is `STAGING` or `PRODUCTION`. An account has one store, and a name is unique in it, so the environment is part of the name: 34 secrets of the 100 an account may hold. The GitHub App ids and installation ids (`*_GITHUB_APP_ID`, `*_GITHUB_APP_INSTALLATION_ID`) are not secrets; they stay Worker settings and are not in the store.

### How a secret is read

A Secrets Store binding is not a string: the Worker reads it with `await env.<BINDING>.get()`. Both Workers do that in one place, `withSecrets` (`apps/uw-platform/secrets.ts`, `apps/uw-ingest/secrets.ts`, over `packages/core/platform-secrets.ts`), before any request, queue batch, cron or run is handled. For each secret it reads the `STORE_<NAME>` binding when one is declared; when none is declared it reads the Worker secret `<NAME>`, as before the move. The rest of the code sees a plain string under the old name. A Worker instance keeps what it read for five minutes, so a rotated value arrives without a deploy.

`/health/probe` on `uw-platform` and `/health` on `uw-ingest` carry a `secrets` indicator that counts the sources and never names a secret or shows a value, for example `14 from the Secrets Store, 0 from Worker secrets, 0 not set`. If a declared binding cannot be read, the indicator is red and adds `1 unreadable in the Secrets Store`, the Worker logs `secret_store_unreadable` with the secret's name, and that secret is read from its Worker secret while one still exists. So a broken binding is never hidden by the fallback.

The bindings are declared in each `wrangler.go-live.toml`, with `store_id = "set-at-go-live"`. A block is copied into `wrangler.toml` when its secret exists in the store; a test refuses a block in `wrangler.toml` that differs from the go-live file, has no store id, or whose secret has no owner and rotation date in `infra/secrets-store.json`.

### Before the first move

Whoever does this needs the Super Administrator or Secrets Store Admin role on the account, and runs `pnpm --filter @uw/uw-platform exec wrangler login` first. No value is ever typed into a file, a chat or a command line: `wrangler` asks for it at a hidden prompt, or reads it from a file on standard input.

1. **Find the store.** An account has one. List it, and create it only if the list is empty:

   ```
   pnpm --filter @uw/uw-platform exec wrangler secrets-store store list --remote
   pnpm --filter @uw/uw-platform exec wrangler secrets-store store create uw-platform --remote
   ```

2. **Declare the store id.** A store id is configuration, not a secret. Put it in place of every `store_id = "set-at-go-live"` in `infra/uw-platform/wrangler.go-live.toml` and `infra/uw-ingest/wrangler.go-live.toml`, in a pull request:

   ```
   sed -i 's/^store_id = "set-at-go-live"$/store_id = "<store id>"/' infra/uw-platform/wrangler.go-live.toml infra/uw-ingest/wrangler.go-live.toml
   pnpm exec vitest run tools/infra
   ```

3. **Let the deploy bind secrets.** Add Account, Secrets Store, Edit to the API token behind the repository secret `CLOUDFLARE_API_TOKEN`. Cloudflare requires it to deploy a Worker that binds a Secrets Store secret; without it the deploy fails with an authorization error. The token still cannot read a value: nothing can, once a secret is stored.

4. **The KMS key and its user (#157, #186).** These exist: see "The credentials store's key service" above. `infra/aws/credentials-kms.json` declares them, for each environment one symmetric KMS key in `us-west-2` and one IAM user whose only policy, the inline `credentials-data-keys`, allows `kms:Decrypt` and `kms:GenerateDataKey` on that key. The Worker holds a long-lived key pair, so this is an IAM user and not a role. Each key ARN is also `CREDENTIALS_KMS_KEY_ID` under that environment in both `infra/uw-platform/wrangler.toml` and `infra/uw-platform/wrangler.go-live.toml`; an ARN is configuration, not a secret. To check a user against the declaration, or to put the policy back:

   ```
   jq --arg arn "<key arn>" '.policy | .Statement[0].Resource = $arn' infra/aws/credentials-kms.json > "$TMPDIR/uw-kms-policy.json"
   aws iam put-user-policy --user-name <iam user> --policy-name credentials-data-keys --policy-document "file://$TMPDIR/uw-kms-policy.json"
   aws iam list-attached-user-policies --user-name <iam user>
   aws iam list-user-policies --user-name <iam user>
   ```

   The two lists must show that one inline policy and nothing else. The user's access key is made in the move below and goes straight into the store.

### Move staging

1. **Create the secrets.** A value cannot be read back from a Worker secret or from the store, so each one comes from where its owner keeps it or is issued anew, which is a rotation. `issued_by` in `infra/secrets-store.json` says where. For a model key, a Cloudflare API token or the KMS access key (`aws iam create-access-key --user-name <iam user>`), issue a new one beside the old. Each of these asks for the value at a hidden prompt:

   ```
   STORE_ID=<store id>
   for name in $(jq -r '.secrets[].name | select(endswith("PRIVATE_KEY") | not)' infra/secrets-store.json); do
     pnpm --filter @uw/uw-platform exec wrangler secrets-store secret create "$STORE_ID" --name "UW_STAGING_$name" --scopes workers --remote
   done
   ```

   A GitHub App private key has many lines, which the prompt cannot take. Generate an additional private key in the App's settings (an App can hold several), convert it to PKCS#8 as the GitHub App section says, and pass the file on standard input. Delete both files afterwards:

   ```
   pnpm --filter @uw/uw-platform exec wrangler secrets-store secret create "$STORE_ID" --name UW_STAGING_GITHUB_APP_PRIVATE_KEY --scopes workers --remote < key.pkcs8.pem
   ```

   The same for `UW_STAGING_BUILDER_GITHUB_APP_PRIVATE_KEY`, `UW_STAGING_REVIEWER_GITHUB_APP_PRIVATE_KEY` and `UW_STAGING_REVIEWER_CODEX_GITHUB_APP_PRIVATE_KEY`.

   Three secrets have only one live value at their issuer: `GITHUB_WEBHOOK_SECRET`, `ZULIP_WEBHOOK_TOKEN` and `ZULIP_BOT_API_KEY`. Store the current value if its owner has it. If not, store a new one, and change it at the issuer straight after step 3 deploys; deliveries in between are refused, and GitHub can redeliver them. `VAPID_PRIVATE_JWK` must be the key that matches `VAPID_PUBLIC_KEY`: a new pair ends every push subscription.

   Skip a secret that has no value yet (the notifier's, until it is configured). Stop the loop at its prompt with Ctrl-C and run the rest by hand, and leave its block out in step 3.

2. **Name the owner and the rotation date.** In `infra/secrets-store.json`, set `owner` (an email address) and `rotate_by.staging` (`YYYY-MM-DD`) for each secret created.

3. **Bind them.** In the same pull request as step 2, copy the `[[env.staging.secrets_store_secrets]]` block of each secret created from `infra/uw-platform/wrangler.go-live.toml` into `infra/uw-platform/wrangler.toml`, and the same for `uw-ingest`. Run `pnpm exec vitest run tools/infra`. Merging to `develop` deploys staging. The Worker secrets are untouched, so nothing can go missing at this step.

4. **Verify.**

   ```
   curl -fsS https://uw-platform-staging.unfoldingword.workers.dev/health/probe \
     | jq -e '.indicators[] | select(.name == "secrets")'
   curl -fsS https://uw-ingest-staging.unfoldingword.workers.dev/health \
     | jq -e '.indicators[] | select(.name == "secrets")'
   ```

   Each must read `"status": "ok"`, with as many `from the Secrets Store` as blocks were copied for that Worker. Then prove the values, since a count cannot: run the staging check in the Hosted agents section (a Builder run that opens a pull request and shows its cost), send one GitHub delivery through `uw-ingest`, and make and revoke a routine.

5. **Delete the Worker secrets that were moved.** For each one, on the Worker that held it:

   ```
   pnpm --filter @uw/uw-platform exec wrangler secret delete ANTHROPIC_API_KEY --config ../../infra/uw-platform/wrangler.toml --env staging
   pnpm --filter @uw/uw-ingest exec wrangler secret delete GITHUB_WEBHOOK_SECRET --config ../../infra/uw-ingest/wrangler.toml --env staging
   ```

   Run the two `curl` checks again: `0 from Worker secrets`. `wrangler secret list --env staging` should now show only the App ids and installation ids, and any secret skipped in step 1.

6. **Revoke what was replaced.** At each issuer, delete the old key or token that the new one replaced, and in each GitHub App the old private key.

### Move production

Production follows staging, with an owner's word, as part of a release. Repeat step 1 with `UW_PRODUCTION_` names and production's own values, set `rotate_by.production`, and copy the `[[env.production.secrets_store_secrets]]` blocks in a pull request into `develop`. The bindings reach production with the release that carries that pull request (`gh workflow run deploy-production.yml --ref v<version>`). Then verify, delete and revoke as in steps 4 to 6, with `--env production` and:

```
curl -fsS https://uw-platform.unfoldingword.workers.dev/health/probe \
  | jq -e '.indicators[] | select(.name == "secrets")'
curl -fsS https://uw-ingest.unfoldingword.workers.dev/health \
  | jq -e '.indicators[] | select(.name == "secrets")'
```

### Roll back

- **Before the Worker secrets are deleted (step 5):** revert the pull request that copied the blocks, or remove one block, and deploy. The Worker reads its Worker secrets again. No value was touched.
- **A wrong value in the store:** replace it. It answers "Do you want to update the secret value?" and then asks for the value; running Workers read it within five minutes, or at once after a deploy:

  ```
  pnpm --filter @uw/uw-platform exec wrangler secrets-store secret list "$STORE_ID" --remote --per-page 100
  pnpm --filter @uw/uw-platform exec wrangler secrets-store secret update "$STORE_ID" --secret-id <secret id> --remote
  ```

- **After the Worker secrets are deleted:** set the Worker secret again with `wrangler secret put <NAME> --env <name>` and remove that secret's block from `wrangler.toml`. With no block, the Worker secret is what is read.
- **The `secrets` indicator is red:** find the name in the Worker's log (`outcome` `secret_store_unreadable`), then check that the secret exists under exactly the name in the table, in the store whose id the block gives, with the `workers` scope.
- Never delete a secret from the store while a deployed Worker binds it.

### After the move

A new platform secret gets a row in `infra/secrets-store.json`, a name in the Worker's `secrets.ts`, and a block per environment in the go-live file and, once it exists in the store, the live file. To rotate one, issue the new value, run `secret update` as above, set the next `rotate_by`, and revoke the old value. Where another section of this file says `wrangler secret put <NAME> --env <name>` for a secret in the table above, use `secret create` or `secret update` instead once that environment is moved.

Confirmed against wrangler 4.144.0 and Cloudflare's Secrets Store documentation on 2026-11-20: the binding syntax, the commands and their flags, one store and 100 secrets per account, the roles, and the deploy token's permission. Not confirmed without an account: that a deploy fails when a bound secret does not exist, and what one `get()` costs a request.

## Logs (FD-11)

Workers Logs is on for both Workers, in the top-level block and in `staging` and `production`, because wrangler does not carry top-level observability into an environment.

Thirty-day retention is the R2 bucket `uw-logs` with the lifecycle rule in `logs/r2-lifecycle.json`, fed by the Logpush job in `logs/logpush-workers.json`. A person applies both, once, awaiting go-live:

- Create the bucket `uw-logs`.
- Apply the rule with `PUT /accounts/{account_id}/r2/buckets/uw-logs/lifecycle`, sending `logs/r2-lifecycle.json` as the body.
- Substitute the three `${...}` placeholders in `logs/logpush-workers.json` from the shell with `envsubst`, then send it with `POST /accounts/{account_id}/logpush/jobs`.

Nothing in the files is a secret. `logpush = true` is added to `wrangler.go-live.toml` with the go-live wiring, because Workers Logpush needs the paid plan and the job above.

## Page files: the `uw-files` buckets

Pictures and files attached to pages are stored in R2 through the `FILES` binding of `uw-platform`: the bucket `uw-files-staging` for staging and for every per-PR Worker (`preview`), and `uw-files` for production. Both buckets are private, with no public access and no custom domain, and were created on 2026-11-21. The binding is declared in `uw-platform/wrangler.toml` and `uw-platform/wrangler.go-live.toml`.

Nothing here is a secret. A file is read only through `GET /api/files/:fileId`, which checks the reader's grant on the area of the page that holds it; the bucket is never exposed. A Worker without the binding answers `not_wired` to an upload, a download or the agent verb `attach_file`, and the edit screen says file storage is not set up.

## PDF export: Browser Run and the `PdfExportRun` Cloudflare Workflow (#198)

`uw-platform` prints PDFs through Cloudflare Browser Run (formerly Browser Rendering). The `BROWSER` binding is declared as `[env.<name>.browser] binding = "BROWSER"` under `staging`, `production` and `preview`, identically in `uw-platform/wrangler.toml` and `uw-platform/wrangler.go-live.toml`. Wrangler does not let an environment inherit `browser`, so a binding at the top level would reach no deployed Worker. The Worker calls the binding's `quickAction('pdf', ...)` with one self-contained HTML document: CSS, fonts and images inlined, JavaScript off, every request but `data:` blocked, and the quick-action cache off (`cacheTTL: 0`). The headless browser never fetches the app, so Access needs no change for it. A Worker without the binding answers `not_wired` to a PDF request.

Binders print as a Cloudflare Workflow: `pdf-export-staging` and `pdf-export-production`, both bound as `PDF_EXPORT` to the class `PdfExportRun` (`apps/uw-platform/pdf/workflow.ts`), declared under `staging` and `production` only, like `HARNESS_RUN`. Per-PR Workers (`preview`) declare no Workflow, so a binder there answers `not_wired`; a single page or view still prints. `tools/infra/go-live.test.ts` pins both Workflows and the browser binding in every environment.

The finished PDF is stored in the `FILES` bucket under `exports/<exportId>.pdf` and is read only through `GET /api/exports/:exportId/file`, which re-checks the reader's grant on every area the export covers. Exports expire after seven days; the nightly cron deletes the object and marks the export expired.

Nothing here is a secret. Browser Run bills by browser hours, and the Workers Free plan allows ten browser minutes a day; whether the account is on Workers Paid with Browser Run enabled was not checked from the repository, and a person confirms it in the dashboard before the first staging deploy that prints.

## Switching on the go-live wiring (FD-12)

`uw-platform/wrangler.go-live.toml` and `uw-ingest/wrangler.go-live.toml` are each their `wrangler.toml` plus the bindings whose resources do not exist yet: `logpush`, the `HYPERDRIVE` binding, the ingest queue producer and consumer, the `INGEST_DLQ` producer, and uw-platform's `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. A test keeps each file equal to its live twin plus exactly those.

`uw-platform/wrangler.toml` also declares a `preview` environment. Per-PR Workers deploy with `--env preview`, so they never register as the staging queue consumer. In the go-live file `preview` binds Hyperdrive and declares no queue consumer. Its Hyperdrive id must equal staging's (P33); a test checks that they match.

A person adds, in the repository settings:

| Name | Kind | Where it comes from |
|---|---|---|
| `DATABASE_URL_STAGING` | secret | The direct, non-pooled Postgres connection string for staging (any Postgres 16 or later, such as AWS RDS); the deploy migrates through it |
| `DATABASE_URL_PRODUCTION` | secret | The same for production |
| `DATABASE_TUNNEL_HOST_STAGING` | variable | Optional: when the database is reachable only through a Cloudflare Tunnel, the tunnel's TCP hostname for the staging database. The migrate job then opens `cloudflared access tcp` to it on `127.0.0.1:15432` first, so `DATABASE_URL_STAGING` must point at `127.0.0.1:15432` |
| `DATABASE_TUNNEL_HOST_PRODUCTION` | variable | Optional: the same for production |
| `DATABASE_TUNNEL_CLIENT_ID` | secret | With a tunnel host: the Cloudflare Access service token's client id the migrate jobs present |
| `DATABASE_TUNNEL_CLIENT_SECRET` | secret | With a tunnel host: that service token's secret |
| `BOOTSTRAP_ADMIN_EMAIL` | variable | The person who becomes the first org admin. After migrating, each deploy runs `pnpm db:bootstrap-admin`, which adds this person and an org admin grant only when no org admin exists, so on a database that already has one it changes nothing. Unset, the step logs that and adds no one |
| `BOOTSTRAP_ADMIN_NAME` | variable | Optional: that person's display name; without it the part of the email before the @ is used |
| `CLOUDFLARE_API_TOKEN` | secret | A Cloudflare API token scoped to Workers Scripts edit on the one account (the uw-platform section) |
| `CLOUDFLARE_ACCOUNT_ID` | secret | The Cloudflare account's id |


Then, with Cloudflare access:

- Create the Hyperdrive configs: `wrangler hyperdrive create uw-staging --connection-string=...` and `wrangler hyperdrive create uw-production --connection-string=...`, using the pooled connection strings.
- Create the four queues: `wrangler queues create uw-ingest-events-staging`, `uw-ingest-events-staging-dlq`, `uw-ingest-events-production` and `uw-ingest-events-production-dlq`.
- Replace every `set-at-go-live` with the real Hyperdrive id, Access AUD tag and Access team domain. `CREDENTIALS_KMS_KEY_ID` is already declared (#186), and the Secrets Store `store_id` is set by the Platform secrets section, not here.
- Once every resource exists, copy each `wrangler.go-live.toml` over its `wrangler.toml` in one reviewed PR.

Until that PR, the per-PR and staging Workers run with no database and no queue, `/health/probe` says so, and every go-live job logs a notice and stays green. After it, per-PR Workers bind to staging's Hyperdrive (P33).

### The GL-1 switch, in order

GL-1 switches the wiring above on. It writes no code: each step creates a resource, sets a secret or a value, or checks one. Steps 1 to 5 can run in any order; step 6 needs them all; step 7 is GL-1's release gate.

1. **The database (FD-12).** A Postgres 16 or later database for staging and one for production (AWS RDS, or any Postgres the Hyperdrive config and the GitHub runner can reach). In the repository settings set `DATABASE_URL_STAGING` and `DATABASE_URL_PRODUCTION` as secrets (the table above); the deploy migrates through them, so the database must accept connections from GitHub's runners while it does. When the database is reachable only through a Cloudflare Tunnel (AWS Aurora, set up with the infrastructure team), set `DATABASE_TUNNEL_HOST_STAGING` and `DATABASE_TUNNEL_HOST_PRODUCTION` as variables and `DATABASE_TUNNEL_CLIENT_ID` and `DATABASE_TUNNEL_CLIENT_SECRET` as secrets: the tunnel needs a TCP route to the database behind a Cloudflare Access application that admits that service token, and each migrate job opens it with `.github/scripts/db-tunnel.sh` before migrating, with the `DATABASE_URL_*` secret pointing at `127.0.0.1:15432`.
2. **Hyperdrive (FD-12, FD-6).** `wrangler hyperdrive create uw-staging --connection-string=<pooled staging string>`, and the same for `uw-production`. Put each Hyperdrive id in place of `set-at-go-live` in `[[env.staging.hyperdrive]]` and `[[env.production.hyperdrive]]` of both go-live files, and staging's Hyperdrive id in uw-platform's `[[env.preview.hyperdrive]]` (P33).
3. **Queues, hosts and the deploy token (FD-10).** Create the four queues listed above with `wrangler queues create`. In the repository settings set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as secrets (the table above). Until the token is set, `deploy-pr`, `cleanup-pr`, `deploy-staging`, `deploy-ingest-staging`, `deploy-production` and `deploy-ingest-production` each log the notice "CLOUDFLARE_API_TOKEN is not set" and stay green; check that each now runs its steps. Read the account's `workers.dev` subdomain in the Cloudflare dashboard; if it is not `unfoldingword`, correct `STAGING_URL` and `INGEST_URL` in `.github/workflows/deploy-staging.yml` and the address in step 7.
4. **Access and origins (FD-7).** Apply the three applications as the Access section says. Put the app application's AUD tag in `ACCESS_AUD`, the `mcp` application's in `ACCESS_MCP_AUD` and the team domain in `ACCESS_TEAM_DOMAIN`, under staging, production and preview of `uw-platform/wrangler.go-live.toml`, and the staging origin in `APP_ORIGIN`. `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `ZULIP_SITE` and `ZULIP_BOT_EMAIL` come from the notifier section, `ZULIP_ADMIN_EMAIL` and `ASSISTANT_WEBHOOK_BASE` from the personal assistants section, and `GOOGLE_WORKSPACE_ADMIN_SUBJECT` from its Google Workspace section; the push and Zulip halves read their secrets (`VAPID_PRIVATE_JWK`, `ZULIP_BOT_API_KEY`) before these values, so they stay off until those secrets are set.
5. **Worker secrets (FD-10, GH-1).** Once an org owner has registered the GitHub App (the GitHub App section), set `GITHUB_WEBHOOK_SECRET` on uw-ingest and the `GITHUB_APP_*` secrets on uw-platform with `wrangler secret put <name> --env staging`, as that section lists. The other Worker secrets are set the same way and listed where they are used: the Reviewer Apps section, the Builder GitHub App section, and the notifier section (`VAPID_PRIVATE_JWK`, `ZULIP_BOT_API_KEY`). Step 7's probe does not need them; the FD-10 webhook check and the delegated merge's live run do.
6. **The switch pull request.** In one pull request: copy `uw-platform/wrangler.go-live.toml` over `uw-platform/wrangler.toml` and `uw-ingest/wrangler.go-live.toml` over `uw-ingest/wrangler.toml`, and set `"switchedOn": true` in `infra/go-live.json`. `pnpm verify` must be green: with the flag on, the live-file tests require each live file to carry everything its go-live twin declares, and with it off they require none of it, so a half switch fails. Merge it on a green CI `test` job; `deploy-staging.yml` then runs `migrate-staging` and deploys both Workers. The deploy builds the sandbox images, so the runner needs Docker (the sandbox section).
7. **The release gate: the staging probe through Hyperdrive.** Run

   ```
   curl -fsS https://uw-platform-staging.unfoldingword.workers.dev/health/probe \
     | jq -e '.indicators[] | select(.name == "database") | .status == "ok"'
   ```

   It prints `true` and exits 0 when the database answers through Hyperdrive, and the indicator's detail reads `reachable in <n> ms`. `not_configured` means the deployed Worker has no `HYPERDRIVE` binding (step 6 did not deploy); `red` means Hyperdrive cannot reach the database (step 2's connection string). Then check the rest by hand: sign in through Access, send one GitHub delivery through uw-ingest, watch a failing message reach the dead-letter queue, and load `https://uw-ingest-staging.unfoldingword.workers.dev/health`.
8. **Record the result.** Say on the go-live issue which checks passed and on what date. A check that failed stays open there, restated with what failed.
