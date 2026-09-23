/**
 * @file RetractionActionWindowSweep.ts
 * @description Closes the customer action windows whose deadline has passed.
 *
 *              A channel that published part of a thread and then failed leaves
 *              content live on a platform this application cannot retract, so the
 *              obligation to remove it becomes the customer's and an alert stays
 *              open asking for it. That ask cannot stay open forever. This tick
 *              finalizes the channel's OUTCOME once the window has elapsed, which
 *              ends the alert cycle — and it changes nothing else: the live
 *              fragment references, the post's content lock and the confirm act all
 *              survive, because elapsed time is not evidence that anything came
 *              down.
 *
 *              ## The two scopes, and why they are sequential
 *
 *              Discovery asks which tenants have work at all, so it is
 *              cross-account and runs inside a declared system context. The work is
 *              a write against one tenant's post, so it runs bound to THAT tenant.
 *              The second never nests inside the first: `resolveGucScope` answers
 *              the system sentinel whenever a system context is present, and the
 *              two stores are independent, so a tenant context entered inside the
 *              system scope would bind `__system__` — layer 1's guard steps aside,
 *              the row's account is read by nobody, and the nesting compiles and is
 *              silent. `RecurrenceScheduler` is sequential for the same reason.
 *
 *              The system scope is a parameter rather than an import because it is
 *              a property of the TICK, declared and named at the registration site
 *              the bootstrap scan reads. The tenant binding has no name to declare
 *              there: it is derived per row from the row just read.
 *
 *              ## Why a failing row is counted rather than thrown
 *
 *              Each row is its own transaction, and discovery takes one bounded
 *              page. A loop that stopped at the first refusal would leave every
 *              younger row on that page waiting for a tick that never gets past the
 *              same poison. A refused row is counted, named at ERROR, and left in
 *              the predicate, so the next tick selects it again.
 *
 *              A row can refuse in TWO ways and this holds for both. The dependency
 *              is named by its CONTRACT, which promises a `Result` and says nothing
 *              about not rejecting, so "it does not throw" would be a property of
 *              whichever class the composition root passes — not of this sweep. An
 *              unguarded rejection would abandon the rest of the page, skip the
 *              summary log and leave the failure counter unmoved, which is the exact
 *              outcome the paragraph above exists to prevent. Both refusals land in
 *              the same `failed` arm with the same counter and the same message,
 *              and they are told apart by the reported `code`: an `err` carries the
 *              use case's own, a rejection carries
 *              `RETRACTION_ACTION_WINDOW_SWEEP_REJECTED_CODE`, because a rejection
 *              breaks the contract while an `err` is the contract working.
 * @layer infrastructure
 */

import type {
  ExpireRetractionActionWindowInput,
  ExpireRetractionActionWindowOutput,
} from "@core/posts/index.js";
import type { UseCase, UseCaseError } from "@core/application/UseCase.js";
import type { Result } from "@shared/types";
import type {
  PendingRetractionSweepReader,
  PendingRetractionSweepRow,
} from "@core/domain/repositories/PendingRetractionSweepReader.js";
import { withTenantContext } from "../../security/tenantContext.js";
import {
  recordActionWindowExpired,
  recordActionWindowSweepFailure,
} from "../../metrics/retractionWindowMetrics.js";

/**
 * Tick cadence. A constant rather than configuration: the window is measured in
 * hours, so the only thing a shorter cadence buys is a smaller rounding error on a
 * deadline nobody reads to the minute.
 */
export const RETRACTION_ACTION_WINDOW_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/** Rows read per tick. Matches the partial index that serves the predicate. */
export const RETRACTION_ACTION_WINDOW_SWEEP_PAGE_SIZE = 100;

/**
 * The `code` reported for a row whose use case REJECTED instead of answering with a
 * `Result`. Deliberately not one of `USE_CASE_ERRORS`: those are refusals the
 * contract provides for, and an operator reading `INTERNAL_ERROR` here would be
 * reading a refusal that never happened. This value says the dependency broke its
 * own signature, which is a different thing to go and fix.
 */
export const RETRACTION_ACTION_WINDOW_SWEEP_REJECTED_CODE = "USE_CASE_REJECTED";

/** Milliseconds in an hour, named so the conversion below reads as one. */
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * The use case this tick drives, by its CONTRACT rather than by the class that
 * implements it. Naming the class would make the sweep's dependency include that
 * class's private fields, which no double can supply and no other implementation
 * could satisfy — a coupling the composition root does not need and the sweep
 * cannot use.
 */
export type ExpireRetractionActionWindow = UseCase<
  ExpireRetractionActionWindowInput,
  ExpireRetractionActionWindowOutput,
  UseCaseError
>;

/**
 * Runs `run` inside the cross-account scope the tick declares. Supplied by the
 * registration site so the declaration — and the reason string an operator reads —
 * lives where the tick is registered.
 */
export type SystemScopeRunner = <T>(run: () => Promise<T>) => Promise<T>;

/**
 * The logging surface this sweep is allowed to use. Narrow on purpose: the tick must
 * be able to say WHICH row it could not settle, and the structured payloads below are
 * the whole vocabulary.
 */
export interface RetractionActionWindowSweepLogger {
  info(payload: object, message: string): void;
  error(payload: object, message: string): void;
}

/**
 * What one tick did. Returned as well as logged so a caller can tell a tick that
 * found nothing from one that failed on every row — a distinction no exit code and
 * no absence of an error carries.
 */
export interface RetractionActionWindowSweepSummary {
  /** Rows discovery selected. */
  readonly scanned: number;
  /** Rows whose window this tick closed. */
  readonly expired: number;
  /** Rows already settled by a customer confirmation or an earlier tick. */
  readonly skipped: number;
  /** Rows the use case refused or could not write. */
  readonly failed: number;
}

export class RetractionActionWindowSweep {
  constructor(
    private readonly reader: PendingRetractionSweepReader,
    private readonly expireWindow: ExpireRetractionActionWindow,
    private readonly windowHours: number,
    private readonly logger: RetractionActionWindowSweepLogger
  ) {}

  /**
   * @method sweep
   * @description Runs one tick: discover the overdue rows across accounts, then
   *   settle each one bound to its own tenant.
   *
   *   `now` is taken ONCE and used for both halves, so the cutoff discovery selected
   *   by is the same cutoff the record re-asserts. Reading the clock twice would let
   *   a row selected at the boundary be refused by the aggregate a millisecond later
   *   — a refusal that is indistinguishable, from the outside, from a real one.
   * @param inSystemScope - The cross-account scope the registration site declares
   * @returns What the tick scanned, expired, skipped and failed
   */
  async sweep(inSystemScope: SystemScopeRunner): Promise<RetractionActionWindowSweepSummary> {
    const now = new Date();
    const window = this.windowHours * MS_PER_HOUR;
    const olderThan = new Date(now.getTime() - window);

    const rows = await inSystemScope(() =>
      this.reader.listExpired({ olderThan, limit: RETRACTION_ACTION_WINDOW_SWEEP_PAGE_SIZE })
    );

    let expired = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      let settled: Result<ExpireRetractionActionWindowOutput, UseCaseError>;
      try {
        // Bound OUTSIDE the discovery scope above — see the file header. Both
        // isolation layers hold on the write only because this is the only scope
        // active when the use case runs.
        settled = await withTenantContext({ accountId: row.accountId }, () =>
          this.expireWindow.execute({
            postId: row.postId,
            channelId: row.channelId,
            now,
            window,
          })
        );
      } catch (error: unknown) {
        // Only the call that can reject is guarded, so a counter or a log that
        // threw could never be read as this row refusing.
        failed += 1;
        recordActionWindowSweepFailure();
        this.reportFailure(row, {
          code: RETRACTION_ACTION_WINDOW_SWEEP_REJECTED_CODE,
          // A rejection is not required to be an Error, or to be one of THIS
          // realm's: a driver or a boundary can hand back anything at all, and
          // reading `.name` off it would be reading a field that may not exist.
          errorType: error instanceof Error ? error.name : "unknown",
        });
        continue;
      }

      if (!settled.ok) {
        failed += 1;
        recordActionWindowSweepFailure();
        this.reportFailure(row, { code: settled.error.code, errorType: settled.error.name });
        continue;
      }

      if (settled.value.applied) {
        expired += 1;
        recordActionWindowExpired();
      } else {
        // Not a failure: the predicate that selected this row can be stale by the
        // time it is loaded, because a customer confirmation or an earlier tick may
        // already have settled it.
        skipped += 1;
      }
    }

    const summary: RetractionActionWindowSweepSummary = {
      scanned: rows.length,
      expired,
      skipped,
      failed,
    };
    // Logged here rather than left to the caller so the four counts are observed
    // even if a future registration discards the returned value.
    this.logger.info({ ...summary }, "Retraction action window sweep finished");
    return summary;
  }

  /**
   * @method reportFailure
   * @description Names the row that could not be settled, at ERROR, with the refusal's
   *   code and type rather than its message. The remedy for a repeating failure is
   *   that row's own cause, so the identifiers have to be in the entry; the message
   *   is not, because a persistence error can quote the failing statement.
   *
   *   ONE entry shape for both refusal kinds. The caller derives the two strings
   *   because only the caller knows which kind it caught, and an operator alerting on
   *   this message must not have to match two payload shapes to see the same event.
   * @param row - The row discovery selected
   * @param refusal - The refusal's code and error type, derived by the caller
   * @returns Nothing; the entry is the whole effect
   */
  private reportFailure(
    row: PendingRetractionSweepRow,
    refusal: { readonly code: string; readonly errorType: string }
  ): void {
    this.logger.error(
      {
        postId: row.postId,
        channelId: row.channelId,
        accountId: row.accountId,
        code: refusal.code,
        errorType: refusal.errorType,
      },
      "Retraction action window not closed; the row stays pending and the next tick retries it"
    );
  }
}
