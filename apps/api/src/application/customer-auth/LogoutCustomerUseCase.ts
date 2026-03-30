/**
 * @file LogoutCustomerUseCase.ts
 * @description Handles customer logout. With short-lived access tokens (15 min),
 *   logout simply acknowledges the request. Token blacklisting can be added
 *   via Redis if needed in the future.
 * @layer application
 */

import { type Result, ok } from "@shared/types";

/** Error code union */
export type LogoutCustomerError = "INTERNAL_ERROR";

/**
 * @class LogoutCustomerUseCase
 * @description Acknowledges the customer logout. Relies on short token expiry.
 */
export class LogoutCustomerUseCase {
  /**
   * @method execute
   * @description Processes a customer logout request.
   */
  async execute(): Promise<Result<{ message: string }, LogoutCustomerError>> {
    return ok({ message: "Logged out successfully" });
  }
}
