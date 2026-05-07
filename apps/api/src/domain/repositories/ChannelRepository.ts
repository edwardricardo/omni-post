/**
 * @file ChannelRepository.ts
 * @description Repository port for Channel entity persistence — defines the contract for finding, saving, and deleting social media channels by ID or project.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type Channel } from "../entities/Channel.js";
import { type ChannelId, type ProjectId } from "../value-objects/EntityId.js";
import { type Provider } from "../value-objects/Provider.js";
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
   * Find all channels belonging to a project for a specific provider.
   * Used by SetPrimaryChannelUseCase to locate sibling channels that may
   * already hold the primary flag for the same (project, provider) pair.
   */
  findByProjectAndProvider(projectId: ProjectId, provider: Provider): Promise<Channel[]>;

  /**
   * Bulk-set `needsReauth = true` on every active channel for a provider
   * (cross-tenant). Returns count + list of affected channelIds for audit.
   *
   * DOCUMENTED EXCEPTION to the per-entity markForReauth() pattern: O(N)
   * entity-load-and-save would be prohibitive at scale (10k channels per
   * provider). Implemented as a single SQL UPDATE in the adapter.
   */
  bulkMarkForReauthByProvider(
    provider: Provider,
    reason: string
  ): Promise<{ count: number; channelIds: string[] }>;

  /**
   * Bulk-soft-delete every active channel for a provider (sets deletedAt).
   * Cross-tenant. Destructive — tenants must reconnect from scratch.
   * Returns count + list of affected channelIds for audit.
   */
  bulkSoftDeleteByProvider(provider: Provider): Promise<{ count: number; channelIds: string[] }>;

  /**
   * Find the primary channel for a (project, provider) pair, if any.
   * Returns NotFoundError when no primary has been set yet for that pair.
   */
  findPrimaryByProjectAndProvider(
    projectId: ProjectId,
    provider: Provider
  ): Promise<Result<Channel, EntityNotFoundError>>;

  /**
   * Resolve "is this OAuth grant for an existing Channel or a new one?"
   * Lookup by the (projectId, provider, providerAccountId) tuple — the
   * provider-supplied account ID is what makes a connection re-identifiable
   * across reconnects (the user's underlying social account ID never
   * changes; tokens do). Returns null when no Channel matches; the OAuth
   * callback then creates a fresh row.
   */
  findByProjectProviderAccount(
    projectId: ProjectId,
    provider: Provider,
    providerAccountId: string
  ): Promise<Channel | null>;

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
