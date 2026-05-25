/**
 * @file entities.approvalWorkflow.test.ts
 * @description Unit tests for the ApprovalWorkflow domain entity.
 *   Covers creation validation, level management, and completion logic.
 * @layer domain
 */

import { describe, it, expect } from "vitest";
import { ApprovalWorkflow, type WorkflowLevel } from "@core/domain/entities/ApprovalWorkflow.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCOUNT_ID = "account-001";

function makeLevels(count: number): WorkflowLevel[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `level-${String(i + 1)}`,
    order: i + 1,
    requireAll: false,
  }));
}

function createValidWorkflow(
  overrides?: Partial<Parameters<typeof ApprovalWorkflow.create>[0]>
): ApprovalWorkflow {
  const result = ApprovalWorkflow.create({
    id: "wf-001",
    accountId: ACCOUNT_ID,
    name: "Standard Review",
    levels: makeLevels(2),
    ...overrides,
  });
  expect(result.ok).toBeTruthy();
  return result.value;
}

// ---------------------------------------------------------------------------
// ApprovalWorkflow.create
// ---------------------------------------------------------------------------

describe("ApprovalWorkflow", () => {
  describe("create", () => {
    it("creates with valid 1-level workflow", () => {
      const result = ApprovalWorkflow.create({
        id: "wf-001",
        accountId: ACCOUNT_ID,
        name: "Simple Review",
        levels: makeLevels(1),
      });

      expect(result.ok).toBeTruthy();
      const wf = result.value;
      expect(wf.id).toBe("wf-001");
      expect(wf.accountId).toBe(ACCOUNT_ID);
      expect(wf.name).toBe("Simple Review");
      expect(wf.levels.length).toBe(1);
      expect(wf.isDefault).toBe(false);
      expect(wf.isActive).toBe(true);
    });

    it("creates with valid 3-level workflow", () => {
      const levels: WorkflowLevel[] = [
        { id: "l1", order: 1, role: "editor", requireAll: false },
        { id: "l2", order: 2, role: "manager", requireAll: true },
        { id: "l3", order: 3, assigneeId: "user-uuid-001", requireAll: false },
      ];

      const result = ApprovalWorkflow.create({
        id: "wf-002",
        accountId: ACCOUNT_ID,
        name: "Multi-Level Review",
        description: "Three-stage approval process",
        levels,
        isDefault: true,
      });

      expect(result.ok).toBeTruthy();
      const wf = result.value;
      expect(wf.levels.length).toBe(3);
      expect(wf.description).toBe("Three-stage approval process");
      expect(wf.isDefault).toBe(true);
    });

    it("rejects empty name", () => {
      const result = ApprovalWorkflow.create({
        id: "wf-003",
        accountId: ACCOUNT_ID,
        name: "",
        levels: makeLevels(1),
      });

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toContain("name");
    });

    it("rejects whitespace-only name", () => {
      const result = ApprovalWorkflow.create({
        id: "wf-004",
        accountId: ACCOUNT_ID,
        name: "   ",
        levels: makeLevels(1),
      });

      expect(result.ok).toBeFalsy();
    });

    it("rejects 0 levels", () => {
      const result = ApprovalWorkflow.create({
        id: "wf-005",
        accountId: ACCOUNT_ID,
        name: "No Levels",
        levels: [],
      });

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toContain("at least 1 level");
    });

    it("rejects more than 10 levels", () => {
      const result = ApprovalWorkflow.create({
        id: "wf-006",
        accountId: ACCOUNT_ID,
        name: "Too Many Levels",
        levels: makeLevels(11),
      });

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toContain("more than 10");
    });

    it("rejects non-sequential orders (gap)", () => {
      const levels: WorkflowLevel[] = [
        { id: "l1", order: 1, requireAll: false },
        { id: "l3", order: 3, requireAll: false },
      ];

      const result = ApprovalWorkflow.create({
        id: "wf-007",
        accountId: ACCOUNT_ID,
        name: "Gap Orders",
        levels,
      });

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toContain("sequential");
    });

    it("rejects non-sequential orders (not starting at 1)", () => {
      const levels: WorkflowLevel[] = [
        { id: "l2", order: 2, requireAll: false },
        { id: "l3", order: 3, requireAll: false },
      ];

      const result = ApprovalWorkflow.create({
        id: "wf-008",
        accountId: ACCOUNT_ID,
        name: "Bad Start",
        levels,
      });

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toContain("sequential");
    });

    it("rejects empty accountId", () => {
      const result = ApprovalWorkflow.create({
        id: "wf-009",
        accountId: "",
        name: "Valid Name",
        levels: makeLevels(1),
      });

      expect(result.ok).toBeFalsy();
      expect(result.error.message).toContain("Account ID");
    });

    it("accepts levels in non-sorted order and sorts them", () => {
      const levels: WorkflowLevel[] = [
        { id: "l3", order: 3, requireAll: false },
        { id: "l1", order: 1, requireAll: false },
        { id: "l2", order: 2, requireAll: false },
      ];

      const result = ApprovalWorkflow.create({
        id: "wf-010",
        accountId: ACCOUNT_ID,
        name: "Sorted Levels",
        levels,
      });

      expect(result.ok).toBeTruthy();
      const sortedLevels = result.value.levels;
      expect(sortedLevels[0]?.order).toBe(1);
      expect(sortedLevels[1]?.order).toBe(2);
      expect(sortedLevels[2]?.order).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // isComplete
  // ---------------------------------------------------------------------------

  describe("isComplete", () => {
    it("returns false when currentLevel is within range", () => {
      const wf = createValidWorkflow(); // 2 levels
      expect(wf.isComplete(1)).toBe(false);
      expect(wf.isComplete(2)).toBe(false);
    });

    it("returns true when currentLevel exceeds total levels", () => {
      const wf = createValidWorkflow(); // 2 levels
      expect(wf.isComplete(3)).toBe(true);
    });

    it("returns true for single-level workflow at level 2", () => {
      const wf = createValidWorkflow({ levels: makeLevels(1) });
      expect(wf.isComplete(2)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getLevel
  // ---------------------------------------------------------------------------

  describe("getLevel", () => {
    it("returns correct level by order number", () => {
      const levels: WorkflowLevel[] = [
        { id: "l1", order: 1, role: "editor", requireAll: false },
        { id: "l2", order: 2, role: "manager", requireAll: true },
      ];

      const wf = createValidWorkflow({ levels });

      const level1 = wf.getLevel(1);
      expect(level1).toBeDefined();
      expect(level1?.role).toBe("editor");
      expect(level1?.requireAll).toBe(false);

      const level2 = wf.getLevel(2);
      expect(level2).toBeDefined();
      expect(level2?.role).toBe("manager");
      expect(level2?.requireAll).toBe(true);
    });

    it("returns undefined for out-of-range order", () => {
      const wf = createValidWorkflow(); // 2 levels
      expect(wf.getLevel(0)).toBeUndefined();
      expect(wf.getLevel(3)).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getLevelCount
  // ---------------------------------------------------------------------------

  describe("getLevelCount", () => {
    it("returns the total number of levels", () => {
      const wf = createValidWorkflow(); // 2 levels
      expect(wf.getLevelCount()).toBe(2);
    });

    it("returns 1 for single-level workflow", () => {
      const wf = createValidWorkflow({ levels: makeLevels(1) });
      expect(wf.getLevelCount()).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // toJSON
  // ---------------------------------------------------------------------------

  describe("toJSON", () => {
    it("serializes all fields correctly", () => {
      const wf = createValidWorkflow({
        description: "Test description",
        isDefault: true,
      });

      const json = wf.toJSON();
      expect(json.id).toBe("wf-001");
      expect(json.accountId).toBe(ACCOUNT_ID);
      expect(json.name).toBe("Standard Review");
      expect(json.description).toBe("Test description");
      expect(json.isDefault).toBe(true);
      expect(json.isActive).toBe(true);
      expect(Array.isArray(json.levels)).toBe(true);
      expect((json.levels as Array<Record<string, unknown>>).length).toBe(2);
    });

    it("omits description when not provided", () => {
      const wf = createValidWorkflow();
      const json = wf.toJSON();
      expect("description" in json).toBe(false);
    });
  });
});
