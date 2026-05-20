# AWS Deployment Guide

Production-grade deployment of OmniPost on Amazon Web Services.

---

## Architecture

```
                        +------------------+
                        |   Route 53       |
                        |   DNS            |
                        +--------+---------+
                                 |
                        +--------+---------+
                        |   CloudFront     |
                        |   CDN            |
                        +--------+---------+
                                 |
                   +-------------+-------------+
                   |                           |
          +--------+---------+        +--------+---------+
          |   ALB            |        |   S3             |
          |   Load Balancer  |        |   Media Storage  |
          +--------+---------+        +------------------+
                   |
          +--------+---------+
          |   ECS Fargate    |
          |   +-----------+  |
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
  |   RDS          |         |   ElastiCache   |
  |   PostgreSQL   |         |   Redis 7       |
  |   16 Multi-AZ  |         |   Multi-AZ      |
  +----------------+         +-----------------+
```

---

## Estimated Monthly Costs

| Service                      | Instance / Config          | Est. Cost    |
| ---------------------------- | -------------------------- | ------------ |
| ECS Fargate (API + Workers)  | 2 tasks, 1 vCPU / 2 GB     | $60-80       |
| ECS Fargate (Admin + Client) | 2 tasks, 0.5 vCPU / 1 GB   | $30-40       |
| RDS PostgreSQL 16            | db.t4g.medium, Multi-AZ    | $130-160     |
| ElastiCache Redis 7          | cache.t4g.small, 2 nodes   | $50-70       |
| S3 + CloudFront              | 50 GB storage, 100 GB xfer | $10-20       |
| ALB                          | Application Load Balancer  | $20-25       |
| Route 53                     | Hosted zone + queries      | $2-5         |
| CloudWatch                   | Logs + metrics             | $15-25       |
| NAT Gateway                  | Single AZ                  | $35-45       |
| **Total estimate**           |                            | **$350-470** |

For a smaller staging environment, use single-AZ RDS and single Redis node: ~$180-250/month.

---

## Prerequisites

- AWS account with admin or PowerUser access
- AWS CLI v2 installed and configured: `aws configure`
- Docker installed locally (for building images)
- Domain name configured in Route 53 (optional but recommended)

---

## Step 1: Create VPC and Networking

```bash
# Create VPC with public and private subnets across 2 AZs
aws ec2 create-vpc \
  --cidr-block 10.0.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=omnipost-vpc}]'

# Note the VPC ID from output
export VPC_ID=vpc-xxxxxxxxxxxx

# Create subnets
aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.1.0/24 \
  --availability-zone us-east-1a \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=omnipost-public-1a}]'

aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.2.0/24 \
  --availability-zone us-east-1b \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=omnipost-public-1b}]'

aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.3.0/24 \
  --availability-zone us-east-1a \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=omnipost-private-1a}]'

aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.4.0/24 \
  --availability-zone us-east-1b \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=omnipost-private-1b}]'

# Create Internet Gateway
aws ec2 create-internet-gateway \
  --tag-specifications 'ResourceType=internet-gateway,Tags=[{Key=Name,Value=omnipost-igw}]'

export IGW_ID=igw-xxxxxxxxxxxx
aws ec2 attach-internet-gateway --internet-gateway-id $IGW_ID --vpc-id $VPC_ID

# Create NAT Gateway (requires Elastic IP)
aws ec2 allocate-address --domain vpc
export EIP_ALLOC=eipalloc-xxxxxxxxxxxx

aws ec2 create-nat-gateway \
  --subnet-id <public-subnet-1a-id> \
  --allocation-id $EIP_ALLOC \
  --tag-specifications 'ResourceType=natgateway,Tags=[{Key=Name,Value=omnipost-nat}]'
```

Configure route tables so private subnets route through the NAT gateway and public subnets route through the Internet gateway.

---

## Step 2: Create RDS PostgreSQL

```bash
# Create DB subnet group
aws rds create-db-subnet-group \
  --db-subnet-group-name omnipost-db-subnets \
  --db-subnet-group-description "OmniPost DB subnets" \
  --subnet-ids <private-subnet-1a-id> <private-subnet-1b-id>

# Create security group for RDS
aws ec2 create-security-group \
  --group-name omnipost-rds-sg \
  --description "OmniPost RDS security group" \
  --vpc-id $VPC_ID

export RDS_SG=sg-xxxxxxxxxxxx

# Allow PostgreSQL from private subnets only
aws ec2 authorize-security-group-ingress \
  --group-id $RDS_SG \
  --protocol tcp --port 5432 \
  --cidr 10.0.3.0/24

aws ec2 authorize-security-group-ingress \
  --group-id $RDS_SG \
  --protocol tcp --port 5432 \
  --cidr 10.0.4.0/24

# Create RDS instance
aws rds create-db-instance \
  --db-instance-identifier omnipost-postgres \
  --db-instance-class db.t4g.medium \
  --engine postgres \
  --engine-version 16.4 \
  --master-username omnipost_admin \
  --master-user-password '<STRONG_PASSWORD_HERE>' \
  --allocated-storage 50 \
  --max-allocated-storage 200 \
  --storage-type gp3 \
  --storage-encrypted \
  --multi-az \
  --db-name omnipostdb \
  --vpc-security-group-ids $RDS_SG \
  --db-subnet-group-name omnipost-db-subnets \
  --backup-retention-period 7 \
  --preferred-backup-window "03:00-04:00" \
  --preferred-maintenance-window "sun:04:00-sun:05:00" \
  --enable-performance-insights \
  --performance-insights-retention-period 7 \
  --enable-cloudwatch-logs-exports postgresql \
  --deletion-protection \
  --tags Key=Project,Value=omnipost Key=Environment,Value=production
```

Wait for the instance to become available:

```bash
aws rds wait db-instance-available --db-instance-identifier omnipost-postgres
aws rds describe-db-instances --db-instance-identifier omnipost-postgres \
  --query 'DBInstances[0].Endpoint.Address' --output text
```

Save the endpoint address for `DATABASE_URL`.

---

## Step 3: Create ElastiCache Redis

```bash
# Create cache subnet group
aws elasticache create-cache-subnet-group \
  --cache-subnet-group-name omnipost-redis-subnets \
  --cache-subnet-group-description "OmniPost Redis subnets" \
  --subnet-ids <private-subnet-1a-id> <private-subnet-1b-id>

# Create security group for Redis
aws ec2 create-security-group \
  --group-name omnipost-redis-sg \
  --description "OmniPost Redis security group" \
  --vpc-id $VPC_ID

export REDIS_SG=sg-xxxxxxxxxxxx

aws ec2 authorize-security-group-ingress \
  --group-id $REDIS_SG \
  --protocol tcp --port 6379 \
  --cidr 10.0.3.0/24

aws ec2 authorize-security-group-ingress \
  --group-id $REDIS_SG \
  --protocol tcp --port 6379 \
  --cidr 10.0.4.0/24

# Create Redis replication group (Multi-AZ)
aws elasticache create-replication-group \
  --replication-group-id omnipost-redis \
  --replication-group-description "OmniPost Redis cluster" \
  --engine redis \
  --engine-version 7.1 \
  --cache-node-type cache.t4g.small \
  --num-cache-clusters 2 \
  --automatic-failover-enabled \
  --multi-az-enabled \
  --cache-subnet-group-name omnipost-redis-subnets \
  --security-group-ids $REDIS_SG \
  --at-rest-encryption-enabled \
  --transit-encryption-enabled \
  --snapshot-retention-limit 5 \
  --snapshot-window "03:00-05:00" \
  --tags Key=Project,Value=omnipost Key=Environment,Value=production
```

Get the Redis endpoint:

```bash
aws elasticache describe-replication-groups \
  --replication-group-id omnipost-redis \
  --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint' --output json
```

---

## Step 4: Create S3 Bucket and CloudFront

```bash
# Create S3 bucket for media
aws s3api create-bucket \
  --bucket omnipost-media-production \
  --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket omnipost-media-production \
  --versioning-configuration Status=Enabled

# Enable server-side encryption
aws s3api put-bucket-encryption \
  --bucket omnipost-media-production \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'

# Block public access
aws s3api put-public-access-block \
  --bucket omnipost-media-production \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Add lifecycle rules
aws s3api put-bucket-lifecycle-configuration \
  --bucket omnipost-media-production \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "media-lifecycle",
      "Status": "Enabled",
      "Transitions": [
        {"Days": 90, "StorageClass": "STANDARD_IA"},
        {"Days": 365, "StorageClass": "GLACIER"}
      ],
      "Filter": {"Prefix": ""}
    }]
  }'

# Create CloudFront OAI
aws cloudfront create-cloud-front-origin-access-identity \
  --cloud-front-origin-access-identity-config \
    CallerReference=$(date +%s),Comment="OmniPost media"

# Create CloudFront distribution
aws cloudfront create-distribution \
  --distribution-config '{
    "CallerReference": "omnipost-media-'$(date +%s)'",
    "Comment": "OmniPost media CDN",
    "DefaultCacheBehavior": {
      "TargetOriginId": "S3-omnipost-media",
      "ViewerProtocolPolicy": "redirect-to-https",
      "AllowedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]},
      "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]},
      "Compress": true,
      "DefaultTTL": 86400,
      "ForwardedValues": {
        "QueryString": false,
        "Cookies": {"Forward": "none"}
      }
    },
    "Origins": {
      "Quantity": 1,
      "Items": [{
        "Id": "S3-omnipost-media",
        "DomainName": "omnipost-media-production.s3.amazonaws.com",
        "S3OriginConfig": {"OriginAccessIdentity": ""}
      }]
    },
    "Enabled": true
  }'
```

---

## Step 5: Create IAM User for Application

```bash
# Create IAM user for S3 access
aws iam create-user --user-name omnipost-app

# Create access key
aws iam create-access-key --user-name omnipost-app

# Attach S3 policy
aws iam put-user-policy \
  --user-name omnipost-app \
  --policy-name omnipost-s3-access \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::omnipost-media-production",
        "arn:aws:s3:::omnipost-media-production/*"
      ]
    }]
  }'
```

Save the AccessKeyId and SecretAccessKey for `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.

---

## Step 6: Deploy with ECS Fargate

### Build and push Docker image

```bash
# Create ECR repository
aws ecr create-repository --repository-name omnipost

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build and push
docker build -t omnipost .
docker tag omnipost:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/omnipost:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/omnipost:latest
```

### Create ECS cluster and services

```bash
# Create cluster
aws ecs create-cluster --cluster-name omnipost-production

# Create task execution role (for pulling images and writing logs)
# Create task role (for S3 access from within containers)
# Register task definitions for: api, workers, admin, client
# Create services with desired count, ALB target groups, and auto-scaling
```

Refer to the ECS task definition for environment variables in Step 7.

---

## Step 7: Environment Variables

Set these in ECS task definitions, SSM Parameter Store, or Secrets Manager:

```env
# ---- Core ----
NODE_ENV=production
PORT=3000
API_BASE_URL=https://api.yourdomain.com
CLIENT_URL=https://app.yourdomain.com
ADMIN_URL=https://admin.yourdomain.com
APP_BASE_URL=https://api.yourdomain.com

# ---- Database ----
DATABASE_URL=postgresql://omnipost_admin:<PASSWORD>@omnipost-postgres.xxxx.us-east-1.rds.amazonaws.com:5432/omnipostdb?sslmode=require

# ---- Redis ----
REDIS_URL=rediss://omnipost-redis.xxxx.cache.amazonaws.com:6379

# ---- Auth (use strong secrets, store in Secrets Manager) ----
JWT_SECRET=<generate: openssl rand -hex 64>
JWT_REFRESH_SECRET=<generate: openssl rand -hex 64>
ADMIN_JWT_ACCESS_SECRET=<generate: openssl rand -hex 64>
ADMIN_JWT_REFRESH_SECRET=<generate: openssl rand -hex 64>
CUSTOMER_JWT_SECRET=<generate: openssl rand -hex 64>
OAUTH_ENCRYPTION_KEY=<generate: openssl rand -hex 32>

# ---- Storage (S3) ----
STORAGE_PROVIDER=s3
S3_BUCKET=omnipost-media-production
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=<from IAM user>
S3_SECRET_ACCESS_KEY=<from IAM user>

# ---- Email ----
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM_ADDRESS=notifications@yourdomain.com

# ---- AI ----
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
TRACING_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-otel-collector:4318
OTEL_SERVICE_NAME=omnipost-api
LOG_LEVEL=info
```

### Store secrets securely

```bash
# Store in AWS Secrets Manager
aws secretsmanager create-secret \
  --name omnipost/production/database-url \
  --secret-string "postgresql://omnipost_admin:<PASSWORD>@<RDS_ENDPOINT>:5432/omnipostdb?sslmode=require"

aws secretsmanager create-secret \
  --name omnipost/production/jwt-secret \
  --secret-string "$(openssl rand -hex 64)"
```

Reference secrets in ECS task definitions using `valueFrom` with the secret ARN.

---

## Step 8: Run Database Migrations

From within the VPC (use a bastion host or ECS exec):

```bash
# Option 1: ECS Exec into a running task
aws ecs execute-command \
  --cluster omnipost-production \
  --task <task-id> \
  --container api \
  --interactive \
  --command "pnpm db:migrate"

# Option 2: Run a one-off migration task
aws ecs run-task \
  --cluster omnipost-production \
  --task-definition omnipost-migration \
  --network-configuration '{
    "awsvpcConfiguration": {
      "subnets": ["<private-subnet-id>"],
      "securityGroups": ["<app-sg-id>"]
    }
  }' \
  --overrides '{"containerOverrides":[{"name":"api","command":["pnpm","db:migrate"]}]}'
```

---

## Post-Deployment Verification

```bash
# Health check
curl https://api.yourdomain.com/health

# Check ECS service status
aws ecs describe-services \
  --cluster omnipost-production \
  --services omnipost-api \
  --query 'services[0].{desired:desiredCount,running:runningCount,status:status}'

# Check RDS status
aws rds describe-db-instances \
  --db-instance-identifier omnipost-postgres \
  --query 'DBInstances[0].DBInstanceStatus'

# Check Redis status
aws elasticache describe-replication-groups \
  --replication-group-id omnipost-redis \
  --query 'ReplicationGroups[0].Status'
```

---

## Scaling

```bash
# Scale ECS service
aws ecs update-service \
  --cluster omnipost-production \
  --service omnipost-api \
  --desired-count 4

# Enable auto-scaling
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/omnipost-production/omnipost-api \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10

aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/omnipost-production/omnipost-api \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name omnipost-cpu-scaling \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleOutCooldown": 60,
    "ScaleInCooldown": 300
  }'
```

---

## Backup and Disaster Recovery

- **RDS**: Automated daily backups with 7-day retention. Point-in-time recovery enabled.
- **Redis**: Daily snapshots with 5-day retention.
- **S3**: Versioning enabled. Enable cross-region replication for DR.
- **ECS**: Multi-AZ by default with Fargate. Services auto-replace unhealthy tasks.

```bash
# Create manual RDS snapshot before major changes
aws rds create-db-snapshot \
  --db-instance-identifier omnipost-postgres \
  --db-snapshot-identifier omnipost-pre-migration-$(date +%Y%m%d)
```
