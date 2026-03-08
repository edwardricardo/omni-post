# Production Environment Configuration
# This file contains configuration values specific to the production environment

# General Configuration
project_name = "omni-post"
environment  = "production"
aws_region   = "us-west-2"
owner_email  = "ops-team@omni-post.com"
cost_center  = "production"

# Networking Configuration
vpc_cidr                 = "10.0.0.0/16"
private_subnet_cidrs    = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
public_subnet_cidrs     = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
database_subnet_cidrs   = ["10.0.201.0/24", "10.0.202.0/24", "10.0.203.0/24"]
enable_nat_gateway      = true
enable_vpn_gateway      = false

# Database Configuration (Production-grade)
db_instance_class        = "db.r6g.large"
db_allocated_storage     = 500
db_max_allocated_storage = 5000
db_name                  = "omnipostdb"
db_username              = "postgres"
db_multi_az             = true
db_backup_retention_period = 30
db_backup_window        = "03:00-04:00"
db_maintenance_window   = "sun:04:00-sun:05:00"
db_monitoring_interval  = 60
db_performance_insights_enabled = true

# Redis Configuration (Production-grade)
redis_node_type                   = "cache.r6g.large"
redis_num_cache_clusters         = 3
redis_parameter_group_name       = "default.redis7"
redis_engine_version             = "7.0"
redis_port                       = 6379
redis_multi_az_enabled           = true
redis_automatic_failover_enabled = true
redis_snapshot_retention_limit   = 7
redis_snapshot_window           = "03:00-05:00"

# EKS Configuration (Production-grade)
eks_cluster_version                        = "1.28"
eks_cluster_endpoint_private_access        = true
eks_cluster_endpoint_public_access         = true
eks_cluster_endpoint_public_access_cidrs   = ["0.0.0.0/0"]  # Restrict this in production

eks_node_groups = {
  general = {
    instance_types      = ["m5.large", "m5.xlarge"]
    capacity_type       = "ON_DEMAND"
    min_size           = 3
    max_size           = 20
    desired_size       = 6
    disk_size          = 100
    ami_type           = "AL2_x86_64"
    kubernetes_labels  = {
      role = "general"
      environment = "production"
    }
    kubernetes_taints = []
  }
  spot = {
    instance_types      = ["m5.large", "m5.xlarge", "m5.2xlarge"]
    capacity_type       = "SPOT"
    min_size           = 0
    max_size           = 50
    desired_size       = 3
    disk_size          = 100
    ami_type           = "AL2_x86_64"
    kubernetes_labels  = {
      role = "spot"
      environment = "production"
    }
    kubernetes_taints = [
      {
        key    = "spot-instance"
        value  = "true"
        effect = "NO_SCHEDULE"
      }
    ]
  }
  compute = {
    instance_types      = ["c5.xlarge", "c5.2xlarge"]
    capacity_type       = "ON_DEMAND"
    min_size           = 0
    max_size           = 10
    desired_size       = 0
    disk_size          = 50
    ami_type           = "AL2_x86_64"
    kubernetes_labels  = {
      role = "compute-intensive"
      environment = "production"
    }
    kubernetes_taints = [
      {
        key    = "compute-intensive"
        value  = "true"
        effect = "NO_SCHEDULE"
      }
    ]
  }
}

eks_cluster_addons = {
  coredns = {
    version = "v1.10.1-eksbuild.5"
  }
  kube-proxy = {
    version = "v1.28.2-eksbuild.2"
  }
  vpc-cni = {
    version = "v1.15.1-eksbuild.1"
  }
  aws-ebs-csi-driver = {
    version = "v1.24.0-eksbuild.1"
  }
}

# Storage Configuration
create_media_bucket        = true
create_backup_bucket       = true
create_logs_bucket         = true
enable_lifecycle_policy    = true
enable_s3_replication     = true
s3_replication_region     = "us-east-1"

# CloudFront Configuration
cloudfront_ssl_support_method      = "sni-only"
cloudfront_minimum_protocol_version = "TLSv1.2_2021"
cloudfront_default_ttl             = 3600
cloudfront_max_ttl                 = 86400
cloudfront_min_ttl                 = 0

# Security Configuration
enable_waf = true

# Monitoring Configuration (Full observability stack)
create_cloudwatch_log_groups = true
log_retention_in_days        = 90
enable_prometheus           = true
enable_grafana             = true
enable_elasticsearch       = true
elasticsearch_instance_type = "m6g.large.elasticsearch"
enable_jaeger              = true
enable_alertmanager        = true
slack_webhook_url          = ""  # Set via environment variable
pagerduty_key             = ""   # Set via environment variable
notification_email        = "alerts@omni-post.com"

# Backup Configuration (Comprehensive)
backup_schedule             = "cron(0 2 * * ? *)"  # Daily at 2 AM UTC
backup_retention_period     = 90
backup_cold_storage_after   = 30
backup_delete_after        = 2555  # 7 years
backup_destination_region   = "us-east-1"

# Cost Management
monthly_budget_limit = 5000
budget_alert_emails = [
  "finance@omni-post.com",
  "ops-team@omni-post.com"
]
enable_spot_instances = true

# Application Secrets (Production - use AWS Secrets Manager or environment variables)
jwt_secret = ""  # Set via AWS Secrets Manager
social_provider_keys = {
  # These should be set via AWS Secrets Manager in production
  twitter = {
    client_id     = ""
    client_secret = ""
  }
  instagram = {
    client_id     = ""
    client_secret = ""
  }
  facebook = {
    client_id     = ""
    client_secret = ""
  }
  linkedin = {
    client_id     = ""
    client_secret = ""
  }
}