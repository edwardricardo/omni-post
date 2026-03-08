# Kubernetes Deployment for Social Media CMS Platform

This directory contains production-ready Kubernetes manifests for deploying the omni-post social media content management platform.

## Architecture Overview

### Services Deployed

- **API Service** (`apps/api`): Fastify REST API with provider adapters
- **Workers Service** (`apps/workers`): BullMQ background job processors
- **Admin App** (`apps/admin`): Next.js admin dashboard (port 3100)
- **Client App** (`apps/client`): Next.js client interface (port 3200)
- **PostgreSQL**: Primary database with metrics exporter
- **Redis**: Cache and queue system with metrics exporter

### Key Features

✅ **Production Security**: Pod Security Standards (Restricted), NetworkPolicies, RBAC
✅ **High Availability**: Multi-replica deployments, Pod Disruption Budgets
✅ **Auto-scaling**: HPA with CPU/memory/custom metrics
✅ **Observability**: Prometheus metrics, health checks, structured logging
✅ **Service Mesh Ready**: Istio sidecar annotations and network policies
✅ **GitOps Ready**: ArgoCD sync waves and structured manifests
✅ **Resource Optimization**: Production-tuned resource limits and requests

## Directory Structure

```
k8s/
├── kustomization.yaml              # Main Kustomize configuration
├── base/                          # Base configurations
│   ├── namespaces/               # Namespace with quotas and limits
│   ├── configmaps/              # Application configuration
│   └── secrets/                 # Secrets templates
├── services/                    # Service-specific manifests
│   ├── api/                    # API service deployment, service, HPA
│   ├── workers/                # Workers deployment
│   ├── admin/                  # Admin frontend
│   ├── client/                 # Client frontend
│   ├── postgres/               # PostgreSQL database
│   └── redis/                  # Redis cache
├── storage/                    # Persistent volume claims
├── rbac/                      # Service accounts and RBAC
├── security/                  # Network policies, security constraints
├── ingress/                   # Ingress controller configuration
├── monitoring/                # ServiceMonitors and alerting rules
└── patches/                   # Environment-specific patches
```

## Deployment Guide

### Prerequisites

1. **Kubernetes Cluster**: v1.25+ with the following features:
   - Pod Security Standards
   - NetworkPolicy support
   - Persistent Volume provisioning
   - Metrics Server (for HPA)

2. **Required Operators/Controllers**:

   ```bash
   # Install nginx-ingress controller
   kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/cloud/deploy.yaml

   # Install cert-manager for TLS certificates
   kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.1/cert-manager.yaml

   # Install Prometheus Operator (for monitoring)
   kubectl apply -f https://github.com/prometheus-operator/prometheus-operator/releases/download/v0.68.0/bundle.yaml
   ```

3. **Container Images**: Build and push images to your registry:

   ```bash
   # Build and tag images
   docker build -t your-registry.com/omnipost-api:1.2.0 -f apps/api/Dockerfile .
   docker build -t your-registry.com/omnipost-workers:1.2.0 -f apps/workers/Dockerfile .
   docker build -t your-registry.com/omnipost-admin:1.2.0 -f apps/admin/Dockerfile .
   docker build -t your-registry.com/omnipost-client:1.2.0 -f apps/client/Dockerfile .

   # Push to registry
   docker push your-registry.com/omnipost-api:1.2.0
   docker push your-registry.com/omnipost-workers:1.2.0
   docker push your-registry.com/omnipost-admin:1.2.0
   docker push your-registry.com/omnipost-client:1.2.0
   ```

### Environment Configuration

1. **Create environment files**:

   ```bash
   mkdir -p env/

   # Production environment variables
   cat > env/production.env << EOF
   NODE_ENV=production
   LOG_LEVEL=info
   API_RATE_LIMIT=1000
   WORKER_CONCURRENCY=10
   EOF

   # Secrets (use proper secret management in production)
   cat > env/secrets.env << EOF
   DATABASE_URL=postgresql://postgres:CHANGE_ME@postgres-service:5432/omnipostdb
   REDIS_URL=redis://:CHANGE_ME@redis-service:6379
   JWT_SECRET=CHANGE_ME_TO_SECURE_SECRET
   # Add other secrets...
   EOF
   ```

2. **Update image references in kustomization.yaml**:
   ```yaml
   images:
     - name: omnipost-api
       newName: your-registry.com/omnipost-api
       newTag: "1.2.0"
     - name: omnipost-workers
       newName: your-registry.com/omnipost-workers
       newTag: "1.2.0"
     # ... etc
   ```

### Deployment Steps

1. **Deploy infrastructure components**:

   ```bash
   # Create namespace and basic resources
   kubectl apply -k k8s/ --server-side --force-conflicts
   ```

2. **Update secrets with real values**:

   ```bash
   # Edit secrets with actual values
   kubectl edit secret app-secrets -n omni-post
   kubectl edit secret registry-secret -n omni-post
   kubectl edit secret tls-secret -n omni-post
   ```

3. **Apply the complete deployment**:

   ```bash
   kubectl apply -k k8s/ --server-side --force-conflicts
   ```

4. **Verify deployment**:

   ```bash
   # Check pod status
   kubectl get pods -n omni-post

   # Check services
   kubectl get svc -n omni-post

   # Check ingress
   kubectl get ingress -n omni-post

   # View logs
   kubectl logs -f deployment/api-deployment -n omni-post
   ```

### DNS Configuration

Update your DNS records to point to the ingress controller:

```
api.omni-post.com     -> <INGRESS_CONTROLLER_IP>
app.omni-post.com     -> <INGRESS_CONTROLLER_IP>
admin.omni-post.com   -> <INGRESS_CONTROLLER_IP>
```

## Monitoring and Observability

### Prometheus Metrics

The deployment includes comprehensive metrics collection:

- **Application Metrics**: API response times, error rates, business metrics
- **Infrastructure Metrics**: CPU, memory, disk usage
- **Database Metrics**: Connection pools, query performance
- **Queue Metrics**: Job processing rates, queue backlogs

Access metrics via:

```bash
# Port-forward to view metrics locally
kubectl port-forward svc/api-service 3000:3000 -n omni-post
curl http://localhost:3000/metrics
```

### Health Checks

All services include comprehensive health checks:

- **Startup Probes**: Ensure services start correctly
- **Readiness Probes**: Control traffic routing
- **Liveness Probes**: Restart unhealthy containers

### Alerting Rules

Pre-configured alerts for:

- High error rates (>10% 5xx responses)
- High response times (>1s 95th percentile)
- Resource usage (CPU >80%, Memory >90%)
- Database connection issues
- Queue backlog accumulation
- Pod crash loops

## Security Features

### Pod Security Standards

All pods run with the **Restricted** security profile:

- Non-root containers
- Read-only root filesystem (where possible)
- Dropped Linux capabilities
- Seccomp and AppArmor profiles

### Network Security

**Default Deny**: All traffic blocked by default
**Granular Policies**: Only required communication allowed:

- API ↔ PostgreSQL/Redis
- Frontend ↔ API
- Ingress → Frontend services
- External HTTPS (for social media APIs)
- Monitoring traffic

### RBAC

Least-privilege service accounts with minimal required permissions.

### Secrets Management

- Kubernetes secrets with proper annotations for external secret operators
- Registry credentials for private image repositories
- TLS certificates for HTTPS termination

## Scaling and Performance

### Horizontal Pod Autoscaling

**API Service**: 3-10 replicas based on CPU/memory/request rate
**Frontend Apps**: 2-8 replicas based on CPU/memory
**Workers**: 2+ replicas (manual scaling based on queue depth)

### Resource Optimization

Production-tuned resource requests and limits:

- API: 300m CPU / 768Mi memory (requests)
- Workers: 200m CPU / 512Mi memory (requests)
- Frontend: 150m CPU / 384Mi memory (requests)
- Database: 500m CPU / 1Gi memory (requests)

### Storage

- **PostgreSQL**: 50Gi SSD storage with regional replication
- **Redis**: 10Gi SSD storage for persistence
- **Fast SSD StorageClass** optimized for database workloads

## Troubleshooting

### Common Issues

1. **Pod Startup Failures**:

   ```bash
   kubectl describe pod <pod-name> -n omni-post
   kubectl logs <pod-name> -n omni-post --previous
   ```

2. **Network Connectivity**:

   ```bash
   # Test from within cluster
   kubectl run debug --image=curlimages/curl -it --rm -- sh
   curl http://api-service.omni-post.svc.cluster.local:3000/health
   ```

3. **Database Connectivity**:

   ```bash
   kubectl exec -it deployment/postgres-deployment -n omni-post -- psql -U postgres -d omnipostdb
   ```

4. **Redis Connectivity**:
   ```bash
   kubectl exec -it deployment/redis-deployment -n omni-post -- redis-cli ping
   ```

### Debugging Commands

```bash
# View all resources
kubectl get all -n omni-post

# Check resource quotas
kubectl describe resourcequota -n omni-post

# View events
kubectl get events -n omni-post --sort-by='.lastTimestamp'

# Check network policies
kubectl get networkpolicy -n omni-post

# View HPA status
kubectl get hpa -n omni-post

# Check ingress configuration
kubectl describe ingress omni-post-ingress -n omni-post
```

## Production Checklist

- [ ] Container images built and pushed to production registry
- [ ] Secrets updated with production values
- [ ] DNS records configured
- [ ] SSL certificates installed
- [ ] Monitoring and alerting configured
- [ ] Backup procedures in place for PostgreSQL
- [ ] Network policies tested
- [ ] Security scanning completed
- [ ] Load testing performed
- [ ] Disaster recovery plan documented

## GitOps Integration

The manifests are structured for GitOps workflows:

- **ArgoCD Sync Waves**: Proper resource ordering
- **Kustomize**: Environment-specific overlays
- **Structured Labels**: Consistent resource labeling
- **Health Checks**: Application-aware health status

For ArgoCD deployment:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: omni-post
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/omni-post
    targetRevision: main
    path: k8s
  destination:
    server: https://kubernetes.default.svc
    namespace: omni-post
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
```

This deployment provides a production-ready, secure, and scalable foundation for your social media CMS platform.
