# Monitoring Module - Comprehensive Observability Stack
# This module sets up Prometheus, Grafana, ELK stack, Jaeger, and CloudWatch integration

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
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.11"
    }
  }
}

# Data sources
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "application" {
  count             = var.create_cloudwatch_log_groups ? 1 : 0
  name              = "/aws/eks/${var.cluster_name}/application"
  retention_in_days = var.log_retention_in_days

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "system" {
  count             = var.create_cloudwatch_log_groups ? 1 : 0
  name              = "/aws/eks/${var.cluster_name}/system"
  retention_in_days = var.log_retention_in_days

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "audit" {
  count             = var.create_cloudwatch_log_groups ? 1 : 0
  name              = "/aws/eks/${var.cluster_name}/audit"
  retention_in_days = var.log_retention_in_days

  tags = var.tags
}

# SNS Topic for alerts
resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-${var.environment}-alerts"

  tags = var.tags
}

resource "aws_sns_topic_subscription" "email_alerts" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.notification_email
}

# Elasticsearch Domain for logging
resource "aws_elasticsearch_domain" "logging" {
  count = var.enable_elasticsearch ? 1 : 0

  domain_name           = "${var.project_name}-${var.environment}-logging"
  elasticsearch_version = "7.10"

  cluster_config {
    instance_type            = var.elasticsearch_instance_type
    instance_count           = var.environment == "production" ? 3 : 1
    dedicated_master_enabled = var.environment == "production"
    master_instance_type     = var.environment == "production" ? "m6g.medium.elasticsearch" : null
    master_instance_count    = var.environment == "production" ? 3 : null
    zone_awareness_enabled   = var.environment == "production"

    dynamic "zone_awareness_config" {
      for_each = var.environment == "production" ? [1] : []
      content {
        availability_zone_count = 3
      }
    }
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp3"
    volume_size = var.environment == "production" ? 100 : 20
  }

  vpc_options {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.elasticsearch[0].id]
  }

  encrypt_at_rest {
    enabled = true
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  advanced_security_options {
    enabled                        = true
    internal_user_database_enabled = true
    master_user_options {
      master_user_name     = "elastic"
      master_user_password = var.elasticsearch_master_password
    }
  }

  access_policies = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          AWS = "*"
        }
        Action   = "es:*"
        Resource = "arn:aws:es:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:domain/${var.project_name}-${var.environment}-logging/*"
      }
    ]
  })

  tags = var.tags
}

# Security group for Elasticsearch
resource "aws_security_group" "elasticsearch" {
  count = var.enable_elasticsearch ? 1 : 0

  name_prefix = "${var.project_name}-${var.environment}-elasticsearch-"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  ingress {
    from_port   = 9200
    to_port     = 9200
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-elasticsearch-sg"
    Type = "security-group"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Kubernetes configurations
provider "kubernetes" {
  host                   = var.cluster_endpoint
  cluster_ca_certificate = base64decode(var.cluster_ca_certificate)
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", var.cluster_name]
  }
}

provider "helm" {
  kubernetes {
    host                   = var.cluster_endpoint
    cluster_ca_certificate = base64decode(var.cluster_ca_certificate)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", var.cluster_name]
    }
  }
}

# Prometheus using Helm
resource "helm_release" "prometheus" {
  count = var.enable_prometheus ? 1 : 0

  name       = "prometheus"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  namespace  = "monitoring"
  version    = "45.7.1"

  create_namespace = true

  values = [
    yamlencode({
      prometheus = {
        prometheusSpec = {
          retention = "30d"
          storageSpec = {
            volumeClaimTemplate = {
              spec = {
                storageClassName = "gp3"
                accessModes      = ["ReadWriteOnce"]
                resources = {
                  requests = {
                    storage = var.environment == "production" ? "100Gi" : "20Gi"
                  }
                }
              }
            }
          }
          resources = {
            requests = {
              memory = "2Gi"
              cpu    = "1000m"
            }
            limits = {
              memory = "4Gi"
              cpu    = "2000m"
            }
          }
        }
        service = {
          type = "ClusterIP"
        }
      }
      grafana = {
        enabled = var.enable_grafana
        adminPassword = var.grafana_admin_password
        persistence = {
          enabled = true
          size    = "10Gi"
          storageClassName = "gp3"
        }
        grafana.ini = {
          server = {
            root_url = "https://${var.grafana_domain}"
          }
          auth = {
            disable_login_form = false
          }
          "auth.anonymous" = {
            enabled = false
          }
        }
        service = {
          type = "ClusterIP"
        }
        ingress = {
          enabled = true
          ingressClassName = "alb"
          annotations = {
            "kubernetes.io/ingress.class"                    = "alb"
            "alb.ingress.kubernetes.io/scheme"              = "internet-facing"
            "alb.ingress.kubernetes.io/target-type"         = "ip"
            "alb.ingress.kubernetes.io/certificate-arn"     = var.acm_certificate_arn
            "alb.ingress.kubernetes.io/ssl-policy"          = "ELBSecurityPolicy-TLS-1-2-2017-01"
            "alb.ingress.kubernetes.io/listen-ports"        = "[{\"HTTP\": 80}, {\"HTTPS\": 443}]"
            "alb.ingress.kubernetes.io/ssl-redirect"        = "443"
          }
          hosts = [
            {
              host = var.grafana_domain
              paths = [
                {
                  path = "/"
                  pathType = "Prefix"
                }
              ]
            }
          ]
        }
        datasources = {
          "datasources.yaml" = {
            apiVersion = 1
            datasources = [
              {
                name      = "Prometheus"
                type      = "prometheus"
                url       = "http://prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090"
                access    = "proxy"
                isDefault = true
              }
            ]
          }
        }
        dashboardProviders = {
          "dashboardproviders.yaml" = {
            apiVersion = 1
            providers = [
              {
                name            = "default"
                orgId           = 1
                folder          = ""
                type            = "file"
                disableDeletion = false
                editable        = true
                options = {
                  path = "/var/lib/grafana/dashboards/default"
                }
              }
            ]
          }
        }
        dashboards = {
          default = {
            kubernetes-cluster-monitoring = {
              gnetId     = 7249
              revision   = 1
              datasource = "Prometheus"
            }
            kubernetes-pods-monitoring = {
              gnetId     = 6417
              revision   = 1
              datasource = "Prometheus"
            }
            node-exporter-full = {
              gnetId     = 1860
              revision   = 27
              datasource = "Prometheus"
            }
            postgres-overview = {
              gnetId     = 9628
              revision   = 7
              datasource = "Prometheus"
            }
            redis-overview = {
              gnetId     = 763
              revision   = 4
              datasource = "Prometheus"
            }
          }
        }
      }
      alertmanager = {
        enabled = var.enable_alertmanager
        alertmanagerSpec = {
          storage = {
            volumeClaimTemplate = {
              spec = {
                storageClassName = "gp3"
                accessModes      = ["ReadWriteOnce"]
                resources = {
                  requests = {
                    storage = "10Gi"
                  }
                }
              }
            }
          }
        }
        config = {
          global = {
            smtp_smarthost = "localhost:587"
          }
          route = {
            group_by        = ["alertname"]
            group_wait      = "10s"
            group_interval  = "10s"
            repeat_interval = "1h"
            receiver        = "web.hook"
          }
          receivers = [
            {
              name = "web.hook"
              slack_configs = var.slack_webhook_url != "" ? [
                {
                  api_url     = var.slack_webhook_url
                  channel     = "#alerts"
                  title       = "{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}"
                  text        = "{{ range .Alerts }}{{ .Annotations.description }}{{ end }}"
                  send_resolved = true
                }
              ] : []
              pagerduty_configs = var.pagerduty_key != "" ? [
                {
                  routing_key = var.pagerduty_key
                  description = "{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}"
                }
              ] : []
            }
          ]
        }
      }
      kubeStateMetrics = {
        enabled = true
      }
      nodeExporter = {
        enabled = true
      }
      prometheusOperator = {
        enabled = true
      }
    })
  ]

  depends_on = [
    kubernetes_namespace.monitoring
  ]
}

# Jaeger for distributed tracing
resource "helm_release" "jaeger" {
  count = var.enable_jaeger ? 1 : 0

  name       = "jaeger"
  repository = "https://jaegertracing.github.io/helm-charts"
  chart      = "jaeger"
  namespace  = "monitoring"
  version    = "0.71.2"

  values = [
    yamlencode({
      provisionDataStore = {
        cassandra = false
        elasticsearch = var.enable_elasticsearch
      }
      storage = {
        type = var.enable_elasticsearch ? "elasticsearch" : "memory"
        elasticsearch = var.enable_elasticsearch ? {
          host = aws_elasticsearch_domain.logging[0].endpoint
          port = 9200
          scheme = "https"
          user = "elastic"
          password = var.elasticsearch_master_password
        } : {}
      }
      agent = {
        enabled = true
      }
      collector = {
        enabled = true
        service = {
          type = "ClusterIP"
        }
      }
      query = {
        enabled = true
        service = {
          type = "ClusterIP"
        }
        ingress = {
          enabled = true
          ingressClassName = "alb"
          annotations = {
            "kubernetes.io/ingress.class"                    = "alb"
            "alb.ingress.kubernetes.io/scheme"              = "internet-facing"
            "alb.ingress.kubernetes.io/target-type"         = "ip"
            "alb.ingress.kubernetes.io/certificate-arn"     = var.acm_certificate_arn
            "alb.ingress.kubernetes.io/ssl-policy"          = "ELBSecurityPolicy-TLS-1-2-2017-01"
            "alb.ingress.kubernetes.io/listen-ports"        = "[{\"HTTP\": 80}, {\"HTTPS\": 443}]"
            "alb.ingress.kubernetes.io/ssl-redirect"        = "443"
          }
          hosts = [
            {
              host = var.jaeger_domain
              paths = [
                {
                  path = "/"
                  pathType = "Prefix"
                }
              ]
            }
          ]
        }
      }
    })
  ]

  depends_on = [
    kubernetes_namespace.monitoring
  ]
}

# ELK Stack using Helm (Elasticsearch, Logstash, Kibana)
resource "helm_release" "elk" {
  count = var.enable_elasticsearch ? 1 : 0

  name       = "elastic"
  repository = "https://helm.elastic.co"
  chart      = "elastic-stack"
  namespace  = "logging"
  version    = "8.5.1"

  create_namespace = true

  values = [
    yamlencode({
      elasticsearch = {
        enabled = false  # Using AWS managed Elasticsearch
      }
      kibana = {
        enabled = true
        elasticsearchHosts = "https://${aws_elasticsearch_domain.logging[0].endpoint}:443"
        service = {
          type = "ClusterIP"
        }
        ingress = {
          enabled = true
          ingressClassName = "alb"
          annotations = {
            "kubernetes.io/ingress.class"                    = "alb"
            "alb.ingress.kubernetes.io/scheme"              = "internet-facing"
            "alb.ingress.kubernetes.io/target-type"         = "ip"
            "alb.ingress.kubernetes.io/certificate-arn"     = var.acm_certificate_arn
            "alb.ingress.kubernetes.io/ssl-policy"          = "ELBSecurityPolicy-TLS-1-2-2017-01"
            "alb.ingress.kubernetes.io/listen-ports"        = "[{\"HTTP\": 80}, {\"HTTPS\": 443}]"
            "alb.ingress.kubernetes.io/ssl-redirect"        = "443"
          }
          hosts = [
            {
              host = var.kibana_domain
              paths = [
                {
                  path = "/"
                  pathType = "Prefix"
                }
              ]
            }
          ]
        }
        resources = {
          requests = {
            memory = "1Gi"
            cpu    = "500m"
          }
          limits = {
            memory = "2Gi"
            cpu    = "1000m"
          }
        }
      }
      logstash = {
        enabled = true
        elasticsearchHosts = "https://${aws_elasticsearch_domain.logging[0].endpoint}:443"
        persistence = {
          enabled = true
          size    = "10Gi"
        }
        resources = {
          requests = {
            memory = "1Gi"
            cpu    = "500m"
          }
          limits = {
            memory = "2Gi"
            cpu    = "1000m"
          }
        }
      }
      filebeat = {
        enabled = true
        daemonset = {
          enabled = true
        }
        filebeatConfig = {
          "filebeat.yml" = {
            filebeat.inputs = [
              {
                type = "container"
                paths = [
                  "/var/log/containers/*.log"
                ]
                processors = [
                  {
                    add_kubernetes_metadata = {
                      host = "$${NODE_NAME}"
                      matchers = [
                        {
                          logs_path = {
                            logs_path = "/var/log/containers/"
                            resource_type = "container"
                          }
                        }
                      ]
                    }
                  }
                ]
              }
            ]
            output.elasticsearch = {
              hosts = ["https://${aws_elasticsearch_domain.logging[0].endpoint}:443"]
              username = "elastic"
              password = var.elasticsearch_master_password
            }
            setup.kibana = {
              host = "kibana-kibana.logging.svc.cluster.local:5601"
            }
          }
        }
      }
    })
  ]

  depends_on = [
    aws_elasticsearch_domain.logging
  ]
}

# Kubernetes namespace for monitoring
resource "kubernetes_namespace" "monitoring" {
  metadata {
    name = "monitoring"
    labels = {
      name = "monitoring"
      environment = var.environment
    }
  }
}

# ServiceMonitor for application metrics
resource "kubernetes_manifest" "application_service_monitor" {
  count = var.enable_prometheus ? 1 : 0

  manifest = {
    apiVersion = "monitoring.coreos.com/v1"
    kind       = "ServiceMonitor"
    metadata = {
      name      = "application-metrics"
      namespace = "monitoring"
      labels = {
        app = var.project_name
        environment = var.environment
      }
    }
    spec = {
      selector = {
        matchLabels = {
          app = var.project_name
        }
      }
      endpoints = [
        {
          port     = "metrics"
          path     = "/metrics"
          interval = "30s"
        }
      ]
      namespaceSelector = {
        matchNames = [var.project_name]
      }
    }
  }

  depends_on = [
    helm_release.prometheus
  ]
}

# PrometheusRule for custom alerts
resource "kubernetes_manifest" "application_alerts" {
  count = var.enable_prometheus ? 1 : 0

  manifest = {
    apiVersion = "monitoring.coreos.com/v1"
    kind       = "PrometheusRule"
    metadata = {
      name      = "application-alerts"
      namespace = "monitoring"
      labels = {
        app = var.project_name
        environment = var.environment
        prometheus = "kube-prometheus"
        role = "alert-rules"
      }
    }
    spec = {
      groups = [
        {
          name = "application.rules"
          rules = [
            {
              alert = "HighErrorRate"
              expr  = "rate(http_requests_total{status=~\"5..\"}[5m]) / rate(http_requests_total[5m]) > 0.05"
              for   = "2m"
              labels = {
                severity = "critical"
              }
              annotations = {
                summary     = "High error rate detected"
                description = "Error rate is {{ $value | humanizePercentage }} for {{ $labels.job }}"
              }
            }
            {
              alert = "HighResponseTime"
              expr  = "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1"
              for   = "5m"
              labels = {
                severity = "warning"
              }
              annotations = {
                summary     = "High response time"
                description = "95th percentile latency is {{ $value }}s"
              }
            }
            {
              alert = "DatabaseConnectionPoolExhaustion"
              expr  = "database_connections_active / database_connections_max > 0.9"
              for   = "2m"
              labels = {
                severity = "critical"
              }
              annotations = {
                summary     = "Database connection pool nearly exhausted"
                description = "Connection pool utilization is {{ $value | humanizePercentage }}"
              }
            }
            {
              alert = "PodCrashLooping"
              expr  = "rate(kube_pod_container_status_restarts_total[15m]) * 60 * 15 > 0"
              for   = "0m"
              labels = {
                severity = "critical"
              }
              annotations = {
                summary     = "Pod is crash looping"
                description = "Pod {{ $labels.namespace }}/{{ $labels.pod }} ({{ $labels.container }}) is restarting {{ printf \"%.2f\" $value }} times / 15 minutes."
              }
            }
          ]
        }
      ]
    }
  }

  depends_on = [
    helm_release.prometheus
  ]
}