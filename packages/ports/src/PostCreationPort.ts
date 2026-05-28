/**
 * @file PostCreationPort.ts
 * @description Application-layer port for creating posts from outside the
 *   `posts` bounded context. Adapter lives in `@core/posts` and is wired
 *   in the composition root.
 *
 *   Resolves §5.1 cross-context violations `bulk-scheduling -> posts` and
 *   `recurring -> posts`. The `bulk-scheduling` and `recurring` contexts
 *   used to import `CreatePostUseCase` directly from
 *   `@core/application/posts`; now they depend on this port instead and the
 *   composition root injects the posts adapter.
 *
 *   Workstream: §5.1 Normalization Roadmap — fullscope split.
 *
 * @layer domain
 */

export interface CreatePostFromExternalInput {
  readonly accountId: string;
  readonly projectId: string;
  readonly authorUserId: string;
  readonly content: string;
  readonly channelIds: ReadonlyArray<string>;
  readonly scheduledAt?: Date | undefined;
  readonly mediaIds?: ReadonlyArray<string> | undefined;
  readonly origin: "BULK_SCHEDULE" | "RECURRING";
}

export interface CreatePostFromExternalResult {
  readonly postId: string;
}

export interface PostCreationPort {
  createFromExternal(input: CreatePostFromExternalInput): Promise<CreatePostFromExternalResult>;
}
