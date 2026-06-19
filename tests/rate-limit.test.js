import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.API_KEY = 'k';
process.env.DB_FAIL_RATE = '0';
process.env.DATABASE_URL = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'signals-rate-limit-')),
  'signals.db'
);

const { buildApp } = await import('../src/server.js');
const { _setNowFn, checkRateLimit } = await import('../src/rateLimit.js');

const API_KEY = 'k';
const RATE_LIMIT_PER_MIN = 5;

test('first N requests succeed and N+1 returns 429 with Retry-After', async (t) => {
  process.env.RATE_LIMIT_PER_MIN = String(RATE_LIMIT_PER_MIN);

  const app = buildApp({ logger: false });
  const userId = `user-a-${Date.now()}`;

  t.after(() => app.close());

  for (let i = 0; i < RATE_LIMIT_PER_MIN; i += 1) {
    const response = await postSignal(app, {
      userId,
      type: 'note',
      payload: `payload-${i}`,
    });

    assert.equal(response.statusCode, 201);
  }

  const blocked = await postSignal(app, {
    userId,
    type: 'note',
    payload: 'payload-blocked',
  });

  assert.equal(blocked.statusCode, 429);
  assert.match(blocked.headers['retry-after'] || '', /^\d+$/);
});

test('different users have independent windows', async (t) => {
  process.env.RATE_LIMIT_PER_MIN = String(RATE_LIMIT_PER_MIN);

  const app = buildApp({ logger: false });
  const blockedUser = `user-a-${Date.now()}`;
  const allowedUser = `user-b-${Date.now()}`;

  t.after(() => app.close());

  for (let i = 0; i < RATE_LIMIT_PER_MIN; i += 1) {
    const response = await postSignal(app, {
      userId: blockedUser,
      type: 'note',
      payload: `payload-${i}`,
    });

    assert.equal(response.statusCode, 201);
  }

  const blocked = await postSignal(app, {
    userId: blockedUser,
    type: 'note',
    payload: 'payload-blocked',
  });
  const allowed = await postSignal(app, {
    userId: allowedUser,
    type: 'note',
    payload: 'payload-allowed',
  });

  assert.equal(blocked.statusCode, 429);
  assert.equal(allowed.statusCode, 201);
});

test('burst concurrency allows exactly the configured limit', async (t) => {
  process.env.RATE_LIMIT_PER_MIN = String(RATE_LIMIT_PER_MIN);

  const app = buildApp({ logger: false });
  const userId = `burst-user-${Date.now()}`;

  t.after(() => app.close());

  const responses = await Promise.all(
    Array.from({ length: RATE_LIMIT_PER_MIN + 3 }, (_, index) =>
      postSignal(app, {
        userId,
        type: 'note',
        payload: `payload-${index}`,
      })
    )
  );

  const counts = responses.reduce(
    (acc, response) => {
      acc[response.statusCode] = (acc[response.statusCode] || 0) + 1;
      return acc;
    },
    {}
  );

  assert.equal(counts[201], RATE_LIMIT_PER_MIN);
  assert.equal(counts[429], 3);
});

test('rate limit resets after the window expires', () => {
  process.env.RATE_LIMIT_PER_MIN = '2';

  let now = 1_000;
  const userId = `reset-user-${Date.now()}`;

  _setNowFn(() => now);

  assert.equal(checkRateLimit(userId).allowed, true);
  assert.equal(checkRateLimit(userId).allowed, true);

  const blocked = checkRateLimit(userId);
  assert.equal(blocked.allowed, false);
  assert.equal(typeof blocked.retryAfter, 'number');

  now += 60_000;

  assert.equal(checkRateLimit(userId).allowed, true);

  _setNowFn();
});

async function postSignal(app, body, headers = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/signals',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      ...headers,
    },
    payload: body,
  });

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.json(),
  };
}
