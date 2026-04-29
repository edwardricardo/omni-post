/**
 * @file types.ts
 * @description Public types for the pricing-tiers hook module — provider
 *              tiers, account tiers, and bundles plus the create-tier inputs.
 * @layer infrastructure
 */

export interface ProviderTier {
  id: string;
  minProviders: number;
  maxProviders: number | null;
  pricePerProviderMonth: number;
  isActive: boolean;
  effectiveFrom: string;
  createdAt: string;
}

export interface AccountTier {
  id: string;
  minAccounts: number;
  maxAccounts: number | null;
  multiplier: number;
  isActive: boolean;
  effectiveFrom: string;
  createdAt: string;
}

export interface PricingBundle {
  id: string;
  name: string;
  slug: string;
  description: string;
  providers: string[];
  pricePerAccountMonth: number;
  isActive: boolean;
  sortOrder: number;
}

export interface PricingData {
  providerTiers: ProviderTier[];
  accountTiers: AccountTier[];
  bundles: PricingBundle[];
}

export interface CreateBundleInput {
  name: string;
  slug: string;
  description: string;
  providers: string[];
  pricePerAccountMonth: number;
  isActive?: boolean;
  sortOrder?: number;
}

export interface CreateProviderTierInput {
  minProviders: number;
  maxProviders: number | null;
  pricePerProviderMonth: number;
}

export interface CreateAccountTierInput {
  minAccounts: number;
  maxAccounts: number | null;
  multiplier: number;
}

export type TierType = "provider" | "account";
