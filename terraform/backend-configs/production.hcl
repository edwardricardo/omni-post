# Production Environment Backend Configuration
# This file configures the S3 backend for Terraform state management in production

bucket         = "omni-post-terraform-state-prod"
key            = "production/terraform.tfstate"
region         = "us-west-2"
encrypt        = true
dynamodb_table = "omni-post-terraform-state-lock-prod"

# Versioning and lifecycle
versioning = true

# Additional S3 backend configuration
server_side_encryption_configuration {
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = "alias/terraform-state-key"
      sse_algorithm     = "aws:kms"
    }
  }
}

# DynamoDB table for state locking
# The table should have a primary key named "LockID" of type String