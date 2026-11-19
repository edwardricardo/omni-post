/**
 * @file ZodAdministratorSignInAddressRule.ts
 * @description Infrastructure adapter implementing `AdministratorSignInAddressRule` with the
 *              schemas of the sign-in paths that authenticate an administrator by e-mail: the
 *              `email` field of `loginSchema`, which `POST /admin/auth/login` validates, and
 *              `SecureSchemas.userEmail`, which `POST /auth/login` validates before its service
 *              reads the administrators' table. Each schema is called, not copied, so the rule
 *              follows any change to either path. An address is accepted only when both accept
 *              it, because an administrator must be able to sign in on either.
 * @layer infrastructure
 */

import type { AdministratorSignInAddressRule } from "@ports/core";
import { loginSchema } from "../../admin/auth/adminAuthSchemas.js";
import { SecureSchemas } from "../../security/inputValidation.js";

/** The address schema of every sign-in path that authenticates an administrator. */
const SIGN_IN_ADDRESS_SCHEMAS = [loginSchema.shape.email, SecureSchemas.userEmail] as const;

/**
 * @class ZodAdministratorSignInAddressRule
 * @description Answers with the administrators' sign-in schemas.
 */
export class ZodAdministratorSignInAddressRule implements AdministratorSignInAddressRule {
  /**
   * @method accepts
   * @description Asks every sign-in path's address schema about the address as it is given.
   * @param address - The address, in the form it is stored and signed in with
   * @returns True when every path's schema accepts the address, false when any refuses it
   */
  accepts(address: string): boolean {
    return SIGN_IN_ADDRESS_SCHEMAS.every((schema) => schema.safeParse(address).success);
  }
}
