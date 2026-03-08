# EKS Module Variables

variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
}

variable "cluster_name" {
  description = "Name of the EKS cluster"
  type        = string
}

variable "cluster_version" {
  description = "Kubernetes version for the EKS cluster"
  type        = string
  default     = "1.28"
}

variable "cluster_role_arn" {
  description = "ARN of the EKS cluster IAM role"
  type        = string
}

variable "node_group_role_arn" {
  description = "ARN of the EKS node group IAM role"
  type        = string
}

variable "aws_load_balancer_controller_role_arn" {
  description = "ARN of the AWS Load Balancer Controller IAM role"
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC"
  type        = string
}

variable "private_subnet_ids" {
  description = "IDs of the private subnets"
  type        = list(string)
}

variable "control_plane_subnet_ids" {
  description = "IDs of the control plane subnets"
  type        = list(string)
}

variable "cluster_endpoint_private_access" {
  description = "Enable private API server endpoint"
  type        = bool
  default     = true
}

variable "cluster_endpoint_public_access" {
  description = "Enable public API server endpoint"
  type        = bool
  default     = true
}

variable "cluster_endpoint_public_access_cidrs" {
  description = "List of CIDR blocks for public API server endpoint access"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "cluster_security_group_id" {
  description = "ID of the cluster security group"
  type        = string
}

variable "node_security_group_id" {
  description = "ID of the node security group"
  type        = string
}

variable "oidc_provider_arn" {
  description = "ARN of the OIDC provider"
  type        = string
}

variable "oidc_provider_url" {
  description = "URL of the OIDC provider"
  type        = string
}

variable "node_groups" {
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
      instance_types      = ["t3.medium"]
      capacity_type      = "ON_DEMAND"
      min_size          = 1
      max_size          = 5
      desired_size      = 3
      disk_size         = 50
      ami_type          = "AL2_x86_64"
      kubernetes_labels = {
        role = "general"
      }
      kubernetes_taints = []
    }
  }
}

variable "cluster_addons" {
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
  }
}

variable "enable_irsa" {
  description = "Enable IAM Roles for Service Accounts"
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}