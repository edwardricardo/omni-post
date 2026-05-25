/**
 * @file CustomerTokenServiceAdapter.ts
 * @description Infrastructure adapter implementing `CustomerTokenService` by
 *              delegating to the canonical JWT helpers in `auth/customerJwt`.
 *              Keeps `jsonwebtoken` confined to that single module (uniform
 *              RFC 8725 algorithm pinning) while exposing a technology-free port
 *              to the application. Verification failures become a typed `Result`
 *              instead of a thrown error.
 * @layer infrastructure
 */

import { type Result, ok, err } from "@shared/types";
import type {
  CustomerTokenService,
  CustomerAccessClaims,
  CustomerRefreshClaims,
  TokenVerifyError,
} from "@core/domain/repositories/CustomerTokenService.js";
import {
  signCustomerAccessToken,
  signCustomerRefreshToken,
  verifyCustomerRefreshToken,
  decodeCustomerRefreshToken,
} from "../../auth/customerJwt.js";

/**
 * @class CustomerTokenServiceAdapter
 * @description Pass-through from the `CustomerTokenService` contract to the
 *   module-level customer JWT helper functions.
 */
export class CustomerTokenServiceAdapter implements CustomerTokenService {
  signAccessToken(claims: CustomerAccessClaims): string {
    return signCustomerAccessToken({
      sub: claims.sub,
      accountId: claims.accountId,
      roleId: claims.roleId,
      roleName: claims.roleName,
      permissions: claims.permissions,
    });
  }

  signRefreshToken(userId: string, sessionId: string): string {
    return signCustomerRefreshToken(userId, sessionId);
  }

  verifyRefreshToken(token: string): Result<CustomerRefreshClaims, TokenVerifyError> {
    try {
      const payload = verifyCustomerRefreshToken(token);
      return ok({ sub: payload.sub, sessionId: payload.sessionId });
    } catch {
      return err("INVALID_TOKEN");
    }
  }

  decodeRefreshToken(token: string): CustomerRefreshClaims | null {
    const payload = decodeCustomerRefreshToken(token);
    if (payload === null) {
      return null;
    }
    return { sub: payload.sub, sessionId: payload.sessionId };
  }
}
