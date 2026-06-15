/**
 * @file CustomPlanTab.tsx
 * @description Custom-plan builder: provider chip selector, accounts
 *              slider, monthly/yearly cycle toggle, computed price
 *              card, Subscribe CTA. The price math comes from the
 *              shared `pricing` utils.
 * @component CustomPlanTab
 * @layer infrastructure
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@packages/ui";
import type { GatewayProvider } from "@/hooks/api/useBilling";
import { calcCustom, getProviderPrice, PROVIDER_OPTIONS } from "../utils/pricing.js";

interface CustomPlanTabProps {
  selectedProviders: Set<string>;
  accountCount: number;
  cycle: "monthly" | "yearly";
  checkoutGateway: GatewayProvider;
  isCheckoutPending: boolean;
  onToggleProvider: (provider: string) => void;
  onAccountCountChange: (count: number) => void;
  onCycleChange: (cycle: "monthly" | "yearly") => void;
  onCheckout: (gateway: GatewayProvider) => void;
}

export function CustomPlanTab({
  selectedProviders,
  accountCount,
  cycle,
  checkoutGateway,
  isCheckoutPending,
  onToggleProvider,
  onAccountCountChange,
  onCycleChange,
  onCheckout,
}: CustomPlanTabProps) {
  const t = useTranslations("settings");
  const customPrice = useMemo(
    () => calcCustom(selectedProviders.size, accountCount),
    [selectedProviders.size, accountCount]
  );
  const yearlyPrice = useMemo(() => Math.round(customPrice * 10 * 100) / 100, [customPrice]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-2">
          {t("billing.components.customPlan.selectProviders")}
        </h3>
        <div className="flex flex-wrap gap-2">
          {PROVIDER_OPTIONS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onToggleProvider(p)}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                selectedProviders.has(p)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground hover:bg-accent"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {t("billing.components.customPlan.providersSelected", {
            count: selectedProviders.size,
          })}
          {selectedProviders.size > 0 &&
            t("billing.components.customPlan.perProviderPrice", {
              price: getProviderPrice(selectedProviders.size),
            })}
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">
          {t("billing.components.customPlan.socialAccounts", { count: accountCount })}
        </h3>
        <input
          type="range"
          min={1}
          max={20}
          value={accountCount}
          onChange={(e) => onAccountCountChange(Number(e.target.value))}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground mt-1">
          {t("billing.components.customPlan.volumeDiscount")}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-end gap-4">
          <div>
            <span className="text-3xl font-bold">
              ${cycle === "monthly" ? customPrice : yearlyPrice}
            </span>
            <span className="text-muted-foreground">
              {cycle === "monthly"
                ? t("billing.components.customPlan.perMonth")
                : t("billing.components.customPlan.perYear")}
            </span>
          </div>
          <div className="flex rounded-lg border overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => onCycleChange("monthly")}
              className={`px-3 py-1 ${
                cycle === "monthly" ? "bg-primary text-primary-foreground" : ""
              }`}
            >
              {t("billing.components.customPlan.monthly")}
            </button>
            <button
              type="button"
              onClick={() => onCycleChange("yearly")}
              className={`px-3 py-1 ${
                cycle === "yearly" ? "bg-primary text-primary-foreground" : ""
              }`}
            >
              {t("billing.components.customPlan.yearly")}
            </button>
          </div>
        </div>
        {selectedProviders.size > 0 && (
          <Button
            className="w-full mt-4"
            disabled={isCheckoutPending}
            onClick={() => onCheckout(checkoutGateway)}
          >
            {isCheckoutPending
              ? t("billing.components.customPlan.redirecting")
              : t("billing.components.customPlan.subscribe")}
          </Button>
        )}
      </div>
    </div>
  );
}
