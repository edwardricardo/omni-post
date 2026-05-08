/**
 * @file SecretRotationLogPrismaReadRepository.ts
 * @description Prisma read-side adapter for SecretRotationLog. Returns the most
 *              recent rotation event per secret name. Backed by the composite
 *              index (secretName, rotatedAt DESC) defined in the schema.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { SecretRotationLogReadRepository } from "../../application/security/GetSecretRotationStatusQuery.js";

export class SecretRotationLogPrismaReadRepository implements SecretRotationLogReadRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findLatestBySecretNames(
    names: readonly string[]
  ): Promise<Map<string, { rotatedAt: Date; rotatedBy: string | null }>> {
    if (names.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.secretRotationLog.findMany({
      where: { secretName: { in: [...names] } },
      orderBy: [{ secretName: "asc" }, { rotatedAt: "desc" }],
      select: { secretName: true, rotatedAt: true, rotatedBy: true },
    });

    const result = new Map<string, { rotatedAt: Date; rotatedBy: string | null }>();
    for (const row of rows) {
      if (!result.has(row.secretName)) {
        result.set(row.secretName, {
          rotatedAt: row.rotatedAt,
          rotatedBy: row.rotatedBy,
        });
      }
    }
    return result;
  }
}
