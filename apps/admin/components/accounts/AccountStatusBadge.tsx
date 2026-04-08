/**
 * @file AccountStatusBadge.tsx
 * @description Status badge for account (Active/Suspended/Trial).
 * @layer presentation
 */

import { Badge } from "@/components/ui/Badge";
import type { AccountSummary } from "@/lib/apiClient";

export function AccountStatusBadge({ account }: { account: AccountSummary }) {
  if (!account.isActive) return <Badge variant="error">Suspended</Badge>;
  if (account.trial.isOnTrial)
    return <Badge variant="warning">Trial ({account.trial.trialDaysRemaining}d)</Badge>;
  return <Badge variant="success">Active</Badge>;
}
