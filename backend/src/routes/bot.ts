import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import slugify from 'slugify';
import { database } from '../services/db';
import { sanitizeArticleHtml } from '../services/htmlSanitizer';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';

export const botRouter = Router();
const category = { slug: 'marketing-intelligence', name: 'Market Intelligence' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uploadRoot = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
}).single('image');
const receiveImage: RequestHandler = (req, res, next) => {
  imageUpload(req, res, (error) => {
    if (error instanceof multer.MulterError) return next(new HttpError(400, 'Invalid image upload'));
    next(error);
  });
};

function siteUrl() {
  const value = process.env.SITE_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('SITE_URL must be an absolute public URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('SITE_URL must be a public HTTPS URL in production');
  }
  return url.origin;
}

function authorized(header: string | undefined) {
  const secret = process.env.BOT_INTEGRATION_TOKEN || '';
  const match = /^Bearer (.+)$/.exec(header || '');
  if (!secret || !match) return false;
  const actual = Buffer.from(match[1]);
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

botRouter.use((req, _res, next) => {
  if (!authorized(req.get('Authorization'))) return next(new HttpError(403, 'Forbidden'));
  next();
});

function externalId(value: string) {
  if (!uuidPattern.test(value)) throw new HttpError(400, 'Invalid external_id');
  return value.toLowerCase();
}

function article(external: string) {
  const row = database.prepare(`SELECT p.id, p.slug, p.status, p.cover_image
    FROM bot_articles b JOIN generated_posts p ON p.id = b.post_id WHERE b.external_id = ?`).get(external) as
    { id: string; slug: string; status: string; cover_image: string | null } | undefined;
  if (!row) throw new HttpError(404, 'Article not found');
  const origin = siteUrl();
  return {
    article_id: row.id,
    status: row.status,
    url: `${origin}/articles/${encodeURIComponent(row.slug)}`,
    image_url: row.cover_image?.startsWith('/uploads/covers/bot-') ? new URL(row.cover_image, origin).href : null,
  };
}

function text(value: unknown, max: number, required: boolean, field: string) {
  if (value === undefined || value === null) {
    if (!required) return '';
    throw new HttpError(400, `${field} is required`);
  }
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new HttpError(400, `Invalid ${field}`);
  }
  return value.trim();
}

function payload(body: any) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid JSON payload');
  const id = externalId(body.external_id);
  const title = text(body.title, 300, true, 'title');
  const content = text(body.content, 100_000, true, 'content');
  const summary = text(body.summary, 1000, false, 'summary');
  if (!Array.isArray(body.category_slugs) || body.category_slugs.length !== 1 || body.category_slugs[0] !== category.slug) {
    throw new HttpError(400, 'Invalid category_slugs');
  }
  if (body.author_slug !== undefined && body.author_slug !== null) throw new HttpError(400, 'Invalid author_slug');
  const tags = body.tag_names === undefined ? [] : body.tag_names;
  if (!Array.isArray(tags) || tags.length > 10 || tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 80)) {
    throw new HttpError(400, 'Invalid tag_names');
  }
  return { id, title, content, summary, category_slug: category.slug, author_slug: null, tags: tags.map((tag: string) => tag.trim()) };
}

function contentHtml(content: string) {
  // The Telegram editor sends plain text. Escape it before turning paragraphs into HTML.
  return sanitizeArticleHtml(content.split(/\n\s*\n/).map((part) =>
    `<p>${part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`,
  ).join(''));
}

function immediate<T>(work: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

botRouter.get('/options/', (_req, res) => {
  res.json({ version: 1, site: 'globalmarketsuite', categories: [category], authors: [] });
});

botRouter.post('/articles/', (req, res) => {
  const data = payload(req.body);
  const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  let created = false;
  immediate(() => {
    const existing = database.prepare('SELECT payload_hash FROM bot_articles WHERE external_id = ?').get(data.id) as { payload_hash: string } | undefined;
    if (existing) {
      if (existing.payload_hash !== hash) throw new HttpError(409, 'Conflicting article payload');
      return;
    }
    const slug = `${slugify(data.title, { lower: true, strict: true, trim: true }).slice(0, 120) || 'article'}-${data.id}`;
    const postId = randomUUID();
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO generated_posts
      (id, slug, title, excerpt, content_html, status, author, tags, cover_image, source, category_slug, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'draft', 'Editorial team', ?, '/covers/market-map.svg', 'bot', ?, ?, ?)`).run(
      postId, slug, data.title, data.summary, contentHtml(data.content), JSON.stringify(data.tags), data.category_slug, now, now,
    );
    database.prepare('INSERT INTO bot_articles (external_id, post_id, payload_hash) VALUES (?, ?, ?)').run(data.id, postId, hash);
    created = true;
  });
  res.status(created ? 201 : 200).json(article(data.id));
});

botRouter.get('/articles/:externalId/', (req, res) => {
  res.json(article(externalId(req.params.externalId)));
});

botRouter.put('/articles/:externalId/image/', receiveImage, asyncHandler(async (req, res) => {
  const id = externalId(req.params.externalId);
  const current = article(id);
  if (current.image_url) return res.json(current);
  if (current.status !== 'draft') throw new HttpError(409, 'Article is already published');
  if (!req.file?.buffer?.length) throw new HttpError(400, 'Image is required');
  const bytes = req.file.buffer;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!jpg && !png && !webp) throw new HttpError(400, 'Only JPG, PNG, and WebP images are supported');
  let output: Buffer;
  try { output = await sharp(bytes, { limitInputPixels: 40_000_000 }).webp().toBuffer(); }
  catch { throw new HttpError(400, 'Invalid image'); }
  const relative = `/uploads/covers/bot-${id}.webp`;
  const target = path.join(uploadRoot, 'covers', `bot-${id}.webp`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  immediate(() => {
    const latest = article(id);
    if (latest.image_url) return;
    if (latest.status !== 'draft') throw new HttpError(409, 'Article is already published');
    // Synchronous write keeps the file and SQLite update inside the process's write lock.
    writeFileSync(target, output);
    database.prepare(`UPDATE generated_posts SET cover_image = ?, updated_at = ?
      WHERE id = (SELECT post_id FROM bot_articles WHERE external_id = ?)`).run(relative, new Date().toISOString(), id);
  });
  res.json(article(id));
}));

botRouter.post('/articles/:externalId/publish/', (req, res) => {
  const id = externalId(req.params.externalId);
  immediate(() => {
    const current = article(id);
    if (current.status === 'published') return;
    if (current.status !== 'draft') throw new HttpError(409, 'Article cannot be published');
    database.prepare(`UPDATE generated_posts SET status = 'published', updated_at = ?
      WHERE id = (SELECT post_id FROM bot_articles WHERE external_id = ?)`).run(new Date().toISOString(), id);
  });
  res.json(article(id));
});
