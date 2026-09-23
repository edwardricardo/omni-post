/**
 * @file outcomeDoubleContract.test.ts
 * @description Pins the worker suites' outcome double to the aggregate it doubles.
 *
 *              `settledKindOf` in `tests/setup.ts` decides what the default recorder
 *              answers, and the handler reads that answer to decide whether to hand the
 *              job back to the queue. So a branch where the double and
 *              `ChannelPublication.recordAttempt` disagree is a branch where every suite
 *              riding the default reports green over a handler that does the opposite in
 *              production — the defect class this pin exists to close.
 *
 *              Each case drives the REAL recorder over a REAL aggregate, so the receipt
 *              reaches the entity through the same `toAttemptResult` mapping production
 *              uses. Rebuilding that mapping here would have been a second source of
 *              truth, which is the thing under test.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { ok, err, type Result } from "@shared/types";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type {
  RecordChannelPublicationAttemptInput,
  RecordChannelPublicationAttemptOutput,
} from "@core/posts";
import {
  ATTEMPT_CLASSIFICATIONS,
  CHANNEL_ATTEMPT_BUDGET,
  CHANNEL_FAILURE_CODES,
  ChannelId,
  ChannelPublication,
  PUBLICATION_OUTCOME_KINDS,
  type PublicationOutcomeKind,
} from "@core/domain/index.js";
import {
  createPublishOutcomeRecorder,
  type PublishOutcomeReceipt,
} from "../../src/publishOutcomeRecorder.js";
import { outcomeOfKind, settledKindOf, TEST_CONTENT_HASH } from "../setup.js";

const BASE = {
  postId: "8f1d5c22-0e3a-4a18-9c6b-2f7b41d0a901",
  // A real UUID, because `ChannelId.fromString` refuses anything else and the point
  // of this pin is that nothing between the receipt and the entity is stubbed.
  channelId: "3c9e7b64-5a21-4d8f-b0c3-91ea6d47f512",
  accountId: "account-contract-001",
  episode: 1,
  planSize: 2,
} as const;

const LIVE_FRAGMENT = { index: 1, externalId: "x-live-001" } as const;

/** The status word the write reports beside the outcome; only the kind is compared. */
function statusOf(kind: PublicationOutcomeKind): RecordChannelPublicationAttemptOutput["status"] {
  if (kind === PUBLICATION_OUTCOME_KINDS.PUBLISHED) return "PUBLISHED";
  return kind === PUBLICATION_OUTCOME_KINDS.EXCLUDED ? "FAILED" : "PUBLISHING";
}

/**
 * Records one receipt against a freshly opened channel and reports the kind the
 * aggregate settled on. Nothing is stubbed between the receipt and the entity.
 */
async function kindTheAggregateReaches(
  receipt: PublishOutcomeReceipt
): Promise<PublicationOutcomeKind> {
  const channelId = ChannelId.fromString(receipt.channelId);
  if (!channelId.ok) {
    throw new Error(`the fixture channel id is not one: ${channelId.error.message}`);
  }
  const channel = ChannelPublication.declare(channelId.value);
  const opened = channel.openEpisode(receipt.episode);
  if (!opened.ok) {
    throw new Error(`the fixture episode did not open: ${opened.error.message}`);
  }

  const recorder = createPublishOutcomeRecorder({
    recordAttempt: {
      async execute(
        input: RecordChannelPublicationAttemptInput
      ): Promise<Result<RecordChannelPublicationAttemptOutput, UseCaseError>> {
        const applied = channel.recordAttempt(input);
        if (!applied.ok) {
          return err(new UseCaseError(applied.error.message, USE_CASE_ERRORS.INTERNAL_ERROR));
        }
        return ok({
          postId: receipt.postId,
          projectId: "project-contract-001",
          channelId: receipt.channelId,
          applied: applied.value.applied,
          outcome: outcomeOfKind(channel.outcomeKind),
          status: statusOf(channel.outcomeKind),
        });
      },
    },
    // A receipt that reached the aggregate never touches either queue; a case that
    // did would fail on the `ok` assertion below rather than silently enqueue.
    outcomeQueue: { enqueue: async () => ok("never-enqueued") },
    deadLetterQueue: { enqueue: async () => ok("never-dead-lettered") },
    unrecorded: { inc: () => {} },
    logger: { warn: () => {}, error: () => {} },
  });

  const written = await recorder.record(receipt);
  if (!written.ok) {
    throw new Error(`the contract fixture never reached the aggregate: ${written.error.reason}`);
  }
  return written.value.outcome.kind;
}

/** One case per branch of the aggregate's settlement arithmetic, in its own order. */
const CASES: ReadonlyArray<{ readonly name: string; readonly receipt: PublishOutcomeReceipt }> = [
  {
    name: "a transient failure inside the budget",
    receipt: {
      ...BASE,
      attemptNo: 1,
      result: {
        kind: "failed",
        classification: ATTEMPT_CLASSIFICATIONS.TRANSIENT,
        publishedFragments: [],
      },
    },
  },
  {
    name: "an unclassifiable failure inside the budget",
    receipt: {
      ...BASE,
      attemptNo: 1,
      result: {
        kind: "failed",
        classification: ATTEMPT_CLASSIFICATIONS.UNCLASSIFIABLE,
        publishedFragments: [],
      },
    },
  },
  {
    name: "a nontransient failure that names its cause",
    receipt: {
      ...BASE,
      attemptNo: 1,
      result: {
        kind: "failed",
        classification: ATTEMPT_CLASSIFICATIONS.NONTRANSIENT,
        code: CHANNEL_FAILURE_CODES.CHANNEL_AUTH_REQUIRED,
        publishedFragments: [],
      },
    },
  },
  {
    name: "a failure that left a fragment live",
    receipt: {
      ...BASE,
      attemptNo: 1,
      result: {
        kind: "failed",
        classification: ATTEMPT_CLASSIFICATIONS.NONTRANSIENT,
        code: CHANNEL_FAILURE_CODES.THREAD_INTERRUPTED,
        publishedFragments: [LIVE_FRAGMENT],
      },
    },
  },
  {
    name: "a transient failure that spends the last of the budget",
    receipt: {
      ...BASE,
      attemptNo: CHANNEL_ATTEMPT_BUDGET,
      result: {
        kind: "failed",
        classification: ATTEMPT_CLASSIFICATIONS.TRANSIENT,
        publishedFragments: [],
      },
    },
  },
  {
    name: "an unclassifiable failure that spends the last of the budget",
    receipt: {
      ...BASE,
      attemptNo: CHANNEL_ATTEMPT_BUDGET,
      result: {
        kind: "failed",
        classification: ATTEMPT_CLASSIFICATIONS.UNCLASSIFIABLE,
        publishedFragments: [],
      },
    },
  },
  {
    name: "every fragment in the plan published",
    receipt: {
      ...BASE,
      attemptNo: 1,
      result: {
        kind: "published",
        fragments: [
          { index: 1, externalId: "x-published-001" },
          { index: 2, externalId: "x-published-002" },
        ],
        headExternalId: "x-published-001",
        publishedAt: "2026-03-02T12:30:00.000Z",
        contentHash: TEST_CONTENT_HASH,
      },
    },
  },
];

describe("the outcome double agrees with the aggregate it doubles", () => {
  for (const { name, receipt } of CASES) {
    it(`settles ${name} the same way`, async () => {
      expect(settledKindOf(receipt)).toBe(await kindTheAggregateReaches(receipt));
    });
  }

  it("covers every classification the classifier can produce", () => {
    // A classification with no case is a branch this pin would not notice drifting.
    const covered = new Set<string>();
    for (const { receipt } of CASES) {
      if (receipt.result.kind === "failed") {
        covered.add(receipt.result.classification);
      }
    }
    expect([...covered].sort()).toStrictEqual([...Object.values(ATTEMPT_CLASSIFICATIONS)].sort());
  });
});
