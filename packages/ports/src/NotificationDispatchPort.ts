/**
 * @file NotificationDispatchPort.ts
 * @description Port for dispatching user notifications from outside the
 *   `notifications` bounded context. Adapter wraps `CreateNotificationUseCase`
 *   from `@core/notifications` and is wired in the composition root. Takes
 *   primitive-friendly input so consumers stay decoupled from the notifications
 *   domain types.
 *
 * @layer domain
 */

import type { Result } from "@shared/types";
import type { UseCaseError } from "@core/application/UseCase.js";

export interface DispatchNotificationInput {
  recipientId: string;
  type: string;
  title: string;
  body: string;
  resourceType?: string;
  resourceId?: string;
  actorId?: string;
  actorName?: string;
  metadata?: Record<string, unknown>;
}

export interface DispatchNotificationOutput {
  id: string;
}

export interface NotificationDispatchPort {
  dispatch(
    input: DispatchNotificationInput
  ): Promise<Result<DispatchNotificationOutput, UseCaseError>>;
}
