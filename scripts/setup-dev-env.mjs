import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function secret() {
  return crypto.randomBytes(64).toString("base64url");
}

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    values.set(line.slice(0, index), line.slice(index + 1));
  }
  return values;
}

function render(values, order) {
  const keys = [...new Set([...order, ...values.keys()])];
  return `${keys.map((key) => `${key}=${values.get(key) ?? ""}`).join("\n")}\n`;
}

function isPlaceholder(value) {
  return !value || /change-me|replace-with|your-|sk-or-v1-xxx/i.test(value);
}

function readEnv(file) {
  const target = path.join(root, file);
  return fs.existsSync(target) ? parseEnv(fs.readFileSync(target, "utf8")) : new Map();
}

function ensureEnv({ file, example, defaults = {}, generated = {}, inherited = {} }) {
  const target = path.join(root, file);
  const source = path.join(root, example);
  const initial = fs.existsSync(target)
    ? fs.readFileSync(target, "utf8")
    : fs.existsSync(source)
      ? fs.readFileSync(source, "utf8")
      : "";
  const values = parseEnv(initial);
  const order = [...values.keys()];

  for (const [key, value] of Object.entries(defaults)) {
    if (!values.get(key) || values.get(key)?.includes("replace-with")) {
      values.set(key, value);
      order.push(key);
    }
  }

  for (const [key, makeValue] of Object.entries(generated)) {
    const current = values.get(key);
    if (isPlaceholder(current)) {
      values.set(key, makeValue());
      order.push(key);
    }
  }

  for (const [key, value] of Object.entries(inherited)) {
    if (isPlaceholder(values.get(key)) && !isPlaceholder(value)) {
      values.set(key, value);
      order.push(key);
    }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, render(values, order));
  console.log(`Ready: ${file}`);
}

ensureEnv({
  file: ".env",
  example: ".env.example",
  defaults: {
    LOCAL_SUPERADMIN_EMAIL: "admin@globalmarketsuite.local",
    LOCAL_SUPERADMIN_PASSWORD: "MySecretPassword123!"
  }
});

ensureEnv({
  file: "frontend/.env",
  example: "frontend/.env.example",
  defaults: {
    VITE_API_URL: "http://localhost:4000"
  }
});

const rootEnv = readEnv(".env");

ensureEnv({
  file: "backend/.env",
  example: "backend/.env.example",
  defaults: {
    PORT: "4000",
    CORS_ORIGIN: "http://localhost:3000",
    DATABASE_PATH: "/host-data/db.sqlite3",
    OPENROUTER_MODEL: "meta-llama/llama-3.1-8b-instruct",
    OPENROUTER_SITE_URL: "http://localhost:3000",
    OPENROUTER_TIMEOUT_MS: "90000",
    OPENROUTER_MAX_INPUT_CHARS: "16000",
    OPENROUTER_MAX_OUTPUT_TOKENS: "9000",
    OPENROUTER_TEMPERATURE: "0.7",
    SITE_URL: "http://localhost:3000"
  },
  generated: {
    JWT_SECRET: secret,
    REFRESH_TOKEN_SECRET: secret
  },
  inherited: {
    OPENROUTER_API_KEY: rootEnv.get("OPENROUTER_API_KEY")
  }
});

console.log("");
console.log("Dev env is ready. Add root .env OPENROUTER_API_KEY once for real AI generation.");
