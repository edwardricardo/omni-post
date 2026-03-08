import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@infra/prisma";
import { Provider, WebhookEventType } from "@infra/prisma";
import {
  state,
  setupWebhookManagerTestData,
  teardownWebhookManagerTestData,
} from "./webhookManager.test-helpers.js";

describe("WebhookManager - Subscriptions", { concurrency: 1 }, () => {
  before(async () => {
    await setupWebhookManagerTestData();
  });

  after(async () => {
    await teardownWebhookManagerTestData();
  });

  describe("createSubscription() - Webhook Subscription Creation", { concurrency: 1 }, () => {
    describe("Basic Subscription Creation", { concurrency: 1 }, () => {
      it("should create subscription with minimal required fields", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "X",
          eventTypes: ["POST_PUBLISHED"],
        });

        assert.ok(subscription.id, "Should have subscription ID");
        assert.strictEqual(subscription.accountId, state.testAccountId);
        assert.strictEqual(subscription.provider, "X");
        assert.deepStrictEqual(subscription.eventTypes, ["POST_PUBLISHED"]);
        assert.strictEqual(subscription.isActive, true);
        assert.strictEqual("secretKey" in subscription, false, "Secret key should be omitted");
        assert.ok(subscription.webhookUrl, "Should have webhook URL");
        assert.ok(subscription.setupInstructions, "Should have setup instructions");
      });

      it("should create subscription with projectId", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "INSTAGRAM",
          projectId: state.testProjectId,
          eventTypes: ["STORY_PUBLISHED", "REEL_PUBLISHED"],
        });

        assert.strictEqual(subscription.projectId, state.testProjectId);
        assert.strictEqual(subscription.provider, "INSTAGRAM");
        assert.deepStrictEqual(subscription.eventTypes, ["STORY_PUBLISHED", "REEL_PUBLISHED"]);
      });

      it("should create subscription with custom webhook URL", async () => {
        const customUrl = "https://custom.example.com/webhooks/test";
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "FACEBOOK",
          eventTypes: ["POST_PUBLISHED"],
          webhookUrl: customUrl,
        });

        assert.strictEqual(subscription.webhookUrl, customUrl);
      });

      it("should create subscription with custom verify token", async () => {
        const customToken = "custom-verify-token-123";
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "FACEBOOK",
          eventTypes: ["POST_PUBLISHED"],
          verifyToken: customToken,
        });

        const dbSubscription = await prisma.webhookSubscription.findUnique({
          where: { id: subscription.id },
        });

        assert.strictEqual(dbSubscription?.verifyToken, customToken);
      });

      it("should generate default webhook URL if not provided", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "YOUTUBE",
          eventTypes: ["VIDEO_PROCESSED"],
        });

        assert.ok(subscription.webhookUrl.includes("/webhooks/youtube"));
      });

      it("should generate secret key automatically", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "TIKTOK",
          eventTypes: ["POST_PUBLISHED"],
        });

        const dbSubscription = await prisma.webhookSubscription.findUnique({
          where: { id: subscription.id },
        });

        assert.ok(dbSubscription?.secretKey, "Secret key should exist in database");
        assert.strictEqual(
          dbSubscription?.secretKey.length,
          64,
          "Secret key should be 32 bytes hex"
        );
      });

      it("should generate verify token automatically for Facebook", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "FACEBOOK",
          eventTypes: ["POST_PUBLISHED"],
        });

        const dbSubscription = await prisma.webhookSubscription.findUnique({
          where: { id: subscription.id },
        });

        assert.ok(dbSubscription?.verifyToken, "Verify token should be generated");
        assert.strictEqual(
          dbSubscription?.verifyToken.length,
          32,
          "Verify token should be 16 bytes hex"
        );
      });
    });

    describe("Setup Instructions Generation", { concurrency: 1 }, () => {
      it("should generate Facebook setup instructions", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "FACEBOOK",
          eventTypes: ["POST_PUBLISHED"],
        });

        assert.ok(subscription.setupInstructions);
        assert.strictEqual(subscription.setupInstructions.provider, "FACEBOOK");
        assert.ok(subscription.setupInstructions.webhookUrl);
        assert.ok(subscription.setupInstructions.verifyToken);
        assert.ok(Array.isArray(subscription.setupInstructions.steps));
        assert.ok(subscription.setupInstructions.steps.length > 0);
      });

      it("should generate X/Twitter setup instructions", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "X",
          eventTypes: ["POST_PUBLISHED"],
        });

        assert.strictEqual(subscription.setupInstructions.provider, "X");
        assert.ok(
          subscription.setupInstructions.steps.some((step: string) =>
            step.includes("X Developer Portal")
          )
        );
      });

      it("should generate YouTube setup instructions", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "YOUTUBE",
          eventTypes: ["VIDEO_PROCESSED"],
        });

        assert.strictEqual(subscription.setupInstructions.provider, "YOUTUBE");
        assert.ok(
          subscription.setupInstructions.steps.some((step: string) =>
            step.includes("Google Cloud Console")
          )
        );
      });

      it("should generate TikTok setup instructions", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "TIKTOK",
          eventTypes: ["POST_PUBLISHED"],
        });

        assert.strictEqual(subscription.setupInstructions.provider, "TIKTOK");
        assert.ok(
          subscription.setupInstructions.steps.some((step: string) =>
            step.includes("TikTok Developer Portal")
          )
        );
      });

      it("should generate Instagram setup instructions", async () => {
        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "INSTAGRAM",
          eventTypes: ["STORY_PUBLISHED"],
        });

        assert.strictEqual(subscription.setupInstructions.provider, "INSTAGRAM");
        assert.ok(
          subscription.setupInstructions.steps.some((step: string) =>
            step.includes("Facebook App Dashboard")
          )
        );
      });
    });

    describe("Multiple Event Types Support", { concurrency: 1 }, () => {
      it("should create subscription with multiple event types", async () => {
        const eventTypes: WebhookEventType[] = [
          "POST_PUBLISHED",
          "POST_UPDATED",
          "POST_DELETED",
          "COMMENT_RECEIVED",
          "LIKE_RECEIVED",
        ];

        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "X",
          eventTypes,
        });

        assert.deepStrictEqual(subscription.eventTypes, eventTypes);
      });

      it("should create subscription with all available event types", async () => {
        const allEventTypes: WebhookEventType[] = [
          "POST_PUBLISHED",
          "POST_UPDATED",
          "POST_DELETED",
          "POST_ENGAGEMENT_UPDATE",
          "STORY_PUBLISHED",
          "STORY_EXPIRED",
          "REEL_PUBLISHED",
          "LIKE_RECEIVED",
          "COMMENT_RECEIVED",
          "SHARE_RECEIVED",
          "MENTION_RECEIVED",
          "ACCOUNT_CONNECTED",
          "ACCOUNT_DISCONNECTED",
          "PERMISSION_CHANGED",
          "RATE_LIMIT_REACHED",
          "QUOTA_EXCEEDED",
          "API_ERROR",
          "VIDEO_PROCESSED",
          "VIDEO_MONETIZED",
          "LIVE_STREAM_STARTED",
          "LIVE_STREAM_ENDED",
          "MILESTONE_REACHED",
          "VIRAL_CONTENT_DETECTED",
        ];

        const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
          provider: "FACEBOOK",
          eventTypes: allEventTypes,
        });

        assert.strictEqual(subscription.eventTypes.length, allEventTypes.length);
      });
    });
  });

  describe("getSubscriptions() - List Webhook Subscriptions", { concurrency: 1 }, () => {
    let subscription1Id: string;
    let subscription2Id: string;
    let subscription3Id: string;

    before(async () => {
      await prisma.webhookSubscription.deleteMany({
        where: {
          accountId: { in: [state.testAccountId, state.testAccount2Id] },
        },
      });

      const sub1 = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });
      subscription1Id = sub1.id;

      const sub2 = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "INSTAGRAM",
        projectId: state.testProjectId,
        eventTypes: ["STORY_PUBLISHED"],
      });
      subscription2Id = sub2.id;

      const sub3 = await state.webhookManager.createSubscription(state.testAccount2Id, {
        provider: "FACEBOOK",
        eventTypes: ["POST_PUBLISHED"],
      });
      subscription3Id = sub3.id;
    });

    it("should get all subscriptions for an account", async () => {
      const subscriptions = await state.webhookManager.getSubscriptions(state.testAccountId);

      assert.ok(subscriptions.length >= 2, "Should have at least 2 subscriptions");
      assert.ok(subscriptions.every((sub) => sub.accountId === state.testAccountId));
      assert.ok(
        subscriptions.every((sub) => !("secretKey" in sub)),
        "Secret keys should be omitted"
      );
    });

    it("should filter subscriptions by provider", async () => {
      const xSubscriptions = await state.webhookManager.getSubscriptions(
        state.testAccountId,
        "X" as Provider
      );

      assert.ok(xSubscriptions.length >= 1);
      assert.ok(xSubscriptions.every((sub) => sub.provider === "X"));
    });

    it("should include project information when available", async () => {
      const subscriptions = await state.webhookManager.getSubscriptions(state.testAccountId);
      const subWithProject = subscriptions.find((sub) => sub.projectId === state.testProjectId);

      assert.ok(subWithProject);
      assert.ok(subWithProject.project);
      assert.strictEqual(subWithProject.project.id, state.testProjectId);
      assert.ok(subWithProject.project.name);
    });

    it("should include subscription statistics", async () => {
      const subscriptions = await state.webhookManager.getSubscriptions(state.testAccountId);

      subscriptions.forEach((sub) => {
        assert.ok(sub.stats);
        assert.strictEqual(typeof sub.stats.eventsReceived, "number");
        assert.strictEqual(typeof sub.stats.eventsProcessed, "number");
        assert.ok(sub.stats.lastEventAt === null || sub.stats.lastEventAt instanceof Date);
      });
    });

    it("should order subscriptions by creation date descending", async () => {
      const subscriptions = await state.webhookManager.getSubscriptions(state.testAccountId);

      if (subscriptions.length > 1) {
        for (let i = 1; i < subscriptions.length; i++) {
          assert.ok(
            subscriptions[i - 1].createdAt >= subscriptions[i].createdAt,
            "Should be ordered by createdAt desc"
          );
        }
      }
    });

    it("should not return subscriptions from other accounts", async () => {
      const subscriptions = await state.webhookManager.getSubscriptions(state.testAccountId);

      assert.ok(
        !subscriptions.some((sub) => sub.id === subscription3Id),
        "Should not include other account's subscriptions"
      );
    });

    after(async () => {
      await prisma.webhookSubscription.deleteMany({
        where: { id: { in: [subscription1Id, subscription2Id, subscription3Id] } },
      });
    });
  });

  describe("updateSubscription() - Update Webhook Subscription", { concurrency: 1 }, () => {
    let subscriptionId: string;

    before(async () => {
      const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });
      subscriptionId = subscription.id;
    });

    it("should update subscription active status", async () => {
      const result = await state.webhookManager.updateSubscription(
        subscriptionId,
        state.testAccountId,
        { isActive: false }
      );

      assert.strictEqual(result.count, 1);

      const updated = await prisma.webhookSubscription.findUnique({
        where: { id: subscriptionId },
      });

      assert.strictEqual(updated?.isActive, false);
    });

    it("should update subscription event types", async () => {
      const newEventTypes: WebhookEventType[] = ["POST_UPDATED", "POST_DELETED"];

      const result = await state.webhookManager.updateSubscription(
        subscriptionId,
        state.testAccountId,
        { eventTypes: newEventTypes }
      );

      assert.strictEqual(result.count, 1);

      const updated = await prisma.webhookSubscription.findUnique({
        where: { id: subscriptionId },
      });

      assert.deepStrictEqual(updated?.eventTypes, newEventTypes);
    });

    it("should update subscription verify token", async () => {
      const newVerifyToken = "new-verify-token-456";

      const result = await state.webhookManager.updateSubscription(
        subscriptionId,
        state.testAccountId,
        { verifyToken: newVerifyToken }
      );

      assert.strictEqual(result.count, 1);

      const updated = await prisma.webhookSubscription.findUnique({
        where: { id: subscriptionId },
      });

      assert.strictEqual(updated?.verifyToken, newVerifyToken);
    });

    it("should update multiple fields at once", async () => {
      const result = await state.webhookManager.updateSubscription(
        subscriptionId,
        state.testAccountId,
        {
          isActive: true,
          eventTypes: ["COMMENT_RECEIVED", "LIKE_RECEIVED"],
          verifyToken: "combined-update-token",
        }
      );

      assert.strictEqual(result.count, 1);

      const updated = await prisma.webhookSubscription.findUnique({
        where: { id: subscriptionId },
      });

      assert.strictEqual(updated?.isActive, true);
      assert.deepStrictEqual(updated?.eventTypes, ["COMMENT_RECEIVED", "LIKE_RECEIVED"]);
      assert.strictEqual(updated?.verifyToken, "combined-update-token");
    });

    it("should throw error when subscription not found", async () => {
      await assert.rejects(
        async () => {
          await state.webhookManager.updateSubscription("non-existent-id", state.testAccountId, {
            isActive: false,
          });
        },
        {
          message: "Webhook subscription not found",
        }
      );
    });

    it("should throw error when updating other account's subscription", async () => {
      await assert.rejects(
        async () => {
          await state.webhookManager.updateSubscription(subscriptionId, state.testAccount2Id, {
            isActive: false,
          });
        },
        {
          message: "Webhook subscription not found",
        }
      );
    });

    after(async () => {
      await prisma.webhookSubscription.deleteMany({
        where: { id: subscriptionId },
      });
    });
  });

  describe("deleteSubscription() - Delete Webhook Subscription", { concurrency: 1 }, () => {
    it("should delete subscription successfully", async () => {
      const subscription = await state.webhookManager.createSubscription(state.testAccountId, {
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });

      const result = await state.webhookManager.deleteSubscription(
        subscription.id,
        state.testAccountId
      );

      assert.deepStrictEqual(result, { success: true });

      const deleted = await prisma.webhookSubscription.findUnique({
        where: { id: subscription.id },
      });

      assert.strictEqual(deleted, null);
    });

    it("should throw error when subscription not found", async () => {
      await assert.rejects(
        async () => {
          await state.webhookManager.deleteSubscription("non-existent-id", state.testAccountId);
        },
        {
          message: "Webhook subscription not found",
        }
      );
    });

    it("should throw error when deleting other account's subscription", async () => {
      const subscription = await state.webhookManager.createSubscription(state.testAccount2Id, {
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });

      await assert.rejects(
        async () => {
          await state.webhookManager.deleteSubscription(subscription.id, state.testAccountId);
        },
        {
          message: "Webhook subscription not found",
        }
      );

      await prisma.webhookSubscription.deleteMany({
        where: { id: subscription.id },
      });
    });
  });
});
