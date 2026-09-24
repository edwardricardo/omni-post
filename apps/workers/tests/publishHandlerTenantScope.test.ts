/**
 * @file publishHandlerTenantScope.test.ts
 * @description Unit tests for how a publish job acquires its tenant scope. There is
 *   exactly ONE source now — the `accountId` the pivot put in the payload — and the
 *   property under test is that every tenant-bound thing the job does uses that same
 *   value: the publication record it reads before sending anything, and the
 *   credentials it resolves to send with.
 *
 *   The deploy-compat owner fallback this file used to cover is GONE. It resolved a
 *   tenant the job did not name, which is the one thing a job that predates the
 *   publication record must not be allowed to do; `jobHandler.test.ts` holds the
 *   refusal that replaced it.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import type pino from "pino";
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
  RecordingOutcomeRecorder,
  StubPublicationRecordProbe,
} from "./setup.js";

const CHANNEL_ID = "ch-1";
const POST_ID = "post-001";
const PAYLOAD_ACCOUNT_ID = "acct-payload";
const JOB_ID = `publish-${POST_ID}-${CHANNEL_ID}-e1`;

/** Logger double that records what each level was called with. */
function createRecordingLogger(): { logger: pino.Logger; warns: object[] } {
  const warns: object[] = [];
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn((context: object) => {
      warns.push(context);
    }),
  } as unknown as pino.Logger;
  return { logger, warns };
}

describe("PublishHandler — publish job tenant scope", () => {
  let workerMetrics: WorkerMetrics;
  let resolveCalls: Array<{ channelId: string; accountId: string }>;
  let probe: StubPublicationRecordProbe;
  let repo: PublishRepo;

  beforeEach(() => {
    vi.clearAllMocks();
    workerMetrics = createTestWorkerMetrics();
    resolveCalls = [];
    probe = new StubPublicationRecordProbe();
    repo = createMockRepo();
  });

  it("binds both the record read and the credential lookup to the payload's tenant", async () => {
    const { logger, warns } = createRecordingLogger();
    const handler = new PublishHandler({
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
      outcomeRecorder: new RecordingOutcomeRecorder(),
      publicationRecord: probe,
    });

    await handler.handleJob({
      payload: { postId: POST_ID, channelId: CHANNEL_ID, accountId: PAYLOAD_ACCOUNT_ID },
      dedupeKey: JOB_ID,
      attemptsMade: 0,
    });

    // Two tenant-bound reads, one tenant. A job that read the record under one
    // account and the credentials under another would publish one tenant's
    // content with another tenant's token.
    expect(probe.reads).toStrictEqual([
      { postId: POST_ID, channelId: CHANNEL_ID, accountId: PAYLOAD_ACCOUNT_ID },
    ]);
    expect(resolveCalls).toStrictEqual([{ channelId: CHANNEL_ID, accountId: PAYLOAD_ACCOUNT_ID }]);
    expect(warns).toStrictEqual([]);
  });
});
