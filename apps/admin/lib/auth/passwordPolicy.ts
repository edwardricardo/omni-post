/**
 * @file passwordPolicy.ts
 * @description The numbers of the administrators' password policy and second factor as the API
 *   enforces them, which the portal states to the administrator. The catalogs take them as ICU
 *   arguments, so a change of the policy in the API is one edit here, at the pointer beside the
 *   number. The portal checks none of them: every rule is the API's.
 * @layer infrastructure
 */

/** The policy's numbers, passed as the values of the catalog messages that state them. */
export const ADMIN_PASSWORD_POLICY = {
  /**
   * The fewest characters of a new password: `validatePasswordStrength` in
   * `apps/api/src/admin/auth/adminAuthSchemas.ts` refuses a shorter one (`password.length < 12`),
   * the figure `adminAuthConfig.passwordPolicy.minLength` in `adminAuthConfig.ts` also records.
   */
  minLength: 12,
  /**
   * The most characters of a new password: `requiredPasswordChangeSchema.newPassword` in
   * `apps/api/src/admin/auth/adminAuthSchemas.ts` (`.max(128)`), a validation failure otherwise.
   */
  maxLength: 128,
  /**
   * The previous passwords a new one must differ from, beside the current one:
   * `adminAuthConfig.passwordPolicy.preventPasswordReuse` in
   * `apps/api/src/admin/auth/adminAuthConfig.ts`, the window `PasswordService.replaceRequiredPassword`
   * checks.
   */
  reusedPasswords: 5,
  /**
   * The digits of the second factor's code: `mfaTokenSchema` in
   * `apps/api/src/admin/auth/adminAuthSchemas.ts` (`.length(6)`).
   */
  mfaCodeLength: 6,
} as const;
