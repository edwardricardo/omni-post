/**
 * @file page.tsx
 * @description Billing settings page with plan configurator and subscription management.
 * @layer client-pages
 */

"use client";

import { useState, useMemo, useCallback } from "react";
import { useAuth } from "@/lib/auth/authContext";
import { Button } from "@packages/ui";

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

const BUNDLES = [
  {
    name: "Creator",
    slug: "creator",
    providers: ["X", "INSTAGRAM", "YOUTUBE"],
    price: 25,
    description: "For content creators and influencers",
  },
  {
    name: "Social Pro",
    slug: "social-pro",
    providers: ["X", "INSTAGRAM", "FACEBOOK", "LINKEDIN"],
    price: 32,
    description: "For brands managing multiple channels",
  },
  {
    name: "Agency Full",
    slug: "agency-full",
    providers: PROVIDER_OPTIONS as unknown as string[],
    price: 55,
    description: "All 10 platforms for full-service agencies",
  },
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

export default function BillingPage() {
  const { user: _user } = useAuth();
  const [tab, setTab] = useState<"bundles" | "custom">("bundles");
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(
    new Set(["X", "INSTAGRAM"])
  );
  const [accountCount, setAccountCount] = useState(1);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");

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
          {BUNDLES.map((bundle) => {
            const total = calcBundle(bundle.price, accountCount);
            return (
              <div key={bundle.slug} className="rounded-lg border bg-card p-5">
                <h3 className="text-lg font-semibold">{bundle.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">{bundle.description}</p>
                <div className="mt-4">
                  <span className="text-3xl font-bold">${total}</span>
                  <span className="text-muted-foreground">/mo</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {bundle.providers.length} platforms, {accountCount} account
                  {accountCount > 1 ? "s" : ""}
                </p>
                <ul className="mt-3 space-y-1">
                  {bundle.providers.map((p) => (
                    <li key={p} className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="text-green-600">&#10003;</span> {p}
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full mt-4"
                  variant="outline"
                  onClick={() => alert("Please contact support to change your plan.")}
                >
                  Contact support
                </Button>
              </div>
            );
          })}
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
                variant="outline"
                onClick={() => alert("Please contact support to start a trial.")}
              >
                Contact support to start a trial
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
    </div>
  );
}
