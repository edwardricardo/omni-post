/**
 * @file publishAdmission.ts
 * @description Whether `POST /sagas/post-publishing/start` may start a publishing saga for
 *              a post that already exists.
 *
 *              It is a module of its own because the decision stopped being a status
 *              comparison. It now reads the post's per-channel publication record, answers
 *              differently per mode, and has to say WHICH refusal it is in a form a client
 *              can branch on — three concerns that, written inline, would only be reachable
 *              by staging an HTTP request, an authenticated customer, a project, a channel
 *              set and a saga manager for every branch. Here the DECISION is one pure
 *              function over values, and the one step that cannot be pure — reading the
 *              semantic lock — is a thin gatherer around it rather than a fourth thing the
 *              route has to remember to do in the right order.
 * @layer infrastructure
 */

import { type Result, ok, err, ErrorCode, AppError } from "@shared/types";
import {
  PUBLISH_STATUS,
  type PublishStatusValue,
} from "@core/domain/value-objects/PublishStatus.js";
import type { FragmentReferenceJson } from "@core/domain/value-objects/FragmentReference.js";
import type { ChannelPublications } from "@core/domain/aggregates/ChannelPublications.js";
import type { PostAggregate } from "@core/domain/aggregates/PostAggregate.js";
import type { SemanticLockPort } from "@ports/core";
import { logger } from "../lib/logger.js";
import { incrementPublishAdmissionLockUnreadable } from "../metrics/businessMetrics.js";

/** The two modes that can operate on an existing post. `draft` creates one and never gets here. */
export type PublishStartMode = "schedule" | "publish-now";

/**
 * One channel's publication record, reduced to the three facts the admission asks about.
 * A narrow view rather than the entity: this decision has no business being able to reach
 * for a field it did not declare it reads.
 */
export interface AdmissionChannelRecord {
  readonly channelId: string;
  /** Neither published nor holding fragments a re-send would duplicate. */
  readonly redrivable: boolean;
  /** Fragments of this post are still on the provider although the channel did not publish. */
  readonly pendingRetraction: boolean;
  /** What is still out there, in the shape the refusal hands to the customer. */
  readonly liveFragments: readonly FragmentReferenceJson[];
}

/** Everything the decision reads. An empty `records` means the post has no publication record. */
export interface PublishAdmissionRequest {
  readonly mode: PublishStartMode;
  readonly status: PublishStatusValue;
  readonly records: readonly AdmissionChannelRecord[];
  readonly requestedChannelIds: readonly string[];
  /** The saga currently holding this post's semantic lock, or null when nothing holds it. */
  readonly lockHolderSagaId: string | null;
}

/** A refusal, in the terms the route turns into an HTTP answer. */
export interface PublishAdmissionRefusal {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly message: string;
  /** The payload the customer needs to act, when the refusal has one. */
  readonly details?: Record<string, unknown>;
}

/** Admitted, or refused with the reason. */
export type PublishAdmission = Result<void, PublishAdmissionRefusal>;

/**
 * The words a schedule may operate on. Scheduling a `FAILED` or `PARTIALLY_PUBLISHED` post
 * would park a re-send behind a timer nobody is watching, so a delayed re-drive is refused
 * and publish-now stays the only re-drive route.
 */
const SCHEDULE_ADMITS: ReadonlySet<PublishStatusValue> = new Set([
  PUBLISH_STATUS.DRAFT,
  PUBLISH_STATUS.SCHEDULED,
]);

/**
 * @function admissionRecordsOf
 * @description Reduces a post's record set to the admission view.
 * @param publications - The post's per-channel records.
 * @returns One view per recorded channel; empty when the post has no record.
 */
export function admissionRecordsOf(
  publications: ChannelPublications
): readonly AdmissionChannelRecord[] {
  return publications.all.map((record) => ({
    channelId: record.channelId.value,
    redrivable: record.redrivable(),
    pendingRetraction: record.pendingRetraction,
    liveFragments: record.liveFragments.map((fragment) => fragment.toJSON()),
  }));
}

/**
 * @function admitPublishStart
 * @description Decides whether the saga may start for an existing post.
 * @param request - The mode, the post's word, its record, the channels named and the lock holder.
 * @returns ok when the request is admitted, or the refusal the route answers with.
 */
export function admitPublishStart(request: PublishAdmissionRequest): PublishAdmission {
  // The lock first. A running publish is the more actionable fact than anything the record
  // says, because that saga is still changing the record the other branches would read.
  if (request.lockHolderSagaId !== null) {
    return err({
      statusCode: 409,
      code: ErrorCode.PUBLICATION_IN_FLIGHT,
      message: "A publication is already in flight for this post",
      details: { sagaId: request.lockHolderSagaId },
    });
  }

  if (request.mode === "schedule") {
    return SCHEDULE_ADMITS.has(request.status)
      ? ok(undefined)
      : err(
          refusal(
            `Post is in ${request.status} status; only DRAFT or SCHEDULED posts can be scheduled via this saga`
          )
        );
  }

  if (request.records.length === 0) {
    // FAIL CLOSED ON ABSENCE, and this is the one place the record's own rule is not
    // enough. A post carrying no record is not evidence that it never published: every
    // post published before the record existed carries none, and so does every post
    // published on a tip where the publishing path does not write one yet. Admitting it
    // would re-send content that is already live. Until a record exists, the post's word
    // is the whole of the truth, so the rule the route has always applied is the rule
    // that keeps applying.
    return request.status === PUBLISH_STATUS.DRAFT
      ? ok(undefined)
      : err(
          refusal(
            `Post is in ${request.status} status and carries no publication record; only a DRAFT post can be published this way`
          )
        );
  }

  const stranded = request.records.find(
    (record) => record.pendingRetraction && request.requestedChannelIds.includes(record.channelId)
  );
  if (stranded !== undefined) {
    // Refused even when another named channel could still be attempted. Re-sending a
    // thread whose earlier fragments are live double-posts them, and past the pivot there
    // is no undo — so the request that names the channel is refused rather than quietly
    // narrowed to the channels that are safe.
    return err({
      statusCode: 409,
      code: ErrorCode.CHANNEL_HAS_LIVE_FRAGMENTS,
      message: `Channel ${stranded.channelId} still holds live fragments of this post and must be cleared before it is attempted again`,
      details: { channelId: stranded.channelId, fragments: stranded.liveFragments },
    });
  }

  if (request.records.some((record) => record.redrivable)) {
    return ok(undefined);
  }

  // Nothing left to send. The status is named because the harm this closes is a duplicate
  // send, and the customer's question is "why not" — which the word answers and a record
  // summary does not.
  return err(
    refusal(
      `Post is in ${request.status} status and its publication record has no channel that can be published again`
    )
  );
}

/**
 * @function refusal
 * @description The plain client error every admission branch that is not a typed conflict
 *              answers with.
 * @param message - What the customer is told.
 * @returns The refusal.
 */
function refusal(message: string): PublishAdmissionRefusal {
  return { statusCode: 400, code: ErrorCode.BAD_REQUEST, message };
}

/** What a route hands over to have an existing post's start admitted. */
export interface ExistingPostStartRequest {
  readonly post: PostAggregate;
  readonly mode: PublishStartMode;
  readonly requestedChannelIds: readonly string[];
  /** Absent in a deployment that runs no semantic-lock backend. */
  readonly lockStore: SemanticLockPort | undefined;
}

/**
 * @function admitExistingPostStart
 * @description Gathers what the decision reads — the post's word, its record, and who holds
 *              its publication lock — and decides. The gathering lives here rather than at
 *              the route so the three inputs cannot be assembled in one place and read in
 *              another.
 * @param request - The loaded post, the mode, the channels named, and the lock backend.
 * @returns ok when admitted, or the refusal the route answers with.
 */
export async function admitExistingPostStart(
  request: ExistingPostStartRequest
): Promise<PublishAdmission> {
  return admitPublishStart({
    mode: request.mode,
    status: request.post.status.value,
    records: admissionRecordsOf(request.post.publications),
    requestedChannelIds: request.requestedChannelIds,
    lockHolderSagaId: await publicationLockHolder(request.lockStore, request.post.id.value),
  });
}

/**
 * @function publicationLockHolder
 * @description The saga currently publishing this post, read WITHOUT taking it.
 *
 *              A failed read answers "no holder observed", and that is a decision rather
 *              than a convenience. The port deliberately keeps the failure a failure —
 *              collapsing it there would make "the store is unreachable" indistinguishable
 *              from "the key is free" for every caller. Here the caller can weigh it:
 *              refusing every publish while the lock store is unreachable trades a rare
 *              duplicate for a total outage, and the guarantee does not rest on this check
 *              anyway. The saga's own step acquires the lock and fails closed on contention,
 *              the episode opening is idempotent, and the job ids dedupe — this read exists
 *              to give the customer a 409 they can act on instead of a saga that quietly
 *              fails a minute later. A deployment with no lock store at all skips the step
 *              entirely and relies on exactly those three.
 * @param lockStore - The lock backend, when the deployment has one.
 * @param postId - The post the caller wants to publish.
 * @returns The holding saga id, or null when nothing holds it or the read failed.
 */
async function publicationLockHolder(
  lockStore: SemanticLockPort | undefined,
  postId: string
): Promise<string | null> {
  if (lockStore === undefined) {
    // Not counted, and the omission is measured: the api composition root constructs the
    // Redis store unconditionally outside `SCHEMA_ONLY` (`index.ts:730-733`), and
    // `SCHEMA_ONLY` serves no request — so reaching here is a test-only state. A counter
    // arm whose only producer is a test suite would report a condition that cannot occur.
    return null;
  }
  const held = await lockStore.holder(`post-publishing:${postId}`);
  if (!held.ok) {
    // Both, and each answers a different question. The log names WHICH request lost the
    // check; the counter is the only one that can be alerted on and the only one that
    // survives a retention window, which is what makes a degradation that lasted forty
    // minutes discoverable afterwards instead of being one more warn line per start.
    logger.warn(
      { postId, error: held.error },
      "Semantic lock holder unreadable; admitting the start on the saga's own lock step"
    );
    incrementPublishAdmissionLockUnreadable();
    return null;
  }
  return held.value;
}

/**
 * @function refusalToAppError
 * @description Turns an admission refusal into the error the single global handler
 *              serializes. The discriminator travels as the error's `code` because that is
 *              the field the handler puts on the wire in every environment; the payload a
 *              customer acts on travels in `details`.
 * @param answer - What the admission decided.
 * @returns The error to throw.
 */
export function refusalToAppError(answer: PublishAdmissionRefusal): AppError {
  return new AppError(answer.code, answer.statusCode, answer.message, true, answer.details);
}
