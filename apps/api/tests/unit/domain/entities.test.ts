/**
 * Domain Layer - Entities Unit Tests
 *
 * Tests for all domain entities.
 *
 * @file entities.test.ts
 * @description Tests for Domain Entities
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import {
  Channel,
  Account,
  Project,
  PostId,
  ChannelId,
  AccountId,
  ProjectId,
  Provider,
} from "@core/domain/index.js";

describe("Domain Entities", () => {
  describe("Channel Entity", () => {
    const projectId = ProjectId.generate();
    const accountId = AccountId.generate();

    it("should create a new channel", () => {
      const result = Channel.create({
        projectId,
        accountId,
        provider: "X",
        handle: "@testhandle",
        credentials: { accessToken: "token123" },
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.handle).toBe("@testhandle");
        expect(result.value.provider.isX()).toBeTruthy();
        expect(result.value.isConnected).toBeTruthy();
      }
    });

    it("should reject empty handle", () => {
      const result = Channel.create({
        projectId,
        accountId,
        provider: "X",
        handle: "",
        credentials: { accessToken: "token123" },
      });

      expect(result.ok).toBeFalsy();
    });

    it("should reject missing access token", () => {
      const result = Channel.create({
        projectId,
        accountId,
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "" },
      });

      expect(result.ok).toBeFalsy();
    });

    it("should accept Provider object", () => {
      const result = Channel.create({
        projectId,
        accountId,
        provider: Provider.instagram(),
        handle: "@instahandle",
        credentials: { accessToken: "token" },
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.provider.isInstagram()).toBeTruthy();
      }
    });

    it("should update credentials", () => {
      const result = Channel.create({
        projectId,
        accountId,
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "old_token" },
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const channel = result.value;
        const updateResult = channel.updateCredentials({
          accessToken: "new_token",
          refreshToken: "refresh",
        });
        expect(updateResult.ok).toBeTruthy();
        expect(channel.credentials.accessToken).toBe("new_token");
      }
    });

    it("should track error count", () => {
      const result = Channel.create({
        projectId,
        accountId,
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const channel = result.value;
        channel.recordError("API error");
        expect(channel.errorCount).toBe(1);
        channel.recordError("Another error");
        expect(channel.errorCount).toBe(2);
        channel.recordError("Third error");
        expect(channel.errorCount).toBe(3);
        expect(channel.hasError).toBeTruthy();
      }
    });

    it("should reset errors", () => {
      const result = Channel.create({
        projectId,
        accountId,
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const channel = result.value;
        channel.recordError("Error 1");
        channel.recordError("Error 2");
        channel.recordError("Error 3");
        channel.resetErrors();
        expect(channel.errorCount).toBe(0);
        expect(channel.isConnected).toBeTruthy();
      }
    });

    it("defaults isPrimary to false on creation", () => {
      const result = Channel.create({
        projectId,
        accountId,
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.isPrimary).toBe(false);
      }
    });

    it("flips isPrimary via markAsPrimary and updates timestamp", async () => {
      const result = Channel.create({
        projectId,
        accountId,
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });
      expect(result.ok).toBeTruthy();
      if (!result.ok) return;
      const channel = result.value;
      const before = channel.updatedAt.getTime();
      // Make sure the clock advances so updatedAt changes deterministically.
      await new Promise((resolve) => setTimeout(resolve, 5));
      channel.markAsPrimary();
      expect(channel.isPrimary).toBe(true);
      expect(channel.updatedAt.getTime()).toBeGreaterThan(before);
    });

    it("markAsPrimary is idempotent — does not bump updatedAt when already primary", async () => {
      const result = Channel.create({
        projectId,
        accountId,
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });
      expect(result.ok).toBeTruthy();
      if (!result.ok) return;
      const channel = result.value;
      channel.markAsPrimary();
      const after = channel.updatedAt.getTime();
      await new Promise((resolve) => setTimeout(resolve, 5));
      channel.markAsPrimary();
      expect(channel.isPrimary).toBe(true);
      expect(channel.updatedAt.getTime()).toBe(after);
    });

    it("unmarkAsPrimary flips back to false and is idempotent", async () => {
      const result = Channel.create({
        projectId,
        accountId,
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });
      expect(result.ok).toBeTruthy();
      if (!result.ok) return;
      const channel = result.value;
      channel.markAsPrimary();
      expect(channel.isPrimary).toBe(true);
      channel.unmarkAsPrimary();
      expect(channel.isPrimary).toBe(false);
      const after = channel.updatedAt.getTime();
      await new Promise((resolve) => setTimeout(resolve, 5));
      // Second unmark on an already-non-primary channel must not bump updatedAt.
      channel.unmarkAsPrimary();
      expect(channel.updatedAt.getTime()).toBe(after);
    });

    it("toJSON exposes isPrimary", () => {
      const result = Channel.create({
        projectId,
        accountId,
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });
      expect(result.ok).toBeTruthy();
      if (!result.ok) return;
      const channel = result.value;
      channel.markAsPrimary();
      const json = channel.toJSON();
      expect(json.isPrimary).toBe(true);
    });

    it("starts with needsReauth = false", () => {
      const r = Channel.create({
        projectId: ProjectId.generate(),
        accountId: AccountId.generate(),
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });
      expect(r.ok).toBeTruthy();
      if (!r.ok) return;
      expect(r.value.needsReauth).toBe(false);
      expect(r.value.authFailedAt).toBeUndefined();
      expect(r.value.authFailureReason).toBeUndefined();
    });

    it("markForReauth sets needsReauth + authFailedAt + reason", () => {
      const r = Channel.create({
        projectId: ProjectId.generate(),
        accountId: AccountId.generate(),
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });
      if (!r.ok) throw r.error;
      const channel = r.value;
      const before = Date.now();
      channel.markForReauth("admin force-reauth post-secret-rotation");
      expect(channel.needsReauth).toBe(true);
      expect(channel.authFailureReason).toBe("admin force-reauth post-secret-rotation");
      expect(channel.authFailedAt).toBeInstanceOf(Date);
      expect((channel.authFailedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    });

    it("markForReauth re-stamps authFailedAt on consecutive triggers", async () => {
      const r = Channel.create({
        projectId: ProjectId.generate(),
        accountId: AccountId.generate(),
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });
      if (!r.ok) throw r.error;
      const channel = r.value;
      channel.markForReauth("first");
      const first = (channel.authFailedAt as Date).getTime();
      await new Promise((res) => setTimeout(res, 5));
      channel.markForReauth("second");
      expect((channel.authFailedAt as Date).getTime()).toBeGreaterThanOrEqual(first);
      expect(channel.authFailureReason).toBe("second");
    });

    it("clearReauthFlag is idempotent and resets fields", () => {
      const r = Channel.create({
        projectId: ProjectId.generate(),
        accountId: AccountId.generate(),
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });
      if (!r.ok) throw r.error;
      const channel = r.value;
      channel.markForReauth("x");
      channel.clearReauthFlag();
      expect(channel.needsReauth).toBe(false);
      expect(channel.authFailedAt).toBeUndefined();
      expect(channel.authFailureReason).toBeUndefined();
      // idempotent — second call no-op
      const updatedAtBefore = channel.updatedAt.getTime();
      channel.clearReauthFlag();
      expect(channel.updatedAt.getTime()).toBe(updatedAtBefore);
    });

    it("markAsExpired stamps expiredAt and flips status to EXPIRED", () => {
      const r = Channel.create({
        projectId: ProjectId.generate(),
        accountId: AccountId.generate(),
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });
      if (!r.ok) throw r.error;
      const channel = r.value;
      const before = Date.now();
      channel.markAsExpired();
      expect(channel.status).toBe("EXPIRED");
      expect(channel.expiredAt).toBeInstanceOf(Date);
      expect((channel.expiredAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    });

    it("recordReconnection preserves expiredAt as audit history", async () => {
      const r = Channel.create({
        projectId: ProjectId.generate(),
        accountId: AccountId.generate(),
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });
      if (!r.ok) throw r.error;
      const channel = r.value;
      channel.markAsExpired();
      const expiredAtBefore = (channel.expiredAt as Date).getTime();
      channel.markForReauth("rotation");

      await new Promise((res) => setTimeout(res, 2));
      channel.recordReconnection();

      expect(channel.status).toBe("CONNECTED");
      expect(channel.needsReauth).toBe(false);
      expect(channel.authFailedAt).toBeUndefined();
      expect(channel.authFailureReason).toBeUndefined();
      expect(channel.connectedAt).toBeInstanceOf(Date);
      // expiredAt MUST survive — it is the audit record of the latest natural expiry.
      expect(channel.expiredAt).toBeInstanceOf(Date);
      expect((channel.expiredAt as Date).getTime()).toBe(expiredAtBefore);
    });

    it("recordPublish updates lastUsedAt with the supplied timestamp", () => {
      const r = Channel.create({
        projectId: ProjectId.generate(),
        accountId: AccountId.generate(),
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });
      if (!r.ok) throw r.error;
      const channel = r.value;
      const at = new Date("2026-04-15T10:30:00.000Z");
      channel.recordPublish(at);
      expect(channel.lastUsedAt).toBeInstanceOf(Date);
      expect((channel.lastUsedAt as Date).getTime()).toBe(at.getTime());
    });

    it("updateProfile partially updates accountName/profileImage and skips no-op calls", () => {
      const r = Channel.create({
        projectId: ProjectId.generate(),
        accountId: AccountId.generate(),
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });
      if (!r.ok) throw r.error;
      const channel = r.value;

      channel.updateProfile({ accountName: "@miempresa" });
      expect(channel.accountName).toBe("@miempresa");
      expect(channel.profileImage).toBeUndefined();

      channel.updateProfile({ profileImage: "https://cdn/x.png" });
      expect(channel.accountName).toBe("@miempresa");
      expect(channel.profileImage).toBe("https://cdn/x.png");

      // No-op when both inputs are undefined — updatedAt should not advance.
      const updatedAtBefore = channel.updatedAt.getTime();
      channel.updateProfile({});
      expect(channel.updatedAt.getTime()).toBe(updatedAtBefore);
    });
  });

  describe("Account Entity", () => {
    it("should create a new account", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test User",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.email).toBe("test@example.com");
        expect(result.value.name).toBe("Test User");
        expect(result.value.isOnTrial).toBeTruthy();
      }
    });

    it("should reject invalid email", () => {
      const result = Account.create({
        email: "not-an-email",
        name: "Test User",
      });

      expect(result.ok).toBeFalsy();
    });

    it("should reject empty name", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "",
      });

      expect(result.ok).toBeFalsy();
    });

    it("should normalize email to lowercase", () => {
      const result = Account.create({
        email: "TEST@EXAMPLE.COM",
        name: "Test",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.email).toBe("test@example.com");
      }
    });

    it("should track trial days remaining", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test",
        trialDays: 14,
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.trialDaysRemaining <= 14).toBeTruthy();
        expect(result.value.trialDaysRemaining >= 13).toBeTruthy();
      }
    });

    it("should extend trial", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test",
        trialDays: 7,
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const account = result.value;
        const initialDays = account.trialDaysRemaining;
        const extendResult = account.extendTrial(7);
        expect(extendResult.ok).toBeTruthy();
        expect(account.trialDaysRemaining > initialDays).toBeTruthy();
      }
    });

    it("should manage project count", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const account = result.value;
        expect(account.canCreateProject).toBeTruthy();
        const incrementResult = account.incrementProjectCount();
        expect(incrementResult.ok).toBeTruthy();
        expect(account.projectCount).toBe(1);
        expect(account.canCreateProject).toBeFalsy();
      }
    });

    it("should reject incrementProjectCount when at project limit", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const account = result.value;
        // BASIC allows 1 project, fill to limit
        account.incrementProjectCount();
        // Now at limit, next increment should fail
        const overLimitResult = account.incrementProjectCount();
        expect(overLimitResult.ok).toBeFalsy();
      }
    });

    it("should decrement project count", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const account = result.value;
        account.incrementProjectCount();
        expect(account.projectCount).toBe(1);
        account.decrementProjectCount();
        expect(account.projectCount).toBe(0);
        expect(account.canCreateProject).toBeTruthy();
      }
    });

    it("should not decrement below zero", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const account = result.value;
        expect(account.projectCount).toBe(0);
        account.decrementProjectCount();
        expect(account.projectCount).toBe(0);
      }
    });
  });

  describe("Project Entity", () => {
    const accountId = AccountId.generate();

    it("should create a new project", () => {
      const result = Project.create({
        accountId,
        name: "My Project",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.name).toBe("My Project");
        expect(result.value.locale).toBe("en");
        expect(result.value.channelCount).toBe(0);
        expect(result.value.postCount).toBe(0);
      }
    });

    it("should reject empty name", () => {
      const result = Project.create({
        accountId,
        name: "",
      });

      expect(result.ok).toBeFalsy();
    });

    it("should reject name over 100 characters", () => {
      const result = Project.create({
        accountId,
        name: "A".repeat(101),
      });

      expect(result.ok).toBeFalsy();
    });

    it("should create with custom locale", () => {
      const result = Project.create({
        accountId,
        name: "Test",
        locale: "en",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.locale).toBe("en");
      }
    });

    it("should add and remove channels", () => {
      const result = Project.create({
        accountId,
        name: "Test",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const project = result.value;
        const channelId = ChannelId.generate();

        const addResult = project.addChannel(channelId);
        expect(addResult.ok).toBeTruthy();
        expect(project.channelCount).toBe(1);
        expect(project.hasChannel(channelId)).toBeTruthy();

        // Should not add duplicate
        const duplicateResult = project.addChannel(channelId);
        expect(duplicateResult.ok).toBeFalsy();

        const removed = project.removeChannel(channelId);
        expect(removed).toBeTruthy();
        expect(project.channelCount).toBe(0);
      }
    });

    it("should add and remove posts", () => {
      const result = Project.create({
        accountId,
        name: "Test",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const project = result.value;
        const postId = PostId.generate();

        const addResult = project.addPost(postId);
        expect(addResult.ok).toBeTruthy();
        expect(project.postCount).toBe(1);
        expect(project.hasPost(postId)).toBeTruthy();

        const removed = project.removePost(postId);
        expect(removed).toBeTruthy();
        expect(project.postCount).toBe(0);
      }
    });

    it("should update name and description", () => {
      const result = Project.create({
        accountId,
        name: "Original",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const project = result.value;

        const nameResult = project.updateName("Updated Name");
        expect(nameResult.ok).toBeTruthy();
        expect(project.name).toBe("Updated Name");

        project.updateDescription("A description");
        expect(project.description).toBe("A description");
      }
    });

    it("should provide stats", () => {
      const result = Project.create({
        accountId,
        name: "Test",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const project = result.value;
        project.addChannel(ChannelId.generate());
        project.addPost(PostId.generate());
        project.addPost(PostId.generate());

        const stats = project.stats;
        expect(stats.channelCount).toBe(1);
        expect(stats.postCount).toBe(2);
        expect(stats.draftCount).toBe(2); // New posts are drafts
      }
    });
  });
});
