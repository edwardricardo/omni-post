/**
 * Domain Layer - Entities Unit Tests
 *
 * Part of Sprint 4: DDD Architecture Implementation
 * Tests for all domain entities.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  Channel,
  Account,
  Project,
  PostId,
  ChannelId,
  AccountId,
  ProjectId,
  Provider,
  SUBSCRIPTION_TIER,
} from "../../../src/domain/index.js";

describe("Domain Entities", () => {
  describe("Channel Entity", () => {
    const projectId = ProjectId.generate();

    it("should create a new channel", () => {
      const result = Channel.create({
        projectId,
        provider: "X",
        handle: "@testhandle",
        credentials: { accessToken: "token123" },
      });

      assert.ok(result.ok, "Channel should be created");
      if (result.ok) {
        assert.equal(result.value.handle, "@testhandle");
        assert.ok(result.value.provider.isX());
        assert.ok(result.value.isConnected, "New channel should be connected");
      }
    });

    it("should reject empty handle", () => {
      const result = Channel.create({
        projectId,
        provider: "X",
        handle: "",
        credentials: { accessToken: "token123" },
      });

      assert.ok(!result.ok, "Should reject empty handle");
    });

    it("should reject missing access token", () => {
      const result = Channel.create({
        projectId,
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "" },
      });

      assert.ok(!result.ok, "Should reject empty access token");
    });

    it("should accept Provider object", () => {
      const result = Channel.create({
        projectId,
        provider: Provider.instagram(),
        handle: "@instahandle",
        credentials: { accessToken: "token" },
      });

      assert.ok(result.ok);
      if (result.ok) {
        assert.ok(result.value.provider.isInstagram());
      }
    });

    it("should update credentials", () => {
      const result = Channel.create({
        projectId,
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "old_token" },
      });

      assert.ok(result.ok);
      if (result.ok) {
        const channel = result.value;
        const updateResult = channel.updateCredentials({
          accessToken: "new_token",
          refreshToken: "refresh",
        });
        assert.ok(updateResult.ok);
        assert.equal(channel.credentials.accessToken, "new_token");
      }
    });

    it("should track error count", () => {
      const result = Channel.create({
        projectId,
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });

      assert.ok(result.ok);
      if (result.ok) {
        const channel = result.value;
        channel.recordError("API error");
        assert.equal(channel.errorCount, 1);
        channel.recordError("Another error");
        assert.equal(channel.errorCount, 2);
        channel.recordError("Third error");
        assert.equal(channel.errorCount, 3);
        assert.ok(channel.hasError, "Should be in error status after 3 errors");
      }
    });

    it("should reset errors", () => {
      const result = Channel.create({
        projectId,
        provider: "X",
        handle: "@test",
        credentials: { accessToken: "token" },
      });

      assert.ok(result.ok);
      if (result.ok) {
        const channel = result.value;
        channel.recordError("Error 1");
        channel.recordError("Error 2");
        channel.recordError("Error 3");
        channel.resetErrors();
        assert.equal(channel.errorCount, 0);
        assert.ok(channel.isConnected, "Should be connected after reset");
      }
    });
  });

  describe("Account Entity", () => {
    it("should create a new account", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test User",
      });

      assert.ok(result.ok, "Account should be created");
      if (result.ok) {
        assert.equal(result.value.email, "test@example.com");
        assert.equal(result.value.name, "Test User");
        assert.equal(result.value.subscription, SUBSCRIPTION_TIER.BASIC);
        assert.ok(result.value.isOnTrial);
      }
    });

    it("should reject invalid email", () => {
      const result = Account.create({
        email: "not-an-email",
        name: "Test User",
      });

      assert.ok(!result.ok, "Should reject invalid email");
    });

    it("should reject empty name", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "",
      });

      assert.ok(!result.ok, "Should reject empty name");
    });

    it("should normalize email to lowercase", () => {
      const result = Account.create({
        email: "TEST@EXAMPLE.COM",
        name: "Test",
      });

      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.email, "test@example.com");
      }
    });

    it("should upgrade subscription", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const account = result.value;
        const upgradeResult = account.upgradeTo(SUBSCRIPTION_TIER.PRO);
        assert.ok(upgradeResult.ok, "Should upgrade");
        assert.equal(account.subscription, SUBSCRIPTION_TIER.PRO);
        assert.ok(!account.isOnTrial, "Should no longer be on trial");
      }
    });

    it("should not allow upgrading to same or lower tier", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test",
        subscription: SUBSCRIPTION_TIER.PRO,
      });

      assert.ok(result.ok);
      if (result.ok) {
        const account = result.value;
        const upgradeResult = account.upgradeTo(SUBSCRIPTION_TIER.BASIC);
        assert.ok(!upgradeResult.ok, "Should not allow downgrade via upgrade");
      }
    });

    it("should track trial days remaining", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test",
        trialDays: 14,
      });

      assert.ok(result.ok);
      if (result.ok) {
        assert.ok(result.value.trialDaysRemaining <= 14);
        assert.ok(result.value.trialDaysRemaining >= 13);
      }
    });

    it("should extend trial", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test",
        trialDays: 7,
      });

      assert.ok(result.ok);
      if (result.ok) {
        const account = result.value;
        const initialDays = account.trialDaysRemaining;
        const extendResult = account.extendTrial(7);
        assert.ok(extendResult.ok, "Should extend trial");
        assert.ok(account.trialDaysRemaining > initialDays);
      }
    });

    it("should manage project count", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const account = result.value;
        assert.ok(account.canCreateProject);
        const incrementResult = account.incrementProjectCount();
        assert.ok(incrementResult.ok, "Should increment project count successfully");
        assert.equal(account.projectCount, 1);
        assert.ok(!account.canCreateProject, "BASIC allows only 1 project");
      }
    });

    it("should reject incrementProjectCount when at project limit", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const account = result.value;
        // BASIC allows 1 project, fill to limit
        account.incrementProjectCount();
        // Now at limit, next increment should fail
        const overLimitResult = account.incrementProjectCount();
        assert.ok(!overLimitResult.ok, "Should reject when at project limit");
      }
    });

    it("should decrement project count", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const account = result.value;
        account.incrementProjectCount();
        assert.equal(account.projectCount, 1);
        account.decrementProjectCount();
        assert.equal(account.projectCount, 0);
        assert.ok(account.canCreateProject, "Should be able to create after decrement");
      }
    });

    it("should not decrement below zero", () => {
      const result = Account.create({
        email: "test@example.com",
        name: "Test",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const account = result.value;
        assert.equal(account.projectCount, 0);
        account.decrementProjectCount();
        assert.equal(account.projectCount, 0, "Count should not go below 0");
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

      assert.ok(result.ok, "Project should be created");
      if (result.ok) {
        assert.equal(result.value.name, "My Project");
        assert.equal(result.value.locale, "en");
        assert.equal(result.value.channelCount, 0);
        assert.equal(result.value.postCount, 0);
      }
    });

    it("should reject empty name", () => {
      const result = Project.create({
        accountId,
        name: "",
      });

      assert.ok(!result.ok, "Should reject empty name");
    });

    it("should reject name over 100 characters", () => {
      const result = Project.create({
        accountId,
        name: "A".repeat(101),
      });

      assert.ok(!result.ok, "Should reject long name");
    });

    it("should create with custom locale", () => {
      const result = Project.create({
        accountId,
        name: "Test",
        locale: "en",
      });

      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.locale, "en");
      }
    });

    it("should add and remove channels", () => {
      const result = Project.create({
        accountId,
        name: "Test",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const project = result.value;
        const channelId = ChannelId.generate();

        const addResult = project.addChannel(channelId);
        assert.ok(addResult.ok);
        assert.equal(project.channelCount, 1);
        assert.ok(project.hasChannel(channelId));

        // Should not add duplicate
        const duplicateResult = project.addChannel(channelId);
        assert.ok(!duplicateResult.ok, "Should not add duplicate");

        const removed = project.removeChannel(channelId);
        assert.ok(removed);
        assert.equal(project.channelCount, 0);
      }
    });

    it("should add and remove posts", () => {
      const result = Project.create({
        accountId,
        name: "Test",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const project = result.value;
        const postId = PostId.generate();

        const addResult = project.addPost(postId);
        assert.ok(addResult.ok);
        assert.equal(project.postCount, 1);
        assert.ok(project.hasPost(postId));

        const removed = project.removePost(postId);
        assert.ok(removed);
        assert.equal(project.postCount, 0);
      }
    });

    it("should update name and description", () => {
      const result = Project.create({
        accountId,
        name: "Original",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const project = result.value;

        const nameResult = project.updateName("Updated Name");
        assert.ok(nameResult.ok);
        assert.equal(project.name, "Updated Name");

        project.updateDescription("A description");
        assert.equal(project.description, "A description");
      }
    });

    it("should provide stats", () => {
      const result = Project.create({
        accountId,
        name: "Test",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const project = result.value;
        project.addChannel(ChannelId.generate());
        project.addPost(PostId.generate());
        project.addPost(PostId.generate());

        const stats = project.stats;
        assert.equal(stats.channelCount, 1);
        assert.equal(stats.postCount, 2);
        assert.equal(stats.draftCount, 2); // New posts are drafts
      }
    });
  });
});
