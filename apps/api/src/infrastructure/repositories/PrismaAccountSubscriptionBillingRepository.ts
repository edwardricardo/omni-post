/**
 * @file PrismaAccountSubscriptionBillingRepository.ts
 * @description Prisma adapter implementing
 *   `AccountSubscriptionBillingRepository`. Reads/writes billing-specific
 *   columns of `AccountSubscription` rows on behalf of `GatewayBillingService`.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type {
  AccountSubscriptionBillingFields,
  AccountSubscriptionBillingRepository,
  AccountSubscriptionBillingUpdate,
  SubscriptionBillingStatus,
  SubscriptionBillingStoreError,
} from "@core/domain/repositories/AccountSubscriptionBillingRepository.js";
import type { AccountGatewayProvider } from "@core/domain/repositories/AccountBillingRepository.js";

const SUBSCRIPTION_BILLING_SELECT = {
  id: true,
  accountId: true,
  status: true,
  cancelAtPeriodEnd: true,
  currentPeriodEnd: true,
  bundleId: true,
  gatewayProvider: true,
  gatewaySubscriptionId: true,
  externalSubscriptionId: true,
} as const;

type SubscriptionBillingRow = {
  id: string;
  accountId: string;
  status: SubscriptionBillingStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  bundleId: string | null;
  gatewayProvider: AccountGatewayProvider;
  gatewaySubscriptionId: string | null;
  externalSubscriptionId: string | null;
};

function rowToFields(row: SubscriptionBillingRow): AccountSubscriptionBillingFields {
  return {
    id: row.id,
    accountId: row.accountId,
    status: row.status,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    currentPeriodEnd: row.currentPeriodEnd,
    bundleId: row.bundleId,
    gatewayProvider: row.gatewayProvider,
    gatewaySubscriptionId: row.gatewaySubscriptionId,
    externalSubscriptionId: row.externalSubscriptionId,
  };
}

export class PrismaAccountSubscriptionBillingRepository implements AccountSubscriptionBillingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveOrTrialingByAccount(
    accountId: string
  ): Promise<Result<AccountSubscriptionBillingFields | null, SubscriptionBillingStoreError>> {
    try {
      const row = await this.prisma.accountSubscription.findFirst({
        where: { accountId, status: { in: ["ACTIVE", "TRIALING"] } },
        select: SUBSCRIPTION_BILLING_SELECT,
      });
      return ok(row ? rowToFields(row as SubscriptionBillingRow) : null);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async findLatestByAccount(
    accountId: string
  ): Promise<Result<AccountSubscriptionBillingFields | null, SubscriptionBillingStoreError>> {
    try {
      const row = await this.prisma.accountSubscription.findFirst({
        where: { accountId },
        orderBy: { createdAt: "desc" },
        select: SUBSCRIPTION_BILLING_SELECT,
      });
      return ok(row ? rowToFields(row as SubscriptionBillingRow) : null);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async findByAccountAndStatus(
    accountId: string,
    status: SubscriptionBillingStatus
  ): Promise<Result<AccountSubscriptionBillingFields | null, SubscriptionBillingStoreError>> {
    try {
      const row = await this.prisma.accountSubscription.findFirst({
        where: { accountId, status },
        select: SUBSCRIPTION_BILLING_SELECT,
      });
      return ok(row ? rowToFields(row as SubscriptionBillingRow) : null);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async update(
    subscriptionId: string,
    fields: AccountSubscriptionBillingUpdate
  ): Promise<Result<void, SubscriptionBillingStoreError>> {
    try {
      await this.prisma.accountSubscription.update({
        where: { id: subscriptionId },
        data: fields,
      });
      return ok(undefined);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async updateAllForAccount(
    accountId: string,
    fields: AccountSubscriptionBillingUpdate
  ): Promise<Result<void, SubscriptionBillingStoreError>> {
    try {
      await this.prisma.accountSubscription.updateMany({
        where: { accountId },
        data: fields,
      });
      return ok(undefined);
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
