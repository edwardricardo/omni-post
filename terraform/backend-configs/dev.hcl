# Development Environment Backend Configuration
# This file configures the S3 backend for Terraform state management in development

bucket         = "omni-post-terraform-state-dev"
key            = "dev/terraform.tfstate"
region         = "us-west-2"
encrypt        = true
dynamodb_table = "omni-post-terraform-state-lock-dev"

# Versioning and lifecycle
versioning = true

# Additional S3 backend configuration
server_side_encryption_configuration {
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# DynamoDB table for state locking
# The table should have a primary key named "LockID" of type String