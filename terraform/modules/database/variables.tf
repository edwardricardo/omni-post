# Database Module Variables

variable "project_name" {
  description = "Name of the project"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC"
  type        = string
}

variable "database_subnet_ids" {
  description = "List of subnet IDs for the database"
  type        = list(string)
}

variable "security_group_ids" {
  description = "List of security group IDs for the database"
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = "List of CIDR blocks allowed to access the database"
  type        = list(string)
  default     = []
}

# Database Configuration
variable "db_instance_class" {
  description = "The instance class for the RDS instance"
  type        = string
  default     = "db.t3.medium"
}

variable "db_allocated_storage" {
  description = "The allocated storage in gigabytes"
  type        = number
  default     = 100
}

variable "db_max_allocated_storage" {
  description = "The upper limit to which Amazon RDS can automatically scale the storage"
  type        = number
  default     = 1000
}

variable "db_name" {
  description = "The name of the database"
  type        = string
  default     = "omnipostdb"
}

variable "db_username" {
  description = "Username for the master DB user"
  type        = string
  default     = "postgres"
}

variable "db_password" {
  description = "Password for the master DB user"
  type        = string
  sensitive   = true
  default     = ""
}

# High Availability
variable "multi_az" {
  description = "Specifies if the RDS instance is multi-AZ"
  type        = bool
  default     = true
}

variable "availability_zone" {
  description = "The AZ for the RDS instance (only used if multi_az is false)"
  type        = string
  default     = null
}

variable "create_read_replica" {
  description = "Create a read replica of the database"
  type        = bool
  default     = false
}

variable "replica_instance_class" {
  description = "The instance class for the read replica"
  type        = string
  default     = "db.t3.medium"
}

# Backup Configuration
variable "backup_retention_period" {
  description = "The days to retain backups for"
  type        = number
  default     = 7
}

variable "backup_window" {
  description = "The daily time range (in UTC) during which automated backups are created"
  type        = string
  default     = "03:00-04:00"
}

variable "maintenance_window" {
  description = "The weekly time range for system maintenance"
  type        = string
  default     = "sun:04:00-sun:05:00"
}

# Security
variable "storage_encrypted" {
  description = "Specifies whether the DB instance is encrypted"
  type        = bool
  default     = true
}

variable "kms_key_id" {
  description = "The ARN for the KMS encryption key"
  type        = string
  default     = null
}

# Monitoring
variable "monitoring_interval" {
  description = "The interval for collecting enhanced monitoring metrics"
  type        = number
  default     = 60
  validation {
    condition     = contains([0, 1, 5, 10, 15, 30, 60], var.monitoring_interval)
    error_message = "Monitoring interval must be one of: 0, 1, 5, 10, 15, 30, 60."
  }
}

variable "performance_insights_enabled" {
  description = "Specifies whether Performance Insights are enabled"
  type        = bool
  default     = true
}

variable "sns_topic_arn" {
  description = "SNS topic ARN for database notifications"
  type        = string
  default     = null
}

# Backup Plan Integration
variable "enable_backup_plan" {
  description = "Enable AWS Backup plan for the database"
  type        = bool
  default     = false
}

variable "backup_plan_id" {
  description = "AWS Backup plan ID"
  type        = string
  default     = null
}

variable "backup_service_role_arn" {
  description = "AWS Backup service role ARN"
  type        = string
  default     = null
}

variable "tags" {
  description = "A map of tags to assign to the resource"
  type        = map(string)
  default     = {}
}