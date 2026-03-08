# OmniPost Documentation

## Project Overview

**OmniPost** is a multi-channel social media content management system (CMS) that enables users to create content once and publish it across multiple social platforms.

### Key Features

- **Multi-Platform Publishing**: X/Twitter, Instagram, Facebook, TikTok, YouTube
- **AI Content Generation**: GPT-4, Google Gemini, Perplexity integration (rule-based heuristics for optimization)
- **Analytics Dashboard**: Cross-platform performance metrics
- **Scheduling**: Optimal timing with queue management
- **Team Collaboration**: Role-based access control (RBAC)
- **Multi-Factor Authentication**: TOTP with backup codes

### Target Users

- Social media managers
- Marketing teams
- Content creators
- Agencies managing multiple clients

## Quick Links

| Document                                   | Description                                 |
| ------------------------------------------ | ------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)       | Clean + Hexagonal architecture patterns     |
| [GETTING_STARTED.md](./GETTING_STARTED.md) | Development environment setup               |
| [API.md](./API.md)                         | REST API endpoint documentation             |
| [DATABASE.md](./DATABASE.md)               | Prisma schema and data models               |
| [PROVIDERS.md](./PROVIDERS.md)             | Social media provider integrations          |
| [SECURITY.md](./SECURITY.md)               | Authentication, authorization, and security |
| [DEPLOYMENT.md](./DEPLOYMENT.md)           | Docker and Kubernetes deployment            |
| [CONTRIBUTING.md](./CONTRIBUTING.md)       | Code standards and contribution guidelines  |

## Technology Stack

### Backend

| Technology | Version | Purpose          |
| ---------- | ------- | ---------------- |
| Node.js    | ES2022  | Runtime          |
| TypeScript | 5.9.2   | Language         |
| Fastify    | 5.6.1   | Web framework    |
| Prisma     | 7.4.1   | Database ORM     |
| PostgreSQL | 16      | Primary database |
| Redis      | 7       | Caching & queues |
| BullMQ     | 5.58.9  | Job processing   |

### Frontend

| Technology   | Version                    | Purpose               |
| ------------ | -------------------------- | --------------------- |
| Next.js      | 16.1.6                     | React framework       |
| React        | 19.2.4                     | UI library            |
| Tailwind CSS | 4.2.1                      | Styling               |
| Radix UI     | 1.4.3 (unified `radix-ui`) | Component primitives  |
| React Query  | 5.90.2                     | Data fetching         |
| Storybook    | 10.2.13                    | Component development |

### Infrastructure

| Technology     | Purpose          |
| -------------- | ---------------- |
| Docker         | Containerization |
| Kubernetes     | Orchestration    |
| Prometheus     | Metrics          |
| Grafana        | Dashboards       |
| GitHub Actions | CI/CD            |

## Project Structure

```
omni-post/
├── apps/
│   ├── api/          # Fastify REST API (Port 3000)
│   ├── admin/        # Admin Dashboard (Port 3100)
│   ├── client/       # Client App (Port 3200)
│   └── workers/      # Background job processors
├── packages/
│   ├── shared/       # Shared types & utilities
│   ├── ports/        # Interface definitions
│   ├── adapters/     # Infrastructure adapters
│   ├── providers/    # Social media adapters
│   └── ui/           # Shared UI components
├── infra/
│   └── prisma/       # Database schema & migrations
├── k8s/              # Kubernetes manifests
└── docs/             # Documentation (you are here)
```

## Getting Started

```bash
# Clone and install
git clone <repository-url>
cd omni-post
pnpm install

# Start infrastructure
docker compose up -d

# Run migrations
pnpm db:migrate

# Start development
pnpm dev:api      # API server
pnpm dev:admin    # Admin dashboard
```

See [GETTING_STARTED.md](./GETTING_STARTED.md) for detailed setup instructions.

## Performance Testing

OmniPost includes a comprehensive performance testing suite in the `performance/` directory.

### Prerequisites

- Docker running (`pnpm db:up`)
- API server running (`pnpm dev:api`)
- k6 installed locally (for load tests without Docker)

### Local k6 Installation

```bash
# macOS
brew install k6

# Ubuntu/Debian
sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Windows
winget install k6
```

### Running Tests Locally

```bash
# Database stress test (PostgreSQL — ~7 minutes: 3 scenarios)
pnpm perf:db

# Memory leak detection (~1 minute)
pnpm perf:memory

# Capture performance baseline (requires API running on :3000)
pnpm perf:baseline

# Compare with stored baseline (regression detection)
pnpm perf:regression

# k6 load test via Docker (no local k6 install needed)
pnpm perf:docker:load     # Standard load test
pnpm perf:docker:stress   # Stress test
pnpm perf:docker:api      # API performance scenarios
```

### Performance Thresholds

Defined in `performance/config/performance-thresholds.json`:

| Metric                | Threshold   |
| --------------------- | ----------- |
| API P95 response time | < 200ms     |
| API P99 response time | < 500ms     |
| API throughput        | > 1,000 RPS |
| API error rate        | < 1%        |
| DB query P95          | < 100ms     |
| Memory heap max       | < 2 GB      |
| Cache hit rate        | > 80%       |

### CI/CD Integration

Performance tests run automatically via GitHub Actions:

- **On push to `main`** (when `apps/api/src/**` or `performance/**` changes): full suite
- **Manual trigger**: select a specific k6 scenario from the Actions tab

Results are uploaded as artifacts (30-day retention) and can be downloaded from the GitHub Actions run.

### k6 Scenarios

Located in `performance/k6/scenarios/`:

| Scenario                 | Description                      |
| ------------------------ | -------------------------------- |
| `api-performance.js`     | General API endpoint performance |
| `auth-flow.js`           | Authentication and session flows |
| `posting-workflow.js`    | Post creation and publishing     |
| `analytics-dashboard.js` | Analytics data retrieval         |
| `stress-test.js`         | High-concurrency stress test     |

## License

Proprietary - All rights reserved.

---

_Last updated: February 2026_
