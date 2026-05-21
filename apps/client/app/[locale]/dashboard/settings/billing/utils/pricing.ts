/**
 * @file pricing.ts
 * @description Pure helpers for the billing page's pricing table and
 *              gateway display. Provider tiers compute per-provider
 *              pricing; account tiers apply a volume multiplier per
 *              additional account; calcCustom and calcBundle iterate
 *              both to produce a monthly total.
 * @layer infrastructure
 */

import type { GatewayProvider } from "@/hooks/api/useBilling";

export const PROVIDER_OPTIONS = [
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

export function getProviderPrice(count: number): number {
  const tier = PROVIDER_TIERS.find((t) => count >= t.min && (t.max === null || count <= t.max));
  return tier?.price ?? 12;
}

export function getAccountMult(n: number): number {
  const tier = ACCOUNT_TIERS.find((t) => n >= t.min && (t.max === null || n <= t.max));
  return tier?.mult ?? 1;
}

export function calcCustom(providers: number, accounts: number): number {
  const perProv = getProviderPrice(providers);
  const base = perProv * providers;
  let total = 0;
  for (let i = 1; i <= accounts; i++) total += base * getAccountMult(i);
  return Math.round(total * 100) / 100;
}

export function calcBundle(bundlePrice: number, accounts: number): number {
  let total = 0;
  for (let i = 1; i <= accounts; i++) total += bundlePrice * getAccountMult(i);
  return Math.round(total * 100) / 100;
}

export const GATEWAY_LABELS: Record<GatewayProvider, string> = {
  stripe: "Stripe",
  paddle: "Paddle",
};

export function formatBillingDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function getAlternativeGateway(current: GatewayProvider): GatewayProvider {
  return current === "stripe" ? "paddle" : "stripe";
}
