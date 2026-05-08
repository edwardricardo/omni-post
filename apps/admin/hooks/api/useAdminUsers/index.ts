/**
 * @file index.ts
 * @description Barrel export for the admin-users hook module — preserves
 *              the public import path `@/hooks/api/useAdminUsers`.
 * @layer infrastructure
 */

export type {
  AdminUser,
  AdminUsersResponse,
  CreateAdminUserInput,
  CreateAdminUserResponse,
  UpdateAdminUserData,
} from "./types";

export { useAdminUsers } from "./queries";

export {
  useActivateAdminUser,
  useCreateAdminUser,
  useDeactivateAdminUser,
  useUpdateAdminUser,
} from "./mutations";
