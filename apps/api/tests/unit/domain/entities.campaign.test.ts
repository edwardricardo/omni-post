/**
 * @file entities.campaign.test.ts
 * @description Mutation-killing tests for Campaign entity factory and lifecycle.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { Campaign } from "@core/domain/entities/Campaign.js";
import { ProjectId } from "@core/domain/value-objects/EntityId.js";

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    projectId: ProjectId.generate(),
    name: "Q1 Launch Campaign",
    ...overrides,
  };
}

describe("Campaign entity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("creates campaign with valid name", () => {
      const r = Campaign.create(makeProps());
      assert.ok(r.ok);
      assert.equal(r.value.name, "Q1 Launch Campaign");
    });

    it("generates a unique ID", () => {
      const r = Campaign.create(makeProps());
      assert.ok(r.ok);
      assert.ok(r.value.id);
    });

    it("starts with DRAFT status", () => {
      const r = Campaign.create(makeProps());
      assert.ok(r.ok);
      assert.equal(r.value.status.value, "DRAFT");
    });

    it("trims name whitespace", () => {
      const r = Campaign.create(makeProps({ name: "  Trimmed  " }));
      assert.ok(r.ok);
      assert.equal(r.value.name, "Trimmed");
    });

    it("rejects empty name", () => {
      const r = Campaign.create(makeProps({ name: "" }));
      assert.ok(!r.ok);
    });

    it("rejects whitespace-only name", () => {
      const r = Campaign.create(makeProps({ name: "   " }));
      assert.ok(!r.ok);
    });

    it("rejects endDate <= startDate", () => {
      const r = Campaign.create(
        makeProps({
          startDate: new Date("2025-06-30"),
          endDate: new Date("2025-06-01"),
        })
      );
      assert.ok(!r.ok);
    });

    it("rejects endDate equal to startDate", () => {
      const same = new Date("2025-06-15");
      const r = Campaign.create(makeProps({ startDate: same, endDate: same }));
      assert.ok(!r.ok);
    });

    it("accepts endDate after startDate", () => {
      const r = Campaign.create(
        makeProps({
          startDate: new Date("2025-06-01"),
          endDate: new Date("2025-06-30"),
        })
      );
      assert.ok(r.ok);
    });

    it("sets optional description", () => {
      const r = Campaign.create(makeProps({ description: "Desc" }));
      assert.ok(r.ok);
      assert.equal(r.value.description, "Desc");
    });

    it("sets optional UTM fields", () => {
      const r = Campaign.create(makeProps({ utmSource: "instagram", utmMedium: "social" }));
      assert.ok(r.ok);
      assert.equal(r.value.utmSource, "instagram");
      assert.equal(r.value.utmMedium, "social");
    });

    it("stores projectId", () => {
      const projId = ProjectId.generate();
      const r = Campaign.create(makeProps({ projectId: projId }));
      assert.ok(r.ok);
      assert.equal(r.value.projectId, projId);
    });

    it("creates without dates when not provided", () => {
      const r = Campaign.create(makeProps());
      assert.ok(r.ok);
      assert.equal(r.value.startDate, undefined);
      assert.equal(r.value.endDate, undefined);
    });
  });

  describe("lifecycle transitions", () => {
    it("can activate a DRAFT campaign", () => {
      const r = Campaign.create(makeProps());
      assert.ok(r.ok);
      const activateResult = r.value.activate();
      assert.ok(activateResult.ok);
      assert.equal(r.value.status.value, "ACTIVE");
    });

    it("can pause an ACTIVE campaign", () => {
      const r = Campaign.create(makeProps());
      assert.ok(r.ok);
      r.value.activate();
      const pauseResult = r.value.pause();
      assert.ok(pauseResult.ok);
      assert.equal(r.value.status.value, "PAUSED");
    });

    it("can complete an ACTIVE campaign", () => {
      const r = Campaign.create(makeProps());
      assert.ok(r.ok);
      r.value.activate();
      const completeResult = r.value.complete();
      assert.ok(completeResult.ok);
      assert.equal(r.value.status.value, "COMPLETED");
    });

    it("rejects activating a COMPLETED campaign", () => {
      const r = Campaign.create(makeProps());
      assert.ok(r.ok);
      r.value.activate();
      r.value.complete();
      const activateAgain = r.value.activate();
      assert.ok(!activateAgain.ok);
    });

    it("entityType returns Campaign", () => {
      const r = Campaign.create(makeProps());
      assert.ok(r.ok);
      assert.equal(r.value.entityType, "Campaign");
    });
  });
});
