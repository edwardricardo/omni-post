/**
 * @file NotificationDispatchPort.ts
 * @description Port for dispatching user notifications from outside the
 *   `notifications` bounded context. Adapter wraps `CreateNotificationUseCase`
 *   from `@core/notifications` and is wired in the composition root.
 *
 *   Resolves §5.1 cross-context violations `mentions → notifications` and
 *   `inbox/handlers → notifications`. The consumer's call shape was
 *   `createNotification.execute({...})`; port method `dispatch(...)` takes
 *   the same primitive-friendly input.
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
