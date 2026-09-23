/**
 * @file publishOutcomeRecorder.ts
 * @description Makes the outcome of a provider call durable. After the provider has
 *   accepted content, the record is the only thing that says so, and re-running the
 *   provider to obtain another chance at writing it would publish the same content
 *   twice — so this module answers a `Result` and NEVER throws, retries only the lost
 *   compare-and-swap, and hands an outcome it still could not write to a durable job
 *   that carries the same receipt. When that job ends — however BullMQ ends it — the
 *   receipt reaches the dead letter and the unrecorded counter says so out loud, and
 *   an outcome that reached no durable path at all moves that same counter.
 * @layer infrastructure
 */
import { UnrecoverableError } from "bullmq";
import { z } from "zod";
import { ok, err, type Result } from "@shared/types";
import { USE_CASE_ERRORS, type UseCaseError } from "@core/application/UseCase.js";
import type {
  RecordChannelPublicationAttemptInput,
  RecordChannelPublicationAttemptOutput,
} from "@core/posts";
import {
  ATTEMPT_CLASSIFICATIONS,
  CHANNEL_FAILURE_CODES,
  ContentFingerprint,
  FragmentReference,
  providedReference,
  type AttemptResult,
} from "@core/domain/index.js";
import { withWorkerTenant } from "./security/workerTenantContext.js";

/**
 * Eight retries on a 25 ms base doubling to a 400 ms cap. With full jitter the worst
 * case is the sum of the caps — 1.975 s — which stays well inside the consumer's 60 s
 * lock, so a contended write never loses the job it is writing for.
 */
export const PUBLISH_OUTCOME_CAS = { retries: 8, baseMs: 25, capMs: 400 } as const;

const fragmentSchema = z.object({
  index: z.number().int().min(1),
  externalId: z.string().min(1),
  url: z.string().min(1).optional(),
});

/**
 * The receipt is primitive by contract: it travels as a queue payload, so no domain
 * object crosses the wire and the durable job replays exactly what the worker saw.
 */
const receiptSchema = z.object({
  postId: z.string().min(1),
  channelId: z.string().min(1),
  accountId: z.string().min(1),
  episode: z.number().int().min(1),
  attemptNo: z.number().int().min(1),
  planSize: z.number().int().min(1),
  result: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("published"),
      fragments: z.array(fragmentSchema),
      headExternalId: z.string().min(1).optional(),
      publishedAt: z.string().min(1),
      contentHash: z.string().min(1),
    }),
    z.object({
      kind: z.literal("failed"),
      classification: z.enum(ATTEMPT_CLASSIFICATIONS),
      // Absent whenever the classifier named no cause. The closed set has no member
      // for a rate limit or a dropped connection, and the two that would fit are the
      // aggregate's exhaustion codes, which are false while the channel has budget.
      code: z.enum(CHANNEL_FAILURE_CODES).optional(),
      detail: z.string().optional(),
      publishedFragments: z.array(fragmentSchema),
    }),
  ]),
});

export type PublishOutcomeReceipt = z.infer<typeof receiptSchema>;

/** Why an outcome is still unwritten, and whether a durable job now carries it. */
export interface PublishOutcomeUnrecorded {
  readonly reason: string;
  readonly durable: boolean;
}

/** The write this module retries. `RecordChannelPublicationAttemptUseCase` satisfies it. */
export interface RecordChannelAttemptPort {
  execute(
    input: RecordChannelPublicationAttemptInput
  ): PromiseLike<Result<RecordChannelPublicationAttemptOutput, UseCaseError>>;
}

/** The narrow producer surface used here; a `QueuePort` satisfies it. */
export interface OutcomeQueuePort {
  enqueue(job: {
    dedupeKey: string;
    payload: Record<string, unknown>;
  }): Promise<Result<string, string>>;
}

/** The failed BullMQ job as this module reads it; a bullmq `Job` satisfies it. */
export interface FailedOutcomeJob {
  readonly id?: string | undefined;
  readonly data: unknown;
  readonly attemptsMade: number;
  /** Set by `moveToFailed` on exactly the branch that ends the job, whatever ended it. */
  readonly finishedOn?: number | undefined;
  readonly opts?: { attempts?: number | undefined } | undefined;
}

export interface PublishOutcomeRecorderDeps {
  readonly recordAttempt: RecordChannelAttemptPort;
  readonly outcomeQueue: OutcomeQueuePort;
  readonly deadLetterQueue: OutcomeQueuePort;
  /** `worker_publish_outcome_unrecorded_total` — the alert's own series. */
  readonly unrecorded: { inc(labels: Record<string, string>): void };
  readonly logger: {
    warn(obj: object, msg?: string): void;
    error(obj: object, msg?: string): void;
  };
}

export interface PublishOutcomeRecorder {
  record(
    receipt: PublishOutcomeReceipt
  ): Promise<Result<RecordChannelPublicationAttemptOutput, PublishOutcomeUnrecorded>>;
  applyDurableJob(payload: Record<string, unknown>): Promise<void>;
  reportFailedJob(job: FailedOutcomeJob, error: Error): Promise<void>;
}

/** The durable job's own retry budget, and the fallback when a job omits it. */
export const PUBLISH_OUTCOME_JOB_ATTEMPTS = 5;

/**
 * @function publishOutcomeCasDelayMs
 * @description The full-jitter delay before one retry: a uniform draw over the capped
 *   exponential, so contending writers spread instead of colliding again together.
 * @param retry - Zero-based retry ordinal.
 * @param draw - A draw in [0, 1); 1 yields the bound this schedule promises.
 * @returns The delay in milliseconds.
 */
export function publishOutcomeCasDelayMs(retry: number, draw: number): number {
  const ceiling = Math.min(PUBLISH_OUTCOME_CAS.capMs, PUBLISH_OUTCOME_CAS.baseMs * 2 ** retry);
  return Math.round(draw * ceiling);
}

/** Reports what it can and swallows nothing else: the sink itself is what failed. */
function note(
  logger: PublishOutcomeRecorderDeps["logger"],
  obj: object,
  msg: string,
  level: "warn" | "error" = "error"
): void {
  try {
    logger[level](obj, msg);
  } catch {
    // The log transport is the failure being reported; there is nowhere left to report it.
  }
}

/**
 * Total by construction. `String(value)` THROWS for a null-prototype object and for
 * anything whose own coercion throws, so the naive form turns an undescribable escape
 * into a second escape — on paths whose whole purpose is that nothing escapes.
 */
function describeError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "an escape that cannot be described";
  }
}

function toFragments(
  raw: readonly z.infer<typeof fragmentSchema>[]
): Result<FragmentReference[], string> {
  const fragments: FragmentReference[] = [];
  for (const props of raw) {
    // Spread conditionally rather than passing `url: undefined`: the value object's
    // optional field does not admit the key holding undefined.
    const made = FragmentReference.create({
      index: props.index,
      externalId: props.externalId,
      ...(props.url !== undefined && { url: props.url }),
    });
    if (!made.ok) {
      return err(made.error.message);
    }
    fragments.push(made.value);
  }
  return ok(fragments);
}

/** Rebuilds the domain result from the wire receipt; every value object validates itself. */
function toAttemptResult(receipt: PublishOutcomeReceipt): Result<AttemptResult, string> {
  const { result } = receipt;
  if (result.kind === "failed") {
    const fragments = toFragments(result.publishedFragments);
    if (!fragments.ok) {
      return err(fragments.error);
    }
    return ok({
      kind: "failed",
      classification: result.classification,
      ...(result.code !== undefined && { code: result.code }),
      ...(result.detail !== undefined && { detail: result.detail }),
      publishedFragments: fragments.value,
    });
  }

  const fragments = toFragments(result.fragments);
  if (!fragments.ok) {
    return err(fragments.error);
  }
  const publishedAt = new Date(result.publishedAt);
  if (Number.isNaN(publishedAt.getTime())) {
    return err(`publishedAt is not a moment: ${result.publishedAt}`);
  }
  const contentHash = ContentFingerprint.fromString(result.contentHash);
  if (!contentHash.ok) {
    return err(contentHash.error.message);
  }
  const head =
    result.headExternalId === undefined ? undefined : providedReference(result.headExternalId);
  if (head !== undefined && !head.ok) {
    return err(head.error.message);
  }
  return ok({
    kind: "published",
    fragments: fragments.value,
    ...(head !== undefined && head.ok && { head: head.value }),
    publishedAt,
    contentHash: contentHash.value,
  });
}

/** The job id is the receipt's own identity, so a redelivery cannot become a second job. */
function outcomeJobId(receipt: PublishOutcomeReceipt): string {
  return `outcome-${receipt.postId}-${receipt.channelId}-e${receipt.episode}-a${receipt.attemptNo}`;
}

/**
 * Why BullMQ will not run this job again, or undefined while it still will.
 *
 * Exhausting the attempts is only ONE way to get there. An `UnrecoverableError` — which
 * is how this module refuses a payload that is not a receipt — ends the job on its FIRST
 * failure, and `moveToFailed` increments `attemptsMade` on that branch too, so the job
 * arrives here terminal with one attempt spent. A gate that only compares attempts lets
 * that whole class reach neither the dead letter nor the alert. `finishedOn` is BullMQ's
 * own answer, set on exactly the branch that moved the job to the failed set; the other
 * two terms stay because a lost receipt must not rest on a single field.
 */
function terminalFailureReason(job: FailedOutcomeJob, error: Error): string | undefined {
  if (job.attemptsMade >= (job.opts?.attempts ?? PUBLISH_OUTCOME_JOB_ATTEMPTS)) {
    return "exhausted";
  }
  if (error instanceof UnrecoverableError || error.name === "UnrecoverableError") {
    return "unrecoverable";
  }
  return job.finishedOn === undefined ? undefined : "terminal";
}

/**
 * @function createPublishOutcomeRecorder
 * @description Builds the recorder over the shared attempt write, the durable queue and
 *   the dead letter.
 * @param deps - The write port, both queues, the unrecorded counter and a logger.
 * @returns The recorder.
 */
export function createPublishOutcomeRecorder(
  deps: PublishOutcomeRecorderDeps
): PublishOutcomeRecorder {
  /**
   * The bounded compare-and-swap. Only a lost swap is retried: anything else is a
   * durable condition that another immediate attempt would meet unchanged. Never
   * throws — every escape is answered as a value.
   */
  async function write(
    receipt: PublishOutcomeReceipt
  ): Promise<Result<RecordChannelPublicationAttemptOutput, string>> {
    const result = toAttemptResult(receipt);
    if (!result.ok) {
      return err(`the receipt does not describe an attempt: ${result.error}`);
    }
    const input: RecordChannelPublicationAttemptInput = {
      postId: receipt.postId,
      channelId: receipt.channelId,
      episode: receipt.episode,
      attemptNo: receipt.attemptNo,
      planSize: receipt.planSize,
      result: result.value,
    };

    let last = "the write was never attempted";
    for (let retry = 0; retry <= PUBLISH_OUTCOME_CAS.retries; retry += 1) {
      try {
        const answer = await withWorkerTenant(receipt.accountId, async () =>
          deps.recordAttempt.execute(input)
        );
        if (answer.ok) {
          return ok(answer.value);
        }
        last = answer.error.message;
        if (answer.error.code !== USE_CASE_ERRORS.CONFLICT) {
          return err(last);
        }
      } catch (error: unknown) {
        return err(describeError(error));
      }
      if (retry < PUBLISH_OUTCOME_CAS.retries) {
        const delay = publishOutcomeCasDelayMs(retry, Math.random());
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    return err(`the record stayed contended after ${PUBLISH_OUTCOME_CAS.retries} retries: ${last}`);
  }

  /** The alert's own series. The registry can refuse the labels, and every caller here
   *  runs when an outcome is already lost, so that refusal cannot become a second one. */
  function countUnrecorded(reason: string, context: object): void {
    try {
      deps.unrecorded.inc({ reason });
    } catch (cause: unknown) {
      note(deps.logger, { ...context, cause: describeError(cause) }, "Unrecorded counter refused");
    }
  }

  /**
   * The one exit for an outcome that no durable path carries. Every such exit moves the
   * counter, because `worker_publish_outcome_unrecorded_total` is the only thing a human
   * ever sees: an outcome that could not even be queued has exhausted MORE paths than one
   * that reached the dead letter, and it used to be the single case that counted nothing.
   */
  function undeliverable(
    reason: string,
    context: object
  ): Result<RecordChannelPublicationAttemptOutput, PublishOutcomeUnrecorded> {
    countUnrecorded("undeliverable", context);
    note(deps.logger, { ...context, reason }, "Publish outcome reached no durable path");
    return err({ reason, durable: false });
  }

  return {
    async record(receipt) {
      // Empty until the receipt is proven readable: it arrives as a wire value, so even
      // reading an id off it is a call this module cannot let escape.
      let context: object = {};
      try {
        // The durable job replays these exact bytes, so a receipt the consumer's own
        // parse would refuse can never be made durable — and BullMQ ends such a job on
        // its FIRST failure, before its attempts are spent. Refusing it here answers the
        // caller while it still holds the outcome.
        const parsed = receiptSchema.safeParse(receipt);
        if (!parsed.success) {
          return undeliverable(
            `the receipt does not describe a publication: ${parsed.error.message}`,
            context
          );
        }
        context = { postId: parsed.data.postId, channelId: parsed.data.channelId };

        const written = await write(parsed.data);
        if (written.ok) {
          return ok(written.value);
        }
        const queued = await deps.outcomeQueue.enqueue({
          dedupeKey: outcomeJobId(parsed.data),
          payload: parsed.data,
        });
        if (!queued.ok) {
          return undeliverable(written.error, context);
        }
        note(
          deps.logger,
          { ...context, reason: written.error },
          "Publish outcome not written inline; a durable job now carries it",
          "warn"
        );
        return err({ reason: written.error, durable: true });
      } catch (error: unknown) {
        // The caller rethrows to BullMQ, which re-runs the provider over content that
        // is already live. Nothing from here may escape, including a broken log sink.
        return undeliverable(describeError(error), context);
      }
    },

    async applyDurableJob(payload) {
      const parsed = receiptSchema.safeParse(payload);
      if (!parsed.success) {
        // Retrying cannot change the payload, so the job is terminal rather than failed.
        throw new UnrecoverableError(
          `publish outcome job carries no receipt: ${parsed.error.message}`
        );
      }
      const written = await write(parsed.data);
      if (!written.ok) {
        throw new Error(`the publication outcome is still unwritten: ${written.error}`);
      }
    },

    async reportFailedJob(job, error) {
      try {
        const terminal = terminalFailureReason(job, error);
        if (terminal === undefined) {
          return;
        }
        const archived = await deps.deadLetterQueue.enqueue({
          dedupeKey: `dlq-outcome-${job.id ?? new Date().toISOString()}`,
          payload: {
            original: job.data,
            failedReason: error.message,
            attemptsMade: job.attemptsMade,
            movedAt: new Date().toISOString(),
          },
        });
        countUnrecorded(terminal, { jobId: job.id });
        note(
          deps.logger,
          { jobId: job.id, archived: archived.ok, reason: terminal, failedReason: error.message },
          "A channel's publication outcome could not be recorded and is now dead-lettered"
        );
      } catch (cause: unknown) {
        // A listener that rejects takes the worker's error handling with it, and this
        // one runs only when an outcome is already lost. Every read of the job is inside
        // this guard for the same reason: a hostile accessor is not a second failure.
        note(deps.logger, { cause: describeError(cause) }, "Dead letter failed");
      }
    },
  };
}
