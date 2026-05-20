# Azure Deployment Guide

Production deployment of OmniPost on Microsoft Azure.

---

## Architecture

```
                        +------------------+
                        |   Azure DNS      |
                        +--------+---------+
                                 |
                        +--------+---------+
                        |   Azure CDN      |
                        |   (Front Door)   |
                        +--------+---------+
                                 |
                   +-------------+-------------+
                   |                           |
          +--------+---------+        +--------+---------+
          |   App Service    |        |   Blob Storage   |
          |   Plan (Linux)   |        |   Media Files    |
          |   +-----------+  |        +------------------+
          |   | API       |  |
          |   | Workers   |  |
          |   | Admin     |  |
          |   | Client    |  |
          |   +-----------+  |
          +--------+---------+
                   |
          +--------+---------+---------+
          |                            |
  +-------+--------+         +--------+--------+
  |   Azure DB     |         |   Azure Cache   |
  |   PostgreSQL   |         |   for Redis     |
  |   Flexible 16  |         |   Premium P1    |
  +----------------+         +-----------------+
```

---

## Estimated Monthly Costs

| Service                      | Tier / Config              | Est. Cost    |
| ---------------------------- | -------------------------- | ------------ |
| App Service Plan (B2)        | Linux, 2 vCPU / 4 GB       | $55-75       |
| App Service (API slot)       | Included in plan           | $0           |
| App Service (Admin + Client) | Separate B1 plan           | $30-40       |
| Azure DB PostgreSQL Flexible | Burstable B2ms, 64 GB, HA  | $120-160     |
| Azure Cache for Redis        | Basic C1 (1 GB)            | $40-55       |
| Blob Storage                 | Hot tier, 50 GB + 100K ops | $5-10        |
| Azure CDN (Standard)         | 100 GB transfer            | $8-12        |
| Azure DNS                    | Hosted zone + queries      | $1-3         |
| Log Analytics                | 5 GB/day ingestion         | $10-15       |
| **Total estimate**           |                            | **$270-370** |

---

## Prerequisites

- Azure subscription with Contributor role
- Azure CLI installed: `az --version` (2.60+)
- Docker installed locally
- Login: `az login`

---

## Step 1: Create Resource Group

```bash
export RESOURCE_GROUP=omnipost-production
export LOCATION=eastus

az group create \
  --name $RESOURCE_GROUP \
  --location $LOCATION \
  --tags Project=omnipost Environment=production
```

---

## Step 2: Create Azure Database for PostgreSQL Flexible Server

```bash
# Create the server
az postgres flexible-server create \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-postgres \
  --location $LOCATION \
  --admin-user omnipost_admin \
  --admin-password '<STRONG_PASSWORD_HERE>' \
  --sku-name Standard_B2ms \
  --tier Burstable \
  --storage-size 64 \
  --version 16 \
  --high-availability ZoneRedundant \
  --tags Project=omnipost Environment=production

# Create the database
az postgres flexible-server db create \
  --resource-group $RESOURCE_GROUP \
  --server-name omnipost-postgres \
  --database-name omnipostdb

# Configure firewall (allow Azure services)
az postgres flexible-server firewall-rule create \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-postgres \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0

# Enable SSL enforcement
az postgres flexible-server parameter set \
  --resource-group $RESOURCE_GROUP \
  --server-name omnipost-postgres \
  --name require_secure_transport \
  --value on

# Get connection string
az postgres flexible-server show \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-postgres \
  --query fullyQualifiedDomainName --output tsv
```

The DATABASE_URL will be:
`postgresql://omnipost_admin:<PASSWORD>@omnipost-postgres.postgres.database.azure.com:5432/omnipostdb?sslmode=require`

---

## Step 3: Create Azure Cache for Redis

```bash
az redis create \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-redis \
  --location $LOCATION \
  --sku Basic \
  --vm-size C1 \
  --enable-non-ssl-port false \
  --minimum-tls-version 1.2 \
  --tags Project=omnipost Environment=production

# Wait for creation (can take 15-20 minutes)
az redis show \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-redis \
  --query provisioningState --output tsv

# Get hostname and access key
az redis show \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-redis \
  --query hostName --output tsv

az redis list-keys \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-redis \
  --query primaryKey --output tsv
```

The REDIS_URL will be:
`rediss://:<ACCESS_KEY>@omnipost-redis.redis.cache.windows.net:6380`

---

## Step 4: Create Storage Account and Blob Container

```bash
# Create storage account
az storage account create \
  --resource-group $RESOURCE_GROUP \
  --name omnipostmedia \
  --location $LOCATION \
  --sku Standard_LRS \
  --kind StorageV2 \
  --min-tls-version TLS1_2 \
  --allow-blob-public-access false \
  --tags Project=omnipost Environment=production

# Create blob container
az storage container create \
  --account-name omnipostmedia \
  --name media \
  --public-access off

# Get storage account key
az storage account keys list \
  --resource-group $RESOURCE_GROUP \
  --account-name omnipostmedia \
  --query '[0].value' --output tsv

# Get connection string
az storage account show-connection-string \
  --resource-group $RESOURCE_GROUP \
  --name omnipostmedia \
  --query connectionString --output tsv
```

---

## Step 5: Create Azure CDN Profile

```bash
# Create CDN profile
az cdn profile create \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-cdn \
  --sku Standard_Microsoft

# Create CDN endpoint pointing to blob storage
az cdn endpoint create \
  --resource-group $RESOURCE_GROUP \
  --profile-name omnipost-cdn \
  --name omnipost-media \
  --origin omnipostmedia.blob.core.windows.net \
  --origin-host-header omnipostmedia.blob.core.windows.net \
  --enable-compression true \
  --content-types-to-compress \
    "image/jpeg" "image/png" "image/webp" "image/svg+xml" \
    "application/javascript" "text/css" "application/json"
```

---

## Step 6: Create App Service Plan and Deploy

```bash
# Create App Service Plan
az appservice plan create \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-plan \
  --location $LOCATION \
  --sku B2 \
  --is-linux \
  --tags Project=omnipost Environment=production

# Create Web App (API + Workers)
az webapp create \
  --resource-group $RESOURCE_GROUP \
  --plan omnipost-plan \
  --name omnipost-api \
  --runtime "NODE:24-lts" \
  --tags Project=omnipost Component=api

# Create Web App (Admin)
az webapp create \
  --resource-group $RESOURCE_GROUP \
  --plan omnipost-plan \
  --name omnipost-admin \
  --runtime "NODE:24-lts" \
  --tags Project=omnipost Component=admin

# Create Web App (Client)
az webapp create \
  --resource-group $RESOURCE_GROUP \
  --plan omnipost-plan \
  --name omnipost-client \
  --runtime "NODE:24-lts" \
  --tags Project=omnipost Component=client

# Enable HTTPS only
az webapp update \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-api \
  --https-only true

az webapp update \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-admin \
  --https-only true

az webapp update \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-client \
  --https-only true
```

---

## Step 7: Configure Environment Variables

```bash
az webapp config appsettings set \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-api \
  --settings \
    NODE_ENV=production \
    PORT=3000 \
    API_BASE_URL=https://omnipost-api.azurewebsites.net \
    CLIENT_URL=https://omnipost-client.azurewebsites.net \
    ADMIN_URL=https://omnipost-admin.azurewebsites.net \
    APP_BASE_URL=https://omnipost-api.azurewebsites.net \
    DATABASE_URL="postgresql://omnipost_admin:<PASSWORD>@omnipost-postgres.postgres.database.azure.com:5432/omnipostdb?sslmode=require" \
    REDIS_URL="rediss://:<ACCESS_KEY>@omnipost-redis.redis.cache.windows.net:6380" \
    JWT_SECRET="$(openssl rand -hex 64)" \
    JWT_REFRESH_SECRET="$(openssl rand -hex 64)" \
    ADMIN_JWT_ACCESS_SECRET="$(openssl rand -hex 64)" \
    ADMIN_JWT_REFRESH_SECRET="$(openssl rand -hex 64)" \
    CUSTOMER_JWT_SECRET="$(openssl rand -hex 64)" \
    OAUTH_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
    STORAGE_PROVIDER=azure \
    AZURE_STORAGE_ACCOUNT_NAME=omnipostmedia \
    AZURE_STORAGE_ACCOUNT_KEY="<STORAGE_ACCOUNT_KEY>" \
    AZURE_STORAGE_CONTAINER=media \
    RESEND_API_KEY="re_xxxxxxxxxxxx" \
    RESEND_FROM_ADDRESS="notifications@yourdomain.com" \
    OPENAI_API_KEY="sk-xxxxxxxxxxxx" \
    OPENAI_MODEL=gpt-4 \
    GEMINI_API_KEY="xxxxxxxxxxxx" \
    GEMINI_MODEL=gemini-1.5-flash \
    PERPLEXITY_API_KEY="pplx-xxxxxxxxxxxx" \
    PERPLEXITY_MODEL=llama-3.1-sonar-small-128k-online \
    PAYMENT_PROVIDER=stripe \
    STRIPE_SECRET_KEY="sk_live_<YOUR_STRIPE_LIVE_KEY>" \
    STRIPE_WEBHOOK_SECRET="whsec_<YOUR_WEBHOOK_SECRET>" \
    TRACING_ENABLED=true \
    OTEL_EXPORTER_OTLP_ENDPOINT="https://your-otel-collector:4318" \
    OTEL_SERVICE_NAME=omnipost-api \
    LOG_LEVEL=info
```

For sensitive values, use Azure Key Vault references instead of plain text:

```bash
# Create Key Vault
az keyvault create \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-kv \
  --location $LOCATION

# Store secrets
az keyvault secret set \
  --vault-name omnipost-kv \
  --name database-url \
  --value "postgresql://omnipost_admin:<PASSWORD>@omnipost-postgres.postgres.database.azure.com:5432/omnipostdb?sslmode=require"

az keyvault secret set \
  --vault-name omnipost-kv \
  --name jwt-secret \
  --value "$(openssl rand -hex 64)"

# Reference in App Service (use @Microsoft.KeyVault syntax)
az webapp config appsettings set \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-api \
  --settings \
    DATABASE_URL="@Microsoft.KeyVault(VaultName=omnipost-kv;SecretName=database-url)" \
    JWT_SECRET="@Microsoft.KeyVault(VaultName=omnipost-kv;SecretName=jwt-secret)"
```

---

## Step 8: Deploy Application Code

### Option A: Deploy from Git

```bash
# Configure deployment source
az webapp deployment source config \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-api \
  --repo-url https://github.com/your-org/omni-post \
  --branch main \
  --manual-integration
```

### Option B: Deploy with Docker

```bash
# Create Azure Container Registry
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name omnipostacr \
  --sku Basic \
  --admin-enabled true

# Login and push
az acr login --name omnipostacr
docker build -t omnipostacr.azurecr.io/omnipost:latest .
docker push omnipostacr.azurecr.io/omnipost:latest

# Configure App Service to use container
az webapp config container set \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-api \
  --container-image-name omnipostacr.azurecr.io/omnipost:latest \
  --container-registry-url https://omnipostacr.azurecr.io \
  --container-registry-user omnipostacr \
  --container-registry-password "$(az acr credential show --name omnipostacr --query passwords[0].value -o tsv)"
```

### Option C: Deploy with ZIP

```bash
pnpm build
cd apps/api && zip -r ../../deploy.zip dist/ node_modules/ package.json

az webapp deploy \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-api \
  --src-path ../../deploy.zip \
  --type zip
```

---

## Step 9: Run Database Migrations

```bash
# SSH into App Service
az webapp ssh --resource-group $RESOURCE_GROUP --name omnipost-api

# Inside the SSH session:
pnpm db:migrate
```

Or run via Kudu API:

```bash
az webapp log tail \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-api

# Trigger migration via startup command
az webapp config set \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-api \
  --startup-file "pnpm db:migrate && node dist/index.js"
```

---

## Post-Deployment Verification

```bash
# Health check
curl https://omnipost-api.azurewebsites.net/health

# Check App Service status
az webapp show \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-api \
  --query state --output tsv

# Check PostgreSQL status
az postgres flexible-server show \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-postgres \
  --query state --output tsv

# Check Redis status
az redis show \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-redis \
  --query provisioningState --output tsv

# View logs
az webapp log tail \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-api
```

---

## Scaling

```bash
# Scale up (bigger instance)
az appservice plan update \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-plan \
  --sku P1v3

# Scale out (more instances)
az monitor autoscale create \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-autoscale \
  --resource omnipost-plan \
  --resource-type Microsoft.Web/serverfarms \
  --min-count 2 \
  --max-count 10 \
  --count 2

az monitor autoscale rule create \
  --resource-group $RESOURCE_GROUP \
  --autoscale-name omnipost-autoscale \
  --condition "CpuPercentage > 70 avg 5m" \
  --scale out 2

az monitor autoscale rule create \
  --resource-group $RESOURCE_GROUP \
  --autoscale-name omnipost-autoscale \
  --condition "CpuPercentage < 30 avg 10m" \
  --scale in 1
```

---

## Backup and Disaster Recovery

```bash
# Enable App Service backup
az webapp config backup create \
  --resource-group $RESOURCE_GROUP \
  --webapp-name omnipost-api \
  --backup-name "daily-backup" \
  --container-url "https://omnipostmedia.blob.core.windows.net/backups?<SAS_TOKEN>" \
  --frequency 1d \
  --retain-one true \
  --retention 30

# PostgreSQL has automatic backups with point-in-time restore (up to 35 days)
# To create an on-demand backup:
az postgres flexible-server backup create \
  --resource-group $RESOURCE_GROUP \
  --name omnipost-postgres \
  --backup-name pre-migration-$(date +%Y%m%d)
```
