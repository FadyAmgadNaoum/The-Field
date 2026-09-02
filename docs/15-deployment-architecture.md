# Deployment Architecture
## The Field — Padel Court Booking Website
**Version:** 1.0  
**Date:** August 31, 2026  
**Status:** Approved for Implementation

---

## 1. Infrastructure Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     HOSTINGER VPS                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  NGINX (port 80/443)                                │   │
│  │  - TLS termination (Let's Encrypt)                  │   │
│  │  - Rate limiting                                    │   │
│  │  - Security headers                                 │   │
│  │  - Static file serving (Next.js public/)            │   │
│  │  - Reverse proxy → Node.js:3000                     │   │
│  └─────────────────────────┬───────────────────────────┘   │
│                            │                               │
│  ┌─────────────────────────▼───────────────────────────┐   │
│  │  PM2 Process Manager                                │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  Next.js App (Node.js, port 3000)           │   │   │
│  │  │  - App Router (SSR + API routes)            │   │   │
│  │  │  - node-cron jobs (booking expiry)          │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  PostgreSQL 16                                      │   │
│  │  - Listens on 127.0.0.1:5432 (not public)          │   │
│  │  - Daily pg_dump backup                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  /var/www/thefield/                                         │
│  /var/backups/thefield/                                     │
│  /etc/nginx/sites-available/thefield                        │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  Cloudflare R2                    Sentry.io
  (Object Storage)             (Error Monitoring)
```

---

## 2. Hostinger VPS Specification

| Component | Minimum Spec | Recommended |
|-----------|-------------|-------------|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Storage | 80 GB SSD | 160 GB SSD |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| Bandwidth | 4 TB/month | 8 TB/month |

**Why Hostinger VPS over shared hosting:** Next.js requires Node.js runtime — not available on shared hosting. A VPS gives full control over the Node.js version, PM2 process management, PostgreSQL installation, and NGINX configuration.

---

## 3. Software Stack on VPS

| Software | Version | Purpose |
|----------|---------|---------|
| Ubuntu | 22.04 LTS | Operating system |
| Node.js | 20 LTS | JavaScript runtime |
| npm | 10.x | Package manager |
| Next.js | 14.x | Application framework |
| PostgreSQL | 16 | Database |
| NGINX | 1.24+ | Reverse proxy, TLS, rate limiting |
| PM2 | 5.x | Process manager, auto-restart |
| Certbot | Latest | Let's Encrypt TLS certificates |

---

## 4. NGINX Configuration

```nginx
# /etc/nginx/sites-available/thefield

# Rate limit zones
limit_req_zone $binary_remote_addr zone=booking_api:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=admin_login:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=general:10m rate=120r/m;

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name thefield.eg www.thefield.eg;
    return 301 https://$host$request_uri;
}

# Main HTTPS server
server {
    listen 443 ssl http2;
    server_name thefield.eg www.thefield.eg;

    # TLS (managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/thefield.eg/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/thefield.eg/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:...;
    ssl_prefer_server_ciphers off;

    # Security headers (belt-and-suspenders with Next.js middleware)
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # File upload size
    client_max_body_size 12m;

    # Rate limiting for sensitive routes
    location /api/v1/bookings {
        limit_req zone=booking_api burst=5 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/v1/admin/auth/login {
        limit_req zone=admin_login burst=2 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # General proxy for all other routes
    location / {
        limit_req zone=general burst=30 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

---

## 5. PM2 Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'thefield',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: '/var/www/thefield',
      instances: 1,                  // single instance for V1
      exec_mode: 'fork',             // not cluster — stateful cron job
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '1G',      // restart if memory exceeds 1GB
      error_file: '/var/log/thefield/error.log',
      out_file: '/var/log/thefield/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
    }
  ]
}
```

**Why `fork` mode, not `cluster`:** The node-cron booking expiry job runs inside the Node.js process. In cluster mode, multiple processes would each run the cron job — causing redundant expiry operations. Fork mode with a single process is correct for V1.

---

## 6. Environment Variables

All environment variables are set directly in the VPS environment (not in `.env` files in production):

```bash
# /etc/environment or set via PM2 env_production
# NEVER committed to Git

# Application
NODE_ENV=production
PORT=3000
NEXT_PUBLIC_SITE_URL=https://thefield.eg
VENUE_ID=<uuid of the venue row>
VENUE_SLUG=the-field

# Database
DATABASE_URL=postgresql://app_user:STRONG_PASSWORD@127.0.0.1:5432/thefield
DATABASE_MIGRATION_URL=postgresql://migration_user:STRONG_PASSWORD@127.0.0.1:5432/thefield

# Session
SESSION_SECRET=<64-char random string — generated with: openssl rand -hex 64>

# Storage
STORAGE_PROVIDER=s3
S3_REGION=auto
S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=<r2 access key>
S3_SECRET_ACCESS_KEY=<r2 secret key>
S3_PRIVATE_BUCKET=thefield-private
S3_PUBLIC_BUCKET=thefield-public
S3_PUBLIC_BASE_URL=https://media.thefield.eg

# Monitoring
SENTRY_DSN=https://<key>@sentry.io/<project>
SENTRY_AUTH_TOKEN=<token>

# Booking expiry (optional override)
BOOKING_EXPIRY_MINUTES=120
BOOKING_EXPIRY_JOB_INTERVAL_MINUTES=15
```

**`.env.example` in Git** contains all keys with empty or placeholder values and comments. Actual values are never in Git.

---

## 7. Deployment Workflow

### 7.1 Initial Setup (One-Time)

```bash
# On VPS as root or sudo user

# 1. Install system dependencies
apt update && apt upgrade -y
apt install -y nginx postgresql-16 certbot python3-certbot-nginx

# 2. Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2

# 3. Clone repository
mkdir -p /var/www/thefield
git clone https://github.com/org/thefield.git /var/www/thefield
cd /var/www/thefield

# 4. Set environment variables
# (edit /etc/environment or use PM2 env file)

# 5. Install dependencies
npm ci --production=false

# 6. Run database migrations
npm run db:migrate

# 7. Seed initial data
npm run db:seed

# 8. Build application
npm run build

# 9. Start with PM2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup  # configure PM2 to start on system boot

# 10. Configure NGINX
cp nginx/thefield.conf /etc/nginx/sites-available/thefield
ln -s /etc/nginx/sites-available/thefield /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 11. TLS certificate
certbot --nginx -d thefield.eg -d www.thefield.eg

# 12. Set up backup cron
crontab -e
# Add: 0 2 * * * /var/www/thefield/scripts/backup-db.sh
```

### 7.2 Deployment Script (Subsequent Deployments)

```bash
#!/bin/bash
# scripts/deploy.sh — run on VPS via GitHub Actions or manually

set -e

APP_DIR=/var/www/thefield
BACKUP_DIR=/var/backups/thefield

echo "=== Backing up database ==="
pg_dump -U app_user thefield > "$BACKUP_DIR/pre-deploy-$(date +%Y%m%d-%H%M%S).sql"

echo "=== Pulling latest code ==="
cd $APP_DIR
git pull origin main

echo "=== Installing dependencies ==="
npm ci --production=false

echo "=== Running migrations ==="
npm run db:migrate

echo "=== Building application ==="
npm run build

echo "=== Reloading PM2 ==="
pm2 reload thefield --update-env

echo "=== Deployment complete ==="
```

**Zero-downtime reload:** `pm2 reload` performs a graceful reload — the new process starts and begins accepting requests before the old process is terminated. Because sessions are in encrypted cookies (not in-memory), existing sessions survive the reload.

### 7.3 GitHub Actions (Optional CI/CD)

```yaml
# .github/workflows/deploy.yml

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test:unit -- --run
      - run: npm audit --audit-level=high

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: /var/www/thefield/scripts/deploy.sh
```

---

## 8. Database Backup Strategy

```bash
#!/bin/bash
# scripts/backup-db.sh

BACKUP_DIR=/var/backups/thefield
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
FILENAME="$BACKUP_DIR/thefield-$TIMESTAMP.sql.gz"

# Create backup
pg_dump -U app_user -h 127.0.0.1 thefield | gzip > "$FILENAME"

# Upload to R2 for off-site storage
aws s3 cp "$FILENAME" "s3://thefield-backups/$FILENAME" \
  --endpoint-url "$S3_ENDPOINT" \
  --no-progress

# Remove local backups older than 7 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete

echo "Backup completed: $FILENAME"
```

Scheduled daily at 02:00 EGT (midnight UTC). Backups are also uploaded to R2 bucket `thefield-backups` for off-site retention of 30 days.

---

## 9. TLS and DNS Configuration

| Record | Type | Value |
|--------|------|-------|
| `thefield.eg` | A | VPS IP address |
| `www.thefield.eg` | CNAME | `thefield.eg` |
| `media.thefield.eg` | CNAME | R2 public bucket domain |

TLS certificate is issued by Let's Encrypt via Certbot. Auto-renewal is configured by Certbot's systemd timer (renews at 60-day intervals).

---

## 10. Environments

| Environment | URL | Branch | Database | Notes |
|-------------|-----|--------|----------|-------|
| Production | `https://thefield.eg` | `main` | Production PG | Real data |
| Staging | `https://staging.thefield.eg` | `develop` | Separate staging DB | Pre-launch testing |
| Development | `http://localhost:3000` | any | Local Docker PG | Developer machines |

Staging mirrors production configuration exactly. All release candidates are validated on staging before being promoted to production.

---

## 11. Health Monitoring

- **UptimeRobot** (free tier): Pings `/api/health` every 5 minutes. Sends email/SMS on downtime.
- **PM2 monitoring**: `pm2 monit` for real-time CPU/memory on VPS.
- **Sentry**: Application errors, performance traces (see Monitoring Strategy doc).
- **PostgreSQL**: `pg_stat_activity` monitoring via a simple cron check every 30 minutes.

```bash
# scripts/health-check.sh (cron every 30 min)
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" https://thefield.eg/api/health)
if [ "$RESPONSE" != "200" ]; then
  echo "Health check failed: HTTP $RESPONSE" | mail -s "The Field: Health Check Failed" admin@thefield.eg
fi
```
