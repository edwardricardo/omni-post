# EKS Module Outputs

output "cluster_id" {
  description = "EKS cluster ID"
  value       = aws_eks_cluster.cluster.id
}

output "cluster_name" {
  description = "EKS cluster name"
  value       = aws_eks_cluster.cluster.name
}

output "cluster_arn" {
  description = "EKS cluster ARN"
  value       = aws_eks_cluster.cluster.arn
}

output "cluster_endpoint" {
  description = "EKS cluster endpoint"
  value       = aws_eks_cluster.cluster.endpoint
}

output "cluster_version" {
  description = "EKS cluster version"
  value       = aws_eks_cluster.cluster.version
}

output "cluster_platform_version" {
  description = "EKS cluster platform version"
  value       = aws_eks_cluster.cluster.platform_version
}

output "cluster_status" {
  description = "EKS cluster status"
  value       = aws_eks_cluster.cluster.status
}

output "cluster_security_group_id" {
  description = "EKS cluster security group ID"
  value       = aws_eks_cluster.cluster.vpc_config[0].cluster_security_group_id
}

output "cluster_certificate_authority_data" {
  description = "Base64 encoded certificate data required to communicate with the cluster"
  value       = aws_eks_cluster.cluster.certificate_authority[0].data
}

output "cluster_primary_security_group_id" {
  description = "Primary security group ID created by EKS for the cluster"
  value       = aws_eks_cluster.cluster.vpc_config[0].cluster_security_group_id
}

output "node_group_arns" {
  description = "EKS node group ARNs"
  value       = { for k, v in aws_eks_node_group.node_groups : k => v.arn }
}

output "node_group_names" {
  description = "EKS node group names"
  value       = { for k, v in aws_eks_node_group.node_groups : k => v.node_group_name }
}

output "node_group_statuses" {
  description = "EKS node group statuses"
  value       = { for k, v in aws_eks_node_group.node_groups : k => v.status }
}

output "node_group_capacity_types" {
  description = "EKS node group capacity types"
  value       = { for k, v in aws_eks_node_group.node_groups : k => v.capacity_type }
}

output "node_group_instance_types" {
  description = "EKS node group instance types"
  value       = { for k, v in aws_eks_node_group.node_groups : k => v.instance_types }
}

output "node_group_remote_access" {
  description = "EKS node group remote access configuration"
  value       = { for k, v in aws_eks_node_group.node_groups : k => v.remote_access }
}

output "cluster_addons" {
  description = "EKS cluster add-ons"
  value       = { for k, v in aws_eks_addon.addons : k => {
    arn               = v.arn
    created_at        = v.created_at
    modified_at       = v.modified_at
    status            = v.status
    addon_version     = v.addon_version
  }}
}

output "ebs_csi_driver_addon" {
  description = "EBS CSI driver add-on"
  value = {
    arn               = aws_eks_addon.aws_ebs_csi_driver.arn
    created_at        = aws_eks_addon.aws_ebs_csi_driver.created_at
    modified_at       = aws_eks_addon.aws_ebs_csi_driver.modified_at
    status            = aws_eks_addon.aws_ebs_csi_driver.status
    addon_version     = aws_eks_addon.aws_ebs_csi_driver.addon_version
  }
}

output "launch_template_ids" {
  description = "Launch template IDs"
  value       = { for k, v in aws_launch_template.node_group : k => v.id }
}

output "launch_template_latest_versions" {
  description = "Launch template latest versions"
  value       = { for k, v in aws_launch_template.node_group : k => v.latest_version }
}

output "application_namespace" {
  description = "Application Kubernetes namespace"
  value       = kubernetes_namespace.application.metadata[0].name
}

output "monitoring_namespace" {
  description = "Monitoring Kubernetes namespace"
  value       = kubernetes_namespace.monitoring.metadata[0].name
}

output "aws_load_balancer_controller_service_account" {
  description = "AWS Load Balancer Controller service account"
  value = {
    name      = kubernetes_service_account.aws_load_balancer_controller.metadata[0].name
    namespace = kubernetes_service_account.aws_load_balancer_controller.metadata[0].namespace
  }
}

output "default_storage_class" {
  description = "Default storage class name"
  value       = kubernetes_storage_class.ebs_gp3.metadata[0].name
}

# OIDC Provider information for IRSA
output "oidc_provider_arn" {
  description = "ARN of the EKS OIDC Provider"
  value       = aws_eks_cluster.cluster.identity[0].oidc[0].issuer
}

output "oidc_provider_url" {
  description = "URL of the EKS OIDC Provider"
  value       = aws_eks_cluster.cluster.identity[0].oidc[0].issuer
}

# Additional cluster information
output "cluster_created_at" {
  description = "Unix epoch timestamp when the cluster was created"
  value       = aws_eks_cluster.cluster.created_at
}

output "cluster_vpc_config" {
  description = "EKS cluster VPC configuration"
  value       = aws_eks_cluster.cluster.vpc_config
  sensitive   = true
}

output "cluster_log_group_arn" {
  description = "ARN of the CloudWatch log group for cluster logs"
  value       = aws_cloudwatch_log_group.cluster.arn
}