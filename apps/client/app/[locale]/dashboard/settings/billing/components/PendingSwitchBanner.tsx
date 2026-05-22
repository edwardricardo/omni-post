/**
 * @file PendingSwitchBanner.tsx
 * @description State C banner — a switch is in flight. Two variants:
 *              `SCHEDULED` (yellow, lets you cancel before the switch
 *              date) and `PENDING_CHECKOUT` (blue, billing period
 *              ended; user must complete checkout on the new gateway
 *              before `extendedUntil`).
 * @component PendingSwitchBanner
 * @layer infrastructure
 */
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@packages/ui";
import type { GatewayProvider } from "@/hooks/api/useBilling";
import { formatBillingDate, GATEWAY_LABELS } from "../utils/pricing";

interface PendingSwitchBannerProps {
  status: "SCHEDULED" | "PENDING_CHECKOUT";
  toGateway: GatewayProvider;
  scheduledFor: string;
  extendedUntil: string;
  onCancel: () => void;
  isCancelling: boolean;
}

export function PendingSwitchBanner({
  status,
  toGateway,
  scheduledFor,
  extendedUntil,
  onCancel,
  isCancelling,
}: PendingSwitchBannerProps) {
  const t = useTranslations("settings.billing.components.pendingSwitch");
  const semibold = (chunks: React.ReactNode) => <span className="font-semibold">{chunks}</span>;
  const medium = (chunks: React.ReactNode) => <span className="font-medium">{chunks}</span>;

  if (status === "SCHEDULED") {
    return (
      <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950/30 p-4 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm text-foreground">
            <p>
              {t.rich("scheduledText", {
                gateway: GATEWAY_LABELS[toGateway],
                date: formatBillingDate(scheduledFor),
                semibold,
                medium,
              })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{t("scheduledSubtext")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={isCancelling}>
            {isCancelling ? t("cancelling") : t("cancelSwitch")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30 p-4 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-foreground">
          <p>{t.rich("checkoutText", { gateway: GATEWAY_LABELS[toGateway], semibold })}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t.rich("checkoutSubtext", { date: formatBillingDate(extendedUntil), medium })}
          </p>
        </div>
        <Button variant="default" size="sm" asChild>
          <a href={`/dashboard/settings/billing/checkout/${toGateway}`}>
            {t("completeOn", { gateway: GATEWAY_LABELS[toGateway] })}
          </a>
        </Button>
      </div>
    </div>
  );
}
