/**
 * @file GetSecretRotationStatusQuery.ts
 * @description CQRS read-side query that returns rotation status DTOs for every
 *              secret in the catalog. Combines the catalog (domain), the latest
 *              rotation event per secret (read repository), and the cadence
 *              rules (domain) into a flat DTO list.
 * @layer application
 */

import { type Result, ok } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import {
  SECRET_CATEGORIES,
  SECRETS_CATALOG,
  type SecretCategory,
} from "@core/domain/security/secretCatalog.js";
import { calculateStatus, type RotationStatus } from "@core/domain/security/rotationStatusRules.js";

/**
 * Read-side repository contract. Defined inline here because there's a single
 * consumer; promote to `packages/ports/core/` only if a second consumer appears.
 */
export interface SecretRotationLogReadRepository {
  findLatestBySecretNames(
    names: readonly string[]
  ): Promise<Map<string, { rotatedAt: Date; rotatedBy: string | null }>>;
}

export interface SecretRotationStatusDTO {
  secretName: string;
  category: SecretCategory;
  description: string;
  cadenceDays: number;
  lastRotatedAt: string | null;
  lastRotatedBy: string | null;
  nextRotationAt: string | null;
  daysUntilDue: number | null;
  status: RotationStatus | "UNKNOWN";
}

export type GetSecretRotationStatusInput = Record<string, never>;
export type GetSecretRotationStatusOutput = readonly SecretRotationStatusDTO[];

export class GetSecretRotationStatusQuery implements UseCase<
  GetSecretRotationStatusInput,
  GetSecretRotationStatusOutput,
  UseCaseError
> {
  constructor(
    private readonly repository: SecretRotationLogReadRepository,
    private readonly clock: () => Date = () => new Date()
  ) {}

  /**
   * @method execute
   * @description Builds one DTO per cataloged secret. Secrets without any
   *              recorded rotation get `status: "UNKNOWN"` and null timestamps.
   * @returns Flat list of SecretRotationStatusDTO ordered by catalog order.
   */
  async execute(): Promise<Result<GetSecretRotationStatusOutput, UseCaseError>> {
    try {
      const names = SECRETS_CATALOG.map((entry) => entry.name);
      const latestByName = await this.repository.findLatestBySecretNames(names);
      const now = this.clock();

      const dtos: SecretRotationStatusDTO[] = SECRETS_CATALOG.map((entry) => {
        const cadenceDays = SECRET_CATEGORIES[entry.category].cadenceDays;
        const latest = latestByName.get(entry.name);

        if (!latest) {
          return {
            secretName: entry.name,
            category: entry.category,
            description: entry.description,
            cadenceDays,
            lastRotatedAt: null,
            lastRotatedBy: null,
            nextRotationAt: null,
            daysUntilDue: null,
            status: "UNKNOWN",
          };
        }

        const { status, nextRotationAt, daysUntilDue } = calculateStatus(
          latest.rotatedAt,
          cadenceDays,
          now
        );

        return {
          secretName: entry.name,
          category: entry.category,
          description: entry.description,
          cadenceDays,
          lastRotatedAt: latest.rotatedAt.toISOString(),
          lastRotatedBy: latest.rotatedBy,
          nextRotationAt: nextRotationAt.toISOString(),
          daysUntilDue,
          status,
        };
      });

      return ok(dtos);
    } catch (error: unknown) {
      return {
        ok: false,
        error: new UseCaseError(
          "Failed to compute secret rotation status",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        ),
      };
    }
  }
}
