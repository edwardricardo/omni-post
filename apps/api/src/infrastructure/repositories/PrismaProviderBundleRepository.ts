/**
 * @file PrismaProviderBundleRepository.ts
 * @description Prisma adapter implementing `ProviderBundleReader`. Reads
 *   the active provider bundles for the public plans endpoint, converting
 *   Prisma's `Decimal` price to a plain `number`.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type {
  ProviderBundleReader,
  ProviderBundleReadError,
  ProviderBundleSummary,
} from "@core/domain/repositories/ProviderBundleReader.js";

export class PrismaProviderBundleRepository implements ProviderBundleReader {
  constructor(private readonly prisma: PrismaClient) {}

  async listActive(): Promise<Result<ProviderBundleSummary[], ProviderBundleReadError>> {
    try {
      const rows = await this.prisma.providerBundle.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          providers: true,
          pricePerAccountMonth: true,
          sortOrder: true,
        },
      });

      return ok(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          description: row.description,
          providers: row.providers,
          pricePerAccountMonth: Number(row.pricePerAccountMonth),
          sortOrder: row.sortOrder,
        }))
      );
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
