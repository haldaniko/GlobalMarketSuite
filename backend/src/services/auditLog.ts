import { query } from './db';
import { randomUUID } from 'node:crypto';

export async function auditLog(eventType: string, actor?: { id?: string; email?: string } | null, metadata: Record<string, unknown> = {}) {
  await query(
    'INSERT INTO audit_events (id, actor_id, actor_email, event_type, metadata) VALUES ($1, $2, $3, $4, $5)',
    [randomUUID(), actor?.id || null, actor?.email || null, eventType, JSON.stringify(metadata)],
  );
}
