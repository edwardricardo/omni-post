#!/bin/bash
# Terraform Deployment Script for OmniPost Infrastructure
# This script provides a safe and automated way to deploy infrastructure across environments

set -euo pipefail

# Default values
ENVIRONMENT=""
ACTION="plan"
AUTO_APPROVE=false
DESTROY_CONFIRMATION=""
TF_LOG="INFO"
SKIP_INIT=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Usage information
usage() {
    cat << EOF
Usage: $0 -e ENVIRONMENT [OPTIONS]

Deploy OmniPost infrastructure using Terraform

REQUIRED:
  -e, --environment    Environment to deploy (dev, staging, production)

OPTIONS:
  -a, --action         Action to perform (plan, apply, destroy) [default: plan]
  --auto-approve       Auto-approve terraform apply (use with caution)
  --skip-init          Skip terraform init
  --tf-log            Terraform log level (TRACE, DEBUG, INFO, WARN, ERROR) [default: INFO]
  -h, --help          Show this help message

EXAMPLES:
  $0 -e dev                           # Plan deployment for dev environment
  $0 -e dev -a apply                  # Apply changes to dev environment
  $0 -e production -a apply           # Apply changes to production (requires confirmation)
  $0 -e dev -a destroy                # Destroy dev infrastructure (requires confirmation)

SECURITY NOTES:
  - Production deployments require manual confirmation
  - Destroy operations require typing 'DESTROY' to confirm
  - Auto-approve is disabled for production and destroy operations
EOF
    exit 1
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -e|--environment)
                ENVIRONMENT="$2"
                shift 2
                ;;
            -a|--action)
                ACTION="$2"
                shift 2
                ;;
            --auto-approve)
                AUTO_APPROVE=true
                shift
                ;;
            --skip-init)
                SKIP_INIT=true
                shift
                ;;
            --tf-log)
                TF_LOG="$2"
                shift 2
                ;;
            -h|--help)
                usage
                ;;
            *)
                print_error "Unknown option: $1"
                usage
                ;;
        esac
    done

    # Validate required arguments
    if [[ -z "$ENVIRONMENT" ]]; then
        print_error "Environment is required"
        usage
    fi

    # Validate environment
    if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|production)$ ]]; then
        print_error "Invalid environment. Must be one of: dev, staging, production"
        exit 1
    fi

    # Validate action
    if [[ ! "$ACTION" =~ ^(plan|apply|destroy|validate|fmt|init)$ ]]; then
        print_error "Invalid action. Must be one of: plan, apply, destroy, validate, fmt, init"
        exit 1
    fi

    # Security checks
    if [[ "$ENVIRONMENT" == "production" && "$AUTO_APPROVE" == true && "$ACTION" == "apply" ]]; then
        print_error "Auto-approve is not allowed for production deployments"
        exit 1
    fi

    if [[ "$ACTION" == "destroy" && "$AUTO_APPROVE" == true ]]; then
        print_error "Auto-approve is not allowed for destroy operations"
        exit 1
    fi
}

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."

    # Check if terraform is installed
    if ! command -v terraform &> /dev/null; then
        print_error "Terraform is not installed or not in PATH"
        exit 1
    fi

    # Check if aws cli is installed
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed or not in PATH"
        exit 1
    fi

    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials not configured or invalid"
        exit 1
    fi

    # Check terraform version
    TF_VERSION=$(terraform version -json | jq -r '.terraform_version')
    print_status "Using Terraform version: $TF_VERSION"

    # Check if required files exist
    if [[ ! -f "environments/${ENVIRONMENT}/terraform.tfvars" ]]; then
        print_error "Environment configuration file not found: environments/${ENVIRONMENT}/terraform.tfvars"
        exit 1
    fi

    if [[ ! -f "backend-configs/${ENVIRONMENT}.hcl" ]]; then
        print_error "Backend configuration file not found: backend-configs/${ENVIRONMENT}.hcl"
        exit 1
    fi

    print_success "Prerequisites check passed"
}

# Initialize Terraform
init_terraform() {
    if [[ "$SKIP_INIT" == true ]]; then
        print_status "Skipping terraform init"
        return
    fi

    print_status "Initializing Terraform for $ENVIRONMENT environment..."

    # Set up environment variables
    export TF_LOG="$TF_LOG"
    export TF_LOG_PATH="logs/terraform-${ENVIRONMENT}-$(date +%Y%m%d-%H%M%S).log"

    # Create logs directory
    mkdir -p logs

    # Initialize with backend configuration
    terraform init \
        -backend-config="backend-configs/${ENVIRONMENT}.hcl" \
        -upgrade \
        -reconfigure

    print_success "Terraform initialization completed"
}

# Validate Terraform configuration
validate_terraform() {
    print_status "Validating Terraform configuration..."

    terraform validate
    terraform fmt -check -recursive

    print_success "Terraform validation completed"
}

# Plan Terraform deployment
plan_terraform() {
    print_status "Planning Terraform deployment for $ENVIRONMENT environment..."

    # Create plan file
    PLAN_FILE="plans/${ENVIRONMENT}-$(date +%Y%m%d-%H%M%S).tfplan"
    mkdir -p plans

    terraform plan \
        -var-file="environments/${ENVIRONMENT}/terraform.tfvars" \
        -out="$PLAN_FILE" \
        -detailed-exitcode

    PLAN_EXIT_CODE=$?

    if [[ $PLAN_EXIT_CODE -eq 0 ]]; then
        print_success "No changes required"
    elif [[ $PLAN_EXIT_CODE -eq 2 ]]; then
        print_success "Plan created successfully: $PLAN_FILE"

        # Show plan summary
        terraform show -no-color "$PLAN_FILE" | head -50
        print_status "Full plan saved to: $PLAN_FILE"
    else
        print_error "Terraform plan failed"
        exit 1
    fi
}

# Apply Terraform changes
apply_terraform() {
    print_status "Applying Terraform changes for $ENVIRONMENT environment..."

    # Production safety check
    if [[ "$ENVIRONMENT" == "production" ]]; then
        print_warning "You are about to apply changes to PRODUCTION environment!"
        read -p "Are you sure you want to continue? (yes/no): " confirmation
        if [[ "$confirmation" != "yes" ]]; then
            print_status "Deployment cancelled"
            exit 0
        fi
    fi

    # Build apply command
    APPLY_CMD="terraform apply -var-file=environments/${ENVIRONMENT}/terraform.tfvars"

    if [[ "$AUTO_APPROVE" == true ]]; then
        APPLY_CMD="$APPLY_CMD -auto-approve"
    fi

    # Execute apply
    eval "$APPLY_CMD"

    if [[ $? -eq 0 ]]; then
        print_success "Terraform apply completed successfully"

        # Save outputs
        print_status "Saving Terraform outputs..."
        terraform output -json > "outputs/${ENVIRONMENT}-outputs-$(date +%Y%m%d-%H%M%S).json"

        # Generate kubeconfig
        if terraform output cluster_id &> /dev/null; then
            generate_kubeconfig
        fi
    else
        print_error "Terraform apply failed"
        exit 1
    fi
}

# Destroy Terraform infrastructure
destroy_terraform() {
    print_error "WARNING: This will DESTROY all infrastructure in the $ENVIRONMENT environment!"
    print_error "This action is IRREVERSIBLE and will result in DATA LOSS!"

    echo ""
    read -p "Type 'DESTROY' to confirm destruction of $ENVIRONMENT environment: " confirmation

    if [[ "$confirmation" != "DESTROY" ]]; then
        print_status "Destruction cancelled"
        exit 0
    fi

    print_status "Destroying infrastructure for $ENVIRONMENT environment..."

    terraform destroy \
        -var-file="environments/${ENVIRONMENT}/terraform.tfvars" \
        -auto-approve

    if [[ $? -eq 0 ]]; then
        print_success "Infrastructure destroyed successfully"
    else
        print_error "Terraform destroy failed"
        exit 1
    fi
}

# Generate kubeconfig
generate_kubeconfig() {
    print_status "Generating kubeconfig for EKS cluster..."

    CLUSTER_NAME=$(terraform output -raw cluster_id 2>/dev/null || echo "")
    REGION=$(terraform output -raw region 2>/dev/null || echo "us-west-2")

    if [[ -n "$CLUSTER_NAME" ]]; then
        aws eks update-kubeconfig \
            --region "$REGION" \
            --name "$CLUSTER_NAME" \
            --alias "${ENVIRONMENT}-${CLUSTER_NAME}"

        print_success "Kubeconfig updated for cluster: $CLUSTER_NAME"
        print_status "Use 'kubectl config use-context ${ENVIRONMENT}-${CLUSTER_NAME}' to switch context"
    else
        print_warning "EKS cluster not found in outputs, skipping kubeconfig generation"
    fi
}

# Create backup of Terraform state
backup_state() {
    print_status "Creating backup of Terraform state..."

    mkdir -p backups
    BACKUP_FILE="backups/${ENVIRONMENT}-terraform.tfstate-$(date +%Y%m%d-%H%M%S)"

    terraform state pull > "$BACKUP_FILE"

    print_success "State backup created: $BACKUP_FILE"
}

# Main execution
main() {
    # Change to terraform directory
    cd "$(dirname "$0")/.."

    print_status "Starting Terraform deployment for $ENVIRONMENT environment"
    print_status "Action: $ACTION"
    print_status "Auto-approve: $AUTO_APPROVE"

    # Execute steps based on action
    case $ACTION in
        init)
            check_prerequisites
            init_terraform
            ;;
        validate)
            check_prerequisites
            validate_terraform
            ;;
        fmt)
            terraform fmt -recursive
            print_success "Terraform formatting completed"
            ;;
        plan)
            check_prerequisites
            init_terraform
            validate_terraform
            plan_terraform
            ;;
        apply)
            check_prerequisites
            init_terraform
            validate_terraform
            backup_state
            apply_terraform
            ;;
        destroy)
            check_prerequisites
            init_terraform
            backup_state
            destroy_terraform
            ;;
        *)
            print_error "Invalid action: $ACTION"
            usage
            ;;
    esac

    print_success "Deployment script completed successfully"
}

# Parse arguments and run main
parse_args "$@"
main