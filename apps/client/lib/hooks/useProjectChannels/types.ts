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
  /** Backend exposes the channel handle as `name`. */
  name: string;
  /** Backend exposes the provider type as `platform`. */
  platform: ChannelProvider;
  isPrimary: boolean;
  status: ChannelStatus;
  createdAt: string;
  updatedAt: string;
}
