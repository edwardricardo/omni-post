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
 * @layer infrastructure
 */

import type { PostQueryRepository } from "@core/domain/repositories/PostRepository.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { AccountRepository } from "@core/domain/repositories/AccountRepository.js";
import { AccountId, ChannelId, PostId } from "@core/domain/value-objects/EntityId.js";

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

  private async readExcerpt(query: RetractionAlertContextQuery): Promise<string> {
    const postId = PostId.fromString(query.postId);
    const accountId = AccountId.fromString(query.accountId);
    if (!postId.ok || !accountId.ok) return `Post ${query.postId}`;

    const post = await this.posts.getById(postId.value, accountId.value);
    if (!post.ok) return `Post ${query.postId}`;

    return excerptOf(post.value.title, post.value.body);
  }

  private async readChannel(channelId: string): Promise<{ channelName: string; provider: string }> {
    const id = ChannelId.fromString(channelId);
    if (!id.ok) return { channelName: `Channel ${channelId}`, provider: "unknown" };

    const channel = await this.channels.findById(id.value);
    if (!channel.ok) return { channelName: `Channel ${channelId}`, provider: "unknown" };

    return { channelName: channel.value.handle, provider: String(channel.value.provider) };
  }

  private async readAccountName(accountId: string): Promise<string> {
    const id = AccountId.fromString(accountId);
    if (!id.ok) return "your account";

    const account = await this.accounts.findById(id.value);
    return account.ok ? account.value.name : "your account";
  }
}
