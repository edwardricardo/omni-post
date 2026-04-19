/**
 * @file page.tsx
 * @component BillingSettingsPage
 * @description Billing settings page with gateway switching, plan configurator,
 * and subscription management.
 * @layer client-pages
 */

"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/authContext";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@packages/ui";
import {
  useGatewayStatus,
  useInitiateGatewaySwitch,
  useCancelGatewaySwitch,
  useAvailablePlans,
  useCheckout,
  useBillingPortal,
} from "@/hooks/api/useBilling";
import type { GatewayProvider, BillingPlan } from "@/hooks/api/useBilling";
import { InvoiceHistory } from "@/components/billing/InvoiceHistory";

// ---------------------------------------------------------------------------
// Plan configuration constants
// ---------------------------------------------------------------------------

const PROVIDER_OPTIONS = [
  "X",
  "INSTAGRAM",
  "FACEBOOK",
  "YOUTUBE",
  "TIKTOK",
  "LINKEDIN",
  "PINTEREST",
  "SNAPCHAT",
  "TELEGRAM",
  "BLUESKY",
] as const;

const PROVIDER_TIERS = [
  { min: 1, max: 1, price: 12 },
  { min: 2, max: 3, price: 10 },
  { min: 4, max: 6, price: 8 },
  { min: 7, max: null, price: 6 },
] as const;

const ACCOUNT_TIERS = [
  { min: 1, max: 1, mult: 1.0 },
  { min: 2, max: 3, mult: 0.8 },
  { min: 4, max: 9, mult: 0.65 },
  { min: 10, max: null, mult: 0.5 },
] as const;

// ---------------------------------------------------------------------------
// Price calculation helpers
// ---------------------------------------------------------------------------

function getProviderPrice(count: number): number {
  const tier = PROVIDER_TIERS.find((t) => count >= t.min && (t.max === null || count <= t.max));
  return tier?.price ?? 12;
}

function getAccountMult(n: number): number {
  const tier = ACCOUNT_TIERS.find((t) => n >= t.min && (t.max === null || n <= t.max));
  return tier?.mult ?? 1;
}

function calcCustom(providers: number, accounts: number): number {
  const perProv = getProviderPrice(providers);
  const base = perProv * providers;
  let total = 0;
  for (let i = 1; i <= accounts; i++) total += base * getAccountMult(i);
  return Math.round(total * 100) / 100;
}

function calcBundle(bundlePrice: number, accounts: number): number {
  let total = 0;
  for (let i = 1; i <= accounts; i++) total += bundlePrice * getAccountMult(i);
  return Math.round(total * 100) / 100;
}

// ---------------------------------------------------------------------------
// Gateway display helpers
// ---------------------------------------------------------------------------

const GATEWAY_LABELS: Record<GatewayProvider, string> = {
  stripe: "Stripe",
  paddle: "Paddle",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getAlternativeGateway(current: GatewayProvider): GatewayProvider {
  return current === "stripe" ? "paddle" : "stripe";
}

// ---------------------------------------------------------------------------
// Gateway selector for users without active subscription (State A)
// ---------------------------------------------------------------------------

function GatewaySelector({
  selected,
  onChange,
}: {
  selected: GatewayProvider;
  onChange: (g: GatewayProvider) => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-5 mb-6">
      <h3 className="text-sm font-medium text-foreground mb-3">Procesador de pago</h3>
      <div className="space-y-3">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="radio"
            name="gateway"
            value="stripe"
            checked={selected === "stripe"}
            onChange={() => onChange("stripe")}
            className="mt-1"
          />
          <div>
            <span className="text-sm font-medium text-foreground">Stripe</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Recommended for US, Canada and Europe.
            </p>
            <p className="text-xs text-muted-foreground">
              Visa, Mastercard, Amex, Apple Pay, Google Pay.
            </p>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="radio"
            name="gateway"
            value="paddle"
            checked={selected === "paddle"}
            onChange={() => onChange("paddle")}
            className="mt-1"
          />
          <div>
            <span className="text-sm font-medium text-foreground">Paddle</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Recommended for rest of the world.
            </p>
            <p className="text-xs text-muted-foreground">
              VAT and local tax handling included. Visa, Mastercard, PayPal and more.
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active gateway banner with switch trigger (State B)
// ---------------------------------------------------------------------------

function ActiveGatewayBanner({
  currentGateway,
  onSwitchClick,
}: {
  currentGateway: GatewayProvider;
  onSwitchClick: () => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-5 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Active payment processor:{" "}
            <span className="font-semibold">{GATEWAY_LABELS[currentGateway]}</span>
          </h3>
          <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
            <p>Switching processors requires re-entering your card.</p>
            <p>Payment data cannot be transferred between processors.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onSwitchClick}>
          Switch payment processor
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending switch banners (State C)
// ---------------------------------------------------------------------------

function PendingSwitchBanner({
  status,
  toGateway,
  scheduledFor,
  extendedUntil,
  onCancel,
  isCancelling,
}: {
  status: "SCHEDULED" | "PENDING_CHECKOUT";
  toGateway: GatewayProvider;
  scheduledFor: string;
  extendedUntil: string;
  onCancel: () => void;
  isCancelling: boolean;
}) {
  if (status === "SCHEDULED") {
    return (
      <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950/30 p-4 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm text-foreground">
            <p>
              Switch scheduled: your subscription moves to{" "}
              <span className="font-semibold">{GATEWAY_LABELS[toGateway]}</span> on{" "}
              <span className="font-medium">{formatDate(scheduledFor)}</span>.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              You&apos;ll continue being billed by the current processor until then.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={isCancelling}>
            {isCancelling ? "Cancelling..." : "Cancel switch"}
          </Button>
        </div>
      </div>
    );
  }

  // PENDING_CHECKOUT
  return (
    <div className="rounded-lg border border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30 p-4 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-foreground">
          <p>
            Your previous billing period has ended. Complete your subscription on{" "}
            <span className="font-semibold">{GATEWAY_LABELS[toGateway]}</span>.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            You have until <span className="font-medium">{formatDate(extendedUntil)}</span>.
          </p>
        </div>
        <Button variant="default" size="sm" asChild>
          <a href={`/dashboard/settings/billing/checkout/${toGateway}`}>
            Complete on {GATEWAY_LABELS[toGateway]}
          </a>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Switch confirmation dialog
// ---------------------------------------------------------------------------

function SwitchConfirmDialog({
  open,
  onOpenChange,
  currentGateway,
  onConfirm,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentGateway: GatewayProvider;
  onConfirm: (target: GatewayProvider) => void;
  isSubmitting: boolean;
}) {
  const target = getAlternativeGateway(currentGateway);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Switch payment processor</DialogTitle>
          <DialogDescription>
            Change your billing from {GATEWAY_LABELS[currentGateway]} to {GATEWAY_LABELS[target]}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="text-sm text-foreground">
            <p>
              Currently using:{" "}
              <span className="font-semibold">{GATEWAY_LABELS[currentGateway]}</span>
            </p>
            <p className="mt-1">
              Switch to: <span className="font-semibold">{GATEWAY_LABELS[target]}</span>
            </p>
          </div>

          <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground space-y-1.5">
            <p>The switch applies at the end of your current billing period.</p>
            <p>You must re-enter your card on {GATEWAY_LABELS[target]}.</p>
            <p>You&apos;ll have 48 hours to complete payment after the switch date.</p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(target)} disabled={isSubmitting}>
            {isSubmitting ? "Confirming..." : "Confirm switch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Gateway section (orchestrator for states A/B/C)
// ---------------------------------------------------------------------------

function GatewaySection() {
  const { data: gatewayStatus, isLoading, isError } = useGatewayStatus();
  const initiateSwitch = useInitiateGatewaySwitch();
  const cancelSwitch = useCancelGatewaySwitch();

  const [localGateway, setLocalGateway] = useState<GatewayProvider>("stripe");
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false);

  const handleConfirmSwitch = useCallback(
    (target: GatewayProvider) => {
      initiateSwitch.mutate(target, {
        onSuccess: () => {
          setSwitchDialogOpen(false);
        },
      });
    },
    [initiateSwitch]
  );

  const handleCancelSwitch = useCallback(() => {
    cancelSwitch.mutate(undefined);
  }, [cancelSwitch]);

  // Loading and error states
  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-5 mb-6 animate-pulse">
        <div className="h-4 bg-muted rounded w-48" />
        <div className="h-3 bg-muted rounded w-72 mt-2" />
      </div>
    );
  }

  if (isError || !gatewayStatus) {
    // State A fallback: no subscription data available, show the local selector
    return <GatewaySelector selected={localGateway} onChange={setLocalGateway} />;
  }

  const { gatewayProvider, pendingSwitch } = gatewayStatus;

  // State C: pending switch exists
  if (
    pendingSwitch &&
    (pendingSwitch.status === "SCHEDULED" || pendingSwitch.status === "PENDING_CHECKOUT")
  ) {
    return (
      <PendingSwitchBanner
        status={pendingSwitch.status}
        toGateway={pendingSwitch.toGateway}
        scheduledFor={pendingSwitch.scheduledFor}
        extendedUntil={pendingSwitch.extendedUntil}
        onCancel={handleCancelSwitch}
        isCancelling={cancelSwitch.isPending}
      />
    );
  }

  // State B: active subscription, no pending switch
  return (
    <>
      <ActiveGatewayBanner
        currentGateway={gatewayProvider}
        onSwitchClick={() => setSwitchDialogOpen(true)}
      />
      <SwitchConfirmDialog
        open={switchDialogOpen}
        onOpenChange={setSwitchDialogOpen}
        currentGateway={gatewayProvider}
        onConfirm={handleConfirmSwitch}
        isSubmitting={initiateSwitch.isPending}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Main billing page
// ---------------------------------------------------------------------------

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

  // Checkout + portal hooks
  const checkout = useCheckout();
  const portal = useBillingPortal();
  const { data: gatewayStatus } = useGatewayStatus();
  const {
    data: remotePlans,
    isLoading: plansLoading,
    isError: plansError,
    refetch: refetchPlans,
  } = useAvailablePlans();

  // Use active gateway or default to stripe for checkout
  const checkoutGateway: GatewayProvider =
    (gatewayStatus?.gatewayProvider as GatewayProvider) ?? "stripe";

  // Success/cancel banners from gateway redirect
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

  const customPrice = useMemo(
    () => calcCustom(selectedProviders.size, accountCount),
    [selectedProviders.size, accountCount]
  );

  const yearlyPrice = useMemo(() => Math.round(customPrice * 10 * 100) / 100, [customPrice]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Billing</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your subscription and plan</p>
      </div>

      {/* Success/Cancel banners after gateway redirect */}
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

      {/* Gateway switching section */}
      <GatewaySection />

      {/* Manage Billing button (only when active subscription) */}
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
        <div className="grid sm:grid-cols-3 gap-4 mb-6">
          {plansLoading ? (
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
          ) : plansError ? (
            <div className="col-span-3 rounded-lg border border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/30 p-6 text-center">
              <p className="text-sm text-red-800 dark:text-red-200">
                Failed to load plans. Please try again.
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchPlans()}>
                Retry
              </Button>
            </div>
          ) : !remotePlans?.length ? (
            <div className="col-span-3 rounded-lg border bg-card p-6 text-center">
              <p className="text-sm text-muted-foreground">No plans available at this time.</p>
            </div>
          ) : (
            remotePlans.map((bundle: BillingPlan) => {
              const total = calcBundle(bundle.pricePerAccountMonth, accountCount);
              return (
                <div key={bundle.slug} className="rounded-lg border bg-card p-5">
                  <h3 className="text-lg font-semibold">{bundle.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{bundle.description ?? ""}</p>
                  <div className="mt-4">
                    <span className="text-3xl font-bold">${total}</span>
                    <span className="text-muted-foreground">/mo</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {bundle.providers.length} platforms, {accountCount} account
                    {accountCount > 1 ? "s" : ""}
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
                    disabled={checkout.isPending}
                    onClick={() => checkout.mutate({ gatewayProvider: checkoutGateway })}
                  >
                    {checkout.isPending ? "Redirecting..." : "Subscribe"}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === "custom" && (
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium mb-2">Select providers</h3>
            <div className="flex flex-wrap gap-2">
              {PROVIDER_OPTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggleProvider(p)}
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
              {selectedProviders.size} provider{selectedProviders.size !== 1 ? "s" : ""} selected
              {selectedProviders.size > 0 &&
                ` @ $${getProviderPrice(selectedProviders.size)}/provider`}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2">Social accounts: {accountCount}</h3>
            <input
              type="range"
              min={1}
              max={20}
              value={accountCount}
              onChange={(e) => setAccountCount(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div className="rounded-lg border bg-card p-5">
            <div className="flex items-end gap-4">
              <div>
                <span className="text-3xl font-bold">
                  ${cycle === "monthly" ? customPrice : yearlyPrice}
                </span>
                <span className="text-muted-foreground">/{cycle === "monthly" ? "mo" : "yr"}</span>
              </div>
              <div className="flex rounded-lg border overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => setCycle("monthly")}
                  className={`px-3 py-1 ${cycle === "monthly" ? "bg-primary text-primary-foreground" : ""}`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setCycle("yearly")}
                  className={`px-3 py-1 ${cycle === "yearly" ? "bg-primary text-primary-foreground" : ""}`}
                >
                  Yearly (2mo free)
                </button>
              </div>
            </div>
            {selectedProviders.size > 0 && (
              <Button
                className="w-full mt-4"
                disabled={checkout.isPending}
                onClick={() => checkout.mutate({ gatewayProvider: checkoutGateway })}
              >
                {checkout.isPending ? "Redirecting..." : "Subscribe"}
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="mt-6">
        <h3 className="text-sm font-medium mb-2">Accounts managed: {accountCount}</h3>
        <input
          type="range"
          min={1}
          max={20}
          value={accountCount}
          onChange={(e) => setAccountCount(Number(e.target.value))}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Volume discount: accounts 2-3 at 80%, 4-9 at 65%, 10+ at 50%
        </p>
      </div>

      {/* Invoice History */}
      <div className="mt-8">
        <InvoiceHistory />
      </div>
    </div>
  );
}
