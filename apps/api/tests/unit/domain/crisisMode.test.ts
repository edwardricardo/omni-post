/**
 * Domain Layer - Crisis Mode Unit Tests
 *
 * Part of Sprint 19: Crisis Mode Feature
 * TDD: RED phase - Tests written before implementation
 *
 * Crisis Mode allows pausing all scheduled posts for a project
 * with a single action (e.g., during PR crisis, breaking news, etc.)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AccountId } from "../../../src/domain/index.js";
import { Project } from "../../../src/domain/entities/Project.js";

describe("Crisis Mode Domain", () => {
  const accountId = AccountId.generate();

  describe("Project Crisis Mode", () => {
    it("should not be in crisis mode by default", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.isInCrisisMode, false);
        assert.equal(result.value.crisisStartedAt, undefined);
      }
    });

    it("should enter crisis mode", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("PR incident - pausing all posts");

        assert.equal(project.isInCrisisMode, true);
        assert.ok(project.crisisStartedAt, "Should have crisis start time");
        assert.equal(project.crisisReason, "PR incident - pausing all posts");
      }
    });

    it("should exit crisis mode", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("Emergency");
        project.exitCrisisMode();

        assert.equal(project.isInCrisisMode, false);
        assert.equal(project.crisisStartedAt, undefined);
        assert.equal(project.crisisReason, undefined);
      }
    });

    it("should track crisis mode history", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const project = result.value;

        // Enter and exit crisis mode
        project.enterCrisisMode("First crisis");
        project.exitCrisisMode();

        // Enter again
        project.enterCrisisMode("Second crisis");

        const history = project.crisisModeHistory;
        assert.equal(history.length, 2, "Should have 2 crisis entries");
        assert.equal(history[0]?.reason, "First crisis");
        assert.ok(history[0]?.endedAt, "First crisis should be ended");
        assert.equal(history[1]?.reason, "Second crisis");
        assert.equal(history[1]?.endedAt, undefined, "Current crisis should not be ended");
      }
    });

    it("should not allow entering crisis mode when already in crisis", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("First crisis");

        // Try to enter again - should be no-op or throw
        const secondResult = project.enterCrisisMode("Second crisis");
        assert.equal(secondResult, false, "Should not enter crisis mode twice");
        assert.equal(project.crisisReason, "First crisis", "Original reason preserved");
      }
    });

    it("should allow exiting crisis mode when not in crisis (no-op)", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const project = result.value;
        // Should not throw
        const exitResult = project.exitCrisisMode();
        assert.equal(exitResult, false, "Should return false when not in crisis");
      }
    });

    it("should include crisis mode in JSON serialization", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("Test crisis");

        const json = project.toJSON();
        assert.equal(json.isInCrisisMode, true);
        assert.ok(json.crisisStartedAt);
        assert.equal(json.crisisReason, "Test crisis");
      }
    });

    it("should calculate crisis duration", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("Duration test");

        // Check duration is positive (just entered)
        const duration = project.crisisDurationMs;
        assert.ok(duration !== undefined, "Should have duration");
        assert.ok((duration as number) >= 0, "Duration should be non-negative");
      }
    });

    it("should return undefined crisisDurationMs when not in crisis mode", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const project = result.value;
        assert.equal(
          project.crisisDurationMs,
          undefined,
          "Duration should be undefined when not in crisis"
        );
      }
    });

    it("should preserve crisis reason through JSON serialization", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("Outage incident");

        const json = project.toJSON();
        assert.equal(json.isInCrisisMode, true);
        assert.equal(json.crisisReason, "Outage incident");
        assert.ok(Array.isArray(json.crisisModeHistory));
        const history = json.crisisModeHistory as Array<Record<string, unknown>>;
        assert.equal(history.length, 1);
        assert.equal(history[0]?.reason, "Outage incident");
      }
    });
  });

  describe("Crisis Mode Events", () => {
    it("should emit CrisisModeEntered event", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("Event test");

        const events = project.domainEvents;
        const crisisEvent = events.find((e) => e.eventType === "CrisisModeEntered");
        assert.ok(crisisEvent, "Should emit CrisisModeEntered event");
      }
    });

    it("should emit CrisisModeExited event", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("Event test");
        project.clearDomainEvents(); // Clear enter event
        project.exitCrisisMode();

        const events = project.domainEvents;
        const exitEvent = events.find((e) => e.eventType === "CrisisModeExited");
        assert.ok(exitEvent, "Should emit CrisisModeExited event");
      }
    });
  });
});
