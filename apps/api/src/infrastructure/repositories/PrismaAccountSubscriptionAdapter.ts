/**
 * @file PrismaAccountSubscriptionAdapter.ts
 * @description Prisma adapter for AccountSubscriptionPort.
 * @layer infrastructure
 */

import { prisma } from "@infra/prisma";
import type {
  AccountSubscriptionPort,
  CreateAccountSubscriptionParams,
} from "../../domain/repositories/AccountSubscriptionPort.js";

export class PrismaAccountSubscriptionAdapter implements AccountSubscriptionPort {
  async createForNewAccount(params: CreateAccountSubscriptionParams): Promise<void> {
    await prisma.accountSubscription.create({
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
}
