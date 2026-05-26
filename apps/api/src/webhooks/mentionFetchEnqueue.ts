/**
 * @file mentionFetchEnqueue.ts
 * @description Contract for enqueuing a brand-mention fetch job from the webhook
 *              layer. A mention webhook is a notification, not data — the handler
 *              enqueues a fetch-before-process job that the mention-ingest worker
 *              consumes (resolves credentials, fetches the full object, persists).
 *              Keeping this a small callback avoids coupling the webhook
 *              processors to BullMQ or a QueuePort.
 * @layer infrastructure
 */

export interface MentionFetchJob {
  kind: "fetch";
  channelId: string;
  accountId: string;
  projectId: string;
  provider: string;
  providerMentionId: string;
}

export type MentionFetchEnqueue = (job: MentionFetchJob) => Promise<void>;
