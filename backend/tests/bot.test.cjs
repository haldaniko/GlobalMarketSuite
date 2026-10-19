const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const sharp = require('sharp');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gms-bot-test-'));
process.env.DATABASE_PATH = path.join(root, 'test.sqlite3');
process.env.UPLOAD_DIR = path.join(root, 'uploads');
process.env.SITE_URL = 'http://localhost:3000';
process.env.BOT_INTEGRATION_TOKEN = 'test-bot-token';
process.env.NODE_ENV = 'test';
const { createSchema, database } = require('../dist/services/db');
const { botRouter } = require('../dist/routes/bot');
const { postsRouter } = require('../dist/routes/posts');
const { errorHandler } = require('../dist/middleware/errorHandler');
createSchema();
const app = express();
app.use(express.json());
app.use('/uploads', express.static(process.env.UPLOAD_DIR));
app.use('/api/bot/v1', botRouter);
app.use('/api/posts', postsRouter);
app.use(errorHandler);
const auth = { Authorization: 'Bearer test-bot-token' };
const id = 'e580807e-4e42-49e8-9cc2-43c888a069ec';
const payload = { external_id: id, title: 'Telegram test article', content: 'First paragraph\n\nSecond paragraph', summary: 'Summary', category_slugs: ['marketing-intelligence'], author_slug: null, tag_names: ['test'] };

after(() => {
  database.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('authentication and category options', async () => {
  assert.equal((await request(app).get('/api/bot/v1/options/')).status, 403);
  assert.equal((await request(app).get('/api/bot/v1/options/').set('Authorization', 'Bearer wrong')).status, 403);
  process.env.BOT_INTEGRATION_TOKEN = '';
  assert.equal((await request(app).get('/api/bot/v1/options/').set(auth)).status, 403);
  process.env.BOT_INTEGRATION_TOKEN = 'test-bot-token';
  const response = await request(app).get('/api/bot/v1/options/').set(auth);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.categories, [{ slug: 'marketing-intelligence', name: 'Market Intelligence' }]);
  assert.deepEqual(response.body.authors, []);
});

test('draft, concurrent retry, conflict, recovery, image and publication', async () => {
  const url = '/api/bot/v1/articles/';
  assert.equal((await request(app).post(url).set(auth).send({ ...payload, category_slugs: ['missing'] })).status, 400);
  const [first, second] = await Promise.all([
    request(app).post(url).set(auth).send(payload),
    request(app).post(url).set(auth).send(payload),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 201]);
  assert.equal(first.body.article_id, second.body.article_id);
  assert.equal(first.body.status, 'draft');
  assert.equal(first.body.image_url, null);
  assert.equal((await request(app).get('/api/posts/')).body.data.some((p) => p.id === first.body.article_id), false);
  assert.equal((await request(app).post(url).set(auth).send({ ...payload, title: 'Changed' })).status, 409);
  assert.equal((await request(app).get(`${url}${id}/`).set(auth)).body.article_id, first.body.article_id);
  assert.equal((await request(app).get(`${url}00000000-0000-4000-8000-000000000000/`).set(auth)).status, 404);

  const imageUrl = `${url}${id}/image/`;
  assert.equal((await request(app).put(imageUrl).set(auth).attach('image', Buffer.from('not an image'), 'bad.png')).status, 400);
  assert.equal((await request(app).put(imageUrl).set(auth).attach('image', Buffer.alloc(10 * 1024 * 1024 + 1), 'huge.png')).status, 400);
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
  const uploaded = await request(app).put(imageUrl).set(auth).attach('image', image, 'cover.png');
  assert.equal(uploaded.status, 200);
  assert.match(uploaded.body.image_url, /^http:\/\/localhost:3000\/uploads\/covers\/bot-/);
  const again = await request(app).put(imageUrl).set(auth).attach('image', image, 'cover.png');
  assert.deepEqual(again.body, uploaded.body);
  assert.equal(fs.readdirSync(path.join(root, 'uploads', 'covers')).length, 1);
  assert.equal((await request(app).get(new URL(uploaded.body.image_url).pathname)).status, 200);

  const publish = await request(app).post(`${url}${id}/publish/`).set(auth);
  assert.equal(publish.status, 200);
  assert.equal(publish.body.status, 'published');
  assert.match(publish.body.url, /^http:\/\/localhost:3000\/articles\//);
  const repeat = await request(app).post(`${url}${id}/publish/`).set(auth);
  assert.deepEqual(repeat.body, publish.body);
  assert.deepEqual((await request(app).put(imageUrl).set(auth).attach('image', image, 'cover.png')).body, publish.body);
  assert.equal((await request(app).get('/api/posts/')).body.data.some((p) => p.id === first.body.article_id), true);
  const slug = new URL(publish.body.url).pathname.split('/').pop();
  const publicPost = await request(app).get(`/api/posts/${slug}`);
  assert.equal(publicPost.status, 200);
  assert.equal(publicPost.body.data.coverImage, `/uploads/covers/bot-${id}.webp`);
  assert.equal((await request(app).post(url).set(auth).send(payload)).body.status, 'published');
  assert.equal((await request(app).post(`${url}00000000-0000-4000-8000-000000000000/publish/`).set(auth)).status, 404);
  const noImageId = 'a9089546-30b5-4f3d-8487-b40e55d2fd92';
  assert.equal((await request(app).post(url).set(auth).send({ ...payload, external_id: noImageId })).status, 201);
  assert.equal((await request(app).post(`${url}${noImageId}/publish/`).set(auth)).status, 200);
  assert.equal((await request(app).put(`${url}${noImageId}/image/`).set(auth).attach('image', image, 'cover.png')).status, 409);
});
