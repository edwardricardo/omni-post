/**
 * @file AccountStatusBadge.tsx
 * @description Status badge for account (Active/Suspended/Trial).
 * @layer presentation
 */
"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import type { AccountSummary } from "@/lib/apiClient";

export function AccountStatusBadge({ account }: { account: AccountSummary }) {
  const t = useTranslations("accounts");

  if (!account.isActive) return <Badge variant="error">{t("badges.suspended")}</Badge>;
  if (account.trial.isOnTrial)
    return (
      <Badge variant="warning">
        {t("badges.trial", { days: account.trial.trialDaysRemaining })}
      </Badge>
    );
  return <Badge variant="success">{t("badges.active")}</Badge>;
}
