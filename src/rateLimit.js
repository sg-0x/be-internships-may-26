const WINDOW_MS = 60_000;
const windows = new Map();

let nowFn = Date.now;

function getLimit() {
  const value = Number(process.env.RATE_LIMIT_PER_MIN || 5);
  return Number.isInteger(value) && value > 0 ? value : 5;
}

function pruneExpired(now) {
  for (const [userId, entry] of windows) {
    if (entry.expiresAt <= now) {
      windows.delete(userId);
    }
  }
}

export function checkRateLimit(userId) {
  const now = nowFn();
  const limit = getLimit();

  pruneExpired(now);

  // Redis INCR/EXPIRE belongs here once this needs to work across instances.
  const entry = windows.get(userId);

  if (!entry || entry.expiresAt <= now) {
    windows.set(userId, { count: 1, expiresAt: now + WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= limit) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)),
    };
  }

  entry.count += 1;
  return { allowed: true };
}

export function _setNowFn(fn) {
  nowFn = typeof fn === 'function' ? fn : Date.now;
}
