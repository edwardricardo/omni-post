/**
 * @file retractionAlertFixtures.ts
 * @description One alert view and one target, shared by the three media adapter
 *   suites. They sit in a fixture module rather than being repeated per suite because
 *   the point of the three adapters is that they receive the SAME view — a fixture
 *   that drifted between suites would hide exactly the drift worth catching.
 * @layer infrastructure
 */

import type { AlertTarget, RetractionAlertView } from "@ports/core";

export const ALERT: RetractionAlertView = {
  alertKey: "alert-key-1",
  postId: "b1000000-0000-4000-8000-000000000001",
  projectId: "p1000000-0000-4000-8000-000000000001",
  accountId: "a1000000-0000-4000-8000-000000000001",
  accountName: "Acme Corp",
  channelId: "c1000000-0000-4000-8000-000000000001",
  channelName: "Acme on X",
  provider: "X",
  postExcerpt: "Launch week",
  liveFragments: [{ index: 1, externalId: "18110001", url: "https://x.test/acme/1" }],
  cause: "NO_CAPABILITY",
  actionWindowEndsAt: "2026-09-22T09:00:00.000Z",
  title: "Content is still live on Acme on X: manual removal required",
  body: "Part of your post is still published.",
  metadata: { postId: "b1000000-0000-4000-8000-000000000001", alertKey: "alert-key-1" },
};

export const TARGET: AlertTarget = {
  id: "m1000000-0000-4000-8000-000000000001",
  email: "member@example.test",
};
