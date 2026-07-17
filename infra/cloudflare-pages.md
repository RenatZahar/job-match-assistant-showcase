# Cloudflare Pages Settings

## Project

- Framework preset: Vite
- Root directory: `frontend`
- Build command: `npm run build`
- Build output directory: `dist`
- Production branch: `main`

## Environment Variables

Production:

- `VITE_API_BASE_URL=https://api.example.com`
- `VITE_MATCH_API_MODE=api`

Development:

- `VITE_API_BASE_URL=https://api-dev.example.com`
- `VITE_MATCH_API_MODE=api`

Local frontend development can keep `VITE_MATCH_API_MODE=mock` for match calculation, but feedback,
app logs, and `test_data` use the backend API configured by `VITE_API_BASE_URL`.

Replace `example.com` with the selected project domain during setup.

## Custom Domains

- Production frontend: `app.example.com`
- Development frontend: `dev.example.com`

Use Cloudflare dashboard generated DNS instructions for exact records.
