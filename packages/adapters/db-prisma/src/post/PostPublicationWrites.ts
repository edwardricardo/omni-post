/**
 * @file PostPublicationWrites.ts
 * @description Every statement the per-channel publication record needs, in one place:
 *   the narrow compare-and-swap on the post row, the per-record upsert, and the guard
 *   that refuses an aggregate carrying a pending content edit. It lives beside the
 *   repository rather than inside it so the publication surface can be read — and
 *   reviewed — without reading the whole adapter.
 * @layer infrastructure
 */

import type {
  Prisma,
  ChannelExclusionReason,
  ChannelPublicationOutcome,
  ChannelRetractionBlock,
  ChannelRetractionClearance,
} from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import {
  PostAggregate,
  InvariantViolationError,
  VersionConflictError,
  isProvidedReference,
  type ChannelPublication,
} from "@core/domain/index.js";
import type { OutboxWriter } from "@core/domain/repositories/OutboxWriter.js";
import { PrismaUnitOfWork } from "../unitofwork/PrismaUnitOfWork.js";

type TxClient = Prisma.TransactionClient;

/**
 * Opens a tenant-bound transaction and runs the statements on it.
 *
 * The save takes this as an ARGUMENT rather than opening the transaction itself, and
 * the reason is a guarantee rather than a style: both isolation layers must be fed
 * from the SAME provider object, so the binding belongs in the repository that holds
 * that provider. A module that reached for a provider of its own could bind one tenant
 * while the guard injected another.
 */
export type TenantBoundRunner = <T>(statements: (tx: TxClient) => Promise<T>) => Promise<T>;

/**
 * What the publication save needs from the repository that owns it. Passed in rather
 * than reached for, so this module has no opinion about how the repository was wired.
 */
export interface PublicationWriteCollaborators {
  outboxWriter: OutboxWriter | undefined;
  runInTenantBoundTransaction: TenantBoundRunner;
}

/**
 * Events that mean the aggregate carries an EDIT. A publication write must not be the
 * vehicle for one: the content it is publishing may already be live on a provider, and
 * the narrow save writes no content statement, so such an aggregate would silently
 * lose the edit instead of persisting it.
 */
export const PUBLICATION_TRIPWIRE_EVENTS = [
  "PostContentUpdated",
  "PostMediaAdded",
  "PostMediaRemoved",
] as const;

type PublicationTripwireEvent = (typeof PUBLICATION_TRIPWIRE_EVENTS)[number];

/** Domain outcome kinds are lowercase; the database enum is not. */
const OUTCOME_COLUMN: Record<string, ChannelPublicationOutcome> = {
  unresolved: "UNRESOLVED",
  published: "PUBLISHED",
  excluded: "EXCLUDED",
};

/**
 * @function liveFragmentsJson
 * @description The live fragments as a JSON array the column will accept. The optional
 *   address is omitted rather than written as null, so a fragment without one reads the
 *   same way it does in memory.
 * @param record - The record whose live set is being written
 * @returns The column value
 */
function liveFragmentsJson(record: ChannelPublication): Prisma.InputJsonValue {
  return record.liveFragments.map((fragment) => {
    const json = fragment.toJSON();
    return json.url === undefined
      ? { index: json.index, externalId: json.externalId }
      : { index: json.index, externalId: json.externalId, url: json.url };
  });
}

/**
 * @function pendingEditEvent
 * @description The first edit event the aggregate is carrying, when it is carrying one.
 * @param aggregate - The post about to be saved
 * @returns The event type that trips the guard, or undefined
 */
export function pendingEditEvent(aggregate: PostAggregate): PublicationTripwireEvent | undefined {
  for (const event of aggregate.domainEvents) {
    const match = PUBLICATION_TRIPWIRE_EVENTS.find((name) => name === event.eventType);
    if (match !== undefined) {
      return match;
    }
  }
  return undefined;
}

/**
 * @function publicationRowData
 * @description The column values of ONE record. Written from the entity's own reads,
 *   so a column can never hold something the entity would refuse to represent.
 * @param record - The record to write
 * @returns The mutable column values, without the identifying triple
 */
function publicationRowData(record: ChannelPublication): {
  outcome: ChannelPublicationOutcome;
  externalId: string | null;
  externalIdMissing: boolean;
  liveFragments: Prisma.InputJsonValue;
  pendingRetraction: boolean;
  retractionBlockedCause: ChannelRetractionBlock | null;
  actionWindowStartedAt: Date | null;
  actionWindowExpiredAt: Date | null;
  retractionAlertHash: string | null;
  retractionClearedCause: ChannelRetractionClearance | null;
  retractionClearedAt: Date | null;
  contentHash: string | null;
  publishedAt: Date | null;
  reasonCode: ChannelExclusionReason | null;
  reasonDetail: string | null;
  lastFailureCode: ChannelExclusionReason | null;
  lastFailureDetail: string | null;
  lastAttemptAt: Date | null;
  attempts: number;
  episode: number;
  episodeAttempts: number;
} {
  const head = record.head;
  return {
    outcome: OUTCOME_COLUMN[record.outcomeKind] ?? "UNRESOLVED",
    externalId: head !== undefined && isProvidedReference(head) ? head.id : null,
    externalIdMissing: record.externalIdMissing,
    liveFragments: liveFragmentsJson(record),
    pendingRetraction: record.pendingRetraction,
    retractionBlockedCause: record.retractionBlockedCause ?? null,
    actionWindowStartedAt: record.actionWindowStartedAt ?? null,
    actionWindowExpiredAt: record.actionWindowExpiredAt ?? null,
    retractionAlertHash: record.retractionAlertHash ?? null,
    retractionClearedCause: record.retractionClearedCause ?? null,
    retractionClearedAt: record.retractionClearedAt ?? null,
    contentHash: record.contentHash?.value ?? null,
    publishedAt: record.publishedAt ?? null,
    reasonCode: record.reason?.code ?? null,
    reasonDetail: record.reason?.detail ?? null,
    lastFailureCode: record.lastFailure?.code ?? null,
    lastFailureDetail: record.lastFailure?.detail ?? null,
    lastAttemptAt: record.lastFailure?.at ?? null,
    attempts: record.attempts,
    episode: record.episode,
    episodeAttempts: record.episodeAttempts,
  };
}

/**
 * @function upsertPublications
 * @description Writes every record of the aggregate, keyed by `(postId, channelId)`.
 *   The tenant is the one read back from the parent row, never recomputed, so a record
 *   cannot land in a tenant its post is not in.
 * @param tx - The transaction client the post write ran on
 * @param aggregate - The post whose records are being written
 * @param accountId - The tenant read back from the parent row
 */
export async function upsertPublications(
  tx: TxClient,
  aggregate: PostAggregate,
  accountId: string
): Promise<void> {
  const postId = aggregate.id.value;

  for (const record of aggregate.publications.all) {
    const data = publicationRowData(record);
    await tx.postChannelPublication.upsert({
      where: { postId_channelId: { postId, channelId: record.channelId.value } },
      create: {
        id: record.id,
        postId,
        accountId,
        channelId: record.channelId.value,
        ...data,
      },
      update: data,
    });
  }
}

/**
 * @function writePublicationSave
 * @description The narrow save itself: a compare-and-swap on the post row limited to
 *   the word and the publication moment, then every record, then the outbox — all on
 *   the one transaction client the caller passed.
 * @param tx - The transaction client
 * @param aggregate - The post being saved
 * @param outboxWriter - The outbox writer, when one is wired
 */
export async function writePublicationSave(
  tx: TxClient,
  aggregate: PostAggregate,
  outboxWriter: OutboxWriter | undefined
): Promise<void> {
  const postId = aggregate.id.value;
  const expectedVersion = aggregate.version;

  let accountId: string;
  try {
    const updated = await tx.post.update({
      where: { id: postId, version: expectedVersion },
      data: {
        status: aggregate.status.value,
        publishedAt: aggregate.publishedAt ?? null,
        version: { increment: 1 },
      },
      select: { accountId: true },
    });
    accountId = updated.accountId;
    aggregate.incrementVersion();
  } catch (error) {
    const isPrismaNotFound =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2025";
    if (isPrismaNotFound) {
      // DELIBERATE soft-delete-sweep exception: version-conflict recovery must read
      // the row even after a concurrent soft delete to report its version.
      const current = await tx.post.findUnique({
        where: { id: postId },
        select: { version: true },
      });
      throw new VersionConflictError("Post", postId, expectedVersion, current?.version ?? null);
    }
    throw error;
  }

  await upsertPublications(tx, aggregate, accountId);

  if (outboxWriter) {
    await outboxWriter.writeEvents(tx, aggregate.domainEvents);
  }
}

/**
 * @function savePublicationRecord
 * @description Persists a PUBLICATION outcome and nothing else: the post's word, its
 *   publication moment, every per-channel record and the outbox, in one transaction.
 *
 *   Two refusals come before any statement. The projection invariant, so a word that
 *   has drifted from its record is never written; and the edit tripwire, so an
 *   aggregate carrying a pending content or media event is rejected instead of having
 *   that edit silently dropped by a save that writes no content statement.
 *
 *   It reuses an open unit of work when there is one, and otherwise asks the caller's
 *   runner to open a tenant-bound transaction, so the tenant is bound as the
 *   transaction's first statement either way.
 * @param collaborators - The outbox writer and the tenant-bound transaction runner
 * @param aggregate - The post to persist
 * @returns Result.ok, or the error that refused the write
 */
export async function savePublicationRecord(
  collaborators: PublicationWriteCollaborators,
  aggregate: PostAggregate
): Promise<Result<void, Error>> {
  const invariant = aggregate.assertPublicationProjection();
  if (!invariant.ok) {
    return err(invariant.error);
  }

  const pendingEdit = pendingEditEvent(aggregate);
  if (pendingEdit !== undefined) {
    return err(
      new InvariantViolationError(
        `post ${aggregate.id.value} carries a pending ${pendingEdit} event: a publication save writes no content, so the edit would be lost`
      )
    );
  }

  try {
    const activeTx = PrismaUnitOfWork.getTransactionClient();
    if (activeTx) {
      await writePublicationSave(activeTx, aggregate, collaborators.outboxWriter);
    } else {
      await collaborators.runInTenantBoundTransaction(async (tx) => {
        await writePublicationSave(tx, aggregate, collaborators.outboxWriter);
      });
    }
    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
