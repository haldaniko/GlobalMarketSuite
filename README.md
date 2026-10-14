# GlobalMarketSuite

Full-stack blog and AI publishing platform for `globalmarketsuite.com`: Vite React frontend, Express TypeScript backend, SQLite, Redis, JWT auth, refresh-token sessions, CSRF protection, admin publishing, OpenRouter generation, and Docker dev/prod environments.

## Stack

- Frontend: Vite, React, TypeScript, SCSS, client-side routing, admin panel inside the app.
- Backend: Node.js, Express, TypeScript, SQLite, Redis-ready runtime, bcrypt password hashing, JWT access tokens, secure refresh-token cookies, CSRF checks, audit log, rate limiting, HTML sanitization, structured errors.
- AI: OpenRouter, default model `meta-llama/llama-3.1-8b-instruct`.
- Ports: frontend `3000`, backend `4000`.

## Project Structure

- `frontend/` public blog, article pages, about page, and admin UI.
- `backend/` API, database schema initialization, auth, admin routes, OpenRouter service, scheduler.
- `scripts/setup-dev-env.mjs` creates `.env`, `backend/.env`, and `frontend/.env`.
- `scripts/setup-prod-env.mjs` creates production env templates with generated secrets.
- `docker-compose.yml` runs dev containers.
- `docker-compose.prod.yml` is the production-oriented compose file.

## Dev Start

```bash
npm run dev:docker
```

This runs `npm run setup:dev-env` first, then starts Redis, backend, frontend, and `admin-seed`. The development database is `db.sqlite3` in the project root.

Equivalent direct Docker command:

```bash
npm run setup:dev-env
docker compose up --build -d
```

Frontend: `http://localhost:3000`

Backend health: `http://localhost:4000/api/health`

Admin: `http://localhost:3000/admin`

## Superadmin

The `admin-seed` service creates or updates the local superadmin.

Default local login:

- Email: `admin@globalmarketsuite.local`
- Password: `MySecretPassword123!`

Override before running Docker:

```bash
LOCAL_SUPERADMIN_EMAIL=admin@example.com LOCAL_SUPERADMIN_PASSWORD='replace-me' npm run dev:docker
```

The password is stored as a bcrypt hash in SQLite, never as plain text.

## Environment Setup

Real env files are ignored by git:

- `.env`
- `backend/.env`
- `frontend/.env`
- `.env.production`
- `backend/.env.production`

Example files are committed:

- `.env.example`
- `.env.production.example`
- `backend/.env.example`
- `backend/.env.production.example`
- `frontend/.env.example`

`scripts/setup-dev-env.mjs` generates `JWT_SECRET` and `REFRESH_TOKEN_SECRET` automatically. Put `OPENROUTER_API_KEY` once in root `.env`; the setup script propagates it into `backend/.env`.

## OpenRouter

Root `.env`:

```bash
OPENROUTER_API_KEY=sk-or-v1-your-key
OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instruct
```

If the key is missing, the backend stays up. AI generation returns a clear configuration error instead of crashing the app.

Do not run real generation unless you intend to call OpenRouter.

## Master Prompt

The default GlobalMarketSuite prompt is in `backend/src/data/masterPrompt.ts`.

At runtime, settings are read from the SQLite `admin_settings` table. The admin panel has a master prompt textarea. OpenRouter generation uses `settings.masterPrompt` from the database, not a hardcoded prompt.

To change it:

1. Open `/admin`.
2. Sign in as superadmin.
3. Edit the AI generation master prompt.
4. Click `Save settings`.

## Admin Features

- Login/logout superadmin.
- List articles.
- Create/edit/delete articles.
- Draft/published status.
- Local cover image path saved with each article.
- AI generation settings.
- Save master prompt.
- Auto-generation toggle.
- Daily/weekly frequency.
- Generation count.
- Generation time list.
- Weekday selection.
- `Generate now` button.

Generated articles receive a local cover path stored in `generated_posts.cover_image`. Existing articles keep their saved cover image.

## Auth And Security

- Access token: short-lived JWT returned to the frontend.
- Refresh token: random token stored as an HTTP-only cookie and hashed in SQLite.
- CSRF token: generated with refresh token and required for refresh, logout, admin mutations, and generation.
- Logout deletes the refresh token from SQLite and clears the cookie.
- Production cookies use `secure: true`; cookies are `httpOnly` and `sameSite: strict`.
- Admin routes require bearer access token.
- CORS is controlled by `CORS_ORIGIN`.
- Article HTML is sanitized before storage.
- Audit events are written for admin actions.
- Secrets are not logged or committed.

## Production Setup

Create production env files:

```bash
npm run setup:prod-env
```

Review and edit:

- `.env.production`
- `backend/.env.production`

Important production values:

- `POSTGRES_PASSWORD`
- `VITE_API_URL`
- `CORS_ORIGIN`
- `SITE_URL`
- `JWT_SECRET`
- `REFRESH_TOKEN_SECRET`
- `OPENROUTER_API_KEY`

For the first production deployment from PostgreSQL, follow [the migration guide](MIGRATION_TO_SQLITE.ru.md). It backs up the old data, then uses the same Compose command as future deployments:

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

The production database is `db.sqlite3` and static images are copied into `media/` in the project root on the Linux host. The frontend serves covers from `media/covers`. Compose reads `.env.production` directly for the PostgreSQL importer and frontend runtime configuration. The old PostgreSQL volume is retained as an external volume for the one-time import service. Before the first migration, verify that its name is `globalmarketsuite_globalmarketsuite_prod_postgres_data` as described in the migration guide.

## Docker Rebuild

Dev rebuild:

```bash
npm run docker:rebuild
```

Plain compose rebuild:

```bash
docker compose up --build -d
```

Check services:

```bash
docker compose ps
docker compose logs backend
docker compose logs admin-seed
```

## Useful Checks

```bash
docker compose config --quiet
curl http://localhost:4000/api/health
curl http://localhost:3000
```

## Troubleshooting

If port `3000` or `4000` is busy, stop the process using it or change the compose port mapping and matching env URLs.

If login fails, check:

```bash
docker compose logs admin-seed
docker compose exec backend node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/host-data/db.sqlite3', { readOnly: true }); console.log(db.prepare('SELECT email, role FROM users').all()); db.close()"
```

If AI generation fails with `OPENROUTER_API_KEY is not configured`, add the key to root `.env`, run `npm run setup:dev-env`, and restart backend.

## Backups

Back up `db.sqlite3` and `media/` together. To copy the SQLite file directly, stop the backend first so the backup is consistent. The old PostgreSQL volume should remain until the migration has been verified.

The following legacy PostgreSQL commands apply only before the first import:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -c 'pg_dump -h /var/run/postgresql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > globalmarketsuite-postgres.dump
```
