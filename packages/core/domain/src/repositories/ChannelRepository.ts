/**
 * @file ChannelRepository.ts
 * @description Repository port for Channel entity persistence — defines the contract for finding, saving, and deleting social media channels by ID or project.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type Channel } from "../entities/Channel.js";
import { type ChannelId, type ProjectId, type AccountId } from "../value-objects/EntityId.js";
import { type Provider, type ProviderType } from "../value-objects/Provider.js";
import { type EntityNotFoundError } from "../errors/index.js";

/**
 * Lightweight, credential-free projection of a channel for connection listings.
 * Avoids the credential decryption that `toDomain()` performs — connection
 * views never need the OAuth tokens, only the display + status metadata.
 */
export interface ChannelConnectionView {
  id: string;
  provider: ProviderType;
  handle: string;
  accountName: string | null;
  profileImage: string | null;
  connectedAt: Date | null;
  lastUsedAt: Date | null;
  expiredAt: Date | null;
  needsReauth: boolean;
}

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
   * Account-scoped connection views for a project (no credential decryption).
   * Returns ONLY channels whose project belongs to `accountId` — this is the
   * tenancy filter that stops a caller from reading another account's channels
   * by guessing a projectId. Used by the OAuth connections listing.
   */
  findConnectionViewsByProjectScopedToAccount(
    projectId: ProjectId,
    accountId: AccountId
  ): Promise<ChannelConnectionView[]>;

  /**
   * Resolve the owning account ID of a channel for an ownership check, without
   * decrypting credentials. Returns NotFound when the channel does not exist or
   * is soft-deleted. Used by the OAuth disconnect flow to enforce tenancy.
   */
  findOwnerAccountIdByChannelId(channelId: ChannelId): Promise<Result<string, EntityNotFoundError>>;

  /**
   * Lightweight ownership lookup — returns ONLY channel IDs for a project.
   * Bypasses credential decryption that the full toDomain() does, which is
   * unnecessary (and can fail on dev fixtures with placeholder ciphertext)
   * for cases that just need a "does channel X belong to project Y?" check.
   * Used by the saga admission path before kicking off publish jobs.
   */
  findIdsByProjectId(projectId: ProjectId): Promise<ChannelId[]>;

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
   * Batch lookup of "posts published this calendar month" per channel id.
   * Returns a Map keyed by channel id; channels with zero posts may be
   * absent from the map (caller defaults to 0). Used by the channel-list
   * mapper to populate `usage.postsThisMonth` without an N+1.
   */
  findUsageByChannelIds(channelIds: string[]): Promise<Map<string, { postsThisMonth: number }>>;

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
   *
   * Guarded by the `account:manage` admin permission, which is seeded to
   * SUPER_ADMIN AND to ADMIN — not to SUPER_ADMIN alone.
   *
   * Destroys, by database cascade: `PublishLog`, `Analytics`, the channel's
   * entire inbox history (`SocialConversation` and every `SocialMessage` in
   * it), and the rolled-up `AnalyticsDailySummary` / `AnalyticsMonthlySummary`.
   * `Mention` rows survive with their `channelId` nulled, hence unattributed.
   */
  hardDelete(id: ChannelId): Promise<Result<void, EntityNotFoundError>>;
}
