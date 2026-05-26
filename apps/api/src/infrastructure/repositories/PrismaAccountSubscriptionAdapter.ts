/**
 * @file PrismaAccountSubscriptionAdapter.ts
 * @description Prisma adapter for AccountSubscriptionPort.
 * @layer infrastructure
 */

import type { PrismaClient, Prisma } from "@infra/prisma";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import type {
  AccountSubscriptionPort,
  CreateAccountSubscriptionParams,
} from "@core/domain/repositories/AccountSubscriptionPort.js";

export class PrismaAccountSubscriptionAdapter implements AccountSubscriptionPort {
  constructor(private readonly prisma: PrismaClient) {}

  /** Resolve the active UoW transaction client, or the base client. */
  private getClient(): PrismaClient | Prisma.TransactionClient {
    return PrismaUnitOfWork.getTransactionClient() ?? this.prisma;
  }

  async createForNewAccount(params: CreateAccountSubscriptionParams): Promise<void> {
    await this.getClient().accountSubscription.create({
      data: {
        accountId: params.accountId,
        status: params.status as never,
        pricePerMonth: params.pricePerMonth,
        maxProjects: params.maxProjects,
        trialEndsAt: params.trialEndsAt,
        billingCycle: params.billingCycle as never,
      },
    });
  }

  async cancelByAccountId(accountId: string): Promise<void> {
    await this.getClient().accountSubscription.updateMany({
      where: { accountId },
      data: { status: "CANCELED" },
    });
  }
}
