/**
 * @file PrismaExternalNotificationConfigRepository.ts
 * @description Infrastructure adapter implementing ExternalNotificationConfigRepository
 *   using Prisma ORM for PostgreSQL persistence.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import {
  type ExternalNotificationConfigRepository,
  type ExternalNotificationConfigData,
  type NotificationChannel,
} from "../../domain/repositories/ExternalNotificationConfigRepository.js";
import { type DomainError, EntityNotFoundError } from "../../domain/errors/index.js";

/**
 * @class PrismaExternalNotificationConfigRepository
 * @description Prisma adapter for external notification config persistence.
 */
export class PrismaExternalNotificationConfigRepository
  implements ExternalNotificationConfigRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method save
   * @description Creates or updates an external notification configuration.
   */
  async save(
    config: ExternalNotificationConfigData
  ): Promise<Result<ExternalNotificationConfigData, DomainError>> {
    try {
      const record = await this.prisma.externalNotificationConfig.upsert({
        where: { id: config.id },
        create: {
          id: config.id,
          projectId: config.projectId,
          channel: config.channel,
          webhookUrl: config.webhookUrl,
          label: config.label,
          events: config.events,
          isActive: config.isActive,
        },
        update: {
          channel: config.channel,
          webhookUrl: config.webhookUrl,
          label: config.label,
          events: config.events,
          isActive: config.isActive,
        },
      });

      return ok(this.toData(record));
    } catch (error) {
      return err(
        new EntityNotFoundError(
          "ExternalNotificationConfig",
          `save failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * @method findById
   * @description Finds a config by its unique identifier.
   */
  async findById(id: string): Promise<Result<ExternalNotificationConfigData, DomainError>> {
    const record = await this.prisma.externalNotificationConfig.findUnique({
      where: { id },
    });

    if (!record) {
      return err(new EntityNotFoundError("ExternalNotificationConfig", id));
    }

    return ok(this.toData(record));
  }

  /**
   * @method findByProjectId
   * @description Finds all configs for a given project.
   */
  async findByProjectId(
    projectId: string
  ): Promise<Result<ExternalNotificationConfigData[], DomainError>> {
    const records = await this.prisma.externalNotificationConfig.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    return ok(records.map((r) => this.toData(r)));
  }

  /**
   * @method findActiveByProjectAndEvent
   * @description Finds active configs for a project that subscribe to a specific event.
   */
  async findActiveByProjectAndEvent(
    projectId: string,
    event: string
  ): Promise<Result<ExternalNotificationConfigData[], DomainError>> {
    const records = await this.prisma.externalNotificationConfig.findMany({
      where: {
        projectId,
        isActive: true,
        events: { has: event },
      },
    });

    return ok(records.map((r) => this.toData(r)));
  }

  /**
   * @method delete
   * @description Deletes a config by its ID.
   */
  async delete(id: string): Promise<Result<void, DomainError>> {
    const exists = await this.prisma.externalNotificationConfig.findUnique({
      where: { id },
    });

    if (!exists) {
      return err(new EntityNotFoundError("ExternalNotificationConfig", id));
    }

    await this.prisma.externalNotificationConfig.delete({ where: { id } });
    return ok(undefined);
  }

  /**
   * Maps a Prisma record to the domain data shape.
   */
  private toData(record: {
    id: string;
    projectId: string;
    channel: string;
    webhookUrl: string;
    label: string;
    events: string[];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ExternalNotificationConfigData {
    return {
      id: record.id,
      projectId: record.projectId,
      channel: record.channel as NotificationChannel,
      webhookUrl: record.webhookUrl,
      label: record.label,
      events: record.events,
      isActive: record.isActive,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
