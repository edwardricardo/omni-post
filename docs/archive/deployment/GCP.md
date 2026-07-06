# Google Cloud Platform Deployment Guide

Production deployment of OmniPost on Google Cloud Platform.

---

## Architecture

```
                        +------------------+
                        |   Cloud DNS      |
                        +--------+---------+
                                 |
                        +--------+---------+
                        |   Cloud CDN      |
                        |   + Load Balancer|
                        +--------+---------+
                                 |
                   +-------------+-------------+
                   |                           |
          +--------+---------+        +--------+---------+
          |   Cloud Run      |        |   Cloud Storage  |
          |   +-----------+  |        |   Media Bucket   |
          |   | API       |  |        +------------------+
          |   | Workers   |  |
          |   | Admin     |  |
          |   | Client    |  |
          |   +-----------+  |
          +--------+---------+
                   |
          +--------+---------+---------+
          |                            |
  +-------+--------+         +--------+--------+
  |   Cloud SQL    |         |   Memorystore   |
  |   PostgreSQL   |         |   Redis 7       |
  |   16 HA        |         |   Standard      |
  +----------------+         +-----------------+
```

---

## Estimated Monthly Costs

| Service                    | Tier / Config             | Est. Cost    |
| -------------------------- | ------------------------- | ------------ |
| Cloud Run (API)            | 2 vCPU / 2 GB, min 1 inst | $40-60       |
| Cloud Run (Workers)        | 2 vCPU / 2 GB, min 1 inst | $30-50       |
| Cloud Run (Admin + Client) | 1 vCPU / 512 MB each      | $20-30       |
| Cloud SQL PostgreSQL 16    | db-custom-2-4096, HA      | $130-170     |
| Memorystore Redis          | Basic, 1 GB               | $35-45       |
| Cloud Storage              | 50 GB standard            | $1-3         |
| Cloud CDN + Load Balancer  | 100 GB transfer           | $20-30       |
| Cloud DNS                  | Managed zone              | $1-3         |
| Cloud Logging + Monitoring | 5 GB/month                | $0-10        |
| Secret Manager             | 20 secrets, 10K accesses  | $1-2         |
| **Total estimate**         |                           | **$280-400** |

---

## Prerequisites

- GCP account with billing enabled
- gcloud CLI installed: `gcloud version` (450+)
- Docker installed locally
- Login and set project:

```bash
gcloud auth login
gcloud config set project <YOUR_PROJECT_ID>
export PROJECT_ID=$(gcloud config get-value project)
export REGION=us-central1
```

---

## Step 1: Enable Required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  compute.googleapis.com \
  vpcaccess.googleapis.com \
  dns.googleapis.com
```

---

## Step 2: Create VPC and Serverless VPC Connector

Cloud Run needs a VPC connector to reach Cloud SQL and Memorystore:

```bash
# Create VPC network
gcloud compute networks create omnipost-vpc \
  --subnet-mode=auto

# Create Serverless VPC Access connector
gcloud compute networks vpc-access connectors create omnipost-connector \
  --region=$REGION \
  --network=omnipost-vpc \
  --range=10.8.0.0/28 \
  --min-instances=2 \
  --max-instances=10
```

---

## Step 3: Create Cloud SQL PostgreSQL Instance

```bash
# Create instance with HA
gcloud sql instances create omnipost-postgres \
  --database-version=POSTGRES_16 \
  --tier=db-custom-2-4096 \
  --region=$REGION \
  --availability-type=REGIONAL \
  --storage-size=50GB \
  --storage-auto-increase \
  --backup-start-time=03:00 \
  --enable-point-in-time-recovery \
  --retained-backups-count=7 \
  --network=omnipost-vpc \
  --no-assign-ip \
  --database-flags=log_min_duration_statement=1000

# Set root password
gcloud sql users set-password postgres \
  --instance=omnipost-postgres \
  --password='<STRONG_PASSWORD_HERE>'

# Create application user
gcloud sql users create omnipost_admin \
  --instance=omnipost-postgres \
  --password='<APP_PASSWORD_HERE>'

# Create database
gcloud sql databases create omnipostdb \
  --instance=omnipost-postgres

# Get private IP
gcloud sql instances describe omnipost-postgres \
  --format='value(ipAddresses.filter(type=PRIVATE).ipAddress)'
```

The DATABASE_URL will be:
`postgresql://omnipost_admin:<PASSWORD>@<PRIVATE_IP>:5432/omnipostdb`

---

## Step 4: Create Memorystore Redis Instance

```bash
gcloud redis instances create omnipost-redis \
  --region=$REGION \
  --size=1 \
  --tier=basic \
  --redis-version=redis_7_2 \
  --network=omnipost-vpc \
  --connect-mode=PRIVATE_SERVICE_ACCESS

# Get the Redis host and port
gcloud redis instances describe omnipost-redis \
  --region=$REGION \
  --format='value(host)'

gcloud redis instances describe omnipost-redis \
  --region=$REGION \
  --format='value(port)'
```

The REDIS_URL will be:
`redis://<REDIS_HOST>:6379`

---

## Step 5: Create Cloud Storage Bucket

```bash
# Create bucket
gcloud storage buckets create gs://${PROJECT_ID}-omnipost-media \
  --location=$REGION \
  --default-storage-class=STANDARD \
  --uniform-bucket-level-access

# Set lifecycle rules (transition to Nearline after 90 days)
cat > /tmp/lifecycle.json << 'EOF'
{
  "rule": [
    {
      "action": {"type": "SetStorageClass", "storageClass": "NEARLINE"},
      "condition": {"age": 90}
    },
    {
      "action": {"type": "SetStorageClass", "storageClass": "COLDLINE"},
      "condition": {"age": 365}
    }
  ]
}
EOF

gcloud storage buckets update gs://${PROJECT_ID}-omnipost-media \
  --lifecycle-file=/tmp/lifecycle.json

# Enable versioning
gcloud storage buckets update gs://${PROJECT_ID}-omnipost-media \
  --versioning
```

---

## Step 6: Create Service Account

```bash
# Create service account for Cloud Run
gcloud iam service-accounts create omnipost-api \
  --display-name="OmniPost API Service Account"

export SA_EMAIL=omnipost-api@${PROJECT_ID}.iam.gserviceaccount.com

# Grant Cloud SQL Client role
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudsql.client"

# Grant Storage Admin role
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin"

# Grant Secret Manager Accessor role
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"

# Grant Cloud Trace Agent role
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudtrace.agent"
```

---

## Step 7: Store Secrets in Secret Manager

```bash
# Helper function
create_secret() {
  echo -n "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=automatic
}

create_secret omnipost-database-url \
  "postgresql://omnipost_admin:<PASSWORD>@<PRIVATE_IP>:5432/omnipostdb"

create_secret omnipost-redis-url \
  "redis://<REDIS_HOST>:6379"

create_secret omnipost-jwt-secret "$(openssl rand -hex 64)"
create_secret omnipost-jwt-refresh-secret "$(openssl rand -hex 64)"
create_secret omnipost-admin-jwt-access "$(openssl rand -hex 64)"
create_secret omnipost-admin-jwt-refresh "$(openssl rand -hex 64)"
create_secret omnipost-customer-jwt "$(openssl rand -hex 64)"
create_secret omnipost-oauth-encryption-key "$(openssl rand -hex 32)"
create_secret omnipost-stripe-secret-key "sk_live_<YOUR_STRIPE_LIVE_KEY>"
create_secret omnipost-stripe-webhook-secret "whsec_<YOUR_WEBHOOK_SECRET>"
create_secret omnipost-resend-api-key "re_xxxxxxxxxxxx"
create_secret omnipost-openai-api-key "sk-xxxxxxxxxxxx"
create_secret omnipost-gemini-api-key "xxxxxxxxxxxx"
create_secret omnipost-perplexity-api-key "pplx-xxxxxxxxxxxx"
```

---

## Step 8: Build and Push Docker Image

```bash
# Create Artifact Registry repository
gcloud artifacts repositories create omnipost \
  --repository-format=docker \
  --location=$REGION

# Configure Docker auth
gcloud auth configure-docker ${REGION}-docker.pkg.dev

# Build and push
export IMAGE=${REGION}-docker.pkg.dev/${PROJECT_ID}/omnipost/api:latest

docker build -t $IMAGE .
docker push $IMAGE
```

---

## Step 9: Deploy to Cloud Run

```bash
gcloud run deploy omnipost-api \
  --image=$IMAGE \
  --region=$REGION \
  --platform=managed \
  --service-account=$SA_EMAIL \
  --vpc-connector=omnipost-connector \
  --vpc-egress=private-ranges-only \
  --min-instances=1 \
  --max-instances=10 \
  --memory=2Gi \
  --cpu=2 \
  --port=3000 \
  --allow-unauthenticated \
  --set-env-vars="\
NODE_ENV=production,\
PORT=3000,\
API_BASE_URL=https://omnipost-api-xxxxx-uc.a.run.app,\
CLIENT_URL=https://app.yourdomain.com,\
ADMIN_URL=https://admin.yourdomain.com,\
APP_BASE_URL=https://api.yourdomain.com,\
STORAGE_PROVIDER=gcs,\
GCS_PROJECT_ID=${PROJECT_ID},\
GCS_BUCKET_NAME=${PROJECT_ID}-omnipost-media,\
OPENAI_MODEL=gpt-4,\
GEMINI_MODEL=gemini-1.5-flash,\
PERPLEXITY_MODEL=llama-3.1-sonar-small-128k-online,\
PAYMENT_PROVIDER=stripe,\
TRACING_ENABLED=true,\
OTEL_SERVICE_NAME=omnipost-api,\
LOG_LEVEL=info" \
  --set-secrets="\
DATABASE_URL=omnipost-database-url:latest,\
REDIS_URL=omnipost-redis-url:latest,\
JWT_SECRET=omnipost-jwt-secret:latest,\
JWT_REFRESH_SECRET=omnipost-jwt-refresh-secret:latest,\
ADMIN_JWT_ACCESS_SECRET=omnipost-admin-jwt-access:latest,\
ADMIN_JWT_REFRESH_SECRET=omnipost-admin-jwt-refresh:latest,\
CUSTOMER_JWT_SECRET=omnipost-customer-jwt:latest,\
OAUTH_ENCRYPTION_KEY=omnipost-oauth-encryption-key:latest,\
STRIPE_SECRET_KEY=omnipost-stripe-secret-key:latest,\
STRIPE_WEBHOOK_SECRET=omnipost-stripe-webhook-secret:latest,\
RESEND_API_KEY=omnipost-resend-api-key:latest,\
RESEND_FROM_ADDRESS=notifications@yourdomain.com,\
OPENAI_API_KEY=omnipost-openai-api-key:latest,\
GEMINI_API_KEY=omnipost-gemini-api-key:latest,\
PERPLEXITY_API_KEY=omnipost-perplexity-api-key:latest"
```

Deploy workers as a separate Cloud Run service:

```bash
gcloud run deploy omnipost-workers \
  --image=$IMAGE \
  --region=$REGION \
  --platform=managed \
  --service-account=$SA_EMAIL \
  --vpc-connector=omnipost-connector \
  --vpc-egress=private-ranges-only \
  --min-instances=1 \
  --max-instances=5 \
  --memory=2Gi \
  --cpu=2 \
  --no-allow-unauthenticated \
  --command="node","dist/workers/index.js" \
  --set-env-vars="NODE_ENV=production,LOG_LEVEL=info" \
  --set-secrets="DATABASE_URL=omnipost-database-url:latest,REDIS_URL=omnipost-redis-url:latest"
```

---

## Step 10: Run Database Migrations

Use Cloud Run Jobs for one-off tasks:

```bash
gcloud run jobs create omnipost-migrate \
  --image=$IMAGE \
  --region=$REGION \
  --service-account=$SA_EMAIL \
  --vpc-connector=omnipost-connector \
  --vpc-egress=private-ranges-only \
  --memory=1Gi \
  --command="pnpm","db:migrate" \
  --set-secrets="DATABASE_URL=omnipost-database-url:latest"

# Execute the migration job
gcloud run jobs execute omnipost-migrate \
  --region=$REGION \
  --wait
```

---

## Step 11: Set Up Cloud CDN

```bash
# Create a backend bucket for Cloud CDN
gcloud compute backend-buckets create omnipost-media-backend \
  --gcs-bucket-name=${PROJECT_ID}-omnipost-media \
  --enable-cdn \
  --cache-mode=CACHE_ALL_STATIC

# Create URL map
gcloud compute url-maps create omnipost-media-lb \
  --default-backend-bucket=omnipost-media-backend

# Create HTTPS proxy (requires SSL certificate)
gcloud compute ssl-certificates create omnipost-media-cert \
  --domains=media.yourdomain.com \
  --global

gcloud compute target-https-proxies create omnipost-media-proxy \
  --url-map=omnipost-media-lb \
  --ssl-certificates=omnipost-media-cert

# Create forwarding rule
gcloud compute forwarding-rules create omnipost-media-rule \
  --global \
  --target-https-proxy=omnipost-media-proxy \
  --ports=443
```

---

## Post-Deployment Verification

```bash
# Get Cloud Run URL
gcloud run services describe omnipost-api \
  --region=$REGION \
  --format='value(status.url)'

# Health check
curl $(gcloud run services describe omnipost-api \
  --region=$REGION --format='value(status.url)')/health

# Check Cloud SQL status
gcloud sql instances describe omnipost-postgres \
  --format='value(state)'

# Check Memorystore status
gcloud redis instances describe omnipost-redis \
  --region=$REGION \
  --format='value(state)'

# View logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=omnipost-api" \
  --limit=50 \
  --format="table(timestamp,textPayload)"
```

---

## Custom Domain Mapping

```bash
# Map custom domain to Cloud Run
gcloud run domain-mappings create \
  --service=omnipost-api \
  --domain=api.yourdomain.com \
  --region=$REGION

# Get DNS records to configure
gcloud run domain-mappings describe \
  --domain=api.yourdomain.com \
  --region=$REGION
```

---

## Scaling Configuration

Cloud Run auto-scales based on request concurrency. Adjust limits:

```bash
gcloud run services update omnipost-api \
  --region=$REGION \
  --min-instances=2 \
  --max-instances=20 \
  --concurrency=80 \
  --cpu-throttling
```

For Cloud SQL, scale vertically:

```bash
gcloud sql instances patch omnipost-postgres \
  --tier=db-custom-4-8192
```

---

## Backup and Disaster Recovery

```bash
# Cloud SQL: automated backups are enabled (7-day retention)
# Create manual backup before migrations:
gcloud sql backups create \
  --instance=omnipost-postgres \
  --description="Pre-migration backup $(date +%Y%m%d)"

# List backups
gcloud sql backups list --instance=omnipost-postgres

# Cloud Storage: versioning is enabled
# Enable cross-region replication:
gcloud storage buckets update gs://${PROJECT_ID}-omnipost-media \
  --default-storage-class=STANDARD \
  --placement=us-central1,us-east1

# Export Cloud SQL for disaster recovery
gcloud sql export sql omnipost-postgres \
  gs://${PROJECT_ID}-omnipost-backups/export-$(date +%Y%m%d).sql \
  --database=omnipostdb
```
