import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.API_KEY = 'k';
process.env.DB_FAIL_RATE = '0';
process.env.RATE_LIMIT_PER_MIN = '50';
process.env.DATABASE_URL = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'signals-idempotency-')),
  'signals.db'
);

const { buildApp } = await import('../src/server.js');

const API_KEY = 'k';

test('fresh idempotent insert returns 201 and the second request returns 200 with the same body', async (t) => {
  const app = buildApp({ logger: false });
  const key = `same-key-${Date.now()}`;

  t.after(() => app.close());

  const first = await postSignal(
    app,
    {
      userId: 'user-a',
      type: 'note',
      payload: 'alpha',
    },
    {
      'Idempotency-Key': key,
    }
  );

  const second = await postSignal(
    app,
    {
      userId: 'user-a',
      type: 'note',
      payload: 'alpha',
    },
    {
      'Idempotency-Key': key,
    }
  );

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 200);
  assert.equal(first.body.id, second.body.id);
  assert.equal(first.body.createdAt, second.body.createdAt);
  assert.deepEqual(first.body, second.body);
});

test('concurrent duplicate requests produce a single record', async (t) => {
  const app = buildApp({ logger: false });
  const key = `burst-key-${Date.now()}`;

  t.after(() => app.close());

  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      postSignal(
        app,
        {
          userId: 'user-a',
          type: 'note',
          payload: 'alpha',
        },
        {
          'Idempotency-Key': key,
        }
      )
    )
  );

  const ids = new Set(responses.map((response) => response.body.id));
  const invalidStatuses = responses.filter(
    (response) => response.statusCode !== 201 && response.statusCode !== 200
  );

  assert.equal(ids.size, 1);
  assert.equal(invalidStatuses.length, 0);
});

test('requests without an idempotency key create distinct records', async (t) => {
  const app = buildApp({ logger: false });

  t.after(() => app.close());

  const responses = await Promise.all(
    Array.from({ length: 3 }, (_, index) =>
      postSignal(app, {
        userId: 'user-a',
        type: 'note',
        payload: `alpha-${Date.now()}-${index}`,
      })
    )
  );

  const ids = new Set(responses.map((response) => response.body.id));

  assert.deepEqual(responses.map((response) => response.statusCode), [201, 201, 201]);
  assert.equal(ids.size, 3);
});

test('idempotency key is global and returns the original record for a different user', async (t) => {
  const app = buildApp({ logger: false });
  const key = `global-key-${Date.now()}`;

  t.after(() => app.close());

  const first = await postSignal(
    app,
    {
      userId: 'user-a',
      type: 'note',
      payload: 'alpha',
    },
    {
      'Idempotency-Key': key,
    }
  );

  const second = await postSignal(
    app,
    {
      userId: 'user-b',
      type: 'note',
      payload: 'beta',
    },
    {
      'Idempotency-Key': key,
    }
  );

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 200);
  assert.equal(first.body.id, second.body.id);
  assert.equal(second.body.userId, 'user-a');
  assert.equal(second.body.payload, 'alpha');
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
