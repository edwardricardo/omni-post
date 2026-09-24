/**
 * @file publishOutcomeRecorder.test.ts
 * @description The recorder that makes a provider call's outcome durable: the bounded
 *              compare-and-swap retry, the promise that it never throws, the durable job
 *              it hands an unrecorded outcome to, and the dead letter its own exhaustion
 *              reaches.
 *
 *              The use-case double is a LAZY thenable, as a Prisma-backed call is: it runs
 *              nothing until `then`, so a recorder that opened the tenant scope and handed
 *              the inert object back would read its scope as unbound here. A double built
 *              from an ordinary `async` function captures the scope on the CALL and reports
 *              green over exactly that defect.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UnrecoverableError } from "bullmq";
import { ok, err, type Result } from "@shared/types";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type {
  RecordChannelPublicationAttemptInput,
  RecordChannelPublicationAttemptOutput,
} from "@core/posts";
import { PUBLICATION_OUTCOME_KINDS } from "@core/domain/index.js";
import { getWorkerTenantContext } from "../../src/security/workerTenantContext.js";
import {
  createPublishOutcomeRecorder,
  publishOutcomeCasDelayMs,
  PUBLISH_OUTCOME_CAS,
  type PublishOutcomeReceipt,
} from "../../src/publishOutcomeRecorder.js";

const workersSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");

type RecordAnswer = Result<RecordChannelPublicationAttemptOutput, UseCaseError>;

const ACCOUNT_ID = "acct-0001";

const RECEIPT: PublishOutcomeReceipt = {
  postId: "post-0001",
  channelId: "chan-0001",
  accountId: ACCOUNT_ID,
  episode: 2,
  attemptNo: 1,
  planSize: 1,
  result: { kind: "failed", classification: "transient", publishedFragments: [] },
};

function recorded(): RecordChannelPublicationAttemptOutput {
  return {
    postId: RECEIPT.postId,
    projectId: "proj-0001",
    channelId: RECEIPT.channelId,
    applied: true,
    outcome: { kind: PUBLICATION_OUTCOME_KINDS.UNRESOLVED },
    status: "PUBLISHING",
  };
}

const conflict = (): RecordAnswer =>
  err(new UseCaseError("the record moved on", USE_CASE_ERRORS.CONFLICT));

/**
 * A value `String()` REFUSES to convert — `String(Object.create(null))` raises
 * TypeError — so a description that is not total turns the one escape this module must
 * absorb into a second one, on the very paths that promise nothing escapes.
 */
function undescribable(): Error {
  return Object.create(null) as Error;
}

/** A queue whose producer raises `thrown` instead of answering. */
function throwingQueue(thrown: () => unknown): ReturnType<typeof createQueue> {
  return {
    jobs: [],
    port: {
      enqueue: () => {
        throw thrown();
      },
    },
  } as unknown as ReturnType<typeof createQueue>;
}

/** Records what each call saw, answering from `answers` and repeating the last one. */
function createRecordAttempt(answers: Array<() => RecordAnswer>) {
  const calls: RecordChannelPublicationAttemptInput[] = [];
  const scopes: Array<string | undefined> = [];
  return {
    calls,
    scopes,
    port: {
      execute(input: RecordChannelPublicationAttemptInput): PromiseLike<RecordAnswer> {
        calls.push(input);
        const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
        return {
          then: <A, B>(
            onFulfilled?: ((value: RecordAnswer) => A | PromiseLike<A>) | null,
            onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null
          ): PromiseLike<A | B> => {
            scopes.push(getWorkerTenantContext()?.accountId);
            return Promise.resolve()
              .then(() => answer?.() ?? ok(recorded()))
              .then(onFulfilled, onRejected);
          },
        };
      },
    },
  };
}

function createQueue(answer: Result<string, string> = ok("job-1")) {
  const jobs: Array<{ dedupeKey: string; payload: Record<string, unknown> }> = [];
  return {
    jobs,
    port: {
      enqueue: async (job: {
        dedupeKey: string;
        payload: Record<string, unknown>;
      }): Promise<Result<string, string>> => {
        jobs.push(job);
        return answer;
      },
    },
  };
}

function createLogger() {
  const errors: object[] = [];
  const warns: object[] = [];
  return {
    errors,
    warns,
    port: {
      warn: (obj: object) => void warns.push(obj),
      error: (obj: object) => void errors.push(obj),
    },
  };
}

function createCounter() {
  const increments: Array<Record<string, string>> = [];
  return {
    increments,
    port: { inc: (labels: Record<string, string>) => void increments.push(labels) },
  };
}

/** The recorder under test with every seam recorded, defaults answering happily. */
function build(options: {
  answers?: Array<() => RecordAnswer>;
  queue?: ReturnType<typeof createQueue>;
  deadLetter?: ReturnType<typeof createQueue>;
  logger?: ReturnType<typeof createLogger>;
  counter?: ReturnType<typeof createCounter>;
}) {
  const recordAttempt = createRecordAttempt(options.answers ?? [() => ok(recorded())]);
  const queue = options.queue ?? createQueue();
  const deadLetter = options.deadLetter ?? createQueue();
  const logger = options.logger ?? createLogger();
  const counter = options.counter ?? createCounter();
  const recorder = createPublishOutcomeRecorder({
    recordAttempt: recordAttempt.port,
    outcomeQueue: queue.port,
    deadLetterQueue: deadLetter.port,
    unrecorded: counter.port,
    logger: logger.port,
  });
  return { recorder, recordAttempt, queue, deadLetter, logger, counter };
}

describe("publishOutcomeRecorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("the compare-and-swap retry", () => {
    it("records on the attempt that wins and leaves the durable queue untouched", async () => {
      const { recorder, recordAttempt, queue } = build({
        answers: [conflict, conflict, () => ok(recorded())],
      });

      const pending = recorder.record(RECEIPT);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result.ok).toBe(true);
      expect(recordAttempt.calls.length).toBe(3);
      expect(queue.jobs).toStrictEqual([]);
    });

    it("stops at the bound and hands the outcome to the durable queue", async () => {
      const { recorder, recordAttempt, queue } = build({ answers: [conflict] });

      const pending = recorder.record(RECEIPT);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(recordAttempt.calls.length).toBe(PUBLISH_OUTCOME_CAS.retries + 1);
      expect(queue.jobs.length).toBe(1);
      expect(queue.jobs[0]?.dedupeKey).toBe("outcome-post-0001-chan-0001-e2-a1");
      expect(queue.jobs[0]?.payload).toStrictEqual(RECEIPT);
    });

    it("spends at most the published bound, which fits inside the consumer lock", async () => {
      // Full jitter: the worst case is the sum of the capped delays, so pinning the
      // draw at its maximum measures the bound rather than a sample of it.
      vi.spyOn(Math, "random").mockReturnValue(1);
      const schedule = Array.from({ length: PUBLISH_OUTCOME_CAS.retries }, (_, retry) =>
        publishOutcomeCasDelayMs(retry, 1)
      );
      expect(schedule).toStrictEqual([25, 50, 100, 200, 400, 400, 400, 400]);

      const { recorder } = build({ answers: [conflict] });
      const startedAt = Date.now();
      const pending = recorder.record(RECEIPT);
      await vi.runAllTimersAsync();
      await pending;

      expect(Date.now() - startedAt).toBe(1975);
      expect(Date.now() - startedAt).toBeLessThan(60_000);
    });

    it("does not retry a failure that is not a lost compare-and-swap", async () => {
      const { recorder, recordAttempt, queue } = build({
        answers: [
          () => err(new UseCaseError("the database is gone", USE_CASE_ERRORS.INTERNAL_ERROR)),
        ],
      });

      const pending = recorder.record(RECEIPT);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(recordAttempt.calls.length).toBe(1);
      expect(queue.jobs.length).toBe(1);
    });
  });

  describe("the promise the handler depends on: it never throws", () => {
    const sources: Array<[string, () => ReturnType<typeof build>]> = [
      [
        "the use case rejects",
        () =>
          build({
            answers: [
              () => {
                throw new Error("the connection dropped mid-write");
              },
            ],
          }),
      ],
      [
        "the durable queue rejects",
        () =>
          build({
            answers: [conflict],
            queue: throwingQueue(() => new Error("redis is unreachable")),
          }),
      ],
      [
        "the durable queue rejects with a value that cannot be described",
        () => build({ answers: [conflict], queue: throwingQueue(undescribable) }),
      ],
      [
        "the durable queue refuses the job",
        () => build({ answers: [conflict], queue: createQueue(err("CONNECTION_ERROR")) }),
      ],
      [
        "the logger throws",
        () =>
          build({
            answers: [conflict],
            logger: {
              errors: [],
              warns: [],
              port: {
                warn: () => {
                  throw new Error("the log transport closed");
                },
                error: () => {
                  throw new Error("the log transport closed");
                },
              },
            },
          }),
      ],
    ];

    for (const [name, make] of sources) {
      it(`answers err rather than throwing when ${name}`, async () => {
        const { recorder } = make();

        const pending = recorder.record(RECEIPT);
        await vi.runAllTimersAsync();
        const result = await pending.then(
          (value) => value,
          (reason: unknown) => reason
        );

        expect(result).toMatchObject({ ok: false });
      });
    }
  });

  describe("the receipt the durable job has to be able to replay", () => {
    it("refuses a receipt the consumer's own parse would reject, without enqueuing it", async () => {
      // The type says `string`; the wire can still deliver "". A job carrying it dies at
      // consume time as an `UnrecoverableError` — terminal on its FIRST failure — so the
      // refusal belongs here, where the caller still holds the outcome.
      const { recorder, recordAttempt, queue, counter } = build({});

      const result = await recorder.record({ ...RECEIPT, postId: "" });

      expect(result).toMatchObject({ ok: false, error: { durable: false } });
      expect(queue.jobs).toStrictEqual([]);
      expect(recordAttempt.calls).toStrictEqual([]);
      expect(counter.increments).toStrictEqual([{ reason: "undeliverable" }]);
    });
  });

  describe("the alert's own series", () => {
    it("counts an outcome that reached no durable path at all", async () => {
      // D14's alert is `increase(worker_publish_outcome_unrecorded_total[10m]) > 0`. An
      // outcome that could not even be QUEUED has exhausted more paths than one that
      // reached the dead letter, and it was the single case that moved nothing.
      const { recorder, counter } = build({
        answers: [conflict],
        queue: createQueue(err("CONNECTION_ERROR")),
      });

      const pending = recorder.record(RECEIPT);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result).toMatchObject({ ok: false, error: { durable: false } });
      expect(counter.increments).toStrictEqual([{ reason: "undeliverable" }]);
    });

    it("leaves the series alone when a durable job did take the outcome", async () => {
      const { recorder, counter } = build({ answers: [conflict] });

      const pending = recorder.record(RECEIPT);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result).toMatchObject({ ok: false, error: { durable: true } });
      expect(counter.increments).toStrictEqual([]);
    });
  });

  it("runs the write inside the job's tenant scope", async () => {
    const { recorder, recordAttempt } = build({});

    const pending = recorder.record(RECEIPT);
    await vi.runAllTimersAsync();
    await pending;

    expect(recordAttempt.scopes).toStrictEqual([ACCOUNT_ID]);
  });

  describe("the durable job", () => {
    it("applies the receipt it carries with the same write", async () => {
      const { recorder, recordAttempt } = build({});

      await recorder.applyDurableJob({ ...RECEIPT });

      expect(recordAttempt.calls.length).toBe(1);
      expect(recordAttempt.calls[0]).toMatchObject({
        postId: RECEIPT.postId,
        channelId: RECEIPT.channelId,
        episode: 2,
        attemptNo: 1,
      });
      expect(recordAttempt.scopes).toStrictEqual([ACCOUNT_ID]);
    });

    it("refuses a payload that is not a receipt without asking for a retry", async () => {
      const { recorder, recordAttempt } = build({});

      await expect(recorder.applyDurableJob({ postId: "post-0001" })).rejects.toThrow(/receipt/i);
      expect(recordAttempt.calls).toStrictEqual([]);
    });

    it("asks for a retry naming the outcome when the write itself rejects", async () => {
      const { recorder } = build({
        answers: [
          () => {
            throw new Error("the connection dropped mid-write");
          },
        ],
      });

      await expect(recorder.applyDurableJob({ ...RECEIPT })).rejects.toThrow(/outcome/i);
    });

    it("asks for a retry when the write did not land", async () => {
      const { recorder } = build({ answers: [conflict] });

      // The expectation is attached before the timers run: the rejection lands during
      // the backoff, and an unobserved one fails the run as an unhandled error.
      const rejected = expect(recorder.applyDurableJob({ ...RECEIPT })).rejects.toThrow(/outcome/i);
      await vi.runAllTimersAsync();

      await rejected;
    });
  });

  describe("the dead letter", () => {
    it("leaves a job alone while it still has attempts", async () => {
      const { recorder, deadLetter, counter } = build({});

      await recorder.reportFailedJob(
        { id: "j1", data: { ...RECEIPT }, attemptsMade: 1, opts: { attempts: 5 } },
        new Error("still failing")
      );

      expect(deadLetter.jobs).toStrictEqual([]);
      expect(counter.increments).toStrictEqual([]);
    });

    it("does not reject when the counter itself throws", async () => {
      // A `failed` listener that rejects takes the worker's own error handling with it,
      // and this one runs only when an outcome is already lost.
      const { recorder } = build({
        counter: {
          increments: [],
          port: {
            inc: () => {
              throw new Error("the registry rejected the labels");
            },
          },
        },
      });

      await expect(
        recorder.reportFailedJob(
          { id: "j1", data: { ...RECEIPT }, attemptsMade: 5, opts: { attempts: 5 } },
          new Error("still failing")
        )
      ).resolves.toBeUndefined();
    });

    it("resolves rather than rejecting when the dead letter raises the undescribable", async () => {
      // This listener is fired-and-forgotten by the worker, so a rejection here is an
      // unhandled one — and apps/workers installs no handler for it, so Node ends the
      // process exactly when an outcome is already lost and must still be archived.
      const { recorder } = build({ deadLetter: throwingQueue(undescribable) });

      await expect(
        recorder.reportFailedJob(
          { id: "j1", data: { ...RECEIPT }, attemptsMade: 5, opts: { attempts: 5 } },
          new Error("still failing")
        )
      ).resolves.toBeUndefined();
    });

    it("dead-letters an UnrecoverableError on its first and only failure", async () => {
      // BullMQ ends such a job at once and STILL increments `attemptsMade`, so it arrives
      // here terminal with 1 of 5 spent. Comparing attempts alone let the whole
      // non-exhaustion class — which `applyDurableJob` itself manufactures — pass in
      // silence: no dead letter, no counter, no ERROR line.
      const { recorder, deadLetter, counter, logger } = build({});

      await recorder.reportFailedJob(
        { id: "j1", data: { ...RECEIPT }, attemptsMade: 1, opts: { attempts: 5 } },
        new UnrecoverableError("publish outcome job carries no receipt")
      );

      expect(deadLetter.jobs.length).toBe(1);
      expect(counter.increments).toStrictEqual([{ reason: "unrecoverable" }]);
      expect(logger.errors.length).toBe(1);
    });

    it("dead-letters any job BullMQ has already finished, whatever ended it", async () => {
      // `finishedOn` is set on exactly the branch that moved the job to the failed set,
      // so it answers for terminal causes this module cannot enumerate.
      const { recorder, deadLetter, counter } = build({});

      await recorder.reportFailedJob(
        {
          id: "j1",
          data: { ...RECEIPT },
          attemptsMade: 1,
          finishedOn: Date.parse("2026-09-23T00:00:00Z"),
          opts: { attempts: 5 },
        },
        new Error("the backoff strategy declined a retry")
      );

      expect(deadLetter.jobs.length).toBe(1);
      expect(counter.increments).toStrictEqual([{ reason: "terminal" }]);
    });

    it("dead-letters an exhausted job, counts it unrecorded and says so at ERROR", async () => {
      const { recorder, deadLetter, counter, logger } = build({});

      await recorder.reportFailedJob(
        { id: "j1", data: { ...RECEIPT }, attemptsMade: 5, opts: { attempts: 5 } },
        new Error("still failing")
      );

      expect(deadLetter.jobs.length).toBe(1);
      expect(deadLetter.jobs[0]?.payload).toMatchObject({ failedReason: "still failing" });
      expect(counter.increments).toStrictEqual([{ reason: "exhausted" }]);
      expect(logger.errors.length).toBe(1);
    });
  });

  describe("wired into the publish path", () => {
    it("registers the durable consumer in the worker", () => {
      const worker = readFileSync(path.join(workersSrc, "publishWorker.ts"), "utf8");

      expect(worker).toContain("RECORD_PUBLICATION_OUTCOME");
      expect(worker).toContain("createPublishOutcomeRecorder");
    });

    it("is the recorder the publish handler is built with", () => {
      // The composition root owns this edge: the handler takes the recorder as a
      // dependency, so a root that built the handler without it would compile and
      // then lose every outcome the worker produced.
      const worker = readFileSync(path.join(workersSrc, "publishWorker.ts"), "utf8");

      expect(worker).toMatch(/new PublishHandler\(\{[\s\S]*?outcomeRecorder,/);
      expect(worker).toMatch(/new PublishHandler\(\{[\s\S]*?publicationRecord:/);
    });
  });
});
