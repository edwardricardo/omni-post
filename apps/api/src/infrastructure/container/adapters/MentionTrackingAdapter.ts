/**
 * @file MentionTrackingAdapter.ts
 * @description Composition-root adapter implementing `MentionTrackingPort`
 *   by delegating to the `mentions` bounded context's
 *   `NotifyMentionedUsersService`. Pure passthrough — the service's `notify`
 *   method shape already matches the port input.
 * @layer infrastructure
 */

import type { MentionTrackingPort, NotifyMentionedUsersInput } from "@ports/core";
import type { NotifyMentionedUsersService } from "@core/application/mentions/NotifyMentionedUsersService.js";

export class MentionTrackingAdapter implements MentionTrackingPort {
  constructor(private readonly service: NotifyMentionedUsersService) {}

  notify(input: NotifyMentionedUsersInput): Promise<ReadonlyArray<string>> {
    return this.service.notify(input);
  }
}
