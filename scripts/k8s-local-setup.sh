#!/bin/bash
# Local Kubernetes Setup Script for OmniPost
# Supports: minikube, kind, Docker Desktop Kubernetes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
K8S_DIR="$PROJECT_ROOT/k8s"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed. Please install it first."
        log_info "  macOS: brew install kubectl"
        log_info "  Linux: sudo apt-get install kubectl"
        log_info "  Windows: choco install kubernetes-cli"
        exit 1
    fi

    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker Desktop."
        exit 1
    fi

    log_info "Prerequisites check passed!"
}

# Detect Kubernetes provider
detect_k8s_provider() {
    if command -v minikube &> /dev/null && minikube status &> /dev/null; then
        echo "minikube"
    elif command -v kind &> /dev/null && kind get clusters 2>/dev/null | grep -q "omnipost"; then
        echo "kind"
    elif kubectl config current-context 2>/dev/null | grep -q "docker-desktop"; then
        echo "docker-desktop"
    else
        echo "none"
    fi
}

# Start minikube
start_minikube() {
    log_info "Starting minikube cluster..."

    if ! minikube status &> /dev/null; then
        minikube start \
            --cpus=4 \
            --memory=8192 \
            --driver=docker \
            --addons=ingress,metrics-server
    else
        log_info "Minikube is already running"
    fi

    # Enable required addons
    minikube addons enable ingress
    minikube addons enable metrics-server

    log_info "Minikube is ready!"
}

# Start kind
start_kind() {
    log_info "Starting kind cluster..."

    if ! kind get clusters 2>/dev/null | grep -q "omnipost"; then
        cat <<EOF | kind create cluster --name omnipost --config=-
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
  kubeadmConfigPatches:
  - |
    kind: InitConfiguration
    nodeRegistration:
      kubeletExtraArgs:
        node-labels: "ingress-ready=true"
  extraPortMappings:
  - containerPort: 80
    hostPort: 80
    protocol: TCP
  - containerPort: 443
    hostPort: 443
    protocol: TCP
  - containerPort: 30000
    hostPort: 30000
    protocol: TCP
EOF

        # Install ingress-nginx for kind
        kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

        # Wait for ingress to be ready
        kubectl wait --namespace ingress-nginx \
            --for=condition=ready pod \
            --selector=app.kubernetes.io/component=controller \
            --timeout=120s
    else
        log_info "Kind cluster 'omnipost' already exists"
    fi

    log_info "Kind cluster is ready!"
}

# Deploy application
deploy_app() {
    log_info "Deploying OmniPost to local Kubernetes..."

    # Apply local overlay
    kubectl apply -k "$K8S_DIR/overlays/local"

    # Wait for deployments
    log_info "Waiting for deployments to be ready..."
    kubectl wait --for=condition=available deployment/postgres-deployment -n omni-post --timeout=120s || true
    kubectl wait --for=condition=available deployment/redis-deployment -n omni-post --timeout=120s || true
    kubectl wait --for=condition=available deployment/api-deployment -n omni-post --timeout=180s || true

    log_info "Deployment complete!"
}

# Show status
show_status() {
    log_info "Cluster Status:"
    echo ""
    kubectl get pods -n omni-post
    echo ""
    kubectl get svc -n omni-post
    echo ""

    PROVIDER=$(detect_k8s_provider)
    case $PROVIDER in
        minikube)
            log_info "Access the API:"
            echo "  kubectl port-forward svc/api-service 3000:3000 -n omni-post"
            echo "  OR"
            echo "  minikube service api-service -n omni-post"
            ;;
        kind)
            log_info "Access the API:"
            echo "  kubectl port-forward svc/api-service 3000:3000 -n omni-post"
            ;;
        docker-desktop)
            log_info "Access the API:"
            echo "  kubectl port-forward svc/api-service 3000:3000 -n omni-post"
            ;;
    esac
}

# Cleanup
cleanup() {
    log_warn "Cleaning up OmniPost deployment..."
    kubectl delete namespace omni-post --ignore-not-found
    log_info "Cleanup complete!"
}

# Main
main() {
    case "${1:-setup}" in
        setup)
            check_prerequisites
            PROVIDER=$(detect_k8s_provider)

            if [ "$PROVIDER" = "none" ]; then
                log_warn "No Kubernetes cluster detected."
                log_info "Please start one of:"
                log_info "  minikube start"
                log_info "  kind create cluster --name omnipost"
                log_info "  Enable Kubernetes in Docker Desktop"
                exit 1
            fi

            log_info "Detected provider: $PROVIDER"
            deploy_app
            show_status
            ;;
        start-minikube)
            check_prerequisites
            start_minikube
            deploy_app
            show_status
            ;;
        start-kind)
            check_prerequisites
            start_kind
            deploy_app
            show_status
            ;;
        status)
            show_status
            ;;
        cleanup)
            cleanup
            ;;
        *)
            echo "Usage: $0 {setup|start-minikube|start-kind|status|cleanup}"
            echo ""
            echo "Commands:"
            echo "  setup         - Deploy to existing cluster"
            echo "  start-minikube - Start minikube and deploy"
            echo "  start-kind    - Start kind cluster and deploy"
            echo "  status        - Show deployment status"
            echo "  cleanup       - Remove OmniPost from cluster"
            exit 1
            ;;
    esac
}

main "$@"
