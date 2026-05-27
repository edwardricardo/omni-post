/**
 * @file PrismaSecuritySettingsRepository.ts
 * @description Prisma adapter implementing `SecuritySettingsRepository`.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type {
  SecuritySettings,
  SecuritySettingsRepository,
  SecuritySettingsStoreError,
} from "@core/domain/repositories/SecuritySettingsRepository.js";

export class PrismaSecuritySettingsRepository implements SecuritySettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findSingleton(): Promise<Result<SecuritySettings | null, SecuritySettingsStoreError>> {
    try {
      const row = await this.prisma.securitySettings.findFirst();
      return ok(row);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async createDefault(id: string): Promise<Result<SecuritySettings, SecuritySettingsStoreError>> {
    try {
      const row = await this.prisma.securitySettings.create({ data: { id } });
      return ok(row);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async update(
    id: string,
    fields: Partial<Omit<SecuritySettings, "id" | "updatedAt">>
  ): Promise<Result<SecuritySettings, SecuritySettingsStoreError>> {
    try {
      const row = await this.prisma.securitySettings.update({
        where: { id },
        data: { ...fields, updatedAt: new Date() },
      });
      return ok(row);
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
