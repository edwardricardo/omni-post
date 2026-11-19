/**
 * @file AdministratorSignInAddressRule.ts
 * @description Port for the rule an address must meet for the administrators' sign-in to accept
 *              it. The sign-in owns that rule; a use case that creates an administrator asks it
 *              through this port, so the administrator it creates can sign in and no second copy
 *              of the rule exists. Its adapter is built from the sign-in's own validation.
 * @layer domain
 */

/** Says whether the administrators' sign-in accepts an address. */
export interface AdministratorSignInAddressRule {
  /**
   * Say whether the administrators' sign-in accepts the address as it is given.
   *
   * @param address - The address, in the form it is stored and signed in with
   * @returns True when the sign-in accepts the address, false when it refuses it
   */
  accepts(address: string): boolean;
}
