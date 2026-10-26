/**
 * @file PrismaCrisisProjectRepository.ts
 * @description Prisma adapter implementing CrisisProjectRepository for crisis mode operations.
 *              Receives PrismaClient via constructor injection.
 * @layer infrastructure
 */

import type { Prisma, PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import {
  Project,
  ProjectId,
  AccountId,
  EntityNotFoundError,
  contentLocaleFromStorage,
} from "@core/domain/index.js";
import type { CrisisProjectRepository } from "@core/crisis/types.js";
import { PrismaUnitOfWork } from "@adapters/db-prisma";

/** The interactive-transaction client Prisma hands a `$transaction` callback. */
type TxClient = Prisma.TransactionClient;

/**
 * PrismaCrisisProjectRepository - Implements CrisisProjectRepository using Prisma
 *
 * This is an ADAPTER in the hexagonal architecture - it implements
 * the repository PORT defined in the application layer for crisis operations.
 */
export class PrismaCrisisProjectRepository implements CrisisProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findById
   * @description Reads a live project with its crisis state. A stored locale outside
   *   CONTENT_LOCALES throws the InvalidValueError that names the project and the value.
   * @param projectId - The project's id.
   * @returns The project, or EntityNotFoundError when no live project has the id.
   */
  async findById(projectId: ProjectId): Promise<Result<Project, EntityNotFoundError>> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId.value, deletedAt: null },
      include: { account: true },
    });

    if (!project) {
      return err(new EntityNotFoundError("Project", projectId.value));
    }

    // Reconstitute domain Project; a stored locale outside CONTENT_LOCALES fails the read.
    const locale = contentLocaleFromStorage(project.locale, `Project ${project.id}`);
    if (!locale.ok) throw locale.error;
    const historyData = (project.crisisModeHistory ?? []) as Array<{
      reason: string;
      startedAt: string;
      endedAt?: string;
    }>;

    return ok(
      Project.reconstitute(ProjectId.fromStringUnsafe(project.id), {
        accountId: AccountId.fromStringUnsafe(project.accountId),
        name: project.name,
        locale: locale.value,
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

  /**
   * Resolve the client the CURRENT call must run on: the Unit of Work's transaction client when
   * one is active in this async context, the injected base client otherwise. A write issued on
   * the base client while a unit of work is open runs on a DIFFERENT connection — outside the
   * caller's atomicity and outside the `app.account_id` the unit of work bound at tx start.
   * Under a superuser that only broke atomicity, silently; under the application role the
   * `tenant_isolation` policy hides the row from the UPDATE and the write fails outright.
   */
  private getClient(): PrismaClient | TxClient {
    return PrismaUnitOfWork.getTransactionClient() ?? this.prisma;
  }

  /**
   * @method save
   * @description Writes a project's crisis state on the active unit of work's transaction, or on
   *   the base client when none is open.
   * @param project - The project whose crisis state is written.
   * @returns ok, or the error the write raised.
   */
  async save(project: Project): Promise<Result<void, Error>> {
    try {
      await this.getClient().project.update({
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
