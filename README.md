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
- `scripts/setup-env.mjs` creates or completes the single root `.env` from `.env.sample`.
- `docker-compose.yml` runs dev containers.
- `docker-compose.prod.yml` is the production-oriented compose file.

## Dev Start

```bash
npm run dev:docker
```

This runs `npm run setup:env` first, then starts Redis, backend, frontend, and `admin-seed`. The development database is `db.sqlite3` in the project root.

Equivalent direct Docker command:

```bash
npm run setup:env
docker compose up --build -d
```

Frontend: `http://localhost:3000`

Backend health: `http://localhost:4000/api/health`

Admin: `http://localhost:3000/admin`

## Superadmin

The `admin-seed` service creates or updates the local superadmin.

The initial email and password are `LOCAL_SUPERADMIN_EMAIL` and `LOCAL_SUPERADMIN_PASSWORD` in root `.env`. The setup script generates a password when creating a new file.

Override before running Docker:

```bash
LOCAL_SUPERADMIN_EMAIL=admin@example.com LOCAL_SUPERADMIN_PASSWORD='replace-me' npm run dev:docker
```

The password is stored as a bcrypt hash in SQLite, never as plain text.

## Environment Setup

The only active environment file is root `.env` (ignored by git). Root `.env.sample` lists all settings. Run `npm run setup:env` to create missing settings and generate `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, and `BOT_INTEGRATION_TOKEN`. Existing values are preserved. Development Compose overrides URLs and storage paths for localhost; production Compose uses the values in `.env`.

For production, set `VITE_API_URL=https://api.globalmarketsuite.com`, `SITE_URL=https://globalmarketsuite.com`, and `CORS_ORIGIN=https://globalmarketsuite.com`. Keep `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` matching the existing PostgreSQL volume until the SQLite import completes.

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

## Telegram Bot Publishing

The bot can publish through `https://api.globalmarketsuite.com/api/bot/v1/` using `BOT_INTEGRATION_TOKEN` as a Bearer token. Add a bot site entry with ID `globalmarketsuite`, that API base, and `token_env` set to `GLOBALMARKETSUITE_INTEGRATION_TOKEN`; its token value must equal this project's `BOT_INTEGRATION_TOKEN`.

The integration supports `GET options/`, `POST articles/`, `GET articles/:external_id/`, `PUT articles/:external_id/image/`, and `POST articles/:external_id/publish/`. Draft creation and publication are separate and safe to retry with the same external ID. Uploaded JPEG, PNG, or WebP covers are stored in `media/covers/` and served from the public site. Bot articles use the `Market Intelligence` category and appear in the regular article feed after publication.

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

Create or complete the root `.env`:

```bash
npm run setup:env
```

Review and edit `.env`.

Important production values:

- `POSTGRES_PASSWORD`
- `VITE_API_URL`
- `CORS_ORIGIN`
- `SITE_URL`
- `JWT_SECRET`
- `REFRESH_TOKEN_SECRET`
- `BOT_INTEGRATION_TOKEN`
- `OPENROUTER_API_KEY`

For the first production deployment from PostgreSQL, follow [the migration guide](MIGRATION_TO_SQLITE.ru.md). It backs up the old data, then uses the same Compose command as future deployments:

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

The production database is `db.sqlite3`. Static covers and uploaded images live in `media/` in the project root on the Linux host. The frontend serves both `/covers/...` and `/uploads/covers/...` from `media/covers`. Compose reads root `.env`. The old PostgreSQL and uploads volumes remain external import sources; verify their names in the migration guide before the first run.

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

If AI generation fails with `OPENROUTER_API_KEY is not configured`, add the key to root `.env` and restart backend.

## Backups

Back up `db.sqlite3` and `media/` together. To copy the SQLite file directly, stop the backend first so the backup is consistent. The old PostgreSQL volume should remain until the migration has been verified.

For the first PostgreSQL import, follow the backup steps in [the migration guide](MIGRATION_TO_SQLITE.ru.md) before updating the deployed code.
