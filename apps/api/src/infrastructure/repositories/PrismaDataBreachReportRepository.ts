/**
 * @file PrismaDataBreachReportRepository.ts
 * @description Prisma adapter implementing `DataBreachReportRepository`.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type {
  DataBreachCreateInput,
  DataBreachListFilters,
  DataBreachReport,
  DataBreachReportRepository,
  DataBreachStoreError,
  DataBreachUpdateInput,
} from "@core/domain/repositories/DataBreachReportRepository.js";

export class PrismaDataBreachReportRepository implements DataBreachReportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(
    filters: DataBreachListFilters
  ): Promise<Result<{ reports: DataBreachReport[]; total: number }, DataBreachStoreError>> {
    try {
      const where: Record<string, unknown> = {};
      if (filters.resolved !== undefined) where.resolved = filters.resolved;

      const [reports, total] = await Promise.all([
        this.prisma.dataBreachReport.findMany({
          where,
          orderBy: { reportedAt: "desc" },
          skip: (filters.page - 1) * filters.limit,
          take: filters.limit,
        }),
        this.prisma.dataBreachReport.count({ where }),
      ]);

      return ok({ reports: reports as DataBreachReport[], total });
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async findById(id: string): Promise<Result<DataBreachReport | null, DataBreachStoreError>> {
    try {
      const row = await this.prisma.dataBreachReport.findUnique({ where: { id } });
      return ok(row as DataBreachReport | null);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async create(
    input: DataBreachCreateInput
  ): Promise<Result<DataBreachReport, DataBreachStoreError>> {
    try {
      const row = await this.prisma.dataBreachReport.create({
        data: {
          title: input.title,
          description: input.description,
          discoveredAt: input.discoveredAt,
          severity: input.severity,
          dataTypesAffected: input.dataTypesAffected,
          reportedBy: input.reportedBy,
          ...(input.affectedUserCount !== undefined && {
            affectedUserCount: input.affectedUserCount,
          }),
        },
      });
      return ok(row as DataBreachReport);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async update(
    id: string,
    fields: DataBreachUpdateInput
  ): Promise<Result<void, DataBreachStoreError>> {
    try {
      await this.prisma.dataBreachReport.update({
        where: { id },
        data: fields,
      });
      return ok(undefined);
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
