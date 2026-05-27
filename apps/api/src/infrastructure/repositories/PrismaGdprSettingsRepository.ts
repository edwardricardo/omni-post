/**
 * @file PrismaGdprSettingsRepository.ts
 * @description Prisma adapter implementing `GdprSettingsRepository`.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type {
  DpoType,
  GdprSettings,
  GdprSettingsRepository,
  GdprSettingsStoreError,
  JurisdictionType,
} from "@core/domain/repositories/GdprSettingsRepository.js";

type GdprRow = {
  id: string;
  privacyPolicyUrl: string | null;
  cookiePolicyUrl: string | null;
  termsOfServiceUrl: string | null;
  dpoType: DpoType;
  dpoEmail: string | null;
  dpoUrl: string | null;
  dataRetentionDays: number;
  auditLogRetentionDays: number;
  enableAutoDataDeletion: boolean;
  dsarResponseDays: number;
  defaultJurisdiction: JurisdictionType;
  enableRightToErasure: boolean;
  enableDataExport: boolean;
  enableDataAccess: boolean;
  enableBreachNotification: boolean;
  updatedAt: Date;
  updatedBy: string | null;
};

function rowToFields(row: GdprRow): GdprSettings {
  return row;
}

export class PrismaGdprSettingsRepository implements GdprSettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findSingleton(): Promise<Result<GdprSettings | null, GdprSettingsStoreError>> {
    try {
      const row = await this.prisma.gdprSettings.findFirst();
      return ok(row ? rowToFields(row as GdprRow) : null);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async createDefault(id: string): Promise<Result<GdprSettings, GdprSettingsStoreError>> {
    try {
      const row = await this.prisma.gdprSettings.create({ data: { id } });
      return ok(rowToFields(row as GdprRow));
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async update(
    id: string,
    fields: Partial<Omit<GdprSettings, "id" | "updatedAt">>
  ): Promise<Result<GdprSettings, GdprSettingsStoreError>> {
    try {
      const row = await this.prisma.gdprSettings.update({
        where: { id },
        data: { ...fields, updatedAt: new Date() },
      });
      return ok(rowToFields(row as GdprRow));
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
