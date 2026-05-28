/**
 * @file NotificationDispatchAdapter.ts
 * @description Composition-root adapter implementing `NotificationDispatchPort`
 *   by delegating to the `notifications` bounded context's
 *   `CreateNotificationUseCase`. Type-narrows the `string` port `type` to
 *   the domain `NotificationTypeValue` at the boundary.
 * @layer infrastructure
 */

import type {
  NotificationDispatchPort,
  DispatchNotificationInput,
  DispatchNotificationOutput,
} from "@ports/core";
import type { Result } from "@shared/types";
import type { UseCaseError } from "@core/application/UseCase.js";
import type { CreateNotificationUseCase } from "@core/notifications/CreateNotificationUseCase.js";
import type { NotificationTypeValue } from "@core/domain/value-objects/NotificationType.js";

export class NotificationDispatchAdapter implements NotificationDispatchPort {
  constructor(private readonly createNotification: CreateNotificationUseCase) {}

  async dispatch(
    input: DispatchNotificationInput
  ): Promise<Result<DispatchNotificationOutput, UseCaseError>> {
    const result = await this.createNotification.execute({
      recipientId: input.recipientId,
      type: input.type as NotificationTypeValue,
      title: input.title,
      body: input.body,
      ...(input.resourceType !== undefined && { resourceType: input.resourceType }),
      ...(input.resourceId !== undefined && { resourceId: input.resourceId }),
      ...(input.actorId !== undefined && { actorId: input.actorId }),
      ...(input.actorName !== undefined && { actorName: input.actorName }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
    });
    if (!result.ok) return result;
    return { ok: true, value: { id: result.value.id } };
  }
}
