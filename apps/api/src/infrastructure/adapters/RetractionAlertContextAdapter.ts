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
 *   Degrading is UNIFORM over both ways a read can fail. A repository that answers
 *   `err` and one that THROWS — a lost connection, an exhausted pool — are the same
 *   fact to a customer whose content is live on a platform, so a throw is caught here
 *   rather than escaping the one component whose whole purpose is to keep the alert
 *   going out.
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
 * @function attemptRead
 * @description Runs one repository read and answers with its value or with the REASON
 *   there is none, so a thrown read degrades on the same path as a refused one instead
 *   of escaping an adapter that must never fail.
 * @param read - The repository call to attempt
 * @returns The value, or the failure reason to report
 */
async function attemptRead<T, E>(
  read: () => Promise<Result<T, E>>
): Promise<{ value: T } | { failure: ReadFailure }> {
  try {
    const result = await read();
    return result.ok ? { value: result.value } : { failure: READ_FAILURES.UNREADABLE };
  } catch {
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

    const post = await attemptRead(() => this.posts.getById(postId.value, accountId.value));
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

    const channel = await attemptRead(() => this.channels.findById(id.value));
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

    const account = await attemptRead(() => this.accounts.findById(id.value));
    if (!("value" in account)) {
      this.degrade("account", account.failure, { accountId });
      return "your account";
    }

    return account.value.name;
  }
}
