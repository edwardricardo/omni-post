# Backend API Routes - Admin App

**Local API URL:** `http://localhost:3000`

---

## Available Routes

### Dashboard

- `GET /admin/dashboard/stats` - Dashboard statistics (accounts, subscriptions, activity)

### Accounts

- `GET /admin/accounts/summary` - All accounts with trial/usage info
- `PUT /admin/accounts/:id` - Update account details
- `DELETE /admin/accounts/:id` - Delete account
- `POST /admin/accounts/:id/suspend` - Suspend account
- `POST /admin/accounts/:id/resume` - Resume suspended account

### Subscriptions

- `GET /admin/subscriptions/summary` - Subscription statistics

### Analytics

- `GET /admin/analytics/overview` - Analytics overview

### RBAC (Role-Based Access Control)

- `GET /admin/rbac/roles` - List all roles and permissions
- `GET /admin/rbac/roles/:role` - Get specific role details
- `GET /admin/rbac/roles/:role/users` - Get users with specific role
- `PUT /admin/rbac/users/:userId/role` - Update user role
- `GET /admin/rbac/hierarchy` - Get role hierarchy
- `GET /admin/rbac/status` - Get security statistics

### MFA (Multi-Factor Authentication)

- `GET /admin/users/:userId/mfa/status` - Get user MFA status
- `POST /admin/users/:userId/mfa/force-disable` - Force disable MFA (admin only)

### Billing

- `GET /admin/billing/plans` - Get subscription plans

### Audit Logs

- `GET /admin/audit/logs` - Get audit trail
  - **Query params:** `limit`, `offset`, `userId`, `action`, `startDate`, `endDate`

### Queue

- `GET /admin/queue/jobs` - List queue jobs
- `GET /admin/queue/stats` - Queue statistics

### AI

- `POST /ai/smart-analysis` - Content analysis and optimization
- `POST /ai/predict-timing` - Predict optimal posting times

---

## Integration Status

| Feature              | Frontend Hook          | Backend Route                | Status     |
| -------------------- | ---------------------- | ---------------------------- | ---------- |
| Dashboard Stats      | useDashboardStats      | /admin/dashboard/stats       | Integrated |
| Accounts List        | useAccounts            | /admin/accounts/summary      | Integrated |
| Subscriptions        | useSubscriptions       | /admin/subscriptions/summary | Integrated |
| Analytics            | useAnalytics           | /admin/analytics/overview    | Integrated |
| RBAC Management      | useSecurity            | /admin/rbac/\*               | Integrated |
| MFA Management       | useSecurity            | /admin/users/:id/mfa/\*      | Integrated |
| Queue Manager        | useQueueManager        | /admin/queue/\*              | Integrated |
| Performance Insights | usePerformanceInsights | /admin/analytics/overview    | Integrated |
| Content Library      | useContentLibrary      | /posts                       | Integrated |
| AI Optimizer         | SmartContentOptimizer  | /ai/smart-analysis           | Integrated |
| AI Predictions       | usePredictiveData      | /ai/predict-timing           | Integrated |

---

## API Client Usage

```typescript
import { api } from "@/lib/apiClient";

// Get dashboard stats
const response = await api.admin.getDashboardStats();

// Get accounts
const accounts = await api.admin.getAccountSummary();

// Get subscriptions
const subs = await api.admin.getSubscriptionSummary();

// Get analytics
const analytics = await api.admin.getAnalyticsOverview();
```

---

## TanStack Query Hooks

```typescript
import { useDashboardStats } from "@/hooks/api/useDashboardStats";
import { useAccounts } from "@/hooks/api/useAccounts";
import { useAnalytics } from "@/hooks/api/useAnalytics";

function DashboardPage() {
  const { data: stats, isLoading, error } = useDashboardStats();
  const { data: accounts } = useAccounts();
  // Auto-refetches, auto-caches
}
```

---

**Last Updated:** 2026-03-08
