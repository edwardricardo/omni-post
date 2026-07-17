/**
 * @file ExternalNotificationConfigRepository.ts
 * @description Domain port for external notification configuration persistence.
 *   Defines the contract for CRUD operations on Slack/Teams webhook configs.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type DomainError } from "../errors/index.js";

/**
 * Supported notification channels
 */
export type NotificationChannel = "slack" | "teams";

/**
 * Data transfer object for external notification configuration
 */
export interface ExternalNotificationConfigData {
  id: string;
  /**
   * Owning account. Denormalized from `Project.accountId` so the row is
   * enrolled in the two-layer tenant guard (Prisma `$extends` + RLS). Set once
   * at create time from the guard-resolved parent project; never repointed.
   */
  accountId: string;
  projectId: string;
  channel: NotificationChannel;
  webhookUrl: string;
  label: string;
  events: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @interface ExternalNotificationConfigRepository
 * @description Port for external notification config persistence.
 *   Implementations must return Result rather than throwing.
 */
export interface ExternalNotificationConfigRepository {
  /** Create or update a notification config */
  save(
    config: ExternalNotificationConfigData
  ): Promise<Result<ExternalNotificationConfigData, DomainError>>;

  /** Find a config by its ID */
  findById(id: string): Promise<Result<ExternalNotificationConfigData, DomainError>>;

  /** Find all configs for a given project */
  findByProjectId(
    projectId: string
  ): Promise<Result<ExternalNotificationConfigData[], DomainError>>;

  /** Find active configs matching a specific event for a project */
  findActiveByProjectAndEvent(
    projectId: string,
    event: string
  ): Promise<Result<ExternalNotificationConfigData[], DomainError>>;

  /** Delete a config by ID */
  delete(id: string): Promise<Result<void, DomainError>>;
}
