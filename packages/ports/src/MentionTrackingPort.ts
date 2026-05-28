/**
 * @file MentionTrackingPort.ts
 * @description Port for tracking @mentions from outside the `mentions`
 *   bounded context. Adapter wraps `NotifyMentionedUsersService` from
 *   `@core/mentions` and is wired in the composition root.
 *
 *   Consumers (inbox conversation notes, tasks) call `mentionNotifier.notify(...)`
 *   to dispatch mention notifications. The port decouples them from the
 *   concrete notifier implementation.
 *
 * @layer domain
 */

import type { MentionContextType } from "@core/domain/value-objects/MentionContext.js";

export interface NotifyMentionedUsersInput {
  readonly text: string;
  readonly accountId: string;
  readonly mentionedById: string;
  readonly mentionedByName: string;
  readonly context: MentionContextType;
  readonly contextId: string;
}

export interface MentionTrackingPort {
  notify(input: NotifyMentionedUsersInput): Promise<ReadonlyArray<string>>;
}
