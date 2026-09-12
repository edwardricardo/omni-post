/**
 * @file DeletionRecordDegrader.ts
 * @description Sweeps tombstones whose plaintext retention window has closed and
 *              replaces the readable `name` with a keyed digest, so the row
 *              survives as erasure evidence while the personal data does not.
 *
 *              Two properties shape the whole loop. First, each row moves in ONE
 *              guarded statement — `name` to null and both digest columns
 *              written together — so no observer can ever see a row holding both
 *              a live name and its digest, and a write that loses the race
 *              changes nothing. Second, a row that CANNOT be digested (its name
 *              holds a codepoint the pinned Unicode version leaves unassigned)
 *              is left whole and put in a per-tick exclusion set, so it is
 *              counted, reported by id, and — crucially — does not stall the
 *              rows queued behind it. Without that set the same unflaggable
 *              batch would come back forever and the sweep would starve.
 *
 *              It opens no transaction and issues no raw SQL: the atomicity that
 *              matters here is per row, and a single guarded `updateMany`
 *              already provides it.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { computeNameDigest, type NameDigestKeyRing } from "../../security/nameDigest/nameDigest.js";

/** Rows read per query. Matches the partial index that serves the predicate. */
export const DEGRADER_BATCH_SIZE = 100;

/**
 * Defensive ceiling on batches per tick. It bounds both the work and the
 * exclusion set (at most 5,000 ids, well under the parameter ceiling a single
 * statement can carry). Rows beyond it are not lost — they carry over to the
 * next daily tick, and the overdue gauge keeps naming them meanwhile.
 */
export const DEGRADER_MAX_BATCHES_PER_TICK = 50;

/**
 * The logging surface this sweep is allowed to use. Deliberately narrow: the
 * job must be able to say WHICH row it could not process and never WHAT the row
 * said, so the structured payloads below are the whole vocabulary.
 */
export interface DeletionRecordDegraderLogger {
  info(payload: object, message: string): void;
  warn(payload: object, message: string): void;
  error(payload: object, message: string): void;
}

/**
 * What one sweep did. Returned rather than merely logged so a caller can tell a
 * run that touched nothing from one that failed on every row — a distinction an
 * exit code cannot carry.
 */
export interface DeletionRecordDegradeSummary {
  /** Rows whose plaintext was replaced by a digest. */
  readonly degraded: number;
  /** Rows left intact because their name could not be canonicalised. */
  readonly flagged: number;
  /** Rows left intact because the write or the digest errored. */
  readonly failed: number;
}

/** The reason code that means "leave the row alone and say so", not "this broke". */
const FLAGGABLE_REASON = "unassigned_codepoint";

export class DeletionRecordDegrader {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ring: NameDigestKeyRing,
    private readonly activeVersion: number,
    private readonly logger: DeletionRecordDegraderLogger
  ) {}

  /**
   * @method degrade
   * @description Run one sweep to completion, or to the per-tick batch ceiling.
   *   The cutoff is taken ONCE so the population cannot shift underneath the
   *   loop, and every row that is read either leaves the predicate (its name
   *   goes null) or joins the exclusion set — which is what makes the remaining
   *   population strictly smaller on every pass and the loop terminate.
   * @returns Counts of degraded, flagged and failed rows for this sweep.
   */
  async degrade(): Promise<DeletionRecordDegradeSummary> {
    const cutoff = new Date();
    const excluded = new Set<string>();
    let degraded = 0;
    let flagged = 0;
    let failed = 0;
    let hitBatchCeiling = true;

    for (let batch = 1; batch <= DEGRADER_MAX_BATCHES_PER_TICK; batch += 1) {
      const rows = await this.prisma.deletionRecord.findMany({
        where: {
          retainUntil: { lt: cutoff },
          name: { not: null },
          ...(excluded.size > 0 ? { id: { notIn: [...excluded] } } : {}),
        },
        orderBy: [{ retainUntil: "asc" }, { id: "asc" }],
        select: { id: true, name: true },
        take: DEGRADER_BATCH_SIZE,
      });

      for (const row of rows) {
        // The predicate already excludes null names; this narrows the type
        // without a non-null assertion.
        if (row.name === null) continue;

        const digest = computeNameDigest(this.ring, this.activeVersion, row.name);
        if (!digest.ok) {
          excluded.add(row.id);
          if (digest.reason === FLAGGABLE_REASON) {
            flagged += 1;
            this.logger.warn(
              { deletionRecordId: row.id, reason: digest.reason },
              "Tombstone name left intact: it holds a codepoint unassigned in the pinned Unicode version"
            );
          } else {
            failed += 1;
            this.logger.error(
              { deletionRecordId: row.id, reason: digest.reason },
              "Tombstone name left intact: the digest could not be computed"
            );
          }
          continue;
        }

        try {
          const result = await this.prisma.deletionRecord.updateMany({
            where: { id: row.id, name: { not: null } },
            data: {
              name: null,
              nameDigest: digest.digest,
              nameDigestKeyVersion: digest.keyVersion,
            },
          });
          // Counting the statement's own result rather than assuming success:
          // a zero means another writer already nulled the name, which is the
          // guard doing its job, not a degradation this sweep performed.
          degraded += result.count;
        } catch (error: unknown) {
          failed += 1;
          excluded.add(row.id);
          // The error TYPE only, never its message: a driver error can quote the
          // failing statement's parameters, and those parameters are the very
          // plaintext this job exists to remove. The row id plus the database's
          // own logs are enough to diagnose from.
          this.logger.error(
            {
              deletionRecordId: row.id,
              errorType: error instanceof Error ? error.name : "unknown",
            },
            "Tombstone degradation write failed; the row keeps its plaintext and stays overdue"
          );
        }
      }

      if (rows.length < DEGRADER_BATCH_SIZE) {
        hitBatchCeiling = false;
        break;
      }
    }

    if (hitBatchCeiling) {
      this.logger.warn(
        { batches: DEGRADER_MAX_BATCHES_PER_TICK, degraded, flagged, failed },
        "Tombstone degradation stopped at the per-tick batch ceiling; the remainder carries over to the next tick"
      );
    }

    const summary: DeletionRecordDegradeSummary = { degraded, flagged, failed };
    // Logged here rather than left to the caller so the triple is observed even
    // if a future scheduler registration discards the returned value.
    this.logger.info({ ...summary }, "Tombstone degradation sweep finished");
    return summary;
  }
}
