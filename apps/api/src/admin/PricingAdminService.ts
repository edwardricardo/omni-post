/**
 * @file PricingAdminService.ts
 * @description Admin pricing CRUD: provider/account pricing tiers and provider
 *              bundles. Receives PrismaClient by injection so the route handler
 *              stays Prisma-free (these admin-config tables have no dedicated
 *              domain ports yet — backlog: hexagonal pricing ports).
 * @layer infrastructure
 */

import type {
  PrismaClient,
  Provider,
  ProviderPricingTier,
  AccountPricingTier,
  ProviderBundle,
} from "@infra/prisma";
import { ok, err, type Result } from "@shared/types";

export interface UpdateProviderTierInput {
  minProviders?: number;
  maxProviders?: number | null;
  pricePerProviderMonth?: number;
}
export interface UpdateAccountTierInput {
  minAccounts?: number;
  maxAccounts?: number | null;
  multiplier?: number;
}
export interface UpdateBundleInput {
  name?: string;
  description?: string;
  pricePerAccountMonth?: number;
  providers?: string[];
}
export interface CreateBundleInput {
  name: string;
  slug: string;
  description: string;
  providers: string[];
  pricePerAccountMonth: number;
  isActive: boolean;
  sortOrder: number;
}
export interface CreateProviderTierInput {
  minProviders: number;
  maxProviders?: number | null;
  pricePerProviderMonth: number;
}
export interface CreateAccountTierInput {
  minAccounts: number;
  maxAccounts?: number | null;
  multiplier: number;
}

function isNotFound(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("Record to update not found") || msg.includes("Record to delete does not exist")
  );
}
function isUnique(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("Unique constraint");
}

/**
 * Pricing-admin CRUD over Prisma.
 *
 * Register as a singleton in the DI container via TOKENS.PricingAdminService.
 */
export class PricingAdminService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method getTiers
   * @description All provider tiers, account tiers and bundles (ordered).
   */
  async getTiers(): Promise<{
    providerTiers: ProviderPricingTier[];
    accountTiers: AccountPricingTier[];
    bundles: ProviderBundle[];
  }> {
    const [providerTiers, accountTiers, bundles] = await Promise.all([
      this.prisma.providerPricingTier.findMany({ orderBy: { minProviders: "asc" } }),
      this.prisma.accountPricingTier.findMany({ orderBy: { minAccounts: "asc" } }),
      this.prisma.providerBundle.findMany({ orderBy: { sortOrder: "asc" } }),
    ]);
    return { providerTiers, accountTiers, bundles };
  }

  /**
   * @method updateProviderTier
   * @description Patch a provider pricing tier. Err("NOT_FOUND") when absent.
   */
  async updateProviderTier(
    id: string,
    data: UpdateProviderTierInput
  ): Promise<Result<ProviderPricingTier, "NOT_FOUND">> {
    try {
      const tier = await this.prisma.providerPricingTier.update({
        where: { id },
        data: {
          ...(data.minProviders !== undefined && { minProviders: data.minProviders }),
          ...(data.maxProviders !== undefined && { maxProviders: data.maxProviders }),
          ...(data.pricePerProviderMonth !== undefined && {
            pricePerProviderMonth: data.pricePerProviderMonth,
          }),
        },
      });
      return ok(tier);
    } catch (error) {
      if (isNotFound(error)) return err("NOT_FOUND");
      throw error;
    }
  }

  /**
   * @method updateAccountTier
   * @description Patch an account pricing tier. Err("NOT_FOUND") when absent.
   */
  async updateAccountTier(
    id: string,
    data: UpdateAccountTierInput
  ): Promise<Result<AccountPricingTier, "NOT_FOUND">> {
    try {
      const tier = await this.prisma.accountPricingTier.update({
        where: { id },
        data: {
          ...(data.minAccounts !== undefined && { minAccounts: data.minAccounts }),
          ...(data.maxAccounts !== undefined && { maxAccounts: data.maxAccounts }),
          ...(data.multiplier !== undefined && { multiplier: data.multiplier }),
        },
      });
      return ok(tier);
    } catch (error) {
      if (isNotFound(error)) return err("NOT_FOUND");
      throw error;
    }
  }

  /**
   * @method updateBundle
   * @description Patch a provider bundle. Err("NOT_FOUND") when absent.
   */
  async updateBundle(
    id: string,
    data: UpdateBundleInput
  ): Promise<Result<ProviderBundle, "NOT_FOUND">> {
    try {
      const bundle = await this.prisma.providerBundle.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.pricePerAccountMonth !== undefined && {
            pricePerAccountMonth: data.pricePerAccountMonth,
          }),
          ...(data.providers !== undefined && { providers: { set: data.providers as Provider[] } }),
        },
      });
      return ok(bundle);
    } catch (error) {
      if (isNotFound(error)) return err("NOT_FOUND");
      throw error;
    }
  }

  /**
   * @method createBundle
   * @description Create a provider bundle. Err("SLUG_EXISTS") on slug collision.
   */
  async createBundle(data: CreateBundleInput): Promise<Result<ProviderBundle, "SLUG_EXISTS">> {
    const existing = await this.prisma.providerBundle.findUnique({ where: { slug: data.slug } });
    if (existing) {
      return err("SLUG_EXISTS");
    }
    const bundle = await this.prisma.providerBundle.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        providers: { set: data.providers as Provider[] },
        pricePerAccountMonth: data.pricePerAccountMonth,
        isActive: data.isActive,
        sortOrder: data.sortOrder,
      },
    });
    return ok(bundle);
  }

  /**
   * @method deleteBundle
   * @description Delete a bundle, refusing when active subscriptions reference it.
   */
  async deleteBundle(id: string): Promise<Result<void, "NOT_FOUND" | "HAS_SUBSCRIPTIONS">> {
    const count = await this.prisma.accountSubscription.count({ where: { bundleId: id } });
    if (count > 0) {
      return err("HAS_SUBSCRIPTIONS");
    }
    try {
      await this.prisma.providerBundle.delete({ where: { id } });
      return ok(undefined);
    } catch (error) {
      if (isNotFound(error)) return err("NOT_FOUND");
      throw error;
    }
  }

  /**
   * @method createProviderTier
   * @description Create a provider pricing tier. Err("DUPLICATE") on unique clash.
   */
  async createProviderTier(
    data: CreateProviderTierInput
  ): Promise<Result<ProviderPricingTier, "DUPLICATE">> {
    try {
      const tier = await this.prisma.providerPricingTier.create({
        data: {
          minProviders: data.minProviders,
          ...(data.maxProviders !== undefined &&
            data.maxProviders !== null && { maxProviders: data.maxProviders }),
          pricePerProviderMonth: data.pricePerProviderMonth,
        },
      });
      return ok(tier);
    } catch (error) {
      if (isUnique(error)) return err("DUPLICATE");
      throw error;
    }
  }

  /**
   * @method createAccountTier
   * @description Create an account pricing tier. Err("DUPLICATE") on unique clash.
   */
  async createAccountTier(
    data: CreateAccountTierInput
  ): Promise<Result<AccountPricingTier, "DUPLICATE">> {
    try {
      const tier = await this.prisma.accountPricingTier.create({
        data: {
          minAccounts: data.minAccounts,
          ...(data.maxAccounts !== undefined &&
            data.maxAccounts !== null && { maxAccounts: data.maxAccounts }),
          multiplier: data.multiplier,
        },
      });
      return ok(tier);
    } catch (error) {
      if (isUnique(error)) return err("DUPLICATE");
      throw error;
    }
  }

  /**
   * @method toggleProviderTierStatus
   * @description Set the isActive flag on a provider tier. Err("NOT_FOUND").
   */
  async toggleProviderTierStatus(
    id: string,
    isActive: boolean
  ): Promise<Result<ProviderPricingTier, "NOT_FOUND">> {
    try {
      const tier = await this.prisma.providerPricingTier.update({
        where: { id },
        data: { isActive },
      });
      return ok(tier);
    } catch (error) {
      if (isNotFound(error)) return err("NOT_FOUND");
      throw error;
    }
  }

  /**
   * @method toggleAccountTierStatus
   * @description Set the isActive flag on an account tier. Err("NOT_FOUND").
   */
  async toggleAccountTierStatus(
    id: string,
    isActive: boolean
  ): Promise<Result<AccountPricingTier, "NOT_FOUND">> {
    try {
      const tier = await this.prisma.accountPricingTier.update({
        where: { id },
        data: { isActive },
      });
      return ok(tier);
    } catch (error) {
      if (isNotFound(error)) return err("NOT_FOUND");
      throw error;
    }
  }
}
