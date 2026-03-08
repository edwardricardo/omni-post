# Development Environment Configuration
# This file contains configuration values specific to the development environment

# General Configuration
project_name = "omni-post"
environment  = "dev"
aws_region   = "us-west-2"
owner_email  = "dev-team@omni-post.com"
cost_center  = "development"

# Networking Configuration
vpc_cidr                 = "10.0.0.0/16"
private_subnet_cidrs    = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
public_subnet_cidrs     = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
database_subnet_cidrs   = ["10.0.201.0/24", "10.0.202.0/24", "10.0.203.0/24"]
enable_nat_gateway      = true
enable_vpn_gateway      = false

# Database Configuration (Smaller instances for dev)
db_instance_class        = "db.t3.micro"
db_allocated_storage     = 20
db_max_allocated_storage = 100
db_name                  = "omnipostdb_dev"
db_username              = "postgres"
db_multi_az             = false
db_backup_retention_period = 1
db_backup_window        = "03:00-04:00"
db_maintenance_window   = "sun:04:00-sun:05:00"
db_monitoring_interval  = 0  # Disable enhanced monitoring for dev
db_performance_insights_enabled = false

# Redis Configuration (Smaller instances for dev)
redis_node_type                   = "cache.t3.micro"
redis_num_cache_clusters         = 1
redis_parameter_group_name       = "default.redis7"
redis_engine_version             = "7.0"
redis_port                       = 6379
redis_multi_az_enabled           = false
redis_automatic_failover_enabled = false
redis_snapshot_retention_limit   = 1
redis_snapshot_window           = "03:00-05:00"

# EKS Configuration (Minimal setup for dev)
eks_cluster_version                        = "1.28"
eks_cluster_endpoint_private_access        = true
eks_cluster_endpoint_public_access         = true
eks_cluster_endpoint_public_access_cidrs   = ["0.0.0.0/0"]

eks_node_groups = {
  general = {
    instance_types      = ["t3.small"]
    capacity_type       = "ON_DEMAND"
    min_size           = 1
    max_size           = 3
    desired_size       = 1
    disk_size          = 30
    ami_type           = "AL2_x86_64"
    kubernetes_labels  = {
      role = "general"
      environment = "dev"
    }
    kubernetes_taints = []
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
}

# Storage Configuration
create_media_bucket        = true
create_backup_bucket       = true
create_logs_bucket         = true
enable_lifecycle_policy    = true
enable_s3_replication     = false
s3_replication_region     = "us-east-1"

# CloudFront Configuration
cloudfront_ssl_support_method      = "sni-only"
cloudfront_minimum_protocol_version = "TLSv1.2_2021"
cloudfront_default_ttl             = 3600
cloudfront_max_ttl                 = 86400
cloudfront_min_ttl                 = 0

# Security Configuration
enable_waf = false  # Disable WAF for dev to save costs

# Monitoring Configuration (Minimal for dev)
create_cloudwatch_log_groups = true
log_retention_in_days        = 7
enable_prometheus           = false
enable_grafana             = false
enable_elasticsearch       = false
elasticsearch_instance_type = "t3.small.elasticsearch"
enable_jaeger              = false
enable_alertmanager        = false
slack_webhook_url          = ""
pagerduty_key             = ""
notification_email        = "dev-alerts@omni-post.com"

# Backup Configuration (Minimal for dev)
backup_schedule             = "cron(0 6 ? * SUN *)"  # Weekly on Sunday
backup_retention_period     = 7
backup_cold_storage_after   = 7
backup_delete_after        = 30
backup_destination_region   = "us-east-1"

# Cost Management (Lower limits for dev)
monthly_budget_limit = 200
budget_alert_emails = ["dev-team@omni-post.com"]
enable_spot_instances = true

# Application Secrets (Development values)
jwt_secret = "dev-jwt-secret-key-change-in-production"
social_provider_keys = {
  twitter = {
    client_id     = "dev-twitter-client-id"
    client_secret = "dev-twitter-client-secret"
  }
  instagram = {
    client_id     = "dev-instagram-client-id"
    client_secret = "dev-instagram-client-secret"
  }
}