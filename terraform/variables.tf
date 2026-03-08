# Variables for OmniPost Infrastructure
# This file contains all configurable variables for the Terraform infrastructure

# General Configuration
variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "omni-post"
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be one of: dev, staging, production."
  }
}

variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-west-2"
}

variable "owner_email" {
  description = "Email of the resource owner"
  type        = string
  default     = "admin@omni-post.com"
}

variable "cost_center" {
  description = "Cost center for billing purposes"
  type        = string
  default     = "engineering"
}

# Networking Configuration
variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
  default     = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
}

variable "database_subnet_cidrs" {
  description = "CIDR blocks for database subnets"
  type        = list(string)
  default     = ["10.0.201.0/24", "10.0.202.0/24", "10.0.203.0/24"]
}

variable "enable_nat_gateway" {
  description = "Enable NAT Gateway for private subnets"
  type        = bool
  default     = true
}

variable "enable_vpn_gateway" {
  description = "Enable VPN Gateway"
  type        = bool
  default     = false
}

# Database Configuration (RDS PostgreSQL)
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.medium"
}

variable "db_allocated_storage" {
  description = "Allocated storage for RDS (GB)"
  type        = number
  default     = 100
}

variable "db_max_allocated_storage" {
  description = "Maximum allocated storage for RDS auto-scaling (GB)"
  type        = number
  default     = 1000
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "omnipostdb"
}

variable "db_username" {
  description = "Database username"
  type        = string
  default     = "postgres"
}

variable "db_multi_az" {
  description = "Enable Multi-AZ deployment for RDS"
  type        = bool
  default     = true
}

variable "db_backup_retention_period" {
  description = "Backup retention period in days"
  type        = number
  default     = 7
}

variable "db_backup_window" {
  description = "Backup window"
  type        = string
  default     = "03:00-04:00"
}

variable "db_maintenance_window" {
  description = "Maintenance window"
  type        = string
  default     = "sun:04:00-sun:05:00"
}

variable "db_monitoring_interval" {
  description = "Enhanced monitoring interval in seconds"
  type        = number
  default     = 60
}

variable "db_performance_insights_enabled" {
  description = "Enable Performance Insights"
  type        = bool
  default     = true
}

# Redis Configuration (ElastiCache)
variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t3.medium"
}

variable "redis_num_cache_clusters" {
  description = "Number of cache clusters"
  type        = number
  default     = 2
}

variable "redis_parameter_group_name" {
  description = "Parameter group name for Redis"
  type        = string
  default     = "default.redis7"
}

variable "redis_engine_version" {
  description = "Redis engine version"
  type        = string
  default     = "7.0"
}

variable "redis_port" {
  description = "Redis port"
  type        = number
  default     = 6379
}

variable "redis_multi_az_enabled" {
  description = "Enable Multi-AZ for Redis"
  type        = bool
  default     = true
}

variable "redis_automatic_failover_enabled" {
  description = "Enable automatic failover for Redis"
  type        = bool
  default     = true
}

variable "redis_snapshot_retention_limit" {
  description = "Number of snapshots to retain"
  type        = number
  default     = 5
}

variable "redis_snapshot_window" {
  description = "Snapshot window"
  type        = string
  default     = "03:00-05:00"
}

# EKS Configuration
variable "eks_cluster_version" {
  description = "EKS cluster version"
  type        = string
  default     = "1.28"
}

variable "eks_cluster_endpoint_private_access" {
  description = "Enable private API server endpoint"
  type        = bool
  default     = true
}

variable "eks_cluster_endpoint_public_access" {
  description = "Enable public API server endpoint"
  type        = bool
  default     = true
}

variable "eks_cluster_endpoint_public_access_cidrs" {
  description = "List of CIDR blocks for public API server endpoint access"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "eks_node_groups" {
  description = "EKS node group configurations"
  type = map(object({
    instance_types        = list(string)
    capacity_type        = string
    min_size            = number
    max_size            = number
    desired_size        = number
    disk_size           = number
    ami_type            = string
    kubernetes_labels   = map(string)
    kubernetes_taints   = list(object({
      key    = string
      value  = string
      effect = string
    }))
  }))
  default = {
    general = {
      instance_types      = ["t3.medium", "t3.large"]
      capacity_type      = "ON_DEMAND"
      min_size          = 1
      max_size          = 10
      desired_size      = 3
      disk_size         = 50
      ami_type          = "AL2_x86_64"
      kubernetes_labels = {
        role = "general"
      }
      kubernetes_taints = []
    }
    spot = {
      instance_types      = ["t3.medium", "t3.large", "m5.large"]
      capacity_type      = "SPOT"
      min_size          = 0
      max_size          = 20
      desired_size      = 2
      disk_size         = 50
      ami_type          = "AL2_x86_64"
      kubernetes_labels = {
        role = "spot"
      }
      kubernetes_taints = [
        {
          key    = "spot"
          value  = "true"
          effect = "NO_SCHEDULE"
        }
      ]
    }
  }
}

variable "eks_cluster_addons" {
  description = "EKS cluster add-ons"
  type = map(object({
    version = string
  }))
  default = {
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
}

# Storage Configuration (S3)
variable "create_media_bucket" {
  description = "Create S3 bucket for media files"
  type        = bool
  default     = true
}

variable "create_backup_bucket" {
  description = "Create S3 bucket for backups"
  type        = bool
  default     = true
}

variable "create_logs_bucket" {
  description = "Create S3 bucket for logs"
  type        = bool
  default     = true
}

variable "enable_lifecycle_policy" {
  description = "Enable S3 lifecycle policies"
  type        = bool
  default     = true
}

variable "enable_s3_replication" {
  description = "Enable cross-region replication for S3"
  type        = bool
  default     = false
}

variable "s3_replication_region" {
  description = "Region for S3 cross-region replication"
  type        = string
  default     = "us-east-1"
}

# CloudFront Configuration
variable "cloudfront_ssl_support_method" {
  description = "SSL support method for CloudFront"
  type        = string
  default     = "sni-only"
}

variable "cloudfront_minimum_protocol_version" {
  description = "Minimum TLS protocol version"
  type        = string
  default     = "TLSv1.2_2021"
}

variable "cloudfront_default_ttl" {
  description = "Default TTL for CloudFront"
  type        = number
  default     = 3600
}

variable "cloudfront_max_ttl" {
  description = "Maximum TTL for CloudFront"
  type        = number
  default     = 86400
}

variable "cloudfront_min_ttl" {
  description = "Minimum TTL for CloudFront"
  type        = number
  default     = 0
}

# Security Configuration
variable "enable_waf" {
  description = "Enable AWS WAF"
  type        = bool
  default     = true
}

# Monitoring Configuration
variable "create_cloudwatch_log_groups" {
  description = "Create CloudWatch log groups"
  type        = bool
  default     = true
}

variable "log_retention_in_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

variable "enable_prometheus" {
  description = "Enable Prometheus monitoring"
  type        = bool
  default     = true
}

variable "enable_grafana" {
  description = "Enable Grafana dashboards"
  type        = bool
  default     = true
}

variable "enable_elasticsearch" {
  description = "Enable Elasticsearch for logging"
  type        = bool
  default     = true
}

variable "elasticsearch_instance_type" {
  description = "Elasticsearch instance type"
  type        = string
  default     = "t3.small.elasticsearch"
}

variable "enable_jaeger" {
  description = "Enable Jaeger for distributed tracing"
  type        = bool
  default     = true
}

variable "enable_alertmanager" {
  description = "Enable Alert Manager"
  type        = bool
  default     = true
}

variable "slack_webhook_url" {
  description = "Slack webhook URL for notifications"
  type        = string
  default     = ""
  sensitive   = true
}

variable "pagerduty_key" {
  description = "PagerDuty integration key"
  type        = string
  default     = ""
  sensitive   = true
}

variable "notification_email" {
  description = "Email for notifications"
  type        = string
  default     = "alerts@omni-post.com"
}

# Application Secrets
variable "jwt_secret" {
  description = "JWT secret key"
  type        = string
  sensitive   = true
}

variable "social_provider_keys" {
  description = "Social media provider API keys"
  type = map(object({
    client_id     = string
    client_secret = string
  }))
  sensitive = true
  default   = {}
}

# Backup Configuration
variable "backup_schedule" {
  description = "Backup schedule cron expression"
  type        = string
  default     = "cron(0 2 ? * * *)"  # Daily at 2 AM UTC
}

variable "backup_retention_period" {
  description = "Backup retention period in days"
  type        = number
  default     = 30
}

variable "backup_cold_storage_after" {
  description = "Move to cold storage after days"
  type        = number
  default     = 30
}

variable "backup_delete_after" {
  description = "Delete backups after days"
  type        = number
  default     = 365
}

variable "backup_destination_region" {
  description = "Destination region for cross-region backups"
  type        = string
  default     = "us-east-1"
}

# Cost Management
variable "monthly_budget_limit" {
  description = "Monthly budget limit in USD"
  type        = number
  default     = 1000
}

variable "budget_alert_emails" {
  description = "Email addresses for budget alerts"
  type        = list(string)
  default     = ["admin@omni-post.com"]
}

variable "enable_spot_instances" {
  description = "Enable spot instances for cost optimization"
  type        = bool
  default     = true
}