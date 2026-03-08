#!/bin/bash

# SAAS Prototype Kubernetes Deployment Script
# Production-ready deployment automation with safety checks

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$K8S_DIR")"

# Default values
NAMESPACE="omni-post"
ENVIRONMENT="${ENVIRONMENT:-production}"
REGISTRY="${REGISTRY:-your-registry.com}"
VERSION="${VERSION:-1.2.0}"
DRY_RUN="${DRY_RUN:-false}"
SKIP_CONFIRMATION="${SKIP_CONFIRMATION:-false}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed or not in PATH"
        exit 1
    fi

    # Check kustomize
    if ! command -v kustomize &> /dev/null; then
        log_warning "kustomize not found, using kubectl's built-in kustomize"
    fi

    # Check cluster connectivity
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi

    # Check cluster version
    CLUSTER_VERSION=$(kubectl version --short --output=json | jq -r '.serverVersion.gitVersion' | sed 's/v//')
    MIN_VERSION="1.25.0"
    if ! printf '%s\n' "$MIN_VERSION" "$CLUSTER_VERSION" | sort -V -C; then
        log_error "Kubernetes cluster version $CLUSTER_VERSION is below minimum required $MIN_VERSION"
        exit 1
    fi

    log_success "Prerequisites check passed"
}

# Function to validate required secrets
check_secrets() {
    log_info "Checking required secrets configuration..."

    local secrets_file="$PROJECT_ROOT/env/secrets.env"
    if [[ ! -f "$secrets_file" ]]; then
        log_error "Secrets file not found at $secrets_file"
        log_info "Please create the secrets file with required values"
        exit 1
    fi

    # Check for placeholder values
    if grep -q "CHANGE_ME\|PLACEHOLDER" "$secrets_file"; then
        log_error "Found placeholder values in secrets file"
        log_info "Please update all placeholder values in $secrets_file"
        exit 1
    fi

    log_success "Secrets configuration validated"
}

# Function to build and push images
build_and_push_images() {
    log_info "Building and pushing container images..."

    local services=("api" "workers" "admin" "client")

    for service in "${services[@]}"; do
        local image_name="$REGISTRY/omnipost-$service:$VERSION"
        log_info "Building $image_name..."

        if [[ "$DRY_RUN" == "false" ]]; then
            docker build -t "$image_name" -f "apps/$service/Dockerfile" "$PROJECT_ROOT"
            docker push "$image_name"
        else
            log_info "[DRY RUN] Would build and push $image_name"
        fi
    done

    log_success "Container images built and pushed"
}

# Function to update kustomization with image references
update_image_references() {
    log_info "Updating image references in kustomization..."

    local kustomization_file="$K8S_DIR/kustomization.yaml"
    local temp_file=$(mktemp)

    # Update image tags in kustomization.yaml
    sed -e "s|omnipost-api|$REGISTRY/omnipost-api|g" \
        -e "s|omnipost-workers|$REGISTRY/omnipost-workers|g" \
        -e "s|omnipost-admin|$REGISTRY/omnipost-admin|g" \
        -e "s|omnipost-client|$REGISTRY/omnipost-client|g" \
        -e "s|newTag: \".*\"|newTag: \"$VERSION\"|g" \
        "$kustomization_file" > "$temp_file"

    if [[ "$DRY_RUN" == "false" ]]; then
        mv "$temp_file" "$kustomization_file"
    else
        log_info "[DRY RUN] Would update $kustomization_file"
        rm "$temp_file"
    fi

    log_success "Image references updated"
}

# Function to deploy infrastructure
deploy_infrastructure() {
    log_info "Deploying infrastructure components..."

    # Deploy namespace and basic resources first
    local infrastructure_resources=(
        "base/namespaces/namespace.yaml"
        "base/configmaps/app-config.yaml"
        "rbac/"
        "storage/"
        "security/"
    )

    for resource in "${infrastructure_resources[@]}"; do
        log_info "Deploying $resource..."
        if [[ "$DRY_RUN" == "false" ]]; then
            kubectl apply -f "$K8S_DIR/$resource" --server-side --force-conflicts
            # Wait a moment for resources to be created
            sleep 2
        else
            log_info "[DRY RUN] Would deploy $resource"
        fi
    done

    log_success "Infrastructure components deployed"
}

# Function to deploy applications
deploy_applications() {
    log_info "Deploying application services..."

    if [[ "$DRY_RUN" == "false" ]]; then
        # Use kustomize to deploy all resources
        kubectl apply -k "$K8S_DIR" --server-side --force-conflicts

        # Wait for deployments to be ready
        log_info "Waiting for deployments to be ready..."
        kubectl wait --for=condition=available --timeout=600s deployment --all -n "$NAMESPACE"
    else
        log_info "[DRY RUN] Would deploy all application services"
        kubectl kustomize "$K8S_DIR" | head -50
    fi

    log_success "Application services deployed"
}

# Function to verify deployment
verify_deployment() {
    log_info "Verifying deployment..."

    # Check pod status
    log_info "Checking pod status..."
    kubectl get pods -n "$NAMESPACE" -o wide

    # Check services
    log_info "Checking services..."
    kubectl get svc -n "$NAMESPACE"

    # Check ingress
    log_info "Checking ingress..."
    kubectl get ingress -n "$NAMESPACE"

    # Check HPA
    log_info "Checking autoscalers..."
    kubectl get hpa -n "$NAMESPACE"

    # Run health checks
    log_info "Running health checks..."
    local api_pod=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/component=api -o jsonpath='{.items[0].metadata.name}')
    if [[ -n "$api_pod" ]]; then
        if kubectl exec -n "$NAMESPACE" "$api_pod" -- curl -f http://localhost:3000/health > /dev/null 2>&1; then
            log_success "API health check passed"
        else
            log_warning "API health check failed"
        fi
    fi

    log_success "Deployment verification completed"
}

# Function to display deployment information
display_deployment_info() {
    log_info "Deployment Information:"
    echo "------------------------"
    echo "Namespace: $NAMESPACE"
    echo "Environment: $ENVIRONMENT"
    echo "Registry: $REGISTRY"
    echo "Version: $VERSION"
    echo ""

    # Get ingress information
    local ingress_ip=$(kubectl get ingress "$NAMESPACE-ingress" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "Pending")
    echo "Ingress IP: $ingress_ip"
    echo ""
    echo "URLs:"
    echo "  API:    https://api.omni-post.com"
    echo "  Client: https://app.omni-post.com"
    echo "  Admin:  https://admin.omni-post.com"
    echo ""

    # Get resource usage
    echo "Resource Usage:"
    kubectl top nodes 2>/dev/null || echo "  Metrics server not available"
    kubectl top pods -n "$NAMESPACE" 2>/dev/null || echo "  Pod metrics not available"
}

# Function to rollback deployment
rollback_deployment() {
    log_warning "Rolling back deployment..."

    # Get deployments
    local deployments=$(kubectl get deployments -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}')

    for deployment in $deployments; do
        log_info "Rolling back $deployment..."
        if [[ "$DRY_RUN" == "false" ]]; then
            kubectl rollout undo deployment/"$deployment" -n "$NAMESPACE"
        else
            log_info "[DRY RUN] Would rollback $deployment"
        fi
    done

    log_success "Rollback completed"
}

# Function to cleanup resources
cleanup_resources() {
    log_warning "Cleaning up resources..."

    if [[ "$SKIP_CONFIRMATION" == "false" ]]; then
        read -p "Are you sure you want to delete all resources in namespace $NAMESPACE? (yes/no): " confirm
        if [[ "$confirm" != "yes" ]]; then
            log_info "Cleanup cancelled"
            return
        fi
    fi

    if [[ "$DRY_RUN" == "false" ]]; then
        kubectl delete namespace "$NAMESPACE" --timeout=300s
    else
        log_info "[DRY RUN] Would delete namespace $NAMESPACE"
    fi

    log_success "Cleanup completed"
}

# Main deployment function
main() {
    log_info "Starting SAAS Prototype Kubernetes Deployment"
    log_info "Environment: $ENVIRONMENT"
    log_info "Dry Run: $DRY_RUN"

    case "${1:-deploy}" in
        "deploy")
            check_prerequisites
            check_secrets
            build_and_push_images
            update_image_references
            deploy_infrastructure
            deploy_applications
            verify_deployment
            display_deployment_info
            ;;
        "rollback")
            check_prerequisites
            rollback_deployment
            ;;
        "cleanup")
            check_prerequisites
            cleanup_resources
            ;;
        "verify")
            check_prerequisites
            verify_deployment
            display_deployment_info
            ;;
        "images")
            build_and_push_images
            ;;
        *)
            echo "Usage: $0 {deploy|rollback|cleanup|verify|images}"
            echo ""
            echo "Commands:"
            echo "  deploy   - Full deployment (default)"
            echo "  rollback - Rollback to previous version"
            echo "  cleanup  - Delete all resources"
            echo "  verify   - Verify deployment status"
            echo "  images   - Build and push images only"
            echo ""
            echo "Environment Variables:"
            echo "  REGISTRY - Container registry (default: your-registry.com)"
            echo "  VERSION  - Image version (default: 1.2.0)"
            echo "  DRY_RUN  - Dry run mode (default: false)"
            echo "  SKIP_CONFIRMATION - Skip confirmation prompts (default: false)"
            exit 1
            ;;
    esac
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --registry)
            REGISTRY="$2"
            shift 2
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        --namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --yes)
            SKIP_CONFIRMATION=true
            shift
            ;;
        --help)
            main help
            ;;
        *)
            COMMAND="$1"
            shift
            ;;
    esac
done

# Run main function
main "${COMMAND:-deploy}"