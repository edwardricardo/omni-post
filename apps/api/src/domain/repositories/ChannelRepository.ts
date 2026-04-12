/**
 * @file ChannelRepository.ts
 * @description Repository port for Channel entity persistence — defines the contract for finding, saving, and deleting social media channels by ID or project.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type Channel } from "../entities/Channel.js";
import { type ChannelId, type ProjectId } from "../value-objects/EntityId.js";
import { type EntityNotFoundError } from "../errors/index.js";

/**
 * Channel Repository Interface
 *
 * This is a PORT in the hexagonal architecture - it defines what the domain
 * needs from persistence without specifying how it's implemented.
 *
 * Note: Channel does not extend Repository<T, TId> because it lacks
 * the `exists` method — channels are always queried through their
 * parent project or by ID. This keeps the interface minimal.
 */
export interface ChannelRepository {
  /**
   * Find a channel by its ID
   */
  findById(id: ChannelId): Promise<Result<Channel, EntityNotFoundError>>;

  /**
   * Find all channels belonging to a project
   */
  findByProjectId(projectId: ProjectId): Promise<Channel[]>;

  /**
   * Save a channel (create or update)
   */
  save(channel: Channel): Promise<Result<void, Error>>;

  /**
   * Soft-delete a channel (sets deletedAt = now).
   * The channel becomes invisible to all standard find queries.
   */
  delete(id: ChannelId): Promise<Result<void, EntityNotFoundError>>;

  /**
   * Hard-delete a channel and all its data (irreversible).
   * Only callable by SUPER_ADMIN. Cascades to publishLogs, analytics.
   */
  hardDelete(id: ChannelId): Promise<Result<void, EntityNotFoundError>>;
}
