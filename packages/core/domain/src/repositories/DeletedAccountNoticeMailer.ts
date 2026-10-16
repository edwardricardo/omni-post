/**
 * @file DeletedAccountNoticeMailer.ts
 * @description Role port for telling the owner of an address that a registration was
 *              attempted with it while the address still belongs to a deleted account. The
 *              registration answers the caller exactly as it answers any address already in
 *              use, so the caller learns nothing about the deleted account; the owner learns
 *              it from this notice, in their own inbox. The use case provides business data;
 *              the infrastructure adapter renders the template and sends it.
 * @layer domain
 */

import type { Result } from "@shared/types";

/** Business data for the deleted-account notice. */
export interface DeletedAccountNoticeData {
  /** Where the owner asks to restore the account or to complete its deletion. */
  readonly supportEmail: string;
}

/** Sends the deleted-account notice to the owner of the address. */
export interface DeletedAccountNoticeMailer {
  /**
   * @method notifyRegistrationAttemptOnDeletedAccount
   * @description Tells the owner of the address that a registration was attempted with it,
   *   that the account it belongs to is deleted and can be restored or have its deletion
   *   completed, and that completing the deletion erases all of the account's data.
   * @param to - The address that belongs to the deleted account or deleted user.
   * @param data - The business data the notice carries.
   * @returns Ok when the notice was handed to the e-mail transport, or the transport's
   *   failure.
   */
  notifyRegistrationAttemptOnDeletedAccount(
    to: string,
    data: DeletedAccountNoticeData
  ): Promise<Result<void, Error>>;
}
