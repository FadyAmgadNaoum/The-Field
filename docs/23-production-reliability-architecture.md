# Production Reliability and Scalability Architecture
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** FINAL — Upgrades the deployment architecture defined in Docs 15 and 22  
**Scope:** Version 1 — Single venue (The Field). No multi-venue, no marketplace.

---

## Governing Principles

Before any section: the following principles override infrastructure preference at every decision point.

1. **Data integrity above uptime.** It is better to return a controlled error to a customer than to confirm a booking without database confirmation. Never sacrifice booking correctness for availability.
2. **Stateless application, stateful database.** Application servers are disposable. The database and object storage are not.
3. **Scale incrementally.** Start with the minimum infrastructure that provides adequate reliability. Add redundancy when traffic measurement justifies it — not in anticipation of theoretical load.
4. **Honest failure.** Every failure mode is documented. No provider is assumed to be infallible.
5. **Single venue, V1 scope.** This architecture is for The Field only. Every decision is sized accordingly.

---

## Section 1: High Availability Architecture

### 1.1 Target Architecture — Full Picture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CUSTOMERS                                                               │
│  (Egyptian mobile users, browsers, WhatsApp referrals)                  │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │ DNS: thefield.eg → Cloudflare anycast IP
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE (Edge Layer)                                                 │
│  • DNS with sub-5-minute TTL for failover                                │
│  • TLS termination (TLS 1.3, ECDSA cert)                                │
│  • WAF: OWASP core ruleset enabled                                       │
│  • DDoS protection: automatic (free + Pro tier)                         │
│  • CDN: caches /public/*, /_next/static/*, gallery media                │
│  • Rate limiting rules (booking endpoint, login endpoint)               │
│  • Bot management: basic (Pro tier)                                     │
│  • Cache-Control bypass: /api/*, /admin/*, /booking-status              │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │ HTTPS to origin (full strict mode)
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  HOSTINGER VPS — NGINX (Reverse Proxy + Load Balancer)                  │
│  Single VPS in V1 initial deployment.                                    │
│  Upgraded to two VPS nodes at Tier 3 (see Section 11).                  │
│                                                                         │
│  • Upstream: app_servers { server 127.0.0.1:3000; server 127.0.0.1:3001; }
│  • (V1 initial: one upstream; V1 production: two upstreams)             │
│  • Health checks: active health check every 5s                          │
│  • Unhealthy threshold: 2 consecutive failures → remove from rotation   │
│  • Liveness probe: GET /api/health/live                                 │
│  • Readiness probe: GET /api/health/ready                               │
│  • Connection draining: 30s grace on upstream removal                   │
└──────────────┬──────────────────────────┬──────────────────────────────┘
               │                          │
    ┌──────────▼──────────┐    ┌──────────▼──────────┐
    │  App Instance A      │    │  App Instance B      │
    │  PM2 / Node.js       │    │  PM2 / Node.js       │
    │  Port 3000           │    │  Port 3001           │
    │  STATELESS           │    │  STATELESS           │
    │  No local state      │    │  No local state      │
    └──────────┬───────────┘    └──────────┬───────────┘
               │                          │
               └──────────┬───────────────┘
                          │  All instances share:
          ┌───────────────▼────────────────┐
          │  MANAGED POSTGRESQL            │
          │  (Neon / Supabase / Aiven)     │
          │  • Primary write endpoint      │
          │  • Read replica (Tier 3)       │
          │  • PgBouncer connection pool   │
          │  • Automated backups           │
          │  • Point-in-time recovery      │
          │  • Automatic failover          │
          └────────────────────────────────┘
                          │
          ┌───────────────▼────────────────┐
          │  CLOUDFLARE R2                 │
          │  • thefield-private (proofs)   │
          │  • thefield-public (media)     │
          │  • thefield-backups (DB dumps) │
          │  Built-in 11-nines durability  │
          └────────────────────────────────┘

Supporting services (external, not on VPS):
  ┌──────────────────────────────────────────────────────┐
  │  Sentry (error + perf)  │  UptimeRobot (uptime)      │
  │  Logtail/Axiom (logs)   │  GitHub Actions (CI/CD)    │
  └──────────────────────────────────────────────────────┘
```

### 1.2 What Makes Each Layer Redundant

| Layer | V1 Initial | V1 Production | Tier 3 (HA) |
|-------|-----------|---------------|-------------|
| DNS | Cloudflare (highly available) | Same | Same |
| Edge/CDN | Cloudflare (global PoP) | Same | Same |
| Load balancer | NGINX on single VPS | Same | NGINX on each node |
| App instances | 1 PM2 process | 2 PM2 processes (ports 3000, 3001) | 2+ nodes on separate VPS |
| Database | Managed PG (single primary) | Same + daily backups | Managed PG with standby replica |
| Object storage | Cloudflare R2 (built-in redundancy) | Same | Same |
| Sessions | Cookie-based (stateless) | Same | Same |
| Background jobs | 1 cron process per node (coordinated — see Section 1.4) | Same | DB-locked job runner |

### 1.3 Stateless Application Design — Mandatory Requirements

Every application instance must be fully stateless. This means:

**What must NOT live on the local application server:**

| Data | Current risk | Correct location |
|------|-------------|-----------------|
| Payment proof files | Local disk → lost on rebuild | Cloudflare R2 (private bucket) |
| Gallery / CMS images | Local disk → lost on rebuild | Cloudflare R2 (public bucket) |
| User/admin sessions | In-memory → not shared across instances | iron-session encrypted cookies (client-side, no server store) |
| Booking state | Any in-memory cache → stale | PostgreSQL only |
| Rate limiter state | In-memory (`RateLimiterMemory`) | Must migrate to Redis at Tier 3 |
| Cron job lock | Single process assumption | DB-based coordination at Tier 3 |

**iron-session is already stateless.** Session data is encrypted inside the cookie and decrypted on each request. No shared session store is needed. This is a correct V1 design choice that scales to N instances without modification.

**Rate limiter migration path (V1 → Tier 3):**  
`RateLimiterMemory` is acceptable for V1 (1–2 instances) because rate limits are approximate — a request may slip through if it hits a different instance. At Tier 3 with true horizontal scaling, replace with `RateLimiterRedis` backed by a small managed Redis instance (Upstash Redis, ~$0/month on free tier for this volume). The `rate-limiter-flexible` library supports both backends behind the same interface — no other code changes required.

### 1.4 Background Job Coordination (Multi-Instance Safety)

The booking expiry job (`node-cron`) runs inside the Node.js process. With multiple instances, both would run independently and both would attempt to expire the same bookings.

**Why this is safe in V1 (1–2 instances):**  
The expiry UPDATE query is:
```sql
UPDATE bookings
SET status = 'expired', updated_at = NOW()
WHERE status = 'pending' AND expires_at < NOW()
RETURNING id
```
This is an atomic UPDATE — PostgreSQL row-level locking prevents two concurrent UPDATEs from touching the same row twice. If both instances run the job simultaneously, one will update 5 rows and the other will update 0 rows (the rows were already updated). No double-expiry occurs. The only waste is one extra unnecessary query.

**At Tier 3 (3+ instances):** Implement database-based job coordination using a `job_locks` table:

```sql
CREATE TABLE job_locks (
    job_name   VARCHAR(100) PRIMARY KEY,
    locked_by  VARCHAR(100),           -- instance identifier
    locked_at  TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL    -- lock expires if instance crashes
);
```

```typescript
async function tryAcquireLock(jobName: string, ttlSeconds: number): Promise<boolean> {
  const instanceId = process.env.INSTANCE_ID ?? hostname()
  const result = await db.execute(sql`
    INSERT INTO job_locks (job_name, locked_by, locked_at, expires_at)
    VALUES (${jobName}, ${instanceId}, NOW(), NOW() + interval '${ttlSeconds} seconds')
    ON CONFLICT (job_name) DO UPDATE
      SET locked_by = ${instanceId}, locked_at = NOW(),
          expires_at = NOW() + interval '${ttlSeconds} seconds'
      WHERE job_locks.expires_at < NOW()   -- only steal if previous lock expired
    RETURNING job_name
  `)
  return result.rowCount === 1  // true = lock acquired; false = another instance holds it
}
```

V1 does not need this. The atomic UPDATE is sufficient. Document this upgrade path for Tier 3.

### 1.5 Health Endpoints — Liveness vs. Readiness

Two separate health concepts, two separate endpoints:

#### `/api/health/live` — Liveness
**Question:** Is the Node.js process running and responsive?  
**Logic:** Returns 200 immediately. No database call. No external call.  
**Used by:** PM2 `max_memory_restart`, Cloudflare health checks, UptimeRobot.

```typescript
export async function GET() {
  return Response.json({ status: 'alive', timestamp: new Date().toISOString() })
}
```

#### `/api/health/ready` — Readiness
**Question:** Can this instance safely receive customer traffic?  
**Logic:** Tests database connectivity. Returns 200 only if DB query succeeds.  
**Used by:** NGINX active upstream health check. Load balancer removes instance from rotation if this returns non-200.

```typescript
export async function GET() {
  try {
    await db.execute(sql`SELECT 1`)
    return Response.json({
      status: 'ready',
      database: 'connected',
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    // Return 503 — NGINX removes instance from rotation
    return Response.json(
      { status: 'not_ready', database: 'unavailable' },
      { status: 503 },
    )
  }
}
```

**Important:** The readiness endpoint must NOT be expensive. `SELECT 1` is a lightweight ping. Do not query booking tables, do not run aggregates.

**Security note:** Health endpoints expose no sensitive information. No stack traces, no connection strings, no server names.

#### `/api/health` — Legacy (kept for UptimeRobot compatibility)
Returns combined liveness + readiness for backwards compatibility with UptimeRobot configuration from Doc 15.

### 1.6 NGINX Load Balancer Configuration (Multi-Instance)

```nginx
upstream thefield_app {
    least_conn;   # route to instance with fewest active connections

    server 127.0.0.1:3000 max_fails=2 fail_timeout=10s;
    server 127.0.0.1:3001 max_fails=2 fail_timeout=10s;

    keepalive 32;  # keep connections to upstream alive
}

# Active health check (NGINX Plus feature — see note below)
# For open-source NGINX, use passive health checks (max_fails + fail_timeout above)
# plus an external check via UptimeRobot or a separate monitor cron

server {
    # ... TLS config as before ...

    location / {
        proxy_pass http://thefield_app;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";
        proxy_http_version 1.1;

        proxy_connect_timeout 5s;
        proxy_read_timeout    60s;
        proxy_send_timeout    60s;

        # Retry on failure — but NOT on POST (booking submissions)
        # Retrying a POST could create duplicate bookings
        proxy_next_upstream error timeout http_502 http_503;
        proxy_next_upstream_tries 2;
        proxy_next_upstream_timeout 10s;
    }

    # Never retry booking creation or payment proof uploads
    location /api/v1/bookings {
        proxy_pass http://thefield_app;
        proxy_next_upstream off;   # no retry on this endpoint
        # ... other headers ...
    }
}
```

**Note on `proxy_next_upstream`:** GET requests (availability, status lookup) can be retried safely if one instance fails. POST requests that mutate state (booking creation, payment proof upload) must NOT be retried at the load balancer layer — a retry could create a duplicate booking. Setting `proxy_next_upstream off` for mutation endpoints is mandatory.

**Note on NGINX open-source vs. NGINX Plus:** Active health checks (proactively polling `/api/health/ready`) require NGINX Plus (paid). Open-source NGINX uses passive checks (marks instance failed only after a real request fails). For V1 on a single VPS, this is acceptable. At Tier 3 with separate nodes, use HAProxy (free, supports active health checks) or NGINX Plus, or deploy a lightweight health check sidecar.

---

## Section 2: Scalability Architecture

### 2.1 Scalability Philosophy

Scale in response to measured signals, not in anticipation of theoretical traffic. The Field is a single padel venue in Egypt. Initial bookings volume is estimated at 10–50 per day, with potential spikes on Thursday evenings and Friday mornings (Egyptian weekend).

Do not pay for infrastructure that isn't needed. Do not architect as if serving millions of users. Do design so that adding capacity requires configuration changes, not code rewrites.

### 2.2 Scaling Dimensions

| Dimension | V1 Approach | Scaling Trigger | Scale Action |
|-----------|------------|----------------|-------------|
| Application throughput | 1–2 PM2 instances | p95 latency > 1s sustained for 5 min | Add PM2 instance (same VPS) or add VPS node |
| Database connections | Max 20 per instance | Connection pool exhaustion alerts | Add PgBouncer pooling or upgrade DB plan |
| Database capacity | Managed PG | Disk > 70% used | Upgrade storage on managed DB plan |
| Static asset delivery | Cloudflare CDN | N/A — CDN handles scale automatically | None needed |
| File storage | Cloudflare R2 | N/A — R2 scales automatically | None needed |
| Background jobs | 1 cron per instance | Multiple instances running same job | Add `job_locks` table (Section 1.4) |

### 2.3 Application Instance Scaling

**V1 Initial (Tier 2):** One PM2 process. Sufficient for estimated initial load.

**V1 Production (Tier 2 upgraded):** Two PM2 processes on the same VPS, ports 3000 and 3001. NGINX load-balances between them. This provides:
- Redundancy: if one process crashes, PM2 auto-restarts it; NGINX keeps routing to the live instance.
- Throughput: two Node.js event loops handle concurrent requests.
- Zero-downtime deployment: restart one instance while the other continues serving.

**Tier 3 (separate VPS nodes):** Two separate Hostinger VPS instances (or equivalent). NGINX on each node or a dedicated load balancer (HAProxy on a third instance). This provides:
- True host-level redundancy: VPS failure does not take down both instances.
- Independent resource limits per node.

### 2.4 Database Connection Management

This is the most common scaling failure mode: too many application instances exhaust PostgreSQL's `max_connections`.

**Managed PostgreSQL connection limits (approximate, varies by plan):**

| Provider | Plan | Max Connections |
|---------|------|----------------|
| Neon | Free | 100 |
| Neon | Launch ($19/mo) | 100 (pooled via PgBouncer) |
| Supabase | Pro ($25/mo) | 60 direct + PgBouncer |
| Aiven | Startup ($19/mo) | ~25–100 depending on size |

**Connection budget calculation for V1 Production (2 instances):**

```
Each application instance uses:
  max pool size:      10 connections
  idle connections:   ~3–5 sustained

Total application connections:  2 instances × 10 = 20 connections
Reserved for migrations:        5 connections
Reserved for monitoring/admin:  5 connections
Safety buffer:                  10 connections
────────────────────────────────────────────
Total required:                 ~40 connections
```

20 application connections leaves comfortable headroom on any managed plan with 60+ connections.

**PgBouncer:** At Tier 3 (3+ instances), add PgBouncer as a connection pooler between the application and PostgreSQL. PgBouncer multiplexes many application connections onto fewer PostgreSQL server connections:

```
App Instance A (10 conns) ─┐
App Instance B (10 conns) ─┼─► PgBouncer (15 server conns) ──► PostgreSQL
App Instance C (10 conns) ─┘
```

PgBouncer runs in `transaction mode` — connections are returned to the pool after each transaction, not held for the duration of a session. This is compatible with the booking engine (each booking operation is self-contained in a transaction).

**Drizzle connection pool configuration:**

```typescript
// src/lib/db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max:                    parseInt(process.env.DB_POOL_MAX ?? '10'),
  min:                    parseInt(process.env.DB_POOL_MIN ?? '2'),
  idleTimeoutMillis:      30_000,   // release idle connections after 30s
  connectionTimeoutMillis: 5_000,   // fail fast if pool exhausted
  statement_timeout:      30_000,   // kill queries running > 30s
  query_timeout:          30_000,
})

pool.on('error', (err) => {
  logger.error({ err }, 'PostgreSQL pool error')
  Sentry.captureException(err)
})

export const db = drizzle(pool, { schema })
```

**Environment variables for pool tuning (no code changes to scale):**
```bash
DB_POOL_MAX=10   # per instance; reduce if adding more instances
DB_POOL_MIN=2    # keep warm connections
```

### 2.5 Traffic Spike Behaviour

During a traffic spike (e.g., a social media post about The Field goes viral):

| Layer | Behaviour | Limit |
|-------|----------|-------|
| Cloudflare | Absorbs static asset requests, bot traffic filtered | Effectively unlimited for CDN requests |
| NGINX rate limiting | Limits booking submissions to 10/min/IP | First defence against request floods |
| Application rate limiter | Secondary enforcement | 10 booking submissions/hour/IP |
| Database connection pool | `connectionTimeoutMillis: 5000` — requests that can't get a connection fail fast with HTTP 503 | Pool max × instances |
| PM2 `max_memory_restart: '1G'` | Prevents memory leak from causing full outage | Triggers restart, not crash |

**Controlled degradation:** When the database connection pool is exhausted, the application returns HTTP 503 with:
```json
{ "error": { "code": "SERVICE_UNAVAILABLE", "message": "The booking system is temporarily busy. Please try again in a few moments." } }
```

This is a safe, visible failure. No booking is silently dropped. The customer can retry.

### 2.6 Scaling Signals and Thresholds

These are **initial recommendations**. They must be validated against actual load test results (Section 5) before being treated as production thresholds.

| Signal | Warning Threshold | Action Threshold | Response |
|--------|------------------|-----------------|---------|
| App CPU > 70% sustained 10 min | Monitor | 85% sustained 10 min | Add second PM2 instance or upgrade VPS |
| App memory > 700MB | Monitor | 900MB (PM2 restarts at 1GB) | Investigate memory leak; consider upgrade |
| p95 API latency > 800ms | Monitor | > 1500ms | Check slow queries; add instance |
| DB connections > 70% of max | Monitor | > 85% of max | Reduce pool size or add PgBouncer |
| DB query latency p95 > 500ms | Check slow query log | > 1000ms | Add missing index or query optimisation |
| Booking error rate > 2% | Monitor | > 5% | Investigate immediately |
| NGINX 5xx rate > 1% | Monitor | > 3% | Check app health; possible instance restart |

**Why no exact numbers yet:** Traffic patterns for The Field are unknown before launch. Thresholds that are too aggressive cause false alarms; thresholds too lenient miss real problems. Establish a one-week baseline after launch, then tune.

---

## Section 3: Single Point of Failure Analysis

For every potential failure point: what it is, the impact if it fails, whether redundancy is justified in V1, the V1 mitigation, and the upgrade path.

---

### SPOF-01: DNS (Cloudflare)
**Impact of failure:** Site completely unreachable.  
**Cloudflare DNS SLA:** 100% uptime SLA with anycast routing across 300+ PoPs globally.  
**V1 justified?** Full DNS redundancy (multi-provider) is not economically justified at V1 scale.  
**V1 mitigation:** Cloudflare DNS with low TTL (300s) for fast failover if nameservers are changed.  
**Upgrade path:** Add a secondary DNS provider (e.g., NS1) at Tier 3.  
**Honest assessment:** Cloudflare DNS has had rare but real outages (most notably June 2022). If Cloudflare DNS fails, the site is unreachable until DNS is restored. This is an accepted risk for V1.

---

### SPOF-02: Cloudflare (Edge Layer)
**Impact of failure:** All customer traffic blocked.  
**Reality:** Cloudflare had a partial global outage in June 2022. Full outages are extremely rare. Partial outages affecting specific regions are more common.  
**V1 justified?** Bypassing Cloudflare entirely is possible (point DNS directly to VPS IP) but loses CDN, WAF, and DDoS protection. Not recommended.  
**V1 mitigation:** Configure Cloudflare in "Full (Strict)" SSL mode with the VPS IP known. In an emergency, DNS can be updated to point directly to the VPS IP, bypassing Cloudflare (manual failover within ~5 minutes).  
**Emergency procedure:** Document the VPS IP in the ops runbook. Admin knows to update DNS directly to VPS IP if Cloudflare is the confirmed failure point.

---

### SPOF-03: NGINX Load Balancer (VPS)
**Impact of failure:** All application instances unreachable. In V1, NGINX runs on the same VPS as the application.  
**V1 initial:** NGINX and app instances on same VPS = single host failure takes down everything.  
**V1 production (Tier 2):** Same.  
**V1 mitigation:** PM2 manages app instances; NGINX is managed by systemd (auto-restarts). VPS reboot recovery is < 2 minutes. PM2 `startup` command ensures auto-start.  
**Tier 3 upgrade:** Move to two separate VPS nodes each running NGINX + app. Cloudflare load balances between them via multiple A records with health checks.  
**Honest assessment:** A single VPS failure = full outage in V1. This is the primary reliability gap. Acceptable for V1 given cost and scale; addressed at Tier 3.

---

### SPOF-04: Application Instances (Node.js / PM2)
**Impact of failure:** HTTP 502 to users until instance restarts.  
**V1 initial (1 instance):** All traffic fails until PM2 restarts the process (~5 seconds).  
**V1 production (2 instances):** NGINX routes to the surviving instance while the crashed instance restarts.  
**V1 mitigation:** PM2 auto-restart, max_restarts: 10, restart_delay: 5s. NGINX passive health check removes failed upstream.  
**Recovery time:** < 10 seconds for a PM2 auto-restart.  
**Tier 3 upgrade:** Application instances on separate physical hosts.

---

### SPOF-05: PostgreSQL Database
**Impact of failure:** Entire application fails. No bookings can be created or verified. Admin cannot approve. This is the most critical failure.  
**V1 mitigation:** Use a managed PostgreSQL provider (Neon, Supabase, or Aiven) rather than self-managed PostgreSQL on the VPS. Managed providers offer:
- Automated daily backups
- Point-in-time recovery (PITR)
- Automatic failover (standby replica promoted automatically within 30–60 seconds on most providers)
- Monitoring and alerting
- The application returns HTTP 503 on all database-dependent routes when the DB is unavailable (see Section 4.3).  
**Tier 3 upgrade:** Managed PG with synchronous standby replica. Read replicas for availability queries (never for writes).  
**Critical rule:** All booking writes always go to the PRIMARY endpoint. Read replicas are for reporting only — never for availability checks that feed into booking creation, because replication lag could cause the replica to show a slot as available when the primary has already booked it.

---

### SPOF-06: Object Storage (Cloudflare R2)
**Impact of failure:** Payment proof uploads fail. Admin cannot view proofs. Gallery images unavailable.  
**R2 durability:** 99.999999999% (11 nines) — data loss risk is effectively zero.  
**R2 availability:** R2 has had brief availability events (rare). During an outage, uploads fail but bookings themselves are unaffected (upload is non-blocking).  
**V1 mitigation:** Upload failure is already handled gracefully (Section 9 of Doc 22): booking is created successfully, customer can re-upload later. Admin cannot view proofs during R2 outage but can still approve/reject based on existing proofs.  
**Tier 3 upgrade:** Not needed. R2's durability and availability are sufficient. If R2 is unavailable, the impact is isolated to file access only.

---

### SPOF-07: Session Storage (iron-session Encrypted Cookies)
**Impact of failure:** N/A — there is no server-side session store. Sessions are stateless encrypted cookies. No single point of failure exists for session storage.  
**Risk:** Session SECRET rotation logs out all admins. This is a designed behavior for security incidents, not a reliability risk.  
**Cross-instance concern:** None. Any instance can decrypt any valid session cookie using the shared `SESSION_SECRET` environment variable. This is correct by design.

---

### SPOF-08: In-Memory Rate Limiter (`RateLimiterMemory`)
**Impact of failure:** N/A — memory state is lost on restart, but rate limits are per-IP, per-window. A restart resets the window, allowing a brief burst of requests. This is a minor security gap, not a data integrity risk.  
**V1 mitigation:** NGINX rate limiting (layer 1) is not in-memory per-instance — it persists in NGINX shared memory zones. App-layer rate limiting is a secondary defence.  
**Tier 3 upgrade:** Replace `RateLimiterMemory` with `RateLimiterRedis` backed by Upstash Redis.

---

### SPOF-09: External Monitoring (Sentry, UptimeRobot)
**Impact of failure:** Monitoring goes dark. Outages may not be detected until a customer complains.  
**V1 mitigation:** UptimeRobot uses multiple probe locations. Sentry has its own SLA. Failure of monitoring does not affect the application itself.  
**Secondary monitoring:** NGINX access logs remain on the VPS and can be reviewed directly. PM2 logs remain accessible via SSH.

---

### SPOF-10: CI/CD Pipeline (GitHub Actions)
**Impact of failure:** Cannot deploy updates.  
**V1 mitigation:** Manual deployment (`ssh + git pull + deploy.sh`) always possible. GitHub Actions failure does not affect the running application.  
**Tier 3 upgrade:** No change needed.

---

### SPOF-11: Hostinger Infrastructure (VPS Host)
**Impact of failure:** Full VPS outage. All application instances and NGINX unavailable.  
**Reality:** Hostinger has had data center incidents. All single-provider VPS deployments carry this risk.  
**V1 mitigation:** Tier 2 — accept the risk. VPS rebuilds with backup restoration are documented and rehearsed (Milestone 6). Target recovery time: < 2 hours.  
**Tier 3 upgrade:** Move application to two nodes on separate Hostinger data centers or separate providers (Hetzner + Hostinger, or DigitalOcean + Hostinger). This addresses provider-level failure.

---

### SPOF Summary Table

| Component | V1 SPOF? | Mitigation | Tier 3 Solution |
|-----------|----------|-----------|-----------------|
| DNS (Cloudflare) | Yes (rare) | Low TTL, manual failover | Dual DNS provider |
| Cloudflare edge | Yes (extremely rare) | Manual DNS bypass to VPS | Accept risk |
| NGINX on VPS | Yes | systemd auto-restart | Separate load balancer node |
| App instance | Partial (2 instances) | PM2 restart, NGINX failover | Separate VPS nodes |
| PostgreSQL | Partial (managed provider) | Auto-failover by provider | Sync standby replica |
| R2 storage | No (11-nines durability) | Non-blocking upload | None needed |
| Sessions | No (stateless cookies) | N/A | N/A |
| Rate limiter state | Minor | NGINX primary layer | Redis rate limiter |
| Monitoring | Yes (blind spot only) | Multiple tools | N/A |
| VPS host (Hostinger) | Yes | Rehearsed recovery procedure | Multi-provider deployment |

---

## Section 4: Reliability Requirements

### 4.1 Availability Targets

| Tier | Target Uptime | Allowed Downtime/Year | Notes |
|------|--------------|----------------------|-------|
| Tier 2 (V1 Production) | 99.5% | ~44 hours | Realistic for single VPS with PM2 |
| Tier 3 (HA Production) | 99.9% | ~8.7 hours | Two nodes + managed DB with failover |

**Why 99.5% and not 99.9% for Tier 2:** Achieving 99.9% requires:
- Redundant VPS nodes
- Active health-check load balancer
- Managed PostgreSQL with automatic failover under 60 seconds
- Zero-downtime deployments

These are achievable but carry cost and operational complexity not justified until The Field demonstrates steady booking volume.

### 4.2 Data Integrity Requirements (Non-Negotiable at All Tiers)

These requirements hold regardless of deployment tier. They cannot be traded for availability.

| Requirement | Rule |
|-------------|------|
| No duplicate approved bookings | PostgreSQL exclusion constraint enforced at all times. Never weakened. |
| No booking without DB confirmation | The application never confirms a booking using local memory or cache. |
| No payment verified without DB write | Payment status is always written to PostgreSQL before the response is returned. |
| No silent data loss | If a database write fails, the error is returned to the caller. Never swallowed. |
| Audit logs are append-only | No UPDATE or DELETE on `audit_logs`. Enforced at the PostgreSQL role level. |
| Prices are immutable on booking records | Once written, `bookings.price_amount` is never updated. |

### 4.3 Database Failure Behaviour

When PostgreSQL becomes temporarily unavailable:

| Endpoint | Behaviour | HTTP Status |
|----------|----------|-------------|
| `GET /api/v1/availability` | Returns 503 with: "Court availability is temporarily unavailable. Please try again in a moment." | 503 |
| `POST /api/v1/bookings` | Returns 503 with: "Booking system is temporarily unavailable. Please try again." | 503 |
| `POST /api/v1/booking-status` | Returns 503 | 503 |
| `GET /` (public pages) | Server error page OR cached Cloudflare response (static fallback) | 503 or cached |
| `/admin/**` | Returns 503 | 503 |
| `/api/health/ready` | Returns 503 — NGINX removes instance from load balancer rotation | 503 |

**Rules:**
- Never confirm a booking without a successful database write.
- Never return stale availability data from a cache when making a booking decision.
- Availability display may use a short-lived cache (60 seconds) for performance — but the booking creation endpoint always checks live.
- Error messages to customers must not include database error details, connection strings, or server names.

### 4.4 File Upload Failure Behaviour

When Cloudflare R2 is temporarily unavailable:

| Scenario | Behaviour |
|----------|----------|
| Proof upload on initial booking submission fails | Booking is created successfully. Customer receives reference with status "pending". Message: "Your booking was received. Please upload your payment proof using the link below." |
| Proof upload on late upload page fails | Returns error. Customer retries. Booking state unchanged. |
| Admin view of proof fails (R2 down) | Admin sees "Proof temporarily unavailable. Please try again." Admin can still approve or reject based on prior review. |

The upload is already non-blocking in the booking creation flow (specified in Doc 22, Section 8.2). This requirement is already met.

### 4.5 Idempotency Requirements

Operations that can be retried (by browser, load balancer, or customer) must not create duplicate state.

| Operation | Idempotency Mechanism |
|-----------|----------------------|
| Booking creation | Booking reference collision → DB UNIQUE constraint → retry generates new reference. Network timeout after commit → customer retries → second request sees slot as unavailable (409 BOOKING_CONFLICT). Customer does NOT get two bookings. |
| Payment proof upload | Multiple uploads for same booking → both stored in `payment_proofs` table (multiple rows allowed). Admin sees all proofs. Payment remains in `submitted` status. No duplicate state. |
| Payment verification | Admin clicks "verify" twice (double-click) → second request: state machine check `assertTransitionAllowed('verified', 'verified', 'admin')` throws → HTTP 422. Idempotent. |
| Booking approval | Admin clicks "approve" twice → same state machine check → HTTP 422 on second click. |
| Booking expiry job | Runs twice simultaneously → atomic UPDATE selects rows with `status = 'pending'`. PostgreSQL row locks mean only one UPDATE processes each row. Second run updates 0 rows. |

### 4.6 Graceful Shutdown Requirements

When an application instance is shutting down (deployment, restart, or VPS maintenance):

```typescript
// src/lib/graceful-shutdown.ts
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — beginning graceful shutdown')

  // 1. Stop accepting new connections (NGINX detects unhealthy after 2 failures)
  isShuttingDown = true

  // 2. Allow in-flight requests to complete (30-second window)
  await new Promise(resolve => setTimeout(resolve, 30_000))

  // 3. Close database connection pool
  await pool.end()

  logger.info('Graceful shutdown complete')
  process.exit(0)
})
```

The `isShuttingDown` flag causes `/api/health/ready` to return 503, which removes the instance from NGINX rotation. In-flight requests have 30 seconds to complete before the process exits. New requests are routed to the other instance.

PM2 sends SIGTERM before force-killing a process. The `kill_timeout` in PM2 config must be > 30 seconds to allow graceful shutdown:

```javascript
// ecosystem.config.js addition
kill_timeout: 35000,      // give SIGTERM handler 35s before force kill
listen_timeout: 5000,     // how long to wait for process to be ready
```

---

## Section 5: Load Testing Plan

### 5.1 Purpose and Scope

Load testing answers four questions before they become production incidents:

1. What is the actual throughput capacity of the V1 deployment?
2. At what point does adding an application instance provide meaningful improvement?
3. At what point does the database become the bottleneck?
4. What does the system do under load that exceeds capacity — does it degrade gracefully?

Load testing must be performed on the **staging environment** with production-equivalent infrastructure. Load testing against production is prohibited.

### 5.2 Tool Selection

**Primary tool: k6** (Grafana k6)
- TypeScript-native scripting — consistent with the project stack.
- Free and open-source.
- Supports virtual users, ramping patterns, checks (assertions), thresholds.
- Outputs metrics compatible with Grafana if needed.

```bash
npm install -g k6
```

**Supporting tools during test runs:**
- `pm2 monit` — live CPU/memory of app instances.
- PostgreSQL: `SELECT * FROM pg_stat_activity WHERE state = 'active';` — live connection count.
- Sentry performance dashboard — p50/p95/p99 latency by route.
- NGINX access logs — real-time error rate check.

### 5.3 Baseline Traffic Model

Before testing, define what "normal" means for The Field.

**Estimated V1 daily traffic (conservative):**
- 50 bookings/day.
- Each booking involves ~5–8 API requests (availability check + submission + confirmation).
- Peak window: Thursday 18:00–22:00 and Friday 08:00–14:00 (Egyptian weekend).
- Peak concurrent users (estimated): 5–15 simultaneously.
- Maximum realistic spike: social media post during Ramadan → ~100 simultaneous users.

These are estimates. They must be revisited after two weeks of production data.

### 5.4 Test Scenarios

Each scenario is a k6 script in `tests/load/`. All tests hit staging, not production.

---

#### LOAD-T01: Baseline — Normal Traffic
**Purpose:** Verify the system handles normal expected load with margin.  
**Configuration:** 10 virtual users (VU), 5-minute duration, constant rate.  
**Endpoints exercised:** GET /api/v1/availability (60%), POST /api/v1/booking-status (20%), GET / and public pages (20%).

```javascript
// tests/load/baseline.js
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  vus: 10,
  duration: '5m',
  thresholds: {
    http_req_duration: ['p95<500'],   // 95th percentile < 500ms
    http_req_failed:   ['rate<0.01'], // < 1% error rate
  },
}

export default function () {
  const availRes = http.get('https://staging.thefield.eg/api/v1/availability?courtId=TEST_COURT&date=2026-09-15')
  check(availRes, { 'availability 200': (r) => r.status === 200 })
  sleep(1)
}
```

**Pass criteria:** p95 < 500ms. Error rate < 1%. CPU < 60%. DB connections < 50% of max.

---

#### LOAD-T02: 2× Expected Traffic
**Purpose:** Verify the system handles moderate traffic growth.  
**Configuration:** 20 VU, 10 minutes. Mix of availability, booking creation, and status lookup.

```javascript
export const options = {
  stages: [
    { duration: '2m', target: 20 },  // ramp up
    { duration: '6m', target: 20 },  // hold
    { duration: '2m', target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration: ['p95<800'],
    http_req_failed:   ['rate<0.02'],
  },
}
```

**Pass criteria:** p95 < 800ms. Error rate < 2%. No 5xx on booking creation.

---

#### LOAD-T03: 5× Expected Traffic (Stress Test)
**Purpose:** Find the breaking point.  
**Configuration:** 50 VU, 10 minutes constant.

**Expected findings:** Identify whether CPU, memory, DB connections, or NGINX become the bottleneck first. The system should degrade gracefully (503s with clear messages) rather than crash.

**Pass criteria:** System returns controlled errors (429 or 503), not unhandled 500s. PM2 does not crash. DB connections do not exceed 90% of max. System recovers within 60 seconds after load is removed.

---

#### LOAD-T04: Sudden Spike
**Purpose:** Simulate a social media post driving sudden traffic.  
**Configuration:** 0 → 80 VU over 30 seconds, hold 2 minutes, then drop back to 5 VU.

```javascript
export const options = {
  stages: [
    { duration: '30s', target: 80 },  // sudden spike
    { duration: '2m',  target: 80 },  // sustained
    { duration: '30s', target: 5 },   // recovery
    { duration: '2m',  target: 5 },   // verify recovery
  ],
}
```

**Pass criteria:** No data corruption during spike. Booking integrity maintained. System recovers to normal latency within 2 minutes after spike ends.

---

#### LOAD-T05: Concurrent Booking Requests (Critical)
**Purpose:** Prove the double-booking prevention works under load, not just in isolated tests.  
**Configuration:** 20 VU all attempting to book the same court and time slot simultaneously.

```javascript
// All VUs attempt to book Court 1 at 20:00 on the same date
export const options = { vus: 20, iterations: 20 }  // each VU runs once

export default function () {
  const res = http.post('https://staging.thefield.eg/api/v1/bookings', payload, params)
  check(res, {
    'is 201 or 409': (r) => r.status === 201 || r.status === 409,
    'is NOT 500':    (r) => r.status !== 500,
  })
}
```

**Pass criteria:** Exactly 0 or 1 booking created with status `pending`. Zero 500 errors. Database contains ≤ 1 booking for that slot (there may be 2 `pending` — see the documented race condition — but at most 1 can reach `approved`).

---

#### LOAD-T06: Admin Activity During Customer Traffic
**Purpose:** Verify admin operations are not blocked by customer traffic.  
**Configuration:** 15 VU running availability checks + 2 VU performing admin approval actions simultaneously.

**Pass criteria:** Admin API (approve, reject) p95 < 2000ms even during customer load. No admin 5xx errors. Booking approval correctly enforces exclusion constraint under concurrent load.

---

#### LOAD-T07: Database Connection Exhaustion Behaviour
**Purpose:** Verify the system degrades gracefully when DB pool is exhausted.  
**Configuration:** Temporarily reduce `DB_POOL_MAX=2` on staging. Run 20 VU simultaneously.

**Pass criteria:** System returns HTTP 503 with clear message. No 500 errors. No booking confirmations without successful DB write. Pool recovers when VUs are reduced.

---

### 5.5 Metrics to Collect During Every Test

| Metric | Tool | Target |
|--------|------|--------|
| HTTP request p50, p95, p99 latency | k6 | p95 < 500ms (normal), < 2000ms (stress) |
| HTTP error rate (4xx + 5xx) | k6 | < 1% (normal), < 5% (stress) |
| Booking creation success rate | k6 custom check | 100% non-conflict bookings succeed |
| Double-booking prevention | k6 custom check | 0 duplicate approved bookings |
| App CPU | pm2 monit / VPS metrics | < 70% normal, < 90% stress |
| App memory (RSS) | pm2 monit | < 800MB per instance |
| PostgreSQL active connections | pg_stat_activity | < 80% of max_connections |
| PostgreSQL query latency p95 | pg_stat_statements | < 100ms for availability query |
| NGINX 5xx rate | NGINX access logs | < 0.1% normal |
| PM2 restarts during test | pm2 logs | 0 during normal; investigate if > 0 |

### 5.6 Post-Test Validation

After every load test run:

```bash
# Verify no double-approved bookings were created
psql "$DATABASE_URL" -c "
  SELECT court_id, booking_date, start_time, end_time, COUNT(*) as count
  FROM bookings
  WHERE status = 'approved'
  GROUP BY court_id, booking_date, start_time, end_time
  HAVING COUNT(*) > 1;
"
# Must return 0 rows. If any rows returned: CRITICAL BUG — investigate immediately.
```

### 5.7 Capacity Planning Output

After completing all load tests, document:

| Metric | Measured Value | Bottleneck? | Action |
|--------|---------------|------------|--------|
| Max throughput (req/s) with 1 instance | TBD | TBD | TBD |
| Max throughput with 2 instances | TBD | TBD | TBD |
| DB connection saturation point | TBD | TBD | TBD |
| CPU saturation point | TBD | TBD | TBD |

Fill in after first load test run. Use these values to set production alert thresholds in Section 12.

---

## Section 6: Disaster Recovery Plan

### 6.1 Definitions

**RPO (Recovery Point Objective):** The maximum amount of data loss that is acceptable. If the database is restored from a backup, how old can that backup be?

**RTO (Recovery Time Objective):** The maximum time the service can be offline during a recovery before it is considered unacceptably long.

### 6.2 RPO and RTO Targets

| Tier | RPO | RTO | How Achieved |
|------|-----|-----|-------------|
| Tier 2 (V1 Production) | 24 hours | 2 hours | Daily pg_dump backup + rehearsed restore procedure |
| Tier 3 (HA Production) | 5 minutes | 30 minutes | Managed PG with PITR + multi-node app + automated failover |

**Why 24-hour RPO for V1:** Daily backups are the minimum viable backup strategy. Any booking placed in the 24-hour window before a catastrophic failure could be lost. This risk is accepted for V1 given:
- Booking volume is low (10–50/day).
- Payment proofs are in R2 (independent durability).
- Most losses would be pending/unconfirmed bookings, not confirmed paid bookings.

**Why 5-minute RPO at Tier 3:** Managed PostgreSQL PITR (point-in-time recovery) combined with WAL archiving provides near-continuous backup. 5-minute RPO means at most 5 minutes of transactions are lost.

**Honest disclaimer:** These targets assume the recovery procedure has been rehearsed and all tools are in place. An untested recovery plan is not a recovery plan.

### 6.3 Recovery Scenarios

---

#### DR-01: Application Server Failure (Single Instance Crash)

**Cause:** PM2 process crash, OOM kill, unhandled exception.  
**Detection:** UptimeRobot alert within 5 minutes. Sentry exception capture.  
**Impact (1 instance):** Site unavailable for ~10–30 seconds until PM2 auto-restarts.  
**Impact (2 instances):** NGINX routes to surviving instance. User impact: brief 502 on in-flight requests to failed instance.

**Recovery procedure:**
```bash
# PM2 handles this automatically. To verify:
ssh user@vps
pm2 status                        # verify process is running
pm2 logs thefield --lines 50     # check for crash reason
# If PM2 did not auto-restart:
pm2 restart thefield
# If repeated crashes: check for disk full, memory exhaustion, DB connectivity
df -h && free -m
pm2 logs thefield --err --lines 100
```

**No data loss.** PM2 restart does not lose any data — all state is in PostgreSQL and R2.

---

#### DR-02: Full VPS Failure (Host-Level)

**Cause:** Hostinger data center incident, VPS hardware failure, network partition.  
**Detection:** UptimeRobot alert within 5 minutes.  
**Impact:** Complete outage until new VPS is provisioned and application is restored.

**Recovery procedure (target: < 2 hours):**
```
Step 1 (0:00): Confirm VPS is unreachable (cannot SSH, UptimeRobot confirms)
Step 2 (0:05): Provision new Hostinger VPS with same spec (Ubuntu 22.04)
Step 3 (0:10): Run initial setup script (scripts/setup-vps.sh) — installs Node, PG client, NGINX, PM2
Step 4 (0:20): Restore database from latest backup (see DR-05)
Step 5 (0:40): Clone repository and set environment variables
Step 6 (0:50): Run migrations, build, start PM2
Step 7 (1:00): Configure NGINX, obtain TLS cert (certbot --nginx)
Step 8 (1:15): Update DNS to new VPS IP (via Cloudflare dashboard, TTL 300s)
Step 9 (1:20): Verify health endpoint on new server
Step 10 (1:25): Confirm site is live, run smoke test
Step 11 (1:30): Notify venue owner, document incident
```

**Note on DNS propagation:** Cloudflare proxying means DNS changes propagate within seconds (Cloudflare updates its PoPs). If not using Cloudflare proxying, TTL must be pre-reduced to 300s before a known maintenance window.

**Data loss risk:** If the VPS disk was the only copy of environment variables, they are lost. **Mitigation:** Environment variables must be stored securely outside the VPS (a password manager, a secrets vault, or a printed copy in a physically secure location). This is an operational requirement, not a code requirement.

---

#### DR-03: Database Primary Failure

**Cause:** Managed PostgreSQL primary node fails.  
**Detection:** Managed provider automatic monitoring + application `/api/health/ready` returns 503 + Sentry DB connection errors.  
**Impact:** All booking operations unavailable until failover completes.

**Recovery with managed PostgreSQL (Neon/Supabase/Aiven):**
- Automatic failover to standby replica (typically 30–90 seconds).
- Application reconnects automatically (connection pool retries).
- No manual intervention needed for failover.
- RTO: ~2 minutes.

**Recovery without managed PostgreSQL (self-managed on VPS):**
- No automatic failover. Manual restore from backup.
- Follow DR-05.
- RTO: up to 2 hours.

**This is why the architecture mandates a managed PostgreSQL provider.** Self-managed PostgreSQL on the same VPS as the application is an unacceptable single point of failure for the primary source of truth.

**Important:** After failover, verify:
```sql
-- Confirm exclusion constraint is present on new primary
SELECT conname FROM pg_constraint WHERE conname = 'no_overlapping_approved_bookings';
-- Verify booking_range generated column
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'bookings' AND column_name = 'booking_range';
```

---

#### DR-04: Storage Failure (Cloudflare R2)

**Cause:** R2 service disruption.  
**Detection:** Upload failures in Sentry. Admin proof-view errors.  
**Impact:** New proof uploads fail (customer can retry). Admin cannot view proofs. Gallery/CMS images unavailable.  
**Impact on bookings:** Zero — booking creation is non-blocking for file uploads.

**Recovery procedure:**
- Wait for R2 recovery (typical: minutes to hours for Cloudflare service incidents).
- No data is lost — R2 has 11-nines durability.
- Customers with pending uploads are shown: "Proof upload is temporarily unavailable. Please try again shortly."
- Admin is shown: "Proof temporarily unavailable."
- No manual recovery action required.

---

#### DR-05: Database Restore from Backup

**When used:** Catastrophic database loss, accidental data deletion, corruption.

**Pre-conditions:** Latest backup file available (VPS local or R2 bucket `thefield-backups/`).

```bash
# Step 1: Identify the backup to restore
aws s3 ls s3://thefield-backups/ \
  --endpoint-url "$S3_ENDPOINT" \
  --recursive | sort | tail -20

# Step 2: Download the backup
aws s3 cp "s3://thefield-backups/thefield-20260905-020001.sql.gz" \
  /tmp/restore.sql.gz \
  --endpoint-url "$S3_ENDPOINT"

# Step 3: Stop the application (prevent writes during restore)
pm2 stop thefield

# Step 4: Drop and recreate the database (DESTRUCTIVE — confirm this is intentional)
sudo -u postgres psql -c "DROP DATABASE IF EXISTS thefield_restore;"
sudo -u postgres psql -c "CREATE DATABASE thefield_restore;"

# Step 5: Restore
gunzip -c /tmp/restore.sql.gz | sudo -u postgres psql thefield_restore

# Step 6: Verify critical data
sudo -u postgres psql thefield_restore -c "SELECT COUNT(*) FROM bookings WHERE status = 'approved';"
sudo -u postgres psql thefield_restore -c "SELECT COUNT(*) FROM admin_users WHERE is_active = true;"

# Step 7: Verify exclusion constraint exists
sudo -u postgres psql thefield_restore -c "\d bookings" | grep exclusion

# Step 8: Swap database (rename)
sudo -u postgres psql -c "ALTER DATABASE thefield RENAME TO thefield_old_$(date +%Y%m%d);"
sudo -u postgres psql -c "ALTER DATABASE thefield_restore RENAME TO thefield;"

# Step 9: Run any missing migrations (if backup predates latest schema)
DATABASE_MIGRATION_URL=... npm run db:migrate
DATABASE_MIGRATION_URL=... npm run db:migrate:raw

# Step 10: Restart application
pm2 start thefield

# Step 11: Run smoke test
curl https://thefield.eg/api/health/ready

# Step 12: Document: what was lost, what was restored, when
```

---

#### DR-06: Bad Deployment

**Cause:** A new release introduces a critical bug or causes crashes.  
**Detection:** Sentry error spike. UptimeRobot alert. Booking failure rate increase.  
**Impact:** Application instability or outage.

**Rollback procedure:**
```bash
ssh user@vps
cd /var/www/thefield

# Option A: Git rollback (preferred)
git log --oneline -10                # identify last known-good commit
git checkout <previous-commit-hash>  # or: git revert HEAD
npm ci
npm run build
pm2 reload thefield --update-env

# Option B: Previous build is still cached (if build artifacts retained)
# Switch symlink to previous build directory
# Restart PM2

# Verify
curl https://thefield.eg/api/health/ready
# Run smoke test
```

**Zero-downtime rollback:** With two PM2 instances, roll back one instance first, verify it is healthy, then roll back the second. This ensures continuity during the rollback.

---

#### DR-07: Database Migration Failure

**Cause:** A migration script has a bug, a destructive change, or fails midway.

**Pre-migration procedure (mandatory before any destructive migration):**
```bash
# 1. Take a pre-migration backup
pg_dump "$DATABASE_BACKUP_URL" | gzip > /tmp/pre-migration-$(date +%Y%m%d-%H%M%S).sql.gz

# 2. Verify backup integrity
gunzip -c /tmp/pre-migration-*.sql.gz | psql "$DATABASE_BACKUP_URL" -c "\dt" > /dev/null
echo "Backup verified"

# 3. Run migration on staging first
DATABASE_MIGRATION_URL="$STAGING_DB_URL" npm run db:migrate

# 4. Verify staging is healthy after migration
curl https://staging.thefield.eg/api/health/ready

# 5. Only then run on production
DATABASE_MIGRATION_URL="$PRODUCTION_DB_URL" npm run db:migrate
```

**If migration fails midway:**
1. Stop application immediately: `pm2 stop thefield`
2. Assess the partial state: which migrations ran? (`SELECT * FROM drizzle_migrations ORDER BY created_at DESC LIMIT 10;`)
3. If safe to roll back: restore from pre-migration backup (DR-05).
4. If not safe to roll back (data written by new app version): fix forward — write a corrective migration.
5. Never deploy application code that requires a schema that has not been successfully migrated.

---

#### DR-08: Lost Administrator Access

**Cause:** All super-admin accounts deactivated, passwords forgotten, `SESSION_SECRET` rotated without re-logging in.

**Recovery procedure:**
```bash
# Connect directly to PostgreSQL (requires DB credentials from environment/password manager)
psql "$DATABASE_MIGRATION_URL"

-- Check current admin state
SELECT id, email, is_active, must_change_password FROM admin_users;

-- Reactivate a deactivated admin
UPDATE admin_users 
SET is_active = true, sessions_invalidated_at = NULL
WHERE email = 'admin@thefield.eg';

-- Reset password (hash generated for 'TemporaryPassword123!')
UPDATE admin_users
SET password_hash = '$2b$12$...',  -- bcrypt hash generated offline
    must_change_password = true
WHERE email = 'admin@thefield.eg';

-- To generate the hash offline:
-- node -e "const b = require('bcryptjs'); b.hash('TemporaryPassword123!', 12).then(console.log)"
```

**Prevention:** The seed script must never be the only path to admin access. Document admin credentials in a secure password manager accessible to the venue owner, not just the developer.

---

## Section 7: Backup and Restore Plan

### 7.1 What Must Be Backed Up

| Data | Location | Backup Strategy | Recovery |
|------|----------|----------------|---------|
| PostgreSQL database | Managed PG provider | Automatic daily + PITR | Managed provider restore or pg_dump restore |
| PostgreSQL (supplementary) | VPS local daily pg_dump → R2 | Daily cron script | DR-05 procedure |
| Payment proof files | Cloudflare R2 | R2 built-in 11-nines durability | No backup needed — R2 is the backup |
| CMS/gallery images | Cloudflare R2 | Same as above | Same |
| Application source code | GitHub repository | Git history | `git checkout` |
| Environment variables | Secure password manager (offline) | Manual copy | Re-enter on new VPS |
| NGINX configuration | In Git repository (`nginx/thefield.conf`) | Git history | `git checkout` |
| PM2 configuration | In Git repository (`ecosystem.config.js`) | Git history | `git checkout` |

**What is NOT backed up (and why):**
- Application build artifacts: reproducible from source code.
- Local Node.js modules: reproducible from `package-lock.json`.
- PM2 process logs: rotated after 30 days; historical logs not critical.

### 7.2 Automated Backup Script

```bash
#!/bin/bash
# scripts/backup-db.sh
# Runs daily at 02:00 Egypt time (00:00 UTC) via crontab

set -euo pipefail

TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
BACKUP_FILE="/var/backups/thefield/thefield-${TIMESTAMP}.sql.gz"
LOG_FILE="/var/log/thefield/backup.log"
RETENTION_LOCAL_DAYS=7
RETENTION_REMOTE_DAYS=30

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1" | tee -a "$LOG_FILE"; }

log "Starting backup: $BACKUP_FILE"

# 1. Create backup
pg_dump "$DATABASE_BACKUP_URL" \
  --no-password \
  --compress=9 \
  --file="$BACKUP_FILE" \
  --format=custom  # custom format supports selective restore

if [ $? -ne 0 ]; then
  log "ERROR: pg_dump failed"
  # Alert: send email or trigger Sentry event
  curl -s -X POST "$SLACK_WEBHOOK_URL" \
    -H 'Content-type: application/json' \
    --data "{\"text\":\"🚨 The Field: Database backup FAILED at ${TIMESTAMP}\"}" || true
  exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log "Backup created: $BACKUP_FILE ($BACKUP_SIZE)"

# 2. Upload to R2
aws s3 cp "$BACKUP_FILE" \
  "s3://thefield-backups/daily/${TIMESTAMP}.sql.gz" \
  --endpoint-url "$S3_ENDPOINT" \
  --storage-class STANDARD \
  --quiet

if [ $? -ne 0 ]; then
  log "WARNING: R2 upload failed — local backup retained"
  # Non-fatal: local backup still available
else
  log "Backup uploaded to R2: daily/${TIMESTAMP}.sql.gz"
fi

# 3. Remove old local backups
find /var/backups/thefield -name "*.sql.gz" -mtime "+${RETENTION_LOCAL_DAYS}" -delete
log "Cleaned local backups older than ${RETENTION_LOCAL_DAYS} days"

# 4. Remove old R2 backups (using lifecycle rules — configured once in R2 dashboard)
# R2 lifecycle rule: delete objects in /daily/ prefix older than 30 days
# (set once in Cloudflare dashboard — no scripting needed)

log "Backup complete"
```

**Crontab entry:**
```
0 0 * * * /var/www/thefield/scripts/backup-db.sh >> /var/log/thefield/backup.log 2>&1
```

### 7.3 Backup Retention Policy

| Backup Type | Retention | Storage |
|-------------|-----------|---------|
| Daily pg_dump → R2 | 30 days | R2 `thefield-backups/daily/` |
| Daily pg_dump → local | 7 days | `/var/backups/thefield/` |
| Pre-deployment snapshots | 14 days | R2 `thefield-backups/pre-deploy/` |
| Pre-migration snapshots | 30 days | R2 `thefield-backups/pre-migration/` |
| Managed PG provider PITR | Per provider plan (typically 7–30 days) | Provider-managed |

### 7.4 Backup Verification Procedure

A backup is only reliable if it has been successfully restored. Test must be performed:
- Before launch (Milestone 6-T07).
- Monthly thereafter on staging.

```bash
#!/bin/bash
# scripts/verify-backup.sh
# Tests that the latest backup can be restored to a test database

LATEST_BACKUP=$(ls -t /var/backups/thefield/*.sql.gz | head -1)
TEST_DB="thefield_backup_test_$(date +%Y%m%d)"

echo "Testing backup: $LATEST_BACKUP"

# Create test database
sudo -u postgres createdb "$TEST_DB"

# Restore
pg_restore \
  --dbname "$TEST_DB" \
  --no-owner \
  --no-acl \
  "$LATEST_BACKUP"

# Verify minimum data integrity
BOOKING_COUNT=$(psql "postgresql://postgres@localhost/$TEST_DB" -tAc "SELECT COUNT(*) FROM bookings;")
ADMIN_COUNT=$(psql "postgresql://postgres@localhost/$TEST_DB" -tAc "SELECT COUNT(*) FROM admin_users WHERE is_active = true;")
CONSTRAINT=$(psql "postgresql://postgres@localhost/$TEST_DB" -tAc "SELECT COUNT(*) FROM pg_constraint WHERE conname = 'no_overlapping_approved_bookings';")

echo "Bookings in backup: $BOOKING_COUNT"
echo "Active admins:      $ADMIN_COUNT"
echo "Exclusion constraint present: $CONSTRAINT"

if [ "$CONSTRAINT" != "1" ]; then
  echo "ERROR: Exclusion constraint missing from backup! Investigate immediately."
  exit 1
fi

# Clean up
sudo -u postgres dropdb "$TEST_DB"
echo "Backup verification passed"
```

### 7.5 Backup Monitoring

The backup script logs to `/var/log/thefield/backup.log`. Add a cron check that verifies the backup ran:

```bash
# scripts/check-backup-freshness.sh — runs every 6 hours
LATEST=$(find /var/backups/thefield -name "*.sql.gz" -mtime -1 | wc -l)
if [ "$LATEST" -eq 0 ]; then
  echo "WARNING: No backup in the last 24 hours" | mail -s "The Field: Backup Missing" admin@thefield.eg
fi
```

Additionally: Sentry alert rule — if the backup log has not been written to in 26 hours, trigger an alert (use Sentry cron monitoring or UptimeRobot's keyword monitor on a status endpoint).

---

## Section 8: Failure Mode Analysis

This section catalogues every identified failure mode with its probability, impact, detection mechanism, recovery action, and whether it is mitigated in V1.

### 8.1 Failure Mode Classification

**Severity:**
- **S1 — Critical:** Data loss or permanent double-booking. Requires immediate response.
- **S2 — High:** Complete service outage > 5 minutes. Requires response within 30 minutes.
- **S3 — Medium:** Partial service degradation. Requires response within 2 hours.
- **S4 — Low:** Minor functional impact. Scheduled fix.

---

#### FM-01: PostgreSQL Primary Becomes Unavailable
**Severity:** S2  
**Probability:** Low (managed provider with HA)  
**Impact:** All booking operations fail. Site returns 503.  
**Detection:** `/api/health/ready` → 503. Sentry DB connection errors. UptimeRobot alert.  
**Recovery:** Managed provider auto-failover (30–90s). Application reconnects automatically.  
**V1 Mitigated?** Yes — with managed PostgreSQL. Not mitigated with self-managed PG.  
**Data at risk?** Transactions in-flight at the moment of failure may be lost. Committed transactions are safe (WAL on standby).

---

#### FM-02: Double Booking Created
**Severity:** S1  
**Probability:** Extremely low (multiple guards)  
**Impact:** Two customers confirmed for the same court/time. Venue conflict.  
**Detection:** Admin reports. Automated test: daily SQL check for overlapping approved bookings (load test cleanup query, run in production as a cron assertion).  
**Recovery:** Admin cancels one booking. Manual communication with affected customer.  
**V1 Mitigated?** Yes — PostgreSQL exclusion constraint on `booking_range`. Application-level `SELECT FOR UPDATE`. Two-layer defence.  
**How this can still happen:** If someone with `migration_user` credentials manually inserts a conflicting row, bypassing the application. Mitigated by role permissions (`app_user` cannot bypass the constraint; `migration_user` is only used during deployments).

---

#### FM-03: Payment Confirmed Without Real Payment
**Severity:** S1  
**Probability:** Low (requires malicious admin or auth bypass)  
**Impact:** Court reserved for customer who has not paid.  
**Detection:** Audit log review. Admin training.  
**Recovery:** Cancel booking. Investigate admin account.  
**V1 Mitigated?** Yes — payment verification requires `verify_payment` permission. Auto-verification is architecturally impossible (no payment gateway). `payment_status` is never accepted from the client.

---

#### FM-04: Payment Proof File Lost
**Severity:** S2  
**Probability:** Extremely low (R2 11-nines durability)  
**Impact:** Admin cannot view proof for a booking. Dispute resolution impaired.  
**Detection:** Admin reports "Proof not found" error when viewing booking.  
**Recovery:** Contact customer for re-upload. Customer uses `/booking-status` to re-upload.  
**V1 Mitigated?** Largely — R2 durability is effectively guaranteed. A proof record in `payment_proofs` without a corresponding R2 object indicates a failed upload (upload completed DB write before R2 upload — already a documented failure mode handled by the non-blocking upload flow).

---

#### FM-05: Session Secret Compromised
**Severity:** S2  
**Probability:** Low  
**Impact:** Attacker can forge admin sessions. All data exposed.  
**Detection:** Unusual admin actions in audit log. Anomalous login IPs.  
**Recovery:** Rotate `SESSION_SECRET` immediately (logs out all admins). Rotate all credentials. Review audit log for unauthorised actions.  
**V1 Mitigated?** Partially — gitleaks pre-commit hook + CI scan prevents accidental commitment. Never in code or `.env` files. Only in VPS environment.

---

#### FM-06: Booking Expiry Job Not Running
**Severity:** S3  
**Probability:** Low (PM2 auto-restarts process)  
**Impact:** Stale `pending` bookings hold slots for longer than `BOOKING_EXPIRY_MINUTES`. Customers see fewer available slots than actually exist.  
**Detection:** Sentry cron heartbeat monitor. Admin notices stale pending bookings.  
**Recovery:** `pm2 restart thefield` (restarts cron job). Manually run expiry:
```sql
UPDATE bookings SET status = 'expired', updated_at = NOW()
WHERE status = 'pending' AND expires_at < NOW();
```
**V1 Mitigated?** Partially — PM2 auto-restart. Sentry cron heartbeat added in reliability upgrade.

---

#### FM-07: Proof Upload Creates Inconsistent State (DB Success, R2 Failure)
**Severity:** S3  
**Probability:** Low  
**Impact:** `payment_proofs` row exists with a `storage_key` that has no corresponding R2 object. Admin sees "proof not found" when trying to view it.  
**Detection:** Admin reports error. Automated: daily integrity check query.  
**Recovery:** Customer re-uploads proof. Mark orphaned `payment_proofs` row as `status = 'orphaned'` (requires schema addition at Tier 3 — V1 uses application-level handling).  
**V1 Mitigated?** Partially. The non-blocking upload flow means the booking itself is not in an inconsistent state — only the proof file is missing. Customer can re-upload.  
**Prevention:** Add upload integrity check:
```typescript
// After R2 upload, before INSERT INTO payment_proofs:
const exists = await storageService.exists(key)
if (!exists) throw new StorageError('Upload verification failed')
// Only write to payment_proofs if R2 confirms the object exists
```

---

#### FM-08: Rate Limiter State Lost on Restart
**Severity:** S4  
**Probability:** Medium (every PM2 restart)  
**Impact:** Brief window (< 5 seconds) where rate limits are not enforced at application layer.  
**Detection:** Not critical enough to monitor.  
**Recovery:** NGINX rate limiting (layer 1) is not affected by PM2 restart — provides continuous protection.  
**V1 Mitigated?** Acceptable — NGINX rate limits are the primary defence.

---

#### FM-09: NGINX Misconfiguration After Deployment
**Severity:** S2  
**Probability:** Low  
**Impact:** All traffic returns 502 or incorrect routing.  
**Detection:** UptimeRobot alert within 5 minutes.  
**Recovery:**
```bash
nginx -t                          # test config before reloading
nginx -t && systemctl reload nginx  # reload only if test passes
# If bad reload: previous config still active (nginx -t prevents loading bad config)
# If process crashes: sudo systemctl start nginx
```
**V1 Mitigated?** Yes — `nginx -t` is always run before reload. Deploy script includes this check.

---

#### FM-10: Application Runs Out of Disk Space
**Severity:** S2  
**Probability:** Low (media in R2; logs rotated)  
**Impact:** Next.js build fails. PM2 logs can't be written. Application may crash.  
**Detection:** VPS disk usage monitoring. Alert at 80% used.  
**Recovery:**
```bash
df -h                             # identify usage
du -sh /var/log/thefield/*        # check log size
pm2 flush                         # clear PM2 logs
find /var/backups/thefield -name "*.sql.gz" -mtime +7 -delete  # purge old backups
# If build artifacts bloated:
rm -rf /var/www/thefield/.next
npm run build
pm2 restart thefield
```
**V1 Mitigated?** Yes — logrotate configured, R2 for media, local backup retention limit set.

---

#### FM-11: `btree_gist` Extension Removed or Disabled
**Severity:** S1  
**Probability:** Extremely low (only possible via DB admin action)  
**Impact:** Exclusion constraint becomes invalid. Overlapping approved bookings become possible.  
**Detection:** Daily integrity check SQL query. Application startup check.  
**Recovery:** Re-add extension and constraint (requires migration). Verify no conflicting bookings were created in the gap.  
**V1 Mitigated?** Check extension at startup:
```typescript
// src/lib/db/client.ts — add to startup check
const extCheck = await db.execute(sql`
  SELECT COUNT(*) as c FROM pg_extension WHERE extname = 'btree_gist'
`)
if (extCheck.rows[0].c === '0') {
  logger.error('CRITICAL: btree_gist extension is not installed. Booking integrity is compromised.')
  Sentry.captureMessage('btree_gist extension missing', 'fatal')
  // Do not exit — application still functions but sends alert
}
```

---

### 8.2 Daily Integrity Check Query (Production Cron)

Add to crontab (runs at 06:00 daily):

```bash
#!/bin/bash
# scripts/integrity-check.sh

RESULT=$(psql "$DATABASE_BACKUP_URL" -tAc "
  SELECT COUNT(*) FROM (
    SELECT court_id, booking_date, booking_range
    FROM bookings
    WHERE status = 'approved'
    GROUP BY court_id, booking_date, booking_range
    HAVING COUNT(*) > 1
  ) conflicts;
")

if [ "$RESULT" -gt 0 ]; then
  echo "CRITICAL: $RESULT overlapping approved booking(s) detected!" \
    | mail -s "🚨 The Field: BOOKING INTEGRITY VIOLATION" admin@thefield.eg
  # Also capture to Sentry:
  curl -s -X POST "https://sentry.io/api/$SENTRY_PROJECT_ID/store/" \
    -H "X-Sentry-Auth: Sentry sentry_version=7, sentry_key=$SENTRY_KEY" \
    --data '{"message":"Booking integrity violation detected","level":"fatal"}' || true
fi
```

This check catches any integrity violation that somehow bypassed the exclusion constraint (e.g., manual DB manipulation). If this script ever returns > 0, it is a S1 incident.

---

## Section 9: Hostinger Compatibility Analysis

### 9.1 What the Architecture Requires from a Hosting Provider

Before evaluating Hostinger specifically, these are the hard requirements from the architecture:

| Requirement | Reason |
|-------------|--------|
| Root access / full OS control | Installing Node.js 20, PostgreSQL client tools, NGINX, PM2, Certbot |
| Persistent process management | PM2 must survive reboots via `pm2 startup systemd` |
| Outbound internet access | R2 uploads, Sentry, npm registry, GitHub |
| Custom NGINX configuration | Rate limiting zones, upstream blocks, SSL termination |
| Minimum 4GB RAM | Next.js build requires ~1–2GB; runtime requires ~500MB per instance; PostgreSQL client overhead |
| Minimum 2 vCPU | Node.js event loop benefits from at least 2 cores for 2 PM2 instances |
| Minimum 40GB SSD | OS + Node modules + builds + logs + local backup cache |
| Port 80 and 443 accessible | NGINX public web serving |
| SSH access | Deployment automation |
| Cron job support | Backup script, integrity check, health check |

### 9.2 Hostinger VPS Plan Evaluation

Hostinger offers VPS plans under their "VPS Hosting" product line. Plans as of 2026 (verify current plans and pricing at hostinger.com):

| Plan | vCPU | RAM | Storage | Monthly Cost (approx.) | Assessment |
|------|------|-----|---------|----------------------|------------|
| KVM 1 | 1 vCPU | 4 GB | 50 GB SSD | ~$5–8 | ⚠ Minimum viable — 1 PM2 instance only. Not recommended for production. |
| KVM 2 | 2 vCPU | 8 GB | 100 GB SSD | ~$10–15 | ✓ Recommended for V1 Production (Tier 2). Supports 2 PM2 instances. |
| KVM 4 | 4 vCPU | 16 GB | 200 GB SSD | ~$20–30 | ✓ Comfortable headroom. Recommended if budget allows. |
| KVM 8 | 8 vCPU | 32 GB | 300 GB SSD | ~$40–60 | Tier 3 use case. Over-specified for V1. |

**Recommended plan for V1 Production:** KVM 2 (2 vCPU, 8 GB RAM, 100 GB SSD).

**Why KVM 1 is not recommended for production:**
- 4 GB RAM is borderline for 2 PM2 instances + NGINX + system processes.
- 1 vCPU creates CPU contention between NGINX, 2 Node.js processes, and background jobs.
- Next.js production build alone requires 1.5–2 GB RAM; this leaves almost nothing for the running application.

### 9.3 Hostinger Shared Hosting — Incompatible

Hostinger shared hosting (e.g., Premium Web Hosting, Business Web Hosting) **cannot support this architecture**. Shared hosting:
- Does not allow persistent Node.js processes.
- Does not allow PM2 or systemd.
- Does not allow custom NGINX configuration.
- Does not allow raw PostgreSQL installation.
- PHP/cPanel-based environments are fundamentally incompatible with Next.js.

**This is not negotiable.** The application requires a VPS.

### 9.4 Managed PostgreSQL Options on Hostinger

Hostinger offers managed databases on some plans. Evaluate the following:

**Option A: Hostinger Managed MySQL/PostgreSQL**
- Check current plan availability — Hostinger's managed DB offering evolves frequently.
- If available: prefer this for simplicity (same vendor, same datacenter, low latency).
- Verify: PostgreSQL 16 support, `btree_gist` extension availability, PITR, connection limits.

**Option B: External Managed PostgreSQL (Recommended)**

If Hostinger's managed PostgreSQL does not support `btree_gist`, PITR, or automatic failover, use an external provider. All of these connect via a standard PostgreSQL connection string — no code changes needed.

| Provider | Free Tier | Paid From | btree_gist | PITR | Auto-failover | Notes |
|---------|----------|----------|-----------|------|--------------|-------|
| **Neon** | Yes (0.5 GB) | $19/mo | ✓ | ✓ (7 days) | ✓ (instant branching) | Best DX, serverless PG, Egypt latency ~80ms from Frankfurt |
| **Supabase** | Yes (500 MB) | $25/mo | ✓ | ✓ (7 days on Pro) | ✓ | Full PG, includes read replicas |
| **Aiven** | No | $19/mo | ✓ | ✓ | ✓ | Enterprise-grade, multiple regions |
| **Render** | No | $20/mo | ✓ | ✓ | ✓ | Simple setup |
| **Self-managed on VPS** | N/A | VPS cost | ✓ | Manual only | Manual only | Not recommended — adds operational burden |

**Recommended: Neon** for V1.
- Generous free tier for initial development and staging.
- `btree_gist` available (critical for exclusion constraint).
- Serverless architecture means no idle costs.
- Connection pooling built-in (via pgBouncer-compatible pooler).
- Located in Europe (Frankfurt) — ~80ms from Egypt, acceptable for V1.
- PITR on paid plans.

**Latency note:** An external managed DB from Frankfurt to a Hostinger VPS in the Netherlands adds ~10ms per query. For the booking creation transaction (5–8 queries), this adds ~50–80ms. This is within the acceptable budget for a p95 < 500ms availability endpoint.

### 9.5 Hostinger Datacenter Selection

Available Hostinger locations include Netherlands (Amsterdam), US, UK, Singapore, India, and Brazil. For Egypt-based customers:

**Recommended: Netherlands (Amsterdam) or Frankfurt (if available)**
- ~40–60ms round-trip from Cairo (Egyptian 4G to European datacenter).
- Much better than US (~150ms) or Asia (~200ms+).
- Cloudflare's Cairo PoP caches static content locally — the VPS round-trip only matters for dynamic API requests.

### 9.6 Can Hostinger Support the Full Target Architecture?

| Component | Hostinger Support | Assessment |
|-----------|-----------------|------------|
| Next.js / Node.js VPS | ✓ Full support on KVM plans | Compatible |
| PM2 process manager | ✓ Full support | Compatible |
| NGINX with custom config | ✓ Full support | Compatible |
| Multiple PM2 instances | ✓ on KVM 2+ | Compatible |
| PostgreSQL client tools | ✓ (install via apt) | Compatible |
| Cron jobs | ✓ | Compatible |
| SSH access + deployment automation | ✓ | Compatible |
| Two separate VPS nodes (Tier 3) | ✓ (buy two plans) | Compatible |
| Managed PostgreSQL with btree_gist | ⚠ Verify per plan | Use Neon if unavailable |
| Managed PostgreSQL with PITR | ⚠ Verify per plan | Use Neon if unavailable |
| Active health check load balancer | ⚠ NGINX OSS = passive only | Acceptable for V1; use HAProxy at Tier 3 |
| Cloudflare R2 storage | ✓ External service | Compatible |

**Verdict:** Hostinger KVM VPS is fully compatible with the V1 architecture. The primary gap is managed PostgreSQL with enterprise features — which is resolved by using Neon as an external provider.

### 9.7 Hostinger Limitations to Accept and Document

1. **Single VPS = single host failure point.** Acceptable for Tier 2. Requires two VPS nodes for Tier 3.
2. **No built-in load balancer.** NGINX on the VPS handles load balancing for multiple PM2 instances. For separate nodes, Cloudflare load balancing (Pro plan) or a dedicated HAProxy instance is needed.
3. **No auto-scaling.** Scaling requires manual VPS upgrade or buying a second VPS. This is appropriate for V1 volumes.
4. **VPS storage is not replicated.** Files on VPS local disk can be lost on hardware failure. This is why all persistent files go to Cloudflare R2, not the VPS disk.
5. **NGINX OSS lacks active health checks.** Passive health checks (marking upstream failed after actual failed requests) are sufficient for V1 with low concurrent traffic.

---

## Section 10: V1 Cost-Aware Deployment Architecture

Three tiers. Each tier is a complete, valid deployment configuration — not a partial state. The appropriate tier depends on actual traffic and reliability needs.

### Tier 1: Development

**Purpose:** Local development and CI testing. Not for customer traffic.

| Component | Solution | Cost |
|-----------|---------|------|
| Application | `npm run dev` on developer machine | $0 |
| Database | Docker Compose PostgreSQL 16 | $0 |
| Storage | Local disk (`STORAGE_PROVIDER=local`) | $0 |
| Cloudflare | Not used | $0 |
| Monitoring | None (Sentry dev project) | $0 |
| CI | GitHub Actions (free tier) | $0 |
| **Total** | | **$0/month** |

**Failure tolerance:** None — single developer machine.  
**Scaling:** N/A.

---

### Tier 2: V1 Initial Production

**Purpose:** Live website for The Field. Handles estimated 10–50 bookings/day. Appropriate from launch until measurable traffic growth.

| Component | Solution | Spec | Monthly Cost (approx.) |
|-----------|---------|------|----------------------|
| Application | Hostinger KVM 2 VPS | 2 vCPU, 8 GB RAM, 100 GB SSD | ~$12–15 |
| NGINX | On same VPS | — | included |
| PM2 instances | 2 on same VPS (ports 3000, 3001) | — | included |
| Database | Neon Serverless PostgreSQL | Launch plan | ~$19 |
| Object storage | Cloudflare R2 | Free tier (10 GB) | $0 |
| CDN/WAF/DDoS | Cloudflare Free plan | — | $0 |
| TLS | Let's Encrypt (Certbot) | — | $0 |
| Error tracking | Sentry Free (5K events/mo) | — | $0 |
| Uptime monitoring | UptimeRobot Free (50 monitors) | — | $0 |
| CI/CD | GitHub Actions Free (2000 min/mo) | — | $0 |
| DNS | Cloudflare Free | — | $0 |
| Backup storage | R2 (included in free tier) | — | $0 |
| **Total** | | | **~$31–34/month** |

**Failure tolerance:**
- App instance crash: PM2 auto-restart (~10s). Second PM2 instance absorbs traffic.
- VPS failure: Full outage. Recovery time: ~2 hours from backup.
- DB failure: Neon auto-failover (~60s).
- Storage failure: Non-blocking. Customer can re-upload.

**Availability target:** 99.5%  
**RPO:** 24 hours (daily backup)  
**RTO:** 2 hours (VPS rebuild + restore)

**When to upgrade to Tier 3:** When any of the following is measured:
- App CPU sustained > 70% during peak hours.
- VPS memory consistently > 75% used.
- Booking volume > 100/day.
- A VPS hardware incident causes unacceptable downtime.

---

### Tier 3: High-Availability Production

**Purpose:** After measured growth. Tolerates single VPS failure without downtime. Appropriate when The Field has consistent booking volume and downtime causes measurable revenue loss.

| Component | Solution | Spec | Monthly Cost (approx.) |
|-----------|---------|------|----------------------|
| Application Node A | Hostinger KVM 2 VPS | 2 vCPU, 8 GB RAM | ~$12–15 |
| Application Node B | Hostinger KVM 2 VPS | 2 vCPU, 8 GB RAM | ~$12–15 |
| Load balancing | Cloudflare Load Balancing (Pro) OR HAProxy on a small VPS | — | ~$5 (HAProxy VPS) or $10 (CF LB) |
| Database | Neon Launch with standby OR Supabase Pro | Sync standby, PITR 7 days | ~$19–25 |
| Object storage | Cloudflare R2 | Free tier | $0 |
| CDN/WAF/DDoS | Cloudflare Pro | WAF + Bot management | ~$20 |
| Rate limiting (distributed) | Upstash Redis (free tier) | Shared rate limiter | $0 |
| Error tracking | Sentry Team (~$26/mo) | — | ~$26 |
| Uptime monitoring | UptimeRobot Pro | SMS alerts | ~$7 |
| CI/CD | GitHub Actions | — | $0 |
| **Total** | | | **~$96–107/month** |

**Failure tolerance:**
- App instance crash: Zero user impact. NGINX routes to surviving node.
- VPS failure (one node): Zero user impact. Cloudflare/HAProxy routes to other node.
- DB failure: Neon/Supabase auto-failover in < 60 seconds.
- Storage failure: Non-blocking.

**Availability target:** 99.9%  
**RPO:** 5 minutes (PITR)  
**RTO:** 30 minutes (automated failover + health check recovery)

**Tier 3 additional changes beyond Tier 2:**
- Add `job_locks` table for expiry job coordination (Section 1.4).
- Switch `RateLimiterMemory` → `RateLimiterRedis` (Upstash) for shared rate limiting.
- Add `INSTANCE_ID` environment variable per node (used by job lock, logging).
- NGINX on each node forwards to its own local instances only — Cloudflare LB handles node-level routing.
- Database write endpoint always points to primary. Read-only queries (dashboard counts, audit logs) may optionally use read replica.

---

### Cost-Benefit Summary

| Tier | Monthly Cost | Availability | VPS Failure RTO | Booking Volume Limit |
|------|------------|-------------|----------------|-------------------|
| Tier 2 | ~$31–34 | 99.5% | ~2 hours | ~200 bookings/day |
| Tier 3 | ~$96–107 | 99.9% | ~30 min | ~2000 bookings/day |

**Recommendation:** Start at Tier 2. The incremental cost of Tier 3 (~$65/month more) is justified only when downtime has a direct, measurable revenue impact. For a padel venue doing 10–50 bookings/day at ~400 EGP each, a 2-hour outage costs at most 4–8 bookings (~1,600–3,200 EGP / ~$30–65). The annual cost of Tier 3 over Tier 2 is ~$780/year — roughly equivalent to the cost of 2–3 such outages. This trade-off must be made by the venue owner after reviewing actual booking data, not in advance.

---

## Section 11: Future High-Availability Deployment Architecture

This section defines the Tier 3 architecture in full technical detail, so it can be implemented without architectural redesign when traffic warrants it.

### 11.1 Multi-Node Architecture Diagram

```
                    thefield.eg
                         │
              Cloudflare DNS (anycast)
                         │
              Cloudflare Edge (WAF + CDN)
                         │
                Cloudflare Load Balancer
                (or HAProxy on VPS-LB)
               /                     \
              /                       \
   VPS Node A (Amsterdam)    VPS Node B (Amsterdam)
   ┌──────────────────┐      ┌──────────────────┐
   │ NGINX            │      │ NGINX            │
   │ PM2 App :3000    │      │ PM2 App :3000    │
   │ PM2 App :3001    │      │ PM2 App :3001    │
   │ node-cron *      │      │ node-cron (idle) │
   └────────┬─────────┘      └────────┬─────────┘
            │                         │
            └──────────┬──────────────┘
                       │
              Neon / Supabase PostgreSQL
              ┌────────────────────────┐
              │ Primary (write)        │
              │ Standby (auto-failover)│
              │ Read replica (optional)│
              │ PITR: 7 days           │
              └────────────────────────┘
                       │
              Cloudflare R2
              (shared between all nodes)

* One node runs the cron job (determined by job_locks table)
```

### 11.2 Cloudflare Load Balancing Configuration

**Option A: Cloudflare Load Balancing (Pro plan, ~$10/month)**

```
Origin Pool: thefield-origins
  Origin 1: VPS Node A IP — weight 1
  Origin 2: VPS Node B IP — weight 1

Health Check:
  Path: /api/health/ready
  Interval: 30 seconds
  Retries: 2
  Expected status: 200
  Timeout: 5 seconds

Failover: Remove origin from pool if health check fails 2× consecutively
Session Affinity: None (stateless application — not needed)
Load Balancing Policy: Round-robin
```

**Option B: HAProxy on a Dedicated Small VPS (~$5/month)**

```
frontend thefield_frontend
    bind *:443 ssl crt /etc/ssl/thefield.pem
    default_backend thefield_backend

backend thefield_backend
    balance leastconn
    option httpchk GET /api/health/ready
    http-check expect status 200

    server nodeA 10.0.0.1:3000 check inter 5s fall 2 rise 3
    server nodeB 10.0.0.2:3000 check inter 5s fall 2 rise 3

    # Retry policy: retry on connection failure, NOT on POST
    retries 2
    option redispatch
```

HAProxy supports active health checks without a paid plan, making it preferable to NGINX Plus for Tier 3 load balancing.

### 11.3 Session Continuity Across Nodes

iron-session stores all session data in the encrypted cookie. The cookie is decrypted by whichever node receives the request using the shared `SESSION_SECRET`. This means:

- Admin logs in on Node A → session cookie issued.
- Next request routes to Node B → Node B decrypts cookie with same `SESSION_SECRET` → session valid.
- No shared session store required.
- No sticky sessions required.

**Requirement:** `SESSION_SECRET` must be identical across all nodes. Managed via environment variables set identically on both VPS instances.

### 11.4 Database Connection Management at Tier 3

With 4 PM2 instances across 2 nodes (2 per node × 2 nodes), each with a pool of 10:

```
Total max connections: 4 × 10 = 40 connections
+ migrations/admin:        5
+ monitoring:              5
Safety buffer:            10
─────────────────────────────
Total required:           60 connections
```

Most managed PostgreSQL plans support 60–100 connections. At Tier 3, add PgBouncer in transaction mode between the application and PostgreSQL:

```
Node A: App × 2 (20 conns) ──┐
Node B: App × 2 (20 conns) ──┤──► PgBouncer on DB-adjacent node ──► PostgreSQL (15 server conns)
```

With PgBouncer, 40 application connections are multiplexed onto 15 PostgreSQL server connections. This allows scaling to more nodes without exhausting PostgreSQL's connection limit.

### 11.5 Upgrade Path from Tier 2 to Tier 3

The following steps upgrade a running Tier 2 deployment to Tier 3 without extended downtime:

```
Step 1: Provision VPS Node B with identical configuration to Node A
Step 2: Clone application, set environment variables (same SESSION_SECRET, VENUE_ID, etc.)
Step 3: Add job_locks table via migration: npm run db:migrate
Step 4: Switch rate limiter from RateLimiterMemory → RateLimiterRedis (Upstash)
         (code change: src/lib/rate-limiter.ts — swap constructor, no API changes)
Step 5: Set INSTANCE_ID=node-b on Node B environment
Step 6: Start application on Node B, verify health endpoint
Step 7: Add Node B to Cloudflare Load Balancer (or HAProxy config)
Step 8: Verify load is distributed (check NGINX access logs on both nodes)
Step 9: Update Cloudflare origin pool to include both nodes
Step 10: Monitor for 30 minutes, verify no errors
```

**No downtime required.** Node A continues serving all traffic during setup. Node B is added to rotation only after it passes health checks.

---

## Section 12: Updated Monitoring and Alerting Architecture

### 12.1 Monitoring Stack

| Tool | Role | Tier | Cost |
|------|------|------|------|
| UptimeRobot | External uptime checks, status page | All | Free |
| Sentry | Error tracking, performance traces, cron monitoring | All | Free → Team |
| PM2 Monitor | Per-node CPU/memory/restarts | All | Built-in |
| PostgreSQL logs + pg_stat_statements | Slow query detection | All | Built-in |
| pino (structured logs) | Application event log | All | Built-in |
| logrotate | Log file management | All | Built-in |
| NGINX access + error logs | HTTP-level visibility | All | Built-in |
| Grafana + k6 (load testing only) | Load test visualisation | Testing | Free |
| Upstash Redis (Tier 3) | Rate limiter state | Tier 3 | Free |

### 12.2 What Must Be Monitored

#### Application Layer

| Metric | How | Alert Threshold | Alert Target |
|--------|-----|----------------|-------------|
| HTTP uptime | UptimeRobot, 5-min checks | Any downtime | Developer + Owner (SMS) |
| HTTP error rate (5xx) | Sentry + NGINX logs | > 1% over 5 min | Developer |
| API p95 latency | Sentry performance | > 2000ms sustained | Developer |
| Booking creation failures | Sentry (filter to booking route) | > 3 failures in 10 min | Developer + Admin |
| Admin login failures | Sentry + audit_logs | > 20 failures for 1 email in 1 hour | Developer (security) |
| PM2 process restarts | PM2 event log | > 3 restarts in 10 min | Developer |
| Memory usage per instance | PM2 | > 800MB | Developer |
| CPU usage per node | VPS provider dashboard | > 80% for 10 min | Developer |
| Background job heartbeat | Sentry cron monitor | Job not completed in 20 min | Developer |

#### Database Layer

| Metric | How | Alert Threshold | Alert Target |
|--------|-----|----------------|-------------|
| DB connectivity | `/api/health/ready` | 503 response | Developer + Owner |
| Active connections | pg_stat_activity in health check | > 80% of max_connections | Developer |
| Slow queries (> 1s) | postgresql.conf `log_min_duration_statement=1000` | Weekly review | Developer |
| Backup completion | Backup script log + cron check | > 26h since last backup | Developer |
| Disk usage | VPS provider + managed DB dashboard | > 70% disk | Developer |

#### Security Layer

| Metric | How | Alert Threshold | Alert Target |
|--------|-----|----------------|-------------|
| Admin login brute-force | Sentry + audit_logs query | > 20 failures/1 email/1h | Developer |
| Rate limit hit rate (429) | NGINX access logs | > 50 per minute from single IP | Developer |
| Booking integrity | Daily integrity check script (Section 8.2) | > 0 conflicts | Developer + Owner (CRITICAL) |
| btree_gist extension | Application startup check | Extension missing | Developer (CRITICAL) |

#### Business Layer (Operational Monitoring)

| Metric | How | Review Cadence |
|--------|-----|----------------|
| Total bookings by status | Admin dashboard | Daily |
| Booking completion rate | Admin dashboard | Weekly |
| Average payment verification time | DB query | Weekly |
| Storage usage | R2 console | Monthly |
| Error rate trend | Sentry trends | Weekly |

### 12.3 Sentry Configuration for Reliability

```typescript
// src/instrumentation.ts — enhanced Sentry configuration

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.npm_package_version,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  integrations: [
    // Capture slow PostgreSQL queries as performance spans
    new Sentry.Integrations.Postgres(),
  ],

  beforeSend(event) {
    // Scrub sensitive data before sending to Sentry
    const SENSITIVE_KEYS = ['customerPhone', 'phone_number', 'password',
                            'customerName', 'SESSION_SECRET', 'DATABASE_URL',
                            'S3_SECRET_ACCESS_KEY', 'storage_key']

    function scrub(obj: any): any {
      if (!obj || typeof obj !== 'object') return obj
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) =>
          SENSITIVE_KEYS.some(s => k.toLowerCase().includes(s.toLowerCase()))
            ? [k, '[REDACTED]']
            : [k, scrub(v)]
        )
      )
    }

    if (event.request?.data) event.request.data = scrub(event.request.data)
    if (event.extra) event.extra = scrub(event.extra)
    return event
  },
})
```

### 12.4 Structured Log Schema

Every application log entry must follow this schema:

```typescript
interface LogEntry {
  // Always present
  level:     'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  time:      string         // ISO 8601 UTC
  msg:       string         // human-readable description
  requestId: string         // UUID, generated per request in middleware

  // Present on HTTP request logs
  method?:   string
  path?:     string
  status?:   number
  duration?: number         // ms

  // Present on business events
  event?:    string         // 'booking_created', 'booking_approved', etc.
  bookingReference?: string
  courtId?:  string
  adminId?:  string         // UUID only, never email

  // Present on errors
  err?:      { message: string, stack?: string, code?: string }

  // NEVER present in logs (pino redact config enforces this):
  // customerPhone, phone_number, password, SESSION_SECRET,
  // DATABASE_URL, S3_SECRET_ACCESS_KEY, storage_key
}
```

### 12.5 Request ID Propagation

```typescript
// src/app/middleware.ts (add to existing middleware)
import { randomUUID } from 'crypto'

export function middleware(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? randomUUID()
  const res = NextResponse.next()

  // Forward request ID to application for logging
  res.headers.set('x-request-id', requestId)

  // Include in response for debugging
  res.headers.set('x-request-id', requestId)

  // ... existing security headers ...
  return res
}
```

Every log entry includes `requestId`. This allows correlating all log lines for a single booking creation request across the application.

### 12.6 NGINX Access Log Format

```nginx
# /etc/nginx/nginx.conf
log_format json_combined escape=json
  '{'
    '"time":"$time_iso8601",'
    '"method":"$request_method",'
    '"path":"$request_uri",'
    '"status":$status,'
    '"duration":$request_time,'
    '"bytes":$body_bytes_sent,'
    '"ip":"$remote_addr",'
    '"request_id":"$http_x_request_id",'
    '"upstream":"$upstream_addr",'
    '"upstream_status":$upstream_status'
  '}';

access_log /var/log/nginx/thefield_access.log json_combined;
error_log  /var/log/nginx/thefield_error.log warn;
```

JSON access logs allow log analysis tools (grep, jq, or a future Logtail integration) to query structured data without parsing.

### 12.7 Alert Runbook References

Every alert must have a corresponding runbook entry in `docs/runbooks/`. Required runbooks:

| Alert | Runbook |
|-------|---------|
| Site down (UptimeRobot) | `runbooks/site-down.md` |
| Booking failures spike | `runbooks/booking-failures.md` |
| Database unavailable | `runbooks/database-unavailable.md` |
| Admin login brute-force | `runbooks/security-incident.md` |
| Booking integrity violation | `runbooks/booking-integrity-violation.md` |
| Background job not running | `runbooks/background-job-failure.md` |
| Disk usage > 70% | `runbooks/disk-full.md` |

Each runbook follows this structure:
1. What triggered this alert.
2. Immediate diagnostic steps.
3. Recovery actions (ordered by likelihood of resolving the issue).
4. Escalation path if steps don't resolve the issue.
5. Post-incident: what to document.

---

## Section 13: Updated Deployment Strategy

### 13.1 Deployment Architecture

The final deployment architecture after incorporating the production reliability requirements described in Sections 1–12 is a tiered design. Version 1 starts at **Tier 2** (V1 Production). **Tier 3** (High Availability) is activated when measured traffic signals justify it.

```
┌──────────────────────────────────────────────────────────────────┐
│  TIER 2 — V1 PRODUCTION (Day One)                               │
│                                                                  │
│  Cloudflare (Free/Pro)                                           │
│  • DNS (anycast, TTL 300s)                                       │
│  • TLS 1.3 (full strict mode — VPS has its own certificate)      │
│  • WAF (OWASP Core Rule Set)                                     │
│  • CDN (static assets, gallery images only)                      │
│  • DDoS protection (automatic)                                   │
│  • Cache bypass rules: /api/*, /admin/*, /booking-status         │
│                                                                  │
│  Hostinger KVM 2 VPS (Amsterdam)                                 │
│  • NGINX 1.24+ reverse proxy + rate limiting                     │
│  • PM2 — 2 instances (ports 3000, 3001)                          │
│  • Certbot / Let's Encrypt (origin TLS)                          │
│                                                                  │
│  Neon Serverless PostgreSQL (Launch plan)                        │
│  • Single primary, automated daily backups                       │
│  • PgBouncer pooler built-in                                     │
│  • PITR on paid plan                                             │
│                                                                  │
│  Cloudflare R2                                                   │
│  • thefield-private (payment proofs)                             │
│  • thefield-public (gallery, CMS, court images)                  │
│  • thefield-backups (pg_dump archives)                           │
│                                                                  │
│  External services                                               │
│  • Sentry (error tracking + performance)                         │
│  • UptimeRobot (uptime checks, status page)                      │
│  • GitHub Actions (CI/CD)                                        │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  TIER 3 — HIGH AVAILABILITY (After measured growth)             │
│                                                                  │
│  Cloudflare Pro                                                  │
│  • All Tier 2 features +                                         │
│  • Load Balancing (two origin pools, active health checks)       │
│  • Bot management                                                │
│                                                                  │
│  VPS Node A + VPS Node B (separate Hostinger instances)          │
│  • NGINX + 2 PM2 instances per node                              │
│  • Identical configuration, same SESSION_SECRET                  │
│                                                                  │
│  Neon or Supabase Pro / Aiven                                    │
│  • Synchronous standby replica (auto-failover < 60s)             │
│  • PITR 7 days                                                   │
│  • PgBouncer pooler                                              │
│                                                                  │
│  Upstash Redis (Tier 3 addition)                                 │
│  • Shared rate limiter (RateLimiterRedis)                        │
│  • Job lock table (see Section 1.4) OR Redis SETNX               │
│                                                                  │
│  Same R2 setup — no changes needed                               │
└──────────────────────────────────────────────────────────────────┘
```

**What changes between Tier 2 and Tier 3:**

| Component | Tier 2 | Tier 3 |
|-----------|--------|--------|
| VPS nodes | 1 (single host failure risk) | 2 on separate hosts |
| PM2 instances | 2 on same VPS | 2 per node (4 total) |
| Load balancing | NGINX on VPS | Cloudflare LB + NGINX per node |
| PostgreSQL HA | Managed with backups | Managed with synchronous standby |
| Rate limiter | In-memory per instance | Shared Redis |
| Job coordination | Safe due to atomic SQL | DB `job_locks` table |
| Estimated cost | ~$31–34/month | ~$96–107/month |

**What does not change between tiers:**

- Application code — stateless by design, requires no modification.
- Session handling — iron-session encrypted cookies, cross-instance compatible.
- Booking integrity — PostgreSQL exclusion constraint, unchanged at all tiers.
- Object storage — Cloudflare R2, same configuration.
- OBDs — remain pending at all tiers.

---

### 13.2 V1 Deployment

The recommended V1 Production deployment from day one is **Tier 2**.

**Required components from day one:**

| Component | Required | Justification |
|-----------|---------|--------------|
| Cloudflare Free (DNS, TLS, DDoS, WAF) | Yes | No cost. Protects VPS from direct exposure. Provides CDN for static assets. |
| Hostinger KVM 2 VPS (2 vCPU, 8 GB RAM) | Yes | Minimum spec for 2 PM2 instances + NGINX + build tooling. |
| 2 PM2 instances (port 3000 + 3001) | Yes | In-process redundancy. If one crashes, NGINX routes to the other during restart. |
| NGINX (reverse proxy + rate limiting) | Yes | Provides rate limiting, header security, and upstream health tracking. |
| Certbot / Let's Encrypt (origin cert) | Yes | HTTPS on origin. Cloudflare full strict mode requires a valid origin cert. |
| Neon PostgreSQL (Launch plan) | Yes | Managed PostgreSQL with PITR and automatic failover. Self-managed PostgreSQL on the VPS is not acceptable — it creates a single host dependency for the primary data store. |
| Cloudflare R2 (private + public buckets) | Yes | Payment proofs and media must not live on the VPS disk. |
| Sentry (Free tier) | Yes | Error tracking is a launch requirement, not a post-launch addition. |
| UptimeRobot (Free tier) | Yes | External uptime monitoring and alert. |
| GitHub Actions (CI/CD) | Yes | Deployment must be repeatable and safe. Manual `git pull` without tests is not acceptable for production. |
| Graceful shutdown (SIGTERM handler) | Yes | Required for safe two-instance PM2 restarts. |
| `/api/health/live` and `/api/health/ready` | Yes | Required for NGINX passive upstream health checks and PM2 monitoring. |
| DB connection pool (max 10 per instance) | Yes | Prevents connection exhaustion. |
| Automated daily pg_dump → R2 | Yes | 24-hour RPO minimum. |
| Backup restore test (before launch) | Yes | A backup that has never been tested is not a backup. |

**What is NOT required on day one:**

- Second VPS node (Tier 3 — adds cost without justified need at initial volume).
- Cloudflare Load Balancing paid feature.
- Upstash Redis (in-memory rate limiter sufficient for 1–2 instances).
- PgBouncer (Neon's built-in pooler is sufficient).
- HAProxy.
- `job_locks` table (atomic SQL UPDATE is safe for 2 instances).

---

### 13.3 Scaled Deployment

The decision to move from Tier 2 to Tier 3 must be driven by **measured signals**, not anticipated traffic. The following conditions, when sustained over 5 consecutive business days, indicate that Tier 3 is justified:

| Signal | Measurement | Tier 3 Trigger |
|--------|------------|----------------|
| Application CPU | pm2 monit / VPS panel | > 70% sustained during peak hours |
| Application memory | pm2 monit | Per-instance RSS > 750 MB consistently |
| API p95 latency | Sentry performance | Booking creation > 1500ms p95 |
| DB connections | `pg_stat_activity` | Regularly > 80% of `max_connections` |
| Daily bookings | Admin dashboard | Consistently > 100 bookings/day |
| VPS incident | Incident report | Any VPS hardware failure causing > 2hr downtime |
| Load test results | k6 (Section 5) | 50 VU test causes error rate > 2% |

**How to measure these signals in production:**

- Run `pm2 monit` on the VPS, or configure PM2 to emit metrics to a monitoring dashboard.
- Set Sentry performance alert at p95 > 1500ms.
- Add a weekly cron that queries `pg_stat_activity` and logs the connection count.
- Check the admin dashboard booking count daily after the first month.

**Tier 3 upgrade requires no code changes.** Add `INSTANCE_ID` env var, swap `RateLimiterMemory` → `RateLimiterRedis`, add `job_locks` migration, provision second VPS, update NGINX/Cloudflare routing. The application logic is unchanged.

---

### 13.4 Deployment Process

Every production deployment follows this sequence. Steps are mandatory — skipping a step requires explicit justification and approval.

```
PRE-DEPLOYMENT
─────────────
1. Ensure all tests pass on the `main` branch (CI gate — automated).
2. Take a pre-deployment database backup:
   pg_dump "$DATABASE_BACKUP_URL" | gzip > pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz
   Upload to R2: s3://thefield-backups/pre-deploy/
3. If the deployment includes a database migration:
   a. Apply migration to STAGING first.
   b. Verify staging health: GET /api/health/ready → 200.
   c. Run smoke test on staging.
   d. Only then proceed to production.

BUILD
─────
4. GitHub Actions CI runs automatically on push to `main`:
   - npm ci
   - npx tsc --noEmit
   - npx eslint src --max-warnings 0
   - npm run test:unit -- --run
   - npm run test:integration -- --run
   - npm audit --audit-level=high
   - semgrep --config=p/typescript src/
   - gitleaks detect
   - npm run build
5. All steps must pass. A failing step blocks deployment.

DEPLOYMENT (SSH to VPS, or via GitHub Actions SSH action)
──────────────────────────────────────────────────────────
6. git pull origin main
7. npm ci
8. npm run db:migrate        (Drizzle migrations — idempotent)
9. npm run db:migrate:raw    (raw SQL: booking_range, exclusion constraint, indexes)
10. npm run build
11. pm2 reload thefield --update-env   (graceful reload — see Section 13.5)

HEALTH VERIFICATION
────────────────────
12. Wait 10 seconds for instances to become ready.
13. curl -s https://thefield.eg/api/health/ready | jq .
    → Must return { "status": "ready", "database": "connected" }
    → If 503: check pm2 logs and roll back immediately.
14. Verify NGINX upstream health:
    curl -s https://thefield.eg/api/health/live → 200

TRAFFIC ACTIVATION
───────────────────
15. With 2 PM2 instances:
    - PM2 reload restarts one instance at a time (rolling).
    - NGINX automatically routes to the live instance during the brief restart.
    - No manual traffic switching required.

POST-DEPLOYMENT VERIFICATION
──────────────────────────────
16. Run smoke test:
    a. GET / → 200 (public homepage loads)
    b. GET /api/v1/courts → 200 (court list returns data)
    c. GET /api/v1/availability?courtId=TEST&date=TEST → 200 or 400 (no 500)
    d. GET /admin/login → 200 (admin login page loads)
    e. GET /api/health/ready → 200
17. Check Sentry: no new error spikes in the 5 minutes after deployment.
18. Check UptimeRobot: all monitors show "up".
19. Document deployment: commit hash, time, who deployed, any issues.
```

---

### 13.5 Graceful Shutdown

When an application instance receives SIGTERM (from PM2 reload, VPS reboot, or deployment), it must:

1. Immediately set `isShuttingDown = true` in the process.
2. Return 503 from `/api/health/ready` — this signals NGINX to stop routing new requests to this instance within 2 failed health checks (~10 seconds on the passive check timeout).
3. Allow all in-flight requests up to 30 seconds to complete naturally.
4. Close the PostgreSQL connection pool cleanly.
5. Exit with code 0.

```typescript
// src/lib/graceful-shutdown.ts
let isShuttingDown = false

export function isReady(): boolean {
  return !isShuttingDown
}

export function registerGracefulShutdown(pool: Pool): void {
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received — starting graceful shutdown')
    isShuttingDown = true
    // /api/health/ready now returns 503 — NGINX stops routing here
    // Allow in-flight requests to complete
    await new Promise(resolve => setTimeout(resolve, 30_000))
    await pool.end()
    logger.info('Graceful shutdown complete')
    process.exit(0)
  })
}
```

**PM2 configuration additions required:**

```javascript
// ecosystem.config.js
kill_timeout:    35_000,   // wait 35s before force kill (gives shutdown 30s to finish)
listen_timeout:   5_000,   // how long to wait for instance to become ready after start
exp_backoff_restart_delay: 100,
```

**NGINX passive health check window:** With `max_fails=2 fail_timeout=10s`, NGINX marks an upstream unavailable after 2 failed requests within 10 seconds. The graceful shutdown returns 503 from `/api/health/ready` and NGINX stops routing within that window. The 30-second in-flight completion window fits comfortably — NGINX removes the instance from rotation well before in-flight requests are forcibly closed.

**What must NOT happen during shutdown:**

- A booking INSERT must never be left in a partially committed state.
- A file upload must never be abandoned mid-stream without the booking returning to `pending`.
- The booking expiry cron job must not run during the shutdown window.

---

### 13.6 Database Migration Strategy

Database migrations are the highest-risk step in any deployment. The following rules are non-negotiable.

**Classification of migrations:**

| Type | Risk | Required precaution |
|------|------|-------------------|
| Add new table | Low | Test on staging, run before app deployment |
| Add nullable column | Low | Test on staging, run before app deployment |
| Add NOT NULL column with default | Medium | Test on staging; app must handle both old and new schema during transition |
| Rename column | High | Multi-step: add new column → backfill → update app → remove old column |
| Drop column | High | Multi-step: stop writing to column → deploy → drop |
| Change column type | High | Multi-step with backfill |
| Drop table | Critical | Full backup required; staging test required; manual approval required |

**Migration sequencing rules:**

1. **Migration before application.** Schema must be migrated before the application version that requires it is deployed. Never deploy an application version that requires a schema change that has not been run.
2. **Backward compatibility required.** During a rolling deploy (2 PM2 instances, one restarts at a time), the old app version and the new app version run simultaneously for ~30 seconds. The schema must be valid for both versions during this window.
3. **Never run migrations against production without running them on staging first.**
4. **Take a pre-migration backup.** See Step 2 in the deployment process.
5. **Verify the exclusion constraint after every migration that touches the `bookings` table:**
   ```sql
   SELECT conname FROM pg_constraint WHERE conname = 'no_overlapping_approved_bookings';
   -- Must return exactly 1 row.
   ```
6. **Verify the `booking_range` generated column after every `bookings` migration:**
   ```sql
   SELECT column_name, generation_expression
   FROM information_schema.columns
   WHERE table_name = 'bookings' AND column_name = 'booking_range';
   -- Must return 1 row.
   ```

**The `db:migrate:raw` script** (`scripts/migrate-raw.sh`) applies the raw SQL migrations that Drizzle cannot manage (the generated column and exclusion constraint). This script is idempotent — it uses `ADD COLUMN IF NOT EXISTS` and `DROP CONSTRAINT IF EXISTS` before re-adding. It must be run on every deployment, not just the first.

---

### 13.7 Rollback Strategy

**Application rollback** and **database rollback** are separate concerns with separate procedures.

#### Application Rollback

Application code can be rolled back safely and quickly:

```bash
cd /var/www/thefield

# Option A: Roll back to the previous Git commit
git log --oneline -5          # identify the last known-good commit hash
git checkout <commit-hash>
npm ci
npm run build
pm2 reload thefield --update-env

# Option B: If the previous build is cached on disk
# Set a build artifact retention policy to keep the last 2 builds
# Switch symlink and restart PM2 (faster — no rebuild needed)
```

With 2 PM2 instances, roll back instance A first, verify it is healthy, then roll back instance B. This ensures continuity during the rollback window.

**Application rollback is always safe provided the database schema has not changed destructively.**

#### Database Rollback

**Database rollback is not always safe.** The rules:

| Scenario | Can roll back? | Procedure |
|----------|---------------|-----------|
| Additive migration only (new table, new column) | Yes — restore from pre-deploy backup if needed | Restore from backup (DR-05 in Section 6) |
| Migration with data written by new app version | No — rolling back the schema loses that data | Fix forward: write a corrective migration |
| Dropped column still referenced by old app | Depends | If no data was written to the new schema: restore from pre-deploy backup |
| Destructive migration (dropped table, type change) | No — do not auto-rollback | Restore from pre-migration backup; assess data loss |

**Rule: Never automatically roll back a destructive database migration.** Assess the actual data loss, communicate to the venue owner, and restore from backup only if the data loss is acceptable and the backup is verified to be newer than the loss window.

**The pre-deployment backup** (taken in Step 2 of the deployment process) is the rollback point for database changes. Its timestamp tells you the maximum data loss of a restore.

---

### 13.8 Environment Separation

Three environments. Each is fully isolated.

| Aspect | Development | Staging | Production |
|--------|-------------|---------|-----------|
| URL | `http://localhost:3000` | `https://staging.thefield.eg` | `https://thefield.eg` |
| Database | Local Docker PostgreSQL | Neon (separate project) | Neon (production project) |
| Storage | Local disk (`STORAGE_PROVIDER=local`) | R2 staging buckets | R2 production buckets |
| Cloudflare | Not used | Optional (direct VPS access OK) | Required |
| `NODE_ENV` | `development` | `production` (same as production) | `production` |
| Session secret | Any value | Separate secret | Production secret (rotated, not shared) |
| Sentry | Dev project (optional) | Staging environment in Sentry | Production environment in Sentry |
| Seed data | Developer-seeded | Staging-seeded | Production-seeded (real admin only) |
| PM2 instances | None (npm run dev) | 1 or 2 (mirrors production) | 2 |
| Backups | None needed | Optional | Mandatory daily |

**Environment variable rules:**

1. No `.env` file containing real credentials is ever committed to Git. `.gitignore` enforces this.
2. `SESSION_SECRET` is unique per environment — never shared between staging and production.
3. `DATABASE_URL` for staging and production point to completely separate database instances.
4. `S3_PRIVATE_BUCKET` and `S3_PUBLIC_BUCKET` are different bucket names per environment.
5. `VENUE_ID` is different per environment (seeded separately on each DB).
6. Staging mirrors production configuration to the greatest extent possible, specifically:
   - Same `NODE_ENV=production`
   - Same NGINX configuration
   - Same PM2 configuration
   - Same PostgreSQL version and extensions
   - This ensures that staging failures predict production failures.
7. `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are set only at initial seed time and are never stored in the environment beyond that.
8. `BOOKING_EXPIRY_MINUTES` (OBD-002) remains unset until the venue owner confirms the value. Application startup must fail explicitly if this variable is unset, on all environments.

---

### 13.9 CI/CD Pipeline

The CI/CD pipeline runs automatically on every push to the `main` branch and on every pull request to `main`.

**Full pipeline definition:**

```yaml
# .github/workflows/ci.yml

name: CI/CD — The Field

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  quality:
    name: Quality Checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # full history for gitleaks

      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }

      - run: npm ci

      # Type safety
      - name: TypeScript check
        run: npx tsc --noEmit

      # Code quality
      - name: Lint
        run: npx eslint src --max-warnings 0

      # Unit tests (fast — no database)
      - name: Unit tests
        run: npm run test:unit -- --run --reporter=verbose

      # Integration tests (real PostgreSQL via testcontainers)
      - name: Integration tests
        run: npm run test:integration -- --run
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/thefield_test

      # Dependency security
      - name: npm audit
        run: npm audit --audit-level=high

      # Static security analysis
      - name: Semgrep
        run: npx semgrep --config=p/typescript --config=p/owasp-top-ten src/ --error

      # Secret scanning (full history)
      - name: gitleaks
        run: npx gitleaks detect --log-opts="HEAD~1..HEAD" --exit-code 1

      # Build
      - name: Build
        run: npm run build

  e2e:
    name: E2E Tests
    needs: quality
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'   # only on main, not on PRs (PRs use quality only)
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: E2E tests (against staging)
        run: npm run test:e2e
        env:
          PLAYWRIGHT_BASE_URL: https://staging.thefield.eg

  deploy:
    name: Deploy to Production
    needs: [quality, e2e]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment: production   # GitHub environment — requires manual approval for production
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host:     ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key:      ${{ secrets.VPS_SSH_KEY }}
          script:   /var/www/thefield/scripts/deploy.sh

      - name: Verify deployment
        run: |
          sleep 15
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://thefield.eg/api/health/ready)
          if [ "$STATUS" != "200" ]; then
            echo "Health check failed after deployment: HTTP $STATUS"
            exit 1
          fi
          echo "Deployment verified: health check passed"
```

**Pipeline gates:**

| Gate | Blocks | What it catches |
|------|--------|----------------|
| TypeScript | PRs + main | Type errors |
| Lint | PRs + main | Code quality violations |
| Unit tests | PRs + main | Business logic regressions |
| Integration tests | PRs + main | DB constraint violations, API errors |
| npm audit | PRs + main | High/critical CVEs |
| Semgrep | PRs + main | Security anti-patterns |
| gitleaks | PRs + main | Committed secrets |
| Build | PRs + main | Compilation errors |
| E2E tests | main only | Full booking flow regressions |
| Health check | Post-deploy | Deployment failures |

**Manual approval gate:** The GitHub `environment: production` setting can be configured to require manual approval before the deploy job runs. This is recommended — CI runs automatically, but a human confirms before production deployment proceeds.

---

### 13.10 Deployment Quality Checks

**Pre-deployment checks (must all pass before deploying to production):**

- [ ] All CI quality checks pass on the commit being deployed.
- [ ] The commit has been deployed to staging and staging is healthy.
- [ ] If the deployment includes a migration: migration has run on staging successfully.
- [ ] Pre-deployment database backup is confirmed in R2 `thefield-backups/pre-deploy/`.
- [ ] The exclusion constraint `no_overlapping_approved_bookings` is verified present on staging after migration.
- [ ] No open S1 or S2 incidents on the current production deployment.

**Post-deployment checks (run within 5 minutes of deployment):**

- [ ] `GET /api/health/ready` → `{ "status": "ready", "database": "connected" }` (HTTP 200).
- [ ] `GET /` → HTTP 200 (public homepage loads without error).
- [ ] `GET /api/v1/courts` → HTTP 200, non-empty response.
- [ ] `GET /admin/login` → HTTP 200.
- [ ] Sentry: no new error type appearing since deployment (check error trends for 5 minutes).
- [ ] UptimeRobot: all monitors show "up".
- [ ] PM2: both instances show status "online" (`pm2 status`).
- [ ] NGINX: error log has no new entries (`tail /var/log/nginx/thefield_error.log`).
- [ ] If a migration ran: verify the critical constraints are present (exclusion constraint + `booking_range` column).

**Immediate rollback triggers (if any of these occur post-deployment):**

- Health check returns non-200 after 3 retries with 10-second intervals.
- Error rate in Sentry exceeds 5% of requests within 5 minutes of deployment.
- Booking creation returns 500 errors.
- PM2 shows either instance in "errored" state with more than 3 restarts.
- Database connection errors appearing in logs.

---

## Section 14: Updated Implementation Tasks

This section integrates production reliability, authentication, language support, and UI requirements into the existing M0–M6 milestone structure from the Implementation Blueprint (Doc 22). Task IDs continue from the highest existing ID in each milestone to avoid conflicts. Tasks are grouped by the milestone in which they belong.

**New requirements integrated in this section:**

- Production reliability (statelessness, health endpoints, DB failure handling, graceful shutdown, backup automation, load testing).
- **Customer authentication before booking** — customers must authenticate (Google Sign-In or email/password) before submitting a booking request.
- **Arabic and English** — the website must support both languages (OBD-003 resolved: bilingual Arabic + English).
- **RTL layout** — Arabic requires right-to-left CSS.
- **Creative UI with animations** — the customer-facing website must include polished visual design and purposeful animations that respect `prefers-reduced-motion`.

**OBDs that remain pending and must NOT have invented values in these tasks:**

- OBD-001: Customer cancellation policy — tasks reference the cancellation endpoint but leave the policy unconfigured.
- OBD-002: Booking expiry timeout — `BOOKING_EXPIRY_MINUTES` env var referenced but not assigned a value.
- OBD-004: Operating schedule — tasks build the mechanism, not the data.
- OBD-005: Payment-submitted hold behaviour — documented as pending.

---

### Milestone 0: Foundation — Reliability Additions

#### REL-M0-T01 — Two PM2 Instances from Day One
**Milestone:** M0  
**Objective:** Configure PM2 to run two application instances on ports 3000 and 3001 from initial setup, so NGINX load balancing and in-process redundancy are available from the first deployment.  
**Dependencies:** M0-T02 (project init)  
**Files:** `ecosystem.config.js`, `nginx/thefield.conf`  
**Implementation requirements:**
- `ecosystem.config.js` defines 2 app entries (`thefield-a` on port 3000, `thefield-b` on port 3001) or uses `instances: 2` with `PORT` incremented by PM2.
- NGINX upstream block includes both: `server 127.0.0.1:3000 max_fails=2 fail_timeout=10s;` and `server 127.0.0.1:3001 max_fails=2 fail_timeout=10s;`.
- `exec_mode: 'fork'` — required for node-cron in one instance, idle in the other.
- `kill_timeout: 35000` — required for graceful shutdown.  
**AC:** `pm2 status` shows two instances online. NGINX routes requests to both. Stopping one instance does not interrupt the other.

---

#### REL-M0-T02 — Health Endpoints: Liveness and Readiness
**Milestone:** M0  
**Objective:** Implement `/api/health/live` and `/api/health/ready` as specified in Section 1.5.  
**Dependencies:** M0-T02, M1-T01 (DB client)  
**Files:** `src/app/api/health/live/route.ts`, `src/app/api/health/ready/route.ts`, `src/app/api/health/route.ts`  
**Implementation requirements:**
- `/api/health/live`: Returns 200 immediately. No DB call. Response: `{ status: 'alive', timestamp }`.
- `/api/health/ready`: Queries `SELECT 1`. Returns 200 if connected, 503 if not. Response: `{ status: 'ready'|'not_ready', database: 'connected'|'unavailable' }`.
- `/api/health`: Calls both live and ready, returns combined result. Kept for UptimeRobot backward compatibility.
- `isShuttingDown` flag from graceful shutdown causes `/api/health/ready` to return 503 during shutdown.
- No sensitive data (no stack traces, no connection strings, no server names) in any health response.  
**AC:** `curl /api/health/live` returns 200 with no DB. `curl /api/health/ready` returns 503 when DB is deliberately disconnected. Returns 200 when DB is healthy.

---

#### REL-M0-T03 — Graceful Shutdown Handler
**Milestone:** M0  
**Objective:** Implement SIGTERM handler that stops accepting new requests and waits 30 seconds before exiting.  
**Dependencies:** M0-T02, REL-M0-T02  
**Files:** `src/lib/graceful-shutdown.ts`, `src/instrumentation.ts`  
**Implementation requirements:** As specified in Section 13.5. The `isShuttingDown` flag is exported and imported by the readiness route.  
**AC:** Sending SIGTERM to the Node.js process causes `/api/health/ready` to return 503 within 2 seconds. Process does not exit for at least 30 seconds after SIGTERM. Process exits cleanly after 30 seconds (or earlier if no in-flight requests remain).

---

#### REL-M0-T04 — DB Connection Pool Configuration
**Milestone:** M0  
**Objective:** Configure the PostgreSQL connection pool with correct limits, timeouts, and failure handling.  
**Dependencies:** M0-T04 (schema), M1-T01 (DB client)  
**Files:** `src/lib/db/client.ts`  
**Implementation requirements:** As specified in Section 2.4. `DB_POOL_MAX` and `DB_POOL_MIN` read from env vars. Pool error events forwarded to Sentry and pino logger. `statement_timeout: 30000`, `connectionTimeoutMillis: 5000`.  
**AC:** Pool configuration matches environment variables. Pool error triggers a Sentry event. Application returns 503 when pool is exhausted (not 500).

---

#### REL-M0-T05 — Request ID Middleware
**Milestone:** M0  
**Objective:** Generate and propagate a unique request ID on every request for log correlation.  
**Dependencies:** M0-T10 (security headers middleware)  
**Files:** `src/app/middleware.ts`  
**Implementation requirements:** As specified in Section 12.5. Generates UUID per request, sets `x-request-id` response header. Reads `x-request-id` from incoming request if present (trust from Cloudflare only — validate that it comes from the `X-Real-IP` header not from an untrusted client).  
**AC:** Every API response includes `x-request-id` header. Application logs include `requestId` field.

---

#### REL-M0-T06 — NGINX JSON Access Log Format
**Milestone:** M0  
**Objective:** Configure NGINX to emit structured JSON access logs.  
**Dependencies:** None (NGINX config only)  
**Files:** `nginx/thefield.conf`  
**Implementation requirements:** As specified in Section 12.6. JSON format with time, method, path, status, duration, bytes, ip, request_id, upstream, upstream_status.  
**AC:** NGINX access log entries are valid JSON. `jq . /var/log/nginx/thefield_access.log` parses without error.

---

### Milestone 1: Authentication and Authorization Foundation — Reliability and Auth Additions

#### REL-M1-T01 — Customer Authentication: Google Sign-In and Email/Password
**Milestone:** M1  
**Objective:** Implement customer authentication. Customers must sign in before submitting a booking request. Two methods supported: Google OAuth and email/password.  
**Dependencies:** M0-T02, M1-T01 (DB client)  
**Files:** `src/modules/customers/auth/`, `src/app/(public)/signin/`, `src/app/api/v1/auth/`  
**Implementation requirements:**
- Add `customer_accounts` table: `{ id UUID PK, email VARCHAR(255) UNIQUE, password_hash VARCHAR(255) NULLABLE, google_id VARCHAR(255) NULLABLE, full_name VARCHAR(255), phone_number VARCHAR(20) NULLABLE, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ }`.
- Google Sign-In: use the Google provider with the documented customer-session flow. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` come from environment variables.
- Email/password: bcrypt hash at cost 12. Same brute-force protection as admin login (5 attempts/15 min per IP).
- Customer session: separate cookie namespace from admin session (`thefield_customer_session`, scoped to `/` path not `/admin`).
- On sign-in or sign-up: create or update the `customer_accounts` row. The account is the booking owner.
- `POST /api/v1/bookings` requires a valid customer session. Returns 401 if unauthenticated.
- The booking flow redirects unauthenticated users to `/signin?redirect=/book` before allowing booking.
- After authentication, redirect back to the booking flow.
- Customers may only access their own booking data (IDOR protection: filter `bookings.customer_account_id` by the session's account ID).  
**AC:** Unauthenticated `POST /api/v1/bookings` returns 401. Google Sign-In completes and creates a session. Email/password sign-in creates a session. Signed-in customer can complete a booking. Signed-in customer cannot access another customer's bookings.

---

#### REL-M1-T02 — Customer Session Cross-Instance Verification
**Milestone:** M1  
**Objective:** Verify that customer sessions remain valid when requests move between the two PM2 instances.  
**Dependencies:** REL-M1-T01  
**Files:** `src/lib/auth/customer-session.ts`  
**Implementation requirements:**
- Customer sessions use iron-session with the same `SESSION_SECRET` available to all instances.
- No server-side session store is used — the session is self-contained in the encrypted cookie.
- Customer session cookie: `HttpOnly`, `Secure` (production), `SameSite=Lax`, scoped to `/`.  
**AC:** A customer signs in via instance A (port 3000), their next request is handled by instance B (port 3001), and the session remains valid. No re-login required.

---

#### REL-M1-T03 — Database Failure Response Handling
**Milestone:** M1  
**Objective:** Ensure all database-dependent API routes return controlled 503 errors when PostgreSQL is unavailable.  
**Dependencies:** REL-M0-T04, M1-T01  
**Files:** `src/lib/errors/index.ts`, `src/lib/errors/api.ts`  
**Implementation requirements:**
- PostgreSQL connection errors (error codes: `ECONNREFUSED`, `57P03` — cannot_connect_now, `08006` — connection_failure) are caught at the service layer.
- These errors are mapped to `apiError('SERVICE_UNAVAILABLE', 503, 'The booking system is temporarily unavailable. Please try again in a moment.')`.
- The original error is captured by Sentry with full context but never returned to the client.
- The readiness endpoint returns 503 when the DB is unreachable.
- No booking is ever confirmed without a successful database write — if the write fails, the error propagates to the client as a 503.  
**AC:** Deliberately closing the database connection pool causes all booking-creation API calls to return 503 with the specified message. No 500 internal server errors appear. Sentry receives the DB connection error event.

---

#### REL-M1-T04 — Startup Environment Validation
**Milestone:** M1  
**Objective:** Application must fail fast at startup if required environment variables are missing, with clear error messages.  
**Dependencies:** M0-T07 (config)  
**Files:** `src/lib/config.ts`  
**Implementation requirements:**
- Validate at module load (not on first request): `VENUE_ID`, `SESSION_SECRET` (min 32 chars), `DATABASE_URL`, `STORAGE_PROVIDER`, `BOOKING_EXPIRY_MINUTES` (OBD-002 — must be set explicitly; no default).
- For each missing or invalid variable: throw `Error('Missing required env var: ${name}. See .env.example.')`.
- Process exits before serving any requests if validation fails.
- Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to the required variables list once REL-M1-T01 is implemented.  
**AC:** Starting the application with `BOOKING_EXPIRY_MINUTES` unset logs a clear error and exits with code 1. Starting with all variables set proceeds normally.

---

### Milestone 2: CMS and Public Website — Language and UI Additions

#### REL-M2-T01 — Arabic and English Language Support (OBD-003 Resolved: Bilingual)
**Milestone:** M2  
**Objective:** Implement bilingual Arabic/English support with full RTL layout for Arabic.  
**Dependencies:** M0-T04 (layout), M2-T04 (public layout)  
**Files:** `src/i18n/`, `src/app/(public)/layout.tsx`, `tailwind.config.ts`, `messages/en.json`, `messages/ar.json`  
**Implementation requirements:**
- Use `next-intl` for internationalisation. Locale is determined by:
  1. URL prefix (`/en/`, `/ar/`) — preferred for SEO.
  2. Fallback: user browser `Accept-Language` header.
  3. Customer preference stored in localStorage after manual selection.
- `messages/en.json`: English strings for all customer-facing UI text.
- `messages/ar.json`: Arabic strings for all customer-facing UI text.
- All customer-facing text must be externalised into `messages/` — no hardcoded English or Arabic strings in JSX.
- Tailwind CSS: enable RTL support via the `rtl:` variant prefix. Set `dir="rtl"` on `<html>` for Arabic locale, `dir="ltr"` for English.
- Font: Use a font stack that supports both Latin and Arabic scripts (e.g., `font-family: 'Cairo', 'Inter', system-ui`). Cairo is a Google Font with excellent Arabic support.
- Language toggle in the public navigation (switch between AR and EN).
- Admin dashboard: English only in V1 (admin audience is venue staff; Arabic admin UI is a future enhancement).
- CMS content (hero text, about body, FAQ answers, etc.) can be entered in Arabic or English by the admin — the CMS stores whatever text the admin enters. Translation of CMS content is the venue owner's responsibility, not an automated translation.
- Date formatting: Arabic locale uses Arabic-Indic numerals for dates displayed to Arabic users. Use `Intl.DateTimeFormat` with the locale setting.  
**AC:** Switching to Arabic sets `dir="rtl"` on the HTML element. All UI text appears in Arabic from `messages/ar.json`. All UI text appears in English from `messages/en.json`. Date picker and slot grid display correctly in RTL. Form inputs flow right-to-left in Arabic mode. Lighthouse score does not drop below 80 after RTL addition.

---

#### REL-M2-T02 — RTL Layout Verification
**Milestone:** M2  
**Objective:** Verify that all booking flow screens, forms, and navigation render correctly in RTL layout on mobile.  
**Dependencies:** REL-M2-T01  
**Files:** `tests/e2e/rtl/booking-flow-rtl.spec.ts`  
**Implementation requirements:**
- Playwright E2E test: set locale to Arabic, navigate through the full booking flow on a 390px viewport.
- Verify: no horizontal overflow, correct text direction, correct icon mirroring (back/forward arrows).
- axe-core accessibility check in RTL mode.  
**AC:** E2E test passes in Arabic RTL on 390px viewport with 0 critical axe violations.

---

#### REL-M2-T03 — Creative UI and Animations
**Milestone:** M2  
**Objective:** Implement purposeful, performance-preserving animations for the customer-facing website.  
**Dependencies:** M2-T04 (public layout)  
**Files:** `src/components/ui/`, `src/app/(public)/`, `src/styles/animations.css`  
**Implementation requirements:**
- Use CSS transitions and keyframe animations for: page transitions, booking slot hover effects, confirmation screen entrance, court card hover, loading states.
- All animations must respect `prefers-reduced-motion`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
  ```
- Animations must not block interactivity. Use `will-change: transform` where GPU acceleration is beneficial, remove after animation completes.
- No animations on critical path elements during loading (do not animate while an API call is in progress unless showing a loading indicator).
- CLS (Cumulative Layout Shift) must remain < 0.1 after animations are added. Animations that cause layout shifts are not permitted.
- JavaScript animation libraries (Framer Motion, GSAP) may be used if the bundle size impact is acceptable (< 50 KB gzipped addition). Prefer CSS-first approach.  
**AC:** Core Web Vitals: LCP < 3s, CLS < 0.1, FID/INP < 200ms. `prefers-reduced-motion` disables all animations. Lighthouse performance score ≥ 85 on mobile. No jank (frame drops below 60fps) during booking slot selection.

---

#### REL-M2-T04 — Sign-In Page and Booking Flow Authentication Gate
**Milestone:** M2  
**Objective:** Build the customer sign-in page and integrate the authentication gate into the booking flow.  
**Dependencies:** REL-M1-T01, REL-M2-T01  
**Files:** `src/app/(public)/signin/page.tsx`, `src/app/(public)/book/page.tsx`  
**Implementation requirements:**
- Sign-in page supports: Google Sign-In button, email/password form.
- Both AR and EN versions of the sign-in page.
- After successful sign-in, redirect to the booking flow (the `redirect` query param preserves the selected court and date if pre-selected).
- The booking flow shows a "Sign in to continue" prompt at the customer form step if the user is not authenticated.
- Sign-up (new account) is available from the sign-in page for email/password users.
- Password requirements: minimum 8 characters, maximum 72 characters (bcrypt limit).
- "Forgot password" flow is out of scope for V1 but the UI must not imply it exists.  
**AC:** Unauthenticated user clicking "Book Now" is taken to sign-in. After sign-in, user is returned to the booking flow at the correct step. Google OAuth completes and creates a customer session. Email/password sign-in creates a customer session.

---

### Milestone 3: Booking Engine — Reliability and Concurrency Additions

#### REL-M3-T01 — Customer Authentication on Booking Submission
**Milestone:** M3  
**Objective:** Enforce that `POST /api/v1/bookings` requires a valid customer session.  
**Dependencies:** REL-M1-T01, M3-T12  
**Files:** `src/app/api/v1/bookings/route.ts`  
**Implementation requirements:**
- Add `getCustomerSession()` check at the top of the booking creation route handler.
- If no valid customer session: return 401.
- The `customer_account_id` used in the booking INSERT is sourced from the authenticated session — never from the request body.
- The `customerPhone` in the request body is still required (for customer records and future contact), but it is validated against the session's authenticated identity if available.  
**AC:** `POST /api/v1/bookings` without a session returns 401. Booking is created with the authenticated customer's ID. Customer ID cannot be overridden by the request body.

---

#### REL-M3-T02 — Booking Idempotency: Duplicate Submission Guard
**Milestone:** M3  
**Objective:** Prevent a customer from accidentally creating duplicate bookings by double-clicking submit or refreshing the confirmation page.  
**Dependencies:** REL-M1-T01, M3-T11  
**Files:** `src/app/api/v1/bookings/route.ts`, `src/modules/bookings/bookings.service.ts`  
**Implementation requirements:**
- The booking creation route checks: does an active booking (status NOT IN `rejected`, `cancelled`, `expired`) already exist for this `customer_account_id`, `court_id`, `booking_date`, `start_time`?
- If yes: return 409 with the existing booking reference: `{ code: 'DUPLICATE_BOOKING', existingReference: 'TF-...' }`.
- This check is inside the same SERIALIZABLE transaction as the conflict check — it does not create an additional race window.
- The confirmation screen's "Back" button leads to the booking status page, not back to the booking form, to prevent re-submission.  
**AC:** Submitting the same court/date/time twice from the same authenticated account within 5 minutes returns 409 with the original reference. The database contains exactly one booking record for that customer/court/date/time combination.

---

#### REL-M3-T03 — Concurrency Reliability Tests (Multi-Instance Simulation)
**Milestone:** M3  
**Objective:** Extend the existing concurrent booking tests to simulate requests arriving through different application instances.  
**Dependencies:** M3-T20 (existing booking integrity tests), REL-M0-T01  
**Files:** `tests/integration/database/concurrent-multi-instance.test.ts`  
**Implementation requirements:**
- Create a test that fires 10 simultaneous booking requests, half to port 3000 and half to port 3001 (simulating two instances).
- Assert: exactly 0 or 1 booking created (pending race — see Doc 06 documented behavior). Zero approved bookings conflict.
- Assert: no 500 errors from either instance.
- Assert: the PostgreSQL exclusion constraint correctly prevents concurrent approval of conflicting bookings sourced from both instances.  
**AC:** Test passes. No double-approved bookings. No unhandled errors from either instance.

---

#### REL-M3-T04 — Database Failure Mid-Booking Test
**Milestone:** M3  
**Objective:** Verify booking creation fails safely and returns 503 when the database becomes unavailable during the request.  
**Dependencies:** REL-M1-T03, M3-T11  
**Files:** `tests/integration/reliability/db-failure-booking.test.ts`  
**Implementation requirements:**
- Test: close the database pool mid-request (by exhausting it with blocking queries in the test setup).
- Assert: `POST /api/v1/bookings` returns 503 with the customer-safe error message.
- Assert: no booking record is created in the database.
- Assert: the customer receives no booking reference.  
**AC:** Test passes. 503 returned. No orphaned booking records.

---

#### REL-M3-T05 — Timezone Validation Tests
**Milestone:** M3  
**Objective:** Verify that all date and time calculations use Africa/Cairo (UTC+2) consistently, including near-midnight edge cases.  
**Dependencies:** M3-T03 (pricing calculator), M3-T06 (availability service)  
**Files:** `tests/unit/lib/timezone.test.ts`  
**Implementation requirements:**
- Test: availability for a date at 22:30 Egypt time (20:30 UTC) where UTC date has crossed midnight.
- Test: booking expiry at 00:30 Egypt time verifies correct day-of-week determination.
- Test: pricing rule day-of-week match uses Egypt timezone, not UTC.
- Test: `booking_range` generated column produces correct TSTZRANGE using `AT TIME ZONE 'Africa/Cairo'`.  
**AC:** All timezone tests pass. No off-by-one-day errors. `getDayOfWeekInCairo()` returns correct values for midnight-crossing cases.

---

### Milestone 4: Payment Proof — Storage Reliability Additions

#### REL-M4-T01 — Upload Integrity Verification
**Milestone:** M4  
**Objective:** Verify that the R2 object exists before writing the `payment_proofs` database record.  
**Dependencies:** M4-T03 (proof upload service), REL-M0-T04  
**Files:** `src/modules/payments/payments.service.ts`, `src/modules/storage/storage.service.ts`  
**Implementation requirements:**
- After `storageService.put()` returns, call `storageService.exists(key)` to confirm the object is present in R2.
- If `exists()` returns false: do not insert into `payment_proofs`. Return a 503 to the customer.
- If `exists()` throws (R2 unavailable): do not insert. Return 503.
- The booking remains in `pending` status. Customer can retry upload later.
- Log the failure to Sentry with `{ bookingId, storageKey, error }`.  
**AC:** When R2 upload succeeds but `exists()` returns false (simulated in tests via mock), the DB record is not created. Customer receives 503. Booking remains `pending`. Customer can re-upload.

---

#### REL-M4-T02 — R2 Unavailability Test
**Milestone:** M4  
**Objective:** Verify the upload failure path works correctly and does not corrupt booking state.  
**Dependencies:** REL-M4-T01, M4-T04  
**Files:** `tests/integration/reliability/storage-failure.test.ts`  
**Implementation requirements:**
- Mock R2 storage service to throw `StorageUnavailableError` on `put()`.
- Assert: booking was created successfully with status `pending`.
- Assert: `payment_proofs` table has no record for this booking.
- Assert: `payment_records` status remains `pending`.
- Assert: API returns 503 with "Upload temporarily unavailable" message.
- Assert: customer can successfully re-upload proof after storage recovers.  
**AC:** All assertions pass. Zero booking state corruption.

---

#### REL-M4-T03 — Signed URL Expiry Test
**Milestone:** M4  
**Objective:** Verify that signed URLs for payment proofs expire correctly and that expired URLs cannot be used to access files.  
**Dependencies:** M4-T04 (proof view route)  
**Files:** `tests/integration/api/security/proof-signed-url.test.ts`  
**Implementation requirements:**
- In the test environment, generate a signed URL with a 2-second expiry.
- Wait 3 seconds.
- Assert: the URL returns 403 or 404 when accessed directly.
- Assert: requesting a new signed URL via the admin proof view endpoint generates a fresh valid URL.  
**AC:** Expired URLs do not grant access to proof files. Fresh signed URLs grant access within the 5-minute window.

---

### Milestone 5: Admin Dashboard — Reliability Additions

#### REL-M5-T01 — Admin Dashboard DB Connection Count Display
**Milestone:** M5  
**Objective:** Add a database connection count indicator to the admin dashboard for operational awareness.  
**Dependencies:** M5-T03 (dashboard page)  
**Files:** `src/app/admin/dashboard/page.tsx`, `src/app/api/v1/admin/dashboard/summary/route.ts`  
**Implementation requirements:**
- Query `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()` alongside dashboard counts.
- Display in a small indicator: "DB connections: N / MAX" (where MAX comes from `DB_POOL_MAX * 2` — two instances).
- Only visible to `super_admin` role.
- If connection count exceeds 80% of max, show indicator in amber. If > 90%, show in red.  
**AC:** Super-admin sees DB connection count on dashboard. Count is accurate. Color coding reflects thresholds.

---

#### REL-M5-T02 — Background Job Heartbeat
**Milestone:** M5  
**Objective:** Report expiry job execution to Sentry cron monitoring so silent failures are detected.  
**Dependencies:** M3-T13 (expiry job), M0-T11 (Sentry)  
**Files:** `src/jobs/expire-bookings.ts`  
**Implementation requirements:**
- At the end of each successful expiry job run: call `Sentry.captureCheckIn({ monitorSlug: 'expire-bookings', status: 'ok' })`.
- On job failure: call `Sentry.captureCheckIn({ monitorSlug: 'expire-bookings', status: 'error' })`.
- `SENTRY_CRON_MONITOR_ID` env var controls the Sentry cron monitor slug (optional — job logs even if this is unset).
- Sentry cron monitor configured with expected schedule: `*/15 * * * *` and a 20-minute checkin deadline.  
**AC:** Sentry shows the expiry job as "OK" after each run. Sentry alerts if the job has not checked in within 20 minutes.

---

#### REL-M5-T03 — Admin Action Idempotency Tests
**Milestone:** M5  
**Objective:** Verify that rapid double-clicks on approve/reject/cancel do not create duplicate state transitions.  
**Dependencies:** M4-T05 (approve), M4-T06 (reject/cancel)  
**Files:** `tests/integration/api/admin/idempotency.test.ts`  
**Implementation requirements:**
- Fire two simultaneous `POST /api/v1/admin/bookings/:id/approve` requests.
- Assert: exactly one returns 200. The other returns 422 (already approved).
- Same for reject (one 200, one 422) and cancel (one 200, one 422).
- Assert: audit log contains exactly one `booking_approved` entry per booking.  
**AC:** All assertions pass. No duplicate audit entries. No double state transitions.

---

### Milestone 6: Production Hardening — New Reliability Tasks

#### REL-M6-T01 — Load Testing (k6)
**Milestone:** M6  
**Objective:** Execute all load test scenarios defined in Section 5 against staging and document the results.  
**Dependencies:** Full application deployed to staging  
**Files:** `tests/load/baseline.js`, `tests/load/2x-traffic.js`, `tests/load/5x-stress.js`, `tests/load/spike.js`, `tests/load/concurrent-bookings.js`, `tests/load/admin-concurrent.js`, `tests/load/connection-exhaustion.js`  
**Implementation requirements:**
- All 7 k6 test scripts from Section 5.4 written and executed against staging.
- Results documented in `docs/load-test-results/YYYY-MM-DD.md`.
- Post-load database integrity check run after every test (Section 5.6 SQL query — must return 0 rows).
- Production scaling thresholds updated in the monitoring configuration based on measured results.  
**AC:** All 7 tests complete. Concurrent booking test: exactly 0 or 1 booking per slot, zero 500 errors. Post-test integrity check returns 0 conflict rows. Capacity planning table (Section 5.7) populated with real measurements.

---

#### REL-M6-T02 — Disaster Recovery Rehearsal
**Milestone:** M6  
**Objective:** Rehearse recovery procedures DR-01 through DR-05 from Section 6.3 in a controlled staging environment before production launch.  
**Dependencies:** REL-M6-T01, M6-T07 (backup verification)  
**Files:** `docs/runbooks/` (create all 7 runbooks referenced in Section 12.7)  
**Implementation requirements:**
- DR-01 (app crash): kill a staging PM2 instance, verify auto-restart and NGINX failover.
- DR-02 (VPS failure): simulate by stopping the staging VPS, restore from backup on a new server (must complete in < 2 hours).
- DR-03 (DB failure): disconnect staging from its database, verify 503 responses and no data corruption.
- DR-05 (backup restore): restore the latest staging backup to a test database, verify integrity (Section 7.4 verification script).
- DR-06 (bad deployment): deploy a known-broken build to staging, perform rollback, verify recovery.
- All runbooks written in `docs/runbooks/` and verified to be accurate against the actual recovery procedures.  
**AC:** All 5 rehearsed scenarios complete successfully. Recovery times documented. Runbooks updated with any corrections from the rehearsal.

---

#### REL-M6-T03 — Daily Integrity Check Cron
**Milestone:** M6  
**Objective:** Install the daily booking integrity check cron job on the production VPS.  
**Dependencies:** REL-M6-T02  
**Files:** `scripts/integrity-check.sh`  
**Implementation requirements:** As specified in Section 8.2. Runs at 06:00 daily. Returns 0 rows from the overlapping approved bookings query. If > 0: alerts developer and owner via email and Sentry.  
**AC:** Cron job installed, verified to run, verified to query the correct database. Manually test by checking that the alert fires if a test conflict is inserted and then cleaned up.

---

#### REL-M6-T04 — btree_gist Extension Startup Check
**Milestone:** M6  
**Objective:** Add a startup check that detects if the `btree_gist` extension has been removed and alerts immediately.  
**Dependencies:** M0-T01 (extension verification)  
**Files:** `src/lib/db/client.ts`  
**Implementation requirements:** As specified in Failure Mode FM-11. Check at application startup, log a fatal-level message if missing, capture to Sentry.  
**AC:** Removing `btree_gist` on staging causes a fatal log entry and a Sentry alert within 60 seconds of next application startup.

---

#### REL-M6-T05 — Production Smoke Test Automation
**Milestone:** M6  
**Objective:** Automate the post-deployment smoke test checks defined in Section 13.10.  
**Dependencies:** REL-M6-T01  
**Files:** `scripts/smoke-test.sh`  
**Implementation requirements:**
```bash
#!/bin/bash
BASE="${1:-https://thefield.eg}"  # accept staging or production URL
PASS=0; FAIL=0

check() {
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$1")
  if [ "$STATUS" = "$2" ]; then
    echo "PASS: $1 → $STATUS"; ((PASS++))
  else
    echo "FAIL: $1 → $STATUS (expected $2)"; ((FAIL++))
  fi
}

check "/"               "200"
check "/api/health/ready" "200"
check "/api/health/live"  "200"
check "/api/v1/courts"    "200"
check "/admin/login"      "200"

echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]  # exit 0 only if all pass
```  
**AC:** Script returns exit code 0 on a healthy deployment. Script returns exit code 1 if any check fails. Script is called in the CI deploy job post-deployment step.

---

#### REL-M6-T06 — Core Web Vitals Measurement
**Milestone:** M6  
**Objective:** Measure and document Core Web Vitals (LCP, CLS, FID/INP) for the homepage, booking flow, and confirmation screen in both Arabic and English.  
**Dependencies:** REL-M2-T01, REL-M2-T03  
**Files:** `docs/performance/core-web-vitals.md`  
**Implementation requirements:**
- Use Lighthouse CLI against staging: `lighthouse --output json --chrome-flags="--headless" https://staging.thefield.eg`.
- Measure in both AR and EN locales.
- Measure on simulated mobile 4G (Lighthouse default mobile config).
- Document results in `docs/performance/core-web-vitals.md`.
- All metrics must meet: LCP < 3s, CLS < 0.1, FID/INP < 200ms, Performance score ≥ 85.
- Fix any failing metric before production launch.  
**AC:** All Core Web Vitals pass thresholds. Results documented. Both AR and EN pass independently.

---

#### REL-M6-T07 — Cloudflare Configuration Verification
**Milestone:** M6  
**Objective:** Verify all Cloudflare settings are correctly configured for production.  
**Dependencies:** REL-M0-T06, full production deployment  
**Files:** `docs/cloudflare-configuration.md` (document the settings)  
**Implementation requirements:**
- SSL/TLS mode: Full (Strict) — origin certificate required.
- Always Use HTTPS: enabled.
- Minimum TLS version: 1.2.
- Caching: verify dynamic routes (`/api/*`, `/admin/*`, `/booking-status`) are not cached. Verify static assets (`/_next/static/*`, `/public/*`) are cached.
- WAF: OWASP Core Rule Set enabled. Verify it does not block legitimate booking submissions or file uploads.
- Rate limiting rules: booking endpoint (10 req/min per IP), admin login (5 req/min per IP).
- Page rules or Cache Rules: bypass cache for all `/api/*` and `/admin/*`.
- HTTP/3 (QUIC): enabled for improved mobile performance.  
**AC:** `curl -I https://thefield.eg` shows TLS 1.3, correct headers, Cloudflare serving the response. Admin login is not cached. Gallery images are cached (Cloudflare returns `cf-cache-status: HIT` on second request).

---

#### REL-M6-T08 — Security Testing (OWASP ZAP, Burp Suite, Semgrep)
**Milestone:** M6 (already partially in M6-T01–T04 of the Blueprint — this task adds reliability-specific security checks)  
**Objective:** Extend the security test scope to cover the new authentication flow, multi-instance session handling, and R2 access control.  
**Dependencies:** REL-M1-T01, REL-M4-T03  
**Implementation requirements:**
- OWASP ZAP: re-run baseline scan with authenticated customer session. Verify no new findings.
- Test: customer session cookie from instance A is not accepted by a server that does not share `SESSION_SECRET` — simulate by temporarily changing the secret on one staging instance.
- Test: customer cannot access another customer's booking even when authenticated (IDOR test with two test accounts).
- Test: Google OAuth redirect URI is not open redirect (fixed to the application domain only).
- Test: signed proof URL cannot be guessed or brute-forced (ULID key entropy is sufficient).  
**AC:** All tests pass. No new OWASP ZAP high/critical findings. IDOR test confirms cross-customer data is inaccessible. Session isolation between differently-keyed instances confirmed.

---

## Section 15: Updated Quality Gates

Each milestone has a quality gate. The application must pass every item in its gate before work on the next milestone begins. Items marked **[NEW]** were added by this reliability document and were not present in the original quality gates in the Implementation Blueprint (Doc 22, Section 18).

Items in the original quality gates (Doc 22, Section 18) remain in force. This section extends — not replaces — those gates.

---

### Gate M0 — Foundation

**Pass criteria (all must be green before Milestone 1 begins):**

**Existing criteria (from Doc 22):**
- [ ] `npm run dev` starts without error.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes with 0 warnings.
- [ ] `npm run db:migrate && npm run db:migrate:raw` completes without error.
- [ ] `npm run db:seed` completes without error.
- [ ] `btree_gist` extension confirmed installed.
- [ ] Exclusion constraint verified: direct SQL INSERT test raises error code `23P01`.
- [ ] CI pipeline passes on an empty commit.
- [ ] No secrets in git history (gitleaks passes).

**Reliability additions [NEW]:**
- [ ] Two PM2 instances start (`pm2 status` shows `thefield-a` and `thefield-b` or equivalent — both online).
- [ ] `GET /api/health/live` returns 200 with no database dependency.
- [ ] `GET /api/health/ready` returns 200 when database is connected.
- [ ] `GET /api/health/ready` returns 503 when database connection is deliberately closed.
- [ ] SIGTERM causes `isShuttingDown = true` and `/api/health/ready` returns 503 within 2 seconds.
- [ ] Application exits cleanly within 35 seconds of SIGTERM with exit code 0.
- [ ] PostgreSQL connection pool: `DB_POOL_MAX` and `DB_POOL_MIN` are read from environment variables.
- [ ] Application startup fails with a clear error message if `BOOKING_EXPIRY_MINUTES` is not set.
- [ ] Application startup fails with a clear error message if `SESSION_SECRET` is shorter than 32 characters.
- [ ] NGINX `proxy_next_upstream off` is set on the `/api/v1/bookings` location block.
- [ ] NGINX access log emits valid JSON (`jq . /var/log/nginx/thefield_access.log` succeeds).
- [ ] Request ID header `x-request-id` is present in every API response.
- [ ] `STORAGE_PROVIDER=local` works for development. `STORAGE_PROVIDER=s3` connects successfully to R2 in staging.

---

### Gate M1 — Authentication and Authorization

**Existing criteria (from Doc 22):**
- [ ] Admin can log in with seed credentials.
- [ ] Admin is redirected to change-password on first login.
- [ ] Session revocation works (deactivate admin → next API call returns 401).
- [ ] `tests/unit/auth/` all pass.
- [ ] `tests/unit/modules/booking/booking-state-machine.test.ts` all pass.
- [ ] `tests/integration/api/admin/admin-auth.test.ts` all pass.
- [ ] Rate limit test passes (5 failures → 429).
- [ ] `npm audit --audit-level=high` passes.

**Reliability and authentication additions [NEW]:**
- [ ] **Customer authentication:** `POST /api/v1/bookings` without a customer session returns 401.
- [ ] **Google Sign-In:** Customer can authenticate via Google OAuth and receive a valid customer session cookie.
- [ ] **Email/password:** Customer can register and authenticate with email/password. Passwords are bcrypt-hashed at cost 12.
- [ ] **Session isolation:** Customer session cookie uses a different cookie name and path than the admin session cookie. One session cannot authenticate the other.
- [ ] **Cross-instance session continuity:** A customer session issued by instance A (port 3000) is valid on instance B (port 3001) using the same `SESSION_SECRET`.
- [ ] **IDOR:** Authenticated customer A cannot access authenticated customer B's booking via `/api/v1/booking-status`.
- [ ] **Database failure:** When PostgreSQL is deliberately unavailable, all booking-related routes return 503 with the specified customer-safe message (not 500). No booking reference is issued without a successful DB write.
- [ ] **Environment validation:** Starting the application with a missing `VENUE_ID` prints a clear error and exits with code 1.

---

### Gate M2 — CMS and Public Website

**Existing criteria (from Doc 22):**
- [ ] All public pages render without error when CMS is empty.
- [ ] Admin CMS settings editor saves and changes are reflected on public site.
- [ ] axe-core: 0 critical violations on all public pages.
- [ ] Lighthouse mobile ≥ 80 on home and courts pages.
- [ ] `tests/unit/modules/cms/` all pass.
- [ ] `tests/integration/api/admin/cms-management.test.ts` all pass.
- [ ] OBD-003 confirmed (language) — **RESOLVED: Bilingual Arabic + English.**

**Language, RTL, animation additions [NEW]:**
- [ ] **Arabic:** Setting locale to Arabic (`/ar/`) renders all UI text in Arabic from `messages/ar.json`. No untranslated English strings visible in Arabic mode.
- [ ] **English:** Setting locale to English (`/en/`) renders all UI text in English from `messages/en.json`.
- [ ] **RTL:** Arabic locale sets `dir="rtl"` on the `<html>` element. No horizontal overflow on 390px viewport in RTL mode.
- [ ] **LTR:** English locale sets `dir="ltr"`. Forms, navigation, and booking flow flow correctly left-to-right.
- [ ] **Language toggle:** User can switch between Arabic and English. The selected language persists across page navigations.
- [ ] **RTL E2E test:** `tests/e2e/rtl/booking-flow-rtl.spec.ts` passes on 390px viewport with 0 critical axe violations.
- [ ] **Animations:** All animations respect `prefers-reduced-motion`. Animations do not appear when this media query matches.
- [ ] **CLS:** Cumulative Layout Shift < 0.1 on the home page and booking flow (both EN and AR).
- [ ] **Performance:** Lighthouse performance score ≥ 80 on mobile for both AR and EN home page (target ≥ 85 at Milestone 6).
- [ ] **InstaPay guard:** If `venue.instapay_number` is empty in the CMS, the booking form's payment step shows a warning and disables submission. No fake InstaPay number is hardcoded anywhere.
- [ ] **OBD values absent:** No operating hours in the database from seed. Admin schedule management page shows "No operating hours configured" message. Public booking page shows "Booking not currently available" when no hours are set.

---

### Gate M3 — Booking Engine

**Existing criteria (from Doc 22):**
- [ ] Full booking flow works end-to-end.
- [ ] `tests/unit/modules/pricing/price-calculator.test.ts` ≥ 95% coverage, all pass.
- [ ] `tests/unit/modules/availability/conflict-detector.test.ts` 100% branch coverage, all pass.
- [ ] `tests/unit/modules/booking/booking-state-machine.test.ts` 100% branch coverage, all pass.
- [ ] **All 10 double-booking integration tests pass** (mandatory).
- [ ] Price manipulation tests pass.
- [ ] Expiry job integration tests pass.
- [ ] `tests/e2e/customer/full-booking-flow.spec.ts` passes on 390px viewport.
- [ ] OBD-002 confirmed and `BOOKING_EXPIRY_MINUTES` set — **remains pending until venue owner confirms.**
- [ ] OBD-004 confirmed (operating schedule populated in DB) — **remains pending until venue owner confirms.**

**Reliability and authentication additions [NEW]:**
- [ ] **Auth gate in booking flow:** An unauthenticated user who clicks "Book Now" is redirected to `/signin` with the booking context preserved in a query parameter.
- [ ] **Customer account ID from session:** The `customer_account_id` stored in the booking record comes from the authenticated session — not from the request body. Attempting to override it in the request body has no effect.
- [ ] **Duplicate booking guard:** A second booking submission for the same court/date/time from the same authenticated customer returns 409 with the existing booking reference.
- [ ] **Multi-instance concurrent test passes:** `tests/integration/database/concurrent-multi-instance.test.ts` — 10 simultaneous requests across both ports, 0 or 1 booking created, zero 500 errors.
- [ ] **DB failure mid-booking:** `tests/integration/reliability/db-failure-booking.test.ts` — 503 returned, no orphaned booking record created.
- [ ] **Timezone tests:** `tests/unit/lib/timezone.test.ts` — all cases pass including midnight-crossing and day-of-week edge cases.
- [ ] **Upload non-blocking verified:** Deliberately failing the R2 upload in the booking creation flow still returns 201 with a booking reference and status `pending`. The booking record exists in the database.
- [ ] **Arabic booking flow:** The full booking flow completes in Arabic locale on 390px viewport without layout issues.

---

### Gate M4 — Payment Proof

**Existing criteria (from Doc 22):**
- [ ] Proof upload: JPEG, PNG, PDF accepted.
- [ ] Proof upload: PHP file rejected with correct error.
- [ ] Proof upload: 11MB file rejected.
- [ ] Private bucket: direct URL (no signature) returns 403.
- [ ] Signed URL access works and expires correctly.
- [ ] Proof access logged in audit_logs.
- [ ] Concurrent admin approval test passes.
- [ ] `tests/integration/api/bookings/proof-upload.test.ts` all pass.
- [ ] `tests/e2e/admin/approve-booking.spec.ts` passes.

**Reliability additions [NEW]:**
- [ ] **Upload integrity check:** After R2 upload, `storageService.exists(key)` is called. If it returns false, `payment_proofs` row is NOT created and the customer receives 503.
- [ ] **R2 unavailability test passes:** `tests/integration/reliability/storage-failure.test.ts` — booking remains `pending`, no orphaned proof record, customer can re-upload.
- [ ] **Signed URL expiry test passes:** `tests/integration/api/security/proof-signed-url.test.ts` — expired URLs return 403.
- [ ] **Admin proof access IDOR test passes:** Admin cannot view a proof belonging to a booking in a different venue (if test infrastructure supports cross-venue simulation).
- [ ] **R2 region confirmed:** R2 buckets are correctly named for staging and production environments (different bucket names per environment).

---

### Gate M5 — Admin Dashboard

**Existing criteria (from Doc 22):**
- [ ] Full admin operational loop works end-to-end.
- [ ] Court management: add court appears in booking flow.
- [ ] Schedule management: blocked date appears in date picker.
- [ ] Administrator management: deactivation takes immediate effect.
- [ ] Audit log: all admin actions recorded.
- [ ] `tests/e2e/admin/` all pass.
- [ ] `tests/e2e/security/unauthorized-access.spec.ts` all pass.
- [ ] Test coverage report: ≥ 85% on booking engine modules, ≥ 70% overall.

**Reliability additions [NEW]:**
- [ ] **DB connection count indicator:** Super-admin dashboard shows live connection count. Amber at > 80% of max, red at > 90%.
- [ ] **Background job heartbeat:** Sentry cron monitor shows the expiry job as checked-in. Manually verifiable: check Sentry cron monitor dashboard.
- [ ] **Admin idempotency tests pass:** `tests/integration/api/admin/idempotency.test.ts` — double-click approve/reject/cancel produces exactly one state transition and one audit log entry.
- [ ] **Admin session cross-instance verified:** Admin session issued on port 3000 is valid on port 3001.
- [ ] **Graceful shutdown during admin action:** Simulate SIGTERM while an admin approval transaction is in progress — verify the transaction either completes or rolls back cleanly. No partial state.

---

### Gate M6 — Production Hardening and Launch

**Existing criteria (from Doc 22):**
- [ ] All P1 Acceptance Criteria from Doc 19 pass on production.
- [ ] OWASP ZAP baseline: 0 high/critical findings.
- [ ] Semgrep: 0 high findings.
- [ ] npm audit: 0 critical/high CVEs.
- [ ] gitleaks: 0 secrets in git history.
- [ ] Lighthouse mobile ≥ 85 on home page and booking page.
- [ ] TLS certificate valid, auto-renewal configured.
- [ ] Security headers grade B or above (securityheaders.com).
- [ ] UptimeRobot monitors active and verified.
- [ ] Sentry receiving errors (test error verified).
- [ ] `NODE_ENV=production` set.
- [ ] No real secrets in any environment files in git.
- [ ] Initial seed admin credentials changed.
- [ ] `.env.example` complete and accurate.

**Reliability additions [NEW]:**
- [ ] **Load test LOAD-T01 passes:** Baseline test (10 VU, 5 min) — p95 < 500ms, error rate < 1%.
- [ ] **Load test LOAD-T05 passes:** Concurrent booking test — post-test SQL integrity check returns 0 conflict rows. Zero 500 errors.
- [ ] **Load test LOAD-T03 executed:** Stress test results documented. System returns controlled 503s under overload. No unhandled 500s.
- [ ] **Disaster recovery rehearsal complete:** DR-01 (app crash), DR-02 (VPS failure), DR-03 (DB failure), DR-05 (backup restore), DR-06 (bad deployment) all rehearsed. Recovery times documented.
- [ ] **Backup verified:** Database backup restored successfully to a test database. Integrity check passes. Exclusion constraint present in restored backup.
- [ ] **PM2 startup on reboot verified:** VPS rebooted in staging. Application auto-started within 60 seconds. UptimeRobot showed "up" within 5 minutes.
- [ ] **Daily integrity check cron installed and tested:** `scripts/integrity-check.sh` runs, returns 0 rows, alert fires correctly when a test conflict is introduced.
- [ ] **btree_gist startup check verified:** Removing the extension on staging causes a fatal Sentry alert within 60 seconds of next restart.
- [ ] **All runbooks written:** `docs/runbooks/` contains all 7 required runbooks and they have been verified against actual rehearsal procedures.
- [ ] **Core Web Vitals documented:** LCP < 3s, CLS < 0.1, FID/INP < 200ms for both EN and AR locales, both mobile and desktop. Results in `docs/performance/core-web-vitals.md`.
- [ ] **Cloudflare configuration verified:** Dynamic routes not cached. WAF does not block legitimate bookings. Rate limiting rules active.
- [ ] **Production smoke test passes:** `scripts/smoke-test.sh https://thefield.eg` returns exit code 0.
- [ ] **Rollback tested:** A known-broken build deployed to staging, rollback executed, staging recovered within 10 minutes.
- [ ] **All 7 k6 load test scripts executed** and results documented.
- [ ] **OBD-001 through OBD-005 status confirmed:** Each OBD is either resolved with the venue owner's written confirmation, or formally accepted as pending with a documented owner sign-off. No OBD has an invented default value in production configuration.
- [ ] **Bilingual verified in production:** Arabic and English both function correctly on the live site.
- [ ] **RTL verified in production:** Arabic locale shows correct RTL layout on mobile.
- [ ] **Authentication verified in production:** Google Sign-In and email/password both complete successfully on the live site. Unauthenticated booking attempt is correctly rejected.

**Reliability-specific failure scenario gates [NEW]:**
- [ ] **Application instance failure:** Kill one PM2 instance. Verify NGINX continues serving all requests through the other instance within 10 seconds. Verify the killed instance auto-restarts.
- [ ] **Database temporary outage simulation:** Temporarily block database access (via firewall rule or pool exhaustion). Verify all API routes return 503, not 500. Verify no data corruption. Verify application recovers automatically when DB is restored.
- [ ] **Storage temporary outage simulation:** Mock R2 failure on staging. Verify booking creation succeeds, upload fails gracefully, customer receives correct message. Verify admin dashboard handles missing proof files without crashing.
- [ ] **Concurrent booking under load:** Run LOAD-T05 (20 VU, same slot) immediately before production launch. Zero double-approved bookings confirmed.
- [ ] **Background job deduplication:** Run expiry job simultaneously from both PM2 instances (trigger manually in test). Verify audit log contains correct expiry count (not double the expired bookings).

---

## Section 16: Updated Definition of Done

This is the single, comprehensive, authoritative Definition of Done for Version 1 of The Field. It supersedes and extends the Definition of Done in the Implementation Blueprint (Doc 22, Section 19) and the Acceptance Criteria document (Doc 19).

Every item in this list must be objectively verifiable. No item is considered done based on developer opinion alone — each has a stated verification method. Items marked **[NEW]** are additions from this reliability document that were not in the earlier Definition of Done.

Version 1 is complete and production-ready only when every item below is satisfied.

---

### 16.1 Functional Requirements

**Core booking flow:**
- [ ] A customer can select an active court, choose a date, choose an available time slot, and submit a booking request. The entire process completes in under 3 minutes on mobile.
- [ ] The booking confirmation screen displays a reference in `TF-YYYYMMDD-XXXX` format. The prefix `TF` is read from `venues.booking_ref_prefix` — not hardcoded.
- [ ] The booking confirmation screen displays the correct server-calculated price. The price cannot be altered by the customer.
- [ ] An authenticated customer can check the status of only their own bookings.
- [ ] A customer can upload a payment proof after initial booking submission via the status page.
- [ ] Blocked dates are disabled in the date picker.
- [ ] Maintenance periods block the affected slots in the time slot grid.
- [ ] Time slots outside operating hours are not displayed.

**[NEW] Customer authentication:**
- [ ] A customer must be authenticated before submitting a booking. Unauthenticated `POST /api/v1/bookings` returns 401.
- [ ] Google Sign-In is implemented and functional on the live site. A customer can complete Google OAuth and receive a valid session.
- [ ] Email/password authentication is implemented. A customer can register and sign in with email and password.
- [ ] After authentication, customers are redirected back to the booking flow without losing their court/date/slot selection.
- [ ] Customer accounts are stored in `customer_accounts` table. `customer_account_id` in the booking record is derived from the authenticated session, not the request body.
- [ ] "Forgot password" is out of scope for V1 and is not implied by the UI.

**Payment workflow:**
- [ ] The venue's InstaPay number is displayed from the CMS (`venue.instapay_number`). It is not hardcoded anywhere.
- [ ] If `venue.instapay_number` is empty in the CMS, the booking submission is disabled and a warning is shown.
- [ ] A customer can upload a JPEG, PNG, or PDF payment proof.
- [ ] A payment proof > 10 MB is rejected before upload.
- [ ] A PHP file disguised as a JPEG is rejected (magic bytes validation).
- [ ] SVG files are rejected.
- [ ] Payment proof files are stored in the private R2 bucket. Direct access without a signed URL returns 403.
- [ ] Administrators view proofs via a signed URL that expires in 5 minutes. Every proof view is recorded in `audit_logs`.
- [ ] Only an admin with `verify_payment` permission can mark a payment as verified. The application never automatically verifies a payment.
- [ ] Only an admin with `approve_booking` permission can approve a booking. A customer cannot approve their own booking.

**Admin dashboard:**
- [ ] Administrator can log in with email and password. First login requires a password change.
- [ ] Admin sees today's confirmed bookings, pending request count, and payment proof count on the dashboard.
- [ ] Admin can view, approve, reject, and cancel bookings through the UI.
- [ ] Approval re-validates availability inside a SERIALIZABLE transaction. A conflict detected at approval time results in a clear error, not a double booking.
- [ ] Admin can manage courts (add, edit, disable). A disabled court does not appear in the public booking flow.
- [ ] Admin can manage pricing rules. Price changes do not retroactively alter confirmed booking prices.
- [ ] Admin can manage operating hours, blocked dates, blocked periods, and maintenance periods. Changes are reflected immediately in the public booking flow.
- [ ] Admin can manage all CMS content (venue info, FAQs, gallery, events, announcements, social links, SEO metadata). No source code change is required for normal content management.
- [ ] Audit log records every admin action with: admin ID, action type, entity, timestamp, and IP.
- [ ] Audit log is read-only in the UI. The database role prevents `UPDATE` and `DELETE` on `audit_logs`.
- [ ] Super-admin can create, edit, and deactivate admin accounts. Deactivation takes immediate effect.

---

### 16.2 Language, Localisation, and UI

- [ ] **Arabic** is fully supported. All customer-facing UI text renders in Arabic from `messages/ar.json`. No English strings appear in Arabic mode.
- [ ] **English** is fully supported. All customer-facing UI text renders in English from `messages/en.json`. No Arabic strings appear in English mode.
- [ ] **[NEW] RTL layout:** Arabic locale sets `dir="rtl"` on the `<html>` element. All booking flow pages, forms, navigation, and confirmations render correctly in RTL on a 390px viewport with no horizontal overflow.
- [ ] **[NEW] LTR layout:** English locale sets `dir="ltr"`. All pages render correctly left-to-right.
- [ ] **Language toggle** is present in the public navigation. Switching language updates the page content without a full reload. The selected language persists.
- [ ] **[NEW] RTL E2E test passes:** Full booking flow completes in Arabic RTL on 390px viewport with 0 critical axe violations.
- [ ] Admin dashboard is English only in V1. No Arabic admin interface is required or implemented.
- [ ] Date and number formatting respects locale (Arabic-Indic numerals in Arabic mode, Gregorian with Arabic in Arabic mode).

**Animations and visual design:**
- [ ] **[NEW] Animations implemented:** The customer-facing website includes purposeful visual animations (court card hover, booking confirmation entrance, slot selection feedback, page transitions).
- [ ] **[NEW] `prefers-reduced-motion` respected:** When the OS/browser has reduced motion enabled, all animations are disabled. Verified with a browser test.
- [ ] **[NEW] CLS < 0.1:** Animations do not cause layout shifts. Cumulative Layout Shift < 0.1 on home and booking pages (EN and AR).
- [ ] **[NEW] Performance not degraded by animations:** Lighthouse mobile performance ≥ 85 on home page and booking page after animations are added.

---

### 16.3 Booking Integrity

- [ ] **Exclusion constraint active:** `SELECT conname FROM pg_constraint WHERE conname = 'no_overlapping_approved_bookings'` returns exactly 1 row.
- [ ] **`booking_range` column present:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'booking_range'` returns 1 row.
- [ ] **Direct SQL double-insert rejected:** Inserting two approved overlapping bookings via raw SQL raises PostgreSQL error code `23P01`.
- [ ] **Concurrent booking test passes:** 10 simultaneous booking requests for the same slot produce 0 or 1 `pending` booking. At most 1 can ever reach `approved`. Zero 500 errors. Zero double-approved bookings.
- [ ] **Adjacent slots allowed:** Bookings for 18:00–19:00 and 19:00–20:00 on the same court can both be approved.
- [ ] **Different courts same time allowed:** Bookings on Court 1 and Court 2 for the same slot can both be approved.
- [ ] **Cancelled booking releases slot:** After cancellation, the same slot is bookable again.
- [ ] **Rejected booking releases slot:** After rejection, the same slot is bookable again.
- [ ] **Expired booking releases slot:** After expiry, the same slot is bookable again.
- [ ] **[NEW] Multi-instance concurrency verified:** Concurrent booking test run with requests split across both PM2 instances. Same pass criteria as above.
- [ ] **[NEW] Admin approval idempotency:** Rapid double-click approve on the same booking produces exactly 1 `booking_approved` audit entry and 1 state transition.
- [ ] **[NEW] Daily integrity check cron active:** `scripts/integrity-check.sh` installed and verified to alert on conflicts.
- [ ] **Timezone correct:** All availability calculations use `Africa/Cairo` (UTC+2). No off-by-one-day errors at midnight.
- [ ] **Price immutable:** Once written, `bookings.price_amount` is never updated by the application or any migration.

---

### 16.4 Security

- [ ] HTTPS enforced on all routes. HTTP requests redirect to HTTPS. HSTS header with preload present.
- [ ] TLS 1.3 in use (verified with `curl -I --tls-max 1.2 https://thefield.eg` returning connection error).
- [ ] `securityheaders.com` scan: grade B or above.
- [ ] All security headers present: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, `Content-Security-Policy` with nonce.
- [ ] Admin session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/admin`.
- [ ] Customer session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- [ ] bcrypt cost factor 12 confirmed (verified by timing: `verifyPassword` takes 300–500ms).
- [ ] Brute-force protection: 5 login failures per IP per 15 minutes → 429. Applies to both admin and customer login.
- [ ] All admin API routes reject unauthenticated requests with 401. Verified by `tests/e2e/security/unauthorized-access.spec.ts`.
- [ ] Viewer role cannot approve bookings. Returns 403 at the API level regardless of UI state.
- [ ] Customer cannot access another customer's booking. IDOR test with two authenticated accounts passes.
- [ ] **[NEW] Customer ID cannot be overridden:** Submitting a different `customerId` in the booking request body has no effect. The booking uses the session's customer ID.
- [ ] **[NEW] Google OAuth redirect is locked:** The OAuth callback URL is restricted to `https://thefield.eg/api/auth/callback/google`. Open redirect test passes.
- [ ] All database queries use parameterized statements. Semgrep SQL injection rules pass with 0 high findings.
- [ ] XSS: customer names containing `<script>` tags are stored as literal text and rendered escaped. Admin dashboard renders no unescaped customer-supplied HTML.
- [ ] CSRF: `SameSite=Lax` session cookies. Mutation routes require `Content-Type: application/json`.
- [ ] Uploaded file type validated via magic bytes (not Content-Type header). PHP upload rejection test passes.
- [ ] Uploaded file names replaced with ULID-generated server-side keys.
- [ ] Payment proofs stored in private R2 bucket. Direct unsigned access returns 403. Verified manually in the R2 console and via automated test.
- [ ] Semgrep: 0 high security findings.
- [ ] npm audit: 0 critical/high CVEs.
- [ ] gitleaks: 0 secrets in git history.
- [ ] OWASP ZAP baseline scan: 0 high/critical findings.
- [ ] Burp Suite manual review completed.
- [ ] `app_user` PostgreSQL role cannot `DELETE` from `bookings`, `payment_records`, `payment_proofs`. Cannot `UPDATE` or `DELETE` from `audit_logs`. Verified by attempting these operations via the application's DB connection.

---

### 16.5 Performance and Accessibility

- [ ] Lighthouse mobile performance score ≥ 85 on home page and booking page (both EN and AR).
- [ ] LCP < 3 seconds on mobile 4G (10 Mbps) for home page and booking page.
- [ ] CLS < 0.1 on home page and booking page.
- [ ] FID/INP < 200ms on home page and booking page.
- [ ] All Core Web Vitals results documented in `docs/performance/core-web-vitals.md`.
- [ ] axe-core: 0 critical violations on all customer-facing pages (EN and AR).
- [ ] All images have meaningful alt text.
- [ ] All form inputs have associated `<label>` elements (not placeholder-only).
- [ ] WCAG 2.1 AA colour contrast (4.5:1 for normal text) on all text.
- [ ] Full keyboard navigation through the booking flow.
- [ ] `prefers-reduced-motion` respected. Verified by browser DevTools.
- [ ] Mobile booking flow completes without horizontal scrolling on 390px viewport (EN and AR).
- [ ] API p95 latency < 500ms for availability endpoint (verified by load test LOAD-T01).
- [ ] API p95 latency < 1000ms for booking creation (verified by load test LOAD-T01).

---

### 16.6 Reliability and Infrastructure

**Application instances:**
- [ ] **[NEW] Two PM2 instances running** on ports 3000 and 3001 in production. `pm2 status` shows both online.
- [ ] **[NEW] Instance failure recovery:** Killing one PM2 instance causes NGINX to route all traffic to the surviving instance within 10 seconds. PM2 auto-restarts the killed instance.
- [ ] **[NEW] Cross-instance session continuity:** Admin and customer sessions remain valid when requests are served by either instance.
- [ ] **[NEW] Stateless confirmed:** No payment proofs, CMS images, or persistent booking state exist on the VPS local disk. All persistent files are in Cloudflare R2.
- [ ] `/api/health/live` returns 200 with no database dependency.
- [ ] `/api/health/ready` returns 200 when database is connected. Returns 503 when database is unavailable.
- [ ] Graceful shutdown: SIGTERM causes the readiness endpoint to return 503 within 2 seconds and the process exits within 35 seconds.

**Database:**
- [ ] Managed PostgreSQL provider in use (Neon, Supabase, or Aiven). Self-managed PostgreSQL on the VPS is not in use for the authoritative database.
- [ ] Managed provider has automated daily backups enabled.
- [ ] PITR (point-in-time recovery) enabled on the production database.
- [ ] **[NEW] DB failure graceful:** When PostgreSQL is deliberately unavailable, all affected routes return 503 with customer-safe messages. Zero 500 errors. No booking reference is issued without a confirmed DB write.
- [ ] DB connection pool correctly configured: `DB_POOL_MAX=10` per instance, `connectionTimeoutMillis=5000`.
- [ ] **[NEW] btree_gist startup check:** Application logs a fatal-level Sentry alert if `btree_gist` extension is absent.
- [ ] All booking writes go to the primary database endpoint. No read replica is used for booking creation or approval.

**Object storage:**
- [ ] Cloudflare R2: `thefield-private` bucket has no public access policy. `thefield-public` bucket allows unauthenticated GET.
- [ ] R2 versioning enabled on `thefield-private` (objects recoverable after accidental deletion for 30 days).
- [ ] **[NEW] Upload integrity check:** After R2 upload, `storageService.exists(key)` is called before writing `payment_proofs` row.
- [ ] **[NEW] Upload failure non-blocking:** R2 failure does not prevent booking creation. Booking is created with `pending` status. Customer can re-upload.

**Background jobs:**
- [ ] Booking expiry job runs every `BOOKING_EXPIRY_JOB_INTERVAL_MINUTES` minutes (env var, not hardcoded).
- [ ] **[NEW] Job heartbeat active:** Sentry cron monitor shows expiry job as checked-in after each run.
- [ ] **[NEW] Job deduplication safe:** Both PM2 instances running the expiry job simultaneously produces correct results (atomic SQL UPDATE — no double-expiry).
- [ ] Only `pending` bookings with `expires_at < NOW()` are expired. `payment_submitted` and `under_review` are never auto-expired.

---

### 16.7 Backups and Disaster Recovery

- [ ] **Daily backup running:** `scripts/backup-db.sh` installed in crontab. Runs at 02:00 UTC. Verified to have run at least once.
- [ ] **Backup in R2:** Latest backup is present in `s3://thefield-backups/daily/` in R2.
- [ ] **[NEW] Backup restored:** The latest backup has been successfully restored to a test database using `scripts/verify-backup.sh`. Integrity checks pass. Exclusion constraint present in restored backup. The restore completed in under 30 minutes.
- [ ] **[NEW] VPS rebuild rehearsed:** A full VPS rebuild and restore from backup was completed on a test server within 2 hours (DR-02 procedure from Section 6.3).
- [ ] **[NEW] Rollback rehearsed:** A known-broken build was deployed to staging and rolled back within 10 minutes using the procedure in Section 13.7.
- [ ] **[NEW] DB failure rehearsed:** Database connection was deliberately broken on staging. Application returned 503. Connection was restored. Application recovered automatically.
- [ ] **RPO documented:** Latest backup is always < 24 hours old. Target RPO: 24 hours for Tier 2.
- [ ] **RTO documented:** Full VPS rebuild and restore tested at < 2 hours. Target RTO: 2 hours for Tier 2.
- [ ] All 7 runbooks written in `docs/runbooks/` and verified against rehearsal outcomes.
- [ ] Environment variables documented in a secure password manager accessible to the venue owner (not only the developer).

---

### 16.8 Monitoring and Observability

- [ ] Sentry is receiving error events from production. Test exception verified.
- [ ] Sentry error alert rules configured: error rate > 5% in 5 min, DB connection error, booking failure spike.
- [ ] UptimeRobot monitors both `/api/health/ready` and `/admin/login`. SMS alerts configured for the venue owner.
- [ ] **[NEW] Sentry cron monitor active** for the expiry job.
- [ ] Structured pino logs are being written. Sensitive fields (`customerPhone`, `password`, `SESSION_SECRET`, `DATABASE_URL`) are redacted in all log output.
- [ ] NGINX access logs are in JSON format. `jq` can parse them.
- [ ] Request ID (`x-request-id`) is present in every API response header and in every application log line.
- [ ] **[NEW] DB connection count visible** on admin dashboard (super-admin only).
- [ ] PostgreSQL slow query log configured: `log_min_duration_statement = 1000ms`.
- [ ] UptimeRobot public status page live at `https://status.thefield.eg`.
- [ ] `scripts/integrity-check.sh` cron installed. Alerts the developer and owner if overlapping approved bookings are detected.

---

### 16.9 Deployment and Operations

- [ ] **CI/CD pipeline passes** on the commit being deployed: TypeScript, lint, unit tests, integration tests, npm audit, Semgrep, gitleaks, build.
- [ ] **E2E tests pass** on staging before production deployment.
- [ ] **Pre-deployment backup taken** and uploaded to R2 before every production deployment.
- [ ] **Health check passes** after deployment: `scripts/smoke-test.sh https://thefield.eg` returns exit code 0.
- [ ] **PM2 startup verified:** `pm2 startup` and `pm2 save` configured. VPS reboot verified to auto-start both instances.
- [ ] **`NODE_ENV=production` set** in production environment.
- [ ] **Seed admin credentials changed.** All admin accounts have `must_change_password = false`.
- [ ] **`.env.example` complete and accurate.** All environment variables documented with descriptions and OBD references where applicable.
- [ ] **No `.env` files with real credentials in the git repository.** gitleaks confirms this.
- [ ] **[NEW] Cloudflare configuration documented** in `docs/cloudflare-configuration.md`. Dynamic routes confirmed as non-cached.
- [ ] **[NEW] Load test results documented** in `docs/load-test-results/`. All 7 k6 scenarios executed. Capacity thresholds updated in Sentry alert rules based on measured data.
- [ ] **[NEW] Production smoke test automated** (`scripts/smoke-test.sh`) and called in the CI deploy job.
- [ ] **[NEW] Rollback procedure documented and tested** in `docs/runbooks/bad-deployment.md`.

---

### 16.10 Documentation

- [ ] README complete: local setup, env vars, migrations, seeding, deployment, backup/restore, troubleshooting.
- [ ] Admin onboarding guide written: how to approve a booking, change pricing, block a date, update InstaPay number, manage FAQs, upload gallery images.
- [ ] All 7 runbooks written in `docs/runbooks/`.
- [ ] `docs/performance/core-web-vitals.md` populated with measurements for EN and AR.
- [ ] `docs/load-test-results/` populated with k6 results.
- [ ] **[NEW] `docs/cloudflare-configuration.md`** documents all Cloudflare settings.
- [ ] Privacy policy page live at `/privacy`.
- [ ] OBD status document: each of OBD-001, OBD-002, OBD-004, OBD-005 has a status entry (pending, confirmed, or formally deferred with date and owner sign-off). OBD-003 is marked resolved: Arabic + English bilingual.

---

### 16.11 Business and Acceptance

- [ ] **Venue owner has tested a real booking end-to-end on production:** create booking (authenticated) → upload InstaPay proof → admin approves → status shows confirmed.
- [ ] **Venue owner can manage the site without developer help:** change InstaPay number, add FAQ, block a date, update operating hours, upload a gallery image — all verified without developer assistance.
- [ ] **OBD-001** (cancellation policy): confirmed by venue owner or formally deferred with sign-off.
- [ ] **OBD-002** (expiry timeout): confirmed by venue owner. `BOOKING_EXPIRY_MINUTES` set in production environment.
- [ ] **OBD-003** (language): RESOLVED — Arabic and English bilingual. Both languages verified working on production.
- [ ] **OBD-004** (operating schedule): confirmed by venue owner. Operating hours populated in the production database by the admin.
- [ ] **OBD-005** (payment-submitted hold): confirmed by venue owner. Admin acknowledges that `payment_submitted` bookings hold their slot until manual admin action.
- [ ] No multi-venue, no marketplace, no multi-tenant functionality exists anywhere in the V1 codebase or database schema. Verified by: no venue selector in admin UI, no venue listing in public UI, `VENUE_ID` is a single env var not a URL parameter, no venue onboarding flow.
- [ ] All hardcoded business values are absent from source code. Venue name, InstaPay number, phone numbers, and prices all sourced from database or CMS.

---

*Document 23 — Production Reliability and Scalability Architecture — The Field V1 — August 31, 2026*  
*This document completes the full specification suite. Sections 1–12 define the reliability and scalability architecture. Sections 13–16 define the deployment strategy, implementation tasks, quality gates, and the authoritative Definition of Done.*
