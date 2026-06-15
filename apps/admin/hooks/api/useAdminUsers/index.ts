/**
 * @file index.ts
 * @description Barrel export for the admin-users hook module — preserves
 *              the public import path `@/hooks/api/useAdminUsers`.
 * @layer infrastructure
 */

export type { AdminUser } from "./types.js";

export { useAdminUsers } from "./queries.js";

export {
  useActivateAdminUser,
  useCreateAdminUser,
  useDeactivateAdminUser,
  useUpdateAdminUser,
} from "./mutations.js";
