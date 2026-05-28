/**
 * @file NotificationDispatchPort.ts
 * @description Application-layer port for dispatching user notifications
 *   (in-app + push + email fanout) from outside the `notifications`
 *   bounded context. Adapter lives in `@core/notifications` and is wired
 *   in the composition root.
 *
 *   Resolves §5.1 cross-context violation `mentions -> notifications`
 *   (NotifyMentionedUsersService). The `mentions` context used to import
 *   notification services directly from `@core/application/notifications`;
 *   now it depends on this port instead and the composition root injects
 *   the notifications adapter.
 *
 *   Workstream: §5.1 Normalization Roadmap — fullscope split.
 *
 * @layer domain
 */

export type NotificationChannel = "IN_APP" | "PUSH" | "EMAIL";

export interface DispatchNotificationInput {
  readonly accountId: string;
  readonly recipientUserId: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly channels: ReadonlyArray<NotificationChannel>;
  readonly payload?: Readonly<Record<string, unknown>> | undefined;
}

export interface DispatchNotificationResult {
  readonly notificationId: string;
  readonly dispatched: ReadonlyArray<NotificationChannel>;
}

export interface NotificationDispatchPort {
  dispatch(input: DispatchNotificationInput): Promise<DispatchNotificationResult>;
}
