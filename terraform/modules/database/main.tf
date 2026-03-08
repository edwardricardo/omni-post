# Database Module - RDS PostgreSQL with High Availability
# This module creates a production-ready PostgreSQL database with Multi-AZ, encryption, and monitoring

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Data sources
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Random password for database
resource "random_password" "master_password" {
  length  = 32
  special = true
}

# DB Subnet Group
resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-db-subnet-group"
  subnet_ids = var.database_subnet_ids

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-db-subnet-group"
    Type = "db-subnet-group"
  })
}

# DB Parameter Group for performance optimization
resource "aws_db_parameter_group" "postgres" {
  family = "postgres15"
  name   = "${var.project_name}-${var.environment}-postgres15"

  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
  }

  parameter {
    name  = "log_statement"
    value = "all"
  }

  parameter {
    name  = "log_duration"
    value = "1"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"  # Log slow queries (>1s)
  }

  parameter {
    name  = "log_checkpoints"
    value = "1"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  parameter {
    name  = "log_lock_waits"
    value = "1"
  }

  parameter {
    name  = "log_temp_files"
    value = "0"
  }

  parameter {
    name  = "track_activity_query_size"
    value = "2048"
  }

  parameter {
    name  = "pg_stat_statements.track"
    value = "all"
  }

  # Connection and memory optimization
  parameter {
    name  = "max_connections"
    value = "200"
  }

  parameter {
    name  = "shared_buffers"
    value = "{DBInstanceClassMemory/4}"
  }

  parameter {
    name  = "effective_cache_size"
    value = "{DBInstanceClassMemory*3/4}"
  }

  parameter {
    name  = "work_mem"
    value = "4096"  # 4MB per sort operation
  }

  parameter {
    name  = "maintenance_work_mem"
    value = "65536"  # 64MB for maintenance operations
  }

  # Checkpoint and WAL settings
  parameter {
    name  = "checkpoint_completion_target"
    value = "0.7"
  }

  parameter {
    name  = "wal_buffers"
    value = "16384"  # 16MB
  }

  parameter {
    name  = "default_statistics_target"
    value = "100"
  }

  tags = var.tags
}

# Option Group (if needed for additional features)
resource "aws_db_option_group" "postgres" {
  name                     = "${var.project_name}-${var.environment}-postgres15"
  option_group_description = "Option group for ${var.project_name} ${var.environment}"
  engine_name              = "postgres"
  major_engine_version     = "15"

  tags = var.tags
}

# RDS Instance
resource "aws_db_instance" "postgres" {
  # Basic configuration
  identifier                = "${var.project_name}-${var.environment}-postgres"
  allocated_storage         = var.db_allocated_storage
  max_allocated_storage     = var.db_max_allocated_storage
  storage_type              = "gp3"
  storage_throughput        = 125
  iops                      = 3000
  engine                    = "postgres"
  engine_version            = "15.4"
  instance_class            = var.db_instance_class

  # Database configuration
  db_name  = var.db_name
  username = var.db_username
  password = var.db_password != "" ? var.db_password : random_password.master_password.result

  # Network configuration
  vpc_security_group_ids = var.security_group_ids
  db_subnet_group_name   = aws_db_subnet_group.main.name
  port                   = 5432
  publicly_accessible    = false

  # High Availability
  multi_az               = var.multi_az
  availability_zone      = var.multi_az ? null : var.availability_zone

  # Backup configuration
  backup_retention_period = var.backup_retention_period
  backup_window          = var.backup_window
  maintenance_window     = var.maintenance_window
  copy_tags_to_snapshot  = true
  delete_automated_backups = false

  # Security
  storage_encrypted = var.storage_encrypted
  kms_key_id       = var.storage_encrypted ? var.kms_key_id : null

  # Parameter and Option Groups
  parameter_group_name = aws_db_parameter_group.postgres.name
  option_group_name    = aws_db_option_group.postgres.name

  # Monitoring
  monitoring_interval                   = var.monitoring_interval
  monitoring_role_arn                  = var.monitoring_interval > 0 ? aws_iam_role.rds_monitoring[0].arn : null
  enabled_cloudwatch_logs_exports      = ["postgresql"]
  performance_insights_enabled         = var.performance_insights_enabled
  performance_insights_retention_period = var.performance_insights_enabled ? 7 : null

  # Maintenance
  auto_minor_version_upgrade = true
  deletion_protection       = var.environment == "production"
  skip_final_snapshot      = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "${var.project_name}-${var.environment}-final-snapshot-${formatdate("YYYY-MM-DD-hhmm", timestamp())}" : null

  # Lifecycle
  lifecycle {
    ignore_changes = [
      password,  # Prevent Terraform from changing password after creation
    ]
    prevent_destroy = false  # Set to true in production
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-postgres"
    Type = "rds-instance"
  })

  depends_on = [
    aws_db_parameter_group.postgres,
    aws_db_option_group.postgres,
    aws_db_subnet_group.main
  ]
}

# Read Replica for production workloads
resource "aws_db_instance" "postgres_replica" {
  count = var.create_read_replica ? 1 : 0

  identifier                = "${var.project_name}-${var.environment}-postgres-replica"
  replicate_source_db       = aws_db_instance.postgres.identifier
  instance_class            = var.replica_instance_class
  auto_minor_version_upgrade = true

  # Network configuration
  vpc_security_group_ids = var.security_group_ids
  publicly_accessible    = false

  # Monitoring
  monitoring_interval                   = var.monitoring_interval
  monitoring_role_arn                  = var.monitoring_interval > 0 ? aws_iam_role.rds_monitoring[0].arn : null
  performance_insights_enabled         = var.performance_insights_enabled
  performance_insights_retention_period = var.performance_insights_enabled ? 7 : null

  # Lifecycle
  skip_final_snapshot = true

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-postgres-replica"
    Type = "rds-replica"
  })
}

# IAM Role for Enhanced Monitoring
resource "aws_iam_role" "rds_monitoring" {
  count = var.monitoring_interval > 0 ? 1 : 0

  name = "${var.project_name}-${var.environment}-rds-monitoring-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  count = var.monitoring_interval > 0 ? 1 : 0

  role       = aws_iam_role.rds_monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# CloudWatch Alarms for monitoring
resource "aws_cloudwatch_metric_alarm" "database_cpu" {
  alarm_name          = "${var.project_name}-${var.environment}-postgres-cpu-utilization"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = "300"  # 5 minutes
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "This metric monitors RDS CPU utilization"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.id
  }

  alarm_actions = var.sns_topic_arn != null ? [var.sns_topic_arn] : []
  ok_actions    = var.sns_topic_arn != null ? [var.sns_topic_arn] : []

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "database_connections" {
  alarm_name          = "${var.project_name}-${var.environment}-postgres-connection-count"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = "300"
  statistic           = "Average"
  threshold           = "160"  # 80% of max_connections (200)
  alarm_description   = "This metric monitors RDS connection count"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.id
  }

  alarm_actions = var.sns_topic_arn != null ? [var.sns_topic_arn] : []
  ok_actions    = var.sns_topic_arn != null ? [var.sns_topic_arn] : []

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "database_free_storage" {
  alarm_name          = "${var.project_name}-${var.environment}-postgres-free-storage"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = "300"
  statistic           = "Average"
  threshold           = "10737418240"  # 10 GB in bytes
  alarm_description   = "This metric monitors RDS free storage space"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.id
  }

  alarm_actions = var.sns_topic_arn != null ? [var.sns_topic_arn] : []
  ok_actions    = var.sns_topic_arn != null ? [var.sns_topic_arn] : []

  tags = var.tags
}

# DB Event Subscription for notifications
resource "aws_db_event_subscription" "default" {
  count = var.sns_topic_arn != null ? 1 : 0

  name      = "${var.project_name}-${var.environment}-postgres-events"
  sns_topic = var.sns_topic_arn

  source_type = "db-instance"
  source_ids  = [aws_db_instance.postgres.id]

  event_categories = [
    "availability",
    "deletion",
    "failover",
    "failure",
    "low storage",
    "maintenance",
    "notification",
    "read replica",
    "recovery",
    "restoration",
  ]

  tags = var.tags
}

# AWS Backup Plan for database backups
resource "aws_backup_selection" "postgres_backup" {
  count = var.enable_backup_plan ? 1 : 0

  iam_role_arn = var.backup_service_role_arn
  name         = "${var.project_name}-${var.environment}-postgres-backup"
  plan_id      = var.backup_plan_id

  resources = [
    aws_db_instance.postgres.arn
  ]

  condition {
    string_equals {
      key   = "aws:ResourceTag/Environment"
      value = var.environment
    }
  }
}