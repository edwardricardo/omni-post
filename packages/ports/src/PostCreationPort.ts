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

export interface CreatePostPortInput {
  readonly projectId: string;
  readonly body: string;
  readonly title?: string;
  readonly tags?: ReadonlyArray<string>;
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
