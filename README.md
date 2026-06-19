# Signals Service

## Setup

1. `npm install`
2. `cp .env.example .env`
3. `node src/server.js`

The service listens on `PORT` and stores data in the SQLite database configured by `DATABASE_URL`.

## Endpoints

| Method | Path | Required headers | Notes | Response codes |
| --- | --- | --- | --- | --- |
| `GET` | `/healthz` | none | Liveness check | `200` |
| `POST` | `/v1/signals` | `X-API-Key` | Accepts `{ "userId": "string", "type": "string", "payload": "string" }`. Optional `Idempotency-Key` returns the original resource on duplicate requests. | `201`, `200`, `400`, `401`, `429`, `503` |
| `GET` | `/v1/signals?userId=...&limit=...` | `X-API-Key` | Lists recent signals for one user. `limit` defaults to `20` and is capped at `100`. | `200`, `400`, `401`, `503` |

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_KEY` | `change-me` | Shared key required on all non-health routes |
| `PORT` | `8080` | HTTP listen port |
| `DATABASE_URL` | `./data/signals.db` | SQLite database path |
| `RATE_LIMIT_PER_MIN` | `5` | Fixed-window limit per `userId` |
| `DB_FAIL_RATE` | `0` | Simulated transient DB failure rate for testing retry behavior |

## Running Tests

Run `node --test`.

## Design Decisions

Idempotency is enforced at the database layer with a unique constraint and `ON CONFLICT DO NOTHING`, which avoids the usual read-before-write race and makes retries safe. Transient database failures go through a small retry wrapper with exponential backoff and full jitter, but only for errors that look temporary, so constraint errors still fail fast. The rate limiter is a fixed window in process because it is simple and deterministic for one Node instance, and the code marks the exact point where it can be replaced with Redis when the service needs to run across many instances.
