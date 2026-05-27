/**
 * @file RbacCacheInvalidatorAdapter.ts
 * @description Adapter implementing `RbacCacheInvalidatorPort` by delegating
 *   to `RbacService.invalidateCache`. Lets `RoleManagementService` live in
 *   @core/application without depending on the concrete RbacService.
 * @layer infrastructure
 */

import type { RbacCacheInvalidatorPort } from "@core/domain/repositories/RbacCacheInvalidatorPort.js";
import type { RbacService } from "./rbacService.js";

export class RbacCacheInvalidatorAdapter implements RbacCacheInvalidatorPort {
  constructor(private readonly rbacService: RbacService) {}

  async invalidate(roleName: string): Promise<void> {
    await this.rbacService.invalidateCache(roleName);
  }
}
