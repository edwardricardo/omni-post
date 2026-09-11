/**
 * @file customerAuthSystemReasons.ts
 * @description The declared system-context reasons for the customer pre-identity
 *   auth seams. Each of these four handlers resolves its subject BEFORE any identity
 *   is bound — by an address that is unique across accounts, by a refresh token, by a
 *   globally-unique reset token, or, for register, by an account that does not exist
 *   yet — so the resolution genuinely precedes attribution and cannot be pre-scoped
 *   to a tenant.
 *
 *   The reasons live in one module, as exported constants, because the tenant guard
 *   bypasses on a system context WITHOUT emitting an audit event. Nothing records a
 *   bypass at runtime, so being able to grep every declared bypass from one place IS
 *   the auditability. An inline literal at a call site is invisible to that, and a
 *   reason built from request data would make the set unbounded.
 *
 *   Recorded residual, not silently absorbed: the two customer-auth handlers wrapped
 *   before this change (login, MFA login) still pass ad-hoc inline literals. Bringing
 *   them into this module is a separate change; the divergence is named here so it
 *   stays attributable rather than invisible.
 *
 * @layer infrastructure
 */

/** Register: no tenant exists at the boundary yet, and the duplicate-address check spans every account. */
export const CUSTOMER_REGISTER_SYSTEM_REASON = "system:customer-register";

/** Refresh: the subject is named by a refresh token, which carries no account scope of its own. */
export const CUSTOMER_REFRESH_SYSTEM_REASON = "system:customer-refresh";

/** Reset request: the address is looked up across every account it belongs to. */
export const CUSTOMER_REQUEST_PASSWORD_RESET_SYSTEM_REASON =
  "system:customer-request-password-reset";

/** Reset confirm: the subject is named by a globally-unique reset token. */
export const CUSTOMER_RESET_PASSWORD_SYSTEM_REASON = "system:customer-reset-password";
