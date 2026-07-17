# Cloudflare Pages configuration

Use Git integration and select this repository.

| Setting                | Value           |
| ---------------------- | --------------- |
| Framework preset       | React (Vite)    |
| Production branch      | `main`          |
| Root directory         | `frontend`      |
| Build command          | `npm run build` |
| Build output directory | `dist`          |

Production environment variables:

```text
NODE_VERSION=22
VITE_API_BASE_URL=https://<your-render-service>.onrender.com
VITE_MATCH_API_MODE=api
```

Use `VITE_MATCH_API_MODE=mock` for a no-cost public UI demo. Vite variables are embedded at build time, so deploy again after changing them.

After Pages assigns the production URL, update the backend values in Render:

```text
CORS_ORIGINS=https://<your-project>.pages.dev
FRONTEND_BASE_URL=https://<your-project>.pages.dev
```

Preview deployments need their own allowed origin if they call the backend directly. Do not use `*` together with browser credentials.
