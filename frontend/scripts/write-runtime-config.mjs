import { writeFileSync } from 'node:fs';

const apiUrl = process.env.VITE_API_URL?.trim().replace(/\/+$/, '');
if (!apiUrl) throw new Error('VITE_API_URL is required in .env.production');

writeFileSync('dist/runtime-config.js', `window.__GMS_CONFIG__ = ${JSON.stringify({ apiUrl })};\n`);
