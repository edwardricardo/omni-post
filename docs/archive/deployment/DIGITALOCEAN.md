# DigitalOcean Deployment Guide

Cost-effective production deployment of OmniPost on DigitalOcean. Recommended for early-stage startups and small teams.

---

## Architecture

```
                        +------------------+
                        |   DigitalOcean   |
                        |   DNS            |
                        +--------+---------+
                                 |
                        +--------+---------+
                        |   Nginx + SSL    |
                        |   (Let's Encrypt)|
                        +--------+---------+
                                 |
                   +-------------+-------------+
                   |                           |
          +--------+---------+        +--------+---------+
          |   Droplet        |        |   Spaces (S3)    |
          |   (Ubuntu 24.04) |        |   Media Storage  |
          |   +-----------+  |        |   + CDN          |
          |   | PM2       |  |        +------------------+
          |   |  API      |  |
          |   |  Workers  |  |
          |   +-----------+  |
          +--------+---------+
                   |
          +--------+---------+---------+
          |                            |
  +-------+--------+         +--------+--------+
  |   Managed DB   |         |   Managed       |
  |   PostgreSQL   |         |   Redis 7       |
  |   16           |         |                 |
  +----------------+         +-----------------+
```

---

## Estimated Monthly Costs

| Service                         | Tier / Config               | Est. Cost |
| ------------------------------- | --------------------------- | --------- |
| Droplet (API + Workers)         | s-2vcpu-4gb (Regular)       | $24       |
| Managed PostgreSQL 16           | db-s-1vcpu-2gb, single node | $15       |
| Managed Redis 7                 | db-s-1vcpu-1gb              | $10       |
| Spaces (250 GB + 1 TB transfer) | Standard                    | $5        |
| Spaces CDN                      | Included with Spaces        | $0        |
| Reserved IP                     | 1 IP                        | $4        |
| Backups (Droplet)               | 20% of Droplet cost         | $5        |
| **Total estimate**              |                             | **~$63**  |

For high availability (2 Droplets + Load Balancer + standby DB): ~$130/month.

---

## Prerequisites

- DigitalOcean account with API token
- doctl CLI installed: `doctl version`
- SSH key added to DigitalOcean
- Domain name pointed to DigitalOcean DNS (optional but recommended)

```bash
# Authenticate
doctl auth init
# Enter your API token when prompted

# Verify
doctl account get
```

---

## Step 1: Create Managed PostgreSQL Database

```bash
doctl databases create omnipost-postgres \
  --engine pg \
  --version 16 \
  --size db-s-1vcpu-2gb \
  --region nyc1 \
  --num-nodes 1

# Wait for database to be ready (2-5 minutes)
doctl databases list

# Get connection details
export DB_ID=$(doctl databases list --format ID --no-header | head -1)

doctl databases connection $DB_ID --format Host,Port,User,Password,Database
```

Create the application database:

```bash
doctl databases db create $DB_ID omnipostdb
```

Get the connection string (use the private network URI for Droplet connections):

```bash
doctl databases connection $DB_ID --format URI --no-header
```

The DATABASE_URL will look like:
`postgresql://doadmin:<PASSWORD>@private-omnipost-postgres-do-user-xxxxx.db.ondigitalocean.com:25060/omnipostdb?sslmode=require`

---

## Step 2: Create Managed Redis Database

```bash
doctl databases create omnipost-redis \
  --engine redis \
  --version 7 \
  --size db-s-1vcpu-1gb \
  --region nyc1 \
  --num-nodes 1

# Get connection details
export REDIS_DB_ID=$(doctl databases list --format ID --no-header | tail -1)

doctl databases connection $REDIS_DB_ID --format URI --no-header
```

The REDIS_URL will look like:
`rediss://default:<PASSWORD>@private-omnipost-redis-do-user-xxxxx.db.ondigitalocean.com:25061`

---

## Step 3: Create Spaces Bucket (S3-Compatible)

```bash
# Create Spaces bucket via doctl or the web console
# Spaces must be created in a supported region (nyc3, sfo3, ams3, sgp1, fra1)
doctl compute cdn create \
  --origin omnipost-media.nyc3.digitaloceanspaces.com
```

Create Spaces via the web console at https://cloud.digitalocean.com/spaces:

1. Click "Create Spaces Bucket"
2. Region: **nyc3** (or closest to your Droplet)
3. Name: **omnipost-media**
4. File Listing: **Restricted**
5. Enable CDN: **Yes**

Generate Spaces API keys:

1. Go to API > Spaces Keys
2. Click "Generate New Key"
3. Save the Key and Secret

Environment variables for Spaces:

```env
STORAGE_PROVIDER=do-spaces
DO_SPACES_BUCKET=omnipost-media
DO_SPACES_REGION=nyc3
DO_SPACES_KEY=<your-spaces-key>
DO_SPACES_SECRET=<your-spaces-secret>
DO_SPACES_ENDPOINT=nyc3.digitaloceanspaces.com
```

---

## Step 4: Create Droplet

```bash
# Create Droplet
doctl compute droplet create omnipost-api \
  --image ubuntu-24-04-x64 \
  --size s-2vcpu-4gb \
  --region nyc1 \
  --ssh-keys $(doctl compute ssh-key list --format ID --no-header | head -1) \
  --enable-monitoring \
  --enable-backups \
  --tag-names omnipost,production

# Assign reserved IP
doctl compute reserved-ip create --region nyc1
export RESERVED_IP=$(doctl compute reserved-ip list --format IP --no-header | head -1)
export DROPLET_ID=$(doctl compute droplet list --format ID --no-header | head -1)

doctl compute reserved-ip-action assign $RESERVED_IP $DROPLET_ID
```

---

## Step 5: Configure Droplet

SSH into the Droplet:

```bash
ssh root@$RESERVED_IP
```

### Install system dependencies

```bash
# Update system
apt update && apt upgrade -y

# Install Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs

# Install pnpm
corepack enable
corepack prepare pnpm@10.16.0 --activate

# Install PM2 globally
npm install -g pm2

# Install Nginx
apt install -y nginx

# Install ffmpeg (for video processing)
apt install -y ffmpeg

# Install certbot for Let's Encrypt
apt install -y certbot python3-certbot-nginx

# Verify installations
node --version     # v24.x.x
pnpm --version     # 10.16.0
pm2 --version      # 5.x.x
nginx -v           # nginx/1.24.x
ffmpeg -version    # ffmpeg version 6.x
```

### Create application user

```bash
adduser --disabled-password --gecos "" omnipost
usermod -aG sudo omnipost
mkdir -p /home/omnipost/app
chown omnipost:omnipost /home/omnipost/app
```

---

## Step 6: Clone and Build

```bash
su - omnipost
cd /home/omnipost/app

git clone https://github.com/your-org/omni-post.git .
pnpm install --frozen-lockfile
```

### Configure environment

```bash
cp .env.example .env
nano .env
```

Set these values in `.env`:

```env
# ---- Core ----
NODE_ENV=production
PORT=3000
API_BASE_URL=https://api.yourdomain.com
CLIENT_URL=https://app.yourdomain.com
ADMIN_URL=https://admin.yourdomain.com
APP_BASE_URL=https://api.yourdomain.com

# ---- Database (use private network URI) ----
DATABASE_URL=postgresql://doadmin:<PASSWORD>@private-omnipost-postgres-do-user-xxxxx.db.ondigitalocean.com:25060/omnipostdb?sslmode=require

# ---- Redis (use private network URI) ----
REDIS_URL=rediss://default:<PASSWORD>@private-omnipost-redis-do-user-xxxxx.db.ondigitalocean.com:25061

# ---- Auth ----
JWT_SECRET=<generate: openssl rand -hex 64>
JWT_REFRESH_SECRET=<generate: openssl rand -hex 64>
ADMIN_JWT_ACCESS_SECRET=<generate: openssl rand -hex 64>
ADMIN_JWT_REFRESH_SECRET=<generate: openssl rand -hex 64>
CUSTOMER_JWT_SECRET=<generate: openssl rand -hex 64>
OAUTH_ENCRYPTION_KEY=<generate: openssl rand -hex 32>

# ---- Storage (DigitalOcean Spaces) ----
STORAGE_PROVIDER=do-spaces
DO_SPACES_BUCKET=omnipost-media
DO_SPACES_REGION=nyc3
DO_SPACES_KEY=<your-spaces-key>
DO_SPACES_SECRET=<your-spaces-secret>
DO_SPACES_ENDPOINT=nyc3.digitaloceanspaces.com

# ---- Email ----
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM_ADDRESS=notifications@yourdomain.com

# ---- AI (optional) ----
OPENAI_API_KEY=sk-xxxxxxxxxxxx
OPENAI_MODEL=gpt-4
GEMINI_API_KEY=xxxxxxxxxxxx
GEMINI_MODEL=gemini-1.5-flash
PERPLEXITY_API_KEY=pplx-xxxxxxxxxxxx
PERPLEXITY_MODEL=llama-3.1-sonar-small-128k-online

# ---- Payment ----
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_live_<YOUR_STRIPE_LIVE_KEY>
STRIPE_WEBHOOK_SECRET=whsec_<YOUR_WEBHOOK_SECRET>

# ---- Observability ----
TRACING_ENABLED=false
LOG_LEVEL=info

# ---- Video Processing ----
FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe
```

### Run migrations and build

```bash
pnpm db:migrate
pnpm db:seed    # Optional: only for initial data
pnpm build
```

---

## Step 7: Configure PM2 Process Manager

Create the PM2 ecosystem file:

```bash
cat > /home/omnipost/app/ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [
    {
      name: "omnipost-api",
      script: "dist/index.js",
      cwd: "/home/omnipost/app/apps/api",
      instances: 2,
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      max_memory_restart: "1G",
      error_file: "/home/omnipost/logs/api-error.log",
      out_file: "/home/omnipost/logs/api-out.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "omnipost-workers",
      script: "dist/index.js",
      cwd: "/home/omnipost/app/apps/workers",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "1G",
      error_file: "/home/omnipost/logs/workers-error.log",
      out_file: "/home/omnipost/logs/workers-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
EOF

mkdir -p /home/omnipost/logs
```

Start services:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u omnipost --hp /home/omnipost
```

Verify processes are running:

```bash
pm2 status
pm2 logs --lines 20
```

---

## Step 8: Configure Nginx Reverse Proxy

Switch to root:

```bash
sudo su -
```

Create Nginx configuration:

```bash
cat > /etc/nginx/sites-available/omnipost << 'NGINX'
# Rate limiting
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;

# API
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        limit_req zone=api burst=50 nodelay;

        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;

        # Security headers
        add_header X-Frame-Options DENY always;
        add_header X-Content-Type-Options nosniff always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy strict-origin-when-cross-origin always;
    }

    # Health check (no rate limit)
    location /health {
        proxy_pass http://127.0.0.1:3000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # Max upload size for media
    client_max_body_size 100M;
}
NGINX

# Enable the site
ln -sf /etc/nginx/sites-available/omnipost /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test and reload
nginx -t
systemctl reload nginx
```

---

## Step 9: Configure Let's Encrypt SSL

```bash
certbot --nginx -d api.yourdomain.com --non-interactive --agree-tos -m admin@yourdomain.com

# Verify auto-renewal
certbot renew --dry-run
```

Certbot automatically configures Nginx to redirect HTTP to HTTPS and adds the SSL certificate.

---

## Step 10: Configure Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
ufw status
```

Expected output:

```
Status: active

To                         Action      From
--                         ------      ----
OpenSSH                    ALLOW       Anywhere
Nginx Full                 ALLOW       Anywhere
OpenSSH (v6)               ALLOW       Anywhere (v6)
Nginx Full (v6)            ALLOW       Anywhere (v6)
```

---

## Step 11: Configure Database Trusted Sources

Restrict database access to only your Droplet:

```bash
# Add Droplet to database trusted sources
doctl databases firewalls append $DB_ID \
  --rule droplet:$DROPLET_ID

doctl databases firewalls append $REDIS_DB_ID \
  --rule droplet:$DROPLET_ID
```

---

## Post-Deployment Verification

```bash
# Health check
curl https://api.yourdomain.com/health

# Check PM2 processes
ssh root@$RESERVED_IP "su - omnipost -c 'pm2 status'"

# Check database connectivity
ssh root@$RESERVED_IP "su - omnipost -c 'cd /home/omnipost/app && pnpm db:studio'"

# Check Nginx logs
ssh root@$RESERVED_IP "tail -20 /var/log/nginx/access.log"

# Check application logs
ssh root@$RESERVED_IP "su - omnipost -c 'pm2 logs --lines 50'"
```

---

## Deployment Updates

To deploy a new version:

```bash
ssh root@$RESERVED_IP
su - omnipost
cd /home/omnipost/app

git pull origin main
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
pm2 reload ecosystem.config.cjs
```

For zero-downtime deployments, PM2 cluster mode reloads one instance at a time.

---

## Monitoring

### DigitalOcean built-in monitoring

Enable Droplet monitoring graphs in the DigitalOcean console for CPU, memory, disk, and bandwidth.

### PM2 monitoring

```bash
# Real-time dashboard
pm2 monit

# Process details
pm2 describe omnipost-api

# Restart stats
pm2 status
```

### Log rotation

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

---

## Scaling Up

### Vertical scaling (resize Droplet)

```bash
# Power off first
doctl compute droplet-action power-off $DROPLET_ID --wait
doctl compute droplet-action resize $DROPLET_ID --size s-4vcpu-8gb --wait
doctl compute droplet-action power-on $DROPLET_ID --wait
```

### Horizontal scaling (multiple Droplets + Load Balancer)

```bash
# Create Load Balancer
doctl compute load-balancer create \
  --name omnipost-lb \
  --region nyc1 \
  --forwarding-rules "entry_protocol:https,entry_port:443,target_protocol:http,target_port:3000,certificate_id:<CERT_ID>,tls_passthrough:false" \
  --health-check "protocol:http,port:3000,path:/health,check_interval_seconds:10,response_timeout_seconds:5,healthy_threshold:3,unhealthy_threshold:3" \
  --droplet-ids $DROPLET_ID

# Scale PostgreSQL
doctl databases resize $DB_ID --size db-s-2vcpu-4gb
```

---

## Backup and Recovery

### Droplet backups

Enabled during creation. Weekly automated backups retained for 4 weeks.

### Database backups

DigitalOcean Managed Databases include daily automated backups with 7-day retention. Restore from the web console or CLI:

```bash
# Fork from a backup (creates a new database cluster)
doctl databases fork $DB_ID --restore-from <backup-timestamp>
```

### Manual backup before migrations

```bash
ssh root@$RESERVED_IP "su - omnipost -c 'cd /home/omnipost/app && pg_dump \$DATABASE_URL > /home/omnipost/backups/pre-migration-\$(date +%Y%m%d).sql'"
```
