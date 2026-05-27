/**
 * @file PrismaPlatformEncryptionKeyRepository.ts
 * @description Prisma adapter implementing `PlatformEncryptionKeyRepository`.
 *   Translates Prisma errors to `EncryptionKeyStoreError` codes.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type {
  PlatformEncryptionKey,
  PlatformEncryptionKeyRepository,
  PlatformEncryptionKeyRotation,
  EncryptionKeyStoreError,
} from "@core/domain/repositories/PlatformEncryptionKeyRepository.js";

export class PrismaPlatformEncryptionKeyRepository implements PlatformEncryptionKeyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveLatest(): Promise<Result<PlatformEncryptionKey | null, EncryptionKeyStoreError>> {
    try {
      const row = await this.prisma.platformEncryptionKey.findFirst({
        where: { isActive: true },
        orderBy: { keyVersion: "desc" },
        select: { keyVersion: true },
      });
      return ok(row);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async createRotation(
    rotation: PlatformEncryptionKeyRotation
  ): Promise<Result<void, EncryptionKeyStoreError>> {
    try {
      await this.prisma.platformEncryptionKey.create({
        data: {
          keyVersion: rotation.keyVersion,
          rotatedBy: rotation.rotatedBy,
          ...(rotation.note !== undefined && { note: rotation.note }),
          isActive: true,
        },
      });
      return ok(undefined);
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
