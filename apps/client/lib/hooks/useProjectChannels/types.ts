/**
 * @file types.ts
 * @description Public types for the project-scoped channels hook module — the
 *              canonical Channel shape returned by the channel endpoints and
 *              the input for the set-primary mutation.
 * @layer infrastructure
 */

/**
 * Provider type identifiers as exposed by the backend's `Provider` enum.
 * Kept loose (string) for forward compatibility with future providers without
 * forcing client recompilation. Consumers may narrow with a type guard if needed.
 */
export type ChannelProvider = string;

/**
 * Connection status as exposed by the backend `CONNECTION_STATUS` constant.
 */
export type ChannelStatus = "CONNECTED" | "DISCONNECTED" | "ERROR" | "EXPIRED" | "PENDING";

/**
 * The canonical Channel shape returned by the backend channel routes
 * (`GET /projects/:projectId/channels`, `GET /channels/:id`, etc.). Mirrors
 * `toChannelView` in `apps/api/src/channels/channelRoutes.ts`.
 */
export interface ProjectChannel {
  id: string;
  projectId: string;
  projectName: string;
  /** Backend exposes the display name as `name` (accountName ?? handle). */
  name: string;
  /** Backend exposes the provider type as `platform` (alias of `provider`). */
  platform: ChannelProvider;
  /** Provider enum value, e.g. "FACEBOOK" — duplicate of `platform`. */
  provider: ChannelProvider;
  /** Human-readable provider name, e.g. "Facebook", "X (Twitter)". */
  providerName: string;
  /** Raw social-platform handle/username (immutable across reconnects). */
  handle: string;
  /** Display name from the OAuth profile (`@miempresa`). Null if never set. */
  accountName: string | null;
  /** Avatar URL from the OAuth profile. Null if not provided. */
  profileImage: string | null;
  isPrimary: boolean;
  /** Derived: `status === CONNECTED && !needsReauth`. */
  isConnected: boolean;
  /** Admin-triggered "force reconnect" flag. */
  needsReauth: boolean;
  status: ChannelStatus;
  /** Timestamp of the most recent successful OAuth grant (ISO 8601). */
  connectedAt: string | null;
  /**
   * Timestamp of the most recent natural token expiry (ISO 8601). Never
   * cleared on reconnect — preserves the audit history.
   */
  expiredAt: string | null;
  /** Last time this channel published successfully (ISO 8601). */
  lastUsedAt: string | null;
  /** Aggregated usage counters surfaced by the listing endpoint. */
  usage: {
    postsThisMonth: number;
  };
  createdAt: string;
  updatedAt: string;
}
