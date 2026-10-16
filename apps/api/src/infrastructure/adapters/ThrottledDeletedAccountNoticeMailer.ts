/**
 * @file ThrottledDeletedAccountNoticeMailer.ts
 * @description Decorator over the deleted-account notice port that lets at most one notice per
 *              address through per window. Anyone can trigger the notice by registering with an
 *              address a deleted holder owns, so without a bound the registration endpoint would
 *              mail that inbox as often as it is called. The window is an atomic claim on the
 *              shared cache (`CachePort.claim`, one Redis `SET NX EX` in production), so among
 *              concurrent attempts on every instance exactly one sends. Its key carries a SHA-256
 *              of the address, never the address, because cache adapters log their keys. A claim
 *              the cache cannot decide, a Redis outage among them, sends nothing: a lost notice
 *              costs less than an unbounded one.
 * @layer infrastructure
 */

import { createHash } from "node:crypto";
import { type Result, ok, err } from "@shared/types";
import type { CachePort } from "@ports/core";
import type {
  DeletedAccountNoticeMailer,
  DeletedAccountNoticeData,
} from "@core/domain/repositories/DeletedAccountNoticeMailer.js";

/** How long one notice to an address holds back the next one, in seconds: 24 hours. */
export const DELETED_ACCOUNT_NOTICE_WINDOW_SECONDS = 24 * 60 * 60;

/** Namespaces the notice claims among the shared cache's keys. */
export const DELETED_ACCOUNT_NOTICE_CLAIM_KEY_PREFIX = "deleted-account-notice:";

/**
 * Builds the cache key that claims an address for the window.
 * @param address - The address the notice is sent to, as received.
 * @returns The prefixed SHA-256 hex digest of the address.
 */
function claimKeyFor(address: string): string {
  return `${DELETED_ACCOUNT_NOTICE_CLAIM_KEY_PREFIX}${createHash("sha256").update(address).digest("hex")}`;
}

/**
 * @class ThrottledDeletedAccountNoticeMailer
 * @description Sends the deleted-account notice through the wrapped mailer at most once per
 *   address per window, across every instance that shares the cache.
 */
export class ThrottledDeletedAccountNoticeMailer implements DeletedAccountNoticeMailer {
  constructor(
    private readonly inner: DeletedAccountNoticeMailer,
    private readonly cache: CachePort
  ) {}

  /**
   * @method notifyRegistrationAttemptOnDeletedAccount
   * @description Claims the address for the window, then sends the notice through the wrapped
   *   mailer; when another attempt already holds the claim, on this instance or any other, the
   *   call is answered ok without a send. The claim is taken before the send, so a send that
   *   fails or never returns does not let the next attempt through, and a failed send is not
   *   retried inside the window.
   * @param to - The address that belongs to the deleted account or deleted user.
   * @param data - The business data the notice carries.
   * @returns Ok when this call won the claim and the notice was sent, or when another attempt
   *   holds the claim; the wrapped mailer's failure, unchanged; or an error, with nothing sent,
   *   when the cache could not decide the claim. No error names the address.
   */
  async notifyRegistrationAttemptOnDeletedAccount(
    to: string,
    data: DeletedAccountNoticeData
  ): Promise<Result<void, Error>> {
    let claimed: boolean;
    try {
      claimed = await this.cache.claim(claimKeyFor(to), DELETED_ACCOUNT_NOTICE_WINDOW_SECONDS);
    } catch (error: unknown) {
      return err(
        new Error("The deleted-account notice throttle could not claim the address", {
          cause: error,
        })
      );
    }
    if (!claimed) {
      return ok(undefined);
    }
    return this.inner.notifyRegistrationAttemptOnDeletedAccount(to, data);
  }
}
