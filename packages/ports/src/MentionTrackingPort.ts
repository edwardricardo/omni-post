/**
 * @file MentionTrackingPort.ts
 * @description Application-layer port for tracking mentions of accounts/users
 *   from outside the `mentions` bounded context. Adapter lives in
 *   `@core/mentions` and is wired in the composition root.
 *
 *   Resolves §5.1 cross-context violations `inbox -> mentions`
 *   (AddConversationNoteUseCase) and `tasks -> mentions` (CreateTaskUseCase).
 *   These contexts used to import mention services directly from
 *   `@core/application/mentions`; now they depend on this port instead and
 *   the composition root injects the mentions adapter.
 *
 *   Workstream: §5.1 Normalization Roadmap — fullscope split.
 *
 * @layer domain
 */

export interface TrackMentionInput {
  readonly accountId: string;
  readonly mentionedUserId: string;
  readonly sourceType: "INBOX_NOTE" | "TASK_COMMENT";
  readonly sourceId: string;
  readonly mentioningUserId: string;
  readonly mentioningContext: string;
}

export interface TrackMentionResult {
  readonly mentionId: string;
}

export interface MentionTrackingPort {
  track(input: TrackMentionInput): Promise<TrackMentionResult>;
}
