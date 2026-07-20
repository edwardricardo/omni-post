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
  CustomerMfaChallengeClaims,
  TokenVerifyError,
} from "@core/domain/repositories/CustomerTokenService.js";
import {
  signCustomerAccessToken,
  signCustomerRefreshToken,
  verifyCustomerRefreshToken,
  decodeCustomerRefreshToken,
  signCustomerMfaChallengeToken,
  verifyCustomerMfaChallengeToken,
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

  signMfaChallengeToken(claims: CustomerMfaChallengeClaims): string {
    return signCustomerMfaChallengeToken({
      sub: claims.sub,
      accountId: claims.accountId,
      jti: claims.jti,
      iph: claims.iph,
      uah: claims.uah,
    });
  }

  verifyMfaChallengeToken(token: string): Result<CustomerMfaChallengeClaims, TokenVerifyError> {
    try {
      const payload = verifyCustomerMfaChallengeToken(token);
      return ok({
        sub: payload.sub,
        accountId: payload.accountId,
        jti: payload.jti,
        iph: payload.iph,
        uah: payload.uah,
      });
    } catch {
      return err("INVALID_TOKEN");
    }
  }
}
