/**
 * @file RetractionActionWindowSweep.test.ts
 * @description Unit contract for the tick that closes customer action windows.
 *
 *              Two properties carry the suite, and neither is about counting.
 *
 *              The first is SCOPE. Discovery is cross-account and the work is
 *              per-tenant, so the tick holds two different scopes at two
 *              different moments. The doubles therefore do not record what they
 *              were called with — they record what CONTEXT was bound when they
 *              were called, asserting both `getTenantContext()` and
 *              `getSystemContext()` at every call. Asserting only the account
 *              would pass on a `withTenantContext` NESTED inside the system
 *              scope, because the tenant store really is populated there; it
 *              just is not what `resolveGucScope` reads, and the write would
 *              bind `__system__` (SMELL-149).
 *
 *              The second is that a bad row is a COUNTED row. The sweep exists
 *              to finalize an obligation whose deadline has passed, and a loop
 *              that stops at the first refusal would leave every younger row of
 *              the same page waiting for a tick that never gets past the same
 *              poison (S-a-4).
 *
 *              S-a-4 has TWO shapes, and only one of them was exercised here. A
 *              use case can refuse by returning `err`, and it can refuse by
 *              REJECTING — the sweep names its dependency by the CONTRACT
 *              `UseCase<In, Out, Err>`, which says nothing about not throwing, so
 *              the property was held by the class the composition root happens to
 *              pass rather than by the sweep. The two are counted the same and
 *              reported apart: same `failed` arm, same counter, same message, and
 *              a `code` that says which one happened, because a rejection is a
 *              violation of the contract while an `err` is the contract working.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach } from "vitest";
import client from "prom-client";
import {
  RETRACTION_ACTION_WINDOW_SWEEP_PAGE_SIZE,
  RETRACTION_ACTION_WINDOW_SWEEP_REJECTED_CODE,
  RetractionActionWindowSweep,
  type RetractionActionWindowSweepLogger,
} from "../../../src/infrastructure/retention/RetractionActionWindowSweep.js";
import {
  getSystemContext,
  getTenantContext,
  withSystemContext,
} from "../../../src/security/tenantContext.js";
import type {
  PendingRetractionSweepQuery,
  PendingRetractionSweepRow,
} from "@core/domain/repositories/PendingRetractionSweepReader.js";
import { ok, err } from "@shared/types";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";

/** Window used by every case here. 72 h is the production default. */
const WINDOW_HOURS = 72;
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;

/** What was bound when a double was entered. Both halves, never one. */
interface ObservedScope {
  readonly tenantAccountId: string | undefined;
  readonly systemReason: string | undefined;
}

function observeScope(): ObservedScope {
  return {
    tenantAccountId: getTenantContext()?.accountId,
    systemReason: getSystemContext()?.reason,
  };
}

function makeRow(suffix: string): PendingRetractionSweepRow {
  return {
    postId: `post-${suffix}`,
    channelId: `channel-${suffix}`,
    accountId: `account-${suffix}`,
  };
}

/** The scope the registration site supplies, reproduced verbatim here. */
const inSystemScope = <T>(run: () => Promise<T>): Promise<T> =>
  withSystemContext("system:retraction-action-window-sweep", run);

interface ReaderCall {
  readonly query: PendingRetractionSweepQuery;
  readonly scope: ObservedScope;
}

function makeReader(rows: readonly PendingRetractionSweepRow[]) {
  const calls: ReaderCall[] = [];
  return {
    calls,
    reader: {
      listExpired: async (
        query: PendingRetractionSweepQuery
      ): Promise<readonly PendingRetractionSweepRow[]> => {
        calls.push({ query, scope: observeScope() });
        return rows;
      },
    },
  };
}

interface ExpireCall {
  readonly postId: string;
  readonly channelId: string;
  readonly now: Date;
  readonly window: number;
  readonly scope: ObservedScope;
}

/**
 * The use-case double. `outcomes` is keyed by postId: `true` applied, `false`
 * raced (already settled), `"fail"` refused with an `err`, `"reject"` rejected
 * with an `Error`, `"reject-alien"` rejected with something that is not one.
 */
function makeExpireUseCase(outcomes: Record<string, boolean | "fail" | "reject" | "reject-alien">) {
  const calls: ExpireCall[] = [];
  const useCase = {
    execute: async (input: { postId: string; channelId: string; now: Date; window: number }) => {
      calls.push({ ...input, scope: observeScope() });
      const outcome = outcomes[input.postId] ?? true;
      if (outcome === "fail") {
        return err(new UseCaseError("boom", USE_CASE_ERRORS.INTERNAL_ERROR));
      }
      if (outcome === "reject") {
        throw new TypeError("the use case rejected instead of returning a Result");
      }
      if (outcome === "reject-alien") {
        // Not an Error, and not even of this realm's Error: a driver, a worker
        // boundary or a serialized rejection can hand back anything at all.
        throw { code: "P2028" };
      }
      return ok({
        postId: input.postId,
        projectId: "project-1",
        channelId: input.channelId,
        applied: outcome,
        hasLiveContent: true,
        status: "FAILED" as const,
      });
    },
  };
  return { calls, useCase };
}

function makeLogger(): RetractionActionWindowSweepLogger & { entries: [object, string][] } {
  const entries: [object, string][] = [];
  return {
    entries,
    info: (payload, message) => entries.push([payload, message]),
    error: (payload, message) => entries.push([payload, message]),
  };
}

const counterValue = async (name: string): Promise<number> => {
  const metric = client.register.getSingleMetric(name);
  expect(metric, `${name} is not registered`).toBeDefined();
  const values = (await metric!.get()).values;
  return values.reduce((sum, v) => sum + v.value, 0);
};

describe("RetractionActionWindowSweep", () => {
  beforeEach(() => {
    client.register.getSingleMetric("retraction_action_window_expired_total")?.reset();
    client.register.getSingleMetric("retraction_action_window_sweep_failures_total")?.reset();
  });

  it("discovers under the system scope, oldest first, one page of 100", async () => {
    const { calls, reader } = makeReader([]);
    const { useCase } = makeExpireUseCase({});

    await new RetractionActionWindowSweep(reader, useCase, WINDOW_HOURS, makeLogger()).sweep(
      inSystemScope
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.query.limit).toBe(RETRACTION_ACTION_WINDOW_SWEEP_PAGE_SIZE);
    expect(RETRACTION_ACTION_WINDOW_SWEEP_PAGE_SIZE).toBe(100);
    // The read is cross-account; nothing else can make it legal.
    expect(calls[0]!.scope.systemReason).toBe("system:retraction-action-window-sweep");
  });

  it("hands the use case the SAME window it discovered with, from one tick moment", async () => {
    const { calls: readerCalls, reader } = makeReader([makeRow("a")]);
    const { calls: expireCalls, useCase } = makeExpireUseCase({});

    await new RetractionActionWindowSweep(reader, useCase, WINDOW_HOURS, makeLogger()).sweep(
      inSystemScope
    );

    expect(expireCalls).toHaveLength(1);
    expect(expireCalls[0]!.window).toBe(WINDOW_MS);
    // `olderThan = now − window` with ONE `now`: asserted as the exact difference
    // rather than against a wall clock, so the tick's single moment is the claim
    // and no fake timer is needed to make it.
    const olderThan = readerCalls[0]!.query.olderThan.getTime();
    expect(expireCalls[0]!.now.getTime() - olderThan).toBe(WINDOW_MS);
    expect(expireCalls[0]!.postId).toBe("post-a");
    expect(expireCalls[0]!.channelId).toBe("channel-a");
  });

  it("binds each row to ITS OWN tenant, OUTSIDE the discovery scope", async () => {
    const { reader } = makeReader([makeRow("a"), makeRow("b")]);
    const { calls, useCase } = makeExpireUseCase({});

    await new RetractionActionWindowSweep(reader, useCase, WINDOW_HOURS, makeLogger()).sweep(
      inSystemScope
    );

    expect(calls.map((c) => c.scope.tenantAccountId)).toEqual(["account-a", "account-b"]);
    // The half that matters: a tenant context entered INSIDE the system scope
    // still answers here, while `resolveGucScope` would bind `__system__` and the
    // row's account would be read by nobody.
    expect(calls.map((c) => c.scope.systemReason)).toEqual([undefined, undefined]);
  });

  it("separates a row it expired from a row that had already settled", async () => {
    const { reader } = makeReader([makeRow("a"), makeRow("b")]);
    const { useCase } = makeExpireUseCase({ "post-b": false });

    const summary = await new RetractionActionWindowSweep(
      reader,
      useCase,
      WINDOW_HOURS,
      makeLogger()
    ).sweep(inSystemScope);

    expect(summary).toEqual({ scanned: 2, expired: 1, skipped: 1, failed: 0 });
    expect(await counterValue("retraction_action_window_expired_total")).toBe(1);
    expect(await counterValue("retraction_action_window_sweep_failures_total")).toBe(0);
  });

  it("S-a-4: counts a failing row, names it, and keeps sweeping the rest", async () => {
    const { reader } = makeReader([makeRow("a"), makeRow("poison"), makeRow("c")]);
    const { calls, useCase } = makeExpireUseCase({ "post-poison": "fail" });
    const logger = makeLogger();

    const summary = await new RetractionActionWindowSweep(
      reader,
      useCase,
      WINDOW_HOURS,
      logger
    ).sweep(inSystemScope);

    // Every row was attempted: the poison row is between two healthy ones on
    // purpose, so a loop that stopped would lose `post-c` and not `post-a`.
    expect(calls.map((c) => c.postId)).toEqual(["post-a", "post-poison", "post-c"]);
    expect(summary).toEqual({ scanned: 3, expired: 2, skipped: 0, failed: 1 });
    expect(await counterValue("retraction_action_window_sweep_failures_total")).toBe(1);
    // The remedy is the row's cause, so the row has to be nameable from the log.
    const failureLog = logger.entries.find(([payload]) =>
      JSON.stringify(payload).includes("post-poison")
    );
    expect(failureLog, "the failed row is not named in any log entry").toBeDefined();
  });

  it("S-a-4: counts a REJECTING row the same as a refusing one, and keeps sweeping", async () => {
    const { reader } = makeReader([makeRow("a"), makeRow("thrower"), makeRow("c")]);
    const { calls, useCase } = makeExpireUseCase({ "post-thrower": "reject" });
    const logger = makeLogger();

    const summary = await new RetractionActionWindowSweep(
      reader,
      useCase,
      WINDOW_HOURS,
      logger
    ).sweep(inSystemScope);

    // The rejecting row sits between two healthy ones for the same reason the
    // refusing one does: an unguarded rejection loses `post-c` and not `post-a`,
    // and takes the summary log and the counter with it.
    expect(calls.map((c) => c.postId)).toEqual(["post-a", "post-thrower", "post-c"]);
    expect(summary).toEqual({ scanned: 3, expired: 2, skipped: 0, failed: 1 });
    expect(await counterValue("retraction_action_window_sweep_failures_total")).toBe(1);

    const failureLog = logger.entries.find(([payload]) =>
      JSON.stringify(payload).includes("post-thrower")
    );
    expect(failureLog, "the rejecting row is not named in any log entry").toBeDefined();
    // Reported APART from an `err`: the contract this sweep depends on returns a
    // Result, so a rejection is a violation of it and an operator who read
    // INTERNAL_ERROR here would be reading a refusal that never happened.
    expect(failureLog![0]).toMatchObject({
      code: RETRACTION_ACTION_WINDOW_SWEEP_REJECTED_CODE,
      errorType: "TypeError",
    });
  });

  it("names a rejection that is not an Error at all rather than reading a field off it", async () => {
    const { reader } = makeReader([makeRow("alien")]);
    const { useCase } = makeExpireUseCase({ "post-alien": "reject-alien" });
    const logger = makeLogger();

    const summary = await new RetractionActionWindowSweep(
      reader,
      useCase,
      WINDOW_HOURS,
      logger
    ).sweep(inSystemScope);

    expect(summary).toEqual({ scanned: 1, expired: 0, skipped: 0, failed: 1 });
    const failureLog = logger.entries.find(([payload]) =>
      JSON.stringify(payload).includes("post-alien")
    );
    expect(failureLog![0]).toMatchObject({
      code: RETRACTION_ACTION_WINDOW_SWEEP_REJECTED_CODE,
      errorType: "unknown",
    });
  });

  it("logs the tick summary itself, so an all-failing tick is not read as an idle one", async () => {
    const { reader } = makeReader([makeRow("a")]);
    const { useCase } = makeExpireUseCase({ "post-a": "fail" });
    const logger = makeLogger();

    const summary = await new RetractionActionWindowSweep(
      reader,
      useCase,
      WINDOW_HOURS,
      logger
    ).sweep(inSystemScope);

    const summaryLog = logger.entries.find(([, message]) => message.includes("sweep finished"));
    expect(summaryLog, "the tick never logged its summary").toBeDefined();
    expect(summaryLog![0]).toMatchObject(summary);
  });
});
