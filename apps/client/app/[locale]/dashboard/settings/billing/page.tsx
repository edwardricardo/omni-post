/**
 * @file page.tsx
 * @description Billing settings page. Composes the gateway-state
 *              orchestrator (`GatewaySection`), the bundles / custom
 *              plan tabs, and the invoice history. Pricing math + the
 *              gateway sub-components live under `components/` and
 *              `utils/`.
 * @component BillingSettingsPage
 * @layer infrastructure
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { Button } from "@packages/ui";
import {
  useAvailablePlans,
  useBillingPortal,
  useCheckout,
  useGatewayStatus,
} from "@/hooks/api/useBilling";
import type { GatewayProvider } from "@/hooks/api/useBilling";
import { useAuth } from "@/lib/auth/authContext";
import { InvoiceHistory } from "@/components/billing/InvoiceHistory";
import { BundlesTab, CustomPlanTab, GatewaySection } from "./components";

export default function BillingPage() {
  const { user: _user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<"bundles" | "custom">("bundles");
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(
    new Set(["X", "INSTAGRAM"])
  );
  const [accountCount, setAccountCount] = useState(1);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");

  const checkout = useCheckout();
  const portal = useBillingPortal();
  const { data: gatewayStatus } = useGatewayStatus();
  const {
    data: remotePlans,
    isLoading: plansLoading,
    isError: plansError,
    refetch: refetchPlans,
  } = useAvailablePlans();

  const checkoutGateway: GatewayProvider =
    (gatewayStatus?.gatewayProvider as GatewayProvider) ?? "stripe";

  const isSuccess = searchParams.get("success") === "true";
  const isCanceled = searchParams.get("canceled") === "true";

  useEffect(() => {
    if (isSuccess || isCanceled) {
      const timer = setTimeout(() => {
        router.replace("/dashboard/settings/billing");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isSuccess, isCanceled, router]);

  const hasActiveSubscription = gatewayStatus && !gatewayStatus.pendingSwitch;

  const toggleProvider = useCallback((p: string) => {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Billing</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your subscription and plan</p>
      </div>

      {isSuccess && (
        <div className="rounded-lg border border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950/30 p-4 mb-4">
          <p className="text-sm font-medium text-green-800 dark:text-green-200">
            Subscription activated successfully!
          </p>
        </div>
      )}
      {isCanceled && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950/30 p-4 mb-4">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            Payment canceled. You can try again anytime.
          </p>
        </div>
      )}

      <GatewaySection />

      {hasActiveSubscription && (
        <div className="mb-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => portal.mutate()}
            disabled={portal.isPending}
          >
            {portal.isPending ? "Opening portal..." : "Manage Billing"}
          </Button>
          <p className="text-xs text-muted-foreground mt-1">
            View invoices, update payment method, or manage your subscription.
          </p>
        </div>
      )}

      <div className="flex border-b mb-6">
        {(["bundles", "custom"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground"
            }`}
          >
            {t === "bundles" ? "Bundles" : "Custom Plan"}
          </button>
        ))}
      </div>

      {tab === "bundles" && (
        <BundlesTab
          plans={remotePlans}
          isLoading={plansLoading}
          isError={plansError}
          onRetry={() => refetchPlans()}
          accountCount={accountCount}
          checkoutGateway={checkoutGateway}
          isCheckoutPending={checkout.isPending}
          onCheckout={(gateway) => checkout.mutate({ gatewayProvider: gateway })}
        />
      )}

      {tab === "custom" && (
        <CustomPlanTab
          selectedProviders={selectedProviders}
          accountCount={accountCount}
          cycle={cycle}
          checkoutGateway={checkoutGateway}
          isCheckoutPending={checkout.isPending}
          onToggleProvider={toggleProvider}
          onAccountCountChange={setAccountCount}
          onCycleChange={setCycle}
          onCheckout={(gateway) => checkout.mutate({ gatewayProvider: gateway })}
        />
      )}

      <div className="mt-8">
        <InvoiceHistory />
      </div>
    </div>
  );
}
