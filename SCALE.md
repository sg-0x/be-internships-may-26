## 10k RPS

### Current limits

This version is correct for a single process, but it will not survive sustained 10k RPS. SQLite serializes writes, so the write path becomes the first bottleneck under heavy ingest. The rate limiter is in-process, which means each Node instance would enforce its own counters and users could bypass limits by landing on different nodes. The service also runs as a single Node process, so CPU, memory, and failure isolation are all tied to one instance.

### Database

The next step is PostgreSQL behind a real pool, using `pg` with roughly 20 to 50 connections per app instance depending on CPU and query latency. The current access pattern wants a covering index on `(user_id, created_at DESC)` so recent-per-user reads stay cheap as the table grows. SQLite with WAL is fine for this assignment, but once concurrent writes dominate, Postgres is the practical move. If signal volume becomes large enough that one hot table starts to hurt vacuum or index maintenance, partition by a stable `user_id` hash; if the workload turns into mostly append-heavy time-series queries, TimescaleDB is a better fit than hand-rolled partitions.

### Rate limiting

At scale, the in-memory `Map` has to be replaced with Redis. The right shape is a Lua script that performs `INCR` and `EXPIRE` atomically in one round-trip so the counter and TTL cannot drift apart under concurrency. That keeps behavior correct across many stateless app nodes, and Redis Cluster gives a clear HA path once a single Redis instance becomes operationally risky.

### Idempotency

The current `ON CONFLICT` write pattern already scales horizontally because the database is the source of truth and every node sees the same uniqueness constraint. That means retries and duplicate requests remain safe even when traffic is spread across many app instances. If duplicate traffic becomes common enough to matter, a Redis cache of seen idempotency keys with a 24-hour TTL can short-circuit some reads, but the database still owns correctness.

### Horizontal scale

The app should stay stateless and sit behind a load balancer such as nginx or AWS ALB. Request routing becomes trivial because no node needs local session state; Redis holds rate-limit state and Postgres holds durable signal data and idempotency state. With that split, scaling is mostly adding more Node processes and watching pool pressure, Redis CPU, and downstream write latency.

### Queueing

At sustained 10k RPS, it is reasonable to decouple ingestion from storage. The HTTP tier can validate, authenticate, enforce idempotency, and enqueue to Kafka or SQS, then return `202 Accepted` immediately while workers drain into Postgres. The trade-off is real: tail latency improves and the write path becomes smoother, but the API turns eventually consistent and end-to-end idempotency gets harder because the queue and worker stages now participate in the guarantee.

### Observability

Fastify already gives structured JSON logs through pino, which is enough to start. The next layer is Prometheus metrics for rate-limit rejects, request throughput, DB latency histograms, and retry counts, with alerts on p99 latency above 200 ms and error rate above 0.1%. Those two alerts usually tell you first whether the system is saturating, whether the database is backing up, or whether a retry storm is hiding a deeper dependency problem.
