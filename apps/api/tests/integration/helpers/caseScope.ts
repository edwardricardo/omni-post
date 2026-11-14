/**
 * @file caseScope.ts
 * @description Tells a suite's hooks whether the case that started a piece of setup is still the
 *   case the runner is executing. node:test stops waiting for a hook at its timeout but never stops
 *   the hook itself, so setup that returns after the timeout keeps running while later cases run;
 *   a hook that writes describe-scoped state from that late continuation hands the next case an
 *   app, a cache manager or an emptied Redis it never asked for. The scope holds no I/O: it only
 *   numbers the cases, so a hook can check its own number before it writes.
 * @layer infrastructure
 */

/** The number one `enter()` gave a case; it stays owned until a later `enter()` or `leave()`. */
export type CaseToken = number;

/** The current-case record one suite's hooks share. */
export interface CaseScope {
  /** Starts a new case and returns its token; every earlier token stops being owned. */
  enter(): CaseToken;
  /** Ends the current case, so no token is owned until the next `enter()`. */
  leave(): void;
  /** Whether the token belongs to the case that is running now. */
  owns(token: CaseToken): boolean;
}

/**
 * @description Creates a case scope for one suite. Tokens are numbered from a counter that only
 *   grows, so a token from an earlier case can never compare equal to the current one, even after
 *   a `leave()` with no case entered.
 * @returns A scope whose `enter()` starts a case, `leave()` ends it and `owns(token)` says whether
 *   that token's case is the current one
 */
export function createCaseScope(): CaseScope {
  let lastIssued = 0;
  let current: CaseToken | undefined;
  return {
    enter(): CaseToken {
      lastIssued += 1;
      current = lastIssued;
      return lastIssued;
    },
    leave(): void {
      current = undefined;
    },
    owns(token: CaseToken): boolean {
      return current === token;
    },
  };
}
