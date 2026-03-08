# Outputs for OmniPost Infrastructure
# These outputs provide important information for connecting applications and CI/CD pipelines

# VPC and Networking Outputs
output "vpc_id" {
  description = "ID of the VPC"
  value       = module.vpc.vpc_id
}

output "vpc_cidr_block" {
  description = "CIDR block of the VPC"
  value       = module.vpc.vpc_cidr_block
}

output "private_subnet_ids" {
  description = "IDs of the private subnets"
  value       = module.vpc.private_subnet_ids
}

output "public_subnet_ids" {
  description = "IDs of the public subnets"
  value       = module.vpc.public_subnet_ids
}

output "database_subnet_ids" {
  description = "IDs of the database subnets"
  value       = module.vpc.database_subnet_ids
}

output "nat_gateway_ids" {
  description = "IDs of the NAT Gateways"
  value       = module.vpc.nat_gateway_ids
}

# Database Outputs
output "database_endpoint" {
  description = "RDS instance endpoint"
  value       = module.database.db_endpoint
}

output "database_port" {
  description = "RDS instance port"
  value       = module.database.db_port
}

output "database_name" {
  description = "Database name"
  value       = module.database.db_name
}

output "database_username" {
  description = "Database username"
  value       = module.database.db_username
  sensitive   = true
}

output "database_password_secret_arn" {
  description = "ARN of the database password secret in AWS Secrets Manager"
  value       = module.secrets.database_password_secret_arn
}

output "database_connection_string_secret_arn" {
  description = "ARN of the database connection string secret"
  value       = module.secrets.database_connection_secret_arn
}

# Redis Outputs
output "redis_endpoint" {
  description = "Redis cluster endpoint"
  value       = module.redis.redis_endpoint
}

output "redis_port" {
  description = "Redis cluster port"
  value       = module.redis.redis_port
}

output "redis_auth_token_secret_arn" {
  description = "ARN of the Redis auth token secret"
  value       = module.secrets.redis_auth_token_secret_arn
}

# EKS Cluster Outputs
output "cluster_id" {
  description = "EKS cluster ID"
  value       = module.eks.cluster_name
}

output "cluster_arn" {
  description = "EKS cluster ARN"
  value       = module.eks.cluster_arn
}

output "cluster_endpoint" {
  description = "EKS cluster endpoint"
  value       = module.eks.cluster_endpoint
}

output "cluster_security_group_id" {
  description = "Security group ID attached to the EKS cluster"
  value       = module.eks.cluster_security_group_id
}

output "cluster_certificate_authority_data" {
  description = "Base64 encoded certificate data required to communicate with the cluster"
  value       = module.eks.cluster_certificate_authority_data
}

output "cluster_version" {
  description = "EKS cluster version"
  value       = module.eks.cluster_version
}

output "node_group_arns" {
  description = "EKS node group ARNs"
  value       = module.eks.node_group_arns
}

output "oidc_provider_arn" {
  description = "ARN of the OIDC Provider for IRSA"
  value       = module.eks.oidc_provider_arn
}

# Storage Outputs
output "media_bucket_name" {
  description = "Name of the S3 media bucket"
  value       = module.storage.media_bucket_name
}

output "media_bucket_arn" {
  description = "ARN of the S3 media bucket"
  value       = module.storage.media_bucket_arn
}

output "backup_bucket_name" {
  description = "Name of the S3 backup bucket"
  value       = module.storage.backup_bucket_name
}

output "backup_bucket_arn" {
  description = "ARN of the S3 backup bucket"
  value       = module.storage.backup_bucket_arn
}

output "logs_bucket_name" {
  description = "Name of the S3 logs bucket"
  value       = module.storage.logs_bucket_name
}

# CDN Outputs
output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = module.cdn.distribution_id
}

output "cloudfront_distribution_domain_name" {
  description = "CloudFront distribution domain name"
  value       = module.cdn.distribution_domain_name
}

output "cloudfront_distribution_arn" {
  description = "CloudFront distribution ARN"
  value       = module.cdn.distribution_arn
}

# Load Balancer Outputs
output "alb_arn" {
  description = "Application Load Balancer ARN"
  value       = module.load_balancer.alb_arn
}

output "alb_dns_name" {
  description = "Application Load Balancer DNS name"
  value       = module.load_balancer.alb_dns_name
}

output "alb_zone_id" {
  description = "Application Load Balancer hosted zone ID"
  value       = module.load_balancer.alb_zone_id
}

output "target_group_arns" {
  description = "Target group ARNs"
  value       = module.load_balancer.target_group_arns
}

# Security Outputs
output "eks_cluster_iam_role_arn" {
  description = "IAM role ARN of the EKS cluster"
  value       = module.security.eks_cluster_role_arn
}

output "eks_node_group_iam_role_arn" {
  description = "IAM role ARN of the EKS node group"
  value       = module.security.eks_node_group_role_arn
}

output "acm_certificate_arn" {
  description = "ACM certificate ARN"
  value       = module.security.acm_certificate_arn
}

output "waf_web_acl_id" {
  description = "WAF Web ACL ID"
  value       = module.security.waf_web_acl_id
}

# KMS Key Outputs
output "database_kms_key_id" {
  description = "KMS key ID for database encryption"
  value       = module.security.database_kms_key_id
}

output "s3_kms_key_id" {
  description = "KMS key ID for S3 encryption"
  value       = module.security.s3_kms_key_id
}

output "secrets_kms_key_id" {
  description = "KMS key ID for secrets encryption"
  value       = module.security.secrets_kms_key_id
}

# Monitoring Outputs
output "cloudwatch_log_group_names" {
  description = "CloudWatch log group names"
  value       = module.monitoring.cloudwatch_log_group_names
}

output "prometheus_endpoint" {
  description = "Prometheus endpoint"
  value       = module.monitoring.prometheus_endpoint
  sensitive   = true
}

output "grafana_endpoint" {
  description = "Grafana endpoint"
  value       = module.monitoring.grafana_endpoint
  sensitive   = true
}

output "elasticsearch_endpoint" {
  description = "Elasticsearch domain endpoint"
  value       = module.monitoring.elasticsearch_endpoint
  sensitive   = true
}

# Secrets Manager Outputs
output "application_secrets_arn" {
  description = "ARN of the application secrets"
  value       = module.secrets.application_secrets_arn
}

output "social_provider_secrets_arn" {
  description = "ARN of the social provider secrets"
  value       = module.secrets.social_provider_secrets_arn
}

# Backup Outputs
output "backup_vault_arn" {
  description = "AWS Backup vault ARN"
  value       = module.backup.backup_vault_arn
}

output "backup_plan_arn" {
  description = "AWS Backup plan ARN"
  value       = module.backup.backup_plan_arn
}

# Cost Management Outputs
output "budget_arn" {
  description = "AWS Budget ARN"
  value       = module.cost_optimization.budget_arn
}

# Additional Infrastructure Information
output "availability_zones" {
  description = "List of availability zones used"
  value       = local.azs
}

output "region" {
  description = "AWS region"
  value       = var.aws_region
}

output "environment" {
  description = "Environment name"
  value       = var.environment
}

output "project_name" {
  description = "Project name"
  value       = var.project_name
}

# Kubernetes Configuration Output (for CI/CD)
output "kubeconfig" {
  description = "kubectl configuration for accessing the EKS cluster"
  value = {
    cluster_name                     = module.eks.cluster_name
    cluster_endpoint                = module.eks.cluster_endpoint
    cluster_certificate_authority   = module.eks.cluster_certificate_authority_data
    region                          = var.aws_region
  }
  sensitive = true
}

# Connection strings for applications
output "connection_strings" {
  description = "Connection strings for applications (stored in Secrets Manager)"
  value = {
    database_secret_arn = module.secrets.database_connection_secret_arn
    redis_secret_arn   = module.secrets.redis_connection_secret_arn
  }
  sensitive = true
}