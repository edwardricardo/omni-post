/**
 * @file PrismaAuditLogRepository.ts
 * @description Prisma adapter implementing AuditLogRepository. Receives PrismaClient via constructor injection and resolves the active Unit-of-Work transaction client per call.
 * @layer infrastructure
 */

import type { PrismaClient, Prisma } from "@infra/prisma";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import type {
  AuditLogRepository,
  AuditLogCreateInput,
  AuditLogQueryOptions,
  AuditLogRecordDto,
} from "../../domain/repositories/AuditLogRepository.js";

/**
 * Prisma implementation of AuditLogRepository.
 *
 * Register as a singleton in the DI container via TOKENS.AuditLogRepository.
 */
export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Resolve the active transaction client when an audit write happens inside a
   * Unit-of-Work transaction, falling back to the base client otherwise.
   */
  private getClient(): PrismaClient | Prisma.TransactionClient {
    return PrismaUnitOfWork.getTransactionClient() ?? this.prisma;
  }

  /**
   * Persist a single audit-trail entry, including only the columns that carry
   * a value.
   */
  async create(input: AuditLogCreateInput): Promise<void> {
    await this.getClient().auditLog.create({
      data: {
        action: input.action,
        details: input.details as Prisma.InputJsonValue,
        success: input.success,
        ...(input.resource !== undefined && { resource: input.resource }),
        ...(input.resourceId !== undefined && { resourceId: input.resourceId }),
        ...(input.userId !== undefined && { userId: input.userId }),
        ...(input.ipAddress !== undefined && { ipAddress: input.ipAddress }),
        ...(input.userAgent !== undefined && { userAgent: input.userAgent }),
        ...(input.error !== undefined && { error: input.error }),
      },
    });
  }

  /**
   * Return audit entries performed by a user, newest first.
   */
  async findByUser(userId: string, options?: AuditLogQueryOptions): Promise<AuditLogRecordDto[]> {
    return this.getClient().auditLog.findMany({
      where: {
        userId,
        ...(options?.action !== undefined && { action: options.action }),
        ...(options?.startDate !== undefined &&
          options?.endDate !== undefined && {
            createdAt: { gte: options.startDate, lte: options.endDate },
          }),
      },
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });
  }

  /**
   * Return audit entries targeting a given resource, newest first.
   */
  async findByResource(
    resource: string,
    resourceId: string,
    options?: AuditLogQueryOptions
  ): Promise<AuditLogRecordDto[]> {
    return this.getClient().auditLog.findMany({
      where: {
        resource,
        resourceId,
        ...(options?.action !== undefined && { action: options.action }),
        ...(options?.startDate !== undefined &&
          options?.endDate !== undefined && {
            createdAt: { gte: options.startDate, lte: options.endDate },
          }),
      },
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });
  }

  /**
   * Detach a user from their audit entries by nulling the userId, preserving
   * the entries for compliance after the user is deleted.
   */
  async anonymizeUser(userId: string): Promise<number> {
    const result = await this.getClient().auditLog.updateMany({
      where: { userId },
      data: { userId: null },
    });
    return result.count;
  }
}
