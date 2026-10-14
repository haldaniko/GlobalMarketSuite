import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { query } from './db';
import type { User } from '../types';

function mapUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
  };
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const result = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function findUserById(id: string): Promise<User | null> {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function createSuperadmin(email: string, password: string): Promise<User> {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await query(
    `INSERT INTO users (id, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash
     RETURNING *`,
    [randomUUID(), email, passwordHash],
  );
  return mapUser(result.rows[0]);
}
