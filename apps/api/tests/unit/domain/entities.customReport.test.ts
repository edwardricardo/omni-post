/**
 * @file entities.customReport.test.ts
 * @description Unit tests for the CustomReport domain entity.
 *   Covers creation, validation, update, and serialization.
 */

import { describe, it, expect, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { CustomReport } from "../../../src/domain/entities/CustomReport.js";

describe("CustomReport Entity", () => {
  const validInput = {
    accountId: "acc-001",
    name: "Weekly Performance",
    metrics: ["impressions", "reach", "engagement_rate"],
    dimensions: ["date", "platform"],
    createdById: "user-001",
  };

  describe("create", () => {
    it("creates with valid metrics and dimensions", () => {
      const result = CustomReport.create(validInput);
      assert.ok(result.ok, "Should succeed with valid input");
      const report = result.value;
      expect(report.name).toBe("Weekly Performance");
      expect(report.metrics).toEqual(["impressions", "reach", "engagement_rate"]);
      expect(report.dimensions).toEqual(["date", "platform"]);
      expect(report.dateRange).toBe("LAST_30_DAYS");
      expect(report.chartType).toBe("LINE");
      expect(report.isShared).toBe(false);
      expect(report.accountId).toBe("acc-001");
      expect(report.createdById).toBe("user-001");
    });

    it("rejects empty name", () => {
      const result = CustomReport.create({ ...validInput, name: "" });
      assert.ok(!result.ok, "Should fail with empty name");
      expect(result.error.message).toContain("name must not be empty");
    });

    it("rejects whitespace-only name", () => {
      const result = CustomReport.create({ ...validInput, name: "   " });
      assert.ok(!result.ok, "Should fail with whitespace name");
      expect(result.error.message).toContain("name must not be empty");
    });

    it("rejects name exceeding 200 characters", () => {
      const result = CustomReport.create({ ...validInput, name: "A".repeat(201) });
      assert.ok(!result.ok, "Should fail with long name");
      expect(result.error.message).toContain("200 characters");
    });

    it("rejects unknown metrics", () => {
      const result = CustomReport.create({
        ...validInput,
        metrics: ["impressions", "unknown_metric", "bad_metric"],
      });
      assert.ok(!result.ok, "Should fail with unknown metrics");
      expect(result.error.message).toContain("Unknown metrics");
      expect(result.error.message).toContain("unknown_metric");
      expect(result.error.message).toContain("bad_metric");
    });

    it("rejects empty metrics array", () => {
      const result = CustomReport.create({ ...validInput, metrics: [] });
      assert.ok(!result.ok, "Should fail with empty metrics");
      expect(result.error.message).toContain("At least one metric");
    });

    it("rejects unknown dimensions", () => {
      const result = CustomReport.create({
        ...validInput,
        dimensions: ["date", "nonexistent_dim"],
      });
      assert.ok(!result.ok, "Should fail with unknown dimensions");
      expect(result.error.message).toContain("Unknown dimensions");
      expect(result.error.message).toContain("nonexistent_dim");
    });

    it("rejects empty dimensions array", () => {
      const result = CustomReport.create({ ...validInput, dimensions: [] });
      assert.ok(!result.ok, "Should fail with empty dimensions");
      expect(result.error.message).toContain("At least one dimension");
    });

    it("rejects CUSTOM date range without start/end dates", () => {
      const result = CustomReport.create({
        ...validInput,
        dateRange: "CUSTOM",
      });
      assert.ok(!result.ok, "Should fail without start/end dates");
      expect(result.error.message).toContain("dateRangeStart and dateRangeEnd");
    });

    it("rejects CUSTOM date range with only start date", () => {
      const result = CustomReport.create({
        ...validInput,
        dateRange: "CUSTOM",
        dateRangeStart: new Date("2026-01-01"),
      });
      assert.ok(!result.ok, "Should fail without end date");
      expect(result.error.message).toContain("dateRangeStart and dateRangeEnd");
    });

    it("rejects CUSTOM date range when start >= end", () => {
      const result = CustomReport.create({
        ...validInput,
        dateRange: "CUSTOM",
        dateRangeStart: new Date("2026-03-01"),
        dateRangeEnd: new Date("2026-01-01"),
      });
      assert.ok(!result.ok, "Should fail when start >= end");
      expect(result.error.message).toContain("must be before");
    });

    it("accepts CUSTOM date range with valid start and end", () => {
      const start = new Date("2026-01-01");
      const end = new Date("2026-03-01");
      const result = CustomReport.create({
        ...validInput,
        dateRange: "CUSTOM",
        dateRangeStart: start,
        dateRangeEnd: end,
      });
      assert.ok(result.ok, "Should succeed with valid custom range");
      expect(result.value.dateRange).toBe("CUSTOM");
      expect(result.value.dateRangeStart).toEqual(start);
      expect(result.value.dateRangeEnd).toEqual(end);
    });

    it("rejects invalid date range preset", () => {
      const result = CustomReport.create({
        ...validInput,
        dateRange: "INVALID_RANGE",
      });
      assert.ok(!result.ok, "Should fail with invalid date range");
      expect(result.error.message).toContain("Invalid date range");
    });

    it("accepts all valid chart types", () => {
      const chartTypes = ["LINE", "BAR", "AREA", "PIE", "TABLE"];
      for (const chartType of chartTypes) {
        const result = CustomReport.create({ ...validInput, chartType });
        assert.ok(result.ok, `Should accept chart type: ${chartType}`);
        expect(result.value.chartType).toBe(chartType);
      }
    });

    it("rejects invalid chart type", () => {
      const result = CustomReport.create({
        ...validInput,
        chartType: "SCATTER",
      });
      assert.ok(!result.ok, "Should fail with invalid chart type");
      expect(result.error.message).toContain("Invalid chart type");
    });

    it("accepts all valid date range presets", () => {
      const presets = [
        "LAST_7_DAYS",
        "LAST_30_DAYS",
        "LAST_90_DAYS",
        "LAST_12_MONTHS",
        "THIS_MONTH",
        "LAST_MONTH",
        "THIS_YEAR",
      ];
      for (const dateRange of presets) {
        const result = CustomReport.create({ ...validInput, dateRange });
        assert.ok(result.ok, `Should accept date range: ${dateRange}`);
        expect(result.value.dateRange).toBe(dateRange);
      }
    });

    it("accepts optional fields", () => {
      const result = CustomReport.create({
        ...validInput,
        projectId: "proj-001",
        description: "Weekly report description",
        filters: { platform: "twitter" },
        isShared: true,
      });
      assert.ok(result.ok, "Should succeed with optional fields");
      expect(result.value.projectId).toBe("proj-001");
      expect(result.value.description).toBe("Weekly report description");
      expect(result.value.filters).toEqual({ platform: "twitter" });
      expect(result.value.isShared).toBe(true);
    });

    it("trims name whitespace", () => {
      const result = CustomReport.create({
        ...validInput,
        name: "  Report Name  ",
      });
      assert.ok(result.ok, "Should succeed");
      expect(result.value.name).toBe("Report Name");
    });
  });

  describe("reconstitute", () => {
    it("reconstitutes from persistence props", () => {
      const now = new Date();
      const report = CustomReport.reconstitute({
        id: "report-001",
        accountId: "acc-001",
        name: "Restored Report",
        metrics: ["impressions"],
        dimensions: ["date"],
        dateRange: "LAST_7_DAYS",
        chartType: "BAR",
        isShared: false,
        createdById: "user-001",
        createdAt: now,
        updatedAt: now,
      });

      expect(report.id).toBe("report-001");
      expect(report.name).toBe("Restored Report");
      expect(report.chartType).toBe("BAR");
    });
  });

  describe("update", () => {
    let report: CustomReport;

    beforeEach(() => {
      const result = CustomReport.create(validInput);
      assert.ok(result.ok);
      report = result.value;
    });

    it("updates name successfully", () => {
      const result = report.update({ name: "Updated Name" });
      assert.ok(result.ok, "Should succeed");
      expect(report.name).toBe("Updated Name");
    });

    it("rejects empty name on update", () => {
      const result = report.update({ name: "" });
      assert.ok(!result.ok, "Should fail with empty name");
      expect(result.error.message).toContain("name must not be empty");
    });

    it("rejects unknown metrics on update", () => {
      const result = report.update({ metrics: ["fake_metric"] });
      assert.ok(!result.ok, "Should fail with unknown metrics");
      expect(result.error.message).toContain("Unknown metrics");
    });

    it("rejects unknown dimensions on update", () => {
      const result = report.update({ dimensions: ["bad_dim"] });
      assert.ok(!result.ok, "Should fail with unknown dimensions");
    });

    it("validates CUSTOM date range on update", () => {
      const result = report.update({ dateRange: "CUSTOM" });
      assert.ok(!result.ok, "Should fail without start/end");
      expect(result.error.message).toContain("dateRangeStart and dateRangeEnd");
    });

    it("updates multiple fields at once", () => {
      const result = report.update({
        name: "New Name",
        chartType: "PIE",
        metrics: ["likes", "shares"],
        isShared: true,
      });
      assert.ok(result.ok, "Should succeed");
      expect(report.name).toBe("New Name");
      expect(report.chartType).toBe("PIE");
      expect(report.metrics).toEqual(["likes", "shares"]);
      expect(report.isShared).toBe(true);
    });

    it("updates updatedAt timestamp", () => {
      const before = report.updatedAt;
      // Small delay to ensure timestamp changes
      const result = report.update({ name: "Trigger Update" });
      assert.ok(result.ok);
      expect(report.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe("toJSON", () => {
    it("serializes all fields correctly", () => {
      const result = CustomReport.create({
        ...validInput,
        description: "Test description",
        isShared: true,
        filters: { key: "value" },
      });
      assert.ok(result.ok);
      const json = result.value.toJSON();

      expect(json.accountId).toBe("acc-001");
      expect(json.name).toBe("Weekly Performance");
      expect(json.description).toBe("Test description");
      expect(json.metrics).toEqual(["impressions", "reach", "engagement_rate"]);
      expect(json.dimensions).toEqual(["date", "platform"]);
      expect(json.dateRange).toBe("LAST_30_DAYS");
      expect(json.chartType).toBe("LINE");
      expect(json.isShared).toBe(true);
      expect(json.filters).toEqual({ key: "value" });
      expect(json.createdById).toBe("user-001");
      expect(typeof json.createdAt).toBe("string");
      expect(typeof json.updatedAt).toBe("string");
    });

    it("omits undefined optional fields", () => {
      const result = CustomReport.create(validInput);
      assert.ok(result.ok);
      const json = result.value.toJSON();

      expect(json).not.toHaveProperty("projectId");
      expect(json).not.toHaveProperty("description");
      expect(json).not.toHaveProperty("dateRangeStart");
      expect(json).not.toHaveProperty("dateRangeEnd");
      expect(json).not.toHaveProperty("filters");
    });
  });
});
