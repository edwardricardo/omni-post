/**
 * @file PrismaCrisisProjectRepository.ts
 * @description Prisma adapter implementing CrisisProjectRepository for crisis mode operations.
 *              Receives PrismaClient via constructor injection.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import { Project, ProjectId, AccountId, EntityNotFoundError } from "@core/domain/index.js";
import type { CrisisProjectRepository } from "@core/crisis/types.js";

/**
 * PrismaCrisisProjectRepository - Implements CrisisProjectRepository using Prisma
 *
 * This is an ADAPTER in the hexagonal architecture - it implements
 * the repository PORT defined in the application layer for crisis operations.
 */
export class PrismaCrisisProjectRepository implements CrisisProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(projectId: ProjectId): Promise<Result<Project, EntityNotFoundError>> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId.value },
      include: { account: true },
    });

    if (!project) {
      return err(new EntityNotFoundError("Project", projectId.value));
    }

    // Reconstitute domain Project
    const locale = (project.locale ?? "en") as "es" | "en" | "pt";
    const historyData = (project.crisisModeHistory ?? []) as Array<{
      reason: string;
      startedAt: string;
      endedAt?: string;
    }>;

    return ok(
      Project.reconstitute(ProjectId.fromStringUnsafe(project.id), {
        accountId: AccountId.fromStringUnsafe(project.accountId),
        name: project.name,
        locale,
        isInCrisisMode: project.isInCrisisMode,
        ...(project.crisisStartedAt && { crisisStartedAt: project.crisisStartedAt }),
        ...(project.crisisReason && { crisisReason: project.crisisReason }),
        crisisModeHistory: historyData.map((entry) => ({
          reason: entry.reason,
          startedAt: new Date(entry.startedAt),
          ...(entry.endedAt && { endedAt: new Date(entry.endedAt) }),
        })),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      })
    );
  }

  async save(project: Project): Promise<Result<void, Error>> {
    try {
      await this.prisma.project.update({
        where: { id: project.id.value },
        data: {
          isInCrisisMode: project.isInCrisisMode,
          crisisStartedAt: project.crisisStartedAt ?? null,
          crisisReason: project.crisisReason ?? null,
          crisisModeHistory: project.crisisModeHistory.map((entry) => ({
            reason: entry.reason,
            startedAt: entry.startedAt.toISOString(),
            ...(entry.endedAt && { endedAt: entry.endedAt.toISOString() }),
          })),
          updatedAt: new Date(),
        },
      });
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
