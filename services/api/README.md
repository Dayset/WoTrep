# wotrep-api (Cloudflare Worker)

Optional backend (issue #110 upwards builds on it). The web app works fully without it; when `/health` doesn't answer, cloud buttons simply don't appear.

| Route | What |
|---|---|
| `GET /health` | `{ok, service, db}`; the app uses it to detect "cloud off" |
| `POST /v1/feedback` | anonymous 👍/👎 votes `{app:"wotrep", v:1, votes:{"card.impact":1,"chart.wp":-1}}`; ≤ 4 KB; ids must match `(card|chart).<name>` |
| `GET /v1/feedback/summary` | per-metric up/down counts |

Privacy: a row is `(ts, version, metric, vote)`. No IP, account, name or replay is stored. Browser calls are limited to `ALLOWED_ORIGINS`; abuse is limited by the Workers rate-limit binding (20 requests/min per IP).

## One-time setup (owner, ~5 minutes)

1. Cloudflare dashboard → My Profile → API Tokens → create a token from the "Edit Cloudflare Workers" template (+ D1 edit). Note the Account ID.
2. `cd services/api && npx wrangler login && npx wrangler d1 create wotrep` → paste the printed `database_id` into `wrangler.toml` and commit.
3. GitHub repo → Settings → Secrets and variables → Actions: add secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
4. Push (or run the `api-deploy` workflow). It applies `migrations/` and deploys. The Worker URL is printed (`https://wotrep-api.<you>.workers.dev`).
5. Repo → Settings → Secrets and variables → Actions → **Variables**: add `WOTREP_API_URL` = that URL, then re-run the `pages` workflow so the app picks it up.

Until steps 1-3 are done the deploy job logs a notice and exits successfully.

## Develop

`pnpm --filter @wotrep/api test` runs the handler against an in-memory fake D1 (no Workers runtime needed). `npx wrangler dev` runs it locally with `--local` D1.
