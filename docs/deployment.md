# Deployment guide

The reference deployment uses:

- Cloudflare Pages for the Vite frontend;
- Render for the FastAPI backend;
- Neon or another PostgreSQL provider for persistence.

The frontend and backend can be deployed independently. Deploy the backend first because the frontend needs its public URL at build time.

## 1. Prepare PostgreSQL

Create an empty PostgreSQL database and copy its connection URI into the Render secret `DATABASE_URL`. Do not commit the URI or paste it into a public build log.

The small MVP storage modules create their tables on first use. Run `/health/db` after deployment to verify connectivity.

## 2. Deploy the backend on Render

1. In Render, select **New > Blueprint**.
2. Connect `RenatZahar/job-match-assistant-showcase` or your fork.
3. Use branch `main` and Blueprint path `render.yaml`.
4. Review the planned web service and deploy it.
5. Set the secret values that the Blueprint marks with `sync: false`.

Required values for the hosted API:

| Variable            | Value                                               |
| ------------------- | --------------------------------------------------- |
| `DATABASE_URL`      | PostgreSQL/Neon connection URI                      |
| `CORS_ORIGINS`      | Temporary frontend origin, then the final Pages URL |
| `FRONTEND_BASE_URL` | Final Pages URL                                     |
| `BASIC_AUTH_USERS`  | Optional `username:strong-password` entries         |
| `OPENAI_API_KEY`    | Required only for real LLM evaluation               |

The Blueprint installs `backend/`, starts Uvicorn, and configures `/health` as Render's health check. It deploys new commits only after linked CI checks pass.

Verify the assigned Render URL:

```bash
curl --fail https://<your-render-service>.onrender.com/health
```

Expected shape:

```json
{ "status": "ok", "environment": "production" }
```

Database check:

```bash
curl --fail https://<your-render-service>.onrender.com/health/db
```

If Basic Auth is enabled, add `--user username:password` without saving credentials in shell history or repository files.

## 3. Deploy the frontend on Cloudflare Pages

1. Open **Workers & Pages > Create application > Pages > Import an existing Git repository**.
2. Select this repository or your fork.
3. Configure the build:

| Setting                | Value           |
| ---------------------- | --------------- |
| Production branch      | `main`          |
| Root directory         | `frontend`      |
| Framework preset       | React (Vite)    |
| Build command          | `npm run build` |
| Build output directory | `dist`          |

4. Add production environment variables:

```text
NODE_VERSION=22
VITE_API_BASE_URL=https://<your-render-service>.onrender.com
VITE_MATCH_API_MODE=api
```

Use `VITE_MATCH_API_MODE=mock` when you want a no-cost UI showcase without real LLM evaluation.

5. Deploy and copy the assigned `https://<project>.pages.dev` URL.
6. Return to Render and set both `CORS_ORIGINS` and `FRONTEND_BASE_URL` to that exact origin.
7. Redeploy/restart only if Render indicates the environment change requires it.

## 4. Verify the deployment

```bash
curl --fail https://<project>.pages.dev/
curl --fail https://<your-render-service>.onrender.com/health
```

Then verify in the browser:

1. the page loads without console errors;
2. backend health is shown as available;
3. mock matching works with synthetic input, or API matching works with configured provider credentials;
4. no secret appears in the generated frontend JavaScript;
5. feedback succeeds and `/health/db` remains healthy.

## 5. Rollback

- Cloudflare Pages: select the last known-good deployment and roll it back/promote it.
- Render: open the service's deploy history and redeploy the last known-good commit.
- Database: application rollback does not automatically reverse schema or data changes. This MVP does not ship destructive migrations.

Never retry a timed-out deploy blindly. First inspect the provider's deployment list: the original deploy might have completed after the client timed out.

## Configuration sources of truth

- Render: `render.yaml`
- Cloudflare Pages: `infra/cloudflare-pages.md`
- local containers: `compose.yaml`
- backend environment contract: `.env.example`
- frontend public environment contract: `frontend/.env.example`
