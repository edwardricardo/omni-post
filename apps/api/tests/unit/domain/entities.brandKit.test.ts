/**
 * @file entities.brandKit.test.ts
 * @description Tests for BrandKit domain entity — creation, validation, update, serialization.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { BrandKit } from "../../../src/domain/entities/BrandKit.js";

describe("BrandKit Entity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("creates brand kit with valid hex colors", () => {
      const result = BrandKit.create({
        accountId: "acc-1",
        primaryColor: "#FF0000",
        secondaryColor: "#00FF00",
        accentColor: "#0000FF",
      });
      assert.ok(result.ok, "Should create successfully");
      assert.equal(result.value.accountId, "acc-1");
      assert.equal(result.value.primaryColor, "#FF0000");
      assert.equal(result.value.secondaryColor, "#00FF00");
      assert.equal(result.value.accentColor, "#0000FF");
    });

    it("creates brand kit with lowercase hex colors", () => {
      const result = BrandKit.create({
        accountId: "acc-1",
        primaryColor: "#ff00aa",
      });
      assert.ok(result.ok);
      assert.equal(result.value.primaryColor, "#ff00aa");
    });

    it("creates brand kit with no optional fields", () => {
      const result = BrandKit.create({ accountId: "acc-1" });
      assert.ok(result.ok);
      assert.equal(result.value.accountId, "acc-1");
      assert.equal(result.value.primaryColor, undefined);
      assert.equal(result.value.secondaryColor, undefined);
      assert.equal(result.value.accentColor, undefined);
      assert.equal(result.value.logoUrl, undefined);
      assert.equal(result.value.fontPrimary, undefined);
    });

    it("creates brand kit with logo and font fields", () => {
      const result = BrandKit.create({
        accountId: "acc-1",
        logoUrl: "https://example.com/logo.png",
        logoStorageKey: "logos/acc-1/logo.png",
        fontPrimary: "Inter",
        fontSecondary: "Georgia",
      });
      assert.ok(result.ok);
      assert.equal(result.value.logoUrl, "https://example.com/logo.png");
      assert.equal(result.value.logoStorageKey, "logos/acc-1/logo.png");
      assert.equal(result.value.fontPrimary, "Inter");
      assert.equal(result.value.fontSecondary, "Georgia");
    });

    it("rejects empty accountId", () => {
      const result = BrandKit.create({ accountId: "" });
      assert.ok(!result.ok);
      assert.match(result.error.message, /accountId is required/);
    });

    it("rejects invalid primaryColor format", () => {
      const result = BrandKit.create({ accountId: "acc-1", primaryColor: "red" });
      assert.ok(!result.ok);
      assert.match(result.error.message, /primaryColor.*#RRGGBB/);
    });

    it("rejects invalid secondaryColor format", () => {
      const result = BrandKit.create({ accountId: "acc-1", secondaryColor: "#GGG000" });
      assert.ok(!result.ok);
      assert.match(result.error.message, /secondaryColor.*#RRGGBB/);
    });

    it("rejects invalid accentColor format", () => {
      const result = BrandKit.create({ accountId: "acc-1", accentColor: "#FFF" });
      assert.ok(!result.ok);
      assert.match(result.error.message, /accentColor.*#RRGGBB/);
    });

    it("rejects hex color without hash", () => {
      const result = BrandKit.create({ accountId: "acc-1", primaryColor: "FF0000" });
      assert.ok(!result.ok);
    });

    it("rejects hex color with 8 digits (alpha)", () => {
      const result = BrandKit.create({ accountId: "acc-1", primaryColor: "#FF000080" });
      assert.ok(!result.ok);
    });

    it("accepts null colors", () => {
      const result = BrandKit.create({
        accountId: "acc-1",
        primaryColor: undefined,
        secondaryColor: undefined,
        accentColor: undefined,
      });
      assert.ok(result.ok);
    });

    it("sets createdAt and updatedAt timestamps", () => {
      const before = new Date();
      const result = BrandKit.create({ accountId: "acc-1" });
      assert.ok(result.ok);
      assert.ok(result.value.createdAt >= before);
      assert.ok(result.value.updatedAt >= before);
    });
  });

  describe("reconstitute", () => {
    it("reconstitutes from persisted props without validation", () => {
      const props = {
        id: "bk-1",
        accountId: "acc-1",
        primaryColor: "#FF0000",
        secondaryColor: "#00FF00",
        accentColor: "#0000FF",
        logoUrl: "https://example.com/logo.png",
        logoStorageKey: "logos/acc-1.png",
        fontPrimary: "Inter",
        fontSecondary: "Georgia",
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-06-01"),
      };
      const kit = BrandKit.reconstitute(props);
      assert.equal(kit.id, "bk-1");
      assert.equal(kit.accountId, "acc-1");
      assert.equal(kit.primaryColor, "#FF0000");
      assert.equal(kit.fontPrimary, "Inter");
      assert.deepEqual(kit.createdAt, new Date("2024-01-01"));
    });
  });

  describe("update", () => {
    it("updates colors with valid hex", () => {
      const kit = BrandKit.reconstitute({
        id: "bk-1",
        accountId: "acc-1",
        primaryColor: "#FF0000",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const result = kit.update({ primaryColor: "#00FF00" });
      assert.ok(result.ok);
      assert.equal(result.value.primaryColor, "#00FF00");
      assert.equal(result.value.accountId, "acc-1");
    });

    it("rejects invalid hex in update", () => {
      const kit = BrandKit.reconstitute({
        id: "bk-1",
        accountId: "acc-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const result = kit.update({ accentColor: "not-a-color" });
      assert.ok(!result.ok);
      assert.match(result.error.message, /accentColor.*#RRGGBB/);
    });

    it("updates updatedAt timestamp", () => {
      const oldDate = new Date("2024-01-01");
      const kit = BrandKit.reconstitute({
        id: "bk-1",
        accountId: "acc-1",
        createdAt: oldDate,
        updatedAt: oldDate,
      });
      const result = kit.update({ fontPrimary: "Roboto" });
      assert.ok(result.ok);
      assert.ok(result.value.updatedAt > oldDate);
    });

    it("preserves existing props when updating partial fields", () => {
      const kit = BrandKit.reconstitute({
        id: "bk-1",
        accountId: "acc-1",
        primaryColor: "#FF0000",
        logoUrl: "https://example.com/logo.png",
        fontPrimary: "Inter",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const result = kit.update({ fontSecondary: "Georgia" });
      assert.ok(result.ok);
      assert.equal(result.value.primaryColor, "#FF0000");
      assert.equal(result.value.logoUrl, "https://example.com/logo.png");
      assert.equal(result.value.fontPrimary, "Inter");
      assert.equal(result.value.fontSecondary, "Georgia");
    });
  });

  describe("toJSON", () => {
    it("returns plain object with all properties", () => {
      const props = {
        id: "bk-1",
        accountId: "acc-1",
        primaryColor: "#FF0000",
        secondaryColor: "#00FF00",
        accentColor: "#0000FF",
        logoUrl: "https://example.com/logo.png",
        logoStorageKey: "logos/acc-1.png",
        fontPrimary: "Inter",
        fontSecondary: "Georgia",
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-06-01"),
      };
      const kit = BrandKit.reconstitute(props);
      const json = kit.toJSON();
      assert.deepEqual(json, props);
    });

    it("returns a new object (not the same reference)", () => {
      const kit = BrandKit.reconstitute({
        id: "bk-1",
        accountId: "acc-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const json1 = kit.toJSON();
      const json2 = kit.toJSON();
      expect(json1).not.toBe(json2);
      assert.deepEqual(json1, json2);
    });
  });
});
