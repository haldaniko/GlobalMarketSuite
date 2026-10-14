import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const email = process.env.LOCAL_SUPERADMIN_EMAIL || process.env.SUPERADMIN_EMAIL || 'admin@globalmarketsuite.local';
const password = process.env.LOCAL_SUPERADMIN_PASSWORD || process.env.SUPERADMIN_PASSWORD || 'MySecretPassword123!';
const databasePath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'db.sqlite3');
mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`);

const passwordHash = await bcrypt.hash(password, 12);
database.prepare(`INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'admin')
  ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash`).run(randomUUID(), email, passwordHash);
database.close();
console.log(`Superadmin ready: ${email}`);
