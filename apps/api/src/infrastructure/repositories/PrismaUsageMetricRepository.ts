/**
 * @file PrismaUsageMetricRepository.ts
 * @description Prisma adapter implementing the UsageMetricRepository port.
 *   Uses upsert with atomic increments for concurrent-safe counter updates.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  UsageMetricRepository,
  UsageMetricData,
} from "../../domain/repositories/UsageMetricRepository.js";

export class PrismaUsageMetricRepository implements UsageMetricRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async increment(
    accountId: string,
    year: number,
    month: number,
    field: "postsPublished" | "aiCallsMade",
    delta = 1
  ): Promise<void> {
    await this.prisma.usageMetric.upsert({
      where: {
        accountId_periodYear_periodMonth: { accountId, periodYear: year, periodMonth: month },
      },
      create: {
        accountId,
        periodYear: year,
        periodMonth: month,
        [field]: delta,
      },
      update: {
        [field]: { increment: delta },
      },
    });
  }

  async set(
    accountId: string,
    year: number,
    month: number,
    field: "storageGb" | "teamMemberCount",
    value: number
  ): Promise<void> {
    await this.prisma.usageMetric.upsert({
      where: {
        accountId_periodYear_periodMonth: { accountId, periodYear: year, periodMonth: month },
      },
      create: {
        accountId,
        periodYear: year,
        periodMonth: month,
        [field]: value,
      },
      update: { [field]: value },
    });
  }

  async findByPeriod(
    accountId: string,
    year: number,
    month: number
  ): Promise<UsageMetricData | null> {
    return this.prisma.usageMetric.findUnique({
      where: {
        accountId_periodYear_periodMonth: { accountId, periodYear: year, periodMonth: month },
      },
    });
  }
}
