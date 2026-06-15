/**
 * @file BundlesTab.tsx
 * @description Bundles tab content: 3-card grid of available bundle
 *              plans loaded via `useAvailablePlans`. Each card shows
 *              price scaled by `accountCount` and a Subscribe button
 *              that triggers checkout on the active gateway.
 * @component BundlesTab
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import { Button } from "@packages/ui";
import type { BillingPlan, GatewayProvider } from "@/hooks/api/useBilling";
import { calcBundle } from "../utils/pricing.js";

interface BundlesTabProps {
  plans: BillingPlan[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  accountCount: number;
  checkoutGateway: GatewayProvider;
  isCheckoutPending: boolean;
  onCheckout: (gateway: GatewayProvider) => void;
}

export function BundlesTab({
  plans,
  isLoading,
  isError,
  onRetry,
  accountCount,
  checkoutGateway,
  isCheckoutPending,
  onCheckout,
}: BundlesTabProps) {
  const t = useTranslations("settings");
  return (
    <div className="grid sm:grid-cols-3 gap-4 mb-6">
      {isLoading ? (
        <>
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border bg-card p-5 animate-pulse">
              <div className="h-5 bg-muted rounded w-24" />
              <div className="h-3 bg-muted rounded w-40 mt-2" />
              <div className="h-8 bg-muted rounded w-20 mt-4" />
              <div className="h-8 bg-muted rounded w-full mt-4" />
            </div>
          ))}
        </>
      ) : isError ? (
        <div className="col-span-3 rounded-lg border border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/30 p-6 text-center">
          <p className="text-sm text-red-800 dark:text-red-200">
            {t("billing.components.bundles.loadError")}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            {t("billing.components.bundles.retry")}
          </Button>
        </div>
      ) : !plans?.length ? (
        <div className="col-span-3 rounded-lg border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">{t("billing.components.bundles.noPlans")}</p>
        </div>
      ) : (
        plans.map((bundle) => {
          const total = calcBundle(bundle.pricePerAccountMonth, accountCount);
          return (
            <div key={bundle.slug} className="rounded-lg border bg-card p-5">
              <h3 className="text-lg font-semibold">{bundle.name}</h3>
              <p className="text-sm text-muted-foreground mt-1">{bundle.description ?? ""}</p>
              <div className="mt-4">
                <span className="text-3xl font-bold">${total}</span>
                <span className="text-muted-foreground">
                  {t("billing.components.bundles.perMonth")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("billing.components.bundles.platformsAccounts", {
                  platforms: bundle.providers.length,
                  accounts: accountCount,
                })}
              </p>
              <ul className="mt-3 space-y-1">
                {bundle.providers.map((p: string) => (
                  <li key={p} className="text-xs text-muted-foreground flex items-center gap-1">
                    <span className="text-green-600">&#10003;</span> {p}
                  </li>
                ))}
              </ul>
              <Button
                className="w-full mt-4"
                disabled={isCheckoutPending}
                onClick={() => onCheckout(checkoutGateway)}
              >
                {isCheckoutPending
                  ? t("billing.components.bundles.redirecting")
                  : t("billing.components.bundles.subscribe")}
              </Button>
            </div>
          );
        })
      )}
    </div>
  );
}
