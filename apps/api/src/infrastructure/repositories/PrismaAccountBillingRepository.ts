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
  name: true,
  email: true,
  gatewayProvider: true,
  gatewayCustomerId: true,
  pendingGatewaySwitch: true,
  pendingGatewayProvider: true,
  gatewaySwitchAt: true,
  status: true,
} as const;

type AccountBillingRow = {
  id: string;
  name: string;
  email: string | null;
  gatewayProvider: AccountGatewayProvider;
  gatewayCustomerId: string | null;
  pendingGatewaySwitch: boolean | null;
  pendingGatewayProvider: AccountGatewayProvider | null;
  gatewaySwitchAt: Date | null;
  status: string;
};

function rowToFields(row: AccountBillingRow): AccountBillingFields {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    gatewayProvider: row.gatewayProvider,
    gatewayCustomerId: row.gatewayCustomerId,
    pendingGatewaySwitch: row.pendingGatewaySwitch,
    pendingGatewayProvider: row.pendingGatewayProvider,
    gatewaySwitchAt: row.gatewaySwitchAt,
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

  async findByGatewayCustomerId(
    gateway: AccountGatewayProvider,
    customerId: string
  ): Promise<Result<AccountBillingFields | null, AccountBillingStoreError>> {
    try {
      const row = await this.prisma.account.findFirst({
        where: { gatewayCustomerId: customerId, gatewayProvider: gateway },
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
