# Database Module Outputs

# Primary Database Instance
output "db_instance_id" {
  description = "The RDS instance ID"
  value       = aws_db_instance.postgres.id
}

output "db_instance_arn" {
  description = "The ARN of the RDS instance"
  value       = aws_db_instance.postgres.arn
}

output "db_instance_identifier" {
  description = "The RDS instance identifier"
  value       = aws_db_instance.postgres.identifier
}

output "db_endpoint" {
  description = "The RDS instance endpoint"
  value       = aws_db_instance.postgres.endpoint
}

output "db_port" {
  description = "The RDS instance port"
  value       = aws_db_instance.postgres.port
}

output "db_name" {
  description = "The database name"
  value       = aws_db_instance.postgres.db_name
}

output "db_username" {
  description = "The master username for the database"
  value       = aws_db_instance.postgres.username
  sensitive   = true
}

# Read Replica (if created)
output "db_replica_endpoint" {
  description = "The RDS read replica endpoint"
  value       = var.create_read_replica ? aws_db_instance.postgres_replica[0].endpoint : null
}

output "db_replica_identifier" {
  description = "The RDS read replica identifier"
  value       = var.create_read_replica ? aws_db_instance.postgres_replica[0].identifier : null
}

# Connection Information
output "connection_string" {
  description = "PostgreSQL connection string"
  value       = "postgresql://${aws_db_instance.postgres.username}:${urlencode(var.db_password != "" ? var.db_password : random_password.master_password.result)}@${aws_db_instance.postgres.endpoint}:${aws_db_instance.postgres.port}/${aws_db_instance.postgres.db_name}?sslmode=require"
  sensitive   = true
}

output "read_replica_connection_string" {
  description = "PostgreSQL read replica connection string"
  value       = var.create_read_replica ? "postgresql://${aws_db_instance.postgres.username}:${urlencode(var.db_password != "" ? var.db_password : random_password.master_password.result)}@${aws_db_instance.postgres_replica[0].endpoint}:${aws_db_instance.postgres_replica[0].port}/${aws_db_instance.postgres.db_name}?sslmode=require" : null
  sensitive   = true
}

# Database Configuration
output "db_parameter_group_name" {
  description = "The database parameter group name"
  value       = aws_db_parameter_group.postgres.name
}

output "db_option_group_name" {
  description = "The database option group name"
  value       = aws_db_option_group.postgres.name
}

output "db_subnet_group_name" {
  description = "The database subnet group name"
  value       = aws_db_subnet_group.main.name
}

# Security and Access
output "db_instance_availability_zone" {
  description = "The availability zone of the RDS instance"
  value       = aws_db_instance.postgres.availability_zone
}

output "db_instance_multi_az" {
  description = "If the RDS instance is multi-AZ enabled"
  value       = aws_db_instance.postgres.multi_az
}

output "db_instance_status" {
  description = "The RDS instance status"
  value       = aws_db_instance.postgres.status
}

# Storage Information
output "db_allocated_storage" {
  description = "The allocated storage size"
  value       = aws_db_instance.postgres.allocated_storage
}

output "db_max_allocated_storage" {
  description = "The maximum allocated storage size"
  value       = aws_db_instance.postgres.max_allocated_storage
}

output "db_storage_encrypted" {
  description = "Whether the database is encrypted"
  value       = aws_db_instance.postgres.storage_encrypted
}

output "db_kms_key_id" {
  description = "The KMS key ID used for encryption"
  value       = aws_db_instance.postgres.kms_key_id
}

# Monitoring Information
output "db_monitoring_role_arn" {
  description = "The ARN for the IAM role for enhanced monitoring"
  value       = var.monitoring_interval > 0 ? aws_iam_role.rds_monitoring[0].arn : null
}

output "db_performance_insights_enabled" {
  description = "Whether Performance Insights is enabled"
  value       = aws_db_instance.postgres.performance_insights_enabled
}

# Backup Information
output "db_backup_retention_period" {
  description = "The backup retention period"
  value       = aws_db_instance.postgres.backup_retention_period
}

output "db_backup_window" {
  description = "The backup window"
  value       = aws_db_instance.postgres.backup_window
}

output "db_maintenance_window" {
  description = "The maintenance window"
  value       = aws_db_instance.postgres.maintenance_window
}

# CloudWatch Alarms
output "cloudwatch_alarm_cpu_arn" {
  description = "The ARN of the CPU utilization CloudWatch alarm"
  value       = aws_cloudwatch_metric_alarm.database_cpu.arn
}

output "cloudwatch_alarm_connections_arn" {
  description = "The ARN of the database connections CloudWatch alarm"
  value       = aws_cloudwatch_metric_alarm.database_connections.arn
}

output "cloudwatch_alarm_free_storage_arn" {
  description = "The ARN of the free storage CloudWatch alarm"
  value       = aws_cloudwatch_metric_alarm.database_free_storage.arn
}

# Event Subscription
output "db_event_subscription_arn" {
  description = "The ARN of the database event subscription"
  value       = var.sns_topic_arn != null ? aws_db_event_subscription.default[0].arn : null
}

# Additional Outputs for Integration
output "db_engine" {
  description = "The database engine"
  value       = aws_db_instance.postgres.engine
}

output "db_engine_version" {
  description = "The database engine version"
  value       = aws_db_instance.postgres.engine_version
}

output "db_instance_class" {
  description = "The RDS instance class"
  value       = aws_db_instance.postgres.instance_class
}

output "db_hosted_zone_id" {
  description = "The canonical hosted zone ID of the DB instance"
  value       = aws_db_instance.postgres.hosted_zone_id
}

output "db_resource_id" {
  description = "The RDS Resource ID of this instance"
  value       = aws_db_instance.postgres.resource_id
}