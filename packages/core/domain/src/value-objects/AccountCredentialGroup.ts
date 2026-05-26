/**
 * @file AccountCredentialGroup.ts
 * @description Domain value object enumerating the per-account credential
 *   categories (Bring-Your-Own-Key style). Mirror of the Prisma-generated enum;
 *   values match exactly so the type passes through to adapter queries without
 *   mapping.
 * @layer domain
 */

export const ACCOUNT_CREDENTIAL_GROUPS = {
  AI_BYOK: "AI_BYOK",
} as const;

export type AccountCredentialGroup =
  (typeof ACCOUNT_CREDENTIAL_GROUPS)[keyof typeof ACCOUNT_CREDENTIAL_GROUPS];
