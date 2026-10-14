import { createHash } from 'node:crypto';
import { constants, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const hostRoot = process.env.HOST_DATA_DIR || '/host-data';
const sqlitePath = path.join(hostRoot, 'db.sqlite3');
const tempPath = path.join(hostRoot, '.db.sqlite3.importing');
const mediaPath = path.join(hostRoot, 'media');
const staticAssets = path.join(hostRoot, 'frontend', 'public');
const oldUploads = process.env.LEGACY_UPLOAD_DIR || '/legacy-uploads';
const tables = {
  users: ['id', 'email', 'password_hash', 'role', 'created_at'],
  refresh_tokens: ['id', 'user_id', 'token_hash', 'csrf_token', 'expires_at', 'created_at'],
  generated_posts: ['id', 'slug', 'title', 'excerpt', 'content_html', 'status', 'author', 'tags',
    'cover_image', 'seo_title', 'seo_description', 'source', 'created_at', 'updated_at'],
  admin_settings: ['key', 'value', 'updated_at'],
  audit_events: ['id', 'actor_id', 'actor_email', 'event_type', 'metadata', 'created_at'],
  subscribers: ['id', 'email', 'created_at'],
};

async function compareOrCopy(source, target, strict) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (!existsSync(target)) {
    await fs.copyFile(source, target, constants.COPYFILE_EXCL);
    return;
  }
  const digest = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
  if (await digest(source) !== await digest(target)) {
    if (strict) throw new Error(`Media conflict at ${target}; existing file was not overwritten`);
    console.warn(`Keeping existing media file: ${target}`);
  }
}

async function copyMedia(sourceDir, relative = '', strict = true) {
  const entries = await fs.readdir(path.join(sourceDir, relative), { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) count += await copyMedia(sourceDir, next, strict);
    else if (entry.isFile()) {
      await compareOrCopy(path.join(sourceDir, next), path.join(mediaPath, next), strict);
      count++;
    } else throw new Error(`Unsupported item in old upload volume: ${next}`);
  }
  return count;
}

function checkCovers(database) {
  for (const row of database.prepare("SELECT cover_image FROM generated_posts WHERE cover_image LIKE '/covers/%' OR cover_image LIKE '/uploads/%'").all()) {
    const relative = decodeURIComponent(row.cover_image.startsWith('/uploads/')
      ? row.cover_image.slice('/uploads/'.length) : row.cover_image.slice(1));
    if (relative.startsWith('/') || relative.split('/').includes('..') || !existsSync(path.join(mediaPath, relative))) {
      throw new Error(`Post references a missing local cover image: ${row.cover_image}`);
    }
  }
}

async function main() {
  if (!existsSync(path.join(staticAssets, 'covers'))) throw new Error(`Cover images are unavailable at ${staticAssets}`);
  if (existsSync(sqlitePath)) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      const integrity = db.prepare('PRAGMA integrity_check').get();
      const foreignKeyProblems = db.prepare('PRAGMA foreign_key_check').all();
      const presentTables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
      if (integrity.integrity_check !== 'ok' || foreignKeyProblems.length ||
          Object.keys(tables).some((table) => !presentTables.has(table))) {
        throw new Error('Existing db.sqlite3 is invalid or does not contain all imported tables');
      }
      await fs.mkdir(mediaPath, { recursive: true });
      const staticCount = await copyMedia(staticAssets, '', false);
      if (!existsSync(oldUploads)) throw new Error(`Old uploads volume is unavailable at ${oldUploads}`);
      const uploadCount = await copyMedia(oldUploads, '', false);
      checkCovers(db);
      console.log(`Existing db.sqlite3 preserved; static files checked: ${staticCount}; uploaded files checked: ${uploadCount}`);
    } finally {
      db.close();
    }
    return;
  }
  if (existsSync(tempPath)) throw new Error(`${tempPath} exists from an interrupted import; inspect and remove it before retrying`);
  if (!existsSync(oldUploads)) throw new Error(`Old uploads volume is unavailable at ${oldUploads}`);
  for (const key of ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']) {
    if (!process.env[key]) throw new Error(`${key} is required for the one-time PostgreSQL import`);
  }

  const client = new pg.Client({
    host: process.env.PGHOST || 'postgres',
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });
  await client.connect();
  let database;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const table of Object.keys(tables)) {
      const exists = await client.query('SELECT to_regclass($1) AS name', [`public.${table}`]);
      if (!exists.rows[0].name) throw new Error(`Old PostgreSQL table ${table} does not exist. Check the Compose project name and volumes.`);
    }

    await fs.writeFile(tempPath, '', { flag: 'wx' });
    process.env.DATABASE_PATH = tempPath;
    ({ database } = require('../dist/services/db.js'));
    const { createSchema } = require('../dist/services/db.js');
    createSchema();
    database.exec('BEGIN');
    const counts = {};
    for (const [table, columns] of Object.entries(tables)) {
      const result = await client.query(`SELECT ${columns.join(', ')} FROM ${table}`);
      const insert = database.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
      for (const row of result.rows) {
        insert.run(...columns.map((column) => {
          const value = row[column];
          if (value instanceof Date) return value.toISOString();
          if (value !== null && typeof value === 'object') return JSON.stringify(value);
          return value;
        }));
      }
      counts[table] = result.rowCount;
      const importedCount = database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count;
      if (importedCount !== result.rowCount) throw new Error(`Row count mismatch for ${table}`);
    }
    database.exec('COMMIT');
    const integrity = database.prepare('PRAGMA integrity_check').get();
    const fkProblems = database.prepare('PRAGMA foreign_key_check').all();
    if (integrity.integrity_check !== 'ok' || fkProblems.length) throw new Error('SQLite integrity or foreign key check failed');

    await fs.mkdir(mediaPath, { recursive: true });
    const staticCount = await copyMedia(staticAssets);
    const uploadCount = await copyMedia(oldUploads);
    checkCovers(database);
    database.close();
    database = undefined;
    await client.query('COMMIT');
    await fs.rename(tempPath, sqlitePath);
    console.log(`Import complete: ${JSON.stringify(counts)}; static files: ${staticCount}; uploaded files: ${uploadCount}`);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
    throw error;
  } finally {
    if (database) database.close();
    await client.end();
  }
}

main().catch((error) => {
  console.error('PostgreSQL import failed:', error);
  process.exitCode = 1;
});
