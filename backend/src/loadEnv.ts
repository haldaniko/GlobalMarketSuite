import { existsSync } from 'node:fs';
import path from 'node:path';

const file = path.resolve(__dirname, '../../.env');
if (existsSync(file)) process.loadEnvFile(file);
