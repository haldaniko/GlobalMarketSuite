import crypto from 'node:crypto';
import fs from 'node:fs';

const file = '.env';
const sample = '.env.sample';
const existed = fs.existsSync(file);
const lines = existed
  ? fs.readFileSync(file, 'utf8').split(/\r?\n/)
  : fs.readFileSync(sample, 'utf8').split(/\r?\n/);
const sampleLines = fs.readFileSync(sample, 'utf8').split(/\r?\n/);
const legacyFiles = ['.env.production', 'backend/.env.production', 'backend/.env'];
const legacy = legacyFiles.map((name) => fs.existsSync(name) ? fs.readFileSync(name, 'utf8').split(/\r?\n/) : []);

function get(source, key) {
  const line = source.find((entry) => entry.startsWith(`${key}=`));
  return line?.slice(key.length + 1);
}

function value(key) {
  return get(lines, key);
}

function set(key, next) {
  const index = lines.findIndex((entry) => entry.startsWith(`${key}=`));
  if (index < 0) lines.push(`${key}=${next}`);
  else lines[index] = `${key}=${next}`;
}

for (const line of sampleLines) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue;
  const key = line.slice(0, line.indexOf('='));
  const current = value(key);
  const previous = legacy.map((source) => get(source, key)).find((item) => item && !/^(replace-|change-me)/i.test(item));
  if (previous && (!existed || !current || /^(replace-|change-me)/i.test(current))) set(key, previous);
  else if (current === undefined) lines.push(line);
}

// Compose sets NODE_ENV for each deployment; leaving it in .env changes Vite's build mode.
const nodeEnvIndex = lines.findIndex((entry) => entry.startsWith('NODE_ENV='));
if (nodeEnvIndex >= 0) lines.splice(nodeEnvIndex, 1);

for (const key of ['POSTGRES_PASSWORD', 'JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'BOT_INTEGRATION_TOKEN', 'LOCAL_SUPERADMIN_PASSWORD']) {
  const current = value(key);
  if (!current || /^(replace-|change-me)/i.test(current)) {
    set(key, crypto.randomBytes(48).toString('base64url'));
  }
}

fs.writeFileSync(file, `${lines.join('\n').trimEnd()}\n`, { mode: 0o600 });
console.log('.env is ready. Keep it private; set public URLs for the target deployment.');
