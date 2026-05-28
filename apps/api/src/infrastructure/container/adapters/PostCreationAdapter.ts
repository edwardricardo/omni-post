/**
 * @file PostCreationAdapter.ts
 * @description Composition-root adapter implementing `PostCreationPort` by
 *   delegating to the `posts` bounded context's `CreatePostUseCase` +
 *   `SchedulePostUseCase`. Lives here (apps/api) rather than inside
 *   `@core/posts` so that the port consumers (bulk-scheduling, recurring)
 *   stay decoupled from the concrete use case classes.
 * @layer infrastructure
 */

import type {
  PostCreationPort,
  CreatePostPortInput,
  CreatePostPortOutput,
  SchedulePostPortInput,
  SchedulePostPortOutput,
} from "@ports/core";
import type { Result } from "@shared/types";
import type { UseCaseError } from "@core/application/UseCase.js";
import type { CreatePostUseCase } from "@core/posts/CreatePostUseCase.js";
import type { SchedulePostUseCase } from "@core/posts/SchedulePostUseCase.js";

export class PostCreationAdapter implements PostCreationPort {
  constructor(
    private readonly createPostUseCase: CreatePostUseCase,
    private readonly schedulePostUseCase: SchedulePostUseCase
  ) {}

  async createPost(
    input: CreatePostPortInput
  ): Promise<Result<CreatePostPortOutput, UseCaseError>> {
    const result = await this.createPostUseCase.execute({
      projectId: input.projectId,
      body: input.body,
      ...(input.title !== undefined && { title: input.title }),
      ...(input.tags !== undefined && { tags: input.tags }),
    });
    if (!result.ok) return result;
    return { ok: true, value: { postId: result.value.postId } };
  }

  async schedulePost(
    input: SchedulePostPortInput
  ): Promise<Result<SchedulePostPortOutput, UseCaseError>> {
    const result = await this.schedulePostUseCase.execute({
      postId: input.postId,
      channelIds: [...input.channelIds],
      scheduledFor: input.scheduledFor,
      ...(input.timezone !== undefined && { timezone: input.timezone }),
    });
    if (!result.ok) return result;
    return {
      ok: true,
      value: { postId: result.value.postId, scheduledFor: result.value.scheduledFor },
    };
  }
}
