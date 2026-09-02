# Monitoring Strategy
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. Monitoring Goals

1. Know when the site is down before customers do.
2. Know when an error is causing booking failures.
3. Know when performance degrades significantly.
4. Have enough context to diagnose and fix issues quickly.
5. Detect suspicious activity (unusual booking patterns, repeated auth failures).

---

## 2. Monitoring Stack

| Tool | Purpose | Cost |
|------|---------|------|
| **Sentry** | Error tracking, performance tracing, release tracking | Free tier (5K errors/month) |
| **UptimeRobot** | Uptime check, status page, downtime alerts | Free tier |
| **PM2** | Process health, CPU/memory, crash detection | Built into VPS |
| **PostgreSQL logs** | Query errors, slow queries, connection issues | Built-in |
| **NGINX access/error logs** | Request logs, error rates, rate limit hits | Built-in |
| **Structured app logs** | Business events (bookings created, approvals, failures) | Written to VPS disk |

**Why Sentry over Datadog/New Relic:** Sentry's free tier is sufficient for V1 scale. It provides error grouping, stack traces, breadcrumbs, and performance tracing without the cost of enterprise APM tools. It integrates natively with Next.js.

---

## 3. Uptime Monitoring

### 3.1 UptimeRobot Configuration

| Monitor | URL | Interval | Alert Method |
|---------|-----|----------|--------------|
| Main site | `https://thefield.eg/api/health` | 5 minutes | Email + SMS (owner) |
| Admin dashboard | `https://thefield.eg/admin/login` | 5 minutes | Email |

**Health endpoint contract:**
```json
GET /api/health

Response 200:
{
  "status": "ok",
  "timestamp": "2026-09-05T18:00:00Z",
  "database": "connected",
  "version": "1.0.0",
  "uptime": 86400
}

Response 503 (if DB unavailable):
{
  "status": "degraded",
  "database": "unavailable"
}
```

### 3.2 Status Page

UptimeRobot provides a public status page at `https://status.thefield.eg` (CNAME to UptimeRobot's status page). This allows customers to check if the site is experiencing issues without needing to contact support.

---

## 4. Error Tracking (Sentry)

### 4.1 Sentry Integration

```typescript
// src/instrumentation.ts (Next.js instrumentation file)

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.npm_package_version,
  tracesSampleRate: 0.1,   // 10% of requests traced (adjust based on volume)

  // Scrub sensitive fields before sending to Sentry
  beforeSend(event) {
    // Remove phone numbers and customer names from error context
    if (event.request?.data) {
      delete event.request.data['customerPhone']
      delete event.request.data['customerName']
      delete event.request.data['password']
    }
    return event
  },
})
```

**Important:** Sentry must be configured to scrub sensitive data (phone numbers, names, passwords, file contents) before transmitting error context to Sentry's servers. This is critical for privacy compliance.

### 4.2 Error Alert Rules (Sentry)

| Condition | Alert To | Priority |
|-----------|---------|---------|
| New unhandled error appears | Developer email | Medium |
| Error rate > 5% of requests in 5 min | Developer email + SMS | High |
| `BOOKING_CONFLICT` error spike (>10 in 5 min) | Developer + Admin | Medium |
| Database connection error | Developer + Admin | Critical |
| File upload failure rate > 20% | Developer | Medium |
| Admin login failure rate > 10/hour | Developer (possible attack) | High |

### 4.3 Performance Monitoring

Sentry tracks:
- API route response time (p50, p90, p95, p99).
- Database query duration (slow query detection).
- Next.js page render time.

Alert threshold: Any API route with p95 > 2000ms triggers a performance alert.

---

## 5. Application Logging

### 5.1 Log Structure

All application logs are written in structured JSON using `pino`:

```typescript
// src/lib/logger.ts

import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: [
    'req.headers.cookie',
    'req.headers.authorization',
    'body.password',
    'body.customerPhone',  // compliance: don't log phone numbers
  ],
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty' }  // human-readable in dev
    : undefined,                  // raw JSON in production
})
```

### 5.2 Business Event Logging

Key business events are logged at `info` level:

```typescript
// Booking created
logger.info({ event: 'booking_created', bookingReference, courtId, date, status }, 'New booking created')

// Booking approved
logger.info({ event: 'booking_approved', bookingReference, adminId }, 'Booking approved')

// Payment proof uploaded
logger.info({ event: 'proof_uploaded', bookingId, fileSize, mimeType }, 'Payment proof uploaded')

// Booking expired
logger.info({ event: 'booking_expired', bookingReference, reason: 'payment_timeout' }, 'Booking expired')

// Admin login failure
logger.warn({ event: 'admin_login_failed', email, ip }, 'Failed admin login attempt')
```

### 5.3 Log Retention

- Production logs are written to `/var/log/thefield/`.
- `logrotate` is configured to rotate daily, keep 30 days, compress old logs.
- Error logs are also captured by Sentry (no need to ship to a separate log management service in V1).

```
# /etc/logrotate.d/thefield
/var/log/thefield/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    postrotate
        pm2 reloadLogs
    endscript
}
```

---

## 6. Database Monitoring

### 6.1 Slow Query Detection

PostgreSQL is configured to log slow queries:

```
# /etc/postgresql/16/main/postgresql.conf
log_min_duration_statement = 1000   # log queries taking > 1 second
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
```

These logs are reviewed weekly or when performance issues are suspected.

### 6.2 Connection Pool Monitoring

The application uses a PG connection pool (max 10 connections for V1). If pool exhaustion occurs, it will appear as timeout errors in Sentry.

```typescript
// Pool configuration in db client
{
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
}
```

A monitoring cron checks pool health every 5 minutes via the `/api/health` endpoint, which queries `pg_stat_activity`.

---

## 7. Admin Dashboard Monitoring

The admin dashboard itself serves as a real-time operational view:

| Metric | Admin Dashboard Location |
|--------|------------------------|
| Pending booking requests | Top banner + dashboard card |
| Payments awaiting verification | Dashboard card |
| Today's confirmed bookings | Dashboard card |
| Recent audit activity | Dashboard sidebar |

Admins are expected to check the dashboard at the start of each operational shift and monitor it throughout operating hours.

---

## 8. Security Monitoring

### 8.1 Admin Login Failures

Repeated login failures are:
1. Rate-limited at the application layer (silent block).
2. Logged as `admin_login_failed` events.
3. Surfaced in the audit log viewable by super_admin.

If more than 20 failed login attempts occur against any single email address in one hour, a Sentry alert fires.

### 8.2 Rate Limit Hits

NGINX logs rate limit violations (`limit_req_error_code 429`). A spike in 429 responses from a single IP is visible in NGINX access logs and can be detected by log analysis.

### 8.3 Unusual Booking Patterns

Manual review cadence: The venue admin reviews the booking dashboard daily. Unusual patterns (many pending bookings with no payments, repeated bookings from the same phone, etc.) are visible in the admin booking list. Automated anomaly detection is a V2 feature.

---

## 9. Incident Response Runbook

### 9.1 Site Down

```
1. Check UptimeRobot notification — confirm which checks failed.
2. SSH into VPS: pm2 status thefield
   → If stopped: pm2 start thefield
   → If erroring: pm2 logs thefield --lines 100
3. Check Sentry for the triggering error.
4. Check NGINX: systemctl status nginx
5. Check PostgreSQL: systemctl status postgresql
6. If DB is down: systemctl start postgresql
7. If VPS needs restart: sudo reboot (last resort)
8. After resolution: post update to status page.
```

### 9.2 Booking Failure

```
1. Customer reports unable to book.
2. Check Sentry for recent errors on /api/v1/bookings.
3. Test availability endpoint manually: curl https://thefield.eg/api/v1/availability?...
4. Check PostgreSQL connection: SELECT COUNT(*) FROM pg_stat_activity;
5. Check booking expiry job is running: pm2 logs | grep expire
6. If pricing misconfigured: check court_pricing_rules in admin dashboard.
7. Resolve and test booking flow end-to-end.
```

### 9.3 Suspected Security Incident

```
1. Check Sentry for unusual error patterns.
2. Review NGINX access logs: grep for 401, 403, 429 spikes.
3. Review audit_logs in admin dashboard for suspicious admin actions.
4. If admin account may be compromised:
   a. Deactivate the account immediately (admin UI → deactivate).
   b. Rotate SESSION_SECRET (forces all sessions to expire).
   c. Review audit_logs for actions taken by that account.
5. If database credentials may be compromised:
   a. Change database user password.
   b. Update DATABASE_URL environment variable.
   c. Reload PM2.
6. If storage credentials may be compromised:
   a. Rotate R2 access keys immediately.
   b. Update environment variables.
7. Document the incident and actions taken.
```

---

## 10. Metrics to Review Monthly

| Metric | Source | Why |
|--------|--------|-----|
| Total bookings (by status) | Database | Revenue and growth tracking |
| Booking completion rate | Database | Funnel health |
| Average payment verification time | Database | Admin efficiency |
| Error rate trend | Sentry | Code quality signal |
| p95 API response time | Sentry | Performance trend |
| Storage usage | R2 console | Capacity planning |
| VPS CPU/RAM usage | Hostinger panel / PM2 | Scaling signal |
| Failed login attempts | Audit logs | Security signal |
