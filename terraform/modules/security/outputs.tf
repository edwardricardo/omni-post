# Security Module Outputs

# IAM Role ARNs
output "eks_cluster_role_arn" {
  description = "ARN of the EKS cluster IAM role"
  value       = aws_iam_role.eks_cluster.arn
}

output "eks_node_group_role_arn" {
  description = "ARN of the EKS node group IAM role"
  value       = aws_iam_role.eks_node_group.arn
}

output "aws_load_balancer_controller_role_arn" {
  description = "ARN of the AWS Load Balancer Controller IAM role"
  value       = aws_iam_role.aws_load_balancer_controller.arn
}

# OIDC Provider
output "oidc_provider_arn" {
  description = "ARN of the EKS OIDC provider"
  value       = aws_iam_openid_connect_provider.eks.arn
}

output "oidc_provider_url" {
  description = "URL of the EKS OIDC provider"
  value       = aws_iam_openid_connect_provider.eks.url
}

# Security Group IDs
output "eks_cluster_security_group_id" {
  description = "ID of the EKS cluster security group"
  value       = aws_security_group.eks_cluster.id
}

output "eks_node_security_group_id" {
  description = "ID of the EKS node security group"
  value       = aws_security_group.eks_nodes.id
}

output "database_security_group_id" {
  description = "ID of the database security group"
  value       = aws_security_group.database.id
}

output "redis_security_group_id" {
  description = "ID of the Redis security group"
  value       = aws_security_group.redis.id
}

output "alb_security_group_id" {
  description = "ID of the ALB security group"
  value       = aws_security_group.alb.id
}

output "lambda_security_group_id" {
  description = "ID of the Lambda security group"
  value       = aws_security_group.lambda.id
}

# KMS Key IDs
output "database_kms_key_id" {
  description = "ID of the database KMS key"
  value       = aws_kms_key.database.key_id
}

output "database_kms_key_arn" {
  description = "ARN of the database KMS key"
  value       = aws_kms_key.database.arn
}

output "redis_kms_key_id" {
  description = "ID of the Redis KMS key"
  value       = aws_kms_key.redis.key_id
}

output "redis_kms_key_arn" {
  description = "ARN of the Redis KMS key"
  value       = aws_kms_key.redis.arn
}

output "s3_kms_key_id" {
  description = "ID of the S3 KMS key"
  value       = aws_kms_key.s3.key_id
}

output "s3_kms_key_arn" {
  description = "ARN of the S3 KMS key"
  value       = aws_kms_key.s3.arn
}

output "secrets_kms_key_id" {
  description = "ID of the secrets KMS key"
  value       = aws_kms_key.secrets.key_id
}

output "secrets_kms_key_arn" {
  description = "ARN of the secrets KMS key"
  value       = aws_kms_key.secrets.arn
}

# ACM Certificate
output "acm_certificate_arn" {
  description = "ARN of the ACM certificate"
  value       = aws_acm_certificate.main.arn
}

output "acm_certificate_domain_validation_options" {
  description = "Domain validation options for the ACM certificate"
  value       = aws_acm_certificate.main.domain_validation_options
}

# WAF
output "waf_web_acl_id" {
  description = "ID of the WAF Web ACL"
  value       = var.enable_waf ? aws_wafv2_web_acl.main[0].id : null
}

output "waf_web_acl_arn" {
  description = "ARN of the WAF Web ACL"
  value       = var.enable_waf ? aws_wafv2_web_acl.main[0].arn : null
}