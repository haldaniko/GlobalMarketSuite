import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { database } from './db';

export type BookOrder = {
  id: string;
  stripeSessionId: string | null;
  paymentIntentId: string | null;
  email: string | null;
  amountCents: number;
  currency: string;
  status: 'pending' | 'paid';
  createdAt: string;
  paidAt: string | null;
};

type OrderRow = {
  id: string;
  stripe_session_id: string | null;
  payment_intent_id: string | null;
  email: string | null;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'paid';
  created_at: string;
  paid_at: string | null;
};

function mapOrder(row: OrderRow | undefined): BookOrder | null {
  if (!row) return null;
  return {
    id: row.id,
    stripeSessionId: row.stripe_session_id,
    paymentIntentId: row.payment_intent_id,
    email: row.email,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

export function createPendingOrder(amountCents: number, currency: string) {
  const id = randomUUID();
  database.prepare('INSERT INTO book_orders (id, amount_cents, currency) VALUES (?, ?, ?)').run(id, amountCents, currency);
  return id;
}

export function attachStripeSession(orderId: string, sessionId: string) {
  database.prepare('UPDATE book_orders SET stripe_session_id = ? WHERE id = ? AND stripe_session_id IS NULL').run(sessionId, orderId);
}

export function deleteUnstartedOrder(orderId: string) {
  database.prepare('DELETE FROM book_orders WHERE id = ? AND stripe_session_id IS NULL AND status = ?').run(orderId, 'pending');
}

export function getOrderBySession(sessionId: string) {
  return mapOrder(database.prepare('SELECT * FROM book_orders WHERE stripe_session_id = ?').get(sessionId) as OrderRow | undefined);
}

export function markOrderPaid(input: { eventId?: string; eventType?: string; sessionId: string; paymentIntentId?: string | null; email?: string | null }) {
  database.exec('BEGIN IMMEDIATE');
  try {
    if (input.eventId) {
      const inserted = database.prepare('INSERT OR IGNORE INTO stripe_events (event_id, event_type) VALUES (?, ?)')
        .run(input.eventId, input.eventType || 'unknown');
      if (inserted.changes === 0) {
        database.exec('COMMIT');
        return false;
      }
    }
    database.prepare(`UPDATE book_orders
      SET status = 'paid', payment_intent_id = COALESCE(?, payment_intent_id),
          email = COALESCE(?, email), paid_at = COALESCE(paid_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      WHERE stripe_session_id = ?`).run(input.paymentIntentId || null, input.email || null, input.sessionId);
    database.exec('COMMIT');
    return true;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function downloadSecret() {
  const secret = process.env.BOOK_DOWNLOAD_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('BOOK_DOWNLOAD_SECRET is not configured');
  return secret;
}

function signature(value: string) {
  return createHmac('sha256', downloadSecret()).update(value).digest('base64url');
}

export function createDownloadToken(orderId: string, maxAgeSeconds: number) {
  const expires = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const payload = `${orderId}.${expires}`;
  return `${payload}.${signature(payload)}`;
}

export function verifyDownloadToken(token: string) {
  const [orderId, expiresRaw, provided] = token.split('.');
  const expires = Number(expiresRaw);
  if (!orderId || !provided || !Number.isInteger(expires) || expires <= Math.floor(Date.now() / 1000)) return null;
  const expected = signature(`${orderId}.${expires}`);
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return orderId;
}

export function getPaidOrder(orderId: string) {
  return mapOrder(database.prepare("SELECT * FROM book_orders WHERE id = ? AND status = 'paid'").get(orderId) as OrderRow | undefined);
}
