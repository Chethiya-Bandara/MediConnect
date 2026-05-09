# Local Setup

## Prerequisites
- Python 3.10+ recommended, Python 3.12 preferred
- Node.js 20+
- npm 10+
- A Supabase project with the MediConnect tables loaded

## Backend
```powershell
cd D:\Dev\Python\MediConnect\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Fill `backend/.env` with real values for:
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_SERVICE_KEY`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `NIC_HMAC_SECRET`
- `METADATA_ENCRYPTION_KEY`
- optional `GEMINI_API_KEY`

Start the API:
```powershell
cd D:\Dev\Python\MediConnect\backend
.\.venv\Scripts\Activate.ps1
python run_dev.py
```

Backend URL:
- `http://127.0.0.1:8001`
- Swagger docs: `http://127.0.0.1:8001/docs`

## Frontend
```powershell
cd D:\Dev\Python\MediConnect\frontend
npm install
npm run dev
```

Frontend URL:
- `http://localhost:5173`

## Linting And Formatting
Frontend:
```powershell
cd D:\Dev\Python\MediConnect\frontend
npm run lint
npm run format:check
```

Backend config files live at the repo root:
- `pyproject.toml` for `black` and `ruff` settings

If you want the Python tooling locally:
```powershell
cd D:\Dev\Python\MediConnect
pip install black ruff
ruff check backend
black --check backend
```

## Database Performance Indexes
Run `backend/app/db/create_indexes.sql` in the Supabase SQL editor.

Important limitation:
- the current analytics schema does not expose a district column on encounter diagnosis rows
- date indexes are ready now
- district index statements are documented in SQL and can be enabled once that column exists

## Alembic Migrations
The repo now includes Alembic scaffolding at the root:
- `alembic.ini`
- `alembic/`

Set either `DATABASE_URL` or `SUPABASE_DB_URL`, then run:
```powershell
cd D:\Dev\Python\MediConnect
alembic upgrade head
```

Current baseline migration applies:
- `backend/app/db/create_anomaly_flags.sql`
- `backend/app/db/create_indexes.sql`

## Docker Compose
From the repo root:
```powershell
docker compose up --build
```

Optional local PostgreSQL:
```powershell
docker compose --profile local-db up --build
```

Notes:
- Backend still expects real `.env` values for Supabase-backed auth and service integrations.
- The local `postgres` service is mainly there for migration portability and future non-Supabase workflows.
