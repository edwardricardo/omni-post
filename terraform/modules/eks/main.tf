# EKS Module - Kubernetes Cluster with Auto-scaling Node Groups
# This module creates a production-ready EKS cluster with managed node groups and add-ons

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
  }
}

# Data sources
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# EKS Cluster
resource "aws_eks_cluster" "cluster" {
  name     = var.cluster_name
  version  = var.cluster_version
  role_arn = var.cluster_role_arn

  vpc_config {
    subnet_ids              = concat(var.private_subnet_ids, var.control_plane_subnet_ids)
    endpoint_private_access = var.cluster_endpoint_private_access
    endpoint_public_access  = var.cluster_endpoint_public_access
    public_access_cidrs     = var.cluster_endpoint_public_access_cidrs
    security_group_ids      = [var.cluster_security_group_id]
  }

  # Enable EKS Cluster logging
  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]

  # Ensure that IAM Role permissions are created before and deleted after EKS Cluster handling
  depends_on = [
    aws_cloudwatch_log_group.cluster
  ]

  tags = merge(var.tags, {
    Name = var.cluster_name
    Type = "eks-cluster"
  })
}

# CloudWatch Log Group for EKS cluster logs
resource "aws_cloudwatch_log_group" "cluster" {
  name              = "/aws/eks/${var.cluster_name}/cluster"
  retention_in_days = 30

  tags = var.tags
}

# EKS Node Groups
resource "aws_eks_node_group" "node_groups" {
  for_each = var.node_groups

  cluster_name    = aws_eks_cluster.cluster.name
  node_group_name = "${var.cluster_name}-${each.key}"
  node_role_arn   = var.node_group_role_arn
  subnet_ids      = var.private_subnet_ids

  # Instance configuration
  capacity_type  = each.value.capacity_type
  instance_types = each.value.instance_types
  ami_type      = each.value.ami_type
  disk_size     = each.value.disk_size

  # Scaling configuration
  scaling_config {
    desired_size = each.value.desired_size
    max_size     = each.value.max_size
    min_size     = each.value.min_size
  }

  # Update configuration
  update_config {
    max_unavailable_percentage = 25
  }

  # Launch template for advanced configuration
  launch_template {
    name    = aws_launch_template.node_group[each.key].name
    version = aws_launch_template.node_group[each.key].latest_version
  }

  # Kubernetes labels and taints
  labels = merge(each.value.kubernetes_labels, {
    "node-group" = each.key
    "environment" = var.environment
  })

  dynamic "taint" {
    for_each = each.value.kubernetes_taints
    content {
      key    = taint.value.key
      value  = taint.value.value
      effect = taint.value.effect
    }
  }

  # Ensure that IAM Role permissions are created before and deleted after EKS Node Group handling
  depends_on = [
    aws_eks_cluster.cluster
  ]

  tags = merge(var.tags, {
    Name = "${var.cluster_name}-${each.key}"
    Type = "eks-node-group"
    NodeGroup = each.key
    "k8s.io/cluster-autoscaler/enabled" = "true"
    "k8s.io/cluster-autoscaler/${var.cluster_name}" = "owned"
  })

  lifecycle {
    ignore_changes = [scaling_config[0].desired_size]
  }
}

# Launch templates for node groups
resource "aws_launch_template" "node_group" {
  for_each = var.node_groups

  name_prefix = "${var.cluster_name}-${each.key}-"

  vpc_security_group_ids = [var.node_security_group_id]

  # User data for node initialization
  user_data = base64encode(templatefile("${path.module}/user_data.sh", {
    cluster_name        = var.cluster_name
    endpoint           = aws_eks_cluster.cluster.endpoint
    certificate        = aws_eks_cluster.cluster.certificate_authority[0].data
    bootstrap_args     = ""
  }))

  # Instance metadata options for security
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                = "required"
    http_put_response_hop_limit = 2
    instance_metadata_tags     = "enabled"
  }

  # EBS optimization
  ebs_optimized = true

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = each.value.disk_size
      volume_type          = "gp3"
      iops                 = 3000
      throughput           = 125
      encrypted            = true
      delete_on_termination = true
    }
  }

  # Monitoring
  monitoring {
    enabled = true
  }

  tag_specifications {
    resource_type = "instance"
    tags = merge(var.tags, {
      Name = "${var.cluster_name}-${each.key}-node"
      NodeGroup = each.key
      "kubernetes.io/cluster/${var.cluster_name}" = "owned"
    })
  }

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

# EKS Add-ons
resource "aws_eks_addon" "addons" {
  for_each = var.cluster_addons

  cluster_name      = aws_eks_cluster.cluster.name
  addon_name        = each.key
  addon_version     = each.value.version
  resolve_conflicts = "OVERWRITE"

  depends_on = [
    aws_eks_node_group.node_groups
  ]

  tags = var.tags
}

# Additional EKS Add-ons for observability
resource "aws_eks_addon" "aws_ebs_csi_driver" {
  cluster_name             = aws_eks_cluster.cluster.name
  addon_name               = "aws-ebs-csi-driver"
  addon_version            = "v1.24.0-eksbuild.1"
  resolve_conflicts        = "OVERWRITE"
  service_account_role_arn = aws_iam_role.ebs_csi_driver.arn

  depends_on = [
    aws_eks_node_group.node_groups
  ]

  tags = var.tags
}

# IAM role for EBS CSI driver
resource "aws_iam_role" "ebs_csi_driver" {
  name = "${var.cluster_name}-ebs-csi-driver-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = var.oidc_provider_arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "${replace(var.oidc_provider_url, "https://", "")}:sub" = "system:serviceaccount:kube-system:ebs-csi-controller-sa"
            "${replace(var.oidc_provider_url, "https://", "")}:aud" = "sts.amazonaws.com"
          }
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ebs_csi_driver_policy" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
  role       = aws_iam_role.ebs_csi_driver.name
}

# Kubernetes provider configuration
data "aws_eks_cluster_auth" "cluster" {
  name = aws_eks_cluster.cluster.name
}

provider "kubernetes" {
  host                   = aws_eks_cluster.cluster.endpoint
  cluster_ca_certificate = base64decode(aws_eks_cluster.cluster.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.cluster.token
}

# Kubernetes Storage Class for EBS
resource "kubernetes_storage_class" "ebs_gp3" {
  metadata {
    name = "ebs-gp3"
    annotations = {
      "storageclass.kubernetes.io/is-default-class" = "true"
    }
  }

  storage_provisioner    = "ebs.csi.aws.com"
  reclaim_policy        = "Delete"
  volume_binding_mode   = "WaitForFirstConsumer"
  allow_volume_expansion = true

  parameters = {
    type       = "gp3"
    iops       = "3000"
    throughput = "125"
    encrypted  = "true"
  }

  depends_on = [
    aws_eks_addon.aws_ebs_csi_driver
  ]
}

# Kubernetes Namespace for the application
resource "kubernetes_namespace" "application" {
  metadata {
    name = var.project_name
    labels = {
      name        = var.project_name
      environment = var.environment
    }
  }

  depends_on = [
    aws_eks_cluster.cluster
  ]
}

# Kubernetes Namespace for monitoring
resource "kubernetes_namespace" "monitoring" {
  metadata {
    name = "monitoring"
    labels = {
      name = "monitoring"
      environment = var.environment
    }
  }

  depends_on = [
    aws_eks_cluster.cluster
  ]
}

# Horizontal Pod Autoscaler for cluster autoscaling
resource "kubernetes_config_map" "cluster_autoscaler_status" {
  metadata {
    name      = "cluster-autoscaler-status"
    namespace = "kube-system"
    labels = {
      k8s-addon = "cluster-autoscaler.addons.k8s.io"
      k8s-app   = "cluster-autoscaler"
    }
  }

  depends_on = [
    aws_eks_cluster.cluster
  ]
}

# AWS Load Balancer Controller Service Account
resource "kubernetes_service_account" "aws_load_balancer_controller" {
  metadata {
    name      = "aws-load-balancer-controller"
    namespace = "kube-system"
    labels = {
      "app.kubernetes.io/component" = "controller"
      "app.kubernetes.io/name"      = "aws-load-balancer-controller"
    }
    annotations = {
      "eks.amazonaws.com/role-arn" = var.aws_load_balancer_controller_role_arn
    }
  }

  depends_on = [
    aws_eks_cluster.cluster
  ]
}

# Metrics Server for HPA
resource "kubernetes_config_map" "metrics_server_config" {
  metadata {
    name      = "metrics-server-config"
    namespace = "kube-system"
  }

  data = {
    "metrics-server-config.yaml" = yamlencode({
      apiVersion = "v1"
      kind       = "ConfigMap"
      data = {
        enable-aggregator-routing = "true"
      }
    })
  }

  depends_on = [
    aws_eks_cluster.cluster
  ]
}