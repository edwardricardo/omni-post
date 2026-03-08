# Deployment

Local-first deployment with Docker and Kubernetes, validated before cloud deployment.

## Docker Compose (Development)

### Services

| Service    | Image                    | Port  | Purpose             |
| ---------- | ------------------------ | ----- | ------------------- |
| PostgreSQL | postgres:16              | 5432  | Primary database    |
| Redis      | redis:7                  | 6379  | Cache & job queues  |
| Prometheus | prom/prometheus:v2.48.1  | 9090  | Metrics collection  |
| Grafana    | grafana/grafana:11.2.2   | 3001  | Dashboards          |
| Jaeger     | jaegertracing/all-in-one | 16686 | Distributed tracing |

### Quick Start

```bash
# Start all infrastructure
docker compose up -d

# Verify services
docker compose ps

# View logs
docker compose logs -f

# Stop services
docker compose down

# Reset with fresh data
docker compose down -v
docker compose up -d
```

### Volumes

- `pgdata` - PostgreSQL data persistence
- `redisdata` - Redis data persistence
- `grafana-data` - Grafana dashboards
- `prometheus-data` - Metrics storage (30 days retention)

## Kubernetes (Local)

### Prerequisites

Install one of:

- **minikube**: `brew install minikube` / `choco install minikube`
- **kind**: `brew install kind` / `choco install kind`
- **Docker Desktop**: Enable Kubernetes in settings

### Directory Structure

```
k8s/
├── base/
│   ├── namespaces/          # Namespace definitions
│   ├── configmaps/          # Application configuration
│   ├── secrets/             # Sensitive data (templates)
│   └── templates/           # Reusable templates
├── services/
│   ├── api/                 # API deployment, service, HPA
│   ├── admin/               # Admin dashboard
│   ├── client/              # Client app
│   ├── workers/             # Background workers
│   ├── postgres/            # Database
│   └── redis/               # Cache
├── overlays/
│   ├── api/                 # API-specific patches
│   ├── admin/               # Admin-specific patches
│   ├── client/              # Client-specific patches
│   └── workers/             # Worker-specific patches
├── observability/
│   ├── prometheus-rules.yaml
│   ├── grafana-deployment.yaml
│   ├── alertmanager-deployment.yaml
│   ├── loki-deployment.yaml
│   └── jaeger-deployment.yaml
├── security/
│   ├── network-policies.yaml
│   └── pod-security-policy.yaml
├── rbac/
│   ├── serviceaccount.yaml
│   ├── clusterrole.yaml
│   └── clusterrolebinding.yaml
├── storage/
│   ├── postgres-pvc.yaml
│   └── redis-pvc.yaml
├── ingress/
│   └── ingress.yaml
└── kustomization.yaml
```

### Local Kubernetes Setup

**Automated Setup (Recommended)**:

```bash
# Start minikube and deploy
./scripts/k8s-local-setup.sh start-minikube

# Or start kind and deploy
./scripts/k8s-local-setup.sh start-kind

# Check status
./scripts/k8s-local-setup.sh status

# Cleanup
./scripts/k8s-local-setup.sh cleanup
```

**Manual Setup**:

```bash
# Using minikube
minikube start --cpus=4 --memory=8192 --driver=docker
minikube addons enable ingress
minikube addons enable metrics-server

# Using kind
kind create cluster --name omnipost
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

# Verify cluster
kubectl cluster-info
kubectl get nodes
```

### Deploy Application (Local Overlay)

```bash
# Deploy using local overlay (simplified for development)
kubectl apply -k k8s/overlays/local

# Wait for deployments
kubectl wait --for=condition=available deployment/postgres-deployment -n omni-post --timeout=120s
kubectl wait --for=condition=available deployment/redis-deployment -n omni-post --timeout=120s
kubectl wait --for=condition=available deployment/api-deployment -n omni-post --timeout=180s

# Access API
kubectl port-forward svc/api-service 3000:3000 -n omni-post
```

### Deploy Application (Full Production)

````bash
# Create secrets from template
cp env/secrets.env.example env/secrets.env
# Edit env/secrets.env with real values

# Deploy everything with kustomize
kubectl apply -k k8s/

### Using Kustomize

```bash
# Deploy everything with kustomize
kubectl apply -k k8s/

# Deploy specific overlay
kubectl apply -k k8s/overlays/api/

# Preview changes
kubectl kustomize k8s/ | less
````

### Verify Deployment

```bash
# Check all pods
kubectl get pods -n omni-post

# Check services
kubectl get svc -n omni-post

# Check ingress
kubectl get ingress -n omni-post

# View API logs
kubectl logs -f deployment/api-deployment -n omni-post

# Port forward for local access
kubectl port-forward svc/api-service 3000:3000 -n omni-post
```

## API Deployment Details

### Container Configuration

- **Image**: `omnipost-api:1.2.0`
- **Replicas**: 3 (with HPA)
- **Port**: 3000 (HTTP), 9090 (metrics)

### Init Containers

1. `wait-for-postgres` - Ensures database is ready
2. `wait-for-redis` - Ensures cache is ready
3. `run-migrations` - Runs Prisma migrations

### Health Checks

| Probe     | Path      | Initial Delay | Period |
| --------- | --------- | ------------- | ------ |
| Liveness  | `/health` | 30s           | 10s    |
| Readiness | `/ready`  | 10s           | 5s     |
| Startup   | `/health` | 15s           | 5s     |

### Resource Limits

| Resource | Request | Limit |
| -------- | ------- | ----- |
| CPU      | 200m    | 1000m |
| Memory   | 512Mi   | 2Gi   |

### Security Context

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1001
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]
```

## Observability Stack

### Prometheus

- Scrapes metrics from `/metrics` endpoint
- 30-day retention
- Custom recording rules in `prometheus-rules.yaml`

### Grafana

- Pre-configured dashboards
- Default credentials: `admin/admin123`
- Data sources: Prometheus, Loki

### Jaeger (Tracing)

- Distributed tracing for request flows
- UI available at port 16686

### Loki (Logging)

- Log aggregation from all pods
- Queryable via Grafana

## Environment Variables

### Required

```env
# Database
DATABASE_URL=postgresql://user:pass@postgres:5432/omnipostdb

# Redis
REDIS_URL=redis://redis:6379

# Authentication
JWT_ACCESS_SECRET=<32+ char secret>
JWT_REFRESH_SECRET=<32+ char secret>
```

### Optional

```env
# Server
PORT=3000
NODE_ENV=production

# Database Pool
DB_POOL_SIZE=20

# Rate Limiting
RATE_LIMIT_AUTH_REQUESTS=5
RATE_LIMIT_API_REQUESTS=60
```

## Troubleshooting

### Pod Not Starting

```bash
# Check events
kubectl describe pod <pod-name> -n omni-post

# Check init container logs
kubectl logs <pod-name> -c wait-for-postgres -n omni-post
```

### Database Connection Issues

```bash
# Test from within cluster
kubectl run -it --rm debug --image=postgres:16-alpine -n omni-post -- psql $DATABASE_URL
```

### Migration Failures

```bash
# Check migration logs
kubectl logs <pod-name> -c run-migrations -n omni-post

# Run migrations manually
kubectl exec -it deployment/api-deployment -n omni-post -- pnpm db:migrate
```

### Resource Constraints

```bash
# Check resource usage
kubectl top pods -n omni-post

# Check HPA status
kubectl get hpa -n omni-post
```

---

_Last updated: March 2026_
