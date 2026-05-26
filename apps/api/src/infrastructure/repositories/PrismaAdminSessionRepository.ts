/**
 * @file PrismaAdminSessionRepository.ts
 * @description Prisma adapter implementing AdminSessionRepository.
 *              Receives PrismaClient via constructor injection; mutations resolve
 *              the active UoW transaction client per call.
 * @layer infrastructure
 */

import type { PrismaClient, Prisma } from "@infra/prisma";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";
import type {
  AdminSessionRepository,
  AdminSessionDto,
  AdminSessionCreateInput,
  AdminSessionFindOptions,
} from "@core/domain/repositories/AdminSessionRepository.js";

/**
 * Prisma implementation of AdminSessionRepository.
 *
 * Register as a singleton in the DI container via TOKENS.AdminSessionRepository.
 */
export class PrismaAdminSessionRepository implements AdminSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Resolve the active UoW transaction client, or the base client. */
  private getClient(): PrismaClient | Prisma.TransactionClient {
    return PrismaUnitOfWork.getTransactionClient() ?? this.prisma;
  }

  /**
   * Persist a new session.
   *
   * @param input - Session fields; ipAddress/userAgent default to null when omitted
   * @returns The created session row as an AdminSessionDto
   */
  async create(input: AdminSessionCreateInput): Promise<AdminSessionDto> {
    const row = await this.getClient().adminSession.create({
      data: {
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        ...(input.ipAddress !== undefined && { ipAddress: input.ipAddress }),
        ...(input.userAgent !== undefined && { userAgent: input.userAgent }),
      },
    });
    // Prisma `location` is Json, compatible with domain JsonValue — safe cast.
    return row as unknown as AdminSessionDto;
  }

  /**
   * Rotate the stored refresh-token hash for a session.
   *
   * @param id - AdminSession primary key
   * @param refreshTokenHash - New SHA-256 hex digest of the refresh token
   */
  async updateRefreshTokenHash(id: string, refreshTokenHash: string): Promise<void> {
    await this.getClient().adminSession.update({
      where: { id },
      data: { refreshTokenHash },
    });
  }

  /**
   * List a user's sessions, newest first.
   *
   * @param userId - Owning AdminUser id
   * @param options - Optional active-only filter and result limit
   * @returns Matching session rows as AdminSessionDto records
   */
  async findByUserId(
    userId: string,
    options?: AdminSessionFindOptions
  ): Promise<AdminSessionDto[]> {
    const rows = await this.prisma.adminSession.findMany({
      where: { userId, ...(options?.activeOnly && { isActive: true }) },
      orderBy: { createdAt: "desc" },
      ...(options?.limit !== undefined && { take: options.limit }),
    });
    // Prisma `location` is Json, compatible with domain JsonValue — safe cast.
    return rows as unknown as AdminSessionDto[];
  }

  /**
   * Revoke every active session belonging to a user.
   *
   * @param userId - Owning AdminUser id
   * @returns Count of sessions revoked
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.getClient().adminSession.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false, revokedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Permanently delete every session belonging to a user.
   *
   * @param userId - Owning AdminUser id
   * @returns Count of sessions deleted
   */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await this.getClient().adminSession.deleteMany({
      where: { userId },
    });
    return result.count;
  }
}
