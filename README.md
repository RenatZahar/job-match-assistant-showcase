# Job Match Assistant

Job Match Assistant — AI-assisted веб-приложение для сопоставления резюме и вакансий, анализа требований и подготовки объяснимой оценки соответствия.

Демо: https://job-match-assistant.pages.dev/

## Что показывает проект

- React/Vite/TypeScript frontend с типизированными API adapters.
- FastAPI backend с валидацией входных данных и структурированного LLM-ответа.
- Privacy pipeline: sanitization и anonymization до LLM evaluation; raw CV не сохраняется.
- PostgreSQL/Neon persistence, Cloudflare Pages frontend и Render backend.
- Автоматические backend/frontend tests и production build.

## Стек

- Frontend: React, Vite, TypeScript, Tailwind CSS, shadcn/ui
- Backend: Python, FastAPI
- Database: Neon Postgres
- Hosting: Cloudflare Pages + Render

## Локальный Backend

```powershell
cd C:\project_Job_Match_Assistant
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".\backend[dev]"
$env:APP_ENV = "local"
uvicorn app.main:app --app-dir backend --reload
```

Health check:

```powershell
Invoke-RestMethod http://localhost:8000/health
```

## Локальный Frontend

Для frontend нужен установленный Node.js LTS. После установки перезапусти VS Code, чтобы `node` и `npm` появились в PowerShell.

```powershell
cd C:\project_Job_Match_Assistant\frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

