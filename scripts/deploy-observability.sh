#!/bin/bash

# Advanced Observability Deployment Script
# Deploy comprehensive monitoring, tracing, and business intelligence stack

set -euo pipefail

# Configuration
NAMESPACE="omni-post"
OBSERVABILITY_DIR="k8s/observability"
TIMEOUT="600s"

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

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl not found. Please install kubectl."
        exit 1
    fi

    # Check cluster connectivity
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster."
        exit 1
    fi

    # Check if namespace exists
    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log_info "Creating namespace: $NAMESPACE"
        kubectl create namespace "$NAMESPACE"
    fi

    log_success "Prerequisites check completed"
}

# Deploy observability stack
deploy_observability() {
    log_info "Deploying observability stack..."

    # Apply observability resources
    if [[ -d "$OBSERVABILITY_DIR" ]]; then
        log_info "Applying observability manifests from $OBSERVABILITY_DIR"
        kubectl apply -k "$OBSERVABILITY_DIR" --timeout="$TIMEOUT"
    else
        log_error "Observability directory not found: $OBSERVABILITY_DIR"
        exit 1
    fi

    log_success "Observability manifests applied"
}

# Wait for deployments to be ready
wait_for_deployments() {
    log_info "Waiting for observability components to be ready..."

    # List of deployments to wait for
    local deployments=(
        "jaeger-all-in-one"
        "elasticsearch"
        "grafana"
        "loki"
        "alertmanager"
    )

    for deployment in "${deployments[@]}"; do
        log_info "Waiting for deployment: $deployment"
        kubectl wait --for=condition=available deployment/$deployment \
            --namespace="$NAMESPACE" \
            --timeout="$TIMEOUT" || {
            log_error "Deployment $deployment failed to become ready"
            kubectl describe deployment "$deployment" -n "$NAMESPACE"
            return 1
        }
    done

    # Wait for DaemonSet (Promtail)
    log_info "Waiting for DaemonSet: promtail"
    kubectl wait --for=condition=ready pod \
        -l app=promtail \
        --namespace="$NAMESPACE" \
        --timeout="$TIMEOUT" || {
        log_error "DaemonSet promtail failed to become ready"
        return 1
    }

    log_success "All observability components are ready"
}

# Verify services
verify_services() {
    log_info "Verifying observability services..."

    local services=(
        "jaeger-service:16686"
        "grafana-service:3000"
        "loki-service:3100"
        "alertmanager-service:9093"
        "elasticsearch:9200"
    )

    for service in "${services[@]}"; do
        local service_name="${service%:*}"
        local port="${service#*:}"

        log_info "Checking service: $service_name"

        if kubectl get service "$service_name" -n "$NAMESPACE" &> /dev/null; then
            log_success "Service $service_name is available"
        else
            log_error "Service $service_name is not available"
        fi
    done
}

# Setup port forwarding
setup_port_forwarding() {
    log_info "Setting up port forwarding for local access..."

    # Port forwarding configurations
    declare -A port_forwards=(
        ["jaeger"]="jaeger-service:16686:16686"
        ["grafana"]="grafana-service:3000:3000"
        ["loki"]="loki-service:3100:3100"
        ["alertmanager"]="alertmanager-service:9093:9093"
    )

    log_info "Port forwarding commands:"
    for service in "${!port_forwards[@]}"; do
        local forward_config="${port_forwards[$service]}"
        local service_name="${forward_config%%:*}"
        local ports="${forward_config#*:}"

        echo "  kubectl port-forward -n $NAMESPACE svc/$service_name $ports"
    done

    log_info "Access URLs (after port forwarding):"
    echo "  Jaeger UI:      http://localhost:16686"
    echo "  Grafana:        http://localhost:3000 (admin/admin123)"
    echo "  Loki:           http://localhost:3100"
    echo "  Alertmanager:   http://localhost:9093"
}

# Configure Grafana datasources
configure_grafana() {
    log_info "Configuring Grafana datasources and dashboards..."

    # Wait for Grafana to be ready
    local grafana_pod=$(kubectl get pods -n "$NAMESPACE" -l app=grafana -o jsonpath='{.items[0].metadata.name}')

    if [[ -n "$grafana_pod" ]]; then
        log_info "Grafana pod: $grafana_pod"

        # Wait for Grafana to be fully ready
        kubectl wait --for=condition=ready pod/"$grafana_pod" \
            --namespace="$NAMESPACE" \
            --timeout="$TIMEOUT"

        log_success "Grafana is configured with provisioned datasources and dashboards"
    else
        log_warning "Could not find Grafana pod for configuration"
    fi
}

# Display deployment status
show_status() {
    log_info "Observability Stack Deployment Status:"

    echo ""
    echo "=== Pods Status ==="
    kubectl get pods -n "$NAMESPACE" -l component=observability

    echo ""
    echo "=== Services Status ==="
    kubectl get services -n "$NAMESPACE" -l component=observability

    echo ""
    echo "=== Ingress Status ==="
    kubectl get ingress -n "$NAMESPACE" -l component=observability

    echo ""
    echo "=== Persistent Volumes ==="
    kubectl get pvc -n "$NAMESPACE"
}

# Health check
health_check() {
    log_info "Performing health checks..."

    # Check if all pods are running
    local failed_pods=$(kubectl get pods -n "$NAMESPACE" -l component=observability \
        --field-selector=status.phase!=Running \
        -o jsonpath='{.items[*].metadata.name}')

    if [[ -n "$failed_pods" ]]; then
        log_warning "Some pods are not running: $failed_pods"
        return 1
    fi

    # Check if services are accessible
    local services=("jaeger-service" "grafana-service" "loki-service" "alertmanager-service")
    for service in "${services[@]}"; do
        if ! kubectl get endpoints "$service" -n "$NAMESPACE" \
            -o jsonpath='{.subsets[0].addresses[0].ip}' &> /dev/null; then
            log_warning "Service $service has no ready endpoints"
            return 1
        fi
    done

    log_success "Health checks passed"
    return 0
}

# Cleanup function
cleanup() {
    log_info "Cleaning up observability stack..."

    kubectl delete -k "$OBSERVABILITY_DIR" --ignore-not-found=true

    log_success "Observability stack cleaned up"
}

# Main deployment function
main() {
    local command="${1:-deploy}"

    case "$command" in
        "deploy")
            log_info "Starting observability stack deployment..."
            check_prerequisites
            deploy_observability
            wait_for_deployments
            verify_services
            configure_grafana
            show_status
            setup_port_forwarding

            if health_check; then
                log_success "🎉 Observability stack deployed successfully!"
                echo ""
                echo "Next steps:"
                echo "1. Run port forwarding commands to access dashboards locally"
                echo "2. Configure your applications with OpenTelemetry environment variables"
                echo "3. Import custom dashboards and configure alerts"
                echo "4. Set up notification channels for alerts"
            else
                log_error "Deployment completed with warnings. Check the logs above."
                exit 1
            fi
            ;;
        "cleanup")
            cleanup
            ;;
        "status")
            show_status
            health_check
            ;;
        "health")
            health_check
            ;;
        *)
            echo "Usage: $0 [deploy|cleanup|status|health]"
            echo ""
            echo "Commands:"
            echo "  deploy   - Deploy the complete observability stack (default)"
            echo "  cleanup  - Remove all observability components"
            echo "  status   - Show deployment status"
            echo "  health   - Perform health checks"
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"