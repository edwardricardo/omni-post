/**
 * Domain Layer - Link Tracking Unit Tests
 *
 * Tests for TrackedLink aggregate, value objects, and link-tracking domain events.
 *
 * @file linkTracking.test.ts
 * @description Tests for Link Tracking Domain
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import {
  TrackedLinkId,
  TrackedLink,
  LinkClickId,
  LinkClick,
  ShortCode,
  ProjectId,
} from "@core/domain/index.js";

describe("Link Tracking Domain", () => {
  describe("TrackedLinkId Value Object", () => {
    it("should generate a new TrackedLinkId", () => {
      const id = TrackedLinkId.generate();
      expect(id).toBeTruthy();
      expect(id.value.length > 0).toBeTruthy();
    });

    it("should create TrackedLinkId from valid string", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const result = TrackedLinkId.fromString(uuid);
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.value).toBe(uuid);
      }
    });

    it("should reject invalid UUID string", () => {
      const result = TrackedLinkId.fromString("invalid-id");
      expect(result.ok).toBeFalsy();
    });

    it("should compare TrackedLinkIds for equality", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const id1 = TrackedLinkId.fromStringUnsafe(uuid);
      const id2 = TrackedLinkId.fromStringUnsafe(uuid);
      expect(id1.equals(id2)).toBeTruthy();
    });
  });

  describe("ShortCode Value Object", () => {
    it("should generate a unique short code", () => {
      const code = ShortCode.generate();
      expect(code).toBeTruthy();
      expect(code.value.length >= 6).toBeTruthy();
      expect(code.value.length <= 10).toBeTruthy();
    });

    it("should create ShortCode from valid string", () => {
      const result = ShortCode.fromString("abc123");
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.value).toBe("abc123");
      }
    });

    it("should reject short code that is too short", () => {
      const result = ShortCode.fromString("ab");
      expect(result.ok).toBeFalsy();
    });

    it("should reject short code with invalid characters", () => {
      const result = ShortCode.fromString("abc@123");
      expect(result.ok).toBeFalsy();
    });

    it("should allow custom vanity slug", () => {
      const result = ShortCode.fromString("my-brand-link");
      expect(result.ok).toBeTruthy();
    });
  });

  describe("TrackedLink Entity", () => {
    const projectId = ProjectId.generate();
    const TL_ACCOUNT_ID = "c9000000-0000-4000-8000-000000000001";

    it("should create a tracked link with valid URL", () => {
      const result = TrackedLink.create({
        accountId: TL_ACCOUNT_ID,
        projectId,
        originalUrl: "https://example.com/my-page",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.originalUrl).toBe("https://example.com/my-page");
        expect(result.value.shortCode).toBeTruthy();
        expect(result.value.clicks).toBe(0);
        expect(result.value.projectId.value).toBe(projectId.value);
      }
    });

    it("should reject invalid URL", () => {
      const result = TrackedLink.create({
        accountId: TL_ACCOUNT_ID,
        projectId,
        originalUrl: "not-a-valid-url",
      });

      expect(result.ok).toBeFalsy();
    });

    it("should create tracked link with custom vanity slug", () => {
      const result = TrackedLink.create({
        accountId: TL_ACCOUNT_ID,
        projectId,
        originalUrl: "https://example.com/campaign",
        vanitySlug: "summer-sale",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.vanitySlug).toBe("summer-sale");
      }
    });

    it("should increment click count", () => {
      const result = TrackedLink.create({
        accountId: TL_ACCOUNT_ID,
        projectId,
        originalUrl: "https://example.com",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const link = result.value;
        expect(link.clicks).toBe(0);

        link.recordClick();
        expect(link.clicks).toBe(1);

        link.recordClick();
        expect(link.clicks).toBe(2);
      }
    });

    it("should deactivate a link", () => {
      const result = TrackedLink.create({
        accountId: TL_ACCOUNT_ID,
        projectId,
        originalUrl: "https://example.com",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const link = result.value;
        expect(link.isActive).toBeTruthy();

        link.deactivate();
        expect(link.isActive).toBeFalsy();
      }
    });

    it("should reactivate a deactivated link", () => {
      const result = TrackedLink.create({
        accountId: TL_ACCOUNT_ID,
        projectId,
        originalUrl: "https://example.com",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const link = result.value;
        link.deactivate();
        link.activate();
        expect(link.isActive).toBeTruthy();
      }
    });

    it("should serialize to JSON", () => {
      const result = TrackedLink.create({
        accountId: TL_ACCOUNT_ID,
        projectId,
        originalUrl: "https://example.com",
        vanitySlug: "my-link",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const json = result.value.toJSON();
        expect(json.id).toBeTruthy();
        expect(json.originalUrl).toBe("https://example.com");
        expect(json.vanitySlug).toBe("my-link");
        expect(json.clicks).toBe(0);
        expect(json.isActive).toBe(true);
      }
    });
  });

  describe("LinkClickId Value Object", () => {
    it("should generate a new LinkClickId", () => {
      const id = LinkClickId.generate();
      expect(id).toBeTruthy();
    });

    it("should create from valid UUID string", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const result = LinkClickId.fromString(uuid);
      expect(result.ok).toBeTruthy();
    });
  });

  describe("LinkClick Entity", () => {
    const linkId = TrackedLinkId.generate();

    it("should create a link click with minimal data", () => {
      const result = LinkClick.create({
        trackedLinkId: linkId,
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.trackedLinkId.value).toBe(linkId.value);
        expect(result.value.timestamp).toBeTruthy();
        expect(result.value.timestamp instanceof Date).toBeTruthy();
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

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.referrer).toBe("https://google.com");
        expect(result.value.userAgent).toBe("Mozilla/5.0");
        expect(result.value.country).toBe("US");
        expect(result.value.city).toBe("New York");
      }
    });

    it("should serialize to JSON", () => {
      const result = LinkClick.create({
        trackedLinkId: linkId,
        country: "UK",
      });

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const json = result.value.toJSON();
        expect(json.id).toBeTruthy();
        expect(json.trackedLinkId).toBeTruthy();
        expect(json.country).toBe("UK");
        expect(json.timestamp).toBeTruthy();
      }
    });

    it("should have undefined optional fields when not provided", () => {
      const result = LinkClick.create({ trackedLinkId: linkId });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.referrer).toBe(undefined);
        expect(result.value.userAgent).toBe(undefined);
        expect(result.value.ipAddress).toBe(undefined);
        expect(result.value.country).toBe(undefined);
        expect(result.value.city).toBe(undefined);
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
      expect(codes.size >= 18).toBeTruthy();
    });

    it("should only use alphanumeric characters (no ambiguous chars)", () => {
      for (let i = 0; i < 10; i++) {
        const code = ShortCode.generate().value;
        expect(code).toMatch(/^[a-zA-Z0-9]+$/);
        expect(code.includes("0")).toBeFalsy();
        expect(code.includes("1")).toBeFalsy();
        expect(code.includes("l")).toBeFalsy();
        expect(code.includes("O")).toBeFalsy();
      }
    });
  });
});
