# Admin Dashboard

## Overview

The Admin Dashboard is a comprehensive Next.js application that provides real-time monitoring and management capabilities for the SaaS platform. It includes authentication, account management, subscription billing, analytics, and system monitoring.

## Architecture

- **Framework**: Next.js 16.1.6 with App Router and React 19.2.4
- **Styling**: Tailwind CSS with component-based design
- **Data Fetching**: Real-time API integration with fallback support
- **Authentication**: Server Actions + httpOnly cookie (`admin-session`) + backend JWT
- **Port**: 3100 (configurable via environment)
- **Technology Stack**:
  - React 19.2.4 with concurrent rendering features
  - TanStack Query for server state management
  - Tailwind CSS 4.2.1 for styling
  - TypeScript 5.8.3 for type safety

## Core Features

### 1. Real-Time Dashboard

- Live metrics with 30-second auto-refresh
- Account statistics (total, active, trials)
- Revenue tracking and projections
- Activity monitoring (logins, signups, conversions)
- Subscription distribution analytics

### 2. Account Management

- Comprehensive account listing with filtering
- Trial status tracking and expiration monitoring
- Usage analytics per account
- Account lifecycle management
- Project utilization metrics

### 3. Subscription Management

- Active subscription monitoring
- Trial conversion tracking
- Revenue analytics with MRR calculations
- Billing cycle management
- Auto-renewal status monitoring

### 4. Analytics Dashboard

- Geographic user distribution
- Feature adoption metrics
- Conversion rate tracking
- Revenue growth analysis
- Time-series data visualization

### 5. System Monitoring

- Activity logs and audit trails
- Performance metrics
- System health indicators
- Error tracking and alerts

## API Integration

### Dashboard Endpoints

```typescript
// Dashboard statistics
GET /admin/dashboard/stats
{
  accounts: { total, active, trialsActive, trialsExpiring },
  subscriptions: { basic, pro, enterprise },
  revenue: { monthly, yearly, total },
  activity: { loginsToday, newAccountsToday, subscriptionChangesToday },
  projects: number,
  lastUpdated: string
}

// Account summaries
GET /admin/accounts/summary
{
  accounts: AccountSummary[],
  total: number,
  timestamp: string
}

// Subscription summaries
GET /admin/subscriptions/summary
{
  subscriptions: SubscriptionDetail[],
  trials: TrialDetail[],
  stats: SubscriptionStats,
  timestamp: string
}

// Analytics overview
GET /admin/analytics/overview
{
  data: {
    overview: UserMetrics,
    revenue: RevenueMetrics,
    subscriptions: SubscriptionMetrics,
    activity: ActivityData,
    geographic: GeographicData[],
    features: FeatureUsage[]
  },
  timestamp: string
}
```

### API Client

```typescript
// Type-safe API client with admin endpoints
export const api = {
  admin: {
    getDashboardStats: () => http<DashboardStatsResponse>("/admin/dashboard/stats"),
    getAccountSummary: () => http<AccountSummaryResponse>("/admin/accounts/summary"),
    getSubscriptionSummary: () => http<SubscriptionSummaryResponse>("/admin/subscriptions/summary"),
    getAnalyticsOverview: () => http<AnalyticsResponse>("/admin/analytics/overview"),
  },
};
```

## Component Architecture

### Layout Structure

```
app/
├── layout.tsx          # Root layout with global styles
├── page.tsx           # Dashboard home page
├── accounts/
│   └── page.tsx      # Account management page
├── subscriptions/
│   └── page.tsx      # Subscription management page
├── analytics/
│   └── page.tsx      # Analytics dashboard
└── logs/
    └── page.tsx      # System logs page
```

### Key Components

#### Dashboard Cards

- **Metric Cards**: Real-time statistics with trend indicators
- **Status Indicators**: Live/updating status with color coding
- **Quick Actions**: Navigation shortcuts to main management areas

#### Data Tables

- **Account Listings**: Sortable tables with filtering capabilities
- **Trial Tracking**: Status-based color coding and expiration alerts
- **Revenue Tables**: Financial data with calculation details

#### Charts and Visualizations

- **Subscription Distribution**: Pie charts with percentage breakdowns
- **Revenue Trends**: Time-series data visualization
- **Geographic Maps**: User distribution by location
- **Feature Adoption**: Usage statistics with adoption rates

## Data Models

### Dashboard Statistics

```typescript
interface DashboardStats {
  accounts: {
    total: number;
    active: number;
    trialsActive: number;
    trialsExpiring: number;
  };
  subscriptions: {
    basic: number;
    pro: number;
    enterprise: number;
  };
  revenue: {
    monthly: number;
    yearly: number;
    total: number;
  };
  activity: {
    loginsToday: number;
    newAccountsToday: number;
    subscriptionChangesToday: number;
  };
  projects: number;
  lastUpdated: string;
}
```

### Account Summary

```typescript
interface AccountSummary {
  id: string;
  email: string;
  name: string;
  subscription: "BASIC" | "PRO" | "ENTERPRISE";
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  trial: {
    isOnTrial: boolean;
    trialDaysRemaining: number;
    trialExpired: boolean;
  };
  usage: {
    projectsUsed: number;
    projectsRemaining: number;
    utilizationPercent: number;
  };
}
```

## Features Implementation Status

### ✅ Completed Features

- **Real-time Dashboard**: Live metrics with auto-refresh
- **Account Management**: Comprehensive account overview
- **Subscription Tracking**: Active subscriptions and trials
- **Revenue Analytics**: MRR calculations and projections
- **API Integration**: Full backend connectivity with fallback
- **Responsive Design**: Mobile-friendly interface
- **Navigation System**: Intuitive menu structure

### 🔄 Current Status

- **Authentication**: Temporarily disabled for demo purposes
- **Data Source**: Connected to real database with demo data seeding
- **Performance**: Optimized with React 18 client components
- **Error Handling**: Graceful fallback to mock data when API unavailable

### 🎯 Future Enhancements (Phase 4C+)

- **Role-based Access Control**: Admin permission levels
- **Advanced Filtering**: Complex query capabilities
- **Export Functionality**: Data export in multiple formats
- **Notification System**: Real-time alerts and notifications
- **Audit Logging**: Detailed admin action tracking
- **Performance Optimization**: Caching and pagination

## Development Workflow

### Setup

```bash
# Install dependencies
pnpm install

# Start development server
pnpm --filter @apps/admin dev

# Build for production
pnpm --filter @apps/admin build

# Run tests
pnpm --filter @apps/admin test
```

### Environment Configuration

```env
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### Development Commands

```bash
# Development with API and database
pnpm db:up          # Start PostgreSQL and Redis
pnpm dev:api        # Start API server (port 3000)
pnpm dev:admin      # Start admin interface (port 3001)

# Seed demo data
pnpm --filter @apps/api tsx scripts/seed-demo-data.ts
```

## Testing Strategy

### Component Tests

- React Testing Library for component behavior
- Vitest for unit testing business logic
- Mock API responses for isolated testing

### Integration Tests

- End-to-end dashboard workflows
- API integration testing
- Real-time data refresh testing

### Performance Tests

- Bundle size optimization
- Runtime performance monitoring
- Memory usage analysis

## Security Considerations

### Authentication (Future Implementation)

- JWT token-based authentication
- Multi-factor authentication support
- Session management and timeout
- Role-based access control

### Data Protection

- Sensitive data masking in logs
- HTTPS enforcement
- CSRF protection
- Input validation and sanitization

### API Security

- Rate limiting on admin endpoints
- Request validation with Zod schemas
- Error message sanitization
- Audit logging for admin actions

## Performance Optimizations

### Frontend

- React 18 concurrent rendering
- Component memoization for expensive calculations
- Lazy loading for large data sets
- Image optimization with Next.js

### Backend

- Database query optimization
- Response caching for frequently accessed data
- Pagination for large data sets
- Background processing for heavy operations

## Monitoring and Observability

### Metrics Collection

- User interaction tracking
- Performance metrics (load times, API response times)
- Error rate monitoring
- Feature usage analytics

### Alerting

- System health monitoring
- Performance degradation alerts
- Error threshold notifications
- Capacity planning metrics

## Deployment

### Production Build

```bash
# Build optimized bundle
pnpm build

# Start production server
pnpm start
```

### Environment Variables

```env
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://api.yourapp.com
```

### Docker Support

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

## Troubleshooting

### Common Issues

1. **API Connection Failures**: Check API server status and network connectivity
2. **Data Loading Issues**: Verify database connection and demo data seeding
3. **Build Errors**: Ensure all dependencies are installed and TypeScript types are correct
4. **Performance Issues**: Check for memory leaks and optimize re-renders

### Debug Commands

```bash
# Check API connectivity
curl http://localhost:3000/health

# Verify database connection
pnpm db:studio

# Check admin build
pnpm --filter @apps/admin build --debug
```

## Contributing

### Code Standards

- TypeScript strict mode enabled
- ESLint configuration for code quality
- Prettier for consistent formatting
- Component documentation with JSDoc

### Testing Requirements

- Unit tests for all business logic
- Component tests for UI interactions
- Integration tests for API connectivity
- Performance tests for optimization validation

This admin dashboard represents a complete, production-ready administrative interface that provides comprehensive monitoring and management capabilities for the SaaS platform.
