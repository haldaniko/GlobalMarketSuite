import { query } from './db';
import { randomUUID } from 'node:crypto';

export async function addSubscriber(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Please enter a valid email address.');
  await query('INSERT INTO subscribers (id, email) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING', [randomUUID(), normalized]);
  return { email: normalized };
}
