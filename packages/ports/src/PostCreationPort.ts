/**
 * @file PostCreationPort.ts
 * @description Port for creating + scheduling posts from outside the `posts`
 *   bounded context. Adapter (`apps/api/src/infrastructure/container/adapters/
 *   PostCreationAdapter.ts`) wraps `CreatePostUseCase` + `SchedulePostUseCase`
 *   from `@core/posts` and is wired in the composition root.
 *
 * @layer domain
 */

import type { Result } from "@shared/types";
import type { UseCaseError } from "@core/application/UseCase.js";
import type { MediaType } from "@core/domain/value-objects/MediaAttachment.js";

/**
 * A single media item to attach to a post at creation time.
 * `type` MUST be derived from the URL extension before calling createPost —
 * the domain aggregate validates it and rejects unknown types.
 */
export interface CreatePostMedia {
  readonly url: string;
  readonly type: MediaType;
  readonly width?: number;
  readonly height?: number;
  readonly alt?: string;
}

export interface CreatePostPortInput {
  readonly projectId: string;
  readonly body: string;
  readonly title?: string;
  readonly tags?: ReadonlyArray<string>;
  /**
   * Optional media items to attach via `PostAggregate.addMedia()` immediately
   * after creation (while the post is still DRAFT and editable). An empty array
   * or an omitted field both result in a post with zero media attachments.
   */
  readonly media?: ReadonlyArray<CreatePostMedia>;
}

export interface CreatePostPortOutput {
  readonly id: string;
}

export interface SchedulePostPortInput {
  readonly postId: string;
  readonly channelIds: ReadonlyArray<string>;
  readonly scheduledFor: string;
  readonly timezone?: string;
}

export interface SchedulePostPortOutput {
  readonly id: string;
  readonly scheduledFor: string;
}

export interface PostCreationPort {
  /**
   * Create a new draft post inside a project. Delegates to the posts bounded
   * context use case; returns the persisted post id.
   */
  createPost(input: CreatePostPortInput): Promise<Result<CreatePostPortOutput, UseCaseError>>;
  /**
   * Schedule an existing post for publication to one or more channels at
   * `scheduledFor`. The adapter validates the timezone and enforces the
   * provider's `schedulingAdvance` window.
   */
  schedulePost(input: SchedulePostPortInput): Promise<Result<SchedulePostPortOutput, UseCaseError>>;
}
