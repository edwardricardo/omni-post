/**
 * @file retractionAlertMessage.ts
 * @description Builds the words the customer actually reads, once, so the dashboard,
 *   the email and the team webhook cannot drift into saying different things about the
 *   same stranded content. Pure by design: it takes the resolved facts and returns
 *   text, which is what lets the "does the alert name the fragments" requirement be
 *   tested without a single double.
 *
 *   An alert that says only "publication failed" is the exact failure this capability
 *   exists to delete, moved into the notification layer — so every field the customer
 *   needs to act is named here, not summarized.
 * @layer application
 */

import type { AlertFragmentView } from "@ports/core";

/** The facts the message is built from. */
export interface RetractionAlertMessageInput {
  channelName: string;
  postExcerpt: string;
  liveFragments: readonly AlertFragmentView[];
  cause: string;
  postId: string;
  channelId: string;
  alertKey: string;
  actionWindowEndsAt?: string;
}

/** The rendered message and the identities a surface may need to link back. */
export interface RetractionAlertMessage {
  title: string;
  body: string;
  metadata: Record<string, unknown>;
}

/**
 * Why the content is still live, in the customer's words. Recorded causes are codes;
 * this is the ONE place they become a sentence, so the dashboard, the email and the team
 * webhook cannot explain the same stranded post differently.
 */
const CAUSE_SENTENCES: Record<string, string> = {
  NO_CAPABILITY: "this platform offers no way to remove it from OmniPost",
  EXHAUSTED: "automatic removal was attempted and failed",
};

/**
 * @function describeRetractionCause
 * @description Turns a recorded cause code into the sentence every medium states.
 * @param cause - The cause the record carried
 * @returns The customer-facing sentence, or the neutral one for a cause nobody has named
 */
export const describeRetractionCause = (cause: string): string =>
  CAUSE_SENTENCES[cause] ?? "it could not be removed automatically";

const describeFragment = (fragment: AlertFragmentView): string => {
  const address = fragment.url === undefined ? "" : ` — ${fragment.url}`;
  return `  ${fragment.index}. ${fragment.externalId}${address}`;
};

/**
 * @function buildRetractionAlertMessage
 * @description Renders the alert's title, body and metadata from the recorded facts.
 * @param input - The channel, the post, the live fragments, the cause and the deadline
 * @returns The title, body and metadata every medium delivers
 */
export function buildRetractionAlertMessage(
  input: RetractionAlertMessageInput
): RetractionAlertMessage {
  const title = `Content is still live on ${input.channelName}: manual removal required`;

  const lines = [
    `Part of your post is still published on ${input.channelName}, and ${describeRetractionCause(input.cause)}.`,
    "",
    `Post: ${input.postExcerpt}`,
    "",
    "Still live on the platform:",
    ...input.liveFragments.map(describeFragment),
    "",
    "What to do: remove these manually on the platform, then confirm the removal here.",
    "This channel can be retried only once nothing of the post is live on it.",
  ];

  if (input.actionWindowEndsAt !== undefined) {
    lines.push("", `Act by ${input.actionWindowEndsAt}.`);
  }

  return {
    title,
    body: lines.join("\n"),
    metadata: {
      postId: input.postId,
      channelId: input.channelId,
      alertKey: input.alertKey,
      liveFragments: input.liveFragments.map((fragment) => ({ ...fragment })),
      ...(input.actionWindowEndsAt !== undefined && {
        actionWindowEndsAt: input.actionWindowEndsAt,
      }),
    },
  };
}
