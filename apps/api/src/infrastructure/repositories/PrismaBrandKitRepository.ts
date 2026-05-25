/**
 * @file PrismaBrandKitRepository.ts
 * @description Prisma implementation of BrandKitRepository. Uses upsert to enforce
 *              the one-brand-kit-per-account constraint at the DB level.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  BrandKitRepository,
  BrandKitData,
} from "@core/domain/repositories/BrandKitRepository.js";

export class PrismaBrandKitRepository implements BrandKitRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByAccountId(accountId: string): Promise<BrandKitData | null> {
    const row = await this.prisma.brandKit.findUnique({ where: { accountId } });
    return row ? this.toData(row) : null;
  }

  async upsert(data: Omit<BrandKitData, "id" | "createdAt" | "updatedAt">): Promise<BrandKitData> {
    const row = await this.prisma.brandKit.upsert({
      where: { accountId: data.accountId },
      create: {
        accountId: data.accountId,
        primaryColor: data.primaryColor,
        secondaryColor: data.secondaryColor,
        accentColor: data.accentColor,
        logoUrl: data.logoUrl,
        logoStorageKey: data.logoStorageKey,
        fontPrimary: data.fontPrimary,
        fontSecondary: data.fontSecondary,
      },
      update: {
        primaryColor: data.primaryColor,
        secondaryColor: data.secondaryColor,
        accentColor: data.accentColor,
        logoUrl: data.logoUrl,
        logoStorageKey: data.logoStorageKey,
        fontPrimary: data.fontPrimary,
        fontSecondary: data.fontSecondary,
      },
    });
    return this.toData(row);
  }

  async deleteByAccountId(accountId: string): Promise<void> {
    await this.prisma.brandKit.deleteMany({ where: { accountId } });
  }

  private toData(row: {
    id: string;
    accountId: string;
    primaryColor: string | null;
    secondaryColor: string | null;
    accentColor: string | null;
    logoUrl: string | null;
    logoStorageKey: string | null;
    fontPrimary: string | null;
    fontSecondary: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): BrandKitData {
    return {
      id: row.id,
      accountId: row.accountId,
      primaryColor: row.primaryColor,
      secondaryColor: row.secondaryColor,
      accentColor: row.accentColor,
      logoUrl: row.logoUrl,
      logoStorageKey: row.logoStorageKey,
      fontPrimary: row.fontPrimary,
      fontSecondary: row.fontSecondary,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
