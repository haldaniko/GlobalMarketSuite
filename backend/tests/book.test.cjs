const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gms-book-test-'));
const bookPath = path.join(root, 'book.pdf');
fs.writeFileSync(bookPath, '%PDF-1.4\ntest book\n%%EOF');
process.env.DATABASE_PATH = path.join(root, 'test.sqlite3');
process.env.NODE_ENV = 'test';
process.env.SITE_URL = 'http://localhost:9005';
process.env.BOOK_TITLE = 'Server-owned title';
process.env.BOOK_PRICE_CENTS = '1900';
process.env.BOOK_CURRENCY = 'eur';
process.env.BOOK_FILE_PATH = bookPath;
process.env.BOOK_DOWNLOAD_MAX_AGE = '86400';
process.env.BOOK_DOWNLOAD_SECRET = 'test-download-secret-that-is-long-enough';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const { createSchema, database } = require('../dist/services/db');
const { createBookRouter, createBookWebhookRouter } = require('../dist/routes/book');
const { createDownloadToken, createPendingOrder } = require('../dist/services/bookStore');
const { errorHandler } = require('../dist/middleware/errorHandler');
createSchema();

let createParams;
let fakeEvent;
const gateway = {
  checkout: {
    sessions: {
      async create(params) {
        createParams = params;
        return { id: 'cs_test_book_1', url: 'https://checkout.stripe.test/session' };
      },
      async retrieve(id) {
        return { id, payment_status: 'unpaid' };
      },
    },
  },
  webhooks: {
    constructEvent(_payload, signature) {
      if (signature !== 'valid-signature') throw new Error('bad signature');
      return fakeEvent;
    },
  },
};

const app = express();
app.use('/api/book/webhook', express.raw({ type: 'application/json' }), createBookWebhookRouter(gateway));
app.use(express.json());
app.use('/api/book', createBookRouter(gateway));
app.use(errorHandler);

after(() => {
  database.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('product and Checkout Session use the server-owned price', async () => {
  const product = await request(app).get('/api/book');
  assert.equal(product.status, 200);
  assert.equal(product.body.data.amountCents, 1900);

  const checkout = await request(app).post('/api/book/checkout').send({ amountCents: 1, currency: 'usd' });
  assert.equal(checkout.status, 201);
  assert.deepEqual(checkout.body.data, { checkoutUrl: 'https://checkout.stripe.test/session' });
  assert.equal(createParams.mode, 'payment');
  assert.equal(createParams.line_items[0].price_data.unit_amount, 1900);
  assert.equal(createParams.line_items[0].price_data.currency, 'eur');
  assert.equal(createParams.success_url, 'http://localhost:9005/book/success?session_id={CHECKOUT_SESSION_ID}');
  assert.ok(createParams.metadata.order_id);

  const order = database.prepare('SELECT * FROM book_orders WHERE stripe_session_id = ?').get('cs_test_book_1');
  assert.equal(order.status, 'pending');
  assert.equal(order.amount_cents, 1900);
});

test('webhook rejects an invalid signature', async () => {
  const response = await request(app).post('/api/book/webhook').set('stripe-signature', 'invalid').set('Content-Type', 'application/json').send('{}');
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Invalid Stripe webhook signature.');
});

test('successful webhook confirmation is idempotent', async () => {
  fakeEvent = {
    id: 'evt_book_paid_1',
    type: 'checkout.session.completed',
    data: { object: {
      id: 'cs_test_book_1',
      payment_status: 'paid',
      payment_intent: 'pi_book_1',
      customer_details: { email: 'reader@example.com' },
    } },
  };
  const send = () => request(app).post('/api/book/webhook').set('stripe-signature', 'valid-signature').set('Content-Type', 'application/json').send('{}');
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200);

  const order = database.prepare('SELECT * FROM book_orders WHERE stripe_session_id = ?').get('cs_test_book_1');
  assert.equal(order.status, 'paid');
  assert.equal(order.payment_intent_id, 'pi_book_1');
  assert.equal(order.email, 'reader@example.com');
  assert.equal(database.prepare('SELECT count(*) AS count FROM stripe_events WHERE event_id = ?').get('evt_book_paid_1').count, 1);
  assert.equal(database.prepare('SELECT count(*) AS count FROM book_orders WHERE stripe_session_id = ?').get('cs_test_book_1').count, 1);
});

test('paid order receives a private PDF attachment', async () => {
  const status = await request(app).get('/api/book/status?session_id=cs_test_book_1');
  assert.equal(status.status, 200);
  assert.equal(status.body.data.status, 'paid');
  assert.match(status.body.data.downloadUrl, /^\/api\/book\/download\?token=/);

  const download = await request(app).get(status.body.data.downloadUrl);
  assert.equal(download.status, 200);
  assert.match(download.headers['content-disposition'], /^attachment; filename="global-market-suite-book.pdf"/);
  assert.equal(download.body.toString(), '%PDF-1.4\ntest book\n%%EOF');
});

test('unpaid, invalid, and expired download links are rejected', async () => {
  const pendingId = createPendingOrder(1900, 'eur');
  const unpaidToken = createDownloadToken(pendingId, 300);
  assert.equal((await request(app).get(`/api/book/download?token=${encodeURIComponent(unpaidToken)}`)).status, 403);
  assert.equal((await request(app).get('/api/book/download?token=invalid')).status, 403);
  const expired = createDownloadToken(createParams.metadata.order_id, -1);
  assert.equal((await request(app).get(`/api/book/download?token=${encodeURIComponent(expired)}`)).status, 403);
});
