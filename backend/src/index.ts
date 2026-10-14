import express from 'express';
import path from 'node:path';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { ensureSchema } from './services/db';
import { migrateLegacyDataIfNeeded } from './services/legacyDataMigration';
import { errorHandler } from './middleware/errorHandler';
import { postsRouter } from './routes/posts';
import { subscribersRouter } from './routes/subscribers';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { aiRouter } from './routes/ai';
import { healthIndexRouter } from './routes/healthIndex';
import { startGenerationScheduler } from './services/generationScheduler';

const app = express();
const port = Number(process.env.PORT || 4000);
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
const uploadRoot = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');

app.use(helmet());
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(uploadRoot, { fallthrough: false }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'globalmarketsuite-backend', time: new Date().toISOString() });
});
app.use('/api/posts', postsRouter);
app.use('/api/subscribe', subscribersRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/ai', aiRouter);
app.use('/api/health-index', healthIndexRouter);
app.use(errorHandler);

async function main() {
  await ensureSchema();
  await migrateLegacyDataIfNeeded();
  startGenerationScheduler();
  app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
