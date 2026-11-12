import { existsSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import Stripe from 'stripe';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import {
  attachStripeSession,
  createDownloadToken,
  createPendingOrder,
  deleteUnstartedOrder,
  getOrderBySession,
  getPaidOrder,
  markOrderPaid,
  verifyDownloadToken,
} from '../services/bookStore';

export type StripeGateway = {
  checkout: { sessions: {
    create(params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session>;
    retrieve(id: string): Promise<Stripe.Checkout.Session>;
  } };
  webhooks: { constructEvent(payload: Buffer, signature: string, secret: string): Stripe.Event };
};

let stripeClient: StripeGateway | null = null;
function stripe(): StripeGateway {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new HttpError(503, 'Book checkout is not configured yet.');
  if (!stripeClient) stripeClient = new Stripe(key);
  return stripeClient;
}

function config() {
  const amountCents = Number(process.env.BOOK_PRICE_CENTS || 1900);
  const currency = (process.env.BOOK_CURRENCY || 'eur').toLowerCase();
  if (!Number.isInteger(amountCents) || amountCents < 50) throw new Error('BOOK_PRICE_CENTS must be a valid integer');
  return {
    title: process.env.BOOK_TITLE || '[НАЗВАНИЕ КНИГИ]',
    author: process.env.BOOK_AUTHOR || '[ИМЯ АВТОРА]',
    amountCents,
    currency,
    maxAge: Number(process.env.BOOK_DOWNLOAD_MAX_AGE || 86400),
    filePath: process.env.BOOK_FILE_PATH || path.resolve(process.cwd(), 'private/book.pdf'),
    siteUrl: (process.env.SITE_URL || 'http://localhost:9005').replace(/\/+$/, ''),
  };
}

function sessionDetails(session: Stripe.Checkout.Session) {
  return {
    sessionId: session.id,
    paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
    email: session.customer_details?.email || session.customer_email || null,
  };
}

export function createBookRouter(gateway?: StripeGateway) {
  const router = Router();
  const client = () => gateway || stripe();

  router.get('/', (_req, res) => {
    const book = config();
    res.json({ data: { title: book.title, author: book.author, amountCents: book.amountCents, currency: book.currency } });
  });

  router.post('/checkout', asyncHandler(async (_req, res) => {
    const book = config();
    const orderId = createPendingOrder(book.amountCents, book.currency);
    try {
      const session = await client().checkout.sessions.create({
        mode: 'payment',
        customer_creation: 'always',
        line_items: [{
          quantity: 1,
          price_data: {
            currency: book.currency,
            unit_amount: book.amountCents,
            product_data: { name: book.title, description: 'Digital book · PDF · instant access' },
          },
        }],
        metadata: { order_id: orderId },
        payment_intent_data: { metadata: { order_id: orderId } },
        success_url: `${book.siteUrl}/book/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${book.siteUrl}/#book`,
      });
      if (!session.url) throw new Error('Stripe did not return a checkout URL');
      attachStripeSession(orderId, session.id);
      res.status(201).json({ data: { checkoutUrl: session.url } });
    } catch (error) {
      deleteUnstartedOrder(orderId);
      throw error;
    }
  }));

  router.get('/status', asyncHandler(async (req, res) => {
    const sessionId = String(req.query.session_id || '');
    if (!sessionId) throw new HttpError(400, 'Missing Checkout Session ID.');
    let order = getOrderBySession(sessionId);
    if (!order) throw new HttpError(404, 'Order not found.');

    if (order.status === 'pending') {
      const session = await client().checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid') {
        markOrderPaid({ ...sessionDetails(session), sessionId });
        order = getOrderBySession(sessionId);
      }
    }

    if (order?.status !== 'paid') {
      res.json({ data: { status: 'pending' } });
      return;
    }
    const token = createDownloadToken(order.id, config().maxAge);
    res.json({ data: { status: 'paid', downloadUrl: `/api/book/download?token=${encodeURIComponent(token)}` } });
  }));

  router.get('/download', (req, res, next) => {
    try {
      const orderId = verifyDownloadToken(String(req.query.token || ''));
      if (!orderId) throw new HttpError(403, 'This download link is invalid or has expired.');
      if (!getPaidOrder(orderId)) throw new HttpError(403, 'Payment has not been confirmed.');
      const filePath = config().filePath;
      if (!existsSync(filePath)) throw new HttpError(503, 'The book file is temporarily unavailable.');
      res.download(filePath, 'global-market-suite-book.pdf');
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createBookWebhookRouter(gateway?: StripeGateway) {
  const router = Router();
  const client = () => gateway || stripe();
  router.post('/', asyncHandler(async (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new HttpError(503, 'Stripe webhook is not configured.');
    const signature = req.header('stripe-signature');
    if (!signature) throw new HttpError(400, 'Missing Stripe signature.');
    let event: Stripe.Event;
    try {
      event = client().webhooks.constructEvent(req.body as Buffer, signature, secret);
    } catch {
      throw new HttpError(400, 'Invalid Stripe webhook signature.');
    }
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === 'paid' || event.type === 'checkout.session.async_payment_succeeded') {
        markOrderPaid({ eventId: event.id, eventType: event.type, ...sessionDetails(session) });
      }
    }
    res.json({ received: true });
  }));
  return router;
}

export const bookRouter = createBookRouter();
export const bookWebhookRouter = createBookWebhookRouter();
