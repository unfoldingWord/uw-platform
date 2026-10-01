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

The deployed commit reaches the Worker as the `COMMIT_SHA` var, set on the deploy command line. The value in the file is the placeholder `unknown`, which `/health` reports when nothing was passed.

### Where each later binding goes

A binding is added by a diff to `uw-app/wrangler.toml`, once in `[env.staging]` and once in `[env.production]`, so the two cannot drift. Each block sits directly under the environment's `[env.<name>.vars]` table.

| Binding | Table to add | Issue |
|---|---|---|
| Hyperdrive | `[[env.<name>.hyperdrive]]` with `binding`, `id` | #7 |
| Queue consumer | `[[env.<name>.queues.consumers]]` with `queue` | #10 |
| Queue producer | `[[env.<name>.queues.producers]]` with `binding`, `queue` | #10 |
| Durable Objects | `[[env.<name>.durable_objects.bindings]]` with `name`, `class_name`, plus `[[env.<name>.migrations]]` | live hub |
| Workflows | `[[env.<name>.workflows]]` with `name`, `binding`, `class_name` | runs |
| Crons | `[env.<name>.triggers]` with `crons` | later |

Ids that are not secret (a Hyperdrive id) may be committed. A secret is set with `wrangler secret put --env <name>` and appears in the file nowhere.

## Access (FD-7)

`access/uw-app.json` declares Cloudflare Access in front of `uw-app` on staging and every per-PR Worker. People sign in with Google; any valid service token passes as a non-identity request and becomes a non-interactive agent principal; `/health` alone is bypassed so the deploy jobs can read the deployed commit.

The allow policy admits any Google account on purpose. A person outside `@unfoldingword.org` must reach the app to be recorded as pending (FD-7). Authorization is the grants table, not Access.

The file holds the bodies of two Cloudflare API calls, applied by a person with an API token holding Access: Apps and Policies Edit:

- `POST /accounts/{account_id}/access/apps`, then `POST /accounts/{account_id}/access/apps/{app_id}/policies`, for `application` with `policies`.
- The same two calls for `health_bypass.application` with `health_bypass.policies`.

Replace `<google-idp-id>` with the Google identity provider's id from `GET /accounts/{account_id}/access/identity_providers`. After creation, the application's AUD tag and the team domain go into `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` in `infra/uw-app/wrangler.go-live.toml` (Task 16 of the step-1 plan). Production gets its own application when `uw-app` has a production route.

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

## Logs (FD-11)

Workers Logs is on for both Workers, in the top-level block and in `staging` and `production`, because wrangler does not carry top-level observability into an environment.

Thirty-day retention is the R2 bucket `uw-logs` with the lifecycle rule in `logs/r2-lifecycle.json`, fed by the Logpush job in `logs/logpush-workers.json`. A person applies both, once, awaiting go-live:

- Create the bucket `uw-logs`.
- Apply the rule with `PUT /accounts/{account_id}/r2/buckets/uw-logs/lifecycle`, sending `logs/r2-lifecycle.json` as the body.
- Substitute the three `${...}` placeholders in `logs/logpush-workers.json` from the shell with `envsubst`, then send it with `POST /accounts/{account_id}/logpush/jobs`.

Nothing in the files is a secret. `logpush = true` is added to `wrangler.go-live.toml` with the go-live wiring, because Workers Logpush needs the paid plan and the job above.
