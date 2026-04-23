/**
 * Domain Layer - Crisis Mode Unit Tests
 *
 * Crisis Mode allows pausing all scheduled posts for a project
 * with a single action (e.g., during PR crisis, breaking news, etc.)
 *
 * @file crisisMode.test.ts
 * @description Tests for Crisis Mode Domain
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
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

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.isInCrisisMode).toBe(false);
        expect(result.value.crisisStartedAt).toBe(undefined);
      }
    });

    it("should enter crisis mode", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("PR incident - pausing all posts");

        expect(project.isInCrisisMode).toBe(true);
        expect(project.crisisStartedAt).toBeTruthy();
        expect(project.crisisReason).toBe("PR incident - pausing all posts");
      }
    });

    it("should exit crisis mode", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("Emergency");
        project.exitCrisisMode();

        expect(project.isInCrisisMode).toBe(false);
        expect(project.crisisStartedAt).toBe(undefined);
        expect(project.crisisReason).toBe(undefined);
      }
    });

    it("should track crisis mode history", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const project = result.value;

        // Enter and exit crisis mode
        project.enterCrisisMode("First crisis");
        project.exitCrisisMode();

        // Enter again
        project.enterCrisisMode("Second crisis");

        const history = project.crisisModeHistory;
        expect(history.length).toBe(2);
        expect(history[0]?.reason).toBe("First crisis");
        expect(history[0]?.endedAt).toBeTruthy();
        expect(history[1]?.reason).toBe("Second crisis");
        expect(history[1]?.endedAt).toBe(undefined);
      }
    });

    it("should not allow entering crisis mode when already in crisis", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("First crisis");

        // Try to enter again - should be no-op or throw
        const secondResult = project.enterCrisisMode("Second crisis");
        expect(secondResult).toBe(false);
        expect(project.crisisReason).toBe("First crisis");
      }
    });

    it("should allow exiting crisis mode when not in crisis (no-op)", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const project = result.value;
        // Should not throw
        const exitResult = project.exitCrisisMode();
        expect(exitResult).toBe(false);
      }
    });

    it("should include crisis mode in JSON serialization", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("Test crisis");

        const json = project.toJSON();
        expect(json.isInCrisisMode).toBe(true);
        expect(json.crisisStartedAt).toBeTruthy();
        expect(json.crisisReason).toBe("Test crisis");
      }
    });

    it("should calculate crisis duration", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("Duration test");

        // Check duration is positive (just entered)
        const duration = project.crisisDurationMs;
        expect(duration !== undefined).toBeTruthy();
        expect((duration as number) >= 0).toBeTruthy();
      }
    });

    it("should return undefined crisisDurationMs when not in crisis mode", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const project = result.value;
        expect(project.crisisDurationMs).toBe(undefined);
      }
    });

    it("should preserve crisis reason through JSON serialization", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("Outage incident");

        const json = project.toJSON();
        expect(json.isInCrisisMode).toBe(true);
        expect(json.crisisReason).toBe("Outage incident");
        expect(Array.isArray(json.crisisModeHistory)).toBeTruthy();
        const history = json.crisisModeHistory as Array<Record<string, unknown>>;
        expect(history.length).toBe(1);
        expect(history[0]?.reason).toBe("Outage incident");
      }
    });
  });

  describe("Crisis Mode Events", () => {
    it("should emit CrisisModeEntered event", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("Event test");

        const events = project.domainEvents;
        const crisisEvent = events.find((e) => e.eventType === "CrisisModeEntered");
        expect(crisisEvent).toBeTruthy();
      }
    });

    it("should emit CrisisModeExited event", () => {
      const result = Project.create({
        accountId,
        name: "Test Project",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const project = result.value;
        project.enterCrisisMode("Event test");
        project.clearDomainEvents(); // Clear enter event
        project.exitCrisisMode();

        const events = project.domainEvents;
        const exitEvent = events.find((e) => e.eventType === "CrisisModeExited");
        expect(exitEvent).toBeTruthy();
      }
    });
  });
});
