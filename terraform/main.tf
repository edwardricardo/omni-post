# Main Terraform Configuration for OmniPost Infrastructure
# This configuration sets up a production-ready AWS infrastructure for the social media CMS platform

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.11"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  backend "s3" {
    # Backend configuration will be provided via backend config file
    # Run: terraform init -backend-config=backend-config.hcl
  }
}

# Configure AWS Provider
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
      Owner       = var.owner_email
      CostCenter  = var.cost_center
      CreatedAt   = formatdate("YYYY-MM-DD", timestamp())
    }
  }
}

# Data sources for existing resources
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

# Random password generation for sensitive resources
resource "random_password" "db_password" {
  length  = 32
  special = true
}

resource "random_password" "redis_password" {
  length  = 32
  special = true
}

# Local values for common resource naming
locals {
  name_prefix = "${var.project_name}-${var.environment}"

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    Region      = var.aws_region
  }

  # Availability zones for multi-AZ deployment
  azs = slice(data.aws_availability_zones.available.names, 0, 3)
}

# VPC Module - Network Foundation
module "vpc" {
  source = "./modules/vpc"

  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region

  vpc_cidr             = var.vpc_cidr
  private_subnet_cidrs = var.private_subnet_cidrs
  public_subnet_cidrs  = var.public_subnet_cidrs
  database_subnet_cidrs = var.database_subnet_cidrs

  availability_zones = local.azs
  enable_nat_gateway = var.enable_nat_gateway
  enable_vpn_gateway = var.enable_vpn_gateway

  tags = local.common_tags
}

# Security Module - IAM Roles, Policies, and Security Groups
module "security" {
  source = "./modules/security"

  project_name = var.project_name
  environment  = var.environment
  vpc_id       = module.vpc.vpc_id

  # EKS cluster security
  cluster_name = local.name_prefix

  # WAF configuration
  enable_waf = var.enable_waf

  tags = local.common_tags
}

# Database Module - RDS PostgreSQL with Multi-AZ
module "database" {
  source = "./modules/database"

  project_name = var.project_name
  environment  = var.environment

  # Network configuration
  vpc_id               = module.vpc.vpc_id
  database_subnet_ids  = module.vpc.database_subnet_ids
  allowed_cidr_blocks  = [var.vpc_cidr]

  # Database configuration
  db_instance_class    = var.db_instance_class
  db_allocated_storage = var.db_allocated_storage
  db_max_allocated_storage = var.db_max_allocated_storage
  db_name              = var.db_name
  db_username          = var.db_username
  db_password          = random_password.db_password.result

  # High availability
  multi_az                = var.db_multi_az
  backup_retention_period = var.db_backup_retention_period
  backup_window          = var.db_backup_window
  maintenance_window     = var.db_maintenance_window

  # Performance and monitoring
  monitoring_interval    = var.db_monitoring_interval
  performance_insights_enabled = var.db_performance_insights_enabled

  # Security
  storage_encrypted = true
  kms_key_id       = module.security.database_kms_key_id

  tags = local.common_tags
}

# Redis Module - ElastiCache with Clustering
module "redis" {
  source = "./modules/redis"

  project_name = var.project_name
  environment  = var.environment

  # Network configuration
  vpc_id              = module.vpc.vpc_id
  private_subnet_ids  = module.vpc.private_subnet_ids
  allowed_cidr_blocks = [var.vpc_cidr]

  # Redis configuration
  node_type           = var.redis_node_type
  num_cache_clusters  = var.redis_num_cache_clusters
  parameter_group_name = var.redis_parameter_group_name
  engine_version      = var.redis_engine_version
  port                = var.redis_port

  # High availability
  multi_az_enabled           = var.redis_multi_az_enabled
  automatic_failover_enabled = var.redis_automatic_failover_enabled

  # Security
  at_rest_encryption_enabled  = true
  transit_encryption_enabled  = true
  auth_token                  = random_password.redis_password.result
  kms_key_id                  = module.security.redis_kms_key_id

  # Backup
  snapshot_retention_limit = var.redis_snapshot_retention_limit
  snapshot_window         = var.redis_snapshot_window

  tags = local.common_tags
}

# EKS Module - Kubernetes Cluster with Node Groups
module "eks" {
  source = "./modules/eks"

  project_name = var.project_name
  environment  = var.environment

  # Network configuration
  vpc_id                     = module.vpc.vpc_id
  private_subnet_ids         = module.vpc.private_subnet_ids
  control_plane_subnet_ids   = module.vpc.private_subnet_ids

  # Cluster configuration
  cluster_name               = local.name_prefix
  cluster_version            = var.eks_cluster_version
  cluster_endpoint_private_access = var.eks_cluster_endpoint_private_access
  cluster_endpoint_public_access  = var.eks_cluster_endpoint_public_access
  cluster_endpoint_public_access_cidrs = var.eks_cluster_endpoint_public_access_cidrs

  # Node group configuration
  node_groups = var.eks_node_groups

  # OIDC provider for IAM roles for service accounts
  enable_irsa = true

  # Cluster add-ons
  cluster_addons = var.eks_cluster_addons

  # Security
  cluster_security_group_id = module.security.eks_cluster_security_group_id
  node_security_group_id    = module.security.eks_node_security_group_id

  tags = local.common_tags
}

# Storage Module - S3 Buckets for Media and Backups
module "storage" {
  source = "./modules/storage"

  project_name = var.project_name
  environment  = var.environment

  # S3 configuration
  create_media_bucket   = var.create_media_bucket
  create_backup_bucket  = var.create_backup_bucket
  create_logs_bucket    = var.create_logs_bucket

  # Security
  kms_key_id = module.security.s3_kms_key_id

  # Lifecycle policies
  enable_lifecycle_policy = var.enable_lifecycle_policy

  # Cross-region replication for production
  enable_replication = var.environment == "production" ? var.enable_s3_replication : false
  replication_region = var.s3_replication_region

  tags = local.common_tags
}

# CDN Module - CloudFront for Global Content Delivery
module "cdn" {
  source = "./modules/cdn"

  project_name = var.project_name
  environment  = var.environment

  # S3 origins
  media_bucket_domain_name = module.storage.media_bucket_domain_name
  media_bucket_id         = module.storage.media_bucket_id

  # ALB origin for API
  alb_domain_name = module.load_balancer.alb_dns_name

  # SSL/TLS configuration
  ssl_support_method     = var.cloudfront_ssl_support_method
  minimum_protocol_version = var.cloudfront_minimum_protocol_version

  # Caching configuration
  default_ttl = var.cloudfront_default_ttl
  max_ttl     = var.cloudfront_max_ttl
  min_ttl     = var.cloudfront_min_ttl

  # WAF integration
  web_acl_id = var.enable_waf ? module.security.waf_web_acl_id : null

  tags = local.common_tags
}

# Load Balancer Module - Application Load Balancer
module "load_balancer" {
  source = "./modules/load_balancer"

  project_name = var.project_name
  environment  = var.environment

  # Network configuration
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids

  # Security
  security_group_id = module.security.alb_security_group_id
  certificate_arn   = module.security.acm_certificate_arn

  # Health check configuration
  health_check_path     = "/health"
  health_check_matcher  = "200"

  tags = local.common_tags
}

# Monitoring Module - Comprehensive Observability Stack
module "monitoring" {
  source = "./modules/monitoring"

  project_name = var.project_name
  environment  = var.environment

  # EKS cluster integration
  cluster_name     = module.eks.cluster_name
  cluster_endpoint = module.eks.cluster_endpoint

  # CloudWatch configuration
  create_cloudwatch_log_groups = var.create_cloudwatch_log_groups
  log_retention_in_days        = var.log_retention_in_days

  # Prometheus and Grafana
  enable_prometheus = var.enable_prometheus
  enable_grafana    = var.enable_grafana

  # ElasticSearch for logging
  enable_elasticsearch = var.enable_elasticsearch
  elasticsearch_instance_type = var.elasticsearch_instance_type

  # Jaeger for tracing
  enable_jaeger = var.enable_jaeger

  # Alert Manager integration
  enable_alertmanager = var.enable_alertmanager
  slack_webhook_url   = var.slack_webhook_url
  pagerduty_key      = var.pagerduty_key

  # SNS for notifications
  notification_email = var.notification_email

  tags = local.common_tags
}

# Secrets Module - AWS Secrets Manager and Parameter Store
module "secrets" {
  source = "./modules/secrets"

  project_name = var.project_name
  environment  = var.environment

  # Database secrets
  db_password = random_password.db_password.result
  db_endpoint = module.database.db_endpoint
  db_port     = module.database.db_port
  db_name     = var.db_name
  db_username = var.db_username

  # Redis secrets
  redis_password        = random_password.redis_password.result
  redis_endpoint        = module.redis.redis_endpoint
  redis_port           = module.redis.redis_port

  # Application secrets
  jwt_secret           = var.jwt_secret
  social_provider_keys = var.social_provider_keys

  # Encryption
  kms_key_id = module.security.secrets_kms_key_id

  tags = local.common_tags
}

# Backup Module - Automated Backup and Disaster Recovery
module "backup" {
  source = "./modules/backup"

  project_name = var.project_name
  environment  = var.environment

  # Resources to backup
  rds_instance_arn = module.database.db_instance_arn
  s3_bucket_arns   = [
    module.storage.media_bucket_arn,
    module.storage.backup_bucket_arn
  ]

  # Backup configuration
  backup_schedule           = var.backup_schedule
  backup_retention_period   = var.backup_retention_period
  backup_cold_storage_after = var.backup_cold_storage_after
  backup_delete_after      = var.backup_delete_after

  # Cross-region backup for production
  enable_cross_region_backup = var.environment == "production"
  backup_destination_region  = var.backup_destination_region

  tags = local.common_tags
}

# Cost Optimization Module
module "cost_optimization" {
  source = "./modules/cost_optimization"

  project_name = var.project_name
  environment  = var.environment

  # Budget alerts
  monthly_budget_limit = var.monthly_budget_limit
  budget_alert_emails  = var.budget_alert_emails

  # Resource scheduling for non-production
  enable_resource_scheduling = var.environment != "production"

  # Spot instance configuration
  enable_spot_instances = var.enable_spot_instances

  tags = local.common_tags
}