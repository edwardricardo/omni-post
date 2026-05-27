/**
 * @file PrismaDsarRequestRepository.ts
 * @description Prisma adapter implementing `DsarRequestRepository`.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type {
  DsarListFilters,
  DsarRequestCreateInput,
  DsarRequestRepository,
  DsarRequestRow,
  DsarRequestRowWithAccount,
  DsarRequestStoreError,
  DsarRequestUpdateInput,
} from "@core/domain/repositories/DsarRequestRepository.js";

export class PrismaDsarRequestRepository implements DsarRequestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listWithAccount(
    filters: DsarListFilters
  ): Promise<
    Result<{ requests: DsarRequestRowWithAccount[]; total: number }, DsarRequestStoreError>
  > {
    try {
      const where: Record<string, unknown> = {};
      if (filters.status) where.status = filters.status;
      if (filters.type) where.type = filters.type;

      const [requests, total] = await Promise.all([
        this.prisma.dsarRequest.findMany({
          where,
          include: { account: { select: { id: true, name: true, email: true } } },
          orderBy: { requestedAt: "desc" },
          skip: (filters.page - 1) * filters.limit,
          take: filters.limit,
        }),
        this.prisma.dsarRequest.count({ where }),
      ]);

      return ok({ requests: requests as DsarRequestRowWithAccount[], total });
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async findByIdWithAccount(
    id: string
  ): Promise<Result<DsarRequestRowWithAccount | null, DsarRequestStoreError>> {
    try {
      const row = await this.prisma.dsarRequest.findUnique({
        where: { id },
        include: { account: { select: { id: true, name: true, email: true } } },
      });
      return ok(row as DsarRequestRowWithAccount | null);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async findById(id: string): Promise<Result<DsarRequestRow | null, DsarRequestStoreError>> {
    try {
      const row = await this.prisma.dsarRequest.findUnique({ where: { id } });
      return ok(row as DsarRequestRow | null);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async countPendingByEmail(email: string): Promise<Result<number, DsarRequestStoreError>> {
    try {
      const count = await this.prisma.dsarRequest.count({
        where: {
          requestorEmail: email,
          status: { in: ["PENDING", "IN_PROGRESS"] },
        },
      });
      return ok(count);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async create(
    input: DsarRequestCreateInput
  ): Promise<Result<DsarRequestRow, DsarRequestStoreError>> {
    try {
      const row = await this.prisma.dsarRequest.create({
        data: {
          requestorEmail: input.requestorEmail,
          ...(input.requestorName !== undefined && { requestorName: input.requestorName }),
          type: input.type,
          jurisdiction: input.jurisdiction,
          deadlineAt: input.deadlineAt,
          verificationToken: input.verificationToken,
          ...(input.accountId !== undefined && { accountId: input.accountId }),
          ...(input.ipAddress !== undefined && { ipAddress: input.ipAddress }),
        },
      });
      return ok(row as DsarRequestRow);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async update(
    id: string,
    fields: DsarRequestUpdateInput
  ): Promise<Result<DsarRequestRow, DsarRequestStoreError>> {
    try {
      const row = await this.prisma.dsarRequest.update({
        where: { id },
        data: fields,
      });
      return ok(row as DsarRequestRow);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async markOverdueAsExpired(now: Date): Promise<Result<number, DsarRequestStoreError>> {
    try {
      const result = await this.prisma.dsarRequest.updateMany({
        where: {
          deadlineAt: { lt: now },
          status: { in: ["PENDING", "IN_PROGRESS"] },
        },
        data: { status: "EXPIRED" },
      });
      return ok(result.count);
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
