/**
 * @file PostCreationPort.ts
 * @description Port for creating + scheduling posts from outside the `posts`
 *   bounded context. Adapter (`apps/api/src/infrastructure/container/adapters/
 *   PostCreationAdapter.ts`) wraps `CreatePostUseCase` + `SchedulePostUseCase`
 *   from `@core/posts` and is wired in the composition root.
 *
 *   Method signatures match the existing service call sites in
 *   `bulk-scheduling/ProcessBulkScheduleRowUseCase` and
 *   `recurring/CreatePostFromRecurrenceUseCase` to minimize call-site
 *   refactor — only the constructor parameter type changes.
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
  createPost(input: CreatePostPortInput): Promise<Result<CreatePostPortOutput, UseCaseError>>;
  schedulePost(input: SchedulePostPortInput): Promise<Result<SchedulePostPortOutput, UseCaseError>>;
}
