/**
 * @file RetractionAlertContextAdapter.ts
 * @description Turns the identifiers a retraction-alert event carries into the words
 *   the customer reads: which post, which channel, whose account.
 *
 *   It DEGRADES rather than refuses. Every lookup here is decoration on an obligation
 *   that already exists — content is live on a platform and only the customer can take
 *   it down — so a post title that cannot be read must not suppress the alert about it.
 *   A degraded alert names the ids; a suppressed alert names nothing, and the silence
 *   is indistinguishable from the failure never having happened.
 *
 *   The provider is DERIVED from the channel and never taken as an independent field:
 *   a post targets channels, and the provider is a property of the channel it resolved
 *   to.
 *
 *   Degrading is UNIFORM over both ways a read can fail — but only for the STORE's own
 *   failures. A repository that answers `err` and one that throws because the database
 *   is unreachable are the same fact to a customer whose content is live on a platform,
 *   so that throw is caught here rather than escaping the one component whose whole
 *   purpose is to keep the alert going out.
 *
 *   A PROGRAMMING error is not that fact and must not borrow its answer. Catching
 *   everything made a `TypeError` from a bad refactor read as `unreachable`: every
 *   customer would be asked to remove "Post <uuid>" — deterministically, on every
 *   alert — while the defect sat in a WARN beside a counter that says an outage is in
 *   progress. So the catch is an ALLOWLIST of store-failure shapes, the form this repo
 *   already uses for an open-ended dangerous set, and anything else propagates: the
 *   handler lets a processing failure escape so the outbox redelivers, and a
 *   deterministic bug then reaches the dead-letter queue where a human sees it instead
 *   of being absorbed once per alert forever.
 *
 *   The trade is named rather than implied: a propagating bug means THIS attempt
 *   delivers no alert. That is the right way round — the obligation is redelivered and
 *   escalated, not silently downgraded — and the unreachable-store case the degrade
 *   rationale was actually written for still degrades exactly as before.
 * @layer infrastructure
 */

import type { Result } from "@shared/types";
import type { PostQueryRepository } from "@core/domain/repositories/PostRepository.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { AccountRepository } from "@core/domain/repositories/AccountRepository.js";
import { AccountId, ChannelId, PostId } from "@core/domain/value-objects/EntityId.js";
import { createLogger } from "../../lib/logger.js";
import { recordAlertContextDegraded } from "../../metrics/retractionAlertMetrics.js";

const logger = createLogger("retraction-alert-context");

/** What the alert needs beyond the ids the event carried. */
export interface RetractionAlertContext {
  postExcerpt: string;
  channelName: string;
  provider: string;
  accountName: string;
}

/** The ids the event carried. */
export interface RetractionAlertContextQuery {
  postId: string;
  channelId: string;
  accountId: string;
}

/** How much of a post's body stands in for it when there is no title. */
const EXCERPT_LIMIT = 160;

/** Why a lookup produced no value: the store said no, or the store could not answer. */
const READ_FAILURES = {
  UNREADABLE: "unreadable",
  UNREACHABLE: "unreachable",
} as const;

type ReadFailure = (typeof READ_FAILURES)[keyof typeof READ_FAILURES];

/**
 * Driver-level failures to reach the database at all. These arrive from the socket
 * rather than from the ORM, so they carry no Prisma code and would otherwise look like
 * any other error.
 */
const CONNECTION_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

/**
 * The ORM's own failure classes — EXCEPT the validation one. A malformed query is a
 * query this application built wrong: it is our defect, it is deterministic, and
 * degrading it would hide it behind a sentence about the store being unavailable.
 */
const PRISMA_ERROR_PREFIX = "PrismaClient";
const PRISMA_PROGRAMMING_ERROR = "PrismaClientValidationError";

/**
 * @function isStoreFailure
 * @description Decides whether a thrown value is the STORE failing, which this adapter
 *   degrades, or anything else, which it lets through.
 *
 *   An ALLOWLIST on purpose, the shape this repo uses wherever the dangerous set is
 *   open-ended: a bug can be thrown as a `TypeError`, a bare `Error`, an assertion or a
 *   value that is not an Error at all, so no list of bug shapes could be complete. The
 *   set of ways the STORE says it could not answer is small and nameable, so that is
 *   what gets named.
 *
 *   Duck-typed rather than `instanceof`, which keeps this adapter over its three PORTS
 *   instead of binding it to the ORM behind them. The residual is the same one
 *   `classifyPersistenceFailure` writes down: these are Prisma's names and codes BY
 *   VALUE, so replacing the ORM silently stops this matching. That direction is the
 *   safe one — an unrecognised store failure propagates and is redelivered rather than
 *   being absorbed in silence — which is precisely why the allowlist points this way.
 * @param error - The value a repository read threw
 * @returns Whether the alert may degrade over it
 */
function isStoreFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const { name, code } = error as { name?: unknown; code?: unknown };

  if (typeof name === "string" && name.startsWith(PRISMA_ERROR_PREFIX)) {
    return name !== PRISMA_PROGRAMMING_ERROR;
  }

  if (typeof code !== "string") return false;

  // `P` + a digit is a Prisma error code (`P1001` unreachable, `P2024` pool timeout),
  // the same duck-typing the global HTTP error boundary uses. The digit is required so
  // an unrelated code that merely starts with a P cannot pass for one.
  return /^P\d/.test(code) || CONNECTION_ERROR_CODES.has(code);
}

/**
 * @function attemptRead
 * @description Runs one repository read and answers with its value or with the REASON
 *   there is none, so a read the STORE could not answer degrades on the same path as a
 *   refused one instead of escaping an adapter that must never fail for that reason.
 *   Anything else propagates, carrying its stack to a place a human will look.
 * @param read - The repository call to attempt
 * @param field - Which lookup this is, for the log line on the propagating path
 * @returns The value, or the failure reason to report
 */
async function attemptRead<T, E>(
  read: () => Promise<Result<T, E>>,
  field: string
): Promise<{ value: T } | { failure: ReadFailure }> {
  try {
    const result = await read();
    return result.ok ? { value: result.value } : { failure: READ_FAILURES.UNREADABLE };
  } catch (error: unknown) {
    if (!isStoreFailure(error)) {
      logger.error(
        {
          field,
          errorName: error instanceof Error ? error.name : typeof error,
          reason: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack !== undefined && { stack: error.stack }),
        },
        "Retraction alert context read failed for a reason that is NOT the store being " +
          "unavailable — propagating it rather than degrading, so the outbox redelivers " +
          "and the defect surfaces instead of turning every alert into an identifier"
      );
      throw error;
    }
    return { failure: READ_FAILURES.UNREACHABLE };
  }
}

const excerptOf = (title: string | undefined, body: string): string => {
  const source = title !== undefined && title.trim().length > 0 ? title : body;
  const trimmed = source.trim();
  if (trimmed.length === 0) return "(no content)";
  return trimmed.length <= EXCERPT_LIMIT ? trimmed : `${trimmed.slice(0, EXCERPT_LIMIT - 1)}…`;
};

export class RetractionAlertContextAdapter {
  constructor(
    private readonly posts: PostQueryRepository,
    private readonly channels: ChannelRepository,
    private readonly accounts: AccountRepository
  ) {}

  /**
   * @method read
   * @description Resolves the post excerpt, the channel's name, its provider and the
   *   account's name. Every field has a fallback, so this never fails.
   * @param query - The ids the alert event carried
   * @returns The resolved context, with placeholders for whatever could not be read
   */
  async read(query: RetractionAlertContextQuery): Promise<RetractionAlertContext> {
    return {
      postExcerpt: await this.readExcerpt(query),
      ...(await this.readChannel(query.channelId)),
      accountName: await this.readAccountName(query.accountId),
    };
  }

  /**
   * @method degrade
   * @description Records a fallback so it is OBSERVED rather than merely survived. One
   *   degraded alert is acceptable; a RUN of them means customers are being asked to
   *   remove "Post <uuid>", and without this nothing in the system would say so.
   * @param field - Which lookup degraded
   * @param reason - `malformed-id`, `unreadable` (the store said no) or `unreachable`
   *   (the store could not answer at all)
   * @param ids - The identifiers involved, for the log line
   */
  private degrade(field: string, reason: string, ids: Record<string, string>): void {
    recordAlertContextDegraded(field);
    logger.warn(
      { field, reason, ...ids },
      "Retraction alert context degraded to an identifier — the alert still goes out, but the " +
        "customer is shown an id instead of content"
    );
  }

  private async readExcerpt(query: RetractionAlertContextQuery): Promise<string> {
    const postId = PostId.fromString(query.postId);
    const accountId = AccountId.fromString(query.accountId);
    if (!postId.ok || !accountId.ok) {
      this.degrade("post", "malformed-id", { postId: query.postId });
      return `Post ${query.postId}`;
    }

    const post = await attemptRead(() => this.posts.getById(postId.value, accountId.value), "post");
    if (!("value" in post)) {
      this.degrade("post", post.failure, { postId: query.postId });
      return `Post ${query.postId}`;
    }

    return excerptOf(post.value.title, post.value.body);
  }

  private async readChannel(channelId: string): Promise<{ channelName: string; provider: string }> {
    const id = ChannelId.fromString(channelId);
    if (!id.ok) {
      this.degrade("channel", "malformed-id", { channelId });
      return { channelName: `Channel ${channelId}`, provider: "unknown" };
    }

    const channel = await attemptRead(() => this.channels.findById(id.value), "channel");
    if (!("value" in channel)) {
      this.degrade("channel", channel.failure, { channelId });
      return { channelName: `Channel ${channelId}`, provider: "unknown" };
    }

    return { channelName: channel.value.handle, provider: String(channel.value.provider) };
  }

  private async readAccountName(accountId: string): Promise<string> {
    const id = AccountId.fromString(accountId);
    if (!id.ok) {
      this.degrade("account", "malformed-id", { accountId });
      return "your account";
    }

    const account = await attemptRead(() => this.accounts.findById(id.value), "account");
    if (!("value" in account)) {
      this.degrade("account", account.failure, { accountId });
      return "your account";
    }

    return account.value.name;
  }
}
