/**
 * @file page.tsx
 * @component UsagePage
 * @description Usage dashboard showing account usage vs plan limits.
 * @layer client-pages
 */

"use client";

import { useAuth } from "@/lib/auth/authContext";
import { useAccountUsage } from "@/hooks/api/useUsage";

function UsageMeter({
  label,
  current,
  limit,
  unit,
}: {
  label: string;
  current: number;
  limit: number;
  unit?: string;
}) {
  const percentage = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
  const barColor =
    percentage >= 95 ? "bg-red-500" : percentage >= 80 ? "bg-orange-500" : "bg-primary";

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">
          {current.toLocaleString()} / {limit.toLocaleString()} {unit ?? ""}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {percentage >= 80 && (
        <p className="text-xs text-orange-600 mt-1">
          {percentage >= 95 ? "Limit almost reached" : "Approaching limit"}
        </p>
      )}
    </div>
  );
}

export default function UsagePage() {
  const { user } = useAuth();
  const accountId = ((user as Record<string, unknown> | null)?.accountId as string) ?? "";
  const { data: usage, isLoading } = useAccountUsage(accountId);

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading usage data...</div>;
  }

  if (!usage) {
    return <div className="text-center py-8 text-muted-foreground">Unable to load usage data.</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Usage</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Current plan: <strong>{usage.plan}</strong>
          {usage.isOnTrial && usage.trialEndDate && (
            <span className="ml-2 text-orange-600">
              Trial ends {new Date(usage.trialEndDate).toLocaleDateString()}
            </span>
          )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <UsageMeter
          label="Posts this month"
          current={usage.postsPublished}
          limit={usage.postsLimit}
        />
        <UsageMeter
          label="Social channels"
          current={usage.channelsCount}
          limit={usage.channelsLimit}
        />
        <UsageMeter
          label="Team members"
          current={usage.teamMemberCount}
          limit={usage.teamMembersLimit}
        />
        <UsageMeter
          label="Storage"
          current={Math.round(usage.storageGb * 10) / 10}
          limit={usage.storageLimitGb}
          unit="GB"
        />
      </div>

      {usage.nextBillingDate && (
        <p className="text-sm text-muted-foreground mt-6">
          Next billing date: {new Date(usage.nextBillingDate).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
