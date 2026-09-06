/**
 * @file PrismaAccountNotificationRepository.ts
 * @description Prisma adapter implementing `AccountNotificationReader`: returns
 *   active account emails for breach-notification fan-out.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type {
  AccountNotificationReader,
  AccountNotificationReadError,
} from "@core/domain/repositories/AccountNotificationReader.js";

export class PrismaAccountNotificationRepository implements AccountNotificationReader {
  constructor(private readonly prisma: PrismaClient) {}

  async listActiveEmails(): Promise<Result<string[], AccountNotificationReadError>> {
    try {
      const rows = await this.prisma.account.findMany({
        where: { isActive: true, deletedAt: null },
        select: { email: true },
      });
      return ok(rows.map((r) => r.email).filter((e): e is string => e !== null && e !== ""));
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
