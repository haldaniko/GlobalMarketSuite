import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { samplePosts } from '../data/samplePosts';
import { sanitizeArticleHtml } from './htmlSanitizer';

function requireProductionEnv() {
  if (process.env.NODE_ENV !== 'production') return;
  for (const key of ['DATABASE_PATH', 'JWT_SECRET', 'REFRESH_TOKEN_SECRET']) {
    if (!process.env[key]) throw new Error(`${key} is required in production`);
  }
  if (process.env.JWT_SECRET === process.env.REFRESH_TOKEN_SECRET) {
    throw new Error('JWT_SECRET and REFRESH_TOKEN_SECRET must be different');
  }
  if ((process.env.JWT_SECRET || '').length < 32 || (process.env.REFRESH_TOKEN_SECRET || '').length < 32) {
    throw new Error('JWT secrets must be at least 32 characters');
  }
  if ((process.env.CORS_ORIGIN || '').includes('localhost') || (process.env.SITE_URL || '').includes('localhost')) {
    throw new Error('Production CORS_ORIGIN and SITE_URL must not point to localhost');
  }
}

requireProductionEnv();

const databasePath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'db.sqlite3');
if (process.env.NODE_ENV === 'production' && !existsSync(databasePath)) {
  throw new Error(`SQLite database is missing at ${databasePath}; run the PostgreSQL import first`);
}
mkdirSync(path.dirname(databasePath), { recursive: true });
export const database = new DatabaseSync(databasePath, { timeout: 5000 });
database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');

type Row = Record<string, unknown>;
const dateNow = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export async function query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
  const sqliteSql = sql.replace(/\$(\d+)/g, '?$1').replace(/\bILIKE\b/gi, 'LIKE').replace(/\bnow\(\)/gi, dateNow);
  const values = params.map((value) => Array.isArray(value) || (value !== null && typeof value === 'object')
    ? JSON.stringify(value) : value) as (string | number | bigint | null)[];
  const statement = database.prepare(sqliteSql);
  const rows = /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sqliteSql) || /\bRETURNING\b/i.test(sqliteSql)
    ? statement.all(...values) : (statement.run(...values), []);
  return {
    rows: rows.map((raw) => {
      const row = { ...raw } as Row;
      for (const key of ['tags', 'value', 'metadata']) {
        if (typeof row[key] === 'string') row[key] = JSON.parse(row[key] as string);
      }
      return row as T;
    }),
  };
}

export function createSchema() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin', created_at TEXT NOT NULL DEFAULT (${dateNow})
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL, csrf_token TEXT NOT NULL,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (${dateNow})
    );
    CREATE TABLE IF NOT EXISTS generated_posts (
      id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
      excerpt TEXT NOT NULL, content_html TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published', author TEXT NOT NULL DEFAULT 'Editorial team',
      tags TEXT NOT NULL DEFAULT '[]', cover_image TEXT NOT NULL DEFAULT '/covers/market-map.svg',
      seo_title TEXT, seo_description TEXT,
      source TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL DEFAULT (${dateNow}), updated_at TEXT NOT NULL DEFAULT (${dateNow})
    );
    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (${dateNow})
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY, actor_id TEXT, actor_email TEXT, event_type TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (${dateNow})
    );
    CREATE TABLE IF NOT EXISTS subscribers (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${dateNow})
    );
  `);
}

export async function ensureSchema() {
  createSchema();
  const count = await query<{ count: number }>('SELECT count(*) AS count FROM generated_posts');
  if (count.rows[0].count === 0 && process.env.NODE_ENV !== 'production') {
    for (const post of samplePosts) {
      await query(
        `INSERT INTO generated_posts (id, slug, title, excerpt, content_html, cover_image, tags, seo_title, seo_description, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'legacy') ON CONFLICT (slug) DO NOTHING`,
        [randomUUID(), post.slug, post.title, post.excerpt, sanitizeArticleHtml(post.contentHtml),
          post.coverImage || '/covers/market-map.svg', post.tags || [], post.seoTitle || null, post.seoDescription || null],
      );
    }
  }
}
