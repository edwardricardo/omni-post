/**
 * @file PrismaAccountBillingRepository.ts
 * @description Prisma adapter implementing `AccountBillingRepository`.
 *   Reads/writes the billing-specific columns of `Account` rows. Catches
 *   `P2025` (record not found) on updates as `NOT_FOUND` and surfaces every
 *   other failure as `DATABASE_ERROR`.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import { Prisma, type PrismaClient } from "@infra/prisma";
import type {
  AccountBillingFields,
  AccountBillingRepository,
  AccountBillingStoreError,
  AccountBillingUpdate,
  AccountGatewayProvider,
} from "@core/domain/repositories/AccountBillingRepository.js";

const ACCOUNT_BILLING_SELECT = {
  id: true,
  email: true,
  gatewayProvider: true,
  pendingGatewaySwitch: true,
  pendingGatewayProvider: true,
  pendingSwitchScheduledFor: true,
  pendingSwitchDeadline: true,
  stripeCustomerId: true,
  paddleCustomerId: true,
  status: true,
} as const;

type AccountBillingRow = {
  id: string;
  email: string | null;
  gatewayProvider: AccountGatewayProvider;
  pendingGatewaySwitch: boolean | null;
  pendingGatewayProvider: AccountGatewayProvider | null;
  pendingSwitchScheduledFor: Date | null;
  pendingSwitchDeadline: Date | null;
  stripeCustomerId: string | null;
  paddleCustomerId: string | null;
  status: string;
};

function rowToFields(row: AccountBillingRow): AccountBillingFields {
  return {
    id: row.id,
    email: row.email,
    gatewayProvider: row.gatewayProvider,
    pendingGatewaySwitch: row.pendingGatewaySwitch,
    pendingGatewayProvider: row.pendingGatewayProvider,
    pendingSwitchScheduledFor: row.pendingSwitchScheduledFor,
    pendingSwitchDeadline: row.pendingSwitchDeadline,
    stripeCustomerId: row.stripeCustomerId,
    paddleCustomerId: row.paddleCustomerId,
    status: row.status,
  };
}

export class PrismaAccountBillingRepository implements AccountBillingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(
    accountId: string
  ): Promise<Result<AccountBillingFields | null, AccountBillingStoreError>> {
    try {
      const row = await this.prisma.account.findUnique({
        where: { id: accountId },
        select: ACCOUNT_BILLING_SELECT,
      });
      return ok(row ? rowToFields(row as AccountBillingRow) : null);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async findByExternalCustomerId(
    gateway: AccountGatewayProvider,
    customerId: string
  ): Promise<Result<AccountBillingFields | null, AccountBillingStoreError>> {
    try {
      const where =
        gateway === "STRIPE" ? { stripeCustomerId: customerId } : { paddleCustomerId: customerId };
      const row = await this.prisma.account.findFirst({
        where,
        select: ACCOUNT_BILLING_SELECT,
      });
      return ok(row ? rowToFields(row as AccountBillingRow) : null);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async updateBillingFields(
    accountId: string,
    update: AccountBillingUpdate
  ): Promise<Result<void, AccountBillingStoreError>> {
    try {
      await this.prisma.account.update({
        where: { id: accountId },
        data: update,
      });
      return ok(undefined);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        return err("NOT_FOUND");
      }
      return err("DATABASE_ERROR");
    }
  }
}
