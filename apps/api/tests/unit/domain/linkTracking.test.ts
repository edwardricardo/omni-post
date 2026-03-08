/**
 * Domain Layer - Link Tracking Unit Tests
 *
 * Part of Sprint 19: Link Tracking Feature
 * TDD: RED phase - Tests written before implementation
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TrackedLinkId,
  TrackedLink,
  LinkClickId,
  LinkClick,
  ShortCode,
  ProjectId,
} from "../../../src/domain/index.js";

describe("Link Tracking Domain", () => {
  describe("TrackedLinkId Value Object", () => {
    it("should generate a new TrackedLinkId", () => {
      const id = TrackedLinkId.generate();
      assert.ok(id, "Should generate an ID");
      assert.ok(id.value.length > 0, "ID should have a value");
    });

    it("should create TrackedLinkId from valid string", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const result = TrackedLinkId.fromString(uuid);
      assert.ok(result.ok, "Should create from valid UUID");
      if (result.ok) {
        assert.equal(result.value.value, uuid);
      }
    });

    it("should reject invalid UUID string", () => {
      const result = TrackedLinkId.fromString("invalid-id");
      assert.ok(!result.ok, "Should reject invalid UUID");
    });

    it("should compare TrackedLinkIds for equality", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const id1 = TrackedLinkId.fromStringUnsafe(uuid);
      const id2 = TrackedLinkId.fromStringUnsafe(uuid);
      assert.ok(id1.equals(id2), "Same IDs should be equal");
    });
  });

  describe("ShortCode Value Object", () => {
    it("should generate a unique short code", () => {
      const code = ShortCode.generate();
      assert.ok(code, "Should generate a code");
      assert.ok(code.value.length >= 6, "Code should be at least 6 chars");
      assert.ok(code.value.length <= 10, "Code should be at most 10 chars");
    });

    it("should create ShortCode from valid string", () => {
      const result = ShortCode.fromString("abc123");
      assert.ok(result.ok, "Should create from valid string");
      if (result.ok) {
        assert.equal(result.value.value, "abc123");
      }
    });

    it("should reject short code that is too short", () => {
      const result = ShortCode.fromString("ab");
      assert.ok(!result.ok, "Should reject code less than 3 chars");
    });

    it("should reject short code with invalid characters", () => {
      const result = ShortCode.fromString("abc@123");
      assert.ok(!result.ok, "Should reject code with special characters");
    });

    it("should allow custom vanity slug", () => {
      const result = ShortCode.fromString("my-brand-link");
      assert.ok(result.ok, "Should accept hyphenated vanity slug");
    });
  });

  describe("TrackedLink Entity", () => {
    const projectId = ProjectId.generate();

    it("should create a tracked link with valid URL", () => {
      const result = TrackedLink.create({
        projectId,
        originalUrl: "https://example.com/my-page",
      });

      assert.ok(result.ok, "Should create tracked link");
      if (result.ok) {
        assert.equal(result.value.originalUrl, "https://example.com/my-page");
        assert.ok(result.value.shortCode, "Should have generated short code");
        assert.equal(result.value.clicks, 0, "Should start with 0 clicks");
        assert.equal(result.value.projectId.value, projectId.value);
      }
    });

    it("should reject invalid URL", () => {
      const result = TrackedLink.create({
        projectId,
        originalUrl: "not-a-valid-url",
      });

      assert.ok(!result.ok, "Should reject invalid URL");
    });

    it("should create tracked link with custom vanity slug", () => {
      const result = TrackedLink.create({
        projectId,
        originalUrl: "https://example.com/campaign",
        vanitySlug: "summer-sale",
      });

      assert.ok(result.ok, "Should create with vanity slug");
      if (result.ok) {
        assert.equal(result.value.vanitySlug, "summer-sale");
      }
    });

    it("should increment click count", () => {
      const result = TrackedLink.create({
        projectId,
        originalUrl: "https://example.com",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const link = result.value;
        assert.equal(link.clicks, 0);

        link.recordClick();
        assert.equal(link.clicks, 1);

        link.recordClick();
        assert.equal(link.clicks, 2);
      }
    });

    it("should deactivate a link", () => {
      const result = TrackedLink.create({
        projectId,
        originalUrl: "https://example.com",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const link = result.value;
        assert.ok(link.isActive, "Should be active by default");

        link.deactivate();
        assert.ok(!link.isActive, "Should be inactive after deactivation");
      }
    });

    it("should reactivate a deactivated link", () => {
      const result = TrackedLink.create({
        projectId,
        originalUrl: "https://example.com",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const link = result.value;
        link.deactivate();
        link.activate();
        assert.ok(link.isActive, "Should be active after reactivation");
      }
    });

    it("should serialize to JSON", () => {
      const result = TrackedLink.create({
        projectId,
        originalUrl: "https://example.com",
        vanitySlug: "my-link",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const json = result.value.toJSON();
        assert.ok(json.id, "JSON should have id");
        assert.equal(json.originalUrl, "https://example.com");
        assert.equal(json.vanitySlug, "my-link");
        assert.equal(json.clicks, 0);
        assert.equal(json.isActive, true);
      }
    });
  });

  describe("LinkClickId Value Object", () => {
    it("should generate a new LinkClickId", () => {
      const id = LinkClickId.generate();
      assert.ok(id, "Should generate an ID");
    });

    it("should create from valid UUID string", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const result = LinkClickId.fromString(uuid);
      assert.ok(result.ok);
    });
  });

  describe("LinkClick Entity", () => {
    const linkId = TrackedLinkId.generate();

    it("should create a link click with minimal data", () => {
      const result = LinkClick.create({
        trackedLinkId: linkId,
      });

      assert.ok(result.ok, "Should create link click");
      if (result.ok) {
        assert.equal(result.value.trackedLinkId.value, linkId.value);
        assert.ok(result.value.timestamp, "Should have timestamp");
        assert.ok(result.value.timestamp instanceof Date, "timestamp should be a Date");
      }
    });

    it("should create link click with full tracking data", () => {
      const result = LinkClick.create({
        trackedLinkId: linkId,
        referrer: "https://google.com",
        userAgent: "Mozilla/5.0",
        ipAddress: "192.168.1.1",
        country: "US",
        city: "New York",
      });

      assert.ok(result.ok, "Should create with full data");
      if (result.ok) {
        assert.equal(result.value.referrer, "https://google.com");
        assert.equal(result.value.userAgent, "Mozilla/5.0");
        assert.equal(result.value.country, "US");
        assert.equal(result.value.city, "New York");
      }
    });

    it("should serialize to JSON", () => {
      const result = LinkClick.create({
        trackedLinkId: linkId,
        country: "UK",
      });

      assert.ok(result.ok);
      if (result.ok) {
        const json = result.value.toJSON();
        assert.ok(json.id);
        assert.ok(json.trackedLinkId);
        assert.equal(json.country, "UK");
        assert.ok(json.timestamp);
      }
    });

    it("should have undefined optional fields when not provided", () => {
      const result = LinkClick.create({ trackedLinkId: linkId });
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.referrer, undefined);
        assert.equal(result.value.userAgent, undefined);
        assert.equal(result.value.ipAddress, undefined);
        assert.equal(result.value.country, undefined);
        assert.equal(result.value.city, undefined);
      }
    });
  });

  describe("ShortCode generation uniqueness", () => {
    it("should generate unique codes across multiple calls", () => {
      const codes = new Set<string>();
      for (let i = 0; i < 20; i++) {
        codes.add(ShortCode.generate().value);
      }
      // With 8 chars from a 55-char alphabet, collision probability is negligible
      assert.ok(codes.size >= 18, "Should generate mostly unique codes");
    });

    it("should only use alphanumeric characters (no ambiguous chars)", () => {
      for (let i = 0; i < 10; i++) {
        const code = ShortCode.generate().value;
        assert.match(code, /^[a-zA-Z0-9]+$/, "Generated code should only be alphanumeric");
        assert.ok(!code.includes("0"), "Should not include '0' (ambiguous with 'O')");
        assert.ok(!code.includes("1"), "Should not include '1' (ambiguous with 'l')");
        assert.ok(!code.includes("l"), "Should not include 'l' (ambiguous with '1')");
        assert.ok(!code.includes("O"), "Should not include 'O' (ambiguous with '0')");
      }
    });
  });
});
