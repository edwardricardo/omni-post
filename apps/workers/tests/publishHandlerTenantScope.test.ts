/**
 * @file publishHandlerTenantScope.test.ts
 * @description Unit tests for how a publish job acquires its tenant scope.
 *   Four branches, each with a distinct operational meaning:
 *     - the payload carries `accountId` (steady state) — no owner lookup, and
 *       the provenance counter records `payload`;
 *     - the payload omits it (job enqueued before the field existed) — the
 *       deploy-compat owner fallback resolves it, logs a WARN and records
 *       `fallback`, so "remove the fallback once no pre-deploy jobs remain" is
 *       actually verifiable;
 *     - the channel is gone — a TERMINAL condition that must still leave the
 *       same audit trail every other publish failure leaves (an ERR
 *       `publish_log` row + a publish error metric);
 *     - the owner lookup itself failed (transient DB fault) — must NOT be
 *       reported as an auth failure, or a database blip is escalated to
 *       operators as a credential problem.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import type pino from "pino";
import type { Result } from "@shared/types";
import { PublishHandler } from "../src/publishHandler.js";
import type { PublishRepo } from "../src/publishHandlerTypes.js";
import type { WorkerMetrics } from "../src/metrics/workerMetrics.js";
import {
  createMockRepo,
  createMockProviderRegistry,
  createMockInstrumentation,
  createMockDatabaseInstrumentation,
  createMockBusinessKPITracker,
  createTestWorkerMetrics,
} from "./setup.js";

const CHANNEL_ID = "ch-1";
const POST_ID = "post-001";
const OWNER_ACCOUNT_ID = "acct-owner";
const PAYLOAD_ACCOUNT_ID = "acct-payload";

interface LoggedCall {
  context: Record<string, unknown>;
  message: string;
}

/** Logger double that records what each level was called with. */
function createRecordingLogger(): {
  logger: pino.Logger;
  warns: LoggedCall[];
} {
  const warns: LoggedCall[] = [];
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn((context: Record<string, unknown>, message: string) => {
      warns.push({ context, message });
    }),
  } as unknown as pino.Logger;
  return { logger, warns };
}

/** Publish-log rows the handler wrote, in order. */
interface LoggedPublish {
  status: string;
  payload: Record<string, unknown>;
}

function createRecordingRepo(ownerResult: Result<string | null, string>): {
  repo: PublishRepo;
  logs: LoggedPublish[];
  ownerLookups: string[];
} {
  const base = createMockRepo();
  const logs: LoggedPublish[] = [];
  const ownerLookups: string[] = [];
  const repo: PublishRepo = {
    ...base,
    logPublish: async (input) => {
      logs.push({ status: input.status, payload: input.payload });
      return { ok: true, value: {} };
    },
    getChannelOwnerAccountId: async (channelId) => {
      ownerLookups.push(channelId);
      return ownerResult;
    },
  };
  return { repo, logs, ownerLookups };
}

/** Credentials the provider actually received, keyed by resolve() call. */
function buildHandler(
  repo: PublishRepo,
  logger: pino.Logger,
  workerMetrics: WorkerMetrics,
  resolveCalls: Array<{ channelId: string; accountId: string }>
): PublishHandler {
  return new PublishHandler({
    repo,
    providerRegistry: createMockProviderRegistry(),
    credentialResolver: {
      resolve: async (channelId: string, accountId: string) => {
        resolveCalls.push({ channelId, accountId });
        return { ok: true, value: { accessToken: "test-token" } };
      },
    },
    workerMetrics,
    logger,
    instrumentation: createMockInstrumentation(),
    databaseInstrumentation: createMockDatabaseInstrumentation(),
    businessKPITracker: createMockBusinessKPITracker(),
  });
}

async function readCounter(
  workerMetrics: WorkerMetrics,
  name: string
): Promise<Array<{ labels: Record<string, string | number>; value: number }>> {
  const snapshot = await workerMetrics.getRegistry().getMetricsAsJSON();
  const metric = snapshot.find((entry) => entry.name === name);
  return (metric?.values ?? []) as Array<{
    labels: Record<string, string | number>;
    value: number;
  }>;
}

describe("PublishHandler — publish job tenant scope", () => {
  let workerMetrics: WorkerMetrics;
  let resolveCalls: Array<{ channelId: string; accountId: string }>;

  beforeEach(() => {
    vi.clearAllMocks();
    workerMetrics = createTestWorkerMetrics();
    resolveCalls = [];
  });

  describe("payload carries the tenant", () => {
    it("uses it directly, never consults the owner fallback, and records source=payload", async () => {
      const { logger, warns } = createRecordingLogger();
      const { repo, ownerLookups } = createRecordingRepo({ ok: true, value: OWNER_ACCOUNT_ID });

      await buildHandler(repo, logger, workerMetrics, resolveCalls).handleJob({
        payload: { postId: POST_ID, channelId: CHANNEL_ID, accountId: PAYLOAD_ACCOUNT_ID },
        dedupeKey: "dk-payload",
      });

      expect(resolveCalls).toStrictEqual([
        { channelId: CHANNEL_ID, accountId: PAYLOAD_ACCOUNT_ID },
      ]);
      expect(ownerLookups).toStrictEqual([]);
      expect(warns).toStrictEqual([]);
      expect(
        await readCounter(workerMetrics, "worker_publish_job_account_id_source_total")
      ).toEqual([{ labels: { source: "payload" }, value: 1 }]);
    });
  });

  describe("legacy payload without a tenant", () => {
    it("resolves the channel owner, WARNs, and records source=fallback", async () => {
      const { logger, warns } = createRecordingLogger();
      const { repo, ownerLookups } = createRecordingRepo({ ok: true, value: OWNER_ACCOUNT_ID });

      await buildHandler(repo, logger, workerMetrics, resolveCalls).handleJob({
        payload: { postId: POST_ID, channelId: CHANNEL_ID },
        dedupeKey: "dk-legacy",
      });

      expect(ownerLookups).toStrictEqual([CHANNEL_ID]);
      expect(resolveCalls).toStrictEqual([{ channelId: CHANNEL_ID, accountId: OWNER_ACCOUNT_ID }]);
      // Without this WARN the fallback's removal condition is unobservable.
      expect(warns.length).toBe(1);
      expect(warns[0]?.context).toMatchObject({ channelId: CHANNEL_ID });
      expect(
        await readCounter(workerMetrics, "worker_publish_job_account_id_source_total")
      ).toEqual([{ labels: { source: "fallback" }, value: 1 }]);
    });
  });

  describe("channel gone between enqueue and run", () => {
    it("fails terminally with an ERR publish_log row and a channel_not_found error metric", async () => {
      const { logger } = createRecordingLogger();
      const { repo, logs } = createRecordingRepo({ ok: true, value: null });

      await expect(
        buildHandler(repo, logger, workerMetrics, resolveCalls).handleJob({
          payload: { postId: POST_ID, channelId: CHANNEL_ID },
          dedupeKey: "dk-missing",
        })
      ).rejects.toThrow(/CHANNEL_NOT_FOUND/);

      // The failure happens before the RUNNING log, so without an explicit
      // audit row the post would silently never publish.
      const errLogs = logs.filter((entry) => entry.status === "ERR");
      expect(errLogs.length).toBe(1);
      expect(errLogs[0]?.payload).toMatchObject({ error: "CHANNEL_NOT_FOUND" });

      const publishErrors = await readCounter(workerMetrics, "worker_publish_errors_total");
      expect(publishErrors.length).toBe(1);
      expect(publishErrors[0]?.labels).toMatchObject({ error_type: "channel_not_found" });
      expect(resolveCalls).toStrictEqual([]);
    });
  });

  describe("owner lookup fails with a database fault", () => {
    it("does NOT report AUTH and records an infrastructure error metric", async () => {
      const { logger } = createRecordingLogger();
      const { repo, logs } = createRecordingRepo({ ok: false, error: "DATABASE_ERROR" });

      await expect(
        buildHandler(repo, logger, workerMetrics, resolveCalls).handleJob({
          payload: { postId: POST_ID, channelId: CHANNEL_ID },
          dedupeKey: "dk-dberr",
        })
      ).rejects.toThrow(/TENANT_SCOPE_LOOKUP_FAILED/);

      // A transient DB blip reported as "auth_error" sends operators to rotate
      // credentials for a problem that has nothing to do with credentials.
      const errLogs = logs.filter((entry) => entry.status === "ERR");
      expect(errLogs.length).toBe(1);
      expect(errLogs[0]?.payload.error).not.toBe("AUTH");

      const publishErrors = await readCounter(workerMetrics, "worker_publish_errors_total");
      expect(publishErrors.length).toBe(1);
      expect(publishErrors[0]?.labels).toMatchObject({ error_type: "database_error" });
    });
  });
});
