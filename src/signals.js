import { getByIdemKey, insertSignal, insertSignalIfAbsent, listSignals, withRetry } from './db.js';
import { checkRateLimit } from './rateLimit.js';

export async function postSignal(req, reply) {
  const idem = req.headers['idempotency-key'] || null;
  const { userId, type, payload } = req.body || {};
  if (!userId || !type || typeof payload === 'undefined') {
    return reply.code(400).send({ error: 'invalid_body' });
  }

  const rateLimit = checkRateLimit(userId);
  if (!rateLimit.allowed) {
    reply.header('Retry-After', String(rateLimit.retryAfter));
    return reply.code(429).send({ error: 'rate_limited' });
  }

  try {
    const createdAt = Date.now();

    if (idem) {
      const info = await withRetry(() => insertSignalIfAbsent(userId, type, payload, idem, createdAt));

      if (info.changes === 0) {
        const existing = await withRetry(() => getByIdemKey(idem));

        if (!existing) {
          throw new Error('idempotency_lookup_failed');
        }

        return reply.code(200).send(existing);
      }

      return reply.code(201).send({
        id: info.lastInsertRowid,
        userId,
        type,
        payload: String(payload),
        idempotencyKey: idem,
        createdAt,
      });
    }

    const info = await withRetry(() => insertSignal(userId, type, payload, null, createdAt));
    return reply.code(201).send({
      id: info.lastInsertRowid,
      userId,
      type,
      payload: String(payload),
      idempotencyKey: null,
      createdAt,
    });
  } catch (e) {
    req.log.error({ err: e, ctx: 'insertSignal' });
    return reply.code(503).send({ error: 'db_unavailable' });
  }
}

export async function getSignals(req, reply) {
  const { userId, limit = 20 } = req.query || {};
  if (!userId) return reply.code(400).send({ error: 'missing_userId' });
  const lim = Math.min(Number(limit) || 20, 100);
  try {
    const rows = await withRetry(() => listSignals(userId, lim));
    return rows;
  } catch (e) {
    req.log.error({ err: e, ctx: 'listSignals' });
    return reply.code(503).send({ error: 'db_unavailable' });
  }
}
