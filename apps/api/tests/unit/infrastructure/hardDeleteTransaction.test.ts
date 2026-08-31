/**
 * @file hardDeleteTransaction.test.ts
 * @description Pins the hard-delete transaction options. These constants are not
 *              configuration knobs: each one IS the fix for a reviewed blocker, so
 *              changing one silently reintroduces the defect it closes. The assertions
 *              below therefore pin the GUARANTEE, not the literal — each states which
 *              failure returns if the value drifts.
 *
 *              A pure-constants module usually earns no test, and a test that asserted
 *              `120_000 === 120_000` would be the tautological shape this project treats
 *              as a vacuous test. What makes this one load-bearing is that the reviewed
 *              defects were reproduced against a real database, and the only thing
 *              standing between the repository and those defects is the value of these
 *              three fields.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { Prisma } from "@infra/prisma";
import {
  HARD_DELETE_TX_OPTIONS,
  HARD_DELETE_TX_TIMEOUT_MS,
  HARD_DELETE_TX_MAX_WAIT_MS,
} from "../../../src/infrastructure/hardDeleteTransaction.js";

describe("hard-delete transaction options", () => {
  it("runs at Serializable, because ReadCommitted destroys rows the tombstone never records", () => {
    // Reproduced against the dev database: at ReadCommitted a Project committed between
    // the in-transaction `findMany` and the `account.delete` is destroyed by the cascade
    // but absent from DeletionRecord — destruction with no durable trace, on the erasure
    // path. Serializable turns that interleaving into a serialization failure (P2034) and
    // rolls the delete back instead. Downgrading this field restores the silent data loss.
    expect(HARD_DELETE_TX_OPTIONS.isolationLevel).toBe(
      Prisma.TransactionIsolationLevel.Serializable
    );
  });

  it("carries an explicit timeout, because the driver default is far too short for a real cascade", () => {
    // The declarative ON DELETE cascade is enforced per parent row, not set-based, so a
    // large tenant issues one child DELETE per post. Relying on the driver's short default
    // made a big account permanently undeletable: every attempt aborted at the same point
    // and no smaller unit of work existed. The budget is paired with the use case's
    // pre-flight size probe, which refuses anything that cannot finish inside it.
    expect(HARD_DELETE_TX_OPTIONS.timeout).toBe(HARD_DELETE_TX_TIMEOUT_MS);
    expect(HARD_DELETE_TX_TIMEOUT_MS).toBeGreaterThan(30_000);
  });

  it("waits for a connection long enough that a busy pool is not read as a delete failure", () => {
    expect(HARD_DELETE_TX_OPTIONS.maxWait).toBe(HARD_DELETE_TX_MAX_WAIT_MS);
    expect(HARD_DELETE_TX_MAX_WAIT_MS).toBeGreaterThan(0);
  });

  it("exposes exactly these three fields, so a fourth cannot arrive unreviewed", () => {
    // A transaction option added here changes the semantics of every hard delete at once.
    // Pinning the key set makes that a deliberate edit to this test rather than a silent one.
    expect(Object.keys(HARD_DELETE_TX_OPTIONS).sort()).toEqual([
      "isolationLevel",
      "maxWait",
      "timeout",
    ]);
  });
});
