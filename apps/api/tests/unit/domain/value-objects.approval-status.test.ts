/**
 * @file value-objects.approval-status.test.ts
 * @description Mutation-killing tests for ApprovalStatus value object.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  ApprovalStatus,
  APPROVAL_STATUSES,
} from "../../../src/domain/value-objects/ApprovalStatus.js";

describe("ApprovalStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("creates PENDING from string", () => {
      const r = ApprovalStatus.create("PENDING");
      assert.ok(r.ok);
      assert.equal(r.value.value, "PENDING");
    });

    it("creates from lowercase string", () => {
      const r = ApprovalStatus.create("approved");
      assert.ok(r.ok);
      assert.equal(r.value.value, "APPROVED");
    });

    it("rejects invalid string", () => {
      const r = ApprovalStatus.create("INVALID");
      assert.ok(!r.ok);
    });

    it("rejects empty string", () => {
      assert.ok(!ApprovalStatus.create("").ok);
    });
  });

  describe("factory methods", () => {
    it("pending() creates PENDING", () => {
      assert.equal(ApprovalStatus.pending().value, "PENDING");
    });
    it("approved() creates APPROVED", () => {
      assert.equal(ApprovalStatus.approved().value, "APPROVED");
    });
    it("rejected() creates REJECTED", () => {
      assert.equal(ApprovalStatus.rejected().value, "REJECTED");
    });
    it("cancelled() creates CANCELLED", () => {
      assert.equal(ApprovalStatus.cancelled().value, "CANCELLED");
    });
  });

  describe("canTransitionTo", () => {
    it("PENDING can transition to APPROVED", () => {
      assert.equal(ApprovalStatus.pending().canTransitionTo("APPROVED"), true);
    });
    it("PENDING can transition to REJECTED", () => {
      assert.equal(ApprovalStatus.pending().canTransitionTo("REJECTED"), true);
    });
    it("PENDING can transition to CANCELLED", () => {
      assert.equal(ApprovalStatus.pending().canTransitionTo("CANCELLED"), true);
    });
    it("APPROVED cannot transition anywhere", () => {
      assert.equal(ApprovalStatus.approved().canTransitionTo("PENDING"), false);
    });
    it("REJECTED cannot transition anywhere", () => {
      assert.equal(ApprovalStatus.rejected().canTransitionTo("PENDING"), false);
    });
    it("CANCELLED cannot transition anywhere", () => {
      assert.equal(ApprovalStatus.cancelled().canTransitionTo("PENDING"), false);
    });
  });

  describe("transitionTo", () => {
    it("transitions PENDING to APPROVED", () => {
      const r = ApprovalStatus.pending().transitionTo("APPROVED");
      assert.ok(r.ok);
      assert.equal(r.value.value, "APPROVED");
    });

    it("rejects invalid transition from APPROVED", () => {
      const r = ApprovalStatus.approved().transitionTo("PENDING");
      assert.ok(!r.ok);
    });
  });

  describe("predicates", () => {
    it("isPending returns true for PENDING", () => {
      assert.equal(ApprovalStatus.pending().isPending(), true);
    });
    it("isPending returns false for APPROVED", () => {
      assert.equal(ApprovalStatus.approved().isPending(), false);
    });
    it("isApproved returns true for APPROVED", () => {
      assert.equal(ApprovalStatus.approved().isApproved(), true);
    });
    it("isRejected returns true for REJECTED", () => {
      assert.equal(ApprovalStatus.rejected().isRejected(), true);
    });
    it("isCancelled returns true for CANCELLED", () => {
      assert.equal(ApprovalStatus.cancelled().isCancelled(), true);
    });
  });

  describe("isTerminal", () => {
    it("PENDING is not terminal", () => {
      assert.equal(ApprovalStatus.pending().isTerminal(), false);
    });
    it("APPROVED is terminal", () => {
      assert.equal(ApprovalStatus.approved().isTerminal(), true);
    });
    it("REJECTED is terminal", () => {
      assert.equal(ApprovalStatus.rejected().isTerminal(), true);
    });
    it("CANCELLED is terminal", () => {
      assert.equal(ApprovalStatus.cancelled().isTerminal(), true);
    });
  });

  describe("equals", () => {
    it("returns true for same status", () => {
      assert.equal(ApprovalStatus.pending().equals(ApprovalStatus.pending()), true);
    });
    it("returns false for different status", () => {
      assert.equal(ApprovalStatus.pending().equals(ApprovalStatus.approved()), false);
    });
  });

  describe("serialization", () => {
    it("toString returns value", () => {
      assert.equal(ApprovalStatus.pending().toString(), "PENDING");
    });
    it("toJSON returns value", () => {
      assert.equal(ApprovalStatus.pending().toJSON(), "PENDING");
    });
  });

  describe("APPROVAL_STATUSES constant", () => {
    it("has 4 statuses", () => {
      assert.equal(Object.keys(APPROVAL_STATUSES).length, 4);
    });
    it("includes PENDING", () => {
      assert.equal(APPROVAL_STATUSES.PENDING, "PENDING");
    });
    it("includes APPROVED", () => {
      assert.equal(APPROVAL_STATUSES.APPROVED, "APPROVED");
    });
    it("includes REJECTED", () => {
      assert.equal(APPROVAL_STATUSES.REJECTED, "REJECTED");
    });
    it("includes CANCELLED", () => {
      assert.equal(APPROVAL_STATUSES.CANCELLED, "CANCELLED");
    });
  });
});
