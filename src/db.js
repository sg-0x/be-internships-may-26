import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = process.env.DATABASE_URL || './data/signals.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// schema
db.exec(`
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_created ON signals(user_id, created_at);
`);

// failure simulation
function maybeFail() {
  const rate = Number(process.env.DB_FAIL_RATE || 0);
  if (rate > 0 && Math.random() < rate) {
    const err = new Error('simulated_db_failure');
    err.code = 'SQLITE_BUSY';
    throw err;
  }
}

function isTransientDbError(err) {
  if (!err || typeof err.message !== 'string') {
    return false;
  }

  return err.message.includes('SQLITE_BUSY') || err.message.includes('simulated_db_failure');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 50;

  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!isTransientDbError(err) || attempt === maxAttempts - 1) {
        throw err;
      }

      const delay = Math.floor(Math.random() * (baseDelayMs * 2 ** attempt));
      await sleep(delay);
    }
  }

  throw lastError;
}

export function insertSignal(userId, type, payload, idemKey, nowMs) {
  maybeFail();
  const stmt = db.prepare(
    'INSERT INTO signals (user_id, type, payload, idempotency_key, created_at) VALUES (?,?,?,?,?)'
  );
  return stmt.run(userId, type, String(payload), idemKey || null, nowMs);
}

export function getByIdemKey(idemKey) {
  maybeFail();
  const stmt = db.prepare(
    'SELECT id, user_id as userId, type, payload, idempotency_key as idempotencyKey, created_at as createdAt FROM signals WHERE idempotency_key = ?'
  );
  return stmt.get(idemKey);
}

export function insertSignalIfAbsent(userId, type, payload, idemKey, nowMs) {
  maybeFail();
  const stmt = db.prepare(
    'INSERT INTO signals (user_id, type, payload, idempotency_key, created_at) VALUES (?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING'
  );
  return stmt.run(userId, type, String(payload), idemKey, nowMs);
}

export function listSignals(userId, limit) {
  maybeFail();
  const stmt = db.prepare(
    'SELECT id, user_id as userId, type, payload, idempotency_key as idempotencyKey, created_at as createdAt FROM signals WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  );
  return stmt.all(userId, limit);
}

export function countSignals() {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM signals');
  return stmt.get().count;
}

export function countSignalsByIdemKey(idemKey) {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM signals WHERE idempotency_key = ?');
  return stmt.get(idemKey).count;
}
