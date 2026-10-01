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
