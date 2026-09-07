/**
 * @file tenantTransactionNesting.test.ts
 * @description Pins the NESTING half of the one-transaction-seam decision: what happens when
 *   a site that opens its own transaction is reached from INSIDE a unit of work.
 *
 *   ## Why nesting needs its own answer
 *
 *   `withGucBoundTransaction` deliberately does not join an ambient transaction — joining it
 *   would silently change the atomicity of sites that commit independently today, which is an
 *   adjudication for the call site, not for the seam. So every site has to answer the same
 *   question explicitly: does this transaction belong to its caller's unit of work, or is it
 *   its own?
 *
 *   Two things are asserted here, and neither substitutes for the other:
 *
 *   - **The mechanism.** `withTenantTransaction` joins the unit of work when one is open and
 *     opens a GUC-bound transaction of its own when none is, which is what a repository
 *     needs: a repository write inside `executeInTransaction` must roll back WITH it (the
 *     architecture canon states this as repositories auto-detecting the active transaction).
 *   - **The adoption.** Every site in `apps/api/src` that opens a transaction through the seam
 *     has ANSWERED the question — through the helper, by checking
 *     `PrismaUnitOfWork.getTransactionClient()` itself, or by being named below as
 *     independent-by-design with its reason. An ALLOWLIST, because the set of ways to get this
 *     wrong is open-ended while the set of admissible answers is three.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isGucBound } from "../../../../../infra/prisma/src/extensions/tenantGuc.js";
import { PrismaUnitOfWork } from "../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { withTenantTransaction } from "../../../src/infrastructure/unitofwork/tenantTransaction.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(currentDir, "..", "..", "..", "src");

/**
 * The ONE module allowed to call the seam on another site's behalf. Everything else either
 * goes through it or answers the nesting question in its own file.
 */
const HELPER = "infrastructure/unitofwork/tenantTransaction.ts";

/**
 * Sites that adjudicate nesting IN FILE, by checking for an active unit of work before
 * choosing a branch. Listed rather than merely tolerated, because the test verifies the check
 * is actually there — a name here with no check is a violation, not an exemption.
 */
const INLINE_ADJUDICATED = [
  "infrastructure/repositories/PrismaPostRepository.ts",
  "infrastructure/repositories/PrismaProjectRepository.ts",
  "infrastructure/repositories/PrismaAccountRepository.ts",
];

/**
 * Sites whose transaction is INDEPENDENT of any enclosing unit of work on purpose, each with
 * the reason that makes it a decision instead of an oversight. A comment in the file says the
 * same thing at the call site; this list is what keeps the set closed.
 */
const INDEPENDENT_BY_DESIGN: Record<string, string> = {
  "events/EventStore.ts":
    "the event store offers appendInTx(tx, ...) as its enlisting door, so a caller that " +
    "wants its events in the caller's transaction asks for it explicitly",
  "saga/sagaTenant.ts":
    "the saga primitives OPEN the transaction a saga step runs in; they are never reached " +
    "from inside one",
  "infrastructure/outbox/OutboxClaimService.ts":
    "the claim loop is a top-level background pass, not a step of anyone's unit of work",
  "outbox/outboxAdminRoutes.ts": "a route handler is the outermost frame of its own request",
  "billing/gatewaySwitchProcessor.ts": "a queue processor is the outermost frame of its job",
  "admin/SchedulingPostHandlers.ts": "an admin route handler is the outermost frame",
  "admin/SchedulingSlotHandlers.ts": "an admin route handler is the outermost frame",
};

/** Every `.ts` under a directory, excluding declaration files. */
function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) found.push(full);
  }
  return found;
}

/** A transaction-client double that records the operations issued on it. */
function makeTxDouble() {
  const issued: string[] = [];
  return {
    issued,
    tx: {
      async $queryRaw(): Promise<unknown> {
        issued.push("$queryRaw");
        return [];
      },
      async $executeRaw(): Promise<number> {
        issued.push("$executeRaw");
        return 1;
      },
    },
  };
}

describe("withTenantTransaction", () => {
  it("joins the active unit of work instead of opening a transaction of its own", async () => {
    const { tx, issued } = makeTxDouble();
    const opened: unknown[] = [];
    const client = {
      async $transaction<T>(fn: (t: unknown) => Promise<T>, options?: unknown): Promise<T> {
        opened.push(options);
        return fn(tx);
      },
    };
    const unitOfWork = new PrismaUnitOfWork(client as never);

    let receivedTheUnitOfWorksClient = false;
    await unitOfWork.executeInTransaction(async () => {
      await withTenantTransaction(client as never, async (inner) => {
        receivedTheUnitOfWorksClient = inner === (tx as never);
      });
    });

    // Exactly one transaction was opened, and it is the unit of work's. A repository write
    // that opened a second one would commit even when the unit of work rolls back.
    expect(opened).toHaveLength(1);
    expect(receivedTheUnitOfWorksClient).toBe(true);
    expect(issued).toEqual([]);
  });

  it("opens its own GUC-bound transaction when no unit of work is active", async () => {
    const { tx } = makeTxDouble();
    const opened: unknown[] = [];
    const client = {
      async $transaction<T>(fn: (t: unknown) => Promise<T>, options?: unknown): Promise<T> {
        opened.push(options);
        return fn(tx);
      },
    };

    let markerHeld = false;
    await withTenantTransaction(client as never, async () => {
      markerHeld = isGucBound();
    });

    expect(opened).toHaveLength(1);
    // The marker still has to be held: the transaction owns its connection either way, so an
    // operation inside it must not be re-wrapped onto a second one.
    expect(markerHeld).toBe(true);
  });

  it("forwards transaction bounds to the transaction it opens", async () => {
    const { tx } = makeTxDouble();
    const opened: unknown[] = [];
    const client = {
      async $transaction<T>(fn: (t: unknown) => Promise<T>, options?: unknown): Promise<T> {
        opened.push(options);
        return fn(tx);
      },
    };

    await withTenantTransaction(client as never, async () => undefined, {
      timeout: 120_000,
      isolationLevel: "Serializable",
    });

    expect(opened).toEqual([{ timeout: 120_000, isolationLevel: "Serializable" }]);
  });
});

describe("nesting adjudication across the transaction seam", () => {
  it("gives every seam site one of the three admissible answers", () => {
    const openers = walk(apiSrc)
      .filter((path) => !path.endsWith(".test.ts"))
      .filter((path) =>
        /withGucBoundTransaction\(|withTenantTransaction\(/.test(readFileSync(path, "utf8"))
      )
      .map((path) => relative(apiSrc, path).split("\\").join("/"));

    // Non-vacuity: the seam has a known population, and a scan that suddenly matches almost
    // nothing has stopped measuring rather than started passing.
    expect(openers.length).toBeGreaterThanOrEqual(8);

    const unadjudicated = openers.filter((relPath) => {
      if (relPath === HELPER) return false;
      if (INDEPENDENT_BY_DESIGN[relPath] !== undefined) return false;
      const source = readFileSync(join(apiSrc, relPath), "utf8");
      // Through the helper, or by checking for the active unit of work in this very file.
      if (/withTenantTransaction\(/.test(source)) return false;
      return !/PrismaUnitOfWork\.getTransactionClient\(\)/.test(source);
    });

    expect(unadjudicated).toEqual([]);
  });

  it("keeps the inline adjudicators honest — a name is not an exemption", () => {
    for (const relPath of INLINE_ADJUDICATED) {
      const source = readFileSync(join(apiSrc, relPath), "utf8");
      expect(
        /PrismaUnitOfWork\.getTransactionClient\(\)/.test(source),
        `${relPath} is listed as adjudicating nesting in file but does not check for an active unit of work`
      ).toBe(true);
    }
  });

  it("states a reason beside every site declared independent of its caller's transaction", () => {
    for (const [relPath, reason] of Object.entries(INDEPENDENT_BY_DESIGN)) {
      const source = readFileSync(join(apiSrc, relPath), "utf8");
      expect(reason.length, `${relPath} is declared independent with no reason`).toBeGreaterThan(
        20
      );
      // The declaration lives at the call site too, so a reader adjudicating this code does
      // not have to find this test to learn that the independence is deliberate.
      expect(
        /independent(ly)? of|does not join|not part of (the|its) (caller|enclosing)/i.test(source),
        `${relPath} is declared independent here but says nothing about it at the call site`
      ).toBe(true);
    }
  });
});
